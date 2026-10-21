# RQW-anthropic integration into current main

## Scope and review boundary

The coordinator's integration brief C:3376, not a direct owner message, selected a merge of main into
`rqw-anthropic`, preservation of existing modules/docs and reporting semantic test changes for independent review.
Underlying owner requests: adapter (C:3133), provider visibility (C:3171) and independent modules (C:3046).
Owner (C:3133): «в нашем репозитории должен быть адаптер для подписок Anthropic».
Owner (C:3171): «Это именно отключить»; «Когда мы заходим в логин, там должны быть только кодекс,
авторизация и авторизация через Anthropic, которую ты сейчас делаешь. И всё».
`C:<line>` uses the raw session reference in `DECISIONS.md`. Offline fixtures and the integration procedure
are engineering choices, not additional owner requirements. The Claude benchmark/tuning pause C:3244 remains.

The integration merges main `231b8ca9884baefaa8fae80ee80c7c40cc4fef31` into
`rqw-anthropic` at `f5320a0212c17dca4cdd6b0449809c7a9fc95be7`.
The independent securityB report `/tmp/review-anthropic-GPT-B.md` is CLEAN for that branch tip.
That verdict predates this integration and is not claimed for the test changes below.
The local integration report records no independent subagent review of these test changes.

Conflicts are limited to `AGENTS.md`, `DECISIONS.md`, and `package.json`.
Both documentation additions are retained. The package retains the eight main extensions in order,
then adds RQW-anthropic as extension 9. INSTALL merges automatically and keeps both migration and
individual-extension filtering instructions. No production extension implementation is changed
beyond the incoming main merge.

## Semantic integration-test changes for independent review

- `test/package.test.ts`: the generic faux provider becomes an authenticated fake `openai-codex`
  native provider. Fake auth resolution and a runtime key are installed before refreshing the
  availability snapshot. The test still inspects real declared tools and descriptions through
  a completed faux turn; the adapter visibility policy is not bypassed. The extension install-id
  directory is temporary, global fetch rejects network, and both globals are restored afterward.
- `test/isolation-run.ts`: the 1M faux model moves from hidden provider `iso` to authenticated fake
  `openai-codex`, preserving its 1M context, read tool call, and final assistant response. The child
  uses a temporary Pi directory, strips inherited API-key/token/secret environment variables and
  rejects network. This also prevents an inherited OpenRouter key from making the independent
  model picker select a real proxy Opus when the adapter is off.
- `test/isolation.test.ts` keeps every check; its faux model has the listed ID `gpt-6.1-sol`, because
  RQW-models refuses requests for unlisted models. All dynamic nine-extension checks remain,
  including exact loaded extension and tool-description comparisons, `read:ok`, successful final
  assistant stop, and reload equivalence of tools, compaction reserve and session window.
  No success predicate is weakened or converted into a skip.
- New `test/anthropic-models.test.ts` covers both source-loading orders of RQW-models and
  RQW-anthropic, plus the full nine-extension package, each with and without fake saved auth.
  It uses real Pi models and auth snapshots but sends no inference/login/refresh request.
  Source loading alone must not hide the unrelated runtime before adapter registration.
  After binding, the actual login-option builder has exactly the provider IDs `anthropic` and
  `openai-codex`. Anthropic has multiple auth methods, so provider IDs are compared as a set,
  as in the existing adapter tests, not as a count of login methods.
  With fake auth the new session selects Opus medium; without auth it retains the initial Codex
  model at medium and offers no authenticated Opus. RQW-models empties the stock snapshot while the
  adapter's filter keeps working underneath. Removing only RQW-models restores the adapter-filtered
  stock snapshot; then removing only the adapter restores stock visibility including OpenRouter,
  removes the overlay, and retains model/reasoning.
  The RQW picker remains registered as `/rqw-models`, its existing name on main; no new command
  alias is introduced. Mock credentials and network rejection are scoped to each temporary case.

## Proof boundary

Offline integration does not prove server acceptance, subscription billing or absence of extra usage.
The local integration report records no real credential-file access, login, refresh or provider requests.
These are historical proof limits, not current branch-delivery or independent-review restrictions.
Native Windows/Linux and the release executable remain outside this local macOS run.

## Local verification results

- Node 26.7.0: `npm test`, including all `test/*.test.ts`: 432 passed, 0 failed,
  1 existing native-Windows-only skip on macOS, 433 total.
- Node 22.19.0: `node --test` over all extension and package test files: the same
  432 passed, 0 failed, 1 existing native-Windows-only skip.
- Bun 1.4.3: Anthropic plus all package test files: 92 passed, 0 failed.
- `npm run test:bun`: passed; the real Bun codemode worker read its scripted write.
- `git diff --check` and staged whitespace checks: passed.
- Production RQW-anthropic is byte-for-byte unchanged from the securityB-reviewed tip.
  RQW-agent, RQW-review, RQW-statusbar, RQW-models and `test/isolation.test.ts` are
  byte-for-byte unchanged from merged main.

### Additional full Bun run and remaining limitation

`bun test` over all 433 tests without file isolation failed 23 tests: the suite relies on
per-file Pi class/global isolation, unlike Bun default shared globals. `bun test --isolate`
restored the context test invariants and finished with 431 passed, 1 skipped, 1 failed.
The remaining failure is `extensions/RQW-statusbar/test/statusbar.test.ts:208`: after setting
`process.env.PATH = ""`, Bun still resolves git and returns counts, while the Node test expects
undefined for missing git. The statusbar source and test are unchanged from main.
The 92-test Anthropic/package Bun run and Bun codemode smoke are green; a fully green
all-extension Bun run is not claimed. This unrelated statusbar/Bun failure is reported
for independent review, not hidden, skipped, or fixed outside integration scope.

The remaining Bun failure was independently reproduced by running only the unchanged statusbar
file on the clean main worktree at `231b8ca9884baefaa8fae80ee80c7c40cc4fef31`:
`bun test --isolate extensions/RQW-statusbar/test/statusbar.test.ts` produced
8 passed and the same 1 failure at line 208. No main files were changed.
