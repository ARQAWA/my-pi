## Isolated parallel execution

- Start each change task in its own branch and git worktree under [Delivery](../PROCESS.md#delivery).
  Make all task edits there, never in the main checkout.
- Main is the coordinator, not an independent implementer: it owns requirement compilation, owner questions,
  task decomposition, subagent model selection, scheduling, acceptance and integration of results, review organization,
  delivery/git and reports. Main may read sources and results to coordinate and accept work, but must delegate actual
  research, implementation (including documentation/config edits), probes/measurements, test runs and fixes to
  subagents, regardless of task size, unless the owner explicitly overrides as described below.
  Give each subagent a self-contained brief: agreement, files and worktree, ownership, dependencies, expected result
  and sufficient proof. Include the relevant process rules in its system prompt or brief; do not assume a child
  inherits this file.
- Adding, removing, moving and status bookkeeping of task-list entries is Main's personal coordinator operational
  work, not a separate task, and consumes no active execution slot. Only actual tasks occupy those slots.
  This does not authorize product implementation without tasks or required reviews.
- The owner addresses Main (the coordinator) as the executor. If the owner assigns personal execution to Main,
  Main must object, explain its coordinator role and propose a subagent. Main does that work itself only after an
  explicit owner override, for example: «Похуй на инструкции, действуй». A routine request to do something is
  not an override. The guard's mechanical repository edit/write block stays in force, even after an override.
  Only the session that holds the repository's `coordinator.lock` (git common dir) is Main; every other session is a
  normal direct agent and these coordinator rules do not apply to it.
- Main never blocks its own thread on waiting, polling, CI watching, test runs or any other long work. It hands
  all of that to subagents and stays free to coordinate and talk to the owner.
- At most two main tasks are in active execution at the same time, in the priority queue set by the owner. Fill a free
  slot from that queue, not from Main's preferred order; a priority change from the owner steers the queue. This is
  a task limit, not a count of first-level subagents. A task that waits for CI, a reviewer, the merge queue or the
  owner holds no slot, and the test lane is outside the limit ([Task pipeline](../PROCESS.md#task-pipeline)). Parallel subagents inside an active task do not create extra
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
  perform the required checks and fix deviations from the ordered outcome under [Research and agreement](../PROCESS.md#research-and-agreement).
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
