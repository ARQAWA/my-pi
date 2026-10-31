// RQW-codex stage 3+4: owned Codex streaming facade for openai-codex-responses.
// One CodexThreadTransport per logical thread. Request path: resolve the stored OAuth login (same slot, same
// account; an explicit key only with auth-runtime origin proof and an exact match) -> build the exact native body
// (wire.ts) -> await onPayload ONCE per logical request -> validate the final body -> then send over WebSocket
// (426/bounded/unbounded retry rules, sticky SSE fallback) or SSE (prepared zstd bytes reused by HTTP retries).
// sendRaw is the mechanical single-request path for compaction, prewarm and turn bodies built by the caller.
// Raw completed output items are kept before normalization; display events come from Pi's shared Responses parser,
// fed only by the attempt that succeeded.
// Imports: this folder and npm packages only.
import { createHash } from "node:crypto";
import {
	createAssistantMessageEventStream,
	type Api,
	type AssistantMessage,
	type AssistantMessageEventStream,
	type Context,
	type CredentialStore,
	type Model,
	type OAuthCredential,
	type StreamOptions,
	type Usage,
} from "@earendil-works/pi-ai";

import { recoverCredential, resolveStoredCredential, validateSubscriptionEndpoint } from "./auth-boundary.ts";
import { PROVIDER_ID, credentialIdentity, validateCredential } from "./auth.ts";
import { CODEX_AUTH_ORIGIN, type CodexAuthOrigin } from "./auth-runtime.ts";
import { compressRequest } from "./compression.ts";
import { Continuation } from "./continuation.ts";
import { prepareContextFork, type ContextForkRequest, type PreparedTurn } from "./context-fork.ts";
import { CodexError, classifyEvent, classifyHttp, classifyTransport, normalizeUsage } from "./errors.ts";
import { mergeHeaders } from "./headers.ts";
import { clientMetadata, identityHeaders, localPlatform, validateExtraMetadata, type CodexIdentity, type RequestKind } from "./metadata.ts";
import { CODEX_ENDPOINT, CODEX_PROVIDER, CODEX_STABLE_FEATURES, codexModelCapabilities, type CodexModelCapabilities } from "./profile.ts";
import { AuthRecoveryPolicy, HttpRetryPolicy, RetryPolicy, sleepAbortable, type InjectedSleep, type StreamTransport } from "./retry.ts";
import { postEvents, SseError, type FetchLike } from "./sse.ts";
import { connect, SocketError, type CodexSocket, type ErrorControl, type RawEvent, type ResponseHead } from "./websocket.ts";
import { buildRequest, grammarToolInputProperties, prefixContext, validateFinalRequest, type WireItem, type WireModelInfo, type WireOptions, type WireRequest } from "./wire.ts";
import { completedContent, decidePartialHandoff, LiveResponsesPump, PendingErrorGate } from "./streaming.ts";

/** Startup budget the first real turn may wait for a prewarm (owner decision; design §4). */
export const PREWARM_WAIT_BUDGET_MS = 15_000;
/** Bounded in-memory raw ledger when no external history is supplied. */
export const LEDGER_LIMIT = 512;

const TERMINAL_TYPES: ReadonlySet<string> = new Set(["response.completed", "response.incomplete", "response.failed", "error"]);
const STICKY_TURN_STATE = "x-codex-turn-state";
const WS_START_MS = "x-codex-ws-stream-request-start-ms";

/** Raw completed-item state supplied by the caller (for example a durable session store). */
export interface RawItemHistory {
	/** Raw completed backend items keyed by response id, as they were received. */
	rawOutputs(): ReadonlyMap<string, readonly WireItem[]>;
	/** Called once per completed response with its raw output items, in order. */
	recordOutputs(responseId: string, items: readonly WireItem[]): void;
	/** Called once per logical request with the final validated body, before it is sent. */
	preparedRequest?(body: Record<string, unknown>): void;
	/** Called at each actual response.output_item.done, before the terminal event of that response. */
	recordItem?(responseId: string, item: WireItem): void;
	/** Optional per-request filter: false drops the raw output of this response from a request built from the given context. */
	acceptRawResponse?(responseId: string, context: Context): boolean;
}

export interface TransportDependencies {
	connect?: typeof connect;
	postEvents?: typeof postEvents;
	fetch?: FetchLike;
	clock?: { now(): number };
	random?: () => number;
	sleep?: InjectedSleep;
	/**
	 * Native provider retry budgets (request_max_retries, stream_max_retries). Absent means the stable profile (4, 5).
	 * The product never sets this; the native differential tests mirror each pinned native case's provider config.
	 */
	providerRetries?: { requestMaxRetries?: number; streamMaxRetries?: number };
}

export interface TransportOptions {
	identity: CodexIdentity;
	store: CredentialStore;
	history?: RawItemHistory;
	dependencies?: TransportDependencies;
}

export interface TurnInfo {
	turnId?: string;
}

/** Pi stream options plus the Codex-specific fields this facade reads. */
export type CodexStreamOptions = StreamOptions & {
	reasoningEffort?: string;
	reasoning?: string;
	reasoningSummary?: WireOptions["reasoningSummary"];
	serviceTier?: string;
	verbosity?: WireOptions["verbosity"];
	/** Authoritative projected history (caller-owned). The builder prefix is kept exactly once in front of it. */
	nativeInput?: WireItem[];
	/** Internal: monotonic clock origin of the startup prewarm budget (not a body field). Absent or invalid means now. */
	prewarmStartedAt?: number;
	/**
	 * Internal: explicit input of a prewarm. "base" always prefixes an empty history; "history" uses the provided history before the
	 * first normal generation. Absent keeps the older rule (empty history until the first completed turn).
	 */
	prewarmInput?: "base" | "history";
	/**
	 * Internal: the account ID (never a token or digest) of the saved login the caller prepared this request for. A different
	 * saved owner at authorization or after the payload hooks is refused before anything is sent. Not a body field.
	 */
	preparedOwner?: string;
};

export interface SendRawOptions {
	/** The exact native request body the caller built (wire.ts buildRequest). */
	request: WireRequest;
	model: Model<Api>;
	options?: CodexStreamOptions;
	requestKind: "compaction" | "prewarm" | "turn";
	signal?: AbortSignal;
	transport?: StreamTransport;
	/**
	 * Request-scoped identity of this one operation (compaction turn, root turn, timestamp, compaction metadata). Lineage must
	 * equal the transport's own identity; authProfile is always subscription. The thread identity is never changed by it.
	 */
	identity?: CodexIdentity;
}

type Credential = OAuthCredential & { accountId: string };

interface AttemptState {
	events: Record<string, unknown>[];
	responseId: string | undefined;
	/** Only normal turn requests write raw items to the durable history; compaction candidates and prewarms never do. */
	durable: boolean;
}

interface AttemptResult {
	terminal: Record<string, unknown>;
	events: Record<string, unknown>[];
	responseId: string | undefined;
	socketId?: string;
	body: Record<string, unknown>;
}

interface PrewarmEntry {
	promise: Promise<void>;
	startedAt: number;
	abort: AbortController;
}

function newState(durable: boolean): AttemptState {
	return { events: [], responseId: undefined, durable };
}

function abortError(): Error {
	const error = new Error("Request was aborted");
	error.name = "AbortError";
	return error;
}

/** Digest of the bearer; the token itself is never stored or logged. */
function accessDigest(access: string): string {
	return createHash("sha256").update(access).digest("hex").slice(0, 16);
}

/** One controller that aborts when any source aborts; release() removes the listeners. */
function linkSignals(sources: readonly (AbortSignal | undefined)[]): { signal: AbortSignal; release(): void } {
	const controller = new AbortController();
	const link = () => controller.abort();
	for (const source of sources) {
		if (!source) continue;
		if (source.aborted) controller.abort();
		else source.addEventListener("abort", link, { once: true });
	}
	return {
		signal: controller.signal,
		release: () => {
			for (const source of sources) source?.removeEventListener("abort", link);
		},
	};
}

/** Settles with the promise, or rejects with AbortError as soon as the signal aborts. A late settlement of the promise is ignored. */
function untilAborted<T>(promise: PromiseLike<T>, signal: AbortSignal): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		if (signal.aborted) {
			Promise.resolve(promise).catch(() => undefined);
			reject(abortError());
			return;
		}
		const onAbort = () => reject(abortError());
		signal.addEventListener("abort", onAbort, { once: true });
		Promise.resolve(promise).then(
			(value) => {
				signal.removeEventListener("abort", onAbort);
				resolve(value);
			},
			(error: unknown) => {
				signal.removeEventListener("abort", onAbort);
				reject(error);
			},
		);
	});
}

