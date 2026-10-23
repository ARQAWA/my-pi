// RQW-codex: native compaction over the owned raw transport. createCompactionSender returns the CompactOptions.send
// callback used by compactBackend. Each call is one attempt: it builds the native envelope skeleton once (buildRequest on
// an empty transcript with the actual system prompt and tools, requestKind "compaction"), joins it with the prepared
// history and the single compaction_trigger that compactBackend already built, and sends it through sendRaw exactly once.
// sendRaw runs the final hook, auth and routing once; this module never calls the hooks itself. Raw native events are
// mapped to the normalized events compactBackend reads. The outer retry budget stays in compactBackend.
// Imports: this folder and Node built-ins only.
import type { Api, Context, Model } from "@earendil-works/pi-ai";

import type { CompactOptions, WireEvent } from "./compaction.ts";
import type { CodexIdentity } from "./metadata.ts";
import { CodexError, classifyEvent, normalizeUsage } from "./errors.ts";
import { CODEX_STABLE_FEATURES } from "./profile.ts";
import { LocalRequestError, type CodexStreamOptions, type SendRawOptions } from "./transport.ts";
import { buildRequest, orderBody, prefixContext, type WireItem, type WireModelInfo, type WireOptions, type WireRequest } from "./wire.ts";

export type CompactionSenderArgs = {
	/** The owned transport (CodexThreadTransport) or any object with the same sendRaw contract. */
	transport: { sendRaw(args: SendRawOptions): AsyncIterable<Record<string, unknown>> };
	/** Model of the compaction request (its native record must match `capabilities`). */
	model: Model<Api>;
	/** Actual system prompt and tools of the session; the messages are not used. */
	context: Context;
	/** Caller stream options (onPayload, signal, Fast tier, reasoning). Passed to sendRaw unchanged. */
	options: CodexStreamOptions;
	identity: CodexIdentity;
	capabilities: WireModelInfo;
	/** True when the prepared history already carries a Lite additional_tools item. */
	toolsInHistory: boolean;
	/**
	 * Declared fallback route (previous model of the same compaction). Same context and history as the primary; its own
	 * model, options, identity (same lineage) and native record. Selected only by an exact body.model match; the primary wins
	 * when both carry the same slug.
	 */
	fallback?: {
		model: Model<Api>;
		options: CodexStreamOptions;
		identity: CodexIdentity;
		capabilities: WireModelInfo;
	};
};

/** One declared route: its own native skeleton and prefix, prebuilt once per sender. */
type CompactionRoute = {
	model: Model<Api>;
	options: CodexStreamOptions;
	identity: CodexIdentity;
	skeleton: Record<string, unknown>;
	prefix: WireItem[];
};

function abortError(): Error {
	const error = new Error("Request was aborted");
	error.name = "AbortError";
	return error;
}

