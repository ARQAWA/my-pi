# J1. Scope-аудит: hunk → цитата, фрагмент цитаты → результат

## Текущее состояние на 2026-11-04

- RV1 доставлена: `f4d10f3b`, `e65532c9`. Прежнее удержание R3-R5 больше не отражает текущее состояние; строгий scope заменил прежний R3, как указано в `TEXT-DIFFS.md`. Не утверждается, что весь старый текст R3 поставлен без изменений.
- SA8 доставлена: `f2c05e93`, `6d80b5a5`. Владелец принял пометку: «правку 11 я принимаю».
- Codex fork: PASS на `e65532c9`. В исходной ветке 12 записей; семь элементов входа скопированы в порядке, восьмой — единственная задача. Полные wire-кадры не сравнивались байт в байт из-за метаданных транспорта. Доказательство: `/Users/arkadijcukavin/ai-project/my-pi-evidence/designs/joint-consensus/acceptance`/`J1-codex-fork-live.md`; сырые данные: `/Users/arkadijcukavin/ai-project/my-pi-evidence/designs/joint-consensus/acceptance`/`raw/2026-11-04-live-tail/`.
- SA8 после настоящего сжатия: PASS на `e65532c9`. Запись compaction `529ce743`, строка 16 родительского JSONL; маркера нет в summary и первом запросе после сжатия. В единственной задаче ребёнка `ROOTSA8QXZNOVEMBER` встречается один раз. Доказательство: `/Users/arkadijcukavin/ai-project/my-pi-evidence/designs/joint-consensus/acceptance`/`SA8-compaction-live.md`; сырые данные: `/Users/arkadijcukavin/ai-project/my-pi-evidence/designs/joint-consensus/acceptance`/`raw/2026-11-04-live-tail/`.
- Осталась только RV2, ожидает обсуждения владельца о benchmark. Родитель остаётся In Progress.

## Исторический снимок до текущего состояния

Всё ниже относится только к указанному историческому диапазону и не описывает текущие статусы. Текущие изменения и ограничения приведены выше. Старые счёты hunk и незавершённое ревью аудита не распространяются на последующие коммиты; нового CLEAN здесь не заявлено.



Объект: совместный диапазон `git diff d8557b76 f4d10f3b` в `/private/tmp/srp-d2` (HEAD `f4d10f3b`, рабочее дерево чистое) и коммит MCP `432c77d9`.
Диапазон = D1 (`1a1e80fd`..`63ef1299`, плюс тестовая правка `92a99d4c`) и D2 (`754d093c` SA6, `027f0f34` SA3, `f4d10f3b` RV1 R1/R2).
Правила: `BRIEF-J1.md`, `FINAL.md` разделы 1, 2, 4, 5, `TEXT-DIFFS.md`. Одобрены и поставлены: A1-A5 (`D1-BRIEF2.md:2`); R1 «да» и R2 «да» (в `f4d10f3b`). Одобрены, но удержаны и не в диапазоне: R3 «да» (удержано более новым поручением владельца); R4 «9й да» (шаблон одобрен, весь R4 удержан до решения консенсуса по строке «Always include…»); R5 «10 да» (удержано вместе с R4, описывает его шаблон). Не одобрена: пометка M1 (показана владельцу).
Живых прогонов в этой части нет.

Счёт hunk: совместный диапазон даёт 80 hunk. Файл `acceptance/D1.diff` устарел: в нём 73 hunk, нет `unit.test.ts @@ -1489` из `63ef1299` и всего D2.
Hunk D2 в `RQW-tabs-link/index.ts @@ -191` (коммит `027f0f34`) в совместном диффе слился с hunk `@@ -181`; hunk `@@ -11` вырос на константу `CHILD_ALLOWED_TOOLS`. Hunk SA6 в `synthetic-agent.test.ts` и правка `92a99d4c` в `skill-mentions.test.ts` тоже слились с hunk D1.

Метки цитат: Q1, Q2, Q3 (пункты 1-7), Q5, N, K, C из `FINAL.md` раздел 1; решения (a)-(f) из раздела 4. Дети: SA1-SA10, RV1 из раздела 2.

## (a) Каждый hunk → цитата → ребёнок

### Продукт (54 hunk)

