// Live Responses event pump and completed-item retry handoff. Independent of transport.ts (no import from it).
// Native source (codex-rs pinned at rust-v0.163.0):
// - core/src/session/turn.rs:2801-2906: a tool future is queued only at ResponseEvent::OutputItemDone (push_back at 2905);
//   OutputItemAdded (2934) starts no tool, so an unfinished call never runs.
// - turn.rs:2769-2785: a stream error breaks the sampling loop with that error; turn.rs:3280-3288 drains the in-flight
//   tools after the loop on every outcome, so completed calls run and record their outputs before any retry.
// - turn.rs:1754-1756: a retry prompt is rebuilt from history (clone_history) with executed tool metadata attached.
// - turn.rs:1797-1800: usage-limit errors return without retry; turn.rs:2771: incomplete usage is recorded before the break.
// Pi side: the tool_handoff message is the entry into Pi's own tool loop, so tools never run inside the provider.
import { parseToolCallArguments } from "@earendil-works/pi-ai";
import type {
	Api,
	AssistantMessage,
	AssistantMessageDiagnostic,
	AssistantMessageEvent,
	AssistantMessageEventStream,
	Model,
	StopReason,
	TextContent,
	ToolCall,
	Usage,
} from "@earendil-works/pi-ai";

import { CodexError, classifyEvent, normalizeUsage, type CodexUsage } from "./errors.ts";
import type { OpenAIResponsesStreamOptions } from "@earendil-works/pi-ai/api/openai-responses-shared";
import { processResponsesStream } from "./display.mjs";
import { CODEX_RETRY_OWNED_DIAGNOSTIC } from "./retry.ts";

/** Bounded live queue between the upstream producer and the Pi display parser. */
export const LIVE_QUEUE_LIMIT = 128;

/** Diagnostic type for an honest partial handoff (tool_handoff message), carried in `diagnostics`, never in content. */
export const PARTIAL_HANDOFF_DIAGNOSTIC = "rqw_codex_partial_handoff";

/**
 * Text signature of a completed message item, so its id and phase survive Pi persistence and replay.
 * Port of encodeTextSignatureV1 in @earendil-works/pi-ai 1.4.0 (dist/api/openai-responses-shared.js), MIT licensed.
 * Local copy: the package's private helper is not exported and no deep import is added.
 */
function encodeTextSignatureV1(id: string, phase: string | undefined): string {
	const payload: { v: 1; id: string; phase?: string } = { v: 1, id };
	if (phase) payload.phase = phase;
	return JSON.stringify(payload);
}

const DROPPED_TOOL_CALL_MESSAGE =
	"Unfinished tool call dropped at the retry boundary: its arguments were incomplete and it was never executed.";

type NativeEvent = Record<string, unknown>;

// ---- bounded queue ----------------------------------------------------------------------------------------------

/**
 * Bounded FIFO with backpressure: push() waits while `limit` items are queued, and resumes when the consumer takes one.
 * close() keeps queued items for the consumer; cancel() drops them, releases waiting producers and makes the consumer throw.
 */
export class BoundedAsyncQueue<T> implements AsyncIterable<T> {
	readonly #limit: number;
	#items: T[] = [];
	#head = 0;
	#closed = false;
	#failure: { error: unknown } | undefined;
	#consumer: (() => void) | undefined;
	#producers: Array<() => void> = [];

	constructor(limit: number = LIVE_QUEUE_LIMIT) {
		if (!Number.isInteger(limit) || limit < 1) throw new RangeError("queue limit must be a positive integer");
		this.#limit = limit;
	}

	get size(): number {
		return this.#items.length - this.#head;
	}

	get limit(): number {
		return this.#limit;
	}

	get closed(): boolean {
		return this.#closed;
	}

