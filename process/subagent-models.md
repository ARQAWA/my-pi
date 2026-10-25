## Subagent models

These rules are for developing this repository with agents. They are not product settings: the reviewer
profiles supplied by `RQW-review` keep their own models. The decision,
the owner's messages and the history are in [DECISIONS.md, Work policy](../DECISIONS.md#work-policy).

Main and subagents must not use any Anthropic model, including Haiku, Sonnet and Opus.
The full ban is in force now, without an expiry or a benchmark exception.
The ban concerns model use, not Anthropic transport or subscription quota implementation, auth,
provider visibility or product model settings.

Main assigns executors in a repeating sequence: two `kimi-coding/k3.1-pro`, then one
`openai-codex/gpt-6.1-sol`. These are successive assignments, not three simultaneous tasks; the
[two-main-task limit](isolated-parallel-execution.md) stays unchanged. Explicit owner model requests override
this default. No silent model fallback is allowed.

The task classes are `simple` for ordinary tasks, `complex` for complex tasks, and `hardest` for the hardest
and most important tasks. Both models use low reasoning for simple and complex work. Hardest work uses
Kimi high or Sol medium. The exact machine-readable pairs live only in the
[root guard block](../PROCESS.md#coordinator-rules), the source of truth for the dev guard.

1. Every new executor `start` or `restart` advances the assignment sequence. Main names `model` and `thinking`
   explicitly from the chosen class, rather than inheriting its own model or reasoning.
2. Main keeps the next sequence position (first Kimi, second Kimi or Sol) and the last counted assignment with its
   agent, task and selected model in the existing operational task-list context. Carry this decision into every
   compaction summary and handoff, and restore it before assigning again. No new runtime counter or state file.
3. `interrupt` and `resume` retain the existing agent and model and consume no new assignment. Do not restart
   running Sol agents merely to rebalance; the new policy applies to future assignments.
4. Independent reviewers keep their approved profile model and effort. They do not consume the executor sequence.
   Main starts ordinary `agent` subagents; specialized roles use `agent_type` on that same lifecycle. Recursive
   delegation and reviewer behavior stay unchanged; no new restriction on nested non-review helpers is added.
5. Choose the class by the task. Keep `hardest` for the hardest and most important tasks, not easier work.
6. Apart from explicit owner requests and the independent reviewer profiles, use only the executor pairs in the
   root block. The full Anthropic ban remains in force.
7. Dev guard: the project extension `.pi/extensions/coordinator-guard/` reads this block on every call of Main's
   `agent` tool and blocks a start or restart without `model` or `thinking`, with a pair outside the block;
   it also blocks an unreadable block. The approved reviewer pairs remain allowed. The guard checks the allowed
   set, not task difficulty or the assignment sequence; Main tracks those operationally. It is dev-only: it loads
   for this trusted checkout, covers only Main's top-level session, and is not shipped or listed in `pi.extensions`.
   Subagents and benchmark harnesses load no extensions, so for them these rules are written text only.
   Details: [guard README](../.pi/extensions/coordinator-guard/README.md).
8. Owner quotes. In `DECISIONS.md`, `PROCESS.md` and `process/*.md` text inside guillemets (the angle quotation marks) is only the
   owner's own words: one contiguous piece of a single owner message from a user entry of a session file. Insert no
   ellipsis, cut, paraphrase or merge. The machine check compares after Unicode NFC and whitespace normalization, so
   line breaks and list indent are formatting. The span need not be the whole message. Agent text and option texts
   go outside guillemets, and this file shows no literal guillemet examples. Briefs to subagents follow the same rule.
   Carrier: `scripts/deliver-check.mjs` checks only quote spans touching added lines of `DECISIONS.md` and
   `PROCESS.md` and `process/*.md` against the owner sessions of this repository. `MY_PI_SESSIONS` overrides them with directories
   joined by the path delimiter; no session files found fails closed.
