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
| 14 | <a id="wish-audit"></a>WISH-AUDIT: the owner's cumulative wish list over the whole history, each wish in its latest form, then a read-only audit skill that checks my-pi against it. 2 SP (list 1, skill 1). | DONE 2026-11-02; awaits the owner's word on the not-met wishes. The owner delegated the agreement to a verified list (`[D-WORK-WISH-AUDIT]`). List: `my-pi-evidence/designs/wish-audit/WISHES.md`, 554 in force and 61 cancelled, built from `wishes.json` by `build.py`; blind high review (`bossy`) CLEAN in round 2. Skill: `.agents/skills/wish-audit/`, `bossy` CLEAN in round 3. Audit of `origin/main` `1e5ec30e`: `my-pi-evidence/designs/wish-audit/AUDIT.md`, met 457, not met 49, unclear 42, cancelled 6; updated in place 2026-11-02; owner: «следующего аудита не будет». No branch. | Owner `2e083480`: «спроектируй ахуенное решение скилл аудита нашего mypi харнеса что он отвечает всем моим хотелкам» … «Но прежде чем собирать его надо согласовать их»; `708511ba` «1»; `dd655d34` «1»; `fcdc4d6f`: «НЕНЕ НИХУЯ я не буду ниче считать собери сам и проверь все чере»; `5ee0f652`: «Это должн быть не просто список, а куммулятивный список требований за все время с учетом всех корректировок исправлений и передумок»; `099bfbf7`: «проверенный хай ревьюером в цикле проверок слепых»; `814b64c9`: «про цикл слепых хай ревью я имел ввиду хай ревьюера». |
| 16 | <a id="timebox-practices"></a>TIMEBOX-PRACTICES: Professional-practices research; automatic child progress notifications are governed by [D-AGENT-PROGRESS](DECISIONS.md#agent), not open work here. Research completed, a record only: how practising professional engineers avoid sunk cost, experiment loops, runaway cost and over-testing. Credible primary sources, found with the shipped `web` tool ([D-WEB-CLI](DECISIONS.md#web-search)). Output: a short evidence-based proposal of timeboxing, stop criteria, uncertainty spikes, cost versus information, escalation and minimal acceptance checks, adapted to this repository. Not an open-ended benchmark. Current execution rules: [PROCESS.md](PROCESS.md). | DONE research 2026-11-02; proposal diffs `/Users/arkadijcukavin/Downloads/timebox-rules-diff.html` awaited the junk investigation and now await the owner's decision. Blocked by: JUNK-ORIGIN-AUDIT, fulfilled 2026-11-03. Investigation delivered and opened: `/Users/arkadijcukavin/Downloads/junk-origin-report.html`. Final source-based plan: 60 SP, correcting disclosed 8/16 SP underestimates. Selfcheck plus blind CLEAN in 2 rounds; bossy CLEAN in 2 rounds, including one corrected omission about surviving nested cleanup orphans. Four general process paths remain open, known shipped testreview path closed. Diffs 1-5: CHANGE each, recommendation only; none independently closes the open paths. Evidence: `my-pi-evidence/designs/junk-origin/PLAN.md`, `SELFCHECK.md`, `HIGHREVIEW.md`, `27-timebox-decisions.md`. Completed JUNK-ORIGIN-AUDIT row removed under the open-queue rule; no product or rule fixes. Output: `/Users/arkadijcukavin/Downloads/timebox-practices.html`, one standalone evidence map and repository-specific proposal. No branch, code or rules changed. Approved design: `/Users/arkadijcukavin/Downloads/timebox-practices-design.html`, 3 SP (evidence 2, proposal 1). Owner approval 2026-11-02: «так блять я думал ты уже делаешь) делай конечно», answering «запускать исследование на 3 SP? 1. да, запускай.» Selfcheck fork: blind CLEAN in 1 round; high CLEAN in 2 rounds. Text only: sources, quotes and links checked; no runs or CI. | Owner `16-27-59:5231`, entry `ce0d83d8`: «Надо понять, как их избегать, как не попадать в такие ловушки. Надо поресёрчить, как люди с этим справляются уже — реальные программисты, реальные профессионалы. Это просто как web search работать»; wish 550. Kept for the future review (2026-11-02): Main asked «Новый режим агентов и ловушки затрат: 1. Оставить оба на будущий разбор. 2. Выбросить оба. 3. Начать исследование ловушек сейчас.»; owner: «1». Design ordered (2026-11-02): «ловушки затра запускай в работу дизайнером». Dependency ordered 2026-11-03, verbatim: «ловушки затрат зависят от расследования мусора». |
| 17 | <a id="codex-tokens"></a>CODEX-TOKENS: read-only investigation of why `openai-codex` chats fill the context and compact faster than `anthropic` ones. Check our usage mapping, window, threshold and status bar against Codex CLI 0.163.0, check the Claude bar, compare real session usage. No code changes; a fix only as a proposal with SP. 6 SP, first estimate 5 (counting and limits 2, request payload against Codex CLI 2, session data and report 2). | DONE 2026-11-03; awaits the owner's choice of fixes. The owner approved the 6 SP plan, verbatim «1», answering «что дальше? 1. делать полный разбор на 6 SP. 2. сразу чинить фоновое сжатие. 3. пока ничего.». Findings: ordinary counting has no double count, same quantity as Codex CLI `total_tokens`; early compaction near 340k instead of 450k comes from the 65% background summary for both providers (since `6311bd5e`); in main chats Codex is not faster, subagents grow about 3x faster per minute from tool output; our Sol/Terra window 500k is larger than CLI's 272k; the bar is accurate (median error about 0) but divides by 450k; the Claude mapping is correct, Claude Code excludes output and divides by 1M; payload close to a Codex desktop sample; Codex-style output truncation would save about 2%; a rare retry-usage bug in `RQW-codex/streaming.ts`. Proposed fixes, not started: background start 80% 0 SP (recommended), bar mark for background compaction 1 SP, retry usage 2 SP, output truncation 1 SP. Report `/Users/arkadijcukavin/Downloads/codex-tokens-report.html`, spotty CLEAN in round 2, opened. Evidence: `my-pi-evidence/designs/codex-tokens/` (PLAN, COUNTING, PAYLOAD, PRELIMINARY, data_rates.py and .out). No branch. | Owner 2026-11-03, verbatim: «Так, теперь отдельная сайт задача. Смотри, я когда работаю с чатом GPT, в нашем Пишке-агенте, я вижу, что прям как будто бы очень быстро кончаются токены и компакшен очень частый в чате GPT. И мне кажется, что проблема заключается в том, что у нас в чате GPT, когда мы юзаем кодекс провайдер, у нас ху<unk>во считаются токены. Надо в этом разобраться и сравнить токенайзер наш. в пишке наших кастом написаны с кодекс CLI, потому что ну вроде транспорт одинаковый, а вот как токены считаются большие вопросы у меня к этому, блядь, потому что ну типа в этом в клод-коде токены едут очень медленно, прям очень медленно тратится контекстное окно, а в чате GPT очень быстро, и мне кажется, в реальном чате GPT, если на работе очень немного так быстро, токены не тратятся. Надо с этим разобраться, и надо также выяснить, как именно тратятся токены реально в кодекс правильно ли клод-коде токены считаются в баре в прогресс-барре токенов.» |

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

## U14 details

<a id="u14"></a><a id="todo-panel"></a>U14 is delivered in [D-TODO-PANEL](DECISIONS.md#todo-panel). This original specification is retained as the owner's verbatim source. The choices described below as open were subsequently resolved in that decision.

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
