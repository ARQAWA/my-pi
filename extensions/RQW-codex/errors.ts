// Typed Codex subscription errors, ported from codex-rs stable 0.163.0:
// codex-api/src/sse/responses_error.rs (event classification), codex-api/src/api_bridge.rs (HTTP status mapping),
// protocol/src/error.rs (retry_delay categories, usage-limit kinds), codex-client/src/retry.rs (Retry-After parsing).
// Pure: no I/O, no timers. Messages are fixed templates; server bodies, tokens and account data are never copied into messages.

export type CodexErrorKind =
	| "context_window_exceeded"
	| "quota_exceeded"
	| "usage_limit_reached"
	| "usage_not_included"
	| "rate_limit_exceeded"
	| "server_overloaded"
	| "retry_limit"
	| "stream"
	| "stream_failed"
	| "connection_failed"
	| "request_timeout"
	| "content_filter"
	| "response_incomplete"
	| "internal_server_error"
	| "unexpected_status"
	| "unauthorized"
	| "invalid_request"
	| "invalid_prompt"
	| "invalid_image_request"
	| "cyber_policy"
	| "bio_policy"
	| "misalignment_policy_violation"
	| "flex_unavailable"
	| "previous_response_not_found"
	| "websocket_connection_limit_reached"
	| "fatal";

export interface CodexUsage {
	inputTokens: number;
	cachedInputTokens: number;
	cacheWriteInputTokens: number;
	outputTokens: number;
	reasoningOutputTokens: number;
	totalTokens: number;
}

export interface CodexErrorOptions {
	kind: CodexErrorKind;
	status?: number;
	/** Known server error code only (a fixed allowlist); arbitrary server text is never kept. */
	code?: string;
	/** Usage-limit reset instant, epoch milliseconds. */
	resetAt?: number;
	/** Server retry deadline (Retry-After or in-stream advice), epoch milliseconds. Never shortened locally. */
	retryAt?: number;
	/** Plan name reported by a usage-limit response (short identifier). */
	planType?: string;
	limitWindowMinutes?: number;
	requestId?: string;
	responseId?: string;
	/** Sanitized `response.incomplete` reason. */
	reason?: string;
	connectionFailed?: boolean;
	/** True when the error came from the transport layer rather than from an HTTP status or stream event. */
	transport?: boolean;
	/** Completed output items retained by the stream layer before the failure. Never executed as tools here. */
	partialItems?: readonly unknown[];
	usage?: CodexUsage;
}

/** Kinds that native `retry_delay` treats as retryable (budget still applies in the retry policies). */
const RETRYABLE_KINDS: ReadonlySet<CodexErrorKind> = new Set<CodexErrorKind>([
	"rate_limit_exceeded",
	"stream",
	"stream_failed",
	"connection_failed",
	"request_timeout",
	"content_filter",
	"previous_response_not_found",
	"websocket_connection_limit_reached",
	"internal_server_error",
	"unexpected_status",
]);

/** Kinds that are retryable only when the server gave retry advice (native `server_retry_delay`). */
const ADVICE_ONLY_KINDS: ReadonlySet<CodexErrorKind> = new Set<CodexErrorKind>(["server_overloaded", "retry_limit"]);

/** Server codes that are kept on the error; anything else is dropped. */
const KNOWN_CODES: ReadonlySet<string> = new Set([
	"context_length_exceeded",
	"insufficient_quota",
	"credit_balance_exhausted",
	"organization_spend_limit_exceeded",
	"project_spend_limit_exceeded",
	"organization_usage_limit_exceeded",
	"usage_not_included",
	"cyber_policy",
	"bio_policy",
	"misalignment_policy_violation",
	"invalid_prompt",
	"server_is_overloaded",
	"rate_limit_exceeded",
	"slow_down",
	"flex_unavailable",
	"websocket_connection_limit_reached",
	"previous_response_not_found",
]);

const IMAGE_INVALID_TEXT = "The image data you provided does not represent a valid image";

