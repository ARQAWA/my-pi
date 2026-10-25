// Deterministic checks of RQW-codex typed errors and retry policy (stage 4). Fake clock and RNG; no network, no credentials.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	AUTH_RECOVERY_STAGES,
	AuthRecoveryPolicy,
	CODEX_RETRY_OWNED_DIAGNOSTIC,
	COMPACTION_STREAM_RETRIES,
	HttpRetryPolicy,
	RetryPolicy,
	backoffMs,
	isRetryOwnedDiagnostic,
	sleepAbortable,
} from "../../../extensions/RQW-codex/retry.ts";
import { isContextOverflow } from "@earendil-works/pi-ai";
import { CodexError, classifyEvent, classifyHttp, classifyTransport, normalizeUsage, parseRetryAfter } from "../../../extensions/RQW-codex/errors.ts";

const NOW = 1_700_000_000_000;
const clock = (now = NOW) => {
	let t = now;
	return { now: () => t, set: (v: number) => { t = v; } };
};
const fixedRandom = (value: number) => () => value;
/** jitter factor 1.0 (random 0.5 → 0.9 + 0.1). */
const noJitter = fixedRandom(0.5);

/** Native reads Retry-After from `response.error.headers`. */
const failed = (error: Record<string, unknown>, headers?: Record<string, string>) =>
	({ type: "response.failed", response: { id: "resp_1", error: headers ? { ...error, headers } : error } });