	async push(item: T): Promise<void> {
		while (!this.#closed && this.size >= this.#limit) {
			await new Promise<void>((resolve) => {
				this.#producers.push(resolve);
			});
		}
		if (this.#closed) throw new Error("event queue closed");
		this.#items.push(item);
		const consumer = this.#consumer;
		this.#consumer = undefined;
		consumer?.();
	}

	close(): void {
		if (this.#closed) return;
		this.#closed = true;
		this.#releaseAll();
	}

	cancel(error: unknown = new Error("event queue cancelled")): void {
		this.#items = [];
		this.#head = 0;
		if (!this.#closed) {
			this.#failure = { error };
			this.close();
		} else {
			this.#failure ??= { error };
			this.#releaseAll();
		}
	}

	#releaseAll(): void {
		const consumer = this.#consumer;
		this.#consumer = undefined;
		consumer?.();
		const producers = this.#producers;
		this.#producers = [];
		for (const producer of producers) producer();
	}

	async *[Symbol.asyncIterator](): AsyncIterator<T> {
		try {
			while (true) {
				if (this.size > 0) {
					const item = this.#items[this.#head] as T;
					this.#items[this.#head] = undefined as T;
					this.#head++;
					if (this.#head === this.#items.length) {
						this.#items = [];
						this.#head = 0;
					}
					this.#producers.shift()?.();
					yield item;
				} else if (this.#closed) {
					if (this.#failure) throw this.#failure.error;
					return;
				} else {
					await new Promise<void>((resolve) => {
						this.#consumer = resolve;
					});
				}
			}
		} finally {
			// A consumer that stops early (return or throw) must not leave producers waiting.
			if (!this.#closed) this.cancel(new Error("event consumer stopped"));
		}
	}
}

// ---- usage and shared shapes -------------------------------------------------------------------------------------

const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };

export function emptyUsage(): Usage {
	return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { ...ZERO_COST } };
}

/** Pi usage from normalized Codex usage, with the field mapping of processResponsesStream. Cost is never estimated here. */
export function toPiUsage(usage: CodexUsage): Usage {
	return {
		input: Math.max(0, usage.inputTokens - usage.cachedInputTokens - usage.cacheWriteInputTokens),
		output: usage.outputTokens,
		cacheRead: usage.cachedInputTokens,
		cacheWrite: usage.cacheWriteInputTokens,
		reasoning: usage.reasoningOutputTokens,
		totalTokens: usage.totalTokens,
		cost: { ...ZERO_COST },
	};
}

/** Sums actual usage of separate attempts (failed attempts included); no estimate is added. */
export function addUsage(a: Usage, b: Usage): Usage {
	const reasoning = a.reasoning === undefined && b.reasoning === undefined ? undefined : (a.reasoning ?? 0) + (b.reasoning ?? 0);
	return {
		input: a.input + b.input,
		output: a.output + b.output,
		cacheRead: a.cacheRead + b.cacheRead,
		cacheWrite: a.cacheWrite + b.cacheWrite,
		...(reasoning === undefined ? {} : { reasoning }),
		totalTokens: a.totalTokens + b.totalTokens,
		cost: {
			input: a.cost.input + b.cost.input,
			output: a.cost.output + b.cost.output,
			cacheRead: a.cost.cacheRead + b.cost.cacheRead,
			cacheWrite: a.cost.cacheWrite + b.cost.cacheWrite,
			total: a.cost.total + b.cost.total,
		},
	};
}

export function emptyAssistantMessage(model: Model<Api>): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: emptyUsage(),
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function retryOwnedDiagnostics(timestamp: number): AssistantMessageDiagnostic[] {
	return [{ type: CODEX_RETRY_OWNED_DIAGNOSTIC, timestamp }];
}

function failureMessage(failure: unknown): string {
	if (failure instanceof Error && failure.message) return failure.message;
	return "Codex stream failed";
}

/** Ledger keys of one raw item: its backend id and its call id. An item is a duplicate if any key is already known. */
function itemKeys(item: Record<string, unknown> | undefined): string[] {
	if (!item) return [];
	const keys: string[] = [];
	if (typeof item.id === "string" && item.id !== "") keys.push(`id:${item.id}`);
	if (typeof item.call_id === "string" && item.call_id !== "") keys.push(`call:${item.call_id}`);
	return keys;
}

// ---- completed content (what a completed raw item means to Pi) ----------------------------------------------------

/**
 * Pi content of completed raw items, in completion order: message text and function/custom tool calls only.
 * Reasoning and other item kinds are kept in the raw ledger and are not part of a tool handoff.
 * Tool-call ids and argument parsing mirror processResponsesStream, so a malformed argument string stays visible
 * through `argumentsError` instead of becoming silent `{}`.
 */
export function completedContent(items: readonly unknown[], grammarToolInputProperties?: ReadonlyMap<string, string>): (TextContent | ToolCall)[] {
	const out: (TextContent | ToolCall)[] = [];
	for (const raw of items) {
		const item = asRecord(raw);
		if (!item) continue;
		if (item.type === "message" && Array.isArray(item.content)) {
			const text = item.content
				.map((part) => {
					const p = asRecord(part);
					if (!p) return "";
					return p.type === "output_text" ? String(p.text ?? "") : String(p.refusal ?? "");
				})
				.join("");
			if (text !== "") {
				const block: TextContent = { type: "text", text };
				if (typeof item.id === "string" && item.id !== "") {
					block.textSignature = encodeTextSignatureV1(item.id, typeof item.phase === "string" ? item.phase : undefined);
				}
				out.push(block);
			}
		} else if (item.type === "function_call" && typeof item.call_id === "string" && typeof item.name === "string") {
			const parsed = parseToolCallArguments(typeof item.arguments === "string" ? item.arguments : "");
			out.push({
				type: "toolCall",
				id: `${item.call_id}|${String(item.id)}`,
				name: item.name,
				arguments: parsed.arguments,
				...(typeof item.namespace === "string" ? { namespace: item.namespace } : {}),
				...(parsed.argumentsError ? { argumentsError: parsed.argumentsError } : {}),
			});
		} else if (item.type === "custom_tool_call" && typeof item.call_id === "string" && typeof item.name === "string") {
			const property = grammarToolInputProperties?.get(item.name) ?? "input";
			out.push({
				type: "toolCall",
				id: `${item.call_id}|${String(item.id)}`,
				name: item.name,
				arguments: { [property]: typeof item.input === "string" ? item.input : "" },
				...(typeof item.namespace === "string" ? { namespace: item.namespace } : {}),
			});
		}
	}
	return out;
}

// ---- live pump --------------------------------------------------------------------------------------------------

export interface LiveResponsesPumpOptions {
	model: Model<Api>;
	stream: AssistantMessageEventStream;
	/** Shared partial message; a new empty one when omitted. Content is only appended while the pump runs. */
	output?: AssistantMessage;
	/** Options for processResponsesStream. `onProviderStreamEvent` is not called here: the caller runs it before push(). */
	parserOptions?: OpenAIResponsesStreamOptions;
	/** Bound of the live queue. Default LIVE_QUEUE_LIMIT. */
	queueLimit?: number;
}

export interface PumpFinishOptions {
	/** "aborted" ends with an aborted error terminal; "error" needs `error` or yields a stream error. */
	reason?: Extract<StopReason, "stop" | "length" | "toolUse" | "aborted" | "error">;
	/** Actual usage of the final attempt, if the caller has it; otherwise the usage the attempt reported. */
	usage?: CodexUsage;
	/** Failure to end with (one error terminal). Codex errors also mark the message as retry-owned in diagnostics. */
	error?: unknown;
	/** Completed tool handoff (from decidePartialHandoff) to end with as a done terminal instead of the display message. */
	handoff?: AssistantMessage;
	/** Terminal failure with completed content (from decidePartialHandoff) to emit unchanged as an error terminal. */
	failure?: AssistantMessage;
	/** Completed content to restore after retryBoundary removed a failed attempt's display blocks. */
	completedContent?: AssistantMessage["content"];
}

type Terminal = "none" | "completed" | "failed" | "cut";

interface Attempt {
	queue: BoundedAsyncQueue<NativeEvent>;
	processing: Promise<void>;
	/** output_index values of items already completed in an earlier attempt: their events are dropped here. */
	suppressed: Set<number>;
	/** Blocks started and not yet ended: contentIndex → kind. */
	open: Map<number, string>;
	/** First content index this attempt appended to the shared message. */
	start: number;
	terminal: Terminal;
	error?: CodexError;
	usage?: CodexUsage;
	parseError?: unknown;
}

/**
 * Live Responses pump: native stream events go in one by one, Pi's processResponsesStream turns them into display events
 * on the shared stream while the upstream is still producing. Failed attempts are closed with balanced end events, their
 * unfinished blocks are dropped, and completed raw items stay in a ledger (before normalization) for the retry or handoff.
 * Exactly one outer terminal (done or error) is pushed by finish().
 */
export class LiveResponsesPump {
	readonly #model: Model<Api>;
	readonly #stream: AssistantMessageEventStream;
	readonly #output: AssistantMessage;
	#parserOptions: OpenAIResponsesStreamOptions;
	readonly #queueLimit: number;
	#attempt: Attempt | undefined;
	#ledger = new Set<string>();
	#completed: NativeEvent[] = [];
	#dropped = new Set<number>();
	#droppedToolCalls = 0;
	#duplicates = 0;
	#carried: Usage = emptyUsage();
	#finished = false;
	#final: AssistantMessage | undefined;
	#endTurn: false | undefined;

