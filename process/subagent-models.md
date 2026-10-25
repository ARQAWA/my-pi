## Subagent models

These rules are for developing this repository with agents. They are not product settings: the reviewer
profiles supplied by `RQW-review` keep their own models. The decision,
the owner's messages and the history are in [DECISIONS.md, Work policy](../DECISIONS.md#work-policy).

Main must not use any Anthropic model for subagents except exactly `anthropic/claude-haiku-5-5`.
This permanent rule is in force now.
Main starts an ordinary `agent` subagent with an explicit model and reasoning pair from the root block.
The GPT task classes remain `simple` for ordinary tasks, `complex` for complex tasks, and `hardest` for the
hardest and most important tasks. The separate `haiku` class permits every reasoning level supported by the
installed Pi catalogue, without assigning Haiku a relative task strength. The block is the only list of pairs
and the source of truth for the dev guard. To change a rule, edit the block; no other file repeats it.

The machine-readable pairs stay in the [root guard block](../PROCESS.md#coordinator-rules).

This permanent rule replaces the temporary GPT-only override. There is no expiry that permits other Anthropic models.
The supported Haiku levels are verified through the installed Pi 1.4.0 public `ModelRuntime.create` catalogue
and `getSupportedThinkingLevels` from its `@earendil-works/pi-ai` dependency; `minimal` is not supported.

1. Every `start` and `restart` by Main names `model` and `thinking` explicitly from the chosen class. Nothing is
   inherited from Main's own model or reasoning.
2. Main starts ordinary `agent` subagents. Specialized roles, including reviewers, use the same tool with
   `agent_type`; profiles do not add a separate execution lifecycle.
3. Choose the GPT class by the task. Keep `hardest` for the hardest and most important tasks, not easier work.
   Haiku may use any pair in its separate class.
4. Spread subagents evenly between the allowed Anthropic and GPT models so both subscriptions' limits are spent
   evenly. Balance over the run, not per single call.
5. No other models or reasoning levels. A pause of a named benchmark campaign pauses that campaign only; it does
   not pause unrelated work or prohibit the authorized subagent models.
6. Dev guard: the project extension `.pi/extensions/coordinator-guard/` reads this block on every call of Main's
   `agent` tool and blocks a start or restart without `model` or `thinking`, with a pair outside the block;
   it also blocks an unreadable block. It is dev-only: it loads for this trusted checkout,
   covers only Main's top-level session, and is not shipped or listed in `pi.extensions`. Subagents and benchmark
   harnesses load no extensions, so for them these rules are written text only.
   Details: [guard README](../.pi/extensions/coordinator-guard/README.md).
7. Owner quotes. In `DECISIONS.md`, `PROCESS.md` and `process/*.md` text inside guillemets (the angle quotation marks) is only the
   owner's own words: one contiguous piece of a single owner message from a user entry of a session file. Insert no
   ellipsis, cut, paraphrase or merge. The machine check compares after Unicode NFC and whitespace normalization, so
   line breaks and list indent are formatting. The span need not be the whole message. Agent text and option texts
   go outside guillemets, and this file shows no literal guillemet examples. Briefs to subagents follow the same rule.
   Carrier: `scripts/deliver-check.mjs` checks only quote spans touching added lines of `DECISIONS.md` and
   `PROCESS.md` and `process/*.md` against the owner sessions of this repository. `MY_PI_SESSIONS` overrides them with directories
   joined by the path delimiter; no session files found fails closed.
