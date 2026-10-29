# my-pi

A Pi package (`@earendil-works/pi-coding-agent` 1.4.0) that carries the omp-lite behaviour into stock Pi step by step.
Stock Pi tools stay as they are. Everything is an extension, one folder per extension under `extensions/`.
Extensions may change or patch Pi in memory under `[D-SCOPE-RUNTIME-PATCH]`: lightweight and efficient on Windows including VDI through PCLI and macOS, with shape checks, stock fallback and checks on every Pi update; no installed-file edits, fork or rebuild.
The repository coordinator and workflow are development-only, not part of the shipped harness; never port them into the product.

Before every task, read [PROCESS.md](PROCESS.md). Restore it after compaction or a handoff.
The owner's personal manifesto is a separate memory document, not the execution procedure.
Coordinator rules bind only the session that holds the repository's `coordinator.lock`; every other session is a normal direct agent.
Use the task, review, delivery, model and testing rules in [PROCESS.md](PROCESS.md).

- [INDEX.md](INDEX.md): short repository navigation.
- `package.json`: the package manifest; extensions are listed under `pi.extensions`.
- `extensions/RQW-blocks/`: independent runtime UI patches for compact chat blocks; Pi files stay unchanged, incompatible shapes fall back to stock. Tests: `test/extensions/RQW-blocks/`.
- `.oxlintrc.json`: calibrated correctness lint. `npm run lint` checks the full source scope; `scripts/check.mjs` runs lint and tests concurrently. Use `--test <paths>` for touched tests; no flag runs the existing full `npm test`.
- `extensions/RQW-settings/`: extension 1, the harness settings. Turns on Pi's built-in `codemode` and `tool_search` by
  default (same rule as `grep` and `find` in RQW-tools), and disables background cache warming regardless of user
  config (prompt caching stays on). Owns GPT Fast for the main chat: `/fast-gpt [on|off]`, default off, only
  `openai-codex` requests get `service_tier` priority (`DECISIONS.md` Settings, «GPT Fast»). Tests: `npm test`.
- `extensions/RQW-prompt/`: extension 2, the system prompt. `SYSTEM.md` is the text; `index.ts` puts it in place of Pi's
  default prompt prefix and appends the workstation, critical, environment and date blocks.
- `extensions/RQW-tools/`: extension 3, the base tools. Stock `read`, `bash`, `edit`, `write`, `grep`, `find` with our descriptions, multi-file edit and write, bounded Windows retry and counts. File tools use stock parallel execution, with an in-memory resolved-path lock serializing edit and write on the same file; different files stay parallel. Bash and codemode run independently. A call still running after 12 s returns `job#N`; `job wait`, `status` and `kill` manage it, with one completion notification. Tests: `npm test`.
- `extensions/RQW-context/`: extension 4, the context window and the compaction threshold. Every model gets the
  physical window W = min(contextWindow, 500000) and compacts strictly above W - R, where R = round(W / 10).
  Explicit settings and physical request scopes remain; Pi 1.4.0 summaries use native output limits, not R.
  Contract: `extensions/RQW-context/README.md`. Tests: `npm test`.
