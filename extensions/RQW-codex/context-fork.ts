import { getCurrentTools, normalizeContext, type Api, type AssistantMessage, type Context, type Model, type ThinkingLevel } from "@earendil-works/pi-ai";
import { uuidv7 } from "./compaction.ts";
import { canonicalJson } from "./history.ts";
import { clientMetadata, type CodexIdentity } from "./metadata.ts";
import { CODEX_STABLE_FEATURES } from "./profile.ts";
import { slices } from "./slices.ts";
import { prefixContext, resolveEffort, transcriptItems, type WireItem, type WireModelInfo, type WireRequest } from "./wire.ts";

export const CONTEXT_FORK_CHANNEL = "rqw:context-fork:v1";

/** Shared optional event contract. The offered closure owns its snapshot, never the source session. */
export type ContextForkRequest = {
	sessionId: string;
	model: Model<Api>;
	context: Context;
	reasoning?: ThinkingLevel;
	signal: AbortSignal;
	/** Prepare in small slices that yield to the event loop; the offer is still made synchronously. */
	cooperative?: boolean;
	/** Final refusal: the request must not be answered by any other path. Absent means a plain unanswered request. */
	decline?(reason: string): void;
	offer(infer: () => Promise<AssistantMessage>): void;
};

/** Hands control back to the event loop; injectable so a test can stop preparation between slices. */
export type Pause = () => Promise<void>;
export const nextTurn: Pause = () => new Promise((resolve) => setImmediate(resolve));

/**
 * A cooperative `infer` rejects with this before any model request when the request turned out not to fit its source.
 * The caller may then use its ordinary path; every other rejection is final.
 */
export class ContextForkUnavailable extends Error {
	readonly reason: "context_mismatch" | "unfinished_tool_calls";
	constructor(reason: ContextForkUnavailable["reason"]) {
		super(`RQW-codex: context fork unavailable (${reason}); nothing was sent`);
		this.name = "ContextForkUnavailable";
		this.reason = reason;
	}
}

export type PreparedTurn = { model: Model<Api>; context: Context; body: Record<string, unknown> };

function localTools(tools: unknown): boolean {
	return tools === undefined || Array.isArray(tools) && tools.every((raw) => {
		const tool = raw as { type?: string; tools?: unknown };
		return tool?.type === "function" || tool?.type === "custom" || tool?.type === "namespace" && localTools(tool.tools);
	});
}

export type ForkArgs = {
	turn: PreparedTurn;
	request: ContextForkRequest;
	identity: CodexIdentity;
	capabilities: WireModelInfo;
	/** Called once, right after admission: fixes the history to read and returns its slice-by-slice read of the given responses. */
	bindRawOutputs(): (wanted: ReadonlySet<string>) => Generator<void, ReadonlyMap<string, readonly WireItem[]>>;
};
export type PreparedFork = { model: Model<Api>; context: Context; identity: CodexIdentity; body: WireRequest };

/** A source with hosted tools is refused for good: the request is declined, never answered by another path. */
function hostedTools(body: Record<string, unknown>, request: ContextForkRequest): boolean {
	const input = Array.isArray(body.input) ? (body.input as { type?: string; tools?: unknown }[]) : [];
	const hosted = !localTools(body.tools) || input.some((item) => item.type === "additional_tools" && !localTools(item.tools));
	if (hosted) request.decline?.("unsupported_hosted_tools");
	return hosted;
}

/** Cheap synchronous checks only: nothing here copies or serializes the context. */
function admitted(args: ForkArgs): boolean {
	const { turn, request } = args;
	if (request.signal.aborted || request.model.id !== turn.model.id || request.model.provider !== turn.model.provider || request.model.api !== turn.model.api) return false;
	if (hostedTools(turn.body, request)) return false;
	if (!Array.isArray(turn.body.input) || turn.body.access_programs !== undefined) return false;
	const requested = normalizeContext(request.context).messages;
	return requested.length > normalizeContext(turn.context).messages.length && requested.at(-1)?.role === "user";
}

