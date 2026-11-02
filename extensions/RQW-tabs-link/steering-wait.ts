import { AgentSession, type ExtensionContext } from "@earendil-works/pi-coding-agent";

type Events = { on(name: string, listener: (event: any) => void): () => void; emit(name: string, event: unknown): void };

/** Announce only a wait-only batch, so Enter never redirects input while useful work runs. */
function waitOnly(ctx: ExtensionContext, call: string): boolean {
	const manager = ctx.sessionManager;
	let entry = manager.getLeafEntry();
	while (entry) {
		if (entry.type === "message" && entry.message.role === "assistant") {
			const calls = entry.message.content.filter(block => block.type === "toolCall");
			if (calls.some(block => block.id === call)) return calls.every(block => block.name === "wait_answer" || ((block.name === "agent" || block.name === "job") && block.arguments.action === "wait"));
			if (calls.some(block => block.name === "codemode" && call.startsWith(`${block.id}/`))) return false;
		}
		entry = entry.parentId ? manager.getEntry(entry.parentId) : undefined;
	}
	return true;
}

/** Observe user steering and announce the wait to the editor; neither action stops the target. */
export function steeringWait(ctx: ExtensionContext, events: Events, call: string) {
	const controller = new AbortController();
	const descriptor = Object.getOwnPropertyDescriptor(AgentSession.prototype, "isIdle");
	let session: AgentSession | undefined;
	if (descriptor?.configurable && typeof descriptor.get === "function") {
		Object.defineProperty(AgentSession.prototype, "isIdle", { ...descriptor, get(this: AgentSession) { session = this; return true; } });
		try { ctx.isIdle(); } catch { session = undefined; } finally { Object.defineProperty(AgentSession.prototype, "isIdle", descriptor); }
	}
	if (session?.sessionManager !== ctx.sessionManager) session = undefined;
	let count = session?.getSteeringMessages().length ?? 0;
	const wake = () => queueMicrotask(() => controller.abort());
	const unsubscribe = session?.subscribe(event => {
		if (event.type !== "queue_update") return;
		if (event.steering.length > count) wake();
		count = event.steering.length;
	});
	const sessionId = ctx.sessionManager.getSessionId();
	const stopWake = events.on("rqw:wait-steer:v1", (event: any) => { if (event?.sessionId === sessionId) wake(); });
	if (count || (session?.agent as any)?.steeringQueue?.messages?.some((message: any) => message.role === "user")) wake();
	const announce = waitOnly(ctx, call);
	if (announce) events.emit("rqw:waiting:v1", { sessionId, call, open: true });
	return { signal: controller.signal, close() {
		unsubscribe?.();
		stopWake();
		if (announce) events.emit("rqw:waiting:v1", { sessionId, call, open: false });
	} };
}
