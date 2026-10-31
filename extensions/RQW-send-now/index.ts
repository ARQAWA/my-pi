// Steering keys while the agent works: Ctrl+Enter or Alt+Enter with text queues steering; an empty Enter, an empty
// Ctrl+Enter (Codex) or Escape (other providers) with steering queued interrupts the turn silently and sends it now.
// Raw terminal input and public send APIs; queue.ts captures the owning Pi session in memory.
import { CustomEditor, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getKeybindings, isKeyRelease, isKeyRepeat, matchesKey, type TUI } from "@earendil-works/pi-tui";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { installQueue, type Steer } from "./queue.ts";
import { installQuiet } from "./quiet.ts";
import { installHintEditor } from "./hint-editor.ts";
import { installHintUI } from "./hint-ui.ts";

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
type Pending = { steers: Steer[]; ctx: ExtensionContext; release: () => void; settled: Promise<void>; onLate: (steer: Steer) => boolean; interrupted?: AssistantMessage; cancelled?: boolean };
type FocusTUI = TUI & { getFocusedComponent(): unknown };

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
		const text = joined(job.steers);
		const images = job.steers.flatMap((steer) => steer.images);
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
	 * follow-ups and the editor draft stay. The send waits for the abort and for steering inputs still on their way.
	 */
	function forceSteering(ctx: ExtensionContext): boolean {
		const job: Pending = { steers: [], ctx, release: () => {}, settled: Promise.resolve(), onLate: (steer) => { job.steers.push(steer); return true; } };
		const forced = queue.force(ctx.sessionManager, (steer) => job.onLate(steer));
		if (!forced) return false;
		job.steers.push(...forced.taken);
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

	/**
	 * Escape: one press leaves the running turn to Pi, which interrupts it (with user steering queued and a provider
	 * other than Codex it is the force-send instead). A second press within 500 ms stops the
	 * background (and cancels a force-send not yet started). With only background running the first press is taken
	 * here, so Pi's own double-Escape action cannot fire; idle double Escape stays with the history editor.
	 */
	function onEscape(ctx: ExtensionContext): { consume: true } | undefined {
		const focused = tui?.getFocusedComponent();
		if (!(focused instanceof CustomEditor) || (focused as unknown as { isShowingAutocomplete?: () => boolean }).isShowingAutocomplete?.() === true) return undefined;
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
		// Not Codex: Escape with steering queued is the force-send, so Pi's own Escape (restore the queue) is skipped.
		if (!ctx.isIdle() && ctx.model?.provider !== CODEX && steeringWaits(ctx) && forceSteering(ctx)) return { consume: true };
		return working ? undefined : { consume: true };
	}

	/**
	 * A force-send that has not started is cancelled. It stays pending until the run has settled, like a send, so a
	 * steering input still on its way is restored with the text instead of landing in Pi's queue afterwards.
	 */
	function cancelPending() {
		pending!.cancelled = true;
	}

	function onKey(data: string, ctx: ExtensionContext): { consume: true } | undefined {
		// A release or an auto-repeat is never a deliberate press.
		if (isKeyRelease(data) || isKeyRepeat(data)) return undefined;
		if (matchesKey(data, "escape")) return onEscape(ctx);
		if (pending) return undefined;
		const editor = tui?.getFocusedComponent();
		const session = queue.session(ctx.sessionManager);
		let canHold = false;
		if (background() && (ctx.isIdle() || session?.isCompacting)) pi.events.emit("rqw:followup-hold:request", { sessionId: ctx.sessionManager.getSessionId(), reply: () => { canHold = true; } });
		if (canHold && getKeybindings().matches(data, "tui.input.submit") && editor instanceof CustomEditor) {
			const internal = editor as unknown as { actionHandlers?: Map<string, () => void>; handleInput?: (data: string) => void; isShowingAutocomplete?: () => boolean; getExpandedText?: () => string; addToHistory?: (text: string) => void; setText?: (text: string) => void };
			const text = (internal.getExpandedText?.() ?? ctx.ui.getEditorText()).trim();
			if (text && !text.startsWith("/") && !text.startsWith("!") && typeof session?.followUp === "function" && typeof internal.actionHandlers?.get("app.message.followUp") === "function" && typeof internal.handleInput === "function" && internal.isShowingAutocomplete?.() === false && typeof internal.setText === "function") {
				internal.addToHistory?.(text); internal.setText("");
				void session.followUp(text).catch(() => restore(text, ctx, "queue failed"));
				return { consume: true };
			}
		}
		const steerKey = matchesKey(data, "ctrl+enter") || matchesKey(data, "alt+enter");
		if (ctx.ui.getEditorText().trim() && editor instanceof CustomEditor) {
			const internal = editor as unknown as { actionHandlers?: Map<string, () => void>; handleInput?: (data: string) => void; isShowingAutocomplete?: () => boolean };
			const followUp = internal.actionHandlers?.get("app.message.followUp");
			if (typeof followUp === "function" && typeof internal.handleInput === "function" && typeof internal.isShowingAutocomplete === "function" && !internal.isShowingAutocomplete()) {
				// Ctrl+Enter and Alt+Enter: the editor's own submit, which queues steering while the agent works.
				if (steerKey) { internal.handleInput("\r"); return { consume: true }; }
				if (!ctx.isIdle() && getKeybindings().matches(data, "tui.input.submit")) { followUp(); return { consume: true }; }
			}
		}
		// An empty Enter forces waiting steering, as before; on Codex a second Ctrl+Enter does too. Alt+Enter never forces.
		const forceKey = getKeybindings().matches(data, "tui.input.submit") || (matchesKey(data, "ctrl+enter") && ctx.model?.provider === CODEX);
		if (!forceKey || ctx.ui.getEditorText().trim() || ctx.isIdle() || !(editor instanceof CustomEditor)) return undefined;
		if ((editor as unknown as { isShowingAutocomplete?: () => boolean }).isShowingAutocomplete?.() !== false) return undefined;
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
		let attachEditor = (_editor?: unknown) => {};
		let currentEditor: unknown;
		let editorSupported = () => false;
		const hintUI = typeof ctx.ui.theme?.italic === "function" ? installHintUI(ctx.sessionManager, (editor) => {
			currentEditor = editor;
			attachEditor(editor);
			pi.events.emit("rqw:editor-hint:editor-changed", { sessionId: ctx.sessionManager.getSessionId(), editor });
		}, () => editorSupported()) : { release() {}, refresh() {} };
		// The TUI is needed only to see what has focus; a widget factory is the public way to get it. Removed at once.
		ctx.ui.setWidget(ENTRY, (instance) => {
			tui = instance as FocusTUI;
			return { render: () => [], invalidate() {} };
		}, { placement: "belowEditor" });
		ctx.ui.setWidget(ENTRY, undefined);
		unsubscribe = ctx.ui.onTerminalInput((data) => onKey(data, ctx));

		if (typeof ctx.sessionManager.getSessionId !== "function") { hintUI.release(); return; }
		const id = ctx.sessionManager.getSessionId();
		let painter = false, brewing = false, compacting = false, retrying = false;
		let hint: string | undefined;
		const listeners = new Set<() => void>();
		const visibleHint = () => getKeybindings().getKeys("tui.altScreen.bottom").some(key => key === "esc" || key === "escape") ? "esc to jump to latest" : hint;
		const editor = installHintEditor(() => painter ? undefined : visibleHint(), () => hintUI.refresh());
		attachEditor = editor.attach;
		editorSupported = editor.supported;
		const source = { snapshot: visibleHint, subscribe(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener); } };
		updateHint = () => {
			const session = queue.session(ctx.sessionManager);
			const tracked = queue.steering(ctx.sessionManager);
			const steering = tracked ? Math.max(session?.getSteeringMessages()?.length ?? 0, tracked.queued + tracked.inflight) : 0;
			const followUp = (session as any)?.getFollowUpMessages?.()?.length ?? (ctx.hasPendingMessages() ? 1 : 0);
			const special = compacting || retrying || session?.isCompacting === true;
			const working = !ctx.isIdle() || special;
			const next = brewing ? "ctrl+r to interrupt"
				: special ? "esc to interrupt"
				: working && steering ? ctx.model?.provider === CODEX ? "ctrl+enter to send now" : "esc to send now"
				: working ? "esc to interrupt"
				: background() ? "esc esc to stop background"
				: followUp ? "ctrl+enter to steer" : undefined;
			if (hint === next) return;
			hint = next;
			for (const listener of listeners) listener();
			editor.refresh();
		};
		const stopRequest = pi.events.on("rqw:editor-hint:request", (request: any) => { if (request?.sessionId === id) request.reply?.(source, currentEditor); });
		const stopPainter = pi.events.on("rqw:editor-hint:painter", (event: any) => { if (event?.sessionId === id) { painter = event.active === true; editor.refresh(); } });
		const stopActivity = pi.events.on("rqw-predictions:activity", (event: any) => { if (event?.sessionId === id) { brewing = event.state === "brewing"; updateHint(); } });
		pi.events.emit("rqw:editor-hint:painter-query", { sessionId: id, reply: () => { painter = true; } });
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
		if (typeof ctx.ui.theme?.italic === "function") editor.start(ctx);
		updateHint();
		pi.events.emit("rqw:editor-hint:offer", { sessionId: id, source });
		stopHint = () => {
			stopRequest(); stopPainter(); stopActivity(); stopQueueWatch(); stopSessionEvents?.();
			listeners.clear(); editor.stop(); hintUI.release(); updateHint = () => {}; stopHint = () => {};
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
		const { steers, ctx, settled } = job;
		// A late input that finds the context already invalid is left to Pi's own queue (the session stays on /reload).
		const back = (text: string, later = false) => {
			try { if (text.trim()) restore(text, ctx, "the session ended first", later); return true; } catch { return false; }
		};
		try { if (job.interrupted) markInterrupted(job.interrupted, false); } catch {}
		back(joined(steers));
		job.onLate = (steer) => back(steer.text, true);
		void settled.then(() => { job.release(); queue.release(); });
	});
}