function asRecord(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** Same mapping as CodexThreadTransport#wireOptions, so the skeleton matches the turn envelope. */
function wireOptions(options: CodexStreamOptions): WireOptions {
	return {
		reasoningEffort: options.reasoningEffort,
		reasoning: options.reasoning,
		reasoningSummary: options.reasoningSummary,
		serviceTier: options.serviceTier,
		verbosity: options.verbosity,
		reasoningEffortOverride: CODEX_STABLE_FEATURES.reasoningEffortOverride,
	};
}

/**
 * Maps raw native events to the normalized events of compactBackend. The first terminal event ends the stream and closes
 * the transport. Errors thrown by sendRaw (aborts, local refusals, transport failures) propagate unchanged.
 */
async function* mapRawEvents(raw: AsyncIterable<Record<string, unknown>>, signal?: AbortSignal): AsyncGenerator<WireEvent, void, undefined> {
	for await (const event of raw) {
		switch (event.type) {
			case "response.output_item.done":
				// Verbatim: the encrypted compaction item is the backend's own object.
				yield { type: "output_item_done", item: event.item };
				break;
			case "response.completed": {
				const response = asRecord(event.response);
				yield {
					type: "completed",
					responseId: typeof response.id === "string" ? response.id : "",
					usage: normalizeUsage(response.usage) ?? null,
				};
				return;
			}
			case "response.incomplete": {
				const response = asRecord(event.response);
				const error = classifyEvent(event);
				// null from classifyEvent is the interrupted reason, which compactBackend continues as completed.
				const reason = error === null ? "interrupted" : error.kind === "content_filter" ? "content_filter" : (error.reason ?? "unknown");
				yield {
					type: "incomplete",
					reason,
					responseId: typeof response.id === "string" ? response.id : "",
					usage: normalizeUsage(response.usage) ?? null,
				};
				return;
			}
			case "response.failed": {
				const response = asRecord(event.response);
				const error = classifyEvent(event) ?? new CodexError({ kind: "stream" });
				yield {
					type: "failed",
					message: error.message,
					retryable: error.retryable,
					resetAt: error.resetAt ?? null,
					usage: normalizeUsage(response.usage) ?? null,
				};
				return;
			}
			case "error": {
				const error = classifyEvent(event) ?? new CodexError({ kind: "stream" });
				yield { type: "error", message: error.message, retryable: error.retryable, resetAt: error.resetAt ?? null };
				return;
			}
			default:
				break;
		}
	}
	if (signal?.aborted) throw abortError();
	// No terminal event: the attempt is incomplete and may be retried by compactBackend.
	throw new CodexError({ kind: "stream", transport: true });
}

/**
 * Builds the CompactOptions.send callback. The native prefix is the only fresh-prefix producer:
 * - Lite with a Lite additional_tools item already in the history: no fresh additional_tools, no base instructions,
 *   no top-level tools (Lite never sends top-level tools).
 * - Lite without such history: native additional_tools (id at_...) then the developer base-instructions item (id msg_...).
 * - Standard: the developer base-instructions item, and the current top-level tools.
 * Model, reasoning and service tier come from the compaction request when it provides them, otherwise from the skeleton.
 * Every other native common field (store, include, stream, prompt_cache_key, text, client_metadata, ...) is kept.
 */
export function createCompactionSender(args: CompactionSenderArgs): CompactOptions["send"] {
	const { transport, context, toolsInHistory } = args;
	const primary = { model: args.model, options: args.options, identity: args.identity, capabilities: args.capabilities };
	// Each declared route gets its own skeleton and prefix; the primary is registered first, so it wins a shared slug.
	const routes = new Map<string, CompactionRoute>([[primary.model.id, buildRoute(primary, context, toolsInHistory)]]);
	if (args.fallback && !routes.has(args.fallback.model.id)) {
		routes.set(args.fallback.model.id, buildRoute(args.fallback, context, toolsInHistory));
	}

	return async ({ body, signal }) => {
		if (signal?.aborted) throw abortError();
		const route = typeof body.model === "string" ? routes.get(body.model) : undefined;
		if (!route) throw new LocalRequestError("RQW-codex: the compaction model is not a declared route. Request not sent.");
		const { skeleton, prefix } = route;
		const native = orderBody({
			...skeleton,
			model: route.model.id,
			service_tier: body.service_tier ?? skeleton.service_tier,
			reasoning: body.reasoning ?? skeleton.reasoning,
			input: [...prefix, ...(body.input as WireItem[])],
		});
		const raw = transport.sendRaw({
			request: native as unknown as WireRequest,
			model: route.model,
			options: route.options,
			requestKind: "compaction",
			signal,
			// Request-scoped operation identity (turn, root turn, timestamp, compaction metadata); the thread identity is untouched.
			identity: route.identity,
		});
		return mapRawEvents(raw, signal);
	};
}

/** Skeleton (buildRequest on the empty-transcript prefix) and prefix for one route; the history prefix rules are per route. */
function buildRoute(
	route: { model: Model<Api>; options: CodexStreamOptions; identity: CodexIdentity; capabilities: WireModelInfo },
	context: Context,
	toolsInHistory: boolean,
): CompactionRoute {
	const skeleton = buildRequest({
		model: route.model,
		context: prefixContext(context),
		options: wireOptions(route.options),
		capabilities: route.capabilities,
		identity: route.identity,
		requestKind: "compaction",
	}) as unknown as Record<string, unknown>;
	const lite = route.capabilities.use_responses_lite === true;
	const prefix: WireItem[] = lite && toolsInHistory ? [] : (skeleton.input as WireItem[]);
	return { model: route.model, options: route.options, identity: route.identity, skeleton, prefix };
}
