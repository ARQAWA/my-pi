# RQW-statusbar: source evidence and contract

The scope is the owner's **bottom status bar elements and placement**, not the rest of omp's composer,
feed, title, task panel or action rows. Colors are deliberately not reproduced or tuned.
`extensions/RQW-statusbar/{index,git,render}.ts` started as uncommitted predecessor files; this work builds on them.

## Read-only sources

Read on 2026-10-21; no source repository or agent configuration was modified.

- `~/.omp/agent/config.yml:3,5-6,37-60`: `symbolPreset: nerd`, composer `shape: rule`, `tokenRate: false`;
  `statusLine.preset: custom`, `contextLine: off`, `sessionAccent: false`, `transparent: true`,
  `compactThinkingLevel: false`, `showHookStatus: false`, `separator: none`.
  `leftSegments: [model, token_rate, mode, status]`, `rightSegments: [path, collab, stream, git, pr]`;
  `segmentOptions.model.showThinkingLevel: true`.
- The same config's `extensions` loads `~/Documents/ChatGPT/my-omp-harness`, whose checked-out branch is `master`,
  at `f73cc873353b89632f842c0218b366237f257aec`. Its `package.json` loads `extensions/ui/status-bar.ts`.
  The branch `lite`, at `a0a59abd776322770bb18ad1ed5a2be68c7cea85`, loads that same path.
  `deprecated`, at `8822104ee3e1bb36a51b8d9bbcadb4e589d70cd9`, has `extensions/status-bar.ts` instead,
  with the same footer arrangement and the older `cursor-feed` imports. It is historical, not the configured checkout.
  All three files were read through `git show`, without switching branches.
- `my-omp-harness` `master:extensions/ui/status-bar.ts`: `patchTokenRate` removes the native rate segment and
  captures `session.tokenRate.rate()`. `captureSegment` moves git and PR to the right of the place row.
  `patchStatusJoin` joins statuses with ` · `. `patchMode` preserves both Plan and Goal when active.
  `patchStatusLine` draws `contextLine`, then `rowLeftRight(model, cmp + rate)`, then
  `rowLeftRight(placeAndJobs, git + pr)`, dropping the blank gap below the input. Running agents go after the model
  and running jobs after the place. Context uses the selected session's `getContextUsage()`; `cmp` counts all
  `compaction` entries. `contextLine` uses the compaction trigger as denominator, caps the percentage at 100,
  and formats tokens with `fmtK`. Its trigger precedence is explicit tokens, percent, then reserve with a 15% floor.
- `~/.omp/agent/themes/titanium-arq.json:96-103`: the symbol override `sep.dot: " "` means the model's thinking
  label is separated by a **space**, not a middle dot. The harness's explicit middle dots between statuses,
  compaction count and rate are unaffected. No other model/path/git glyph is overridden.
- `~/Documents/ChatGPT/oh-my-pi/packages/tui/src/status-line/segments.ts`: `modelDisplayName` drops `Claude `;
  `modelThinkingDisplay` appends thinking only for a thinking-capable model. `pathSegment` uses worktree project/name
  unless name equals branch, otherwise temp-root stripping, Projects/repos/work stripping, home abbreviation, and
  `maxLength` default 40. `gitSegment` shows branch followed by unstaged `*N`, staged `+N`, untracked `?N`.
  `prSegment` displays linked `#N` only when PR metadata exists. `collabSegment` and `streamSegment` require active
  collaboration, broadcast or recording metadata. `modeSegment` requires an active mode.
- `oh-my-pi/packages/tui/src/theme/symbols.ts:817-880`: nerd glyphs are model U+EC19, folder U+F115,
  scratch U+F014, worktree U+F0E8, branch U+F126, throughput U+F0E4.
- `oh-my-pi/packages/coding-agent/src/utils/token-rate.ts`: omp's `TokenRateMeter` is a multi-scale decayed,
  locally tokenized stream-time meter with hidden-token correction and evidence gates. It is not a simple average.

## Implemented rows, in order

1. As the bottom border of Pi's editor: a full-width context bar, then the rounded percent and `tokens/threshold`.
   Filled cells are `━`, empty cells `─`; no usage/window means a plain empty rule. With input lines hidden below,
   the editor's own `↓ N more` hint (in the editor's border color) comes first and the bar takes the remaining
   width; when the hint alone fills the width, only the hint is shown, cut with `…`.
   When another extension's editor is in place, this row is the first footer row instead (see Pi APIs).
2. Left: nerd model glyph, model display name, thinking abbreviation, then extension statuses joined by ` · `.
   Thinking: `off -> no`, `minimal -> min`, `low -> lo`, `medium -> md`, `high -> hi`, `xhigh -> xh`, `max -> mx`.
   Right: `cmp N`, then ` · ` and nerd throughput glyph plus `R.R tok/s` once measured.
