// Background jobs (DECISIONS.md, Tools: background jobs): a call still running after the threshold returns as job#N
// and keeps running; the job tool waits for, checks and kills it. The threshold is injected (milliseconds instead of
// the product's 12 s); slow commands wait for a gate file, so nothing depends on how fast the host is.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { createBashToolDefinition } from "@earendil-works/pi-coding-agent";
import { groupCodemode, CODEMODE_BACKGROUND_LINE } from "../codemode.ts";
import { createTools } from "../index.ts";
import { createJobs } from "../jobs.ts";
import { codemodeInUse, keptOwnWrites } from "../ledger.ts";
import { createNestedBarrier } from "../nested.ts";

const THRESHOLD = 300;
const WIN = process.platform === "win32";

let root: string;
let counter = 0;
before(async () => { root = await mkdtemp(join(tmpdir(), "rqw-background-")); });
const registries: { dispose(): void }[] = [];
after(async () => {
	for (const jobs of registries) jobs.dispose();
	await rm(root, { recursive: true, force: true });
});

async function fresh() {
	const dir = join(root, `t${counter++}`);
	await mkdir(dir, { recursive: true });
	const jobs = createJobs({ backgroundAfterMs: THRESHOLD });
	registries.push(jobs);
	const tools = Object.fromEntries(createTools(dir, () => ({}), createNestedBarrier(), { jobs }).map((t) => [t.name, t as any]));
	return { dir, jobs, tools };
}

const ctx = (cwd: string) => ({ cwd, sessionManager: { getSessionId: () => "bg", getSessionFile: () => undefined } });
const text = (result: any) => result.content.map((c: any) => c.text).join("\n");
let ids = 0;
const call = (tool: any, params: any, cwd: string, signal?: AbortSignal, id = `c${ids++}`) => tool.execute(id, params, signal, undefined, ctx(cwd));
// The first block is the JSON; a piggyback note (N1) may follow as a second block.
const job = async (tools: any, dir: string, params: any) => JSON.parse((await call(tools.job, params, dir)).content[0].text);
/** Waits for a gate file, then runs `then`. */
const gated = (then: string) => `printf 'started\\n'; while [ ! -f gate ]; do sleep 0.02; done; ${then}`;
const open = (dir: string) => writeFile(join(dir, "gate"), "");

