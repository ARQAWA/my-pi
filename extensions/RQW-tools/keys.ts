// Path resolution and batch-local filesystem identities for multi-file edit and write.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Same spaces Pi folds to " " before it resolves a path.
const UNICODE_SPACES = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g;
// Git Bash, MSYS, Cygwin and WSL drive paths, as Pi reads them: "/c/x" -> "C:\x".
const DRIVE = /^\/(?:mnt\/|cygdrive\/)?([a-z])(?:\/(.*))?$/i;

// The pure string rules. Result is an absolute path in the path flavour of `platform`.
function resolveLexical(p: string, cwd: string, platform: NodeJS.Platform, piArgument = true): string {
  const win = platform === "win32";
  const P = win ? path.win32 : path.posix;
  if (piArgument) {
    p = p.replace(UNICODE_SPACES, " ");
    if (p.startsWith("@")) p = p.slice(1);
  }
  if (win && p.startsWith("/") && !p.startsWith("//") && !p.includes("\\")) {
    const m = DRIVE.exec(p);
    if (m) p = `${m[1].toUpperCase()}:\\${(m[2] ?? "").replaceAll("/", "\\")}`;
  }
  if (p === "~") p = os.homedir();
  else if (p.startsWith("~/") || (win && p.startsWith("~\\"))) p = P.join(os.homedir(), p.slice(2));
  else if (piArgument && p.startsWith("file://")) p = fileURLToPath(p, { windows: win });
  return P.resolve(cwd, p);
}

