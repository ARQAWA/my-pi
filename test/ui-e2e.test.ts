// P11/U13: the actual installed package in Pi 1.4 InteractiveMode, not isolated renderer fixtures.
// Every request (including profile agents and naming) goes to a scripted faux provider. No owner settings/auth.
import { networkAttempts } from "./no-network.mjs";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createHook } from "node:async_hooks";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { after, before, describe, it } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
	type AssistantMessage, fauxAssistantMessage as answer, fauxProvider, fauxText, fauxThinking, fauxToolCall,
	type SimpleStreamOptions, type TranscriptContext,
} from "@earendil-works/pi-ai";
import {
	type AgentSessionRuntime, createAgentSessionFromServices, createAgentSessionRuntime, createAgentSessionServices,
	createCodemodeExtension, createToolSearchExtension, type ExtensionAPI, InteractiveMode, ModelRuntime,
	SessionManager, SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { ScriptedTerminal } from "./ui-e2e-terminal.ts";

const REPO = join(import.meta.dirname, "..");
const manifest = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")).pi;
const UI = ["RQW-statusbar", "RQW-thinking", "RQW-agent-ui", "RQW-tool-ui"];
const ext = (name: string) => `extensions/${name}/index.ts`;
const events = new EventEmitter();
const changed = () => events.emit("change");
const secret = "PRIVATE_REASONING_P11";
const scripts = new Map<string, Reply[]>();
const children = new Map<string, Reply>();
const requests: string[] = [];
const gates: Gate[] = [];
const savedEnv = { ...process.env };
let root: string, work: string, agentDir: string;
let runtime: AgentSessionRuntime;
let modelRuntime: ModelRuntime;
let mode: InteractiveMode | undefined;
let terminal: ScriptedTerminal;
let summaryReply: Reply = answer("## Goal\nUI composition proof.\n## Progress\nDone.");
const errors: string[] = [];
const waitCalls: string[] = [];

type Reply = AssistantMessage | ((ctx: TranscriptContext, options?: SimpleStreamOptions) => Promise<AssistantMessage> | AssistantMessage);
type Gate = { reply: Reply; entered: boolean; aborted: boolean; release(): void };
function gate(message: AssistantMessage): Gate {
	const done = Promise.withResolvers<AssistantMessage>();
	const held: Gate = {
		entered: false, aborted: false,
		reply: (_ctx, options) => {
			held.entered = true;
			options?.signal?.addEventListener("abort", () => {
				held.aborted = true; done.resolve(answer("", { stopReason: "aborted" })); changed();
			}, { once: true });
			changed(); return done.promise;
		},
		release: () => { done.resolve(message); changed(); },
	};
	gates.push(held);
	return held;
}
const contentText = (content: unknown): string => typeof content === "string" ? content
	: Array.isArray(content) ? content.map(c => c.type === "text" ? c.text : "").join("\n") : "";
const tools = (...calls: ReturnType<typeof fauxToolCall>[]) => answer(calls, { stopReason: "toolUse" });

async function route(context: TranscriptContext, options?: SimpleStreamOptions): Promise<AssistantMessage> {
	const messages = context.messages as { role: string; content: unknown; sections?: Record<string, string> }[];
	const system = messages.filter(m => m.role === "system").map(m => [contentText(m.content), ...Object.values(m.sections ?? {})].join("\n")).join("\n");
	const users = messages.filter(m => m.role === "user").map(m => contentText(m.content));
	const run = (reply: Reply) => typeof reply === "function" ? reply(context, options) : reply;
	if (system.includes("You name chat sessions")) {
		requests.push("naming");
		return answer(users[0].startsWith("Choose the candidate name") ? "0"
			: JSON.stringify(Array.from({ length: 10 }, (_, i) => `UI proof ${i + 1}`)));
	}
	if (system.includes("context summarization assistant")) { requests.push("summary"); return run(summaryReply); }
	for (const [marker, reply] of children) if (users[0]?.includes(marker)) {
		requests.push(`child ${marker}`); return run(reply);
	}
	for (let i = messages.length - 1; i >= 0; i--) {
		if (messages[i].role !== "user") continue;
		const text = contentText(messages[i].content);
		const key = [...scripts.keys()].find(key => text.startsWith(key));
		if (!key) continue;
		const step = messages.slice(i + 1).filter(m => m.role === "assistant").length;
		requests.push(`main ${key} ${step}`);
		return run(scripts.get(key)![step] ?? answer("Noted."));
	}
	requests.push("main notification");
	return answer("Notification acknowledged.");
}
function provider(name: string, id: string) {
	const faux = fauxProvider({ api: `faux-p11-${name}`, provider: name, models: [{ id, reasoning: true }] });
	faux.setResponses(Array.from({ length: 500 }, () => route));
	faux.provider.auth.apiKey = { name: "Isolated faux key", resolve: async () => ({ auth: { apiKey: "p11-fake" } }) };
	return faux;
}
const main = provider("openai-codex", "gpt-6.1-sol");
const naming = provider("kimi-coding", "kimi-for-coding");
const rows = () => terminal.screen.lines();
const has = (text: string | RegExp) => rows().some(line => typeof text === "string" ? line.includes(text) : text.test(line));
const summaries = () => rows().flatMap((line, i) => /^\s*(?:Edited \d+ file|Read \d+ file|Waited for \d+ agent|Used \d+ tool)/.test(line) ? [i] : []);
const top = () => {
	const lines = rows();
	const bottom = lines.findLastIndex(line => /(?:\d+% [\d.]+k|\?)\/[\d.]+k$/.test(line));
	return lines.findLastIndex((line, i) => i < bottom && line.startsWith("\u2500"));
};
const activity = () => {
	const lines = rows(), border = top();
	if (border < 2) return undefined;
	const candidate = lines[border - 2].trim();
	return /^(?:Planning next moves|Running |Reading |Editing |Writing |Searching files|Waiting for |Compacting context)/.test(candidate) ? candidate : "";
};
const id = () => runtime.session.sessionManager.getSessionId();
const dump = () => rows().map((line, i) => `${i}|${line}`).join("\n");
function until(label: string, check: () => boolean, timeout = 15_000): Promise<void> {
	if (check()) return Promise.resolve();
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			cleanup();
			const error = new Error(`${label}\n${requests.join(" | ")}\n${errors.join("\n")}\n${dump()}`);
			console.error(error.message);
			reject(error);
		}, timeout);
		const cleanup = () => { clearTimeout(timer); events.off("change", onChange); };
		const onChange = () => { if (check()) { cleanup(); resolve(); } };
		events.on("change", onChange);
		onChange();
	});
}
const idle = () => until("genuine idle", () => runtime.session.isIdle && activity() === "");
const send = (text: string) => { void runtime.session.prompt(text).catch(error => { errors.push(String(error)); changed(); }); };
const command = (text: string) => { terminal.type(text); terminal.key("\r"); };
const key = (text: string) => terminal.key(text);
const loaded = () => runtime.services.resourceLoader.getExtensions().extensions.map(e => relative(REPO, e.resolvedPath).replaceAll("\\", "/"));
function settings(off = false) {
	writeFileSync(join(agentDir, "settings.json"), JSON.stringify({
		quietStartup: true, checkForUpdates: false, lastChangelogVersion: "1.4.0", theme: "RQW-theme",
		defaultProvider: "openai-codex", defaultModel: "gpt-6.1-sol", retry: { enabled: false },
		compaction: { keepRecentTokens: 200 },
		// Explicit positive resource selection, including thinking, never the owner's personal filter.
		// Only the live Codex transport is replaced by the faux provider.
		packages: [{ source: REPO, extensions: manifest.extensions.filter((path: string) => path !== `./${ext("RQW-codex")}`
			&& !(off && UI.some(name => path === `./${ext(name)}`))).map((path: string) => path.slice(2)) }],
	}));
}
const probe = (pi: ExtensionAPI) => {
	// These native test transports are flushed after the package's provider catalog registrations.
	for (const faux of [main, naming]) pi.registerProvider(faux.provider);
	pi.on("tool_execution_start", event => { if (event.args?.action === "wait") waitCalls.push(event.toolCallId); changed(); });
};
const handles = () => {
	const names = process.getActiveResourcesInfo();
	return { child: names.filter(n => n === "ChildProcess").length,
		socket: names.filter(n => ["TCPSocketWrap", "TCPServerWrap", "TLSWrap"].includes(n)).length,
		timer: names.filter(n => n === "Timeout").length };
};
const baseline = handles();
before(async () => {
	root = mkdtempSync(join(tmpdir(), "rqw-p11-")); work = join(root, "work"); agentDir = join(root, "agent");
	mkdirSync(work); mkdirSync(agentDir);
	writeFileSync(join(work, "a.txt"), "alpha\nbeta\n"); writeFileSync(join(work, "b.txt"), "one\ntwo\n");
	writeFileSync(join(work, "wait.mjs"), 'import { existsSync, watch } from "node:fs";\nconsole.log("l1\\nl2\\nl3\\nl4\\nl5\\nl6");\nconst watcher = watch(".", () => { if (existsSync("go.flag")) watcher.close(); });\nif (existsSync("go.flag")) watcher.close();\n');
	settings();
	for (const name of Object.keys(process.env)) if (/(?:_API_KEY|_TOKEN|_SECRET|AUTH_TOKEN)$/.test(name)) delete process.env[name];
	Object.assign(process.env, { PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: "1", PI_SKIP_VERSION_CHECK: "1", COLORTERM: "truecolor" });
	terminal = new ScriptedTerminal(changed);
	modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: null, refreshOnCreate: false });
	for (const faux of [main, naming]) {
		modelRuntime.registerNativeProvider(faux.provider);
		await modelRuntime.setRuntimeApiKey(faux.provider.id, "p11-fake");
	}
	runtime = await createRuntime();
	mode = new InteractiveMode(runtime, { terminal: terminal as never });
	await mode.init();
});
async function createRuntime() {
	return createAgentSessionRuntime(async ({ cwd, sessionManager, sessionStartEvent }) => {
		const services = await createAgentSessionServices({ cwd, agentDir, modelRuntime,
			settingsManager: SettingsManager.create(cwd, agentDir), resourceLoaderOptions: {
				extensionFactories: [
					{ name: "codemode", factory: createCodemodeExtension(), replaceable: true, builtin: true },
					{ name: "tool-search", factory: createToolSearchExtension(), replaceable: true, builtin: true },
					{ name: "p11-observer", factory: probe },
				], noSkills: true, noPromptTemplates: true, noContextFiles: true,
			} });
		const created = await createAgentSessionFromServices({ services, sessionManager, sessionStartEvent,
			model: main.getModel(), thinkingLevel: "low" });
		created.session.subscribe(changed);
		return { ...created, services, diagnostics: services.diagnostics };
	}, { cwd: work, agentDir, sessionManager: SessionManager.inMemory(work) });
}
after(async () => {
	for (const held of gates) held.release();
	if (work) writeFileSync(join(work, "go.flag"), "");
	mode?.stop(); await runtime?.dispose();
	if (terminal) writeFileSync(join(tmpdir(), "p11-resumed-interactive.ansi"), terminal.raw);
	process.env = savedEnv;
	if (root) rmSync(root, { recursive: true, force: true });
});