describe("classifyHttp", () => {
	it("usage_limit_reached is a terminal usage limit with reset time and no retry", () => {
		const e = classifyHttp(429, undefined, { error: { type: "usage_limit_reached", plan_type: "plus", resets_at: 1_700_003_600, limit_window_minutes: 300 } }, NOW);
		assert.equal(e.kind, "usage_limit_reached");
		assert.equal(e.resetAt, 1_700_003_600_000);
		assert.equal(e.planType, "plus");
		assert.equal(e.limitWindowMinutes, 300);
		assert.equal(e.retryable, false);
	});

	it("429 quota and credit codes are terminal quota errors", () => {
		for (const body of [
			{ error: { type: "insufficient_quota" } },
			{ error: { code: "credit_balance_exhausted" } },
			{ error: { code: "organization_spend_limit_exceeded" } },
			{ error: { code: "project_spend_limit_exceeded" } },
			{ error: { code: "organization_usage_limit_exceeded" } },
		]) {
			const e = classifyHttp(429, undefined, body, NOW);
			assert.equal(e.kind, "quota_exceeded", JSON.stringify(body));
			assert.equal(e.retryable, false);
		}
	});

	it("429 usage_not_included is terminal", () => {
		const e = classifyHttp(429, undefined, { error: { type: "usage_not_included" } }, NOW);
		assert.equal(e.kind, "usage_not_included");
		assert.equal(e.retryable, false);
	});

	it("plain 429 is a retry_limit: retryable only with Retry-After advice, never without", () => {
		const plain = classifyHttp(429, undefined, { error: { code: "rate_limit_exceeded" } }, NOW);
		assert.equal(plain.kind, "retry_limit");
		assert.equal(plain.status, 429);
		assert.equal(plain.retryable, false);
		const advised = classifyHttp(429, { "Retry-After": "7" }, undefined, NOW);
		assert.equal(advised.kind, "retry_limit");
		assert.equal(advised.retryAt, NOW + 7000);
		assert.equal(advised.retryable, true);
	});

	it("flex_unavailable and 401/403/426 classify without generic loops", () => {
		assert.equal(classifyHttp(429, undefined, { error: { code: "flex_unavailable" } }, NOW).kind, "flex_unavailable");
		const unauth = classifyHttp(401, undefined, undefined, NOW);
		assert.equal(unauth.kind, "unauthorized");
		assert.equal(unauth.retryable, false);
		const forbidden = classifyHttp(403, undefined, undefined, NOW);
		assert.equal(forbidden.kind, "unexpected_status");
		assert.equal(forbidden.status, 403);
		const upgrade = classifyHttp(426, undefined, undefined, NOW);
		assert.equal(upgrade.kind, "unexpected_status");
		assert.equal(upgrade.status, 426);
	});

	it("400 policy and prompt codes map to their own terminal kinds", () => {
		assert.equal(classifyHttp(400, undefined, { error: { code: "cyber_policy" } }, NOW).kind, "cyber_policy");
		assert.equal(classifyHttp(400, undefined, { error: { code: "bio_policy" } }, NOW).kind, "bio_policy");
		assert.equal(classifyHttp(400, undefined, { error: { code: "invalid_prompt" } }, NOW).kind, "invalid_prompt");
		assert.equal(classifyHttp(400, undefined, { error: { code: "misalignment_policy_violation" } }, NOW).kind, "misalignment_policy_violation");
		assert.equal(classifyHttp(403, undefined, { error: { code: "misalignment_policy_violation" } }, NOW).kind, "misalignment_policy_violation");
		for (const kind of ["cyber_policy", "bio_policy", "invalid_prompt", "misalignment_policy_violation"]) {
			assert.equal(classifyHttp(400, undefined, { error: { code: kind } }, NOW).retryable, false);
		}
	});

	it("400 invalid image text and generic 400 are terminal", () => {
		assert.equal(classifyHttp(400, undefined, "The image data you provided does not represent a valid image.", NOW).kind, "invalid_image_request");
		const generic = classifyHttp(400, undefined, { error: { message: "secret body text" } }, NOW);
		assert.equal(generic.kind, "invalid_request");
		assert.equal(generic.retryable, false);
	});

	it("500 is retryable internal; 503 overloaded needs advice; 503 slow_down is a rate limit", () => {
		assert.equal(classifyHttp(500, undefined, undefined, NOW).kind, "internal_server_error");
		assert.equal(classifyHttp(500, undefined, undefined, NOW).retryable, true);
		const overloaded = classifyHttp(503, undefined, { error: { code: "server_is_overloaded" } }, NOW);
		assert.equal(overloaded.kind, "server_overloaded");
		assert.equal(overloaded.retryable, false);
		const advised = classifyHttp(503, { "retry-after": "120" }, { error: { code: "server_is_overloaded" } }, NOW);
		assert.equal(advised.retryable, true);
		assert.equal(advised.retryAt, NOW + 120_000);
		assert.equal(classifyHttp(503, undefined, { error: { code: "slow_down" } }, NOW).kind, "rate_limit_exceeded");
	});

	it("Retry-After accepts seconds and HTTP dates, ignores garbage, and a past date means now", () => {
		assert.equal(parseRetryAfter("0", NOW), NOW);
		assert.equal(parseRetryAfter(" 3 ", NOW), NOW + 3000);
		assert.equal(parseRetryAfter("soon", NOW), undefined);
		assert.equal(parseRetryAfter("", NOW), undefined);
		assert.equal(parseRetryAfter("-1", NOW), undefined);
		const future = new Date(NOW + 90_000).toUTCString();
		assert.equal(parseRetryAfter(future, NOW), Date.parse(future));
		const past = new Date(NOW - 90_000).toUTCString();
		assert.equal(parseRetryAfter(past, NOW), NOW);
		assert.equal(classifyHttp(500, { "Retry-After": "nope" }, undefined, NOW).retryAt, undefined);
	});

	it("header lookup works with Headers instances and plain records case-insensitively", () => {
		const fromHeaders = classifyHttp(503, new Headers({ "Retry-After": "5" }), { error: { code: "server_is_overloaded" } }, NOW);
		assert.equal(fromHeaders.retryAt, NOW + 5000);
		const fromRecord = classifyHttp(503, { "RETRY-AFTER": "6" }, { error: { code: "server_is_overloaded" } }, NOW);
		assert.equal(fromRecord.retryAt, NOW + 6000);
	});

	it("messages are fixed templates: no body, token or account text leaks into message or fields", () => {
		const secret = "Bearer eyJSECRET.account_id=acct_123 sk-secret";
		const e = classifyHttp(401, { "x-request-id": "req_9" }, { error: { message: secret } }, NOW);
		const dump = JSON.stringify({ message: e.message, code: e.code, reason: e.reason, requestId: e.requestId });
		assert.equal(dump.includes("SECRET"), false);
		assert.equal(dump.includes("acct_123"), false);
		assert.equal(e.message.includes("eyJ"), false);
		const unexpected = classifyHttp(418, undefined, secret, NOW);
		assert.equal(unexpected.message.includes("SECRET"), false);
		assert.equal(unexpected.message, "unexpected status 418");
		assert.equal(e.requestId, "req_9");
	});

	it("unknown server codes are dropped; the code field keeps only the known allowlist", () => {
		assert.equal(classifyHttp(400, undefined, { error: { code: "made_up_code" } }, NOW).code, undefined);
		assert.equal(classifyEvent(failed({ code: "rate_limit_exceeded", message: "x" }), NOW)?.code, "rate_limit_exceeded");
	});
});

