// Source: extensions/RQW-codex/transport.ts @ a85b810e924010f35387045fc0cbbd9a1e7173cc
// Narrowed extraction: raw Responses, saved-owner checks, sticky 426 fallback and bounded pre-event HTTP retries.
import { createHash } from "node:crypto";
import { recoverCredential, resolveStoredCredential } from "./auth-boundary.ts";
import { PROVIDER_ID, credentialIdentity, validateCredential } from "./auth.ts";
import { compressRequest } from "./compression.ts";
import { CodexError, classifyHttp, classifyTransport } from "./errors.ts";
import { mergeHeaders } from "./headers.ts";
import { clientMetadata, identityHeaders, localPlatform, type CodexIdentity } from "./metadata.ts";
import { CODEX_ENDPOINT, CODEX_PROVIDER, codexModelCapabilities } from "./profile.ts";
import { HttpRetryPolicy, sleepAbortable, type InjectedSleep, type StreamTransport } from "./retry.ts";
import { postEvents, SseError, type FetchLike } from "./sse.ts";
import { connect, SocketError, type CodexSocket, type ErrorControl, type RawEvent, type ResponseHead } from "./websocket.ts";
import { validateFinalRequest, type WireModelInfo, type WireRequest } from "./wire.ts";

type CredentialStore = Parameters<typeof resolveStoredCredential>[0];

interface TransportModel { id: string; provider: string }
export interface TransportDependencies {
	connect?: typeof connect;
	postEvents?: typeof postEvents;
	fetch?: FetchLike;
	clock?: { now(): number };
	random?: () => number;
	sleep?: InjectedSleep;
	providerRetries?: { requestMaxRetries?: number };
}
export interface TransportOptions {
	identity: CodexIdentity;
	store: CredentialStore;
	dependencies?: TransportDependencies;
}
interface RawRequestOptions {
	preparedOwner?: string;
}
export interface SendRawOptions {
	request: WireRequest;
	model: TransportModel;
	options?: RawRequestOptions;
	requestKind: "turn";
	signal?: AbortSignal;
	transport?: StreamTransport;
}
interface TurnInfo { turnId?: string }
type Credential = ReturnType<typeof validateCredential> & { accountId: string };
const TERMINAL_TYPES: ReadonlySet<string> = new Set(["response.completed", "response.incomplete", "response.failed", "error"]);
const STICKY_TURN_STATE = "x-codex-turn-state";
const WS_START_MS = "x-codex-ws-stream-request-start-ms";
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

