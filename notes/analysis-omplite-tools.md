# omp-lite base tools: mechanics, Pi 1.3.0 gap, port verdict

Status: frozen evidence on Pi 1.3.0; the package now pins Pi 1.4.0. Current contract:
[DECISIONS.md, Tools](../DECISIONS.md#tools).

Read-only analysis for the RQW-tools work (agreement: `notes/tools-requirements.md`). Path prefixes:

- `OL/` = `/Users/arkadijcukavin/Documents/ChatGPT/my-omp-harness/`
- `PT/` = `/Users/arkadijcukavin/stock-bench/pi/node_modules/@earendil-works/pi-coding-agent/dist/core/tools/`
- `PCA/` = `.../pi-coding-agent/dist/core/`, `PAC/` = `.../pi-agent-core/dist/`
- `D:<line>` = `OL/DECISIONS.md:<line>`

## 0. Facts about Pi that decide most verdicts

- Pi runs all calls of one response in parallel by default: `toolExecution ?? "parallel"` (`PAC/agent.js:145`).
  A single tool with `executionMode: "sequential"` in the response turns the WHOLE response sequential
  (`PAC/agent-loop.js:368-370`). There is no omp-style "exclusive barrier for one call only".
- In the parallel path every call is prepared first, in call order, including validation and the extension
  `tool_call` event (`prepareToolCall` awaited in the loop, `PAC/agent-loop.js:418-420`; `beforeToolCall` at
  `PAC/agent-loop.js:494`, emitted as `tool_call` in `PCA/agent-session.js:327-339`). Only after the loop do all
  executions start together (`Promise.all`, `PAC/agent-loop.js:453`). Each `execute` is invoked synchronously in
  call order (`PAC/agent-loop.js:574`).
- Calls rejected during preparation (validation error, blocked by a hook) never reach `execute`; they only emit
  `tool_execution_end` (`PAC/agent-loop.js:421-430`). Any barrier keyed on `execute` must also be released there.
- Pi already serializes write/edit of the SAME file: `withFileMutationQueue` waits (it does not refuse), keyed by
  `realpath` (`PT/file-mutation-queue.js:11-21, 27-50`); used by `PT/edit.js:95` and `PT/write.js:33`. Registration
  order equals call order because `withFileMutationQueue` chains synchronously on `registrationQueue`.
- Pi exports the stock definitions and the queue: `createEditToolDefinition`, `createWriteToolDefinition`,
  `createReadToolDefinition`, `createBashToolDefinition`, `createGrepToolDefinition`, `createFindToolDefinition`,
  `withFileMutationQueue` (`.../pi-coding-agent/dist/index.d.ts:26`). A port can wrap stock `execute` instead of
  reimplementing it, exactly as omp-lite wraps omp natives through `ctx.invokeTool`.
- A response cut by the output limit does not execute its tool calls (`PAC/agent-loop.js:342-353`): a too-long
  `write` loses the call, which is why the "write in parts" rule exists.
- Consequence for batching: several `edit` or `write` calls in one response ALREADY run in parallel in stock Pi.
  A cross-file `edits[]`/`files[]` saves only the per-call overhead, about 6-8 output tokens per extra call
  (D:44), not a model step. The owner requires it anyway (agreement item 5).

## 1-2. Mechanics, Pi status, port cost, verdict

### edit

| Mechanic | omp-lite evidence | Pi 1.3.0 | Port with Pi names | Verdict |
|---|---|---|---|---|
| Batch across files: `edits[]` entries each with `path`, grouped per file, groups run in parallel | `OL/extensions/tools/edit/index.ts:14, 168, 321-325, 370` | No: one `path` per call, `edits[]` of `{oldText,newText}` (`PT/edit.js:10-21`) | Optional `path` on each `edits[]` entry, top-level `path` becomes optional and is the default for entries without one; group by resolved path; call stock edit `execute` once per group; `Promise.all` | Port (owner requirement). Make per-entry `path` optional: MiniMax failed 4 edit calls on a required `edits[].path` (D:154) |
| Order of edits in one file | Sequential: each edit applied to the result of the previous one, one native call per edit (`edit/index.ts:334-345`) | All edits matched against the ORIGINAL file, must be unique and non-overlapping, applied in one write, all-or-nothing (`PT/edit-diff.js` `applyEditsToNormalizedContent`, lines 215-259 of the file; overlap error at line 251) | Keep Pi semantics: one stock call per file with all its entries | Keep Pi. It is atomic and the Pi description already teaches "matched against the original" (`PT/edit.js:19, 27`) |
| Partial application and report | Per file: stop at first failure, earlier edits of that file STAY written; result lists `Edited:`, `Busy`, `Failed: path, edit i of n` + nearest match, `Applied before the failure: k of n`, `Skipped after the failure above` (`edit/index.ts:347-362, 395-417`); `details.files[]` with status/applied/total (`:418-436`); `isError` if any file not edited | Per call atomic: nothing written on any error | Partial is per FILE only: files that succeed stay written, a failing file is untouched. Report `Edited: path (n block(s))` / `Failed: path: <stock error>` (+ nearest hint), `isError` if any failed | Port the per-file report, not the per-edit partial write |
| Per-file locks, busy refusal | Process-global `Set` `inFlight` (`OL/extensions/shared/locks.ts:3-13`); a file already being changed is REFUSED as busy (`edit/index.ts:330`, `write/index.ts:41`) | Queue that WAITS, realpath key (`PT/file-mutation-queue.js`) | Nothing to add: stock execute already queues | Do NOT port busy refusal (see bugs 3.2) |
| Nearest-match hint on failure | `nearestMatchText`: slides a window of `oldText` line count over the file, whitespace-collapsed, scores per-position char equality, prints the best window with `N|line` numbers (`edit/index.ts:36-70`, used `:360`) | Exact match, then fuzzy match (trailing whitespace, smart quotes, dashes, NBSP; `PT/edit-diff.js` `normalizeForFuzzyMatch`, `fuzzyFindText`); error has no hint (`getNotFoundError`) | On a "Could not find" error only, append a nearest-window hint. Use a real similarity (line-level Levenshtein or common-prefix/suffix), a minimum score, skip on "Found N occurrences" | Port, cheap (no bench evidence, came with the main harness, D:52). Saves a re-read step on a failed edit |
| `replace_all` | `replace_all?: boolean` per entry passed to omp native (`edit/index.ts:166-168, 338-340`) | No; duplicates are an error "Found N occurrences ... provide more context" | Would need a new field (Pi style would be `replaceAll`) and own replacement code, since stock edit rejects duplicates | Skip: no bench evidence, not in the agreement's parameter list (item 3); the stock error already tells the model what to do |
| Single vs batch shape | Either `path+old_string+new_string` or `edits`, never both (`:309-316`) | Accepts legacy top-level `oldText/newText`, `edits` as JSON string or single object (`PT/edit.js:43-73` `prepareEditArguments`) | Reuse `prepareEditArguments` behaviour, add the per-entry `path` | Port |
| GPT `apply_patch` mode, partial hunks | `edit/index.ts:84-150, 216-305` (Lark grammar from omp natives, `:201`) | none | - | MUST NOT port (agreement item 3) |
| `todo` field | `todoParameters` (`edit/index.ts:162`) | none | - | MUST NOT port (omp-lite only) |

### write

| Mechanic | omp-lite evidence | Pi 1.3.0 | Port | Verdict |
|---|---|---|---|---|
| `files: [{path, content}]`, all in parallel | `OL/extensions/tools/write/index.ts:10-14, 38-58` | Single `path`, `content` (`PT/write.js:8-11`) | Add optional `files`; `path`+`content` stay; exactly one shape; per file call stock write `execute` (keeps mkdir -p and the queue), `Promise.all` | Port (owner requirement) |
| Busy refusal | `write/index.ts:40-44` | queue waits | - | Do not port |
| Report | `Written: path`, `Busy...`, `Failed: path: msg`, `details.files[]`, `isError` if any not written; single success returns the native result unchanged (`write/index.ts:60-83`) | `Successfully wrote to path` | Same shape: one line per file, failures last, `isError` if any failed | Port |
| Internal URLs (`agent://`, `local://`, `xd://`, archives, SQLite) | `write/description.md:1`; passed to native write | none | - | MUST NOT port |
| Path-only call delegates to native (`write/index.ts:30-32`) | omp quirk | - | - | Skip |

### read

| Mechanic | omp-lite evidence | Pi 1.3.0 | Port | Verdict |
|---|---|---|---|---|
| Whole file up to 1000 lines without offset/limit, then `[Use offset=N to continue.]` | `OL/extensions/tools/read/index.ts:13-15, 134-143` | 2000 lines or 50 KB bytes (`PT/truncate.js:10-11`), hint `[Showing lines a-b of N. Use offset=N to continue.]` (`PT/read.js:142-152`), also after a user `limit` (`:155-160`) | Wrap stock read or reimplement text path: char-based cap, line cap only on a read without offset/limit | Port the limits by measurement (agreement item 8). Evidence: first read 1000 lines accepted as final (D:20); 500 lines lost 2.6-3.1 quality points (D:166) |
| 100 000-char cap | `READ_CHAR_HARD_LIMIT` (`read/lines.ts:4`); over it: ERROR with no content (`read/index.ts:136-140`) | Byte cap with partial content and continuation (`PT/read.js:134-152`); a single over-limit first line points to `sed` (`:136-140`) | Character cap, but return the prefix that fits plus the offset hint instead of an error | Port the cap value as a starting point, keep Pi's "partial + hint" behaviour (see bug 3.8) |
| `... N lines not shown ...` markers instead of line numbers | `read/lines.ts:66-83` | Pi prints no line numbers either; trailer hint only | Optional | Skip: no evidence |
| Negative offset (from the end), `offset: 0` = 1, int32 clamp, lenient numeric strings | `read/args.ts:41-58`, `read/lines.ts:42-46` | No negative offset; beyond-EOF error (`PT/read.js:118-121`) | Small | Skip unless a probe shows models send negative offsets |
| Code-range expansion to enclosing blocks, ≤150 lines each way, tree-sitter | `read/index.ts:17-18, 96-118`, native `enclosingBlockBoundaries` | none | Needs tree-sitter (WASM grammars) or a heuristic | Do NOT port: rust native; bench gain within noise (expand 37.3 s q87.8 vs base 38.2 s q88.1, D:131) |
| Images/PDF/internal URLs/`xd://eval` topics delegated to omp native | `read/index.ts:19-25, 55-61` | Images supported natively (`PT/read.js:80-108`); no PDF | - | MUST NOT port (`xd://`, eval); PDF claim must leave the description |
| Binary detection (NUL in first 8000 bytes, extension list) | `read/index.ts:21, 82-83, 94` | none (binary read as UTF-8) | Small | Optional, cheap; low priority |
| CRLF normalization at ≥5 % CRLF | `read/lines.ts:23-36` | none | - | Skip |
| `concurrency: "shared"` | `read/index.ts:47` | parallel by default | - | Already in Pi |

### grep (Pi stock `grep`, off by default; agreement item 1 turns it on)

| Mechanic | omp-lite evidence | Pi 1.3.0 | Port | Verdict |
|---|---|---|---|---|
| 51 200-char budget, no line or match cap (safety cap 100 000 matches) | `OL/extensions/shared/search/format.ts:5, 230-235`; `engine.ts:26-27, 170` | Default `limit` 100 MATCHES (`PT/grep.js:18, 24, 68`) + 50 KB bytes (`:215`), lines cut to 500 chars (`PT/truncate.js:12`) | Keep `limit` (Pi name) but default to no match cap; apply a char budget; keep the 500-char line cut or raise it (omp: `MAX_COLUMNS` 1000, `engine.ts:29`) | PORT, highest value. Reason: a 15 000 budget made the first wave list only file names and missed `config.rs`/`config.toml` (D:27, D:113). Pi's 100-match default truncates exactly the broad alternation wave the description asks for. Note: bench41 `pi-prompt` used `rg` through bash, not Pi grep (D:169), so Pi grep with 100 matches is untested |
| Output grouped by file: path once, then `  line:text`; context lines `line-text`, `--` gaps | `format.ts:136-169` | `path:line: text` on every line (`PT/grep.js:145-147, 206`) | Optional reformat in the wrapper | Optional: saves characters per budget; no bench evidence |
| Truncation footer `[Results truncated. Showing a of at least N ... Use offset=...]` | `format.ts:103-134` | `[100 matches limit reached. Use limit=200 ...]`, `[50KB limit reached]` (`PT/grep.js:219-233`) | Footer must name Pi params only | Port the wording idea; no `offset`/`head_limit` |
| `output_mode`, `-A/-B/-C`, `type`, `multiline`, `head_limit`, `offset` | `grep/index.ts:12-42` | `ignoreCase`, `literal`, `context`, `limit`, `glob`, `path` | - | MUST NOT port (agreement item 3) |
| Native Rust engine in-process, newest-first sort by mtime | `engine.ts:1-6, 58-80, 141-173` | spawns `rg` (`PT/grep.js:101`) | - | MUST NOT port (rust natives); rg spawns run in parallel fine |
| Result cache of last 5 searches | `grep/index.ts:10, 92-96`; `format.ts:336-356` | none | - | Do NOT port (stale results, bug 3.6) |

### find (Pi) vs glob (omp-lite)

| Mechanic | omp-lite evidence | Pi 1.3.0 | Verdict |
|---|---|---|---|
| 51 200-char budget, no count cap, newest first, `**/` auto prefix | `OL/extensions/tools/glob/index.ts:40-47, 66-83`; `format.ts:388-410` | `fd`, default `limit` 1000 results + 50 KB (`PT/find.js:22, 28, 66, 213`), basename match unless the pattern has `/` (`:147-160`), not sorted | Port only the char budget (default `limit` high, budget in chars). Mtime sort: skip, no evidence. Glob-tool rename and `target_directory`: MUST NOT port |

### bash

| Mechanic | omp-lite evidence | Pi 1.3.0 | Verdict |
|---|---|---|---|
| Wrapper over omp's native bash through `ctx.invokeTool` | `OL/extensions/tools/bash/index.ts:93-113` | Spawns a fresh shell per call (`PT/bash.js:48-125`) | - |
| Persistent shell, `pty`, background jobs `bg_N`, `block_until_ms` auto-background via a global settings override with a 50 ms gate, `async`, named services with `ready`, `cwd` param, `artifact://` full output, "no head/tail/redirection" | `bash/index.ts:8-17, 43-62, 64-82, 102-110`; `bash/description.md:1-8` | none | MUST NOT port (omp runtime features) |
| `pty` → exclusive, else shared | `bash/index.ts:88` | parallel; `sequential` would serialize the whole response (`PAC/agent-loop.js:368`) | Do not mark bash sequential; use a barrier (section 3.1) |
| No default deadline (`timeout: 0` when unset) | `bash/index.ts:100` | No default timeout either (`PT/bash.js:16-27, 30`) | Portable as is: Pi `timeout` in seconds already exists |
| Output caps | omp native (artifact) | tail 2000 lines / 50 KB, full output to a temp file (`PT/bash.js:166, 233-253`) | Keep Pi; optionally switch to a char cap chosen by measurement (agreement item 8) |
| "One fact per command, dependencies with `&&`" | `bash/description.md:1` | - | Portable description line |

## 3. Bugs and weak spots in omp-lite

3.1 **Race: bash (and read/grep/glob) in the same response read files before write/edit finish.** All are
`shared` (`bash/index.ts:88`, `read/index.ts:47`, `grep/index.ts:57`, `glob/index.ts:55`, `write/index.ts:20`,
`edit/index.ts:207`); omp starts every shared call of a response together (D:41, D:43). The only coordination is
`inFlight` (`locks.ts:6`), which only write/edit consult, and it refuses instead of waiting. Stock Pi has the same
race: parallel by default and `withFileMutationQueue` only covers write/edit.
Fix design for Pi (no `sequential`, which would serialize everything):
- In a `tool_call` handler, which runs for every call of the response in call order before any execution
  (section 0), register for each `write`/`edit` call a deferred keyed by toolCallId and its resolved paths.
- `bash` (any command can read anything) waits for all deferreds registered before its own `tool_call`.
  `read` waits only for earlier mutations of the same realpath; `grep`/`find` wait for all earlier mutations
  (cheap: mutations are milliseconds).
- Resolve each deferred in the tool's own `finally` AND on `tool_execution_end` (calls rejected in preparation
  never run `execute`, `PAC/agent-loop.js:421-430`), and on abort, or later calls hang.
