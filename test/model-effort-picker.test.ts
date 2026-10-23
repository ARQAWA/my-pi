// Pi's real InteractiveMode on a scripted terminal with the production RQW-prompt, RQW-statusbar and RQW-models
// extensions loaded through the resource loader, faux authenticated anthropic/openai-codex models, and a test
// helper that only observes public events and UI prompts. Keys go through Pi's own TUI input path.
import "./no-network.mjs";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, it } from "node:test";
import { fileURLToPath } from "node:url";
import { fauxAssistantMessage, fauxProvider, getCurrentSystemPrompt, type Message } from "@earendil-works/pi-ai";
import {
	type AgentSession,
	type AgentSessionRuntime,
	createAgentSessionFromServices,
	createAgentSessionRuntime,
	createAgentSessionServices,
	type ExtensionAPI,
	initTheme,
	InteractiveMode,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";

const ROOT_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const PROMPT = join(ROOT_DIR, "extensions/RQW-prompt/index.ts");
const STATUSBAR = join(ROOT_DIR, "extensions/RQW-statusbar/index.ts");
const MODELS = join(ROOT_DIR, "extensions/RQW-models/index.ts");
const EXTENSIONS = [PROMPT, STATUSBAR, MODELS];

// Terminal key sequences (xterm encodings, Kitty protocol off).
const KEY = {
	enter: "\r",
	escape: "\x1b",
	up: "\x1b[A", down: "\x1b[B", right: "\x1b[C", left: "\x1b[D",
	shiftUp: "\x1b[1;2A", shiftDown: "\x1b[1;2B", shiftRight: "\x1b[1;2C", shiftLeft: "\x1b[1;2D",
};
// The chooser is recognised by its title on the rendered terminal output. Raw shortcut UI does not emit ui_prompt
// events, so the observer records are diagnostic only.
const TITLE_ON_SCREEN = /Model \/ effort|RQW model \/ effort/;
// The diff renderer does not rewrite an unchanged title row on a later open, so a fresh cursor row ("› provider/model") marks the chooser too.
const CHOOSER_ROW = /› [\w.-]+\/[\w.-]+/;
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-_]/g;