const MESSAGES: Record<CodexErrorKind, string> = {
	context_window_exceeded:
		"context_length_exceeded: Codex ran out of room in the model's context window. Start a new thread or clear earlier history before retrying.",
	quota_exceeded: "Quota exceeded. Check your plan and billing details.",
	usage_limit_reached: "You've hit your usage limit.",
	usage_not_included: "To use Codex with your ChatGPT plan, upgrade to Plus: https://chatgpt.com/explore/plus.",
	rate_limit_exceeded: "Rate limit exceeded.",
	server_overloaded: "Selected model is at capacity. Please try a different model.",
	retry_limit: "exceeded retry limit",
	stream: "stream disconnected before completion",
	stream_failed: "Error while reading the server response",
	connection_failed: "Connection failed",
	request_timeout: "request timed out",
	content_filter: "stream disconnected before completion: Incomplete response returned, reason: content_filter",
	response_incomplete: "Incomplete response returned",
	internal_server_error: "We're currently experiencing high demand, which may cause temporary errors.",
	unexpected_status: "unexpected status",
	unauthorized: "Unauthorized: the ChatGPT sign-in needs recovery.",
	invalid_request: "Invalid request.",
	invalid_prompt: "Invalid request.",
	invalid_image_request: "The image data you provided does not represent a valid image.",
	cyber_policy: "This request has been flagged for possible cybersecurity risk.",
	bio_policy: "This content was flagged for possible biological risk.",
	misalignment_policy_violation: "This request was blocked due to a misalignment policy violation.",
	flex_unavailable: "Flex capacity unavailable.",
	previous_response_not_found: "Previous response was not found. Retrying the full request.",
	websocket_connection_limit_reached:
		"Responses websocket connection limit reached (60 minutes). Create a new websocket connection to continue.",
	fatal: "Fatal error.",
};

function messageFor(options: CodexErrorOptions): string {
	const { kind, status, reason } = options;
	switch (kind) {
		case "retry_limit":
			return `${MESSAGES.retry_limit}, last status: ${status ?? "unknown"}`;
		case "unexpected_status":
			return `${MESSAGES.unexpected_status} ${status ?? "unknown"}`;
		case "unauthorized":
			return `Unauthorized (${status ?? 401}): the ChatGPT sign-in needs recovery.`;
		case "response_incomplete":
			return `Incomplete response returned, reason: ${reason ?? "unknown"}`;
		default:
			return MESSAGES[kind];
	}
}

export class CodexError extends Error {
	readonly kind: CodexErrorKind;
	readonly status?: number;
	readonly code?: string;
	readonly resetAt?: number;
	readonly retryAt?: number;
	readonly planType?: string;
	readonly limitWindowMinutes?: number;
	readonly requestId?: string;
	readonly responseId?: string;
	readonly reason?: string;
	readonly connectionFailed: boolean;
	readonly transport: boolean;
	readonly partialItems?: readonly unknown[];
	readonly usage?: CodexUsage;
	/** Whether native classification allows a retry at all; budgets and transport rules are applied by retry.ts. */
	readonly retryable: boolean;

	constructor(options: CodexErrorOptions) {
		super(messageFor(options));
		this.name = "CodexError";
		this.kind = options.kind;
		this.status = options.status;
		this.code = options.code;
		this.resetAt = options.resetAt;
		this.retryAt = options.retryAt;
		this.planType = options.planType;
		this.limitWindowMinutes = options.limitWindowMinutes;
		this.requestId = options.requestId;
		this.responseId = options.responseId;
		this.reason = options.reason;
		this.connectionFailed = options.connectionFailed === true;
		this.transport = options.transport === true;
		this.partialItems = options.partialItems;
		this.usage = options.usage;
		this.retryable = ADVICE_ONLY_KINDS.has(options.kind)
			? options.retryAt !== undefined
			: RETRYABLE_KINDS.has(options.kind);
	}

	/** Returns a copy that carries the completed items and usage the stream layer collected before the failure. */
	withPartial(partialItems: readonly unknown[] | undefined, usage?: CodexUsage): CodexError {
		return new CodexError({
			kind: this.kind,
			status: this.status,
			code: this.code,
			resetAt: this.resetAt,
			retryAt: this.retryAt,
			planType: this.planType,
			limitWindowMinutes: this.limitWindowMinutes,
			requestId: this.requestId,
			responseId: this.responseId,
			reason: this.reason,
			connectionFailed: this.connectionFailed,
			transport: this.transport,
			partialItems,
			usage: usage ?? this.usage,
		});
	}
}

export type HeadersLike = { get(name: string): string | null } | Record<string, unknown>;

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as JsonObject) : undefined;
}

function isInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value);
}

/** Option<String>-compatible shape: absent, null or string. */
function optionalString(value: unknown): boolean {
	return value === undefined || value === null || typeof value === "string";
}

