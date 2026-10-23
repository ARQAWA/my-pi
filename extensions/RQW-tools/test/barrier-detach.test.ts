// Detach in the ordered barrier (D4, DECISIONS.md Tools «Background jobs»): a detached call stops holding calls
// registered after the detach; calls registered before it keep waiting for its real end. Held operations and an
// independent oracle, no timers: after promise reactions drain, exactly the calls without an unfinished blocking
// earlier call must have started. RQW_SEED and RQW_ROUNDS change the randomized test (defaults 1 and 500).
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { createBarrier, type Detachable, type Scope } from "../barrier.ts";
import { createNestedBarrier } from "../nested.ts";

const R = (...keys: string[]): Scope => ({ kind: "read", keys });
const M = (...keys: string[]): Scope => ({ kind: "mutate", keys });
const B: Scope = { kind: "all", keys: [] };

const within = (dir: string, p: string) => {
  const rel = path.posix.relative(dir, p);
  return rel === "" || (rel !== ".." && !rel.startsWith("../") && !path.posix.isAbsolute(rel));
};
function conflicts(a: Scope, b: Scope): boolean {
  if (a.kind === "all" || b.kind === "all") return true;
  if (a.kind === "read" && b.kind === "read") return false;
  return a.keys.some((x) => b.keys.some((y) => within(x, y) || within(y, x)));
}

const drain = async () => { for (let i = 0; i < 50; i++) await new Promise<void>((r) => setImmediate(r)); };

type Op = { i: number; scope: Scope; handle: Detachable; started: boolean; finished: boolean; release: () => void; detachedAt?: number };

function harness() {
  const schedule = createBarrier();
  const ops: Op[] = [];
  let clock = 0; // registration counter; detach records the count at its moment
  function add(scope: Scope) {
    const gate = Promise.withResolvers<void>();
    const op: Op = { i: ops.length, scope, handle: {}, started: false, finished: false, release: () => gate.resolve() };
    ops.push(op);
    clock++;
    void schedule(scope, async () => { op.started = true; await gate.promise; }, op.handle).finally(() => { op.finished = true; });
    return op;
  }
  function detach(op: Op) { op.detachedAt = clock; op.handle.detach!(); }
  // Oracle: op b may start once every earlier conflicting op a has finished, except an a detached before b registered.
  function expected(b: Op) {
    return ops.every((a) => a.i >= b.i || !conflicts(a.scope, b.scope) || a.finished || (a.detachedAt !== undefined && a.detachedAt <= b.i));
  }
  async function check(label: string) {
    await drain();
    for (const op of ops) {
      if (op.finished) continue;
      assert.equal(op.started, expected(op), `${label}: op${op.i} (${op.scope.kind} ${op.scope.keys.join(",")})`);
    }
  }
  return { ops, add, detach, check };
}

test("a detached bash stops holding later calls; calls registered before still wait for its end", async () => {
  const h = harness();
  const server = h.add(B);
  const sameResponse = h.add(M("/a"));
  await h.check("before detach");
  assert.equal(sameResponse.started, false);
  h.detach(server);
  const later = h.add(M("/b"));
  const laterBash = h.add(B);
  await h.check("after detach");
  assert.equal(later.started, true, "a later call runs while the job runs");
  assert.equal(sameResponse.started, false, "the same-response call still waits for the job");
  assert.equal(laterBash.started, false, "a later bash still waits for the live calls it conflicts with (the queued edit)");
  server.release();
  await h.check("after end");
  assert.equal(sameResponse.started, true);
  for (const op of h.ops) op.release();
});

test("a file call queued behind a detached job keeps its path for later calls of the same path", async () => {
  const h = harness();
  const server = h.add(B);
  const edit = h.add(M("/p"));
  h.detach(server);
  const laterEdit = h.add(M("/p"));
  const laterOther = h.add(M("/q"));
  await h.check("queued edit");
  assert.equal(laterEdit.started, false, "the later edit of /p follows the queued edit");
  assert.equal(laterOther.started, true);
  server.release();
  await h.check("server ended");
  assert.equal(edit.started, true);
  edit.release();
  await h.check("edit ended");
  assert.equal(laterEdit.started, true);
  for (const op of h.ops) op.release();
});

