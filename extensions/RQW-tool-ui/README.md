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
  and `agent_end`. Interactive history is prepared before Pi builds its components. Print, JSON and RPC modes keep
  nothing and draw nothing (Pi resolves no tool renderers there).
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
- Groups come from the whole active branch, `ctx.sessionManager.getBranch()` (RQW-blocks lets Pi draw it all after a compaction, so calls before the compaction keep this view), plus the streaming state (`groups.ts`). The state is
  prepared before `renderSessionEntries`, keyed by the live session and extension runtime. `session_start` does not
  rebuild the groups. On shutdown, event data and session references are released while the old visible rows stay
  intact until Pi replaces the transcript or stops. No timers of its own.
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
- `groups.ts`: `buildGroups(contextEntries, live)` from `ctx.sessionManager.getBranch()` (every entry of the branch, compactions at their place) plus the streaming state of public events:
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

### Worked-for folds (`fold.ts`)

- Once a run settles (`agent_settled`), each successful final answer (stop reason `stop`, text, no tool calls)
  closes its own span. Earlier answers, including questions to the owner, never enter a later fold. A later tool or
  delivered agent notification never cancels their boundary. Work folds under one dim row, indented by `outputPad`:
  `worked for 42s ›`. Open, the angle turns to `˅`. The final answer, with its thinking, stays outside and unchanged.
  While the agent works, the live view is today's.
- User messages no longer split spans. All owner messages, including skill-invocation bundles and messages sent
  mid-work, appear in order above the closed header. Opening returns them to their original positions among the work.
  A sole user arriving after an agent card is lifted too. Agent notification cards and tools fold.
- The original user components and their spacers stay in `children`; only their rendered rows are projected by the
  header owner. Closed rows are cached by width, theme, padding, open state and source revision. Original `invalidate`,
  `setExpanded`, `setOutputPad` and `rebuild` calls invalidate their bundle's fold cache; stock Ctrl+O still reaches skills.
  The cached source-row ranges route clicks back to the original user/skill component. The header's local row follows
  those ranges, so wrapped messages and resize do not make owner rows into fold-toggle targets.
- Time starts with the span's first message `timestamp`, or the saved entry `timestamp` of its first delivered card
  when the span starts without an owner message. It ends with the final answer's saved entry `timestamp`. The idle
  pause before that first message/card is excluded; waiting and closed Pi within the span count. Whole seconds are
  rounded first: `42s`, `1m 00s` (59.6 s), `2m 03s`, `1h 05m`; no space before units. Invalid times give `worked`.
- A left click anywhere on the row opens or closes that fold only. Press, drag and copy stay Pi's text selection.
  Ctrl+O keeps switching tool originals and Enter keeps sending; neither toggles a fold. No hints anywhere.
- Open shows literally the rows from before the fold: the same components, renderers, colors, padding and blank rows,
  with the current Ctrl+O and Ctrl+T state. The header is inserted before the first component's content, preserving
  its leading blank row when present. No original rows or blank rows are added, removed or trimmed.
- Compaction and branch summary lines, `!` commands and every compaction's `firstKeptEntryId` are hard boundaries.
  At a kept-entry cut, the unfinished historical prefix gets its own closed `worked for <time>` fold, ending at
  its last saved entry before the cut. Its clock starts at the first message/card, or the first visible assistant
  work record when neither owner nor card starts it. The local suffix can fold at its own successful answer with
  its own clock. This also applies to the non-lazy whole-branch view. A fold never crosses a kept-entry cut, even
  when both intervals are loaded. A wake-up without a new user message can have its own fold.
  Not folded: an unfinished span not closed by a kept-entry cut, including error, abort or length; a span without work; inline
  mode (no mouse, today's view). A successful retry can fold earlier errors within its own span.
- Old turns fold too: on resume, reload, rebuild and whatever history interval is loaded. Every newly drawn transcript
  or interval starts closed; resize and redraws keep the open state.
- Delivered custom cards match by type, display, content and saved order between normal-message anchors. Each
  occurrence uses its persisted entry ID, so identical cards in different spans stay independent. The live card's
  send timestamp need not equal its entry's persistence timestamp; matching never depends on that equality.
- Runtime patch under `[D-SCOPE-RUNTIME-PATCH]`: wrappers on `InteractiveMode` prepare the current resolver's
  session before history construction and record whole message bundles. A live theme getter is independent of the old
  session context. Shutdown freezes the visible bindings; replacing history or stopping the host releases them. An O(1)
  guard on that container's `render` binds again when the transcript's first child changes or after a settled run,
  compaction or tree navigation. Bound components keep their place, order and identity, so Pi's own Ctrl+O and Ctrl+T
  walks still reach them; they get an own `render` (hidden: nothing, without calling the original) and `handleMouse`.
  Lifted components also get source-update wrappers. All wrappers and cached source references are removed when unbound. Pi's Container and fullscreen renderer draw and route
  the mouse as usual. Own and inherited descriptors are checked before any wrappers are installed. Any other shape
  installs or binds nothing and keeps today's view.
- Tests: `test/extensions/RQW-tool-ui/fold.test.ts`, Pi's real InteractiveMode, Container and TuiAltScreen over a fake
  terminal, including selected-branch rebuilds and unsupported inherited component methods. `test/lazy-folds.test.ts`
  covers local suffixes through two kept-entry cuts, lifted owners, repeated identical cards, interval reload and
  released source-update wrappers. `test/worked-for-skills.test.ts` loads skill-dollar only in a root compatibility
  fixture: linked multi-skill user cards, skill-only cards, Ctrl+O/Ctrl+T, exact expanded originals, rebuild and inline.
  Run: `npm run check -- --typecheck --test 'test/extensions/RQW-tool-ui/*.test.ts' test/lazy-folds.test.ts test/worked-for-skills.test.ts`.

## On and off

The extension is switched with Pi's package filter (`pi config`, or a `packages` entry with
`-extensions/RQW-tool-ui/index.ts`) and `/reload`. It has no toggle or setting of its own. After `/reload` Pi draws
the transcript anew without this extension's resolver, so old and new tool calls look exactly as stock Pi draws them;
switching it on again the same way brings the compact display back for the whole transcript.

## Patches

The tool rows use Pi extension and TUI APIs. The early history and worked-for hooks patch Pi 1.4.0 in memory,
with shape checks and stock rendering on an incompatible host. There is no fork, installed-file edit or deep import.
The one copy of Pi code is the expanded fallback formatting in `fallback.ts` (above), with the owner's approval.

RQW-tool-ui is registered in `package.json` `pi.extensions`, after RQW-agent-ui.
