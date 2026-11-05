# Open and deferred work

This is the canonical task list. Keep source, status and branch with every item. Remove completed and dropped tasks.
Git and `DECISIONS-ARCHIVE.md` preserve task history. Accepted limits and unverified live behavior stay in
`DECISIONS.md` or their research note unless there is actual remaining work.

Sources: docs-cleanup `AUDIT.md` section 5 and `parts/backlog.md`, outside the repository under
`/Users/arkadijcukavin/ai-project/my-pi-evidence/docs-cleanup/`. IDs below remain stable. `handoff` and `completeness`
mean the source documents identified by that audit. Historical branch snapshots are not claims of current
remote state or runtime activation. Explicit later owner decisions and task-specific integration status take
precedence over those snapshots. Descriptions are coordinator summaries unless explicitly marked as verbatim owner quotations.
Deferred rows explicitly identify coordinator records of deferral where no authenticated verbatim owner message
is supplied.

Queue reset and conservation follow the owner sources in the current queue below.
Only the current queue below is runnable. One branch and worktree per task; the owner's branch rule
(`16-27-59:13774`): «В любом случае для каждой задачи нужно делать отдельную ветку.»
The conserved old queue is evidence for later item-by-item review, not an alternate execution lane.
Completed work is never queued again. Every newly added task goes immediately before `OLD-QUEUE-REVIEW`.
The reminder stays permanently last until the old queue is empty; it remains or reappears last whenever anything remains.

## Current queue

| # | ID and approved work | Status, branch and dependencies | Source |
| --- | --- | --- | --- |
| 19 | <a id="subagent-review-parity"></a>SUBAGENT-REVIEW-PARITY: полноценные саб-агенты и правдивый вход ревьюера. Итого 16 SP. | In Progress; осталась только RV2, ждёт обсуждения владельца о benchmark. Ветка записей `records/srp-tail-20261104`. | [Итоговый план](http://127.0.0.1:6421/evidence/joint-consensus/FINAL.md); [отчёт](http://127.0.0.1:6421/reports/subagent-reviewer-final-plan.html); приёмка и источники: `/Users/arkadijcukavin/ai-project/my-pi-evidence/designs/joint-consensus/acceptance/ACCEPTANCE.md`. |

## Current design details

### SUBAGENT-REVIEW-PARITY details

Родитель In Progress. Осталась только RV2, ожидает обсуждения владельца о benchmark. План, исходные критерии, цитаты и выбранные границы сохранены в [FINAL.md](http://127.0.0.1:6421/evidence/joint-consensus/FINAL.md). Приёмка и подтверждения: `/Users/arkadijcukavin/ai-project/my-pi-evidence/designs/joint-consensus/acceptance/ACCEPTANCE.md`.

### AGENT-STATES-UI details

<a id="agent-states-ui"></a>AGENT-STATES-UI is delivered in [D-STATUSBAR-WAITS](DECISIONS.md#status-bar): the waiting
wording, the child process count and the idle-agent count line. The sources below are retained as the owner's
verbatim record. Delivery does not resume other held UI work.

Owner sources in session `2026-10-21T16-27-59-062Z_01a15f4a-7ad5-7377-81be-0baf3b6ffa33.jsonl`:
`16-27-59:5085`, entry `04f64a5e`: «Если у нас какие-то агенты в афк стоят, то они не должны отображаться, как будто они рабочие и их ожидание происходит.»
`16-27-59:5087`, entry `ddd0ce47`: «И да, интерфейс должен разключать, когда агент стоит, когда он AFK, когда он работает.»
`16-27-59:6301`, entry `a8793e4c`: «строка статуса должна отражать все фоновые ожидания. Не только саб-агентов, которые работают, но и если саб-агент ожидает какой-то фоновый процесс, они тоже должны отображаться в строке статусов».
`16-27-59:6305`, entry `217beed6`: «Если агент think-ает основной, что-то делает, то это отражается в статусе. Если же он ничего не делает, но он ожидает саб-агентов какие-то, background процессы, это тоже должно отражаться. Есть саб-агенты, а есть background процессы. Worker там быть не должно, мы вообще worker удалили.»