| # | file:hunk | Что делает | Цитата | Ребёнок |
|---|---|---|---|---|
| 1 | `RQW-agent/coordinator.ts @@ -22` | `busy?()` в `RuntimeHandle` | Q2 «ко всем тулам»; (e) | SA1 |
| 2 | `RQW-agent/index.ts @@ -1,10` | импорты `readFile`, `fileURLToPath` (флаг ревьюера), `dirname`, `Skill`, `SlashCommandInfo` (каталог скиллов) | Q3 п.5; Q2 «доступ к скиллам» | SA6, SA7 |
| 3 | `index.ts @@ -19` | импорт `withModelLine` | Q3 п.7 | SA9 |
| 4 | `index.ts @@ -99` | текст DESCRIPTION, A1 и A2 | Q3 «всё то же самое»; одобрено A1, A2 | SA10 |
| 5 | `index.ts @@ -120` | текст DESCRIPTION, A3 | Q3 п.6; (d); одобрено A3 | SA10 |
| 6 | `index.ts @@ -143` | описание параметра `include`, A4 | Q3 п.6; (d); одобрено A4 | SA10 |
| 7 | `index.ts @@ -159` | `Config.reviewer`, `REVIEWER_PATH`, `legacyReviewer` | Q3 п.5 (бриф ревьюера не меняется) | SA6 |
| 8 | `index.ts @@ -242` | `Child.busy` | Q2; (e) | SA1 |
| 9 | `index.ts @@ -340` | `ExtensionFactory.busy`, `shutdownSession` | Q2; (e) | SA1 |
| 10 | `index.ts @@ -412` | комментарий: отказ политики больше не делает dispose сам | Q2; (e) | SA1 |
| 11 | `index.ts @@ -434` | убран `session.dispose()` из `bindSessionPolicy`; shutdown до dispose у вызывающего | Q2; (e) | SA1 |
| 12 | `index.ts @@ -509` | `registerCaller` получает `rootCommands`, `rootBranch` | Q3 п.5, п.6; (d) | SA7, SA8 |
| 13 | `index.ts @@ -517` | передача тех же аргументов | Q3 п.5, п.6 | SA7, SA8 |
| 14 | `index.ts @@ -564` | `registerSessionRuntime` получает их же | Q3 п.5, п.6 | SA7, SA8 |
| 15 | `index.ts @@ -588` | `skills()`: каталог скиллов main с фильтром RQW-codex-compat | Q2 «доступ к скиллам»; Q3 п.5 | SA7 |
| 16 | `index.ts @@ -797` | `canSleep` отказывает, пока ребёнок или потомок busy | Q2; (e) | SA1 |
| 17 | `index.ts @@ -1014` | restore: миграция флага ревьюера; строка Model | Q3 п.5, п.7 | SA6, SA9 |
| 18 | `index.ts @@ -1037` | сохранить мигрированный флаг | Q3 п.5 | SA6 |
| 19 | `index.ts @@ -1181` | `noSkills` снят, `skillsOverride` со скиллами main | Q2; Q3 п.5 | SA7 |
| 20 | `index.ts @@ -1206` | повторная постановка сна вверх по цепочке; `rootCommands`, `rootBranch` внукам | Q2; Q3 п.5, п.6; (e) | SA1, SA7, SA8 |
| 21 | `index.ts @@ -1233` | try вокруг создания; dispose в одном catch | Q2; (e) | SA1 |
| 22 | `index.ts @@ -1298` | `busy()` в Child; shutdown до dispose при сбое создания | Q2; (e) | SA1 |
| 23 | `index.ts @@ -1426` | восстановленный core: `expandPromptTemplates: !reviewer` | Q3 п.5 | SA6, SA7 |
| 24 | `index.ts @@ -1476` (D2, `754d093c`) | поздний steering после хода ребёнка: тот же `expandPromptTemplates: !reviewer` | Q3 п.5 (бриф ревьюера байт в байт) | SA6 |
| 25 | `index.ts @@ -1571` | `close`: ждать `session_shutdown` до dispose | Q2; (e) | SA1 |
| 26 | `index.ts @@ -1617` | `inheritsCallerPrompt` | Q3 п.7 | SA9 |
| 27 | `index.ts @@ -1669` | `resolveConfig`: флаг ревьюера; строка Model | Q3 п.5, п.7 | SA6, SA9 |
| 28 | `index.ts @@ -1726` | `prepare`: `$`-раскрытие, `/skill:`, затем `include` из корня | Q3 п.5, п.6; Q2; (d) | SA6, SA7, SA8 |
| 29 | `index.ts @@ -1751` | start: подготовленная задача и первая задача форка | Q3 п.5; C и (b): копия форка не трогается. Вживую на Anthropic, с `tools` и без них: копия плюс задача (`J1-fork-deferred.md` ячейки B, B2). Codex вживую не запускался | SA6, SA7 |
| 30 | `index.ts @@ -1777` | send: `prepare` | Q3 п.5 | SA6, SA7 |
| 31 | `index.ts @@ -1785` | send с interrupt: подготовленная задача | Q3 п.5 | SA6, SA7 |
| 32 | `index.ts @@ -1794` | steering: один путь `session.steer` (убран `agent.steer`); ревьюер через `_queueSteer` без раскрытия | Q3 «всё то же самое»; Q3 п.5 | SA4, SA6 |
| 33 | `index.ts @@ -1864` | restart: подготовка до остановки старого ребёнка | Q3 п.5 | SA6, SA7 |
| 34 | `index.ts @@ -1887` | restart: запуск с подготовленной задачей | Q3 п.5 | SA6, SA7 |
| 35 | `index.ts @@ -1991` | `RuntimeHandle.busy` всего дерева | Q2; (e) | SA1 |
| 36 | `RQW-agent/prompt.ts @@ -49` | `withModelLine` | Q3 п.7; одобрено A5 | SA9 |
| 37 | `RQW-browser/index.ts @@ -228` | фабрика браузера детям на `rqw-agent:subagent-extension-factories` | Q3 п.2; Q2 | SA2 |
| 38 | `RQW-browser/index.ts @@ -477` | `busy` = есть вкладки | Q3 п.2; (e) | SA2, SA1 |
| 39 | `RQW-codex-compat/index.ts @@ -1` | импорт `ExtensionContext` | Q3 п.5 | SA7 |
| 40 | `RQW-codex-compat/index.ts @@ -125` | `skillCommand` вынесен из `input` | Q3 п.5 | SA7 |
| 41 | `RQW-codex-compat/index.ts @@ -141` | отключённый скилл бросает ошибку на пути ребёнка | Q3 п.5 «как в main» | SA7 |
| 42 | `RQW-codex-compat/index.ts @@ -150` | `offerCommand` на `rqw-skill-dollar:filter`; main прежний | Q3 п.5 | SA7 |
| 43 | `RQW-naming/index.ts @@ -4` | константа канала | Q3 п.4 | SA5 |
| 44 | `RQW-naming/index.ts @@ -36` | `registerRenameTool` | Q3 п.4 | SA5 |
| 45 | `RQW-naming/index.ts @@ -141` | детям только тул; автоимя и `/rename-gen` только main | Q3 п.4; K | SA5 |
| 46 | `RQW-skill-dollar/index.ts @@ -175` | `rqw-skill-dollar:expand` для задач детей | Q3 п.5 | SA6 |
| 47 | `RQW-tabs-link/index.ts @@ -11` | импорт `CHAT_TOOL_NAMES`; D2: `CHILD_ALLOWED_TOOLS` (имена с `*`: разрешают, но не активируют) | Q3 п.3 | SA3 |
| 48 | `RQW-tabs-link/index.ts @@ -50` | константа канала | Q3 п.3 | SA3 |
| 49 | `RQW-tabs-link/index.ts @@ -113` | `buildTools(events)` | Q3 п.3 | SA3 |
| 50 | `RQW-tabs-link/index.ts @@ -150` | `steeringWait` на шине ребёнка | Q3 п.3 | SA3 |
| 51 | `RQW-tabs-link/index.ts @@ -181` | клиентская фабрика четырёх тулов детям; D2: offer с `CHILD_ALLOWED_TOOLS`, тулы остаются deferred, как в main | Q3 п.3 «инструменты связи чатов и строка о них в тексте»; Q2 | SA3 |
| 52 | `RQW-review/REVIEWER.md @@ -1,6` (D2, `f4d10f3b`) | тексты R1 (`:1`) и R2 (`:3`) | QR, QV (`FINAL.md` RV1); одобрено R1, R2 | RV1 |
| 53 | `RQW-review/profiles/bossy.toml @@ -2` | та же роль R1, R2 в копии Bossy | RV1 п.6 «тот же текст роли»; R1, R2 | RV1 |
| 54 | `RQW-review/profiles/spotty.toml @@ -2` | та же роль R1, R2 в копии Spotty | RV1 п.6; R1, R2 | RV1 |

