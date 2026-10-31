import { VERSION, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { sessionOf } from "./fork-payload.ts";

const REQUEST = "rqw:running-counts:request";
const OFFER = "rqw:running-counts:offer";
type Source = { version: number; snapshot(): { agents?: number; backgroundProcesses?: number }; subscribe(listener: (value: unknown) => void): () => void };
type Message = { role: string };
type Queue = { messages: Message[]; mode: string; drain(): Message[]; peek(): Message[]; hasItems(): boolean; enqueue(message: Message): void; clear(): void };

/** Hide only user follow-ups while the main caller still has work in the background. */
export function registerFollowUpHold(pi: ExtensionAPI, waiting: (background: boolean) => boolean) {
	let release = () => {};
	let delivered = () => {};
	let settled = () => {};
	pi.on("message_start", event => { if (event.message.role === "user") delivered(); });
	pi.on("agent_settled", () => settled());
	pi.on("session_start", (_event, ctx) => {
		release();
		if (ctx.mode !== "tui") return;
		const session = sessionOf(ctx);
		if (!session) return;
		const queue = (session.agent as unknown as { followUpQueue?: Queue }).followUpQueue;
		if (VERSION !== "1.4.0" || !queue || !Array.isArray(queue.messages) || !["all", "one-at-a-time"].includes(queue.mode)
			|| ![queue.drain, queue.peek, queue.hasItems, queue.enqueue, queue.clear].every(method => typeof method === "function")) {
			ctx.ui.notify("Follow-up hold unavailable; using Pi's queue.", "warning");
			return;
		}
		const stopCapability = pi.events.on("rqw:followup-hold:request", (request: any) => {
			if (request?.sessionId === ctx.sessionManager.getSessionId() && typeof request.reply === "function") request.reply();
		});
		const sources = new Map<Source, () => void>();
		let changed = () => {};
		const adopt = (value: unknown) => {
			const source = value as Source;
			if (!source || source.version !== 1 || typeof source.snapshot !== "function" || typeof source.subscribe !== "function" || sources.has(source)) return;
			let ended = false;
			const unsubscribe = source.subscribe(counts => { if (counts === null) { ended = true; sources.get(source)?.(); sources.delete(source); } changed(); });
			if (ended) unsubscribe(); else sources.set(source, unsubscribe);
		};
		const stopOffer = pi.events.on(OFFER, (offer: any) => { if (offer?.version === 1) adopt(offer.source); });
		pi.events.emit(REQUEST, { version: 1, reply: adopt });
		const held = () => waiting([...sources.keys()].some(source => { const count = source.snapshot(); return (count.agents ?? 0) > 0 || (count.backgroundProcesses ?? 0) > 0; }));
		const original = { drain: queue.drain, peek: queue.peek, hasItems: queue.hasItems, enqueue: queue.enqueue, clear: queue.clear };
		const privateSession = session as unknown as { _startRun?: (trigger: object) => Promise<void>; getSteeringMessages?: () => readonly string[]; clearQueue?: () => { steering: string[]; followUp: string[] } };
		let timer: ReturnType<typeof setTimeout> | undefined;
		let active = true, running = false, seen = false;
		let inFlight: Message | undefined;
		const status = () => ctx.ui.setStatus("rqw-followup-hold", held() && queue.messages.some(message => message.role === "user") ? "follow-up waits for the final answer" : undefined);
		const schedule = () => {
			status();
			if (timer || held() || !queue.messages.length || running) return;
			timer = setTimeout(() => {
				timer = undefined;
				if (!active || held() || !ctx.isIdle() || running || queue.messages.some(message => message.role !== "user") || privateSession.getSteeringMessages?.().length !== 0) return;
				const first = queue.messages[0] as (Message & { content?: { type?: string; text?: string }[] }) | undefined;
				if (!first || !Array.isArray(first.content) || first.content.length !== 1 || first.content[0].type !== "text" || typeof first.content[0].text !== "string" || typeof privateSession._startRun !== "function") return;
				queue.messages.shift(); running = true; seen = false; inFlight = first;
				let result: Promise<void>;
				try { result = privateSession._startRun({ messageType: "user", prompt: first.content[0].text }); }
				catch { queue.messages.unshift(first); inFlight = undefined; running = false; status(); return; }
				void result.catch(() => {}).finally(() => {
					if (!seen && active) queue.messages.unshift(first);
					inFlight = undefined;
					running = false;
					if (active && seen) schedule();
					else if (active) status();
				});
			}, 0);
		};
		changed = schedule;
		delivered = () => { if (running) seen = true; };
		settled = schedule;
		const visible = () => queue.messages.filter(message => message.role !== "user");
		queue.peek = function () { if (!held()) return original.peek.call(this); const messages = visible(); return this.mode === "all" ? messages : messages.slice(0, 1); };
		queue.hasItems = function () { return held() ? visible().length > 0 : original.hasItems.call(this); };
		queue.drain = function () {
			if (!held()) return original.drain.call(this);
			const messages = this.peek();
			const selected = new Set(messages);
			this.messages = this.messages.filter(message => !selected.has(message));
			return messages;
		};
		queue.enqueue = function (message) { original.enqueue.call(this, message); schedule(); };
		queue.clear = function () { original.clear.call(this); status(); };
		release = () => {
			active = false;
			if (timer) clearTimeout(timer);
			delivered = () => {}; settled = () => {};
			if ((queue.messages.some(message => message.role === "user") || (inFlight && !seen)) && typeof privateSession.clearQueue === "function") {
				const agent = session.agent as unknown as { steeringQueue?: Queue };
				const otherFollowUps = queue.messages.filter(message => message.role !== "user");
				const otherSteering = agent.steeringQueue?.messages?.filter(message => message.role !== "user") ?? [];
				const restored = privateSession.clearQueue();
				queue.messages.push(...otherFollowUps);
				agent.steeringQueue?.messages.push(...otherSteering);
				const draft = ctx.ui.getEditorText();
				ctx.ui.setEditorText([...restored.steering, ...restored.followUp, draft].filter(Boolean).join("\n\n"));
			}
			ctx.ui.setStatus("rqw-followup-hold", undefined);
			stopCapability(); stopOffer();
			for (const unsubscribe of sources.values()) unsubscribe();
			Object.assign(queue, original);
			release = () => {};
		};
	});
	pi.on("session_shutdown", () => release());
}
