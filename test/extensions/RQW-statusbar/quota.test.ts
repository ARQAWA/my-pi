import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import { join } from "node:path";
import { it, type TestContext } from "node:test";
import { stripVTControlCharacters as strip } from "node:util";
import statusbar from "../../../extensions/RQW-statusbar/index.ts";
import { bindTestHost } from "./footer-host.ts";
import { ICON, renderBar } from "../../../extensions/RQW-statusbar/render.ts";

const MINUTE = 60_000;
async function until(ready: () => boolean) {
	// Windows I/O can outlast many immediates; elapsed time is only a failure watchdog.
	const deadline = performance.now() + 5_000;
	while (!ready() && performance.now() < deadline) await new Promise<void>(resolve => setImmediate(resolve));
	assert.ok(ready(), "quota operation completed");
}

function setup(t: TestContext) {
	t.mock.timers.enable({ apis: ["setInterval", "setTimeout", "Date"], now: 1_000_000_000_000 });
	const root = mkdtempSync(join(os.tmpdir(), "rqw-quota-"));
	const temporary = join(root, "tmp");
	mkdirSync(temporary);
	mkdirSync(join(root, "project", ".git"), { recursive: true });
	const previousCwd = process.cwd();
	process.chdir(root);
	t.mock.method(os, "tmpdir", () => temporary);
	syncBuiltinESMExports();
	const saved = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = root;
	const response = { status: 200, percent: 77, ccPercent: undefined as number | undefined,
		ccStatus: undefined as number | undefined, branch: "main", hold: Promise.resolve() };
	t.mock.method(childProcess, "execFile", (file: string, args: string[], _options: unknown,
		done: (error: Error | null, stdout: string) => void) => {
		assert.equal(file, "git");
		done(null, args.includes("status") ? "" : `${response.branch}\n`);
	});
	const ticks: (() => unknown)[] = [];
	const interval = globalThis.setInterval;
	t.mock.method(globalThis, "setInterval", (callback: () => unknown, ms?: number) => {
		if (ms === MINUTE) ticks.push(callback);
		return interval(callback, ms);
	});
	syncBuiltinESMExports();
	const setAccount = (account?: "first" | "second", providers: readonly ("CX" | "CC")[] = ["CX", "CC"]) => {
		response.percent = account === "second" ? 29 : 77;
		writeFileSync(join(root, "auth.json"), JSON.stringify(account ? {
			...(providers.includes("CC") ? { anthropic: { type: "oauth", access: "fake-cc", refresh: `fake-cc-refresh-${account}`, expires: 2e12 } } : {}),
			...(providers.includes("CX") ? { "openai-codex": { type: "oauth", access: "fake-cx", refresh: "unused", expires: 2e12, accountId: `fake-account-${account}` } } : {}),
		} : {}));
	};
	setAccount("first");
	const cacheDir = join(temporary, "rqw-quota");
	const file = (provider: "CX" | "CC", account = "first") => join(cacheDir,
		`${provider}-${createHash("sha256").update(provider === "CX" ? `fake-account-${account}` : `fake-cc-refresh-${account}`).digest("hex").slice(0, 16)}.json`);
	const reads = { CX: 0, CC: 0 };
	t.mock.method(globalThis, "fetch", async (url: unknown) => {
		assert.equal(url, "https://chatgpt.com/backend-api/wham/usage");
		reads.CX++;
		await response.hold;
		return response.status === 200 ? Response.json({ rate_limit: {
			secondary_window: { used_percent: 100 - response.percent, limit_window_seconds: 604800 },
		} }) : new Response(null, { status: response.status });
	});
	const shutdown: (() => unknown)[] = [];
	const idle = () => !existsSync(cacheDir) || !readdirSync(cacheDir).some(name => name.endsWith(".lock"));
	t.after(async () => {
		for (const stop of shutdown) await stop();
		await until(idle);
		process.chdir(previousCwd);
		rmSync(root, { recursive: true, force: true });
		if (saved === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = saved;
		t.mock.restoreAll();
		syncBuiltinESMExports();
	});
	async function openTab() {
		const tickIndex = ticks.length;
		const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
		let command: unknown;
		const pi = {
			events: { on: () => () => {}, emit(name: string, data: unknown) {
				if (name !== "rqw-anthropic:quota:v1") return;
				(data as { offer(access: unknown): void }).offer({ async refresh() {
					reads.CC++;
					await response.hold;
					const status = response.ccStatus ?? response.status;
					if (status !== 200) throw new Error(`HTTP ${status}`);
					return { windows: { seven_day: { remainingPercent: response.ccPercent ?? response.percent } } };
				} });
			} },
			getSettings: () => ({}), getSessionName: () => undefined, getThinkingLevel: () => "off", registerCommand(_name: string, value: unknown) { command = value; },
			on(name: string, handler: (event: unknown, ctx: unknown) => unknown) { handlers.set(name, handler); },
		};
		type Footer = { render(width: number): string[]; dispose(): void };
		let footer: Footer;
		const theme = { fg: (_role: string, text: string) => text };
		const ctx = {
			mode: "tui", cwd: "project", model: undefined, isIdle: () => true, getContextUsage: () => undefined,
			sessionManager: { getSessionId: () => "quota-test", getLeafId: () => null, getEntryCount: () => 0, getEntries: () => [] },
			ui: { theme, getEditorComponent: () => ({}), setEditorComponent() {}, setWidget() {}, setWorkingIndicator() {},
				setFooter(factory: (tui: unknown, theme: unknown, data: unknown) => Footer) {
					footer = factory({ requestRender() {} }, theme, {
						onBranchChange: () => () => {}, getExtensionStatuses: () => new Map(),
					});
				} },
		};
		statusbar(pi as never);
		bindTestHost(t, command);
		await handlers.get("session_start")!({}, ctx);
		const stop = () => handlers.get("session_shutdown")!({}, ctx);
		shutdown.push(stop);
		return Object.assign(() => footer.render(160).map(strip).join("\n"), {
			raw: (width: number) => footer.render(width), stop,
			tick: async () => { await ticks[tickIndex](); },
		});
	}
	return { response, reads, openTab, file, idle, cacheDir, setAccount };
}

it("two tabs share one locked read per account and both show the cached percentages", async (t) => {
	const cache = setup(t);
	let release!: () => void;
	cache.response.hold = new Promise<void>(resolve => { release = resolve; });
	const first = await cache.openTab();
	await until(() => cache.reads.CX === 1 && cache.reads.CC === 1);
	for (const id of ["CX", "CC"]) assert.ok(first().includes(`${id} ???`));
	const second = await cache.openTab();
	await second.tick();
	assert.deepEqual(cache.reads, { CX: 1, CC: 1 });
	release();
	await until(() => first().includes("CX 77%") && first().includes("CC 77%") && cache.idle());
	t.mock.timers.tick(MINUTE);
	await until(() => second().includes("CX 77%") && second().includes("CC 77%"));
	assert.deepEqual(cache.reads, { CX: 1, CC: 1 });
	const row = first.raw(160).join("\n");
	assert.ok(row.includes("\x1b[38;2;139;197;255mCX 77%\x1b[39m"));
	assert.ok(row.includes("\x1b[38;2;255;152;170mCC 77%\x1b[39m"));
	const wrapped = first.raw(20).map(strip);
	assert.ok(wrapped.length > first.raw(160).length);
	for (const id of ["CX", "CC"]) assert.ok(wrapped.some(line => line.includes(`${id} 77%`)));

	cache.setAccount("second");
	const anotherAccount = await cache.openTab();
	await until(() => anotherAccount().includes("CX 29%") && anotherAccount().includes("CC 29%") && cache.idle());
	assert.deepEqual(cache.reads, { CX: 2, CC: 2 });
	for (const id of ["CX", "CC"] as const) {
		assert.equal(JSON.parse(readFileSync(cache.file(id), "utf8")).percent, 77);
		assert.equal(JSON.parse(readFileSync(cache.file(id, "second"), "utf8")).percent, 29);
	}
	cache.setAccount();
	const loggedOut = await cache.openTab();
	assert.doesNotMatch(loggedOut(), /\b(?:CX|CC)\b/);
});

it("restores quota position, colour and wrapping through the extension entry", async (t) => {
	const cache = setup(t);
	cache.response.percent = 72;
	cache.response.ccPercent = 39;
	const shown = await cache.openTab();
	await until(() => shown().includes("CX 72%") && shown().includes("CC 39%") && shown().includes(`${ICON.branch} main`) && cache.idle());
	const row = shown.raw(100)[2];
	assert.equal(strip(row), ` ${ICON.folder} project` + " ".repeat(68) + `CX 72%  CC 39%  ${ICON.branch} main`);
	const wrapped = shown.raw(30).slice(2).map(strip);
	assert.deepEqual(wrapped, [` ${ICON.folder} project`, " ".repeat(8) + `CX 72%  CC 39%  ${ICON.branch} main`]);
	assert.ok(row.includes("\x1b[38;2;139;197;255mCX 72%\x1b[39m"));
	assert.ok(row.includes("\x1b[38;2;255;152;170mCC 39%\x1b[39m"));
	cache.response.percent = 64;
	t.mock.timers.tick(3 * MINUTE - 1);
	await shown.tick();
	assert.ok(shown().includes("CX 72%"));
	t.mock.timers.tick(1);
	await until(() => shown().includes("CX 64%") && cache.idle());
	cache.response.branch = "long-branch-".repeat(10);
	const longBranch = await cache.openTab();
	await until(() => longBranch().includes(cache.response.branch) && longBranch().includes("CC 39%"));
	await until(() => longBranch().includes("CX 64%"));
	const narrow = longBranch.raw(60).slice(2).map(strip).join(" ");
	for (const id of ["CX", "CC"]) assert.ok(narrow.includes(id));
	assert.ok(narrow.includes("CC 39%"));
});

it("restores hidden-provider, separator and first-failure display checks through the entry", async (t) => {
	const cache = setup(t);
	cache.setAccount();
	for (const git of [undefined, { branch: "main", staged: 0, unstaged: 0, untracked: 0 }]) {
		cache.response.branch = git?.branch ?? "";
		const shown = await cache.openTab();
		const state = { compactions: 0, place: { kind: "folder" as const, text: "project" }, statuses: [], git };
		const expected = renderBar(state, 40);
		await until(() => JSON.stringify(shown.raw(40)) === JSON.stringify(expected));
		assert.deepEqual(shown.raw(40), expected);
	}
	cache.setAccount("first", ["CX"]);
	cache.response.percent = 75;
	const onlyCodex = await cache.openTab();
	await until(() => onlyCodex().includes("CX 75%") && cache.idle());
	const row = onlyCodex();
	assert.ok(row.includes("CX 75%"));
	assert.ok(!row.includes("CC"));
	cache.setAccount();
	await onlyCodex.tick();
	assert.ok(!onlyCodex().includes("CX"));

	cache.setAccount("second");
	cache.response.percent = 57;
	cache.response.status = 401;
	cache.response.ccStatus = 200;
	const failed = await cache.openTab();
	await until(() => failed().includes("CC 57%") && cache.idle());
	assert.ok(failed().includes("CC 57%"));
	assert.ok(failed().includes("CX ???"));
	assert.ok(failed.raw(160).join("\n").includes("\x1b[38;2;139;197;255mCX ???\x1b[39m"));
});

it("fresh account cache files display their values without a request", async (t) => {
	const cache = setup(t);
	mkdirSync(cache.cacheDir);
	for (const provider of ["CX", "CC"] as const) writeFileSync(cache.file(provider), JSON.stringify({ percent: 62, okAt: Date.now(), checkedAt: Date.now() }));
	const shown = await cache.openTab();
	await until(() => shown().includes("CX 62%") && shown().includes("CC 62%"));
	t.mock.timers.tick(MINUTE);
	await until(cache.idle);
	assert.deepEqual(cache.reads, { CX: 0, CC: 0 });
});

it("a 429 preserves the good percent and records the attempt for every tab", async (t) => {
	const cache = setup(t);
	const shown = await cache.openTab();
	await until(() => shown().includes("CX 77%") && shown().includes("CC 77%") && cache.idle());
	cache.response.status = 429;
	t.mock.timers.tick(3 * MINUTE);
	await until(() => cache.reads.CX === 2 && cache.reads.CC === 2 && cache.idle());
	for (const provider of ["CX", "CC"] as const) {
		assert.ok(shown().includes(`${provider} 77%`));
		assert.deepEqual(JSON.parse(readFileSync(cache.file(provider), "utf8")), {
			percent: 77, okAt: Date.now() - 3 * MINUTE, checkedAt: Date.now(),
		});
	}
	const other = await cache.openTab();
	await until(() => other().includes("CX 77%") && other().includes("CC 77%"));
	assert.deepEqual(cache.reads, { CX: 2, CC: 2 });
	t.mock.timers.tick(3 * MINUTE);
	await until(() => cache.reads.CX === 3 && cache.reads.CC === 3 && cache.idle());
	assert.deepEqual(cache.reads, { CX: 3, CC: 3 });
});

it("a stopped request writes neither a value nor an attempt timestamp", async (t) => {
	const cache = setup(t);
	let release!: () => void;
	cache.response.hold = new Promise<void>(resolve => { release = resolve; });
	const tab = await cache.openTab();
	await until(() => cache.reads.CX === 1 && cache.reads.CC === 1);
	await tab.stop();
	release();
	await until(cache.idle);
	for (const id of ["CX", "CC"] as const) assert.equal(existsSync(cache.file(id)), false);
	const other = await cache.openTab();
	await until(() => other().includes("CX 77%") && other().includes("CC 77%") && cache.idle());
	assert.deepEqual(cache.reads, { CX: 2, CC: 2 });
});

it("an account switch during a request cannot write under the previous account", async (t) => {
	const cache = setup(t);
	let release!: () => void;
	cache.response.hold = new Promise<void>(resolve => { release = resolve; });
	await cache.openTab();
	await until(() => cache.reads.CX === 1 && cache.reads.CC === 1);
	cache.setAccount("second");
	release();
	await until(cache.idle);
	for (const id of ["CX", "CC"] as const) assert.equal(existsSync(cache.file(id)), false);
	const other = await cache.openTab();
	await until(() => other().includes("CX 29%") && other().includes("CC 29%") && cache.idle());
	assert.deepEqual(cache.reads, { CX: 2, CC: 2 });
});
