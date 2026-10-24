import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runCli } from "../cli/web/main.ts";
import type { TargetResult, TargetRunner } from "../cli/web/types.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BIN = join(ROOT, "bin", "rqw-web.mjs");
const caller = ["--caller-model", "anthropic/claude-opus-5-5", "--thinking", "medium"];

const ok = (run: Parameters<TargetRunner>[0]): TargetResult => ({
	target: run.target, model: run.model, effort: run.effort, mode: run.mode, responseLength: run.responseLength,
	status: "ok", summary: `Answer for ${run.target.value}`, sources: [{ url: "https://example.com/doc", title: "Doc" }],
	citations: [], actions: [], results: [],
});

async function cli(argv: string[], runner?: TargetRunner) {
	let stdout = "";
	let stderr = "";
	const code = await runCli(argv, { stdout: text => (stdout += text), stderr: text => (stderr += text) }, { runner, tmpRoot: mkdtempSync(join(tmpdir(), "rqw-web-main-")) });
	return { code, stdout, stderr };
}

describe("rqw-web macOS development tooling", {
	skip: process.platform !== "darwin" && "Repo-local development tooling is macOS-only by owner rule; Windows support belongs to later package tool-wrapper phase.",
}, () => {
describe("rqw-web main", () => {
	it("exit 0 when every target succeeds, with the mapped model in the report", async () => {
		const out = await cli([...caller, "--query", "one", "--query", "two"], async run => ok(run));
		assert.equal(out.code, 0);
		assert.match(out.stdout, /2 targets, 2 ok, 0 failed/);
		assert.match(out.stdout, /search model gpt-6\.1-sol, effort high, mode cached/);
		assert.ok(out.stdout.indexOf("Answer for one") < out.stdout.indexOf("Answer for two"));
	});

	it("exit 1 when one target fails and the other result is kept", async () => {
		const out = await cli([...caller, "--url", "https://example.com/a", "--url", "https://example.com/b"], async run => {
			if (run.target.value.endsWith("/a")) throw new Error("network down");
			return ok(run);
		});
		assert.equal(out.code, 1);
		assert.match(out.stdout, /1 ok, 1 failed/);
		assert.match(out.stdout, /Error \(error\): network down/);
		assert.match(out.stdout, /Answer for https:\/\/example\.com\/b/);
	});

	it("exit 2 for bad arguments and never calls the engine or prints to stdout", async () => {
		let called = false;
		const out = await cli(["--query", "x"], async run => (called = true, ok(run)));
		assert.equal(out.code, 2);
		assert.equal(called, false);
		assert.equal(out.stdout, "");
		assert.match(out.stderr, /--caller-model is required/);
	});

	it("exit 2 and a plain message for Claude off or minimal", async () => {
		const out = await cli(["--caller-model", "anthropic/claude-haiku-5-5", "--thinking", "off", "--query", "x"], async run => ok(run));
		assert.equal(out.code, 2);
		assert.match(out.stderr, /Unsupported/);
	});
});

describe("rqw-web executable", () => {
	it("explains how to install missing local dependencies without a loader stack trace", () => {
		const root = tempRoot("rqw-web-no-deps-");
		const bin = join(root, "rqw-web.mjs");
		copyFileSync(BIN, bin);
		const result = spawnSync(process.execPath, [bin, "--help"], { cwd: tmpdir(), encoding: "utf8" });
		assert.equal(result.status, 1);
		assert.equal(result.stdout, "");
		assert.equal(result.stderr, "rqw-web: Local development dependencies are missing. Run npm ci in the repository checkout, then retry.\n");
	});

	it("prints help from any cwd without loading auth or the network", () => {
		const result = spawnSync(process.execPath, [BIN, "--help"], { cwd: tmpdir(), encoding: "utf8", env: { ...process.env, PI_CODING_AGENT_DIR: "/nonexistent-rqw-web-dir" } });
		assert.equal(result.status, 0);
		assert.match(result.stdout, /^rqw-web - /);
		assert.equal(result.stderr, "");
	});

	it("exits 2 on bad arguments", () => {
		const result = spawnSync(process.execPath, [BIN, "--nope"], { cwd: tmpdir(), encoding: "utf8" });
		assert.equal(result.status, 2);
		assert.equal(result.stdout, "");
	});
});

// Only repository execution is supported in phase 1; no installed-package fixture.
const tempRoots: string[] = [];
function tempRoot(prefix: string): string {
	const root = mkdtempSync(join(tmpdir(), prefix));
	tempRoots.push(root);
	return root;
}
after(() => { for (const root of tempRoots) rmSync(root, { recursive: true, force: true }); });

const MANIFEST = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const LOCK = JSON.parse(readFileSync(join(ROOT, "package-lock.json"), "utf8"));

// An expired login made only of fake values: the engine must refuse it through the read-only store, with no network.
function fakeExpiredAuthDir(): { dir: string; file: string; before: string } {
	const part = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
	const access = `${part({ alg: "none" })}.${part({ exp: 1_000_000, "https://api.openai.com/auth": { chatgpt_account_id: "fake-account" } })}.fake`;
	const dir = tempRoot("rqw-web-auth-");
	const file = join(dir, "auth.json");
	writeFileSync(file, JSON.stringify({ "openai-codex": { type: "oauth", access, refresh: "fake-refresh", expires: 1_000_000_000 } }));
	return { dir, file, before: readFileSync(file, "utf8") };
}

// Runs one target against the fake expired login with the network switched off and checks the safe auth outcome.
function assertExpiredLoginRun(): void {
	const auth = fakeExpiredAuthDir();
	const mtime = statSync(auth.file).mtimeMs;
	const noFetch = join(auth.dir, "no-fetch.mjs");
	writeFileSync(noFetch, 'globalThis.fetch = () => { throw new Error("network attempted"); };\n');
	const result = spawnSync(process.execPath, ["--import", pathToFileURL(noFetch).href, BIN, ...caller, "--query", "x"], {
		cwd: tmpdir(), encoding: "utf8", env: { ...process.env, PI_CODING_AGENT_DIR: auth.dir },
	});
	assert.equal(result.status, 1, result.stderr);
	assert.match(result.stdout, /Error \(authentication_failed\)/);
	assert.match(result.stdout, /use Pi or run \/login openai-codex, then repeat the command/);
	assert.doesNotMatch(result.stdout, /Retry;/);
	assert.match(result.stdout, /search model gpt-6\.1-sol, effort high/);
	assert.equal(`${result.stdout}${result.stderr}`.includes("fake-refresh"), false);
	assert.equal(readFileSync(auth.file, "utf8"), auth.before);
	assert.equal(statSync(auth.file).mtimeMs, mtime);
}

describe("rqw-web repository development dependencies", () => {
	it("keeps exact development dependencies without exposing a package command or extension", () => {
		assert.equal(MANIFEST.devDependencies["@earendil-works/pi-coding-agent"], "1.4.0");
		assert.equal(MANIFEST.devDependencies["@earendil-works/pi-ai"], "1.4.0");
		assert.equal(MANIFEST.devDependencies.jiti, "2.7.0");
		assert.equal(MANIFEST.peerDependencies["@earendil-works/pi-coding-agent"], "1.4.0");
		assert.deepEqual(MANIFEST.dependencies, { "smol-toml": "1.9.1", ws: "8.22.0" });
		assert.deepEqual(LOCK.packages[""].dependencies, MANIFEST.dependencies);
		assert.deepEqual(LOCK.packages[""].devDependencies, MANIFEST.devDependencies);
		assert.equal(MANIFEST.bin, undefined);
		assert.equal(MANIFEST.pi.extensions.some((path: string) => /web|cli/.test(path)), false);
	});

	it("runs a repository target from another cwd with fake expired auth: login hint, no network, secrets hidden and auth unchanged", () => {
		assertExpiredLoginRun();
	});
});

});
