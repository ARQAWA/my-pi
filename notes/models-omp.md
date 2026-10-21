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

These files were reread for the P2 fixes. RQW-models keeps the owner's later
six-model list and Alt shortcuts from `DECISIONS.md`, not GPT 5.6, off, the hard-coded
caps, provider restrictions or Anthropic payload rewrites from these sources.

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
  explicit `--model` or `--models`, rather than parsing suffixes again.
- `dist/index.d.ts` and `dist/cli/args.js`, exported `parseArgs`: used only to
  recognize CLI selection/continuation and to reapply `--thinking` after the
  extension selects Opus. Pi's parser, not a second CLI grammar, decides these flags.
- `dist/core/sdk.js`: Pi resolves model-specific and global settings effort and
  clamps it to model capabilities. Explicit model selection keeps that result too.

No live model requests are needed for the snapshot-context or faux CLI regressions.
