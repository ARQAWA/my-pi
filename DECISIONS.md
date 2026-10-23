# my-pi: decisions

Every accepted decision, with its reason and the file that carries it.

Provenance: owner/user quotations are the owner's words; request summaries are not literal quotations.
Engineering decisions and coordinator implementation briefs record the agents' choices, not direct owner approval
of each detail. They do not narrow the owner's requirements. `C:<line>` refers to the raw conversation
`2026-10-20T13-55-12-982Z_01a15998-41d6-76f4-be02-a0e599d0c214.jsonl`, physical JSONL line.
The source remains outside this repository; no transcript or credentials are copied here.

## Work policy

Current accepted development policy (request summaries unless quoted); detailed task rituals belong in
[PROCESS.md](PROCESS.md), not a history ledger here.

- Main is the coordinator, not an independent implementer: «Да, он как техлид/тимлид, координатор, но не исполнитель самостоятельный.»
  Reason: keep orchestration and acceptance with Main and actual execution with worker subagents. The procedure
  is carried by [PROCESS.md](PROCESS.md).
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
- **Development parallel limit** `[D-WORK-PARALLEL]`. At most 10 first-level subagents (started by the
  coordinator) run in parallel; nested subagents do not count; a ceiling, not a quota. The owner's words are in
  `DECISIONS-ARCHIVE.md`, A-0003 (message of 2026-10-23, session line 2462). Reason: owner decision. Carried by
  [PROCESS.md, Isolated parallel execution](PROCESS.md#isolated-parallel-execution) and `AGENTS.md`.
- Owner: «Смотри, надо скорректировать так, чтобы ты как координатор поровну поднимал модели из Anthropic и GPT, чтобы не было перевеса в другим, дисбаланса. Поднимай саб-агенты и те, и те, чтобы лимит расходовался равномерно. И зафиксирую это в процесс.nd файле, эту информацию на будущее»
  Reason: even use of both subscriptions' limits. Carried by [PROCESS.md, Worker models](PROCESS.md#worker-models).
- The old paused Claude benchmark/tuning campaigns remain paused until explicitly resumed; saved results stay.
  That campaign pause does not forbid Claude workers, independent review or other authorized Claude+GPT work.
- The owner accepted a `PROCESS.md` link in `AGENTS.md` with mandatory lazy reading at every task and context
  restoration. Procedural rules belong in `PROCESS.md`. `WORKFLOW-MANIFEST.md` is the owner's personal lifelong
  record and aspiration, not workflow commands, a gate or an overriding procedure: «Манифест того, как я делаю
  свою личную работу.»
- Research in parallel first, then ask about all real ambiguity. The owner's answers start autonomous execution;
  do not invent agreement or decide for the customer: «Если чего-то согласовано не было, додумывать это нельзя
  ни в коем случае никогда.»; «Я сам лично не принимаю решения за заказчика, потому что я не имею на это permission.»
- Work on a task's own branch and worktree at `../my-pi-worktrees/<task>`. Stage exact paths and make task-branch
  commits without an extra gate; finish with a squash into `main` and branch/worktree cleanup. History belongs
  in Git (owner: «История хранится в гиде.»), not a duplicate documentation ledger. See `PROCESS.md` for delivery details.
- Owner: «И почему у тебя основной поток заблокирован, блядь? Почему у тебя основной поток исполнения заблокирован какой-то хуйнёй? Заблокирован какими-то запусками, тестами или что это такое, блядь, где ты по 20 секунд GitHub Review Run делаешь. Это что такое, нахуй? Ты не должен блокировать основной поток исполнения какой-то работой блокирующей. Ты всё делаешь через саб-агентов. Саб-агентов можешь поднимать до 40 штук параллельно.»
  Reason: Main must stay free to coordinate and talk to the owner. It never blocks its own thread on waits,
  polling, CI watching, test runs or other long work; subagents do it. The parallel limit is now up to 10
  first-level subagents (nested ones do not count), not as an artificial quota; see the worker models entry above. Carried by
  [PROCESS.md, Isolated parallel execution](PROCESS.md#isolated-parallel-execution).
  Later owner update of the limit, to be known to the agent at the prompt level: «Зафиксируй, пожалуйста, до 50 саб-агентов на уровне промта, на уровне Process MD, на уровне знания агента об этом, чтобы потом в будущем я это не напоминал опять и опять.»
  The limit is stated in `PROCESS.md` and, as a short line, in `AGENTS.md` (project instructions loaded into every
  agent session of this repo); the product prompt `extensions/RQW-prompt/SYSTEM.md` is unchanged.
- Preserve the user's changes and secrets; do not fix unrelated failures. Temporary files belong in OS temporary
  storage. No forks.
- Owner: «Сделай так, чтобы у тебя были логи числа прогонов на Mac. Это что за хуйня? Такого не должно быть. Ты запускаешь тесты или что? Ты не можешь проверить это? Это что за хуйня? Почему так, блядь? Если ты делаешь какие-то тесты, пробы, нагрузки тяжёлые, именно процессорные, то их лучше прогонять в CI/CD, чтобы наш MacBook Air не охуевал. Не лучше, а надо их прогонять в CI/CD.»
  Clarification: «Нет нихуя не надо это была корректировка именно процесса на будущеее и того что что бы у тебя сохранялись логи».
  Reason: keep CPU-heavy verification off the owner's MacBook Air and preserve auditable logs for reported
  numbers. This is a future work policy, not a request for a measurement campaign. Carriers:
  [PROCESS.md, Sufficient proof](PROCESS.md#sufficient-proof-without-idle-reruns) (execution and saved logs),
  [PROCESS.md, Delivery](PROCESS.md#delivery) and `.github/workflows/tests.yml` (Mac CI proof).
- Run relevant checks once and reuse evidence while inputs are unchanged; execution location and saved evidence
  follow [PROCESS.md](PROCESS.md#sufficient-proof-without-idle-reruns). No Linux requirement. Docs-only work needs
  no tests. A different task-branch commit versus the final squash alone is not a reason to rerun. Windows Node
  tooling runs through Git Bash, not PowerShell/cmd runtime; existing CI `pwsh` bootstrap is allowed infrastructure.
- Finish with an independent completeness-and-consistency check. For code changes, run a separate bug/quality
  reviewer in parallel via the existing agent custom system `.agents/reviewers/code.md`. This requires no new
  extension or product tool changes. Update installed Pi only for relevant runtime changes, never for docs-only work.
- Deterministic delivery quality. Owner: «Теперь смотри насчет выполнения задач и пробелов, которые ты нашел. Я же не буду всегда тебя переспрашивать. Если бы я не спросил, ты бы об этом не узнал. Надо поэтому сделать какой-то процесс, как детерминированно эту проблему решить на постоянке, чтобы мне не надо было тебя постоянно переспрашивать, чтобы ты сам следил за качеством. Надо твое предложение по тому, как мы этот пробел будем закрывать.»
  Approved proposal, the owner approving it with «Правила по Process MD я одобряю»: «1. Тестируется ровно то, что вливается. Если main изменился с момента создания ветки, исполнитель переносит ветку на свежий main. Тесты на Mac и Windows CI проходят на этом итоговом коммите.
  2. Ревью действует только для того коммита, который оно проверило. Любой коммит после CLEAN снова отправляет изменённые места на проверку: и задачу, и код.
  3. Перед каждым слиянием я запускаю скрипт npm run deliver-check <ветка>. Он проверяет три вещи. Ветка содержит текущий main. Windows CI прошёл именно на этом коммите. В описании коммита записаны номера ревью с CLEAN и список того, что не проверено вживую. Если чего-то нет, слияния нет.
  4. В каждом отчёте о готовой задаче я сам даю таблицу доказательств и честный раздел «не проверено вживую», без твоего запроса.»
  Reason: branches tested alone were squashed onto a moved `main`, so the combined tree went untested until a manual
  dispatch, and a code-review CLEAN covered an earlier commit while two later fixes landed unreviewed. Carriers:
  [PROCESS.md](PROCESS.md) (Sufficient proof, Independent review, Delivery) and `scripts/deliver-check.mjs`,
  proven by `test/deliver-check.test.ts`. Implementation choices: the script takes the planned squash message file
  as a second argument, also requires a clean main checkout and a green `pcli.yml` run when PCLI paths change, reads
  the path filters from the workflow files of `main` and of the branch head (a file counts if either version
  requires CI; a missing workflow file or filter in either is a failure), fails outside a checkout with `main`
  checked out, and accepts only the latest run on the head SHA. Coordinator
  interpretation of rule 2, derived from «Любой коммит после CLEAN снова отправляет изменённые места на проверку»:
  a conflict-free rebase onto `main` changes no task places, so it needs new tests and CI on the new head (rule 1)
  but no new review; places changed while resolving conflicts are changed places and go back to review.
- Temporary result-review route. Coordinator question: «Слияния, пока ревьюер выключен ... a) Маленькой правкой научить проверку перед слиянием принимать ревью субагентом с текстом ревьюера, с честной отметкой agent#N. В процессе записать, что так делаем, пока ревьюер выключен.» Owner: «1а», then «только с текстом нового ревьюера».
  Reason: the owner disabled RQW-review while the new reviewer is tuned («Сейчас ревьюеров надо отключить, пока мы их не дотюнили»).
  The temporary route and completeness check are defined in [PROCESS.md](PROCESS.md#independent-review);
  carriers: `PROCESS.md`, `scripts/deliver-check.mjs`, `test/deliver-check.test.ts`. The gate accepts either honest
  result-review trailer and keeps all other checks.
- Completeness check after every merge. Original concern, owner: «А у тебя есть встроенный процесс, который перепроверяет, что нигде ничего не забыто? ... должна быть независимая перепроверка, что каждый влитый pull request действительно соответствует истине, что там всё заебись.»
  Approved proposal (coordinator's text): «a) После каждого слияния и перед итоговым отчётом свежий независимый ревьюер получает все твои сообщения из сессии и историю main. По каждой просьбе он отмечает: сделано и каким коммитом, в работе или ты её отменил. Если у просьбы нет ни одной отметки, это находка. Правило записываю в PROCESS.md.»
  Owner: «Да, один по проверке, что ничего не забыто».
  Reason: a request can be dropped silently between sessions, merges and reports, and only the owner's repeated
  question found it. Carried by [PROCESS.md, Delivery](PROCESS.md#delivery) step 5. Implementation choice: the
  reviewer is the existing `review` tool; its object is `main`'s git log since the session start plus in-progress
  branches/worktrees and owner-cancelled items.
- Pilot batch and output reading for measurements. Owner: «Так блять надо фиксить ты шо гонишь мы нахуй прогоны эти делаем . Мы прогоны делаем не ради прогонов. Мы прогоны делаем для того, чтобы найти косяки, найти хуйню, её пофиксить и делать пиздато всё. ... Давай сейчас все прогоны останови, и мы обсудим дальнейшие шаги. Надо сейчас это все порефиксировать», then «1а» to the plan whose step 5 is this process rule (small batch first, an agent reads it for anomalies, stop at the first systemic defect). Later: «Смотри, я хочу, чтобы ты в процессе измерений прогонов сразу находил аномалии, сразу находил отклонения и сразу же останавливал прогоны и чинил. Если будут очевидные косяки жёсткие, надо их сразу чинить в моменте . Нет смысла ждать полных прогонов, если мы потом починим и будем заново перепрогонять. Ты на первых запусках, если видишь какую-то хуйню очевидную, надо её фиксить . И первые запуски делай на самых сильных моделях из того перечня, который у тебя есть, чтобы сразу получить отклонение на старте у сильных моделей». And: «Мы не учитываем, что слабые модели в принципе не смогут какие-то вещи делать. Нам главное откалибровать на сильных моделях, а потом посмотрим, как они будут себя вести на слабых».
  Reason: the reviewer-v2 benchmark burned a night on a quote-checker defect that was visible in its first outputs.
  Rule: every measurement or benchmark with model calls runs in waves, never the whole matrix at once, the first
  launches on the strongest models of the measured list; outputs are checked continuously during the run (an
  automatic anomaly watcher after every run plus an agent reading the actual outputs), and at the first obvious defect
  the run stops at once and the defect is fixed before anything else runs.
  Calibration happens on the strongest models; weaker ones are measured afterwards on the calibrated version and their
  failures are recorded as capability limits, not defects, unless they show a mechanics or checker bug.
  Carried by [PROCESS.md, Measurements and benchmarks](PROCESS.md#measurements-and-benchmarks).
- Coordinator delegates even "do it yourself". Owner: «Когда я говорю, что ты должен что-то сделать буквально, это значит, что ты должен поднять саб-агента, который это сделает. Не забывай свою роль и запиши это, зафиксируй, чтобы больше так не наёбываться.» Owner, next: «Я всегда с тобой разговариваю так, как будто ты и есть мой исполнитель. Потому что для меня ты исполнитель, но ты сам работаешь в рамках роли, которая тебе назначена. И ты должен это помнить, и ты должен этому следовать всегда. Ты не должен никогда от этого отклоняться. Понял? Это супер важно.»
  Reason: asked to arbitrate judge disputes himself, the coordinator started reading run files in its own thread. The owner
  addresses Main as the executor; Main acts within its assigned role and executes through subagents, without exception.
  Carried by [PROCESS.md, Isolated parallel execution](PROCESS.md#isolated-parallel-execution) (the owner-executor bullet).
- Third arbiter for judge disputes. Owner: «Так, блядь, ты сам эти споры рассуди. Ты же, блядь, выше них. Ты сам спор можешь рассудить, у тебя есть все исходные материалы, ты знаешь, как именно должно всё это работать, и ты должен быть третьим независимым мнением от этих двух судей».
  Reason: a disputed judge label needs an independent decision from the sources. Carried by [PROCESS.md, Measurements and benchmarks](PROCESS.md#measurements-and-benchmarks), rule 7.
- Measurement runs have no caps; the measurer supervises instead. Owner: «Нахуй ты вообще лимиты какие то ставишь? я разве говорил ставить? ты наблюдаешь за запусками следишь как себя агенты ведут и сам их прерываешь, но ты их не полишь, а опрашиваешь прграмно раз допустим в 1-3-5 минут. ну я имею ввиду не лично ты а тот кто делает замеры»
  Reason: a pilot was stopped on a self-imposed 375-request cap after harness pauses consumed it; caps are not stop
  conditions. Carried by [PROCESS.md, Measurements and benchmarks](PROCESS.md#measurements-and-benchmarks), rule 6.
- Keep replies short unless expansion is needed: «Он отвечает не больше трех абзацев по максимум две строки
  в абзаце. Если это не требует расширения, конечно».
- CI evidence for a test file that dies. Coordinator decision (technical), no owner quote: the `npm test` steps keep
  Node's default log output and also write a TAP copy, uploaded on failure with the job's macOS crash reports; a
  manual stress workflow repeats the 12 MB codemode tests with exit code and peak RSS per run.
  Reason: `codemode.test.ts` died silently once on macOS Node 24 (run 39948373095); on Node 24 the spec reporter
  shows such a file only as 'test failed', so the root cause was not recoverable without its exit code or signal,
  which the TAP copy carries. Carriers:
  `scripts/ci-npm-test.sh` (Node's default log reporter plus a TAP copy), `.github/workflows/tests.yml` (artifact
  `test-evidence-*`, also with `/Library/Logs/DiagnosticReports` for JetsamEvent memory kills) and
  `.github/workflows/codemode-stress.yml` (input `runs`, `summary.tsv` with exit code and peak RSS per run).
  Implementation choice: GitHub dispatches only workflows present on the default branch, so the stress workflow also
  runs on a push to the branch `codemode-stress` (30 runs), like `pcli.yml` with `pcli`.

## Scope

- Pi 1.4.0 is the one supported and tested version (user: «Надо понять, сможем ли мы сейчас апгрейдить весь наш пакет на
  1.4 версию Pi.»; «1а»; «Можно начинать уже и можно продолжать всю работу, которая была до этого начата»). Reason: the
  1.4.0 research found only intentional version gates and stale summary-output assertions in the way, no reason to wait
  for another release or to fork. The gates of `RQW-settings` (`selection.ts`, `cache-warming.ts`), `RQW-tools`
  (`selection.ts`) and `RQW-anthropic` (`index.ts`, `retry.ts`) accept exactly 1.4.0: 1.3.0 is no longer supported and
  the range is not widened to future versions; the shared tool-selection symbol keeps one namespace in both copies of
  `selection.ts`. `package.json` pins the development dependency to 1.4.0 and its peer range to the tested 1.4.0. PCLI
  bundles the official 1.4.0 binary, [PCLI](#pcli). Carried by those files, `package.json`, `package-lock.json`.
- my-pi is an extension layer around stock Pi 1.4.0, not a fork (user: «Мы делаем просто обвес вокруг оригинального Pi.»;
  «Нет, никаких форков.»). Reason: keep Pi's own behavior and add only the agreed extensions. Carried by
  `package.json` and `extensions/`. Only `RQW-models`, `RQW-statusbar` and `RQW-send-now` ported UI, as described in
  [Models](#models), [Statusbar](#statusbar) and [Send now](#send-now); `RQW-scroll` adds one owner-requested key
  behavior, [Scroll](#scroll); other omp-lite UI and tools are not
  carried over (user: «Давай полностью отбросим все UI припоны и оставим только чистую механику и промпты»,
  «Так же мы можем отбросить тулинг»).
- Reason: bench41 (`~/Documents/ChatGPT/my-omp-harness/bench/bench41.csv`, T01-T07, 3 runs): the omp-lite prompt alone
  raised stock Pi by 10.2 quality points on gpt-6-sol low, 6.2 on gpt-6-sol medium and 1.9 on gpt-6.1-sol medium;
  omp-lite beat that only on low (+3.5) and was lower and slower on both medium configs.
- Public repository [ARQAWA/my-pi](https://github.com/ARQAWA/my-pi) (user: «он должен быть паблик»).
- Dropped for good: loading of `eval`, `lsp`, `ast_grep` (user: «eval нахуй не нужен, lsp ... ast-grep ... выбросить
  всё это на помойку»; Pi has its own codemode).
- Postponed, not dropped (user: «мы их не упраздняем, а откладываем»): `codebase_explorer`, `custom`; the
  `define-goal` skill and work orders; and the task list with the check before stopping (later switched on by a skill
  rather than always on). The extension-provided `agent`, `review`, `code_writer` and `shell_runner` tools are
  implemented separately; see [Agent](#agent), [Review](#review) and [Workers](#workers) below. `RQW-models`,
  `RQW-statusbar` and `RQW-send-now` also port UI; see [Models](#models), [Statusbar](#statusbar) and [Send now](#send-now).
- Development worker authorization and the old paused benchmark campaigns are governed by [Work policy](#work-policy),
  independently of the product reviewer pins below.
- Reviewers, accepted plan (user: «То, что ты предложил по ревьюерам — it's OK, я принимаю»): own extension
  `RQW-review` on `createAgentSession`, no ready package (pi-subagents: ~98k lines, ~1.3k tokens per request, fails
  strict schemas). One tool `review` with `level` `blind` or `high`; a fresh session per pass with `read`, `bash`,
  `grep`, `find` and the shared deep prompt; no main prompt, user extensions, skills or AGENTS.md in the reviewer;
  `blind` on Haiku 5.5 medium, `high` on Sonnet 5.5 for a Claude main agent (a GPT main agent has its own pair, and
  the other family takes over without credentials: see [Review](#review)); the extension copies the user's messages
  verbatim into the brief; the verdict arrives later as a message. The reviewers keep this contract (user:
  «Ревьюеры будут только на этих двух моделях», replaced by the family table in [Review](#review)).
  When each runs is decided by measurement (user: «Реши сам, найди самое лучшее решение»); quality is measured on a
  rebuilt known-answer set and the prompt is tuned on it (user: «найди сам самый лучший способ замерить, и после
  этого можешь подтюнить его промптом»).
- A separate task: a general subagent for the main agent, like the subagents this work uses (user: «Любого рандомного
  саб-агента ... Чтобы он мог ему ставить задачу, прерывать, выключать, перезапускать. Он мог ему посылать
  сообщение follow-up»). It starts with no system prompt of its own: the main agent gives the whole prompt, the model
  and the reasoning level (user: «должен подниматься без системного промпта, чтобы основной агент передавал ему весь
  системный промпт»).
- Autonomous execution, task-branch commits, final squash delivery and relevant verification follow
  [Work policy](#work-policy) and `PROCESS.md`; tests and model runs are not unconditional gates.
- `WORKFLOW-MANIFEST.md` records the owner's personal working principles and lifelong aspiration, not package
  behavior or procedural commands. The accepted manifesto content does not override the process; see [Work policy](#work-policy).
- Providers: `/login` and the model list show only two providers, openai-codex and our own Anthropic subscription
  adapter `RQW-anthropic` (Claude Code login, as in omp, with self-healing); every other provider is hidden by the
  separate extension `RQW-providers` ([Providers](#providers)) (user:
  «Это именно отключить. Когда мы заходим в логин, там должны быть только кодекс, авторизация и авторизация через
  Anthropic, которую ты сейчас делаешь. И всё»).

- Lean engineering scope (user: «Не надо делать микроправки всяких хуёвин, которые возможно никогда не всплывут, и у них редкость возникновения очень высокая, вероятность, что они возникнут, крайне мала. Надо править именно очевидные жирные ошибки, а не вылизывать до предела.»).
  Reason: fix obvious major failures, not speculative rare cases. The completed native physical routing and
  filesystem identity fixes are retained together, as the owner clarified: «ты всю уже выполненную работу собираешь
  вместе. Просто ты дополнительной работы не делаешь и всё.» Current carriers: `extensions/RQW-context/index.ts`,
  `extensions/RQW-tools/`, and `notes/context-questions.md`. Native identities, hardlink equality, dangling targets
  and private namespace probes are implemented; this does not promise every rare filesystem or long-path case.

## Structure

- Everything is an extension, one folder per extension under `extensions/`, listed in `package.json` under
  `pi.extensions`: first `settings`, second `prompt` (user: «в этом репозитории мы всё будем делать extension... Первый
  extension — это будут настройки, второй — промты, настройки промта»).
- Every extension folder carries the prefix `RQW-`: `RQW-settings`, `RQW-prompt` (user: «у всех наших extension был
  префикс типа RQW- и название»).
- Tools work: requirements compiled in `notes/tools-requirements.md`. Tool and parameter names stay exactly as in Pi;
  no `apply_patch`, one edit format for every model (user: «имена такие же, как в P... никакой хуйни не надо
  навяливать из ОМП лайта»; «Нет, не надо для GPT patch делать. Пусть работает одинаково везде»).
- `INSTALL.md` is the install prompt: the user runs it inside an already installed Pi, and that Pi installs this
  package into itself with `pi install`; after install it requests `/reload` or restart, and after `pi update` it
  requires a restart so process-wide patches use updated code (user: «чтобы можно было его везде воссоздавать,
  воссобирать с нуля, просто промтом одним через install prompt»; «install.md — это про установку именно наших обвесов
  на уже установленный Pi. Я внутри Pi запускаю этот промпт»). See `INSTALL.md`, step 4.
- The start was empty: both extensions were no-ops. The prompt is built first, everything else after it (user: «Старт
  должен быть пустой... сначала надо сделать промпт пиздатый, а потом всё остальное будем делать»).

## Tools

- Engineering follow-up under the owner's flaky-test precedent: «Теперь по нестабильному тесту 1А»;
  1a: «Отдельной задачей разобрать, почему тест кодмода на Windows иногда не укладывается в 5 секунд, и исправить причину.»
  Fixed and randomized barrier batches check maximal concurrency with held operations and an independent conflict
  oracle: after promise reactions drain, exactly the calls without unfinished earlier conflicts must have started.
  Seeded gate rejections check prompt release after failure as well as success; mutation checks reject both ignored
  dependencies and needless serialization. Real-timer batches and nested scripts retain ordering, abort, rejection
  and deadlock checks; no test asserts an elapsed slack cutoff. Reason: elapsed start latency includes
  host descheduling and garbage collection, which a percentile cutoff cannot distinguish from false dependencies.
  No runtime barrier change is needed. Carrier: `extensions/RQW-tools/test/barrier.test.ts`; test design:
  [notes/analysis-races.md, Test plan](notes/analysis-races.md#7-test-plan-synthetic-no-model-node---test-under-extensionsrqw-toolstest).

- Engineering follow-up under the owner's flaky-test precedent: «Теперь по нестабильному тесту 1А»;
  1a: «Отдельной задачей разобрать, почему тест кодмода на Windows иногда не укладывается в 5 секунд, и исправить причину.»
  The stock-versus-wrapper shell-path test compares every result field except `structuredContent.wall_time_seconds`,
  whose independent process timings need not match; both timings must still be nonnegative numbers.
  Reason: a rounded elapsed time is not shell-path behavior. Carrier: `extensions/RQW-tools/test/behavior.test.ts`.

- `extensions/RQW-tools/` replaces `read`, `bash`, `edit`, `write` and turns on `grep` and `find` by registering them.
  Each tool spreads the stock definition and keeps its `execute`; only descriptions and the multi-file wrappers change,
  and edit drops strict sampling (next entry). Design and reasons: `notes/tools-design.md`; evidence:
  `notes/analysis-*.md`.
- edit is sent without strict tool sampling: our edit sets `constrainedSampling` to undefined, so Pi does not send it
  as an Anthropic `strict` tool (constrained decoding); read, bash and write keep the stock `strict: "prefer"`. Owner:
  «01a15f4f-7b7e-70e6-b1e2-bb238ce75359 Также в этой сессии поработал агент, и там дохуя ошибок записи. Он делает
  параллельные эдиты: проредактировал и потом снова делает через время параллельные эдиты. И там целая вереница
  эдитов красная, с ошибками. Он потом перепосчитал файлы и снова отредактировал. Надо разобраться, этот баг
  пофиксить.» Reason: in that session (claude-opus-5-5) all 15 failed edit calls carried garbled arguments, not
  stale text: a replay of the files from Git plus every successful edit matched each successful oldText exactly once.
  Each failed oldText broke where Cyrillic text began (literal `\u0430`-style escapes, a lone `"` or `\b`, an added
  newline, newText `x`). All were single calls; both parallel batches succeeded, so neither the barrier nor
  multi-file grouping was involved. Pi 1.4.0 marks stock edit `strict: "prefer"` and Opus 5.5 `supportsStrictTools`.
  Probe replaying the session before four failing turns, 4 runs each: edit as sent (strict) 0 of 12 Cyrillic edit
  calls usable; the stock-shaped edit schema with strict garbled 5 of 9 calls; edit without strict matched 40 of 41
  blocks (the miss: a space for a line break). gpt-6.1-sol matched all 27 blocks with and without strict. A strict
  write of a 14 000-character file with 5 500 Cyrillic letters came through intact 4 of 4, so write keeps strict.
  Carried by `extensions/RQW-tools/index.ts`; test in `extensions/RQW-tools/test/tools.test.ts` (the Anthropic
  request has no `strict` on edit and keeps it on write).
- Ordered conflict barrier: a call waits only for earlier calls of the same response it conflicts with; bash conflicts
  with every call, read never with read, otherwise equal path key or ancestor. Reason: stock Pi measured 20 of 20 races
  for read/write, bash/read and case-variant writes (`notes/analysis-races.md` section 2). bash is serialized against
  bash because its footprint is unknown.
- Owner: «Отдельной задачей разобрать, почему тест кодмода на Windows иногда не укладывается в 5 секунд, и исправить причину».
  Reason: the 500 KB codemode ordering test spent its watchdog budget streaming about 31,000 tiny faux-provider
  deltas before tools could execute, not waiting in the barrier. Its faux provider now uses fixed larger chunks;
  a deterministic delta-count assertion prevents that overhead returning. The 5 s deadlock watchdog, payload,
  ten repetitions and ordering assertions stay unchanged; no runtime barrier or codemode change is needed.
  Carrier: `extensions/RQW-tools/test/codemode.test.ts`; analysis and proof:
  [notes/settings-codemode.md, Test watchdog](notes/settings-codemode.md#test-watchdog).
- In-place writes stay; on Windows `EBUSY`/`EPERM`/`EACCES` are retried for about 1.5 s. Temp file plus rename was
  rejected: rename fails on Windows when another process holds the file.
- Limits: grep and find get no match cap by default (`limit` 100000 when unset); the stock 50KB output cap stays. Reason:
  Pi's default 100 grep matches cuts the broad first search wave; omp-lite's 51 200-character budget equals 50KB for
  ASCII. read and bash keep the stock 2000 lines / 50KB, as measured in bench41.
- The search wave method lives in the grep description; RQW-tools supplies the one-line `<search_method>` section
  through its own `before_agent_start` hook when read, grep and find are declared.
- read, bash, edit and write are registered with `defaultActive: false`: they replace the built-ins of the same name, so
  Pi's defaults and the user's `--tools` / `defaultTools` still decide which are on. grep and find are activated by
  registration; on resume or fork they are re-added unless the user passed `--tools`, `--exclude-tools` or `--no-tools`.
  Reason: the code review showed that activating on registration overrode an explicit `--tools -edit`.
- read and bash are built with the user's settings (`shellPath`, `shellCommandPrefix`, `images.autoResize`), as stock
  Pi builds them. Reason: without `shellPath` a Windows setup with Git outside Program Files finds no bash.
- `createTools(cwd, settings)` in `index.ts` builds the six definitions with one barrier of their own; the factory
  registers one set for the session and answers a request on `pi.events` channel `rqw-tools:subagent-tools` with
  `createTools` itself (section Agent). Nothing in RQW-tools depends on RQW-agent. A test in
  `extensions/RQW-tools/test/tools.test.ts`
  checks the answer and that each call gives fresh definitions.
- The read key mirrors stock `resolveReadPath` (NFD, curly quote and AM/PM variants), so a read and a write of the same
  file spelled differently still meet in the barrier.
- The `ls` and other stock tools beyond the six are not wrapped and stay outside the barrier; they are off by default.
- The descriptions do not explain the barrier order (bash waits for earlier calls, a read waits for an earlier write).
  Reason, measured on gpt-6.1-sol medium, T01: with those lines the model made one call per response in 8 of 8 runs
  (14-18 responses); without them it batched in 9 of 9 runs (3-5 responses). The barrier works without the model
  knowing it.
- bench42 (commit `0a2028e`, T01-T07, 3 runs, same completion judge and checklists as bench41; rows in
  `notes/bench42.csv`). Pi with the bench41 prompt vs my-pi:

  | Config | Pi + prompt | my-pi |
  |---|---|---|
  | gpt-6-sol medium | 47.4 s / q91.9 | 47.0 s / q89.0 |
  | gpt-6.1-sol medium | 64.6 s / q99.0 | 67.2 s / q92.5 |
  | gpt-6-sol low | 28.4 s / q90.5 | 27.4 s / q89.6 |

  Speed is the same. The quality gap comes from T01 (80/93/80 vs 67/80/67: the answer misses the Python twin) and one
  gpt-6.1-sol run of T02 that wrote its answer to `TRADING_LOGIC.md` (q18, 256 s); without that run gpt-6.1-sol medium
  is 57.8 s / q96.2. Open: tune the grep description against T01.
- bench42 regraded with 5 judge votes per answer, majority per point: 92.9 / 91.0, 96.2 / 91.6, 90.5 / 89.0
  (Pi + prompt / my-pi). The 90% bootstrap interval of the difference includes zero on every config. The T01 gap was
  judge noise on one point; both stands miss the Python usage point equally. Judging from now on: 5 votes, majority.
- The `TRADING_LOGIC.md` run: the model's reasoning shows it hit the answer length limit of the prompt and moved the
  answer into a file, which the prompt allowed ("the file is the answer"). `SYSTEM.md` now says to answer a question
  about the code in the chat and to create or change files only when the task asks for it.
- edit and write descriptions refined by probes (`notes/refine/refine-editwrite.md`; EDIT, WRITE and a multi-block task,
  gpt-6.1-sol medium and gpt-6-sol low, 3 runs per cell): the multi-file form comes first and a rename gets one edit per
  occurrence with enough of its line. Failed edit calls 5 -> 0, multi-file edit calls 12 of 23 -> 15 of 16, all runs
  correct in both texts. A variant that told the model bash sees the changed files again made gpt-6.1-sol issue one
  call per response and was rejected.
- read description refined by probes (`notes/refine/refine-readbash.md`; T02, T05, EDIT, WRITE, two models, 96 runs):
  read a needed file whole in one call and read every file needed next in one response. Correctness 99.6 -> 100,
  whole-file reads 79% -> 84%, responses equal; the speed change is within noise. bash stays as it was: no run searched
  or read through bash, and a line asking to run tests in the same response as the edit split responses on gpt-6.1-sol.
- grep and find descriptions refined by probes (`notes/refine/refine-search.md`; T01, T03, T06, two models, 72 runs):
  the wave names the spellings to try, reads every file the hits already justify in one response, and the stop rule
  asks for where each value is set, used and what the code does with it, for every implementation. find shows brace
  alternatives. Checklist coverage 94.1% -> 95.0%, within noise; chosen by the rule completeness, then responses.
- Second description review (`notes/review-descriptions-2.md`, 8 findings) fixed as wording only: grep respects
  .gitignore inside a git repository only, a grep glob with "/" matches from path, find also returns directories, the
  edit hint may be absent, a cut grep line is read around instead of narrowing, a tool result that names cat or sed
  overrides the ban, a long file written in parts is the one exception to one edit call per file. bench43 measured the
  texts before these fixes.
- bench43 (commit `9e13b55`, T01-T07, 5 runs, judge 5 votes with majority per point). Pi + prompt / my-pi:
  gpt-6-sol medium 38.2 s q90.8 / 37.6 s q90.8; gpt-6.1-sol medium 51.4 s q96.8 / 52.1 s q96.8; gpt-6-sol low
  26.4 s q89.6 / 24.2 s q91.4. 90% intervals of my-pi minus Pi + prompt: quality [-1.7, 2.3], [-2.2, 2.2],
  [-0.5, 4.1]; seconds [-1.9, 0.8], [-1.2, 2.6], [-3.4, -1.1]. my-pi is equal on medium and faster on low; no file
  written in any run. Both stands miss the same points: T01 Python usage, T06 auth blocker delay, T03 Python NG copy.
- Prompt line for implementations that do not run: say where the value is set, where it is used and what that code
  does. Probes T01, T03, T06, two models, 3 runs, judge 5 votes: gpt-6.1-sol medium q95.6 -> 100, gpt-6-sol low
  q85.6 -> 92.2, speed and responses unchanged. A second line asking to name every setting on the code path made both
  models worse (q87.0 / 83.3) and was rejected.
- Edit tasks (EDIT rename across 4 files, WRITE 3 new files, MULTI 3 blocks in one file plus 2 files; 5 runs, two
  models): every run of stock Pi, Pi + prompt and my-pi passed its tests. Seconds Pi / Pi + prompt / my-pi:
  gpt-6.1-sol medium 21.0 / 22.0 / 22.6, gpt-6-sol low 17.0 / 18.8 / 17.2; my-pi minus Pi + prompt on gpt-6-sol low
  [-2.2, -0.9] s. On WRITE both prompted stands read the repository before writing, stock Pi writes at once.
- bench44, the final check (commit `7890a8b`; stock Pi, Pi + bench41 prompt and my-pi run at the same moment; T01-T07,
  5 runs; judge 5 votes, majority per point; rows in `notes/bench44.csv`). Seconds / quality:

  | Config | Pi | Pi + prompt | my-pi |
  |---|---|---|---|
  | gpt-6-sol medium | 29.9 s / q81.7 | 37.8 s / q90.2 | 37.6 s / q93.6 |
  | gpt-6.1-sol medium | 40.7 s / q94.1 | 49.6 s / q97.2 | 50.0 s / q99.0 |
  | gpt-6-sol low | 16.3 s / q74.0 | 26.5 s / q89.0 | 27.1 s / q93.8 |

  90% intervals, my-pi minus Pi + prompt: quality [0.6, 6.3], [-0.3, 3.4], [1.9, 7.5]; seconds [-2.2, 1.7],
  [-1.9, 2.9], [-0.8, 1.9]. my-pi minus stock Pi: quality [8.6, 15.2], [3.2, 6.5], [15.3, 24.2]; seconds [6.3, 9.0],
  [7.3, 11.5], [9.7, 11.9]. my-pi answers better than both at the speed of Pi + prompt; stock Pi is faster because it
  stops early with incomplete answers. No run changed the repository. Edit tasks: see the edit-task entry above.
- Faster writing (`notes/refine/refine-write2.md`, `notes/refine/refine-find.md`; WRITE, EDIT, MULTI, T01, T03, T05,
  T06; two models): a new file the task fully specifies needs no read of its neighbours (one line in `SYSTEM.md`, one
  in `read.md`), and the find example shows that "app" returns the directory only while "app/**" returns its files.
  Measured in two steps: the read lines against main (WRITE 18.4 s / 5.5 responses -> 16.0 s / 4.7, T01 and T05
  checklists equal), then the find example against that (edit tasks 19.4 s -> 17.3 s, question checklists 94.8% ->
  96.3%, not lower). All runs correct. gpt-6.1-sol still makes a second find in 2 of 6 WRITE runs. A review then made
  the find, read and prompt wording exact (full-path matching, imported code, long files in parts) without new runs.
- Accepted limit: Pi's compaction summary lists changed files from `args.path` only, so files given in `write.files[]`
  or in `edits[].path` are missing from that list. Fixing it needs a change in Pi itself; the files stay in the
  transcript and in the tool results.
- Background jobs. Owner: «Да, и надо, чтобы основной агент. Нет, знаешь как? Надо, чтобы длительные shell процессы
  сами уходили в фон. Если он работает больше 20 секунд, чтобы он превращался в фоновый процесс, а не оставался висячим
  активным процессом. Надо, чтобы всё, что висит больше 20 секунд, любая операция, которая висит больше 20 секунд,
  уходила в background, и можно было просто её пропинговать через какое-то время. Чтобы у агента был инструмент
  проверки состояния.»; «только надо время сократить до 12 секунд, после 12 секунд уходит в фон.»; answers to the
  design questions: «1а2а3а / 4 - надо разобраться с рейс кондишенами и найти самое интелектальное производительное и
  эффективное решение марщрутизации и оркестрации тулколов / 5б / 6а с учетом 4 пункта добавочного».
  Rule: a top-level call of `bash`, `codemode` (the whole script) or `read`, `edit`, `write`, `grep`, `find` that has
  not settled 12 s after it started, barrier wait included, returns at once as `job#N` with the command, elapsed time,
  the output so far and a log file in the OS temp dir, and keeps running; a call that settles sooner returns exactly
  the stock result. Calls inside a codemode script never go to the background. The new `job` tool (`wait`, `status`,
  `kill`; `ids`, `id`, `timeout_ms` default 300000 only when omitted, `lines` default 20) waits mechanically until
  one selected job ends or the caller's deadline, shows state, exit code, elapsed time, tail and log path, and kills
  a job with its process tree or cancels a queued one. Polling only, no pushed messages; the descriptions say to wait
  for or kill one's jobs before the final answer. A job dies on Esc (an abort of any run of its caller), `job kill`,
  its `timeout`, and the caller's shutdown or reload; jobs belong to the session whose call started them (one registry
  per `createTools`, so each subagent and worker has its own; RQW-agent calls the offered `job` definition's
  `jobs.abortAll()` on interrupt and `jobs.dispose()` on close). `job` is activated whenever one of these tools is
  active, whatever the selection; when Pi's allowlist keeps it off, nothing goes to the background. Reason: the owner
  wants long operations not to hold the agent and a tool to check them; Codex unified exec yields the same way
  (`yield_time_ms`, session id, polling); the threshold is the owner's fixed value.
  Ordering with background jobs, owner: «1a + живай проверка на хайку и луна хай ризонинга» (option 1a of the
  ordering proposal, «ordered until handoff, free after»). Calls of the same response keep the order the barrier
  gives them: a call after a job that went to the background waits for its real end and itself becomes a queued job
  after 12 s. At the handoff a bash or codemode job is detached from the barrier (`detach` in `barrier.ts`, passed
  through `nested.ts`): calls registered later, which are the calls of later responses, neither wait for it nor for
  its scope resolution. A read, edit or write job keeps its paths, so a later call of the same file still follows it.
  While a bash or codemode job of the caller runs, a top-level read, edit or write of a file whose mtime is not older
  than the earliest running job's start and differs from the version the caller last read or wrote gets one line
  (wording since FR-safe below): `note: <path> changed <n> s ago outside your tools while job#N (<command>) runs; wait
  for job#N if it writes this file.` A dependency on a background
  job is explicit: `job wait`, then the dependent call. Reason: Pi starts every call of a response before any can
  reach 12 s and starts the next response only after all of them returned, so "registered before the handoff" means
  "same response"; this keeps the measured same-response ordering (section Tools, ordered conflict barrier) and lets a
  server or a long build stop blocking the agent; Codex 0.163.0 and oh-my-pi 18.8.9 do not order shell calls at all.
  Race analysis, rejected alternatives and cost: `my-pi-evidence/bash-background/D4-ORDERING.md`; design:
  `DESIGN.md` there. Carriers: `extensions/RQW-tools/jobs.ts`, `barrier.ts`, `nested.ts`, `index.ts`, `codemode.ts`,
  `descriptions/bash.md`, `descriptions/job.md`; `extensions/RQW-agent/index.ts`, `roles/*.md`.
  Proof: `extensions/RQW-tools/test/background.test.ts` (injected threshold, gate-file commands),
  `test/barrier-detach.test.ts` in that folder (held operations, an independent oracle, randomized detach; it fails
  with a no-op detach, and the queued-edit test fails when file jobs detach too),
  `extensions/RQW-agent/test/wait.test.ts` (job tool in a child, interrupt and stop).
  Two refinements from the first live probe (logs `my-pi-evidence/bash-background/probe/runs/`): `wait` keeps
  collecting for 250 ms after the first selected job ends, because a call queued behind it ends milliseconds later
  and returning without it cost the model one more response in 7 of 8 build runs; and a bash call whose own
  `timeout` ends it within 1 s after the threshold stays in the foreground (as oh-my-pi bounds its wait by the
  timeout), because `timeout: 12` reported a dying server as running.
  Live probe (owner D6: Haiku 5.5 and GPT-6 Luna, both thinking high; 28 runs in two rounds): builds went to the
  background, same-response calls ran after them, dependent calls followed a `job wait`, models batched calls, and
  every job was waited for, killed or ended by its timeout before the final answer. Report and logs:
  `my-pi-evidence/bash-background/probe/REPORT.md`.
  Routing around background jobs (FR-safe), owner: «2а» (option 2a of the routing proposal: the full FR-safe design,
  `my-pi-evidence/bash-background/routing/ROUTING.md` section 5). On top of the rule above:
  holds (H1): at the handoff a bash job keeps what `footprint.ts` reads with certainty from its command text: the
  package folder an install changes (`npm|pnpm|yarn|bun` `ci`, `install`, `add`, `remove`, ...), the git index and refs
  of a repository a git command changes (every git subcommand except known reading ones), and the exact files it writes
  (redirect targets, `tee`, `sed -i`, `curl -o`, `rm`, `mkdir`, `touch`, `cp`/`mv`/`ln` destinations). A later call
  waits only for these: an edit or write of a held file, or a bash command that uses the same package folder (package
  manager and JavaScript tool commands), changes the same repository, or writes the same file; reads never wait. Any
  doubt (command substitution, variables or globs in a path, an unknown `cd`) holds nothing, so a missed writer falls
  back to the rule above plus the effects report. The handoff text says `holds: ...`; a call queued behind a hold
  shows `waiting for: job#N (holds ...)`. Package-folder and git holds are process-wide (`ledger.ts`): main,
  subagents, workers and reviewers of one Pi process wait for each other's holds; files are not ordered across
  sessions, they get attributed notes. Effects report (O1): a top-level bash or codemode call takes a snapshot of
  the working tree (every file of `git ls-files -co --exclude-standard`, or outside git a walk of at most 20000 files
  without .git, node_modules, .next, target, .venv, __pycache__, with mtime and size) right before its command starts,
  and a job takes another when it ends. What changed is the difference of the two states, never a time cutoff: a file
  written just before the start is not a change whatever the clocks say (the code review found the cutoff's false
  reports; a test with the files aged had hidden it). A file the snapshot does not list (git-ignored, outside the
  tree) falls back to its mtime against the start. Cost, paid by every top-level bash and codemode call (measured,
  `$TMPDIR/bb-r3-snapshot-cost.log`): 8-12 ms for this repository (283 files), 17-18 ms for a 1420-file repository,
  133-150 ms for a 20000-file walk outside git; each report states its own cost in `scanned`. Owner's cost decision
  (option 1A of `my-pi-evidence/bash-background/SNAPSHOT-COST.md`: the exact snapshot before every call, against a
  cheaper scan at the handoff with an uncertainty list): «Да, если это всего лишь 150 миллисекунд на 20 тыс. файлов,
  конечно, блядь, надо делать снимок файлов точный. Это 1А.» Reason: only the exact states before and after give no
  false attribution and no missed early change, and the price is small: about 8-22 ms in the git repositories measured
  and about 150 ms for 20000 files outside git. The current exact pre-start snapshot of every top-level bash and
  codemode call stays unchanged, no code change. Carriers: `snapshot` in `extensions/RQW-tools/ledger.ts`, taken in
  `begin()` of `jobs.ts` before the command starts and compared with the end snapshot by the effects report. Proof:
  `extensions/RQW-tools/test/ledger.test.ts` ("a snapshot compares states, not times") and
  `extensions/RQW-tools/test/background.test.ts` (a file written just before the start or with a future mtime is not
  reported; `scanned` names both snapshot costs). The report lists under
  `effects` the files created and the files changed while it ran (with the RQW session and tool when another session wrote it), the
  caller's own writes during the run (file tools, and the files a foreground bash command of the caller certainly
  wrote by its footprint), own writes overwritten since, files deleted since the handoff, and the other jobs that ran
  alongside. Every list is complete (Pi gives a custom tool's result text to the model whole). The scan has no
  deadline of its own and runs also for a killed job; it is cancelled only when the caller's session ends. A failed or
  cancelled scan, a git failure and a walk stopped at its limit are named in `effects.errors` or `scanned`, never
  dropped. Write precondition (P1): a write over a file the session has read
  or written, changed since by anyone else, is refused once with who changed it; the identical retry overwrites; a
  file never seen is written without a check. The check, the stock tool and the ledger record of every RQW read, edit
  and write run in one process-wide critical section per file (`withFileLock`, files locked in sorted order), so two
  sessions that read one version cannot both pass the check and overwrite one after the other. Files are keyed by
  their native real path (`identityKey` in keys.ts): symlink and case aliases share records, distinct files never do.
  Records belong to a registry (`owner`, unique; the label "main", "code_writer#2" is only shown); a registry that ends
  forgets what it saw, so a restarted session or a second session with the same label inherits nothing. A multi-file
  edit or write records each written file even when a sibling failed; a file whose result says "Possibly changed" is
  marked uncertain, and the next write of it is refused once until it is read. A read keys the spelling it will open
  when it is about to run, after the calls it waited for (an earlier bash may have created the fallback spelling).
  Own writes are kept per owner while a bash or codemode job of that owner runs (from its start until its report is
  built, dropped when no job watches), so a later write by another session cannot erase them from `yours` and the
  report shows the lost update under `overwritten`. A read whose file changed while it was read gets a note and does not
  count as seen. Notes of a read, edit or write name the other session (`changed by code_writer#2 (edit, hh:mm:ss)
  after you last saw it`). K1: `job kill` also cancels the queued calls of the same response that wait for the killed
  job (transitively) and lists them in `cancelled_followers`; calls of later responses are not cancelled. A killed
  queued call leaves the barrier at once and never runs (`withdraw` in barrier.ts), so a later call of the same file
  does not wait for whatever the killed call was waiting for. N1: a job
  that ended with a non-empty effects report the model has not seen (through `wait`, `status` or this note) adds one
  line to the next top-level tool result of the caller, a codemode script's result included: `note: job#N (<command>) ended (exit 0); its report lists <n>
  file changes: job status job#N.` (or `its effects report is incomplete (<reason>)`). W1: `job wait` takes `until`, a JavaScript regular expression on the output (a leading `(?i)` ignores case: GPT-6
  Luna wrote it in the pilot and got an error); it returns as
  soon as a job's output matches (`reason: "match"`, the matching line) while the job keeps running. S1: a codemode
  script waits for a free worker of the process (an aborted waiter leaves the queue, so a released slot always reaches a
  live waiter) (`PI_CODEMODE_MAX_WORKERS`, default 2, as Pi counts them) as a queued
  job instead of failing after Pi's 60 s; the handoff of a script says how many workers are in use. A server command
  that names a port a running job of any session serves gets a note. A bash call inside a codemode script never goes
  to the background but takes the same process-wide git and package-folder claims, waiting inside the script. Each session's label comes through the optional
  `options.label` of the offered factory: the path from the main session (RQW-agent passes `agent#1`,
  `agent#1/agent#1`, `agent#1/code_writer#2`; RQW-review `review`, a child's reviewer `agent#1/review`; main is
  `main`). It is shown only in notes; each registry keeps its unique owner. Children like main (coordinator's technical
  decision at the rebase onto subagent parity, from the owner's «children like main» and the background of a whole
  script): with an RQW-tools offer, a child's or reviewer's `codemode` is Pi's definition built from that session's API,
  passed to the factory as the optional `options.codemode` and returned as one call of the child's barrier and a job of
  its registry, so a child script goes to the background after 12 s like main's, and S1 slots count the scripts of main
  and every child together. Without an offer the child keeps Pi's stock codemode as registered by Pi's factory.
  Explorers get `job` only when offered and never edit or write. A child's review disposes its jobs when the child
  ends (the child's lifetime signal ends the review run). The reviewer of RQW-review gets the offered `job` tool with its four tools when RQW-tools offers them (section
  Review); Esc of a review aborts its jobs
  (`abortAll`) and the end of the review disposes them, as RQW-agent does for subagents. The prompt section
  `rqw_tools_execution` says that a background job holds the later calls of its response and, from later responses,
  only calls that change what it names as held. Writes of file tools inside a codemode script are recorded as `<tool> in a codemode script` of the caller.
  Reason: the replay of 131598 recorded tool calls left D4 with 4090 silent overlaps between background jobs and later
  calls at the same wall time; FR-safe leaves none silent, makes 45 later calls wait for a held resource, and keeps the
  same-response order; the owner chose it. Carriers: `extensions/RQW-tools/footprint.ts`, `ledger.ts`, `barrier.ts`
  (held entries, followers), `jobs.ts`, `index.ts`, `codemode.ts`, `keys.ts`, `descriptions/job.md`,
  `descriptions/write.md`; `extensions/RQW-agent/index.ts`, `extensions/RQW-review/index.ts` (labels, the reviewer's
  `job`), `notes/prompt-tools-isolation.md` (section text); races R16-R24:
  `notes/analysis-races.md` section 9. Pilot live probe (Haiku 5.5 and GPT-6 Luna, thinking high; logs
  `my-pi-evidence/bash-background/probe-2/`) found six defects, fixed here: the footprint read a subshell's `)` as
  part of a written path; an append by the caller's own bash was reported as a change of the build job; a write of a same-response follower, which starts the moment the job's work
  ends and before its scan, was reported as the job's (the scan now runs before the barrier releases those calls); a
  tracked file the job deleted was not reported (git lists index entries); and `waiting for` named the holds of a call
  that a same-response follower waits for in full; a follower queued behind the job was listed as running alongside
  it. The port note is computed before the server starts and also goes
  into its handoff. The code review of 1ecb796 found the races fixed above (slot wakeups, a killed queued call still
  holding its file, nested bash without claims, the P1 check outside the write's critical section, alias and owner
  identity, the time cutoff); each has a test in `background.test.ts` (#3-#8) or `ledger.test.ts` that fails on the
  code before the fix. Proof: `extensions/RQW-tools/test/footprint.test.ts`, `ledger.test.ts`,
  `barrier-detach.test.ts` (held oracle, randomized; it fails when held entries are ignored),
  `background.test.ts` (R16 and R17 fail when the classifier holds nothing), `extensions/RQW-agent/test/
  nested-workers.test.ts` and `extensions/RQW-review/test/review.test.ts` (labels, reviewer `job` lifetime),
  `extensions/RQW-agent/test/agent.test.ts` and `extensions/RQW-review/test/subagent.test.ts` (offered child codemode,
  explorer `job`, path labels, a child reviewer's jobs on the child's end), `background.test.ts` ("S1 across sessions"),
  `test/prompt-tools-isolation.test.ts` (section text).
- Historical proof: `npm test` (`node --test`, no model) and `.github/workflows/tests.yml` on macOS, Linux and Windows, plus a job
  reproducing PowerShell, portable Git Bash without admin, then Node. Current verification policy is in [Work policy](#work-policy);
  this historical coverage is not a Linux requirement or PowerShell runtime authorization.

## Context

- `extensions/RQW-context/index.ts` applies the owner's rule to physical models after native routing: W = min(physical.contextWindow, 500000) is
  the context window Pi uses, R = `Math.round(W / 10)` (a .5 rounds up), and Pi compacts above W - R. 272 000 ->
  window 272 000, compaction above 244 800; 500 000 and 1 000 000 -> window 500 000, compaction above 450 000.
  Built-in, models.json and extension models alike, at start (`--model`), on resume, after `/model` and model cycling.
  No per-model list.
- The physical window above 500 000 is lowered, not only the trigger. Owner, C:2015:
  «если контекстное окно больше 500 тыс. токенов, то пусть оно будет 500 тыс. токенов. Резерв — 10% от края.»
  C:2047 requires a universal automatic solution. The physical rule includes targets selected by native routing.
- Mechanism, window: `agent.state.model` exposes the existing stable capped copy for a physical selection.
  `AgentSession._buildRuntime` hooks the actual native Agent's `state` getter and `createLoopConfig` so old and new
  SDK sessions, public state reads and native loop configuration apply the rule without a prior `session.model`
  read. Stored models unwrap through shared WeakMaps, including `setModel(current)` and retained copies after reload.
  For native virtual routing, `ModelRuntime.getPhysicalModel` caps the result of the native canonical lookup. This
  covers request dispatch, response/usage/overflow lookups and direct SDK routes without changing the catalog.
  Virtual selection identity and its declared or unknown window stay native. Extensions get the correct classes
  through Pi's library alias or CLI bundle virtual modules; tests exercise both.
- Load check: before patching static hooks or acquiring ownership, the extension checks the writable/configurable
  methods `_buildRuntime`, `getCompactionSettings`, `getPhysicalModel`, `_exceedsCompactionThreshold`,
  `_checkCompaction`, `_runAutoCompaction`, `compact`, `_runDefaultCompaction`, `_getSummarizationRequestAuth`,
  `_modelForMessage` and `_limitsModel`, the configurable `model` getter and extensible prototypes. The new routed
  boundaries also check native method arities. Unsupported shapes produce one load error and no static changes.
  Runtime Agent.state/createLoopConfig guards remain checked together before installation.
- Mechanism, reserve: Pi compacts at `contextTokens > model.contextWindow - reserveTokens`. The existing
  `SettingsManager.getCompactionSettings` wrapper preserves native validation and explicit settings by the original
  selection key. For virtual selection, a session/request-local AsyncLocalStorage frame supplies the physical window
  for THIS pre-request target or the physical model of the response being checked, never a global last-model value.
  The actual Agent.prepareRequest callback is scoped lazily through the Agent hooks, including old observer sessions.
  Automatic preparation inherits the triggering physical model; manual preparation uses the latest successful
  response after native abort settles. Without a known physical window, native settings remain unchanged.
  Native default summarization keeps the interception hook's preparation intact and uses a copy. Its existing
  direct summary route is resolved once after interception; the copied preparation reserve binds once to that
  target's W. Since Pi 1.4.0 R is only the trigger: `generateSummary*` ignores it, history and split-turn summaries
  carry no explicit `maxTokens` and use the summarizing model's own output limit (`compaction.js`, `#9512`), still
  clamped by pi-ai to the window minus the estimated input minus 4096 (limits 1 and 2 below). A cancelled/custom
  compaction does not route a default summary. No router, registry mutation, dependency or public setting is added.
- Consequences for a model above 500 000, all as for a 500 000 model: footer and `getContextUsage()` show the window
  500k and 90% at the threshold; summary requests reach the provider with the 500 000 window and without an explicit
  output limit (Pi 1.4.0; before it they were 0.8 and 0.5 x R, 40 000 and 25 000); the output cap of a request is
  500 000 - context - 4096, about 45 900 at 450 000 context (the test sees 45 902); an answer reporting more than
  500 000 input tokens counts as overflow (`pi-ai/dist/utils/overflow.js:152-156`). With compaction on and a history of several turns that a summary can
  fit, Pi recovers: a completed answer is kept and the session is compacted with reason `overflow` and no retry
  (`agent-session.js:2440-2443`); a length stop with no output at 99% of the window is compacted and retried once
  (`agent-session.js:2437-2443`, `2467-2469`, `overflow.js:161-165`). Nothing about the window goes to the provider:
  the OpenAI-compatible body has only `max_completion_tokens` changed, every other field as stock Pi.
- Known limits of the 500 000 window, no code change: the window rule is the owner's, and all follow from it.
  The numbers below were measured on Pi 1.3.0 with explicit summary caps; Pi 1.4.0 keeps the same pi-ai clamp
  (`simple-options.js:3-9`) on a summary request, now sized from the model's output limit. Not re-measured.
  1. The output cap. pi-ai clamps a request's output to `contextWindow - context - 4096` with a floor of 1 token
     (`pi-ai/dist/api/simple-options.js:5-9`), so on a 1M model it reaches 1 token at about 495 900 context tokens.
     Pi does not recover in three cases. With `compaction.enabled: false` there is no compaction at all
     (`agent-session.js:2392-2394`): measured `max_completion_tokens` at context 0 / 480 000 / 497 000 / 520 000 is
     `[128000, 15902, 1, 1]` (stock Pi `[128000, 128000, 128000, 128000]`); a provider that obeys it answers 1 token
     with stop reason `length` and no error. A history that is one oversized turn, such as a 700 000-token first
     paste, gives requests with a 1-token cap; the overflow compaction that follows also has its turn-prefix summary
     capped at 1 token and fails with "Turn prefix summarization failed: generation hit the token cap and the summary
     is incomplete". When the part a compaction summarizes (all but the last `keepRecentTokens`) of a text-heavy
     history estimates above about 496 000 tokens by characters, every request gets a 1-token cap and every
     compaction fails: the summary request is capped the same way ("Summarization failed: generation hit the token
     cap and the summary is incomplete"). A text-heavy history a little above the window still recovers, a resumed
     one too: Pi checks a resumed session at its first prompt (`agent-session.js:1483-1485`, `_prepareRun`); in review runs against
     a local stub the dead end began between 535 000 and 541 728 tokens (summary cap 5 112 at 534 864, 1 at
     541 728). A tool-heavy history of the same size recovers, because summaries cut tool results to 2 000 characters
     (`compaction/utils.js:82`). The test pins the cap with compaction off.
  2. Summaries of prose-heavy histories. A summary request is a fresh context that pi-ai sizes by characters
     (3.5 per token), so a chat history of English prose, about 4.4 chars per real token, estimates above the window
     at the threshold and the summary's output cap is 1 token: on a 1M model the compaction at 450 000 fails with
     "Summarization failed: generation hit the token cap and the summary is incomplete", then up to two failed
     summary requests per prompt. Stock Pi does the same on a native 272 000 or 500 000 model; it is new for 1M models
     only because stock Pi would not compact them before 983 616. Tool results are cut to 2 000 chars before the
     estimate (`compaction/utils.js:82`), so tool-heavy coding sessions do not reach it.
- Physical models up to 500 000 keep their own object; only the reserve changes. The model registry is not touched: `/model`
  and `--list-models` show the declared window, the session and the footer show 500k. So one model shows two windows
  through events and RPC: `model_select.model` is the object passed to `setModel` and RPC `set_model` returns the
  registry object (`rpc-mode.js:371-372`), both with the declared window; the session state (`ctx.model`,
  `model_select.previousModel`, RPC `get_state` and `get_session_stats`) has the capped one. There is no fix without
  a Pi API.
- A reserve the user set still wins, measured against the capped window W: `compaction.reserveTokens` for all models
  and `compaction.modelOverrides["provider/id"].reserveTokens` for that model, Pi's own precedence (1M with a reserve
  of 30 000 compacts above 470 000). A user reserve of W or more would leave a threshold of 0 or below, so Pi would
  compact before every request; then the rule's R applies instead (1M with 600 000 compacts above 450 000). Pi's docs
  example (`docs/compaction.md:444-457`), `"some-provider/big-model": { "reserveTokens": 400000 }`, "triggers
  compaction above 600K tokens" for a 1M model; with the extension the window is 500 000, so it compacts above
  100 000. `compaction.enabled: false` still turns off threshold and overflow compaction. A models.json
  `contextWindow` (a model entry or `modelOverrides`) is the model's declared window: up to 500 000 Pi uses it as
  written, also to lower a 1M model; above 500 000 it is capped like any other source, because Pi's composed model
  does not say where its window came from. A model without a positive contextWindow keeps Pi's values, as stock: for
  a window of 0 or undefined Pi itself compacts after every response, because its post-response check is
  `tokens > 0 - reserve` (`agent-session.js:2506` via `compaction/compaction.js:173-176`; only the pre-request check has a
  `<= 0` guard, `agent-session.js:419-420`); a
  response is skipped only when nothing lies beyond `keepRecentTokens` to summarize. The extension leaves that
  unchanged.
- The hooks live as long as the process, one per class (`Symbol.for` guards), and act only while a loaded
  RQW-context owns them: each factory adds a fresh token to the process-global `Set` under
  `Symbol.for("rqw-context/owner")` on `globalThis`; its `session_shutdown` handler removes only that token.
  The wraps act while the set is nonempty. Without an owner `getCompactionSettings` returns Pi's
  own values, `_buildRuntime` installs no accessor, and an accessor already installed returns the model as stored.
  Pi emits `session_shutdown` before it loads the next runtime's extensions: `/reload` (`agent-session.js:3001`,
  then `_resourceLoader.reload()` at `3010`), `/new`, `/resume` and `/fork` (`agent-session-runtime.js:102-113`,
  `teardownCurrent` before `createRuntime`). After the last owner switches RQW-context off and reloads, or emits
  `session_shutdown`, the window and reserve are stock Pi's again (section Isolation). Concurrent owners survive
  either shutdown order and reloads of other sessions; an old runtime removes only its own token, not a newer one.
  SDK `dispose()` alone disconnects listeners and does not emit `session_shutdown`; callers must emit the lifecycle
  event, as Pi does. While any owner remains, SDK sessions in the same process get the rule too, including sessions
  that excluded the extension. Engineering decision: replace the owner slot with a process-global Set of live
  owner tokens. Underlying owner requirement (C:2047): «Это должны быть универсальные решения, которые будут
  работать всегда автоматически». Reason:
  one slot let shutdown or reload of a newer SDK session disable an older, still-active owner.
  The patch code itself is installed once per process, so after an update of my-pi a `/reload` keeps the old RQW-context code; Pi must be restarted for RQW-context changes to apply
  (`INSTALL.md` step 4). Reason for text, not code: a replaceable implementation behind the guards adds machinery for
  a case a restart covers.
- Native virtual selection retains its callback, identity, state, thinking and declared or unknown window.
  `ModelRuntime.getPhysicalModel` caps the physical target after native canonicalization. Session/request-local
  context supplies its W/R for the current operation, including physical selection changes while routing waits.
  Automatic preparation uses its trigger target; manual preparation uses the latest successful response after
  native abort. Default summarization keeps interception preparation intact and routes once using the captured
  selection. Its copy binds R to the summary target, retaining the original explicit reserve intent from preparation
  through `reserveIntents`, without rereading live settings after interception or an awaited route. Pi 1.4.0 ignores
  that R for the summary output (no explicit maxTokens, the model's own output limit bounds both summaries), so the
  rebinding no longer changes a request; it stays, a later simplification is optional. No extra route, router or SDK fork is added.
  The prior routed-physical bypass was a bug, not an owner-approved exception. Last-owner shutdown restores stock
  physical lookup identity and settings. Implementation: `extensions/RQW-context/index.ts`;
  details: `notes/context-questions.md`.
- Proof: `extensions/RQW-context/test/context.test.ts` runs real sessions of the library and the bundle with a
  scripted provider that reports exact usage and a local OpenAI-compatible endpoint: Pi's own `session.model`,
  `getContextUsage()`, `compaction_start` at W - R + 1 and not at W - R (also after a switch, `/reload`, resume, fork
  and `/new` through `AgentSessionRuntime`, and in the pre-request check `_exceedsCompactionThreshold` between tool
  turns), user reserves in memory and in a file-backed `settings.json`, overflow recovery above 500 000, the output cap
  with compaction off, native virtual selection with capped physical requests, load order, a load without either internal, the request body
  against stock Pi, and the switch: listed in `settings.json`, dropped, `/reload` gives window 1 000 000 and reserve
  16 384, listed again and `/reload` gives the rule back. `test/isolation.test.ts` checks the same through the
  `packages` filter. Concurrent SDK tests in `context.test.ts` run for library and bundle: A/B shutdown in both
  orders, package-filter reload excluding B while A remains, reload A, and stock values after the last owner leaves.
  Tests emit `session_shutdown` before SDK `dispose()` so their owner tokens do not leak between cases.
  `extensions/RQW-context/test/routing.test.ts` also covers native routed physical targets in library and CLI
  bundle, operation-local thresholds, captured selection and original reserve intent despite later settings changes,
  independently routed summary budgets, concurrent sessions and last-owner restoration. These are synthetic-provider
  tests, not cloud or interactive-terminal proof.

## Prompt

- First step is only the prompt extension (user: «пока делаем только экстеншен который заменяет промпт систменый на
  наш»). `extensions/RQW-prompt/index.ts` sets `systemPromptOptions.customPrompt` in `before_agent_start` to
  `extensions/RQW-prompt/SYSTEM.md` plus the workstation, `<critical>`, environment and date blocks. Not
  `forceSystemPrompt`: Pi still appends project context, skills and `<cwd>` and records the prompt as sections.
- The text follows the concept in `notes/prompt-concept.md` and starts from the bench41 template, the only measured
  version on Pi (+10.2 / +6.2 / +1.9 quality points on gpt-6-sol low / gpt-6-sol medium / gpt-6.1-sol medium).
- Tool-specific search and execution instructions belong to RQW-tools, not `SYSTEM.md`; see Prompt/tools isolation
  below. The `<critical>` verify line stays as in omp-lite.
- Writing a file longer than about 400 lines in parts (bench35 lost a response to the output limit) lives in the
  `write` description, as in omp-lite, each part in its own response. Removed against bench41: the working
  directory from the date line, because Pi already appends `<cwd>`.

- The four optional `SYSTEM.md` edits at `f6e9327` are not adopted as a package; main keeps its prompt unchanged. The owner wanted the minimum changes without breaking the prompt, and explicitly permitted GPT measurement (user: «Замеры правок System LMD можно тоже проводить на модели GPT-6»). On GPT-6 low, wall time improved by about 6.9%; on GPT-6.1 medium, quality changed by -2.29 percentage points (90% CI [-5.81, +1.24]). This does not prove a general regression, but does not establish safe noninferiority for the common prompt. Measurement-based rejection completes this task, rather than pausing it. Evidence and candidate history: `notes/bench46-gpt.md`, `notes/bench46-gpt.csv`, commits `80bec267` and `f6e9327`; the deployed carrier remains `extensions/RQW-prompt/SYSTEM.md` on main.

### Prompt/tools isolation

- Owner: «Когда мы делаем эти отдельные модули, они должны быть полностью изолированы, самодостаточны, чтобы мы могли включать и выключать, как feature флаги».
  Task: "Scope ONLY removing RQW-tools-specific runtime assumptions from RQW-prompt and putting them inside RQW-tools,
  so each works with other off." Four manifesto edits stay on `prompt-manifest`, not here.
- `extensions/RQW-prompt/SYSTEM.md` no longer names grep/find or assumes our shell barrier or partial writes.
  `extensions/RQW-tools/index.ts` uses native `before_agent_start` mutations of `systemPromptOptions.sections`, with
  no import or handshake with RQW-prompt. `search_method` needs declared read, grep and find;
  `rqw_tools_execution` needs declared bash. Both check `selectedTools` minus `hiddenTools`, so explicit selections
  do not acquire instructions for unavailable tools. Stock or custom prompt works in either extension order.
- Source proof, Pi 1.4.0: `dist/core/extensions/runner.js`, `emitBeforeAgentStart`, shares one normalized options
  object across handlers; `dist/core/system-prompt.js`, `buildSystemPromptSections`, uses `customPrompt` as preamble
  and still appends `sections` after cwd. `promptGuidelines` and tool guidelines are built only without customPrompt,
  so they cannot carry these instructions. `forceSystemPrompt` deliberately bypasses sections; no override is added.
- The two partial-write reminders were redundant: `extensions/RQW-tools/descriptions/write.md` already says
  "write a file over about 400 lines in parts, each part in its own response: the first with write, then each next
  with edit" and specifies the edit tail. That unchanged description remains the single owner. The shell barrier
  sentence is not in the descriptions, so deleting it alone would lose effective content; it moves to a section.
- Exact runtime text diff and risks: `notes/prompt-tools-isolation.md`. Proof: `test/prompt-tools-isolation.test.ts`,
  real package filtering, sessions and prompt/tool patch replay on a faux provider, both orders, standalone extensions,
  explicit tool selections, active-tool changes and disabling either extension through reload. `npm test` includes
  package tests. No live model runs in this task; GPT measurements of the changed text follow separately.

## Settings

- Owner: «Да, и вообще надо убрать прогрев кэша, чтобы кэш прогревался, когда уходит сообщение первое, не раньше этого.»
  Owner clarification: «Нам тоже настройки прогрева кэша нахуй не нужны через конфиги. Надо просто, чтобы они были внутри настроены в рамках плагина, и всё на этом. Чтобы они работали супер корректно, супер пиздато и эффективно.»
  Background prompt-cache warming is off inside the plugin; normal inference requests still populate and read the
  cache. `extensions/RQW-settings/cache-warming.ts` supplies a reversible, session-owned `getCacheWarmingMode`
  policy only while that session loads RQW-settings. User `cacheWarming` values, including changes during a session,
  cannot enable it. No new config knobs or settings-file, environment or `showCacheMissNotices` changes.
  Reason: no synthetic keepalive inference; the first real request writes the cache. Pi 1.4.0 always constructs
  its warmer, but off prevents it arming. Disabling/reloading or disposing restores the native getter and default
  (`streaming`), without affecting another owning session. A checked lifecycle shim is needed because the public
  extension API exposes a settings copy, and Pi's global-only getter ignores `applyOverrides`.
  The lifecycle registry persists at zero owners and weakly maps wrappers to their original descriptors. Reinstall
  recognizes a dormant settings wrapper restored by a later-released foreign hook, rather than nesting another
  layer. Reason: RQW-settings precedes RQW-anthropic in production load order; their shutdown order must not grow
  the prototype chain on every reload. Dormant hooks pass through and restore themselves when exposed at the top.
  Proof: `extensions/RQW-settings/test/cache-warming.test.ts` (real SDK, faux provider and fake timers) and package
  `test/cache-warming-reload.test.ts` (library/bundle, 12 co-loaded reloads, actual bind/dispose stack depth stays 2).
  Child-session policy is carried independently by RQW-agent and RQW-review (sections Agent and Review).
  TTL measurements and the accepted role policy: `notes/prompt-cache-policy.md` (owner:
  «Надо, чтобы ты замерил, как у нас сейчас это работает, и предложил какое-то наилучшее решение для нас.»).
- `codemode` and `tool_search`, Pi's built-in tools, are active by default (owner: «Давай включим CodeMode и Tool
  Search»). `extensions/RQW-settings/index.ts` adds them to the active tools at `session_start` under the same rule as
  `grep` and `find`: no tool flag in argv and no `defaultTools` setting. It is the same rule with one copy in each
  extension, `extensions/RQW-settings/selection.ts` and `extensions/RQW-tools/selection.ts`, so neither imports the
  other (section Isolation). A tool is added only if it is registered, so `-builtin:codemode` gives no error.
  Any user selection (`--tools`, `--exclude-tools`, `--no-tools`, `--no-builtin-tools`, `defaultTools`) leaves the stock
  set. Mode `on` (Pi's default) is kept: Pi appends a "Codemode: `tools.<name>(args)` resolves to ..." line to the
  descriptions of our six tools in each request. Texts, source lines and the barrier check: `notes/settings-codemode.md`.
- `codemode` is a call of the RQW-tools barrier with scope "all", like `bash`; the tool calls of its own script are
  ordered by a barrier of that call. RQW-tools replaces Pi's built-in `codemode` at `session_start` with the same
  definition and a grouped `execute` (`extensions/RQW-tools/nested.ts`, `codemode.ts`), so `-builtin:codemode` still
  means no `codemode`. Reason: `[codemode(write f), read f]` let the read run first.
- A script's tool call finds the barrier of its script by its tool call id: Pi gives it `<codemode id>/<n>`, and the
  group registers its barrier under the codemode call's id. A nested id with no registered ancestor goes to the outer
  barrier, or runs at once when an ancestor has a live entry there, so it never waits for itself. Reason: the first
  version carried the barrier in `AsyncLocalStorage`, and Bun, which runs the Pi release binaries (`pi.exe` of PCLI
  included), drops that context in a worker's `message` callback; every script that called a tool hung (review A).
  Proven on Node 22 and 26 (`npm test`) and on Bun 1.3.14 (the runtime inside the Pi 1.4.0
  binary, read from the release's `pi.exe`) and 1.4.3:
  `extensions/RQW-tools/test/bun/codemode-check.mjs` runs Pi's CLI under Bun with a faux model; CI job `bun-codemode`.
  Pi 1.4.0 admits codemode scripts through a FIFO wait for a worker slot (`PI_CODEMODE_MAX_WORKERS`, default 2, read
  per call), capped at 60 seconds or the script's remaining deadline, instead of failing at once with "Codemode worker
  limit reached"; the wait counts against the script timeout and each worker has a 256 MB VM limit, so a script
  that waits on slots held by other waiting scripts can still time out. It is not unlimited parallel capacity and does
  not replace the barrier above. Details: `notes/settings-codemode.md`, Limits.
- Measured with codemode on (bench45, T01-T07, 5 runs, the bench44 judge; `~/stock-bench/bench45.csv`): gpt-6.1-sol
  medium quality 99.5 -> 97.4 (90% interval -3.7 to -0.5), seconds 51.1 -> 50.4, calls 40.9 -> 35.7; codemode called
  32 times in 19 of 35 runs, `tool_search` never; most of the loss is one T06 point. gpt-6-sol low never calls
  codemode: 91.9 -> 93.7, within noise. Edit, write and multi-file probes pass on both. Kept on by the owner's
  request; the cost is recorded here.
- On `/reload` the `session_start` handlers of RQW-settings and RQW-tools leave the active set alone: Pi keeps the tools
  the user switched off, and the handlers had added them again.
- GPT Fast: OpenAI priority processing for GPT (Codex CLI maps its Fast to `service_tier` `"priority"`; Pi's openai-codex
  provider sends the request body's `service_tier`, and Pi's cost table bills priority at 2x). Owner: «Так давай временно все
  гпт в fast режиме что бы все саб агенты работали». Owner: «Как мне fast режим включить в нашем Pico? И чтобы он ещё и
  отображался в статус баре, что мы в fast режиме. Есть такая опция? Нет?» Owner, final shape: «Режим Fast должен действовать
  только на основной чат. И по умолчанию он должен передаваться сабогентам. Но если я запрещу исполнителю сабогенты запускать
  в режиме Fast, то он должен этому повиноваться. Так это должно работать», «В CloudCode у нас режима Fast нет, потому что у
  меня нет кредитов, чтобы режим Fast поддерживать в CloudCode. Поэтому наш режим Fast распространяется только на GPT. Можно
  даже называять его GPT Fast.», «Чтобы не было заблуждения, пусть он будет Fast-GPT командой через дефис». Rules:
  - The command is `/fast-gpt [on|off]` (no argument toggles), carried by `extensions/RQW-settings/fast-gpt.ts`. It
    switches the main chat only. Only `openai-codex` requests get `service_tier: "priority"`; Anthropic requests are
    never touched. The state is process-wide (it survives `/reload` and new sessions) and is not persisted across restarts,
    as `/statusbar` is not; there is no settings key. RQW-settings owns the main chat's rule and the command because it is
    the harness-settings extension: a request-level default that holds whatever the user's config says.
  - Default off. Owner: «Все, вырубаю всех в fast режим, пожалуйста, сейчас». Owner: «Блять, Fast должен быть всегда по умолчанию выключенным. Почему ты сделал его включенным по умолчанию? Поправь это, пожалуйста». It is `FAST_GPT_DEFAULT = false` in
    `fast-gpt.ts`; the owner turns it on with `/fast-gpt on`. Deleting the feature is deleting the three `fast-gpt.ts` files and their
    calls, the `fast_gpt` parameter and the lightning.
  - Hook: Pi 1.4.0's `streamSimple` of the openai-codex provider drops `serviceTier` (`buildBaseOptions` forwards a fixed
    list of options), so the stream options cannot carry it. The public `before_provider_request` event (the main chat)
    sets the body's `service_tier`, after checking that the payload's `model` is the session model of provider
    `openai-codex`. Pi's pricing reads the response's `service_tier`, so priority cost is still counted. The WebSocket
    transport (Pi's default `auto` tries it first) sends the same body: pi-ai `dist/api/openai-codex-responses.js` passes the
    `onPayload` result (lines 175-178) to `processWebSocketStream`, which sends `{ type: "response.create", ...body }`
    (line 1211; the cached-continuation frame spreads the body too, lines 1158-1168), so `model` is the bare id and
    `service_tier` is top-level on both transports. The tests drive both: SSE with a replaced `fetch`, WebSocket with a
    fake `globalThis.WebSocket` (the child tests use the default transport, so they run offline).
  - Children (RQW-agent's `agent` subagents, `code_writer`, `shell_runner`; RQW-review's reviewers) inherit the caller's
    GPT Fast state once, when they start, and keep it for their life, including `send` and `restart`; later `/fast-gpt`
    changes do not reach a running child. A nested child inherits from its direct caller. Reviewers inherit the main chat's
    state at their start. `agent`, `code_writer`, `shell_runner` and `review` take an optional boolean `fast_gpt` that overrides the
    inherited state (`false` when the user forbids Fast for subagents; `send` and `restart` of `agent` may change it); a
    null from a strict-mode provider means inherit. Each tool description carries the one sentence "By default children
    inherit GPT Fast; pass fast_gpt false when the user forbids Fast for subagents." Each extension applies the rule to
    its own sessions through its own `fast-gpt.ts` (`extensions/RQW-agent/fast-gpt.ts`, `extensions/RQW-review/fast-gpt.ts`),
    reading the main chat's state at the child's start from RQW-settings over `pi.events` (query channel
    `rqw-settings:fast-gpt-query`, answered synchronously; change channel `rqw-settings:fast-gpt`). This avoids any import
    between extensions (section Isolation); without RQW-settings nobody answers and children stay on the standard tier.
  - Status bar: the main chat's state is shown by the bright yellow lightning, see [Status bar](#status-bar).
  - Proof: `extensions/RQW-settings/test/fast-gpt.test.ts`, `extensions/RQW-agent/test/fast-gpt.test.ts`,
    `extensions/RQW-review/test/fast-gpt.test.ts`, `extensions/RQW-statusbar/test/fast-gpt.test.ts`: the real openai-codex
    and anthropic providers inside real Pi sessions with only `fetch` replaced, so the asserted bodies are what Pi would send.

## Isolation

- Every `RQW-*` extension is self-contained and can be switched on and off alone, like a feature flag (owner:
  «Когда мы делаем эти отдельные модули, они должны быть полностью изолированы, самодостаточны, чтобы мы могли
  включать и выключать, как feature флаги.»). Rules: no file of an extension, tests included, imports a file outside
  its own folder; a helper two extensions need is copied (`selection.ts`, 19 lines); an extension's tests load only
  that extension; tests of several extensions together live in `test/` at the package root (`test/package.test.ts`);
  no extension leaves active behaviour after it is switched off. RQW-context and RQW-mouse deliberately have
  process-wide scope: stock behaviour returns only when the last live owner in that process leaves (sections Context
  and PCLI); switching one off in B does not disable it in an active A.
- Proof: `test/isolation.test.ts` (in `npm test`). The list comes from `package.json` `pi.extensions`, so a new
  extension is covered without a change to the test. Static part: every relative import of every file under
  `extensions/<E>/` resolves inside it. Runtime part, one child process per variant (`test/isolation-run.ts`, real
  `DefaultResourceLoader` and `AgentSession`, a faux 1M model, Pi's `codemode` and `tool_search` as built-in
  factories): for each extension E switched off through the `packages` filter, no load or bind errors and the loaded
  set is all but E; every other extension registers the same tools with the same descriptions as with everything
  on; a model turn with a `read` call completes; switching E off with `/reload` gives the same loaded set, registered
  tools, compaction reserve for a 1M model and session window as a fresh start without it. Before this change it
  failed on the `RQW-settings` import of `../RQW-tools/selection.ts` and on the RQW-context reload trace (550 000
  against 16 384).
- The switch is the object form of the `packages` entry in settings (`INSTALL.md`, "Switch one extension off"):
  `{ "source": "<the same source string>", "extensions": ["-extensions/RQW-<name>/index.ts"] }`. Pi turns an object
  entry into a filter for every source type (`dist/core/package-manager.js:1000-1009` `resolvePackageSources`;
  `collectPackageResources` `:1848-1863` calls `applyPackageFilter` `:1903-1918`, which runs `applyPatterns`
  `:548-591`: includes, `!` excludes, `+` force-includes, `-` force-excludes). An exact `-` pattern is compared with
  the path relative to the package root after a leading `./` is stripped (`normalizeExactPattern` `:496-499`,
  `matchesAnyExactPattern` `:500-519`), so it must name the file: `-extensions/RQW-<name>` (the folder) excludes
  nothing. Docs: `docs/packages.md:94-121`. A git package is identified by its URL without the ref
  (`docs/packages.md:127`), so the `source` stays `git:github.com/ARQAWA/my-pi`. It takes effect after `/reload`
  (`dist/core/agent-session.js:2998-3021` re-reads settings and reloads the resources) or a restart.
- Limits of the switch, all Pi's own. `pi -e <dir>` ignores the filter: `-e` sources are resolved without one
  (`package-manager.js:746-757` `resolveExtensionSources`) and merged with the settings paths
  (`dist/core/resource-loader.js:370-372`, `:409`); for one run without an extension pass the wanted `index.ts` files
  with `-e`, plus `-ne` if the installed copy must not load too (`docs/cli.md:194-197`). Pi's built-in extensions are
  not package resources: they are switched off with `-builtin:<name>` in the top-level `extensions` setting
  (`docs/settings.md:163`, `package-manager.js:736-744`). After `/reload` Pi keeps the active tool set
  (`agent-session.js:3011-3021`, `docs/settings.md:58`), so with RQW-tools or RQW-settings switched off, `grep`/`find`
  or `codemode`/`tool_search` stay active, now the stock ones, until `/new` or a restart.
- Prompt/tools isolation is complete (section Prompt/tools isolation): `SYSTEM.md` no longer describes RQW-tools;
  RQW-tools supplies conditional search and execution sections. The package-level
  `test/prompt-tools-isolation.test.ts` checks tool availability and reload independently of extension-local tests.
  Owner: «Когда мы делаем эти отдельные модули, они должны быть полностью изолированы, самодостаточны, чтобы мы могли
  включать и выключать, как feature флаги.» We accept Pi's native sections to meet that requirement, despite the
  measured change on fixed GPT-6.1-sol medium questions: +0.56 assistant steps, +1.85 s and -3.33 checklist points;
  GPT-6-sol low gained 6.67 checklist points. All 36 edit acceptance checks passed. The medium losses concern Rust
  field-declaration citations rather than wrong values; the variant gained the T06 auth blocker delay. This is not
  behavioral neutrality. Pi puts these sections after cwd, changing instruction position and removing two redundant
  partial-write reminders; preserving their former positions would require extra coupling. Evidence and limits:
  `notes/prompt-isolation-gpt.md`, 72 raw rows in `notes/prompt-isolation-gpt.csv`. The four optional manifesto edits
  remain unadopted and separate (`notes/bench46-gpt.md`).

## Agent

- Native subagent supervision and prompt inputs, F1/F3. Owner request at `2026-10-23T13:01:47.145Z`, session
  `2026-10-21T16-27-59-062Z_01a15f4a-7ad5-7377-81be-0baf3b6ffa33.jsonl`, physical JSONL line 3963:
  «Всё должно быть нативно. Подумай, как можно максимально интеллектуально прокачать этот функционал.»
  Reason: replace manually copied reviewer prompts and polling wrappers with native caller-controlled supervision.
  Engineering contract: `system_file`/`role_file` load exact UTF-8 prompt text relative to the caller's cwd;
  restart re-reads inherited files. Push and wait display details carry matching `prompt_file` provenance with
  the absolute path and SHA-256 of loaded bytes. `include: ["user_messages"]` appends verbatim user-role text
  from the caller's current branch after the task, not root-session text before it. Workers keep fixed configuration.
  `wait` keeps `until: "first"` by default and adds `"all"`; `wake_on_alert` defaults to true for fresh alerts,
  created after wait registration, without consuming results on an alert wake. All-target waits hold early results
  until ready; alert, timeout and caller abort release them to the message path. `status depth` defaults to 0 and
  adds compact read-only descendant snapshots without message previews, never grandchild management.
  All three tools share F1 wait/status and start/restart threshold options; F3 remains general-agent configuration.
  Opt-in `alert_after_ms` is inherited on restart and reports long native turns without stopping them;
  turn end, logical run end and close cancel the timer, so no alert timers remain while idle. Other alerts report errors, repetition, detectable repeated argument
  parsing/schema rejection and existing observed scope blocks. No F5 guards, `stalled_tool`, F2 manifest or F4
  structured-output feature is introduced. Full API contract:
  [RQW-agent README](extensions/RQW-agent/README.md#wait-status-and-management) and
  [prompt files](extensions/RQW-agent/README.md#prompt-files-and-caller-messages).
  Carriers: `extensions/RQW-agent/index.ts`, `prompt-files.ts`, `prompt.ts`, `activity.ts`, `coordinator.ts`,
  `workers.ts`, and that folder's descriptions. Proof: `extensions/RQW-agent/test/prompt-files.test.ts`,
  `test/supervision-activity.test.ts`, `test/supervision-coordinator.test.ts`, `test/supervision.test.ts`.

- Owner (verbatim): «основной агент запускает сабагента — воркера, shellrunner или codewriter. Пока они работают, он его либо ждёт, либо что-то делает параллельно, а потом ждёт. Когда shellrunner или codewriter отвечает, тот обрывает ожидание и дальше работает с его ответом. Если же он не ответил за время ожидания, то основной агент сам идёт и смотрит состояние codewriter или shellrunner, что там происходит, вычитывает его последние пять-десять сообщений и думает, что с ним делать дальше: interrupt его, давать ему какой-то follow-up, либо вырубать, либо перезапускать.»
  «Надо сделать интеллектуально, чтобы основной агент большой, который поднял runner, через время поглядывал за ним, через пять минут проверял статус. Только не тратить токены, а через механический wait.»
  «надо сделать интеллектуальное ожидание. Не пять минут, а чтобы большой агент сам решил, сколько он будет ждать.»
  «Если они работают долго, пусть работают.»
  «А почему стоп мы им делаем? Мы же договорились о том, что мы это сделаем, как в кодексе.»
  «Можно начинать уже и можно продолжать всю работу, которая была до этого начата».
  Reason: the caller, not a watchdog, decides how long to wait and how to manage continuing work. All three tools
  share caller-local `wait`/`status` with mixed direct-child IDs. The caller estimates remaining duration and sets
  timeout_ms somewhat longer on each wait; 300000 is only the omission/null default, not a cadence or maximum.
  The mechanical pause itself spends no tokens and makes no model turns; children continue their own work, and
  the wait call and its result are normal caller context.
  Deadline returns diagnostics without canceling children; status includes the last 5–10 trimmed messages and
  in-flight calls. Results arrive once through wait or the existing message wakeup, with delivery receipts on races.
  No execution/turn/token/output-growth limits or automatic interrupt/stop/restart are introduced. Explicit controls
  retain history on interrupt, fence old generations on restart/stop, and do not block on an uncooperative tool.
  Carriers: `extensions/RQW-agent/index.ts`, `coordinator.ts`, `activity.ts`, descriptions and roles in that folder;
  API, retention cost, implicit fallback and public in-process cancellation limits:
  [RQW-agent README](extensions/RQW-agent/README.md#wait-status-and-management).

- Owner: «Да, давайте мы исполнителям, ревьюерам кэш выключай.» This disables background warming, not prompt
  caching (owner clarification: «Потому что если мы вообще выключим им кэш, то они будут пиздец жрать токенов нахуй.»).
  `extensions/RQW-agent/index.ts` gives every child's in-memory SettingsManager `cacheWarming: "off"`, independent
  of RQW-settings or the main user's mode. Prompt caching stays on. TTL approval (full quote in
  [Anthropic subscription adapter](#anthropic-subscription-adapter)): «Если это замеренная цифра и 5 минут будет заебись в большинстве случаев, то пусть будет 5 минут.»
  Each child's existing guarded stream wrapper sets `cacheRetention: "short"` on Anthropic Messages requests,
  before the adapter's OAuth fallback. This is a built-in 5m policy, not a config knob; other APIs keep their options.
  Reason: median observed resend gap 163s, with one of seven above 5m; a short write costs less than a 1h write.
  Proof: `test/agent.test.ts` and package `test/prompt-cache.test.ts`; evidence: `notes/prompt-cache-policy.md`.
- Children inherit GPT Fast at start and `fast_gpt` overrides it: rule, quotes and carrier in
  [Settings](#settings), «GPT Fast» (`extensions/RQW-agent/fast-gpt.ts`, `index.ts`).
- Subagent parity, like Cursor (owner session 2026-10-23; agreement and Cursor/Codex/our evidence in
  `my-pi-evidence/subagent-parity/`). This entry supersedes the earlier rules below that a subagent's prompt is
  exactly the caller's `system` with no main prompt, and that a subagent has no `agent` tool (maximum depth main ->
  subagent -> worker). Owner (verbatim): «Надо что бы саб агенты были как в куросре посмотри реверз инжинеринг и скажи
  свои предложения».
  - Prompt. Owner: «1 - про как в курсор не понял. я думал саб агент получает тот же систенмный промпт что и основной
    агент ток чуть чуть подрезанный как это в курсоре сделано», then «1а. что бы тонко конфигурировать роль надо
    добавить либо спец поле либо что бы промпт начинался с роли а потом уже сама задача, как то хитро надо сдлеть».
    By default a subagent's prompt is the main agent's system prompt as Pi built it for the main run (read with the
    public `ctx.getSystemPrompt()` of Pi 1.4.0; nothing is imported from RQW-prompt), then a short Cursor-style
    reminder (it is a subagent, it answers its caller, instructions addressed to the main agent or a coordinator do
    not apply to it), then the optional `role`. Coordinator decision (technical): `role` is a separate optional field,
    not parsed from the start of `task`. `system` stays the full override, sent exactly. Nested subagents get the
    main prompt handed down, not their caller's prompt. Reason: the child works under the same rules and project
    context as main, and the caller tunes it with a few words instead of writing a whole prompt.
  - Nesting. Owner: «1а» to "a subagent may start subagents without a level limit, as Codex V2. Workers stay the last
    level. No global limits". General subagents get `agent` recursively; code_writer, shell_runner and explorers are
    leaves; no depth, count or concurrency limit. Reason: a subagent can split its own work the way main does; the
    existing caller-local runtime (delivery to the direct caller, a parent's answer waiting for its pending children,
    interrupt/stop/restart cascading to descendants) already works per level.
  - Coordinator rules. Owner: «Нет нет правила координатора это только для мейна ЭТОГО РЕПОЗИТОРИЯ, это наш локальный
    режим тут в этой репо и он заложен через локальный агентс мд и через вложенные в него ссылки. Т.е. это не будет
    работаь в других репо.» The product gets no coordinator rules: the `agent` description gets only Cursor's generic
    when/when-not usage advice (not for narrow questions, a known file or two or one search; independent areas in
    parallel; full context and the exact return; trust the result; the user does not see it).
  - Child gaps. Owner: «2а (что значит когда ревьюер вернется? типа у нас он один что ли на всю систему?)» to "give
    children codemode and tool_search, workers cwd/date/OS, all children the owner's settings; subagents may call
    review". Every child (subagent, explorer, worker) gets Pi's built-in `codemode` and `tool_search` when its caller
    has them active. General subagents get `review` when RQW-review is loaded, through RQW-review's own `pi.events`
    offer `rqw-review:subagent-review`: each caller has its own reviews and numbering, and the verdict goes to the
    caller that asked. Children run with the caller's session settings: shell path and prefix, image resize and
    blocking, retries and provider timeouts, transport and its timeouts, compaction (reserve, kept tokens, per-model
    overrides), thinking budgets, steering and follow-up modes, codemode mode and budget; warming stays off. The
    reviewer is a child too (result review findings 1 and 2): it gets `codemode` and `tool_search` when its caller has
    them active, and the same settings except the two queue modes (compaction included; the former forced
    `compaction: { enabled: false }` is removed). Workers get cwd, OS and today's date after
    their fixed role. Reason: a child is not weaker than main by accident; the evidence found these gaps without a
    recorded reason (`ours/REPORT.md`).
  - Rest of Codex. Owner: «3а»: durable resume, parent history fork, web search and MCP for children are deferred.
  - Title. Owner: «2а» to an optional short title (3-5 words) shown in status and result headers: `title` on start and
    restart of `agent`, `code_writer` and `shell_runner`. It shows as `title` in `status`, in the wait result's display
    data (`results[i].display.title`) and in the message `details.title`, which the RQW-agent-ui card header shows after
    `<name>#<id>` (branch p5-agent-ui); the delivered content keeps its `[agent#N] ...` format.
  - Explore. Owner: «3 да давай сделаем эксплорера буквально как в курсоре там он как системный + очен коротка роль и он
    запускается на модели родетиля а не на собой модели», then «2а» to "explore = the same system prompt + a very short
    search role + thoroughness level (quick / medium / very thorough), runs on the parent's model, read and search only
    (no edit/write, bash behind the git guard like the reviewer)". Engineering choice: the `explore` option of `agent`
    `start` (not a fourth tool): one field reuses the agent runtime and adds no tool declaration to every request.
  Carriers: `extensions/RQW-agent/index.ts`, `prompt.ts`, `workers.ts`; `extensions/RQW-review/index.ts`. Details:
  [RQW-agent README](extensions/RQW-agent/README.md#prompt-kinds-and-title),
  [RQW-review README](extensions/RQW-review/README.md#review-in-subagents). Proof: `extensions/RQW-agent/test/agent.test.ts`
  ("subagent parity"), `test/workers.test.ts`, `test/nested-workers.test.ts`, `test/cli.test.ts`,
  `extensions/RQW-review/test/subagent.test.ts`.
- A general subagent for the main agent, the one the Scope section names as a separate task. The owner's words: «должна
  быть опция поднимать любых рандомных саб-агентов, которые являются саб-потоком основного агента. Можно за базу взять
  агента General Purpose из курсора и его воспроизвести»; «этот кастомный саб-агент, абстрактный саб-агент, должен
  подниматься без системного промпта, чтобы основной агент передавал ему весь системный промпт. Полностью промптил его
  от начала до конца»; «Чтобы он мог ему ставить задачу, прерывать, выключать, перезапускать. Он мог ему посылать
  сообщение follow-up»; «чтобы основной агент тратил минимум токенов»; «все решения должны быть максимально простые ...
  без оверенджинеринга»; «всё должно быть доказано». Carried by `extensions/RQW-agent/index.ts`. The prompt part
  («без системного промпта ... весь системный промпт») is superseded by the parity entry above: the whole prompt is
  now the optional `system` override, and the default is the main prompt with the reminder and `role`.
- One tool `agent` with `action` `start`, `wait`, `status`, `send`, `interrupt`, `stop`, `restart` and the fields
  `ids`, `timeout_ms`, `until`, `wake_on_alert`, `messages`, `depth` (wait/status above),
  `id`, `system`, `role`, `system_file`, `role_file`, `include`, `alert_after_ms` (native F1/F3 entry above),
  `title`, `explore` (parity entry above), `task`,
  `model` (`provider/id`), `thinking` (Pi's levels `off` to `max`), `tools` (a subset of `read`, `bash`, `edit`,
  `write`, `grep`, `find`). This selects base tools; delegation tools follow [Workers](#workers).
  The schema passes Pi's `makeStrictJsonSchema`; `null` in an optional field counts as omitted.
- In process, no spawn (Windows-safe): `createAgentSession` with `SessionManager.inMemory`, `SettingsManager.inMemory`,
  and `DefaultResourceLoader` with `noExtensions`, `noSkills`, `noPromptTemplates`, `noThemes`, `noContextFiles`; cwd
  is the main session's `ctx.cwd`. No extension, skill or context file is loaded into the subagent; by default the main
  prompt (with RQW-prompt's text and AGENTS.md when main has them) reaches it as text through `ctx.getSystemPrompt()`.
- The system prompt, `system` when given or the default of the parity entry above, is sent exactly. Pi appends `<cwd>` and other sections to every custom prompt
  (`buildSystemPromptSections` in Pi's `dist/core/system-prompt.js`); only a forced prompt goes out as it is. So the
  loader carries an inline `before_agent_start` handler returning `{ systemPrompt: system }`. Only our inline
  runtime hooks and the [worker tools](#workers) are loaded, not external extensions. A test checks that the request
  has one system message equal to `system`, and another that the default is the main prompt plus the reminder.
- The model runtime is the main session's, taken from `ctx.modelRegistry.runtime`, a plain field that is private only
  in the TypeScript types. Reason: one credential store and one OAuth refresh (risk 1 of
  `/tmp/pi-subagent-eval/report.md`), and providers that extensions register also serve the subagent, such as the
  `anthropic` overlay of the installed `pi-claude-auth`. If Pi renames the field, `start` fails and the tests show it.
- Defaults follow Cursor's generalPurpose: all tools, the main model ("inherit") (Cursor transcript 704ada44 in
  `cursor-like-harness/kb/sources/cursor-reverse-extra`). Here: the main session's model and thinking level, all six
  base tools, `agent` and the [worker tools](#workers). The earlier "no subagents of its own" default is superseded by
  the owner's «1а» (parity entry above).
- No imports across extension folders: `extensions/RQW-agent/` loads and works with every other RQW-* switched off or
  absent, and switching RQW-tools off switches it off for subagents too (owner: «Когда мы делаем эти отдельные модули,
  они должны быть полностью изолированы, самодостаточны, чтобы мы могли включать и выключать, как feature флаги»;
  review G: the earlier `import rqwTools from "../RQW-tools/index.ts"` failed to load without that folder and gave
  subagents RQW-tools with RQW-tools off).
- Subagent tools follow the RQW-tools switch through a loose, optional handshake on Pi's shared event bus `pi.events`
  (`docs/extensions.md` line 87: "Communicate with another extension | `pi.events`"; `events: EventBus` in
  `dist/core/extensions/types.d.ts` line 1406; one bus per resource loader for all its extensions,
  `dist/core/resource-loader.js` lines 248 and 511). At every `start` and `restart` RQW-agent emits
  `rqw-tools:subagent-tools` with `{ offer(factory) }`. RQW-tools, when loaded, answers with `createTools`, a
  `(cwd, settings) => ToolDefinition[]` that builds the six tools with a barrier of their own; RQW-agent calls it with
  the main `ctx.cwd` and the main session's `pi.getSettings`, and passes the result as `customTools` with the `tools`
  allowlist. The answer is there when `emit` returns: the bus is a Node `EventEmitter`, and its wrapper calls the
  handler before its first `await` (`dist/core/event-bus.js` lines 4-18). Pi drops the handler of a stale instance on
  reload and dispose (`invalidate` in `dist/core/extensions/loader.js` lines 141-150, called from
  `dist/core/agent-session.js` lines 1007 and 2973). With no answer `customTools` is empty and Pi builds its stock
  tools. Reason: stock tools lose the barrier and multi-file `edit`/`write`, so with RQW-tools on the subagents keep
  them, and with it off they must not. RQW-tools works the same without RQW-agent.
- The subagent's `SettingsManager.inMemory` carries the caller's `shellPath`, `shellCommandPrefix` and
  `images.autoResize`, the three settings Pi builds stock read and bash from (`_buildRuntime` in
  `dist/core/agent-session.js` lines 2935-2946), so Git Bash on Windows applies to stock bash too, plus the other
  session settings of the parity entry above (`childSettings` in `index.ts`). RQW-tools definitions read the main
  session's settings per call instead.
- Results are async. At the end of each run the direct caller gets the text through wait or `[agent#N] <text>`
  through `pi.sendMessage`, once, as the wait decision above specifies. The
  text is every final answer of the run, so a follow-up queued during the run does not hide the first answer (the brief
  said "last assistant text"). Native runs awaiting worker results are intermediate, not final; see [Workers](#workers). The text also carries every final error of the run as `error: <reason>`, in order with
  the answers: a failed follow-up does not hide the first answer (`[agent#1] FIRST ANSWER\n\nerror: bad request`,
  review C), and a first task that fails for good does not vanish when Pi then runs a queued follow-up that succeeds
  (`[agent#1] error: bad request: first task\n\nSECOND ANSWER`, review D). An attempt that Pi repeats is not a result. Pi
  repeats a request on two paths and emits an event only when it does: `auto_retry_start` for a retryable error
  (`_prepareRetry` in Pi's `agent-session.js`), and `compaction_end` with `willRetry: true` for a context overflow error
  or a recoverable `length` stop (`_checkCompaction`, review E). Either event removes the error or partial text of the
  last assistant message, and only when that message added one: a `length` stop with no text adds nothing, so an
  earlier answer stays. Threshold compaction has `willRetry: false` and removes nothing. Bad calls (unknown
  id or model, no credentials, missing `system` or `task`) fail at once as a tool error, which costs less than a later
  message. Credentials are checked as Pi's prompt checks them: the registry's auth snapshot, then
  `runtime.checkAuth(provider)`, because the snapshot fills asynchronously and alone rejected valid models.
- Delivery never loses a result to an abort of the main agent (review finding: a follow-up waits in the main agent's
  queue, which TUI Esc clears through `clearQueue()` and RPC `abort` leaves without a turn). When the main session is
  idle (`ctx.isIdle()`), the message goes with `triggerTurn: true` and starts a turn. When it is busy, it goes with
  `triggerTurn: false`: Pi holds it outside the queue and appends it to the session at the end of the current turn or
  run, aborted or not (`sendCustomMessage`, `_flushPendingCustomMessages` in Pi's `agent-session.js`), and the
  `agent_before_settle` handler returns `continue: true` while such a result is not yet followed by an assistant
  message in the branch (tracked by a delivery id in `details`, a `randomUUID()` that no other extension instance or
  process repeats: a counter restarted at 1 after `/reload`, `/resume`, `/fork` or `pi -c` and matched an old,
  answered entry of the same session, so the new result got no turn; review B). After an abort no turn starts, since
  Esc means stop; the result stays in the session and the model sees it on the next turn. Re-sending after an abort, the first
  idea, was dropped: after an RPC abort the old copy stays queued and would arrive a second time with an extra turn.
  Pi runs every extension's `agent_before_settle` handler in a row before it settles, so a result can come in after
  ours returned, for example while another extension's slow async handler runs after ours; held with
  `triggerTurn: false`, it would get no turn (review C). So our handler sets a `settling` flag when it lets the run
  stop, `turn_start` and `agent_settled` clear it, and `deliver` keeps results sent while it is set; the
  `agent_settled` handler sends them. Pi defers every `triggerTurn: true` call separately and runs one full turn for
  each, so only the last held result goes with `triggerTurn: !event.aborted`; the earlier ones go with
  `triggerTurn: false`, which Pi appends at once since the run is no longer active, and the one deferred turn sees all
  of them (review D: two results gave two main turns).
  Rare case: a result that arrives during a manual `/compact` with no run is appended without a turn and is seen on
  the next one.
- Ids `agent#N` never repeat within a session. Every extension instance (`/reload`, `/resume`, `/fork`, `pi -c`) starts
  its counter on `session_start` above the highest `agent#N` in the session's `[agent#N]` messages and `agent` tool
  results, so a new subagent in a continued session gets `agent#2`, not a second `agent#1` whose result would read as
  the old task's and to which a `send agent#1` meant for the old, killed subagent would go (review D).
- No execution timeout of our own: Pi's provider timeouts and retries apply, and the caller can interrupt.
  Caller-chosen wait deadlines return control/diagnostics, not a child cancellation (wait decision above).
- `send` to a running subagent (and to a running `code_writer` / `shell_runner`) is Pi steering, `session.steer`; to
  an idle one it starts a new run with the history. Coordinator proposal, accepted by the owner with «Да»: «сообщение
  работающему субагенту будет доходить после его текущего вызова инструмента, а не после всей его работы, как в
  основном чате». Reason: the earlier `session.followUp` waited for the child's whole run, and `interrupt` was the only
  faster way, which aborts the in-flight tool calls and workers. Pi 1.4.0 delivers a steering message after the
  current assistant turn has executed its tool calls (all calls of that turn) and before the next model request, with
  no abort; a message sent before the first request goes into that request. Result text: `agent#N: queued after the
  current tool call`; a child that is native-idle and waiting only for its own workers is woken at once (reply `agent#N: sent`, code review finding). Carriers: `extensions/RQW-agent/index.ts` (`send`; the run loop also drains steering that missed
  the last poll), the tool descriptions, `extensions/RQW-agent/test/steer.test.ts`.
  Interrupt and redirect in one call, like Cursor's Subagent `interrupt:true`; owner: «4 пункт мне нравится»: `send`
  takes an optional boolean `interrupt` (agent, code_writer, shell_runner). On a running child it drops the queued
  steering and follow-ups, aborts the current turn exactly like `interrupt` (same code path; session and history kept),
  returns at once with the reply `<name>#N: interrupted, sent`. No time limit, by the owner's rule of no hard limits for agents (this entry: no execution
  timeout of our own; coordinator relayed it as the reason for this change): the task is recorded as the child's next run and starts, once, when
  the old run has stopped; a tool ignoring the abort signal just delays it and `status` shows `pending_sends`. Until then
  the child counts as running, so `wait` never reports `idle` and ends with `target_changed` at the new run; a native run
  woken by a worker result is waited out before the new prompt (code review findings: a premature `idle`, and Pi's
  "Agent is already processing" losing the sends). A later
  `send` before the start is appended in order (one prompt); `interrupt`, `stop` and `restart` drop pending tasks. On
  an idle child it is a plain send; without the flag behavior is unchanged. Carriers:
  `index.ts` (`requestInterrupt`, `Agent.next`), the schema and descriptions, `test/steer.test.ts`,
  `test/nested-workers.test.ts`.
  `interrupt` requests `session.abort()`, drops queued steering and follow-ups, sends no result message and keeps history.
  It returns the pre-interrupt snapshot and cancellation-requested state without waiting indefinitely; a plain send is rejected
  while cancellation remains pending, unless an interrupting `send` is already waiting (then it is appended).
  `stop` disposes the session and forgets the id. Closing a session (`stop`, `restart`, `session_shutdown`) clears its
  queue before `dispose()`: `dispose()` aborts without Pi's abort flag, so Pi would run a queued follow-up on the
  disposed session and bill a request after `stopped`. `restart` disposes and creates a fresh session with the same
  `system`, model, thinking and tools or the ones given, and runs `task` if given.
- Management registration across the three tools runs in call order; wait releases the queue after subscription,
  before its Promise settles. Pi runs the calls of one response in parallel, and a batch of
  `start` and `send agent#1` failed without this (checked by removing it). `start`, `send` to an idle subagent and
  `restart` with a task return only once Pi has started the run, through the `preflightResult` callback of
  `session.prompt` (or once the run has ended). Before that Pi's async preflight runs with no active run, so an
  `interrupt`, `stop` or `restart` next in the same batch aborted nothing: the request still went out and `interrupt`
  waited for the whole run (review E).
- `start`, `send` and `restart` also return at Pi's `compaction_start`: Pi's run is active from there, and a pre-run
  compaction of a large history (for example after an interrupt) would otherwise hold the main agent, an `interrupt`
  behind it and Esc for a whole summary request. Closing a session (`stop`, `restart`, `session_shutdown`) calls
  `abort()` and disposes only after it: `dispose()` alone sets no abort flag, so Pi went on from an aborted pre-run
  compaction to a request from the disposed session (review F).
- Print/JSON use one caller-wide non-consuming fallback wait in `agent_end`, with the omission default. A result
  follows normal message continuation; deadline returns compact status to the caller for its decision, not a stop.
  Native-idle subagents use the same bounded fallback for their workers without forwarding intermediate answers.
  Explicit waits take priority. TUI/RPC idle callers retain push wakeups. Carrier: `coordinator.ts` and `index.ts`.
- `session_shutdown` aborts and disposes every subagent without messages. No cap on the count.
- Accepted limits: a result that arrives after the main session ended is lost; a subagent may read files the main agent
  is editing; subagents share the process with the TUI.
- `RQW-context` patches Pi classes for the whole process, so a subagent gets the owner's universal window rule like
  every model: its window is capped at 500 000 and its compaction reserve is 10% of that window. Checked in review: a
  subagent on a 1 000 000 model sends its request with window 500 000 when RQW-context is loaded.
- Proof: `extensions/RQW-agent/test/agent.test.ts`, faux-provider tests (a copy of the RQW-agent folder in a
  folder with no other extension loads and delivers, and the source has no `../` import; without RQW-tools the
  subagent's `write` is the stock one, no `files`; exact system prompt, model,
  thinking, tool subset, management actions, steering while running (`steer.test.ts`: a held tool call, `send` during it, the message in the next request after the tool result, nothing aborted), the main turn, shutdown, errors, call order, print
  mode; one request only after `stop`, `restart` or `session_shutdown` with a queued follow-up; a result arriving
  while the main agent streams continues its run once; after TUI Esc and after RPC abort the result is in the session
  once, no run starts, and the next prompt carries it once; in a continued session that already holds an `[agent#1]`
  result, a new result while busy still continues the run once, in TUI and print mode; a queued follow-up that fails
  delivers the first answer and the error in one message; a first task that fails for good with a queued follow-up that
  succeeds delivers the error and the answer in one message; an error that Pi retries is not delivered; neither is an
  overflow error nor a truncated `length` answer that Pi compacts and retries; `interrupt`, `stop` and `restart` right
  after `start` in one batch return at once and leave no subagent request; two results
  that arrive while a second extension's slow `agent_before_settle` handler, loaded after RQW-agent, runs get one main
  turn that sees both; in a continued session a new subagent gets `agent#2`; after an interrupt above the threshold `send` returns within 100 ms and `interrupt`, `stop`, `restart` or `session_shutdown` right after it send no summary request, and `stop`, `restart` or `session_shutdown` during that summary abort it and send nothing more). Each test passes alone. With
  an empty extension the original 13 fail; without the queue clearing, the delivery change or the `continue` the new
  tests fail; with a per-instance delivery counter the two continued-session tests fail; on 6b2cfb5 the two review C tests fail; on ff8781b
  the four tests changed or added for review D fail except the retried-error one, which fails without the
  `auto_retry_start` line; on 8344d2e the two review E tests fail. On 0789ab1 the seven review F tests fail; with only the `compaction_start` line six of them fail. On
  40574b5 the folder and stock-tools tests fail; with no offer from RQW-tools the RQW-tools test fails, and so it does
  when RQW-tools offers its main definitions with the main barrier. The mandatory package integration in `test/agent-tools.test.ts` checks `write.files[]` and a
  separate subagent barrier while the main barrier is held; after filtering RQW-tools out and reloading,
  new subagents get stock write. It has no missing-folder skip; extension-local tests load only RQW-agent. Live runs
  in a fixture repository with `pi -e <repo> --model anthropic/<model> --thinking low --mode json -p <prompt>`:
  Haiku 5.5 started a subagent with its own prompt, read a file and answered a follow-up (`[agent#1] ZED: 3`,
  `[agent#1] ZED: alpha`); Haiku 5.5 queued a follow-up, interrupted a `sleep 40`, restarted
  (`[agent#1] W: RESTARTED`, 11 s, no `sleep` left); Opus 5.5 ran two subagents, one with an inherited model, and got
  the queued follow-up in the same message (`[agent#1] W: ... first ... W: ... second`,
  `[agent#2] Q: The bug is in add ...`).

## Workers

- Owner: «Я хочу сделать такие два саб-агента сейчас для моего My Pi. ... чтобы и основной агент мог вызывать этих
  саб-агентов для этих задач, и саб-агенты могли их тоже вызывать. Чтобы были вложенные саб-агенты, чтобы, допустим,
  саб-агент Opus или саб-агент Sonnet мог вызвать CodeWriter либо ShellRunner, которые будут выполнять шумную
  механическую работу, которая токены утилизирует.» The final answer goes «тому агенту, который его вызвал».
  Reason: the deciding agent at either caller level can delegate mechanical work without routing raw worker reports
  through main. `extensions/RQW-agent/index.ts` binds workers to the direct caller's API, at every level of the
  recursive subagent tree ([Agent](#agent), parity entry: subagents now have `agent` too), and no delegation tools in
  workers. It keeps the subagent's logical assignment open across worker
  wakeups, withholding intermediate answers until no workers or unconsumed results remain. Carrier: `index.ts` and
  `workers.ts` in that folder; proof: `test/nested-workers.test.ts` and the worker-only declarations checked by
  `test/cli-provider.ts` through `test/cli.test.ts`. Current lifecycle and cancellation rules:
  [RQW-agent README, Workers](extensions/RQW-agent/README.md#runtime-and-delivery).
- Owner: «И каждый раз, когда ты даешь ему новое задание, сбрасываешь ему контекстное окно».
  Reason: new assignments must not inherit unrelated tasks or old worker answers. `{task}`/`start` creates a fresh
  in-process session. Explicit `send` is a follow-up to the same assignment, not a new assignment; see the later
  owner-approved [wait and management decision](#agent). Completed workers remain idle until stop/caller shutdown;
  retained history consumes memory and send input/cache/compaction costs. Idle retention never counts as pending. Role prompts (followed by the
  working directory, OS and date block of the [Agent](#agent) parity entry), descriptions and
  tool allowlists are fixed in `extensions/RQW-agent/workers.ts`, `roles/` and `descriptions/`; model/reasoning is
  fixed in `worker-model.ts` in that folder.
- Owner: «Например, чтобы агент Main не использовал кодрайтер в той ситуации, где бриф будет длиннее, чем написать код
  самостоятельно.»; «Идея в том, что саб-агент ускоряет main-агента. Main-агент должен доверять саб-агенту.»
  Reason: delegation must accelerate the caller rather than create briefing and repeated-work overhead. Caller
  descriptions require complete decided briefs, trusting results, no busy polling and parallel calls only when
  independent, never two code_writers on the same file. Carriers:
  `extensions/RQW-agent/descriptions/code_writer.md` and `descriptions/shell_runner.md` in that folder.
- D2: code_writer has bash and may run a focused check of its own change. Owner's scope:
  «только код. не документацию, не промпты, а только код и какие-то конфиги. и всё».
  Reason: checking the decided code/config change belongs with its mechanical execution, but documentation,
  prompts and product decisions do not. RQW-tools' existing [ordered barrier](#tools) orders edits and checks when
  loaded; without an offer, workers use stock tools, as [Agent](#agent) describes. Carriers:
  `extensions/RQW-agent/roles/code_writer.md`, `workers.ts` and `index.ts`; shell_runner's exact-command/no-fixes
  contract and report format are carried by `roles/shell_runner.md` in that folder. Briefs, reports and tool sets:
  [RQW-agent README](extensions/RQW-agent/README.md#briefs-and-reports).
- D3: neither worker changes git state; supported read-only git queries are allowed. Reason: commits, staging,
  branches, merges and pushes belong to the caller and [PROCESS.md](PROCESS.md); such a command is shorter than
  a brief, and a cheap low-reasoning model must not own destructive git commands. Enforcement is code, not just
  role text: `extensions/RQW-agent/workers.ts` installs `git-guard.ts` in each worker's `tool_call` hook before bash
  executes. The syntax guard blocks obvious launcher/config-injection bypasses without rejecting ordinary
  listings; it is not a sandbox. Supported queries, execution-override rules and limits have one description:
  [RQW-agent README, Git guard](extensions/RQW-agent/README.md#git-guard).
  Proof: `extensions/RQW-agent/test/git-guard.test.ts` and `test/workers.test.ts` in that folder.
- D1: `anthropic/claude-haiku-5-5` is primary; `openai-codex/gpt-6-luna` is the credential fallback. If neither
  is available with credentials, the call fails with a clear error. Missing candidates and rejected provider auth
  checks do not disable the remaining fallback. Owner:
  «Я бы хотел, чтобы мы прогнали этих малышей на каких-то нижних reasoning. Например, Haiku 5.5 medium либо low и
  GPT-6 Luna medium либо low. Для нас предпочтительно утилизировать шумную работу внутри Haiku и внутри Luna, потому
  что они полностью бесплатны для наших подписок. ... Я бы хотел это сделать для обоих моделей, но надо сделать
  честные замеры.»; «Протестировали этих workers с max reasoning — полная хуета.»
  Reason: put noisy work on the preferred subscription models at measured lower reasoning, rather than inheriting
  the caller's expensive model/level or assuming max is better. Carrier: `extensions/RQW-agent/worker-model.ts`;
  proof: `test/worker-model.test.ts` and `test/workers.test.ts` in that folder.
- B4: only levels meeting the owner's bar independently on tuning and holdout qualify. Owner:
  «Даже 4% не было ошибок»; «Поставь 95, хоть помягче
  чуть-чуть». The bar is 95%, not lowered by the coordinator. Low is chosen when it qualifies, its combined
  tuning/holdout pass rate is not below medium's and its judge mean is at most 0.5 below medium's; otherwise use
  qualifying medium. Reason: lower reasoning must retain reliable execution and report quality. Owner on honest
  repeated measurements: «замеры можно делать бесконечно, потому что хайку и Luna бесплатные».
  If neither low nor medium qualifies, the owner chooses the trade-off rather than the coordinator raising the
  level or lowering the bar: «Гораздо проще, если там будет высокий процент успеха, допустим,
  70-80, то пусть лучше он в один проход напишет большую часть, потом его основной агент подправит. Чем
  он будет сидеть по пять минут писать код».
  Source: [workers benchmark, Results and B4](notes/workers-bench.md#b4-chosen-levels), saved log
  `logs/b3-final-3models-summary.md` under the benchmark directory named in that report. Each pair below is
  low vs medium; judge means cover all runs.

  | Model | Role | Tuning pass: low vs medium | Holdout pass: low vs medium | Judge mean: low vs medium | Chosen |
  | --- | --- | --- | --- | --- | --- |
  | anthropic/claude-haiku-5-5 | code_writer | 75/75 vs 75/75 | 50/50 vs 50/50 | 9.7 vs 9.7 | low |
  | anthropic/claude-haiku-5-5 | shell_runner | 75/75 vs 75/75 | 50/50 vs 50/50 | 9.6 vs 9.6 | low |
  | openai-codex/gpt-6-luna | code_writer | 75/75 vs 75/75 | 50/50 vs 49/50 | 9.9 vs 9.8 | low |
  | openai-codex/gpt-6-luna | shell_runner | 72/75 vs 75/75 | 49/50 vs 50/50 | 9.5 vs 9.6 | medium |

  GPT-6 Luna shell_runner low qualifies but loses to medium on pass rate, so medium is selected. The separately
  measured GPT-5.6 Luna is not in this model chain and is not used. Its code_writer met the bar at no level:
  holdout pass rates were 84.0%, 82.0%, 86.0% and 92.0% for low, medium, high and xhigh, with runaway writes hitting
  the 15-minute cut. Those measurements do not add a model or change the accepted primary/fallback chain.
  Carrier: `extensions/RQW-agent/worker-model.ts` (`WORKER_REASONING`); proof is shared with D1 above.
- Engineering choice: worker profiles parameterize the existing session runtime in `extensions/RQW-agent/index.ts`,
  rather than copying id allocation/persistence, cancellation, delivery and late-after-abort rules. `workers.ts`
  groups caller-local handles; completed sessions are retained for explicit follow-ups and caller shutdown closes
  active and retained workers, as the owner's [Agent wait decision](#agent) requires.
  Reason: keep one lifecycle implementation and prevent worker results from leaking into another caller's session.
  Offline proof: `extensions/RQW-agent/test/workers.test.ts`; [Isolation](#isolation) remains covered by
  `test/isolation.test.ts` and the extension-local standalone import scan. No other extension is imported.

## Review

- Owner (verbatim): «Он не должен быть супердушным, супердотошным, проверять на 1000%, быть перфекционистом. Он должен просто контролировать качество работы: всё сделано качественно, всё сделано, что было заказано, ничего лишнего не было сделано.»
  «никакой экономии нахуй. Агент должен делать столько, сколько ему необходимо, чтобы достичь качественного результата, качественной оценки, качественной проверки. Никаких не должно быть экономических ограничений.»
  «У него не должно быть ограничения по tool call, по инструментам, по прочему. Он должен работать в рамках того, как работают все большие агенты. У него должен быть тот же самый инструментарий»
  «Прямо в рабочей папке, в которой работает основной агент.»
  «для кода он запускает тесты, не запускает сам код для обычного кода, а для автотестов он не запускает автотесты... сам результат работы он не запускает»
  «Давай пойдем коротким путем... Сначала сделаем нового ревьюера, потом уже будем дальше двигаться.»
  Reason: judge quality, completeness and absence of unagreed additions, not perfectionism; read and check as much
  as needed without economy or a tool-call budget. Carrier: `extensions/RQW-review/REVIEWER.md`, replaced with
  the supplied `/Users/arkadijcukavin/ai-project/my-pi-evidence/real-bench/prompts/REVIEWER-DEEP.md` verbatim.
  Both levels share it; `LEVELS` models/thinking, disputes and verdict handling stay unchanged. The accepted
  coordinator proposal supplies `read`, `bash`, `grep`, `find`, without `edit` or `write`; tool sourcing and limits
  are specified below. Engineering decision requested in the task: retain the existing hang guard and raise
  `TIMEOUT_MS` from 10 to 30 minutes for deeper reading and repository tests. This is hang protection, not an
  economic budget; replacing hang protection is a separate later task. No new live model quality claim is made.

- Owner: «Да, давайте мы исполнителям, ревьюерам кэш выключай.» `extensions/RQW-review/index.ts` sets
  `cacheWarming: "off"` in each reviewer's in-memory SettingsManager, independently of RQW-settings and the main
  user's mode. Prompt caching stays on. TTL approval (full quote in
  [Anthropic subscription adapter](#anthropic-subscription-adapter)): «Если это замеренная цифра и 5 минут будет заебись в большинстве случаев, то пусть будет 5 минут.»
  Each reviewer's existing guarded stream wrapper sets `cacheRetention: "short"` on Anthropic Messages requests
  before the adapter's OAuth fallback, a built-in 5m policy with no config knob. Other APIs are unchanged.
  Reason: measured review duration median 30.9s, maximum 178s, so buying 1h writes is usually unnecessary.
  Proof: `test/review.test.ts` and package `test/prompt-cache.test.ts`; evidence: `notes/prompt-cache-policy.md`.
- A reviewer inherits the main chat's GPT Fast state when it starts: rule, quotes and carrier in
  [Settings](#settings), «GPT Fast» (`extensions/RQW-review/fast-gpt.ts`, `index.ts`); the optional `fast_gpt` of the
  `review` tool overrides it for that reviewer.
- Prompt adaptation is now tuned on GPT with the measured v3, the base of
  `extensions/RQW-review/REVIEWER.md`; the dispute paragraph and the DISPUTE, RULING and ANSWER fields were added on
  top of it by the pair contract below and are not part of that measurement (request summary, not a literal quote: flexible reviewer conditions C:2913;
  team synergy only in the plugin C:3046; finish the prompt on GPT C:3400). The criterion governs scope, including custom requirements outside the agreement and
  exclusions; REQUIREMENT may quote the criterion with its source. Main and reviewer remain a pair through the
  plugin's `DESCRIPTION` and `NEXT` in `index.ts`, not `SYSTEM.md`. The reviewer checks independently, quotes exact
  file content and does not turn general test requests into invented coverage requirements. Reason: the measured
  candidate improves scope/flexibility and quote/format handling with zero audited false findings on the final GPT
  comparison; this is not a claim of universal recall improvement. Paired GPT-6.1 recall 87/90 -> 87/90, GPT-6
  87/90 -> 86/90; GPT-6 false findings after audit 6 -> 0, final 0 on both; mean seconds 7.9 -> 9.2 and
  10.8 -> 12.3. Only 12 cases x 3 runs per model, four GPT-held-out cases, no new Claude probes; details and limits
  in `notes/reviewer-prompt-gpt.md`. These are earlier prompt measurements, not proof for the deep prompt/tool
  combination above. Verdict handling stays unchanged; reviewer models are the family table below.

- `extensions/RQW-review/` is the accepted reviewers plan (user: «То, что ты предложил по ревьюерам — it's OK, я
  принимаю»): one tool `review` with `level` `blind` or `high` (user: «Smart не нужен ... будет Blind и High»), held
  to the existing contract and nothing more (user: «эти три саб-агента должны быть забиты за тем контрактом, который
  есть, и всё»).
- Models live in one table, `LEVELS` at the top of `index.ts`, by the family of the main agent's model (a one-line
  change per model or thinking level). Claude main: `blind` is `anthropic/claude-haiku-5-5` with thinking medium,
  `high` is `anthropic/claude-sonnet-5-5` with thinking low (the Claude `high` slot is being re-measured, Haiku
  high and xhigh against Sonnet low, and may change; it is not changed here). GPT main: `blind` is
  `openai-codex/gpt-5.6-luna` with thinking medium, `high` is `openai-codex/gpt-5.6-luna` with thinking high. The
  family comes from `ctx.model` (provider `anthropic` or a `claude*` id: Claude; provider `openai` or `openai-codex`
  or a `gpt-*` id: GPT); a main model of neither family, or none, starts with the Claude table. Owner (earlier,
  replaced here): «Ревьюеры будут только на этих двух моделях». Owner, 2026-10-22, answering the coordinator's three
  questions (model by family, unagreed additions, tolerant extraction) with: «2а 3а». The first question got no
  answer, so its recommended option 1a applies: reviewer model by the main agent's family. Owner, 2026-10-22, on
  the GPT row: «Давай тогда сделаем, что на blind review будет Luna Medium. На high review будет Luna High. Да»
  (after «и потом будем думать» while more probes ran; the earlier placeholder, GPT-6.1-Sol low and medium, is
  gone). Reason, from the gpt-match probes (`notes/reviewer-probes.md`, section "GPT match for the Claude slots"):
  GPT-5.6-Luna medium matches Haiku 5.5 medium (recall 94.1% against 95.6%, 164 of 165 dispute items right for
  both, 12.6 s and 0.0027 USD per pass against 14.4 s and 0.0022) and GPT-5.6-Luna high matches Sonnet 5.5 low
  (recall 96.3% against 96.7%, 165 of 165 against 154 with the strict reply parse, 0.0043 USD against 0.0226, but
  20.8 s against 6.7 s and 31 of 33 clean cases against 33); GPT-6-Luna is unusable. Limits: 17 false findings for
  Luna high against 15 for Sonnet low, 10 for Luna medium against 1 for Haiku medium; one run set per cell, so
  one- or two-item differences are noise. Fallback: when the family's reviewer has no model or its provider has no
  credentials, the other family's reviewer of the same level is used; the failure `[review#N] Review failed:
  <reason>` names both reasons when neither can start. A failed request or no verdict in 30 minutes gives
  `Review failed: <reason>` with no automatic second attempt. `details` of the verdict carry the model that actually ran.
  Also one login and rate limit per family. Proof: `extensions/RQW-review/test/review.test.ts` ("the family table",
  "GPT main, blind", "GPT main, high", the two fallback tests and the two failure tests).
- Parameters: `level`, `object` (paths, the diff as a file path, the stage), `criterion`, optional `agreement`
  (accepted proposals and decisions that are not in the user's own messages), optional `rebuttals` (see the
  dispute rule below) and optional boolean `fast_gpt` (GPT Fast of this reviewer, see [Settings](#settings), «GPT Fast»).
  The description is limited to 600 characters by its test: 500, and 100 for the one GPT Fast sentence. Empty strings and a
  null or empty `rebuttals` and a null `fast_gpt` count as not given, since strict mode fills every field.
- The main agent and the reviewer work as a pair, one team for the user's agreement (owner, 2026-10-09: «чтобы они
  действовали в одной команде ... либо принимает правку, либо её отклоняет и пишет, почему»; 2026-10-20: «он с ним
  действует в унисон, в паре ... их синергия должна идти в рамках плагина. Это не должно размазываться»). The reviewer
  side is `REVIEWER.md` ("on Main's team"). The main side lives in three carriers of `index.ts`, each paid only where
  it is needed:
  - `DESCRIPTION` (every request while the plugin is on): who the reviewer is, "works with you as one team for the
    user's agreement", and how to call it; the handling rules left it.
  - the tool result, `startedText`: `review#N started. Keep working, but leave the reviewed files unchanged until its
    verdict.`
  - the verdict wrapper, `verdictMessage`: `[review#N]` first, the verdict verbatim, then one paragraph of `NEXT` by
    kind. `clean` (the trimmed verdict is exactly `CLEAN` after a normal `stop`): passed, no further pass for confidence.
    A `length`, `error`, `aborted` or other non-normal final stop is a failed review, never a pass.
    `incomplete` (anything that is not exactly `CLEAN` and not a complete findings verdict: `CLEAN` with extra text,
    prose before `CLEAN`, `FINDINGS:` with text on its header line, a `FINDING` block with a required field missing
    or empty, any other text): resolve UNCHECKED or retry malformed output, never claim passed or treat it as
    findings; it creates no finding id and answers no dispute. `findings` (the header is a line that is exactly
    `FINDINGS:`, then at least one `FINDING n` block, every block with REQUIREMENT, MISMATCH, EVIDENCE and REQUIRED
    OUTCOME filled; one structural check in `findingBlocks`, used by `kindOf` and `settle`): find each quote by searching; fix each new finding exactly to its REQUIRED OUTCOME and no further, unless
    Main can prove the reviewer misunderstood, then rebut it once; without proof, fix it; but a finding that rests on a
    value, rule or choice the user never gave is put to the user and not fixed with another choice of Main's own
    (measured: [Reviewer probes](notes/reviewer-probes.md), variant n1); fix all the others in one batch, then
    call `review` again with the same level, object and criterion and the new rebuttals, until CLEAN. `failed` (the
    catch branch, not parsed text): the check has not passed and no self-check replaces it; retry once on the
    unchanged object, then tell the user and wait. Between the verdict and `NEXT` the extension adds the finding ids
    and the dispute outcomes of this verdict (dispute rule below).
  Not `promptSnippet` or `promptGuidelines`: RQW-prompt sets `systemPromptOptions.customPrompt`, and Pi builds the
  section where they go only without a custom prompt, so they would never reach the model while RQW-prompt is on.
  Not `SYSTEM.md`: turning RQW-review off must remove the pair completely, and with the rules in the plugin it does.
  Source: `/tmp/review-pair.md` section 3.
- Disputes follow the three-message rule, enforced by the extension, not only by prompts. Owner, original task:
  «Задача: доработать RQW-review так, чтобы main и reviewer работали в паре: main может опровергнуть находку по
  существу ... 1. Main может отклонить находку даже с дословными цитатами, если у него есть доказательство, что
  ревьюер понял неправильно: цитата из файла или из сообщения пользователя и объяснение. Без доказательства main
  исправляет находку. 2. Опровержение main уходит в следующий проход review. 3. Ревьюер оценивает довод по существу:
  если довод верный, снимает находку; если нет, повторяет её и отвечает, почему опровержение не подходит. 4. Следующий
  проход видит весь спор по каждой находке, а не только последнюю причину отказа. 5. Правила пары остаются внутри
  плагина (DESCRIPTION, NEXT, REVIEWER.md), а не в SYSTEM.md.» Owner, 2026-10-21: «У них цикла быть не должно.
  Знаешь, тут даже не должно быть трёх кругов. Смотри, как должно быть: должно быть правило трёх сообщений. Ревьюер
  даёт комментарий, main ему отвечает, и ревьюер либо соглашается, либо выступает против. И это конечное. Дальше main
  с ним уже не спорит: он либо принимает его решение, либо идёт к пользователю, чтобы тот разрешил спор, конфликт. Вот
  и всё.»; «Если у ревьюера железобетонные доказательства, то мейн должен принять. ... Если ревьюер выявил работу,
  которая не была зафиксирована однозначным решением, то надо вопрос отдать этому пользователю, чтобы пользователь
  разрешил спор. Всегда всё идёт на основании решения пользователя.»; «Да, и на каждом круге, конечно же, всегда у нас
  новый, свежий ревьюер»; «Причем ему отдается инфа об отказе, возражения основного агента отдаются так, чтобы новый
  ревьюер потом без проблем понял, о чем идет речь.» The rule, carried by `extensions/RQW-review/index.ts`
  (`NEXT`, `DESCRIPTION`, schema, `findingBlocks`, `disputes`, `settle`, `refusals`, `buildBrief`) and `REVIEWER.md`:
  - Ids: each finding of a parsed `FINDINGS:` verdict gets a stable id `<review number>.<position>`, such as `3.2`,
    listed after the verdict (`Finding ids: FINDING 1 = 3.2.`). A finding the reviewer repeats with `DISPUTE: <id>`
    keeps that id; the reviewer's `FINDING n` numbering is not the identity.
  - Message 2: Main fixes a finding or rebuts it once in `rebuttals` (`finding`, `quote`, `source`, `explanation`).
    The tool refuses the whole call, with no review started and no number taken, when a rebuttal names an unknown
    finding, lacks a quote, source or explanation, has a quote that is not in its source (`user` for the user's
    own messages of the branch only, not a compaction or branch summary, which may stay in the brief but are Main's
    text; or a file under the session cwd; whitespace runs and one pair of surrounding quotation marks are ignored),
    repeats a finding in one call, or rebuts a finding that already has a rebuttal or a final answer. The final
    state check and the persisting of the accepted rebuttals run with no await between them, so of two parallel
    calls that rebut the same finding exactly one is accepted. The refusal says what to do instead: fix it, ask the
    user, or wait for the pending answer.
  - Message 3: every review brief carries every dispute of the branch under `<disputes>`: the finding as written, its
    id, Main's quote, source and explanation, and once answered the status and the reviewer's answer, so a fresh
    reviewer understands it without earlier context. The first exact `CLEAN` or parsed `FINDINGS:` verdict of a review
    whose brief carried a dispute open answers it: a finding the reviewer leaves out is withdrawn; a finding it repeats
    with `DISPUTE: <id>` is upheld with `RULING: DECIDED` (a verbatim user or agreement quote settles it: Main fixes it)
    or `RULING: UNDECIDED` (no unambiguous user decision: Main puts the dispute to the user and follows the decision),
    plus a one-sentence `ANSWER`. A missing or invalid RULING counts as UNDECIDED, since nothing shows a user decision.
    Failed, incomplete or malformed verdicts answer nothing; the dispute stays open for the next call. The outcome
    lines (`NEXT.withdrawn`, `NEXT.decided`, `NEXT.undecided` with the ids) follow the verdict. CLEAN, incomplete and
    failed classification is unchanged; only an exact `CLEAN` passes.
  - An unagreed addition that Main defends ("useful") is `DECIDED`: the finding has REQUIREMENT `NOT AGREED`, the
    reviewer repeats it with `RULING: DECIDED`, and Main removes the addition without asking the user. Owner,
    2026-10-22: «2а 3а» (question 2, option a: the reviewer rules DECIDED and Main removes it without asking the owner;
    the v2 behaviour). The `REVIEWER.md` wording therefore has no "or REQUIREMENT would be `NOT AGREED`" clause in the
    UNDECIDED test, and carries an explicit exception, because the DECIDED condition (the user's own words quoted in
    REQUIREMENT) cannot hold for REQUIREMENT `NOT AGREED`: "Exception to the two rulings and the test: an addition
    the user never asked for (an extra feature, output, option or file) that Main defends only as useful or harmless
    is a finding with REQUIREMENT `NOT AGREED` and RULING `DECIDED`; Main removes it without asking the user."
    The measured v3h text had the clause (it made GPT-6.1-Sol rule UNDECIDED on that case); the adopted text, with
    the exception sentence added after the probes, was not measured as a whole (`notes/reviewer-probes.md`, section
    U12). Proof: `review.test.ts` (prompt hash pins and dispute-rule assertions).
  - Verdict extraction tolerates prose before the verdict: when a reviewer reply does not start with `CLEAN` or
    `FINDINGS:`, the verdict starts at the first line that is exactly `FINDINGS:` and the text before it is dropped
    (`verdictOf` in `index.ts`, applied to the reviewer's last text before classification, so the delivered
    message, the finding ids and the dispute answers all use the same text). Prose before `CLEAN` is not tolerated:
    that reply stays `incomplete`. Owner, 2026-10-22: «2а 3а» (question 3, option a: tolerate prose before the first
    line that is exactly `FINDINGS:`). Reason: Sonnet 5.5 wrote a one-line remark before `FINDINGS:` in 11 of 147 (low)
    and 4 of 147 (medium) dispute passes with the adopted wording, which left the dispute open; the rescore with
    tolerant extraction resolves all of them (`notes/reviewer-probes.md`, section "Sonnet's remark before
    `FINDINGS:`"). Proof: `review.test.ts` ("prose before the first line that is exactly FINDINGS:", "verdictOf").
  - What decides the outcome. A settled requirement with decisive evidence: Main fixes. A reviewer misreading: one
    rebuttal with evidence, then the fresh reviewer decides. A finding that demands what the agreement does not ask
    for, or changes a settled decision, is such a misreading: Main rebuts it with the agreement quote and the reviewer
    withdraws it; it is not put to the user. A missing or ambiguous decision, or a choice Main made itself that differs
    from what the user said, is `UNDECIDED` and goes to the user. Earlier owner sources: 2026-10-09
    (`~/.omp/agent/sessions/-Documents-ChatGPT-my-omp-harness/2026-10-09T21-54-24-425Z_01a122a9-0429-72c6-a863-e5df03772564.jsonl:103`):
    «Второй чувак не идёт слепо её править, а у него контекста больше, потому что он сам эту работу делал. И он видит,
    перепроверяет своё решение, свою работу и либо принимает правку, либо её отклоняет и пишет, почему он её
    отклоняет. И в итоге они приходят к консенсусу.»; the same file `:99`: «Ну, то есть если она меняет, а-а-а, как бы
    согласованный план, то её отклоняют»; «То есть мы либо отклоняем правку, потому что она как бы нарушает, либо мы её
    принимаем, и всё.»; 2026-10-14
    (`~/.omp/agent/sessions/-Documents-ChatGPT-my-omp-harness/2026-10-12T15-30-39-654Z_01a130bc-c3a6-7101-b570-e995b9c08136.jsonl:3964`):
    «Он должен согласовывать со мной только те места, которые однозначно являются неоднозначными. Там, где reviewer не
    сможет провести нормальное review, не сможет подтвердить результат работы, потому что формулировка
    неоднозначная. Или он согласовывает со мной решения, которые он придумал самостоятельно, которые отличаются от
    того, что я ему сказал сделать.»; 2026-10-09
    (`~/.omp/agent/sessions/--private-tmp--/2026-10-09T06-26-18-422Z_01a11f57-50b6-7042-9bc8-745d0f4b32ed.jsonl:344`):
    «И если он чё-то реджектит, то он в следующем запуске присылает свои реджекты из прошлых прогонов. ... Там должны
    работать в команде, а не быть друг у друга.» The former rule that a finding with verbatim quotes is mandatory and
    never rejected was an agent proposal inside an approved plan, not the owner's words; the 2026-10-21 messages
    replace it. The three-message limit has no earlier owner source; it comes from 2026-10-21.
  - State: rebuttals are persisted with the review number entry (`{ n, rebuttals }`), findings and rulings with a
    second entry of the same review (`{ n, findings, rulings }`), all `pi.appendEntry("review", ...)`; the state is
    rebuilt from the current branch on every call and verdict, so it survives reload and resume.
  Reason: the owner's three-message rule and user-decides rule; a fresh reviewer each pass stays as before. Proof:
  `extensions/RQW-review/test/review.test.ts` suites "disputes: one finding, one rebuttal, one final answer" and "dispute mechanics" (faux providers; withdrawn
  after a verbatim rebuttal, upheld DECIDED and UNDECIDED with the second rebuttal refused, refusals without proof,
  fresh reviewer with the whole dispute, reload recovery after a failed and an incomplete review). Limits: a reviewer
  that upholds a dispute without the DISPUTE field produces a new finding id, which Main could rebut once more; the
  dispute wording in `REVIEWER.md` and `NEXT` was measured on models in the probe campaign
  (`notes/reviewer-probes.md`: 8 reviewer configs x 49 dispute fixtures x 3 runs per wording; the main side on three
  main configs, 43 fixtures x 3 runs per round), with the limits listed there.
- Reviewer-side tuning is complete on GPT: REQUIRED OUTCOME states one concrete end state; the measured prompt
  treats `<criterion>` as the scope alongside the real brief tags. Evidence and limits: `notes/reviewer-prompt-gpt.md`.
- The diff goes in as a file path, not as a command, so the reviewer can read it whole alongside the named sources.
- The extension builds the brief itself (`buildBrief`): the user's messages of the current branch, verbatim, numbered
  and in order, with compaction and branch summaries labeled as not the user's words, then `agreement`, `object`,
  `criterion` and `<disputes>`. Reason: the main agent no longer retypes the user's words, the largest output cost of a
  call, and the words cannot drift.
- Each call is a fresh session in the same process: `createAgentSession` with in-memory `SessionManager` and
  `SettingsManager`, in the caller's `ctx.cwd`, retaining the caller's session settings (shell, images, retries and
  provider timeouts, transport and its timeouts, compaction, thinking budgets, codemode; owner «2а», [Agent](#agent) parity entry;
  `reviewerSettings` in `extensions/RQW-review/index.ts`). A general subagent of RQW-agent gets its own `review` tool
  through the `pi.events` offer `rqw-review:subagent-review`; its verdicts go to that subagent, its brief is that
  subagent's own messages, and its running reviews end with the subagent (RQW-review README, Review in subagents).
  The resource loader loads no user extensions, skills, prompt templates, themes, context files or appended prompt;
  its sole inline extension installs the bash guard. `REVIEWER.md` is the prompt for both levels. Pi still adds its
  `<cwd>` block after the prompt, so relative paths in the brief resolve; nothing else is added.
- Reviewer tools are `read`, `bash`, `grep`, `find`, no `edit` or `write`, plus Pi's `codemode` and `tool_search` when
  the caller (the main session or the subagent whose `review` it is) has them active ([Agent](#agent) parity entry),
  plus RQW-tools' `job` when RQW-tools offers its definitions. Each session requests fresh RQW-tools definitions over
  `pi.events` channel `rqw-tools:subagent-tools` using RQW-agent's `{ offer(factory) }` handshake (during the
  reviewer's loader reload when it has codemode, otherwise right after it) and calls the offered factory with cwd, a
  settings getter and options: `label` is `review` for the main session's reviewer and the caller's path plus
  `/review` for a subagent's (`agent#1/review`); `codemode`, only when the reviewer has codemode, is Pi's definition
  built from the reviewer's own API (it is then not registered as it is). Of the returned definitions it keeps those
  four names, `job` and, when it passed one, the returned `codemode` (one call of the reviewer's barrier and a job of
  its registry; a factory that returns none leaves the reviewer's own definition). Tools, «Background jobs»: a
  reviewer call still running after 12 s goes to the background; Esc of the review aborts its jobs and the end of the
  review, or of the subagent that asked for it, disposes them. No cross-extension import is added. Without an offer the
  reviewer gets the four stock definitions (`reviewerTools`) and, when its caller has them active, `codemode` and
  `tool_search` registered by Pi's own factories; nothing goes to the background. Both offered and stock grep/find use
  the same `dropEmptyOptional` wrapper: `prepareArguments` drops optional arguments equal to the string `"null"`,
  `"undefined"` or blank, then chains the definition's existing `prepareArguments` before Pi validates them.
  Execute and the other definition fields stay unchanged. Reason: grep otherwise passes `--glob null` to rg and
  answers "No matches found", a silent false negative; RQW-tools has no such normalizer of its own. A real JSON
  `null` Pi already strips. Proof: `extensions/RQW-review/test/review.test.ts`, stock and offered search paths.
- `extensions/RQW-review/git-guard.ts` is a verbatim self-contained copy of `extensions/RQW-agent/git-guard.ts`.
  The root `test/copies.test.ts` asserts byte equality to prevent drift, reading both files without importing
  either extension; each extension's own tests still load only that extension.
  Every child bash `tool_call` checks `blockedGit`, for offered and stock tools alike, returning its reason as the
  tool error when blocked. Reason: prevent state-changing git commands while permitting supported read queries.
  Limit: this shell-syntax guard is not a sandbox; it does not interpret scripts, aliases or computed command names.
  No file edits through bash and never running the delivered result are prompt rules, not runtime enforcement.
  For ordinary code the reviewer may run repository tests; for autotest work it must not run the autotests that
  are the deliverable. Tests may have filesystem side effects. Carriers: `index.ts`, `git-guard.ts`, `REVIEWER.md`.
- The reviewer uses the session's own model runtime, `ctx.modelRegistry.runtime`, private to TypeScript only.
  Reason: providers and logins that the user's extensions register reach the reviewer (here `pi-claude-auth`
  registers the `anthropic` provider), and no second runtime refreshes the same OAuth login.
- `REVIEWER.md` carries the supplied deep adaptation of the Spotty body. Pi's read has no line numbers; named
  paths are read whole and truncated files resume at the reported offset. The final answer is the last message,
  not `yield`. The verdict format stays `CLEAN`, or `FINDINGS:` with numbered `FINDING n` blocks (REQUIREMENT,
  MISMATCH, EVIDENCE, REQUIRED OUTCOME; DISPUTE, RULING and ANSWER only on a repeated disputed finding), and an
  optional `UNCHECKED:` section.
- Async: the call returns `review#N started. ...` at once. The verdict, the reviewer's last assistant text, arrives as
  `pi.sendMessage({ customType: "review", content: "[review#N] <verdict>\n\n<next step>", display: true }, ...)`; `details` carry
  `n`, level, model, thinking and seconds for the user and logs only. Numbers count per session and go on after a
  resume. Every issued number is immediately persisted with `pi.appendEntry("review", { n })`, a custom entry,
  not an LLM message, before any asynchronous work. Recovery also accepts old direct review tool results and verdicts,
  but does not scan arbitrary tool text. This covers nested `ctx.executeTool` callers without a direct tool result.
  If an SDK reload emits no `session_start`, the first execution restores the context and counter from history.
  `session_shutdown` aborts every running review and delivers nothing; the 30-minute timer does not keep the process alive.
- Delivery: a verdict never waits in the agent's queue and gets exactly one main turn unless the run was aborted
  (review findings: in print and json mode Pi disposed the session when the main run settled and the verdict never
  came; a follow-up waited in the agent's queue, which TUI Esc and RPC `clear_queue` clear and an RPC abort or an
  error-ended run leaves without a turn; a verdict that came in while another extension's slow `agent_before_settle`
  handler ran after ours got no turn).
  The `session_start` context is kept. When `ctx.isIdle()`, the verdict goes with `triggerTurn: true, deliverAs:
  "followUp"` and starts a turn, unless the last main run was aborted. When busy, it goes with `triggerTurn: false`:
  Pi appends it to the session at the
  end of the current turn or run, aborted or not, and the `agent_before_settle` handler returns `continue: true`
  while the verdict is not yet followed by an assistant message in the branch. Each review sends one verdict, so its
  number `n` in `details` is the delivery number. When that handler returns without `continue`, a `settling` flag is
  set until `turn_start` or `agent_settled`; verdicts that arrive meanwhile wait in a `late` list, and the
  `agent_settled` handler sends them, all but the last with `triggerTurn: false` and the last with
  `triggerTurn: !event.aborted`, so several get one turn. `mainAborted` latches `agent_settled.aborted` until a new
  `agent_start`, but suppresses delivery turns only while `ctx.isIdle()` is true. A new busy run uses the ordinary
  unanswered-verdict path even while an earlier extension holds `agent_start` or `before_agent_start`, before our
  latch reset. If that current run is aborted, native `agent_settled.aborted` still prevents an automatic extra turn.
  A verdict finishing after Esc or RPC abort while idle is saved once without starting Main, and the next prompt
  carries it once. In print and json mode `agent_end` waits for jobs using its active `ctx.signal`; abort
  interrupts only that wait, not the independent reviewer. `agent_before_settle` only decides continuation and marks
  settlement; Pi 1.4.0 has no active `ctx.signal` there. Normal verdicts still continue the same run before Pi exits.
- Credentials: a review fails with "no credentials" only when both `ctx.modelRegistry.hasConfiguredAuth(model)` and
  `await runtime.checkAuth(provider, { signal })` say so, as in Pi's own prompt. Reason: the auth snapshot behind
  `hasConfiguredAuth` is filled asynchronously, so right after startup or a reload it can miss credentials that exist.
- Cancellation bounds the whole review job, including auth, session creation and prompt preflight (owner: "deadline boundsWHOLEjobinclcheckAuth/create/promptpreflight").
  `untilAborted` races each asynchronous stage, observes late rejection and removes its abort listener. Auth receives
  the signal, late-created sessions are disposed without prompting, and prompt cancellation aborts and disposes its
  session without awaiting an uncooperative provider. Pi 1.4.0's own prompt auth await has no signal; the reviewer's
  public `agent.streamFunction` checks the job signal before calling the SDK stream function, so even a preflight
  resuming after disposal cannot make a model request. The underlying unabortable promise may remain pending until
  its implementation settles; it cannot hold the job, deliver a second verdict or escape the request guard.
- Runtime regression evidence: `extensions/RQW-review/test/review.test.ts` converts all five audit reproductions to
  required outcomes, including post-abort delivery in all four modes, multiple verdicts, nested reload and legacy IDs,
  ignored auth/provider cancellation and native prompt-preflight resolve/reject after timeout or shutdown. `test/cli.test.ts` runs real CLI
  print/json subprocesses on Node by default and on Bun with `PI_REVIEW_TEST_RUNTIME=bun`; both use `test/cli-faux.ts` and the self-contained `test/offline.mjs` network tripwire; no live
  model or credentials are used. These deterministic tests establish runtime behavior, not model review quality.
- Proof: `extensions/RQW-review/test/review.test.ts` (real sessions, faux providers for the main and the reviewer
  models) and one real run per level: a temp copy of a fixture with `calc.py` (`add` returns `a - b` instead of the
  sum) and a correct `config.py` (`MAX_ITEMS = 50`), command
  `pi -e /tmp/my-pi-review --mode json --model anthropic/claude-opus-5-5 --thinking low -p "<prompt>"`, the prompt
  quoting the request and asking to call `review` and then `sleep 150`. Both verdicts named the defect and nothing
  else and started a main turn: `blind` in 8.7 s (`EVIDENCE: "return a - b"`), `high` in 3.8 s. After the delivery
  fixes, tests for print and json mode (the run waits and continues with the verdict), a verdict arriving while the
  main agent streams (continues its run once), TUI Esc and RPC abort (the verdict is in the session once, no run
  starts, the next prompt carries it once), two verdicts that arrive while a slow second extension
  (`test/slow-settle.ts`, loaded after RQW-review) holds `agent_before_settle` (one main turn for both), and grep and
  find with `"null"`, `"undefined"` and blank arguments through Pi's validation and inside a reviewer session.
  Without the `agent_before_settle` handler, the busy-time delivery, the `settling` flag or `reviewerTools`, these
  tests fail. Every test passes when run alone, which needs the `checkAuth` fallback. Live run in json mode with no
  `sleep`: Haiku 5.5 as the main model replied `started`, the run waited, `[review#1] FINDINGS: ... EVIDENCE:
  "return a - b"` arrived after 5.1 s and the main agent answered it in the same run (`GOT VERDICT: ... returns
  a - b instead of the sum`), exit 0 in 13 s.
- Open: `ctx.modelRegistry.runtime` may be renamed by a Pi update, then every review fails with "the model runtime of
  the session is not reachable"; a verdict that finishes after the session ended (quit, `/new`, `/resume`, reload)
  is dropped, since `session_shutdown` aborts running reviews; in print and json mode the run waits up to 30 minutes
  for a slow review; a verdict that arrives during a manual `/compact` with no run is appended without a turn and is
  seen on the next one; the reviewer may read a file the main agent is still editing; the main agent's own RQW-tools
  grep still passes a string `"null"` glob to rg; in one smoke run Haiku wrote a MISMATCH of more than 20 words.

## PCLI

- `pcli-vscode/` is a VS Code extension `arqawa.pcli` ("ARQAWA PCLI", win32-x64) that starts Pi like CCLI starts Codex
  (user: «надо сделать extension, как Arkava CLI, такой же, только PCLI... учитывая все требования, все ограничения»).
  It is outside `extensions/`, has no `RQW-` prefix and is not in `pi.extensions`: it is not a Pi extension. Carried by
  `pcli-vscode/package.json`, `AGENTS.md`.
- VDI constraint: everything runs inside VS Code as a subprocess of the extension host (user: «у нас нет админских прав,
  у нас нет wsl, и нам нельзя запускать ничего такого прямо на хосте, только внутри vs code, только как extension vs
  code, как субпроцесс extension VS code. только так»). Carried by `pcli-vscode/extension.js`.
- Pi is pinned to 1.4.0 and bundled in the VSIX (44.06 MB, [run](https://github.com/ARQAWA/my-pi/actions/runs/39824069227), job `e2e`), no update at runtime (user: «мы не будем автоматически
  обновлять PCLai. Как есть 1.3 версия, так и есть.»; «1 да давай 2 да давай»; the pin moved from 1.3.0 to 1.4.0 with
  the package upgrade, [Scope](#scope), not by an update of an installed PCLI). `vscode:prepublish` runs
  `pcli-vscode/fetch-pi.mjs`: it downloads `pi-windows-x64.zip` of the release `earendil-works/pi` v1.4.0, checks the
  hard-coded SHA256 (`0f7256ea8bdac3af20012b94fdc1252a31cc6dc0d2f9b9eb539555d22e3e321b`, equal to the release's
  `SHA256SUMS` line and to the downloaded archive) and extracts it into `pcli-vscode/pi/` (git-ignored). A new Pi
  version means new VERSION, URL and SHA256 there and a new VSIX. Bumping the root npm dependency does not change the
  bundled `pi.exe`. The `pi.exe` of 1.4.0 still embeds Bun 1.3.14 (read from the binary).
- Release binary, not npm: Pi from npm is a Node program and would run inside `Code.exe` with `ELECTRON_RUN_AS_NODE=1`,
  which leaks into every bash command Pi runs and depends on the Node version of VS Code. `pi.exe` carries its own
  runtime; the same path (Bun exe from a GitHub release) already works on the VDI in omp-vscode. Carried by
  `pcli-vscode/fetch-pi.mjs`.
- Launch chain: extension host -> `powershell.exe` -> Git Bash (`C:\Program Files\Git\bin\bash.exe --login -i -c`) ->
  `pi.exe`, terminal through VS Code's own `node-pty`. The proxy comes from the `Code.exe` environment and the settings
  `http.proxy` / `http.proxyStrictSSL` (the latter sets `NODE_TLS_REJECT_UNAUTHORIZED=0`) and is also exported in the
  Git Bash command line, so profile scripts cannot override it; before the exports that line unsets `http_proxy`,
  `https_proxy`, `all_proxy` and `no_proxy`, because Pi prefers the lowercase names. `~/.pi/agent` (settings, login, sessions) is shared and
  not changed. Carried by `pcli-vscode/extension.js`.
- The tab sets `PI_SKIP_VERSION_CHECK=1`: the version is pinned, Pi must not ask for a newer one (user: «1 да давай 2
  да давай»). Carried by `pcli-vscode/extension.js`.
- One command, `Pi CLI: New Tab`; login is `/login` inside Pi. my-pi itself is installed into that Pi with `INSTALL.md`
  as before; the extension does not install it. Carried by `pcli-vscode/package.json`.
- No Marketplace description: no `description` field in `pcli-vscode/package.json`, no README, no LICENSE (user: «При
  публикации в маркетплейс там НЕ ДОЛЖНО БЫТЬ НИКАКОГО ОПИСАНИЯ»).
- Proof: `.github/workflows/pcli.yml` on `windows-latest` builds the VSIX, installs it into a real VS Code and runs
  `pcli-vscode/test/run.mjs` and `test/suite.cjs`: a local proxy `test/proxy.cjs` with a fake model, Pi answers through
  it, in two scenarios (proxy from the environment with a hostile Git Bash profile, proxy from VS Code settings). The
  fake model is HTTPS with a self-signed certificate: strict TLS fails, `http.proxyStrictSSL: false` works. It also
  checks CONNECT to GitHub with proxy credentials, paths with Cyrillic, spaces and an apostrophe, and no `pi.exe`
  left after closing tabs, `/quit` or VS Code itself. Not covered: a real model call and the corporate VDI restrictions.
- Wheel scroll on the VDI. In PCLI the wheel scrolled the input editor's past messages instead of the conversation;
  the owner's Codex in CCLI scrolled normally. Owner (`2026-10-21T12-13-54-289Z_01a15e61-dcf1-7476-b1d6-42f03584b9e6.jsonl`
  line 158): «Еще знаешь, какая проблема? У нас есть наш PCLI для Windows VDI тачки. Там такая проблема, что не
  работает скроллинг. Когда я пытаюсь скроллить в терминале, у меня прокручиваются последние сообщения вместо того,
  чтобы скроллился чат. А когда я запустил коды в CLI своим extension, там скролл нормально работает. Посмотри эту
  проблему, пожалуйста.»
  Cause, read from the Pi 1.4.0 sources: `TuiBase.start()` (`pi-tui/dist/tui.js:591-597`) calls `beforeTerminalStart`,
  then `terminal.start`, then `afterTerminalStart`. `TuiAltScreen.beforeTerminalStart` (`tui-alt-screen.js:158-195`)
  writes `?1049h` and the mouse enable `?1000h ?1002h ?1003h ?1004h ?1006h` (without `?1003h` in tmux, Zellij and
  screen: `TMUX`, `ZELLIJ`, `STY` set, or `TERM` starting with `tmux` or `screen`), before `terminal.start` turns on raw
  mode and `enableWindowsVTInput` (`terminal.js:117-138`). ConPTY loses what is written that early, VS Code's terminal
  never learns that the app wants the mouse, and the wheel in the alternate screen becomes arrow keys, which move
  through the editor's input history. `TuiAltScreen` has no `afterTerminalStart` of its own, and the same start path
  runs again after the external editor, a TUI mode switch and suspend/resume. Upstream: issue earendil-works/pi#9656
  (its workaround sends the mouse commands again after the terminal started, and only them: moving `?1049h` breaks
  the Kitty keyboard protocol); PRs 9655 and 10560 were closed unmerged; related 11205, 11172, 8913. The loss of the
  commands is measured (Proof below); the wheel-to-arrows step on the owner's VDI is not reproduced here.
- The fix is a my-pi extension and matters only where my-pi is installed in PCLI's Pi. Owner
  (`2026-10-21T16-27-59-062Z_01a15f4a-7ad5-7377-81be-0baf3b6ffa33.jsonl`):
  «Теперь по нестабильному тесту 1А: myIP на VDI, исправление прокрутки делаю расширением myIP. Да, насчёт myIP в VDI: это только если myIP установлен. Если он не установлен, то поебать вообще.»
  Here "myIP" is the speech-to-text spelling of my-pi. Engineering choice within that decision: only on Windows
  and only in fullscreen, enable the mouse again after the terminal started and after every restart of the TUI, with exactly Pi's set,
  multiplexer variant included, and keep Pi's disable on stop. Carrier: `extensions/RQW-mouse/index.ts`, its own
  extension in `package.json` `pi.extensions`, switched off alone like every `RQW-*` extension
  ([Isolation](#isolation)). A new folder because the behaviour belongs to no existing extension, and PCLI only
  launches a stock Pi binary and does not install my-pi (see above). On `process.platform === "win32"` the factory wraps
  `TuiAltScreen.prototype.afterTerminalStart`, stock Pi's empty hook; after Pi's own hook the wrapper writes Pi's set,
  chosen by the same environment test, when the renderer has the mouse enabled (`mouseEnabled`). Pi's early write
  and `?1049h` stay where they are, `beforeTerminalStop` still disables the mouse, and regular mode (`TuiMainScreen`)
  and the print, JSON and RPC modes never use the class. The patch is process-wide: each factory run adds an owner
  token to the `Set` under `Symbol.for("rqw-mouse/state")` on `globalThis`, its `session_shutdown` removes only that
  token, and when the last owner leaves the prototype is exactly as Pi made it (a wrapper someone else put on top stays
  and is inert). Pi emits `session_shutdown` before it loads the next runtime's extensions, so `/reload`, `/new` and
  `/resume` renew the patch; switching the extension off and reloading removes it.
- Limits of the wheel fix. It acts when Pi's terminal starts, so after installing or updating my-pi Pi must be
  restarted: a `/reload` does not restart the TUI. my-pi must be installed in the Pi that PCLI runs (`INSTALL.md`; PCLI
  does not install it). It brings the mouse commands to VS Code; the VDI's own wheel handling is the owner's manual
  check. Pi stays pinned at 1.4.0: the extension throws a load error when `TuiAltScreen.beforeTerminalStart` or the
  base `afterTerminalStart` hook is missing, and its test compares the set with what Pi's own `TuiAltScreen` writes.
- Proof of the wheel fix. `extensions/RQW-mouse/test/mouse.test.ts` (in `npm test`, the same cases on the Mac and in
  the Windows CI): Pi's real `TuiAltScreen` on a terminal that records every write and the moment of `terminal.start`,
  Windows simulated through `process.platform` where the test runs elsewhere. The write right after `terminal.start`
  equals the set Pi wrote before it, for a plain terminal and for each multiplexer variant; it repeats after every
  restart; Pi's disable runs on every stop; nothing is added with the mouse off, in regular mode, on macOS and Linux;
  owner counting in either shutdown order, `/reload`, a hook Pi itself defines on the class and a wrapper put on top;
  loading through Pi's resource loader and extension runner, with the jiti-loaded file getting the same `TuiAltScreen`
  class as Pi's TUI. A model of ConPTY that drops writes before `start` gives 0 and 1; it is a model, the measurement
  follows. `test/isolation.test.ts` covers the extension through the manifest. Capture: job `mouse` of
  `.github/workflows/pcli.yml` (`workflow_dispatch`, or a push to branch `pcli`) runs `pcli-vscode/test/mouse.mjs`,
  which drives `pcli-vscode/test/mouse-suite.cjs` in a real VS Code: VS Code's own node-pty starts the PCLI chain
  (PowerShell, Git Bash, the bundled Bun-build `pi.exe` 1.4.0) twice, stock and with `-e extensions/RQW-mouse/index.ts`,
  and counts `?1000h` in the pseudo terminal's output once Pi is in the alternate screen. Measured on `windows-latest`
  with VS Code 1.143.0 and Pi 1.4.0 ([run](https://github.com/ARQAWA/my-pi/actions/runs/39824069227), job `mouse`):
  0 times stock, 1 time with the extension, `?1049h` once in both, the set arriving after `?2004h` (2013 bytes with the
  extension, 1727 stock). This also shows that the Bun build loads the extension, with its pi-tui module shared with Pi.
- Publishing: skill `publish-pcli` (`.agents/skills/publish-pcli/SKILL.md`), `vsce publish --target win32-x64` from
  `pcli-vscode/` under publisher `arqawa`, `version` raised before each publish, only on a direct request.
- The Pi 1.4.0 PCLI is published right after the merge, then the package on the VDI is updated (owner, to the question
  of when to release: «2a» to «Выпустить новую версию PCLI сразу после слияния, потом обновить пакет на VDI»). Reason:
  main carries the version that gets published, so `pcli-vscode/package.json` and its lockfile are at 0.0.2, one patch
  above the latest Marketplace version 0.0.1 (read-only query of the gallery, `/tmp/pi14-marketplace.json`). The
  branch does not publish; publishing stays a separate step on the owner's request.
- PCLI user-visible text is English. Owner: «У нас весь интерфейс должен быть английский.» (from a longer message), and
  to the list of Russian places found: «Да переводить на англ то что ты спрашивал все переводить)». The four messages of
  `pcli-vscode/extension.js` are English: `[pi exited, code N]`, `node-pty not found in VS Code: ...`,
  `Not found: <path>. Install Git for Windows.`, `Not found: <path>`. Russian code comments and the Cyrillic test paths
  in `pcli-vscode/test/run.mjs` (a VDI profile path case) are not user-visible and stay.

## Anthropic subscription adapter

- Owner TTL approval: «По поводу кэшей вопрос-ответ A: основному агенту час А под основным 5 минут ещё какие-то варианты есть? Может, 10 минут? Или это замеренная цифра? Если это замеренная цифра и 5 минут будет заебись в большинстве случаев, то пусть будет 5 минут. Если можно больше и это будет более эффективно, то можно 10 минут поставить или 15. Я не знаю.»
  Anthropic offers 5m and 1h, not 10m or 15m. Keep the main OAuth 1h default; the independent child extensions own
  their 5m request policy ([Agent](#agent), [Review](#review)). Their explicit `short` wins in both `cache.ts` and
  `transport.ts`, so wire cache markers stay on without `ttl: "1h"`, with or without this adapter loaded. No new
  config knobs or process env changes. Reason: the measured short review/resend gaps favor cheaper short writes;
  [measurements](notes/prompt-cache-policy.md) retain the tradeoffs and evidence limits.
  Carrier proof: package `test/prompt-cache.test.ts`, real Pi library/bundle SDK and mocked Anthropic payloads.
- Owner request (session 2026-10-21, lines 275, 281): «Почему ты не юзаешь какой-то часовой cash?»;
  «Это надо будет пофиксить тоже». OAuth subscription requests default to 1-hour prompt caching; explicit request
  retention and user-set `PI_CACHE_RETENTION` win. Engineering choice: request-local options before the SDK warmer
  starts, not a process-wide env write, because the latter also changes OpenAI retention. `cache.ts` resolves Pi
  auth before the SDK stream and supplies `long` for OAuth only; `lifecycle.ts` binds/restores this wrapper for
  owning and shared-runtime child sessions, and `transport.ts` covers direct provider calls. API keys, unrelated
  runtimes/providers and owner notice settings stay unchanged. Warming policy lives in [Settings](#settings),
  independently of retention; prompt caching stays enabled. Reason: the provider alone runs too late
  to set the warmer's TTL. Lifecycle cleanup restores stock behavior when the last adapter is disabled.
  TTL, timing, pricing and Pi's prospective warmer-cost limitation have one reference:
  `extensions/RQW-anthropic/README.md`, Prompt cache. Deterministic proof: its `test/cache.test.ts`.

- Extension `extensions/RQW-anthropic/`, listed in `package.json`, owns transport and OAuth recovery. Visibility moved to
  `RQW-providers` ([Providers](#providers)).
  Owner requirement (C:3046): «они должны быть полностью изолированы, самодостаточны, чтобы мы могли включать
  и выключать, как feature флаги». Engineering implementation: disable and reload unregisters only its overlay
  and restores in-memory hooks. No
  node_modules edits or credential deletion. Toggle and migration: `extensions/RQW-anthropic/README.md`.
- Owner request (C:3133): «чтобы он был такой же, как в OMP, чтобы у него был self-healing»;
  «И чтобы можно было через него авторизоваться». Engineering implementation: the overlay preserves Pi's
  catalog/parser, delegates Pi's PKCE browser/copy-code
  login and uses omp's refresh endpoint/headers, CLI billing block, original system role and exact-body XXH64 checksum.
  The installed pi-claude-auth's SDK relocation and normalized checksum contradict the reference and are not used.
  MIT attribution: `THIRD-PARTY-NOTICES.md`. No installed fork code is copied. Pi's delegated login endpoint/callback
  and parser remain Pi's, not a complete omp port. Subscription acceptance/billing, account rotation and all omp SDK
  headers are not claimed. Evidence and risks: `notes/anthropic-adapter.md`.
- Owner request (C:3171): «Это именно отключить»; «Когда мы заходим в логин, там должны быть только кодекс,
  авторизация и авторизация через Anthropic, которую ты сейчас делаешь. И всё».
  Engineering decision: hide providers without deleting saved credentials. Public unregisterProvider restores
  builtins instead of hiding them.
  `extensions/RQW-providers/index.ts` wraps ModelRuntime provider/model listing and AgentSession.scopedModels with a
  checked, reference-counted reversible shim, only in runtimes with an owning session of that extension. It does not
  erase previously selected models or disable explicit SDK lookups. Disabling restores defaults without restoring
  stale credential snapshots. Moved out of `RQW-anthropic` ([Providers](#providers)).
- Owner clarification: «Смотри, в нашем Pi должен быть старый OpenAI кодекс и всё, блядь. Legacy, который через девайс. А новый OpenAI нахуй не нужен, блядь. Я не знаю, что там за глупость новый OpenAI. У нас должен быть вход именно такой же, как сейчас это работает в текущем OpenAI кодексе, и всё, больше никак.»
  Keep only `anthropic` and legacy `openai-codex` visible. Pi 1.4.0's `openai` ("Sign in with ChatGPT" and
  `OPENAI_API_KEY`) stays hidden: the owner wants the existing legacy device login, not the new OpenAI provider.
  Carrier: `extensions/RQW-providers/index.ts`, `ALLOWED`.
- `auth.ts` refreshes under Pi's runtime credential-store lock, rechecks the rejected bearer, reuses a concurrent
  update and persists rotation before replay. One HTTP 401 replay, at most two transient refresh attempts and one
  explicit newer-version replay; no auth retry for 403/quota, no replay after streaming. Caller abort cancels waiting
  and inference but not persistence of an already-rotating token. Permanent errors surface /login guidance without
  upstream token-response bodies. Subscription inference uses the official HTTPS origin only and rejects redirects.
  No bootstrap identity or startup version probe. `PI_AI_CLAUDE_CODE_VERSION` can pin the CLI version.
- Adapter replacement (user: «Просто старый адаптер выкидываешь, который есть уже, и ставишь наш адаптер»).
  `INSTALL.md` step 0.1 removes an installed `git:github.com/edxeth/pi-claude-auth` with official `pi remove`, in its
  installed scope, then installs or updates my-pi normally. No confirmation is needed for this known replacement.
  Preserve `auth.json` and unrelated packages/settings. Omit old explicit `-e` arguments on the next launch without
  editing other projects' scripts. Reason: run one Anthropic adapter, with the old one off, not support a mixed
  configuration. Another competing adapter must be switched off before use. Mixed-config support, poisoning future
  refreshes after a conflict and SDK changes are not required by this migration. Carried by `INSTALL.md` and
  `extensions/RQW-anthropic/`; adapter details live in its README.
- Proof boundary: tests use fake credentials, mock fetch, file-backed lock fixtures and both Pi library/CLI-bundle
  entrypoints. These tests do not prove live subscription acceptance or billing. The owner's old Claude benchmark/tuning campaign
  pause (C:3244) remains: «Те задачи, где ты должен делать замеры на Sonnet моделях, на Cloud моделях, пока на паузе
  стоят»; «Я тебе дам команду, когда их продолжать». Offline fixture coverage in `notes/anthropic-adapter.md` is
  not a current verification report or proof of actual Windows/Linux execution; independent review remains required
  by `PROCESS.md` and [Work policy](#work-policy), not by a manifesto gate.

- Engineering follow-up to four independent review findings under the adapter request C:3133: either fully handle
  the canonical auth-token path or reject OAuth-header auth before external transport. The adapter
  rejects subscription Authorization headers before delegation and keeps ordinary API-key gateway behavior
  (`transport.ts`). The single-adapter migration policy is defined above; no mixed-configuration or SDK changes
  are part of that requirement. Engineering decision: track the sent version per request, with one bounded replay
  if an effective newer version
  meets a rejection, even if already adopted. Each request records its sent version, including under concurrency; a pinned
  `PI_AI_CLAUDE_CODE_VERSION` still forbids adaptation (`wire.ts`, `transport.ts`). License, privacy and
  delegated Pi parser/login design remain unchanged.

## Models

- Owner's transactional picker request, verbatim: «Надо переделать picker модели effort таким образом, что когда я нажимаю Shift+стрелочку вверх, вниз или влево, вправо, у нас открывается визуальный интерфейс, в котором переключается модель визуально. Знаешь, как в iPhone, когда ты крутишь ползунки „минуты“, „секунды“, где-то открывается интерфейс, в котором предварительно меняется модель и effort, когда я нажимаю кнопочки, и там будет кнопочка „OK“. Enter — это принять, а Escape — это отмена. Escape — закрыть интерфейс. И получится так, что когда я меняю интерфейс, меняю effort, он сразу не меняется, не применяется. Нет такого, что я пока переключаю модель, он запросы под разными моделями улетает. У меня префаер — мини-интерфейс, где я выбираю модель effort, нажимаю Enter, и оно применяется. Эта хуйня должна быть в стилистике нашего UI из тех задач, которые были. Следичку подгони сам. Потом, если что, если мне не понравится, мы её переделаем.»
  Clarification, verbatim: «когда ты нажимаешь первый раз Shift и стрелочку, у тебя открывается интерфейс уже с новой, будущей моделью измененной, чтобы я не делал дополнительные клики... Если я нажимаю Shift+Влево или Shift+Вправо, то он сразу открывает пикер с измененным состоянием, чтобы мне нажать, а потом Enter. Нажать и Enter, если нужен один переход. А если несколько, то я нажал, довел до нужного состояния, нажал Enter... строго в концепте Terminal UI Pi ... в цветовой гамме и в согласованности с нашим новым дизайном ... Решение остается за тобой конечное».
  Reason: preview model and effort without changing the live session while choosing. Each initiating Shift+arrow
  performs one draft step before the first render; one transition is Shift+arrow then Enter. Plain and Shift arrows
  then share the same axes. Enter commits once; Esc closes with no setters or restoration. Model order, authenticated
  availability and allowed efforts below are retained; a draft model switch clamps effort to the nearest lower allowed
  level or the lowest. Dialog/key-repeat guards prevent stacked dialogs; actual session replacement/reload/shutdown
  cancels the draft. No settings, dependencies, request fences or aborts are added.
  Appearance is delegated: two compact terminal-native wheel columns, selected center, muted neighbours and visible
  OK/Enter/Esc hints, supplied theme roles and thinking-level tokens (low ordinary, medium green, high gold, xhigh purple,
  max red; highlighted effort bold). Narrow rendering fits rather than overflowing. Visual carriers:
  `/var/folders/cf/2mk2lmy9087c_lw961rpfvz00000gn/T/ui-port/browser-preview/index.html` (native-menu/reasoning)
  and sibling `EXECUTION-BRIEF.md` §0; this is not a literal web/iPhone component and does not activate a theme.
  Runtime carriers: `extensions/RQW-models/{index,picker}.ts`; standalone state/rendering tests in its `test/`,
  real Pi interactive composition with current RQW-prompt/statusbar hooks in `test/model-effort-picker.test.ts`.
  The added strict no-intermediate-request-at-commit requirement was explicitly withdrawn by the coordinator as
  an overreach, not an owner requirement. Unchanged-model commits use only the thinking setter; changed-model commits
  use public `pi.setModel`, a scoped synchronous pending-effort `model_select` handler, fallback and cleanup.
  Pi's setters are not atomic: earlier listeners/concurrent work may observe its intermediate switch effort;
  already-prepared requests can retain their snapshot. This limitation is explicit in the extension README.
  Existing `/rqw-models`, stock `/model` restrictions and unrelated controls are unchanged.

- Engineering follow-up under the owner's flaky-test precedent: «Теперь по нестабильному тесту 1А»;
  1a: «Отдельной задачей разобрать, почему тест кодмода на Windows иногда не укладывается в 5 секунд, и исправить причину.»
  Startup reads provider-scoped availability and uses the owning session's async-auth `setModel`.
  Reason: Pi can discard a whole-runtime availability pass superseded by a background refresh and return an old
  snapshot; `pi.setModel` also checks that snapshot's configured-auth state before checking real auth.
  Carrier: `extensions/RQW-models/index.ts`; its `test/models.test.ts` gates a superseding pass deterministically,
  keeping real auth checks, provider filters, list guards and normal model-selection events intact.

- Owner request (C:3113): «Надо, чтобы они работали как в нашем OMP»; «Один мод будет статус бара, а второй мод
  будет Model Picker»; «То есть чисто модели Opus, Sonnet, GPT-6.1, GPT-6, Luna-6, Haiku».
  `extensions/RQW-models/index.ts` is independent,
  imports only Pi, and is listed separately in `package.json` under `pi.extensions`. Disable its resource in Pi's
  `pi config`, then `/reload`; it writes no settings and registers no tool. The listed-models rule below retains its
  existing instance-level masks, removed when it is switched off; the draft chooser uses public UI/event APIs.
- Owner: «Надо подобрать сопостовимую модель на gpt, попробоуй 5.6 luna и более сильные модели типа medium ризонинг 6 и 6.1 sol, на время замеров добавь 5.6 luna в список моделей наших сразу после хайку и вообще хайку надо поставить над всеми в слабых моделях ь.е. порядок должен быть типа haiku 5.5, luna 5.6, luna 6 так как luna 6 слабее 5.6 луны и потом будем думать»
  Reason: put Haiku above both Luna models and include GPT 5.6 Luna for the measurements. Owner, 2026-10-22:
  «Давай тогда сделаем, что на blind review будет Luna Medium. На high review будет Luna High. Да» - the GPT
  reviewers of `RQW-review` use `openai-codex/gpt-5.6-luna` (DECISIONS, [Review](#review)), so GPT 5.6 Luna stays in the
  model list permanently, no longer a temporary addition. Carrier: `extensions/RQW-models/index.ts` (`FAMILIES` and
  `FAMILY_LEVELS`). Pi's catalog has `openai-codex/gpt-5.6-luna`; its low, medium, high, xhigh and max efforts
  are selectable, still intersected with Pi support. This list change does not itself run the measurements.
- Model order in `FAMILIES`: `claude-opus-5-5`, `claude-sonnet-5-5`, `gpt-6.1-sol`, `gpt-6-sol`,
  `claude-haiku-5-5`, `gpt-5.6-luna`, `gpt-6-luna`. `pickerModels` takes Pi's own credential-aware availability, including provider
  `filterModels` (for example GitHub Copilot's per-account list): the runtime's unmasked
  `getAvailableSnapshot` through its prototype while the listed-models masks (below) are set, otherwise
  `ctx.modelRegistry.getAvailable()`. Absent models, models a provider filters out and providers without
  configured auth are skipped. Building and navigating the draft uses that snapshot, resolves no credentials and
  makes no requests; commit uses Pi's normal authenticated setter. Only the startup choice waits for Pi's availability
  pass (below). `familyOf` matches the same
  generation across provider paths, Claude dotted versions, dated aliases and Bedrock IDs. No old Claude generation,
  unlisted GPT generation, fast variant or invented model is substituted.
- Engineering decisions for the model request C:3113, elaborated in the coordinator implementation brief C:3274:
  match supported IDs across providers and skip absent auth. Provider visibility is the separate owner request
  C:3171. The preferred providers are `anthropic` for Claude and
  `openai-codex` for GPT. Conservative choice: one available variant per family, preferring that provider and its
  exact canonical ID, then stable provider/ID order. This keeps one entry per family, not duplicates of each model. A proxy
  variant can be selected only when the preferred provider/ID is unavailable. This extension does not disable any
  provider. A provider-wide restriction remains a separate task.
- Owner request: «Надо вернуть старое управление моделями: Shift + Вверх/Вниз будет смена модели, Shift + Вверх — к более сильным, Shift + Вниз — к более слабым. А Shift + Влево/Вправо — это будет смена ризенинга, так же, как и раньше это было в ОМП.»
  Reason: the old oh-my-pi layout (`model-arrows.js`, `reasoning-arrows.js`, [notes/models-omp.md](notes/models-omp.md)),
  where Shift+Up moves to earlier (stronger) entries of the list and Shift+Down to later (weaker) ones, and Shift+Right
  raises reasoning, Shift+Left lowers it. This replaces the earlier Option/Alt+plus/minus layout; those shortcuts and their
  aliases are removed. Pi 1.4.0 binds none of the four Shift+arrow keys (editor, app and `tui.altScreen` defaults use
  plain, `ctrl` and `ctrl+shift` arrows), so nothing stock is shadowed. Terminals send CSI `1;2A`/`B`/`C`/`D` for them
  (xterm modified keys in iTerm2, Terminal.app and the VS Code terminal; the Kitty protocol keeps the same form, also
  with an event type such as `1;2:1A`), so no Option/Meta setup is needed.
  Carrier: `extensions/RQW-models/index.ts`. `registerShortcut` binds `shift+up` (stronger model), `shift+down` (weaker
  model), `shift+right` (reasoning up) and `shift+left` (reasoning down). The first match handles a press once, as in
  Pi's interactive editor. The transactional chooser above replaces immediate shortcut mutation: one guarded dialog
  owns the draft, so repeats do not queue additional dialogs or live switches. Opening reads the live model from the
  latest `session_start` event context, not the TUI shortcut snapshot; the context is refreshed on resume and reload.
  Both model and reasoning draft movement stop at either end, as omp does, rather than wrap.
  Engineering entry rule: from outside the list, Shift+Up enters at the strongest available model and Shift+Down at the
  weakest, so entry follows the stated strength direction. The picker stays strongest first. Tests:
  `extensions/RQW-models/test/models.test.ts` (byte sequences through Pi's key matcher, direction, limits).
- `/rqw-models` is the extension's authenticated listed-model picker via `ctx.ui.select`. Pi reserves its built-in model
  shortcuts and disambiguates commands conflicting with built-ins, so RQW-models does not replace them; it empties
  them (next item). Shift+Tab (thinking cycle) and provider definitions stay stock. In print/JSON mode the picker
  has no dialog and does nothing; RPC can supply the standard select dialog.
- Owner rule: «Смотри, про выбор модели, где через стрелочки вверх, вниз, через плюс-минус мы
  меняем модели, меняем effort. Там меняются только модели из нашего списка. И вообще другие модели выбрать нельзя,
  только модели в этом списке. Дефолтный Model Picker работать не должен. Там должен быть пустой список моделей.»
  For the CLI flag `pi --model ...`, a model restored with an old session and a model given to the `agent` tool for
  a subagent, the owner answered «Да, делай» to «a) Закрыть и эти пути. Модель вне списка не выбирается нигде, Pi
  покажет предупреждение.» This supersedes the earlier choice that stock `/model`, Ctrl+L, Ctrl+P, `/scoped-models`
  and CLI/RPC selection stay intact. Reason: only the listed models may be selected or used anywhere.
  Carrier: `extensions/RQW-models/index.ts`. Listed means any provider variant matched by `familyOf`; nothing else.
  - Stock lists are empty. Pi 1.4.0 gives extensions no session handle, so on every `session_start` RQW-models
    borrows the owning `AgentSession` in one synchronous `ctx.getContextUsage()` call, with
    `AgentSession.prototype.getContextUsage` swapped and restored in the same call. It then sets own-property masks
    on that session and its `ModelRuntime`: `getAvailableSnapshot()` and `session.scopedModels` return `[]`. So the
    `/model` picker, `/model provider/id`, its autocomplete, Ctrl+L, Ctrl+P, `/scoped-models`, the `/settings`
    default-model choices, RPC `get_available_models`/`set_model`/`cycle_model` and Pi's post-login auto-selection
    find no model; `ctx.modelRegistry.getAvailable()` is empty for every extension.
  - Selection outside the list is refused before mutation: the owning session's `setModel` (stock UI, RPC and
    `pi.setModel` of any extension) rejects with `<provider>/<id> is not in the RQW models list. Allowed: <listed IDs>.`
    and a warning notification; model, session entries, settings and `model_select` stay unchanged.
  - On every `session_start` a current model outside the list (CLI `--model`/`--models`, a saved default without
    authenticated Opus, a restored or resumed session, or RQW-models enabled by `/reload`) is replaced by the
    default: authenticated Opus, else the strongest authenticated listed model, at medium or the startup/`/new`
    `--thinking`, with a warning (a notification, or stderr without UI). Engineering choice, derived from «вообще другие
    модели выбрать нельзя» and accepted by the coordinator: the strongest listed model when Opus has no auth,
    since keeping Pi's unlisted model would break the rule. A fresh startup selects
    Opus first, so an unlisted saved default never becomes current and needs no warning. With no authenticated
    listed model the model stays and the warning says its requests are refused. Before this choice and the Opus
    default, `session_start` awaits Pi's own provider-scoped async `getAvailable(provider.id)` (not masked),
    in parallel for the visible providers: resolver-only auth may not yet appear in the synchronous snapshot
    (`dist/core/model-runtime.js` `registerNativeProvider`, `markProvisionallyConfigured`).
    The wait shares one 15 s deadline, like Pi's model selector; on a timeout or error the snapshot is used.
    Without a choice to make, nothing waits.
  - Requests: the owning runtime's `prepareRequest` refuses every chat request for an unlisted model with
    `RQW-models refused the request: <the same text>`. This covers in-process sessions on that runtime: an `agent`
    subagent given such a `model` ends its first turn with this error; RQW-review's Haiku and Sonnet are listed.
    Checked: Pi's own requests use the session's model (compaction, branch and bug-report summaries, cache warmer,
    retries; a virtual model is checked as the physical model it routes to), so nothing needs an exemption.
    Image and classifier models (codemode `models.generateImages`/`models.classify`) are not chat models and pass.
  - Each mask calls Pi's current prototype method, so the prototype patches of RQW-anthropic and RQW-context keep
    working underneath and are never captured or restored by RQW-models. Masks are reference-counted per instance
    and removed on `session_shutdown` (`/reload`, `/new`, quit) or `session.dispose()`; switching RQW-models off and
    `/reload` restores stock behavior. Each of RQW-models and RQW-anthropic works with the other on or off.
  - Limits: Ctrl+P changes nothing but Pi still shows "Only one model available"; Pi prints it for an empty cycle
    result and has no hook, and a fake result would print a false "Switched to". `/scoped-models` lists no model,
    only saved patterns that match nothing, as unavailable rows. After `/login` from no model Pi suggests `/model`;
    `/rqw-models` or Shift+Up/Down select a model. If Pi's internals change and the session cannot be borrowed,
    RQW-models warns and the stock lists stay. Pi mechanisms: [notes/models-omp.md](notes/models-omp.md).
- Owner request (C:3113): «И базовая модель всегда при запуске — это Opus-Medium. Это от провайдера не зависит».
  CLI precedence and preservation of resumed sessions are engineering choices, not direct owner quotations
  (assistant C:3123; coordinator implementation brief C:3274). Without explicit CLI model selection, `session_start` selects available Opus and `medium` on a fresh
  startup or `/new`. With no authenticated Opus
  it keeps Pi's initial model if listed rather than silently choosing another family. A startup with existing
  conversation history or continuation/session flags, and events `resume`, `fork` and `reload`, keep a listed current
  model/thinking. Explicit CLI `--model` and `--models` of listed models preserve Pi's resolved model and thinking
  selection, including model suffixes, mixed scoped suffixes, `--thinking` precedence and settings effort when no suffix is given. No scoped suffix is
  parsed again by the extension. Pi's exported `parseArgs` recognizes explicit selections and continuation flags.
  Without an explicit model selection, the extension selects available Opus and applies `--thinking` through Pi's
  native clamping, including off/minimal; when `--thinking` is absent it applies medium when supported. CLI overrides apply to `/new` too,
  matching Pi's own new-session initialization. No defaults are persisted. An SDK host must pass reason `resume` for
  an empty restored session with no conversation history, since public session metadata cannot distinguish that
  session from a fresh one after Pi inserts initial model/thinking entries.
- Owner correction: «Теперь смотри насчет переключателя модели, пикера модели. Ты как сделал? Ты сделал, что я нажимаю Option + плюс/минус, и у тебя изменение effort идет правильно. Ты на плюс увеличиваешь effort, на минус уменьшаешь. А выбор модели у тебя идет неправильно. Ты на плюс ухудшаешь модель, а на минус улучшаешь модель. В самом конце у тебя стоит самая сильная модель, а в самом верху самая слабая. Список должен наоборот идти, в том же порядке, только наоборот. Еще смотри, effort у моделей должны быть такие же, как у пикера в MyPy, только без no reasoning моделей.»
  Reason: the picker lists strongest first, and the stronger direction of the model keys must agree with the stronger
  direction of the effort keys. The key layout itself was replaced by the Shift+arrow request above. Carrier:
  `extensions/RQW-models/index.ts`; the strength and entry rules are above.
- Owner clarification: «Нет, ты не понял: уровни effort будут не те, что в стоковом выборе Pi, а те, что в нашем MyOMPHarness были. Там они были перенастроены кастомно. Допустим, у Opus были low, medium, high, у Sonnet были low, medium, high, extra high. Такие же должны быть, только без no reasoning.»
  Reason: preserve the harness's custom effort choices, not stock Pi's wider list. Carrier:
  `extensions/RQW-models/index.ts`, explicit `FAMILY_LEVELS` intersected with Pi's
  `getSupportedThinkingLevels(model)`, so no unsupported level is offered. Opus: low, medium, high;
  Sonnet: low, medium, high, xhigh; GPT-6.1 Sol, GPT-6 Sol, both listed Luna models and Haiku:
  low, medium, high, xhigh, max (GPT 5.6 Luna is the catalog-based addition above, permanent).
  The harness's ORDER contains no minimal; off is removed by request. These lists apply to matched families,
  including aliases and proxy providers. A non-reasoning model has no choices. On an extension model switch the
  previous effort is retained if allowed, otherwise the nearest lower allowed level or the lowest. Explicit
  off/minimal moves to the lowest allowed level on the next extension-driven family selection. Explicit CLI
  selections of listed models retain their native precedence above. Engineering choice: an unlisted model, current
  only while no listed model is authenticated, keeps Pi-supported levels minus off and minimal, matching the harness
  ORDER without inventing a family list.
  Source evidence and exact OMP capability provenance: [notes/models-omp.md](notes/models-omp.md).
- Engineering P2 follow-up for the model request C:3113: obtain the live current model when an action executes via
  the public event context; prefer Pi's resolved settings over a manual CLI parser; preserve the selected CLI effort
  and resumed model. These are implementation choices, not additional owner requirements. Reason: queued TUI snapshots retain the previous model and an extension
  override loses Pi's selected scoped effort. The fixes use the public event context and retain Pi's resolved
  explicit selection in `extensions/RQW-models/index.ts`.
- Research sources and Pi mechanisms: `notes/models-omp.md`. Read-only: `~/Documents/ChatGPT/my-omp-harness`
  master/lite use `extensions/ui/model-arrows.js` and
  `reasoning-arrows.js`; deprecated uses the same files directly under `extensions/`. All use Shift+arrows and
  stop at the ends. Master's Opus high/Sonnet xhigh caps are carried by the family effort lists above; GPT 5.6
  and Anthropic off payload rewrites are not ported. Its `settings/config.yml` keeps the two providers and seven model
  entries. The installed `~/.omp/agent/config.yml` loads that repository but still lists more enabled models and a
  Sonnet high default; `~/.omp/agent/keybindings.yml` disables stock model cycling. Latest owner choices above win.
  Checked against Pi 1.3.0 `docs/extensions.md`, `docs/sdk.md`, `docs/keybindings.md`, `core/extensions/types.d.ts`,
  `core/extensions/runner.js`, `core/model-registry.js`, `core/sdk.js`, `core/agent-session.js`, `main.js`, pi-ai's
  `models.js` and built-in model data, and pi-tui's `keys.js`.
- Proof: `extensions/RQW-models/test/models.test.ts`, faux only, runs standalone loading and disabling, real SDK
  sessions, model/thinking changes, history restore and reload, no persisted defaults, actual CLI flag handling,
  missing Anthropic auth and the listed-models rule: empty stock snapshot and scoped list with `/rqw-models` and
  the Shift+arrow keys working, a stock cycle that does not switch, refusal before mutation, CLI `--model`/`--models` and
  saved defaults outside the list (also through Pi's CLI bundle, which the installed `pi` runs), restored and
  resumed sessions, no authenticated listed model, a provider `filterModels` dropping a family, a pending
  availability pass at startup, a subagent-style session on the shared runtime,
  release on dispose and stock behavior after `/reload` without it. `test/anthropic-models.test.ts` switches
  RQW-models and RQW-anthropic off in turn. Package and isolation fixtures use the listed ID `gpt-6.1-sol`. The key test feeds realistic ESC-prefix, Kitty
  physical/alternate-symbol CSI-u and xterm modifyOtherKeys bytes into Pi's `matchesKey`, with first-match dispatch.
  This is parser testing, not manual terminal testing. The local implementation report records no live Claude
  requests and no independent agent review. The P2 implementation report records passing model tests on macOS, Node 22.19.0 and 26.7.0. Regression coverage
  includes rapid snapshot contexts, reasoning queued behind a switch, real CLI mixed scoped suffixes and a saved
  default selecting the second scoped model. The complete repository suite passes on both with
  `--test-concurrency=1`, versions run sequentially. Strict TypeScript checking was not rerun: this worktree has no
  local compiler or typecheck script. No unrelated tests or timeouts were changed. Windows/Linux remain covered by
  the existing CI matrix but were not run locally, and no terminal
  capture or corporate VDI test was performed.
- Engineering CI auth fixture fix for the model request C:3113: preserve a meaningful no-Opus-auth fallback test
  without real requests, using deterministic fixture config for initial selection before registration.
  `extensions/RQW-models/test/models.test.ts` seeds `models.json` with
  `providers.openai-codex.apiKey: faux-only` before spawning Pi. This is fixture auth, not `--model` or a production
  fallback change. Pi 1.3.0 native-provider registration starts asynchronous availability refreshes, while
  `findInitialModel` reads the synchronous snapshot. In a clean home with no configured auth, initial selection can
  be empty; the agent retains `unknown/unknown` even when Codex becomes available by `session_start`. Without Opus,
  RQW correctly preserves that initial selection, and Pi reports no API key. A clean-home CLI probe reproduced it.
  A gated faux auth resolver reproduced both snapshot timings: without config the early selection was absent and
  the settled selection was Codex; with config both were `openai-codex/gpt-6.1-sol`, without Anthropic auth.
  No evidence calls for changing RQW production auth selection. The CLI regression asserts the exact fallback
  model; a saved or explicit unlisted model is replaced as the listed-models rule above requires.
  Offline mode and the fetch prohibition remain intact.
  The fixture-fix report records passing model tests on macOS, Node 22.19.0, 24.21.0 and 26.7.0; the full suite passes on
  Node 22.19.0 and 26.7.0 with 387 passed and the existing Windows-only test skipped. Twenty clean-home CLI
  probes with the seeded config passed. The local fixture-fix report records no live requests or CI rerun.

## Status bar

- Independent `extensions/RQW-statusbar/`, registered in `package.json` under `pi.extensions`.
  Owner request (C:3133): «Просто нужны элементы и расположение их отображения, и всё».
  Independent modules are required by C:3046 and the two-module request C:3113. No cross-folder imports is the
  engineering isolation mechanism, not a literal owner quotation. The existing predecessor renderer and git helpers
  are retained and completed. Evidence and exact row contract: `notes/statusbar-omp.md`; do not copy other omp UI.
- Enabled by default; `/statusbar [on|off]` toggles in the TUI, with the bare command inverting the choice. Off restores
  the stock editor and footer and disposes polling/subscriptions. The choice is local to the loaded extension, not persisted.
  Reason: Pi already owns package extension enablement; no parallel settings file is needed. Print, JSON and RPC do
  no footer work. Model and thinking are read live from Pi, regardless of the source of a change.
- Context tokens/window come from Pi; the bar measures the effective compaction threshold from Pi's own reserve
  resolver, including a cap/rule installed independently by RQW-context. It never changes that policy. Unknown
  post-compaction usage is `?/limit`. Reason: zero would claim a known empty context.
- Conditional omp data without a stock Pi API is not invented: modes, collaboration, streaming/recording, running
  agent/job counts and PR metadata. Limits, source citations and test samples live only in
  `notes/statusbar-omp.md`. Colors are stock Pi semantic colors, without tuning.
- GPT Fast lightning: the main chat's GPT Fast state ([Settings](#settings), «GPT Fast») shows as a bright yellow
  lightning drawn after the model name, between the name and the thinking level, when the state is on and the current model's
  provider is `openai-codex`; nothing otherwise. Owner: «Надо, чтобы метка фаз была в виде молнии яркой Желательно которая
  ярко-желтая с бликом переливающимся. Можешь так сделать?» Owner on the place: «А насчёт визуализации в статус баре, где
  модель, где глиф модели, нарисована какая-то шестерёнка или что-то такое перед названием модели, её нужно заменять будет на
  значок молнии. Нет, лучше значок молнии пририсовывать после имени модели между моделью и резонингом. Вот так давай
  сделаем.» The glyph before the model name stays. While the agent works a shimmer runs over the bolt (bright yellow, paler
  yellow, white, back; 120 ms per step); idle it is a static bright yellow. The timer runs only while the agent works
  and the lightning is shown (GPT Fast on and an `openai-codex` model), and starts or stops on `/fast-gpt` and model changes. The coordinator's description the owner accepted:
  the shimmer runs "пока агент работает", idle it "горит ровным жёлтым". Engineering choices: the Nerd Font bolt `\uf0e7`
  (the bar already uses Nerd Font glyphs), because U+26A1 is two cells wide in pi-tui even with VS15; own ANSI colours
  (bold 93, 38;5;220/226/229, 97), not a theme role, so the yellow holds in every theme. The state is learned from
  RQW-settings over `pi.events` at every render (query) and redrawn on its change event; the extension imports nothing from it.
  Carrier: `extensions/RQW-statusbar/{render,index}.ts`; proof: `extensions/RQW-statusbar/test/fast-gpt.test.ts`.
- The status animation (the busy letters, the compaction gold and sheen, the lightning) redraws every 20 ms, 50 nominal
  frames per second, and its motion follows elapsed monotonic time, not the number of timer ticks. Owner: «Planning next
  moves очень медленная, не плавная [...] Не ускорить, а сделать более плавной, в два раза плавнее. Здесь как будто
  10 fps. Ее можно даже сделать еще помедленнее.» and «Я хочу, чтобы у нас всё было так же плавно ... как в UMP, и даже
  лучше. Давай попробуем сделать 50 FPS для начала. [...] Даже можно скорость блика сделать медленнее, чтобы она шла
  более медленно, более плавно.» Before, one 120 ms tick (8.33 Hz) advanced one phase frame; that interval came from the
  lightning's colour step and had no recorded CPU reason. Rule: letters and sheen take one phase frame per 160 ms of
  elapsed time, 0.75 of the former speed (letters 4.30 instead of 5.73 columns per second); between whole frames the
  compaction sheen blends each cell toward its next colour instead of jumping a cell; the lightning keeps its accepted
  one colour step per 120 ms. The phase is read at render time, so any of Pi's redraws shows the right position. The
  static gold title, the input text and the effort colours do not animate. The timer runs only while an animated status
  or the working lightning is shown, as before. While our editor owns the top border, Pi's working spinner, which that
  border hides, gets no frames through the public `ctx.ui.setWorkingIndicator({ frames: [] })`, so its 80 ms timer stops
  repainting; off, shutdown and reinstall restore Pi's default, and with a foreign editor it is not touched. Pi has no
  event for another editor replacing ours, so the shimmer tick and every activity change (agent start included) check
  the editor slot and restore Pi's default once it is not ours, hiding it again when ours returns. Pi 1.4
  batches paints at most every 16 ms (`MIN_RENDER_INTERVAL_MS`), so 50 Hz passes through without a patch; omp, the
  donor, runs this shimmer at 30 Hz with a 30 Hz paint cap. Cost: every paint re-renders Pi's whole component tree and
  writes only the changed lines; CPU grows with the transcript length, and terminal, GPU, remote and visible frame rate
  are not measured. Carrier: `extensions/RQW-statusbar/{index,render}.ts`; proof:
  `extensions/RQW-statusbar/test/{lifecycle,chrome,fast-gpt}.test.ts`, numbers in `notes/statusbar-omp.md`.
- Branch and counts use the extension's own repository discovery and asynchronous git refresh, not Pi's cached
  `getGitBranch()`. Engineering choice for the status-bar request C:3113/C:3133: discover the repository and refresh
  git asynchronously to handle repository replacement and branch checkout. Reason: Pi caches absent metadata when a session
  starts outside git and does not rediscover it after init in the same cwd. Carried by `extensions/RQW-statusbar/{git,index}.ts`;
  real-provider regression and evidence: `notes/statusbar-omp.md`.
- Local proof uses deterministic snapshots, no-request Pi library/bundle sessions, local git fixtures and a PTY
  smoke run where available. The local implementation report records no independent agent review or live model run.
  Windows paths are exercised locally; native Windows execution remains the existing CI job. These are proof
  boundaries, not exceptions to the workflow's independent-review requirement.
- The context bar is the bottom border of the input editor, not a separate footer row; the footer keeps the model
  and place rows. Owner: «Я бы хотел, чтобы бар контекстного окна был вместо нижней чёрточки»
  (line 136 of `2026-10-21T12-13-54-289Z_01a15e61-dcf1-7476-b1d6-42f03584b9e6.jsonl`). Mechanism: Pi's public
  `ctx.ui.setEditorComponent` with a `CustomEditor` subclass that overrides only `renderBottomBorder`; Pi itself
  carries over text, border color, padding and app keys. Engineering choices: the editor's down-arrow `N more` hint for
  hidden input lines comes first and the bar takes the rest of the width (only the hint when too narrow); the
  working status stays embedded in the top border as in Pi's default editor; the bar keeps its own colors.
  When another extension's editor is already installed it is kept and the bar stays the first footer row; if one
  replaces ours later, the footer shows the row again. Off restores Pi's editor only when ours is installed.
  Reason: the owner's layout without taking the editor slot from another extension; no Pi patch. Outside the TUI
  nothing is installed. Carrier: `extensions/RQW-statusbar/{editor,index}.ts`, `render.ts` `editorBorder`;
  contract and proof: `notes/statusbar-omp.md`.
- The full session ID ends the editor's top border, where Pi's working status runs on the left:
  `── <working…> ─────── <session-id> ──`, idle only rule cells before it. Owner: «Также надо знаешь, что сделать?
  Надо добавить в status bar наш. Надо добавить status bar id сессий куда-нибудь, блядь. Можно добавить его в верхнюю
  часть там, где working крутится, хуйня. С левой стороны сделать также вставку id сессий с пробелами: идёт чёрточка,
  потом id, потом снова чёрточка. Прямо по левому краю. Сейчас напишу пример.
  -- тут воркинг крутится ------ а тут ID --
  Я бы так сделал, чтобы это было симметрично по левому краю именно, и чтобы между чёрточками и ID был какой-то
  пробел, хотя бы по одному, чтобы можно было нормально вырезать и вставить, скопировать и вставить.»
  He confirmed the side: «По визуальному он должен стоять справа. Я ошибся: не с левого края, а с правого края.
  Слева working, справа ID сессии. Он прижат должен быть к правому краю, а ID к левому краю прижат. Если места нету,
  то он и не отображается, его просто не видно.» So the working status stays at the left where Pi draws it and the
  ID sits at the right end, mirroring Pi's `── ` frame as ` <id> ──`; without room it is not shown at all.
  Engineering choices: the ID is Pi's `sessionManager.getSessionId()`, read on every render; exactly one
  plain space on each side and one uninterrupted muted-colored run, so a terminal selection copies it whole; when Pi's
  own top border (status, retry/compaction status, the up-arrow `N more` hint) would lose text or its trailing rule
  at the reduced width, the ID is dropped whole instead of cut and Pi's border is unchanged. With the bar off or a
  foreign editor in place there is no ID. Reason: the owner's layout and copyable ID without ever degrading Pi's
  status. Carrier: `extensions/RQW-statusbar/editor.ts` `renderTopBorder`, `render.ts` `sessionTopBorder`,
  `index.ts`; contract and proof: `notes/statusbar-omp.md`.
- Tokens per second are the provider's exact output tokens over Pi's own response time, not a live estimate. The
  owner saw `cmp 0 · 44000.0 tok/s` (44 tokens over 1 ms of handler time). Owner: «Смотри, токены в секунду какую-то хуйню показывают.
  Надо как-то привести, чтобы токены в секунду очень хорошо и качественно работали. [...] И по-хорошему, надо
  сделать так, чтобы токены в секунду были залайнены на те показатели, которые отдаёт провайдер, Anthropic либо
  Codex Legacy.» Of his two options he chose: «a) Делим точное число выходных токенов от провайдера на время ответа.
  Время Pi сам меряет точными часами от начала запроса. Ответы короче полсекунды не учитываем. Значение обновляется
  после каждого ответа.» and «Значение обновляется после каждого ответа и держится до следующего.» Rule:
  `usage.output * 1000 / durationMs` per completed assistant message of the main session; `durationMs` is the
  monotonic time Pi's stream measures from the request start. A message with missing or non-positive `output` or
  `durationMs`, `durationMs` under 500 ms, or `stopReason` `aborted` or `error` is skipped (the output count of an
  interrupted response can be incomplete; engineering choice); no chars/4 fallback and no live value while streaming;
  the last qualified value is held until the next, nothing is shown before the first, and session start, tree change
  and toggle reset it. Engineering choices: `usage.output` already includes reasoning tokens, so `usage.reasoning`
  is not added. Reason: neither Anthropic nor Codex returns a tokens-per-second field, so the exact billed count over Pi's own clock is the closest provider-aligned
  number. Carrier: `extensions/RQW-statusbar/{render,index}.ts` `RateMeter`; contract and proof:
  `notes/statusbar-omp.md`.
- Session branch mark: the whole interface is English, so row 3 shows `⑂ fork #N` (`⑂ fork #2`, `⑂ fork #3`) instead of
  the Russian `⑂ ветка N`. Owner, three quotes in order:
  1. «В интерфейсе надо поменять ветка два на branch two, как-нибудь её сделать типа BR2. У нас весь интерфейс должен быть английский.»
  2. «Насчет BR2 я имею в виду, что должен сам придумать пиздатую аббревиатуру, которая будет подходить к нашему дизайну и вписываться в него органично. Допустим, это может быть не BR2, а просто значок ветки и написано V2, V3 или branch V2 написано, V3, что-нибудь такое»
  3. «Мне нравится вариант Fork 2, только надо решетку сделать: fork #2, и все»

  Final mark: `⑂ fork #N`; the glyph, colour role (`label`), the two-space gap and the hiding rules are unchanged, only
  the text after the glyph is `fork #N`. Carrier: `placeRow` in `extensions/RQW-statusbar/render.ts`; proof:
  `extensions/RQW-statusbar/test/chrome.test.ts`, `lifecycle.test.ts`.

## Anthropic package integration

- Coordinator integration brief (C:3376), not a direct owner quotation: integrate RQW-anthropic with the eight
  existing extensions and use authenticated fake allowed providers without weakening isolation assertions.
  Underlying owner requests: adapter C:3133, provider visibility C:3171, independent modules C:3046. The manifest keeps the eight main extensions
  followed by RQW-anthropic. Package fixtures use fake authenticated allowed providers, not a visibility
  bypass. The dynamic isolation assertions are unchanged. Source order, unauthenticated startup,
  Opus medium with mock secrets, full-package login visibility and the stock fallback with the adapter or
  RQW-models switched off, and each of RQW-anthropic and RQW-providers switched off alone, are covered in
  `test/anthropic-models.test.ts`. Semantic test changes for independent review and
  offline proof boundaries: `notes/anthropic-integration.md`.
- Integration proof uses offline fixtures only; it does not establish live auth, subscription acceptance or billing.
  The owner's old Claude campaign pause C:3244 remains in force, not a ban on Claude workers. Historical local results and their boundaries are recorded in
  `notes/anthropic-integration.md`, not a standing prohibition on independent review or normal branch delivery.

## Scroll

- Escape in Pi's fullscreen (alt-screen) view returns a scrolled-up transcript to the latest message, as in Codex.
  Owner (`2026-10-21T12-13-54-289Z_01a15e61-dcf1-7476-b1d6-42f03584b9e6.jsonl` line 53): «Да, я также бы хотел
  перенастроить хоткеи, чтобы когда я скролю, jump to last message было на Escape»; line 77: «Хотя бы должен быть
  какой-то адекватный хоткей, который будет перехватываться всеми браузерами нормально. И чтобы он не конфликтовал с
  другими хоткеями.» In `2026-10-21T16-27-59-062Z_01a15f4a-7ad5-7377-81be-0baf3b6ffa33.jsonl` the question batch
  (line 78) offered 1a: Escape jumps down only when scrolled up, at the bottom Escape stays as before, Ctrl+End stays,
  an open transcript search takes the first Escape. The owner chose it (line 100): «Сделай Escape просто, что когда я
  открыл вверх, я Escape нажимаю, как в кодексе. В кодексе ты когда scroll вверх делаешь, нажимаешь Escape, и он тебя
  возвращает в самый низ чата. Так же сделай». Package behavior for every my-pi user (2a, not the personal
  `keybindings.json`) is the batch's stated default for an unanswered question, and option 1a requires it.
- Carrier: `extensions/RQW-scroll/index.ts`, its own extension, listed in `package.json` `pi.extensions`; switched off
  alone like every `RQW-*` extension ([INSTALL.md](INSTALL.md#switch-one-extension-off), [Isolation](#isolation)).
  Reason for a new folder: the behavior belongs to no existing extension, and `RQW-statusbar` is being changed by
  separate work.
- Mechanism (engineering choice). Binding `escape` to Pi's `tui.altScreen.bottom` is rejected: Pi's viewport consumes
  that key even at the bottom, so Escape would no longer interrupt. Instead the extension adds a terminal input
  listener (`ctx.ui.onTerminalInput`). Pi runs the alt-screen viewport listener first, so its own keys (search close,
  Ctrl+End, paging) keep priority; the extension listener sees Escape before the focused component. It consumes a
  press only when all hold: the renderer is `fullscreen`; the transcript does not follow its end (`isFollowingOutput`
  false, exactly when Pi shows "Jump to latest message"); the focused component is Pi's main editor (a
  `CustomEditor`, detected by its `actionHandlers` map the way Pi does) without an open autocomplete list. It then calls
  the renderer's `scrollToBottom()`. Otherwise Escape is untouched: at the bottom it interrupts, double-Escape and every
  other stock meaning stay; selectors in the editor slot, dialogs, focused overlays and the autocomplete list keep
  their own Escape; inline mode and print, JSON and RPC modes are unchanged. The TUI is reached through the public
  widget factory (a `belowEditor` widget that renders no line), which receives Pi's proxy to the current renderer, so
  a switch between inline and fullscreen is followed. Key releases are not consumed.
- The fullscreen hint includes `Esc` alongside the configured bottom keys (by default `Esc/Ctrl+End`) when Escape
  can jump. Owner: «Нашел баг: не Escape мы возвращаемся уже, а в надписи написано старый hotkey.» Reason: the hint
  must advertise the extension's Escape behavior, not just Pi's stock shortcut. Engineering choice and carrier:
  `extensions/RQW-scroll/index.ts` replaces the public `getKeybindings`/`setKeybindings` registry with a display
  facade. Only `getKeys("tui.altScreen.bottom")` is decorated, and only while Escape can jump; matching and all
  configuration operations delegate to the unchanged manager. Pi formats those keys itself; no renderer patch,
  fork, private hint-field write or Escape binding is needed. Shutdown deactivates the facade and restores the
  prior registry if it still owns the slot; another registry replacement is not overwritten.
- Limits: a custom editor that does not extend `CustomEditor` gets stock Escape. With search open, the first Escape
  closes search and the second jumps down. Pi's keybinding registry is process-global; the display facade follows
  its owning interactive renderer, as does Pi's own registry.
- Proof: `extensions/RQW-scroll/test/scroll.test.ts` (in `npm test`), with Pi's real renderers and proxy
  (`createInteractiveTui`, `createInteractiveTuiReference`), chat viewport, `CustomEditor`,
  `ExtensionSelectorComponent`, overlay and transcript search, the extension loaded by Pi's resource loader and keys fed
  through the terminal input callback: scrolled up, Escape jumps and is consumed, the next Escape interrupts; at the
  bottom Escape interrupts; Ctrl+End still jumps; selector, overlay, autocomplete and search keep their Escape; inline
  mode, the extension not loaded and after `session_shutdown` give stock Escape. Real fullscreen screen lines
  prove the hint includes `Esc`, retains configured bottom keys, and is stock without the extension and after
  shutdown; direct registry assertions prove Escape is not bound and the original manager is unchanged. A local PTY probe of the real CLI in
  fullscreen with `doubleEscapeAction: fork` confirmed the InteractiveMode wiring: scrolled up, a quick Escape pair
  jumped down without the fork notice; the next pair at the bottom showed it.

## Session commands

- Owner: «И по-хорошему надо какую-нибудь команду вбить, типа COPY SESSION ID. И надо ещё добавить команду remove сессии, как в кодексе, чтобы можно было написать /remove и удалить полностью эту сессию со всей историей, со всей хуйнёй, которая с ней связана.
Как будто нахуй ее и не было»
  Carrier: `extensions/RQW-session/{index,artifacts}.ts`, listed independently in `package.json`.
  Reason: make session IDs usable without selecting terminal text and provide explicit permanent local deletion.
  `/copy-session` avoids Pi's built-in `/copy` collision and calls Pi's exported clipboard implementation unchanged;
  `/remove` uses one `ctx.ui.select`, refuses without UI, and uses `ctx.newSession({withSession})` before deletion
  so old writers and shutdown hooks finish and notifications use a fresh context. Detailed cleanup and clipboard
  contract: `extensions/RQW-session/README.md`; no statusbar change in this extension.
- Owner: «Просто надо сделать /copy session команду, чтобы я мог её просто скопировать в буфер обмена и всё.»
  Carrier: `extensions/RQW-session/index.ts`; coordinator-specified slash spelling: `/copy-session`.
  Reason: expose one direct session-copy command while leaving stock `/copy` intact.
- Owner: «После remove сессия удаляется, но совсем, полностью без корзины, и сразу открывается новая пустая сессия, как ты предложил. Потом подтверждение удалению один раз. Просто на экране поднять визуально, как в кодексе открыть диалог с вопросом «да/нет?». Циферка один по дефолту — нет, по не дефолту — да. То есть циферка один — нет, циферка два — да. И мне, чтобы удалить, надо нажать стрелочку вниз и Enter. Это если у тебя есть SDK для того, чтобы такие диалоги открывать.»
  Carrier: `extensions/RQW-session/index.ts`, Pi's public `ctx.ui.select`; exact dialog contract is in the extension
  README. Reason: default to refusal, require an affirmative selection, and use native keyboard behavior rather than
  custom key handling. Pi 1.3.0's `ExtensionSelectorComponent` starts at index 0; deterministic tests feed Enter,
  Escape and Down then Enter through that real component and the command handler.
- Coordinator-approved scope, not a verbatim owner quotation: delete the current JSONL plus referenced artifact files
  not referenced by other sessions, preserving user forks and shared artifacts. Artifact deletion is restricted to
  Pi-generated basenames inside OS temp, never arbitrary `fullOutputPath` values. The agent directory is only a session
  validation/discovery root, not an additional artifact root. No symlink escape, directories or unrelated files;
  JSONL outside the agent directory is refused. No ownership tracking or edits to RQW-agent/RQW-review. Pi's randomly named unreferenced temp files,
  including in-memory subagent/reviewer spills, are not attributable and remain for OS temp cleanup. This is an explicit
  limitation, not a claim of complete erasure of every byte Pi ever produced. Reason: no safe session ownership map
  exists for those files; wildcard temp deletion would destroy unrelated session data. Mechanism and limits live in the
  extension README. `test/isolation.test.ts` includes the extension automatically through the manifest.
- Accepted code-review fixes: `extensions/RQW-session/artifacts.ts` preflights other sessions before replacement,
  so read/discovery errors leave the current session active and identify the offending file. Malformed JSONL lines
  are tolerated like Pi; their raw text is scanned conservatively with JSON escapes decoded to protect shared paths.
  Each string/line is normalized once in a streamed asynchronous scan with one combined path search; canonical
  identity sets replace the artifact-by-alias transcript rescans. The final outgoing JSONL is read after shutdown.
  Reason: avoid credential/unrelated-file deletion, support interrupted session tails and keep long scans responsive.
  Generated-name rules, precise cleanup boundary and failure behavior live in `extensions/RQW-session/README.md`.
- Pi 1.4.0 research: `dist/utils/output-files.js` creates random-named OS-temp outputs with no session ID;
  `dist/core/session-manager.js` stores names/labels/history in JSONL and discovers recent files by mtime;
  `dist/modes/interactive/components/session-selector.js` tries `trash` then unlink, which does not meet permanent-delete
  semantics. RQW-agent and RQW-review create in-memory child sessions; RQW-statusbar has no per-session persistence;
  RQW-anthropic's install ID is global, not deletable session data. Pi's `dist/utils/clipboard.js` uses native/clip on
  Windows and emits OSC 52 for remote markers or `PI_CLIPBOARD_OSC52=1`, not simply because VS Code is present.
- Codex comparison, read-only `codex-harness` `upstream/main`,
  `codex-rs/thread-store/src/local/delete_thread.rs`: hard deletion stops writers, removes active/archived plain and
  compressed rollouts, materialized history, name-index entries and state rows, and invokes host-data cleanup.
  It refuses external fork-history references. Pi has no equivalent database or reference-index sidecars; this extension
  preserves Pi's independent fork JSONLs and shared referenced files instead. These are different storage models.
- Deterministic proof: `extensions/RQW-session/test/session.test.ts` uses temp agent directories and a stub clipboard,
  confirms refusal paths, artifact/fork preservation and path safety, and replaces a real Pi runtime before deleting
  its old JSONL. This proves mechanics, not live VDI clipboard redirection, forensic erasure or remote-provider deletion.

## Send now

- Enter force-sends queued steering, as in oh-my-pi. Owner: «А ещё надо, чтобы у нас работала, как в OMP, Oh My Pie,
  отправка: я пишу сообщение, оно стоит в очереди на стекинг, и чтобы я мог через Enter его насильно отправить. Я не
  разобрался, как в Pi это сделать.»; «Мне надо, чтобы в Py я мог нажать Enter и сообщение ушло, чтобы не нажимать
  ебучие Escape, Enter. Это какой-то рак мозга, мне кажется. Надо проверить, можем мы сделать это или нет. Если
  можем, надо сделать». Agreed behavior (coordinator brief, not a literal quote): while the agent works, Enter with
  text queues steering as stock Pi does; Enter on an empty editor while steering is queued interrupts the turn and
  sends the queue at once; with nothing queued empty Enter does nothing; no other key changes.
  Reason: stock Pi 1.4.0 needs Escape (which moves the queue back into the editor and aborts) and then Enter.
  Carrier: independent `extensions/RQW-send-now/index.ts`, listed in `package.json` `pi.extensions`, switchable off
  alone ([Isolation](#isolation)). Behavior, mechanism and limits: `extensions/RQW-send-now/README.md`.
- Engineering choices within that outcome: public Pi API only (`ctx.ui.onTerminalInput`, `ctx.abort`, editor
  text, `pi.sendUserMessage`), no custom editor, since RQW-statusbar owns `setEditorComponent`. The key is Pi's
  configured `tui.input.submit`. Only Pi's input editor (`CustomEditor` or a subclass) with focus triggers it, so
  dialogs, selectors and overlays keep their Enter. Steering is told apart from follow-ups by counting `input`
  events, because Pi exposes only "anything queued"; inputs still on their way to Pi's queue (until the next
  event-loop turn) and a run's own starting prompt are accounted for, and anything left in Pi's queue after the
  abort is sent, or restored to the editor if the session ends first; a follow-up-only queue is left to Pi, as
  oh-my-pi does not resume one after an interrupt. Unsent text returns to the editor when no model is selected or
  the session ends before the interrupted run settles. Counting stays because the public extension context reports
  only whether anything is queued, not the steering and follow-up queues themselves.
- Closer oh-my-pi parity, taken because it is small and public: Pi's pi-ai drops an aborted reply from the next
  request, oh-my-pi keeps it. For the reply a force-send interrupts, a `context_with_system` handler replays its
  text as a finished reply; a session custom entry `rqw-send-now` keeps that across resume and `/reload`. Thinking
  and unfinished tool calls of that reply are dropped. No completed tool results are at stake: Pi runs tools only
  after a reply completes, and an abort during tool execution keeps the reply and its results.
- Limits (details in the README): several queued messages, follow-ups queued with them included, go as one
  message joined by blank lines; Pi's queue restore is text only, so images an extension attached to steering and
  custom messages in Pi's agent queue are dropped as with Escape; a steering input swallowed by another
  extension's `input` handler can leave the count stale until the queue empties. Proof: Pi's real `InteractiveMode`
  on a scripted terminal with a faux streaming model, `extensions/RQW-send-now/test/send-now.test.ts`, in `npm test`
  and the Windows CI matrix.

## Providers

- Provider hiding is its own extension. Owner question, answer «7a»: «Скрытие лишних провайдеров.
  Сейчас его делает расширение Anthropic. Если его выключить, скрытие пропадёт. a) Вынести скрытие в отдельное
  расширение». Reason: hiding the other providers is a policy of its own (the visible set is the owner's rule from
  [Anthropic subscription adapter](#anthropic-subscription-adapter), C:3171 and the `openai` clarification there) and
  must not vanish when the Anthropic transport is switched off; switching either off alone is the rule of
  [Isolation](#isolation).
  Carrier: `extensions/RQW-providers/index.ts`, listed last in `package.json` `pi.extensions`.
- Same behaviour as before, now with its own tests (`extensions/RQW-providers/test/providers.test.ts`): only `anthropic`
  and `openai-codex` in login, pickers, `--list-models` and scoped models; credentials stay; the policy covers only a
  runtime with an owning session of this extension, so loading alone or an unrelated runtime keeps Pi's lists. The
  Anthropic extension keeps only the transport: `registration.ts` (conflict guard, credential-store binding and request
  auth boundary), recovery, cache. It no longer filters anything, so with only `RQW-anthropic` on, Pi lists every provider.
- Engineering choices: ownership comes from the patched `AgentSession._bindExtensionCore`, because Pi emits no event
  before `--list-models` and `/reload` of a host without bindings emits no `session_start`; liveness is read from Pi's
  extension API going stale, and the patched `AgentSession.dispose` releases the disposed session's instances. Both
  extensions wrap `_bindExtensionCore` and `dispose`, and `RQW-anthropic`'s lifecycle restores Pi's own methods when its
  last owner leaves, so each load of this extension checks its wrapper is still in the slots and wraps again if not
  (`test/providers-anthropic.test.ts`). Pi's restore is last-in-first-out, so the manifest keeps this extension after
  `RQW-anthropic`, and an inert wrapper may stay in the other order (limits: `extensions/RQW-providers/README.md`). Mechanism research: `notes/anthropic-adapter.md`.

## Quality control

The rules for Main and workers are in [PROCESS.md](PROCESS.md#quality-control-loop); the design and its evidence are
in the approved proposal (not stored in this repository). The loop reads only public GitHub state.

- Scheduled full regression. Owner: «надо заебашить CI/CD, чтобы у нас тесты наши, полный regress запускался
  постоянно, каждые три-четыре часа.» and «Может быть, эти тесты запускаются не четыре часа, а раз в два часа,
  допустим.» Decision: `tests.yml` runs on `main` every 2 hours (cron `17 */2 * * *`, off the top of the hour because
  GitHub drops queued scheduled jobs at high load), `pcli.yml` daily at 03:43 UTC. Task branches get no scheduled
  reruns and nothing retries automatically: an unchanged head is not rerun
  ([Sufficient proof](PROCESS.md#sufficient-proof-without-idle-reruns)). Reason: `main` itself was never tested;
  repeated runs of the same SHA give a free failure rate and catch drift in floating inputs (`macos-latest`,
  `windows-latest`, Node 24, PortableGit). The repo is public, so standard runners bill nothing; the real cost is
  macOS slot contention. Carrier: `.github/workflows/tests.yml`, `.github/workflows/pcli.yml`.
- Failure inbox. Owner: «нужно сделать какую-то систему алертинга, какую-то копилку, куда приходят эти падения, и ты
  проверяешь падения, их разбираешь потом и дорабатываешь в соответствии со всеми нашими требованиями» and «каждая
  ветка, каждый commit, каждый push в себе хранит историю именно каждой отдельной задачи, и ты в соответствии с ней
  сможешь всё это дело залайнить и пофиксить тесты». Decision: one GitHub issue per failure signature, label
  `qa-inbox`, written by `qa-inbox.yml` after every completed `main` run (schedule or dispatch) of `tests`, `pcli`
  and `codex-oracle`; every attempt of a run is read, so a manual rerun cannot hide the first failure. The bot owns the
  body and rewrites it in place, never comments, so updates notify nobody. An issue closes only with a `QA: #N` fix
  on `main` and max(6, ceil(3/p)) green scheduled runs after it; each pass also picks up failed `main` runs of the
  last 48 hours that no issue records, so a dropped pass heals; a signature that stopped without a fix closes only
  with a written explanation by Main. Reason: an issue per signature is the link target for `QA: #N`, dedupes one
  bug on several jobs, and keeps state without a server; closing by silence would hide flakes. Carrier:
  `scripts/qa-inbox.mjs`, `scripts/qa-state.mjs`, `.github/workflows/qa-inbox.yml`.
- Public issues. Decision (engineering choice, from the proposal): the inbox lives as issues in the public repo.
  Reason: test logs and artifacts are already public, and tests use fake credentials and no network
  (`test/no-network.mjs`), so no secrets are expected in evidence. A private inbox would need a second repository.
- Email digest, failures only. Owner: «И мне пусть приходит на почту оповещение о том, что тесты упали, допустим, раз
  в сутки или два раза в сутки.» and «они будут запускаться, мне будут приходить отчеты о падениях, именно о падениях,
  а я буду тебе об этом сообщать сам.» Owner answers «1а 2а 3а (но нужна инструкция) 4а» to the questions
  1a «Адрес `chuark@gmail.com`, пароль приложения Gmail сохраняем в секреты репозитория.» and 2a «В 09:30 и 21:30 по
  Москве.» Decision: `qa-digest.yml` runs at 09:30 and 21:30 Moscow time (cron `30 6 * * *` and `30 18 * * *` UTC)
  and sends one mail through Gmail SMTP with `curl`, only when something failed in its window: a new or recurring
  inbox issue, a failed `main` run, or a failed `qa-inbox.yml` run. The window starts at the previous successful
  scheduled digest run (at most 48 hours back, 12 hours when there is none), so no failure falls between two mails.
  Nothing failed: no mail. Secrets:
  `QA_SMTP_USER`, `QA_SMTP_PASSWORD` (a Gmail app password), `QA_MAIL_TO`. Missing secrets fail the job loudly on
  every scheduled run. Reason: SMTP from the workflow does not depend on GitHub notification settings; the owner
  relays what he gets. Carrier: `scripts/qa-digest.mjs`, `.github/workflows/qa-digest.yml`. The owner's steps are in
  a separate instruction outside the repository.
- GitHub's own Actions emails. Owner: «1а 2а 3а (но нужна инструкция) 4а», where 3a is «Ты переключаешь уведомления
  Actions на «только в GitHub», остаётся только наша сводка.» Decision: the owner switches Settings, Notifications,
  Actions to "On GitHub" only. Reason: GitHub mails every completed scheduled run to the user who created the
  workflow, with no digest, up to 12 mails a day at a 2-hour cadence; the setting also covers his branch runs.
  Carrier: the owner's account setting, not a file; nothing in the repository can check it.
- Red `main` does not block merges. Owner answer 4a: «Слияния не блокируются, проверка перед слиянием только
  показывает открытые падения.» Decision: `deliver-check` lists open `qa-inbox` issues and never fails on them;
  it does fail when a `QA: #N` line names an issue that is not in the inbox. Reason: a flaky or drifting `main` must
  not freeze unrelated work, while Main still sees what is open. Carrier: `scripts/deliver-check.mjs`.
- Awareness without a permanent process. Owner: «И ты периодически проверял в процессе работы, не типа отдельно
  воркером проверял, а чтобы ты проверял в рамках работы над задачей. Новую задачу ставишь, и чтобы автоматически
  тебе приходило состояние, когда ты работаешь с бранчой, о том, что нужно проверить запуски CI/CD.» and «И ты сам
  тоже можешь проверять, если ты в процессе работы находишься, если ты сейчас онлайн. Это не должен быть
  постоянный, перманентно висящий процесс». Decision: no daemon,
  timer or local cron. `scripts/qa-status.mjs` makes one bounded `gh` round (`npm run qa-status`, for workers); the
  dev-only, repo-local `.pi/extensions/qa-status/` shows a message on session start and on a changed red state, and
  `/qa` shows the full view. Main reads the status at task start, tells the owner in one line about a red scheduled
  `main` and triages it. Reason: the extension is useless outside this repository and must not ship in the
  package, so it is not an `RQW-*` extension and is not in `pi.extensions`; a failed `gh` call is reported as
  unavailable, never as green. Carrier: `.pi/extensions/qa-status/index.ts`, `scripts/qa-status.mjs`,
  [PROCESS.md](PROCESS.md#quality-control-loop).
- Test integrity. Owner: «нужно именно обеспечивать качество, а не фальсифицировать работу, чтобы тесты были зелёные. Это супер
  критически важно, потому что эти тесты и вся наша работа — это всё обеспечение контроля качества.» and «Можно даже
  ревьюера поднимать, который перепроверяет тесты.» Decision: before any fix Main records a triage
  class (product bug, test bug, infra, drift) with evidence; a fixed list of weakening changes is forbidden without
  proof; a fix needs red-before/green-after in CI logs, and an intermittent one repeat runs with (1-p)^n < 0.05 (generic repeat harness `codemode-stress.yml`).
  A reviewer subagent with `.agents/reviewers/test-integrity.md` as its whole `system` checks every QA fix and every
  test or workflow change that weakens a check; `deliver-check` detects that case and requires the trailers
  `Test-change:` and `Test-review: agent#N CLEAN` (exact conditions: [PROCESS.md](PROCESS.md#quality-control-loop)). Reason: the aim is a working
  product, not a green badge; a weakened assertion turns a real failure into silence. Carrier: `PROCESS.md`,
  `.agents/reviewers/test-integrity.md`, `scripts/deliver-check.mjs`.
- `codex-oracle.yml` schedule is deferred. Accepted earlier: daily once on `main`. Its file exists only on the
  `rqw-codex` branch, so no schedule hook is added now; `qa-state.mjs` and `qa-inbox.yml` already accept the workflow
  name `codex-oracle`. Deferred work: the `rqw-codex` task adds `schedule` (daily) when it lands on `main`.