- Open choice for the coordinator: whether `write`/`edit`/`read` placed AFTER a `bash` in the same response wait
  for that bash (bash may itself change files, e.g. `git checkout`). The reported race is only
  write/edit → bash; full "no race of any kind" (agreement item 7) needs this second direction too, at the cost of
  serializing reads behind a slow bash.
- Nested calls via `ctx.executeTool` also fire `tool_call` with `parentToolCallId` (`PCA/agent-session.js:327-339`);
  the barrier must ignore or scope them.

3.2 **Busy refusal instead of waiting.** Two calls touching one file in one response (write then edit, or two
edits) → the later one fails "Busy, not edited" (`edit/index.ts:330, 378-383`; `write/index.ts:41-43`) and the model
spends a step to retry. Duplicate paths inside one `files[]` collide with each other the same way (write does not
group by path, `write/index.ts:38-46`). Pi's queue waits in call order, which is the better semantics.

3.3 **Lock key is weak.** `lockKey` = `path.resolve` (`locks.ts:9-13`), case-folded only on win32: on macOS
(case-insensitive APFS) `A.ts`/`a.ts`, and symlinks, get different keys. Pi's queue uses `realpath`
(`PT/file-mutation-queue.js:11-21`) but also does not fold case for files that do not exist yet; Windows paths
through Git Bash (`/c/...`) need checking in the Windows probes.

