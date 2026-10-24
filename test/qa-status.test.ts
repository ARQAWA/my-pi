import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { snapshot, render, run } from "../scripts/qa-status.mjs";
import { createQaStatus } from "../.pi/extensions/qa-status/index.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const temps: string[] = [];
after(() => { for (const p of temps) rmSync(p, { recursive: true, force: true }); });
const NOW = Date.parse("2026-10-23T02:00:00Z");
const record = (id = 1, extra = {}) => ({ id, path: ".github/workflows/tests.yml", run_attempt: 1, head_branch: "main", head_sha: "a".repeat(40),
	event: "schedule", status: "completed", conclusion: "success", created_at: "2026-10-23T00:00:00Z",
	html_url: `https://github.com/o/r/actions/runs/${id}`, ...extra });

function setup() {
	const tmp = mkdtempSync(join(tmpdir(), "qa-status-"));
	temps.push(tmp);
	const config = join(tmp, "gitconfig");
	writeFileSync(config, "[user]\n name = t\n email = t@example.com\n[commit]\n gpgsign = false\n");
	const env = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: config };
	const git = (...args: string[]) => execFileSync("git", args, { cwd: tmp, env, encoding: "utf8" }).trim();
	git("init", "--quiet", "-b", "main");
	git("commit", "--quiet", "--allow-empty", "-m", "base");
	git("remote", "add", "origin", "git@github.com:example/project.git");
	const cachePath = join(tmp, ".git", "ci-watch", "status.json");
	mkdirSync(dirname(cachePath), { recursive: true });
	const defaults = { "tests.yml": [record()], "pcli.yml": [record(2)],
		"qa-inbox.yml": [record(3)], "qa-digest.yml": [record(4)] };
	const set = (extra: any = {}, metadata: any = {}) => {
		const workflows = { ...defaults, ...extra };
		const runs = Object.entries(workflows).flatMap(([workflow, list]) => (list as any[])
			.map((r) => ({ ...r, path: `.github/workflows/${workflow}` })));
		writeFileSync(cachePath, JSON.stringify({ version: 1, repo: "example/project",
			fetchedAt: new Date(NOW).toISOString(), runs, ...metadata }));
	};
	set();
	const setInbox = (items: any[], fetchedAt = new Date(NOW).toISOString()) => {
		writeFileSync(join(dirname(cachePath), "inbox.json"), JSON.stringify({
			version: 1, repo: "example/project", fetchedAt, items,
		}));
	};
	const calls: { cmd: string; args: string[]; opts: any }[] = [];
	const execute = (cmd: string, args: string[], opts: any) => {
		calls.push({ cmd, args, opts });
		assert.equal(cmd, "git", "snapshot must never invoke gh or another network client");
		return run(cmd, args, { ...opts, env });
	};
	const get = (options = {}) => snapshot({ cwd: tmp, run: execute, now: () => NOW, ...options });
	return { tmp, git, set, setInbox, get, calls, env, cachePath };
}

