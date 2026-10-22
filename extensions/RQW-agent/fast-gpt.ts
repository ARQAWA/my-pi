import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// GPT Fast for the children of RQW-agent, subagents and workers (OpenAI priority processing: body.service_tier
// "priority" on every openai-codex request, never on Anthropic). A child inherits its caller's state at start (the main chat's, read with `inheritedFastGpt` from RQW-settings,
// which owns /fast-gpt, through the query channel on `pi.events`; a nested child gets its direct caller's) and keeps
// it for its life unless the caller's `fast_gpt` parameter overrides it. Without RQW-settings nobody answers and
// children stay on the standard tier. This file cannot import RQW-settings.
// TEMPORARY: DECISIONS.md, section Settings, "GPT Fast". Removal: delete this file and its uses, and the `fast_gpt` parameter.
const FAST_GPT_QUERY = "rqw-settings:fast-gpt-query";

export function inheritedFastGpt(events: ExtensionAPI["events"]): boolean {
	const query: { fastGpt?: boolean } = {};
	events.emit(FAST_GPT_QUERY, query);
	return query.fastGpt === true;
}

export function fastGpt(child: ExtensionAPI, enabled: () => boolean): void {
	child.on("before_provider_request", (event, ctx) => {
		const model = ctx.model;
		if (!enabled() || model?.provider !== "openai-codex" || !event.payload || typeof event.payload !== "object" ||
			(event.payload as { model?: unknown }).model !== model.id) return undefined;
		return { ...event.payload, service_tier: "priority" };
	});
}
