// Live list of Main's direct agent starts, per model. One slot is one start with all its own helpers; helpers are not counted.
// It only watches Main's own `agent` calls: a start enters the list, a delivered final result or a stop takes it out.
export type Call = {
	action: "start" | "restart" | "send" | "resume" | "stop";
	id?: string;
	/** The resolved model of a start or restart. */
	model?: string;
	/** True while the call may still take a new slot, so parallel starts in one turn cannot overbook. */
	holds?: boolean;
};

type Limits = Record<string, number>;

export class Slots {
	private live = new Map<string, string>();
	// Agents whose final result was delivered: a later send or resume runs them again, in the slot they had.
	private ended = new Map<string, string>();
	private calls = new Map<string, Call>();

	clear(): void {
		this.live.clear();
		this.ended.clear();
		this.calls.clear();
	}

	modelOf(id: string): string | undefined {
		return this.live.get(id);
	}

	/** The model of an agent whose final result was delivered; a send or resume would take that slot again. */
	endedModelOf(id: string): string | undefined {
		return this.ended.get(id);
	}

	/** `except` is an agent whose own pending hold is not counted against itself. */
	used(model: string, except?: string): number {
		let used = 0;
		for (const m of this.live.values()) if (m === model) used++;
		// Calls on one agent share one hold, so two sends to the same ended agent take one slot.
		const holders = new Set<string>();
		for (const [toolCallId, call] of this.calls) {
			if (!call.holds || call.model !== model) continue;
			// A send that already made its agent live is counted in the live list.
			if (call.id && call.action !== "restart" && this.live.has(call.id)) continue;
			holders.add(call.id ?? toolCallId);
		}
		holders.delete(except ?? "");
		return used + holders.size;
	}

	/** `own` is the model the restarted agent already holds a slot on; that slot stays its own. */
	isFree(limits: Limits, model: string, own?: string, except?: string): boolean {
		return limits[model] === undefined || model === own || this.used(model, except) < limits[model];
	}

	describeFull(limits: Limits, models: string[]): string {
		return models.map((model) => `${model} ${this.used(model)}/${limits[model]}`).join(", ");
	}

	begin(toolCallId: string, call: Call): void {
		this.calls.set(toolCallId, call);
	}

	/**
	 * Reads the finished call. A failed call changes nothing, except that
	 * a failed stop means the agent is gone. A failed restart keeps the slot: it may fail before or after RQW-agent closes
	 * the old agent, and the `stop` that follows frees the slot either way.
	 */
	end(toolCallId: string, result: any, isError: boolean): void {
		const call = this.calls.get(toolCallId);
		this.calls.delete(toolCallId);
		if (isError) {
			if (call?.id && call.action === "stop") this.forget(call.id);
			return;
		}
		if (!call) return;
		if (call.action === "start") {
			const id = /^(agent#\d+) started/.exec(textOf(result))?.[1];
			if (id && call.model) this.take(id, call.model);
		} else if (call.action === "restart") {
			if (call.id && call.model) this.take(call.id, call.model);
		} else if (call.action === "send" || call.action === "resume") {
			// An agent that is already live keeps the slot and model it has, also against a restart that ran meanwhile.
			if (call.id && call.model && !this.live.has(call.id)) this.take(call.id, call.model);
		} else if (call.id) {
			this.forget(call.id);
		}
	}

	/** The automatic result message lists the agents whose final results it delivers; their slots are free. */
	delivered(details: any): void {
		for (const item of Array.isArray(details?.results) ? details.results : []) {
			if (typeof item?.id === "string") this.finish(item.id);
		}
	}

	/** A stopped agent is gone: its slot is free and a send or resume still in flight must not bring it back. */
	private forget(id: string): void {
		this.live.delete(id);
		this.ended.delete(id);
		for (const [toolCallId, call] of this.calls) if (call.id === id && call.action !== "stop") this.calls.delete(toolCallId);
	}

	private take(id: string, model: string): void {
		this.live.set(id, model);
		this.ended.delete(id);
	}

	private finish(id: string): void {
		const model = this.live.get(id);
		if (model === undefined) return;
		this.live.delete(id);
		this.ended.set(id, model);
	}
}

function textOf(result: any): string {
	const part = Array.isArray(result?.content) ? result.content.find((c: any) => c?.type === "text") : undefined;
	return typeof part?.text === "string" ? part.text : "";
}
