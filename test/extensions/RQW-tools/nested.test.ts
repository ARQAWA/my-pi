// The nested barrier (nested.ts), without Pi: plain promises, gates that tests release by hand, and a real worker
// thread. Calls carry tool call ids the way Pi gives them: `c0` for a model call, `c0/1` for a call of its script,
// `c0/1/1` for a call made by that call. No sleeps: a call stays "running" until its gate is released, `tick()` lets
// every pending promise continuation run.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Worker } from "node:worker_threads";
import type { Scope } from "../../../extensions/RQW-tools/barrier.ts";
import { createNestedBarrier, type NestedBarrier } from "../../../extensions/RQW-tools/nested.ts";

const READ: Scope = { kind: "read", keys: ["/a"] };
const MUTATE: Scope = { kind: "mutate", keys: ["/a"] };
const OTHER_FILE: Scope = { kind: "read", keys: ["/b"] };

/** Runs every promise continuation that is ready, then returns. */
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

function gate() {
  let release!: () => void;
  const open = new Promise<void>((resolve) => (release = resolve));
  return { open, release };
}

// Watchdog: a deadlock fails the test after 5 s instead of hanging the run. This is the one real timer here.
function guard<T>(promise: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout;
  const watchdog = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("no result after 5 s (deadlock?)")), 5000);
  });
  return Promise.race([promise, watchdog]).finally(() => clearTimeout(timer));
}

/** A call `id` that logs its start, waits for `hold` (when given) and logs its end. */
function call(n: NestedBarrier, log: string[], id: string, scope: Scope, hold?: Promise<void>) {
  return n.schedule(id, scope, async () => {
    log.push(`${id}:start`);
    await hold;
    log.push(`${id}:end`);
  });
}

describe("nested barrier: outside any group it is the plain barrier", () => {
  it("a write and a read of one file keep registration order, another file overlaps", async () => {
    const n = createNestedBarrier();
    const log: string[] = [];
    const hold = gate();
    const write = call(n, log, "w", MUTATE, hold.open);
    const read = call(n, log, "r", READ);
    const other = call(n, log, "o", OTHER_FILE);
    await tick();
    assert.deepEqual(log, ["w:start", "o:start", "o:end"]);
    hold.release();
    await guard(Promise.all([write, read, other]));
    assert.deepEqual(log, ["w:start", "o:start", "o:end", "w:end", "r:start", "r:end"]);
  });

  it("groupOf() is undefined for a model call and for a nested id with no group", () => {
    const n = createNestedBarrier();
    assert.equal(n.groupOf("c0"), undefined);
    assert.equal(n.groupOf("c0/1"), undefined);
  });
});

describe("nested barrier: a group is one call with scope all in the outer barrier", () => {
  it("it waits for every earlier call and every later call waits for it", async () => {
    const n = createNestedBarrier();
    const log: string[] = [];
    const holdFirst = gate();
    const holdGroup = gate();
    const first = call(n, log, "c0", OTHER_FILE, holdFirst.open);
    const group = n.group("c1", () => call(n, log, "c1/1", READ, holdGroup.open));
    const last = call(n, log, "c2", OTHER_FILE);
    await tick();
    assert.deepEqual(log, ["c0:start"], "the group waits for the earlier call");
    holdFirst.release();
    await tick();
    assert.deepEqual(log, ["c0:start", "c0:end", "c1/1:start"], "the later call waits for the group");
    holdGroup.release();
    await guard(Promise.all([first, group, last]));
    assert.deepEqual(log, ["c0:start", "c0:end", "c1/1:start", "c1/1:end", "c2:start", "c2:end"]);
  });

  it("two groups run one after the other", async () => {
    const n = createNestedBarrier();
    const log: string[] = [];
    const holdA = gate();
    const a = n.group("c0", () => call(n, log, "c0/1", READ, holdA.open));
    const b = n.group("c1", () => call(n, log, "c1/1", READ));
    await tick();
    assert.deepEqual(log, ["c0/1:start"]);
    holdA.release();
    await guard(Promise.all([a, b]));
    assert.deepEqual(log, ["c0/1:start", "c0/1:end", "c1/1:start", "c1/1:end"]);
  });

  it("the result and a failure of the group reach the caller, and a failed group leaves the barrier", async () => {
    const n = createNestedBarrier();
    assert.equal(await n.group("c0", async () => "result"), "result");
    await assert.rejects(
      n.group("c1", async () => {
        throw new Error("script failed");
      }),
      /script failed/,
    );
    assert.equal(await guard(n.schedule("c2", MUTATE, async () => "next")), "next");
  });
});