	constructor(options: LiveResponsesPumpOptions) {
		this.#model = options.model;
		this.#stream = options.stream;
		this.#output = options.output ?? emptyAssistantMessage(options.model);
		const parser: OpenAIResponsesStreamOptions = { ...(options.parserOptions ?? {}) };
		delete parser.onProviderStreamEvent;
		this.#parserOptions = parser;
		this.#queueLimit = options.queueLimit ?? LIVE_QUEUE_LIMIT;
		this.#stream.push({ type: "start", partial: this.#output });
	}

	/** The shared partial message (display state). */
	get output(): AssistantMessage {
		return this.#output;
	}

	/** Sets the service tier the display parser reads. Call before the first push (the final request body's tier). */
	setServiceTier(serviceTier: unknown): void {
		if (this.#attempt !== undefined) throw new Error("LiveResponsesPump: service tier set after the first event");
		this.#parserOptions = { ...this.#parserOptions, serviceTier: serviceTier as never };
	}

	/** Completed raw output items in completion order, exactly as received (before any normalization). */
	/** Grammar tool input properties of the parser options (name -> property); the handoff reads the same mapping. */
	get grammarToolInputProperties(): ReadonlyMap<string, string> | undefined {
		return this.#parserOptions.grammarToolInputProperties;
	}

	get completedRawItems(): readonly unknown[] {
		return this.#completed.slice();
	}

	/** Backend re-sends of already completed items that were dropped instead of replayed as events or tools. */
	get duplicateCount(): number {
		return this.#duplicates;
	}

	/** Tool calls that were open at a retry boundary or at finish: dropped, never executed. */
	get droppedToolCallCount(): number {
		return this.#droppedToolCalls;
	}

	/** Actual usage so far: every ended attempt plus the current one. */
	get usage(): Usage {
		return addUsage(this.#carried, this.#attemptUsage(this.#attempt));
	}

	get finished(): boolean {
		return this.#finished;
	}

	/**
	 * Typed failure of the current attempt (classified from response.failed, error or a non-interrupted response.incomplete),
	 * with the actual usage of that response. Undefined when the current attempt has none. Read it before retryBoundary(),
	 * which also returns it; finish() takes it when no `error` is passed.
	 */
	get failure(): CodexError | undefined {
		return this.#attempt?.error;
	}

	/** `false` when the completed response was an interrupted incomplete (native end_turn false); undefined otherwise. */
	get endTurn(): false | undefined {
		return this.#endTurn;
	}

	/** Pushes one native Responses event. Resolves when the bounded live queue accepts it. */
	async push(event: NativeEvent): Promise<void> {
		if (this.#finished) throw new Error("LiveResponsesPump: event after finish");
		const attempt = this.#attempt ?? this.#startAttempt();
		if (attempt.terminal !== "none") throw new Error(`LiveResponsesPump: event after ${attempt.terminal} terminal`);
		const type = String(event.type);
		const response = asRecord(event.response);
		const classified = type === "response.incomplete" || type === "response.failed" || type === "error" ? classifyEvent(event) : null;
		if (type === "error" && classified === null) return;

		if (type === "response.failed" || type === "error" || (type === "response.incomplete" && classified !== null)) {
			// Control, not display: these never reach processResponsesStream (it would throw on them).
			// content_filter and other non-interrupted reasons end here as typed errors; usage is the response's actual usage.
			const usage = normalizeUsage(response?.usage);
			const error = classified ?? new CodexError({ kind: "stream_failed" });
			attempt.error = usage !== undefined && error.usage === undefined ? error.withPartial(error.partialItems, usage) : error;
			attempt.usage = usage ?? attempt.error.usage;
			attempt.terminal = "failed";
			attempt.queue.close();
			return;
		}

		// Interrupted incomplete: native completion with end_turn false. Pi's parser maps status "incomplete" to an error,
		// so it sees the same response as completed; the end_turn flag is kept here.
		const forwarded: NativeEvent =
			type === "response.incomplete"
				? { ...event, type: "response.completed", response: { ...response, status: "completed", incomplete_details: undefined } }
				: event;

		const index = typeof event.output_index === "number" ? event.output_index : undefined;
		if (type === "response.output_item.added" || type === "response.output_item.done") {
			const item = asRecord(event.item);
			const keys = itemKeys(item);
			if (keys.some((key) => this.#ledger.has(key))) {
				if (index !== undefined) attempt.suppressed.add(index);
				this.#duplicates++;
				return;
			}
			if (type === "response.output_item.done" && item) {
				for (const key of keys) this.#ledger.add(key);
				this.#completed.push(item);
			}
		}
		if (index !== undefined && attempt.suppressed.has(index)) return;

		if (type === "response.completed" || type === "response.incomplete") {
			attempt.usage = normalizeUsage(response?.usage);
			attempt.terminal = "completed";
			if (type === "response.incomplete") this.#endTurn = false;
			await attempt.queue.push(forwarded);
			attempt.queue.close();
			return;
		}
		await attempt.queue.push(event);
	}

	/**
	 * Ends the current failed attempt before the next one: waits for its display parser, closes every block it left open
	 * with a balanced end event (unfinished tool calls are dropped), and keeps its usage. Completed raw items stay.
	 * Returns the typed failure that ended the attempt (undefined when it was cut or completed), so the caller passes it on
	 * explicitly; the pump never pushes a terminal here.
	 */
	async retryBoundary(): Promise<CodexError | undefined> {
		if (this.#finished) throw new Error("LiveResponsesPump: retryBoundary after finish");
		const attempt = this.#attempt;
		if (!attempt) return undefined;
		if (attempt.terminal === "none") attempt.terminal = "cut";
		attempt.queue.close();
		await attempt.processing;
		this.#closeOpen(attempt);
		// Every block of the failed attempt leaves the final message; its completed raw items are kept for the retry input.
		for (let i = attempt.start; i < this.#output.content.length; i++) this.#dropped.add(i);
		this.#carried = addUsage(this.#carried, this.#attemptUsage(attempt));
		this.#output.usage = emptyUsage();
		this.#attempt = undefined;
		return attempt.error;
	}

	/**
	 * Ends the whole response with exactly one outer terminal. Open blocks are closed as dropped. An error terminal carries
	 * the actual usage (failed attempts included) and marks Codex errors as retry-owned in `diagnostics`.
	 */
	async finish(options: PumpFinishOptions = {}): Promise<AssistantMessage> {
		if (this.#finished) return this.#final as AssistantMessage;
		this.#finished = true;
		const attempt = this.#attempt;
		if (attempt) {
			if (attempt.terminal === "none") attempt.terminal = "cut";
			attempt.queue.close();
			await attempt.processing;
			this.#closeOpen(attempt);
		}
		if (options.handoff && options.error !== undefined) throw new Error("LiveResponsesPump: handoff and error are exclusive");
		if (options.handoff && options.failure) throw new Error("LiveResponsesPump: handoff and failure are exclusive");

		const own = options.usage ? toPiUsage(options.usage) : this.#attemptUsage(attempt);
		const content = options.completedContent ?? this.#output.content.filter((_, i) => !this.#dropped.has(i));
		this.#output.content = content;
		const usage = addUsage(this.#carried, own);
		const now = Date.now();

		if (options.handoff) {
			const message = options.handoff;
			this.#final = message;
			this.#stream.push({ type: "done", reason: "toolUse", message });
			this.#stream.end(message);
			return message;
		}
		if (options.failure) {
			const message = { ...this.#output, ...options.failure, ...(options.error !== undefined ? { errorMessage: failureMessage(options.error) } : {}) };
			this.#final = message;
			this.#stream.push({ type: "error", reason: "error", error: message });
			this.#stream.end(message);
			return message;
		}

		const aborted = options.reason === "aborted";
		const failure = aborted
			? undefined
			: (options.error ??
				attempt?.error ??
				(options.reason === "error" ||
				(options.reason === undefined && (!attempt || attempt.terminal === "cut")) ||
				attempt?.parseError !== undefined
					? new CodexError({ kind: "stream" })
					: undefined));

		if (aborted || failure !== undefined) {
			const stopReason: "aborted" | "error" = aborted ? "aborted" : "error";
			const message: AssistantMessage = {
				...this.#output,
				content,
				usage,
				stopReason,
				errorMessage: aborted ? "Request aborted" : failureMessage(failure),
				...(failure instanceof CodexError ? { diagnostics: retryOwnedDiagnostics(now) } : {}),
			};
			this.#final = message;
			this.#stream.push({ type: "error", reason: stopReason, error: message });
			this.#stream.end(message);
			return message;
		}

		const stopReason: StopReason =
			options.reason ?? (content.some((block) => block.type === "toolCall") ? "toolUse" : this.#output.stopReason);
		const message: AssistantMessage = { ...this.#output, content, usage, stopReason };
		this.#final = message;
		this.#stream.push({ type: "done", reason: stopReason as "stop" | "length" | "toolUse", message });
		this.#stream.end(message);
		return message;
	}

	// ---- internals ----------------------------------------------------------------------------------------------

	#startAttempt(): Attempt {
		const queue = new BoundedAsyncQueue<NativeEvent>(this.#queueLimit);
		const attempt: Attempt = {
			queue,
			processing: Promise.resolve(),
			suppressed: new Set(),
			open: new Map(),
			start: this.#output.content.length,
			terminal: "none",
		};
		const display = {
			push: (event: AssistantMessageEvent) => this.#display(attempt, event),
		} as unknown as AssistantMessageEventStream;
		attempt.processing = processResponsesStream(
			queue as unknown as AsyncIterable<never>,
			this.#output,
			display,
			this.#model,
			this.#parserOptions,
		).then(
			() => undefined,
			(error: unknown) => {
				attempt.parseError = error;
				// The display parser is gone: release the producer so later pushes fail instead of waiting forever.
				queue.cancel(error);
			},
		);
		this.#attempt = attempt;
		return attempt;
	}

	/** Every display event goes through here: it tracks open blocks and forwards the event to the shared stream. */
	#display(attempt: Attempt, event: AssistantMessageEvent): void {
		const e = event as { type: string; contentIndex?: number };
		if (typeof e.contentIndex === "number") {
			if (e.type.endsWith("_start")) attempt.open.set(e.contentIndex, e.type.slice(0, -"_start".length));
			else if (e.type.endsWith("_end")) attempt.open.delete(e.contentIndex);
		}
		this.#stream.push(event);
	}

	#closeOpen(attempt: Attempt): void {
		const open = [...attempt.open].sort((a, b) => a[0] - b[0]);
		attempt.open.clear();
		for (const [contentIndex, kind] of open) {
			const block = this.#output.content[contentIndex] as unknown as Record<string, unknown> | undefined;
			this.#dropped.add(contentIndex);
			if (kind === "text") {
				this.#stream.push({ type: "text_end", contentIndex, content: String(block?.text ?? ""), partial: this.#output });
			} else if (kind === "thinking") {
				this.#stream.push({ type: "thinking_end", contentIndex, content: String(block?.thinking ?? ""), partial: this.#output });
			} else {
				this.#droppedToolCalls++;
				const toolCall: ToolCall = {
					type: "toolCall",
					id: String(block?.id ?? ""),
					name: String(block?.name ?? ""),
					arguments: {},
					argumentsError: DROPPED_TOOL_CALL_MESSAGE,
				};
				this.#stream.push({ type: "toolcall_end", contentIndex, toolCall, partial: this.#output });
			}
		}
	}

	#attemptUsage(attempt: Attempt | undefined): Usage {
		if (!attempt) return emptyUsage();
		if (attempt.usage) return toPiUsage(attempt.usage);
		return attempt.terminal === "completed" ? this.#output.usage : emptyUsage();
	}
}

// ---- retry / handoff decision -------------------------------------------------------------------------------------

export interface HandoffContext {
	api: Api;
	provider: string;
	model: string;
	/** Message timestamp (epoch ms). Defaults to `now`. */
	timestamp?: number;
	/** Actual usage including the failed attempt (pump.usage). When omitted, the error's own usage is used. */
	usage?: Usage;
}

export interface PartialHandoffInput {
	/** LiveResponsesPump.completedRawItems: completed raw items, before normalization. */
	completedItems: readonly unknown[];
	/** The failure of the attempt that just ended. */
	error: unknown;
	context: HandoffContext;
	/** Open tool calls of the failed attempt (pump.droppedToolCallCount for that attempt). Reported, never run. */
	unfinishedToolCalls?: number;
	/** Pump's grammar tool input properties: a grammar call's completed input keeps its own property. */
	grammarToolInputProperties?: ReadonlyMap<string, string>;
	/** The caller's retry policy has ended the request, even when this error would otherwise be retryable. */
	terminal?: boolean;
	now?: number;
}

export type PartialHandoffDecision =
	/** Nothing completed that Pi must run: the caller retries with its RetryPolicy (budget and delay decided there). */
	| { action: "retry"; error: CodexError }
	/**
	 * Completed calls exist: end the provider call with `message` (stopReason toolUse, only completed calls and completed text)
	 * so Pi's tool loop runs them once. `pendingError` is set for terminal errors: surface it via PendingErrorGate before any
	 * next backend request, without a network call.
	 */
	| { action: "tool_handoff"; message: AssistantMessage; pendingError?: CodexError }
	/** No completed calls and not retryable: final failure, with completed text kept in content. */
	| { action: "fail"; error: CodexError; message: AssistantMessage };

/**
 * Decides what a failed attempt means for the caller. Completed tool calls always take the handoff path (they must run
 * once, with paired outputs); unfinished calls are never included. Terminal errors (quota, usage, policy, auth, ...)
 * become a pending error that surfaces after the handoff, so no further backend request is made for them.
 */
export function decidePartialHandoff(input: PartialHandoffInput): PartialHandoffDecision {
	const error = input.error instanceof CodexError ? input.error : new CodexError({ kind: "fatal" });
	const now = input.now ?? Date.now();
	const timestamp = input.context.timestamp ?? now;
	const content = completedContent(input.completedItems, input.grammarToolInputProperties);
	const hasCalls = content.some((block) => block.type === "toolCall");

	if (!hasCalls && error.retryable && !input.terminal) return { action: "retry", error };

	const usage = input.context.usage ?? (error.usage ? toPiUsage(error.usage) : emptyUsage());
	const base = { api: input.context.api, provider: input.context.provider, model: input.context.model, usage, timestamp };

	if (hasCalls) {
		const completedCalls = content.filter((block) => block.type === "toolCall").length;
		const message: AssistantMessage = {
			role: "assistant",
			...base,
			content,
			stopReason: "toolUse",
			diagnostics: [
				{
					type: PARTIAL_HANDOFF_DIAGNOSTIC,
					timestamp,
					error: { name: error.name, message: error.message, ...(error.code ? { code: error.code } : {}) },
					details: {
						errorKind: error.kind,
						completedCalls,
						completedText: content.length - completedCalls,
						unfinishedToolCalls: input.unfinishedToolCalls ?? 0,
						pendingError: !error.retryable,
					},
				},
			],
		};
		return error.retryable ? { action: "tool_handoff", message } : { action: "tool_handoff", message, pendingError: error };
	}

	const message: AssistantMessage = {
		role: "assistant",
		...base,
		content,
		stopReason: "error",
		errorMessage: error.message,
		diagnostics: retryOwnedDiagnostics(timestamp),
	};
	return { action: "fail", error, message };
}

/**
 * Holds the terminal error of a tool handoff. The caller checks it before every new backend request: a pending error is
 * returned once and must be surfaced as the response's error terminal, with no network request.
 */
export class PendingErrorGate {
	#pending: CodexError | undefined;

	constructor(pending?: CodexError) {
		this.#pending = pending;
	}

	get pending(): CodexError | undefined {
		return this.#pending;
	}

	takeBeforeRequest(): CodexError | undefined {
		const error = this.#pending;
		this.#pending = undefined;
		return error;
	}
}
