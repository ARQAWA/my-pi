# RQW-context: physical limits and native routing

The owner's universal automatic rule is W = min(physical.contextWindow, 500000), R = Math.round(W / 10),
compaction strictly above W - R. C:2015 sets the window and 10% reserve, C:2047 requires universal automatic use.
These are physical limits whether the model is selected directly or chosen by native virtual routing.

## Selection and dispatch

A virtual selection retains its identity, route callback/state/thinking and native declared or unknown window.
An unknown wrapper stays unknown; its 0 is not assigned a cap or a reserve. Its declared window remains a native
hint before a response. It is not the physical limit of all routes. After native canonicalization,
ModelRuntime.getPhysicalModel exposes the stable capped physical copy; the registry keeps declared windows.

Session/request-local context supplies the reserve for the actual pre-request target or checked response.
Automatic preparation uses the triggering physical model. Manual preparation uses the latest successful physical
response after native abort settles. The interception hook sees that preparation. Default native summarization
keeps it intact and routes once from the captured selection. Pi 1.4.0 does not read preparation.settings in
compact, so the extension does not rebind a reserve for summaries. No extra route is made for limits, and cancelled
or custom compaction does not route a default summary. Explicit selection settings and disabled compaction keep
native priority. Parallel sessions sharing one runtime do not share a last-physical-model slot.

The old routed-physical bypass was a bug in applying the existing rule, not a new feature. The virtual exception
was an assistant technical choice in C:2138, not an owner answer. No Owner option a/b attribution applies.

For W=272000 the reserve is 27200 and the threshold 244800; for a physical 1M model W=500000, reserve 50000,
threshold 450000. Since Pi 1.4.0 default summaries carry no R-based output ceiling (before it: floor(0.8 R) and floor(0.5 R)); the
chosen physical model's maxTokens and the native context/output budget bound them. Usage reports the capped physical window.
A completed input above W is overflow under native recovery policy. Providers receive no window field in the
OpenAI-compatible request; the output cap changes. Known recovery limits remain below.


Known limits of the 500 000 window (no code change, the window rule is the owner's; details in `DECISIONS.md`):

- The output cap of a request is `500 000 - context - 4096` with a floor of 1 token. With `compaction.enabled: false`
  a 1M model gets `max_completion_tokens` `[128000, 15902, 1, 1]` at context 0 / 480 000 / 497 000 / 520 000 (stock
  `128000` each); a provider that obeys it answers 1 token with no error. A history that is one oversized turn, such as
  a 700 000-token first paste, gives 1-token requests, and the overflow compaction fails too: "Turn prefix
  summarization failed: generation hit the token cap and the summary is incomplete". When the part a compaction
  summarizes (all but the last `keepRecentTokens`) of a text-heavy history estimates above about 496 000 tokens by
  characters, every request gets a 1-token cap and every compaction fails. A text-heavy history a little above the
  window still recovers, a resumed one too; in review runs the dead end began between 535 000 and 541 728 tokens. A
  tool-heavy history of the same size recovers, because summaries cut tool results to 2 000 characters.
- Summaries of prose-heavy chat histories: on a 1M model the compaction at 450 000 fails with "Summarization failed:
  generation hit the token cap and the summary is incomplete", because the summary request is sized by characters
  and its output cap falls to 1. Stock Pi does the same on native 272 000 and 500 000 models.
- A reserve the user set counts against the capped window: Pi's docs example, a 1M model with a per-model reserve of
  400 000, compacts above 100 000 instead of 600 000. A reserve of W or more would leave no threshold; the rule's R
  applies then.

## Implementation and proof

Implementation: `extensions/RQW-context/index.ts`. Existing Agent state/accessor and WeakMap round-trip fixes remain.
Operation-local physical limits apply even if selection changes while native routing waits. Default summarization
uses Pi's captured selection and native output limits, without summary-reserve bookkeeping. Physical request/check
scopes still supply preparation settings: an explicit reserve below W is retained; a reserve at or above W falls
back to R. Removing summary-reserve rebinding leaves native requests and results unchanged in Pi 1.4.0.
The library and CLI-bundle split/non-split comparison is saved in `/tmp/context-simplify-proof.mjs` and
`/tmp/context-simplify-proof.log`, with fixed sessionId and normalized timestamps.

Tests: `context.test.ts`, `audit.test.ts`, `state.test.ts` and `routing.test.ts` in `test/extensions/RQW-context/`.
Library and actual CLI bundle use synthetic providers and local HTTP. No cloud or interactive-terminal proof is
claimed. Unsupported private SDK boundaries fail at load; implementation updates require restarting Pi.
Last-owner removal restores stock physical lookup identity and settings.