test("scope resolution of later calls is not held by a detached all call", async () => {
  const schedule = createBarrier();
  const gate = Promise.withResolvers<void>();
  const handle: Detachable = {};
  void schedule(B, () => gate.promise, handle);
  let resolved = false;
  const later = { kind: "all" as const, keys: [], resolve: () => { resolved = true; return M("/x"); } };
  handle.detach!();
  let ran = false;
  const done = schedule(later, async () => { ran = true; });
  await drain();
  assert.equal(resolved, true);
  assert.equal(ran, true);
  await done;
  gate.resolve();
});

test("randomized: detach never releases earlier-registered calls and always releases later ones", async () => {
  const seed0 = Number(process.env.RQW_SEED ?? 1);
  const rounds = Number(process.env.RQW_ROUNDS ?? 500);
  let seed = seed0;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
  const paths = ["/a", "/a/b", "/c", "/c/d/e", "/f"];
  const scopeOf = (): Scope => {
    const r = rnd();
    const key = paths[Math.floor(rnd() * paths.length)];
    return r < 0.25 ? B : r < 0.6 ? R(key) : M(key);
  };
  for (let round = 0; round < rounds; round++) {
    const h = harness();
    for (let step = 0; step < 12; step++) {
      const r = rnd();
      const open = h.ops.filter((o) => !o.finished);
      if (r < 0.5 || !open.length) h.add(scopeOf());
      else if (r < 0.7) {
        const candidates = open.filter((o) => o.detachedAt === undefined);
        if (candidates.length) h.detach(candidates[Math.floor(rnd() * candidates.length)]);
      } else {
        const started = open.filter((o) => o.started);
        if (started.length) started[Math.floor(rnd() * started.length)].release();
      }
      await h.check(`seed ${seed0} round ${round} step ${step}`);
    }
    for (const op of h.ops) op.release();
    await drain();
  }
});

test("nested: a detached codemode group stops holding later outer calls; its own script calls keep their order", async () => {
  const nested = createNestedBarrier();
  const script = Promise.withResolvers<void>();
  const handle: Detachable = {};
  const order: string[] = [];
  const group = nested.group("cm", async () => {
    const write = nested.schedule("cm/1", M("/p"), async () => { await script.promise; order.push("write"); });
    const read = nested.schedule("cm/2", R("/p"), async () => { order.push("read"); });
    await Promise.all([write, read]);
  }, handle);
  await drain();
  handle.detach!();
  let outer = false;
  await nested.schedule("c1", B, async () => { outer = true; });
  assert.equal(outer, true, "a later outer call runs while the script runs");
  script.resolve();
  await group;
  assert.deepEqual(order, ["write", "read"]);
});

// ---------- holds (H1): a detached job keeps what its footprint certainly holds ----------

type HeldT = { files: string[]; tags: string[] };
const X = (tags: string[], writes: string[] = []): Scope => ({ kind: "all", keys: [], explicit: { tags, writes } });
/** Independent oracle of a held entry: writes of its files, explicit uses of its tags or files; never reads. */
function heldBlocks(held: HeldT, b: Scope): boolean {
  if (b.kind === "read") return false;
  const near = (x: string, y: string) => within(x, y) || within(y, x);
  if (b.kind === "mutate") return held.files.some((x) => b.keys.some((y) => near(x, y)));
  const ex = b.explicit;
  return !!ex && (held.tags.some((t) => ex.tags.includes(t)) || held.files.some((x) => ex.writes.some((y) => near(x, y))));
}

function heldHarness() {
  const schedule = createBarrier();
  type HOp = Op & { held?: HeldT };
  const ops: HOp[] = [];
  let clock = 0;
  function add(scope: Scope) {
    const gate = Promise.withResolvers<void>();
    const op: HOp = { i: ops.length, scope, handle: {}, started: false, finished: false, release: () => gate.resolve() };
    ops.push(op);
    clock++;
    void schedule(scope, async () => { op.started = true; await gate.promise; }, op.handle).finally(() => { op.finished = true; });
    return op;
  }
  function detach(op: HOp, held?: HeldT) { op.detachedAt = clock; op.held = held; op.handle.detach!(held); }
  function expected(b: HOp) {
    return ops.every((a) => {
      if (a.i >= b.i || a.finished) return true;
      if (a.detachedAt !== undefined && a.detachedAt <= b.i) return !(a.held && (a.held.files.length || a.held.tags.length) && heldBlocks(a.held, b.scope));
      return !conflicts(a.scope, b.scope);
    });
  }
  async function check(label: string) {
    await drain();
    for (const op of ops) if (!op.finished) assert.equal(op.started, expected(op), `${label}: op${op.i}`);
  }
  return { ops, add, detach, check };
}

