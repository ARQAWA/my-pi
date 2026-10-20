# Review 1: RQW-tools descriptions and SYSTEM.md lines 10-25

Object: `extensions/RQW-tools/descriptions/{read,find,grep,edit,write,bash,bash.win32}.md`,
`extensions/RQW-prompt/SYSTEM.md` lines 10-25 (commit 8889fdf).
Agreement: `notes/tools-requirements.md`. Design: `notes/tools-design.md`. Evidence: `notes/analysis-pi-tools.md`,
`notes/analysis-races.md`, `notes/analysis-omplite-tools.md` section 4. Stock code: Pi 1.3.0 `dist/core/tools/*.js`.

Verdict: 6 findings (1 high, 2 medium, 3 low). Everything else checked holds (list at the end).

## Findings

1. **High. SYSTEM.md says shell commands run in parallel; the barrier serialises bash.**
   - Text, `SYSTEM.md:14`: "searches, file finds, file reads, writes and edits of different files, and shell commands
     all run at the same time."
   - Contradicts `bash.md:5`: "In one response a bash call starts only after every call placed before it has
     finished, and every call placed after it waits for it." and `tools-design.md` decision 2: "`bash` -> all. bash
     conflicts with everything, including bash (D1)."
   - Required outcome: line 14 no longer lists shell commands among calls that run at the same time, e.g. "searches,
     file finds, file reads, and writes and edits of different files all run at the same time; a bash call waits for
     the calls before it and holds the calls after it." Keep the rest of the line.

2. **Medium. "Join independent long commands into one bash call" lost the reason it exists.**
   - Text, `bash.md:5`: "Put reads and searches before bash, and join independent long commands into one bash call."
     Same file, `bash.md:3`: "Background processes started with `&` are not tracked."
   - Source, `analysis-races.md` D1: "Cost: two long independent commands in one response take the sum of their
     times; the model can run them in one call with `&` and `wait`."
   - Problem: two bash calls in one response already run one after another, so joining them with `&&` or `;` saves
     nothing; the gain exists only with `&` and `wait`, and line 3 reads as a warning against `&`.
   - Required outcome: either say how, e.g. "run independent long commands in one bash call as `a & b & wait`", or
     drop the clause. If kept, line 3 must not read as forbidding `&` followed by `wait`.

3. **Medium. The server sentence is false without `timeout` and hides the barrier cost.**
   - Text, `bash.md:3`: "Without `timeout` (seconds) a command has no deadline. ... A command that does not exit, such
     as a server or watcher, holds the call until its timeout kills it with all its child processes."
   - Source, `analysis-pi-tools.md` 1.4: "Timeout: none by default"; with decision 2 (bash -> all) a call that never
     returns also holds every later call of the response, and Pi starts no next response until all calls return
     (`analysis-races.md` I9).
   - Required outcome: one sentence that is true in both cases, e.g. "A command that does not exit, such as a server or
     watcher, holds this call and every later call until its timeout kills it with its child processes; never run one
     without `timeout`."

