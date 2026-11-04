# Приёмка SUBAGENT-REVIEW-PARITY (J1)

## Текущее состояние на 2026-11-04

- RV1 доставлена: `f4d10f3b`, `e65532c9`. Прежнее удержание R3-R5 больше не отражает текущее состояние; строгий scope заменил прежний R3, как указано в `TEXT-DIFFS.md`. Не утверждается, что весь старый текст R3 поставлен без изменений.
- SA8 доставлена: `f2c05e93`, `6d80b5a5`. Владелец принял пометку: «правку 11 я принимаю».
- Codex fork: PASS на `e65532c9`. В исходной ветке 12 записей; семь элементов входа скопированы в порядке, восьмой — единственная задача. Полные wire-кадры не сравнивались байт в байт из-за метаданных транспорта. Доказательство: `/Users/arkadijcukavin/ai-project/my-pi-evidence/designs/joint-consensus/acceptance`/`J1-codex-fork-live.md`; сырые данные: `/Users/arkadijcukavin/ai-project/my-pi-evidence/designs/joint-consensus/acceptance`/`raw/2026-11-04-live-tail/`.
- SA8 после настоящего сжатия: PASS на `e65532c9`. Запись compaction `529ce743`, строка 16 родительского JSONL; маркера нет в summary и первом запросе после сжатия. В единственной задаче ребёнка `ROOTSA8QXZNOVEMBER` встречается один раз. Доказательство: `/Users/arkadijcukavin/ai-project/my-pi-evidence/designs/joint-consensus/acceptance`/`SA8-compaction-live.md`; сырые данные: `/Users/arkadijcukavin/ai-project/my-pi-evidence/designs/joint-consensus/acceptance`/`raw/2026-11-04-live-tail/`.
- Осталась только RV2, ожидает обсуждения владельца о benchmark. Родитель остаётся In Progress.

## Исторический снимок до текущего состояния

Всё ниже относится только к указанному историческому диапазону и не описывает текущие статусы. Текущие изменения и ограничения приведены выше. Старые счёты hunk и незавершённое ревью аудита не распространяются на последующие коммиты; нового CLEAN здесь не заявлено.



Объект: `origin/release` `d8557b76` → `f4d10f3b`, worktree `/private/tmp/srp-d2`; плюс ранее доставленный MCP `432c77d9`.
Пункты приёмки: `FINAL.md` раздел 1, пункты 1-8. Scope-аудит: `J1-AUDIT.md`.
Живые прогоны J1 шли на сборке D1 (`63ef1299`; `J1-sleep.md` на `92a99d4c`, который отличается только тестом). Изменения D2 доказаны тестами. Вживую на `f4d10f3b` проверены `027f0f34` (`SA3-fix.md` прогон 2, `J1-fork-deferred.md` ячейка A), первый запрос форка (`J1-fork-deferred.md` ячейка B) и форк со skill-ссылкой (`J1-fork-link.md`); `754d093c` и текст роли `f4d10f3b` вживую не проверялись.

## Коммиты диапазона (`git log --oneline d8557b76..f4d10f3b`)

| SHA | Сообщение | Ребёнок |
|---|---|---|
| `f4d10f3b` | RQW-review: RV1 reviewer role text no longer claims the tool assembles the brief (R1, R2) | RV1 |
| `027f0f34` | RQW-tabs-link: SA3 chat tools stay deferred in children | SA3 |
| `754d093c` | RQW-agent: SA6 late reviewer steering is not skill-expanded | SA6 |
| `92a99d4c` | tests: SA6 reviewer paths use fileURLToPath (Windows) | SA6 |
| `63ef1299` | RQW-agent: SA10 agent description matches what children now have | SA10 |
| `5f170c17` | RQW-agent: SA9 own Model line for children that inherit the caller prompt | SA9 |
| `ca349f82` | RQW-browser: SA2 browser for children | SA2 |
| `91b2a1d6` | RQW-agent: SA1 close and retain children | SA1 |
| `f2c05e93` | RQW-agent: SA8 root include source | SA8 |
| `85446768` | RQW-agent: SA7 expand skill commands | SA7 |
| `2d08e86f` | RQW-agent: SA6 expand skill mentions | SA6 |
| `27c3b717` | RQW-agent: SA4 steer restored child through its session | SA4 |
| `7d60741e` | RQW-tabs-link: SA3 chat tools for subagents | SA3 |
| `1a1e80fd` | RQW-naming: SA5 offer rename_session to subagents | SA5 |

