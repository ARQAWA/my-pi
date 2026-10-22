# RQW-review

The `review` tool with levels `blind` and `high`. Each call runs a fresh read-only reviewer session in the same
process (stock `read`, `grep`, `find`; `REVIEWER.md` is its whole prompt) and the verdict comes back later as a
`[review#N]` message. Self-contained: no import from another extension folder. Rules, quotes and reasons:
`DECISIONS.md` section Review. Measurements: `notes/reviewer-probes.md`. Tests: `npm test`.

## Which model reviews

The reviewer depends on the family of the main agent's model (`ctx.model`: provider `anthropic` or a `claude*` id is
Claude; provider `openai` or `openai-codex` or a `gpt-*` id is GPT). One table, `LEVELS` at the top of `index.ts`:

| main agent | `blind` | `high` |
|---|---|---|
| Claude | `anthropic/claude-haiku-5-5`, thinking medium | `anthropic/claude-sonnet-5-5`, thinking low |
| GPT | `openai-codex/gpt-5.6-luna`, thinking medium | `openai-codex/gpt-5.6-luna`, thinking high |

The GPT row is the owner's choice (`DECISIONS.md` section Review); `gpt-5.6-luna` stays in the RQW-models list because of it. The Claude `high` slot is being re-measured and may change.

A main model of neither family starts with the Claude row. When the first reviewer has no model or its provider has
no credentials, the other family's reviewer of the same level takes over; the review fails only when neither can
start, and the message names both reasons. A failed request or no verdict in 10 minutes fails the review with no
second attempt. The verdict message's `details` carry the model that actually ran.

## Pair contract in short

- Main may rebut a finding once, with a quote that stands in its source; the next fresh reviewer's answer on it is
  final (`RULING: DECIDED`: Main fixes; `UNDECIDED`: Main asks the user). A finding that rests on a value, rule or
  choice the user never gave goes to the user, not to another choice of Main's own. An unagreed addition that Main
  defends is `DECIDED`: Main removes it without asking.
- The verdict starts at the first line that is exactly `FINDINGS:` when a reviewer wrote prose before it; prose
  before `CLEAN` is still an incomplete check. A findings verdict needs that exact header line and every `FINDING`
  block with REQUIREMENT, MISMATCH, EVIDENCE and REQUIRED OUTCOME filled; anything else is incomplete and settles
  no dispute.
- A rebuttal's source `user` proves a quote only from the user's own messages, not from a compaction or branch
  summary; of two parallel rebuttals of one finding exactly one is accepted.
- Each finding gets an id `<review number>.<position>`; disputes survive reload and resume (custom `review` entries).

## Limits

- The reviewer wording was measured on models with `REVIEWER.md` variant v3h; the adopted text drops its
  "or REQUIREMENT would be `NOT AGREED`" clause and adds one exception sentence (an unagreed addition that Main
  defends as useful is `DECIDED`, Main removes it); that exact text, with the sentence added after the probes, was
  not measured as a whole.
- The GPT row (GPT-5.6-Luna medium and high) is the owner's choice and one constant in `LEVELS`, with its model and
  thinking pinned in `review.test.ts`. The Claude `high` slot is being re-measured and may change. GPT-5.6-Luna has
  more false findings than Haiku medium and answers CLEAN on 30-31 of 33 clean cases (`notes/reviewer-probes.md`).
- GPT main applies a reviewer's wrong `DECIDED` nearly always (`notes/reviewer-probes.md`, round 2w); nothing in
  the extension stops Main from changing something the user forbade when a reviewer wrongly says `DECIDED`.
