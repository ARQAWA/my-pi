// Native Codex 0.163.0 Responses request codec (source: codex-rs pinned at rust-v0.163.0).
// Builds the exact wire body from Pi types plus the caller's exact native model record.
// Pi transcripts cannot reproduce every native item; `history.rawOutputs` supplies the raw backend items.
import type { Api, Context, ImageContent, Message, Model, TextContent, Tool, ToolCall } from "@earendil-works/pi-ai";
import {
	getCurrentTools,
	getInitialSystemMessage,
	getSystemMessageText,
	normalizeContext,
	renderSystemMessageUpdate,
} from "@earendil-works/pi-ai";
import { clientMetadata, NAMESPACE_OID, sortKeys, uuidV5, type CodexIdentity, type RequestKind } from "./metadata.ts";
import {
	createGrammarToolInputProperties,
	getGrammarToolInput,
	getJsonSchemaToolParameters,
	resolveGrammarConstrainedSampling,
	resolveJsonSchemaStrictSampling,
} from "./tool-sampling.ts";

export type WireItem = { type: string } & Record<string, unknown>;

/** Exact native `ModelInfo` JSON fields used by the codec (protocol/src/openai_models.rs:408-498). */
export interface WireModelInfo {
	slug: string;
	use_responses_lite?: boolean;
	default_reasoning_level?: string | null;
	supported_reasoning_levels?: { effort: string; description?: string }[];
	supports_reasoning_summary_parameter?: boolean;
	default_reasoning_summary?: "auto" | "concise" | "detailed" | "none";
	support_verbosity?: boolean;
	default_verbosity?: "low" | "medium" | "high" | null;
	service_tiers?: { id: string; name?: string; description?: string }[];
	input_modalities?: string[];
	supports_reasoning_effort_updates?: boolean;
}

/** Pi-side per-request options. Native and simple thinking are separate inputs (see resolveEffort). */
export interface WireOptions {
	/** Explicit native effort (Pi `OpenAICodexResponsesOptions.reasoningEffort`). */
	reasoningEffort?: string;
	/** Explicit native summary (Pi `reasoningSummary`); `null`/undefined uses the model default. */
	reasoningSummary?: "auto" | "concise" | "detailed" | "none" | null;
	/** Simple Pi thinking level (Pi `SimpleStreamOptions.reasoning`), mapped through model.thinkingLevelMap. */
	reasoning?: string;
	/** Pi tier names `fast`/`priority`/`flex`/`default`, or native values. */
	serviceTier?: string;
	verbosity?: "low" | "medium" | "high";
	parallelToolCalls?: boolean;
	/** Stable default is off (codex-rs features/src/lib.rs:1919-1924). */
	reasoningEffortOverride?: boolean;
	/**
	 * `incremental_tools` feature. Stable default is off (profile.ts CODEX_STABLE_FEATURES; oracle feature.incremental_tools_off).
	 * Native incremental notices exist only when this is on AND the model is Responses Lite (world_state.rs:44-56,
	 * step_context.rs:53-61). Off: no mid-transcript tool items or notices; top-level/prefix tools are the current catalog.
	 */
	incrementalTools?: boolean;
	/**
	 * `content_item_kinds` feature. Stable default is on (codex-rs features/src/lib.rs:1141-1146); when on,
	 * native items carry `internal_chat_message_metadata_passthrough.content_item_kinds`, otherwise they are cleared
	 * (core/src/client.rs:1096-1100).
	 */
	contentItemKindsEnabled?: boolean;
}

/** A trusted historical `configuration_update` item and the transcript position it belongs before. */
export interface WireConfigurationUpdate {
	/** Index into `context.messages` (0..messages.length); `messages.length` means after the last message. */
	beforeMessage: number;
	/** Raw native `configuration_update` item, e.g. `{ type, reasoning: { effort } }`. */
	item: WireItem;
}

