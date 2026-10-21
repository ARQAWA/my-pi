// RQW-mouse with Pi's real TuiAltScreen and TuiMainScreen on a scripted terminal that records every write and the
// moment Pi starts it. Windows is simulated through process.platform where the test runs elsewhere, so the same
// cases run on the Mac and in the Windows CI. The ConPTY capture of the real pi.exe is pcli-vscode/test/mouse-suite.cjs.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, afterEach, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import * as pi from "@earendil-works/pi-coding-agent";
import { TuiAltScreen, TuiMainScreen, type Terminal } from "@earendil-works/pi-tui";
import mouse from "../index.ts";

const EXTENSION = fileURLToPath(new URL("../index.ts", import.meta.url));
const START = "\0terminal.start";
const STOP = "\0terminal.stop";
const PREFIX = "\x1b[?1000h";
const ALL_MOTION = "\x1b[?1000h\x1b[?1002h\x1b[?1003h\x1b[?1004h\x1b[?1006h";
const BUTTON_MOTION = "\x1b[?1000h\x1b[?1002h\x1b[?1004h\x1b[?1006h";
const DISABLE = "\x1b[?1006l\x1b[?1004l\x1b[?1003l\x1b[?1002l\x1b[?1000l";
const count = (text: string, needle: string) => text.split(needle).length - 1;

class FakeTerminal implements Terminal {
	log: string[] = [];
	start() { this.log.push(START); }
	stop() { this.log.push(STOP); }
	async drainInput() {}
	write(data: string) { this.log.push(data); }
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
	/** Everything written before Pi started the terminal the first time. */
	get beforeStart() { return this.log.slice(0, this.log.indexOf(START)).join(""); }
	/** The write that directly follows the n-th terminal.start (1-based). */
	afterStart(n: number) { return this.log[this.log.flatMap((e, i) => (e === START ? [i] : []))[n - 1] + 1]; }
	/** What was written while the terminal ran for the n-th time: from its start to its stop (1-based). */
	running(n: number) {
		const from = this.log.flatMap((e, i) => (e === START ? [i] : []))[n - 1] + 1;
		const to = this.log.indexOf(STOP, from);
		return this.log.slice(from, to < 0 ? undefined : to).join("");
	}
}

// What the owner's Windows console does, as a model: a mouse command written before the terminal started is lost.
class ConptyTerminal extends FakeTerminal {
	get host() { return this.running(1); }
}

const ENV = ["TMUX", "ZELLIJ", "STY", "TERM"] as const;
const savedEnv = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
const proto = TuiAltScreen.prototype;
const pristine = () => !Object.hasOwn(proto, "afterTerminalStart");
const shutdowns: (() => void)[] = [];

function withPlatform<T>(platform: string, fn: () => T): T {
	const original = Object.getOwnPropertyDescriptor(process, "platform")!;
	Object.defineProperty(process, "platform", { ...original, value: platform });
	try { return fn(); } finally { Object.defineProperty(process, "platform", original); }
}
async function withPlatformAsync<T>(platform: string, fn: () => Promise<T>): Promise<T> {
	const original = Object.getOwnPropertyDescriptor(process, "platform")!;
	Object.defineProperty(process, "platform", { ...original, value: platform });
	try { return await fn(); } finally { Object.defineProperty(process, "platform", original); }
}

/** Runs the extension factory as Pi does; the returned function is the session_shutdown Pi emits. */
function load(platform = "win32") {
	const handlers: Record<string, () => void> = {};
	withPlatform(platform, () => mouse({ on: (name: string, handler: () => void) => { handlers[name] = handler; } } as unknown as pi.ExtensionAPI));
	const shutdown = () => handlers.session_shutdown?.();
	shutdowns.push(shutdown);
	return shutdown;
}

function run(screen: TuiAltScreen | TuiMainScreen, restarts = 0) {
	screen.start();
	for (let i = 0; i < restarts; i++) { screen.stop(); screen.start(); }
	screen.stop();
}

beforeEach(() => { for (const k of ENV) delete process.env[k]; });
afterEach(() => {
	for (const k of ENV) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; }
	while (shutdowns.length) shutdowns.pop()!();
	assert.ok(pristine(), "no test leaves the patch on TuiAltScreen");
});

