// The barrier with one level of nesting (nested.ts), without Pi: plain promises, gates that tests release by hand, and
// a real worker thread. No sleeps: a call stays "running" until its gate is released, `tick()` lets every pending
// promise continuation run.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MessageChannel, Worker } from "node:worker_threads";
import type { Scope } from "../barrier.ts";
import { createNestedBarrier, type NestedBarrier } from "../nested.ts";

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

/** A call that logs its start, waits for `hold` (when given) and logs its end. */
function call(n: NestedBarrier, log: string[], name: string, scope: Scope, hold?: Promise<void>) {
  return n.schedule(scope, async () => {
    log.push(`${name}:start`);
    await hold;
    log.push(`${name}:end`);
  });
}

describe("nested barrier: outside any group it is the plain barrier", () => {
  it("a write and a read of one file keep registration order, another file overlaps", async () => {
    const n = createNestedBarrier();
    const log: string[] = [];
    const hold = gate();
    const write = call(n, log, "write", MUTATE, hold.open);
    const read = call(n, log, "read", READ);
    const other = call(n, log, "other", OTHER_FILE);
    await tick();
    assert.deepEqual(log, ["write:start", "other:start", "other:end"]);
    hold.release();
    await guard(Promise.all([write, read, other]));
    assert.deepEqual(log, ["write:start", "other:start", "other:end", "write:end", "read:start", "read:end"]);
  });

  it("current() is undefined", () => {
    assert.equal(createNestedBarrier().current(), undefined);
  });
});

describe("nested barrier: a group is one call with scope all in the outer barrier", () => {
  it("it waits for every earlier call and every later call waits for it", async () => {
    const n = createNestedBarrier();
    const log: string[] = [];
    const holdFirst = gate();
    const holdGroup = gate();
    const first = call(n, log, "first", OTHER_FILE, holdFirst.open);
    const group = n.group(() => call(n, log, "group", READ, holdGroup.open));
    const last = call(n, log, "last", OTHER_FILE);
    await tick();
    assert.deepEqual(log, ["first:start"], "the group waits for the earlier call");
    holdFirst.release();
    await tick();
    assert.deepEqual(log, ["first:start", "first:end", "group:start"], "the later call waits for the group");
    holdGroup.release();
    await guard(Promise.all([first, group, last]));
    assert.deepEqual(log, ["first:start", "first:end", "group:start", "group:end", "last:start", "last:end"]);
  });

  it("two groups run one after the other", async () => {
    const n = createNestedBarrier();
    const log: string[] = [];
    const holdA = gate();
    const a = n.group(() => call(n, log, "a", READ, holdA.open));
    const b = n.group(() => call(n, log, "b", READ));
    await tick();
    assert.deepEqual(log, ["a:start"]);
    holdA.release();
    await guard(Promise.all([a, b]));
    assert.deepEqual(log, ["a:start", "a:end", "b:start", "b:end"]);
  });

  it("the result and a failure of the group reach the caller, and a failed group leaves the barrier", async () => {
    const n = createNestedBarrier();
    assert.equal(await n.group(async () => "result"), "result");
    await assert.rejects(
      n.group(async () => {
        throw new Error("script failed");
      }),
      /script failed/,
    );
    assert.equal(await guard(n.schedule(MUTATE, async () => "next")), "next");
  });
});

describe("nested barrier: the calls of a group have a barrier of their own", () => {
  it("they keep their order among themselves and never wait for the group's own entry", async () => {
    const n = createNestedBarrier();
    const log: string[] = [];
    const hold = gate();
    const done = n.group(async () => {
      // started together, like Promise.all in a script: the read waits for the write
      const both = Promise.all([call(n, log, "write", MUTATE, hold.open), call(n, log, "read", READ)]);
      await tick();
      assert.deepEqual(log, ["write:start"]);
      hold.release();
      await both;
      await call(n, log, "after", MUTATE);
    });
    await guard(done);
    assert.deepEqual(log, ["write:start", "write:end", "read:start", "read:end", "after:start", "after:end"]);
  });

  it("a call still running when the group's function returns keeps the group open", async () => {
    const n = createNestedBarrier();
    const log: string[] = [];
    const hold = gate();
    const group = n.group(async () => {
      void call(n, log, "inner", MUTATE, hold.open); // not awaited
      return "early";
    });
    const later = call(n, log, "later", READ);
    await tick();
    assert.deepEqual(log, ["inner:start"], "the function has returned, the inner call still runs, the later call waits");
    hold.release();
    assert.equal(await guard(group), "early");
    await guard(later);
    assert.deepEqual(log, ["inner:start", "inner:end", "later:start", "later:end"]);
  });

  it("current() is the same barrier everywhere in one group and another one in the next group", async () => {
    const n = createNestedBarrier();
    const seen: unknown[] = [];
    await n.group(async () => {
      seen.push(n.current());
      await tick();
      seen.push(n.current());
      await new Promise<void>((resolve) => queueMicrotask(resolve));
      seen.push(n.current());
      await Promise.all([n.schedule(READ, async () => seen.push(n.current())), n.schedule(MUTATE, async () => seen.push(n.current()))]);
    });
    await n.group(async () => seen.push(n.current()));
    seen.push(n.current());
    assert.equal(seen.length, 7);
    assert.ok(seen[0], "inside a group");
    assert.ok(seen.slice(0, 5).every((s) => s === seen[0]), "one barrier through the first group");
    assert.ok(seen[5], "inside the second group");
    assert.notEqual(seen[5], seen[0], "another barrier in the second group");
    assert.equal(seen[6], undefined, "outside any group again");
  });

  it("the context follows the messages of a message channel and of a worker thread created inside the group", async () => {
    // The tool calls of a codemode script come back as messages of a worker thread created inside the group.
    const n = createNestedBarrier();
    const seen: Record<string, unknown> = {};
    let inside: unknown;
    await guard(
      n.group(async () => {
        inside = n.current();
        const { port1, port2 } = new MessageChannel();
        const channel = new Promise<void>((resolve) => {
          port1.on("message", () => {
            seen.channel = n.current();
            port1.close();
            resolve();
          });
        });
        port2.postMessage(1);
        const worker = new Worker("require('node:worker_threads').parentPort.postMessage('hi')", { eval: true });
        const fromWorker = new Promise<void>((resolve) => {
          worker.on("message", () => {
            seen.worker = n.current();
            // the host callback of a script call goes on into the barrier of the group
            void n.schedule(READ, async () => (seen.workerCall = n.current())).then(() => resolve());
          });
        });
        await Promise.all([channel, fromWorker]);
        await worker.terminate();
      }),
    );
    assert.ok(inside);
    assert.equal(seen.channel, inside);
    assert.equal(seen.worker, inside);
    assert.equal(seen.workerCall, inside);
  });
});
