import assert from "node:assert/strict";
import { afterEach, beforeEach, it } from "node:test";
import { TuiAltScreen, type Terminal } from "@earendil-works/pi-tui";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import mouse from "../../../extensions/RQW-mouse/index.ts";

const ENABLE = "\x1b[?1000h\x1b[?1002h\x1b[?1003h\x1b[?1004h\x1b[?1006h";
const shutdowns: (() => void)[] = [];
const environmentKeys = ["TMUX", "ZELLIJ", "STY", "TERM"];
const savedEnvironment = new Map<string, string | undefined>();
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
});

function load(platform: string) {
	const descriptor = Object.getOwnPropertyDescriptor(process, "platform")!;
	let shutdown = () => {};
	Object.defineProperty(process, "platform", { ...descriptor, value: platform });
	try {
		mouse({ on: (name: string, handler: () => void) => { if (name === "session_shutdown") shutdown = handler; } } as unknown as ExtensionAPI);
	} finally { Object.defineProperty(process, "platform", descriptor); }
	shutdowns.push(shutdown);
}

function run() {
	const log: string[] = [];
	const terminal = {
		start() { log.push("start"); }, stop() {}, async drainInput() {}, write: (data: string) => log.push(data),
		columns: 80, rows: 20, kittyProtocolActive: false,
		moveBy() {}, hideCursor() {}, showCursor() {}, clearLine() {}, clearFromCursor() {}, clearScreen() {},
		setTitle() {}, setProgress() {}, setProgramStatus() {},
	} as unknown as Terminal;
	const screen = new TuiAltScreen(terminal, false);
	screen.start();
	screen.stop();
	return log;
}

it("Windows repeats mouse reporting immediately after terminal start", () => {
	load("win32");
	const log = run();
	assert.equal(log[log.indexOf("start") + 1], ENABLE);
	assert.equal(log.join("").split("\x1b[?1000h").length - 1, 2);
});

it("other platforms keep stock behavior", () => {
	load("darwin");
	const log = run();
	assert.equal(log.join("").split("\x1b[?1000h").length - 1, 1);
});
