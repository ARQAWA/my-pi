// RQW-codex stage 5: native backend compaction (Codex V2 remote compaction) over the same /codex/responses
// inference endpoint. The request carries one trailing compaction_trigger item. The result is installed only
// after exactly one compaction output and response.completed were received; any failure leaves the history,
// window and effort pins untouched. Estimators, retention and truncation are ported from the pinned Codex
// stable source (see the comments on each function). Imports: Node built-ins, this folder only.
import { randomBytes } from "node:crypto";
import { CODEX_ENDPOINT } from "./profile.ts";
import { type WireEnvelope, type WireItem, type WireWindow, WireHistory, canonicalJson, sha256Hex } from "./history.ts";

/** compact_remote_v2.rs RETAINED_MESSAGE_TOKEN_BUDGET */
export const RETAINED_MESSAGE_TOKEN_BUDGET = 64_000;
/** compact_remote_v2.rs MAX_RETAINED_AGENT_MESSAGE_TOKENS */
export const MAX_RETAINED_AGENT_MESSAGE_TOKENS = 10_000;
/** compact_remote_v2.rs MAX_REMOTE_COMPACTION_V2_STREAM_RETRIES (per transport). */
export const COMPACTION_STREAM_RETRIES = 2;
/** config.rs / model-provider-info DEFAULT_STREAM_MAX_RETRIES: the provider value used when none is configured. */
export const PROVIDER_STREAM_MAX_RETRIES_DEFAULT = 5;
/** codex-async-utils backoff(): 200 ms initial delay, doubling per attempt, +-10% jitter. */
export const RETRY_INITIAL_DELAY_MS = 200;
/** compact_remote_history.rs CONTEXT_WINDOW_TRUNCATED_OUTPUT_MESSAGE */
export const CONTEXT_WINDOW_TRUNCATED_OUTPUT_MESSAGE = "Output exceeded the available model context and was truncated";
/** context_manager/history.rs RESIZED_IMAGE_BYTES_ESTIMATE */
export const RESIZED_IMAGE_BYTES_ESTIMATE = 7373;
/** context/unsupported_media.rs texts (body of the placeholder fragment) */
export const UNSUPPORTED_IMAGE_TEXT = "image content omitted because you do not support image input";
export const UNSUPPORTED_AUDIO_TEXT = "audio content omitted because you do not support audio input";

export type CompactionErrorCode = "aborted" | "failed" | "incomplete" | "stream" | "malformed" | "no-native-base" | "budget";

export class CompactionError extends Error {
	readonly code: CompactionErrorCode;
	readonly retryable: boolean;
	constructor(code: CompactionErrorCode, message: string, options: { retryable?: boolean } = {}) {
		super(`RQW-codex compaction ${code}: ${message}`);
		this.name = "CompactionError";
		this.code = code;
		this.retryable = options.retryable === true;
	}
}

export type CompactRequest = {
	/** Exact slug of the compaction model (pinned capability record, no /models call). */
	model: string;
	/** Pinned capability: Responses Lite request shape. */
	useResponsesLite: boolean;
	/** Pinned capability: modalities of the compaction model; media not listed is normalized away. */
	inputModalities: readonly ("text" | "image" | "audio")[];
	/** Usable window of the compaction model for function-output trimming; null disables trimming. */
	contextWindow: number | null;
	/** Base instructions as a developer item; omitted when empty or when Lite tools already exist in history. */
	baseInstructions?: string;
	/** Fresh tool declarations (ignored when Lite tools already exist in history). */
	tools?: unknown[];
	reasoning?: Record<string, unknown> | null;
	serviceTier?: string | null;
};

export type WireEvent = { type: string; [key: string]: unknown };

export type CompactFlags = {
	/** Client-authored developer messages retained (feature default off). */
	retainClientDeveloperMessages?: boolean;
	/** Client-requested tool-output retention (feature default off). */
	retainClientToolOutputs?: boolean;
	/** Images count against the retained budget (feature default on). */
	compactionImageBudget?: boolean;
};

export type CompactOptions = {
	request: CompactRequest;
	history: WireHistory;
	/**
	 * Injected transport. Yields normalized events: output_item_done{item}, completed{responseId,usage},
	 * failed{message}, incomplete{reason}, error{message,retryable}. Each call is one stream attempt.
	 */
	send: (call: { endpoint: string; body: Record<string, unknown>; signal?: AbortSignal; attempt: number }) =>
		| AsyncIterable<WireEvent>
		| Promise<AsyncIterable<WireEvent>>;
	signal?: AbortSignal;
	/** Digest of the pinned capabilities of the compaction model (comp hash). */
	modelHash: string;
	window: WireWindow;
	/** Previous-model fallback, used only when the primary attempt fails for a non-terminal reason. */
	fallback?: { request: CompactRequest; modelHash: string };
	flags?: CompactFlags;
	/** Decides whether a thrown transport error is retried (default: err.retryable === true). */
	isRetryable?: (error: unknown) => boolean;
	/** Pi entry ids the compaction covers (source references kept for portable non-Codex use). */
	sourceEntryIds?: string[];
	/** Injectable window id source; default UUID v7. */
	newWindowId?: () => string;
	/** Injectable clock for UUID v7. */
	now?: () => number;
	/**
	 * Replaces the standard contextual-user matcher set (native CONTEXTUAL_USER_FRAGMENT_MATCHERS, default). Hook
	 * prompt fragments are always contextual, as in native is_contextual_user_fragment.
	 */
	isContextualUserText?: (text: string) => boolean;
	/**
	 * "foreground" (default): native stream retries per transport (min(streamMaxRetries, 2)), then switchTransport.
	 * "background": one attempt, no stream retry and no transport switch (native background request).
	 */
	transport?: "foreground" | "background";
	/** Provider stream_max_retries (native default 5); the compaction budget is min(this, COMPACTION_STREAM_RETRIES). */
	streamMaxRetries?: number;
	/**
	 * Native try_switch_fallback_transport: called once when the transport's retry budget is exhausted. Returning true
	 * resets the retry budget for the fallback transport; false ends the request with the original error.
	 */
	switchTransport?: () => boolean;
	/** Injectable wait for retry backoff (default: real timer). Must reject or resolve promptly on abort. */
	sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
	/** Injectable random source for the backoff jitter, returns [0, 1) (default Math.random). */
	random?: () => number;
	/**
	 * Install guard, applied after the candidate, its retention and the primary or fallback selection succeeded (outside all retries and
	 * model fallback). It receives the synchronous install closure and must call it at most once, while its own atomic check holds (for
	 * example inside the credential store lock). The closure has no await: once it returns, the checkpoint is committed. A throw, or a
	 * guard that never calls install, ends the request with no checkpoint, no window advance and no onInstalled.
	 */
	withInstallGuard?: (install: () => CompactResult) => CompactResult | Promise<CompactResult>;
};

export type CompactResult = {
	installed: true;
	entryId: string;
	responseId: string;
	window: WireWindow;
	modelHash: string;
	retainedCount: number;
	retainedImageCount: number;
	usage: unknown;
};

// ---------- estimators (utils/string/src/truncate.rs, utils/output-truncation, context_manager/history.rs) ----------

const BYTES_PER_TOKEN = 4;

function textBytes(text: unknown): number {
	return typeof text === "string" ? Buffer.byteLength(text, "utf8") : 0;
}

/** approx_token_count: ceil(bytes / 4). */
export function approxTokenCount(text: string): number {
	return Math.ceil(textBytes(text) / BYTES_PER_TOKEN);
}

/** approx_tokens_from_byte_count_i64. */
function tokensFromBytes(bytes: number): number {
	return bytes <= 0 ? 0 : Math.ceil(bytes / BYTES_PER_TOKEN);
}

function jsonBytes(value: unknown): number {
	return value === undefined ? 0 : Buffer.byteLength(JSON.stringify(value) ?? "", "utf8");
}

