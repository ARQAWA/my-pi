# coordinator-guard

A dev-only Pi project extension of this repository. It enforces mechanically the coordinator rules of
`PROCESS.md` for Main, the top-level session that runs in this checkout. It is not part of the package:
`package.json` `pi.extensions` does not list it, so an installed copy of my-pi never loads it.

## When it runs

- Pi loads `.pi/extensions/*` only from the working folder of a trusted project. Start Pi with this checkout
  (or a worktree) as cwd and accept project trust once (`/trust` saves it). Without trust, with
  `--no-extensions`, or with another cwd, the guard is off. Then the footer status `coordinator-guard on` is
  missing, when the UI shows extension statuses.
- A new or changed guard file takes effect after a Pi restart or `/reload`. A change of the rules block takes effect
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
