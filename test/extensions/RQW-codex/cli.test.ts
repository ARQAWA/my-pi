// Real bundled Pi 1.4.0 CLI (package bin, dist/bundle/cli.js) in print mode, under Node; RQW_CODEX_BUN=1 spawns the Bun
// bundle instead; RQW_CODEX_EXE=<absolute path> spawns that compiled pi.exe directly (no Node or Bun runtime flags, the
// root guard test/no-network-extension.ts is loaded first with -e). Only RQW-codex and its fixture are loaded. The fixture injects a refused connector and a fake SSE
// postEvents; the test preload blocks every other network path. Home, cwd and auth are temporary, with a fake JWT.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

import { CODEX_ENDPOINT, CODEX_PROVIDER } from "../../../extensions/RQW-codex/profile.ts";

const ROOT = resolve(import.meta.dirname, "../../..");
const EXE = process.env.RQW_CODEX_EXE ?? "";
const BINARY = EXE !== "";
const BUN = !BINARY && process.env.RQW_CODEX_BUN === "1";
const MODE = BINARY ? "compiled pi.exe" : BUN ? "Bun bundle" : "Node bundle";
const FIXTURE = join(import.meta.dirname, "fixtures/cli.ts");
const GUARD = join(ROOT, "test/no-network-extension.ts");
const PRELOAD = join(ROOT, "test/no-network.mjs");
const ACCOUNT = "acct_cli_test_1";
const ACCESS_MARKER = "cli-fake-access";
const REFRESH = "refresh-cli-test-1";
const CLI_TIMEOUT_MS = 30000;

type Post = { kind: "post"; url: string; body: Record<string, any> };
type Hook = { kind: "hook"; generate: false | null; hasToolOutput: boolean };
type Capture = Post | Hook;