3.4 **Non-atomic multi-edit of one file.** After a failure the earlier edits of that file stay written
(`edit/index.ts:334-362`), leaving a half-edited file; the report is accurate, but the model must reason about the
partial state. Pi is atomic per call.

3.5 **Nearest-match quality.** `lineSimilarity` compares characters at the same index (`edit/index.ts:36-44`), so
one inserted character shifts the rest and scores near zero; there is no minimum score, so an unrelated window is
always printed; the hint is also attached to non-"not found" failures such as duplicates (`:360` runs for any
failure), where it is misleading; `readFileSync` blocks the event loop.

3.6 **Stale grep cache.** `SearchResultCache` keeps the last 5 results keyed only by the request (`format.ts:307-356`,
used `grep/index.ts:92-96`): no cwd in the key, no invalidation on file change. A grep repeated after an edit (to
verify it) returns the pre-edit matches.

3.7 **bash threshold hack.** `setThreshold` overrides a global omp setting before each call and relies on a 50 ms gap
so the native bash reads its own value (`bash/index.ts:43-62`); parallel bash calls with different
`block_until_ms` can see each other's value. omp-only, not ported.

3.8 **read limits.** Over 100 000 chars the result is an error with no content, even for the greedy 1000-line cut
(`read/index.ts:134-140`): a 1000-line file with long lines, or one minified line, gives nothing. Code expansion can
push a valid range over the cap and turn it into an error. The text is silently cut at 8 MB (`read/lines.ts:6, 20-22`).
The description promises PDF conversion (`read/description.md:13-14`), which Pi's read does not do.

