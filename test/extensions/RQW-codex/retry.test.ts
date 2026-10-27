import assert from "node:assert/strict";
import { it } from "node:test";
import { HttpRetryPolicy, RetryPolicy } from "../../../extensions/RQW-codex/retry.ts";
import { classifyEvent, classifyHttp } from "../../../extensions/RQW-codex/errors.ts";

const NOW = 1_700_000_000_000;
const options = { clock: { now: () => NOW }, random: () => 0.5 };

it("HTTP retries and stream retries fall back within their budgets", () => {
	const http = new HttpRetryPolicy(options);
	const server = classifyHttp(500, undefined, undefined, NOW);
	assert.deepEqual([0, 1, 2, 3].map(() => http.next(server).delayMs), [200, 400, 800, 1600]);
	assert.equal(http.next(server).retry, false);

	const stream = new RetryPolicy(options);
	const failure = classifyEvent({ type: "response.failed", response: { error: { code: "temporary" } } }, NOW)!;
	assert.deepEqual([0, 1, 2, 3, 4].map(() => stream.next(failure).delayMs), [200, 400, 800, 1600, 3200]);
	assert.equal(stream.next(failure).action, "fallback");
	for (let i = 0; i < 5; i++) stream.next(failure);
	assert.equal(stream.next(failure).action, "fail");
});

it("regression: native unclassified error wrappers are ignored", () => {
	assert.equal(classifyEvent({ type: "error", status: 200, error: { code: "server_error" } }), null);
	assert.equal(classifyEvent({ type: "error", error: { code: "server_error" } }), null);
});
