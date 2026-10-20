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

// realpath of the deepest existing ancestor, then the missing segments. Any other error propagates.
function canonical(abs: string, P: path.PlatformPath): string {
  const rest: string[] = [];
  for (let cur = abs; ; ) {
    try {
      return P.join(fs.realpathSync.native(cur), ...rest);
    } catch (e: any) {
      const parent = P.dirname(cur);
      if ((e?.code !== "ENOENT" && e?.code !== "ENOTDIR") || parent === cur) throw e;
      rest.unshift(P.basename(cur));
      cur = parent;
    }
  }
}

export function pathKey(p: string, cwd: string, platform: NodeJS.Platform = process.platform): string | undefined {
  try {
    if (typeof p !== "string" || typeof cwd !== "string") return undefined;
    let k = resolveLexical(p, cwd, platform);
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

export function scopeOf(tool: string, args: any, cwd: string): Scope {
  try {
    let kind: "read" | "mutate";
    let paths: unknown[];
    switch (tool) {
      case "read":
        kind = "read";
        paths = [args.path];
        break;
      case "grep":
      case "find":
        kind = "read";
        paths = [args.path ?? "."];
        break;
      case "write":
        kind = "mutate";
        paths = Array.isArray(args.files) ? args.files.map((f: any) => f?.path) : [args.path];
        break;
      case "edit":
        kind = "mutate";
        // Entry paths are optional (they default to the top-level path), so absent ones are not keys.
        paths = [args.path, ...(Array.isArray(args.edits) ? args.edits.map((e: any) => e?.path) : [])].filter(
          (x) => x != null,
        );
        break;
      default:
        return { kind: "all", keys: [] };
    }
    const keys = paths.map((x) => pathKey(x as string, cwd));
    if (keys.length === 0 || keys.includes(undefined)) return { kind: "all", keys: [] };
    return { kind, keys: keys as string[] };
  } catch {
    return { kind: "all", keys: [] };
  }
}
