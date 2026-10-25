// Notification waits of the job registry (jobs.ts `watch`): the callback contract. A wait that is not ready returns
// `waiting` with `terminate` at once and the one notification follows by events (a job ending, readiness, the
// deadline), never by polling. Slow commands wait for gate files, so nothing depends on how fast the host is.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { createTools } from "../../../extensions/RQW-tools/index.ts";
import { createJobs, type JobNotification } from "../../../extensions/RQW-tools/jobs.ts";
import { createNestedBarrier } from "../../../extensions/RQW-tools/nested.ts";

const THRESHOLD = 150;
let root: string;
let counter = 0;
before(async () => { root = await mkdtemp(join(tmpdir(), "rqw-notify-")); });
const registries: { dispose(): void }[] = [];
const completions: Promise<void>[] = [];
after(async () => {
	for (const jobs of registries) jobs.dispose();
	// Disposal signals abort; wait for the processes to release their working directories.
	await Promise.all(completions);
	await rm(root, { recursive: true, force: true });
});

async function fresh(withNotify = true) {
	const dir = join(root, `t${counter++}`);
	await mkdir(dir, { recursive: true });
	const notes: JobNotification[] = [];
	const jobs = createJobs({ backgroundAfterMs: THRESHOLD, ...(withNotify ? { notify: (n: JobNotification) => void notes.push(n) } : {}) });
	registries.push(jobs);
	const tools = Object.fromEntries(createTools(dir, () => ({}), createNestedBarrier(), { jobs }).map((t) => [t.name, t as any]));
	return { dir, jobs, tools, notes };
}

const ctx = (cwd: string) => ({ cwd, sessionManager: { getSessionId: () => "n", getSessionFile: () => undefined } });
let ids = 0;
const call = (tool: any, params: any, cwd: string, id = `c${ids++}`) => tool.execute(id, params, undefined, undefined, ctx(cwd));
const body = (result: any) => JSON.parse(result.content[0].text);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** A command that waits for its own gate file, prints `out`, then ends. */
const gated = (gate: string, out: string) => `printf 'started\\n'; while [ ! -f ${gate} ]; do sleep 0.02; done; printf ${out}`;
const open = (dir: string, gate = "gate") => writeFile(join(dir, gate), "");
async function until(what: string, ok: () => boolean) {
	const end = Date.now() + 10000;
	while (!ok()) {
		if (Date.now() > end) assert.fail(`timed out waiting for ${what}`);
		await sleep(10);
	}
}
async function background(f: Awaited<ReturnType<typeof fresh>>, command: string) {
	const id = (await call(f.tools.bash, { command }, f.dir)).details.job.id as string;
	completions.push(f.jobs.settled(id));
	return id;
}
async function running(f: Awaited<ReturnType<typeof fresh>>, id: string) {
	// Handoff may precede the start snapshot; output proves the gated command has begun.
	const ready = body(await call(f.tools.job, { action: "wait", ids: [id], until: "started", blocking: true }, f.dir));
	assert.equal(ready.reason, "match");
	assert.equal(ready.statuses[0].state, "running");
}

