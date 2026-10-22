import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// GPT Fast: OpenAI priority processing (Codex CLI maps Fast to service_tier "priority"). While it is on, every
// openai-codex request of the MAIN chat gets body.service_tier = "priority"; Anthropic requests are never touched.
// RQW-settings owns the main chat's rule and /fast-gpt because it is the harness-settings extension: a request-level
// default that holds regardless of user config. Children (RQW-agent's subagents and workers, RQW-review's reviewers)
// do not follow this switch live: each reads the caller's state once, when it starts, through the query channel
// below, and applies its own rule in its own extension (they cannot import this file).
// DECISIONS.md, section Settings, "GPT Fast".

/** Default off: the owner turns GPT Fast on with /fast-gpt on. */
export const FAST_GPT_DEFAULT = false;

/** Request channel on `pi.events`: the handler fills `request.fastGpt` synchronously. No handler: GPT Fast is off. */
export const FAST_GPT_QUERY = "rqw-settings:fast-gpt-query";
/** Notification channel on `pi.events`: `{ on: boolean }` after every change, for the status bar. */
export const FAST_GPT_CHANGED = "rqw-settings:fast-gpt";

// Process-wide so /fast-gpt survives /reload and new sessions; not persisted across restarts, as /statusbar is not.
const STATE = Symbol.for("rqw-settings/fast-gpt");
type Holder = { [STATE]?: { on: boolean } };

const state = () => ((globalThis as Holder)[STATE] ??= { on: FAST_GPT_DEFAULT });

export function isFastGpt(): boolean {
	return state().on;
}

/** Set the service tier on an openai-codex request payload; any other provider's payload is left alone. */
export function withPriority(payload: unknown, model: { provider: string; id: string } | undefined): unknown {
	if (model?.provider !== "openai-codex" || !payload || typeof payload !== "object" ||
		(payload as { model?: unknown }).model !== model.id) return undefined;
	return { ...payload, service_tier: "priority" };
}

export function installFastGpt(pi: ExtensionAPI): void {
	let unsubscribe: (() => void) | undefined;
	const subscribe = () => {
		unsubscribe ??= pi.events.on(FAST_GPT_QUERY, (query) => { (query as { fastGpt?: boolean }).fastGpt = isFastGpt(); });
	};
	subscribe();
	pi.on("session_start", subscribe);
	pi.on("session_shutdown", () => { unsubscribe?.(); unsubscribe = undefined; });

	pi.on("before_provider_request", (event, ctx) => isFastGpt() ? withPriority(event.payload, ctx.model) : undefined);

	pi.registerCommand("fast-gpt", {
		description: "GPT Fast for the main chat (OpenAI priority processing, GPT only): /fast-gpt [on|off]",
		handler: async (args, ctx) => {
			const value = args.trim();
			if (value && value !== "on" && value !== "off") {
				ctx.ui.notify("Usage: /fast-gpt [on|off]", "warning");
				return;
			}
			state().on = value ? value === "on" : !state().on;
			pi.events.emit(FAST_GPT_CHANGED, { on: state().on });
			ctx.ui.notify(`GPT Fast ${state().on ? "on" : "off"} (main chat, GPT only)`, "info");
		},
	});
}
