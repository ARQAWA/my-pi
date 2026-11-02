import { randomUUID } from "node:crypto";
import { AgentSession, VERSION, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { waitCard } from "./card.ts";
import { countsWatch } from "./counts.ts";

type Result = { id: string; text: string; outcome: string; run?: string; delivery?: string; title?: string; exit_code?: number; output_path?: string };
type Source = { version: 1; snapshot(): { targets: string[]; titles?: Record<string, string>; ready: boolean }; subscribe(listener: (value: true | null) => void): () => void;
	claim(): { token: string; results: Result[] } | undefined; commit(token: string): void; release(token: string): void };
type Claim = { source: Source; token: string; results: Result[] };
const TYPE = "rqw-auto-wait-results";

function patchable(value?: PropertyDescriptor): value is PropertyDescriptor {
	return !!value && typeof value.value === "function" && !!value.writable && !!value.configurable;
}

export default function autoWait(pi: ExtensionAPI) {
	let ctx: ExtensionContext | undefined;
	let manager: ExtensionContext["sessionManager"] | undefined;
	let sessionId: string | undefined;
	let generation = 0, scheduled = false, armed = false, aborted = false, compacting = false, flight = false;
	// tui and rpc deliver when Pi is idle; print and json hold the settle boundary instead.
	let deliverOnIdle = false, holdSettle = false, holdEpoch = 0;
	let wakeHold: (() => void) | undefined;
	let pending: { id: string; claims: Claim[] } | undefined;
	let restore: (() => void) | undefined;
	const sources = new Map<Source, () => void>();
	const card = waitCard(pi);
	const counts = countsWatch(pi.events, () => requestCheck());
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
		const saved = manager.getBranch().some(entry => entry.type === "custom_message" && entry.customType === TYPE
			&& (entry.details as { batch?: unknown } | undefined)?.batch === id);
		if (!saved) return false;
		const claims = pending.claims; pending = undefined;
		for (const claim of claims) claim.source.commit(claim.token);
		return true;
	}
	/** Ends the current settle hold, if any: its loop sees the new epoch and returns. */
	function releaseHold() {
		holdEpoch++; wake();
	}
	function wake() {
		const resolve = wakeHold; wakeHold = undefined; resolve?.();
	}
	function claimAll() {
		const claims: Claim[] = [];
		for (const source of sources.keys()) {
			const claim = source.claim();
			if (claim) claims.push({ source, ...claim });
		}
		return claims;
	}
	function resultsMessage(claims: Claim[]) {
		const id = randomUUID();
		const results = claims.flatMap(claim => claim.results);
		const content = JSON.stringify({ results: results.map(({ run: _run, delivery: _delivery, ...result }) => result) });
		return { id, content, details: { batch: id, results: results.map(({ id, run, delivery }) => ({ id, run, delivery })) } };
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
	function showCard() {
		const snapshots = [...sources.keys()].map(source => source.snapshot());
		const targets = snapshots.flatMap(snapshot => snapshot.targets);
		const titles = Object.assign({}, ...snapshots.map(snapshot => snapshot.titles));
		card.show(targets, titles, counts.get());
		return targets.length;
	}
	function requestCheck() {
		if (!ctx || !armed || scheduled) return;
		scheduled = true;
		const version = generation, current = ctx, leaf = manager?.getLeafId();
		queueMicrotask(() => {
			scheduled = false;
			if (generation !== version || manager?.getLeafId() !== leaf) { requestCheck(); return; }
			if (ctx !== current || !armed || aborted || compacting || flight || current.signal?.aborted) return;
			if (!current.isIdle() || current.hasPendingMessages()) {
				if (active && current.mode === "tui" && !showCard()) setActive(false);
				return;
			}
			const claims = claimAll();
			if (!claims.length) {
				if (current.mode === "tui") setActive(showCard() > 0);
				else setActive([...sources.keys()].some(source => source.snapshot().targets.length > 0));
				return;
			}
			setActive(true); card.close("result");
			const { id, content, details } = resultsMessage(claims);
			pending = { id, claims }; flight = true; armed = false;
			try {
				pi.sendMessage({ customType: TYPE, content, display: false, details }, { triggerTurn: true });
			} catch { flight = false; release(); }
		});
	}
	function adopt(source: Source) {
		if (!source || source.version !== 1 || [source.snapshot, source.subscribe, source.claim, source.commit, source.release].some(fn => typeof fn !== "function") || sources.has(source)) return;
		let ended = false;
		const unsubscribe = source.subscribe(value => {
			if (value === null) { ended = true; sources.get(source)?.(); sources.delete(source); }
			requestCheck(); wake();
		});
		if (ended) unsubscribe(); else sources.set(source, unsubscribe);
		requestCheck();
	}
	pi.events.on("rqw:auto-wait:offer:v1", (offer: any) => { if (offer?.sessionId === sessionId) adopt(offer.source); });
	pi.events.on("rqw:stop-background:v1", (request: any) => {
		if (!ctx || request?.sessionId !== sessionId) return;
		generation++; armed = false; aborted = true; card.close("stop"); setActive(false); releaseHold();
	});
	/** Idle delivery in tui and rpc: input during a wake becomes a follow-up, and a failed wake start gives its results back. */
	function installIdle(): (() => void) | undefined {
		const proto = AgentSession.prototype;
		const descriptor = Object.getOwnPropertyDescriptor(proto, "prompt");
		const sendDescriptor = Object.getOwnPropertyDescriptor(proto, "sendCustomMessage");
		if (!patchable(descriptor) || !patchable(sendDescriptor)) return undefined;
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
			if (this.sessionManager !== manager || message?.customType !== TYPE) return result;
			return Promise.resolve(result).catch(error => { startFailed(message.details?.batch); throw error; });
		};
		Object.defineProperty(proto, "sendCustomMessage", { ...sendDescriptor, value: wrappedSend });
		return () => {
			if (Object.getOwnPropertyDescriptor(proto, "prompt")?.value === wrapped) Object.defineProperty(proto, "prompt", descriptor);
			if (Object.getOwnPropertyDescriptor(proto, "sendCustomMessage")?.value === wrappedSend) Object.defineProperty(proto, "sendCustomMessage", sendDescriptor);
		};
	}
	/** Print and json exit when the turn settles, so the hold in `agent_before_settle` must end on a stop: an abort has to release it. */
	function installHold(): (() => void) | undefined {
		const proto = AgentSession.prototype;
		const descriptor = Object.getOwnPropertyDescriptor(proto, "abort");
		if (!patchable(descriptor) || typeof (proto as any)._runBeforeSettleBoundary !== "function") return undefined;
		const original = descriptor.value;
		const wrapped = function(this: AgentSession, ...args: unknown[]) {
			if (this.sessionManager === manager) releaseHold();
			return original.apply(this, args);
		};
		Object.defineProperty(proto, "abort", { ...descriptor, value: wrapped });
		return () => {
			if (Object.getOwnPropertyDescriptor(proto, "abort")?.value === wrapped) Object.defineProperty(proto, "abort", descriptor);
		};
	}
	pi.on("session_start", (_event, current) => {
		setActive(false); generation++; scheduled = armed = aborted = compacting = flight = deliverOnIdle = holdSettle = false;
		release(); releaseHold(); clearSources(); counts.stop(); restore?.(); restore = undefined;
		ctx = current; manager = current.sessionManager; sessionId = manager.getSessionId();
		card.restore(current);
		const idle = current.mode === "tui" || current.mode === "rpc";
		if (!idle && current.mode !== "print" && current.mode !== "json") { ctx = undefined; return; }
		restore = VERSION === "1.4.0" ? idle ? installIdle() : installHold() : undefined;
		if (!restore) {
			current.ui.notify(`RQW-auto-wait: incompatible Pi ${idle ? "prompt" : "abort"}; automatic ${idle ? "wake" : "hold"} disabled.`, "warning");
			ctx = undefined; return;
		}
		deliverOnIdle = idle; holdSettle = !idle;
		counts.start();
		pi.events.emit("rqw:auto-wait:request:v1", { sessionId, offer: adopt });
	});
	/** Print and json: keep the turn open while direct agents or jobs run, then hand their results over in the same run. */
	pi.on("agent_before_settle", async event => {
		if (!holdSettle) return;
		const epoch = holdEpoch;
		for (;;) {
			if (!ctx || epoch !== holdEpoch) return;
			const claims = claimAll();
			if (claims.length) {
				const { id, content, details } = resultsMessage(claims);
				pending = { id, claims };
				return { entries: [...event.entries, { type: "custom_message" as const, customType: TYPE, content, display: false, details }], continue: true };
			}
			if (event.continue || ![...sources.keys()].some(source => source.snapshot().targets.length > 0)) return;
			await new Promise<void>(resolve => { wakeHold = resolve; });
		}
	});
	pi.on("session_tree", (_event, current) => { setActive(false); generation++; armed = flight = false; release(); releaseHold(); card.restore(current); });
	// A wake handed to the session but not yet saved would still send its request after the shutdown, in the next session: stop it.
	pi.on("session_shutdown", () => { if (flight && pending && !reconcile()) ctx?.abort(); setActive(false); generation++; armed = flight = deliverOnIdle = holdSettle = false; release(); releaseHold(); clearSources(); counts.stop(); restore?.(); restore = undefined; ctx = undefined; manager = undefined; sessionId = undefined; });
	pi.on("input", () => { generation++; armed = false; card.close("input"); setActive(false); return { action: "continue" }; });
	pi.on("before_agent_start", event => {
		if (event.messageType === "custom" && event.message.customType === TYPE) return;
		if (pending && !reconcile()) { flight = false; release(); }
	});
	pi.on("before_provider_request", () => { reconcile(); });
	pi.on("session_before_compact", () => { compacting = true; });
	pi.on("session_compact", () => { compacting = false; });
	pi.on("session_compact_failed", () => { compacting = false; });
	pi.on("agent_settled", event => {
		if (!ctx) return;
		if (!reconcile()) release();
		flight = false; aborted = event.aborted; armed = !aborted && deliverOnIdle;
		requestCheck();
	});
}
