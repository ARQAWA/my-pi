import { strict as assert } from "node:assert";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import submitTiming, { instrument } from "../scripts/submit-timing/index.ts";

function harness(write?: (line: any) => void) {
  let time = 0;
  const handlers = new Map<string, ((...args: any[]) => any)[]>();
  const events = new EventEmitter();
  const pi = { events, on(event: string, handler: (...args: any[]) => any) {
    const list = handlers.get(event) ?? []; list.push(handler); handlers.set(event, list);
  } };
  let key: (data: string) => void = () => {};
  let frame: any;
  const controller = new AbortController();
  const ctx = { hasUI: true, signal: controller.signal, ui: {
    getEditorText: () => "hello",
    onTerminalInput: (fn: typeof key) => { key = fn; return () => {}; },
    setWidget: (_name: string, factory: any) => { if (factory) frame = factory(); },
  } };
  const lines: any[] = [];
  const pending: (() => void)[] = [];
  const timing = instrument(pi, { now: () => time, utilization: () => ({ utilization: 0.5 }) }, write ?? (line => lines.push(line)), fn => pending.push(fn));
  return { pi, events, ctx, controller, lines, timing, advance: (ms: number) => { time += ms; },
    key: () => key("\r"), render: () => frame.render(), flush: () => { for (const fn of pending.splice(0)) fn(); },
    emit: async (event: string, value: any = {}) => { for (const handler of handlers.get(event) ?? []) {
      const result = await handler(value, ctx);
      if (event === "input" && result?.action === "handled") return result;
    } },
  };
}

test("records handlers and Pi steps through the user message without writing during the frame", async () => {
  const h = harness();
  h.timing.wrap("first").on("input", () => { h.advance(3); });
  h.timing.wrap("second").on("input", async () => { h.advance(5); });
  h.timing.wrap("message").on("message_start", () => { h.advance(4); });
  h.timing.endMarkers();
  await h.emit("session_start");
  h.events.emit("rqw:running-counts:offer", { version: 1, source: { version: 1, snapshot: () => ({ agents: 2, reviews: 1 }) } });
  h.key();
  await h.emit("input", { source: "interactive" });
  h.advance(2); await h.emit("session_before_compact");
  h.advance(10); await h.emit("session_compact");
  h.advance(4); await h.emit("before_agent_start");
  h.advance(6); await h.emit("agent_start");
  h.advance(7); await h.emit("message_start", { message: { role: "user" } });
  h.advance(8); h.render(); h.render();
  assert.equal(h.lines.length, 0);
  h.flush();
  assert.equal(h.lines.length, 1);
  assert.deepEqual(h.lines[0].handlers.map((x: any) => [x.extension, x.event, x.ms]), [["first", "input", 3], ["second", "input", 5], ["message", "message_start", 4]]);
  assert.equal(h.lines[0].pi.compactionMs, 10);
  assert.equal(h.lines[0].pi.authAndTemplatesMs, 2);
  assert.equal(h.lines[0].pi.agentToMessageMs, 7);
  assert.equal(h.lines[0].enterToFrameMs, 49);
  assert.equal(h.lines[0].first, true);
  assert.deepEqual(h.lines[0].running, { agents: 2, reviews: 1 });
});

test("handled, abort and agent end finish without waiting for another submit", async () => {
  const h = harness();
  h.timing.wrap("handler").on("input", (event: any) => event.handled ? { action: "handled" } : undefined);
  h.timing.endMarkers();
  await h.emit("session_start"); h.key();
  assert.deepEqual(await h.emit("input", { source: "interactive", handled: true }), { action: "handled" });
  assert.equal(h.lines[0].outcome, "handled");
  h.key(); await h.emit("input", { source: "interactive" }); await h.emit("before_agent_start");
  h.controller.abort(); assert.equal(h.lines[1].outcome, "abort");
  const other = harness(); other.timing.endMarkers();
  await other.emit("session_start"); other.key(); await other.emit("input", { source: "interactive" });
  await other.emit("agent_end"); assert.equal(other.lines[0].outcome, "agent_end");
});

test("shutdown writes unfinished and deferred frame records synchronously", async () => {
  const unfinished = harness(); unfinished.timing.endMarkers();
  await unfinished.emit("session_start"); unfinished.key();
  await unfinished.emit("input", { source: "interactive" });
  await unfinished.emit("session_shutdown");
  assert.equal(unfinished.lines[0].outcome, "shutdown");
  unfinished.flush(); assert.equal(unfinished.lines.length, 1);

  const framed = harness(); framed.timing.endMarkers();
  await framed.emit("session_start"); framed.key();
  await framed.emit("input", { source: "interactive" });
  await framed.emit("message_start", { message: { role: "user" } });
  framed.render(); assert.equal(framed.lines.length, 0);
  await framed.emit("session_shutdown");
  assert.equal(framed.lines[0].outcome, "frame");
  framed.flush(); assert.equal(framed.lines.length, 1);
});

test("write failure cannot change a handled input result", async () => {
  const h = harness(() => { throw new Error("disk failure"); });
  h.timing.wrap("handler").on("input", () => ({ action: "handled" })); h.timing.endMarkers();
  await h.emit("session_start"); h.key();
  assert.deepEqual(await h.emit("input", { source: "interactive" }), { action: "handled" });
  assert.doesNotThrow(() => h.flush());
});

test("normal extension loading disables the instrument before registration", async () => {
  let registered = false;
  const previous = console.warn;
  const warnings: string[] = [];
  console.warn = (...args: any[]) => { warnings.push(args.join(" ")); };
  try { await submitTiming({ on() { registered = true; } }); } finally { console.warn = previous; }
  assert.equal(registered, false);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /pi -ne -e/);
});
