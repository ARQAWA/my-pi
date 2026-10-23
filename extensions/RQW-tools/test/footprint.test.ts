// What a bash command certainly touches (footprint.ts; DECISIONS.md, Tools «Background jobs», holds H1). Table tests
// per class, wrappers, quotes, heredocs, cd chains, git -C, and a property: random strings never throw, doubt holds
// nothing.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyBash } from "../footprint.ts";
import { dirKey, fileKey } from "../keys.ts";

const repo = realpathSync(mkdtempSync(join(tmpdir(), "rqw-footprint-")));
mkdirSync(join(repo, ".git"));
mkdirSync(join(repo, "web"));
const sub = join(repo, "web");
const pkg = (dir = repo) => "pkg:" + dirKey(dir);
const git = (dir = repo) => "git:" + dirKey(dir);
const file = (p: string, cwd = repo) => fileKey(p, cwd)!;
const fp = (command: string, cwd = repo) => classifyBash(command, cwd);
const nothing = (command: string) => {
  const f = fp(command);
  assert.deepEqual(f.held, { files: [], tags: [] }, command);
  assert.deepEqual(f.explicit, { tags: [], writes: [] }, command);
};

test("package installs hold the package folder; other package and JS tool commands only use it", () => {
  for (const c of ["npm ci", "npm install", "npm i -D x", "pnpm add x", "yarn install", "bun install", "npm uninstall x"]) {
    const f = fp(c);
    assert.deepEqual(f.held.tags, [pkg()], c);
    assert.deepEqual(f.explicit.tags, [pkg()], c);
    assert.deepEqual(f.holds, ["package folder ."], c);
  }
  for (const c of ["npm test", "npm run build", "npx tsc", "node x.js", "vitest run", "eslint ."]) {
    const f = fp(c);
    assert.deepEqual(f.held.tags, [], c);
    assert.deepEqual(f.explicit.tags, [pkg()], c);
  }
  assert.deepEqual(fp("cd web && npm ci").held.tags, [pkg(sub)]);
  assert.deepEqual(fp("npm ci", sub).holds, ["package folder ."]);
});

test("git commands that change the repository hold its index and refs; reading ones touch nothing", () => {
  for (const c of ["git commit -m x", "git add -A", "git checkout main", "git rebase origin/main", "git stash push", "git -c a=b pull"]) {
    const f = fp(c);
    assert.deepEqual(f.held.tags, [git()], c);
    assert.deepEqual(f.holds, ["git index of ."], c);
  }
  // The repository root, not the directory the command runs in.
  assert.deepEqual(fp("git commit -m x", sub).held.tags, [git()]);
  for (const c of ["git status", "git log --oneline", "git diff HEAD", "git branch", "git branch -a", "git stash list", "git config --get user.name", "git --version"]) nothing(c);
  assert.deepEqual(fp("git -C web commit -m x").held.tags, [git()]);
  // symbolic-ref and reflog read in their plain forms and change refs in the others.
  for (const c of ["git symbolic-ref HEAD refs/heads/x", "git symbolic-ref -m why HEAD refs/heads/x", "git symbolic-ref -d HEAD", "git symbolic-ref --delete HEAD",
    "git reflog expire --expire=now --all", "git reflog delete HEAD@{1}", "git reflog drop main", "git reflog write main 0000 1111 msg"])
    assert.deepEqual(fp(c).held.tags, [git()], c);
  for (const c of ["git symbolic-ref HEAD", "git symbolic-ref --short HEAD", "git symbolic-ref -q HEAD", "git reflog", "git reflog show main", "git reflog -n 5", "git reflog list", "git reflog exists main"]) nothing(c);
  nothing("git -C $DIR commit -m x");
});

