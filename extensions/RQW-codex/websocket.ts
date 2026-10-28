// Owned Codex WebSocket connector. Native source (codex-rs commit 83086188):
// codex-api/src/endpoint/responses_websocket.rs:576-583 (permessage-deflate enabled, DeflateConfig::default()),
// :166-170 and :746-747 (idle timeout per read), :299-385 (response.interrupt frame, discard_partial_items),
// :738-823 (acknowledgement: matching response_id, failed or unexpected acks retire the socket), :353-357 (consumer
// dropped: socket retired, no interrupt frame), :669-687 (wrapped errors), :1008-1013 (send idle);
// websocket-client/src/lib.rs:170-195 (cookies on handshake and rejected upgrades);
// model-provider-info/src/lib.rs:67-75,513-524 (connect 15s, stream idle 300s).
// Deflate provenance (Cargo.lock: tungstenite 0.27.0 git rev 4fffad30fe373adbdcffab9545e9e9bf4f2fc19f, checked out
// locally at ~/.cargo/git/checkouts/tungstenite-rs-006aed970da0a0a9/4fffad3): DeflateConfig::new() uses flate2
// Compression(6), both no_context_takeover flags false, window bits 15 (src/extensions/compression/deflate/config.rs:
// 157-168); as_offer()/as_extension() emit "permessage-deflate; client_max_window_bits" (config.rs:225-263, 569-599).
// Interrupt provenance: core/src/session/turn.rs:2743 sends Drain (Lite stream errors only; no ack check, no deadline);
// ext/guardian-v2/src/async_scorer/sampler/response.rs:63-66 is the only Cancel (1 s, guardian scorer, not ordinary).
// Built on the `ws` package (pinned 8.18.3, offer in node_modules/ws/lib/permessage-deflate.js:87-106).
import { randomUUID } from "node:crypto";
import { Agent as HttpAgent } from "node:http";
import { Agent as HttpsAgent } from "node:https";
import { connect as netConnect, isIP } from "node:net";
import type { Socket } from "node:net";
import { connect as tlsConnect } from "node:tls";
import type { TLSSocket } from "node:tls";
import WebSocket from "ws";
import { CookieJar, assertTransportOrigin, sharedCookieJar } from "./cookies.ts";
import { classifyEvent } from "./errors.ts";

// Actual WS beta (client.rs:1401-1405). The connector sends it when the caller did not set OpenAI-Beta.
export const WS_BETA_HEADER = "responses_websockets=2026-02-06";
export const WS_CONNECT_TIMEOUT_MS = 15_000;
export const WS_IDLE_TIMEOUT_MS = 300_000;
// The exact offer the native client advertises (provenance above): no context-takeover parameters, default window
// bits, so the server_max_window_bits parameter is omitted and client_max_window_bits is bare.
export const WS_PERMESSAGE_DEFLATE_OFFER = "permessage-deflate; client_max_window_bits";
const CLOSE_DEADLINE_MS = 1_000;
// Error bodies are read only for allowlisted control fields: bounded in bytes and in time (never attached).
const ERROR_BODY_LIMIT_BYTES = 16_384;
const ERROR_BODY_READ_MS = 2_000;

// Terminal response events (sse/responses.rs:414-420 and websocket error wrapper, responses_websocket.rs:669-687).
const TERMINAL_TYPES: ReadonlySet<string> = new Set(["response.completed", "response.incomplete", "response.failed", "error"]);

export type RawEvent = {
	// Exact text of the frame as received.
	readonly text: string;
	// JSON value of the frame. Control events (response.interrupt.accepted/failed, usage, errors) are included.
	readonly value: Record<string, unknown>;
};

export type ResponseHead = {
	readonly status: number;
	readonly headers: Record<string, string | string[] | undefined>;
};

export type OnResponse = (response: ResponseHead) => void;

export type SocketErrorKind =
	| "upgrade-rejected"
	| "redirect-rejected"
	| "connect-timeout"
	| "idle-timeout"
	| "interrupt-failed"
	| "interrupt-timeout"
	| "binary-frame"
	| "closed"
	| "transport"
	| "origin"
	| "proxy-rejected";

// Allowlisted control fields of an error body. The message, raw text and every other field are dropped.
export type ErrorControl = {
	readonly code?: string;
	readonly type?: string;
	readonly planType?: string;
	readonly limitWindowMinutes?: number;
	readonly resetsAt?: number;
	readonly resetsInSeconds?: number;
};

