# Review 2: RQW-tools descriptions, parameter strings and SYSTEM.md lines 10-25

Status: frozen evidence, a review of HEAD `9e13b55` on Pi 1.3.0. Its findings were fixed as wording
([DECISIONS.md, Tools](../DECISIONS.md#tools)); the current descriptions are `extensions/RQW-tools/descriptions/*.md`.

Object (HEAD `9e13b55`): `extensions/RQW-tools/descriptions/*.md`; parameter descriptions in
`extensions/RQW-tools/{index,edit,write}.ts`; `extensions/RQW-prompt/SYSTEM.md` lines 10-25.
Agreement: `notes/tools-requirements.md`. Design: `notes/tools-design.md`, `DECISIONS.md` section Tools.
Facts: `extensions/RQW-tools/*.ts`, Pi 1.3.0 `dist/core/tools/*.js`, and fd 10.5.0 (`~/.pi/agent/bin/fd`) plus rg
run with the exact argument lists that `find.js` and `grep.js` build.

Verdict: 8 findings: 1 medium, 7 low. No high findings.

## Findings

1. **Medium. grep says it respects .gitignore. Outside a git repository it does not.**
   - Text, `grep.md:1`: "Search file contents with ripgrep; respects .gitignore."
   - Source, `grep.js:93`: `const args = ["--json", "--line-number", "--color=never", "--hidden"];`. There is no
     `--no-require-git`. Compare `find.js:129-145`: "fd normally ignores .gitignore outside git repos, so keep
     --no-require-git there" and `args.push("--no-require-git")`. Probe: in a temp dir with no `.git`, `.gitignore`
     holds `ignored.txt` and `ignored.txt` holds `hello`. `rg --json --line-number --hidden -- hello <dir>` returns
     1 match. fd with `--no-require-git` returns nothing for the same file.
   - Problem: in a project that is not a git repo, grep searches gitignored trees such as `node_modules`, while find
     skips them. The model trusts the claim, runs the broad unlimited first wave, and fills the 50KB cap with
     ignored files.
   - Required outcome: `grep.md:1` is true in both cases, e.g. "respects .gitignore inside a git repository". The
     other option is code: pass `--no-require-git` outside a repo the way find does. That is a code change in the
     wrapper, outside this description review.

2. **Low. The general one-response rule in SYSTEM.md has no exception for writing a long file in parts.**
   - Text, `SYSTEM.md:14`: "Use a separate response only when a call needs an earlier call's output, and gather all
     changes to one file into one edit call."
   - Contradicts `write.md:1`: "write a file over about 400 lines in parts, each part in its own response: the first
     with write, then each next with edit ...". The next part does not need the earlier call's output. Within one
     response the barrier would order a write and an edit of the same file anyway. So by line 14 the parts belong in
     one response and in one edit call, which is exactly what the output limit forbids.
   - Required outcome: the two rules do not conflict. Line 14 should name the exception, e.g. "... only when a call
     needs an earlier call's output or the response would exceed the output limit". The other option is for
     `write.md` to state that it overrides that rule.

3. **Low. read and grep give different rules for when to use offset and limit.**
   - Text, `read.md:2`: "Read a file you need beyond one spot whole in one call, not in ranges; use offset and limit
     only around one hit in a large file."
   - Text, `grep.md:6`: "read other hits only around their lines with offset and limit".
   - Problem: for a hit in a small file, read.md allows a range only in a large file. grep.md asks for a range around
     the hit no matter the file size. The two lines came from separate probe sets (`refine-readbash.md` and
     `refine-search.md`), so neither was measured against the other's final wording.
   - Required outcome: one rule. Either grep.md drops the size-free range instruction and points to the read rule,
     or both texts say the same thing, e.g. "read other hits in large files only around their lines with offset and
     limit".

4. **Low. find returns directories too, but the descriptions call the results files.**
   - Text, `find.md:1`: "Find files by glob pattern. Returns paths relative to the search directory". Text,
     `find.md:2`: "A pattern without "/" matches file names at any depth".
   - Source, `find.js:128`: `["--glob", "--color=never", "--hidden"]` with no `--type f`. `relativizeFindResultPath`
     keeps a trailing separator. Probe: the brace example `{*compose*,Dockerfile*,Makefile,main.*}` also returns the
     directory `compose.d/`.
   - Required outcome: the text says that directories are returned too, ending in "/". For example: "Returns
     matching files and directories (directories end in /)".

5. **Low. The edit result promises a nearest-match hint that is often left out.**
   - Text, `edit.md:5`: "when text is not found, it shows the nearest matching lines with line numbers."
   - Source, `hint.ts:67`: `if (best < MIN_SCORE) return undefined;` with `MIN_SCORE = 0.5`. Also `hint.ts:49` and
     `hint.ts:59` return nothing for large files and long searches.
   - Problem: a model that is told the hint always appears may read a missing hint as "the text is nowhere near".
     It should simply re-read the file.
   - Required outcome: the statement is conditional, e.g. "it may show the nearest matching lines with line
     numbers".

6. **Low. read's notice for an overlong line sends the model to `sed` in bash, which two descriptions forbid.**
   - Texts: `read.md:4`: "Use read to examine files instead of cat, head or sed through bash." `bash.md:4`: "Search
     and read with the grep, find and read tools, not with rg, grep, find, cat, head or sed in the shell."
   - Source, `read.js:139`: "[Line N is X, exceeds 50.0KB limit. Use bash: sed -n 'Np' path | head -c 51200]".
     Neither offset nor limit can return part of one line, so this is the only way to get it.
   - Required outcome: the descriptions allow this one case. For example, `read.md:4` adds "except when read itself
     says to use bash for an overlong line".

7. **Low. grep says to narrow the search for any truncation notice, including the one that says to use read.**
   - Text, `grep.md:5`: "long lines are cut at 500 characters. If it ends with a truncation notice, narrow pattern,
     path or glob."
   - Source, `grep.js:229`: "Some lines truncated to 500 chars. Use read tool to see full lines". This notice also
     ends the output. Narrowing does not help with it.
   - Required outcome: the narrowing advice applies only to the size cap, e.g. "If it ends with a 50KB limit notice,
     narrow pattern, path or glob".

8. **Low. A grep `glob` with "/" is anchored at the search root. A find pattern with "/" is not. No text says so.**
   - Text, `find.md:2`: "a pattern with "/" matches the end of the path at any depth, e.g. "src/**/*.spec.ts"". The
     stock grep `glob` parameter says "Filter files by glob pattern, e.g. '*.ts' or '**/*.spec.ts'" (`grep.js`
     schema). `grep.md` does not describe `glob`.
   - Probe, a git repo with `src/a.ts`, `x/src/b.ts` and `c.ts`: `rg --glob 'src/*.ts'` returns only `src/a.ts`.
     `--glob '**/src/*.ts'` returns both. The find rule therefore does not carry over to grep.
   - Required outcome: `grep.md` says how glob works in one clause, e.g. "glob without "/" matches file names at any
     depth; with "/" it is matched from the search path, so start it with **/ for any depth". The other option is to
     record the difference as accepted.

## Checked and holding

- Limits: read 2000 lines or 50KB, with "Use offset=N to continue" (`read.js`, `truncate.js:10-11`). bash keeps
  the last 2000 lines or 50KB and saves the full output to a temp file named in the result. grep and find cut at
  50KB with no line cap, and `limit` defaults to `NO_LIMIT = 100000` (`index.ts`). grep cuts lines at 500
  characters (`truncate.js:12`). The `limit` parameter strings in `index.ts` match this.
- Parameter names are exactly Pi's: `path`, `offset`, `limit`, `command`/`timeout`, `edits[].oldText`/`newText`,
  `pattern`, `glob`, `literal`, `content`. The new fields are `edits[].path` and `files[{path, content}]`, as
  agreement item 5 requires. Parameter strings in `edit.ts` and `write.ts` are true to `groupEdits` and
  `executeWrite`.
- edit semantics (`edit.md:1-3`) match the code. Every edit is matched against the original file. Each oldText must
  be unique and must not overlap another edit (`edit-diff.js` `applyEditsToNormalizedContent`). Each file is
  all-or-nothing and runs in parallel with the others through `Promise.allSettled`, failures listed last. The
  top-level path is the default for entries without their own.
- write semantics (`write.md`) match the code. Parent directories are created (`write.js` mkdir). Using both forms
  is an error, and so is a duplicate file, before anything is written (`FORM_ERROR`, "files lists X twice"). The
  result has one line per file.
- find pattern rules, checked with fd 10.5.0 and the stock arguments. Without "/" the pattern matches names at any
  depth. With "/" it gets `--full-path` and a `**/` prefix and matches the path end at any depth (`src/a/x.spec.ts`
  matches). Braces work: `{*compose*,Dockerfile*,Makefile,main.*}` matches all four. `**/{src,lib}/**/*.spec.ts`
  works, and so do braces holding a "/" such as `.github/workflows/*`. Output is unsorted, hidden files are
  included, and .gitignore is respected in and outside git repos.
- bash statements: each call gets a fresh shell, stdout and stderr are combined, there is no default timeout, and a
  timeout kills the process tree (`killProcessTree`). A non-zero exit is reported as `isError` with the output.
  Background processes are not tracked (`waitForChildProcess`). "holds this call and every later call" holds under
  barrier decision 2. The 32,000-character limit holds, because Git Bash gets the command as an argument (stdin
  transport is used only for legacy WSL bash, `shell.js:13`). The `/tmp` rule holds: the file tools map only drive
  paths such as `/c/...` (`normalizeWindowsShellPath`), not `/tmp`.
- No product names and no omp-only leftovers in the object: no `head_limit`, `multiline`, `replace_all`,
  `apply_patch`, busy refusal, background jobs or internal URLs. ripgrep is named only as the engine.
- Barrier order: no description explains it, as the DECISIONS entry of `0a2028e` requires. `SYSTEM.md:14` "a shell
  command waits for the calls before it and holds the calls after it" has been there since `1e6d295`. It was
  present in both arms of the measurement behind that decision, so it is not a finding.
- The stock `promptSnippet`/`promptGuidelines`, such as bash "Execute bash commands (ls, grep, find, etc.)", do not
  reach the model. RQW-prompt sets `customPrompt`, and Pi then builds no tools or rules section
  (`system-prompt.js` `buildSystemPromptSections`).
- Duplicated rules agree with each other, apart from findings 2, 3 and 6. These are tool instead of shell
  (`SYSTEM.md:12`, `bash.md:4`, `grep.md:2`, `read.md:4`) and batching in one response (`SYSTEM.md:14`, `read.md:3`,
  `find.md:5`, `grep.md:6`). The stop rule in `SYSTEM.md:17-18` and `grep.md:6` and the method pointer in
  `SYSTEM.md:23` also agree.