/** Exact-slug native record, translated to the wire codec's field names (no /models, no guessing). */
export function wireCapabilities(model: TransportModel): WireModelInfo {
	const caps = codexModelCapabilities(model.id);
	return {
		slug: caps.slug,
		use_responses_lite: caps.useResponsesLite,
		default_reasoning_level: caps.defaultReasoningLevel,
		supported_reasoning_levels: caps.supportedReasoningLevels.map((effort) => ({ effort })),
		supports_reasoning_summary_parameter: caps.supportsReasoningSummaryParameter,
		default_reasoning_summary: caps.defaultReasoningSummary as WireModelInfo["default_reasoning_summary"],
		support_verbosity: caps.supportVerbosity,
		default_verbosity: caps.defaultVerbosity as WireModelInfo["default_verbosity"],
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
function toCodexError(error: unknown, now: number = Date.now()): CodexError {
	if (error instanceof CodexError) return error;
	if (error instanceof SocketError) {
		switch (error.kind) {
			case "upgrade-rejected":
				return error.status === undefined
					? classifyTransport("connection")
					: classifyHttp(error.status, error.headers, nativeErrorBody(error.control, now), now);
			case "redirect-rejected":
			case "origin":
				return new CodexError({ kind: "fatal", status: error.status, transport: true });
			case "connect-timeout":
			case "transport":
			case "closed":
				return classifyTransport("connection");
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

const OWNER_CHANGED_MESSAGE = "RQW-web: the saved ChatGPT login changed. Request not sent.";
// Local, safe refusals (request codec, final-body validation, owner checks). Their messages
// never carry server text, keys or bearers, and they are never retried as network failures.
class LocalRequestError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "LocalRequestError";
	}
}

export class CodexThreadTransport {
	readonly #identity: CodexIdentity;
	readonly #store: CredentialStore;
	readonly #deps: TransportDependencies;
	readonly #clock: { now(): number };
	readonly #lifetime = new AbortController();
	#turnId: string | undefined;
	#turnState: string | undefined;
	#transport: StreamTransport = "websocket";
	#socket: { socket: CodexSocket; socketId: string; digest: string } | undefined;
	#owner: string | undefined;
	#disposed = false;
	#busy = false;
	constructor(options: TransportOptions) {
		this.#identity = { ...options.identity, authProfile: "subscription" };
		this.#store = options.store;
		this.#deps = options.dependencies ?? {};
		this.#clock = this.#deps.clock ?? { now: () => Date.now() };
	}
	get #requestIdentity(): CodexIdentity { return { ...this.#identity, turnId: this.#turnId }; }
	beginTurn(info: TurnInfo = {}): void { this.#turnId = info.turnId; this.#turnState = undefined; }
	endTurn(): void { this.#turnId = undefined; this.#turnState = undefined; }
	dispose(): void {
		if (this.#disposed) return;
		this.#disposed = true;
		this.#lifetime.abort();
		this.#dropSocket();
		this.#turnState = undefined;
	}
	async *sendRaw(args: SendRawOptions): AsyncGenerator<Record<string, unknown>, void, undefined> {
		if (this.#disposed || this.#busy) throw new LocalRequestError("Transport is disposed or already sending.");
		if (args.model.provider !== CODEX_PROVIDER) throw new LocalRequestError("Subscription model required.");
		const options = args.options ?? {};
		const linked = linkSignals([args.signal, this.#lifetime.signal]);
		const signal = linked.signal;
		this.#busy = true;
		try {
			signal.throwIfAborted();
			let cred = await this.#ensureOwner(signal, options.preparedOwner);
			const base = structuredClone(args.request) as unknown as Record<string, unknown>;
			delete base.service_tier;
			base.client_metadata = { ...clientMetadata(this.#requestIdentity, "turn"), ...((base.client_metadata ?? {}) as Record<string, string>) };
			localCall(() => validateFinalRequest({ body: base, capabilities: wireCapabilities(args.model) }));
			const body = base;
			cred = await this.#confirmOwner(cred, signal);
			const socketId = `${cred.accountId}:${this.#identity.threadId}`;
			let transport = args.transport ?? this.#transport;
			const http = new HttpRetryPolicy({ maxRetries: this.#deps.providerRetries?.requestMaxRetries, clock: this.#clock, random: this.#deps.random });
			let bytes: Uint8Array | undefined;
			let reloaded = false;
			for (;;) {
				signal.throwIfAborted();
				cred = await this.#confirmOwner(cred, signal);
				let yielded = false;
				let socket: CodexSocket | undefined;
				try {
					let source: AsyncIterable<unknown>;
					if (transport === "websocket") {
						socket = await this.#openSocket(cred, socketId, signal, body);
						await this.#send(socket, { type: "response.create", ...body, client_metadata: this.#wsMetadata(body, this.#clock.now()) }, signal, cred);
						source = socket.events();
					} else {
						bytes ??= compressRequest(new TextEncoder().encode(JSON.stringify(body)));
						source = (this.#deps.postEvents ?? postEvents)({ url: CODEX_ENDPOINT, headers: this.#sseHeaders(cred, body), body: bytes, fetch: this.#deps.fetch, signal, onResponse: head => this.#onHead(head) });
					}
					for await (const event of this.#events(source, signal, socket)) {
						yielded = true;
						yield event;
					}
					return;
				} catch (raw) {
					if (socket) this.#retire(socket);
					if (isAbort(raw, signal) || raw instanceof LocalRequestError) throw raw;
					const error = toCodexError(raw, this.#clock.now());
					// Never replay an attempt once the caller has observed any event.
					if (yielded) throw raw;
					if (error.kind === "unauthorized") {
						if (reloaded) throw raw;
						reloaded = true;
						const refreshed = await untilAborted(recoverCredential(this.#store, { accountId: cred.accountId, access: cred.access }, signal), signal);
						cred = { ...refreshed, accountId: cred.accountId };
						this.#dropSocket();
						continue;
					}
					// The raw path falls back only on 426, with no stream retry budget.
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
		} finally { linked.release(); this.#busy = false; }
	}
	async #resolve(signal: AbortSignal): Promise<Credential> {
		const { credential, accountId } = await untilAborted(resolveStoredCredential(this.#store, signal), signal);
		return { ...credential, accountId };
	}

	/**
	 * Re-reads the native openai-codex slot before each credential-bearing send. The captured
	 * owner must still be the saved login: a logout, a replaced slot or another account is a fixed local refusal (nothing is
	 * sent, no other login is borrowed, no auth retry). Same-account access rotation is allowed; the fresh grant is used.
	 */
	async #confirmOwner(captured: Credential, signal: AbortSignal): Promise<Credential> {
		let stored: unknown;
		try {
			stored = await untilAborted(this.#store.read(PROVIDER_ID, { signal }), signal);
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
	 * Same-slot account check: a different owner clears sticky routing, turn state and socket.
	 * A changed bearer reopens the socket in #openSocket.
	 */
	async #ensureOwner(signal: AbortSignal, prepared?: string): Promise<Credential> {
		const cred = await this.#resolve(signal);
		// Refuse a different prepared owner before adopting its state.
		if (prepared !== undefined && cred.accountId !== prepared) throw new LocalRequestError(OWNER_CHANGED_MESSAGE);
		if (this.#owner !== undefined && this.#owner !== cred.accountId) {
			this.#transport = "websocket";
			this.#turnState = undefined;
			this.#dropSocket();
		}
		this.#owner = cred.accountId;
		return cred;
	}

	#sseHeaders(cred: Credential, body: Record<string, unknown>): Record<string, string> {
		const headers = withoutTurnState(mergeHeaders(
			identityHeaders(this.#requestIdentity, { requestKind: "turn", transport: "sse", platform: localPlatform() }),
			{
				"x-codex-routing-hint": `model=${String(body.model)}`,
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
		socketId: string,
		signal: AbortSignal,
		body: Record<string, unknown>,
	): Promise<CodexSocket> {
		const digest = accessDigest(cred.access);
		const current = this.#socket;
		if (current && current.socketId === socketId && current.digest === digest && current.socket.isOpen) {
			return current.socket;
		}
		this.#dropSocket();
		const headers = withoutTurnState(mergeHeaders(
			identityHeaders(this.#requestIdentity, { requestKind: "turn", transport: "websocket", platform: localPlatform() }),
			{
				"x-codex-routing-hint": `model=${String(body.model)}`,
				Authorization: `Bearer ${cred.access}`,
				"ChatGPT-Account-ID": cred.accountId,
			},
		));
		// Connect runs under a per-attempt relay of the request signal and the thread lifetime. The relay is released as soon as
		// the upgrade settles, so a later abort of this caller can never reach the socket kept for the next request.
		const relay = linkSignals([signal, this.#lifetime.signal]);
		let socket: CodexSocket;
		try {
			socket = await (this.#deps.connect ?? connect)({
				url: CODEX_ENDPOINT,
				headers,
				signal: relay.signal,
				onResponse: (head) => this.#onHead(head),
			});
		} catch (error) {
			relay.release();
			throw error;
		}
		relay.release();
		if (signal.aborted) {
			void socket.close().catch(() => undefined);
			throw abortError();
		}
		this.#socket = { socket, socketId, digest };
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
			throw error;
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

	#onHead(head: ResponseHead): void {
		this.#captureTurnState(head.headers);
	}

	/** Raw events until the terminal. Aborts and early consumer returns retire the socket. */
	async *#events(
		source: AsyncIterable<unknown>,
		signal: AbortSignal,
		socket?: CodexSocket,
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
		// A terminal handed to the caller permits socket reuse.
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
				if (event.type === "response.metadata") this.#captureTurnState(event.headers);
				const terminal = typeof event.type === "string" && TERMINAL_TYPES.has(event.type);
				// The caller link is detached before the terminal is handed out,
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
			throw toCodexError(error, this.#clock.now());
		} finally {
			// Any exit before the terminal was accepted (early consumer return, end or failure of the source,
			// abort) can leave unread frames on the socket: it is retired and never reused.
			if (socket && !accepted) this.#retire(socket);
			detach();
			if (!reading) await iterator.return?.(undefined).catch(() => undefined);
		}
		if (signal.aborted) throw abortError();
		throw new CodexError({ kind: "stream", transport: true });
	}

}