Вне диапазона: `432c77d9` (MCP детей, Q1, доставлен до плана).

## Пункты приёмки

| # | Пункт `FINAL.md` | Итог | Evidence |
|---|---|---|---|
| 1 | Generic, worker, внук и форк реально вызывают MCP, `browser`, четыре chat-тула, `rename_session`, `$name`, skill-ссылку и `/skill:`; Spotty и Bossy по каталогу | PASS | Тулы: PASS у всех четырёх видов (`J1-catalogue.md` на `63ef1299`; удержание и `stop` браузера: `J1-sleep.md`, `SA1.md`, `SA2.md`; chat-тулы `SA3.md`; rename `SA5.md`). Spotty и Bossy: тот же каталог, без вызовов (`J1-catalogue.md`). Скиллы: `$name` и `/skill:` PASS у всех четырёх видов, skill-ссылка PASS у generic, worker и внука (`SA6.md`, `SA7.md`). Форк со skill-ссылкой: PASS по `J1-fork-link.md` (сборка `f4d10f3b`). Сохранённая первая задача форка — раскрытый блок `parityprobe`; первый ответ форка `PARITYPROBE_OK`, без вызова тулов, внуков нет. Это одна выборка. Ранний прогон из `SA6.md`, где первый форк счёл себя корнем, этим не отменяется. Chat-тулы детей после `027f0f34` deferred вживую на `f4d10f3b` (`SA3-fix.md`, прогон 2, generic-ребёнок): `list_chats` до поиска — `Tool list_chats not found`; `tool_search rqwchat` — `Loaded 4 tools`; `list_chats` после — без ошибки. Список чатов был пуст; доставка другому чату показана до исправления (`SA3.md`, `J1-catalogue.md`). Worker, внук и форк: deferred PASS по `J1-fork-deferred.md` ячейка A (`f4d10f3b`, Sonnet low). У каждого до поиска объявлено 14 тулов без chat-тулов, `list_chats` даёт `Tool list_chats not found`. `tool_search rqwchat` даёт `Loaded 4 tools`, дальше объявлено 18 тулов, `list_chats` работает без ошибки. У форка шаги 2-3 показаны на форке глубины 2: первый форк повторил запрос корня. В чистом прогоне ячейки B форк глубины 1 пропустил шаг 1, но переход с 14 на 18 тулов и работающий `list_chats` там тоже есть. Список чатов везде пуст: доставка другому чату после исправления не проверялась, до исправления она показана в `SA3.md` и `J1-catalogue.md`. Засчитаны прогоны, записанные в `J1-fork-deferred.md`. |
| 2 | Первый запрос форка соответствует решению (b) | PASS: Anthropic, включая явные `tools`; Codex вживую не запускался | Решение (b): байтовая копия. `J1-fork-deferred.md`, `f4d10f3b`, тела сняты с провода через `fetch`. Ячейка B, форк без `tools`, `wire.jsonl`: первый запрос форка = последний запрос вызывающего плюс одно сообщение задачи в конце, +415 байт. Ячейка B2, форк с `tools: ["bash"]`, три прогона на Opus (`wire-bashA.jsonl`, `wire-bashC.jsonl`): то же, +276 байт. Во всех случаях `system`, `tools` (14, тот же порядок), метки кеша и прежние сообщения совпадают байт в байт; среди заголовков отличается только `x-client-request-id`. При `tools: ["bash"]` первый запрос по решению (b) объявляет тулы вызывающего. Следующие запросы идут со своими тулами форка. `bash echo forkok` вернул `forkok`. Вызов отсутствующего тула вживую не случился, его покрывает `fork-anthropic.test.ts:149`. Codex: в print-режиме main Codex запустить не удалось, две попытки ушли на Opus. Путь Codex форка (`delete copy.previous_response_id`, `input_text`) на проводе не наблюдался, есть только тесты форка (`SA7.md`). |
| 3 | Внук запускает Spotty с `include`; ревьюер получает строку владельца, которую внук не видел; то же после перезапуска Pi | PASS | `J1-reviewer.md` п.3 (также после настоящего сжатия), `SA8.md`. Пометка о `<skill>`-блоках из SA8 не в диапазоне: удержана. |
| 4 | Бриф ревьюера после шага `$skill` байт в байт; обычная задача раскрывается как в main | PASS | `J1-reviewer.md` п.4 (SHA-256 `913640ab…` у task и первого сообщения), `SA6.md`; поздний steering ревьюера: `754d093c`, тест `synthetic-agent.test.ts` (только тест). |
| 5 | Terra-ребёнок Opus-чата читает `openai-codex/gpt-6.1-terra` | PASS | `J1-reviewer.md` п.5 (start, после перезапуска Pi, после restart), `SA9.md`. |
| 6 | Обычные дети и ревьюеры не получают Communication; модели и effort прежние | PASS | `J1-reviewer.md` п.6 (проверенные пути). |
| 7 | RV2 пройдена | PENDING | RV2 не запускалась. |
| 8 | J1: каждый hunk связан с цитатой, каждый фрагмент цитаты с результатом; Spotty CLEAN на файле аудита | PENDING | `J1-AUDIT.md`: 80 hunk диапазона и 12 hunk MCP, без цитаты 0. Bossy дал 2 находки, обе исправлены в этой версии. Повторное ревью и Spotty CLEAN ещё не получены. |

