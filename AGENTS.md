# my-pi

A Pi package (`@earendil-works/pi-coding-agent` 1.4.0) that carries the omp-lite behaviour into stock Pi step by step.
Stock Pi tools stay as they are. Everything is an extension, one folder per extension under `extensions/`.

Before every task, read and follow [PROCESS.md](PROCESS.md). Restore it after compaction or a handoff before
continuing. This is mandatory lazy loading, not optional background reading. Give subagents the relevant process
rules in their briefs. The owner's personal manifesto is a separate memory document, not the execution procedure.
Coordinator personal-work objections and explicit overrides: [PROCESS.md](PROCESS.md#isolated-parallel-execution).
Coordinator rules bind only the session that holds the repository's `coordinator.lock`; every other session is a normal direct agent.
At most three tasks in active execution follow the owner's priority queue; tasks waiting for CI, review, the merge queue or
the owner hold no slot, and a fourth lane for tests only is outside the limit; pause is `agent` `interrupt`, resume of the interrupted request is `agent` `resume` (`send` only carries a new message), with no pause files:
[PROCESS.md](PROCESS.md#task-pipeline).
Golden rule, no avoidable token spending and simplest engineered solutions: [PROCESS.md](PROCESS.md#golden-rule).
Task timebox, at most 2 hours of substantive work, then a pause and a report: [PROCESS.md](PROCESS.md#task-timebox).
Temporary subagent model restriction and expiry: [PROCESS.md](PROCESS.md#subagent-models).
Search ready-made solutions before new features or mechanisms: [PROCESS.md](PROCESS.md#research-and-agreement).
Third-party installs go into the owner's Pi first, then the package: [PROCESS.md](PROCESS.md#third-party-installation-fast-path).

- `package.json`: the package manifest; extensions are listed under `pi.extensions`.
- `extensions/RQW-settings/`: extension 1, the harness settings. Turns on Pi's built-in `codemode` and `tool_search` by
  default (same rule as `grep` and `find` in RQW-tools), and disables background cache warming regardless of user
  config (prompt caching stays on). Owns GPT Fast for the main chat: `/fast-gpt [on|off]`, default off, only
  `openai-codex` requests get `service_tier` priority (`DECISIONS.md` Settings, «GPT Fast»). Details: `notes/settings-codemode.md`, `DECISIONS.md` Settings. Tests: `npm test`.
- `extensions/RQW-prompt/`: extension 2, the system prompt. `SYSTEM.md` is the text; `index.ts` puts it in place of Pi's
  default prompt prefix and appends the workstation, critical, environment and date blocks.
- `extensions/RQW-tools/`: extension 3, the base tools. Stock `read`, `bash`, `edit`, `write`, `grep`, `find` with our
  descriptions (`descriptions/*.md`), multi-file `edit` and `write`, and the ordered barrier (Pi's `codemode` is one call of it).
  `read` answers an identical repeat of an unchanged range with a one-line note unless `force: true`, under strict
  turn and token limits (`unchanged.ts`, `DECISIONS.md` Tools, Unchanged-read note).
  An eligible call still running after 12 s returns as a background job `job#N`; `job` waits for or checks it and
  kills process or queued jobs. A `job wait` returns `waiting` at once and ends the turn; its result comes later as a notification (`blocking: true` holds the call), and a handed-off job survives Esc and new owner messages (`DECISIONS.md` Tools, `D-TOOLS-NOTIFY`). By approved design, a running file-tool job such as `read`, `grep` or `find` cannot
  be killed: `job kill` reports `cannot_kill`, and it finishes on its own. A bash call with its own timeout of 13 s
  or less stays in the foreground and takes no pre-start snapshot; eligible bash calls take an exact snapshot
  before starting. The approved contract holds only what the command certainly changes and reports changes
  while it ran (`footprint.ts`, process-wide `ledger.ts`; `DECISIONS.md` Tools, «Background jobs»).
  The outside-git walk enforces its whole-walk limit; scans report unreadable paths and git warnings. Footprint
  inference restores cwd after a subshell and holds the repository for `symbolic-ref` and `reflog` writes.
  Deletions are reported since the start, by comparing the exact pre-start and end states.
  Own prompt sections also join the optional read-only startup projection without a prompt/provider dependency;
  see `DECISIONS.md` Prompt/tools isolation.
  Tests: `npm test`.
- `extensions/RQW-context/`: extension 4, the context window and the compaction threshold. Every model gets the
  physical window W = min(contextWindow, 500000) and compacts strictly above W - R, where R = round(W / 10).
  Explicit settings and physical request scopes remain; Pi 1.4.0 summaries use native output limits, not R.
  Contract: `extensions/RQW-context/README.md`. Tests: `npm test`.
- `extensions/RQW-agent/`: extension 5, subagents. `agent`
  (start, wait, status, send, resume, interrupt, stop, restart) runs in-process Pi sessions. Optional `agent_type`
  selects a Codex TOML profile; without it the generic defaults stay. A profile's `developer_instructions` supplies the default role
  after the main system prompt and subagent reminder, not a whole-prompt replacement. Profile discovery, precedence,
  supported fields, explicit overrides and saved provenance: [RQW-agent README](extensions/RQW-agent/README.md#codex-profiles).
  The optional `title` appears in status and results. Every child has recursive `agent` delegation without a depth
  limit. Children get codemode/tool_search as the caller has them, the caller's session settings and the same profile
  catalog. With RQW-tools, codemode is one call of the child's barrier and a background job, sharing main's codemode
  execution slots.
  Details: [RQW-agent README](extensions/RQW-agent/README.md#prompt-and-title). The tool offers caller-chosen mechanical wait and diagnostic status;
  results arrive once through wait or `[kind#N]` messages. `send` to a running child is steering: it arrives after the child's current tool call, aborting nothing. `send` with `interrupt: true` aborts the child's turn and starts the new task as soon as it has stopped. Children retain history until stop for explicit follow-ups.
  A persisted parent stores child sessions in `<parent.jsonl>.children/`; `resume` retries the interrupted request with no new message, also after a Pi restart, and `/resume-agents` resumes the children only. Where notifications work, `wait` returns `waiting` at once and ends the turn, the result wakes the caller later (`blocking: true` holds); see [persistence](extensions/RQW-agent/README.md#persistence-and-resume) and `DECISIONS.md` Agent.
  Agent start/restart supports `system_file`/`role_file` and `include: ["user_messages"]`; task text stays in `task`.
  The tool supports `until: "all"`, `wake_on_alert`, read-only status `depth` and optional `alert_after_ms`
  diagnostics without stopping work; details: [RQW-agent README](extensions/RQW-agent/README.md#wait-status-and-management).
  Imports nothing from another extension folder: subagents get RQW-tools only when
  RQW-tools is loaded and offers them on `pi.events` channel `rqw-tools:subagent-tools`, otherwise Pi's stock
  tools. Child background cache warming is off; Anthropic prompt caching uses built-in 5m (`DECISIONS.md`, Agent).
  Children inherit the caller's GPT Fast at start; the optional `fast_gpt` parameter of `agent`
  overrides it (`false` when the user forbids Fast for subagents). An explicit `fast_gpt` on
  `send` or `restart` updates the retained value.
  Tests: `npm test`.
- `extensions/RQW-review/`: extension 6, a provider of Codex profiles and native Agent Skills, not a separate runtime.
  `profiles/spotty.toml` defaults to `gpt-6.1-sol` low; `profiles/bossy.toml` defaults to the same model medium. Both embed the same
  reviewer role in `developer_instructions`. `rqw-agent:profiles` offers their paths to RQW-agent; public
  `resources_discover` supplies `skills/reviewer`, `skills/blindreview` and `skills/highreview`. The common skill
  carries only the review section of the owner's Codex skill, and the wrappers select Spotty or Bossy. Each pass
  starts a fresh ordinary `agent` with `agent_type` and `include: ["user_messages"]`; results are `agent#N` results.
  Read-only is an instruction, with no git guard or sandbox. Lifecycle, settings, Fast, caching and delivery are
  RQW-agent's. Without RQW-agent the reviewer cannot run; disabling RQW-review removes its own profiles and skills.
  Contract: `DECISIONS.md` section Review, `extensions/RQW-review/README.md`. Tests: `npm test`.
- `extensions/RQW-statusbar/`: extension 7, an independent TUI footer in the owners omp layout, with the context bar as
  the input editor's bottom border and the session ID at the right end of its top border. Shows the GPT Fast lightning after the model name (main chat, `openai-codex` model, shimmer while working). On by default; `/statusbar [on|off]` toggles it and restores the stock editor and
  footer when off. Its upper border shows the actual running agent counts, including reviewer agents, from the activity
  producer: ordinary busy letters shimmer silver, compaction shimmers gold, a fully idle rule is continuous.
  Elements, evidence and limits: `notes/statusbar-omp.md`. Tests and deterministic renders: `extensions/RQW-statusbar/test/`, included in `npm test`.
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
- `extensions/RQW-session/`: extension 11, independent `/copy-session` and confirmed permanent `/remove` commands; `/remove` also deletes the exact `<session.jsonl>.children` tree.
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
- `extensions/RQW-codex/`: extension 15, independent Codex subscription protocol overlay for `openai-codex`, pinned Codex CLI 0.163.0; device-only new login, valid grants retained. Native startup and automatic one-shot idle prewarm use `generate:false`, separate from the disabled generic warmer. Compaction is stock Pi summary compaction through the Codex transport (no native `compaction_trigger`, no compaction method replacement); RQW-context still owns W/R. Lifecycle, auth and prompt seams still use private Pi internals (`BACKLOG.md` CODEX-PUBLIC-INTERNALS). Offline capabilities only, no `/models`; hiding is separate. Contract and exceptions: `DECISIONS.md` [Codex](DECISIONS.md#codex-subscription-transport), `extensions/RQW-codex/README.md`.
- `pcli-vscode/`: the one exception to "Everything is an extension": a VS Code extension `arqawa.pcli` (ARQAWA PCLI) that
  runs a bundled Pi 1.4.0 in a VS Code terminal tab on Windows. Not a Pi extension, not in `pi.extensions`. Decisions:
  `DECISIONS.md` section PCLI; publishing: `.agents/skills/publish-pcli/SKILL.md`.
- `extensions/RQW-web/`: independent shipped `web` tool for parallel independent queries or focused public URL reading,
  on macOS and Windows. Takes `queries` OR `urls`, `focus`, `mode` and `response_length`; the caller's model/thinking
  are mapped automatically, unknown models use `openai-codex/gpt-6.1-sol` with `low`. Shares its web-only subscription
  engine with the repo-local CLI; no RQW-codex/RQW-tools dependency, auth writes, prewarm or compaction. Subagents get
  the optional `rqw-web:subagent-web` offer on `pi.events`. Large normalized results use ordinary OS temporary files
  with an exact continuation. Description teaches batching, evidence, sources and untrusted web text.
  Contract: [RQW-web README](extensions/RQW-web/README.md), [Web search decision](DECISIONS.md#web-search-cli).
  Tests: `extensions/RQW-web/test/`, `test/web-cli-*.test.ts`, `test/web-subagents.test.ts`.
- `cli/web/`: compatible repository-local shell entry over RQW-web's core, with explicit `--caller-model` and `--thinking`.
  After repository `npm ci`, use `node /absolute/repo/bin/rqw-web.mjs --help` from any cwd. No npm bin or global command;
  normal agents use the shipped `web` tool. Details: [CLI README](cli/web/README.md).
- Quality control loop: scheduled full regression on `main` (`tests.yml` every 2 h, `pcli.yml` daily), failures kept as
  `qa-inbox` issues, a failures-only mail digest, and triage and test-integrity rules. Rules: `PROCESS.md` section
  Quality control loop; decisions: `DECISIONS.md` section Quality control. Parts below.
- `.github/workflows/qa-inbox.yml`: turns failed `main` runs into `qa-inbox` issues with `scripts/qa-inbox.mjs`.
  `.github/workflows/qa-digest.yml`: mails the owner at 09:30 and 21:30 Moscow time, only about failures, with
  `scripts/qa-digest.mjs`. Shared issue format: `scripts/qa-state.mjs`. Tests: `npm test`.
- `scripts/ci-watch.mjs`, `npm run ci-watch`: the shared repo-local CI watcher. One instance reads all recent workflow
  runs once a minute and writes `<git common dir>/ci-watch/status.json` atomically; agents read that file instead of
  polling `gh`, and restart it with `npm run ci-watch -- --restart` when it is older than 3 minutes.
  `npm run ci-watch -- --refresh-inbox` explicitly refreshes the `qa-inbox` issue snapshot (`inbox.json`) at triage,
  task takeover or after an issue change, not per agent. Never merge evidence ([PROCESS.md](PROCESS.md#task-pipeline), `DECISIONS.md` [Task pipeline](DECISIONS.md#task-pipeline)).
- `scripts/qa-status.mjs`, `npm run qa-status`: reads the watcher file for the inbox snapshot, latest `main` runs and
  the current branch's CI; subagents and hosts without the extension use it. A failed `main` run whose every failure
  signature is an occurrence in a closed inbox issue shows as info (acknowledged), else red (`DECISIONS.md` `[D-QA-ACK]`);
  `--refresh-inbox` computes that with `scripts/qa-inbox-snapshot.mjs`.
- `.pi/extensions/qa-status/`: dev-only, repo-local Pi extension (not an `RQW-*` extension, not in `pi.extensions`,
  never shipped with the package). Shows a message only for new red items (a new or recurring failure); a branch head without a CI run is information, not red. `/qa` shows it all. Its `qa-status` message has a compact card (`card.ts`); Ctrl+O shows every line with its link.
- `.pi/agents/test-reviewer.toml`: the project test-review profile, used through `agent` with
  `agent_type: "test-reviewer"`; trigger and evidence rules: [PROCESS.md](PROCESS.md#quality-control-loop).
- `.agents/roles/test-fixer.md`: the short role of the test-fix lane agents, passed as the `role` of an `agent`, not as
  the whole `system` ([PROCESS.md](PROCESS.md#task-pipeline)).
- `extensions/RQW-thinking/`: extension 16, hides main-transcript thinking text and the hidden-thinking label,
  without changing stored messages or model context. Native blank rows remain. Independent package filter and
  `/reload`; tests: `extensions/RQW-thinking/test/`.
- `extensions/RQW-naming/`: extension 17, background native session names after first input and each successful
  compaction, from all available context. Ten candidates, semantic auto-selection by `anthropic/claude-haiku-5-5`,
  else authenticated `openai-codex/gpt-6-luna`, at the lowest supported reasoning. At most four words and 32 Unicode
  code points, overlong names rejected, never truncated; initial attempt plus up to three retries, then a warning
  preserving the old name. `/rename-gen` regenerates; native
  `/name` stays unchanged. RQW-statusbar displays the native name as a static gold title.
  Details: [Naming and thinking](DECISIONS.md#naming-and-thinking); tests: `extensions/RQW-naming/test/`.
- `extensions/RQW-agent-ui/`: extension 18, compact delivered result cards for `agent`, including reviewer profiles,
  and for delivered `child_wait` results, full originals
  through Ctrl+O. Loaded before tool-ui. With both loaded, a collapsed wait result is tool-ui's (`Waited for N agents`,
  live block `wait <ids>`) and Ctrl+O shows agent-ui's expanded wait cards; with tool-ui off, agent-ui shows its
  collapsed wait cards. No activity-count producer, statusbar indicator or agent list here.
  Tests: `extensions/RQW-agent-ui/test/`; independent package filter and `/reload`.
- `extensions/RQW-tool-ui/`: extension 19, between-answer tool summaries, current call header plus last four output
  rows and status, immediate folding on answer text, Ctrl+O originals. Native thinking spacing and stock image output
  remain. Details: [Compact tool display](DECISIONS.md#compact-tool-display); tests: its `test/` and root
  `test/tool-ui-smoke.test.ts`. Independent package filter and `/reload`.
- `extensions/RQW-theme/theme.json`: native theme resource named `RQW-theme`, registered only in `pi.themes`, not
  an extension. Select once through `/settings` -> Theme; Pi persists the choice across reload and restart.
  Switch back through the same native selector. No activation code or unrelated settings writes.
- Every registered package extension is self-contained and can be switched off alone (no import outside its folder,
  its tests load only it); `test/isolation.test.ts` proves this for the entries in `pi.extensions`
  (`RQW-theme` is data in `pi.themes`, not an extension). `INSTALL.md` shows the switch; `DECISIONS.md` section Isolation carries the decision.
- `INSTALL.md`: the install prompt. Given to an already installed Pi, it installs this package into it.
- `notes/`: research notes, such as how the omp-lite prompt was built.
- `WORKFLOW-MANIFEST.md`: the owner's personal working principles and aspirations, written in Russian for him.
- `PROCESS.md`: the mandatory development procedure, from research and questions to autonomous squash delivery.
- `scripts/deliver-check.mjs`: the pre-merge gate, `npm run deliver-check -- <branch> <message-file>`; see `PROCESS.md` Delivery.
- `.pi/agents/code-reviewer.toml`: the read-only bug and code-quality profile, used through `agent_type: "code-reviewer"`.
- `DECISIONS.md`: active accepted decisions with their reason, verbatim owner source and carrier.
- `DECISIONS-ARCHIVE.md`: append-only verbatim superseded and obsolete decisions with replacement and commit
  provenance. Read only when checking history.
- `BACKLOG.md`: the canonical open and owner-deferred work list with source, status and branch; no done or dead tasks.

Try it for one run: `pi -e ~/ai-project/my-pi`. No mentions of other products in the prompt.
