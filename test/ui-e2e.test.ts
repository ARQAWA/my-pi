// End-to-end proof of the compact UI (UI port P11, T19) in Pi's real InteractiveMode on a scripted terminal that is a
// small screen emulator with colours: the screen rows are what a user sees. The whole package is loaded the way a user
// installs it, through its real manifest (package.json `pi.extensions` and `pi.themes`) from an isolated settings file,
// and the theme is chosen there by name. One scripted faux provider answers every model request (main agent,
// subagents, workers, the reviewer, the session naming and the compaction summary); it routes each request by what the
// request is, so the order of concurrent requests does not matter. No network, no real model, never ~/.pi.
import { networkAttempts } from "./no-network.mjs";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
	type AssistantMessage, fauxAssistantMessage, fauxProvider, fauxText, fauxThinking, fauxToolCall,
	type SimpleStreamOptions, type TranscriptContext,
} from "@earendil-works/pi-ai";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
	type AgentSessionRuntime,
	createAgentSessionFromServices,
	createAgentSessionRuntime,
	createAgentSessionServices,
	createCodemodeExtension,
	createToolSearchExtension,
	type ExtensionAPI,
	type ExtensionContext,
	InteractiveMode,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const MANIFEST = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")).pi as { extensions: string[]; themes?: string[] };
const ext = (name: string) => `./extensions/${name}/index.ts`;
/** The UI extensions the owner switches off with the package filter to get Pi's stock interface back. */
const UI_OFF = ["RQW-agent-ui", "RQW-tool-ui", "RQW-statusbar", "RQW-thinking"].map((name) => `-${ext(name).slice(2)}`);
/** RQW-codex owns the openai-codex provider with its real network transport; the faux provider takes that place, so it
 * is the one extension of the package this test switches off. */
const CODEX_OFF = `-${ext("RQW-codex").slice(2)}`;
const THEME = "RQW-theme";
const ENTER = "\r";
const ESC = "\x1b";
const CTRL_O = "\x0f";
const CTRL_T = "\x14";
const RULE = "\u2500";
const SUMMARY_MARK = "\u21b3";
const SILVER_RULE = "182;182;180";
const SECRET = "SECRET-REASONING";
const FLAG = "go.flag";
// The bash call blocks until the test creates the flag file, so the running state is held by an event, not a sleep.
// The folder check ends the loop when the test folder is gone, so no shell outlives a failed run.
const WAIT_SCRIPT = `while [ -d "$PWD" ] && [ ! -f ${FLAG} ]; do sleep 0.05; done\nprintf 'l1\\nl2\\nl3\\nl4\\nl5\\n'\n`;
const BASH = "bash wait-flag.sh";
const ROWS = 60;
const COLS = 100;

// ---- The faux provider: one queue of identical routers; each request is answered by what it is.

type Reply = AssistantMessage | ((context: TranscriptContext, options?: SimpleStreamOptions) => AssistantMessage | Promise<AssistantMessage>);
type Gate = { reply: Reply; release(text?: string): void; entered(): boolean; aborted(): boolean };

/** A reply that waits until the test releases it (or the request is aborted). */
function gate(make: () => AssistantMessage): Gate {
	const done = Promise.withResolvers<AssistantMessage>();
	let entered = false;
	let aborted = false;
	return {
		reply: (_context, options) => {
			entered = true;
			options?.signal?.addEventListener("abort", () => { aborted = true; done.resolve(fauxAssistantMessage("aborted", { stopReason: "aborted" })); }, { once: true });
			return done.promise;
		},
		release: () => done.resolve(make()),
		entered: () => entered,
		aborted: () => aborted,
	};
}

const textOf = (content: unknown): string =>
	typeof content === "string" ? content
		: Array.isArray(content) ? content.map((c: { type?: string; text?: string }) => (c?.type === "text" ? c.text ?? "" : "")).join("\n") : "";

/** Main-agent scripts: the last user message that starts with a key anchors the script; the step is the number of
 * assistant messages after it. Past the end (a delivered result, a follow-up) the main agent says "Noted." */
const mainScripts = new Map<string, Reply[]>();
/** Child and worker replies, keyed by a marker in the task brief (the first user message of their session). */
const childReplies = new Map<string, Reply>();
let reviewerReply: Reply = fauxAssistantMessage("CLEAN");
let summaryReply: Reply = fauxAssistantMessage("## Goal\nUI check.\n## Progress\nDone.");
const requests: string[] = [];

async function route(context: TranscriptContext, options?: SimpleStreamOptions): Promise<AssistantMessage> {
	const messages = context.messages as { role: string; content: unknown; sections?: Record<string, string | null> }[];
	// A system message carries its text in `content` and in named `sections`.
	const system = messages.filter((m) => m.role === "system")
		.map((m) => [textOf(m.content), ...Object.values(m.sections ?? {})].join("\n")).join("\n");
	const users = messages.filter((m) => m.role === "user").map((m) => textOf(m.content));
	const run = async (reply: Reply) => (typeof reply === "function" ? await reply(context, options) : reply);
	if (system.includes("You name chat sessions")) {
		// RQW-naming asks twice per attempt: ten candidates, then the index of the best one.
		const choose = (users[0] ?? "").startsWith("Choose the candidate name");
		requests.push(choose ? "naming-pick" : "naming");
		return fauxAssistantMessage(choose ? "0" : JSON.stringify(Array.from({ length: 10 }, (_, i) => `UI check ${i + 1}`)));
	}
	if (system.includes("context summarization assistant")) {
		requests.push("summary");
		return run(summaryReply);
	}
	if (system.includes("You are a read-only blind reviewer")) {
		requests.push("reviewer");
		return run(reviewerReply);
	}
	const first = users[0] ?? "";
	for (const [marker, reply] of childReplies) {
		if (first.includes(marker)) {
			requests.push(`child ${marker}`);
			return run(reply);
		}
	}
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i];
		if (m.role !== "user") continue;
		const text = textOf(m.content);
		const key = [...mainScripts.keys()].find((k) => text.startsWith(k));
		if (!key) continue;
		const step = messages.slice(i + 1).filter((n) => n.role === "assistant").length;
		requests.push(`main ${key} ${step}`);
		const steps = mainScripts.get(key)!;
		return step < steps.length ? run(steps[step]) : fauxAssistantMessage("Noted.");
	}
	requests.push(`main ? ${users.at(-1)?.slice(0, 40)}`);
	return fauxAssistantMessage("Noted.");
}