function optionalInteger(value: unknown): boolean {
	return value === undefined || value === null || isInteger(value);
}

function headerValue(headers: HeadersLike | undefined, name: string): string | undefined {
	if (!headers) return undefined;
	if (typeof (headers as { get?: unknown }).get === "function") {
		const value = (headers as { get(name: string): string | null }).get(name);
		return typeof value === "string" ? value : undefined;
	}
	for (const [key, value] of Object.entries(headers as JsonObject)) {
		if (key.toLowerCase() === name && typeof value === "string") return value;
	}
	return undefined;
}

/** Retry-After: delay seconds or an HTTP date; invalid values are ignored; a past date means "now". */
export function parseRetryAfter(value: string, now: number): number | undefined {
	const trimmed = value.trim();
	if (/^[0-9]+$/.test(trimmed)) {
		const seconds = Number(trimmed);
		return Number.isSafeInteger(seconds) ? now + seconds * 1000 : undefined;
	}
	// HTTP dates always contain letters (weekday or month names); numeric-only strings are not dates.
	if (!/[A-Za-z]/.test(trimmed)) return undefined;
	const date = Date.parse(trimmed);
	return Number.isFinite(date) ? Math.max(now, date) : undefined;
}

function retryAfterFrom(headers: HeadersLike | undefined, now: number): number | undefined {
	const value = headerValue(headers, "retry-after");
	return value === undefined ? undefined : parseRetryAfter(value, now);
}

/** Retry-After inside a streamed error's own `headers` object (JSON header values). */
function retryAfterFromJson(headers: unknown, now: number): number | undefined {
	const object = asObject(headers);
	return object ? retryAfterFrom(object as HeadersLike, now) : undefined;
}

const RETRY_IN_PATTERN = /try again in\s*(\d+(?:\.\d+)?)\s*(s|ms|seconds?)/i;

/** Narrow plaintext advice, used only for rate-limit codes: "try again in 11.054s", "250ms", "3 seconds". */
function retryAfterFromMessage(message: string | undefined, now: number): number | undefined {
	if (message === undefined) return undefined;
	const match = RETRY_IN_PATTERN.exec(message);
	if (!match) return undefined;
	const value = Number(match[1]);
	const unit = match[2].toLowerCase();
	if (unit === "s" || unit.startsWith("second")) {
		const ms = Math.floor(value * 1000);
		return Number.isFinite(ms) ? now + ms : undefined;
	}
	if (unit === "ms") return now + Math.floor(value);
	return undefined;
}

function resetInstant(seconds: unknown): number | undefined {
	if (!isInteger(seconds)) return undefined;
	const ms = seconds * 1000;
	return Math.abs(ms) <= 8.64e15 ? ms : undefined;
}

function safeCode(value: unknown): string | undefined {
	return typeof value === "string" && KNOWN_CODES.has(value) ? value : undefined;
}

function sanitizeReason(value: unknown): string {
	return typeof value === "string" && /^[a-z_]{1,64}$/.test(value) ? value : "unknown";
}

function requestIdFrom(headers: HeadersLike | undefined): string | undefined {
	return headerValue(headers, "x-request-id") ?? headerValue(headers, "x-oai-request-id");
}

/**
 * Port of codex-rs `Responses.usage` → TokenUsage (sse/responses.rs ResponseCompletedUsage).
 * Required integers must be present; optional detail objects default to zero like native `unwrap_or_default`.
 */
export function normalizeUsage(raw: unknown): CodexUsage | undefined {
	const usage = asObject(raw);
	if (!usage || !isInteger(usage.input_tokens) || !isInteger(usage.output_tokens) || !isInteger(usage.total_tokens)) {
		return undefined;
	}
	let cached = 0;
	let cacheWrite = 0;
	if (usage.input_tokens_details !== undefined && usage.input_tokens_details !== null) {
		const details = asObject(usage.input_tokens_details);
		if (!details || !isInteger(details.cached_tokens) || !optionalInteger(details.cache_write_tokens)) return undefined;
		cached = details.cached_tokens;
		cacheWrite = isInteger(details.cache_write_tokens) ? details.cache_write_tokens : 0;
	}
	let reasoning = 0;
	if (usage.output_tokens_details !== undefined && usage.output_tokens_details !== null) {
		const details = asObject(usage.output_tokens_details);
		if (!details || !isInteger(details.reasoning_tokens)) return undefined;
		reasoning = details.reasoning_tokens;
	}
	return {
		inputTokens: usage.input_tokens,
		cachedInputTokens: cached,
		cacheWriteInputTokens: cacheWrite,
		outputTokens: usage.output_tokens,
		reasoningOutputTokens: reasoning,
		totalTokens: usage.total_tokens,
	};
}

