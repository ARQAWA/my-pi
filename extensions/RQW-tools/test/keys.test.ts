// Layer 2 of notes/analysis-races.md section 7: the path key on a real temp dir, plus the string rules of the other
// platforms checked with an explicit `platform` argument (they need no file system).
import test, { after } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { editPathKey, pathKey, readSpellings, resolvePath, scopeOf, writePathKeys } from "../keys.ts";

// Values of the wrong type on purpose, to see that the key function refuses them.
const wrong = (v: unknown) => v as string;

const platform = process.platform;
let folds = platform === "win32"; // Windows keys conservatively fold even in case-sensitive directories

const root = fs.mkdtempSync(path.join(os.tmpdir(), "rqw-keys-"));
after(() => fs.rmSync(root, { recursive: true, force: true }));

const write = (rel: string, text = "x") => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
};
// Links may be refused (Windows without developer mode), so each one reports whether it exists.
const link = (target: string, name: string, type?: "dir" | "file" | "junction") => {
  try {
    fs.symlinkSync(target, path.join(root, name), type);
    return true;
  } catch {
    return false;
  }
};

write("sub/file.txt");
write("ReadMe.md");
if (platform === "darwin") folds = fs.existsSync(path.join(root, "README.MD"));
write("real/target.txt");
write("caf\u00e9.txt"); // NFC spelling on disk
const hasDirLink = link(path.join(root, "real"), "link", platform === "win32" ? "junction" : "dir");
const hasFileLink = link(path.join(root, "real", "target.txt"), "flink", "file");
const hasLoop = link("loop2", "loop1") && link("loop1", "loop2");

// What the key of an existing path must look like on this platform.
const fold = (s: string) => {
  if (platform === "darwin") return s.normalize("NFC").toLowerCase();
  if (platform === "win32") return s.replaceAll("\\", "/").toLowerCase();
  return s;
};
const real = (rel: string) => fs.realpathSync.native(path.join(root, rel));

const k = (p: string): string => {
  const key = pathKey(p, root, platform, false);
  assert.notStrictEqual(key, undefined, `no key for ${JSON.stringify(p)}`);
  return key as string;
};
const allEqual = (spellings: string[], expected: string) => {
  const grouped = pathKey(spellings[0], root);
  assert.notStrictEqual(grouped, undefined);
  for (const s of spellings) {
    assert.strictEqual(k(s), expected, `spelling ${JSON.stringify(s)}`);
    assert.strictEqual(pathKey(s, root), grouped, `group identity ${JSON.stringify(s)}`);
  }
};

// ---------------------------------------------------------------- real file system

test("an existing file has one key for every spelling", () => {
  const abs = path.join(root, "sub", "file.txt");
  const spellings = [
    "sub/file.txt",
    abs,
    "./sub/file.txt",
    "sub/../sub/file.txt",
    "sub//file.txt",
    "sub/./file.txt",
    "sub/file.txt/",
    "@sub/file.txt",
    abs + path.sep,
    path.join(root, "sub", "..", "sub", "file.txt"),
  ];
  if (platform === "win32") spellings.push("sub\\file.txt", abs.replaceAll("\\", "/"));
  allEqual(spellings, fold(real("sub/file.txt")));
});

test("a missing file has one key for every spelling, below an existing directory and below missing ones", () => {
  allEqual(
    ["sub/new.txt", path.join(root, "sub", "new.txt"), "./sub/new.txt", "sub/../sub/new.txt", "sub//new.txt", "sub/new.txt/"],
    fold(path.join(real("sub"), "new.txt")),
  );
  allEqual(
    ["sub/a/b/new.txt", path.join(root, "sub", "a", "b", "new.txt"), "sub/../sub/a/b/./new.txt"],
    fold(path.join(real("sub"), "a", "b", "new.txt")),
  );
});

test("a directory with and without a trailing separator has one key", () => {
  allEqual(["sub", "sub/", "./sub/.", path.join(root, "sub") + path.sep], fold(real("sub")));
  assert.strictEqual(k("."), fold(fs.realpathSync.native(root)));
  assert.strictEqual(k(""), fold(fs.realpathSync.native(root)));
});

