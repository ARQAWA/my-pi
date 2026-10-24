// RQW-tool-ui in Pi's real InteractiveMode on a scripted terminal that is a small screen emulator: the screen rows are
// what a user sees. A faux model answers a fixed script (no network, no real model). The package is loaded from a
// temporary copy of the extension folder, switched off and on with the package filter and /reload.
import { networkAttempts } from "./no-network.mjs";
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
	type AgentSessionRuntime,
	createAgentSessionFromServices,
	createAgentSessionRuntime,
	createAgentSessionServices,
	createCodemodeExtension,
	createToolSearchExtension,
	type ExtensionAPI,
	initTheme,
	InteractiveMode,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const TOOL_UI = join(REPO, "extensions", "RQW-tool-ui");
const SUMMARY = "Edited 1 file +1 -1 \u00b7 read 2 files \u00b7 ran 1 command";
/** The start of the summary line that survives the narrowest width tested. */
const SUMMARY_MARK = "Edited 1 file";
const STATUS_MARKS = ["running", "\u2713", "\u2717"];
const STOCK_READ_B = "read b.txt";
const STOCK_BASH = "$ printf";
const ENTER = "\r";
const CTRL_O = "\x0f";

const CODE = 'await tools.read({ path: "a.txt" }); await tools.read({ path: "b.txt" }); return "ok";';
const BASH = "printf 'l1\\nl2\\nl3\\nl4\\nl5\\n'; sleep 2";

// One faux model for the whole file; the replies go in order, one per model request.
const faux = fauxProvider({ api: "faux-tool-ui-smoke", provider: "faux-tool-ui-smoke", models: [{ id: "faux-1" }] });
faux.setResponses([
	fauxAssistantMessage([fauxToolCall("read", { path: "a.txt" }, { id: "r1" }), fauxToolCall("read", { path: "b.txt" }, { id: "r2" })], { stopReason: "toolUse" }),
	fauxAssistantMessage([fauxToolCall("edit", { path: "a.txt", edits: [{ oldText: "alpha", newText: "ALPHA" }] }, { id: "e1" })], { stopReason: "toolUse" }),
	fauxAssistantMessage([fauxToolCall("bash", { command: BASH }, { id: "b1" })], { stopReason: "toolUse" }),
	fauxAssistantMessage([fauxToolCall("codemode", { code: CODE }, { id: "k1" })], { stopReason: "toolUse" }),
	fauxAssistantMessage(fauxText("All done.")),
	fauxAssistantMessage([fauxToolCall("read", { path: "b.txt" }, { id: "r3" })], { stopReason: "toolUse" }),
	fauxAssistantMessage(fauxText("Fine.")),
]);

faux.provider.auth.apiKey = { name: "Fake key", resolve: async () => ({ auth: { apiKey: "fake" } }) };

/** The driver: registers the faux provider the way codemode-check's driver does. */
const driver = {
	name: "faux-driver",
	factory: (pi: ExtensionAPI) => {
		pi.registerProvider(faux.provider as never);
	},
};

/** A terminal emulator for Pi's output: text, CR/LF with scrolling, cursor moves, erases; OSC and APC are skipped. */
class Screen {
	rows: number;
	cols: number;
	grid: string[][];
	row = 0;
	col = 0;
	pending = "";
	/** Printable characters written past the right edge: a row wider than the terminal. */
	overflow = 0;
	/** Rows that scrolled off the top; an erase of the scrollback clears them. */
	history: string[] = [];

	constructor(rows: number, cols: number) {
		this.rows = rows;
		this.cols = cols;
		this.grid = blankGrid(rows, cols);
	}

	resize(rows: number, cols: number) {
		const kept = this.grid.slice(-rows).map((line) => (line.concat(Array(cols).fill(" ")) as string[]).slice(0, cols));
		this.grid = blankGrid(rows - kept.length, cols).concat(kept);
		this.rows = rows;
		this.cols = cols;
		this.row = Math.min(this.row, rows - 1);
		this.col = Math.min(this.col, cols - 1);
	}