### Тесты (26 hunk)

| # | file:hunk | Проверяет | Цитата | Ребёнок |
|---|---|---|---|---|
| 55 | `test/.../RQW-agent/description.test.ts @@ -10` | тексты A1, A2 | Q3; A1, A2 | SA10 |
| 56 | `description.test.ts @@ -31` | текст A3 | Q3 п.6; A3 | SA10 |
| 57 | `test/.../RQW-agent/fixture.ts @@ -60` | параметр `mainPrompt` | Q3 п.7 | SA9 |
| 58 | `fixture.ts @@ -78` | `commands`, `ui.notify`, `getCommands`, `mainPrompt` | Q3 п.5, п.7 | SA7, SA9 |
| 59 | `test/.../RQW-agent/model-line.test.ts` (новый) | строка Model: start, тот же model, свой system, restart, restore | Q3 п.7 | SA9 |
| 60 | `test/.../RQW-agent/real-profiles.test.ts @@ -19` (D2) | закреплённый хеш роли `REVIEW_SHA` = текст с R1, R2 | RV1 «три копии роли равны» | RV1 |
| 61 | `test/.../RQW-agent/skill-command.test.ts` (новый) | `/skill:` до include, форк, restore core, same-name, disabled, ревьюер | Q3 п.5 | SA7 |
| 62 | `test/.../RQW-agent/skill-mentions.test.ts` (новый, с `92a99d4c`) | `$name` и ссылка, ревьюер не меняется, legacy-флаг; пути через `fileURLToPath` для Windows | Q3 п.5 | SA6 |
| 63 | `unit.test.ts @@ -879` | вложенный include из корня, compaction, restore | Q3 п.6; (d) | SA8 |
| 64 | `unit.test.ts @@ -1489` | описание параметра `include` = A4 | Q3 п.6; A4 | SA10 |
| 65 | `unit.test.ts @@ -1805` | busy, сон после освобождения, stop только дерева, shutdown до dispose, отказ создания | Q2; (e) | SA1 |
| 66 | `test/.../RQW-browser/browser.test.ts @@ -12` | импорт `createEventBus` | Q3 п.2 | SA2 |
| 67 | `browser.test.ts @@ -22` | шина в setup | Q3 п.2 | SA2 |
| 68 | `browser.test.ts @@ -79` | помощник `child()` | Q3 п.2 | SA2 |
| 69 | `browser.test.ts @@ -110` | независимые вкладки детей, `busy` | Q3 п.2 | SA2 |
| 70 | `test/.../RQW-codex-compat/skill-selection.test.ts @@ -61` | `offerCommand`, disabled бросает | Q3 п.5 | SA7 |
| 71 | `test/.../RQW-naming/rename-tool.test.ts @@ -37` | ребёнку только тул, своё имя | Q3 п.4; K | SA5 |
| 72 | `test/.../RQW-skill-dollar/skill-card.test.ts @@ -2` | импорт `createEventBus` | Q3 п.5 | SA6 |
| 73 | `skill-card.test.ts @@ -46` | `events` нужен новому слушателю | Q3 п.5 | SA6 |
| 74 | `test/.../RQW-skill-dollar/skill-dollar.test.ts @@ -3` | импорт | Q3 п.5 | SA6 |
| 75 | `skill-dollar.test.ts @@ -48` | `events.on` в заглушке | Q3 п.5 | SA6 |
| 76 | `skill-dollar.test.ts @@ -90` | `expand` для задач детей | Q3 п.5 | SA6 |
| 77 | `test/.../RQW-tabs-link/subagent.test.ts` (новый, с D2) | четыре тула ребёнку, offer с `*`, deferred и прямой режим, отправитель, закрытый чат | Q3 п.3 | SA3 |
| 78 | `test/synthetic-agent.test.ts @@ -1` | импорты для тестов SA4 и SA6 | Q3 «всё то же самое»; Q3 п.5 | SA4, SA6 |
| 79 | `synthetic-agent.test.ts @@ -88` | D2: поздний `/skill:` steering ревьюера не раскрыт, обычного ребёнка раскрыт; D1: steering восстановленного ребёнка | Q3 п.5; Q3 «всё то же самое» | SA6, SA4 |
| 80 | `test/synthetic-tabs-link-child.test.ts` (новый, D2) | chat-тулы ребёнка не объявлены до `tool_search rqwchat`, после него загружены 4 | Q3 п.3 | SA3 |

