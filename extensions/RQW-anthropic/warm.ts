import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { AgentSession, AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { Snapshot } from "./context-fork.ts";

/** The one-hour cache is refreshed after this long without a real request, counted from that request's start. */
export const WARM_AFTER_MS = 50 * 60_000;
/** A timer this late (sleep, blocked event loop) finds the entry gone: the replay would be a cold write, not a warm. */
export const WARM_LATE_MS = 5 * 60_000;

export type WarmSession = Pick<AgentSession, "sessionId" | "model" | "isStreaming" | "isCompacting" | "isRetrying" | "isBashRunning" | "pendingMessageCount" | "subscribe">;
/** Identifies one real request; any cancel makes it stale. */
export type WarmTurn = { epoch: number; startedAt: number };
type Replay = (snapshot: Snapshot, signal: AbortSignal) => Promise<AssistantMessage>;

/**
 * Keeps the main session's one-hour Anthropic cache alive: one timer and one isolated replay of the last
 * successful real request with `max_tokens: 1`. The answer is dropped; no session, history or tool is touched.
 */
export function mainWarm(replay: Replay) {
	let session: WarmSession | undefined;
	let boundId: string | undefined;
	let unsubscribe: (() => void) | undefined;
	let epoch = 0;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let controller: AbortController | undefined;

	/** Ends the cycle: no timer, no request in flight, every pending turn stale. */
	function cancel() {
		epoch++;
		if (timer) clearTimeout(timer);
		timer = undefined;
		controller?.abort();
		controller = undefined;
	}

	const busy = (current: WarmSession) =>
		current.isStreaming || current.isCompacting || current.isRetrying || current.isBashRunning || current.pendingMessageCount > 0;

	function schedule(snapshot: Snapshot, startedAt: number) {
		const mine = epoch;
		timer = setTimeout(() => void fire(mine, snapshot, startedAt), Math.max(0, startedAt + WARM_AFTER_MS - Date.now()));
		timer.unref?.();
	}

	async function fire(mine: number, snapshot: Snapshot, startedAt: number) {
		timer = undefined;
		if (Date.now() - startedAt - WARM_AFTER_MS > WARM_LATE_MS) return;
		const current = session;
		if (!current || current.model?.id !== snapshot.model.id || busy(current)) return;
		const own = new AbortController();
		controller = own;
		const sentAt = Date.now();
		let cached = false;
		try {
			const message = await replay(snapshot, own.signal);
			cached = message.stopReason !== "error" && message.stopReason !== "aborted" && message.usage.cacheRead > 0;
		} catch { /* An error ends the cycle; nothing is retried. */ }
		if (mine !== epoch) return;
		controller = undefined;
		if (cached) schedule(snapshot, sentAt);
	}

	function onEvent(event: AgentSessionEvent) {
		if (event.type === "agent_start" || event.type === "compaction_start" ||
			(event.type === "queue_update" && event.steering.length + event.followUp.length > 0)) cancel();
	}

	return {
		/** The one session that may warm. Another session or a new identity starts over. */
		bind(next: WarmSession) {
			if (session !== next || boundId !== next.sessionId) cancel();
			if (session !== next) {
				unsubscribe?.();
				unsubscribe = next.subscribe(onEvent);
			}
			session = next;
			boundId = next.sessionId;
		},
		/** A real request of the main session starts: the old cycle ends. Other sessions are ignored. */
		begin(sessionId: string | undefined): WarmTurn | undefined {
			if (!session || sessionId === undefined || sessionId !== session.sessionId) return undefined;
			cancel();
			return { epoch, startedAt: Date.now() };
		},
		/** The real request answered: its snapshot becomes the replayable one, unless something cancelled meanwhile. */
		arm(turn: WarmTurn | undefined, snapshot: Snapshot | undefined, retention: string, message: AssistantMessage) {
			if (!turn || !snapshot || turn.epoch !== epoch || retention !== "long") return;
			if (message.stopReason === "error" || message.stopReason === "aborted") return;
			// Manual extended thinking derives its budget from max_tokens: a one-token replay is another request.
			if (snapshot.body.thinking?.type === "enabled") return;
			// A hosted (server-side) tool or MCP server is never given a chance to run in the background.
			if (!snapshot.local) return;
			schedule(snapshot, turn.startedAt);
		},
		cancel,
		dispose() {
			cancel();
			unsubscribe?.();
			unsubscribe = undefined;
			session = undefined;
			boundId = undefined;
		},
	};
}
