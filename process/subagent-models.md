## Subagent models

These rules are for developing this repository with agents. They are not product settings: the reviewer
profiles supplied by `RQW-review` keep their own models. The decision,
the owner's messages and the history are in [DECISIONS.md, Work policy](../DECISIONS.md#work-policy).

Main and subagents must not use any Anthropic model, including Haiku, Sonnet and Opus.
The full ban is in force now, without an expiry or a benchmark exception.
The ban concerns model use, not Anthropic transport or subscription quota implementation, auth,
provider visibility or product model settings.

Every new Main-started executor, work, research, test, QA, regression, operational or outside-queue agent uses only
`kimi-coding/k3.1-pro`. Simple and complex work uses low reasoning; hardest work uses high.
The task classes are `simple` for ordinary tasks, `complex` for complex tasks, and `hardest` for the hardest
and most important tasks. The exact machine-readable executor pairs and reviewer-profile exceptions live only in the
[root guard block](../PROCESS.md#coordinator-rules), the source of truth for the dev guard.
Explicit owner model requests override this default. No silent model fallback is allowed.

1. Every new executor `start` or `restart` names `model` and `thinking` explicitly from the chosen class,
   rather than inheriting Main's model or reasoning. There is no assignment rotation or ratio to track.
2. Already running or preserved Sol agents may finish their current tasks through ordinary `send` and `resume`.
   `interrupt` and `resume` retain the existing agent and model. Do not restart them merely to switch models.
   A genuinely new task, new agent or new-session restart follows the Kimi-only rule unless it is a reviewer profile.
3. Independent reviewers keep their approved Sol profile model and effort. They are not executors and have no
   rotation category. Main starts ordinary `agent` subagents; specialized roles use `agent_type` on that same lifecycle.
   Recursive delegation and reviewer behavior stay unchanged; no new restriction on nested non-review helpers is added.
4. Choose the class by the task. Keep `hardest` for the hardest and most important tasks, not easier work.
   The [single execution queue](isolated-parallel-execution.md) stays unchanged.
5. Apart from explicit owner requests and the independent reviewer profiles, use only the executor pairs in the
   root block. The full Anthropic ban remains in force.
6. Dev guard: the project extension `.pi/extensions/coordinator-guard/` reads this block on every call of Main's
   `agent` tool and blocks a start or restart without `model` or `thinking`, with an executor pair outside the block,
   or with Sol outside the named reviewer profile for that `agent_type`, inherited from the child record on restart.
   It also blocks an unreadable block.
   The approved reviewer pairs remain allowed only through their reviewer profiles. The guard checks the allowed
   sets, not task difficulty. It is dev-only: it loads for this trusted checkout, covers only Main's top-level session,
   and is not shipped or listed in `pi.extensions`. Subagents and benchmark harnesses load no extensions, so for them
   these rules are written text only. Details: [guard README](../.pi/extensions/coordinator-guard/README.md).
7. Owner quotes. In `DECISIONS.md`, `PROCESS.md` and `process/*.md` text inside guillemets (the angle quotation marks) is only the
   owner's own words: one contiguous piece of a single owner message from a user entry of a session file. Insert no
   ellipsis, cut, paraphrase or merge. The machine check compares after Unicode NFC and whitespace normalization, so
   line breaks and list indent are formatting. The span need not be the whole message. Agent text and option texts
   go outside guillemets, and this file shows no literal guillemet examples. Briefs to subagents follow the same rule.
   Carrier: `scripts/deliver-check.mjs` checks only quote spans touching added lines of `DECISIONS.md` and
   `PROCESS.md` and `process/*.md` against the owner sessions of this repository. `MY_PI_SESSIONS` overrides them with directories
   joined by the path delimiter; no session files found fails closed.