/** approx_bytes_for_tokens (utils/string truncate.rs): tokens * 4. */
const approxBytesForTokens = (tokens: number) => tokens * BYTES_PER_TOKEN;

// ---------- media (context_manager/history.rs, utils/audio/src/lib.rs) ----------

/** context_manager/history.rs ORIGINAL_IMAGE_PATCH_SIZE / ORIGINAL_IMAGE_MAX_PATCHES. */
const ORIGINAL_IMAGE_PATCH_SIZE = 32;
const ORIGINAL_IMAGE_MAX_PATCHES = 10_000;
/** utils/audio AUDIO_TOKENS_PER_SECOND. */
const AUDIO_TOKENS_PER_SECOND = 10;

/** parse_base64_image_data_url: data:image/*;...;base64,<payload>. Returns the payload or null. */
function base64ImagePayload(url: string): string | null {
	if (url.slice(0, 5).toLowerCase() !== "data:") return null;
	const comma = url.indexOf(",");
	if (comma < 0) return null;
	const parts = url.slice(5, comma).split(";");
	if (parts[0].slice(0, 6).toLowerCase() !== "image/") return null;
	if (!parts.slice(1).some((p) => p.toLowerCase() === "base64")) return null;
	return url.slice(comma + 1);
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function jpegDimensions(b: Buffer): { width: number; height: number } | null {
	let i = 2;
	while (i + 9 < b.length) {
		if (b[i] !== 0xff) {
			i++;
			continue;
		}
		const marker = b[i + 1];
		if (marker === 0xff) {
			i++;
			continue;
		}
		if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
			return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
		}
		if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
			i += 2;
			continue;
		}
		const length = b.readUInt16BE(i + 2);
		if (length < 2) return null;
		i += 2 + length;
	}
	return null;
}

function webpDimensions(b: Buffer): { width: number; height: number } | null {
	const chunk = b.toString("latin1", 12, 16);
	const u24 = (o: number) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16);
	if (chunk === "VP8X" && b.length >= 30) return { width: 1 + u24(24), height: 1 + u24(27) };
	if (chunk === "VP8 " && b.length >= 30) return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
	if (chunk === "VP8L" && b.length >= 25 && b[20] === 0x2f) {
		const bits = b.readUInt32LE(21);
		return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
	}
	return null;
}

/**
 * Width and height from the header of a PNG, GIF, JPEG or WebP image; null when not recognised (native decode fails).
 * Header-only: native decodes the whole image, so a valid header over a corrupt body is a known difference (native falls
 * back to RESIZED_IMAGE_BYTES_ESTIMATE). The four formats are the ones Pi 1.4 sends (processImage passes them through;
 * BMP is converted to PNG first). GIF decodes natively because codex-utils-image enables the image crate's gif feature.
 */