function ruleColours() {
	const r = top();
	return terminal.screen.grid[r].flatMap((ch, i) => ch === "\u2500" ? [terminal.screen.fg[r][i]] : []);
}
function letterColours() {
	const r = top() - 2;
	return terminal.screen.fg[r].slice(1, rows()[r].length).filter((_, i) => rows()[r][i + 1] !== " ");
}
const gold = (colour: string) => { const [r, g, b] = colour.split(";").map(Number); return r > g && g > b && r - b > 60; };
const childCall = (marker: string, title: string, profile?: string) => fauxToolCall("agent", {
	action: "start", task: marker, title, model: "openai-codex/gpt-6.1-sol", thinking: "low", tools: [],
	...(profile ? { agent_type: profile } : { system: "You are a scripted test child." }),
}, { id: marker });
const card = (n: number, title: string) => new RegExp(`agent#${n} ${title} finished · gpt-6\\.1-sol low · [\\d.]+s`);

describe("P11 actual package UI composition", { concurrency: false }, () => {
	it("loads the real manifest in its actual order, explicitly including thinking; theme and genuine idle", async () => {
		await until("statusbar installed", () => top() >= 0 && rows()[top()].endsWith(`${id()} ──`));
		const packagePaths = loaded().filter(path => path.startsWith("extensions/"));
		assert.deepEqual(packagePaths, manifest.extensions.filter((path: string) => path !== `./${ext("RQW-codex")}`).map((path: string) => path.slice(2)));
		assert.ok(packagePaths.indexOf(ext("RQW-agent-ui")) < packagePaths.indexOf(ext("RQW-tool-ui")));
		assert.deepEqual(runtime.services.resourceLoader.getExtensions().errors, []);
		assert.equal(runtime.services.resourceLoader.getThemes().themes.filter(theme => theme.name === "RQW-theme").length, 1);
		assert.equal(activity(), "");
		assert.deepEqual([...new Set(ruleColours())], ["182;182;180"]);
		assert.equal(runtime.session.getToolDefinition("review"), undefined);
		assert.equal(runtime.session.getToolDefinition("code_writer"), undefined);
	});

	it("planning and running tool activity, last-four live block, folded summary before answer, thinking preserved only in storage", async () => {
		const plan = gate(answer([fauxThinking(`${secret} FIRST`), fauxToolCall("read", { path: "a.txt" }, { id: "r1" }),
			fauxToolCall("read", { path: "b.txt" }, { id: "r2" })], { stopReason: "toolUse" }));
		scripts.set("tools-scene", [plan.reply,
			tools(fauxToolCall("edit", { path: "a.txt", edits: [{ oldText: "alpha", newText: "ALPHA" }] }, { id: "e1" })),
			tools(fauxToolCall("bash", { command: "node wait.mjs" }, { id: "b1" })),
			answer([fauxThinking(`${secret} SECOND`), fauxText("Tools finished.")]),
		]);
		send("tools-scene");
		await until("planning", () => plan.entered && activity() === "Planning next moves");
		assert.equal(rows()[top() - 2], " Planning next moves");
		assert.equal(rows()[top() - 1], ""); assert.equal(rows()[top() - 3], "");
		assert.ok(letterColours().every(colour => colour.split(";").length === 3 && !gold(colour)));
		assert.deepEqual([...new Set(ruleColours())], ["182;182;180"]);
		const colours = letterColours().join("|");
		await until("silver activity letters animate while held", () => letterColours().join("|") !== colours);
		plan.release();
		await until("live output", () => activity() === "Running node wait.mjs" && has(/^\s+l6$/));
		const r = rows(), live = r.findIndex(line => line.includes("$ node wait.mjs"));
		const status = r.findIndex((line, i) => i > live && line.trim() === "running");
		assert.deepEqual(r.slice(live + 1, status).map(line => line.trim()), ["l3", "l4", "l5", "l6"]);
		assert.equal(summaries().length, 1); assert.ok(summaries()[0] < live);
		writeFileSync(join(work, "go.flag"), "");
		await until("answer", () => has("Tools finished.")); await idle();
		assert.equal(summaries().length, 1);
		assert.match(rows()[summaries()[0]], /Edited 1 file \+1 -1 · read 2 files · ran 1 command/);
		assert.ok(summaries()[0] < rows().findIndex(line => line.includes("Tools finished.")));
		assert.equal(has("$ node wait.mjs"), false); assert.equal(has(secret), false);
		assert.ok(JSON.stringify(runtime.session.messages).includes(`${secret} FIRST`));
		assert.ok(JSON.stringify(runtime.session.messages).includes(`${secret} SECOND`));
		assert.ok(terminal.raw.includes("\x1b[48;2;35;33;32m"));
	});

	it("Ctrl+O restores original tools in order without exposing reasoning; Ctrl+T hides the label in both branches", async () => {
		key("\x0f");
		await until("original calls", () => summaries().length === 0 && has("$ node wait.mjs"));
		const positions = ["read a.txt", "$ node wait.mjs", "Tools finished."].map(text => rows().findIndex(line => line.includes(text)));
		assert.ok(positions.every((value, i) => value >= 0 && (i === 0 || value > positions[i - 1])));
		assert.ok(has(/^\s+l1$/)); assert.equal(has(secret), false);
		key("\x0f"); await until("folded tools", () => summaries().length === 1 && !has("$ node wait.mjs"));
		for (const state of ["hidden", "visible"]) {
			key("\x14"); await until(`thinking ${state}`, () => has(`Thinking blocks: ${state}`));
			assert.equal(has(secret), false); assert.equal(has(/^\s*Thinking\.\.\.$/), false);
			assert.equal(summaries().length, 1);
		}
	});

	it("the composed UI fits narrow terminals while running and after returning to idle", async () => {
		const held = gate(answer("Narrow done."));
		scripts.set("narrow-scene", [held.reply]); send("narrow-scene");
		await until("narrow scene planning", () => held.entered && activity() === "Planning next moves");
		for (const width of [40, 24]) {
			const before = terminal.writes;
			terminal.resize(width);
			await until(`render at ${width}`, () => terminal.writes > before && top() >= 0 && activity() === "Planning next moves");
			assert.equal(terminal.screen.overflow, 0, `no clipped overflow at ${width}`);
			assert.ok(rows().every(line => visibleWidth(line) <= width));
			assert.equal(has(id()), false, "omit the whole UUID when it cannot fit");
		}
		held.release(); await until("narrow answer", () => has("Narrow done.")); await idle();
		terminal.resize(100);
		await until("full width restored", () => top() >= 0 && rows()[top()].endsWith(`${id()} ──`));
	});

	it("ordinary and profile subagents share result cards and counts after main answers; Ctrl+O preserves every original line", async () => {
		const first = gate(answer("AGENT_FIRST\nAGENT_TAIL")), reviewer = gate(answer("CLEAN\nCHECKED:\nPROFILE_TAIL"));
		children.set("CHILD_ORDINARY", first.reply); children.set("CHILD_PROFILE", reviewer.reply);
		scripts.set("cards-scene", [tools(childCall("CHILD_ORDINARY", "Research child"), childCall("CHILD_PROFILE", "Profile child", "spotty")), answer("Main answered.")]);
		send("cards-scene");
		await until("both children after answer", () => first.entered && reviewer.entered && runtime.session.isIdle && activity() === "Waiting for 2 agents");
		first.release();
		await until("ordinary card", () => has(card(1, "Research child")) && has("AGENT_FIRST"));
		await until("only profile running", () => runtime.session.isIdle && activity() === "Waiting for 1 agent");
		reviewer.release();
		await until("profile card", () => has(card(2, "Profile child")) && has(/^\s*CLEAN$/)); await idle();
		assert.equal(has("AGENT_TAIL"), false); assert.equal(has("PROFILE_TAIL"), false);
		const stored = runtime.session.messages.filter(m => m.role === "custom" && m.customType === "agent");
		assert.equal(stored.length, 2);
		assert.equal(stored[0].content, "[agent#1] AGENT_FIRST\nAGENT_TAIL");
		assert.equal((stored[1].details as { profile: { name: string } }).profile.name, "spotty");
		const original = JSON.stringify(stored);
		key("\x0f"); await until("full card originals", () => has("AGENT_TAIL") && has("PROFILE_TAIL"));
		assert.equal(rows().filter(line => line.trim() === "AGENT_TAIL").length, 1);
		key("\x0f"); await until("folded cards", () => !has("AGENT_TAIL") && !has("PROFILE_TAIL"));
		assert.equal(JSON.stringify(stored), original);
	});

	it("model-called wait ends with receipt, then one child_wait card wakes main; Ctrl+O expands and folds it", async () => {
		const child = gate(answer("WAIT_FIRST\nWAIT_MIDDLE\nWAIT_TAIL"));
		children.set("CHILD_WAIT", child.reply);
		scripts.set("wait-scene", [tools(childCall("CHILD_WAIT", "Wait child")),
			tools(fauxToolCall("agent", { action: "wait", ids: ["agent#3"], wake_on_alert: false }, { id: "wait3" })),
		]);
		const n = requests.length;
		send("wait-scene");
		await until("wait receipt and stopped main", () => waitCalls.includes("wait3") && child.entered && runtime.session.isIdle && activity() === "Waiting for 1 agent");
		const receipt = runtime.session.messages.find(m => m.role === "toolResult" && m.toolCallId === "wait3")!;
		assert.equal((receipt.details as { reason: string }).reason, "waiting");
		assert.deepEqual((receipt.details as { results: unknown[] }).results, []);
		assert.deepEqual(requests.slice(n).filter(text => text.startsWith("main")), ["main wait-scene 0", "main wait-scene 1"]);
		assert.ok(has("Waited for 1 agent"));
		child.release();
		await until("notification card", () => rows().some(line => line.trim() === "child_wait · agent#3 finished") && has("WAIT_FIRST")); await idle();
		assert.equal(has("WAIT_MIDDLE"), false); assert.equal(has("WAIT_TAIL"), false);
		const notices = runtime.session.messages.filter(m => m.role === "custom" && m.customType === "child_wait");
		assert.equal(notices.length, 1);
		assert.deepEqual(JSON.parse(String(notices[0].content)), notices[0].details);
		const original = JSON.stringify(notices[0]);
		key("\x0f"); await until("full wait notification", () => has("WAIT_MIDDLE") && has("WAIT_TAIL"));
		for (const text of ["WAIT_FIRST", "WAIT_MIDDLE", "WAIT_TAIL"]) assert.equal(rows().filter(line => line.trim() === text).length, 1);
		const header = rows().findIndex(line => line.trim() === "child_wait · agent#3 finished");
		assert.deepEqual(rows().slice(header + 1, header + 4).map(line => line.trim()), ["WAIT_FIRST", "WAIT_MIDDLE", "WAIT_TAIL"]);
		// The earlier waiting receipt remains a stock diagnostic on Ctrl+O; only the delivered notification is a card.
		assert.ok(has('"reason":"waiting"'));
		key("\x0f"); await until("folded wait notification", () => !has("WAIT_TAIL") && has("WAIT_FIRST"));
		assert.equal(JSON.stringify(notices[0]), original);
		assert.equal(runtime.session.messages.filter(m => m.role === "custom" && String(m.content).startsWith("[agent#3]")).length, 0);
	});

	it("compaction cancellation clears gold activity and borders", async () => {
		const summary = gate(answer("## Goal\nUnused")); summaryReply = summary.reply;
		command("/compact");
		await until("compaction held", () => summary.entered && activity() === "Compacting context");
		assert.ok(letterColours().every(gold)); assert.ok(ruleColours().every(gold));
		key("\x1b"); await until("compaction cancelled", () => has("Compaction cancelled")); await idle();
		assert.equal(summary.aborted, true);
		assert.deepEqual([...new Set(ruleColours())], ["182;182;180"]);
	});

	it("compaction errors clear gold without pretending to complete", async () => {
		summaryReply = answer("", { stopReason: "error", errorMessage: "Scripted summary failure" });
		command("/compact"); await until("compaction failed", () => has("Compaction failed")); await idle();
		assert.deepEqual([...new Set(ruleColours())], ["182;182;180"]);
	});

	it("compaction success clears gold and retains the named package theme", async () => {
		const summary = gate(answer("## Goal\nUI composition.\n## Progress\nComplete.")); summaryReply = summary.reply;
		command("/compact"); await until("compaction started", () => summary.entered && activity() === "Compacting context");
		assert.ok(letterColours().every(gold)); summary.release();
		await until("compaction completed", () => has("Compacted from")); await idle();
		assert.deepEqual([...new Set(ruleColours())], ["182;182;180"]);
	});

	it("reload preserves composition once, with one live child counted once and one card", async () => {
		command("/reload");
		await until("package reloaded", () => has("Reloaded") && loaded().includes(ext("RQW-thinking")) && top() >= 0);
		const child = gate(answer("RELOAD_FIRST\nRELOAD_TAIL")); children.set("CHILD_RELOAD", child.reply);
		scripts.set("reload-scene", [tools(childCall("CHILD_RELOAD", "Reload child")), answer("Reload main answered.")]);
		send("reload-scene");
		await until("one reloaded child", () => child.entered && runtime.session.isIdle && activity() === "Waiting for 1 agent");
		child.release(); await until("one reloaded card", () => has("RELOAD_FIRST")); await idle();
		assert.equal(rows().filter(line => line.trim() === "RELOAD_FIRST").length, 1);
		assert.equal(has("RELOAD_TAIL"), false);
		assert.deepEqual(runtime.services.resourceLoader.getExtensions().errors, []);
	});

	it("new session cancels the old child and removes old cards, activity and title", async () => {
		const child = gate(answer("MUST_NOT_REACH_NEW_SESSION")); children.set("CHILD_SWITCH", child.reply);
		scripts.set("switch-scene", [tools(childCall("CHILD_SWITCH", "Old session child")), answer("Old session answer.")]);
		send("switch-scene");
		await until("old child running", () => child.entered && runtime.session.isIdle && activity() === "Waiting for 1 agent");
		const oldId = id(); command("/new");
		await until("new session installed", () => id() !== oldId && top() >= 0 && child.aborted); await idle();
		assert.equal(has("Old session answer."), false); assert.equal(has("UI proof 1"), false);
		assert.equal(summaries().length, 0);
		scripts.set("new-scene", [tools(fauxToolCall("read", { path: "b.txt" }, { id: "new-read" })), answer("New session works.")]);
		send("new-scene"); await until("new answer", () => has("New session works.")); await idle();
		assert.equal(summaries().length, 1); assert.match(rows()[summaries()[0]], /Read 1 file/);
		assert.deepEqual(runtime.session.messages.filter(m => m.role === "custom"), []);
	});

	it("explicit package filter plus reload restores old and new stock tools, reasoning text and native hidden label", async () => {
		settings(true); command("/reload");
		await until("stock after reload", () => has("Reloaded") && top() < 0);
		for (const name of UI) assert.equal(loaded().includes(ext(name)), false);
		assert.equal(summaries().length, 0); assert.ok(has("read b.txt"));
		const plan = gate(answer([fauxThinking(`${secret} STOCK`), fauxToolCall("read", { path: "a.txt" }, { id: "stock-read" })], { stopReason: "toolUse" }));
		scripts.set("stock-scene", [plan.reply, answer("Stock answer.")]); send("stock-scene");
		await until("stock indicator", () => plan.entered && has(/Working/));
		assert.equal(has("Planning next moves"), false); plan.release();
		await until("stock answer", () => has("Stock answer.") && runtime.session.isIdle);
		assert.ok(has(`${secret} STOCK`)); assert.ok(has("read a.txt")); assert.equal(summaries().length, 0);
		key("\x14"); await until("native hidden label", () => has(/^\s*Thinking\.\.\.$/));
		assert.equal(has(`${secret} STOCK`), false);
	});

	it("real external print wait result reopens in InteractiveMode: folded summary and Ctrl+O full cards", async () => {
		mode!.stop(); mode = undefined; await runtime.dispose();
		settings(); runtime = await createRuntime();
		await runtime.session.bindExtensions({ mode: "print", onError: event => errors.push(`${event.event}: ${event.error}`) });
		const child = gate(answer("HELD_FIRST\nHELD_MIDDLE\nHELD_TAIL")); children.set("CHILD_HELD", child.reply);
		scripts.set("held-scene", [tools(childCall("CHILD_HELD", "Held child")),
			tools(fauxToolCall("agent", { action: "wait", ids: ["agent#1"], wake_on_alert: false }, { id: "held-wait" })), answer("Held result saved.")]);
		const run = runtime.session.prompt("held-scene");
		await until("external print wait held", () => child.entered && waitCalls.includes("held-wait"));
		child.release(); await run;
		const result = runtime.session.messages.find(m => m.role === "toolResult" && m.toolCallId === "held-wait")!;
		assert.equal((result.details as { reason: string }).reason, "result");
		const original = JSON.stringify(result);
		terminal = new ScriptedTerminal(changed);
		mode = new InteractiveMode(runtime, { terminal: terminal as never }); await mode.init();
		await until("replayed held summary", () => has("Waited for 1 agent") && has("Held result saved."));
		assert.equal(has("HELD_FIRST"), false);
		key("\x0f"); await until("expanded held result card", () => has(card(1, "Held child")) && has("HELD_TAIL"));
		for (const text of ["HELD_FIRST", "HELD_MIDDLE", "HELD_TAIL"]) assert.equal(rows().filter(line => line.trim() === text).length, 1);
		assert.equal(has('"results"'), false); assert.equal(has('"reason"'), false);
		key("\x0f"); await until("replayed held result folded", () => has("Waited for 1 agent") && !has("HELD_TAIL"));
		assert.equal(JSON.stringify(result), original);
	});

	it("clean shutdown leaves no network attempt, child process, socket or extension timer", async () => {
		mode!.stop(); mode = undefined; await runtime.dispose();
		// Native editor debounce/close callbacks may still be queued. Wait for resource destruction,
		// not a fixed grace sleep; the only extra timer allowed here is this wait's own deadline.
		await new Promise<void>((resolve, reject) => {
			const timer = setTimeout(() => { hook.disable(); reject(new Error(`resources did not close: ${JSON.stringify(handles())}`)); }, 5_000);
			const check = () => {
				const end = handles();
				if (end.child <= baseline.child && end.socket <= baseline.socket && end.timer <= baseline.timer + 1) {
					hook.disable(); clearTimeout(timer); resolve();
				}
			};
			const hook = createHook({ destroy: check }).enable();
			check();
		});
		assert.deepEqual(networkAttempts, []); assert.deepEqual(errors, []);
		const end = handles();
		for (const name of ["child", "socket", "timer"] as const) assert.ok(end[name] <= baseline[name], `${name}: ${JSON.stringify({ baseline, end })}`);
	});
});
