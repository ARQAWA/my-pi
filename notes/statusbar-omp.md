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

1. Directly under Pi's editor: a full-width context bar, then the rounded percent and `tokens/threshold`.
   Filled cells are `━`, empty cells `─`; no usage/window means a plain empty rule.
2. Left: nerd model glyph, model display name, thinking abbreviation, then extension statuses joined by ` · `.
   Thinking: `off -> no`, `minimal -> min`, `low -> lo`, `medium -> md`, `high -> hi`, `xhigh -> xh`, `max -> mx`.
   Right: `cmp N`, then ` · ` and nerd throughput glyph plus `R.R tok/s` once measured.
3. Left: nerd folder, scratch or worktree glyph and working place. Right: nerd branch glyph and branch,
   then `*unstaged +staged ?untracked`, omitting zero counts.

Both columns retain their edge. When they overlap, the left column yields first, just like omp's `rowLeftRight`.
Every row is fitted with Pi TUI's ANSI-aware `visibleWidth` and `truncateToWidth`. Width zero is supported.
Metadata cannot inject new terminal rows or terminal control sequences. Paths accept POSIX, Windows drive and UNC
forms; Windows root comparison ignores case, with directory boundaries. Git uses `execFile`, never shell quoting.

## Pi APIs and independence

Pi is pinned at 1.3.0. The implementation uses `ctx.mode === "tui"` and the supported
`ctx.ui.setFooter(factory)` API. `setFooter(undefined)` restores Pi's built-in footer. The factory receives the
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
`/statusbar on` and `/statusbar off` are explicit. Off restores the stock Pi footer and releases background work.
The choice survives session changes in the same loaded extension, but is intentionally not persisted to disk:
restart or `/reload` starts enabled again. Removing this extension from `pi.extensions` disables it independently.
Other extensions that replace the footer share Pi's single footer slot; last setter wins.

## Genuine deviations and unavailable elements

- Pi, not omp, owns the context window and compaction policy. For example, with RQW-context and no explicit reserve,
  a capped 1M model has a 500k window and a 450k denominator. Without it stock Pi's reserve applies, not omp's 15%.
- Pi reports `tokens: null` after compaction. Show `?/limit`, not omp's misleading `0% 0k/limit` for that case.
- Pi exposes no native `tokenRate` or tokenizer through this footer API. `RateMeter` estimates live deltas at four
  characters/token and then uses the provider's output tokens divided by that message's elapsed streaming time.
  It holds the latest measured rate between messages, resets on session/tree changes, and does not reconstruct a
  rate from persisted history. This is explicitly **not omp's smoothed rate algorithm**.
- Stock Pi has no matching Plan/Goal/Prewalk/Vibe/Loop state, collaboration, live stream/recording, running-agent/job
  counters or PR metadata in this API. Their conditional omp badges are not fabricated. No `gh` call, network lookup,
  cross-extension private import or new subsystem is added to synthesize them. Pi extension statuses occupy the
  corresponding status slot, sorted by key as in stock Pi. PR `#N` and file hyperlinks are not implemented.
- omp's title/UUID/Worked row, current action, blocker and to-do panel live **above** its editor in `showTitle`,
  not in its bottom status bar. They are not copied. The Pi editor, loading rows and other widgets stay unchanged.
- Theme colors and compaction color animation are intentionally not copied. Nerd icons require the same kind of
  Nerd Font as the owner's `symbolPreset: nerd` setup.

## Proof

`extensions/RQW-statusbar/test/render.snap.json` is the fixed plain-text rendering at widths 80, 48, 24, 8, 1 and 0.
`render.test.ts` compares it deterministically and checks every width 0..160, wide/combining Unicode, ANSI metadata,
no-model/unknown context, overflow, thinking labels, Windows and UNC paths, porcelain records and rate arithmetic.
`statusbar.test.ts` loads the extension in real Pi library and CLI-bundle sessions without sending any prompt,
checks live state changes, compaction count, thresholds, status ordering, toggle and non-TUI guards. It also tests
real temporary git repositories/worktrees, missing git and malformed metadata. A real Pi `FooterDataProvider`
regression starts outside git, runs `git init -b new-branch` in the same cwd, switches branch, replaces and removes
the repository, and checks tool/agent refresh, polling and shutdown cleanup without changing Pi's stale cache. These tests join existing `npm test`
and the existing macOS/Linux/Windows CI matrix without adding a new dependency.

Real PTY smoke: `python3 extensions/RQW-statusbar/test/tui-smoke.py` runs the actual CLI in an isolated agent
directory with no credentials and sends only slash commands. It observed Pi's no-available-model sentinel `unknown`,
`cmp 0`, restored the stock footer with off, re-enabled the custom footer, resized 80 -> 24 and exited cleanly.
This is not a live model run. An absent model is separately rendered as `no-model` in deterministic tests.

### Sample renders

These are exact plain snapshots; Nerd Font glyph display depends on the reader's font.


Width 80:

```text
━━──────────────────────────────────────────────────────────────── 3% 13.1k/450k
  Sonnet 5.5 hi                                             cmp 2 · 52.4 tok/s
  my-pi/statusbar                                       rqw-statusbar *1 +2 ?3
```


Width 48:

```text
━───────────────────────────────── 3% 13.1k/450k
  Sonnet 5.5 hi             cmp 2 · 52.4 tok/s
  my-pi/statusbar       rqw-statusbar *1 +2 ?3
```


Width 24:

```text
────────── 3% 13.1k/450k
  … cmp 2 · 52.4 tok/s
 rqw-statusbar *1 +2 ?3
```

### Local results

- Node 26.7.0: `npm test -- --test-reporter=dot`, 255 tests, 254 passed, 0 failed, 1 skipped.
- Node 22.19.0: `npm test -- --test-reporter=dot` with Node 22 first on `PATH`,
  255 tests, 254 passed, 0 failed, 1 skipped. The skipped test is the pre-existing native Windows real-path test.
- The real-provider regression fails on the old code: counts appear after init but `new-branch` is absent.
  With the fix, init, checkout, repository replacement/removal and polling cleanup all pass.
  The original review repro now prints `new-branch ?1`, matching `actual branch: new-branch` on both Node versions.
- Real CLI PTY smoke passed on Node 22.19.0 and Node 26.7.0: no available model, off/on, narrow resize, clean exit.
  Startup waits for the footer rather than assuming a fixed startup time; a cached fd binary is copied into the
  temporary agent directory when available to avoid a redundant startup download.
- No Anthropic or other live model request, nested agent, push or merge was used. Native Windows execution was not
  available locally; Windows path cases ran on macOS and the committed tests are included in the existing Windows CI.