4. **Low. The batch rule is repeated five times.**
   - Texts: `SYSTEM.md:14` "Put every tool call that does not need another call's result into the same response";
     `SYSTEM.md:23` "Put every search and read that may relate to the subject into one response."; `read.md:3` "Read
     every file that may relate to the subject in one response."; `find.md:5` "Run every search that may be useful in
     one response."; `grep.md:7` "Call multiple tools in one response: it is always better to speculatively run several
     searches and read several files as a batch that are potentially useful."
   - Source: agreement item 4, "the prompt keeps a minimal mention"; check 4 (compact). `analysis-omplite-tools.md`
     section 4 asks to keep the batch lines in read (`read/description.md:6`, `:15`) and glob/find (`:6`); `grep.md:7`
     is the old prompt line moved, so read.md:3 and grep.md:7 now say the same thing.
   - Required outcome: drop the second sentence of `SYSTEM.md:23` (the line becomes "Search with the grep and find
     tools and read files with read, following the method in the grep description."), and keep only one of
     `grep.md:7` / `read.md:3`+`find.md:5` (recommended: drop `grep.md:7`, the per-tool lines carry the measured
     wording). Also remove the stray empty line `grep.md:2`; no other description has one.

5. **Low. Write-in-parts is stated twice and clashes with "one edit call per file".**
   - Texts: `SYSTEM.md:16` "Write a file longer than about 400 lines in parts: the first part with write, the rest added
     with edit, so one response never runs into the output limit."; `write.md` "write a file over about 400 lines in
     parts, the first part with write, then each next part with edit whose oldText is the unique last lines of the file
     and whose newText is those lines plus the next part."; `SYSTEM.md:14` "gather all changes to one file into one
     edit call".
   - Source: `DECISIONS.md` added `SYSTEM.md:16` only because "omp-lite carried it in its `write` description" and Pi's
     descriptions were not ours; now `write.md` carries the full rule with the anchor, as
     `analysis-omplite-tools.md` section 4 requires ("In Pi 'append with edit' needs a unique anchor at the end of the
     file; say so").
   - Problem: two copies, and the model gets "one edit call per file" next to "each next part with edit". The output
     limit is per response, so parts in one response do not help; only `SYSTEM.md:16` hints at separate responses.
   - Required outcome: one copy, in `write.md`, saying each part goes in its own response (e.g. "... then, one
     response per part, each next part with edit whose oldText ..."); drop `SYSTEM.md:16` and update the
     `DECISIONS.md` entry. If the owner wants the prompt line kept, it must at least not conflict with line 14.

6. **Low. find: "a pattern with "/" matches the whole path" is imprecise; bash.win32 placeholder lost its backticks.**
   - Text, `find.md:2`: "a pattern with "/" matches the whole path, e.g. "src/**/*.spec.ts"."
   - Source, `find.js:147-154`: with "/" the tool adds `--full-path` and prefixes `**/`, so the pattern matches the end
     of the path at any depth (`pkg/a/src/x.spec.ts` matches `src/**/*.spec.ts`; `src/x.ts` is not anchored to the
     search root).
   - Required outcome: "a pattern with "/" is matched against the end of the path at any depth, e.g. ...".
   - Text, `bash.win32.md:4`: "write a long script to a file with write and run bash <file>." The draft
     (`notes/drafts/bash-prompt.md`) has `` `bash <file>` ``; without backticks `<file>` reads like a redirection.
     Required outcome: restore the backticks.

## Checked and holding

- Limits: read 2000 lines / 50KB whole-file first read with "Use offset=N to continue" (`read.js:134-159`); bash tail
  2000 lines / 50KB with the full output saved to a file; grep and find 50KB, no line cap (`maxLines:
  MAX_SAFE_INTEGER`), no match cap by default (decision 7, `index.ts` `NO_LIMIT = 100000`); grep lines 500 chars.
- Parameter names: `path`, `offset`, `limit`, `pattern`, `glob`, `literal`, `timeout`, `content`, `edits[].oldText` /
  `newText`, `edits[].path`, `files[]`; no omp-only names (`head_limit`, `type`, `multiline`, `-A/-B/-C`,
  `apply_patch`, `cwd`, `pty`, background jobs, `xd://`), no product names.
- Barrier statements in `bash.md:5`, `read.md:4`, `edit.md`, `write.md` match decision 2 and the OCB rule.
- edit/write semantics match decisions 4 and 5 (original-file matching, per-file all-or-nothing, one form only, no
  duplicate files, per-file result lines, nearest-match hint on "Could not find", also for single-file calls).
- Measured omp-lite lines kept with their meaning: wave method with stop rule (`grep.md:8`, Pi names), batch reads,
  whole-file first read, write in parts with the anchor, "Read a file before editing it", tool instead of shell.
- find "unsorted", ".gitignore", hidden files included (`find.js` `--hidden`, no sort); grep output format and
  relative paths (`grep.js:71-76`, `206`).
- bash.win32 lines match requirement 9 and `notes/drafts/bash-prompt.md`; the 32,000-character line applies since
  temp-script transport is not ported (decision 10).
