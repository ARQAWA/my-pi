// Regression 211: native leaf equality and future dangling targets, independently of path-shaped ancestors.
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createEditToolDefinition, createWriteToolDefinition } from "@earendil-works/pi-coding-agent";
import { createBarrier } from "../barrier.ts";
import { executeEdit } from "../edit.ts";
import { createTools } from "../index.ts";
import { editPathKey, pathKey, scopeOf } from "../keys.ts";
import { createNestedBarrier } from "../nested.ts";
import { executeWrite } from "../write.ts";

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const text = (r: any) => r.content.map((c: any) => c.text ?? "").join("\n");
function gate() {
  let release!: () => void;
  const open = new Promise<void>((resolve) => { release = resolve; });
  return { open, release };
}
function fresh(t: any, kind: "hard" | "dangling" | "ordinary" = "ordinary") {
  const dir = fs.mkdtempSync(path.join(process.env.RQW_FS_TEST_ROOT ?? tmpdir(), "rqw-aliases-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, "left"));
  fs.mkdirSync(path.join(dir, "right"));
  if (kind === "hard") {
    fs.writeFileSync(path.join(dir, "left/a.txt"), "OLD\n");
    fs.linkSync(path.join(dir, "left/a.txt"), path.join(dir, "right/b.txt"));
  } else if (kind === "dangling") fs.symlinkSync("../right/b.txt", path.join(dir, "left/a.txt"), "file");
  return dir;
}
function harness(dir: string, held = "first") {
  const nested = createNestedBarrier(), hold = gate(), started = gate(), events: string[] = [];
  const tools = Object.fromEntries(createTools(dir, () => ({}), { ...nested, schedule(id, scope, run) {
    return nested.schedule(id, scope, async () => {
      events.push(id + ":start");
      if (id === held) { started.release(); await hold.open; }
      try { return await run(); } finally { events.push(id + ":end"); }
    });
  } }).map((tool) => [tool.name, tool]));
  const run = (name: string, id: string, args: any) => tools[name].execute(id, args, undefined, undefined, { cwd: dir, sessionManager: { getSessionId: () => "aliases-test", getSessionFile: () => undefined } } as any);
  return { nested, hold, started, events, run };
}

for (const kind of ["hard", "dangling"] as const) {
  for (const directory of [false, true]) {
    test(`${kind} ${directory ? "directory search" : "read/write"} conflicts obey registration order`, { timeout: 10000 }, async (t) => {
      const dir = fresh(t, kind), h = harness(dir);
      const first = h.run(kind === "hard" ? directory ? "grep" : "read" : "write", "first",
        kind === "hard" ? directory ? { path: "left", pattern: "OLD" } : { path: "left/a.txt" }
          : { path: "left/a.txt", content: "NEW\n" });
      const second = h.run(kind === "hard" ? "write" : directory ? "find" : "read", "second",
        kind === "hard" ? { path: "right/b.txt", content: "NEW\n" }
          : directory ? { path: "right", pattern: "*.txt" } : { path: "right/b.txt" });
      try {
        await h.started.open;
        await tick();
        assert.deepEqual(h.events, ["first:start"]);
      } finally { h.hold.release(); await Promise.all([first, second]); }
      assert.deepEqual(h.events, ["first:start", "first:end", "second:start", "second:end"]);
      if (kind === "hard") assert.match(text(await first), /OLD/);
      else assert.match(text(await second), directory ? /b\.txt/ : /^NEW\n$/);
    });
  }
}

for (const grouped of [false, true]) {
  for (const kind of ["hard", "dangling"] as const) {
    test(`stock bash creates ${kind} before scopes resolve${grouped ? " inside codemode" : ""}`, { timeout: 10000 }, async (t) => {
      const dir = fresh(t), prefix = grouped ? "c0/" : "";
      fs.writeFileSync(path.join(dir, "right/b.txt"), "OLD\n");
      const h = harness(dir, prefix + "first");
      const script = kind === "hard" ? "require('node:fs').linkSync('right/b.txt','left/a.txt')"
        : "require('node:fs').symlinkSync('../right/b.txt','left/a.txt','file');require('node:fs').unlinkSync('right/b.txt')";
      const quote = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";
      const batch = () => Promise.all([
        h.run("bash", prefix + "bash", { command: `${quote(process.execPath)} -e ${quote(script)}` }),
        h.run("write", prefix + "first", { path: "left/a.txt", content: "FIRST\n" }),
        h.run("write", prefix + "second", { path: "right/b.txt", content: "SECOND\n" }),
        h.run("read", prefix + "read", { path: "right/b.txt" }),
      ]);
      const done = grouped ? h.nested.group("c0", batch) : batch();
      try {
        await h.started.open;
        await tick();
        assert.deepEqual(h.events, [prefix + "bash:start", prefix + "bash:end", prefix + "first:start"]);
      } finally { h.hold.release(); await done; }
      assert.equal(text((await done)[3]), "SECOND\n");
      assert.equal(fs.readFileSync(path.join(dir, "right/b.txt"), "utf8"), "SECOND\n");
    });
  }
}

test("ALL is local to hardlinked regular leaves and dangling components, not ordinary directories", (t) => {
  const dir = fresh(t, "hard");
  for (const tool of ["read", "write", "edit", "grep", "find"]) {
    assert.equal(scopeOf(tool, { path: "left/a.txt" }, dir).kind, "all", tool);
  }
  assert.equal(scopeOf("grep", { path: "left" }, dir).kind, "read");
  assert.equal(scopeOf("find", { path: "." }, dir).kind, "read");
  fs.symlinkSync("../right/future", path.join(dir, "left/link"), "dir");
  for (const name of ["left/link", "left/link/sub/file.txt"]) {
    assert.equal(scopeOf("write", { path: name }, dir).kind, "all", name);
  }
});

for (const kind of ["hard", "dangling"] as const) {
  test(`${kind} multi-write under ALL rejects a duplicate before any stock writes`, async (t) => {
    const dir = fresh(t, kind);
    let calls = 0;
    const stock = createWriteToolDefinition(dir, { operations: {
      mkdir: async (p) => { calls++; await fsp.mkdir(p, { recursive: true }); },
      writeFile: async (p, content) => { calls++; await fsp.writeFile(p, content); },
    } });
    await assert.rejects(createBarrier()({ kind: "all", keys: [] }, () => executeWrite(stock.execute, "w", { files: [
      { path: "untouched/new.txt", content: "NOT WRITTEN" },
      { path: "left/a.txt", content: "FIRST" }, { path: "right/b.txt", content: "SECOND" },
    ] }, undefined, undefined, { cwd: dir }, dir)), /twice/);
    assert.equal(calls, 0);
    assert.equal(fs.existsSync(path.join(dir, "untouched")), false);
    if (kind === "hard") assert.equal(fs.readFileSync(path.join(dir, "right/b.txt"), "utf8"), "OLD\n");
    else assert.equal(fs.existsSync(path.join(dir, "right/b.txt")), false);
  });
}

for (const invalid of [false, true]) {
  test(`different-parent hardlink edit is one original-file group${invalid ? " and validates all blocks before writing" : ""}`, async (t) => {
    const dir = fresh(t, "hard");
    fs.writeFileSync(path.join(dir, "left/a.txt"), "alpha beta\n");
    const a = fs.statSync(path.join(dir, "left/a.txt")), b = fs.statSync(path.join(dir, "right/b.txt"));
    assert.equal(a.dev, b.dev); assert.equal(a.ino, b.ino);
    assert.notEqual(pathKey("left/a.txt", dir), pathKey("right/b.txt", dir), "ancestor keys remain path-shaped");
    assert.equal(editPathKey("left/a.txt", dir), editPathKey("right/b.txt", dir));
    let reads = 0, writes = 0;
    const stock = createEditToolDefinition(dir, { operations: {
      access: (p) => fsp.access(p),
      readFile: async (p) => { reads++; return fsp.readFile(p); },
      writeFile: async (p, content) => { writes++; await fsp.writeFile(p, content); },
    } });
    const run = () => createBarrier()({ kind: "all", keys: [] }, () => executeEdit(stock.execute, "e", { edits: [
      { path: "left/a.txt", oldText: "alpha", newText: "ALPHA" },
      { path: "right/b.txt", oldText: invalid ? "absent" : "beta", newText: "BETA" },
    ] }, undefined, undefined, { cwd: dir }, dir));
    if (invalid) await assert.rejects(run(), /edits\[1\]/);
    else await run();
    assert.equal(reads, 1);
    assert.equal(writes, invalid ? 0 : 1);
    assert.equal(fs.readFileSync(path.join(dir, "right/b.txt"), "utf8"), invalid ? "alpha beta\n" : "ALPHA BETA\n");
  });
}

test("237 F1 invalid native file/. symlink stays separate from the valid edit target", async (t) => {
  const dir = fresh(t);
  fs.writeFileSync(path.join(dir, "real.txt"), "alpha beta\n");
  fs.symlinkSync("real.txt/.", path.join(dir, "bad"), "file");
  const stock = createEditToolDefinition(dir);
  const result = await executeEdit(stock.execute, "e", { edits: [
    { path: "real.txt", oldText: "alpha", newText: "ALPHA" },
    { path: "bad", oldText: "beta", newText: "BETA" },
  ] }, undefined, undefined, { cwd: dir }, dir);
  assert.equal(fs.readFileSync(path.join(dir, "real.txt"), "utf8"), "ALPHA beta\n");
  assert.equal(result.isError, true);
  assert.deepEqual(result.details.files.map((file: any) => [file.path, file.ok]), [["real.txt", true], ["bad", false]]);
  assert.match(result.details.files[1].error, /ENOTDIR/);
});

test("dangling chains resolve relative to each link parent, preserving directory suffixes and native target spelling", async (t) => {
  const dir = fresh(t);
  fs.symlinkSync("../right/chain", path.join(dir, "left/link"), "dir");
  fs.symlinkSync("future", path.join(dir, "right/chain"), "dir");
  const called: string[] = [];
  const stock = async (_id: string, args: any) => { called.push(args.path); return { content: [] }; };
  const write = (paths: string[]) => executeWrite(stock, "w", { files: paths.map((path) => ({ path, content: "x" })) }, undefined, undefined, { cwd: dir }, dir);
  await assert.rejects(write(["left/link/sub/a.txt", "right/future/sub/a.txt"]), /twice/);
  await assert.rejects(write(["right/future/sub", "left/link/sub/a.txt"]), /one inside the other/);
  assert.deepEqual(called, []);
  assert.equal(fs.existsSync(path.join(dir, "right/future")), false);
  await write(["left/link/sub/a.txt", "right/other.txt"]);
  assert.deepEqual(called, ["left/link/sub/a.txt", "right/other.txt"], "stock receives original strings");
  // '@' and Unicode spaces inside readlink are literal native names, not Pi input syntax.
  fs.symlinkSync("../right/@literal\u202f.txt", path.join(dir, "left/native"), "file");
  assert.equal(pathKey("left/native", dir), pathKey("right", dir) + "/missing:@literal\u202f.txt");
  fs.mkdirSync(path.join(dir, "right/actual"));
  fs.mkdirSync(path.join(dir, "right/actual/sub"));
  fs.symlinkSync("actual/sub", path.join(dir, "right/pivot"), "dir");
  fs.symlinkSync("../right/pivot/../new.txt", path.join(dir, "left/dotdot"), "file");
  await assert.rejects(write(["left/dotdot", "right/actual/new.txt"]), /twice/);
});

test("symlink cycles retain ordinary stock errors instead of becoming unsupported paths", async (t) => {
  const dir = fresh(t);
  fs.symlinkSync("b", path.join(dir, "a"));
  fs.symlinkSync("a", path.join(dir, "b"));
  assert.equal(scopeOf("write", { path: "a" }, dir).kind, "all");
  assert.equal(editPathKey("a", dir), undefined);
  const stock = createWriteToolDefinition(dir);
  await assert.rejects(executeWrite(stock.execute, "w", { path: "a", content: "x" }, undefined, undefined, { cwd: dir }, dir), /ELOOP|too many levels/i);
});

test("ordinary independent calls, directories and wrapper items still run in parallel", { timeout: 10000 }, async (t) => {
  const dir = fresh(t), h = harness(dir);
  const first = h.run("write", "first", { path: "left/new.txt", content: "a" });
  const second = h.run("write", "second", { path: "right/new.txt", content: "b" });
  try { await h.started.open; await second; assert.deepEqual(h.events, ["first:start", "second:start", "second:end"]); }
  finally { h.hold.release(); await first; }
  for (const edit of [false, true]) {
    const hold = gate(), started: string[] = [];
    const stock = async (_id: string, args: any) => { started.push(args.path); await hold.open; return { content: [] }; };
    const params = edit ? { edits: ["left/new.txt", "right/new.txt"].map((path) => ({ path, oldText: "x", newText: "y" })) }
      : { files: ["left/new.txt", "right/new.txt"].map((path) => ({ path, content: "x" })) };
    const done = (edit ? executeEdit : executeWrite)(stock, "items", params, undefined, undefined, { cwd: dir }, dir);
    try { await tick(); assert.deepEqual(started, ["left/new.txt", "right/new.txt"]); }
    finally { hold.release(); await done; }
  }
});

for (const [label, a, b] of [
  ["dotless-I", "\u0131.txt", "I.txt"], ["sharp-S", "\u00df.txt", "SS.txt"],
  ["Sigma", "\u03a3.txt", "\u03c2.txt"], ["NFC/NFD", "caf\u00e9.txt", "cafe\u0301.txt"], ["case", "New.txt", "new.txt"],
]) {
  test(`dangling future ${label} validation still follows the native namespace`, async (t) => {
    const dir = fresh(t);
    const oracle = path.join(dir, "oracle");
    fs.mkdirSync(oracle);
    fs.writeFileSync(path.join(oracle, a), "oracle");
    let same = false;
    try {
      const first = fs.statSync(path.join(oracle, a)), second = fs.statSync(path.join(oracle, b));
      same = first.dev === second.dev && first.ino === second.ino;
    } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
    fs.rmSync(oracle, { recursive: true });
    fs.symlinkSync(path.join(dir, "right", a), path.join(dir, "left/link"), "file");
    const h = harness(dir, "unused");
    const run = () => h.run("write", "batch", { files: [
      { path: "left/link", content: "FIRST" }, { path: `right/${b}`, content: "SECOND" },
    ] });
    if (same) {
      await assert.rejects(run(), /twice/);
      assert.deepEqual(fs.readdirSync(path.join(dir, "right")), []);
    } else {
      const result: any = await run();
      assert.equal(result.isError, undefined);
      assert.equal(fs.readFileSync(path.join(dir, "right", a), "utf8"), "FIRST");
      assert.equal(fs.readFileSync(path.join(dir, "right", b), "utf8"), "SECOND");
    }
    assert.equal(fs.lstatSync(path.join(dir, "left/link")).isSymbolicLink(), true);
  });
}
