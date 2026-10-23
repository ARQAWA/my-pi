// Socket-local incremental continuation (source: codex-rs core/src/client.rs:391-460 comparator,
// 1496-1561 and 2087-2194 suffix/previous_response_id reuse). A response ID is only ever reused on the socket
// that produced it; the next request sends just the suffix after the previous full input and raw outputs.
import { orderBody, type WireItem } from "./wire.ts";

/** Native reasons, client.rs:391-460 (`*_changed`). */
export type FullReason =
	| "no_previous_response"
	| "model_changed"
	| "tools_changed"
	| "tool_choice_changed"
	| "parallel_tool_calls_changed"
	| "reasoning_changed"
	| "store_changed"
	| "stream_changed"
	| "include_changed"
	| "service_tier_changed"
	| "prompt_cache_key_changed"
	| "text_changed"
	| "input_not_extended";

export type Prepared =
	| { mode: "full"; reason: FullReason; body: Record<string, unknown> }
	| { mode: "incremental"; reason: "extends_previous_output"; body: Record<string, unknown>; previousResponseId: string; suffix: WireItem[] };

interface SocketState {
	request: Record<string, unknown>;
	responseId: string;
	rawOutputs: WireItem[];
}

// Exhaustive list of comparator fields. Input, client_metadata, stream_options and access_programs are not compared.
const COMPARED: [string, FullReason][] = [
	["model", "model_changed"],
	["tools", "tools_changed"],
	["tool_choice", "tool_choice_changed"],
	["parallel_tool_calls", "parallel_tool_calls_changed"],
	["reasoning", "reasoning_changed"],
	["store", "store_changed"],
	["stream", "stream_changed"],
	["include", "include_changed"],
	["service_tier", "service_tier_changed"],
	["prompt_cache_key", "prompt_cache_key_changed"],
	["text", "text_changed"],
];

/** Structural JSON equality; object key order is irrelevant, undefined equals absent. */
export function jsonEqual(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (Array.isArray(a) || Array.isArray(b)) {
		if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
		return a.every((item, i) => jsonEqual(item, b[i]));
	}
	if (a && b && typeof a === "object" && typeof b === "object") {
		const ka = Object.keys(a).filter((k) => (a as Record<string, unknown>)[k] !== undefined);
		const kb = Object.keys(b).filter((k) => (b as Record<string, unknown>)[k] !== undefined);
		if (ka.length !== kb.length) return false;
		return ka.every((k) => jsonEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
	}
	return false;
}

export function nonInputMismatch(previous: Record<string, unknown>, current: Record<string, unknown>): FullReason | undefined {
	for (const [key, reason] of COMPARED) {
		if (!jsonEqual(previous[key], current[key])) return reason;
	}
	return undefined;
}

export class Continuation {
	private sockets = new Map<string, SocketState>();

	/**
	 * Decides between a full request and an incremental one for `socketIdentity`. `fullRequest` is the complete
	 * logical body (before any previous_response_id). The returned body is in native key order.
	 */
	prepare(fullRequest: Record<string, unknown>, socketIdentity: string): Prepared {
		const state = this.sockets.get(socketIdentity);
		if (!state) return { mode: "full", reason: "no_previous_response", body: orderBody(fullRequest) };
		const mismatch = nonInputMismatch(state.request, fullRequest);
		if (mismatch) return { mode: "full", reason: mismatch, body: orderBody(fullRequest) };
		const input = fullRequest.input as WireItem[];
		const baseline = [...(state.request.input as WireItem[]), ...state.rawOutputs];
		if (input.length < baseline.length) return { mode: "full", reason: "input_not_extended", body: orderBody(fullRequest) };
		for (let i = 0; i < baseline.length; i++) {
			if (!jsonEqual(baseline[i], input[i])) return { mode: "full", reason: "input_not_extended", body: orderBody(fullRequest) };
		}
		const suffix = input.slice(baseline.length);
		const body = orderBody({ ...fullRequest, input: suffix, previous_response_id: state.responseId });
		return { mode: "incremental", reason: "extends_previous_output", body, previousResponseId: state.responseId, suffix };
	}

	/**
	 * Records a completed response on `socketIdentity`. `rawItems` are the backend output items exactly as received;
	 * they are cloned, never normalized, so encrypted reasoning, custom and unknown items replay unchanged.
	 */
	acceptCompleted(request: Record<string, unknown>, responseId: string, rawItems: readonly WireItem[], socketIdentity: string): void {
		if (!responseId) throw new Error("completed response has no id");
		const { previous_response_id: _ignored, ...full } = request;
		this.sockets.set(socketIdentity, {
			request: structuredClone(full),
			responseId,
			rawOutputs: structuredClone([...rawItems]),
		});
	}

	/** Drops one socket's state, or every socket's state when no identity is given (reconnect, auth or owner change). */
	invalidate(socketIdentity?: string): void {
		if (socketIdentity === undefined) this.sockets.clear();
		else this.sockets.delete(socketIdentity);
	}

	/** Test and diagnostics seam: the number of sockets holding a continuation. */
	get size(): number {
		return this.sockets.size;
	}
}
