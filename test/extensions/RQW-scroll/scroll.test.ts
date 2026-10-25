// RQW-scroll with Pi's real renderers, TUI proxy, chat viewport, CustomEditor, selector, overlay and search.
// The extension is loaded by Pi's own resource loader and bound in "tui" mode; the UI context wires
// onTerminalInput and setWidget the way InteractiveMode does (addExtensionTerminalInputListener,
// setExtensionWidget with the proxy). Keys enter through the terminal's input callback, as typed bytes would.
import assert from "node:assert/strict";
import { stripVTControlCharacters } from "node:util";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { Container, getKeybindings, setKeybindings, Text, type Component, type Terminal } from "@earendil-works/pi-tui";
import * as pi from "@earendil-works/pi-coding-agent";

const PI = import.meta.resolve("@earendil-works/pi-coding-agent");
const dist = (path: string) => import(new URL(path, PI).href);
const { createInteractiveTui, createInteractiveTuiReference } = await dist("./modes/interactive/tui-renderer.js");
const { createChatViewport } = await dist("./modes/interactive/chat-viewport.js");
const { KeybindingsManager } = await dist("./core/keybindings.js");
const { getEditorTheme, initTheme } = await dist("./modes/interactive/theme/theme.js");
const EXTENSION = fileURLToPath(new URL("../../../extensions/RQW-scroll/index.ts", import.meta.url));

const ESC = "\x1b";
const PAGE_UP = "\x1b[5~";
const CTRL_END = "\x1b[1;5F";
initTheme("dark");
const keybindings = new KeybindingsManager({});
setKeybindings(keybindings);
// Pi opens transcript search with Ctrl+F on Windows and WSL, Ctrl+Shift+F (here as CSI-u) elsewhere.
const SEARCH = keybindings.getKeys("tui.altScreen.search").includes("ctrl+f") ? "\x06" : "\x1b[102;6u";
assert.ok(keybindings.matches(SEARCH, "tui.altScreen.search"));

class FakeTerminal implements Terminal {
	input: (data: string) => void = () => {};
	start(onInput: (data: string) => void) { this.input = onInput; }
	stop() {}
	async drainInput() {}
	write() {}
	get columns() { return 80; }
	get rows() { return 20; }
	get kittyProtocolActive() { return false; }
	moveBy() {}
	hideCursor() {}
	showCursor() {}
	clearLine() {}
	clearFromCursor() {}
	clearScreen() {}
	setTitle() {}
	setProgress() {}
	setProgramStatus() {}
}

const tmp = mkdtempSync(join(tmpdir(), "rqw-scroll-"));
after(() => rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));

type Ui = ReturnType<typeof createInteractiveTui>;

