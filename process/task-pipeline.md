## Task pipeline

Decisions, the owner's words and reasons: [DECISIONS.md, Task pipeline](../DECISIONS.md#task-pipeline).

- A task is active or waiting. Only active execution holds one of the six slots: a subagent implementing,
  researching, fixing or measuring. Waiting for CI, a reviewer, the merge queue or the owner holds no slot. Main
  fills each free slot from the owner's queue and keeps every waiting task in the current session queue and state with what it waits for, in no file.
- When a task's local checks are clean, its branch is pushed and the required reviews start in the background;
  the task becomes waiting. Its agent finishes its turn or is paused, keeps its session and history, and frees the slot;
  Main's coordination is never blocked. The merge agent and CI watcher follow any CI runs in the background.
- Use the default notification waits of `agent` and `job`: a direct wait returns `waiting` and the result wakes the
  caller later. Neither tool has an explicit held-wait option. Remaining blocking paths are deferred by the owner,
  not fixed by this rule; see `DECISIONS.md`, `[D-TOOLS-NO-BLOCKING-FLAG]`.
- One merge agent, an ordinary agent started by Main, owns integration. Main fixes the train order in the current
  session queue, from the owner's queue. The agent takes waiting branches in that order, rebases each onto current
  delivery destination and pushes it, following [Delivery](../PROCESS.md#delivery) for the base, checks and merge conditions.
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
- Test lane. Besides the six main work lanes, a separate lane for tests only, outside the six active slots, owns all
  test work: ordinary `agent`s on the simple GPT pair of the [subagent table](../PROCESS.md#subagent-models), with
  `.agents/roles/test-fixer.md` as the `role`. It starts only after this pipeline change is delivered and follows all
  pipeline agreements. Decisions: [DECISIONS.md](../DECISIONS.md#task-pipeline).
- A failed task-scoped delivery check or a conflicting rebase sends the task back to the top of the queue. Full-run
  failures follow [Delivery](../PROCESS.md#delivery). GitHub CI does
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