export interface WireHistory {
	/** Raw completed backend output items keyed by the assistant message `responseId`. Used verbatim. */
	rawOutputs?: ReadonlyMap<string, readonly WireItem[]>;
	/**
	 * Per-window request baseline effort. Caller-owned: set from the first request of a window, reset only after the
	 * caller's successful compaction. A differing request effort appends one configuration_update at the tail.
	 */
	effortPin?: string;
	/** Trusted raw ledger of every historical configuration_update, each at its own transcript position. */
	configurationUpdates?: readonly WireConfigurationUpdate[];
	/**
	 * Default true (bare SDK). false: a Pi thinkingSignature is never replayed as a native reasoning item, because its owner
	 * is unproven; owner-proven raw items (rawOutputs) stay verbatim.
	 */
	allowThinkingSignatures?: boolean;
}

export interface BuildRequestArgs {
	model: Model<Api>;
	context: Context;
	options?: WireOptions;
	capabilities: WireModelInfo;
	identity: CodexIdentity;
	history?: WireHistory;
	requestKind?: RequestKind;
}

export interface WireRequest {
	model: string;
	stream: true;
	service_tier?: string;
	input: WireItem[];
	tools?: unknown[];
	tool_choice: "auto";
	parallel_tool_calls: boolean;
	reasoning: { effort?: string; summary?: string; context?: string };
	store: false;
	include: string[];
	prompt_cache_key?: string;
	text?: { verbosity: string };
	client_metadata: Record<string, string>;
}

// Native body key order: codex-api/src/common.rs:278-306 (routing fields first), WS adds previous_response_id after service_tier.
export const BODY_KEYS = [
	"model", "stream", "service_tier", "previous_response_id", "input", "tools", "tool_choice", "parallel_tool_calls",
	"reasoning", "store", "stream_options", "include", "prompt_cache_key", "text", "generate", "client_metadata", "access_programs",
] as const;

// protocol/src/openai_models.rs:88 and :155 (Ultra <-> "ultra"); advertised by gpt-6.1-sol and gpt-6 in the pinned catalog.
const EFFORTS = new Set(["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"]);

// Native bundled wording for incremental tool notices (prompts/src/model_messages/incremental_tools.rs:40-70).
const TOOL_UPDATE_HINT =
	"This is an incremental tools update. Previously declared tools remain available for direct calls unless explicitly marked unavailable. If a tool is redefined here, its latest definition replaces the earlier one.";
const REMOVED_TOOLS_HEADER = "The following tools are no longer available. Do not call them:";
const REMOVED_NAMESPACES_HEADER =
	"The following namespaces are no longer available. Do not call tools in them unless those tools are declared in a later update:";

export function orderBody(body: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const key of BODY_KEYS) if (body[key] !== undefined) out[key] = body[key];
	for (const key of Object.keys(body)) if (!(key in out) && body[key] !== undefined) out[key] = body[key];
	return out;
}

/** Native base-instruction and additional-tools IDs are payload-derived UUIDv5 under a thread namespace. */
function threadNamespace(threadId: string): string {
	return uuidV5(NAMESPACE_OID, threadId);
}

/** Lone surrogates cannot be UTF-8; native strings never hold them, so they become U+FFFD. */
export function sanitizeText(text: string): string {
	return text.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "\uFFFD");
}

export function resolveEffort(args: { options: WireOptions; model: Model<Api>; capabilities: WireModelInfo }): string | undefined {
	const { options, model, capabilities } = args;
	let simple: string | undefined;
	if (options.reasoning !== undefined) {
		const level = options.reasoning;
		const mapped = model.thinkingLevelMap?.[level as keyof NonNullable<typeof model.thinkingLevelMap>];
		if (mapped === null) throw new Error(`thinking level ${level} is unsupported by ${model.id}`);
		simple = typeof mapped === "string" ? mapped : level === "off" ? "none" : level;
	}
	if (options.reasoningEffort !== undefined && simple !== undefined && options.reasoningEffort !== simple) {
		throw new Error("reasoningEffort and reasoning disagree; pass one");
	}
	const explicit = options.reasoningEffort ?? simple;
	const effort = explicit ?? capabilities.default_reasoning_level ?? undefined;
	if (effort === undefined) return undefined;
	if (effort === "persistent") return "disabled"; // protocol/src/openai_models/reasoning_effort.rs:24-27
	if (!EFFORTS.has(effort)) throw new Error(`unsupported reasoning effort ${effort}`);
	const levels = capabilities.supported_reasoning_levels ?? [];
	if (explicit !== undefined && levels.length > 0 && !levels.some((l) => l.effort === effort)) {
		throw new Error(`reasoning effort ${effort} is not supported by ${capabilities.slug}`);
	}
	return effort;
}