/** Maps an HTTP failure to a typed error (port of api_bridge.rs `map_api_error_details` for TransportError::Http). */
export function classifyHttp(
	status: number,
	headers?: HeadersLike,
	safeParsedBody?: unknown,
	now: number = Date.now(),
): CodexError {
	const retryAt = retryAfterFrom(headers, now);
	const requestId = requestIdFrom(headers);
	const bodyText = typeof safeParsedBody === "string" ? safeParsedBody : undefined;
	let body: unknown = safeParsedBody;
	if (bodyText !== undefined) {
		try {
			body = JSON.parse(bodyText);
		} catch {
			body = undefined;
		}
	}
	return classifyHttpBody(status, asObject(asObject(body)?.error), retryAt, requestId, bodyText);
}

function classifyHttpBody(
	status: number,
	error: JsonObject | undefined,
	retryAt: number | undefined,
	requestId: string | undefined,
	bodyText: string | undefined,
): CodexError {
	const code = typeof error?.code === "string" ? error.code : undefined;
	const make = (kind: CodexErrorKind, extra: Partial<CodexErrorOptions> = {}) =>
		new CodexError({ kind, status, retryAt, requestId, transport: false, ...extra });

	if (status === 503 && code === "server_is_overloaded") return make("server_overloaded");
	if (status === 503 && code === "slow_down") return make("rate_limit_exceeded", { code: "slow_down" });
	if ((status === 400 || status === 403) && code === "misalignment_policy_violation") {
		return make("misalignment_policy_violation", { code });
	}
	if (status === 400) {
		if (code === "cyber_policy") return make("cyber_policy", { code });
		if (code === "bio_policy") return make("bio_policy", { code });
		if (code === "invalid_prompt") return make("invalid_prompt", { code });
		if (bodyText?.includes(IMAGE_INVALID_TEXT)) return make("invalid_image_request");
		return make("invalid_request");
	}
	if (status === 500) return make("internal_server_error");
	if (status === 429) {
		if (code === "flex_unavailable") return make("flex_unavailable", { code });
		if (error) {
			const type = error.type;
			const planType = error.plan_type;
			if (optionalString(type) && optionalString(planType) && optionalInteger(error.resets_at)) {
				if (type === "usage_limit_reached") {
					const windowMinutes = error.limit_window_minutes;
					return make("usage_limit_reached", {
						resetAt: resetInstant(error.resets_at),
						planType: typeof planType === "string" ? planType : undefined,
						limitWindowMinutes:
							isInteger(windowMinutes) && windowMinutes >= 0 && windowMinutes <= 65535 ? windowMinutes : undefined,
					});
				}
				if (type === "usage_not_included") return make("usage_not_included");
				if (
					type === "insufficient_quota" ||
					(typeof error.code === "string" &&
						[
							"insufficient_quota",
							"credit_balance_exhausted",
							"organization_spend_limit_exceeded",
							"project_spend_limit_exceeded",
							"organization_usage_limit_exceeded",
						].includes(error.code))
				) {
					return make("quota_exceeded");
				}
			}
		}
		return make("retry_limit");
	}
	if (status === 401) return make("unauthorized");
	return make("unexpected_status");
}

/** Transport-layer failures before or during a response (port of api_bridge.rs TransportError mapping). */
export function classifyTransport(
	failure: "connection" | "timeout" | "network" | "response_stream" | "policy",
): CodexError {
	switch (failure) {
		case "connection":
			return new CodexError({ kind: "connection_failed", connectionFailed: true, transport: true });
		case "timeout":
			return new CodexError({ kind: "request_timeout", transport: true });
		case "network":
			return new CodexError({ kind: "stream", transport: true });
		case "response_stream":
			return new CodexError({ kind: "stream_failed", transport: true });
		case "policy":
			return new CodexError({ kind: "fatal", transport: true });
	}
}

/**
 * Classifies one parsed Responses stream event. Returns null for events that are not errors
 * (completed, interrupted incomplete, unknown or malformed types); the event parser handles those elsewhere.
 */
