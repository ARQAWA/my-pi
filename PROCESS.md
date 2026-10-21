# Development process

This is the working procedure for agents developing my-pi. Read it before every task and restore it after
compaction or a context handoff. `WORKFLOW-MANIFEST.md` is the owner's personal record of his working principles
and aspirations, not a procedural gate. This file carries the agreed execution rules; `DECISIONS.md` carries
the accepted decisions and their reasons. New owner instructions take precedence over older agreements.

## Research and agreement

1. While the owner discusses or plans, change nothing. A proposal or question is not permission to implement it.
2. Research the request and relevant source code first, using independent subagents in parallel where useful.
   Compile all requirements across the conversation and accepted proposals, retaining the owner's exact words.
   Keep agreed work intact: do not lose, silently drop, reinterpret or invent requirements.
3. Bring all material ambiguities, conflicts and missing outcome decisions to the owner in one question batch.
   Do not decide for the customer without permission. Delegated technical choices, including worker model selection,
   remain the agent's responsibility within the agreed outcome; they are not permission to widen or shrink it.
4. The owner's answers or approval start the agreed work without another go question. If nothing is open and the
   owner has explicitly requested execution, start. Keep the minimal necessary agreed scope, not a smaller scope.

## Isolated parallel execution

- Start each change task from up-to-date `main` in its own branch and git worktree:
  `git worktree add -b <task> ../my-pi-worktrees/<task> main`. Make all task edits there, never in the main checkout.
- Main coordinates the whole task and remains responsible for delivery. Give each worker a self-contained brief:
  agreement, files and worktree, ownership, dependencies, expected result and sufficient proof. Include the relevant
  process rules in its system prompt or brief; do not assume a child inherits this file.
- Run independent research, implementation, probes and checks in parallel. Use 20-30 workers when there are that
  many useful independent blocks, not to fill a quota. Minimize sequential work and avoid concurrent writes to the
  same files. Stop superseded workers. Main may edit directly; no mandatory code-writer or shell-runner roles.
- Finish the whole agreed task autonomously: implement, inspect, make the needed probes and measurements, fix
  obvious defects and relevant corner cases. Do not polish extremely unlikely scenarios or expand the task.
- Commit completed stages promptly to the task branch, staging exact task paths. Stage commits require no review
  or test gate; they do not replace final verification or authorize a merge.
- Work only in my-pi. Other repositories are read-only sources. Keep the user's changes, credentials and settings.
  No forks of Pi. If a fork seems necessary, discuss it before acting. Use Node.js for project tooling and Git Bash
  on Windows, not PowerShell or cmd for runtime tooling. Existing CI bootstrap and host setup are separate.
- Temporary task files belong in the OS temporary directory. Do not put transcripts, credentials, archive copies,
  historical cleanup notes or execution ledgers in the repository. History belongs in Git.

## Worker models

Choose model and reasoning for the work, not all workers at maximum reasoning:

| Model | Allowed reasoning |
| --- | --- |
| Sonnet 5.5 | high, xhigh |
| Opus 5.5 | low, medium |
| GPT-6.1-Sol | low, medium, high |

GPT-6.1 low suits ordinary work; medium suits more difficult work. Opus low/medium and GPT-6.1 high are available
for complex tasks as appropriate. Use the listed Sonnet levels where they fit. These are development workers,
not changes to the fixed product models in `RQW-review`. A pause of a named benchmark campaign pauses that
campaign only; it does not pause unrelated work or prohibit the currently authorized worker models.

## Sufficient proof, without idle reruns

- Choose checks for the changed behavior and claim. Inspect documentation and Pi sources where needed.
  Use deterministic tests for mechanics and actual model probes when the claim concerns model behavior.
  Do not burn tokens on live compaction when the owner requests documentation-only proof.
- Run existing relevant checks once, in the background where possible. Repeat after a relevant fix or a changed
  tested input, not merely for confidence, staging, a commit ID or a squash merge. Reuse valid evidence while the
  tested code, configuration and document contracts remain unchanged.
- Mac tests run locally, not on GitHub. Windows tests run on GitHub in the background while independent work goes
  on, including relevant Node, Bun and PortableGit coverage. Linux is out of scope.
