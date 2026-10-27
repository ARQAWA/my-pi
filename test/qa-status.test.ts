import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, it } from "node:test";
import { render, snapshot } from "../scripts/qa-status.mjs";
import { createQaStatus } from "../.pi/extensions/qa-status/index.ts";

const dir = mkdtempSync(join(tmpdir(), "qa-status-"));
after(() => rmSync(dir, { recursive: true, force: true }));

it("reports red main runs, notifies once and shows full status through /qa", async () => {
	const now = Date.parse("2026-10-23T02:00:00Z");
	const cachePath = join(dir, "status.json");
	const base = { run_attempt: 1, head_branch: "main", head_sha: "a".repeat(40), event: "schedule",
		status: "completed", created_at: "2026-10-23T00:00:00Z" };
	writeFileSync(cachePath, JSON.stringify({ version: 1, repo: "o/r", fetchedAt: new Date(now).toISOString(), runs: [
		{ ...base, id: 1, path: ".github/workflows/tests.yml", conclusion: "failure", html_url: "https://x/1" },
		{ ...base, id: 2, path: ".github/workflows/pcli.yml", conclusion: "success", html_url: "https://x/2" },
	] }));
	const execute = async (command: string, args: string[]) => {
		assert.equal(command, "git");
		return args[1] === "--abbrev-ref" ? "main" : "a".repeat(40);
	};
	const state = await snapshot({ cwd: dir, repo: "o/r", cachePath, run: execute, now: () => now });

	assert.equal(state.ok, true, render(state));
	assert.deepEqual(state.items.map((item) => [item.id, item.level]), [["run:1:1", "red"], ["run:2:1", "green"]]);
	assert.match(render(state), /RED main tests: failure #1 attempt 1 https:\/\/x\/1/);

	const commands: Record<string, any> = {};
	const sent: any[] = [];
	const notices: any[] = [];
	const pi = {
		on() {},
		registerCommand(name: string, command: any) { commands[name] = command; },
		sendMessage(...args: any[]) { sent.push(args); },
	};
	const api = createQaStatus({ pi, getSnapshot: async () => state, now: () => now });
	await api.refresh(dir);
	await api.refresh(dir);
	assert.equal(sent.length, 1);
	assert.match(sent[0][0].content, /RED main tests: failure #1/);
	assert.deepEqual(sent[0][1], { deliverAs: "nextTurn", triggerTurn: false });

	await commands.qa.handler("", { cwd: dir, ui: { notify: (...args: any[]) => notices.push(args) } });
	assert.equal(notices.length, 1);
	assert.match(notices[0][0], /GREEN main pcli: success #2 attempt 1 https:\/\/x\/2/);
	assert.equal(notices[0][1], "info");
});
