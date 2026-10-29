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
| 8 | <a id="composer-predictions"></a>COMPOSER-PREDICTIONS: gray next-message suggestion in the empty input, Tab accepts. | QUEUED; implementation must be discussed before code. The [draft reference](file:///Users/arkadijcukavin/ai-project/my-pi-evidence/composer-predictions/DRAFT-TZ.md) is discussion material, not an agreed specification. | Owner line 13428; original request: «Эту хуйню в soft complete надо добавить в задачу, но обсудить, как она будет у нас имплементирована. Это просто рандомный агент написал текст задачи. Это не сама задача, это на подумать.» |
| 9 | <a id="agent-states-ui"></a>AGENT-STATES-UI and <a id="u14"></a><a id="todo-panel"></a>U14 / TODO-PANEL: retain the agent-list states and the todo working-memory/panel requirements with all existing design questions. | QUEUED; no implementation branch. Existing requirements and unresolved design choices remain in [current design details](#current-design-details). | Owner line 13422 explicitly keeps Agent list, todo panel; earlier owner sources below. |
| 10 | <a id="a01"></a>A01: remaining scoped Codex-style child capabilities: parent-history fork and MCP, for later design. | QUEUED; no blanket Codex CLI parity and no implementation before design. Durable resume and child web access are already delivered and are not queued again. | Owner line 13422 keeps new Codex capabilities; Backlog A01 and [RQW-agent persistence](extensions/RQW-agent/README.md#persistence-and-resume). |
| 11 | <a id="copy-measure"></a>COPY-MEASURE: on or after 2026-11-01 re-run the `my-pi-evidence/designs/copy-not-retype/measure` script and compare with the baseline; report to the owner. | QUEUED; no branch. Checks whether agents follow the copy-not-retype rule in `SYSTEM.md`. | Owner: «Надо понять, как мы это потом проверим, замерим через два-три дня работы, допустим»; [D-PROMPT-COPY-NOT-RETYPE](DECISIONS.md). |
| 12 | <a id="old-queue-review"></a>OLD-QUEUE-REVIEW: review every conserved old-queue item after all other current work is done. | PERMANENTLY LAST while the old queue is nonempty. New tasks always insert before this row. Remove only when the old queue is empty; otherwise retain/reappend last. Never resurrect completed work. | Owner line 13441, entry `59a789ef`. |

### Research pocket: after the plan and its execution

**Not current work.** These investigations start immediately after the plan is written **and executed**, not merely
after it is saved. They are outside both queues, do not move OLD-QUEUE-REVIEW earlier, authorize no runtime changes
and permit no settings or auth edits during research. Quotes are verbatim from the owner text supplied on
2026-10-27; ellipses in the quotations denote unavailable text, not reconstructed wording.

- **RP3 — Instant message display and planning status.** Owner: «У меня бывает такое, что я отправляю сообщение для Claude, для Codex или для Kimi, и оно подвисает на несколько секунд. … Хотя оно должно выглядеть моментально: что моментально появилось сообщение, моментально пошло planning next moves, а под капотом оно всё работает уже само. Не должно быть этой синхронизации интерфейса с under the hood обработками, процессингом.» Investigate submit-to-visible-message and submit-to-working-status separately from model latency. Docs only, no Pi install during research.

## Conserved old queue

These items are conserved for item-by-item review only after every current queue item above is complete. They are not
resumed by old priorities, branch readiness, CI state or earlier deferral exceptions.

### Conserved prepared branches and evidence

| ID | Conserved state | Source |
| --- | --- | --- |
| WAIT-RESULT-METADATA | Branch `fix-agent-wait-result-metadata`, head `e0aaa0aed4f5db25a6c1b7bb495b23e8dea80511`, existing worktree. Prepared wait metadata remains unmerged and is not current work. | Owner conservation order; branch and worktree evidence. |

### Conserved active and near queue

These former active and near-queue items are conserved, not runnable. Their branch, evidence and dependency states
remain unchanged until OLD-QUEUE-REVIEW.

| ID | Work | Status/branch | Source |
| --- | --- | --- | --- |
| <a id="u13"></a>U13 / U18 | Remaining physical-terminal appearance verification only: actual display/font rendering and perceived animation smoothness. | Physical checks NOT PERFORMED; no implementation branch. Automated P11/U13 scope is delivered; this does not resume unrelated held UI work. | Backlog U13/U18; handoff 30/49-50/100; completeness 55; UI execution brief P11 T19 and evidence limits G8; explicit P11 resumption. |

### Conserved deferred items

Every row below is conserved outside the current queue until OLD-QUEUE-REVIEW. Earlier task-specific deferrals and
prerequisite constraints remain evidence; prerequisite delivery never starts a held task.

| ID | Work | Status/branch | Source |
| --- | --- | --- | --- |
| <a id="timebox-practices"></a>TIMEBOX-PRACTICES | Remaining professional-practices research and deferred blocking paths; automatic child progress notifications are governed by [D-AGENT-PROGRESS](DECISIONS.md#agent), not open work here. Research, a record only, not started: how practising professional engineers avoid sunk cost, experiment loops, runaway cost and over-testing. Credible primary sources, found with the shipped `web` tool ([D-WEB-CLI](DECISIONS.md#web-search)). Output: a short evidence-based proposal of timeboxing, stop criteria, uncertainty spikes, cost versus information, escalation and minimal acceptance checks, adapted to this repository. Not an open-ended benchmark. Include the three remaining blocking paths deferred by the owner in the historical record, commit `5f96a70`: the shared agent operation queue with long `start`/`restart`/`resume` calls, waits inside codemode scripts, and the external print/json host path. Current execution rules: [PROCESS.md](PROCESS.md). | DEFERRED / ON HOLD by owner, no branch; do not start. Blocked by: none; the web tool is delivered. The owner has not set its place in a resumed execution order. | Owner `16-27-59:5231`, entry `ce0d83d8`: «Надо понять, как их избегать, как не попадать в такие ловушки. Надо поресёрчить, как люди с этим справляются уже — реальные программисты, реальные профессионалы. Это просто как web search работать» |
| <a id="codex-changelog"></a>CODEX-CHANGELOG | Adopt selected findings from the [Codex changelog report](../my-pi-evidence/codex-changelog/REPORT.md). | DEFERRED / ON HOLD until the owner explicitly resumes it; no adoption or implementation queued; no branch. | Owner `16-27-59:4937`, entry `a8684155`; report linked here. |
| <a id="i05"></a>I05 | `custom`, `define-goal` and work orders. Task list is [U14](#u14). | DEFERRED / ON HOLD, coordinator record of owner deferral; no authenticated quote supplied. Not abolished; no new implementation permission or branch. | Backlog I05; active `D-SCOPE-POSTPONED`; DECISIONS Scope postponed-items entry. |

## Current design details

### AGENT-STATES-UI details

Agent-list and card-state work is current queue item 9, with no implementation branch. Preserve the working, waiting
and fully idle or AFK distinction. A fully idle or AFK agent with no pending waits must never look active or waiting.
Reviewer profiles are ordinary agents, not a separate category; no worker category exists. Statusbar completion does
not resume other held UI work. Its waiting contract is delivered in [D-STATUSBAR-WAITS](DECISIONS.md#status-bar), not
queued again.

Owner sources in session `2026-10-21T16-27-59-062Z_01a15f4a-7ad5-7377-81be-0baf3b6ffa33.jsonl`:
`16-27-59:5085`, entry `04f64a5e`: «Если у нас какие-то агенты в афк стоят, то они не должны отображаться, как будто они рабочие и их ожидание происходит.»
`16-27-59:5087`, entry `ddd0ce47`: «И да, интерфейс должен разключать, когда агент стоит, когда он AFK, когда он работает.»
`16-27-59:6301`, entry `a8793e4c`: «строка статуса должна отражать все фоновые ожидания. Не только саб-агентов, которые работают, но и если саб-агент ожидает какой-то фоновый процесс, они тоже должны отображаться в строке статусов».
`16-27-59:6305`, entry `217beed6`: «Если агент think-ает основной, что-то делает, то это отражается в статусе. Если же он ничего не делает, но он ожидает саб-агентов какие-то, background процессы, это тоже должно отражаться. Есть саб-агенты, а есть background процессы. Worker там быть не должно, мы вообще worker удалили.»

## U14 details

U14 owns this complete todo-list and panel specification as current queue item 9. Existing prerequisites and design questions remain; implementation still requires the agreed design. Open choices named in the text: skill name and activation duration; three-line layout with sub-steps; expand method and depth; behaviour on blocker, wait or cancel.

The owner text below is copied byte-for-byte from the USER entry after its first line, from the session file above.

````text
**Хочу сохранить на будущее полноценный список дел с компактной панелью над полем ввода.** Эта функциональность отложена до окончания текущих изменений интерфейса. Это описание желаемого поведения, а не поручение начинать реализацию.

## Зачем нужен список дел

Мне нужен список дел как рабочая память агента о моей задаче. Он должен помогать не забывать части запроса, не терять обязательства и не останавливаться на половине работы.

Это не декоративный план для пользователя и не отчёт, составленный задним числом. Агент действительно ведёт по нему работу. Список отражает то, что предстоит сделать, что происходит сейчас и что уже закончено.

Особенно важен этот механизм в длинных задачах. После сжатия контекста у агента должна сохраняться актуальная дорожная карта. Он не должен забывать незавершённые части запроса, повторять уже сделанное или считать задачу выполненной только потому, что потерял её подробности.

При этом мне не нужно постоянное навязывание планирования каждому разговору. Для простого вопроса список может быть лишним. Включение и выключение списка вместе со связанной проверкой завершения должно происходить через скилл. Название скилла и длительность такого включения пока не выбраны.

## Что должно быть в списке

Список должен описывать реальные действия понятными русскими словами. По названиям должно быть ясно, что агент собирается делать и что делает сейчас. Внутренние обозначения без понятного смысла для меня не подходят.

Нужно различать ещё не начатую работу, текущую работу, завершённые пункты и то, что больше не требуется. Если дальнейшей работе что-то мешает, это тоже должно быть видно. Препятствие или ожидание не должны выглядеть как успешное завершение.

У больших пунктов должны быть внутренние шаги. Одного пункта «реализация», который висит весь ход, недостаточно. Мне важно понимать, какая именно часть реализации сейчас выполняется.

Прогресс должен опираться на эти реальные подшаги. Это не произвольный процент и не полоска, которая движется просто потому, что прошло время. Он должен помогать понять положение работы внутри текущего пункта.

Список должен оставаться актуальным при изменении задачи. Новые обязательства не должны выпадать из него, а отменённая работа не должна продолжать числиться обязательной. Изменение списка должно отражать изменение самой работы, а не служить способом объявить незавершённое завершённым.

## Как агент должен его вести

Обслуживание списка не должно заметно тормозить полезную работу. Если одновременно поменялись несколько пунктов, агенту нужна возможность обновить их вместе. Отдельное обращение ради каждой отметки создаёт лишнюю задержку.

Не нужны отдельные модельные ходы только ради обслуживания плана. Нежелательна последовательность, когда агент сначала отдельно отмечает завершение пункта, потом отдельно переключает следующий и только после этого продолжает работу.

Особенно не нужен лишний круг в самом конце. Если работа уже сделана, закрытие списка не должно превращаться в отдельную затяжную процедуру перед ответом.

Но экономия времени не должна разрушать сам механизм. Нельзя оставить красивую панель, которой агент фактически не пользуется. Нельзя ускорить обслуживание ценой потери открытых обязательств после сжатия контекста.

## Компактная панель над вводом

Над полем ввода нужна компактная трёхстрочная панель задач. Она должна вписываться в минималистичный интерфейс и не превращать нижнюю часть экрана в большую таблицу.

В обычном состоянии мне не нужен весь план на десятки пунктов. Нужен небольшой актуальный участок, по которому понятно, где сейчас находится работа и что остаётся рядом с текущим шагом.

Когда агент продвигается по списку, видимая часть должна следовать за текущей работой. Панель не должна застывать на первых пунктах, пока агент уже выполняет что-то в конце.

Подшаги текущего пункта должны восприниматься как часть списка. Ранее мне хотелось видеть их непосредственно под текущей задачей, а не отдельным несвязанным индикатором. При этом точное сочетание трёх строк панели и отображения подшагов ещё не выбрано.

Панель должна появляться сразу после создания списка и обновляться сразу после его изменения. Мне не должно требоваться менять размер окна, переключаться куда-то или начинать новую сессию, чтобы увидеть уже произошедшее изменение.

Когда вся работа по списку закрыта, активная панель должна исчезать сразу. Завершённый список не должен продолжать висеть над вводом так, будто задача ещё выполняется.

## Подробности и история

Компактность панели не должна лишать меня подробностей. Нужна возможность раскрыть список и посмотреть его полное содержание, этапы и подпункты.

В обычном виде достаточно короткого представления. Когда мне нужно разобраться, я должен иметь доступ к более полной картине работы. Точный способ раскрытия и глубина показа пока не выбраны.

Исчезновение завершённого списка из активной панели не означает, что его подробности должны безвозвратно пропадать. Возможность вернуться к выполненному списку важна отдельно от необходимости постоянно держать его на экране.

При этом старые закрытые пункты не должны целиком занимать контекст агента при каждом следующем обращении. Для большого списка это особенно важно. Агенту нужна актуальная рабочая часть, а не постоянное повторение десятков уже законченных действий.

Завершённый список не должен оставаться в активной памяти как действующая задача. Доступность истории и наличие незаконченного обязательства должны различаться.

## Продолжение и завершение работы

Механика должна работать не только один раз в начале сессии. Не должно быть ситуации, когда агент хорошо повёл первый список, закрыл его и дальше перестал пользоваться этой возможностью.

При продолжении незавершённой работы должен сохраняться её актуальный список. При появлении новой работы после завершения старой должен появляться соответствующий ей список. Старый выполненный план не должен подменять новую задачу.

Со списком связана проверка перед завершением работы. Её смысл в том, чтобы агент не объявлял всё готовым, забыв об открытых частях запроса.

Окончание очередного сообщения само по себе не означает завершения задачи. Если обязательства остались, агент должен их учитывать, а не терять из-за перехода к финальному ответу.

Точное поведение при препятствии, ожидании внешнего события или отмене ещё не определено. Эта хотелка не означает запрета мне остановить агента и не означает, что он должен бесконечно продолжать работу, которую сейчас невозможно закончить.

В целом мне нужна одна согласованная функциональность: агент ведёт настоящий список, этот список помогает ему удерживать задачу, а я вижу то же актуальное состояние в интерфейсе. Ни панель без реальной механики, ни невидимый для меня список с устаревшим отображением не дают нужного результата.
````
