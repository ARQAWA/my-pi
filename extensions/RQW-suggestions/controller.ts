// The suggestion lifecycle: runs only on the owner's Ctrl+E (start, or cancel while running), storage and the status.
// Nothing here waits for the model: every run starts after control returns to the terminal.
import type { ExtensionAPI, ExtensionContext, TurnEndEvent } from "@earendil-works/pi-coding-agent";
import { TokenError } from "./codex-prompt.ts";
import { parseSuggestion, type SuggestionContext } from "./context.ts";

export const ACTIVITY = "rqw-suggestions:activity";
export const ACTIVITY_QUERY = "rqw-suggestions:activity-query";
const STATUS_KEY = "rqw-suggestions";
const ABORTED_MS = 2000;
// RQW-statusbar hides STATUS_KEY and draws its own indicator, so the token error has a key of its own.
const TOKEN_ERROR_KEY = "rqw-suggestions-error";
const TOKEN_ERROR_MS = 5000;
const TOKEN_ERROR_TEXT = "Ctrl+E failed: Codex token expired or rejected. Run /login openai-codex";
// Bold, bright red, whatever the theme.
const BRIGHT_RED = "\x1b[1;91m";

/** `abortedUntil` is a `performance.now()` value of this process. */
export type Activity = { sessionId: string; state: "brewing" | "aborted" | "idle"; abortedUntil?: number };

export type Deps = {
	/** The prompt text Codex serves; null when there is none. Rejects when aborted or without a saved login. */
	source: { get(signal: AbortSignal): Promise<{ prompt: string } | null> };
	now(): number;
	/** The ready suggestion changed. */
	changed?(): void;
};

export type Controller = {
	/** The ready suggestion, if any. */
	suggestion(): string | undefined;
	available(): boolean;
	start(ctx: ExtensionContext): void;
	stop(): void;
	/** A turn ended: a new finished answer ends the old request and the old suggestion. Starts nothing. */
	answered(event: TurnEndEvent): void;
	/** The user's Ctrl+E, in every chat state: a running request is cancelled (status aborted), otherwise one starts. */
	toggle(): void;
	/** New work or another model: an unfinished request is dropped without the aborted paint. */
	interrupt(): void;
	/** Another branch: nothing of the old one stays. */
	clear(): void;
};

type Run = { abort: AbortController };

