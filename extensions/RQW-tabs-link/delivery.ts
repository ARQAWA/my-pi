// Receiving side of send_message_to_chat: an ordered, bounded queue that never interrupts the owner's work.
import { createHash } from "node:crypto";
import type { Model } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export const MESSAGE_TYPE = "rqw-tabs-link";
const ACCEPTED = "rqw-tabs-link-accepted";
const RESTORE = "rqw-tabs-link-restore";
const MAX_QUEUE = 20;

type Level = ReturnType<ExtensionAPI["getThinkingLevel"]>;
type Ref = { provider: string; id: string };
export type DeliverParams = { from: string; key: string; prompt: string; model?: string };
export type DeliverReply =
	| { status: "accepted" | "delivered" | "unknown" }
	| { error: "queue_full" | "model_unavailable" | "duplicate_conflict" | "bad_request"; message: string };

type Item = { key: string; text: string; from: string; model?: Model<any> };
type Known = { hash: string; state: "accepted" | "delivered" | "unknown" | "model_unavailable" };
type Marker = { pending?: { model?: Ref; level: Level }; applied?: { model?: Ref; level?: Level } };
/** What a one-turn model override changed, so only untouched settings are put back. */
type Override = { key: string; before: { model?: Ref; level: Level }; ownerModel: boolean; ownerLevel: boolean };

const refOf = (model: Model<any> | undefined): Ref | undefined => model && { provider: model.provider, id: model.id };
const same = (a: Ref | undefined, b: Ref | undefined) => a?.provider === b?.provider && a?.id === b?.id;
const hashOf = (params: DeliverParams) => createHash("sha256").update(JSON.stringify([params.prompt, params.model ?? null])).digest("hex");

