// Real CLI entrypoints with faux-only providers. Default Node; PI_REVIEW_TEST_RUNTIME=bun tests the release runtime.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../..");
const runtime = process.env.PI_REVIEW_TEST_RUNTIME ?? process.execPath;
const bun = runtime === "bun";
const offline = join(here, "offline.mjs");
const preload = bun ? offline : pathToFileURL(offline).href;

describe(`${bun ? "Bun" : "Node"} CLI review delivery`, () => {
	for (const mode of ["print", "json"] as const) {
		it(`${mode} waits for the verdict and lets Main answer it before exit`, async () => {
			const dir = await mkdtemp(join(tmpdir(), "rqw-review-cli-"));
			const agent = join(dir, "agent");
			await mkdir(agent);
			const cli = join(repo, `node_modules/@earendil-works/pi-coding-agent/dist/${bun ? "bun/" : ""}cli.js`);
			const child = spawn(runtime, [bun ? "--preload" : "--import", preload, cli,
				"--no-extensions", "-e", join(here, "../index.ts"), "-e", join(here, "cli-faux.ts"),
				"--provider", "review-cli", "--model", "main", "--mode", mode === "print" ? "text" : mode, "-p", "Review fixture"], {
				cwd: dir, env: { ...process.env, PI_CODING_AGENT_DIR: agent, PI_OFFLINE: "1" }, stdio: ["ignore", "pipe", "pipe"],
			});
			let stdout = "";
			let stderr = "";
			child.stdout.on("data", chunk => { stdout += chunk; });
			child.stderr.on("data", chunk => { stderr += chunk; });
			const exited = Promise.withResolvers<number | null>();
			child.once("error", exited.reject);
			child.once("close", exited.resolve);
			// A real deadline only guards an external process that cannot use this test's mocked clock.
			const timeout = setTimeout(() => {
				child.kill("SIGKILL");
				exited.reject(new Error("CLI did not exit within 15 seconds"));
			}, 15000);
			try {
				assert.equal(await exited.promise, 0, stderr);
				assert.ok(stdout.includes("VERDICT_RECEIVED"), stdout);
				assert.ok(!stderr.includes("network blocked"), stderr);
				if (mode === "json") assert.ok(stdout.includes("[review#1] CLEAN\\nCHECKED:\\n- criterion (source) fulfilled (object)"), stdout);
			} finally {
				clearTimeout(timeout);
				child.kill("SIGKILL");
				await rm(dir, { recursive: true, force: true });
			}
		});
	}
});

it(`${bun ? "Bun" : "Node"} CLI RPC: two verdicts in earlier aborted agent_settled never auto-wake`, { timeout: 30000 }, async () => {
	const dir = await mkdtemp(join(tmpdir(), "rqw-review-abort-delivery-cli-"));
	const home = join(dir, "agent");
	await mkdir(home);
	const env: Record<string, string> = {};
	for (const key of ["PATH", "TMPDIR", "SystemRoot", "WINDIR"]) if (process.env[key]) env[key] = process.env[key]!;
	Object.assign(env, { HOME: home, USERPROFILE: home, PI_CODING_AGENT_DIR: home, PI_OFFLINE: "1", PI_SKIP_VERSION_CHECK: "1" });
	const child = spawn(runtime, [bun ? "--preload" : "--import", preload,
		join(repo, `node_modules/@earendil-works/pi-coding-agent/dist/${bun ? "bun/" : ""}cli.js`),
		"--no-extensions", "-e", join(here, "abort-delivery-cli-faux.ts"), "-e", join(here, "../index.ts"),
		"--no-skills", "--no-prompt-templates", "--no-context-files", "--no-themes", "--no-mcp", "--no-session",
		"--tools", "review", "--provider", "review-abort-delivery-cli", "--model", "main", "--mode", "rpc"],
		{ cwd: dir, env, stdio: ["pipe", "pipe", "pipe"] });
	let stdout = "", stderr = "", partial = "", done = false, abortSent = false;
	type Event = Record<string, any>;
	const events: Event[] = [];
	const waiters = new Set<() => void>();
	const notify = () => { for (const wake of [...waiters]) wake(); };
	const send = (command: Event) => child.stdin.write(`${JSON.stringify(command)}\n`);
	const exited = new Promise<number | null>((resolveExit, reject) => {
		child.once("error", reject);
		child.once("close", code => { done = true; notify(); resolveExit(code); });
	});
	child.stdout.on("data", data => {
		stdout += data; partial += data;
		const lines = partial.split("\n"); partial = lines.pop()!;
		for (const line of lines) if (line.startsWith("{")) events.push(JSON.parse(line));
		notify();
	});
	child.stderr.on("data", data => {
		stderr += data;
		if (!abortSent && stderr.includes("AUDIT_MAIN_BUSY")) { abortSent = true; send({ type: "abort", id: "abort" }); }
	});
	const event = (check: (e: Event) => boolean) => new Promise<Event>((resolveEvent, reject) => {
		const wake = () => {
			const found = events.find(check);
			if (found) { waiters.delete(wake); resolveEvent(found); }
			else if (done) { waiters.delete(wake); reject(new Error(`CLI exited before event: ${stdout}\n${stderr}`)); }
		};
		waiters.add(wake); wake();
	});
	const custom = (e: Event) => e.type === "message_end" && e.message?.role === "custom" && e.message.customType === "review";
	const final = (e: Event) => e.type === "message_end" && e.message?.role === "assistant" && JSON.stringify(e.message.content).includes("VERDICTS_RECEIVED");
	const timer = setTimeout(() => child.kill("SIGKILL"), 25000);
	try {
		send({ type: "prompt", id: "go", message: "GO" });
		assert.equal((await event(e => e.type === "response" && e.id === "abort")).success, true);
		await event(e => custom(e) && String(e.message.content).startsWith("[review#2]"));
		send({ type: "get_state", id: "state" });
		const state = await event(e => e.type === "response" && e.id === "state");
		assert.equal(state.data.isStreaming, false);
		assert.equal(state.data.pendingMessageCount, 0);
		assert.equal(events.some(final), false, "no deferred request after abort");
		assert.equal((stderr.match(/AUDIT_MAIN_REQUEST:/g) ?? []).length, 2);
		send({ type: "prompt", id: "next", message: "USER_RESUMES" });
		await event(final);
		child.stdin.end();
		assert.equal(await exited, 0, stderr);
		assert.equal(events.filter(custom).length, 2);
		assert.equal(events.filter(final).length, 1);
		assert.equal((stderr.match(/AUDIT_MAIN_REQUEST:/g) ?? []).length, 3);
		assert.doesNotMatch(stderr, /network blocked|Extension error|Failed to load|AssertionError/);
	} finally {
		clearTimeout(timer);
		if (!done) child.kill("SIGKILL");
		await exited;
		await rm(dir, { recursive: true, force: true });
	}
});
