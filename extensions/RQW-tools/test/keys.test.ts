// Layer 2 of notes/analysis-races.md section 7: the path key on a real temp dir, plus the string rules of the other
// platforms checked with an explicit `platform` argument (they need no file system).
import test, { after } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { pathKey, readSpellings, resolvePath, scopeOf } from "../keys.ts";

// Values of the wrong type on purpose, to see that the key function refuses them.
const wrong = (v: unknown) => v as string;

const platform = process.platform;
const folds = platform === "darwin" || platform === "win32"; // case-insensitive file systems by default

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
  const key = pathKey(p, root);
  assert.notStrictEqual(key, undefined, `no key for ${JSON.stringify(p)}`);
  return key as string;
};
const allEqual = (spellings: string[], expected: string) => {
  for (const s of spellings) assert.strictEqual(k(s), expected, `spelling ${JSON.stringify(s)}`);
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
  assert.strictEqual(k("link"), k("real"));
  assert.strictEqual(k("link/target.txt"), k("real/target.txt"));
  assert.strictEqual(k("link/deeper/new.txt"), k("real/deeper/new.txt"));
});

test("symlinked file gives the key of its target", (t) => {
  if (!hasFileLink) return t.skip("cannot create a file link here");
  assert.strictEqual(k("flink"), k("real/target.txt"));
});

test("case variants: one key on darwin and win32, kept apart on linux", () => {
  const variants: [string, string][] = [
    ["ReadMe.md", "README.MD"], // existing
    ["ReadMe.md", "readme.md"],
    ["New.txt", "new.txt"], // missing
    ["sub/NEW.txt", "SUB/new.txt"], // missing file, directory case differs
    ["sub/file.txt", "SUB/File.TXT"], // existing
  ];
  for (const [a, b] of variants) {
    if (folds) assert.strictEqual(k(a), k(b), `${a} vs ${b}`);
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
      `${drive}:/${tail}/sub/file.txt.`,
      `${drive}:/${tail}/sub/file.txt `,
    ],
    k("sub/file.txt"),
  );
  // 8.3 short names of an existing parent expand to the long name (the runner's TEMP has RUNNER~1).
  const short = path.join(os.tmpdir(), "rqw-x");
  const long = path.join(fs.realpathSync.native(os.tmpdir()), "rqw-x");
  assert.strictEqual(pathKey(short, root), pathKey(long, root));
});

// ---------------------------------------------------------------- string rules of other platforms

test("win32 rules, checked as strings on every host", () => {
  const cwd = "C:\\rqw-t";
  const key = (p: string) => pathKey(p, cwd, "win32");
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
  const key = (p: string) => pathKey(p, cwd, "darwin");
  assert.strictEqual(key("/rqw-t/Caf\u00e9.TXT"), "/rqw-t/caf\u00e9.txt");
  assert.strictEqual(key("Cafe\u0301.txt"), "/rqw-t/caf\u00e9.txt");
  assert.strictEqual(key("./A/../B.md"), "/rqw-t/b.md");
  assert.strictEqual(key("@A.md"), "/rqw-t/a.md");
  assert.strictEqual(key("a.md."), "/rqw-t/a.md.", "no dot stripping on darwin");
});

test("linux keeps case, normalization form and trailing dots", () => {
  const cwd = "/rqw-t";
  const key = (p: string) => pathKey(p, cwd, "linux");
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
