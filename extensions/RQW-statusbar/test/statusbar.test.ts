import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { it } from "node:test";
import { fileURLToPath } from "node:url";
import { type Component, visibleWidth } from "@earendil-works/pi-tui";
import * as library from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI, ExtensionContext, ExtensionMode, ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import statusbar, { contextLimit } from "../index.ts";
import { findRepo, gitBranch, gitCounts } from "../git.ts";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
// The exports map hides the bundle; exercise this runtime loading boundary by resolved file URL.
const bundle: typeof library = await import(new URL("./bundle/index.js", import.meta.resolve("@earendil-works/pi-coding-agent")).href);

const { FooterDataProvider } = await import(new URL("./core/footer-data-provider.js", import.meta.resolve("@earendil-works/pi-coding-agent")).href);

type EditorFactory = Parameters<ExtensionUIContext["setEditorComponent"]>[0];
const plainTheme = { fg: (_role: string, text: string) => text };

/** Pi's extension UI slots in miniature: footer and editor factories, as interactive mode calls them. */
function uiHarness(footer?: InstanceType<typeof FooterDataProvider>) {
	let component: (Component & { dispose?(): void }) | undefined;
	let editorFactory: EditorFactory;
	let editor: ReturnType<NonNullable<EditorFactory>> | undefined;
	let calls = 0, renders = 0, subscriptions = 0;
	const statuses = new Map<string, string>();
	const tui = { requestRender: () => renders++, terminal: { rows: 40 } } as never;
	const ui = {
		setFooter(factory: Parameters<ExtensionUIContext["setFooter"]>[0]) {
			calls++;
			component?.dispose?.();
			component = factory?.(tui, plainTheme as never,
				footer ?? { getGitBranch: () => null, getExtensionStatuses: () => statuses,
					onBranchChange: () => { subscriptions++; return () => { subscriptions--; }; },
					getAvailableProviderCount: () => 0 });
		},
		setEditorComponent(factory: EditorFactory) {
			calls++;
			const text = editor?.getText() ?? "";
			editorFactory = factory;
			editor = factory?.(tui, { borderColor: (text: string) => text, selectList: {} } as never,
				{ matches: () => false } as never);
			editor?.setText(text);
		},
		getEditorComponent: () => editorFactory,
		notify() {},
		theme: plainTheme,
	} as unknown as ExtensionUIContext;
	return { ui, statuses, render: (width = 80) => component?.render(width),
		/** The editor's bottom border, undefined for Pi's stock editor. */
		border: (width = 80) => editor?.render(width).at(-1),
		/** The editor's top border. */
		top: (width = 80) => editor?.render(width)[0],
		get editor() { return editor; },
		get calls() { return calls; }, get renders() { return renders; }, get subscriptions() { return subscriptions; },
		dispose: () => component?.dispose?.() };
}

