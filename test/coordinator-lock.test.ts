// Exclusive coordinator lock of the dev guard `.pi/extensions/coordinator-guard`: the lock file itself (races between
// real processes) and the guard's behavior as first, second, stale-taking and releasing session, with a fake pi.
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import { pathToFileURL } from "node:url";
import { createCoordinatorGuard, directNote } from "../.pi/extensions/coordinator-guard/index.ts";
import { acquireLock, LOCK_NAME, processStart, releaseLock } from "../.pi/extensions/coordinator-guard/lock.ts";

const ROOT = join(import.meta.dirname, "..");
const LOCK_MODULE = pathToFileURL(join(ROOT, ".pi", "extensions", "coordinator-guard", "lock.ts")).href;
const TMP = realpathSync(mkdtempSync(join(tmpdir(), "coordinator-lock-")));
after(() => rmSync(TMP, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));

let n = 0;
const fresh = (label: string) => {
	const dir = join(TMP, `${label}-${n++}`);
	mkdirSync(dir, { recursive: true });
	return dir;
};
const deadPid = () => spawnSync(process.execPath, ["-e", ""]).pid!;
// A live process that is not this one: the test runner's parent.
const OTHER_PID = process.ppid;
const read = (file: string) => JSON.parse(readFileSync(file, "utf8"));
// This process as the lock records it; JSON round trip drops `start` when the platform cannot tell it.
const SKIP = process.platform === "darwin" ? false : "the coordinator lock is macOS only; elsewhere the guard has no lock";
const START = processStart(process.pid);
const me = (sessionId: string) => JSON.parse(JSON.stringify({ pid: process.pid, start: START, sessionId }));
const SELF = { pid: process.pid, start: START };
const freshRoles = () => void delete (globalThis as Record<symbol, unknown>)[Symbol.for("my-pi.coordinator-guard.shared")];

// A child that waits for a start file, then contends for the lock and reports; it stays alive until stdin closes,
// so its pid is a live holder for the others.
const CHILD = `
import { existsSync } from "node:fs";
const { acquireLock, processStart } = await import(${JSON.stringify(LOCK_MODULE)});
const [lock, go, id] = process.argv.slice(1);
console.log("ready");
while (!existsSync(go)) {}
const r = acquireLock(lock, { pid: process.pid, start: processStart(process.pid), sessionId: id });
console.log(JSON.stringify({ pid: process.pid, held: r.held, fresh: r.fresh, holder: r.holder?.pid }));
process.stdin.resume();
`;

type Report = { pid: number; held: boolean; fresh?: boolean; holder?: number };
async function contend(lock: string, count: number): Promise<{ reports: Report[]; stop: () => void; children: ChildProcess[] }> {
	const go = join(fresh("go"), "go");
	const children: ChildProcess[] = [];
	const waiters: Promise<string>[] = [];
	const nextLine = (child: ChildProcess) =>
		new Promise<string>((resolve) => {
			let buffer = "";
			const onData = (chunk: Buffer) => {
				buffer += chunk;
				const at = buffer.indexOf("\n");
				if (at >= 0) {
					child.stdout!.off("data", onData);
					resolve(buffer.slice(0, at));
				}
			};
			child.stdout!.on("data", onData);
		});
	for (let i = 0; i < count; i++) {
		const child = spawn(process.execPath, ["--input-type=module", "-e", CHILD, lock, go, `s${i}`], { stdio: ["pipe", "pipe", "inherit"] });
		children.push(child);
		waiters.push(nextLine(child));
	}
	assert.deepEqual(await Promise.all(waiters), Array(count).fill("ready"));
	const results = children.map(nextLine);
	writeFileSync(go, "go");
	const reports = (await Promise.all(results)).map((line) => JSON.parse(line) as Report);
	return { reports, children, stop: () => children.forEach((c) => c.stdin!.end()) };
}