function zeroUsage(): Usage {
	return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } as Usage;
}

/** Exact-slug native record, translated to the wire codec's field names (no /models, no guessing). */
export function wireCapabilities(model: Model<Api>): WireModelInfo {
	const caps: CodexModelCapabilities = codexModelCapabilities(model.id);
	return {
		slug: caps.slug,
		use_responses_lite: caps.useResponsesLite,
		default_reasoning_level: caps.defaultReasoningLevel,
		supported_reasoning_levels: caps.supportedReasoningLevels.map((effort) => ({ effort })),
		supports_reasoning_summary_parameter: caps.supportsReasoningSummaryParameter,
		default_reasoning_summary: caps.defaultReasoningSummary as WireModelInfo["default_reasoning_summary"],
		support_verbosity: caps.supportVerbosity,
		default_verbosity: caps.defaultVerbosity as WireModelInfo["default_verbosity"],
		service_tiers: caps.serviceTiers.map((id) => ({ id })),
		input_modalities: model.input.slice(),
		supports_reasoning_effort_updates: caps.supportsReasoningEffortUpdates,
	};
}

// Rebuilds the native error body from the allowlisted control fields of a rejected HTTP or upgrade response, so that
// classifyHttp sees the same code, type, plan and reset fields a native body would carry. Nothing else is copied.
function nativeErrorBody(control: ErrorControl | undefined, now: number): { error: Record<string, unknown> } | undefined {
	if (!control) return undefined;
	const error: Record<string, unknown> = {};
	if (control.code !== undefined) error.code = control.code;
	if (control.type !== undefined) error.type = control.type;
	if (control.planType !== undefined) error.plan_type = control.planType;
	if (control.limitWindowMinutes !== undefined) error.limit_window_minutes = control.limitWindowMinutes;
	if (control.resetsAt !== undefined) error.resets_at = Math.floor(control.resetsAt);
	else if (control.resetsInSeconds !== undefined) error.resets_at = Math.floor(now / 1000 + control.resetsInSeconds);
	return { error };
}

/** Maps any transport/parser failure to a typed Codex error. Caller aborts are rethrown by the caller. */
export function toCodexError(error: unknown, now: number = Date.now(), phase: "connecting" | "established" = "connecting"): CodexError {
	if (error instanceof CodexError) return error;
	if (error instanceof SocketError) {
		switch (error.kind) {
			case "upgrade-rejected":
				return error.status === undefined
					? classifyTransport("connection")
					: classifyHttp(error.status, error.headers, nativeErrorBody(error.control, now), now);
			case "redirect-rejected":
			case "origin":
			case "interrupt-failed":
			case "interrupt-timeout":
				return new CodexError({ kind: "fatal", status: error.status, transport: true });
			case "connect-timeout":
				return classifyTransport("connection");
			case "transport":
			case "closed":
				return classifyTransport(phase === "established" ? "network" : "connection");
			case "idle-timeout":
				return classifyTransport("timeout");
			case "binary-frame":
				return classifyTransport("response_stream");
		}
	}
	if (error instanceof SseError) {
		if (error.kind === "status") return classifyHttp(error.status ?? 0, error.headers, nativeErrorBody(error.control, now), now);
		if (error.kind === "redirect" || error.kind === "content-type") return new CodexError({ kind: "fatal", status: error.status, transport: true });
		if (error.kind === "idle") return classifyTransport("response_stream");
		return classifyTransport("network");
	}
	return classifyTransport("network");
}

/** Runs a local check and rethrows its failure as a LocalRequestError (safe message, no retry). */
function localCall<T>(fn: () => T): T {
	try {
		return fn();
	} catch (error) {
		throw new LocalRequestError(error instanceof Error ? error.message : "request refused");
	}
}

/** Headers without any casing of the sticky turn-state header: a configured alternate-cased token is never kept. */
function withoutTurnState(headers: Record<string, string>): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [name, value] of Object.entries(headers)) {
		if (name.toLowerCase() !== STICKY_TURN_STATE) out[name] = value;
	}
	return out;
}

/** Turn-state value of one native header or metadata field: a string, or the first item of a string array; empty or invalid is none. */
function turnStateValue(value: unknown): string | undefined {
	const first = Array.isArray(value) ? value[0] : value;
	if (typeof first !== "string" || first.length === 0 || !/^[\t\x20-\x7e]+$/.test(first)) return undefined;
	return first;
}

function isAbort(error: unknown, signal: AbortSignal): boolean {
	return signal.aborted || (error instanceof Error && error.name === "AbortError");
}

/** x-codex-routing-hint of the final body: the model, plus the tier when the body carries one (client.rs:1230-49). */
function routingHint(body: Record<string, unknown>): string {
	const hint = `model=${String(body.model)}`;
	return typeof body.service_tier === "string" && body.service_tier !== "" ? `${hint};tier=${body.service_tier}` : hint;
}

/** Lineage fixed at construction; updateMetadata refuses any change to these. */
const IMMUTABLE_IDENTITY_KEYS: readonly (keyof CodexIdentity)[] = ["installationId", "threadId", "rootSessionId", "parentThreadId", "subagentKind"];

const HEAD_HOOK_MESSAGE = "RQW-codex: the onResponse hook failed. Request stopped.";
const OWNER_CHANGED_MESSAGE = "RQW-codex: the saved ChatGPT login changed while the request was prepared. Request not sent; use /login openai-codex.";

/** Head-hook outcome of one attempt. A sync throw or async rejection is recorded here, never escapes into the connector. */
interface HeadGate {
	failed: boolean;
	pending: Promise<void> | undefined;
}

/** Raises a recorded head-hook failure once, as a LocalRequestError; first waits for an async hook to settle. */
async function settleHead(gate: HeadGate, signal?: AbortSignal): Promise<void> {
	// With a signal, a hanging hook cannot hold an abort: the wait ends as soon as the signal aborts.
	if (signal) await untilAborted(gate.pending ?? Promise.resolve(), signal);
	else await gate.pending;
	if (gate.failed) {
		gate.failed = false;
		throw new LocalRequestError(HEAD_HOOK_MESSAGE);
	}
}

/** Raw events of one SSE attempt; a head-hook failure ends the attempt before any event is passed on. */
async function* gatedEvents(source: AsyncIterable<unknown>, gate: HeadGate): AsyncGenerator<unknown, void, undefined> {
	try {
		for await (const raw of source) {
			await settleHead(gate);
			yield raw;
		}
	} catch (error) {
		await settleHead(gate);
		throw error;
	}
	await settleHead(gate);
}

function completedRawItems(events: readonly Record<string, unknown>[]): WireItem[] {
	const items: WireItem[] = [];
	for (const event of events) {
		if (event.type === "response.output_item.done" && typeof event.item === "object" && event.item !== null) {
			items.push(structuredClone(event.item) as WireItem);
		}
	}
	return items;
}

/** The model the server reports (response.created or the terminal event), or undefined. Never replaced by the request. */
function reportedModel(events: readonly Record<string, unknown>[]): string | undefined {
	for (let i = events.length - 1; i >= 0; i--) {
		const response = events[i].response as { model?: unknown } | undefined;
		if (typeof response?.model === "string") return response.model;
	}
	return undefined;
}

// Local, safe refusals (request codec, final-body validation, endpoint and key checks, hook failures). Their messages
// never carry server text, keys or bearers, and they are never retried as network failures.
export class LocalRequestError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "LocalRequestError";
	}
}

