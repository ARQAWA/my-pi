// Runs Pi's own CLI under Bun, the runtime of the Pi release binaries (`pi.exe` included), with this package and a
// faux model loaded. The model sends one `codemode` call whose script writes f.txt and then reads it. The check
// passes when the turn ends within the time limit, the script's read sees its write, and f.txt has the new content.
// A nested call that misses its script's barrier waits for the codemode call itself and hangs: the check fails.
//
// Usage: node extensions/RQW-tools/test/bun/codemode-check.mjs  (needs `bun` on PATH; PI_CHECK_TIMEOUT_MS, default 60000)
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../../..");
const cli = join(repo, "node_modules/@earendil-works/pi-coding-agent/dist/bun/cli.js");
const driver = join(here, "faux-codemode.ts");
const limit = Number(process.env.PI_CHECK_TIMEOUT_MS ?? 60000);

const root = mkdtempSync(join(tmpdir(), "pi-bun-check-"));
const work = join(root, "work");
const agent = join(root, "agent");
mkdirSync(work);
mkdirSync(agent);
writeFileSync(join(work, "f.txt"), "old\n");

const args = [cli, "-e", repo, "-e", driver, "--provider", "faux", "--model", "faux-1", "--mode", "json", "go"];
const child = spawn("bun", args, { cwd: work, env: { ...process.env, PI_CODING_AGENT_DIR: agent }, stdio: ["ignore", "pipe", "pipe"] });
let stdout = "";
let stderr = "";
child.stdout.on("data", (d) => (stdout += d));
child.stderr.on("data", (d) => (stderr += d));
let timedOut = false;
const timer = setTimeout(() => {
	timedOut = true;
	child.kill("SIGKILL");
}, limit);
const started = Date.now();
const code = await new Promise((done) => child.on("close", done));
clearTimeout(timer);
const seconds = ((Date.now() - started) / 1000).toFixed(1);

const events = stdout
	.split("\n")
	.filter((line) => line.startsWith("{"))
	.map((line) => JSON.parse(line));
const text = (e) => (e.result?.content ?? []).map((c) => c.text ?? "").join("");
const calls = events.filter((e) => e.type === "tool_execution_start" || e.type === "tool_execution_end");
for (const e of calls) {
	const end = e.type === "tool_execution_end" ? ` isError=${e.isError} ${JSON.stringify(text(e).slice(0, 60))}` : "";
	console.log(`${e.type} ${e.toolCallId} ${e.toolName}${end}`);
}
const end = (id) => calls.find((e) => e.type === "tool_execution_end" && e.toolCallId === id);
const content = readFileSync(join(work, "f.txt"), "utf-8");

const failures = [];
if (timedOut) failures.push(`no end after ${limit / 1000} s (hang)`);
else if (code !== 0) failures.push(`exit code ${code}`);
if (end("c0/1")?.toolName !== "write" || end("c0/1")?.isError !== false) failures.push("the script's write c0/1 did not end ok");
if (end("c0/2")?.toolName !== "read" || text(end("c0/2") ?? {}) !== "NEW\n") failures.push("the script's read c0/2 did not see NEW");
if (end("c0")?.toolName !== "codemode" || end("c0")?.isError !== false) failures.push("the codemode call c0 did not end ok");
if (content !== "NEW\n") failures.push(`f.txt is ${JSON.stringify(content)}`);

rmSync(root, { recursive: true, force: true });
if (failures.length > 0) {
	console.log(`FAIL after ${seconds} s: ${failures.join("; ")}`);
	if (stderr) console.log(`stderr:\n${stderr.slice(-2000)}`);
	process.exit(1);
}
console.log(`PASS in ${seconds} s: codemode under Bun, the script's read saw its write`);