describe("classifyEvent", () => {
	it("context overflow is terminal for the retry policy", () => {
		const e = classifyEvent(failed({ code: "context_length_exceeded", message: "long" }), NOW);
		assert.equal(e?.kind, "context_window_exceeded");
		assert.equal(e?.retryable, false);
	});

	it("context overflow message is recognised by Pi's isContextOverflow and is not generic retryable", () => {
		const e = classifyEvent(failed({ code: "context_length_exceeded", message: "long" }), NOW)!;
		assert.equal(e.kind, "context_window_exceeded");
		const actual = {
			role: "assistant",
			stopReason: "error",
			errorMessage: e.message,
			content: [],
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
			api: "openai-codex-responses",
			provider: "openai-codex",
			model: "gpt",
			timestamp: NOW,
		} as unknown as Parameters<typeof isContextOverflow>[0];
		assert.equal(isContextOverflow(actual), true);
		assert.equal(new RetryPolicy({ clock: clock(), random: noJitter }).next(e).action, "fail");
		assert.equal(new HttpRetryPolicy({ clock: clock(), random: noJitter }).next(e).retry, false);
	});

	it("quota, usage_not_included, policy and invalid prompt events are terminal", () => {
		const cases: Array<[string, string]> = [
			["insufficient_quota", "quota_exceeded"],
			["credit_balance_exhausted", "quota_exceeded"],
			["organization_spend_limit_exceeded", "quota_exceeded"],
			["project_spend_limit_exceeded", "quota_exceeded"],
			["usage_not_included", "usage_not_included"],
			["cyber_policy", "cyber_policy"],
			["bio_policy", "bio_policy"],
			["misalignment_policy_violation", "misalignment_policy_violation"],
			["invalid_prompt", "invalid_prompt"],
		];
		for (const [code, kind] of cases) {
			const e = classifyEvent(failed({ code, message: "m" }, { "retry-after": "9" }), NOW);
			assert.equal(e?.kind, kind, code);
			assert.equal(e?.retryable, false, code);
			assert.equal(e?.retryAt, undefined, `${code} must not take retry advice`);
		}
	});

	it("server_is_overloaded retries only with advice from the error headers", () => {
		const bare = classifyEvent(failed({ code: "server_is_overloaded" }), NOW);
		assert.equal(bare?.kind, "server_overloaded");
		assert.equal(bare?.retryable, false);
		const advised = classifyEvent(failed({ code: "server_is_overloaded", headers: { "retry-after": "30" } }), NOW);
		assert.equal(advised?.retryable, true);
		assert.equal(advised?.retryAt, NOW + 30_000);
	});

	it("rate_limit_exceeded: header advice wins, then narrow 'try again in' message parsing", () => {
		const fromMessage = classifyEvent(failed({ code: "rate_limit_exceeded", message: "Please try again in 11.054s. Visit x" }), NOW);
		assert.equal(fromMessage?.kind, "rate_limit_exceeded");
		assert.equal(fromMessage?.retryAt, NOW + 11_054);
		const ms = classifyEvent(failed({ code: "slow_down", message: "Try again in 250ms" }), NOW);
		assert.equal(ms?.retryAt, NOW + 250);
		const seconds = classifyEvent(failed({ code: "rate_limit_exceeded", message: "try again in 3 seconds" }), NOW);
		assert.equal(seconds?.retryAt, NOW + 3000);
		const header = classifyEvent(failed({ code: "rate_limit_exceeded", message: "try again in 11s", headers: { "retry-after": "2" } }), NOW);
		assert.equal(header?.retryAt, NOW + 2000);
		const none = classifyEvent(failed({ code: "rate_limit_exceeded", message: "Too many. Try again in 5 minutes." }), NOW);
		assert.equal(none?.retryAt, undefined);
		assert.equal(none?.retryable, true);
	});

	it("unknown code with a header is a retryable stream error with that deadline; without it, a plain stream error", () => {
		const withHeader = classifyEvent(failed({ code: "something_else", message: "m", headers: { "retry-after": "4" } }), NOW);
		assert.equal(withHeader?.kind, "stream");
		assert.equal(withHeader?.retryAt, NOW + 4000);
		const plain = classifyEvent(failed({ code: "something_else", message: "m" }), NOW);
		assert.equal(plain?.kind, "stream");
		assert.equal(plain?.retryAt, undefined);
		assert.equal(plain?.retryable, true);
	});

	it("malformed or missing failed payloads become plain stream errors; flex is recognised first", () => {
		for (const event of [
			{ type: "response.failed" },
			{ type: "response.failed", response: null },
			{ type: "response.failed", response: { error: null } },
			{ type: "response.failed", response: { error: { code: 42 } } },
			{ type: "response.failed", response: { error: { code: "server_is_overloaded", plan_type: 42 } } },
		]) {
			const e = classifyEvent(event, NOW);
			assert.equal(e?.kind, "stream", JSON.stringify(event));
			assert.equal(e?.retryAt, undefined);
		}
		assert.equal(classifyEvent(failed({ code: "flex_unavailable" }), NOW)?.kind, "flex_unavailable");
	});

	it("response.incomplete: content_filter is retryable, interrupted completes, other reasons keep usage", () => {
		const cf = classifyEvent({ type: "response.incomplete", response: { incomplete_details: { reason: "content_filter" } } }, NOW);
		assert.equal(cf?.kind, "content_filter");
		assert.equal(cf?.retryable, true);
		assert.equal(classifyEvent({ type: "response.incomplete", response: { incomplete_details: { reason: "interrupted" } } }, NOW), null);
		const other = classifyEvent({
			type: "response.incomplete",
			response: {
				id: "resp_9",
				incomplete_details: { reason: "max_output_tokens" },
				usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14, input_tokens_details: { cached_tokens: 3 }, output_tokens_details: { reasoning_tokens: 2 } },
			},
		}, NOW);
		assert.equal(other?.kind, "response_incomplete");
		assert.equal(other?.reason, "max_output_tokens");
		assert.equal(other?.responseId, "resp_9");
		assert.equal(other?.retryable, false);
		assert.deepEqual(other?.usage, { inputTokens: 10, cachedInputTokens: 3, cacheWriteInputTokens: 0, outputTokens: 4, reasoningOutputTokens: 2, totalTokens: 14 });
		const unsafeReason = classifyEvent({ type: "response.incomplete", response: { incomplete_details: { reason: "bad reason!" } } }, NOW);
		assert.equal(unsafeReason?.reason, "unknown");
	});

	it("WebSocket wrapped previous_response_not_found and connection limit are retryable with header advice", () => {
		const prev = classifyEvent({ type: "error", error: { code: "previous_response_not_found", message: "x", headers: { "retry-after": "1" } } }, NOW);
		assert.equal(prev?.kind, "previous_response_not_found");
		assert.equal(prev?.retryable, true);
		assert.equal(prev?.retryAt, NOW + 1000);
		const limit = classifyEvent({ type: "error", error: { code: "websocket_connection_limit_reached" } }, NOW);
		assert.equal(limit?.kind, "websocket_connection_limit_reached");
		assert.equal(limit?.retryable, true);
	});

	it("WebSocket wrapped HTTP errors reuse the HTTP mapping; success and unknown wrappers are skipped", () => {
		const usage = classifyEvent({ type: "error", status: 429, headers: {}, error: { type: "usage_limit_reached", resets_at: 1_700_000_100 } }, NOW);
		assert.equal(usage?.kind, "usage_limit_reached");
		assert.equal(classifyEvent({ type: "error", status: 200, error: { code: "x" } }, NOW), null);
		assert.equal(classifyEvent({ type: "error", error: { code: "unknown" } }, NOW), null);
	});

	it("non-error, unknown and malformed events return null for the event parser", () => {
		assert.equal(classifyEvent({ type: "response.completed", response: { id: "r" } }, NOW), null);
		assert.equal(classifyEvent({ type: "response.output_text.delta", delta: "x" }, NOW), null);
		assert.equal(classifyEvent(null, NOW), null);
		assert.equal(classifyEvent("text", NOW), null);
		assert.equal(classifyEvent([], NOW), null);
	});
});