export class CodexThreadTransport {
	readonly #identity: CodexIdentity;
	readonly #store: CredentialStore;
	readonly #history: RawItemHistory | undefined;
	readonly #deps: TransportDependencies;
	readonly #clock: { now(): number };
	readonly #lifetime = new AbortController();
	readonly #ledger = new Map<string, readonly WireItem[]>();
	#turnId: string | undefined;
	#turnState: string | undefined;
	#transport: StreamTransport = "websocket";
	#continuation = new Continuation();
	#socket: { socket: CodexSocket; socketId: string; revision: number; digest: string } | undefined;
	#owner: string | undefined;
	#digest: string | undefined;
	#revision = 0;
	#prewarm: PrewarmEntry | undefined;
	#prewarmedSocket: string | undefined;
	#completedOnce = false;
	#disposed = false;
	/** Retry and auth policies of the current logical turn; kept across tool handoffs, reset by #resetTurn. */
	#policy: { auth: AuthRecoveryPolicy; retry: RetryPolicy } | undefined;
	/** Terminal error of a tool handoff: surfaced before the next backend request, without a query. */
	#pendingGate = new PendingErrorGate();
	/** Errors whose actual attempt usage was already carried, including an error pending after a tool handoff. */
	#carriedUsageErrors = new WeakSet<CodexError>();
	/** Auth recovery stage owed before the next backend request after a tool handoff. */
	#recovery: "reload" | "refresh" | undefined;
	/** Retry delay owed before the next backend request after a tool handoff (scheduled after Pi's tools). */
	#handoffDelayMs = 0;
	#lastTurn: PreparedTurn | undefined;

	constructor(options: TransportOptions) {
		// This transport is the ordinary subscription login (storeOAuth, account validated): the auth profile is fixed here.
		this.#identity = { ...options.identity, authProfile: "subscription" };
		this.#store = options.store;
		this.#history = options.history;
		this.#deps = options.dependencies ?? {};
		this.#clock = this.#deps.clock ?? { now: () => Date.now() };
	}

