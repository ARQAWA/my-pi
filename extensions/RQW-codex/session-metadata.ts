// RQW-codex: pure producers of the session-derived identity fields (policy, history initialization, request metadata).
// Each function reads its inputs only; nothing is stored, sent or written. Imports: this folder, Pi SDK and pi-ai types.
import type { Api, Context, Model } from "@earendil-works/pi-ai";
import { convertToLlm, sessionEntryToContextMessages, type AgentSession, type SessionEntry } from "@earendil-works/pi-coding-agent";

import type { CodexIdentity, HistoryInitialization, ToolNamespacesInfo } from "./metadata.ts";
import { CODEX_STABLE_FEATURES } from "./profile.ts";
import { prefixContext, resolveEffort, type WireOptions } from "./wire.ts";
import { wireCapabilities, type CodexStreamOptions } from "./transport.ts";

/** Session policy the local Pi runtime actually has: no sandbox, no auto review, subscription auth. */
export const SESSION_POLICY_METADATA: Readonly<Partial<CodexIdentity>> = Object.freeze({
	authProfile: "subscription",
	sandbox: "none",
	sandboxMode: "danger-full-access",
	autoReviewEnabled: false,
});

/** Structural SessionManager surface used here (Pi's SessionManager satisfies it). */
type HistoryManager = {
	getHeader(): { parentSession?: string } | null;
	getBranch(): SessionEntry[];
	buildSessionProjection(): { messages: unknown[] };
};

/**
 * Native history initialization of this session. Effective content is Pi's projection converted to LLM messages (system
 * messages excluded). A session with no effective content is `new` when no raw branch entry was ever model-visible and
 * `cleared` otherwise. Otherwise a parent-session header with an adopted base is `cold_fork`, an own base is
 * `cold_resume`, and anything else is `supplied_history`.
 */
export function inferHistoryInitialization(
	session: AgentSession,
	native: { ownBase: boolean; adoptedBase: boolean },
): HistoryInitialization {
	const manager = session.sessionManager as unknown as HistoryManager;
	const effective = convertToLlm(manager.buildSessionProjection().messages as never).filter((m) => m.role !== "system");
	if (effective.length === 0) {
		const pastVisible = manager
			.getBranch()
			.some((entry) => sessionEntryToContextMessages(entry).some((m) => m.role !== "system"));
		return pastVisible ? "cleared" : "new";
	}
	if (Boolean(manager.getHeader()?.parentSession) && native.adoptedBase) return "cold_fork";
	if (native.ownBase) return "cold_resume";
	return "supplied_history";
}

/**
 * Request-scoped metadata from the actual declared catalog (prefix tools of the public context) and the actual effort the
 * wire codec resolves. Tools are exposed only as harness functions; nothing is inferred from names.
 */
export function requestMetadata(
	model: Model<Api>,
	context: Context,
	options: CodexStreamOptions = {},
): Pick<CodexIdentity, "toolNamespacesInfo" | "extra"> {
	const functions: ToolNamespacesInfo[string]["functions"] = Object.fromEntries(
		(prefixContext(context, false).tools ?? []).map((tool) => [
			tool.name,
			{ name: tool.name, direct: true, deferred: false, source: { kind: "harness" as const } },
		]),
	);
	const wire: WireOptions = {
		reasoningEffort: options.reasoningEffort,
		reasoning: options.reasoning,
		reasoningSummary: options.reasoningSummary,
		serviceTier: options.serviceTier,
		verbosity: options.verbosity,
		reasoningEffortOverride: CODEX_STABLE_FEATURES.reasoningEffortOverride,
	};
	const effort = resolveEffort({ options: wire, model, capabilities: wireCapabilities(model) });
	const extra: Record<string, string> = { model: model.id };
	if (effort !== undefined) extra.reasoning_effort = effort;
	return {
		toolNamespacesInfo: { functions: { name: "functions", functions } },
		extra,
	};
}
