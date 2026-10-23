# Development process

This is the working procedure for agents developing my-pi. Read it before every task and restore it after
compaction or a context handoff. `WORKFLOW-MANIFEST.md` is the owner's personal record of his working principles
and aspirations, not a procedural gate. This file carries the agreed execution rules; `DECISIONS.md` carries
the accepted decisions and their reasons. New owner instructions take precedence over older agreements.

## Research and agreement

1. While the owner discusses or plans, change nothing. A proposal or question is not permission to implement it.
2. Delegate initial research of the request and relevant source code to worker subagents, in parallel where useful.
   Main compiles all requirements across the conversation and accepted proposals, retaining the owner's exact words.
   Keep agreed work intact: do not lose, silently drop, reinterpret or invent requirements.
3. Bring all material ambiguities, conflicts and missing outcome decisions to the owner in one question batch.
   Do not decide for the customer without permission. Delegated technical choices, including worker model selection,
   remain the agent's responsibility within the agreed outcome; they are not permission to widen or shrink it.
4. The owner's answers or approval start the agreed work without another go question. If nothing is open and the
   owner has explicitly requested execution, start. Keep the minimal necessary agreed scope, not a smaller scope.

## Isolated parallel execution

- Start each change task from up-to-date `main` in its own branch and git worktree:
  `git worktree add -b <task> ../my-pi-worktrees/<task> main`. Make all task edits there, never in the main checkout.
- Main is the coordinator, not an independent implementer: it owns requirement compilation, owner questions,
  task decomposition, worker model selection, scheduling, acceptance and integration of results, review organization,
  delivery/git and reports. Main may read sources and results to coordinate and accept work, but must delegate actual
  research, implementation (including documentation/config edits), probes/measurements, test runs and fixes to worker
  subagents, regardless of task size. The existing generic `agent` tool suffices; no fixed named worker roles are needed.
  Give each worker a self-contained brief: agreement, files and worktree, ownership, dependencies, expected result
  and sufficient proof. Include the relevant process rules in its system prompt or brief; do not assume a child
  inherits this file.
- The owner addresses Main (the coordinator) as the executor. Main always acts within its assigned role and executes
  through subagents, without exception. When the owner says "ты сам" or "you do it", Main still starts a subagent to
  do the work; Main never does the work in its own thread.
- Main never blocks its own thread on waiting, polling, CI watching, test runs or any other long work. It hands
  all of that to subagents and stays free to coordinate and talk to the owner.
- Run independent research, implementation, probes and checks in parallel. Up to 10 first-level subagents (those
  Main starts itself) may run in parallel when there are that many useful independent blocks; nested subagents
  they start do not count. This is a ceiling, not a quota. Minimize sequential work
  and avoid concurrent writes to the same files. Stop superseded workers.
- Main drives the whole agreed task to completion autonomously through workers: they implement, inspect, make the
  needed probes and measurements, and fix obvious defects and relevant corner cases. Do not polish extremely
  unlikely scenarios or expand the task.
- Commit completed stages promptly to the task branch, staging exact task paths. Stage commits require no review
  or test gate; they do not replace final verification or authorize a merge.
- Work only in my-pi. Other repositories are read-only sources. Keep the user's changes, credentials and settings.
  No forks of Pi. If a fork seems necessary, discuss it before acting. Use Node.js for project tooling and Git Bash
  on Windows, not PowerShell or cmd for runtime tooling. Existing CI bootstrap and host setup are separate.
- Temporary task files belong in the OS temporary directory. Do not put transcripts, credentials, archive copies,
  historical cleanup notes or execution ledgers in the repository. History belongs in Git.

## Worker models

These rules are for developing this repository with agents. They are not product settings: the models of
`RQW-review` and the fixed models of `code_writer` and `shell_runner` stay as they are. The decision,
the owner's messages and the history are in [DECISIONS.md, Work policy](DECISIONS.md#work-policy).

Main picks one task class and starts an ordinary `agent` subagent with a model and reasoning pair of that class:
`simple` for ordinary tasks, `complex` for complex tasks, `hardest` for the hardest and most important tasks.
The block below is the only place that lists the pairs, and the source of truth for the dev guard. To change
a rule, edit the block; no other file repeats it.

