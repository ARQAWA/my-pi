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
handshake without importing it. When offered, its fresh definitions are filtered to `read`, `bash`, `grep`, `find`,
plus RQW-tools' `job`: a reviewer call still running after 12 s goes to the background as in any session, the reviewer
waits for or kills it, Esc of the review aborts its jobs and the end of the review (also the end of a subagent that
asked for it) disposes them. The factory call passes `{ label: "review" }`. Otherwise Pi supplies stock tools (no
background). Both offered and stock grep/find drop empty optional arguments before chaining
any existing `prepareArguments`; their execute functions stay unchanged. The caller's cwd is retained, and the
reviewer session runs with the caller's owner settings that shape a session (`reviewerSettings` in `index.ts`):
shell path and prefix, image auto-resize and blocking, retries with provider timeouts, transport with its HTTP idle
and WebSocket connect timeouts, compaction (enabled, reserve, kept tokens, per-model overrides), thinking budgets and
codemode's mode and budget. Background cache warming stays off. The reviewer is a child too: when its caller has Pi's
built-in `codemode` and `tool_search` active, the reviewer gets them as well (Pi's own definitions, on top of the four
tools; a codemode script's bash calls pass the same git guard). With an RQW-tools offer, its codemode is Pi's
definition built from the reviewer's API, passed to the factory as `options.codemode` and returned as a call of the
reviewer's barrier and a job of its registry. No `edit` or `write` is exposed.

## Review in subagents

RQW-agent's general subagents (not its explorers or workers) get a `review` tool of their own, offered over
`pi.events` channel `rqw-review:subagent-review` without any import: RQW-agent emits `{ offer(register) }` for each
such child, and RQW-review answers with a function that registers the tool in that child's own `ExtensionAPI`, with
the main session's bus (RQW-tools offer, running counts), the child's GPT Fast and the child's lifetime signal. There
is no single reviewer for the system: every caller has its own `review#N` numbering, its reviews run in parallel, and
the verdict goes back to the caller that asked, never to main. The brief's user messages are that child's own
messages, which come from its caller. A child session never emits `session_start`/`session_shutdown`, so its running
reviews are offered as a counts source at once and end, without a verdict, when the child is stopped, restarted or
shut down. A child waits for its running reviews before its run ends (Pi's SDK print mode), so its answer reflects
the verdict. Without RQW-review loaded, no child gets the tool. Proof: `test/subagent.test.ts`; decision:
[DECISIONS.md, Agent](../../DECISIONS.md#agent).

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

## GPT Fast

A reviewer inherits the main chat's GPT Fast state when it starts (RQW-settings answers over `pi.events`, query
channel `rqw-settings:fast-gpt-query`) and keeps it for its session: its openai-codex requests then carry
`service_tier: "priority"`. The optional boolean `fast_gpt` of the `review` tool overrides the inherited state for
that reviewer (`false` when the user forbids Fast for subagents; null inherits). Anthropic requests are untouched; without RQW-settings the reviewer stays on the standard
tier. Rule and quotes: [DECISIONS.md, Settings](../../DECISIONS.md#settings). Proof: `test/fast-gpt.test.ts`.

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