// Typed failure that keeps the upgrade (or proxy) response status and headers. Bodies are never attached; only the
// parsed allowlisted control fields travel in `control`.
export class SocketError extends Error {
	status: number | undefined;
	headers: Record<string, string | string[] | undefined>;
	kind: SocketErrorKind;
	control: ErrorControl | undefined;

	constructor(
		status: number | undefined,
		headers: Record<string, string | string[] | undefined>,
		message: string,
		kind: SocketErrorKind,
		control?: ErrorControl,
	) {
		super(message);
		this.name = "SocketError";
		this.status = status;
		this.headers = headers;
		this.kind = kind;
		this.control = control;
	}
}

// Connects TLS with certificate verification on (no insecure option exists), or wraps an already connected socket
// (a CONNECT tunnel). Resolves after the handshake. The default is node:tls; tests inject a plain-socket connector.
export type TlsConnector = (options: {
	readonly host: string;
	readonly port: number;
	readonly servername: string | undefined;
	readonly ca?: string | Buffer;
	readonly socket?: Socket;
}) => Promise<Socket>;

export type ProxyOptions = {
	// http:// or https:// CONNECT proxy. No credentials in the URL, no path, query or fragment.
	readonly url: string;
	// CONNECT headers, for example Proxy-Authorization. CR, LF and NUL are refused.
	readonly headers?: Record<string, string>;
	// Trust anchor for an https:// proxy certificate only (never the target). Verification stays on.
	readonly ca?: string | Buffer;
	// Injection seam for tests. Production code leaves it out and gets node:tls.
	readonly tls?: TlsConnector;
};

export type ConnectOptions = {
	readonly url: string;
	readonly headers: Record<string, string>;
	// Lifetime signal of the connection: abort closes the socket and ends events() with an AbortError.
	readonly signal: AbortSignal;
	readonly onResponse: OnResponse;
	readonly proxy?: ProxyOptions;
	readonly connectTimeoutMs?: number;
	readonly idleTimeoutMs?: number;
	readonly cookies?: CookieJar;
};

export type InterruptResult = {
	// true only for cancel: response.interrupt.accepted with the matching response_id was received.
	readonly acknowledged: boolean;
	// true when response.completed arrived during the wait; false when another terminal event ended it.
	readonly completed: boolean;
};

// drain = native Drain (turn.rs:2743): the frame is sent, acknowledgements are not validated, there is no deadline, and
// the wait ends at the terminal event (the idle watchdog still applies). cancel = native Cancel (guardian
// response.rs:63-66): the acknowledgement is required and the whole wait is bounded by deadlineMs; a missing or
// unexpected acknowledgement, a rejection or the deadline retires the socket.
export type InterruptMode = { readonly mode: "drain" } | { readonly mode: "cancel"; readonly deadlineMs: number };

export interface CodexSocket {
	events(): AsyncIterable<RawEvent>;
	send(object: unknown): Promise<void>;
	interrupt(responseId: string, mode: InterruptMode, signal?: AbortSignal): Promise<InterruptResult>;
	close(): Promise<void>;
	readonly isOpen: boolean;
	readonly socketIdentity: string;
}

type Item = { kind: "event"; event: RawEvent } | { kind: "error"; error: Error } | { kind: "end" };

type PendingInterrupt = {
	readonly responseId: string;
	readonly mode: "drain" | "cancel";
	phase: "ack" | "drain";
	completedBeforeAck: boolean;
	timer: ReturnType<typeof setTimeout> | undefined;
	resolve: (result: InterruptResult) => void;
	reject: (error: Error) => void;
};

type WsLike = {
	readyState: number;
	extensions: string;
	send(data: string, callback: (error?: Error) => void): void;
	close(code?: number): void;
	terminate(): void;
	on(event: string, listener: (...args: any[]) => void): void;
	once(event: string, listener: (...args: any[]) => void): void;
};

function abortError(): Error {
	return new DOMException("websocket aborted by caller", "AbortError");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
	const lower = name.toLowerCase();
	return Object.keys(headers).some((key) => key.toLowerCase() === lower);
}

function transportError(error: unknown): SocketError {
	const message = error instanceof Error ? error.message : String(error);
	return new SocketError(undefined, {}, `websocket transport error: ${message}`, "transport");
}