test("different files have different keys, and a name prefix is not an ancestor", () => {
  const keys = ["sub/file.txt", "sub/file.txt2", "sub/other.txt", "sub2/file.txt", "sub", "sub/file"].map(k);
  assert.strictEqual(new Set(keys).size, keys.length);
  assert.ok(!k("sub/file.txt2").startsWith(k("sub/file.txt") + "/"));
});

test("a file used as a directory keeps the file key as its ancestor", () => {
  assert.strictEqual(k("sub/file.txt/x/y"), k("sub/file.txt") + "/x/y");
});

test("symlinked directory with a missing file below gives the key of the target directory", (t) => {
  if (!hasDirLink) return t.skip("cannot create a directory link here");
  assert.strictEqual(k("link/new.txt"), k("real/new.txt"));
  assert.strictEqual(pathKey("link/new.txt", root), pathKey("real/new.txt", root));
  assert.strictEqual(k("link"), k("real"));
  assert.strictEqual(k("link/target.txt"), k("real/target.txt"));
  assert.strictEqual(k("link/deeper/new.txt"), k("real/deeper/new.txt"));
});

test("symlinked file gives the key of its target", (t) => {
  if (!hasFileLink) return t.skip("cannot create a file link here");
  assert.strictEqual(k("flink"), k("real/target.txt"));
  assert.strictEqual(pathKey("flink", root), pathKey("real/target.txt", root));
});

test("case variants: conservative Darwin/Windows ordering, distinct Linux paths", () => {
  const variants: [string, string][] = [
    ["ReadMe.md", "README.MD"], // existing
    ["ReadMe.md", "readme.md"],
    ["New.txt", "new.txt"], // missing
    ["sub/NEW.txt", "SUB/new.txt"], // missing file, directory case differs
    ["sub/file.txt", "SUB/File.TXT"], // existing
  ];
  for (const [a, b] of variants) {
    if (platform === "darwin" || folds) assert.strictEqual(k(a), k(b), `${a} vs ${b}`);
    else assert.notStrictEqual(k(a), k(b), `${a} vs ${b}`);
  }
});

test("NFC and NFD spellings: one key on darwin, different keys elsewhere", () => {
  const pairs: [string, string][] = [
    ["caf\u00e9.txt", "cafe\u0301.txt"], // existing
    ["m\u00fcll.txt", "mu\u0308ll.txt"], // missing
  ];
  for (const [nfc, nfd] of pairs) {
    if (platform === "darwin") assert.strictEqual(k(nfc), k(nfd), `${nfc} vs ${nfd}`);
    else assert.notStrictEqual(k(nfc), k(nfd), `${nfc} vs ${nfd}`);
  }
});

test("~ expands to the home directory", () => {
  const home = os.homedir();
  assert.strictEqual(pathKey("~", root), pathKey(home, root));
  assert.strictEqual(pathKey("~/rqw-no-such-file", root), pathKey(path.join(home, "rqw-no-such-file"), root));
  assert.notStrictEqual(pathKey("~", root), undefined);
});

test("file:// URLs name the file they point to", () => {
  const abs = path.join(root, "sub", "file.txt");
  assert.strictEqual(k(pathToFileURL(abs).href), k("sub/file.txt"));
});

test("platform-specific real-path behaviour on windows", { skip: platform !== "win32" }, () => {
  const drive = root[0];
  const tail = root.slice(3).replaceAll("\\", "/"); // after "C:\\"
  allEqual(
    [
      `${drive}:/${tail}/sub/file.txt`,
      `${drive.toLowerCase()}:\\${tail.replaceAll("/", "\\")}\\SUB\\File.txt`,
      `/${drive.toLowerCase()}/${tail}/sub/file.txt`,
      `/cygdrive/${drive.toLowerCase()}/${tail}/sub/file.txt`,
      `/mnt/${drive.toLowerCase()}/${tail}/sub/file.txt`,
    ],
    k("sub/file.txt"),
  );
  // 8.3 short names of an existing parent expand to the long name (the runner's TEMP has RUNNER~1).
  const short = path.join(os.tmpdir(), "rqw-x");
  const long = path.join(fs.realpathSync.native(os.tmpdir()), "rqw-x");
  assert.strictEqual(pathKey(short, root), pathKey(long, root));
});