describe("background jobs", () => {
	it("a call that settles before the threshold returns exactly the stock result and creates no job", async () => {
		const { dir, tools } = await fresh();
		for (const command of ["printf OK", "printf FAIL; exit 3"]) {
			const stock = await createBashToolDefinition(dir).execute("s", { command }, undefined, undefined, ctx(dir) as any);
			const ours = await call(tools.bash, { command }, dir);
			const { wall_time_seconds: a, ...stockRest } = stock.structuredContent as any;
			const { wall_time_seconds: b, ...oursRest } = ours.structuredContent;
			assert.deepEqual({ ...ours, structuredContent: oursRest }, { ...stock, structuredContent: stockRest }, command);
		}
		assert.deepEqual((await job(tools, dir, { action: "status" })).statuses, []);
	});

	it("a slow command returns as job#1 with the output so far and a log, keeps running and ends through wait", async () => {
		const { dir, tools } = await fresh();
		const result = await call(tools.bash, { command: gated("printf 'done\\n'; exit 3") }, dir);
		const handoff = text(result);
		assert.match(handoff, /^job#1 \(bash\) is still running after 0.3 s and continues in the background\./);
		assert.match(handoff, /started/);
		assert.equal(result.isError, undefined);
		const log = result.details.job.output_path;
		assert.ok(existsSync(log), log);
		assert.equal((await job(tools, dir, { action: "status", ids: ["job#1"] })).statuses[0].state, "running");
		await open(dir);
		const waited = await job(tools, dir, { action: "wait", ids: ["job#1"], timeout_ms: 20000 });
		assert.equal(waited.reason, "exit");
		const [done] = waited.results;
		assert.equal(done.state, "exited");
		assert.equal(done.exit_code, 3);
		assert.match(done.result, /^started\ndone\n+Command exited with code 3$/);
		assert.match(done.tail, /done/);
		// The log closes after the job ends.
		for (let i = 0; i < 50 && !(await readFile(log, "utf8")).includes("done"); i++) await new Promise((r) => setTimeout(r, 20));
		assert.equal(await readFile(log, "utf8"), "started\ndone\n");
		// An ended job answers wait at once, as often as asked.
		assert.equal((await job(tools, dir, { action: "wait", ids: ["job#1"] })).results[0].exit_code, 3);
	});

	it("wait returns at its deadline with every status; the job keeps running; kill stops the process tree", async () => {
		const { dir, tools } = await fresh();
		await call(tools.bash, { command: "sleep 30 & echo $! > child; printf 'started\\n'; wait" }, dir);
		const waited = await job(tools, dir, { action: "wait", ids: ["job#1"], timeout_ms: 50, lines: null });
		assert.equal(waited.reason, "timeout");
		assert.equal(waited.timed_out, true);
		assert.equal(waited.statuses[0].state, "running");
		const killed = await job(tools, dir, { action: "kill", id: "job#1" });
		assert.equal(killed.state, "killed");
		if (!WIN) {
			const child = Number((await readFile(join(dir, "child"), "utf8")).trim());
			let alive = true;
			for (let i = 0; i < 100 && alive; i++) {
				try { process.kill(child, 0); await new Promise((r) => setTimeout(r, 20)); } catch { alive = false; }
			}
			assert.equal(alive, false, "the child of the shell is gone");
		}
		assert.equal((await job(tools, dir, { action: "kill", id: "job#1" })).state, "killed", "kill of an ended job is a no-op");
	});

	it("a command whose timeout ends it within a second after the threshold stays in the foreground", async () => {
		const { dir, tools } = await fresh();
		// Threshold 0.3 s, timeout 1 s: <= threshold + 1 s.
		await assert.rejects(call(tools.bash, { command: "sleep 30", timeout: 1 }, dir), /Command timed out after 1 seconds/);
		assert.deepEqual((await job(tools, dir, { action: "status" })).statuses, []);
	});

	it("the timeout parameter still kills the command in the background", async () => {
		const { dir, tools } = await fresh();
		await call(tools.bash, { command: "printf x; sleep 30", timeout: 2 }, dir);
		const waited = await job(tools, dir, { action: "wait", ids: ["job#1"], timeout_ms: 20000 });
		assert.equal(waited.results[0].state, "timed_out");
		assert.match(waited.results[0].result, /Command timed out after 2 seconds/);
	});

	it("Esc before the threshold aborts as now; Esc after the handoff, in this run or a later one, kills the jobs", async () => {
		const { dir, tools } = await fresh();
		const before = new AbortController();
		const pending = call(tools.bash, { command: "sleep 30" }, dir, before.signal);
		setTimeout(() => before.abort(), 30);
		await assert.rejects(pending, /Command aborted/);
		assert.deepEqual((await job(tools, dir, { action: "status" })).statuses, []);

		const run1 = new AbortController();
		await call(tools.bash, { command: "sleep 30" }, dir, run1.signal);
		run1.abort();
		const first = await job(tools, dir, { action: "wait", ids: ["job#1"], timeout_ms: 20000 });
		assert.equal(first.results[0].state, "killed");

		// A job of an earlier run dies when a later run that used a tool is aborted.
		await call(tools.bash, { command: "sleep 30" }, dir, new AbortController().signal);
		const run3 = new AbortController();
		await call(tools.read, { path: "nothing-here" }, dir, run3.signal).catch(() => {});
		run3.abort();
		const second = await job(tools, dir, { action: "wait", ids: ["job#2"], timeout_ms: 20000 });
		assert.equal(second.results[0].state, "killed");
	});

	it("calls of one response keep their order: the next one becomes a queued job and runs after the first ends", async () => {
		const { dir, tools } = await fresh();
		const first = call(tools.bash, { command: gated("printf one") }, dir);
		const second = call(tools.bash, { command: "test -f gate && printf ordered" }, dir);
		const edit = call(tools.write, { path: "out.txt", content: "after" }, dir);
		const [a, b, c] = await Promise.all([first, second, edit]);
		assert.match(text(a), /^job#\d \(bash\) is still running/);
		assert.match(text(b), /^job#\d \(bash\) is still queued behind earlier calls/);
		assert.match(text(c), /^job#\d \(write\) is still queued behind earlier calls/);
		const ids = [a, b, c].map((r) => r.details.job.id);
		assert.deepEqual((await job(tools, dir, { action: "status", ids })).statuses.map((s: any) => s.state), ["running", "queued", "queued"]);
		assert.ok(!existsSync(join(dir, "out.txt")), "the write waits for the bash calls before it");
		await open(dir);
		const second$ = await job(tools, dir, { action: "wait", ids: [ids[1]], timeout_ms: 20000 });
		assert.equal(second$.results[0].result, "ordered");
		const third = await job(tools, dir, { action: "wait", ids: [ids[2]], timeout_ms: 20000 });
		assert.equal(third.results[0].state, "exited");
		assert.equal(await readFile(join(dir, "out.txt"), "utf8"), "after");
	});

	it("kill cancels a queued call at once; it never runs", async () => {
		const { dir, tools } = await fresh();
		const [a, b] = await Promise.all([
			call(tools.bash, { command: gated("true") }, dir),
			call(tools.write, { path: "never.txt", content: "x" }, dir),
		]);
		const queued = b.details.job.id;
		assert.equal((await job(tools, dir, { action: "kill", id: queued })).state, "killed");
		await open(dir);
		await job(tools, dir, { action: "wait", ids: [a.details.job.id], timeout_ms: 20000 });
		await new Promise((r) => setTimeout(r, 100));
		assert.ok(!existsSync(join(dir, "never.txt")));
	});

	it("wait returns a call queued behind the first job together with it", async () => {
		const { dir, tools } = await fresh();
		await Promise.all([call(tools.bash, { command: gated("printf build") }, dir), call(tools.read, { path: "nothing.txt" }, dir)]);
		await open(dir);
		const result = await job(tools, dir, { action: "wait", ids: ["job#1", "job#2"], timeout_ms: 20000 });
		assert.deepEqual(result.results.map((r: any) => r.id), ["job#1", "job#2"]);
		assert.deepEqual(result.statuses, []);
	});

	it("wait with two ids returns at the first exit, with the other's status", async () => {
		const { dir, tools } = await fresh();
		await call(tools.bash, { command: "sleep 30" }, dir);
		await call(tools.bash, { command: gated("printf two") }, dir, undefined);
		// The second call waited behind the first: it is queued. Kill the first so the second runs.
		await job(tools, dir, { action: "kill", id: "job#1" });
		const waiting = call(tools.job, { action: "wait", ids: ["job#2", "job#1"], timeout_ms: 20000 }, dir);
		const result = JSON.parse(text(await waiting));
		assert.equal(result.reason, "exit");
		assert.deepEqual(result.results.map((r: any) => r.id), ["job#1"]);
		assert.deepEqual(result.statuses.map((r: any) => r.id), ["job#2"]);
		await open(dir);
		assert.equal((await job(tools, dir, { action: "wait", ids: ["job#2"], timeout_ms: 20000 })).results[0].result, "started\ntwo");
	});

	it("Esc during wait ends the wait and, as the caller abort, kills the jobs (D5)", async () => {
		const { dir, tools } = await fresh();
		await call(tools.bash, { command: "sleep 30" }, dir);
		const esc = new AbortController();
		const waiting = call(tools.job, { action: "wait", ids: ["job#1"], timeout_ms: 20000 }, dir, esc.signal);
		esc.abort();
		await assert.rejects(waiting);
		const after = await job(tools, dir, { action: "wait", ids: ["job#1"], timeout_ms: 20000 });
		assert.equal(after.results[0].state, "killed");
	});

	it("a call inside a codemode script never goes to the background", async () => {
		const { dir, tools } = await fresh();
		const result = await call(tools.bash, { command: "sleep 0.6; printf inner" }, dir, undefined, "script/1");
		assert.equal(text(result), "inner");
		assert.deepEqual((await job(tools, dir, { action: "status" })).statuses, []);
	});

	it("validates arguments; null means omitted; unknown ids fail", async () => {
		const { dir, tools } = await fresh();
		await assert.rejects(call(tools.job, { action: "wait", ids: ["job#9"] }, dir), /Unknown job id: job#9. Known: none/);
		await assert.rejects(call(tools.job, { action: "wait", ids: [] }, dir), /ids must be a nonempty array/);
		await assert.rejects(call(tools.job, { action: "wait", ids: null }, dir), /ids must be a nonempty array/);
		await assert.rejects(call(tools.job, { action: "status", lines: 0 }, dir), /lines must be an integer from 1 to 200/);
		await assert.rejects(call(tools.job, { action: "wait", ids: ["job#1"], timeout_ms: 0 }, dir), /timeout_ms must be/);
		await assert.rejects(call(tools.job, { action: "kill" }, dir), /id is required/);
		assert.deepEqual(JSON.parse(text(await call(tools.job, { action: "status", ids: null, lines: null }, dir))).statuses, []);
	});

	it("dispose (the caller's shutdown) kills running jobs and makes new calls start aborted", async () => {
		const { dir, tools } = await fresh();
		await call(tools.bash, { command: "sleep 30" }, dir);
		tools.job.jobs.dispose();
		const result = await job(tools, dir, { action: "wait", ids: ["job#1"], timeout_ms: 20000 });
		assert.equal(result.results[0].state, "killed");
		await assert.rejects(call(tools.bash, { command: "printf late" }, dir), /aborted/);
	});

	it("job ids continue above a number an earlier instance reported", async () => {
		const { dir, tools, jobs } = await fresh();
		jobs.seen(7);
		const result = await call(tools.bash, { command: "sleep 30" }, dir);
		assert.equal(result.details.job.id, "job#8");
		jobs.dispose();
	});
});

describe("D4: ordering with background jobs", () => {
	it("a call of a later response does not wait for a background bash job", async () => {
		const { dir, tools } = await fresh();
		await call(tools.bash, { command: gated("true") }, dir);
		// The next response: runs at once, while job#1 still runs.
		const later = await call(tools.bash, { command: "printf later" }, dir);
		assert.equal(text(later), "later");
		const edit = await call(tools.write, { path: "x.txt", content: "x" }, dir);
		assert.match(text(edit), /Successfully wrote/);
		assert.equal((await job(tools, dir, { action: "status", ids: ["job#1"] })).statuses[0].state, "running");
		await open(dir);
	});

	it("an edit queued behind a background job keeps its file: a later edit of it follows, other files do not wait", async () => {
		const { dir, tools } = await fresh();
		await writeFile(join(dir, "p.txt"), "one\n");
		const [, first] = await Promise.all([
			call(tools.bash, { command: gated("true") }, dir),
			call(tools.edit, { path: "p.txt", edits: [{ oldText: "one", newText: "two" }] }, dir),
		]);
		assert.match(text(first), /^job#2 \(edit\) is still queued/);
		// Later responses: an edit of another file runs; an edit of p.txt queues behind job#2 and goes to the background.
		assert.match(text(await call(tools.write, { path: "q.txt", content: "q" }, dir)), /Successfully wrote/);
		const second = await call(tools.edit, { path: "p.txt", edits: [{ oldText: "two", newText: "three" }] }, dir);
		assert.match(text(second), /^job#3 \(edit\) is still queued/);
		await open(dir);
		const done = await job(tools, dir, { action: "wait", ids: ["job#3"], timeout_ms: 20000 });
		assert.equal(done.results[0].state, "exited", done.results[0].result);
		assert.equal(await readFile(join(dir, "p.txt"), "utf8"), "three\n");
	});

	it("read/edit/write of a file changed while a job runs get a note; own edits and no running job give none", async () => {
		const { dir, tools } = await fresh();
		await writeFile(join(dir, "gen.txt"), "old\n");
		await writeFile(join(dir, "mine.txt"), "a\n");
		// No aging of the files: written right before the job, maybe in its first clock tick, they are still unchanged
		// (the job's start snapshot decides, not a time cutoff; CI Windows once showed the cutoff's false note).
		assert.doesNotMatch(text(await call(tools.read, { path: "gen.txt" }, dir)), /note:/, "no job, no note");
		// The job rewrites gen.txt after it went to the background, then keeps running.
		// Inside bash -c '...' the redirect is not visible to the footprint: no hold, the D4 note path.
		await call(tools.bash, { command: "bash -c 'sleep 0.5; printf new > gen.txt'; while [ ! -f gate ]; do sleep 0.02; done" }, dir);
		for (let i = 0; i < 100 && (await readFile(join(dir, "gen.txt"), "utf8")) !== "new"; i++) await new Promise((r) => setTimeout(r, 20));
		assert.match(text(await call(tools.read, { path: "gen.txt" }, dir)), /note: gen\.txt changed \d+ s ago outside your tools while job#1 \(bash -c .*\) runs; wait for job#1 if it writes this file\./);
		// The read showed the new version: writing over it is not a conflict.
		assert.doesNotMatch(text(await call(tools.write, { path: "gen.txt", content: "mine\n" }, dir)), /note:/);
		// After our own write the file is ours: no note until the job changes it again.
		assert.doesNotMatch(text(await call(tools.read, { path: "gen.txt" }, dir)), /note:/);
		const edited = await call(tools.edit, { path: "mine.txt", edits: [{ oldText: "a", newText: "b" }] }, dir);
		assert.doesNotMatch(text(edited), /note:/, "a file the job did not touch");
		await open(dir);
		await job(tools, dir, { action: "wait", ids: ["job#1"], timeout_ms: 20000 });
		await writeFile(join(dir, "gen.txt"), "outside\n");
		assert.doesNotMatch(text(await call(tools.read, { path: "gen.txt" }, dir)), /note:/, "no running job, no note");
	});
});

describe("FR-safe: holds, effects, write precondition, kill of followers, notes, wait until", () => {
	/** A fake `npm`/`git` in ./bin: `ci`/`install`/`commit` wait for the gate; a first `run dev` waits too (file `block`). */
	async function fakes(dir: string) {
		await mkdir(join(dir, "bin"), { recursive: true });
		await mkdir(join(dir, ".git"), { recursive: true });
		const wait = "while [ ! -f gate ]; do sleep 0.02; done";
		await writeFile(join(dir, "bin", "npm"), `#!/bin/sh\necho "npm $*"\ncase "$1" in\n  ci|install) ${wait}; echo installed > node_modules.txt;;\n  run) if [ -f block ]; then rm block; ${wait}; fi;;\nesac\n`, { mode: 0o755 });
		await writeFile(join(dir, "bin", "git"), `#!/bin/sh\necho "git $*"\n${wait}\n`, { mode: 0o755 });
	}
	const P = "PATH=\"$PWD/bin:$PATH\" ";

	it("R16: a later `npm test` waits for a background `npm ci` that holds the package folder; other work does not", async () => {
		const { dir, tools } = await fresh();
		await fakes(dir);
		const handoff = text(await call(tools.bash, { command: P + "npm ci" }, dir));
		assert.match(handoff, /^job#1 \(bash\) is still running/);
		assert.match(handoff, /holds: package folder \. \(later calls that change them wait for it\)/);
		assert.match(text(await call(tools.bash, { command: "printf free" }, dir)), /^free/, "unrelated bash runs");
		const queued = await call(tools.bash, { command: P + "npm test" }, dir);
		assert.match(text(queued), /^job#2 \(bash\) is still queued/);
		assert.match(text(queued), /waiting for: job#1 \(holds package folder \.\)/);
		await open(dir);
		const done = await job(tools, dir, { action: "wait", ids: ["job#2"], timeout_ms: 20000 });
		assert.equal(done.results[0].state, "exited");
		assert.match(done.results[0].result, /npm test/);
	});

	it("#8: a file written right before a job starts, untouched by it, gets no note and is not in its report", async () => {
		const { dir, tools } = await fresh();
		// Written immediately before the call, no artificial aging: same clock tick as the job's start is likely.
		await writeFile(join(dir, "fresh.txt"), "before\n");
		// The worst case of that tick, made deterministic: a file whose mtime is not before the job's start (a coarse or
		// skewed file system clock) though nobody touches it while the job runs. A time cutoff calls it changed.
		await writeFile(join(dir, "skewed.txt"), "before\n");
		const ahead = new Date(Date.now() + 5000);
		await utimes(join(dir, "skewed.txt"), ahead, ahead);
		await call(tools.bash, { command: gated("printf job > by-job.txt") }, dir);
		assert.doesNotMatch(text(await call(tools.read, { path: "fresh.txt" }, dir)), /note:/);
		assert.doesNotMatch(text(await call(tools.read, { path: "skewed.txt" }, dir)), /note:/);
		await open(dir);
		const done = await job(tools, dir, { action: "wait", ids: ["job#1"], timeout_ms: 20000 });
		const e = done.results[0].effects;
		assert.ok(![...e.created, ...e.changed].some((f: string) => f === "fresh.txt" || f === "skewed.txt"), JSON.stringify(e));
		assert.ok(e.created.includes("by-job.txt"), "a real concurrent write is still reported");
		assert.match(e.scanned, /snapshots took \d+ ms before the start and \d+ ms at the end/);
	});

	it("#3: killing a queued write releases its file at once; a later write of it runs while the predecessor still runs", async () => {
		const { dir, tools } = await fresh();
		await writeFile(join(dir, "p.txt"), "start\n");
		const [, queued] = await Promise.all([
			call(tools.bash, { command: gated("true") }, dir),
			call(tools.write, { path: "p.txt", content: "never\n" }, dir),
		]);
		assert.match(text(queued), /^job#2 \(write\) is still queued/);
		const later = await call(tools.write, { path: "p.txt", content: "later\n" }, dir);
		assert.match(text(later), /^job#3 \(write\) is still queued/);
		assert.equal((await job(tools, dir, { action: "kill", id: "job#2" })).state, "killed");
		const done = await job(tools, dir, { action: "wait", ids: ["job#3"], timeout_ms: 20000 });
		assert.equal(done.results[0].state, "exited", done.results[0].result);
		assert.equal((await job(tools, dir, { action: "status", ids: ["job#1"] })).statuses[0].state, "running", "the predecessor still runs");
		assert.equal(await readFile(join(dir, "p.txt"), "utf8"), "later\n");
		await open(dir);
		await job(tools, dir, { action: "wait", ids: ["job#1"], timeout_ms: 20000 });
		assert.equal(await readFile(join(dir, "p.txt"), "utf8"), "later\n", "the killed write never runs");
	});

	it("#4: bash inside a codemode script takes the process-wide claims: it waits for a background install and another session's commit", async () => {
		const { dir, tools } = await fresh();
		await fakes(dir);
		const otherJobs = createJobs({ backgroundAfterMs: THRESHOLD, label: "code_writer#2" });
		registries.push(otherJobs);
		const nested2 = createNestedBarrier();
		const other = Object.fromEntries(createTools(dir, () => ({}), nested2, { jobs: otherJobs }).map((t) => [t.name, t as any]));
		assert.match(text(await call(tools.bash, { command: P + "npm ci" }, dir)), /holds: package folder \./);
		assert.match(text(await call(tools.bash, { command: P + "git commit -m a" }, dir)), /holds: git index of \./);
		let tested = false;
		let committed = false;
		// Scripts of another session: their bash never goes to the background; it waits inside the script.
		const script1 = nested2.group("cmA", async () => {
			const r = await other.bash.execute("cmA/1", { command: P + "npm test" }, undefined, undefined, ctx(dir));
			tested = true;
			return r;
		});
		const script2 = nested2.group("cmB", async () => {
			const r = await other.bash.execute("cmB/1", { command: P + "git commit -m b" }, undefined, undefined, ctx(dir));
			committed = true;
			return r;
		});
		try {
			await new Promise((r) => setTimeout(r, THRESHOLD * 2));
			assert.equal(tested, false, "npm test in a script waits for the install");
			assert.equal(committed, false, "git commit in a script waits for the other session's commit");
		} finally {
			await open(dir);
		}
		assert.match(text(await script1), /npm test/);
		assert.match(text(await script2), /git commit -m b/);
	});

	it("#5: two sessions read one version and write together: the second write is refused, not silently overwriting", async () => {
		const { dir, tools } = await fresh();
		const otherJobs = createJobs({ backgroundAfterMs: THRESHOLD, label: "code_writer#2" });
		registries.push(otherJobs);
		const other = Object.fromEntries(createTools(dir, () => ({}), createNestedBarrier(), { jobs: otherJobs }).map((t) => [t.name, t as any]));
		await writeFile(join(dir, "s.ts"), "v1\n");
		await call(tools.read, { path: "s.ts" }, dir);
		await call(other.read, { path: "s.ts" }, dir);
		const results = await Promise.allSettled([
			call(tools.write, { path: "s.ts", content: "main\n" }, dir),
			call(other.write, { path: "s.ts", content: "code writer, longer\n" }, dir),
		]);
		assert.equal(results[0].status, "fulfilled");
		assert.equal(results[1].status, "rejected");
		assert.match(String((results[1] as PromiseRejectedResult).reason), /s\.ts changed after you last read it \(by main \(write/);
		assert.equal(await readFile(join(dir, "s.ts"), "utf8"), "main\n");
	});

	it("#6: a read through a symlink and a write of the real file by another session: the write through the link is refused", async () => {
		const { dir, tools } = await fresh();
		const otherJobs = createJobs({ backgroundAfterMs: THRESHOLD, label: "code_writer#2" });
		registries.push(otherJobs);
		const other = Object.fromEntries(createTools(dir, () => ({}), createNestedBarrier(), { jobs: otherJobs }).map((t) => [t.name, t as any]));
		await writeFile(join(dir, "Real.ts"), "v1\n");
		try { await symlink(join(dir, "Real.ts"), join(dir, "alias.ts")); } catch (error) { if (WIN) return; throw error; }
		await call(tools.read, { path: "alias.ts" }, dir);
		await call(other.write, { path: "Real.ts", content: "v2 from the other session\n" }, dir);
		await assert.rejects(call(tools.write, { path: "alias.ts", content: "main\n" }, dir), /alias\.ts changed after you last read it \(by code_writer#2/);
		// Another case spelling on a case-insensitive volume is the same file too.
		if (existsSync(join(dir, "real.ts"))) {
			await call(tools.read, { path: "real.ts" }, dir);
			await call(other.write, { path: "Real.ts", content: "v3\n" }, dir);
			await assert.rejects(call(tools.write, { path: "REAL.ts", content: "main\n" }, dir), /changed after you last read it \(by code_writer#2/);
		}
	});

	it("R2-1: a multi-file write with one failing file records the written ones: the next own write is not refused", async () => {
		const { dir, tools } = await fresh();
		await writeFile(join(dir, "ok.txt"), "v1\n");
		await mkdir(join(dir, "adir"));
		await call(tools.read, { path: "ok.txt" }, dir);
		const partial = await call(tools.write, { files: [{ path: "ok.txt", content: "v2, ours\n" }, { path: "adir", content: "x" }] }, dir);
		assert.equal(partial.isError, true);
		assert.match(text(partial), /Written: ok\.txt/);
		assert.match(text(await call(tools.write, { path: "ok.txt", content: "v3, ours again\n" }, dir)), /Successfully wrote/);
		assert.doesNotMatch(text(await call(tools.read, { path: "ok.txt" }, dir)), /note:/, "our own write is not a foreign change");
	});

	it("R2-2: a read waits for the same-response bash that creates its fallback spelling, and keys the file it opened", async () => {
		const { dir, tools } = await fresh();
		const otherJobs = createJobs({ backgroundAfterMs: THRESHOLD, label: "code_writer#2" });
		registries.push(otherJobs);
		const other = Object.fromEntries(createTools(dir, () => ({}), createNestedBarrier(), { jobs: otherJobs }).map((t) => [t.name, t as any]));
		const curly = "it\u2019s.txt";
		await writeFile(join(dir, "source.txt"), "made by bash\n");
		// The redirect is inside `sh -c '...'`: the footprint does not see the write, so only the read records the file.
		// The bash waits for the gate, so both calls pass the threshold on every host: the read is queued behind the
		// bash whatever the host's speed, and its result comes through the job tool after the gate opens.
		const [bash, queued] = await Promise.all([
			call(tools.bash, { command: gated(`sh -c 'cat source.txt > "$0"' "${curly}"`) }, dir),
			call(tools.read, { path: "it's.txt" }, dir),
		]);
		assert.match(text(bash), /^job#1 \(bash\) is still running/);
		assert.match(text(queued), /^job#2 \(read\) is still queued behind earlier calls[^]*\nwaiting for: job#1\n/);
		assert.ok(!existsSync(join(dir, curly)), "the bash has not created the file yet");
		await open(dir);
		const read = (await job(tools, dir, { action: "wait", ids: ["job#2"], timeout_ms: 20000 })).results[0];
		assert.equal(read.state, "exited");
		assert.match(read.result, /made by bash/, "stock read opened the curly spelling");
		await call(other.edit, { path: curly, edits: [{ oldText: "made by bash", newText: "edited by the other session" }] }, dir);
		await assert.rejects(call(tools.write, { path: curly, content: "main\n" }, dir), /changed after you last read it \(by code_writer#2 \(edit/);
	});

	it("R2-3: an own edit later overwritten by another session stays in the job's report as yours and as overwritten", async () => {
		const { dir, tools, jobs } = await fresh();
		const otherJobs = createJobs({ backgroundAfterMs: THRESHOLD, label: "code_writer#2" });
		registries.push(otherJobs);
		const other = Object.fromEntries(createTools(dir, () => ({}), createNestedBarrier(), { jobs: otherJobs }).map((t) => [t.name, t as any]));
		await writeFile(join(dir, "A.ts"), "one\n");
		await call(tools.bash, { command: gated("true") }, dir);
		await call(tools.edit, { path: "A.ts", edits: [{ oldText: "one", newText: "main's edit" }] }, dir);
		assert.match(text(await call(other.write, { path: "A.ts", content: "the other session, blind\n" }, dir)), /Successfully wrote/);
		await open(dir);
		const e = (await job(tools, dir, { action: "wait", ids: ["job#1"], timeout_ms: 20000 })).results[0].effects;
		assert.deepEqual(e.yours, ["A.ts (edit)"], JSON.stringify(e));
		assert.deepEqual(e.overwritten, ["A.ts"]);
		assert.ok(e.changed.includes("A.ts (by code_writer#2, write)"), JSON.stringify(e));
		// The history was kept for this job only: nothing is kept once no job of the owner watches.
		assert.equal(keptOwnWrites(jobs.owner), undefined);
	});

	it("#7: a restarted session with the same label does not inherit what the old one read", async () => {
		const { dir } = await fresh();
		const make = () => {
			const jobs = createJobs({ backgroundAfterMs: THRESHOLD, label: "code_writer#2" });
			registries.push(jobs);
			return { jobs, tools: Object.fromEntries(createTools(dir, () => ({}), createNestedBarrier(), { jobs }).map((t) => [t.name, t as any])) };
		};
		await writeFile(join(dir, "k.ts"), "v1\n");
		const first = make();
		await call(first.tools.read, { path: "k.ts" }, dir);
		first.jobs.dispose();
		await writeFile(join(dir, "k.ts"), "changed outside, longer\n");
		const second = make();
		assert.match(text(await call(second.tools.write, { path: "k.ts", content: "new\n" }, dir)), /Successfully wrote/, "never read by this registry: no refusal");
		// Two live registries with one label (two reviews at once, both "review"): neither inherits the other's reads,
		// and one's write is another session's change for the other.
		const a = make();
		const b = make();
		await writeFile(join(dir, "m.ts"), "v1\n");
		await call(a.tools.read, { path: "m.ts" }, dir);
		await writeFile(join(dir, "m.ts"), "changed outside, longer\n");
		assert.match(text(await call(b.tools.write, { path: "m.ts", content: "b\n" }, dir)), /Successfully wrote/, "b never read m.ts");
		await call(b.tools.read, { path: "m.ts" }, dir);
		await call(a.tools.write, { path: "m.ts", content: "from a, longer\n" }, dir).catch(() => {});
		await call(a.tools.write, { path: "m.ts", content: "from a, longer\n" }, dir).catch(() => {});
		assert.match(text(await call(b.tools.read, { path: "m.ts" }, dir)), /note: m\.ts was changed by code_writer#2 \(write/);
	});

	it("R17: a `git commit` of a subagent waits for a background `git commit` of the main session in the same repository", async () => {
		const { dir, tools } = await fresh();
		await fakes(dir);
		const childJobs = createJobs({ backgroundAfterMs: THRESHOLD, label: "code_writer#2" });
		registries.push(childJobs);
		const child = Object.fromEntries(createTools(dir, () => ({}), createNestedBarrier(), { jobs: childJobs }).map((t) => [t.name, t as any]));
		assert.match(text(await call(tools.bash, { command: P + "git commit -m a" }, dir)), /holds: git index of \./);
		const second = await call(child.bash, { command: P + "git commit -m b" }, dir);
		assert.match(text(second), /^job#1 \(bash\) is still queued/);
		assert.match(text(second), /waiting for: job#1 \(holds git index of \.\)/);
		await open(dir);
		const done = await job(child, dir, { action: "wait", ids: ["job#1"], timeout_ms: 20000 });
		assert.equal(done.results[0].state, "exited");
	});

	it("P1: a write over a file changed since it was read is refused once; the identical retry overwrites", async () => {
		const { dir, tools } = await fresh();
		await writeFile(join(dir, "c.ts"), "one\n");
		await call(tools.read, { path: "c.ts" }, dir);
		await writeFile(join(dir, "c.ts"), "changed outside\n");
		const later = new Date(Date.now() + 5000);
		await utimes(join(dir, "c.ts"), later, later);
		await assert.rejects(call(tools.write, { path: "c.ts", content: "mine\n" }, dir), /c\.ts changed after you last read it \(outside your tools, .*\)\.\nNothing was written\. Read it again, or repeat this exact write to overwrite\./);
		assert.equal(await readFile(join(dir, "c.ts"), "utf8"), "changed outside\n");
		assert.match(text(await call(tools.write, { path: "c.ts", content: "mine\n" }, dir)), /Successfully wrote/);
		assert.equal(await readFile(join(dir, "c.ts"), "utf8"), "mine\n");
		// A file this session never read is written without a check.
		assert.match(text(await call(tools.write, { path: "new.ts", content: "x" }, dir)), /Successfully wrote/);
	});

	it("O1 + N1: the end report lists changed, own and deleted files; an unseen report adds one note to the next result", async () => {
		const { dir, tools } = await fresh();
		await writeFile(join(dir, "doomed.txt"), "x");
		await writeFile(join(dir, "mine.ts"), "a\n");
		await call(tools.bash, { command: gated("printf gen > gen.txt; rm doomed.txt") }, dir);
		await call(tools.edit, { path: "mine.ts", edits: [{ oldText: "a", newText: "b" }] }, dir);
		// A foreground bash redirect is the caller's own write too (live probe: an append by bash was reported as the job's).
		await call(tools.bash, { command: "printf more >> mine.log" }, dir);
		await open(dir);
		const status = await job(tools, dir, { action: "wait", ids: ["job#1"], timeout_ms: 20000 });
		const effects = status.results[0].effects;
		// The gate file is a change outside the tools too; both were created after the handoff.
		assert.deepEqual(effects.created.sort(), ["gate", "gen.txt"]);
		assert.deepEqual(effects.changed, []);
		assert.deepEqual(effects.yours.sort(), ["mine.log (bash)", "mine.ts (edit)"]);
		assert.deepEqual(effects.deleted, ["doomed.txt"]);
		assert.match(effects.scanned, /a walk without node_modules/);
	});

	it("a follower of the same response that writes right after the job ended is not in the job's report", async () => {
		const { dir, tools } = await fresh();
		await Promise.all([
			call(tools.bash, { command: gated("printf a > by-job.txt") }, dir),
			call(tools.bash, { command: "printf b > by-follower.txt" }, dir),
		]);
		await open(dir);
		const done = await job(tools, dir, { action: "wait", ids: ["job#1", "job#2"], timeout_ms: 20000 });
		const first = done.results.find((r: any) => r.id === "job#1");
		const listed = [...first.effects.created, ...first.effects.changed];
		assert.ok(listed.includes("by-job.txt"), JSON.stringify(first.effects));
		assert.ok(!listed.includes("by-follower.txt"), JSON.stringify(first.effects));
		assert.deepEqual(first.effects.alongside, [], "a follower queued behind it did not run alongside (live probe)");
	});

	it("O1: the report lists every file, with no cap; a killed job is still scanned", async () => {
		const { dir, tools } = await fresh();
		await call(tools.bash, { command: gated("for i in $(seq 1 75); do printf x > f$i.txt; done; sleep 30") }, dir);
		await new Promise((r) => setTimeout(r, 200));
		await open(dir);
		for (let i = 0; i < 250 && !existsSync(join(dir, "f75.txt")); i++) await new Promise((r) => setTimeout(r, 20));
		const killed = await job(tools, dir, { action: "kill", id: "job#1" });
		assert.equal(killed.state, "killed");
		const created = killed.effects.created.filter((f: string) => /^f\d+\.txt$/.test(f));
		assert.equal(created.length, 75, JSON.stringify(killed.effects));
		assert.ok(!killed.effects.created.some((f: string) => /more/.test(f)));
		assert.equal(killed.effects.errors, undefined);
	});

	it("N1: a pending note also goes into a top-level codemode result", async () => {
		const dir = join(root, `t${counter++}`);
		await mkdir(dir, { recursive: true });
		const jobs = createJobs({ backgroundAfterMs: THRESHOLD });
		registries.push(jobs);
		const nested = createNestedBarrier();
		const tools = Object.fromEntries(createTools(dir, () => ({}), nested, { jobs }).map((t) => [t.name, t as any]));
		await call(tools.bash, { command: gated("printf out > out.txt") }, dir);
		await new Promise((r) => setTimeout(r, 200));
		await open(dir);
		await jobs.settled("job#1");
		const script: any = groupCodemode({ name: "codemode", label: "codemode", description: "d", parameters: {},
			execute: async () => ({ content: [{ type: "text", text: "Script completed" }], details: {} }) } as any, nested, jobs);
		const result = await script.execute("cmN1", { code: "1" }, undefined, undefined, { cwd: dir });
		assert.match(text(result), /^Script completed\nnote: job#1 \(.*\) ended \(exit 0\); its report lists \d+ file changes?: job status job#1\.$/);
		const again = await script.execute("cmN2", { code: "1" }, undefined, undefined, { cwd: dir });
		assert.equal(text(again), "Script completed", "once");
	});

	it("N1: a job that ends unseen with effects adds exactly one note line to the next tool result", async () => {
		const { dir, tools, jobs } = await fresh();
		await writeFile(join(dir, "r.txt"), "r\n");
		await call(tools.bash, { command: gated("printf out > out.txt") }, dir);
		await new Promise((r) => setTimeout(r, 200));
		await open(dir);
		for (let i = 0; i < 250 && !existsSync(join(dir, "out.txt")); i++) await new Promise((r) => setTimeout(r, 20));
		await jobs.settled("job#1");
		const first = text(await call(tools.read, { path: "r.txt" }, dir));
		assert.match(first, /\nnote: job#1 \(printf 'started\\n'; .*\) ended \(exit 0\); its report lists 2 file changes: job status job#1\.$/);
		assert.doesNotMatch(text(await call(tools.read, { path: "r.txt" }, dir)), /note:/, "once");
	});

	it("K1: kill cancels the queued calls of the same response that depend on it; later calls are not cancelled", async () => {
		const { dir, tools } = await fresh();
		await writeFile(join(dir, "p.txt"), "one\n");
		const [, , third] = await Promise.all([
			call(tools.bash, { command: gated("true") }, dir),
			call(tools.bash, { command: "printf tests" }, dir),
			call(tools.edit, { path: "p.txt", edits: [{ oldText: "one", newText: "two" }] }, dir),
		]);
		assert.match(text(third), /^job#3 \(edit\) is still queued/);
		const later = await call(tools.write, { path: "p.txt", content: "later\n" }, dir);
		assert.match(text(later), /^job#4 \(write\) is still queued/);
		const killed = await job(tools, dir, { action: "kill", id: "job#1" });
		assert.equal(killed.state, "killed");
		assert.deepEqual(killed.cancelled_followers, ["job#2 (bash printf tests)", "job#3 (edit p.txt)"]);
		const done = await job(tools, dir, { action: "wait", ids: ["job#4"], timeout_ms: 20000 });
		assert.equal(done.results[0].state, "exited");
		assert.equal(await readFile(join(dir, "p.txt"), "utf8"), "later\n");
		const statuses = (await job(tools, dir, { action: "status", ids: ["job#2", "job#3"] })).statuses;
		assert.deepEqual(statuses.map((s: any) => s.state), ["killed", "killed"]);
	});

	it("a server started while a job serves the same port gets a note", async () => {
		const { dir, tools } = await fresh();
		await fakes(dir);
		await writeFile(join(dir, "block"), "");
		assert.match(text(await call(tools.bash, { command: P + "npm run dev -- --port 4321" }, dir)), /^job#1 \(bash\) is still running/);
		// The second one runs in the foreground or goes to the background on a slow host: the note is there either way.
		const second = text(await call(tools.bash, { command: P + "npm run dev -- --port 4321" }, dir));
		assert.match(second, /note: job#1 already serves port 4321\./);
		// One that goes to the background carries the note in its handoff.
		await writeFile(join(dir, "block"), "");
		const third = text(await call(tools.bash, { command: P + "npm run dev -- --port 4321" }, dir));
		assert.match(third, /is still running[\s\S]*\nnote: job#1 already serves port 4321\.$/);
		await open(dir);
	});

	it("W1: wait returns when the output matches `until`, with the matching line; the job keeps running", async () => {
		const { dir, tools } = await fresh();
		await call(tools.bash, { command: "printf 'booting\\n'; sleep 0.3; printf 'listening on 3000\\n'; " + gated("true") }, dir);
		const waited = await job(tools, dir, { action: "wait", ids: ["job#1"], until: "listening on \\d+", timeout_ms: 20000 });
		assert.equal(waited.reason, "match");
		assert.deepEqual(waited.matched, [{ id: "job#1", line: "listening on 3000" }]);
		assert.equal(waited.statuses[0].state, "running");
		await assert.rejects(call(tools.job, { action: "wait", ids: ["job#1"], until: "(" }, dir), /until is not a valid regular expression/);
		// A leading (?i), as models write it from PCRE habits, ignores case.
		const again = await job(tools, dir, { action: "wait", ids: ["job#1"], until: "(?i)LISTENING", timeout_ms: 20000 });
		assert.equal(again.reason, "match");
		await open(dir);
	});
});

describe("codemode as one background job", () => {
	const fake = (gate: Promise<void>, seen: { signal?: AbortSignal }) => ({
		name: "codemode",
		label: "codemode",
		description: "stock",
		parameters: {},
		prepareLoadout: () => ({ descriptions: { codemode: "loaded" } }),
		execute: async (_id: string, _params: any, signal: AbortSignal, onUpdate: any) => {
			seen.signal = signal;
			onUpdate?.({ content: [{ type: "text", text: "partial" }] });
			await Promise.race([gate, new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("Script aborted"))))]);
			return { content: [{ type: "text", text: "Script completed" }], details: {} };
		},
	});

	it("a long script returns as a job, does not hold later calls once ended, and ends through wait; kill aborts it", async () => {
		const jobs = createJobs({ backgroundAfterMs: THRESHOLD });
		registries.push(jobs);
		const nested = createNestedBarrier();
		let release!: () => void;
		const seen: { signal?: AbortSignal } = {};
		const tool: any = groupCodemode(fake(new Promise((r) => { release = r; }), seen) as any, nested, jobs);
		assert.ok(tool.description.endsWith(CODEMODE_BACKGROUND_LINE));
		assert.ok(tool.prepareLoadout({}).descriptions.codemode.endsWith(CODEMODE_BACKGROUND_LINE));
		const result = await tool.execute("cm1", { code: "await tools.bash({command: 'make'})" }, undefined, undefined, {});
		assert.match(text(result), /^job#1 \(codemode\) is still running/);
		assert.match(text(result), /command: await tools\.bash/);
		assert.match(text(result), /partial/);
		release();
		const waited = await jobs.wait(["job#1"], 20000, 20);
		assert.equal(waited.results![0].result, "Script completed");

		let never!: () => void;
		const seen2: { signal?: AbortSignal } = {};
		const tool2: any = groupCodemode(fake(new Promise((r) => { never = r; }), seen2) as any, nested, jobs);
		await tool2.execute("cm2", { code: "x" }, undefined, undefined, {});
		const killed = await jobs.kill("job#2");
		assert.equal(killed.state, "killed");
		assert.equal(seen2.signal?.aborted, true);
		never();
	});

	it("S1: a third script waits for a free codemode worker as a queued job, then runs", async () => {
		const jobs = createJobs({ backgroundAfterMs: THRESHOLD });
		registries.push(jobs);
		const nested = createNestedBarrier();
		assert.equal(codemodeInUse(), 0);
		const gates = [0, 1, 2].map(() => Promise.withResolvers<void>());
		const tools = gates.map((g) => groupCodemode(fake(g.promise, {}) as any, nested, jobs) as any);
		// Three responses in a row: each earlier script detached at its handoff, so only the worker slots hold the third.
		const results: any[] = [];
		for (const [i, t] of tools.entries()) results.push(await t.execute(`s${i}`, { code: `script ${i}` }, undefined, undefined, {}));
		assert.match(text(results[0]), /^job#1 \(codemode\) is still running/);
		assert.match(text(results[1]), /It holds one of the 2 codemode workers of this process \(2 in use\)\./);
		assert.match(text(results[2]), /^job#3 \(codemode\) is still queued/);
		assert.match(text(results[2]), /waiting for: a free codemode worker \(2 of 2 in use\)/);
		assert.doesNotMatch(text(results[2]), /It holds one of the/);
		gates[0].resolve();
		await jobs.settled("job#1");
		gates[2].resolve();
		const third = await jobs.wait(["job#3"], 20000, 20);
		assert.equal(third.results![0].result, "Script completed");
		gates[1].resolve();
		await jobs.settled("job#2");
		assert.equal(codemodeInUse(), 0);
	});

	it("S1 across sessions: a subagent's offered codemode is its own barrier's job and shares the worker slots with main; a killed queued child script never runs", async () => {
		// Main: two scripts as RQW-tools' main session runs them (takeOverBuiltinCodemode groups Pi's definition the same way).
		const mainJobs = createJobs({ backgroundAfterMs: THRESHOLD });
		registries.push(mainJobs);
		const mainNested = createNestedBarrier();
		const mainGates = [0, 1].map(() => Promise.withResolvers<void>());
		for (const [i, g] of mainGates.entries()) {
			const handoff = await (groupCodemode(fake(g.promise, {}) as any, mainNested, mainJobs) as any).execute(`m${i}`, { code: `main ${i}` }, undefined, undefined, {});
			assert.match(text(handoff), new RegExp(`^job#${i + 1} \\(codemode\\) is still running`));
		}
		assert.equal(codemodeInUse(), 2);
		// The child: the factory call RQW-agent makes, with the child's own Pi codemode definition.
		const dir = join(root, `t${counter++}`);
		await mkdir(dir, { recursive: true });
		const childGates = new Map<string, PromiseWithResolvers<void>>();
		const ran: string[] = [];
		let tools: Record<string, any> = {};
		const own = {
			name: "codemode", label: "codemode", description: "stock", parameters: {},
			execute: async (id: string, params: any, signal: AbortSignal) => {
				ran.push(params.code);
				// A tool call of the script: Pi gives it the id `<script id>/<n>`; it runs inside the script, never as a job.
				const nestedResult = await tools.bash.execute(`${id}/1`, { command: "printf nested" }, signal, undefined, ctx(dir));
				assert.equal(text(nestedResult), "nested");
				const g = Promise.withResolvers<void>();
				childGates.set(params.code, g);
				await Promise.race([g.promise, new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("Script aborted"))))]);
				return { content: [{ type: "text", text: `done ${params.code}` }], details: {} };
			},
		};
		const list = createTools(dir, () => ({}), undefined, { backgroundAfterMs: THRESHOLD, label: "agent#1", codemode: own as any });
		tools = Object.fromEntries(list.map((t) => [t.name, t as any]));
		registries.push((tools.job as any).jobs);
		assert.ok(tools.codemode, "the offered set returns the child's codemode");
		assert.ok(tools.codemode.description.endsWith(CODEMODE_BACKGROUND_LINE));
		const first = await tools.codemode.execute("k1", { code: "child one" }, undefined, undefined, ctx(dir));
		assert.match(text(first), /^job#1 \(codemode\) is still queued/, "the child's own job ids");
		assert.match(text(first), /waiting for: a free codemode worker \(2 of 2 in use\)/, "main's scripts hold both slots");
		assert.equal((await job(tools, dir, { action: "kill", id: "job#1" })).state, "killed");
		const second = await tools.codemode.execute("k2", { code: "child two" }, undefined, undefined, ctx(dir));
		assert.match(text(second), /^job#2 \(codemode\) is still queued/);
		assert.equal(codemodeInUse(), 2, "the killed waiter left the queue without taking a slot");
		mainGates[0].resolve();
		await mainJobs.settled("job#1");
		for (let i = 0; i < 200 && !childGates.has("child two"); i++) await new Promise((r) => setTimeout(r, 10));
		assert.deepEqual(ran, ["child two"], "the freed slot went to the live child script; the killed one never ran");
		childGates.get("child two")!.resolve();
		const waited = await job(tools, dir, { action: "wait", ids: ["job#2"], timeout_ms: 20000 });
		assert.equal(waited.results[0].result, "done child two");
		mainGates[1].resolve();
		await mainJobs.settled("job#2");
		assert.equal(codemodeInUse(), 0);
	});
});
