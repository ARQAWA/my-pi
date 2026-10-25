# RQW-statusbar: source evidence and contract

The scope is the owner's **bottom status bar elements and placement**, not the rest of omp's composer,
feed, title, task panel or action rows. omp's theme colors are not reproduced. The bar maps its roles to Pi's
semantic theme colors through `COLORS` and `themePaint` in `extensions/RQW-statusbar/index.ts`.
The GPT Fast lightning is the exception: `fastMark` in `render.ts` uses fixed ANSI colors.

## Current title and activity contract

The gold session title is at the left of the input editor's top border, between rule cells. The session ID
remains at the right. There is no separate title widget above the input. During compaction the gold shimmer
runs over the title. The activity status is a separate line above the border, with one leading space and one
empty line above and below, separating it from Pi's native current-action row and the input border. When idle,
the activity widget returns no rows; only Pi's original spacer remains.

Both silver and gold highlights travel exactly twice as fast as before this change, with no slant. Silver has
three very bright peak cells; gold has six to seven. The falloff to the base colour is wide, soft and monotone
between letters, with gold the smoothest. The redraw timer remains 20 ms; GPT Fast is unchanged.
Only public Pi APIs are used, and the extension remains independent.

Rules and owner sources: [DECISIONS.md, Status bar](../DECISIONS.md#status-bar).
Deterministic tests in `extensions/RQW-statusbar/test/` cover layout, peak widths, monotone falloff and doubled
speed. `native-working-layout.test.ts` mounts real Pi `InteractiveMode` with a held faux-provider response,
checks the unchanged native working row, exact widget gaps, title placement and idle removal, and saves
`/tmp/statusbar-working.txt` and `/tmp/statusbar-compaction.txt`. The latter drives extension compaction events,
not a live compaction request.

`STATUS_FRAME_MS = 80` replaces 160; `SHIMMER_MS = 20` and `FAST_STEP_MS = 120` are unchanged.
In `render.ts`, `SHIMMER_PERIOD_CELLS = 2 * Math.PI / 0.32` and `SHIMMER_CELLS_PER_FRAME = 0.22 / 0.32`.
Silver uses a three-cell plateau, 4.5-cell cubic falloff and `#ffffff` peak; gold uses a 6.5-cell plateau,
six-cell quintic falloff and `#fff4c2` peak. These are spatial profiles, not a higher redraw frequency.

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
   Off the original session branch, the folder is followed after two spaces by the label-coloured mark `⑂ fork #N`
   (the branch glyph and the sibling number, `⑂ fork #2`, `⑂ fork #3`); the mark is dropped whole when it does not fit.
   The whole interface text is English (owner, see `DECISIONS.md` Status bar, «Session branch mark»).

Above the input, `topBorder` draws `── <session-title> ─────── <session-id> ──`, with the hidden-lines hint
centred. The ID comes from `ctx.sessionManager.getSessionId()` on every render and has one plain space on each
side. If the title or hint would be cut, the ID is dropped whole. `/new`, resume, fork and `/reload` reinstall
through `session_start`. With the bar off or another extension's editor in place there is no extension title or ID.

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
`dist/components/editor.js:389-392`) and `renderTopBorder(width, hiddenLineCount)`, which calls our `topBorder`
for the title, hint and session ID. `embedWorkingStatus: false` lets Pi render its unchanged native working row
above the activity widget. There is no native-spinner suppression or `setWorkingIndicator` call. When Pi installs it (`dist/modes/interactive/interactive-mode.js:2243-2307`), Pi
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
- Stock Pi has no matching Plan/Goal/Prewalk/Vibe/Loop state, collaboration, live stream/recording or PR metadata in
  this API. Running background work counts come from RQW-agent and RQW-review offers, not from omp. Their conditional omp badges are not fabricated. No `gh` call, network lookup,
  cross-extension private import or new subsystem is added to synthesize them. Pi extension statuses occupy the
  corresponding status slot, sorted by key as in stock Pi. PR `#N` and file hyperlinks are not implemented.
- omp's title/UUID/Worked row, current action, blocker and to-do panel live **above** its editor in `showTitle`,
  not in its bottom status bar. They are not copied; the session ID in the top border is the owner's own request
  (DECISIONS.md, Status bar). Apart from its borders, the Pi editor stays stock;
loading rows and other widgets stay unchanged.
- Compaction uses `shimmerText` with the gold spatial profile described above, including the title and existing chrome.
- Theme colors and compaction color animation are intentionally not copied. Nerd icons require the same kind of
  Nerd Font as the owner's `symbolPreset: nerd` setup.

## Historical animation cadence and cost