3. Left: nerd folder, scratch or worktree glyph and working place. Right: nerd branch glyph and branch,
   then `*unstaged +staged ?untracked`, omitting zero counts.

Above the input, the editor's top border ends with the full session ID (`ctx.sessionManager.getSessionId()`,
a UUIDv7 in Pi 1.3.0, also with `--no-session`), framed by rule cells with one plain space on each side:
`── <working…> ─────── <session-id> ──`; idle, the left part is only rule cells. The left part is Pi's own top
border (`CustomEditor.renderTopBorder`: the embedded working, retry or compaction status and the up-arrow
`N more` hint) drawn at the width minus the 40 cells of ` <id> ──`. The ID is shown only when that narrower stock
border keeps exactly its full-width text and still ends in at least two rule cells; otherwise the ID is dropped
whole and Pi's border is drawn at the full width, so the ID is never cut and Pi's status never gives way to it.
For the 36-character ID this means at least 42 columns idle and 58 with `⠋ Working...`. The ID is one uninterrupted
run of text in the `muted` color between border-colored spaces and rules, so a terminal selection copies it as a
single word. It is read on every render; `/new`, resume, fork and `/reload` also reinstall through `session_start`.
With the bar off or another extension's editor in place there is no ID: Pi's top border is unchanged.

Both columns retain their edge. When they overlap, the left column yields first, just like omp's `rowLeftRight`.
Every row is fitted with Pi TUI's ANSI-aware `visibleWidth` and `truncateToWidth`. Width zero is supported.
Metadata cannot inject new terminal rows or terminal control sequences. Paths accept POSIX, Windows drive and UNC
forms; Windows root comparison ignores case, with directory boundaries. Git uses `execFile`, never shell quoting.

## Pi APIs and independence

Pi is pinned at 1.4.0. The implementation uses `ctx.mode === "tui"` and the supported
`ctx.ui.setFooter(factory)` and `ctx.ui.setEditorComponent(factory)` APIs. `setFooter(undefined)` restores Pi's
built-in footer, `setEditorComponent(undefined)` its default editor.

The editor (`editor.ts`) extends Pi's exported `CustomEditor`, as `docs/tui.md` recommends for replacing the main
editor, and overrides only `renderBottomBorder(width, hiddenLineCount)` (stock: `pi-tui`
`dist/components/editor.js:389-392`) and `renderTopBorder(width, hiddenLineCount)`, which calls Pi's own
(`dist/modes/interactive/components/custom-editor.js:24-56`, falling back to `pi-tui` `editor.js:385-388`) and
only appends the session ID. It keeps `embedWorkingStatus: true`, as Pi's default editor, so the working
status stays in the top border. When Pi installs it (`dist/modes/interactive/interactive-mode.js:2243-2307`), Pi
carries over the text, callbacks, border color, padding, autocomplete and app key handlers; thinking/bash border
colors keep applying to the top border and the hint. The bar itself keeps its own colors.
One editor factory per extension instance identifies ours through `ctx.ui.getEditorComponent()`:
at install the extension sets it only when no editor factory is installed, so another extension's editor is kept;
the footer shows the context row whenever the installed factory is not ours (also when another extension replaces
ours later). Off removes the editor only if it is ours. On session replacement and reload Pi resets extension UI
(`resetExtensionUI`) and `session_start` installs again; the border falls back to Pi's stock border once the bar's
session has shut down. The factory receives the
TUI, theme and `ReadonlyFooterDataProvider`: extension statuses and a branch-change subscription.
The bar discovers repositories itself and refreshes branch and counts with asynchronous git calls, never with
synchronous git calls during render. It does not read Pi's cached branch: that cache can retain an absent repository
after `git init` in the same cwd. Every refresh rediscovers metadata, including repository replacement and checkout.
The component owns and disposes its subscription and 10-second git poll, including replacement, toggle and shutdown.
In-flight git results cannot update a disposed footer. Tools and agent completion trigger a refresh too.
No settings, session, git or filesystem queries are made by this extension in print, JSON or RPC mode.

`runner.js:createContext` supplies live model/cwd/session getters. `ctx.model` and `pi.getThinkingLevel()` are
read each render, not just remembered from select events. Selection events request redraws; ordinary renders also
observe direct state changes by other sources. Context is cached by manager, session, leaf, entry count, model,
window and compaction settings, as Pi's own footer caches session statistics.

