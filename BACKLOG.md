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
| 14 | <a id="wish-audit"></a>WISH-AUDIT: the owner's cumulative wish list over the whole history, each wish in its latest form, then a read-only audit skill that checks my-pi against it. 2 SP (list 1, skill 1). | DONE 2026-11-02; awaits the owner's word on the not-met wishes. The owner delegated the agreement to a verified list (`[D-WORK-WISH-AUDIT]`). List: `my-pi-evidence/designs/wish-audit/WISHES.md`, 554 in force and 61 cancelled, built from `wishes.json` by `build.py`; blind high review (`bossy`) CLEAN in round 2. Skill: `.agents/skills/wish-audit/`, `bossy` CLEAN in round 3. Audit of `origin/main` `1e5ec30e`: `my-pi-evidence/designs/wish-audit/AUDIT.md`, met 506, not met 17, unclear 31. No branch. | Owner `2e083480`: «спроектируй ахуенное решение скилл аудита нашего mypi харнеса что он отвечает всем моим хотелкам» … «Но прежде чем собирать его надо согласовать их»; `708511ba` «1»; `dd655d34` «1»; `fcdc4d6f`: «НЕНЕ НИХУЯ я не буду ниче считать собери сам и проверь все чере»; `5ee0f652`: «Это должн быть не просто список, а куммулятивный список требований за все время с учетом всех корректировок исправлений и передумок»; `099bfbf7`: «проверенный хай ревьюером в цикле проверок слепых»; `814b64c9`: «про цикл слепых хай ревью я имел ввиду хай ревьюера». |
| 15 | <a id="wait-answer-autowake"></a>WAIT-ANSWER-AUTOWAKE: remove the `wait_answer` tool of RQW-tabs-link and deliver the other chat's answer through the common automatic wake-up, like agent and job results. | QUEUED for the future; no branch. Owner expects it is not trivial; design first. | Owner (2026-11-02): «Так, ну давай принимаем обе, оставляем. Пусть будет потом в этот самый в клод закиньте удачу на будущее, на удаление Wait Ansfera и перевод его на общий этот самый автовейкап, который у нас есть. уже сейчас там наверное это не тривиальная задача» |
| 16 | <a id="old-queue-review"></a>OLD-QUEUE-REVIEW: review every conserved old-queue item after all other current work is done. | PERMANENTLY LAST while the old queue is nonempty. New tasks always insert before this row. Remove only when the old queue is empty; otherwise retain/reappend last. Never resurrect completed work. | Owner line 13441, entry `59a789ef`. |

## Conserved old queue

These items are conserved for item-by-item review only after every current queue item above is complete. They are not
resumed by old priorities, branch readiness, CI state or earlier deferral exceptions.

### Conserved deferred items

Every row below is conserved outside the current queue until OLD-QUEUE-REVIEW. Earlier task-specific deferrals and
prerequisite constraints remain evidence; prerequisite delivery never starts a held task.

