// Steering keys while the agent works: Ctrl+Enter or Alt+Enter with text queues steering; an empty Enter, an empty
// Ctrl+Enter (Codex) or Escape (other providers) with steering queued interrupts the turn silently and sends it now.
// Escape with a follow-up queued, on every provider, does the same and sends the follow-up after the steering.
// Ctrl+R in the idle main editor restarts an interrupted turn (resume.ts).
// Raw terminal input and Pi's private run path (`_startRun`); queue.ts captures the owning Pi session in memory.
import { CustomEditor, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getKeybindings, isKeyRelease, isKeyRepeat, matchesKey, type TUI } from "@earendil-works/pi-tui";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { installQueue, type Steer } from "./queue.ts";
import { installQuiet } from "./quiet.ts";
import { installHintUI } from "./hint-ui.ts";
import { interrupted, RESUME_NOTE, RESUME_TYPE } from "./resume.ts";

/**
 * Custom entry type: the timestamp of a reply a force-send interrupted. Its status row is not drawn; unless `unsent`
 * is set (the send was cancelled or never happened), its text also stays in the model's context.
 */
export const ENTRY = "rqw-send-now";
const POLL_MS = 20;
/** Only Codex has the second Ctrl+Enter that forces; other providers force with Escape (and an empty Enter, as before). */
const CODEX = "openai-codex";
/** Two Escape presses within this time are one gesture. */
const DOUBLE_ESCAPE_MS = 500;

/** A force-send under way: the reserved steering, plus late arrivals routed in until it is sent or restored. */
type Pending = { steers: Steer[]; followUps: Steer[]; ctx: ExtensionContext; release: () => void; settled: Promise<void>; onLate: (steer: Steer) => boolean; interrupted?: AssistantMessage; cancelled?: boolean };
type FocusTUI = TUI & { getFocusedComponent(): unknown; isFollowingOutput?: boolean };

/** The interrupted reply as the model will see it: its text only, as a finished reply; undefined when it has none. */
export function keptReply(message: AssistantMessage): AssistantMessage | undefined {
	const text = message.content.flatMap((block) => (block.type === "text" && block.text.trim() ? [{ type: "text" as const, text: block.text }] : []));
	if (text.length === 0) return undefined;
	const { errorMessage: _drop, ...rest } = message;
	return { ...rest, content: text, stopReason: "stop" };
}

/**
 * Pi enables bracketed paste once at start; a child process that writes the "off" code to the TTY leaves it off and
 * pasted newlines then arrive as Enter. Asserting "on" again is harmless when it is already on.
 */
function reassertBracketedPaste(ctx: ExtensionContext) {
	if (ctx.mode === "tui" && process.stdout.isTTY) process.stdout.write("\x1b[?2004h");
}