```json coordinator-rules
{
  "workerModels": {
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
  "fixedWorkers": "block"
}
```

1. Every `start` and `restart` by Main names `model` and `thinking` explicitly from the chosen class. Nothing is
   inherited from Main's own model or reasoning.
2. Main starts only ordinary `agent` subagents. It never starts `code_writer` or `shell_runner`
   (`"fixedWorkers": "block"`), and it never starts `explore`: the dev guard always blocks Main's explorer, with no
   JSON key for it, since an explorer runs on its parent's model. The subagents Main starts may use workers,
   explorers and `review` themselves.
3. Choose the class by the task. Opus 5.5 medium (`hardest`) is far stronger than Sonnet 5.5 high (`complex`), and
   Sol high (`hardest`) is stronger than Sol medium (`complex`). Keep `hardest` pairs for the hardest and most
   important tasks and never give the stronger pair to the easier task.
4. Spread subagents evenly between Anthropic (Opus 5.5, Sonnet 5.5) and GPT-6.1-Sol so both subscriptions' limits
   are spent evenly. Balance over the run, not per single call.
5. No other models or reasoning levels. A pause of a named benchmark campaign pauses that campaign only; it does
   not pause unrelated work or prohibit the authorized worker models.
6. Dev guard: the project extension `.pi/extensions/coordinator-guard/` reads this block on every call of Main's
   `agent` tool and blocks a start or restart without `model` or `thinking`, with a pair outside the block, or of a
   fixed worker or explorer; it also blocks an unreadable block. It is dev-only: it loads for this trusted checkout,
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

## Sufficient proof, without idle reruns

- Main ensures workers choose and perform checks for the changed behavior and claim under the rules below.
  Workers inspect documentation and Pi sources where needed.
  Use deterministic tests for mechanics and actual model probes when the claim concerns model behavior.
  Do not burn tokens on live compaction when the owner requests documentation-only proof.
- Run existing relevant checks once, in the background where possible. Repeat after a relevant fix or a changed
  tested input, not merely for confidence, staging, a commit ID or a squash merge. Reuse valid evidence while the
  tested code, configuration and document contracts remain unchanged.
- CPU-heavy work (full suites, repeat loops, pressure runs and load probes) runs in GitHub Actions, never on the
  owner's MacBook Air. Locally run only the focused test files of the change. Windows checks run in CI too,
  including relevant Node, Bun and PortableGit coverage. Linux is out of scope.
- Run `npm run test:bun` in CI when Bun/codemode behavior is affected. Test extension isolation when affected.
- Workers save their check and probe logs. Every number in a report or documentation must point to a CI run URL
  or a named saved log file; never report counts from memory. Save local logs in OS temporary storage.
- Test exactly what gets merged. If `main` moved since the branch was created, the worker rebases the branch onto
  current `main`; Mac tests and Windows CI must pass on that final head commit, whose squash has the same tree.
  If the push started no `tests.yml` run (path filter), dispatch it: `gh workflow run tests.yml --ref <branch>`.
- Root documentation, notes and development instructions alone do not justify application tests or model runs.
  A workflow change does require validating its triggers and affected Windows jobs. Do not claim a queued or
  incomplete run passed.
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
6. Measurement runs have no hard request or start caps as stop conditions; usage never stops a run. The measurer
   supervises instead: a programmatic monitor checks the running wave every 1-5 minutes (not
   continuous polling), the measurer reads the actual outputs it surfaces, and interrupts the run on real anomalies
   (harness defect, stuck or looping reviewer, runaway repairs, unpinned sources, errors).
7. When two judges disagree, a third independent arbiter subagent verifies the disputed finding against the sources and
   decides.

## Independent review

- While RQW-review is disabled in the owner's settings, result review runs through an `agent` subagent whose
  whole system prompt is the new reviewer text (`extensions/RQW-review/REVIEWER.md` in `main`). Give it the
  owner's messages verbatim (the session file), plus agreement, object and criterion; record `Review: agent#N CLEAN`.
