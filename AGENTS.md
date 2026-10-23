# my-pi

A Pi package (`@earendil-works/pi-coding-agent` 1.4.0) that carries the omp-lite behaviour into stock Pi step by step.
Stock Pi tools stay as they are. Everything is an extension, one folder per extension under `extensions/`.

Before every task, read and follow [PROCESS.md](PROCESS.md). Restore it after compaction or a handoff before
continuing. This is mandatory lazy loading, not optional background reading. Give subagents the relevant process
rules in their briefs. The owner's personal manifesto is a separate memory document, not the execution procedure.
The coordinator delegates all execution, waits and checks to subagents and may run up to 10 first-level subagents in parallel when useful (nested ones do not count).

- `package.json`: the package manifest; extensions are listed under `pi.extensions`.
- `extensions/RQW-settings/`: extension 1, the harness settings. Turns on Pi's built-in `codemode` and `tool_search` by
  default (same rule as `grep` and `find` in RQW-tools), and disables background cache warming regardless of user
  config (prompt caching stays on). Owns GPT Fast for the main chat: `/fast-gpt [on|off]`, default off, only
  `openai-codex` requests get `service_tier` priority (`DECISIONS.md` Settings, «GPT Fast»). Details: `notes/settings-codemode.md`, `DECISIONS.md` Settings. Tests: `npm test`.
- `extensions/RQW-prompt/`: extension 2, the system prompt. `SYSTEM.md` is the text; `index.ts` puts it in place of Pi's
  default prompt prefix and appends the workstation, critical, environment and date blocks.