	/** The rows on the screen, trailing spaces cut. */
	lines(): string[] {
		return this.grid.map((line) => line.join("").replace(/\s+$/u, ""));
	}

	/** The rows scrolled off the top, then the rows on the screen. */
	allLines(): string[] {
		return [...this.history, ...this.lines()];
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
					if (wide && this.col + 1 < this.cols) this.grid[this.row][this.col + 1] = "";
				} else {
					this.overflow++;
				}
				this.col = Math.min(this.cols, this.col + (wide ? 2 : 1));
			}
			i++;
		}
	}

	private newline() {
		if (this.row === this.rows - 1) {
			this.history.push(this.grid[0].join("").replace(/\s+$/u, ""));
			this.grid = this.grid.slice(1).concat([Array(this.cols).fill(" ")]);
		} else {
			this.row++;
		}
	}

	private csi(params: string, final: string) {
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
			const to = mode === 0 ? this.cols : mode === 1 ? this.col + 1 : this.cols;
			for (let k = from; k < to; k++) this.grid[this.row][k] = " ";
		} else if (final === "J") {
			const mode = nums[0] ?? 0;
			if (mode === 0) {
				for (let k = this.col; k < this.cols; k++) this.grid[this.row][k] = " ";
				for (let r = this.row + 1; r < this.rows; r++) this.grid[r] = Array(this.cols).fill(" ");
			} else if (mode === 2 || mode === 3) {
				this.grid = blankGrid(this.rows, this.cols);
				if (mode === 3) this.history = [];
			}
		}
	}
}

function blankGrid(rows: number, cols: number): string[][] {
	return Array.from({ length: rows }, () => Array(cols).fill(" ") as string[]);
}

/** A terminal that records nothing but its screen, and lets the test type and resize. */
class ScriptedTerminal {
	onInput: ((data: string) => void) | undefined;
	onResize: (() => void) | undefined;
	height = 40;
	width = 80;
	screen = new Screen(40, 80);
	start(onInput: (data: string) => void, onResize: () => void) { this.onInput = onInput; this.onResize = onResize; }
	stop() {}
	async drainInput() {}
	write(data: string) { this.screen.feed(data); }
	get columns() { return this.width; }
	get rows() { return this.height; }
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
	resize(cols: number) {
		this.width = cols;
		this.screen.resize(this.height, cols);
		this.screen.overflow = 0;
		this.onResize!();
	}
}

let root: string;
let pkg: string;
let work: string;
let agentDir: string;
const savedEnv = { ...process.env };
const handlesBefore = handleCounts();

/** Child processes and sockets Node reports as active; compared before the start and after the dispose. */
function handleCounts() {
	const names = process.getActiveResourcesInfo();
	return {
		children: names.filter((n) => n === "ChildProcess").length,
		sockets: names.filter((n) => n === "TCPSocketWrap" || n === "TCPServerWrap").length,
	};
}

before(() => {
	// A temporary copy of the extension folder without its test folder, loaded as a package from settings.
	root = mkdtempSync(join(tmpdir(), "rqw-tool-ui смоук-"));
	pkg = join(root, "pkg");
	const testDir = join(TOOL_UI, "test");
	cpSync(TOOL_UI, join(pkg, "extensions", "RQW-tool-ui"), {
		recursive: true,
		filter: (src) => src !== testDir && !src.startsWith(testDir + sep),
	});
	writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "tool-ui-smoke", private: true,
		pi: { extensions: ["./extensions/RQW-tool-ui/index.ts"] } }));
	work = join(root, "work");
	mkdirSync(work, { recursive: true });
	writeFileSync(join(work, "a.txt"), "alpha\nbeta\n");
	writeFileSync(join(work, "b.txt"), "one\ntwo\n");
	agentDir = join(root, "agent");
	mkdirSync(agentDir, { recursive: true });
	writeSettings([pkg]);
	process.env.PI_CODING_AGENT_DIR = agentDir;
	process.env.PI_OFFLINE = "1";
	process.env.PI_SKIP_VERSION_CHECK = "1";
	initTheme("dark", false);
});