- Use a focused test command for a focused change; use `npm test` locally when the affected surface requires the
  full suite. Run `npm run test:bun` when Bun/codemode behavior is affected. Test extension isolation when affected.
- Root documentation, notes and development instructions alone do not justify application tests or model runs.
  A workflow change does require validating its triggers and affected Windows jobs. Manually dispatch CI when
  branch evidence does not cover the current merge result. Do not claim a queued or incomplete run passed.
- Fix failures caused by the task, including assertions for deliberately changed behavior. Report unrelated failures
  without repairing them or falsely counting a failing required check as clean. If they block delivery, ask the owner.
- For prompt/tool behavior performance claims, compare against the relevant baseline. The product goal remains
  my-pi better than stock Pi and Pi plus our prompt; do not launch a full benchmark for every unrelated edit.

## Independent review

- Review is proportional. Mechanical point corrections with no new decision need no review. Small work, at most
  five requirements and five changed files, uses `review` level `blind`; larger work uses `high`. An answer or report
  without changes needs no review. Explicit owner requirements for a review take precedence.
- Main first inspects and fixes its own work. The final independent result review checks agreed completeness,
  consistency, documentation and absence of unagreed additions. Give the reviewer the agreement verbatim, object,
  diff and sources, criterion and earlier rejected findings with reasons. Each pass returns all real findings at once.
- When code changes, run a separate read-only code reviewer in parallel with result review. Read
  `.agents/reviewers/code.md` and pass it as the complete `system` to an `agent` worker, choosing its model and
  reasoning from the table above. Its task brief includes the changed files, diff, callers, relevant tests and evidence.
  This role checks bugs, regressions and meaningful code quality, not a second requirements ritual. Do not spawn
  a code reviewer for prose-only changes. Workflow logic is executable configuration and needs code review too.
- Admit real evidenced defects, not taste or unlikely hypotheticals. Check findings rather than accepting them
  just because a quote exists. Fix admitted findings in one batch; explain rejected ones with evidence. Recheck
  affected parts and checks, not untouched parts. Reuse valid CLEAN results. Stop when the required reviews are
  clean; do not invent either a one-pass cap that leaves known bugs or endless fresh passes for confidence.
- A finished substage handed over separately gets its own blind independent check. Internal draft/stage commits
  are not handovers and do not create an automatic review gate. Reuse its valid coverage in final review.

## Delivery

1. Update the affected documentation with the code. Record accepted decisions in `DECISIONS.md` with the owner's
   quote, reason and carrier; keep each rule in one place and link to it elsewhere. Current docs describe current
   facts, not a history ledger. Remove obsolete current instructions, retain deferred work as deferred.
2. Push the task branch to start affected Windows CI early; continue independent work while it runs. Before merging,
   require sufficient proof and the required clean reviews for the actual final tree. A changed base invalidates
   only evidence whose checked inputs or dependent behavior changed.
3. Squash merge into `main`: one task, one commit. Never merge the task's stage commits into main as a merge commit.
   Push main autonomously. The workflow reuses task-branch proof rather than automatically retesting the same tree
   after squash; dispatch it explicitly if the merge changes checked inputs.
4. Update the locally installed Pi when a runtime/package change requires it, preserving auth and other settings;
   restart when process-wide patches require it. Documentation-only work needs no package update or restart.
5. After successful delivery, remove this task's worktree and branch. Do not clean up other tasks' worktrees.
   Publishing a release or Marketplace version requires the owner's direct request.
6. Report the result once, with necessary checks, any real limitation and manual commands only when useful.

## Communication and continuity

Always answer in Russian, with the main point first. At most three paragraphs of at most two lines each unless
content genuinely requires expansion. No repeated waiting messages or lists of unfinished work. During execution,
ask only about a real blocker needing the owner; answer direct questions and requested status, then continue.
Reports and questions do not stop independent background workers or checks.

After compaction, a model switch or a handoff, reload this procedure and recover the actual agreement and evidence
from their sources before continuing. Do not substitute an unaccepted agent plan for the owner's words.