Итого: продукт 54, тесты 26, всего 80 hunk.

### Коммит MCP `432c77d9` (12 hunk)

Ребёнок FINAL: нет, это пункт 1 Q3, доставлен до плана (`FINAL.md` раздел 1: «Пункт 1, MCP, уже доставлен»).

| # | file:hunk | Что делает | Цитата |
|---|---|---|---|
| M1 | `AGENTS.md @@ -40` | строка о MCP детей, `[D-AGENT-MCP]` | Q1; Q3 п.1 |
| M2 | `DECISIONS.md @@ -966` | решение `[D-AGENT-MCP]` с цитатой Q1 | Q1 |
| M3 | `RQW-agent/README.md @@ -181` | контракт MCP детей; флаги tools не переносятся; снимок серверов при старте | Q1; (a); (f) |
| M4 | `RQW-agent/index.ts @@ -9` | импорт `createMcpExtension` | Q1 |
| M5 | `index.ts @@ -41` | `MCP_TOOLS`, `callerMcp`, `childMcp` | Q1; (f) |
| M6 | `index.ts @@ -1108` | MCP как у вызывающего | Q1 |
| M7 | `index.ts @@ -1115` | `prompt` для секции `<mcp_servers>` | Q1 |
| M8 | `index.ts @@ -1132` | фабрика MCP; источник внукам; секция `<mcp_servers>` в промпте ребёнка | Q1 |
| M9 | `index.ts @@ -1168` | MCP-тулы в allowlist ребёнка | Q1 |
| M10 | `index.ts @@ -1180` | старт клиента после создания сессии | Q1; (f) |
| M11 | `index.ts @@ -1236` | закрытие клиента при release | Q1 |
| M12 | `test/.../RQW-agent/mcp.test.ts` (новый) | тесты MCP детей | Q1 |

