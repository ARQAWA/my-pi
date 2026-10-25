## Subagent models

These rules are for developing this repository with agents. They are not product settings: the reviewer
profiles supplied by `RQW-review` keep their own models. The decision,
the owner's messages and the history are in [DECISIONS.md, Work policy](../DECISIONS.md#work-policy).

Main and subagents must not use any Anthropic model, including Haiku, Sonnet and Opus.
The full ban is in force now, without an expiry or a benchmark exception.
Main starts an ordinary `agent` subagent with an explicit model and reasoning pair from the root block.
The GPT task classes remain `simple` for ordinary tasks, `complex` for complex tasks, and `hardest` for the
hardest and most important tasks. The block is the only list of pairs and the source of truth for the dev guard.
To change a rule, edit the block; no other file repeats it.

The machine-readable pairs stay in the [root guard block](../PROCESS.md#coordinator-rules).

This rule replaces the Haiku allowance and the Anthropic/GPT balance rule. Earlier owner-ordered Kimi benchmark
work is historical evidence, not permission for new model calls. The ban concerns model use by Main and subagents,
not Anthropic transport or subscription quota implementation, auth, provider visibility or product model settings.

1. Every `start` and `restart` by Main names `model` and `thinking` explicitly from the chosen class. Nothing is
   inherited from Main's own model or reasoning.
2. Main starts ordinary `agent` subagents. Specialized roles, including reviewers, use the same tool with
   `agent_type`; profiles do not add a separate execution lifecycle.
3. Choose the GPT class by the task. Keep `hardest` for the hardest and most important tasks, not easier work.
4. No other models or reasoning levels for subagents. Benchmark history grants no exception to the full ban.
5. Dev guard: the project extension `.pi/extensions/coordinator-guard/` reads this block on every call of Main's
   `agent` tool and blocks a start or restart without `model` or `thinking`, with a pair outside the block;
   it also blocks an unreadable block. It is dev-only: it loads for this trusted checkout,
   covers only Main's top-level session, and is not shipped or listed in `pi.extensions`. Subagents and benchmark
   harnesses load no extensions, so for them these rules are written text only.
   Details: [guard README](../.pi/extensions/coordinator-guard/README.md).
6. Owner quotes. In `DECISIONS.md`, `PROCESS.md` and `process/*.md` text inside guillemets (the angle quotation marks) is only the
   owner's own words: one contiguous piece of a single owner message from a user entry of a session file. Insert no
   ellipsis, cut, paraphrase or merge. The machine check compares after Unicode NFC and whitespace normalization, so
   line breaks and list indent are formatting. The span need not be the whole message. Agent text and option texts
   go outside guillemets, and this file shows no literal guillemet examples. Briefs to subagents follow the same rule.
   Carrier: `scripts/deliver-check.mjs` checks only quote spans touching added lines of `DECISIONS.md` and
   `PROCESS.md` and `process/*.md` against the owner sessions of this repository. `MY_PI_SESSIONS` overrides them with directories
   joined by the path delimiter; no session files found fails closed.