export function resolveServiceTier(tier: string | undefined, capabilities: WireModelInfo): string | undefined {
	if (tier === undefined || tier === "default") return undefined;
	const native = tier === "fast" ? "priority" : tier;
	if (native === "flex") return "flex"; // always accepted: codex-protocol openai_models.rs:1004-1007
	if (!(capabilities.service_tiers ?? []).some((t) => t.id === native)) {
		throw new Error(`service tier ${native} is not advertised by ${capabilities.slug}`);
	}
	return native;
}

/** Pi-side tool support of the model record (pi-ai `compat`): strict mode defaults on, grammar tools default off (convertResponsesTools). */
export interface ToolWireFlags {
	supportsStrictMode: boolean;
	supportsOpenAIGrammarTools: boolean;
}

const DEFAULT_TOOL_FLAGS: ToolWireFlags = { supportsStrictMode: true, supportsOpenAIGrammarTools: false };

export function toolWireFlags(model: Model<Api>): ToolWireFlags {
	const compat = (model as { compat?: Partial<ToolWireFlags> }).compat;
	return {
		supportsStrictMode: compat?.supportsStrictMode ?? DEFAULT_TOOL_FLAGS.supportsStrictMode,
		supportsOpenAIGrammarTools: compat?.supportsOpenAIGrammarTools ?? DEFAULT_TOOL_FLAGS.supportsOpenAIGrammarTools,
	};
}

/**
 * One native tool declaration. Grammar tools become `custom` with a grammar format; JSON-schema tools are `function`
 * with `strict` from constrainedSampling (ordinary tools stay strict false). Unsupported `require` throws locally.
 */
function toolItem(tool: Tool, flags: ToolWireFlags): WireItem {
	const grammar = resolveGrammarConstrainedSampling(tool, flags.supportsOpenAIGrammarTools);
	if (grammar) {
		return { type: "custom", name: tool.name, description: tool.description, format: { type: "grammar", syntax: grammar.format, definition: grammar.definition } } as WireItem;
	}
	const strict = resolveJsonSchemaStrictSampling(tool, flags.supportsStrictMode) ?? false;
	return { type: "function", name: tool.name, description: tool.description, strict, parameters: getJsonSchemaToolParameters(tool, strict) } as WireItem;
}

/**
 * Lite: all tools inside one `functions` namespace, description empty (tool_spec.rs:83-120). Native tool declarations are
 * `serde_json::Value`s, so every object is canonicalized recursively (sorted keys, no value or array order change) before
 * it is hashed or emitted; the independent Codex 0.163.0 capture (test/fixtures/native-prefix.json) is sorted this way.
 */
export function buildTools(tools: readonly Tool[], lite: boolean, flags: ToolWireFlags = DEFAULT_TOOL_FLAGS): unknown[] | undefined {
	if (!lite) return canonicalNativeTools(tools.map((tool) => toolItem(tool, flags)));
	if (tools.length === 0) return undefined;
	return canonicalNativeTools([{ type: "namespace", name: "functions", description: "", tools: tools.map((tool) => toolItem(tool, flags)) }]);
}

/** Recursively key-sorted copy of native tool declarations (serde_json Value object order). */
export function canonicalNativeTools(tools: readonly unknown[]): unknown[] {
	return sortKeys(tools) as unknown[];
}

/**
 * Pure native `additional_tools` fragment (ID = at_ + UUIDv5 of the serialized tools under the thread namespace).
 * `tools` is the native declaration array (custom, namespace and hosted items included), canonicalized recursively
 * before both the ID and the emitted array; no member, value or array element is dropped.
 */
export function additionalToolsItem(threadId: string, tools: readonly unknown[]): WireItem {
	const canonical = canonicalNativeTools(tools);
	return { type: "additional_tools", id: `at_${uuidV5(threadNamespace(threadId), JSON.stringify(canonical))}`, role: "developer", tools: canonical } as WireItem;
}