const CONTROL_TOKEN = /^[A-Za-z0-9_.:-]{1,64}$/;

function controlToken(value: unknown): string | undefined {
	return typeof value === "string" && CONTROL_TOKEN.test(value) ? value : undefined;
}

function controlSeconds(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

// Plan names a usage-limit body may carry (native plan_type values). Any other string is dropped.
const PLAN_TYPES: ReadonlySet<string> = new Set(["free", "go", "plus", "pro", "prolite", "team", "business", "enterprise", "edu", "unknown"]);

function controlPlan(value: unknown): string | undefined {
	return typeof value === "string" && PLAN_TYPES.has(value) ? value : undefined;
}

function controlWindowMinutes(value: unknown): number | undefined {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 65535 ? value : undefined;
}

// Parses the allowlisted control fields of an error body (OpenAI error envelope or a bare object). Anything else,
// including message text, is dropped. Invalid JSON yields no control fields.
export function parseErrorControl(text: string): ErrorControl | undefined {
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		return undefined;
	}
	if (!isRecord(value)) return undefined;
	const source = isRecord(value.error) ? value.error : value;
	const control: {
		code?: string;
		type?: string;
		planType?: string;
		limitWindowMinutes?: number;
		resetsAt?: number;
		resetsInSeconds?: number;
	} = {};
	const code = controlToken(source.code);
	const type = controlToken(source.type);
	const planType = controlPlan(source.plan_type);
	const limitWindowMinutes = controlWindowMinutes(source.limit_window_minutes);
	const resetsAt = controlSeconds(source.resets_at);
	const resetsInSeconds = controlSeconds(source.resets_in_seconds);
	if (code !== undefined) control.code = code;
	if (type !== undefined) control.type = type;
	if (planType !== undefined) control.planType = planType;
	if (limitWindowMinutes !== undefined) control.limitWindowMinutes = limitWindowMinutes;
	if (resetsAt !== undefined) control.resetsAt = resetsAt;
	if (resetsInSeconds !== undefined) control.resetsInSeconds = resetsInSeconds;
	return Object.keys(control).length > 0 ? control : undefined;
}

// Reads a rejected response body up to a byte limit and a time limit, then parses only its control fields. A body over
// the limit, a stream error or a timeout yields no control fields. The body is never returned or attached.
export async function readErrorControl(
	body: AsyncIterable<unknown> | null | undefined,
	cancel?: () => void,
): Promise<ErrorControl | undefined> {
	if (!body) return undefined;
	const chunks: Buffer[] = [];
	let total = 0;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const read = (async (): Promise<ErrorControl | undefined> => {
		for await (const chunk of body) {
			const buffer = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : Buffer.from(chunk as Uint8Array);
			total += buffer.byteLength;
			if (total > ERROR_BODY_LIMIT_BYTES) return undefined;
			chunks.push(buffer);
		}
		return parseErrorControl(Buffer.concat(chunks).toString("utf8"));
	})();
	const deadline = new Promise<undefined>((resolve) => {
		timer = setTimeout(() => {
			cancel?.();
			resolve(undefined);
		}, ERROR_BODY_READ_MS);
	});
	try {
		return await Promise.race([read.catch(() => undefined), deadline]);
	} finally {
		if (timer !== undefined) clearTimeout(timer);
	}
}

class Connection implements CodexSocket {
	private readonly ws: WsLike;
	private readonly idleTimeoutMs: number;
	private readonly jar: CookieJar;
	private readonly identity: string;
	private phase: "connecting" | "open" | "closed" = "connecting";
	private userClosed = false;
	private armed = false;
	private idleTimer: ReturnType<typeof setTimeout> | undefined;
	private pending: PendingInterrupt | undefined;
	private consumed = false;
	private readonly items: Item[] = [];
	private wake: (() => void) | undefined;
	private openWaiter: { resolve: () => void; reject: (error: Error) => void } | undefined;
	// Set while a rejected upgrade's body is being read; the handshake close or error then waits for that rejection.
	private rejectionPending = false;

	constructor(ws: WsLike, idleTimeoutMs: number, jar: CookieJar, identity: string) {
		this.ws = ws;
		this.idleTimeoutMs = idleTimeoutMs;
		this.jar = jar;
		this.identity = identity;
	}