export function createController(pi: ExtensionAPI, context: SuggestionContext, deps: Deps): Controller {
	let ctx: ExtensionContext | undefined;
	let ready: string | undefined;
	let seenAnswer: string | undefined;
	let hasHistory = false;
	let current: Run | undefined;
	let abortedUntil: number | undefined;
	let abortedTimer: ReturnType<typeof setTimeout> | undefined;
	let tokenErrorTimer: ReturnType<typeof setTimeout> | undefined;

	const activity = (): Activity => {
		const sessionId = ctx?.sessionManager.getSessionId() ?? "";
		if (current) return { sessionId, state: "brewing" };
		return abortedUntil === undefined ? { sessionId, state: "idle" } : { sessionId, state: "aborted", abortedUntil };
	};

	/** Stock status line text for the state; RQW-statusbar hides this key and draws its own indicator. */
	function statusText(state: Activity["state"]): string | undefined {
		if (state === "idle" || !ctx) return undefined;
		if (state === "brewing") return "suggestion";
		const theme = ctx.ui.theme;
		// The aborted colour is a background role of the theme, painted here as text.
		const maroon = theme.getBgAnsi("toolErrorBg").replace("\x1b[48;", "\x1b[38;");
		return `${maroon}suggestion aborted\x1b[39m`;
	}

	function publish() {
		if (!ctx) return;
		const state = activity();
		pi.events.emit(ACTIVITY, state);
		deps.changed?.();
		ctx.ui.setStatus(STATUS_KEY, statusText(state.state));
	}

	function clearAborted() {
		if (abortedTimer) clearTimeout(abortedTimer);
		abortedTimer = undefined;
		abortedUntil = undefined;
	}

	function clearTokenError() {
		if (!tokenErrorTimer) return;
		clearTimeout(tokenErrorTimer);
		tokenErrorTimer = undefined;
		ctx?.ui.setStatus(TOKEN_ERROR_KEY, undefined);
	}

	function showTokenError(session: ExtensionContext) {
		clearTokenError();
		session.ui.setStatus(TOKEN_ERROR_KEY, `${BRIGHT_RED}${TOKEN_ERROR_TEXT}\x1b[22;39m`);
		tokenErrorTimer = setTimeout(clearTokenError, TOKEN_ERROR_MS);
	}

	/** An expired or rejected Codex login, from the prompt source or from the Codex model's own answer. */
	function isTokenFailure(error: unknown, session: ExtensionContext): boolean {
		if (error instanceof TokenError) return true;
		const message = error instanceof Error ? error.message : String(error);
		return session.model?.provider === "openai-codex" && /\b401\b|unauthorized/i.test(message);
	}

	/** Ends the live request, if any, without any paint. Later results of it are ignored. */
	function drop(): boolean {
		if (!current) return false;
		const run = current;
		current = undefined;
		run.abort.abort();
		return true;
	}

	const live = (run: Run) => current === run && !run.abort.signal.aborted;

	async function attempt(run: Run, session: ExtensionContext) {
		try {
			if (!live(run)) return;
			const capture = context.capture(session);
			if (!capture) return;
			// The check above and the prompt request have no await between them.
			const served = await deps.source.get(run.abort.signal);
			if (!live(run)) return;
			if (served === null) {
				session.ui.notify("Suggestion prompt is unavailable.", "warning");
				return;
			}
			const message = await context.infer(session, capture, served.prompt, run.abort.signal);
			if (!live(run)) return;
			ready = parseSuggestion(message);
			deps.changed?.();
		} catch (error) {
			if (!live(run)) return;
			if (isTokenFailure(error, session)) showTokenError(session);
			else session.ui.notify(`Suggestion failed: ${error instanceof Error ? error.message : String(error)}`, "warning");
		} finally {
			if (live(run)) {
				current = undefined;
				publish();
			}
		}
	}

	/** Starts one run after control returns to the terminal. */
	function launch(session: ExtensionContext) {
		clearAborted();
		const run: Run = { abort: new AbortController() };
		current = run;
		publish();
		setImmediate(() => { void attempt(run, session); });
	}

	// A footer that starts later, such as after /statusbar on, asks for the state it missed.
	pi.events.on(ACTIVITY_QUERY, (data: unknown) => {
		(data as { offer?(state: Activity): void } | undefined)?.offer?.(activity());
	});

	function updateHistory() {
		const branch = ctx?.sessionManager.getBranch() ?? [];
		hasHistory = branch.some(entry => entry.type === "message" && entry.message.role === "user")
			&& branch.some(entry => entry.type === "message" && entry.message.role === "assistant");
	}

	function stop() {
		if (ctx) pi.events.emit(ACTIVITY, { sessionId: ctx.sessionManager.getSessionId(), state: "idle" } satisfies Activity);
		drop();
		clearAborted();
		clearTokenError();
		ctx?.ui.setStatus(STATUS_KEY, undefined);
		ctx = undefined;
		ready = undefined;
		seenAnswer = undefined;
		hasHistory = false;
		context.release();
	}

	return {
		suggestion: () => ready,
		available: () => Boolean(ctx?.model && hasHistory),
		start(next) {
			stop();
			ctx = next;
			updateHistory();
			context.bind(next);
		},
		stop,
		answered(event) {
			if (!ctx) return;
			if (!hasHistory) updateHistory();
			deps.changed?.();
			if (event.outcome !== "completed" || event.message.role !== "assistant" || event.message.stopReason !== "stop") return;
			if (seenAnswer === event.messageEntryId) return;
			seenAnswer = event.messageEntryId;
			// The new answer ends the old request and the old suggestion for good.
			const wasBrewing = drop();
			ready = undefined;
			deps.changed?.();
			if (wasBrewing) publish();
		},
		toggle() {
			if (!ctx) return;
			if (!drop()) {
				if (hasHistory) launch(ctx);
				return;
			}
			clearAborted();
			abortedUntil = deps.now() + ABORTED_MS;
			abortedTimer = setTimeout(() => { clearAborted(); publish(); }, ABORTED_MS);
			publish();
		},
		interrupt() {
			if (drop()) publish();
		},
		clear() {
			drop();
			clearAborted();
			ready = undefined;
			seenAnswer = undefined;
			updateHistory();
			context.drop();
			deps.changed?.();
			publish();
		},
	};
}