test("exact written files are held: redirects, tee, sed -i, curl -o, rm/mkdir/touch, cp/mv/ln destinations", () => {
  const cases: [string, string[]][] = [
    ["echo hi > out.log", ["out.log"]],
    ["make 2>&1 >> build.log", ["build.log"]],
    ["make &> all.log", ["all.log"]],
    ["ls | tee a.txt b.txt", ["a.txt", "b.txt"]],
    ["sed -i '' s/a/b/ f.txt", ["f.txt"]],
    ["sed -i -e s/a/b/ f.txt", ["f.txt"]],
    ["curl -o page.html http://x", ["page.html"]],
    ["rm -rf dist", ["dist"]],
    ["mkdir -p a/b && touch a/b/c", ["a/b", "a/b/c"]],
    ["cp x y", ["y"]],
    ["mv x y", ["y", "x"]],
    ["cd web && echo 1 > n.txt", ["web/n.txt"]],
    ["sudo timeout 5 env A=1 tee t.txt", ["t.txt"]],
    ["X=1 nice -n 5 touch u.txt", ["u.txt"]],
    ["timeout -k 5 -s KILL 10 touch v.txt", ["v.txt"]],
    // live probe: a subshell's ")" was read as part of the path
    ["(echo a > x.txt) && (ls > z.txt; echo done)", ["x.txt", "z.txt"]],
  ];
  for (const [c, files] of cases) {
    const f = fp(c);
    const keys = files.map((p) => file(p));
    assert.deepEqual(f.held.files, keys, c);
    assert.deepEqual(f.explicit.writes, keys, c);
    assert.deepEqual(f.held.tags, [], c);
  }
  assert.deepEqual(fp("echo hi > out.log").holds, ["file out.log"]);
  assert.deepEqual(fp("cd web && echo 1 > n.txt").written, [join(sub, "n.txt")]);
  // Quotes keep a path with spaces in one word; a quoted ">" is not a redirect.
  assert.deepEqual(fp("echo hi > 'my file.txt'").held.files, [file("my file.txt")]);
  nothing("echo 'a > b'");
  nothing("echo hi 2>&1");
  nothing("echo hi > /dev/null");
});

test("heredoc bodies are not commands; the command around them is", () => {
  const f = fp("cat > notes.md <<'EOF'\nnpm ci\ngit commit -m x\nEOF\n");
  assert.deepEqual(f.held.files, [file("notes.md")]);
  assert.deepEqual(f.held.tags, []);
});

test("doubt holds nothing: command substitution, variables, globs, xargs, an unknown cd", () => {
  for (const c of ["echo $(date) > x", "rm `ls`", "diff <(a) <(b)", "rm *.log", "echo > $OUT", "find . | xargs rm", "cd $X && npm ci", "cat x", "make", "python3 build.py", "ls -la"]) nothing(c);
});

test("servers: background `&`, dev/serve/watch scripts, http.server; ports only for servers", () => {
  assert.equal(fp("npm run dev -- --port 5173").server, true);
  assert.deepEqual(fp("npm run dev -- --port 5173").ports, [5173]);
  assert.equal(fp("python3 -m http.server 8000").server, true);
  assert.equal(fp("node server.js &").server, true);
  assert.deepEqual(fp("PORT=3000 node app.js &").ports, [3000]);
  assert.equal(fp("npm test").server, false);
  assert.deepEqual(fp("curl localhost:3000").ports, []);
});

test("a cd inside a subshell ends with its closing parenthesis", () => {
  const f = fp("(cd web && touch a); touch b");
  assert.deepEqual(f.written.sort(), [join(sub, "a"), join(repo, "b")].sort());
  assert.deepEqual(f.holds.sort(), ["file b", `file ${join("web", "a")}`].sort());
  assert.deepEqual(fp("(cd web; (cd .. && touch c) && touch d) > e.log").written.sort(), [join(repo, "c"), join(sub, "d"), join(repo, "e.log")].sort());
  assert.deepEqual(fp("(cd web && npm ci) && npm test").explicit.tags.sort(), [pkg(sub), pkg()].sort());
  // A closing parenthesis without its opening one (a case pattern) is doubt: nothing held.
  assert.deepEqual(fp("case x in a) touch b;; esac").held, { files: [], tags: [] });
});

test("property: random command strings never throw; any command substitution means nothing held", () => {
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
  const atoms = ["npm", "ci", "git", "commit", ">", ">>", "|", "&", "&&", ";", "'", '"', "\\", "$(", ")", "`", "<<", "EOF", "\n", "cd", "..", "x.txt", "-C", "tee", "sed", "-i", "rm", "*", "$X", "{", "}", "(", " "];
  for (let i = 0; i < 3000; i++) {
    const n = 1 + Math.floor(rnd() * 12);
    const c = Array.from({ length: n }, () => atoms[Math.floor(rnd() * atoms.length)]).join(rnd() < 0.5 ? " " : "");
    const f = fp(c);
    assert.ok(f && Array.isArray(f.held.files), c);
    if (/\$\(|`|<\(|>\(/.test(c)) {
      assert.deepEqual(f.held, { files: [], tags: [] }, c);
      assert.deepEqual(f.explicit, { tags: [], writes: [] }, c);
    }
  }
  assert.doesNotThrow(() => classifyBash(undefined as any, repo));
  assert.doesNotThrow(() => classifyBash("npm ci", undefined as any));
});
