# RQW-review

Native `/skill:blindreview` and `/skill:highreview` run the owner's Codex CLI review cycle through a fresh reviewer
subagent. The `review` tool with levels `blind` and `high` is their specialised transport, not itself a skill. Each call runs a fresh reviewer session in the same process and main agent's cwd (`read`, `bash`,
`grep`, `find`) from zero, never a fork of the chat. `REVIEWER.md` is the whole prompt for both levels. The verdict comes
back later as a `[review#N]` message. Self-contained: no import from another extension folder.
Rules, quotes and reasons: `DECISIONS.md` section Review. Tests: `npm test`.

## Origin and prompt

The base is the owner's Codex CLI plugin `scope-focus` (developer `A. Chukavin` in its `plugin.json`; the source supplies
no licence text): the profiles `smarty` and `bossy` and the skills `subagents`, `blindreview` and `highreview`.
`REVIEWER.md` is the `developer_instructions` of `smarty.toml`, identical in `bossy.toml`, with three changes for this
harness and nothing else:

1. The allowed tools are the `read`, `grep` and `find` tools and read-only `bash` commands, not "read-only inspection
   tools and commands".
2. One sentence names the sections of the brief that the tool assembles: `<user_messages>`, `<agreement>`, `<object>`,
   `<criterion>` and `<rejected_earlier>`.
3. The note that ends a truncated `read` result (`Use offset=N to continue`) is not file content, where Codex says "the
   reader's continuation line".

Codex starts the profile with `fork_turns: "none"`. Here that needs no setting: every call of the tool is a fresh
`createAgentSession` that sees only its brief. The prompt has no rule about running tests. Decisions:
[DECISIONS.md, Review](../../DECISIONS.md#review).

## Which model reviews

One table, `LEVELS` at the top of `index.ts`, independent of the main agent's model:

| level | profile | model |
|---|---|---|
| `blind` | Smarty | `openai-codex/gpt-6.1-sol`, thinking low |
| `high` | Bossy | `openai-codex/gpt-6.1-sol`, thinking medium |

There is no Claude reviewer and no fallback to another provider: a missing model or missing `openai-codex` credentials
fail the review with `no credentials for openai-codex (model openai-codex/gpt-6.1-sol); review requires Codex
credentials, no fallback`. A failed request fails the review with no automatic retry by the extension; Pi's own inherited request retries apply.
The review has no deadline of its own. Only session shutdown, or the end of the subagent that asked for it, aborts a
running review. An abort of the caller's run (Esc or RPC) only interrupts the wait of print and json mode and leaves
the reviewer running; its verdict is then saved without starting a turn. The verdict message's `details` carry the model that actually ran. Measuring a
Claude reviewer is deferred: [BACKLOG.md](../../BACKLOG.md#claude-reviewer).

## Tools and working directory

Each fresh session asks on `pi.events` channel `rqw-tools:subagent-tools` for a factory, using the RQW-agent
handshake without importing it. When offered, its fresh definitions are filtered to `read`, `bash`, `grep`, `find`,
plus RQW-tools' `job`: an eligible reviewer call still running after 12 s goes to the background as in any session;
bash with its own timeout of 13 s or less stays in the foreground without a pre-start snapshot. The reviewer
waits for it or kills it when it is a process job, an abort of the review (session shutdown or the end of the subagent that asked for it) aborts its killable jobs and
the end of the review disposes them. A running file-tool job cannot be killed and finishes on
its own; this is an approved design caveat, not a defect. The factory call passes `{ label: "review" }`.
Otherwise Pi supplies stock tools (no
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

Background jobs use RQW-tools' registry and the same resource and effects contract as other callers. Bounded walks
report scan errors, subshell cwd changes stay scoped, and `symbolic-ref` and `reflog` writes hold the repository.
Deletions are reported since the start, by comparing exact pre-start and end states. Running file-tool jobs finishing
on their own and the short-timeout bash snapshot exclusion described above are approved design caveats.

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

A child resumed on Pi's core agent settles its own runs, so its host may add the optional `ReviewHost.continuation`
(`deliver`, `retain`; the types in `index.ts` carry the contract). Then the review registers none of the native
settlement hooks above: it calls `retain()` before each review starts and its release after the verdict was handed to
`deliver`, or when the review ended without one, and the caller's adapter decides when the verdict wakes the child.
The caller's session, not RQW-review, persists the delivered message as a `custom_message` entry; later review numbers
read it. A host without `continuation` behaves exactly as described above. Proof: `test/continuation.test.ts`.

## Native skills and cycle

Use `/skill:highreview` for Bossy or `/skill:blindreview` for Smarty. Both entry skills load the canonical
[review cycle](skills/review-cycle.md), which owns the complete brief, waiting, admission, batch-fix and fresh-pass
workflow. Repository development gates remain in [PROCESS.md, Independent review](../../PROCESS.md#independent-review).

The original Codex skills launch a pinned profile with generic `spawn_agent` and `fork_turns: "none"`. Here the
skills call the existing specialised `review` transport: `runReviewer` creates the actual fresh reviewer child with
`createAgentSession`. There is no RQW-agent dependency, cross-extension import or second runner.

`index.ts` publishes the absolute `skills/highreview` and `skills/blindreview` directories through public
`resources_discover` `skillPaths` only when RQW-review is loaded. They are not registered in package `pi.skills`, so
switching off the extension removes its native skill entries too. `LEVELS` still owns the fixed profiles and
`REVIEWER.md` is unchanged.

`DESCRIPTION` and `startedText` describe the transport and instruct the caller not to declare completion while a
requested review is pending. `NEXT` supplies concise verdict status and the canonical cycle's absolute path, not
a duplicated workflow. Pending completion is an instruction, not a mechanical barrier; owner messages and
interrupts remain allowed and terminal delivery stays nonblocking. Rule: [D-REVIEW-COMPLETION](../../DECISIONS.md#review).

## GPT Fast

A reviewer inherits the main chat's GPT Fast state when it starts (RQW-settings answers over `pi.events`, query
channel `rqw-settings:fast-gpt-query`) and keeps it for its session: its openai-codex requests then carry
`service_tier: "priority"`. The optional boolean `fast_gpt` of the `review` tool overrides the inherited state for
that reviewer (`false` when the user forbids Fast for subagents; null inherits). Anthropic requests are untouched; without RQW-settings the reviewer stays on the standard
tier. Rule and quotes: [DECISIONS.md, Settings](../../DECISIONS.md#settings). Proof: `test/fast-gpt.test.ts`.

## Limits

- The bash git guard is a shell-syntax check, not a sandbox: it does not interpret scripts, aliases or computed
  command names. "Do not edit files, perform state-changing actions or spawn agents" is a prompt rule, not runtime
  enforcement.
- The tests check mechanics (malformed verdicts, missing `CHECKED:`, `UNCHECKED:`) and make no detection-quality claim.
- `REVIEWER.md` is the owner's working Codex prompt, ported as described above. No live model quality measurement of this
  port is claimed; the comparison with the original plugin is queued after delivery
  ([BACKLOG.md](../../BACKLOG.md#codex-reviewer-comparison)).
