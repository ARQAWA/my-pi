# RQW-models

Independent model picker and shortcuts. A new session starts on Opus medium. Authenticated models, their
strongest-first order and supported effort lists: [DECISIONS.md, Models](../../DECISIONS.md#models).
Startup choices await provider-scoped authenticated availability, without an extension-imposed deadline or a stale
snapshot on failure. Errors follow Pi's existing extension-error reporting path.
An unlisted current model is replaced by authenticated Opus first, otherwise the strongest authenticated listed
model. This also applies to resumed sessions, reloads, history and explicit unlisted CLI choices; picker order stays unchanged.

The four Kimi Code entries appear first in the owner's order; see `[D-MODELS-KIMI]` in the linked decision.
K2.7 Code Highspeed shows `high` as a visual label only, without selecting or sending a reasoning level.
The other three Kimi models offer `low`, `high`, `max`. The two K3.1 models are registered through Pi's public
provider API, preserving its built-in OAuth. Their cached output limit is `131072`; the official docs do not
independently state a server output ceiling. Source details are recorded in the same decision.
The Kimi catalog registration shares the runtime's existing owner count: disabling or disposing one session
keeps it for the others; the last owner's shutdown or SDK dispose restores the built-in catalog and OAuth.

## Draft chooser

| Key | First draft step when opening |
| --- | --- |
| Shift+Up | stronger model |
| Shift+Down | weaker model |
| Shift+Right | higher effort |
| Shift+Left | lower effort |

The initiating key performs its step **before the first render**. One transition is Shift+arrow, then Enter.
For several transitions, continue with ordinary or Shift arrows: Up/Down move models, Right/Left move effort.
Both axes stop at their ends, without wrapping. A draft model change keeps its effort if supported, otherwise
clamps to the nearest lower allowed effort, or the lowest. Only authenticated listed models are offered.

The compact terminal chooser shows nearby models and efforts around the selected draft, with muted neighbours,
supplied Pi theme roles and thinking-level colors. Narrow terminals show the current draft model and effort on
separate rows instead of squeezing two wheels. OK is confirmed with Enter; Esc closes the chooser.
Opening, navigation and Esc call no model/thinking setters and send no requests. Nothing needs restoring on Esc:
the session was never changed. An already-running turn continues on the live session, not the draft.
Duplicate shortcut presses cannot create stacked dialogs; session replacement, reload and shutdown cancel the draft.

Enter commits once. An unchanged model needs only the thinking setter. A changed model uses public `pi.setModel`
and a synchronous, session-scoped pending-effort `model_select` handler, with fallback and cleanup. No settings
or credentials are written; no request fences, aborts or scheduling changes are added.

**Commit is not atomic.** Pi 1.4.0 applies its model-switch effort before emitting `model_select` and awaiting
listeners. A listener before ours, or concurrent work, can observe/request that intermediate combination.
The pending-effort handler reduces this window; it does not provide a global request lock. An already-prepared
request may retain its previous model/effort snapshot. The guarantee is that draft navigation never changes the
live selection, not that Pi's separate setters form an atomic transaction.

## Scope and checks

`/rqw-models` remains the existing authenticated model-list selector, not the two-column draft chooser. Stock
`/model`, Ctrl+L/Ctrl+P and the existing allowlist restrictions are unchanged; stock model lists remain empty.
Shift+Tab and unrelated editor controls stay stock. The visual chooser is terminal-only; headless modes do not
open it. It adds no setting or dependency and remains independently disableable through `pi config`, then `/reload`.

The terminal sends Shift+arrow as `CSI 1;2A`..`D` (Kitty modified keys also work); no terminal setup is needed.
Tests: `test/extensions/RQW-models/models.test.ts`.

Owner quotes, rationale and accepted visual carriers are recorded once in [DECISIONS.md, Models](../../DECISIONS.md#models).