describe("coordinator lock file", { skip: SKIP }, () => {
	it("creates the lock with pid and session id, and is idempotent for the same pid", () => {
		const file = join(fresh("lock"), LOCK_NAME);
		assert.deepEqual(acquireLock(file, me("a")), { held: true, fresh: true });
		assert.deepEqual(read(file), me("a"));
		assert.deepEqual(acquireLock(file, me("a")), { held: true, fresh: false });
		assert.deepEqual(acquireLock(file, me("b")), { held: true, fresh: false });
		assert.deepEqual(read(file), me("b"), "a new session of the same process updates the id");
	});

	it("a live holder of another pid keeps the lock", () => {
		const file = join(fresh("lock"), LOCK_NAME);
		writeFileSync(file, JSON.stringify({ pid: OTHER_PID, sessionId: "x" }));
		assert.deepEqual(acquireLock(file, me("a")), { held: false, holder: { pid: OTHER_PID, sessionId: "x" } });
		assert.deepEqual(read(file), { pid: OTHER_PID, sessionId: "x" });
	});

	it("takes over a lock of a dead pid, and a corrupt one, leaving no helper files", () => {
		for (const stale of [JSON.stringify({ pid: deadPid(), sessionId: "old" }), "", "{not json"]) {
			const dir = fresh("lock");
			const file = join(dir, LOCK_NAME);
			writeFileSync(file, stale);
			assert.deepEqual(acquireLock(file, me("a")), { held: true, fresh: true });
			assert.deepEqual(read(file), me("a"));
			assert.deepEqual(readdirSync(dir), [LOCK_NAME]);
		}
	});

	it("removes a takeover gate left by a dead pid, but waits for a live one", () => {
		const dir = fresh("lock");
		const file = join(dir, LOCK_NAME);
		writeFileSync(file, JSON.stringify({ pid: deadPid(), sessionId: "old" }));
		writeFileSync(`${file}.takeover`, JSON.stringify({ pid: deadPid(), sessionId: "gate" }));
		assert.equal(acquireLock(file, me("a")).held, true);
		assert.deepEqual(readdirSync(dir), [LOCK_NAME]);

		const blockedDir = fresh("lock");
		const blocked = join(blockedDir, LOCK_NAME);
		writeFileSync(blocked, JSON.stringify({ pid: deadPid(), sessionId: "old" }));
		writeFileSync(`${blocked}.takeover`, JSON.stringify({ pid: OTHER_PID, sessionId: "gate" }));
		assert.deepEqual(acquireLock(blocked, me("a")), { held: false, holder: undefined }, "a live gate holder is never overridden");
	});

	it("release removes only a lock of this pid", () => {
		const file = join(fresh("lock"), LOCK_NAME);
		writeFileSync(file, JSON.stringify({ pid: OTHER_PID, sessionId: "x" }));
		releaseLock(file, SELF);
		assert.equal(existsSync(file), true);
		writeFileSync(file, JSON.stringify({ ...me("x"), start: "another process with this pid" }));
		releaseLock(file, SELF);
		assert.equal(existsSync(file), true, "a lock of a process that only has our pid is not ours");
		writeFileSync(file, JSON.stringify(me("x")));
		releaseLock(file, SELF);
		assert.equal(existsSync(file), false);
		releaseLock(file, SELF);
	});

	it("process identity: a live pid with another start time is stale, the same start time is a live holder", () => {
		const otherStart = processStart(OTHER_PID);
		assert.ok(START, "macOS reads a process start time with ps");
		assert.equal(processStart(process.pid), START, "the start time is stable");
		assert.ok(otherStart);

		// The pid is alive, but it belongs to a different process than the one that wrote the lock: a reused pid.
		const dir = fresh("lock");
		const file = join(dir, LOCK_NAME);
		writeFileSync(file, JSON.stringify({ pid: OTHER_PID, start: "Thu Jan  1 00:00:00 1970", sessionId: "crashed" }));
		assert.deepEqual(acquireLock(file, me("a")), { held: true, fresh: true });
		assert.deepEqual(read(file), me("a"));
		assert.deepEqual(readdirSync(dir), [LOCK_NAME]);

		const live = join(fresh("lock"), LOCK_NAME);
		const held = { pid: OTHER_PID, start: otherStart, sessionId: "real" };
		writeFileSync(live, JSON.stringify(held));
		assert.deepEqual(acquireLock(live, me("a")), { held: false, holder: held });
	});

	it("the start time does not depend on the caller's time zone, so a live holder under another TZ stays held", () => {
		const saved = process.env.TZ;
		const under = <T>(tz: string, fn: () => T): T => {
			process.env.TZ = tz;
			try {
				return fn();
			} finally {
				if (saved === undefined) delete process.env.TZ;
				else process.env.TZ = saved;
			}
		};
		try {
			const west = under("America/Los_Angeles", () => processStart(OTHER_PID));
			const east = under("Pacific/Kiritimati", () => processStart(OTHER_PID));
			assert.equal(east, west, "TZ with a 14 hour difference reads the same identity");
			assert.ok(west);
			const file = join(fresh("lock"), LOCK_NAME);
			const held = { pid: OTHER_PID, start: west, sessionId: "tz-west" };
			writeFileSync(file, JSON.stringify(held));
			assert.deepEqual(under("Pacific/Kiritimati", () => acquireLock(file, me("a"))), { held: false, holder: held });
			assert.deepEqual(read(file), held);
		} finally {
			if (saved === undefined) delete process.env.TZ;
			else process.env.TZ = saved;
		}
	});

	it("a new process that got the pid of a crashed holder does not mistake the old lock for its own", () => {
		const file = join(fresh("lock"), LOCK_NAME);
		writeFileSync(file, JSON.stringify({ pid: process.pid, start: "Thu Jan  1 00:00:00 1970", sessionId: "crashed" }));
		assert.deepEqual(acquireLock(file, me("a")), { held: true, fresh: true });
		assert.deepEqual(read(file), me("a"));
	});

	it("a holder killed with SIGKILL leaves a lock that the next process takes over", async () => {
		const file = join(fresh("lock"), LOCK_NAME);
		const { reports, stop, children } = await contend(file, 1);
		assert.equal(reports[0].held, true);
		assert.equal(read(file).pid, reports[0].pid);
		const exited = new Promise((resolve) => children[0].once("exit", resolve));
		children[0].kill("SIGKILL");
		await exited;
		assert.equal(existsSync(file), true, "no shutdown handler ran, so the lock is still there");
		assert.deepEqual(acquireLock(file, me("next")), { held: true, fresh: true });
		assert.deepEqual(read(file), me("next"));
		stop();
	});

	it("fresh race: exactly one of 8 simultaneous processes becomes the holder, in 5 rounds", async () => {
		for (let round = 0; round < 5; round++) {
			const file = join(fresh("race"), LOCK_NAME);
			const { reports, stop } = await contend(file, 8);
			try {
				const winners = reports.filter((r) => r.held);
				assert.equal(winners.length, 1, JSON.stringify(reports));
				assert.equal(read(file).pid, winners[0].pid);
				for (const r of reports.filter((x) => !x.held)) assert.equal(r.holder, winners[0].pid);
				assert.deepEqual(readdirSync(join(file, "..")).sort(), [LOCK_NAME]);
			} finally {
				stop();
			}
		}
	});

	it("stale race: exactly one of 8 simultaneous processes takes over the same dead lock, in 5 rounds", async () => {
		for (let round = 0; round < 5; round++) {
			const file = join(fresh("stale"), LOCK_NAME);
			writeFileSync(file, JSON.stringify({ pid: deadPid(), sessionId: "old" }));
			const { reports, stop } = await contend(file, 8);
			try {
				const winners = reports.filter((r) => r.held);
				assert.equal(winners.length, 1, JSON.stringify(reports));
				assert.equal(read(file).pid, winners[0].pid, "the lock names the single winner");
				for (const r of reports.filter((x) => !x.held)) assert.equal(r.holder, winners[0].pid);
				assert.deepEqual(readdirSync(join(file, "..")).sort(), [LOCK_NAME]);
			} finally {
				stop();
			}
		}
	});
});

