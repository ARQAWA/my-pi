#!/usr/bin/env node
// Repo-local macOS development tool. Never used as merge evidence.
import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

export const INTERVAL_MS = 60_000;
export const STALE_MS = 180_000;
export const RUN_LIMIT = 100;

export function run(command, args, options = {}) {
	return new Promise((resolve, reject) => {
		execFile(command, args, { encoding: "utf8", timeout: 15_000, maxBuffer: 4 * 1024 * 1024, ...options }, (error, stdout, stderr) => {
			if (error) reject(new Error(String(stderr || error.message).trim()));
			else resolve(stdout.trim());
		});
	});
}

export function assertMac(platform = process.platform) {
	if (platform !== "darwin") throw new Error("ci-watch is a repo-local macOS-only development tool");
}

export async function cacheDirectory(cwd = process.cwd(), execute = run) {
	return join(resolve(cwd, await execute("git", ["rev-parse", "--git-common-dir"], { cwd })), "ci-watch");
}

export async function processStart(pid, execute = run) {
	if (!Number.isSafeInteger(pid) || pid <= 0) return null;
	try {
		return (await execute("/bin/ps", ["-p", String(pid), "-o", "lstart="],
			{ env: { ...process.env, LC_ALL: "C", TZ: "UTC" } })).trim() || null;
	} catch (error) {
		try { process.kill(pid, 0); }
		catch (probe) { if (probe.code === "ESRCH") return null; }
		throw error; // An unreadable live process is not proof that its lock is stale.
	}
}