describe("classifyTransport, usage and partial state", () => {
	it("transport kinds map to native categories", () => {
		assert.equal(classifyTransport("connection").kind, "connection_failed");
		assert.equal(classifyTransport("connection").connectionFailed, true);
		assert.equal(classifyTransport("timeout").kind, "request_timeout");
		assert.equal(classifyTransport("network").kind, "stream");
		assert.equal(classifyTransport("response_stream").kind, "stream_failed");
		assert.equal(classifyTransport("policy").kind, "fatal");
		assert.equal(classifyTransport("policy").retryable, false);
	});

	it("normalizeUsage rejects missing required integers and defaults optional details like native", () => {
		assert.equal(normalizeUsage({ input_tokens: 1, output_tokens: 2 }), undefined);
		assert.equal(normalizeUsage({ input_tokens: 1, output_tokens: 2, total_tokens: 3, input_tokens_details: { cached_tokens: "x" } }), undefined);
		assert.deepEqual(normalizeUsage({ input_tokens: 1, output_tokens: 2, total_tokens: 3 }), {
			inputTokens: 1, cachedInputTokens: 0, cacheWriteInputTokens: 0, outputTokens: 2, reasoningOutputTokens: 0, totalTokens: 3,
		});
	});

	it("withPartial keeps completed items and usage on the error without executing anything", () => {
		const base = classifyEvent({ type: "response.incomplete", response: { incomplete_details: { reason: "max_output_tokens" } } }, NOW);
		assert.ok(base);
		const items = [{ type: "function_call", call_id: "c1", name: "read", arguments: "{}" }];
		const usage = { inputTokens: 5, cachedInputTokens: 0, cacheWriteInputTokens: 0, outputTokens: 1, reasoningOutputTokens: 0, totalTokens: 6 };
		const withState = base.withPartial(items, usage);
		assert.deepEqual(withState.partialItems, items);
		assert.deepEqual(withState.usage, usage);
		assert.equal(withState.kind, base.kind);
		assert.equal(base.partialItems, undefined);
	});
});