	get isOpen(): boolean {
		return this.phase === "open" && this.ws.readyState === WebSocket.OPEN;
	}

	get socketIdentity(): string {
		return this.identity;
	}

	// Installed once, before the handshake starts. Handshake-phase failures reject the connect promise instead.
	attach(onResponse: OnResponse, url: URL): void {
		const ws = this.ws;
		// Bun does not implement these ws handshake events.
		if (!process.versions.bun) {
			ws.on("upgrade", (response: { statusCode: number; headers: Record<string, string | string[] | undefined> }) => {
				this.jar.ingest(url, response.headers["set-cookie"] as string[] | undefined);
				onResponse({ status: response.statusCode, headers: response.headers });
			});
			ws.on(
				"unexpected-response",
				(_request: unknown, response: { statusCode: number; headers: Record<string, string | string[] | undefined>; destroy?(): void }) => {
					const status = response.statusCode;
					const headers = response.headers;
					// Cookies come from the actual rejected upgrade's headers (websocket-client/src/lib.rs:170-195).
					this.jar.ingest(url, headers["set-cookie"] as string[] | undefined);
					onResponse({ status, headers });
					const kind: SocketErrorKind = status >= 300 && status < 400 ? "redirect-rejected" : "upgrade-rejected";
					const message =
						kind === "redirect-rejected"
							? `websocket redirect rejected with HTTP ${status}`
							: `websocket upgrade rejected with HTTP ${status}`;
					this.rejectionPending = true;
					void readErrorControl(response as unknown as AsyncIterable<unknown>, () => response.destroy?.()).then((control) =>
						this.rejectOpen(new SocketError(status, headers, message, kind, control)),
					);
				},
			);
		}
		ws.on("open", () => {
			this.phase = "open";
			const waiter = this.openWaiter;
			this.openWaiter = undefined;
			waiter?.resolve();
		});
		ws.on("message", (data: Buffer | string, isBinary: boolean) => this.onMessage(data, isBinary));
		ws.on("error", (error: Error) => {
			if (this.phase === "connecting") {
				if (!this.rejectionPending) {
					const failure = transportError(error);
					if (error.message === "Opening handshake has timed out") failure.kind = "connect-timeout";
					this.rejectOpen(failure);
				}
				return;
			}
			this.fail(transportError(error));
		});
		ws.on("close", () => this.onClose());
	}