- `extensions/RQW-agent/`: extension 5, subagents; description and reminder follow Cursor's Subagent guidance. `agent`
  (start, wait, status, send, resume, interrupt, stop, restart) runs in-process Pi sessions. Optional `agent_type`
  selects a Codex TOML profile; without it the generic defaults stay. A profile's `developer_instructions` supplies the default role
  after the main system prompt and subagent reminder, not a whole-prompt replacement. The catalogue always has Codex's built-in `default` and `worker` (no `explorer`; a user role of the same name replaces
  them). Project `.codex` layers are gated by Codex trust (administrative Codex config is not supported); six Codex role overrides Pi cannot apply are named
  `not applied` in the catalogue. Profile discovery, precedence,
  supported fields, explicit overrides and saved provenance: [RQW-agent README](extensions/RQW-agent/README.md#codex-profiles).
  The optional `title` appears in status and results. Every child has recursive `agent` delegation without a depth
  limit. Children get codemode/tool_search as the caller has them, the caller's session settings and the same profile
  catalog. With RQW-tools, codemode uses the child's background-job registry.
  Details: [RQW-agent README](extensions/RQW-agent/README.md#prompt-and-title). The tool offers caller-chosen mechanical wait and diagnostic status;
  results arrive once through wait or `[kind#N]` messages. `send` to a running child is steering: it arrives after the child's current tool call, aborting nothing. `send` with `interrupt: true` aborts the child's turn and starts the new task as soon as it has stopped. Children retain history until stop for explicit follow-ups.
  A persisted parent stores child sessions in `<parent.jsonl>.children/`; `resume` explicitly retries an interrupted or failed provider request with no new message, also after a Pi restart; no automatic retry loop is added. `/resume-agents` remains children-only and does not retry failed requests. Where notifications work, a direct `wait` returns `waiting` at once and ends the turn, the result wakes the caller later; see [persistence](extensions/RQW-agent/README.md#persistence-and-resume) and `DECISIONS.md` Agent.
  Agent start/restart supports `system_file`/`role_file` and `include: ["user_messages"]`; task text stays in `task`.
  The tool supports `until: "all"`, `wake_on_alert`, read-only status `depth` and optional `alert_after_ms`
  diagnostics without stopping work; details: [RQW-agent README](extensions/RQW-agent/README.md#wait-status-and-management).
  Every 50 non-final tool-call responses without parent communication trigger an isolated background context-fork
  summary. The parent receives a notification and workflow skill reminder, never a subagent final answer; the child
  keeps working and its chat is unchanged. Contract: `DECISIONS.md` `[D-AGENT-PROGRESS]`.
  Imports nothing from another extension folder: subagents get RQW-tools only when
  RQW-tools is loaded and offers them on `pi.events` channel `rqw-tools:subagent-tools`, otherwise Pi's stock
  tools. Child background cache warming is off; Anthropic prompt caching uses built-in 5m (`DECISIONS.md`, Agent).
  Children inherit the caller's GPT Fast at start; the optional `fast_gpt` parameter of `agent`
  overrides it (`false` when the user forbids Fast for subagents). An explicit `fast_gpt` on
  `send` or `restart` updates the retained value.
  Tests: `npm test`.
- `extensions/RQW-review/`: extension 6, a provider of Codex profiles and native Agent Skills, not a separate runtime.
  `profiles/spotty.toml` defaults to `gpt-6.1-terra` low; `profiles/bossy.toml` defaults to the same model medium. Both embed the same
  reviewer role in `developer_instructions`; the common skill explicitly loads the byte-identical `REVIEWER.md` through
  `role_file`, so personal or project same-name profiles cannot replace the package review contract. `rqw-agent:profiles` offers their paths to RQW-agent; public
  `resources_discover` supplies `skills/reviewer`, `skills/blindreview` and `skills/highreview`. The common blind/high skill
  carries only the review section of the owner's Codex skill, and the wrappers select Spotty or Bossy. Each pass
  starts a fresh ordinary `agent` with `agent_type`, the package `role_file` and `include: ["user_messages"]`; results are `agent#N` results.
  Read-only is an instruction, with no git guard or sandbox. Lifecycle, settings, Fast, caching and delivery are
  RQW-agent's. Without RQW-agent the reviewer cannot run; disabling RQW-review removes its own profiles and skills.
  Contract: `DECISIONS.md` section Review, `extensions/RQW-review/README.md`. Tests: `npm test`.
- `extensions/RQW-statusbar/`: extension 7, an independent TUI footer in the owners omp layout, with the context bar as
  the input editor's bottom border and the session ID at the right end of its top border. Shows the GPT Fast lightning after the model name (main chat, `openai-codex` model, shimmer while working). On by default; `/statusbar [on|off]` toggles it and restores the stock editor and
  footer when off. Its upper input border shows the gold session title at the left and session ID at the right.
  Activity is a separate line above it, with a one-space left gap and blank lines above and below, absent idle.
  Busy letters shimmer silver; compaction shimmers gold over the title.
  Tests: `test/extensions/RQW-statusbar/`.
- `extensions/RQW-models/`: extension 8, independent model picker and shortcuts, Opus medium for a new session.
  Shift+arrows open a model/effort draft chooser and take the first step before rendering: Up/Down stronger/weaker,
  Right/Left effort up/down. Plain or Shift arrows navigate; Enter commits once, Esc closes without setters.
  Two compact wheel columns use supplied theme/thinking roles. Commit uses public Pi APIs, not an atomic request lock;
  scope and limitation: [RQW-models README](extensions/RQW-models/README.md). `/rqw-models` and stock picker restrictions stay.
  Only listed models can be selected or requested; Pi's stock model lists are empty (`DECISIONS.md` Models, owner quotes/carriers).
  Disable separately in `pi config`. Tests: `npm test`.
- `extensions/RQW-anthropic/`: extension 9, Anthropic subscription transport with OAuth recovery, nothing else (no
  provider hiding: that is extension 14). Toggle, migration and limits:
  `extensions/RQW-anthropic/README.md`. Tests: `test/extensions/RQW-anthropic/`.
- `extensions/RQW-scroll/`: extension 10, Escape in the fullscreen view returns a scrolled-up transcript to the latest
  message; elsewhere Escape stays stock. Contract and limits: `DECISIONS.md` section Scroll. Tests: `npm test`.
- `extensions/RQW-session/`: extension 11, independent `/copy-session`, `/remove` (stock-identical: confirm, fresh session, then trash-else-unlink of the JSONL only) and `/cleanup` (deletes `.jsonl.children` trees whose JSONL is gone) commands.
  Cleanup boundaries and limitations: `extensions/RQW-session/README.md`. Tests: `npm test`.
- `extensions/RQW-send-now/`: extension 12, Enter on an empty editor while steering is queued interrupts the turn and
  sends the queue at once, as in oh-my-pi. Public Pi API only, no custom editor. Behavior and limits:
  `extensions/RQW-send-now/README.md`. Tests: `test/extensions/RQW-send-now/send-now.test.ts`.
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
  are mapped automatically, unknown models use `openai-codex/gpt-6.1-sol` with `low`. Owns its web-only subscription
  engine; no RQW-codex/RQW-tools dependency, auth writes, prewarm or compaction. Subagents get
  the optional `rqw-search:subagent-web` offer on `pi.events`. Large normalized results use ordinary OS temporary files
  with an exact continuation. Description teaches batching, evidence, sources and untrusted web text.
  Contract: [RQW-web README](extensions/RQW-web/README.md), [Web search decision](DECISIONS.md#web-search).
  Tests: `test/extensions/RQW-web/`, `test/web-subagents.test.ts`.
- `scripts/submit-timing/`: dev-only submit timing instrument; launch and JSONL path are in its README. Never shipped or offered to subagents.
- `scripts/ci-watch.mjs`, `npm run ci-watch`: the shared repo-local CI watcher. One instance reads all recent workflow
  runs once a minute and writes `<git common dir>/ci-watch/status.json` atomically; agents read that file instead of
  polling `gh`, and restart it with `npm run ci-watch -- --restart` when it is older than 3 minutes. It is awareness,
  not merge evidence.
- `scripts/qa-status.mjs`, `npm run qa-status`: reads the watcher file for the latest `main` runs and the current
  branch's CI; subagents and hosts without the extension use it. Failed runs stay red.
- `.pi/extensions/qa-status/`: dev-only, repo-local Pi extension (not an `RQW-*` extension, not in `pi.extensions`,
  never shipped with the package). Shows a message only for new red items (a new or recurring failure); a branch head without a CI run is information, not red. `/qa` shows it all. Its `qa-status` message has a compact card (`card.ts`); Ctrl+O shows every line with its link.
- `.pi/extensions/post-edit-lint/`: dev-only, repo-local silent Oxlint checks after successful edits and writes. It is not shipped or listed in `pi.extensions`; its inline factory reaches only executors through RQW-agent's generic child-factory offer. Tests: `test/post-edit-lint.test.ts`.
- `.pi/extensions/process-reminder/`: dev-only, main-session request-only process reminder after each user message; reads `PROCESS.md` fresh, not persisted, shipped or offered to children. Deterministic placement preserves the cached prefix unless the file changes. Tests: `test/process-reminder.test.ts`.
- `.pi/agents/test-reviewer.toml`: the read-only test-review profile, used through `agent` with
  `agent_type: "test-reviewer"`.
- `.pi/agents/requirements-test-reviewer.toml` and `.pi/skills/testreview/`: repo-only requirements-based test review
  on Terra medium, without execution or mandatory commit pairs.
- `extensions/RQW-naming/`: extension 16, background native session names after first input and each successful
  compaction, from all available context. One request ranks 1-10 candidates by meaning, best valid name wins.
  The session provider selects `anthropic/claude-haiku-5-5` or
  `openai-codex/gpt-5.6-luna`, both at `low`, without fallback. Owner: «один запрос вместо двух».
  At most four words and 32 Unicode
  code points, overlong names rejected, never truncated; initial attempt plus up to three retries, then a warning
  preserving the old name. `/rename-gen` regenerates; native
  `/name` stays unchanged. RQW-statusbar displays the native name in the top input border, gold and shimmering during compaction.
  Details: [Naming](DECISIONS.md#naming); tests: `test/extensions/RQW-naming/`.
- `extensions/RQW-agent-ui/`: extension 17, compact delivered result cards for `agent`, including reviewer profiles,
  and for delivered `child_wait` results, full originals
  through Ctrl+O. Loaded before tool-ui. With both loaded, a collapsed wait result is tool-ui's (`Waited for N agents`,
  live block `wait <ids>`) and Ctrl+O shows agent-ui's expanded wait cards; with tool-ui off, agent-ui shows its
  collapsed wait cards. No activity-count producer, statusbar indicator or agent list here.
  Tests: `test/extensions/RQW-agent-ui/`; independent package filter and `/reload`.
- `extensions/RQW-tool-ui/`: extension 18, between-answer tool summaries, current call header plus last four output
  rows and status, immediate folding on answer text, Ctrl+O originals. Native thinking spacing and stock image output
  remain. Details: [Compact tool display](DECISIONS.md#compact-tool-display); tests: `test/extensions/RQW-tool-ui/`.
- `extensions/RQW-skill-dollar/`: extension 19, `$skill` autocomplete at whitespace boundaries, all matches selectable
  through a four-row editor window, and Pi-format skill blocks for every mention on submit; an optional filter offer
  on `rqw-skill-dollar:filter` can hide skills. Public APIs for the editor and autocomplete;
  compatible with stock and statusbar editors. Also, through a runtime patch of Pi internals, shows the skills of a user message as one line in its card, not a blue block (`[D-UI-SKILL-CARD]`). Tests: `test/extensions/RQW-skill-dollar/`.
- `extensions/RQW-dyslexia/`: adds the owner's exact Communication rule and override after each user message in request context, not in history, the system prompt or subagents. Deterministic placement preserves the cached prefix. Self-contained and independently disableable in `pi config`; no host-file access.
  Tests: `test/extensions/RQW-dyslexia/`.
- `extensions/RQW-live-tail/`: independent light screen. One public `registerMarkdownTransformer` replaces assistant text that is still streaming with «ответ готовится»; the finished answer, user text and thinking stay unchanged. No README; disable it alone in `pi config` (`[D-LIVE-TAIL]`). Tests: `test/extensions/RQW-live-tail/`.
- `extensions/RQW-tabs-link/`: independent chat-to-chat link for visible main Pi tabs on one computer. Three deferred plain-code tools
  `list_chats`, `read_chat`, `send_message_to_chat` (no model call), found through `tool_search` by the key `rqwchat` and one fixed prompt line. You open the tabs;
  a closed chat is reported with an open hint, never opened. Reads stored turns from the open tab, delivers as a follow-up, one turn at a time. Public Pi APIs only; no import from another
  extension folder, switch it off alone in `pi config`; subagents never load it. Contract and limits: [README](extensions/RQW-tabs-link/README.md),
  `DECISIONS.md` `[D-TABS-LINK]`. Tests: `test/extensions/RQW-tabs-link/`.
- `extensions/RQW-codex-compat/`: independent Codex compatibility on public Pi APIs today; no Pi source edit. Full parity is not implemented yet and,
  under `[D-SCOPE-RUNTIME-PATCH]`, no longer waits for a public Pi API. Offers Codex skill roots through `resources_discover`: `$CODEX_HOME/skills` and its `.system`,
  `~/.agents/skills`, `/etc/codex/skills` where the system has it (no other administrative config is read), project `.agents/skills` and, for trusted projects
  (`projects.*.trust_level`), `.codex/skills`, bounded by `project_root_markers`. Applies `skills.config`, `skills.bundled.enabled`, `skills.include_instructions` and
  `skills.max_context_tokens` to the model skill catalog, and filters skills for RQW-skill-dollar on
  `rqw-skill-dollar:filter`. Same-name selection by path and `/skill:` command parity are not implemented yet; under `[D-SCOPE-RUNTIME-PATCH]` they no longer wait for a public Pi API. Replaces `contextFiles` with the global Codex `AGENTS.override.md`/`AGENTS.md`, Pi's
  personal file and project files by Codex rules (fallback names, markers, explicit untrusted skip, shared `project_doc_max_bytes` budget). Contract:
  [README](extensions/RQW-codex-compat/README.md), `DECISIONS.md` `[D-COMPAT-CODEX]`. Tests: `test/extensions/RQW-codex-compat/`.
- `extensions/RQW-theme/theme.json`: native theme resource named `RQW-theme`, registered only in `pi.themes`, not
  an extension. Select once through `/settings` -> Theme; Pi persists the choice across reload and restart.
  Switch back through the same native selector. No activation code or unrelated settings writes.
- Every registered package extension is self-contained and can be switched off alone (no import outside its folder,
  its tests load only it). Isolation checks: `test/isolation.test.ts`.
  `RQW-theme` is data in `pi.themes`, not an extension. `INSTALL.md` shows the switch; `DECISIONS.md` section Isolation carries the decision.
- `INSTALL.md`: the install prompt. Given to an already installed Pi, it installs this package into it.
- `.agents/skills/report/`: repo-local skill and HTML template for dyslexia-friendly reports, plans, research summaries and design documents.
- `WORKFLOW-MANIFEST.md`: the owner's personal working principles and aspirations, written in Russian for him.
- `PROCESS.md`: the short development procedure, including testing and the coordinator guard's JSON block.
- `.pi/agents/code-reviewer.toml`: the read-only bug and code-quality profile, used through `agent_type: "code-reviewer"`.
- `DECISIONS.md`: active accepted decisions with their reason, verbatim owner source and carrier.
- `DECISIONS-ARCHIVE.md`: append-only verbatim superseded and obsolete decisions with replacement and commit
  provenance. Read only when checking history.
- `BACKLOG.md`: the canonical open and owner-deferred work list with source, status and branch; no done or dead tasks.

Try it for one run: `pi -e ~/ai-project/my-pi`. No mentions of other products in the prompt.