// A listed RQW-models ID for the main agent (the review tool's blind level is gpt-6.1-sol too); gpt-6-luna is the
// worker and naming fallback without Anthropic credentials.
const faux = fauxProvider({
	api: "faux-ui-e2e", provider: "openai-codex",
	models: [{ id: "gpt-6.1-sol", reasoning: true }, { id: "gpt-6-luna", reasoning: true }],
});
faux.setResponses(Array.from({ length: 1000 }, () => route));
faux.provider.auth.apiKey = { name: "Fake key", resolve: async () => ({ auth: { apiKey: "fake-ui-e2e" } }) };

const toolUse = (...calls: ReturnType<typeof fauxToolCall>[]) => fauxAssistantMessage(calls, { stopReason: "toolUse" });

// ---- The terminal: a screen emulator that keeps the foreground colour of every cell.

class Screen {
	rows: number;
	cols: number;
	grid: string[][];
	fg: string[][];
	row = 0;
	col = 0;
	pending = "";
	pen = "";

	constructor(rows: number, cols: number) {
		this.rows = rows;
		this.cols = cols;
		this.grid = blank(rows, cols, " ");
		this.fg = blank(rows, cols, "");
	}

	lines(): string[] {
		return this.grid.map((line) => line.join("").replace(/\s+$/u, ""));
	}

	feed(text: string) {
		const s = this.pending + text;
		this.pending = "";
		let i = 0;
		while (i < s.length) {
			const ch = s[i];
			if (ch === "\x1b") {
				if (i + 1 >= s.length) { this.pending = s.slice(i); return; }
				const kind = s[i + 1];
				if (kind === "[") {
					let j = i + 2;
					while (j < s.length && !(s[j] >= "@" && s[j] <= "~")) j++;
					if (j >= s.length) { this.pending = s.slice(i); return; }
					this.csi(s.slice(i + 2, j), s[j]);
					i = j + 1;
				} else if ("]_P^".includes(kind)) {
					const bel = s.indexOf("\x07", i + 2);
					const st = s.indexOf("\x1b\\", i + 2);
					const ends = [bel, st].filter((k) => k >= 0);
					if (ends.length === 0) { this.pending = s.slice(i); return; }
					const end = Math.min(...ends);
					i = end + (end === bel ? 1 : 2);
				} else {
					i += 2;
				}
				continue;
			}
			if (ch === "\r") this.col = 0;
			else if (ch === "\n") this.newline();
			else if (ch === "\b") this.col = Math.max(0, this.col - 1);
			else if (ch >= " " && visibleWidth(ch) > 0) {
				const wide = visibleWidth(ch) === 2;
				if (this.col < this.cols) {
					this.grid[this.row][this.col] = ch;
					this.fg[this.row][this.col] = this.pen;
					if (wide && this.col + 1 < this.cols) this.grid[this.row][this.col + 1] = "";
				}
				this.col = Math.min(this.cols, this.col + (wide ? 2 : 1));
			}
			i++;
		}
	}

	private newline() {
		if (this.row === this.rows - 1) {
			this.grid = this.grid.slice(1).concat([Array(this.cols).fill(" ")]);
			this.fg = this.fg.slice(1).concat([Array(this.cols).fill("")]);
		} else {
			this.row++;
		}
	}

	/** SGR: only the 24-bit foreground is kept (`r;g;b`), anything else that resets it clears it. */
	private sgr(params: string) {
		const p = params === "" ? [0] : params.split(";").map(Number);
		for (let k = 0; k < p.length; k++) {
			if (p[k] === 0 || p[k] === 39) this.pen = "";
			else if (p[k] === 38 && p[k + 1] === 2) { this.pen = p.slice(k + 2, k + 5).join(";"); k += 4; }
			else if (p[k] === 38 && p[k + 1] === 5) { this.pen = `5;${p[k + 2]}`; k += 2; }
			else if (p[k] === 48 && p[k + 1] === 2) k += 4;
			else if (p[k] === 48 && p[k + 1] === 5) k += 2;
			else if ((p[k] >= 30 && p[k] <= 37) || (p[k] >= 90 && p[k] <= 97)) this.pen = `c${p[k]}`;
		}
	}

	private csi(params: string, final: string) {
		if (final === "m") return this.sgr(params);
		if (/^[?<>]/u.test(params)) return;
		const nums = params ? params.split(";").map((p) => (/^\d+$/u.test(p) ? Number(p) : 0)) : [];
		const n = nums[0] > 0 ? nums[0] : 1;
		if (final === "A") this.row = Math.max(0, this.row - n);
		else if (final === "B") this.row = Math.min(this.rows - 1, this.row + n);
		else if (final === "C") this.col = Math.min(this.cols - 1, this.col + n);
		else if (final === "D") this.col = Math.max(0, this.col - n);
		else if (final === "G") this.col = Math.min(this.cols - 1, n - 1);
		else if (final === "H" || final === "f") {
			this.row = Math.min(this.rows - 1, (nums[0] || 1) - 1);
			this.col = Math.min(this.cols - 1, (nums[1] || 1) - 1);
		} else if (final === "K") {
			const mode = nums[0] ?? 0;
			const from = mode === 0 ? this.col : 0;
			const to = mode === 1 ? this.col + 1 : this.cols;
			for (let k = from; k < to; k++) { this.grid[this.row][k] = " "; this.fg[this.row][k] = ""; }
		} else if (final === "J") {
			const mode = nums[0] ?? 0;
			if (mode === 0) {
				for (let k = this.col; k < this.cols; k++) { this.grid[this.row][k] = " "; this.fg[this.row][k] = ""; }
				for (let r = this.row + 1; r < this.rows; r++) { this.grid[r] = Array(this.cols).fill(" "); this.fg[r] = Array(this.cols).fill(""); }
			} else if (mode === 2 || mode === 3) {
				this.grid = blank(this.rows, this.cols, " ");
				this.fg = blank(this.rows, this.cols, "");
			}
		}
	}
}

function blank(rows: number, cols: number, fill: string): string[][] {
	return Array.from({ length: rows }, () => Array(cols).fill(fill) as string[]);
}

class ScriptedTerminal {
	onInput: ((data: string) => void) | undefined;
	onResize: (() => void) | undefined;
	screen = new Screen(ROWS, COLS);
	raw = "";
	start(onInput: (data: string) => void, onResize: () => void) { this.onInput = onInput; this.onResize = onResize; }
	stop() {}
	async drainInput() {}
	write(data: string) { this.raw += data; this.screen.feed(data); }
	get columns() { return COLS; }
	get rows() { return ROWS; }
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
	type(text: string) { for (const ch of text) this.onInput!(ch); }
	key(data: string) { this.onInput!(data); }
}

// ---- The session under test.

