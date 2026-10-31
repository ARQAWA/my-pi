// Enter on an empty editor while the agent works and steering is queued: interrupt the turn and send the queue now.
// Raw terminal input and public send APIs; queue.ts captures the owning Pi session in memory.
import { CustomEditor, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getKeybindings, isKeyRelease, matchesKey, type TUI } from "@earendil-works/pi-tui";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { installQueue } from "./queue.ts";

/** Custom entry type: the timestamp of an interrupted reply whose text stays in the model's context. */
export const ENTRY = "rqw-send-now";
const POLL_MS = 20;

type Pending = { text: string; ctx: ExtensionContext; interrupted?: AssistantMessage };
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
	pi.registerShortcut?.("ctrl+\\", { description: "Stop session background work", handler: ctx => {
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
	} });
	/** Steering messages queued through Pi since the queue was last empty; Pi exposes only "anything queued". */
	let steering = 0;
	/**
	 * Steering inputs on their way to Pi's queue. Pi awaits the input handlers, then queues within the same
	 * microtask chain, so each one has landed by the next macrotask; a batch of keys arrives synchronously before it.
	 * Rule: an empty queue with nothing on its way means no steering is queued (also after Pi's dequeue key).
	 */
	let submitting = 0;
	/** Set by before_agent_start: the run's next user message is its starting prompt, not a queued one. */
	let startingPrompt = false;
	let pending: Pending | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let unsubscribe: (() => void) | undefined;
	let tui: FocusTUI | undefined;
	const sources = new Map<any, () => void>();
	let stopOffers: (() => void) | undefined;
	const background = () => [...sources.keys()].some(source => { const counts = source.snapshot(); return (counts.agents ?? 0) > 0 || (counts.backgroundProcesses ?? 0) > 0; });
	const adopt = (source: any) => {
		if (!source || source.version !== 1 || typeof source.snapshot !== "function" || typeof source.subscribe !== "function" || sources.has(source)) return;
		let ended = false;
		const unsubscribe = source.subscribe((value: unknown) => { if (value === null) { ended = true; sources.get(source)?.(); sources.delete(source); } });
		if (ended) unsubscribe(); else sources.set(source, unsubscribe);
	};
	/** Timestamps of interrupted replies this extension force-sent past; their text is replayed to the model. */
	let kept = new Set<number>();

	function restore(text: string, ctx: ExtensionContext, why: string) {
		const current = ctx.ui.getEditorText();
		ctx.ui.setEditorText([text, current].filter((part) => part.trim()).join("\n\n"));
		ctx.ui.notify(`Queued message not sent (${why}); it is back in the editor.`, "warning");
	}

	/** `text` plus anything still in Pi's queue, taken through Pi's restore; the user's editor draft stays put. */
	function withLateQueue(text: string, ctx: ExtensionContext): string {
		if (!ctx.hasPendingMessages()) return text;
		const typed = ctx.ui.getEditorText();
		ctx.ui.setEditorText("");
		ctx.abort();
		const late = ctx.ui.getEditorText();
		ctx.ui.setEditorText(typed);
		return [text, late].filter((part) => part.trim()).join("\n\n");
	}

	function send() {
		timer = undefined;
		if (!pending) return;
		const { text, ctx, interrupted } = pending;
		// Abort ends with agent_settled; compaction or a run another extension starts meanwhile is waited out too.
		if (!ctx.isIdle()) {
			timer = setTimeout(send, POLL_MS);
			return;
		}
		pending = undefined;
		// A steering message that was still on its way when the run was aborted lands in Pi's queue afterwards,
		// where nothing would deliver it.
		const all = withLateQueue(text, ctx);
		if (!all.trim()) return;
		if (!ctx.model) return restore(all, ctx, "no model selected");
		if (interrupted && keptReply(interrupted)) {
			kept.add(interrupted.timestamp);
			pi.appendEntry(ENTRY, { timestamp: interrupted.timestamp });
		}
		// The text is already expanded by Pi, so templates are not expanded again. Steer only if a run started meanwhile.
		pi.sendUserMessage(all, { deliverAs: "steer" });
	}

	function onKey(data: string, ctx: ExtensionContext): { consume: true } | undefined {
		if (pending || isKeyRelease(data)) return undefined;
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
		if (ctx.ui.getEditorText().trim() && editor instanceof CustomEditor) {
			const internal = editor as unknown as { actionHandlers?: Map<string, () => void>; handleInput?: (data: string) => void; isShowingAutocomplete?: () => boolean };
			const followUp = internal.actionHandlers?.get("app.message.followUp");
			if (typeof followUp === "function" && typeof internal.handleInput === "function" && typeof internal.isShowingAutocomplete === "function" && !internal.isShowingAutocomplete()) {
				if (matchesKey(data, "alt+enter")) { internal.handleInput("\r"); return { consume: true }; }
				if (!ctx.isIdle() && getKeybindings().matches(data, "tui.input.submit")) { followUp(); return { consume: true }; }
			}
		}
		if (!getKeybindings().matches(data, "tui.input.submit")) return undefined;
		if (!ctx.hasPendingMessages() && submitting === 0) steering = 0;
		const queuedSteering = queue.read(ctx.sessionManager);
		if (queuedSteering === undefined) return undefined;
		if (ctx.isIdle() || (queuedSteering === 0 && !(submitting > 0 && steering > 0)) || ctx.ui.getEditorText().trim()) return undefined;
		// Only Pi's input editor: dialogs, selectors and overlays keep their own Enter.
		if (!(tui?.getFocusedComponent() instanceof CustomEditor)) return undefined;
		ctx.abort(); // Pi clears both queues into the editor, then aborts the run
		const text = ctx.ui.getEditorText();
		ctx.ui.setEditorText("");
		const onItsWay = submitting > 0;
		steering = 0;
		submitting = 0;
		if (!text.trim() && !onItsWay) return { consume: true };
		pending = { text, ctx };
		timer = setTimeout(send, 0);
		return { consume: true };
	}

	pi.on("input", (event, ctx) => {
		if (!event.streamingBehavior) return;
		if (!ctx.hasPendingMessages() && submitting === 0) steering = 0;
		if (event.streamingBehavior !== "steer") return;
		steering++;
		submitting++;
		setTimeout(() => { submitting = Math.max(0, submitting - 1); }, 0);
	});
	pi.on("before_agent_start", (event) => {
		startingPrompt = event.messageType === "user";
	});
	// Pi emits a run's starting prompt first, then delivers steering before follow-ups, so any other user message
	// while steering is counted is a queued steering one.
	pi.on("message_start", (event) => {
		if (event.message.role !== "user") return;
		if (startingPrompt) startingPrompt = false;
		else if (steering > 0) steering--;
	});
	pi.on("message_end", (event) => {
		const message = event.message;
		if (pending && message.role === "assistant" && message.stopReason === "aborted") pending.interrupted = message;
	});
	pi.on("tool_execution_end", (_event, ctx) => reassertBracketedPaste(ctx));
	pi.on("agent_end", (_event, ctx) => reassertBracketedPaste(ctx));
	pi.on("agent_settled", (_event, ctx) => {
		reassertBracketedPaste(ctx);
		startingPrompt = false;
		submitting = 0;
		if (!ctx.hasPendingMessages()) steering = 0;
	});

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
		steering = 0;
		submitting = 0;
		startingPrompt = false;
		reassertBracketedPaste(ctx);
		kept = new Set(ctx.sessionManager.getEntries().flatMap((entry) =>
			entry.type === "custom" && entry.customType === ENTRY && typeof (entry.data as { timestamp?: unknown })?.timestamp === "number"
				? [(entry.data as { timestamp: number }).timestamp] : []));
		if (ctx.mode !== "tui") return;
		if (pi.events) {
			stopOffers = pi.events.on("rqw:running-counts:offer", (offer: any) => { if (offer?.version === 1) adopt(offer.source); });
			pi.events.emit("rqw:running-counts:request", { version: 1, reply: adopt });
		}
		// The TUI is needed only to see what has focus; a widget factory is the public way to get it. Removed at once.
		ctx.ui.setWidget(ENTRY, (instance) => {
			tui = instance as FocusTUI;
			return { render: () => [], invalidate() {} };
		}, { placement: "belowEditor" });
		ctx.ui.setWidget(ENTRY, undefined);
		unsubscribe = ctx.ui.onTerminalInput((data) => onKey(data, ctx));
	});

	pi.on("session_shutdown", () => {
		stopOffers?.(); stopOffers = undefined;
		for (const unsubscribe of sources.values()) unsubscribe();
		sources.clear();
		queue.release();
		unsubscribe?.();
		unsubscribe = undefined;
		tui = undefined;
		if (timer) clearTimeout(timer);
		timer = undefined;
		// Reload, /new, /resume or quit before the send: the text goes back to the editor, nothing is lost.
		if (pending) {
			const { text, ctx } = pending;
			pending = undefined;
			try {
				const all = withLateQueue(text, ctx);
				if (all.trim()) restore(all, ctx, "the session ended first");
			} catch {}
		}
	});
}