Context comes from `ctx.getContextUsage()` and therefore uses Pi's actual effective window, including a cap applied
by another extension. The denominator is that window minus
`SettingsManager.inMemory({ compaction }).getCompactionSettings(ctx.model).reserveTokens`, the same Pi resolver
as its compactor. This also sees RQW-context's class-level rule when that extension is present, without importing it.
Model-specific and explicit reserves are respected. With compaction disabled the denominator is the full window.
There are no prototype patches in RQW-statusbar, no other extension folder imports, no RQW-models dependency,
and no model selection, provider, request or context-policy changes.

References in installed Pi: `docs/tui.md` (component width, theme, disposal), `docs/extensions.md`,
`examples/extensions/custom-footer.ts`, `dist/core/extensions/types.d.ts:109-114,211-248`,
`dist/core/extensions/runner.js:613-693`, `dist/core/agent-session.js:3471-3509`,
`dist/modes/interactive/components/footer.js:getSessionStats`, and
`dist/modes/interactive/interactive-mode.js:1958-1975`.

## Toggle

Enabled by default when this package extension is loaded. `/statusbar` toggles;
`/statusbar on` and `/statusbar off` are explicit. Off restores Pi's stock editor and footer and releases background
work.
The choice survives session changes in the same loaded extension, but is intentionally not persisted to disk:
restart or `/reload` starts enabled again. Removing this extension from `pi.extensions` disables it independently.
Other extensions that replace the footer or the editor share Pi's single slots; last setter wins, and an editor
already set by another extension is not replaced.

## Genuine deviations and unavailable elements

- Pi, not omp, owns the context window and compaction policy. For example, with RQW-context and no explicit reserve,
  a capped 1M model has a 500k window and a 450k denominator. Without it stock Pi's reserve applies, not omp's 15%.
- Pi reports `tokens: null` after compaction. Show `?/limit`, not omp's misleading `0% 0k/limit` for that case.
- Pi exposes no native `tokenRate` or tokenizer through this footer API, and neither Anthropic nor Codex returns a
  tokens-per-second field. `RateMeter` shows, for each completed assistant message of the main session,
  `usage.output * 1000 / durationMs`: the provider's exact output token count (it already includes reasoning tokens,
  so `usage.reasoning` is not added again) over `AssistantMessage.durationMs`, which Pi measures with a monotonic
  clock from the start of the request (pi-ai `AssistantMessageEventStream`). A message with a missing or
  non-positive `output` or `durationMs`, or with `durationMs` under 500 ms, or whose `stopReason` is `aborted` or `error`, is skipped (an interrupted
  response can carry an incomplete output count); there is no character-based
  estimate and no live value while a message streams. The last qualified value is held until the next qualified
  one, nothing is shown before the first, and it resets on session start, tree change and toggle. It does not
  reconstruct a rate from persisted history. This is explicitly **not omp's smoothed rate algorithm**.
- Stock Pi has no matching Plan/Goal/Prewalk/Vibe/Loop state, collaboration, live stream/recording, running-agent/job
  counters or PR metadata in this API. Their conditional omp badges are not fabricated. No `gh` call, network lookup,
  cross-extension private import or new subsystem is added to synthesize them. Pi extension statuses occupy the
  corresponding status slot, sorted by key as in stock Pi. PR `#N` and file hyperlinks are not implemented.
- omp's title/UUID/Worked row, current action, blocker and to-do panel live **above** its editor in `showTitle`,
  not in its bottom status bar. They are not copied; the session ID in the top border is the owner's own request
  (DECISIONS.md, Status bar). Apart from its borders, the Pi editor stays stock;
loading rows and other widgets stay unchanged.
- Theme colors and compaction color animation are intentionally not copied. Nerd icons require the same kind of
  Nerd Font as the owner's `symbolPreset: nerd` setup.

## Proof

