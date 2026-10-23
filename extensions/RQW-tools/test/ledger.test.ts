// The process-wide ledger (ledger.ts; DECISIONS.md, Tools «Background jobs»: O1, P1, H1, S1): attribution of writes,
// evidence notes, the write precondition, the file list scan, cross-session resource claims and codemode slots.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  changedAgainst, changeNote, claim, codemodeInUse, codemodeSlot, forgetOwner, keptOwnWrites, listFiles, overwritten, ownWritesBetween, recordUncertain, watchOwnWrites,
  recordSeen, recordWrite, resetLedger, snapshot, withFileLock, writeConflict,
} from "../ledger.ts";

/** A running job for the note functions: `changed` says whether the file differs from its start. */
const job = (id: string, command: string, changed: (f: string) => boolean = () => true) => ({ id, command, startedAt: 0, changed });

const dir = () => realpathSync(mkdtempSync(join(tmpdir(), "rqw-ledger-")));
const drain = async () => { for (let i = 0; i < 20; i++) await new Promise<void>((r) => setImmediate(r)); };
/** Rewrites a file with a later mtime, so stat sees a new version whatever the file system resolution. */
function touch(file: string, content: string, offsetS = 5) {
  writeFileSync(file, content);
  const t = new Date(Date.now() + offsetS * 1000);
  utimesSync(file, t, t);
}