test("held: earlier calls wait for the real end; later calls wait only on what it holds", async () => {
  const h = heldHarness();
  const install = h.add(B);
  const same = h.add(M("/r/package.json"));
  h.detach(install, { files: ["/r/out.log"], tags: ["pkg:/r"] });
  const readLog = h.add(R("/r/out.log"));
  const editLog = h.add(M("/r/out.log"));
  const otherEdit = h.add(M("/r/src.ts"));
  const test1 = h.add(X(["pkg:/r"]));
  const writesLog = h.add(X([], ["/r/out.log"]));
  const plainBash = h.add(B);
  await h.check("held");
  assert.equal(same.started, false, "same response: real end");
  assert.equal(test1.started, false, "a later npm test waits for the install");
  assert.equal(readLog.started, true, "reads never wait for a hold");
  assert.equal(editLog.started, false);
  assert.equal(otherEdit.started, true);
  assert.equal(writesLog.started, false);
  assert.equal(plainBash.started, false, "a later bash waits for the live queued calls before it");
  install.release();
  await h.check("install ended");
  for (const op of h.ops) op.release();
  await drain();
});

test("held: a later all call without explicit keys does not wait for the hold", async () => {
  const h = heldHarness();
  const install = h.add(B);
  h.detach(install, { files: [], tags: ["pkg:/r"] });
  const make = h.add(B);
  await h.check("make");
  assert.equal(make.started, true);
  for (const op of h.ops) op.release();
  await drain();
});

test("followers (K1): same-response dependents, transitively; not later calls, not started ones", async () => {
  const h = heldHarness();
  const install = h.add(B);
  const test1 = h.add(X(["pkg:/r"]));
  const after1 = h.add(M("/r/a")); // waits for test1 (an all call)
  install.handle.handedOffAt = performance.now();
  h.detach(install, { files: [], tags: ["pkg:/r"] });
  const later = h.add(X(["pkg:/r"]));
  await h.check("queued");
  const followers = install.handle.followers!();
  assert.ok(followers.includes(test1.handle) && followers.includes(after1.handle));
  assert.ok(!followers.includes(later.handle), "a later response is not cancelled");
  install.release();
  await h.check("ended");
  assert.deepEqual(install.handle.followers!(), []);
  for (const op of h.ops) op.release();
  await drain();
});

test("randomized: detach with held keys follows the held oracle", async () => {
  const seed0 = Number(process.env.RQW_SEED ?? 1);
  const rounds = Number(process.env.RQW_ROUNDS ?? 500);
  let seed = seed0 + 99;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
  const paths = ["/a", "/a/b", "/c", "/c/d/e", "/f"];
  const tags = ["pkg:/r", "git:/r"];
  const pick = <T>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
  const scopeOf = (): Scope => {
    const r = rnd();
    return r < 0.15 ? B : r < 0.35 ? X(rnd() < 0.6 ? [pick(tags)] : [], rnd() < 0.4 ? [pick(paths)] : []) : r < 0.65 ? R(pick(paths)) : M(pick(paths));
  };
  const heldOf = (): HeldT | undefined => {
    const r = rnd();
    return r < 0.2 ? undefined : { files: rnd() < 0.5 ? [pick(paths)] : [], tags: rnd() < 0.6 ? [pick(tags)] : [] };
  };
  for (let round = 0; round < rounds; round++) {
    const h = heldHarness();
    for (let step = 0; step < 12; step++) {
      const r = rnd();
      const open = h.ops.filter((o) => !o.finished);
      if (r < 0.5 || !open.length) h.add(scopeOf());
      else if (r < 0.7) {
        const candidates = open.filter((o) => o.detachedAt === undefined);
        if (candidates.length) h.detach(pick(candidates), heldOf());
      } else {
        const started = open.filter((o) => o.started);
        if (started.length) pick(started).release();
      }
      await h.check(`seed ${seed0} round ${round} step ${step}`);
    }
    for (const op of h.ops) op.release();
    await drain();
  }
});
