import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { encodeState } from "../scripts/qa-state.mjs";
import { acquireLock, assertMac, atomicJson, cacheDirectory, INTERVAL_MS, isFresh, poll, processStart, readJson, refreshInbox, restartOwner, STALE_MS, watch } from "../scripts/ci-watch.mjs";

const temps: string[] = [];
after(async () => { for (const path of temps) await rm(path, { recursive: true, force: true }); });
async function temp() {
	const dir = await mkdtemp(join(tmpdir(), "ci-watch-"));
	temps.push(dir);
	return dir;
}
const identify = async (pid: number) => pid === process.pid ? "current-start" : null;
const now = Date.parse("2026-10-23T01:00:00Z");

describe("repo-local macOS CI watcher", { skip: process.platform !== "darwin" }, () => {
	it("rejects unsupported platforms rather than implementing a portable dev tool", () => {
		assert.throws(() => assertMac("win32"), /macOS-only/);
		assert.throws(() => assertMac("linux"), /macOS-only/);
		assert.doesNotThrow(() => assertMac("darwin"));
	});

	it("uses git common directory, shared across worktrees", async () => {
		const calls: any[] = [];
		const execute = async (cmd: string, args: string[]) => { calls.push([cmd, args]); return "/repo/.git"; };
		assert.equal(await cacheDirectory("/repo", execute), "/repo/.git/ci-watch");
		assert.equal(await cacheDirectory("/repo-worktrees/task", execute), "/repo/.git/ci-watch");
		assert.deepEqual(calls[0], ["git", ["rev-parse", "--git-common-dir"]]);
	});

	it("admits exactly one simultaneous contender and releases only its own token", async () => {
		const path = join(await temp(), "watcher.lock");
		const locks = await Promise.all(Array.from({ length: 8 }, () => acquireLock(path, { identify })));
		assert.equal(locks.filter(Boolean).length, 1);
		const winner = locks.find(Boolean)!;
		assert.deepEqual(await readJson(path), winner.owner);
		await winner.release();
		const next = await acquireLock(path, { identify });
		assert.ok(next);
		await winner.release();
		assert.deepEqual(await readJson(path), next.owner);
		await next.release();
		assert.equal(await readJson(path), null);
	});

	it("serializes real competing processes, not just promises", async () => {
		const dir = await temp();
		const module = new URL("../scripts/ci-watch.mjs", import.meta.url).href;
		const script = join(dir, "contender.mjs");
		await writeFile(script, `import { acquireLock } from ${JSON.stringify(module)};
const lock = await acquireLock(process.argv[2]);
process.send(Boolean(lock));
if (lock) process.on('message', async () => { await lock.release(); process.disconnect(); });
else process.disconnect();
`);
		const children = Array.from({ length: 4 }, () => fork(script, [join(dir, "watcher.lock")], { stdio: ["ignore", "pipe", "pipe", "ipc"] }));
		try {
			const results = await Promise.all(children.map(async (child) => (await once(child, "message"))[0]));
			assert.equal(results.filter(Boolean).length, 1);
			const winner = children[results.indexOf(true)];
			const exited = once(winner, "exit");
			winner.send("release");
			await exited;
			assert.equal(await readJson(join(dir, "watcher.lock")), null);
		} finally { for (const child of children) if (child.exitCode === null) child.kill(); }
	});

	it("takes over stale metadata for dead and reused PIDs", async () => {
		for (const stale of [{ pid: 999999, startTime: "dead" }, { pid: process.pid, startTime: "old-start" }]) {
			const path = join(await temp(), "watcher.lock");
			await writeFile(path, JSON.stringify({ ...stale, token: "old" }));
			const locks = await Promise.all(Array.from({ length: 5 }, () => acquireLock(path, { identify })));
			assert.equal(locks.filter(Boolean).length, 1);
			const winner = locks.find(Boolean)!;
			assert.equal((await readJson(path)).startTime, "current-start");
			await winner.release();
		}
	});

	it("recovers the kernel lock and stale owner after a watcher is killed", async () => {
		const dir = await temp();
		const path = join(dir, "watcher.lock");
		const script = join(dir, "crash.mjs");
		const module = new URL("../scripts/ci-watch.mjs", import.meta.url).href;
		await writeFile(script, `import { acquireLock } from ${JSON.stringify(module)};
const lock = await acquireLock(process.argv[2]);
process.send(lock.owner);
setInterval(() => {}, 1000);
`);
		const child = fork(script, [path], { stdio: ["ignore", "pipe", "pipe", "ipc"] });
		try {
			const [owner] = await once(child, "message");
			assert.equal(owner.pid, child.pid);
			assert.ok(owner.startTime);
			const exited = once(child, "exit");
			child.kill("SIGKILL");
			await exited;
			let lock: any;
			const deadline = Date.now() + 3000;
			while (!lock && Date.now() < deadline) lock = await acquireLock(path);
			assert.ok(lock, "kernel lock must be released after watcher death");
			assert.equal((await readJson(path)).pid, process.pid);
			await lock.release();
		} finally { if (child.exitCode === null && child.signalCode === null) child.kill(); }
	});

	it("retains live owners identified by PID AND start time", async () => {
		const path = join(await temp(), "watcher.lock");
		const lock = await acquireLock(path, { identify });
		assert.ok(lock);
		assert.equal(await acquireLock(path, { identify }), null);
		assert.ok(await processStart(process.pid));
		assert.equal(await processStart(-1), null);
		await processStart(process.pid, async (_cmd: string, _args: string[], options: any) => {
			assert.equal(options.env.LC_ALL, "C");
			assert.equal(options.env.TZ, "UTC");
			return "current-start";
		});
		await assert.rejects(processStart(process.pid, async () => { throw new Error("ps unavailable"); }), /ps unavailable/);
		await lock.release();
	});

	it("never exposes partial status JSON while repeatedly replacing the file", async () => {
		const dir = await temp();
		const path = join(dir, "status.json");
		await atomicJson(path, { sequence: 0, data: "x".repeat(5000) });
		let done = false;
		const writer = (async () => {
			for (let sequence = 1; sequence <= 12; sequence++) await atomicJson(path, { sequence, data: "x".repeat(5000) });
			done = true;
		})();
		let reads = 0;
		while (!done) {
			const state = JSON.parse(await readFile(path, "utf8"));
			assert.equal(state.data.length, 5000);
			reads++;
		}
		await writer;
		assert.ok(reads > 0);
		assert.equal((await readJson(path)).sequence, 12);
		assert.deepEqual(await readdir(dir), ["status.json"]);
	});

	it("marks old, future, absent and invalid successes stale", () => {
		const state = { version: 1, fetchedAt: new Date(now).toISOString() };
		assert.equal(isFresh(state, now), true);
		assert.equal(isFresh(state, now + STALE_MS), true);
		assert.equal(isFresh(state, now + STALE_MS + 1), false);
		assert.equal(isFresh(state, now - 1), false);
		assert.equal(isFresh({ version: 1 }, now), false);
		assert.equal(isFresh({ ...state, fetchedAt: "invalid" }, now), false);
	});

	it("makes exactly one bounded gh request and records success plus shared budget atomically", async () => {
		const path = join(await temp(), "status.json");
		const calls: any[] = [];
		const state = await poll({ repo: "o/r", statusPath: path, now: () => now, execute: async (...args: any[]) => {
			calls.push(args);
			const reservation = await readJson(path);
			assert.equal(reservation.nextAttemptAt, new Date(now + INTERVAL_MS).toISOString());
			assert.equal(reservation.fetchedAt, undefined);
			return JSON.stringify({ total_count: 101, workflow_runs: [{ id: 1, head_sha: "a".repeat(40), run_attempt: 2, conclusion: "success" }] });
		} });
		assert.deepEqual(calls, [["gh", ["api", "repos/o/r/actions/runs?per_page=100"], { signal: undefined }]]);
		assert.equal(state.bounded, true);
		assert.equal(state.runs[0].run_attempt, 2);
		assert.equal(state.fetchedAt, new Date(now).toISOString());
		assert.equal(state.nextAttemptAt, new Date(now + INTERVAL_MS).toISOString());
		assert.deepEqual(await readJson(path), state);
	});

	it("backs off errors without refreshing successful timestamps and clears errors on recovery", async () => {
		const path = join(await temp(), "status.json");
		const previous = { version: 1, fetchedAt: new Date(now - 200_000).toISOString(), runs: [{ id: 1 }] };
		const fail = async () => { throw new Error("HTTP 403 rate limited"); };
		const first = await poll({ repo: "o/r", statusPath: path, previous, now: () => now, execute: fail });
		assert.equal(first.fetchedAt, previous.fetchedAt);
		assert.equal(isFresh(first, now), false);
		assert.match(first.error, /HTTP 403/);
		assert.equal(Date.parse(first.nextAttemptAt) - now, 2 * INTERVAL_MS);
		const second = await poll({ repo: "o/r", statusPath: path, previous: first, now: () => now, execute: fail });
		assert.equal(Date.parse(second.nextAttemptAt) - now, 4 * INTERVAL_MS);
		const recovered = await poll({ repo: "o/r", statusPath: path, previous: second, now: () => now,
			execute: async () => JSON.stringify({ total_count: 0, workflow_runs: [] }) });
		assert.equal(recovered.error, undefined);
		assert.deepEqual(recovered.runs, []);
		assert.equal(recovered.failures, 0);
	});

	it("does not invent success for invalid responses or a first failing request", async () => {
		const path = join(await temp(), "status.json");
		const state = await poll({ repo: "o/r", statusPath: path, now: () => now, execute: async () => "{}" });
		assert.equal(state.fetchedAt, undefined);
		assert.match(state.error, /invalid workflow runs response/);
		assert.equal(isFresh(state, now), false);
	});

	it("aborting an in-flight request never publishes success or error after lock loss", async () => {
		for (const fail of [false, true]) {
			const path = join(await temp(), "status.json");
			const controller = new AbortController();
			const state = { version: 1, repo: "o/r", fetchedAt: new Date(now - 1000).toISOString(), runs: [{ id: 1 }] };
			let reserved: any;
			await assert.rejects(poll({ repo: "o/r", statusPath: path, previous: state, now: () => now, signal: controller.signal,
				execute: async (_cmd: string, _args: string[], options: any) => {
					assert.equal(options.signal, controller.signal);
					reserved = await readJson(path);
					controller.abort();
					if (fail) throw new Error("request interrupted");
					return JSON.stringify({ total_count: 0, workflow_runs: [] });
				} }), { name: "AbortError" });
			assert.deepEqual(await readJson(path), reserved);
			assert.equal(reserved.fetchedAt, state.fetchedAt);
			assert.equal(reserved.error, undefined);
		}
	});

	it("refreshes issues only on explicit request with a separate timestamp and bounded gh call", async () => {
		const dir = await temp();
		const calls: any[] = [];
		const lastSeen = "2026-10-22T12:00:00Z";
		let response: any[] = [{ number: 7, title: "[qa] failure", labels: [{ name: "qa-inbox" }], updated_at: "2026-10-20T00:00:00Z",
			body: encodeState({ signature: "abc1234", lastSeen, rate: { k: 2, n: 6 }, occurrences: [{ runId: 11 }, { runId: 12 }] }),
			html_url: "https://github.com/o/r/issues/7" }];
		const execute = async (command: string, args: string[]) => {
			if (command === "git") return args[0] === "remote" ? "git@github.com:o/r.git" : dir;
			calls.push([command, args]);
			return JSON.stringify(response);
		};
		const state = await refreshInbox({ execute, now: () => now });
		assert.equal(state.fetchedAt, new Date(now).toISOString());
		assert.equal(state.items[0].level, "red");
		assert.equal(state.items[0].id, `issue:7:${lastSeen}`);
		assert.equal(state.items[0].text, `#7 [qa] failure [qa-inbox] rate 2/6; lastSeen ${lastSeen}; occurrences 2`);
		assert.deepEqual(calls, [["gh", ["api", "repos/o/r/issues?state=open&labels=qa-inbox&per_page=100"]]]);
		assert.deepEqual(await readJson(join(dir, "ci-watch", "inbox.json")), state);
		assert.equal(await readJson(join(dir, "ci-watch", "status.json")), null);
		response = Array.from({ length: 100 }, () => response[0]);
		await assert.rejects(refreshInbox({ execute }), /100-item bound/);
		assert.deepEqual(await readJson(join(dir, "ci-watch", "inbox.json")), state);
	});

	it("restarting an exited watcher honors the persisted minute budget without gh", async () => {
		const dir = await temp();
		const calls: string[] = [];
		const execute = async (command: string, args: string[]) => {
			calls.push(command);
			if (command === "git") return args[0] === "remote" ? "git@github.com:o/r.git" : dir;
			return JSON.stringify({ total_count: 0, workflow_runs: [] });
		};
		const first = await watch({ once: true, execute });
		assert.equal(first.started, true);
		assert.equal(calls.filter((cmd) => cmd === "gh").length, 1);
		const second = await watch({ once: true, execute });
		assert.equal(second.deferred, true);
		assert.equal(calls.filter((cmd) => cmd === "gh").length, 1);
		assert.equal(await readJson(join(dir, "ci-watch", "watcher.lock")), null);
	});

	it("restart never signals a reused PID and rechecks identity before escalation", async () => {
		const path = join(await temp(), "watcher.lock");
		await writeFile(path, JSON.stringify({ pid: 42, startTime: "old-start" }));
		const signals: any[] = [];
		const kill = (pid: number, signal: string) => { signals.push([pid, signal]); return true; };
		await restartOwner(path, { identify, kill, wait: async () => {} });
		assert.deepEqual(signals, []);
		let calls = 0;
		await restartOwner(path, { identify: async () => ++calls < 3 ? "old-start" : "new-start", kill, wait: async () => {} });
		assert.deepEqual(signals, [[42, "SIGTERM"]]);
	});
});
