// Source: extensions/RQW-codex/sse.ts @ a85b810e924010f35387045fc0cbbd9a1e7173cc
// Narrowed extraction: one raw SSE POST, response-head callback, framing, cookies and event idle timeout.
// Native source (read-only evidence, codex-rs commit 83086188):
// codex-api/src/sse/responses.rs:547-585 (per-event idle timeout, no parser timer, error on closed stream before
// response.completed), :414-420 (failed/completed/incomplete terminals), :541-600 (malformed JSON skipped);
// model-provider-info/src/lib.rs:67-75,513-524 (stream idle 300s, default); codex-client/src/provider.rs:79-88 (no
// total or header deadline on HTTP model requests). Error bodies are read only for allowlisted control fields (bounded
// in bytes and time) and never attached.
import { CookieJar, assertTransportOrigin, sharedCookieJar } from "./cookies.ts";
import { readErrorControl } from "./websocket.ts";
import type { ErrorControl, OnResponse, RawEvent } from "./websocket.ts";

const SSE_IDLE_TIMEOUT_MS = 300_000;

const TERMINAL_TYPES: ReadonlySet<string> = new Set(["response.completed", "response.incomplete", "response.failed", "error"]);

export type SseErrorKind = "status" | "redirect" | "content-type" | "eof" | "idle";

// Headers of the failed response are kept; its body is not. `control` holds only the allowlisted parsed fields.
export class SseError extends Error {
	status: number | undefined;
	headers: Record<string, string | string[] | undefined>;
	kind: SseErrorKind;
	control: ErrorControl | undefined;

	constructor(
		status: number | undefined,
		headers: Record<string, string | string[] | undefined>,
		message: string,
		kind: SseErrorKind,
		control?: ErrorControl,
	) {
		super(message);
		this.name = "SseError";
		this.status = status;
		this.headers = headers;
		this.kind = kind;
		this.control = control;
	}
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export type PostEventsOptions = {
	readonly url: string;
	readonly headers: Record<string, string>;
	readonly body: Uint8Array;
	// Caller fetch, forwarded with (url, init) exactly as the global fetch would receive them.
	readonly fetch?: FetchLike;
	readonly signal: AbortSignal;
	readonly onResponse: OnResponse;
	readonly idleTimeoutMs?: number;
	readonly cookies?: CookieJar;
};

// Line-based SSE framing (fields data/comments; CR, LF and CRLF terminators). Only data payloads are kept.
class SseParser {
	private buffer = "";
	private data: string[] = [];
	private ready: string[] = [];

	push(chunk: string): void {
		this.buffer += chunk;
		for (;;) {
			const at = this.buffer.search(/[\r\n]/);
			if (at < 0) return;
			// A trailing CR may be the first half of CRLF split across chunks; wait for the next byte.
			if (this.buffer[at] === "\r" && at === this.buffer.length - 1) return;
			const length = this.buffer[at] === "\r" && this.buffer[at + 1] === "\n" ? 2 : 1;
			const line = this.buffer.slice(0, at);
			this.buffer = this.buffer.slice(at + length);
			this.line(line);
		}
	}

	private line(line: string): void {
		if (line === "") {
			if (this.data.length > 0) {
				this.ready.push(this.data.join("\n"));
				this.data = [];
			}
			return;
		}
		if (line.startsWith(":")) return;
		const colon = line.indexOf(":");
		const field = colon < 0 ? line : line.slice(0, colon);
		let value = colon < 0 ? "" : line.slice(colon + 1);
		if (value.startsWith(" ")) value = value.slice(1);
		if (field === "data") this.data.push(value);
	}

