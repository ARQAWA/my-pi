// RQW-thinking alone: Pi's real InteractiveMode on a scripted terminal, a scripted faux model that streams thinking,
// isolated temporary agent folders and in-memory settings. No network, no real model, no owner settings.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { type AssistantMessage, fauxAssistantMessage, fauxProvider, fauxText, fauxThinking, type Message } from "@earendil-works/pi-ai";
import {
	AssistantMessageComponent,
	type AgentSession,
	type AgentSessionRuntime,
	createAgentSessionFromServices,
	createAgentSessionRuntime,
	createAgentSessionServices,
	DefaultResourceLoader,
	getMarkdownTheme,
	initTheme,
	InteractiveMode,
	type MarkdownTransformContext,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { hideThinking } from "../../../extensions/RQW-thinking/index.ts";

const EXTENSION = join(dirname(fileURLToPath(import.meta.url)), "../../../extensions/RQW-thinking", "index.ts");
const SECRET = "SECRET-REASONING-alpha beta gamma";
const ANSWER = "VISIBLE-ANSWER-delta";
const STOCK_LABEL = "Thinking...";

let root: string;
const savedEnv = { ...process.env };
before(() => {
	root = mkdtempSync(join(tmpdir(), "rqw-thinking-"));
	process.env.PI_CODING_AGENT_DIR = join(root, "agent");
	process.env.PI_OFFLINE = "1";
	mkdirSync(process.env.PI_CODING_AGENT_DIR, { recursive: true });
	initTheme("dark", false);
});
after(() => {
	process.env = savedEnv;
	rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

// biome-ignore lint/suspicious/noControlCharactersInRegex: terminal output
const plain = (s: string) => s.replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, "").replace(/\x1b\[[0-9;?<>=]*[ -/]*[@-~]/g, "").replace(/\x1b[@-_]/g, "");

/** A terminal that keeps everything Pi writes and lets the test type. */
class ScriptedTerminal {
	onInput: ((data: string) => void) | undefined;
	out = "";
	start(onInput: (data: string) => void) { this.onInput = onInput; }
	stop() {}
	async drainInput() {}
	write(data: string) { this.out += data; }
	get columns() { return 100; }
	get rows() { return 40; }
	get kittyProtocolActive() { return false; }
	moveBy() {} hideCursor() {} showCursor() {} clearLine() {} clearFromCursor() {} clearScreen() {}
	setTitle() {} setProgress() {} setProgramStatus() {}
	type(text: string) { for (const ch of text) this.onInput!(ch); }
	key(data: string) { this.onInput!(data); }
}

async function until(what: string, check: () => boolean, ms = 10_000) {
	const end = Date.now() + ms;
	while (!check()) {
		if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
}

type Harness = {
	session: AgentSession; runtime: AgentSessionRuntime; terminal: ScriptedTerminal; requests: Message[][];
	starts: () => number; dispose(): Promise<void>;
};

let n = 0;
async function start(o: { off?: boolean; hide: boolean }): Promise<Harness> {
	const name = `s${n++}`;
	const cwd = join(root, name);
	mkdirSync(cwd, { recursive: true });
	const agentDir = process.env.PI_CODING_AGENT_DIR!;
	const requests: Message[][] = [];
	const faux = fauxProvider({ api: `faux-${name}`, provider: `faux-${name}`, models: [{ id: "m", reasoning: true }] });
	faux.setResponses(Array.from({ length: 4 }, (_, i) => (context: { messages: unknown[] }) => {
		requests.push(structuredClone(context.messages) as Message[]);
		return fauxAssistantMessage([fauxThinking(`${SECRET} ${i}`), fauxText(`${ANSWER} ${i}`)]);
	}));
	const modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: null, refreshOnCreate: false });
	faux.provider.auth.apiKey = { name: "Fake key", resolve: async () => ({ auth: { apiKey: "fake" } }) };
	modelRuntime.registerNativeProvider(faux.provider);
	await modelRuntime.setRuntimeApiKey(`faux-${name}`, "fake");
	let starts = 0;
	const runtime = await createAgentSessionRuntime(async ({ cwd, sessionManager, sessionStartEvent }) => {
		const services = await createAgentSessionServices({
			cwd, agentDir, modelRuntime,
			settingsManager: SettingsManager.inMemory({ retry: { enabled: false }, quietStartup: true, hideThinkingBlock: o.hide }),
			resourceLoaderOptions: {
				additionalExtensionPaths: o.off ? [] : [EXTENSION],
				extensionFactories: [{ name: "test-helper", factory: (pi) => pi.on("session_start", () => { starts++; }) }],
				noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
			},
		});
		const created = await createAgentSessionFromServices({ services, sessionManager, sessionStartEvent, model: faux.getModel("m"), thinkingLevel: "low" });
		return { ...created, services, diagnostics: services.diagnostics };
	}, { cwd, agentDir, sessionManager: SessionManager.inMemory(cwd) });
	const terminal = new ScriptedTerminal();
	const mode = new InteractiveMode(runtime, { terminal: terminal as never });
	await mode.init();
	assert.deepEqual(runtime.session.resourceLoader.getExtensions().errors, []);
	return {
		session: runtime.session, runtime, terminal, requests, starts: () => starts,
		async dispose() { mode.stop(); await runtime.dispose(); },
	};
}

/** One prompt, answered by the faux model and drawn by Pi's interactive mode; returns once the answer is on screen. */
async function ask(h: Harness, text: string, i: number) {
	await h.session.prompt(text);
	await until(`answer ${i} on screen`, () => plain(h.terminal.out).includes(`${ANSWER} ${i}`) && h.session.isIdle);
	await new Promise((resolve) => setTimeout(resolve, 50));
}

const thinkingOf = (m: Message | undefined) =>
	m?.role === "assistant" ? (m as AssistantMessage).content.filter((c) => c.type === "thinking").map((c) => (c as { thinking: string }).thinking) : [];

describe("RQW-thinking", () => {
	it("thinking-transformer: only assistant-thinking Markdown is emptied, streaming or not", () => {
		const ctx = (messageType: MarkdownTransformContext["messageType"], isStreaming: boolean): MarkdownTransformContext => ({ messageType, isStreaming, availableWidth: 80 });
		for (const streaming of [false, true]) {
			assert.equal(hideThinking(SECRET, ctx("assistant-thinking", streaming)), "");
			assert.equal(hideThinking("**text**", ctx("assistant", streaming)), "**text**");
			assert.equal(hideThinking("user *text*", ctx("user", streaming)), "user *text*");
		}
	});

	it("thinking-registration: one Markdown transformer and one session_start handler, nothing else", async () => {
		const cwd = join(root, "load");
		const agentDir = join(cwd, "agent");
		mkdirSync(agentDir, { recursive: true });
		const loader = new DefaultResourceLoader({ cwd, agentDir, additionalExtensionPaths: [EXTENSION], noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
		await loader.reload();
		assert.deepEqual(loader.getExtensions().errors, []);
		const [ext] = loader.getExtensions().extensions;
		assert.equal(ext.path, EXTENSION);
		assert.equal(typeof ext.markdownTransformer, "function");
		assert.deepEqual([...ext.handlers.keys()], ["session_start"]);
		assert.deepEqual([ext.tools.size, ext.commands.size, ext.shortcuts.size, ext.flags.size, ext.messageRenderers.size, ext.toolRenderers?.length ?? 0], [0, 0, 0, 0, 0, 0]);
	});

	for (const hide of [false, true]) {
		const branch = hide ? "hidden" : "shown";
		it(`thinking-stock-control (${branch}): without the extension Pi shows the ${hide ? "label" : "reasoning text"}`, async () => {
			const h = await start({ off: true, hide });
			try {
				await ask(h, "go", 0);
				const out = plain(h.terminal.out);
				if (hide) { assert.ok(out.includes(STOCK_LABEL)); assert.ok(!out.includes(SECRET)); }
				else assert.ok(out.includes(SECRET));
			} finally { await h.dispose(); }
		});

		it(`thinking-hidden-in-transcript (${branch}): no reasoning text and no label, answer shown, stored data and context unchanged`, async () => {
			const h = await start({ hide });
			try {
				await ask(h, "first", 0);
				await ask(h, "second", 1);
				const out = plain(h.terminal.out);
				assert.ok(out.includes(`${ANSWER} 0`) && out.includes(`${ANSWER} 1`), "answers are drawn");
				assert.ok(!out.includes("SECRET-REASONING"), "no reasoning text was ever written to the terminal");
				assert.ok(!out.includes(STOCK_LABEL), "no hidden-thinking label");
				// Stored messages and the session file keep the reasoning.
				const assistants = h.session.messages.filter((m) => m.role === "assistant") as Message[];
				assert.deepEqual(assistants.map((m) => thinkingOf(m)), [[`${SECRET} 0`], [`${SECRET} 1`]]);
				const entries = h.session.sessionManager.getEntries().flatMap((e) => (e.type === "message" ? [e.message as Message] : []));
				assert.deepEqual(entries.filter((m) => m.role === "assistant").map((m) => thinkingOf(m)), [[`${SECRET} 0`], [`${SECRET} 1`]]);
				// The model context of the second request carries the first reasoning.
				assert.equal(h.requests.length, 2);
				assert.deepEqual(h.requests[1].filter((m) => m.role === "assistant").map((m) => thinkingOf(m)), [[`${SECRET} 0`]]);
			} finally { await h.dispose(); }
		});
	}

	it("thinking-after-reload: Pi resets the label on /reload and the extension sets it empty again", async () => {
		const h = await start({ hide: true });
		try {
			await ask(h, "first", 0);
			const before = h.starts();
			h.terminal.type("/reload");
			h.terminal.key("\r");
			await until("session_start after /reload", () => h.starts() > before);
			const mark = h.terminal.out.length;
			await ask(h, "after reload", 1);
			const out = plain(h.terminal.out.slice(mark));
			assert.ok(out.includes(`${ANSWER} 1`));
			assert.ok(!out.includes(STOCK_LABEL) && !out.includes("SECRET-REASONING"));
		} finally { await h.dispose(); }
	});

	it("thinking-native-spacing: Pi's exported component keeps only its own blank rows (accepted residual spacing)", () => {
		const message = fauxAssistantMessage([fauxThinking(SECRET), fauxText(ANSWER)]);
		const rows = (hidden: boolean, label: string, transformers: typeof hideThinking[]) =>
			new AssistantMessageComponent(message, hidden, getMarkdownTheme(), label, 1, transformers).render(60).map(plain);
		for (const hidden of [false, true]) {
			const stock = rows(hidden, STOCK_LABEL, []);
			const ours = rows(hidden, "", [hideThinking]);
			assert.ok(stock.some((r) => r.includes(hidden ? STOCK_LABEL : "SECRET")), "stock draws the thinking row");
			const drawn = ours.filter((r) => r.trim() !== "");
			assert.equal(drawn.length, 1, "only the answer row has text");
			assert.equal(drawn[0].trim(), ANSWER);
			assert.ok(ours.every((r) => !r.includes("SECRET") && !r.includes(STOCK_LABEL)));
			assert.ok(ours.length <= stock.length, "never more rows than stock");
			assert.ok(ours.length >= 2, "Pi's leading spacer and the thinking slot remain: no zero-row promise");
		}
	});
});
