# my-pi: decisions

Decisions in force today, with the owner's words, the reason and the file that carries each. Superseded, obsolete and
merged entries are kept word for word in [DECISIONS-ARCHIVE.md](DECISIONS-ARCHIVE.md); measurement and probe ledgers
live in [notes/decisions-evidence.md](notes/decisions-evidence.md); open and deferred work lives in [BACKLOG.md](BACKLOG.md).

Provenance:

- An `Owner` quotation in guillemets is one contiguous span of a single user message, copied byte for byte.
  Nothing inside it is shortened, translated, retyped or normalized. Coordinator text and entry-name citations use
  ASCII quotation marks, not guillemets; only genuine owner words use guillemets.
- The locator `<session>:<line>` names a session file in `~/.pi/agent/sessions/--Users-arkadijcukavin-ai-project-my-pi--/`
  by the time in its name and the physical JSONL line of the user entry: `13-49-40` is
  `2026-10-21T13-49-40-938Z_01a15eb9-8cc9-702f-8d8c-a2eed8f80923.jsonl`, `16-27-59` is
  `2026-10-21T16-27-59-062Z_01a15f4a-7ad5-7377-81be-0baf3b6ffa33.jsonl`.
- `C:<line>` names the physical JSONL line of the older omp conversation
  `~/.omp/agent/sessions/-ai-project-my-pi/2026-10-20T13-55-12-982Z_01a15998-41d6-76f4-be02-a0e599d0c214.jsonl`.
- Text recorded earlier as an owner quotation but not found verbatim in a user entry of the session files above is
  labelled `Coordinator text`. Coordinator proposals, questions and interpretations are labelled the same way; they
  record the agents' wording, not direct owner approval of each detail, and do not narrow the owner's requirements.
- Every entry has a stable ID `[D-<SECTION>-<NAME>]`; IDs are never reused, archive entries (`A-...`) and
  `BACKLOG.md` refer to them. `Since` is the oldest commit whose `DECISIONS.md` carried the rule
  (`git log -S'<phrase>' -- DECISIONS.md`).
- Only the quoted lines are copied from the sessions; no full transcript and no credential is copied into this
  repository.

## Work policy

Execution rules live in [PROCESS.md](PROCESS.md); an entry here keeps the owner's words, the reason and a link.