for (const [label, pi] of [["library", library], ["bundle", bundle]] as const) {
	it(`${label}: actual Pi loader, live model/thinking getters, context, compactions and modes without a request`, async () => {
		const cwd = mkdtempSync(join(tmpdir(), "rqw-status-real-"));
		const agentDir = join(cwd, "agent"); mkdirSync(agentDir);
		const model = { id: "fixture", name: "Claude Fixture", provider: "fixture", api: "openai-completions",
			baseUrl: "http://127.0.0.1:1", reasoning: true, input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 500000, maxTokens: 1000 } as const;
		const loader = new pi.DefaultResourceLoader({ cwd, agentDir, additionalExtensionPaths: [join(root, "index.ts")],
			noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
		let session: library.AgentSession | undefined;
		const h = uiHarness();
		try {
			await loader.reload();
			assert.deepEqual(loader.getExtensions().errors, []);
			const runtime = await pi.ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: null, refreshOnCreate: false });
			({ session } = await pi.createAgentSession({ cwd, agentDir, model: model as never, modelRuntime: runtime,
				thinkingLevel: "off", resourceLoader: loader, sessionManager: pi.SessionManager.inMemory(cwd),
				settingsManager: pi.SettingsManager.inMemory({ compaction: { reserveTokens: 50000 } }) }));
			await session.bindExtensions({ uiContext: h.ui, mode: "tui" });
			assert.equal(session.model?.contextWindow, 500000);
			assert.match(h.render()![0], /Fixture no/);
			assert.match(h.border()!, /\/450k$/);
			assert.equal(h.render()!.length, 2, "the context row is the editor's bottom border, not a footer row");
			assert.equal(visibleWidth(h.border()!), 80);
			assert.ok(h.editor instanceof pi.CustomEditor, "Pi's CustomEditor keeps app keybindings");
			// The full session ID ends the top border and follows the live session manager.
			const firstId = session.sessionManager.getSessionId();
			assert.match(firstId, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/);
			assert.equal(h.top(), `${"\u2500".repeat(40)} ${firstId} \u2500\u2500`);
			assert.equal(h.top(41), "\u2500".repeat(41), "too narrow: the ID is dropped, not cut");
			session.sessionManager.newSession();
			assert.notEqual(session.sessionManager.getSessionId(), firstId);
			assert.equal(h.top(), `${"\u2500".repeat(40)} ${session.sessionManager.getSessionId()} \u2500\u2500`);
			assert.equal((h.editor as unknown as { embedWorkingStatus: boolean }).embedWorkingStatus, true,
				"the working status stays in the top border, as in Pi's default editor");
			// Twenty input lines in a 40-row terminal show 12; with the cursor on the first, 8 are hidden below.
			h.editor!.setText(Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n"));
			for (let i = 0; i < 19; i++) h.editor!.handleInput("\x1b[A");
			for (const width of [80, 30, 12, 9, 3, 0]) {
				const border = h.border(width)!;
				assert.equal(visibleWidth(border), width, `${width}: ${border}`);
				if (width >= 3) assert.ok(border.startsWith("\u2193 "), `${width}: hint kept: ${border}`);
			}
			assert.match(h.border()!, /^\u2193 8 more \u2500+ 0% 0k\/450k$/);
			h.editor!.setText("");
			// Direct state replacement is deliberately not a model_select event: external sources must also work.
			session.agent.state.model = { ...model, id: "other", name: "Other", contextWindow: 272000 } as never;
			session.setThinkingLevel("high");
			assert.match(h.render()![0], /Other hi/);
			session.agent.state.thinkingLevel = "low";
			assert.match(h.render()![0], /Other lo/);
			assert.ok(h.border()!.endsWith("/222k"));
			session.sessionManager.appendCompaction("fixture summary", "unused", 10000);
			assert.match(h.render()![0], /cmp 1/);
			assert.ok(h.border()!.endsWith("?/222k"));
			h.statuses.set("z", "last"); h.statuses.set("a", "first\nsecond");
			assert.match(h.render()![0], /first second · last/);
			const command = session.extensionRunner.getCommand("statusbar")!;
			await command.handler("off", session.extensionRunner.createCommandContext());
			assert.equal(h.render(), undefined); assert.equal(h.subscriptions, 0);
			await session.extensionRunner.emit({ type: "session_start" });
			assert.equal(h.render(), undefined, "off survives a new session in this runtime");
			await command.handler("on", session.extensionRunner.createCommandContext());
			assert.equal(h.subscriptions, 1);
			await command.handler("nonsense", session.extensionRunner.createCommandContext());
			assert.equal(h.subscriptions, 1);
			await command.handler("", session.extensionRunner.createCommandContext());
			assert.equal(h.subscriptions, 0);
			assert.equal(h.ui.getEditorComponent(), undefined, "off restores Pi's stock editor");
			await command.handler("on", session.extensionRunner.createCommandContext());
			const ours = h.ui.getEditorComponent();
			assert.ok(ours);
			await command.handler("on", session.extensionRunner.createCommandContext());
			assert.equal(h.ui.getEditorComponent(), ours, "repeated on keeps the same editor");
			// Another extension's editor replaces ours: the context row returns to the footer.
			const foreign: Parameters<ExtensionUIContext["setEditorComponent"]>[0] = (tui, theme, keys) => new pi.CustomEditor(tui, theme, keys);
			h.ui.setEditorComponent(foreign);
			assert.equal(h.render()!.length, 3);
			assert.ok(h.render()![0].endsWith("?/222k"));
			assert.equal(h.border(), "\u2500".repeat(80));
			assert.equal(h.top(), "\u2500".repeat(80), "a foreign editor shows no session ID");
			// A foreign editor present at install time is kept, and off does not remove it.
			await command.handler("off", session.extensionRunner.createCommandContext());
			assert.equal(h.ui.getEditorComponent(), foreign);
			await command.handler("on", session.extensionRunner.createCommandContext());
			assert.equal(h.ui.getEditorComponent(), foreign);
			assert.equal(h.render()!.length, 3);
			await command.handler("off", session.extensionRunner.createCommandContext());
			assert.equal(h.ui.getEditorComponent(), foreign);
			h.ui.setEditorComponent(undefined);
			for (const mode of ["rpc", "json", "print"] as ExtensionMode[]) {
				session.extensionRunner.setUIContext(h.ui, mode);
				const calls = h.calls;
				await session.extensionRunner.emit({ type: "session_start" });
				await command.handler("on", session.extensionRunner.createCommandContext());
				assert.equal(h.calls, calls, `${mode}: no footer calls`);
			}
		} finally {
			try {
				await session?.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
			} finally {
				h.dispose(); session?.dispose(); rmSync(cwd, { recursive: true, force: true });
			}
		}
	});
}

it("refreshes branches after git init, checkout and repo replacement despite Pi's cached absence", async (t) => {
	t.mock.timers.enable({ apis: ["setInterval"] });
	const cwd = mkdtempSync(join(tmpdir(), "rqw-status-branch-"));
	const footer = new FooterDataProvider(cwd);
	const h = uiHarness(footer);
	const handlers = new Map<string, Function>();
	const git = (...args: string[]) => execFileSync("git", args, { cwd, stdio: "ignore" });
	const ctx = { mode: "tui", cwd, ui: h.ui, model: undefined,
		sessionManager: { getSessionId: () => "id", getLeafId: () => null, getEntryCount: () => 0, getEntries: () => [] },
		getContextUsage: () => undefined };
	statusbar({ on: (event: string, fn: Function) => handlers.set(event, fn), registerCommand() {},
		events: { on: () => () => {}, emit() {} },
		getSettings: () => ({}), getThinkingLevel: () => "off" } as unknown as ExtensionAPI);
	async function refresh(action: () => void) {
		const previous = h.renders;
		action();
		for (let i = 0; h.renders === previous && i < 500; i++) {
			await new Promise(resolve => setTimeout(resolve, 10));
		}
		assert.ok(h.renders > previous, "async git refresh requested render");
	}
	try {
		assert.equal(footer.getGitBranch(), null, "real Pi provider caches absent repo");
		handlers.get("session_start")!({}, ctx);
		assert.doesNotMatch(h.render()![1], /new-branch/);
		git("init", "-b", "new-branch");
		writeFileSync(join(cwd, "new-file"), "x");
		await refresh(() => handlers.get("tool_execution_end")!({}, ctx));
		assert.match(h.render()![1], /new-branch.*\?1/);
		git("checkout", "-b", "switched-branch");
		await refresh(() => handlers.get("agent_end")!({}, ctx));
		assert.match(h.render()![1], /switched-branch.*\?1/);
		assert.doesNotMatch(h.render()![1], /new-branch/);
		rmSync(join(cwd, ".git"), { recursive: true, force: true });
		git("init", "-b", "replacement-branch");
		await refresh(() => t.mock.timers.tick(10_000));
		assert.match(h.render()![1], /replacement-branch.*\?1/);
		assert.doesNotMatch(h.render()![1], /switched-branch/);
		rmSync(join(cwd, ".git"), { recursive: true, force: true });
		await refresh(() => t.mock.timers.tick(10_000));
		assert.doesNotMatch(h.render()![1], /replacement-branch|\?1/);
		assert.equal(footer.getGitBranch(), null, "Pi's stale cache was not mutated");
		handlers.get("session_shutdown")!({}, ctx);
		const renders = h.renders;
		t.mock.timers.tick(20_000);
		assert.equal(h.renders, renders, "shutdown clears polling");
	} finally {
		h.dispose(); footer.dispose(); rmSync(cwd, { recursive: true, force: true });
	}
});

it("Pi reserves, model overrides and disabled compaction are read without changing settings", () => {
	const model = { provider: "p", id: "m", contextWindow: 500000 } as ExtensionContext["model"];
	const ctx = { model };
	for (const [compaction, expected] of [
		[{ reserveTokens: 50000 }, 450000],
		[{ reserveTokens: 30000, modelOverrides: { "p/m": { reserveTokens: 20000 } } }, 480000],
		[{ enabled: false, reserveTokens: 50000 }, 500000],
		[{ reserveTokens: 600000 }, 500000],
	] as const) {
		const settings = { compaction };
		const before = JSON.stringify(settings);
		assert.equal(contextLimit({ getSettings: () => settings } as never, ctx, 500000), expected);
		assert.equal(JSON.stringify(settings), before);
	}
});

it("all non-TUI modes avoid even reading session metadata or settings", async () => {
	for (const mode of ["rpc", "json", "print"] as ExtensionMode[]) {
		const handlers = new Map<string, Function>(); let command: Parameters<ExtensionAPI["registerCommand"]>[1] | undefined;
		const fail = () => { throw Error("non-TUI work"); };
		statusbar({ on: (event: string, fn: Function) => handlers.set(event, fn),
			registerCommand: (_name: string, options: Parameters<ExtensionAPI["registerCommand"]>[1]) => command = options,
			getSettings: fail, getThinkingLevel: fail } as unknown as ExtensionAPI);
		const ctx = new Proxy({ mode }, { get: (target, key) => key === "mode" ? target.mode : fail() });
		handlers.get("session_start")!({}, ctx);
		await command!.handler("on", ctx as never);
		for (const event of ["tool_execution_end", "agent_end", "session_shutdown", "model_select", "thinking_level_select"]) {
			handlers.get(event)!({}, ctx);
		}
	}
});

it("git handles ordinary repos, missing git/metadata, linked worktrees, and file counts", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "rqw-status-git-"));
	const git = (...args: string[]) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
	try {
		assert.equal(findRepo(cwd), undefined);
		assert.equal(await gitCounts(cwd), undefined);
		assert.equal(await gitBranch(cwd), null);
		git("init", "-b", "main"); git("config", "user.email", "test@example.invalid"); git("config", "user.name", "Test");
		writeFileSync(join(cwd, "one"), "one"); git("add", "."); git("commit", "-m", "init");
		assert.deepEqual(findRepo(cwd), { root: cwd });
		assert.equal(await gitBranch(cwd), "main");
		git("checkout", "--detach");
		assert.equal(await gitBranch(cwd), "detached");
		git("checkout", "main");
		writeFileSync(join(cwd, "one"), "changed"); writeFileSync(join(cwd, "new"), "new");
		assert.deepEqual(await gitCounts(cwd), { staged: 0, unstaged: 1, untracked: 1 });
		git("add", "one");
		assert.deepEqual(await gitCounts(cwd), { staged: 1, unstaged: 0, untracked: 1 });
		git("worktree", "add", "-b", "topic", join(cwd, "linked"));
		assert.deepEqual(findRepo(join(cwd, "linked")), { root: join(cwd, "linked"),
			worktree: { project: cwd.split(/[\\/]/).at(-1), name: "linked" } });
		assert.equal(await gitBranch(join(cwd, "linked")), "topic");
		const noGit = join(cwd, "broken"); mkdirSync(noGit); writeFileSync(join(noGit, ".git"), "gitdir: missing\n");
		assert.deepEqual(findRepo(noGit), { root: noGit, worktree: undefined });
		const original = process.env.PATH;
		try {
			process.env.PATH = "";
			assert.equal(await gitCounts(cwd), undefined);
			assert.equal(await gitBranch(cwd), null);
		}
		finally { process.env.PATH = original; }
	} finally { rmSync(cwd, { recursive: true, force: true }); }
});

it("git untracked counts use normal mode despite user no/all settings", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "rqw-status-git-config-"));
	const git = (...args: string[]) => execFileSync("git", args, { cwd, stdio: "ignore" });
	try {
		git("init", "-b", "main");
		mkdirSync(join(cwd, "new-dir"));
		writeFileSync(join(cwd, "new-dir", "one"), "one");
		writeFileSync(join(cwd, "new-dir", "two"), "two");
		for (const setting of ["normal", "no", "all"]) {
			git("config", "status.showUntrackedFiles", setting);
			assert.deepEqual(await gitCounts(cwd), { staged: 0, unstaged: 0, untracked: 1 }, setting);
		}
	} finally { rmSync(cwd, { recursive: true, force: true }); }
});

it("the extension imports no other extension folders and is registered in the package", () => {
	for (const file of ["index.ts", "render.ts", "git.ts", "editor.ts"]) {
		const text = readFileSync(join(root, file), "utf8");
		assert.doesNotMatch(text, /from\s+["']\.\.\//);
	}
	const manifest = JSON.parse(readFileSync(join(root, "../../package.json"), "utf8"));
	assert.ok(manifest.pi.extensions.includes("./extensions/RQW-statusbar/index.ts"));
});