describe("QA snapshot from watcher cache", () => {
	it("reports green runs, derives origin, and gives every child a bounded timeout", async () => {
		const t = setup();
		const state = await t.get();
		assert.equal(state.ok, true, render(state));
		assert.equal(state.items.filter((i: any) => i.id.startsWith("run:")).length, 4);
		assert.ok(state.items.filter((i: any) => i.id.startsWith("run:")).every((i: any) => i.level === "green"));
		assert.ok(t.calls.some((c) => c.args.join(" ") === "remote get-url origin"));
		assert.ok(t.calls.some((c) => c.args.includes("--git-common-dir")));
		assert.ok(t.calls.every((c) => c.cmd === "git" && c.opts.timeout > 0 && c.opts.timeout <= 11_000));
		assert.match(render(state), /inbox.*not refreshed/i);
	});
	it("reads a manually refreshed inbox sidecar with labels, rate and occurrence identity", async () => {
		const t = setup();
		const lastSeen = "2026-10-23T01:00:00Z";
		t.setInbox([{ id: `issue:7:${lastSeen}`, level: "red", url: "https://github.com/o/r/issues/7",
			text: `#7 [qa] a failure [qa-inbox] rate 2/6; lastSeen ${lastSeen}; occurrences 2` }]);
		const state = await t.get();
		assert.equal(state.items[0].id, `issue:7:${lastSeen}`);
		assert.equal(state.items[0].level, "red");
		assert.match(render(state), /rate 2\/6; lastSeen .*; occurrences 2/);
		assert.match(render(state, { onlyIds: [state.items[0].id] }), /qa-inbox/);
		assert.doesNotMatch(render(state, { onlyIds: [state.items[0].id] }), /GREEN/);
	});
	it("keeps the inbox refresh timestamp independent of fresh workflow runs", async () => {
		const t = setup();
		const fetchedAt = "2026-10-20T02:00:00.000Z";
		t.setInbox([], fetchedAt);
		const state = await t.get();
		assert.equal(state.ok, true, render(state));
		const inbox = state.items.find((i: any) => i.level === "info" && /inbox/i.test(i.text) && i.text.includes(fetchedAt));
		assert.ok(inbox, "the inbox must show its own older refresh timestamp");
		assert.match(inbox.text, /not (?:automatically )?refreshed|manual|on-demand/i);
		assert.match(render(state), /--refresh-inbox/);
		assert.equal(state.items.filter((i: any) => i.id.startsWith("run:") && i.level === "green").length, 4);
	});
	it("does not read legacy inbox items embedded in the workflow cache", async () => {
		const t = setup();
		t.set({}, { inboxItems: [{ id: "issue:99:legacy", level: "red", text: "legacy inbox item", url: "" }] });
		const state = await t.get();
		assert.equal(state.ok, true, render(state));
		assert.ok(!state.items.some((i: any) => i.id === "issue:99:legacy"));
		assert.match(render(state), /inbox.*not refreshed/i);
	});
	it("shows only the last three eligible main runs, including a failed attempt", async () => {
		const t = setup();
		t.set({ "tests.yml": [record(9, { event: "push" }), record(8, { event: "workflow_dispatch", conclusion: "failure", run_attempt: 2 }), record(7), record(6), record(5)] });
		const state = await t.get();
		assert.ok(state.items.some((i: any) => i.id === "run:8:2" && i.level === "red"));
		assert.ok(!state.items.some((i: any) => ["run:9:1", "run:5:1"].includes(i.id)));
	});
	it("checks the current branch against local HEAD, not an older or another branch run", async () => {
		const t = setup();
		t.git("checkout", "--quiet", "-b", "task");
		const sha = t.git("rev-parse", "HEAD");
		t.set({ "tests.yml": [record(10, { head_branch: "task" }), record(11, { head_sha: sha })] });
		let state = await t.get();
		assert.ok(state.items.some((i: any) => i.id === `branch:task:${sha}:missing` && i.level === "info"));
		for (const [status, conclusion, level] of [["in_progress", "", "pending"], ["completed", "failure", "red"], ["completed", "success", "green"]]) {
			t.set({ "tests.yml": [record(12, { head_branch: "task", head_sha: sha, status, conclusion })] });
			state = await t.get();
			assert.equal(state.items.find((i: any) => i.id.startsWith("branch:"))?.level, level);
		}
		t.git("checkout", "--quiet", "--detach");
		assert.ok(!(await t.get()).items.some((i: any) => i.id.startsWith("branch:")));
	});
	it("keeps other results when a workflow has no cached runs", async () => {
		const t = setup();
		t.set({ "qa-inbox.yml": [], "tests.yml": [record(8, { conclusion: "failure" })] });
		const state = await t.get();
		assert.equal(state.ok, true, render(state));
		assert.ok(state.items.some((i: any) => i.level === "info" && /qa-inbox.*no runs/.test(i.text)));
		assert.ok(state.items.some((i: any) => i.id === "run:8:1" && i.level === "red"));
		assert.ok(state.items.some((i: any) => i.id === "run:4:1" && i.level === "green"));
		assert.doesNotMatch(render(state), /unavailable/);
	});
	it("selects the latest inbox and digest runs and three eligible pcli runs", async () => {
		const t = setup();
		t.set({ "pcli.yml": [record(20, { event: "push" }), record(19, { head_branch: "task" }),
			record(18), record(17, { event: "workflow_dispatch" }), record(16), record(15)],
			"qa-inbox.yml": [record(30), record(31)], "qa-digest.yml": [record(40), record(41)] });
		const state = await t.get();
		const ids = state.items.map((i: any) => i.id);
		for (const id of [18, 17, 16, 31, 41]) assert.ok(ids.includes(`run:${id}:1`));
		for (const id of [20, 19, 15, 30, 40]) assert.ok(!ids.includes(`run:${id}:1`));
	});
	it("accepts the freshness boundary but rejects stale, future, missing and malformed cache", async () => {
		const t = setup();
		t.set({}, { fetchedAt: new Date(NOW - 180_000).toISOString() });
		assert.equal((await t.get()).ok, true);
		for (const fetchedAt of [new Date(NOW - 180_001).toISOString(), new Date(NOW + 1).toISOString()]) {
			t.set({}, { fetchedAt });
			const state = await t.get();
			assert.equal(state.ok, false);
			assert.match(render(state), /npm run ci-watch/);
			assert.doesNotMatch(render(state), /GREEN/);
		}
		rmSync(t.cachePath);
		const missing = await t.get();
		assert.equal(missing.ok, false);
		assert.match(render(missing), /npm run ci-watch/);
		writeFileSync(t.cachePath, "not json");
		assert.equal((await t.get()).ok, false);
	});
	it("supports an explicit cache path and rejects a different repository", async () => {
		const t = setup();
		const override = join(t.tmp, "override.json");
		writeFileSync(override, readFileSync(t.cachePath));
		rmSync(t.cachePath);
		assert.equal((await t.get({ cachePath: override, repo: "example/project" })).ok, true);
		assert.equal((await t.get({ cachePath: override, repo: "other/project" })).ok, false);
	});
	it("reports unavailable, never green, on watcher failure; CLI always exits zero", async () => {
		const t = setup();
		t.set({}, { error: "watcher offline", fetchedAt: new Date().toISOString() });
		const state = await t.get({ now: () => Date.now() });
		assert.equal(state.ok, false);
		assert.match(render(state), /^QA status unavailable:.*watcher offline/);
		assert.doesNotMatch(render(state), /GREEN/);
		const cli = spawnSync(process.execPath, [join(ROOT, "scripts/qa-status.mjs"), "--json"], { cwd: t.tmp, env: t.env, encoding: "utf8", timeout: 20_000 });
		assert.equal(cli.status, 0, cli.stderr);
		assert.equal(JSON.parse(cli.stdout).ok, false);
	});
});

