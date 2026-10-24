# Development process

This is the working procedure for agents developing my-pi. Read it before every task and restore it after
compaction or a context handoff. `WORKFLOW-MANIFEST.md` is the owner's personal record of his working principles
and aspirations, not a procedural gate. This file carries the agreed execution rules; `DECISIONS.md` carries
the accepted decisions and their reasons. New owner instructions take precedence over older agreements.

## Research and agreement

1. Main and every agent implement only the owner's requirements and decisions the owner himself accepted.
   Add no protections, fallbacks, edge-case handling, options, settings or mechanisms beyond them. Main cannot
   accept a technical decision that adds behavior on the owner's behalf. Delegated technical choices concern only
   how to implement what was ordered, never what to add. Propose an addition only as a question to the owner and
   only when Main considers it critical; do not raise non-critical proposals until the owner asks.
   While the owner discusses or plans, change nothing. A proposal or question is not permission to implement it.
2. Delegate initial research of the request and relevant source code to subagents, in parallel where useful.
   Main compiles all requirements across the conversation and accepted proposals, retaining the owner's exact words.
   Keep agreed work intact: do not lose, silently drop, reinterpret or invent requirements.
3. Before a new feature or mechanism, search for ready-made solutions in Pi packages, npm, GitHub and other
   agents. Report candidates with their license, maintenance, size and dependency risk, and explain suitability.
   Build our own only with the owner's consent, recorded in `DECISIONS.md`. Keep the no-fork/no-Pi-patch and
   independent-extension boundaries. Small changes, bug fixes and test fixes do not require this search.
4. Bring material ambiguities, conflicts and missing decisions needed to deliver the ordered outcome to the owner
   in one question batch, under rule 1. An unanswered question is not acceptance, including overnight.
5. The owner's answers or approval start the agreed work without another go question. If nothing is open and the
   owner has explicitly requested execution, start. Keep the minimal necessary agreed scope, not a smaller scope.

## Isolated parallel execution

- Start each change task from up-to-date `main` in its own branch and git worktree:
  `git worktree add -b <task> ../my-pi-worktrees/<task> main`. Make all task edits there, never in the main checkout.
- Main is the coordinator, not an independent implementer: it owns requirement compilation, owner questions,
  task decomposition, subagent model selection, scheduling, acceptance and integration of results, review organization,
  delivery/git and reports. Main may read sources and results to coordinate and accept work, but must delegate actual
  research, implementation (including documentation/config edits), probes/measurements, test runs and fixes to
  subagents, regardless of task size, unless the owner explicitly overrides as described below.
  Give each subagent a self-contained brief: agreement, files and worktree, ownership, dependencies, expected result
  and sufficient proof. Include the relevant process rules in its system prompt or brief; do not assume a child
  inherits this file.
- The owner addresses Main (the coordinator) as the executor. If the owner assigns personal execution to Main,
  Main must object, explain its coordinator role and propose a subagent. Main does that work itself only after an
  explicit owner override, for example: «Похуй на инструкции, действуй». A routine request to do something is
  not an override. The guard's mechanical repository edit/write block stays in force, even after an override.
  Only the session that holds the repository's `coordinator.lock` (git common dir) is Main; every other session is a
  normal direct agent and these coordinator rules do not apply to it.
- Main never blocks its own thread on waiting, polling, CI watching, test runs or any other long work. It hands
  all of that to subagents and stays free to coordinate and talk to the owner.
