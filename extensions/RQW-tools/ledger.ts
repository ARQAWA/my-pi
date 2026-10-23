// Process-wide state shared by every set of RQW-tools tools in one Pi process: the main session, its subagents and
// workers get `createTools` from this same module instance (DECISIONS.md, Tools «Background jobs»: O1, P1, H1, S1).
//
// - The write ledger: who last wrote each file through an RQW tool, when, and the content hash after the write.
// - Last-seen versions per owner: what each session (one job registry) last read or wrote of a file.
// - Per-file critical sections: the P1 check, the write and its record happen together across sessions.
// - Snapshots of the working tree: the boundary state of a bash or codemode job (start and end).
// - Resources: `git:` and `pkg:` holds across sessions, in registration order.
// - Codemode slots: Pi allows a fixed number of live script workers per process.
// - Ports served by running jobs.
//
// Files are keyed by `identityKey` (keys.ts): symlink and case aliases of one file share records. Owners are unique
// per registry (`owner`); `label` ("main", "code_writer#2") is only what notes show.
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { identityKey } from "./keys.ts";

export type Version = { mtimeMs: number; size: number };
type Write = Version & { owner: string; label: string; tool: string; at: number; hash?: string; path: string };

const writes = new Map<string, Write>();
const seen = new Map<string, Map<string, Version & { at: number }>>();

export const idOf = (file: string) => identityKey(file);

export function stat(file: string): Version | undefined {
  try {
    const s = fs.statSync(file);
    return s.isFile() ? { mtimeMs: s.mtimeMs, size: s.size } : undefined;
  } catch { return undefined; }
}

export const same = (a: Version | undefined, b: Version | undefined) => !!a && !!b && a.mtimeMs === b.mtimeMs && a.size === b.size;

function hashOf(file: string): string | undefined {
  try { return createHash("sha1").update(fs.readFileSync(file)).digest("hex"); } catch { return undefined; }
}

const clock = (ms: number) => new Date(ms).toTimeString().slice(0, 8);
const ago = (ms: number) => `${Math.max(0, Math.round((Date.now() - ms) / 1000))} s ago`;

function seenOf(owner: string) {
  let m = seen.get(owner);
  if (!m) seen.set(owner, (m = new Map()));
  return m;
}

// Files an owner's cancelled write may or may not have changed ("Possibly changed" in its result).
const uncertain = new Map<string, Set<string>>();

/**
 * Own writes kept for the effects reports of the owner's running bash and codemode jobs. A job watches from its start
 * until its report is built; entries are kept only while some job of the owner watches, and dropped when none does.
 */
export type OwnWrite = Version & { id: string; path: string; tool: string; at: number; hash?: string };
const history = new Map<string, { watchers: number; entries: OwnWrite[] }>();

export function watchOwnWrites(owner: string): () => void {
  let h = history.get(owner);
  if (!h) history.set(owner, (h = { watchers: 0, entries: [] }));
  h.watchers++;
  let done = false;
  return () => {
    if (done) return;
    done = true;
    const now = history.get(owner);
    if (now && --now.watchers <= 0) history.delete(owner);
  };
}

/** Tests: the own writes kept for an owner now (undefined when no job watches). */
export const keptOwnWrites = (owner: string) => history.get(owner)?.entries.length;

/** An owner read the file: its current version is what the owner knows. */
export function recordSeen(owner: string, file: string, version = stat(file)) {
  uncertain.get(owner)?.delete(idOf(file));
  if (version) seenOf(owner).set(idOf(file), { ...version, at: Date.now() });
  else seenOf(owner).delete(idOf(file));
}

/** An owner's write was cancelled after it may have committed: its next write of the file is refused once. */
export function recordUncertain(owner: string, file: string) {
  let set = uncertain.get(owner);
  if (!set) uncertain.set(owner, (set = new Set()));
  set.add(idOf(file));
}

