import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, it } from "node:test";
import { AgentSession, DefaultResourceLoader, SettingsManager } from "@earendil-works/pi-coding-agent";

const ROOT = resolve(import.meta.dirname, "..", "..", "..");
const OWN = join(ROOT, "extensions", "RQW-settings", "index.ts");
const EXPECTED = {
	quietStartup: true, outputPad: 1, terminal: { showImages: false }, autocompleteMaxVisible: 3,
	steeringMode: "one-at-a-time", followUpMode: "one-at-a-time", transport: "auto",
	hideThinkingBlock: true, markdown: { mermaid: "off" }, showCacheMissNotices: false,
	warnings: { anthropicExtraUsage: false }, collapseChangelog: true, enableInstallTelemetry: false,
	defaultProjectTrust: "ask", doubleEscapeAction: "tree", treeFilterMode: "default",
	tuiMode: "fullscreen", compaction: { enabled: true }, theme: "RQW-theme", editorPaddingX: 1,
};
const manifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { pi: { extensions: string[] } };
const STOCK = Object.getOwnPropertyDescriptor(DefaultResourceLoader.prototype, "updateThemesFromPaths")!;

const BIND = Object.getOwnPropertyDescriptor(AgentSession.prototype, "bindExtensions")!;

let dir: string;
let agentDir: string;
let cwd: string;
const file = () => join(agentDir, "settings.json");
const read = () => JSON.parse(readFileSync(file(), "utf8"));

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "rqw-setup-"));
	agentDir = join(dir, "agent");
	cwd = join(dir, "project");
	mkdirSync(agentDir, { recursive: true });
	mkdirSync(cwd, { recursive: true });
});
/** Every extension instance a test loaded; a reload creates a new one and keeps the old one's patches alive. */
let loaded: { handlers: Map<string, Handler[]> }[] = [];
afterEach(() => {
	// Pi shuts the old runtime down before a reload and at exit; the tests must do the same for every instance so
	// no patch of AgentSession or the resource loader leaks into later files run in the same process.
	for (const own of loaded.splice(0)) for (const handler of own.handlers.get("session_shutdown") ?? []) handler({ reason: "quit" }, {});
	assert.equal(Object.getOwnPropertyDescriptor(AgentSession.prototype, "bindExtensions")!.value, BIND.value, "tool-selection hook leaked");
	assert.equal(Object.getOwnPropertyDescriptor(DefaultResourceLoader.prototype, "updateThemesFromPaths")!.value, STOCK.value, "setup bridge leaked");
	rmSync(dir, { recursive: true, force: true });
});

type Handler = (event: unknown, ctx: unknown) => void;
/** Runs the extension's session_start handlers; the unrelated tool-selection one needs a real session and may throw. */
function sessionStart(handlers: Handler[] | undefined, notices: string[]): void {
	for (const handler of handlers ?? []) {
		try { handler({ reason: "startup" }, { hasUI: true, ui: { notify: (message: string) => notices.push(message) } }); } catch { /* needs a real session */ }
	}
}
/**
 * A real loader on temp dirs that loads the real RQW-settings entry. Only the final extension and theme lists are
 * replaced (public override options), so the package looks fully loaded or, with `omit`, partly filtered.
 */
async function load(options: { omit?: string; theme?: boolean; cwd?: string; agentDir?: string; configure?: (loader: DefaultResourceLoader, manager: SettingsManager) => void } = {}) {
	const sessionCwd = options.cwd ?? cwd;
	const sessionAgentDir = options.agentDir ?? agentDir;
	const manager = SettingsManager.create(sessionCwd, sessionAgentDir);
	let own: { handlers: Map<string, Handler[]> } | undefined;
	const loader = new DefaultResourceLoader({
		cwd: sessionCwd, agentDir: sessionAgentDir, settingsManager: manager,
		noSkills: true, noPromptTemplates: true, noContextFiles: true, noThemes: true,
		additionalExtensionPaths: [OWN],
		extensionsOverride: (result) => {
			own = result.extensions.find((extension) => extension.path === OWN) as typeof own;
			if (own) loaded.push(own);
			const wanted = manifest.pi.extensions
				.filter((entry) => !options.omit || !entry.includes(options.omit))
				.map((entry) => ({ ...result.extensions[0]!, path: resolve(ROOT, entry) }));
			return { ...result, extensions: wanted };
		},
		themesOverride: (result) => ({
			...result,
			themes: options.theme === false ? [] : [{ name: "RQW-theme" } as never],
		}),
	});
	options.configure?.(loader, manager);
	await loader.reload();
	const notices: string[] = [];
	const start = () => sessionStart(own?.handlers.get("session_start"), notices);
	const stop = () => { for (const handler of own?.handlers.get("session_shutdown") ?? []) handler({ reason: "quit" }, {}); };
	return { manager, notices, start, stop, reload: () => loader.reload() };
}

