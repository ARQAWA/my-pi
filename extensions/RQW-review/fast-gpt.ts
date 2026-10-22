import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// GPT Fast for one reviewer session (OpenAI priority processing: body.service_tier "priority" on every openai-codex
// request, never on Anthropic). A reviewer inherits the main chat's state: `inheritedFastGpt` reads it once, when the
// reviewer starts, from RQW-settings (which owns /fast-gpt) through the query channel on the parent's `pi.events`;
// the session keeps that value for its life. Without RQW-settings nobody answers and the reviewer stays on the
// standard tier. This file cannot import RQW-settings.
// DECISIONS.md, section Settings, "GPT Fast".
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
