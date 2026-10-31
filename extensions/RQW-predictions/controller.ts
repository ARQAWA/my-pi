// The prediction lifecycle: one automatic attempt per finished answer, manual runs, storage, cancel and the status.
// Nothing here waits for the model: every run starts after control returns to the terminal.
import type { ExtensionAPI, ExtensionContext, TurnEndEvent } from "@earendil-works/pi-coding-agent";
import { parsePiece, parseSuggestion, type Draft, type PredictionContext } from "./context.ts";

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
	/** A turn ended: one automatic attempt for each new finished answer. */
	answered(ctx: ExtensionContext, event: TurnEndEvent): void;
	/** The few words to insert at the cursor of the draft they were asked for, if any. */
	piece(): Piece | undefined;
	/** The user's own request to generate. Does nothing while the chat works, has queued messages or a request runs. */
	generate(): void;
	/** The user's own request for a piece at the cursor of a non-empty draft; the same conditions as `generate`. */
	continueDraft(draft: Draft): void;
	/** A piece was taken: the next one for the new draft, started at once and quiet when it fails. */
	chain(draft: Draft): void;
	/** The editor's draft key now. A piece or a piece request for another key is dropped quietly, for good. */
	moved(key: () => string): void;
	/** The user's own cancel. Paints the status aborted when a request ran; a shown piece is removed. */
	cancel(): void;
	/** New work or another model: an unfinished request and a shown piece are dropped without the aborted paint. */
	interrupt(): void;
	/** Another branch: nothing of the old one stays. */
	clear(): void;
};

/** A piece of text and the key of the draft it was asked for. */
export type Piece = { text: string; key: string };
/** `key` is set for a piece request: the draft it was asked for. */
type Run = { id: number; abort: AbortController; key?: string };

export function createController(pi: ExtensionAPI, context: PredictionContext, deps: Deps): Controller {
	let ctx: ExtensionContext | undefined;
	let ready: string | undefined;
	let piece: Piece | undefined;
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

	/** Removes the shown piece, if any; the screen is told. */
	function dismissPiece() {
		if (!piece) return;
		piece = undefined;
		deps.changed?.();
	}

	async function attempt(run: Run, session: ExtensionContext, manual: boolean, draft?: Draft) {
		try {
			if (!live(run) || session.hasPendingMessages()) return;
			const capture = context.capture(session);
			if (!capture) return;
			// The check above and the prompt request have no await between them.
			const served = await deps.source.get(run.abort.signal);
			if (!live(run) || session.hasPendingMessages()) return;
			if (served === null) {
				if (manual) session.ui.notify("Prediction prompt is unavailable.", "warning");
				return;
			}
			const message = await context.infer(session, capture, served.prompt, run.abort.signal, draft);
			if (!live(run)) return;
			if (draft) {
				const text = parsePiece(message, draft);
				piece = text === undefined ? undefined : { text, key: draft.key };
			} else {
				ready = parseSuggestion(message);
			}
			deps.changed?.();
		} catch (error) {
			if (live(run) && manual) session.ui.notify(`Prediction failed: ${error instanceof Error ? error.message : String(error)}`, "warning");
		} finally {
			if (live(run)) {
				current = undefined;
				publish();
			}
		}
	}

	/** Starts one run after control returns to the terminal. */
	function launch(session: ExtensionContext, manual: boolean, draft?: Draft) {
		clearAborted();
		dismissPiece();
		const run: Run = { id: ++generation, abort: new AbortController(), key: draft?.key };
		current = run;
		publish();
		setImmediate(() => { void attempt(run, session, manual, draft); });
	}

	/** The same conditions for every manual or chained run. */
	const mayRun = () => ctx && !current && ctx.isIdle() && !ctx.hasPendingMessages() && context.hasAnswer(ctx);

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
		piece = undefined;
		seenAnswer = undefined;
		context.release();
	}

	return {
		suggestion: () => ready,
		piece: () => piece,
		start(next) {
			stop();
			ctx = next;
			context.bind(next);
		},
		stop,
		answered(session, event) {
			if (!ctx) return;
			if (event.outcome !== "completed" || event.message.role !== "assistant" || event.message.stopReason !== "stop") return;
			if (seenAnswer === event.messageEntryId) return;
			seenAnswer = event.messageEntryId;
			// The new answer ends the old request and the old suggestion for good.
			const wasBrewing = drop();
			ready = undefined;
			piece = undefined;
			deps.changed?.();
			if (session.hasPendingMessages()) {
				if (wasBrewing) publish();
				return;
			}
			launch(session, false);
		},
		generate() {
			if (ctx && mayRun()) launch(ctx, true);
		},
		continueDraft(draft) {
			if (ctx && mayRun()) launch(ctx, true, draft);
		},
		chain(draft) {
			if (ctx && mayRun()) launch(ctx, false, draft);
		},
		moved(key) {
			const wanted = current ? current.key : piece?.key;
			if (wanted === undefined || wanted === key()) return;
			dismissPiece();
			if (drop()) publish();
		},
		cancel() {
			dismissPiece();
			if (!drop()) return;
			clearAborted();
			abortedUntil = deps.now() + ABORTED_MS;
			abortedTimer = setTimeout(() => { clearAborted(); publish(); }, ABORTED_MS);
			publish();
		},
		interrupt() {
			dismissPiece();
			if (drop()) publish();
		},
		clear() {
			drop();
			clearAborted();
			ready = undefined;
			piece = undefined;
			seenAnswer = undefined;
			context.drop();
			deps.changed?.();
			publish();
		},
	};
}