`extensions/RQW-statusbar/test/render.snap.json` is the fixed plain-text rendering at widths 80, 48, 24, 8, 1 and 0.
`render.test.ts` compares it deterministically and checks every width 0..160, wide/combining Unicode, ANSI metadata,
no-model/unknown context, overflow, thinking labels, Windows and UNC paths, porcelain records and the rate rules above.
It also checks the editor border at every width 0..160 with and without hidden lines: exact width, the hint first,
then the context row. `editor.test.ts` renders the real `ContextEditor` above the two footer rows and compares
`editor.snap.json` (widths 80, 48, 24, with and without hidden lines below or above, idle and with a working
status); without a source it draws Pi's stock borders. It also checks every width 1..160 idle, working, with a
70-character status, with hidden lines above and with both: the top border is exactly the width, and it is
either Pi's own border at the reduced width followed by ` <id> ──` or, below the computed threshold, Pi's border
unchanged. `render.test.ts` checks the ID rule on its own (styling, terminal controls, an ID with spaces, a status
that would change at the reduced width).
`fast-gpt.test.ts` checks the GPT Fast lightning: its place after the model name and before the thinking level, the
static idle yellow, the shimmer frames while working, one cell width at every width 0..120, and in a real session the
rule (fast on and an `openai-codex` model), the change event, the timer and a footer installed mid-run
([DECISIONS.md, Status bar](../DECISIONS.md#status-bar)).
`statusbar.test.ts` loads the extension in real Pi library and CLI-bundle sessions without sending any prompt,
checks live state changes, compaction count, thresholds, status ordering, toggle and non-TUI guards. With the
editor installed the footer has two rows and the editor's last row is the context row, including the hidden-lines
hint; the top border ends with the live session ID, follows a new session ID and drops it at 41 columns;
off restores Pi's editor; a foreign editor is kept across on/off, has no ID and moves the row back into the footer. It also tests
real temporary git repositories/worktrees, missing git and malformed metadata. A real Pi `FooterDataProvider`
regression starts outside git, runs `git init -b new-branch` in the same cwd, switches branch, replaces and removes
the repository, and checks tool/agent refresh, polling and shutdown cleanup without changing Pi's stale cache. `rate-toggle.test.ts` runs real SDK streams through the loaded extension: 44 tokens in 1 ms gives no value, a
499 ms response is skipped, exactly 500 ms qualifies, an aborted or errored response keeps the previous value, a missing `durationMs` is skipped, the value is held between
turns and reset by tree change, session start and toggle. These tests join existing `npm test`
and the existing macOS/Linux/Windows CI matrix without adding a new dependency.

Real PTY smoke: `python3 extensions/RQW-statusbar/test/tui-smoke.py [node]` runs the actual CLI in an isolated agent
directory with no credentials, a local `models.json` model (200k window, never called) and `PI_OFFLINE=1`, and sends
only slash commands and editor keys. A small terminal emulator in the script replays the output. It checks that
the bar row (`0% 0k/183.6k`) is the editor's bottom border directly above the two footer rows, that off shows Pi's
stock editor borders and footer without the bar, that on restores the layout, that 15 input lines with the cursor
on the first show `↓ 6 more` followed by the bar, that the top border ends with one stable UUIDv7 session ID,
then resizes 80 -> 24, where the top border is a plain rule without the ID, and exits cleanly. This is not a live model
run. An absent model is rendered as `no-model` in deterministic tests.

### Sample renders

Exact plain snapshots from `editor.snap.json`: Pi's editor (top border, input, the bar as bottom border), then the
footer. Nerd Font glyph display depends on the reader's font.

Width 80:

```text
──────────────────────────────────────── 019a1b2c-3d4e-7f80-9a1b-2c3d4e5f6a7b ──
hello
━━──────────────────────────────────────────────────────────────── 3% 13.1k/450k
  Sonnet 5.5 hi                                             cmp 2 · 52.4 tok/s
  my-pi/statusbar                                       rqw-statusbar *1 +2 ?3
```

Width 80, working:

```text
── ⠋ Working... ──────────────────────── 019a1b2c-3d4e-7f80-9a1b-2c3d4e5f6a7b ──
hello
━━──────────────────────────────────────────────────────────────── 3% 13.1k/450k
  Sonnet 5.5 hi                                             cmp 2 · 52.4 tok/s
  my-pi/statusbar                                       rqw-statusbar *1 +2 ?3
```

Width 24 (no room for the ID):

```text
────────────────────────
hello
────────── 3% 13.1k/450k
  … cmp 2 · 52.4 tok/s
 rqw-statusbar *1 +2 ?3
```

Width 80, 20 input lines, cursor on the first (8 hidden below):

```text
──────────────────────────────────────── 019a1b2c-3d4e-7f80-9a1b-2c3d4e5f6a7b ──
line 0
line 1
line 2
line 3
line 4
line 5
line 6
line 7
line 8
line 9
line 10
line 11
↓ 8 more ━━─────────────────────────────────────────────────────── 3% 13.1k/450k
  Sonnet 5.5 hi                                             cmp 2 · 52.4 tok/s
  my-pi/statusbar                                       rqw-statusbar *1 +2 ?3
```

### Local results

- macOS, Node 26.7.0: `npm test -- --test-reporter=dot`, 1078 tests, 1070 passed, 0 failed, 8 skipped (all eight are
  Windows-only tests outside this extension).
- The focused statusbar files (`extensions/RQW-statusbar/test/*.test.ts`, `test/statusbar-context.test.ts`,
  `test/statusbar-isolation.test.ts`) pass; the isolation test reruns all of this extension's tests from a copy
  holding only its folder.
- Real CLI PTY smoke passed on Node 26.7.0: bar as the editor's bottom border, session ID in the top border,
  off/on, `↓ 6 more` with the bar, narrow resize without the ID, clean exit.
- No live model request was made. Native Windows runs in the existing GitHub `tests` workflow.
