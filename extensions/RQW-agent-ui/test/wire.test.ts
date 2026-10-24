// T17: the cards on both delivery paths, in Pi's real InteractiveMode on a scripted terminal with a faux model, only
// this extension loaded (plus a test helper that stands in for RQW-agent: it delivers a message and owns an `agent`
// tool whose wait result has the producer's shape). Keys go through Pi's own TUI input path (Ctrl+O).
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, it } from "node:test";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import {
	type AgentSessionRuntime,
	createAgentSessionFromServices,
	createAgentSessionRuntime,
	createAgentSessionServices,
	type ExtensionAPI,
	type ExtensionContext,
	initTheme,
	InteractiveMode,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const FOLDER = dirname(dirname(fileURLToPath(import.meta.url)));
const EXTENSION = join(FOLDER, "index.ts");
const CTRL_O = "\x0f";

/** The details RQW-agent attaches (README "UI metadata"): beside delivery and run in a message, under `display` in a wait result. */
const DISPLAY = { id: "agent#3", outcome: "finished", model: "anthropic/claude-opus-5-5", thinking: "medium", seconds: 42 };
const ANSWER = "Проверил отступы.\nВторая строка ответа.\nТретья строка ответа [с скобками].";
const MESSAGE = { customType: "agent", content: `[agent#3] ${ANSWER}`, display: true, details: { delivery: "d-1", run: "1:1", ...DISPLAY } };
const WAIT_ANSWER = "Результат ожидания.\nХвост ответа через wait.";
const WAIT_DETAILS = {
	reason: "result", timed_out: false, receipts: [], statuses: [],
	results: [{ id: "agent#3", run: "1:1", delivery: "d-2", text: WAIT_ANSWER, outcome: "completed", display: DISPLAY }],
};
const WAIT_TEXT = JSON.stringify({ ...WAIT_DETAILS, results: WAIT_DETAILS.results.map(({ display: _display, ...rest }) => rest) });

let root: string;
const savedEnv = { ...process.env };
before(() => {
	root = mkdtempSync(join(tmpdir(), "rqw-agent-ui-"));
	// Pi reads settings and keybindings from here, never from the owner's ~/.pi.
	process.env.PI_CODING_AGENT_DIR = join(root, "agent");
	process.env.PI_OFFLINE = "1";
	mkdirSync(process.env.PI_CODING_AGENT_DIR, { recursive: true });
	initTheme("dark", false);
});
after(() => {
	process.env = savedEnv;
	rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

/** A terminal that records every write, so a test can read what Pi drew, and lets the test press keys. */
class ScriptedTerminal {
	onInput: ((data: string) => void) | undefined;
	onResize: (() => void) | undefined;
	written = "";
	width = 100;
	start(onInput: (data: string) => void, onResize?: () => void) { this.onInput = onInput; this.onResize = onResize; }
	stop() {}
	async drainInput() {}
	write(data: string) { this.written += data; }
	get columns() { return this.width; }
	get rows() { return 40; }
	get kittyProtocolActive() { return false; }
	moveBy() {} hideCursor() {} showCursor() {} clearLine() {} clearFromCursor() {} clearScreen() {}
	setTitle() {} setProgress() {} setProgramStatus() {}
	key(data: string) { this.onInput!(data); }
}

async function until(what: string, check: () => boolean, ms = 10_000) {
	const end = Date.now() + ms;
	while (!check()) {
		if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 80));

type Harness = {
	runtime: AgentSessionRuntime; terminal: ScriptedTerminal; mode: InteractiveMode;
	pi: () => ExtensionAPI; ctx: () => ExtensionContext; sessionStarts: () => number;
	/** What Pi drew since `mark()`, escape sequences removed. */
	drawn: (from: number) => string; mark: () => number;
	/** The whole visible transcript: a width change makes Pi redraw every line, not only the changed ones. */
	screen: () => Promise<string>;
	dispose(): Promise<void>;
};

/** Interactive mode with the cards (unless `off`) and the helper; the faux model first calls `wait`, then answers. */
async function start(name: string, options: { off?: boolean } = {}): Promise<Harness> {
	const cwd = join(root, name);
	mkdirSync(cwd, { recursive: true });
	const agentDir = process.env.PI_CODING_AGENT_DIR!;
	const faux = fauxProvider({ api: `faux-${name}`, provider: `faux-${name}`, models: [{ id: "m" }] });
	faux.setResponses([
		fauxAssistantMessage([fauxToolCall("agent", { action: "wait", ids: ["agent#3"] })], { stopReason: "toolUse" }),
		fauxAssistantMessage("Готово."),
		...Array.from({ length: 6 }, () => fauxAssistantMessage("Готово.")),
	]);
	const modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: null, refreshOnCreate: false });
	faux.provider.auth.apiKey = { name: "Fake key", resolve: async () => ({ auth: { apiKey: "fake" } }) };
	modelRuntime.registerNativeProvider(faux.provider);
	await modelRuntime.setRuntimeApiKey(`faux-${name}`, "fake");
	let helperPi: ExtensionAPI | undefined;
	let helperCtx: ExtensionContext | undefined;
	let starts = 0;
	const helper = (pi: ExtensionAPI) => {
		helperPi = pi;
		pi.on("session_start", (_event, ctx) => { helperCtx = ctx; starts++; });
		// Stands in for RQW-agent's tool: a wait result with the producer's shape, no renderers of its own.
		pi.registerTool({
			name: "agent", label: "agent", description: "stand-in for the RQW-agent tool",
			parameters: Type.Object({ action: Type.String(), ids: Type.Optional(Type.Array(Type.String())) }),
			async execute() { return { content: [{ type: "text", text: WAIT_TEXT }], details: WAIT_DETAILS }; },
		});
	};
	const runtime = await createAgentSessionRuntime(async ({ cwd, sessionManager, sessionStartEvent }) => {
		const services = await createAgentSessionServices({
			cwd, agentDir, modelRuntime,
			settingsManager: SettingsManager.inMemory({ retry: { enabled: false }, quietStartup: true }),
			resourceLoaderOptions: {
				additionalExtensionPaths: options.off ? [] : [EXTENSION],
				extensionFactories: [{ name: "test-helper", factory: helper }],
				noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
			},
		});
		const created = await createAgentSessionFromServices({ services, sessionManager, sessionStartEvent, model: faux.getModel("m"), thinkingLevel: "off" });
		return { ...created, services, diagnostics: services.diagnostics };
	}, { cwd, agentDir, sessionManager: SessionManager.inMemory(cwd) });
	const terminal = new ScriptedTerminal();
	const mode = new InteractiveMode(runtime, { terminal: terminal as never });
	await mode.init();
	assert.deepEqual(runtime.session.resourceLoader.getExtensions().errors, []);
	await until("the helper's session_start", () => starts > 0);
	return {
		runtime, terminal, mode, pi: () => helperPi!, ctx: () => helperCtx!, sessionStarts: () => starts,
		drawn: (from) => stripVTControlCharacters(terminal.written.slice(from)),
		mark: () => terminal.written.length,
		async screen() {
			const from = terminal.written.length;
			terminal.width = terminal.width === 100 ? 101 : 100;
			terminal.onResize?.();
			await settle();
			return stripVTControlCharacters(terminal.written.slice(from)).replace(/ +/g, " ");
		},
		async dispose() {
			if (!runtime.session.isIdle) await runtime.session.abort();
			mode.stop();
			await runtime.dispose();
		},
	};
}

/** Deliver the message the way RQW-agent does and wait until Pi has it in the transcript. */
async function deliver(h: Harness) {
	h.pi().sendMessage(MESSAGE, { triggerTurn: false });
	await until("the delivered message", () => h.runtime.session.messages.some((m) => m.role === "custom"));
	await settle();
}

/** Run the turn in which the model calls `wait` and answers. */
async function waitTurn(h: Harness) {
	await h.runtime.session.prompt("жду агента");
	await until("the turn", () => h.runtime.session.isIdle);
	await settle();
}

it("wire-message-path: the delivered custom message shows the card, Ctrl+O the full original, Ctrl+O again folds back", async () => {
	const h = await start("message");
	try {
		await deliver(h);
		const collapsed = await h.screen();
		assert.match(collapsed, /agent#3 finished · opus medium · 42s/);
		assert.match(collapsed, /Проверил отступы\./);
		assert.doesNotMatch(collapsed, /\[agent\]/, "not Pi's default label box");
		assert.doesNotMatch(collapsed, /Вторая строка ответа/, "collapsed shows only the first answer line");

		h.terminal.key(CTRL_O);
		await settle();
		assert.equal(h.ctx().ui.getToolsExpanded(), true);
		const expanded = await h.screen();
		assert.match(expanded, /agent#3 finished · opus medium · 42s/);
		assert.match(expanded, /Вторая строка ответа\./);
		assert.match(expanded, /Третья строка ответа \[с скобками\]\./, "inner brackets kept");

		h.terminal.key(CTRL_O);
		await settle();
		assert.equal(h.ctx().ui.getToolsExpanded(), false);
		const folded = await h.screen();
		assert.match(folded, /agent#3 finished/);
		assert.doesNotMatch(folded, /Вторая строка ответа/, "folded again");

		const stored = h.runtime.session.messages.find((m) => m.role === "custom") as { content: string; details: unknown };
		assert.equal(stored.content, MESSAGE.content, "stored content is unchanged");
		assert.deepEqual(stored.details, MESSAGE.details);
	} finally {
		await h.dispose();
	}
});

it("wire-wait-path: the wait result shows the card, Ctrl+O the original result JSON, Ctrl+O again folds back", async () => {
	const h = await start("wait");
	try {
		await waitTurn(h);
		const collapsed = await h.screen();
		assert.match(collapsed, /agent#3 finished · opus medium · 42s/);
		assert.match(collapsed, /Результат ожидания\./);
		assert.doesNotMatch(collapsed, /"reason"/, "the JSON is not the collapsed view");
		assert.doesNotMatch(collapsed, /Хвост ответа/);

		h.terminal.key(CTRL_O);
		await settle();
		const expanded = await h.screen();
		assert.match(expanded, /"reason":"result"/, "the original result text is reachable");
		assert.match(expanded, /Хвост ответа/);
		assert.doesNotMatch(expanded, /agent#3 finished/, "the original, not the card");

		h.terminal.key(CTRL_O);
		await settle();
		const folded = await h.screen();
		assert.doesNotMatch(folded, /"reason"/, "folded again");
		assert.match(folded, /agent#3 finished · opus medium · 42s/);

		const result = h.runtime.session.messages.find((m) => m.role === "toolResult") as { content: { text: string }[]; details: unknown };
		assert.equal(result.content[0].text, WAIT_TEXT, "the stored result content is unchanged");
		assert.deepEqual(result.details, WAIT_DETAILS);
	} finally {
		await h.dispose();
	}
});

it("wire-off: without the extension both paths are stock Pi", async () => {
	const h = await start("off", { off: true });
	try {
		await deliver(h);
		await waitTurn(h);
		const drawn = await h.screen();
		assert.match(drawn, /\[agent\]/, "Pi's default custom message label");
		assert.doesNotMatch(drawn, /agent#3 finished/);
		assert.match(drawn, /"reason":"result"/, "Pi's default result text");
	} finally {
		await h.dispose();
	}
});

it("wire-reload-and-switch: reload and a new session register the cards again, the extension holds no subscription", async () => {
	const h = await start("lifecycle");
	try {
		const own = (h.runtime.session.resourceLoader.getExtensions().extensions).find((e) => e.path === EXTENSION)!;
		assert.ok(own, "the extension is loaded");
		assert.equal(own.handlers.size, 0, "no event handler");
		assert.equal(own.tools.size, 0, "no tool");
		assert.deepEqual([...own.messageRenderers.keys()].sort(), ["agent", "code_writer", "review", "shell_runner"]);
		assert.equal(own.toolRenderers?.length, 1);

		// /reload: a fresh extension instance, the old one is stale, the cards still draw.
		const oldPi = h.pi();
		await h.runtime.session.reload();
		await until("the session_start of the reload", () => h.sessionStarts() >= 2);
		assert.throws(() => oldPi.getSessionName(), /stale|reload/i, "the old API is dead after reload");
		const reloaded = h.runtime.session.resourceLoader.getExtensions().extensions.find((e) => e.path === EXTENSION)!;
		assert.notEqual(reloaded, own, "reload built a new extension instance");
		assert.equal(reloaded.handlers.size, 0);
		await deliver(h);
		assert.match(await h.screen(), /agent#3 finished · opus medium · 42s/);

		// A new session: again a fresh instance, the cards draw in it, and nothing of the old one is called.
		const previous = reloaded;
		const starts = h.sessionStarts();
		const result = await h.runtime.newSession();
		assert.equal(result.cancelled, false);
		await until("the session_start of the new session", () => h.sessionStarts() > starts);
		const next = h.runtime.session.resourceLoader.getExtensions().extensions.find((e) => e.path === EXTENSION)!;
		assert.notEqual(next, previous);
		assert.equal(next.handlers.size, 0);
		h.pi().sendMessage(MESSAGE, { triggerTurn: false });
		await until("the delivered message in the new session", () => h.runtime.session.messages.some((m) => m.role === "custom"));
		await settle();
		assert.match(await h.screen(), /agent#3 finished · opus medium · 42s/);
	} finally {
		await h.dispose();
	}
});

it("wire-stock-diagnostics: child_wait stays stock while review messages get cards", async () => {
	const h = await start("diagnostics");
	try {
		for (const [customType, content] of [["child_wait", '{"reason":"timeout","statuses":[]}'], ["review", "[review#1] CLEAN"]]) {
			h.pi().sendMessage({ customType, content, display: true }, { triggerTurn: false });
		}
		await until("diagnostic messages", () => h.runtime.session.messages.filter((m) => m.role === "custom").length === 2);
		const drawn = await h.screen();
		assert.match(drawn, /\[child_wait\]/);
		assert.match(drawn, /"reason":"timeout"/);
		assert.doesNotMatch(drawn, /\[review\]/);
		assert.match(drawn, /review#1 CLEAN/);
		assert.match(drawn, /CLEAN/);
		assert.doesNotMatch(drawn, /agent#\d+ finished/);
	} finally {
		await h.dispose();
	}
});

it("wire-no-subscriptions: the entrypoint source subscribes to nothing and starts no timer or process", () => {
	for (const file of ["index.ts", "wait.ts", "card.ts", "fit.ts", "self.ts", "review.ts"]) {
		const source = readFileSync(join(FOLDER, file), "utf8");
		assert.doesNotMatch(source, /\bpi\.(on|events)\b|setInterval|setTimeout|child_process|requestAnimationFrame/, file);
	}
});