- At most three tasks are in active execution at the same time, in the priority queue set by the owner. Fill a free
  slot from that queue, not from Main's preferred order; a priority change from the owner steers the queue. This is
  a task limit, not a count of first-level subagents. A task that waits for CI, a reviewer, the merge queue or the
  owner holds no slot, and the test lane is outside the limit ([Task pipeline](#task-pipeline)). Parallel subagents inside an active task do not create extra
  task slots. Run useful independent work within those tasks in parallel, avoid concurrent writes to the same files
  and stop superseded subagents. Keep the current queue in the handoff, not as a permanent rule here.
- Main identifies task dependencies itself, links them and blocks dependent work before scheduling. The graph's
  source of truth is the `Blocked by:` lines in `BACKLOG.md` plus the handoff. Main shows the owner the execution
  order as a plain-text dependency tree in terminal output, not a Mermaid diagram. A dependency becomes runnable
  only when its named prerequisites are delivered; this does not authorize a proposal whose design is still open.
  Example format (illustrative task names, not a current queue):

  ```text
  Task A
  `- Task B [blocked by A]
     `- Task C [blocked by B]
  ```

- Main drives the whole agreed task to completion autonomously through subagents: they implement, inspect,
  perform the required checks and fix deviations from the ordered outcome under [Research and agreement](#research-and-agreement).
  Defect or corner-case work is not separate permission to add behavior.
- Commit completed stages promptly to the task branch, staging exact task paths. Stage commits require no review
  or test gate; they do not replace final verification or authorize a merge.
- Work only in my-pi. Other repositories are read-only sources. Keep the user's changes, credentials and settings.
  No forks of Pi. If a fork seems necessary, discuss it before acting. Installing an agreed third-party library
  or Pi extension into the owner's Pi is the specific exception allowing changes to `~/.pi`; preserve auth and
  unrelated settings. Other task work does not gain that permission. Use Node.js for project tooling and Git Bash
  on Windows, not PowerShell or cmd for runtime tooling. Existing CI bootstrap and host setup are separate.
- Temporary task files belong in the OS temporary directory. Do not put transcripts, credentials, archive copies,
  historical cleanup notes or execution ledgers in the repository. History belongs in Git, with one explicit exception:
  root `DECISIONS-ARCHIVE.md` preserves superseded and obsolete decisions verbatim with their provenance.

Repository-local development tooling targets only the owner's macOS laptop: `.pi/extensions/` and local agent
scripts such as `deliver-check` and `owner-quotes` need no Windows or Linux handling. Their tests run only on macOS,
with an explicit skip reason elsewhere. Shipped `RQW-*` extensions and `pcli-vscode` remain cross-platform; scripts
used by GitHub Actions keep supporting their runners. Do not refactor existing development tooling just for this rule.

## Task pipeline

Decisions, the owner's words and reasons: [DECISIONS.md, Task pipeline](DECISIONS.md#task-pipeline).

- A task is active or waiting. Only active execution holds one of the three slots: a subagent implementing,
  researching, fixing or measuring. Waiting for CI, a reviewer, the merge queue or the owner holds no slot. Main
  fills each free slot from the owner's queue and keeps every waiting task in the current session queue and state with what it waits for, in no file.
- When a task's local checks are clean, its branch is pushed and the required reviews start in the background;
  the task becomes waiting. Its agent finishes its turn or is paused, keeps its session and history, and frees the slot;
  Main's coordination is never blocked. The merge agent and CI watcher follow any CI runs in the background.
- One merge agent, an ordinary agent started by Main, owns integration. Main fixes the train order in the current
  session queue, from the owner's queue. The agent takes waiting branches in that order, rebases each onto current
  `main` and pushes it. It merges only when the required reviews are clean and `deliver-check` passes, including
  full local `npm test` on the exact committed branch head on the owner's macOS. When `main` moves, remaining
  branches rebase and pass the gate on their new heads. No green GitHub run is required, including for `pcli-vscode`.
- Windows jobs keep running and are not cancelled in the final run, but they are advisory. A red Windows job is
  not fixed before the merge and does not block delivery. An agent explicitly creates or triages a `qa-inbox` issue for
  it, or a failed scheduled or dispatched `main` run is picked up by `qa-inbox.yml`; nothing here creates issues
  automatically. `ci-watch -- --refresh-inbox` only reads the existing issues into the local snapshot, after the
  issue exists. Every ignored Windows failure is recorded before the delivery closes, as a tail item of `BACKLOG.md` or a
  `main` `qa-inbox` issue linked from it; none is silently deferred or abandoned, so Windows support is finished
  later. If Windows jobs still run when the merge happens, the merge agent keeps that run
  tracked in the background through the watcher cache or a notification, holding no active slot and spending no model
  polling turns. A later Windows failure then gets its tail `BACKLOG.md` item or linked issue and is not lost when
  the branch is deleted. Delivery never waits for Windows or green macOS CI; no workflow result gates a merge.
- Test lane. Besides the three main work lanes, a fourth lane for tests only, outside the three active slots, owns all
  test work: ordinary `agent`s on the simple pairs of the [subagent table](#subagent-models), with
  `.agents/roles/test-fixer.md` as the `role`. It starts only after this pipeline change is delivered and follows all
  pipeline agreements. Decisions: [DECISIONS.md](DECISIONS.md#task-pipeline).
- A failed local delivery test or a conflicting rebase sends the task back to the top of the queue. GitHub CI does
  not gate delivery. At the next free active slot,
  ahead of tasks not yet started, resume its existing agent; start another only if its session no longer exists.
- Pause and resume. Pausing a task is an `agent` `interrupt` of its agent, which keeps the session and history.
  Resuming is the `resume` action of the same agent, which retries the cut-off request with its full history and no new
  message; `send` is only for a new message. Child sessions are saved with the parent, so ids also resume after a Pi
  restart. Write no checkpoint, continuation or handoff file for a pause or resume. `stop` only a finished or cancelled
  task's agent.
- CI watcher. `npm run ci-watch` starts one shared watcher per repository; a second start finds the lock and exits.
  It reads all recent workflow runs once a minute and writes the shared file
  `<git common dir>/ci-watch/status.json` atomically, so every worktree sees it. Agents read that file (with
  `fetchedAt`, head SHA, run id, attempt and conclusion) instead of polling `gh`. A file older than 3 minutes means
  the watcher is dead or backing off: restart it with `npm run ci-watch -- --restart` in the background. Job lists and
  logs are fetched with `gh` only for a failed or finished run that needs them; this is no ordinary polling.
  The watcher is a repo-local macOS development tool, never shipped and never merge evidence. `deliver-check`
  verifies the local test condition, not GitHub runs.
- QA inbox snapshot. The watcher's minute poll reads workflow runs only. `npm run ci-watch -- --refresh-inbox` is a
  separate explicit read of the open `qa-inbox` issues into `<git common dir>/ci-watch/inbox.json`. Run it once at
  triage, when taking over a task, and after changing an inbox issue, never as per-agent polling. `qa-status` shows
  the snapshot with its own `inboxFetchedAt`, or says it is unknown.

## Task timebox

Owner's words and reasons: [DECISIONS.md, Task pipeline](DECISIONS.md#task-pipeline), `D-PIPELINE-TIMEBOX`.

- Substantive work on a development task is limited to 2 hours, from the start of real work until the finished
  implementation or result is handed over. Count research, design, implementation and fixes of actual defects. Do
  not count check runs, review passes, CI or other external waits: they run asynchronously in the pipeline and hold
  no active slot. Time that is genuinely paused or waiting on something external is not counted.
- The clock belongs to the logical task: all its descendant agents and all earlier work count. A retry, a restart or
  a handover to a helper never resets it.
- At 2 hours of substantive work on an unfinished task, Main pauses it safely (`interrupt`, sessions kept, no
  checkpoint file) and reports to the owner: the achieved result, the known costs, the roadmap of next steps and why
  it is unfinished, with facts kept apart from hypotheses. The report gives substantive work time separately from
  verification and wait time; when the logs cannot separate them, it says the time is unknown and states no exact
  figure the timestamps do not prove.
- The freed active slot goes at once to the highest-priority runnable task of the waiting queue. No slot is held for
  the owner's answer.
- More work on the paused task needs the owner's decision, and no silent
  continuation, restart or reassignment replaces it. If the owner continues it, Main reprioritises and resumes the
  task, interrupting a lower-priority active task if needed, with its history kept.
- This is a control checkpoint, not a promise that any task is done in 2 hours.

## Subagent models

These rules are for developing this repository with agents. They are not product settings: the reviewer
profiles supplied by `RQW-review` keep their own models. The decision,
the owner's messages and the history are in [DECISIONS.md, Work policy](DECISIONS.md#work-policy).

Main picks one task class and starts an ordinary `agent` subagent with a model and reasoning pair of that class:
`simple` for ordinary tasks, `complex` for complex tasks, `hardest` for the hardest and most important tasks.
The block below is the only place that lists the pairs, and the source of truth for the dev guard. To change
a rule, edit the block; no other file repeats it.

```json coordinator-rules
{
  "agentModels": {
    "simple": [
      ["anthropic/claude-sonnet-5-5", "medium"],
      ["openai-codex/gpt-6.1-sol", "low"]
    ],
    "complex": [
      ["anthropic/claude-sonnet-5-5", "high"],
      ["openai-codex/gpt-6.1-sol", "medium"]
    ],
    "hardest": [
      ["anthropic/claude-opus-5-5", "medium"],
      ["openai-codex/gpt-6.1-sol", "high"]
    ]
  },
  "temporaryGptOnly": {
    "until": "2026-10-28T16:00:00Z"
  }
}
```

Temporary override: until 2026-10-28 19:00 Moscow time, `2026-10-28T16:00:00Z`, no subagent working on this
project uses Anthropic. Only the GPT pairs of the task-class table are allowed, including for benchmark arbiters.
At the timestamp the normal table applies again automatically. The guard checks the clock on every Main
start/restart and passes the restriction into child briefs. This development override does not change product profiles.

1. Every `start` and `restart` by Main names `model` and `thinking` explicitly from the chosen class. Nothing is
   inherited from Main's own model or reasoning.
2. Main starts ordinary `agent` subagents. Specialized roles, including reviewers, use the same tool with
   `agent_type`; profiles do not add a separate execution lifecycle.
3. Choose the class by the task. Opus 5.5 medium (`hardest`) is far stronger than Sonnet 5.5 high (`complex`), and
   Sol high (`hardest`) is stronger than Sol medium (`complex`). Keep `hardest` pairs for the hardest and most
   important tasks and never give the stronger pair to the easier task.
4. Outside the temporary GPT-only override, spread subagents evenly between Anthropic (Opus 5.5, Sonnet 5.5)
   and GPT-6.1-Sol so both subscriptions' limits are spent evenly. Balance over the run, not per single call.
5. No other models or reasoning levels. A pause of a named benchmark campaign pauses that campaign only; it does
   not pause unrelated work or prohibit the authorized subagent models.
6. Dev guard: the project extension `.pi/extensions/coordinator-guard/` reads this block on every call of Main's
   `agent` tool and blocks a start or restart without `model` or `thinking`, with a pair outside the block;
   it also blocks an unreadable block. It is dev-only: it loads for this trusted checkout,
   covers only Main's top-level session, and is not shipped or listed in `pi.extensions`. Subagents and benchmark
   harnesses load no extensions, so for them these rules are written text only.
   Details: [guard README](.pi/extensions/coordinator-guard/README.md).
7. Owner quotes. In `DECISIONS.md` and `PROCESS.md` text inside guillemets (the angle quotation marks) is only the
   owner's own words: one contiguous piece of a single owner message from a user entry of a session file. Insert no
   ellipsis, cut, paraphrase or merge. The machine check compares after Unicode NFC and whitespace normalization, so
   line breaks and list indent are formatting. The span need not be the whole message. Agent text and option texts
   go outside guillemets, and this file shows no literal guillemet examples. Briefs to subagents follow the same rule.
   Carrier: `scripts/deliver-check.mjs` checks only quote spans touching added lines of `DECISIONS.md` and
   `PROCESS.md` against the owner sessions of this repository. `MY_PI_SESSIONS` overrides them with directories
   joined by the path delimiter; no session files found fails closed.

## Golden rule

Standing requirement for designing and reviewing the harness and the development workflow. Owner's words and reason:
[DECISIONS.md, Work policy](DECISIONS.md#work-policy), `D-WORK-GOLDEN-RULE`; personal wording:
[WORKFLOW-MANIFEST.md](WORKFLOW-MANIFEST.md#золотое-правило).

- Spend no tokens where they can be avoided: no polling, no model turns spent only waiting, no repeated reads or
  reviews without new input.
- Solutions are engineered, thought through, efficient, optimal and as simple as possible. Weigh the trade-offs and
  balance them to reach the right decision.
- Every design, implementation and review checks this. The review criterion of every brief carries this line:
  "Golden rule: no avoidable token spending (no polling, no model turns only to wait, no repeated reads or reviews
  without new input); engineered, simple, optimal; trade-offs weighed." Reviewers report only an evidenced
  violation, not taste.

## Code quality

Provisional until the AI-maintainability research lands: every change and every review must keep extension source
as clean, short, readable and easy to extend as possible.
Quality means ease of maintenance: even a junior should understand what the code does by reading its structure.
Use the minimal code needed for the agreed result, without garbage. Prefer well-decomposed, straightforward code
rather than clever one-liners or dense compound expressions. Brevity must not hide structure or understanding.
These are provisional implementation and review criteria, not permission for unrelated refactoring or scope expansion.
The manifesto describes the owner's own work; this AI repository needs an adaptation for AI agents. Research must
establish what actually helps them, including whether one-liners are more effective, before this principle is rewritten.
Do not present the owner's preferred decomposition plus fast search as a proven result for AI agents.
Owner's principle and source: [DECISIONS.md, Work policy](DECISIONS.md#work-policy); personal wording:
[WORKFLOW-MANIFEST.md](WORKFLOW-MANIFEST.md#качество-и-объём-работы).

## Sufficient proof, without idle reruns

- Main ensures subagents choose and perform checks for the changed behavior and claim under the rules below.
  Subagents inspect documentation and Pi sources where needed.
  Use deterministic tests for mechanics and actual model probes when the claim concerns model behavior.
  Do not burn tokens on live compaction when the owner requests documentation-only proof.
- Run existing relevant checks once, in the background where possible. Repeat after a relevant fix or a changed
  tested input, not merely for confidence, staging, a commit ID or a squash merge. Reuse valid evidence while the
  tested code, configuration and document contracts remain unchanged, except for the mandatory local delivery run below.
- CPU-heavy work (repeat loops, pressure runs and load probes) runs in GitHub Actions, not on the owner's MacBook
  Air. The delivery exception is full local `npm test` on the exact committed branch head, run by `deliver-check`.
  Other local checks stay focused on the change. Windows checks run in CI too,
  including relevant Node, Bun and PortableGit coverage, but they are advisory and do not gate a merge
  ([Task pipeline](#task-pipeline)). Linux is out of scope.
- Run `npm run test:bun` in CI when Bun/codemode behavior is affected. Test extension isolation when affected.
- Subagents save their check and probe logs. Every number in a report or documentation must point to a CI run URL
  or a named saved log file; never report counts from memory. Save local logs in OS temporary storage.
- Test exactly what gets merged. If `main` moved since the branch was created, the subagent rebases the branch onto
  current `main`; `deliver-check` runs full local `npm test` on that final committed head, whose squash has the same
  tree. This is the only delivery test condition; no GitHub run needs to be triggered or awaited for a merge.
- Root documentation, notes and development instructions alone do not justify extra application tests or model runs;
  the full local delivery run still applies. A workflow change does require validating its triggers and affected
  Windows jobs. Do not claim a queued or incomplete run passed.
- Everyone who writes, generates or fixes tests, a subagent, a reviewer or the test-fix lane, has one purpose: to check
  that the behavior matches the requirements, never to turn the run green. The bound is the reviewer's: no
  fanaticism, perfectionism, polishing or taste.
- Fix failures caused by the task, including assertions for deliberately changed behavior. Report unrelated failures
  without repairing them or falsely counting a failing required check as clean. If they block delivery, ask the owner.
- For prompt/tool behavior performance claims, compare against the relevant baseline. The product goal remains
  my-pi better than stock Pi and Pi plus our prompt; do not launch a full benchmark for every unrelated edit.

## Measurements and benchmarks

Runs exist to find and fix defects, not to tick a box. Every measurement or benchmark with model calls follows:

1. Waves, never the whole matrix at once: a small first wave, then larger ones. The first launches use the
   strongest models of the measured list, so a defect shows at the start on strong models.
2. Outputs are checked continuously while the run goes, not only at checkpoints: an automatic anomaly watcher
   runs after every run, and an agent reads the actual outputs, not only counters, for anomalies (repeated rounds,
   errors, format failures, loops, outliers in time).
3. At the first obvious defect the run stops at once and the defect is fixed before anything else runs. Waiting for
   the full run only means rerunning it after the fix.
4. The next wave starts only after the previous one is clean; the full matrix only after the early waves are clean.
5. Calibration, meaning fixing the system under test, happens on the strongest models. Weaker models are measured
   afterwards on the calibrated version; their failures are recorded as capability limits, not treated as defects
   to fix, unless they show a mechanics or checker bug.
6. Measurement runs have no hard request or start caps as stop conditions; usage never stops a run. The one exception is the
   controlled pause of the [task timebox](#task-timebox): outstanding work pauses at a review boundary and is
   reported; it is no request or start cap. The measurer
   supervises instead: a programmatic monitor checks the running wave every 1-5 minutes (not
   continuous polling), the measurer reads the actual outputs it surfaces, and interrupts the run on real anomalies
   (harness defect, stuck or looping reviewer, runaway repairs, unpinned sources, errors).
7. When two judges disagree, a third independent arbiter subagent verifies the disputed finding against the sources and
   decides.

## Independent review

- Result review follows the native `reviewer` skill supplied by `RQW-review`. `blindreview` selects `spotty`,
  `highreview` selects `bossy`; launch each pass as a fresh ordinary `agent` with `agent_type` and
  `include: ["user_messages"]`. The profiles default to `openai-codex/gpt-6.1-sol` low and medium respectively and append
  the reviewer role to the main prompt and subagent reminder. Read-only is an instruction, not a git guard or sandbox.
  Record `Review: agent#N CLEAN`. If the required skill, profile or `agent` is unavailable, the check cannot run;
  report the blocker rather than substituting a separate runtime or copied whole-system prompt.
- Main names the change class in the task brief and in the squash message. Reasons and the owner's words:
  [DECISIONS.md, Task pipeline](DECISIONS.md#task-pipeline).
  1. Proofreading: typos, wording, quote spans, links and formatting of passive documents, with no change of meaning
     and no new or changed rule. Proof is local: the owner-quote check of touched quotes, a link check and a format
     check of the touched files, saved in a log. No independent review and no application CI. The squash message
     carries `Change-class: proofreading` and `Doc-check: <absolute log path>`; `deliver-check` accepts them only for
     the passive documents it lists. Never for runtime prompts, the `coordinator-rules` block, `package.json`, a
     changed rule or a `QA: #N` fix.
  2. Meaning change of process or documents: one clean result review, plus a code review where the path rule below
     applies.
  3. Runtime prompts (`extensions/RQW-prompt/SYSTEM.md`, agent role profiles,
     `extensions/RQW-review/profiles/*.toml`, `extensions/RQW-review/skills/**/SKILL.md`,
     `extensions/RQW-tools/descriptions/*.md`): mechanical checks and a model
     probe of the claimed behavior, plus the reviews of class 2.
- Except for proofreading and the [third-party installation fast path](#third-party-installation-fast-path), every
  squash merge requires a clean result review. Result review invokes `blindreview` with `agent_type: "spotty"`
  for small work and `highreview` with `agent_type: "bossy"` for large work. An answer or report without changes
  needs no review. Explicit owner requirements for a review take precedence.
- Small work is at most 100 added plus deleted lines, all inside one extension, with no owner-visible behavior change.
  One combined result and code review covers it: one `agent` reviewer given the result criteria and `.agents/reviewers/code.md`,
  recorded as `Combined-review: agent#N CLEAN`. Large work and any owner-visible behavior change get the separate
  result review and code review below. A QA fix, a workflow change and a test-integrity trigger are never small.
  `deliver-check` enforces the line limit and the single extension; that reviewer verifies that no owner-visible
  behavior changes.
- Subagents first self-check their work and fix defects before independent review. Main checks their evidence and
  acceptance against the agreement, routing needed fixes to subagents. The final independent result review checks agreed completeness,
  consistency, documentation and absence of unagreed additions. Each pass is a complete review and returns every
  finding at once.
- The review cycle, ported from the owner's Codex CLI reviewer skills (`DECISIONS.md`, [Review](DECISIONS.md#review)).
  It runs when the owner asks for a review or a checked result, or when this section requires it, such as before
  a squash merge; never on Main's own initiative. The task has these sections in this order: `<agreement>` only
  when needed, containing only decisions the owner himself accepted, each with its source and evidence of his
  acceptance; Main's or another agent's approval is not agreement. Then `<object>` (exact paths or readable
  references, primary requirements, governing rules, source evidence, the diff as a file path, and the stage
  `pre-action` or `pre-completion`), `<criterion>` (what the check confirms and which deliverable must fulfil each
  obligation; an exclusion cannot silently waive a governing requirement of this pass) and, from the second
  pass on, `<rejected_earlier>`. `include: ["user_messages"]` mechanically appends `<user_messages>` after the task:
  every user-role text of the caller's selected branch, verbatim and in order, including entries before compaction.
  Images and non-user messages are omitted; nested callers contribute their own messages. Do not retype the messages.
  Every review brief, including code and test-integrity review, follows these agreement-source rules and includes
  in `<criterion>`: "Any element beyond the owner's requirements and decisions the owner himself accepted is a finding."
  Set no file, search, tool-call or turn quotas, and leave the reviewed files unchanged until the verdict.
- For large work, run a separate read-only code reviewer in parallel with result review whenever a changed path falls outside
  the `tests.yml` `paths-ignore` filters used by `scripts/deliver-check.mjs`, considering both base and head filters.
  This includes extension READMEs even though their contents are prose. Root Markdown, `notes/**` and `.agents/**`
  alone are excluded by the current filters. Workflow logic is executable configuration and needs code review too.
  Read `.agents/reviewers/code.md` and pass it as the complete `system` to an `agent` subagent, choosing its model and
  reasoning from the table above. Its task brief includes the changed files, diff, callers, relevant tests and evidence.
  This role checks bugs, regressions and meaningful code quality, not a second requirements ritual.
- Result-review verdicts and admission, for the `spotty` and `bossy` profile agents only; the code and
  test-integrity reviewers follow the next bullet. `CLEAN` with a complete `CHECKED:` and no `UNCHECKED:` passes the pass; run no extra pass for confidence,
  but keep every independent pass and its order that this section requires. `FINDINGS:` are the teammate's findings:
  Main finds each quote by searching for it. A finding whose two quotes stand verbatim in their sources is admitted;
  for an omission, verify the quoted requirement and the complete inspected file or section instead of demanding
  nonexistent text. Fix an admitted finding exactly to its REQUIRED OUTCOME and no further; do not reject it, argue
  with it or put it to the owner. Reject a finding only when a quote is not verbatim, the allegedly missing content is
  present in the cited object, or a NOT AGREED element is covered by a verbatim quote of the agreement, and give that
  reason with the quote. Main routes all admitted fixes to subagents in one batch, and subagents recheck the affected parts
  and checks, not untouched parts. Then a fresh reviewer runs with the same level, object and criterion and every
  rejection so far in `<rejected_earlier>`, until `CLEAN`. `UNCHECKED:` or missing `CHECKED:` evidence makes the pass
  incomplete whatever the leading verdict: resolve the missing sources or evidence, or retry malformed output; never
  record it as acceptance. No verdict, an error or a reviewer that could not start means the check has not passed and
  no self-check replaces it: launch it once more on the unchanged object, and if it fails again tell the owner and wait.
  When this review contract changes, validate it against known defective, corrected and missing-source examples before
  claiming improved detection; these checks are not extra rounds in ordinary task reviews.
- Code-review, test-integrity and `Combined-review` findings (`.agents/reviewers/code.md`,
  `agent_type: "test-reviewer"`; the combined reviewer also uses `code.md`): admit
  real evidenced defects, not taste or unlikely hypotheticals. Check findings rather than accepting them just because a
  quote exists. Main validates real findings and routes admitted fixes to subagents in one batch; explain rejected
  findings with evidence. Subagents recheck affected parts and checks, not untouched parts. The result-review quote and
  `CHECKED:` rules above, and the prompt formats they name, do not apply to these reviewers.
- A CLEAN covers only the commit it reviewed. Any commit after CLEAN sends the places it changed back to review:
  result review, and code review when the path-based requirement above applies. A conflict-free rebase onto `main`
  changes no task places: it needs the full local delivery test on the new head, not new review; places changed
  while resolving conflicts go back to review.
  Otherwise reuse CLEAN only while its commit is unchanged. Stop when the required reviews are clean; do not
  invent either a one-pass cap that leaves known bugs or endless fresh passes for confidence.
- A finished substage handed over separately gets its own blind independent check. Internal draft/stage commits
  are not handovers and do not create an automatic review gate. Reuse its valid coverage in final review.

## Quality control loop

The full regression runs on `main` by itself; Main reads its failures, it does not run or watch it. Decisions and
reasons: [Quality control](DECISIONS.md#quality-control).

**Schedule.**
- `tests.yml` runs on `main` every 2 hours, `pcli.yml` daily, `codex-oracle.yml` daily once its file is on `main`.
- Task branches get no scheduled reruns, and nothing retries automatically: no test retry, no rerun of failed
  jobs, no `continue-on-error`. A flake is measured as k failures in n runs, not retried away.
- `tests.yml` has no concurrency group: overlapping scheduled runs both run, so no run is cancelled.

**Inbox.**
- Every failed scheduled or dispatched `main` run of those workflows feeds `qa-inbox.yml`. It keeps one GitHub issue
  per failure signature, label `qa-inbox`, and owns the issue body: it rewrites the body in place and never comments.
  Do not edit the body by hand; write triage notes in a comment.
- Passes are serialized, and each pass also picks up failed `main` runs of the last 48 hours that no issue records,
  so a dropped pass heals on the next one. The history baseline in the issue is the last green scheduled run.
- An issue closes only when a `main` commit has the line `QA: #N` and at least max(6, ceil(3/p)) scheduled runs
  after it are green, where p is the failure rate of the signature. A signature that stops without a fix stays open;
  Main may close it only with a written explanation in the issue, such as a confirmed runner incident.

**Digest.** `qa-digest.yml` mails the owner at 09:30 and 21:30 Moscow time, only about failures; no new or
recurring failure since the previous digest, no mail. Its window starts at the previous successful scheduled digest
run (at most 48 hours back, 12 hours when there is none), so no failure falls between two mails.
The owner relays them to Main. Main also checks the inbox when it is online.

**Awareness.**
- At task start and when taking over a branch, Main reads the QA status: the `qa-status` message of the dev-only
  `.pi/extensions/qa-status` extension, `/qa` for the full view, or `npm run qa-status` (subagents use this one).
  All three read the shared [CI watcher](#task-pipeline) file instead of calling `gh` themselves.
- A red scheduled `main` is mentioned to the owner in one line and triaged. Main never polls CI itself.
  A failed `main` run whose every failure signature is recorded in a closed inbox issue is shown as info
  (acknowledged); a run with any other failure, or one only an open issue records, stays red.
- A red `main` does not block merges. `deliver-check` only lists the open inbox issues.

**Triage.** Before any fix, a read-only subagent classifies the failure and records the class with its evidence in the
issue:

| Class | Evidence required |
| --- | --- |
| Product bug | The failing assertion and the code path that breaks the agreed behavior; for an intermittent case the race or ordering seen in the logs. Fix the product, keep the test. |
| Test bug | Why the old assertion is wrong, citing the contract in `DECISIONS.md` or a README. |
| Infra | The failed step's log lines. No test change; fix only our own CI configuration. |
| Drift | The version diff between the last green and the first red run (Facts step). Fix the compatibility or pin the version with a `DECISIONS.md` entry; dropping a platform or version needs the owner. |

**Forbidden without proof.** These need triage proof that the old value or assertion was wrong; the test-integrity review
applies only when `deliver-check` mechanically detects the weakening (see below): raising a timeout or deadline; retries or job reruns; `skip`, `todo` or a platform skip;
deleting a test or an assertion; weakening an assertion (exact to range, `includes`, truthy); swallowing an error;
rewriting an expected value to the current output; `continue-on-error`; removing a matrix entry; changing
`paths-ignore` to avoid a run. Replacing a time-based assertion by an event-based one is allowed with that proof.

**Interim skip retired.** The owner-approved Windows skip for inbox issues #3, #4 and #5 was applied and then removed: the causal
fix landed as `2b9c088` and no skip is in the tests. The forbidden list above applies in full again; a new narrow skip
needs a fresh owner decision ([D-PIPELINE-FLAKE-SKIP](DECISIONS.md#task-pipeline)).

**Proof of a fix.**
- Red before, green after: the test fails on the pre-fix code (or with the fault put back) and passes after, both in
  CI logs.
- Intermittent failure: n repeat runs after the fix with no failure, where (1-p)^n < 0.05 and p is the failure rate
  before the fix. Use the manual `codemode-stress.yml` repeat harness (dispatch inputs: test file, name pattern, os, node, runs) or a dispatch of `tests.yml`; CPU-heavy repeats stay in CI.

**Test-integrity review.** For every test or workflow change that weakens a check, as `deliver-check` mechanically
detects it (`skip`, `todo`, retry, raised timeout, `continue-on-error`, fewer assertions), and not for every QA fix, a
reviewer subagent runs through `agent` with `agent_type: "test-reviewer"`, in parallel with the result and code reviews.
The project profile `.pi/agents/test-reviewer.toml` owns its prompt and Sol 6.1 low defaults.
Its brief names the exact review scope and supplies the issue, the triage claim, the diff and the red/green and repeat
evidence when applicable; without an inbox issue, supply `Test-change:` and its supporting contract and evidence.

**Trailers** of the squash message. `QA: #N` marks a fix of inbox issue N. `deliver-check` requires
`Test-change: <why the old test was wrong or what it proves now>` and `Test-review: agent#N CLEAN` when the
test-integrity rule triggers: a test or workflow change adds `skip`, `todo`, `--test-retry` or `continue-on-error`,
raises a timeout, or leaves fewer assertions in a test file. A `QA: #N` line requires `Test-change:` when test or workflow
files changed, and `Test-review:` only when the weakening rule above triggers. An ordinary test change needs neither.

## Third-party installation fast path

For an agreed third-party library or Pi extension, first install it into the owner's Pi so it works immediately,
then add it to the `my-pi` package. At first use, consult Pi's documentation to decide how one Pi package bundles
another; do not preselect a packaging mechanism. Preserve credentials and unrelated settings.
Self-review the config and exact diff for unintended additions, commit and push to `main`. This narrow path
replaces the full Delivery pipeline, including the local test gate and independent reviews, for third-party installation
and package configuration only. It does not apply to building our own features or mechanisms or to this process
and guard change. Record the accepted choice in `DECISIONS.md`.

## Delivery

1. Update the affected documentation with the code. Record active accepted decisions in `DECISIONS.md` with the
   owner's verbatim quote, source session, reason and carrier; keep each rule in one place and link elsewhere.
   Superseded and obsolete decisions go verbatim into root `DECISIONS-ARCHIVE.md`, an append-only archive with
   replacement and commit provenance, not routine agent reading. `BACKLOG.md` is the canonical list of open and
   owner-deferred work with source, status and branch; remove done and dead tasks instead of keeping a second ledger; owner-discarded tasks move to `BACKLOG.md` Discarded.
   Current docs describe current facts, not a history ledger.
2. Push the task branch; continue independent work during required reviews. Before merging, require sufficient
   proof and the required clean reviews for the final head commit on current `main`. The only delivery test
   condition is full local `npm test` on that exact committed head on the owner's macOS, run by `deliver-check`.
   No green GitHub Actions run is required, including `pcli.yml`; CI evidence trailers are not required.
3. Before every squash merge, the merge agent ([Task pipeline](#task-pipeline)) writes the planned squash message
   and runs, from the clean main checkout,
   `npm run deliver-check -- <branch> <message-file>` (`scripts/deliver-check.mjs`; it fails in any checkout
   without `main` checked out). It requires: the branch
   contains current `origin/main` and the main checkout's HEAD, the merge destination. It runs full `npm test`
   in the branch's existing clean task worktree on the owner's macOS, at the exact committed branch head, and
   checks worktree cleanliness and the head before and after the run. No receipt or extra worktree is needed.
   The message carries the
   trailers `Review: agent#N CLEAN` (at least one clean profile-based result review under
   [Independent review](#independent-review)), `Code-review: CLEAN` (any path outside
   the workflow exclusions, including extension READMEs),
   or instead of both for small work `Combined-review: agent#N CLEAN`, or for proofreading no review trailer and
   `Change-class: proofreading` with `Doc-check: <absolute log path>` ([Independent review](#independent-review)),
   and `Unverified: <what was not verified live, or none>`. An optional
   `Decision: D-<SECTION>-<NAME>` trailer links the squash to a stable decision ID; it is not a gate requirement.
   When the
   test-integrity rule triggers it also requires `Test-change:` and `Test-review:`; a `QA: #N` line requires
   `Test-change:` when test or workflow files changed, and issue N must carry the `qa-inbox`
   label ([Quality control loop](#quality-control-loop)). It lists the open `qa-inbox` issues as information:
   a red `main` does not block a merge. Any failure: no merge.
4. Squash merge into `main`: one task, one commit, with that message. Never merge the task's stage commits into main
   as a merge commit. Push main autonomously; the squash tree equals the tested head, so it is not retested.
5. Run a completeness check for the session once after 7 merges or 120 minutes, whichever comes first, counted from
   the previous check or the session start, and always before the final report: a fresh independent profile reviewer
   through `agent`, following the `reviewer` skill and [Independent review](#independent-review), with
   `include: ["user_messages"]`. Object: `main`'s git log since the session
   start, plus the in-progress branches and worktrees and the items the owner cancelled. Criterion: every owner
   request is marked done (by which commit), in progress (by which branch) or cancelled by the owner. A request
   with no mark is a finding: do it, or ask the owner.
6. Update the locally installed Pi when a runtime/package change requires it, preserving auth and other settings;
   restart when process-wide patches require it. Documentation-only work needs no package update or restart.
7. After successful delivery, and after every ignored Windows failure is recorded and any still-running Windows run is
   handed to background tracking ([Task pipeline](#task-pipeline)), remove this task's worktree, its local branch and
   its branch on `origin`. Do not remove other tasks' worktrees or branches.
   Publishing a release or Marketplace version requires the owner's direct request.
8. Report the result once, unprompted with an evidence table (claim, check, result or run link) and an honest
   "not verified live" section, plus any real limitation and manual commands only when useful.

## Communication and continuity

Always answer in Russian, with the main point first. At most three paragraphs of at most two lines each unless
content genuinely requires expansion. No repeated waiting messages or lists of unfinished work. During execution,
ask only about a real blocker needing the owner; answer direct questions and requested status, then continue.
Reports and questions do not stop independent background subagents or checks.

After compaction, a model switch or a handoff, reload this procedure and recover the actual agreement and evidence
from their sources before continuing. Do not substitute an unaccepted agent plan for the owner's words.