/**
 * Tool name -> input property for every grammar tool in the transcript's catalog (initial and every system message).
 * Feeds Pi's parser (`grammarToolInputProperties`) so a grammar call's raw input lands in its own property.
 */
export function grammarToolInputProperties(model: Model<Api>, context: Context): ReadonlyMap<string, string> {
	const tools: Tool[] = [...(context.tools ?? [])];
	for (const message of context.messages) if (message.role === "system") tools.push(...(message.toolsAdded ?? []));
	return createGrammarToolInputProperties(tools, toolWireFlags(model).supportsOpenAIGrammarTools);
}

function inputImage(image: ImageContent): WireItem {
	return { type: "input_image", detail: "auto", image_url: `data:${image.mimeType};base64,${image.data}` } as WireItem;
}

function userContent(content: string | (TextContent | ImageContent)[]): WireItem[] {
	if (typeof content === "string") return [{ type: "input_text", text: sanitizeText(content) }];
	return content.map((part) => (part.type === "text" ? { type: "input_text", text: sanitizeText(part.text) } : inputImage(part)));
}

function toolOutput(content: (TextContent | ImageContent)[], imagesAllowed: boolean): unknown {
	const text = content.filter((c): c is TextContent => c.type === "text").map((c) => c.text).join("\n");
	const images = content.filter((c): c is ImageContent => c.type === "image");
	const hasText = text.trim().length > 0;
	if (images.length === 0 || !imagesAllowed) {
		return sanitizeText(hasText ? text : images.length > 0 ? "(see attached image)" : "(no tool output)");
	}
	const out: WireItem[] = [];
	if (hasText) out.push({ type: "input_text", text: sanitizeText(text) });
	for (const image of images) out.push(inputImage(image));
	return out;
}

function splitCallId(id: string): { callId: string; itemId?: string } {
	const bar = id.indexOf("|");
	return bar < 0 ? { callId: id } : { callId: id.slice(0, bar), itemId: id.slice(bar + 1) };
}

function assistantItems(message: Extract<Message, { role: "assistant" }>, grammar: ReadonlyMap<string, string>, allowSignatures = true): WireItem[] {
	const out: WireItem[] = [];
	for (const block of message.content) {
		if (block.type === "thinking") {
			// Pi keeps the encrypted reasoning item JSON in thinkingSignature; replay it as the native item (owner-proven only).
			if (!allowSignatures || !block.thinkingSignature) continue;
			try {
				const item = JSON.parse(block.thinkingSignature) as WireItem;
				if (item && item.type === "reasoning") out.push(item);
			} catch {
				// Not a native reasoning item; nothing to replay.
			}
		} else if (block.type === "text") {
			out.push({ type: "message", role: "assistant", content: [{ type: "output_text", text: sanitizeText(block.text) }], status: "completed" } as WireItem);
		} else if (block.type === "toolCall") {
			out.push(toolCallItem(block, grammar));
		}
	}
	return out;
}

/** Replayed call without a raw item: a grammar tool is `custom_tool_call` with its raw input, otherwise `function_call`. */
function toolCallItem(call: ToolCall, grammar: ReadonlyMap<string, string>): WireItem {
	const property = grammar.get(call.name);
	if (property === undefined) return functionCallItem(call);
	const { callId, itemId } = splitCallId(call.id);
	const item: Record<string, unknown> = { type: "custom_tool_call" };
	if (itemId !== undefined) item.id = itemId;
	item.call_id = callId;
	item.name = call.name;
	item.input = getGrammarToolInput(call.name, call.arguments, property);
	if (call.namespace !== undefined) item.namespace = call.namespace;
	return item as WireItem;
}

function functionCallItem(call: ToolCall): WireItem {
	const { callId, itemId } = splitCallId(call.id);
	const item: Record<string, unknown> = { type: "function_call" };
	if (itemId !== undefined) item.id = itemId;
	item.call_id = callId;
	item.name = call.name;
	item.arguments = JSON.stringify(call.arguments);
	if (call.namespace !== undefined) item.namespace = call.namespace;
	return item as WireItem;
}