export function imageDimensionsFromBytes(b: Buffer): { width: number; height: number } | null {
	if (b.length >= 24 && b.subarray(0, 8).equals(PNG_SIGNATURE)) return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
	const gif = b.toString("latin1", 0, 6);
	if (b.length >= 10 && (gif === "GIF87a" || gif === "GIF89a")) return { width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
	if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) return jpegDimensions(b);
	if (b.length >= 30 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP") return webpDimensions(b);
	return null;
}

/**
 * estimate_original_image_bytes + estimate_image_bytes: detail "original" on an inline base64 image uses the decoded
 * dimensions (32 px patches, capped); an undecodable inline image uses RESIZED_IMAGE_BYTES_ESTIMATE. A file reference
 * has no dimensions and uses the maximum patch count, as in estimate_image_reference_bytes.
 */
function imageBytes(part: Record<string, unknown>): number {
	if (part.detail !== "original") return RESIZED_IMAGE_BYTES_ESTIMATE;
	if (typeof part.image_url !== "string") {
		return approxBytesForTokens(ORIGINAL_IMAGE_MAX_PATCHES);
	}
	const payload = base64ImagePayload(part.image_url);
	const dims = payload === null ? null : imageDimensionsFromBytes(Buffer.from(payload, "base64"));
	if (!dims) return RESIZED_IMAGE_BYTES_ESTIMATE;
	const patchesWide = Math.ceil(dims.width / ORIGINAL_IMAGE_PATCH_SIZE);
	const patchesHigh = Math.ceil(dims.height / ORIGINAL_IMAGE_PATCH_SIZE);
	return approxBytesForTokens(Math.min(patchesWide * patchesHigh, ORIGINAL_IMAGE_MAX_PATCHES));
}

const WAV_MIME_TYPES = new Set(["audio/wav", "audio/x-wav", "audio/wave", "audio/vnd.wave"]);

/**
 * Duration of a base64 WAV data URL from its RIFF header (data size / byte rate), or null. Approximation of native
 * symphonia duration for canonical WAV headers only. Unreachable: Pi 1.4 has no audio content and the pinned GPT
 * profiles list input_modalities [text, image], so audio never reaches this estimator from ordinary inputs. Other
 * containers (mp3, mp4, webm, ogg) are NOT decoded here; native decodes them, so they use the URL fallback below.
 */
function wavDurationSeconds(url: string): number | null {
	if (url.slice(0, 5).toLowerCase() !== "data:") return null;
	const comma = url.indexOf(",");
	if (comma < 0) return null;
	const parts = url.slice(5, comma).split(";");
	if (!WAV_MIME_TYPES.has(parts[0].toLowerCase())) return null;
	if (!parts.slice(1).some((p) => p.toLowerCase() === "base64")) return null;
	const b = Buffer.from(url.slice(comma + 1), "base64");
	if (b.length < 12 || b.toString("latin1", 0, 4) !== "RIFF" || b.toString("latin1", 8, 12) !== "WAVE") return null;
	let byteRate = 0;
	let dataSize: number | null = null;
	let o = 12;
	while (o + 8 <= b.length) {
		const id = b.toString("latin1", o, o + 4);
		const size = b.readUInt32LE(o + 4);
		const body = o + 8;
		if (id === "fmt " && body + 12 <= b.length) byteRate = b.readUInt32LE(body + 8);
		if (id === "data") {
			dataSize = Math.min(size, b.length - body);
			break;
		}
		o = body + size + (size % 2);
	}
	if (dataSize === null || byteRate <= 0) return null;
	const seconds = dataSize / byteRate;
	return Number.isFinite(seconds) ? seconds : null;
}

/** estimate_audio_token_count shape: duration x 10 tokens per second when the raw bytes give a duration, else approx of the URL. See wavDurationSeconds for the exactness limits. */
export function audioTokenCount(url: string): number {
	const seconds = wavDurationSeconds(url);
	return seconds === null ? approxTokenCount(url) : Math.ceil(seconds * AUDIO_TOKENS_PER_SECOND);
}

function audioBytes(url: unknown): number {
	return approxBytesForTokens(audioTokenCount(typeof url === "string" ? url : ""));
}

/** Encrypted content length estimates (protocol/src/protocol.rs, context_manager/history.rs). */
const encryptedOutputLength = (len: number) => Math.ceil((len * 9) / 16);
const reasoningLength = (len: number) => Math.max(Math.floor((len * 3) / 4) - 650, 0);
const compactionLength = (len: number) => Math.ceil(len / 3);

function contentPartBytes(part: Record<string, unknown>): number {
	switch (part.type) {
		case "input_text":
		case "output_text":
			return textBytes(part.text);
		case "input_image":
			return imageBytes(part);
		case "input_audio":
			return audioBytes(part.audio_url);
		case "encrypted_content":
			return typeof part.encrypted_content === "string" ? encryptedOutputLength(textBytes(part.encrypted_content)) : 0;
		default:
			return 0;
	}
}

function outputBytes(output: unknown): number {
	if (typeof output === "string") return textBytes(output);
	if (Array.isArray(output)) return output.reduce((sum: number, part) => sum + contentPartBytes(part as Record<string, unknown>), 0);
	return 0;
}

/** estimate_response_item_model_visible_bytes, per item kind. Unknown kinds count 0 (native catch-all). */
function itemBytes(item: WireItem): number {
	const str = (v: unknown) => (typeof v === "string" ? v : "");
	switch (item.type) {
		case "message":
			return (Array.isArray(item.content) ? item.content : []).reduce((s: number, p) => s + contentPartBytes(p as Record<string, unknown>), 0);
		case "agent_message": {
			const content = Array.isArray(item.content) ? (item.content as Record<string, unknown>[]) : [];
			return content.reduce((s, p) => s + contentPartBytes(p), textBytes(item.author) + textBytes(item.recipient));
		}
		case "reasoning":
			return typeof item.encrypted_content === "string" ? reasoningLength(textBytes(item.encrypted_content)) : 0;
		case "compaction":
		case "context_compaction":
			return typeof item.encrypted_content === "string" ? compactionLength(textBytes(item.encrypted_content)) : 0;
		case "function_call":
			return textBytes(item.name) + textBytes(item.namespace ?? "functions") + textBytes(item.arguments);
		case "custom_tool_call":
			return textBytes(item.name) + textBytes(item.namespace ?? "functions") + textBytes(item.input);
		case "function_call_output":
			return outputBytes(item.output) + textBytes(item.call_id) + textBytes(item.name) + textBytes(item.namespace);
		case "custom_tool_call_output":
			return outputBytes(item.output) + textBytes(item.call_id) + textBytes(item.name);
		case "additional_tools":
			return jsonBytes(item.tools);
		case "tool_search_call":
			return jsonBytes(item.arguments);
		case "tool_search_output":
			return jsonBytes(item.tools);
		case "local_shell_call":
			return jsonBytes(item.action);
		case "web_search_call":
			return item.action === undefined || item.action === null ? 0 : jsonBytes(item.action);
		case "image_generation_call":
			return textBytes(str(item.revised_prompt)) + (str(item.result) === "" ? 0 : RESIZED_IMAGE_BYTES_ESTIMATE);
		default:
			return 0;
	}
}

/** estimate_item_token_count: model-visible bytes converted with ceil(bytes / 4). */
export function estimateItemTokens(item: WireItem): number {
	return tokensFromBytes(itemBytes(item));
}

/** content_item_token_count (compact_remote_v2_images.rs): text approx, image 1844 (7373 bytes), audio 0. */
function contentPartTokens(part: Record<string, unknown>): number {
	switch (part.type) {
		case "input_text":
		case "output_text":
			return approxTokenCount(String(part.text ?? ""));
		case "input_image":
			return tokensFromBytes(imageBytes(part));
		default:
			return 0;
	}
}

// ---------- truncation (utils/string/src/truncate.rs, utils/output-truncation) ----------

function floorBoundary(buf: Buffer, index: number): number {
	let i = Math.min(index, buf.length);
	while (i > 0 && i < buf.length && (buf[i] & 0xc0) === 0x80) i--;
	return i;
}

function ceilBoundary(buf: Buffer, index: number): number {
	let i = Math.max(index, 0);
	while (i < buf.length && (buf[i] & 0xc0) === 0x80) i++;
	return i;
}

/** truncate_middle_with_token_budget: keeps both ends, middle marker counts removed tokens. */
export function truncateTokens(text: string, maxTokens: number): string {
	if (text === "") return "";
	const maxBytes = maxTokens * BYTES_PER_TOKEN;
	const buf = Buffer.from(text, "utf8");
	if (buf.length <= maxBytes) return text;
	const left = Math.floor(maxBytes / 2);
	const right = maxBytes - left;
	const prefixEnd = floorBoundary(buf, left);
	const suffixStart = ceilBoundary(buf, buf.length - right);
	const removedTokens = tokensFromBytes(buf.length - maxBytes);
	return `${buf.subarray(0, prefixEnd).toString("utf8")}…${removedTokens} tokens truncated…${buf.subarray(suffixStart).toString("utf8")}`;
}

// ---------- item grouping and retention (compact_remote_history.rs, compact_remote_v2.rs) ----------

const IMAGE_OPEN = "<image>";
const IMAGE_CLOSE = "</image>";
const LOCAL_IMAGE_OPEN_PREFIX = "<image name=";

const isLocalImageOpen = (t: string) => t.startsWith(LOCAL_IMAGE_OPEN_PREFIX) && t.slice(LOCAL_IMAGE_OPEN_PREFIX.length).endsWith(">");
const isImageOpen = (t: string) => t === IMAGE_OPEN;
const isImageClose = (t: string) => t === IMAGE_CLOSE;

/** Rust eq_ignore_ascii_case on ASCII letters only. */
const lowerAscii = (s: string) => s.replace(/[A-Z]+/g, (m) => m.toLowerCase());

/**
 * context-fragments fragment.rs matches_marked_text: trim_start then case-insensitive ASCII prefix, trim_end then
 * case-insensitive ASCII suffix. Both markers must be non-empty.
 */
export function matchesMarkedText(startMarker: string, endMarker: string, text: string): boolean {
	if (startMarker === "" || endMarker === "") return false;
	const trimmed = text.trimStart();
	const startsWith = trimmed.length >= startMarker.length && lowerAscii(trimmed.slice(0, startMarker.length)) === lowerAscii(startMarker);
	const body = trimmed.trimEnd();
	const endsWith = body.length >= endMarker.length && lowerAscii(body.slice(body.length - endMarker.length)) === lowerAscii(endMarker);
	return startsWith && endsWith;
}

/** ImageResizeNotice::matches_text (core/src/context/image_resize_notice.rs), developer-role attached notice. */
export function isImageResizeNoticeText(text: string): boolean {
	return matchesMarkedText("<image_resize_notice>", "</image_resize_notice>", text);
}

function isAttachedNotice(env: WireEnvelope): boolean {
	const { item } = env;
	return (
		item.type === "message" &&
		item.role === "developer" &&
		Array.isArray(item.content) &&
		item.content.length === 1 &&
		(item.content[0] as Record<string, unknown>).type === "input_text" &&
		isImageResizeNoticeText(String((item.content[0] as Record<string, unknown>).text ?? ""))
	);
}

type Group = { source: WireEnvelope; notice: WireEnvelope | null };

/** history_item_groups: a source plus an immediately following attached resize notice. */
function historyGroups(items: WireEnvelope[]): Group[] {
	const groups: Group[] = [];
	for (let i = 0; i < items.length; i++) {
		const source = items[i];
		const next = items[i + 1];
		if (next && isAttachedNotice(next)) {
			groups.push({ source, notice: next });
			i++;
		} else {
			groups.push({ source, notice: null });
		}
	}
	return groups;
}

/** v2_history_item_groups: a client-authored developer notice becomes its own group. */
function v2Groups(items: WireEnvelope[]): Group[] {
	const out: Group[] = [];
	for (const group of historyGroups(items)) {
		if (group.notice && isClientDeveloper(group.notice)) {
			out.push({ source: group.source, notice: null });
			out.push({ source: group.notice, notice: null });
		} else {
			out.push(group);
		}
	}
	return out;
}

function isClientDeveloper(env: WireEnvelope): boolean {
	return env.clientAuthored === true && env.item.type === "message" && env.item.role === "developer";
}

/** is_retained_tool_output: named client output without call id. */
function isRetainedToolOutput(env: WireEnvelope): boolean {
	return env.clientAuthored === true && env.item.type === "function_call_output" && !env.item.call_id && typeof env.item.name === "string";
}

/**
 * Standard marked fragments (native CONTEXTUAL_USER_FRAGMENT_MATCHERS, using each fragment's type_markers). Source:
 * UserInstructions "# AGENTS.md instructions"/"</INSTRUCTIONS>" (user_instructions.rs), EnvironmentsState
 * "<environment_context>" (protocol.rs ENVIRONMENT_CONTEXT_*_TAG), AgentMessageBoardNotification
 * (agent_message_board_notification.rs), SkillInstructions "<skill>" (ext/skills/src/fragments.rs),
 * UserShellCommand (user_shell_command.rs), TurnAborted (turn_aborted.rs), SubagentNotification
 * (subagent_notification.rs), RecommendedPluginsInstructions (recommended_plugins_instructions.rs).
 */
const MARKED_CONTEXTUAL_USER_FRAGMENTS: ReadonlyArray<readonly [string, string]> = [
	["# AGENTS.md instructions", "</INSTRUCTIONS>"],
	["<environment_context>", "</environment_context>"],
	["<agent_message_board_notification>", "</agent_message_board_notification>"],
	["<skill>", "</skill>"],
	["<user_shell_command>", "</user_shell_command>"],
	["<turn_aborted>", "</turn_aborted>"],
	["<subagent_notification>", "</subagent_notification>"],
	["<recommended_plugins>", "</recommended_plugins>"],
];

/** AdditionalContextUserFragment::matches_text (context-fragments additional_context.rs): <external_KEY>...</external_KEY>. */
function matchesAdditionalContext(text: string): boolean {
	const trimmed = text.trim();
	if (!trimmed.startsWith("<external_")) return false;
	const rest = trimmed.slice("<external_".length);
	const cut = rest.indexOf(">");
	if (cut < 0) return false;
	const key = rest.slice(0, cut);
	return rest.slice(cut + 1).endsWith(`</external_${key}>`);
}

/** InternalModelContextFragment::matches_text (core/src/context/internal_model_context.rs), incl. legacy goal context. */
function matchesInternalModelContext(text: string): boolean {
	const trimmed = text.trim();
	if (trimmed.startsWith("<goal_context>") && trimmed.endsWith("</goal_context>")) return true;
	if (!trimmed.startsWith("<codex_internal_context")) return false;
	const afterStart = trimmed.slice("<codex_internal_context".length);
	if (!afterStart.startsWith(' source="')) return false;
	const rest = afterStart.slice(' source="'.length);
	const cut = rest.indexOf('">');
	if (cut < 0) return false;
	const source = rest.slice(0, cut);
	return /^[a-z][a-z0-9_]*$/.test(source) && rest.slice(cut + 2).endsWith("</codex_internal_context>");
}

// ---------- hook prompt XML (protocol items.rs parse_hook_prompt_fragment = quick-xml 0.41.0 serde from_str) ----------
// Minimal scanner with the same accept/reject outcome as the pinned upstream reader for this struct
// (HookPromptXml: attribute @hook_run_id, text $text, root name ignored). Only the boolean is exported.

/** Rust str::trim set (Unicode White_Space). */
const RUST_WHITESPACE = "\\t\\n\\v\\f\\r \\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const RUST_TRIM = new RegExp(`^[${RUST_WHITESPACE}]+|[${RUST_WHITESPACE}]+$`, "g");
/** quick-xml is_blank: XML S only (space, tab, CR, LF); an empty merged text run is blank too. */
const XML_BLANK = /^[ \t\r\n]*$/;
/** quick-xml PredefinedEntityResolver. */
const PREDEFINED_ENTITIES = new Map<string, string>([
	["amp", "&"],
	["lt", "<"],
	["gt", ">"],
	["apos", "'"],
	["quot", "\""],
]);

function rustTrim(text: string): string {
	return text.replace(RUST_TRIM, "");
}

function skipXmlS(s: string, p: number): number {
	while (p < s.length && (s[p] === " " || s[p] === "\t" || s[p] === "\r" || s[p] === "\n")) p++;
	return p;
}

const NAME_RE = /[^\s/>=<"'!?&;]+/y;

function readName(s: string, p: number): { name: string; end: number } | null {
	NAME_RE.lastIndex = p;
	const m = NAME_RE.exec(s);
	return m === null ? null : { name: m[0], end: p + m[0].length };
}

/** Predefined entity or character reference at s[p] === "&"; null when quick-xml would reject it. */
function readReference(s: string, p: number): { value: string; end: number } | null {
	const semi = s.indexOf(";", p + 1);
	if (semi < 0) return null;
	const name = s.slice(p + 1, semi);
	const num = /^#(?:x([0-9a-fA-F]+)|([0-9]+))$/.exec(name);
	if (num !== null) {
		const code = num[1] !== undefined ? Number.parseInt(num[1], 16) : Number.parseInt(num[2], 10);
		if (!Number.isFinite(code) || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return null;
		return { value: String.fromCodePoint(code), end: semi + 1 };
	}
	const value = PREDEFINED_ENTITIES.get(name);
	return value === undefined ? null : { value, end: semi + 1 };
}

function unescapeAttribute(raw: string): string | null {
	let out = "";
	for (let p = 0; p < raw.length; ) {
		if (raw[p] !== "&") {
			out += raw[p];
			p++;
			continue;
		}
		const r = readReference(raw, p);
		if (r === null) return null;
		out += r.value;
		p = r.end;
	}
	return out;
}

type StartTag = { name: string; attrs: Array<{ name: string; raw: string }>; selfClosing: boolean; end: number };

/** Start tag at s[p] === "<": attributes need quoted values and whitespace before each; duplicates are rejected. */
function readStartTag(s: string, p: number): StartTag | null {
	if (s[p] !== "<") return null;
	const head = readName(s, p + 1);
	if (head === null) return null;
	const attrs: Array<{ name: string; raw: string }> = [];
	let i = head.end;
	for (;;) {
		const at = skipXmlS(s, i);
		if (s.startsWith("/>", at)) return { name: head.name, attrs, selfClosing: true, end: at + 2 };
		if (s[at] === ">") return { name: head.name, attrs, selfClosing: false, end: at + 1 };
		if (at === i) return null;
		const attr = readName(s, at);
		if (attr === null) return null;
		let j = skipXmlS(s, attr.end);
		if (s[j] !== "=") return null;
		j = skipXmlS(s, j + 1);
		const quote = s[j];
		if (quote !== "\"" && quote !== "'") return null;
		const close = s.indexOf(quote, j + 1);
		if (close < 0) return null;
		if (attrs.some((a) => a.name === attr.name)) return null;
		attrs.push({ name: attr.name, raw: s.slice(j + 1, close) });
		i = close + 1;
	}
}

/** End tag at s[p] === "</". */
function readEndTag(s: string, p: number): { name: string; end: number } | null {
	const head = readName(s, p + 2);
	if (head === null) return null;
	const j = skipXmlS(s, head.end);
	return s[j] === ">" ? { name: head.name, end: j + 1 } : null;
}

/** Skips <!...> declarations (DOCTYPE with optional internal subset); -1 when unterminated. */
function skipDeclaration(s: string, p: number): number {
	let depth = 0;
	for (let i = p + 2; i < s.length; i++) {
		const c = s[i];
		if (c === "[") depth++;
		else if (c === "]") depth--;
		else if (c === ">" && depth <= 0) return i + 1;
	}
	return -1;
}

/** Skips whitespace, processing instructions, comments and declarations before the root element; -1 on error. */
function skipProlog(s: string, p: number): number {
	for (;;) {
		p = skipXmlS(s, p);
		if (s.startsWith("<?", p)) {
			const e = s.indexOf("?>", p + 2);
			if (e < 0) return -1;
			p = e + 2;
		} else if (s.startsWith("<!--", p)) {
			const e = s.indexOf("-->", p + 4);
			if (e < 0) return -1;
			p = e + 3;
		} else if (s.startsWith("<!", p)) {
			const e = skipDeclaration(s, p);
			if (e < 0) return -1;
			p = e;
		} else {
			return p;
		}
	}
}

/** Skips a child element subtree from just after its start tag; returns the index after its end tag, or -1. */
function skipElement(s: string, p: number, name: string): number {
	const open: string[] = [name];
	while (open.length > 0) {
		if (p >= s.length) return -1;
		if (s[p] !== "<") {
			const lt = s.indexOf("<", p);
			if (lt < 0) return -1;
			p = lt;
		} else if (s.startsWith("<!--", p)) {
			const e = s.indexOf("-->", p + 4);
			if (e < 0) return -1;
			p = e + 3;
		} else if (s.startsWith("<![CDATA[", p)) {
			const e = s.indexOf("]]>", p + 9);
			if (e < 0) return -1;
			p = e + 3;
		} else if (s.startsWith("<?", p)) {
			const e = s.indexOf("?>", p + 2);
			if (e < 0) return -1;
			p = e + 2;
		} else if (s.startsWith("</", p)) {
			const e = readEndTag(s, p);
			if (e === null || e.name !== open[open.length - 1]) return -1;
			open.pop();
			p = e.end;
		} else {
			const st = readStartTag(s, p);
			if (st === null) return -1;
			p = st.end;
			if (!st.selfClosing) open.push(st.name);
		}
	}
	return p;
}

/** Attribute keys that map to @hook_run_id: local name, except namespace bindings and xml: prefixed names. */
function isHookRunIdAttribute(name: string): boolean {
	if (name === "xmlns" || name.startsWith("xmlns:")) return false;
	const colon = name.indexOf(":");
	if (colon >= 0 && name.slice(0, colon) === "xml") return false;
	return (colon >= 0 ? name.slice(colon + 1) : name) === "hook_run_id";
}

/**
 * Hook prompt fragment: accepted when the trimmed text is one element with exactly one non-blank hook_run_id attribute
 * (after entity decoding and Rust trim) and exactly one non-blank text run among its direct content (text, CDATA and
 * references merge into one run; comments and processing instructions do not split it; child elements do). Content after
 * the root end tag is not read by the upstream deserializer and is ignored.
 */
export function isHookPromptText(text: string): boolean {
	const s = rustTrim(text);
	const start = skipProlog(s, 0);
	if (start < 0) return false;
	const root = readStartTag(s, start);
	if (root === null || root.selfClosing) return false;
	const hookAttrs = root.attrs.filter((a) => isHookRunIdAttribute(a.name));
	if (hookAttrs.length !== 1) return false;
	const hookRunId = unescapeAttribute(hookAttrs[0].raw);
	if (hookRunId === null || rustTrim(hookRunId) === "") return false;
	let textRuns = 0;
	let run = "";
	const endRun = () => {
		if (!XML_BLANK.test(run)) textRuns++;
		run = "";
	};
	let p = root.end;
	for (;;) {
		if (p >= s.length) return false;
		if (s[p] === "&") {
			const r = readReference(s, p);
			if (r === null) return false;
			run += r.value;
			p = r.end;
		} else if (s[p] !== "<") {
			let q = p;
			while (q < s.length && s[q] !== "<" && s[q] !== "&") q++;
			run += s.slice(p, q);
			p = q;
		} else if (s.startsWith("<![CDATA[", p)) {
			const e = s.indexOf("]]>", p + 9);
			if (e < 0) return false;
			run += s.slice(p + 9, e);
			p = e + 3;
		} else if (s.startsWith("<!--", p)) {
			const e = s.indexOf("-->", p + 4);
			if (e < 0) return false;
			p = e + 3;
		} else if (s.startsWith("<?", p)) {
			const e = s.indexOf("?>", p + 2);
			if (e < 0) return false;
			p = e + 2;
		} else if (s.startsWith("</", p)) {
			endRun();
			const e = readEndTag(s, p);
			if (e === null || e.name !== root.name) return false;
			return textRuns === 1;
		} else if (s.startsWith("<!", p)) {
			return false;
		} else {
			endRun();
			const child = readStartTag(s, p);
			if (child === null) return false;
			p = child.selfClosing ? child.end : skipElement(s, child.end, child.name);
			if (p < 0) return false;
		}
	}
}

const STANDARD_CONTEXTUAL_USER_MATCHERS: ReadonlyArray<(text: string) => boolean> = [
	...MARKED_CONTEXTUAL_USER_FRAGMENTS.map(([start, end]) => (text: string) => matchesMarkedText(start, end, text)),
	matchesAdditionalContext,
	matchesInternalModelContext,
	// Legacy warnings still recognised in user-role rollouts (legacy_*.rs matches_text).
	(text) => text.trim().startsWith("Warning: The maximum number of unified exec processes you can keep open is"),
	(text) => {
		const trimmed = text.trim();
		return trimmed.startsWith("Warning: apply_patch was requested via ") && trimmed.endsWith("Use the apply_patch tool instead of exec_command.");
	},
	(text) => text.trim().startsWith("Warning: Your account was flagged for potentially high-risk cyber activity"),
];

/** CONTEXTUAL_USER_FRAGMENT_MATCHERS over InputText (standard matchers only; hook prompts are checked separately). */
export function isStandardContextualUserText(text: string): boolean {
	return STANDARD_CONTEXTUAL_USER_MATCHERS.some((matches) => matches(text));
}

/**
 * event_mapping.rs parse_turn_item for role user: a message whose InputText parts are all hook prompts or standard
 * contextual fragments (with at least one hook prompt) is a HookPrompt; otherwise it is a UserMessage unless some
 * InputText part is contextual. Non-text parts never make a message contextual.
 */
function userMessageRetained(content: Record<string, unknown>[], standard: (text: string) => boolean): boolean {
	let hooks = 0;
	let visible = true;
	for (const part of content) {
		if (part.type !== "input_text") {
			visible = false;
			break;
		}
		const text = String(part.text ?? "");
		if (isHookPromptText(text)) {
			hooks++;
			continue;
		}
		if (standard(text)) continue;
		visible = false;
		break;
	}
	if (visible && hooks > 0) return true;
	return !content.some((p) => p.type === "input_text" && (isHookPromptText(String(p.text ?? "")) || standard(String(p.text ?? ""))));
}

/** is_retained_for_remote_compaction_v2 (compact_remote_v2.rs). */
function isRetained(env: WireEnvelope, flags: Required<CompactFlags>, standard: (t: string) => boolean): boolean {
	if (flags.retainClientToolOutputs && isRetainedToolOutput(env)) return true;
	const item = env.item;
	if (item.type === "agent_message") {
		const content = (Array.isArray(item.content) ? item.content : []) as Record<string, unknown>[];
		const first = content[0];
		const firstText = first?.type === "input_text" ? String(first.text ?? "") : null;
		const author = String(item.author ?? "");
		const recipient = String(item.recipient ?? "");
		const isDescendantProgress =
			author.startsWith(recipient) &&
			author.slice(recipient.length).startsWith("/") &&
			firstText !== null &&
			(firstText.startsWith("Message Type: MESSAGE\n") || firstText.startsWith("Message Type: CHANNEL_POST\n"));
		const isCompletion = firstText !== null && firstText.startsWith("Message Type: FINAL_ANSWER\n");
		return !isDescendantProgress && !isCompletion && estimateItemTokens(item) <= MAX_RETAINED_AGENT_MESSAGE_TOKENS;
	}
	if (item.type !== "message") return false;
	if (item.role === "user") {
		const content = (Array.isArray(item.content) ? item.content : []) as Record<string, unknown>[];
		return userMessageRetained(content, standard);
	}
	if (item.role === "developer") return flags.retainClientDeveloperMessages && isClientDeveloper(env);
	return false;
}

function countImages(item: WireItem): number {
	if (item.type === "function_call_output" && Array.isArray(item.output)) {
		return (item.output as Record<string, unknown>[]).filter((p) => p.type === "input_image").length;
	}
	if (item.type !== "message" || !Array.isArray(item.content)) return 0;
	return (item.content as Record<string, unknown>[]).filter((p) => p.type === "input_image").length;
}

/** message_text_token_count: text only, images and audio 0. */
function messageTextTokens(item: WireItem): number {
	if (item.type !== "message") return estimateItemTokens(item);
	return (item.content as Record<string, unknown>[]).reduce(
		(s, p) => s + (p.type === "input_text" || p.type === "output_text" ? approxTokenCount(String(p.text ?? "")) : 0),
		0,
	);
}

/** message_content_token_count: text plus images (image counted 1844 tokens). */
function messageContentTokens(item: WireItem): number {
	if (item.type !== "message") return estimateItemTokens(item);
	return (item.content as Record<string, unknown>[]).reduce((s, p) => s + contentPartTokens(p), 0);
}

/** truncate_message_text_to_token_budget: middle-truncate text parts, keep images and audio whole. */
function truncateMessageText(env: WireEnvelope, maxTokens: number): WireEnvelope | null {
	if (env.item.type !== "message" || !Array.isArray(env.item.content)) return null;
	let remaining = maxTokens;
	const out: Record<string, unknown>[] = [];
	for (const part of env.item.content as Record<string, unknown>[]) {
		if (part.type === "input_text" || part.type === "output_text") {
			if (remaining === 0) continue;
			let text = String(part.text ?? "");
			const tokens = approxTokenCount(text);
			if (tokens <= remaining) {
				remaining -= tokens;
			} else {
				text = truncateTokens(text, remaining);
				remaining = 0;
			}
			if (text !== "") out.push({ ...part, text });
		} else {
			out.push(part);
		}
	}
	if (out.length === 0) return null;
	return { ...env, item: { ...env.item, content: out } };
}

/** compact_remote_v2_images.rs truncate_message_to_token_budget: image with adjacent labels is atomic. */
function truncateMessageWithImages(env: WireEnvelope, maxTokens: number): WireEnvelope | null {
	if (env.item.type !== "message" || !Array.isArray(env.item.content)) return null;
	const content = [...(env.item.content as Record<string, unknown>[])];
	let remaining = maxTokens;
	const retained: Record<string, unknown>[] = [];
	const textOf = (p: Record<string, unknown> | undefined) => (p && p.type === "input_text" ? String(p.text ?? "") : null);
	while (content.length > 0) {
		const last = content.length - 1;
		let imageIndex: number | null = null;
		if (content[last].type === "input_image") imageIndex = last;
		else if (last > 0 && isImageClose(textOf(content[last]) ?? "") && content[last - 1].type === "input_image") imageIndex = last - 1;
		if (imageIndex !== null) {
			const openText = imageIndex > 0 ? textOf(content[imageIndex - 1]) : null;
			const hasOpen = openText !== null && (isLocalImageOpen(openText) || isImageOpen(openText));
			const start = imageIndex - (hasOpen ? 1 : 0);
			const tokens = content.slice(start).reduce((s, p) => s + contentPartTokens(p), 0);
			const fits = tokens <= remaining;
			remaining = fits ? remaining - tokens : 0;
			const drained = content.splice(start);
			if (fits) for (const p of drained.reverse()) retained.push(p);
			continue;
		}
		const part = content.pop() as Record<string, unknown>;
		if (part.type === "input_text" || part.type === "output_text") {
			if (remaining === 0) continue;
			let text = String(part.text ?? "");
			const tokens = approxTokenCount(text);
			if (tokens <= remaining) {
				remaining -= tokens;
			} else {
				text = truncateTokens(text, remaining);
				remaining = 0;
			}
			if (text !== "") retained.push({ ...part, text });
		} else {
			retained.push(part);
		}
	}
	if (retained.length === 0) return null;
	return { ...env, item: { ...env.item, content: retained.reverse() } };
}

/** truncate_retained_messages over raw items: forms the v2 groups first, then truncates. */
export function truncateRetained(items: WireEnvelope[], maxTokens: number, chargeImagesEnabled: boolean): WireEnvelope[] {
	return truncateGroups(v2Groups(items), maxTokens, chargeImagesEnabled);
}

/** truncate_retained_messages over already formed groups: newest groups first, oldest dropped, image budget optional. */
function truncateGroups(groups: Group[], maxTokens: number, chargeImagesEnabled: boolean): WireEnvelope[] {
	let remaining = maxTokens;
	const reversed: WireEnvelope[] = [];
	for (const group of [...groups].reverse()) {
		if (remaining === 0) continue;
		const clientDeveloper = isClientDeveloper(group.source);
		const chargeImages = chargeImagesEnabled && !clientDeveloper;
		const noticeTokens = group.notice ? Math.max(messageTextTokens(group.notice.item), 1) : 0;
		const contentTokens = chargeImages ? messageContentTokens(group.source.item) : messageTextTokens(group.source.item);
		const sourceTokens = clientDeveloper ? estimateItemTokens(group.source.item) : Math.max(contentTokens, 1);
		const tokenCount = sourceTokens + noticeTokens;
		if (tokenCount <= remaining) {
			if (group.notice) reversed.push(group.notice);
			reversed.push(group.source);
			remaining -= tokenCount;
		} else if (isRetainedToolOutput(group.source)) {
			break;
		} else if (remaining > noticeTokens) {
			const available = remaining - noticeTokens;
			const contentBudget = clientDeveloper ? Math.max(available - Math.max(sourceTokens - contentTokens, 0), 0) : available;
			const imageCount = countImages(group.source.item);
			if (chargeImages && imageCount > 0) remaining = 0;
			let truncated = chargeImages && imageCount > 0 ? truncateMessageWithImages(group.source, contentBudget) : truncateMessageText(group.source, contentBudget);
			if (!truncated) continue;
			if (clientDeveloper) {
				const itemTokens = estimateItemTokens(truncated.item);
				if (itemTokens > available) {
					const adjustedBudget = Math.max(contentBudget - (itemTokens - available) - 1, 0);
					const adjusted = truncateMessageText(truncated, adjustedBudget);
					if (!adjusted || estimateItemTokens(adjusted.item) > available) continue;
					truncated = adjusted;
				}
			}
			if (group.notice) reversed.push(group.notice);
			reversed.push(truncated);
			remaining = 0;
		} else if (chargeImages && countImages(group.source.item) > 0) {
			remaining = 0;
		}
	}
	return reversed.reverse();
}

// ---------- prompt projection (compact_remote_v2_attempt.rs, trim, normalize.rs) ----------

/** trim_function_call_history_to_fit_context_window: rewrites newest-first output tails until the window fits. */
export function trimFunctionCallHistory(
	items: WireEnvelope[],
	contextWindow: number | null,
	baseInstructions: string,
	retainToolOutputs: boolean,
): { items: WireEnvelope[]; rewrittenOutputs: number; deletedTokens: number } {
	if (contextWindow === null) return { items, rewrittenOutputs: 0, deletedTokens: 0 };
	const groups = historyGroups(items);
	const groupTokens = (g: Group) => estimateItemTokens(g.source.item) + (g.notice ? estimateItemTokens(g.notice.item) : 0);
	let estimated = approxTokenCount(baseInstructions) + groups.reduce((s, g) => s + groupTokens(g), 0);
	const initial = estimated;
	const rewritten: WireEnvelope[] = [];
	let consumed = 0;
	for (const group of [...groups].reverse()) {
		if (estimated <= contextWindow) break;
		const count = 1 + (group.notice ? 1 : 0);
		const sourceIndex = items.length - (consumed + count);
		const source = items[sourceIndex];
		const replacement = source && !(retainToolOutputs && isRetainedToolOutput(source)) ? rewriteOutput(source) : null;
		if (!replacement) break;
		estimated = estimated - groupTokens(group) + estimateItemTokens(replacement.item);
		consumed += count;
		rewritten.push(replacement);
	}
	if (rewritten.length === 0) return { items, rewrittenOutputs: 0, deletedTokens: 0 };
	const kept = items.slice(0, items.length - consumed);
	return {
		items: [...kept, ...rewritten.reverse()],
		rewrittenOutputs: rewritten.length,
		deletedTokens: Math.max(initial - estimated, 0),
	};
}

function rewriteOutput(env: WireEnvelope): WireEnvelope | null {
	const item = env.item;
	if (item.type === "function_call_output" || item.type === "custom_tool_call_output") {
		return { ...env, item: { ...item, output: CONTEXT_WINDOW_TRUNCATED_OUTPUT_MESSAGE } };
	}
	if (item.type === "tool_search_output") return { ...env, item: { ...item, tools: [] } };
	return null;
}

/** normalize.rs ensure_call_outputs_present: a call without output gets an "aborted" output (ids not derived). */
function ensureCallOutputs(items: WireEnvelope[]): WireEnvelope[] {
	const fco = new Set<string>();
	const tso = new Set<string>();
	const ctco = new Set<string>();
	for (const { item } of items) {
		if (item.type === "function_call_output" && item.call_id) fco.add(String(item.call_id));
		if (item.type === "tool_search_output" && item.call_id) tso.add(String(item.call_id));
		if (item.type === "custom_tool_call_output") ctco.add(String(item.call_id));
	}
	const out: WireEnvelope[] = [];
	for (const env of items) {
		out.push(env);
		const { item } = env;
		if (item.type === "function_call" && !fco.has(String(item.call_id))) {
			out.push({ item: { type: "function_call_output", call_id: item.call_id, output: "aborted" } });
		} else if (item.type === "tool_search_call" && item.call_id && !tso.has(String(item.call_id))) {
			out.push({ item: { type: "tool_search_output", call_id: item.call_id, status: "completed", execution: "client", tools: [] } });
		} else if (item.type === "custom_tool_call" && !ctco.has(String(item.call_id))) {
			out.push({ item: { type: "custom_tool_call_output", call_id: item.call_id, output: "aborted" } });
		} else if (item.type === "local_shell_call" && item.call_id && !fco.has(String(item.call_id))) {
			out.push({ item: { type: "function_call_output", call_id: item.call_id, output: "aborted" } });
		}
	}
	return out;
}

/** normalize.rs remove_orphan_outputs. */
function removeOrphanOutputs(items: WireEnvelope[]): WireEnvelope[] {
	const calls = new Set<string>();
	const customCalls = new Set<string>();
	const searchCalls = new Set<string>();
	for (const { item } of items) {
		if ((item.type === "function_call" || item.type === "local_shell_call") && item.call_id) calls.add(String(item.call_id));
		if (item.type === "custom_tool_call") customCalls.add(String(item.call_id));
		if (item.type === "tool_search_call" && item.call_id) searchCalls.add(String(item.call_id));
	}
	return items.filter(({ item }) => {
		if (item.type === "function_call_output" && item.call_id) return calls.has(String(item.call_id));
		if (item.type === "custom_tool_call_output") return customCalls.has(String(item.call_id));
		if (item.type === "tool_search_output" && item.call_id && item.execution !== "server") return searchCalls.has(String(item.call_id));
		return true;
	});
}

/** normalize.rs strip_images_when_unsupported / strip_audio_when_unsupported: media becomes a placeholder text part. */
function stripMedia(items: WireEnvelope[], modalities: readonly string[]): WireEnvelope[] {
	const noImage = !modalities.includes("image");
	const noAudio = !modalities.includes("audio");
	const mapParts = (parts: unknown[]) =>
		parts.map((p) => {
			const part = p as Record<string, unknown>;
			if (noImage && part.type === "input_image") return { type: "input_text", text: UNSUPPORTED_IMAGE_TEXT };
			if (noAudio && part.type === "input_audio") return { type: "input_text", text: UNSUPPORTED_AUDIO_TEXT };
			return part;
		});
	return items.map((env) => {
		const item = env.item;
		if (item.type === "message" && Array.isArray(item.content)) {
			return { ...env, item: { ...item, content: mapParts(item.content) } };
		}
		if ((item.type === "function_call_output" || item.type === "custom_tool_call_output") && Array.isArray(item.output)) {
			return { ...env, item: { ...item, output: mapParts(item.output) } };
		}
		if (noImage && item.type === "image_generation_call" && item.result) {
			return { ...env, item: { ...item, result: "" } };
		}
		return env;
	});
}

function countRetainedImages(items: WireEnvelope[]): number {
	return items.reduce((s, e) => s + countImages(e.item), 0);
}

// ---------- compaction ----------

const DEFAULT_FLAGS: Required<CompactFlags> = {
	retainClientDeveloperMessages: false,
	retainClientToolOutputs: false,
	compactionImageBudget: true,
};

/** UUID v7 (48-bit ms timestamp, version 7, RFC 4122 variant). */
export function uuidv7(nowMs: number = Date.now(), random: (n: number) => Uint8Array = (n) => randomBytes(n)): string {
	const bytes = new Uint8Array(16);
	let ts = BigInt(nowMs);
	for (let i = 5; i >= 0; i--) {
		bytes[i] = Number(ts & 0xffn);
		ts >>= 8n;
	}
	bytes.set(random(10).subarray(0, 10), 6);
	bytes[6] = (bytes[6] & 0x0f) | 0x70;
	bytes[8] = (bytes[8] & 0x3f) | 0x80;
	const hex = Buffer.from(bytes).toString("hex");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function abortError(): CompactionError {
	return new CompactionError("aborted", "aborted by caller");
}

/** codex-async-utils backoff(attempt): 200 ms doubling from attempt 1, jitter 0.9..1.1. */
function retryBackoffMs(retryCount: number, random: () => number): number {
	const base = RETRY_INITIAL_DELAY_MS * 2 ** Math.max(retryCount - 1, 0);
	return Math.floor(base * (0.9 + 0.2 * random()));
}

/** Waits for a retry delay; an abort during the wait ends the request as aborted. */
async function waitForRetry(ms: number, signal: AbortSignal | undefined, sleep: CompactOptions["sleep"]): Promise<void> {
	if (signal?.aborted) throw abortError();
	if (sleep) await sleep(ms, signal);
	else await new Promise<void>((resolve) => setTimeout(resolve, ms));
	if (signal?.aborted) throw abortError();
}

/** Reads one stream attempt. Requires output with exactly one compaction item and response.completed. */
async function collectCompaction(
	events: AsyncIterable<WireEvent>,
	signal: AbortSignal | undefined,
): Promise<{ compaction: WireItem; responseId: string; usage: unknown }> {
	let outputCount = 0;
	let compactionCount = 0;
	let compaction: WireItem | null = null;
	let completed: { responseId: string; usage: unknown } | null = null;
	const iterator = events[Symbol.asyncIterator]();
	try {
		while (completed === null) {
			if (signal?.aborted) throw abortError();
			const next = await iterator.next();
			if (next.done) break;
			const event = next.value;
			if (!event || typeof event !== "object" || typeof event.type !== "string") {
				throw new CompactionError("malformed", "stream event without a type");
			}
			switch (event.type) {
				case "output_item_done": {
					outputCount++;
					const item = event.item as WireItem | undefined;
					if (item && item.type === "compaction") {
						compactionCount++;
						compaction ??= item;
					}
					break;
				}
				case "completed":
					completed = { responseId: String(event.responseId ?? ""), usage: event.usage ?? null };
					break;
				case "failed":
					// Native: response.failed is retried only when its error code is a retryable class (server classification).
					throw new CompactionError("failed", String(event.message ?? "response failed"), { retryable: event.retryable === true });
				case "incomplete": {
					const reason = String(event.reason ?? "unknown");
					// Native: incomplete with reason "interrupted" continues as a completed response; content_filter is retryable.
					if (reason === "interrupted") {
						completed = { responseId: String(event.responseId ?? ""), usage: event.usage ?? null };
						break;
					}
					if (reason === "content_filter") throw new CompactionError("stream", "content filter", { retryable: true });
					throw new CompactionError("incomplete", reason);
				}
				case "error":
					throw new CompactionError("stream", String(event.message ?? "stream error"), { retryable: event.retryable === true });
				default:
					break;
			}
		}
	} finally {
		// Release the transport once the terminal event (or a failure) is reached.
		await iterator.return?.().catch(() => undefined);
	}
	if (signal?.aborted) throw abortError();
	if (completed === null) throw new CompactionError("stream", "stream closed before response.completed", { retryable: true });
	const done = completed as { responseId: string; usage: unknown };
	if (done.responseId === "") throw new CompactionError("malformed", "response.completed without response id");
	if (compactionCount !== 1 || compaction === null) {
		throw new CompactionError("malformed", `expected exactly one compaction output item, got ${compactionCount} of ${outputCount} output items`);
	}
	if (typeof compaction.encrypted_content !== "string" || compaction.encrypted_content === "") {
		throw new CompactionError("malformed", "compaction item without encrypted_content");
	}
	return { compaction, responseId: done.responseId, usage: done.usage };
}

type Prepared = {
	compaction: WireItem;
	responseId: string;
	usage: unknown;
	retained: WireEnvelope[];
	retainedImageCount: number;
	sourceDigest: string;
	modelHash: string;
	request: CompactRequest;
};

async function runAttempts(
	options: CompactOptions,
	request: CompactRequest,
	modelHash: string,
	source: WireEnvelope[],
	flags: Required<CompactFlags>,
	standard: (t: string) => boolean,
): Promise<Prepared> {
	const lite = request.useResponsesLite;
	const toolsInHistory = lite && source.some((e) => e.item.type === "additional_tools");
	const baseText = toolsInHistory ? "" : (request.baseInstructions ?? "");

	// Prompt projection: trim by window, normalize call outputs and media (Pi placeholder rule, native order).
	const trimmed = trimFunctionCallHistory(source, request.contextWindow, baseText, flags.retainClientToolOutputs);
	const normalized = stripMedia(removeOrphanOutputs(ensureCallOutputs(trimmed.items)), request.inputModalities);
	const sourceDigest = sha256Hex(canonicalJson(normalized.map((e) => e.item)));

	// Native order: retention and image/label boundaries run on the projected prompt input (after trim, call-output
	// normalization and media placeholders), so a text-only compaction model never stores or charges raw images.
	// Groups are formed before filtering, so a dropped source takes its attached notice with it.
	const retained = truncateGroups(
		v2Groups(normalized).filter((group) => isRetained(group.source, flags, standard)),
		RETAINED_MESSAGE_TOKEN_BUDGET,
		flags.compactionImageBudget,
	);

	const input: WireItem[] = [];
	if (baseText !== "") input.push({ type: "message", role: "developer", content: [{ type: "input_text", text: baseText }] });
	for (const env of normalized) input.push(env.item);
	input.push({ type: "compaction_trigger" });
	const body: Record<string, unknown> = {
		model: request.model,
		input,
		parallel_tool_calls: !lite,
		tool_choice: "auto",
		store: false,
		stream: true,
		include: ["reasoning.encrypted_content"],
	};
	if (!toolsInHistory) body.tools = request.tools ?? [];
	if (request.reasoning) body.reasoning = request.reasoning;
	if (request.serviceTier !== undefined && request.serviceTier !== null) body.service_tier = request.serviceTier;

	const isRetryable = options.isRetryable ?? ((e: unknown) => (e as { retryable?: unknown })?.retryable === true);
	// Native foreground: min(provider stream_max_retries, 2) per transport. Background: one attempt, no transport switch.
	const background = options.transport === "background";
	const maxRetries = background
		? 0
		: Math.min(options.streamMaxRetries ?? PROVIDER_STREAM_MAX_RETRIES_DEFAULT, COMPACTION_STREAM_RETRIES);
	const random = options.random ?? Math.random;
	let retries = 0;
	let switched = false;
	for (let attempt = 0; ; attempt++) {
		try {
			const events = await options.send({ endpoint: CODEX_ENDPOINT, body, signal: options.signal, attempt });
			const done = await collectCompaction(events, options.signal);
			return {
				compaction: done.compaction,
				responseId: done.responseId,
				usage: done.usage,
				retained,
				retainedImageCount: countRetainedImages(retained),
				sourceDigest,
				modelHash,
				request,
			};
		} catch (error) {
			if (options.signal?.aborted) throw abortError();
			// Terminal classes (aborted, incomplete, malformed, budget, no-native-base) are never retryable.
			const retryable = error instanceof CompactionError ? error.retryable : isRetryable(error);
			if (!retryable) throw error;
			if (retries >= maxRetries && !background && !switched && options.switchTransport?.()) {
				// Changing transport resets the per-transport budget (native try_switch_fallback_transport).
				switched = true;
				retries = 0;
				continue;
			}
			if (retries >= maxRetries) throw error;
			retries++;
			const serverDelay = (error as { retryAfterMs?: unknown }).retryAfterMs;
			const delay = typeof serverDelay === "number" && serverDelay >= 0 ? serverDelay : retryBackoffMs(retries, random);
			await waitForRetry(delay, options.signal, options.sleep);
		}
	}
}

/**
 * Native backend compaction. Installs the result into history only after success; otherwise nothing is written.
 * Throws CompactionError on abort, failure, incomplete response, malformed output, or when no native base exists.
 */
export async function compactBackend(options: CompactOptions): Promise<CompactResult> {
	if (options.signal?.aborted) throw abortError();
	const flags = { ...DEFAULT_FLAGS, ...(options.flags ?? {}) };
	const standard = options.isContextualUserText ?? isStandardContextualUserText;
	const loaded = options.history.load();
	if (loaded.mode !== "native") {
		throw new CompactionError("no-native-base", `native history unavailable (${loaded.reason ?? "unknown"}); Pi history is used`);
	}
	// A transcript without native history needs its built request seeded first (WireHistory.seedBuiltRequest).
	if (loaded.items.length === 0) {
		throw new CompactionError("no-native-base", "no native base on this branch; seed the actually built request first");
	}

	let prepared: Prepared;
	let primaryModelHash: string | undefined;
	try {
		prepared = await runAttempts(options, options.request, options.modelHash, loaded.items, flags, standard);
	} catch (error) {
		const fallback = options.fallback;
		// Only a different model slug is a fallback; the same slug with another hash is not.
		const eligible =
			fallback !== undefined &&
			!(error instanceof CompactionError && ["aborted", "incomplete", "budget"].includes(error.code)) &&
			fallback.request.model !== options.request.model;
		if (!fallback || !eligible) throw error;
		try {
			prepared = await runAttempts(options, fallback.request, fallback.modelHash, loaded.items, flags, standard);
		} catch {
			throw error;
		}
		primaryModelHash = options.modelHash;
	}

	// Synchronous: no await inside the install. Its return is the commit point; nothing signal-related is checked after it.
	const install = (): CompactResult => {
		if (options.signal?.aborted) throw abortError();
		const window: WireWindow = {
			number: options.window.number + 1,
			id: (options.newWindowId ?? (() => uuidv7(options.now?.() ?? Date.now())))(),
		};
		const entryId = options.history.installCompaction({
			responseId: prepared.responseId,
			compaction: prepared.compaction,
			retained: prepared.retained,
			window,
			sourceEntryIds: options.sourceEntryIds ?? [],
			sourceDigest: prepared.sourceDigest,
			modelHash: prepared.modelHash,
			primaryModelHash,
		});
		return {
			installed: true,
			entryId,
			responseId: prepared.responseId,
			window,
			modelHash: prepared.modelHash,
			retainedCount: prepared.retained.length,
			retainedImageCount: prepared.retainedImageCount,
			usage: prepared.usage,
		};
	};
	if (options.withInstallGuard) return options.withInstallGuard(install);
	return install();
}
