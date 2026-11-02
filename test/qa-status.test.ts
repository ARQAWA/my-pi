import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, it } from "node:test";
import { render, snapshot } from "../scripts/qa-status.mjs";
import { createQaStatus } from "../.pi/extensions/qa-status/index.ts";

const dir = mkdtempSync(join(tmpdir(), "qa-status-"));
after(() => rmSync(dir, { recursive: true, force: true }));

it("shows the three newest matching push runs for each delivery workflow", async () => {
	const now = Date.parse("2026-10-23T02:00:00Z");
	const cachePath = join(dir, "delivery-runs.json");
	const runs = [];
	for (const [workflow, branch] of [["tests.yml", "release"], ["pcli.yml", "pcli"]]) {
		for (let i = 1; i <= 4; i++) {
			runs.push({ id: `${branch}-${i}`, head_branch: branch, event: "push", path: `.github/workflows/${workflow}`,
				status: "completed", conclusion: "success", created_at: `2026-10-23T00:00:0${i}Z` });
		}
		runs.push({ id: `${branch}-wrong`, head_branch: branch, event: "schedule", path: `.github/workflows/${workflow}`,
			status: "completed", conclusion: "failure", created_at: "2026-10-23T00:01:00Z" });
	}
	writeFileSync(cachePath, JSON.stringify({ version: 1, repo: "o/r", fetchedAt: new Date(now).toISOString(), runs }));
	const execute = async (_command: string, args: string[]) => args[1] === "--abbrev-ref" ? "main" : "a".repeat(40);
	const state = await snapshot({ cwd: dir, repo: "o/r", cachePath, run: execute, now: () => now });
	assert.equal(state.ok, true, render(state));
	assert.deepEqual(state.items.map(item => item.id), ["run:release-4:1", "run:release-3:1", "run:release-2:1",
		"run:pcli-4:1", "run:pcli-3:1", "run:pcli-2:1"]);
});

it("reports release and pcli push runs from main, notifies once and shows full status through /qa", async () => {
	const now = Date.parse("2026-10-23T02:00:00Z");
	const cachePath = join(dir, "status.json");
	const base = { run_attempt: 1, head_branch: "release", head_sha: "a".repeat(40), event: "push",
		status: "completed", created_at: "2026-10-23T00:00:00Z" };
	writeFileSync(cachePath, JSON.stringify({ version: 1, repo: "o/r", fetchedAt: new Date(now).toISOString(), runs: [
		{ ...base, id: 1, path: ".github/workflows/tests.yml", conclusion: "failure", html_url: "https://x/1" },
		{ ...base, head_branch: "pcli", id: 2, path: ".github/workflows/pcli.yml", conclusion: "success", html_url: "https://x/2" },
	] }));
	const execute = async (command: string, args: string[]) => {
		assert.equal(command, "git");
		return args[1] === "--abbrev-ref" ? "main" : "a".repeat(40);
	};
	const state = await snapshot({ cwd: dir, repo: "o/r", cachePath, run: execute, now: () => now });

	assert.equal(state.ok, true, render(state));
	assert.deepEqual(state.items.map((item) => [item.id, item.level]), [["run:1:1", "red"], ["run:2:1", "green"]]);
	assert.match(render(state), /RED release tests: failure #1 attempt 1 https:\/\/x\/1/);

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
	assert.match(sent[0][0].content, /RED release tests: failure #1/);
	assert.deepEqual(sent[0][1], { deliverAs: "nextTurn", triggerTurn: false });

	await commands.qa.handler("", { cwd: dir, ui: { notify: (...args: any[]) => notices.push(args) } });
	assert.equal(notices.length, 1);
	assert.match(notices[0][0], /GREEN pcli: success #2 attempt 1 https:\/\/x\/2/);
	assert.equal(notices[0][1], "info");
});

it("sends the whole snapshot's red and green counts, with only the new red lines as content", async () => {
	const at = "2026-10-23T02:00:00.000Z";
	const item = (id: string, level: string) => ({ id, level, text: `item ${id}`, url: `https://x/${id}` });
	const first = { ok: true, at, items: [item("r1", "red"), item("g1", "green")] };
	const second = { ok: true, at, items: [item("r1", "red"), item("r2", "red"), item("g1", "green"), item("g2", "green"), item("g3", "green")] };
	const allGreen = { ok: true, at, items: [item("g1", "green"), item("g2", "green")] };
	const sent: any[] = [];
	let state: any = first;
	const pi = { on() {}, registerCommand() {}, sendMessage(...args: any[]) { sent.push(args); } };
	const api = createQaStatus({ pi, getSnapshot: async () => state, now: () => Date.parse(at) });

	await api.refresh(dir);
	state = second;
	await api.refresh(dir);
	assert.equal(sent.length, 2);
	assert.deepEqual(sent[0][0].details, { red: 1, green: 1 });
	assert.equal(sent[1][0].content, "RED item r2 https://x/r2");
	assert.deepEqual(sent[1][0].details, { red: 2, green: 3 });

	state = allGreen;
	await api.refresh(dir);
	assert.equal(sent.length, 2);
});