	/** HTTP request retry policy of one logical request (native request_max_retries). */
	#httpPolicy(): HttpRetryPolicy {
		return new HttpRetryPolicy({ maxRetries: this.#deps.providerRetries?.requestMaxRetries, clock: { now: () => this.#clock.now() }, random: this.#deps.random });
	}

	/** Current sticky transport of this thread ("sse" after a 426, a retry budget, or a fallback). */
	get transport(): StreamTransport {
		return this.#transport;
	}

	get identity(): CodexIdentity {
		return { ...this.#identity, turnId: this.#turnId };
	}

	/**
	 * Updates truthful metadata (window, workspaces, compaction and other non-lineage fields) for the next request.
	 * Lineage (installationId, threadId, rootSessionId, parentThreadId, subagentKind) is fixed at construction: a different
	 * value is refused. The turn id is managed only by beginTurn/endTurn: a different value is refused. The whole update is
	 * validated before anything changes. The socket, sticky routing and turn state are left untouched.
	 */
	updateMetadata(update: Partial<CodexIdentity>): void {
		for (const key of IMMUTABLE_IDENTITY_KEYS) {
			if (Object.hasOwn(update, key) && update[key] !== this.#identity[key]) {
				throw new Error(`RQW-codex: ${key} is fixed at construction and cannot be updated`);
			}
		}
		if (Object.hasOwn(update, "turnId") && update.turnId !== this.#turnId) {
			throw new Error("RQW-codex: turnId is managed only by beginTurn and endTurn");
		}
		if (Object.hasOwn(update, "authProfile") && update.authProfile !== "subscription") {
			throw new Error("RQW-codex: authProfile is fixed to subscription");
		}
		if (update.extra !== undefined) validateExtraMetadata(update.extra);
		const { turnId: _turn, authProfile: _auth, ...fields } = update;
		Object.assign(this.#identity, structuredClone(fields));
	}

	/** Pi stream entry point. Exactly one terminal event (done or error) is pushed. */
	stream(model: Model<Api>, context: Context, options: CodexStreamOptions = {}): AssistantMessageEventStream {
		const outer = createAssistantMessageEventStream();
		// The pump pushes the single start event now; display events follow live, and finish() pushes the single terminal.
		// An invalid grammar tool fails later, in buildRequest, as a local refusal before any send; the display map stays empty here.
		let grammar: ReadonlyMap<string, string>;
		try {
			grammar = grammarToolInputProperties(model, context);
		} catch {
			grammar = new Map();
		}
		const pump = new LiveResponsesPump({ model, stream: outer, output: this.#emptyOutput(model), parserOptions: { grammarToolInputProperties: grammar } });
		const linked = linkSignals([options.signal, this.#lifetime.signal]);
		const signal = linked.signal;
		const run = (async () => {
			if (this.#disposed) throw new CodexError({ kind: "fatal" });
			await this.#waitPrewarm(signal);
			return this.#sample(model, context, options, signal, pump);
		})();
		// The caller link is released before the provider terminal is pushed: a later caller abort cannot reach a kept socket.
		run.then(
			async () => {
				linked.release();
				await pump.finish();
			},
			async (error: unknown) => {
				linked.release();
				const aborted = isAbort(error, signal);
				if (aborted) {
					await pump.finish({ reason: "aborted" });
					return;
				}
				const codex = error instanceof LocalRequestError ? undefined : toCodexError(error, this.#clock.now());
				await pump.finish({ error: codex ?? error, usage: codex && this.#carriedUsageErrors.has(codex) ? undefined : codex?.usage });
			},
		);
		return outer;
	}

	/** Capture synchronously; inference owns a fresh transport and in-memory ledger, not this thread's continuation. */
	contextFork(request: ContextForkRequest): (() => Promise<AssistantMessage>) | undefined {
		if (this.#disposed || !this.#lastTurn || this.#owner === undefined) return;
		const captured = prepareContextFork({
			turn: this.#lastTurn, request, identity: this.identity, capabilities: wireCapabilities(this.#lastTurn.model),
			rawOutputs: this.#rawOutputs(request.context),
		});
		if (!captured) return;
		const owner = this.#owner;
		const store = this.#store;
		const dependencies = { ...this.#deps, providerRetries: { requestMaxRetries: 0 } };
		const signal = request.signal;
		let used = false;
		return async () => {
			if (used) throw new Error("RQW-codex: context fork is one-shot");
			used = true;
			signal.throwIfAborted();
			const fork = new CodexThreadTransport({ identity: captured.identity, store, dependencies });
			const pump = new LiveResponsesPump({ model: captured.model, stream: createAssistantMessageEventStream(),
				parserOptions: { grammarToolInputProperties: grammarToolInputProperties(captured.model, captured.context) } });
			pump.setServiceTier(captured.body.service_tier);
			try {
				for await (const event of fork.sendRaw({ request: captured.body, model: captured.model, requestKind: "turn", signal, options: { preparedOwner: owner } })) {
					await pump.push(event);
				}
				const message = await pump.finish();
				signal.throwIfAborted();
				if (message.stopReason === "error" || message.stopReason === "aborted") throw new Error(message.errorMessage ?? "RQW-codex: context fork failed");
				return message;
			} catch (error) {
				await pump.finish({ error, reason: signal.aborted ? "aborted" : undefined });
				throw error;
			} finally {
				fork.dispose();
			}
		};
	}

	/**
	 * Startup prewarm (generate:false, WebSocket only). Coalesced while in flight; the entry is cleared when it settles,
	 * so a later idle prewarm can run again. A healthy socket that was already prewarmed is not prewarmed again.
	 * Before the first completed turn the body uses empty context messages (cold start); afterwards the caller's
	 * history projection is used. Failure only leaves the normal path in charge.
	 */
	prewarm(model: Model<Api>, context: Context, options: CodexStreamOptions = {}): Promise<void> {
		if (this.#disposed) return Promise.resolve();
		if (this.#prewarm) return this.#prewarm.promise;
		const abort = new AbortController();
		const now = this.#clock.now();
		const provided = options.prewarmStartedAt;
		const startedAt = provided !== undefined && Number.isFinite(provided) && provided <= now ? provided : now;
		const entry: PrewarmEntry = { promise: Promise.resolve(), startedAt, abort };
		const identity = this.#prewarmIdentity();
		// The prewarm's own abort, the caller signal and the thread lifetime all cancel it; every step below uses this link.
		const linked = linkSignals([options.signal, abort.signal, this.#lifetime.signal]);
		const signal = linked.signal;
		entry.promise = (async () => {
			if (this.#transport !== "websocket") return;
			const { socketId, cred } = await this.#authorize(options, signal);
			const current = this.#socket;
			if (
				current &&
				current.socketId === socketId &&
				current.revision === this.#revision &&
				current.digest === accessDigest(cred.access) &&
				current.socket.isOpen &&
				this.#prewarmedSocket === current.socket.socketIdentity
			) {
				return;
			}
			const cold = options.prewarmInput === "base" || (options.prewarmInput === undefined && !this.#completedOnce);
			const projected = cold ? prefixContext(context) : context;
			const effective = cold ? { ...options, nativeInput: undefined } : options;
			const body = await this.#hookedBody(model, projected, effective, "prewarm", false, identity, signal);
			const owned = await this.#confirmOwner(cred, signal);
			const socket = await this.#openSocket(owned, options, model, "prewarm", socketId, signal, body, identity);
			const state = newState(false);
			await this.#send(socket, { type: "response.create", ...body, client_metadata: this.#wsMetadata(body, this.#clock.now()) }, signal, owned);
			const terminal = await this.#collect(socket.events(), state, options, model, signal, socket);
			if (terminal.type !== "response.completed" || state.responseId === undefined) throw new CodexError({ kind: "stream" });
			const rawItems = completedRawItems(state.events);
			// Private continuation baseline only: prewarm output never enters the durable history or the raw ledger.
			this.#continuation.acceptCompleted(body, state.responseId, rawItems, socket.socketIdentity);
			this.#prewarmedSocket = socket.socketIdentity;
		})()
			.catch((error: unknown) => {
				// Native: a prewarm upgrade answered 426 switches the session to HTTP at once, so the first turn makes no
				// further upgrade attempt (codex-rs core/tests/suite/websocket_fallback.rs:74-78). Other failures only drop the socket.
				if (error instanceof SocketError && error.kind === "upgrade-rejected" && error.status === 426) this.#transport = "sse";
				this.#dropSocket();
			})
			.finally(() => {
				linked.release();
				if (this.#prewarm === entry) this.#prewarm = undefined;
			});
		this.#prewarm = entry;
		return entry.promise;
	}

	/**
	 * Mechanical raw send of one request the caller already built (compaction, prewarm or turn). One logical attempt:
	 * SSE repeats only HTTP 5xx and transport failures with the same prepared zstd bytes, and only before any event was
	 * yielded; there is no stream-level or unbounded retry here (the caller owns it). Yields raw native events as they
	 * arrive; onPayload runs once; the final body is validated and passed to history.preparedRequest before sending.
	 */
	async *sendRaw(args: SendRawOptions): AsyncGenerator<Record<string, unknown>, void, undefined> {
		const { model, requestKind, request } = args;
		const options = args.options ?? {};
		if (this.#disposed) throw new CodexError({ kind: "fatal" });
		if (model.provider !== CODEX_PROVIDER) throw new CodexError({ kind: "invalid_request" });
		// Checked before any credential is read: a request identity with another lineage is a local refusal.
		const identity = this.#requestIdentity(args.identity);
		const linked = linkSignals([options.signal, args.signal, this.#lifetime.signal]);
		try {
			const signal = linked.signal;
			const { socketId, cred: authorized } = await this.#authorize(options, signal);
			// Canonical client_metadata (ordinary credit request, identity) under the caller's own blob, before the hook runs.
			const provided = (request.client_metadata ?? {}) as Record<string, string>;
			const merged = { ...clientMetadata(identity, requestKind), ...provided };
			const body = await this.#finalBody(model, { ...(request as unknown as Record<string, unknown>), client_metadata: merged }, options, requestKind === "turn", signal);
			let cred = await this.#confirmOwner(authorized, signal);
			let transport = args.transport ?? this.#transport;
			// One logical request: a 401 before any event gets reload, then refresh, each followed by a retry of this same body.
			// The body and its zstd bytes are prepared once (when SSE is first selected); only the canonical auth headers and socket revision change.
			const auth = new AuthRecoveryPolicy();
			const http = this.#httpPolicy();
			let bytes: Uint8Array | undefined;
			for (;;) {
				signal.throwIfAborted();
				// The saved owner is re-read before every attempt, including after a retry or recovery delay.
				cred = await this.#confirmOwner(cred, signal);
				const state = newState(requestKind === "turn");
				let yielded = false;
				try {
					if (transport === "websocket") {
						const socket = await this.#openSocket(cred, options, model, requestKind, socketId, signal, body, identity);
						await this.#send(socket, { type: "response.create", ...body, client_metadata: this.#wsMetadata(body, this.#clock.now()) }, signal, cred);
						for await (const event of this.#events(socket.events(), state, options, model, signal, socket)) {
							yielded = true;
							yield event;
						}
					} else {
						const gate: HeadGate = { failed: false, pending: undefined };
						bytes ??= compressRequest(new TextEncoder().encode(JSON.stringify(body)));
						const source = gatedEvents((this.#deps.postEvents ?? postEvents)({
							url: CODEX_ENDPOINT,
							headers: this.#sseHeaders(cred, options, requestKind, body, identity),
							body: bytes,
							fetch: this.#deps.fetch,
							signal,
							onResponse: (head) => this.#onHead(head, options, model, gate),
						}), gate);
						for await (const event of this.#events(source, state, options, model, signal)) {
							yielded = true;
							yield event;
						}
					}
					this.#afterRaw(state);
					return;
				} catch (raw) {
					if (yielded || isAbort(raw, signal) || raw instanceof LocalRequestError) throw raw;
					const error = toCodexError(raw, this.#clock.now());
					if (error.kind === "unauthorized") {
						const next = auth.next(error);
						if (next.action === "reload" || next.action === "refresh") {
							cred = await this.#recover(cred, next.action, signal);
							continue;
						}
						throw raw;
					}
					// Native upgrade fallback before any event: sticky SSE for this thread, the same prepared body, no retry budget spent.
					if (transport === "websocket" && error.status === 426) {
						transport = "sse";
						this.#transport = "sse";
						continue;
					}
					if (transport === "websocket") throw raw;
					const decision = http.next(error);
					if (!decision.retry) throw raw;
					await sleepAbortable(decision.delayMs, signal, this.#deps.sleep);
				}
			}
		} finally {
			linked.release();
		}
	}

	/**
	 * Identity of one sendRaw call: the thread identity itself, or the caller's request-scoped identity after the lineage check.
	 * The scoped identity is copied and forced to the subscription profile; updateMetadata and the thread identity are untouched.
	 */
	#requestIdentity(scoped: CodexIdentity | undefined): CodexIdentity {
		if (scoped === undefined) return this.identity;
		for (const key of IMMUTABLE_IDENTITY_KEYS) {
			if (scoped[key] !== this.#identity[key]) {
				throw new LocalRequestError(`RQW-codex: the request identity ${key} does not match the thread. Request not sent.`);
			}
		}
		try {
			if (scoped.extra !== undefined) validateExtraMetadata(scoped.extra);
		} catch {
			throw new LocalRequestError("RQW-codex: the request identity extra metadata is invalid. Request not sent.");
		}
		return { ...structuredClone(scoped), authProfile: "subscription" };
	}

	/**
	 * Request-local identity for a prewarm, taken when it is requested: lineage and metadata only. The startup prewarm is
	 * not a user turn, so the turn id and turn start time of a simultaneous active generation never reach its body or headers.
	 */
	#prewarmIdentity(): CodexIdentity {
		return { ...this.#identity, turnId: undefined, turnStartedAtUnixMs: undefined };
	}

	/** Logical turn boundary: a new turn clears the sticky turn state and sets the turn id. Socket and fallback stay. */
	beginTurn(info: TurnInfo = {}): void {
		this.#turnId = info.turnId;
		this.#turnState = undefined;
		this.#resetTurn();
	}

	endTurn(): void {
		this.#turnId = undefined;
		this.#turnState = undefined;
		this.#resetTurn();
	}

	/** A new logical turn or a completed response starts with fresh retry, auth and handoff state. */
	#resetTurn(): void {
		this.#policy = undefined;
		this.#pendingGate = new PendingErrorGate();
		this.#recovery = undefined;
		this.#handoffDelayMs = 0;
	}

	/** Retires the thread: aborts a pending prewarm, closes its socket, drops continuation state and raw ledger. Idempotent. */
	dispose(): void {
		if (this.#disposed) return;
		this.#disposed = true;
		this.#prewarm?.abort.abort();
		this.#lifetime.abort();
		this.#dropSocket();
		this.#ledger.clear();
		this.#lastTurn = undefined;
		this.#turnState = undefined;
	}

	// ---- request path -------------------------------------------------------------------------------------------

	#emptyOutput(model: Model<Api>): AssistantMessage {
		return {
			role: "assistant",
			content: [],
			api: model.api,
			provider: model.provider,
			model: model.id,
			usage: zeroUsage(),
			stopReason: "stop",
			timestamp: this.#clock.now(),
		} as AssistantMessage;
	}

	#wireOptions(options: CodexStreamOptions): WireOptions {
		return {
			reasoningEffort: options.reasoningEffort,
			reasoning: options.reasoning,
			reasoningSummary: options.reasoningSummary,
			serviceTier: options.serviceTier,
			verbosity: options.verbosity,
			reasoningEffortOverride: CODEX_STABLE_FEATURES.reasoningEffortOverride,
		};
	}

	async #resolve(signal: AbortSignal | undefined): Promise<Credential> {
		const controller = new AbortController();
		const link = () => controller.abort();
		signal?.addEventListener("abort", link, { once: true });
		try {
			const { credential, accountId } = await resolveStoredCredential(this.#store, controller.signal);
			return Object.assign({}, credential, { accountId });
		} finally {
			signal?.removeEventListener("abort", link);
		}
	}

	/**
	 * Owned authorization for one request. The stored owner is captured here, before any payload hook runs. An explicit
	 * key is accepted only with the origin proof that auth-runtime attaches to a resolved stored bearer, and only when it
	 * equals the captured stored credential; otherwise it is refused before anything is sent. Refusals never carry a key.
	 */
	async #authorize(options: CodexStreamOptions, signal: AbortSignal): Promise<{ socketId: string; cred: Credential }> {
		const explicit = options.apiKey;
		const hasExplicit = explicit !== undefined && explicit !== "";
		// Provenance comes from the prepared request top level (wrapper path) or from the scoped env carrier (getAuth result merged by Pi).
		const scoped = (options.env as unknown as Record<PropertyKey, unknown> | undefined)?.[CODEX_AUTH_ORIGIN];
		const origin = ((options as unknown as Record<PropertyKey, unknown>)[CODEX_AUTH_ORIGIN] ?? scoped) as CodexAuthOrigin | undefined;
		if (hasExplicit && origin === undefined) {
			throw new LocalRequestError("RQW-codex: explicit API keys are not accepted; use /login openai-codex. Request not sent.");
		}
		localCall(() => validateSubscriptionEndpoint(CODEX_ENDPOINT, { redirect: "error", env: process.env }));
		const cred = await this.#ensureOwner(signal, options.preparedOwner);
		if (hasExplicit) {
			const proven =
				origin?.provider === CODEX_PROVIDER &&
				origin.source === "resolved-bearer" &&
				origin.accountId === cred.accountId &&
				origin.accessRevision === accessDigest(cred.access) &&
				explicit === cred.access;
			if (!proven) throw new LocalRequestError("RQW-codex: the explicit API key does not match the saved subscription login. Request not sent.");
		}
		return { socketId: `${cred.accountId}:${this.#identity.threadId}`, cred };
	}

	/**
	 * Re-reads the native openai-codex slot after the payload hooks and before the first credential-bearing send. The captured
	 * owner must still be the saved login: a logout, a replaced slot or another account is a fixed local refusal (nothing is
	 * sent, no other login is borrowed, no auth retry). Same-account access rotation is allowed; the fresh grant is used.
	 */
	async #confirmOwner(captured: Credential, signal: AbortSignal): Promise<Credential> {
		let stored: unknown;
		try {
			stored = await this.#store.read(PROVIDER_ID, { signal });
		} catch {
			signal.throwIfAborted();
			throw new LocalRequestError(OWNER_CHANGED_MESSAGE);
		}
		let current: ReturnType<typeof validateCredential>;
		try {
			current = validateCredential(stored);
			if (credentialIdentity(current) !== captured.accountId) throw new Error("owner changed");
		} catch {
			throw new LocalRequestError(OWNER_CHANGED_MESSAGE);
		}
		return Object.assign({}, current, { accountId: captured.accountId });
	}

	/**
	 * Same-slot account check: a different owner clears sticky routing, the raw ledger, the turn state and the socket.
	 * A changed bearer revision invalidates the continuation (the socket is reopened by #openSocket).
	 */
	async #ensureOwner(signal: AbortSignal, prepared?: string): Promise<Credential> {
		const cred = await this.#resolve(signal);
		// A prepared owner is checked before any state, ledger or socket of another owner is adopted.
		if (prepared !== undefined && cred.accountId !== prepared) throw new LocalRequestError(OWNER_CHANGED_MESSAGE);
		const digest = accessDigest(cred.access);
		if (this.#owner !== undefined && this.#owner !== cred.accountId) {
			this.#transport = "websocket";
			this.#turnState = undefined;
			this.#ledger.clear();
			this.#dropSocket();
		} else if (this.#digest !== undefined && this.#digest !== digest) {
			this.#continuation.invalidate();
		}
		this.#owner = cred.accountId;
		this.#digest = digest;
		return cred;
	}

	/** Builds the native request for a logical turn or prewarm, then runs the final checks (onPayload once). */
	async #hookedBody(
		model: Model<Api>,
		context: Context,
		options: CodexStreamOptions,
		requestKind: RequestKind,
		generate?: boolean,
		identity: CodexIdentity = this.identity,
		signal?: AbortSignal,
	): Promise<Record<string, unknown>> {
		const wireOptions = this.#wireOptions(options);
		const capabilities = wireCapabilities(model);
		const base = localCall(() => buildRequest({
			model,
			context,
			options: wireOptions,
			capabilities,
			identity,
			// With an external raw history, Pi's thinkingSignature is unproven as owner's: only owner-proven raw items replay.
			history: { rawOutputs: this.#rawOutputs(context), allowThinkingSignatures: false },
			requestKind,
		}) as unknown as Record<string, unknown>);
		if (options.nativeInput !== undefined) {
			// The builder prefix (tools, base instructions) is taken once from an empty transcript; the projected history follows it.
			const prefix = localCall(() => buildRequest({
				model,
				context: prefixContext(context),
				options: wireOptions,
				capabilities,
				identity,
				requestKind,
			}).input);
			base.input = [...prefix, ...options.nativeInput];
		}
		if (generate !== undefined) base.generate = generate;
		return this.#finalBody(model, base, options, requestKind === "turn", signal);
	}

	/**
	 * Awaits onPayload exactly once, validates the final body and forces parallel_tool_calls true. A hook failure is a local refusal (no retry). With a signal,
	 * the wait for the hook ends as soon as the signal aborts (a hung hook cannot hold it); a late hook result is ignored.
	 * An abort is rethrown as AbortError, never as a LocalRequestError.
	 */
	async #finalBody(model: Model<Api>, base: Record<string, unknown>, options: CodexStreamOptions, durable: boolean, signal?: AbortSignal): Promise<Record<string, unknown>> {
		const capabilities = wireCapabilities(model);
		signal?.throwIfAborted();
		let replaced: unknown;
		try {
			const pending = options.onPayload?.(base, model);
			replaced = signal ? await untilAborted(Promise.resolve(pending), signal) : await pending;
		} catch {
			if (signal?.aborted) throw abortError();
			throw new LocalRequestError("RQW-codex: the onPayload hook failed. Request not sent.");
		}
		signal?.throwIfAborted();
		const body = (replaced ?? base) as Record<string, unknown>;
		localCall(() => validateFinalRequest({
			body,
			capabilities,
			expectedServiceTier: typeof base.service_tier === "string" ? base.service_tier : undefined,
		}));
		// [D-CODEX-PARALLEL] a hook cannot turn parallel tool calls off; set after the hook, the sent body always carries true.
		body.parallel_tool_calls = true;
		if (durable) this.#history?.preparedRequest?.(body);
		return body;
	}

	/** Raw outputs for a request built from context: the history's accepted responses only (no filter without a context). */
	#rawOutputs(context?: Context): ReadonlyMap<string, readonly WireItem[]> {
		const selected = this.#history ? this.#history.rawOutputs() : this.#ledger;
		const accept = this.#history?.acceptRawResponse?.bind(this.#history);
		if (context === undefined || accept === undefined) return selected;
		const out = new Map<string, readonly WireItem[]>();
		for (const [responseId, items] of selected) {
			if (accept(responseId, context)) out.set(responseId, items);
		}
		return out;
	}

	#recordOutputs(responseId: string, items: readonly WireItem[]): void {
		if (this.#history) {
			this.#history.recordOutputs(responseId, items);
			return;
		}
		this.#ledger.delete(responseId);
		this.#ledger.set(responseId, structuredClone([...items]));
		while (this.#ledger.size > LEDGER_LIMIT) {
			const oldest = this.#ledger.keys().next().value;
			if (oldest === undefined) break;
			this.#ledger.delete(oldest);
		}
	}

	async #sample(
		model: Model<Api>,
		context: Context,
		options: CodexStreamOptions,
		signal: AbortSignal,
		pump: LiveResponsesPump,
	): Promise<void> {
		if (model.provider !== CODEX_PROVIDER) throw new CodexError({ kind: "invalid_request" });
		// A tool handoff's terminal error surfaces here: no backend request and no query.
		const pending = this.#pendingGate.takeBeforeRequest();
		if (pending) throw pending;
		const { socketId, cred: initial } = await this.#authorize(options, signal);
		let cred = initial;
		const body = await this.#hookedBody(model, context, options, "turn", undefined, this.identity, signal);
		this.#lastTurn = structuredClone({ model, context, body });
		// Actual effort of the final validated body (after any onPayload change), as Pi persists the thinking level.
		const effort = (body.reasoning as { effort?: unknown } | undefined)?.effort;
		if (typeof effort === "string") pump.output.providerThinkingLevel = effort;
		cred = await this.#confirmOwner(cred, signal);
		pump.setServiceTier(body.service_tier);

		// One policy pair per logical turn: a tool handoff continues it on the next stream call (reset by #resetTurn).
		const policy = (this.#policy ??= {
			auth: new AuthRecoveryPolicy(),
			retry: new RetryPolicy({
				transport: this.#transport,
				maxRetries: this.#deps.providerRetries?.streamMaxRetries,
				clock: { now: () => this.#clock.now() },
				random: this.#deps.random,
			}),
		});
		const auth = policy.auth;
		const retry = policy.retry;
		if (this.#recovery !== undefined) {
			const stage = this.#recovery;
			this.#recovery = undefined;
			cred = await this.#recover(cred, stage, signal);
		}
		if (this.#handoffDelayMs > 0) {
			const delayMs = this.#handoffDelayMs;
			this.#handoffDelayMs = 0;
			await sleepAbortable(delayMs, signal, this.#deps.sleep);
		}
		let partial: WireItem[] = [];
		let prepared: { bytes: Uint8Array; partialCount: number } | undefined;

		for (;;) {
			signal.throwIfAborted();
			this.#transport = retry.transport;
			const logical = partial.length === 0 ? body : { ...body, input: [...(body.input as WireItem[]), ...partial] };
			try {
				const ctx = { options, model, signal, socketId, cred, requestKind: "turn" as RequestKind, pump };
				const result =
					retry.transport === "websocket"
						? await this.#attemptWebSocket(logical, ctx)
						: await this.#attemptSse(logical, ctx, () => {
							if (prepared?.partialCount !== partial.length) {
								prepared = { bytes: compressRequest(new TextEncoder().encode(JSON.stringify(logical))), partialCount: partial.length };
							}
							return prepared.bytes;
						});
				return await this.#finish(result, logical, pump);
			} catch (raw) {
				if (isAbort(raw, signal)) throw abortError();
				if (raw instanceof LocalRequestError && pump.completedRawItems.length === 0) throw raw;
				const error = toCodexError(raw, this.#clock.now());
				if (!(raw instanceof LocalRequestError)) this.#dropSocket();
				// The failed attempt's display is closed here; its completed items and actual usage are kept by the pump.
				const attemptFailure = await pump.retryBoundary();
				if (raw instanceof LocalRequestError) {
					await pump.finish({ error: raw, completedContent: completedContent(pump.completedRawItems, pump.grammarToolInputProperties) });
					return;
				}
				if (attemptFailure) this.#carriedUsageErrors.add(error);
				const partialInput = {
					completedItems: pump.completedRawItems,
					grammarToolInputProperties: pump.grammarToolInputProperties,
					error,
					context: { api: model.api, provider: model.provider, model: model.id, usage: pump.usage },
					unfinishedToolCalls: pump.droppedToolCallCount,
				};
				const handoff = decidePartialHandoff(partialInput);
				const finishFailure = async (recoveryError?: unknown): Promise<boolean> => {
					const terminal = handoff.action === "fail" ? handoff : decidePartialHandoff({ ...partialInput, terminal: true });
					if (terminal.action !== "fail") return false;
					await pump.finish({ failure: terminal.message, ...(recoveryError !== undefined ? { error: recoveryError } : {}) });
					return true;
				};
				if (handoff.action === "tool_handoff") {
					// Completed calls go to Pi's own tool loop once, with their raw items kept for the replay. The unfinished call
					// is not included, and no backend retry is sent now.
					const responseId = pump.output.responseId;
					if (responseId !== undefined) this.#recordOutputs(responseId, pump.completedRawItems as WireItem[]);
					this.#handoffFailure(policy, error);
					await pump.finish({ handoff: responseId === undefined ? handoff.message : { ...handoff.message, responseId } });
					return;
				}
				if (error.partialItems) partial = [...partial, ...(error.partialItems as WireItem[])];
				const next = auth.next(error);
				if (next.action === "reload" || next.action === "refresh") {
					try {
						cred = await this.#recover(cred, next.action, signal);
					} catch (raw) {
						if (isAbort(raw, signal)) throw abortError();
						if (await finishFailure(raw)) return;
						throw raw;
					}
					continue;
				}
				if (error.kind === "unauthorized") {
					if (await finishFailure()) return;
					throw error;
				}
				const decision = retry.next(error);
				if (decision.action === "fail") {
					if (await finishFailure()) return;
					throw error;
				}
				if (decision.action === "fallback") this.#transport = "sse";
				if (decision.delayMs > 0) await sleepAbortable(decision.delayMs, signal, this.#deps.sleep);
			}
		}
	}

	/** One policy decision for a failed tool handoff: consumed now, its recovery or delay is owed before the next backend request. */
	#handoffFailure(policy: { auth: AuthRecoveryPolicy; retry: RetryPolicy }, error: CodexError): void {
		const auth = policy.auth.next(error);
		if (auth.action === "reload" || auth.action === "refresh") {
			this.#recovery = auth.action;
			return;
		}
		if (error.kind === "unauthorized" || !error.retryable) {
			this.#pendingGate = new PendingErrorGate(error);
			return;
		}
		const decision = policy.retry.next(error);
		if (decision.action === "fail") {
			this.#pendingGate = new PendingErrorGate(error);
			return;
		}
		if (decision.action === "fallback") this.#transport = "sse";
		this.#handoffDelayMs = decision.delayMs;
	}

	async #recover(cred: Credential, stage: "reload" | "refresh", signal: AbortSignal): Promise<Credential> {
		const access = cred.access;
		const refreshed = await recoverCredential(this.#store, { accountId: cred.accountId, access }, stage, signal, { fetch: this.#deps.fetch as typeof fetch | undefined });
		this.#revision++;
		this.#dropSocket();
		return Object.assign({}, refreshed, { accountId: credentialIdentity(refreshed) });
	}

	/** Records the completed response (raw items, continuation, usage of the served model). Display was already fed live. */
	async #finish(
		result: AttemptResult,
		logical: Record<string, unknown>,
		pump: LiveResponsesPump,
	): Promise<void> {
		const { terminal, events } = result;
		const rawItems = completedRawItems(events);
		const responseId = result.responseId ?? (typeof (terminal.response as { id?: unknown } | undefined)?.id === "string" ? (terminal.response as { id: string }).id : undefined);
		const error = terminal.type === "response.failed" || terminal.type === "error" ? classifyEvent(terminal, this.#clock.now()) : null;
		if (error) {
			throw error.withPartial(rawItems, normalizeUsage((terminal.response as { usage?: unknown } | undefined)?.usage));
		}
		if (responseId === undefined) throw new CodexError({ kind: "stream" });
		const incomplete = terminal.type === "response.incomplete" ? classifyEvent(terminal, this.#clock.now()) : null;
		if (incomplete) {
			throw incomplete.withPartial(rawItems, normalizeUsage((terminal.response as { usage?: unknown } | undefined)?.usage));
		}
		this.#recordOutputs(responseId, rawItems);
		if (result.socketId !== undefined) {
			this.#continuation.acceptCompleted(logical, responseId, rawItems, result.socketId);
			// An accepted WebSocket response means this socket is already warm: a later prewarm of it is skipped.
			this.#prewarmedSocket = result.socketId;
		}
		this.#completedOnce = true;
		this.#resetTurn();
		const reported = reportedModel(events);
		if (reported !== undefined && reported !== logical.model) pump.output.responseModel = reported;
	}

	// ---- attempts -------------------------------------------------------------------------------------------------

	/**
	 * One SSE logical attempt. HTTP 5xx and transport failures are repeated inside the attempt with the same prepared
	 * bytes (HttpRetryPolicy: 4 retries, 429 and typed errors never), only while no event has been received.
	 */
	async #attemptSse(
		body: Record<string, unknown>,
		ctx: { options: CodexStreamOptions; model: Model<Api>; signal: AbortSignal; socketId: string; cred: Credential; requestKind: RequestKind; pump: LiveResponsesPump },
		bytes: () => Uint8Array,
	): Promise<AttemptResult> {
		const http = this.#httpPolicy();
		const payload = bytes();
		for (;;) {
			ctx.signal.throwIfAborted();
			// The saved owner is re-read before each HTTP attempt, after any retry delay; the fresh same-owner grant is used.
			const cred = await this.#confirmOwner(ctx.cred, ctx.signal);
			const state = newState(true);
			try {
				const gate: HeadGate = { failed: false, pending: undefined };
				const source = gatedEvents((this.#deps.postEvents ?? postEvents)({
					url: CODEX_ENDPOINT,
					headers: this.#sseHeaders(cred, ctx.options, ctx.requestKind, body),
					body: payload,
					fetch: this.#deps.fetch,
					signal: ctx.signal,
					onResponse: (head) => this.#onHead(head, ctx.options, ctx.model, gate),
				}), gate);
				const terminal = await this.#collect(source, state, ctx.options, ctx.model, ctx.signal, undefined, ctx.pump);
				return { terminal, events: state.events, responseId: state.responseId, body };
			} catch (raw) {
				if (state.events.length > 0 || isAbort(raw, ctx.signal) || raw instanceof LocalRequestError) throw raw;
				const decision = http.next(toCodexError(raw, this.#clock.now()));
				if (!decision.retry) throw raw;
				await sleepAbortable(decision.delayMs, ctx.signal, this.#deps.sleep);
			}
		}
	}

	async #attemptWebSocket(
		body: Record<string, unknown>,
		ctx: { options: CodexStreamOptions; model: Model<Api>; signal: AbortSignal; socketId: string; cred: Credential; requestKind: RequestKind; pump: LiveResponsesPump },
	): Promise<AttemptResult> {
		const socket = await this.#openSocket(ctx.cred, ctx.options, ctx.model, ctx.requestKind, ctx.socketId, ctx.signal, body);
		// Continuation is keyed by the actual connection identity, never by a secret-bearing or logical id.
		const prepared = this.#continuation.prepare(body, socket.socketIdentity);
		const wire = prepared.mode === "incremental" ? prepared.body : body;
		const state = newState(true);
		await this.#send(socket, { type: "response.create", ...wire, client_metadata: this.#wsMetadata(wire, this.#clock.now()) }, ctx.signal, ctx.cred);
		const terminal = await this.#collect(socket.events(), state, ctx.options, ctx.model, ctx.signal, socket, ctx.pump);
		return { terminal, events: state.events, responseId: state.responseId, socketId: socket.socketIdentity, body };
	}

	#sseHeaders(cred: Credential, options: CodexStreamOptions, requestKind: RequestKind, body: Record<string, unknown>, identity: CodexIdentity = this.identity): Record<string, string> {
		const headers = withoutTurnState(mergeHeaders(
			options.headers,
			identityHeaders(identity, { requestKind, transport: "sse", platform: localPlatform() }),
			{
				"x-codex-routing-hint": routingHint(body),
				Authorization: `Bearer ${cred.access}`,
				"ChatGPT-Account-ID": cred.accountId,
				"Content-Encoding": "zstd",
			},
		));
		if (this.#turnState !== undefined) headers[STICKY_TURN_STATE] = this.#turnState;
		return headers;
	}

	#wsMetadata(body: Record<string, unknown>, nowMs: number): Record<string, string> {
		const meta = { ...((body.client_metadata as Record<string, string> | undefined) ?? {}) };
		if (this.#turnState !== undefined) meta[STICKY_TURN_STATE] = this.#turnState;
		// Stamped immediately before send; a string, as native does (client.rs:2087-2095).
		meta[WS_START_MS] = String(nowMs);
		return meta;
	}

	/** Reuses the open socket only for the same owner, bearer revision and logical slot; otherwise connects anew. */
	async #openSocket(
		cred: Credential,
		options: CodexStreamOptions,
		model: Model<Api>,
		requestKind: RequestKind,
		socketId: string,
		signal: AbortSignal,
		body: Record<string, unknown>,
		identity: CodexIdentity = this.identity,
	): Promise<CodexSocket> {
		const digest = accessDigest(cred.access);
		const current = this.#socket;
		if (current && current.socketId === socketId && current.revision === this.#revision && current.digest === digest && current.socket.isOpen) {
			return current.socket;
		}
		this.#dropSocket();
		const headers = withoutTurnState(mergeHeaders(
			options.headers,
			identityHeaders(identity, { requestKind, transport: "websocket", platform: localPlatform() }),
			{
				"x-codex-routing-hint": routingHint(body),
				Authorization: `Bearer ${cred.access}`,
				"ChatGPT-Account-ID": cred.accountId,
			},
		));
		const gate: HeadGate = { failed: false, pending: undefined };
		// Connect runs under a per-attempt relay of the request signal and the thread lifetime. The relay is released as soon as
		// the upgrade settles, so a later abort of this caller can never reach the socket kept for the next request.
		const relay = linkSignals([signal, this.#lifetime.signal]);
		let socket: CodexSocket;
		try {
			socket = await (this.#deps.connect ?? connect)({
				url: CODEX_ENDPOINT,
				headers,
				signal: relay.signal,
				onResponse: (head) => this.#onHead(head, options, model, gate),
			});
		} catch (error) {
			relay.release();
			await settleHead(gate, signal);
			throw error;
		}
		relay.release();
		try {
			await settleHead(gate, signal);
		} catch (error) {
			void socket.close().catch(() => undefined);
			throw error;
		}
		if (signal.aborted) {
			void socket.close().catch(() => undefined);
			throw abortError();
		}
		this.#socket = { socket, socketId, revision: this.#revision, digest };
		return socket;
	}

	/**
	 * Sends one credential-bearing frame. Immediately before the send the saved owner is re-read: a changed or removed owner
	 * refuses the frame (LocalRequestError, never retried). Any failed check or send retires this socket. The signal is checked
	 * first; the send itself races the signal, so a backpressured send cannot hold an abort.
	 */
	async #send(socket: CodexSocket, frame: Record<string, unknown>, signal: AbortSignal, captured: Credential): Promise<void> {
		if (signal.aborted) {
			this.#retire(socket);
			throw abortError();
		}
		try {
			await this.#confirmOwner(captured, signal);
			if (signal.aborted) throw abortError();
			const sent = new Promise<void>((resolve) => resolve(socket.send(frame)));
			await untilAborted(sent, signal);
		} catch (error) {
			// A failed or aborted send leaves the socket in an unknown state: it is never reused.
			this.#retire(socket);
			throw error instanceof SocketError ? toCodexError(error, this.#clock.now(), "established") : error;
		}
	}

	/** Retires one socket of a request: the cached socket is dropped, any other one is closed and never reused. */
	#retire(socket: CodexSocket): void {
		if (this.#socket?.socket === socket) this.#dropSocket();
		else void socket.close().catch(() => undefined);
	}

	#dropSocket(): void {
		const current = this.#socket;
		this.#socket = undefined;
		this.#continuation.invalidate();
		if (current) current.socket.close().catch(() => undefined);
	}

	/**
	 * Sticky turn state from a response metadata event (top-level headers, responses_websocket.rs:849-853). First valid value
	 * only: the upgrade head, the SSE head and an earlier metadata event keep their value. Invalid or empty values are ignored.
	 */
	#captureTurnState(headers: unknown): void {
		if (this.#turnState !== undefined || typeof headers !== "object" || headers === null || Array.isArray(headers)) return;
		for (const [name, value] of Object.entries(headers)) {
			if (name.toLowerCase() !== STICKY_TURN_STATE) continue;
			const first = turnStateValue(value);
			if (first !== undefined) {
				this.#turnState = first;
				return;
			}
		}
	}

	#onHead(head: ResponseHead, options: CodexStreamOptions, model: Model<Api> | undefined, gate: HeadGate): void {
		if (this.#turnState === undefined) this.#turnState = turnStateValue(head.headers[STICKY_TURN_STATE]);
		let hook: unknown;
		try {
			hook = options.onResponse?.(head as never, model as Model<Api>);
		} catch {
			gate.failed = true;
			return;
		}
		const thenable = hook as PromiseLike<unknown> | undefined;
		if (typeof thenable?.then === "function") {
			gate.pending = Promise.resolve(thenable).then(
				() => undefined,
				() => {
					gate.failed = true;
				},
			);
		}
	}

	/**
	 * Raw events of one attempt, in arrival order. onProviderStreamEvent is awaited before each event is used; a failure
	 * there is a local refusal. output_item.done reaches history.recordItem here, before the terminal event is yielded.
	 * Ends right after the terminal event; a source that ends early or fails is a typed error with the completed items.
	 * On caller abort, a WebSocket attempt retires its socket (closed, not reused); no response.interrupt is sent.
	 * With a pump (the real stream), each event is fed to the live display parser before it is yielded; sendRaw and prewarm
	 * pass no pump and show nothing.
	 */
	async *#events(
		source: AsyncIterable<unknown>,
		state: AttemptState,
		options: CodexStreamOptions,
		model: Model<Api>,
		signal: AbortSignal,
		socket?: CodexSocket,
		pump?: LiveResponsesPump,
	): AsyncGenerator<Record<string, unknown>, void, undefined> {
		const onAbort = () => {
			// A caller abort retires the socket at once; no response.interrupt is sent.
			if (socket) this.#retire(socket);
		};
		const detach = () => signal.removeEventListener("abort", onAbort);
		if (signal.aborted) {
			onAbort();
			throw abortError();
		}
		signal.addEventListener("abort", onAbort, { once: true });
		const iterator = source[Symbol.asyncIterator]();
		// True once the terminal event passed the hooks and the display parser and was handed out. Any other exit retires the socket.
		let accepted = false;
		// False while no read is in flight; an early stop of this generator then returns the source (its events() lock is released).
		let reading = false;
		try {
			for (;;) {
				reading = true;
				// The read races the caller signal: a source that never ends (a silent socket, a stalled stream) cannot hold an abort.
				const step = await untilAborted(iterator.next(), signal);
				reading = false;
				if (step.done) break;
				if (signal.aborted) throw abortError();
				const raw = step.value;
				const event = ((raw as RawEvent).value ?? raw) as Record<string, unknown>;
				try {
					// The hook wait races the signal: a hung hook cannot hold an abort; a caller abort is not a hook failure.
					await untilAborted(Promise.resolve(options.onProviderStreamEvent?.(event, model)), signal);
				} catch {
					if (signal.aborted) throw abortError();
					throw new LocalRequestError("RQW-codex: the onProviderStreamEvent hook failed. Request stopped.");
				}
				if (event.type === "error" && classifyEvent(event, this.#clock.now()) === null) continue;
				// Deltas are not kept: the display parser has them, and the raw ledger needs only controls and completed items.
				if (typeof event.type === "string" && !event.type.endsWith(".delta")) state.events.push(event);
				if (event.type === "response.metadata") this.#captureTurnState(event.headers);
				if (event.type === "response.created") {
					const id = (event.response as { id?: unknown } | undefined)?.id;
					if (typeof id === "string") state.responseId = id;
				}
				if (state.durable && event.type === "response.output_item.done" && state.responseId !== undefined && typeof event.item === "object" && event.item !== null) {
					this.#history?.recordItem?.(state.responseId, structuredClone(event.item) as WireItem);
				}
				if (pump) {
					try {
						await pump.push(event);
					} catch {
						throw new LocalRequestError("RQW-codex: the display parser failed. Request stopped.");
					}
				}
				const terminal = typeof event.type === "string" && TERMINAL_TYPES.has(event.type);
				// Accepted only now: the hooks and the parser took the terminal. The caller link is detached before it is handed out,
				// so nothing later can close a socket kept for reuse.
				if (terminal) {
					accepted = true;
					detach();
				}
				yield event;
				if (terminal) return;
			}
		} catch (error) {
			if (error instanceof LocalRequestError) throw error;
			if (isAbort(error, signal)) throw abortError();
			// A socket here already passed the upgrade, even if response.created has not arrived yet.
			throw toCodexError(error, this.#clock.now(), socket ? "established" : "connecting").withPartial(completedRawItems(state.events));
		} finally {
			// Any exit before the terminal was accepted (hook or parser refusal, early consumer return, end or failure of the source,
			// abort) can leave unread frames on the socket: it is retired and never reused.
			if (socket && !accepted) this.#retire(socket);
			detach();
			if (!reading) await iterator.return?.(undefined).catch(() => undefined);
		}
		if (signal.aborted) throw abortError();
		throw new CodexError({ kind: "stream", transport: true, partialItems: completedRawItems(state.events) });
	}

	/** Consumes one attempt until its terminal event and returns that terminal event. */
	async #collect(
		source: AsyncIterable<unknown>,
		state: AttemptState,
		options: CodexStreamOptions,
		model: Model<Api>,
		signal: AbortSignal,
		socket?: CodexSocket,
		pump?: LiveResponsesPump,
	): Promise<Record<string, unknown>> {
		let terminal: Record<string, unknown> | undefined;
		for await (const event of this.#events(source, state, options, model, signal, socket, pump)) terminal = event;
		return terminal as Record<string, unknown>;
	}

	/** sendRaw bookkeeping after a completed response: its raw items enter the ledger (success only). */
	#afterRaw(state: AttemptState): void {
		const last = state.events[state.events.length - 1];
		if (!state.durable || last?.type !== "response.completed" || state.responseId === undefined) return;
		this.#recordOutputs(state.responseId, completedRawItems(state.events));
	}

	/** Prewarm wait for the first real turn: only the remaining part of the 15 s startup budget. Failures are ignored. */
	async #waitPrewarm(signal: AbortSignal): Promise<void> {
		signal.throwIfAborted();
		const pending = this.#prewarm;
		if (!pending) return;
		const remaining = Math.max(0, PREWARM_WAIT_BUDGET_MS - (this.#clock.now() - pending.startedAt));
		let timer: ReturnType<typeof setTimeout> | undefined;
		let onAbort: (() => void) | undefined;
		const outcome = await Promise.race([
			pending.promise.then(() => "settled" as const),
			new Promise<"expired">((resolve) => {
				timer = setTimeout(() => resolve("expired"), remaining);
			}),
			new Promise<"aborted">((resolve) => {
				onAbort = () => resolve("aborted");
				signal.addEventListener("abort", onAbort, { once: true });
			}),
		]);
		if (timer !== undefined) clearTimeout(timer);
		if (onAbort) signal.removeEventListener("abort", onAbort);
		if (outcome === "settled") return;
		if (outcome === "aborted") throw abortError();
		// Budget spent: retire this specific prewarm and its socket before the real request is sent.
		pending.abort.abort();
		await pending.promise;
		this.#dropSocket();
	}
}

/** Per-session/thread overlay: one transport per logical thread, looked up by thread id. */
export interface CodexOverlay {
	forThread(identity: CodexIdentity): CodexThreadTransport;
	release(threadId: string): void;
	disposeAll(): void;
}

export function createOverlay(options: {
	store: CredentialStore;
	dependencies?: TransportDependencies;
	history?: (threadId: string) => RawItemHistory | undefined;
}): CodexOverlay {
	const threads = new Map<string, CodexThreadTransport>();
	return {
		forThread(identity) {
			const existing = threads.get(identity.threadId);
			if (existing) return existing;
			const transport = new CodexThreadTransport({
				identity,
				store: options.store,
				dependencies: options.dependencies,
				history: options.history?.(identity.threadId),
			});
			threads.set(identity.threadId, transport);
			return transport;
		},
		release(threadId) {
			threads.get(threadId)?.dispose();
			threads.delete(threadId);
		},
		disposeAll() {
			for (const transport of threads.values()) transport.dispose();
			threads.clear();
		},
	};
}