let root: string;
const savedEnv = { ...process.env };
before(() => {
	root = mkdtempSync(join(tmpdir(), "rqw-model-effort-picker-"));
	// Pi reads keybindings, settings and auth from here, never from the owner's ~/.pi.
	process.env.PI_CODING_AGENT_DIR = join(root, "agent");
	process.env.PI_OFFLINE = "1";
	mkdirSync(process.env.PI_CODING_AGENT_DIR, { recursive: true });
	initTheme("dark", false);
});
after(() => {
	process.env = savedEnv;
	rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

/** A terminal that records what Pi writes and lets the test type. */
class ScriptedTerminal {
	onInput: ((data: string) => void) | undefined;
	output: string[] = [];
	start(onInput: (data: string) => void) { this.onInput = onInput; }
	stop() {}
	async drainInput() {}
	write(data: string) { this.output.push(data); }
	get columns() { return 100; }
	get rows() { return 40; }
	get kittyProtocolActive() { return false; }
	moveBy() {} hideCursor() {} showCursor() {} clearLine() {} clearFromCursor() {} clearScreen() {}
	setTitle() {} setProgress() {} setProgramStatus() {}
	key(data: string) { this.onInput!(data); }
	type(text: string) { for (const ch of text) this.onInput!(ch); }
	/** Everything written since `mark`, with escape sequences removed. */
	screenSince(mark: number): string { return this.output.slice(mark).join("").replace(ANSI, ""); }
}

async function until(what: string, check: () => boolean, ms = 10_000) {
	const end = Date.now() + ms;
	while (!check()) {
		if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

type Observed = { modelSelect: { id: string; source: string; previous?: string }[]; thinkingSelect: string[]; prompts: { title?: string; kind: string; end: boolean }[] };

type Harness = {
	session: AgentSession; terminal: ScriptedTerminal; mode: InteractiveMode; runtime: AgentSessionRuntime;
	requests: { model: string; reasoning: string | undefined; system: string }[];
	observed: Observed;
	/** Labels a draft frame may render for a model id: the canonical id and, when present, its name. */
	labelsOf(id: string): string[];
	helper(): { ui: { getEditorText(): string; setEditorText(text: string): void } };
	dispose(): Promise<void>;
};

const modelOf = (session: AgentSession) => session.model ? `${session.model.provider}/${session.model.id}` : "none";

/** Open ui.custom prompts: starts minus ends of kind "custom" (only the outermost prompt emits events). */
const customDepth = (h: Harness) => h.observed.prompts.reduce((n, p) => n + (p.kind === "custom" ? (p.end ? -1 : 1) : 0), 0);
/** Types `key` after capturing the output mark, then waits until the chooser title is rendered since that mark. */
async function openChooser(h: Harness, key: string): Promise<number> {
	const mark = h.terminal.output.length;
	h.terminal.key(key);
	try {
		await until("chooser open with its title or a fresh chooser row rendered", () => TITLE_ON_SCREEN.test(h.terminal.screenSince(mark)) || CHOOSER_ROW.test(h.terminal.screenSince(mark)));
	} catch (error) {
		const screen = h.terminal.screenSince(mark);
		throw new Error([
			(error as Error).message,
			`key=${JSON.stringify(key)} customDepth=${customDepth(h)} titleOnScreen=${TITLE_ON_SCREEN.test(screen)}`,
			`prompts=${JSON.stringify(h.observed.prompts)}`,
			`model=${modelOf(h.session)} thinking=${h.session.thinkingLevel} modelSelect=${JSON.stringify(h.observed.modelSelect)}`,
			`writesSinceMark=${h.terminal.output.length - mark}`,
			`screenSinceMark(last 1500)=${JSON.stringify(screen.slice(-1500))}`,
		].join("\n"));
	}
	return mark;
}
/** Types `text` and presses Enter; Pi's run loop takes the submitted text through the public getUserInput() and sends it. */
async function submitTyped(h: Harness, text: string) {
	const submitted = h.mode.getUserInput();
	h.terminal.type(text);
	h.terminal.key(KEY.enter);
	await h.session.prompt(await submitted);
}
/** Focus is back on the editor when a typed sentinel lands in it; a still-focused chooser ignores the text. */
async function chooserClosed(h: Harness) {
	const sentinel = "z";
	h.terminal.type(sentinel);
	await until("focus returned to the editor", () => h.helper().ui.getEditorText() === sentinel);
	h.helper().ui.setEditorText("");
	assert.equal(h.helper().ui.getEditorText(), "");
}

/** Pi's interactive mode with the three production extensions and a helper that only observes public events. */
async function start(name: string): Promise<Harness> {
	const cwd = join(root, name);
	mkdirSync(cwd, { recursive: true });
	const agentDir = process.env.PI_CODING_AGENT_DIR!;
	const requests: Harness["requests"] = [];
	const answer = (context: { messages: unknown[] }, options: { reasoning?: string } | undefined, model: { provider: string; id: string }) => {
		requests.push({
			model: `${model.provider}/${model.id}`,
			reasoning: options?.reasoning,
			system: getCurrentSystemPrompt(context.messages as Message[]) ?? "",
		});
		return fauxAssistantMessage("done");
	};
	// Authenticated faux providers under the names RQW-models lists: anthropic and openai-codex.
	const anthropic = fauxProvider({ api: `faux-anthropic-${name}`, provider: "anthropic", models: [
		{ id: "claude-opus-5-5", reasoning: true }, { id: "claude-sonnet-5-5", reasoning: true }, { id: "claude-haiku-5-5", reasoning: true },
	] });
	const openai = fauxProvider({ api: `faux-openai-${name}`, provider: "openai-codex", models: [
		{ id: "gpt-6.1-sol", reasoning: true }, { id: "gpt-6-sol", reasoning: true }, { id: "gpt-5.6-luna", reasoning: true }, { id: "gpt-6-luna", reasoning: true },
	] });
	for (const faux of [anthropic, openai]) {
		faux.setResponses(Array.from({ length: 64 }, () => (context: { messages: unknown[] }, options: { reasoning?: string } | undefined, _state: unknown, model: { provider: string; id: string }) => answer(context, options, model)));
		faux.provider.auth.apiKey = { name: "Fake key", resolve: async () => ({ auth: { apiKey: "fake" } }) };
	}
	const modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: null, refreshOnCreate: false });
	modelRuntime.registerNativeProvider(anthropic.provider);
	modelRuntime.registerNativeProvider(openai.provider);
	await modelRuntime.setRuntimeApiKey("anthropic", "fake");
	await modelRuntime.setRuntimeApiKey("openai-codex", "fake");

	const observed: Observed = { modelSelect: [], thinkingSelect: [], prompts: [] };
	let helperCtx: { ui: { getEditorText(): string; setEditorText(text: string): void } } | undefined;
	// Public extension API only: events and the session context.
	const helper = (pi: ExtensionAPI) => {
		pi.on("session_start", (_event, ctx) => { helperCtx = ctx as never; });
		pi.on("model_select", (event) => {
			observed.modelSelect.push({ id: `${event.model.provider}/${event.model.id}`, source: event.source, previous: event.previousModel ? `${event.previousModel.provider}/${event.previousModel.id}` : undefined });
		});
		pi.on("thinking_level_select", (event) => { observed.thinkingSelect.push(event.level); });
		pi.on("ui_prompt_start", (event) => { observed.prompts.push({ title: event.title, kind: event.kind, end: false }); });
		pi.on("ui_prompt_end", (event) => { observed.prompts.push({ title: event.title, kind: event.kind, end: true }); });
	};
	const runtime = await createAgentSessionRuntime(async ({ cwd, sessionManager, sessionStartEvent }) => {
		const services = await createAgentSessionServices({
			cwd, agentDir, modelRuntime,
			settingsManager: SettingsManager.inMemory({
				retry: { enabled: false }, quietStartup: true,
				compaction: { enabled: false }, cacheWarming: "off",
			}),
			resourceLoaderOptions: {
				additionalExtensionPaths: EXTENSIONS,
				extensionFactories: [{ name: "test-helper", factory: helper }],
				noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
			},
		});
		const created = await createAgentSessionFromServices({ services, sessionManager, sessionStartEvent, model: anthropic.getModel("claude-sonnet-5-5"), thinkingLevel: "medium" });
		return { ...created, services, diagnostics: services.diagnostics };
	}, { cwd, agentDir, sessionManager: SessionManager.inMemory(cwd) });
	const terminal = new ScriptedTerminal();
	const mode = new InteractiveMode(runtime, { terminal: terminal as never });
	await mode.init();
	const session = runtime.session;
	const loaded = session.resourceLoader.getExtensions();
	assert.deepEqual(loaded.errors, []);
	// The startup default of RQW-models may move the session to Opus; the baseline is set through public setters.
	await settle();
	await session.setModel(anthropic.getModel("claude-sonnet-5-5")!);
	session.setThinkingLevel("medium");
	await settle();
	observed.modelSelect.length = 0;
	observed.thinkingSelect.length = 0;
	observed.prompts.length = 0;
	requests.length = 0;
	return {
		session, terminal, mode, runtime, requests, observed,
		labelsOf(id: string) {
			const model = anthropic.getModel(id) ?? openai.getModel(id);
			return [model?.id, model?.name].filter((label): label is string => typeof label === "string" && label.length > 0);
		},
		helper: () => helperCtx!,
		async dispose() {
			if (!session.isIdle) await session.abort();
			mode.stop();
			await runtime.dispose();
		},
	};
}

it("loads the three production extensions by their resource paths, with no load errors", async () => {
	const h = await start("loaded");
	try {
		const paths = h.session.resourceLoader.getExtensions().extensions.map((e) => e.path);
		for (const path of EXTENSIONS) assert.ok(paths.includes(path), `${path} is loaded`);
		assert.equal(h.session.resourceLoader.getExtensions().errors.length, 0);
	} finally {
		await h.dispose();
	}
});

it("the first Shift+Up opens the chooser, draws the first step at once, and Escape leaves the session untouched", async () => {
	const h = await start("escape");
	try {
		const before = { model: modelOf(h.session), thinking: h.session.thinkingLevel, entries: h.session.sessionManager.getEntries().length };
		const mark = await openChooser(h, KEY.shiftUp);
		const labels = h.labelsOf("claude-opus-5-5");
		await until("first draft rendered", () => labels.some((label) => h.terminal.screenSince(mark).includes(label)));
		h.terminal.key(KEY.escape);
		await chooserClosed(h);
		assert.equal(modelOf(h.session), before.model);
		assert.equal(h.session.thinkingLevel, before.thinking);
		assert.equal(h.session.sessionManager.getEntries().length, before.entries, "no transcript entry");
		assert.deepEqual(h.observed.modelSelect, []);
		assert.deepEqual(h.observed.thinkingSelect, []);
		assert.equal(h.requests.length, 0, "navigation sends no request");
	} finally {
		await h.dispose();
	}
});

it("each of the four initiating keys opens the chooser with its title on screen", async () => {
	const h = await start("four-keys");
	try {
		for (const key of [KEY.shiftUp, KEY.shiftDown, KEY.shiftLeft, KEY.shiftRight]) {
			const mark = await openChooser(h, key);
			if (key === KEY.shiftUp) {
				// Shift+Up drafts Opus on the first frame; either its id or its name may be drawn.
				const labels = h.labelsOf("claude-opus-5-5");
				await until("first draft rendered", () => labels.some((label) => h.terminal.screenSince(mark).includes(label)));
			}
			h.terminal.key(KEY.escape);
			await chooserClosed(h);
		}
		assert.equal(modelOf(h.session), "anthropic/claude-sonnet-5-5");
		assert.equal(h.session.thinkingLevel, "medium");
		assert.deepEqual(h.observed.modelSelect, []);
		assert.deepEqual(h.observed.thinkingSelect, []);
		assert.equal(h.requests.length, 0);
	} finally {
		await h.dispose();
	}
});

it("Enter commits a changed model with the selected effort, and the next typed prompt is sent with both", async () => {
	const h = await start("commit-model");
	try {
		const before = h.session.sessionManager.getEntries().map((e) => e.type);
		await openChooser(h, KEY.shiftUp);
		// Draft: Opus (one step stronger than Sonnet). Right raises the effort from medium to high.
		h.terminal.key(KEY.right);
		h.terminal.key(KEY.enter);
		await chooserClosed(h);
		await until("model and effort committed", () => modelOf(h.session) === "anthropic/claude-opus-5-5" && h.session.thinkingLevel === "high");
		assert.equal(h.session.thinkingLevel, "high");
		assert.deepEqual(h.observed.modelSelect.map((e) => e.id), ["anthropic/claude-opus-5-5"]);
		assert.equal(h.observed.modelSelect[0].previous, "anthropic/claude-sonnet-5-5");
		assert.deepEqual(h.observed.thinkingSelect, ["high"]);
		assert.equal(h.requests.length, 0, "the commit itself sends nothing");

		// Compare the transcript delta against the snapshot taken before the key, not the whole history.
		const added = h.session.sessionManager.getEntries().map((e) => e.type).slice(before.length);
		assert.equal(added.filter((type) => type === "model_change").length, 1, "transcript records exactly one model change");
		assert.equal(added.filter((type) => type === "thinking_level_change").length, 1, "transcript records exactly one effort change");

		// Typed prompt through the real editor.
		await submitTyped(h, "next");
		await until("typed prompt answered", () => h.requests.length === 1 && h.session.isIdle);
		assert.equal(h.requests[0].model, "anthropic/claude-opus-5-5");
		assert.equal(h.requests[0].reasoning, "high");
		assert.match(h.requests[0].system, /- Model: anthropic\/claude-opus-5-5/, "the prompt hook names the committed model");
		assert.equal(h.helper().ui.getEditorText(), "", "the editor is empty after submit");

		// Public session.prompt also goes out with the committed model and effort.
		await h.session.prompt("again");
		await until("second prompt answered", () => h.requests.length === 2 && h.session.isIdle);
		assert.equal(h.requests[1].model, "anthropic/claude-opus-5-5");
		assert.equal(h.requests[1].reasoning, "high");
	} finally {
		await h.dispose();
	}
});

it("an unchanged model with a new effort changes only the thinking level, no model_select", async () => {
	const h = await start("reasoning-only");
	try {
		const before = h.session.sessionManager.getEntries().map((e) => e.type);
		await openChooser(h, KEY.shiftRight);
		h.terminal.key(KEY.enter);
		await chooserClosed(h);
		await until("effort committed", () => h.session.thinkingLevel !== "medium");
		assert.equal(modelOf(h.session), "anthropic/claude-sonnet-5-5");
		assert.deepEqual(h.observed.modelSelect, [], "no model selection for a reasoning-only change");
		assert.equal(h.observed.thinkingSelect.length, 1);
		// Delta since the snapshot: exactly the intended thinking change and no model change.
		const added = h.session.sessionManager.getEntries().map((e) => e.type).slice(before.length);
		assert.equal(added.filter((type) => type === "model_change").length, 0, "no model_change added");
		assert.equal(added.filter((type) => type === "thinking_level_change").length, 1, "exactly one effort change added");

		// A repeated Enter after the chooser closed does not commit again.
		h.terminal.key(KEY.enter);
		await settle();
		assert.equal(h.observed.thinkingSelect.length, 1, "no duplicate commit");
		assert.equal(h.observed.modelSelect.length, 0);

		await h.session.prompt("check");
		await until("prompt answered", () => h.requests.length === 1 && h.session.isIdle);
		assert.equal(h.requests[0].model, "anthropic/claude-sonnet-5-5");
		assert.equal(h.requests[0].reasoning, h.session.thinkingLevel);
	} finally {
		await h.dispose();
	}
});

it("plain arrows move the draft, and Escape after navigation changes nothing", async () => {
	const h = await start("navigate");
	try {
		await openChooser(h, KEY.shiftUp);
		// Shift+Up drafts Opus; plain Down moves the draft weaker; plain Left lowers the effort.
		h.terminal.key(KEY.down);
		h.terminal.key(KEY.down);
		h.terminal.key(KEY.left);
		h.terminal.key(KEY.escape);
		await chooserClosed(h);
		assert.equal(modelOf(h.session), "anthropic/claude-sonnet-5-5");
		assert.equal(h.session.thinkingLevel, "medium");
		assert.deepEqual(h.observed.modelSelect, []);
		assert.deepEqual(h.observed.thinkingSelect, []);
		assert.equal(h.requests.length, 0);
	} finally {
		await h.dispose();
	}
});

it("the statusbar custom editor still takes typed text and submits it after a chooser commit", async () => {
	const h = await start("statusbar-editor");
	try {
		await openChooser(h, KEY.shiftRight);
		h.terminal.key(KEY.enter);
		await chooserClosed(h);
		await until("effort committed", () => h.session.thinkingLevel !== "medium");
		const submitted = h.mode.getUserInput();
		h.terminal.type("typed");
		assert.equal(h.helper().ui.getEditorText(), "typed");
		h.terminal.key(KEY.enter);
		await h.session.prompt(await submitted);
		await until("typed prompt answered", () => h.requests.length === 1 && h.session.isIdle);
		assert.equal(h.requests[0].model, "anthropic/claude-sonnet-5-5");
	} finally {
		await h.dispose();
	}
});

it("the stock /model command is not replaced by the chooser", async () => {
	const h = await start("model-command");
	try {
		// The stock /model command opens no chooser: no fresh chooser title is drawn after it.
		const mark = h.terminal.output.length;
		h.terminal.type("/model");
		h.terminal.key(KEY.enter);
		await settle();
		assert.equal(TITLE_ON_SCREEN.test(h.terminal.screenSince(mark)), false, "no chooser title is drawn after /model");
		h.terminal.key(KEY.escape);
		assert.equal(modelOf(h.session), "anthropic/claude-sonnet-5-5");
	} finally {
		await h.dispose();
	}
});

it("reload with a chooser draft open returns focus and changes nothing", async () => {
	const h = await start("reload");
	try {
		const before = { model: modelOf(h.session), thinking: h.session.thinkingLevel, entries: h.session.sessionManager.getEntries().length };
		await openChooser(h, KEY.shiftUp);
		await h.session.reload();
		await settle();
		await chooserClosed(h);
		assert.equal(modelOf(h.session), before.model);
		assert.equal(h.session.thinkingLevel, before.thinking);
		assert.equal(h.session.sessionManager.getEntries().length, before.entries, "no transcript entry");
		assert.deepEqual(h.observed.modelSelect, []);
		assert.deepEqual(h.observed.thinkingSelect, []);
		assert.equal(h.requests.length, 0, "reload sends no request");

	} finally {
		await h.dispose();
	}
});

it("prompting after a cancelled chooser reaches the model that was current before it", async () => {
	const h = await start("cancel-then-prompt");
	try {
		await openChooser(h, KEY.shiftDown);
		h.terminal.key(KEY.escape);
		await chooserClosed(h);
		await submitTyped(h, "go");
		await until("prompt answered", () => h.requests.length === 1 && h.session.isIdle);
		assert.equal(h.requests[0].model, "anthropic/claude-sonnet-5-5");
		assert.equal(h.requests[0].reasoning, "medium");
	} finally {
		await h.dispose();
	}
});
