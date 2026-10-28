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

The extension is wired to Pi: every tool call in the interactive transcript is drawn as described above.
`package.json` registers it in `pi.extensions`, after RQW-agent-ui, so normal package loading enables it.
The theme is distributed separately through `pi.themes`, not as an extension.

### Wiring (`index.ts`, `render.ts`)

- `index.ts` registers one tool renderer resolver and the public events the groups need: `session_start`,
  `session_shutdown`, `session_compact`, `session_tree`, `message_start/update/end`, `tool_execution_start/update/end`
  and `agent_end`. Only a session started in Pi's interactive TUI (`ctx.mode === "tui"`) keeps state; print, JSON and
  RPC modes keep nothing and draw nothing (Pi resolves no tool renderers there).
- The resolver gives every tool, known or not, `renderShell: "self"` renderers and keeps what comes after it
  (`next()`: another extension's renderers, else the tool's own, else nothing) as the original. Pi's shell choice is
  static per definition, so the original look is reproduced inside the self shell (below).
- Collapsed: a call that does not lead its group draws no row at all (Pi's tool row takes zero rows). The leader, the
  last call of the group, draws the summary line and, while the group is active, the live card of the current call
  under it. Both are indented by Pi's `outputPad`, like the assistant text. The rows are drawn at render time from
  the current groups, so a new call, a result or the start of the answer text shows on the next frame; the rows whose
  look changes (old and new leader, the active leader) are asked to redraw through the `invalidate` callback Pi gives.
- The live card of every `agent` call (all actions) has a whole-card purple background by state, constants in `live.ts`: running `#28202b`, success `#210d2b`, error `#351c34`; other tools keep the theme's tool backgrounds.
- Expanded (Ctrl+O, or a click on the row): every call shows its original at its own place, exactly as Pi draws it
  without this extension (owner decision after a visual comparison: the same look, not a simplified one). The row
  rebuilds Pi's shell from public pi-tui components: a `Box` with Pi's padding (`outputPad`, one blank row above and
  below) and its pending/success/error tool background, holding what the original renderers (`next()`) return for the
  call and the result, with the row's own last components and Pi's renderer state; a bare `Container` for an original
  that draws its own frame; Pi's padded text for a tool Pi has no definition for. Pi adds the leading blank row and the
  images itself. Expanded rows show no summary line; Ctrl+O again folds back.
- Pi's fallback formatting (a call without `renderCall`, a result without `renderResult` or whose renderer throws, or
  a tool without a definition, such as an unavailable tool in stored session history) is not exported by Pi, so
  `fallback.ts` holds a small copy of it, approved by the owner, pinned to Pi 1.4.0 with its sources cited in
  its header. Maintenance: on a Pi upgrade, compare `fallback.ts` with the cited Pi sources and update the pin.