export async function readJson(path) {
	try { return JSON.parse(await readFile(path, "utf8")); }
	catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

export function isFresh(state, now = Date.now()) {
	const age = now - Date.parse(state?.fetchedAt);
	return state?.version === 1 && Number.isFinite(age) && age >= 0 && age <= STALE_MS;
}

export async function atomicJson(path, value, { signal } = {}) {
	const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
	try {
		signal?.throwIfAborted();
		await writeFile(temp, `${JSON.stringify(value)}\n`, { flag: "wx", mode: 0o600 });
		signal?.throwIfAborted();
		await rename(temp, path);
	} finally { await unlink(temp).catch((error) => { if (error.code !== "ENOENT") throw error; }); }
}

// macOS lockf owns the kernel lock; -k keeps its inode stable across contenders.
// The helper exits on stdin EOF, including when this watcher crashes or is killed.
export async function acquireLock(path, { identify = processStart, pid = process.pid } = {}) {
	assertMac();
	const startTime = await identify(pid);
	if (!startTime) throw new Error("cannot establish watcher process start time");
	const helper = spawn("/usr/bin/lockf", ["-ks", "-t", "0", `${path}.guard`, process.execPath, "-e",
		"process.stdout.write('locked\\n'); process.stdin.resume(); process.stdin.on('end', () => process.exit(0));"],
		{ stdio: ["pipe", "pipe", "pipe"], detached: true });
	const exited = new Promise((resolve) => helper.once("exit", resolve));
	const acquired = await new Promise((resolve, reject) => {
		helper.once("error", reject);
		helper.stdout.once("data", () => resolve(true));
		helper.once("exit", (code) => code === 75 ? resolve(false) : reject(new Error(`lockf exited ${code}`)));
	});
	if (!acquired) return null;
	const controller = new AbortController();
	helper.once("exit", () => controller.abort());
	const owner = { pid, startTime, token: randomUUID() };
	let released = false;
	const release = async () => {
		if (released) return;
		released = true;
		try {
			if (!controller.signal.aborted && (await readJson(path))?.token === owner.token) await unlink(path);
		} finally { helper.stdin.end(); await exited; }
	};
	try { await atomicJson(path, owner, { signal: controller.signal }); }
	catch (error) { await release(); throw error; }
	return { owner, release, signal: controller.signal };
}

export async function poll({ repo, statusPath, execute = run, now = Date.now, previous = null, signal }) {
	const attemptedAt = new Date(now()).toISOString();
	// Reserve the minute before HTTP so a crash/restart cannot create a second request.
	await atomicJson(statusPath, { ...previous, version: 1, repo, attemptedAt,
		nextAttemptAt: new Date(now() + INTERVAL_MS).toISOString() }, { signal });
	try {
		// One HTTP request, one bounded page. Missing heads remain unknown, never green.
		const result = JSON.parse(await execute("gh", ["api", `repos/${repo}/actions/runs?per_page=${RUN_LIMIT}`], { signal }));
		if (!Array.isArray(result.workflow_runs) || !Number.isSafeInteger(result.total_count)) throw new Error("invalid workflow runs response");
		const state = { version: 1, repo, fetchedAt: new Date(now()).toISOString(), attemptedAt,
			failures: 0, nextAttemptAt: new Date(now() + INTERVAL_MS).toISOString(),
			runs: result.workflow_runs, bounded: result.total_count > result.workflow_runs.length };
		await atomicJson(statusPath, state, { signal });
		return state;
	} catch (error) {
		signal?.throwIfAborted();
		const failures = (previous?.failures ?? 0) + 1;
		const state = { ...previous, version: 1, repo, attemptedAt, failures,
			nextAttemptAt: new Date(now() + INTERVAL_MS * Math.min(16, 2 ** failures)).toISOString(),
			error: String(error.message).replace(/\s+/g, " ").slice(0, 500) };
		await atomicJson(statusPath, state, { signal });
		return state;
	}
}

export async function restartOwner(lockPath, { identify = processStart, kill = process.kill, wait = sleep } = {}) {
	const owner = await readJson(lockPath);
	if (!owner || await identify(owner.pid) !== owner.startTime) return;
	kill(owner.pid, "SIGTERM");
	for (let i = 0; i < 30; i++) {
		await wait(100);
		if (await identify(owner.pid) !== owner.startTime) return;
	}
	// Recheck identity immediately before escalation; never kill a reused PID.
	if (await identify(owner.pid) === owner.startTime) kill(owner.pid, "SIGKILL");
	await wait(100);
}

export async function watch({ cwd = process.cwd(), once = false, restart = false, execute = run } = {}) {
	assertMac();
	const dir = await cacheDirectory(cwd, execute);
	await mkdir(dir, { recursive: true, mode: 0o700 });
	const lockPath = join(dir, "watcher.lock");
	if (restart) await restartOwner(lockPath);
	const lock = await acquireLock(lockPath);
	if (!lock) return { started: false, directory: dir };
	const controller = new AbortController();
	const stop = () => controller.abort();
	lock.signal.addEventListener("abort", stop, { once: true });
	if (lock.signal.aborted) stop();
	process.once("SIGTERM", stop);
	process.once("SIGINT", stop);
	try {
		const remote = await execute("git", ["remote", "get-url", "origin"], { cwd });
		const repo = /(?:github\.com[:/])([\w.-]+\/[\w.-]+?)(?:\.git)?$/.exec(remote)?.[1];
		if (!repo) throw new Error("origin must be a GitHub repository");
		const statusPath = join(dir, "status.json");
		let state = await readJson(statusPath);
		if (state?.repo !== repo) state = null;
		while (!controller.signal.aborted) {
			// Starting another process cannot bypass the shared request budget/backoff.
			const delay = Date.parse(state?.nextAttemptAt) - Date.now();
			if (delay > 0) {
				if (once) return { started: true, directory: dir, deferred: true };
				await sleep(delay, undefined, { signal: controller.signal });
			}
			if (controller.signal.aborted) break;
			state = await poll({ repo, statusPath, execute, previous: state, signal: controller.signal });
			if (once) break;
		}
		return { started: true, directory: dir };
	} catch (error) {
		if (error.name !== "AbortError") throw error;
		return { started: true, directory: dir };
	} finally {
		lock.signal.removeEventListener("abort", stop);
		process.removeListener("SIGTERM", stop);
		process.removeListener("SIGINT", stop);
		await lock.release();
	}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try {
		const flags = process.argv.slice(2);
		if (flags.some((flag) => !["--once", "--restart"].includes(flag)))
			throw new Error("usage: npm run ci-watch -- [--restart] [--once]");
		const result = await watch({ once: flags.includes("--once"), restart: flags.includes("--restart") });
		console.log(`${result.started ? "ci-watch stopped" : "ci-watch already running"}: ${result.directory}`);
	} catch (error) { console.error(error.message); process.exitCode = 1; }
}