test("Windows ordinary aliases share native edit/write identities without rewriting stock paths", { skip: platform !== "win32" }, () => {
  const aliases = ["sub/file.txt", "SUB/FILE.TXT", "sub\\file.txt"];
  const identity = fs.statSync(path.join(root, aliases[0]), { bigint: true });
  const edit = editPathKey(aliases[0], root);
  assert.notStrictEqual(edit, undefined);
  const keys = writePathKeys(aliases, root);
  for (const [i, alias] of aliases.entries()) {
    const native = fs.statSync(path.join(root, alias), { bigint: true });
    assert.strictEqual(native.dev, identity.dev, alias);
    assert.strictEqual(native.ino, identity.ino, alias);
    assert.strictEqual(editPathKey(alias, root), edit, alias);
    assert.strictEqual(keys[i].key, keys[0].key, alias);
    assert.strictEqual(keys[i].leaf, keys[0].leaf, alias);
    assert.strictEqual(resolvePath(alias, root), path.resolve(root, alias), "stock spelling stays intact");
  }
});

test("Windows trailing-dot/space identities follow native stat, not conservative ordering", { skip: platform !== "win32" }, () => {
  const plain = "sub/file.txt";
  const identity = fs.statSync(path.join(root, plain), { bigint: true });
  for (const alias of ["sub/file.txt.", "sub/file.txt ", "sub./file.txt. . "]) {
    let native: fs.BigIntStats | undefined;
    try { native = fs.statSync(path.join(root, alias), { bigint: true }); }
    catch (error) { assert.match((error as NodeJS.ErrnoException).code ?? "", /^(ENOENT|ENOTDIR)$/); }
    const same = native?.dev === identity.dev && native?.ino === identity.ino;
    assert.strictEqual(pathKey(alias, root) === pathKey(plain, root), same, alias);
    const keys = writePathKeys([plain, alias], root);
    assert.strictEqual(keys[0].key === keys[1].key, same, alias);
    if (native) {
      assert.notStrictEqual(editPathKey(alias, root), undefined, alias);
      assert.strictEqual(editPathKey(alias, root) === editPathKey(plain, root), same, alias);
      assert.strictEqual(keys[0].leaf === keys[1].leaf, same, alias);
    } else {
      assert.strictEqual(editPathKey(alias, root), undefined, alias);
      assert.strictEqual(keys[1].leaf, undefined, alias);
    }
    assert.strictEqual(k(alias), k(plain), "ordering remains conservative");
    assert.strictEqual(resolvePath(alias, root), path.resolve(root, alias), "stock spelling stays intact");
  }
});

test("Windows extended-created literal trailing dots follow ordinary native identity", { skip: platform !== "win32" }, () => {
  const plain = path.join(root, "sub/file.txt");
  const ordinary = plain + ".";
  const literal = path.toNamespacedPath(ordinary);
  fs.writeFileSync(literal, "literal");
  try {
    const a = fs.statSync(plain, { bigint: true }), b = fs.statSync(literal, { bigint: true });
    assert.notStrictEqual(a.ino, b.ino, "extended spelling creates a distinct native file");
    let native: fs.BigIntStats | undefined;
    try { native = fs.statSync(ordinary, { bigint: true }); }
    catch (error) { assert.strictEqual((error as NodeJS.ErrnoException).code, "ENOENT"); }
    assert.notStrictEqual(pathKey(plain, root), undefined);
    assert.notStrictEqual(pathKey(ordinary, root), pathKey(plain, root));
    assert.notStrictEqual(editPathKey(ordinary, root), editPathKey(plain, root));
    const keys = writePathKeys([plain, ordinary], root);
    assert.notStrictEqual(keys[0].key, keys[1].key);
    if (native) {
      assert.strictEqual(native.dev, b.dev);
      assert.strictEqual(native.ino, b.ino, "Node opens the literal file through the ordinary spelling");
      assert.notStrictEqual(pathKey(ordinary, root), undefined);
      assert.notStrictEqual(editPathKey(ordinary, root), undefined);
      assert.notStrictEqual(keys[1].leaf, undefined);
      assert.notStrictEqual(keys[0].leaf, keys[1].leaf);
    } else {
      assert.strictEqual(editPathKey(ordinary, root), undefined);
      assert.strictEqual(keys[1].leaf, undefined);
    }
  } finally { fs.unlinkSync(literal); }
});

