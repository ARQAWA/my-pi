import "./guard.mjs";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { promisify } from "node:util";
import { once, PROMPT, ROOT } from "./fixture.ts";

const execute = promisify(execFile);
for (const mode of ["text", "json"]) {
	for (const custom of [false, true]) {
		it(`real CLI ${mode} ${custom ? "honors --system-prompt" : "uses RQW for the default prefix"}`, async () => {
			const cwd = await mkdtemp(join(tmpdir(), "rqw-prompt-cli-"));
			try {
				const agentDir = join(cwd, "agent"); await mkdir(agentDir);
				await writeFile(join(agentDir, "models.json"), JSON.stringify({ providers: { "openai-codex": { apiKey: "faux-only" } } }));
				await writeFile(join(cwd, "AGENTS.md"), "CLI_CONTEXT_SENTINEL");
				const args = ["--import", join(import.meta.dirname, "guard.mjs"),
					join(ROOT, "node_modules/@earendil-works/pi-coding-agent/dist/cli.js"),
					"-ne", "-e", join(import.meta.dirname, "cli-faux.ts"), "-e", PROMPT,
					"--model", "openai-codex/gpt-6.1-sol", "--no-skills", "--no-prompt-templates", "--no-themes", "--no-mcp", "--no-session",
					"--tools", "read,bash,edit,write", "--append-system-prompt", "CLI_APPEND_SENTINEL",
					...(custom ? ["--system-prompt", "CLI_CUSTOM_PREFIX_SENTINEL"] : []), "--mode", mode, "--print", "faux regression"];
				const child = execute(process.execPath, args, {
					cwd, timeout: 30000, maxBuffer: 5000000,
					env: { PATH: process.env.PATH, HOME: cwd, USERPROFILE: cwd, PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: "1", PI_SKIP_VERSION_CHECK: "1", NO_COLOR: "1" },
				});
				child.child.stdin?.end();
				const { stdout, stderr } = await child;
				assert.doesNotMatch(stderr, /Failed to load|Extension error|PROMPT_NETWORK_ATTEMPTS/);
				let got;
				if (mode === "text") got = JSON.parse(stdout.trim());
				else {
					const events = stdout.trim().split("\n").map(line => JSON.parse(line));
					const final = events.filter(event => event.type === "message_end" && event.message?.role === "assistant").at(-1);
					assert.ok(final);
					got = JSON.parse(final.message.content.filter((block: { type: string }) => block.type === "text").map((block: { text: string }) => block.text).join(""));
				}
				once(got.prompt, custom ? "CLI_CUSTOM_PREFIX_SENTINEL" : "You are a coding agent in pi");
				if (custom) assert.doesNotMatch(got.prompt, /You are a coding agent in pi|<workstation>/);
				for (const text of ["CLI_CONTEXT_SENTINEL", "CLI_APPEND_SENTINEL", "<cwd>"]) once(got.prompt, text);
				assert.deepEqual(got.tools.sort(), ["bash", "edit", "read", "write"]);
				assert.equal(got.systemMessages.length, 1);
			} finally { await rm(cwd, { recursive: true, force: true }); }
		});
	}
}
