// Spawn the actual bundled CLI, not an imitation of its lifecycle or RPC protocol.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

const ROOT = resolve(import.meta.dirname, "../../..");
const BUN = process.env.RQW_AGENT_BUN === "1";
const EXTENSION = join(ROOT, "extensions/RQW-agent/index.ts");
const PROVIDER = join(import.meta.dirname, "cli-provider.ts");
const PRELOAD = join(ROOT, "test/no-network.mjs");
type Event = Record<string, any>;
// Wait scenarios: the main tools, the final marker and the exact custom messages a caller may see.
const WAIT: Record<string, { tools: string; marker: string; customs: string[] }> = {
	wait: { tools: "agent", marker: "CLI_WAIT_FINAL", customs: [] },
	"codemode-wait": { tools: "agent,codemode", marker: "CLI_CODEMODE_WAIT_FINAL", customs: [] },
	"codemode-error": { tools: "agent,codemode", marker: "CLI_ERROR_FINAL", customs: ["[agent#1] CLI_ERROR_CHILD"] },
	"codemode-timeout": { tools: "agent,codemode", marker: "CLI_TIMEOUT_LATE", customs: ["[agent#1] CLI_TIMEOUT_CHILD"] },
	"codemode-mixed": { tools: "agent,codemode", marker: "CLI_MIXED_FINAL", customs: [] },
	"nested-wait": { tools: "agent", marker: "CLI_NESTED_WAIT_FINAL", customs: [] },
	"codemode-abort": { tools: "agent,codemode", marker: "CLI_ABORT_WAIT_FINAL", customs: ["[agent#1] CLI_ABORT_CHILD"] },
};

