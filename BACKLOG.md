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
| 18 | <a id="plan-site"></a>PLAN-SITE: Backlog.md trial installed 2026-11-03, board `/Users/arkadijcukavin/ai-project/my-pi-board`; owner 2026-11-03, verbatim: «так давай для начала поставим просто бэклог и будем думать как че кого куда дальше, запустим и посмотрим». Read-only research of ready solutions for a local site with chat where the owner writes tasks, discusses plan and solution, plans the week, and the agent works only on what is planned and approved for the week, with a separate hotfix approval lane. Ready solution first (PROCESS.md rule 35); own code only with the owner's consent. 2 SP (parallel web research by four helpers 1, merge and report 1). | IN PROGRESS 2026-11-03: Backlog.md trial running, no decision yet. Research DONE (round 4, hard filter: the agent fully manages the board without the UI: create, status, title and description, notes, checklist or subtask, read); awaits the owner's yes on our part. Passed: Backlog.md, Lific, Vikunja, Kanboard, Kaneo, Beaver Backlog, kanban-lite, beads plus beads-ui; failed: Pine, Taskboard, Kanzo, git-bug, Fusion. Recommended again Backlog.md: all six operations by its own CLI, best progress view, Markdown in git so the VDI works offline; Lific is smaller (23 MB) but young and needs a server the VDI can reach; Beaver Backlog is lightest but shows no progress. Our part 3 SP unchanged. Report spotty CLEAN in round 2. Round 3 recommended: Backlog.md (MIT, 7.3k, v1.55.3 on 2026-10-23): one native executable about 101 MB, Markdown task files in git, local web board, CLI and official MCP; progress rings per task, milestone as the week; VDI uses git plus its own Windows exe. Our part 3 SP, not started, own code needs the owner's consent (rule 35): setup with statuses, week milestone, hotfix and hotfix-approved labels and an agent rule 1; Pi gate allowing work only on an approved task of this week or an approved hotfix and forbidding the agent to change approval fields 2. Runners-up: Lific (Apache-2.0, 84 stars, 23 MB binary, SQLite), Kanboard (MIT, 9.9k, PHP). OpenProject links: https://www.openproject.org/ and https://github.com/opf/openproject (too heavy for this goal). Report spotty CLEAN in round 3. Earlier, round 2 ranked general self-hosted trackers. «фьюжн» most likely means Fusion by Runfusion (MIT, about 1.3k stars, a Pi-based ticket site; early preview, pins Pi 1.1.0, no weeks or hotfix lane). Recommended: OpenProject Community (GPL-3.0, 16.9k, 17.9.6 on 2026-10-30): free sprints, role-based status transitions so only the owner's role sets Approved, a separate Hotfix type with its own workflow, REST API v3, webhooks, community MCP; Docker, 4 GB RAM. Our part 7 SP, not started, own code needs the owner's consent (rule 35): setup 1, Pi ticket tools over REST 2, Pi gate bound to sprint, approval revision and revocation 2, agent replies in ticket comments 2 (5 SP without the last). Alternative: hands-on Fusion probe 1 SP. Open risk: the VDI must reach the server. Round 1 (AI boards: KanDev, Backlog.md and others) kept as a short section. Plan spotty CLEAN in round 2 of each pass; report spotty CLEAN in round 2, opened. Evidence: `my-pi-evidence/designs/plan-site/` (PLAN, BRIEF, BRIEF2, 01-12). Report: `/Users/arkadijcukavin/Downloads/plan-site-research.html`. No branch. | Owner 2026-11-03, verbatim: «Надо найти какое то решение для этих задач ``` - работа строго по плану - список задач отдельно - брать в работу задачи нельзя только кроме хот фиксов - для хотфиксов надо сделать отделньый процесс согласования ``` А именно я хочу что бы был какой то локал сайт с функционалом чата что бы там писать задачи и общаться с ИИ. ставить новые задачи обсудать план и решение, планировать работу на неделю и что бы агент делал ток работу вот по этому сайту и только то что спланировано и согласовано на неделю. Я хочу что бы ты поискал самые топовые варианты что юзает сообщество и поискал какие то варианты готовые на гитхабе с большим количество звезд сделай разнообразные поисковые запросы широчайший ресерч»; widening 2026-11-03, verbatim: «Смотри, насчет сайта не обязательно, чтобы это был типа что-то для пи. Это может быть вообще любой сайт, готовый open source, мы просто сами его подключим к основном на к. Вот. работать допустим по какому-нибудь там агентскому протоколу или просто через пи вот мы напишем свой транспорт для этого нам нужна именно возможность чтобы был веб-сайт в котором можно писать тикеты типа Типа фьюжн ч<unk>-то такое.»; narrowing 2026-11-03, verbatim: «Мне надо САМЫЙ легковесный вариант можно даже просто сайт + MCP/CLI локальный самый простой быстрый легковесный И дай ссылку на опенпрожект»; core goal 2026-11-03, verbatim: «суть задачи в том что бы реализовать UI интерфейс готовый для организации работы что бы я мог смотреть визуально на прогресс»; filter 2026-11-03, verbatim: «смотри, нужно готовый визуальный интерфейс, прогресс, доску нужно с этими всякими статусами, чтобы агент мог полностью ей управлять, то есть он мог перетаскивать клод клод ну или статусы просто переключать визуально вот чтобы он мог короче там менять описание писать прогресс и так далее вот не обязательно чтобы там визуально что-то отображалось то есть агент просто будет сам вести эту эту хуйню и сам будет ее это самое ну сам будет делать апдейты в ней и все ну вот / я думаю, из этого принципа можно какой-то отсев сделать» |