describe("notification wait", () => {
	it("returns waiting at once with terminate; one notification follows when the job ends, same body as a blocking wait", async () => {
		const f = await fresh();
		const id = await background(f, gated("gate", "end"));
		await running(f, id);
		const started = performance.now();
		const waiting = await call(f.tools.job, { action: "wait", ids: [id], timeout_ms: 60000 }, f.dir);
		assert.ok(performance.now() - started < 1000);
		assert.equal(waiting.terminate, true);
		assert.equal(body(waiting).reason, "waiting");
		assert.equal(body(waiting).statuses[0].state, "running");
		assert.equal(f.notes.length, 0);
		await open(f.dir);
		await until("the notification", () => f.notes.length === 1);
		await sleep(400);
		assert.equal(f.notes.length, 1, "exactly one notification");
		const [n] = f.notes;
		assert.equal(JSON.parse(n.text).reason, "exit");
		assert.equal((n.details as any).results[0].result, "started\nend");
		assert.ok(n.id.length > 0);
		// The model has the result now: a repeated wait answers at once and a new notification is not registered.
		const again = await call(f.tools.job, { action: "wait", ids: [id] }, f.dir);
		assert.equal(again.terminate, undefined);
		assert.equal(body(again).results[0].exit_code, 0);
	});

	it("a job that already ended answers at once, without a notification or terminate", async () => {
		const f = await fresh();
		const id = await background(f, gated("gate", "x"));
		await open(f.dir);
		await f.jobs.settled(id);
		const result = await call(f.tools.job, { action: "wait", ids: [id] }, f.dir);
		assert.equal(result.terminate, undefined);
		assert.equal(body(result).reason, "exit");
		await sleep(100);
		assert.equal(f.notes.length, 0);
	});

	it("the deadline sends one timeout notification and the job keeps running", async () => {
		const f = await fresh();
		const id = await background(f, gated("gate", "late"));
		await running(f, id);
		await call(f.tools.job, { action: "wait", ids: [id], timeout_ms: 100 }, f.dir);
		await until("the deadline notification", () => f.notes.length === 1);
		assert.equal(JSON.parse(f.notes[0].text).reason, "timeout");
		assert.equal(JSON.parse(f.notes[0].text).statuses[0].state, "running");
		await open(f.dir);
		await f.jobs.settled(id);
		await sleep(300);
		assert.equal(f.notes.length, 1, "the finished wait does not announce the later exit");
	});

	it("readiness (until) sends one match notification while the job runs", async () => {
		const f = await fresh();
		const id = await background(f, "printf 'booting\\n'; sleep 0.3; printf 'ready on 3000\\n'; while [ ! -f gate ]; do sleep 0.02; done");
		await call(f.tools.job, { action: "wait", ids: [id], timeout_ms: 60000, until: "ready on \\d+" }, f.dir);
		await until("the match notification", () => f.notes.length === 1);
		const note = JSON.parse(f.notes[0].text);
		assert.equal(note.reason, "match");
		assert.equal(note.matched[0].id, id);
		await open(f.dir);
	});

	it("jobs that end within 250 ms of each other share one notification; a later one is not announced", async () => {
		const f = await fresh();
		const a = await background(f, gated("ga", "A"));
		const b = await background(f, gated("gb", "B"));
		const c = await background(f, gated("gc", "C"));
		await call(f.tools.job, { action: "wait", ids: [a, b, c], timeout_ms: 60000 }, f.dir);
		await open(f.dir, "ga");
		await open(f.dir, "gb");
		await until("the notification", () => f.notes.length === 1);
		const note = JSON.parse(f.notes[0].text);
		assert.deepEqual(note.results.map((r: any) => r.id).sort(), [a, b].sort());
		assert.deepEqual(note.statuses.map((r: any) => r.id), [c]);
		await open(f.dir, "gc");
		await f.jobs.settled(c);
		await sleep(400);
		assert.equal(f.notes.length, 1);
	});

	it("an end the model already saw through status is not announced; the waiter keeps watching the others", async () => {
		const f = await fresh();
		const a = await background(f, gated("ga", "A"));
		const b = await background(f, gated("gb", "B"));
		await call(f.tools.job, { action: "wait", ids: [a, b], timeout_ms: 60000 }, f.dir);
		await open(f.dir, "ga");
		await f.jobs.settled(a);
		await call(f.tools.job, { action: "status", ids: [a] }, f.dir); // inside the 250 ms window
		await sleep(400);
		assert.equal(f.notes.length, 0, "A was shown; B still runs");
		await open(f.dir, "gb");
		await until("the notification for B", () => f.notes.length === 1);
		assert.deepEqual(JSON.parse(f.notes[0].text).results.map((r: any) => r.id), [b]);
	});

	it("kill shows the job: no notification follows", async () => {
		const f = await fresh();
		const id = await background(f, "sleep 30");
		await call(f.tools.job, { action: "wait", ids: [id], timeout_ms: 60000 }, f.dir);
		assert.equal(body(await call(f.tools.job, { action: "kill", id }, f.dir)).state, "killed");
		await sleep(400);
		assert.equal(f.notes.length, 0);
	});

	it("a newer wait on the same job replaces the older one: one notification", async () => {
		const f = await fresh();
		const id = await background(f, gated("gate", "x"));
		await call(f.tools.job, { action: "wait", ids: [id], timeout_ms: 60000 }, f.dir);
		await call(f.tools.job, { action: "wait", ids: [id], timeout_ms: 60000 }, f.dir);
		await open(f.dir);
		await until("the notification", () => f.notes.length === 1);
		await sleep(400);
		assert.equal(f.notes.length, 1);
	});

	it("dispose cancels pending waits silently", async () => {
		const f = await fresh();
		const id = await background(f, "sleep 30");
		await call(f.tools.job, { action: "wait", ids: [id], timeout_ms: 200 }, f.dir);
		f.tools.job.jobs.dispose();
		await sleep(500);
		assert.equal(f.notes.length, 0);
	});

	it("blocks as before: with blocking: true, inside a codemode script, without a callback, and after setNotify(undefined)", async () => {
		const f = await fresh();
		const id = await background(f, gated("gate", "end"));
		const blocked = call(f.tools.job, { action: "wait", ids: [id], timeout_ms: 60000, blocking: true }, f.dir);
		const nested = call(f.tools.job, { action: "wait", ids: [id], timeout_ms: 60000 }, f.dir, "script/1");
		await sleep(150);
		await open(f.dir);
		for (const result of await Promise.all([blocked, nested])) {
			assert.equal(result.terminate, undefined);
			assert.equal(body(result).reason, "exit");
		}
		assert.equal(f.notes.length, 0);

		const bare = await fresh(false);
		const id2 = await background(bare, "sleep 30");
		const result = await call(bare.tools.job, { action: "wait", ids: [id2], timeout_ms: 100 }, bare.dir);
		assert.equal(body(result).reason, "timeout");
		assert.equal(result.terminate, undefined);

		const off = await fresh();
		off.jobs.setNotify(undefined);
		const id3 = await background(off, "sleep 30");
		assert.equal(body(await call(off.tools.job, { action: "wait", ids: [id3], timeout_ms: 100 }, off.dir)).reason, "timeout");
	});
});
