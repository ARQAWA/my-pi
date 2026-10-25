import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runBatch } from "../cli/web/batch.ts";
import { mapPool } from "../cli/web/pool.ts";
import type { RunOptions, TargetResult, TargetRun, TargetRunner } from "../cli/web/types.ts";

const targets = (count: number): RunOptions["targets"] => Array.from({ length: count }, (_, index) => ({ kind: "query" as const, value: `q${index}` }));
const options = (count: number): RunOptions => ({ targets: targets(count), mode: "cached", responseLength: "short", search: { model: "gpt-6-sol", effort: "high" } });
const answer = (run: TargetRun, summary = `answer ${run.target.value}`): TargetResult => ({
	target: run.target, model: run.model, effort: run.effort, mode: run.mode, responseLength: run.responseLength,
	status: "ok", summary, sources: [{ url: "https://example.com/" }], citations: [], actions: [], results: [],
});
const live = new AbortController().signal;

describe("rqw-web cross-platform CLI", () => {
describe("rqw-web pool", () => {
	it("never exceeds the limit, really overlaps, and keeps input order", async () => {
		let active = 0;
		let peak = 0;
		const gates: Array<() => void> = [];
		const done = mapPool([0, 1, 2, 3, 4, 5], 3, async item => {
			active++;
			peak = Math.max(peak, active);
			await new Promise<void>(resolve => gates.push(resolve));
			active--;
			return item * 2;
		});
		await new Promise(resolve => setImmediate(resolve));
		assert.equal(gates.length, 3, "three started at once, the rest queued");
		while (gates.length > 0) {
			gates.shift()!();
			await new Promise(resolve => setImmediate(resolve));
		}
		assert.deepEqual(await done, [0, 2, 4, 6, 8, 10]);
		assert.equal(peak, 3);
	});
});

describe("rqw-web batch", () => {
	it("keeps successful siblings when one target throws or fails", async () => {
		const runner: TargetRunner = async run => {
			if (run.target.value === "q1") throw new Error("boom with Bearer abc.def-ghi token");
			if (run.target.value === "q2") return { ...answer(run), status: "error", summary: "", error: { code: "http_500", message: "server said no" } };
			return answer(run);
		};
		const results = await runBatch(options(4), runner, { signal: live });
		assert.deepEqual(results.map(result => result.status), ["ok", "error", "error", "ok"]);
		assert.deepEqual(results.map(result => result.target.value), ["q0", "q1", "q2", "q3"]);
		assert.equal(results[1].error?.message.includes("abc.def"), false);
		assert.match(results[1].error!.message, /Bearer \[redacted\]/);
		assert.deepEqual(results[2].error, { code: "http_500", message: "server said no" });
	});

	it("turns an empty answer into an error, not a success", async () => {
		const [result] = await runBatch(options(1), async run => answer(run, "   "), { signal: live });
		assert.equal(result.status, "error");
		assert.equal(result.error?.code, "empty_result");
	});

	it("times out a target that ignores its signal and keeps the others", async () => {
		const runner: TargetRunner = run => run.target.value === "q0" ? new Promise<TargetResult>(() => {}) : Promise.resolve(answer(run));
		const results = await runBatch(options(2), runner, { signal: live, timeoutMs: 20, graceMs: 0 });
		assert.equal(results[0].error?.code, "timeout");
		assert.equal(results[1].status, "ok");
	});

	it("passes one signal that aborts on cancel; unstarted targets are cancelled without calling the engine", async () => {
		const controller = new AbortController();
		const started: string[] = [];
		const runner: TargetRunner = run => {
			started.push(run.target.value);
			return new Promise<TargetResult>((_, reject) => run.signal.addEventListener("abort", () => reject(run.signal.reason), { once: true }));
		};
		const pending = runBatch(options(5), runner, { signal: controller.signal, concurrency: 2 });
		await new Promise(resolve => setImmediate(resolve));
		assert.deepEqual(started, ["q0", "q1"]);
		controller.abort(new Error("cancelled"));
		const results = await pending;
		assert.deepEqual(started, ["q0", "q1"]);
		assert.deepEqual(results.map(result => result.error?.code), Array(5).fill("cancelled"));
	});

	it("hands the engine the mapped model, effort, mode and length", async () => {
		let seen: TargetRun | undefined;
		await runBatch({ ...options(1), mode: "live", responseLength: "long" }, async run => (seen = run, answer(run)), { signal: live });
		assert.deepEqual([seen?.model, seen?.effort, seen?.mode, seen?.responseLength, seen?.timeoutMs], ["gpt-6-sol", "high", "live", "long", 120_000]);
	});
});

});
