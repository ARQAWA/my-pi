// Adapted from extensions/RQW-codex/wire.ts at git commit a85b810e924010f35387045fc0cbbd9a1e7173cc.
// Narrowed extraction: initial text-only Responses Lite requests, reserved native declarations and final-body validation.
import type { Api, Context, Model } from "@earendil-works/pi-ai";
import { clientMetadata, NAMESPACE_OID, sortKeys, uuidV5, type CodexIdentity, type RequestKind } from "./metadata.ts";

export type WireItem = { type: string } & Record<string, unknown>;
export interface WireModelInfo {
	slug: string;
	use_responses_lite?: boolean;
	default_reasoning_level?: string | null;
	supported_reasoning_levels?: { effort: string; description?: string }[];
	supports_reasoning_summary_parameter?: boolean;
	default_reasoning_summary?: "auto" | "concise" | "detailed" | "none";
	support_verbosity?: boolean;
	default_verbosity?: "low" | "medium" | "high" | null;
}
interface WireOptions {
	reasoningEffort?: string;
	reasoningSummary?: "auto" | "concise" | "detailed" | "none" | null;
	verbosity?: "low" | "medium" | "high";
}
interface BuildRequestArgs {
	model: Model<Api>;
	context: Context;
	options?: WireOptions;
	capabilities: WireModelInfo;
	identity: CodexIdentity;
	requestKind?: RequestKind;
}
export interface WireRequest {
	model: string;
	stream: true;
	input: WireItem[];
	tool_choice: "auto";
	parallel_tool_calls: false;
	reasoning: { effort?: string; summary?: string; context: string };
	store: false;
	include: string[];
	prompt_cache_key: string;
	text?: { verbosity: string };
	client_metadata: Record<string, string>;
}

const BODY_KEYS = [
	"model", "stream", "input", "tool_choice", "parallel_tool_calls",
	"reasoning", "store", "include", "prompt_cache_key", "text", "client_metadata",
] as const;

function orderBody(body: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const key of BODY_KEYS) if (body[key] !== undefined) out[key] = body[key];
	for (const key of Object.keys(body)) if (!(key in out) && body[key] !== undefined) out[key] = body[key];
	return out;
}

function threadNamespace(threadId: string): string {
	return uuidV5(NAMESPACE_OID, threadId);
}

function sanitizeText(text: string): string {
	return text.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "\uFFFD");
}

export function canonicalNativeTools(tools: readonly unknown[]): unknown[] {
	return sortKeys(tools) as unknown[];
}

export function additionalToolsItem(threadId: string, tools: readonly unknown[]): WireItem {
	const canonical = canonicalNativeTools(tools);
	return { type: "additional_tools", id: `at_${uuidV5(threadNamespace(threadId), JSON.stringify(canonical))}`, role: "developer", tools: canonical };
}

/** Web research builds only its initial text target; subsequent native output is replayed verbatim by the engine. */
export function buildRequest(args: BuildRequestArgs): WireRequest {
	const { model, context, capabilities, identity, requestKind } = args;
	const options = args.options ?? {};
	if (model.id !== capabilities.slug || capabilities.use_responses_lite !== true) throw new Error("invalid native web model");
	if (context.tools?.length) throw new Error("web-only requests use the reserved native declaration");
	const input: WireItem[] = [];
	const base = context.systemPrompt ?? "";
	if (base.length > 0) {
		const text = sanitizeText(base);
		input.push({ type: "message", id: `msg_${uuidV5(threadNamespace(identity.threadId), text)}`, role: "developer",
			content: [{ type: "input_text", text }], internal_chat_message_metadata_passthrough: { content_item_kinds: ["model.base_instructions"] } });
	}
	for (const message of context.messages) {
		if (message.role !== "user" || typeof message.content !== "string") throw new Error("web initial target must be user text");
		input.push({ type: "message", role: "user", content: [{ type: "input_text", text: sanitizeText(message.content) }] });
	}
	const effort = options.reasoningEffort ?? capabilities.default_reasoning_level;
	if (!effort || !(capabilities.supported_reasoning_levels ?? []).some(level => level.effort === effort)) throw new Error("unsupported reasoning effort");
	const summary = options.reasoningSummary ?? capabilities.default_reasoning_summary ?? "auto";
	const reasoning: WireRequest["reasoning"] = { effort, context: "all_turns" };
	if ((capabilities.supports_reasoning_summary_parameter ?? true) && summary !== "none") reasoning.summary = summary;
	const verbosity = capabilities.support_verbosity ? options.verbosity ?? capabilities.default_verbosity : undefined;
	// Deliberately no service tier or profile default: web research must never request Fast.
	return orderBody({ model: capabilities.slug, stream: true, input, tool_choice: "auto", parallel_tool_calls: false,
		reasoning, store: false, include: ["reasoning.encrypted_content"], prompt_cache_key: identity.rootSessionId,
		text: verbosity ? { verbosity } : undefined, client_metadata: clientMetadata(identity, requestKind) }) as unknown as WireRequest;
}

const ALLOWED_KEYS = new Set<string>(BODY_KEYS);
export function validateFinalRequest(args: { body: Record<string, unknown>; capabilities: WireModelInfo }): void {
	const { body, capabilities } = args;
	for (const key of Object.keys(body)) if (!ALLOWED_KEYS.has(key)) throw new Error(`request field ${key} is not a native web field`);
	if (body.model !== capabilities.slug || capabilities.use_responses_lite !== true) throw new Error("invalid native web model");
	if (body.stream !== true || body.store !== false || body.parallel_tool_calls !== false) throw new Error("invalid native web stream flags");
	if (!Array.isArray(body.input) || !Array.isArray(body.include) || !body.include.includes("reasoning.encrypted_content")) throw new Error("invalid native web input");
	const meta = body.client_metadata;
	if (meta !== undefined && (typeof meta !== "object" || meta === null || Object.values(meta).some(value => typeof value !== "string"))) throw new Error("client_metadata values must be strings");
}