describe("HttpRetryPolicy", () => {
	const transport = () => classifyTransport("connection");

	it("gives 4 retries (5 attempts) with 200 ms exponential base, no jitter at random 0.5", () => {
		const policy = new HttpRetryPolicy({ clock: clock(), random: noJitter });
		const err = classifyHttp(500, undefined, undefined, NOW);
		assert.deepEqual([0, 1, 2, 3].map(() => policy.next(err)), [
			{ retry: true, delayMs: 200 },
			{ retry: true, delayMs: 400 },
			{ retry: true, delayMs: 800 },
			{ retry: true, delayMs: 1600 },
		]);
		assert.deepEqual(policy.next(err), { retry: false, delayMs: 0 });
	});

	it("jitter stays within ±10% using the injected RNG bounds", () => {
		assert.equal(backoffMs(200, 1, fixedRandom(0)), 180);
		assert.equal(backoffMs(200, 1, fixedRandom(0.999999)), 219);
		assert.equal(backoffMs(200, 3, fixedRandom(0)), 720);
		assert.equal(backoffMs(200, 0, fixedRandom(0)), 200);
		const policy = new HttpRetryPolicy({ clock: clock(), random: fixedRandom(0) });
		assert.equal(policy.next(classifyTransport("timeout")).delayMs, 180);
	});

	it("retries transport failures and 5xx, never 429, 401, 403, quota, usage or policy", () => {
		for (const err of [transport(), classifyTransport("timeout"), classifyTransport("network"), classifyHttp(503, undefined, undefined, NOW)]) {
			assert.equal(new HttpRetryPolicy({ random: noJitter }).next(err).retry, true, err.kind);
		}
		for (const err of [
			classifyHttp(429, { "retry-after": "1" }, undefined, NOW),
			classifyHttp(429, undefined, { error: { type: "usage_limit_reached" } }, NOW),
			classifyHttp(401, undefined, undefined, NOW),
			classifyHttp(403, undefined, undefined, NOW),
			classifyHttp(400, undefined, { error: { code: "cyber_policy" } }, NOW),
			classifyTransport("policy"),
		]) {
			assert.deepEqual(new HttpRetryPolicy({ random: noJitter }).next(err), { retry: false, delayMs: 0 }, err.kind);
		}
	});

	it("server Retry-After is used exactly and never capped; an expired deadline gives zero", () => {
		const c = clock();
		const policy = new HttpRetryPolicy({ clock: c, random: noJitter });
		const far = classifyHttp(503, { "retry-after": "3600" }, { error: { code: "server_is_overloaded" } }, NOW);
		assert.deepEqual(policy.next(far), { retry: true, delayMs: 3_600_000 });
		const expired = new CodexError({ kind: "internal_server_error", status: 500, retryAt: NOW - 1 });
		assert.deepEqual(new HttpRetryPolicy({ clock: c, random: noJitter }).next(expired), { retry: true, delayMs: 0 });
	});

	it("uses the injected clock for deadline deltas", () => {
		const c = clock();
		const err = classifyHttp(500, { "retry-after": "10" }, undefined, NOW);
		c.set(NOW + 4000);
		assert.equal(new HttpRetryPolicy({ clock: c, random: noJitter }).next(err).delayMs, 6000);
	});
});