	waitOpen(signal: AbortSignal, connectTimeoutMs: number): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.rejectOpen(new SocketError(undefined, {}, "websocket connect timed out", "connect-timeout"));
			}, connectTimeoutMs);
			const onAbort = () => this.rejectOpen(abortError());
			if (signal.aborted) {
				onAbort();
				return;
			}
			signal.addEventListener("abort", onAbort, { once: true });
			this.openWaiter = {
				resolve: () => {
					clearTimeout(timer);
					signal.removeEventListener("abort", onAbort);
					resolve();
				},
				reject: (error: Error) => {
					clearTimeout(timer);
					signal.removeEventListener("abort", onAbort);
					reject(error);
				},
			};
		});
	}

	private rejectOpen(error: Error): void {
		const waiter = this.openWaiter;
		this.openWaiter = undefined;
		this.phase = "closed";
		this.stopIdle();
		this.destroySocket();
		if (waiter) waiter.reject(error);
	}

	private destroySocket(): void {
		try {
			this.ws.terminate();
		} catch {
			// Already gone.
		}
	}

	private push(item: Item): void {
		this.items.push(item);
		const wake = this.wake;
		this.wake = undefined;
		wake?.();
	}

	private stopIdle(): void {
		this.armed = false;
		if (this.idleTimer !== undefined) clearTimeout(this.idleTimer);
		this.idleTimer = undefined;
	}

	private armIdle(): void {
		if (this.idleTimer !== undefined) clearTimeout(this.idleTimer);
		this.idleTimer = setTimeout(() => {
			this.idleTimer = undefined;
			this.fail(new SocketError(undefined, {}, "idle timeout waiting for websocket", "idle-timeout"));
		}, this.idleTimeoutMs);
	}

	private onMessage(data: Buffer | string, isBinary: boolean): void {
		if (this.phase !== "open") return;
		if (isBinary) {
			this.fail(new SocketError(undefined, {}, "unexpected binary websocket event", "binary-frame"));
			return;
		}
		const text = typeof data === "string" ? data : data.toString("utf8");
		if (this.armed) this.armIdle();
		let value: unknown;
		try {
			value = JSON.parse(text);
		} catch {
			// Malformed frames are skipped, as native does (responses_websocket.rs parse failure -> continue).
			return;
		}
		if (!isRecord(value)) return;
		const type = typeof value.type === "string" ? value.type : "";
		// Native ignores unclassified wrappers without ending the read or interrupt drain.
		if (type === "error" && classifyEvent(value) === null) return;
		if (TERMINAL_TYPES.has(type)) this.stopIdle();
		this.push({ kind: "event", event: { text, value } });
		this.observeInterrupt(type, value);
	}

	private observeInterrupt(type: string, value: Record<string, unknown>): void {
		const pending = this.pending;
		if (!pending) return;
		const acknowledgement = type === "response.interrupt.accepted" || type === "response.interrupt.failed";
		if (pending.mode === "drain") {
			// Native Drain: acknowledgements are not validated; the wait ends at the terminal event.
			if (type === "response.completed") this.finishInterrupt(true);
			else if (TERMINAL_TYPES.has(type)) this.finishInterrupt(false);
			return;
		}
		if (pending.phase === "ack") {
			if (acknowledgement) {
				// responses_websocket.rs:800-823: a malformed, wrong or rejected acknowledgement retires the socket.
				if (typeof value.response_id !== "string") {
					this.fail(new SocketError(undefined, {}, "invalid interruption acknowledgement", "interrupt-failed"));
					return;
				}
				if (value.response_id !== pending.responseId) {
					this.fail(new SocketError(undefined, {}, "unexpected interruption acknowledgement", "interrupt-failed"));
					return;
				}
				if (type === "response.interrupt.failed") {
					this.fail(new SocketError(undefined, {}, "response interruption was rejected", "interrupt-failed"));
					return;
				}
				pending.phase = "drain";
				if (pending.completedBeforeAck) this.finishInterrupt(true);
				return;
			}
			if (type === "response.completed") pending.completedBeforeAck = true;
			return;
		}
		// A second or late acknowledgement is unexpected (responses_websocket.rs:811-812).
		if (acknowledgement) {
			this.fail(new SocketError(undefined, {}, "unexpected interruption acknowledgement", "interrupt-failed"));
			return;
		}
		if (type === "response.completed") this.finishInterrupt(true);
		else if (TERMINAL_TYPES.has(type)) this.finishInterrupt(false);
	}

	private finishInterrupt(completed: boolean): void {
		const pending = this.pending;
		if (!pending) return;
		this.pending = undefined;
		if (pending.timer !== undefined) clearTimeout(pending.timer);
		pending.resolve({ acknowledged: pending.mode === "cancel", completed });
	}

	private onClose(): void {
		if (this.phase === "connecting") {
			if (!this.rejectionPending) this.rejectOpen(new SocketError(undefined, {}, "websocket closed during handshake", "closed"));
			return;
		}
		const wasArmed = this.armed;
		this.phase = "closed";
		this.stopIdle();
		this.failPending(new SocketError(undefined, {}, "websocket closed during interruption", "closed"));
		if (this.userClosed || !wasArmed) {
			this.push({ kind: "end" });
			return;
		}
		this.push({ kind: "error", error: new SocketError(undefined, {}, "websocket closed by server before response.completed", "closed") });
	}

	private failPending(error: Error): void {
		const pending = this.pending;
		if (!pending) return;
		this.pending = undefined;
		if (pending.timer !== undefined) clearTimeout(pending.timer);
		pending.reject(error);
	}

	// Retires the socket: the failure is delivered to events() and to any pending interrupt.
	private fail(error: Error): void {
		if (this.phase === "closed") return;
		this.phase = "closed";
		this.stopIdle();
		this.failPending(error);
		this.push({ kind: "error", error });
		this.destroySocket();
	}

	// Caller abort after open: retires the socket; events() throws AbortError.
	abortByCaller(): void {
		this.fail(abortError());
	}

	private rawSend(text: string): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			this.ws.send(text, (error?: Error) => (error ? reject(transportError(error)) : resolve()));
		});
	}

	async send(object: unknown): Promise<void> {
		if (!this.isOpen) throw new SocketError(undefined, {}, "websocket is not open", "closed");
		const text = JSON.stringify(object);
		this.armed = true;
		this.armIdle();
		try {
			await this.rawSend(text);
		} catch (error) {
			this.fail(error instanceof Error ? error : transportError(error));
			throw error;
		}
	}

	// Sends response.interrupt (discard_partial_items) for an open response. The mode is required: there is no default
	// deadline. Without a mode nothing is sent and the socket stays as it is (the caller then closes it).
	async interrupt(responseId: string, mode: InterruptMode, signal?: AbortSignal): Promise<InterruptResult> {
		if (!this.isOpen) throw new SocketError(undefined, {}, "websocket is not open", "closed");
		if (this.pending) throw new SocketError(undefined, {}, "an interruption is already pending", "interrupt-failed");
		if (mode?.mode !== "drain" && mode?.mode !== "cancel") {
			throw new SocketError(undefined, {}, "interrupt needs an explicit mode: drain, or cancel with a deadline", "interrupt-failed");
		}
		const deadlineMs = mode.mode === "cancel" ? mode.deadlineMs : undefined;
		if (deadlineMs !== undefined && !(Number.isFinite(deadlineMs) && deadlineMs > 0)) {
			throw new SocketError(undefined, {}, "cancel needs a positive deadlineMs", "interrupt-failed");
		}
		if (signal?.aborted) throw abortError();
		return new Promise<InterruptResult>((resolve, reject) => {
			const pending: PendingInterrupt = {
				responseId,
				mode: mode.mode,
				phase: "ack",
				completedBeforeAck: false,
				timer: undefined,
				resolve,
				reject,
			};
			this.pending = pending;
			if (deadlineMs !== undefined) {
				pending.timer = setTimeout(() => {
					this.fail(new SocketError(undefined, {}, "timed out draining interrupted response", "interrupt-timeout"));
				}, deadlineMs);
			}
			signal?.addEventListener("abort", () => this.fail(abortError()), { once: true });
			// The create frame must already be sent; the interrupt does not re-arm the response idle watchdog.
			this.rawSend(JSON.stringify({ type: "response.interrupt", response_id: responseId, mode: "discard_partial_items" })).catch(
				(error: unknown) => this.fail(error instanceof Error ? error : transportError(error)),
			);
		});
	}

	// One active consumer at a time: a second events() while an iterator is active is refused. The lock is released when
	// that iterator finishes, errors, or is stopped by its consumer (return or break), so a healthy socket reused for the
	// next request can be consumed again. Stopping the consumer never closes the socket.
	events(): AsyncIterable<RawEvent> {
		if (this.consumed) throw new SocketError(undefined, {}, "events() may be consumed once", "closed");
		this.consumed = true;
		return this.iterate();
	}

	private async *iterate(): AsyncGenerator<RawEvent> {
		try {
			for (;;) {
				while (this.items.length === 0) {
					await new Promise<void>((resolve) => {
						this.wake = resolve;
					});
				}
				const item = this.items.shift() as Item;
				if (item.kind === "event") yield item.event;
				else if (item.kind === "error") throw item.error;
				else return;
			}
		} finally {
			this.consumed = false;
		}
	}

	async close(): Promise<void> {
		if (this.phase === "closed") {
			this.destroySocket();
			return;
		}
		this.userClosed = true;
		this.stopIdle();
		if (this.phase === "open") {
			await new Promise<void>((resolve) => {
				const timer = setTimeout(() => {
					this.destroySocket();
					resolve();
				}, CLOSE_DEADLINE_MS);
				this.ws.once("close", () => {
					clearTimeout(timer);
					resolve();
				});
				this.ws.close(1000);
			});
		} else {
			this.destroySocket();
		}
		this.phase = "closed";
	}
}