/** An owner wrote the file through an RQW tool (or a foreground bash command named it as written). */
export function recordWrite(owner: string, label: string, tool: string, file: string) {
  const version = stat(file);
  const id = idOf(file);
  if (!version) { writes.delete(id); seenOf(owner).delete(id); uncertain.get(owner)?.delete(id); return; }
  const at = Date.now();
  const hash = hashOf(file);
  writes.set(id, { ...version, owner, label, tool, at, hash, path: file });
  history.get(owner)?.entries.push({ ...version, id, path: file, tool, at, hash });
  recordSeen(owner, file, version);
}

export function lastSeen(owner: string, file: string) { return seen.get(owner)?.get(idOf(file)); }
export function lastWrite(file: string) { return writes.get(idOf(file)); }

/** A registry ended: its observations go (a restarted session with the same label starts with none). */
export function forgetOwner(owner: string) { seen.delete(owner); uncertain.delete(owner); history.delete(owner); }

/**
 * The owner's own writes between two times, the last one per file (the effects report: "you changed while it ran"),
 * from the history its watching job kept, whoever wrote the file after them.
 */
export function ownWritesBetween(owner: string, from: number, to: number): { file: string; id: string; write: OwnWrite }[] {
  const last = new Map<string, OwnWrite>();
  for (const e of history.get(owner)?.entries ?? []) if (e.at >= from && e.at <= to) last.set(e.id, e);
  return [...last.values()].map((write) => ({ file: write.path, id: write.id, write }));
}

/** The file no longer holds what this own write left: a lost update. */
export function overwritten(write: OwnWrite): boolean {
  const now = stat(write.path);
  if (!now) return true;
  if (same(now, write)) return false;
  return hashOf(write.path) !== write.hash;
}

/** A running bash or codemode job of the caller; `changed` compares the file with the job's start snapshot. */
export type RunningJob = { id: string; command: string; startedAt: number; changed(file: string): boolean };

/**
 * The evidence note for a read, edit or write of `file` by `owner`, or undefined. A note needs evidence: another
 * session wrote the file after this owner last saw it, or it differs from the start snapshot of a running job.
 */
export function changeNote(owner: string, file: string, display: string, running: RunningJob[]): string | undefined {
  const now = stat(file);
  if (!now) return undefined;
  const own = lastSeen(owner, file);
  if (own && same(now, own)) return undefined;
  const w = lastWrite(file);
  if (w && same(now, w)) {
    if (w.owner === owner) return undefined;
    if (own && w.at >= own.at) return `note: ${display} was changed by ${w.label} (${w.tool}, ${clock(w.at)}) after you last saw it.`;
    return undefined;
  }
  const during = running.filter((j) => j.changed(file));
  if (!during.length) return undefined;
  const jobs = during.map((j) => `${j.id} (${j.command.length > 60 ? j.command.slice(0, 60) + "…" : j.command})`).join(", ");
  const target = during.length === 1 ? during[0].id : "the job";
  return `note: ${display} changed ${ago(now.mtimeMs)} outside your tools while ${jobs} ${during.length > 1 ? "run" : "runs"}; wait for ${target} if it writes this file.`;
}

/**
 * P1: a write over a file this owner has seen, changed since by anyone else, is refused once. Returns the message, or
 * undefined when the write may go ahead. Call it inside `withFileLock` with the write itself.
 */
export function writeConflict(owner: string, file: string, display: string, running: RunningJob[]): string | undefined {
  if (uncertain.get(owner)?.has(idOf(file)) && stat(file))
    return `${display} may have been changed by your own cancelled write (its result said "Possibly changed"); its content is unknown.`;
  const own = lastSeen(owner, file);
  if (!own) return undefined;
  const now = stat(file);
  if (!now || same(now, own)) return undefined;
  const w = lastWrite(file);
  let who: string;
  if (w && same(now, w)) {
    if (w.owner === owner) return undefined;
    who = `by ${w.label} (${w.tool}, ${clock(w.at)})`;
  } else {
    const during = running.filter((j) => j.changed(file)).map((j) => j.id);
    who = `outside your tools, ${ago(now.mtimeMs)}${during.length ? `, while ${during.join(", ")} ran` : ""}`;
  }
  return `${display} changed after you last read it (${who}).`;
}

// ---------- per-file critical sections ----------