let root: string;
let work: string;
let agentDir: string;
let term: ScriptedTerminal | undefined;
let mode: InteractiveMode | undefined;
let runtime: AgentSessionRuntime | undefined;
let probeCtx: ExtensionContext | undefined;
const savedEnv = { ...process.env };
const handlesBefore = handleCounts();
/** Calls of agent/code_writer/shell_runner `wait`, seen at tool_execution_start by the probe; the test releases children. */
const waitStarts: string[] = [];

function handleCounts() {
	const names = process.getActiveResourcesInfo();
	return {
		children: names.filter((n) => n === "ChildProcess").length,
		sockets: names.filter((n) => n === "TCPSocketWrap" || n === "TCPServerWrap" || n === "TLSWrap").length,
		timers: names.filter((n) => n === "Timeout").length,
	};
}

/** Test-only observer: the extension context (theme name) and the wait calls; it draws nothing and changes nothing. */
const probe = (pi: ExtensionAPI) => {
	pi.on("session_start", (_event, ctx) => { probeCtx = ctx; });
	pi.on("tool_execution_start", (event) => {
		const args = event.args as { action?: string; ids?: string[] } | undefined;
		if (args?.action === "wait") waitStarts.push(...(args.ids ?? []));
	});
};

function writeSettings(packages: unknown[]) {
	writeFileSync(join(agentDir, "settings.json"), JSON.stringify({
		quietStartup: true, checkForUpdates: false, lastChangelogVersion: "1.4.0", theme: THEME,
		defaultProvider: "openai-codex", defaultModel: "gpt-6.1-sol", retry: { enabled: false },
		// A short kept tail, so the small test session has something to summarize on /compact.
		compaction: { keepRecentTokens: 200 }, packages,
	}, null, 2));
}

before(() => {
	root = mkdtempSync(join(tmpdir(), "rqw-ui-e2e проба-"));
	work = join(root, "work");
	agentDir = join(root, "agent");
	mkdirSync(work, { recursive: true });
	mkdirSync(agentDir, { recursive: true });
	writeFileSync(join(work, "a.txt"), "alpha\nbeta\n");
	writeFileSync(join(work, "b.txt"), "one\ntwo\n");
	writeFileSync(join(work, "wait-flag.sh"), WAIT_SCRIPT);
	// The package as a user installs it: the repository folder, read through its own manifest.
	writeSettings([{ source: REPO, extensions: [CODEX_OFF] }]);
	for (const key of Object.keys(process.env)) if (/(?:_API_KEY|_TOKEN|_SECRET|AUTH_TOKEN)$/.test(key)) delete process.env[key];
	process.env.PI_CODING_AGENT_DIR = agentDir;
	process.env.PI_OFFLINE = "1";
	process.env.PI_SKIP_VERSION_CHECK = "1";
	process.env.COLORTERM = "truecolor";
});

after(async () => {
	mode?.stop();
	await runtime?.dispose();
	process.env = savedEnv;
	rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

async function until(what: string, check: () => boolean, ms = 20_000) {
	const end = Date.now() + ms;
	while (!check()) {
		if (Date.now() > end) throw new Error(`timed out waiting for ${what}\nrequests: ${requests.join(" | ")}\ntool results: ${toolResults()}\n${dump()}`);
		await new Promise((resolve) => setTimeout(resolve, 15));
	}
}

/** The tool results of the current session, short, for a failure message. */
function toolResults(): string {
	const messages = (runtime?.session.messages ?? []) as { role: string; toolName?: string; isError?: boolean; content: unknown }[];
	return messages.filter((m) => m.role === "toolResult").map((m) => `${m.toolName}${m.isError ? "!" : ""}: ${textOf(m.content).slice(0, 160)}`).join(" | ");
}

function dump(): string {
	return term ? term.screen.lines().map((line, i) => `${String(i).padStart(2)}|${line}`).join("\n") : "(no terminal)";
}

const rows = () => term!.screen.lines();
const hasRow = (text: string | RegExp) => rows().some((line) => (typeof text === "string" ? line.includes(text) : text.test(line)));
const summaryRows = () => rows().flatMap((line, i) => (line.trimStart().startsWith(SUMMARY_MARK) ? [i] : []));
const sessionId = () => runtime!.session.sessionManager.getSessionId();

/** The context bar, the editor's bottom border of RQW-statusbar: `... 11% 12.8k/115.2k`, `?/115.2k` after a compaction. */
const CONTEXT_BAR = /(?:\d+% [\d.]+k|\?)\/[\d.]+k$/;
/** The editor's top border: the nearest rule row above the context bar (the input rows lie between them). */
function topRow(): number {
	const r = rows();
	const bottom = r.findLastIndex((line) => CONTEXT_BAR.test(line));
	if (bottom < 0) return -1;
	for (let i = bottom - 1; i >= 0; i--) if (r[i].startsWith(RULE)) return i;
	return -1;
}
/** Whether the top border ends with the session ID (it is dropped when the status does not fit beside it). */
const topHasId = () => rows()[topRow()]?.endsWith(`${sessionId()} ${RULE}${RULE}`) ?? false;
/** The status text on the top border, or "" when the border is the continuous rule (fully idle). */
function topStatus(): string | undefined {
	const r = topRow();
	if (r < 0) return undefined;
	const line = rows()[r].replace(sessionId(), "");
	return line.replace(new RegExp(`[${RULE}\\s]+`, "g"), " ").trim();
}
/** Foreground colours of the rule cells of the top border. */
function topRuleColours(): Set<string> {
	const r = topRow();
	const cells = term!.screen.grid[r];
	return new Set(cells.flatMap((ch, k) => (ch === RULE ? [term!.screen.fg[r][k]] : [])));
}
/** Foreground colours of the status letters on the top border. */
function topLetterColours(text: string): string[] {
	const r = topRow();
	const line = term!.screen.grid[r].join("");
	const at = line.indexOf(text);
	assert.ok(at >= 0, `${text} on the top border\n${dump()}`);
	return term!.screen.fg[r].slice(at, at + text.length).filter((_, k) => text[k] !== " ");
}
const rgb = (s: string) => s.split(";").map(Number);
/** Gold (the compaction): red over green over blue, clearly warm. Silver letters are grey or the cold foreground. */
const isGold = (s: string) => { const [r, g, b] = rgb(s); return s.split(";").length === 3 && r > g && g > b && r - b > 60; };

async function startPi() {
	term = new ScriptedTerminal();
	const modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: null, refreshOnCreate: false });
	modelRuntime.registerNativeProvider(faux.provider);
	await modelRuntime.setRuntimeApiKey("openai-codex", "fake-ui-e2e");
	runtime = await createAgentSessionRuntime(async ({ cwd, sessionManager, sessionStartEvent }) => {
		const services = await createAgentSessionServices({
			cwd, agentDir, modelRuntime,
			settingsManager: SettingsManager.create(cwd, agentDir),
			resourceLoaderOptions: {
				// The CLI loads codemode and tool_search as built-ins; the SDK takes them as factories.
				extensionFactories: [
					{ name: "codemode", factory: createCodemodeExtension(), replaceable: true, builtin: true as const },
					{ name: "tool-search", factory: createToolSearchExtension(), replaceable: true, builtin: true as const },
					{ name: "ui-e2e-probe", factory: probe },
				],
				noSkills: true, noPromptTemplates: true, noContextFiles: true,
			},
		});
		const created = await createAgentSessionFromServices({
			services, sessionManager, sessionStartEvent, model: faux.getModel("gpt-6.1-sol"), thinkingLevel: "low",
		});
		return { ...created, services, diagnostics: services.diagnostics };
	}, { cwd: work, agentDir, sessionManager: SessionManager.inMemory(work) });
	mode = new InteractiveMode(runtime, { terminal: term as never });
	await mode.init();
}

