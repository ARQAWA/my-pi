# RQW-context: questions, answered

The rule: W = min(contextWindow, 500000) is the window Pi uses, R = Math.round(W / 10), Pi compacts above W - R.
Both questions below are answered by the owner; the decision and its proof are in `DECISIONS.md`, section Context.

## 1. What else "treated as 500 000" covers — answered: b

Owner: «овераить его, если оно выше 500 тыс. токенов на 500 тыс. токенов», compaction at W - R, R = 10% of W.

Built: for a model above 500 000 the session model gets contextWindow 500 000, so every place Pi reads the window
follows: the compaction trigger before a prompt and before each next turn, threshold and overflow checks after a
response, context usage and the footer percent (90% at the threshold), the output cap of each request
(500 000 - context - 4096, 45 902 in the test at 450 000 context) and the summary limits (40 000 and 25 000).
An answer with more than 500 000 input tokens counts as overflow and Pi recovers: a completed answer is kept and the
session compacts without a retry; a length stop with no output at 99% of the window compacts and retries once.
The provider request carries no window; only `max_completion_tokens` differs from stock Pi. Models up to 500 000
keep their object; only the reserve changes. The registry and `/model` list keep the declared windows.

The options as they were asked:

- a) Trigger only, the window stays as declared. The footer shows 45% at compaction on a 1M model; requests unchanged.
- b) Also lower the window to 500 000. The footer shows 90% at compaction and the summary limit is 40 000, but the
  output of a request near 450 000 context is capped at about 45 900 tokens, an input above 500 000 is handled as
  overflow, and Pi has no API for it. — chosen

## 2. Virtual models — answered: a

Owner: option a, virtual models are out of scope. A virtual model (`pi.registerVirtualModel`; Pi 1.3.0 ships none) is
never capped; Pi takes its limits from the routed physical model (`agent-session.js:312`, `422`), so under it the
window is the routed model's declared one and the trigger is not W - R.

- a) Accept: the rule covers physical models. — chosen
- b) Cover virtual models too: needs a hook at the routed model; a deeper internal patch of `AgentSession`.
