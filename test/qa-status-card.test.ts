// The qa-status transcript card: pure rows, the extension's registration, and Pi's real InteractiveMode on a scripted
// terminal (Ctrl+O through Pi's own input path). Local development tooling: macOS only, like the extension.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { stripVTControlCharacters } from "node:util";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import {
	createAgentSessionFromServices, createAgentSessionRuntime, createAgentSessionServices, type ExtensionAPI,
	initTheme, InteractiveMode, ModelRuntime, SessionManager, SettingsManager,
} from "@earendil-works/pi-coding-agent";
import qaExtension from "../.pi/extensions/qa-status/index.ts";
import { createQaCard, parseQa, qaLines } from "../.pi/extensions/qa-status/card.ts";

const skip = process.platform !== "darwin" && "Local development tooling is supported only on the owner's macOS laptop";
const identity = { fg: (_color: string, text: string) => text };
const tagged = { fg: (color: string, text: string) => `<${color}>${text}</${color}>` };

const URL3 = "https://github.com/ARQAWA/my-pi/issues/3";
const URL2 = "https://github.com/ARQAWA/my-pi/issues/2";
const CONTENT = [
	`RED #3 [qa] RQW-tools background.test.ts: port-note fixture race (test bug) [qa-inbox, qa:claimed] ${URL3}`,
	`RED #2 [qa] RQW-agent Windows Bun 1.4.3 RPC mixed agents: CLI exited before event ${URL2}`,
	"Triage per PROCESS.md Quality control loop.",
].join("\n");

describe("qa-status card rows", { skip }, () => {
	it("collapsed: exactly one line with only red and green item counts and their colors", () => {
		const content = `${CONTENT}\nGREEN run 123 at 2026-10-25 https://x.test/123\nGREEN passed test\nGREEN latest main\nPENDING waiting\nINFO rate 20%`;
		assert.deepEqual(qaLines(content, false, identity, 200), ["qa-status · 2 red · 3 green"]);
		assert.deepEqual(qaLines(content, false, tagged, 200), [
			"<muted>qa-status</muted><dim> · </dim><error>2 red</error><dim> · </dim><success>3 green</success>",
		]);
		assert.deepEqual(qaLines(CONTENT, false, identity, 200), ["qa-status · 2 red · 0 green"]);
		assert.deepEqual(qaLines("GREEN ok", false, identity, 200), ["qa-status · 0 red · 1 green"]);
	});

	it("expanded: every line in full, links included, the triage note kept", () => {
		const rows = qaLines(CONTENT, true, identity, 200).map((row) => row.trim());
		assert.deepEqual(rows, [
			"qa-status · 2 red",
			"RED #3 [qa] RQW-tools background.test.ts: port-note fixture race (test bug) [qa-inbox, qa:claimed]", URL3,
			"RED #2 [qa] RQW-agent Windows Bun 1.4.3 RPC mixed agents: CLI exited before event", URL2,
			"Triage per PROCESS.md Quality control loop.",
		]);
	});

	it("unavailable and informational details remain expanded only; widths hold", () => {
		const down = "QA status unavailable: ENOENT; start npm run ci-watch";
		assert.deepEqual(qaLines(down, false, identity, 80), ["qa-status · 0 red · 0 green"]);
		assert.deepEqual(qaLines(down, true, identity, 80), ["qa-status", `  ${down}`]);
		assert.match(qaLines(down, true, tagged, 80)[1], /<warning>QA status unavailable/);
		assert.deepEqual(qaLines(`RED a\nINFO b https://x.test/1`, false, identity, 80), ["qa-status · 1 red · 0 green"]);
		assert.deepEqual(qaLines("", false, identity, 80), ["qa-status · 0 red · 0 green"]);
		assert.deepEqual(parseQa(`GREEN ok\n\nnote`), { items: [{ level: "green", text: "ok", url: "" }], notes: ["note"] });
		for (const width of [0, 1, 7, 8, 30]) for (const expanded of [false, true]) {
			for (const row of qaLines(CONTENT, expanded, identity, width)) assert.ok(stripVTControlCharacters(row).length <= width, `${width}: ${row}`);
		}
	});

	it("the card keeps one free cell at both sides", () => {
		const message = { customType: "qa-status", content: CONTENT, display: true, role: "custom", timestamp: 0 } as never;
		for (const expanded of [false, true]) {
			const rows = createQaCard(message, { expanded, outputPad: 1 }, identity as never)!.render(60);
			assert.ok(rows[0].startsWith(" qa-status") && !rows[0].startsWith("  "), JSON.stringify(rows[0]));
			for (const row of rows) assert.ok(stripVTControlCharacters(row).length <= 59, row);
		}
	});

	it("only the qa-status type gets the card, and the extension registers it", () => {
		const message = (customType: string) => ({ customType, content: CONTENT, display: true, role: "custom", timestamp: 0 }) as never;
		assert.equal(createQaCard(message("other"), { expanded: false, outputPad: 1 }, identity as never), undefined);
		const registered: string[] = [];
		const pi = { on() {}, registerCommand() {}, sendMessage() {}, registerMessageRenderer: (type: string) => registered.push(type) };
		qaExtension(pi as never);
		assert.deepEqual(registered, ["qa-status"]);
	});
});

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
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 80));

