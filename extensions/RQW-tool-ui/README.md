# RQW-tool-ui

Compact display of tool calls in the TUI transcript. Concept approved by the owner:

- All tool calls between two assistant answers collapse into one grey summary line with counters of reads, edits
  (`+N -M`), searches, runs and waits for agents. The line sits right before the answer.
- While the agent works, the current call stays visible under the line in compact form: a header row with the
  command or file, the last four output lines and a status row. When the next call starts, it folds into the counters.
- As soon as the agent starts writing its answer text, the live block folds and only the summary line stays.
- Ctrl+O (expanded tools) shows the original: every call in Pi's standard view at its own place; Ctrl+O again folds back.
- Accepted limit: Pi keeps one or two blank rows per model step with thinking; an extension cannot remove them.

## Current state

The scaffold and pure data and render functions are in place; none is wired to Pi yet, so nothing is drawn
differently from stock Pi.

- `index.ts` registers one tool renderer resolver that returns `next()` unchanged for every tool, so every call
  renders exactly as stock Pi. It creates no components, statuses, timers or subscriptions. It is not listed in
  the package manifest yet.
- `classify.ts`: `classify(toolName, args, result, context)` turns one call into
  `{ kind, target, status, countKey, countKeys, outputText, exitCode? }` for `read`, `grep`/`find`, `bash`,
  `wait` of `agent`/`code_writer`/`shell_runner`/`review` (one count key per waited ID) and every other tool.
  The `read` count key is the lexically normalized path, as Pi 1.4.0 `resolveToCwd` resolves it (no filesystem
  access): Unicode spaces (NBSP, U+2000-200A, U+202F, U+205F, U+3000) fold to a space, a leading `@` goes, `~`, `~/`
  (Windows also `~\`) expand with the home folder, `file://` URLs become paths, Windows shell drive forms (`/c/`) read as
  `C:`; the cwd base gets the same expansions except space folding. The same file under any of these spellings counts once.
- `changes.ts`: `classifyChange(toolName, args, result, context)` for `edit` and `write`: the same fields plus each
  file's own status and `+added -removed`, counted only from the confirmed result (Pi's diff or patch, RQW multi-file
  `details.files[]`, written content lines), never from the requested text or the disk. RQW `edit` groups paths by filesystem identity, which can merge
  spellings the classifier keeps apart, so a finished call with `details.files[]` takes its file list from those
  entries (the requested args are only the fallback); with no list, one stock result counts once per call, on the
  first file, never again for another spelling of it. Its `target` is the whole
  live-block header, `edit <path>` or `write <path>`, for several files the first path plus ` +N more`; a renderer
  shows it as is, without adding the tool name.
- `summary.ts`: `renderSummary(calls, width, theme)`, the summary line of one group in the accepted design:
  `↳ Edited 2 files +24 -8 · read 6 files · searched 1 time · ran 2 commands · waited for 1 agent · used 1 tool ·
  1 failed`. Parts in this order, zero parts omitted, the first capitalized; distinct files and waited IDs; `+A -R`
  only from confirmed counts; muted line, diff and error colors from the supplied Pi theme; cut at the end.
- `live.ts`: `renderLive(call, width, theme)`, the live card of the current call under the line, indented three
  columns: header (`$ <command>`, `read`/`grep`/`find`/`edit`/`write <target>`, `wait <ids>`, `<tool> <arg>`, cut
  at the start so the end stays visible), the last four output rows (an edit's confirmed diff when there is one)
  and a status row (`running`, `✓ 1.2s`, `✗ exit 2 · 3.1s`, `✗ error`; the time only from Pi's final duration).
  One solid card on Pi's pending, success or error tool surface; title, output, diff and status roles from the theme.
- `groups.ts`: `buildGroups(contextEntries, live)` from `ctx.sessionManager.buildContextEntries()` (the entries Pi draws:
  after a compaction only the compaction and the kept entries) plus the streaming state of public events:
  per top-level call its group, whether it leads (the last call), whether the group is active (no answer text, user
  message, displayed custom message, `!` command, compaction or branch summary after it yet) and the current call.
  Nested calls (codemode) count instead of their parent and can be current. A streamed message already saved counts
  once, at its saved place (custom messages match by type, display and content). The live block follows a call whose
  arguments still stream, else the latest started call while one runs, else the next queued call; a call that has
  its saved result counts only through what Pi saved, so a reload gives the same current call.
  Once the parent has its result, Pi's saved record of nested calls is the only source, in the stream as after a
  reload (see Dropped below); a call left `unfinished` there is unconfirmed (no success, failure or counts). A nested
  call's failure and a write's lines (from saved arguments) still count.
- `test/harness.ts`: width sweep (`assertFits`, 0..160 columns), wide and styled samples, identity and colored theme
  painters, fixed clock.

## On and off

The extension is switched with Pi's package filter (`pi config`, or a `packages` entry with
`-extensions/RQW-tool-ui/index.ts`) and `/reload`. It has no toggle or setting of its own.

## No patch

Public Pi extension and TUI APIs only: no fork or edit of Pi, no replacing or wrapping of Pi methods, no private
fields, no deep imports. A feature that cannot be built that way is dropped and named as dropped.

### Dropped: needs a Pi patch

Pi 1.4.0 saves only a bounded record of the calls a tool makes itself (codemode nested calls, `nestedCalls` on the
parent's result): name, status, duration and error, arguments only up to 8 KiB per call and 32 KiB per parent, at
most 256 calls, and no result or details at all. Only a Pi patch could save more, so these are dropped for nested
calls, in the stream as well as after a reload:

- an edit's `+A -R` counts;
- a bash command's exit code;
- everything that depends on arguments Pi left out of the record: the target (path, pattern, command) and a write's
  line count; calls beyond the 256 Pi keeps are not counted at all.

A possible alternative without a patch, offered to the owner as a later task and not built: RQW-tools could record
the results of the nested calls it executes itself.