## (b) Каждый фрагмент цитаты → результат

### Q1
| Фрагмент | Результат |
|---|---|
| «эти помощники должны уметь, так же как и основные агенты пользоваться мср» | `432c77d9`; `mcp.test.ts`; `[D-AGENT-MCP]`; живые вызовы `mcp__j1__j1_echo` у generic, worker, внука и форка: `J1-catalogue.md`. Не проверено: экспозиция `codemode` и `deferred` у детей (там же, Finding 6). |
| «что за хуйня?» | Эмоция, требования нет. |

### Q2
| Фрагмент | Результат |
|---|---|
| «все саб-агенты должны работать также как основной чат» | SA1-SA10 ниже. Границы, принятые владельцем: (a) флаги `--tools`/`--exclude-tools` детям не идут; (b) форк с `tools` остаётся байтовой копией; (f) MCP снимком; K: Communication, UI, автоимя только main. |
| «доступ к скиллам» | SA6 `skill-mentions.test.ts`, `SA6.md`; SA7 `skill-command.test.ts`, `skill-selection.test.ts`, `SA7.md`; поздний steering `754d093c`; живые брифы `J1-reviewer.md` п.4. Не закрыто: см. Q3 п.5. |
| «к ревьюерам» | Профили у детей были до диапазона; каталог Spotty и Bossy у детей: `J1-catalogue.md`; SA8 донос слов владельца: `J1-reviewer.md` п.3; RV1 R1, R2 в `f4d10f3b`. Не сделаны: R3, R4, R5 (одобрены, но удержаны) и RV2. |
| «к саб агентам» | Рекурсивный `agent` у детей был до диапазона. Внуки вживую: `J1-catalogue.md`, `J1-reviewer.md`, `J1-sleep.md`. |
| «ко всем тулам такой же как в основном чате» | MCP `432c77d9`; браузер SA2; chat-тулы SA3; `rename_session` SA5; удержание SA1. Живой каталог main против каждого вида ребёнка: `J1-catalogue.md` (на `63ef1299`). Отличие «chat-тулы прямые, не deferred» исправлено в `027f0f34`, доказано тестом `synthetic-tabs-link-child.test.ts` и живыми прогонами на `f4d10f3b`: `SA3-fix.md` прогон 2 (generic) и `J1-fork-deferred.md` ячейка A (worker, внук, форк). Граница (a); тул будущего расширения дойдёт только через фабрику (`FINAL.md` раздел 7 п.11). |