// ---------------------------------------------------------------- string rules of other platforms

test("win32 rules, checked as strings on every host", () => {
  const cwd = "C:\\rqw-t";
  const key = (p: string) => pathKey(p, cwd, "win32", false);
  const same = [
    "C:/rqw-t/Sub/File.txt",
    "c:\\RQW-T\\sub\\file.txt",
    "/c/rqw-t/Sub/File.txt",
    "/C/rqw-t/sub/file.txt",
    "/cygdrive/c/rqw-t/sub/file.txt",
    "/mnt/c/rqw-t/sub/file.txt",
    "Sub/File.txt",
    "sub\\file.txt",
    "./sub/../Sub/File.txt",
    ".\\sub\\..\\Sub\\File.txt",
    "@sub/file.txt",
    "C:/rqw-t/Sub/File.txt.",
    "C:/rqw-t/Sub/File.txt ",
    "C:/rqw-t/Sub/File.txt. . ",
    "C:\\rqw-t\\Sub\\\\File.txt",
    "C:/rqw-t/Sub./File.txt",
    "C:/rqw-t/Sub /File.txt",
    "C:/rqw-t/x/../Sub/File.txt",
    "C:/rqw-t/Sub/File.txt/",
    "C:/rqw-t/Sub/File.txt\\",
  ];
  for (const s of same) assert.strictEqual(key(s), "c:/rqw-t/sub/file.txt", `spelling ${JSON.stringify(s)}`);
  assert.strictEqual(key("C:/"), "c:/");
  assert.strictEqual(key("/c"), "c:/");
  // On a real Windows host an unreachable share fails realpath; undefined then means the safe scope "all".
  for (const unc of ["\\\\Server\\Share\\X", "//server/share/x"]) {
    const k = key(unc);
    if (process.platform === "win32") assert.ok(k === "//server/share/x" || k === undefined, String(k));
    else assert.strictEqual(k, "//server/share/x");
  }
  assert.strictEqual(key("/tmp/x"), "c:/tmp/x", "/tmp is not a drive path, it stays on the cwd drive");
  assert.strictEqual(key("D:/other"), "d:/other");
  assert.notStrictEqual(key("C:/rqw-t/a.txt"), key("C:/rqw-t/b.txt"));
  assert.notStrictEqual(key("C:/rqw-t/a"), key("D:/rqw-t/a"));
  assert.strictEqual(key(".git"), "c:/rqw-t/.git", "a leading dot is not a trailing dot");
});

test("darwin rules, checked as strings on every host", () => {
  const cwd = "/rqw-t";
  const key = (p: string) => pathKey(p, cwd, "darwin", false);
  assert.strictEqual(key("/rqw-t/Caf\u00e9.TXT"), "/rqw-t/caf\u00e9.txt");
  assert.strictEqual(key("Cafe\u0301.txt"), "/rqw-t/caf\u00e9.txt");
  assert.strictEqual(key("./A/../B.md"), "/rqw-t/b.md");
  assert.strictEqual(key("@A.md"), "/rqw-t/a.md");
  assert.strictEqual(key("a.md."), "/rqw-t/a.md.", "no dot stripping on darwin");
});

test("linux keeps case, normalization form and trailing dots", () => {
  const cwd = "/rqw-t";
  const key = (p: string) => pathKey(p, cwd, "linux", false);
  assert.strictEqual(key("A.txt"), "/rqw-t/A.txt");
  assert.notStrictEqual(key("A.txt"), key("a.txt"));
  assert.notStrictEqual(key("caf\u00e9"), key("cafe\u0301"));
  assert.strictEqual(key("a.txt."), "/rqw-t/a.txt.");
  assert.strictEqual(key("a\\b"), "/rqw-t/a\\b", "a backslash is a file name character on linux");
  assert.strictEqual(key("/c/x"), "/c/x", "no drive conversion on linux");
});

// ---------------------------------------------------------------- failure returns undefined