const PROXY_OPTION_KEYS: ReadonlySet<string> = new Set(["url", "headers", "ca", "tls"]);
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

function proxyRejected(message: string): SocketError {
	return new SocketError(undefined, {}, message, "proxy-rejected");
}

function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

// Validates the caller's proxy options before any socket is opened. Unknown keys (an insecure flag, for example) are
// refused, never ignored. No environment variable is read and no certificate check is relaxed.
function checkProxy(proxy: ProxyOptions): URL {
	for (const key of Object.keys(proxy)) {
		if (!PROXY_OPTION_KEYS.has(key)) throw proxyRejected(`proxy option "${key}" is not supported`);
	}
	let url: URL;
	try {
		url = new URL(proxy.url);
	} catch {
		throw proxyRejected("proxy URL is not a valid URL");
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw proxyRejected(`proxy protocol ${url.protocol} is not supported; use http:// or https://`);
	}
	if (url.username !== "" || url.password !== "") {
		throw proxyRejected("proxy URL credentials are not supported; send Proxy-Authorization in headers");
	}
	if ((url.pathname !== "/" && url.pathname !== "") || url.search !== "" || url.hash !== "") {
		throw proxyRejected("proxy URL must not contain a path, query or fragment");
	}
	if (proxy.ca !== undefined && url.protocol !== "https:") throw proxyRejected("proxy ca applies only to https:// proxies");
	for (const [name, value] of Object.entries(proxy.headers ?? {})) {
		if (!HEADER_NAME.test(name) || /[\r\n\0]/.test(value)) throw proxyRejected(`proxy header ${name} is not a valid header`);
	}
	return url;
}

