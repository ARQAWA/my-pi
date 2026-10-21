// Path key (notes/analysis-races.md section 4) and the scope of a tool call for the barrier.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Scope } from "./barrier.ts";

// Same spaces Pi folds to " " before it resolves a path.
const UNICODE_SPACES = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g;
// Git Bash, MSYS, Cygwin and WSL drive paths, as Pi reads them: "/c/x" -> "C:\x".
const DRIVE = /^\/(?:mnt\/|cygdrive\/)?([a-z])(?:\/(.*))?$/i;

// The pure string rules. Result is an absolute path in the path flavour of `platform`.
function resolveLexical(p: string, cwd: string, platform: NodeJS.Platform): string {
  const win = platform === "win32";
  const P = win ? path.win32 : path.posix;
  p = p.replace(UNICODE_SPACES, " ");
  if (p.startsWith("@")) p = p.slice(1);
  if (win && p.startsWith("/") && !p.startsWith("//") && !p.includes("\\")) {
    const m = DRIVE.exec(p);
    if (m) p = `${m[1].toUpperCase()}:\\${(m[2] ?? "").replaceAll("/", "\\")}`;
  }
  if (p === "~") p = os.homedir();
  else if (p.startsWith("~/") || (win && p.startsWith("~\\"))) p = P.join(os.homedir(), p.slice(2));
  else if (p.startsWith("file://")) p = fileURLToPath(p, { windows: win });
  return P.resolve(cwd, p);
}

// realpath of the deepest existing ancestor, then the missing segments. A missing root (an unreachable share or
// drive) gives the lexical path, so the same spelling still gives the same key. Any other error (a symlink loop,
// no access) propagates and the caller treats the call like bash.
function canonical(abs: string, P: path.PlatformPath): { key: string; existing?: string } {
  const rest: string[] = [];
  for (let cur = abs; ; ) {
    try {
      const existing = fs.realpathSync.native(cur);
      return { key: P.join(existing, ...rest), existing };
    } catch (e) {
      const code = typeof e === "object" && e !== null && "code" in e ? e.code : undefined;
      if (code !== "ENOENT" && code !== "ENOTDIR") throw e;
      const parent = P.dirname(cur);
      if (parent === cur) return { key: abs };
      rest.unshift(P.basename(cur));
      cur = parent;
    }
  }
}

/** Lexical resolution of a path for this platform, the same string rules Pi applies (`resolveToCwd`). */
export function resolvePath(p: string, cwd: string): string {
  return resolveLexical(p, cwd, process.platform);
}

/**
 * Every spelling stock `resolveReadPath` may open, whatever exists now: the resolved path, the AM/PM variant (narrow
 * no-break space), NFD, curly quote, NFD + curly quote. Stock picks one when the read runs, so the scope covers all.
 */