after(async () => {
	// A failed test may leave the session running; stop it before the folder goes.
	mode?.stop();
	await runtime?.dispose();
	process.env = savedEnv;
	rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

function writeSettings(packages: unknown[]) {
	writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ quietStartup: true, checkForUpdates: false,
		defaultProvider: "faux-tool-ui-smoke", defaultModel: "faux-1", packages }));
}

/** Polls until `check` holds; on timeout the error carries the screen. */
async function until(what: string, check: () => boolean, ms = 15_000) {
	const end = Date.now() + ms;
	while (!check()) {
		if (Date.now() > end) throw new Error(`timed out waiting for ${what}\n${dump()}`);
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
}

let term: ScriptedTerminal | undefined;
let mode: InteractiveMode | undefined;
let runtime: AgentSessionRuntime | undefined;

function dump(): string {
	return term ? term.screen.lines().map((line, i) => `${String(i).padStart(2)}|${line}`).join("\n") : "(no terminal)";
}

const screen = () => term!.screen;
const rows = () => screen().lines();
const summaryRows = () => rows().flatMap((line, i) => (line.trimStart().startsWith(SUMMARY_MARK) ? [i] : []));
const hasRow = (text: string) => rows().some((line) => line.includes(text));

/** Pi's interactive mode on the scripted terminal, with the package (unless `off`) and the codemode tools on. */
async function start() {
	term = new ScriptedTerminal();
	const modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: null, refreshOnCreate: false });
	await modelRuntime.setRuntimeApiKey("faux-tool-ui-smoke", "fake");
	runtime = await createAgentSessionRuntime(async ({ cwd, sessionManager, sessionStartEvent }) => {
		const services = await createAgentSessionServices({
			cwd, agentDir, modelRuntime,
			settingsManager: SettingsManager.create(cwd, agentDir),
			resourceLoaderOptions: {
				extensionFactories: [
					{ name: "codemode", factory: createCodemodeExtension(), replaceable: true, builtin: true as const },
					{ name: "tool-search", factory: createToolSearchExtension(), replaceable: true, builtin: true as const },
					driver,
				],
				noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
			},
		});
		const created = await createAgentSessionFromServices({
			services, sessionManager, sessionStartEvent, model: faux.getModel(), thinkingLevel: "off", tools: ["+codemode"],
		});
		return { ...created, services, diagnostics: services.diagnostics };
	}, { cwd: work, agentDir, sessionManager: SessionManager.inMemory(work) });
	mode = new InteractiveMode(runtime, { terminal: term as never });
	await mode.init();
	return { mode, runtime };
}

/** The live card of the running bash call: header row, status row and the output rows between them. */
function card() {
	const r = rows();
	const heads = r.flatMap((line, i) => (line.includes(STOCK_BASH) ? [i] : []));
	if (heads.length === 0) return undefined;
	const h = heads.at(-1)!;
	const s = r.findIndex((line, i) => i > h && STATUS_MARKS.some((m) => line.trimStart().startsWith(m)));
	if (s < 0) return undefined;
	return { h, s, body: r.slice(h + 1, s).map((line) => line.trim()) };
}