/**
 * Request base instructions: the leading system message of Pi's transcript form, rendered as stock Pi renders it
 * (content, then sections). The public shorthand (systemPrompt, tools) is folded there by Pi's own normalizeContext;
 * a transcript that already leads with its system message is used as it is.
 */
function baseInstructions(context: Context): string {
	const initial = getInitialSystemMessage(normalizeContext(context).messages as Message[]);
	return initial ? getSystemMessageText(initial) : "";
}

/**
 * Empty-history input of the request prefix (base instructions and tools), never mutating `context`. The system text is
 * the leading system message's effective text (stock Codex instructions); the tools are the current catalog, or the
 * initial catalog when `incrementalTools` (Lite with incremental_tools, the only mode with mid-transcript tool items).
 * Later system messages are not part of it: they stay transcript items.
 */
export function prefixContext(context: Context, incrementalTools = false): Context {
	const messages = normalizeContext(context).messages as Message[];
	const initial = getInitialSystemMessage(messages);
	return {
		systemPrompt: initial ? getSystemMessageText(initial) : "",
		tools: incrementalTools ? [...(initial?.toolsAdded ?? [])] : getCurrentTools(messages),
		messages: [],
	};
}

/** Developer message carrying a native content kind (ContextualUserFragment::into shape, context-fragments/src/fragment.rs:35-55). */
function kindedDeveloperMessage(text: string, kind: string, kindsEnabled: boolean): WireItem {
	const item: Record<string, unknown> = { type: "message", role: "developer", content: [{ type: "input_text", text: sanitizeText(text) }] };
	if (kindsEnabled) item.internal_chat_message_metadata_passthrough = { content_item_kinds: [kind] };
	return item as WireItem;
}

/** Removes only `content_item_kinds`, dropping the passthrough object when nothing else remains (clear_content_item_kinds). */
function stripContentItemKinds(item: WireItem): WireItem {
	const meta = item.internal_chat_message_metadata_passthrough as Record<string, unknown> | undefined | null;
	if (!meta || typeof meta !== "object" || !("content_item_kinds" in meta)) return item;
	const { content_item_kinds: _dropped, ...rest } = meta;
	const copy: Record<string, unknown> = { ...item };
	if (Object.keys(rest).length === 0) delete copy.internal_chat_message_metadata_passthrough;
	else copy.internal_chat_message_metadata_passthrough = rest;
	return copy as WireItem;
}

type ToolState = Map<string, Tool>;

/**
 * Applies one system message's tool changes in place. Removals apply before additions, so a same-name redefinition
 * is an addition and not a removal. `removed` lists names that existed before and are gone after the message.
 */
function applyToolChanges(state: ToolState, message: Extract<Message, { role: "system" }>): { added: Tool[]; removed: string[]; namespaceRemoved: boolean } {
	const before = new Map(state);
	for (const ref of message.toolsRemoved ?? []) state.delete(ref.name);
	for (const tool of message.toolsAdded ?? []) state.set(tool.name, tool);
	const removed = [...before.keys()].filter((name) => !state.has(name));
	return { added: message.toolsAdded ?? [], removed, namespaceRemoved: before.size > 0 && state.size === 0 };
}

/**
 * Initial catalog: `context.tools` plus the leading system message's tool changes (Pi shorthand folds them there).
 * `leading` false leaves the leading system message out, for a caller that renders it as an update.
 */
function initialToolState(context: Context, leading = true): ToolState {
	const state: ToolState = new Map();
	for (const tool of context.tools ?? []) state.set(tool.name, tool);
	const first = context.messages[0];
	if (leading && first?.role === "system") applyToolChanges(state, first);
	return state;
}

/** Current catalog after every system message in order: the stable top-level `tools` is always this list. */
function currentToolState(context: Context): ToolState {
	const state = initialToolState(context);
	context.messages.forEach((message, index) => {
		if (index > 0 && message.role === "system") applyToolChanges(state, message);
	});
	return state;
}

