// What a bash command certainly touches, from its text only (DECISIONS.md, Tools «Background jobs», holds H1).
//
// - `held`: what a job of this command keeps holding after it went to the background: the package folder an
//   install changes (`pkg:<dir>`), the git index and refs of a repository a git command changes (`git:<root>`), and
//   the exact files it writes (redirect targets, tee, cp/mv/ln/install destinations, rm, mkdir, touch, sed -i,
//   curl -o).
// - `explicit`: what this command, as a later call, must wait for: the package folder any package manager or
//   JavaScript tool command uses, the repository a git command changes, the files it writes.
// - `ports` and `server`: a long-running service and the ports it names.
//
// Everything comes from the string; it never throws. On any doubt (command substitution, a variable or a glob in a
// path) nothing is held for that part: a missed writer only falls back to D4 (no hold) plus the effects report.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { dirKey, fileKey } from "./keys.ts";

export type Footprint = {
  held: { files: string[]; tags: string[] };
  explicit: { tags: string[]; writes: string[] };
  /** Absolute paths of the files it writes, as spelled (the ledger records them after a foreground run). */
  written: string[];
  ports: number[];
  server: boolean;
  /** Short description of the holds for the handoff text: `package folder ., git index of ., file out.log`. */
  holds: string[];
};

const EMPTY = (): Footprint => ({ held: { files: [], tags: [] }, explicit: { tags: [], writes: [] }, written: [], ports: [], server: false, holds: [] });

/** One simple command, or the opening or closing parenthesis of a subshell (`sub`). */
type Seg = { words: string[]; bg: boolean; redirW: string[]; sub?: "open" | "close" };

/** Quote-aware split into simple commands with their write redirects. Heredoc bodies are dropped. */
function segments(cmd: string): { segs: Seg[]; subst: boolean } {
  cmd = cmd.replace(/<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1([^\n]*)\n[\s\S]*?\n\s*\2[ \t]*(?=\n|$)/g, "<<$2 $3");
  const segs: Seg[] = [];
  let words: string[] = [];
  let cur = "";
  let has = false;
  let redirW: string[] = [];
  let pending: "w" | "r" | null = null;
  const subst = /\$\(|`|<\(|>\(/.test(cmd);
  const pushWord = () => {
    if (!has) return;
    if (pending === "w") redirW.push(cur);
    else if (pending !== "r") words.push(cur);
    pending = null;
    cur = "";
    has = false;
  };
  const end = (bg: boolean) => {
    pushWord();
    if (words.length || redirW.length) segs.push({ words, bg, redirW });
    words = [];
    redirW = [];
  };
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (c === "'") {
      const j = cmd.indexOf("'", i + 1);
      cur += cmd.slice(i + 1, j < 0 ? cmd.length : j);
      has = true;
      i = j < 0 ? cmd.length : j;
    } else if (c === '"') {
      let j = i + 1;
      while (j < cmd.length && cmd[j] !== '"') j += cmd[j] === "\\" ? 2 : 1;
      cur += cmd.slice(i + 1, j);
      has = true;
      i = j;
    } else if (c === "\\" && i + 1 < cmd.length) {
      if (cmd[i + 1] !== "\n") { cur += cmd[i + 1]; has = true; }
      i++;
    } else if (c === " " || c === "\t") pushWord();
    else if (c === "\n" || c === ";") end(false);
    else if (c === "&" && cmd[i + 1] === "&") { end(false); i++; }
    else if (c === "|") { end(false); if (cmd[i + 1] === "|") i++; }
    else if (c === "&" && cmd[i + 1] === ">") { pushWord(); pending = "w"; i++; if (cmd[i + 1] === ">") i++; }
    else if (c === "&") end(true);
    else if (c === ">") {
      if (/^\d$/.test(cur)) { cur = ""; has = false; }
      pushWord();
      if (cmd[i + 1] === ">") i++;
      if (cmd[i + 1] === "&") { i++; while (/[\d-]/.test(cmd[i + 1] ?? "")) i++; continue; }
      pending = "w";
    } else if (c === "<") {
      pushWord();
      if (cmd[i + 1] === "<") {
        i++;
        if (cmd[i + 1] === "<") i++;
        while (cmd[i + 1] === " ") i++;
        let j = i + 1;
        while (j < cmd.length && !/[\s;|&]/.test(cmd[j])) j++;
        i = j - 1;
        continue;
      }
      pending = "r";
    } else if (c === "(" || c === ")") {
      // A subshell: its commands are segments like any other, and a `cd` inside it ends with its `)`.
      end(false);
      segs.push({ words: [], bg: false, redirW: [], sub: c === "(" ? "open" : "close" });
    }
    else if (c === "{" || c === "}") { if (has) cur += c; }
    else { cur += c; has = true; }
  }
  end(false);
  return { segs, subst };
}

const WRAPPERS = new Set("sudo time timeout nice nohup command builtin exec caffeinate env".split(" "));
const GIT_READ = new Set(("status log diff show rev-parse ls-files ls-tree cat-file blame grep describe shortlog merge-base " +
  "for-each-ref count-objects check-ignore name-rev symbolic-ref reflog rev-list whatchanged help version cherry var check-attr").split(" "));
const PKG = new Set("npm pnpm yarn bun".split(" "));
const PKG_INSTALL = new Set("install i ci add remove rm uninstall update up upgrade link unlink dedupe prune".split(" "));
const JS_TOOLS = new Set("node tsx ts-node npx pnpx bunx tsc vitest jest eslint prettier".split(" "));
const SERVER_WORDS = /\b(dev|serve|server|start|watch|preview|http\.server|runserver)\b|--watch\b/;

const doubtful = (w: string) => /[*?$[{`]/.test(w) || w === "" || w.startsWith("-");

