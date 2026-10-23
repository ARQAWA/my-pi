import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { snapshot, render, run } from "../scripts/qa-status.mjs";
import { encodeState } from "../scripts/qa-state.mjs";
import { createQaStatus } from "../.pi/extensions/qa-status/index.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const temps: string[] = [];
after(() => { for (const p of temps) rmSync(p, { recursive: true, force: true }); });
const record = (id = 1, extra = {}) => ({ id, run_attempt: 1, head_branch: "main", head_sha: "a".repeat(40),
	event: "schedule", status: "completed", conclusion: "success", created_at: "2026-10-23T00:00:00Z",
	html_url: `https://github.com/o/r/actions/runs/${id}`, ...extra });

function setup() {
	const tmp = mkdtempSync(join(tmpdir(), "qa-status-"));
	temps.push(tmp);
	const bin = join(tmp, "bin");
	mkdirSync(bin);
	const data = join(tmp, "data.json");
	const calls = join(tmp, "calls.jsonl");
	writeFileSync(join(bin, "gh.mjs"), `import { readFileSync, appendFileSync } from "node:fs";
const endpoint = process.argv[3];
appendFileSync(process.env.FAKE_QA_CALLS, JSON.stringify(endpoint) + "\\n");
const data = JSON.parse(readFileSync(process.env.FAKE_QA_DATA, "utf8"));
if (data.fail) { console.error("fake gh unavailable"); process.exit(1); }
if (endpoint.includes("/issues?")) console.log(JSON.stringify(data.issues ?? []));
else if (endpoint.includes("/git/matching-refs/")) console.log(JSON.stringify(data.refs ?? []));
else {
 const workflow = endpoint.match(/workflows\\/([^/]+)\\/runs/)[1];
 if (data.workflowErrors?.[workflow]) { console.error(data.workflowErrors[workflow]); process.exit(1); }
 const params = new URLSearchParams(endpoint.split("?")[1]);
 const runs = (data[workflow] ?? []).filter(r => (!params.has("event") || r.event === params.get("event")) &&
 (!params.has("branch") || r.head_branch === params.get("branch")));
 console.log(JSON.stringify({ workflow_runs: runs }));
}
`);
	if (process.platform === "win32") writeFileSync(join(bin, "gh.cmd"), `@"${process.execPath}" "%~dp0gh.mjs" %*\r\n`);
	else {
		writeFileSync(join(bin, "gh"), `#!/bin/sh\nexec "${process.execPath}" "${join(bin, "gh.mjs")}" "$@"\n`);
		chmodSync(join(bin, "gh"), 0o755);
	}
	const config = join(tmp, "gitconfig");
	writeFileSync(config, "[user]\n name = t\n email = t@example.com\n[commit]\n gpgsign = false\n");
	const pathKey = Object.keys(process.env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
	const env = { ...process.env, [pathKey]: bin + delimiter + process.env[pathKey],
		GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: config, FAKE_QA_DATA: data, FAKE_QA_CALLS: calls };
	const git = (...args: string[]) => execFileSync("git", args, { cwd: tmp, env, encoding: "utf8" }).trim();
	git("init", "--quiet", "-b", "main");
	git("commit", "--quiet", "--allow-empty", "-m", "base");
	git("remote", "add", "origin", "git@github.com:example/project.git");
	const set = (extra = {}) => writeFileSync(data, JSON.stringify({ issues: [],
		"tests.yml": [record()], "pcli.yml": [record(2)], "qa-inbox.yml": [record(3)], "qa-digest.yml": [record(4)], ...extra }));
	set();
	const get = () => snapshot({ cwd: tmp, run: (cmd: string, args: string[], opts: object) => run(cmd, args, { ...opts, env }) });
	return { tmp, git, set, get, calls, env };
}

describe("QA snapshot with fake gh", () => {
	it("reports green runs, derives origin, and gives every child a bounded timeout", async () => {
		const t = setup();
		const state = await t.get();
		assert.equal(state.ok, true, render(state));
		assert.equal(state.items.length, 4);
		assert.ok(state.items.every((i: any) => i.level === "green"));
		assert.match(readFileSync(t.calls, "utf8"), /repos\/example\/project\//);
		const commands: any[] = [];
		await snapshot({ cwd: t.tmp, repo: "o/r", run: async (cmd: string, args: string[], opts: any) => {
			commands.push(opts); return run(cmd, args, { ...opts, env: t.env });
		} });
		assert.ok(commands.every((o) => o.timeout > 0 && o.timeout <= 11_000));
	});
	it("decodes a red inbox issue, including labels, rate and occurrence identity", async () => {
		const t = setup();
		const lastSeen = "2026-10-23T01:00:00Z";
		t.set({ issues: [{ number: 7, title: "[qa] a failure", labels: [{ name: "qa-inbox" }],
			html_url: "https://github.com/o/r/issues/7", body: encodeState({ signature: "abc1234", lastSeen,
				rate: { k: 2, n: 6 }, occurrences: [{}, {}] }) }] });
		const state = await t.get();
		assert.equal(state.items[0].id, `issue:7:${lastSeen}`);
		assert.equal(state.items[0].level, "red");
		assert.match(render(state), /rate 2\/6; lastSeen .*; occurrences 2/);
		assert.match(render(state, { onlyIds: [state.items[0].id] }), /qa-inbox/);
		assert.doesNotMatch(render(state, { onlyIds: [state.items[0].id] }), /GREEN/);
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
	it("keeps other results when a workflow is not on the default branch yet", async () => {
		const t = setup();
		t.set({ workflowErrors: { "qa-inbox.yml": "gh: Not Found (HTTP 404)" },
			"tests.yml": [record(8, { conclusion: "failure" })] });
		const state = await t.get();
		assert.equal(state.ok, true, render(state));
		assert.deepEqual(state.items.find((i: any) => i.id === "workflow:qa-inbox.yml:not-on-default"), {
			id: "workflow:qa-inbox.yml:not-on-default", level: "info", url: "",
			text: "qa-inbox.yml: not on the default branch yet",
		});
		assert.ok(state.items.some((i: any) => i.id === "run:8:1" && i.level === "red"));
		assert.ok(state.items.some((i: any) => i.id === "run:4:1" && i.level === "green"));
		assert.doesNotMatch(render(state), /unavailable/);
	});
	it("does not suppress a non-404 workflow error", async () => {
		const t = setup();
		t.set({ workflowErrors: { "qa-inbox.yml": "gh: Forbidden (HTTP 403)" } });
		const state = await t.get();
		assert.equal(state.ok, false);
		assert.match(render(state), /QA status unavailable:.*HTTP 403/);
	});
	it("reports unavailable, never green, on gh failure; CLI always exits zero", async () => {
		const t = setup();
		t.set({ fail: true });
		const state = await t.get();
		assert.equal(state.ok, false);
		assert.match(render(state), /^QA status unavailable:.*fake gh unavailable/);
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
		h.advance(599_999);
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