### Q3
| Фрагмент | Результат |
|---|---|
| «Делай так, чтобы у агентов было всё то же самое» | Как Q2; плюс SA4: `synthetic-agent.test.ts`, `SA4.md` (живой `wait_answer` → `steered` после перезапуска Pi). |
| «и проверь, что в этом проекте работ нет ничего, что я не заказывал, никакой лишней хуйни» | Этот файл, разделы (a) и (c). |
| «Там всё должно на 100% совпадать и покрывать требования, которые я заявил» | Раздел (b). Не 100%: открытые пункты перечислены в строках «Не закрыто» и в `ACCEPTANCE.md`. |
| «Дословные мои цитаты должны быть закрыты полностью в исполнении» | Раздел (b); SA8 доносит дословные слова владельца до ревьюера внука, также после сжатия и перезапуска (`J1-reviewer.md` п.3). |
| «но ничего от себя не должно быть. Ничего, что не было прямо заказано.» | Раздел (c): hunk без цитаты нет. |
| п.1 MCP | `432c77d9`; `J1-catalogue.md` (вызовы у четырёх видов детей). |
| п.2 «браузер» | SA2: hunk 37-38, 66-69; `SA2.md`; `J1-catalogue.md` (open, markdown у четырёх видов; `run` на Codex у четырёх видов); `J1-sleep.md` (удержание 7,8 мин, `stop` закрывает только дерево, сон после закрытия вкладок). `run` с исполнителем Anthropic падает и в main, это не разрыв детей. |
| п.3 «инструменты связи чатов и строка о них в тексте» | SA3: hunk 47-51, 77, 80; `SA3.md`; `J1-catalogue.md` (все четыре вызова у четырёх видов). Строка `CHAT_TOOLS_HINT` (`RQW-tabs-link/visibility.ts:4`) без правки. После `027f0f34` тулы ребёнка deferred и грузятся через `tool_search`, как в main: тест `test/synthetic-tabs-link-child.test.ts` и `SA3-fix.md` прогон 2 на `f4d10f3b` (generic-ребёнок: `list_chats` до поиска — `Tool list_chats not found`, `tool_search rqwchat` — `Loaded 4 tools`, `list_chats` после — без ошибки, список пуст). Worker, внук и форк: `J1-fork-deferred.md` ячейка A на `f4d10f3b`. До поиска объявлено 14 тулов без chat-тулов, `list_chats` даёт `not found`; после `tool_search` загружены 4, объявлено 18 тулов, `list_chats` работает. У форка шаги 2-3 показаны на форке глубины 2. Список чатов пуст. |
| п.4 «переименование сессии» | SA5: hunk 43-45, 71; `SA5.md`; `J1-catalogue.md` (generic, worker, внук, форк; имена в своих JSONL). |
| п.5 «`$скилл` и `/skill:имя` в задаче помощника» | SA6: hunk 7, 17-18, 23-24, 27-34, 46, 62, 72-76, 79; SA7: hunk 15, 19, 23, 28-34, 39-42, 61, 70. Вживую доказано: generic, worker и внук выполняют `$name`, ссылку и `/skill:` (`SA6.md`, `SA7.md`); форк выполняет `$name` (`SA6.md`, ответ `PARITYPROBE_OK`) и `/skill:` (`SA7.md`, ответ `PARITYPROBE_OK You are the fork…`); бриф ревьюера байт в байт (`J1-reviewer.md` п.4, SHA-256 `913640ab…`). Форк со skill-ссылкой: `J1-fork-link.md`, сборка `f4d10f3b`. Сохранённая первая задача форка — раскрытый блок `parityprobe` и строка роли; первый ответ форка `PARITYPROBE_OK`, без вызова тулов, внуков нет. Это одна выборка. В раннем прогоне `SA6.md` первый такой форк счёл себя корнем и запустил вложенный форк. Также не закрыто: в `SA7.md` generic 5 и внук 5 с include сочли историю инструкцией. |
| п.6 «ревьюер от помощника не видит твоих слов» | SA8: hunk 12-14, 20, 28, 63; тексты A2-A4; `SA8.md`; `J1-reviewer.md` п.3 (внук не видел строку, Spotty видит; то же после сжатия и перезапуска Pi). Не в диапазоне: строка-пометка о `<skill>`-блоках (M1, коммит `d71ea998` вне диапазона), ждёт одобрения; `J1-reviewer.md` фиксирует её отсутствие. |
| п.7 «помощник думает, что он на модели главного чата» | SA9: hunk 3, 17, 26-27, 36, 57-59; текст A5; `SA9.md`; `J1-reviewer.md` п.5 (start, после перезапуска Pi, после restart). |

