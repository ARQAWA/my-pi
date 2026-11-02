import { randomUUID } from "node:crypto";
import { AgentSession, VERSION, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { waitCard } from "./card.ts";

type Result = { id: string; text: string; outcome: string; run?: string; delivery?: string; title?: string; exit_code?: number; output_path?: string };
type Source = { version: 1; snapshot(): { targets: string[]; titles?: Record<string, string>; ready: boolean }; subscribe(listener: (value: true | null) => void): () => void;
	claim(): { token: string; results: Result[] } | undefined; commit(token: string): void; release(token: string): void };
type Claim = { source: Source; token: string; results: Result[] };

export default function autoWait(pi: ExtensionAPI) {
	let ctx: ExtensionContext | undefined;
	let manager: ExtensionContext["sessionManager"] | undefined;
	let sessionId: string | undefined;
	let generation = 0, scheduled = false, armed = false, aborted = false, compacting = false, flight = false;
	let pending: { id: string; claims: Claim[] } | undefined;
	let restore: (() => void) | undefined;
	const sources = new Map<Source, () => void>();
	const card = waitCard(pi);
	let active = false;
	function setActive(value: boolean) {
		if (active === value) return;
		active = value;
		pi.events.emit("rqw:auto-wait:state:v1", { sessionId, active });
	}

	function release() {
		if (!pending) return;
		const claims = pending.claims; pending = undefined;
		for (const claim of claims) claim.source.release(claim.token);
	}
	function reconcile() {
		if (!pending || !manager) return false;
		const id = pending.id;
		const saved = manager.getBranch().some(entry => entry.type === "custom_message" && entry.customType === "rqw-auto-wait-results"
			&& (entry.details as { batch?: unknown } | undefined)?.batch === id);
		if (!saved) return false;
		const claims = pending.claims; pending = undefined;
		for (const claim of claims) claim.source.commit(claim.token);
		return true;
	}
	/** A wake whose start failed before any run existed gives its results back at once; the next settle or an explicit wait takes them. */
	function startFailed(batch: unknown) {
		if (pending?.id !== batch || !ctx?.isIdle() || reconcile()) return;
		flight = false; release();
	}
	function clearSources() {
		for (const unsubscribe of sources.values()) unsubscribe();
		sources.clear();
	}
	function requestCheck() {
		if (!ctx || !armed || scheduled) return;
		scheduled = true;
		const version = generation, current = ctx, leaf = manager?.getLeafId();
		queueMicrotask(() => {
			scheduled = false;
			if (generation !== version) { requestCheck(); return; }
			if (ctx !== current || manager?.getLeafId() !== leaf || !armed || aborted || compacting || flight
				|| current.signal?.aborted || !current.isIdle() || current.hasPendingMessages()) return;
			const claims: Claim[] = [];
			for (const source of sources.keys()) {
				const claim = source.claim();
				if (claim) claims.push({ source, ...claim });
			}
			if (!claims.length) {
				const snapshots = [...sources.keys()].map(source => source.snapshot());
				const targets = snapshots.flatMap(snapshot => snapshot.targets);
				const titles = Object.assign({}, ...snapshots.map(snapshot => snapshot.titles));
				setActive(targets.length > 0); card.show(targets, titles); return;
			}
			setActive(true); card.close("result");
			const id = randomUUID();
			pending = { id, claims }; flight = true; armed = false;
			const results = claims.flatMap(claim => claim.results);
			const content = JSON.stringify({ results: results.map(({ run: _run, delivery: _delivery, ...result }) => result) });
			try {
				pi.sendMessage({ customType: "rqw-auto-wait-results", content, display: false,
					details: { batch: id, results: results.map(({ id, run, delivery }) => ({ id, run, delivery })) } }, { triggerTurn: true });
			} catch { flight = false; release(); }
		});
	}
	function adopt(source: Source) {
		if (!source || source.version !== 1 || [source.snapshot, source.subscribe, source.claim, source.commit, source.release].some(fn => typeof fn !== "function") || sources.has(source)) return;
		let ended = false;
		const unsubscribe = source.subscribe(value => {
			if (value === null) { ended = true; sources.get(source)?.(); sources.delete(source); }
			requestCheck();
		});
		if (ended) unsubscribe(); else sources.set(source, unsubscribe);
		requestCheck();
	}
	pi.events.on("rqw:auto-wait:offer:v1", (offer: any) => { if (offer?.sessionId === sessionId) adopt(offer.source); });
	pi.events.on("rqw:auto-wait:capability:v1", (request: any) => {
		if (ctx && request?.sessionId === sessionId && typeof request.offer === "function") request.offer();
	});
	pi.events.on("rqw:stop-background:v1", (request: any) => {
		if (!ctx || request?.sessionId !== sessionId) return;
		generation++; armed = false; aborted = true; card.close("stop"); setActive(false);
	});
	pi.on("session_start", (_event, current) => {
		setActive(false); generation++; scheduled = armed = aborted = compacting = flight = false;
		release(); clearSources(); restore?.(); restore = undefined;
		ctx = current; manager = current.sessionManager; sessionId = manager.getSessionId();
		card.restore(current);
		if (current.mode !== "tui") { ctx = undefined; return; }
		const proto = AgentSession.prototype;
		const descriptor = Object.getOwnPropertyDescriptor(proto, "prompt");
		const sendDescriptor = Object.getOwnPropertyDescriptor(proto, "sendCustomMessage");
		const patchable = (value?: PropertyDescriptor): value is PropertyDescriptor => !!value && typeof value.value === "function" && !!value.writable && !!value.configurable;
		if (VERSION !== "1.4.0" || !patchable(descriptor) || !patchable(sendDescriptor)) {
			current.ui.notify("RQW-auto-wait: incompatible Pi prompt; automatic wake disabled.", "warning");
			ctx = undefined; return;
		}
		const original = descriptor.value;
		const wrapped = function(this: AgentSession, text: string, options?: any) {
			if (flight && this.sessionManager === manager && this.isStreaming && options?.streamingBehavior === undefined)
				return original.call(this, text, { ...options, streamingBehavior: "followUp" });
			return original.call(this, text, options);
		};
		Object.defineProperty(proto, "prompt", { ...descriptor, value: wrapped });
		// Pi reports a failed custom-message start only as an extension error, so watch the rejection here.
		const originalSend = sendDescriptor.value;
		const wrappedSend = function(this: AgentSession, message: { customType?: string; details?: { batch?: unknown } }, options?: unknown) {
			const result = originalSend.call(this, message, options);
			if (this.sessionManager !== manager || message?.customType !== "rqw-auto-wait-results") return result;
			return Promise.resolve(result).catch(error => { startFailed(message.details?.batch); throw error; });
		};
		Object.defineProperty(proto, "sendCustomMessage", { ...sendDescriptor, value: wrappedSend });
		restore = () => {
			if (Object.getOwnPropertyDescriptor(proto, "prompt")?.value === wrapped) Object.defineProperty(proto, "prompt", descriptor);
			if (Object.getOwnPropertyDescriptor(proto, "sendCustomMessage")?.value === wrappedSend) Object.defineProperty(proto, "sendCustomMessage", sendDescriptor);
		};
		pi.events.emit("rqw:auto-wait:request:v1", { sessionId, offer: adopt });
	});
	pi.on("session_tree", (_event, current) => { setActive(false); generation++; armed = flight = false; release(); card.restore(current); });
	pi.on("session_shutdown", () => { setActive(false); generation++; armed = flight = false; release(); clearSources(); restore?.(); restore = undefined; ctx = undefined; manager = undefined; sessionId = undefined; });
	pi.on("input", () => { generation++; armed = false; card.close("input"); setActive(false); return { action: "continue" }; });
	pi.on("before_agent_start", event => {
		if (event.messageType === "custom" && event.message.customType === "rqw-auto-wait-results") return;
		if (pending && !reconcile()) { flight = false; release(); }
	});
	pi.on("before_provider_request", () => { reconcile(); });
	pi.on("session_before_compact", () => { compacting = true; });
	pi.on("session_compact", () => { compacting = false; });
	pi.on("session_compact_failed", () => { compacting = false; });
	pi.on("agent_settled", event => {
		if (!ctx) return;
		if (!reconcile()) release();
		flight = false; aborted = event.aborted; armed = !aborted;
		requestCheck();
	});
}