export function createDelivery(pi: ExtensionAPI) {
	let ctx: ExtensionContext | undefined;
	let queue: Item[] = [];
	let known = new Map<string, Known>();
	/** Keys handed to Pi whose entry has not been seen in the history yet. */
	const sent = new Set<string>();
	let dialogs = 0;
	let override: Override | undefined;
	/** True while this extension itself changes model or level, so those events are not the owner's choice. */
	let internal = false;
	let pumping = false;
	/** The one delivered message whose turn has not ended yet; the next waits for its end and its restore. */
	let flight: { key: string; started: boolean } | undefined;

	const find = (spec: string): Model<any> | undefined => {
		const models = ctx?.modelRegistry.getAvailable() ?? [];
		const slash = spec.indexOf("/");
		return slash > 0
			? models.find(model => model.provider === spec.slice(0, slash) && model.id === spec.slice(slash + 1))
			: models.find(model => model.id === spec);
	};

	/** Puts back model and level independently; a setting the owner changed during the turn keeps the owner's choice. */
	async function restore(): Promise<void> {
		const taken = override;
		if (!taken) return;
		override = undefined;
		const model = taken.before.model && ctx?.modelRegistry.find(taken.before.model.provider, taken.before.model.id);
		internal = true;
		try {
			if (!taken.ownerModel && model) await pi.setModel(model);
			if (!taken.ownerLevel) pi.setThinkingLevel(taken.before.level);
		} finally { internal = false; }
		pi.appendEntry(RESTORE, { done: true });
	}

	function send(item: Item): void {
		sent.add(item.key);
		pi.sendMessage({
			customType: MESSAGE_TYPE, display: true,
			content: `Message from Pi chat ${item.from}, delegated by another agent and not written by the user:\n\n${item.text}`,
			details: { from: item.from, key: item.key },
		}, { triggerTurn: true, deliverAs: "followUp" });
	}

	/** Sends the queue in arrival order, one message at a time; stops at the first that must wait for a dialog, an idle chat or the turn before it. */
	async function pump(): Promise<void> {
		if (pumping) return;
		pumping = true;
		try {
			while (queue.length > 0 && ctx && dialogs === 0 && !flight) {
				const item = queue[0];
				if (item.model) {
					if (!ctx.isIdle()) return;
					const before = { model: refOf(ctx.model), level: pi.getThinkingLevel() };
					// The marker is durable before anything changes, so a crash can always be undone.
					pi.appendEntry(RESTORE, { pending: before, applied: { model: refOf(item.model) } });
					internal = true;
					let ok = false;
					// Pi throws when the provider has no key; that is a refused selection like a false answer.
					try { ok = await pi.setModel(item.model); } catch { ok = false; } finally { internal = false; }
					if (!ok) {
						queue.shift();
						known.set(item.key, { ...known.get(item.key)!, state: "model_unavailable" });
						pi.appendEntry(RESTORE, { done: true });
						ctx.ui.notify(`Delegated message dropped: model ${item.model.id} could not be selected.`, "warning");
						continue;
					}
					override = { key: item.key, before, ownerModel: false, ownerLevel: false };
					// The owner may have started a run while the model changed: put it back and wait for the next idle.
					if (!ctx.isIdle() || dialogs > 0) { await restore(); return; }
					pi.appendEntry(RESTORE, { pending: before, applied: { model: refOf(item.model), level: pi.getThinkingLevel() } });
				}
				queue.shift();
				flight = { key: item.key, started: false };
				send(item);
			}
		} finally { pumping = false; }
	}

	/** Delivered means the entry exists in Pi's history, which Pi writes after its message events. */
	function confirm(): void {
		if (sent.size === 0 || !ctx) return;
		for (const entry of ctx.sessionManager.getEntries()) {
			const key = entry.type === "custom_message" && entry.customType === MESSAGE_TYPE ? (entry.details as { key?: string } | undefined)?.key : undefined;
			const item = key && sent.has(key) ? known.get(key) : undefined;
			if (key && item) { item.state = "delivered"; sent.delete(key); }
		}
	}

	async function handle(params: DeliverParams): Promise<DeliverReply> {
		const valid = typeof params?.key === "string" && typeof params.from === "string" && typeof params.prompt === "string"
			&& params.prompt.trim() !== "" && Buffer.byteLength(params.prompt) <= 1000 && (params.model === undefined || typeof params.model === "string");
		if (!valid) return { error: "bad_request", message: "The prompt must be 1 to 1000 UTF-8 bytes." };
		const hash = hashOf(params);
		confirm();
		const prior = known.get(params.key);
		if (prior) {
			if (prior.hash !== hash) return { error: "duplicate_conflict", message: "This delivery id was already used with different content." };
			return reply(params);
		}
		// Everything accepted and not yet in the history counts, also what Pi already holds in its own queue.
		const waiting = [...known.values()].filter(entry => entry.state === "accepted").length;
		if (waiting >= MAX_QUEUE) return { error: "queue_full", message: "The chat has too many waiting messages." };
		let model: Model<any> | undefined;
		if (params.model !== undefined) {
			model = find(params.model);
			if (!model || !ctx?.modelRegistry.hasConfiguredAuth(model)) return { error: "model_unavailable", message: `Model ${params.model} is not available in that chat.` };
		}
		known.set(params.key, { hash, state: "accepted" });
		pi.appendEntry(ACCEPTED, { key: params.key, hash });
		queue.push({ key: params.key, text: params.prompt, from: params.from, model });
		await pump();
		return reply(params);
	}

	/** The current state of a delivery; a model that could not be selected when its turn came is an error, never delivered. */
	function reply(params: DeliverParams): DeliverReply {
		confirm();
		const state = known.get(params.key)!.state;
		return state === "model_unavailable"
			? { error: "model_unavailable", message: `Model ${params.model} could not be selected in that chat.` }
			: { status: state };
	}

	function attach(): void {
		const track = (_event: unknown, context: ExtensionContext) => { ctx = context; };
		pi.on("session_start", async (_event, context) => {
			ctx = context;
			queue = [];
			flight = undefined;
			sent.clear();
			dialogs = 0;
			override = undefined;
			// Everything accepted before a restart has an unknown fate; what reached the history is delivered.
			known = new Map();
			const entries = context.sessionManager.getEntries();
			let marker: Marker | undefined;
			for (const entry of entries) {
				if (entry.type === "custom" && entry.customType === ACCEPTED) {
					const data = entry.data as { key: string; hash: string };
					known.set(data.key, { hash: data.hash, state: "unknown" });
				} else if (entry.type === "custom" && entry.customType === RESTORE) {
					const data = entry.data as { done?: boolean } & Marker;
					marker = data.done ? undefined : data;
				} else if (entry.type === "custom_message" && entry.customType === MESSAGE_TYPE) {
					const key = (entry.details as { key?: string } | undefined)?.key;
					const hash = key && known.get(key)?.hash;
					if (key && hash) known.set(key, { hash, state: "delivered" });
				}
			}
			// A crash left a one-turn override in place: undo what is still exactly as the override set it.
			if (marker?.pending && marker.applied) {
				const model = marker.pending.model && context.modelRegistry.find(marker.pending.model.provider, marker.pending.model.id);
				const modelSet = same(refOf(context.model), marker.applied.model);
				internal = true;
				try {
					if (model && modelSet) await pi.setModel(model);
					// Before the level was recorded, a model still set by the override is the only proof of it.
					if (marker.applied.level === undefined ? modelSet : pi.getThinkingLevel() === marker.applied.level) pi.setThinkingLevel(marker.pending.level);
				} finally { internal = false; }
				pi.appendEntry(RESTORE, { done: true });
			}
		});
		pi.on("ui_prompt_start", (event, context) => { track(event, context); dialogs++; });
		pi.on("ui_prompt_end", async (event, context) => { track(event, context); dialogs = Math.max(0, dialogs - 1); await pump(); });
		pi.on("agent_settled", async (event, context) => {
			track(event, context);
			// Everything has settled and the in-flight message never started: it was lost (an aborted run, a cleared
			// queue, a failed send). Its fate is unknown, never delivered; its override is undone; the next one may go.
			if (flight && !flight.started) {
				const lost = flight.key;
				flight = undefined;
				const entry = known.get(lost);
				if (entry?.state === "accepted") entry.state = "unknown";
				if (override?.key === lost) await restore();
			}
			await pump();
		});
		pi.on("agent_end", async (event, context) => {
			track(event, context);
			await restore();
			if (flight?.started) { flight = undefined; await pump(); }
		});
		pi.on("model_select", () => { if (override && !internal) override.ownerModel = true; });
		pi.on("thinking_level_select", () => { if (override && !internal) override.ownerLevel = true; });
		// A queued message of the owner joins the run: its request must already use the owner's settings.
		pi.on("message_start", async (event, context) => {
			track(event, context);
			const message = event.message as { role: string; customType?: string; details?: { key?: string } };
			if (flight && message.role === "custom" && message.customType === MESSAGE_TYPE && message.details?.key === flight.key) flight.started = true;
			const ours = message.role === "custom" && message.customType === MESSAGE_TYPE && message.details?.key === override?.key;
			if (override && !ours && (message.role === "user" || (message.role === "custom" && message.customType === MESSAGE_TYPE))) await restore();
		});
	}

	return { handle, attach };
}
