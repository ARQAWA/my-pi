# RQW-context: questions, answered

For direct physical models: W = min(contextWindow, 500000) is the window Pi uses, R = Math.round(W / 10),
Pi compacts above W - R.
The coordinator answered both implementation questions as delegated technical choices, reported in C:2138,
not as direct owner approvals. Owner requirements and implementation evidence are in `DECISIONS.md`, section Context.
`C:<line>` uses the raw session reference defined in that document.

## 1. What else "treated as 500 000" covers — coordinator choice: b

Owner rule (C:2015): «если контекстное окно больше 500 тыс. токенов, то пусть оно будет 500 тыс. токенов.
Резерв — 10% от края». The coordinator chose to apply that window everywhere Pi reads it (C:2138),
with compaction at W - R and R = 10% of W.

Built: for a direct physical model above 500 000 the session model gets contextWindow 500 000.
`capModel` preserves the declared original; `wrapAgentState` covers the native Agent state getter, replacement states
and `createLoopConfig`, so direct native requests are capped without first reading the session model.
`wrapModelGetter` also covers session reads. Every place Pi reads that physical window follows: the compaction
trigger before a prompt and before each next turn, threshold and overflow checks after a
response, context usage and the footer percent (90% at the threshold), the output cap of each request
(500 000 - context - 4096, 45 902 in the test at 450 000 context) and the summary limits (40 000 and 25 000).
An answer with more than 500 000 input tokens counts as overflow; with compaction on and a history of several turns
that a summary can fit, Pi recovers: a completed answer is kept and the session compacts without a retry; a length
stop with no output at 99% of the window compacts and retries once. The known limits below are where it does not.
The provider request carries no window; only `max_completion_tokens` differs from stock Pi. Models up to 500 000
keep their object; only the reserve changes. The registry and `/model` list keep the declared windows.

The options as they were asked:

- a) Trigger only, the window stays as declared. The footer shows 45% at compaction on a 1M model; requests unchanged.
- b) Also lower the window to 500 000. The footer shows 90% at compaction and the summary limit is 40 000, but the
  output of a request near 450 000 context is capped at about 45 900 tokens, an input above 500 000 is handled as
  overflow, and Pi has no API for it. — chosen

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

## 2. Virtual models: deferred native routing

The coordinator leaves native virtual-model routing outside this iteration under the owner's lean-scope rule in
`DECISIONS.md`, section Scope. This is not a specific owner quotation approving a virtual-model exception, nor a
previously accepted owner requirement to build a routing hook. The earlier choice reported in assistant message
C:2138 was a delegated technical choice, not owner approval.

Current implementation: `capModel` does not cap `api: pi-virtual`, and `getCompactionSettings` leaves its settings
stock. Pi delegates limits to the routed physical model (`pi.registerVirtualModel`; Pi 1.3.0 ships none). That native
virtual route keeps Pi's declared routed window and reserve; the direct physical-model cap described above does
not add a virtual-routing hook. A deeper routed-window implementation is deferred, not included in this iteration.