function removedToolsText(namespaces: string[], tools: string[]): string {
	const sections: [string, string[]][] = [
		[REMOVED_NAMESPACES_HEADER, namespaces],
		[REMOVED_TOOLS_HEADER, tools],
	];
	let body = "";
	for (const [header, names] of sections) {
		if (names.length === 0) continue;
		if (body.length > 0) body += "\n\n";
		body += header;
		for (const name of names) body += `\n- ${name}`;
	}
	return body;
}

/**
 * Lite tool-change items at a later system message: the incremental hint, one additional_tools item with only the
 * added definitions (no id, as native incremental batches), and one removal notice for removed tools. Stable has no
 * mid-transcript tool item; its top-level `tools` always carries the replayed current catalog.
 */
function toolChangeItems(change: { added: Tool[]; removed: string[]; namespaceRemoved: boolean }, kindsEnabled: boolean, flags: ToolWireFlags): WireItem[] {
	const out: WireItem[] = [];
	if (change.added.length > 0) {
		out.push(kindedDeveloperMessage(TOOL_UPDATE_HINT, "tools.incremental_update", kindsEnabled));
		out.push({ type: "additional_tools", role: "developer", tools: buildTools(change.added, true, flags) } as WireItem);
	}
	// Removed members of a removed namespace are subsumed by the namespace notice (top_level_tools.rs render_diff).
	const namespaces = change.namespaceRemoved ? ["functions"] : [];
	const tools = change.namespaceRemoved ? [] : change.removed.map((name) => `functions.${name}`);
	if (namespaces.length > 0 || tools.length > 0) {
		out.push(kindedDeveloperMessage(removedToolsText(namespaces, tools), "tools.removed_definition", kindsEnabled));
	}
	return out;
}

/** Orders the trusted ledger by position (stable for equal positions) and validates every entry; nothing is dropped. */
function orderedLedger(history: WireHistory | undefined, messageCount: number): WireConfigurationUpdate[] {
	const entries = [...(history?.configurationUpdates ?? [])];
	for (const entry of entries) {
		if (!Number.isInteger(entry.beforeMessage) || entry.beforeMessage < 0 || entry.beforeMessage > messageCount) {
			throw new Error(`configuration_update position ${entry.beforeMessage} is outside the transcript`);
		}
		if (entry.item.type !== "configuration_update") throw new Error("configuration ledger entries must be configuration_update items");
	}
	return entries.map((entry, index) => ({ entry, index })).sort((a, b) => a.entry.beforeMessage - b.entry.beforeMessage || a.index - b.index).map((x) => x.entry);
}

function effortOfUpdate(item: WireItem): string | undefined {
	const reasoning = item.reasoning as { effort?: unknown } | undefined;
	return typeof reasoning?.effort === "string" ? reasoning.effort : undefined;
}

