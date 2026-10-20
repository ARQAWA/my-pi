# RQW-context: questions, answered

The rule: W = min(contextWindow, 500000) is the window Pi uses, R = Math.round(W / 10), Pi compacts above W - R.
Both questions below are answered by the owner; the decision and its proof are in `DECISIONS.md`, section Context.

## 1. What else "treated as 500 000" covers — answered: b

Owner: «овераить его, если оно выше 500 тыс. токенов на 500 тыс. токенов», compaction at W - R, R = 10% of W.

Built: for a model above 500 000 the session model gets contextWindow 500 000, so every place Pi reads the window
follows: the compaction trigger before a prompt and before each next turn, threshold and overflow checks after a
response, context usage and the footer percent (90% at the threshold), the output cap of each request
(500 000 - context - 4096, 45 902 in the test at 450 000 context) and the summary limits (40 000 and 25 000).
An answer with more than 500 000 input tokens counts as overflow; with compaction on and a history of several turns
Pi recovers: a completed answer is kept and the session compacts without a retry; a length stop with no output at 99%
of the window compacts and retries once. The known limits below are where it does not.
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
  summarization failed: generation hit the token cap and the summary is incomplete".
- Summaries of prose-heavy chat histories: on a 1M model the compaction at 450 000 fails with "Summarization failed:
  generation hit the token cap and the summary is incomplete", because the summary request is sized by characters
  and its output cap falls to 1. Stock Pi does the same on native 272 000 and 500 000 models.
- A reserve the user set counts against the capped window: Pi's docs example, a 1M model with a per-model reserve of
  400 000, compacts above 100 000 instead of 600 000. A reserve of W or more would leave no threshold; the rule's R
  applies then.

## 2. Virtual models — answered: a

Owner: option a, virtual models are out of scope. A virtual model (`pi.registerVirtualModel`; Pi 1.3.0 ships none) is
never capped and keeps Pi's own compaction settings; Pi takes its limits from the routed physical model
(`agent-session.js:312`, `422`), so under it the window is the routed model's declared one, the reserve is Pi's, and
the behaviour is stock Pi's.

- a) Accept: the rule covers physical models. — chosen
- b) Cover virtual models too: needs a hook at the routed model; a deeper internal patch of `AgentSession`.
