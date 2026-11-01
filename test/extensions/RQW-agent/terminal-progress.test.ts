import assert from "node:assert/strict";
import { test } from "node:test";
import { createEventBus } from "@earendil-works/pi-coding-agent";
import { formatProgramStatus, ProcessTerminal } from "@earendil-works/pi-tui";
import { registerRunningCounts } from "../../../extensions/RQW-agent/running-counts.ts";
import { registerTerminalActivity } from "../../../extensions/RQW-agent/terminal-progress.ts";

function rig(t: any) {
	const events = createEventBus();
	let value = 0, changed = (_value: unknown) => {};
	const source = { version: 1, snapshot: () => ({ backgroundProcesses: value }), subscribe(fn: typeof changed) { changed = fn; return () => {}; } };
	events.on("rqw:running-counts:request", (request: any) => request.reply(source));
	const hooks = new Map<string, Function[]>();
	const pi: any = { events, on(name: string, fn: Function) { hooks.set(name, [...hooks.get(name) ?? [], fn]); } };
	registerTerminalActivity(pi, registerRunningCounts(pi));
	const fire = (name: string) => { for (const fn of hooks.get(name) ?? []) fn({}, { mode: "tui" }); };
	fire("session_start"); t.after(() => fire("session_shutdown"));
	return { set(valueNext: number) { value = valueNext; changed(source.snapshot()); } };
}

test("terminal shows the native open wait and background starting after final", t => {
	const writes: string[] = [];
	t.mock.method(process.stdout, "write", (chunk: string) => { writes.push(String(chunk)); return true; });
	const f = rig(t);
	const term = new ProcessTerminal();
	t.after(() => (term as any).clearProgressInterval());
	(term as any).programStatusSupported = true;
	const working = { state: "working", app: "pi" } as const;
	const done = { state: "done", app: "pi" } as const;
	term.setProgress(true); term.setProgramStatus(working);
	assert.ok(writes.includes(formatProgramStatus(working)), "native wait is working");
	term.setProgress(false); term.setProgramStatus(done);
	assert.ok(writes.includes(formatProgramStatus(done)));
	writes.length = 0; f.set(1);
	assert.ok(writes.includes("\x1b]9;4;3\x07"));
	assert.ok(writes.includes(formatProgramStatus(working)));
	writes.length = 0; f.set(0);
	assert.ok(writes.includes("\x1b]9;4;0\x07"));
	assert.ok(writes.includes(formatProgramStatus(done)));
});

test("native activity and running counts independently keep terminal working", t => {
	const writes: string[] = [];
	t.mock.method(process.stdout, "write", (chunk: string) => { writes.push(String(chunk)); return true; });
	const f = rig(t);
	const term = new ProcessTerminal();
	t.after(() => (term as any).clearProgressInterval());
	(term as any).programStatusSupported = true;
	const working = { state: "working", app: "pi" } as const;
	const done = { state: "done", app: "pi" } as const;
	term.setProgress(true); term.setProgramStatus(working);
	f.set(1);
	term.setProgress(false); term.setProgramStatus(done);
	assert.equal(writes.at(-1), formatProgramStatus(working));
	writes.length = 0;
	term.setProgress(true); term.setProgramStatus(working);
	f.set(0);
	assert.equal(writes.at(-1), formatProgramStatus(working));
	assert.ok(!writes.includes("\x1b]9;4;0\x07"));
	term.setProgress(false); term.setProgramStatus(done);
	assert.equal(writes.at(-1), formatProgramStatus(done));
});

test("unsupported terminal shape keeps stock methods and restores the prototype", t => {
	const proto = ProcessTerminal.prototype;
	const own = Object.getOwnPropertyDescriptor(proto, "setProgress")!;
	Object.defineProperty(proto, "setProgress", { ...own, value: undefined });
	t.after(() => Object.defineProperty(proto, "setProgress", own));
	const start = proto.start;
	rig(t);
	assert.equal(proto.start, start);
});

test("shutdown restores all patched terminal methods", () => {
	const proto = ProcessTerminal.prototype;
	const originals = [proto.start, proto.setProgress, proto.setProgramStatus];
	const events = createEventBus(); const hooks = new Map<string, Function[]>();
	const pi: any = { events, on(name: string, fn: Function) { hooks.set(name, [...hooks.get(name) ?? [], fn]); } };
	registerTerminalActivity(pi, registerRunningCounts(pi));
	for (const fn of hooks.get("session_start") ?? []) fn({}, { mode: "tui" });
	for (const fn of hooks.get("session_shutdown") ?? []) fn({}, {});
	assert.deepEqual([proto.start, proto.setProgress, proto.setProgramStatus], originals);
});