/** Pi transcript -> native input items. `rawOutputs` replace reconstructed items for their assistant response. */
export function transcriptItems(args: {
	context: Context;
	model: Model<Api>;
	capabilities: WireModelInfo;
	history?: WireHistory;
	overrideEnabled: boolean;
	contentItemKindsEnabled?: boolean;
	incrementalToolsEnabled: boolean;
	/**
	 * The leading system message is rendered as an update item (its text and tool changes). Default false: it is the
	 * request base, carried by the prefix, so it is not repeated here.
	 */
	initialSystemAsUpdate?: boolean;
}): WireItem[] {
	const { context, model, capabilities, history } = args;
	const kindsEnabled = args.contentItemKindsEnabled ?? true;
	const lite = capabilities.use_responses_lite === true;
	const imagesAllowed = (capabilities.input_modalities ?? ["text", "image"]).includes("image");
	const flags = toolWireFlags(model);
	const grammar = grammarToolInputProperties(model, context);
	// The raw ledger decides a call's native type when it exists; a call without one follows the current grammar map.
	const rawCallTypes = new Map<string, string>();
	for (const items of history?.rawOutputs?.values() ?? []) {
		for (const raw of items) {
			const item = raw as WireItem;
			if ((item.type === "function_call" || item.type === "custom_tool_call") && typeof item.call_id === "string") rawCallTypes.set(item.call_id, item.type);
		}
	}
	const tools = initialToolState(context, !args.initialSystemAsUpdate);
	const ledger = orderedLedger(history, context.messages.length);
	const out: WireItem[] = [];
	const ledgerAt = (position: number) => ledger.filter((entry) => entry.beforeMessage === position).map((entry) => entry.item);

	context.messages.forEach((message, index) => {
		out.push(...ledgerAt(index));
		if (message.role === "user") {
			out.push({ type: "message", role: "user", content: userContent(message.content) } as WireItem);
		} else if (message.role === "assistant") {
			const raw = message.responseId !== undefined ? history?.rawOutputs?.get(message.responseId) : undefined;
			// A raw entry (even an empty one) is the owner's completed items only; no Pi reconstruction on top of it.
			if (raw) out.push(...structuredClone(raw as WireItem[]));
			// Without a raw entry, an aborted or failed message is in progress or partial: skipped entirely.
			else if (message.stopReason === "aborted" || message.stopReason === "error") return;
			else out.push(...assistantItems(message, grammar, history?.allowThinkingSignatures !== false));
		} else if (message.role === "toolResult") {
			const { callId } = splitCallId(message.toolCallId);
			const custom = (rawCallTypes.get(callId) ?? (grammar.has(message.toolName) ? "custom_tool_call" : "function_call")) === "custom_tool_call";
			const output = toolOutput(message.content, imagesAllowed && model.input.includes("image"));
			out.push((custom ? { type: "custom_tool_call_output", call_id: callId, output } : { type: "function_call_output", call_id: callId, output }) as WireItem);
		} else if (message.role === "system") {
			if (index > 0 || args.initialSystemAsUpdate) {
				const text = renderSystemMessageUpdate(message);
				if (text.length > 0) out.push(kindedDeveloperMessage(text, "", false));
				const change = applyToolChanges(tools, message);
				if (lite && args.incrementalToolsEnabled) out.push(...toolChangeItems(change, kindsEnabled, flags));
			}
		}
	});
	out.push(...ledgerAt(context.messages.length));

	// Request copy only: unsupported or disabled overrides drop configuration_update; the stored ledger is never mutated.
	const kept = args.overrideEnabled ? out : out.filter((item) => item.type !== "configuration_update");
	return kindsEnabled ? kept : kept.map(stripContentItemKinds);
}

/**
 * Per-window baseline for the effort override: the caller's pin, or the request's own effort when no pin exists yet.
 * The caller persists the result as `history.effortPin` and resets it only after its successful compaction.
 */
export function windowEffortPin(args: { history?: WireHistory; requestEffort: string | undefined }): string | undefined {
	return args.history?.effortPin ?? args.requestEffort;
}