- `extensions/RQW-tools/`: extension 3, the base tools. Stock `read`, `bash`, `edit`, `write`, `grep`, `find` with our
  descriptions (`descriptions/*.md`), multi-file `edit` and `write`, and the ordered barrier (Pi's `codemode` is one call of it).
  An eligible call still running after 12 s returns as a background job `job#N`; `job` waits for or checks it and
  kills process or queued jobs. By approved design, a running file-tool job such as `read`, `grep` or `find` cannot
  be killed: `job kill` reports `cannot_kill`, and it finishes on its own. A bash call with its own timeout of 13 s
  or less stays in the foreground and takes no pre-start snapshot; eligible bash calls take an exact snapshot
  before starting. The approved contract holds only what the command certainly changes and reports changes
  while it ran (`footprint.ts`, process-wide `ledger.ts`; `DECISIONS.md` Tools, «Background jobs»).
  The outside-git walk enforces its whole-walk limit; scans report unreadable paths and git warnings. Footprint
  inference restores cwd after a subshell and holds the repository for `symbolic-ref` and `reflog` writes.
  Deletions are reported since the start, by comparing the exact pre-start and end states.
  Tests: `npm test`.
- `extensions/RQW-context/`: extension 4, the context window and the compaction threshold. Every model gets the
  window W = min(contextWindow, 500000) and compacts above W - R, where R = round(W / 10). Tests: `npm test`.
- `extensions/RQW-agent/`: extension 5, subagents and the fixed `code_writer` / `shell_runner` workers. `agent`
  (start, wait, status, send, interrupt, stop, restart) runs in-process Pi sessions whose default prompt is the main
  agent's system prompt plus a subagent reminder and an optional `role` (`system` overrides the whole prompt), with
  chosen model/thinking and base tools, and an optional `title` in status and result details. A subagent has `agent` itself,
  recursively without a depth limit; `explore` starts a read-only search subagent on the caller's model; workers and
  explorers are leaves. Children get codemode/tool_search as the caller has them (with RQW-tools, codemode as one call of the child's barrier and a background job, sharing main's codemode worker slots), the caller's session settings, and
  `review` when RQW-review offers it (`pi.events` `rqw-review:subagent-review`); workers also get cwd, OS and date.
  Details: [RQW-agent README](extensions/RQW-agent/README.md#prompt-kinds-and-title). All three tools share caller-chosen mechanical wait and diagnostic status;
  results arrive once through wait or `[kind#N]` messages. `send` to a running child is steering: it arrives after the child's current tool call, aborting nothing. `send` with `interrupt: true` aborts the child's turn and starts the new task as soon as it has stopped. Workers retain history until stop for explicit follow-ups.
  Agent start/restart supports `system_file`/`role_file` and `include: ["user_messages"]`; task text stays in `task`.
  All three tools support `until: "all"`, `wake_on_alert`, read-only status `depth` and optional `alert_after_ms`
  diagnostics without stopping work; details: [RQW-agent README](extensions/RQW-agent/README.md#wait-status-and-management).
  Worker briefs, nesting and delivery:
  [RQW-agent README](extensions/RQW-agent/README.md#workers); decisions: [Workers](DECISIONS.md#workers).
  Imports nothing from another extension folder: subagents get RQW-tools only when
  RQW-tools is loaded and offers them on `pi.events` channel `rqw-tools:subagent-tools`, otherwise Pi's stock
  tools. Child background cache warming is off; Anthropic prompt caching uses built-in 5m (`DECISIONS.md`, Agent).
  Children inherit the caller's GPT Fast at start; the optional `fast_gpt` parameter of `agent`, `code_writer` and
  `shell_runner` overrides it (`false` when the user forbids Fast for subagents). An explicit `fast_gpt` on
  `send` or `restart` updates the retained value.
  Tests: `npm test`.
- `extensions/RQW-review/`: extension 6, the `review` tool with levels `blind` and `high`. Each call runs a fresh
  reviewer session in the same process and main agent's cwd (`createAgentSession`, `read`, `bash`, `grep`, `find`;
  RQW-tools definitions when offered, otherwise Pi's stock tools) with `REVIEWER.md` as its prompt; a bash git-state
  guard blocks mutations, while no file edits or running the delivered result are prompt rules. The verdict comes
  back later as a `[review#N]` message. Main may rebut a finding once with proof; the next reviewer's answer is final (fix, or ask the user), kept by the extension: `DECISIONS.md`
  section Review. The reviewer model follows the main agent's family (Claude or GPT) with the other family as
  fallback: `extensions/RQW-review/README.md`. Background cache warming is off; Anthropic prompt caching uses
  built-in 5m (`DECISIONS.md`, Review). A reviewer inherits the main chat's GPT Fast at its start; the `review` tool's optional `fast_gpt` overrides it.
  RQW-agent's general subagents get their own `review` through the `pi.events` offer `rqw-review:subagent-review`:
  `extensions/RQW-review/README.md#review-in-subagents`. Tests: `npm test`.
- `extensions/RQW-statusbar/`: extension 7, an independent TUI footer in the owners omp layout, with the context bar as
  the input editor's bottom border and the session ID at the right end of its top border. Shows the GPT Fast lightning after the model name (main chat, `openai-codex` model, shimmer while working). On by default; `/statusbar [on|off]` toggles it and restores the stock editor and
  footer when off. Elements, evidence and limits:
  `notes/statusbar-omp.md`. Tests and deterministic renders: `extensions/RQW-statusbar/test/`, included in `npm test`.
- `extensions/RQW-models/`: extension 8, independent model picker and shortcuts, Opus medium for a new session.
  Shift+arrows open a model/effort draft chooser and take the first step before rendering: Up/Down stronger/weaker,
  Right/Left effort up/down. Plain or Shift arrows navigate; Enter commits once, Esc closes without setters.
  Two compact wheel columns use supplied theme/thinking roles. Commit uses public Pi APIs, not an atomic request lock;
  scope and limitation: [RQW-models README](extensions/RQW-models/README.md). `/rqw-models` and stock picker restrictions stay.
  Only listed models can be selected or requested; Pi's stock model lists are empty (`DECISIONS.md` Models, owner quotes/carriers).
  Disable separately in `pi config`. Tests: `extensions/RQW-models/test/`, `test/model-effort-picker.test.ts`, `npm test`.
- `extensions/RQW-anthropic/`: extension 9, Anthropic subscription transport with OAuth recovery, nothing else (no
  provider hiding: that is extension 14). Toggle, migration and limits:
  `extensions/RQW-anthropic/README.md`; research: `notes/anthropic-adapter.md`. Tests use fake credentials: `npm test`.
- `extensions/RQW-scroll/`: extension 10, Escape in the fullscreen view returns a scrolled-up transcript to the latest
  message; elsewhere Escape stays stock. Contract and limits: `DECISIONS.md` section Scroll. Tests: `npm test`.
- `extensions/RQW-session/`: extension 11, independent `/copy-session` and confirmed permanent `/remove` commands.
  Cleanup boundaries and limitations: `extensions/RQW-session/README.md`. Tests: `npm test`.
- `extensions/RQW-send-now/`: extension 12, Enter on an empty editor while steering is queued interrupts the turn and
  sends the queue at once, as in oh-my-pi. Public Pi API only, no custom editor. Behavior and limits:
  `extensions/RQW-send-now/README.md`. Tests drive Pi's real interactive mode: `npm test`.
- `extensions/RQW-mouse/`: extension 13, on Windows Pi's fullscreen view enables mouse reporting again right after the
  terminal has started, so the wheel scrolls the conversation (the PCLI wheel bug) instead of the input history.
  Windows only; inert elsewhere. Cause, limits and proof: `DECISIONS.md` section PCLI. Tests: `npm test`; the ConPTY
  capture of the bundled `pi.exe` is `pcli-vscode/test/mouse.mjs`.
- `extensions/RQW-providers/`: extension 14, provider visibility. Only `anthropic` and `openai-codex` remain visible in
  login, model pickers and `--list-models`, credentials stay. Independent of `RQW-anthropic` (either switches off alone).
  Mechanism and limits: `extensions/RQW-providers/README.md`; decision: `DECISIONS.md` section Providers. Tests: `npm test`.
- `pcli-vscode/`: the one exception to "Everything is an extension": a VS Code extension `arqawa.pcli` (ARQAWA PCLI) that
  runs a bundled Pi 1.4.0 in a VS Code terminal tab on Windows. Not a Pi extension, not in `pi.extensions`. Decisions:
  `DECISIONS.md` section PCLI; publishing: `.agents/skills/publish-pcli/SKILL.md`.
- Quality control loop: scheduled full regression on `main` (`tests.yml` every 2 h, `pcli.yml` daily), failures kept as
  `qa-inbox` issues, a failures-only mail digest, and triage and test-integrity rules. Rules: `PROCESS.md` section
  Quality control loop; decisions: `DECISIONS.md` section Quality control. Parts below.
- `.github/workflows/qa-inbox.yml`: turns failed `main` runs into `qa-inbox` issues with `scripts/qa-inbox.mjs`.
  `.github/workflows/qa-digest.yml`: mails the owner at 09:30 and 21:30 Moscow time, only about failures, with
  `scripts/qa-digest.mjs`. Shared issue format: `scripts/qa-state.mjs`. Tests: `npm test`.
- `scripts/qa-status.mjs`, `npm run qa-status`: one bounded `gh` read of the inbox, latest `main` runs and the
  current branch's CI; workers and hosts without the extension use it. A claimed issue (below) shows as in progress,
  not red, until its claim is stale.
- `scripts/qa-claim.mjs`, `npm run qa-claim -- <N> <branch>`: claims an open inbox issue before triage (label
  `qa:claimed` is the contract, a comment with branch and UTC, a create-only lock ref `refs/qa-claims/<N>`); exit 3
  means already claimed, do not start; never takes a stale claim over. `--release <N>` frees one. Claim format:
  `scripts/qa-state.mjs`; decision `DECISIONS.md` `[D-QA-CLAIM]`. Tests: `npm test`.
- `.pi/extensions/qa-status/`: dev-only, repo-local Pi extension (not an `RQW-*` extension, not in `pi.extensions`,
  never shipped with the package). Shows a message only for new red items (a new or recurring failure); a branch head without a CI run is information, not red. `/qa` shows it all.
- `.agents/reviewers/test-integrity.md`: the read-only reviewer prompt for QA fixes and weakened tests, used through
  `agent` as the whole `system`.
- UI source folders `extensions/RQW-naming/`, `extensions/RQW-theme/`, `extensions/RQW-thinking/` and
  `extensions/RQW-tool-ui/` exist on main but are not registered in the package until UI integration P10.
  There is no `pi.themes` registration and no `extensions/RQW-agent-ui/` on main. Normal package loading does not
  enable these UI sources; remaining integration is tracked in [BACKLOG.md](BACKLOG.md#u12).
- Every registered package extension is self-contained and can be switched off alone (no import outside its folder,
  its tests load only it); `test/isolation.test.ts` proves this for the entries in `pi.extensions`, not unregistered
  source folders. `INSTALL.md` shows the switch; `DECISIONS.md` section Isolation carries the decision.
- `INSTALL.md`: the install prompt. Given to an already installed Pi, it installs this package into it.
- `notes/`: research notes, such as how the omp-lite prompt was built.
- `WORKFLOW-MANIFEST.md`: the owner's personal working principles and aspirations, written in Russian for him.
- `PROCESS.md`: the mandatory development procedure, from research and questions to autonomous squash delivery.
- `scripts/deliver-check.mjs`: the pre-merge gate, `npm run deliver-check -- <branch> <message-file>`; see `PROCESS.md` Delivery.
- `.agents/reviewers/code.md`: the separate read-only bug and code-quality reviewer prompt, used through `agent`.
- `DECISIONS.md`: active accepted decisions with their reason, verbatim owner source and carrier.
- `DECISIONS-ARCHIVE.md`: append-only verbatim superseded and obsolete decisions with replacement and commit
  provenance. Read only when checking history.
- `BACKLOG.md`: the canonical open and owner-deferred work list with source, status and branch; no done or dead tasks.

Try it for one run: `pi -e ~/ai-project/my-pi`. No mentions of other products in the prompt.