async function cli(mode: "text" | "json" | "rpc", scenario: string) {
	const root = await mkdtemp(join(tmpdir(), "rqw-agent-cli-"));
	const home = join(root, "home"), work = join(root, "work");
	await mkdir(home); await mkdir(work);
	const env: Record<string, string> = {};
	for (const key of ["PATH", "TMPDIR", "SystemRoot", "WINDIR"]) if (process.env[key]) env[key] = process.env[key]!;
	Object.assign(env, { HOME: home, USERPROFILE: home, PI_CODING_AGENT_DIR: home,
		PI_OFFLINE: "1", PI_SKIP_VERSION_CHECK: "1", PI_TELEMETRY: "0", RQW_AGENT_SCENARIO: scenario });
	const executable = BUN ? "bun" : process.execPath;
	const args = [BUN ? "--preload" : "--import", BUN ? PRELOAD : pathToFileURL(PRELOAD).href,
		join(ROOT, `node_modules/@earendil-works/pi-coding-agent/dist/${BUN ? "bun" : "bundle"}/cli.js`),
		"--no-extensions", "-e", PROVIDER, "-e", EXTENSION,
		...(scenario === "nested" || scenario.startsWith("codemode") ? ["-e", "builtin:codemode"] : []),
		"--no-skills", "--no-prompt-templates", "--no-context-files", "--no-themes", "--no-mcp", "--no-session",
		"--tools", scenario === "nested" ? "agent,codemode" : (WAIT[scenario]?.tools ?? "agent"), "--provider", "agent-audit-cli", "--model", "main", "--thinking", "low",
		...(mode === "rpc" ? ["--mode", "rpc"] : mode === "json" ? ["--mode", "json", "--print", "GO"] : ["--print", "GO"])];
	const startedAt = performance.now();
	const child = spawn(executable, args, { cwd: work, env, stdio: ["pipe", "pipe", "pipe"] });
	if (mode !== "rpc") child.stdin.end();
	let stdout = "", stderr = "", partial = "", done = false, spawnError: Error | undefined;
	let exitCode: number | null = null, exitSignal: NodeJS.Signals | null = null, deadlineReached = false;
	let firstOutputMs: number | undefined;
	const events: Event[] = [];
	const waiters = new Set<() => void>();
	const notify = () => { for (const wake of [...waiters]) wake(); };
	const exit = new Promise<number | null>(resolveExit => {
		child.on("error", error => { spawnError = error; });
		child.on("close", (code, signal) => { exitCode = code; exitSignal = signal; done = true; notify(); resolveExit(code); });
	});
	const timer = setTimeout(() => { deadlineReached = true; child.kill("SIGKILL"); }, 25000);
	child.stdout.on("data", data => {
		firstOutputMs ??= performance.now() - startedAt;
		stdout += data;
		partial += data;
		const lines = partial.split("\n"); partial = lines.pop()!;
		for (const line of lines) if (line.startsWith("{")) events.push(JSON.parse(line));
		notify();
	});
	const send = (command: Event) => child.stdin.write(`${JSON.stringify(command)}\n`);
	let abortSent = false;
	child.stderr.on("data", data => {
		firstOutputMs ??= performance.now() - startedAt;
		stderr += data;
		const abortMarker = scenario === "codemode-abort" ? "AUDIT_CODEMODE_WAIT_READY" : "AUDIT_MAIN_BUSY";
		if ((scenario === "abort-rpc" || scenario === "abort-window" || scenario === "codemode-abort") && !abortSent && stderr.includes(abortMarker)) {
			abortSent = true;
			send({ type: "abort", id: "abort" });
		}
	});
	async function event(check: (e: Event) => boolean) {
		return new Promise<Event>((resolveEvent, reject) => {
			const wake = () => {
				const found = events.find(check);
				if (found) { waiters.delete(wake); resolveEvent(found); }
				else if (done) { waiters.delete(wake); reject(new Error(`CLI exited before event (${mode}/${scenario}): ${JSON.stringify({ exitCode, exitSignal, deadlineReached, elapsedMs: performance.now() - startedAt, firstOutputMs, spawnError: spawnError?.message })}\n${stdout.slice(-2000)}\n${stderr.slice(-2000)}`)); }
			};
			waiters.add(wake); wake();
		});
	}
	const custom = (e: Event) => e.type === "message_end" && e.message?.role === "custom" && e.message.customType === "agent";
	const marker = WAIT[scenario]?.marker ?? "CLI_FINAL_GOT_CHILD";
	const final = (e: Event) => e.type === "message_end" && e.message?.role === "assistant" && JSON.stringify(e.message.content).includes(marker);
	try {
		if (mode === "rpc") {
			send({ type: "prompt", id: "go", message: "GO" });
			if (scenario === "codemode-abort") {
				// The RPC abort lands while the nested wait is pending; the late child result is a custom message, never an auto-wake.
				const response = await event(e => e.type === "response" && e.id === "abort");
				assert.equal(response.success, true);
				await event(custom);
				send({ type: "get_state", id: "state" });
				const state = await event(e => e.type === "response" && e.id === "state");
				assert.equal(state.data.isStreaming, false);
				assert.equal(state.data.pendingMessageCount, 0);
				assert.equal(events.some(final), false, "late child cannot wake an aborted main");
				assert.equal(events.filter(custom).length, 1, "late child result is delivered once");
				send({ type: "prompt", id: "next", message: "NEXT" });
			} else if (scenario === "abort-rpc" || scenario === "abort-window") {
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
		} else if (WAIT[scenario]) {
			assert.ok(stdout.includes(marker), stdout);
			if (mode !== "text") {
				// Custom messages are the only deliveries outside the wait tool: each expected one exactly once, none otherwise.
				const customs = events.filter(e => e.type === "message_end" && e.message?.role === "custom").map(e => String(e.message.content));
				if (scenario === "codemode-mixed") {
					// Whether the first wait or a message delivers the agent's text depends on its finish time: exactly one of the two.
					const NEEDLES = ["CHILD_MIXED_DONE", "CODE_MIXED_DONE", "SHELL_MIXED_DONE"];
					const text = events.filter(e => (e.type === "tool_execution_end" && e.toolName === "codemode") || (e.type === "message_end" && e.message?.role === "custom"))
						.map(e => JSON.stringify(e)).join("");
					for (const needle of NEEDLES) assert.equal(text.split(needle).length - 1, 1, needle);
					assert.ok(customs.every(content => NEEDLES.some(needle => content.includes(needle))), customs.join("\n"));
				} else assert.deepEqual(customs, WAIT[scenario].customs);
				if (scenario === "codemode-abort") {
					// The nested wait may be reported on its start event; when it carries a parent id it is the codemode call.
					for (const e of events) if (e.type === "tool_execution_start" && e.toolName === "agent" && "parentToolCallId" in e) assert.equal(e.parentToolCallId, "codemode-abort");
					assert.equal(events.filter(e => e.type === "message_end" && e.message?.role === "toolResult" && e.message.toolName === "agent").length, 0, "no raw nested toolResult");
				}
				if (scenario === "wait" || scenario === "nested-wait")
					assert.ok(events.some(e => e.type === "tool_execution_end" && e.toolName === "agent" && !e.parentToolCallId && e.result?.details?.reason === "result"));
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

test(`real ${BUN ? "Bun" : "Node"} CLI rpc: abort while codemode nested wait is pending delivers the late child once`, { timeout: 30000 }, () => cli("rpc", "codemode-abort"));

for (const mode of ["text", "json", "rpc"] as const) {
	test(`real ${BUN ? "Bun" : "Node"} CLI ${mode}: start and wait for one child in the same turn`, { timeout: 30000 }, () => cli(mode, "wait"));
	test(`real ${BUN ? "Bun" : "Node"} CLI ${mode}: codemode start and wait in one script`, { timeout: 30000 }, () => cli(mode, "codemode-wait"));
	test(`real ${BUN ? "Bun" : "Node"} CLI ${mode}: codemode error after the wait result releases it once`, { timeout: 30000 }, () => cli(mode, "codemode-error"));
	test(`real ${BUN ? "Bun" : "Node"} CLI ${mode}: codemode script timeout ends the wait, the child keeps running`, { timeout: 30000 }, () => cli(mode, "codemode-timeout"));
	test(`real ${BUN ? "Bun" : "Node"} CLI ${mode}: codemode waits for three ordinary agents`, { timeout: 30000 }, () => cli(mode, "codemode-mixed"));
	test(`real ${BUN ? "Bun" : "Node"} CLI ${mode}: subagent waits its own child; main sees only the final answer`, { timeout: 30000 }, () => cli(mode, "nested-wait"));
}