function bareHost(host: string): string {
	return host.replace(/^\[|\]$/g, "");
}

function tlsServername(host: string): string | undefined {
	const bare = bareHost(host);
	return isIP(bare) === 0 ? bare : undefined;
}

// node:tls with certificate verification on. rejectUnauthorized is never set to false anywhere in this module.
const defaultTls: TlsConnector = (options) =>
	new Promise<Socket>((resolve, reject) => {
		const onError = (error: Error) => reject(error);
		const socket: TLSSocket = options.socket
			? tlsConnect({ socket: options.socket, servername: options.servername, ca: options.ca })
			: tlsConnect({ host: bareHost(options.host), port: options.port, servername: options.servername, ca: options.ca });
		socket.once("error", onError);
		socket.once("secureConnect", () => {
			socket.removeListener("error", onError);
			resolve(socket);
		});
	});

// Explicit CONNECT tunnel through an http:// or https:// proxy. The agent's callback form hands ws a socket only after
// the proxy answers 200. An https:// proxy is reached over verified TLS; an https:// target is wrapped in TLS inside the
// tunnel with no proxy trust anchor.
function openTunnel(
	proxy: URL,
	options: { readonly headers: Record<string, string>; readonly ca?: string | Buffer; readonly tls: TlsConnector },
	host: string,
	port: number,
	secure: boolean,
	timeoutMs: number,
): Promise<Socket> {
	return new Promise<Socket>((resolve, reject) => {
		let settled = false;
		let proxySocket: Socket | undefined;
		const fail = (error: Error) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			proxySocket?.destroy();
			reject(error);
		};
		const timer = setTimeout(() => fail(new SocketError(undefined, {}, "proxy connect timed out", "connect-timeout")), timeoutMs);
		const target = host.includes(":") ? `[${host}]` : host;
		const extra = Object.entries(options.headers)
			.map(([name, value]) => `${name}: ${value}\r\n`)
			.join("");
		const request = `CONNECT ${target}:${port} HTTP/1.1\r\nHost: ${target}:${port}\r\n${extra}\r\n`;
		const attach = (socket: Socket) => {
			proxySocket = socket;
			let buffered = Buffer.alloc(0);
			const onData = (chunk: Buffer) => {
				buffered = Buffer.concat([buffered, chunk]);
				const end = buffered.indexOf("\r\n\r\n");
				if (end < 0) return;
				socket.removeListener("data", onData);
				const status = Number(buffered.subarray(0, end).toString("latin1").split(" ")[1]);
				if (status !== 200 || buffered.length !== end + 4) {
					fail(new SocketError(status, {}, `proxy CONNECT rejected with HTTP ${status}`, "transport"));
					return;
				}
				clearTimeout(timer);
				if (!secure) {
					settled = true;
					resolve(socket);
					return;
				}
				options
					.tls({ host, port, servername: tlsServername(host), socket })
					.then(
						(tunnel) => {
							settled = true;
							resolve(tunnel);
						},
						(error: unknown) => fail(new SocketError(undefined, {}, `target TLS failed: ${errorText(error)}`, "transport")),
					);
			};
			socket.on("data", onData);
			socket.on("error", (error: Error) => fail(new SocketError(undefined, {}, `proxy connection failed: ${error.message}`, "transport")));
			const send = () => socket.write(request);
			if (socket.connecting) socket.once("connect", send);
			else send();
		};
		if (proxy.protocol === "https:") {
			options
				.tls({ host: bareHost(proxy.hostname), port: Number(proxy.port || 443), servername: tlsServername(proxy.hostname), ca: options.ca })
				.then(attach, (error: unknown) => fail(new SocketError(undefined, {}, `proxy TLS failed: ${errorText(error)}`, "transport")));
		} else {
			attach(netConnect({ host: bareHost(proxy.hostname), port: Number(proxy.port || 80) }));
		}
	});
}

