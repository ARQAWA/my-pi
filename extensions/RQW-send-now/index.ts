// Enter on an empty editor while the agent works and steering is queued: interrupt the turn and send the queue now.
// Raw terminal input and public send APIs; queue.ts captures the owning Pi session in memory.
import { CustomEditor, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getKeybindings, isKeyRelease, type TUI } from "@earendil-works/pi-tui";
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
		if (pending || isKeyRelease(data) || !getKeybindings().matches(data, "tui.input.submit")) return undefined;
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
		// The TUI is needed only to see what has focus; a widget factory is the public way to get it. Removed at once.
		ctx.ui.setWidget(ENTRY, (instance) => {
			tui = instance as FocusTUI;
			return { render: () => [], invalidate() {} };
		}, { placement: "belowEditor" });
		ctx.ui.setWidget(ENTRY, undefined);
		unsubscribe = ctx.ui.onTerminalInput((data) => onKey(data, ctx));
	});

	pi.on("session_shutdown", () => {
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
