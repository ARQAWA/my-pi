// Real CLI entrypoints with faux-only providers. Default Node; PI_REVIEW_TEST_RUNTIME=bun tests the release runtime.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../..");
const runtime = process.env.PI_REVIEW_TEST_RUNTIME ?? process.execPath;
const bun = runtime === "bun";

describe(`${bun ? "Bun" : "Node"} CLI review delivery`, () => {
	for (const mode of ["print", "json"] as const) {
		it(`${mode} waits for the verdict and lets Main answer it before exit`, async () => {
			const dir = await mkdtemp(join(tmpdir(), "rqw-review-cli-"));
			const agent = join(dir, "agent");
			await mkdir(agent);
			const cli = join(repo, `node_modules/@earendil-works/pi-coding-agent/dist/${bun ? "bun/" : ""}cli.js`);
			const child = spawn(runtime, [bun ? "--preload" : "--import", join(here, "offline.mjs"), cli,
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
				if (mode === "json") assert.ok(stdout.includes("[review#1] CLEAN"), stdout);
			} finally {
				clearTimeout(timeout);
				child.kill("SIGKILL");
				await rm(dir, { recursive: true, force: true });
			}
		});
	}
});
