// Caller-local diagnostics for one Pi session: native activity, live tool-call streams and a bounded message peek.
// Pi keeps the history; this file keeps only counters, bounded previews and the last ten call fingerprints.
import { createHash } from "node:crypto";
import type { AssistantMessage, AssistantMessageEvent, Usage } from "@earendil-works/pi-ai";
import type { AgentSession, AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { deadlineTimer } from "./coordinator.ts";

export type AlertKind = "error" | "repetition" | "long_turn" | "schema_rejection_repeated" | "scope_block";
export type ActivityAlert = { kind: AlertKind; at: string; detail: string };
export type ActivityOptions = { alert_after_ms?: number };
const ALERTS = 32;

// Presentation limits only. They never stop or time out the session.
const MESSAGE_CHARS = 1200;
const MESSAGE_BUDGET = 12000;
const ARG_CHARS = 200;
const STREAM_TAIL_CHARS = 240;
const ERROR_CHARS = 300;
const FINGERPRINTS = 10;
const VISIBLE_TOOLS = 8;
const SERVICE_MARKS = 10;

type Tokens = { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
type Json = Record<string, unknown>;
type Loose = { role: string; timestamp?: number; content?: unknown; [key: string]: unknown };
type Preview = { text: string; truncated: boolean; length: number };
type Entry = { item: Json; size: number; time?: number };
type LastUpdate = { preview: Preview; images: Json[] };
interface Stream {
	// Lifetime-unique serial key, stable across ID updates and content-index reuse.
	key: string;
	index: number;
	id: string | null;
	name: string | null;
	startedAt: number;
	startedWall: number;
	lastGrowthAt: number;
	bytes: Utf8Count;
	head: string;
	tail: string;
	ended: boolean;
	parsedBytes: number | null;
	argumentsError: string | null;
	// Arguments the provider supplied at toolcall_start, captured once; kept apart from streamed bytes.
	initial: { preview: Preview; bytes: number } | null;
}
interface Exec {
	toolCallId: string;
	parentToolCallId: string | null;
	name: string;
	startedAt: number;
	startedWall: number;
	lastUpdateAt: number;
	args: Preview;
	argsBytes: number;
	lastUpdate: LastUpdate | null;
	fingerprint: string;
}
interface Fingerprint {
	name: string;
	fingerprint: string;
	at: number;
}
interface LastTool {
	toolCallId: string;
	parentToolCallId: string | null;
	name: string;
	isError: boolean;
	endedAt: number;
	durationMs: number | null;
	args: Preview | null;
	argsBytes: number | null;
	lastUpdate: LastUpdate | null;
}
interface Mark {
	time: number;
	size: number;
	item: Json;
}

const now = (): number => performance.now();
// Native events that can change whether the session is running (see isRunning).
const ACTIVITY_EVENTS = new Set<string>(["agent_start", "agent_end", "agent_settled", "tool_execution_start", "tool_execution_end", "compaction_start", "compaction_end", "auto_retry_start", "auto_retry_end"]);
const jsonText = (value: unknown): string => {
	try {
		return JSON.stringify(value) ?? String(value);
	} catch {
		return "[unserializable]";
	}
};
const stamp = (value: unknown): string | null =>
	typeof value === "number" && Number.isFinite(value) ? new Date(value).toISOString() : null;

// Preview and byte count of an argument value. Called once per value, never per streamed delta.
const seedOf = (value: unknown): { preview: Preview; bytes: number } => {
	const json = jsonText(value);
	return { preview: headTail(json, ARG_CHARS), bytes: Buffer.byteLength(json, "utf8") };
};

// Last tool-update preview of an execution: bounded text and image metadata only.
const updateFields = (u: LastUpdate | null): Json => ({
	last_update_preview: u?.preview.text ?? null,
	last_update_truncated: u?.preview.truncated ?? null,
	last_update_images: u?.images ?? [],
});

// Head and tail of a text, `limit` characters in total. Never splits a surrogate pair.
export function headTail(text: string, limit: number): Preview {
	if (text.length <= limit) return { text, truncated: false, length: text.length };
	const head = Math.floor((limit - 1) / 2);
	const tail = limit - 1 - head;
	let start = text.slice(0, head);
	let end = text.slice(text.length - tail);
	if (/[\ud800-\udbff]$/.test(start)) start = start.slice(0, -1);
	if (/^[\udc00-\udfff]/.test(end)) end = end.slice(1);
	return { text: `${start}…${end}`, truncated: true, length: text.length };
}

// Incremental UTF-8 byte count of streamed text. A surrogate pair split across two deltas is counted once, correctly.
class Utf8Count {
	private bytes = 0;
	private carry = "";
	add(chunk: string): void {
		let text = this.carry + chunk;
		this.carry = "";
		const last = text.charCodeAt(text.length - 1);
		if (text.length > 0 && last >= 0xd800 && last <= 0xdbff) {
			this.carry = text.slice(-1);
			text = text.slice(0, -1);
		}
		this.bytes += Buffer.byteLength(text, "utf8");
	}
	size(): number {
		return this.bytes + (this.carry ? 3 : 0);
	}
}

const fingerprint = (name: string, json: string): string =>
	createHash("sha256").update(name).update("\0").update(json).digest("hex").slice(0, 16);

const hasUsage = (usage: Usage | undefined): usage is Usage =>
	!!usage && usage.input + usage.output + usage.cacheRead + usage.cacheWrite > 0;
const pickUsage = (usage: Usage): Tokens => ({
	input: usage.input,
	output: usage.output,
	cacheRead: usage.cacheRead,
	cacheWrite: usage.cacheWrite,
	total: usage.totalTokens,
});
const diff = (a: Tokens, b: Tokens): Tokens => ({
	input: a.input - b.input,
	output: a.output - b.output,
	cacheRead: a.cacheRead - b.cacheRead,
	cacheWrite: a.cacheWrite - b.cacheWrite,
	total: a.total - b.total,
});

// Text and image metadata of a message content value. Images never expose their data.
function contentParts(content: unknown): { text: string; images: Json[] } {
	if (typeof content === "string") return { text: content, images: [] };
	const images: Json[] = [];
	const parts: string[] = [];
	if (Array.isArray(content)) {
		for (const block of content as Json[]) {
			if (block.type === "text" && typeof block.text === "string") parts.push(block.text);
			else if (block.type === "image" && typeof block.data === "string")
				images.push({ mime_type: block.mimeType ?? null, approx_bytes: Math.floor((block.data.length * 3) / 4) });
		}
	}
	return { text: parts.join("\n"), images };
}

export class Activity {
	private unsubscribe: (() => void) | undefined;
	private nativeBusy: boolean;
	private runActive = false;
	// True from startRun until the first agent_start, compaction, settle or endRun of that run.
	private preflight = false;
	private runId = 0;
	private runStartedAt = 0;
	private runBaseline: Tokens | null = null;
	private runSettled = false;
	private lastRunElapsed: number | null = null;
	private lastRunDelta: Tokens | null = null;
	private lastOutcome: string | null = null;
	private lastActivityAt: number | null = null;
	private compacting: { reason: string; startedAt: number } | null = null;
	private retry: { attempt: number; maxAttempts: number; delayMs: number; errorMessage: string; startedAt: number } | null =
		null;
	private thinking = false;
	private liveMessage: AssistantMessage | null = null;
	private liveUsage: Tokens | null = null;
	private streams = new Map<number, Stream>();
	private streamSerial = 0;
	private execs = new Map<string, Exec>();
	private lastTool: LastTool | null = null;
	private fingerprints: Fingerprint[] = [];
	private marks: Mark[] = [];
	private readonly session: AgentSession;
	private readonly onChange: (() => void) | undefined;
	private readonly alertAfter: number | undefined;
	private alerts: ActivityAlert[] = [];
	private alertSerial = 0;
	private cancelTurnTimer: (() => void) | undefined;
	private rejectionCounts = new Map<string, number>();
	private repeatedStreams = new Set<string>();
	private lastError: string | undefined;

	/** `onChange`, when given, is called on native activity changes; its throws are isolated and never reach Pi. */
	constructor(session: AgentSession, onChange?: () => void, options: ActivityOptions = {}) {
		if (options.alert_after_ms != null && (!Number.isSafeInteger(options.alert_after_ms) || options.alert_after_ms <= 0))
			throw new Error("alert_after_ms must be a positive finite safe integer");
		this.alertAfter = options.alert_after_ms ?? undefined;
		this.session = session;
		this.onChange = onChange;
		this.nativeBusy = session.isStreaming;
		this.unsubscribe = session.subscribe(event => this.onEvent(event));
	}

	/** Monotonic across logical runs, even when the bounded alert history is reset. */
	alertVersion(): number { return this.alertSerial; }

	/** Runtime failures outside native message events, such as a rejected prompt(). */
	reportError(detail: string): void {
		const key = fingerprint("error", detail);
		if (this.lastError === key) return;
		this.lastError = key;
		this.alert("error", detail);
	}

	/** Called only by a hook that actually refused the call; never guesses from tool error prose. */
	observeRefusal(toolCallId: string, reason: string): void {
		this.alert("scope_block", `${toolCallId}: ${reason}`);
	}

	private alert(kind: AlertKind, detail: string): void {
		this.alertSerial++;
		this.alerts.push({ kind, at: new Date().toISOString(), detail: headTail(detail, ERROR_CHARS).text });
		if (this.alerts.length > ALERTS) this.alerts.shift();
		this.changed();
	}

	private endTurn(): void {
		this.cancelTurnTimer?.();
		this.cancelTurnTimer = undefined;
	}

	// Caller-side run boundaries. Native activity still comes from Pi events.
	startRun(): void {
		this.endTurn();
		this.alerts = [];
		this.fingerprints = [];
		this.rejectionCounts.clear();
		this.repeatedStreams.clear();
		this.lastError = undefined;
		this.runActive = true;
		this.preflight = true;
		this.runId += 1;
		this.runStartedAt = now();
		this.runBaseline = this.tokens();
		this.runSettled = false;
		this.lastOutcome = null;
		this.changed();
	}

	/** Whether Pi is running this session natively: a turn, a preflight, a compaction or a retry. Read-only. */
	isRunning(): boolean {
		return this.state() !== "idle";
	}

	/** Monotonic milliseconds of the current run, or of the last one once it has ended. */
	runElapsedMs(): number {
		return this.runActive ? now() - this.runStartedAt : (this.lastRunElapsed ?? 0);
	}

	endRun(outcome: string): void {
		this.endTurn();
		if (outcome === "error" && !this.alerts.some(a => a.kind === "error")) this.reportError("Run ended with an error");
		if (this.runActive) {
			this.lastRunElapsed = now() - this.runStartedAt;
			this.lastRunDelta = this.runBaseline ? diff(this.tokens(), this.runBaseline) : null;
		}
		this.runActive = false;
		this.preflight = false;
		this.lastOutcome = outcome;
		this.changed();
	}

	// `messages` omitted: no peek. Callers validate 5-10 before passing it.
	// `checkpoint` (from checkpoint()): each argument stream also reports the bytes received since that point.
	snapshot(messages?: number, checkpoint?: Map<string, number>): object {
		const at = now();
		const state = this.state();
		const tools = this.toolItems(at, checkpoint);
		const out: Json = {
			state,
			activity: this.phase(state),
			run_active: this.runActive,
			run_id: this.runId,
			elapsed_ms: this.runActive ? at - this.runStartedAt : this.lastRunElapsed,
			idle_for_ms: state === "idle" && this.lastActivityAt !== null ? at - this.lastActivityAt : null,
			last_activity_ago_ms: this.lastActivityAt === null ? null : at - this.lastActivityAt,
			model: this.session.model ? { provider: this.session.model.provider, id: this.session.model.id } : null,
			outcome: this.lastOutcome,
			alerts: this.alerts.map(a => ({ ...a })),
			current_tools: tools.visible,
			current_tools_total: tools.total,
			current_tools_omitted: tools.total - tools.visible.length,
			last_tool: this.lastTool
				? {
						tool_call_id: this.lastTool.toolCallId,
						parent_tool_call_id: this.lastTool.parentToolCallId,
						name: this.lastTool.name,
						is_error: this.lastTool.isError,
						ended_ago_ms: at - this.lastTool.endedAt,
						duration_ms: this.lastTool.durationMs,
						args_preview: this.lastTool.args?.text ?? null,
						args_truncated: this.lastTool.args?.truncated ?? null,
						args_bytes: this.lastTool.argsBytes,
						...updateFields(this.lastTool.lastUpdate),
					}
				: null,
			repetition_hint: this.repetition(at),
			compaction: this.compacting
				? { reason: this.compacting.reason, started_ago_ms: at - this.compacting.startedAt }
				: null,
			retry: this.retry
				? {
						attempt: this.retry.attempt,
						max_attempts: this.retry.maxAttempts,
						delay_ms: this.retry.delayMs,
						error_message: this.retry.errorMessage,
						started_ago_ms: at - this.retry.startedAt,
					}
				: null,
			tokens: {
				session: this.tokens(),
				run: this.runActive && this.runBaseline ? diff(this.tokens(), this.runBaseline) : this.lastRunDelta,
				in_flight_usage: this.liveUsage,
			},
			usage_complete: !this.nativeBusy && this.runSettled,
		};
		if (messages !== undefined) {
			const peek = this.peek(messages);
			out.messages = peek.messages;
			out.messages_omitted = peek.omitted;
		}
		return out;
	}

	// Argument bytes of each current tool stream, keyed by its lifetime-unique stream key.
	checkpoint(): Map<string, number> {
		const out = new Map<string, number>();
		for (const s of this.streams.values()) out.set(s.key, s.bytes.size());
		return out;
	}

	// Bytes already present at the checkpoint for this stream; zero for a stream that started later.
	private baseline(s: Stream, checkpoint: Map<string, number>): number {
		return checkpoint.get(s.key) ?? 0;
	}

	close(): void {
		this.endTurn();
		this.unsubscribe?.();
		this.unsubscribe = undefined;
		this.streams.clear();
		this.execs.clear();
		this.liveMessage = null;
		this.liveUsage = null;
		this.changed();
	}

	// Isolated: a caller's callback that throws must never break the session's events or the run.
	private changed(): void {
		try {
			this.onChange?.();
		} catch {
			// isolated
		}
	}

	private onEvent(event: AgentSessionEvent): void {
		const at = now();
		this.lastActivityAt = at;
		switch (event.type) {
			case "turn_start":
				this.endTurn();
				if (this.alertAfter !== undefined) {
					const started = at;
					this.cancelTurnTimer = deadlineTimer(this.alertAfter, () => {
						this.cancelTurnTimer = undefined;
						this.alert("long_turn", `Active turn has lasted ${Math.round(now() - started)} ms`);
					});
				}
				break;
			case "turn_end":
				this.endTurn();
				break;
			case "agent_start":
				this.nativeBusy = true;
				this.preflight = false;
				break;
			case "agent_end":
				this.endTurn();
				this.nativeBusy = false;
				break;
			case "agent_settled":
				this.endTurn();
				this.nativeBusy = false;
				this.preflight = false;
				this.runSettled = true;
				break;
			case "message_start":
				if (event.message.role === "assistant") {
					this.liveMessage = event.message;
					this.resetAssistant();
				}
				break;
			case "message_update":
				if (event.message.role === "assistant") {
					this.liveMessage = event.message;
					if (hasUsage(event.message.usage)) this.liveUsage = pickUsage(event.message.usage);
					this.onAssistantEvent(event.assistantMessageEvent, at);
				}
				break;
			case "message_end":
				if (event.message.role === "assistant") {
					if (event.message.stopReason === "error") {
						const detail = event.message.errorMessage ?? "Unknown provider error";
						this.lastError = fingerprint("error", detail);
						this.alert("error", detail);
					} else if (event.message.stopReason === "length") {
						this.reportError("Response was truncated: the model reached its output token limit.");
					}
					this.liveMessage = null;
					this.resetAssistant();
				}
				break;
			case "tool_execution_start": {
				const json = jsonText(event.args);
				this.execs.set(event.toolCallId, {
					toolCallId: event.toolCallId,
					parentToolCallId: event.parentToolCallId ?? null,
					name: event.toolName,
					startedAt: at,
					startedWall: Date.now(),
					lastUpdateAt: at,
					args: headTail(json, ARG_CHARS),
					argsBytes: Buffer.byteLength(json, "utf8"),
					lastUpdate: null,
					fingerprint: fingerprint(event.toolName, json),
				});
				break;
			}
			case "tool_execution_update": {
				const exec = this.execs.get(event.toolCallId);
				if (!exec) break;
				exec.lastUpdateAt = at;
				const partial = (event as { partialResult?: { content?: unknown } }).partialResult;
				if (partial) {
					const parts = contentParts(partial.content);
					exec.lastUpdate = { preview: headTail(parts.text, ARG_CHARS), images: parts.images };
				}
				break;
			}
			case "tool_execution_end": {
				const exec = this.execs.get(event.toolCallId);
				this.execs.delete(event.toolCallId);
				this.lastTool = {
					toolCallId: event.toolCallId,
					parentToolCallId: event.parentToolCallId ?? exec?.parentToolCallId ?? null,
					name: event.toolName,
					isError: event.isError,
					endedAt: at,
					durationMs: event.durationMs ?? null,
					args: exec?.args ?? null,
					argsBytes: exec?.argsBytes ?? null,
					lastUpdate: exec?.lastUpdate ?? null,
				};
				if (exec) {
					const prior = this.fingerprints.filter(f => f.name === exec.name && f.fingerprint === exec.fingerprint).length;
					this.fingerprints.push({ name: exec.name, fingerprint: exec.fingerprint, at });
					if (this.fingerprints.length > FINGERPRINTS) this.fingerprints.shift();
					if (prior === 1 && this.fingerprints.filter(f => f.name === exec.name && f.fingerprint === exec.fingerprint).length > 1)
						this.alert("repetition", `Repeated identical ${exec.name} call among the last ${FINGERPRINTS} calls`);
				}
				if (event.isError) {
					const detail = contentParts(event.result?.content).text;
					const schemaPrefix = `Validation failed for tool "${event.toolName}":\n`;
					const formatPrefix = `Invalid arguments for tool "${event.toolName}": `;
					// Pi 1.4.0 validates before tool_call/tool_result hooks and exposes the refusal as this end event.
					if (event.durationMs === undefined && (detail.startsWith(schemaPrefix) || detail.startsWith(formatPrefix))) {
						const diagnostic = detail.startsWith(schemaPrefix) ? detail.split("\n\nReceived arguments:\n", 1)[0] : detail;
						const key = fingerprint(event.toolName, diagnostic);
						const count = (this.rejectionCounts.get(key) ?? 0) + 1;
						this.rejectionCounts.set(key, count);
						if (this.rejectionCounts.size > FINGERPRINTS) this.rejectionCounts.delete(this.rejectionCounts.keys().next().value!);
						if (count === 2) this.alert("schema_rejection_repeated", diagnostic);
					}
				}
				break;
			}
			case "compaction_start":
				this.preflight = false;
				this.compacting = { reason: event.reason, startedAt: at };
				this.mark({ kind: "compaction", reason: String(event.reason) }, String(event.reason).length);
				break;
			case "compaction_end":
				this.compacting = null;
				if (event.errorMessage && !event.aborted) this.reportError(event.errorMessage);
				break;
			case "auto_retry_start": {
				const error = headTail(event.errorMessage, ERROR_CHARS);
				this.retry = {
					attempt: event.attempt,
					maxAttempts: event.maxAttempts,
					delayMs: event.delayMs,
					errorMessage: error.text,
					startedAt: at,
				};
				this.mark(
					{
						kind: "retry",
						attempt: event.attempt,
						max_attempts: event.maxAttempts,
						delay_ms: event.delayMs,
						error: error.text,
						error_truncated: error.truncated,
					},
					error.text.length,
				);
				break;
			}
			case "auto_retry_end":
				this.retry = null;
				break;
			default:
				break;
		}
		// After the update, so the callback sees the new state. Only events that can change isRunning() notify.
		if (ACTIVITY_EVENTS.has(event.type)) this.changed();
	}

	// Service mark for retry and compaction starts: only the last SERVICE_MARKS are kept.
	private mark(fields: Json, size: number): void {
		const time = Date.now();
		this.marks.push({ time, size, item: { role: "service", at: stamp(time), ...fields } });
		if (this.marks.length > SERVICE_MARKS) this.marks.shift();
	}

	private resetAssistant(): void {
		this.streams.clear();
		this.repeatedStreams.clear();
		this.liveUsage = null;
		this.thinking = false;
	}

	// Thinking deltas only switch the phase; their text is never stored.
	private onAssistantEvent(event: AssistantMessageEvent, at: number): void {
		switch (event.type) {
			case "thinking_start":
			case "thinking_delta":
				this.thinking = true;
				break;
			case "text_start":
			case "text_delta":
			case "text_end":
				this.thinking = false;
				break;
			case "toolcall_start":
				this.thinking = false;
				this.stream(event.contentIndex, at, event.partial, true);
				break;
			case "toolcall_delta": {
				this.thinking = false;
				const s = this.stream(event.contentIndex, at, event.partial);
				// Counted incrementally; no JSON.stringify of the growing partial arguments.
				s.bytes.add(event.delta);
				s.lastGrowthAt = at;
				if (s.head.length < ARG_CHARS) s.head += event.delta.slice(0, ARG_CHARS - s.head.length);
				s.tail = (s.tail + event.delta).slice(-STREAM_TAIL_CHARS);
				const probe = s.tail.slice(-16);
				if (!this.repeatedStreams.has(s.key) && probe.length === 16 && s.tail.split(probe).length - 1 >= 3) {
					this.repeatedStreams.add(s.key);
					this.alert("repetition", `Repeated argument fragment in ${s.name ?? "unknown tool"} call ${s.id ?? s.key}`);
				}
				break;
			}
			case "toolcall_end": {
				this.thinking = false;
				const s = this.stream(event.contentIndex, at, event.partial);
				s.id = event.toolCall.id || s.id;
				s.name = event.toolCall.name || s.name;
				s.ended = true;
				s.parsedBytes = Buffer.byteLength(jsonText(event.toolCall.arguments), "utf8");
				s.argumentsError = event.toolCall.argumentsError ?? null;
				break;
			}
			default:
				break;
		}
	}

	// Created once per content index; `seed` is passed only at toolcall_start. Later calls refresh the ID and name,
	// which a provider may assign after the start event.
	private stream(index: number, at: number, partial: AssistantMessage, seed = false): Stream {
		const block = partial.content[index];
		const tool = block?.type === "toolCall" ? block : null;
		let s = this.streams.get(index);
		if (!s) {
			s = {
				key: `stream:${++this.streamSerial}`,
				index,
				id: null,
				name: null,
				startedAt: at,
				startedWall: Date.now(),
				lastGrowthAt: at,
				bytes: new Utf8Count(),
				head: "",
				tail: "",
				ended: false,
				parsedBytes: null,
				argumentsError: null,
				initial: seed && tool && tool.arguments !== undefined ? seedOf(tool.arguments) : null,
			};
			this.streams.set(index, s);
		}
		if (tool) {
			s.id = tool.id || s.id;
			s.name = tool.name || s.name;
		}
		return s;
	}

	private state(): "running" | "streaming_tool_call" | "running_tool" | "idle" {
		for (const s of this.streams.values()) if (!s.ended) return "streaming_tool_call";
		if (this.execs.size > 0) return "running_tool";
		return this.nativeBusy || this.preflight || this.compacting || this.retry ? "running" : "idle";
	}

	private phase(state: string): string | null {
		if (state === "idle" || state === "running_tool") return null;
		if (this.compacting) return "compaction";
		if (this.retry) return "retry";
		if (!this.nativeBusy) return this.preflight ? "preflight" : null;
		if (state === "streaming_tool_call") return "model";
		return this.thinking ? "thinking" : "model";
	}

	private toolItems(at: number, checkpoint?: Map<string, number>): { visible: Json[]; total: number } {
		const items: Json[] = [];
		for (const e of this.execs.values())
			items.push({
				kind: "execution",
				tool_call_id: e.toolCallId,
				parent_tool_call_id: e.parentToolCallId,
				name: e.name,
				age_ms: at - e.startedAt,
				last_update_ago_ms: at - e.lastUpdateAt,
				args_bytes: e.argsBytes,
				args_preview: e.args.text,
				args_truncated: e.args.truncated,
				...updateFields(e.lastUpdate),
			});
		for (const s of this.streams.values()) {
			if (s.id && this.execs.has(s.id)) continue;
			const item: Json = {
				kind: "argument_stream",
				tool_call_id: s.id,
				parent_tool_call_id: null,
				name: s.name,
				age_ms: at - s.startedAt,
				last_growth_ago_ms: at - s.lastGrowthAt,
				argument_stream_bytes: s.bytes.size(),
				initial_arguments_preview: s.initial?.preview.text ?? null,
				initial_arguments_bytes: s.initial?.bytes ?? null,
				args_head: s.head,
				args_tail: s.tail,
				ended: s.ended,
				parsed_arguments_bytes: s.parsedBytes,
				arguments_error: s.argumentsError,
			};
			if (checkpoint) item.argument_growth_since_wait_bytes = s.bytes.size() - this.baseline(s, checkpoint);
			items.push(item);
		}
		items.sort((a, b) => (b.age_ms as number) - (a.age_ms as number));
		return { visible: items.slice(0, VISIBLE_TOOLS), total: items.length };
	}

	// Suspicion only: identical completed calls among the last ten, and a fragment repeated in a live argument tail.
	private repetition(at: number): Json | null {
		const counts = new Map<string, { tool: string; count: number; lastAt: number }>();
		for (const f of this.fingerprints) {
			const key = `${f.name}\0${f.fingerprint}`;
			const c = counts.get(key);
			if (c) {
				c.count += 1;
				c.lastAt = Math.max(c.lastAt, f.at);
			} else counts.set(key, { tool: f.name, count: 1, lastAt: f.at });
		}
		const completed = [...counts.values()]
			.filter(c => c.count > 1)
			.map(c => ({ tool: c.tool, count: c.count, last_ago_ms: at - c.lastAt }));
		const fragments: Json[] = [];
		for (const s of this.streams.values()) {
			if (s.ended) continue;
			const probe = s.tail.slice(-16);
			if (probe.length < 16) continue;
			const occurrences = s.tail.split(probe).length - 1;
			if (occurrences >= 3) fragments.push({ tool_call_id: s.id, count: occurrences });
		}
		return completed.length || fragments.length
			? { completed_repeats: completed, stream_fragment_repeats: fragments }
			: null;
	}

	private tokens(): Tokens {
		const t = this.session.getSessionStats().tokens;
		return { input: t.input, output: t.output, cacheRead: t.cacheRead, cacheWrite: t.cacheWrite, total: t.total };
	}

	private peek(count: number): { messages: Json[]; omitted: number } {
		const n = Math.max(0, Math.floor(count));
		if (n === 0) return { messages: [], omitted: 0 };
		const liveIds = new Set<string>();
		for (const s of this.streams.values()) if (s.id) liveIds.add(s.id);
		const history = this.session.messages as unknown as Loose[];
		// Only the last n history entries can reach the peek, so older ones are never described.
		const candidates: Entry[] = history.slice(-n).map(m => this.describe(m, liveIds, false));
		// An unfinished assistant message is listed on its own, even when history holds an entry with the same timestamp.
		if (this.liveMessage) candidates.push(this.describe(this.liveMessage as unknown as Loose, liveIds, true));
		for (const m of this.marks) candidates.push({ item: m.item, size: m.size, time: m.time });
		for (const s of this.streams.values()) {
			const size = s.head.length + s.tail.length + (s.initial?.preview.text.length ?? 0);
			candidates.push({
				item: {
					role: "assistant",
					live: true,
					kind: "tool_call_stream",
					at: stamp(s.startedWall),
					tool_call_id: s.id,
					tool_name: s.name,
					argument_stream_bytes: s.bytes.size(),
					initial_arguments_preview: s.initial?.preview.text ?? null,
					initial_arguments_bytes: s.initial?.bytes ?? null,
					args_head: s.head,
					args_tail: s.tail,
					ended: s.ended,
					parsed_arguments_bytes: s.parsedBytes,
					arguments_error: s.argumentsError,
				},
				size,
				time: s.startedWall,
			});
		}
		for (const e of this.execs.values()) {
			const size = e.args.text.length + (e.lastUpdate?.preview.text.length ?? 0);
			candidates.push({
				item: {
					role: "tool",
					live: true,
					kind: "tool_execution",
					state: "running",
					at: stamp(e.startedWall),
					tool_call_id: e.toolCallId,
					tool_name: e.name,
					parent_tool_call_id: e.parentToolCallId,
					started_ago_ms: now() - e.startedAt,
					args_bytes: e.argsBytes,
					args_preview: e.args.text,
					args_truncated: e.args.truncated,
					...updateFields(e.lastUpdate),
				},
				size,
				time: e.startedWall,
			});
		}
		// Merged by timestamp; an entry without one takes the timestamp of the entry before it.
		let last = 0;
		for (const c of candidates) {
			c.time = c.time ?? last;
			last = c.time;
		}
		candidates.sort((a, b) => (a.time ?? 0) - (b.time ?? 0));
		const total = history.length + this.marks.length + (this.liveMessage ? 1 : 0) + this.streams.size + this.execs.size;
		const picked = candidates.slice(-n);
		const kept: Json[] = [];
		let used = 0;
		for (let i = picked.length - 1; i >= 0; i--) {
			const entry = picked[i];
			if (kept.length > 0 && used + entry.size > MESSAGE_BUDGET) break;
			used += entry.size;
			kept.unshift(entry.item);
		}
		return { messages: kept, omitted: total - kept.length };
	}

	// Thinking is reported as a count only. Tool calls whose stream is live are left to the stream entry.
	// Text and tool-call previews share one MESSAGE_CHARS budget per message; calls beyond it are counted as omitted.
	private describe(m: Loose, liveIds: Set<string>, live: boolean): Entry {
		const item: Json = { role: m.role, at: stamp(m.timestamp), live };
		let size = 0;
		let text = "";
		if (m.role === "bashExecution") {
			text = `$ ${String(m.command ?? "")}\n${String(m.output ?? "")}`;
			item.exit_code = m.exitCode ?? null;
			item.cancelled = m.cancelled ?? false;
			item.truncated = m.truncated ?? false;
		} else {
			const parts = contentParts(m.content);
			text = parts.text;
			if (parts.images.length) item.images = parts.images;
		}
		if (m.role === "custom") item.custom_type = m.customType ?? null;
		if (typeof m.summary === "string" && !text) text = m.summary;
		if (m.role === "toolResult") {
			item.tool_call_id = m.toolCallId ?? null;
			item.tool_name = m.toolName ?? null;
			item.is_error = m.isError ?? false;
		}
		const preview = headTail(text, MESSAGE_CHARS);
		if (text) {
			item.text = preview.text;
			item.text_length = preview.length;
			item.text_truncated = preview.truncated;
			size += preview.text.length;
		}
		if (m.role === "assistant") {
			const blocks = Array.isArray(m.content) ? (m.content as Json[]) : [];
			const thinking = blocks.filter(b => b.type === "thinking");
			if (thinking.length)
				item.thinking = {
					blocks: thinking.length,
					chars: thinking.reduce((n, b) => n + String(b.thinking ?? "").length, 0),
					redacted_blocks: thinking.filter(b => b.redacted === true).length,
				};
			const calls: Json[] = [];
			let room = MESSAGE_CHARS - preview.text.length;
			let omitted = 0;
			for (const b of blocks) {
				if (b.type !== "toolCall" || liveIds.has(String(b.id))) continue;
				if (room <= 0) {
					omitted += 1;
					continue;
				}
				const args = headTail(jsonText(b.arguments), Math.min(ARG_CHARS, room));
				calls.push({
					tool_call_id: b.id,
					name: b.name,
					args_length: args.length,
					args_preview: args.text,
					args_truncated: args.truncated,
					arguments_error: b.argumentsError ?? null,
				});
				room -= args.text.length;
				size += args.text.length;
			}
			if (calls.length) item.tool_calls = calls;
			if (omitted) item.tool_calls_omitted = omitted;
			item.stop_reason = m.stopReason ?? null;
			if (typeof m.errorMessage === "string") {
				item.error = headTail(m.errorMessage, ERROR_CHARS).text;
				size += ERROR_CHARS;
			}
		}
		return { item, size, time: typeof m.timestamp === "number" ? m.timestamp : undefined };
	}
}