- Review is proportional. Mechanical point corrections with no new decision need no review. Small work, at most
  five requirements and five changed files, uses `review` level `blind`; larger work uses `high`. An answer or report
  without changes needs no review. Explicit owner requirements for a review take precedence.
- Workers first self-check their work and fix defects before independent review. Main checks their evidence and
  acceptance against the agreement, routing needed fixes to workers. The final independent result review checks agreed completeness,
  consistency, documentation and absence of unagreed additions. Give the reviewer the agreement verbatim, object,
  diff and sources, criterion and earlier rejected findings with reasons. Each pass returns all real findings at once.
- When code changes, run a separate read-only code reviewer in parallel with result review. Read
  `.agents/reviewers/code.md` and pass it as the complete `system` to an `agent` worker, choosing its model and
  reasoning from the table above. Its task brief includes the changed files, diff, callers, relevant tests and evidence.
  This role checks bugs, regressions and meaningful code quality, not a second requirements ritual. Do not spawn
  a code reviewer for prose-only changes. Workflow logic is executable configuration and needs code review too.
- Admit real evidenced defects, not taste or unlikely hypotheticals. Check findings rather than accepting them
  just because a quote exists. Main validates real findings and routes admitted fixes to workers in one batch;
  explain rejected findings with evidence. Workers recheck affected parts and checks, not untouched parts.
- A CLEAN covers only the commit it reviewed. Any commit after CLEAN sends the places it changed back to review:
  result review, and code review for code. A conflict-free rebase onto `main` changes no task places: it needs new
  tests and CI on the new head, not new review; places changed while resolving conflicts go back to review.
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
  `.pi/extensions/qa-status` extension, `/qa` for the full view, or `npm run qa-status` (workers use this one).
- A red scheduled `main` is mentioned to the owner in one line and triaged. Main never polls CI itself.
- A red `main` does not block merges. `deliver-check` only lists the open inbox issues.

**Triage.** Before any fix, a read-only worker classifies the failure and records the class with its evidence in the
issue:

| Class | Evidence required |
| --- | --- |
| Product bug | The failing assertion and the code path that breaks the agreed behavior; for an intermittent case the race or ordering seen in the logs. Fix the product, keep the test. |
| Test bug | Why the old assertion is wrong, citing the contract in `DECISIONS.md` or a README. |
| Infra | The failed step's log lines. No test change; fix only our own CI configuration. |
| Drift | The version diff between the last green and the first red run (Facts step). Fix the compatibility or pin the version with a `DECISIONS.md` entry; dropping a platform or version needs the owner. |

**Forbidden without proof.** These need triage proof that the old value or assertion was wrong, plus a clean
test-integrity review: raising a timeout or deadline; retries or job reruns; `skip`, `todo` or a platform skip;
deleting a test or an assertion; weakening an assertion (exact to range, `includes`, truthy); swallowing an error;
rewriting an expected value to the current output; `continue-on-error`; removing a matrix entry; changing
`paths-ignore` to avoid a run. Replacing a time-based assertion by an event-based one is allowed with that proof.

**Proof of a fix.**
- Red before, green after: the test fails on the pre-fix code (or with the fault put back) and passes after, both in
  CI logs.
- Intermittent failure: n repeat runs after the fix with no failure, where (1-p)^n < 0.05 and p is the failure rate
  before the fix. Use the manual `codemode-stress.yml` repeat harness (dispatch inputs: test file, name pattern, os, node, runs) or a dispatch of `tests.yml`; CPU-heavy repeats stay in CI.