it("applies the profile once on a clean install, in the manager the UI reads", async () => {
	writeFileSync(file(), JSON.stringify({ packages: ["git:x"], terminal: { trueColor: true } }));
	const { manager, stop } = await load();
	const saved = read();
	assert.deepEqual(saved, { ...EXPECTED, terminal: { trueColor: true, showImages: false }, packages: ["git:x"], rqwSetupVersion: 1 });
	assert.equal(manager.getThemeSetting(), "RQW-theme");
	assert.equal(manager.getHideThinkingBlock(), true);
	assert.equal(manager.getEditorPaddingX(), 1);
	stop();
});

it("creates the settings file when none exists", async () => {
	const { stop } = await load();
	assert.equal(read().theme, "RQW-theme");
	stop();
});

it("replaces differing values once and keeps later owner changes", async () => {
	writeFileSync(file(), JSON.stringify({ theme: "dark", quietStartup: false }));
	let session = await load();
	assert.equal(read().theme, "RQW-theme");
	session.stop();
	writeFileSync(file(), JSON.stringify({ ...read(), theme: "dark" }));
	session = await load();
	assert.equal(read().theme, "dark");
	assert.equal(session.manager.getThemeSetting(), "dark");
	session.stop();
});

it("lets a project setting win over the profile in memory", async () => {
	mkdirSync(join(cwd, ".pi"));
	writeFileSync(join(cwd, ".pi", "settings.json"), JSON.stringify({ theme: "project-theme" }));
	const { manager, stop } = await load();
	assert.equal(read().theme, "RQW-theme");
	assert.equal(manager.getThemeSetting(), "project-theme");
	assert.equal(manager.getQuietStartup(), true);
	stop();
});

it("keeps Pi's migrated settings on first launch with project priority", async () => {
	writeFileSync(file(), JSON.stringify({ retry: { maxDelayMs: 4321 } }));
	mkdirSync(join(cwd, ".pi"));
	writeFileSync(join(cwd, ".pi", "settings.json"), JSON.stringify({ retry: { provider: { maxRetries: 7 } } }));
	const { manager, stop } = await load();
	assert.deepEqual(manager.getGlobalSettings().retry, { provider: { maxRetryDelayMs: 4321 } });
	assert.deepEqual(manager.getSettings().retry, { provider: { maxRetryDelayMs: 4321, maxRetries: 7 } });
	stop();
});

it("leaves an invalid settings file untouched and warns at session start", async () => {
	writeFileSync(file(), "{ broken");
	const { notices, start, stop } = await load();
	assert.equal(readFileSync(file(), "utf8"), "{ broken");
	start();
	assert.match(notices.join("\n"), /not valid JSON/);
	stop();
});

it("treats an empty file as absent, like Pi", async () => {
	writeFileSync(file(), "");
	const { stop } = await load();
	assert.deepEqual(read(), { ...EXPECTED, rqwSetupVersion: 1 });
	stop();
});

it("does not overwrite a parse error introduced after the manager loads", async () => {
	const { notices, start, stop } = await load({ configure: () => writeFileSync(file(), " ") });
	assert.equal(readFileSync(file(), "utf8"), " ");
	start();
	assert.match(notices.join("\n"), /not valid JSON/);
	stop();
});

it("refreshes from a concurrent writer without overwriting its choices", async () => {
	const concurrent = { ...EXPECTED, theme: "dark", editorPaddingX: 2, rqwSetupVersion: 1, unrelated: "kept" };
	const { manager, stop } = await load({ configure: () => writeFileSync(file(), JSON.stringify(concurrent)) });
	assert.deepEqual(read(), concurrent);
	assert.equal(manager.getThemeSetting(), "dark");
	assert.equal(manager.getEditorPaddingX(), 2);
	assert.equal((manager.getGlobalSettings() as Record<string, unknown>).unrelated, "kept");
	stop();
});

for (const [name, patch] of [
	["missing getExtensions", { getExtensions: undefined }],
	["throwing getExtensions", { getExtensions: () => { throw new Error("changed"); } }],
	["invalid extensions", { getExtensions: () => ({ extensions: [null] }) }],
	["missing getThemes", { getThemes: undefined }],
	["throwing getThemes", { getThemes: () => { throw new Error("changed"); } }],
	["invalid themes", { getThemes: () => ({ themes: [null] }) }],
] as const) {
	it(`falls back when loader has ${name}`, async () => {
		const { notices, start, stop } = await load({ configure: loader => Object.assign(loader, patch) });
		assert.equal(existsSync(file()), false);
		start();
		assert.match(notices.join("\n"), /resource loader shape changed/);
		stop();
	});
}