describe("qa-status card in Pi's real interactive mode", { skip }, () => {
	let root: string;
	const savedEnv = { ...process.env };
	before(() => {
		root = mkdtempSync(join(tmpdir(), "qa-status-card-"));
		process.env.PI_CODING_AGENT_DIR = join(root, "agent");
		process.env.PI_OFFLINE = "1";
		mkdirSync(process.env.PI_CODING_AGENT_DIR, { recursive: true });
		initTheme("dark", false);
	});
	after(() => { process.env = savedEnv; rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });

	async function session(withCard: boolean) {
		const cwd = join(root, withCard ? "on" : "off");
		mkdirSync(cwd, { recursive: true });
		const agentDir = process.env.PI_CODING_AGENT_DIR!;
		const faux = fauxProvider({ api: `faux-${cwd}`, provider: "faux-qa", models: [{ id: "m" }] });
		faux.setResponses([fauxAssistantMessage("ok")]);
		const modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: null, refreshOnCreate: false });
		faux.provider.auth.apiKey = { name: "Fake key", resolve: async () => ({ auth: { apiKey: "fake" } }) };
		modelRuntime.registerNativeProvider(faux.provider);
		await modelRuntime.setRuntimeApiKey("faux-qa", "fake");
		let api: ExtensionAPI | undefined;
		const helper = (pi: ExtensionAPI) => { api = pi; if (withCard) pi.registerMessageRenderer("qa-status", createQaCard); };
		const runtime = await createAgentSessionRuntime(async ({ cwd, sessionManager, sessionStartEvent }) => {
			const services = await createAgentSessionServices({
				cwd, agentDir, modelRuntime, settingsManager: SettingsManager.inMemory({ retry: { enabled: false }, quietStartup: true }),
				resourceLoaderOptions: { extensionFactories: [{ name: "qa-card", factory: helper }], noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true },
			});
			const created = await createAgentSessionFromServices({ services, sessionManager, sessionStartEvent, model: faux.getModel("m"), thinkingLevel: "off" });
			return { ...created, services, diagnostics: services.diagnostics };
		}, { cwd, agentDir, sessionManager: SessionManager.inMemory(cwd) });
		const terminal = new ScriptedTerminal();
		const mode = new InteractiveMode(runtime, { terminal: terminal as never });
		await mode.init();
		const screen = async () => {
			const from = terminal.written.length;
			terminal.width = terminal.width === 100 ? 101 : 100;
			terminal.onResize?.();
			await settle();
			return stripVTControlCharacters(terminal.written.slice(from)).replace(/ +/g, " ");
		};
		return { api: () => api!, runtime, terminal, screen, dispose: async () => { mode.stop(); await runtime.dispose(); } };
	}

	async function deliver(h: Awaited<ReturnType<typeof session>>) {
		h.api().sendMessage({ customType: "qa-status", content: CONTENT, display: true }, { triggerTurn: false });
		const end = Date.now() + 10_000;
		while (!h.runtime.session.messages.some((m) => m.role === "custom")) {
			if (Date.now() > end) throw new Error("the message never arrived");
			await new Promise((resolve) => setTimeout(resolve, 5));
		}
		await settle();
	}

	it("collapsed card, full text and links on Ctrl+O, folded again; stored content unchanged", async () => {
		const h = await session(true);
		try {
			await deliver(h);
			const collapsed = await h.screen();
			assert.match(collapsed, /qa-status · 2 red · 0 green/);
			assert.doesNotMatch(collapsed, /#2 \[qa\] RQW-agent Windows Bun/);
			assert.doesNotMatch(collapsed, /\[qa-status\]|https:\/\/github\.com|Triage per|#3|background\.test\.ts|qa:claimed/);

			h.terminal.onInput!("\x0f");
			await settle();
			const expanded = await h.screen();
			assert.match(expanded, /RED #3 \[qa\]/);
			assert.ok(expanded.includes(URL3) && expanded.includes(URL2), "links are reachable");
			assert.match(expanded, /Triage per PROCESS\.md Quality control loop\./);

			h.terminal.onInput!("\x0f");
			await settle();
			assert.doesNotMatch(await h.screen(), /https:\/\/github\.com/);
			assert.equal((h.runtime.session.messages.find((m) => m.role === "custom") as { content: string }).content, CONTENT);
		} finally { await h.dispose(); }
	});

	it("without the card Pi shows its default box", async () => {
		const h = await session(false);
		try {
			await deliver(h);
			const drawn = await h.screen();
			assert.match(drawn, /\[qa-status\]/);
			assert.match(drawn, /https:\/\/github\.com\/ARQAWA\/my-pi\/issues\/3/);
			assert.doesNotMatch(drawn, /qa-status · 2 red/);
		} finally { await h.dispose(); }
	});
});