// realpath of the deepest existing ancestor, then the missing segments. Missing roots keep their spelling.
// Failed realpath may hide an existing dangling link: follow it only for metadata, never for stock arguments.
function canonical(abs: string, P: path.PlatformPath): { key: string; existing?: string; dangling: boolean } {
  const rest: string[] = [];
  const links = new Set<string>();
  let dangling = false;
  for (let cur = abs; ; ) {
    try {
      let existing = fs.realpathSync.native(cur);
      // realpath may drop the extended prefix; retain literal-name semantics for subsequent stats.
      if (process.platform === "win32" && cur.startsWith("\\\\?\\")) existing = P.toNamespacedPath(existing);
      return { key: P.join(existing, ...rest), existing, dangling };
    } catch (e) {
      const code = typeof e === "object" && e !== null && "code" in e ? e.code : undefined;
      if (code !== "ENOENT" && code !== "ENOTDIR") throw e;
      let link = false;
      try { link = fs.lstatSync(cur).isSymbolicLink(); }
      catch (error) {
        if (!["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
      }
      if (link) {
        if (links.has(cur)) throw Object.assign(new Error("Symlink cycle"), { code: "ELOOP" });
        links.add(cur);
        dangling = true;
        const target = fs.readlinkSync(cur);
        // Link targets are native spellings; preserve '..' across other symlinks until realpath resolves them.
        cur = P.isAbsolute(target) ? target : P.dirname(cur) + P.sep + target;
        if (rest.length) cur += P.sep + rest.join(P.sep);
        rest.length = 0;
        continue;
      }
      const parent = P.dirname(cur);
      if (parent === cur) return { key: abs, dangling };
      rest.unshift(P.basename(cur));
      cur = parent;
    }
  }
}

/** Lexical resolution of a path for this platform, the same string rules Pi applies (`resolveToCwd`). */
export function resolvePath(p: string, cwd: string): string {
  return resolveLexical(p, cwd, process.platform);
}

// Locale-independent casing closure, not an exact APFS/Windows collation table. In particular, lowercase alone
// splits Sigma/final sigma; one upper/lower pass still splits capital sharp S from sharp S. The closure may merge
// distinct Unicode names (e.g. dotless I and "i"): it orders those paths but is not a filesystem identity.
function foldCase(value: string): string {
  for (;;) {
    const next = value.toUpperCase().toLowerCase();
    if (next === value) return value;
    value = next;
  }
}

// Ordering is conservative even in case-sensitive namespaces. Its case policy cannot change when a pending
// write creates the first cased component. Filesystem stats are never cached across calls.
function spellingKey(value: string, platform: NodeJS.Platform): string {
  if (platform === "win32") value = value.replaceAll("\\", "/").split("/").map((c) => c.replace(/[. ]+$/, "")).join("/");
  if (platform === "darwin") value = value.normalize("NFC");
  if (platform === "darwin" || platform === "win32") value = foldCase(value);
  return platform === "darwin" ? value.normalize("NFC") : value;
}

type TargetKey = { key: string; leaf?: string };
type Identity = TargetKey & { base?: string; existing?: string; missing?: string };

function nativeIdentity(abs: string): Identity {
  const { key, existing } = canonical(abs, path);
  if (!existing) return { key };
  const components: string[] = [];
  for (let cur = existing; ; cur = path.dirname(cur)) {
    const stat = fs.statSync(cur, { bigint: true });
    if (stat.ino === 0n) throw new Error("Filesystem has no usable file identity");
    components.unshift(`${stat.dev}:${stat.ino}`);
    if (path.dirname(cur) === cur) break;
  }
  const base = "/" + components.join("/");
  const missing = path.relative(existing, key);
  // Missing spellings are not Unicode case identities. Edit only groups existing aliases; batch write below
  // asks the native namespace when different missing spellings might alias.
  const suffix = process.platform === "win32" ? missing.replaceAll("\\", "/") : missing;
  return { key: missing ? base + "/missing:" + suffix : base, base, existing, missing,
    leaf: missing ? undefined : "leaf:" + components[components.length - 1] };
}

// `abs` is already a filesystem spelling, including read fallbacks. Never apply user space/@/URL rules here.
function resolvedKey(abs: string, platform: NodeJS.Platform, identity = false): string | undefined {
  try {
    if (identity && platform === process.platform) return nativeIdentity(abs).key;
    const P = platform === "win32" ? path.win32 : path.posix;
    const key = platform === process.platform ? canonical(abs, P).key : abs;
    return spellingKey(key, platform);
  } catch {
    return undefined;
  }
}

/** Equality only: hardlinks in different parents share a leaf, not a path-shaped ancestor key. */
export function editPathKey(p: string, cwd: string): string | undefined {
  try {
    const abs = resolvePath(p, cwd);
    fs.statSync(abs);
    const identity = nativeIdentity(abs);
    return identity.leaf ?? identity.key;
  } catch { return undefined; }
}

const inside = (a: string, b: string) => b.startsWith(a.endsWith("/") ? a : a + "/");
const related = (a: string, b: string) => a === b || inside(a, b) || inside(b, a);

/** Batch-local validation identities. Only ambiguous, colliding missing spellings need native namespace probes. */
export function writePathKeys(paths: string[], cwd: string, signal?: AbortSignal): TargetKey[] {
  const checkAbort = () => { if (signal?.aborted) throw new Error("Operation aborted"); };
  const entries = paths.map((p): Identity => {
    try { return nativeIdentity(resolvePath(p, cwd)); }
    catch { return { key: path.resolve(cwd, p) }; }
  });
  const keys = entries.map((e) => e.key);
  const edges: [number, number][] = [];
  const probe = new Set<number>();
  for (let i = 0; i < entries.length; i++) {
    const a = entries[i];
    for (let j = i + 1; j < entries.length; j++) {
      const b = entries[j];
      if (!a.base || !b.base) {
        // No native identity means no safe probe parent. Do not turn an ambiguous fallback into permission
        // to overwrite the same target twice; independent paths keep the wrappers usual per-file failures.
        const order = (n: number) => resolvedKey(resolvePath(paths[n], cwd), process.platform)
          ?? spellingKey(path.resolve(cwd, paths[n]), process.platform);
        if (related(order(i), order(j)) && !related(a.key, b.key)) {
          throw new Error("Cannot validate ambiguous filesystem targets without a native parent identity");
        }
        continue;
      }
      if (!a.missing || !b.missing || a.base !== b.base) continue;
      if (!related(spellingKey(a.missing, process.platform), spellingKey(b.missing, process.platform))) continue;
      edges.push([i, j]);
      if (!related(a.key, b.key)) { probe.add(i); probe.add(j); }
    }
  }
  // Keep an entire collision component in one namespace, including literal duplicates and ancestors of a probe.
  for (let changed = true; changed;) {
    changed = false;
    for (const [i, j] of edges) {
      if (probe.has(i) === probe.has(j)) continue;
      probe.add(i); probe.add(j); changed = true;
    }
  }
  const parents = new Map<string, number[]>();
  for (const i of probe) {
    const base = entries[i].base!;
    const group = parents.get(base) ?? [];
    group.push(i);
    parents.set(base, group);
  }
  for (const group of parents.values()) {
    checkAbort();
    // A private child of the same deepest existing parent inherits its native namespace policy. User targets
    // are never created. Directory components let stat answer both equivalence and ancestor relationships.
    const temp = fs.mkdtempSync(path.join(entries[group[0]].existing!, ".rqw-paths-"));
    try {
      for (const i of group) {
        let cur = temp;
        const components: string[] = [];
        for (const part of entries[i].missing!.split(path.sep)) {
          checkAbort();
          cur = path.join(cur, part);
          fs.mkdirSync(cur, { recursive: true });
          const stat = fs.statSync(cur, { bigint: true });
          if (stat.ino === 0n) throw new Error("Filesystem has no usable file identity");
          components.push(`${stat.dev}:${stat.ino}`);
        }
        keys[i] = entries[i].base + "/probe:" + components.join("/");
      }
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
  }
  return keys.map((key, i) => ({ key, leaf: entries[i].leaf }));
}
