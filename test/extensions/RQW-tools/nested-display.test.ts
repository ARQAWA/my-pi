import assert from "node:assert/strict";
import { it } from "node:test";
import { groupCodemode } from "../../../extensions/RQW-tools/codemode.ts";
import { createJobTool, createJobs } from "../../../extensions/RQW-tools/jobs.ts";
import { createNestedBarrier } from "../../../extensions/RQW-tools/nested.ts";
import { nestedDisplay, withNestedDisplay } from "../../../extensions/RQW-tools/nested-display.ts";

const edit = { content: [{ type: "text", text: "original" }], structuredContent: { untouched: true }, details: { diff: "-1 old\n+1 new\n+2 next" } };
const tick = () => new Promise<void>((r) => setImmediate(r));
function gate() { let release!: () => void; const promise = new Promise<void>((r) => release = r); return { promise, release }; }
const scheduledEdit = (n: ReturnType<typeof createNestedBarrier>, id: string, path: string) =>
  n.schedule(id, { kind: "mutate", keys: [path] }, async () => n.observe(id, "edit", { path }, edit));

it("captures confirmed edit diff/patch only and preserves mixed file outcomes", () => {
  assert.deepEqual(nestedDisplay("edit", { path: "a", edits: [{ oldText: "fake", newText: "fake" }] }, edit),
    { version: 1, tool: "edit", files: [{ path: "a", ok: true, added: 2, removed: 1 }] });
  assert.equal(nestedDisplay("edit", { path: "a" }, { details: {} }), undefined);
  assert.equal(nestedDisplay("edit", { path: "a" }, { ...edit, isError: true }), undefined);
  assert.deepEqual(nestedDisplay("edit", {}, { isError: true, details: { files: [
    { path: "a", ok: true, details: { patch: "@@ -1 +1,2 @@\n-old\n+new\n+next" } },
    { path: "b", ok: false, error: "private error" },
    { path: "c", ok: false, outcome: "possibly_changed" },
    { path: "d", ok: true, details: { diff: " 1 unchanged" } },
  ] } }), { version: 1, tool: "edit", files: [
    { path: "a", ok: true, added: 2, removed: 1 }, { path: "b", ok: false },
    { path: "c", ok: false, outcome: "possibly_changed" }, { path: "d", ok: true, added: 0, removed: 0 },
  ] });
  for (const exitCode of [0, 3]) assert.deepEqual(nestedDisplay("bash", {}, { structuredContent: { exit_code: exitCode } }), { version: 1, tool: "bash", exitCode });
  assert.equal(nestedDisplay("bash", {}, { content: [{ type: "text", text: "exit_code: 3" }] }), undefined);
});

it("observes only registered groups and adds no changes to child result fields", async () => {
  const n = createNestedBarrier();
  assert.equal(n.observe("a/1", "edit", { path: "a" }, edit), edit);
  const result = await n.group("a", async () => {
    const child = await scheduledEdit(n, "a/1", "a");
    assert.equal(child.content, edit.content);
    assert.equal(child.structuredContent, edit.structuredContent);
    assert.equal(child.details.diff, edit.details.diff);
    assert.equal(n.observe("a/2", "read", {}, edit), edit);
    return { content: [], isError: true };
  }, undefined, withNestedDisplay);
  assert.equal(result.isError, true);
  assert.equal((result as any).details.rqwToolsNested.calls.length, 1);
  assert.equal(n.observe("a/3", "edit", { path: "a" }, edit), edit);
});

it("attaches after draining unawaited calls, scopes nearest group, and cleans errors/abort", async () => {
  const n = createNestedBarrier();
  const hold = gate();
  const first = n.group("a", async () => {
    void n.schedule("a/1", { kind: "all", keys: [] }, async () => {
      await hold.promise;
      n.observe("a/1", "edit", { path: "late" }, edit);
    });
    return { content: [] };
  }, undefined, withNestedDisplay);
  await tick();
  hold.release();
  assert.equal((await first as any).details.rqwToolsNested.calls[0].files[0].path, "late");
  const outer = await n.group("b", async () => {
    const inner = await n.group("b/1", async () => {
      await scheduledEdit(n, "b/1/1", "inner");
      return { content: [] };
    }, undefined, withNestedDisplay);
    assert.equal((inner as any).details.rqwToolsNested.calls.length, 1);
    return { content: [] };
  }, undefined, withNestedDisplay);
  assert.deepEqual(outer, { content: [] });
  for (const message of ["failed script", "Operation aborted"]) {
    await assert.rejects(n.group("c", async () => {
      await scheduledEdit(n, "c/1", "c");
      throw new Error(message);
    }, undefined, withNestedDisplay), new RegExp(message));
    assert.equal(n.observe("c/2", "edit", { path: "c" }, edit), edit);
  }
  assert.deepEqual(await n.group("d", async () => ({ content: [] }), undefined, withNestedDisplay), { content: [] });
});