export default function sendNow(pi: ExtensionAPI) {
	const queue = installQueue();
	/** Stops the session's background work, as Ctrl+backslash and a double Escape do; a running turn is aborted first. */
	function stopSession(ctx: ExtensionContext) {
		if (!ctx.isIdle()) ctx.abort();
		else {
			const session = queue.session(ctx.sessionManager);
			if (ctx.hasPendingMessages() && session?.clearQueue) {
				const restored = session.clearQueue();
				ctx.ui.setEditorText([...restored.steering, ...restored.followUp, ctx.ui.getEditorText()].filter(Boolean).join("\n\n"));
			}
		}
		let agents = 0, processes = 0, unstoppable = 0;
		pi.events.emit("rqw:stop-background:v1", { sessionId: ctx.sessionManager.getSessionId(), reply: (part: { agents?: number; backgroundProcesses?: number; unstoppable?: number }) => {
			agents += part.agents ?? 0; processes += part.backgroundProcesses ?? 0; unstoppable += part.unstoppable ?? 0;
		} });
		const parts = [agents && `${agents} ${agents === 1 ? "agent" : "agents"}`, processes && `${processes} background ${processes === 1 ? "process" : "processes"}`].filter(Boolean);
		ctx.ui.notify(`${parts.length ? `Stopped: ${parts.join(", ")}` : "Nothing running"}${unstoppable ? `; ${unstoppable} file call${unstoppable === 1 ? "" : "s"} finishes on its own` : ""}`);
	}
	pi.registerShortcut?.("ctrl+\\", { description: "Stop session background work", handler: stopSession });
	let pending: Pending | undefined;
	/** The first Escape of a possible double press; set only while something runs, captured on that press. */
	let escapeAt: number | undefined;
	/** After a double Escape stopped the work, further presses are swallowed until then, so they cannot open the history. */
	let escapeQuietUntil = 0;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let unsubscribe: (() => void) | undefined;
	let tui: FocusTUI | undefined;
	const sources = new Map<any, () => void>();
	let stopOffers: (() => void) | undefined;
	let updateHint = () => {};
	let stopHint = () => {};
	const background = () => [...sources.keys()].some(source => { const counts = source.snapshot(); return (counts.agents ?? 0) > 0 || (counts.backgroundProcesses ?? 0) > 0; });
	const adopt = (source: any) => {
		if (!source || source.version !== 1 || typeof source.snapshot !== "function" || typeof source.subscribe !== "function" || sources.has(source)) return;
		let ended = false;
		const unsubscribe = source.subscribe((value: unknown) => { if (value === null) { ended = true; sources.get(source)?.(); sources.delete(source); } updateHint(); });
		if (ended) unsubscribe(); else sources.set(source, unsubscribe);
		updateHint();
	};
	/** Timestamps of interrupted replies this extension force-sent past; their text is replayed to the model. */
	let kept = new Set<number>();
	/** Timestamps of replies a force-send interrupted: their "Operation aborted" row is not drawn. */
	let quiet = new Set<number>();
	const releaseQuiet = installQuiet((message) => message.timestamp !== undefined && quiet.has(message.timestamp));

	/** Puts text back in the editor before the draft, or after what is there when it is a later arrival. */
	function restore(text: string, ctx: ExtensionContext, why: string, later = false) {
		const current = ctx.ui.getEditorText();
		ctx.ui.setEditorText((later ? [current, text] : [text, current]).filter((part) => part.trim()).join("\n\n"));
		ctx.ui.notify(`Queued message not sent (${why}); it is back in the editor.`, "warning");
	}

	/** Steering first, including steering that arrived late, then the follow-ups an Escape took. */
	const inOrder = (job: Pending) => [...job.steers, ...job.followUps];
	const joined = (steers: Steer[]) => steers.map((steer) => steer.text).filter((text) => text.trim()).join("\n\n");

	function send() {
		timer = undefined;
		if (!pending) return;
		const job = pending;
		const { ctx, interrupted } = job;
		// Abort ends with agent_settled; compaction or a run another extension starts meanwhile is waited out too.
		if (!ctx.isIdle()) {
			timer = setTimeout(send, POLL_MS);
			return;
		}
		pending = undefined;
		job.release();
		const text = joined(inOrder(job));
		const images = inOrder(job).flatMap((steer) => steer.images);
		const unsent = (why: string) => {
			if (interrupted) markInterrupted(interrupted, false);
			if (text.trim()) restore(text, ctx, why);
		};
		if (!text.trim() && images.length === 0) return unsent("");
		if (job.cancelled) return unsent("stopped with Escape");
		if (!ctx.model) return unsent("no model selected");
		// Pi's run path with the prepared text: the input handlers already ran when the steering was queued.
		let started = false;
		const run = queue.start(ctx.sessionManager, text, images, () => { started = true; if (interrupted) markInterrupted(interrupted, true); });
		if (!run) return unsent("Pi cannot start the run");
		run.catch((error) => { if (!started) unsent(error instanceof Error ? error.message : "the run did not start"); });
	}

	/** Persists the interrupted reply's mark, so resume and `/reload` draw it the same; replays its text only when the steering was sent. */
	function markInterrupted(message: AssistantMessage, sent: boolean) {
		if (sent) kept.add(message.timestamp);
		pi.appendEntry(ENTRY, sent ? { timestamp: message.timestamp } : { timestamp: message.timestamp, unsent: true });
	}

	/**
	 * Interrupts the turn without a notice and sends the user steering now. The steering leaves both Pi queues at once;
	 * the editor draft stays, and so do follow-ups unless `withFollowUps` (Escape): they go after the steering. The send
	 * waits for the abort and for steering inputs still on their way.
	 */
	function forceSteering(ctx: ExtensionContext, withFollowUps = false): boolean {
		const job: Pending = { steers: [], followUps: [], ctx, release: () => {}, settled: Promise.resolve(), onLate: (steer) => { job.steers.push(steer); return true; } };
		const forced = queue.force(ctx.sessionManager, (steer) => job.onLate(steer), withFollowUps);
		if (!forced) return false;
		job.steers.push(...forced.taken);
		job.followUps.push(...forced.followUps);
		job.release = forced.release;
		job.settled = forced.settled;
		pending = job;
		void Promise.all([forced.aborted, forced.settled]).then(() => { if (pending === job) send(); });
		return true;
	}

	/** True while user steering is queued in Pi or on its way into the queue. */
	function steeringWaits(ctx: ExtensionContext): boolean {
		const count = queue.steering(ctx.sessionManager);
		return count !== undefined && count.queued + count.inflight > 0;
	}

	/** True while a user follow-up is queued in Pi (held ones too). */
	function followUpWaits(ctx: ExtensionContext): boolean {
		return (queue.followUps(ctx.sessionManager) ?? 0) > 0;
	}

	/** The focused input editor, or undefined when something else has focus. */
	const focusedEditor = () => {
		const focused = tui?.getFocusedComponent();
		return focused instanceof CustomEditor ? focused : undefined;
	};
	/** Whether the editor's autocomplete list is open; undefined when the editor cannot say. */
	const autocompleteOpen = (editor: CustomEditor) => (editor as unknown as { isShowingAutocomplete?: () => boolean }).isShowingAutocomplete?.();

	/**
	 * Escape: one press leaves the running turn to Pi, which interrupts it (with a user follow-up queued, or user
	 * steering queued and a provider other than Codex, it is the force-send instead). A second press within 500 ms stops the
	 * background (and cancels a force-send not yet started). With only background running the first press is taken
	 * here, so Pi's own double-Escape action cannot fire; idle double Escape stays with the history editor.
	 */
	function onEscape(ctx: ExtensionContext): { consume: true } | undefined {
		const editor = focusedEditor();
		if (!editor || autocompleteOpen(editor) === true) return undefined;
		const now = Date.now();
		if (now < escapeQuietUntil) return { consume: true };
		const first = escapeAt;
		escapeAt = undefined;
		if (first !== undefined && now - first < DOUBLE_ESCAPE_MS) {
			escapeQuietUntil = now + DOUBLE_ESCAPE_MS;
			if (pending) cancelPending();
			stopSession(ctx);
			return { consume: true };
		}
		const working = !ctx.isIdle() || queue.session(ctx.sessionManager)?.isCompacting === true;
		if (!working && !pending && !background()) return undefined;
		escapeAt = now;
		// A queued follow-up, or steering on a provider other than Codex, makes Escape the force-send, so Pi's own Escape
		// (restore the queue) is skipped.
		const forces = (ctx.model?.provider !== CODEX && steeringWaits(ctx)) || followUpWaits(ctx);
		if (!ctx.isIdle() && forces && forceSteering(ctx, true)) return { consume: true };
		return working ? undefined : { consume: true };
	}

	/**
	 * A force-send that has not started is cancelled. It stays pending until the run has settled, like a send, so a
	 * steering input still on its way is restored with the text instead of landing in Pi's queue afterwards.
	 */
	function cancelPending() {
		pending!.cancelled = true;
	}

	/** Ctrl+R: only the idle main editor with a model and a branch that ends in an interrupted turn; anything else is left alone. */
	function onResume(ctx: ExtensionContext): { consume: true } | undefined {
		const editor = focusedEditor();
		if (!editor || autocompleteOpen(editor) === true) return undefined;
		if (!ctx.isIdle() || !ctx.model || queue.session(ctx.sessionManager)?.isCompacting === true) return undefined;
		if (!interrupted(ctx.sessionManager.getBranch())) return undefined;
		// Pi's custom-message run: the session counts as busy at once, so a second press finds it busy.
		pi.sendMessage({ customType: RESUME_TYPE, content: RESUME_NOTE, display: false }, { triggerTurn: true });
		return { consume: true };
	}

	/** Idle or compacting with background work: Enter queues its text as a follow-up, so no turn starts. True when it did. */
	function holdSubmit(ctx: ExtensionContext, editor: CustomEditor, session: ReturnType<typeof queue.session>): boolean {
		if (!background() || !(ctx.isIdle() || session?.isCompacting)) return false;
		let canHold = false;
		pi.events.emit("rqw:followup-hold:request", { sessionId: ctx.sessionManager.getSessionId(), reply: () => { canHold = true; } });
		if (!canHold) return false;
		const internal = editor as unknown as { actionHandlers?: Map<string, () => void>; handleInput?: (data: string) => void; getExpandedText?: () => string; addToHistory?: (text: string) => void; setText?: (text: string) => void };
		const text = (internal.getExpandedText?.() ?? ctx.ui.getEditorText()).trim();
		const plain = text && !text.startsWith("/") && !text.startsWith("!");
		if (!plain || typeof session?.followUp !== "function" || autocompleteOpen(editor) !== false) return false;
		if (typeof internal.actionHandlers?.get("app.message.followUp") !== "function" || typeof internal.handleInput !== "function" || typeof internal.setText !== "function") return false;
		internal.addToHistory?.(text);
		internal.setText("");
		void session.followUp(text).catch(() => restore(text, ctx, "queue failed"));
		return true;
	}

	/** Text in the editor: Ctrl+Enter and Alt+Enter give the editor its own submit, which queues steering while the agent works; Enter queues a follow-up while it works. */
	function submitText(ctx: ExtensionContext, editor: CustomEditor, data: string, steerKey: boolean): { consume: true } | undefined {
		const internal = editor as unknown as { actionHandlers?: Map<string, () => void>; handleInput?: (data: string) => void };
		const followUp = internal.actionHandlers?.get("app.message.followUp");
		if (typeof followUp !== "function" || typeof internal.handleInput !== "function") return undefined;
		if (steerKey) { internal.handleInput("\r"); return { consume: true }; }
		if (!ctx.isIdle() && getKeybindings().matches(data, "tui.input.submit")) { followUp(); return { consume: true }; }
		return undefined;
	}

	/** Empty Ctrl+Enter or Alt+Enter with follow-ups queued: they move into steering, or start the turn when nothing runs. */
	function promoteFollowUps(ctx: ExtensionContext, session: ReturnType<typeof queue.session>): { consume: true } | undefined {
		const idle = ctx.isIdle() && !session?.isCompacting;
		const defer = session?.isCompacting === true && session.isStreaming === false;
		if ((!(idle || defer) || ctx.model) && queue.promote(ctx.sessionManager, idle, defer, () => ctx.ui.notify("Queued messages not sent; the run did not start.", "warning"))) return { consume: true };
		return undefined;
	}

	function onKey(data: string, ctx: ExtensionContext): { consume: true } | undefined {
		// A release or an auto-repeat is never a deliberate press.
		if (isKeyRelease(data) || isKeyRepeat(data)) return undefined;
		if (matchesKey(data, "escape")) return onEscape(ctx);
		if (pending) return undefined;
		if (matchesKey(data, "ctrl+r")) return onResume(ctx);
		const submit = getKeybindings().matches(data, "tui.input.submit");
		const ctrlEnter = matchesKey(data, "ctrl+enter");
		const steerKey = ctrlEnter || matchesKey(data, "alt+enter");
		// Every other key is Pi's, and costs nothing more.
		if (!submit && !steerKey) return undefined;
		const editor = focusedEditor();
		if (!editor) return undefined;
		const session = queue.session(ctx.sessionManager);
		if (submit && holdSubmit(ctx, editor, session)) return { consume: true };
		if (autocompleteOpen(editor) !== false) return undefined;
		if (ctx.ui.getEditorText().trim()) return submitText(ctx, editor, data, steerKey);
		if (steerKey && followUpWaits(ctx)) return promoteFollowUps(ctx, session);
		// An empty Enter forces waiting steering, as before; on Codex a second Ctrl+Enter does too. Alt+Enter never forces.
		const forceKey = submit || (ctrlEnter && ctx.model?.provider === CODEX);
		if (!forceKey || ctx.isIdle()) return undefined;
		return steeringWaits(ctx) && forceSteering(ctx) ? { consume: true } : undefined;
	}

	pi.on("message_end", (event) => {
		const message = event.message;
		if (pending && message.role === "assistant" && message.stopReason === "aborted") {
			pending.interrupted = message;
			quiet.add(message.timestamp);
		}
	});
	pi.on("model_select", () => updateHint());
	pi.on("tool_execution_end", (_event, ctx) => reassertBracketedPaste(ctx));
	pi.on("agent_end", (_event, ctx) => reassertBracketedPaste(ctx));
	pi.on("agent_settled", (_event, ctx) => reassertBracketedPaste(ctx));

	// Pi's next request drops an aborted reply; keep the text of the one a force-send interrupted, like oh-my-pi.
	pi.on("context_with_system", (event) => {
		if (kept.size === 0) return undefined;
		let changed = false;
		const messages = event.messages.map((message) => {
			if (message.role !== "assistant" || message.stopReason !== "aborted" || !kept.has(message.timestamp)) return message;
			const reply = keptReply(message);
			if (!reply) return message;
			changed = true;
			return reply;
		});
		return changed ? { messages } : undefined;
	});

	pi.on("session_start", (_event, ctx) => {
		escapeAt = undefined;
		escapeQuietUntil = 0;
		reassertBracketedPaste(ctx);
		const marks = ctx.sessionManager.getEntries().flatMap((entry) =>
			entry.type === "custom" && entry.customType === ENTRY && typeof (entry.data as { timestamp?: unknown })?.timestamp === "number"
				? [entry.data as { timestamp: number; unsent?: boolean }] : []);
		kept = new Set(marks.filter((mark) => !mark.unsent).map((mark) => mark.timestamp));
		quiet = new Set(marks.map((mark) => mark.timestamp));
		if (ctx.mode !== "tui") return;
		if (pi.events) {
			stopOffers = pi.events.on("rqw:running-counts:offer", (offer: any) => { if (offer?.version === 1) adopt(offer.source); });
			pi.events.emit("rqw:running-counts:request", { version: 1, reply: adopt });
		}
		let currentEditor: unknown;
		// The Esc hints are drawn by a consumer (RQW-statusbar's activity line); without one Pi's own hints stay.
		const listeners = new Set<() => void>();
		const hintUI = installHintUI(ctx.sessionManager, (editor) => {
			currentEditor = editor;
			pi.events.emit("rqw:editor-hint:editor-changed", { sessionId: ctx.sessionManager.getSessionId(), editor });
		}, () => listeners.size > 0);
		// The TUI is needed only to see what has focus; a widget factory is the public way to get it. Removed at once.
		ctx.ui.setWidget(ENTRY, (instance) => {
			tui = instance as FocusTUI;
			return { render: () => [], invalidate() {} };
		}, { placement: "belowEditor" });
		ctx.ui.setWidget(ENTRY, undefined);
		unsubscribe = ctx.ui.onTerminalInput((data) => onKey(data, ctx));

		if (typeof ctx.sessionManager.getSessionId !== "function") { hintUI.release(); return; }
		const id = ctx.sessionManager.getSessionId();
		let compacting = false, retrying = false;
		let hint: string | undefined;
		// The activity line's source: the Esc hint.
		// Scrolled up in the fullscreen view the first Escape only jumps down (RQW-scroll), so no Esc hint is true. The
		// scroll state is a cheap read, taken when the activity line asks, not tracked per frame.
		const scrolledUp = () => tui?.mode === "fullscreen" && tui.isFollowingOutput === false;
		const source = {
			snapshot: () => hint?.startsWith("esc") && scrolledUp() ? undefined : hint,
			subscribe(listener: () => void) {
				listeners.add(listener);
				hintUI.refresh();
				return () => { listeners.delete(listener); hintUI.refresh(); };
			},
		};
		updateHint = () => {
			const session = queue.session(ctx.sessionManager);
			const tracked = queue.steering(ctx.sessionManager);
			const steering = tracked ? Math.max(session?.getSteeringMessages()?.length ?? 0, tracked.queued + tracked.inflight) : 0;
			const followUp = (session as any)?.getFollowUpMessages?.()?.length ?? (ctx.hasPendingMessages() ? 1 : 0);
			const special = compacting || retrying || session?.isCompacting === true;
			const working = !ctx.isIdle() || special;
			const next = special ? "esc to interrupt"
				: working && followUp ? "ctrl+enter to steer"
				: working && steering && ctx.model?.provider === CODEX ? "ctrl+enter to send now"
				: working && steering ? "esc to send now"
				: working ? "esc to interrupt"
				: background() ? "esc esc to stop background"
				: followUp ? "ctrl+enter to steer" : undefined;
			if (hint === next) return;
			hint = next;
			for (const listener of [...listeners]) listener();
		};
		const stopEditorRequest = pi.events.on("rqw:editor-hint:request", (request: any) => { if (request?.sessionId === id) request.reply?.(currentEditor); });
		const stopRequest = pi.events.on("rqw:activity-hint:request", (request: any) => { if (request?.sessionId === id) request.reply?.(source); });
		const stopQueueWatch = queue.watch(ctx.sessionManager, updateHint);
		const session = queue.session(ctx.sessionManager) as any;
		let stopSessionEvents: (() => void) | undefined;
		try { stopSessionEvents = session?.subscribe?.((event: any) => {
			if (event.type === "compaction_start") compacting = true;
			if (event.type === "compaction_end") compacting = false;
			if (event.type === "auto_retry_start") retrying = true;
			if (event.type === "auto_retry_end") retrying = false;
			if (["queue_update", "agent_start", "agent_end", "agent_settled", "compaction_start", "compaction_end", "auto_retry_start", "auto_retry_end"].includes(event.type)) updateHint();
		}); } catch { /* Unsupported session shape keeps Pi's behavior. */ }
		updateHint();
		pi.events.emit("rqw:activity-hint:offer", { sessionId: id, source });
		stopHint = () => {
			stopEditorRequest(); stopRequest(); stopQueueWatch(); stopSessionEvents?.();
			listeners.clear(); hintUI.release(); updateHint = () => {}; stopHint = () => {};
		};
	});

	pi.on("session_shutdown", () => {
		stopHint();
		stopOffers?.(); stopOffers = undefined;
		for (const unsubscribe of sources.values()) unsubscribe();
		sources.clear();
		releaseQuiet();
		unsubscribe?.();
		unsubscribe = undefined;
		tui = undefined;
		if (timer) clearTimeout(timer);
		timer = undefined;
		// Reload, /new, /resume or quit before the send: the text goes back to the editor, nothing is lost. Steering
		// inputs still on their way keep being caught until they have settled, then they go back as well.
		const job = pending;
		pending = undefined;
		if (!job) return queue.release();
		const { ctx, settled } = job;
		// A late input that finds the context already invalid is left to Pi's own queue (the session stays on /reload).
		const back = (text: string, later = false) => {
			try { if (text.trim()) restore(text, ctx, "the session ended first", later); return true; } catch { return false; }
		};
		try { if (job.interrupted) markInterrupted(job.interrupted, false); } catch {}
		back(joined(inOrder(job)));
		// Late steering goes before the restored follow-ups, so the editor keeps the order a send would have had.
		const followUpText = joined(job.followUps);
		const steeringText = joined(job.steers);
		// The editor now starts with the restored steering, then the follow-ups; what was restored so far is this head.
		let head = steeringText ? `${steeringText}\n\n` : "";
		const backBeforeFollowUps = (text: string) => {
			try {
				const current = ctx.ui.getEditorText();
				const intact = followUpText && current.startsWith(head) && current.startsWith(followUpText, head.length);
				if (!intact || !text.trim()) return back(text, true);
				ctx.ui.setEditorText(`${head}${text}\n\n${current.slice(head.length)}`);
				head += `${text}\n\n`;
				ctx.ui.notify("Queued message not sent (the session ended first); it is back in the editor.", "warning");
				return true;
			} catch { return false; }
		};
		job.onLate = (steer) => backBeforeFollowUps(steer.text);
		void settled.then(() => { job.release(); queue.release(); });
	});
}
