// Pi's real InteractiveMode on a scripted terminal. The owner's path is exercised with keys only: `/settings`, the
// search for Theme, Enter, the native Theme submenu, Enter. Pi itself persists the choice. Then `/reload`, a fresh
// child Node process (restart) and the native switch back. No model is called; agent and project dirs are temporary.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, it } from "node:test";
import { fileURLToPath } from "node:url";
import { initTheme, type SettingsCallbacks, type SettingsConfig, SettingsSelectorComponent } from "@earendil-works/pi-coding-agent";
import {
	ANSI, installNetworkTripwire, isolateEnv, makeFixture, netCalls, type Session, settle, startSession, until,
} from "./restart.ts";

const ENTER = "\r";
const ESC = "\x1b";
const DOWN = "\x1b[B";
const UP = "\x1b[A";
const RESTART_HELPER = fileURLToPath(new URL("./restart.ts", import.meta.url));

let root: string;
let agentDir: string;
let cwd: string;
let pkg: string;
const savedEnv = { ...process.env };
const savedFetch = globalThis.fetch;

/** Seeds the saved theme choice for this scenario in the isolated settings file, and the global theme to match. */
function seed(theme: string) {
	const file = join(agentDir, "settings.json");
	const current = JSON.parse(readFileSync(file, "utf8"));
	writeFileSync(file, JSON.stringify({ ...current, theme }, null, 2));
	initTheme(theme, false);
}

