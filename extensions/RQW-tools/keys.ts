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
function canonical(abs: string, P: path.PlatformPath): string {
  const rest: string[] = [];
  for (let cur = abs; ; ) {
    try {
      return P.join(fs.realpathSync.native(cur), ...rest);
    } catch (e) {
      const code = typeof e === "object" && e !== null && "code" in e ? e.code : undefined;
      if (code !== "ENOENT" && code !== "ENOTDIR") throw e;
      const parent = P.dirname(cur);
      if (parent === cur) return abs;
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

export function pathKey(p: string, cwd: string, platform: NodeJS.Platform = process.platform, alreadyResolved = false): string | undefined {
  try {
    if (typeof p !== "string" || typeof cwd !== "string") return undefined;
    // readSpellings already resolved these paths; folding spaces again would erase the AM/PM fallback.
    let k = alreadyResolved ? p : resolveLexical(p, cwd, platform);
    // A foreign platform name (tests of the string rules) cannot ask the real file system.
    if (platform === process.platform) k = canonical(k, platform === "win32" ? path.win32 : path.posix);
    if (platform === "win32") {
      k = k.replaceAll("\\", "/").split("/").map((c) => c.replace(/[. ]+$/, "")).join("/").toLowerCase();
    } else if (platform === "darwin") {
      k = k.normalize("NFC").toLowerCase();
    }
    return k;
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
    // pathKey checks the type itself and answers undefined for anything that is not a string.
    const keys = paths.map((x) => pathKey(x as string, cwd, process.platform, tool === "read"));
    if (keys.length === 0 || keys.includes(undefined)) return all;
    return { kind, keys: [...new Set(keys as string[])] };
  } catch {
    return all;
  }
}