Rule and owner quotes: [DECISIONS.md, Status bar](../DECISIONS.md#status-bar). Timer 20 ms (50 nominal redraws/s),
phase = elapsed monotonic ms / 160 (letters 4.30 columns/s, period 4.57 s; formerly 120 ms ticks, 5.73 columns/s,
3.43 s), lightning one colour step per 120 ms. Sources: Pi 1.4 `pi-tui/dist/tui.js` `MIN_RENDER_INTERVAL_MS = 16`,
`components/loader.js` `DEFAULT_INTERVAL_MS = 80`; omp harness master f73cc873 `extensions/ui/status-bar.ts`
`THINKING_FRAME_MS = 1000 / 30`, glow 60 ms; omp v18.8.9 `packages/tui/src/tui.ts` `#MIN_RENDER_INTERVAL_MS = 1000 / 30`,
`theme/shimmer.ts` `SHIMMER_SPEED_CELLS_PER_S = 30` (time-based); the installed omp 18.12.2 binary embeds the same values.

One short local pass (Apple M2, Node 26.7.0, 3 s per scenario, real `TuiMainScreen`/`TuiAltScreen` with our editor
and footer on a scripted terminal; log `bench-3s.log` in `$TMPDIR/statusbar-animation-evidence/`, script `bench.ts`):
main screen with a 5000-line transcript, process CPU per wall second (1000 ms/s = one core) was 0.1 idle, 71.5 with
the former 120 ms timer plus Pi's hidden 80 ms spinner (19 paints/s), 146.2 at 20 ms plus the spinner (58 paints/s)
and 126.6 at 20 ms alone (48 paints/s, the shipped setup: the hidden spinner gets no frames); about 0.7-0.8 KB is
written per paint. With 200 lines: 27.2, 33.6 and 21.7 ms/s. Each paint re-renders the whole component tree, so the
cost grows with the transcript. The pass is short and noisy; terminal emulator, GPU, battery, SSH/VDI and the visible
frame rate are not measured. Streamed text (log `stream-2s.log`): paints follow chunk arrival up to the 16 ms cap;
with the 20 ms timer a chunk can wait up to about one 16 ms slot (p95 about 15 ms instead of about 2.4 ms).

## Proof

`extensions/RQW-statusbar/test/render.snap.json` is the fixed plain-text rendering at widths 80, 48, 24, 8, 1 and 0.
`render.test.ts` compares it deterministically and checks every width 0..160, wide/combining Unicode, ANSI metadata,
no-model/unknown context, overflow, thinking labels, Windows and UNC paths, porcelain records and the rate rules above.
It also checks the editor border at every width 0..160 with and without hidden lines: exact width, the hint first,
then the context row.

Historical editor-border coverage before the title-layout change: `editor.test.ts` rendered the real `ContextEditor` above the two footer rows and compared
`editor.snap.json` (widths 80, 48, 24, with and without hidden lines below or above, idle and with a working
status); without a source it draws Pi's stock borders. It also checks every width 1..160 idle, working, with a
70-character status, with hidden lines above and with both: the top border is exactly the width, and it is
either Pi's own border at the reduced width followed by ` <id> ──` or, below the computed threshold, Pi's border
unchanged. `render.test.ts` checks the ID rule on its own (styling, terminal controls, an ID with spaces, a status
that would change at the reduced width). Current title-layout coverage is described at the start of this note
and in `test/{chrome,editor,lifecycle,native-working-layout}.test.ts`.

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
and the existing macOS/Windows CI matrix without adding a new dependency.

Historical PTY smoke evidence: `python3 extensions/RQW-statusbar/test/tui-smoke.py [node]` runs the actual CLI in an isolated agent
directory with no credentials, a local `models.json` model (200k window, never called) and `PI_OFFLINE=1`, and sends
only slash commands and editor keys. A small terminal emulator in the script replays the output. It checks that
the bar row (`0% 0k/183.6k`) is the editor's bottom border directly above the two footer rows, that off shows Pi's
stock editor borders and footer without the bar, that on restores the layout, that 15 input lines with the cursor
on the first show `↓ 6 more` followed by the bar, that the top border ends with one stable UUIDv7 session ID,
then resizes 80 -> 24, where the top border is a plain rule without the ID, and exits cleanly. This is not a live model
run. An absent model is rendered as `no-model` in deterministic tests.

### Historical sample renders

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

### Historical local results

- macOS, Node 26.7.0: `npm test -- --test-reporter=dot`, 1078 tests, 1070 passed, 0 failed, 8 skipped (all eight are
  Windows-only tests outside this extension).
- The focused statusbar files (`extensions/RQW-statusbar/test/*.test.ts`, `test/statusbar-context.test.ts`,
  `test/statusbar-isolation.test.ts`) pass; the isolation test reruns all of this extension's tests from a copy
  holding only its folder.
- Real CLI PTY smoke passed on Node 26.7.0: bar as the editor's bottom border, session ID in the top border,
  off/on, `↓ 6 more` with the bar, narrow resize without the ID, clean exit.
- No live model request was made. Native Windows runs in the existing GitHub `tests` workflow.