/** Sends a prompt to the session as send-now does; InteractiveMode's input loop (\`run\`) also starts the version and
 * package update checks, so the test drives \`init\` only and types slash commands into the real editor. */
function send(text: string) {
	void runtime!.session.prompt(text);
}
/** Types a slash command into the editor and submits it. */
function command(text: string) {
	term!.type(text);
	term!.key(ENTER);
}
/** Pi's hidden-thinking label row (default "Thinking..."). */
const thinkingLabel = () => rows().some((line) => line.trim() === "Thinking...");

describe("compact UI end to end in real Pi", { concurrency: false }, () => {
	it("e2e-manifest-registers-ui: the real manifest lists the UI extensions and the theme", () => {
		const list = MANIFEST.extensions;
		for (const name of ["RQW-statusbar", "RQW-thinking", "RQW-naming", "RQW-agent-ui", "RQW-tool-ui"]) {
			assert.equal(list.filter((p) => p === ext(name)).length, 1, `${name} once in pi.extensions`);
		}
		assert.ok(list.indexOf(ext("RQW-agent-ui")) < list.indexOf(ext("RQW-tool-ui")), "agent-ui before tool-ui");
		assert.deepEqual(MANIFEST.themes?.filter((p) => p.includes("RQW-theme")), ["./extensions/RQW-theme/theme.json"]);
	});

	it("e2e-startup-theme-idle: RQW-theme is selected from settings and drawn; fully idle is the continuous rule", async () => {
		await startPi();
		await until("the editor top border with the session ID", () => topRow() >= 0);
		assert.ok(topHasId(), `the session ID at the right end of the top border\n${dump()}`);
		assert.equal(probeCtx?.ui.theme.name, THEME, "the theme Pi uses");
		assert.ok(probeCtx?.ui.getAllThemes().some((t) => t.name === THEME), "the theme is a selectable resource");
		assert.equal(topStatus(), "", `no label on the idle top border\n${dump()}`);
		assert.deepEqual([...topRuleColours()], [SILVER_RULE], "the idle rule is silver");
		assert.ok(!thinkingLabel(), "no hidden-thinking label");
	});

	it("e2e-tools-live-summary-thinking: planning, action phrase, live block, summary before the answer, no reasoning text", async () => {
		const plan = gate(() => fauxAssistantMessage([fauxThinking(`${SECRET}-1 private`), fauxToolCall("read", { path: "a.txt" }, { id: "r1" }), fauxToolCall("read", { path: "b.txt" }, { id: "r2" })], { stopReason: "toolUse" }));
		mainScripts.set("tools-turn", [
			plan.reply,
			toolUse(fauxToolCall("edit", { path: "a.txt", edits: [{ oldText: "alpha", newText: "ALPHA" }] }, { id: "e1" })),
			toolUse(fauxToolCall("bash", { command: BASH }, { id: "b1" })),
			fauxAssistantMessage([fauxThinking(`${SECRET}-2 private`), fauxText("All done.")]),
		]);
		send("tools-turn");
		await until("the first model request", () => plan.entered());
		await until("Planning next moves", () => topStatus() === "Planning next moves");
		plan.release();
		await until("the running bash action phrase", () => (topStatus() ?? "").startsWith("Running bash wait-flag.sh"));
		await until("the live bash block", () => hasRow("$ bash wait-flag.sh"));
		const live = rows().findIndex((line) => line.includes("$ bash wait-flag.sh"));
		const summaries = summaryRows();
		assert.equal(summaries.length, 1, `one summary line while working\n${dump()}`);
		assert.ok(summaries[0] < live, "the summary line is above the live block");
		assert.ok(rows().slice(live).some((line) => line.includes("running")), "the live block is running");
		writeFileSync(join(work, FLAG), "");
		await until("the answer", () => hasRow("All done."));
		await until("idle after the answer", () => topStatus() === "");
		const r = rows();
		const answer = r.findIndex((line) => line.includes("All done."));
		const after = summaryRows();
		assert.equal(after.length, 1, `one summary line\n${dump()}`);
		assert.ok(after[0] < answer, "the summary is above the answer");
		assert.match(r[after[0]], /Edited 1 file \+1 -1 · read 2 files · ran 1 command/);
		assert.ok(!hasRow("$ bash wait-flag.sh") && !hasRow("running"), "the live block folded on the answer");
		assert.ok(!hasRow(SECRET), "no reasoning text in the transcript");
		const stored = JSON.stringify(runtime!.session.messages);
		assert.ok(stored.includes(`${SECRET}-1`) && stored.includes(`${SECRET}-2`), "the stored messages keep the reasoning");
		assert.ok(!thinkingLabel(), "no thinking label");
		assert.deepEqual([...topRuleColours()], [SILVER_RULE]);
		// The user message surface of RQW-theme (`userMessageBg` = #232120) is what Pi paints.
		assert.ok(term!.raw.includes("\x1b[48;2;35;33;32m"), "RQW-theme's user message background in the output");
	});

	it("e2e-tools-ctrl-o: Ctrl+O shows the original calls in place, again folds back", async () => {
		term!.key(CTRL_O);
		await until("the expanded originals", () => summaryRows().length === 0 && hasRow("$ bash wait-flag.sh"));
		const r = rows();
		const places = ["read a.txt", "$ bash wait-flag.sh", "All done."].map((m) => r.findIndex((line) => line.includes(m)));
		assert.ok(places.every((p) => p >= 0) && places.every((p, i) => i === 0 || p > places[i - 1]), `originals in order ${places}\n${dump()}`);
		assert.ok(r.some((line) => line.trim() === "l5"), "the original bash output");
		assert.ok(!hasRow(SECRET), "Ctrl+O does not bring the reasoning text back");
		term!.key(CTRL_O);
		await until("folded again", () => summaryRows().length === 1 && !hasRow("$ bash wait-flag.sh"));
	});

	it("e2e-thinking-hidden-branch: with thinking blocks hidden (Ctrl+T) the hidden label is empty", async () => {
		term!.key(CTRL_T);
		// Pi rebuilds the transcript and then reports the toggle; residual native spacing is accepted, only the label text
		// and the reasoning text must be absent.
		await until("the toggle status", () => hasRow("Thinking blocks: hidden"));
		assert.ok(!thinkingLabel(), `no hidden-thinking label\n${dump()}`);
		assert.ok(!hasRow(SECRET));
		assert.equal(summaryRows().length, 1, "the tool summary stays");
		term!.key(CTRL_T);
		await until("thinking blocks shown again", () => hasRow("Thinking blocks: visible"));
	});

	it("e2e-cards-custom-message: agent, code_writer and shell_runner results as cards; Waiting for N after the answer", async () => {
		const a = gate(() => fauxAssistantMessage("Первая строка A.\nВторая строка A."));
		const cw = gate(() => fauxAssistantMessage("Первая строка CW.\nВторая строка CW."));
		const sr = gate(() => fauxAssistantMessage("Первая строка SR.\nВторая строка SR."));
		childReplies.set("CHILD_A", a.reply);
		childReplies.set("WORKER_CW1", cw.reply);
		childReplies.set("WORKER_SR1", sr.reply);
		mainScripts.set("cards-custom", [
			toolUse(
				fauxToolCall("agent", { action: "start", task: "CHILD_A task", system: "You are a test child.", tools: [], model: "openai-codex/gpt-6.1-sol" }, { id: "a1" }),
				fauxToolCall("code_writer", { task: "WORKER_CW1 brief" }, { id: "w1" }),
				fauxToolCall("shell_runner", { task: "WORKER_SR1 brief" }, { id: "w2" }),
			),
			fauxAssistantMessage("Main answered."),
		]);
		// The main turn a delivered agent result starts is held, to see main and children at once on the border.
		const noted = gate(() => fauxAssistantMessage("Noted."));
		mainScripts.set("[agent#1]", [noted.reply]);
		send("cards-custom");
		await until("the main answer", () => hasRow("Main answered."));
		await until("all three children running", () => a.entered() && cw.entered() && sr.entered());
		await until("Waiting for 1 agent, 2 workers", () => topStatus() === "Waiting for 1 agent, 2 workers");
		assert.ok(rows()[topRow()].includes("Waiting for 1 agent, 2 workers"));
		a.release();
		await until("the agent card", () => hasRow(/agent#1 finished · gpt-6\.1-sol \w+ · [\d.]+s/));
		await until("the main turn on the delivered result", () => noted.entered());
		await until("Planning next moves · 2 workers", () => topStatus() === "Planning next moves · 2 workers");
		noted.release();
		await until("Waiting for 2 workers", () => topStatus() === "Waiting for 2 workers");
		cw.release();
		await until("the code_writer card", () => hasRow(/code_writer#1 finished · gpt-6-luna low · [\d.]+s/));
		await until("Waiting for 1 worker", () => topStatus() === "Waiting for 1 worker");
		sr.release();
		await until("the shell_runner card", () => hasRow(/shell_runner#1 finished · gpt-6-luna medium · [\d.]+s/));
		await until("fully idle", () => topStatus() === "" && runtime!.session.isIdle);
		assert.deepEqual([...topRuleColours()], [SILVER_RULE], "the idle rule is continuous silver");
		for (const kind of ["A", "CW", "SR"]) {
			assert.ok(hasRow(`Первая строка ${kind}.`), `${kind}: the first answer line under the card`);
			assert.ok(!hasRow(`Вторая строка ${kind}.`), `${kind}: the rest is folded`);
		}
		for (const kind of ["agent", "code_writer", "shell_runner"]) {
			assert.ok(!rows().some((line) => line.trim() === `[${kind}]`), `${kind}: not Pi's default label box`);
		}
		term!.key(CTRL_O);
		await until("the full original texts", () => ["A", "CW", "SR"].every((kind) => hasRow(`Вторая строка ${kind}.`)));
		term!.key(CTRL_O);
		await until("the cards folded again", () => ["A", "CW", "SR"].every((kind) => !hasRow(`Вторая строка ${kind}.`)));
		const stored = runtime!.session.messages.filter((m) => m.role === "custom").map((m) => (m as { content: unknown }).content);
		assert.ok(stored.includes("[agent#1] Первая строка A.\nВторая строка A."), "the stored message is untouched");
	});

	it("e2e-cards-wait-result: wait results fold as tool-ui draws them; Ctrl+O shows agent-ui's expanded cards", async () => {
		// RQW-agent notification waits (7cff2f5): a plain `wait` returns a waiting receipt at once and ends the turn.
		// `blocking: true` keeps the call open, so these waits still return the finished result in the same tool result;
		// the notification path is the next test.
		// Owner's wait amendment: collapsed, a wait is the summary part `Waited for N agents` and tool-ui's live block
		// (header `wait <ids>`); the card is not required there. Ctrl+O on the wait call shows agent-ui's card of each
		// result in expanded form (header id, status, model, effort, seconds and the full answer text verbatim), once,
		// not the raw JSON.
		const w = gate(() => fauxAssistantMessage("Ответ через wait W.\nХвост W."));
		const cw = gate(() => fauxAssistantMessage("Ответ через wait CW.\nХвост CW."));
		const sr = gate(() => fauxAssistantMessage("Ответ через wait SR.\nХвост SR."));
		childReplies.set("CHILD_W", w.reply);
		childReplies.set("WORKER_CW2", cw.reply);
		childReplies.set("WORKER_SR2", sr.reply);
		const afterAgent = gate(() => toolUse(fauxToolCall("code_writer", { task: "WORKER_CW2 brief" }, { id: "q3" })));
		const afterWriter = gate(() => toolUse(fauxToolCall("shell_runner", { task: "WORKER_SR2 brief" }, { id: "q5" })));
		const afterRunner = gate(() => fauxAssistantMessage("Waited."));
		mainScripts.set("cards-wait", [
			toolUse(fauxToolCall("agent", { action: "start", task: "CHILD_W task", system: "You are a test child.", tools: [], model: "openai-codex/gpt-6.1-sol" }, { id: "q1" })),
			toolUse(fauxToolCall("agent", { action: "wait", ids: ["agent#2"], timeout_ms: 60000, blocking: true }, { id: "q2" })),
			afterAgent.reply,
			toolUse(fauxToolCall("code_writer", { action: "wait", ids: ["code_writer#2"], timeout_ms: 60000, blocking: true }, { id: "q4" })),
			afterWriter.reply,
			toolUse(fauxToolCall("shell_runner", { action: "wait", ids: ["shell_runner#2"], timeout_ms: 60000, blocking: true }, { id: "q6" })),
			afterRunner.reply,
		]);
		const steps: [string, Gate, Gate, RegExp, string, string][] = [
			["agent#2", w, afterAgent, /agent#2 finished · gpt-6\.1-sol \w+ · [\d.]+s/, "W", "Waited for 1 agent"],
			["code_writer#2", cw, afterWriter, /code_writer#2 finished · gpt-6-luna low · [\d.]+s/, "CW", "Waited for 2 agents"],
			["shell_runner#2", sr, afterRunner, /shell_runner#2 finished · gpt-6-luna medium · [\d.]+s/, "SR", "Waited for 3 agents"],
		];
		const count = (test: (line: string) => boolean) => rows().filter(test).length;
		send("cards-wait");
		// The checks of each held step are collected and asserted after the turn ends, so a failed one does not leave the
		// session busy for the scenes after this one.
		const problems: string[] = [];
		for (const [id, child, next, card, tag, waited] of steps) {
			await until(`the wait for ${id}`, () => waitStarts.includes(id) && child.entered());
			child.release();
			await until(`the main request after the ${id} wait`, () => next.entered());
			// Collapsed: the summary part and tool-ui's live block of the wait call.
			await until(`the ${id} live block`, () => count((line) => line.trim() === `wait ${id}`) === 1);
			const summary = summaryRows().at(-1);
			if (summary === undefined || !rows()[summary].includes(waited)) problems.push(`${id}: no summary part "${waited}"\n${dump()}`);
			else if (summary > rows().findIndex((line) => line.trim() === `wait ${id}`)) problems.push(`${id}: the summary is not above the live block`);
			if (hasRow(card)) problems.push(`${id}: a collapsed card where tool-ui draws the live block`);
			// Ctrl+O: the expanded card of the result, once, with the full answer text verbatim and no raw JSON.
			term!.key(CTRL_O);
			await until(`the expanded view at ${id}`, () => summaryRows().length === 0);
			try {
				await until(`the expanded ${id} card`, () => hasRow(card), 5_000);
			} catch {
				problems.push(`${id}: no expanded card on Ctrl+O\n${dump()}`);
			}
			if (hasRow(card)) {
				if (count((line) => card.test(line)) !== 1) problems.push(`${id}: the card is not shown once\n${dump()}`);
				const head = rows().findIndex((line) => card.test(line));
				const body = rows().slice(head + 1).map((line) => line.trim());
				if (body[0] !== `Ответ через wait ${tag}.` || body[1] !== `Хвост ${tag}.`) problems.push(`${id}: the full text is not under the header verbatim\n${dump()}`);
			}
			if (hasRow('"reason"') || hasRow('"results"')) problems.push(`${id}: raw JSON on Ctrl+O\n${dump()}`);
			term!.key(CTRL_O);
			await until(`folded back at ${id}`, () => summaryRows().length > 0 && count((line) => line.trim() === `wait ${id}`) === 1 && !hasRow(`Хвост ${tag}.`));
			next.release();
		}
		await until("the answer", () => hasRow("Waited."));
		await until("idle", () => topStatus() === "" && runtime!.session.isIdle);
		const r = rows();
		const answer = r.findIndex((line) => line.includes("Waited."));
		const summary = summaryRows().filter((i) => i < answer).at(-1);
		assert.deepEqual(problems, [], "the wait results collapsed and on Ctrl+O");
		assert.ok(summary !== undefined && /Waited for 3 agents/.test(r[summary]), `the waits fold into the summary\n${dump()}`);
		assert.ok(!steps.some(([id, , , card]) => hasRow(card) || hasRow(`wait ${id}`)), "no live block or card after the answer");
		const custom = runtime!.session.messages.filter((m) => m.role === "custom" && /#2\]/.test(String((m as { content: unknown }).content)));
		assert.deepEqual(custom, [], "a waited result is not also delivered as a message");
	});

	it("e2e-wait-notification: a plain wait returns a waiting receipt and ends the turn; the result wakes main once as child_wait", async () => {
		// RQW-agent (7cff2f5): without `blocking` the wait returns `reason: "waiting"` with no results and `terminate: true`, so
		// main makes no further model request; the finished result arrives once as a `child_wait` message that wakes main.
		const child = gate(() => fauxAssistantMessage("Ответ через уведомление N."));
		const wake = gate(() => fauxAssistantMessage("Notified."));
		childReplies.set("CHILD_N", child.reply);
		mainScripts.set("wait-notify", [
			toolUse(fauxToolCall("agent", { action: "start", task: "CHILD_N task", system: "You are a test child.", tools: [], model: "openai-codex/gpt-6.1-sol" }, { id: "n1" })),
			toolUse(fauxToolCall("agent", { action: "wait", ids: ["agent#3"], timeout_ms: 60000 }, { id: "n2" })),
		]);
		mainScripts.set('{"reason":"result"', [wake.reply]);
		const mainRequests = () => requests.filter((r) => r.startsWith("main "));
		const customMessages = () => runtime!.session.messages.filter((m) => m.role === "custom") as { customType: string; content: unknown }[];
		send("wait-notify");
		await until("the wait for agent#3 with the child running", () => waitStarts.includes("agent#3") && child.entered());
		await until("the turn ended with the child still running", () => runtime!.session.isIdle && topStatus() === "Waiting for 1 agent");
		const receipt = JSON.parse(textOf((runtime!.session.messages.filter((m) => m.role === "toolResult" && (m as { toolName?: string }).toolName === "agent").at(-1) as { content: unknown }).content));
		assert.equal(receipt.reason, "waiting", "the wait returned a waiting receipt");
		assert.deepEqual(receipt.results, [], "no result yet");
		assert.equal(mainRequests().at(-1), "main wait-notify 1", "no model request after the waiting receipt");
		assert.ok(hasRow("Waited for 1 agent"), `the collapsed wait is a summary part\n${dump()}`);
		child.release();
		await until("main woken by the child_wait notification", () => wake.entered());
		const notice = customMessages().filter((m) => m.customType === "child_wait");
		assert.equal(notice.length, 1, "one child_wait notification");
		const delivered = JSON.parse(String(notice[0].content));
		assert.equal(delivered.reason, "result");
		assert.equal(delivered.results.length, 1);
		assert.equal(delivered.results[0].id, "agent#3");
		assert.equal(delivered.results[0].outcome, "completed");
		assert.equal(delivered.results[0].text, "Ответ через уведомление N.");
		wake.release();
		await until("the answer after the wake", () => hasRow("Notified."));
		await until("idle", () => topStatus() === "" && runtime!.session.isIdle);
		assert.ok(!customMessages().some((m) => String(m.content).startsWith("[agent#3]")), "the waited result is not also pushed as a message");
		assert.equal(mainRequests().filter((r) => r.startsWith("main {")).length, 1, "one wake request");
	});

	// The real review tool answers with a start acknowledgement; the verdict of the reviewer (the merged REVIEWER.md
	// format) arrives later as the `[review#N]` custom message of RQW-review: the verdict, a blank line and the advice
	// of `verdictMessage`. agent-ui draws it as a card: collapsed the ID, the verdict (or the count of findings) and the
	// first body line, Ctrl+O the whole original text, a second Ctrl+O folds it back.
	const reviewCard = async (name: string, n: number, verdict: AssistantMessage, card: { header: string; first: string; full: string[] }) => {
		const reviewer = gate(() => verdict);
		reviewerReply = reviewer.reply;
		mainScripts.set(name, [
			toolUse(fauxToolCall("review", { level: "blind", object: "a.txt, stage pre-completion", criterion: "a.txt says ALPHA" }, { id: `v${n}` })),
			fauxAssistantMessage(`Review ${n} requested.`),
		]);
		send(name);
		await until("Waiting for 1 review", () => topStatus() === "Waiting for 1 review");
		reviewer.release();
		const headerRow = () => rows().findIndex((line) => line.trim() === `review#${n} ${card.header}`);
		await until(`the review#${n} card`, () => headerRow() >= 0);
		await until("idle", () => topStatus() === "" && runtime!.session.isIdle);
		assert.ok(!rows().some((line) => line.trim() === "[review]"), `not Pi's default label box\n${dump()}`);
		assert.ok(!hasRow(`[review#${n}]`), "the outer prefix is not shown");
		// Collapsed: the header and the first body line only.
		assert.equal(rows()[headerRow() + 1]?.trim(), card.first, `the first body line under the header\n${dump()}`);
		for (const text of card.full) assert.ok(!hasRow(text), `collapsed: ${text} is folded\n${dump()}`);
		// Ctrl+O: the whole original text of the message, including the advice of verdictMessage.
		term!.key(CTRL_O);
		await until(`the full review#${n} text`, () => card.full.every((text) => hasRow(text)));
		term!.key(CTRL_O);
		await until(`review#${n} folded again`, () => card.full.every((text) => !hasRow(text)) && headerRow() >= 0);
		assert.equal(rows()[headerRow() + 1]?.trim(), card.first);
		const stored = runtime!.session.messages.filter((m) => m.role === "custom").map((m) => String((m as { content: unknown }).content));
		assert.ok(stored.some((content) => content.startsWith(`[review#${n}] `)), "the stored message keeps the [review#N] prefix");
	};

	it("e2e-review-card-clean: CLEAN with CHECKED is a card; Ctrl+O shows the full text and the advice", async () => {
		await reviewCard("review-clean", 1, fauxAssistantMessage("CLEAN\nCHECKED:\n- a.txt says ALPHA (a.txt:1)"), {
			header: "CLEAN", first: "CLEAN",
			full: ["- a.txt says ALPHA (a.txt:1)", "The check passed only with complete CHECKED evidence"],
		});
	});

	it("e2e-review-card-findings: FINDINGS shows the count of findings, Ctrl+O every field", async () => {
		const finding = (n: number) => `FINDING ${n}\nREQUIREMENT: "a.txt says ALPHA" (criterion)\nMISMATCH: Field ${n} says alpha in lower case.\nEVIDENCE: "alpha" (a.txt)\nREQUIRED OUTCOME: a.txt says ALPHA.`;
		await reviewCard("review-findings", 2, fauxAssistantMessage(`FINDINGS:\n${finding(1)}\n${finding(2)}\nCHECKED:\n- b.txt read`), {
			header: "2 findings", first: "FINDINGS:",
			full: ["FINDING 2", "MISMATCH: Field 2 says alpha in lower case.", "REQUIRED OUTCOME: a.txt says ALPHA.", "Fix all admitted findings in one batch"],
		});
	});

	it("e2e-review-card-unchecked: CLEAN with UNCHECKED carries the unchecked count", async () => {
		await reviewCard("review-unchecked", 3, fauxAssistantMessage("CLEAN\nCHECKED:\n- a.txt line 1\nUNCHECKED:\n- c.txt - not readable\n- d.txt - not readable"), {
			header: "CLEAN \u00b7 2 unchecked", first: "CLEAN",
			full: ["- d.txt - not readable", "The check is incomplete regardless of its leading verdict"],
		});
	});

	it("e2e-review-card-failed: a reviewer that failed is a Review failed card", async () => {
		await reviewCard("review-failed", 4, fauxAssistantMessage("", { stopReason: "error", errorMessage: "faux reviewer failure" }), {
			header: "Review failed:", first: "Review failed: faux reviewer failure",
			full: ["The check has not passed, and no self-check replaces it"],
		});
	});

	it("e2e-compaction-cancel: gold Compacting context, Esc cancels, the border is silver again", async () => {
		const summary = gate(() => fauxAssistantMessage("## Goal\nunused"));
		summaryReply = summary.reply;
		command("/compact");
		await until("the summary request", () => summary.entered());
		await until("Compacting context", () => topStatus() === "Compacting context");
		assert.ok(topLetterColours("Compacting context").every(isGold), `gold letters: ${topLetterColours("Compacting context")}`);
		assert.ok([...topRuleColours()].every(isGold), "the compaction chrome is gold");
		term!.key(ESC);
		await until("Compaction cancelled", () => hasRow("Compaction cancelled"));
		await until("the idle border", () => topStatus() === "");
		assert.ok(summary.aborted(), "the summary request was aborted");
		assert.deepEqual([...topRuleColours()], [SILVER_RULE], "no gold left on the border");
	});

	it("e2e-compaction-error: a failed summary leaves no gold status", async () => {
		summaryReply = fauxAssistantMessage("", { stopReason: "error", errorMessage: "faux summary failure" });
		command("/compact");
		await until("Compaction failed", () => hasRow("Compaction failed"));
		await until("the idle border", () => topStatus() === "");
		assert.deepEqual([...topRuleColours()], [SILVER_RULE]);
	});

	it("e2e-compaction-success: gold while compacting, silver after the summary", async () => {
		const summary = gate(() => fauxAssistantMessage("## Goal\nUI check.\n## Progress\nDone."));
		summaryReply = summary.reply;
		command("/compact");
		await until("the summary request", () => summary.entered());
		await until("Compacting context", () => topStatus() === "Compacting context");
		assert.ok(topLetterColours("Compacting context").every(isGold));
		summary.release();
		await until("the compaction summary", () => hasRow("Compacted from"));
		await until("the idle border", () => topStatus() === "");
		assert.deepEqual([...topRuleColours()], [SILVER_RULE]);
	});

	it("e2e-reload-on: /reload with the UI on leaves one live wiring: one child counts once and gets one card", async () => {
		command("/reload");
		await until("Reloaded", () => hasRow("Reloaded") && topRow() >= 0 && topHasId());
		const child = gate(() => fauxAssistantMessage("Первая строка R.\nВторая строка R."));
		childReplies.set("CHILD_R", child.reply);
		mainScripts.set("reload-check", [
			toolUse(fauxToolCall("agent", { action: "start", task: "CHILD_R task", system: "You are a test child.", tools: [], model: "openai-codex/gpt-6.1-sol" }, { id: "g1" })),
			fauxAssistantMessage("Started R."),
		]);
		send("reload-check");
		await until("Started R.", () => hasRow("Started R.") && child.entered());
		await until("Waiting for 1 agent", () => topStatus() === "Waiting for 1 agent");
		child.release();
		await until("the card", () => hasRow("Первая строка R."));
		await until("idle", () => topStatus() === "" && runtime!.session.isIdle);
		assert.equal(rows().filter((line) => line.includes("Первая строка R.")).length, 1, `one card\n${dump()}`);
		assert.ok(hasRow(/agent#\d+ finished · gpt-6\.1-sol/), "the card header");
		const answer = rows().findIndex((line) => line.includes("Started R."));
		assert.equal(summaryRows().filter((i) => i < answer && i > rows().findIndex((line) => line.trim() === "reload-check")).length, 1, "one summary line for the turn");
	});

	it("e2e-session-switch: /new leaves no running count, card, title or old transcript; the new session works", async () => {
		const child = gate(() => fauxAssistantMessage("never delivered"));
		childReplies.set("CHILD_S", child.reply);
		mainScripts.set("switch-prep", [
			toolUse(fauxToolCall("agent", { action: "start", task: "CHILD_S task", system: "You are a test child.", tools: [], model: "openai-codex/gpt-6.1-sol" }, { id: "s1" })),
			fauxAssistantMessage("Started."),
		]);
		send("switch-prep");
		await until("Waiting for 1 agent", () => topStatus() === "Waiting for 1 agent" && child.entered());
		await until("the generated session title", () => hasRow("UI check 1"));
		const before = sessionId();
		command("/new");
		await until("the new session", () => sessionId() !== before && topRow() >= 0 && topHasId());
		await until("the child of the old session is stopped", () => child.aborted());
		await until("the idle border of the new session", () => topStatus() === "");
		assert.ok(!hasRow("Started.") && summaryRows().length === 0, `no old transcript\n${dump()}`);
		assert.ok(!hasRow("UI check 1"), "no title of the old session");
		mainScripts.set("after-switch", [toolUse(fauxToolCall("read", { path: "b.txt" }, { id: "n1" })), fauxAssistantMessage("Fine.")]);
		send("after-switch");
		await until("the answer in the new session", () => hasRow("Fine."));
		await until("idle", () => topStatus() === "" && runtime!.session.isIdle);
		assert.equal(summaryRows().length, 1, `one summary in the new session\n${dump()}`);
		assert.match(rows()[summaryRows()[0]], /Read 1 file/);
		assert.ok(!hasRow(/agent#\d/), "no card from the old session");
		assert.deepEqual(runtime!.session.messages.filter((m) => m.role === "custom"), [], "nothing of the old child reached the new session");
		assert.deepEqual([...topRuleColours()], [SILVER_RULE]);
	});

	it("e2e-off-reload-stock: the package filter switches the UI extensions off, /reload gives Pi's stock interface", async () => {
		writeSettings([{ source: REPO, extensions: [CODEX_OFF, ...UI_OFF] }]);
		command("/reload");
		await until("the stock editor after /reload", () => hasRow("Reloaded") && topRow() < 0);
		assert.equal(summaryRows().length, 0, "no summary after switching off");
		assert.ok(hasRow("read b.txt"), `the old call is a stock row\n${dump()}`);
		const plan = gate(() => fauxAssistantMessage([fauxThinking(`${SECRET}-3 visible`), fauxToolCall("read", { path: "a.txt" }, { id: "x1" })], { stopReason: "toolUse" }));
		childReplies.set("CHILD_X", fauxAssistantMessage("Stock child answer."));
		mainScripts.set("stock-turn", [
			plan.reply,
			toolUse(fauxToolCall("agent", { action: "start", task: "CHILD_X task", system: "You are a test child.", tools: [], model: "openai-codex/gpt-6.1-sol" }, { id: "x2" })),
			fauxAssistantMessage("Stock done."),
		]);
		send("stock-turn");
		await until("the stock working indicator", () => plan.entered() && hasRow(/^── \S+ Working/));
		assert.ok(!hasRow("Planning next moves"), "no RQW status");
		plan.release();
		await until("the stock agent message", () => rows().some((line) => line.trim() === "[agent]") && hasRow("[agent#1] Stock child answer."));
		await until("idle", () => runtime!.session.isIdle);
		assert.ok(hasRow(`${SECRET}-3 visible`), "Pi shows the reasoning text again");
		term!.key(CTRL_T);
		await until("the toggle status", () => hasRow("Thinking blocks: hidden"));
		assert.ok(thinkingLabel(), `Pi's hidden-thinking label is back\n${dump()}`);
		term!.key(CTRL_T);
		await until("thinking blocks shown again", () => hasRow("Thinking blocks: visible"));
		assert.ok(hasRow("read a.txt"), "the new call is a stock row");
		assert.equal(summaryRows().length, 0, "no summary line");
		assert.ok(!hasRow(/agent#1 finished/), "no card");
		assert.ok(!hasRow(sessionId()), "no session ID on a border");
	});

	it("e2e-clean-exit: no network, no child process, socket or timer left", async () => {
		mode!.stop();
		await runtime!.dispose();
		mode = undefined;
		runtime = undefined;
		assert.deepEqual(networkAttempts, [], "no network attempt");
		// A timer still pending right after the dispose may end on its own; a lingering one (an interval) never does.
		await until("the timers of the session to end", () => handleCounts().timers <= handlesBefore.timers, 5_000).catch(() => {});
		const after = handleCounts();
		assert.ok(after.children <= handlesBefore.children, `child processes: ${after.children} after, ${handlesBefore.children} before`);
		assert.ok(after.sockets <= handlesBefore.sockets, `sockets: ${after.sockets} after, ${handlesBefore.sockets} before`);
		assert.ok(after.timers <= handlesBefore.timers, `timers: ${after.timers} after, ${handlesBefore.timers} before`);
	});
});