/** Builds the exact native request body. Nothing is sent; the caller runs onPayload hooks then validateFinalRequest. */
export function buildRequest(args: BuildRequestArgs): WireRequest {
	const { model, context, capabilities, identity, history, requestKind } = args;
	const options = args.options ?? {};
	if (model.id !== capabilities.slug) throw new Error(`model ${model.id} does not match native record ${capabilities.slug}`);
	const lite = capabilities.use_responses_lite === true;
	const kindsEnabled = options.contentItemKindsEnabled ?? true;
	const overrideEnabled = options.reasoningEffortOverride === true && capabilities.supports_reasoning_effort_updates === true;
	const incrementalToolsEnabled = lite && options.incrementalTools === true;
	const ns = threadNamespace(identity.threadId);

	const prefix: WireItem[] = [];
	const tools = buildTools([...(incrementalToolsEnabled ? initialToolState(context) : currentToolState(context)).values()], lite, toolWireFlags(model));
	// Native hashes the serialized tools with serde_json::to_vec (core/src/client.rs:982-993); the tools are Values, so
	// buildTools canonicalizes their object keys (sorted) before the ID and the emission (see buildTools).
	if (lite && tools !== undefined) prefix.push(additionalToolsItem(identity.threadId, tools));
	const base = baseInstructions(context);
	if (base.length > 0) {
		const text = sanitizeText(base);
		// Native: BaseInstructionsFragment with content kind model.base_instructions (core/src/context/base_instructions.rs:26-30).
		const item: Record<string, unknown> = { type: "message", id: `msg_${uuidV5(ns, text)}`, role: "developer", content: [{ type: "input_text", text }] };
		if (kindsEnabled) item.internal_chat_message_metadata_passthrough = { content_item_kinds: ["model.base_instructions"] };
		prefix.push(item as WireItem);
	}

	const input = [...prefix, ...transcriptItems({ context, model, capabilities, history, overrideEnabled, contentItemKindsEnabled: kindsEnabled, incrementalToolsEnabled })];

	const effort = resolveEffort({ options, model, capabilities });
	const summary = options.reasoningSummary ?? capabilities.default_reasoning_summary ?? "auto";
	const reasoning: WireRequest["reasoning"] = {};
	if (effort !== undefined) reasoning.effort = effort;
	if ((capabilities.supports_reasoning_summary_parameter ?? true) && summary !== "none") reasoning.summary = summary;
	if (lite) reasoning.context = "all_turns";

	if (overrideEnabled) {
		// The baseline is the caller pin, moved by every trusted ledger item in position order; only a real change appends.
		let baseline = history?.effortPin;
		for (const entry of orderedLedger(history, context.messages.length)) baseline = effortOfUpdate(entry.item) ?? baseline;
		if (baseline !== undefined && effort !== undefined && effort !== baseline) {
			input.push({ type: "configuration_update", reasoning: { effort } } as WireItem);
		}
	}

	const verbosity = capabilities.support_verbosity ? options.verbosity ?? capabilities.default_verbosity ?? undefined : undefined;
	const tier = resolveServiceTier(options.serviceTier, capabilities);
	const body: Record<string, unknown> = {
		model: capabilities.slug,
		stream: true,
		service_tier: tier,
		input,
		tools: lite ? undefined : tools,
		tool_choice: "auto",
		parallel_tool_calls: !lite && (options.parallelToolCalls ?? true),
		reasoning,
		store: false,
		include: ["reasoning.encrypted_content"],
		prompt_cache_key: identity.rootSessionId,
		text: verbosity ? { verbosity } : undefined,
		client_metadata: clientMetadata(identity, requestKind),
	};
	return orderBody(body) as unknown as WireRequest;
}

const ALLOWED_KEYS = new Set<string>(BODY_KEYS as readonly string[]);

/**
 * Final-body validator, run after onPayload hooks. Rejects unknown or forbidden top-level fields, changed
 * routing that would erase Fast priority, and any tier the native record does not advertise. No fallback.
 */
export function validateFinalRequest(args: { body: Record<string, unknown>; capabilities: WireModelInfo; expectedServiceTier?: string }): void {
	const { body, capabilities } = args;
	for (const key of Object.keys(body)) {
		if (!ALLOWED_KEYS.has(key)) throw new Error(`request field ${key} is not a native Codex field`);
	}
	if (body.model !== capabilities.slug) throw new Error("final model differs from the native record");
	if (body.stream !== true) throw new Error("final request must stream");
	if (body.store !== false) throw new Error("final request must set store false");
	if (!Array.isArray(body.include) || !body.include.includes("reasoning.encrypted_content")) {
		throw new Error("final request must include reasoning.encrypted_content");
	}
	if (!Array.isArray(body.input)) throw new Error("final input must be an array");
	const tier = body.service_tier;
	if (tier !== undefined) {
		if (typeof tier !== "string") throw new Error("service_tier must be a string");
		if (tier !== "flex" && !(capabilities.service_tiers ?? []).some((t) => t.id === tier)) {
			throw new Error(`final service_tier ${tier} is not advertised by ${capabilities.slug}`);
		}
	}
	if (args.expectedServiceTier !== undefined && tier !== args.expectedServiceTier) {
		throw new Error(`service_tier ${args.expectedServiceTier} was changed or removed by a hook`);
	}
	const meta = body.client_metadata;
	if (meta !== undefined && (typeof meta !== "object" || meta === null || Object.values(meta).some((v) => typeof v !== "string"))) {
		throw new Error("client_metadata values must be strings");
	}
}
