// Dynamic oracle: expected cells come from a generated target plan, never from scope keys or conflicts().
import assert from "node:assert/strict";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createBarrier, type Scope } from "../barrier.ts";
import { scopeOf } from "../keys.ts";
import { createNestedBarrier } from "../nested.ts";

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const ALL: Scope = { kind: "all", keys: [] };
const files = ["New.txt", "Other.txt"];
type Record = { id: string; cells: number[] | null; read: boolean; ended: boolean; resolved: number; ran: boolean };
function random(seed: number) {
  let s = seed >>> 0;
  return (n: number) => Math.floor(((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32) * n);
}

async function round(seed: number, nestedMode: boolean, eager = false) {
  const rnd = random(seed);
  const root = fs.mkdtempSync(path.join(process.env.RQW_FS_TEST_ROOT ?? tmpdir(), "rqw-dynamic-"));
  const nested = createNestedBarrier();
  const barrier = createBarrier();
  const prefix = nestedMode ? "c0/inner/" : "";
  const schedule = <T>(id: string, scope: Scope, run: () => Promise<T>) => {
    if (eager && scope.resolve) {
      try { scope = scope.resolve(); }
      catch (error) { return Promise.reject(error); }
    }
    return nestedMode ? nested.schedule(prefix + id, scope, run) : barrier(scope, run);
  };
  const records: Record[] = [];
  const violations: string[] = [];
  const calls: Promise<unknown>[] = [];
  let epoch = 0;
  let target = 0;
  let creates = 0;
  let removes = 0;
  const dir = (n: number) => path.join(root, String(n));
  const alias = path.join(root, "link");
  const linkType = process.platform === "win32" ? "junction" : "dir";
  const check = (r: Record) => {
    for (const prior of records) {
      if (prior === r) break;
      // Expected physical cells, with explicit tree footprints. No path-prefix or key comparison here.
      const sharesTarget = prior.cells === null || r.cells === null || prior.cells.some((cell) => r.cells!.includes(cell));
      if (sharesTarget && !(prior.read && r.read) && !prior.ended) violations.push(`${r.id} overlapped earlier ${prior.id}`);
    }
  };
  function operation(id: string, cells: number[] | null, read: boolean, scope: Scope, action: () => void, rejects = false) {
    const record: Record = { id, cells, read, ended: false, resolved: 0, ran: false };
    records.push(record);
    const resolve = scope.resolve;
    if (resolve) scope = { ...scope, resolve: () => { record.resolved++; return resolve(); } };
    const call = schedule(id, scope, async () => {
      record.ran = true;
      check(record);
      try {
        action();
        await tick();
        if (rnd(2)) await tick();
        if (rejects) throw new Error("planned rejection");
      } finally { record.ended = true; }
    }).then(() => {
      if (rejects) violations.push(`${id} should have rejected`);
    }, (error) => {
      record.ended = true;
      if (!rejects || error.message !== "planned rejection") violations.push(`${id}: unexpected ${error.message}`);
    });
    calls.push(call);
    return record;
  }
  try {
    for (let n = 0; n < 3; n++) fs.mkdirSync(dir(n));
    fs.symlinkSync(dir(0), alias, linkType);
    const batch = async () => {
      let plannedTarget = 0;
      for (let e = 1; e <= 3; e++) {
        // Every all changes the alias, including calls that reject after changing it.
        plannedTarget = (plannedTarget + 1 + rnd(2)) % 3;
        const nextTarget = plannedTarget;
        const existence = Array.from({ length: 6 }, () => rnd(2) === 1);
        operation(`all${e}`, null, false, ALL, () => {
          fs.unlinkSync(alias);
          fs.symlinkSync(dir(nextTarget), alias, linkType);
          target = nextTarget;
          epoch = e;
          for (let d = 0; d < 3; d++) for (let f = 0; f < 2; f++) {
            const file = path.join(dir(d), files[f]);
            if (existence[d * 2 + f]) { fs.writeFileSync(file, "OLD"); creates++; }
            else { fs.rmSync(file, { force: true }); removes++; }
          }
        }, e === 2 && rnd(2) === 1);
        const planned: { read: boolean; alias: boolean; dir: number; file: number; tree?: boolean }[] = [
          { read: false, alias: true, dir: nextTarget, file: 0 },
          { read: true, alias: false, dir: nextTarget, file: 0 },
          { read: false, alias: false, dir: (nextTarget + 1) % 3, file: 0 },
          { read: true, alias: true, dir: nextTarget, file: 0, tree: true },
        ];
        for (let n = rnd(5); n > 0; n--) {
          const useAlias = rnd(2) === 1;
          planned.push({ read: rnd(2) === 1, alias: useAlias, dir: useAlias ? nextTarget : rnd(3), file: rnd(2) });
        }
        for (const [i, p] of planned.entries()) {
          const name = p.alias ? "link" : String(p.dir);
          const tool = p.tree ? "grep" : p.read ? "read" : "write";
          const arg = { path: p.tree ? name : `${name}/${files[p.file]}` };
          const cells = p.tree ? [p.dir * 2, p.dir * 2 + 1] : [p.dir * 2 + p.file];
          const r = operation(`e${e}/${i}`, cells, p.read, {
            kind: "all", keys: [], resolve: () => {
              if (epoch !== e) violations.push(`e${e}/${i} resolved in epoch ${epoch}`);
              return scopeOf(tool, arg, root);
            },
          }, () => {
            if (p.alias && target !== nextTarget) violations.push("alias used in wrong epoch");
            if (!p.read) fs.writeFileSync(path.join(root, name, files[p.file]), "NEW");
          }, rnd(7) === 0);
          // Some registrations occur after a mutation creates its target while other entries remain live.
          if (i === 0 && rnd(2)) await tick();
          if (r.resolved > 1) violations.push("resolver repeated");
        }
      }
      const bad = operation("bad-resolver", null, false, { kind: "read", keys: [], resolve: () => { throw new Error("planned rejection"); } },
        () => { violations.push("throwing resolver executed its body"); }, true);
      operation("after-rejection", null, false, { kind: "all", keys: [], resolve: () => ({ kind: "read", keys: [root] }) }, () => {});
      await Promise.all(calls);
      assert.equal(bad.ran, false);
      for (const r of records) {
        if (!r.id.startsWith("all") && r.resolved !== 1) violations.push(`${r.id}: resolved ${r.resolved} times`);
        if (!r.ended) violations.push(`${r.id}: not settled`);
      }
    };
    if (nestedMode) {
      let groupEnded = false;
      const done = nested.group("c0", () => nested.group("c0/inner", batch)).then(() => { groupEnded = true; });
      const outside = nested.schedule("outside", ALL, async () => {
        if (!groupEnded) violations.push("outside call started before nested codemode drained");
      });
      await Promise.all([done, outside]);
      assert.equal(nested.groupOf("c0/inner/late"), undefined);
      await nested.schedule("after-cleanup", ALL, async () => {});
    } else await batch();
    return { violations, creates, removes, resolves: records.reduce((n, r) => n + r.resolved, 0) };
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

test("2000 dynamic native alias/creation rounds use independent expected-target ordering, reject cleanup and nested codemode", { timeout: 120000 }, async (t) => {
  // A capability skip, not a requirement for a human Windows run.
  try {
    const n = Number(process.env.RQW_DYNAMIC_ROUNDS ?? 2000);
    const results = [];
    for (let i = 0; i < n; i++) results.push(await round(i + 1, i % 2 === 0));
    const violations = results.flatMap((r, i) => r.violations.map((v) => `round ${i + 1}: ${v}`));
    t.diagnostic(`rounds=${n} resolves=${results.reduce((s, r) => s + r.resolves, 0)} creates=${results.reduce((s, r) => s + r.creates, 0)} removes=${results.reduce((s, r) => s + r.removes, 0)} violations=${violations.length}`);
    assert.deepEqual(violations.slice(0, 10), []);
  } catch (error) {
    if (["EPERM", "EACCES", "ENOTSUP"].includes((error as NodeJS.ErrnoException).code ?? "")) return t.skip("native directory links unavailable");
    throw error;
  }
});

test("dynamic expected-target oracle detects eager pre-all resolution", async (t) => {
  try {
    const result = await round(3, false, true);
    assert.ok(result.violations.some((v) => v.includes("resolved in epoch")));
    assert.ok(result.violations.some((v) => v.includes("overlapped earlier")), "stale target keys must produce an actual ordering violation");
  } catch (error) {
    if (["EPERM", "EACCES", "ENOTSUP"].includes((error as NodeJS.ErrnoException).code ?? "")) return t.skip("native directory links unavailable");
    throw error;
  }
});