describe("RetryPolicy (stream)", () => {
	it("sampling: 5 bounded retries with native backoff, then one sticky WS→SSE fallback, then 5 more, then fail", () => {
		const policy = new RetryPolicy({ clock: clock(), random: noJitter });
		const err = classifyEvent(failed({ code: "something_else" }), NOW)!;
		const delays: number[] = [];
		for (let i = 0; i < 5; i++) {
			const d = policy.next(err);
			assert.equal(d.action, "retry");
			assert.equal(d.reconnect, false);
			delays.push(d.delayMs);
		}
		assert.deepEqual(delays, [200, 400, 800, 1600, 3200]);
		assert.deepEqual(policy.next(err), { action: "fallback", delayMs: 0, reconnect: true });
		assert.equal(policy.transport, "sse");
		assert.equal(policy.retries, 0);
		for (let i = 0; i < 5; i++) assert.equal(policy.next(err).action, "retry");
		assert.deepEqual(policy.next(err), { action: "fail", delayMs: 0, reconnect: false });
		assert.equal(policy.transport, "sse", "fallback is sticky");
	});

	it("SSE transport never falls back; it fails after the bounded budget", () => {
		const policy = new RetryPolicy({ transport: "sse", clock: clock(), random: noJitter });
		const err = classifyEvent(failed({ code: "something_else" }), NOW)!;
		for (let i = 0; i < 5; i++) policy.next(err);
		assert.equal(policy.next(err).action, "fail");
	});

	it("server advice sets the delay uncapped and is not shortened by the 60 s connection cap", () => {
		const policy = new RetryPolicy({ clock: clock(), random: noJitter });
		const err = classifyHttp(429, { "retry-after": "600" }, undefined, NOW);
		assert.equal(err.kind, "retry_limit");
		assert.deepEqual(policy.next(err), { action: "retry", delayMs: 600_000, reconnect: false });
	});

	it("compaction: 2 bounded retries per transport, then fallback, then 2 more, then fail", () => {
		assert.equal(COMPACTION_STREAM_RETRIES, 2);
		const policy = new RetryPolicy({ request: "compaction", clock: clock(), random: noJitter });
		const err = classifyEvent(failed({ code: "something_else" }), NOW)!;
		assert.equal(policy.next(err).action, "retry");
		assert.equal(policy.next(err).action, "retry");
		assert.equal(policy.next(err).action, "fallback");
		assert.equal(policy.next(err).action, "retry");
		assert.equal(policy.next(err).action, "retry");
		assert.equal(policy.next(err).action, "fail");
	});

	it("unbounded connection loop: 5 s doubling to 60 s, never fails, evaluated before the bounded budget", () => {
		const policy = new RetryPolicy({ clock: clock(), random: noJitter });
		const conn = classifyTransport("connection");
		const delays: number[] = [];
		for (let i = 0; i < 12; i++) {
			const d = policy.next(conn);
			assert.equal(d.action, "retry");
			assert.equal(d.reconnect, true);
			delays.push(d.delayMs);
		}
		assert.deepEqual(delays, [5000, 10000, 20000, 40000, 60000, 60000, 60000, 60000, 60000, 60000, 60000, 60000]);
		assert.equal(policy.retries, 0, "connection loop does not consume the bounded budget");
		assert.equal(policy.connectionRetries, 12);
		const stream = classifyEvent(failed({ code: "something_else" }), NOW)!;
		assert.deepEqual(policy.next(stream), { action: "retry", delayMs: 200, reconnect: false });
	});

	it("unbounded loop ignores server advice on connection errors and is excluded for internal sessions and compaction", () => {
		const conn = new CodexError({ kind: "connection_failed", connectionFailed: true, retryAt: NOW + 999_000 });
		assert.equal(new RetryPolicy({ clock: clock(), random: noJitter }).next(conn).delayMs, 5000);
		const internal = new RetryPolicy({ internalSession: true, clock: clock(), random: noJitter });
		for (let i = 0; i < 5; i++) assert.equal(internal.next(classifyTransport("connection")).action, "retry");
		assert.equal(internal.next(classifyTransport("connection")).action, "fallback");
		const compaction = new RetryPolicy({ request: "compaction", clock: clock(), random: noJitter });
		assert.equal(compaction.next(classifyTransport("connection")).action, "retry");
		assert.equal(compaction.next(classifyTransport("connection")).action, "retry");
		assert.equal(compaction.next(classifyTransport("connection")).action, "fallback");
	});

	it("unboundedConnectionRetries=false keeps connection failures in the bounded budget", () => {
		const policy = new RetryPolicy({ unboundedConnectionRetries: false, clock: clock(), random: noJitter });
		const delays = [0, 1, 2, 3, 4].map(() => policy.next(classifyTransport("connection")).delayMs);
		assert.deepEqual(delays, [200, 400, 800, 1600, 3200]);
		assert.equal(policy.next(classifyTransport("connection")).action, "fallback");
	});

	it("426 upgrade required falls back at once from WebSocket, without consuming the budget", () => {
		const policy = new RetryPolicy({ clock: clock(), random: noJitter });
		const upgrade = classifyHttp(426, undefined, undefined, NOW);
		assert.deepEqual(policy.next(upgrade), { action: "fallback", delayMs: 0, reconnect: true });
		assert.equal(policy.retries, 0);
	});

	it("previous_response_not_found and connection-limit retry with a new connection and the same bounded budget", () => {
		const policy = new RetryPolicy({ clock: clock(), random: noJitter });
		const prev = classifyEvent({ type: "error", error: { code: "previous_response_not_found" } }, NOW)!;
		assert.deepEqual(policy.next(prev), { action: "retry", delayMs: 200, reconnect: true });
		assert.equal(policy.retries, 1);
	});

	it("content_filter is a bounded retry for sampling; the caller records guidance from the kind", () => {
		const policy = new RetryPolicy({ clock: clock(), random: noJitter });
		const cf = classifyEvent({ type: "response.incomplete", response: { incomplete_details: { reason: "content_filter" } } }, NOW)!;
		assert.equal(policy.next(cf).action, "retry");
		assert.equal(cf.kind, "content_filter");
	});

	it("terminal classes fail on the first call and never enter a loop", () => {
		const terminal = [
			classifyEvent(failed({ code: "context_length_exceeded" }), NOW),
			classifyHttp(429, undefined, { error: { type: "usage_limit_reached" } }, NOW),
			classifyHttp(429, undefined, { error: { code: "insufficient_quota" } }, NOW),
			classifyHttp(429, undefined, { error: { type: "usage_not_included" } }, NOW),
			classifyHttp(401, undefined, undefined, NOW),
			classifyHttp(400, undefined, { error: { code: "cyber_policy" } }, NOW),
			classifyHttp(400, undefined, { error: { code: "bio_policy" } }, NOW),
			classifyHttp(400, undefined, { error: { code: "misalignment_policy_violation" } }, NOW),
			classifyHttp(400, undefined, undefined, NOW),
			classifyEvent({ type: "response.incomplete", response: { incomplete_details: { reason: "max_output_tokens" } } }, NOW),
			classifyTransport("policy"),
			classifyHttp(503, undefined, { error: { code: "server_is_overloaded" } }, NOW),
		] as CodexError[];
		for (const err of terminal) {
			const policy = new RetryPolicy({ clock: clock(), random: noJitter, transport: "sse" });
			assert.deepEqual(policy.next(err), { action: "fail", delayMs: 0, reconnect: false }, err.kind);
			const wsPolicy = new RetryPolicy({ clock: clock(), random: noJitter });
			assert.equal(wsPolicy.next(err).action, "fail", `${err.kind} must not fall back either`);
		}
	});

	it("failing decisions leave the error and its partial usage untouched", () => {
		const usage = { inputTokens: 7, cachedInputTokens: 0, cacheWriteInputTokens: 0, outputTokens: 2, reasoningOutputTokens: 0, totalTokens: 9 };
		const err = classifyEvent({ type: "response.incomplete", response: { incomplete_details: { reason: "max_output_tokens" }, usage: { input_tokens: 7, output_tokens: 2, total_tokens: 9 } } }, NOW)!.withPartial([{ type: "message" }], usage);
		const before = JSON.stringify({ kind: err.kind, usage: err.usage, partialItems: err.partialItems, message: err.message });
		const policy = new RetryPolicy({ clock: clock(), random: noJitter });
		assert.equal(policy.next(err).action, "fail");
		assert.equal(JSON.stringify({ kind: err.kind, usage: err.usage, partialItems: err.partialItems, message: err.message }), before);
	});

	it("reconnect is false for ordinary stream errors and true for transport-level ones", () => {
		const policy = new RetryPolicy({ clock: clock(), random: noJitter });
		assert.equal(policy.next(classifyEvent(failed({ code: "x" }), NOW)!).reconnect, false);
		assert.equal(policy.next(classifyTransport("response_stream")).reconnect, true);
	});
});

