import { AgentSession, type ExtensionContext } from "@earendil-works/pi-coding-agent";

const WAKE = "rqw:wait-steer:v1";
/** A wait opened or closed: `{ sessionId, call, open }`. RQW-send-now reads it; Enter then steers instead of queueing. */
const WAITING = "rqw:waiting:v1";

type Events = { on(name: string, listener: (event: any) => void): () => void; emit(name: string, event: unknown): void };

/** A wait is a call that only waits; every other call is work. */
const isWait = (call: any) => (call.name === "agent" || call.name === "job") && call.arguments?.action === "wait";

/** Find the announcing batch, even if a background script outlives its turn. */
function waitReason(ctx: ExtensionContext, call: string): "direct_wait_required" | "work_pending" | undefined {
	const manager = ctx?.sessionManager;
	let entry: any = manager?.getLeafEntry?.();
	while (entry) {
		if (entry.type === "message" && entry.message.role === "assistant") {
			const calls: any[] = entry.message.content.filter((block: any) => block.type === "toolCall");
			if (calls.some(block => block.id === call)) return calls.some(block => !isWait(block)) ? "work_pending" : undefined;
			if (calls.some(block => block.name === "codemode" && call.startsWith(`${block.id}/`))) return "direct_wait_required";
		}
		entry = entry.parentId ? manager?.getEntry?.(entry.parentId) : undefined;
	}
}

/**
 * The wait's adapter. `pending` is true when its batch has other work: the wait must then return at once and not
 * announce itself. Otherwise it observes only user steering (the queue update precedes Pi's core enqueue) and announces
 * itself as open until `close`.
 */
export function steeringWait(ctx: ExtensionContext, events: Events | undefined, call: string) {
	const reason = waitReason(ctx, call);
	if (reason) return { signal: new AbortController().signal, reason, close() {} };
	const controller = new AbortController();
	const descriptor = Object.getOwnPropertyDescriptor(AgentSession.prototype, "isIdle");
	let session: AgentSession | undefined;
	if (descriptor?.configurable && typeof descriptor.get === "function") {
		Object.defineProperty(AgentSession.prototype, "isIdle", { ...descriptor, get(this: AgentSession) { session = this; return true; } });
		try { ctx.isIdle(); } catch { session = undefined; } finally { Object.defineProperty(AgentSession.prototype, "isIdle", descriptor); }
	}
	if (session?.sessionManager !== ctx.sessionManager) session = undefined;
	const current = session;
	const queued = () => current?.getSteeringMessages().length ||
		(current?.agent as any)?.steeringQueue?.messages?.some((message: any) => message.role === "user");
	let count = current?.getSteeringMessages().length ?? 0;
	const wake = () => queueMicrotask(() => controller.abort());
	const unsubscribe = current?.subscribe(event => {
		if (event.type !== "queue_update") return;
		const next = event.steering.length;
		if (next > count) wake();
		count = next;
	});
	const stopWake = events?.on(WAKE, (event: any) => {
		if (event?.sessionId === ctx.sessionManager.getSessionId()) wake();
	});
	if (queued()) wake();
	const sessionId = ctx?.sessionManager.getSessionId();
	events?.emit(WAITING, { sessionId, call, open: true });
	return { signal: controller.signal, reason: undefined, close() { unsubscribe?.(); stopWake?.(); events?.emit(WAITING, { sessionId, call, open: false }); } };
}
