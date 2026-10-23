# coordinator-guard

A dev-only Pi project extension of this repository. It enforces mechanically the coordinator rules of
`PROCESS.md` for Main, the top-level session that runs in this checkout. It is not part of the package:
`package.json` `pi.extensions` does not list it, so an installed copy of my-pi never loads it.

## When it runs

- Pi loads `.pi/extensions/*` only from the working folder of a trusted project. Start Pi with this checkout
  (or a worktree) as cwd and accept project trust once (`/trust` saves it). Without trust, with
  `--no-extensions`, or with another cwd, the guard is off. Then the footer status `coordinator-guard on` is
  missing, when the UI shows extension statuses.
- A new or changed guard file takes effect after a Pi restart or `/reload`; a code change of this extension needs `/reload`. A change of the rules block takes effect
  on the next event without a reload: the guard reads `PROCESS.md` fresh every time.
- The guard's root is the checkout that holds this file (three folders up), not the cwd. It reads that
  checkout's `PROCESS.md`.
- RQW-agent children, RQW-review reviewers and the benchmark harnesses build their sessions with
  `noExtensions: true`, so they never load the guard. Only Main is guarded.

## Source of rules

The fenced block `json coordinator-rules` in `PROCESS.md`, section "Worker models": `workerModels` (classes of
exact `[model, thinking]` pairs) and `fixedWorkers` (`"block"` or `"allow"`). A missing block, several blocks,
bad JSON or a bad schema is an error state: the guard then blocks every `agent` start and restart and every
`code_writer` / `shell_runner` call, and shows the error in Main's prompt and status.

## Temporary Opus restriction

The optional key `temporaryOpusRestriction` of the rules block, `{"until": "2026-10-28T16:00:00Z", "arbiterTitlePrefix": "Арбитр замера"}`,
bans `anthropic/claude-opus-5-5` for every `agent` start and restart while the clock is before `until`:

- `until` is a UTC time with seconds and a `Z`. The ban ends at that exact instant: at `until` and later the
  normal table applies again. The clock is read on every call, so expiry needs no reload and no edit of `PROCESS.md`.
- Exception: a start or restart whose `title` begins with `arbiterTitlePrefix` (case-sensitive, from the first
  character) may use the Opus pair that the table already lists, so the reviewer benchmark arbiter keeps working. The
  exception adds no thinking level and no model; Sonnet and Sol are not affected by the ban.
- While the ban is active, the prompt section and the line appended to every allowed task state the rule, the
  expiry and the exception, and the allowed list in refusals hides Opus. After expiry that text disappears.
- An absent key means no temporary restriction. A key that is present but malformed (not an object, `until` not a
  real UTC time, empty `arbiterTitlePrefix`) is an error state like any other bad block: everything fails closed.

## What it does for Main

- `tool_call` on `agent` `start` and `restart` (a missing `action` counts as `start`): `model` and
  `thinking` are required and must be one exact allowed pair. Every `explore` start or restart is blocked,
  since an explorer runs on Main's own model. An allowed call with a `task` gets one generated line
  appended: ordinary nested `agent` starts need an explicit allowed pair, and the child may use `code_writer`,
  `shell_runner`, `explore` and `review` itself.
- `code_writer` and `shell_runner`: with `"fixedWorkers": "block"` every action is blocked.
- Quotes: on `agent`, `code_writer` and `shell_runner` `start`, `restart` and `send`, every guillemet span in
  `task`, `role` and `system` must be one exact contiguous span of one user message of the current session
  (`ctx.sessionManager.getEntries()`), after Unicode NFC and whitespace normalisation. Unbalanced guillemets and
  empty spans fail. The check is `scripts/owner-quotes.mjs`, shared with `deliver-check`.
- `edit` and `write`: every path (`path`, `edits[].path`, `files[].path`) is resolved like Pi does
  (`@`, `~`, file URLs, cwd) and canonicalised (symlinks, also dangling ones, and `..`). A path inside this
  checkout, the main checkout, any registered git worktree or the sibling `my-pi-worktrees` folder is blocked.
  Other places, such as `../my-pi-evidence` and the OS temporary folder, stay allowed.
- Delegation: the prompt tells Main to object and propose a subagent when the owner asks it to do such work
  personally; only an explicit owner override lets Main do it. The mechanical `edit` and `write` block above is unchanged by this.
- `before_agent_start`: adds the `coordinator_rules` prompt section, generated from the same block on every
  run, so compaction cannot drop it.

Calls made from a `codemode` script go through the same `tool_call` handler.

## Limits

- Nested starts by subagents are not enforced: children load no extensions. They get only the appended line.
- A `restart` without `task` gets no appended line; the guard does not rewrite an earlier task.
- The guard cannot tell simple from complex work; it enforces only the allowed set.
- `bash` and other tools are not restricted, so Main can still change files through a shell command.
- Children inherit Main's prompt, including the `coordinator_rules` section. The section says it binds Main only.
- In the error state Main cannot start subagents to repair `PROCESS.md`; the owner fixes the block.

Tests: `test/coordinator-guard.test.ts` (fake pi and ctx) and `test/coordinator-guard-pi.test.ts` (a real Pi
session with codemode and a faux model).