describe("AuthRecoveryPolicy", () => {
	it("401 gets exactly the finite reload then refresh stages, then fails", () => {
		assert.deepEqual([...AUTH_RECOVERY_STAGES], ["reload", "refresh"]);
		const policy = new AuthRecoveryPolicy();
		const unauth = classifyHttp(401, undefined, undefined, NOW);
		assert.deepEqual(policy.next(unauth), { action: "reload" });
		assert.deepEqual(policy.next(unauth), { action: "refresh" });
		assert.deepEqual(policy.next(unauth), { action: "fail" });
		assert.deepEqual(policy.next(unauth), { action: "fail" });
	});

	it("non-auth errors are not handled by auth recovery", () => {
		assert.deepEqual(new AuthRecoveryPolicy().next(classifyHttp(403, undefined, undefined, NOW)), { action: "fail" });
		assert.deepEqual(new AuthRecoveryPolicy().next(classifyHttp(429, undefined, { error: { type: "usage_limit_reached" } }, NOW)), { action: "fail" });
	});

	it("a 401 is never a generic stream or HTTP retry", () => {
		const unauth = classifyHttp(401, undefined, undefined, NOW);
		assert.equal(new RetryPolicy({ clock: clock() }).next(unauth).action, "fail");
		assert.equal(new HttpRetryPolicy({ clock: clock() }).next(unauth).retry, false);
	});
});

