# Model-picker source references

The original research is recorded in `DECISIONS.md`, Models. These are read-only
sources, not runtime dependencies of RQW-models.

## omp reference

Repository: `~/Documents/ChatGPT/my-omp-harness`, checked-out `master` at
`f73cc873353b89632f842c0218b366237f257aec`.

- `extensions/ui/model-arrows.js`, `MODELS` and shortcut handler: Opus, Sonnet,
  GPT 6.1 Sol, GPT 6 Sol, GPT 6 Luna, GPT 5.6 Luna, Haiku, in that order.
  Shift+Up/Down stops at the ends. A model switch lowers unsupported effort to
  the nearest lower supported level, or the lowest.
- `extensions/ui/reasoning-arrows.js`, `ORDER`, `CAPS`, `levelsFor`: Shift+Left/Right
  stops at the ends. It hard-codes Opus high and Sonnet xhigh caps and includes
  off. Its `before_provider_request` handler rewrites Anthropic off payloads.
- `settings/config.yml`, `enabledModels` and `disabledProviders`: the seven model
  entries above, with providers other than Anthropic and openai-codex disabled.

- `settings/models.yml`: the six canonical model overrides change contextWindow
  only, not thinking efforts. All six are explicitly enabled in config.yml; GPT 5.6
  is an additional seventh model, not a substitute for a missing GPT 6 entry.
- `reasoning-arrows.js`, `levelsFor`: intersects ORDER and CAPS with each model's
  `thinking.efforts`. The inherited OMP model definitions in the read-only
  `~/Documents/ChatGPT/oh-my-pi/packages/catalog/src/models.json` contain
  `[low, medium, high, xhigh, max]` for each of the six canonical IDs under
  anthropic/openai-codex. Applying the two caps yields the family lists recorded
  in [DECISIONS.md, Models](../DECISIONS.md#models). No family is missing or needs
  a GPT 5.6 inference. OMP's cached Anthropic definitions in
  `~/.omp/agent/models.db` agree (queried read-only); there is no cached
  openai-codex row, so its evidence is the bundled catalog, not live discovery.

RQW-models keeps the owner's six-model list, Alt shortcuts and custom effort lists
from `DECISIONS.md`, not GPT 5.6, off, provider restrictions or Anthropic payload
rewrites. Its explicit per-family lists are intersected with Pi support at runtime;
there is no runtime import from the harness or its catalog.

## Pi 1.3.0 mechanisms used by the fixes

Paths are relative to the installed `@earendil-works/pi-coding-agent` package.

- `dist/core/extensions/types.d.ts`, `ExtensionContext` and `ExtensionAPI`: public
  event contexts, model selection, thinking selection and effective settings.
- `dist/core/extensions/runner.js`, `createContext`: the `session_start` event
  context has a live `model` getter. RQW-models retains that context on every
  session start, including resume and reload, and reads it when queued actions run.
- `dist/modes/interactive/interactive-mode.js`, `setupExtensionShortcuts`: TUI
  shortcuts receive a plain snapshot and are dispatched without awaiting previous
  handlers. Snapshot-context tests reproduce this distinction.
- `dist/main.js`, `buildSessionOptions`: Pi resolves CLI model patterns and scoped
  thinking suffixes, including the selected saved default within a scope, before
  extensions start. RQW-models leaves that resolved model and effort unchanged for
  explicit `--model` or `--models` of a listed model, rather than parsing suffixes again;
  an unlisted result is replaced at `session_start`.
- `dist/index.d.ts` and `dist/cli/args.js`, exported `parseArgs`: used only to
  recognize CLI selection/continuation and to reapply `--thinking` after the
  extension selects Opus. Pi's parser, not a second CLI grammar, decides these flags.
- `dist/core/sdk.js`: Pi resolves model-specific and global settings effort and
  clamps it to model capabilities. Explicit model selection keeps that result too.
- `dist/modes/interactive/interactive-mode.js`, `showThinkingSelector`: supplies
  `session.getAvailableThinkingLevels()` to `ThinkingSelectorComponent`.
  `dist/core/agent-session.js`, `getAvailableThinkingLevels`: delegates to pi-ai's
  `getSupportedThinkingLevels(model)`. The component in
  `dist/modes/interactive/components/thinking-selector.js` displays those levels
  unchanged (`off` is described as "No reasoning"). This stock picker is not the
  source of RQW-models' custom family lists; Pi support only constrains them.
  Current per-model lists and shortcut direction are in
  [DECISIONS.md, Models](../DECISIONS.md#models).

## Pi 1.3.0 mechanisms behind the listed-models rule

The rule is in [DECISIONS.md, Models](../DECISIONS.md#models). Paths as above.

- `dist/core/model-runtime.js`, `getAvailableSnapshot`: the source of the stock lists.
  Readers: `modes/interactive/components/model-selector.js` `loadModelsFromSnapshot`
  (`/model`, Ctrl+L); `interactive-mode.js` model autocomplete, `findExactModelMatch`
  (`/model provider/id`), `showModelsSelector` (`/scoped-models`), the `/settings`
  default-model choices and `completeProviderAuthentication` (post-login selection);
  `modes/rpc/rpc-mode.js` `set_model`, `get_available_models`; `core/model-registry.js`
  `getAvailable` for extensions.
- `dist/core/agent-session.js`: `scopedModels` getter (read by the picker, autocomplete and
  `/scoped-models`); `cycleModel` intersects the private scope with the snapshot, else uses
  the snapshot, and returns `undefined` with fewer than two, which `interactive-mode.js`
  `cycleModel` reports as "Only one model available". `setModel` checks only auth before it
  mutates the model, appends a `model_change` entry, may persist the default and emits the
  non-cancellable `model_select`; `_bindExtensionCore` routes `pi.setModel` through it,
  but first rejects providers absent from the configured-auth snapshot. Startup selection
  therefore uses the owning session directly; the current rule is in DECISIONS.md, Models.
  `dispose` runs without `session_shutdown` for SDK hosts.
- `dist/core/model-runtime.js`, `runAvailabilityRefresh` and `getAvailable`: a superseded
  whole-runtime pass discards its own result, then returns the shared snapshot even when
  the newer pass is still pending. Provider-scoped `getAvailable(providerId)` returns its
  own credential-aware result, including `filterModels`, without that snapshot race.
- `dist/core/extensions/runner.js`, `createContext`: `ctx.getContextUsage()` calls the
  session's `getContextUsage()` method synchronously; no context property exposes the session.
- `dist/core/model-runtime.js`, `stream`, `streamSimple`, `streamDeferred`, `classify`,
  `generateImages`: each calls `this.prepareRequest(model, options)` first. `core/sdk.js`
  routes agent turns through `modelRuntime.streamSimple`; compaction and branch summaries
  (`core/compaction/compaction.js`, through the agent's stream function) and
  `core/cache-warmer.js` use the session's request model.
- `dist/core/sdk.js` session restore and `core/model-resolver.js` `findInitialModel` run
  before extensions bind, so a restored or default model is checked at `session_start`.

No live model requests are needed for the snapshot-context or faux CLI regressions.