function harness() {
	let time = Date.parse("2026-10-23T00:00:00Z");
	let calls = 0;
	let value: any = { ok: true, at: new Date(time).toISOString(), items: [] };
	const hooks: any = {}, commands: any = {}, sent: any[] = [], notices: any[] = [];
	const pi = { on: (event: string, handler: any) => { hooks[event] = handler; },
		registerCommand: (name: string, command: any) => { commands[name] = command; },
		sendMessage: (...args: any[]) => sent.push(args) };
	const ctx = { cwd: ROOT, ui: { notify: (...args: any[]) => notices.push(args) } };
	let block: Promise<void> | undefined;
	const api = createQaStatus({ pi, now: () => time, getSnapshot: async () => { calls++; if (block) await block;
		return { ...value, at: new Date(time).toISOString() }; } });
	const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
	return { hooks, commands, sent, notices, ctx, api, flush, calls: () => calls,
		set: (v: any) => { value = v; }, advance: (ms: number) => { time += ms; }, block: (p: Promise<void>) => { block = p; } };
}
const red = (id: string) => ({ ok: true, items: [{ id, level: "red", text: "failure", url: "https://example.com" }] });

describe("QA project extension", () => {
	it("does not start work in the factory, stays silent when green, and throttles refresh by timestamp", async () => {
		const h = harness();
		assert.equal(h.calls(), 0);
		assert.equal(h.hooks.session_start({}, h.ctx), undefined, "startup must not await the snapshot");
		await h.flush();
		assert.equal(h.calls(), 1);
		assert.equal(h.sent.length, 0);
		h.advance(59_999);
		h.hooks.agent_start({}, h.ctx);
		await h.flush();
		assert.equal(h.calls(), 1);
		h.advance(2);
		h.hooks.agent_start({}, h.ctx);
		await h.flush();
		assert.equal(h.calls(), 2);
	});
	it("sends each red id once, sends new occurrences again, and uses non-triggering nextTurn", async () => {
		const h = harness();
		h.set(red("issue:7:first"));
		h.hooks.session_start({}, h.ctx);
		await h.flush();
		assert.equal(h.sent.length, 1);
		assert.deepEqual(h.sent[0][1], { deliverAs: "nextTurn", triggerTurn: false });
		assert.equal(h.sent[0][0].display, true);
		assert.match(h.sent[0][0].content, /PROCESS.md Quality control loop/);
		await h.api.refresh(ROOT);
		assert.equal(h.sent.length, 1);
		h.set(red("issue:7:second"));
		await h.api.refresh(ROOT);
		assert.equal(h.sent.length, 2);
	});
	it("keeps one snapshot in flight and /qa shows a fresh full status", async () => {
		const h = harness();
		let release!: () => void;
		h.block(new Promise<void>((resolve) => { release = resolve; }));
		h.hooks.session_start({}, h.ctx);
		h.hooks.agent_start({}, h.ctx);
		await h.flush();
		assert.equal(h.calls(), 1);
		release();
		await h.flush();
		assert.ok(h.commands.qa);
		await h.commands.qa.handler("", h.ctx);
		assert.equal(h.calls(), 2);
		assert.equal(h.notices[0][0], "QA: no items");
	});
	it("shows unavailable only once per session", async () => {
		const h = harness();
		h.set({ ok: false, items: [], error: "QA status unavailable: offline" });
		await h.api.refresh(ROOT);
		await h.api.refresh(ROOT);
		assert.equal(h.sent.length, 1);
		assert.equal(h.sent[0][0].content, "QA status unavailable: offline");
		h.hooks.session_start({}, h.ctx);
		await h.flush();
		assert.equal(h.sent.length, 2);
	});
	it("converts a rejected snapshot to a single unavailable notice", async () => {
		const sent: any[] = [];
		const api = createQaStatus({ pi: { on() {}, registerCommand() {}, sendMessage: (...args: any[]) => { sent.push(args); } },
			getSnapshot: async () => { throw new Error("offline"); } });
		await api.refresh(ROOT);
		await api.refresh(ROOT);
		assert.equal(sent.length, 1);
		assert.match(sent[0][0].content, /^QA status unavailable: offline$/);
	});
	it("Pi 1.4.0 discovers and loads the project directory entry without starting a snapshot", async () => {
		const { discoverAndLoadExtensions } = await import("../node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js");
		const agentDir = mkdtempSync(join(tmpdir(), "qa-status-discovery-"));
		temps.push(agentDir);
		const result = await discoverAndLoadExtensions([], ROOT, agentDir);
		assert.deepEqual(result.errors, []);
		assert.ok(result.extensions.some((e: any) => e.path === join(ROOT, ".pi", "extensions", "qa-status", "index.ts")));
	});
	it("contains no timers and remains outside the shipped extension list", () => {
		const source = readFileSync(join(ROOT, ".pi/extensions/qa-status/index.ts"), "utf8");
		assert.doesNotMatch(source, /\b(?:setTimeout|setInterval|spawn|execFile)\s*\(/);
		const manifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
		assert.ok(manifest.pi.extensions.every((p: string) => !p.includes("qa-status")));
	});
});
