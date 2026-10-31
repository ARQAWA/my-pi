// The prediction lifecycle: runs only on the owner's Ctrl+E, storage, cancel and the status.
// Nothing here waits for the model: every run starts after control returns to the terminal.
import type { ExtensionAPI, ExtensionContext, TurnEndEvent } from "@earendil-works/pi-coding-agent";
import { parseSuggestion, type PredictionContext } from "./context.ts";

export const ACTIVITY = "rqw-predictions:activity";
export const ACTIVITY_QUERY = "rqw-predictions:activity-query";
const STATUS_KEY = "rqw-predictions";
const ABORTED_MS = 2000;

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
	start(ctx: ExtensionContext): void;
	stop(): void;
	/** A turn ended: a new finished answer ends the old request and the old suggestion. Starts nothing. */
	answered(ctx: ExtensionContext, event: TurnEndEvent): void;
	/** The user's own request to generate. Does nothing while the chat works, has queued messages or a request runs. */
	generate(): void;
	/** The user's own cancel. Paints the status aborted; does nothing without an active request. */
	cancel(): void;
	/** New work or another model: an unfinished request is dropped without the aborted paint. */
	interrupt(): void;
	/** Another branch: nothing of the old one stays. */
	clear(): void;
};

type Run = { id: number; abort: AbortController };

export function createController(pi: ExtensionAPI, context: PredictionContext, deps: Deps): Controller {
	let ctx: ExtensionContext | undefined;
	let ready: string | undefined;
	let seenAnswer: string | undefined;
	let current: Run | undefined;
	let generation = 0;
	let abortedUntil: number | undefined;
	let abortedTimer: ReturnType<typeof setTimeout> | undefined;
	// Set when the footer's own consumer asks for the state; without one the stock status line shows it.
	let consumer = false;

	const activity = (): Activity => {
		const sessionId = ctx?.sessionManager.getSessionId() ?? "";
		if (current) return { sessionId, state: "brewing" };
		return abortedUntil === undefined ? { sessionId, state: "idle" } : { sessionId, state: "aborted", abortedUntil };
	};

	/** Stock footer text for the state, for a chat without the footer consumer. */
	function statusText(state: Activity["state"]): string | undefined {
		if (state === "idle" || !ctx) return undefined;
		if (state === "brewing") return "prediction";
		const theme = ctx.ui.theme;
		// The aborted colour is a background role of the theme, painted here as text.
		const maroon = theme.getBgAnsi("toolErrorBg").replace("\x1b[48;", "\x1b[38;");
		return `${maroon}prediction aborted\x1b[39m`;
	}

	function publish() {
		if (!ctx) return;
		const state = activity();
		pi.events.emit(ACTIVITY, state);
		if (!consumer) ctx.ui.setStatus(STATUS_KEY, statusText(state.state));
	}

	function clearAborted() {
		if (abortedTimer) clearTimeout(abortedTimer);
		abortedTimer = undefined;
		abortedUntil = undefined;
	}

	/** Ends the live request, if any, without any paint. Later results of it are ignored. */
	function drop(): boolean {
		if (!current) return false;
		const run = current;
		current = undefined;
		generation++;
		run.abort.abort();
		return true;
	}

	const live = (run: Run) => current === run && !run.abort.signal.aborted;

	async function attempt(run: Run, session: ExtensionContext) {
		try {
			if (!live(run) || session.hasPendingMessages()) return;
			const capture = context.capture(session);
			if (!capture) return;
			// The check above and the prompt request have no await between them.
			const served = await deps.source.get(run.abort.signal);
			if (!live(run) || session.hasPendingMessages()) return;
			if (served === null) {
				session.ui.notify("Prediction prompt is unavailable.", "warning");
				return;
			}
			const message = await context.infer(session, capture, served.prompt, run.abort.signal);
			if (!live(run)) return;
			ready = parseSuggestion(message);
			deps.changed?.();
		} catch (error) {
			if (live(run)) session.ui.notify(`Prediction failed: ${error instanceof Error ? error.message : String(error)}`, "warning");
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
		const run: Run = { id: ++generation, abort: new AbortController() };
		current = run;
		publish();
		setImmediate(() => { void attempt(run, session); });
	}

	pi.events.on(ACTIVITY_QUERY, (data: unknown) => {
		consumer = true;
		(data as { offer?(state: Activity): void } | undefined)?.offer?.(activity());
		// The footer shows it now; remove a stock line shown before the footer asked.
		ctx?.ui.setStatus(STATUS_KEY, undefined);
	});

	function stop() {
		if (ctx) pi.events.emit(ACTIVITY, { sessionId: ctx.sessionManager.getSessionId(), state: "idle" } satisfies Activity);
		drop();
		clearAborted();
		ctx?.ui.setStatus(STATUS_KEY, undefined);
		ctx = undefined;
		ready = undefined;
		seenAnswer = undefined;
		context.release();
	}

	return {
		suggestion: () => ready,
		start(next) {
			stop();
			ctx = next;
			context.bind(next);
		},
		stop,
		answered(_session, event) {
			if (!ctx) return;
			if (event.outcome !== "completed" || event.message.role !== "assistant" || event.message.stopReason !== "stop") return;
			if (seenAnswer === event.messageEntryId) return;
			seenAnswer = event.messageEntryId;
			// The new answer ends the old request and the old suggestion for good.
			const wasBrewing = drop();
			ready = undefined;
			deps.changed?.();
			if (wasBrewing) publish();
		},
		generate() {
			if (!ctx || current || !ctx.isIdle() || ctx.hasPendingMessages() || !context.hasAnswer(ctx)) return;
			launch(ctx);
		},
		cancel() {
			if (!drop()) return;
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
			context.drop();
			deps.changed?.();
			publish();
		},
	};
}