async function setup(o: { mode: "fullscreen" | "regular"; extension?: boolean }) {
	const terminal = new FakeTerminal();
	const renderer: Ui = createInteractiveTui({ tuiMode: o.mode, terminal });
	const ui = createInteractiveTuiReference(() => renderer);
	const document = new Container();
	for (let i = 0; i < 200; i++) document.addChild(new Text(`line ${i}`, 0, 0));
	const editor = new pi.CustomEditor(ui, getEditorTheme(), keybindings);
	let interrupts = 0;
	editor.onEscape = () => { interrupts++; };
	const editorContainer = new Container();
	editorContainer.addChild(editor);
	const widgetsBelow = new Container();
	const parts = { document, pendingMessages: new Container(), status: new Container(), widgetsAbove: new Container(),
		editor: editorContainer, widgetsBelow, footer: new Container() };
	const viewport = createChatViewport(parts);
	for (const c of Object.values(parts)) renderer.addChild(c as Component);
	if (o.mode === "fullscreen") renderer.setLayoutRoot(viewport.root);
	ui.setFocus(editor);
	ui.start();

	const cwd = mkdtempSync(join(tmp, "s-"));
	const loader = new pi.DefaultResourceLoader({ cwd, agentDir: cwd,
		additionalExtensionPaths: o.extension === false ? [] : [EXTENSION],
		noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
	await loader.reload();
	assert.deepEqual(loader.getExtensions().errors, []);
	const runtime = await pi.ModelRuntime.create({ authPath: join(cwd, "auth.json"), modelsPath: null, refreshOnCreate: false });
	const { session } = await pi.createAgentSession({ cwd, agentDir: cwd, modelRuntime: runtime, resourceLoader: loader,
		sessionManager: pi.SessionManager.inMemory(cwd), settingsManager: pi.SettingsManager.inMemory() });
	const widgets = new Map<string, Component>();
	await session.bindExtensions({ mode: "tui", uiContext: {
		onTerminalInput: (handler) => ui.addInputListener(handler),
		setWidget(key: string, content: unknown) {
			widgets.delete(key);
			if (typeof content === "function") widgets.set(key, content(ui, {}));
			widgetsBelow.clear();
			for (const w of widgets.values()) widgetsBelow.addChild(w);
		},
		notify() {},
	} as unknown as pi.ExtensionUIContext });

	const view = () => ({ following: renderer.mode === "fullscreen" ? (renderer as { isFollowingOutput: boolean }).isFollowingOutput : true,
		top: renderer.mode === "fullscreen" ? (renderer as { viewportTop: number }).viewportTop : 0 });
	const press = (data: string) => { terminal.input(data); renderer.renderNow(); };
	renderer.renderNow();
	const bottom = view().top;
	return {
		renderer, ui, editor, editorContainer, widgets, press, view, bottom,
		get interrupts() { return interrupts; },
		scrollUp() {
			press(PAGE_UP);
			assert.equal(view().following, false, "scrolled up");
			assert.ok(view().top < bottom);
		},
		async shutdown() {
			await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
			session.dispose();
		},
		async close() {
			await this.shutdown();
			renderer.stop();
		},
	};
}

const hint = (t: Awaited<ReturnType<typeof setup>>) =>
	(t.renderer.getScreenLines() as string[]).map(stripVTControlCharacters).find((line) => line.includes("Jump to latest message"))?.match(/\u2193 Jump to latest message[^\u2502]*?\s{2}/)?.[0].trim();

describe("RQW-scroll: Escape in the fullscreen view", () => {
	it("renders Esc in the real fullscreen hint without binding Escape; shutdown restores stock", async () => {
		const original = getKeybindings();
		const t = await setup({ mode: "fullscreen" });
		try {
			assert.equal(hint(t), undefined, "no hint at the bottom");
			t.scrollUp();
			assert.equal(hint(t), "\u2193 Jump to latest message \u00b7 Esc/Ctrl+End");
			assert.equal(getKeybindings().matches(ESC, "tui.altScreen.bottom"), false);
			assert.deepEqual(keybindings.getKeys("tui.altScreen.bottom"), ["ctrl+end"], "original manager unchanged");
			assert.equal(getKeybindings().matches(CTRL_END, "tui.altScreen.bottom"), true);
			await t.shutdown();
			t.renderer.renderNow();
			assert.equal(getKeybindings(), original);
			assert.equal(hint(t), "\u2193 Jump to latest message \u00b7 Ctrl+End");
		} finally { await t.close(); }
	});

	it("the hint preserves configured bottom keys and other registry operations", async () => {
		const t = await setup({ mode: "fullscreen" });
		try {
			getKeybindings().setUserBindings({ "tui.altScreen.bottom": ["ctrl+j", "ctrl+end"] });
			t.scrollUp();
			assert.equal(hint(t), "\u2193 Jump to latest message \u00b7 Esc/Ctrl+J/Ctrl+End");
			assert.deepEqual(getKeybindings().getUserBindings(), { "tui.altScreen.bottom": ["ctrl+j", "ctrl+end"] });
			assert.equal(getKeybindings().matches("\x0a", "tui.altScreen.bottom"), true);
		} finally {
			getKeybindings().setUserBindings({});
			await t.close();
		}
	});
	it("scrolled up: Escape jumps to the latest message and is consumed; the next Escape interrupts", async () => {
		const t = await setup({ mode: "fullscreen" });
		try {
			assert.ok(t.bottom > 0, "the transcript is taller than the viewport");
			assert.equal(t.view().following, true);
			t.scrollUp();
			t.press(ESC);
			assert.deepEqual(t.view(), { following: true, top: t.bottom });
			assert.equal(t.interrupts, 0, "the jump does not interrupt");
			t.press(ESC);
			assert.equal(t.interrupts, 1);
			assert.deepEqual(t.view(), { following: true, top: t.bottom });
		} finally { await t.close(); }
	});

	it("the widget that reaches the TUI renders nothing", async () => {
		const t = await setup({ mode: "fullscreen" });
		try {
			assert.deepEqual([...t.widgets.keys()], ["rqw-scroll"]);
			assert.deepEqual(t.widgets.get("rqw-scroll")!.render(80), []);
		} finally { await t.close(); }
	});

	it("at the bottom: Escape reaches Pi's interrupt", async () => {
		const t = await setup({ mode: "fullscreen" });
		try {
			t.press(ESC);
			assert.equal(t.interrupts, 1);
			assert.deepEqual(t.view(), { following: true, top: t.bottom });
		} finally { await t.close(); }
	});

	it("Ctrl+End still jumps to the latest message", async () => {
		const t = await setup({ mode: "fullscreen" });
		try {
			t.scrollUp();
			t.press(CTRL_END);
			assert.deepEqual(t.view(), { following: true, top: t.bottom });
			assert.equal(t.interrupts, 0);
		} finally { await t.close(); }
	});

	it("a selector in the editor slot keeps its Escape", async () => {
		const t = await setup({ mode: "fullscreen" });
		try {
			t.scrollUp();
			const before = t.view();
			let cancelled = 0;
			const selector = new pi.ExtensionSelectorComponent("Pick", ["a", "b"], () => {}, () => { cancelled++; }, { tui: t.ui });
			t.editorContainer.clear();
			t.editorContainer.addChild(selector);
			t.ui.setFocus(selector);
			t.press(ESC);
			assert.equal(cancelled, 1);
			assert.deepEqual(t.view(), before, "still scrolled up");
			assert.equal(t.interrupts, 0);
			selector.dispose?.();
		} finally { await t.close(); }
	});

	it("a focused overlay keeps its Escape", async () => {
		const t = await setup({ mode: "fullscreen" });
		try {
			t.scrollUp();
			const before = t.view();
			const got: string[] = [];
			const overlay = t.ui.showOverlay({ render: () => ["overlay"], invalidate() {}, handleInput: (d: string) => { got.push(d); } },
				{ anchor: "center", width: 20 });
			t.press(ESC);
			assert.deepEqual(got, [ESC]);
			assert.deepEqual(t.view(), before);
			assert.equal(t.interrupts, 0);
			overlay.hide();
		} finally { await t.close(); }
	});

	it("an open autocomplete list keeps its Escape", async () => {
		const t = await setup({ mode: "fullscreen" });
		try {
			t.editor.setAutocompleteProvider({
				getSuggestions: async () => ({ items: [{ value: "help", label: "help" }, { value: "hello", label: "hello" }], prefix: "/" }),
				applyCompletion: (lines: string[], cursorLine: number, cursorCol: number) => ({ lines, cursorLine, cursorCol }),
			} as never);
			t.scrollUp();
			const before = t.view();
			t.press("/");
			for (let i = 0; i < 20 && !t.editor.isShowingAutocomplete(); i++) await new Promise((r) => setImmediate(r));
			assert.equal(t.editor.isShowingAutocomplete(), true);
			t.press(ESC);
			assert.equal(t.editor.isShowingAutocomplete(), false, "Escape closed the list");
			assert.equal(t.interrupts, 0);
			assert.deepEqual(t.view(), before);
			t.press(ESC);
			assert.deepEqual(t.view(), { following: true, top: t.bottom }, "then Escape jumps");
		} finally { await t.close(); }
	});

	it("transcript search: the first Escape closes search, the next one jumps", async () => {
		const t = await setup({ mode: "fullscreen" });
		try {
			t.scrollUp();
			const before = t.view();
			t.press(SEARCH);
			assert.equal(t.renderer.hasOverlay(), true, "search is open");
			t.press(ESC);
			assert.equal(t.renderer.hasOverlay(), false, "search closed");
			assert.deepEqual(t.view(), before);
			t.press(ESC);
			assert.deepEqual(t.view(), { following: true, top: t.bottom });
			assert.equal(t.interrupts, 0);
		} finally { await t.close(); }
	});
});

describe("RQW-scroll: elsewhere Escape is stock", () => {
	it("inline (regular) mode: Escape reaches Pi's interrupt", async () => {
		const t = await setup({ mode: "regular" });
		try {
			assert.equal(t.renderer.mode, "regular");
			t.press(ESC);
			assert.equal(t.interrupts, 1);
		} finally { await t.close(); }
	});

	it("extension not loaded: scrolled up, Escape interrupts and the view stays", async () => {
		const t = await setup({ mode: "fullscreen", extension: false });
		try {
			assert.deepEqual([...t.widgets.keys()], []);
			t.scrollUp();
			assert.equal(hint(t), "\u2193 Jump to latest message \u00b7 Ctrl+End");
			const before = t.view();
			t.press(ESC);
			assert.equal(t.interrupts, 1);
			assert.deepEqual(t.view(), before);
		} finally { await t.close(); }
	});

	it("after session_shutdown the listener and widget are gone", async () => {
		const t = await setup({ mode: "fullscreen" });
		try {
			await t.shutdown();
			assert.deepEqual([...t.widgets.keys()], []);
			t.scrollUp();
			const before = t.view();
			t.press(ESC);
			assert.equal(t.interrupts, 1);
			assert.deepEqual(t.view(), before);
		} finally { t.renderer.stop(); }
	});
});