describe("nested barrier: the calls of a group have a barrier of their own, found by the id", () => {
  it("they keep their order among themselves and never wait for the group's own entry", async () => {
    const n = createNestedBarrier();
    const log: string[] = [];
    const hold = gate();
    const done = n.group("c0", async () => {
      // started together, like Promise.all in a script: the read waits for the write
      const both = Promise.all([call(n, log, "c0/1", MUTATE, hold.open), call(n, log, "c0/2", READ)]);
      await tick();
      assert.deepEqual(log, ["c0/1:start"]);
      hold.release();
      await both;
      await call(n, log, "c0/3", MUTATE);
    });
    await guard(done);
    assert.deepEqual(log, ["c0/1:start", "c0/1:end", "c0/2:start", "c0/2:end", "c0/3:start", "c0/3:end"]);
  });

  it("a call still running when the group's function returns keeps the group open", async () => {
    const n = createNestedBarrier();
    const log: string[] = [];
    const hold = gate();
    const group = n.group("c0", async () => {
      void call(n, log, "c0/1", MUTATE, hold.open); // not awaited
      return "early";
    });
    const later = call(n, log, "c1", READ);
    await tick();
    assert.deepEqual(log, ["c0/1:start"], "the function has returned, the inner call still runs, the later call waits");
    hold.release();
    assert.equal(await guard(group), "early");
    await guard(later);
    assert.deepEqual(log, ["c0/1:start", "c0/1:end", "c1:start", "c1:end"]);
  });

  it("a call of a call (`c0/1/1`) uses the barrier of the nearest group up the id, ordered with the script's calls", async () => {
    const n = createNestedBarrier();
    const log: string[] = [];
    const hold = gate();
    const done = n.group("c0", async () => {
      // c0/1 is a tool that is not ours (no barrier entry) and runs a call of its own, c0/1/1.
      const both = Promise.all([call(n, log, "c0/1/1", MUTATE, hold.open), call(n, log, "c0/2", READ)]);
      await tick();
      assert.deepEqual(log, ["c0/1/1:start"], "the read of the script waits for the write of the nested call");
      hold.release();
      await both;
    });
    await guard(done);
    assert.deepEqual(log, ["c0/1/1:start", "c0/1/1:end", "c0/2:start", "c0/2:end"]);
  });

  it("a group inside a group is one call of the outer group, and its calls use its own barrier", async () => {
    const n = createNestedBarrier();
    const log: string[] = [];
    const hold = gate();
    const done = n.group("c0", async () => {
      const inner = n.group("c0/1", async () => {
        assert.equal(n.groupOf("c0/1/1"), n.groupOf("c0/1/2"));
        assert.notEqual(n.groupOf("c0/1/1"), n.groupOf("c0/1"), "the inner group has a barrier of its own");
        await Promise.all([call(n, log, "c0/1/1", MUTATE, hold.open), call(n, log, "c0/1/2", READ)]);
      });
      const after = call(n, log, "c0/2", READ);
      await tick();
      assert.deepEqual(log, ["c0/1/1:start"], "the next call of the outer script waits for the inner group");
      hold.release();
      await Promise.all([inner, after]);
    });
    await guard(done);
    assert.deepEqual(log, ["c0/1/1:start", "c0/1/1:end", "c0/1/2:start", "c0/1/2:end", "c0/2:start", "c0/2:end"]);
  });

  it("groupOf() is one barrier for every call of one group, another one for the next group, none after it ends", async () => {
    const n = createNestedBarrier();
    let first: unknown;
    let second: unknown;
    await n.group("c0", async () => {
      first = n.groupOf("c0/1");
      assert.ok(first);
      assert.equal(n.groupOf("c0/2"), first);
      assert.equal(n.groupOf("c0/1/1"), first);
      assert.equal(n.groupOf("c0"), undefined, "the group's own call is not in its barrier");
      assert.equal(n.groupOf("c1/1"), undefined, "another call's id");
    });
    await n.group("c1", async () => (second = n.groupOf("c1/1")));
    assert.ok(second);
    assert.notEqual(second, first);
    assert.equal(n.groupOf("c0/1"), undefined, "the barrier is removed when the group ends");
    assert.equal(n.groupOf("c1/1"), undefined);
  });

  it("a call from the message callback of a worker created inside the group goes into the group's barrier", async () => {
    // The tool calls of a codemode script come back as messages of a worker thread created inside the group. Bun
    // drops the async context there; the id does not depend on it.
    const n = createNestedBarrier();
    const log: string[] = [];
    const hold = gate();
    let worker: Worker | undefined;
    const done = n.group("c0", async () => {
      worker = new Worker("require('node:worker_threads').parentPort.postMessage('hi')", { eval: true });
      const write = call(n, log, "c0/1", MUTATE, hold.open);
      const fromWorker = new Promise<void>((resolve, reject) => {
        worker!.on("message", () => {
          // registered while the write still runs: it must wait for the write, not for the group's outer entry
          const read = call(n, log, "c0/2", READ);
          hold.release();
          read.then(resolve, reject);
        });
      });
      await Promise.all([write, fromWorker]);
    });
    await guard(done);
    await worker?.terminate();
    assert.deepEqual(log, ["c0/1:start", "c0/1:end", "c0/2:start", "c0/2:end"]);
  });
});

describe("nested barrier: a nested id with no group never waits for its own ancestor", () => {
  it("an ancestor with a live entry in the outer barrier: the call runs at once", async () => {
    const n = createNestedBarrier();
    const log: string[] = [];
    // c0 is one of our calls in the outer barrier that waits for a call with its own id prefix.
    const parent = n.schedule("c0", MUTATE, () => call(n, log, "c0/1", MUTATE));
    await guard(parent);
    assert.deepEqual(log, ["c0/1:start", "c0/1:end"]);
  });

  it("no ancestor in the outer barrier (a tool that is not ours): the call is ordered in the outer barrier", async () => {
    const n = createNestedBarrier();
    const log: string[] = [];
    const hold = gate();
    const group = n.group("c0", () => call(n, log, "c0/1", MUTATE, hold.open));
    // c1 is not ours; its own call c1/1 waits for the earlier group like a model call
    const relayed = call(n, log, "c1/1", READ);
    await tick();
    assert.deepEqual(log, ["c0/1:start"]);
    hold.release();
    await guard(Promise.all([group, relayed]));
    assert.deepEqual(log, ["c0/1:start", "c0/1:end", "c1/1:start", "c1/1:end"]);
  });
});