/** Keep the actual prepared native prefix, then convert only the completed-turn suffix and report instruction. */
function* build(args: ForkArgs, readRaw: ReturnType<ForkArgs["bindRawOutputs"]>): Generator<void, PreparedFork | ContextForkUnavailable["reason"]> {
	const { turn, request, capabilities } = args;
	const base = normalizeContext(turn.context);
	const requested = normalizeContext(request.context).messages;
	let same = true;
	yield* slices(base.messages, (message, i) => same = canonicalJson(requested[i]) === canonicalJson(message));
	if (!same) return "context_mismatch";
	const context: Context = { messages: [] };
	yield* slices(requested, (message) => { context.messages.push(structuredClone(message)); });
	if (canonicalJson(prefixContext(context)) !== canonicalJson(prefixContext(base))) return "context_mismatch";

	// Copy key by key to keep the wire key order; only the input list is cut into slices.
	const body: Record<string, any> = {};
	for (const key of Object.keys(turn.body)) body[key] = key === "input" ? [] : structuredClone(turn.body[key]);
	yield* slices(turn.body.input as unknown[], (item) => { body.input.push(structuredClone(item)); });
	const added = context.messages.slice(base.messages.length);
	const wanted = new Set<string>();
	for (const message of added) if (message.role === "assistant" && typeof message.responseId === "string") wanted.add(message.responseId);
	const raw = yield* readRaw(wanted);
	const suffix = transcriptItems({
		context: { messages: added, tools: getCurrentTools(context.messages) },
		model: turn.model,
		capabilities,
		history: { rawOutputs: raw, allowThinkingSignatures: false },
		overrideEnabled: CODEX_STABLE_FEATURES.reasoningEffortOverride,
		incrementalToolsEnabled: false,
		initialSystemAsUpdate: true,
	});
	body.input.push(...suffix);
	const pending = new Set<string>();
	yield* slices(body.input as { type: string; call_id: string }[], (item) => {
		if (item.type === "function_call" || item.type === "custom_tool_call") pending.add(item.call_id);
		if (item.type === "function_call_output" || item.type === "custom_tool_call_output") pending.delete(item.call_id);
	});
	if (pending.size > 0) return "unfinished_tool_calls";
	if (request.reasoning !== undefined) {
		body.reasoning = { ...(body.reasoning as object), effort: resolveEffort({ options: { reasoning: request.reasoning }, model: turn.model, capabilities }) };
	}
	// A new socket has no continuation, even when the source request's hook supplied one.
	delete body.previous_response_id;
	const threadId = uuidv7();
	const identity: CodexIdentity = {
		...structuredClone(args.identity), threadId, windowId: `${threadId}:0`, windowNumber: 0,
		contextWindowId: uuidv7(), turnId: undefined, turnStartedAtUnixMs: undefined,
	};
	body.client_metadata = clientMetadata(identity, "turn");
	return { model: structuredClone(turn.model), context, identity, body: body as unknown as WireRequest };
}

/** All at once, for consumers that are not latency sensitive (the side chat); an unfit request is simply no fork. */
export function prepareContextFork(args: ForkArgs): PreparedFork | undefined {
	if (!admitted(args)) return;
	const steps = build(args, args.bindRawOutputs());
	for (let step = steps.next(); ; step = steps.next()) {
		if (step.done) return typeof step.value === "string" ? undefined : step.value;
	}
}

/** Admits now and returns the slice-by-slice preparation, started only when called; it ends early on abort. */
export function prepareContextForkCooperative(args: ForkArgs, pause: Pause = nextTurn): (() => Promise<PreparedFork>) | undefined {
	if (!admitted(args)) return;
	const signal = args.request.signal;
	const readRaw = args.bindRawOutputs();
	return async () => {
		const steps = build(args, readRaw);
		for (let step = steps.next(); ; step = steps.next()) {
			if (step.done) {
				if (typeof step.value === "string") throw new ContextForkUnavailable(step.value);
				return step.value;
			}
			await pause();
			signal.throwIfAborted();
		}
	};
}