- **Archive of decisions** `[D-WORK-ARCHIVE]`. `DECISIONS.md` holds only decisions in force. A superseded, obsolete or
  merged entry moves word for word to the append-only root file `DECISIONS-ARCHIVE.md`, with its status, replacement ID,
  introducing commit and original lines. Measurement and probe ledgers move to `notes/`, open and deferred work to
  `BACKLOG.md`. This is the one exception to the "no archive copies in the repository" rule of
  [PROCESS.md](PROCESS.md#isolated-parallel-execution). Owner (`16-27-59:4099`):
  «Еще задача такая: надо decision, всю нашу документацию чистить от старого мусора, проверить её на консистентность и выбросить старые решения, которые уже больше ни в каком виде не актуальны. Зачистить бэклог. Не удалять эти решения из репозитория — они же где-то сохранены, кроме этого decision, да? Или это и есть место, где они сохраняются? Я так понимаю, что у нас есть лог всех decision, на базе которого можно сверить каждую задачу. Или это и есть этот файл decision? Надо понять. Я хочу, чтобы у нас было такое место, где можно потом однозначно все decision проверить по истории, но при этом, чтобы наши документы, с которыми работает агент на постоянке, не были засраны хуйнёй. Не знаю, правильно ли понял ты меня, правильно ли я объяснил или нет.»
  Reason: every decision stays checkable by history while the documents agents read routinely carry only current
  rules. Carriers: `DECISIONS.md`, `DECISIONS-ARCHIVE.md`, `BACKLOG.md`, `notes/decisions-evidence.md`, `PROCESS.md`.
  Since: the docs-cleanup squash (`git log -S'D-WORK-ARCHIVE' -- DECISIONS.md`).
- **Coordinator** `[D-WORK-COORDINATOR]`. Main is the coordinator, not an independent implementer. Owner (`13-49-40:282`):
  «Да, он как техлид/тимлид, координатор, но не исполнитель самостоятельный.»
  Reason: orchestration and acceptance stay with Main, execution with worker subagents.
  Carrier: [PROCESS.md, Isolated parallel execution](PROCESS.md#isolated-parallel-execution). Since: `4d8c004`.
- **Executor role** `[D-WORK-EXECUTOR-ROLE]`. When the owner tells Main to do something, Main starts a subagent that does
  it. Owner (`16-27-59:4025`, `16-27-59:4034`):
  «Когда я говорю, что ты должен что-то сделать буквально, это значит, что ты должен поднять саб-агента, который это сделает. Не забывай свою роль и запиши это, зафиксируй, чтобы больше так не наёбываться.»
  «Я всегда с тобой разговариваю так, как будто ты и есть мой исполнитель. Потому что для меня ты исполнитель, но ты сам работаешь в рамках роли, которая тебе назначена. И ты должен это помнить, и ты должен этому следовать всегда. Ты не должен никогда от этого отклоняться. Понял? Это супер важно.»
  Reason: asked to arbitrate judge disputes himself, the coordinator once read run files in its own thread.
  Carrier: [PROCESS.md, Isolated parallel execution](PROCESS.md#isolated-parallel-execution). Since: `30952e6`.
- **Non-blocking coordinator and parallel limit** `[D-WORK-PARALLEL]`. Main never blocks its own thread on waits,
  polling, CI watching, test runs or other long work; subagents do it. At most 10 first-level subagents run in parallel;
  nested ones do not count; a ceiling, not a quota. Owner (`16-27-59:2462`):
  «Одновременно до 10 первого уровня, вложенные похуй»
  Reason: Main stays free to coordinate and talk to the owner.
  Carriers: [PROCESS.md, Isolated parallel execution](PROCESS.md#isolated-parallel-execution) and a short line in
  `AGENTS.md`; the product prompt `extensions/RQW-prompt/SYSTEM.md` does not carry it. Since: `47868b0`; limit 10 since `57fa3ff`.
  Historical parallel-limit source: `DECISIONS-ARCHIVE.md`, A-0003, USER entry at session line 2462.
- **Development worker models** `[D-WORK-MODELS]`. Rule for developing this repository with agents only, as the
  owner confirmed; it is not a product model setting and not a rule for the rest of Pi. Three task classes:
  ordinary, complex, and the hardest and most important. The classes, their model and reasoning pairs and the
  machine-readable settings live only in the `coordinator-rules` JSON block of
  [PROCESS.md, Worker models](PROCESS.md#worker-models); this entry does not repeat the pairs. Main starts only
  ordinary `agent` subagents, gives `model` and `thinking` explicitly on every start and restart, and never starts
  `code_writer`, `shell_runner` or `explore` itself. Those workers, explorers and `review` are used by the
  subagents Main starts. The even Anthropic/GPT balance stays (entry below). Product review `LEVELS` and the fixed
  models of the workers are unchanged.
  Owner's messages, each whole and unchanged, from the session file
  `2026-10-21T16-27-59-062Z_01a15f4a-7ad5-7377-81be-0baf3b6ffa33.jsonl`; the physical JSONL line is named before
  each. The second message cancels the Opus 5.5 low part of the first; the last message is the final table.
  Line 4162:
«Короче, по моделям. Сейчас, смотри, как я тебе скажу. Новые модели сабоагентов используешь для сложных задач: Sol-6.1 High и Opus Medium. Для простых задач используешь Opus Low и Sonnet High. Смотри, самая тупая модель — Opus Low, потом идёт Sonnet High. Это для простых задач. Для сложных задач — Opus Medium. Теперь по чату GPT-6.1. Sol Low для простых задач, Sol Medium для простых задач. Нет, не так. Смотри, по-другому. Для простых задач Opus Low и Sol Low. Для сложных задач это Sol Medium, Sol High либо Sonnet High, Opus Medium. Как понял, подтверди, пожалуйста.»
  Line 4179:
«Не, нихуя отмена! Простые задачи не Opus 5.5 low, а Sonnet 5.5 medium. У тебя Sonnet 5.5 medium и Sol 6.1 low. Вот так.

Opus 5.5 Low — это слишком дорого»
  Line 4183, the scope:
«Но это касается только нашего с тобой Process MD. Это не на весь наш Pi, а именно на нашу репозиторию текущую, по нашему Process MD. Ты же понимаешь это, да или нет?»
  Line 4188:
«Да, и надо ещё чётко сконфигурировать, записать, отразить в правилах работы агента, что сложные задачи OPUS 5.5 Medium, Sonnet High и Sol 6.1 Medium, Sol 6.1 High. Я не знаю, понятно тебе это или нет, но OPUS 5.5 Medium в разы сильнее, чем Sonnet High. Если сложные делить на простые и ещё более сложные, если делить сложные на задачи попроще и посложнее, то посложнее делает Medium, а Sonnet High делает попроще. Ты это понимаешь, надеюсь, или нет? Потому что с Sol 6.1 всё понятно: там Medium слабее, а High сильнее.

Это очень важно, чтобы не было такого, что ты на сложные задачи захуяриваешь solve high, а на более простые solve medium, блядь.

Мне важно в этом плане с тобой, чтобы у нас была согласованность полная»
  Line 4203, the final answer:
«Да, ты прав. Это противоречие очень жёсткое и важное. Давай так сделаем. Смотри: Opus Medium и Soul High работают с самыми сложными задачами, а просто со сложными задачами работает Sonnet High и Soul Medium. Давай сделаем.

У нас есть обычные задачи, сложные задачи и очень сложные, очень важные задачи. Так яснее?
Я решил конфликт или еще нет?

А почему у тебя дети молча получают родительскую модель? Такого не должно быть. Ты детей назначаешь сам. У тебя единственный, кто получает родительскую модель — это Explorer. Explorer получает родительскую модель, но это в обычной работе. А ты координатор, ты работаешь отдельно, у тебя другой flow, свой собственный. Понимаешь разницу?

Да, и эти worker, code writer, shell runner работают на Haiku 5.5 Low. Блядь, в твоих словах есть смысл. Runner остаются на тех ролях, на которых они заложены. Code writer, shell runner, explorer. Но ты как координатор эти модели не используешь сам, ты их не запускаешь. Ты запускаешь обычных сабо-агентов, а они уже пользуются code writer, shell runner, reviewer и прочим. Понимаешь, о чём я?

Ответы на твои вопросы. Простые задачи: Sonnet Medium и Sol 6.1 Low. Сложные задачи: Sonnet 5.5 High, Sol 6.1 Medium. И самые тяжёлые и самые важные задачи: Opus 5.5 Medium и Sol 6.1 High. Всё, 1A, то, что я написал. Теперь рабочие на хайку в этом репозитории запретить. Да! Всё так. Всю работу делают обычные сабо-агенты в таблице, а они уже поднимают workerов»
  Coordinator reading (agent text, not owner words): the final table is the last paragraph of the line 4203
  message; it adds the third class, the hardest and most important tasks; the Opus 5.5 low of line 4162 is
  cancelled; Main does not start `code_writer`, `shell_runner` or `explore`, while its subagents use them on
  their existing fixed roles.
  Reason: owner decision, and the rule must not be lost again, so it has one source and a mechanical guard.
  Carriers: [PROCESS.md, Worker models](PROCESS.md#worker-models) (the JSON block and the rules); the dev-only
  project extension `.pi/extensions/coordinator-guard/` (Main's top-level session in this checkout only).
  Superseded earlier entries: `DECISIONS-ARCHIVE.md`, A-0001 to A-0004.
- **Anthropic/GPT balance** `[D-WORK-BALANCE]`. Owner (`16-27-59:351`):
  «Смотри, надо скорректировать так, чтобы ты как координатор поровну поднимал модели из Anthropic и GPT, чтобы не было перевеса в другим, дисбаланса. Поднимай саб-агенты и те, и те, чтобы лимит расходовался равномерно.»
  «И зафиксирую это в процесс.nd файле, эту информацию на будущее»
  Reason: even use of both subscriptions' limits. Carrier: [PROCESS.md, Worker models](PROCESS.md#worker-models).
  Since: `a7146ae`.
- **Process file and manifesto** `[D-WORK-PROCESS-LINK]`. `AGENTS.md` links `PROCESS.md` with mandatory lazy reading at
  every task and context restoration; procedural rules belong in `PROCESS.md`. `WORKFLOW-MANIFEST.md` is the owner's
  personal lifelong record and aspiration, not package behavior, a gate or an overriding procedure. Owner (`13-49-40:204`):
  «Манифест того, как я делаю свою личную работу.»
  Reason: one procedure that agents reload; the manifesto stays the owner's own. Carriers: `AGENTS.md`, `PROCESS.md`,
  `WORKFLOW-MANIFEST.md`. Since: `8f2ea64`.
- **Research and agreement** `[D-WORK-AGREEMENT]`. Research in parallel first, then ask about all real ambiguity; the
  owner's answers start autonomous execution; agreement is never invented. Owner (`13-49-40:204`):
  «Насчет планки качества все расписано четко. И очень важно упомянуть, что согласованное надо выполнять полностью, лишнего ничего нельзя выбрасывать, нельзя терять согласование, но и нельзя сверх этого ничего придумывать. Нельзя придумывать того, что не было согласовано. Если чего-то согласовано не было, додумывать это нельзя ни в коем случае никогда. Мы делаем минимально необходимый объём работ, согласованный, не более того.»
  «Да, по договоренности вопросам. Когда я работаю, я всегда все довожу до полной однозначности. В моей работе никогда нет никаких спорных моментов, которые мне приходится самому разрешать. Я всегда у заказчика работы разрешаю все конфликтные ситуации, которые есть, опираясь только на решение владельца задачи, а не на свое личное решение. Я сам лично не принимаю решения за заказчика, потому что я не имею на это permission.»
  Reason: decisions belong to the owner. Carrier: [PROCESS.md, Research and agreement](PROCESS.md#research-and-agreement).
  Since: `8f2ea64`.
- **Branches, squash and history** `[D-WORK-BRANCHES]`. Each task works on its own branch and worktree, commits stages
  without an extra gate, finishes with one squash into `main` and cleans up; history belongs in Git. Owner (`13-49-40:204`):
  «Насчет документации. Да, тут тоже все верно. И в документации не должно быть никаких исторических данных. История хранится в гиде. По общению агент отвечает владельцу кратко на русском языке всегда, не на моем языке, а именно на русском. Он отвечает не больше трех абзацев по максимум две строки в абзаце.»
  Reason: current documents carry current facts; Git keeps the history ([D-WORK-ARCHIVE] is the one exception for
  decisions). Carriers: [PROCESS.md, Isolated parallel execution](PROCESS.md#isolated-parallel-execution) and
  [Delivery](PROCESS.md#delivery). Since: `8f2ea64`.
- **Workspace hygiene** `[D-WORK-HYGIENE]`. Preserve the user's changes and secrets; do not fix unrelated failures;
  temporary files go to OS temporary storage; no forks. Reason: the owner's work and credentials stay intact.
  Carrier: [PROCESS.md, Isolated parallel execution](PROCESS.md#isolated-parallel-execution). Since: `8f2ea64`.
- **Heavy checks in CI, saved logs** `[D-WORK-CI-LOGS]`. Owner (`16-27-59:992`, then `16-27-59:1042`):
  «Сделай так, чтобы у тебя были логи числа прогонов на Mac. Это что за хуйня? Такого не должно быть.»
  «Ты запускаешь тесты или что? Ты не можешь проверить это? Это что за хуйня? Почему так, блядь?»
  «Если ты делаешь какие-то тесты, пробы, нагрузки тяжёлые, именно процессорные, то их лучше прогонять в CI/CD, чтобы наш MacBook Air не охуевал. Не лучше, а надо их прогонять в CI/CD.»
  «Нет нихуя не надо это была корректировка именно процесса на будущеее и того что что бы у тебя сохранялись логи»
  Reason: CPU-heavy verification stays off the owner's MacBook Air and every reported number has an auditable log; a
  future work policy, not a measurement request. Carriers:
  [PROCESS.md, Sufficient proof](PROCESS.md#sufficient-proof-without-idle-reruns), [Delivery](PROCESS.md#delivery),
  `.github/workflows/tests.yml`. Since: `fb322d9`.
- **Checks once** `[D-WORK-CHECKS-ONCE]`. Relevant checks run once and their evidence is reused while inputs are
  unchanged; no Linux requirement; docs-only work needs no tests; a squash of the tested head is not retested. Windows
  Node tooling runs through Git Bash; the existing CI `pwsh` bootstrap is allowed infrastructure. Reason: no idle
  reruns. Carrier: [PROCESS.md, Sufficient proof](PROCESS.md#sufficient-proof-without-idle-reruns). Since: `8f2ea64`.
- **Final checks and code reviewer** `[D-WORK-FINAL-CHECK]`. Work ends with an independent completeness-and-consistency
  check; code changes also get a separate bug/quality reviewer through `agent` with `.agents/reviewers/code.md` as its
  system prompt. Installed Pi is updated only for relevant runtime changes. Reason: independent proof without new
  product tools. Carriers: [PROCESS.md, Independent review](PROCESS.md#independent-review), `.agents/reviewers/code.md`.
  Since: `8f2ea64`.
- **Deterministic delivery quality** `[D-WORK-DELIVER-CHECK]`. Owner (`16-27-59:440`, approval `16-27-59:450`):
  «Теперь смотри насчет выполнения задач и пробелов, которые ты нашел. Я же не буду всегда тебя переспрашивать. Если бы я не спросил, ты бы об этом не узнал. Надо поэтому сделать какой-то процесс, как детерминированно эту проблему решить на постоянке, чтобы мне не надо было тебя постоянно переспрашивать, чтобы ты сам следил за качеством. Надо твое предложение по тому, как мы этот пробел будем закрывать.»
  «Правила по Process MD я одобряю»
  Coordinator text, the approved proposal: "1. Тестируется ровно то, что вливается. Если main изменился с момента создания ветки, исполнитель переносит ветку на свежий main. Тесты на Mac и Windows CI проходят на этом итоговом коммите.
  2. Ревью действует только для того коммита, который оно проверило. Любой коммит после CLEAN снова отправляет изменённые места на проверку: и задачу, и код.
  3. Перед каждым слиянием я запускаю скрипт npm run deliver-check <ветка>. Он проверяет три вещи. Ветка содержит текущий main. Windows CI прошёл именно на этом коммите. В описании коммита записаны номера ревью с CLEAN и список того, что не проверено вживую. Если чего-то нет, слияния нет.
  4. В каждом отчёте о готовой задаче я сам даю таблицу доказательств и честный раздел "не проверено вживую", без твоего запроса."
  Coordinator text, interpretation of rule 2: a conflict-free rebase onto `main` needs new tests and CI on the new head
  but no new review; places changed while resolving conflicts go back to review.
  Reason: branches tested alone were squashed onto a moved `main`, and a code-review CLEAN once covered an earlier commit
  while two later fixes landed unreviewed. Carriers: [PROCESS.md](PROCESS.md) (Sufficient proof, Independent review,
  Delivery), `scripts/deliver-check.mjs`, `test/deliver-check.test.ts`. Since: `47868b0`.
- **Temporary result-review route** `[D-WORK-TEMP-REVIEW]`. While RQW-review is disabled, result review runs through an
  `agent` subagent with the new reviewer text and the trailer `Review: agent#N CLEAN`. Coordinator text, the question
  (`16-27-59`, before line 2042): "Слияния, пока ревьюер выключен ... a) Маленькой правкой научить проверку перед слиянием принимать ревью субагентом с текстом ревьюера, с честной отметкой agent#N. В процессе записать, что так делаем, пока ревьюер выключен."
  Owner (`16-27-59:2042`, `16-27-59:2049`, and earlier `16-27-59:1849`):
  «1а»
  «только с текстом нового ревьюера»
  «Сейчас ревьюеров надо отключить, пока мы их не дотюнили.»
  Reason: the gate needs an honest result-review trailer while the reviewer is off. Carriers:
  [PROCESS.md, Independent review](PROCESS.md#independent-review), `scripts/deliver-check.mjs`,
  `test/deliver-check.test.ts`. Since: `9b93931`.
- **Completeness check after every merge** `[D-WORK-COMPLETENESS]`. Owner (`16-27-59:593`):
  «А у тебя есть встроенный процесс, который перепроверяет, что нигде ничего не забыто? То, что я выше озвучивал про то, что у нас работа хуёво делается, и должна быть независимая перепроверка, что каждый влитый pull request действительно соответствует истине, что там всё заебись. Ты, по-моему, уже на эту хуйню решение придумал. У меня вопрос: оно уже работает или нет?»
  Coordinator text, the approved proposal: "a) После каждого слияния и перед итоговым отчётом свежий независимый ревьюер получает все твои сообщения из сессии и историю main. По каждой просьбе он отмечает: сделано и каким коммитом, в работе или ты её отменил. Если у просьбы нет ни одной отметки, это находка. Правило записываю в PROCESS.md."
  Owner (`16-27-59:599`): «Да, один по проверке, что ничего не забыто»
  Reason: a request can be dropped silently between sessions, merges and reports. Carrier:
  [PROCESS.md, Delivery](PROCESS.md#delivery) step 5. Since: `47868b0`.
- **Measurements in waves** `[D-WORK-MEASURE-WAVES]`. Owner (`16-27-59:3044`; `16-27-59:3059` to the five-step plan
  whose step 5 is this rule; `16-27-59:3197`; `16-27-59:3202`):
  «Так блять надо фиксить ты шо гонишь мы нахуй прогоны эти делаем . Мы прогоны делаем не ради прогонов. Мы прогоны делаем для того, чтобы найти косяки, найти хуйню, её пофиксить и делать пиздато всё. А ты, получается, просто всю ночь гоняешь прогоны и жгёшь лимиты. Для чего? Просто чтобы поставить галочку, что мы сделали прогоны нахуй?»
  «Это нихуя не интеллектуально, нахуй. Что-то с этим делать надо.»
  «Давай сейчас все прогоны останови, и мы обсудим дальнейшие шаги. Надо сейчас это все порефиксировать»
  «1а»
  «Смотри, я хочу, чтобы ты в процессе измерений прогонов сразу находил аномалии, сразу находил отклонения и сразу же останавливал прогоны и чинил. Если будут очевидные косяки жёсткие, надо их сразу чинить в моменте . Нет смысла ждать полных прогонов, если мы потом починим и будем заново перепрогонять. Ты на первых запусках, если видишь какую-то хуйню очевидную, надо её фиксить . И первые запуски делай на самых сильных моделях из того перечня, который у тебя есть, чтобы сразу получить отклонение на старте у сильных моделей»
  «Мы не учитываем, что слабые модели в принципе не смогут какие-то вещи делать. Нам главное откалибровать на сильных моделях, а потом посмотрим, как они будут себя вести на слабых»
  Reason: the reviewer-v2 benchmark burned a night on a checker defect visible in its first outputs. Carrier:
  [PROCESS.md, Measurements and benchmarks](PROCESS.md#measurements-and-benchmarks), rules 1-5. Since: `ba1c273`.
- **Third arbiter** `[D-WORK-ARBITER]`. Owner (`16-27-59:4012`):
  «Так, блядь, ты сам эти споры рассуди. Ты же, блядь, выше них. Ты сам спор можешь рассудить, у тебя есть все исходные материалы, ты знаешь, как именно должно всё это работать, и ты должен быть третьим независимым мнением от этих двух судей»
  Reason: a disputed judge label needs an independent decision from the sources; under
  [D-WORK-EXECUTOR-ROLE] a subagent arbitrates. Carrier:
  [PROCESS.md, Measurements and benchmarks](PROCESS.md#measurements-and-benchmarks), rule 7. Since: `30952e6`.
- **Supervised runs without caps** `[D-WORK-NO-CAPS]`. Owner (`16-27-59:3919`):
  «Нахуй ты вообще лимиты какие то ставишь? я разве говорил ставить? ты наблюдаешь за запусками следишь как себя агенты ведут и сам их прерываешь, но ты их не полишь, а опрашиваешь прграмно раз допустим в 1-3-5 минут.»
  «ну я имею ввиду не лично ты а тот кто делает замеры»
  Reason: a pilot once stopped on a self-imposed request cap after harness pauses used it up; caps are not stop
  conditions. Carrier: [PROCESS.md, Measurements and benchmarks](PROCESS.md#measurements-and-benchmarks), rule 6.
  Since: `c7baf0c`.
- **Short replies** `[D-WORK-SHORT-REPLIES]`. Owner (`13-49-40:204`, the line quoted in [D-WORK-BRANCHES], then):
  «Если это не требует расширения, конечно»
  Reason: the owner reads short Russian answers. Carrier:
  [PROCESS.md, Communication and continuity](PROCESS.md#communication-and-continuity). Since: `8f2ea64`.
- **CI evidence for a test file that dies** `[D-WORK-CI-EVIDENCE]`. Coordinator decision (technical), no owner quote:
  the `npm test` steps keep Node's default log output and also write a TAP copy, uploaded on failure with the job's macOS
  crash reports; a manual stress workflow repeats the 12 MB codemode tests with exit code and peak RSS per run.
  Reason: a test file once died silently on macOS Node 24 and its exit code or signal was not recoverable from the spec
  reporter (run and details: [notes/decisions-evidence.md](notes/decisions-evidence.md#ci-dying-test-file)).
  Carriers: `scripts/ci-npm-test.sh`, `.github/workflows/tests.yml` (artifact `test-evidence-*`, with
  `/Library/Logs/DiagnosticReports`), `.github/workflows/codemode-stress.yml` (input `runs`, `summary.tsv`).
  Since: `8547d59`.

## Scope

- **Pi version** `[D-SCOPE-PI-VERSION]`. Pi 1.4.0 is the one supported and tested version; 1.3.0 is no longer supported
  and the range is not widened to future versions. Owner (`16-27-59:1839`, `16-27-59:1887`, `16-27-59:1953`):
  «Да. И параллельно, пожалуйста, вот что нужно сделать. Надо понять, сможем ли мы сейчас апгрейдить весь наш пакет на 1.4 версию Pi. И могу ли я поставить сейчас весь наш пакет без reviewer, только с worker. И так как мы с worker определились, то давай по worker решим, какие задачи остались»
  «1а»
  «Можно начинать уже и можно продолжать всю работу, которая была до этого начата»
  Reason: the 1.4.0 research found only intentional version gates and stale summary-output assertions in the way.
  Carriers: the exact-1.4.0 gates of `RQW-settings` (`selection.ts`, `cache-warming.ts`), `RQW-tools` (`selection.ts`)
  and `RQW-anthropic` (`index.ts`, `retry.ts`, `lifecycle.ts`, `registration.ts`); the shared tool-selection symbol
  keeps one namespace in both copies of `selection.ts`; `package.json` pins the development dependency and the peer
  range to 1.4.0, with `package-lock.json`; PCLI bundles the official 1.4.0 binary ([PCLI](#pcli)). Since: `02bd178`.
- **Extension layer, not a fork** `[D-SCOPE-LAYER]`. my-pi is an extension layer around stock Pi 1.4.0. Coordinator text
  (historical unverified attribution, not found in the session files above): "Мы делаем просто обвес вокруг
  оригинального Pi."; "Нет, никаких форков." Ported UI: `RQW-models`, `RQW-statusbar` and `RQW-send-now`
  ([Models](#models), [Status bar](#status-bar), [Send now](#send-now)); `RQW-scroll` adds one key behavior
  ([Scroll](#scroll)). The UI-port folders `RQW-tool-ui`, `RQW-thinking`, `RQW-theme` and `RQW-naming` are on `main` but
  not registered in `package.json` `pi.extensions` until UI port stage P10 ([BACKLOG.md](BACKLOG.md#open)); Pi does not
  load them from this package. omp-lite's own tool implementations are not carried over; RQW-tools wraps Pi's stock
  tools ([Tools](#tools)). Reason: keep Pi's own behavior and add only agreed extensions. Carriers: `package.json`,
  `extensions/`. Since: `9ef1519`.
- **Public repository** `[D-SCOPE-PUBLIC]`. [ARQAWA/my-pi](https://github.com/ARQAWA/my-pi) is public. Coordinator text
  (historical unverified attribution): "он должен быть паблик". Carriers: the GitHub repository, `INSTALL.md`.
  Since: `10a864c`.
- **Dropped tools** `[D-SCOPE-DROPPED]`. Loading of `eval`, `lsp` and `ast_grep` is dropped for good; Pi has its own
  codemode. Coordinator text (historical unverified attribution): "eval нахуй не нужен, lsp ... ast-grep ...
  выбросить всё это на помойку". Carrier: their absence from `extensions/`. Since: `ee0421a`.
- **Postponed features** `[D-SCOPE-POSTPONED]`. Postponed, not dropped: `codebase_explorer`, `custom`, the
  `define-goal` skill and work orders, and the task list with the check before stopping (later switched on by a skill).
  Coordinator text (historical unverified attribution): "мы их не упраздняем, а откладываем". Status of each item:
  [BACKLOG.md](BACKLOG.md). The `agent`, `review`, `code_writer` and `shell_runner` tools are separate decisions:
  [Agent](#agent), [Review](#review), [Workers](#workers). Since: `d28ae41`.
- **Reviewers** `[D-SCOPE-REVIEWERS]`. Review is our own extension `RQW-review` on `createAgentSession`, not a ready
  package; its contract, levels and models are in [Review](#review). Coordinator text (historical unverified attribution): "То, что ты предложил по ревьюерам — it's OK, я принимаю". Reason: the ready package was too large and failed
  strict schemas ([notes/decisions-evidence.md](notes/decisions-evidence.md#scope-reviewer-package-sizing)). Carrier:
  `extensions/RQW-review/`. Since: `3dce6fa`.
- **Two visible providers** `[D-SCOPE-PROVIDERS]`. `/login` and model lists show only `anthropic` and `openai-codex`;
  the rule and its carriers are in [Providers](#providers). Coordinator text (historical unverified attribution, see
  `C:3171` there): "Это именно отключить. Когда мы заходим в логин, там должны быть только кодекс, авторизация и
  авторизация через Anthropic, которую ты сейчас делаешь. И всё". Since: `c8434b0`.
- **Lean engineering scope** `[D-SCOPE-LEAN]`. Fix obvious major failures, not speculative rare cases; completed native
  physical routing and filesystem identity fixes stay. Coordinator text (historical unverified attribution): "Не надо
  делать микроправки всяких хуёвин, которые возможно никогда не всплывут, и у них редкость возникновения очень высокая,
  вероятность, что они возникнут, крайне мала. Надо править именно очевидные жирные ошибки, а не вылизывать до
  предела."; "ты всю уже выполненную работу собираешь вместе. Просто ты дополнительной работы не делаешь и всё."
  Carriers: `extensions/RQW-context/index.ts`, `extensions/RQW-tools/`, `notes/context-questions.md`; this does not
  promise every rare filesystem or long-path case. Process side: [PROCESS.md](PROCESS.md#isolated-parallel-execution).
  Since: `9ef1519`.

## Structure

- **Everything is an extension** `[D-STRUCT-EXTENSIONS]`. One folder per extension under `extensions/`; a shipped
  extension is listed in `package.json` `pi.extensions`, first `RQW-settings`, second `RQW-prompt`. Fourteen are listed.
  `RQW-tool-ui`, `RQW-thinking`, `RQW-theme` and `RQW-naming` are on `main` but unregistered until UI port stage P10
  ([BACKLOG.md](BACKLOG.md#open)). `pcli-vscode/` is the one non-Pi exception (`AGENTS.md`, [PCLI](#pcli)).
  Coordinator text (historical unverified attribution): "в этом репозитории мы всё будем делать extension... Первый
  extension — это будут настройки, второй — промты, настройки промта". Carriers: `package.json`, `extensions/`.
  Since: `10a864c`.
- **RQW- prefix** `[D-STRUCT-PREFIX]`. Every extension folder carries the prefix `RQW-`. Coordinator text (historical unverified attribution): "у всех наших extension был префикс типа RQW- и название". Carrier: `extensions/`.
  Since: `320e80e`.
- **Tool names as in Pi** `[D-STRUCT-TOOL-NAMES]`. Tool and parameter names stay exactly as in Pi; no `apply_patch`, one
  edit format for every model; requirements are compiled in `notes/tools-requirements.md`. Coordinator text (historical unverified attribution): "имена такие же, как в P... никакой хуйни не надо навяливать из ОМП лайта"; "Нет, не надо
  для GPT patch делать. Пусть работает одинаково везде". Carriers: `extensions/RQW-tools/`,
  `notes/tools-requirements.md`. Since: `320e80e`.
- **Install prompt** `[D-STRUCT-INSTALL]`. `INSTALL.md` is the install prompt: run inside an already installed Pi, that Pi
  installs this package into itself with `pi install`, then requests `/reload` or restart; after `pi update` it requires
  a restart so process-wide patches use updated code. Coordinator text (historical unverified attribution): "чтобы
  можно было его везде воссоздавать, воссобирать с нуля, просто промтом одним через install prompt"; "install.md — это
  про установку именно наших обвесов на уже установленный Pi. Я внутри Pi запускаю этот промпт". Carrier: `INSTALL.md`,
  step 4. Since: `34abcd5`.

## Tools

- **Barrier eligibility tests** `[D-TOOLS-BARRIER-TESTS]`. Fixed and randomized barrier batches check maximal
  concurrency with held operations and an independent conflict oracle: after promise reactions drain, exactly the calls
  without unfinished earlier conflicts must have started. Seeded gate rejections check prompt release after failure and
  success; mutation checks reject ignored dependencies and needless serialization; real-timer batches and nested
  scripts keep ordering, abort, rejection and deadlock checks; no test asserts an elapsed slack cutoff. Owner
  (`16-27-59:591`): «Теперь по нестабильному тесту 1А: myIP на VDI, исправление прокрутки делаю расширением myIP. Да, насчёт myIP в VDI: это только если myIP установлен. Если он не установлен, то поебать вообще.»
  Coordinator text, option 1a: "Отдельной задачей разобрать, почему тест кодмода на Windows иногда не укладывается в 5
  секунд, и исправить причину." This entry is an engineering follow-up under that precedent. Reason: elapsed start
  latency includes host descheduling and garbage collection, which a percentile cutoff cannot tell from false
  dependencies. Carrier: `extensions/RQW-tools/test/barrier.test.ts`; test design:
  [notes/analysis-races.md, Test plan](notes/analysis-races.md#7-test-plan-synthetic-no-model-node---test-under-extensionsrqw-toolstest).
  Since: `f95be18`.
- **Shell timing in comparisons** `[D-TOOLS-SHELL-TIME]`. The stock-versus-wrapper shell-path test compares every result
  field except `structuredContent.wall_time_seconds`; both timings must still be nonnegative numbers. Engineering
  follow-up under the same precedent as [D-TOOLS-BARRIER-TESTS]. Reason: a rounded elapsed time is not shell-path
  behavior. Carrier: `extensions/RQW-tools/test/behavior.test.ts`. Since: `230e8d0`.
- **Wrapped stock tools** `[D-TOOLS-WRAPPERS]`. `extensions/RQW-tools/` replaces `read`, `bash`, `edit`, `write`, `grep`
  and `find` and adds `job`. Each tool spreads the stock definition (parameters, renderers) with our description and
  wraps its `execute`: the wrapper schedules the call in the barrier, may hand it to a background job, takes resource
  claims, appends file notes and checks the write precondition, and calls the stock execution inside; edit and write
  add the multi-file form, and edit drops strict sampling ([D-TOOLS-EDIT-STRICT]). Which tools are on is decided in
  [Settings](#settings). `ls` and other stock tools are not wrapped; Pi's `codemode` is one barrier call
  ([Settings](#settings)). Design: `notes/tools-design.md`; analysis: `notes/analysis-*.md`. Carrier:
  `extensions/RQW-tools/index.ts`. Since: `8889fdf`.
- **edit without strict sampling** `[D-TOOLS-EDIT-STRICT]`. Our edit sets `constrainedSampling` to undefined, so Pi does
  not send it as an Anthropic `strict` tool; read, bash and write keep the stock `strict: "prefer"`. Owner
  (`16-27-59:208`):
  «01a15f4f-7b7e-70e6-b1e2-bb238ce75359»
  «Также в этой сессии поработал агент, и там дохуя ошибок записи. Он делает параллельные эдиты: проредактировал и потом снова делает через время параллельные эдиты. И там целая вереница эдитов красная, с ошибками. Он потом перепосчитал файлы и снова отредактировал. Надо разобраться, этот баг пофиксить.»
  Reason: strict sampling garbled edit arguments where Cyrillic text began, while a strict write of Cyrillic text came
  through intact; the replay and probe numbers are in
  [notes/decisions-evidence.md](notes/decisions-evidence.md#tools-edit-strict-sampling-replay). Carriers:
  `extensions/RQW-tools/index.ts`, `extensions/RQW-tools/test/tools.test.ts` (the Anthropic request has no `strict` on
  edit and keeps it on write). Since: `886b677`.
- **Ordered conflict barrier** `[D-TOOLS-BARRIER]`. A call waits only for earlier calls it conflicts with: bash
  conflicts with every call, read never with read, otherwise an equal path key or an ancestor conflicts. Within one
  response this is the order; a background job of an earlier response holds later calls only as
  [Background jobs](#tools) (D4, H1) says. Reason: prevent conflicting tool calls from racing; bash is serialized against bash because its footprint is
  unknown. Evidence: [race analysis](notes/analysis-races.md). Carriers: `extensions/RQW-tools/barrier.ts`, `extensions/RQW-tools/index.ts`. Since: `8889fdf`.
- **Codemode watchdog test** `[D-TOOLS-CODEMODE-WATCHDOG]`. The 500 KB codemode ordering test streams its faux-provider
  fixture in fixed larger chunks and asserts the delta count; the 5 s deadlock watchdog, payload, ten repetitions and
  ordering assertions stay; no runtime barrier or codemode change. Owner (`16-27-59:591`): the line quoted in
  [D-TOOLS-BARRIER-TESTS]. Coordinator text, option 1a, the task wording: "Отдельной задачей разобрать, почему тест
  кодмода на Windows иногда не укладывается в 5 секунд, и исправить причину". Reason: the test spent its watchdog
  budget streaming tiny deltas before tools could run, not waiting in the barrier. Carrier:
  `extensions/RQW-tools/test/codemode.test.ts`; analysis and proof:
  [notes/settings-codemode.md, Test watchdog](notes/settings-codemode.md#test-watchdog). Since: `9a4068c`.
- **In-place writes with Windows retry** `[D-TOOLS-WIN-RETRY]`. In-place writes stay; on Windows `EBUSY`/`EPERM`/`EACCES`
  are retried for about 1.5 s. Reason: temp file plus rename fails on Windows when another process holds the file.
  Carriers: `extensions/RQW-tools/retry.ts`, `edit.ts`, `write.ts`. Since: `8889fdf`.
- **Search and output limits** `[D-TOOLS-LIMITS]`. grep and find get no match cap by default (`limit` 100000 when unset);
  the stock 50KB output cap stays; read and bash keep the stock 2000 lines / 50KB. Reason: Pi's default 100 grep matches
  cuts the broad first search wave; omp-lite's 51 200-character budget equals 50KB for ASCII. Carriers:
  `extensions/RQW-tools/index.ts`, `extensions/RQW-tools/test/tools.test.ts`, the descriptions. Since: `8889fdf`.
- **Search method section** `[D-TOOLS-SEARCH-METHOD]`. The search wave method lives in the grep description; RQW-tools
  supplies the one-line `<search_method>` section through its own `before_agent_start` hook when read, grep and find
  are declared. Carriers: `extensions/RQW-tools/descriptions/grep.md`, `extensions/RQW-tools/index.ts`. Since: `04aa50f`.
- **Caller's shell and image settings** `[D-TOOLS-SHELL-SETTINGS]`. read and bash are built with the user's settings
  (`shellPath`, `shellCommandPrefix`, `images.autoResize`), as stock Pi builds them. Reason: without `shellPath` a
  Windows setup with Git outside Program Files finds no bash. Carriers: `extensions/RQW-tools/index.ts`,
  `extensions/RQW-tools/test/behavior.test.ts`. Since: `f8cd7e9`.
- **Offered tool factory** `[D-TOOLS-FACTORY]`. `createTools(cwd, settings, nested?, options?)` in `index.ts` builds the
  six base tools and `job` with a barrier and a job registry of their own, plus the caller's `codemode` as one barrier
  call when `options.codemode` is given. The extension registers one set for the session and answers a request on
  `pi.events` channel `rqw-tools:subagent-tools` with `createTools` itself ([Agent](#agent)). Nothing in RQW-tools
  depends on RQW-agent. Carriers: `extensions/RQW-tools/index.ts`; `extensions/RQW-tools/test/tools.test.ts` checks the
  answer and that each call gives fresh definitions. Since: `90700ad`.
- **Read key spellings** `[D-TOOLS-READ-KEY]`. The read key mirrors stock `resolveReadPath` (NFD, curly quote and AM/PM
  variants), so a read and a write of the same file spelled differently still meet in the barrier. Carriers:
  `extensions/RQW-tools/keys.ts`, `extensions/RQW-tools/test/paths-barrier.test.ts`. Since: `f8cd7e9`.
- **Implicit order not described** `[D-TOOLS-HIDDEN-ORDER]`. The tool descriptions do not explain the automatic barrier
  order (bash waits for earlier calls, a read waits for an earlier write); explicit waits on background jobs are
  described. Reason: with those lines gpt-6.1-sol made one call per response; without them it batched
  ([notes/decisions-evidence.md](notes/decisions-evidence.md#tools-barrier-order-lines)). Carriers:
  `extensions/RQW-tools/descriptions/*.md`. Since: `0a2028e`.
- **Benchmark judging** `[D-TOOLS-JUDGING]`. A benchmark answer is judged with 5 judge votes, majority per checklist
  point. Reason: with one vote the bench42 quality gap was judge noise on one point
  ([notes/decisions-evidence.md](notes/decisions-evidence.md#tools-bench42)). Carrier: this rule; results in
  `notes/bench42.csv`, `notes/bench44.csv` and the evidence note. Since: `52efad7`.
- **Code answers in chat** `[D-TOOLS-ANSWER-IN-CHAT]`. `SYSTEM.md` says to answer a question about the code in the chat
  and to create or change files only when the task asks for it. Reason: a bench42 run hit the answer length limit and
  moved its answer into a file ([notes/decisions-evidence.md](notes/decisions-evidence.md#tools-bench42)). Carrier:
  `extensions/RQW-prompt/SYSTEM.md`. Since: `52efad7`.
- **edit and write descriptions** `[D-TOOLS-EDIT-WRITE-DESC]`. The multi-file form comes first, and a rename gets one
  edit per occurrence with enough of its line. A line telling the model that bash sees the changed files again was
  rejected. Reason: probes ([notes/decisions-evidence.md](notes/decisions-evidence.md#tools-description-probes),
  `notes/refine/refine-editwrite.md`). Carriers: `extensions/RQW-tools/descriptions/edit.md`, `write.md`.
  Since: `1628f8c`.
- **read description** `[D-TOOLS-READ-DESC]`. Read a needed file whole in one call and read every file needed next in
  one response; bash does not read or search files. Reason: probes
  ([notes/decisions-evidence.md](notes/decisions-evidence.md#tools-description-probes),
  `notes/refine/refine-readbash.md`). Carriers: `extensions/RQW-tools/descriptions/read.md`, `bash.md`.
  Since: `a0bd1b1`.
- **grep and find descriptions** `[D-TOOLS-SEARCH-DESC]`. The search wave names the spellings to try, reads every file
  the hits already justify in one response, and stops when, for every implementation, it is known where each value is
  set, used and what the code does with it; find shows brace alternatives. Reason: chosen by rule completeness, then
  responses ([notes/decisions-evidence.md](notes/decisions-evidence.md#tools-description-probes),
  `notes/refine/refine-search.md`). Carriers: `extensions/RQW-tools/descriptions/grep.md`, `find.md`. Since: `9e13b55`.
- **Description precision** `[D-TOOLS-DESC-PRECISION]`. grep respects .gitignore inside a git repository only; a grep
  glob with "/" matches from path; find also returns directories; the edit hint may be absent; a cut grep line is read
  around instead of narrowing; a tool result that names cat or sed overrides the ban; a long file written in parts is
  the one exception to one edit call per file. Reason: the second description review
  (`notes/review-descriptions-2.md`). Carriers: the six descriptions in `extensions/RQW-tools/descriptions/`.
  Since: `a56e291`.
- **Implementations that do not run** `[D-TOOLS-INACTIVE-IMPL]`. The prompt asks, for an implementation that does not
  run, where its value is set, where it is used and what that code does; a line asking to name every setting on the
  code path was rejected. Reason: probes
  ([notes/decisions-evidence.md](notes/decisions-evidence.md#tools-inactive-implementation-probe)). Carrier:
  `extensions/RQW-prompt/SYSTEM.md`. Since: `7890a8b`.
- **Fully specified files** `[D-TOOLS-SPECIFIED-WRITE]`. A new file the task fully specifies needs no read of its
  neighbours (one line in `SYSTEM.md`, one in `read.md`); the find example shows that "app" returns the directory only
  while "app/**" returns its files. Reason: probes
  ([notes/decisions-evidence.md](notes/decisions-evidence.md#tools-faster-writing-probes),
  `notes/refine/refine-write2.md`, `notes/refine/refine-find.md`). Carriers: `extensions/RQW-prompt/SYSTEM.md`,
  `extensions/RQW-tools/descriptions/read.md`, `find.md`. Since: `a0b6e75`.
- **Compaction file lists** `[D-TOOLS-COMPACTION-LIMIT]`. Accepted limit: Pi's compaction summary lists changed files
  from `args.path` only, so files given in `write.files[]` or `edits[].path` are missing from that list. Fixing it needs
  a change in Pi itself; the files stay in the transcript and the tool results. The premise was read in Pi's source
  before 1.4.0 and is not re-verified for 1.4.0. Since: `bfb2712`.
- **Background jobs** `[D-TOOLS-BG]`. Owner (`16-27-59:2561`, `16-27-59:2574`, design answers `16-27-59:2598`):
  «Да, и надо, чтобы основной агент. Нет, знаешь как? Надо, чтобы длительные shell процессы сами уходили в фон. Если он работает больше 20 секунд, чтобы он превращался в фоновый процесс, а не оставался висячим активным процессом. Надо, чтобы всё, что висит больше 20 секунд, любая операция, которая висит больше 20 секунд, уходила в background, и можно было просто её пропинговать через какое-то время. Чтобы у агента был инструмент проверки состояния.»
  «только надо время сократить до 12 секунд, после 12 секунд уходит в фон.»
  «1а2а3а»
  «4 - надо разобраться с рейс кондишенами и найти самое интелектальное производительное и эффективное решение марщрутизации и оркестрации тулколов»
  «5б»
  «6а с учетом 4 пункта добавочного»
  Rule: a top-level call of `bash`, `codemode` (the whole script) or `read`, `edit`, `write`, `grep`, `find` that has
  not settled 12 s after it started, barrier wait included, returns at once as `job#N` with the command, elapsed time,
  the output so far and a log file in the OS temp dir, and keeps running; a call that settles sooner returns exactly the
  stock result. Calls inside a codemode script never go to the background. The `job` tool (`wait`, `status`, `kill`; `ids`, `id`,
  `timeout_ms` default 300000 when omitted, `lines` default 20) waits mechanically until one selected job ends or the
  caller's deadline, keeps collecting for 250 ms after the first one ends, shows state, exit code, elapsed time, tail
  and log path, and kills a process job with its process tree or cancels a queued one. Approved caveat: a running
  file-tool job (`read`, `edit`, `write`, `grep`, `find`) cannot be interrupted safely; `job kill` reports
  `cannot_kill` and it finishes on its own. This is a design limit, not a defect; queued file-tool jobs can be
  cancelled. Polling only; the descriptions say to wait for or kill one's jobs before the final answer. A process job
  dies on Esc, `job kill`, its `timeout`, and the caller's shutdown or reload; jobs belong to the session whose call started them (one registry per `createTools`; RQW-agent
  calls the offered `job` definition's `jobs.abortAll()` on interrupt and `jobs.dispose()` on close). `job` is active
  whenever one of these tools is; when Pi's allowlist keeps it off, nothing goes to the background. Reason: long
  operations must not hold the agent, and the agent needs a tool to check them; Codex unified exec yields the same way;
  the threshold is the owner's value.
  Ordering (D4). Owner (`16-27-59:2705`): «1a + живай проверка на хайку и луна хай ризонинга»; option 1a of the ordering
  proposal is named in coordinator text "ordered until handoff, free after". Calls of the same response keep the barrier
  order: a call after a backgrounded job waits for its real end and itself becomes a queued job after 12 s. At the
  handoff a bash or codemode job is detached from the barrier (`detach` in `barrier.ts`, through `nested.ts`); calls of
  later responses wait for it only for the resources it holds (H1). A read, edit or write job keeps its paths. A
  dependency on a background job is explicit: `job wait`, then the dependent call. While a bash or codemode job of the
  caller runs, a read, edit or write of a file changed outside the caller's tools since that job started gets one note
  naming the job.
  Routing (FR-safe). Owner (`16-27-59:3117`, the answer to the routing question): «2а». Holds (H1): at the handoff a
  bash job keeps what `footprint.ts` reads with certainty from its command text: the package folder an install changes,
  the git index and refs of a repository a git command changes (every subcommand except known reading ones), and the
  exact files it writes (redirects, `tee`, `sed -i`, `curl -o`, `rm`, `mkdir`, `touch`, `cp`/`mv`/`ln` destinations).
  `footprint.ts` restores the outer working directory when a subshell closes. Mutating `git symbolic-ref` and
  `git reflog` forms hold the repository; their read-only forms remain reads.
  A later call waits only for these; reads never wait; any doubt holds nothing. Package-folder and git holds are
  process-wide (`ledger.ts`) across main, subagents, workers and reviewers; files are not ordered across sessions, they
  get attributed notes. Effects report (O1): a top-level bash call that can become a job, or a top-level codemode call,
  takes a snapshot of the working tree
  (`git ls-files -co --exclude-standard`, or outside git a walk with one global limit of 20000 files, including
  within a single wide directory, without .git, node_modules,
  .next, target, .venv, __pycache__) right before its command starts, and a job takes another when it ends; what
  changed is the difference of the two states, never a time cutoff. Approved caveat: a bash call with its own
  positive `timeout` of 13 s or less never goes to the background, so it takes no pre-start snapshot. Calls with a
  longer or absent timeout take the snapshot even if they finish before handoff; this is not a snapshot defect. Owner (`16-27-59:3621`), on the cost:
  «Да, если это всего лишь 150 миллисекунд на 20 тыс. файлов, конечно, блядь, надо делать снимок файлов точный. Это 1А.»
  The report lists files created and changed while the job ran (with the other session and tool), the caller's own
  writes, own writes overwritten since, files deleted since the start, and the other jobs that ran alongside.
  Unreadable directories, file-stat failures and git warnings recorded by either snapshot appear in `effects.errors`,
  labelled before the start or at the end; failed or cancelled scans, git listing failures and the global walk bound
  are reported in `effects.errors` or `scanned`. Unchecked paths are explicit, and an inaccessible file is not
  classified as deleted. Write precondition (P1): a write over a file the session has read or written, changed
  since by anyone else, is refused once with who changed it; the identical retry overwrites; a file never seen is
  written without a check. Check, stock tool and ledger record run in one process-wide critical section per file
  (`withFileLock`); files are keyed by native real path (`identityKey` in `keys.ts`); records belong to a registry
  `owner`, the label is only shown. K1: `job kill` also cancels the queued same-response calls that wait for the killed
  job and lists them in `cancelled_followers`; a killed queued call leaves the barrier at once (`withdraw`). N1: a job
  that ended with an unseen non-empty effects report adds one note line to the caller's next top-level tool result.
  W1: `job wait` takes `until`, a JavaScript regular expression on the output (a leading `(?i)` ignores case). S1: a
  codemode script waits as a queued job for a free worker of the process (`PI_CODEMODE_MAX_WORKERS`, default 2). A
  bash call inside a codemode script takes the same process-wide claims. Each session's label comes through the
  optional `options.label` of the offered factory (`main`, `agent#1`, `agent#1/code_writer#2`, `review`, ...).
  Children like main. Coordinator text, technical decision at the rebase onto subagent parity; the parity request,
  owner (`16-27-59:2608`): «Надо что бы саб агенты были как в куросре посмотри реверз инжинеринг и скажи свои предложения».
  With an RQW-tools offer, a child's or reviewer's `codemode` is Pi's definition built from that session's API, passed
  as `options.codemode` and returned as one call of the child's barrier and a job of its registry, so a child script goes
  to the background after 12 s like main's and S1 slots count main and every child together; without an offer the child
  keeps Pi's stock codemode. Explorers get `job` only when offered. The reviewer of RQW-review gets the offered `job`
  tool; Esc of a review aborts its jobs and its end disposes them. The prompt section `rqw_tools_execution` says that a
  background job holds the later calls of its response and, from later responses, only calls that change what it holds.
  Reason: a replay of recorded tool calls left D4 alone with silent overlaps between jobs and later calls; FR-safe
  leaves none silent and keeps the same-response order; the owner chose it. Probes, replay, snapshot cost, pilot defects
  and code-review fixes: [notes/decisions-evidence.md](notes/decisions-evidence.md#background-jobs-evidence); races
  R16-R24: `notes/analysis-races.md` section 9.
  Carriers: `extensions/RQW-tools/jobs.ts`, `barrier.ts`, `nested.ts`, `footprint.ts`, `ledger.ts`, `keys.ts`,
  `index.ts`, `codemode.ts`, `descriptions/bash.md`, `descriptions/job.md`, `descriptions/write.md`;
  `extensions/RQW-agent/index.ts`, `extensions/RQW-agent/roles/*.md`; `extensions/RQW-review/index.ts`;
  `notes/prompt-tools-isolation.md`. Proof: `extensions/RQW-tools/test/background.test.ts`, `barrier-detach.test.ts`,
  `footprint.test.ts`, `ledger.test.ts`; `extensions/RQW-agent/test/wait.test.ts`, `nested-workers.test.ts`,
  `agent.test.ts`; `extensions/RQW-review/test/review.test.ts`, `subagent.test.ts`;
  `test/prompt-tools-isolation.test.ts`. Since: `e5440f2`; scan and footprint safeguards since `e1cca48`.

## Context

- **Physical window and compaction** `[D-CONTEXT-WINDOW]`. For every physical model, W = min(contextWindow, 500000), R = Math.round(W / 10), and compaction starts above W - R. This covers built-in, models.json and extension models, native routing, startup, resume and model switches without a per-model list. The window itself is capped, not just the trigger; physical models up to 500000 keep their original object.
  Coordinator text: this records the existing universal window rule; the historical C:2015/C:2047 quotations have not been verified in the permitted Pi USER sources.
  Reason: apply one automatic rule to every physical target.
  Carrier: `extensions/RQW-context/index.ts` (`contextRule`, `capModel`). Since: `7e00dcb`.
- **Native routing and reserve** `[D-CONTEXT-ROUTING]`. Stable capped copies are exposed through Agent state, `createLoopConfig`, `_buildRuntime` and native `ModelRuntime.getPhysicalModel`; registry entries are not mutated. Virtual selections keep their native identity, callback, thinking and declared or unknown window. Session/request-local `AsyncLocalStorage` supplies the physical target's W/R: automatic preparation uses its triggering target, manual preparation the latest successful response after abort. Default summaries preserve interception preparation and route once from the captured selection, retaining the original explicit reserve intent. On Pi 1.4.0 reserve rebinding does not size summary output; optional removal is tracked in [BACKLOG](BACKLOG.md).
  Coordinator text. Reason: physical limits must not leak across concurrent operations or alter native selection identity.
  Carrier: `extensions/RQW-context/index.ts` (`wrapAgentState`, `wrapRouting`, `wrapCompactionSettings`, `reserveIntents`); details: `notes/context-questions.md`. Since: `6eb01a7`.
- **Explicit settings and accepted limits** `[D-CONTEXT-SETTINGS]`. Pi's global `compaction.reserveTokens` and per-selection `compaction.modelOverrides["provider/id"].reserveTokens` retain their precedence when below W; a reserve of W or more falls back to R. `compaction.enabled: false` still disables threshold and overflow compaction. A positive models.json window is honored up to the cap; absent or nonpositive windows retain Pi's behavior. The catalog, `model_select.model` and RPC `set_model` show the declared window, while session state and the footer show the capped window; reconciling them requires a Pi API.
  Coordinator text. Reason: preserve explicit user choices without producing a nonpositive threshold.
  Carrier: `extensions/RQW-context/index.ts` (`reserveFor`, `userSetReserve`); `extensions/RQW-context/test/context.test.ts`. Since: `a03eb47`.
- **Output and summary limits** `[D-CONTEXT-LIMITS]`. Pi 1.4.0 summary requests use the summarizing model's output limit, not R. pi-ai also clamps output to the window minus estimated input minus 4096, with a floor of one token; capping the window can therefore make oversized input or prose-heavy summary requests unrecoverable. Tool-result truncation in summaries can make tool-heavy histories behave differently. Threshold compaction and native overflow recovery remain Pi's responsibility; this extension adds no provider window field or recovery algorithm. Historical Pi 1.3.0 measurements are evidence, not current Pi 1.4.0 measurements, in [context limits evidence](notes/decisions-evidence.md#context-limits).
  Coordinator text. Reason: the owner's window cap does not remove native output and summary constraints.
  Carrier: `extensions/RQW-context/index.ts`, `extensions/RQW-context/test/context.test.ts`, `extensions/RQW-context/test/routing.test.ts`; Pi 1.4.0 `pi-ai/dist/api/simple-options.js` and `dist/core/compaction/utils.js`. Since: `a03eb47`.
- **Checked process-wide lifecycle** `[D-CONTEXT-LIFECYCLE]`. Native method descriptors, arities, model getter and prototype extensibility are checked before static installation; unsupported shapes fail without static changes. Hooks are installed once per process and apply while `Symbol.for("rqw-context/owner")` holds any live owner token. Each `session_shutdown` removes only its own token; the last removal restores stock behavior, including physical lookup identity. SDK `dispose()` alone does not emit this lifecycle event, and sessions that excluded the extension still receive the rule while another owner remains. Updating the hook implementation requires restarting Pi, not only `/reload`.
  Coordinator text. Reason: independent sessions must not disable each other's universal context policy.
  Carrier: `extensions/RQW-context/index.ts`, `extensions/RQW-context/test/context.test.ts`, `extensions/RQW-context/test/routing.test.ts`; restart instructions: `INSTALL.md`; [context proof](notes/decisions-evidence.md#context-proof). Since: `e1fa03d`.

## Prompt

- **Custom prompt** `[D-PROMPT-CUSTOM]`. RQW-prompt sets `systemPromptOptions.customPrompt` in `before_agent_start` from `extensions/RQW-prompt/SYSTEM.md` plus workstation, critical, environment and date blocks. It does not force the full prompt: Pi still appends project context, skills and cwd, and records sections. The date block does not duplicate cwd. The concept is documented in `notes/prompt-concept.md`; historical benchmark results are recorded in [prompt history](notes/decisions-evidence.md#prompt-history), not a claim that the original template is the only measured version.
  Coordinator text: the historical initial owner quote has not been verified in the permitted Pi USER sources.
  Reason: replace the prompt prefix while retaining Pi's context assembly.
  Carrier: `extensions/RQW-prompt/index.ts`, `extensions/RQW-prompt/SYSTEM.md`. Since: `17c21eb`.

### Prompt/tools isolation

- **Conditional tool instructions** `[D-PROMPT-TOOL-ISOLATION]`. RQW-prompt makes no RQW-tools-specific search or execution assumptions. RQW-tools adds `systemPromptOptions.sections.search_method` only when read, grep and find are declared, and `rqw_tools_execution` only when bash is declared, checking `selectedTools` minus `hiddenTools`. This uses native sections, without an import or handshake between the two extensions, and works with either extension disabled or either load order. The write-in-parts rule belongs only to `extensions/RQW-tools/descriptions/write.md`; `forceSystemPrompt` bypasses native sections and is not overridden. Native section placement was accepted despite measured changes, not claimed to be behaviorally neutral.
  Coordinator text: the isolation requirement is recorded in [Isolation](#isolation); its historical quote is not verified in the permitted Pi USER sources.
  Reason: instructions must follow available tools without coupling extensions.
  Carrier: `extensions/RQW-tools/index.ts`, `extensions/RQW-prompt/SYSTEM.md`, `test/prompt-tools-isolation.test.ts`. Evidence: `notes/prompt-tools-isolation.md`, [source proof](notes/decisions-evidence.md#prompt-isolation-source), [accepted measurements](notes/decisions-evidence.md#prompt-isolation-measurements). Since: `04aa50f`.

## Settings

- **Background cache warming** `[D-SETTINGS-WARMING]`. Background warming is off inside RQW-settings regardless of user configuration; normal inference still writes and reads prompt caches. A reversible session-owned `getCacheWarmingMode` policy leaves settings files, environment and cache-miss notices unchanged, restores the native getter on shutdown, and preserves other owners and foreign hooks through reload. Children carry their independent policy in Agent and Review.
  Owner: «Да, и вообще надо убрать прогрев кэша, чтобы кэш прогревался, когда уходит сообщение первое, не раньше этого.» Source: `2026-10-21T16-27-59-062Z_01a15f4a-7ad5-7377-81be-0baf3b6ffa33.jsonl`, USER entry at line 440, in `~/.pi/agent/sessions/--Users-arkadijcukavin-ai-project-my-pi--/`.
  Reason: no synthetic keepalive inference before the first real request.
  Carrier: `extensions/RQW-settings/cache-warming.ts`, `extensions/RQW-settings/test/cache-warming.test.ts`, `test/cache-warming-reload.test.ts`; evidence: `notes/prompt-cache-policy.md`. Since: `b91f832`.
- **Default tools and reload** `[D-SETTINGS-DEFAULT-TOOLS]`. RQW-settings activates registered built-in `codemode` and `tool_search` at `session_start` only without an explicit CLI or `defaultTools` selection, using the same selection policy as RQW-tools for grep/find. Disabled built-ins are not added. The default codemode mode stays `on`; Pi adds codemode call signatures to the seven RQW-tools descriptions, including `job`. On `/reload` both extensions leave the existing active set alone, preserving user changes.
  Coordinator text: the historical CodeMode/Tool Search owner quotation is not verified in the permitted Pi USER sources.
  Reason: useful defaults must not override explicit selections.
  Carrier: `extensions/RQW-settings/index.ts`, `extensions/RQW-settings/selection.ts`, `extensions/RQW-tools/index.ts`, `extensions/RQW-tools/selection.ts`; details: `notes/settings-codemode.md`. Since: `3720200`.
- **Codemode barrier and capacity** `[D-SETTINGS-CODEMODE]`. With RQW-tools loaded, the registered Pi `codemode` definition is wrapped as one outer barrier call with scope all; its script tools use that call's own barrier. Nested calls find the group through `<codemode id>/<n>` ancestry, not AsyncLocalStorage, so Bun worker callbacks do not lose the grouping. Unregistered ancestors fall back without waiting on themselves. Pi 1.4.0 has process-wide codemode worker slots, `PI_CODEMODE_MAX_WORKERS` default 2, a FIFO slot wait capped at 60 seconds or the remaining script deadline, and a 256 MB VM limit; nested scripts can exhaust slots and time out. The wrapper adds no unlimited capacity and respects `-builtin:codemode`.
  Coordinator text. Reason: nested execution must preserve ordering on Node and Bun without self-deadlock.
  Carrier: `extensions/RQW-tools/nested.ts`, `extensions/RQW-tools/codemode.ts`, `extensions/RQW-tools/index.ts`, `extensions/RQW-tools/test/bun/codemode-check.mjs`; CI: `.github/workflows/tests.yml` covers Node 22.19.0 and 24, Bun 1.3.14 and 1.4.3. Evidence: `notes/settings-codemode.md`, [codemode history](notes/decisions-evidence.md#codemode-history). Since: `b98baec`.
- **GPT Fast** `[D-SETTINGS-GPT-FAST]`. `/fast-gpt [on|off]` toggles the main chat's OpenAI priority processing, with no argument toggling it; `FAST_GPT_DEFAULT = false`. Only matching `openai-codex` request bodies receive `service_tier: "priority"` through `before_provider_request`; Anthropic is untouched. State survives reload and new sessions in the process, not restarts, and has no settings key. The hook applies to SSE and WebSocket request bodies; Pi accounts for the response's service tier. The main-chat indicator belongs to [Status bar](#status-bar).
  Owner: «Режим Fast должен действовать только на основной чат. И по умолчанию он должен передаваться сабогентам. Но если я запрещу исполнителю сабогенты запускать в режиме Fast, то он должен этому повиноваться. Так это должно работать»
  Owner: «В CloudCode у нас режима Fast нет, потому что у меня нет кредитов, чтобы режим Fast поддерживать в CloudCode. Поэтому наш режим Fast распространяется только на GPT. Можно даже называть его GPT Fast.»
  Source for both exact spans: `2026-10-21T16-27-59-062Z_01a15f4a-7ad5-7377-81be-0baf3b6ffa33.jsonl`, USER entry at line 2170, in the Pi session directory named above.
  Reason: expose GPT-only priority without changing provider transports or Anthropic requests.
  Carrier: `extensions/RQW-settings/fast-gpt.ts`; tests: `extensions/RQW-settings/test/fast-gpt.test.ts`, `extensions/RQW-statusbar/test/fast-gpt.test.ts`. Since: `fa05edf`; default off since `7ad7de8`.
- **GPT Fast inheritance** `[D-SETTINGS-GPT-FAST-CHILDREN]`. Subagents, workers and reviewers inherit their caller's GPT Fast state at start; nested children inherit from their direct caller. Later main-chat toggles do not update running children. Optional boolean `fast_gpt` overrides inheritance, and agent/worker `send` or `restart` may explicitly change a child's state; omitted restart keeps it. A strict-schema null means omitted. Tool descriptions tell callers to pass `fast_gpt: false` when the user forbids Fast; `review` correctly says a reviewer inherits, not that every tool has identical wording. Independent extension-local `fast-gpt.ts` implementations query `rqw-settings:fast-gpt-query` synchronously; `rqw-settings:fast-gpt` notifies changes. Without a settings responder, inherited main-chat Fast is off.
  Owner: the exact inheritance instruction is recorded in GPT Fast above.
  Reason: child tier follows the caller's choice without live coupling or cross-extension imports.
  Carrier: `extensions/RQW-agent/fast-gpt.ts`, `extensions/RQW-review/fast-gpt.ts`, their `index.ts` and `test/fast-gpt.test.ts`. Since: `fa05edf`.

## Isolation

- **Self-contained extensions** `[D-ISOLATION-SELF-CONTAINED]`. Each RQW extension is independently switchable and imports no file outside its folder, including in local tests. Shared helpers are copied: both `selection.ts` copies are 127 lines, the agent/review `git-guard.ts` copies are byte-equal, and Fast event-channel constants are repeated in three extension-local files. Extension-local tests load only that extension; multi-extension tests live under root `test/`. Disabling an extension removes its owned behavior; process-wide Context and PCLI hooks stay active while any owner remains.
  Coordinator text: the historical isolation quote is not verified in the permitted Pi USER sources.
  Reason: one feature flag must not require another extension to exist.
  Carrier: `extensions/`, `test/isolation.test.ts`, `test/isolation-run.ts`, `test/copies.test.ts`. Since: `81cafe3`.
- **Registered coverage and pending UI registration** `[D-ISOLATION-COVERAGE]`. `test/isolation.test.ts` derives its tested extension list from `package.json` `pi.extensions`, checking local imports, independent loading, tool behavior and package-filter reload. On main, `RQW-naming`, `RQW-theme`, `RQW-thinking` and `RQW-tool-ui` exist but are not registered until P10 and are not covered by that registration-driven test; `RQW-agent-ui` is not on main. Registration work is tracked in [BACKLOG](BACKLOG.md).
  Coordinator text. Reason: test coverage must not be implied for unregistered folders.
  Carrier: `package.json`, `test/isolation.test.ts`, `test/isolation-run.ts`; [historical coverage](notes/decisions-evidence.md#isolation-coverage-history); `test/tool-ui-smoke.test.ts` separately tests tool UI. Since: `81cafe3`.
- **Package switch and native limits** `[D-ISOLATION-SWITCH]`. Switch one extension off with the object-form package entry and the exact file exclusion `"extensions": ["-extensions/RQW-<name>/index.ts"]`, keeping the same source `git:github.com/ARQAWA/my-pi`; a directory-only exclusion does not match the file. The filter takes effect after reload or restart. `pi -e <dir>` bypasses package filters; choose individual entrypoint files and use `-ne` to avoid an installed copy. Built-ins use `-builtin:<name>`, not package filters. Pi preserves active tools on reload, so stock grep/find or codemode/tool_search may remain active after their RQW extension is disabled until a new session or restart.
  Coordinator text. Reason: use Pi's package controls without inventing a second switch mechanism.
  Carrier: `INSTALL.md`, `test/isolation.test.ts`; Pi 1.4.0 `dist/core/package-manager.js`, `dist/core/resource-loader.js`, `dist/core/agent-session.js`. Since: `81cafe3`.

## Agent

- **Native prompt files** `[D-AGENT-PROMPT-FILES]`. Agent start/restart accepts `system_file` or `role_file` instead of the corresponding inline prompt; paths resolve relative to the caller's cwd. A regular file supplies exact UTF-8 text, including whitespace and a literal BOM; invalid UTF-8, matching inline/file options, or mixing any system option with any role option is rejected. Restart inherits the prompt choice and re-reads a file before replacing the child, so failed validation leaves the old child intact. Push `details.prompt_file` and wait `details.results[i].display.prompt_file` carry the same `{kind, path, sha256}` for the absolute resolved path and bytes actually loaded. Explorers reject prompt-file overrides, and workers keep their fixed prompts and configuration.
  Owner: «Всё должно быть нативно. Подумай, как можно максимально интеллектуально прокачать этот функционал.» Source: `2026-10-21T16-27-59-062Z_01a15f4a-7ad5-7377-81be-0baf3b6ffa33.jsonl`, USER entry at physical line 3963, requested at 2026-10-23T13:01:47.145Z.
  Reason: native prompt inputs replace manually copied prompt text without losing byte provenance.
  Carrier: `extensions/RQW-agent/index.ts`, `extensions/RQW-agent/prompt-files.ts`, `extensions/RQW-agent/prompt.ts`; proof: `extensions/RQW-agent/test/prompt-files.test.ts`; [file contract](extensions/RQW-agent/README.md#prompt-files-and-caller-messages). Since: `dc4f32e`.
- **Verbatim caller messages** `[D-AGENT-CALLER-MESSAGES]`. Agent start/restart may pass `include: ["user_messages"]` to append a `<user_messages>` block after the task. It contains user-role text from the caller's selected branch, including entries before compaction, in branch order; text parts are joined with newlines, images and non-user messages are omitted. Nested callers contribute their own session messages, not the root session's. Inclusion is not inherited on restart, and restart without task stays idle; the required start task remains the inline `task` field. These options do not override fixed worker configuration.
  Coordinator text: technical realization of the native-input agreement in `[D-AGENT-PROMPT-FILES]`.
  Reason: forward actual caller messages rather than summaries or retyped quotations.
  Carrier: `extensions/RQW-agent/index.ts`, `extensions/RQW-agent/prompt-files.ts` (`appendUserMessages`); proof: `extensions/RQW-agent/test/prompt-files.test.ts`. Since: `dc4f32e`.
- **Native supervision** `[D-AGENT-SUPERVISION]`. All three tools share native wait/status options and optional `alert_after_ms` on start/restart; prompt-file and caller-message options remain agent configuration. Status alerts are `{kind, at, detail}`: `error`, `repetition`, `long_turn`, `schema_rejection_repeated` and `scope_block`; the latest 32 are presentation history, not an execution limit. The optional positive finite safe-integer threshold is disabled by default and inherited on restart; it reports a long native turn without stopping it, and turn end, logical run end and close cancel the timer, leaving none while idle. Repetition is diagnostic suspicion; schema alerts require a second matching detectable Pi argument-parsing/schema rejection, and scope alerts observe actual existing git-guard refusals. This F1/F3 work adds no F5 guard or sandbox, `stalled_tool` alert, F2 run manifest or F4 structured-output feature.
  Coordinator text: technical realization of the native-supervision agreement in `[D-AGENT-PROMPT-FILES]`.
  Reason: make supervision caller-controlled without polling wrappers or automatic cancellation.
  Carrier: `extensions/RQW-agent/index.ts`, `extensions/RQW-agent/activity.ts`, `extensions/RQW-agent/coordinator.ts`, `extensions/RQW-agent/workers.ts` and descriptions; proof: `extensions/RQW-agent/test/supervision-activity.test.ts`, `extensions/RQW-agent/test/supervision-coordinator.test.ts`, `extensions/RQW-agent/test/supervision.test.ts`; [supervision contract](extensions/RQW-agent/README.md#wait-status-and-management). Since: `dc4f32e`.

- **Caller-chosen wait and status** `[D-AGENT-WAIT]`. All three tools share caller-local mechanical wait/status for mixed direct-child IDs; `timeout_ms` defaults to 300000 only when omitted, and expiry never cancels a child. `until: "first"` is the default; `"all"` holds early completions until every selected target has a result, receipt or inactive state, releasing held results to the message path on alert, timeout or caller abort. `wake_on_alert` defaults to true and wakes only for alerts created on selected children after wait registration, without consuming a result. Status uses `messages` 5-10, default 8; `depth` defaults to 0, with positive safe-integer depth adding compact read-only descendant snapshots without message previews or descendant management. Waiting makes no caller model turns; results still arrive exactly once through wait or messages with receipts for delivery races. No execution, turn, token, output-growth, child-count or automatic-management limits are added; Pi provider timeouts and retries still apply.
  Owner: «Если они работают долго, пусть работают.» Source: `2026-10-21T16-27-59-062Z_01a15f4a-7ad5-7377-81be-0baf3b6ffa33.jsonl`, USER entry at line 1849.
  Reason: the caller decides how to manage work, not a watchdog.
  Carrier: `extensions/RQW-agent/index.ts`, `extensions/RQW-agent/coordinator.ts`, `extensions/RQW-agent/activity.ts`; details: [RQW-agent README](extensions/RQW-agent/README.md#wait-status-and-management). Since: `fe0e375`; all-target waits, alert wakes and descendant status since `dc4f32e`.
- **Child cache policy** `[D-AGENT-CACHE]`. Every child has in-memory `cacheWarming: "off"`, independent of RQW-settings and the user's warming mode. Prompt caching stays on; the guarded stream wrapper sets `cacheRetention: "short"` for Anthropic Messages before OAuth fallback, giving built-in five-minute retention without a new config knob. Other APIs retain their options.
  Owner: «Потому что если мы вообще выключим им кэш, то они будут пиздец жрать токенов нахуй.» Source: the same session, USER entry at line 440.
  Reason: disable background requests without sacrificing ordinary prompt-cache reuse.
  Carrier: `extensions/RQW-agent/index.ts`, `extensions/RQW-agent/test/agent.test.ts`, `test/prompt-cache.test.ts`; evidence: `notes/prompt-cache-policy.md`. Since: `b91f832`.
- **Subagent parity** `[D-AGENT-PARITY]`. General subagents use the main run's built prompt from public `ctx.getSystemPrompt()`, followed by a short subagent reminder and optional `role`; nested subagents receive the main prompt handed down, not their parent's role. Optional `system` or `system_file` replaces that whole prompt exactly; file alternatives and validation are defined in `[D-AGENT-PROMPT-FILES]`. General subagents get `agent` recursively with no depth or concurrency limit; workers and explorers are leaves. Repository coordinator rules are not product policy, and the reminder excludes instructions addressed to the main agent or coordinator.
  Owner: «Надо что бы саб агенты были как в куросре посмотри реверз инжинеринг и скажи свои предложения» Source: the same session, USER entry at line 2608.
  Reason: share main's rules and context while allowing short role configuration and independent decomposition.
  Carrier: `extensions/RQW-agent/index.ts`, `extensions/RQW-agent/prompt.ts`, `extensions/RQW-agent/test/agent.test.ts`; details: [RQW-agent README](extensions/RQW-agent/README.md#prompt-kinds-and-title). Since: `c86e9bb`.
- **Child settings and offered review** `[D-AGENT-CHILD-SETTINGS]`. Children inherit session shell, image handling, retries, provider and transport timeouts, compaction, thinking budgets, queue modes and codemode settings, except warming stays off. Stock tools use the child's copied shell/image settings; offered RQW-tools read the caller's effective settings per call. Children get built-in codemode/tool_search when active for their caller; general subagents get caller-local review through `rqw-review:subagent-review` when offered. Reviewers inherit the same settings except queue modes. Workers receive cwd, OS and date after their fixed role. Durable resume, parent-history fork, web search and MCP for children are deferred in [BACKLOG](BACKLOG.md), not present features.
  Coordinator text: technical realization of the parity agreement.
  Reason: children must not silently lose relevant caller capabilities.
  Carrier: `extensions/RQW-agent/index.ts` (`childSettings`), `extensions/RQW-agent/prompt.ts`, `extensions/RQW-review/index.ts`; `extensions/RQW-review/test/subagent.test.ts`. Since: `c86e9bb`.
- **Title and explorer** `[D-AGENT-TITLE-EXPLORE]`. Optional `title` on start/restart appears in status, `results[i].display.title` and message `details.title`; delivered text keeps its `[agent#N]` form. Card rendering in `RQW-agent-ui` belongs to a pending branch, not main; see [BACKLOG](BACKLOG.md). `explore` on agent start selects a read-only search leaf on the caller's model with the main prompt, a short role and thoroughness `quick`, `medium` or `very thorough`; it exposes read/grep/find and git-guarded bash, not edit/write, and takes no custom system/role/model/tools or prompt-file overrides.
  Coordinator text: the explorer option reuses the existing runtime rather than adding a tool.
  Reason: retain compact metadata and a read-only search mode without another lifecycle implementation.
  Carrier: `extensions/RQW-agent/index.ts`, `extensions/RQW-agent/prompt.ts`, `extensions/RQW-agent/git-guard.ts`. Since: `c86e9bb`.
- **API and in-process runtime** `[D-AGENT-API]`. One `agent` tool offers `start`, `wait`, `status`, `send`, `interrupt`, `stop`, `restart`; fields are `id`, `ids`, `timeout_ms`, `messages`, `until`, `wake_on_alert`, `depth`, `alert_after_ms`, `system`, `role`, `system_file`, `role_file`, `include`, `title`, `explore`, `task`, `model`, `thinking`, `tools`, `fast_gpt`, `interrupt`. Optional null fields mean omitted; start/send require task, not system. Defaults are the caller's model and thinking and all six base tools, plus the delegation tools allowed by [Workers](#workers). Sessions run in-process at caller cwd with in-memory settings/history, using `createAgentSession` and the caller's `ctx.modelRegistry.runtime` for credentials, OAuth and extension providers. Resources, context files, skills and external extensions are not independently loaded; the inherited prompt carries main's text. An inline forced `before_agent_start` prompt prevents Pi from appending cwd or other sections again.
  Coordinator text. Reason: reuse Pi sessions and the caller's provider runtime without subprocesses or duplicate resource loading.
  Carrier: `extensions/RQW-agent/index.ts`, `extensions/RQW-agent/test/agent.test.ts`. Since: `7a9f505`; inherited defaults since `c86e9bb`.
- **Optional RQW-tools offer** `[D-AGENT-TOOLS-OFFER]`. At start/restart RQW-agent emits `rqw-tools:subagent-tools` with `{ offer(factory) }` on the shared synchronous `pi.events` bus; loaded RQW-tools answers with fresh definitions and a child-local barrier/job registry, otherwise stock tools are used. The consumer type is `(cwd: string, settings: () => unknown, nested?: undefined, options?: { label?: string; codemode?: ToolDefinition }) => ToolDefinition[]`; the provider's exact function is `createTools(cwd: string, settings: () => any, nested = createNestedBarrier(), options: JobsOptions & { jobs?: Jobs; codemode?: ToolDefinition<any, any, any> } = {}): ToolDefinition[]`. The factory provides seven tools, six base tools plus job, and optionally a grouped child codemode; the consumer filters the base subset but retains job and offered codemode. Child codemode shares process-wide Pi worker slots. No cross-extension import or mandatory dependency is added; reload/dispose invalidates stale handlers.
  Coordinator text. Reason: children follow the RQW-tools switch while retaining their own ordering and job ownership.
  Carrier: `extensions/RQW-agent/index.ts` (`ToolsFactory`, `offeredTools`), `extensions/RQW-tools/index.ts` (`createTools`), `test/agent-tools.test.ts`. Pi 1.4.0 event API: `docs/extensions.md:186`, `dist/core/extensions/types.d.ts:1406`; invalidation: `dist/core/extensions/loader.js:144-152`, `dist/core/agent-session.js:1022,3002`; stock tool settings: `dist/core/agent-session.js:2964-2974`. Since: `90700ad`.
- **Result delivery and identity** `[D-AGENT-DELIVERY]`. Every final answer and final error of a run is delivered in order to its direct caller, once; intermediate runs awaiting children and attempts Pi retries are not final results. `auto_retry_start` and `compaction_end` with `willRetry: true` remove only the retried message's contribution, preserving earlier answers. Invalid IDs/models, missing credentials or required task fail immediately, using auth snapshot then `runtime.checkAuth`. Idle callers are woken; busy callers retain results outside abort-cleared queues, and settle races produce one continuation seeing all held results. Abort preserves delivered text without starting another turn; manual-compaction arrivals are seen on the next turn. Delivery uses UUIDs, and `agent#N` counters recover the session's maximum across reload/resume/fork/continuation.
  Coordinator text. Reason: retries, cancellation and session continuation must neither lose nor duplicate results.
  Carrier: `extensions/RQW-agent/index.ts`, `extensions/RQW-agent/coordinator.ts`, `extensions/RQW-agent/test/agent.test.ts`; [historical proof](notes/decisions-evidence.md#agent-proof). Since: `7a9f505`.
- **Steering and interrupting sends** `[D-AGENT-SEND]`. Sending to a running child uses `session.steer`, arriving after the current assistant turn's tool calls and before the next request without abort; an idle child starts a new run with history. `send` with `interrupt: true` clears queued steering/follow-ups, aborts the run and records one next task that starts when cancellation settles; later sends join in order. An uncooperative tool can delay that start, shown as `pending_sends`; wait remains running and reports `target_changed` when the run changes. Plain send during cancellation is rejected unless an interrupting send is already pending. `interrupt` retains history without a result message; stop forgets the session; restart creates a fresh session with retained or explicitly replaced configuration. Interrupt/stop/restart discard pending tasks and cascade cancellation to descendants.
  Coordinator text: the steering proposal was accepted by the owner; the quoted proposal is not an owner quotation.
  Reason: follow-ups should steer promptly without forcing cancellation, while redirection remains explicit.
  Carrier: `extensions/RQW-agent/index.ts` (`requestInterrupt`, `Agent.next`), `extensions/RQW-agent/test/steer.test.ts`, `extensions/RQW-agent/test/nested-workers.test.ts`. Since: `029160d`.
- **Ordered management and shutdown** `[D-AGENT-MANAGEMENT]`. Management calls across all three tools register in call order; wait releases that queue after subscription. Start, idle send and restart with task return once prompt preflight starts the run or `compaction_start` makes cancellation effective. Closing clears queues, calls abort and only then disposes, preventing requests after stop or shutdown. Print/JSON use a caller-wide non-consuming fallback wait in `agent_end`, subordinate to explicit waits; native-idle children use the same bounded fallback for their workers. TUI/RPC retain push wakeups. `session_shutdown` closes all descendants without result messages.
  Coordinator text. Reason: parallel tool batches, pre-run compaction and disposal must not leave unowned requests.
  Carrier: `extensions/RQW-agent/index.ts`, `extensions/RQW-agent/coordinator.ts`, `extensions/RQW-agent/test/agent.test.ts`; [historical proof](notes/decisions-evidence.md#agent-proof). Since: `fe0e375`.
- **Accepted limits** `[D-AGENT-LIMITS]`. Results arriving after the caller session ended are lost. Children share the TUI process and may read files the main agent is editing; in-process cancellation cannot forcibly end an uncooperative tool. The process-wide [Context](#context) rule applies while an RQW-context owner exists. GPT Fast inheritance and overrides are defined once under [Settings](#settings).
  Coordinator text. Reason: these are boundaries of the in-process session design, not unimplemented promises.
  Carrier: `extensions/RQW-agent/index.ts`; details: [RQW-agent README](extensions/RQW-agent/README.md#wait-status-and-management). Since: `7a9f505`.

## Workers

- **Recursive workers** `[D-WORKERS-NESTED]`. `code_writer` and `shell_runner` are bound to the direct caller's API
  at every level of the recursive subagent tree ([Agent](#agent)); workers themselves are leaves with no delegation
  tools. The subagent's logical assignment stays open across worker wakeups and withholds intermediate answers until
  no workers or unconsumed results remain.
  Owner: «Они должны быть сделаны так, чтобы и основной агент мог вызывать этих саб-агентов для этих задач, и саб-агенты могли их тоже вызывать. Чтобы были вложенные саб-агенты, чтобы, допустим, саб-агент Opus или саб-агент Sonnet мог вызвать CodeWriter либо ShellRunner, которые будут выполнять шумную механическую работу, которая токены утилизирует.» (session `2026-10-21T18-46-56-955Z_01a15fc9`, line 7)
  Reason: a deciding agent at any level delegates mechanical work without routing raw worker reports through main.
  Carrier: `extensions/RQW-agent/index.ts`, `workers.ts`. Proof: `test/nested-workers.test.ts`; `test/cli-provider.ts`
  through `test/cli.test.ts` checks that general children carry `agent`, the workers and conditional `codemode`.
  Lifecycle: [RQW-agent README](extensions/RQW-agent/README.md#runtime-and-delivery). Since: `b7d9ae7`.
- **Fresh assignments, explicit follow-ups** `[D-WORKERS-FRESH]`. `{task}`/`start` creates a fresh in-process session;
  `send` continues the same assignment ([Agent](#agent) wait and management decision). Completed workers stay idle
  until stop or caller shutdown; retained history costs memory and send input/cache/compaction, and idle retention never
  counts as pending. Role prompts (followed by the cwd, OS and date block of the [Agent](#agent) parity entry),
  descriptions and tool allowlists are fixed in `workers.ts`, `roles/`, `descriptions/`; model and reasoning in
  `worker-model.ts` (all in `extensions/RQW-agent/`).
  Coordinator text (owner quote not found in the Pi sessions): "И каждый раз, когда ты даешь ему новое задание, сбрасываешь ему контекстное окно". Reason: new assignments must not inherit unrelated tasks or old answers.
  Since: `b7d9ae7`.
- **Complete briefs, trusted results** `[D-WORKERS-BRIEFS]`. Caller descriptions require complete decided briefs,
  trusting results, no busy polling, parallel calls only when independent, never two code_writers on one file.
  Coordinator text (owner quotes not found in the Pi sessions): "Например, чтобы агент Main не использовал кодрайтер в той ситуации, где бриф будет длиннее, чем написать код самостоятельно."; "Идея в том, что саб-агент ускоряет main-агента. Main-агент должен доверять саб-агенту." Reason: delegation must speed the caller up, not add briefing and
  repeated work. Carrier: `extensions/RQW-agent/descriptions/code_writer.md`, `descriptions/shell_runner.md`.
  Since: `b7d9ae7`.
- **D2: code and config only** `[D-WORKERS-SCOPE]`. `code_writer` writes code and configs, never documentation or
  prompts, and has bash to run a focused check of its own change; `shell_runner` runs exact commands, fixes nothing and
  reports in its fixed format. RQW-tools' [ordered barrier](#tools) orders edits and checks when loaded; without an
  offer workers use stock tools ([Agent](#agent)).
  Coordinator text (owner quote not found in the Pi sessions): "только код. не документацию, не промпты, а только код и какие-то конфиги. и всё". Reason: checking a decided change belongs with its execution; docs, prompts and product
  decisions do not. Carrier: `extensions/RQW-agent/roles/code_writer.md`, `roles/shell_runner.md`, `workers.ts`,
  `index.ts`. Briefs, reports, tool sets: [RQW-agent README](extensions/RQW-agent/README.md#briefs-and-reports).
  Since: `b7d9ae7`.
- **D3: no git mutations** `[D-WORKERS-GIT]`. Neither worker changes git state; supported read-only git queries are
  allowed. `workers.ts` installs `git-guard.ts` in each worker's `tool_call` hook before bash runs; the syntax guard
  blocks obvious launcher and config-injection bypasses, and it is not a sandbox. Reason: commits, staging, branches,
  merges and pushes belong to the caller and [PROCESS.md](PROCESS.md); a cheap low-reasoning model must not own
  destructive git commands. Supported queries and limits: [RQW-agent README, Git guard](extensions/RQW-agent/README.md#git-guard).
  Proof: `extensions/RQW-agent/test/git-guard.test.ts`, `test/workers.test.ts`. Since: `b7d9ae7`.
- **D1: worker models** `[D-WORKERS-MODEL]`. `anthropic/claude-haiku-5-5` is primary, `openai-codex/gpt-6-luna` the
  credential fallback; with neither available the call fails with a clear error. Missing candidates and rejected auth
  checks do not disable the remaining fallback.
  Owner: «Только я бы хотел, чтобы мы прогнали этих малышей на каких-то нижних reasoning. Например, Haiku 5.5 medium либо low и GPT-6 Luna medium либо low. Для нас предпочтительно утилизировать шумную работу внутри Haiku и внутри Luna, потому что они полностью бесплатны для наших подписок. Они супердешёвые и суперэффективные. Я бы хотел это сделать для обоих моделей, но надо сделать честные замеры.» (session `2026-10-21T18-46-56-955Z_01a15fc9`, line 67)
  Coordinator text (owner quote not found in the Pi sessions): "Протестировали этих workers с max reasoning — полная хуета."
  Reason: noisy work runs on the preferred subscription models at measured lower reasoning instead of the caller's
  expensive model. Carrier: `extensions/RQW-agent/worker-model.ts`. Proof: `test/worker-model.test.ts`,
  `test/workers.test.ts`. These product workers are not the development worker models of [Work policy](#work-policy).
  Since: `b7d9ae7`.
- **B4: qualification and chosen reasoning** `[D-WORKERS-REASONING]`. A level qualifies only at 95% pass rate,
  independently on tuning and holdout. Low is chosen when it qualifies, its combined pass rate is not below medium's and
  its judge mean is at most 0.5 below medium's; otherwise qualifying medium. If neither qualifies, the owner chooses the
  trade-off; the coordinator neither raises the level nor lowers the bar. Chosen (`WORKER_REASONING`): Haiku low for
  both workers; GPT-6 Luna low for `code_writer`, medium for `shell_runner`. GPT-5.6 Luna is not in the worker chain.
  Owner: «Даже 4% не было ошибок» (session `2026-10-21T18-46-56-955Z_01a15fc9`, line 85); «Поставь 95, хоть помягче чуть-чуть.» (session `2026-10-21T18-46-56-955Z_01a15fc9`, line 91);
  «замеры можно делать бесконечно, потому что хайку и Luna бесплатные» (session `2026-10-21T18-46-56-955Z_01a15fc9`, line 94);
  «Гораздо проще, если там будет высокий процент успеха, допустим, 70-80, то пусть лучше он в один проход напишет большую часть, потом его основной агент подправит. Чем он будет сидеть по пять минут писать код» (session `2026-10-21T18-46-56-955Z_01a15fc9`, line 91).
  Reason: lower reasoning must keep reliable execution and report quality. Carrier: `extensions/RQW-agent/worker-model.ts`.
  Evidence: [workers benchmark](notes/workers-bench.md#b4-chosen-levels), results table in
  [decisions evidence](notes/decisions-evidence.md#workers-b4-results). Since: `b7d9ae7`.
- **Shared lifecycle** `[D-WORKERS-LIFECYCLE]`. Engineering choice: worker profiles parameterize the session runtime
  in `extensions/RQW-agent/index.ts` instead of copying id allocation, persistence, cancellation, delivery and
  late-after-abort rules. `workers.ts` groups caller-local handles; caller shutdown closes active and retained workers.
  Reason: one lifecycle implementation, and worker results never leak into another caller's session. Proof:
  `extensions/RQW-agent/test/workers.test.ts`; [Isolation](#isolation) through `test/isolation.test.ts` and the
  extension-local import scan. Since: `b7d9ae7`.

## Review

- **Deep reviewer** `[D-REVIEW-DEEP]`. `extensions/RQW-review/REVIEWER.md` is the deep reviewer prompt, shared by both
  levels: judge quality, completeness and absence of unagreed additions, not perfectionism, reading and checking as much
  as needed with no economy or tool-call budget, in the main agent's folder. It may run repository tests, never the
  delivered result itself (for autotest work, not the autotests). Tools are in `[D-REVIEW-TOOLS]`. `TIMEOUT_MS` is
  30 minutes: hang protection, not an economic budget; its replacement is open work, item R01 in
  [BACKLOG.md](BACKLOG.md#open).
  Owner: «Он не должен быть супердушным, супердотошным, проверять на 1000%, быть перфекционистом. Он должен просто контролировать качество работы: всё сделано качественно, всё сделано, что было заказано, ничего лишнего не было сделано.» (session `2026-10-21T16-27-59-062Z_01a15f4a`, line 1693);
  «никакой экономии нахуй. Агент должен делать столько, сколько ему необходимо, чтобы достичь качественного результата, качественной оценки, качественной проверки. Никаких не должно быть экономических ограничений.» (session `2026-10-21T16-27-59-062Z_01a15f4a`, line 1695);
  «У него не должно быть ограничения по tool call, по инструментам, по прочему. Он должен работать в рамках того, как работают все большие агенты. У него должен быть тот же самый инструментарий» (session `2026-10-21T16-27-59-062Z_01a15f4a`, line 1700);
  «Прямо в рабочей папке, в которой работает основной агент.» (session `2026-10-21T16-27-59-062Z_01a15f4a`, line 1598);
  «для кода он запускает тесты, не запускает сам код для обычного кода, а для автотестов он не запускает автотесты, блядь. В этом же суть, что сам результат работы он не запускает» (session `2026-10-21T16-27-59-062Z_01a15f4a`, line 1610).
  Reason: the owner's review standard. Carrier: `REVIEWER.md`, `index.ts` (`TIMEOUT_MS`). Proof: prompt hash pin in
  `test/review.test.ts`. No live model quality claim is made for this prompt. Since: `a04a9c0`.
- **No warming, five-minute cache** `[D-REVIEW-CACHE]`. `extensions/RQW-review/index.ts` sets `cacheWarming: "off"`
  in each reviewer's in-memory SettingsManager, independently of RQW-settings and the main user's mode; prompt caching
  stays on. Each reviewer's guarded stream wrapper sets `cacheRetention: "short"` on Anthropic Messages requests before
  the adapter's OAuth default, a built-in 5m policy with no config knob; other APIs are unchanged.
  Owner: «Да, давайте мы исполнителям, ревьюерам кэш выключай.» (session `2026-10-21T16-27-59-062Z_01a15f4a`, line 440); TTL approval
  «Если это замеренная цифра и 5 минут будет заебись в большинстве случаев, то пусть будет 5 минут.» (session `2026-10-21T16-27-59-062Z_01a15f4a`, line 583)
  ([Anthropic subscription adapter](#anthropic-subscription-adapter)). Reason: review gaps are short, so 1h writes
  rarely pay off. Proof: `test/review.test.ts`, package `test/prompt-cache.test.ts`. Evidence:
  `notes/prompt-cache-policy.md`. Since: `b91f832`.
- **Reviewer GPT Fast** `[D-REVIEW-FAST]`. A reviewer inherits the main chat's GPT Fast state when it starts; the
  optional `fast_gpt` of `review` overrides it for that reviewer. Rule, quotes and carrier: [Settings](#settings),
  "GPT Fast" (`extensions/RQW-review/fast-gpt.ts`, `index.ts`). Since: `fa05edf`.
- **One tool, two levels** `[D-REVIEW-TOOL]`. `extensions/RQW-review/` registers one tool `review` with `level`
  `blind` or `high`, held to the existing contract and nothing more.
  Coordinator text (owner quotes not found in the Pi sessions): "То, что ты предложил по ревьюерам — it's OK, я принимаю"; "Smart не нужен ... будет Blind и High"; "эти три саб-агента должны быть забиты за тем контрактом, который есть, и всё" (the last one also appears in the task text the owner pasted, session
  `2026-10-21T16-27-59-062Z_01a15f4a`, line 367). Carrier: `index.ts`, `package.json`. Since: `3389347`.
- **Reviewer models** `[D-REVIEW-MODELS]`. One table, `LEVELS` at the top of `index.ts`, chosen by the family of the
  main agent's model. Claude main: `blind` `anthropic/claude-haiku-5-5` thinking medium, `high`
  `anthropic/claude-sonnet-5-5` thinking low. GPT main: `blind` `openai-codex/gpt-5.6-luna` medium, `high`
  `openai-codex/gpt-5.6-luna` high. Family from `ctx.model`: provider `anthropic` or a `claude*` id is Claude; provider
  `openai` or `openai-codex` or a `gpt-*` id is GPT; anything else, or none, uses the Claude table. Fallback: when the
  family's reviewer has no model or no credentials, the other family's reviewer of the same level runs; when neither can
  start, `[review#N] Review failed: <reason>` names both reasons. A failed request or no verdict in 30 minutes gives
  `Review failed: <reason>` with no automatic retry. Verdict `details` carry the model that ran.
  Owner: «2а 3а» (session `2026-10-21T16-27-59-062Z_01a15f4a`, line 1162) (answer to three coordinator questions; the unanswered first question took its recommended
  option 1a, reviewer model by the main agent's family); «Да» (session `2026-10-21T16-27-59-062Z_01a15f4a`, line 1425).
  Reason: the gpt-match probes found GPT-5.6 Luna medium and high comparable to the Claude slots; GPT-6 Luna unusable.
  Evidence: `notes/reviewer-probes.md`, section "GPT match for the Claude slots"; numbers in
  [decisions evidence](notes/decisions-evidence.md#review-gpt-match). Proof: `test/review.test.ts` ("the family
  table", "GPT main, blind", "GPT main, high", the fallback and failure tests). Since: `3389347`.
- **Parameters** `[D-REVIEW-PARAMS]`. `level`, `object` (paths, the diff as a file path rather than a command, so the
  reviewer reads it whole beside the named sources, the stage), `criterion`, optional `agreement` (accepted proposals
  and decisions not in the user's own messages), optional `rebuttals` (`[D-REVIEW-DISPUTES]`) and optional boolean
  `fast_gpt`. Empty strings, a null or empty `rebuttals` and a null `fast_gpt` count as not given, since strict mode
  fills every field. The description stays within 600 characters, enforced by its test. Carrier: `index.ts`.
  Proof: `test/review.test.ts`. Since: `3389347`.
- **Main and reviewer as a pair** `[D-REVIEW-PAIR]`. The pair rules live only in the plugin, so switching RQW-review off
  removes them. Reviewer side: `REVIEWER.md` ("on Main's team"). Main side, three carriers in `index.ts`:
  `DESCRIPTION` (every request while on: who the reviewer is, "works with you as one team for the user's agreement", how to call it); the tool result `startedText`: `review#N started. Keep working, but leave the reviewed files unchanged until its verdict.`; and the verdict wrapper `verdictMessage`: `[review#N]`, the verdict verbatim, finding ids and dispute outcomes, then one `NEXT` paragraph by kind. `clean`: the trimmed verdict is exactly `CLEAN` after a normal `stop`; passed, no further pass for confidence. A `length`, `error`, `aborted` or other abnormal stop is a failed review. `incomplete` (`CLEAN` with extra text, prose before `CLEAN`, `FINDINGS:` with text on its header line, a `FINDING` block missing a required field, any other text): resolve UNCHECKED or retry, never a pass, no finding id, answers no dispute. `findings` (a line exactly `FINDINGS:`, then `FINDING n` blocks with REQUIREMENT, MISMATCH, EVIDENCE, REQUIRED OUTCOME filled; one structural check in `findingBlocks`, used by `kindOf` and `settle`): find each quote; fix each new finding exactly to its REQUIRED OUTCOME, or rebut it once with proof of a misreading; a finding resting on a value or choice the user never gave goes to the user, not fixed with another choice of Main's own ([Reviewer probes](notes/reviewer-probes.md), variant n1); fix the rest in one batch, then call `review` again with the same level, object, criterion and the new rebuttals until CLEAN. `failed` (the catch branch): no pass, no self-check replaces it; retry once on the unchanged object, then tell the user and wait. Not `promptSnippet` or `promptGuidelines`: RQW-prompt sets `customPrompt`, and Pi builds that section only without one. Not `SYSTEM.md`. Owner: «Правила пары остаются внутри плагина (DESCRIPTION, NEXT, REVIEWER.md), а не в SYSTEM.md.» (session `2026-10-21T16-27-59-062Z_01a15f4a`, line 367) (task text the owner pasted). Coordinator text (earlier owner quotes, found only as copies in that pasted task): "чтобы они действовали в одной команде ... либо принимает правку, либо её отклоняет и пишет, почему" (2026-10-09); "он с ним действует в унисон, в паре ... их синергия должна идти в рамках плагина. Это не должно размазываться" (2026-10-20).
  Since: `c4aaad4`.
- **Disputes: the three-message rule** `[D-REVIEW-DISPUTES]`. Enforced by the extension, not only by prompts
  (`NEXT`, `DESCRIPTION`, schema, `findingBlocks`, `disputes`, `settle`, `refusals`, `buildBrief` in `index.ts`, and
  `REVIEWER.md`):
  - Ids: each finding of a parsed `FINDINGS:` verdict gets a stable id `<review number>.<position>` (`3.2`), listed after
    the verdict; a finding repeated with `DISPUTE: <id>` keeps that id.
  - Message 2: Main fixes a finding or rebuts it once in `rebuttals` (`finding`, `quote`, `source`, `explanation`). The
    whole call is refused, with no review started and no number taken, when a rebuttal names an unknown finding, lacks a
    quote, source or explanation, quotes text not in its source (`user`: the user's own messages of the branch only, not
    a compaction or branch summary; or a file under the session cwd; whitespace runs and one pair of surrounding quotation
    marks are ignored), repeats a finding in one call, or rebuts a finding that already has a rebuttal or a final answer.
    The state check and persisting accepted rebuttals run with no await between them, so of two parallel rebuttals of one
    finding exactly one is accepted. The refusal says what to do instead.
    File-source containment is enforced after `realpath` resolves the source and session cwd. Relative paths and
    absolute paths inside that resolved cwd are allowed; outside paths and symlink escapes are refused before the
    file is read (`index.ts`, since `e1cca48`).
  - Message 3: every brief carries every dispute of the branch under `<disputes>` (the finding, its id, Main's quote,
    source and explanation, and once answered the status and the reviewer's answer), so a fresh reviewer understands it.
    The first exact `CLEAN` or parsed `FINDINGS:` verdict of a review whose brief carried an open dispute answers it: left
    out is withdrawn; repeated with `DISPUTE: <id>` is upheld with `RULING: DECIDED` (a verbatim user or agreement quote
    settles it, Main fixes) or `RULING: UNDECIDED` (no unambiguous user decision, Main asks the user), plus a
    one-sentence `ANSWER`. A missing or invalid RULING counts as UNDECIDED. Failed, incomplete or malformed verdicts
    answer nothing. Outcome lines `NEXT.withdrawn`, `NEXT.decided`, `NEXT.undecided` follow the verdict.
  - An unagreed addition Main defends as useful is a finding with REQUIREMENT `NOT AGREED` and `RULING: DECIDED`; Main
    removes it without asking the user (owner «2а 3а», question 2 option a). `REVIEWER.md` carries the exception sentence
    "Exception to the two rulings and the test: an addition the user never asked for (an extra feature, output, option
    or file) that Main defends only as useful or harmless is a finding with REQUIREMENT `NOT AGREED` and RULING
    `DECIDED`; Main removes it without asking the user."
  - Verdict extraction (`verdictOf`): a reply not starting with `CLEAN` or `FINDINGS:` starts at its first line that is
    exactly `FINDINGS:`; prose before `CLEAN` stays `incomplete` (owner «2а 3а», question 3 option a).
  - Outcome: a settled requirement with decisive evidence, Main fixes. A misreading, including a finding that demands
    what the agreement does not ask for or changes a settled decision: one rebuttal with the agreement quote, and the
    fresh reviewer decides. A missing or ambiguous decision, or a choice Main made that differs from what the user said,
    is `UNDECIDED` and goes to the user.
  - State: rebuttals persist with the review number entry (`{ n, rebuttals }`), findings and rulings in a second entry
    (`{ n, findings, rulings }`), all `pi.appendEntry("review", ...)`, rebuilt from the current branch on every call and   verdict, so they survive reload and resume. Owner: «У них цикла быть не должно. Знаешь, тут даже не должно быть трёх кругов. Смотри, как должно быть: должно быть правило трёх сообщений. Ревьюер даёт комментарий, main ему отвечает, и ревьюер либо соглашается, либо выступает против. И это конечное. Дальше main с ним уже не спорит: он либо принимает его решение, либо идёт к пользователю, чтобы тот разрешил спор, конфликт. Вот и всё.» (session `2026-10-21T16-27-59-062Z_01a15f4a`, line 391); «Если у ревьюера железобетонные доказательства, то мейн должен принять.» (session `2026-10-21T16-27-59-062Z_01a15f4a`, line 391); «Если ревьюер выявил работу, которая не была зафиксирована однозначным решением, то надо вопрос отдать этому пользователю, чтобы пользователь разрешил спор. Всегда всё идёт на основании решения пользователя.» (session `2026-10-21T16-27-59-062Z_01a15f4a`, line 391); «Да, и на каждом круге, конечно же, всегда у нас новый, свежий ревьюер» (session `2026-10-21T16-27-59-062Z_01a15f4a`, line 391); «Причем ему отдается инфа об отказе, возражения основного агента отдаются так, чтобы новый ревьюер потом без проблем понял, о чем идет речь.» (session `2026-10-21T16-27-59-062Z_01a15f4a`, line 391); original task text the owner pasted: «Задача: доработать RQW-review так, чтобы main и reviewer работали в паре: main может опровергнуть находку по существу» (session `2026-10-21T16-27-59-062Z_01a15f4a`, line 367). The former rule that a finding with verbatim quotes can never be rejected was an agent proposal, replaced by these messages. Earlier owner sources from omp sessions: [decisions evidence](notes/decisions-evidence.md#review-dispute-sources). Proof: `test/review.test.ts` suites "disputes: one finding, one rebuttal, one final answer" and "dispute mechanics".
  Limits: a reviewer that upholds a dispute without the DISPUTE field creates a new finding id, which Main could rebut
  once more. Probe evidence: `notes/reviewer-probes.md`, [decisions evidence](notes/decisions-evidence.md#review-dispute-probes).
  Since: `30c633f`.
- **Brief from the branch** `[D-REVIEW-BRIEF]`. `buildBrief` writes the user's messages of the current branch, verbatim,
  numbered and in order, with compaction and branch summaries labelled as not the user's words, then `agreement`,
  `object`, `criterion` and `<disputes>`; images are `[image]`. Reason: Main no longer retypes the user's words, the
  largest output cost of a call, and they cannot drift. Since: `3389347`.
- **Fresh reviewer session** `[D-REVIEW-SESSION]`. Each call is a fresh in-process session: `createAgentSession` with
  in-memory `SessionManager` and `SettingsManager`, in the caller's `ctx.cwd`, keeping the caller's session settings
  (shell, images, retries and provider timeouts, transport and its timeouts, compaction, thinking budgets, codemode;
  the [Agent](#agent) parity entry records the owner's answer; `reviewerSettings`). The resource loader loads no user extensions, skills,
  prompt templates, themes, context files or appended prompt. Its inline extension factories are Pi's `codemode` and
  `tool_search` when the caller has them active, and one factory that installs GPT Fast inheritance and the bash git
  guard. `REVIEWER.md` is the prompt; Pi adds only its `<cwd>` block. A general subagent of RQW-agent gets its own
  `review` through the `pi.events` offer `rqw-review:subagent-review`: verdicts go to it, its brief is its own messages,
  and its reviews end with it ([RQW-review README](extensions/RQW-review/README.md#review-in-subagents)).
  Since: `3389347`.
- **Reviewer tools** `[D-REVIEW-TOOLS]`. `read`, `bash`, `grep`, `find`, no `edit` or `write`, plus Pi's `codemode` and
  `tool_search` when the caller has them active, plus RQW-tools' `job` when RQW-tools offers its definitions. Each
  session requests fresh definitions over `pi.events` channel `rqw-tools:subagent-tools` with RQW-agent's
  `{ offer(factory) }` handshake, passing cwd, a settings getter and options: `label` `review` for the main session's
  reviewer, the caller's path plus `/review` for a subagent's (`agent#1/review`), and `codemode`, only when the reviewer
  has codemode, as Pi's definition built from the reviewer's own API. It keeps the four names, `job` and the returned
  `codemode`. Tools "Background jobs": a reviewer call still running after 12 s goes to the background; Esc of the review
  aborts its jobs, and the end of the review or of its subagent disposes them. Without an offer: the four stock
  definitions (`reviewerTools`) and Pi's own `codemode`/`tool_search` when active; nothing goes to the background. Offered
  and stock grep/find share `dropEmptyOptional`: `prepareArguments` drops optional arguments equal to `"null"`,
  `"undefined"` or blank, then chains the existing `prepareArguments`. Reason: grep otherwise passes `--glob null` to rg,
  a silent false negative. Proof: `test/review.test.ts`, stock and offered search paths. Since: `a04a9c0`.
- **Reviewer git guard** `[D-REVIEW-GITGUARD]`. `extensions/RQW-review/git-guard.ts` is a byte-equal self-contained copy
  of `extensions/RQW-agent/git-guard.ts`; root `test/copies.test.ts` asserts it without importing either extension.
  Every child bash `tool_call`, offered or stock, checks `blockedGit` and returns its reason as the tool error. Limit: a
  shell-syntax guard, not a sandbox. No file edits through bash and never running the delivered result are prompt rules,
  not runtime enforcement; repository tests may have filesystem side effects. Carrier: `index.ts`, `git-guard.ts`,
  `REVIEWER.md`. Since: `a04a9c0`.
- **Session model runtime** `[D-REVIEW-RUNTIME]`. The reviewer uses the session's own `ctx.modelRegistry.runtime`,
  private to TypeScript only. Reason: providers and logins registered by extensions reach the reviewer (with this
  package, RQW-anthropic's `anthropic` provider), and no second runtime refreshes the same OAuth login. Since: `3389347`.
- **Verdict format** `[D-REVIEW-FORMAT]`. `REVIEWER.md` carries the deep adaptation of the Spotty body: named paths are
  read whole and truncated files resume at the reported offset; the final answer is the last message, not `yield`.
  Verdict: `CLEAN`, or `FINDINGS:` with numbered `FINDING n` blocks (REQUIREMENT, MISMATCH, EVIDENCE, REQUIRED OUTCOME;
  DISPUTE, RULING and ANSWER only on a repeated disputed finding) and an optional `UNCHECKED:` section. REQUIRED OUTCOME
  states one concrete end state; `<criterion>` sets the scope. Proof: `test/review.test.ts` format pins.
  Earlier GPT prompt measurements: `notes/reviewer-prompt-gpt.md`, not proof for the deep prompt. Since: `e76994a`.
- **Async verdicts** `[D-REVIEW-ASYNC]`. The call returns `review#N started. ...` at once. The verdict, the reviewer's
  last assistant text, arrives as `pi.sendMessage({ customType: "review", content: "[review#N] <verdict>\n\n<next step>",
  display: true }, ...)`; `details` carry `n`, level, model, thinking and seconds. Numbers count per session and continue
  after resume; each issued number is persisted with `pi.appendEntry("review", { n })` before any asynchronous work.
  Recovery also accepts old direct review tool results and verdicts, not arbitrary tool text; this covers nested
  `ctx.executeTool` callers. Without `session_start` after an SDK reload, the first execution restores context and
  counter. `session_shutdown` aborts running reviews and delivers nothing; the 30-minute timer does not keep the process
  alive. Since: `3389347`.
- **Exactly-once delivery** `[D-REVIEW-DELIVERY]`. A verdict never waits in the agent's queue and gets exactly one main
  turn unless the run was aborted. Idle (`ctx.isIdle()`): sent with `triggerTurn: true, deliverAs: "followUp"` unless the
  last main run was aborted. Busy: sent with `triggerTurn: false`; Pi appends it at the end of the current turn or run,
  and the `agent_before_settle` handler returns `continue: true` while the verdict has no assistant message after it.
  When that handler returns without `continue`, a `settling` flag holds until `turn_start` or `agent_settled`; verdicts
  arriving meanwhile wait in `late` and `agent_settled` sends them, the last with `triggerTurn: !event.aborted`, so
  several get one turn. `mainAborted` latches `agent_settled.aborted` until a new `agent_start` and suppresses delivery
  turns only while idle. A verdict finishing after Esc or RPC abort while idle is saved once without starting Main; the
  next prompt carries it once. In print and json mode `agent_end` waits for jobs with its active `ctx.signal`; abort
  interrupts only that wait. Pi 1.4.0 has no active `ctx.signal` in `agent_before_settle`. Reason: review findings
  showed lost verdicts in print/json mode, after queue clears, error-ended runs and slow foreign `agent_before_settle`
  handlers. Proof: `test/review.test.ts`. Since: `ca6e2dd`.
- **Auth fallback** `[D-REVIEW-AUTH]`. "No credentials" only when both `ctx.modelRegistry.hasConfiguredAuth(model)` and
  `await runtime.checkAuth(provider, { signal })` say so, as in Pi's own prompt. Reason: the auth snapshot is filled
  asynchronously and can miss credentials right after startup or reload. Since: `ca6e2dd`.
- **Whole-job cancellation** `[D-REVIEW-CANCEL]`. Cancellation bounds the whole review job, including auth, session
  creation and prompt preflight. `untilAborted` races each asynchronous stage, observes late rejection and removes its
  listener; auth gets the signal; late-created sessions are disposed without prompting; prompt cancellation aborts and
  disposes without awaiting an uncooperative provider. The reviewer's `agent.streamFunction` checks the job signal
  before the SDK stream, so a preflight resuming after disposal cannot make a request; an unabortable underlying promise
  may stay pending but cannot hold the job or deliver twice. Coordinator text (not found in the Pi sessions): "deadline boundsWHOLEjobinclcheckAuth/create/promptpreflight". Since: `b4b23cf`.
- **Deterministic regression coverage** `[D-REVIEW-TESTS]`. `test/review.test.ts` (real sessions, faux main and
  reviewer providers) covers the five audit reproductions, post-abort delivery in all four modes, several verdicts,
  nested reload and legacy ids, ignored auth/provider cancellation, native prompt-preflight after timeout or shutdown,
  busy-time delivery, two verdicts held by a slow second extension (`test/slow-settle.ts`), and grep/find with `"null"`,
  `"undefined"` and blank arguments. `test/cli.test.ts` runs real CLI print/json subprocesses on Node, and on Bun with
  `PI_REVIEW_TEST_RUNTIME=bun`, with `test/cli-faux.ts` and the `test/offline.mjs` network tripwire. These establish
  runtime behavior, not review quality. Historical live smoke runs:
  [decisions evidence](notes/decisions-evidence.md#review-live-smoke). Since: `b4b23cf`.
- **Known limits** `[D-REVIEW-LIMITS]`. `ctx.modelRegistry.runtime` may be renamed by a Pi update, then every review
  fails with "the model runtime of the session is not reachable"; a verdict finishing after the session ended (quit,
  `/new`, `/resume`, reload) is dropped; print and json mode may wait up to 30 minutes for a slow review; a verdict
  arriving during a manual `/compact` with no run is appended and seen on the next turn; the reviewer may read a file
  Main is still editing (`startedText` asks Main not to). The main agent's own RQW-tools grep still passes a string
  `"null"` glob to rg: item GREP-NULL in [BACKLOG.md](BACKLOG.md#open). Since: `3389347`.

## PCLI

- **Separate VS Code extension** `[D-PCLI-EXT]`. `pcli-vscode/` is the VS Code extension `arqawa.pcli` ("ARQAWA PCLI",
  win32-x64) that starts Pi like CCLI starts Codex. It is outside `extensions/`, has no `RQW-` prefix and is not in
  `pi.extensions`. Coordinator text (owner quote not found in the Pi sessions): "надо сделать extension, как Arkava CLI, такой же, только PCLI... учитывая все требования, все ограничения". Carrier: `pcli-vscode/package.json`, `AGENTS.md`.
  Since: `3b6d6c1`.
- **Inside VS Code only** `[D-PCLI-VDI]`. Everything runs inside VS Code as a subprocess of the extension host.
  Coordinator text (owner quote not found in the Pi sessions): "у нас нет админских прав, у нас нет wsl, и нам нельзя запускать ничего такого прямо на хосте, только внутри vs code, только как extension vs code, как субпроцесс extension VS code. только так". Carrier: `pcli-vscode/extension.js`. Since: `3b6d6c1`.
- **Pinned bundled Pi** `[D-PCLI-PIN]`. Pi 1.4.0 is bundled in the VSIX, with no runtime update. `vscode:prepublish`
  runs `pcli-vscode/fetch-pi.mjs`: it downloads `pi-windows-x64.zip` of release `earendil-works/pi` v1.4.0, checks the
  hard-coded SHA256 `0f7256ea8bdac3af20012b94fdc1252a31cc6dc0d2f9b9eb539555d22e3e321b` and extracts into
  `pcli-vscode/pi/` (git-ignored). A new Pi version needs new VERSION, URL and SHA256 there and a new VSIX; the root npm
  dependency does not change the bundled `pi.exe`. Coordinator text (owner quotes not found in the Pi sessions): "мы не будем автоматически обновлять PCLai. Как есть 1.3 версия, так и есть."; "1 да давай 2 да давай". The pin moved from
  1.3.0 to 1.4.0 with the package upgrade ([Scope](#scope)). Build observations:
  [decisions evidence](notes/decisions-evidence.md#pcli-bundle). Since: `3b6d6c1`.
- **Release binary, not npm** `[D-PCLI-BINARY]`. Pi from npm is a Node program and would run inside `Code.exe` with
  `ELECTRON_RUN_AS_NODE=1`, which leaks into every bash command and depends on VS Code's Node; `pi.exe` carries its own
  runtime, the path omp-vscode already uses on the VDI. Carrier: `pcli-vscode/fetch-pi.mjs`. Since: `3b6d6c1`.
- **Launch chain and proxy** `[D-PCLI-LAUNCH]`. Extension host -> `powershell.exe` -> Git Bash
  (`C:\Program Files\Git\bin\bash.exe --login -i -c`) -> `pi.exe`, terminal through VS Code's own `node-pty`. The proxy
  comes from the `Code.exe` environment and the settings `http.proxy` / `http.proxyStrictSSL` (false sets
  `NODE_TLS_REJECT_UNAUTHORIZED=0`) and is exported in the Git Bash command line, so profile scripts cannot override it;
  the line first unsets `http_proxy`, `https_proxy`, `all_proxy` and `no_proxy`, because Pi prefers lowercase names.
  `~/.pi/agent` is shared and not changed. Carrier: `pcli-vscode/extension.js`. Since: `3b6d6c1`.
- **No version check** `[D-PCLI-NOVERSION]`. The tab sets `PI_SKIP_VERSION_CHECK=1`: the version is pinned.
  Coordinator text (owner quote not found in the Pi sessions): "1 да давай 2 да давай". Carrier:
  `pcli-vscode/extension.js`. Since: `3b6d6c1`.
- **One command** `[D-PCLI-COMMAND]`. One command, `Pi CLI: New Tab`; login is `/login` inside Pi. my-pi is installed
  into that Pi with `INSTALL.md`; the extension does not install it. Carrier: `pcli-vscode/package.json`. Since: `3b6d6c1`.
- **No Marketplace description** `[D-PCLI-NODESC]`. No `description` field in `pcli-vscode/package.json`, no README, no
  LICENSE; `pcli.yml` asserts an empty VSIX description. Coordinator text (owner quote not found in the Pi sessions):
  "При публикации в маркетплейс там НЕ ДОЛЖНО БЫТЬ НИКАКОГО ОПИСАНИЯ". Since: `3b6d6c1`.
- **End-to-end proof** `[D-PCLI-E2E]`. `.github/workflows/pcli.yml` on `windows-latest` builds the VSIX, installs it into
  a real VS Code and runs `pcli-vscode/test/run.mjs` and `test/suite.cjs`: Pi answers through a local proxy
  `test/proxy.cjs` with a fake HTTPS model, with the proxy from the environment under a hostile Git Bash profile and from
  VS Code settings; strict TLS fails and `http.proxyStrictSSL: false` works; CONNECT with proxy credentials; paths with
  Cyrillic, spaces and an apostrophe; no `pi.exe` left after closing tabs, `/quit` or VS Code. Not covered: a real model
  call and the corporate VDI restrictions. Since: `3b6d6c1`.
- **Wheel scroll cause** `[D-PCLI-MOUSE-CAUSE]`. In PCLI the wheel scrolled the input history instead of the
  conversation. Cause in Pi 1.4.0: `TuiAltScreen.beforeTerminalStart` writes `?1049h` and the mouse enable
  `?1000h ?1002h ?1003h ?1004h ?1006h` (without `?1003h` under tmux, Zellij or screen) before `terminal.start` enables raw
  mode and Windows VT input; ConPTY loses that early write, so VS Code never learns the app wants the mouse and the wheel
  becomes arrow keys. The same start path runs after the external editor, a TUI mode switch and suspend/resume.
  Owner: «Еще знаешь, какая проблема? У нас есть наш PCLI для Windows VDI тачки. Там такая проблема, что не работает скроллинг. Когда я пытаюсь скроллить в терминале, у меня прокручиваются последние сообщения вместо того, чтобы скроллился чат. А когда я запустил коды в CLI своим extension, там скролл нормально работает. Посмотри эту проблему, пожалуйста.» (session `2026-10-21T12-13-54-289Z_01a15e61`, line 158)
  Source lines and upstream history: [decisions evidence](notes/decisions-evidence.md#pcli-mouse-sources). Since: `8f6251a`.
- **Wheel fix** `[D-PCLI-MOUSE-FIX]`. A my-pi extension that matters only where my-pi is installed in PCLI's Pi
  ("myIP" is the speech-to-text spelling of my-pi). Engineering choice: only on Windows and only in fullscreen, enable
  the mouse again after the terminal started and after every TUI restart, with exactly Pi's set (multiplexer variant
  included), keeping Pi's disable on stop. On `process.platform === "win32"` the factory wraps
  `TuiAltScreen.prototype.afterTerminalStart`, stock Pi's empty hook, and after it writes Pi's set when `mouseEnabled`.
  Pi's early write and `?1049h` stay; regular mode (`TuiMainScreen`) and print, JSON and RPC never use the class. The
  patch is process-wide: each factory run adds an owner token to the `Set` under `Symbol.for("rqw-mouse/state")`, its
  `session_shutdown` removes only that token, and the last owner leaves the prototype as Pi made it. `/reload`, `/new`
  and `/resume` renew it; switching the extension off and reloading removes it.
  Owner: «Теперь по нестабильному тесту 1А: myIP на VDI, исправление прокрутки делаю расширением myIP. Да, насчёт myIP в VDI: это только если myIP установлен. Если он не установлен, то поебать вообще.» (session `2026-10-21T16-27-59-062Z_01a15f4a`, line 591)
  Carrier: `extensions/RQW-mouse/index.ts`, its own `pi.extensions` entry ([Isolation](#isolation)). Since: `8f6251a`.
- **Wheel fix limits** `[D-PCLI-MOUSE-LIMITS]`. It acts when Pi's terminal starts, so Pi must be restarted after
  installing or updating my-pi; `/reload` does not restart the TUI. my-pi must be installed in the Pi that PCLI runs
  (`INSTALL.md`). It brings the mouse commands to VS Code; the VDI's own wheel handling is not verified. The extension
  throws a load error when `TuiAltScreen.beforeTerminalStart` or the base `afterTerminalStart` hook is missing.
  Since: `8f6251a`.
- **Wheel fix proof** `[D-PCLI-MOUSE-PROOF]`. `extensions/RQW-mouse/test/mouse.test.ts` (in `npm test`, macOS and Windows
  CI): Pi's real `TuiAltScreen` on a recording terminal, Windows simulated through `process.platform` elsewhere; the
  write right after `terminal.start` equals Pi's earlier set for each multiplexer variant and repeats after every restart;
  Pi's disable runs on every stop; nothing is added with the mouse off, in regular mode or on non-Windows platforms;
  owner counting, `/reload`, a hook Pi defines on the class and a foreign wrapper; loading through Pi's resource loader
  with the same `TuiAltScreen` class. Capture: job `mouse` of `.github/workflows/pcli.yml` (`workflow_dispatch` or a
  push to branch `pcli`) runs `pcli-vscode/test/mouse.mjs` and `test/mouse-suite.cjs` in a real VS Code, starting the
  PCLI chain stock and with `-e extensions/RQW-mouse/index.ts`; expected `?1000h` count 0 stock and 1 with the extension.
  Measured run: [decisions evidence](notes/decisions-evidence.md#pcli-mouse-capture). Since: `8f6251a`.
- **Publishing** `[D-PCLI-PUBLISH]`. Skill `publish-pcli` (`.agents/skills/publish-pcli/SKILL.md`): `vsce publish
  --target win32-x64` from `pcli-vscode/` under publisher `arqawa`, `version` raised before each publish, only on a direct
  owner request. Since: `3b6d6c1`.

- **English UI text** `[D-PCLI-ENGLISH]`. PCLI user-visible text is English. The four messages in
  `pcli-vscode/extension.js` are `[pi exited, code N]`, `node-pty not found in VS Code: ...`,
  `Not found: <path>. Install Git for Windows.` and `Not found: <path>`. Russian code comments and Cyrillic
  test paths in `pcli-vscode/test/run.mjs` are not user-visible and stay.
  Owner: «Да переводить на англ то что ты спрашивал все переводить)»
  Source: `2026-10-21T16-27-59-062Z_01a15f4a-7ad5-7377-81be-0baf3b6ffa33.jsonl:4221` in the Pi USER session directory named in Provenance.
  Reason: the interface must be English; the owner approved translating the listed Russian messages.
  Carrier: `pcli-vscode/extension.js`; publication still requires a direct owner request. Since: `a55c859`.

## Anthropic subscription adapter

- **Main 1h, children 5m** `[D-ANTHROPIC-TTL]`. Anthropic offers 5m and 1h, not 10m or 15m. The main OAuth default stays
  1h; the independent child extensions own their 5m request policy ([Agent](#agent), [Review](#review)). Their explicit
  `short` wins in `cache.ts` and `transport.ts`, so cache markers stay on without `ttl: "1h"`, with or without this
  adapter. No new config knobs or process env changes.
  Owner: «По поводу кэшей вопрос-ответ A: основному агенту час А под основным 5 минут ещё какие-то варианты есть? Может, 10 минут? Или это замеренная цифра? Если это замеренная цифра и 5 минут будет заебись в большинстве случаев, то пусть будет 5 минут. Если можно больше и это будет более эффективно, то можно 10 минут поставить или 15. Я не знаю.» (session `2026-10-21T16-27-59-062Z_01a15f4a`, line 583)
  Reason: short review and resend gaps favour cheaper short writes. Evidence: [measurements](notes/prompt-cache-policy.md).
  Proof: package `test/prompt-cache.test.ts`. Since: `b91f832`.
- **OAuth 1h default** `[D-ANTHROPIC-OAUTH-TTL]`. OAuth subscription requests default to 1-hour prompt caching;
  explicit request retention and user-set `PI_CACHE_RETENTION` win. Engineering choice: request-local options before
  the SDK warmer starts, not a process-wide env write (which also changes OpenAI retention). `cache.ts` resolves Pi auth
  before the SDK stream and supplies `long` for OAuth only; `lifecycle.ts` binds and restores the wrapper for owning and
  shared-runtime child sessions; `transport.ts` covers direct provider calls. API keys and unrelated runtimes stay
  unchanged; warming policy lives in [Settings](#settings).
  Owner: «Почему ты не юзаешь какой-то часовой cash?» (session `2026-10-21T12-13-54-289Z_01a15e61`, line 275); «Это надо будет пофиксить тоже.» (session `2026-10-21T12-13-54-289Z_01a15e61`, line 281)
  Reference (TTL, timing, pricing, Pi's prospective warmer-cost limitation): `extensions/RQW-anthropic/README.md`,
  Prompt cache. Proof: `test/cache.test.ts`. Since: `ebf7bc1`.
- **Isolated extension** `[D-ANTHROPIC-EXT]`. `extensions/RQW-anthropic/`, listed in `package.json`, owns transport and
  OAuth recovery only; provider visibility is [Providers](#providers). Disable and reload unregisters only its overlay and
  restores in-memory hooks; no node_modules edits or credential deletion. Coordinator text (owner quote C:3046, an omp
  session, not found in the Pi sessions): "они должны быть полностью изолированы, самодостаточны, чтобы мы могли включать и выключать, как feature флаги". Toggle and migration: `extensions/RQW-anthropic/README.md`. Since: `8a1f2ed`.
- **Login and omp wire** `[D-ANTHROPIC-WIRE]`. The overlay keeps Pi's catalog and parser, delegates Pi's PKCE
  browser/copy-code login, and uses omp's refresh endpoint and headers, CLI billing block, original system role and
  exact-body XXH64 checksum. MIT attribution: `THIRD-PARTY-NOTICES.md`; no installed fork code is copied. Subscription
  acceptance and billing, account rotation and all omp SDK headers are not claimed. Coordinator text (owner quotes C:3133,
  an omp session, not found in the Pi sessions): "чтобы он был такой же, как в OMP, чтобы у него был self-healing";
  "И чтобы можно было через него авторизоваться". Evidence and risks: `notes/anthropic-adapter.md`. Since: `071df1e`.
- **Bounded refresh and replay** `[D-ANTHROPIC-REFRESH]`. `auth.ts` refreshes under Pi's runtime credential-store lock,
  rechecks the rejected bearer, reuses a concurrent update and persists rotation before replay. One HTTP 401 replay, at
  most two transient refresh attempts and one explicit newer-version replay; no auth retry for 403/quota, no replay after
  streaming. Caller abort cancels waiting and inference, not persistence of a rotating token. Permanent errors give
  /login guidance without upstream token-response bodies. Inference uses the official HTTPS origin only and rejects
  redirects. No bootstrap identity or startup version probe; `PI_AI_CLAUDE_CODE_VERSION` can pin the CLI version.
  Since: `8a1f2ed`.
- **Old adapter replacement** `[D-ANTHROPIC-MIGRATION]`. `INSTALL.md` step 0.1 removes an installed
  `git:github.com/edxeth/pi-claude-auth` with official `pi remove` in its installed scope, then installs or updates my-pi;
  no confirmation needed. `auth.json` and unrelated packages and settings stay; old explicit `-e` arguments are omitted
  on the next launch. Another competing adapter must be switched off; mixed configurations are not supported
  (`registration.ts` rejects a competing overlay). Coordinator text (owner quote not found in the Pi sessions): "Просто старый адаптер выкидываешь, который есть уже, и ставишь наш адаптер". Carrier: `INSTALL.md`, `extensions/RQW-anthropic/`.
  Since: `9ef1519`.
- **Proof boundary** `[D-ANTHROPIC-PROOF]`. Adapter and package-integration tests use fake credentials, mock fetch,
  file-backed lock fixtures and both Pi library and CLI-bundle entrypoints; they do not prove live subscription
  acceptance, billing or actual Windows execution. The status of old Claude benchmark campaigns is recorded once in
  [Work policy](#work-policy). Independent review follows `PROCESS.md`. Evidence: `notes/anthropic-adapter.md`,
  `notes/anthropic-integration.md`. Since: `8a1f2ed`.
- **Header boundary, per-request version** `[D-ANTHROPIC-HEADERS]`. Engineering follow-up to four review findings:
  the adapter rejects subscription Authorization headers before delegation and keeps ordinary API-key gateway behavior
  (`auth-boundary.ts`, `transport.ts`). Each request records its sent version, also under concurrency, with one bounded
  replay when an effective newer version meets a rejection; a pinned `PI_AI_CLAUDE_CODE_VERSION` forbids adaptation
  (`wire.ts`, `transport.ts`). Proof: `test/regressions.test.ts`. Since: `071df1e`.

## Models

- **Draft chooser** `[D-MODELS-CHOOSER]`. Shift+arrows open a model/effort draft chooser that performs one draft step
  before the first render; one transition is Shift+arrow then Enter. Plain and Shift arrows then share the same axes.
  Enter commits once; Esc closes with no setters or restoration. A draft model switch clamps effort to the nearest lower
  allowed level or the lowest. Dialog and key-repeat guards prevent stacked dialogs; session replacement, reload or
  shutdown cancels the draft. No settings, dependencies, request fences or aborts are added. Appearance: two compact
  terminal-native wheel columns, selected centre, muted neighbours, visible OK/Enter/Esc hints, supplied theme roles and
  thinking-level tokens; narrow rendering fits. Unchanged-model commits use only the thinking setter; changed-model
  commits use `pi.setModel` with a scoped synchronous pending-effort `model_select` handler, fallback and cleanup. Pi's
  setters are not atomic (README limit). The strict no-intermediate-request requirement was withdrawn by the coordinator
  as an overreach. `/rqw-models` and stock restrictions are unchanged.
  Owner: «Надо переделать picker модели effort таким образом, что когда я нажимаю Shift+стрелочку вверх, вниз или влево, вправо, у нас открывается визуальный интерфейс, в котором переключается модель визуально. Знаешь, как в iPhone, когда ты крутишь ползунки «минуты», «секунды», где-то открывается интерфейс, в котором предварительно меняется модель и effort, когда я нажимаю кнопочки, и там будет кнопочка «OK». Enter — это принять, а Escape — это отмена. Escape — закрыть интерфейс. И получится так, что когда я меняю интерфейс, меняю effort, он сразу не меняется, не применяется. Нет такого, что я пока переключаю модель, он запросы под разными моделями улетает. У меня префаер — мини-интерфейс, где я выбираю модель effort, нажимаю Enter, и оно применяется. Эта хуйня должна быть в стилистике нашего UI из тех задач, которые были. Следичку подгони сам. Потом, если что, если мне не понравится, мы её переделаем.» (session `2026-10-21T16-27-59-062Z_01a15f4a`, line 3228)
  Clarification: «когда ты нажимаешь первый раз Shift и стрелочку, у тебя открывается интерфейс уже с новой, будущей моделью измененной, чтобы я не делал дополнительные клики.» (session `2026-10-21T16-27-59-062Z_01a15f4a`, line 3238);
  «Если я нажимаю Shift+Влево или Shift+Вправо, то он сразу открывает пикер с измененным состоянием, чтобы мне нажать, а потом Enter. Нажать и Enter, если нужен один переход. А если несколько, то я нажал, довел до нужного состояния, нажал Enter.» (session `2026-10-21T16-27-59-062Z_01a15f4a`, line 3238);
  «И это должно быть строго в концепте Terminal UI Pi, и при этом чтобы это было в цветовой гамме и в согласованности с нашим новым дизайном, который ты сейчас имитируешь. Решение остается за тобой конечное.» (session `2026-10-21T16-27-59-062Z_01a15f4a`, line 3238)
  Carrier: `extensions/RQW-models/{index,picker}.ts`, `test/`, real Pi composition in `test/model-effort-picker.test.ts`.
  The effort colours of the footer are RQW-statusbar's (`[D-STATUSBAR-ACTIVITY]`). Since: `d0160cf`.
- **Startup availability** `[D-MODELS-STARTUP]`. Coordinator engineering choice, without its own owner quote: startup
  reads provider-scoped availability and uses the owning session's async-auth `setModel`. Before the startup choice
  `session_start` awaits Pi's provider-scoped `getAvailable(provider.id)` in parallel for the visible providers, sharing
  one 15 s deadline like Pi's model selector; on timeout or error the snapshot is used; without a choice nothing waits.
  Reason: Pi can discard a whole-runtime availability pass superseded by a background refresh, and `pi.setModel` checks
  that snapshot's configured-auth state first. Carrier: `extensions/RQW-models/index.ts`; `test/models.test.ts` gates a
  superseding pass deterministically. Since: `230e8d0`.
- **Independent module** `[D-MODELS-MODULE]`. `extensions/RQW-models/index.ts` imports only Pi and has its own
  `pi.extensions` entry; disable it in `pi config`, then `/reload`. It writes no settings and registers no tool; its
  instance-level masks are removed when it is off. Coordinator text (owner quotes C:3113, an omp session, not found in the
  Pi sessions): "Надо, чтобы они работали как в нашем OMP"; "Один мод будет статус бара, а второй мод будет Model Picker"; "То есть чисто модели Opus, Sonnet, GPT-6.1, GPT-6, Luna-6, Haiku". Since: `071df1e`.
- **GPT 5.6 Luna and Haiku order** `[D-MODELS-LUNA]`. Haiku stands above both Luna models; `openai-codex/gpt-5.6-luna` is
  a permanent list entry because the GPT reviewers use it ([Review](#review)); its low to max efforts are selectable,
  intersected with Pi support.
  Owner: «Надо подобрать сопостовимую модель на gpt, попробоуй 5.6 luna и более сильные модели типа medium ризонинг 6 и 6.1 sol, на время замеров добавь 5.6 luna в список моделей наших сразу после хайку и вообще хайку надо поставить над всеми в слабых моделях ь.е. порядок должен быть типа haiku 5.5, luna 5.6, luna 6» (session `2026-10-21T16-27-59-062Z_01a15f4a`, line 1167); «Да» (session `2026-10-21T16-27-59-062Z_01a15f4a`, line 1425)
  Carrier: `extensions/RQW-models/index.ts` (`FAMILIES`, `FAMILY_LEVELS`). Since: `7d6fdbf`.
- **Model order and availability** `[D-MODELS-ORDER]`. `FAMILIES`: `claude-opus-5-5`, `claude-sonnet-5-5`,
  `gpt-6.1-sol`, `gpt-6-sol`, `claude-haiku-5-5`, `gpt-5.6-luna`, `gpt-6-luna`, strongest first. `pickerModels` takes
  Pi's credential-aware availability including provider `filterModels`: the runtime's unmasked `getAvailableSnapshot`
  through its prototype while the listed-models masks are set, otherwise `ctx.modelRegistry.getAvailable()`. Absent,
  filtered and unauthenticated models are skipped. The draft resolves no credentials and makes no requests; commit uses
  Pi's authenticated setter. `familyOf` matches the same generation across provider paths, Claude dotted versions, dated
  aliases and Bedrock ids; nothing else is substituted. Since: `e6c21e2`.
- **One variant per family** `[D-MODELS-VARIANT]`. Engineering choice (coordinator brief C:3274): one available variant
  per family, preferring `anthropic` for Claude and `openai-codex` for GPT and the exact canonical id, then stable
  provider/id order; a proxy variant only when the preferred one is unavailable. Provider visibility is
  [Providers](#providers). Since: `071df1e`.
- **Shift+arrow keys** `[D-MODELS-KEYS]`. `registerShortcut` binds `shift+up` (stronger model), `shift+down` (weaker),
  `shift+right` (reasoning up), `shift+left` (reasoning down), as in omp (`model-arrows.js`, `reasoning-arrows.js`).
  Shift+Up moves to earlier, stronger entries; the stronger model direction agrees with the higher effort direction. The
  former Option/Alt+plus/minus layout and its aliases are removed. Pi 1.4.0 binds none of the four keys; terminals send
  CSI `1;2A`/`B`/`C`/`D` (Kitty also `1;2:1A`). The first match handles a press once. One guarded dialog owns the draft,
  so repeats queue no dialogs or live switches. Opening reads the live model from the latest `session_start` event
  context, refreshed on resume and reload, not a queued TUI snapshot. Movement stops at either end. Entry rule: from
  outside the list Shift+Up enters at the strongest available model and Shift+Down at the weakest.
  Owner: «Надо вернуть старое управление моделями: Shift + Вверх/Вниз будет смена модели, Shift + Вверх — к более сильным, Shift + Вниз — к более слабым. А Shift + Влево/Вправо — это будет смена ризенинга, так же, как и раньше это было в ОМП.» (session `2026-10-21T16-27-59-062Z_01a15f4a`, line 2361)
  Carrier: `extensions/RQW-models/index.ts`. Proof: `test/models.test.ts` (key bytes through Pi's matcher, direction,
  limits). Since: `ac33dcc`.
- **`/rqw-models`** `[D-MODELS-COMMAND]`. The extension's authenticated listed-model picker via `ctx.ui.select`. Pi's
  built-in model shortcuts stay reserved and are emptied, not replaced; Shift+Tab and provider definitions stay stock. In
  print/JSON mode it does nothing; RPC can supply the standard select dialog. Since: `e6c21e2`.
- **Only listed models** `[D-MODELS-LISTED]`. Only models of the list (any provider variant matched by `familyOf`) can be
  selected or used anywhere, including CLI `pi --model`, restored sessions and `agent` subagent models.
  - Stock lists are empty: on every `session_start` RQW-models borrows the owning `AgentSession` in one synchronous
    `ctx.getContextUsage()` call (prototype swapped and restored in that call), then masks `getAvailableSnapshot()` and
    `session.scopedModels` to `[]`. `/model`, its autocomplete, Ctrl+L, Ctrl+P, `/scoped-models`, `/settings` default
    model, RPC `get_available_models`/`set_model`/`cycle_model` and post-login auto-selection find no model.
  - Selection outside the list is refused before mutation: `setModel` rejects with `<provider>/<id> is not in the RQW
    models list. Allowed: <listed IDs>.` and a warning; model, entries, settings and `model_select` stay unchanged.
  - On `session_start` an unlisted current model is replaced by authenticated Opus, else the strongest authenticated
    listed model, at medium or the startup/`/new` `--thinking`, with a warning. With no authenticated listed model the
    model stays and the warning says its requests are refused. The wait before this choice is `[D-MODELS-STARTUP]`.
  - Requests: the owning runtime's `prepareRequest` refuses chat requests for an unlisted model with `RQW-models refused
    the request: <the same text>`, covering in-process subagents; the reviewer models (Haiku, Sonnet, GPT-5.6 Luna) are
    listed. Pi's own requests use the session's model; image and classifier models pass.
  - Masks call Pi's current prototype methods, so RQW-anthropic and RQW-context patches keep working; they are
    reference-counted and removed on `session_shutdown` or `session.dispose()`.
  - Limits: Ctrl+P still prints "Only one model available"; `/scoped-models` shows saved patterns as unavailable rows;   after `/login` Pi suggests `/model`; if the session cannot be borrowed RQW-models warns and stock lists stay. Owner: «Смотри, про выбор модели, где через стрелочки вверх, вниз, через плюс-минус мы меняем модели, меняем effort. Там меняются только модели из нашего списка. И вообще другие модели выбрать нельзя, только модели в этом списке. Дефолтный Model Picker работать не должен. Там должен быть пустой список моделей.» (session `2026-10-21T16-27-59-062Z_01a15f4a`, line 335); «Да, делай» (session `2026-10-21T16-27-59-062Z_01a15f4a`, line 344) to the coordinator option "a) Закрыть и эти пути. Модель вне списка не выбирается нигде, Pi покажет предупреждение." The
  strongest-listed fallback without Opus auth is a coordinator choice derived from that rule. Carrier:
  `extensions/RQW-models/index.ts`. Pi mechanisms: [notes/models-omp.md](notes/models-omp.md). Since: `5e1d478`.
- **Opus medium at startup** `[D-MODELS-DEFAULT]`. Without explicit CLI model selection, `session_start` selects
  available Opus at `medium` on a fresh startup or `/new`; with no authenticated Opus it keeps Pi's initial model if
  listed. Startups with history or continuation/session flags, and `resume`, `fork`, `reload`, keep a listed current
  model and thinking. Explicit CLI `--model`/`--models` of listed models keep Pi's resolved model and thinking, including
  suffixes, scoped suffixes, `--thinking` precedence and settings effort; Pi's exported `parseArgs` recognizes them and
  no suffix is parsed again. Without an explicit model, `--thinking` applies through Pi's native clamping, else medium.
  CLI overrides apply to `/new` too; no defaults are persisted. An SDK host must pass reason `resume` for an empty
  restored session. Coordinator text (owner quote C:3113, an omp session, not found in the Pi sessions): "И базовая модель всегда при запуске — это Opus-Medium. Это от провайдера не зависит". CLI precedence and resumed-session
  preservation are coordinator choices (C:3123, C:3274). Proof: `test/models.test.ts`. Since: `071df1e`.
- **Harness effort lists** `[D-MODELS-EFFORT]`. `FAMILY_LEVELS` intersected with Pi's `getSupportedThinkingLevels`:
  Opus low, medium, high; Sonnet low, medium, high, xhigh; GPT-6.1 Sol, GPT-6 Sol, both Luna models and Haiku low,
  medium, high, xhigh, max. No minimal, no off. A model switch keeps the previous effort if allowed, else the nearest
  lower or the lowest; explicit off/minimal moves to the lowest allowed level on the next extension-driven selection. An
  unlisted model (current only while no listed model is authenticated) keeps Pi-supported levels minus off and minimal.
  Owner: «Нет, ты не понял: уровни effort будут не те, что в стоковом выборе Pi, а те, что в нашем MyOMPHarness были. Там они были перенастроены кастомно. Допустим, у Opus были low, medium, high, у Sonnet были low, medium, high, extra high. Такие же должны быть, только без no reasoning.» (session `2026-10-21T16-27-59-062Z_01a15f4a`, line 134)
  Carrier: `extensions/RQW-models/index.ts`. Source evidence: [notes/models-omp.md](notes/models-omp.md). Since: `0def125`.
- **Model tests** `[D-MODELS-TESTS]`. `extensions/RQW-models/test/models.test.ts`, faux only: standalone loading and
  disabling, real SDK sessions, model/thinking changes, history restore and reload, no persisted defaults, CLI flags
  (also through Pi's CLI bundle), missing Anthropic auth, the listed-models rule, a provider `filterModels` dropping a
  family, a pending startup availability pass, a subagent-style session, rapid snapshot contexts and reasoning queued
  behind a switch. Key tests feed CSI `1;2A..D` and Kitty `1;2:1A..D` through Pi's matcher; the old Option-layout bytes
  are negative cases. `test/anthropic-models.test.ts` switches RQW-models and RQW-anthropic off in turn. This is parser
  testing, not manual terminal testing. CI runs on macOS and Windows (`tests.yml`); Linux is out of scope. Historical
  local reports: [decisions evidence](notes/decisions-evidence.md#models-reports). Since: `e6c21e2`.
- **CI auth fixture** `[D-MODELS-CI-FIXTURE]`. `test/models.test.ts` seeds `models.json` with
  `providers.openai-codex.apiKey: faux-only` before spawning Pi, so the no-Opus-auth fallback test has a deterministic
  initial model on Pi 1.4.0 (native-provider registration refreshes availability asynchronously while `findInitialModel`
  reads the synchronous snapshot). Fixture auth only, no production change. Investigation and numbers:
  [decisions evidence](notes/decisions-evidence.md#models-ci-fixture). Since: `071df1e`.

## Status bar

- **Independent extension** `[D-STATUSBAR-EXT]`. `extensions/RQW-statusbar/` has its own `pi.extensions` entry and
  imports nothing from another extension folder. Coordinator text (owner quote C:3133, an omp session, not found in the
  Pi sessions): "Просто нужны элементы и расположение их отображения, и всё". Row contract and evidence:
  `notes/statusbar-omp.md`; no other omp UI is copied. Since: `0f356c4`.
- **Toggle** `[D-STATUSBAR-TOGGLE]`. On by default; `/statusbar [on|off]` toggles in the TUI, the bare command inverts.
  Off restores the stock editor (only when ours is installed) and footer and disposes polling and subscriptions. The
  choice is local to the loaded extension, not persisted. Print, JSON and RPC do no footer work. Model and thinking are
  read live from Pi. Since: `0f356c4`.
- **Context limit** `[D-STATUSBAR-CONTEXT]`. Context tokens and window come from Pi; the bar measures the effective
  compaction threshold from Pi's own reserve resolver, including a cap installed by RQW-context, and never changes it.
  Unknown post-compaction usage is `?/limit`, since zero would claim a known empty context. Since: `0f356c4`.
- **No invented data** `[D-STATUSBAR-SCOPE]`. omp data without a stock Pi API is not shown: modes, collaboration,
  streaming/recording and PR metadata. Running agent, worker and review counts are shown, read from RQW-agent and
  RQW-review over `pi.events` (`[D-STATUSBAR-ACTIVITY]`). Colours are the extension's own ANSI and truecolour values, not
  stock theme roles. Limits and samples: `notes/statusbar-omp.md`. Since: `0f356c4`.
- **Activity chrome (UI port P6)** `[D-STATUSBAR-ACTIVITY]`. The editor's top border shows the activity status after
  `── `: the running tool's action (`Running <command>`, `Editing <file>`, `Searching files`) or `Planning next moves`,
  then running counts (`2 agents, 1 worker, 1 review`) from the `rqw:running-counts:request`/`offer` channels, or
  `Waiting for <counts>` when only background work runs, and `Compacting context` in gold during compaction; idle it is
  the plain rule. Ordinary rules are silver, busy letters shimmer silver, compaction letters, chrome and context row are
  metallic gold. A static bold gold session title widget (`rqw-statusbar-title`) shows the session name above the
  input. Off the original first branch the place row shows the English `⑂ fork #N` marker from the public session
  tree, as defined in `[D-STATUSBAR-BRANCH-MARK]`. Footer effort colours: low plain, medium bold green, high bold
  gold, xhigh bold bright purple, max bold red. Carrier: `extensions/RQW-statusbar/{activity,branch,render,editor,index}.ts`.
  No owner quote for P6 is recorded here; the commit message lists the cross-extension native integration as not
  verified. Since: `d84b541`.
- **GPT Fast lightning** `[D-STATUSBAR-FAST]`. The main chat's GPT Fast state ([Settings](#settings), "GPT Fast") shows as
  a bright yellow lightning after the model name, before the thinking level, when it is on and the model's provider is
  `openai-codex`. While the agent works a shimmer runs over the bolt (bright yellow, paler yellow, white, back; 120 ms per
  step); idle it is static bright yellow. The timer runs only while the agent works and the lightning is shown. The glyph
  before the model name stays. Engineering choices: Nerd Font bolt `\uf0e7` (U+26A1 is two cells in pi-tui); own ANSI
  colours (bold 93, 38;5;220/226/229, 97), not a theme role. The state is queried from RQW-settings over `pi.events` at
  every render and redrawn on its change event; nothing is imported.
  Owner: «Надо, чтобы метка фаз была в виде молнии яркой Желательно которая ярко-желтая с бликом переливающимся. Можешь так сделать?» (session `2026-10-21T16-27-59-062Z_01a15f4a`, line 2158);
  «Нет, лучше значок молнии пририсовывать после имени модели между моделью и резонингом.» (session `2026-10-21T16-27-59-062Z_01a15f4a`, line 2175) The shimmer while
  working and the steady yellow idle follow the coordinator description the owner accepted. Carrier:
  `extensions/RQW-statusbar/{render,index}.ts`. Proof: `test/fast-gpt.test.ts`. Since: `fa05edf`.
- **Animation cadence** `[D-STATUSBAR-ANIMATION]`. The status animation (busy letters, compaction gold and sheen, the
  lightning) redraws every 20 ms, 50 nominal frames per second, and follows elapsed monotonic time, not tick counts.
  Letters and sheen take one phase frame per 160 ms of elapsed time; between frames the compaction sheen blends each
  cell toward its next colour; the lightning keeps one colour step per 120 ms. The phase is read at render time. The
  static gold title, the input text and the effort colours do not animate. The timer runs only while an animated status
  or the working lightning is shown. While our editor owns the top border, Pi's hidden working spinner gets no frames
  (`ctx.ui.setWorkingIndicator({ frames: [] })`); off, shutdown, reinstall and a foreign editor restore Pi's default,
  checked on every tick and activity change. Pi 1.4 batches paints at most every 16 ms. Cost: every paint re-renders Pi's
  component tree; terminal, GPU, remote and visible frame rate are not measured.
  Owner: «Не ускорить, а сделать более плавной, в два раза плавнее.» (session `2026-10-21T16-27-59-062Z_01a15f4a`, line 3636);
  «Давай попробуем сделать 50 FPS для начала.» (session `2026-10-21T16-27-59-062Z_01a15f4a`, line 3662); «Даже можно скорость блика сделать медленнее, чтобы она шла более медленно, более плавно.» (session `2026-10-21T16-27-59-062Z_01a15f4a`, line 3662)
  Carrier: `extensions/RQW-statusbar/{index,render}.ts`. Proof: `test/{lifecycle,chrome,fast-gpt}.test.ts`; numbers in
  `notes/statusbar-omp.md`. Since: `e3b3566`.
- **Own git discovery** `[D-STATUSBAR-GIT]`. Git branch and counts use the extension's own repository discovery and
  asynchronous git refresh, not Pi's cached `getGitBranch()`, which caches absent metadata when a session starts outside
  git. Engineering choice. Carrier: `extensions/RQW-statusbar/{git,index}.ts`. Evidence: `notes/statusbar-omp.md`.
  Since: `6b9b0b9`.
- **Context bar as bottom border** `[D-STATUSBAR-BOTTOM]`. The context bar is the input editor's bottom border, not a
  separate footer row; the footer keeps the model and place rows. Mechanism: `ctx.ui.setEditorComponent` with a
  `CustomEditor` subclass (`ContextEditor`) that overrides `renderTopBorder` and `renderBottomBorder`; Pi carries over
  text, border colour, padding and app keys. The down-arrow `N more` hint comes first and the bar takes the rest. When
  another extension's editor is installed it is kept and the bar stays the first footer row; if one replaces ours, the
  footer shows the row again. Outside the TUI nothing is installed.
  Owner: «Я бы хотел, чтобы бар контекстного окна был вместо нижней чёрточки.» (session `2026-10-21T12-13-54-289Z_01a15e61`, line 136)
  Carrier: `extensions/RQW-statusbar/{editor,index}.ts`, `render.ts` `editorBorder`. Contract: `notes/statusbar-omp.md`.
  Since: `1a2adb2`.
- **Session ID in the top border** `[D-STATUSBAR-TOP]`. With our editor installed the whole top border is ours:
  `render.ts` `topBorder`, called from `editor.ts` `renderTopBorder`, draws the silver rule, the activity status
  (`[D-STATUSBAR-ACTIVITY]`) at the left, Pi's `↑ N more` hint centred, and the full session ID at the right end as
  ` <id> ──` in the muted label colour; Pi's native working indicator is not drawn there. The ID is Pi's
  `sessionManager.getSessionId()`, read on every render, with one plain space on each side so a selection copies it
  whole; when the status or hint would be cut it is dropped whole. With the bar off or a foreign editor Pi's own border
  returns and there is no ID. `sessionTopBorder` in `render.ts` is used only by `test/render.test.ts`.
  Owner: «Можно добавить его в верхнюю часть там, где working крутится, хуйня. С левой стороны сделать также вставку id сессий с пробелами: идёт чёрточка, потом id, потом снова чёрточка. Прямо по левому краю.» (session `2026-10-21T16-27-59-062Z_01a15f4a`, line 191);
  «Я бы так сделал, чтобы это было симметрично по левому краю именно, и чтобы между чёрточками и ID был какой-то пробел, хотя бы по одному, чтобы можно было нормально вырезать и вставить, скопировать и вставить.» (session `2026-10-21T16-27-59-062Z_01a15f4a`, line 191)
  Correction: «По визуальному он должен стоять справа. Я ошибся: не с левого края, а с правого края. Слева working, справа ID сессии. Он прижат должен быть к правому краю, а ID к левому краю прижат. Если места нету, то он и не отображается, его просто не видно.» (session `2026-10-21T16-27-59-062Z_01a15f4a`, line 203)
  Carrier: `extensions/RQW-statusbar/{editor,render,index}.ts`. Contract: `notes/statusbar-omp.md`. Since: `c6b642c`.
- **Tokens per second** `[D-STATUSBAR-RATE]`. `usage.output * 1000 / durationMs` per completed assistant message of the
  main session, `durationMs` being Pi's monotonic time from the request start. Skipped: missing or non-positive `output`
  or `durationMs`, `durationMs` under 500 ms, `stopReason` `aborted` or `error`. No chars/4 fallback, no live value while
  streaming; the last value holds until the next, nothing before the first, reset on session start, tree change and
  toggle. `usage.output` already includes reasoning tokens. Reason: neither Anthropic nor Codex returns a rate field.
  Owner: «Смотри, токены в секунду какую-то хуйню показывают. Надо как-то привести, чтобы токены в секунду очень хорошо и качественно работали. Надо разобраться, почему в ОМП таких ситуаций не бывает, а почему у нас токены в секунду показывают дичь какую-то. И по-хорошему, надо сделать так, чтобы токены в секунду были залайнены на те показатели, которые отдаёт провайдер, Anthropic либо Codex Legacy.» (session `2026-10-21T16-27-59-062Z_01a15f4a`, line 464) The owner chose
  coordinator option a: "Делим точное число выходных токенов от провайдера на время ответа. Время Pi сам меряет точными часами от начала запроса. Ответы короче полсекунды не учитываем. Значение обновляется после каждого ответа."
  Carrier: `extensions/RQW-statusbar/{render,index}.ts` `RateMeter`. Contract: `notes/statusbar-omp.md`. Since: `2f5be5b`.

- **Session branch mark** `[D-STATUSBAR-BRANCH-MARK]`. The interface is English: off the original session
  branch, row 3 shows `⑂ fork #N`, such as `⑂ fork #2` or `⑂ fork #3`. The glyph, `label` colour role,
  two-space gap and hiding rules stay unchanged; only the wording after the glyph changes.
  Owner quotations in source order:
  Owner: «В интерфейсе надо поменять ветка два на branch two, как-нибудь её сделать типа BR2. У нас весь интерфейс должен быть английский. Пройдись по интерфейсу, найди, где есть русский язык, и дай мне список. Будем думать, как англицизировать всё дело.»
  Owner: «Насчет BR2 я имею в виду, что должен сам придумать пиздатую аббревиатуру, которая будет подходить к нашему дизайну и вписываться в него органично.»
  Owner: «Допустим, это может быть не BR2, а просто значок ветки и написано V2, V3 или branch V2 написано, V3, что-нибудь такое»
  Owner: «Мне нравится вариант Fork 2, только надо решетку сделать: fork #2, и все»
  Source: `2026-10-21T16-27-59-062Z_01a15f4a-7ad5-7377-81be-0baf3b6ffa33.jsonl`, USER entries at physical lines 4044, 4049 and 4090.
  Reason: use the owner's chosen English marker without changing its placement or rendering rules.
  Carrier: `placeRow` in `extensions/RQW-statusbar/render.ts`; proof: `extensions/RQW-statusbar/test/chrome.test.ts`,
  `extensions/RQW-statusbar/test/lifecycle.test.ts`; contract: `notes/statusbar-omp.md`. Since: `21179e1`.

## Anthropic package integration

- **Package integration** `[D-ANTHROPIC-PKG]`. Coordinator integration brief (C:3376), not an owner quotation:
  RQW-anthropic is the ninth of the fourteen `pi.extensions` entries; package fixtures use fake authenticated allowed
  providers, not a visibility bypass, and the dynamic isolation assertions are unchanged. `test/anthropic-models.test.ts`
  covers source order, unauthenticated startup, Opus medium with mock secrets, login visibility, the stock fallback with
  the adapter or RQW-models off, and RQW-anthropic and RQW-providers each off alone. Proof boundary:
  `[D-ANTHROPIC-PROOF]`. Notes: `notes/anthropic-integration.md`. Since: `071df1e`.

## Scroll

- **Escape jumps down** `[D-SCROLL-ESC]`. Escape in Pi's fullscreen view returns a scrolled-up transcript to the latest
  message, as in Codex; at the bottom Escape stays stock, Ctrl+End stays, an open transcript search takes the first
  Escape. Package behaviour for every my-pi user.
  Owner: «Да, я также бы хотел перенастроить хоткеи, чтобы когда я скролю, jump to last message было на Escape» (session `2026-10-21T12-13-54-289Z_01a15e61`, line 53);
  «Хотя бы должен быть какой-то адекватный хоткей, который будет перехватываться всеми браузерами нормально. И чтобы он не конфликтовал с другими хоткеями.» (session `2026-10-21T12-13-54-289Z_01a15e61`, line 77);
  answer to coordinator option 1a: «Сделай Escape просто, что когда я открыл вверх, я Escape нажимаю, как в кодексе. В кодексе ты когда scroll вверх делаешь, нажимаешь Escape, и он тебя возвращает в самый низ чата. Так же сделай» (session `2026-10-21T16-27-59-062Z_01a15f4a`, line 100)
  Since: `72873eb`.
- **Own extension** `[D-SCROLL-EXT]`. `extensions/RQW-scroll/index.ts`, its own `pi.extensions` entry, switched off alone
  ([INSTALL.md](INSTALL.md#switch-one-extension-off), [Isolation](#isolation)); the behaviour belongs to no existing
  extension. Since: `72873eb`.
- **Input listener** `[D-SCROLL-MECH]`. Engineering choice: binding `escape` to `tui.altScreen.bottom` is rejected
  because Pi's viewport would consume it even at the bottom. The extension adds `ctx.ui.onTerminalInput`; Pi's
  alt-screen listener runs first, so its own keys keep priority. It consumes Escape only when the renderer is
  `fullscreen`, `isFollowingOutput` is false and the focus is Pi's main editor (a `CustomEditor`, detected by its
  `actionHandlers` map) without an open autocomplete list, then calls `scrollToBottom()`. Otherwise Escape is untouched;
  inline, print, JSON and RPC are unchanged. The TUI is reached through a `belowEditor` widget factory that renders no
  line; key releases are not consumed. Since: `72873eb`.
- **Hint shows Esc** `[D-SCROLL-HINT]`. While Escape can jump, the fullscreen hint shows `Esc` with the configured bottom
  keys (default `Esc/Ctrl+End`). `index.ts` replaces the `getKeybindings`/`setKeybindings` registry with a display facade
  that decorates only `getKeys("tui.altScreen.bottom")`; matching and configuration delegate unchanged. Shutdown
  restores the prior registry if it still owns the slot.
  Owner: «Нашел баг: не Escape мы возвращаемся уже, а в надписи написано старый hotkey.» (session `2026-10-21T16-27-59-062Z_01a15f4a`, line 727) Since: `8c29ff8`.
- **Limits** `[D-SCROLL-LIMITS]`. A custom editor not extending `CustomEditor` gets stock Escape. With search open, the
  first Escape closes search and the second jumps. The keybinding registry is process-global; the facade follows its
  owning interactive renderer. Since: `72873eb`.
- **Proof** `[D-SCROLL-TESTS]`. `extensions/RQW-scroll/test/scroll.test.ts` (in `npm test`) with Pi's real renderers and
  proxy, chat viewport, `CustomEditor`, `ExtensionSelectorComponent`, overlay and search, loaded by Pi's resource loader:
  scrolled up Escape jumps and is consumed, then interrupts; at the bottom it interrupts; Ctrl+End jumps; selector,
  overlay, autocomplete and search keep their Escape; inline mode, unloaded and after shutdown are stock; the hint lines
  and the unchanged registry are asserted. Local PTY probe: [decisions evidence](notes/decisions-evidence.md#scroll-pty-probe).
  Since: `72873eb`.

## Session commands

- **`/copy-session` and `/remove`** `[D-SESSION-COMMANDS]`. `/copy-session` copies the session ID with Pi's exported
  clipboard implementation; the name avoids Pi's built-in `/copy` (coordinator-specified spelling). `/remove` uses one
  `ctx.ui.select`, refuses without UI, and calls `ctx.newSession({ withSession })` before deletion so old writers and
  shutdown hooks finish. Contract: `extensions/RQW-session/README.md`.
  Owner: «И по-хорошему надо какую-нибудь команду вбить, типа COPY SESSION ID. И надо ещё добавить команду remove сессии, как в кодексе, чтобы можно было написать /remove и удалить полностью эту сессию со всей историей, со всей хуйнёй, которая с ней связана.» (session `2026-10-21T16-27-59-062Z_01a15f4a`, line 191);
  «Просто надо сделать /copy session команду, чтобы я мог её просто скопировать в буфер обмена и всё.» (session `2026-10-21T16-27-59-062Z_01a15f4a`, line 203)
  Carrier: `extensions/RQW-session/{index,artifacts}.ts`, its own `pi.extensions` entry. Since: `db5ab64`.
- **Confirmation dialog** `[D-SESSION-CONFIRM]`. `/remove` asks once with `["1. No", "2. Yes"]`; Pi 1.4.0's
  `ExtensionSelectorComponent` starts at index 0, so deletion needs Down then Enter. The deleted session is gone without a
  trash and a new empty session opens.
  Owner: «После remove сессия удаляется, но совсем, полностью без корзины, и сразу открывается новая пустая сессия, как ты предложил. Потом подтверждение удалению один раз. Просто на экране поднять визуально, как в кодексе открыть диалог с вопросом «да/нет?». Циферка один по дефолту — нет, по не дефолту — да. То есть циферка один — нет, циферка два — да. И мне, чтобы удалить, надо нажать стрелочку вниз и Enter. Это если у тебя есть SDK для того, чтобы такие диалоги открывать.» (session `2026-10-21T16-27-59-062Z_01a15f4a`, line 203)
  Carrier: `extensions/RQW-session/index.ts`, README. Proof: `test/session.test.ts` drives the real component.
  Since: `db5ab64`.
- **Deletion scope** `[D-SESSION-SCOPE]`. Coordinator-approved scope, not an owner quotation: delete the current JSONL
  plus referenced artifact files not referenced by other sessions, keeping user forks and shared artifacts. Only
  Pi-generated basenames inside OS temp are deleted, never arbitrary `fullOutputPath` values; JSONL outside the agent
  directory is refused; no symlink escape, directories or unrelated files. Randomly named unreferenced temp files,
  including in-memory subagent and reviewer spills, stay for OS temp cleanup: no complete-erasure claim. Reason: no safe
  ownership map exists. Mechanism: README. Since: `db5ab64`.
- **Safe scan** `[D-SESSION-SCAN]`. `artifacts.ts` preflights other sessions before replacement, so discovery errors
  leave the current session active and name the file; malformed JSONL lines are tolerated and scanned conservatively in a
  streamed asynchronous scan; the final JSONL is read after shutdown. Rules and failure behaviour:
  `extensions/RQW-session/README.md`. Research notes: [decisions evidence](notes/decisions-evidence.md#session-research).
  Since: `db5ab64`.
- **Proof** `[D-SESSION-TESTS]`. `extensions/RQW-session/test/session.test.ts`: temp agent directories, a stub clipboard,
  refusal paths, artifact and fork preservation, path safety, a real Pi runtime replaced before its JSONL is deleted.
  Mechanics only, not VDI clipboard redirection, forensic erasure or remote deletion. Since: `db5ab64`.

## Send now

- **Enter sends queued steering** `[D-SENDNOW-ENTER]`. While the agent works, Enter with text queues steering as stock;
  Enter on an empty editor while steering is queued interrupts the turn and sends the queue at once; with nothing queued
  empty Enter does nothing; no other key changes (coordinator brief). Stock Pi 1.4.0 needs Escape then Enter.
  Owner: «А ещё надо, чтобы у нас работала, как в OMP, Oh My Pie, отправка: я пишу сообщение, оно стоит в очереди на стекинг, и чтобы я мог через Enter его насильно отправить. Я не разобрался, как в Pi это сделать.» (session `2026-10-21T16-27-59-062Z_01a15f4a`, line 145);
  «Мне надо, чтобы в Py я мог нажать Enter и сообщение ушло, чтобы не нажимать ебучие Escape, Enter. Это какой-то рак мозга, мне кажется. Надо проверить, можем мы сделать это или нет. Если можем, надо сделать» (session `2026-10-21T16-27-59-062Z_01a15f4a`, line 184)
  Carrier: `extensions/RQW-send-now/index.ts`, its own `pi.extensions` entry ([Isolation](#isolation)); behaviour and
  limits: `extensions/RQW-send-now/README.md`. Since: `d1f8b16`.
- **Public API only** `[D-SENDNOW-API]`. Engineering choices: `ctx.ui.onTerminalInput`, `ctx.abort`, editor text,
  `pi.sendUserMessage`; no custom editor, since RQW-statusbar owns `setEditorComponent`. The key is Pi's
  `tui.input.submit`; only Pi's focused input editor triggers it. Steering is told from follow-ups by counting `input`
  events, because the public context reports only whether anything is queued; in-flight inputs and a run's starting
  prompt are accounted for, leftovers after the abort are sent or restored to the editor, and a follow-up-only queue is
  left to Pi. Since: `d1f8b16`.
- **Interrupted reply kept** `[D-SENDNOW-REPLAY]`. For the reply a force-send interrupts, a `context_with_system` handler
  replays its text as a finished reply, kept across resume and `/reload` by the custom entry `rqw-send-now`; thinking and
  unfinished tool calls are dropped. Reason: oh-my-pi keeps the aborted reply; Pi drops it. Since: `d1f8b16`.
- **Limits and proof** `[D-SENDNOW-LIMITS]`. Several queued messages go as one, joined by blank lines; images and custom
  messages in Pi's queue are dropped as with Escape; a steering input swallowed by another extension's `input` handler
  can leave the count stale until the queue empties. Proof: Pi's real `InteractiveMode` on a scripted terminal with a
  faux streaming model, `extensions/RQW-send-now/test/send-now.test.ts`, in `npm test` on macOS and Windows CI.
  Since: `d1f8b16`.

## Providers

- **Own extension** `[D-PROVIDERS-EXT]`. Provider hiding is its own extension, so it does not vanish when the Anthropic
  transport is off; switching either off alone is the [Isolation](#isolation) rule. Owner answer «7a» to the coordinator
  question "Скрытие лишних провайдеров. Сейчас его делает расширение Anthropic. Если его выключить, скрытие пропадёт. a) Вынести скрытие в отдельное расширение": «1a 2a 3a 4a 5a 6b 7a 8a ответы по транспорту» (session `2026-10-21T16-27-59-062Z_01a15f4a`, line 2394). Carrier:
  `extensions/RQW-providers/index.ts`, the last `pi.extensions` entry. Since: `2bf5eac`.
- **Visible providers** `[D-PROVIDERS-ALLOW]`. Only `anthropic` and legacy `openai-codex` are visible in login, pickers,
  `--list-models` and scoped models (`ALLOWED`); Pi 1.4.0's `openai` ("Sign in with ChatGPT", `OPENAI_API_KEY`) stays hidden. Saved credentials stay; previously selected models and explicit SDK lookups are not erased; public `unregisterProvider` is not used because it restores builtins. The policy covers only a runtime with an owning session of this extension, so loading it alone or an unrelated runtime keeps Pi's lists. RQW-anthropic filters nothing; its `registration.ts` and `auth-boundary.ts` carry the conflict guard, credential-store binding and request auth boundary. Owner: «Смотри, в нашем Pi должен быть старый OpenAI кодекс и всё, блядь. Legacy, который через девайс. А новый OpenAI нахуй не нужен, блядь. Я не знаю, что там за глупость новый OpenAI. У нас должен быть вход именно такой же, как сейчас это работает в текущем OpenAI кодексе, и всё, больше никак.» (session `2026-10-21T16-27-59-062Z_01a15f4a`, line 134) Coordinator text (owner quotes C:3171, an omp session, not found in the Pi sessions): "Это именно отключить"; "Когда мы заходим в логин, там должны быть только кодекс, авторизация и авторизация через Anthropic, которую ты сейчас делаешь. И всё". Proof: `extensions/RQW-providers/test/providers.test.ts`. Since: `2bf5eac`.
- **Binding and order** `[D-PROVIDERS-BIND]`. Engineering choices: ownership comes from the patched
  `AgentSession._bindExtensionCore`, because Pi emits no event before `--list-models` and a bindingless `/reload` emits
  no `session_start`; liveness is read from Pi's extension API going stale; the patched `AgentSession.dispose` releases
  the disposed session's instances. Both RQW-providers and RQW-anthropic wrap `_bindExtensionCore` and `dispose`, and
  RQW-anthropic's lifecycle restores Pi's methods when its last owner leaves, so each load re-checks and re-wraps
  (`test/providers-anthropic.test.ts`). Pi's restore is last-in-first-out, so the manifest keeps this extension after
  RQW-anthropic. Limits: `extensions/RQW-providers/README.md`; research: `notes/anthropic-adapter.md`. Since: `2bf5eac`.

## Quality control

The rules for Main and workers are in [PROCESS.md](PROCESS.md#quality-control-loop); the design and its evidence are
in the approved proposal (not stored in this repository). The loop reads only public GitHub state.

- **Scheduled full regression** `[D-QA-SCHEDULE]`. Owner: «надо заебашить CI/CD, чтобы у нас тесты наши, полный regress запускался постоянно, каждые три-четыре часа.» and «Может быть, эти тесты запускаются не четыре часа, а раз в два часа, допустим.» Decision: `tests.yml` runs on `main` every 2 hours (cron `17 */2 * * *`, off the top of the hour because
  GitHub drops queued scheduled jobs at high load), `pcli.yml` daily at 03:43 UTC. Task branches get no scheduled
  reruns and nothing retries automatically: an unchanged head is not rerun
  ([Sufficient proof](PROCESS.md#sufficient-proof-without-idle-reruns)). Reason: `main` itself was never tested;
  repeated runs of the same SHA give a free failure rate and catch drift in floating inputs (`macos-latest`,
  `windows-latest`, Node 24, PortableGit). The repo is public, so standard runners bill nothing; the real cost is
  macOS slot contention. Carrier: `.github/workflows/tests.yml`, `.github/workflows/pcli.yml`.
  Since: `3bdac4f`.
- **Failure inbox** `[D-QA-INBOX]`. Owner: «нужно сделать какую-то систему алертинга, какую-то копилку, куда приходят эти падения, и ты проверяешь падения, их разбираешь потом и дорабатываешь в соответствии со всеми нашими требованиями» and «каждая ветка, каждый commit, каждый push в себе хранит историю именно каждой отдельной задачи, и ты в соответствии с ней сможешь всё это дело залайнить и пофиксить тесты». Decision: one GitHub issue per failure signature, label
  `qa-inbox`, written by `qa-inbox.yml` after every completed `main` run (schedule or dispatch) of `tests`, `pcli`
  and `codex-oracle`; every attempt of a run is read, so a manual rerun cannot hide the first failure. The bot owns the
  body and rewrites it in place, never comments, so updates notify nobody. An issue closes only with a `QA: #N` fix
  on `main` and max(6, ceil(3/p)) green scheduled runs after it; each pass also picks up failed `main` runs of the
  last 48 hours that no issue records, so a dropped pass heals; a signature that stopped without a fix closes only
  with a written explanation by Main. Reason: an issue per signature is the link target for `QA: #N`, dedupes one
  bug on several jobs, and keeps state without a server; closing by silence would hide flakes. Carrier:
  `scripts/qa-inbox.mjs`, `scripts/qa-state.mjs`, `.github/workflows/qa-inbox.yml`.
  Since: `3bdac4f`.
- **Public issues** `[D-QA-PUBLIC]`. Decision (engineering choice, from the proposal): the inbox lives as issues in the public repo.
  Reason: test logs and artifacts are already public, and tests use fake credentials and no network
  (`test/no-network.mjs`), so no secrets are expected in evidence. A private inbox would need a second repository.
  Since: `3bdac4f`.
- **Email digest, failures only** `[D-QA-DIGEST]`. Owner: «И мне пусть приходит на почту оповещение о том, что тесты упали, допустим, раз в сутки или два раза в сутки.» and «они будут запускаться, мне будут приходить отчеты о падениях, именно о падениях, а я буду тебе об этом сообщать сам.» Owner answers «1а 2а 3а (но нужна инструкция) 4а» to the questions
  1a "Адрес `chuark@gmail.com`, пароль приложения Gmail сохраняем в секреты репозитория." and 2a "В 09:30 и 21:30 по
  Москве." Decision: `qa-digest.yml` runs at 09:30 and 21:30 Moscow time (cron `30 6 * * *` and `30 18 * * *` UTC)
  and sends one mail through Gmail SMTP with `curl`, only when something failed in its window: a new or recurring
  inbox issue, a failed `main` run, or a failed `qa-inbox.yml` run. The window starts at the previous successful
  scheduled digest run (at most 48 hours back, 12 hours when there is none), so no failure falls between two mails.
  Nothing failed: no mail. Secrets:
  `QA_SMTP_USER`, `QA_SMTP_PASSWORD` (a Gmail app password), `QA_MAIL_TO`. Missing secrets fail the job loudly on
  every scheduled run. Reason: SMTP from the workflow does not depend on GitHub notification settings; the owner
  relays what he gets. Carrier: `scripts/qa-digest.mjs`, `.github/workflows/qa-digest.yml`. The owner's steps are in
  a separate instruction outside the repository.
  Since: `3bdac4f`.
- **GitHub's own Actions emails** `[D-QA-NOTIFICATIONS]`. Owner: «1а 2а 3а (но нужна инструкция) 4а», where 3a is "Ты переключаешь уведомления
  Actions на "только в GitHub", остаётся только наша сводка." Decision: the owner switches Settings, Notifications,
  Actions to "On GitHub" only. Reason: GitHub mails every completed scheduled run to the user who created the
  workflow, with no digest, up to 12 mails a day at a 2-hour cadence; the setting also covers his branch runs.
  Carrier: the owner's account setting, not a file; nothing in the repository can check it.
  Since: `3bdac4f`.
- **Red main does not block merges** `[D-QA-MERGE]`. Coordinator option 4a, accepted by the owner: "Слияния не блокируются, проверка перед слиянием только
  показывает открытые падения." Decision: `deliver-check` lists open `qa-inbox` issues and never fails on them;
  it does fail when a `QA: #N` line names an issue that is not in the inbox. Reason: a flaky or drifting `main` must
  not freeze unrelated work, while Main still sees what is open. Carrier: `scripts/deliver-check.mjs`.
  Since: `3bdac4f`.
- **Awareness without a permanent process** `[D-QA-STATUS]`. Owner: «И ты периодически проверял в процессе работы, не типа отдельно воркером проверял, а чтобы ты проверял в рамках работы над задачей. Новую задачу ставишь, и чтобы автоматически тебе приходило состояние, когда ты работаешь с бранчой, о том, что нужно проверить запуски CI/CD.» and «И ты сам тоже можешь проверять, если ты в процессе работы находишься, если ты сейчас онлайн. Это не должен быть постоянный, перманентно висящий процесс». Decision: no daemon,
  timer or local cron. `scripts/qa-status.mjs` makes one bounded `gh` round (`npm run qa-status`, for workers); the
  dev-only, repo-local `.pi/extensions/qa-status/` shows a message on session start and on a changed red state, and
  `/qa` shows the full view. Main reads the status at task start, tells the owner in one line about a red scheduled
  `main` and triages it. Reason: the extension is useless outside this repository and must not ship in the
  package, so it is not an `RQW-*` extension and is not in `pi.extensions`; a failed `gh` call is reported as
  unavailable, never as green. Carrier: `.pi/extensions/qa-status/index.ts`, `scripts/qa-status.mjs`,
  [PROCESS.md](PROCESS.md#quality-control-loop).
  Since: `3bdac4f`.
- **Test integrity** `[D-QA-TEST-INTEGRITY]`. Owner: «нужно именно обеспечивать качество, а не фальсифицировать работу, чтобы тесты были зелёные. Это супер критически важно, потому что эти тесты и вся наша работа — это всё обеспечение контроля качества.» and «Можно даже ревьюера поднимать, который перепроверяет тесты.» Decision: before any fix Main records a triage
  class (product bug, test bug, infra, drift) with evidence; a fixed list of weakening changes is forbidden without
  proof; a fix needs red-before/green-after in CI logs, and an intermittent one repeat runs with (1-p)^n < 0.05 (generic repeat harness `codemode-stress.yml`).
  A reviewer subagent with `.agents/reviewers/test-integrity.md` as its whole `system` checks every QA fix and every
  test or workflow change that weakens a check; `deliver-check` detects that case and requires the trailers
  `Test-change:` and `Test-review: agent#N CLEAN` (exact conditions: [PROCESS.md](PROCESS.md#quality-control-loop)). Reason: the aim is a working
  product, not a green badge; a weakened assertion turns a real failure into silence. Carrier: `PROCESS.md`,
  `.agents/reviewers/test-integrity.md`, `scripts/deliver-check.mjs`.
  Since: `3bdac4f`.
- **codex-oracle.yml schedule is deferred** `[D-QA-CODEX-SCHEDULE]`. Accepted earlier: daily once on `main`. Its file exists only on the
  `rqw-codex` branch, so no schedule hook is added now; `qa-state.mjs` and `qa-inbox.yml` already accept the workflow
  name `codex-oracle`. Deferred work: the `rqw-codex` task adds `schedule` (daily) when it lands on `main`.
  Since: `3bdac4f`.