function gitRoot(dir: string): string {
  for (let cur = dir; ; ) {
    try { if (fs.existsSync(path.join(cur, ".git"))) return cur; } catch {}
    const parent = path.dirname(cur);
    if (parent === cur) return dir;
    cur = parent;
  }
}

function resolveDir(cwd: string, arg: string | undefined): string | undefined {
  if (!arg || arg === "~") return os.homedir();
  if (doubtful(arg)) return undefined;
  return path.resolve(cwd, arg.startsWith("~/") ? path.join(os.homedir(), arg.slice(2)) : arg);
}

const rel = (base: string, p: string) => {
  const r = path.relative(base, p);
  return r === "" ? "." : r.startsWith("..") || path.isAbsolute(r) ? p : r;
};

export function classifyBash(command: string, cwd0: string): Footprint {
  const out = EMPTY();
  try {
    if (typeof command !== "string" || typeof cwd0 !== "string") return out;
    const { segs, subst } = segments(command);
    const portSet = new Set<number>();
    for (const m of command.matchAll(/(?:--port[= ]|\bPORT=|(?:localhost|127\.0\.0\.1|0\.0\.0\.0):)(\d{2,5})\b/g)) portSet.add(Number(m[1]));
    // Command substitution may run anything with any arguments: hold nothing, wait for nothing (D4 behaviour).
    if (subst) return out;
    const heldFiles = new Map<string, string>();
    const tags = new Map<string, string>();
    const usedTags = new Set<string>();
    const writes = new Set<string>();
    const written = new Set<string>();
    let cwd = cwd0;
    // The working folder outside each open subshell.
    const outer: string[] = [];
    const write = (p: string) => {
      if (doubtful(p) || p.startsWith("/dev/")) return;
      const key = fileKey(p, cwd);
      if (!key) return;
      writes.add(key);
      written.add(path.resolve(cwd, p.startsWith("~/") ? path.join(os.homedir(), p.slice(2)) : p));
      heldFiles.set(key, `file ${rel(cwd0, path.resolve(cwd, p))}`);
    };
    for (const seg of segs) {
      if (seg.sub === "open") { outer.push(cwd); continue; }
      if (seg.sub === "close") {
        // A `)` without its `(` (a case pattern): the structure is unknown, so nothing is certain.
        if (!outer.length) return EMPTY();
        cwd = outer.pop()!;
        continue;
      }
      for (const t of seg.redirW) write(t);
      let k = 0;
      while (k < seg.words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(seg.words[k])) k++;
      let words = seg.words.slice(k);
      while (words.length && WRAPPERS.has(words[0])) {
        const head = words[0];
        words = words.slice(1);
        // Options with a value: `nice -n 5`, `sudo -u x`, `timeout -k 5 -s KILL 10`.
        while (words.length && (words[0].startsWith("-") || /^[A-Za-z_]+=/.test(words[0]))) {
          words = words.slice(/^-[nukgsCDhprtT]$/.test(words[0]) && words.length > 1 ? 2 : 1);
        }
        if (head === "timeout" && words.length) words = words.slice(1);
      }
      while (words.length && /^(do|then|else|elif|if|while|until|!|time)$/.test(words[0])) words = words.slice(1);
      if (!words.length) continue;
      const head = path.basename(words[0]);
      const args = words.slice(1);
      if (seg.bg) out.server = true;
      if (head === "cd" || head === "pushd") {
        const next = resolveDir(cwd, args[0]);
        if (!next) return EMPTY();
        cwd = next;
        continue;
      }
      if (head === "xargs") continue; // arguments come from input: unknown
      if (head === "git") {
        let a = args;
        let dir = cwd;
        while (a.length && a[0].startsWith("-")) {
          if (a[0] === "-C" && a[1]) {
            const d = resolveDir(cwd, a[1]);
            if (!d) { dir = ""; break; }
            dir = d;
            a = a.slice(2);
          } else if (a[0] === "-c" && a[1]) a = a.slice(2);
          else a = a.slice(1);
        }
        const sub = a[0] ?? "";
        const listing = (["branch", "tag", "remote", "stash", "worktree", "config"].includes(sub) &&
          (a.length === 1 || a.slice(1).every((x) => /^(-a|-v|-vv|-r|--list|-l|--show-current|list|show|--all|--merged|--no-merged)$/.test(x) || x.startsWith("--format")))) ||
          (sub === "config" && a.slice(1).some((x) => /^(--get.*|--list|-l)$/.test(x)));
        // Reading subcommands with writing forms: `symbolic-ref <name> <ref>` and `-d` set or delete a ref; `reflog`
        // `expire`, `delete`, `drop` and `write` change the reflog.
        const rest = a.slice(1);
        const changesRefs = (sub === "symbolic-ref" && (rest.some((x) => x === "-d" || x === "--delete") ||
            rest.filter((x, i) => !x.startsWith("-") && rest[i - 1] !== "-m").length >= 2)) ||
          (sub === "reflog" && /^(expire|delete|drop|write)$/.test(rest[0] ?? ""));
        if (!dir || !sub || (GIT_READ.has(sub) && !changesRefs) || listing || sub === "--version") continue;
        const root = gitRoot(dir);
        const tag = "git:" + dirKey(root);
        tags.set(tag, `git index of ${rel(cwd0, root)}`);
        usedTags.add(tag);
        continue;
      }
      if (PKG.has(head)) {
        const tag = "pkg:" + dirKey(cwd);
        usedTags.add(tag);
        const sub = args.find((x) => !x.startsWith("-")) ?? "";
        if (PKG_INSTALL.has(sub)) tags.set(tag, `package folder ${rel(cwd0, cwd)}`);
        if (SERVER_WORDS.test(args.join(" "))) out.server = true;
        continue;
      }
      if (JS_TOOLS.has(head)) {
        usedTags.add("pkg:" + dirKey(cwd));
        if (SERVER_WORDS.test(args.join(" "))) out.server = true;
        continue;
      }
      if (/^python3?$/.test(head) && /http\.server/.test(args.join(" "))) { out.server = true; continue; }
      if (head === "sed") {
        if (args.some((x) => /^-i/.test(x) || x === "--in-place")) {
          // BSD `sed -i '' …` / `sed -i .bak …`: the word after a bare -i is a backup suffix, not the script.
          const bare = args.findIndex((x) => x === "-i");
          const suffix = bare >= 0 && (args[bare + 1] === "" || /^\.\w+$/.test(args[bare + 1] ?? "")) ? bare + 1 : -1;
          const scriptAt = (i: number) => i > 0 && /^(-e|-f|--expression|--file)$/.test(args[i - 1]);
          const plain = args.filter((x, i) => i !== suffix && !scriptAt(i) && x !== "" && !x.startsWith("-"));
          const hasScript = args.some((x) => /^(-e|-f|--expression|--file)$/.test(x));
          for (const p of hasScript ? plain : plain.slice(1)) write(p);
        }
        continue;
      }
      if (head === "tee") { for (const p of args.filter((x) => !x.startsWith("-"))) write(p); continue; }
      if (head === "curl" || head === "wget") {
        const o = args.findIndex((x) => x === "-o" || x === "--output" || (head === "wget" && x === "-O"));
        if (o >= 0 && args[o + 1]) write(args[o + 1]);
        continue;
      }
      if (["rm", "rmdir", "mkdir", "touch", "truncate"].includes(head)) {
        for (const p of args.filter((x) => !x.startsWith("-"))) write(p);
        continue;
      }
      if (["cp", "mv", "ln", "install"].includes(head)) {
        const ps = args.filter((x) => !x.startsWith("-"));
        if (ps.length >= 2) {
          write(ps[ps.length - 1]);
          if (head === "mv") for (const p of ps.slice(0, -1)) write(p);
        }
        continue;
      }
    }
    out.held.files = [...heldFiles.keys()];
    out.held.tags = [...tags.keys()];
    out.explicit.tags = [...usedTags];
    out.explicit.writes = [...writes];
    out.written = [...written];
    out.ports = out.server ? [...portSet] : [];
    out.holds = [...tags.values(), ...heldFiles.values()];
    return out;
  } catch {
    return EMPTY();
  }
}