### Q5
| Фрагмент | Результат |
|---|---|
| «Мне нужны полнофункциональные саб-агенты, такие же, как в Codex и других моделях» | Паритет с main через SA1-SA10, MCP и RV1. Отдельного сравнения с Codex или другими продуктами нет; это не покрыто. |
| «чтобы саб-агенты были настолько же мощны, как и основной агент» | Тулы `J1-catalogue.md`; скиллы SA6, SA7; слова владельца ревьюерам SA8; своя модель SA9; удержание SA1 (`J1-sleep.md`); steering SA4. |
| «Не должно быть никакого разрыва в этом плане у саб-агента» | Разрывы, принятые владельцем: (a), (b), (f). Открытые: пометка M1 ждёт одобрения; R3, R4, R5 одобрены, но удержаны; RV2 не сделана; провал живого случая include в `SA7.md`. |
| «но при этом мы помним про то, что это саб-агенты» | K соблюдён: автоимя и `/rename-gen` только main (hunk 45, 71); Communication детям не идёт (`J1-reviewer.md` п.6); форк без правок промпта (C, hunk 29). |

## (c) Hunk без цитаты и текст вне одобренного

Hunk без цитаты: нет. Все 80 hunk диапазона и 12 hunk `432c77d9` связаны с цитатой и ребёнком (MCP — с пунктом 1 Q3).

Текст для модели:
1. Одобренный: A1-A4 (hunk 4-6), A5 (hunk 36), R1 и R2 (hunk 52-54) совпадают с `TEXT-DIFFS.md` байт в байт. В трёх копиях роли меняются только эти две фразы.
2. Вне одобренного, решает владелец. Hunk 41-42 с hunk 28: для ребёнка отключённый `/skill:` бросает ошибку. Её текст — уже существующая строка предупреждения `Skill <name> is disabled by the Codex config`. В main она только в интерфейсе (`notify`); у ребёнка она попадает в результат тула `agent` и видна вызывающей модели. Это расходится с SA7 «disabled как в main» (`SA7.md`, строка «Disabled command differs from main»).
3. Не изменение текста. Дети получают тулы main с прежними описаниями: `browser`, четыре chat-тула, `rename_session` (перенесён байт в байт).
4. Вне диапазона, до плана. `432c77d9` добавляет в промпт ребёнка секцию Pi `<mcp_servers>`. Это Q1, `[D-AGENT-MCP]`.

Прочие замечания:
- Hunk 32: steering ревьюера идёт через приватный `_queueSteer` (`agent-session.js:1813`), чтобы Pi не раскрыл `/skill:` в брифе; при другой форме откат на `session.steer`. Риск только при обновлении Pi.
- Hunk 15: `disableModelInvocation: false` для всех скиллов каталога ребёнка. Pi использует флаг только для списка скиллов в промпте (`skills.js:279`); промпт ребёнка принудительный, видимого эффекта нет.

Итог: 80 hunk диапазона + 12 hunk MCP = 92 строки; без цитаты 0; один текст для модели вне одобренного (ошибка disabled-скилла у ребёнка, существующая строка).