describe("RQW-tool-ui terminal smoke", { concurrency: false }, () => {
	it("smoke-live-while-working", async () => {
		await start();
		// A prompt goes to the session as in send-now; the interactive run loop that takes typed prompts is not run here.
		void runtime!.session.prompt("go");
		await until("the live card with l5", () => {
			const c = card();
			return c !== undefined && rows()[c.s].includes("running") && c.body.includes("l5");
		});
		const c = card()!;
		const summaries = summaryRows();
		assert.ok(summaries.length === 1 && summaries[0] < c.h, `summary above the card: ${JSON.stringify(summaries)}\n${dump()}`);
		assert.ok(rows()[c.s].includes("running"), rows()[c.s]);
		assert.ok(c.body.length <= 4, `at most 4 output rows: ${JSON.stringify(c.body)}`);
		for (const l of ["l2", "l3", "l4", "l5"]) assert.ok(c.body.includes(l), `${l} in ${JSON.stringify(c.body)}`);
	});

	it("smoke-summary-before-answer", async () => {
		await until("the answer", () => hasRow("All done."));
		const r = rows();
		const summaries = summaryRows();
		const answer = r.findIndex((line) => line.includes("All done."));
		assert.equal(summaries.length, 1, `summary rows ${JSON.stringify(summaries)}\n${dump()}`);
		assert.ok(summaries[0] < answer, "the summary is above the answer");
		assert.ok(r[summaries[0]].includes(SUMMARY), `summary text: ${r[summaries[0]]}\n${dump()}`);
	});

	it("smoke-live-folds-on-answer", async () => {
		const r = rows();
		assert.ok(!r.some((line) => line.includes("running")), "no row says running");
		assert.ok(!r.some((line) => line.includes(STOCK_BASH)), "no live or stock bash header");
		assert.ok(!r.some((line) => line.includes("read a.txt") || line.includes(STOCK_READ_B)), "no stock read row");
	});

	it("smoke-ctrl-o-original", async () => {
		term!.key(CTRL_O);
		await until("the expanded view", () => summaryRows().length === 0 && hasRow(STOCK_BASH));
		// Pi repaints the 40-row viewport only; the rows above it keep what they showed, so the stock rows are checked
		// where Pi draws them: bash with its output, codemode and the answer, in order.
		const r = rows();
		const places = [STOCK_BASH, "codemode", "All done."].map((mark) => r.findIndex((line) => line.includes(mark)));
		assert.ok(places.every((p) => p >= 0) && places.every((p, i) => i === 0 || p > places[i - 1]), `stock rows in order ${places}\n${dump()}`);
		assert.ok(r.some((line) => line.trim() === "l5"), "stock bash output");
		term!.key(CTRL_O);
		await until("folded again", () => summaryRows().length === 1 && !hasRow(STOCK_BASH));
	});

	it("smoke-width-fit", async () => {
		for (const width of [40, 24]) {
			term!.resize(width);
			await new Promise((resolve) => setTimeout(resolve, 100));
			assert.equal(screen().overflow, 0, `characters past the right edge at ${width} columns`);
			const wide = rows().filter((line) => visibleWidth(line) > width);
			assert.deepEqual(wide, [], `rows wider than ${width}`);
			assert.equal(summaryRows().length, 1, `summary at ${width} columns`);
		}
		term!.resize(80);
		await new Promise((resolve) => setTimeout(resolve, 100));
		assert.equal(term!.width, 80);
	});

	it("smoke-off-reload-stock", async () => {
		writeSettings([{ source: pkg, extensions: ["-extensions/RQW-tool-ui/index.ts"] }]);
		term!.type("/reload");
		term!.key(ENTER);
		await until("Reloaded", () => hasRow("Reloaded"));
		assert.equal(summaryRows().length, 0, "no summary after switching off");
		assert.ok(hasRow(STOCK_BASH), "old calls are stock rows after /reload");
		void runtime!.session.prompt("again");
		await until("the second answer", () => hasRow("Fine."));
		const r = rows();
		const again = r.findIndex((line) => line.trim() === "again");
		const readB = r.flatMap((line, i) => (line.includes(STOCK_READ_B) ? [i] : []));
		assert.equal(summaryRows().length, 0, "the new call is not a summary");
		assert.ok(readB.length > 0 && readB.at(-1)! > again, `the new read b.txt is stock after its prompt\n${dump()}`);
	});

	it("smoke-clean-exit", async () => {
		mode!.stop();
		await runtime!.dispose();
		assert.deepEqual(networkAttempts, [], "no network attempt");
		const after = handleCounts();
		assert.ok(after.children <= handlesBefore.children, `child processes: ${after.children} after, ${handlesBefore.children} before`);
		assert.ok(after.sockets <= handlesBefore.sockets, `sockets: ${after.sockets} after, ${handlesBefore.sockets} before`);
		mode = undefined;
		runtime = undefined;
	});
});