describe("RQW-mouse: mouse reporting after the terminal started (Windows, fullscreen)", () => {
	it("writes Pi's own set again right after terminal.start, once, before anything else", () => {
		load();
		const terminal = new FakeTerminal();
		run(new TuiAltScreen(terminal, false));
		const piSet = /\x1b\[\?1000h.*?\x1b\[\?1006h/.exec(terminal.beforeStart)?.[0];
		assert.equal(piSet, ALL_MOTION, "Pi's own set, before terminal.start");
		assert.equal(terminal.afterStart(1), piSet, "the very next write after terminal.start is that set");
		assert.equal(count(terminal.log.join(""), PREFIX), 2, "Pi's write plus one more");
		assert.equal(count(terminal.running(1), PREFIX), 1);
	});

	for (const [name, env] of [
		["TMUX", { TMUX: "/tmp/tmux-501/default,1,0" }],
		["ZELLIJ", { ZELLIJ: "0" }],
		["STY", { STY: "1234.pts-0.host" }],
		["TERM=tmux-256color", { TERM: "tmux-256color" }],
		["TERM=screen-256color", { TERM: "Screen-256color" }],
	] as const) {
		it(`multiplexer ${name}: the set without ?1003h, exactly what Pi writes`, () => {
			Object.assign(process.env, env);
			load();
			const terminal = new FakeTerminal();
			run(new TuiAltScreen(terminal, false));
			assert.ok(terminal.beforeStart.includes(BUTTON_MOTION), "Pi itself writes the multiplexer set");
			assert.equal(terminal.afterStart(1), BUTTON_MOTION);
			assert.equal(count(terminal.log.join(""), "\x1b[?1003h"), 0);
		});
	}

	it("a plain xterm terminal gets the all-motion set", () => {
		process.env.TERM = "xterm-256color";
		load();
		const terminal = new FakeTerminal();
		run(new TuiAltScreen(terminal, false));
		assert.equal(terminal.afterStart(1), ALL_MOTION);
	});

	it("again after every restart of the TUI; Pi's disable on stop is unchanged", () => {
		load();
		const terminal = new FakeTerminal();
		run(new TuiAltScreen(terminal, false), 2);
		for (const n of [1, 2, 3]) assert.equal(terminal.afterStart(n), ALL_MOTION, `start ${n}`);
		const all = terminal.log.join("");
		assert.equal(count(all, DISABLE), 3, "Pi disables on every stop");
		assert.equal(count(all, ALL_MOTION), 3 + 3, "Pi's write and ours, three starts");
	});

	it("a TUI with mouse switched off gets no mouse commands", () => {
		load();
		const terminal = new FakeTerminal();
		run(new TuiAltScreen(terminal, false, undefined, { mouse: false }));
		assert.equal(count(terminal.log.join(""), PREFIX), 0);
	});

	it("regular mode (TuiMainScreen) is untouched and writes no mouse command", () => {
		load();
		const terminal = new FakeTerminal();
		run(new TuiMainScreen(terminal, false));
		assert.equal(count(terminal.log.join(""), "\x1b[?1000"), 0);
		assert.ok(!Object.hasOwn(TuiMainScreen.prototype, "afterTerminalStart"));
	});

	it("model of ConPTY losing what precedes terminal.start: the host sees 0 commands stock and 1 with the extension", () => {
		const stock = new ConptyTerminal();
		run(new TuiAltScreen(stock, false));
		assert.equal(count(stock.host, PREFIX), 0);
		assert.ok(count(stock.log.join(""), PREFIX) === 1, "Pi did write it, but too early");
		load();
		const fixed = new ConptyTerminal();
		run(new TuiAltScreen(fixed, false));
		assert.equal(count(fixed.host, PREFIX), 1);
		assert.ok(fixed.host.includes(ALL_MOTION));
	});
});

describe("RQW-mouse: other platforms and loading", () => {
	for (const platform of ["darwin", "linux"]) {
		it(`${platform}: stock Pi, no patch, nothing extra written`, () => {
			load(platform);
			assert.ok(pristine());
			const terminal = new FakeTerminal();
			run(new TuiAltScreen(terminal, false));
			assert.equal(count(terminal.log.join(""), PREFIX), 1, "only Pi's own write");
			assert.equal(terminal.running(1).includes(PREFIX), false);
		});
	}

	it("reference count: the patch stays until the last owner shuts down, in either order, and a repeated shutdown changes nothing", () => {
		const a = load();
		const b = load();
		assert.ok(!pristine());
		a();
		a();
		const terminal = new FakeTerminal();
		run(new TuiAltScreen(terminal, false));
		assert.equal(count(terminal.running(1), PREFIX), 1, "B still owns it");
		b();
		assert.ok(pristine(), "the prototype is as Pi made it");
		const stock = new FakeTerminal();
		run(new TuiAltScreen(stock, false));
		assert.equal(stock.running(1).includes(PREFIX), false, "switched off: stock Pi");
		const c = load();
		const d = load();
		d();
		assert.ok(!pristine());
		c();
		assert.ok(pristine());
	});

	it("a /reload (shutdown, then the new factory) leaves one patch, not two", () => {
		load()();
		assert.ok(pristine());
		load();
		const terminal = new FakeTerminal();
		run(new TuiAltScreen(terminal, false));
		assert.equal(count(terminal.running(1), PREFIX), 1);
	});

	it("a hook Pi itself defines on the class still runs, and comes back exactly on removal", () => {
		const calls: string[] = [];
		const own = { value() { calls.push("pi"); }, writable: true, configurable: true, enumerable: false };
		Object.defineProperty(proto, "afterTerminalStart", own);
		try {
			const shutdown = load();
			const terminal = new FakeTerminal();
			run(new TuiAltScreen(terminal, false));
			assert.deepEqual(calls, ["pi"]);
			assert.equal(count(terminal.running(1), PREFIX), 1);
			shutdown();
			assert.equal(Object.getOwnPropertyDescriptor(proto, "afterTerminalStart")?.value, own.value);
		} finally {
			delete (proto as { afterTerminalStart?: unknown }).afterTerminalStart;
		}
	});

	it("a wrapper someone put on top stays, and ours is inert once the last owner left", () => {
		const shutdown = load();
		const ours = Object.getOwnPropertyDescriptor(proto, "afterTerminalStart")!;
		const calls: string[] = [];
		Object.defineProperty(proto, "afterTerminalStart", { ...ours, value(this: unknown) { calls.push("other"); return ours.value.call(this); } });
		try {
			shutdown();
			const terminal = new FakeTerminal();
			run(new TuiAltScreen(terminal, false));
			assert.deepEqual(calls, ["other"]);
			assert.equal(terminal.running(1).includes(PREFIX), false, "inert");
		} finally {
			delete (proto as { afterTerminalStart?: unknown }).afterTerminalStart;
		}
	});

	describe("through Pi's own resource loader and extension runner", () => {
		const tmp = mkdtempSync(join(tmpdir(), "rqw-mouse-"));
		after(() => rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));

		async function session(o: { paths?: string[]; factories?: pi.DefaultResourceLoaderOptions["extensionFactories"] }) {
			const cwd = mkdtempSync(join(tmp, "s-"));
			const loader = new pi.DefaultResourceLoader({ cwd, agentDir: cwd, additionalExtensionPaths: o.paths ?? [], extensionFactories: o.factories,
				noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
			await loader.reload();
			assert.deepEqual(loader.getExtensions().errors, []);
			const runtime = await pi.ModelRuntime.create({ authPath: join(cwd, "auth.json"), modelsPath: null, refreshOnCreate: false });
			const { session } = await pi.createAgentSession({ cwd, agentDir: cwd, modelRuntime: runtime, resourceLoader: loader,
				sessionManager: pi.SessionManager.inMemory(cwd), settingsManager: pi.SettingsManager.inMemory() });
			await session.bindExtensions({ mode: "rpc" });
			return { session, close: async () => { await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" }); session.dispose(); } };
		}

		it("the runner's session_shutdown reaches the factory's handler and removes the patch", async () => {
			// The factory runs under a simulated Windows only for its own call: Pi's loader itself must see the real platform.
			const s = await session({ factories: [(api) => withPlatform("win32", () => mouse(api))] });
			try {
				assert.ok(!pristine());
				const terminal = new FakeTerminal();
				run(new TuiAltScreen(terminal, false));
				assert.equal(terminal.afterStart(1), ALL_MOTION);
			} finally { await s.close(); }
			assert.ok(pristine());
		});

		it("the jiti loader hands an extension file the same TuiAltScreen class that Pi's TUI uses", async () => {
			const probe = join(tmp, "probe.ts");
			writeFileSync(probe, 'import { TuiAltScreen } from "@earendil-works/pi-tui";\nexport default () => { (globalThis as any).__rqwMouseProbe = TuiAltScreen; };\n');
			const s = await session({ paths: [probe] });
			try { assert.equal((globalThis as { __rqwMouseProbe?: unknown }).__rqwMouseProbe, TuiAltScreen); } finally {
				delete (globalThis as { __rqwMouseProbe?: unknown }).__rqwMouseProbe;
				await s.close();
			}
		});

		it("the extension file loads without errors; on Windows it patches the class, elsewhere it changes nothing", async () => {
			const s = await session({ paths: [EXTENSION] });
			try {
				assert.equal(pristine(), process.platform !== "win32");
				if (process.platform === "win32") {
					const terminal = new FakeTerminal();
					run(new TuiAltScreen(terminal, false));
					assert.equal(terminal.afterStart(1), ALL_MOTION);
				}
			} finally { await s.close(); }
			assert.ok(pristine());
		});
	});
});
