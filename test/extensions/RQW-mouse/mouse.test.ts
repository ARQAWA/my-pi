import assert from "node:assert/strict";
import { afterEach, beforeEach, it } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { TuiAltScreen, TuiMainScreen, type Terminal } from "@earendil-works/pi-tui";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import mouse from "../../../extensions/RQW-mouse/index.ts";

const root = new URL("../../../", import.meta.url);
const loader = await import(new URL("node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js", root).href);
const proto = TuiAltScreen.prototype as unknown as { afterTerminalStart?: () => void };
const ENABLE_PATTERN = /\x1b\[\?1000h.*?\x1b\[\?1006h/;
const DISABLE = "\x1b[?1006l\x1b[?1004l\x1b[?1003l\x1b[?1002l\x1b[?1000l";
const shutdowns: (() => void)[] = [];
const environmentKeys = ["TMUX", "ZELLIJ", "STY", "TERM"];
const savedEnvironment = new Map<string, string | undefined>();
// These hooks also run for tests of other files that share the process; the prototype check belongs to this file's own tests.
let loadedHere = false;
beforeEach(() => {
	for (const key of environmentKeys) {
		savedEnvironment.set(key, process.env[key]);
		delete process.env[key];
	}
});
afterEach(() => {
	while (shutdowns.length) shutdowns.pop()!();
	for (const key of environmentKeys) {
		const value = savedEnvironment.get(key);
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	savedEnvironment.clear();
	if (!loadedHere) return;
	loadedHere = false;
	assert.equal(Object.getOwnPropertyDescriptor(proto, "afterTerminalStart"), undefined);
});

function setPlatform(value: string) {
	const descriptor = Object.getOwnPropertyDescriptor(process, "platform")!;
	Object.defineProperty(process, "platform", { ...descriptor, value });
	return () => Object.defineProperty(process, "platform", descriptor);
}

/** Runs the extension's factory as one owner; returns that owner's session_shutdown handler. */
function load(platform = "win32") {
	let shutdown = () => {};
	loadedHere = true;
	const restore = setPlatform(platform);
	try {
		mouse({ on: (name: string, handler: () => void) => { if (name === "session_shutdown") shutdown = handler; } } as unknown as ExtensionAPI);
	} finally { restore(); }
	shutdowns.push(shutdown);
	return shutdown;
}

function fakeTerminal(log: string[]) {
	return {
		start() { log.push("start"); }, stop() { log.push("stop"); }, async drainInput() {}, write: (data: string) => log.push(data),
		columns: 80, rows: 20, kittyProtocolActive: false,
		moveBy() {}, hideCursor() {}, showCursor() {}, clearLine() {}, clearFromCursor() {}, clearScreen() {},
		setTitle() {}, setProgress() {}, setProgramStatus() {},
	} as unknown as Terminal;
}

/** Starts and stops a fullscreen screen `cycles` times and returns everything written to the terminal. */
function run(options: { mouse?: boolean } = {}, cycles = 1) {
	const log: string[] = [];
	const screen = new TuiAltScreen(fakeTerminal(log), false, undefined, options);
	for (let i = 0; i < cycles; i++) {
		screen.start();
		screen.stop();
	}
	return log;
}

/** The mouse-enable sets written directly after a terminal start. */
function repeats(log: string[]) {
	return log.flatMap((entry, i) => (log[i - 1] === "start" && ENABLE_PATTERN.test(entry) ? [entry] : []));
}

const environments: { name: string; env: Record<string, string>; anyMotion: boolean }[] = [
	{ name: "plain terminal", env: { TERM: "xterm-256color" }, anyMotion: true },
	{ name: "tmux variable", env: { TMUX: "/tmp/tmux" }, anyMotion: false },
	{ name: "zellij variable", env: { ZELLIJ: "0" }, anyMotion: false },
	{ name: "screen variable", env: { STY: "1.pts" }, anyMotion: false },
	{ name: "tmux TERM", env: { TERM: "tmux-256color" }, anyMotion: false },
	{ name: "screen TERM", env: { TERM: "Screen" }, anyMotion: false },
];

for (const { name, env, anyMotion } of environments) {
	it(`Windows repeats Pi's own mouse set right after terminal start: ${name}`, () => {
		Object.assign(process.env, env);
		load();
		const log = run();
		const piSet = log[0]!.match(ENABLE_PATTERN)![0];
		assert.equal(piSet.includes("\x1b[?1003h"), anyMotion);
		assert.deepEqual(repeats(log), [piSet]);
	});
}

it("Windows repeats after every restart and Pi's disable runs on every stop", () => {
	load();
	const log = run({}, 2);
	assert.equal(repeats(log).length, 2);
	assert.equal(log.filter(entry => entry.includes(DISABLE)).length, 2);
});

it("nothing is added with the mouse off", () => {
	load();
	assert.equal(run({ mouse: false }).join("").includes("\x1b[?1000h"), false);
});

it("nothing is added in regular mode", () => {
	load();
	const log: string[] = [];
	const screen = new TuiMainScreen(fakeTerminal(log), false);
	screen.start();
	screen.stop();
	assert.equal(log.join("").includes("\x1b[?1000h"), false);
});

it("other platforms keep stock behavior", () => {
	load("darwin");
	assert.equal(run().join("").split("\x1b[?1000h").length - 1, 1);
	assert.equal(Object.getOwnPropertyDescriptor(proto, "afterTerminalStart"), undefined);
});

it("the patch stays until the last of two owners leaves, in either order", () => {
	for (const firstLeaves of [0, 1]) {
		const owners = [load(), load()];
		owners[firstLeaves]!();
		assert.equal(repeats(run()).length, 1);
		owners[1 - firstLeaves]!();
		assert.equal(Object.getOwnPropertyDescriptor(proto, "afterTerminalStart"), undefined);
		assert.equal(repeats(run()).length, 0);
	}
});

it("a reload patches again once, without doubling the repeat", () => {
	load()();
	assert.equal(repeats(run()).length, 0);
	load();
	assert.equal(repeats(run()).length, 1);
});

it("a hook Pi defines on the class itself runs first and comes back after the last owner", () => {
	const calls: string[] = [];
	const own = function () { calls.push("pi"); };
	Object.defineProperty(proto, "afterTerminalStart", { value: own, writable: true, configurable: true });
	try {
		const shutdown = load();
		assert.equal(repeats(run()).length, 1);
		assert.deepEqual(calls, ["pi"]);
		shutdown();
		assert.equal(proto.afterTerminalStart, own);
	} finally { delete proto.afterTerminalStart; }
});

it("a hook Pi defines as a getter is left unpatched", () => {
	const getter = { configurable: true, get: () => function () {} };
	Object.defineProperty(proto, "afterTerminalStart", getter);
	try {
		assert.throws(() => load(), /RQW-mouse/);
		assert.equal(Object.getOwnPropertyDescriptor(proto, "afterTerminalStart")?.get, getter.get);
	} finally { delete proto.afterTerminalStart; }
});

it("a hook Pi defines as non-configurable is left unpatched", () => {
	// Such a property can never be deleted again, so this one runs in its own short process.
	const script = [
		`import { TuiAltScreen } from "@earendil-works/pi-tui";`,
		`import mouse from ${JSON.stringify(new URL("extensions/RQW-mouse/index.ts", root).href)};`,
		`const frozen = function () {};`,
		`Object.defineProperty(TuiAltScreen.prototype, "afterTerminalStart", { value: frozen, configurable: false });`,
		`Object.defineProperty(process, "platform", { value: "win32" });`,
		`try { mouse({ on() {} }); } catch (error) { console.log(String(error.message)); }`,
		`console.log(TuiAltScreen.prototype.afterTerminalStart === frozen);`,
	].join("\n");
	const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], { cwd: fileURLToPath(root), encoding: "utf8" });
	assert.equal(result.status, 0, result.stderr);
	const [message, unchanged] = result.stdout.trim().split("\n");
	assert.match(message!, /RQW-mouse/);
	assert.equal(unchanged, "true");
});

it("a foreign wrapper on top stays in place and the inner patch goes inert", () => {
	const shutdown = load();
	const patched = proto.afterTerminalStart!;
	let foreignCalls = 0;
	const foreign = function (this: unknown) { foreignCalls++; patched.call(this as never); };
	Object.defineProperty(proto, "afterTerminalStart", { value: foreign, writable: true, configurable: true });
	try {
		assert.equal(repeats(run()).length, 1);
		shutdown();
		assert.equal(proto.afterTerminalStart, foreign);
		assert.equal(repeats(run()).length, 0);
		assert.equal(foreignCalls, 2);
	} finally { delete proto.afterTerminalStart; }
});

it("loading through Pi's resource loader patches the same TUI class and shutdown restores it", async () => {
	// The loader breaks when the platform is faked during the load, so a one-file wrapper fakes it only around the factory.
	const dir = mkdtempSync(join(tmpdir(), "rqw-mouse-"));
	const entry = join(dir, "wrapper.ts");
	const index = fileURLToPath(new URL("extensions/RQW-mouse/index.ts", root));
	writeFileSync(entry, [
		`import mouse from ${JSON.stringify(pathToFileURL(index).href)};`,
		"export default function (pi: never) {",
		"\tconst descriptor = Object.getOwnPropertyDescriptor(process, 'platform')!;",
		"\tObject.defineProperty(process, 'platform', { ...descriptor, value: 'win32' });",
		"\ttry { mouse(pi); } finally { Object.defineProperty(process, 'platform', descriptor); }",
		"}",
	].join("\n"));
	try {
		const loaded = await loader.loadExtensions([entry], dir);
		assert.deepEqual(loaded.errors, []);
		const handlers: (() => void)[] = loaded.extensions[0].handlers.get("session_shutdown");
		shutdowns.push(() => handlers.forEach(handler => handler()));
		assert.equal(repeats(run()).length, 1);
		handlers.forEach(handler => handler());
		assert.equal(Object.getOwnPropertyDescriptor(proto, "afterTerminalStart"), undefined);
	} finally { rmSync(dir, { recursive: true, force: true }); }
});