| ID | Work | Status/branch | Source |
| --- | --- | --- | --- |
| <a id="subagent-mode-rework"></a>SUBAGENT-MODE-REWORK | Redesign subagent mode as a separate task later. | DEFERRED / ON HOLD, no branch. | Owner `0416ea23`: «мы потом отдельной задачей перепроектируем наш режим саб-агентов»; «Сейчас он out of scope»; wish 159. Kept for the future review (2026-11-02): Main asked «Новый режим агентов и ловушки затрат: 1. Оставить оба на будущий разбор. 2. Выбросить оба. 3. Начать исследование ловушек сейчас.»; owner: «1» |
| <a id="timebox-practices"></a>TIMEBOX-PRACTICES | Professional-practices research; automatic child progress notifications are governed by [D-AGENT-PROGRESS](DECISIONS.md#agent), not open work here. Research, a record only, not started: how practising professional engineers avoid sunk cost, experiment loops, runaway cost and over-testing. Credible primary sources, found with the shipped `web` tool ([D-WEB-CLI](DECISIONS.md#web-search)). Output: a short evidence-based proposal of timeboxing, stop criteria, uncertainty spikes, cost versus information, escalation and minimal acceptance checks, adapted to this repository. Not an open-ended benchmark. Current execution rules: [PROCESS.md](PROCESS.md). | DEFERRED / ON HOLD by owner, no branch; do not start. Blocked by: none; the web tool is delivered. The owner has not set its place in a resumed execution order. | Owner `16-27-59:5231`, entry `ce0d83d8`: «Надо понять, как их избегать, как не попадать в такие ловушки. Надо поресёрчить, как люди с этим справляются уже — реальные программисты, реальные профессионалы. Это просто как web search работать»; wish 550. Kept for the future review (2026-11-02): Main asked «Новый режим агентов и ловушки затрат: 1. Оставить оба на будущий разбор. 2. Выбросить оба. 3. Начать исследование ловушек сейчас.»; owner: «1» |
| <a id="codex-changelog"></a>CODEX-CHANGELOG | Adopt selected findings from the [Codex changelog report](../my-pi-evidence/codex-changelog/REPORT.md). | DEFERRED / ON HOLD until the owner explicitly resumes it; no adoption or implementation queued; no branch. | Owner `16-27-59:4937`, entry `a8684155`; report linked here. |
| <a id="i05"></a>I05 | `custom`, `define-goal` and work orders. Task list is [U14](#u14). | DEFERRED / ON HOLD, coordinator record of owner deferral; no authenticated quote supplied. Not abolished; no new implementation permission or branch. | [D-SCOPE-POSTPONED](DECISIONS.md#scope); [HISTORY](../my-pi-evidence/session-history/FINAL-PLAN.md) B4 |
| <a id="history-search"></a>HISTORY-SEARCH | Tools to search old branch messages after compaction (5 SP as designed, needs a split). | DEFERRED / ON HOLD, no branch; do not start. | Owner order to keep it; design: [design-words-4 node 1](file:///Users/arkadijcukavin/Downloads/design-words-4.html). |
| <a id="native-code-search"></a>NATIVE-CODE-SEARCH | Discussion of native code-search tools with the owner. | DEFERRED / ON HOLD; talk first, no branch, no code. | Owner `2f0fd4cd`: «мы с тобой обсуждать это отдельно будем»; research [REPORT.md](file:///Users/arkadijcukavin/ai-project/my-pi-evidence/native-tools-import/REPORT.md). |

## Current design details

### AGENT-STATES-UI details

<a id="agent-states-ui"></a>AGENT-STATES-UI is delivered in [D-STATUSBAR-WAITS](DECISIONS.md#status-bar): the waiting
wording, the child process count and the idle-agent count line. The sources below are retained as the owner's
verbatim record. Delivery does not resume other held UI work.

Owner sources in session `2026-10-21T16-27-59-062Z_01a15f4a-7ad5-7377-81be-0baf3b6ffa33.jsonl`:
`16-27-59:5085`, entry `04f64a5e`: «Если у нас какие-то агенты в афк стоят, то они не должны отображаться, как будто они рабочие и их ожидание происходит.»
`16-27-59:5087`, entry `ddd0ce47`: «И да, интерфейс должен разключать, когда агент стоит, когда он AFK, когда он работает.»
`16-27-59:6301`, entry `a8793e4c`: «строка статуса должна отражать все фоновые ожидания. Не только саб-агентов, которые работают, но и если саб-агент ожидает какой-то фоновый процесс, они тоже должны отображаться в строке статусов».
`16-27-59:6305`, entry `217beed6`: «Если агент think-ает основной, что-то делает, то это отражается в статусе. Если же он ничего не делает, но он ожидает саб-агентов какие-то, background процессы, это тоже должно отражаться. Есть саб-агенты, а есть background процессы. Worker там быть не должно, мы вообще worker удалили.»
