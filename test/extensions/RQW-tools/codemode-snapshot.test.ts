import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { createCodemodeExtension, createWriteToolDefinition } from "@earendil-works/pi-coding-agent";
import { groupCodemode } from "../../../extensions/RQW-tools/codemode.ts";
import { createJobs } from "../../../extensions/RQW-tools/jobs.ts";
import { createNestedBarrier } from "../../../extensions/RQW-tools/nested.ts";

async function within<T>(promise: Promise<T>): Promise<T> {
	let timer: ReturnType<typeof setTimeout>;
	try {
		return await Promise.race([promise, new Promise<never>((_, reject) => {
			timer = setTimeout(() => reject(new Error("codemode boundary did not settle")), 10000);
		})]);
	} finally { clearTimeout(timer!); }
}

it("codemode snapshots after cancelled nested file work drains and before its outer follower", async (t) => {
	const dir = await mkdtemp(join(tmpdir(), "rqw-codemode-snapshot-"));
	const threshold = 12345;
	const timers: (() => void)[] = [];
	const realTimeout = globalThis.setTimeout;
	t.mock.method(globalThis, "setTimeout", (fn: any, ms?: number, ...args: any[]) => {
		if (ms !== threshold) return realTimeout(fn, ms, ...args);
		timers.push(() => fn(...args));
		const inert = realTimeout(() => {}, 0);
		clearTimeout(inert);
		return inert;
	});
	const jobs = createJobs({ backgroundAfterMs: threshold });
	const nested = createNestedBarrier();
	const started = Promise.withResolvers<void>();
	const release = Promise.withResolvers<void>();
	const returned = Promise.withResolvers<void>();
	const failNow = Promise.withResolvers<void>();
	const aborted = Promise.withResolvers<void>();
	let definition: any;
	let lateDone = false;
	const settleAfterWrite: boolean[] = [];
	const run = jobs.run;
	jobs.run = ((spec: any, work: any) => run(spec, (handle: any) => {
		const settle = handle.settle;
		handle.settle = async () => {
			settleAfterWrite.push(lateDone);
			await settle();
		};
		return work(handle);
	})) as typeof run;
	let followerDone = false;
	let hostId = 0;
	let pending: Promise<any> | undefined;
	let follower: Promise<any> | undefined;
	let slow: Promise<any> | undefined;
	const writer = createWriteToolDefinition(dir);
	const descriptor = (name: string) => ({ name, description: name, parameters: { type: "object", properties: {} } });
	createCodemodeExtension({ models: false })({
		registerTool(tool: any) { definition = tool; },
		getAllTools() { return []; }, appendEntry() {}, getSettings() { return {}; },
	} as any);
	const execute = definition.execute;
	definition = { ...definition, async execute(...args: any[]) {
		const result = await execute(...args);
		assert.equal(result.isError, true);
		assert.equal(lateDone, false, "stock definition returns while cancelled file work still runs");
		returned.resolve();
		return result;
	} };
	const context: any = {
		cwd: dir,
		tools: [descriptor("slow"), descriptor("fail")],
		sessionManager: { getBranch() { return []; } },
		executeTool(name: string, _args: any, { signal }: any) {
			const id = `cm/${++hostId}`;
			const work = nested.schedule(id, { kind: "mutate", keys: [join(dir, name === "slow" ? "late.txt" : "fail.txt")] }, async () => {
				if (name === "fail") {
					await started.promise;
					await failNow.promise;
					return { toolCall: { id }, isError: true, result: { content: [{ type: "text", text: "intentional failure" }] } };
				}
				signal.addEventListener("abort", () => aborted.resolve(), { once: true });
				started.resolve();
				await release.promise;
				// A running file tool may finish writing despite cancellation of its host call.
				const result = await writer.execute(id, { path: "late.txt", content: "late change" }, undefined, undefined, context);
				lateDone = true;
				return { toolCall: { id }, isError: false, result };
			});
			if (name === "slow") slow = work;
			return work;
		},
	};
	try {
		const tool = groupCodemode(definition, nested, jobs);
		const owner = new AbortController();
		pending = tool.execute("cm", { code: "await Promise.all([tools.slow({}), tools.fail({})]);" }, owner.signal, undefined, context);
		follower = nested.schedule("after", { kind: "mutate", keys: [join(dir, "follower.txt")] }, async () => {
			followerDone = true;
			return writer.execute("after", { path: "follower.txt", content: "after" }, undefined, undefined, context);
		});
		await within(started.promise);
		for (const fire of timers.splice(0)) fire();
		const handoff: any = await within(pending);
		assert.equal(handoff.details.job.id, "job#1");
		assert.equal(handoff.details.job.state, "running");
		assert.equal(handoff.details.job.holds, undefined, "codemode does not invent file holds");
		failNow.resolve();
		await within(returned.promise);
		await within(aborted.promise);
		owner.abort();
		assert.equal(jobs.status(["job#1"], 1)[0].state, "running", "handed-off work belongs to its session");
		assert.equal(followerDone, false, "same-response follower waits for the nested drain");
		// A later response is detached, even though the nested file operation has not finished.
		await within(nested.schedule("later", { kind: "mutate", keys: [join(dir, "free.txt")] }, async () => undefined));
		assert.equal(lateDone, false);
		release.resolve();
		await within(jobs.settled("job#1"));
		await within(follower);
		const done: any = jobs.status(["job#1"], 1)[0];
		assert.equal(done.state, "failed");
		assert.deepEqual(settleAfterWrite, [true], "the final scan starts after the nested write finishes");
		assert.deepEqual(done.effects.created, ["late.txt"]);
		assert.deepEqual(done.effects.changed, []);
		assert.deepEqual(done.effects.yours, []);
		assert.deepEqual(done.effects.deleted, []);
		assert.deepEqual(done.effects.alongside, []);
		assert.equal(done.effects.errors, undefined);
		assert.equal(done.holds, undefined);
		assert.equal(await readFile(join(dir, "late.txt"), "utf8"), "late change");
		assert.equal(await readFile(join(dir, "follower.txt"), "utf8"), "after");
		assert.equal(jobs.size, 1, "nested file work does not become a separate job");
	} finally {
		failNow.resolve();
		release.resolve();
		for (const fire of timers.splice(0)) fire();
		await Promise.allSettled([pending, follower, slow].filter(Boolean));
		if (jobs.size) await jobs.settled("job#1");
		jobs.dispose();
		await rm(dir, { recursive: true, force: true });
	}
});