	take(): string | undefined {
		return this.ready.shift();
	}
}

function responseHeaders(response: Response): Record<string, string | string[] | undefined> {
	const headers: Record<string, string | string[] | undefined> = {};
	response.headers.forEach((value, name) => {
		if (name !== "set-cookie") headers[name] = value;
	});
	const cookies = response.headers.getSetCookie();
	if (cookies.length > 0) headers["set-cookie"] = cookies;
	return headers;
}

// Reads only the allowlisted control fields of a failed response body, bounded in bytes and time, then releases it.
async function failureControl(response: Response): Promise<ErrorControl | undefined> {
	const body = response.body as unknown as AsyncIterable<unknown> | null;
	return readErrorControl(body, () => {
		response.body?.cancel().catch(() => undefined);
	});
}

// Streams the events of one POST. Each complete event must arrive within idleTimeoutMs of the previous one; partial
// bytes do not reset the watchdog. Resolves after a terminal event (completed, incomplete, failed, error) or throws.
export async function* postEvents(options: PostEventsOptions): AsyncGenerator<RawEvent, void, undefined> {
	const url = new URL(options.url);
	assertTransportOrigin(url);
	const jar = options.cookies ?? sharedCookieJar;
	const idleTimeoutMs = options.idleTimeoutMs ?? SSE_IDLE_TIMEOUT_MS;
	const headers = new Headers(options.headers);
	if (!headers.has("accept")) headers.set("accept", "text/event-stream");
	if (!headers.has("content-type")) headers.set("content-type", "application/json");
	const cookie = jar.header(url);
	if (cookie && !headers.has("cookie")) headers.set("cookie", cookie);
	const init: RequestInit = {
		method: "POST",
		headers,
		body: options.body as BodyInit,
		redirect: "manual",
		signal: options.signal,
	};
	const doFetch: FetchLike = options.fetch ?? ((input, requestInit) => globalThis.fetch(input, requestInit));
	const response = await doFetch(url.href, init);
	const head = { status: response.status, headers: responseHeaders(response) };
	options.onResponse(head);
	jar.ingest(url, head.headers["set-cookie"] as string[] | undefined);
	if (response.status >= 300 && response.status < 400) {
		const control = await failureControl(response);
		throw new SseError(response.status, head.headers, `redirect rejected with HTTP ${response.status}`, "redirect", control);
	}
	if (!response.ok) {
		const control = await failureControl(response);
		throw new SseError(response.status, head.headers, `request failed with HTTP ${response.status}`, "status", control);
	}
	const contentType = response.headers.get("content-type") ?? "";
	if (!contentType.toLowerCase().startsWith("text/event-stream")) {
		const control = await failureControl(response);
		throw new SseError(response.status, head.headers, "response is not text/event-stream", "content-type", control);
	}
	if (!response.body) {
		throw new SseError(response.status, head.headers, "stream closed before response.completed", "eof");
	}

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	const parser = new SseParser();
	let timer: ReturnType<typeof setTimeout> | undefined;
	let watch: Promise<never> = Promise.resolve() as Promise<never>;
	const startWatch = (): void => {
		if (timer !== undefined) clearTimeout(timer);
		watch = new Promise<never>((_, reject) => {
			timer = setTimeout(() => {
				reject(new SseError(undefined, {}, "idle timeout waiting for SSE event", "idle"));
			}, idleTimeoutMs);
		});
		watch.catch(() => undefined);
	};
	const stopWatch = (): void => {
		if (timer !== undefined) clearTimeout(timer);
		timer = undefined;
	};

	try {
		startWatch();
		for (;;) {
			const payload = parser.take();
			if (payload !== undefined) {
				stopWatch();
				let value: unknown;
				try {
					value = JSON.parse(payload);
				} catch {
					// Malformed event data is skipped, as native does; the watchdog restarts for the next event.
					startWatch();
					continue;
				}
				if (typeof value === "object" && value !== null && !Array.isArray(value)) {
					const record = value as Record<string, unknown>;
					yield { text: payload, value: record };
					if (typeof record.type === "string" && TERMINAL_TYPES.has(record.type)) return;
				}
				// Consumer time is not charged to the watchdog: it restarts when the consumer asks for more.
				startWatch();
				continue;
			}
			const chunk = await Promise.race([reader.read(), watch]);
			if (chunk.done) {
				throw new SseError(response.status, head.headers, "stream closed before response.completed", "eof");
			}
			parser.push(decoder.decode(chunk.value, { stream: true }));
		}
	} finally {
		stopWatch();
		reader.cancel().catch(() => undefined);
	}
}