export function readSpellings(p: string, cwd: string): string[] {
  const resolved = resolvePath(p, cwd);
  const nfd = resolved.normalize("NFD");
  return [
    ...new Set([
      resolved,
      resolved.replace(/ (AM|PM)\./gi, "\u202F$1."),
      nfd,
      resolved.replace(/'/g, "\u2019"),
      nfd.replace(/'/g, "\u2019"),
    ]),
  ];
}

// Locale-independent casing closure, not an exact APFS/Windows collation table. In particular, lowercase alone
// splits Sigma/final sigma; one upper/lower pass still splits capital sharp S from sharp S. The closure may merge
// distinct Unicode names (e.g. dotless I and "i"): it orders those paths but is not an existing-file identity.
function foldCase(value: string): string {
  for (;;) {
    const next = value.toUpperCase().toLowerCase();
    if (next === value) return value;
    value = next;
  }
}

// APFS case sensitivity is per volume. Probe an existing ASCII-cased component on that same device, without
// creating files or caching stats across calls. With no usable component, retain the conservative folding policy.
// Windows keeps conservative folding even in case-sensitive directories: Node exposes no directory case flag.
function darwinFoldsCase(existing: string | undefined): boolean {
  if (!existing) return true;
  const device = fs.statSync(existing).dev;
  for (let cur = existing; ; cur = path.dirname(cur)) {
    const parent = path.dirname(cur);
    if (parent === cur || fs.statSync(parent).dev !== device) return true;
    const name = path.basename(cur);
    const variant = name.replace(/[a-zA-Z]/, (c) => c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase());
    if (variant === name) continue;
    try {
      const a = fs.statSync(cur);
      const b = fs.statSync(path.join(parent, variant));
      return a.dev === b.dev && a.ino === b.ino;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw e;
    }
  }
}

// `abs` is already a filesystem spelling, including read fallbacks. Never apply user space/@/URL rules here.
function resolvedKey(abs: string, platform: NodeJS.Platform, identity = false): string | undefined {
  try {
    const native = platform === process.platform;
    const P = platform === "win32" ? path.win32 : path.posix;
    const { key, existing } = native ? canonical(abs, P) : { key: abs, existing: undefined };
    const folds = platform === "win32" || (platform === "darwin" && (!native || darwinFoldsCase(existing)));
    const spellingKey = (value: string): string => {
      if (platform === "win32") value = value.replaceAll("\\", "/").split("/").map((c) => c.replace(/[. ]+$/, "")).join("/");
      if (platform === "darwin") value = value.normalize("NFC");
      if (folds) value = foldCase(value);
      return platform === "darwin" ? value.normalize("NFC") : value;
    };
    if (!identity || !existing) return spellingKey(key);

    // edit/write use pathKey for grouping, not just ordering. A conservative Unicode collision must never group
    // two distinct existing files and apply one's edits to the other. Native identities form a path-shaped key,
    // retaining ancestor checks. A marked missing suffix cannot collide with any existing identity component.
    const components: string[] = [];
    for (let cur = existing; ; cur = P.dirname(cur)) {
      const stat = fs.statSync(cur, { bigint: true });
      // A filesystem without usable file IDs must use the wrappers' existing lexical fallback, not merge files.
      if (stat.ino === 0n) return undefined;
      components.unshift(`${stat.dev}:${stat.ino}`);
      if (P.dirname(cur) === cur) break;
    }
    const base = "/" + components.join("/");
    const missing = P.relative(existing, key);
    return missing ? base + "/missing:" + spellingKey(missing) : base;
  } catch {
    return undefined;
  }
}

// Opaque grouping key for edit/write. Native existing components use filesystem identities; missing components
// use conservative spelling keys. It need not stay equal after creation. `identity = false` exposes the barrier
// spelling key for platform-rule tests; production scopes pass already-resolved spellings directly.
export function pathKey(p: string, cwd: string, platform: NodeJS.Platform = process.platform, identity = true): string | undefined {
  try {
    if (typeof p !== "string" || typeof cwd !== "string") return undefined;
    return resolvedKey(resolveLexical(p, cwd, platform), platform, identity);
  } catch {
    return undefined;
  }
}

type Fields = Record<string, unknown>;
const isFields = (v: unknown): v is Fields => typeof v === "object" && v !== null;

// `args` comes from the model and is not trusted: any odd shape means the scope "all".
export function scopeOf(tool: string, args: unknown, cwd: string): Scope {
  const all: Scope = { kind: "all", keys: [] };
  try {
    if (!isFields(args)) return all;
    const pathOf = (v: unknown): unknown => (isFields(v) ? v.path : undefined);
    let kind: "read" | "mutate";
    let paths: unknown[];
    switch (tool) {
      case "read":
        kind = "read";
        paths = typeof args.path === "string" ? readSpellings(args.path, cwd) : [args.path];
        break;
      case "grep":
      case "find":
        kind = "read";
        paths = [args.path ?? "."];
        break;
      case "write":
        kind = "mutate";
        paths = Array.isArray(args.files) && args.files.length > 0 ? args.files.map(pathOf) : [args.path];
        break;
      case "edit":
        kind = "mutate";
        // Entry paths are optional (they default to the top-level path), so absent ones are not keys.
        paths = [args.path, ...(Array.isArray(args.edits) ? args.edits.map(pathOf) : [])].filter((x) => x != null);
        break;
      default:
        return all;
    }
    // Empty-string paths (strict-mode filler) name no file; with none left the scope is "all".
    if (kind === "mutate") paths = paths.filter((x) => x !== "");
    // Read spellings have already passed user normalization. Their fallback spaces are real filesystem names.
    const keys = paths.map((x) => typeof x !== "string" ? undefined
      : resolvedKey(tool === "read" ? x : resolvePath(x, cwd), process.platform));
    if (keys.length === 0 || keys.includes(undefined)) return all;
    return { kind, keys: [...new Set(keys as string[])] };
  } catch {
    return all;
  }
}