3.9 **Engine differences** (omp-only): glob filters case-sensitive, negated glob applied after the search,
`multiline` without dotall (D:33); search timeout 25 s (`engine.ts:28`).

## 4. Description texts

Lines that carry behaviour with evidence (keep, rewrite to Pi names):

- `grep/description.md:10`, the wave method: first response several broad content-mode greps in parallel, one per
  facet, each an alternation of every name; glob for run files; next responses read whole the files that define or
  configure the subject and point-read other hits; grep exact identifiers just found; stop rule. Evidence: bench17
  omp-lite read 27 files (122 KB) per run, half never cited, T05 spent 2-4 extra steps (D:112); bench41 shows the
  prompt-level method alone (rewritten for `rg` through bash) raised stock Pi by 10.2 / 6.2 / 1.9 quality points
  (D:174). For Pi: "content mode without head_limit" → "without limit", "glob" → `find`, "read with read" stays.
- `read/description.md:6` and `glob/description.md:6`, batch reads/searches in one response; `read/description.md:15`,
  second sentence "Read every file that may relate to the subject in one response" (D:47). Cost model behind it:
  a step costs about 2.2 s plus 1.16 s per 100 output tokens (D:44).
- `read/description.md:15`, first sentence: whole file up to 1000 lines, then the offset to continue (D:20, D:166).
  The numbers must match whatever limit the coordinator measures.
