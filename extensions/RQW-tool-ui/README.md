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

Only the core is in place: the scaffold and pure data functions. Nothing is drawn differently from stock Pi yet.

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
- `test/harness.ts`: width sweep (`assertFits`, 0..160 columns), wide and styled samples, identity and colored theme
  painters, fixed clock.

## On and off

The extension is switched with Pi's package filter (`pi config`, or a `packages` entry with
`-extensions/RQW-tool-ui/index.ts`) and `/reload`. It has no toggle or setting of its own.

## No patch

Public Pi extension and TUI APIs only: no fork or edit of Pi, no replacing or wrapping of Pi methods, no private
fields, no deep imports. A feature that cannot be built that way is dropped and named as dropped.
