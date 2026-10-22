# RQW-review

The `review` tool with levels `blind` and `high`. Each call runs a fresh reviewer session in the same process
and main agent's cwd (`read`, `bash`, `grep`, `find`; the same deep `REVIEWER.md` is the whole prompt for both levels).
The verdict comes back later as a `[review#N]` message. Self-contained: no import from another extension folder.
Rules, quotes and reasons: `DECISIONS.md` section Review. Measurements: `notes/reviewer-probes.md`. Tests: `npm test`.

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
start, and the message names both reasons. A failed request or no verdict in 30 minutes fails the review with no
automatic second attempt. This existing hang guard allows deeper reading and tests; replacing hang protection is
separate later work. The verdict message's `details` carry the model that actually ran.

## Tools and working directory

Each fresh session asks on `pi.events` channel `rqw-tools:subagent-tools` for a factory, using the RQW-agent
handshake without importing it. When offered, its fresh definitions are filtered to `read`, `bash`, `grep`, `find`;
otherwise Pi supplies stock tools. Both offered and stock grep/find drop empty optional arguments before chaining
any existing `prepareArguments`; their execute functions stay unchanged. The caller's cwd, shell and image settings
are retained. No `edit` or `write` is exposed.

The prompt sets no tool-count or reading limit: it requires reading whatever is needed to judge each in-scope
requirement and change, including affected callers, tests and docs. Unagreed style or taste, minor inaccuracies
that do not affect the result, and rare hypotheticals are not findings.
For ordinary code the reviewer may run repository tests; it never runs the delivered result itself (including
not running autotests when autotests are the deliverable). Every bash call passes the copied `git-guard.ts`
through a `tool_call` hook; blocked commands return its reason as a tool error. See limits below.

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

- The bash git guard is a shell-syntax check, not a sandbox: it does not interpret scripts, aliases or computed
  command names. No file edits through bash and never running the delivered result are prompt rules, not runtime
  enforcement. Tests themselves may have filesystem side effects.
- `REVIEWER.md` adopts the supplied `REVIEWER-DEEP.md` text. Earlier wording was measured with variant v3h;
  those measurements do not establish the quality of this deep prompt/tool combination. No new live model
  quality measurement is claimed.
- The GPT row (GPT-5.6-Luna medium and high) is the owner's choice and one constant in `LEVELS`, with its model and
  thinking pinned in `review.test.ts`. The Claude `high` slot is being re-measured and may change. GPT-5.6-Luna has
  more false findings than Haiku medium and answers CLEAN on 30-31 of 33 clean cases (`notes/reviewer-probes.md`).
- GPT main applies a reviewer's wrong `DECIDED` nearly always (`notes/reviewer-probes.md`, round 2w); nothing in
  the extension stops Main from changing something the user forbade when a reviewer wrongly says `DECIDED`.