export function classifyEvent(event: unknown, now: number = Date.now()): CodexError | null {
	const object = asObject(event);
	if (!object) return null;
	switch (object.type) {
		case "error":
			return classifyWrappedError(object, now);
		case "response.failed":
			return classifyFailed(object.response, now);
		case "response.incomplete":
			return classifyIncomplete(object.response);
		default:
			return null;
	}
}

/** WebSocket `{type:"error", status, error, headers}` wrapper (responses_websocket.rs map_wrapped_websocket_error_event). */
function classifyWrappedError(event: JsonObject, now: number): CodexError | null {
	const error = asObject(event.error);
	if (error && error.code === "flex_unavailable") return new CodexError({ kind: "flex_unavailable", code: "flex_unavailable" });
	const retryAt = retryAfterFromJson(error?.headers, now) ?? retryAfterFromJson(event.headers, now);
	if (error?.code === "websocket_connection_limit_reached") {
		return new CodexError({ kind: "websocket_connection_limit_reached", code: error.code, retryAt, transport: true });
	}
	if (error?.code === "previous_response_not_found") {
		return new CodexError({ kind: "previous_response_not_found", code: error.code, retryAt, transport: true });
	}
	if (typeof event.status !== "number" || !Number.isInteger(event.status) || event.status < 100 || event.status > 999) {
		return null;
	}
	if (event.status >= 200 && event.status < 300) return null;
	return classifyHttpBody(
		event.status,
		error,
		retryAt,
		requestIdFrom(asObject(event.headers) as HeadersLike | undefined),
		undefined,
	);
}

/** Port of responses_error.rs `parse_failed_response`. */
function classifyFailed(response: unknown, now: number): CodexError {
	const error = asObject(asObject(response)?.error);
	const retryHeader = retryAfterFromJson(error?.headers, now);
	if (error && error.code === "flex_unavailable") return new CodexError({ kind: "flex_unavailable", code: error.code });
	const shapeOk =
		error !== undefined &&
		optionalString(error.type) &&
		optionalString(error.code) &&
		optionalString(error.message) &&
		optionalString(error.plan_type) &&
		optionalInteger(error.resets_at);
	if (!error || !shapeOk) {
		return new CodexError({ kind: "stream", retryAt: retryHeader, transport: false });
	}
	const message = typeof error.message === "string" ? error.message : undefined;
	switch (error.code) {
		case "context_length_exceeded":
			return new CodexError({ kind: "context_window_exceeded", code: error.code });
		case "insufficient_quota":
		case "credit_balance_exhausted":
		case "organization_spend_limit_exceeded":
		case "project_spend_limit_exceeded":
			return new CodexError({ kind: "quota_exceeded", code: safeCode(error.code) });
		case "usage_not_included":
			return new CodexError({ kind: "usage_not_included", code: error.code });
		case "cyber_policy":
			return new CodexError({ kind: "cyber_policy", code: error.code });
		case "bio_policy":
			return new CodexError({ kind: "bio_policy", code: error.code });
		case "misalignment_policy_violation":
			return new CodexError({ kind: "misalignment_policy_violation", code: error.code });
		case "invalid_prompt":
			return new CodexError({ kind: "invalid_prompt", code: error.code });
		case "server_is_overloaded":
			return new CodexError({ kind: "server_overloaded", code: error.code, retryAt: retryHeader });
		case "rate_limit_exceeded":
		case "slow_down":
			return new CodexError({
				kind: "rate_limit_exceeded",
				code: error.code,
				retryAt: retryHeader ?? retryAfterFromMessage(message, now),
			});
		default:
			return new CodexError({ kind: "stream", retryAt: retryHeader, transport: false });
	}
}

/** `response.incomplete`: content_filter and non-interrupted reasons are errors; `interrupted` completes normally. */
function classifyIncomplete(response: unknown): CodexError | null {
	const object = asObject(response);
	const details = asObject(object?.incomplete_details);
	const reason = typeof details?.reason === "string" ? details.reason : "unknown";
	if (reason === "content_filter") return new CodexError({ kind: "content_filter" });
	if (reason === "interrupted") return null;
	return new CodexError({
		kind: "response_incomplete",
		reason: sanitizeReason(reason),
		responseId: typeof object?.id === "string" ? object.id : undefined,
		usage: normalizeUsage(object?.usage),
	});
}