| 19 | <a id="subagent-review-parity"></a>SUBAGENT-REVIEW-PARITY: полноценные саб-агенты и правдивый вход ревьюера. Итого 16 SP; детали и критерии ниже. | To Do; ветка не создана; зависит от удаления RQW-todo, уже доставлено. План 16 SP принят: Main спросил «план 16 SP ... 1. запускаем после записи ответов. советую это. 2. пока не запускаем.», владелец ответил «1». Решения (a)-(f) приняты; пакеты A и R ожидают согласования. | [Итоговый план](http://127.0.0.1:6421/evidence/joint-consensus/FINAL.md); [отчёт](http://127.0.0.1:6421/reports/subagent-reviewer-final-plan.html); цитата владельца: «Я жду результаты по саб-агентам и по reviewer в виде тасок в backlog md со ссылками на отчеты Все задачи должны быть разложены. Должна быть родительская задача с акцептом, с критериями, со всем полностью заполненным. И каждая дочерняя подзадача должна быть тоже полностью заполнена максимально.» |

## Current design details

### SUBAGENT-REVIEW-PARITY details

Статус: To Do. Ветка не создана. Итого 16 SP. Выбранные дети To Do, ветки не созданы. План принят владельцем: «1» на предложение запустить после записи ответов. Пакеты A и R требуют согласования. Решения (a)-(f) приняты; A2 не нужен. Blocked by: удаление RQW-todo, доставлено.

Решения: (a) флаги детям не передаются; владелец сменил «2» на «выбираю первый вариант 1». (b) байтовая копия форка, ответ «1». (c) вопрос вручную в `<agreement>`, ответ «1». (d) все явные `include`: после поручения Main выбрать владелец ответил «ну давай первый вариант»; владелец предупреждён о секретах у вложенных агентов. (e) малая своя связка на Pi SDK. (f) снимок MCP при старте и пробуждении. (e) и (f) выбрал Main по поручению владельца. SA11, SA12 и QC не выбрано владельцем, в 16 SP не входят.

Источники: [отчёт](http://127.0.0.1:6421/reports/subagent-reviewer-final-plan.html); [FINAL.md](http://127.0.0.1:6421/evidence/joint-consensus/FINAL.md).

Цель: у детей инструменты, скиллы и ревьюеры главного чата; ревьюер получает слова владельца и честный бриф. Модели, effort, severity gate, цикл CLEAN, read-only инструкцией, доставленный MCP и Communication только в основных чатах не меняются.

Приёмка родителя. Реальные запуски на Pi 1.5.0. В evidence: SHA, модель, вход, вызов, результат. Секретов нет.
1. Generic-ребёнок, worker, внук и `fork_turns: "all"` реально вызывают MCP, `browser`, четыре chat-тула, `rename_session`, `$name`-скилл, skill-ссылку и `/skill:`-скилл. Меняют состояние только generic и worker. Spotty и Bossy проверяются по каталогу: `REVIEWER.md:1` запрещает «state-changing actions».
2. Первый запрос форка соответствует решению (b).
3. Внук запускает Spotty с `include`. Ревьюер получает уникальную строку владельца, которую внук не видел. Получатели по решению (d). То же после перезапуска Pi.
4. Бриф ревьюера после шага `$skill` совпадает байт в байт. Обычная задача раскрывается как в main.
5. Terra-ребёнок Opus-чата читает в `Model:` `openai-codex/gpt-6.1-terra`.
6. Обычные дети и ревьюеры не получают Communication. Модели и effort прежние.
7. RV2 пройдена по своим порогам.
8. J1: каждый hunk связан с цитатой, каждый фрагмент цитаты с результатом. Spotty CLEAN на файле аудита.
9. Решения (a)-(f) отвечены. Выбранные условные дети сделаны. Невыбранные записаны как границы.
10. Blocked by: задача удаления RQW-todo (T). Статус: доставлена. Release `82e05bd1`, записи `d8557b76`, main `0bdb0f5b`.

#### RV1: Тексты ревьюера и шаблон брифа

SP: 0. Статус: To Do. Ветка: не создана. Blocked by: пакет R.

QR: «Не было ничего лишнего, и ревьюер выполнял ту роль, для которой он предназначен, максимально эффективно, быстро и четко и доставлял максимально качественный результат и защищал нас максимально качественно от хуйни.»
QV: «И если мы что-то действительно изменяем, то надо убедиться в том, что оно действительно работает так, как соответствует контексту, и это не нарушает контекст и не переусложняет ревьюеры.»

- Цитата: QR «ревьюер выполнял ту роль, для которой он предназначен»; QV «не переусложняет ревьюеры».
- Механизм, только текст:
  1. `REVIEWER.md:1` ложно: «The tool assembles the brief in the sections `<user_messages>` …». Инструмент добавляет только user-текст (`prompt-files.ts:20-27`). Замена, нейтральная фраза G (`round3-B.md:157`): «The caller supplies `<agreement>` when needed, `<object>`, `<criterion>` and, from the second pass on, `<rejected_earlier>`; `agent` appends `<user_messages>` after the task under its `include` contract. The tool does not assemble the other sections or include compaction or branch summaries.» Фраза верна до и после SA8 и QC.
  2. `REVIEWER.md:3`: «including the diff» → «including the diff when the brief supplies one».
  3. `REVIEWER.md:7`: одобренное правило лишнего (`DECISIONS.md:1275`) переносится в gate. Строка-вставка `SKILL.md:14` «Always include: …» удаляется.
  4. `SKILL.md:11-16`: один буквальный шаблон, ниже.
  5. `SKILL.md:21` не меняется.
  6. Тот же текст роли в `profiles/spotty.toml` и `profiles/bossy.toml`. `README.md:20-25` синхронно.
- Приёмка: цитаты и ссылки. Три копии роли равны (`test/extensions/RQW-review/profiles.test.ts`). Поведение проверяет RV2.
- Порядок: RV1 идёт первым. Ревью всех детей после него идут по шаблону. Формально дети его не ждут.

Шаблон брифа. Содержание; точный текст идёт в пакет R.

```text
<agreement>
none
  или по пункту на решение:
- «слова владельца дословно» — source: <путь>:<запись>
  answers: «вопрос или предложение дословно» — source: <путь>:<запись>
</agreement>
<object>
stage: pre-action | pre-completion
pass: initial | changed-object
paths: <абсолютные пути>
requirements and rules: <абсолютные пути или якоря>
diff: <абсолютный путь> | none   (файл вне git: diff -u с сохранённой копией)
</object>
<criterion>
<что подтверждает проверка; без изменений весь цикл>
</criterion>
<rejected_earlier>
none | <находка>: <причина с цитатой>
</rejected_earlier>
```

Источники: [отчёт](http://127.0.0.1:6421/reports/subagent-reviewer-final-plan.html); [FINAL.md](http://127.0.0.1:6421/evidence/joint-consensus/FINAL.md#rv1).

#### SA1: Закрытие и удержание ребёнка

SP: 2. Статус: To Do. Ветка: не создана. Blocked by: «да» плану, (e).

Q2: «все саб-агенты должны работать также как основной чат, то есть доступ к скиллам, к ревьюерам, к саб агентам, ко всем тулам такой же как в основном чате»

- Цитата: Q2 «ко всем тулам такой же как в основном чате». Браузер чистит вкладки только по `session_shutdown` (`RQW-browser/index.ts:470-478`).
- Механизм: на каждом выходе один раз дождаться `session_shutdown` раннера ребёнка до `dispose()`. Выходы: `close` для stop, restart, sleep (`index.ts:1557-1576`); failed create (`:1304-1308`). Startup не дублировать: Pi испускает его при bind (P1, P3, E: `agent-session.js:2678-2700`). Существующий `offer` (`index.ts:347-357`) получает необязательное поле `busy()`. `canSleep` (`:795-801`) отказывает, пока ребёнок или потомок busy. Освобождение ресурса заново ставит сон вверх по цепочке, как `onRunning` (`:1209`). Причина: таймер `:863-866` ставит сон один раз; дальше сон ставят только `turn_end` и `agent_settled` main (`:1965-1969`). Нового канала, таймера и опроса нет. Проверка формы, откат на stock.
- Приёмка: три поколения, внук держит вкладку. Предки не спят после 5 минут. После `close` при простое main засыпают. MCP не закрывается дважды. Stop предка закрывает только его дерево. Часы фейковые в unit; живой прогон в SA2.

Источники: [отчёт](http://127.0.0.1:6421/reports/subagent-reviewer-final-plan.html); [FINAL.md](http://127.0.0.1:6421/evidence/joint-consensus/FINAL.md#sa1).

#### SA2: Браузер

SP: 1. Статус: To Do. Ветка: не создана. Blocked by: SA1.

Q2: «все саб-агенты должны работать также как основной чат, то есть доступ к скиллам, к ревьюерам, к саб агентам, ко всем тулам такой же как в основном чате»

- Цитата: пункт 2 «браузер»; Q2.
- Механизм: RQW-browser предлагает свой `createBrowserExtension()` каждому ребёнку на `rqw-agent:subagent-extension-factories` (`RQW-agent/index.ts:344`). `busy()` = есть открытые вкладки. Схемы и `browser.run` прежние.
- Приёмка: worker и внук открывают локальную страницу, `markdown`, `screenshot`, `run`. Через 6 минут простоя `send` видит ту же вкладку. `stop` закрывает только его Chrome. Вкладка main работает.

Источники: [отчёт](http://127.0.0.1:6421/reports/subagent-reviewer-final-plan.html); [FINAL.md](http://127.0.0.1:6421/evidence/joint-consensus/FINAL.md#sa2).

#### SA3: Четыре chat-тула

SP: 2. Статус: To Do. Ветка: не создана. Blocked by: «да» плану.

Q2: «все саб-агенты должны работать также как основной чат, то есть доступ к скиллам, к ревьюерам, к саб агентам, ко всем тулам такой же как в основном чате»

- Цитата: пункт 3 «инструменты связи чатов и строка о них в тексте»; Q2.
- Механизм: четыре определения (`RQW-tabs-link/index.ts:116`) в клиентскую фабрику на том же канале. Без сервера, lock и записи в реестр. Deferred, ключ `rqwchat`. Без `tool_search` включаются прямо, как в main (`visibility.ts:11-20`). Отправитель: session id ребёнка. Строка промпта о тулах становится правдой без правки. SA1 не нужен: клиенту нечего закрывать.
- Приёмка: владелец открыл две вкладки. Ребёнок вызывает `list_chats`, `read_chat`, `send_message_to_chat`, `wait_answer` и получает сохранённый ответ. Закрытая вкладка не открывается.

Источники: [отчёт](http://127.0.0.1:6421/reports/subagent-reviewer-final-plan.html); [FINAL.md](http://127.0.0.1:6421/evidence/joint-consensus/FINAL.md#sa3).

#### SA4: Steering восстановленного ребёнка

SP: 1. Статус: To Do. Ветка: не создана. Blocked by: SA3.

Q3: «Делай так, чтобы у агентов было всё то же самое, и проверь, что в этом проекте работ нет ничего, что я не заказывал, никакой лишней хуйни. Там всё должно на 100% совпадать и покрывать требования, которые я заявил. Дословные мои цитаты должны быть закрыты полностью в исполнении, но ничего от себя не должно быть. Ничего, что не было прямо заказано.»

- Цитата: Q3 «Делай так, чтобы у агентов было всё то же самое». В main и у свежего ребёнка steering отпускает `wait_answer`.
- Механизм: восстановленный `send` идёт через `a.session.steer`, как свежий (`index.ts:1801`). Не через `a.session.agent.steer` (`:1800`). Второй очереди и синтетического `queue_update` нет.
- Приёмка: после настоящего перезапуска Pi `agent send` завершает `wait_answer` ребёнка как steered. Доставлено один раз, без abort.

Источники: [отчёт](http://127.0.0.1:6421/reports/subagent-reviewer-final-plan.html); [FINAL.md](http://127.0.0.1:6421/evidence/joint-consensus/FINAL.md#sa4).

#### SA5: `rename_session`

SP: 1. Статус: To Do. Ветка: не создана. Blocked by: «да» плану.



- Цитата: пункт 4 «переименование сессии».
- Механизм: RQW-naming предлагает только `rename_session` (`RQW-naming/index.ts:144-155`) с API сессии ребёнка. Автоимя и `/rename-gen` только в main.
- Приёмка: worker и внук переименовывают себя. Имя в их JSONL. Имя main и соседа прежнее.

Источники: [отчёт](http://127.0.0.1:6421/reports/subagent-reviewer-final-plan.html); [FINAL.md](http://127.0.0.1:6421/evidence/joint-consensus/FINAL.md#sa5).

#### SA6: `$name`, skill-ссылки, флаг ревьюера

SP: 2. Статус: To Do. Ветка: не создана. Blocked by: «да» плану, (e).

Q2: «все саб-агенты должны работать также как основной чат, то есть доступ к скиллам, к ревьюерам, к саб агентам, ко всем тулам такой же как в основном чате»

- Цитата: пункт 5 «`$скилл` … в задаче помощника»; Q2 «доступ к скиллам».
- Механизм: одна подготовка новой задачи в RQW-agent до `appendUserMessages`. Сейчас `include` добавляется раньше всего (`index.ts:1729-1730`). Пути: start, send, restart, восстановленный core `session.agent.prompt` (`:1422`), первая задача форка (`:1280`, `:1283`). Раскрытие: готовые `expandMentions` и фильтр RQW-skill-dollar (`RQW-skill-dollar/index.ts:132`, `:222-228`) через offer по `pi.events`. Обычная задача раскрывается как в main: кавычки и теги не мешают. Имя в бэктиках остаётся текстом: `MENTION` требует пробел перед `$` (`:130`).
- Флаг ревьюера: считается один раз на start и restart. Условие: итоговый активный текст роли после профиля и всех переопределений равен пакетному `REVIEWER.md`. Флаг хранится в config ребёнка. Restore и send берут его без нового сравнения. У ребёнка, сохранённого до правки, флага нет. При restore он считается один раз по сохранённому происхождению, не по тексту, и сохраняется. Ревьюер: `config.prompt_file` с `kind: "role"` и `path` пакетного `REVIEWER.md`; или `config.profile.path` — профиль RQW-review, `config.profile_defaults.role === true` (роль взята из профиля), `prompt_file` и `custom` пусты. Поля есть в `Config` (`RQW-agent/index.ts:162`, `:1646-1647`, `:1672-1674`; `README.md:144`, `:166`). С флагом шаг `$` и ссылок пропускается для всего брифа. Парсера секций и кавычек нет.
- Приёмка: generic, worker, внук и форк выполняют тестовый скилл через `$name` и через ссылку. Бриф ревьюера с `$skill` во всех секциях не меняется ни на байт. Тот же текст в обычной задаче раскрывается как в main. Include-история повторно не раскрывается.

Источники: [отчёт](http://127.0.0.1:6421/reports/subagent-reviewer-final-plan.html); [FINAL.md](http://127.0.0.1:6421/evidence/joint-consensus/FINAL.md#sa6).

#### SA7: `/skill:name`

SP: 1. Статус: To Do. Ветка: не создана. Blocked by: SA6.



- Цитата: пункт 5 «`/skill:имя`».
- Механизм: нативный `_expandSkillCommand` ребёнка (`agent-session.js:1745-1769`) один раз, после шага SA6 и до `appendUserMessages`. Каталог: Pi `skillsOverride` со скиллами main; сейчас у ребёнка `noSkills: true` (`index.ts:1184`). Выбор same-name: RQW-codex-compat (`RQW-codex-compat/index.ts:134-153`). Пути: обычный, первая задача форка, восстановленный core.
- Почему до include: Pi раскрывает только текст с `/skill:` в начале и берёт имя до первого пробела (`agent-session.js:1746-1750`). Голый `/skill:name` с include сейчас ломается: имя захватит `<user_messages>`. После раскрытия текст начинается с `<skill`. Поэтому `session.prompt` (`:1678-1679`) второй раз не раскрывает.
- Приёмка: `/skill:<test> arg` и голый `/skill:<test>` с include выполняются на обычном пути, в первой задаче форка и на восстановленном core. Ровно один skill-блок, история после него. Same-name, unknown, disabled как в main. Работает без RQW-skill-dollar.

Источники: [отчёт](http://127.0.0.1:6421/reports/subagent-reviewer-final-plan.html); [FINAL.md](http://127.0.0.1:6421/evidence/joint-consensus/FINAL.md#sa7).

#### SA8: Root-источник `include`

SP: 2. Статус: To Do. Ветка: не создана. Blocked by: (d), (e), пакет A.

Q2: «все саб-агенты должны работать также как основной чат, то есть доступ к скиллам, к ревьюерам, к саб агентам, ко всем тулам такой же как в основном чате»
Q3: «Делай так, чтобы у агентов было всё то же самое, и проверь, что в этом проекте работ нет ничего, что я не заказывал, никакой лишней хуйни. Там всё должно на 100% совпадать и покрывать требования, которые я заявил. Дословные мои цитаты должны быть закрыты полностью в исполнении, но ничего от себя не должно быть. Ничего, что не было прямо заказано.»

- Цитата: пункт 6 «ревьюер от помощника не видит твоих слов»; Q2 «к ревьюерам»; Q3 «Дословные мои цитаты должны быть закрыты полностью в исполнении».
- Механизм: getter корневой ветки идёт вниз, как `config.base` через `registerCaller` (`index.ts:1209`). `include` читает его вместо ветки вызывающего (`:1730`). Новой сохранённой записи нет: дерево пересобирается под живым корнем (`:1033`, `:1079`). Получатели по (d). Блок `<user_messages>` получает одну постоянную строку-пометку: блоки `<skill …>` внутри — текст скилла, не слова владельца. Байты сообщений не меняются, парсера нет.
- Приёмка: внук не видел уникальную строку владельца. Он запускает Spotty с `include`. Реальный запрос ревьюера содержит строку после задачи. То же после compaction и перезапуска Pi. Запрос содержит пометку о `<skill>`-блоках.

Источники: [отчёт](http://127.0.0.1:6421/reports/subagent-reviewer-final-plan.html); [FINAL.md](http://127.0.0.1:6421/evidence/joint-consensus/FINAL.md#sa8).

#### SA9: Своя строка Model

SP: 1. Статус: To Do. Ветка: не создана. Blocked by: пакет A.



- Цитата: пункт 7 «помощник думает, что он на модели главного чата».
- Механизм: ребёнок наследует промпт вызывающего. Строку `- Model:` пишет `RQW-prompt/index.ts:45`. В `resolveConfig` (`RQW-agent/index.ts:1620`) и при restore меняется только её значение внутри `<workstation>`. Свой `system`, `system_file`, `role_file` и форк не трогаются.
- Приёмка: Terra-ребёнок Opus-чата читает `openai-codex/gpt-6.1-terra`. Так же после restart и restore.

Источники: [отчёт](http://127.0.0.1:6421/reports/subagent-reviewer-final-plan.html); [FINAL.md](http://127.0.0.1:6421/evidence/joint-consensus/FINAL.md#sa9).

#### SA10: Описание `agent`

SP: 0. Статус: To Do. Ветка: не создана. Blocked by: SA2, SA3, SA5, SA8, пакет A.

Q3: «Делай так, чтобы у агентов было всё то же самое, и проверь, что в этом проекте работ нет ничего, что я не заказывал, никакой лишней хуйни. Там всё должно на 100% совпадать и покрывать требования, которые я заявил. Дословные мои цитаты должны быть закрыты полностью в исполнении, но ничего от себя не должно быть. Ничего, что не было прямо заказано.»

- Цитата: Q3 «всё то же самое». `index.ts:102` говорит: у ребёнка только base, job, web, codemode, tool_search.
- Механизм: текст `index.ts:102`, `:104`, `:123`, `:146` по одобренным диффам.
- Приёмка: тест описания ловит старый текст.

Источники: [отчёт](http://127.0.0.1:6421/reports/subagent-reviewer-final-plan.html); [FINAL.md](http://127.0.0.1:6421/evidence/joint-consensus/FINAL.md#sa10).

#### SA11: Флаги tools, не выбрано владельцем

Только если владелец выберет перенос флагов в решении (a).

SP: 2 в невыбранной альтернативе, в итог не входит. Статус: не выбрано владельцем.

Q2: «все саб-агенты должны работать также как основной чат, то есть доступ к скиллам, к ревьюерам, к саб агентам, ко всем тулам такой же как в основном чате»

- Цитата: Q2 «ко всем тулам такой же как в основном чате».
- Механизм: штатная политика Pi allow, exclude и exposure (E, G, P1: `agent-session.js:1151-1179`). Применяется ко всему списку ребёнка `index.ts:1232`: base, job, agent, web, builtins, extension, MCP. Без своего парсера и ACL. Параметр `tools` сохраняет смысл. Несовместимая форма не расширяет права.
- Приёмка: два запуска main. Первый: `--exclude-tools` на один base, один extension, один MCP tool. Второй: `--tools` с allowlist по одному каждого вида. Generic, внук и форк имеют ровно итоговый набор main. Запрет не обходится напрямую, через `tool_search` или codemode. Без флагов дети прежние.

Источники: [отчёт](http://127.0.0.1:6421/reports/subagent-reviewer-final-plan.html); [FINAL.md](http://127.0.0.1:6421/evidence/joint-consensus/FINAL.md#sa11).

#### SA12: Первый запрос форка, не выбрано владельцем

Только если владелец выберет изменение форка в решении (b).

SP: 2 в невыбранной альтернативе, в итог не входит. Статус: не выбрано владельцем.

Q2: «все саб-агенты должны работать также как основной чат, то есть доступ к скиллам, к ревьюерам, к саб агентам, ко всем тулам такой же как в основном чате»
C: «Нет нет форк идет эксклюзивно основной агент ждет так что кеш должен в этой схеме участвовать» (`DECISIONS.md:1181`); «да» на «тот же системный промпт, те же инструменты, те же метки кеша» (`:1182`)

- Цитата: Q2. Против C «те же инструменты»: нужно явное разрешение.
- Механизм: только для форка с явным `tools`. В `onPayload` (`index.ts:1276-1286`) объявления тулов первого запроса берутся из собственного спроецированного обычного запроса ребёнка. Это ровно то, что Pi отправил бы следующим обычным запросом этого ребёнка: `prepareLoadout`, режим codemode, видимость deferred, тулы, уже загруженные на ветке. Правил видимости не навязывать: эталон сам обычный запрос. Остальной скопированный префикс сохраняется. Форк без `tools` остаётся байтовой копией.
- 1 или 2 SP: A и B дали 1, шестеро дали 2. Выбрано 2. Причина: два формата провайдера (`:1279-1283`), связанный `tool_choice`, четыре крайних случая проекции. По шкале `PROCESS.md` правило 3 это «одно хитрое место, несколько тестов».
- Приёмка: `fork_turns: "all"` с `tools: ["bash"]` на Anthropic и Codex. Имена объявленных тулов равны обычному запросу того же ребёнка. `z_tool` не объявлен (`fork-anthropic.test.ts:125`, `:149`). Форк без `tools` остаётся байтовой копией.

Источники: [отчёт](http://127.0.0.1:6421/reports/subagent-reviewer-final-plan.html); [FINAL.md](http://127.0.0.1:6421/evidence/joint-consensus/FINAL.md#sa12).

#### QC: Вопрос перед ответом, не выбрано владельцем

Только если владелец выберет автоматическую передачу в решении (c).

SP: 1 в невыбранной альтернативе, в итог не входит. Статус: не выбрано владельцем.

QR: «Не было ничего лишнего, и ревьюер выполнял ту роль, для которой он предназначен, максимально эффективно, быстро и четко и доставлял максимально качественный результат и защищал нас максимально качественно от хуйни.»

- Цитата: пункт 6; QR «защищал нас максимально качественно от хуйни». Прямой цитаты на механизм нет, поэтому это решение владельца.
- Механизм: в `appendUserMessages` (`prompt-files.ts:20-27`) перед каждым сообщением владельца идёт последний непустой текст ассистента после предыдущего сообщения владельца. Блок помечен «not the user's words». Байты владельца прежние. Ответ только с тулами вопросом не считается. `<agreement>` всё равно нужен для принятий вне чата.
- Приёмка: копия ветки 11-04. Запрос ревьюера показывает семипунктный вопрос Main прямо перед «Делай так, чтобы у агентов было всё то же самое».

Источники: [отчёт](http://127.0.0.1:6421/reports/subagent-reviewer-final-plan.html); [FINAL.md](http://127.0.0.1:6421/evidence/joint-consensus/FINAL.md#qc).

#### RV2: Проверка ревьюера

SP: 2. Статус: To Do. Ветка: не создана. Blocked by: RV1, SA6, SA8.

QV: «И если мы что-то действительно изменяем, то надо убедиться в том, что оно действительно работает так, как соответствует контексту, и это не нарушает контекст и не переусложняет ревьюеры.»

- Цитата: QV «надо убедиться в том, что оно действительно работает так, как соответствует контексту».
- Механизм: продукт не меняется. Девять запусков, по одному на случай.
  1. Spotty на R1-R4 и C1-C2, шесть запусков. Снимки `/tmp/rq-replay-*` удалены (`replay.md:378`): сначала заново создать detached worktree на записанных коммитах и путях (`replay.md:55-58`, `:92-93`). Входы из `reviewer-lineage/replay.md` байт в байт. Меняется только роль.
  2. Bossy на плане agent#64. Копия ветки 11-04, настоящий `include`, бриф по шаблону. При (c) = вручную вопрос Main в `<agreement>`.
  3. Случай с реально отсутствующим обязательным источником.
  4. Один changed-object проход: `diff -u`, тот же criterion.
- Брифы 2-4 пишет агент, не видевший ожидаемых ответов. Ответы в отдельном файле. Время и круги записываются. Первые вердикты сохраняются. Перезапуск ради счёта запрещён.
- Приёмка: R1, R2 и R4 найдены снова. R3 записан, найден или нет. Необоснованных P0-P2 на C1-C2 не больше сегодняшних двух (`replay.md:109`). В #64 нет NOT AGREED по пункту 7. Отсутствующий источник даёт UNCHECKED, не CLEAN. Находки changed-object только на изменённых строках и затронутых путях.

Источники: [отчёт](http://127.0.0.1:6421/reports/subagent-reviewer-final-plan.html); [FINAL.md](http://127.0.0.1:6421/evidence/joint-consensus/FINAL.md#rv2).

#### J1: Итоговый прогон и scope-аудит

SP: 1. Статус: To Do. Ветка: не создана. Blocked by: SA1-SA10, RV2, удаление RQW-todo (доставлено).

Q5: «Мне нужны полнофункциональные саб-агенты, такие же, как в Codex и других моделях, чтобы саб-агенты были настолько же мощны, как и основной агент. Не должно быть никакого разрыва в этом плане у саб-агента, но при этом мы помним про то, что это саб-агенты.»
Q3: «Делай так, чтобы у агентов было всё то же самое, и проверь, что в этом проекте работ нет ничего, что я не заказывал, никакой лишней хуйни. Там всё должно на 100% совпадать и покрывать требования, которые я заявил. Дословные мои цитаты должны быть закрыты полностью в исполнении, но ничего от себя не должно быть. Ничего, что не было прямо заказано.»
N: «И убедись что в этих задачах нет ничего лишнего все супер производительно легковесно минималистично и выполнеяет мой заказ и ничего от себя не добавляет выходящее за требования к задачам, объядени в одну задачу и пусть консилиму все перепроверит и каждого перепроверит босси»

- Цитата: Q5 «полнофункциональные саб-агенты»; Q3 «проверь, что в этом проекте работ нет ничего, что я не заказывал»; N «нет ничего лишнего».
- Механизм: один файл `ACCEPTANCE.md`. Сначала живой каталог тулов main. Потом каждый вид ребёнка против него. Прогоны детей переиспользуются; покрытые клетки не повторяются. Затем таблица: каждый hunk совместного диффа и коммита MCP `432c77d9` к цитате, каждый фрагмент цитаты к результату. Hunk без цитаты уходит назад. Спорный идёт владельцу.
- Приёмка: пункты 1-8 приёмки родителя. Spotty CLEAN на файле аудита.

Источники: [отчёт](http://127.0.0.1:6421/reports/subagent-reviewer-final-plan.html); [FINAL.md](http://127.0.0.1:6421/evidence/joint-consensus/FINAL.md#j1).

#### J0: BACKLOG и записи

SP: 0. Статус: To Do. Ветка: не создана. Blocked by: черновик: «да» плану; итог: J1.

QB: «Я жду результаты по саб-агентам и по reviewer в виде тасок в backlog md со ссылками на отчеты Все задачи должны быть разложены. Должна быть родительская задача с акцептом, с критериями, со всем полностью заполненным. И каждая дочерняя подзадача должна быть тоже полностью заполнена максимально.»
N: «И убедись что в этих задачах нет ничего лишнего все супер производительно легковесно минималистично и выполнеяет мой заказ и ничего от себя не добавляет выходящее за требования к задачам, объядени в одну задачу и пусть консилиму все перепроверит и каждого перепроверит босси»
QJ: «пожалуйста согласуй всю эту пиздабратию друг с другом и поставь в зависимость задачу по саб агентам и ревьюера»

- Цитата: QB; N «объядени в одну задачу»; QJ.
- Механизм: один BACKLOG-родитель и выбранные дети. У каждого: цитата, SP, файлы, приёмка, Blocked by, ссылки на отчёты. После J1: `DECISIONS.md` `[D-AGENT-CALLER-MESSAGES]` (`:1033`) заменён, старый текст в архив; `[D-TABS-LINK]`, `[D-AGENT-HIBERNATE]`, `[D-UI-NAMING]`, `[D-REVIEW-PROMPT]`; `AGENTS.md`; READMEs RQW-tabs-link, RQW-agent, RQW-review.
- Приёмка: суммы, цитаты, ссылки, Blocked by.

Источники: [отчёт](http://127.0.0.1:6421/reports/subagent-reviewer-final-plan.html); [FINAL.md](http://127.0.0.1:6421/evidence/joint-consensus/FINAL.md#j0).


### AGENT-STATES-UI details

<a id="agent-states-ui"></a>AGENT-STATES-UI is delivered in [D-STATUSBAR-WAITS](DECISIONS.md#status-bar): the waiting
wording, the child process count and the idle-agent count line. The sources below are retained as the owner's
verbatim record. Delivery does not resume other held UI work.

Owner sources in session `2026-10-21T16-27-59-062Z_01a15f4a-7ad5-7377-81be-0baf3b6ffa33.jsonl`:
`16-27-59:5085`, entry `04f64a5e`: «Если у нас какие-то агенты в афк стоят, то они не должны отображаться, как будто они рабочие и их ожидание происходит.»
`16-27-59:5087`, entry `ddd0ce47`: «И да, интерфейс должен разключать, когда агент стоит, когда он AFK, когда он работает.»
`16-27-59:6301`, entry `a8793e4c`: «строка статуса должна отражать все фоновые ожидания. Не только саб-агентов, которые работают, но и если саб-агент ожидает какой-то фоновый процесс, они тоже должны отображаться в строке статусов».
`16-27-59:6305`, entry `217beed6`: «Если агент think-ает основной, что-то делает, то это отражается в статусе. Если же он ничего не делает, но он ожидает саб-агентов какие-то, background процессы, это тоже должно отражаться. Есть саб-агенты, а есть background процессы. Worker там быть не должно, мы вообще worker удалили.»
