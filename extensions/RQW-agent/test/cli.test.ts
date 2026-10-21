// Spawn the actual bundled CLI, not an imitation of its lifecycle or RPC protocol.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

const ROOT = resolve(import.meta.dirname, "../../..");
const BUN = process.env.RQW_AGENT_BUN === "1";
const EXTENSION = join(ROOT, "extensions/RQW-agent/index.ts");
const PROVIDER = join(import.meta.dirname, "cli-provider.ts");
const PRELOAD = join(ROOT, "test/no-network.mjs");
type Event = Record<string, any>;

async function cli(mode: "text" | "json" | "rpc", scenario: string) {
	const root = await mkdtemp(join(tmpdir(), "rqw-agent-cli-"));
	const home = join(root, "home"), work = join(root, "work");
	await mkdir(home); await mkdir(work);
	const env: Record<string, string> = {};
	for (const key of ["PATH", "TMPDIR", "SystemRoot", "WINDIR"]) if (process.env[key]) env[key] = process.env[key]!;
	Object.assign(env, { HOME: home, USERPROFILE: home, PI_CODING_AGENT_DIR: home,
		PI_OFFLINE: "1", PI_SKIP_VERSION_CHECK: "1", PI_TELEMETRY: "0", RQW_AGENT_SCENARIO: scenario });
	const executable = BUN ? "bun" : process.execPath;
	const args = [BUN ? "--preload" : "--import", PRELOAD,
		join(ROOT, `node_modules/@earendil-works/pi-coding-agent/dist/${BUN ? "bun" : "bundle"}/cli.js`),
		"--no-extensions", "-e", PROVIDER, "-e", EXTENSION,
		...(scenario === "nested" ? ["-e", "builtin:codemode"] : []),
		"--no-skills", "--no-prompt-templates", "--no-context-files", "--no-themes", "--no-mcp", "--no-session",
		"--tools", scenario === "nested" ? "agent,codemode" : "agent", "--provider", "agent-audit-cli", "--model", "main", "--thinking", "low",
		...(mode === "rpc" ? ["--mode", "rpc"] : mode === "json" ? ["--mode", "json", "--print", "GO"] : ["--print", "GO"])];
	const child = spawn(executable, args, { cwd: work, env, stdio: ["pipe", "pipe", "pipe"] });
	if (mode !== "rpc") child.stdin.end();
	let stdout = "", stderr = "", partial = "", done = false, spawnError: Error | undefined;
	const events: Event[] = [];
	const waiters = new Set<() => void>();
	const notify = () => { for (const wake of [...waiters]) wake(); };
	const exit = new Promise<number | null>(resolveExit => {
		child.on("error", error => { spawnError = error; });
		child.on("close", code => { done = true; notify(); resolveExit(code); });
	});
	const timer = setTimeout(() => child.kill("SIGKILL"), 25000);
	child.stdout.on("data", data => {
		stdout += data;
		partial += data;
		const lines = partial.split("\n"); partial = lines.pop()!;
		for (const line of lines) if (line.startsWith("{")) events.push(JSON.parse(line));
		notify();
	});
	const send = (command: Event) => child.stdin.write(`${JSON.stringify(command)}\n`);
	let abortSent = false;
	child.stderr.on("data", data => {
		stderr += data;
		if ((scenario === "abort-rpc" || scenario === "abort-window") && !abortSent && stderr.includes("AUDIT_MAIN_BUSY")) {
			abortSent = true;
			send({ type: "abort", id: "abort" });
		}
	});
	async function event(check: (e: Event) => boolean) {
		return new Promise<Event>((resolveEvent, reject) => {
			const wake = () => {
				const found = events.find(check);
				if (found) { waiters.delete(wake); resolveEvent(found); }
				else if (done) { waiters.delete(wake); reject(new Error(`CLI exited before event: ${stdout.slice(-2000)}\n${stderr.slice(-2000)}`)); }
			};
			waiters.add(wake); wake();
		});
	}
	const custom = (e: Event) => e.type === "message_end" && e.message?.role === "custom" && e.message.customType === "agent";
	const final = (e: Event) => e.type === "message_end" && e.message?.role === "assistant" && JSON.stringify(e.message.content).includes("CLI_FINAL_GOT_CHILD");
	try {
		if (mode === "rpc") {
			send({ type: "prompt", id: "go", message: "GO" });
			if (scenario === "abort-rpc" || scenario === "abort-window") {
				const response = await event(e => e.type === "response" && e.id === "abort");
				assert.equal(response.success, true);
				await event(custom);
				if (scenario === "abort-window") await event(e => custom(e) && String(e.message.content).startsWith("[agent#2]"));
				send({ type: "get_state", id: "state" });
				const state = await event(e => e.type === "response" && e.id === "state");
				assert.equal(state.data.isStreaming, false);
				assert.equal(state.data.pendingMessageCount, 0);
				assert.equal(events.some(final), false, "late child cannot wake an aborted main");
				if (scenario === "abort-window") assert.equal((stderr.match(/AUDIT_MAIN_REQUEST:/g) ?? []).length, 2, "no deferred requests escaped the abort window");
				send({ type: "prompt", id: "next", message: "NEXT" });
			}
			await event(final);
			child.stdin.end();
		}
		const code = await exit;
		assert.ifError(spawnError);
		assert.equal(code, 0, `${mode}/${scenario}: ${stdout.slice(-2000)}\n${stderr.slice(-2000)}`);
		assert.doesNotMatch(stderr, /Isolation network blocked|Extension error|Failed to load|AssertionError/);
		if (scenario === "abort-print") {
			assert.ok(stdout.includes("CLI_STARTED"));
			assert.ok(!stdout.includes("CLI_FINAL_GOT_CHILD"));
		} else if (scenario === "nested") {
			assert.ok(stdout.includes("CLI_NESTED_IDS_OK"));
			if (mode !== "text") {
				const calls = events.filter(e => e.type === "tool_execution_end" && e.toolName === "agent");
				assert.equal(calls.length, 2);
				assert.ok(calls.every(e => e.parentToolCallId === "nested" && !e.isError));
			}
		} else {
			assert.ok(stdout.includes("CLI_FINAL_GOT_CHILD"));
			if (mode === "text") assert.equal(stdout.trim(), "CLI_FINAL_GOT_CHILD");
			else {
				assert.deepEqual(events.filter(custom).map(e => e.message.content), scenario === "abort-window" ? ["[agent#1] CLI_CHILD_1", "[agent#2] CLI_CHILD_2"] : ["[agent#1] CLI_CHILD_1"]);
				assert.equal(events.filter(final).length, 1);
			}
		}
	} finally {
		clearTimeout(timer);
		if (!done) child.kill("SIGKILL");
		await exit;
		await rm(root, { recursive: true, force: true });
	}
}

for (const mode of ["text", "json", "rpc"] as const)
	test(`real ${BUN ? "Bun" : "Node"} CLI ${mode}: normal child result`, { timeout: 30000 }, () => cli(mode, "normal"));
for (const mode of ["text", "json"] as const) {
	test(`real ${BUN ? "Bun" : "Node"} CLI ${mode}: abort while waiting for child`, { timeout: 30000 }, () => cli(mode, "abort-print"));
	test(`real ${BUN ? "Bun" : "Node"} CLI ${mode}: codemode nested ids are persisted`, { timeout: 30000 }, () => cli(mode, "nested"));
}
test(`real ${BUN ? "Bun" : "Node"} CLI rpc: late-after-abort stays idle until next prompt`, { timeout: 30000 }, () => cli("rpc", "abort-rpc"));

test(`real ${BUN ? "Bun" : "Node"} CLI rpc: two results in earlier aborted agent_settled never auto-wake`, { timeout: 30000 }, () => cli("rpc", "abort-window"));
