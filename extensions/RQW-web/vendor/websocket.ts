// Source: extensions/RQW-codex/websocket.ts @ a85b810e924010f35387045fc0cbbd9a1e7173cc
// Narrowed extraction: raw events/send/close, socket retirement, verified TLS, origin guards and safe errors.
// Native permessage-deflate offer: no context takeover flags, window bits 15, compression level 6.
// Built on the pinned ws package; connect timeout 15s and response idle timeout 300s.
import WebSocket from "ws";
import { CookieJar, assertTransportOrigin, sharedCookieJar } from "./cookies.ts";

// Actual WS beta (client.rs:1401-1405). The connector sends it when the caller did not set OpenAI-Beta.
const WS_BETA_HEADER = "responses_websockets=2026-02-06";
const WS_CONNECT_TIMEOUT_MS = 15_000;
const WS_IDLE_TIMEOUT_MS = 300_000;
const CLOSE_DEADLINE_MS = 1_000;
// Error bodies are read only for allowlisted control fields: bounded in bytes and in time (never attached).
const ERROR_BODY_LIMIT_BYTES = 16_384;
const ERROR_BODY_READ_MS = 2_000;

// Terminal response events (sse/responses.rs:414-420 and websocket error wrapper, responses_websocket.rs:669-687).
const TERMINAL_TYPES: ReadonlySet<string> = new Set(["response.completed", "response.incomplete", "response.failed", "error"]);

export type RawEvent = {
	// Exact text of the frame as received.
	readonly text: string;
	// Unmodified JSON value, including control and error events.
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
	| "binary-frame"
	| "closed"
	| "transport"
	| "origin";

// Allowlisted control fields of an error body. The message, raw text and every other field are dropped.
export type ErrorControl = {
	readonly code?: string;
	readonly type?: string;
	readonly planType?: string;
	readonly limitWindowMinutes?: number;
	readonly resetsAt?: number;
	readonly resetsInSeconds?: number;
};

// Typed failure that keeps the upgrade response status and headers. Bodies are never attached; only the
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

export type ConnectOptions = {
	readonly url: string;
	readonly headers: Record<string, string>;
	// Lifetime signal of the connection: abort closes the socket and ends events() with an AbortError.
	readonly signal: AbortSignal;
	readonly onResponse: OnResponse;
	readonly connectTimeoutMs?: number;
	readonly idleTimeoutMs?: number;
	readonly cookies?: CookieJar;
};

export interface CodexSocket {
	events(): AsyncIterable<RawEvent>;
	send(object: unknown): Promise<void>;
	close(): Promise<void>;
	readonly isOpen: boolean;
}

type Item = { kind: "event"; event: RawEvent } | { kind: "error"; error: Error } | { kind: "end" };

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
function parseErrorControl(text: string): ErrorControl | undefined {
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
	private phase: "connecting" | "open" | "closed" = "connecting";
	private userClosed = false;
	private armed = false;
	private idleTimer: ReturnType<typeof setTimeout> | undefined;
	private consumed = false;
	private readonly items: Item[] = [];
	private wake: (() => void) | undefined;
	private openWaiter: { resolve: () => void; reject: (error: Error) => void } | undefined;
	// Set while a rejected upgrade's body is being read; the handshake close or error then waits for that rejection.
	private rejectionPending = false;

	constructor(ws: WsLike, idleTimeoutMs: number, jar: CookieJar) {
		this.ws = ws;
		this.idleTimeoutMs = idleTimeoutMs;
		this.jar = jar;
	}

	get isOpen(): boolean {
		return this.phase === "open" && this.ws.readyState === WebSocket.OPEN;
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
				if (!this.rejectionPending) this.rejectOpen(transportError(error));
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
		if (TERMINAL_TYPES.has(type)) this.stopIdle();
		this.push({ kind: "event", event: { text, value } });
	}

	private onClose(): void {
		if (this.phase === "connecting") {
			if (!this.rejectionPending) this.rejectOpen(new SocketError(undefined, {}, "websocket closed during handshake", "closed"));
			return;
		}
		const wasArmed = this.armed;
		this.phase = "closed";
		this.stopIdle();
		if (this.userClosed || !wasArmed) {
			this.push({ kind: "end" });
			return;
		}
		this.push({ kind: "error", error: new SocketError(undefined, {}, "websocket closed by server before response.completed", "closed") });
	}

	// Retires the socket and delivers the failure to events().
	private fail(error: Error): void {
		if (this.phase === "closed") return;
		this.phase = "closed";
		this.stopIdle();
		this.push({ kind: "error", error });
		this.destroySocket();
	}

	// Caller abort after open: retires the socket; events() throws AbortError.
	abortByCaller(): void {
		this.fail(abortError());
	}

	async send(object: unknown): Promise<void> {
		if (!this.isOpen) throw new SocketError(undefined, {}, "websocket is not open", "closed");
		const text = JSON.stringify(object);
		this.armed = true;
		this.armIdle();
		try {
			await new Promise<void>((resolve, reject) => {
				this.ws.send(text, (error?: Error) => (error ? reject(transportError(error)) : resolve()));
			});
		} catch (error) {
			this.fail(error instanceof Error ? error : transportError(error));
			throw error;
		}
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
		// Native offer: both no_context_takeover flags false, server window bits at the
		// default 15 (not sent), client_max_window_bits bare (ws default). threshold 0 compresses every message: the
		// native compressor has no size threshold (tungstenite src/extensions/compression/mod.rs:40-50).
		perMessageDeflate: { clientNoContextTakeover: false, serverNoContextTakeover: false, threshold: 0 },
		handshakeTimeout: connectTimeoutMs,
	};
	let ws: WsLike;
	try {
		ws = new SocketConstructor(url.href, wsOptions);
	} catch (error) {
		throw transportError(error);
	}
	const connection = new Connection(ws, idleTimeoutMs, jar);
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