// Layout: <tmp>/repo (main checkout, .git folder) with two worktrees whose `.git` files point into it. The lock
// lives in <tmp>/repo/.git for all three.
function repo() {
	const base = fresh("repo");
	const main = join(base, "repo");
	const worktrees = ["wt1", "wt2"].map((name) => join(base, "wt", name));
	mkdirSync(join(main, ".git"), { recursive: true });
	for (const [i, dir] of worktrees.entries()) {
		const admin = join(main, ".git", "worktrees", `wt${i + 1}`);
		mkdirSync(admin, { recursive: true });
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(admin, "gitdir"), `${join(dir, ".git")}\n`);
		writeFileSync(join(admin, "commondir"), "../..\n");
		writeFileSync(join(dir, ".git"), `gitdir: ${admin}\n`);
	}
	const processMd = join(base, "PROCESS.md");
	writeFileSync(processMd, readFileSync(join(ROOT, "PROCESS.md")));
	return { main, worktrees, lock: join(main, ".git", LOCK_NAME), processMd };
}

type Handler = (event: any, ctx: any) => any;
/** One extension instance, as Pi builds a new one for every runtime (startup, /new, /resume, /fork, /reload). */
function instance(root: string, processFile: string, sessionId: string, hasUI = true) {
	const handlers = new Map<string, Handler[]>();
	createCoordinatorGuard({ root, processFile })({ on: (name: string, h: Handler) => void handlers.set(name, [...(handlers.get(name) ?? []), h]) } as never);
	const status: Record<string, string | undefined> = {};
	const notices: string[] = [];
	const ctx = {
		cwd: root, hasUI,
		ui: { setStatus: (k: string, v?: string) => void (status[k] = v), notify: (m: string) => void notices.push(m) },
		sessionManager: { getEntries: () => [], getSessionId: () => sessionId },
	};
	const emit = (type: string, extra: object = {}) => {
		let result: any;
		for (const h of handlers.get(type) ?? []) result = h({ type, ...extra }, ctx) ?? result;
		return result;
	};
	const call = (toolName: string, input: Record<string, unknown>) => emit("tool_call", { toolName, toolCallId: "t", input });
	const prompt = () => {
		const event = { type: "before_agent_start", systemPrompt: "", systemPromptOptions: { sections: {} as Record<string, string> } };
		for (const h of handlers.get("before_agent_start")!) h(event, ctx);
		return event.systemPromptOptions.sections;
	};
	return { emit, call, prompt, status, notices };
}
const BAD_START = { action: "start", model: "anthropic/claude-opus-5-5", thinking: "high", task: "x" };