describe("sleepAbortable", () => {
	it("resolves after the delay and rejects immediately when already aborted", async () => {
		await sleepAbortable(1);
		const ac = new AbortController();
		ac.abort();
		await assert.rejects(sleepAbortable(1000, ac.signal), { name: "AbortError" });
	});

	it("abort during the default sleep rejects and leaves no timer behind", async () => {
		const timersBefore = process.getActiveResourcesInfo().filter(name => name === "Timeout").length;
		const ac = new AbortController();
		const pending = sleepAbortable(60_000, ac.signal);
		assert.equal(process.getActiveResourcesInfo().filter(name => name === "Timeout").length, timersBefore + 1);
		ac.abort();
		await assert.rejects(pending, { name: "AbortError" });
		assert.equal(process.getActiveResourcesInfo().filter(name => name === "Timeout").length, timersBefore);
	});

	it("completed sleep removes its abort listener", async () => {
		const ac = new AbortController();
		await sleepAbortable(1, ac.signal);
		ac.abort();
	});

	it("uses an injected sleep with the signal and still rejects on abort", async () => {
		const calls: Array<[number, AbortSignal | undefined]> = [];
		await sleepAbortable(250, undefined, async (ms, signal) => {
			calls.push([ms, signal]);
		});
		assert.deepEqual(calls, [[250, undefined]]);
		const ac = new AbortController();
		const neverEnds = sleepAbortable(5, ac.signal, () => new Promise<void>(() => {}));
		ac.abort();
		await assert.rejects(neverEnds, { name: "AbortError" });
	});

	it("rejects invalid delays", async () => {
		await assert.rejects(sleepAbortable(-1), RangeError);
		await assert.rejects(sleepAbortable(Number.NaN), RangeError);
	});
});

describe("diagnostics marker", () => {
	it("exports the Pi no-double-retry marker constant and recognises it structurally", () => {
		assert.equal(CODEX_RETRY_OWNED_DIAGNOSTIC, "rqw_codex_retry_owned");
		assert.equal(isRetryOwnedDiagnostic({ type: CODEX_RETRY_OWNED_DIAGNOSTIC }), true);
		assert.equal(isRetryOwnedDiagnostic({ type: "rqw_anthropic_partial_stream" }), false);
		assert.equal(isRetryOwnedDiagnostic("rqw_codex_retry_owned"), false);
		assert.equal(isRetryOwnedDiagnostic(null), false);
	});
});
