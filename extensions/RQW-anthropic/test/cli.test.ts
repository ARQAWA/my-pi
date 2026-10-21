import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { it } from "node:test";
import { entries } from "./pi-entrypoints.ts";

const own = fileURLToPath(new URL("../index.ts", import.meta.url));
const cli = fileURLToPath(new URL("./bundle/cli.js", import.meta.resolve("@earendil-works/pi-coding-agent")));

it("passes a file URL to Node ESM preload, including paths with spaces", () => {
	const path = join(tmpdir(), "offline guard.mjs");
	const specifier = pathToFileURL(path).href;
	assert.equal(new URL(specifier).protocol, "file:");
	assert.ok(specifier.includes("offline%20guard.mjs"));
	assert.equal(fileURLToPath(specifier), path);
});

it("actual CLI keeps native metadata and RPC handling of unsupported adapter conflicts", {
	skip: entries.some(([label]) => label === "CLI bundle") ? false : "stock CLI bundle cannot import on Bun 1.3.14",
	timeout: 120_000,
}, async () => {
	const root = await mkdtemp(join(tmpdir(), "rqw-anthropic-cli-"));
	try {
		const guard = join(root, "offline.mjs");
		await writeFile(guard, "globalThis.fetch=async()=>{throw new Error('External network forbidden');};");
		const fixture = join(root, "competing.ts");
		await writeFile(fixture, `export default function(pi) {
			pi.registerProvider("anthropic", { api:"anthropic-messages", streamSimple(){throw new Error("unused");} });
			pi.on("context", () => {}); pi.registerCommand("claude-refusal-rewind", {handler:async()=>{}});
		}`);
		const competitor = process.env.RQW_ANTHROPIC_CONFLICT_EXTENSION ?? fixture;
		await writeFile(join(root, "auth.json"), JSON.stringify({
			anthropic: { type: "oauth", access: "sk-ant-oat01-fake-cli", refresh: "fake-refresh", expires: Date.now() + 3600_000 },
			openrouter: { type: "api_key", key: "fake-other" },
		}));
		await writeFile(join(root, "settings.json"), JSON.stringify({ packages: [], extensions: [], defaultProvider: "anthropic", defaultModel: "claude-sonnet-4-5" }));
		const env = { ...process.env, HOME: root, USERPROFILE: root, PI_CODING_AGENT_DIR: root, PI_OFFLINE: "1", PI_SKIP_VERSION_CHECK: "1", NO_COLOR: "1" };
		for (const key of Object.keys(env)) if (/(API_KEY|AUTH_TOKEN|OAUTH_TOKEN)$/.test(key)) delete env[key];
		async function run(paths: string[], mode: string[]) {
			return new Promise<{ code: number | null; out: string; err: string }>((resolve, reject) => {
				const child = spawn(process.execPath, ["--import", pathToFileURL(guard).href, cli, "--no-skills", "--no-prompt-templates", "--no-themes", "--no-context-files", "--no-session",
					...paths.flatMap(path => ["-e", path]), ...mode], { cwd: root, env, stdio: ["pipe", "pipe", "pipe"] });
				let out = "", err = "";
				// Real child-process watchdog only; success waits on close, never on elapsed time.
				const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("Offline CLI timed out")); }, 25_000);
				child.stdout.on("data", data => { out += data; });
				child.stderr.on("data", data => { err += data; });
				child.on("error", error => { clearTimeout(timer); reject(error); });
				child.on("close", code => { clearTimeout(timer); resolve({ code, out, err }); });
				child.stdin.end();
			});
		}
		for (const paths of [[own, competitor], [competitor, own]]) {
			for (const mode of [["--list-models"], ["--mode", "rpc"]]) {
				const result = await run(paths, mode);
				if (mode[0] === "--list-models") {
					// Stock Pi lists metadata before reporting runtime registration diagnostics.
					assert.equal(result.code, 0, JSON.stringify({ paths, mode, ...result }));
					assert.match(result.out, /^provider\s+model/m);
				} else {
					assert.equal(result.code, 1, JSON.stringify({ paths, mode, ...result }));
					assert.match(result.out + result.err, /another Anthropic extension.*keep auth.json/);
				}
			}
		}
		const healthy = await run([own], ["--list-models"]);
		assert.equal(healthy.code, 0, healthy.err);
		assert.match(healthy.out, /^anthropic\s/m);
		assert.doesNotMatch(healthy.out, /^openrouter\s/m);
	} finally { await rm(root, { recursive: true, force: true }); }
});
