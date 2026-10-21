// Scope-resolution epochs use explicit gates, not elapsed time or rescheduling.
import assert from "node:assert/strict";
import test from "node:test";
import { createBarrier, type Scope } from "../barrier.ts";

const ALL: Scope = { kind: "all", keys: [] };
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

function gate() {
  let release!: () => void;
  const open = new Promise<void>((resolve) => { release = resolve; });
  return { open, release };
}

test("late scopes wait for earlier all, keep registration order and allow independent work", { timeout: 5000 }, async () => {
  const schedule = createBarrier();
  const allGate = gate();
  const writeGate = gate();
  const readGate = gate();
  const events: string[] = [];
  let target = "/old/f";
  const late = (id: string, kind: "read" | "mutate", key: () => string): Scope => ({
    kind: "all", keys: [], resolve: () => {
      events.push(`${id}:resolve`);
      return { kind, keys: [key()] };
    },
  });
  const all = schedule(ALL, async () => {
    events.push("all:start");
    await allGate.open;
    target = "/next/f";
    events.push("all:end");
  });
  const write = schedule(late("write", "mutate", () => target), async () => {
    events.push("write:start");
    await writeGate.open;
    events.push("write:end");
  });
  const read = schedule(late("read", "read", () => "/next/f"), async () => { events.push("read:start"); });
  const independent = schedule(late("independent", "mutate", () => "/other/f"), async () => { events.push("independent:start"); });
  const r1 = schedule(late("r1", "read", () => "/read/f"), async () => {
    events.push("r1:start");
    await readGate.open;
  });
  const r2 = schedule(late("r2", "read", () => "/read/f"), async () => {
    events.push("r2:start");
    await readGate.open;
  });
  try {
    await tick();
    assert.deepEqual(events, ["all:start"], "no filesystem scope is computed before the earlier all settles");
    allGate.release();
    await tick();
    assert.deepEqual(events.filter((x) => x.endsWith(":resolve")), ["write:resolve", "read:resolve", "independent:resolve", "r1:resolve", "r2:resolve"]);
    assert.ok(events.includes("write:start"));
    assert.ok(!events.includes("read:start"), "new canonical target conflicts with the earlier write");
    assert.ok(events.includes("independent:start"), "independent mutation overlaps the held write");
    assert.ok(events.includes("r1:start") && events.includes("r2:start"), "read/read overlap");
  } finally {
    allGate.release();
    writeGate.release();
    readGate.release();
    await Promise.all([all, write, read, independent, r1, r2]);
  }
  assert.ok(events.indexOf("read:start") > events.indexOf("write:end"));
});

test("several all epochs resolve only once, in invocation order, including later registrations", { timeout: 5000 }, async () => {
  const schedule = createBarrier();
  const firstGate = gate();
  const secondGate = gate();
  const events: string[] = [];
  let epoch = 0;
  const late = (id: string): Scope => ({ kind: "all", keys: [], resolve: () => {
    events.push(`${id}:resolve:${epoch}`);
    return { kind: "mutate", keys: [`/epoch${epoch}`] };
  } });
  const first = schedule(ALL, async () => { await firstGate.open; epoch = 1; });
  const a = schedule(late("a"), async () => { events.push("a:run"); });
  const second = schedule(ALL, async () => {
    events.push("second:start");
    await secondGate.open;
    epoch = 2;
  });
  const b = schedule(late("b"), async () => { events.push("b:run"); });
  await tick();
  const c = schedule(late("c"), async () => { events.push("c:run"); });
  try {
    assert.deepEqual(events, []);
    firstGate.release();
    await tick();
    assert.deepEqual(events, ["a:resolve:1", "a:run", "second:start"]);
    secondGate.release();
  } finally {
    firstGate.release();
    secondGate.release();
    await Promise.all([first, a, second, b, c]);
  }
  assert.deepEqual(events, ["a:resolve:1", "a:run", "second:start", "b:resolve:2", "c:resolve:2", "b:run", "c:run"]);
});

test("a late scope that becomes all holds later resolution until it settles, even on rejection", { timeout: 5000 }, async () => {
  const schedule = createBarrier();
  const hold = gate();
  const events: string[] = [];
  const first = schedule({ kind: "read", keys: [], resolve: () => ALL }, async () => {
    events.push("all:start");
    await hold.open;
    events.push("all:end");
    throw new Error("all failed");
  });
  const rejected = assert.rejects(first, /all failed/);
  const second = schedule({ kind: "all", keys: [], resolve: () => {
    events.push("next:resolve");
    return { kind: "read", keys: ["/next"] };
  } }, async () => { events.push("next:run"); });
  try {
    await tick();
    assert.deepEqual(events, ["all:start"]);
  } finally {
    hold.release();
    await Promise.all([rejected, second]);
  }
  assert.deepEqual(events, ["all:start", "all:end", "next:resolve", "next:run"]);
});

test("a throwing resolver waits for earlier work, rejects its own call and releases later scopes", { timeout: 5000 }, async () => {
  const schedule = createBarrier();
  const hold = gate();
  const events: string[] = [];
  const first = schedule({ kind: "mutate", keys: ["/a"] }, async () => {
    events.push("first:start");
    await hold.open;
    events.push("first:end");
  });
  const bad = schedule({ kind: "read", keys: [], resolve: () => { throw new Error("bad scope"); } }, async () => {
    assert.fail("a throwing resolver must not execute the operation");
  });
  const rejected = assert.rejects(bad, /bad scope/);
  const next = schedule({ kind: "all", keys: [], resolve: () => {
    events.push("next:resolve");
    return { kind: "read", keys: ["/b"] };
  } }, async () => { events.push("next:run"); });
  try {
    await tick();
    assert.deepEqual(events, ["first:start"]);
  } finally {
    hold.release();
    await Promise.all([first, rejected, next]);
  }
  assert.deepEqual(events, ["first:start", "first:end", "next:resolve", "next:run"]);
});
