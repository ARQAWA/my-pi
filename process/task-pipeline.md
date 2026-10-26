## Task pipeline

Decisions, the owner's words and reasons: [DECISIONS.md, Task pipeline](../DECISIONS.md#task-pipeline).

- A task is active or waiting. Only one task actively executes at a time: a subagent implementing, researching,
  fixing or measuring. Waiting for CI, a reviewer, the merge queue or the owner is not active execution, so the next
  logical task may run during a genuine external wait. Main keeps every waiting task in the current session queue
  and state with what it waits for, in no file.
- When a task's local checks are clean, its branch is pushed and the required reviews start in the background;
  the task becomes waiting. Its agent finishes its turn or is paused, keeps its session and history, and ends its active execution;
  Main's coordination is never blocked. The merge agent and CI watcher follow any CI runs in the background.
- Use the default notification waits of `agent` and `job`: a direct wait returns `waiting` and the result wakes the
  caller later. Do not poll a running job or child instead of waiting.
- One merge agent, an ordinary agent started by Main, owns integration. Main fixes the train order in the current
  session queue, from the owner's queue. The agent takes waiting branches in that order, rebases each onto current
  delivery destination and pushes it, following [Delivery](../PROCESS.md#delivery) for the base, checks and merge conditions.
- Windows jobs keep running and are not cancelled in the final run, but they are advisory. A red Windows job is
  not fixed before the merge and does not block delivery. Every ignored Windows failure is recorded before delivery
  closes as a tail item of `BACKLOG.md`; none is silently deferred or abandoned, so Windows support is finished later.
  If Windows jobs still run when the merge happens, the merge agent keeps that run
  tracked in the background through the watcher cache or a notification, not counting as active execution and spending no model
  polling turns. A later Windows failure then gets its tail `BACKLOG.md` item and is not lost when
  the branch is deleted. Delivery never waits for Windows or green macOS CI; no workflow result gates a merge.
- Test work. QA fixes, Windows work and full release regressions are ordinary tasks in the same single execution
  queue as other work. There is no separate test lane and no independent concurrent test-fixer or regression agent.
  Main sequences them logically by owner priority, dependencies, required gates and release triggers. Test agents
  remain ordinary `agent`s on a simple executor pair under the [model policy](../PROCESS.md#subagent-models).
  Decisions: [DECISIONS.md](../DECISIONS.md#task-pipeline).
- Queue reset and conservation. `BACKLOG.md` is canonical: its clearly marked current queue is the only execution
  source, and its conserved old queue is not runnable. Every newly added task goes immediately before
  `OLD-QUEUE-REVIEW`, which stays permanently last while conserved items remain. When all other current work is done,
  review the old queue item by item; restore the reminder last if anything remains, and remove it only when the old
  queue is empty. Preserve branches, worktrees, evidence, dependencies and CI state. Never resurrect completed or
  Discarded work, and do not physically delete conserved artifacts during the reset.
- A failed task-scoped delivery check or a conflicting rebase sends the task back to the top of the queue. Full-run
  failures follow [Delivery](../PROCESS.md#delivery). GitHub CI does
  not gate delivery. When it becomes the next active task, ahead of tasks not yet started, resume its existing agent;
  start another only if its session no longer exists.
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