**Test-integrity review.** For every QA fix, and for every test or workflow change that weakens a check
(`deliver-check` detects it), a reviewer subagent runs with `.agents/reviewers/test-integrity.md` as its whole
`system`, model and reasoning from the [worker table](#worker-models), in parallel with the result and code reviews.
Its brief has the issue, the triage claim, the diff and the red/green and repeat evidence.

**Trailers** of the squash message. `QA: #N` marks a fix of inbox issue N. `deliver-check` requires
`Test-change: <why the old test was wrong or what it proves now>` and `Test-review: agent#N CLEAN` when the
test-integrity rule triggers: a test or workflow change adds `skip`, `todo`, `--test-retry` or `continue-on-error`,
raises a timeout, or leaves fewer assertions in a test file. A `QA: #N` line always requires `Test-review:`, and
`Test-change:` only when test or workflow files changed. An ordinary test change needs neither.

## Delivery

1. Update the affected documentation with the code. Record accepted decisions in `DECISIONS.md` with the owner's
   quote, reason and carrier; keep each rule in one place and link to it elsewhere. Current docs describe current
   facts, not a history ledger. Remove obsolete current instructions, retain deferred work as deferred.
2. Push the task branch to start affected CI early; continue independent work while it runs. Before merging,
   require sufficient proof and the required clean reviews for the final head commit on current `main`.
   The "Mac tests" requirement is met by the `macos-latest` test jobs in `tests.yml` on that exact head
   (see [Sufficient proof](#sufficient-proof-without-idle-reruns) and [Independent review](#independent-review)).
3. Before every squash merge, Main writes the planned squash message and runs, from the clean main checkout,
   `npm run deliver-check -- <branch> <message-file>` (`scripts/deliver-check.mjs`; it fails in any checkout
   without `main` checked out). It requires: the branch
   contains current `origin/main` and the main checkout's HEAD, the merge destination; for changes (both sides
   of a move) outside the `tests.yml` `paths-ignore` filter, the latest `tests.yml` run on the exact head SHA
   succeeded, and likewise `pcli.yml` when its `paths` changed; the filters are `main`'s and the branch head's
   (a file counts if either version requires CI); the message carries the
   trailers `Review: review#N CLEAN` (or `Review: agent#N CLEAN` under the temporary
   [disabled-review rule](#independent-review); at least one clean result review), `Code-review: CLEAN` (non-doc changes),
   `CI: <run url>` (each required run) and `Unverified: <what was not verified live, or none>`. When the
   test-integrity rule triggers it also requires `Test-change:` and `Test-review:`; a `QA: #N` line requires
   `Test-review:`, and `Test-change:` when test or workflow files changed, and issue N must carry the `qa-inbox`
   label ([Quality control loop](#quality-control-loop)). It lists the open `qa-inbox` issues as information:
   a red `main` does not block a merge. Any failure: no merge.
4. Squash merge into `main`: one task, one commit, with that message. Never merge the task's stage commits into main
   as a merge commit. Push main autonomously; the squash tree equals the tested head, so it is not retested.
5. After every merge and before the final report, run a completeness check for the session: a fresh independent
   `review` (the tool already receives all the owner's messages verbatim), or an `agent` subagent running the same
   way under the [disabled-review rule](#independent-review) while RQW-review is disabled. Object: `main`'s git log since the session
   start, plus the in-progress branches and worktrees and the items the owner cancelled. Criterion: every owner
   request is marked done (by which commit), in progress (by which branch) or cancelled by the owner. A request
   with no mark is a finding: do it, or ask the owner.
6. Update the locally installed Pi when a runtime/package change requires it, preserving auth and other settings;
   restart when process-wide patches require it. Documentation-only work needs no package update or restart.
7. After successful delivery, remove this task's worktree and branch. Do not clean up other tasks' worktrees.
   Publishing a release or Marketplace version requires the owner's direct request.
8. Report the result once, unprompted with an evidence table (claim, check, result or run link) and an honest
   "not verified live" section, plus any real limitation and manual commands only when useful.

## Communication and continuity

Always answer in Russian, with the main point first. At most three paragraphs of at most two lines each unless
content genuinely requires expansion. No repeated waiting messages or lists of unfinished work. During execution,
ask only about a real blocker needing the owner; answer direct questions and requested status, then continue.
Reports and questions do not stop independent background workers or checks.

After compaction, a model switch or a handoff, reload this procedure and recover the actual agreement and evidence
from their sources before continuing. Do not substitute an unaccepted agent plan for the owner's words.
