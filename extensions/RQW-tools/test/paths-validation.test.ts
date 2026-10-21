// Native namespace equivalence is the oracle, not a Unicode case table or the barrier's conflict predicate.
import assert from "node:assert/strict";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createTools } from "../index.ts";
import { writePathKeys } from "../keys.ts";
import { createNestedBarrier } from "../nested.ts";
import { executeWrite } from "../write.ts";

const base = process.env.RQW_FS_TEST_ROOT ?? tmpdir();
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const text = (r: any) => r.content.map((c: any) => c.type === "text" ? c.text : "").join("\n");
function gate() {
  let release!: () => void;
  const open = new Promise<void>((resolve) => { release = resolve; });
  return { open, release };
}
function fresh(t: any, numeric = false) {
  const dir = numeric ? path.join(base, `${Date.now()}${Math.floor(Math.random() * 1e9)}`) : fs.mkdtempSync(path.join(base, "rqw-validation-"));
  if (numeric) fs.mkdirSync(dir);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function nativeEquivalent(parent: string, a: string, b: string): boolean {
  const dir = fs.mkdtempSync(path.join(parent, "oracle-"));
  try {
    fs.writeFileSync(path.join(dir, a), "oracle", { flag: "wx" });
    try {
      const x = fs.statSync(path.join(dir, a));
      const y = fs.statSync(path.join(dir, b));
      return x.dev === y.dev && x.ino === y.ino;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw e;
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
function write(dir: string, files: { path: string; content: string }[], signal?: AbortSignal) {
  const tools = createTools(dir, () => ({}));
  return tools.find((x) => x.name === "write")!.execute("write", { files }, signal, undefined, { cwd: dir } as any);
}

for (const [label, a, b] of [
  ["dotless-I", "\u0131", "I"], ["sharp-S", "\u00df", "SS"], ["Sigma", "\u03a3", "\u03c2"],
  ["normalization", "caf\u00e9", "cafe\u0301"], ["ASCII", "Alpha", "alpha"],
]) {
  for (const ancestor of [false, true]) {
    test(`missing ${label} ${ancestor ? "ancestor" : "duplicate"} validation follows the exact native namespace`, async (t) => {
      const dir = fresh(t);
      const first = ancestor ? a : `${a}.txt`;
      const second = ancestor ? `${b}/child.txt` : `${b}.txt`;
      const same = nativeEquivalent(dir, first, ancestor ? b : second);
      const files = [{ path: first, content: "FIRST\n" }, { path: second, content: "SECOND\n" }];
      t.diagnostic(`native equivalent=${same}`);
      if (same) {
        await assert.rejects(write(dir, files), ancestor ? /one inside the other/ : /twice/);
        assert.deepEqual(fs.readdirSync(dir), [], "rejection happens before any user target or parent is created");
      } else {
        const result: any = await write(dir, files);
        assert.equal(result.isError, undefined);
        assert.equal(fs.readFileSync(path.join(dir, first), "utf8"), "FIRST\n");
        assert.equal(fs.readFileSync(path.join(dir, second), "utf8"), "SECOND\n");
        assert.equal(fs.readdirSync(dir).some((x) => x.startsWith(".rqw-paths-")), false);
      }
    });
  }
}

test("probing a Unicode collision retains literal duplicates and ancestors in the same batch", async (t) => {
  const dir = fresh(t);
  await assert.rejects(write(dir, [
    { path: "I", content: "a" }, { path: "I/child", content: "b" }, { path: "\u0131/other", content: "c" },
  ]), /one inside the other/);
  assert.deepEqual(fs.readdirSync(dir), []);
  await assert.rejects(write(dir, [
    { path: "I", content: "a" }, { path: "I", content: "b" }, { path: "\u0131", content: "c" },
  ]), /twice/);
  assert.deepEqual(fs.readdirSync(dir), []);
});

test("ordinary independent ASCII batch writes do not probe and stock writes still start in parallel", async (t) => {
  const dir = fresh(t);
  t.mock.method(fs, "mkdtempSync", () => { assert.fail("no probe for independent ASCII targets"); });
  const hold = gate();
  const started: string[] = [];
  const stock = async (_id: string, args: any) => { started.push(args.path); await hold.open; return {}; };
  const done = executeWrite(stock, "w", { files: [{ path: "a.txt", content: "a" }, { path: "b.txt", content: "b" }] }, undefined, undefined, { cwd: dir }, dir);
  try { await tick(); assert.deepEqual(started, ["a.txt", "b.txt"]); }
  finally { hold.release(); await done; }
});

for (const failure of ["abort-before", "abort-during", "native-error"] as const) {
  test(`ambiguous missing target probe cleans up on ${failure} without touching user targets`, { skip: process.platform === "linux" }, async (t) => {
    const dir = fresh(t);
    const ac = new AbortController();
    const nativeMkdir = fs.mkdirSync;
    let probes = 0;
    const nativeTemp = fs.mkdtempSync;
    t.mock.method(fs, "mkdtempSync", (...args: Parameters<typeof fs.mkdtempSync>) => {
      probes++;
      assert.equal(ac.signal.aborted, false, "never mkdir after an already observed abort");
      return nativeTemp(...args);
    });
    t.mock.method(fs, "mkdirSync", (p: fs.PathLike, options: any) => {
      if (failure === "native-error") throw Object.assign(new Error("probe denied"), { code: "EACCES" });
      const value = nativeMkdir(p, options);
      if (failure === "abort-during") ac.abort();
      return value;
    });
    if (failure === "abort-before") ac.abort();
    await assert.rejects(write(dir, [{ path: "\u0131.txt", content: "a" }, { path: "I.txt", content: "b" }], ac.signal),
      failure === "native-error" ? /probe denied/ : /aborted/);
    assert.equal(probes, failure === "abort-before" ? 0 : 1);
    assert.deepEqual(fs.readdirSync(dir), [], "finally removes the private probe on every exit");
  });
}

test("ambiguous missing aliases probe only in their deepest existing parent", { skip: process.platform === "linux" }, (t) => {
  const dir = fresh(t);
  const parent = path.join(dir, "real");
  fs.mkdirSync(parent);
  try { fs.symlinkSync(parent, path.join(dir, "link"), process.platform === "win32" ? "junction" : "dir"); }
  catch (e) {
    if (["EPERM", "EACCES", "ENOTSUP"].includes((e as NodeJS.ErrnoException).code ?? "")) return t.skip("directory symlinks unavailable");
    throw e;
  }
  const native = fs.mkdtempSync;
  let probes = 0;
  t.mock.method(fs, "mkdtempSync", (prefix: string) => {
    assert.equal(path.dirname(prefix), fs.realpathSync.native(parent));
    probes++;
    const temp = native(prefix);
    if (process.platform !== "win32") assert.equal(fs.statSync(temp).mode & 0o777, 0o700);
    return temp;
  });
  writePathKeys(["link/missing/\u0131.txt", "real/missing/I.txt"], dir);
  assert.equal(probes, 1);
  assert.deepEqual(fs.readdirSync(parent), [], "neither user missing directory nor probe survives validation");
});

for (const existing of [false, true]) {
  for (const grouped of [false, true]) {
    test(`read and grep wait across ${existing ? "existing" : "new"} numeric-parent write${grouped ? " inside codemode" : ""}`, { timeout: 10000 }, async (t) => {
      // On a numeric-mounted HFSX volume, no existing cased ancestor can tell a pre-creation case probe its policy.
      const dir = fresh(t, true);
      const file = path.join(dir, "New.txt");
      if (existing) fs.writeFileSync(file, "OLD\n");
      const nested = createNestedBarrier();
      const hold = gate();
      const started = gate();
      const events: string[] = [];
      const prefix = grouped ? "c0/" : "";
      const tools = Object.fromEntries(createTools(dir, () => ({}), {
        ...nested,
        schedule(id, scope, run) {
          return nested.schedule(id, scope, async () => {
            events.push(`${id}:start`);
            if (id === prefix + "write") {
              fs.writeFileSync(file, "PARTIAL\n");
              started.release();
              await hold.open;
            }
            try { return await run(); }
            finally { events.push(`${id}:end`); }
          });
        },
      }).map((tool) => [tool.name, tool]));
      const call = (name: string, id: string, args: any) => tools[name].execute(id, args, undefined, undefined, { cwd: dir } as any);
      let reading!: Promise<any>;
      let grepping!: Promise<any>;
      const batch = async () => {
        const writing = call("write", prefix + "write", { path: "New.txt", content: "FINAL\n" });
        await started.open;
        // Registration after creation, while the earlier operation is still live, is the critical state change.
        reading = call("read", prefix + "read", { path: "New.txt" });
        grepping = call("grep", prefix + "grep", { path: "New.txt", pattern: "FINAL" });
        return Promise.all([writing, reading, grepping]);
      };
      const done = grouped ? nested.group("c0", batch) : batch();
      const outside = grouped ? call("read", "outside", { path: "New.txt" }) : undefined;
      try {
        await started.open;
        await tick();
        assert.deepEqual(events, [prefix + "write:start"], "no read of the unfinished prefix or OLD");
      } finally { hold.release(); await Promise.all([done, outside]); }
      assert.equal(text(await reading), "FINAL\n");
      assert.match(text(await grepping), /FINAL/);
      if (outside) assert.equal(text(await outside), "FINAL\n");
      assert.equal(nested.groupOf("c0/late"), undefined, "codemode group cleaned up");
    });
  }
}


test("an unavailable native identity never silently permits ambiguous missing writes", { skip: process.platform === "linux" }, async (t) => {
  const dir = fresh(t);
  const native = fs.statSync;
  t.mock.method(fs, "statSync", (p: fs.PathLike, options?: fs.StatOptions) => {
    const value = native(p, options);
    return options?.bigint ? { ...value, ino: 0n } : value;
  });
  await assert.rejects(write(dir, [
    { path: "\u03a3.txt", content: "FIRST" }, { path: "\u03c2.txt", content: "SECOND" },
  ]), /Cannot validate ambiguous filesystem targets/);
  assert.deepEqual(fs.readdirSync(dir), []);
});