const locks = new Map<string, Promise<void>>();

/**
 * Runs `work` holding the locks of `files` (by identity, acquired in sorted order: no deadlock between multi-file
 * calls). Every RQW read, edit and write of every session runs its ledger check, the stock tool and its record inside
 * it, so two sessions cannot both pass the P1 check on the same version and then write one after the other.
 */
export async function withFileLock<T>(files: string[], work: () => Promise<T>): Promise<T> {
  const ids = [...new Set(files.map(idOf))].sort();
  const releases: (() => void)[] = [];
  try {
    for (const id of ids) {
      const before = locks.get(id) ?? Promise.resolve();
      const mine = Promise.withResolvers<void>();
      const tail = before.then(() => mine.promise);
      locks.set(id, tail);
      releases.push(() => { mine.resolve(); if (locks.get(id) === tail) locks.delete(id); });
      await before;
    }
    return await work();
  } finally {
    for (const release of releases) release();
  }
}

// ---------- file list and the effects scan ----------

const IGNORED = new Set([".git", "node_modules", ".next", "target", ".venv", "__pycache__"]);
const WALK_LIMIT = 20000;

/** Existing files; `complete` is false when a walk stopped at its limit. */
export type FileList = { files: string[]; via: string; complete: boolean };

function walk(root: string): FileList {
  const out: string[] = [];
  const stack = [root];
  while (stack.length && out.length < WALK_LIMIT) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (IGNORED.has(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile()) out.push(p);
    }
  }
  const complete = !(stack.length || out.length >= WALK_LIMIT);
  return { files: out, via: `a walk without node_modules and similar folders${complete ? "" : `, stopped at ${WALK_LIMIT} files`}`, complete };
}

/**
 * The existing files of the working tree: `git ls-files -co --exclude-standard` (tracked and untracked, without
 * git-ignored ones; a tracked file deleted from the tree is left out), or outside git a walk of at most 20000 files
 * without .git, node_modules, .next, target, .venv and __pycache__.
 */
export function listFiles(cwd: string, signal?: AbortSignal): Promise<FileList> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("cancelled"));
    // No deadline: `signal` (the job's lifetime) cancels it.
    execFile("git", ["ls-files", "-co", "--exclude-standard", "-z"], { cwd, maxBuffer: 1024 * 1024 * 1024, signal,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", LC_ALL: "C" }, windowsHide: true }, (error, stdout, stderr) => {
      if (signal?.aborted) return reject(new Error("cancelled"));
      if (error) {
        // Outside a repository git fails at once; any other failure is named in `via`.
        const outside = /not a git repository/i.test(`${stderr}\n${error.message}`);
        const listed = walk(cwd);
        return resolve(outside ? listed : { ...listed, via: `${listed.via} (git ls-files failed: ${error.message.split("\n")[0]})` });
      }
      const files = [...new Set(stdout.split("\0").filter(Boolean).map((f) => path.resolve(cwd, f)))].filter((f) => fs.existsSync(f));
      resolve({ files, via: "git ls-files: tracked and untracked, without git-ignored ones", complete: true });
    });
  });
}

/**
 * The boundary state of a bash or codemode job: every listed file (see `listFiles`) with its mtime and size, keyed by
 * its real path. Taken before the command starts and when it ends; `ms` is what it cost.
 */
export type Snapshot = { base: string; files: Map<string, Version>; via: string; complete: boolean; ms: number };

export async function snapshot(cwd: string, signal?: AbortSignal): Promise<Snapshot> {
  const started = performance.now();
  let base = cwd;
  try { base = fs.realpathSync.native(cwd); } catch {}
  const listed = await listFiles(base, signal);
  const files = new Map<string, Version>();
  for (const f of listed.files) {
    const v = stat(f);
    if (v) files.set(f, v);
  }
  return { base, files, via: listed.via, complete: listed.complete, ms: Math.round(performance.now() - started) };
}

const realOf = (file: string) => { try { return fs.realpathSync.native(file); } catch { return undefined; } };