test("own writes are attributed to the session; a foreign session's write gives a note after the last seen version", () => {
  resetLedger();
  const d = dir();
  const f = join(d, "a.ts");
  writeFileSync(f, "1");
  recordSeen("main", f);
  assert.equal(changeNote("main", f, "a.ts", []), undefined, "seen version: no note");
  touch(f, "22");
  const unwatch = watchOwnWrites("code_writer#2");
  recordWrite("code_writer#2", "code_writer#2", "edit", f);
  assert.match(changeNote("main", f, "a.ts", [])!, /^note: a\.ts was changed by code_writer#2 \(edit, \d\d:\d\d:\d\d\) after you last saw it\.$/);
  assert.equal(changeNote("code_writer#2", f, "a.ts", []), undefined, "its own write: no note");
  const mine = ownWritesBetween("code_writer#2", 0, Date.now() + 1);
  assert.deepEqual(mine.map((m) => [m.file, m.write.tool]), [[f, "edit"]]);
  assert.deepEqual(ownWritesBetween("main", 0, Date.now() + 1), []);
  unwatch();
  assert.equal(keptOwnWrites("code_writer#2"), undefined, "no watching job: nothing kept");
});

test("own-write history: kept only while a job watches; another session's later write does not erase it", () => {
  resetLedger();
  const d = dir();
  const f = join(d, "h.ts");
  writeFileSync(f, "1");
  recordWrite("main", "main", "edit", f);
  assert.equal(keptOwnWrites("main"), undefined, "written with no job watching: not kept");
  const a = watchOwnWrites("main");
  const b = watchOwnWrites("main");
  touch(f, "main's");
  recordWrite("main", "main", "edit", f);
  touch(f, "other's, longer", 10);
  recordWrite("code_writer#2", "code_writer#2", "write", f);
  const mine = ownWritesBetween("main", 0, Date.now() + 1);
  assert.deepEqual(mine.map((m) => m.write.tool), ["edit"]);
  assert.equal(overwritten(mine[0].write), true);
  a();
  assert.equal(keptOwnWrites("main"), 1, "still watched by the other job");
  b();
  assert.equal(keptOwnWrites("main"), undefined);
});

test("a possibly changed own write makes the next write of the file refused once", () => {
  resetLedger();
  const d = dir();
  const f = join(d, "u.ts");
  writeFileSync(f, "?");
  recordUncertain("main", f);
  assert.match(writeConflict("main", f, "u.ts", [])!, /may have been changed by your own cancelled write/);
  recordSeen("main", f);
  assert.equal(writeConflict("main", f, "u.ts", []), undefined, "read again: known");
});

test("a change outside the tools is noted only while a running job's start state differs", () => {
  resetLedger();
  const d = dir();
  const f = join(d, "gen.txt");
  writeFileSync(f, "1");
  recordSeen("main", f);
  touch(f, "outside");
  assert.equal(changeNote("main", f, "gen.txt", []), undefined, "no running job: no note");
  assert.match(changeNote("main", f, "gen.txt", [job("job#1", "make")])!, /^note: gen\.txt changed \d+ s ago outside your tools while job#1 \(make\) runs; wait for job#1 if it writes this file\.$/);
  assert.equal(changeNote("main", f, "gen.txt", [job("job#2", "make", () => false)]), undefined, "unchanged since the job started");
});

test("P1: a write over a seen file someone else changed is a conflict; own writes and unseen files are not", () => {
  resetLedger();
  const d = dir();
  const f = join(d, "c.ts");
  writeFileSync(f, "1");
  assert.equal(writeConflict("main", f, "c.ts", []), undefined, "never seen: blind write is allowed");
  recordSeen("main", f);
  assert.equal(writeConflict("main", f, "c.ts", []), undefined);
  touch(f, "other");
  recordWrite("shell_runner#1", "shell_runner#1", "write", f);
  assert.match(writeConflict("main", f, "c.ts", [])!, /^c\.ts changed after you last read it \(by shell_runner#1 \(write, /);
  recordSeen("main", f);
  assert.equal(writeConflict("main", f, "c.ts", []), undefined, "read again: no conflict");
  touch(f, "outside!", 10);
  assert.match(writeConflict("main", f, "c.ts", [job("job#4", "x")])!, /outside your tools, \d+ s ago, while job#4 ran\)/);
});

test("overwritten: the content differs from this session's own last write", () => {
  resetLedger();
  const d = dir();
  const f = join(d, "o.ts");
  writeFileSync(f, "mine");
  const unwatch = watchOwnWrites("main");
  recordWrite("main", "main", "edit", f);
  const [own] = ownWritesBetween("main", 0, Date.now() + 1);
  assert.equal(overwritten(own.write), false);
  touch(f, "theirs");
  assert.equal(overwritten(own.write), true);
  unwatch();
});

test("the file list has tracked and untracked files without ignored ones; a snapshot compares states, not times", async () => {
  const d = dir();
  execFileSync("git", ["init", "-q"], { cwd: d });
  writeFileSync(join(d, ".gitignore"), "ignored/\n");
  mkdirSync(join(d, "ignored"));
  mkdirSync(join(d, "src"));
  writeFileSync(join(d, "ignored", "x.txt"), "");
  writeFileSync(join(d, "src", "a.ts"), "");
  writeFileSync(join(d, "b.ts"), "");
  const listed = await listFiles(d);
  assert.match(listed.via, /^git ls-files/);
  assert.deepEqual(listed.files.sort(), [join(d, ".gitignore"), join(d, "b.ts"), join(d, "src", "a.ts")].sort());
  // b.ts was written just now, before the snapshot, possibly in the same clock tick: it is not a change. a.ts is.
  const before = await snapshot(d);
  const startedAt = Date.now();
  assert.ok(before.ms >= 0);
  assert.equal(changedAgainst(before, join(d, "b.ts"), startedAt), false);
  touch(join(d, "src", "a.ts"), "x");
  assert.equal(changedAgainst(before, join(d, "src", "a.ts"), startedAt), true);
  // A file the snapshot does not list (git-ignored) falls back to its mtime against the start.
  touch(join(d, "ignored", "x.txt"), "x");
  assert.equal(changedAgainst(before, join(d, "ignored", "x.txt"), startedAt), true);
  // A tracked file deleted from the tree is not listed (deletions are what the start list has and the end list lacks).
  execFileSync("git", ["add", "b.ts"], { cwd: d });
  rmSync(join(d, "b.ts"));
  assert.ok(!(await listFiles(d)).files.includes(join(d, "b.ts")));
  // Outside git: a walk that skips node_modules and similar folders.
  const plain = dir();
  mkdirSync(join(plain, "node_modules"));
  writeFileSync(join(plain, "node_modules", "dep.js"), "");
  writeFileSync(join(plain, "main.js"), "");
  const walked = await listFiles(plain);
  assert.match(walked.via, /^a walk without node_modules/);
  assert.deepEqual(walked.files, [join(plain, "main.js")]);
  assert.equal(walked.complete, true);
  // A cancelled scan rejects (the caller reports it); a failing git is named, never silent.
  const ac = new AbortController();
  ac.abort();
  await assert.rejects(listFiles(plain, ac.signal), /cancelled/);
  const missing = await listFiles(join(plain, "no-such-dir"));
  assert.match(missing.via, /git ls-files failed/);
  rmSync(d, { recursive: true, force: true });
});

test("claims across sessions: a hold waits for earlier holds and uses of its resource; uses wait only for holds", async () => {
  resetLedger();
  const signal = new AbortController().signal;
  const install = claim(["pkg:/r"], [], () => "job#1 of code_writer#2 (holds package folder .)", signal);
  await install.ready;
  const test1 = claim([], ["pkg:/r"], () => "main", signal);
  const other = claim([], ["pkg:/other"], () => "main", signal);
  let ran = false;
  void test1.ready.then(() => { ran = true; });
  await other.ready;
  await drain();
  assert.equal(ran, false);
  assert.deepEqual(test1.blockers(), ["job#1 of code_writer#2 (holds package folder .)"]);
  install.release();
  await drain();
  assert.equal(ran, true);
  // Two uses do not wait for each other; a hold waits for a use.
  const use2 = claim([], ["pkg:/r"], () => "x", signal);
  await use2.ready;
  const reinstall = claim(["pkg:/r"], [], () => "y", signal);
  let reran = false;
  void reinstall.ready.then(() => { reran = true; });
  await drain();
  assert.equal(reran, false);
  test1.release();
  use2.release();
  await drain();
  assert.equal(reran, true);
  reinstall.release();
  other.release();
  // An aborted claim stops waiting.
  const blocker = claim(["git:/r"], [], () => "z", signal);
  const ac = new AbortController();
  const waiting = claim(["git:/r"], [], () => "w", ac.signal);
  ac.abort();
  await waiting.ready;
  waiting.release();
  blocker.release();
});

test("codemode slots: an aborted waiter leaves the queue, so a release wakes the live waiter behind it", async () => {
  resetLedger();
  const prev = process.env.PI_CODEMODE_MAX_WORKERS;
  delete process.env.PI_CODEMODE_MAX_WORKERS;
  try {
    const signal = new AbortController().signal;
    const one = await codemodeSlot(signal);
    const two = await codemodeSlot(signal);
    const acA = new AbortController();
    const a = codemodeSlot(acA.signal);
    acA.abort();
    await assert.rejects(a, /aborted/);
    let b: (() => void) | undefined;
    void codemodeSlot(signal).then((r) => { b = r; });
    one();
    await drain();
    assert.ok(b, "B starts after one release while the other slot is still taken");
    assert.equal(codemodeInUse(), 2);
    two();
    b!();
    assert.equal(codemodeInUse(), 0);
  } finally {
    if (prev === undefined) delete process.env.PI_CODEMODE_MAX_WORKERS;
    else process.env.PI_CODEMODE_MAX_WORKERS = prev;
  }
});

test("per-file critical sections: two sessions that read one version cannot both pass P1; locks of several files never deadlock", async () => {
  resetLedger();
  const d = dir();
  const f = join(d, "shared.ts");
  writeFileSync(f, "v1");
  recordSeen("A", f);
  recordSeen("B", f);
  const outcomes: string[] = [];
  const write = (owner: string, content: string) => withFileLock([f], async () => {
    const conflict = writeConflict(owner, f, "shared.ts", []);
    if (conflict) { outcomes.push(`${owner} refused`); return; }
    await new Promise((r) => setTimeout(r, 20)); // the stock write takes time
    writeFileSync(f, content);
    const t = new Date(Date.now() + (owner === "A" ? 5000 : 10000));
    utimesSync(f, t, t);
    recordWrite(owner, owner, "write", f);
    outcomes.push(`${owner} wrote`);
  });
  await Promise.all([write("A", "from A"), write("B", "from B, longer")]);
  assert.deepEqual(outcomes, ["A wrote", "B refused"]);
  // Opposite orders of two files: sorted acquisition, both finish.
  const g = join(d, "other.ts");
  const order: string[] = [];
  await Promise.all([
    withFileLock([f, g], async () => { await new Promise((r) => setTimeout(r, 10)); order.push("fg"); }),
    withFileLock([g, f], async () => { order.push("gf"); }),
  ]);
  assert.deepEqual(order, ["fg", "gf"]);
});

test("aliases: a symlink and another case spelling share one file's records", () => {
  resetLedger();
  const d = dir();
  const real = join(d, "Real.txt");
  writeFileSync(real, "1");
  const link = join(d, "link.txt");
  symlinkSync(real, link);
  recordSeen("main", link);
  touch(real, "changed");
  recordWrite("code_writer#2", "code_writer#2", "write", real);
  assert.match(writeConflict("main", link, "link.txt", [])!, /changed after you last read it \(by code_writer#2/);
  // A case-insensitive volume (macOS default, Windows): another case spelling is the same file.
  if (existsSync(join(d, "real.txt"))) {
    assert.match(writeConflict("main", join(d, "real.txt"), "real.txt", [])!, /changed after you last read it/);
  }
});

test("owners are registries, labels only names: a restarted session with the same label inherits nothing", () => {
  resetLedger();
  const d = dir();
  const f = join(d, "x.ts");
  writeFileSync(f, "1");
  recordSeen("code_writer#2~old", f);
  recordWrite("code_writer#2~old", "code_writer#2", "edit", f);
  forgetOwner("code_writer#2~old");
  touch(f, "outside");
  assert.equal(writeConflict("code_writer#2~new", f, "x.ts", []), undefined, "the new registry never saw the file");
  touch(f, "again", 10);
  recordWrite("code_writer#2~old2", "code_writer#2", "edit", f);
  recordSeen("code_writer#2~new", f);
  touch(f, "third", 15);
  recordWrite("code_writer#2~old2", "code_writer#2", "edit", f);
  assert.match(changeNote("code_writer#2~new", f, "x.ts", [])!, /changed by code_writer#2 \(edit/, "same label, other registry: not its own write");
});

test("codemode slots: the third script waits for a free worker; abort stops waiting", async () => {
  resetLedger();
  const prev = process.env.PI_CODEMODE_MAX_WORKERS;
  delete process.env.PI_CODEMODE_MAX_WORKERS;
  try {
    const signal = new AbortController().signal;
    const a = await codemodeSlot(signal);
    const b = await codemodeSlot(signal);
    assert.equal(codemodeInUse(), 2);
    let third: (() => void) | undefined;
    void codemodeSlot(signal).then((r) => { third = r; });
    const ac = new AbortController();
    const aborted = codemodeSlot(ac.signal);
    await drain();
    assert.equal(third, undefined);
    ac.abort();
    await assert.rejects(aborted);
    a();
    await drain();
    assert.ok(third, "a released slot goes to the waiting script");
    a();
    assert.equal(codemodeInUse(), 2, "a second release of the same slot does nothing");
    b();
    third!();
    assert.equal(codemodeInUse(), 0);
  } finally {
    if (prev === undefined) delete process.env.PI_CODEMODE_MAX_WORKERS;
    else process.env.PI_CODEMODE_MAX_WORKERS = prev;
  }
});