it("does not mark setup done when an extension is filtered out", async () => {
	writeFileSync(file(), JSON.stringify({ theme: "dark" }));
	const { notices, start, stop } = await load({ omit: "RQW-tools" });
	assert.deepEqual(read(), { theme: "dark" });
	start();
	assert.match(notices.join("\n"), /RQW-tools/);
	stop();
});

it("does not mark setup done when the theme resource is missing", async () => {
	const { notices, start, stop } = await load({ theme: false });
	assert.equal(existsSync(file()), false);
	start();
	assert.match(notices.join("\n"), /theme RQW-theme/);
	stop();
});

it("falls back to stock with a warning when the settings manager shape differs", async () => {
	writeFileSync(file(), JSON.stringify({ theme: "dark" }));
	const manager = SettingsManager.create(cwd, agentDir);
	(manager as unknown as Record<string, unknown>).applyOverrides = undefined;
	let own: { handlers: Map<string, Handler[]> } | undefined;
	const loader = new DefaultResourceLoader({
		cwd, agentDir, settingsManager: manager, noSkills: true, noPromptTemplates: true, noContextFiles: true, noThemes: true,
		additionalExtensionPaths: [OWN],
		extensionsOverride: (result) => {
			own = result.extensions.find((extension) => extension.path === OWN) as typeof own;
			if (own) loaded.push(own);
			return { ...result, extensions: manifest.pi.extensions.map((entry) => ({ ...result.extensions[0]!, path: resolve(ROOT, entry) })) };
		},
		themesOverride: (result) => ({ ...result, themes: [{ name: "RQW-theme" } as never] }),
	});
	await loader.reload();
	assert.deepEqual(read(), { theme: "dark" });
	const notices: string[] = [];
	sessionStart(own?.handlers.get("session_start"), notices);
	assert.match(notices.join("\n"), /shape changed/);
	for (const handler of own?.handlers.get("session_shutdown") ?? []) handler({ reason: "quit" }, {});
});

it("reload replaces the bridge and preserves owner changes", async () => {
	const session = await load();
	writeFileSync(file(), JSON.stringify({ ...read(), theme: "dark" }));
	await session.reload();
	assert.equal(read().theme, "dark");
	writeFileSync(file(), JSON.stringify({ theme: "dark" }));
	await session.manager.reload();
	await session.reload();
	assert.equal(read().theme, "RQW-theme");
	assert.equal(session.manager.getThemeSetting(), "RQW-theme");
	session.stop();
	assert.equal(Object.getOwnPropertyDescriptor(DefaultResourceLoader.prototype, "updateThemesFromPaths")!.value, STOCK.value);
});

it("applies independently in two simultaneous sessions", async () => {
	const first = await load();
	const secondAgent = join(dir, "second-agent");
	const secondCwd = join(dir, "second-project");
	mkdirSync(secondAgent);
	mkdirSync(secondCwd);
	const second = await load({ agentDir: secondAgent, cwd: secondCwd });
	assert.deepEqual(read(), { ...EXPECTED, rqwSetupVersion: 1 });
	assert.deepEqual(JSON.parse(readFileSync(join(secondAgent, "settings.json"), "utf8")), { ...EXPECTED, rqwSetupVersion: 1 });
	assert.equal(first.manager.getThemeSetting(), "RQW-theme");
	assert.equal(second.manager.getThemeSetting(), "RQW-theme");
	first.stop();
	writeFileSync(join(secondAgent, "settings.json"), JSON.stringify({ theme: "dark" }));
	await second.manager.reload();
	await second.reload();
	assert.equal(second.manager.getThemeSetting(), "RQW-theme");
	assert.deepEqual(JSON.parse(readFileSync(join(secondAgent, "settings.json"), "utf8")), { ...EXPECTED, rqwSetupVersion: 1 });
	second.stop();
	assert.equal(Object.getOwnPropertyDescriptor(DefaultResourceLoader.prototype, "updateThemesFromPaths")!.value, STOCK.value);
});

it("restores the stock loader method on shutdown and then applies nothing", async () => {
	const first = await load();
	assert.notEqual(Object.getOwnPropertyDescriptor(DefaultResourceLoader.prototype, "updateThemesFromPaths")!.value, STOCK.value);
	first.stop();
	assert.equal(Object.getOwnPropertyDescriptor(DefaultResourceLoader.prototype, "updateThemesFromPaths")!.value, STOCK.value);
});
