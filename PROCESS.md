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

Spread worker and reviewer subagents evenly between Anthropic models (Opus 5.5, Sonnet 5.5) and GPT-6.1-Sol
so both subscriptions' limits are spent evenly. Balance over the run, not per single call; still choose model
and reasoning by task within the allowed table below.

Choose model and reasoning for the work, not all workers at maximum reasoning:

| Model | Allowed reasoning |
| --- | --- |
| Sonnet 5.5 | high |
| Opus 5.5 | medium |
| GPT-6.1-Sol | low, medium |

Simple work uses Sonnet 5.5 high or GPT-6.1-Sol low. Complex work uses Opus 5.5 medium or
GPT-6.1-Sol medium. No other models or reasoning levels are used for these workers. These are development workers,
not changes to the product reviewer models of `RQW-review`. A pause of a named benchmark campaign pauses that
campaign only; it does not pause unrelated work or prohibit the currently authorized worker models.

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
   `CI: <run url>` (each required run) and `Unverified: <what was not verified live, or none>`. Any failure: no merge.
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