- `write/description.md:1`, last sentence: write files over about 400 lines in parts, first with write, the rest
  with edit (D:102, bench35 lost a response at the 128 000-token output limit). In Pi "append with edit" needs a
  unique anchor at the end of the file; say so.
- `edit/description.md:1`: one call for many files, per-file report, nearest-match hint, "Read a file before
  editing it". Rewrite to Pi semantics: `oldText`/`newText`, optional per-entry `path`, edits of one file matched
  against the original and applied all-or-nothing, a busy file waits instead of being refused.
- `grep/description.md:3-5, 9`: use the tool instead of shell rg, default scope, escape metacharacters, truncation
  note (rename `head_limit` → `limit`).
- `bash/description.md:1` first sentence ("one fact command/pipeline; dependencies use `&&`") and `:5` (no
  deadline unless `timeout`) are portable.

omp-specific, must not be carried over:

- `bash/description.md:2-4, 6-8`: `eval`, `cwd` param, `pty`, internal URIs, `block_until_ms`, `bg_N`, "NEVER poll",
  `artifact://`, "No head/tail/redirection", services/`ready`.
- `write/description.md:1` sentence on internal URLs (`agent://`, `local://`, `xd://`, archives, SQLite) and the
  "busy" refusal wording in write and edit.
- `grep/description.md:6-8`: `type`, `multiline`, `-A/-B/-C` (Pi has `context`); `glob/description.md:4` "sorted by
  modification time" (false for Pi `find`).
- `read/description.md:13-14` PDF support; `:16` code-range expansion (not ported).
- Everything about `apply_patch`, `todo` fields, `load_tools`, `lsp`, `ast_grep`, subagents.