function b64url(value: unknown): string {
	return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function fakeAccess(): string {
	const exp = Math.floor(Date.now() / 1000) + 3600;
	return `${b64url({ alg: "none" })}.${b64url({ exp, "https://api.openai.com/auth": { chatgpt_account_id: ACCOUNT } })}.${ACCESS_MARKER}`;
}

async function runCli(hook: "none" | "priority") {
	if (BINARY) assert.ok(isAbsolute(EXE) && existsSync(EXE), `RQW_CODEX_EXE must be an absolute existing file: ${EXE}`);
	const root = await mkdtemp(join(tmpdir(), "rqw-codex-cli-"));
	try {
		const home = join(root, "home"), work = join(root, "work");
		await mkdir(home, { recursive: true });
		await mkdir(work);
		const readPath = join(root, "read-target.txt");
		await writeFile(readPath, "CLI_READ_CONTENT");
		const capture = join(root, "capture.jsonl");
		const exp = Math.floor(Date.now() / 1000) + 3600;
		const credential = { type: "oauth", access: fakeAccess(), refresh: REFRESH, expires: exp * 1000, accountId: ACCOUNT };
		await writeFile(join(home, "auth.json"), JSON.stringify({ [CODEX_PROVIDER]: credential }));
		const grantBefore = await readFile(join(home, "auth.json"), "utf8");

		const env: Record<string, string> = {};
		for (const key of ["PATH", "TMPDIR", "SystemRoot", "WINDIR"]) if (process.env[key]) env[key] = process.env[key]!;
		Object.assign(env, {
			HOME: home, USERPROFILE: home, PI_CODING_AGENT_DIR: home,
			PI_OFFLINE: "1", PI_SKIP_VERSION_CHECK: "1", PI_TELEMETRY: "0",
			RQW_CODEX_CLI_CAPTURE: capture, RQW_CODEX_CLI_READ_PATH: readPath, RQW_CODEX_CLI_HOOK: hook,
		});
		const cliEntry = join(ROOT, "node_modules/@earendil-works/pi-coding-agent/dist", BUN ? "bun/cli.js" : "bundle/cli.js");
		const launch = BINARY ? [] : [BUN ? "--preload" : "--import", BUN ? PRELOAD : pathToFileURL(PRELOAD).href, cliEntry];
		const args = [
			...launch,
			"--no-extensions", ...(BINARY ? ["-e", GUARD] : []), "-e", FIXTURE,
			"--no-skills", "--no-prompt-templates", "--no-context-files", "--no-themes", "--no-session",
			"--tools", "read", "--provider", CODEX_PROVIDER, "--model", "gpt-6.1-sol", "--thinking", "low",
			"--print", "GO",
		];
		const command = BINARY ? EXE : BUN ? "bun" : process.execPath;
		const child = spawn(command, args, { cwd: work, env, stdio: ["pipe", "pipe", "pipe"] });
		child.stdin.end();
		let stdout = "", stderr = "";
		child.stdout.on("data", (data) => { stdout += data; });
		child.stderr.on("data", (data) => { stderr += data; });
		const timer = setTimeout(() => child.kill("SIGKILL"), CLI_TIMEOUT_MS);
		const code = await new Promise<number | null>((resolveExit, reject) => {
			child.on("error", reject);
			child.on("close", resolveExit);
		}).finally(() => clearTimeout(timer));
		const captures: Capture[] = (await readFile(capture, "utf8").catch(() => ""))
			.split("\n").filter(Boolean).map((line) => JSON.parse(line) as Capture);
		const grantAfter = await readFile(join(home, "auth.json"), "utf8");
		return { code, stdout, stderr, captures, grantBefore, grantAfter, readPath };
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

function assertCleanRun(run: Awaited<ReturnType<typeof runCli>>) {
	assert.equal(run.code, 0, `exit ${run.code}\n${run.stdout.slice(-2000)}\n${run.stderr.slice(-2000)}`);
	assert.doesNotMatch(run.stderr, /Isolation network blocked|Extension error|Failed to load|AssertionError/);
	assert.equal(run.stdout.trim(), "CLI CODEX OK");
	for (const secret of [ACCESS_MARKER, REFRESH]) {
		assert.equal(run.stdout.includes(secret), false, "stdout holds no credential");
		assert.equal(run.stderr.includes(secret), false, "stderr holds no credential");
	}
	assert.equal(run.grantAfter, run.grantBefore, "the valid grant is untouched");
}

function assertPayload(run: Awaited<ReturnType<typeof runCli>>) {
	const posts = run.captures.filter((c): c is Post => c.kind === "post");
	// Exactly one POST per sent generation: the failed WebSocket prewarm sends no POST, and the HTTP attempt is not repeated.
	assert.equal(posts.length, 2, "one POST for the read call and one for the final answer");
	// Hooks run once per logical prepared request, before final routing: the failed prewarm (generate:false), then one per sent POST.
	const hooks = run.captures.filter((c): c is Hook => c.kind === "hook");
	assert.equal(hooks.length, 3, "one hook for the failed prewarm and one per sent generation, none repeated for HTTP");
	assert.equal(hooks[0]!.generate, false, "first hook is the generate:false prewarm");
	assert.equal(hooks[0]!.hasToolOutput, false, "prewarm carries no tool output");
	assert.deepEqual(hooks.slice(1).map((h) => h.generate), [null, null], "both sent generations are real turns");
	assert.deepEqual(hooks.slice(1).map((h) => h.hasToolOutput), [false, true], "each sent POST matches its own hook, in order");
	const [first, second] = posts;
	for (const post of posts) {
		assert.equal(post.url, CODEX_ENDPOINT);
		assert.equal(post.body.model, "gpt-6.1-sol");
		assert.equal(post.body.stream, true);
		assert.equal(Object.hasOwn(post.body, "instructions"), false, "no top-level instructions");
		assert.equal(post.body.input[0].type, "additional_tools", "Lite: additional_tools prefix first");
		assert.equal(post.body.input[0].role, "developer");
		assert.ok(post.body.input.some((i: any) => i.type === "message" && i.role === "developer"), "developer base instructions");
	}
	// Turn one: the request holds no tool output yet.
	assert.equal(first!.body.input.some((i: any) => i.type === "function_call_output"), false);
	// Turn two: the native call is replayed with its raw argument string, and its output is paired by call id.
	const call = second!.body.input.find((i: any) => i.type === "function_call");
	const output = second!.body.input.find((i: any) => i.type === "function_call_output");
	assert.ok(call, "function_call replayed in turn two");
	assert.equal(call.call_id, output?.call_id, "tool output is paired with its call");
	assert.equal(typeof call.arguments, "string");
	assert.equal(call.arguments, JSON.stringify({ path: run.readPath }), "raw argument string, not re-stringified");
	assert.ok(JSON.stringify(output.output).includes("CLI_READ_CONTENT"), "read result reaches the model");
	return posts;
}

test(`RQW-codex real CLI [${MODE}]: Fast off, read round trip, one request per turn, no guard attempts`, { timeout: 60000 }, async () => {
	const run = await runCli("none");
	assertCleanRun(run);
	const posts = assertPayload(run);
	for (const post of posts) assert.equal(Object.hasOwn(post.body, "service_tier"), false, "no Fast priority by default");
});

test(`RQW-codex real CLI [${MODE}]: before_provider_request priority is honored in the final body`, { timeout: 60000 }, async () => {
	const run = await runCli("priority");
	assertCleanRun(run);
	const posts = assertPayload(run);
	for (const post of posts) assert.equal(post.body.service_tier, "priority", "the hook's replacement reaches the wire");
});