function proxyAgent(proxy: ProxyOptions, target: URL, timeoutMs: number): HttpAgent {
	const proxyUrl = checkProxy(proxy);
	const secure = target.protocol === "wss:" || target.protocol === "https:";
	const tunnelOptions = { headers: proxy.headers ?? {}, ca: proxy.ca, tls: proxy.tls ?? defaultTls };
	const agent = secure ? new HttpsAgent({ keepAlive: false }) : new HttpAgent({ keepAlive: false });
	const create = (options: { host?: string; port?: string | number }, callback: (error: Error | null, socket?: Socket) => void) => {
		const host = options.host ?? target.hostname;
		const port = Number(options.port ?? target.port ?? (secure ? 443 : 80));
		openTunnel(proxyUrl, tunnelOptions, host, port, secure, timeoutMs).then(
			(socket) => callback(null, socket),
			(error: Error) => callback(error),
		);
		return undefined;
	};
	(agent as unknown as { createConnection: typeof create }).createConnection = create;
	return agent;
}

// Opens one owned connection. Resolves after the 101 upgrade; rejects with SocketError (status, headers and allowlisted
// control fields of the rejected upgrade preserved) or AbortError. The returned socket is never shared with another request.
export async function connect(options: ConnectOptions, SocketConstructor: new (url: string, options: Record<string, unknown>) => WsLike = WebSocket): Promise<CodexSocket> {
	const url = new URL(options.url);
	assertTransportOrigin(url);
	if (url.protocol !== "wss:" && url.protocol !== "ws:" && url.protocol !== "https:" && url.protocol !== "http:") {
		throw new SocketError(undefined, {}, "websocket URL must use wss", "origin");
	}
	if (options.signal.aborted) throw abortError();
	const jar = options.cookies ?? sharedCookieJar;
	const headers: Record<string, string> = { ...options.headers };
	if (!hasHeader(headers, "openai-beta")) headers["OpenAI-Beta"] = WS_BETA_HEADER;
	if (!hasHeader(headers, "cookie")) {
		const cookie = jar.header(url);
		if (cookie) headers.Cookie = cookie;
	}
	const connectTimeoutMs = options.connectTimeoutMs ?? WS_CONNECT_TIMEOUT_MS;
	const idleTimeoutMs = options.idleTimeoutMs ?? WS_IDLE_TIMEOUT_MS;
	const wsOptions: Record<string, unknown> = {
		headers,
		// Native offer (WS_PERMESSAGE_DEFLATE_OFFER): both no_context_takeover flags false, server window bits at the
		// default 15 (not sent), client_max_window_bits bare (ws default). threshold 0 compresses every message: the
		// native compressor has no size threshold (tungstenite src/extensions/compression/mod.rs:40-50).
		perMessageDeflate: { clientNoContextTakeover: false, serverNoContextTakeover: false, threshold: 0 },
		handshakeTimeout: connectTimeoutMs,
	};
	if (options.proxy) wsOptions.agent = proxyAgent(options.proxy, url, connectTimeoutMs);
	let ws: WsLike;
	try {
		ws = new SocketConstructor(url.href, wsOptions);
	} catch (error) {
		throw transportError(error);
	}
	const connection = new Connection(ws, idleTimeoutMs, jar, randomUUID());
	connection.attach(options.onResponse, url);
	try {
		await connection.waitOpen(options.signal, connectTimeoutMs);
	} catch (error) {
		connection.close().catch(() => undefined);
		throw error;
	}
	// Arm the caller-abort lifetime only after open; later aborts retire the socket and end events().
	options.signal.addEventListener("abort", () => connection.abortByCaller(), { once: true });
	return connection;
}
