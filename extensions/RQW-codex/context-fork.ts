import { getCurrentTools, normalizeContext, type Api, type AssistantMessage, type Context, type Model, type ThinkingLevel } from "@earendil-works/pi-ai";
import { uuidv7 } from "./compaction.ts";
import { canonicalJson } from "./history.ts";
import { clientMetadata, type CodexIdentity } from "./metadata.ts";
import { CODEX_STABLE_FEATURES } from "./profile.ts";
import { prefixContext, resolveEffort, transcriptItems, type WireItem, type WireModelInfo, type WireRequest } from "./wire.ts";

export const CONTEXT_FORK_CHANNEL = "rqw:context-fork:v1";

/** Shared optional event contract. The offered closure owns its snapshot, never the source session. */
export type ContextForkRequest = {
	sessionId: string;
	model: Model<Api>;
	context: Context;
	reasoning?: ThinkingLevel;
	signal: AbortSignal;
	offer(infer: () => Promise<AssistantMessage>): void;
};

export type PreparedTurn = { model: Model<Api>; context: Context; body: Record<string, unknown> };

function localTools(tools: unknown): boolean {
	return tools === undefined || Array.isArray(tools) && tools.every((raw) => {
		const tool = raw as { type?: string; tools?: unknown };
		return tool?.type === "function" || tool?.type === "custom" || tool?.type === "namespace" && localTools(tool.tools);
	});
}

/** Keep the actual prepared native prefix, then convert only the completed-turn suffix and report instruction. */
export function prepareContextFork(args: {
	turn: PreparedTurn;
	request: ContextForkRequest;
	identity: CodexIdentity;
	capabilities: WireModelInfo;
	rawOutputs: ReadonlyMap<string, readonly WireItem[]>;
}) {
	const { turn, request, capabilities } = args;
	if (request.signal.aborted || request.model.id !== turn.model.id || request.model.provider !== turn.model.provider || request.model.api !== turn.model.api) return;
	const base = normalizeContext(turn.context);
	const context = structuredClone(normalizeContext(request.context));
	if (context.messages.length <= base.messages.length || context.messages.at(-1)?.role !== "user") return;
	if (canonicalJson(context.messages.slice(0, base.messages.length)) !== canonicalJson(base.messages)) return;
	if (canonicalJson(prefixContext(context)) !== canonicalJson(prefixContext(base))) return;

	const body = structuredClone(turn.body);
	if (!Array.isArray(body.input) || !localTools(body.tools) || body.access_programs !== undefined) return;
	if (body.input.some((item) => item.type === "additional_tools" && !localTools(item.tools))) return;
	const suffix = transcriptItems({
		context: { messages: context.messages.slice(base.messages.length), tools: getCurrentTools(context.messages) },
		model: turn.model,
		capabilities,
		history: { rawOutputs: structuredClone(args.rawOutputs), allowThinkingSignatures: false },
		overrideEnabled: CODEX_STABLE_FEATURES.reasoningEffortOverride,
		incrementalToolsEnabled: false,
		initialSystemAsUpdate: true,
	});
	body.input.push(...suffix);
	const pending = new Set<string>();
	for (const item of body.input) {
		if (item.type === "function_call" || item.type === "custom_tool_call") pending.add(item.call_id);
		if (item.type === "function_call_output" || item.type === "custom_tool_call_output") pending.delete(item.call_id);
	}
	if (pending.size > 0) return;
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