describe("coordinator-guard: exclusive coordinator", { skip: SKIP }, () => {
	beforeEach(freshRoles);
	it("the first session is the coordinator: lock taken, one notice, guard rules enforced", () => {
		const r = repo();
		const g = instance(r.worktrees[0], r.processMd, "s1");
		g.emit("session_start", { reason: "startup" });
		assert.deepEqual(read(r.lock), me("s1"));
		assert.deepEqual(g.notices, ["coordinator-guard: this session is the coordinator (exclusive lock taken)."]);
		assert.equal(g.status["coordinator-guard"], "coordinator-guard on");
		assert.equal(g.call("agent", BAD_START)?.block, true);
		assert.equal(g.call("write", { path: join(r.worktrees[0], "x.md"), content: "" })?.block, true);
		const sections = g.prompt();
		assert.match(sections.coordinator_rules, /binds Main, the top-level coordinator session/);
		assert.equal(sections.coordinator_note, undefined);
	});

	it("a second session in another worktree, or the main checkout, is a normal direct agent", () => {
		const r = repo();
		writeFileSync(r.lock, JSON.stringify({ pid: OTHER_PID, sessionId: "first" }));
		for (const root of [r.worktrees[1], r.main]) {
			const processFile = r.processMd;
			const g = instance(root, processFile, "s2");
			g.emit("session_start", { reason: "startup" });
			assert.deepEqual(read(r.lock), { pid: OTHER_PID, sessionId: "first" }, "the holder's lock is untouched");
			assert.equal(g.notices.length, 1);
			assert.match(g.notices[0], new RegExp(`^coordinator-guard: another session \\(pid ${OTHER_PID}\\) is the coordinator; this chat is a normal direct agent\\. Already-open normal chats stay normal when the coordinator quits; only a chat started afterwards takes the coordinator role\\.$`));
			assert.equal(g.status["coordinator-guard"], "coordinator-guard: direct agent");
			// Nothing is blocked, nothing is appended to a task.
			const start = { ...BAD_START };
			assert.equal(g.call("agent", start), undefined);
			assert.equal(start.task, "x");
			assert.equal(g.call("agent", { action: "start", explore: "quick", task: "y" }), undefined);
			assert.equal(g.call("write", { path: join(root, "x.md"), content: "" }), undefined);
			assert.equal(g.call("edit", { path: join(root, "x.md"), edits: [] }), undefined);
			const sections = g.prompt();
			assert.equal(sections.coordinator_rules, undefined);
			assert.equal(sections.coordinator_note, directNote(OTHER_PID));
			assert.match(sections.coordinator_note, /normal direct agent and stays one for its whole life/);
			assert.match(sections.coordinator_note, /AGENTS\.md and PROCESS\.md.*do not apply/);
			g.emit("session_shutdown", { reason: "quit" });
			assert.equal(existsSync(r.lock), true, "a non-holder never releases the lock");
		}
	});

	it("a lock of a dead pid is taken over, with the notice", () => {
		const r = repo();
		writeFileSync(r.lock, JSON.stringify({ pid: deadPid(), sessionId: "gone" }));
		const g = instance(r.worktrees[0], r.processMd, "s3");
		g.emit("session_start", { reason: "startup" });
		assert.deepEqual(read(r.lock), me("s3"));
		assert.equal(g.notices.length, 1);
		assert.equal(g.call("agent", BAD_START)?.block, true);
	});

	it("quit releases the lock, so the next session becomes the coordinator", () => {
		const r = repo();
		const a = instance(r.worktrees[0], r.processMd, "a");
		a.emit("session_start", { reason: "startup" });
		a.emit("session_shutdown", { reason: "quit" });
		assert.equal(existsSync(r.lock), false);
		const b = instance(r.worktrees[1], r.processMd, "b");
		b.emit("session_start", { reason: "startup" });
		assert.deepEqual(read(r.lock), me("b"));
	});

	it("/new, /resume, /fork and /reload keep the lock; the new runtime is still the coordinator without a second notice", () => {
		const r = repo();
		let current = instance(r.worktrees[0], r.processMd, "s0");
		current.emit("session_start", { reason: "startup" });
		for (const [i, reason] of (["new", "resume", "fork", "reload"] as const).entries()) {
			current.emit("session_shutdown", { reason });
			assert.deepEqual(read(r.lock).pid, process.pid, `${reason}: lock kept at shutdown`);
			current = instance(r.worktrees[0], r.processMd, `s${i + 1}`);
			current.emit("session_start", { reason });
			assert.deepEqual(read(r.lock), me(`s${i + 1}`), `${reason}: the holder keeps it and records the new session`);
			assert.deepEqual(current.notices, [], `${reason}: no new notice`);
			assert.equal(current.call("agent", BAD_START)?.block, true, `${reason}: still enforcing`);
			assert.equal(current.status["coordinator-guard"], "coordinator-guard on");
		}
		current.emit("session_shutdown", { reason: "quit" });
		assert.equal(existsSync(r.lock), false);
	});

	it("an open normal chat stays normal through /new, /resume, /fork and /reload, even after the holder is gone; a chat started afterwards takes the lock", () => {
		const r = repo();
		writeFileSync(r.lock, JSON.stringify({ pid: OTHER_PID, sessionId: "first" }));
		let current = instance(r.worktrees[1], r.processMd, "d0");
		current.emit("session_start", { reason: "startup" });
		assert.equal(current.call("agent", BAD_START), undefined);
		// The coordinator quits: its lock disappears.
		rmSync(r.lock);
		for (const [i, reason] of (["new", "resume", "fork", "reload"] as const).entries()) {
			current.emit("session_shutdown", { reason });
			current = instance(r.worktrees[1], r.processMd, `d${i + 1}`);
			// Even before session_start the new instance knows its role: a normal chat is never enforced.
			assert.equal(current.call("agent", BAD_START), undefined, `${reason}: still normal before session_start`);
			current.emit("session_start", { reason });
			assert.equal(existsSync(r.lock), false, `${reason}: the normal chat did not take the lock`);
			assert.equal(current.call("agent", BAD_START), undefined, `${reason}: still normal`);
			assert.equal(current.call("write", { path: join(r.worktrees[1], "x.md"), content: "" }), undefined);
			assert.equal(current.status["coordinator-guard"], "coordinator-guard: direct agent");
			assert.deepEqual(current.notices, [], `${reason}: no notice`);
			assert.ok(current.prompt().coordinator_note);
			assert.equal(current.prompt().coordinator_rules, undefined);
		}
		// A chat that starts afterwards (a new Pi process) takes the free lock.
		freshRoles();
		const later = instance(r.worktrees[0], r.processMd, "late");
		later.emit("session_start", { reason: "startup" });
		assert.deepEqual(read(r.lock), me("late"));
		assert.equal(later.call("agent", BAD_START)?.block, true);
	});

	it("a holder killed without any shutdown handler (SIGKILL) is replaced by the next chat that starts", async () => {
		const r = repo();
		const { reports, children } = await contend(r.lock, 1);
		assert.equal(read(r.lock).pid, reports[0].pid);
		const exited = new Promise((resolve) => children[0].once("exit", resolve));
		children[0].kill("SIGKILL");
		await exited;
		const g = instance(r.worktrees[0], r.processMd, "after-kill");
		g.emit("session_start", { reason: "startup" });
		assert.deepEqual(read(r.lock), me("after-kill"));
		assert.equal(g.call("agent", BAD_START)?.block, true);
		assert.equal(g.notices.length, 1);
	});

	it("a lock whose pid now belongs to another live program is stale: the next chat becomes the coordinator", () => {
		const r = repo();
		writeFileSync(r.lock, JSON.stringify({ pid: OTHER_PID, start: "Thu Jan  1 00:00:00 1970", sessionId: "crashed" }));
		const g = instance(r.worktrees[0], r.processMd, "reused");
		g.emit("session_start", { reason: "startup" });
		assert.deepEqual(read(r.lock), me("reused"));
		assert.equal(g.call("agent", BAD_START)?.block, true);
	});

	it("without a git dir there is no lock and the guard stays on; a failing lock keeps it on too", () => {
		const base = fresh("nogit");
		writeFileSync(join(base, "PROCESS.md"), readFileSync(join(ROOT, "PROCESS.md")));
		const g = instance(base, join(base, "PROCESS.md"), "n1");
		g.emit("session_start", { reason: "startup" });
		assert.equal(g.call("agent", BAD_START)?.block, true);
		assert.deepEqual(g.notices, []);

		const r = repo();
		mkdirSync(r.lock); // a directory where the lock file should be: reading it fails
		const f = instance(r.worktrees[0], r.processMd, "n2");
		f.emit("session_start", { reason: "startup" });
		assert.equal(f.call("agent", BAD_START)?.block, true);
		assert.match(f.notices[0], /coordinator lock failed .*guard stays on/);
	});

	it("without a UI nothing is notified and the lock still works", () => {
		const r = repo();
		const g = instance(r.worktrees[0], r.processMd, "h1", false);
		g.emit("session_start", { reason: "startup" });
		assert.deepEqual(read(r.lock), me("h1"));
		assert.deepEqual(g.notices, []);
	});
});