test("failures give undefined and never throw", () => {
  assert.strictEqual(pathKey(wrong(undefined), root), undefined);
  assert.strictEqual(pathKey(wrong(null), root), undefined);
  assert.strictEqual(pathKey(wrong(5), root), undefined);
  assert.strictEqual(pathKey(wrong({}), root), undefined);
  assert.strictEqual(pathKey("a", wrong(undefined)), undefined);
  assert.strictEqual(pathKey("a\0b", root), undefined, "NUL byte in the path");
  assert.strictEqual(pathKey("file://not-a-local-host/x", root, "linux"), undefined, "invalid file URL");
});

test("a symlink loop gives undefined", (t) => {
  if (!hasLoop) return t.skip("cannot create symlinks here");
  assert.strictEqual(pathKey("loop1", root), undefined);
  assert.strictEqual(pathKey("loop1/x", root), undefined);
});

// ---------------------------------------------------------------- scopeOf

const ALL = { kind: "all", keys: [] };

test("scopeOf read, grep and find are read scopes", () => {
  const file = k("sub/file.txt");
  assert.deepStrictEqual(scopeOf("read", { path: "sub/file.txt" }, root), { kind: "read", keys: [file] });
  assert.deepStrictEqual(scopeOf("read", { path: "sub/file.txt", offset: 3, limit: 4 }, root), { kind: "read", keys: [file] });
  assert.deepStrictEqual(scopeOf("read", {}, root), ALL);
  assert.deepStrictEqual(scopeOf("read", { path: 5 }, root), ALL);
  assert.deepStrictEqual(scopeOf("read", { path: "a\0b" }, root), ALL);

  assert.deepStrictEqual(scopeOf("grep", { pattern: "x", path: "sub" }, root), { kind: "read", keys: [k("sub")] });
  assert.deepStrictEqual(scopeOf("grep", { pattern: "x" }, root), { kind: "read", keys: [k(".")] });
  assert.deepStrictEqual(scopeOf("find", { pattern: "*.ts", path: "sub" }, root), { kind: "read", keys: [k("sub")] });
  assert.deepStrictEqual(scopeOf("find", { pattern: "*.ts" }, root), { kind: "read", keys: [k(".")] });
  assert.deepStrictEqual(scopeOf("find", { path: 5 }, root), ALL);
});

test("scopeOf write is a mutate scope over path or files[].path", () => {
  const a = k("sub/a.txt");
  const b = k("sub/b.txt");
  assert.deepStrictEqual(scopeOf("write", { path: "sub/a.txt", content: "x" }, root), { kind: "mutate", keys: [a] });
  assert.deepStrictEqual(
    scopeOf("write", { files: [{ path: "sub/a.txt", content: "1" }, { path: "sub/b.txt", content: "2" }] }, root),
    { kind: "mutate", keys: [a, b] },
  );
  assert.deepStrictEqual(scopeOf("write", { files: [{ path: "sub/a.txt" }, { content: "2" }] }, root), ALL);
  assert.deepStrictEqual(scopeOf("write", { files: [{ path: "sub/a.txt" }, null] }, root), ALL);
  assert.deepStrictEqual(scopeOf("write", { files: [] }, root), ALL);
  assert.deepStrictEqual(scopeOf("write", {}, root), ALL);
  assert.deepStrictEqual(scopeOf("write", { path: 7 }, root), ALL);
});

test("scopeOf edit is a mutate scope over path and every edits[].path", () => {
  const a = k("sub/a.txt");
  const b = k("sub/b.txt");
  const hunk = { oldText: "o", newText: "n" };
  assert.deepStrictEqual(scopeOf("edit", { path: "sub/a.txt", edits: [hunk] }, root), { kind: "mutate", keys: [a] });
  assert.deepStrictEqual(
    scopeOf("edit", { edits: [{ path: "sub/a.txt", ...hunk }, { path: "sub/b.txt", ...hunk }] }, root),
    { kind: "mutate", keys: [a, b] },
  );
  assert.deepStrictEqual(
    scopeOf("edit", { path: "sub/a.txt", edits: [hunk, { path: "sub/b.txt", ...hunk }] }, root),
    { kind: "mutate", keys: [a, b] },
  );
  assert.deepStrictEqual(scopeOf("edit", { path: "sub/a.txt" }, root), { kind: "mutate", keys: [a] });
  assert.deepStrictEqual(scopeOf("edit", { edits: [hunk] }, root), ALL);
  assert.deepStrictEqual(scopeOf("edit", {}, root), ALL);
  assert.deepStrictEqual(scopeOf("edit", { path: "sub/a.txt", edits: [{ path: 5, ...hunk }] }, root), ALL);
});