it("retains the first 256 starts despite out-of-order completion and marks every completed live call", async () => {
  const n = createNestedBarrier();
  const original = { content: [] };
  const holdFirst = gate();
  const othersFinished = gate();
  const completed: string[] = [];
  assert.equal(withNestedDisplay(original, []), original);
  const parent = n.group("p", async () => {
    const calls = Array.from({ length: 257 }, (_, index) => {
      const id = `p/${index + 1}`;
      return n.schedule(id, { kind: "mutate", keys: [id] }, async () => {
        if (index === 0) await holdFirst.promise;
        const result: any = n.observe(id, "edit", { path: id }, edit);
        assert.deepEqual(result.details.rqwToolsNestedCall, { version: 1, tool: "edit", files: [{ path: id, ok: true, added: 2, removed: 1 }] });
        completed.push(id);
        if (completed.length === 256) othersFinished.release();
      });
    });
    await Promise.all(calls);
    return original;
  }, undefined, withNestedDisplay);
  await othersFinished.promise;
  assert.deepEqual(completed, Array.from({ length: 256 }, (_, i) => `p/${i + 2}`));
  holdFirst.release();
  const records = (await parent as any).details.rqwToolsNested.calls;
  assert.equal(records.length, 256);
  assert.deepEqual(records.map((r: any) => r.id), Array.from({ length: 256 }, (_, i) => `p/${i + 1}`));
  assert.equal(completed.at(-1), "p/1");
});

it("keeps completed background job metadata in details without changing job text", async () => {
  const n = createNestedBarrier();
  const jobs = createJobs({ backgroundAfterMs: 5 });
  const hold = gate();
  try {
    const definition: any = { name: "codemode", description: "test", execute: async () => {
      await hold.promise;
      await scheduledEdit(n, "a/1", "late");
      return { content: [{ type: "text", text: "done" }] };
    } };
    const tool = groupCodemode(definition, n, jobs);
    const handoff: any = await tool.execute("a", {}, undefined, undefined, { cwd: process.cwd() } as any);
    assert.equal(handoff.details.rqwToolsNested, undefined);
    hold.release();
    const waiter = createJobTool(jobs, "test");
    const done = await waiter.execute("w", { action: "wait", ids: ["job#1"], timeout_ms: 5000 }, undefined);
    assert.equal(done.details.results[0].details.rqwToolsNested.calls[0].id, "a/1");
    const model = JSON.parse(done.content[0].text);
    assert.equal(model.results[0].details, undefined);
    assert.equal(model.results[0].result, "done");
  } finally { hold.release(); jobs.dispose(); }
});

it("snapshots completed calls at background handoff without confirming the pending call", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const n = createNestedBarrier();
  const jobs = createJobs({ backgroundAfterMs: 100 });
  const firstDone = gate();
  const holdSecond = gate();
  let originalHandoff: any;
  // Observe the unmodified actual jobs.run handoff so the test compares its exact content and job details.
  const wrappedJobs = { ...jobs, run: async (...args: Parameters<typeof jobs.run>) => {
    const result = await jobs.run(...args);
    originalHandoff = result;
    return result;
  } };
  try {
    const definition: any = { name: "codemode", description: "test", execute: async () => {
      await scheduledEdit(n, "p/1", "first");
      const second = n.schedule("p/2", { kind: "all", keys: [] }, async () => {
        firstDone.release();
        await holdSecond.promise;
        return n.observe("p/2", "bash", {}, { content: [], structuredContent: { exit_code: 3 } });
      });
      await second;
      return { content: [{ type: "text", text: "done" }] };
    } };
    const resultPromise = groupCodemode(definition, n, wrappedJobs).execute("p", {}, undefined, undefined, { cwd: process.cwd() } as any);
    await firstDone.promise;
    const first = { id: "p/1", version: 1, tool: "edit", files: [{ path: "first", ok: true, added: 2, removed: 1 }] };
    const copy = n.displayOf("p");
    assert.deepEqual(copy, [first]);
    (copy[0] as any).files[0].added = 999;
    copy.length = 0;
    assert.deepEqual(n.displayOf("p"), [first], "snapshot mutation leaked into the active group");
    assert.deepEqual(n.displayOf("p/1"), [], "snapshot lookup must use the exact group ID");
    t.mock.timers.tick(100);
    const handoff: any = await resultPromise;
    assert.deepEqual(handoff.content, originalHandoff.content);
    assert.deepEqual(handoff.details.job, originalHandoff.details.job);
    assert.deepEqual(handoff.details.rqwToolsNested, { version: 1, calls: [first] });
    holdSecond.release();
    const done = await createJobTool(jobs, "test").execute("w", { action: "wait", ids: ["job#1"], timeout_ms: 5000 }, undefined);
    assert.deepEqual(done.details.results[0].details.rqwToolsNested, { version: 1, calls: [first,
      { id: "p/2", version: 1, tool: "bash", exitCode: 3 }] });
    assert.deepEqual(handoff.details.rqwToolsNested, { version: 1, calls: [first] }, "handoff changed retrospectively");
    assert.deepEqual(n.displayOf("p"), [], "completed group leaked its snapshot");
  } finally { holdSecond.release(); jobs.dispose(); t.mock.timers.reset(); }
});