before(() => {
	root = mkdtempSync(join(tmpdir(), "rqw-theme-select-"));
	({ agentDir, cwd, pkg } = makeFixture(root, "dark"));
	isolateEnv(agentDir);
	installNetworkTripwire();
	initTheme("dark", false);
});
after(() => {
	process.env = savedEnv;
	globalThis.fetch = savedFetch;
	rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

/** Opens `/settings`, searches Theme, enters the native Theme submenu and moves the highlight to `target`. */
async function chooseTheme(s: Session, target: string, current: string) {
	s.terminal.type("/settings");
	s.terminal.key(ENTER);
	await until("settings list", () => s.terminal.plain().includes("Type to search"));
	s.terminal.type("theme");
	await until("Theme row", () => s.terminal.plain().slice(-4000).includes("Theme"));
	s.terminal.key(ENTER);
	await until("theme submenu", () => s.terminal.plain().includes("Select a theme"));
	const names = s.allThemes();
	const from = submenuIndex(names, current);
	const to = submenuIndex(names, target);
	for (let i = from; i < to; i++) { s.terminal.key(DOWN); await settle(); }
	for (let i = to; i < from; i++) { s.terminal.key(UP); await settle(); }
	s.terminal.key(ENTER);
	await settle();
}

/** Native submenu order: the system theme, then `automatic`, then the remaining themes (settings-selector.js). */
function submenuIndex(names: string[], target: string): number {
	const menu = [...names.filter((n) => n === "system"), "/", ...names.filter((n) => n !== "system")];
	const index = menu.indexOf(target);
	assert.ok(index >= 0, `${target} is in the native Theme submenu`);
	return index;
}

function settingsFile(): Record<string, unknown> {
	return JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf8"));
}
function listFiles(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
		e.isDirectory() ? listFiles(join(dir, e.name)).map((f) => `${e.name}/${f}`) : [e.name]);
}

it("selection-reload-restart", async (t) => {
	// Own setup: the scenario starts from a dark saved choice. Reload and restart then use what Pi persisted.
	seed("dark");

	await t.test("native-selection-persists-only-the-choice", async () => {
		const s = await startSession(agentDir, cwd);
		// Snapshot after startup, so only what the theme selection itself writes is compared.
		const before = settingsFile();
		const filesBefore = listFiles(agentDir).sort();
		const authBefore = existsSync(join(agentDir, "auth.json")) ? readFileSync(join(agentDir, "auth.json"), "utf8") : null;
		try {
			assert.equal(s.themeNow(), "dark");
			await chooseTheme(s, "RQW-theme", "dark");
			await until("theme applied", () => s.themeNow() === "RQW-theme");
			const after = settingsFile();
			assert.equal(after.theme, "RQW-theme");
			const { theme: _a, ...restAfter } = after;
			const { theme: _b, ...restBefore } = before;
			assert.deepEqual(restAfter, restBefore, "only the theme key changed in settings.json");
			const added = listFiles(agentDir).sort().filter((f) => !filesBefore.includes(f));
			assert.deepEqual(added, [], `no new files in the agent dir: ${added.join(", ")}`);
			const menu = s.terminal.plain();
			assert.ok(menu.includes("Select a theme, or choose automatic to follow terminal appearance."), "native Theme description unchanged");
			assert.ok(menu.includes("automatic"), "native automatic entry present");
			const authAfter = existsSync(join(agentDir, "auth.json")) ? readFileSync(join(agentDir, "auth.json"), "utf8") : null;
			assert.equal(authAfter, authBefore, "auth is untouched by theme selection");
		} finally {
			await s.stop();
		}
	});

	await t.test("reload-restores-choice", async () => {
		const s = await startSession(agentDir, cwd);
		try {
			assert.equal(s.themeNow(), "RQW-theme", "startup applies the saved choice");
			initTheme("dark", false); // the global theme is reset, so /reload must re-apply it from settings
			const seen = s.themeSeen.length;
			s.terminal.type("/reload");
			s.terminal.key(ENTER);
			await until("reload session_start", () => s.themeSeen.length > seen);
			await until("theme re-applied", () => s.themeNow() === "RQW-theme");
			assert.equal(settingsFile().theme, "RQW-theme");
		} finally {
			await s.stop();
		}
	});

	await t.test("restart-restores-choice", () => {
		// A fresh Node process: its own InteractiveMode and runtime on the same isolated dir and package.
		const run = spawnSync(process.execPath, [RESTART_HELPER, "--child"], {
			env: { ...process.env, RQW_THEME_AGENT_DIR: agentDir, RQW_THEME_CWD: cwd },
			encoding: "utf8",
			timeout: 60_000,
		});
		assert.equal(run.error, undefined, `child spawn: ${run.error?.message}`);
		assert.equal(run.signal, null, "child was not killed");
		assert.equal(run.status, 0, `child exit status; stderr: ${run.stderr.slice(-800)}`);
		const line = run.stdout.split("\n").find((l) => l.startsWith("RESULT "));
		assert.ok(line, `child reported a result; stdout: ${run.stdout.slice(-400)}`);
		const result = JSON.parse(line.slice("RESULT ".length));
		assert.equal(result.seen[0], "RQW-theme", "child startup applied the saved choice");
		assert.equal(result.now, "RQW-theme");
		assert.equal(result.saved, "RQW-theme", "child did not change settings");
		assert.equal(result.net, 0, "child made no network requests");
		assert.equal(netCalls.length, 0, "parent made no network requests");
	});

	await t.test("native-switch-back", async () => {
		const s = await startSession(agentDir, cwd);
		try {
			assert.equal(s.themeNow(), "RQW-theme");
			await chooseTheme(s, "dark", "RQW-theme");
			await until("switched back", () => s.themeNow() === "dark");
			assert.equal(settingsFile().theme, "dark");
		} finally {
			await s.stop();
		}
	});
});

it("native-menu-structure-unchanged", async () => {
	seed("dark");
	const s = await startSession(agentDir, cwd);
	try {
		assert.ok(s.allThemes().includes("RQW-theme"), "RQW-theme is loaded from the package");
		// Same config in both renders: currentTheme and the theme list are fixed; only the active theme differs.
		const availableThemes = s.allThemes();
		const config = {
			autoCompact: false, defaultModel: "not set", availableDefaultModels: [], showImages: false, imageWidthCells: 60,
			autoResizeImages: true, blockImages: false, enableSkillCommands: true, steeringMode: "one-at-a-time",
			followUpMode: "one-at-a-time", transport: "sse", sessionShareDestination: "gist", httpIdleTimeoutMs: 300000,
			cacheWarmingMode: "off", thinkingLevel: "off", availableThinkingLevels: ["off"], modelThinkingLevels: {},
			currentTheme: "dark", terminalTheme: "dark", availableThemes, hideThinkingBlock: false, mermaidRenderingMode: "off",
			showCacheMissNotices: true, collapseChangelog: false, enableInstallTelemetry: false, doubleEscapeAction: "tree",
			treeFilterMode: "default", showHardwareCursor: false, editorPaddingX: 0, outputPad: 0, autocompleteMaxVisible: 5,
			quietStartup: true, defaultProjectTrust: "ask", clearOnShrink: false, showTerminalProgress: false, tuiMode: "inline",
			fullscreenExitOutput: "keep", fullscreenScrollbar: "auto", fullscreenCopyOnSelect: false, fullscreenWheelScrollLines: 3,
			warnings: {},
		} as unknown as SettingsConfig;
		const callbacks = new Proxy({}, { get: () => () => {} }) as SettingsCallbacks;
		const widths = [60, 100];
		// Walks the native menu through public handleInput and records plain text and width per line at each width.
		const snapshot = (activeTheme: string) => {
			initTheme(activeTheme, false);
			const c = new SettingsSelectorComponent(config, callbacks);
			const list = c.getSettingsList();
			const shots: string[][] = [];
			const grab = () => {
				for (const w of widths) {
					const lines = c.render(w).map((l) => l.replace(ANSI, ""));
					shots.push([`w=${w}`, `lines=${lines.length}`, ...lines]);
				}
			};
			grab();
			let themeRow = -1;
			for (let i = 0; i < 60 && themeRow < 0; i++) {
				const lines = c.render(100).map((l) => l.replace(ANSI, ""));
				// The highlighted row starts with the cursor glyph; unhighlighted rows start with spaces.
				themeRow = lines.findIndex((l) => /^\S+\s+Theme\s{2,}/.test(l));
				if (themeRow < 0) list.handleInput(DOWN);
			}
			assert.ok(themeRow >= 0, "native Theme row is reachable");
			list.handleInput(ENTER);
			grab();
			assert.ok(c.render(100).join("\n").replace(ANSI, "").includes("Select a theme"), "native Theme submenu opened");
			list.handleInput(DOWN);
			grab();
			list.handleInput(ESC);
			grab();
			return shots;
		};
		const dark = snapshot("dark");
		const rqw = snapshot("RQW-theme");
		assert.equal(rqw.length, dark.length);
		assert.deepEqual(rqw, dark, "native menu text and geometry are identical under dark and RQW-theme");
		assert.equal(netCalls.length, 0, "no network requests");
	} finally {
		await s.stop();
	}
});