## Одобрено и поставлено

| Что | Одобрение | Где |
|---|---|---|
| A1-A5 | «да» и ответы в `D1-BRIEF2.md:2` | `63ef1299`, `5f170c17` |
| R1 (`REVIEWER.md:1`) | «да» | `f4d10f3b`, во всех трёх копиях роли |
| R2 (`REVIEWER.md:3`) | «да» | `f4d10f3b`, во всех трёх копиях роли |

## Удержано или не одобрено, не в диапазоне

| Что | Состояние |
|---|---|
| Пометка M1 в `<user_messages>` о `<skill>`-блоках (SA8) | Коммит `d71ea998` вне диапазона; ждёт одобрения владельца (`TEXT-DIFFS.md` Batch 3). |
| R3 (`REVIEWER.md:7`) | Одобрено «да», но УДЕРЖАНО более новым поручением владельца. Не сделано. |
| R4 (шаблон `SKILL.md:11-16`) | Шаблон одобрен «9й да», но весь R4 УДЕРЖАН, пока консенсус по строгому scope не решит судьбу строки «Always include…». Не сделано. |
| R5 (`README.md:20-25`) | Одобрено «10 да», но УДЕРЖАНО вместе с R4: оно описывает шаблон R4. Не сделано. |
| RV2 | Ждёт снятия удержания R3-R5. |
| J0: BACKLOG, `DECISIONS.md`, `AGENTS.md`, README | После J1. |

## Отклонения, найденные вживую

1. Chat-тулы у детей были активны сразу, а не deferred, как в main (`J1-catalogue.md` Finding 1). Исправлено в `027f0f34`: offer с именами `*` разрешает тулы, но не активирует. Доказано тестом `test/synthetic-tabs-link-child.test.ts` и живым прогоном 2 в `SA3-fix.md` на `f4d10f3b` (generic-ребёнок: до поиска тула нет, после `tool_search rqwchat` загружены 4, `list_chats` работает).
2. `browser run` с исполнителем Anthropic (`claude-haiku-5-5`) падает и в main (`J1-catalogue.md` Finding 3). Это не разрыв детей: на Codex `run` прошёл у всех четырёх видов.
3. Отключённый `/skill:` у ребёнка: ошибка уходит в результат тула `agent` с уже существующей строкой предупреждения `Skill <name> is disabled by the Codex config`. В main эта строка только в интерфейсе, модель её не видит. Текст для модели вне одобренного, решает владелец (`J1-AUDIT.md` раздел c, `SA7.md`).
4. В раннем прогоне `SA6.md` форк со skill-ссылкой не выполнил скилл сам: он копирует запрос корня и повторил его. В `J1-fork-link.md` при задаче с ролью форка, на `f4d10f3b`, форк выполнил ссылку напрямую. Это одна выборка.
5. В `SA7.md` generic и внук с `include` сочли включённую историю инструкцией и не дали ответа скилла.
6. Main в print-режиме завершился с кодом 0, пока форк ещё работал: последний ответ main был только размышлением без текста (`J1-catalogue.md` Finding 4). Причину не исследовали. Повторный запуск форка отдельно завершился.