test("scopeOf bash and unknown tools take everything, bad input never throws", () => {
  assert.deepStrictEqual(scopeOf("bash", { command: "ls" }, root), ALL);
  assert.deepStrictEqual(scopeOf("bash", {}, root), ALL);
  assert.deepStrictEqual(scopeOf("mystery", { path: "sub/file.txt" }, root), ALL);
  assert.deepStrictEqual(scopeOf("", {}, root), ALL);
  for (const tool of ["read", "grep", "find", "write", "edit", "bash"]) {
    assert.deepStrictEqual(scopeOf(tool, undefined, root), ALL, `${tool} with undefined args`);
    assert.deepStrictEqual(scopeOf(tool, null, root), ALL, `${tool} with null args`);
  }
  assert.deepStrictEqual(scopeOf("read", { path: "sub/file.txt" }, wrong(undefined)), ALL);
});

test("scopeOf returns a fresh object each time", () => {
  const first = scopeOf("bash", {}, root);
  first.keys.push("/mutated");
  assert.deepStrictEqual(scopeOf("bash", {}, root), ALL);
});

test("read scope covers every spelling stock read may open, whatever exists now", () => {
  const spellings = readSpellings("Capture d'\u00e9cran 1.30 PM.png", root).map((x) => path.relative(root, x));
  assert.deepStrictEqual(spellings, [
    "Capture d'\u00e9cran 1.30 PM.png",
    "Capture d'\u00e9cran 1.30\u202FPM.png",
    "Capture d'e\u0301cran 1.30 PM.png",
    "Capture d\u2019\u00e9cran 1.30 PM.png",
    "Capture d\u2019e\u0301cran 1.30 PM.png",
  ]);
  assert.deepStrictEqual(readSpellings("plain.txt", root), [path.join(root, "plain.txt")]);
  const keys = scopeOf("read", { path: "it's.txt" }, root).keys;
  for (const name of ["it's.txt", "it\u2019s.txt"]) {
    assert.ok(keys.includes(scopeOf("write", { path: name, content: "" }, root).keys[0]), name);
  }
  assert.strictEqual(new Set(keys).size, keys.length, "keys are deduplicated");
  assert.deepStrictEqual(scopeOf("read", { path: "sub/file.txt" }, root).keys, [k("sub/file.txt")]);
  assert.strictEqual(resolvePath("sub/../ReadMe.md", root), path.join(root, "ReadMe.md"));
  const nfd = "nfd-caf\u0065\u0301.txt";
  if (!folds) {
    assert.ok(scopeOf("read", { path: "nfd-caf\u00e9.txt" }, root).keys.includes(scopeOf("write", { path: nfd, content: "" }, root).keys[0]));
  }
});

test("scopeOf ignores strict-mode empty values", () => {
  const a = k("sub/a.txt");
  const files = [{ path: "sub/a.txt", content: "1" }];
  assert.deepStrictEqual(scopeOf("write", { path: "", content: "", files }, root), { kind: "mutate", keys: [a] });
  assert.deepStrictEqual(scopeOf("write", { path: "sub/a.txt", content: "x", files: [] }, root), { kind: "mutate", keys: [a] });
  assert.deepStrictEqual(scopeOf("write", { path: "", content: "" }, root), ALL);
  const hunk = { oldText: "o", newText: "n" };
  assert.deepStrictEqual(scopeOf("edit", { path: "sub/a.txt", edits: [{ path: "", ...hunk }] }, root), { kind: "mutate", keys: [a] });
  assert.deepStrictEqual(scopeOf("edit", { path: "", edits: [{ path: "sub/a.txt", ...hunk }] }, root), { kind: "mutate", keys: [a] });
});