- The original renderers are called where Pi calls this row's renderers: their call side from the start of execution
  (so the bash clock starts when Pi's would), their result side from the first expansion on, and from then on with
  every result, folded or not. A final or failed result therefore reaches them and they stop what they started
  (Pi's bash renderer stops its one-second redraw timer); a call never expanded never runs them for results.
- Images: Pi appends a result's images to the tool row itself, outside the renderers. These renderers draw no image
  and change nothing of Pi's image output; a folded row with an image shows just Pi's image.
- Groups come from `ctx.sessionManager.buildContextEntries()` plus the streaming state (`groups.ts`). The state is
  reset on every `session_start` and dropped on `session_shutdown` (reload, session switch, quit); rows of the
  transcript Pi rebuilds before `session_start` are redrawn once the session is known. No timers of its own.
- Accepted limit: every model step with thinking keeps Pi's own blank row and, while thinking is hidden, its label row;
  this extension cannot remove them.

### Wait results

`agent` calls with `action: "wait"` count as `waited for N agents` in the summary line and the live block shows
`wait <ids>`. Reviewer profiles `spotty` and `bossy` run as ordinary `agent` children and use these same waits.
RQW-agent-ui is registered before tool-ui; while collapsed it delegates to tool-ui, and Ctrl+O shows agent-ui's
expanded wait cards with the full answers. Without tool-ui, agent-ui renders its collapsed wait cards.

Stored standalone `review` waits keep the same compact summary and live wait header only for legacy history
compatibility. This rendering starts no reviewer and provides no current `review` tool; RQW-review supplies
profiles and skills for the ordinary `agent` runtime.

### Data and render functions

- `classify.ts`: `classify(toolName, args, result, context)` turns one call into
  `{ kind, target, status, countKey, countKeys, outputText, exitCode? }` for `read`, `grep`/`find`, `bash`,
  `agent` waits (one count key per waited ID) and every other tool. Stored standalone `review` waits retain the same
  classification only for legacy history compatibility.
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
  `Edited 2 files +24 -8 · read 6 files · searched 1 time · ran 2 commands · waited for 1 agent · used 1 tool ·
  1 failed`. Parts in this order, zero parts omitted, the first capitalized; distinct files and waited IDs; `+A -R`
  only from confirmed counts; muted line, diff and error colors from the supplied Pi theme; cut at the end.
- `live.ts`: `renderLive(call, width, theme)`, the live card of the current call under the line, indented three
  columns: header (`$ <command>`, `read`/`grep`/`find`/`edit`/`write <target>`, `wait <ids>`, `<tool> <arg>`, cut
  at the start so the end stays visible), the last four output rows (an edit's confirmed diff when there is one)
  and a status row (`running`, `✓ 1.2s`, `✗ exit 2 · 3.1s`, `✗ error`, `aborted`; the time only from Pi's final duration).
  An assistant stopped with `aborted` or `error` before execution gives its calls that terminal status, in the live
  stream and saved history, without inventing a tool result. Aborted status uses the theme's error foreground and
  tool surface, not the tool-title color. Confirmed execution results keep their own status.
  One solid card on Pi's pending, success or error tool surface; title, output, diff and status roles from the theme.
- `groups.ts`: `buildGroups(contextEntries, live)` from `ctx.sessionManager.buildContextEntries()` (the entries Pi draws:
  after a compaction only the compaction and the kept entries) plus the streaming state of public events:
  per top-level call its group, whether it leads (the last call), whether the group is active (no answer text, user
  message, displayed custom message, `!` command, compaction or branch summary after it yet) and the current call.
  Nested calls (codemode) count instead of their parent and can be current. A streamed message already saved counts
  once, at its saved place (custom messages match by type, display and content). The live block follows a call whose
  arguments still stream, else the latest started call while one runs, else the next queued call; a call that has
  its saved result counts only through what Pi saved, so a reload gives the same current call.
  Once the parent has its result, Pi's saved nested record determines membership, status and arguments, in the
  stream as after a reload. A call left `unfinished` stays unconfirmed.
  A nested call's failure and a write's lines (from saved arguments) still count. A failed outer codemode keeps its
  error output and status in the current card even when nested calls succeeded. Its failure remains in the folded
  summary, without an extra parent tool count or recounting a propagated nested failure. Nested details and expanded
  originals are unchanged.
- Tests: run `node --test test/extensions/RQW-tool-ui/render.test.ts`.

## On and off

The extension is switched with Pi's package filter (`pi config`, or a `packages` entry with
`-extensions/RQW-tool-ui/index.ts`) and `/reload`. It has no toggle or setting of its own. After `/reload` Pi draws
the transcript anew without this extension's resolver, so old and new tool calls look exactly as stock Pi draws them;
switching it on again the same way brings the compact display back for the whole transcript.

## No patch

Public Pi extension and TUI APIs only: no fork or edit of Pi, no replacing or wrapping of Pi methods, no private
fields, no deep imports. A feature that cannot be built that way is dropped and named as dropped. The one copy of Pi
code is the expanded fallback formatting in `fallback.ts` (above), with the owner's approval.

RQW-tool-ui is registered in `package.json` `pi.extensions`, after RQW-agent-ui.