/**
 * Whether `file` changed since the snapshot. A listed file compares its mtime and size with the snapshot, so a file
 * written just before the snapshot is not a change whatever the clocks say. A file the snapshot does not list (created
 * after it, git-ignored, outside the working tree) falls back to its mtime against the job's start.
 */
export function changedAgainst(s: Snapshot | undefined, file: string, startedAt: number): boolean {
  const now = stat(file);
  const real = realOf(file);
  const before = s && real ? s.files.get(real) : undefined;
  if (before) return !now || !same(before, now);
  return !!now && now.mtimeMs >= startedAt;
}

// ---------- resources (git:, pkg:) across sessions ----------

type Claim = { hold: string[]; use: string[]; done: Promise<void>; finished: boolean; label: () => string };
const claims = new Set<Claim>();

/**
 * Takes the `git:`/`pkg:` resources of one bash call: `hold` (it changes them) and `use` (it needs them). It waits for
 * every earlier unfinished claim that holds what it holds or uses, or uses what it holds. Release by calling the
 * returned function. `blockers` names what it waits for while it waits.
 */
export function claim(hold: string[], use: string[], label: () => string, signal: AbortSignal): { ready: Promise<void>; release: () => void; blockers: () => string[] } {
  const earlier = [...claims].filter((c) => c.hold.some((t) => hold.includes(t) || use.includes(t)) || c.use.some((t) => hold.includes(t)));
  const finished = Promise.withResolvers<void>();
  const own: Claim = { hold, use, done: finished.promise, finished: false, label };
  if (hold.length || use.length) claims.add(own);
  const release = () => { own.finished = true; claims.delete(own); finished.resolve(); };
  const aborted = new Promise<void>((resolve) => {
    if (signal.aborted) resolve();
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
  const ready = Promise.race([Promise.all(earlier.map((c) => c.done)).then(() => {}), aborted]);
  return { ready, release, blockers: () => earlier.filter((c) => !c.finished).map((c) => c.label()) };
}

// ---------- codemode slots (S1) ----------

type SlotWaiter = { grant: () => void };
const slots = { used: 0, waiters: [] as SlotWaiter[] };
export const codemodeLimit = () => Number(process.env.PI_CODEMODE_MAX_WORKERS) > 0 ? Number(process.env.PI_CODEMODE_MAX_WORKERS) : 2;
export const codemodeInUse = () => slots.used;

/** Hands free slots to waiters in order. An aborted waiter has left the queue, so a wakeup is never lost. */
function grantSlots() {
  while (slots.used < codemodeLimit() && slots.waiters.length) slots.waiters.shift()!.grant();
}

/** Waits for a free codemode worker slot (or the abort), then holds it until `release`. */
export function codemodeSlot(signal: AbortSignal): Promise<() => void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error("Operation aborted"));
    const take = () => {
      slots.used++;
      let released = false;
      resolve(() => {
        if (released) return;
        released = true;
        slots.used--;
        grantSlots();
      });
    };
    if (slots.used < codemodeLimit() && !slots.waiters.length) return take();
    const waiter: SlotWaiter = { grant: () => { signal.removeEventListener("abort", leave); take(); } };
    // Leaving and being granted both run synchronously on the event loop: a waiter is either granted or removed.
    const leave = () => {
      const at = slots.waiters.indexOf(waiter);
      if (at >= 0) slots.waiters.splice(at, 1);
      reject(new Error("Operation aborted"));
    };
    slots.waiters.push(waiter);
    signal.addEventListener("abort", leave, { once: true });
  });
}

// ---------- ports served by running jobs ----------

const ports = new Map<number, string>();
export function servePorts(list: number[], label: string): () => void {
  for (const p of list) ports.set(p, label);
  return () => { for (const p of list) if (ports.get(p) === label) ports.delete(p); };
}
export function servedBy(port: number): string | undefined { return ports.get(port); }

/** Tests only: forget everything. */
export function resetLedger() {
  locks.clear();
  uncertain.clear();
  history.clear();
  writes.clear();
  seen.clear();
  claims.clear();
  ports.clear();
  slots.used = 0;
  slots.waiters.length = 0;
}