// Conservative Unicode case keys are not a claim that JS casing is the filesystem's exact collation table.
test("Darwin and Windows conservative Unicode casing closes Sigma and sharp-S variants", () => {
  for (const host of ["darwin", "win32"] as const) {
    const cwd = host === "win32" ? "C:\\rqw-unicode" : "/rqw-unicode";
    for (const names of [["\u03a3.txt", "\u03c3.txt", "\u03c2.txt"], ["\u1e9e.txt", "\u00df.txt", "ss.txt"], ["\u017f.txt", "S.txt", "s.txt"], ["\u039f\u03a3.txt", "\u03bf\u03c3.txt", "\u03bf\u03c2.txt"]]) {
      const keys = names.map((name) => pathKey(name, cwd, host, false));
      assert.ok(keys.every((key) => key !== undefined && key === keys[0]), JSON.stringify({ host, names, keys }));
    }
    assert.notStrictEqual(pathKey("alpha.txt", cwd, host), pathKey("beta.txt", cwd, host));
  }
});

test("Linux string keys retain distinct Unicode case spellings", () => {
  for (const [a, b] of [["\u03a3.txt", "\u03c2.txt"], ["\u1e9e.txt", "\u00df.txt"], ["\u00df.txt", "ss.txt"]]) {
    assert.notStrictEqual(pathKey(a, "/rqw-unicode", "linux"), pathKey(b, "/rqw-unicode", "linux"));
  }
});

test("Darwin ordering policy stays stable when the first cased component is created on a numeric volume", { skip: platform !== "darwin" }, (t) => {
  let created = false;
  const missing = () => { throw Object.assign(new Error("missing"), { code: "ENOENT" }); };
  t.mock.method(fs.realpathSync, "native", (p: fs.PathLike) => {
    const name = String(p);
    if (name === "/123/456/New.txt" && !created) return missing();
    if (name === "/123/456/new.txt") return missing();
    return name;
  });
  t.mock.method(fs, "statSync", (p: fs.PathLike) => {
    if (String(p) === "/123/456/new.txt") return missing();
    return { dev: String(p) === "/" ? 0 : 1, ino: 123, nlink: 1, isFile: () => String(p).endsWith(".txt") };
  });
  const before = scopeOf("write", { path: "New.txt" }, "/123/456");
  assert.deepStrictEqual(before, { kind: "mutate", keys: ["/123/456/new.txt"] });
  created = true;
  assert.deepStrictEqual(scopeOf("write", { path: "New.txt" }, "/123/456"), before);
  assert.deepStrictEqual(scopeOf("read", { path: "New.txt" }, "/123/456").keys, before.keys);
  assert.deepStrictEqual(scopeOf("grep", { path: "New.txt" }, "/123/456").keys, before.keys);
});


test("native grouping keys retain ancestors and cannot merge distinct Unicode files", () => {
  write("identity/\u00df.txt");
  write("identity/ss.txt");
  const a = fs.statSync(path.join(root, "identity/\u00df.txt"));
  const b = fs.statSync(path.join(root, "identity/ss.txt"));
  if (a.dev !== b.dev || a.ino !== b.ino) {
    assert.notStrictEqual(pathKey("identity/\u00df.txt", root), pathKey("identity/ss.txt", root));
  }
  const dir = pathKey("identity", root);
  for (const file of ["identity/\u00df.txt", "identity/ss.txt", "identity/missing/a.txt"]) {
    assert.ok(pathKey(file, root)?.startsWith(dir + "/"), file);
  }
  assert.ok(pathKey("identity/missing/a.txt", root)?.startsWith(pathKey("identity/missing", root) + "/"));
  assert.notStrictEqual(pathKey("identity/not-yet-created.txt", root), pathKey("identity/ss.txt", root));
});


test("an unavailable native file identity never creates a shared grouping key", (t) => {
  const nativeStat = fs.statSync;
  t.mock.method(fs, "statSync", (p: fs.PathLike, options?: fs.StatOptions) => {
    const value = nativeStat(p, options);
    return options?.bigint ? { ...value, ino: 0n } : value;
  });
  assert.strictEqual(pathKey("sub/file.txt", root), undefined);
  assert.strictEqual(scopeOf("write", { path: "sub/file.txt", content: "x" }, root).kind, "mutate");
});
