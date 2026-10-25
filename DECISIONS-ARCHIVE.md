# my-pi: decisions archive

Append-only record of superseded and obsolete entries removed from [DECISIONS.md](DECISIONS.md). Current rules are
in `DECISIONS.md`; this file is only for checking history. Each block is the text exactly as it was in
`DECISIONS.md` at `30952e6`, with `> ` added at the start of each line. Do not edit a block after it is added.

## A-0001 · archived 2026-10-23 · Work policy · Old development worker models (Sonnet medium/high/xhigh, Opus low only)

Status: SUPERSEDED by `[D-WORK-MODELS]` (DECISIONS.md#work-policy).
Introduced: `8f2ea64`. Superseded: `57fa3ff`. Archived by: the coordinator-guard change.
Verbatim text as it was in DECISIONS.md at `30952e6`, lines 19-21:

> - (Superseded, see the current rule below.) Development workers, including subagents, were authorized to use
>   Sonnet medium/high/xhigh, Opus low only and GPT-6.1-Sol low/medium/high. This is development routing only, not a product model configuration or permission to add other
>   GPT models. Product review `LEVELS` remain Haiku 5.5 medium / Sonnet 5.5 low.

## A-0002 · archived 2026-10-23 · Work policy · Claude limit: Sonnet only, Opus low and medium removed

Status: SUPERSEDED by `[D-WORK-MODELS]` (DECISIONS.md#work-policy).
Introduced: `47868b0`. Superseded: `57fa3ff`. Archived by: the coordinator-guard change.
Verbatim text as it was in DECISIONS.md at `30952e6`, lines 22-24:

> - Owner: «Что-то подписка Cloud Code жёстко высаживается, поэтому давай пока уберём из работы саб-агентов Opus Low и Opus Medium. Давай оставим Sonnet Medium, Sonnet High, Sonnet Extra High. Для сложных задач будет Sonnet Extra High либо Opus Low. Opus Medium убираем вообще пока. Окей. Это надо скорректировать, отразить и сразу в работу внедрить»
>   Reason: the Claude subscription limit is running out; the restriction is temporary ("for now"). The balance rule
>   between Anthropic and GPT stays. Superseded by the next entry.

## A-0003 · archived 2026-10-23 · Work policy · Development worker models and parallel limit (Opus low or Sol low for ordinary work)

Status: SUPERSEDED by `[D-WORK-MODELS]` (DECISIONS.md#work-policy) and `[D-WORK-PARALLEL]` for the parallel limit.
Introduced: `57fa3ff`. Superseded: `0179c98` (model assignment; the parallel limit continues as `[D-WORK-PARALLEL]`). Archived by: the coordinator-guard change.
Verbatim text as it was in DECISIONS.md at `30952e6`, lines 25-39:

Note: the first five quotes are paragraphs of one owner message (session file `2026-10-21T16-27-59-062Z_01a15f4a-7ad5-7377-81be-0baf3b6ffa33.jsonl`, line 2462); the sixth is the whole message at line 2464.

> - Development worker models and parallel limit. The parallel limit below is current; the model assignment is
>   superseded by the next entry. Owner, in order:
>   «ТАк вот все верно там написано давай не выдумывай хуйню»
>   «Одновременно до 10 первого уровня, вложенные похуй»
>   «модели - Соннет хай, и опус лоу / 6-1 лоу и медиум»
>   «опус и 6-1 лоу для обычной работы, для сложной хай соннет и медиум 6-1»
>   «вот так хочу переделать эту часть»
>   «блять не для сложных сделай опус медиум все таки»
>   Rule at that time (model assignment superseded by the next entry): ordinary work uses Opus 5.5 low or GPT-6.1-Sol low;
>   complex work uses Sonnet 5.5 high, Opus 5.5 medium or GPT-6.1-Sol medium; no other models or levels for
>   development workers. Current: at most 10 first-level subagents (started
>   by the coordinator) run in parallel; nested subagents do not count; a ceiling, not a quota. The even
>   Anthropic/GPT balance stays. Product review `LEVELS` are unchanged.
>   Reason: owner decision. The limit is carried by [PROCESS.md, Isolated parallel execution](PROCESS.md#isolated-parallel-execution)
>   and `AGENTS.md`.

## A-0004 · archived 2026-10-23 · Work policy · Development worker models, 2026-10-23 rule (simple Sonnet high, complex Opus medium)

Status: SUPERSEDED by `[D-WORK-MODELS]` (DECISIONS.md#work-policy).
Introduced: `0179c98`. Superseded: the coordinator-guard change. Archived by: the coordinator-guard change.
Verbatim text as it was in DECISIONS.md at `30952e6`, lines 40-46:

Note: the quote is not byte-exact. The owner's whole message (same session file, line 2487) reads «сложная работу опус медиум простая работа сонет хай».

> - Development worker models, current rule, correcting the previous entry. Owner (verbatim, after the quotes above):
>   «сложная работа опус медиум простая работа сонет хай»
>   Coordinator interpretation (the owner may correct it): Claude side, simple work is Sonnet 5.5 high and complex work
>   is Opus 5.5 medium; GPT side unchanged, simple is GPT-6.1-Sol low and complex is GPT-6.1-Sol medium. Opus low,
>   Sonnet medium/xhigh and Sol high are not allowed for development workers; no other models or levels. The limit of 10
>   first-level subagents and the even Anthropic/GPT balance stay. Product review `LEVELS` are unchanged.
>   Reason: owner decision. Carried by [PROCESS.md, Worker models](PROCESS.md#worker-models) (the table).

## A-0005 · archived 2026-10-23 · Preamble · Provenance and C:<line> convention

Archive additions use the same original-line format. The frozen source is still
`30952e6:DECISIONS.md`. Append entries, never rewrite them. A dead link outside frozen
source may be repaired only with an appended correction note naming its old target, new
target and reason. The exact docs-cleanup commit is recoverable from each permanent ID
with `git log -S'A-ID' -- DECISIONS-ARCHIVE.md`; substitute the numeric ID.

Status: SUPERSEDED by the new preamble of DECISIONS.md (provenance, locators, IDs).
Introduced: `7d89c6a`. Archived by: docs-cleanup (this cleanup; exact commit recoverable with `git log -S'A-0005' -- DECISIONS-ARCHIVE.md`).
Verbatim text as it was in `DECISIONS.md` at `30952e6`, lines 3-9:

> Every accepted decision, with its reason and the file that carries it.
>
> Provenance: owner/user quotations are the owner's words; request summaries are not literal quotations.
> Engineering decisions and coordinator implementation briefs record the agents' choices, not direct owner approval
> of each detail. They do not narrow the owner's requirements. `C:<line>` refers to the raw conversation
> `2026-10-20T13-55-12-982Z_01a15998-41d6-76f4-be02-a0e599d0c214.jsonl`, physical JSONL line.
> The source remains outside this repository; no transcript or credentials are copied here.

## A-0006 · archived 2026-10-23 · Work policy · Section introduction

Status: SUPERSEDED by the new Work policy introduction.
Introduced: `8f2ea64`. Archived by: docs-cleanup (this cleanup; exact commit recoverable with `git log -S'A-0006' -- DECISIONS-ARCHIVE.md`).
Verbatim text as it was in `DECISIONS.md` at `30952e6`, lines 13-14:

> Current accepted development policy (request summaries unless quoted); detailed task rituals belong in
> [PROCESS.md](PROCESS.md), not a history ledger here.

## A-0007 · archived 2026-10-23 · Work policy · Main is the coordinator

Status: SUPERSEDED by `[D-WORK-COORDINATOR]` (rewritten in the docs-cleanup format).
Introduced: `4d8c004`. Archived by: docs-cleanup (this cleanup; exact commit recoverable with `git log -S'A-0007' -- DECISIONS-ARCHIVE.md`).
Verbatim text as it was in `DECISIONS.md` at `30952e6`, lines 16-18:

> - Main is the coordinator, not an independent implementer: «Да, он как техлид/тимлид, координатор, но не исполнитель самостоятельный.»
>   Reason: keep orchestration and acceptance with Main and actual execution with worker subagents. The procedure
>   is carried by [PROCESS.md](PROCESS.md).

## A-0008 · archived 2026-10-23 · Work policy · Anthropic/GPT balance

Status: SUPERSEDED by `[D-WORK-BALANCE]` (rewritten in the docs-cleanup format).
Introduced: `a7146ae`. Archived by: docs-cleanup (this cleanup; exact commit recoverable with `git log -S'A-0008' -- DECISIONS-ARCHIVE.md`).
Verbatim text as it was in `DECISIONS.md` at `30952e6`, lines 47-48:

> - Owner: «Смотри, надо скорректировать так, чтобы ты как координатор поровну поднимал модели из Anthropic и GPT, чтобы не было перевеса в другим, дисбаланса. Поднимай саб-агенты и те, и те, чтобы лимит расходовался равномерно. И зафиксирую это в процесс.nd файле, эту информацию на будущее»
>   Reason: even use of both subscriptions' limits. Carried by [PROCESS.md, Worker models](PROCESS.md#worker-models).

## A-0009 · archived 2026-10-23 · Work policy · Old paused Claude benchmark campaigns

Status: OBSOLETE: the old paused Claude benchmark/tuning campaigns are dead, superseded by the v3 benchmark work (approved docs-cleanup scope). No active replacement.
Introduced: `8f2ea64`. Archived by: docs-cleanup (this cleanup; exact commit recoverable with `git log -S'A-0009' -- DECISIONS-ARCHIVE.md`).
Verbatim text as it was in `DECISIONS.md` at `30952e6`, lines 49-50:

> - The old paused Claude benchmark/tuning campaigns remain paused until explicitly resumed; saved results stay.
>   That campaign pause does not forbid Claude workers, independent review or other authorized Claude+GPT work.

## A-0010 · archived 2026-10-23 · Work policy · PROCESS.md link and manifesto

Status: SUPERSEDED by `[D-WORK-PROCESS-LINK]` (rewritten in the docs-cleanup format).
Introduced: `8f2ea64`. Archived by: docs-cleanup (this cleanup; exact commit recoverable with `git log -S'A-0010' -- DECISIONS-ARCHIVE.md`).
Verbatim text as it was in `DECISIONS.md` at `30952e6`, lines 51-54:

> - The owner accepted a `PROCESS.md` link in `AGENTS.md` with mandatory lazy reading at every task and context
>   restoration. Procedural rules belong in `PROCESS.md`. `WORKFLOW-MANIFEST.md` is the owner's personal lifelong
>   record and aspiration, not workflow commands, a gate or an overriding procedure: «Манифест того, как я делаю
>   свою личную работу.»

## A-0011 · archived 2026-10-23 · Work policy · Research first, ask, no invented agreement

Status: SUPERSEDED by `[D-WORK-AGREEMENT]` (rewritten in the docs-cleanup format).
Introduced: `8f2ea64`. Archived by: docs-cleanup (this cleanup; exact commit recoverable with `git log -S'A-0011' -- DECISIONS-ARCHIVE.md`).
Verbatim text as it was in `DECISIONS.md` at `30952e6`, lines 55-57:

> - Research in parallel first, then ask about all real ambiguity. The owner's answers start autonomous execution;
>   do not invent agreement or decide for the customer: «Если чего-то согласовано не было, додумывать это нельзя
>   ни в коем случае никогда.»; «Я сам лично не принимаю решения за заказчика, потому что я не имею на это permission.»

## A-0012 · archived 2026-10-23 · Work policy · Task branches, squash, history in Git

Status: SUPERSEDED by `[D-WORK-BRANCHES]` (rewritten in the docs-cleanup format).
Introduced: `8f2ea64`. Archived by: docs-cleanup (this cleanup; exact commit recoverable with `git log -S'A-0012' -- DECISIONS-ARCHIVE.md`).
Verbatim text as it was in `DECISIONS.md` at `30952e6`, lines 58-60:

> - Work on a task's own branch and worktree at `../my-pi-worktrees/<task>`. Stage exact paths and make task-branch
>   commits without an extra gate; finish with a squash into `main` and branch/worktree cleanup. History belongs
>   in Git (owner: «История хранится в гиде.»), not a duplicate documentation ledger. See `PROCESS.md` for delivery details.

## A-0013 · archived 2026-10-23 · Work policy · Non-blocking coordinator, limits 40 and 50

Status: SUPERSEDED by `[D-WORK-PARALLEL]`: the limits 40 and 50 are replaced by 10 (`57fa3ff`).
Introduced: `47868b0`. Archived by: docs-cleanup (this cleanup; exact commit recoverable with `git log -S'A-0013' -- DECISIONS-ARCHIVE.md`).
Verbatim text as it was in `DECISIONS.md` at `30952e6`, lines 61-68:

> - Owner: «И почему у тебя основной поток заблокирован, блядь? Почему у тебя основной поток исполнения заблокирован какой-то хуйнёй? Заблокирован какими-то запусками, тестами или что это такое, блядь, где ты по 20 секунд GitHub Review Run делаешь. Это что такое, нахуй? Ты не должен блокировать основной поток исполнения какой-то работой блокирующей. Ты всё делаешь через саб-агентов. Саб-агентов можешь поднимать до 40 штук параллельно.»
>   Reason: Main must stay free to coordinate and talk to the owner. It never blocks its own thread on waits,
>   polling, CI watching, test runs or other long work; subagents do it. The parallel limit is now up to 10
>   first-level subagents (nested ones do not count), not as an artificial quota; see the worker models entry above. Carried by
>   [PROCESS.md, Isolated parallel execution](PROCESS.md#isolated-parallel-execution).
>   Later owner update of the limit, to be known to the agent at the prompt level: «Зафиксируй, пожалуйста, до 50 саб-агентов на уровне промта, на уровне Process MD, на уровне знания агента об этом, чтобы потом в будущем я это не напоминал опять и опять.»
>   The limit is stated in `PROCESS.md` and, as a short line, in `AGENTS.md` (project instructions loaded into every
>   agent session of this repo); the product prompt `extensions/RQW-prompt/SYSTEM.md` is unchanged.

## A-0014 · archived 2026-10-23 · Work policy · Preserve changes, temp files, no forks

Status: SUPERSEDED by `[D-WORK-HYGIENE]` (rewritten in the docs-cleanup format).
Introduced: `8f2ea64`. Archived by: docs-cleanup (this cleanup; exact commit recoverable with `git log -S'A-0014' -- DECISIONS-ARCHIVE.md`).
Verbatim text as it was in `DECISIONS.md` at `30952e6`, lines 69-70:

> - Preserve the user's changes and secrets; do not fix unrelated failures. Temporary files belong in OS temporary
>   storage. No forks.

## A-0015 · archived 2026-10-23 · Work policy · CPU-heavy checks in CI, saved logs

Status: SUPERSEDED by `[D-WORK-CI-LOGS]` (rewritten in the docs-cleanup format).
Introduced: `fb322d9`. Archived by: docs-cleanup (this cleanup; exact commit recoverable with `git log -S'A-0015' -- DECISIONS-ARCHIVE.md`).
Verbatim text as it was in `DECISIONS.md` at `30952e6`, lines 71-76:

> - Owner: «Сделай так, чтобы у тебя были логи числа прогонов на Mac. Это что за хуйня? Такого не должно быть. Ты запускаешь тесты или что? Ты не можешь проверить это? Это что за хуйня? Почему так, блядь? Если ты делаешь какие-то тесты, пробы, нагрузки тяжёлые, именно процессорные, то их лучше прогонять в CI/CD, чтобы наш MacBook Air не охуевал. Не лучше, а надо их прогонять в CI/CD.»
>   Clarification: «Нет нихуя не надо это была корректировка именно процесса на будущеее и того что что бы у тебя сохранялись логи».
>   Reason: keep CPU-heavy verification off the owner's MacBook Air and preserve auditable logs for reported
>   numbers. This is a future work policy, not a request for a measurement campaign. Carriers:
>   [PROCESS.md, Sufficient proof](PROCESS.md#sufficient-proof-without-idle-reruns) (execution and saved logs),
>   [PROCESS.md, Delivery](PROCESS.md#delivery) and `.github/workflows/tests.yml` (Mac CI proof).

## A-0016 · archived 2026-10-23 · Work policy · Checks once, docs-only no tests, Git Bash

Status: SUPERSEDED by `[D-WORK-CHECKS-ONCE]` (rewritten in the docs-cleanup format).
Introduced: `8f2ea64`. Archived by: docs-cleanup (this cleanup; exact commit recoverable with `git log -S'A-0016' -- DECISIONS-ARCHIVE.md`).
Verbatim text as it was in `DECISIONS.md` at `30952e6`, lines 77-80:

> - Run relevant checks once and reuse evidence while inputs are unchanged; execution location and saved evidence
>   follow [PROCESS.md](PROCESS.md#sufficient-proof-without-idle-reruns). No Linux requirement. Docs-only work needs
>   no tests. A different task-branch commit versus the final squash alone is not a reason to rerun. Windows Node
>   tooling runs through Git Bash, not PowerShell/cmd runtime; existing CI `pwsh` bootstrap is allowed infrastructure.

## A-0017 · archived 2026-10-23 · Work policy · Final check and code reviewer

Status: SUPERSEDED by `[D-WORK-FINAL-CHECK]` (rewritten in the docs-cleanup format).
Introduced: `8f2ea64`. Archived by: docs-cleanup (this cleanup; exact commit recoverable with `git log -S'A-0017' -- DECISIONS-ARCHIVE.md`).
Verbatim text as it was in `DECISIONS.md` at `30952e6`, lines 81-83:

> - Finish with an independent completeness-and-consistency check. For code changes, run a separate bug/quality
>   reviewer in parallel via the existing agent custom system `.agents/reviewers/code.md`. This requires no new
>   extension or product tool changes. Update installed Pi only for relevant runtime changes, never for docs-only work.

## A-0018 · archived 2026-10-23 · Work policy · Deterministic delivery quality

Status: SUPERSEDED by `[D-WORK-DELIVER-CHECK]` (rewritten in the docs-cleanup format; implementation details are carried by PROCESS.md and scripts/deliver-check.mjs).
Introduced: `47868b0`. Archived by: docs-cleanup (this cleanup; exact commit recoverable with `git log -S'A-0018' -- DECISIONS-ARCHIVE.md`).
Verbatim text as it was in `DECISIONS.md` at `30952e6`, lines 84-99:

> - Deterministic delivery quality. Owner: «Теперь смотри насчет выполнения задач и пробелов, которые ты нашел. Я же не буду всегда тебя переспрашивать. Если бы я не спросил, ты бы об этом не узнал. Надо поэтому сделать какой-то процесс, как детерминированно эту проблему решить на постоянке, чтобы мне не надо было тебя постоянно переспрашивать, чтобы ты сам следил за качеством. Надо твое предложение по тому, как мы этот пробел будем закрывать.»
>   Approved proposal, the owner approving it with «Правила по Process MD я одобряю»: «1. Тестируется ровно то, что вливается. Если main изменился с момента создания ветки, исполнитель переносит ветку на свежий main. Тесты на Mac и Windows CI проходят на этом итоговом коммите.
>   2. Ревью действует только для того коммита, который оно проверило. Любой коммит после CLEAN снова отправляет изменённые места на проверку: и задачу, и код.
>   3. Перед каждым слиянием я запускаю скрипт npm run deliver-check <ветка>. Он проверяет три вещи. Ветка содержит текущий main. Windows CI прошёл именно на этом коммите. В описании коммита записаны номера ревью с CLEAN и список того, что не проверено вживую. Если чего-то нет, слияния нет.
>   4. В каждом отчёте о готовой задаче я сам даю таблицу доказательств и честный раздел «не проверено вживую», без твоего запроса.»
>   Reason: branches tested alone were squashed onto a moved `main`, so the combined tree went untested until a manual
>   dispatch, and a code-review CLEAN covered an earlier commit while two later fixes landed unreviewed. Carriers:
>   [PROCESS.md](PROCESS.md) (Sufficient proof, Independent review, Delivery) and `scripts/deliver-check.mjs`,
>   proven by `test/deliver-check.test.ts`. Implementation choices: the script takes the planned squash message file
>   as a second argument, also requires a clean main checkout and a green `pcli.yml` run when PCLI paths change, reads
>   the path filters from the workflow files of `main` and of the branch head (a file counts if either version
>   requires CI; a missing workflow file or filter in either is a failure), fails outside a checkout with `main`
>   checked out, and accepts only the latest run on the head SHA. Coordinator
>   interpretation of rule 2, derived from «Любой коммит после CLEAN снова отправляет изменённые места на проверку»:
>   a conflict-free rebase onto `main` changes no task places, so it needs new tests and CI on the new head (rule 1)
>   but no new review; places changed while resolving conflicts are changed places and go back to review.

## A-0019 · archived 2026-10-23 · Work policy · Temporary result-review route

Status: SUPERSEDED by `[D-WORK-TEMP-REVIEW]` (rewritten in the docs-cleanup format).
Introduced: `9b93931`. Archived by: docs-cleanup (this cleanup; exact commit recoverable with `git log -S'A-0019' -- DECISIONS-ARCHIVE.md`).
Verbatim text as it was in `DECISIONS.md` at `30952e6`, lines 100-104:

> - Temporary result-review route. Coordinator question: «Слияния, пока ревьюер выключен ... a) Маленькой правкой научить проверку перед слиянием принимать ревью субагентом с текстом ревьюера, с честной отметкой agent#N. В процессе записать, что так делаем, пока ревьюер выключен.» Owner: «1а», then «только с текстом нового ревьюера».
>   Reason: the owner disabled RQW-review while the new reviewer is tuned («Сейчас ревьюеров надо отключить, пока мы их не дотюнили»).
>   The temporary route and completeness check are defined in [PROCESS.md](PROCESS.md#independent-review);
>   carriers: `PROCESS.md`, `scripts/deliver-check.mjs`, `test/deliver-check.test.ts`. The gate accepts either honest
>   result-review trailer and keeps all other checks.

## A-0020 · archived 2026-10-23 · Work policy · Completeness check after every merge

Status: SUPERSEDED by `[D-WORK-COMPLETENESS]` (rewritten in the docs-cleanup format; the elided owner quote is replaced by the whole owner line).
Introduced: `47868b0`. Archived by: docs-cleanup (this cleanup; exact commit recoverable with `git log -S'A-0020' -- DECISIONS-ARCHIVE.md`).
Verbatim text as it was in `DECISIONS.md` at `30952e6`, lines 105-111:

> - Completeness check after every merge. Original concern, owner: «А у тебя есть встроенный процесс, который перепроверяет, что нигде ничего не забыто? ... должна быть независимая перепроверка, что каждый влитый pull request действительно соответствует истине, что там всё заебись.»
>   Approved proposal (coordinator's text): «a) После каждого слияния и перед итоговым отчётом свежий независимый ревьюер получает все твои сообщения из сессии и историю main. По каждой просьбе он отмечает: сделано и каким коммитом, в работе или ты её отменил. Если у просьбы нет ни одной отметки, это находка. Правило записываю в PROCESS.md.»
>   Owner: «Да, один по проверке, что ничего не забыто».
>   Reason: a request can be dropped silently between sessions, merges and reports, and only the owner's repeated
>   question found it. Carried by [PROCESS.md, Delivery](PROCESS.md#delivery) step 5. Implementation choice: the
>   reviewer is the existing `review` tool; its object is `main`'s git log since the session start plus in-progress
>   branches/worktrees and owner-cancelled items.

## A-0021 · archived 2026-10-23 · Work policy · Measurements in waves

Status: SUPERSEDED by `[D-WORK-MEASURE-WAVES]` (rewritten in the docs-cleanup format; the elided owner quote is replaced by whole owner lines).
Introduced: `ba1c273`. Archived by: docs-cleanup (this cleanup; exact commit recoverable with `git log -S'A-0021' -- DECISIONS-ARCHIVE.md`).
Verbatim text as it was in `DECISIONS.md` at `30952e6`, lines 112-120:

> - Pilot batch and output reading for measurements. Owner: «Так блять надо фиксить ты шо гонишь мы нахуй прогоны эти делаем . Мы прогоны делаем не ради прогонов. Мы прогоны делаем для того, чтобы найти косяки, найти хуйню, её пофиксить и делать пиздато всё. ... Давай сейчас все прогоны останови, и мы обсудим дальнейшие шаги. Надо сейчас это все порефиксировать», then «1а» to the plan whose step 5 is this process rule (small batch first, an agent reads it for anomalies, stop at the first systemic defect). Later: «Смотри, я хочу, чтобы ты в процессе измерений прогонов сразу находил аномалии, сразу находил отклонения и сразу же останавливал прогоны и чинил. Если будут очевидные косяки жёсткие, надо их сразу чинить в моменте . Нет смысла ждать полных прогонов, если мы потом починим и будем заново перепрогонять. Ты на первых запусках, если видишь какую-то хуйню очевидную, надо её фиксить . И первые запуски делай на самых сильных моделях из того перечня, который у тебя есть, чтобы сразу получить отклонение на старте у сильных моделей». And: «Мы не учитываем, что слабые модели в принципе не смогут какие-то вещи делать. Нам главное откалибровать на сильных моделях, а потом посмотрим, как они будут себя вести на слабых».
>   Reason: the reviewer-v2 benchmark burned a night on a quote-checker defect that was visible in its first outputs.
>   Rule: every measurement or benchmark with model calls runs in waves, never the whole matrix at once, the first
>   launches on the strongest models of the measured list; outputs are checked continuously during the run (an
>   automatic anomaly watcher after every run plus an agent reading the actual outputs), and at the first obvious defect
>   the run stops at once and the defect is fixed before anything else runs.
>   Calibration happens on the strongest models; weaker ones are measured afterwards on the calibrated version and their
>   failures are recorded as capability limits, not defects, unless they show a mechanics or checker bug.
>   Carried by [PROCESS.md, Measurements and benchmarks](PROCESS.md#measurements-and-benchmarks).

## A-0022 · archived 2026-10-23 · Work policy · Coordinator delegates even do-it-yourself

Status: SUPERSEDED by `[D-WORK-EXECUTOR-ROLE]` (rewritten in the docs-cleanup format).
Introduced: `30952e6`. Archived by: docs-cleanup (this cleanup; exact commit recoverable with `git log -S'A-0022' -- DECISIONS-ARCHIVE.md`).
Verbatim text as it was in `DECISIONS.md` at `30952e6`, lines 121-124:

> - Coordinator delegates even "do it yourself". Owner: «Когда я говорю, что ты должен что-то сделать буквально, это значит, что ты должен поднять саб-агента, который это сделает. Не забывай свою роль и запиши это, зафиксируй, чтобы больше так не наёбываться.» Owner, next: «Я всегда с тобой разговариваю так, как будто ты и есть мой исполнитель. Потому что для меня ты исполнитель, но ты сам работаешь в рамках роли, которая тебе назначена. И ты должен это помнить, и ты должен этому следовать всегда. Ты не должен никогда от этого отклоняться. Понял? Это супер важно.»
>   Reason: asked to arbitrate judge disputes himself, the coordinator started reading run files in its own thread. The owner
>   addresses Main as the executor; Main acts within its assigned role and executes through subagents, without exception.
>   Carried by [PROCESS.md, Isolated parallel execution](PROCESS.md#isolated-parallel-execution) (the owner-executor bullet).

## A-0023 · archived 2026-10-23 · Work policy · Third arbiter for judge disputes

Status: SUPERSEDED by `[D-WORK-ARBITER]` (rewritten in the docs-cleanup format).
Introduced: `30952e6`. Archived by: docs-cleanup (this cleanup; exact commit recoverable with `git log -S'A-0023' -- DECISIONS-ARCHIVE.md`).
Verbatim text as it was in `DECISIONS.md` at `30952e6`, lines 125-126:

> - Third arbiter for judge disputes. Owner: «Так, блядь, ты сам эти споры рассуди. Ты же, блядь, выше них. Ты сам спор можешь рассудить, у тебя есть все исходные материалы, ты знаешь, как именно должно всё это работать, и ты должен быть третьим независимым мнением от этих двух судей».
>   Reason: a disputed judge label needs an independent decision from the sources. Carried by [PROCESS.md, Measurements and benchmarks](PROCESS.md#measurements-and-benchmarks), rule 7.

## A-0024 · archived 2026-10-23 · Work policy · Measurement runs without caps

Status: SUPERSEDED by `[D-WORK-NO-CAPS]` (rewritten in the docs-cleanup format).
Introduced: `c7baf0c`. Archived by: docs-cleanup (this cleanup; exact commit recoverable with `git log -S'A-0024' -- DECISIONS-ARCHIVE.md`).
Verbatim text as it was in `DECISIONS.md` at `30952e6`, lines 127-129:

> - Measurement runs have no caps; the measurer supervises instead. Owner: «Нахуй ты вообще лимиты какие то ставишь? я разве говорил ставить? ты наблюдаешь за запусками следишь как себя агенты ведут и сам их прерываешь, но ты их не полишь, а опрашиваешь прграмно раз допустим в 1-3-5 минут. ну я имею ввиду не лично ты а тот кто делает замеры»
>   Reason: a pilot was stopped on a self-imposed 375-request cap after harness pauses consumed it; caps are not stop
>   conditions. Carried by [PROCESS.md, Measurements and benchmarks](PROCESS.md#measurements-and-benchmarks), rule 6.

## A-0025 · archived 2026-10-23 · Work policy · Short replies

Status: SUPERSEDED by `[D-WORK-SHORT-REPLIES]` (rewritten in the docs-cleanup format).
Introduced: `8f2ea64`. Archived by: docs-cleanup (this cleanup; exact commit recoverable with `git log -S'A-0025' -- DECISIONS-ARCHIVE.md`).
Verbatim text as it was in `DECISIONS.md` at `30952e6`, lines 130-131:

> - Keep replies short unless expansion is needed: «Он отвечает не больше трех абзацев по максимум две строки
>   в абзаце. Если это не требует расширения, конечно».

## A-0026 · archived 2026-10-23 · Work policy · CI evidence for a dying test file

Status: SUPERSEDED by `[D-WORK-CI-EVIDENCE]` (rewritten in the docs-cleanup format; the stale push-trigger reason is recorded as a known leftover; run details in notes/decisions-evidence.md#ci-dying-test-file).
Introduced: `8547d59`. Archived by: docs-cleanup (this cleanup; exact commit recoverable with `git log -S'A-0026' -- DECISIONS-ARCHIVE.md`).
Verbatim text as it was in `DECISIONS.md` at `30952e6`, lines 132-142:

> - CI evidence for a test file that dies. Coordinator decision (technical), no owner quote: the `npm test` steps keep
>   Node's default log output and also write a TAP copy, uploaded on failure with the job's macOS crash reports; a
>   manual stress workflow repeats the 12 MB codemode tests with exit code and peak RSS per run.
>   Reason: `codemode.test.ts` died silently once on macOS Node 24 (run 39948373095); on Node 24 the spec reporter
>   shows such a file only as 'test failed', so the root cause was not recoverable without its exit code or signal,
>   which the TAP copy carries. Carriers:
>   `scripts/ci-npm-test.sh` (Node's default log reporter plus a TAP copy), `.github/workflows/tests.yml` (artifact
>   `test-evidence-*`, also with `/Library/Logs/DiagnosticReports` for JetsamEvent memory kills) and
>   `.github/workflows/codemode-stress.yml` (input `runs`, `summary.tsv` with exit code and peak RSS per run).
>   Implementation choice: GitHub dispatches only workflows present on the default branch, so the stress workflow also
>   runs on a push to the branch `codemode-stress` (30 runs), like `pcli.yml` with `pcli`.

## A-0027 · archived 2026-10-23 · Scope · Pi 1.4.0 only supported version

Status: SUPERSEDED by `[D-SCOPE-PI-VERSION]` (rewritten in the docs-cleanup format).
Introduced: `02bd178`. Archived by: docs-cleanup (this cleanup; exact commit recoverable with `git log -S'A-0027' -- DECISIONS-ARCHIVE.md`).
Verbatim text as it was in `DECISIONS.md` at `30952e6`, lines 146-153:

> - Pi 1.4.0 is the one supported and tested version (user: «Надо понять, сможем ли мы сейчас апгрейдить весь наш пакет на
>   1.4 версию Pi.»; «1а»; «Можно начинать уже и можно продолжать всю работу, которая была до этого начата»). Reason: the
>   1.4.0 research found only intentional version gates and stale summary-output assertions in the way, no reason to wait
>   for another release or to fork. The gates of `RQW-settings` (`selection.ts`, `cache-warming.ts`), `RQW-tools`
>   (`selection.ts`) and `RQW-anthropic` (`index.ts`, `retry.ts`) accept exactly 1.4.0: 1.3.0 is no longer supported and
>   the range is not widened to future versions; the shared tool-selection symbol keeps one namespace in both copies of
>   `selection.ts`. `package.json` pins the development dependency to 1.4.0 and its peer range to the tested 1.4.0. PCLI
>   bundles the official 1.4.0 binary, [PCLI](#pcli). Carried by those files, `package.json`, `package-lock.json`.

## A-0028 · archived 2026-10-23 · Scope · Extension layer and limited UI port

Status: SUPERSEDED by `[D-SCOPE-LAYER]`: the claim that other omp-lite UI is not carried over contradicted the four UI-port folders on main; dead link `#statusbar` fixed.
Introduced: `9ef1519`. Archived by: docs-cleanup (this cleanup; exact commit recoverable with `git log -S'A-0028' -- DECISIONS-ARCHIVE.md`).
Verbatim text as it was in `DECISIONS.md` at `30952e6`, lines 154-160:

> - my-pi is an extension layer around stock Pi 1.4.0, not a fork (user: «Мы делаем просто обвес вокруг оригинального Pi.»;
>   «Нет, никаких форков.»). Reason: keep Pi's own behavior and add only the agreed extensions. Carried by
>   `package.json` and `extensions/`. Only `RQW-models`, `RQW-statusbar` and `RQW-send-now` ported UI, as described in
>   [Models](#models), [Statusbar](#statusbar) and [Send now](#send-now); `RQW-scroll` adds one owner-requested key
>   behavior, [Scroll](#scroll); other omp-lite UI and tools are not
>   carried over (user: «Давай полностью отбросим все UI припоны и оставим только чистую механику и промпты»,
>   «Так же мы можем отбросить тулинг»).

## A-0029 · archived 2026-10-23 · Scope · bench41 reason

Status: OBSOLETE: benchmark ledger without a rule; numbers kept in notes/decisions-evidence.md#scope-bench41.
Introduced: `7d89c6a`. Archived by: docs-cleanup (this cleanup; exact commit recoverable with `git log -S'A-0029' -- DECISIONS-ARCHIVE.md`).
Verbatim text as it was in `DECISIONS.md` at `30952e6`, lines 161-163:

> - Reason: bench41 (`~/Documents/ChatGPT/my-omp-harness/bench/bench41.csv`, T01-T07, 3 runs): the omp-lite prompt alone
>   raised stock Pi by 10.2 quality points on gpt-6-sol low, 6.2 on gpt-6-sol medium and 1.9 on gpt-6.1-sol medium;
>   omp-lite beat that only on low (+3.5) and was lower and slower on both medium configs.

## A-0030 · archived 2026-10-23 · Scope · Public repository

Status: SUPERSEDED by `[D-SCOPE-PUBLIC]` (rewritten in the docs-cleanup format).
Introduced: `10a864c`. Archived by: docs-cleanup (this cleanup; exact commit recoverable with `git log -S'A-0030' -- DECISIONS-ARCHIVE.md`).
Verbatim text as it was in `DECISIONS.md` at `30952e6`, lines 164-164:

> - Public repository [ARQAWA/my-pi](https://github.com/ARQAWA/my-pi) (user: «он должен быть паблик»).

## A-0031 · archived 2026-10-23 · Scope · Dropped tools

Status: SUPERSEDED by `[D-SCOPE-DROPPED]` (rewritten in the docs-cleanup format).
Introduced: `ee0421a`. Archived by: docs-cleanup (this cleanup; exact commit recoverable with `git log -S'A-0031' -- DECISIONS-ARCHIVE.md`).
Verbatim text as it was in `DECISIONS.md` at `30952e6`, lines 165-166:

> - Dropped for good: loading of `eval`, `lsp`, `ast_grep` (user: «eval нахуй не нужен, lsp ... ast-grep ... выбросить
>   всё это на помойку»; Pi has its own codemode).

## A-0032 · archived 2026-10-23 · Scope · Postponed features

Status: SUPERSEDED by `[D-SCOPE-POSTPONED]` (rewritten in the docs-cleanup format; item status in BACKLOG.md; dead link `#statusbar` removed).
Introduced: `d28ae41`. Archived by: docs-cleanup (this cleanup; exact commit recoverable with `git log -S'A-0032' -- DECISIONS-ARCHIVE.md`).
Verbatim text as it was in `DECISIONS.md` at `30952e6`, lines 167-171:

> - Postponed, not dropped (user: «мы их не упраздняем, а откладываем»): `codebase_explorer`, `custom`; the
>   `define-goal` skill and work orders; and the task list with the check before stopping (later switched on by a skill
>   rather than always on). The extension-provided `agent`, `review`, `code_writer` and `shell_runner` tools are
>   implemented separately; see [Agent](#agent), [Review](#review) and [Workers](#workers) below. `RQW-models`,
>   `RQW-statusbar` and `RQW-send-now` also port UI; see [Models](#models), [Statusbar](#statusbar) and [Send now](#send-now).

## A-0033 · archived 2026-10-23 · Scope · Worker authorization pointer

Status: MERGED into `[D-WORK-MODELS]`; the campaign part is obsolete (see A-0009).
Introduced: `8f2ea64`. Archived by: docs-cleanup (this cleanup; exact commit recoverable with `git log -S'A-0033' -- DECISIONS-ARCHIVE.md`).
Verbatim text as it was in `DECISIONS.md` at `30952e6`, lines 172-173:

> - Development worker authorization and the old paused benchmark campaigns are governed by [Work policy](#work-policy),
>   independently of the product reviewer pins below.

## A-0034 · archived 2026-10-23 · Scope · Reviewers accepted plan

Status: SUPERSEDED by `[D-SCOPE-REVIEWERS]`; the contract is in DECISIONS.md#review; package sizing kept in notes/decisions-evidence.md#scope-reviewer-package-sizing.
Introduced: `3dce6fa`. Archived by: docs-cleanup (this cleanup; exact commit recoverable with `git log -S'A-0034' -- DECISIONS-ARCHIVE.md`).
Verbatim text as it was in `DECISIONS.md` at `30952e6`, lines 174-184:

> - Reviewers, accepted plan (user: «То, что ты предложил по ревьюерам — it's OK, я принимаю»): own extension
>   `RQW-review` on `createAgentSession`, no ready package (pi-subagents: ~98k lines, ~1.3k tokens per request, fails
>   strict schemas). One tool `review` with `level` `blind` or `high`; a fresh session per pass with `read`, `bash`,
>   `grep`, `find` and the shared deep prompt; no main prompt, user extensions, skills or AGENTS.md in the reviewer;
>   `blind` on Haiku 5.5 medium, `high` on Sonnet 5.5 for a Claude main agent (a GPT main agent has its own pair, and
>   the other family takes over without credentials: see [Review](#review)); the extension copies the user's messages
>   verbatim into the brief; the verdict arrives later as a message. The reviewers keep this contract (user:
>   «Ревьюеры будут только на этих двух моделях», replaced by the family table in [Review](#review)).
>   When each runs is decided by measurement (user: «Реши сам, найди самое лучшее решение»); quality is measured on a
>   rebuilt known-answer set and the prompt is tuned on it (user: «найди сам самый лучший способ замерить, и после
>   этого можешь подтюнить его промптом»).

## A-0035 · archived 2026-10-23 · Scope · General subagent without own prompt

Status: SUPERSEDED by `[D-AGENT-PARITY]` (DECISIONS.md#agent): the default prompt is the main prompt plus a reminder and `role`; `system` overrides it.
Superseded: `c86e9bb`.
Introduced: `3dce6fa`. Archived by: docs-cleanup (this cleanup; exact commit recoverable with `git log -S'A-0035' -- DECISIONS-ARCHIVE.md`).
Verbatim text as it was in `DECISIONS.md` at `30952e6`, lines 185-189:

> - A separate task: a general subagent for the main agent, like the subagents this work uses (user: «Любого рандомного
>   саб-агента ... Чтобы он мог ему ставить задачу, прерывать, выключать, перезапускать. Он мог ему посылать
>   сообщение follow-up»). It starts with no system prompt of its own: the main agent gives the whole prompt, the model
>   and the reasoning level (user: «должен подниматься без системного промпта, чтобы основной агент передавал ему весь
>   системный промпт»).

## A-0036 · archived 2026-10-23 · Scope · Autonomous execution pointer

Status: MERGED into `[D-WORK-BRANCHES]` and `[D-WORK-CHECKS-ONCE]`.
Introduced: `8f2ea64`. Archived by: docs-cleanup (this cleanup; exact commit recoverable with `git log -S'A-0036' -- DECISIONS-ARCHIVE.md`).
Verbatim text as it was in `DECISIONS.md` at `30952e6`, lines 190-191:

> - Autonomous execution, task-branch commits, final squash delivery and relevant verification follow
>   [Work policy](#work-policy) and `PROCESS.md`; tests and model runs are not unconditional gates.

## A-0037 · archived 2026-10-23 · Scope · Manifesto is personal

Status: MERGED into `[D-WORK-PROCESS-LINK]`.
Introduced: `8f2ea64`. Archived by: docs-cleanup (this cleanup; exact commit recoverable with `git log -S'A-0037' -- DECISIONS-ARCHIVE.md`).
Verbatim text as it was in `DECISIONS.md` at `30952e6`, lines 192-193:

> - `WORKFLOW-MANIFEST.md` records the owner's personal working principles and lifelong aspiration, not package
>   behavior or procedural commands. The accepted manifesto content does not override the process; see [Work policy](#work-policy).

## A-0038 · archived 2026-10-23 · Scope · Two visible providers

Status: SUPERSEDED by `[D-SCOPE-PROVIDERS]`, a pointer to DECISIONS.md#providers.
Introduced: `c8434b0`. Archived by: docs-cleanup (this cleanup; exact commit recoverable with `git log -S'A-0038' -- DECISIONS-ARCHIVE.md`).
Verbatim text as it was in `DECISIONS.md` at `30952e6`, lines 194-198:

> - Providers: `/login` and the model list show only two providers, openai-codex and our own Anthropic subscription
>   adapter `RQW-anthropic` (Claude Code login, as in omp, with self-healing); every other provider is hidden by the
>   separate extension `RQW-providers` ([Providers](#providers)) (user:
>   «Это именно отключить. Когда мы заходим в логин, там должны быть только кодекс, авторизация и авторизация через
>   Anthropic, которую ты сейчас делаешь. И всё»).

## A-0039 · archived 2026-10-23 · Scope · Lean engineering scope

Status: SUPERSEDED by `[D-SCOPE-LEAN]` (rewritten in the docs-cleanup format).
Introduced: `9ef1519`. Archived by: docs-cleanup (this cleanup; exact commit recoverable with `git log -S'A-0039' -- DECISIONS-ARCHIVE.md`).
Verbatim text as it was in `DECISIONS.md` at `30952e6`, lines 200-205:

> - Lean engineering scope (user: «Не надо делать микроправки всяких хуёвин, которые возможно никогда не всплывут, и у них редкость возникновения очень высокая, вероятность, что они возникнут, крайне мала. Надо править именно очевидные жирные ошибки, а не вылизывать до предела.»).
>   Reason: fix obvious major failures, not speculative rare cases. The completed native physical routing and
>   filesystem identity fixes are retained together, as the owner clarified: «ты всю уже выполненную работу собираешь
>   вместе. Просто ты дополнительной работы не делаешь и всё.» Current carriers: `extensions/RQW-context/index.ts`,
>   `extensions/RQW-tools/`, and `notes/context-questions.md`. Native identities, hardlink equality, dangling targets
>   and private namespace probes are implemented; this does not promise every rare filesystem or long-path case.

## A-0040 · archived 2026-10-23 · Structure · Everything is an extension

Status: SUPERSEDED by `[D-STRUCT-EXTENSIONS]`: four UI-port folders are on main but unregistered until P10; the pcli-vscode exception is named.
Introduced: `10a864c`. Archived by: docs-cleanup (this cleanup; exact commit recoverable with `git log -S'A-0040' -- DECISIONS-ARCHIVE.md`).
Verbatim text as it was in `DECISIONS.md` at `30952e6`, lines 209-211:

> - Everything is an extension, one folder per extension under `extensions/`, listed in `package.json` under
>   `pi.extensions`: first `settings`, second `prompt` (user: «в этом репозитории мы всё будем делать extension... Первый
>   extension — это будут настройки, второй — промты, настройки промта»).

## A-0041 · archived 2026-10-23 · Structure · RQW- prefix

Status: SUPERSEDED by `[D-STRUCT-PREFIX]` (rewritten in the docs-cleanup format).
Introduced: `320e80e`. Archived by: docs-cleanup (this cleanup; exact commit recoverable with `git log -S'A-0041' -- DECISIONS-ARCHIVE.md`).
Verbatim text as it was in `DECISIONS.md` at `30952e6`, lines 212-213:

> - Every extension folder carries the prefix `RQW-`: `RQW-settings`, `RQW-prompt` (user: «у всех наших extension был
>   префикс типа RQW- и название»).

## A-0042 · archived 2026-10-23 · Structure · Tool names as in Pi

Status: SUPERSEDED by `[D-STRUCT-TOOL-NAMES]` (rewritten in the docs-cleanup format).
Introduced: `320e80e`. Archived by: docs-cleanup (this cleanup; exact commit recoverable with `git log -S'A-0042' -- DECISIONS-ARCHIVE.md`).
Verbatim text as it was in `DECISIONS.md` at `30952e6`, lines 214-216:

> - Tools work: requirements compiled in `notes/tools-requirements.md`. Tool and parameter names stay exactly as in Pi;
>   no `apply_patch`, one edit format for every model (user: «имена такие же, как в P... никакой хуйни не надо
>   навяливать из ОМП лайта»; «Нет, не надо для GPT patch делать. Пусть работает одинаково везде»).

## A-0043 · archived 2026-10-23 · Structure · INSTALL.md is the install prompt

Status: SUPERSEDED by `[D-STRUCT-INSTALL]` (rewritten in the docs-cleanup format).
Introduced: `34abcd5`. Archived by: docs-cleanup (this cleanup; exact commit recoverable with `git log -S'A-0043' -- DECISIONS-ARCHIVE.md`).
Verbatim text as it was in `DECISIONS.md` at `30952e6`, lines 217-221:

> - `INSTALL.md` is the install prompt: the user runs it inside an already installed Pi, and that Pi installs this
>   package into itself with `pi install`; after install it requests `/reload` or restart, and after `pi update` it
>   requires a restart so process-wide patches use updated code (user: «чтобы можно было его везде воссоздавать,
>   воссобирать с нуля, просто промтом одним через install prompt»; «install.md — это про установку именно наших обвесов
>   на уже установленный Pi. Я внутри Pi запускаю этот промпт»). See `INSTALL.md`, step 4.

## A-0044 · archived 2026-10-23 · Structure · The start was empty

Status: OBSOLETE: bootstrap history; both extensions are implemented.
Introduced: `17c21eb`. Archived by: docs-cleanup (this cleanup; exact commit recoverable with `git log -S'A-0044' -- DECISIONS-ARCHIVE.md`).
Verbatim text as it was in `DECISIONS.md` at `30952e6`, lines 222-223:

> - The start was empty: both extensions were no-ops. The prompt is built first, everything else after it (user: «Старт
>   должен быть пустой... сначала надо сделать промпт пиздатый, а потом всё остальное будем делать»).

## A-0045 · archived 2026-10-23 · Tools · Barrier eligibility tests

Status: SUPERSEDED by `[D-TOOLS-BARRIER-TESTS]` (rewritten in the docs-cleanup format; whole owner line quoted, option 1a labelled as coordinator text).
Introduced: `230e8d0`. Archived by: docs-cleanup (this cleanup; exact commit recoverable with `git log -S'A-0045' -- DECISIONS-ARCHIVE.md`).
Verbatim text as it was in `DECISIONS.md` at `30952e6`, lines 227-236:

> - Engineering follow-up under the owner's flaky-test precedent: «Теперь по нестабильному тесту 1А»;
>   1a: «Отдельной задачей разобрать, почему тест кодмода на Windows иногда не укладывается в 5 секунд, и исправить причину.»
>   Fixed and randomized barrier batches check maximal concurrency with held operations and an independent conflict
>   oracle: after promise reactions drain, exactly the calls without unfinished earlier conflicts must have started.
>   Seeded gate rejections check prompt release after failure as well as success; mutation checks reject both ignored
>   dependencies and needless serialization. Real-timer batches and nested scripts retain ordering, abort, rejection
>   and deadlock checks; no test asserts an elapsed slack cutoff. Reason: elapsed start latency includes
>   host descheduling and garbage collection, which a percentile cutoff cannot distinguish from false dependencies.
>   No runtime barrier change is needed. Carrier: `extensions/RQW-tools/test/barrier.test.ts`; test design:
>   [notes/analysis-races.md, Test plan](notes/analysis-races.md#7-test-plan-synthetic-no-model-node---test-under-extensionsrqw-toolstest).

## A-0046 · archived 2026-10-23 · Tools · Shell timing in comparisons

Status: SUPERSEDED by `[D-TOOLS-SHELL-TIME]` (rewritten in the docs-cleanup format).
Introduced: `230e8d0`. Archived by: docs-cleanup (this cleanup; exact commit recoverable with `git log -S'A-0046' -- DECISIONS-ARCHIVE.md`).
Verbatim text as it was in `DECISIONS.md` at `30952e6`, lines 238-242:

> - Engineering follow-up under the owner's flaky-test precedent: «Теперь по нестабильному тесту 1А»;
>   1a: «Отдельной задачей разобрать, почему тест кодмода на Windows иногда не укладывается в 5 секунд, и исправить причину.»
>   The stock-versus-wrapper shell-path test compares every result field except `structuredContent.wall_time_seconds`,
>   whose independent process timings need not match; both timings must still be nonnegative numbers.
>   Reason: a rounded elapsed time is not shell-path behavior. Carrier: `extensions/RQW-tools/test/behavior.test.ts`.

## A-0047 · archived 2026-10-23 · Tools · Stock definitions and execution

Status: SUPERSEDED by `[D-TOOLS-WRAPPERS]`: every tool wraps its execute (barrier, jobs, claims, notes, write check).
Introduced: `8889fdf`. Archived by: docs-cleanup (this cleanup; exact commit recoverable with `git log -S'A-0047' -- DECISIONS-ARCHIVE.md`).
Verbatim text as it was in `DECISIONS.md` at `30952e6`, lines 244-247:

> - `extensions/RQW-tools/` replaces `read`, `bash`, `edit`, `write` and turns on `grep` and `find` by registering them.
>   Each tool spreads the stock definition and keeps its `execute`; only descriptions and the multi-file wrappers change,
>   and edit drops strict sampling (next entry). Design and reasons: `notes/tools-design.md`; evidence:
>   `notes/analysis-*.md`.

## A-0048 · archived 2026-10-23 · Tools · edit without strict sampling

Status: SUPERSEDED by `[D-TOOLS-EDIT-STRICT]` (rewritten in the docs-cleanup format; replay and probe numbers in notes/decisions-evidence.md#tools-edit-strict-sampling-replay).
Introduced: `886b677`. Archived by: docs-cleanup (this cleanup; exact commit recoverable with `git log -S'A-0048' -- DECISIONS-ARCHIVE.md`).
Verbatim text as it was in `DECISIONS.md` at `30952e6`, lines 248-263:

> - edit is sent without strict tool sampling: our edit sets `constrainedSampling` to undefined, so Pi does not send it
>   as an Anthropic `strict` tool (constrained decoding); read, bash and write keep the stock `strict: "prefer"`. Owner:
>   «01a15f4f-7b7e-70e6-b1e2-bb238ce75359 Также в этой сессии поработал агент, и там дохуя ошибок записи. Он делает
>   параллельные эдиты: проредактировал и потом снова делает через время параллельные эдиты. И там целая вереница
>   эдитов красная, с ошибками. Он потом перепосчитал файлы и снова отредактировал. Надо разобраться, этот баг
>   пофиксить.» Reason: in that session (claude-opus-5-5) all 15 failed edit calls carried garbled arguments, not
>   stale text: a replay of the files from Git plus every successful edit matched each successful oldText exactly once.
>   Each failed oldText broke where Cyrillic text began (literal `\u0430`-style escapes, a lone `"` or `\b`, an added
>   newline, newText `x`). All were single calls; both parallel batches succeeded, so neither the barrier nor
>   multi-file grouping was involved. Pi 1.4.0 marks stock edit `strict: "prefer"` and Opus 5.5 `supportsStrictTools`.
>   Probe replaying the session before four failing turns, 4 runs each: edit as sent (strict) 0 of 12 Cyrillic edit
>   calls usable; the stock-shaped edit schema with strict garbled 5 of 9 calls; edit without strict matched 40 of 41
>   blocks (the miss: a space for a line break). gpt-6.1-sol matched all 27 blocks with and without strict. A strict
>   write of a 14 000-character file with 5 500 Cyrillic letters came through intact 4 of 4, so write keeps strict.
>   Carried by `extensions/RQW-tools/index.ts`; test in `extensions/RQW-tools/test/tools.test.ts` (the Anthropic
>   request has no `strict` on edit and keeps it on write).

## A-0049 · archived 2026-10-23 · Tools · Ordered conflict barrier

Status: SUPERSEDED by `[D-TOOLS-BARRIER]`: adds the later-response ordering through background holds.
Introduced: `8889fdf`. Archived by: docs-cleanup (this cleanup; exact commit recoverable with `git log -S'A-0049' -- DECISIONS-ARCHIVE.md`).
Verbatim text as it was in `DECISIONS.md` at `30952e6`, lines 264-267:

> - Ordered conflict barrier: a call waits only for earlier calls of the same response it conflicts with; bash conflicts
>   with every call, read never with read, otherwise equal path key or ancestor. Reason: stock Pi measured 20 of 20 races
>   for read/write, bash/read and case-variant writes (`notes/analysis-races.md` section 2). bash is serialized against
>   bash because its footprint is unknown.

## A-0050 · archived 2026-10-23 · Tools · Codemode watchdog test

Status: SUPERSEDED by `[D-TOOLS-CODEMODE-WATCHDOG]`: the quote attributed to the owner is coordinator text (option 1a); the owner's line is session 16-27-59 line 591.
Introduced: `9a4068c`. Archived by: docs-cleanup (this cleanup; exact commit recoverable with `git log -S'A-0050' -- DECISIONS-ARCHIVE.md`).
Verbatim text as it was in `DECISIONS.md` at `30952e6`, lines 268-274:

> - Owner: «Отдельной задачей разобрать, почему тест кодмода на Windows иногда не укладывается в 5 секунд, и исправить причину».
>   Reason: the 500 KB codemode ordering test spent its watchdog budget streaming about 31,000 tiny faux-provider
>   deltas before tools could execute, not waiting in the barrier. Its faux provider now uses fixed larger chunks;
>   a deterministic delta-count assertion prevents that overhead returning. The 5 s deadlock watchdog, payload,
>   ten repetitions and ordering assertions stay unchanged; no runtime barrier or codemode change is needed.
>   Carrier: `extensions/RQW-tools/test/codemode.test.ts`; analysis and proof:
>   [notes/settings-codemode.md, Test watchdog](notes/settings-codemode.md#test-watchdog).

## A-0051 · archived 2026-10-23 · Tools · In-place writes with Windows retry

Status: SUPERSEDED by `[D-TOOLS-WIN-RETRY]` (rewritten in the docs-cleanup format).
Introduced: `8889fdf`. Archived by: docs-cleanup (this cleanup; exact commit recoverable with `git log -S'A-0051' -- DECISIONS-ARCHIVE.md`).
Verbatim text as it was in `DECISIONS.md` at `30952e6`, lines 275-276:

> - In-place writes stay; on Windows `EBUSY`/`EPERM`/`EACCES` are retried for about 1.5 s. Temp file plus rename was
>   rejected: rename fails on Windows when another process holds the file.

## A-0052 · archived 2026-10-23 · Tools · Search and output limits

Status: SUPERSEDED by `[D-TOOLS-LIMITS]` (rewritten in the docs-cleanup format).
Introduced: `8889fdf`. Archived by: docs-cleanup (this cleanup; exact commit recoverable with `git log -S'A-0052' -- DECISIONS-ARCHIVE.md`).
Verbatim text as it was in `DECISIONS.md` at `30952e6`, lines 277-279:

> - Limits: grep and find get no match cap by default (`limit` 100000 when unset); the stock 50KB output cap stays. Reason:
>   Pi's default 100 grep matches cuts the broad first search wave; omp-lite's 51 200-character budget equals 50KB for
>   ASCII. read and bash keep the stock 2000 lines / 50KB, as measured in bench41.

## A-0053 · archived 2026-10-23 · Tools · Search method section

Status: SUPERSEDED by `[D-TOOLS-SEARCH-METHOD]` (rewritten in the docs-cleanup format).
Introduced: `04aa50f`. Archived by: docs-cleanup (this cleanup; exact commit recoverable with `git log -S'A-0053' -- DECISIONS-ARCHIVE.md`).
Verbatim text as it was in `DECISIONS.md` at `30952e6`, lines 280-281:

> - The search wave method lives in the grep description; RQW-tools supplies the one-line `<search_method>` section
>   through its own `before_agent_start` hook when read, grep and find are declared.

## A-0054 · archived 2026-10-23 · Tools · Tool activation by registration

Status: SUPERSEDED by `[D-SETTINGS-DEFAULT-TOOLS]` (DECISIONS.md#settings) and `[D-TOOLS-WRAPPERS]`: all tools are `defaultActive: false`; grep and find are added on session_start.
Superseded: `bfb2712`.
Introduced: `f8cd7e9`. Archived by: docs-cleanup (this cleanup; exact commit recoverable with `git log -S'A-0054' -- DECISIONS-ARCHIVE.md`).
Verbatim text as it was in `DECISIONS.md` at `30952e6`, lines 282-285:

> - read, bash, edit and write are registered with `defaultActive: false`: they replace the built-ins of the same name, so
>   Pi's defaults and the user's `--tools` / `defaultTools` still decide which are on. grep and find are activated by
>   registration; on resume or fork they are re-added unless the user passed `--tools`, `--exclude-tools` or `--no-tools`.
>   Reason: the code review showed that activating on registration overrode an explicit `--tools -edit`.

## A-0055 · archived 2026-10-23 · Tools · Caller shell and image settings

Status: SUPERSEDED by `[D-TOOLS-SHELL-SETTINGS]` (rewritten in the docs-cleanup format).
Introduced: `f8cd7e9`. Archived by: docs-cleanup (this cleanup; exact commit recoverable with `git log -S'A-0055' -- DECISIONS-ARCHIVE.md`).
Verbatim text as it was in `DECISIONS.md` at `30952e6`, lines 286-287:

> - read and bash are built with the user's settings (`shellPath`, `shellCommandPrefix`, `images.autoResize`), as stock
>   Pi builds them. Reason: without `shellPath` a Windows setup with Git outside Program Files finds no bash.

## A-0056 · archived 2026-10-23 · Tools · Offered tool factory

Status: SUPERSEDED by `[D-TOOLS-FACTORY]`: the factory also returns `job` and, when given, the caller's `codemode`.
Introduced: `90700ad`. Archived by: docs-cleanup (this cleanup; exact commit recoverable with `git log -S'A-0056' -- DECISIONS-ARCHIVE.md`).
Verbatim text as it was in `DECISIONS.md` at `30952e6`, lines 288-292:

> - `createTools(cwd, settings)` in `index.ts` builds the six definitions with one barrier of their own; the factory
>   registers one set for the session and answers a request on `pi.events` channel `rqw-tools:subagent-tools` with
>   `createTools` itself (section Agent). Nothing in RQW-tools depends on RQW-agent. A test in
>   `extensions/RQW-tools/test/tools.test.ts`
>   checks the answer and that each call gives fresh definitions.

## A-0057 · archived 2026-10-23 · Tools · Read key spellings

Status: SUPERSEDED by `[D-TOOLS-READ-KEY]` (rewritten in the docs-cleanup format).
Introduced: `f8cd7e9`. Archived by: docs-cleanup (this cleanup; exact commit recoverable with `git log -S'A-0057' -- DECISIONS-ARCHIVE.md`).
Verbatim text as it was in `DECISIONS.md` at `30952e6`, lines 293-294:

> - The read key mirrors stock `resolveReadPath` (NFD, curly quote and AM/PM variants), so a read and a write of the same
>   file spelled differently still meet in the barrier.

## A-0058 · archived 2026-10-23 · Tools · Other stock tools outside the barrier

Status: SUPERSEDED by `[D-TOOLS-WRAPPERS]`, `[D-SETTINGS-CODEMODE]` and `[D-SETTINGS-DEFAULT-TOOLS]` (DECISIONS.md#settings): Pi's codemode is one barrier call and on by default; `ls` stays unwrapped.
Superseded: `3720200`.
Introduced: `f8cd7e9`. Archived by: docs-cleanup (this cleanup; exact commit recoverable with `git log -S'A-0058' -- DECISIONS-ARCHIVE.md`).
Verbatim text as it was in `DECISIONS.md` at `30952e6`, lines 295-295:

> - The `ls` and other stock tools beyond the six are not wrapped and stay outside the barrier; they are off by default.

## A-0059 · archived 2026-10-23 · Tools · Barrier order not described

Status: SUPERSEDED by `[D-TOOLS-HIDDEN-ORDER]` (rewritten in the docs-cleanup format; numbers in notes/decisions-evidence.md#tools-barrier-order-lines).
Introduced: `0a2028e`. Archived by: docs-cleanup (this cleanup; exact commit recoverable with `git log -S'A-0059' -- DECISIONS-ARCHIVE.md`).
Verbatim text as it was in `DECISIONS.md` at `30952e6`, lines 296-299:

> - The descriptions do not explain the barrier order (bash waits for earlier calls, a read waits for an earlier write).
>   Reason, measured on gpt-6.1-sol medium, T01: with those lines the model made one call per response in 8 of 8 runs
>   (14-18 responses); without them it batched in 9 of 9 runs (3-5 responses). The barrier works without the model
>   knowing it.

## A-0060 · archived 2026-10-23 · Tools · bench42 first interpretation

Status: SUPERSEDED by `[D-TOOLS-JUDGING]`: the T01 gap was judge noise; "Open: tune the grep description" was done by `[D-TOOLS-SEARCH-DESC]`. Ledger in notes/decisions-evidence.md#tools-bench42.
Superseded: `52efad7`.
Introduced: `85a2845`. Archived by: docs-cleanup (this cleanup; exact commit recoverable with `git log -S'A-0060' -- DECISIONS-ARCHIVE.md`).
Verbatim text as it was in `DECISIONS.md` at `30952e6`, lines 300-311:

> - bench42 (commit `0a2028e`, T01-T07, 3 runs, same completion judge and checklists as bench41; rows in
>   `notes/bench42.csv`). Pi with the bench41 prompt vs my-pi:
>
>   | Config | Pi + prompt | my-pi |
>   |---|---|---|
>   | gpt-6-sol medium | 47.4 s / q91.9 | 47.0 s / q89.0 |
>   | gpt-6.1-sol medium | 64.6 s / q99.0 | 67.2 s / q92.5 |
>   | gpt-6-sol low | 28.4 s / q90.5 | 27.4 s / q89.6 |
>
>   Speed is the same. The quality gap comes from T01 (80/93/80 vs 67/80/67: the answer misses the Python twin) and one
>   gpt-6.1-sol run of T02 that wrote its answer to `TRADING_LOGIC.md` (q18, 256 s); without that run gpt-6.1-sol medium
>   is 57.8 s / q96.2. Open: tune the grep description against T01.

## A-0061 · archived 2026-10-23 · Tools · bench42 regrade and five-vote judging

Status: SUPERSEDED by `[D-TOOLS-JUDGING]` (rewritten in the docs-cleanup format; numbers in notes/decisions-evidence.md#tools-bench42).
Introduced: `52efad7`. Archived by: docs-cleanup (this cleanup; exact commit recoverable with `git log -S'A-0061' -- DECISIONS-ARCHIVE.md`).
Verbatim text as it was in `DECISIONS.md` at `30952e6`, lines 312-314:

> - bench42 regraded with 5 judge votes per answer, majority per point: 92.9 / 91.0, 96.2 / 91.6, 90.5 / 89.0
>   (Pi + prompt / my-pi). The 90% bootstrap interval of the difference includes zero on every config. The T01 gap was
>   judge noise on one point; both stands miss the Python usage point equally. Judging from now on: 5 votes, majority.

## A-0062 · archived 2026-10-23 · Tools · The TRADING_LOGIC.md run

Status: SUPERSEDED by `[D-TOOLS-ANSWER-IN-CHAT]` (rewritten in the docs-cleanup format).
Introduced: `52efad7`. Archived by: docs-cleanup (this cleanup; exact commit recoverable with `git log -S'A-0062' -- DECISIONS-ARCHIVE.md`).
Verbatim text as it was in `DECISIONS.md` at `30952e6`, lines 315-317:

> - The `TRADING_LOGIC.md` run: the model's reasoning shows it hit the answer length limit of the prompt and moved the
>   answer into a file, which the prompt allowed ("the file is the answer"). `SYSTEM.md` now says to answer a question
>   about the code in the chat and to create or change files only when the task asks for it.

## A-0063 · archived 2026-10-23 · Tools · edit and write descriptions

Status: SUPERSEDED by `[D-TOOLS-EDIT-WRITE-DESC]` (rewritten in the docs-cleanup format; numbers in notes/decisions-evidence.md#tools-description-probes).
Introduced: `1628f8c`. Archived by: docs-cleanup (this cleanup; exact commit recoverable with `git log -S'A-0063' -- DECISIONS-ARCHIVE.md`).
Verbatim text as it was in `DECISIONS.md` at `30952e6`, lines 318-322:

> - edit and write descriptions refined by probes (`notes/refine/refine-editwrite.md`; EDIT, WRITE and a multi-block task,
>   gpt-6.1-sol medium and gpt-6-sol low, 3 runs per cell): the multi-file form comes first and a rename gets one edit per
>   occurrence with enough of its line. Failed edit calls 5 -> 0, multi-file edit calls 12 of 23 -> 15 of 16, all runs
>   correct in both texts. A variant that told the model bash sees the changed files again made gpt-6.1-sol issue one
>   call per response and was rejected.

## A-0064 · archived 2026-10-23 · Tools · read description

Status: SUPERSEDED by `[D-TOOLS-READ-DESC]` (rewritten in the docs-cleanup format; numbers in notes/decisions-evidence.md#tools-description-probes).
Introduced: `a0bd1b1`. Archived by: docs-cleanup (this cleanup; exact commit recoverable with `git log -S'A-0064' -- DECISIONS-ARCHIVE.md`).
Verbatim text as it was in `DECISIONS.md` at `30952e6`, lines 323-326:

> - read description refined by probes (`notes/refine/refine-readbash.md`; T02, T05, EDIT, WRITE, two models, 96 runs):
>   read a needed file whole in one call and read every file needed next in one response. Correctness 99.6 -> 100,
>   whole-file reads 79% -> 84%, responses equal; the speed change is within noise. bash stays as it was: no run searched
>   or read through bash, and a line asking to run tests in the same response as the edit split responses on gpt-6.1-sol.

## A-0065 · archived 2026-10-23 · Tools · grep and find descriptions

Status: SUPERSEDED by `[D-TOOLS-SEARCH-DESC]` (rewritten in the docs-cleanup format; numbers in notes/decisions-evidence.md#tools-description-probes).
Introduced: `9e13b55`. Archived by: docs-cleanup (this cleanup; exact commit recoverable with `git log -S'A-0065' -- DECISIONS-ARCHIVE.md`).
Verbatim text as it was in `DECISIONS.md` at `30952e6`, lines 327-330:

> - grep and find descriptions refined by probes (`notes/refine/refine-search.md`; T01, T03, T06, two models, 72 runs):
>   the wave names the spellings to try, reads every file the hits already justify in one response, and the stop rule
>   asks for where each value is set, used and what the code does with it, for every implementation. find shows brace
>   alternatives. Checklist coverage 94.1% -> 95.0%, within noise; chosen by the rule completeness, then responses.

## A-0066 · archived 2026-10-23 · Tools · Second description review

Status: SUPERSEDED by `[D-TOOLS-DESC-PRECISION]` (rewritten in the docs-cleanup format).
Introduced: `a56e291`. Archived by: docs-cleanup (this cleanup; exact commit recoverable with `git log -S'A-0066' -- DECISIONS-ARCHIVE.md`).
Verbatim text as it was in `DECISIONS.md` at `30952e6`, lines 331-335:

> - Second description review (`notes/review-descriptions-2.md`, 8 findings) fixed as wording only: grep respects
>   .gitignore inside a git repository only, a grep glob with "/" matches from path, find also returns directories, the
>   edit hint may be absent, a cut grep line is read around instead of narrowing, a tool result that names cat or sed
>   overrides the ban, a long file written in parts is the one exception to one edit call per file. bench43 measured the
>   texts before these fixes.

## A-0067 · archived 2026-10-23 · Tools · bench43 results

Status: OBSOLETE: intermediate benchmark ledger; kept in notes/decisions-evidence.md#tools-bench43.
Introduced: `f8d027e`. Archived by: docs-cleanup (this cleanup; exact commit recoverable with `git log -S'A-0067' -- DECISIONS-ARCHIVE.md`).
Verbatim text as it was in `DECISIONS.md` at `30952e6`, lines 336-340:

> - bench43 (commit `9e13b55`, T01-T07, 5 runs, judge 5 votes with majority per point). Pi + prompt / my-pi:
>   gpt-6-sol medium 38.2 s q90.8 / 37.6 s q90.8; gpt-6.1-sol medium 51.4 s q96.8 / 52.1 s q96.8; gpt-6-sol low
>   26.4 s q89.6 / 24.2 s q91.4. 90% intervals of my-pi minus Pi + prompt: quality [-1.7, 2.3], [-2.2, 2.2],
>   [-0.5, 4.1]; seconds [-1.9, 0.8], [-1.2, 2.6], [-3.4, -1.1]. my-pi is equal on medium and faster on low; no file
>   written in any run. Both stands miss the same points: T01 Python usage, T06 auth blocker delay, T03 Python NG copy.

## A-0068 · archived 2026-10-23 · Tools · Implementations that do not run

Status: SUPERSEDED by `[D-TOOLS-INACTIVE-IMPL]` (rewritten in the docs-cleanup format; numbers in notes/decisions-evidence.md#tools-inactive-implementation-probe).
Introduced: `7890a8b`. Archived by: docs-cleanup (this cleanup; exact commit recoverable with `git log -S'A-0068' -- DECISIONS-ARCHIVE.md`).
Verbatim text as it was in `DECISIONS.md` at `30952e6`, lines 341-344:

> - Prompt line for implementations that do not run: say where the value is set, where it is used and what that code
>   does. Probes T01, T03, T06, two models, 3 runs, judge 5 votes: gpt-6.1-sol medium q95.6 -> 100, gpt-6-sol low
>   q85.6 -> 92.2, speed and responses unchanged. A second line asking to name every setting on the code path made both
>   models worse (q87.0 / 83.3) and was rejected.

## A-0069 · archived 2026-10-23 · Tools · Edit-task speed comparison

Status: OBSOLETE: benchmark ledger; kept in notes/decisions-evidence.md#tools-edit-tasks.
Introduced: `7890a8b`. Archived by: docs-cleanup (this cleanup; exact commit recoverable with `git log -S'A-0069' -- DECISIONS-ARCHIVE.md`).
Verbatim text as it was in `DECISIONS.md` at `30952e6`, lines 345-348:

> - Edit tasks (EDIT rename across 4 files, WRITE 3 new files, MULTI 3 blocks in one file plus 2 files; 5 runs, two
>   models): every run of stock Pi, Pi + prompt and my-pi passed its tests. Seconds Pi / Pi + prompt / my-pi:
>   gpt-6.1-sol medium 21.0 / 22.0 / 22.6, gpt-6-sol low 17.0 / 18.8 / 17.2; my-pi minus Pi + prompt on gpt-6-sol low
>   [-2.2, -0.9] s. On WRITE both prompted stands read the repository before writing, stock Pi writes at once.

## A-0070 · archived 2026-10-23 · Tools · bench44 final check

Status: OBSOLETE: benchmark ledger; kept in notes/decisions-evidence.md#tools-bench44.
Introduced: `524fbf9`. Archived by: docs-cleanup (this cleanup; exact commit recoverable with `git log -S'A-0070' -- DECISIONS-ARCHIVE.md`).
Verbatim text as it was in `DECISIONS.md` at `30952e6`, lines 349-361:

> - bench44, the final check (commit `7890a8b`; stock Pi, Pi + bench41 prompt and my-pi run at the same moment; T01-T07,
>   5 runs; judge 5 votes, majority per point; rows in `notes/bench44.csv`). Seconds / quality:
>
>   | Config | Pi | Pi + prompt | my-pi |
>   |---|---|---|---|
>   | gpt-6-sol medium | 29.9 s / q81.7 | 37.8 s / q90.2 | 37.6 s / q93.6 |
>   | gpt-6.1-sol medium | 40.7 s / q94.1 | 49.6 s / q97.2 | 50.0 s / q99.0 |
>   | gpt-6-sol low | 16.3 s / q74.0 | 26.5 s / q89.0 | 27.1 s / q93.8 |
>
>   90% intervals, my-pi minus Pi + prompt: quality [0.6, 6.3], [-0.3, 3.4], [1.9, 7.5]; seconds [-2.2, 1.7],
>   [-1.9, 2.9], [-0.8, 1.9]. my-pi minus stock Pi: quality [8.6, 15.2], [3.2, 6.5], [15.3, 24.2]; seconds [6.3, 9.0],
>   [7.3, 11.5], [9.7, 11.9]. my-pi answers better than both at the speed of Pi + prompt; stock Pi is faster because it
>   stops early with incomplete answers. No run changed the repository. Edit tasks: see the edit-task entry above.

## A-0071 · archived 2026-10-23 · Tools · Faster writing

Status: SUPERSEDED by `[D-TOOLS-SPECIFIED-WRITE]` (rewritten in the docs-cleanup format; numbers in notes/decisions-evidence.md#tools-faster-writing-probes).
Introduced: `a0b6e75`. Archived by: docs-cleanup (this cleanup; exact commit recoverable with `git log -S'A-0071' -- DECISIONS-ARCHIVE.md`).
Verbatim text as it was in `DECISIONS.md` at `30952e6`, lines 362-368:

> - Faster writing (`notes/refine/refine-write2.md`, `notes/refine/refine-find.md`; WRITE, EDIT, MULTI, T01, T03, T05,
>   T06; two models): a new file the task fully specifies needs no read of its neighbours (one line in `SYSTEM.md`, one
>   in `read.md`), and the find example shows that "app" returns the directory only while "app/**" returns its files.
>   Measured in two steps: the read lines against main (WRITE 18.4 s / 5.5 responses -> 16.0 s / 4.7, T01 and T05
>   checklists equal), then the find example against that (edit tasks 19.4 s -> 17.3 s, question checklists 94.8% ->
>   96.3%, not lower). All runs correct. gpt-6.1-sol still makes a second find in 2 of 6 WRITE runs. A review then made
>   the find, read and prompt wording exact (full-path matching, imported code, long files in parts) without new runs.

## A-0072 · archived 2026-10-23 · Tools · Compaction file lists limit

Status: SUPERSEDED by `[D-TOOLS-COMPACTION-LIMIT]` (rewritten in the docs-cleanup format; the 1.4.0 premise is marked unverified).
Introduced: `bfb2712`. Archived by: docs-cleanup (this cleanup; exact commit recoverable with `git log -S'A-0072' -- DECISIONS-ARCHIVE.md`).
Verbatim text as it was in `DECISIONS.md` at `30952e6`, lines 369-371:

> - Accepted limit: Pi's compaction summary lists changed files from `args.path` only, so files given in `write.files[]`
>   or in `edits[].path` are missing from that list. Fixing it needs a change in Pi itself; the files stay in the
>   transcript and in the tool results.

## A-0073 · archived 2026-10-23 · Tools · Background jobs

Status: SUPERSEDED by `[D-TOOLS-BG]`: compressed; the absolute D4 sentence replaced by the H1 hold rule; «children like main» is coordinator wording; running file-tool cancellation and short-timeout snapshot exclusions are approved caveats, not defects; current scan and footprint guarantees are in [DECISIONS.md, Tools](DECISIONS.md#tools); probes, replay, cost and fix history in notes/decisions-evidence.md#background-jobs-evidence.
Correction note, 2026-10-23: replaced the obsolete pending bg-jobs-defects pointer with `[D-TOOLS-BG]` in DECISIONS.md#tools; the scan and footprint fixes were delivered in `e1cca48`.
Introduced: `e5440f2`. Archived by: docs-cleanup (this cleanup; exact commit recoverable with `git log -S'A-0073' -- DECISIONS-ARCHIVE.md`).
Verbatim text as it was in `DECISIONS.md` at `30952e6`, lines 372-525:

> - Background jobs. Owner: «Да, и надо, чтобы основной агент. Нет, знаешь как? Надо, чтобы длительные shell процессы
>   сами уходили в фон. Если он работает больше 20 секунд, чтобы он превращался в фоновый процесс, а не оставался висячим
>   активным процессом. Надо, чтобы всё, что висит больше 20 секунд, любая операция, которая висит больше 20 секунд,
>   уходила в background, и можно было просто её пропинговать через какое-то время. Чтобы у агента был инструмент
>   проверки состояния.»; «только надо время сократить до 12 секунд, после 12 секунд уходит в фон.»; answers to the
>   design questions: «1а2а3а / 4 - надо разобраться с рейс кондишенами и найти самое интелектальное производительное и
>   эффективное решение марщрутизации и оркестрации тулколов / 5б / 6а с учетом 4 пункта добавочного».
>   Rule: a top-level call of `bash`, `codemode` (the whole script) or `read`, `edit`, `write`, `grep`, `find` that has
>   not settled 12 s after it started, barrier wait included, returns at once as `job#N` with the command, elapsed time,
>   the output so far and a log file in the OS temp dir, and keeps running; a call that settles sooner returns exactly
>   the stock result. Calls inside a codemode script never go to the background. The new `job` tool (`wait`, `status`,
>   `kill`; `ids`, `id`, `timeout_ms` default 300000 only when omitted, `lines` default 20) waits mechanically until
>   one selected job ends or the caller's deadline, shows state, exit code, elapsed time, tail and log path, and kills
>   a job with its process tree or cancels a queued one. Polling only, no pushed messages; the descriptions say to wait
>   for or kill one's jobs before the final answer. A job dies on Esc (an abort of any run of its caller), `job kill`,
>   its `timeout`, and the caller's shutdown or reload; jobs belong to the session whose call started them (one registry
>   per `createTools`, so each subagent and worker has its own; RQW-agent calls the offered `job` definition's
>   `jobs.abortAll()` on interrupt and `jobs.dispose()` on close). `job` is activated whenever one of these tools is
>   active, whatever the selection; when Pi's allowlist keeps it off, nothing goes to the background. Reason: the owner
>   wants long operations not to hold the agent and a tool to check them; Codex unified exec yields the same way
>   (`yield_time_ms`, session id, polling); the threshold is the owner's fixed value.
>   Ordering with background jobs, owner: «1a + живай проверка на хайку и луна хай ризонинга» (option 1a of the
>   ordering proposal, «ordered until handoff, free after»). Calls of the same response keep the order the barrier
>   gives them: a call after a job that went to the background waits for its real end and itself becomes a queued job
>   after 12 s. At the handoff a bash or codemode job is detached from the barrier (`detach` in `barrier.ts`, passed
>   through `nested.ts`): calls registered later, which are the calls of later responses, neither wait for it nor for
>   its scope resolution. A read, edit or write job keeps its paths, so a later call of the same file still follows it.
>   While a bash or codemode job of the caller runs, a top-level read, edit or write of a file whose mtime is not older
>   than the earliest running job's start and differs from the version the caller last read or wrote gets one line
>   (wording since FR-safe below): `note: <path> changed <n> s ago outside your tools while job#N (<command>) runs; wait
>   for job#N if it writes this file.` A dependency on a background
>   job is explicit: `job wait`, then the dependent call. Reason: Pi starts every call of a response before any can
>   reach 12 s and starts the next response only after all of them returned, so "registered before the handoff" means
>   "same response"; this keeps the measured same-response ordering (section Tools, ordered conflict barrier) and lets a
>   server or a long build stop blocking the agent; Codex 0.163.0 and oh-my-pi 18.8.9 do not order shell calls at all.
>   Race analysis, rejected alternatives and cost: `my-pi-evidence/bash-background/D4-ORDERING.md`; design:
>   `DESIGN.md` there. Carriers: `extensions/RQW-tools/jobs.ts`, `barrier.ts`, `nested.ts`, `index.ts`, `codemode.ts`,
>   `descriptions/bash.md`, `descriptions/job.md`; `extensions/RQW-agent/index.ts`, `roles/*.md`.
>   Proof: `extensions/RQW-tools/test/background.test.ts` (injected threshold, gate-file commands),
>   `test/barrier-detach.test.ts` in that folder (held operations, an independent oracle, randomized detach; it fails
>   with a no-op detach, and the queued-edit test fails when file jobs detach too),
>   `extensions/RQW-agent/test/wait.test.ts` (job tool in a child, interrupt and stop).
>   Two refinements from the first live probe (logs `my-pi-evidence/bash-background/probe/runs/`): `wait` keeps
>   collecting for 250 ms after the first selected job ends, because a call queued behind it ends milliseconds later
>   and returning without it cost the model one more response in 7 of 8 build runs; and a bash call whose own
>   `timeout` ends it within 1 s after the threshold stays in the foreground (as oh-my-pi bounds its wait by the
>   timeout), because `timeout: 12` reported a dying server as running.
>   Live probe (owner D6: Haiku 5.5 and GPT-6 Luna, both thinking high; 28 runs in two rounds): builds went to the
>   background, same-response calls ran after them, dependent calls followed a `job wait`, models batched calls, and
>   every job was waited for, killed or ended by its timeout before the final answer. Report and logs:
>   `my-pi-evidence/bash-background/probe/REPORT.md`.
>   Routing around background jobs (FR-safe), owner: «2а» (option 2a of the routing proposal: the full FR-safe design,
>   `my-pi-evidence/bash-background/routing/ROUTING.md` section 5). On top of the rule above:
>   holds (H1): at the handoff a bash job keeps what `footprint.ts` reads with certainty from its command text: the
>   package folder an install changes (`npm|pnpm|yarn|bun` `ci`, `install`, `add`, `remove`, ...), the git index and refs
>   of a repository a git command changes (every git subcommand except known reading ones), and the exact files it writes
>   (redirect targets, `tee`, `sed -i`, `curl -o`, `rm`, `mkdir`, `touch`, `cp`/`mv`/`ln` destinations). A later call
>   waits only for these: an edit or write of a held file, or a bash command that uses the same package folder (package
>   manager and JavaScript tool commands), changes the same repository, or writes the same file; reads never wait. Any
>   doubt (command substitution, variables or globs in a path, an unknown `cd`) holds nothing, so a missed writer falls
>   back to the rule above plus the effects report. The handoff text says `holds: ...`; a call queued behind a hold
>   shows `waiting for: job#N (holds ...)`. Package-folder and git holds are process-wide (`ledger.ts`): main,
>   subagents, workers and reviewers of one Pi process wait for each other's holds; files are not ordered across
>   sessions, they get attributed notes. Effects report (O1): a top-level bash or codemode call takes a snapshot of
>   the working tree (every file of `git ls-files -co --exclude-standard`, or outside git a walk of at most 20000 files
>   without .git, node_modules, .next, target, .venv, __pycache__, with mtime and size) right before its command starts,
>   and a job takes another when it ends. What changed is the difference of the two states, never a time cutoff: a file
>   written just before the start is not a change whatever the clocks say (the code review found the cutoff's false
>   reports; a test with the files aged had hidden it). A file the snapshot does not list (git-ignored, outside the
>   tree) falls back to its mtime against the start. Cost, paid by every top-level bash and codemode call (measured,
>   `$TMPDIR/bb-r3-snapshot-cost.log`): 8-12 ms for this repository (283 files), 17-18 ms for a 1420-file repository,
>   133-150 ms for a 20000-file walk outside git; each report states its own cost in `scanned`. Owner's cost decision
>   (option 1A of `my-pi-evidence/bash-background/SNAPSHOT-COST.md`: the exact snapshot before every call, against a
>   cheaper scan at the handoff with an uncertainty list): «Да, если это всего лишь 150 миллисекунд на 20 тыс. файлов,
>   конечно, блядь, надо делать снимок файлов точный. Это 1А.» Reason: only the exact states before and after give no
>   false attribution and no missed early change, and the price is small: about 8-22 ms in the git repositories measured
>   and about 150 ms for 20000 files outside git. The current exact pre-start snapshot of every top-level bash and
>   codemode call stays unchanged, no code change. Carriers: `snapshot` in `extensions/RQW-tools/ledger.ts`, taken in
>   `begin()` of `jobs.ts` before the command starts and compared with the end snapshot by the effects report. Proof:
>   `extensions/RQW-tools/test/ledger.test.ts` ("a snapshot compares states, not times") and
>   `extensions/RQW-tools/test/background.test.ts` (a file written just before the start or with a future mtime is not
>   reported; `scanned` names both snapshot costs). The report lists under
>   `effects` the files created and the files changed while it ran (with the RQW session and tool when another session wrote it), the
>   caller's own writes during the run (file tools, and the files a foreground bash command of the caller certainly
>   wrote by its footprint), own writes overwritten since, files deleted since the handoff, and the other jobs that ran
>   alongside. Every list is complete (Pi gives a custom tool's result text to the model whole). The scan has no
>   deadline of its own and runs also for a killed job; it is cancelled only when the caller's session ends. A failed or
>   cancelled scan, a git failure and a walk stopped at its limit are named in `effects.errors` or `scanned`, never
>   dropped. Write precondition (P1): a write over a file the session has read
>   or written, changed since by anyone else, is refused once with who changed it; the identical retry overwrites; a
>   file never seen is written without a check. The check, the stock tool and the ledger record of every RQW read, edit
>   and write run in one process-wide critical section per file (`withFileLock`, files locked in sorted order), so two
>   sessions that read one version cannot both pass the check and overwrite one after the other. Files are keyed by
>   their native real path (`identityKey` in keys.ts): symlink and case aliases share records, distinct files never do.
>   Records belong to a registry (`owner`, unique; the label "main", "code_writer#2" is only shown); a registry that ends
>   forgets what it saw, so a restarted session or a second session with the same label inherits nothing. A multi-file
>   edit or write records each written file even when a sibling failed; a file whose result says "Possibly changed" is
>   marked uncertain, and the next write of it is refused once until it is read. A read keys the spelling it will open
>   when it is about to run, after the calls it waited for (an earlier bash may have created the fallback spelling).
>   Own writes are kept per owner while a bash or codemode job of that owner runs (from its start until its report is
>   built, dropped when no job watches), so a later write by another session cannot erase them from `yours` and the
>   report shows the lost update under `overwritten`. A read whose file changed while it was read gets a note and does not
>   count as seen. Notes of a read, edit or write name the other session (`changed by code_writer#2 (edit, hh:mm:ss)
>   after you last saw it`). K1: `job kill` also cancels the queued calls of the same response that wait for the killed
>   job (transitively) and lists them in `cancelled_followers`; calls of later responses are not cancelled. A killed
>   queued call leaves the barrier at once and never runs (`withdraw` in barrier.ts), so a later call of the same file
>   does not wait for whatever the killed call was waiting for. N1: a job
>   that ended with a non-empty effects report the model has not seen (through `wait`, `status` or this note) adds one
>   line to the next top-level tool result of the caller, a codemode script's result included: `note: job#N (<command>) ended (exit 0); its report lists <n>
>   file changes: job status job#N.` (or `its effects report is incomplete (<reason>)`). W1: `job wait` takes `until`, a JavaScript regular expression on the output (a leading `(?i)` ignores case: GPT-6
>   Luna wrote it in the pilot and got an error); it returns as
>   soon as a job's output matches (`reason: "match"`, the matching line) while the job keeps running. S1: a codemode
>   script waits for a free worker of the process (an aborted waiter leaves the queue, so a released slot always reaches a
>   live waiter) (`PI_CODEMODE_MAX_WORKERS`, default 2, as Pi counts them) as a queued
>   job instead of failing after Pi's 60 s; the handoff of a script says how many workers are in use. A server command
>   that names a port a running job of any session serves gets a note. A bash call inside a codemode script never goes
>   to the background but takes the same process-wide git and package-folder claims, waiting inside the script. Each session's label comes through the optional
>   `options.label` of the offered factory: the path from the main session (RQW-agent passes `agent#1`,
>   `agent#1/agent#1`, `agent#1/code_writer#2`; RQW-review `review`, a child's reviewer `agent#1/review`; main is
>   `main`). It is shown only in notes; each registry keeps its unique owner. Children like main (coordinator's technical
>   decision at the rebase onto subagent parity, from the owner's «children like main» and the background of a whole
>   script): with an RQW-tools offer, a child's or reviewer's `codemode` is Pi's definition built from that session's API,
>   passed to the factory as the optional `options.codemode` and returned as one call of the child's barrier and a job of
>   its registry, so a child script goes to the background after 12 s like main's, and S1 slots count the scripts of main
>   and every child together. Without an offer the child keeps Pi's stock codemode as registered by Pi's factory.
>   Explorers get `job` only when offered and never edit or write. A child's review disposes its jobs when the child
>   ends (the child's lifetime signal ends the review run). The reviewer of RQW-review gets the offered `job` tool with its four tools when RQW-tools offers them (section
>   Review); Esc of a review aborts its jobs
>   (`abortAll`) and the end of the review disposes them, as RQW-agent does for subagents. The prompt section
>   `rqw_tools_execution` says that a background job holds the later calls of its response and, from later responses,
>   only calls that change what it names as held. Writes of file tools inside a codemode script are recorded as `<tool> in a codemode script` of the caller.
>   Reason: the replay of 131598 recorded tool calls left D4 with 4090 silent overlaps between background jobs and later
>   calls at the same wall time; FR-safe leaves none silent, makes 45 later calls wait for a held resource, and keeps the
>   same-response order; the owner chose it. Carriers: `extensions/RQW-tools/footprint.ts`, `ledger.ts`, `barrier.ts`
>   (held entries, followers), `jobs.ts`, `index.ts`, `codemode.ts`, `keys.ts`, `descriptions/job.md`,
>   `descriptions/write.md`; `extensions/RQW-agent/index.ts`, `extensions/RQW-review/index.ts` (labels, the reviewer's
>   `job`), `notes/prompt-tools-isolation.md` (section text); races R16-R24:
>   `notes/analysis-races.md` section 9. Pilot live probe (Haiku 5.5 and GPT-6 Luna, thinking high; logs
>   `my-pi-evidence/bash-background/probe-2/`) found six defects, fixed here: the footprint read a subshell's `)` as
>   part of a written path; an append by the caller's own bash was reported as a change of the build job; a write of a same-response follower, which starts the moment the job's work
>   ends and before its scan, was reported as the job's (the scan now runs before the barrier releases those calls); a
>   tracked file the job deleted was not reported (git lists index entries); and `waiting for` named the holds of a call
>   that a same-response follower waits for in full; a follower queued behind the job was listed as running alongside
>   it. The port note is computed before the server starts and also goes
>   into its handoff. The code review of 1ecb796 found the races fixed above (slot wakeups, a killed queued call still
>   holding its file, nested bash without claims, the P1 check outside the write's critical section, alias and owner
>   identity, the time cutoff); each has a test in `background.test.ts` (#3-#8) or `ledger.test.ts` that fails on the
>   code before the fix. Proof: `extensions/RQW-tools/test/footprint.test.ts`, `ledger.test.ts`,
>   `barrier-detach.test.ts` (held oracle, randomized; it fails when held entries are ignored),
>   `background.test.ts` (R16 and R17 fail when the classifier holds nothing), `extensions/RQW-agent/test/
>   nested-workers.test.ts` and `extensions/RQW-review/test/review.test.ts` (labels, reviewer `job` lifetime),
>   `extensions/RQW-agent/test/agent.test.ts` and `extensions/RQW-review/test/subagent.test.ts` (offered child codemode,
>   explorer `job`, path labels, a child reviewer's jobs on the child's end), `background.test.ts` ("S1 across sessions"),
>   `test/prompt-tools-isolation.test.ts` (section text).

## A-0074 · archived 2026-10-23 · Tools · Historical cross-platform proof

Status: OBSOLETE: historical verification, no current requirement; kept in notes/decisions-evidence.md#tools-historical-cross-platform-proof.
Introduced: `8f2ea64`. Archived by: docs-cleanup (this cleanup; exact commit recoverable with `git log -S'A-0074' -- DECISIONS-ARCHIVE.md`).
Verbatim text as it was in `DECISIONS.md` at `30952e6`, lines 526-528:

> - Historical proof: `npm test` (`node --test`, no model) and `.github/workflows/tests.yml` on macOS, Linux and Windows, plus a job
>   reproducing PowerShell, portable Git Bash without admin, then Node. Current verification policy is in [Work policy](#work-policy);
>   this historical coverage is not a Linux requirement or PowerShell runtime authorization.

## A-0075 · archived 2026-10-23 · Context

Status: SUPERSEDED by `[D-CONTEXT-WINDOW]` in DECISIONS.md.
Introduced: `6eb01a7`. Archived by: `docs-cleanup`.
Cleanup commit lookup: `git log -S'A-0075' --format='%h %s' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 532-536. Source: `30952e6:DECISIONS.md`.
Historical evidence: [decision evidence](notes/decisions-evidence.md).

> - `extensions/RQW-context/index.ts` applies the owner's rule to physical models after native routing: W = min(physical.contextWindow, 500000) is
>   the context window Pi uses, R = `Math.round(W / 10)` (a .5 rounds up), and Pi compacts above W - R. 272 000 ->
>   window 272 000, compaction above 244 800; 500 000 and 1 000 000 -> window 500 000, compaction above 450 000.
>   Built-in, models.json and extension models alike, at start (`--model`), on resume, after `/model` and model cycling.
>   No per-model list.

## A-0076 · archived 2026-10-23 · Context

Status: SUPERSEDED by `[D-CONTEXT-WINDOW]` in DECISIONS.md.
Introduced: `6eb01a7`. Archived by: `docs-cleanup`.
Cleanup commit lookup: `git log -S'A-0076' --format='%h %s' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 537-539. Source: `30952e6:DECISIONS.md`.
Historical evidence: [decision evidence](notes/decisions-evidence.md).

> - The physical window above 500 000 is lowered, not only the trigger. Owner, C:2015:
>   «если контекстное окно больше 500 тыс. токенов, то пусть оно будет 500 тыс. токенов. Резерв — 10% от края.»
>   C:2047 requires a universal automatic solution. The physical rule includes targets selected by native routing.

## A-0077 · archived 2026-10-23 · Context

Status: SUPERSEDED by `[D-CONTEXT-ROUTING]` in DECISIONS.md.
Introduced: `6eb01a7`. Archived by: `docs-cleanup`.
Cleanup commit lookup: `git log -S'A-0077' --format='%h %s' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 540-547. Source: `30952e6:DECISIONS.md`.
Historical evidence: [decision evidence](notes/decisions-evidence.md).

> - Mechanism, window: `agent.state.model` exposes the existing stable capped copy for a physical selection.
>   `AgentSession._buildRuntime` hooks the actual native Agent's `state` getter and `createLoopConfig` so old and new
>   SDK sessions, public state reads and native loop configuration apply the rule without a prior `session.model`
>   read. Stored models unwrap through shared WeakMaps, including `setModel(current)` and retained copies after reload.
>   For native virtual routing, `ModelRuntime.getPhysicalModel` caps the result of the native canonical lookup. This
>   covers request dispatch, response/usage/overflow lookups and direct SDK routes without changing the catalog.
>   Virtual selection identity and its declared or unknown window stay native. Extensions get the correct classes
>   through Pi's library alias or CLI bundle virtual modules; tests exercise both.

## A-0078 · archived 2026-10-23 · Context

Status: SUPERSEDED by `[D-CONTEXT-LIFECYCLE]` in DECISIONS.md.
Introduced: `6eb01a7`. Archived by: `docs-cleanup`.
Cleanup commit lookup: `git log -S'A-0078' --format='%h %s' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 548-553. Source: `30952e6:DECISIONS.md`.
Historical evidence: [decision evidence](notes/decisions-evidence.md).

> - Load check: before patching static hooks or acquiring ownership, the extension checks the writable/configurable
>   methods `_buildRuntime`, `getCompactionSettings`, `getPhysicalModel`, `_exceedsCompactionThreshold`,
>   `_checkCompaction`, `_runAutoCompaction`, `compact`, `_runDefaultCompaction`, `_getSummarizationRequestAuth`,
>   `_modelForMessage` and `_limitsModel`, the configurable `model` getter and extensible prototypes. The new routed
>   boundaries also check native method arities. Unsupported shapes produce one load error and no static changes.
>   Runtime Agent.state/createLoopConfig guards remain checked together before installation.

## A-0079 · archived 2026-10-23 · Context

Status: SUPERSEDED by `[D-CONTEXT-ROUTING]` in DECISIONS.md.
Introduced: `6eb01a7`. Archived by: `docs-cleanup`.
Cleanup commit lookup: `git log -S'A-0079' --format='%h %s' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 554-566. Source: `30952e6:DECISIONS.md`.
Historical evidence: [decision evidence](notes/decisions-evidence.md).

> - Mechanism, reserve: Pi compacts at `contextTokens > model.contextWindow - reserveTokens`. The existing
>   `SettingsManager.getCompactionSettings` wrapper preserves native validation and explicit settings by the original
>   selection key. For virtual selection, a session/request-local AsyncLocalStorage frame supplies the physical window
>   for THIS pre-request target or the physical model of the response being checked, never a global last-model value.
>   The actual Agent.prepareRequest callback is scoped lazily through the Agent hooks, including old observer sessions.
>   Automatic preparation inherits the triggering physical model; manual preparation uses the latest successful
>   response after native abort settles. Without a known physical window, native settings remain unchanged.
>   Native default summarization keeps the interception hook's preparation intact and uses a copy. Its existing
>   direct summary route is resolved once after interception; the copied preparation reserve binds once to that
>   target's W. Since Pi 1.4.0 R is only the trigger: `generateSummary*` ignores it, history and split-turn summaries
>   carry no explicit `maxTokens` and use the summarizing model's own output limit (`compaction.js`, `#9512`), still
>   clamped by pi-ai to the window minus the estimated input minus 4096 (limits 1 and 2 below). A cancelled/custom
>   compaction does not route a default summary. No router, registry mutation, dependency or public setting is added.

## A-0080 · archived 2026-10-23 · Context

Status: SUPERSEDED by `[D-CONTEXT-LIMITS]` in DECISIONS.md.
Introduced: `7e00dcb`. Archived by: `docs-cleanup`.
Cleanup commit lookup: `git log -S'A-0080' --format='%h %s' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 567-575. Source: `30952e6:DECISIONS.md`.
Historical evidence: [decision evidence](notes/decisions-evidence.md).

> - Consequences for a model above 500 000, all as for a 500 000 model: footer and `getContextUsage()` show the window
>   500k and 90% at the threshold; summary requests reach the provider with the 500 000 window and without an explicit
>   output limit (Pi 1.4.0; before it they were 0.8 and 0.5 x R, 40 000 and 25 000); the output cap of a request is
>   500 000 - context - 4096, about 45 900 at 450 000 context (the test sees 45 902); an answer reporting more than
>   500 000 input tokens counts as overflow (`pi-ai/dist/utils/overflow.js:152-156`). With compaction on and a history of several turns that a summary can
>   fit, Pi recovers: a completed answer is kept and the session is compacted with reason `overflow` and no retry
>   (`agent-session.js:2440-2443`); a length stop with no output at 99% of the window is compacted and retried once
>   (`agent-session.js:2437-2443`, `2467-2469`, `overflow.js:161-165`). Nothing about the window goes to the provider:
>   the OpenAI-compatible body has only `max_completion_tokens` changed, every other field as stock Pi.

## A-0081 · archived 2026-10-23 · Context

Status: SUPERSEDED by `[D-CONTEXT-LIMITS]` in DECISIONS.md.
Introduced: `a03eb47`. Archived by: `docs-cleanup`.
Cleanup commit lookup: `git log -S'A-0081' --format='%h %s' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 576-601. Source: `30952e6:DECISIONS.md`.
Historical evidence: [decision evidence](notes/decisions-evidence.md).

> - Known limits of the 500 000 window, no code change: the window rule is the owner's, and all follow from it.
>   The numbers below were measured on Pi 1.3.0 with explicit summary caps; Pi 1.4.0 keeps the same pi-ai clamp
>   (`simple-options.js:3-9`) on a summary request, now sized from the model's output limit. Not re-measured.
>   1. The output cap. pi-ai clamps a request's output to `contextWindow - context - 4096` with a floor of 1 token
>      (`pi-ai/dist/api/simple-options.js:5-9`), so on a 1M model it reaches 1 token at about 495 900 context tokens.
>      Pi does not recover in three cases. With `compaction.enabled: false` there is no compaction at all
>      (`agent-session.js:2392-2394`): measured `max_completion_tokens` at context 0 / 480 000 / 497 000 / 520 000 is
>      `[128000, 15902, 1, 1]` (stock Pi `[128000, 128000, 128000, 128000]`); a provider that obeys it answers 1 token
>      with stop reason `length` and no error. A history that is one oversized turn, such as a 700 000-token first
>      paste, gives requests with a 1-token cap; the overflow compaction that follows also has its turn-prefix summary
>      capped at 1 token and fails with "Turn prefix summarization failed: generation hit the token cap and the summary
>      is incomplete". When the part a compaction summarizes (all but the last `keepRecentTokens`) of a text-heavy
>      history estimates above about 496 000 tokens by characters, every request gets a 1-token cap and every
>      compaction fails: the summary request is capped the same way ("Summarization failed: generation hit the token
>      cap and the summary is incomplete"). A text-heavy history a little above the window still recovers, a resumed
>      one too: Pi checks a resumed session at its first prompt (`agent-session.js:1483-1485`, `_prepareRun`); in review runs against
>      a local stub the dead end began between 535 000 and 541 728 tokens (summary cap 5 112 at 534 864, 1 at
>      541 728). A tool-heavy history of the same size recovers, because summaries cut tool results to 2 000 characters
>      (`compaction/utils.js:82`). The test pins the cap with compaction off.
>   2. Summaries of prose-heavy histories. A summary request is a fresh context that pi-ai sizes by characters
>      (3.5 per token), so a chat history of English prose, about 4.4 chars per real token, estimates above the window
>      at the threshold and the summary's output cap is 1 token: on a 1M model the compaction at 450 000 fails with
>      "Summarization failed: generation hit the token cap and the summary is incomplete", then up to two failed
>      summary requests per prompt. Stock Pi does the same on a native 272 000 or 500 000 model; it is new for 1M models
>      only because stock Pi would not compact them before 983 616. Tool results are cut to 2 000 chars before the
>      estimate (`compaction/utils.js:82`), so tool-heavy coding sessions do not reach it.

## A-0082 · archived 2026-10-23 · Context

Status: SUPERSEDED by `[D-CONTEXT-SETTINGS]` in DECISIONS.md.
Introduced: `6eb01a7`. Archived by: `docs-cleanup`.
Cleanup commit lookup: `git log -S'A-0082' --format='%h %s' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 602-607. Source: `30952e6:DECISIONS.md`.
Historical evidence: [decision evidence](notes/decisions-evidence.md).

> - Physical models up to 500 000 keep their own object; only the reserve changes. The model registry is not touched: `/model`
>   and `--list-models` show the declared window, the session and the footer show 500k. So one model shows two windows
>   through events and RPC: `model_select.model` is the object passed to `setModel` and RPC `set_model` returns the
>   registry object (`rpc-mode.js:371-372`), both with the declared window; the session state (`ctx.model`,
>   `model_select.previousModel`, RPC `get_state` and `get_session_stats`) has the capped one. There is no fix without
>   a Pi API.

## A-0083 · archived 2026-10-23 · Context

Status: SUPERSEDED by `[D-CONTEXT-SETTINGS]` in DECISIONS.md.
Introduced: `a03eb47`. Archived by: `docs-cleanup`.
Cleanup commit lookup: `git log -S'A-0083' --format='%h %s' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 608-622. Source: `30952e6:DECISIONS.md`.
Historical evidence: [decision evidence](notes/decisions-evidence.md).

> - A reserve the user set still wins, measured against the capped window W: `compaction.reserveTokens` for all models
>   and `compaction.modelOverrides["provider/id"].reserveTokens` for that model, Pi's own precedence (1M with a reserve
>   of 30 000 compacts above 470 000). A user reserve of W or more would leave a threshold of 0 or below, so Pi would
>   compact before every request; then the rule's R applies instead (1M with 600 000 compacts above 450 000). Pi's docs
>   example (`docs/compaction.md:444-457`), `"some-provider/big-model": { "reserveTokens": 400000 }`, "triggers
>   compaction above 600K tokens" for a 1M model; with the extension the window is 500 000, so it compacts above
>   100 000. `compaction.enabled: false` still turns off threshold and overflow compaction. A models.json
>   `contextWindow` (a model entry or `modelOverrides`) is the model's declared window: up to 500 000 Pi uses it as
>   written, also to lower a 1M model; above 500 000 it is capped like any other source, because Pi's composed model
>   does not say where its window came from. A model without a positive contextWindow keeps Pi's values, as stock: for
>   a window of 0 or undefined Pi itself compacts after every response, because its post-response check is
>   `tokens > 0 - reserve` (`agent-session.js:2506` via `compaction/compaction.js:173-176`; only the pre-request check has a
>   `<= 0` guard, `agent-session.js:419-420`); a
>   response is skipped only when nothing lies beyond `keepRecentTokens` to summarize. The extension leaves that
>   unchanged.

## A-0084 · archived 2026-10-23 · Context

Status: SUPERSEDED by `[D-CONTEXT-LIFECYCLE]` in DECISIONS.md.
Introduced: `6eb01a7`. Archived by: `docs-cleanup`.
Cleanup commit lookup: `git log -S'A-0084' --format='%h %s' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 623-641. Source: `30952e6:DECISIONS.md`.
Historical evidence: [decision evidence](notes/decisions-evidence.md).

> - The hooks live as long as the process, one per class (`Symbol.for` guards), and act only while a loaded
>   RQW-context owns them: each factory adds a fresh token to the process-global `Set` under
>   `Symbol.for("rqw-context/owner")` on `globalThis`; its `session_shutdown` handler removes only that token.
>   The wraps act while the set is nonempty. Without an owner `getCompactionSettings` returns Pi's
>   own values, `_buildRuntime` installs no accessor, and an accessor already installed returns the model as stored.
>   Pi emits `session_shutdown` before it loads the next runtime's extensions: `/reload` (`agent-session.js:3001`,
>   then `_resourceLoader.reload()` at `3010`), `/new`, `/resume` and `/fork` (`agent-session-runtime.js:102-113`,
>   `teardownCurrent` before `createRuntime`). After the last owner switches RQW-context off and reloads, or emits
>   `session_shutdown`, the window and reserve are stock Pi's again (section Isolation). Concurrent owners survive
>   either shutdown order and reloads of other sessions; an old runtime removes only its own token, not a newer one.
>   SDK `dispose()` alone disconnects listeners and does not emit `session_shutdown`; callers must emit the lifecycle
>   event, as Pi does. While any owner remains, SDK sessions in the same process get the rule too, including sessions
>   that excluded the extension. Engineering decision: replace the owner slot with a process-global Set of live
>   owner tokens. Underlying owner requirement (C:2047): «Это должны быть универсальные решения, которые будут
>   работать всегда автоматически». Reason:
>   one slot let shutdown or reload of a newer SDK session disable an older, still-active owner.
>   The patch code itself is installed once per process, so after an update of my-pi a `/reload` keeps the old RQW-context code; Pi must be restarted for RQW-context changes to apply
>   (`INSTALL.md` step 4). Reason for text, not code: a replaceable implementation behind the guards adds machinery for
>   a case a restart covers.

## A-0085 · archived 2026-10-23 · Context

Status: MERGED by `[D-CONTEXT-ROUTING]` in DECISIONS.md.
Introduced: `6eb01a7`. Archived by: `docs-cleanup`.
Cleanup commit lookup: `git log -S'A-0085' --format='%h %s' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 642-653. Source: `30952e6:DECISIONS.md`.
Historical evidence: [decision evidence](notes/decisions-evidence.md).

> - Native virtual selection retains its callback, identity, state, thinking and declared or unknown window.
>   `ModelRuntime.getPhysicalModel` caps the physical target after native canonicalization. Session/request-local
>   context supplies its W/R for the current operation, including physical selection changes while routing waits.
>   Automatic preparation uses its trigger target; manual preparation uses the latest successful response after
>   native abort. Default summarization keeps interception preparation intact and routes once using the captured
>   selection. Its copy binds R to the summary target, retaining the original explicit reserve intent from preparation
>   through `reserveIntents`, without rereading live settings after interception or an awaited route. Pi 1.4.0 ignores
>   that R for the summary output (no explicit maxTokens, the model's own output limit bounds both summaries), so the
>   rebinding no longer changes a request; it stays, a later simplification is optional. No extra route, router or SDK fork is added.
>   The prior routed-physical bypass was a bug, not an owner-approved exception. Last-owner shutdown restores stock
>   physical lookup identity and settings. Implementation: `extensions/RQW-context/index.ts`;
>   details: `notes/context-questions.md`.

## A-0086 · archived 2026-10-23 · Context

Status: SUPERSEDED by `[D-CONTEXT-LIFECYCLE]` in DECISIONS.md.
Introduced: `7e00dcb`. Archived by: `docs-cleanup`.
Cleanup commit lookup: `git log -S'A-0086' --format='%h %s' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 654-669. Source: `30952e6:DECISIONS.md`.
Historical evidence: [decision evidence](notes/decisions-evidence.md).

> - Proof: `extensions/RQW-context/test/context.test.ts` runs real sessions of the library and the bundle with a
>   scripted provider that reports exact usage and a local OpenAI-compatible endpoint: Pi's own `session.model`,
>   `getContextUsage()`, `compaction_start` at W - R + 1 and not at W - R (also after a switch, `/reload`, resume, fork
>   and `/new` through `AgentSessionRuntime`, and in the pre-request check `_exceedsCompactionThreshold` between tool
>   turns), user reserves in memory and in a file-backed `settings.json`, overflow recovery above 500 000, the output cap
>   with compaction off, native virtual selection with capped physical requests, load order, a load without either internal, the request body
>   against stock Pi, and the switch: listed in `settings.json`, dropped, `/reload` gives window 1 000 000 and reserve
>   16 384, listed again and `/reload` gives the rule back. `test/isolation.test.ts` checks the same through the
>   `packages` filter. Concurrent SDK tests in `context.test.ts` run for library and bundle: A/B shutdown in both
>   orders, package-filter reload excluding B while A remains, reload A, and stock values after the last owner leaves.
>   Tests emit `session_shutdown` before SDK `dispose()` so their owner tokens do not leak between cases.
>   `extensions/RQW-context/test/routing.test.ts` also covers native routed physical targets in library and CLI
>   bundle, operation-local thresholds, captured selection and original reserve intent despite later settings changes,
>   independently routed summary budgets, concurrent sessions and last-owner restoration. These are synthetic-provider
>   tests, not cloud or interactive-terminal proof.
>

## A-0087 · archived 2026-10-23 · Prompt

Status: SUPERSEDED by `[D-PROMPT-CUSTOM]` in DECISIONS.md.
Introduced: `17c21eb`. Archived by: `docs-cleanup`.
Cleanup commit lookup: `git log -S'A-0087' --format='%h %s' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 672-675. Source: `30952e6:DECISIONS.md`.
Historical evidence: [decision evidence](notes/decisions-evidence.md).

> - First step is only the prompt extension (user: «пока делаем только экстеншен который заменяет промпт систменый на
>   наш»). `extensions/RQW-prompt/index.ts` sets `systemPromptOptions.customPrompt` in `before_agent_start` to
>   `extensions/RQW-prompt/SYSTEM.md` plus the workstation, `<critical>`, environment and date blocks. Not
>   `forceSystemPrompt`: Pi still appends project context, skills and `<cwd>` and records the prompt as sections.

## A-0088 · archived 2026-10-23 · Prompt

Status: SUPERSEDED by `[D-PROMPT-CUSTOM]` in DECISIONS.md.
Introduced: `17c21eb`. Archived by: `docs-cleanup`.
Cleanup commit lookup: `git log -S'A-0088' --format='%h %s' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 676-677. Source: `30952e6:DECISIONS.md`.
Historical evidence: [decision evidence](notes/decisions-evidence.md).

> - The text follows the concept in `notes/prompt-concept.md` and starts from the bench41 template, the only measured
>   version on Pi (+10.2 / +6.2 / +1.9 quality points on gpt-6-sol low / gpt-6-sol medium / gpt-6.1-sol medium).

## A-0089 · archived 2026-10-23 · Prompt

Status: MERGED by `[D-PROMPT-TOOL-ISOLATION]` in DECISIONS.md.
Introduced: `04aa50f`. Archived by: `docs-cleanup`.
Cleanup commit lookup: `git log -S'A-0089' --format='%h %s' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 678-679. Source: `30952e6:DECISIONS.md`.
Historical evidence: [decision evidence](notes/decisions-evidence.md).

> - Tool-specific search and execution instructions belong to RQW-tools, not `SYSTEM.md`; see Prompt/tools isolation
>   below. The `<critical>` verify line stays as in omp-lite.

## A-0090 · archived 2026-10-23 · Prompt

Status: SUPERSEDED by `[D-PROMPT-CUSTOM]` in DECISIONS.md.
Introduced: `1e6d295`. Archived by: `docs-cleanup`.
Cleanup commit lookup: `git log -S'A-0090' --format='%h %s' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 680-683. Source: `30952e6:DECISIONS.md`.
Historical evidence: [decision evidence](notes/decisions-evidence.md).

> - Writing a file longer than about 400 lines in parts (bench35 lost a response to the output limit) lives in the
>   `write` description, as in omp-lite, each part in its own response. Removed against bench41: the working
>   directory from the date line, because Pi already appends `<cwd>`.
>

## A-0091 · archived 2026-10-23 · Prompt

Status: OBSOLETE. Completed historical candidate/measurement, not a current rule.
Introduced: `8e3432e`. Archived by: `docs-cleanup`.
Cleanup commit lookup: `git log -S'A-0091' --format='%h %s' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 684-685. Source: `30952e6:DECISIONS.md`.
Historical evidence: [decision evidence](notes/decisions-evidence.md).

> - The four optional `SYSTEM.md` edits at `f6e9327` are not adopted as a package; main keeps its prompt unchanged. The owner wanted the minimum changes without breaking the prompt, and explicitly permitted GPT measurement (user: «Замеры правок System LMD можно тоже проводить на модели GPT-6»). On GPT-6 low, wall time improved by about 6.9%; on GPT-6.1 medium, quality changed by -2.29 percentage points (90% CI [-5.81, +1.24]). This does not prove a general regression, but does not establish safe noninferiority for the common prompt. Measurement-based rejection completes this task, rather than pausing it. Evidence and candidate history: `notes/bench46-gpt.md`, `notes/bench46-gpt.csv`, commits `80bec267` and `f6e9327`; the deployed carrier remains `extensions/RQW-prompt/SYSTEM.md` on main.
>

## A-0092 · archived 2026-10-23 · Prompt/tools isolation

Status: SUPERSEDED by `[D-PROMPT-TOOL-ISOLATION]` in DECISIONS.md.
Introduced: `04aa50f`. Archived by: `docs-cleanup`.
Cleanup commit lookup: `git log -S'A-0092' --format='%h %s' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 688-690. Source: `30952e6:DECISIONS.md`.
Historical evidence: [decision evidence](notes/decisions-evidence.md).

> - Owner: «Когда мы делаем эти отдельные модули, они должны быть полностью изолированы, самодостаточны, чтобы мы могли включать и выключать, как feature флаги».
>   Task: "Scope ONLY removing RQW-tools-specific runtime assumptions from RQW-prompt and putting them inside RQW-tools,
>   so each works with other off." Four manifesto edits stay on `prompt-manifest`, not here.

## A-0093 · archived 2026-10-23 · Prompt/tools isolation

Status: SUPERSEDED by `[D-PROMPT-TOOL-ISOLATION]` in DECISIONS.md.
Introduced: `04aa50f`. Archived by: `docs-cleanup`.
Cleanup commit lookup: `git log -S'A-0093' --format='%h %s' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 691-695. Source: `30952e6:DECISIONS.md`.
Historical evidence: [decision evidence](notes/decisions-evidence.md).

> - `extensions/RQW-prompt/SYSTEM.md` no longer names grep/find or assumes our shell barrier or partial writes.
>   `extensions/RQW-tools/index.ts` uses native `before_agent_start` mutations of `systemPromptOptions.sections`, with
>   no import or handshake with RQW-prompt. `search_method` needs declared read, grep and find;
>   `rqw_tools_execution` needs declared bash. Both check `selectedTools` minus `hiddenTools`, so explicit selections
>   do not acquire instructions for unavailable tools. Stock or custom prompt works in either extension order.

## A-0094 · archived 2026-10-23 · Prompt/tools isolation

Status: SUPERSEDED by `[D-PROMPT-TOOL-ISOLATION]` in DECISIONS.md.
Introduced: `02bd178`. Archived by: `docs-cleanup`.
Cleanup commit lookup: `git log -S'A-0094' --format='%h %s' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 696-699. Source: `30952e6:DECISIONS.md`.
Historical evidence: [decision evidence](notes/decisions-evidence.md).

> - Source proof, Pi 1.4.0: `dist/core/extensions/runner.js`, `emitBeforeAgentStart`, shares one normalized options
>   object across handlers; `dist/core/system-prompt.js`, `buildSystemPromptSections`, uses `customPrompt` as preamble
>   and still appends `sections` after cwd. `promptGuidelines` and tool guidelines are built only without customPrompt,
>   so they cannot carry these instructions. `forceSystemPrompt` deliberately bypasses sections; no override is added.

## A-0095 · archived 2026-10-23 · Prompt/tools isolation

Status: SUPERSEDED by `[D-PROMPT-TOOL-ISOLATION]` in DECISIONS.md.
Introduced: `04aa50f`. Archived by: `docs-cleanup`.
Cleanup commit lookup: `git log -S'A-0095' --format='%h %s' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 700-703. Source: `30952e6:DECISIONS.md`.
Historical evidence: [decision evidence](notes/decisions-evidence.md).

> - The two partial-write reminders were redundant: `extensions/RQW-tools/descriptions/write.md` already says
>   "write a file over about 400 lines in parts, each part in its own response: the first with write, then each next
>   with edit" and specifies the edit tail. That unchanged description remains the single owner. The shell barrier
>   sentence is not in the descriptions, so deleting it alone would lose effective content; it moves to a section.

## A-0096 · archived 2026-10-23 · Prompt/tools isolation

Status: SUPERSEDED by `[D-PROMPT-TOOL-ISOLATION]` in DECISIONS.md.
Introduced: `04aa50f`. Archived by: `docs-cleanup`.
Cleanup commit lookup: `git log -S'A-0096' --format='%h %s' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 704-708. Source: `30952e6:DECISIONS.md`.
Historical evidence: [decision evidence](notes/decisions-evidence.md).

> - Exact runtime text diff and risks: `notes/prompt-tools-isolation.md`. Proof: `test/prompt-tools-isolation.test.ts`,
>   real package filtering, sessions and prompt/tool patch replay on a faux provider, both orders, standalone extensions,
>   explicit tool selections, active-tool changes and disabling either extension through reload. `npm test` includes
>   package tests. No live model runs in this task; GPT measurements of the changed text follow separately.
>

## A-0097 · archived 2026-10-23 · Settings

Status: SUPERSEDED by `[D-SETTINGS-WARMING]` in DECISIONS.md.
Introduced: `b91f832`. Archived by: `docs-cleanup`.
Cleanup commit lookup: `git log -S'A-0097' --format='%h %s' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 711-729. Source: `30952e6:DECISIONS.md`.
Historical evidence: [decision evidence](notes/decisions-evidence.md).

> - Owner: «Да, и вообще надо убрать прогрев кэша, чтобы кэш прогревался, когда уходит сообщение первое, не раньше этого.»
>   Owner clarification: «Нам тоже настройки прогрева кэша нахуй не нужны через конфиги. Надо просто, чтобы они были внутри настроены в рамках плагина, и всё на этом. Чтобы они работали супер корректно, супер пиздато и эффективно.»
>   Background prompt-cache warming is off inside the plugin; normal inference requests still populate and read the
>   cache. `extensions/RQW-settings/cache-warming.ts` supplies a reversible, session-owned `getCacheWarmingMode`
>   policy only while that session loads RQW-settings. User `cacheWarming` values, including changes during a session,
>   cannot enable it. No new config knobs or settings-file, environment or `showCacheMissNotices` changes.
>   Reason: no synthetic keepalive inference; the first real request writes the cache. Pi 1.4.0 always constructs
>   its warmer, but off prevents it arming. Disabling/reloading or disposing restores the native getter and default
>   (`streaming`), without affecting another owning session. A checked lifecycle shim is needed because the public
>   extension API exposes a settings copy, and Pi's global-only getter ignores `applyOverrides`.
>   The lifecycle registry persists at zero owners and weakly maps wrappers to their original descriptors. Reinstall
>   recognizes a dormant settings wrapper restored by a later-released foreign hook, rather than nesting another
>   layer. Reason: RQW-settings precedes RQW-anthropic in production load order; their shutdown order must not grow
>   the prototype chain on every reload. Dormant hooks pass through and restore themselves when exposed at the top.
>   Proof: `extensions/RQW-settings/test/cache-warming.test.ts` (real SDK, faux provider and fake timers) and package
>   `test/cache-warming-reload.test.ts` (library/bundle, 12 co-loaded reloads, actual bind/dispose stack depth stays 2).
>   Child-session policy is carried independently by RQW-agent and RQW-review (sections Agent and Review).
>   TTL measurements and the accepted role policy: `notes/prompt-cache-policy.md` (owner:
>   «Надо, чтобы ты замерил, как у нас сейчас это работает, и предложил какое-то наилучшее решение для нас.»).

## A-0098 · archived 2026-10-23 · Settings

Status: SUPERSEDED by `[D-SETTINGS-DEFAULT-TOOLS]` in DECISIONS.md.
Introduced: `3720200`. Archived by: `docs-cleanup`.
Cleanup commit lookup: `git log -S'A-0098' --format='%h %s' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 730-737. Source: `30952e6:DECISIONS.md`.
Historical evidence: [decision evidence](notes/decisions-evidence.md).

> - `codemode` and `tool_search`, Pi's built-in tools, are active by default (owner: «Давай включим CodeMode и Tool
>   Search»). `extensions/RQW-settings/index.ts` adds them to the active tools at `session_start` under the same rule as
>   `grep` and `find`: no tool flag in argv and no `defaultTools` setting. It is the same rule with one copy in each
>   extension, `extensions/RQW-settings/selection.ts` and `extensions/RQW-tools/selection.ts`, so neither imports the
>   other (section Isolation). A tool is added only if it is registered, so `-builtin:codemode` gives no error.
>   Any user selection (`--tools`, `--exclude-tools`, `--no-tools`, `--no-builtin-tools`, `defaultTools`) leaves the stock
>   set. Mode `on` (Pi's default) is kept: Pi appends a "Codemode: `tools.<name>(args)` resolves to ..." line to the
>   descriptions of our six tools in each request. Texts, source lines and the barrier check: `notes/settings-codemode.md`.

## A-0099 · archived 2026-10-23 · Settings

Status: SUPERSEDED by `[D-SETTINGS-CODEMODE]` in DECISIONS.md.
Introduced: `3720200`. Archived by: `docs-cleanup`.
Cleanup commit lookup: `git log -S'A-0099' --format='%h %s' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 738-741. Source: `30952e6:DECISIONS.md`.
Historical evidence: [decision evidence](notes/decisions-evidence.md).

> - `codemode` is a call of the RQW-tools barrier with scope "all", like `bash`; the tool calls of its own script are
>   ordered by a barrier of that call. RQW-tools replaces Pi's built-in `codemode` at `session_start` with the same
>   definition and a grouped `execute` (`extensions/RQW-tools/nested.ts`, `codemode.ts`), so `-builtin:codemode` still
>   means no `codemode`. Reason: `[codemode(write f), read f]` let the read run first.

## A-0100 · archived 2026-10-23 · Settings

Status: SUPERSEDED by `[D-SETTINGS-CODEMODE]` in DECISIONS.md.
Introduced: `b98baec`. Archived by: `docs-cleanup`.
Cleanup commit lookup: `git log -S'A-0100' --format='%h %s' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 742-754. Source: `30952e6:DECISIONS.md`.
Historical evidence: [decision evidence](notes/decisions-evidence.md).

> - A script's tool call finds the barrier of its script by its tool call id: Pi gives it `<codemode id>/<n>`, and the
>   group registers its barrier under the codemode call's id. A nested id with no registered ancestor goes to the outer
>   barrier, or runs at once when an ancestor has a live entry there, so it never waits for itself. Reason: the first
>   version carried the barrier in `AsyncLocalStorage`, and Bun, which runs the Pi release binaries (`pi.exe` of PCLI
>   included), drops that context in a worker's `message` callback; every script that called a tool hung (review A).
>   Proven on Node 22 and 26 (`npm test`) and on Bun 1.3.14 (the runtime inside the Pi 1.4.0
>   binary, read from the release's `pi.exe`) and 1.4.3:
>   `extensions/RQW-tools/test/bun/codemode-check.mjs` runs Pi's CLI under Bun with a faux model; CI job `bun-codemode`.
>   Pi 1.4.0 admits codemode scripts through a FIFO wait for a worker slot (`PI_CODEMODE_MAX_WORKERS`, default 2, read
>   per call), capped at 60 seconds or the script's remaining deadline, instead of failing at once with "Codemode worker
>   limit reached"; the wait counts against the script timeout and each worker has a 256 MB VM limit, so a script
>   that waits on slots held by other waiting scripts can still time out. It is not unlimited parallel capacity and does
>   not replace the barrier above. Details: `notes/settings-codemode.md`, Limits.

## A-0101 · archived 2026-10-23 · Settings

Status: OBSOLETE. Completed historical candidate/measurement, not a current rule.
Introduced: `feefe18`. Archived by: `docs-cleanup`.
Cleanup commit lookup: `git log -S'A-0101' --format='%h %s' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 755-759. Source: `30952e6:DECISIONS.md`.
Historical evidence: [decision evidence](notes/decisions-evidence.md).

> - Measured with codemode on (bench45, T01-T07, 5 runs, the bench44 judge; `~/stock-bench/bench45.csv`): gpt-6.1-sol
>   medium quality 99.5 -> 97.4 (90% interval -3.7 to -0.5), seconds 51.1 -> 50.4, calls 40.9 -> 35.7; codemode called
>   32 times in 19 of 35 runs, `tool_search` never; most of the loss is one T06 point. gpt-6-sol low never calls
>   codemode: 91.9 -> 93.7, within noise. Edit, write and multi-file probes pass on both. Kept on by the owner's
>   request; the cost is recorded here.

## A-0102 · archived 2026-10-23 · Settings

Status: SUPERSEDED by `[D-SETTINGS-DEFAULT-TOOLS]` in DECISIONS.md.
Introduced: `3720200`. Archived by: `docs-cleanup`.
Cleanup commit lookup: `git log -S'A-0102' --format='%h %s' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 760-761. Source: `30952e6:DECISIONS.md`.
Historical evidence: [decision evidence](notes/decisions-evidence.md).

> - On `/reload` the `session_start` handlers of RQW-settings and RQW-tools leave the active set alone: Pi keeps the tools
>   the user switched off, and the handlers had added them again.

## A-0103 · archived 2026-10-23 · Settings

Status: SUPERSEDED by `[D-SETTINGS-GPT-FAST]` in DECISIONS.md.
Introduced: `fa05edf`. Archived by: `docs-cleanup`.
Cleanup commit lookup: `git log -S'A-0103' --format='%h %s' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 762-802. Source: `30952e6:DECISIONS.md`.
Historical evidence: [decision evidence](notes/decisions-evidence.md).

> - GPT Fast: OpenAI priority processing for GPT (Codex CLI maps its Fast to `service_tier` `"priority"`; Pi's openai-codex
>   provider sends the request body's `service_tier`, and Pi's cost table bills priority at 2x). Owner: «Так давай временно все
>   гпт в fast режиме что бы все саб агенты работали». Owner: «Как мне fast режим включить в нашем Pico? И чтобы он ещё и
>   отображался в статус баре, что мы в fast режиме. Есть такая опция? Нет?» Owner, final shape: «Режим Fast должен действовать
>   только на основной чат. И по умолчанию он должен передаваться сабогентам. Но если я запрещу исполнителю сабогенты запускать
>   в режиме Fast, то он должен этому повиноваться. Так это должно работать», «В CloudCode у нас режима Fast нет, потому что у
>   меня нет кредитов, чтобы режим Fast поддерживать в CloudCode. Поэтому наш режим Fast распространяется только на GPT. Можно
>   даже называять его GPT Fast.», «Чтобы не было заблуждения, пусть он будет Fast-GPT командой через дефис». Rules:
>   - The command is `/fast-gpt [on|off]` (no argument toggles), carried by `extensions/RQW-settings/fast-gpt.ts`. It
>     switches the main chat only. Only `openai-codex` requests get `service_tier: "priority"`; Anthropic requests are
>     never touched. The state is process-wide (it survives `/reload` and new sessions) and is not persisted across restarts,
>     as `/statusbar` is not; there is no settings key. RQW-settings owns the main chat's rule and the command because it is
>     the harness-settings extension: a request-level default that holds whatever the user's config says.
>   - Default off. Owner: «Все, вырубаю всех в fast режим, пожалуйста, сейчас». Owner: «Блять, Fast должен быть всегда по умолчанию выключенным. Почему ты сделал его включенным по умолчанию? Поправь это, пожалуйста». It is `FAST_GPT_DEFAULT = false` in
>     `fast-gpt.ts`; the owner turns it on with `/fast-gpt on`. Deleting the feature is deleting the three `fast-gpt.ts` files and their
>     calls, the `fast_gpt` parameter and the lightning.
>   - Hook: Pi 1.4.0's `streamSimple` of the openai-codex provider drops `serviceTier` (`buildBaseOptions` forwards a fixed
>     list of options), so the stream options cannot carry it. The public `before_provider_request` event (the main chat)
>     sets the body's `service_tier`, after checking that the payload's `model` is the session model of provider
>     `openai-codex`. Pi's pricing reads the response's `service_tier`, so priority cost is still counted. The WebSocket
>     transport (Pi's default `auto` tries it first) sends the same body: pi-ai `dist/api/openai-codex-responses.js` passes the
>     `onPayload` result (lines 175-178) to `processWebSocketStream`, which sends `{ type: "response.create", ...body }`
>     (line 1211; the cached-continuation frame spreads the body too, lines 1158-1168), so `model` is the bare id and
>     `service_tier` is top-level on both transports. The tests drive both: SSE with a replaced `fetch`, WebSocket with a
>     fake `globalThis.WebSocket` (the child tests use the default transport, so they run offline).
>   - Children (RQW-agent's `agent` subagents, `code_writer`, `shell_runner`; RQW-review's reviewers) inherit the caller's
>     GPT Fast state once, when they start, and keep it for their life, including `send` and `restart`; later `/fast-gpt`
>     changes do not reach a running child. A nested child inherits from its direct caller. Reviewers inherit the main chat's
>     state at their start. `agent`, `code_writer`, `shell_runner` and `review` take an optional boolean `fast_gpt` that overrides the
>     inherited state (`false` when the user forbids Fast for subagents; `send` and `restart` of `agent` may change it); a
>     null from a strict-mode provider means inherit. Each tool description carries the one sentence "By default children
>     inherit GPT Fast; pass fast_gpt false when the user forbids Fast for subagents." Each extension applies the rule to
>     its own sessions through its own `fast-gpt.ts` (`extensions/RQW-agent/fast-gpt.ts`, `extensions/RQW-review/fast-gpt.ts`),
>     reading the main chat's state at the child's start from RQW-settings over `pi.events` (query channel
>     `rqw-settings:fast-gpt-query`, answered synchronously; change channel `rqw-settings:fast-gpt`). This avoids any import
>     between extensions (section Isolation); without RQW-settings nobody answers and children stay on the standard tier.
>   - Status bar: the main chat's state is shown by the bright yellow lightning, see [Status bar](#status-bar).
>   - Proof: `extensions/RQW-settings/test/fast-gpt.test.ts`, `extensions/RQW-agent/test/fast-gpt.test.ts`,
>     `extensions/RQW-review/test/fast-gpt.test.ts`, `extensions/RQW-statusbar/test/fast-gpt.test.ts`: the real openai-codex
>     and anthropic providers inside real Pi sessions with only `fetch` replaced, so the asserted bodies are what Pi would send.
>

## A-0104 · archived 2026-10-23 · Isolation

Status: SUPERSEDED by `[D-ISOLATION-SELF-CONTAINED]` in DECISIONS.md.
Introduced: `81cafe3`. Archived by: `docs-cleanup`.
Cleanup commit lookup: `git log -S'A-0104' --format='%h %s' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 805-812. Source: `30952e6:DECISIONS.md`.
Historical evidence: [decision evidence](notes/decisions-evidence.md).

> - Every `RQW-*` extension is self-contained and can be switched on and off alone, like a feature flag (owner:
>   «Когда мы делаем эти отдельные модули, они должны быть полностью изолированы, самодостаточны, чтобы мы могли
>   включать и выключать, как feature флаги.»). Rules: no file of an extension, tests included, imports a file outside
>   its own folder; a helper two extensions need is copied (`selection.ts`, 19 lines); an extension's tests load only
>   that extension; tests of several extensions together live in `test/` at the package root (`test/package.test.ts`);
>   no extension leaves active behaviour after it is switched off. RQW-context and RQW-mouse deliberately have
>   process-wide scope: stock behaviour returns only when the last live owner in that process leaves (sections Context
>   and PCLI); switching one off in B does not disable it in an active A.

## A-0105 · archived 2026-10-23 · Isolation

Status: SUPERSEDED by `[D-ISOLATION-COVERAGE]` in DECISIONS.md.
Introduced: `81cafe3`. Archived by: `docs-cleanup`.
Cleanup commit lookup: `git log -S'A-0105' --format='%h %s' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 813-822. Source: `30952e6:DECISIONS.md`.
Historical evidence: [decision evidence](notes/decisions-evidence.md).

> - Proof: `test/isolation.test.ts` (in `npm test`). The list comes from `package.json` `pi.extensions`, so a new
>   extension is covered without a change to the test. Static part: every relative import of every file under
>   `extensions/<E>/` resolves inside it. Runtime part, one child process per variant (`test/isolation-run.ts`, real
>   `DefaultResourceLoader` and `AgentSession`, a faux 1M model, Pi's `codemode` and `tool_search` as built-in
>   factories): for each extension E switched off through the `packages` filter, no load or bind errors and the loaded
>   set is all but E; every other extension registers the same tools with the same descriptions as with everything
>   on; a model turn with a `read` call completes; switching E off with `/reload` gives the same loaded set, registered
>   tools, compaction reserve for a 1M model and session window as a fresh start without it. Before this change it
>   failed on the `RQW-settings` import of `../RQW-tools/selection.ts` and on the RQW-context reload trace (550 000
>   against 16 384).

## A-0106 · archived 2026-10-23 · Isolation

Status: SUPERSEDED by `[D-ISOLATION-SWITCH]` in DECISIONS.md.
Introduced: `81cafe3`. Archived by: `docs-cleanup`.
Cleanup commit lookup: `git log -S'A-0106' --format='%h %s' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 823-832. Source: `30952e6:DECISIONS.md`.
Historical evidence: [decision evidence](notes/decisions-evidence.md).

> - The switch is the object form of the `packages` entry in settings (`INSTALL.md`, "Switch one extension off"):
>   `{ "source": "<the same source string>", "extensions": ["-extensions/RQW-<name>/index.ts"] }`. Pi turns an object
>   entry into a filter for every source type (`dist/core/package-manager.js:1000-1009` `resolvePackageSources`;
>   `collectPackageResources` `:1848-1863` calls `applyPackageFilter` `:1903-1918`, which runs `applyPatterns`
>   `:548-591`: includes, `!` excludes, `+` force-includes, `-` force-excludes). An exact `-` pattern is compared with
>   the path relative to the package root after a leading `./` is stripped (`normalizeExactPattern` `:496-499`,
>   `matchesAnyExactPattern` `:500-519`), so it must name the file: `-extensions/RQW-<name>` (the folder) excludes
>   nothing. Docs: `docs/packages.md:94-121`. A git package is identified by its URL without the ref
>   (`docs/packages.md:127`), so the `source` stays `git:github.com/ARQAWA/my-pi`. It takes effect after `/reload`
>   (`dist/core/agent-session.js:2998-3021` re-reads settings and reloads the resources) or a restart.

## A-0107 · archived 2026-10-23 · Isolation

Status: SUPERSEDED by `[D-ISOLATION-SWITCH]` in DECISIONS.md.
Introduced: `81cafe3`. Archived by: `docs-cleanup`.
Cleanup commit lookup: `git log -S'A-0107' --format='%h %s' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 833-840. Source: `30952e6:DECISIONS.md`.
Historical evidence: [decision evidence](notes/decisions-evidence.md).

> - Limits of the switch, all Pi's own. `pi -e <dir>` ignores the filter: `-e` sources are resolved without one
>   (`package-manager.js:746-757` `resolveExtensionSources`) and merged with the settings paths
>   (`dist/core/resource-loader.js:370-372`, `:409`); for one run without an extension pass the wanted `index.ts` files
>   with `-e`, plus `-ne` if the installed copy must not load too (`docs/cli.md:194-197`). Pi's built-in extensions are
>   not package resources: they are switched off with `-builtin:<name>` in the top-level `extensions` setting
>   (`docs/settings.md:163`, `package-manager.js:736-744`). After `/reload` Pi keeps the active tool set
>   (`agent-session.js:3011-3021`, `docs/settings.md:58`), so with RQW-tools or RQW-settings switched off, `grep`/`find`
>   or `codemode`/`tool_search` stay active, now the stock ones, until `/new` or a restart.

## A-0108 · archived 2026-10-23 · Isolation

Status: MERGED by `[D-PROMPT-TOOL-ISOLATION]` in DECISIONS.md.
Introduced: `6281de7`. Archived by: `docs-cleanup`.
Cleanup commit lookup: `git log -S'A-0108' --format='%h %s' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 841-853. Source: `30952e6:DECISIONS.md`.
Historical evidence: [decision evidence](notes/decisions-evidence.md).

> - Prompt/tools isolation is complete (section Prompt/tools isolation): `SYSTEM.md` no longer describes RQW-tools;
>   RQW-tools supplies conditional search and execution sections. The package-level
>   `test/prompt-tools-isolation.test.ts` checks tool availability and reload independently of extension-local tests.
>   Owner: «Когда мы делаем эти отдельные модули, они должны быть полностью изолированы, самодостаточны, чтобы мы могли
>   включать и выключать, как feature флаги.» We accept Pi's native sections to meet that requirement, despite the
>   measured change on fixed GPT-6.1-sol medium questions: +0.56 assistant steps, +1.85 s and -3.33 checklist points;
>   GPT-6-sol low gained 6.67 checklist points. All 36 edit acceptance checks passed. The medium losses concern Rust
>   field-declaration citations rather than wrong values; the variant gained the T06 auth blocker delay. This is not
>   behavioral neutrality. Pi puts these sections after cwd, changing instruction position and removing two redundant
>   partial-write reminders; preserving their former positions would require extra coupling. Evidence and limits:
>   `notes/prompt-isolation-gpt.md`, 72 raw rows in `notes/prompt-isolation-gpt.csv`. The four optional manifesto edits
>   remain unadopted and separate (`notes/bench46-gpt.md`).
>

## A-0109 · archived 2026-10-23 · Agent

Status: SUPERSEDED by `[D-AGENT-WAIT]` in DECISIONS.md.
Introduced: `fe0e375`. Archived by: `docs-cleanup`.
Cleanup commit lookup: `git log -S'A-0109' --format='%h %s' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 856-874. Source: `30952e6:DECISIONS.md`.
Historical evidence: [decision evidence](notes/decisions-evidence.md).

> - Owner (verbatim): «основной агент запускает сабагента — воркера, shellrunner или codewriter. Пока они работают, он его либо ждёт, либо что-то делает параллельно, а потом ждёт. Когда shellrunner или codewriter отвечает, тот обрывает ожидание и дальше работает с его ответом. Если же он не ответил за время ожидания, то основной агент сам идёт и смотрит состояние codewriter или shellrunner, что там происходит, вычитывает его последние пять-десять сообщений и думает, что с ним делать дальше: interrupt его, давать ему какой-то follow-up, либо вырубать, либо перезапускать.»
>   «Надо сделать интеллектуально, чтобы основной агент большой, который поднял runner, через время поглядывал за ним, через пять минут проверял статус. Только не тратить токены, а через механический wait.»
>   «надо сделать интеллектуальное ожидание. Не пять минут, а чтобы большой агент сам решил, сколько он будет ждать.»
>   «Если они работают долго, пусть работают.»
>   «А почему стоп мы им делаем? Мы же договорились о том, что мы это сделаем, как в кодексе.»
>   «Можно начинать уже и можно продолжать всю работу, которая была до этого начата».
>   Reason: the caller, not a watchdog, decides how long to wait and how to manage continuing work. All three tools
>   share caller-local `wait`/`status` with mixed direct-child IDs. The caller estimates remaining duration and sets
>   timeout_ms somewhat longer on each wait; 300000 is only the omission/null default, not a cadence or maximum.
>   The mechanical pause itself spends no tokens and makes no model turns; children continue their own work, and
>   the wait call and its result are normal caller context.
>   Deadline returns diagnostics without canceling children; status includes the last 5–10 trimmed messages and
>   in-flight calls. Results arrive once through wait or the existing message wakeup, with delivery receipts on races.
>   No execution/turn/token/output-growth limits or automatic interrupt/stop/restart are introduced. Explicit controls
>   retain history on interrupt, fence old generations on restart/stop, and do not block on an uncooperative tool.
>   Carriers: `extensions/RQW-agent/index.ts`, `coordinator.ts`, `activity.ts`, descriptions and roles in that folder;
>   API, retention cost, implicit fallback and public in-process cancellation limits:
>   [RQW-agent README](extensions/RQW-agent/README.md#wait-status-and-management).
>

## A-0110 · archived 2026-10-23 · Agent

Status: SUPERSEDED by `[D-AGENT-CACHE]` in DECISIONS.md.
Introduced: `b91f832`. Archived by: `docs-cleanup`.
Cleanup commit lookup: `git log -S'A-0110' --format='%h %s' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 875-883. Source: `30952e6:DECISIONS.md`.
Historical evidence: [decision evidence](notes/decisions-evidence.md).

> - Owner: «Да, давайте мы исполнителям, ревьюерам кэш выключай.» This disables background warming, not prompt
>   caching (owner clarification: «Потому что если мы вообще выключим им кэш, то они будут пиздец жрать токенов нахуй.»).
>   `extensions/RQW-agent/index.ts` gives every child's in-memory SettingsManager `cacheWarming: "off"`, independent
>   of RQW-settings or the main user's mode. Prompt caching stays on. TTL approval (full quote in
>   [Anthropic subscription adapter](#anthropic-subscription-adapter)): «Если это замеренная цифра и 5 минут будет заебись в большинстве случаев, то пусть будет 5 минут.»
>   Each child's existing guarded stream wrapper sets `cacheRetention: "short"` on Anthropic Messages requests,
>   before the adapter's OAuth fallback. This is a built-in 5m policy, not a config knob; other APIs keep their options.
>   Reason: median observed resend gap 163s, with one of seven above 5m; a short write costs less than a 1h write.
>   Proof: `test/agent.test.ts` and package `test/prompt-cache.test.ts`; evidence: `notes/prompt-cache-policy.md`.

## A-0111 · archived 2026-10-23 · Agent

Status: MERGED by `[D-SETTINGS-GPT-FAST-CHILDREN]` in DECISIONS.md.
Introduced: `fa05edf`. Archived by: `docs-cleanup`.
Cleanup commit lookup: `git log -S'A-0111' --format='%h %s' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 884-885. Source: `30952e6:DECISIONS.md`.
Historical evidence: [decision evidence](notes/decisions-evidence.md).

> - Children inherit GPT Fast at start and `fast_gpt` overrides it: rule, quotes and carrier in
>   [Settings](#settings), «GPT Fast» (`extensions/RQW-agent/fast-gpt.ts`, `index.ts`).

## A-0112 · archived 2026-10-23 · Agent

Status: SUPERSEDED by `[D-AGENT-PARITY]` in DECISIONS.md.
Introduced: `c86e9bb`. Archived by: `docs-cleanup`.
Cleanup commit lookup: `git log -S'A-0112' --format='%h %s' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 886-938. Source: `30952e6:DECISIONS.md`.
Historical evidence: [decision evidence](notes/decisions-evidence.md).

> - Subagent parity, like Cursor (owner session 2026-10-23; agreement and Cursor/Codex/our evidence in
>   `my-pi-evidence/subagent-parity/`). This entry supersedes the earlier rules below that a subagent's prompt is
>   exactly the caller's `system` with no main prompt, and that a subagent has no `agent` tool (maximum depth main ->
>   subagent -> worker). Owner (verbatim): «Надо что бы саб агенты были как в куросре посмотри реверз инжинеринг и скажи
>   свои предложения».
>   - Prompt. Owner: «1 - про как в курсор не понял. я думал саб агент получает тот же систенмный промпт что и основной
>     агент ток чуть чуть подрезанный как это в курсоре сделано», then «1а. что бы тонко конфигурировать роль надо
>     добавить либо спец поле либо что бы промпт начинался с роли а потом уже сама задача, как то хитро надо сдлеть».
>     By default a subagent's prompt is the main agent's system prompt as Pi built it for the main run (read with the
>     public `ctx.getSystemPrompt()` of Pi 1.4.0; nothing is imported from RQW-prompt), then a short Cursor-style
>     reminder (it is a subagent, it answers its caller, instructions addressed to the main agent or a coordinator do
>     not apply to it), then the optional `role`. Coordinator decision (technical): `role` is a separate optional field,
>     not parsed from the start of `task`. `system` stays the full override, sent exactly. Nested subagents get the
>     main prompt handed down, not their caller's prompt. Reason: the child works under the same rules and project
>     context as main, and the caller tunes it with a few words instead of writing a whole prompt.
>   - Nesting. Owner: «1а» to "a subagent may start subagents without a level limit, as Codex V2. Workers stay the last
>     level. No global limits". General subagents get `agent` recursively; code_writer, shell_runner and explorers are
>     leaves; no depth, count or concurrency limit. Reason: a subagent can split its own work the way main does; the
>     existing caller-local runtime (delivery to the direct caller, a parent's answer waiting for its pending children,
>     interrupt/stop/restart cascading to descendants) already works per level.
>   - Coordinator rules. Owner: «Нет нет правила координатора это только для мейна ЭТОГО РЕПОЗИТОРИЯ, это наш локальный
>     режим тут в этой репо и он заложен через локальный агентс мд и через вложенные в него ссылки. Т.е. это не будет
>     работаь в других репо.» The product gets no coordinator rules: the `agent` description gets only Cursor's generic
>     when/when-not usage advice (not for narrow questions, a known file or two or one search; independent areas in
>     parallel; full context and the exact return; trust the result; the user does not see it).
>   - Child gaps. Owner: «2а (что значит когда ревьюер вернется? типа у нас он один что ли на всю систему?)» to "give
>     children codemode and tool_search, workers cwd/date/OS, all children the owner's settings; subagents may call
>     review". Every child (subagent, explorer, worker) gets Pi's built-in `codemode` and `tool_search` when its caller
>     has them active. General subagents get `review` when RQW-review is loaded, through RQW-review's own `pi.events`
>     offer `rqw-review:subagent-review`: each caller has its own reviews and numbering, and the verdict goes to the
>     caller that asked. Children run with the caller's session settings: shell path and prefix, image resize and
>     blocking, retries and provider timeouts, transport and its timeouts, compaction (reserve, kept tokens, per-model
>     overrides), thinking budgets, steering and follow-up modes, codemode mode and budget; warming stays off. The
>     reviewer is a child too (result review findings 1 and 2): it gets `codemode` and `tool_search` when its caller has
>     them active, and the same settings except the two queue modes (compaction included; the former forced
>     `compaction: { enabled: false }` is removed). Workers get cwd, OS and today's date after
>     their fixed role. Reason: a child is not weaker than main by accident; the evidence found these gaps without a
>     recorded reason (`ours/REPORT.md`).
>   - Rest of Codex. Owner: «3а»: durable resume, parent history fork, web search and MCP for children are deferred.
>   - Title. Owner: «2а» to an optional short title (3-5 words) shown in status and result headers: `title` on start and
>     restart of `agent`, `code_writer` and `shell_runner`. It shows as `title` in `status`, in the wait result's display
>     data (`results[i].display.title`) and in the message `details.title`, which the RQW-agent-ui card header shows after
>     `<name>#<id>` (branch p5-agent-ui); the delivered content keeps its `[agent#N] ...` format.
>   - Explore. Owner: «3 да давай сделаем эксплорера буквально как в курсоре там он как системный + очен коротка роль и он
>     запускается на модели родетиля а не на собой модели», then «2а» to "explore = the same system prompt + a very short
>     search role + thoroughness level (quick / medium / very thorough), runs on the parent's model, read and search only
>     (no edit/write, bash behind the git guard like the reviewer)". Engineering choice: the `explore` option of `agent`
>     `start` (not a fourth tool): one field reuses the agent runtime and adds no tool declaration to every request.
>   Carriers: `extensions/RQW-agent/index.ts`, `prompt.ts`, `workers.ts`; `extensions/RQW-review/index.ts`. Details:
>   [RQW-agent README](extensions/RQW-agent/README.md#prompt-kinds-and-title),
>   [RQW-review README](extensions/RQW-review/README.md#review-in-subagents). Proof: `extensions/RQW-agent/test/agent.test.ts`
>   ("subagent parity"), `test/workers.test.ts`, `test/nested-workers.test.ts`, `test/cli.test.ts`,
>   `extensions/RQW-review/test/subagent.test.ts`.

## A-0113 · archived 2026-10-23 · Agent

Status: SUPERSEDED by `[D-AGENT-PARITY]` in DECISIONS.md.
Superseded: `c86e9bb`.
Introduced: `7a9f505`. Archived by: `docs-cleanup`.
Cleanup commit lookup: `git log -S'A-0113' --format='%h %s' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 939-947. Source: `30952e6:DECISIONS.md`.
Historical evidence: [decision evidence](notes/decisions-evidence.md).

> - A general subagent for the main agent, the one the Scope section names as a separate task. The owner's words: «должна
>   быть опция поднимать любых рандомных саб-агентов, которые являются саб-потоком основного агента. Можно за базу взять
>   агента General Purpose из курсора и его воспроизвести»; «этот кастомный саб-агент, абстрактный саб-агент, должен
>   подниматься без системного промпта, чтобы основной агент передавал ему весь системный промпт. Полностью промптил его
>   от начала до конца»; «Чтобы он мог ему ставить задачу, прерывать, выключать, перезапускать. Он мог ему посылать
>   сообщение follow-up»; «чтобы основной агент тратил минимум токенов»; «все решения должны быть максимально простые ...
>   без оверенджинеринга»; «всё должно быть доказано». Carried by `extensions/RQW-agent/index.ts`. The prompt part
>   («без системного промпта ... весь системный промпт») is superseded by the parity entry above: the whole prompt is
>   now the optional `system` override, and the default is the main prompt with the reminder and `role`.

## A-0114 · archived 2026-10-23 · Agent

Status: SUPERSEDED by `[D-AGENT-API]` in DECISIONS.md.
Introduced: `fe0e375`. Archived by: `docs-cleanup`.
Cleanup commit lookup: `git log -S'A-0114' --format='%h %s' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 948-952. Source: `30952e6:DECISIONS.md`.
Historical evidence: [decision evidence](notes/decisions-evidence.md).

> - One tool `agent` with `action` `start`, `wait`, `status`, `send`, `interrupt`, `stop`, `restart` and the fields
>   `ids`, `timeout_ms`, `messages` (wait/status above), `id`, `system`, `role`, `title`, `explore` (parity entry above), `task`,
>   `model` (`provider/id`), `thinking` (Pi's levels `off` to `max`), `tools` (a subset of `read`, `bash`, `edit`,
>   `write`, `grep`, `find`). This selects base tools; delegation tools follow [Workers](#workers).
>   The schema passes Pi's `makeStrictJsonSchema`; `null` in an optional field counts as omitted.

## A-0115 · archived 2026-10-23 · Agent

Status: SUPERSEDED by `[D-AGENT-API]` in DECISIONS.md.
Introduced: `7a9f505`. Archived by: `docs-cleanup`.
Cleanup commit lookup: `git log -S'A-0115' --format='%h %s' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 953-956. Source: `30952e6:DECISIONS.md`.
Historical evidence: [decision evidence](notes/decisions-evidence.md).

> - In process, no spawn (Windows-safe): `createAgentSession` with `SessionManager.inMemory`, `SettingsManager.inMemory`,
>   and `DefaultResourceLoader` with `noExtensions`, `noSkills`, `noPromptTemplates`, `noThemes`, `noContextFiles`; cwd
>   is the main session's `ctx.cwd`. No extension, skill or context file is loaded into the subagent; by default the main
>   prompt (with RQW-prompt's text and AGENTS.md when main has them) reaches it as text through `ctx.getSystemPrompt()`.

## A-0116 · archived 2026-10-23 · Agent

Status: SUPERSEDED by `[D-AGENT-API]` in DECISIONS.md.
Introduced: `c86e9bb`. Archived by: `docs-cleanup`.
Cleanup commit lookup: `git log -S'A-0116' --format='%h %s' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 957-961. Source: `30952e6:DECISIONS.md`.
Historical evidence: [decision evidence](notes/decisions-evidence.md).

> - The system prompt, `system` when given or the default of the parity entry above, is sent exactly. Pi appends `<cwd>` and other sections to every custom prompt
>   (`buildSystemPromptSections` in Pi's `dist/core/system-prompt.js`); only a forced prompt goes out as it is. So the
>   loader carries an inline `before_agent_start` handler returning `{ systemPrompt: system }`. Only our inline
>   runtime hooks and the [worker tools](#workers) are loaded, not external extensions. A test checks that the request
>   has one system message equal to `system`, and another that the default is the main prompt plus the reminder.

## A-0117 · archived 2026-10-23 · Agent

Status: SUPERSEDED by `[D-AGENT-API]` in DECISIONS.md.
Introduced: `7a9f505`. Archived by: `docs-cleanup`.
Cleanup commit lookup: `git log -S'A-0117' --format='%h %s' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 962-965. Source: `30952e6:DECISIONS.md`.
Historical evidence: [decision evidence](notes/decisions-evidence.md).

> - The model runtime is the main session's, taken from `ctx.modelRegistry.runtime`, a plain field that is private only
>   in the TypeScript types. Reason: one credential store and one OAuth refresh (risk 1 of
>   `/tmp/pi-subagent-eval/report.md`), and providers that extensions register also serve the subagent, such as the
>   `anthropic` overlay of the installed `pi-claude-auth`. If Pi renames the field, `start` fails and the tests show it.

## A-0118 · archived 2026-10-23 · Agent

Status: SUPERSEDED by `[D-AGENT-API]` in DECISIONS.md.
Introduced: `7a9f505`. Archived by: `docs-cleanup`.
Cleanup commit lookup: `git log -S'A-0118' --format='%h %s' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 966-969. Source: `30952e6:DECISIONS.md`.
Historical evidence: [decision evidence](notes/decisions-evidence.md).

> - Defaults follow Cursor's generalPurpose: all tools, the main model ("inherit") (Cursor transcript 704ada44 in
>   `cursor-like-harness/kb/sources/cursor-reverse-extra`). Here: the main session's model and thinking level, all six
>   base tools, `agent` and the [worker tools](#workers). The earlier "no subagents of its own" default is superseded by
>   the owner's «1а» (parity entry above).

## A-0119 · archived 2026-10-23 · Agent

Status: MERGED by `[D-ISOLATION-SELF-CONTAINED]` in DECISIONS.md.
Introduced: `90700ad`. Archived by: `docs-cleanup`.
Cleanup commit lookup: `git log -S'A-0119' --format='%h %s' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 970-974. Source: `30952e6:DECISIONS.md`.
Historical evidence: [decision evidence](notes/decisions-evidence.md).

> - No imports across extension folders: `extensions/RQW-agent/` loads and works with every other RQW-* switched off or
>   absent, and switching RQW-tools off switches it off for subagents too (owner: «Когда мы делаем эти отдельные модули,
>   они должны быть полностью изолированы, самодостаточны, чтобы мы могли включать и выключать, как feature флаги»;
>   review G: the earlier `import rqwTools from "../RQW-tools/index.ts"` failed to load without that folder and gave
>   subagents RQW-tools with RQW-tools off).

## A-0120 · archived 2026-10-23 · Agent

Status: SUPERSEDED by `[D-AGENT-TOOLS-OFFER]` in DECISIONS.md.
Introduced: `90700ad`. Archived by: `docs-cleanup`.
Cleanup commit lookup: `git log -S'A-0120' --format='%h %s' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 975-987. Source: `30952e6:DECISIONS.md`.
Historical evidence: [decision evidence](notes/decisions-evidence.md).

> - Subagent tools follow the RQW-tools switch through a loose, optional handshake on Pi's shared event bus `pi.events`
>   (`docs/extensions.md` line 87: "Communicate with another extension | `pi.events`"; `events: EventBus` in
>   `dist/core/extensions/types.d.ts` line 1406; one bus per resource loader for all its extensions,
>   `dist/core/resource-loader.js` lines 248 and 511). At every `start` and `restart` RQW-agent emits
>   `rqw-tools:subagent-tools` with `{ offer(factory) }`. RQW-tools, when loaded, answers with `createTools`, a
>   `(cwd, settings) => ToolDefinition[]` that builds the six tools with a barrier of their own; RQW-agent calls it with
>   the main `ctx.cwd` and the main session's `pi.getSettings`, and passes the result as `customTools` with the `tools`
>   allowlist. The answer is there when `emit` returns: the bus is a Node `EventEmitter`, and its wrapper calls the
>   handler before its first `await` (`dist/core/event-bus.js` lines 4-18). Pi drops the handler of a stale instance on
>   reload and dispose (`invalidate` in `dist/core/extensions/loader.js` lines 141-150, called from
>   `dist/core/agent-session.js` lines 1007 and 2973). With no answer `customTools` is empty and Pi builds its stock
>   tools. Reason: stock tools lose the barrier and multi-file `edit`/`write`, so with RQW-tools on the subagents keep
>   them, and with it off they must not. RQW-tools works the same without RQW-agent.

## A-0121 · archived 2026-10-23 · Agent

Status: SUPERSEDED by `[D-AGENT-CHILD-SETTINGS]` in DECISIONS.md.
Introduced: `c86e9bb`. Archived by: `docs-cleanup`.
Cleanup commit lookup: `git log -S'A-0121' --format='%h %s' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 988-992. Source: `30952e6:DECISIONS.md`.
Historical evidence: [decision evidence](notes/decisions-evidence.md).

> - The subagent's `SettingsManager.inMemory` carries the caller's `shellPath`, `shellCommandPrefix` and
>   `images.autoResize`, the three settings Pi builds stock read and bash from (`_buildRuntime` in
>   `dist/core/agent-session.js` lines 2935-2946), so Git Bash on Windows applies to stock bash too, plus the other
>   session settings of the parity entry above (`childSettings` in `index.ts`). RQW-tools definitions read the main
>   session's settings per call instead.

## A-0122 · archived 2026-10-23 · Agent

Status: SUPERSEDED by `[D-AGENT-DELIVERY]` in DECISIONS.md.
Introduced: `fe0e375`. Archived by: `docs-cleanup`.
Cleanup commit lookup: `git log -S'A-0122' --format='%h %s' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 993-1007. Source: `30952e6:DECISIONS.md`.
Historical evidence: [decision evidence](notes/decisions-evidence.md).

> - Results are async. At the end of each run the direct caller gets the text through wait or `[agent#N] <text>`
>   through `pi.sendMessage`, once, as the wait decision above specifies. The
>   text is every final answer of the run, so a follow-up queued during the run does not hide the first answer (the brief
>   said "last assistant text"). Native runs awaiting worker results are intermediate, not final; see [Workers](#workers). The text also carries every final error of the run as `error: <reason>`, in order with
>   the answers: a failed follow-up does not hide the first answer (`[agent#1] FIRST ANSWER\n\nerror: bad request`,
>   review C), and a first task that fails for good does not vanish when Pi then runs a queued follow-up that succeeds
>   (`[agent#1] error: bad request: first task\n\nSECOND ANSWER`, review D). An attempt that Pi repeats is not a result. Pi
>   repeats a request on two paths and emits an event only when it does: `auto_retry_start` for a retryable error
>   (`_prepareRetry` in Pi's `agent-session.js`), and `compaction_end` with `willRetry: true` for a context overflow error
>   or a recoverable `length` stop (`_checkCompaction`, review E). Either event removes the error or partial text of the
>   last assistant message, and only when that message added one: a `length` stop with no text adds nothing, so an
>   earlier answer stays. Threshold compaction has `willRetry: false` and removes nothing. Bad calls (unknown
>   id or model, no credentials, missing `system` or `task`) fail at once as a tool error, which costs less than a later
>   message. Credentials are checked as Pi's prompt checks them: the registry's auth snapshot, then
>   `runtime.checkAuth(provider)`, because the snapshot fills asynchronously and alone rejected valid models.

## A-0123 · archived 2026-10-23 · Agent

Status: SUPERSEDED by `[D-AGENT-DELIVERY]` in DECISIONS.md.
Introduced: `c33ed4d`. Archived by: `docs-cleanup`.
Cleanup commit lookup: `git log -S'A-0123' --format='%h %s' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 1008-1028. Source: `30952e6:DECISIONS.md`.
Historical evidence: [decision evidence](notes/decisions-evidence.md).

> - Delivery never loses a result to an abort of the main agent (review finding: a follow-up waits in the main agent's
>   queue, which TUI Esc clears through `clearQueue()` and RPC `abort` leaves without a turn). When the main session is
>   idle (`ctx.isIdle()`), the message goes with `triggerTurn: true` and starts a turn. When it is busy, it goes with
>   `triggerTurn: false`: Pi holds it outside the queue and appends it to the session at the end of the current turn or
>   run, aborted or not (`sendCustomMessage`, `_flushPendingCustomMessages` in Pi's `agent-session.js`), and the
>   `agent_before_settle` handler returns `continue: true` while such a result is not yet followed by an assistant
>   message in the branch (tracked by a delivery id in `details`, a `randomUUID()` that no other extension instance or
>   process repeats: a counter restarted at 1 after `/reload`, `/resume`, `/fork` or `pi -c` and matched an old,
>   answered entry of the same session, so the new result got no turn; review B). After an abort no turn starts, since
>   Esc means stop; the result stays in the session and the model sees it on the next turn. Re-sending after an abort, the first
>   idea, was dropped: after an RPC abort the old copy stays queued and would arrive a second time with an extra turn.
>   Pi runs every extension's `agent_before_settle` handler in a row before it settles, so a result can come in after
>   ours returned, for example while another extension's slow async handler runs after ours; held with
>   `triggerTurn: false`, it would get no turn (review C). So our handler sets a `settling` flag when it lets the run
>   stop, `turn_start` and `agent_settled` clear it, and `deliver` keeps results sent while it is set; the
>   `agent_settled` handler sends them. Pi defers every `triggerTurn: true` call separately and runs one full turn for
>   each, so only the last held result goes with `triggerTurn: !event.aborted`; the earlier ones go with
>   `triggerTurn: false`, which Pi appends at once since the run is no longer active, and the one deferred turn sees all
>   of them (review D: two results gave two main turns).
>   Rare case: a result that arrives during a manual `/compact` with no run is appended without a turn and is seen on
>   the next one.

## A-0124 · archived 2026-10-23 · Agent

Status: SUPERSEDED by `[D-AGENT-DELIVERY]` in DECISIONS.md.
Introduced: `8344d2e`. Archived by: `docs-cleanup`.
Cleanup commit lookup: `git log -S'A-0124' --format='%h %s' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 1029-1032. Source: `30952e6:DECISIONS.md`.
Historical evidence: [decision evidence](notes/decisions-evidence.md).

> - Ids `agent#N` never repeat within a session. Every extension instance (`/reload`, `/resume`, `/fork`, `pi -c`) starts
>   its counter on `session_start` above the highest `agent#N` in the session's `[agent#N]` messages and `agent` tool
>   results, so a new subagent in a continued session gets `agent#2`, not a second `agent#1` whose result would read as
>   the old task's and to which a `send agent#1` meant for the old, killed subagent would go (review D).

## A-0125 · archived 2026-10-23 · Agent

Status: MERGED by `[D-AGENT-WAIT]` in DECISIONS.md.
Introduced: `fe0e375`. Archived by: `docs-cleanup`.
Cleanup commit lookup: `git log -S'A-0125' --format='%h %s' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 1033-1034. Source: `30952e6:DECISIONS.md`.
Historical evidence: [decision evidence](notes/decisions-evidence.md).

> - No execution timeout of our own: Pi's provider timeouts and retries apply, and the caller can interrupt.
>   Caller-chosen wait deadlines return control/diagnostics, not a child cancellation (wait decision above).

## A-0126 · archived 2026-10-23 · Agent

Status: SUPERSEDED by `[D-AGENT-SEND]` in DECISIONS.md.
Introduced: `029160d`. Archived by: `docs-cleanup`.
Cleanup commit lookup: `git log -S'A-0126' --format='%h %s' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 1035-1063. Source: `30952e6:DECISIONS.md`.
Historical evidence: [decision evidence](notes/decisions-evidence.md).

> - `send` to a running subagent (and to a running `code_writer` / `shell_runner`) is Pi steering, `session.steer`; to
>   an idle one it starts a new run with the history. Coordinator proposal, accepted by the owner with «Да»: «сообщение
>   работающему субагенту будет доходить после его текущего вызова инструмента, а не после всей его работы, как в
>   основном чате». Reason: the earlier `session.followUp` waited for the child's whole run, and `interrupt` was the only
>   faster way, which aborts the in-flight tool calls and workers. Pi 1.4.0 delivers a steering message after the
>   current assistant turn has executed its tool calls (all calls of that turn) and before the next model request, with
>   no abort; a message sent before the first request goes into that request. Result text: `agent#N: queued after the
>   current tool call`; a child that is native-idle and waiting only for its own workers is woken at once (reply `agent#N: sent`, code review finding). Carriers: `extensions/RQW-agent/index.ts` (`send`; the run loop also drains steering that missed
>   the last poll), the tool descriptions, `extensions/RQW-agent/test/steer.test.ts`.
>   Interrupt and redirect in one call, like Cursor's Subagent `interrupt:true`; owner: «4 пункт мне нравится»: `send`
>   takes an optional boolean `interrupt` (agent, code_writer, shell_runner). On a running child it drops the queued
>   steering and follow-ups, aborts the current turn exactly like `interrupt` (same code path; session and history kept),
>   returns at once with the reply `<name>#N: interrupted, sent`. No time limit, by the owner's rule of no hard limits for agents (this entry: no execution
>   timeout of our own; coordinator relayed it as the reason for this change): the task is recorded as the child's next run and starts, once, when
>   the old run has stopped; a tool ignoring the abort signal just delays it and `status` shows `pending_sends`. Until then
>   the child counts as running, so `wait` never reports `idle` and ends with `target_changed` at the new run; a native run
>   woken by a worker result is waited out before the new prompt (code review findings: a premature `idle`, and Pi's
>   "Agent is already processing" losing the sends). A later
>   `send` before the start is appended in order (one prompt); `interrupt`, `stop` and `restart` drop pending tasks. On
>   an idle child it is a plain send; without the flag behavior is unchanged. Carriers:
>   `index.ts` (`requestInterrupt`, `Agent.next`), the schema and descriptions, `test/steer.test.ts`,
>   `test/nested-workers.test.ts`.
>   `interrupt` requests `session.abort()`, drops queued steering and follow-ups, sends no result message and keeps history.
>   It returns the pre-interrupt snapshot and cancellation-requested state without waiting indefinitely; a plain send is rejected
>   while cancellation remains pending, unless an interrupting `send` is already waiting (then it is appended).
>   `stop` disposes the session and forgets the id. Closing a session (`stop`, `restart`, `session_shutdown`) clears its
>   queue before `dispose()`: `dispose()` aborts without Pi's abort flag, so Pi would run a queued follow-up on the
>   disposed session and bill a request after `stopped`. `restart` disposes and creates a fresh session with the same
>   `system`, model, thinking and tools or the ones given, and runs `task` if given.

## A-0127 · archived 2026-10-23 · Agent

Status: SUPERSEDED by `[D-AGENT-MANAGEMENT]` in DECISIONS.md.
Introduced: `fe0e375`. Archived by: `docs-cleanup`.
Cleanup commit lookup: `git log -S'A-0127' --format='%h %s' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 1064-1070. Source: `30952e6:DECISIONS.md`.
Historical evidence: [decision evidence](notes/decisions-evidence.md).

> - Management registration across the three tools runs in call order; wait releases the queue after subscription,
>   before its Promise settles. Pi runs the calls of one response in parallel, and a batch of
>   `start` and `send agent#1` failed without this (checked by removing it). `start`, `send` to an idle subagent and
>   `restart` with a task return only once Pi has started the run, through the `preflightResult` callback of
>   `session.prompt` (or once the run has ended). Before that Pi's async preflight runs with no active run, so an
>   `interrupt`, `stop` or `restart` next in the same batch aborted nothing: the request still went out and `interrupt`
>   waited for the whole run (review E).

## A-0128 · archived 2026-10-23 · Agent

Status: SUPERSEDED by `[D-AGENT-MANAGEMENT]` in DECISIONS.md.
Introduced: `40574b5`. Archived by: `docs-cleanup`.
Cleanup commit lookup: `git log -S'A-0128' --format='%h %s' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 1071-1075. Source: `30952e6:DECISIONS.md`.
Historical evidence: [decision evidence](notes/decisions-evidence.md).

> - `start`, `send` and `restart` also return at Pi's `compaction_start`: Pi's run is active from there, and a pre-run
>   compaction of a large history (for example after an interrupt) would otherwise hold the main agent, an `interrupt`
>   behind it and Esc for a whole summary request. Closing a session (`stop`, `restart`, `session_shutdown`) calls
>   `abort()` and disposes only after it: `dispose()` alone sets no abort flag, so Pi went on from an aborted pre-run
>   compaction to a request from the disposed session (review F).

## A-0129 · archived 2026-10-23 · Agent

Status: SUPERSEDED by `[D-AGENT-MANAGEMENT]` in DECISIONS.md.
Introduced: `fe0e375`. Archived by: `docs-cleanup`.
Cleanup commit lookup: `git log -S'A-0129' --format='%h %s' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 1076-1079. Source: `30952e6:DECISIONS.md`.
Historical evidence: [decision evidence](notes/decisions-evidence.md).

> - Print/JSON use one caller-wide non-consuming fallback wait in `agent_end`, with the omission default. A result
>   follows normal message continuation; deadline returns compact status to the caller for its decision, not a stop.
>   Native-idle subagents use the same bounded fallback for their workers without forwarding intermediate answers.
>   Explicit waits take priority. TUI/RPC idle callers retain push wakeups. Carrier: `coordinator.ts` and `index.ts`.

## A-0130 · archived 2026-10-23 · Agent

Status: SUPERSEDED by `[D-AGENT-MANAGEMENT]` in DECISIONS.md.
Introduced: `7a9f505`. Archived by: `docs-cleanup`.
Cleanup commit lookup: `git log -S'A-0130' --format='%h %s' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 1080-1080. Source: `30952e6:DECISIONS.md`.
Historical evidence: [decision evidence](notes/decisions-evidence.md).

> - `session_shutdown` aborts and disposes every subagent without messages. No cap on the count.

## A-0131 · archived 2026-10-23 · Agent

Status: SUPERSEDED by `[D-AGENT-LIMITS]` in DECISIONS.md.
Introduced: `7a9f505`. Archived by: `docs-cleanup`.
Cleanup commit lookup: `git log -S'A-0131' --format='%h %s' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 1081-1082. Source: `30952e6:DECISIONS.md`.
Historical evidence: [decision evidence](notes/decisions-evidence.md).

> - Accepted limits: a result that arrives after the main session ended is lost; a subagent may read files the main agent
>   is editing; subagents share the process with the TUI.

## A-0132 · archived 2026-10-23 · Agent

Status: MERGED by `[D-CONTEXT-WINDOW]` in DECISIONS.md.
Introduced: `c33ed4d`. Archived by: `docs-cleanup`.
Cleanup commit lookup: `git log -S'A-0132' --format='%h %s' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 1083-1085. Source: `30952e6:DECISIONS.md`.
Historical evidence: [decision evidence](notes/decisions-evidence.md).

> - `RQW-context` patches Pi classes for the whole process, so a subagent gets the owner's universal window rule like
>   every model: its window is capped at 500 000 and its compaction reserve is 10% of that window. Checked in review: a
>   subagent on a 1 000 000 model sends its request with window 500 000 when RQW-context is loaded.

## A-0133 · archived 2026-10-23 · Agent

Status: SUPERSEDED by `[D-AGENT-DELIVERY]` in DECISIONS.md.
Introduced: `b7d9ae7`. Archived by: `docs-cleanup`.
Cleanup commit lookup: `git log -S'A-0133' --format='%h %s' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 1086-1114. Source: `30952e6:DECISIONS.md`.
Historical evidence: [decision evidence](notes/decisions-evidence.md).

> - Proof: `extensions/RQW-agent/test/agent.test.ts`, faux-provider tests (a copy of the RQW-agent folder in a
>   folder with no other extension loads and delivers, and the source has no `../` import; without RQW-tools the
>   subagent's `write` is the stock one, no `files`; exact system prompt, model,
>   thinking, tool subset, management actions, steering while running (`steer.test.ts`: a held tool call, `send` during it, the message in the next request after the tool result, nothing aborted), the main turn, shutdown, errors, call order, print
>   mode; one request only after `stop`, `restart` or `session_shutdown` with a queued follow-up; a result arriving
>   while the main agent streams continues its run once; after TUI Esc and after RPC abort the result is in the session
>   once, no run starts, and the next prompt carries it once; in a continued session that already holds an `[agent#1]`
>   result, a new result while busy still continues the run once, in TUI and print mode; a queued follow-up that fails
>   delivers the first answer and the error in one message; a first task that fails for good with a queued follow-up that
>   succeeds delivers the error and the answer in one message; an error that Pi retries is not delivered; neither is an
>   overflow error nor a truncated `length` answer that Pi compacts and retries; `interrupt`, `stop` and `restart` right
>   after `start` in one batch return at once and leave no subagent request; two results
>   that arrive while a second extension's slow `agent_before_settle` handler, loaded after RQW-agent, runs get one main
>   turn that sees both; in a continued session a new subagent gets `agent#2`; after an interrupt above the threshold `send` returns within 100 ms and `interrupt`, `stop`, `restart` or `session_shutdown` right after it send no summary request, and `stop`, `restart` or `session_shutdown` during that summary abort it and send nothing more). Each test passes alone. With
>   an empty extension the original 13 fail; without the queue clearing, the delivery change or the `continue` the new
>   tests fail; with a per-instance delivery counter the two continued-session tests fail; on 6b2cfb5 the two review C tests fail; on ff8781b
>   the four tests changed or added for review D fail except the retried-error one, which fails without the
>   `auto_retry_start` line; on 8344d2e the two review E tests fail. On 0789ab1 the seven review F tests fail; with only the `compaction_start` line six of them fail. On
>   40574b5 the folder and stock-tools tests fail; with no offer from RQW-tools the RQW-tools test fails, and so it does
>   when RQW-tools offers its main definitions with the main barrier. The mandatory package integration in `test/agent-tools.test.ts` checks `write.files[]` and a
>   separate subagent barrier while the main barrier is held; after filtering RQW-tools out and reloading,
>   new subagents get stock write. It has no missing-folder skip; extension-local tests load only RQW-agent. Live runs
>   in a fixture repository with `pi -e <repo> --model anthropic/<model> --thinking low --mode json -p <prompt>`:
>   Haiku 5.5 started a subagent with its own prompt, read a file and answered a follow-up (`[agent#1] ZED: 3`,
>   `[agent#1] ZED: alpha`); Haiku 5.5 queued a follow-up, interrupted a `sleep 40`, restarted
>   (`[agent#1] W: RESTARTED`, 11 s, no `sleep` left); Opus 5.5 ran two subagents, one with an inherited model, and got
>   the queued follow-up in the same message (`[agent#1] W: ... first ... W: ... second`,
>   `[agent#2] Q: The bug is in add ...`).
>

## A-0142 · archived 2026-10-23 · Review · Deep reviewer and hang guard
Status: SUPERSEDED by `[D-REVIEW-DEEP]` ([DECISIONS.md, Review](DECISIONS.md#review)). Absolute evidence path dropped; hang-guard replacement is BACKLOG.md item R01.
Introduced: `a04a9c0`, the oldest hit of `git log -S'Owner (verbatim): «Он не должен быть супердушным, супердотош' -- DECISIONS.md`.
Archived by: docs-cleanup, 2026-10-23; the commit is `git log -S'A-0142' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 1205-1218 at `30952e6`, verbatim:

> - Owner (verbatim): «Он не должен быть супердушным, супердотошным, проверять на 1000%, быть перфекционистом. Он должен просто контролировать качество работы: всё сделано качественно, всё сделано, что было заказано, ничего лишнего не было сделано.»
>   «никакой экономии нахуй. Агент должен делать столько, сколько ему необходимо, чтобы достичь качественного результата, качественной оценки, качественной проверки. Никаких не должно быть экономических ограничений.»
>   «У него не должно быть ограничения по tool call, по инструментам, по прочему. Он должен работать в рамках того, как работают все большие агенты. У него должен быть тот же самый инструментарий»
>   «Прямо в рабочей папке, в которой работает основной агент.»
>   «для кода он запускает тесты, не запускает сам код для обычного кода, а для автотестов он не запускает автотесты... сам результат работы он не запускает»
>   «Давай пойдем коротким путем... Сначала сделаем нового ревьюера, потом уже будем дальше двигаться.»
>   Reason: judge quality, completeness and absence of unagreed additions, not perfectionism; read and check as much
>   as needed without economy or a tool-call budget. Carrier: `extensions/RQW-review/REVIEWER.md`, replaced with
>   the supplied `/Users/arkadijcukavin/ai-project/my-pi-evidence/real-bench/prompts/REVIEWER-DEEP.md` verbatim.
>   Both levels share it; `LEVELS` models/thinking, disputes and verdict handling stay unchanged. The accepted
>   coordinator proposal supplies `read`, `bash`, `grep`, `find`, without `edit` or `write`; tool sourcing and limits
>   are specified below. Engineering decision requested in the task: retain the existing hang guard and raise
>   `TIMEOUT_MS` from 10 to 30 minutes for deeper reading and repository tests. This is hang protection, not an
>   economic budget; replacing hang protection is a separate later task. No new live model quality claim is made.

## A-0143 · archived 2026-10-23 · Review · No warming, five-minute cache
Status: SUPERSEDED by `[D-REVIEW-CACHE]` ([DECISIONS.md, Review](DECISIONS.md#review)).
Introduced: `b91f832`, the oldest hit of ``git log -S'er: «Да, давайте мы исполнителям, ревьюерам кэш выключай.» `' -- DECISIONS.md``.
Archived by: docs-cleanup, 2026-10-23; the commit is `git log -S'A-0143' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 1220-1227 at `30952e6`, verbatim:

> - Owner: «Да, давайте мы исполнителям, ревьюерам кэш выключай.» `extensions/RQW-review/index.ts` sets
>   `cacheWarming: "off"` in each reviewer's in-memory SettingsManager, independently of RQW-settings and the main
>   user's mode. Prompt caching stays on. TTL approval (full quote in
>   [Anthropic subscription adapter](#anthropic-subscription-adapter)): «Если это замеренная цифра и 5 минут будет заебись в большинстве случаев, то пусть будет 5 минут.»
>   Each reviewer's existing guarded stream wrapper sets `cacheRetention: "short"` on Anthropic Messages requests
>   before the adapter's OAuth fallback, a built-in 5m policy with no config knob. Other APIs are unchanged.
>   Reason: measured review duration median 30.9s, maximum 178s, so buying 1h writes is usually unnecessary.
>   Proof: `test/review.test.ts` and package `test/prompt-cache.test.ts`; evidence: `notes/prompt-cache-policy.md`.

## A-0144 · archived 2026-10-23 · Review · Reviewer GPT Fast
Status: SUPERSEDED by `[D-REVIEW-FAST]` ([DECISIONS.md, Review](DECISIONS.md#review)).
Introduced: `fa05edf`, the oldest hit of `git log -S'A reviewer inherits the main chat'\''s GPT Fast state when it s' -- DECISIONS.md`.
Archived by: docs-cleanup, 2026-10-23; the commit is `git log -S'A-0144' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 1228-1230 at `30952e6`, verbatim:

> - A reviewer inherits the main chat's GPT Fast state when it starts: rule, quotes and carrier in
>   [Settings](#settings), «GPT Fast» (`extensions/RQW-review/fast-gpt.ts`, `index.ts`); the optional `fast_gpt` of the
>   `review` tool overrides it for that reviewer.

## A-0145 · archived 2026-10-23 · Review · Measured v3 prompt as current base
Status: SUPERSEDED by `[D-REVIEW-DEEP]`, `[D-REVIEW-FORMAT]` ([DECISIONS.md, Review](DECISIONS.md#review)). Replaced by the deep reviewer prompt (a04a9c0); old GPT measurements stay in notes/reviewer-prompt-gpt.md.
Superseded: `a04a9c0`.
Introduced: `e76994a`, the oldest hit of `git log -S'Prompt adaptation is now tuned on GPT with the measured v3, ' -- DECISIONS.md`.
Archived by: docs-cleanup, 2026-10-23; the commit is `git log -S'A-0145' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 1231-1243 at `30952e6`, verbatim:

> - Prompt adaptation is now tuned on GPT with the measured v3, the base of
>   `extensions/RQW-review/REVIEWER.md`; the dispute paragraph and the DISPUTE, RULING and ANSWER fields were added on
>   top of it by the pair contract below and are not part of that measurement (request summary, not a literal quote: flexible reviewer conditions C:2913;
>   team synergy only in the plugin C:3046; finish the prompt on GPT C:3400). The criterion governs scope, including custom requirements outside the agreement and
>   exclusions; REQUIREMENT may quote the criterion with its source. Main and reviewer remain a pair through the
>   plugin's `DESCRIPTION` and `NEXT` in `index.ts`, not `SYSTEM.md`. The reviewer checks independently, quotes exact
>   file content and does not turn general test requests into invented coverage requirements. Reason: the measured
>   candidate improves scope/flexibility and quote/format handling with zero audited false findings on the final GPT
>   comparison; this is not a claim of universal recall improvement. Paired GPT-6.1 recall 87/90 -> 87/90, GPT-6
>   87/90 -> 86/90; GPT-6 false findings after audit 6 -> 0, final 0 on both; mean seconds 7.9 -> 9.2 and
>   10.8 -> 12.3. Only 12 cases x 3 runs per model, four GPT-held-out cases, no new Claude probes; details and limits
>   in `notes/reviewer-prompt-gpt.md`. These are earlier prompt measurements, not proof for the deep prompt/tool
>   combination above. Verdict handling stays unchanged; reviewer models are the family table below.

## A-0146 · archived 2026-10-23 · Review · One tool, two levels
Status: SUPERSEDED by `[D-REVIEW-TOOL]` ([DECISIONS.md, Review](DECISIONS.md#review)). Owner quotes not found in the Pi sessions; relabelled coordinator text.
Introduced: `3389347`, the oldest hit of ``git log -S'`extensions/RQW-review/` is the accepted reviewers plan (use' -- DECISIONS.md``.
Archived by: docs-cleanup, 2026-10-23; the commit is `git log -S'A-0146' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 1245-1248 at `30952e6`, verbatim:

> - `extensions/RQW-review/` is the accepted reviewers plan (user: «То, что ты предложил по ревьюерам — it's OK, я
>   принимаю»): one tool `review` with `level` `blind` or `high` (user: «Smart не нужен ... будет Blind и High»), held
>   to the existing contract and nothing more (user: «эти три саб-агента должны быть забиты за тем контрактом, который
>   есть, и всё»).

## A-0147 · archived 2026-10-23 · Review · Reviewer models by family
Status: SUPERSEDED by `[D-REVIEW-MODELS]` ([DECISIONS.md, Review](DECISIONS.md#review)). The "Claude high slot is being re-measured" sentence is dead (branch reviewer-haiku-high closed, no measurement running); probe numbers moved to notes/decisions-evidence.md#review-gpt-match.
Introduced: `3389347`, the oldest hit of ``git log -S' live in one table, `LEVELS` at the top of `i' -- DECISIONS.md``.
Archived by: docs-cleanup, 2026-10-23; the commit is `git log -S'A-0147' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 1249-1272 at `30952e6`, verbatim:

> - Models live in one table, `LEVELS` at the top of `index.ts`, by the family of the main agent's model (a one-line
>   change per model or thinking level). Claude main: `blind` is `anthropic/claude-haiku-5-5` with thinking medium,
>   `high` is `anthropic/claude-sonnet-5-5` with thinking low (the Claude `high` slot is being re-measured, Haiku
>   high and xhigh against Sonnet low, and may change; it is not changed here). GPT main: `blind` is
>   `openai-codex/gpt-5.6-luna` with thinking medium, `high` is `openai-codex/gpt-5.6-luna` with thinking high. The
>   family comes from `ctx.model` (provider `anthropic` or a `claude*` id: Claude; provider `openai` or `openai-codex`
>   or a `gpt-*` id: GPT); a main model of neither family, or none, starts with the Claude table. Owner (earlier,
>   replaced here): «Ревьюеры будут только на этих двух моделях». Owner, 2026-10-22, answering the coordinator's three
>   questions (model by family, unagreed additions, tolerant extraction) with: «2а 3а». The first question got no
>   answer, so its recommended option 1a applies: reviewer model by the main agent's family. Owner, 2026-10-22, on
>   the GPT row: «Давай тогда сделаем, что на blind review будет Luna Medium. На high review будет Luna High. Да»
>   (after «и потом будем думать» while more probes ran; the earlier placeholder, GPT-6.1-Sol low and medium, is
>   gone). Reason, from the gpt-match probes (`notes/reviewer-probes.md`, section "GPT match for the Claude slots"):
>   GPT-5.6-Luna medium matches Haiku 5.5 medium (recall 94.1% against 95.6%, 164 of 165 dispute items right for
>   both, 12.6 s and 0.0027 USD per pass against 14.4 s and 0.0022) and GPT-5.6-Luna high matches Sonnet 5.5 low
>   (recall 96.3% against 96.7%, 165 of 165 against 154 with the strict reply parse, 0.0043 USD against 0.0226, but
>   20.8 s against 6.7 s and 31 of 33 clean cases against 33); GPT-6-Luna is unusable. Limits: 17 false findings for
>   Luna high against 15 for Sonnet low, 10 for Luna medium against 1 for Haiku medium; one run set per cell, so
>   one- or two-item differences are noise. Fallback: when the family's reviewer has no model or its provider has no
>   credentials, the other family's reviewer of the same level is used; the failure `[review#N] Review failed:
>   <reason>` names both reasons when neither can start. A failed request or no verdict in 30 minutes gives
>   `Review failed: <reason>` with no automatic second attempt. `details` of the verdict carry the model that actually ran.
>   Also one login and rate limit per family. Proof: `extensions/RQW-review/test/review.test.ts` ("the family table",
>   "GPT main, blind", "GPT main, high", the two fallback tests and the two failure tests).

## A-0148 · archived 2026-10-23 · Review · Parameters
Status: SUPERSEDED by `[D-REVIEW-PARAMS]` ([DECISIONS.md, Review](DECISIONS.md#review)).
Introduced: `3389347`, the oldest hit of ``git log -S'Parameters: `level`, `object` (paths, the diff as a file pat' -- DECISIONS.md``.
Archived by: docs-cleanup, 2026-10-23; the commit is `git log -S'A-0148' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 1273-1277 at `30952e6`, verbatim:

> - Parameters: `level`, `object` (paths, the diff as a file path, the stage), `criterion`, optional `agreement`
>   (accepted proposals and decisions that are not in the user's own messages), optional `rebuttals` (see the
>   dispute rule below) and optional boolean `fast_gpt` (GPT Fast of this reviewer, see [Settings](#settings), «GPT Fast»).
>   The description is limited to 600 characters by its test: 500, and 100 for the one GPT Fast sentence. Empty strings and a
>   null or empty `rebuttals` and a null `fast_gpt` count as not given, since strict mode fills every field.

## A-0149 · archived 2026-10-23 · Review · Main and reviewer as a pair
Status: SUPERSEDED by `[D-REVIEW-PAIR]` ([DECISIONS.md, Review](DECISIONS.md#review)). Temporary source /tmp/review-pair.md dropped.
Introduced: `c4aaad4`, the oldest hit of `git log -S'The main agent and the reviewer work as a pair, one team for' -- DECISIONS.md`.
Archived by: docs-cleanup, 2026-10-23; the commit is `git log -S'A-0149' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 1278-1306 at `30952e6`, verbatim:

> - The main agent and the reviewer work as a pair, one team for the user's agreement (owner, 2026-10-09: «чтобы они
>   действовали в одной команде ... либо принимает правку, либо её отклоняет и пишет, почему»; 2026-10-20: «он с ним
>   действует в унисон, в паре ... их синергия должна идти в рамках плагина. Это не должно размазываться»). The reviewer
>   side is `REVIEWER.md` ("on Main's team"). The main side lives in three carriers of `index.ts`, each paid only where
>   it is needed:
>   - `DESCRIPTION` (every request while the plugin is on): who the reviewer is, "works with you as one team for the
>     user's agreement", and how to call it; the handling rules left it.
>   - the tool result, `startedText`: `review#N started. Keep working, but leave the reviewed files unchanged until its
>     verdict.`
>   - the verdict wrapper, `verdictMessage`: `[review#N]` first, the verdict verbatim, then one paragraph of `NEXT` by
>     kind. `clean` (the trimmed verdict is exactly `CLEAN` after a normal `stop`): passed, no further pass for confidence.
>     A `length`, `error`, `aborted` or other non-normal final stop is a failed review, never a pass.
>     `incomplete` (anything that is not exactly `CLEAN` and not a complete findings verdict: `CLEAN` with extra text,
>     prose before `CLEAN`, `FINDINGS:` with text on its header line, a `FINDING` block with a required field missing
>     or empty, any other text): resolve UNCHECKED or retry malformed output, never claim passed or treat it as
>     findings; it creates no finding id and answers no dispute. `findings` (the header is a line that is exactly
>     `FINDINGS:`, then at least one `FINDING n` block, every block with REQUIREMENT, MISMATCH, EVIDENCE and REQUIRED
>     OUTCOME filled; one structural check in `findingBlocks`, used by `kindOf` and `settle`): find each quote by searching; fix each new finding exactly to its REQUIRED OUTCOME and no further, unless
>     Main can prove the reviewer misunderstood, then rebut it once; without proof, fix it; but a finding that rests on a
>     value, rule or choice the user never gave is put to the user and not fixed with another choice of Main's own
>     (measured: [Reviewer probes](notes/reviewer-probes.md), variant n1); fix all the others in one batch, then
>     call `review` again with the same level, object and criterion and the new rebuttals, until CLEAN. `failed` (the
>     catch branch, not parsed text): the check has not passed and no self-check replaces it; retry once on the
>     unchanged object, then tell the user and wait. Between the verdict and `NEXT` the extension adds the finding ids
>     and the dispute outcomes of this verdict (dispute rule below).
>   Not `promptSnippet` or `promptGuidelines`: RQW-prompt sets `systemPromptOptions.customPrompt`, and Pi builds the
>   section where they go only without a custom prompt, so they would never reach the model while RQW-prompt is on.
>   Not `SYSTEM.md`: turning RQW-review off must remove the pair completely, and with the rules in the plugin it does.
>   Source: `/tmp/review-pair.md` section 3.

## A-0150 · archived 2026-10-23 · Review · Disputes: the three-message rule
Status: SUPERSEDED by `[D-REVIEW-DISPUTES]` ([DECISIONS.md, Review](DECISIONS.md#review)). Rule kept; current realpath containment is described in the active disputes entry; omp-session sources moved to notes/decisions-evidence.md#review-dispute-sources, probe details to #review-dispute-probes.
Correction note, 2026-10-23: replaced the obsolete BACKLOG.md REVIEW-CONTAINMENT pointer with `[D-REVIEW-DISPUTES]` in DECISIONS.md#review; the containment fix was delivered in `e1cca48`, so it is no longer open work.
Introduced: `30c633f`, the oldest hit of `git log -S'Disputes follow the three-message rule, enforced by the exte' -- DECISIONS.md`.
Archived by: docs-cleanup, 2026-10-23; the commit is `git log -S'A-0150' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 1307-1397 at `30952e6`, verbatim:

> - Disputes follow the three-message rule, enforced by the extension, not only by prompts. Owner, original task:
>   «Задача: доработать RQW-review так, чтобы main и reviewer работали в паре: main может опровергнуть находку по
>   существу ... 1. Main может отклонить находку даже с дословными цитатами, если у него есть доказательство, что
>   ревьюер понял неправильно: цитата из файла или из сообщения пользователя и объяснение. Без доказательства main
>   исправляет находку. 2. Опровержение main уходит в следующий проход review. 3. Ревьюер оценивает довод по существу:
>   если довод верный, снимает находку; если нет, повторяет её и отвечает, почему опровержение не подходит. 4. Следующий
>   проход видит весь спор по каждой находке, а не только последнюю причину отказа. 5. Правила пары остаются внутри
>   плагина (DESCRIPTION, NEXT, REVIEWER.md), а не в SYSTEM.md.» Owner, 2026-10-21: «У них цикла быть не должно.
>   Знаешь, тут даже не должно быть трёх кругов. Смотри, как должно быть: должно быть правило трёх сообщений. Ревьюер
>   даёт комментарий, main ему отвечает, и ревьюер либо соглашается, либо выступает против. И это конечное. Дальше main
>   с ним уже не спорит: он либо принимает его решение, либо идёт к пользователю, чтобы тот разрешил спор, конфликт. Вот
>   и всё.»; «Если у ревьюера железобетонные доказательства, то мейн должен принять. ... Если ревьюер выявил работу,
>   которая не была зафиксирована однозначным решением, то надо вопрос отдать этому пользователю, чтобы пользователь
>   разрешил спор. Всегда всё идёт на основании решения пользователя.»; «Да, и на каждом круге, конечно же, всегда у нас
>   новый, свежий ревьюер»; «Причем ему отдается инфа об отказе, возражения основного агента отдаются так, чтобы новый
>   ревьюер потом без проблем понял, о чем идет речь.» The rule, carried by `extensions/RQW-review/index.ts`
>   (`NEXT`, `DESCRIPTION`, schema, `findingBlocks`, `disputes`, `settle`, `refusals`, `buildBrief`) and `REVIEWER.md`:
>   - Ids: each finding of a parsed `FINDINGS:` verdict gets a stable id `<review number>.<position>`, such as `3.2`,
>     listed after the verdict (`Finding ids: FINDING 1 = 3.2.`). A finding the reviewer repeats with `DISPUTE: <id>`
>     keeps that id; the reviewer's `FINDING n` numbering is not the identity.
>   - Message 2: Main fixes a finding or rebuts it once in `rebuttals` (`finding`, `quote`, `source`, `explanation`).
>     The tool refuses the whole call, with no review started and no number taken, when a rebuttal names an unknown
>     finding, lacks a quote, source or explanation, has a quote that is not in its source (`user` for the user's
>     own messages of the branch only, not a compaction or branch summary, which may stay in the brief but are Main's
>     text; or a file under the session cwd; whitespace runs and one pair of surrounding quotation marks are ignored),
>     repeats a finding in one call, or rebuts a finding that already has a rebuttal or a final answer. The final
>     state check and the persisting of the accepted rebuttals run with no await between them, so of two parallel
>     calls that rebut the same finding exactly one is accepted. The refusal says what to do instead: fix it, ask the
>     user, or wait for the pending answer.
>   - Message 3: every review brief carries every dispute of the branch under `<disputes>`: the finding as written, its
>     id, Main's quote, source and explanation, and once answered the status and the reviewer's answer, so a fresh
>     reviewer understands it without earlier context. The first exact `CLEAN` or parsed `FINDINGS:` verdict of a review
>     whose brief carried a dispute open answers it: a finding the reviewer leaves out is withdrawn; a finding it repeats
>     with `DISPUTE: <id>` is upheld with `RULING: DECIDED` (a verbatim user or agreement quote settles it: Main fixes it)
>     or `RULING: UNDECIDED` (no unambiguous user decision: Main puts the dispute to the user and follows the decision),
>     plus a one-sentence `ANSWER`. A missing or invalid RULING counts as UNDECIDED, since nothing shows a user decision.
>     Failed, incomplete or malformed verdicts answer nothing; the dispute stays open for the next call. The outcome
>     lines (`NEXT.withdrawn`, `NEXT.decided`, `NEXT.undecided` with the ids) follow the verdict. CLEAN, incomplete and
>     failed classification is unchanged; only an exact `CLEAN` passes.
>   - An unagreed addition that Main defends ("useful") is `DECIDED`: the finding has REQUIREMENT `NOT AGREED`, the
>     reviewer repeats it with `RULING: DECIDED`, and Main removes the addition without asking the user. Owner,
>     2026-10-22: «2а 3а» (question 2, option a: the reviewer rules DECIDED and Main removes it without asking the owner;
>     the v2 behaviour). The `REVIEWER.md` wording therefore has no "or REQUIREMENT would be `NOT AGREED`" clause in the
>     UNDECIDED test, and carries an explicit exception, because the DECIDED condition (the user's own words quoted in
>     REQUIREMENT) cannot hold for REQUIREMENT `NOT AGREED`: "Exception to the two rulings and the test: an addition
>     the user never asked for (an extra feature, output, option or file) that Main defends only as useful or harmless
>     is a finding with REQUIREMENT `NOT AGREED` and RULING `DECIDED`; Main removes it without asking the user."
>     The measured v3h text had the clause (it made GPT-6.1-Sol rule UNDECIDED on that case); the adopted text, with
>     the exception sentence added after the probes, was not measured as a whole (`notes/reviewer-probes.md`, section
>     U12). Proof: `review.test.ts` (prompt hash pins and dispute-rule assertions).
>   - Verdict extraction tolerates prose before the verdict: when a reviewer reply does not start with `CLEAN` or
>     `FINDINGS:`, the verdict starts at the first line that is exactly `FINDINGS:` and the text before it is dropped
>     (`verdictOf` in `index.ts`, applied to the reviewer's last text before classification, so the delivered
>     message, the finding ids and the dispute answers all use the same text). Prose before `CLEAN` is not tolerated:
>     that reply stays `incomplete`. Owner, 2026-10-22: «2а 3а» (question 3, option a: tolerate prose before the first
>     line that is exactly `FINDINGS:`). Reason: Sonnet 5.5 wrote a one-line remark before `FINDINGS:` in 11 of 147 (low)
>     and 4 of 147 (medium) dispute passes with the adopted wording, which left the dispute open; the rescore with
>     tolerant extraction resolves all of them (`notes/reviewer-probes.md`, section "Sonnet's remark before
>     `FINDINGS:`"). Proof: `review.test.ts` ("prose before the first line that is exactly FINDINGS:", "verdictOf").
>   - What decides the outcome. A settled requirement with decisive evidence: Main fixes. A reviewer misreading: one
>     rebuttal with evidence, then the fresh reviewer decides. A finding that demands what the agreement does not ask
>     for, or changes a settled decision, is such a misreading: Main rebuts it with the agreement quote and the reviewer
>     withdraws it; it is not put to the user. A missing or ambiguous decision, or a choice Main made itself that differs
>     from what the user said, is `UNDECIDED` and goes to the user. Earlier owner sources: 2026-10-09
>     (`~/.omp/agent/sessions/-Documents-ChatGPT-my-omp-harness/2026-10-09T21-54-24-425Z_01a122a9-0429-72c6-a863-e5df03772564.jsonl:103`):
>     «Второй чувак не идёт слепо её править, а у него контекста больше, потому что он сам эту работу делал. И он видит,
>     перепроверяет своё решение, свою работу и либо принимает правку, либо её отклоняет и пишет, почему он её
>     отклоняет. И в итоге они приходят к консенсусу.»; the same file `:99`: «Ну, то есть если она меняет, а-а-а, как бы
>     согласованный план, то её отклоняют»; «То есть мы либо отклоняем правку, потому что она как бы нарушает, либо мы её
>     принимаем, и всё.»; 2026-10-14
>     (`~/.omp/agent/sessions/-Documents-ChatGPT-my-omp-harness/2026-10-12T15-30-39-654Z_01a130bc-c3a6-7101-b570-e995b9c08136.jsonl:3964`):
>     «Он должен согласовывать со мной только те места, которые однозначно являются неоднозначными. Там, где reviewer не
>     сможет провести нормальное review, не сможет подтвердить результат работы, потому что формулировка
>     неоднозначная. Или он согласовывает со мной решения, которые он придумал самостоятельно, которые отличаются от
>     того, что я ему сказал сделать.»; 2026-10-09
>     (`~/.omp/agent/sessions/--private-tmp--/2026-10-09T06-26-18-422Z_01a11f57-50b6-7042-9bc8-745d0f4b32ed.jsonl:344`):
>     «И если он чё-то реджектит, то он в следующем запуске присылает свои реджекты из прошлых прогонов. ... Там должны
>     работать в команде, а не быть друг у друга.» The former rule that a finding with verbatim quotes is mandatory and
>     never rejected was an agent proposal inside an approved plan, not the owner's words; the 2026-10-21 messages
>     replace it. The three-message limit has no earlier owner source; it comes from 2026-10-21.
>   - State: rebuttals are persisted with the review number entry (`{ n, rebuttals }`), findings and rulings with a
>     second entry of the same review (`{ n, findings, rulings }`), all `pi.appendEntry("review", ...)`; the state is
>     rebuilt from the current branch on every call and verdict, so it survives reload and resume.
>   Reason: the owner's three-message rule and user-decides rule; a fresh reviewer each pass stays as before. Proof:
>   `extensions/RQW-review/test/review.test.ts` suites "disputes: one finding, one rebuttal, one final answer" and "dispute mechanics" (faux providers; withdrawn
>   after a verbatim rebuttal, upheld DECIDED and UNDECIDED with the second rebuttal refused, refusals without proof,
>   fresh reviewer with the whole dispute, reload recovery after a failed and an incomplete review). Limits: a reviewer
>   that upholds a dispute without the DISPUTE field produces a new finding id, which Main could rebut once more; the
>   dispute wording in `REVIEWER.md` and `NEXT` was measured on models in the probe campaign
>   (`notes/reviewer-probes.md`: 8 reviewer configs x 49 dispute fixtures x 3 runs per wording; the main side on three
>   main configs, 43 fixtures x 3 runs per round), with the limits listed there.

## A-0151 · archived 2026-10-23 · Review · Completed GPT reviewer tuning
Status: MERGED into `[D-REVIEW-FORMAT]` ([DECISIONS.md, Review](DECISIONS.md#review)). Duplicate of the measured-prompt entry; its REQUIRED OUTCOME and criterion rule live in D-REVIEW-FORMAT.
Introduced: `e76994a`, the oldest hit of `git log -S'Reviewer-side tuning is complete on GPT: REQUIRED OUTCOME st' -- DECISIONS.md`.
Archived by: docs-cleanup, 2026-10-23; the commit is `git log -S'A-0151' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 1398-1399 at `30952e6`, verbatim:

> - Reviewer-side tuning is complete on GPT: REQUIRED OUTCOME states one concrete end state; the measured prompt
>   treats `<criterion>` as the scope alongside the real brief tags. Evidence and limits: `notes/reviewer-prompt-gpt.md`.

## A-0152 · archived 2026-10-23 · Review · Diff as a file path
Status: MERGED into `[D-REVIEW-PARAMS]` ([DECISIONS.md, Review](DECISIONS.md#review)).
Introduced: `3389347`, the oldest hit of `git log -S's in as a file path, not as a comma' -- DECISIONS.md`.
Archived by: docs-cleanup, 2026-10-23; the commit is `git log -S'A-0152' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 1400-1400 at `30952e6`, verbatim:

> - The diff goes in as a file path, not as a command, so the reviewer can read it whole alongside the named sources.

## A-0153 · archived 2026-10-23 · Review · Brief from the branch
Status: SUPERSEDED by `[D-REVIEW-BRIEF]` ([DECISIONS.md, Review](DECISIONS.md#review)).
Introduced: `3389347`, the oldest hit of ``git log -S'The extension builds the brief itself (`buildBrief`): the us' -- DECISIONS.md``.
Archived by: docs-cleanup, 2026-10-23; the commit is `git log -S'A-0153' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 1401-1404 at `30952e6`, verbatim:

> - The extension builds the brief itself (`buildBrief`): the user's messages of the current branch, verbatim, numbered
>   and in order, with compaction and branch summaries labeled as not the user's words, then `agreement`, `object`,
>   `criterion` and `<disputes>`. Reason: the main agent no longer retypes the user's words, the largest output cost of a
>   call, and the words cannot drift.

## A-0154 · archived 2026-10-23 · Review · Fresh reviewer session
Status: SUPERSEDED by `[D-REVIEW-SESSION]` ([DECISIONS.md, Review](DECISIONS.md#review)). "Sole inline extension" corrected: the factories also add codemode/tool_search and GPT Fast.
Introduced: `3389347`, the oldest hit of ``git log -S'Each call is a fresh session in the same process: `createAge' -- DECISIONS.md``.
Archived by: docs-cleanup, 2026-10-23; the commit is `git log -S'A-0154' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 1405-1413 at `30952e6`, verbatim:

> - Each call is a fresh session in the same process: `createAgentSession` with in-memory `SessionManager` and
>   `SettingsManager`, in the caller's `ctx.cwd`, retaining the caller's session settings (shell, images, retries and
>   provider timeouts, transport and its timeouts, compaction, thinking budgets, codemode; owner «2а», [Agent](#agent) parity entry;
>   `reviewerSettings` in `extensions/RQW-review/index.ts`). A general subagent of RQW-agent gets its own `review` tool
>   through the `pi.events` offer `rqw-review:subagent-review`; its verdicts go to that subagent, its brief is that
>   subagent's own messages, and its running reviews end with the subagent (RQW-review README, Review in subagents).
>   The resource loader loads no user extensions, skills, prompt templates, themes, context files or appended prompt;
>   its sole inline extension installs the bash guard. `REVIEWER.md` is the prompt for both levels. Pi still adds its
>   `<cwd>` block after the prompt, so relative paths in the brief resolve; nothing else is added.

## A-0155 · archived 2026-10-23 · Review · Reviewer tools
Status: SUPERSEDED by `[D-REVIEW-TOOLS]` ([DECISIONS.md, Review](DECISIONS.md#review)).
Introduced: `a04a9c0`, the oldest hit of ``git log -S', `grep`, `find`, no `edit` or `wri' -- DECISIONS.md``.
Archived by: docs-cleanup, 2026-10-23; the commit is `git log -S'A-0155' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 1414-1432 at `30952e6`, verbatim:

> - Reviewer tools are `read`, `bash`, `grep`, `find`, no `edit` or `write`, plus Pi's `codemode` and `tool_search` when
>   the caller (the main session or the subagent whose `review` it is) has them active ([Agent](#agent) parity entry),
>   plus RQW-tools' `job` when RQW-tools offers its definitions. Each session requests fresh RQW-tools definitions over
>   `pi.events` channel `rqw-tools:subagent-tools` using RQW-agent's `{ offer(factory) }` handshake (during the
>   reviewer's loader reload when it has codemode, otherwise right after it) and calls the offered factory with cwd, a
>   settings getter and options: `label` is `review` for the main session's reviewer and the caller's path plus
>   `/review` for a subagent's (`agent#1/review`); `codemode`, only when the reviewer has codemode, is Pi's definition
>   built from the reviewer's own API (it is then not registered as it is). Of the returned definitions it keeps those
>   four names, `job` and, when it passed one, the returned `codemode` (one call of the reviewer's barrier and a job of
>   its registry; a factory that returns none leaves the reviewer's own definition). Tools, «Background jobs»: a
>   reviewer call still running after 12 s goes to the background; Esc of the review aborts its jobs and the end of the
>   review, or of the subagent that asked for it, disposes them. No cross-extension import is added. Without an offer the
>   reviewer gets the four stock definitions (`reviewerTools`) and, when its caller has them active, `codemode` and
>   `tool_search` registered by Pi's own factories; nothing goes to the background. Both offered and stock grep/find use
>   the same `dropEmptyOptional` wrapper: `prepareArguments` drops optional arguments equal to the string `"null"`,
>   `"undefined"` or blank, then chains the definition's existing `prepareArguments` before Pi validates them.
>   Execute and the other definition fields stay unchanged. Reason: grep otherwise passes `--glob null` to rg and
>   answers "No matches found", a silent false negative; RQW-tools has no such normalizer of its own. A real JSON
>   `null` Pi already strips. Proof: `extensions/RQW-review/test/review.test.ts`, stock and offered search paths.

## A-0156 · archived 2026-10-23 · Review · Reviewer git guard
Status: SUPERSEDED by `[D-REVIEW-GITGUARD]` ([DECISIONS.md, Review](DECISIONS.md#review)).
Introduced: `a04a9c0`, the oldest hit of ``git log -S'`extensions/RQW-review/git-guard.ts` is a verbatim self-cont' -- DECISIONS.md``.
Archived by: docs-cleanup, 2026-10-23; the commit is `git log -S'A-0156' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 1433-1441 at `30952e6`, verbatim:

> - `extensions/RQW-review/git-guard.ts` is a verbatim self-contained copy of `extensions/RQW-agent/git-guard.ts`.
>   The root `test/copies.test.ts` asserts byte equality to prevent drift, reading both files without importing
>   either extension; each extension's own tests still load only that extension.
>   Every child bash `tool_call` checks `blockedGit`, for offered and stock tools alike, returning its reason as the
>   tool error when blocked. Reason: prevent state-changing git commands while permitting supported read queries.
>   Limit: this shell-syntax guard is not a sandbox; it does not interpret scripts, aliases or computed command names.
>   No file edits through bash and never running the delivered result are prompt rules, not runtime enforcement.
>   For ordinary code the reviewer may run repository tests; for autotest work it must not run the autotests that
>   are the deliverable. Tests may have filesystem side effects. Carriers: `index.ts`, `git-guard.ts`, `REVIEWER.md`.

## A-0157 · archived 2026-10-23 · Review · Session model runtime
Status: SUPERSEDED by `[D-REVIEW-RUNTIME]` ([DECISIONS.md, Review](DECISIONS.md#review)). pi-claude-auth example replaced by RQW-anthropic.
Introduced: `3389347`, the oldest hit of ``git log -S'The reviewer uses the session'\''s own model runtime, `ctx.mode' -- DECISIONS.md``.
Archived by: docs-cleanup, 2026-10-23; the commit is `git log -S'A-0157' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 1442-1444 at `30952e6`, verbatim:

> - The reviewer uses the session's own model runtime, `ctx.modelRegistry.runtime`, private to TypeScript only.
>   Reason: providers and logins that the user's extensions register reach the reviewer (here `pi-claude-auth`
>   registers the `anthropic` provider), and no second runtime refreshes the same OAuth login.

## A-0158 · archived 2026-10-23 · Review · Verdict format
Status: SUPERSEDED by `[D-REVIEW-FORMAT]` ([DECISIONS.md, Review](DECISIONS.md#review)).
Introduced: `e76994a`, the oldest hit of `git log -S'aptation of the Spotty body. Pi'\''s read has no line numbers; ' -- DECISIONS.md`.
Archived by: docs-cleanup, 2026-10-23; the commit is `git log -S'A-0158' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 1445-1449 at `30952e6`, verbatim:

> - `REVIEWER.md` carries the supplied deep adaptation of the Spotty body. Pi's read has no line numbers; named
>   paths are read whole and truncated files resume at the reported offset. The final answer is the last message,
>   not `yield`. The verdict format stays `CLEAN`, or `FINDINGS:` with numbered `FINDING n` blocks (REQUIREMENT,
>   MISMATCH, EVIDENCE, REQUIRED OUTCOME; DISPUTE, RULING and ANSWER only on a repeated disputed finding), and an
>   optional `UNCHECKED:` section.

## A-0159 · archived 2026-10-23 · Review · Async verdicts
Status: SUPERSEDED by `[D-REVIEW-ASYNC]` ([DECISIONS.md, Review](DECISIONS.md#review)).
Introduced: `3389347`, the oldest hit of ``git log -S' the call returns `review#N started' -- DECISIONS.md``.
Archived by: docs-cleanup, 2026-10-23; the commit is `git log -S'A-0159' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 1450-1457 at `30952e6`, verbatim:

> - Async: the call returns `review#N started. ...` at once. The verdict, the reviewer's last assistant text, arrives as
>   `pi.sendMessage({ customType: "review", content: "[review#N] <verdict>\n\n<next step>", display: true }, ...)`; `details` carry
>   `n`, level, model, thinking and seconds for the user and logs only. Numbers count per session and go on after a
>   resume. Every issued number is immediately persisted with `pi.appendEntry("review", { n })`, a custom entry,
>   not an LLM message, before any asynchronous work. Recovery also accepts old direct review tool results and verdicts,
>   but does not scan arbitrary tool text. This covers nested `ctx.executeTool` callers without a direct tool result.
>   If an SDK reload emits no `session_start`, the first execution restores the context and counter from history.
>   `session_shutdown` aborts every running review and delivers nothing; the 30-minute timer does not keep the process alive.

## A-0160 · archived 2026-10-23 · Review · Exactly-once delivery
Status: SUPERSEDED by `[D-REVIEW-DELIVERY]` ([DECISIONS.md, Review](DECISIONS.md#review)).
Introduced: `ca6e2dd`, the oldest hit of `git log -S'Delivery: a verdict never waits in the agent'\''s queue and get' -- DECISIONS.md`.
Archived by: docs-cleanup, 2026-10-23; the commit is `git log -S'A-0160' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 1458-1478 at `30952e6`, verbatim:

> - Delivery: a verdict never waits in the agent's queue and gets exactly one main turn unless the run was aborted
>   (review findings: in print and json mode Pi disposed the session when the main run settled and the verdict never
>   came; a follow-up waited in the agent's queue, which TUI Esc and RPC `clear_queue` clear and an RPC abort or an
>   error-ended run leaves without a turn; a verdict that came in while another extension's slow `agent_before_settle`
>   handler ran after ours got no turn).
>   The `session_start` context is kept. When `ctx.isIdle()`, the verdict goes with `triggerTurn: true, deliverAs:
>   "followUp"` and starts a turn, unless the last main run was aborted. When busy, it goes with `triggerTurn: false`:
>   Pi appends it to the session at the
>   end of the current turn or run, aborted or not, and the `agent_before_settle` handler returns `continue: true`
>   while the verdict is not yet followed by an assistant message in the branch. Each review sends one verdict, so its
>   number `n` in `details` is the delivery number. When that handler returns without `continue`, a `settling` flag is
>   set until `turn_start` or `agent_settled`; verdicts that arrive meanwhile wait in a `late` list, and the
>   `agent_settled` handler sends them, all but the last with `triggerTurn: false` and the last with
>   `triggerTurn: !event.aborted`, so several get one turn. `mainAborted` latches `agent_settled.aborted` until a new
>   `agent_start`, but suppresses delivery turns only while `ctx.isIdle()` is true. A new busy run uses the ordinary
>   unanswered-verdict path even while an earlier extension holds `agent_start` or `before_agent_start`, before our
>   latch reset. If that current run is aborted, native `agent_settled.aborted` still prevents an automatic extra turn.
>   A verdict finishing after Esc or RPC abort while idle is saved once without starting Main, and the next prompt
>   carries it once. In print and json mode `agent_end` waits for jobs using its active `ctx.signal`; abort
>   interrupts only that wait, not the independent reviewer. `agent_before_settle` only decides continuation and marks
>   settlement; Pi 1.4.0 has no active `ctx.signal` there. Normal verdicts still continue the same run before Pi exits.

## A-0161 · archived 2026-10-23 · Review · Auth fallback
Status: SUPERSEDED by `[D-REVIEW-AUTH]` ([DECISIONS.md, Review](DECISIONS.md#review)).
Introduced: `ca6e2dd`, the oldest hit of `git log -S'Credentials: a review fails with "no credentials" only when ' -- DECISIONS.md`.
Archived by: docs-cleanup, 2026-10-23; the commit is `git log -S'A-0161' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 1479-1481 at `30952e6`, verbatim:

> - Credentials: a review fails with "no credentials" only when both `ctx.modelRegistry.hasConfiguredAuth(model)` and
>   `await runtime.checkAuth(provider, { signal })` say so, as in Pi's own prompt. Reason: the auth snapshot behind
>   `hasConfiguredAuth` is filled asynchronously, so right after startup or a reload it can miss credentials that exist.

## A-0162 · archived 2026-10-23 · Review · Whole-job cancellation
Status: SUPERSEDED by `[D-REVIEW-CANCEL]` ([DECISIONS.md, Review](DECISIONS.md#review)).
Introduced: `b4b23cf`, the oldest hit of `git log -S'Cancellation bounds the whole review job, including auth, se' -- DECISIONS.md`.
Archived by: docs-cleanup, 2026-10-23; the commit is `git log -S'A-0162' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 1482-1488 at `30952e6`, verbatim:

> - Cancellation bounds the whole review job, including auth, session creation and prompt preflight (owner: "deadline boundsWHOLEjobinclcheckAuth/create/promptpreflight").
>   `untilAborted` races each asynchronous stage, observes late rejection and removes its abort listener. Auth receives
>   the signal, late-created sessions are disposed without prompting, and prompt cancellation aborts and disposes its
>   session without awaiting an uncooperative provider. Pi 1.4.0's own prompt auth await has no signal; the reviewer's
>   public `agent.streamFunction` checks the job signal before calling the SDK stream function, so even a preflight
>   resuming after disposal cannot make a model request. The underlying unabortable promise may remain pending until
>   its implementation settles; it cannot hold the job, deliver a second verdict or escape the request guard.

## A-0163 · archived 2026-10-23 · Review · Deterministic regression coverage
Status: SUPERSEDED by `[D-REVIEW-TESTS]` ([DECISIONS.md, Review](DECISIONS.md#review)).
Introduced: `b4b23cf`, the oldest hit of ``git log -S'Runtime regression evidence: `extensions/RQW-review/test/rev' -- DECISIONS.md``.
Archived by: docs-cleanup, 2026-10-23; the commit is `git log -S'A-0163' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 1489-1493 at `30952e6`, verbatim:

> - Runtime regression evidence: `extensions/RQW-review/test/review.test.ts` converts all five audit reproductions to
>   required outcomes, including post-abort delivery in all four modes, multiple verdicts, nested reload and legacy IDs,
>   ignored auth/provider cancellation and native prompt-preflight resolve/reject after timeout or shutdown. `test/cli.test.ts` runs real CLI
>   print/json subprocesses on Node by default and on Bun with `PI_REVIEW_TEST_RUNTIME=bun`; both use `test/cli-faux.ts` and the self-contained `test/offline.mjs` network tripwire; no live
>   model or credentials are used. These deterministic tests establish runtime behavior, not model review quality.

## A-0164 · archived 2026-10-23 · Review · Historical live smoke timings
Status: OBSOLETE; nearest active entry `[D-REVIEW-TESTS]` ([DECISIONS.md, Review](DECISIONS.md#review)). One-off live smoke ledger with no saved raw log; deterministic parts kept in D-REVIEW-TESTS; timings in notes/decisions-evidence.md#review-live-smoke.
Introduced: `3389347`, the oldest hit of ``git log -S'Proof: `extensions/RQW-review/test/review.test.ts` (real ses' -- DECISIONS.md``.
Archived by: docs-cleanup, 2026-10-23; the commit is `git log -S'A-0164' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 1494-1509 at `30952e6`, verbatim:

> - Proof: `extensions/RQW-review/test/review.test.ts` (real sessions, faux providers for the main and the reviewer
>   models) and one real run per level: a temp copy of a fixture with `calc.py` (`add` returns `a - b` instead of the
>   sum) and a correct `config.py` (`MAX_ITEMS = 50`), command
>   `pi -e /tmp/my-pi-review --mode json --model anthropic/claude-opus-5-5 --thinking low -p "<prompt>"`, the prompt
>   quoting the request and asking to call `review` and then `sleep 150`. Both verdicts named the defect and nothing
>   else and started a main turn: `blind` in 8.7 s (`EVIDENCE: "return a - b"`), `high` in 3.8 s. After the delivery
>   fixes, tests for print and json mode (the run waits and continues with the verdict), a verdict arriving while the
>   main agent streams (continues its run once), TUI Esc and RPC abort (the verdict is in the session once, no run
>   starts, the next prompt carries it once), two verdicts that arrive while a slow second extension
>   (`test/slow-settle.ts`, loaded after RQW-review) holds `agent_before_settle` (one main turn for both), and grep and
>   find with `"null"`, `"undefined"` and blank arguments through Pi's validation and inside a reviewer session.
>   Without the `agent_before_settle` handler, the busy-time delivery, the `settling` flag or `reviewerTools`, these
>   tests fail. Every test passes when run alone, which needs the `checkAuth` fallback. Live run in json mode with no
>   `sleep`: Haiku 5.5 as the main model replied `started`, the run waited, `[review#1] FINDINGS: ... EVIDENCE:
>   "return a - b"` arrived after 5.1 s and the main agent answered it in the same run (`GOT VERDICT: ... returns
>   a - b instead of the sum`), exit 0 in 13 s.

## A-0165 · archived 2026-10-23 · Review · Known limits
Status: SUPERSEDED by `[D-REVIEW-LIMITS]` ([DECISIONS.md, Review](DECISIONS.md#review)). The Haiku MISMATCH smoke observation is dead (predates the deep prompt, no fixture); grep null glob is BACKLOG.md GREP-NULL.
Introduced: `3389347`, the oldest hit of ``git log -S'Open: `ctx.modelRegistry.runtime` may be renamed by a Pi upd' -- DECISIONS.md``.
Archived by: docs-cleanup, 2026-10-23; the commit is `git log -S'A-0165' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 1510-1515 at `30952e6`, verbatim:

> - Open: `ctx.modelRegistry.runtime` may be renamed by a Pi update, then every review fails with "the model runtime of
>   the session is not reachable"; a verdict that finishes after the session ended (quit, `/new`, `/resume`, reload)
>   is dropped, since `session_shutdown` aborts running reviews; in print and json mode the run waits up to 30 minutes
>   for a slow review; a verdict that arrives during a manual `/compact` with no run is appended without a turn and is
>   seen on the next one; the reviewer may read a file the main agent is still editing; the main agent's own RQW-tools
>   grep still passes a string `"null"` glob to rg; in one smoke run Haiku wrote a MISMATCH of more than 20 words.

## A-0166 · archived 2026-10-23 · PCLI · Separate VS Code extension
Status: SUPERSEDED by `[D-PCLI-EXT]` ([DECISIONS.md, PCLI](DECISIONS.md#pcli)). Owner quote not found in the Pi sessions; relabelled coordinator text.
Introduced: `3b6d6c1`, the oldest hit of ``git log -S'`pcli-vscode/` is a VS Code extension `arqawa.pcli` ("ARQAWA' -- DECISIONS.md``.
Archived by: docs-cleanup, 2026-10-23; the commit is `git log -S'A-0166' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 1519-1522 at `30952e6`, verbatim:

> - `pcli-vscode/` is a VS Code extension `arqawa.pcli` ("ARQAWA PCLI", win32-x64) that starts Pi like CCLI starts Codex
>   (user: «надо сделать extension, как Arkava CLI, такой же, только PCLI... учитывая все требования, все ограничения»).
>   It is outside `extensions/`, has no `RQW-` prefix and is not in `pi.extensions`: it is not a Pi extension. Carried by
>   `pcli-vscode/package.json`, `AGENTS.md`.

## A-0167 · archived 2026-10-23 · PCLI · Inside VS Code only
Status: SUPERSEDED by `[D-PCLI-VDI]` ([DECISIONS.md, PCLI](DECISIONS.md#pcli)). Owner quote not found in the Pi sessions; relabelled coordinator text.
Introduced: `3b6d6c1`, the oldest hit of `git log -S'VDI constraint: everything runs inside VS Code as a subproce' -- DECISIONS.md`.
Archived by: docs-cleanup, 2026-10-23; the commit is `git log -S'A-0167' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 1523-1525 at `30952e6`, verbatim:

> - VDI constraint: everything runs inside VS Code as a subprocess of the extension host (user: «у нас нет админских прав,
>   у нас нет wsl, и нам нельзя запускать ничего такого прямо на хосте, только внутри vs code, только как extension vs
>   code, как субпроцесс extension VS code. только так»). Carried by `pcli-vscode/extension.js`.

## A-0168 · archived 2026-10-23 · PCLI · Pinned bundled Pi
Status: SUPERSEDED by `[D-PCLI-PIN]` ([DECISIONS.md, PCLI](DECISIONS.md#pcli)). VSIX size, run link and embedded Bun moved to notes/decisions-evidence.md#pcli-bundle.
Introduced: `3b6d6c1`, the oldest hit of `git log -S', no update at runtime (user: «мы не будем ав' -- DECISIONS.md`.
Archived by: docs-cleanup, 2026-10-23; the commit is `git log -S'A-0168' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 1526-1533 at `30952e6`, verbatim:

> - Pi is pinned to 1.4.0 and bundled in the VSIX (44.06 MB, [run](https://github.com/ARQAWA/my-pi/actions/runs/39824069227), job `e2e`), no update at runtime (user: «мы не будем автоматически
>   обновлять PCLai. Как есть 1.3 версия, так и есть.»; «1 да давай 2 да давай»; the pin moved from 1.3.0 to 1.4.0 with
>   the package upgrade, [Scope](#scope), not by an update of an installed PCLI). `vscode:prepublish` runs
>   `pcli-vscode/fetch-pi.mjs`: it downloads `pi-windows-x64.zip` of the release `earendil-works/pi` v1.4.0, checks the
>   hard-coded SHA256 (`0f7256ea8bdac3af20012b94fdc1252a31cc6dc0d2f9b9eb539555d22e3e321b`, equal to the release's
>   `SHA256SUMS` line and to the downloaded archive) and extracts it into `pcli-vscode/pi/` (git-ignored). A new Pi
>   version means new VERSION, URL and SHA256 there and a new VSIX. Bumping the root npm dependency does not change the
>   bundled `pi.exe`. The `pi.exe` of 1.4.0 still embeds Bun 1.3.14 (read from the binary).

## A-0169 · archived 2026-10-23 · PCLI · Release binary, not npm
Status: SUPERSEDED by `[D-PCLI-BINARY]` ([DECISIONS.md, PCLI](DECISIONS.md#pcli)).
Introduced: `3b6d6c1`, the oldest hit of `git log -S'Release binary, not npm: Pi from npm is a Node program and w' -- DECISIONS.md`.
Archived by: docs-cleanup, 2026-10-23; the commit is `git log -S'A-0169' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 1534-1537 at `30952e6`, verbatim:

> - Release binary, not npm: Pi from npm is a Node program and would run inside `Code.exe` with `ELECTRON_RUN_AS_NODE=1`,
>   which leaks into every bash command Pi runs and depends on the Node version of VS Code. `pi.exe` carries its own
>   runtime; the same path (Bun exe from a GitHub release) already works on the VDI in omp-vscode. Carried by
>   `pcli-vscode/fetch-pi.mjs`.

## A-0170 · archived 2026-10-23 · PCLI · Launch chain and proxy
Status: SUPERSEDED by `[D-PCLI-LAUNCH]` ([DECISIONS.md, PCLI](DECISIONS.md#pcli)).
Introduced: `3b6d6c1`, the oldest hit of ``git log -S'Launch chain: extension host -> `powershell.exe` -> Git Bash' -- DECISIONS.md``.
Archived by: docs-cleanup, 2026-10-23; the commit is `git log -S'A-0170' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 1538-1543 at `30952e6`, verbatim:

> - Launch chain: extension host -> `powershell.exe` -> Git Bash (`C:\Program Files\Git\bin\bash.exe --login -i -c`) ->
>   `pi.exe`, terminal through VS Code's own `node-pty`. The proxy comes from the `Code.exe` environment and the settings
>   `http.proxy` / `http.proxyStrictSSL` (the latter sets `NODE_TLS_REJECT_UNAUTHORIZED=0`) and is also exported in the
>   Git Bash command line, so profile scripts cannot override it; before the exports that line unsets `http_proxy`,
>   `https_proxy`, `all_proxy` and `no_proxy`, because Pi prefers the lowercase names. `~/.pi/agent` (settings, login, sessions) is shared and
>   not changed. Carried by `pcli-vscode/extension.js`.

## A-0171 · archived 2026-10-23 · PCLI · No version check
Status: SUPERSEDED by `[D-PCLI-NOVERSION]` ([DECISIONS.md, PCLI](DECISIONS.md#pcli)).
Introduced: `3b6d6c1`, the oldest hit of ``git log -S'The tab sets `PI_SKIP_VERSION_CHECK=1`: the version is pinne' -- DECISIONS.md``.
Archived by: docs-cleanup, 2026-10-23; the commit is `git log -S'A-0171' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 1544-1545 at `30952e6`, verbatim:

> - The tab sets `PI_SKIP_VERSION_CHECK=1`: the version is pinned, Pi must not ask for a newer one (user: «1 да давай 2
>   да давай»). Carried by `pcli-vscode/extension.js`.

## A-0172 · archived 2026-10-23 · PCLI · One command
Status: SUPERSEDED by `[D-PCLI-COMMAND]` ([DECISIONS.md, PCLI](DECISIONS.md#pcli)).
Introduced: `3b6d6c1`, the oldest hit of ``git log -S'One command, `Pi CLI: New Tab`; login is `/login` inside Pi.' -- DECISIONS.md``.
Archived by: docs-cleanup, 2026-10-23; the commit is `git log -S'A-0172' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 1546-1547 at `30952e6`, verbatim:

> - One command, `Pi CLI: New Tab`; login is `/login` inside Pi. my-pi itself is installed into that Pi with `INSTALL.md`
>   as before; the extension does not install it. Carried by `pcli-vscode/package.json`.

## A-0173 · archived 2026-10-23 · PCLI · No Marketplace description
Status: SUPERSEDED by `[D-PCLI-NODESC]` ([DECISIONS.md, PCLI](DECISIONS.md#pcli)).
Introduced: `3b6d6c1`, the oldest hit of ``git log -S'No Marketplace description: no `description` field in `pcli-' -- DECISIONS.md``.
Archived by: docs-cleanup, 2026-10-23; the commit is `git log -S'A-0173' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 1548-1549 at `30952e6`, verbatim:

> - No Marketplace description: no `description` field in `pcli-vscode/package.json`, no README, no LICENSE (user: «При
>   публикации в маркетплейс там НЕ ДОЛЖНО БЫТЬ НИКАКОГО ОПИСАНИЯ»).

## A-0174 · archived 2026-10-23 · PCLI · End-to-end proof
Status: SUPERSEDED by `[D-PCLI-E2E]` ([DECISIONS.md, PCLI](DECISIONS.md#pcli)).
Introduced: `3b6d6c1`, the oldest hit of ``git log -S'Proof: `.github/workflows/pcli.yml` on `windows-latest` buil' -- DECISIONS.md``.
Archived by: docs-cleanup, 2026-10-23; the commit is `git log -S'A-0174' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 1550-1555 at `30952e6`, verbatim:

> - Proof: `.github/workflows/pcli.yml` on `windows-latest` builds the VSIX, installs it into a real VS Code and runs
>   `pcli-vscode/test/run.mjs` and `test/suite.cjs`: a local proxy `test/proxy.cjs` with a fake model, Pi answers through
>   it, in two scenarios (proxy from the environment with a hostile Git Bash profile, proxy from VS Code settings). The
>   fake model is HTTPS with a self-signed certificate: strict TLS fails, `http.proxyStrictSSL: false` works. It also
>   checks CONNECT to GitHub with proxy credentials, paths with Cyrillic, spaces and an apostrophe, and no `pi.exe`
>   left after closing tabs, `/quit` or VS Code itself. Not covered: a real model call and the corporate VDI restrictions.

## A-0175 · archived 2026-10-23 · PCLI · Wheel scroll cause
Status: SUPERSEDED by `[D-PCLI-MOUSE-CAUSE]` ([DECISIONS.md, PCLI](DECISIONS.md#pcli)). Pi source offsets and upstream issue/PR history moved to notes/decisions-evidence.md#pcli-mouse-sources.
Introduced: `8f6251a`, the oldest hit of `git log -S'Wheel scroll on the VDI. In PCLI the wheel scrolled the inpu' -- DECISIONS.md`.
Archived by: docs-cleanup, 2026-10-23; the commit is `git log -S'A-0175' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 1556-1572 at `30952e6`, verbatim:

> - Wheel scroll on the VDI. In PCLI the wheel scrolled the input editor's past messages instead of the conversation;
>   the owner's Codex in CCLI scrolled normally. Owner (`2026-10-21T12-13-54-289Z_01a15e61-dcf1-7476-b1d6-42f03584b9e6.jsonl`
>   line 158): «Еще знаешь, какая проблема? У нас есть наш PCLI для Windows VDI тачки. Там такая проблема, что не
>   работает скроллинг. Когда я пытаюсь скроллить в терминале, у меня прокручиваются последние сообщения вместо того,
>   чтобы скроллился чат. А когда я запустил коды в CLI своим extension, там скролл нормально работает. Посмотри эту
>   проблему, пожалуйста.»
>   Cause, read from the Pi 1.4.0 sources: `TuiBase.start()` (`pi-tui/dist/tui.js:591-597`) calls `beforeTerminalStart`,
>   then `terminal.start`, then `afterTerminalStart`. `TuiAltScreen.beforeTerminalStart` (`tui-alt-screen.js:158-195`)
>   writes `?1049h` and the mouse enable `?1000h ?1002h ?1003h ?1004h ?1006h` (without `?1003h` in tmux, Zellij and
>   screen: `TMUX`, `ZELLIJ`, `STY` set, or `TERM` starting with `tmux` or `screen`), before `terminal.start` turns on raw
>   mode and `enableWindowsVTInput` (`terminal.js:117-138`). ConPTY loses what is written that early, VS Code's terminal
>   never learns that the app wants the mouse, and the wheel in the alternate screen becomes arrow keys, which move
>   through the editor's input history. `TuiAltScreen` has no `afterTerminalStart` of its own, and the same start path
>   runs again after the external editor, a TUI mode switch and suspend/resume. Upstream: issue earendil-works/pi#9656
>   (its workaround sends the mouse commands again after the terminal started, and only them: moving `?1049h` breaks
>   the Kitty keyboard protocol); PRs 9655 and 10560 were closed unmerged; related 11205, 11172, 8913. The loss of the
>   commands is measured (Proof below); the wheel-to-arrows step on the owner's VDI is not reproduced here.

## A-0176 · archived 2026-10-23 · PCLI · Wheel fix
Status: SUPERSEDED by `[D-PCLI-MOUSE-FIX]` ([DECISIONS.md, PCLI](DECISIONS.md#pcli)).
Introduced: `8f6251a`, the oldest hit of `git log -S'The fix is a my-pi extension and matters only where my-pi is' -- DECISIONS.md`.
Archived by: docs-cleanup, 2026-10-23; the commit is `git log -S'A-0176' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 1573-1589 at `30952e6`, verbatim:

> - The fix is a my-pi extension and matters only where my-pi is installed in PCLI's Pi. Owner
>   (`2026-10-21T16-27-59-062Z_01a15f4a-7ad5-7377-81be-0baf3b6ffa33.jsonl`):
>   «Теперь по нестабильному тесту 1А: myIP на VDI, исправление прокрутки делаю расширением myIP. Да, насчёт myIP в VDI: это только если myIP установлен. Если он не установлен, то поебать вообще.»
>   Here "myIP" is the speech-to-text spelling of my-pi. Engineering choice within that decision: only on Windows
>   and only in fullscreen, enable the mouse again after the terminal started and after every restart of the TUI, with exactly Pi's set,
>   multiplexer variant included, and keep Pi's disable on stop. Carrier: `extensions/RQW-mouse/index.ts`, its own
>   extension in `package.json` `pi.extensions`, switched off alone like every `RQW-*` extension
>   ([Isolation](#isolation)). A new folder because the behaviour belongs to no existing extension, and PCLI only
>   launches a stock Pi binary and does not install my-pi (see above). On `process.platform === "win32"` the factory wraps
>   `TuiAltScreen.prototype.afterTerminalStart`, stock Pi's empty hook; after Pi's own hook the wrapper writes Pi's set,
>   chosen by the same environment test, when the renderer has the mouse enabled (`mouseEnabled`). Pi's early write
>   and `?1049h` stay where they are, `beforeTerminalStop` still disables the mouse, and regular mode (`TuiMainScreen`)
>   and the print, JSON and RPC modes never use the class. The patch is process-wide: each factory run adds an owner
>   token to the `Set` under `Symbol.for("rqw-mouse/state")` on `globalThis`, its `session_shutdown` removes only that
>   token, and when the last owner leaves the prototype is exactly as Pi made it (a wrapper someone else put on top stays
>   and is inert). Pi emits `session_shutdown` before it loads the next runtime's extensions, so `/reload`, `/new` and
>   `/resume` renew the patch; switching the extension off and reloading removes it.

## A-0177 · archived 2026-10-23 · PCLI · Wheel fix limits
Status: SUPERSEDED by `[D-PCLI-MOUSE-LIMITS]` ([DECISIONS.md, PCLI](DECISIONS.md#pcli)). "The owner's manual check" removed: the owner dropped that task; now "not verified".
Introduced: `8f6251a`, the oldest hit of `git log -S'Limits of the wheel fix. It acts when Pi'\''s terminal starts, ' -- DECISIONS.md`.
Archived by: docs-cleanup, 2026-10-23; the commit is `git log -S'A-0177' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 1590-1594 at `30952e6`, verbatim:

> - Limits of the wheel fix. It acts when Pi's terminal starts, so after installing or updating my-pi Pi must be
>   restarted: a `/reload` does not restart the TUI. my-pi must be installed in the Pi that PCLI runs (`INSTALL.md`; PCLI
>   does not install it). It brings the mouse commands to VS Code; the VDI's own wheel handling is the owner's manual
>   check. Pi stays pinned at 1.4.0: the extension throws a load error when `TuiAltScreen.beforeTerminalStart` or the
>   base `afterTerminalStart` hook is missing, and its test compares the set with what Pi's own `TuiAltScreen` writes.

## A-0178 · archived 2026-10-23 · PCLI · Wheel fix proof
Status: SUPERSEDED by `[D-PCLI-MOUSE-PROOF]` ([DECISIONS.md, PCLI](DECISIONS.md#pcli)). Measured capture (VS Code version, byte counts, run link) moved to notes/decisions-evidence.md#pcli-mouse-capture.
Introduced: `8f6251a`, the oldest hit of ``git log -S'Proof of the wheel fix. `extensions/RQW-mouse/test/mouse.tes' -- DECISIONS.md``.
Archived by: docs-cleanup, 2026-10-23; the commit is `git log -S'A-0178' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 1595-1610 at `30952e6`, verbatim:

> - Proof of the wheel fix. `extensions/RQW-mouse/test/mouse.test.ts` (in `npm test`, the same cases on the Mac and in
>   the Windows CI): Pi's real `TuiAltScreen` on a terminal that records every write and the moment of `terminal.start`,
>   Windows simulated through `process.platform` where the test runs elsewhere. The write right after `terminal.start`
>   equals the set Pi wrote before it, for a plain terminal and for each multiplexer variant; it repeats after every
>   restart; Pi's disable runs on every stop; nothing is added with the mouse off, in regular mode, on macOS and Linux;
>   owner counting in either shutdown order, `/reload`, a hook Pi itself defines on the class and a wrapper put on top;
>   loading through Pi's resource loader and extension runner, with the jiti-loaded file getting the same `TuiAltScreen`
>   class as Pi's TUI. A model of ConPTY that drops writes before `start` gives 0 and 1; it is a model, the measurement
>   follows. `test/isolation.test.ts` covers the extension through the manifest. Capture: job `mouse` of
>   `.github/workflows/pcli.yml` (`workflow_dispatch`, or a push to branch `pcli`) runs `pcli-vscode/test/mouse.mjs`,
>   which drives `pcli-vscode/test/mouse-suite.cjs` in a real VS Code: VS Code's own node-pty starts the PCLI chain
>   (PowerShell, Git Bash, the bundled Bun-build `pi.exe` 1.4.0) twice, stock and with `-e extensions/RQW-mouse/index.ts`,
>   and counts `?1000h` in the pseudo terminal's output once Pi is in the alternate screen. Measured on `windows-latest`
>   with VS Code 1.143.0 and Pi 1.4.0 ([run](https://github.com/ARQAWA/my-pi/actions/runs/39824069227), job `mouse`):
>   0 times stock, 1 time with the extension, `?1049h` once in both, the set arriving after `?2004h` (2013 bytes with the
>   extension, 1727 stock). This also shows that the Bun build loads the extension, with its pi-tui module shared with Pi.

## A-0179 · archived 2026-10-23 · PCLI · Publishing
Status: SUPERSEDED by `[D-PCLI-PUBLISH]` ([DECISIONS.md, PCLI](DECISIONS.md#pcli)).
Introduced: `3b6d6c1`, the oldest hit of ``git log -S'Publishing: skill `publish-pcli` (`.agents/skills/publish-pc' -- DECISIONS.md``.
Archived by: docs-cleanup, 2026-10-23; the commit is `git log -S'A-0179' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 1611-1612 at `30952e6`, verbatim:

> - Publishing: skill `publish-pcli` (`.agents/skills/publish-pcli/SKILL.md`), `vsce publish --target win32-x64` from
>   `pcli-vscode/` under publisher `arqawa`, `version` raised before each publish, only on a direct request.

## A-0180 · archived 2026-10-23 · PCLI · One-off PCLI 0.0.2 release
Status: OBSOLETE; nearest active entry `[D-PCLI-PUBLISH]` ([DECISIONS.md, PCLI](DECISIONS.md#pcli)). Completed: a POST to https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery (filterType 7, value arqawa.pcli, flags 1, api-version 3.0-preview.1) at 2026-10-23T14:42:32Z lists arqawa.pcli 0.0.2 (win32-x64, lastUpdated 2026-10-22T18:51:22.137Z) after 0.0.1 (2026-10-20T17:07:36.697Z); saved log /tmp/docs-cleanup-C-evidence/{request,headers,response,summary}-2026-10-23T14-42-32Z.*; manifests carry 0.0.2 since 02bd178. The VDI package update is the owner's own step and is not verified.
Introduced: `02bd178`, the oldest hit of `git log -S'The Pi 1.4.0 PCLI is published right after the merge, then t' -- DECISIONS.md`.
Archived by: docs-cleanup, 2026-10-23; the commit is `git log -S'A-0180' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 1613-1617 at `30952e6`, verbatim:

> - The Pi 1.4.0 PCLI is published right after the merge, then the package on the VDI is updated (owner, to the question
>   of when to release: «2a» to «Выпустить новую версию PCLI сразу после слияния, потом обновить пакет на VDI»). Reason:
>   main carries the version that gets published, so `pcli-vscode/package.json` and its lockfile are at 0.0.2, one patch
>   above the latest Marketplace version 0.0.1 (read-only query of the gallery, `/tmp/pi14-marketplace.json`). The
>   branch does not publish; publishing stays a separate step on the owner's request.

## A-0181 · archived 2026-10-23 · Anthropic subscription adapter · Main 1h, children 5m
Status: SUPERSEDED by `[D-ANTHROPIC-TTL]` ([DECISIONS.md, Anthropic subscription adapter](DECISIONS.md#anthropic-subscription-adapter)).
Introduced: `b91f832`, the oldest hit of `git log -S'Owner TTL approval: «По поводу кэшей вопрос-ответ A: основно' -- DECISIONS.md`.
Archived by: docs-cleanup, 2026-10-23; the commit is `git log -S'A-0181' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 1621-1627 at `30952e6`, verbatim:

> - Owner TTL approval: «По поводу кэшей вопрос-ответ A: основному агенту час А под основным 5 минут ещё какие-то варианты есть? Может, 10 минут? Или это замеренная цифра? Если это замеренная цифра и 5 минут будет заебись в большинстве случаев, то пусть будет 5 минут. Если можно больше и это будет более эффективно, то можно 10 минут поставить или 15. Я не знаю.»
>   Anthropic offers 5m and 1h, not 10m or 15m. Keep the main OAuth 1h default; the independent child extensions own
>   their 5m request policy ([Agent](#agent), [Review](#review)). Their explicit `short` wins in both `cache.ts` and
>   `transport.ts`, so wire cache markers stay on without `ttl: "1h"`, with or without this adapter loaded. No new
>   config knobs or process env changes. Reason: the measured short review/resend gaps favor cheaper short writes;
>   [measurements](notes/prompt-cache-policy.md) retain the tradeoffs and evidence limits.
>   Carrier proof: package `test/prompt-cache.test.ts`, real Pi library/bundle SDK and mocked Anthropic payloads.

## A-0182 · archived 2026-10-23 · Anthropic subscription adapter · OAuth 1h default
Status: SUPERSEDED by `[D-ANTHROPIC-OAUTH-TTL]` ([DECISIONS.md, Anthropic subscription adapter](DECISIONS.md#anthropic-subscription-adapter)).
Introduced: `ebf7bc1`, the oldest hit of `git log -S'Owner request (session 2026-10-21, lines 275, 281): «Почему ' -- DECISIONS.md`.
Archived by: docs-cleanup, 2026-10-23; the commit is `git log -S'A-0182' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 1628-1638 at `30952e6`, verbatim:

> - Owner request (session 2026-10-21, lines 275, 281): «Почему ты не юзаешь какой-то часовой cash?»;
>   «Это надо будет пофиксить тоже». OAuth subscription requests default to 1-hour prompt caching; explicit request
>   retention and user-set `PI_CACHE_RETENTION` win. Engineering choice: request-local options before the SDK warmer
>   starts, not a process-wide env write, because the latter also changes OpenAI retention. `cache.ts` resolves Pi
>   auth before the SDK stream and supplies `long` for OAuth only; `lifecycle.ts` binds/restores this wrapper for
>   owning and shared-runtime child sessions, and `transport.ts` covers direct provider calls. API keys, unrelated
>   runtimes/providers and owner notice settings stay unchanged. Warming policy lives in [Settings](#settings),
>   independently of retention; prompt caching stays enabled. Reason: the provider alone runs too late
>   to set the warmer's TTL. Lifecycle cleanup restores stock behavior when the last adapter is disabled.
>   TTL, timing, pricing and Pi's prospective warmer-cost limitation have one reference:
>   `extensions/RQW-anthropic/README.md`, Prompt cache. Deterministic proof: its `test/cache.test.ts`.

## A-0183 · archived 2026-10-23 · Anthropic subscription adapter · Isolated extension
Status: SUPERSEDED by `[D-ANTHROPIC-EXT]` ([DECISIONS.md, Anthropic subscription adapter](DECISIONS.md#anthropic-subscription-adapter)). C:3046 quote not in the Pi sessions; relabelled coordinator text.
Introduced: `8a1f2ed`, the oldest hit of ``git log -S'Extension `extensions/RQW-anthropic/`, listed in `package.js' -- DECISIONS.md``.
Archived by: docs-cleanup, 2026-10-23; the commit is `git log -S'A-0183' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 1640-1645 at `30952e6`, verbatim:

> - Extension `extensions/RQW-anthropic/`, listed in `package.json`, owns transport and OAuth recovery. Visibility moved to
>   `RQW-providers` ([Providers](#providers)).
>   Owner requirement (C:3046): «они должны быть полностью изолированы, самодостаточны, чтобы мы могли включать
>   и выключать, как feature флаги». Engineering implementation: disable and reload unregisters only its overlay
>   and restores in-memory hooks. No
>   node_modules edits or credential deletion. Toggle and migration: `extensions/RQW-anthropic/README.md`.

## A-0184 · archived 2026-10-23 · Anthropic subscription adapter · Login and omp wire
Status: SUPERSEDED by `[D-ANTHROPIC-WIRE]` ([DECISIONS.md, Anthropic subscription adapter](DECISIONS.md#anthropic-subscription-adapter)). C:3133 quotes not in the Pi sessions; relabelled coordinator text.
Introduced: `071df1e`, the oldest hit of `git log -S'Owner request (C:3133): «чтобы он был такой же, как в OMP, ч' -- DECISIONS.md`.
Archived by: docs-cleanup, 2026-10-23; the commit is `git log -S'A-0184' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 1646-1653 at `30952e6`, verbatim:

> - Owner request (C:3133): «чтобы он был такой же, как в OMP, чтобы у него был self-healing»;
>   «И чтобы можно было через него авторизоваться». Engineering implementation: the overlay preserves Pi's
>   catalog/parser, delegates Pi's PKCE browser/copy-code
>   login and uses omp's refresh endpoint/headers, CLI billing block, original system role and exact-body XXH64 checksum.
>   The installed pi-claude-auth's SDK relocation and normalized checksum contradict the reference and are not used.
>   MIT attribution: `THIRD-PARTY-NOTICES.md`. No installed fork code is copied. Pi's delegated login endpoint/callback
>   and parser remain Pi's, not a complete omp port. Subscription acceptance/billing, account rotation and all omp SDK
>   headers are not claimed. Evidence and risks: `notes/anthropic-adapter.md`.

## A-0185 · archived 2026-10-23 · Anthropic subscription adapter · Provider visibility shim
Status: MERGED into `[D-PROVIDERS-ALLOW]` ([DECISIONS.md, Anthropic subscription adapter](DECISIONS.md#anthropic-subscription-adapter)). Duplicate of the Providers entries.
Introduced: `071df1e`, the oldest hit of `git log -S'Owner request (C:3171): «Это именно отключить»; «Когда мы за' -- DECISIONS.md`.
Archived by: docs-cleanup, 2026-10-23; the commit is `git log -S'A-0185' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 1654-1661 at `30952e6`, verbatim:

> - Owner request (C:3171): «Это именно отключить»; «Когда мы заходим в логин, там должны быть только кодекс,
>   авторизация и авторизация через Anthropic, которую ты сейчас делаешь. И всё».
>   Engineering decision: hide providers without deleting saved credentials. Public unregisterProvider restores
>   builtins instead of hiding them.
>   `extensions/RQW-providers/index.ts` wraps ModelRuntime provider/model listing and AgentSession.scopedModels with a
>   checked, reference-counted reversible shim, only in runtimes with an owning session of that extension. It does not
>   erase previously selected models or disable explicit SDK lookups. Disabling restores defaults without restoring
>   stale credential snapshots. Moved out of `RQW-anthropic` ([Providers](#providers)).

## A-0186 · archived 2026-10-23 · Anthropic subscription adapter · Anthropic and legacy Codex only
Status: MERGED into `[D-PROVIDERS-ALLOW]` ([DECISIONS.md, Anthropic subscription adapter](DECISIONS.md#anthropic-subscription-adapter)). Owner quote moved to D-PROVIDERS-ALLOW.
Introduced: `c149d01`, the oldest hit of `git log -S'Owner clarification: «Смотри, в нашем Pi должен быть старый ' -- DECISIONS.md`.
Archived by: docs-cleanup, 2026-10-23; the commit is `git log -S'A-0186' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 1662-1665 at `30952e6`, verbatim:

> - Owner clarification: «Смотри, в нашем Pi должен быть старый OpenAI кодекс и всё, блядь. Legacy, который через девайс. А новый OpenAI нахуй не нужен, блядь. Я не знаю, что там за глупость новый OpenAI. У нас должен быть вход именно такой же, как сейчас это работает в текущем OpenAI кодексе, и всё, больше никак.»
>   Keep only `anthropic` and legacy `openai-codex` visible. Pi 1.4.0's `openai` ("Sign in with ChatGPT" and
>   `OPENAI_API_KEY`) stays hidden: the owner wants the existing legacy device login, not the new OpenAI provider.
>   Carrier: `extensions/RQW-providers/index.ts`, `ALLOWED`.

## A-0187 · archived 2026-10-23 · Anthropic subscription adapter · Bounded refresh and replay
Status: SUPERSEDED by `[D-ANTHROPIC-REFRESH]` ([DECISIONS.md, Anthropic subscription adapter](DECISIONS.md#anthropic-subscription-adapter)).
Introduced: `8a1f2ed`, the oldest hit of ``git log -S'`auth.ts` refreshes under Pi'\''s runtime credential-store lock' -- DECISIONS.md``.
Archived by: docs-cleanup, 2026-10-23; the commit is `git log -S'A-0187' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 1666-1671 at `30952e6`, verbatim:

> - `auth.ts` refreshes under Pi's runtime credential-store lock, rechecks the rejected bearer, reuses a concurrent
>   update and persists rotation before replay. One HTTP 401 replay, at most two transient refresh attempts and one
>   explicit newer-version replay; no auth retry for 403/quota, no replay after streaming. Caller abort cancels waiting
>   and inference but not persistence of an already-rotating token. Permanent errors surface /login guidance without
>   upstream token-response bodies. Subscription inference uses the official HTTPS origin only and rejects redirects.
>   No bootstrap identity or startup version probe. `PI_AI_CLAUDE_CODE_VERSION` can pin the CLI version.

## A-0188 · archived 2026-10-23 · Anthropic subscription adapter · Old adapter replacement
Status: SUPERSEDED by `[D-ANTHROPIC-MIGRATION]` ([DECISIONS.md, Anthropic subscription adapter](DECISIONS.md#anthropic-subscription-adapter)).
Introduced: `9ef1519`, the oldest hit of `git log -S'Adapter replacement (user: «Просто старый адаптер выкидываеш' -- DECISIONS.md`.
Archived by: docs-cleanup, 2026-10-23; the commit is `git log -S'A-0188' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 1672-1679 at `30952e6`, verbatim:

> - Adapter replacement (user: «Просто старый адаптер выкидываешь, который есть уже, и ставишь наш адаптер»).
>   `INSTALL.md` step 0.1 removes an installed `git:github.com/edxeth/pi-claude-auth` with official `pi remove`, in its
>   installed scope, then installs or updates my-pi normally. No confirmation is needed for this known replacement.
>   Preserve `auth.json` and unrelated packages/settings. Omit old explicit `-e` arguments on the next launch without
>   editing other projects' scripts. Reason: run one Anthropic adapter, with the old one off, not support a mixed
>   configuration. Another competing adapter must be switched off before use. Mixed-config support, poisoning future
>   refreshes after a conflict and SDK changes are not required by this migration. Carried by `INSTALL.md` and
>   `extensions/RQW-anthropic/`; adapter details live in its README.

## A-0189 · archived 2026-10-23 · Anthropic subscription adapter · Proof boundary
Status: SUPERSEDED by `[D-ANTHROPIC-PROOF]` ([DECISIONS.md, Anthropic subscription adapter](DECISIONS.md#anthropic-subscription-adapter)). Claude campaign pause duplicate replaced by a link to Work policy; "Windows/Linux" narrowed to Windows (Linux is out of scope).
Introduced: `8a1f2ed`, the oldest hit of `git log -S' use fake credentials, mock fetch, file-backed lock fixtures' -- DECISIONS.md`.
Archived by: docs-cleanup, 2026-10-23; the commit is `git log -S'A-0189' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 1680-1685 at `30952e6`, verbatim:

> - Proof boundary: tests use fake credentials, mock fetch, file-backed lock fixtures and both Pi library/CLI-bundle
>   entrypoints. These tests do not prove live subscription acceptance or billing. The owner's old Claude benchmark/tuning campaign
>   pause (C:3244) remains: «Те задачи, где ты должен делать замеры на Sonnet моделях, на Cloud моделях, пока на паузе
>   стоят»; «Я тебе дам команду, когда их продолжать». Offline fixture coverage in `notes/anthropic-adapter.md` is
>   not a current verification report or proof of actual Windows/Linux execution; independent review remains required
>   by `PROCESS.md` and [Work policy](#work-policy), not by a manifesto gate.

## A-0190 · archived 2026-10-23 · Anthropic subscription adapter · Header boundary, per-request version
Status: SUPERSEDED by `[D-ANTHROPIC-HEADERS]` ([DECISIONS.md, Anthropic subscription adapter](DECISIONS.md#anthropic-subscription-adapter)).
Introduced: `071df1e`, the oldest hit of `git log -S'Engineering follow-up to four independent review findings un' -- DECISIONS.md`.
Archived by: docs-cleanup, 2026-10-23; the commit is `git log -S'A-0190' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 1687-1695 at `30952e6`, verbatim:

> - Engineering follow-up to four independent review findings under the adapter request C:3133: either fully handle
>   the canonical auth-token path or reject OAuth-header auth before external transport. The adapter
>   rejects subscription Authorization headers before delegation and keeps ordinary API-key gateway behavior
>   (`transport.ts`). The single-adapter migration policy is defined above; no mixed-configuration or SDK changes
>   are part of that requirement. Engineering decision: track the sent version per request, with one bounded replay
>   if an effective newer version
>   meets a rejection, even if already adopted. Each request records its sent version, including under concurrency; a pinned
>   `PI_AI_CLAUDE_CODE_VERSION` still forbids adaptation (`wire.ts`, `transport.ts`). License, privacy and
>   delegated Pi parser/login design remain unchanged.

## A-0191 · archived 2026-10-23 · Models · Draft chooser
Status: SUPERSEDED by `[D-MODELS-CHOOSER]` ([DECISIONS.md, Models](DECISIONS.md#models)). Inner quote marks restored to the owner's «...»; ephemeral /var/folders visual carriers dropped; effort colours attributed to RQW-statusbar.
Introduced: `d0160cf`, the oldest hit of `git log -S'Owner'\''s transactional picker request, verbatim: «Надо переде' -- DECISIONS.md`.
Archived by: docs-cleanup, 2026-10-23; the commit is `git log -S'A-0191' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 1699-1719 at `30952e6`, verbatim:

> - Owner's transactional picker request, verbatim: «Надо переделать picker модели effort таким образом, что когда я нажимаю Shift+стрелочку вверх, вниз или влево, вправо, у нас открывается визуальный интерфейс, в котором переключается модель визуально. Знаешь, как в iPhone, когда ты крутишь ползунки „минуты“, „секунды“, где-то открывается интерфейс, в котором предварительно меняется модель и effort, когда я нажимаю кнопочки, и там будет кнопочка „OK“. Enter — это принять, а Escape — это отмена. Escape — закрыть интерфейс. И получится так, что когда я меняю интерфейс, меняю effort, он сразу не меняется, не применяется. Нет такого, что я пока переключаю модель, он запросы под разными моделями улетает. У меня префаер — мини-интерфейс, где я выбираю модель effort, нажимаю Enter, и оно применяется. Эта хуйня должна быть в стилистике нашего UI из тех задач, которые были. Следичку подгони сам. Потом, если что, если мне не понравится, мы её переделаем.»
>   Clarification, verbatim: «когда ты нажимаешь первый раз Shift и стрелочку, у тебя открывается интерфейс уже с новой, будущей моделью измененной, чтобы я не делал дополнительные клики... Если я нажимаю Shift+Влево или Shift+Вправо, то он сразу открывает пикер с измененным состоянием, чтобы мне нажать, а потом Enter. Нажать и Enter, если нужен один переход. А если несколько, то я нажал, довел до нужного состояния, нажал Enter... строго в концепте Terminal UI Pi ... в цветовой гамме и в согласованности с нашим новым дизайном ... Решение остается за тобой конечное».
>   Reason: preview model and effort without changing the live session while choosing. Each initiating Shift+arrow
>   performs one draft step before the first render; one transition is Shift+arrow then Enter. Plain and Shift arrows
>   then share the same axes. Enter commits once; Esc closes with no setters or restoration. Model order, authenticated
>   availability and allowed efforts below are retained; a draft model switch clamps effort to the nearest lower allowed
>   level or the lowest. Dialog/key-repeat guards prevent stacked dialogs; actual session replacement/reload/shutdown
>   cancels the draft. No settings, dependencies, request fences or aborts are added.
>   Appearance is delegated: two compact terminal-native wheel columns, selected center, muted neighbours and visible
>   OK/Enter/Esc hints, supplied theme roles and thinking-level tokens (low ordinary, medium green, high gold, xhigh purple,
>   max red; highlighted effort bold). Narrow rendering fits rather than overflowing. Visual carriers:
>   `/var/folders/cf/2mk2lmy9087c_lw961rpfvz00000gn/T/ui-port/browser-preview/index.html` (native-menu/reasoning)
>   and sibling `EXECUTION-BRIEF.md` §0; this is not a literal web/iPhone component and does not activate a theme.
>   Runtime carriers: `extensions/RQW-models/{index,picker}.ts`; standalone state/rendering tests in its `test/`,
>   real Pi interactive composition with current RQW-prompt/statusbar hooks in `test/model-effort-picker.test.ts`.
>   The added strict no-intermediate-request-at-commit requirement was explicitly withdrawn by the coordinator as
>   an overreach, not an owner requirement. Unchanged-model commits use only the thinking setter; changed-model commits
>   use public `pi.setModel`, a scoped synchronous pending-effort `model_select` handler, fallback and cleanup.
>   Pi's setters are not atomic: earlier listeners/concurrent work may observe its intermediate switch effort;
>   already-prepared requests can retain their snapshot. This limitation is explicit in the extension README.
>   Existing `/rqw-models`, stock `/model` restrictions and unrelated controls are unchanged.

## A-0192 · archived 2026-10-23 · Models · Startup availability
Status: SUPERSEDED by `[D-MODELS-STARTUP]` ([DECISIONS.md, Models](DECISIONS.md#models)). The codemode flaky-test precedent was not authority for this change; relabelled coordinator engineering choice.
Introduced: `230e8d0`, the oldest hit of `git log -S'Startup reads provider-scoped availability an' -- DECISIONS.md`.
Archived by: docs-cleanup, 2026-10-23; the commit is `git log -S'A-0192' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 1721-1727 at `30952e6`, verbatim:

> - Engineering follow-up under the owner's flaky-test precedent: «Теперь по нестабильному тесту 1А»;
>   1a: «Отдельной задачей разобрать, почему тест кодмода на Windows иногда не укладывается в 5 секунд, и исправить причину.»
>   Startup reads provider-scoped availability and uses the owning session's async-auth `setModel`.
>   Reason: Pi can discard a whole-runtime availability pass superseded by a background refresh and return an old
>   snapshot; `pi.setModel` also checks that snapshot's configured-auth state before checking real auth.
>   Carrier: `extensions/RQW-models/index.ts`; its `test/models.test.ts` gates a superseding pass deterministically,
>   keeping real auth checks, provider filters, list guards and normal model-selection events intact.

## A-0193 · archived 2026-10-23 · Models · Independent module
Status: SUPERSEDED by `[D-MODELS-MODULE]` ([DECISIONS.md, Models](DECISIONS.md#models)).
Introduced: `071df1e`, the oldest hit of `git log -S'Owner request (C:3113): «Надо, чтобы они работали как в наше' -- DECISIONS.md`.
Archived by: docs-cleanup, 2026-10-23; the commit is `git log -S'A-0193' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 1729-1734 at `30952e6`, verbatim:

> - Owner request (C:3113): «Надо, чтобы они работали как в нашем OMP»; «Один мод будет статус бара, а второй мод
>   будет Model Picker»; «То есть чисто модели Opus, Sonnet, GPT-6.1, GPT-6, Luna-6, Haiku».
>   `extensions/RQW-models/index.ts` is independent,
>   imports only Pi, and is listed separately in `package.json` under `pi.extensions`. Disable its resource in Pi's
>   `pi config`, then `/reload`; it writes no settings and registers no tool. The listed-models rule below retains its
>   existing instance-level masks, removed when it is switched off; the draft chooser uses public UI/event APIs.

## A-0194 · archived 2026-10-23 · Models · GPT 5.6 Luna and Haiku order
Status: SUPERSEDED by `[D-MODELS-LUNA]` ([DECISIONS.md, Models](DECISIONS.md#models)). Finished "for the measurements" framing removed.
Introduced: `7d6fdbf`, the oldest hit of `git log -S'Owner: «Надо подобрать сопостовимую модель на gpt, попробоуй' -- DECISIONS.md`.
Archived by: docs-cleanup, 2026-10-23; the commit is `git log -S'A-0194' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 1735-1741 at `30952e6`, verbatim:

> - Owner: «Надо подобрать сопостовимую модель на gpt, попробоуй 5.6 luna и более сильные модели типа medium ризонинг 6 и 6.1 sol, на время замеров добавь 5.6 luna в список моделей наших сразу после хайку и вообще хайку надо поставить над всеми в слабых моделях ь.е. порядок должен быть типа haiku 5.5, luna 5.6, luna 6 так как luna 6 слабее 5.6 луны и потом будем думать»
>   Reason: put Haiku above both Luna models and include GPT 5.6 Luna for the measurements. Owner, 2026-10-22:
>   «Давай тогда сделаем, что на blind review будет Luna Medium. На high review будет Luna High. Да» - the GPT
>   reviewers of `RQW-review` use `openai-codex/gpt-5.6-luna` (DECISIONS, [Review](#review)), so GPT 5.6 Luna stays in the
>   model list permanently, no longer a temporary addition. Carrier: `extensions/RQW-models/index.ts` (`FAMILIES` and
>   `FAMILY_LEVELS`). Pi's catalog has `openai-codex/gpt-5.6-luna`; its low, medium, high, xhigh and max efforts
>   are selectable, still intersected with Pi support. This list change does not itself run the measurements.

## A-0195 · archived 2026-10-23 · Models · Model order and availability
Status: SUPERSEDED by `[D-MODELS-ORDER]` ([DECISIONS.md, Models](DECISIONS.md#models)).
Introduced: `e6c21e2`, the oldest hit of ``git log -S'Model order in `FAMILIES`: `claude-opus-5-5`, `claude-sonnet' -- DECISIONS.md``.
Archived by: docs-cleanup, 2026-10-23; the commit is `git log -S'A-0195' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 1742-1751 at `30952e6`, verbatim:

> - Model order in `FAMILIES`: `claude-opus-5-5`, `claude-sonnet-5-5`, `gpt-6.1-sol`, `gpt-6-sol`,
>   `claude-haiku-5-5`, `gpt-5.6-luna`, `gpt-6-luna`. `pickerModels` takes Pi's own credential-aware availability, including provider
>   `filterModels` (for example GitHub Copilot's per-account list): the runtime's unmasked
>   `getAvailableSnapshot` through its prototype while the listed-models masks (below) are set, otherwise
>   `ctx.modelRegistry.getAvailable()`. Absent models, models a provider filters out and providers without
>   configured auth are skipped. Building and navigating the draft uses that snapshot, resolves no credentials and
>   makes no requests; commit uses Pi's normal authenticated setter. Only the startup choice waits for Pi's availability
>   pass (below). `familyOf` matches the same
>   generation across provider paths, Claude dotted versions, dated aliases and Bedrock IDs. No old Claude generation,
>   unlisted GPT generation, fast variant or invented model is substituted.

## A-0196 · archived 2026-10-23 · Models · One variant per family
Status: SUPERSEDED by `[D-MODELS-VARIANT]` ([DECISIONS.md, Models](DECISIONS.md#models)). "A provider-wide restriction remains a separate task" is done (RQW-providers, 2bf5eac).
Introduced: `071df1e`, the oldest hit of `git log -S'Engineering decisions for the model request C:3113, elaborat' -- DECISIONS.md`.
Archived by: docs-cleanup, 2026-10-23; the commit is `git log -S'A-0196' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 1752-1758 at `30952e6`, verbatim:

> - Engineering decisions for the model request C:3113, elaborated in the coordinator implementation brief C:3274:
>   match supported IDs across providers and skip absent auth. Provider visibility is the separate owner request
>   C:3171. The preferred providers are `anthropic` for Claude and
>   `openai-codex` for GPT. Conservative choice: one available variant per family, preferring that provider and its
>   exact canonical ID, then stable provider/ID order. This keeps one entry per family, not duplicates of each model. A proxy
>   variant can be selected only when the preferred provider/ID is unavailable. This extension does not disable any
>   provider. A provider-wide restriction remains a separate task.

## A-0197 · archived 2026-10-23 · Models · Shift+arrow keys
Status: SUPERSEDED by `[D-MODELS-KEYS]` ([DECISIONS.md, Models](DECISIONS.md#models)).
Introduced: `ac33dcc`, the oldest hit of `git log -S'Owner request: «Надо вернуть старое управление моделями: Shi' -- DECISIONS.md`.
Archived by: docs-cleanup, 2026-10-23; the commit is `git log -S'A-0197' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 1759-1775 at `30952e6`, verbatim:

> - Owner request: «Надо вернуть старое управление моделями: Shift + Вверх/Вниз будет смена модели, Shift + Вверх — к более сильным, Shift + Вниз — к более слабым. А Shift + Влево/Вправо — это будет смена ризенинга, так же, как и раньше это было в ОМП.»
>   Reason: the old oh-my-pi layout (`model-arrows.js`, `reasoning-arrows.js`, [notes/models-omp.md](notes/models-omp.md)),
>   where Shift+Up moves to earlier (stronger) entries of the list and Shift+Down to later (weaker) ones, and Shift+Right
>   raises reasoning, Shift+Left lowers it. This replaces the earlier Option/Alt+plus/minus layout; those shortcuts and their
>   aliases are removed. Pi 1.4.0 binds none of the four Shift+arrow keys (editor, app and `tui.altScreen` defaults use
>   plain, `ctrl` and `ctrl+shift` arrows), so nothing stock is shadowed. Terminals send CSI `1;2A`/`B`/`C`/`D` for them
>   (xterm modified keys in iTerm2, Terminal.app and the VS Code terminal; the Kitty protocol keeps the same form, also
>   with an event type such as `1;2:1A`), so no Option/Meta setup is needed.
>   Carrier: `extensions/RQW-models/index.ts`. `registerShortcut` binds `shift+up` (stronger model), `shift+down` (weaker
>   model), `shift+right` (reasoning up) and `shift+left` (reasoning down). The first match handles a press once, as in
>   Pi's interactive editor. The transactional chooser above replaces immediate shortcut mutation: one guarded dialog
>   owns the draft, so repeats do not queue additional dialogs or live switches. Opening reads the live model from the
>   latest `session_start` event context, not the TUI shortcut snapshot; the context is refreshed on resume and reload.
>   Both model and reasoning draft movement stop at either end, as omp does, rather than wrap.
>   Engineering entry rule: from outside the list, Shift+Up enters at the strongest available model and Shift+Down at the
>   weakest, so entry follows the stated strength direction. The picker stays strongest first. Tests:
>   `extensions/RQW-models/test/models.test.ts` (byte sequences through Pi's key matcher, direction, limits).

## A-0198 · archived 2026-10-23 · Models · /rqw-models
Status: SUPERSEDED by `[D-MODELS-COMMAND]` ([DECISIONS.md, Models](DECISIONS.md#models)).
Introduced: `e6c21e2`, the oldest hit of ``git log -S'models` is the extension'\''s authenti' -- DECISIONS.md``.
Archived by: docs-cleanup, 2026-10-23; the commit is `git log -S'A-0198' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 1776-1779 at `30952e6`, verbatim:

> - `/rqw-models` is the extension's authenticated listed-model picker via `ctx.ui.select`. Pi reserves its built-in model
>   shortcuts and disambiguates commands conflicting with built-ins, so RQW-models does not replace them; it empties
>   them (next item). Shift+Tab (thinking cycle) and provider definitions stay stock. In print/JSON mode the picker
>   has no dialog and does nothing; RPC can supply the standard select dialog.

## A-0199 · archived 2026-10-23 · Models · Only listed models
Status: SUPERSEDED by `[D-MODELS-LISTED]` ([DECISIONS.md, Models](DECISIONS.md#models)). Reviewer list now names GPT-5.6 Luna; startup wait moved to D-MODELS-STARTUP.
Introduced: `5e1d478`, the oldest hit of `git log -S'Owner rule: «Смотри, про выбор модели, где через стрелочки в' -- DECISIONS.md`.
Archived by: docs-cleanup, 2026-10-23; the commit is `git log -S'A-0199' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 1780-1825 at `30952e6`, verbatim:

> - Owner rule: «Смотри, про выбор модели, где через стрелочки вверх, вниз, через плюс-минус мы
>   меняем модели, меняем effort. Там меняются только модели из нашего списка. И вообще другие модели выбрать нельзя,
>   только модели в этом списке. Дефолтный Model Picker работать не должен. Там должен быть пустой список моделей.»
>   For the CLI flag `pi --model ...`, a model restored with an old session and a model given to the `agent` tool for
>   a subagent, the owner answered «Да, делай» to «a) Закрыть и эти пути. Модель вне списка не выбирается нигде, Pi
>   покажет предупреждение.» This supersedes the earlier choice that stock `/model`, Ctrl+L, Ctrl+P, `/scoped-models`
>   and CLI/RPC selection stay intact. Reason: only the listed models may be selected or used anywhere.
>   Carrier: `extensions/RQW-models/index.ts`. Listed means any provider variant matched by `familyOf`; nothing else.
>   - Stock lists are empty. Pi 1.4.0 gives extensions no session handle, so on every `session_start` RQW-models
>     borrows the owning `AgentSession` in one synchronous `ctx.getContextUsage()` call, with
>     `AgentSession.prototype.getContextUsage` swapped and restored in the same call. It then sets own-property masks
>     on that session and its `ModelRuntime`: `getAvailableSnapshot()` and `session.scopedModels` return `[]`. So the
>     `/model` picker, `/model provider/id`, its autocomplete, Ctrl+L, Ctrl+P, `/scoped-models`, the `/settings`
>     default-model choices, RPC `get_available_models`/`set_model`/`cycle_model` and Pi's post-login auto-selection
>     find no model; `ctx.modelRegistry.getAvailable()` is empty for every extension.
>   - Selection outside the list is refused before mutation: the owning session's `setModel` (stock UI, RPC and
>     `pi.setModel` of any extension) rejects with `<provider>/<id> is not in the RQW models list. Allowed: <listed IDs>.`
>     and a warning notification; model, session entries, settings and `model_select` stay unchanged.
>   - On every `session_start` a current model outside the list (CLI `--model`/`--models`, a saved default without
>     authenticated Opus, a restored or resumed session, or RQW-models enabled by `/reload`) is replaced by the
>     default: authenticated Opus, else the strongest authenticated listed model, at medium or the startup/`/new`
>     `--thinking`, with a warning (a notification, or stderr without UI). Engineering choice, derived from «вообще другие
>     модели выбрать нельзя» and accepted by the coordinator: the strongest listed model when Opus has no auth,
>     since keeping Pi's unlisted model would break the rule. A fresh startup selects
>     Opus first, so an unlisted saved default never becomes current and needs no warning. With no authenticated
>     listed model the model stays and the warning says its requests are refused. Before this choice and the Opus
>     default, `session_start` awaits Pi's own provider-scoped async `getAvailable(provider.id)` (not masked),
>     in parallel for the visible providers: resolver-only auth may not yet appear in the synchronous snapshot
>     (`dist/core/model-runtime.js` `registerNativeProvider`, `markProvisionallyConfigured`).
>     The wait shares one 15 s deadline, like Pi's model selector; on a timeout or error the snapshot is used.
>     Without a choice to make, nothing waits.
>   - Requests: the owning runtime's `prepareRequest` refuses every chat request for an unlisted model with
>     `RQW-models refused the request: <the same text>`. This covers in-process sessions on that runtime: an `agent`
>     subagent given such a `model` ends its first turn with this error; RQW-review's Haiku and Sonnet are listed.
>     Checked: Pi's own requests use the session's model (compaction, branch and bug-report summaries, cache warmer,
>     retries; a virtual model is checked as the physical model it routes to), so nothing needs an exemption.
>     Image and classifier models (codemode `models.generateImages`/`models.classify`) are not chat models and pass.
>   - Each mask calls Pi's current prototype method, so the prototype patches of RQW-anthropic and RQW-context keep
>     working underneath and are never captured or restored by RQW-models. Masks are reference-counted per instance
>     and removed on `session_shutdown` (`/reload`, `/new`, quit) or `session.dispose()`; switching RQW-models off and
>     `/reload` restores stock behavior. Each of RQW-models and RQW-anthropic works with the other on or off.
>   - Limits: Ctrl+P changes nothing but Pi still shows "Only one model available"; Pi prints it for an empty cycle
>     result and has no hook, and a fake result would print a false "Switched to". `/scoped-models` lists no model,
>     only saved patterns that match nothing, as unavailable rows. After `/login` from no model Pi suggests `/model`;
>     `/rqw-models` or Shift+Up/Down select a model. If Pi's internals change and the session cannot be borrowed,
>     RQW-models warns and the stock lists stay. Pi mechanisms: [notes/models-omp.md](notes/models-omp.md).

## A-0200 · archived 2026-10-23 · Models · Opus medium at startup
Status: SUPERSEDED by `[D-MODELS-DEFAULT]` ([DECISIONS.md, Models](DECISIONS.md#models)).
Introduced: `071df1e`, the oldest hit of `git log -S'Owner request (C:3113): «И базовая модель всегда при запуске' -- DECISIONS.md`.
Archived by: docs-cleanup, 2026-10-23; the commit is `git log -S'A-0200' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 1826-1839 at `30952e6`, verbatim:

> - Owner request (C:3113): «И базовая модель всегда при запуске — это Opus-Medium. Это от провайдера не зависит».
>   CLI precedence and preservation of resumed sessions are engineering choices, not direct owner quotations
>   (assistant C:3123; coordinator implementation brief C:3274). Without explicit CLI model selection, `session_start` selects available Opus and `medium` on a fresh
>   startup or `/new`. With no authenticated Opus
>   it keeps Pi's initial model if listed rather than silently choosing another family. A startup with existing
>   conversation history or continuation/session flags, and events `resume`, `fork` and `reload`, keep a listed current
>   model/thinking. Explicit CLI `--model` and `--models` of listed models preserve Pi's resolved model and thinking
>   selection, including model suffixes, mixed scoped suffixes, `--thinking` precedence and settings effort when no suffix is given. No scoped suffix is
>   parsed again by the extension. Pi's exported `parseArgs` recognizes explicit selections and continuation flags.
>   Without an explicit model selection, the extension selects available Opus and applies `--thinking` through Pi's
>   native clamping, including off/minimal; when `--thinking` is absent it applies medium when supported. CLI overrides apply to `/new` too,
>   matching Pi's own new-session initialization. No defaults are persisted. An SDK host must pass reason `resume` for
>   an empty restored session with no conversation history, since public session metadata cannot distinguish that
>   session from a fresh one after Pi inserts initial model/thinking entries.

## A-0201 · archived 2026-10-23 · Models · Option+plus/minus direction
Status: SUPERSEDED by `[D-MODELS-KEYS]` ([DECISIONS.md, Models](DECISIONS.md#models)). Key layout replaced by Shift+arrows (ac33dcc); order and direction rule kept in D-MODELS-KEYS and D-MODELS-ORDER, effort part in D-MODELS-EFFORT.
Superseded: `ac33dcc`.
Introduced: `0def125`, the oldest hit of `git log -S'Owner correction: «Теперь смотри насчет переключателя модели' -- DECISIONS.md`.
Archived by: docs-cleanup, 2026-10-23; the commit is `git log -S'A-0201' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 1840-1843 at `30952e6`, verbatim:

> - Owner correction: «Теперь смотри насчет переключателя модели, пикера модели. Ты как сделал? Ты сделал, что я нажимаю Option + плюс/минус, и у тебя изменение effort идет правильно. Ты на плюс увеличиваешь effort, на минус уменьшаешь. А выбор модели у тебя идет неправильно. Ты на плюс ухудшаешь модель, а на минус улучшаешь модель. В самом конце у тебя стоит самая сильная модель, а в самом верху самая слабая. Список должен наоборот идти, в том же порядке, только наоборот. Еще смотри, effort у моделей должны быть такие же, как у пикера в MyPy, только без no reasoning моделей.»
>   Reason: the picker lists strongest first, and the stronger direction of the model keys must agree with the stronger
>   direction of the effort keys. The key layout itself was replaced by the Shift+arrow request above. Carrier:
>   `extensions/RQW-models/index.ts`; the strength and entry rules are above.

## A-0202 · archived 2026-10-23 · Models · Harness effort lists
Status: SUPERSEDED by `[D-MODELS-EFFORT]` ([DECISIONS.md, Models](DECISIONS.md#models)).
Introduced: `0def125`, the oldest hit of `git log -S'Owner clarification: «Нет, ты не понял: уровни effort будут ' -- DECISIONS.md`.
Archived by: docs-cleanup, 2026-10-23; the commit is `git log -S'A-0202' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 1844-1857 at `30952e6`, verbatim:

> - Owner clarification: «Нет, ты не понял: уровни effort будут не те, что в стоковом выборе Pi, а те, что в нашем MyOMPHarness были. Там они были перенастроены кастомно. Допустим, у Opus были low, medium, high, у Sonnet были low, medium, high, extra high. Такие же должны быть, только без no reasoning.»
>   Reason: preserve the harness's custom effort choices, not stock Pi's wider list. Carrier:
>   `extensions/RQW-models/index.ts`, explicit `FAMILY_LEVELS` intersected with Pi's
>   `getSupportedThinkingLevels(model)`, so no unsupported level is offered. Opus: low, medium, high;
>   Sonnet: low, medium, high, xhigh; GPT-6.1 Sol, GPT-6 Sol, both listed Luna models and Haiku:
>   low, medium, high, xhigh, max (GPT 5.6 Luna is the catalog-based addition above, permanent).
>   The harness's ORDER contains no minimal; off is removed by request. These lists apply to matched families,
>   including aliases and proxy providers. A non-reasoning model has no choices. On an extension model switch the
>   previous effort is retained if allowed, otherwise the nearest lower allowed level or the lowest. Explicit
>   off/minimal moves to the lowest allowed level on the next extension-driven family selection. Explicit CLI
>   selections of listed models retain their native precedence above. Engineering choice: an unlisted model, current
>   only while no listed model is authenticated, keeps Pi-supported levels minus off and minimal, matching the harness
>   ORDER without inventing a family list.
>   Source evidence and exact OMP capability provenance: [notes/models-omp.md](notes/models-omp.md).

## A-0203 · archived 2026-10-23 · Models · P2 live context and CLI effort
Status: MERGED into `[D-MODELS-KEYS]`, `[D-MODELS-DEFAULT]` ([DECISIONS.md, Models](DECISIONS.md#models)).
Introduced: `071df1e`, the oldest hit of `git log -S'Engineering P2 follow-up for the model request C:3113: obtai' -- DECISIONS.md`.
Archived by: docs-cleanup, 2026-10-23; the commit is `git log -S'A-0203' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 1858-1862 at `30952e6`, verbatim:

> - Engineering P2 follow-up for the model request C:3113: obtain the live current model when an action executes via
>   the public event context; prefer Pi's resolved settings over a manual CLI parser; preserve the selected CLI effort
>   and resumed model. These are implementation choices, not additional owner requirements. Reason: queued TUI snapshots retain the previous model and an extension
>   override loses Pi's selected scoped effort. The fixes use the public event context and retain Pi's resolved
>   explicit selection in `extensions/RQW-models/index.ts`.

## A-0204 · archived 2026-10-23 · Models · Research sources
Status: OBSOLETE; nearest active entry `[D-MODELS-KEYS]` ([DECISIONS.md, Models](DECISIONS.md#models)). Research provenance only, checked against Pi 1.3.0; sources live in notes/models-omp.md.
Introduced: `e6c21e2`, the oldest hit of ``git log -S'-only: `~/Documents/ChatGPT/my-omp-harness`' -- DECISIONS.md``.
Archived by: docs-cleanup, 2026-10-23; the commit is `git log -S'A-0204' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 1863-1872 at `30952e6`, verbatim:

> - Research sources and Pi mechanisms: `notes/models-omp.md`. Read-only: `~/Documents/ChatGPT/my-omp-harness`
>   master/lite use `extensions/ui/model-arrows.js` and
>   `reasoning-arrows.js`; deprecated uses the same files directly under `extensions/`. All use Shift+arrows and
>   stop at the ends. Master's Opus high/Sonnet xhigh caps are carried by the family effort lists above; GPT 5.6
>   and Anthropic off payload rewrites are not ported. Its `settings/config.yml` keeps the two providers and seven model
>   entries. The installed `~/.omp/agent/config.yml` loads that repository but still lists more enabled models and a
>   Sonnet high default; `~/.omp/agent/keybindings.yml` disables stock model cycling. Latest owner choices above win.
>   Checked against Pi 1.3.0 `docs/extensions.md`, `docs/sdk.md`, `docs/keybindings.md`, `core/extensions/types.d.ts`,
>   `core/extensions/runner.js`, `core/model-registry.js`, `core/sdk.js`, `core/agent-session.js`, `main.js`, pi-ai's
>   `models.js` and built-in model data, and pi-tui's `keys.js`.

## A-0205 · archived 2026-10-23 · Models · Model tests
Status: SUPERSEDED by `[D-MODELS-TESTS]` ([DECISIONS.md, Models](DECISIONS.md#models)). "Windows/Linux remain covered by CI" was wrong (CI is macOS and Windows); the ESC-prefix/CSI-u key bytes are negative cases now; report details moved to notes/decisions-evidence.md#models-reports.
Introduced: `e6c21e2`, the oldest hit of ``git log -S'Proof: `extensions/RQW-models/test/models.test.ts`, faux onl' -- DECISIONS.md``.
Archived by: docs-cleanup, 2026-10-23; the commit is `git log -S'A-0205' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 1873-1890 at `30952e6`, verbatim:

> - Proof: `extensions/RQW-models/test/models.test.ts`, faux only, runs standalone loading and disabling, real SDK
>   sessions, model/thinking changes, history restore and reload, no persisted defaults, actual CLI flag handling,
>   missing Anthropic auth and the listed-models rule: empty stock snapshot and scoped list with `/rqw-models` and
>   the Shift+arrow keys working, a stock cycle that does not switch, refusal before mutation, CLI `--model`/`--models` and
>   saved defaults outside the list (also through Pi's CLI bundle, which the installed `pi` runs), restored and
>   resumed sessions, no authenticated listed model, a provider `filterModels` dropping a family, a pending
>   availability pass at startup, a subagent-style session on the shared runtime,
>   release on dispose and stock behavior after `/reload` without it. `test/anthropic-models.test.ts` switches
>   RQW-models and RQW-anthropic off in turn. Package and isolation fixtures use the listed ID `gpt-6.1-sol`. The key test feeds realistic ESC-prefix, Kitty
>   physical/alternate-symbol CSI-u and xterm modifyOtherKeys bytes into Pi's `matchesKey`, with first-match dispatch.
>   This is parser testing, not manual terminal testing. The local implementation report records no live Claude
>   requests and no independent agent review. The P2 implementation report records passing model tests on macOS, Node 22.19.0 and 26.7.0. Regression coverage
>   includes rapid snapshot contexts, reasoning queued behind a switch, real CLI mixed scoped suffixes and a saved
>   default selecting the second scoped model. The complete repository suite passes on both with
>   `--test-concurrency=1`, versions run sequentially. Strict TypeScript checking was not rerun: this worktree has no
>   local compiler or typecheck script. No unrelated tests or timeouts were changed. Windows/Linux remain covered by
>   the existing CI matrix but were not run locally, and no terminal
>   capture or corporate VDI test was performed.

## A-0206 · archived 2026-10-23 · Models · CI auth fixture
Status: SUPERSEDED by `[D-MODELS-CI-FIXTURE]` ([DECISIONS.md, Models](DECISIONS.md#models)). Pi 1.3.0 wording updated; investigation and numbers moved to notes/decisions-evidence.md#models-ci-fixture.
Introduced: `071df1e`, the oldest hit of `git log -S'Engineering CI auth fixture fix for the model request C:3113' -- DECISIONS.md`.
Archived by: docs-cleanup, 2026-10-23; the commit is `git log -S'A-0206' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 1891-1906 at `30952e6`, verbatim:

> - Engineering CI auth fixture fix for the model request C:3113: preserve a meaningful no-Opus-auth fallback test
>   without real requests, using deterministic fixture config for initial selection before registration.
>   `extensions/RQW-models/test/models.test.ts` seeds `models.json` with
>   `providers.openai-codex.apiKey: faux-only` before spawning Pi. This is fixture auth, not `--model` or a production
>   fallback change. Pi 1.3.0 native-provider registration starts asynchronous availability refreshes, while
>   `findInitialModel` reads the synchronous snapshot. In a clean home with no configured auth, initial selection can
>   be empty; the agent retains `unknown/unknown` even when Codex becomes available by `session_start`. Without Opus,
>   RQW correctly preserves that initial selection, and Pi reports no API key. A clean-home CLI probe reproduced it.
>   A gated faux auth resolver reproduced both snapshot timings: without config the early selection was absent and
>   the settled selection was Codex; with config both were `openai-codex/gpt-6.1-sol`, without Anthropic auth.
>   No evidence calls for changing RQW production auth selection. The CLI regression asserts the exact fallback
>   model; a saved or explicit unlisted model is replaced as the listed-models rule above requires.
>   Offline mode and the fetch prohibition remain intact.
>   The fixture-fix report records passing model tests on macOS, Node 22.19.0, 24.21.0 and 26.7.0; the full suite passes on
>   Node 22.19.0 and 26.7.0 with 387 passed and the existing Windows-only test skipped. Twenty clean-home CLI
>   probes with the seeded config passed. The local fixture-fix report records no live requests or CI rerun.

## A-0207 · archived 2026-10-23 · Status bar · Independent extension
Status: SUPERSEDED by `[D-STATUSBAR-EXT]` ([DECISIONS.md, Status bar](DECISIONS.md#status-bar)).
Introduced: `0f356c4`, the oldest hit of ``git log -S'Independent `extensions/RQW-statusbar/`, registered in `pack' -- DECISIONS.md``.
Archived by: docs-cleanup, 2026-10-23; the commit is `git log -S'A-0207' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 1910-1914 at `30952e6`, verbatim:

> - Independent `extensions/RQW-statusbar/`, registered in `package.json` under `pi.extensions`.
>   Owner request (C:3133): «Просто нужны элементы и расположение их отображения, и всё».
>   Independent modules are required by C:3046 and the two-module request C:3113. No cross-folder imports is the
>   engineering isolation mechanism, not a literal owner quotation. The existing predecessor renderer and git helpers
>   are retained and completed. Evidence and exact row contract: `notes/statusbar-omp.md`; do not copy other omp UI.

## A-0208 · archived 2026-10-23 · Status bar · Toggle
Status: SUPERSEDED by `[D-STATUSBAR-TOGGLE]` ([DECISIONS.md, Status bar](DECISIONS.md#status-bar)).
Introduced: `0f356c4`, the oldest hit of ``git log -S'Enabled by default; `/statusbar [on|off]` toggles in the TUI' -- DECISIONS.md``.
Archived by: docs-cleanup, 2026-10-23; the commit is `git log -S'A-0208' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 1915-1918 at `30952e6`, verbatim:

> - Enabled by default; `/statusbar [on|off]` toggles in the TUI, with the bare command inverting the choice. Off restores
>   the stock editor and footer and disposes polling/subscriptions. The choice is local to the loaded extension, not persisted.
>   Reason: Pi already owns package extension enablement; no parallel settings file is needed. Print, JSON and RPC do
>   no footer work. Model and thinking are read live from Pi, regardless of the source of a change.

## A-0209 · archived 2026-10-23 · Status bar · Context limit
Status: SUPERSEDED by `[D-STATUSBAR-CONTEXT]` ([DECISIONS.md, Status bar](DECISIONS.md#status-bar)).
Introduced: `0f356c4`, the oldest hit of `git log -S'Context tokens/window come from Pi; the bar measures the eff' -- DECISIONS.md`.
Archived by: docs-cleanup, 2026-10-23; the commit is `git log -S'A-0209' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 1919-1921 at `30952e6`, verbatim:

> - Context tokens/window come from Pi; the bar measures the effective compaction threshold from Pi's own reserve
>   resolver, including a cap/rule installed independently by RQW-context. It never changes that policy. Unknown
>   post-compaction usage is `?/limit`. Reason: zero would claim a known empty context.

## A-0210 · archived 2026-10-23 · Status bar · No invented data, stock colours
Status: SUPERSEDED by `[D-STATUSBAR-SCOPE]`, `[D-STATUSBAR-ACTIVITY]` ([DECISIONS.md, Status bar](DECISIONS.md#status-bar)). Contradicted by UI port P6 (d84b541): running counts are shown and colours are own.
Introduced: `0f356c4`, the oldest hit of `git log -S'Conditional omp data without a stock Pi API is not invented:' -- DECISIONS.md`.
Archived by: docs-cleanup, 2026-10-23; the commit is `git log -S'A-0210' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 1922-1924 at `30952e6`, verbatim:

> - Conditional omp data without a stock Pi API is not invented: modes, collaboration, streaming/recording, running
>   agent/job counts and PR metadata. Limits, source citations and test samples live only in
>   `notes/statusbar-omp.md`. Colors are stock Pi semantic colors, without tuning.

## A-0211 · archived 2026-10-23 · Status bar · GPT Fast lightning
Status: SUPERSEDED by `[D-STATUSBAR-FAST]` ([DECISIONS.md, Status bar](DECISIONS.md#status-bar)).
Introduced: `fa05edf`, the oldest hit of `git log -S'GPT Fast lightning: the main chat'\''s GPT Fast state ([Setting' -- DECISIONS.md`.
Archived by: docs-cleanup, 2026-10-23; the commit is `git log -S'A-0211' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 1925-1938 at `30952e6`, verbatim:

> - GPT Fast lightning: the main chat's GPT Fast state ([Settings](#settings), «GPT Fast») shows as a bright yellow
>   lightning drawn after the model name, between the name and the thinking level, when the state is on and the current model's
>   provider is `openai-codex`; nothing otherwise. Owner: «Надо, чтобы метка фаз была в виде молнии яркой Желательно которая
>   ярко-желтая с бликом переливающимся. Можешь так сделать?» Owner on the place: «А насчёт визуализации в статус баре, где
>   модель, где глиф модели, нарисована какая-то шестерёнка или что-то такое перед названием модели, её нужно заменять будет на
>   значок молнии. Нет, лучше значок молнии пририсовывать после имени модели между моделью и резонингом. Вот так давай
>   сделаем.» The glyph before the model name stays. While the agent works a shimmer runs over the bolt (bright yellow, paler
>   yellow, white, back; 120 ms per step); idle it is a static bright yellow. The timer runs only while the agent works
>   and the lightning is shown (GPT Fast on and an `openai-codex` model), and starts or stops on `/fast-gpt` and model changes. The coordinator's description the owner accepted:
>   the shimmer runs "пока агент работает", idle it "горит ровным жёлтым". Engineering choices: the Nerd Font bolt `\uf0e7`
>   (the bar already uses Nerd Font glyphs), because U+26A1 is two cells wide in pi-tui even with VS15; own ANSI colours
>   (bold 93, 38;5;220/226/229, 97), not a theme role, so the yellow holds in every theme. The state is learned from
>   RQW-settings over `pi.events` at every render (query) and redrawn on its change event; the extension imports nothing from it.
>   Carrier: `extensions/RQW-statusbar/{render,index}.ts`; proof: `extensions/RQW-statusbar/test/fast-gpt.test.ts`.

## A-0212 · archived 2026-10-23 · Status bar · Animation cadence
Status: SUPERSEDED by `[D-STATUSBAR-ANIMATION]` ([DECISIONS.md, Status bar](DECISIONS.md#status-bar)).
Introduced: `e3b3566`, the oldest hit of `git log -S'The status animation (the busy letters, the compaction gold ' -- DECISIONS.md`.
Archived by: docs-cleanup, 2026-10-23; the commit is `git log -S'A-0212' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 1939-1959 at `30952e6`, verbatim:

> - The status animation (the busy letters, the compaction gold and sheen, the lightning) redraws every 20 ms, 50 nominal
>   frames per second, and its motion follows elapsed monotonic time, not the number of timer ticks. Owner: «Planning next
>   moves очень медленная, не плавная [...] Не ускорить, а сделать более плавной, в два раза плавнее. Здесь как будто
>   10 fps. Ее можно даже сделать еще помедленнее.» and «Я хочу, чтобы у нас всё было так же плавно ... как в UMP, и даже
>   лучше. Давай попробуем сделать 50 FPS для начала. [...] Даже можно скорость блика сделать медленнее, чтобы она шла
>   более медленно, более плавно.» Before, one 120 ms tick (8.33 Hz) advanced one phase frame; that interval came from the
>   lightning's colour step and had no recorded CPU reason. Rule: letters and sheen take one phase frame per 160 ms of
>   elapsed time, 0.75 of the former speed (letters 4.30 instead of 5.73 columns per second); between whole frames the
>   compaction sheen blends each cell toward its next colour instead of jumping a cell; the lightning keeps its accepted
>   one colour step per 120 ms. The phase is read at render time, so any of Pi's redraws shows the right position. The
>   static gold title, the input text and the effort colours do not animate. The timer runs only while an animated status
>   or the working lightning is shown, as before. While our editor owns the top border, Pi's working spinner, which that
>   border hides, gets no frames through the public `ctx.ui.setWorkingIndicator({ frames: [] })`, so its 80 ms timer stops
>   repainting; off, shutdown and reinstall restore Pi's default, and with a foreign editor it is not touched. Pi has no
>   event for another editor replacing ours, so the shimmer tick and every activity change (agent start included) check
>   the editor slot and restore Pi's default once it is not ours, hiding it again when ours returns. Pi 1.4
>   batches paints at most every 16 ms (`MIN_RENDER_INTERVAL_MS`), so 50 Hz passes through without a patch; omp, the
>   donor, runs this shimmer at 30 Hz with a 30 Hz paint cap. Cost: every paint re-renders Pi's whole component tree and
>   writes only the changed lines; CPU grows with the transcript length, and terminal, GPU, remote and visible frame rate
>   are not measured. Carrier: `extensions/RQW-statusbar/{index,render}.ts`; proof:
>   `extensions/RQW-statusbar/test/{lifecycle,chrome,fast-gpt}.test.ts`, numbers in `notes/statusbar-omp.md`.

## A-0213 · archived 2026-10-23 · Status bar · Own git discovery
Status: SUPERSEDED by `[D-STATUSBAR-GIT]` ([DECISIONS.md, Status bar](DECISIONS.md#status-bar)).
Introduced: `6b9b0b9`, the oldest hit of `git log -S'Branch and counts use the extension'\''s own repository discove' -- DECISIONS.md`.
Archived by: docs-cleanup, 2026-10-23; the commit is `git log -S'A-0213' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 1960-1964 at `30952e6`, verbatim:

> - Branch and counts use the extension's own repository discovery and asynchronous git refresh, not Pi's cached
>   `getGitBranch()`. Engineering choice for the status-bar request C:3113/C:3133: discover the repository and refresh
>   git asynchronously to handle repository replacement and branch checkout. Reason: Pi caches absent metadata when a session
>   starts outside git and does not rediscover it after init in the same cwd. Carried by `extensions/RQW-statusbar/{git,index}.ts`;
>   real-provider regression and evidence: `notes/statusbar-omp.md`.

## A-0214 · archived 2026-10-23 · Status bar · Local proof boundaries
Status: OBSOLETE; nearest active entry `[D-STATUSBAR-ANIMATION]` ([DECISIONS.md, Status bar](DECISIONS.md#status-bar)). Historical implementation-report boundary; no rule depends on it. Text in notes/decisions-evidence.md#statusbar-local-proof.
Introduced: `0f356c4`, the oldest hit of `git log -S'uses deterministic snapshots, no-re' -- DECISIONS.md`.
Archived by: docs-cleanup, 2026-10-23; the commit is `git log -S'A-0214' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 1965-1968 at `30952e6`, verbatim:

> - Local proof uses deterministic snapshots, no-request Pi library/bundle sessions, local git fixtures and a PTY
>   smoke run where available. The local implementation report records no independent agent review or live model run.
>   Windows paths are exercised locally; native Windows execution remains the existing CI job. These are proof
>   boundaries, not exceptions to the workflow's independent-review requirement.

## A-0215 · archived 2026-10-23 · Status bar · Context bar as bottom border
Status: SUPERSEDED by `[D-STATUSBAR-BOTTOM]` ([DECISIONS.md, Status bar](DECISIONS.md#status-bar)). "Working status stays embedded as in Pi's default editor" is stale since d84b541.
Introduced: `1a2adb2`, the oldest hit of `git log -S'The context bar is the bottom border of the input editor, no' -- DECISIONS.md`.
Archived by: docs-cleanup, 2026-10-23; the commit is `git log -S'A-0215' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 1969-1980 at `30952e6`, verbatim:

> - The context bar is the bottom border of the input editor, not a separate footer row; the footer keeps the model
>   and place rows. Owner: «Я бы хотел, чтобы бар контекстного окна был вместо нижней чёрточки»
>   (line 136 of `2026-10-21T12-13-54-289Z_01a15e61-dcf1-7476-b1d6-42f03584b9e6.jsonl`). Mechanism: Pi's public
>   `ctx.ui.setEditorComponent` with a `CustomEditor` subclass that overrides only `renderBottomBorder`; Pi itself
>   carries over text, border color, padding and app keys. Engineering choices: the editor's down-arrow `N more` hint for
>   hidden input lines comes first and the bar takes the rest of the width (only the hint when too narrow); the
>   working status stays embedded in the top border as in Pi's default editor; the bar keeps its own colors.
>   When another extension's editor is already installed it is kept and the bar stays the first footer row; if one
>   replaces ours later, the footer shows the row again. Off restores Pi's editor only when ours is installed.
>   Reason: the owner's layout without taking the editor slot from another extension; no Pi patch. Outside the TUI
>   nothing is installed. Carrier: `extensions/RQW-statusbar/{editor,index}.ts`, `render.ts` `editorBorder`;
>   contract and proof: `notes/statusbar-omp.md`.

## A-0216 · archived 2026-10-23 · Status bar · Session ID in the top border
Status: SUPERSEDED by `[D-STATUSBAR-TOP]` ([DECISIONS.md, Status bar](DECISIONS.md#status-bar)). Mechanism changed in d84b541: the top border is drawn by topBorder with own activity chrome; sessionTopBorder is test-only.
Introduced: `c6b642c`, the oldest hit of `git log -S'The full session ID ends the editor'\''s top border, where Pi'\''s' -- DECISIONS.md`.
Archived by: docs-cleanup, 2026-10-23; the commit is `git log -S'A-0216' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 1981-1999 at `30952e6`, verbatim:

> - The full session ID ends the editor's top border, where Pi's working status runs on the left:
>   `── <working…> ─────── <session-id> ──`, idle only rule cells before it. Owner: «Также надо знаешь, что сделать?
>   Надо добавить в status bar наш. Надо добавить status bar id сессий куда-нибудь, блядь. Можно добавить его в верхнюю
>   часть там, где working крутится, хуйня. С левой стороны сделать также вставку id сессий с пробелами: идёт чёрточка,
>   потом id, потом снова чёрточка. Прямо по левому краю. Сейчас напишу пример.
>   -- тут воркинг крутится ------ а тут ID --
>   Я бы так сделал, чтобы это было симметрично по левому краю именно, и чтобы между чёрточками и ID был какой-то
>   пробел, хотя бы по одному, чтобы можно было нормально вырезать и вставить, скопировать и вставить.»
>   He confirmed the side: «По визуальному он должен стоять справа. Я ошибся: не с левого края, а с правого края.
>   Слева working, справа ID сессии. Он прижат должен быть к правому краю, а ID к левому краю прижат. Если места нету,
>   то он и не отображается, его просто не видно.» So the working status stays at the left where Pi draws it and the
>   ID sits at the right end, mirroring Pi's `── ` frame as ` <id> ──`; without room it is not shown at all.
>   Engineering choices: the ID is Pi's `sessionManager.getSessionId()`, read on every render; exactly one
>   plain space on each side and one uninterrupted muted-colored run, so a terminal selection copies it whole; when Pi's
>   own top border (status, retry/compaction status, the up-arrow `N more` hint) would lose text or its trailing rule
>   at the reduced width, the ID is dropped whole instead of cut and Pi's border is unchanged. With the bar off or a
>   foreign editor in place there is no ID. Reason: the owner's layout and copyable ID without ever degrading Pi's
>   status. Carrier: `extensions/RQW-statusbar/editor.ts` `renderTopBorder`, `render.ts` `sessionTopBorder`,
>   `index.ts`; contract and proof: `notes/statusbar-omp.md`.

## A-0217 · archived 2026-10-23 · Status bar · Tokens per second
Status: SUPERSEDED by `[D-STATUSBAR-RATE]` ([DECISIONS.md, Status bar](DECISIONS.md#status-bar)). Option texts not found in the Pi sessions; relabelled coordinator option text.
Introduced: `2f5be5b`, the oldest hit of `git log -S'Tokens per second are the provider'\''s exact output tokens ove' -- DECISIONS.md`.
Archived by: docs-cleanup, 2026-10-23; the commit is `git log -S'A-0217' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 2000-2015 at `30952e6`, verbatim:

> - Tokens per second are the provider's exact output tokens over Pi's own response time, not a live estimate. The
>   owner saw `cmp 0 · 44000.0 tok/s` (44 tokens over 1 ms of handler time). Owner: «Смотри, токены в секунду какую-то хуйню показывают.
>   Надо как-то привести, чтобы токены в секунду очень хорошо и качественно работали. [...] И по-хорошему, надо
>   сделать так, чтобы токены в секунду были залайнены на те показатели, которые отдаёт провайдер, Anthropic либо
>   Codex Legacy.» Of his two options he chose: «a) Делим точное число выходных токенов от провайдера на время ответа.
>   Время Pi сам меряет точными часами от начала запроса. Ответы короче полсекунды не учитываем. Значение обновляется
>   после каждого ответа.» and «Значение обновляется после каждого ответа и держится до следующего.» Rule:
>   `usage.output * 1000 / durationMs` per completed assistant message of the main session; `durationMs` is the
>   monotonic time Pi's stream measures from the request start. A message with missing or non-positive `output` or
>   `durationMs`, `durationMs` under 500 ms, or `stopReason` `aborted` or `error` is skipped (the output count of an
>   interrupted response can be incomplete; engineering choice); no chars/4 fallback and no live value while streaming;
>   the last qualified value is held until the next, nothing is shown before the first, and session start, tree change
>   and toggle reset it. Engineering choices: `usage.output` already includes reasoning tokens, so `usage.reasoning`
>   is not added. Reason: neither Anthropic nor Codex returns a tokens-per-second field, so the exact billed count over Pi's own clock is the closest provider-aligned
>   number. Carrier: `extensions/RQW-statusbar/{render,index}.ts` `RateMeter`; contract and proof:
>   `notes/statusbar-omp.md`.

## A-0218 · archived 2026-10-23 · Anthropic package integration · Package integration
Status: SUPERSEDED by `[D-ANTHROPIC-PKG]` ([DECISIONS.md, Anthropic package integration](DECISIONS.md#anthropic-package-integration)). "Eight existing extensions" framing updated to the 14-entry manifest.
Introduced: `071df1e`, the oldest hit of `git log -S'Coordinator integration brief (C:3376), not a direct owner q' -- DECISIONS.md`.
Archived by: docs-cleanup, 2026-10-23; the commit is `git log -S'A-0218' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 2019-2027 at `30952e6`, verbatim:

> - Coordinator integration brief (C:3376), not a direct owner quotation: integrate RQW-anthropic with the eight
>   existing extensions and use authenticated fake allowed providers without weakening isolation assertions.
>   Underlying owner requests: adapter C:3133, provider visibility C:3171, independent modules C:3046. The manifest keeps the eight main extensions
>   followed by RQW-anthropic. Package fixtures use fake authenticated allowed providers, not a visibility
>   bypass. The dynamic isolation assertions are unchanged. Source order, unauthenticated startup,
>   Opus medium with mock secrets, full-package login visibility and the stock fallback with the adapter or
>   RQW-models switched off, and each of RQW-anthropic and RQW-providers switched off alone, are covered in
>   `test/anthropic-models.test.ts`. Semantic test changes for independent review and
>   offline proof boundaries: `notes/anthropic-integration.md`.

## A-0219 · archived 2026-10-23 · Anthropic package integration · Integration proof and campaign pause
Status: MERGED into `[D-ANTHROPIC-PROOF]` ([DECISIONS.md, Anthropic package integration](DECISIONS.md#anthropic-package-integration)).
Introduced: `071df1e`, the oldest hit of `git log -S'Integration proof uses offline fixtures only; it does not es' -- DECISIONS.md`.
Archived by: docs-cleanup, 2026-10-23; the commit is `git log -S'A-0219' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 2028-2030 at `30952e6`, verbatim:

> - Integration proof uses offline fixtures only; it does not establish live auth, subscription acceptance or billing.
>   The owner's old Claude campaign pause C:3244 remains in force, not a ban on Claude workers. Historical local results and their boundaries are recorded in
>   `notes/anthropic-integration.md`, not a standing prohibition on independent review or normal branch delivery.

## A-0220 · archived 2026-10-23 · Scroll · Escape jumps down
Status: SUPERSEDED by `[D-SCROLL-ESC]` ([DECISIONS.md, Scroll](DECISIONS.md#scroll)).
Introduced: `72873eb`, the oldest hit of `git log -S'Escape in Pi'\''s fullscreen (alt-screen) view returns a scroll' -- DECISIONS.md`.
Archived by: docs-cleanup, 2026-10-23; the commit is `git log -S'A-0220' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 2034-2043 at `30952e6`, verbatim:

> - Escape in Pi's fullscreen (alt-screen) view returns a scrolled-up transcript to the latest message, as in Codex.
>   Owner (`2026-10-21T12-13-54-289Z_01a15e61-dcf1-7476-b1d6-42f03584b9e6.jsonl` line 53): «Да, я также бы хотел
>   перенастроить хоткеи, чтобы когда я скролю, jump to last message было на Escape»; line 77: «Хотя бы должен быть
>   какой-то адекватный хоткей, который будет перехватываться всеми браузерами нормально. И чтобы он не конфликтовал с
>   другими хоткеями.» In `2026-10-21T16-27-59-062Z_01a15f4a-7ad5-7377-81be-0baf3b6ffa33.jsonl` the question batch
>   (line 78) offered 1a: Escape jumps down only when scrolled up, at the bottom Escape stays as before, Ctrl+End stays,
>   an open transcript search takes the first Escape. The owner chose it (line 100): «Сделай Escape просто, что когда я
>   открыл вверх, я Escape нажимаю, как в кодексе. В кодексе ты когда scroll вверх делаешь, нажимаешь Escape, и он тебя
>   возвращает в самый низ чата. Так же сделай». Package behavior for every my-pi user (2a, not the personal
>   `keybindings.json`) is the batch's stated default for an unanswered question, and option 1a requires it.

## A-0221 · archived 2026-10-23 · Scroll · Own extension
Status: SUPERSEDED by `[D-SCROLL-EXT]` ([DECISIONS.md, Scroll](DECISIONS.md#scroll)). "RQW-statusbar is being changed by separate work" is done.
Introduced: `72873eb`, the oldest hit of ``git log -S'Carrier: `extensions/RQW-scroll/index.ts`, its own extension' -- DECISIONS.md``.
Archived by: docs-cleanup, 2026-10-23; the commit is `git log -S'A-0221' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 2044-2047 at `30952e6`, verbatim:

> - Carrier: `extensions/RQW-scroll/index.ts`, its own extension, listed in `package.json` `pi.extensions`; switched off
>   alone like every `RQW-*` extension ([INSTALL.md](INSTALL.md#switch-one-extension-off), [Isolation](#isolation)).
>   Reason for a new folder: the behavior belongs to no existing extension, and `RQW-statusbar` is being changed by
>   separate work.

## A-0222 · archived 2026-10-23 · Scroll · Input listener
Status: SUPERSEDED by `[D-SCROLL-MECH]` ([DECISIONS.md, Scroll](DECISIONS.md#scroll)).
Introduced: `72873eb`, the oldest hit of ``git log -S'Mechanism (engineering choice). Binding `escape` to Pi'\''s `tu' -- DECISIONS.md``.
Archived by: docs-cleanup, 2026-10-23; the commit is `git log -S'A-0222' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 2048-2059 at `30952e6`, verbatim:

> - Mechanism (engineering choice). Binding `escape` to Pi's `tui.altScreen.bottom` is rejected: Pi's viewport consumes
>   that key even at the bottom, so Escape would no longer interrupt. Instead the extension adds a terminal input
>   listener (`ctx.ui.onTerminalInput`). Pi runs the alt-screen viewport listener first, so its own keys (search close,
>   Ctrl+End, paging) keep priority; the extension listener sees Escape before the focused component. It consumes a
>   press only when all hold: the renderer is `fullscreen`; the transcript does not follow its end (`isFollowingOutput`
>   false, exactly when Pi shows "Jump to latest message"); the focused component is Pi's main editor (a
>   `CustomEditor`, detected by its `actionHandlers` map the way Pi does) without an open autocomplete list. It then calls
>   the renderer's `scrollToBottom()`. Otherwise Escape is untouched: at the bottom it interrupts, double-Escape and every
>   other stock meaning stay; selectors in the editor slot, dialogs, focused overlays and the autocomplete list keep
>   their own Escape; inline mode and print, JSON and RPC modes are unchanged. The TUI is reached through the public
>   widget factory (a `belowEditor` widget that renders no line), which receives Pi's proxy to the current renderer, so
>   a switch between inline and fullscreen is followed. Key releases are not consumed.

## A-0223 · archived 2026-10-23 · Scroll · Hint shows Esc
Status: SUPERSEDED by `[D-SCROLL-HINT]` ([DECISIONS.md, Scroll](DECISIONS.md#scroll)).
Introduced: `8c29ff8`, the oldest hit of ``git log -S'The fullscreen hint includes `Esc` alongside the configured ' -- DECISIONS.md``.
Archived by: docs-cleanup, 2026-10-23; the commit is `git log -S'A-0223' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 2060-2067 at `30952e6`, verbatim:

> - The fullscreen hint includes `Esc` alongside the configured bottom keys (by default `Esc/Ctrl+End`) when Escape
>   can jump. Owner: «Нашел баг: не Escape мы возвращаемся уже, а в надписи написано старый hotkey.» Reason: the hint
>   must advertise the extension's Escape behavior, not just Pi's stock shortcut. Engineering choice and carrier:
>   `extensions/RQW-scroll/index.ts` replaces the public `getKeybindings`/`setKeybindings` registry with a display
>   facade. Only `getKeys("tui.altScreen.bottom")` is decorated, and only while Escape can jump; matching and all
>   configuration operations delegate to the unchanged manager. Pi formats those keys itself; no renderer patch,
>   fork, private hint-field write or Escape binding is needed. Shutdown deactivates the facade and restores the
>   prior registry if it still owns the slot; another registry replacement is not overwritten.

## A-0224 · archived 2026-10-23 · Scroll · Limits
Status: SUPERSEDED by `[D-SCROLL-LIMITS]` ([DECISIONS.md, Scroll](DECISIONS.md#scroll)).
Introduced: `72873eb`, the oldest hit of ``git log -S'stomEditor` gets stock Escape. With search op' -- DECISIONS.md``.
Archived by: docs-cleanup, 2026-10-23; the commit is `git log -S'A-0224' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 2068-2070 at `30952e6`, verbatim:

> - Limits: a custom editor that does not extend `CustomEditor` gets stock Escape. With search open, the first Escape
>   closes search and the second jumps down. Pi's keybinding registry is process-global; the display facade follows
>   its owning interactive renderer, as does Pi's own registry.

## A-0225 · archived 2026-10-23 · Scroll · Proof
Status: SUPERSEDED by `[D-SCROLL-TESTS]` ([DECISIONS.md, Scroll](DECISIONS.md#scroll)). Local PTY probe sentence moved to notes/decisions-evidence.md#scroll-pty-probe.
Introduced: `72873eb`, the oldest hit of ``git log -S'Proof: `extensions/RQW-scroll/test/scroll.test.ts` (in `npm ' -- DECISIONS.md``.
Archived by: docs-cleanup, 2026-10-23; the commit is `git log -S'A-0225' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 2071-2080 at `30952e6`, verbatim:

> - Proof: `extensions/RQW-scroll/test/scroll.test.ts` (in `npm test`), with Pi's real renderers and proxy
>   (`createInteractiveTui`, `createInteractiveTuiReference`), chat viewport, `CustomEditor`,
>   `ExtensionSelectorComponent`, overlay and transcript search, the extension loaded by Pi's resource loader and keys fed
>   through the terminal input callback: scrolled up, Escape jumps and is consumed, the next Escape interrupts; at the
>   bottom Escape interrupts; Ctrl+End still jumps; selector, overlay, autocomplete and search keep their Escape; inline
>   mode, the extension not loaded and after `session_shutdown` give stock Escape. Real fullscreen screen lines
>   prove the hint includes `Esc`, retains configured bottom keys, and is stock without the extension and after
>   shutdown; direct registry assertions prove Escape is not bound and the original manager is unchanged. A local PTY probe of the real CLI in
>   fullscreen with `doubleEscapeAction: fork` confirmed the InteractiveMode wiring: scrolled up, a quick Escape pair
>   jumped down without the fork notice; the next pair at the bottom showed it.

## A-0226 · archived 2026-10-23 · Session commands · /copy-session and /remove
Status: SUPERSEDED by `[D-SESSION-COMMANDS]` ([DECISIONS.md, Session commands](DECISIONS.md#session-commands)).
Introduced: `db5ab64`, the oldest hit of `git log -S'Owner: «И по-хорошему надо какую-нибудь команду вбить, типа ' -- DECISIONS.md`.
Archived by: docs-cleanup, 2026-10-23; the commit is `git log -S'A-0226' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 2084-2091 at `30952e6`, verbatim:

> - Owner: «И по-хорошему надо какую-нибудь команду вбить, типа COPY SESSION ID. И надо ещё добавить команду remove сессии, как в кодексе, чтобы можно было написать /remove и удалить полностью эту сессию со всей историей, со всей хуйнёй, которая с ней связана.
> Как будто нахуй ее и не было»
>   Carrier: `extensions/RQW-session/{index,artifacts}.ts`, listed independently in `package.json`.
>   Reason: make session IDs usable without selecting terminal text and provide explicit permanent local deletion.
>   `/copy-session` avoids Pi's built-in `/copy` collision and calls Pi's exported clipboard implementation unchanged;
>   `/remove` uses one `ctx.ui.select`, refuses without UI, and uses `ctx.newSession({withSession})` before deletion
>   so old writers and shutdown hooks finish and notifications use a fresh context. Detailed cleanup and clipboard
>   contract: `extensions/RQW-session/README.md`; no statusbar change in this extension.

## A-0227 · archived 2026-10-23 · Session commands · /copy-session spelling
Status: MERGED into `[D-SESSION-COMMANDS]` ([DECISIONS.md, Session commands](DECISIONS.md#session-commands)).
Introduced: `db5ab64`, the oldest hit of `git log -S'Owner: «Просто надо сделать /copy session команду, чтобы я м' -- DECISIONS.md`.
Archived by: docs-cleanup, 2026-10-23; the commit is `git log -S'A-0227' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 2092-2094 at `30952e6`, verbatim:

> - Owner: «Просто надо сделать /copy session команду, чтобы я мог её просто скопировать в буфер обмена и всё.»
>   Carrier: `extensions/RQW-session/index.ts`; coordinator-specified slash spelling: `/copy-session`.
>   Reason: expose one direct session-copy command while leaving stock `/copy` intact.

## A-0228 · archived 2026-10-23 · Session commands · Confirmation dialog
Status: SUPERSEDED by `[D-SESSION-CONFIRM]` ([DECISIONS.md, Session commands](DECISIONS.md#session-commands)). Pi 1.3.0 wording updated to 1.4.0.
Introduced: `db5ab64`, the oldest hit of `git log -S'Owner: «После remove сессия удаляется, но совсем, полностью ' -- DECISIONS.md`.
Archived by: docs-cleanup, 2026-10-23; the commit is `git log -S'A-0228' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 2095-2099 at `30952e6`, verbatim:

> - Owner: «После remove сессия удаляется, но совсем, полностью без корзины, и сразу открывается новая пустая сессия, как ты предложил. Потом подтверждение удалению один раз. Просто на экране поднять визуально, как в кодексе открыть диалог с вопросом «да/нет?». Циферка один по дефолту — нет, по не дефолту — да. То есть циферка один — нет, циферка два — да. И мне, чтобы удалить, надо нажать стрелочку вниз и Enter. Это если у тебя есть SDK для того, чтобы такие диалоги открывать.»
>   Carrier: `extensions/RQW-session/index.ts`, Pi's public `ctx.ui.select`; exact dialog contract is in the extension
>   README. Reason: default to refusal, require an affirmative selection, and use native keyboard behavior rather than
>   custom key handling. Pi 1.3.0's `ExtensionSelectorComponent` starts at index 0; deterministic tests feed Enter,
>   Escape and Down then Enter through that real component and the command handler.

## A-0229 · archived 2026-10-23 · Session commands · Deletion scope
Status: SUPERSEDED by `[D-SESSION-SCOPE]` ([DECISIONS.md, Session commands](DECISIONS.md#session-commands)).
Introduced: `db5ab64`, the oldest hit of `git log -S'Coordinator-approved scope, not a verbatim owner quotation: ' -- DECISIONS.md`.
Archived by: docs-cleanup, 2026-10-23; the commit is `git log -S'A-0229' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 2100-2108 at `30952e6`, verbatim:

> - Coordinator-approved scope, not a verbatim owner quotation: delete the current JSONL plus referenced artifact files
>   not referenced by other sessions, preserving user forks and shared artifacts. Artifact deletion is restricted to
>   Pi-generated basenames inside OS temp, never arbitrary `fullOutputPath` values. The agent directory is only a session
>   validation/discovery root, not an additional artifact root. No symlink escape, directories or unrelated files;
>   JSONL outside the agent directory is refused. No ownership tracking or edits to RQW-agent/RQW-review. Pi's randomly named unreferenced temp files,
>   including in-memory subagent/reviewer spills, are not attributable and remain for OS temp cleanup. This is an explicit
>   limitation, not a claim of complete erasure of every byte Pi ever produced. Reason: no safe session ownership map
>   exists for those files; wildcard temp deletion would destroy unrelated session data. Mechanism and limits live in the
>   extension README. `test/isolation.test.ts` includes the extension automatically through the manifest.

## A-0230 · archived 2026-10-23 · Session commands · Safe scan
Status: SUPERSEDED by `[D-SESSION-SCAN]` ([DECISIONS.md, Session commands](DECISIONS.md#session-commands)).
Introduced: `db5ab64`, the oldest hit of ``git log -S'Accepted code-review fixes: `extensions/RQW-session/artifact' -- DECISIONS.md``.
Archived by: docs-cleanup, 2026-10-23; the commit is `git log -S'A-0230' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 2109-2115 at `30952e6`, verbatim:

> - Accepted code-review fixes: `extensions/RQW-session/artifacts.ts` preflights other sessions before replacement,
>   so read/discovery errors leave the current session active and identify the offending file. Malformed JSONL lines
>   are tolerated like Pi; their raw text is scanned conservatively with JSON escapes decoded to protect shared paths.
>   Each string/line is normalized once in a streamed asynchronous scan with one combined path search; canonical
>   identity sets replace the artifact-by-alias transcript rescans. The final outgoing JSONL is read after shutdown.
>   Reason: avoid credential/unrelated-file deletion, support interrupted session tails and keep long scans responsive.
>   Generated-name rules, precise cleanup boundary and failure behavior live in `extensions/RQW-session/README.md`.

## A-0231 · archived 2026-10-23 · Session commands · Pi 1.4.0 research
Status: OBSOLETE; nearest active entry `[D-SESSION-SCAN]` ([DECISIONS.md, Session commands](DECISIONS.md#session-commands)). Research evidence only; text in notes/decisions-evidence.md#session-research.
Introduced: `db5ab64`, the oldest hit of ``git log -S'.0 research: `dist/utils/output-files.js` creates random-nam' -- DECISIONS.md``.
Archived by: docs-cleanup, 2026-10-23; the commit is `git log -S'A-0231' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 2116-2121 at `30952e6`, verbatim:

> - Pi 1.4.0 research: `dist/utils/output-files.js` creates random-named OS-temp outputs with no session ID;
>   `dist/core/session-manager.js` stores names/labels/history in JSONL and discovers recent files by mtime;
>   `dist/modes/interactive/components/session-selector.js` tries `trash` then unlink, which does not meet permanent-delete
>   semantics. RQW-agent and RQW-review create in-memory child sessions; RQW-statusbar has no per-session persistence;
>   RQW-anthropic's install ID is global, not deletable session data. Pi's `dist/utils/clipboard.js` uses native/clip on
>   Windows and emits OSC 52 for remote markers or `PI_CLIPBOARD_OSC52=1`, not simply because VS Code is present.

## A-0232 · archived 2026-10-23 · Session commands · Codex delete_thread comparison
Status: OBSOLETE; nearest active entry `[D-SESSION-SCAN]` ([DECISIONS.md, Session commands](DECISIONS.md#session-commands)). Comparison only; text in notes/decisions-evidence.md#session-research.
Introduced: `db5ab64`, the oldest hit of ``git log -S'Codex comparison, read-only `codex-harness` `upstream/main`,' -- DECISIONS.md``.
Archived by: docs-cleanup, 2026-10-23; the commit is `git log -S'A-0232' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 2122-2126 at `30952e6`, verbatim:

> - Codex comparison, read-only `codex-harness` `upstream/main`,
>   `codex-rs/thread-store/src/local/delete_thread.rs`: hard deletion stops writers, removes active/archived plain and
>   compressed rollouts, materialized history, name-index entries and state rows, and invokes host-data cleanup.
>   It refuses external fork-history references. Pi has no equivalent database or reference-index sidecars; this extension
>   preserves Pi's independent fork JSONLs and shared referenced files instead. These are different storage models.

## A-0233 · archived 2026-10-23 · Session commands · Proof
Status: SUPERSEDED by `[D-SESSION-TESTS]` ([DECISIONS.md, Session commands](DECISIONS.md#session-commands)).
Introduced: `db5ab64`, the oldest hit of ``git log -S'Deterministic proof: `extensions/RQW-session/test/session.te' -- DECISIONS.md``.
Archived by: docs-cleanup, 2026-10-23; the commit is `git log -S'A-0233' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 2127-2129 at `30952e6`, verbatim:

> - Deterministic proof: `extensions/RQW-session/test/session.test.ts` uses temp agent directories and a stub clipboard,
>   confirms refusal paths, artifact/fork preservation and path safety, and replaces a real Pi runtime before deleting
>   its old JSONL. This proves mechanics, not live VDI clipboard redirection, forensic erasure or remote-provider deletion.

## A-0234 · archived 2026-10-23 · Send now · Enter sends queued steering
Status: SUPERSEDED by `[D-SENDNOW-ENTER]` ([DECISIONS.md, Send now](DECISIONS.md#send-now)).
Introduced: `d1f8b16`, the oldest hit of `git log -S'Enter force-sends queued steering, as in oh-my-pi. Owner: «А' -- DECISIONS.md`.
Archived by: docs-cleanup, 2026-10-23; the commit is `git log -S'A-0234' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 2133-2142 at `30952e6`, verbatim:

> - Enter force-sends queued steering, as in oh-my-pi. Owner: «А ещё надо, чтобы у нас работала, как в OMP, Oh My Pie,
>   отправка: я пишу сообщение, оно стоит в очереди на стекинг, и чтобы я мог через Enter его насильно отправить. Я не
>   разобрался, как в Pi это сделать.»; «Мне надо, чтобы в Py я мог нажать Enter и сообщение ушло, чтобы не нажимать
>   ебучие Escape, Enter. Это какой-то рак мозга, мне кажется. Надо проверить, можем мы сделать это или нет. Если
>   можем, надо сделать». Agreed behavior (coordinator brief, not a literal quote): while the agent works, Enter with
>   text queues steering as stock Pi does; Enter on an empty editor while steering is queued interrupts the turn and
>   sends the queue at once; with nothing queued empty Enter does nothing; no other key changes.
>   Reason: stock Pi 1.4.0 needs Escape (which moves the queue back into the editor and aborts) and then Enter.
>   Carrier: independent `extensions/RQW-send-now/index.ts`, listed in `package.json` `pi.extensions`, switchable off
>   alone ([Isolation](#isolation)). Behavior, mechanism and limits: `extensions/RQW-send-now/README.md`.

## A-0235 · archived 2026-10-23 · Send now · Public API only
Status: SUPERSEDED by `[D-SENDNOW-API]` ([DECISIONS.md, Send now](DECISIONS.md#send-now)).
Introduced: `d1f8b16`, the oldest hit of `git log -S'Engineering choices within that outcome: public Pi API only ' -- DECISIONS.md`.
Archived by: docs-cleanup, 2026-10-23; the commit is `git log -S'A-0235' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 2143-2152 at `30952e6`, verbatim:

> - Engineering choices within that outcome: public Pi API only (`ctx.ui.onTerminalInput`, `ctx.abort`, editor
>   text, `pi.sendUserMessage`), no custom editor, since RQW-statusbar owns `setEditorComponent`. The key is Pi's
>   configured `tui.input.submit`. Only Pi's input editor (`CustomEditor` or a subclass) with focus triggers it, so
>   dialogs, selectors and overlays keep their Enter. Steering is told apart from follow-ups by counting `input`
>   events, because Pi exposes only "anything queued"; inputs still on their way to Pi's queue (until the next
>   event-loop turn) and a run's own starting prompt are accounted for, and anything left in Pi's queue after the
>   abort is sent, or restored to the editor if the session ends first; a follow-up-only queue is left to Pi, as
>   oh-my-pi does not resume one after an interrupt. Unsent text returns to the editor when no model is selected or
>   the session ends before the interrupted run settles. Counting stays because the public extension context reports
>   only whether anything is queued, not the steering and follow-up queues themselves.

## A-0236 · archived 2026-10-23 · Send now · Interrupted reply kept
Status: SUPERSEDED by `[D-SENDNOW-REPLAY]` ([DECISIONS.md, Send now](DECISIONS.md#send-now)).
Introduced: `d1f8b16`, the oldest hit of `git log -S'Closer oh-my-pi parity, taken because it is small and public' -- DECISIONS.md`.
Archived by: docs-cleanup, 2026-10-23; the commit is `git log -S'A-0236' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 2153-2157 at `30952e6`, verbatim:

> - Closer oh-my-pi parity, taken because it is small and public: Pi's pi-ai drops an aborted reply from the next
>   request, oh-my-pi keeps it. For the reply a force-send interrupts, a `context_with_system` handler replays its
>   text as a finished reply; a session custom entry `rqw-send-now` keeps that across resume and `/reload`. Thinking
>   and unfinished tool calls of that reply are dropped. No completed tool results are at stake: Pi runs tools only
>   after a reply completes, and an abort during tool execution keeps the reply and its results.

## A-0237 · archived 2026-10-23 · Send now · Limits and proof
Status: SUPERSEDED by `[D-SENDNOW-LIMITS]` ([DECISIONS.md, Send now](DECISIONS.md#send-now)).
Introduced: `d1f8b16`, the oldest hit of `git log -S'Limits (details in the README): several queued messages, fol' -- DECISIONS.md`.
Archived by: docs-cleanup, 2026-10-23; the commit is `git log -S'A-0237' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 2158-2163 at `30952e6`, verbatim:

> - Limits (details in the README): several queued messages, follow-ups queued with them included, go as one
>   message joined by blank lines; Pi's queue restore is text only, so images an extension attached to steering and
>   custom messages in Pi's agent queue are dropped as with Escape; a steering input swallowed by another
>   extension's `input` handler can leave the count stale until the queue empties. Proof: Pi's real `InteractiveMode`
>   on a scripted terminal with a faux streaming model, `extensions/RQW-send-now/test/send-now.test.ts`, in `npm test`
>   and the Windows CI matrix.

## A-0238 · archived 2026-10-23 · Providers · Own extension
Status: SUPERSEDED by `[D-PROVIDERS-EXT]` ([DECISIONS.md, Providers](DECISIONS.md#providers)). Coordinator question text labelled as such.
Introduced: `2bf5eac`, the oldest hit of `git log -S'Provider hiding is its own extension. Owner question, answer' -- DECISIONS.md`.
Archived by: docs-cleanup, 2026-10-23; the commit is `git log -S'A-0238' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 2167-2173 at `30952e6`, verbatim:

> - Provider hiding is its own extension. Owner question, answer «7a»: «Скрытие лишних провайдеров.
>   Сейчас его делает расширение Anthropic. Если его выключить, скрытие пропадёт. a) Вынести скрытие в отдельное
>   расширение». Reason: hiding the other providers is a policy of its own (the visible set is the owner's rule from
>   [Anthropic subscription adapter](#anthropic-subscription-adapter), C:3171 and the `openai` clarification there) and
>   must not vanish when the Anthropic transport is switched off; switching either off alone is the rule of
>   [Isolation](#isolation).
>   Carrier: `extensions/RQW-providers/index.ts`, listed last in `package.json` `pi.extensions`.

## A-0239 · archived 2026-10-23 · Providers · Visible providers
Status: SUPERSEDED by `[D-PROVIDERS-ALLOW]` ([DECISIONS.md, Providers](DECISIONS.md#providers)). Migration wording removed; auth boundary now also in auth-boundary.ts.
Introduced: `2bf5eac`, the oldest hit of ``git log -S'Same behaviour as before, now with its own tests (`extension' -- DECISIONS.md``.
Archived by: docs-cleanup, 2026-10-23; the commit is `git log -S'A-0239' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 2174-2178 at `30952e6`, verbatim:

> - Same behaviour as before, now with its own tests (`extensions/RQW-providers/test/providers.test.ts`): only `anthropic`
>   and `openai-codex` in login, pickers, `--list-models` and scoped models; credentials stay; the policy covers only a
>   runtime with an owning session of this extension, so loading alone or an unrelated runtime keeps Pi's lists. The
>   Anthropic extension keeps only the transport: `registration.ts` (conflict guard, credential-store binding and request
>   auth boundary), recovery, cache. It no longer filters anything, so with only `RQW-anthropic` on, Pi lists every provider.

## A-0240 · archived 2026-10-23 · Providers · Binding and order
Status: SUPERSEDED by `[D-PROVIDERS-BIND]` ([DECISIONS.md, Providers](DECISIONS.md#providers)).
Introduced: `2bf5eac`, the oldest hit of ``git log -S'Engineering choices: ownership comes from the patched `Agent' -- DECISIONS.md``.
Archived by: docs-cleanup, 2026-10-23; the commit is `git log -S'A-0240' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 2179-2185 at `30952e6`, verbatim:

> - Engineering choices: ownership comes from the patched `AgentSession._bindExtensionCore`, because Pi emits no event
>   before `--list-models` and `/reload` of a host without bindings emits no `session_start`; liveness is read from Pi's
>   extension API going stale, and the patched `AgentSession.dispose` releases the disposed session's instances. Both
>   extensions wrap `_bindExtensionCore` and `dispose`, and `RQW-anthropic`'s lifecycle restores Pi's own methods when its
>   last owner leaves, so each load of this extension checks its wrapper is still in the slots and wraps again if not
>   (`test/providers-anthropic.test.ts`). Pi's restore is last-in-first-out, so the manifest keeps this extension after
>   `RQW-anthropic`, and an inert wrapper may stay in the other order (limits: `extensions/RQW-providers/README.md`). Mechanism research: `notes/anthropic-adapter.md`.

## A-0241 · archived 2026-10-23 · Agent · Title and explorer with git-guarded read-only tools
Status: SUPERSEDED by `[D-AGENT-EXPLORE-TOOLS]` ([DECISIONS.md, Agent](DECISIONS.md#agent)); `[D-AGENT-TITLE-EXPLORE]` stays for `title` and now points to it.
Introduced: `c86e9bb`, as `Since:` in the entry.
Archived by: the explore-cursor change; the commit is `git log -S'A-0241' -- DECISIONS-ARCHIVE.md`.
Original DECISIONS.md lines 585-588 at `3430f32`, verbatim:

> - **Title and explorer** `[D-AGENT-TITLE-EXPLORE]`. Optional `title` on start/restart appears in status, `results[i].display.title` and message `details.title`; delivered text keeps its `[agent#N]` form. Card rendering in `RQW-agent-ui` belongs to a pending branch, not main; see [BACKLOG](BACKLOG.md). `explore` on agent start selects a read-only search leaf on the caller's model with the main prompt, a short role and thoroughness `quick`, `medium` or `very thorough`; it exposes read/grep/find and git-guarded bash, not edit/write, and takes no custom system/role/model/tools or prompt-file overrides.
>   Coordinator text: the explorer option reuses the existing runtime rather than adding a tool.
>   Reason: retain compact metadata and a read-only search mode without another lifecycle implementation.
>   Carrier: `extensions/RQW-agent/index.ts`, `extensions/RQW-agent/prompt.ts`, `extensions/RQW-agent/git-guard.ts`. Since: `c86e9bb`.


## A-0242 · archived 2026-10-23 · Work policy · Replaced coordinator rule

Status: SUPERSEDED by `[D-WORK-EXECUTOR-ROLE]` (DECISIONS.md#work-policy).
Source tree: `cbcdde0`; introducing commits are retained in the verbatim entry.
Archived by: process-rules-oct23 squash.

> - **Executor role** `[D-WORK-EXECUTOR-ROLE]`. When the owner tells Main to do something, Main starts a subagent that does
>   it. Owner (`16-27-59:4025`, `16-27-59:4034`):
>   «Когда я говорю, что ты должен что-то сделать буквально, это значит, что ты должен поднять саб-агента, который это сделает. Не забывай свою роль и запиши это, зафиксируй, чтобы больше так не наёбываться.»
>   «Я всегда с тобой разговариваю так, как будто ты и есть мой исполнитель. Потому что для меня ты исполнитель, но ты сам работаешь в рамках роли, которая тебе назначена. И ты должен это помнить, и ты должен этому следовать всегда. Ты не должен никогда от этого отклоняться. Понял? Это супер важно.»
>   Reason: asked to arbitrate judge disputes himself, the coordinator once read run files in its own thread.
>   Carrier: [PROCESS.md, Isolated parallel execution](PROCESS.md#isolated-parallel-execution). Since: `30952e6`.


## A-0243 · archived 2026-10-23 · Work policy · Replaced coordinator rule

Status: SUPERSEDED by `[D-WORK-PARALLEL]` (DECISIONS.md#work-policy).
Source tree: `cbcdde0`; introducing commits are retained in the verbatim entry.
Archived by: process-rules-oct23 squash.

> - **Non-blocking coordinator and parallel limit** `[D-WORK-PARALLEL]`. Main never blocks its own thread on waits,
>   polling, CI watching, test runs or other long work; subagents do it. At most 10 first-level subagents run in parallel;
>   nested ones do not count; a ceiling, not a quota. Owner (`16-27-59:2462`):
>   «Одновременно до 10 первого уровня, вложенные похуй»
>   Reason: Main stays free to coordinate and talk to the owner.
>   Carriers: [PROCESS.md, Isolated parallel execution](PROCESS.md#isolated-parallel-execution) and a short line in
>   `AGENTS.md`; the product prompt `extensions/RQW-prompt/SYSTEM.md` does not carry it. Since: `47868b0`; limit 10 since `57fa3ff`.
>   Historical parallel-limit source: `DECISIONS-ARCHIVE.md`, A-0003, USER entry at session line 2462.

## A-0244 · archived 2026-10-24 · Work policy · Completeness check after every merge

Status: SUPERSEDED by `[D-PIPELINE-COMPLETENESS]` ([DECISIONS.md, Task pipeline](DECISIONS.md#task-pipeline)).
Introduced: `47868b0`. Source tree: `b0b3672`, lines 251-256, verbatim.
Archived by: the process-pipeline change; the commit is `git log -S'A-0244' -- DECISIONS-ARCHIVE.md`.

> - **Completeness check after every merge** `[D-WORK-COMPLETENESS]`. Owner (`16-27-59:593`):
>   «А у тебя есть встроенный процесс, который перепроверяет, что нигде ничего не забыто? То, что я выше озвучивал про то, что у нас работа хуёво делается, и должна быть независимая перепроверка, что каждый влитый pull request действительно соответствует истине, что там всё заебись. Ты, по-моему, уже на эту хуйню решение придумал. У меня вопрос: оно уже работает или нет?»
>   Coordinator text, the approved proposal: "a) После каждого слияния и перед итоговым отчётом свежий независимый ревьюер получает все твои сообщения из сессии и историю main. По каждой просьбе он отмечает: сделано и каким коммитом, в работе или ты её отменил. Если у просьбы нет ни одной отметки, это находка. Правило записываю в PROCESS.md."
>   Owner (`16-27-59:599`): «Да, один по проверке, что ничего не забыто»
>   Reason: a request can be dropped silently between sessions, merges and reports. Carrier:
>   [PROCESS.md, Delivery](PROCESS.md#delivery) step 5. Since: `47868b0`.

## A-0245 · archived 2026-10-24 · Quality control · Awareness without a permanent process

Status: SUPERSEDED by the updated `[D-QA-STATUS]` and `[D-PIPELINE-CI-WATCHER]` ([DECISIONS.md, Task pipeline](DECISIONS.md#task-pipeline)): the "no daemon" and "one bounded gh round per call" parts no longer hold.
Introduced: `3bdac4f`. Source tree: `b0b3672`, lines 1506-1514, verbatim.
Archived by: the process-pipeline change; the commit is `git log -S'A-0245' -- DECISIONS-ARCHIVE.md`.

> - **Awareness without a permanent process** `[D-QA-STATUS]`. Owner: «И ты периодически проверял в процессе работы, не типа отдельно воркером проверял, а чтобы ты проверял в рамках работы над задачей. Новую задачу ставишь, и чтобы автоматически тебе приходило состояние, когда ты работаешь с бранчой, о том, что нужно проверить запуски CI/CD.» and «И ты сам тоже можешь проверять, если ты в процессе работы находишься, если ты сейчас онлайн. Это не должен быть постоянный, перманентно висящий процесс». Decision: no daemon,
>   timer or local cron. `scripts/qa-status.mjs` makes one bounded `gh` round (`npm run qa-status`, for workers); the
>   dev-only, repo-local `.pi/extensions/qa-status/` shows a message on session start and on a changed red state, and
>   `/qa` shows the full view. Main reads the status at task start, tells the owner in one line about a red scheduled
>   `main` and triages it. Reason: the extension is useless outside this repository and must not ship in the
>   package, so it is not an `RQW-*` extension and is not in `pi.extensions`; a failed `gh` call is reported as
>   unavailable, never as green. Carrier: `.pi/extensions/qa-status/index.ts`, `scripts/qa-status.mjs`,
>   [PROCESS.md](PROCESS.md#quality-control-loop).
>   Since: `3bdac4f`.

## A-0246 · archived 2026-10-24 · Work policy · Deterministic delivery quality (Windows CI gate)

Status: SUPERSEDED in part by `[D-PIPELINE-MAC-GATE]` ([DECISIONS.md, Task pipeline](DECISIONS.md#task-pipeline)): the rules that Windows CI must pass on the exact head and that `deliver-check` requires it no longer hold; the active entry keeps the rest.
Introduced: `47868b0`. Source tree: `main` (`b0b3672`), the whole entry, verbatim.
Archived by: the process-pipeline change; the commit is `git log -S'A-0246' -- DECISIONS-ARCHIVE.md`.

> - **Deterministic delivery quality** `[D-WORK-DELIVER-CHECK]`. Owner (`16-27-59:440`, approval `16-27-59:450`):
>   «Теперь смотри насчет выполнения задач и пробелов, которые ты нашел. Я же не буду всегда тебя переспрашивать. Если бы я не спросил, ты бы об этом не узнал. Надо поэтому сделать какой-то процесс, как детерминированно эту проблему решить на постоянке, чтобы мне не надо было тебя постоянно переспрашивать, чтобы ты сам следил за качеством. Надо твое предложение по тому, как мы этот пробел будем закрывать.»
>   «Правила по Process MD я одобряю»
>   Coordinator text, the approved proposal: "1. Тестируется ровно то, что вливается. Если main изменился с момента создания ветки, исполнитель переносит ветку на свежий main. Тесты на Mac и Windows CI проходят на этом итоговом коммите.
>   2. Ревью действует только для того коммита, который оно проверило. Любой коммит после CLEAN снова отправляет изменённые места на проверку: и задачу, и код.
>   3. Перед каждым слиянием я запускаю скрипт npm run deliver-check <ветка>. Он проверяет три вещи. Ветка содержит текущий main. Windows CI прошёл именно на этом коммите. В описании коммита записаны номера ревью с CLEAN и список того, что не проверено вживую. Если чего-то нет, слияния нет.
>   4. В каждом отчёте о готовой задаче я сам даю таблицу доказательств и честный раздел "не проверено вживую", без твоего запроса."
>   Coordinator text, interpretation of rule 2: a conflict-free rebase onto `main` needs new tests and CI on the new head
>   but no new review; places changed while resolving conflicts go back to review.
>   Reason: branches tested alone were squashed onto a moved `main`, and a code-review CLEAN once covered an earlier commit
>   while two later fixes landed unreviewed. Carriers: [PROCESS.md](PROCESS.md) (Sufficient proof, Independent review,
>   Delivery), `scripts/deliver-check.mjs`, `test/deliver-check.test.ts`. Since: `47868b0`.

## A-0247 · archived 2026-10-24 · Quality control · Test integrity (review of every QA fix)

Status: SUPERSEDED in part by the updated `[D-QA-TEST-INTEGRITY]` and `[D-PIPELINE-TEST-LANE]` ([DECISIONS.md, Quality control](DECISIONS.md#quality-control)): the integrity review of every QA fix is replaced by a review only of mechanically detected weakening.
Introduced: `3bdac4f`. Source tree: `main` (`b0b3672`), the whole entry, verbatim.
Archived by: the process-pipeline change; the commit is `git log -S'A-0247' -- DECISIONS-ARCHIVE.md`.

> - **Test integrity** `[D-QA-TEST-INTEGRITY]`. Owner: «нужно именно обеспечивать качество, а не фальсифицировать работу, чтобы тесты были зелёные. Это супер критически важно, потому что эти тесты и вся наша работа — это всё обеспечение контроля качества.» and «Можно даже ревьюера поднимать, который перепроверяет тесты.» Decision: before any fix Main records a triage
>   class (product bug, test bug, infra, drift) with evidence; a fixed list of weakening changes is forbidden without
>   proof; a fix needs red-before/green-after in CI logs, and an intermittent one repeat runs with (1-p)^n < 0.05 (generic repeat harness `codemode-stress.yml`).
>   A reviewer subagent with `.agents/reviewers/test-integrity.md` as its whole `system` checks every QA fix and every
>   test or workflow change that weakens a check; `deliver-check` detects that case and requires the trailers
>   `Test-change:` and `Test-review: agent#N CLEAN` (exact conditions: [PROCESS.md](PROCESS.md#quality-control-loop)). Reason: the aim is a working
>   product, not a green badge; a weakened assertion turns a real failure into silence. Carrier: `PROCESS.md`,
>   `.agents/reviewers/test-integrity.md`, `scripts/deliver-check.mjs`.
>   Since: `3bdac4f`.


## A-0248 · archived 2026-10-24 · Review · Deep reviewer prompt

Status: SUPERSEDED by `[D-REVIEW-PROMPT]` (DECISIONS.md#review).
Source tree: `b0b3672`; introducing commit is the `Since:` of the entry.
Archived by: reviewer-codex-port squash (the commit is `git log -S'A-0248' -- DECISIONS-ARCHIVE.md`).
Original DECISIONS.md lines 823-835 at `b0b3672`, verbatim:

> - **Deep reviewer** `[D-REVIEW-DEEP]`. `extensions/RQW-review/REVIEWER.md` is the deep reviewer prompt, shared by both
>   levels: judge quality, completeness and absence of unagreed additions, not perfectionism, reading and checking as much
>   as needed with no economy or tool-call budget, in the main agent's folder. It may run repository tests, never the
>   delivered result itself (for autotest work, not the autotests). Tools are in `[D-REVIEW-TOOLS]`. `TIMEOUT_MS` is
>   30 minutes: hang protection, not an economic budget; its replacement is open work, item R01 in
>   [BACKLOG.md](BACKLOG.md#open).
>   Owner: «Он не должен быть супердушным, супердотошным, проверять на 1000%, быть перфекционистом. Он должен просто контролировать качество работы: всё сделано качественно, всё сделано, что было заказано, ничего лишнего не было сделано.» (session `2026-10-21T16-27-59-062Z_01a15f4a`, line 1693);
>   «никакой экономии нахуй. Агент должен делать столько, сколько ему необходимо, чтобы достичь качественного результата, качественной оценки, качественной проверки. Никаких не должно быть экономических ограничений.» (session `2026-10-21T16-27-59-062Z_01a15f4a`, line 1695);
>   «У него не должно быть ограничения по tool call, по инструментам, по прочему. Он должен работать в рамках того, как работают все большие агенты. У него должен быть тот же самый инструментарий» (session `2026-10-21T16-27-59-062Z_01a15f4a`, line 1700);
>   «Прямо в рабочей папке, в которой работает основной агент.» (session `2026-10-21T16-27-59-062Z_01a15f4a`, line 1598);
>   «для кода он запускает тесты, не запускает сам код для обычного кода, а для автотестов он не запускает автотесты, блядь. В этом же суть, что сам результат работы он не запускает» (session `2026-10-21T16-27-59-062Z_01a15f4a`, line 1610).
>   Reason: the owner's review standard. Carrier: `REVIEWER.md`, `index.ts` (`TIMEOUT_MS`). Proof: prompt hash pin in
>   `test/review.test.ts`. No live model quality claim is made for this prompt. Since: `a04a9c0`.


## A-0249 · archived 2026-10-24 · Review · No warming, five-minute cache

Status: SUPERSEDED by `[D-REVIEW-CACHE]` (the warming half continues; the Anthropic five-minute cache no longer applies) (DECISIONS.md#review).
Source tree: `b0b3672`; introducing commit is the `Since:` of the entry.
Archived by: reviewer-codex-port squash (the commit is `git log -S'A-0249' -- DECISIONS-ARCHIVE.md`).
Original DECISIONS.md lines 836-844 at `b0b3672`, verbatim:

> - **No warming, five-minute cache** `[D-REVIEW-CACHE]`. `extensions/RQW-review/index.ts` sets `cacheWarming: "off"`
>   in each reviewer's in-memory SettingsManager, independently of RQW-settings and the main user's mode; prompt caching
>   stays on. Each reviewer's guarded stream wrapper sets `cacheRetention: "short"` on Anthropic Messages requests before
>   the adapter's OAuth default, a built-in 5m policy with no config knob; other APIs are unchanged.
>   Owner: «Да, давайте мы исполнителям, ревьюерам кэш выключай.» (session `2026-10-21T16-27-59-062Z_01a15f4a`, line 440); TTL approval
>   «Если это замеренная цифра и 5 минут будет заебись в большинстве случаев, то пусть будет 5 минут.» (session `2026-10-21T16-27-59-062Z_01a15f4a`, line 583)
>   ([Anthropic subscription adapter](#anthropic-subscription-adapter)). Reason: review gaps are short, so 1h writes
>   rarely pay off. Proof: `test/review.test.ts`, package `test/prompt-cache.test.ts`. Evidence:
>   `notes/prompt-cache-policy.md`. Since: `b91f832`.


## A-0250 · archived 2026-10-24 · Review · Reviewer models by the main agent's family

Status: SUPERSEDED by `[D-REVIEW-PROFILES]` (DECISIONS.md#review).
Source tree: `b0b3672`; introducing commit is the `Since:` of the entry.
Archived by: reviewer-codex-port squash (the commit is `git log -S'A-0250' -- DECISIONS-ARCHIVE.md`).
Original DECISIONS.md lines 852-865 at `b0b3672`, verbatim:

> - **Reviewer models** `[D-REVIEW-MODELS]`. One table, `LEVELS` at the top of `index.ts`, chosen by the family of the
>   main agent's model. Claude main: `blind` `anthropic/claude-haiku-5-5` thinking medium, `high`
>   `anthropic/claude-sonnet-5-5` thinking low. GPT main: `blind` `openai-codex/gpt-5.6-luna` medium, `high`
>   `openai-codex/gpt-5.6-luna` high. Family from `ctx.model`: provider `anthropic` or a `claude*` id is Claude; provider
>   `openai` or `openai-codex` or a `gpt-*` id is GPT; anything else, or none, uses the Claude table. Fallback: when the
>   family's reviewer has no model or no credentials, the other family's reviewer of the same level runs; when neither can
>   start, `[review#N] Review failed: <reason>` names both reasons. A failed request or no verdict in 30 minutes gives
>   `Review failed: <reason>` with no automatic retry. Verdict `details` carry the model that ran.
>   Owner: «2а 3а» (session `2026-10-21T16-27-59-062Z_01a15f4a`, line 1162) (answer to three coordinator questions; the unanswered first question took its recommended
>   option 1a, reviewer model by the main agent's family); «Да» (session `2026-10-21T16-27-59-062Z_01a15f4a`, line 1425).
>   Reason: the gpt-match probes found GPT-5.6 Luna medium and high comparable to the Claude slots; GPT-6 Luna unusable.
>   Evidence: `notes/reviewer-probes.md`, section "GPT match for the Claude slots"; numbers in
>   [decisions evidence](notes/decisions-evidence.md#review-gpt-match). Proof: `test/review.test.ts` ("the family
>   table", "GPT main, blind", "GPT main, high", the fallback and failure tests). Since: `3389347`.


## A-0251 · archived 2026-10-24 · Review · Parameters with rebuttals

Status: SUPERSEDED by `[D-REVIEW-PARAMS]` (DECISIONS.md#review).
Source tree: `b0b3672`; introducing commit is the `Since:` of the entry.
Archived by: reviewer-codex-port squash (the commit is `git log -S'A-0251' -- DECISIONS-ARCHIVE.md`).
Original DECISIONS.md lines 866-871 at `b0b3672`, verbatim:

> - **Parameters** `[D-REVIEW-PARAMS]`. `level`, `object` (paths, the diff as a file path rather than a command, so the
>   reviewer reads it whole beside the named sources, the stage), `criterion`, optional `agreement` (accepted proposals
>   and decisions not in the user's own messages), optional `rebuttals` (`[D-REVIEW-DISPUTES]`) and optional boolean
>   `fast_gpt`. Empty strings, a null or empty `rebuttals` and a null `fast_gpt` count as not given, since strict mode
>   fills every field. The description stays within 600 characters, enforced by its test. Carrier: `index.ts`.
>   Proof: `test/review.test.ts`. Since: `3389347`.


## A-0252 · archived 2026-10-24 · Review · Main and reviewer as a pair

Status: SUPERSEDED by `[D-REVIEW-CYCLE]` (DECISIONS.md#review).
Source tree: `b0b3672`; introducing commit is the `Since:` of the entry.
Archived by: reviewer-codex-port squash (the commit is `git log -S'A-0252' -- DECISIONS-ARCHIVE.md`).
Original DECISIONS.md lines 872-875 at `b0b3672`, verbatim:

> - **Main and reviewer as a pair** `[D-REVIEW-PAIR]`. The pair rules live only in the plugin, so switching RQW-review off
>   removes them. Reviewer side: `REVIEWER.md` ("on Main's team"). Main side, three carriers in `index.ts`:
>   `DESCRIPTION` (every request while on: who the reviewer is, "works with you as one team for the user's agreement", how to call it); the tool result `startedText`: `review#N started. Keep working, but leave the reviewed files unchanged until its verdict.`; and the verdict wrapper `verdictMessage`: `[review#N]`, the verdict verbatim, finding ids and dispute outcomes, then one `NEXT` paragraph by kind. `clean`: the trimmed verdict is exactly `CLEAN` after a normal `stop`; passed, no further pass for confidence. A `length`, `error`, `aborted` or other abnormal stop is a failed review. `incomplete` (`CLEAN` with extra text, prose before `CLEAN`, `FINDINGS:` with text on its header line, a `FINDING` block missing a required field, any other text): resolve UNCHECKED or retry, never a pass, no finding id, answers no dispute. `findings` (a line exactly `FINDINGS:`, then `FINDING n` blocks with REQUIREMENT, MISMATCH, EVIDENCE, REQUIRED OUTCOME filled; one structural check in `findingBlocks`, used by `kindOf` and `settle`): find each quote; fix each new finding exactly to its REQUIRED OUTCOME, or rebut it once with proof of a misreading; a finding resting on a value or choice the user never gave goes to the user, not fixed with another choice of Main's own ([Reviewer probes](notes/reviewer-probes.md), variant n1); fix the rest in one batch, then call `review` again with the same level, object, criterion and the new rebuttals until CLEAN. `failed` (the catch branch): no pass, no self-check replaces it; retry once on the unchanged object, then tell the user and wait. Not `promptSnippet` or `promptGuidelines`: RQW-prompt sets `customPrompt`, and Pi builds that section only without one. Not `SYSTEM.md`. Owner: «Правила пары остаются внутри плагина (DESCRIPTION, NEXT, REVIEWER.md), а не в SYSTEM.md.» (session `2026-10-21T16-27-59-062Z_01a15f4a`, line 367) (task text the owner pasted). Coordinator text (earlier owner quotes, found only as copies in that pasted task): "чтобы они действовали в одной команде ... либо принимает правку, либо её отклоняет и пишет, почему" (2026-10-09); "он с ним действует в унисон, в паре ... их синергия должна идти в рамках плагина. Это не должно размазываться" (2026-10-20).
>   Since: `c4aaad4`.


## A-0253 · archived 2026-10-24 · Review · Disputes: the three-message rule

Status: SUPERSEDED by `[D-REVIEW-CYCLE]` (the dispute rules are removed with no replacement) (DECISIONS.md#review).
Source tree: `b0b3672`; introducing commit is the `Since:` of the entry.
Archived by: reviewer-codex-port squash (the commit is `git log -S'A-0253' -- DECISIONS-ARCHIVE.md`).
Original DECISIONS.md lines 876-913 at `b0b3672`, verbatim:

> - **Disputes: the three-message rule** `[D-REVIEW-DISPUTES]`. Enforced by the extension, not only by prompts
>   (`NEXT`, `DESCRIPTION`, schema, `findingBlocks`, `disputes`, `settle`, `refusals`, `buildBrief` in `index.ts`, and
>   `REVIEWER.md`):
>   - Ids: each finding of a parsed `FINDINGS:` verdict gets a stable id `<review number>.<position>` (`3.2`), listed after
>     the verdict; a finding repeated with `DISPUTE: <id>` keeps that id.
>   - Message 2: Main fixes a finding or rebuts it once in `rebuttals` (`finding`, `quote`, `source`, `explanation`). The
>     whole call is refused, with no review started and no number taken, when a rebuttal names an unknown finding, lacks a
>     quote, source or explanation, quotes text not in its source (`user`: the user's own messages of the branch only, not
>     a compaction or branch summary; or a file under the session cwd; whitespace runs and one pair of surrounding quotation
>     marks are ignored), repeats a finding in one call, or rebuts a finding that already has a rebuttal or a final answer.
>     The state check and persisting accepted rebuttals run with no await between them, so of two parallel rebuttals of one
>     finding exactly one is accepted. The refusal says what to do instead.
>     File-source containment is enforced after `realpath` resolves the source and session cwd. Relative paths and
>     absolute paths inside that resolved cwd are allowed; outside paths and symlink escapes are refused before the
>     file is read (`index.ts`, since `e1cca48`).
>   - Message 3: every brief carries every dispute of the branch under `<disputes>` (the finding, its id, Main's quote,
>     source and explanation, and once answered the status and the reviewer's answer), so a fresh reviewer understands it.
>     The first exact `CLEAN` or parsed `FINDINGS:` verdict of a review whose brief carried an open dispute answers it: left
>     out is withdrawn; repeated with `DISPUTE: <id>` is upheld with `RULING: DECIDED` (a verbatim user or agreement quote
>     settles it, Main fixes) or `RULING: UNDECIDED` (no unambiguous user decision, Main asks the user), plus a
>     one-sentence `ANSWER`. A missing or invalid RULING counts as UNDECIDED. Failed, incomplete or malformed verdicts
>     answer nothing. Outcome lines `NEXT.withdrawn`, `NEXT.decided`, `NEXT.undecided` follow the verdict.
>   - An unagreed addition Main defends as useful is a finding with REQUIREMENT `NOT AGREED` and `RULING: DECIDED`; Main
>     removes it without asking the user (owner «2а 3а», question 2 option a). `REVIEWER.md` carries the exception sentence
>     "Exception to the two rulings and the test: an addition the user never asked for (an extra feature, output, option
>     or file) that Main defends only as useful or harmless is a finding with REQUIREMENT `NOT AGREED` and RULING
>     `DECIDED`; Main removes it without asking the user."
>   - Verdict extraction (`verdictOf`): a reply not starting with `CLEAN` or `FINDINGS:` starts at its first line that is
>     exactly `FINDINGS:`; prose before `CLEAN` stays `incomplete` (owner «2а 3а», question 3 option a).
>   - Outcome: a settled requirement with decisive evidence, Main fixes. A misreading, including a finding that demands
>     what the agreement does not ask for or changes a settled decision: one rebuttal with the agreement quote, and the
>     fresh reviewer decides. A missing or ambiguous decision, or a choice Main made that differs from what the user said,
>     is `UNDECIDED` and goes to the user.
>   - State: rebuttals persist with the review number entry (`{ n, rebuttals }`), findings and rulings in a second entry
>     (`{ n, findings, rulings }`), all `pi.appendEntry("review", ...)`, rebuilt from the current branch on every call and   verdict, so they survive reload and resume. Owner: «У них цикла быть не должно. Знаешь, тут даже не должно быть трёх кругов. Смотри, как должно быть: должно быть правило трёх сообщений. Ревьюер даёт комментарий, main ему отвечает, и ревьюер либо соглашается, либо выступает против. И это конечное. Дальше main с ним уже не спорит: он либо принимает его решение, либо идёт к пользователю, чтобы тот разрешил спор, конфликт. Вот и всё.» (session `2026-10-21T16-27-59-062Z_01a15f4a`, line 391); «Если у ревьюера железобетонные доказательства, то мейн должен принять.» (session `2026-10-21T16-27-59-062Z_01a15f4a`, line 391); «Если ревьюер выявил работу, которая не была зафиксирована однозначным решением, то надо вопрос отдать этому пользователю, чтобы пользователь разрешил спор. Всегда всё идёт на основании решения пользователя.» (session `2026-10-21T16-27-59-062Z_01a15f4a`, line 391); «Да, и на каждом круге, конечно же, всегда у нас новый, свежий ревьюер» (session `2026-10-21T16-27-59-062Z_01a15f4a`, line 391); «Причем ему отдается инфа об отказе, возражения основного агента отдаются так, чтобы новый ревьюер потом без проблем понял, о чем идет речь.» (session `2026-10-21T16-27-59-062Z_01a15f4a`, line 391); original task text the owner pasted: «Задача: доработать RQW-review так, чтобы main и reviewer работали в паре: main может опровергнуть находку по существу» (session `2026-10-21T16-27-59-062Z_01a15f4a`, line 367). The former rule that a finding with verbatim quotes can never be rejected was an agent proposal, replaced by these messages. Earlier owner sources from omp sessions: [decisions evidence](notes/decisions-evidence.md#review-dispute-sources). Proof: `test/review.test.ts` suites "disputes: one finding, one rebuttal, one final answer" and "dispute mechanics".
>   Limits: a reviewer that upholds a dispute without the DISPUTE field creates a new finding id, which Main could rebut
>   once more. Probe evidence: `notes/reviewer-probes.md`, [decisions evidence](notes/decisions-evidence.md#review-dispute-probes).
>   Since: `30c633f`.


## A-0254 · archived 2026-10-24 · Review · Brief from the branch with disputes

Status: SUPERSEDED by `[D-REVIEW-BRIEF]` (DECISIONS.md#review).
Source tree: `b0b3672`; introducing commit is the `Since:` of the entry.
Archived by: reviewer-codex-port squash (the commit is `git log -S'A-0254' -- DECISIONS-ARCHIVE.md`).
Original DECISIONS.md lines 914-917 at `b0b3672`, verbatim:

> - **Brief from the branch** `[D-REVIEW-BRIEF]`. `buildBrief` writes the user's messages of the current branch, verbatim,
>   numbered and in order, with compaction and branch summaries labelled as not the user's words, then `agreement`,
>   `object`, `criterion` and `<disputes>`; images are `[image]`. Reason: Main no longer retypes the user's words, the
>   largest output cost of a call, and they cannot drift. Since: `3389347`.


## A-0255 · archived 2026-10-24 · Review · Reviewer git guard, wording about running the delivered result

Status: SUPERSEDED by `[D-REVIEW-GITGUARD]` (DECISIONS.md#review).
Source tree: `b0b3672`; introducing commit is the `Since:` of the entry.
Archived by: reviewer-codex-port squash (the commit is `git log -S'A-0255' -- DECISIONS-ARCHIVE.md`).
Original DECISIONS.md lines 940-945 at `b0b3672`, verbatim:

> - **Reviewer git guard** `[D-REVIEW-GITGUARD]`. `extensions/RQW-review/git-guard.ts` is a byte-equal self-contained copy
>   of `extensions/RQW-agent/git-guard.ts`; root `test/copies.test.ts` asserts it without importing either extension.
>   Every child bash `tool_call`, offered or stock, checks `blockedGit` and returns its reason as the tool error. Limit: a
>   shell-syntax guard, not a sandbox. No file edits through bash and never running the delivered result are prompt rules,
>   not runtime enforcement; repository tests may have filesystem side effects. Carrier: `index.ts`, `git-guard.ts`,
>   `REVIEWER.md`. Since: `a04a9c0`.


## A-0256 · archived 2026-10-24 · Review · Verdict format of the earlier deep prompt

Status: SUPERSEDED by `[D-REVIEW-VERDICT]` (DECISIONS.md#review).
Source tree: `b0b3672`; introducing commit is the `Since:` of the entry.
Archived by: reviewer-codex-port squash (the commit is `git log -S'A-0256' -- DECISIONS-ARCHIVE.md`).
Original DECISIONS.md lines 949-954 at `b0b3672`, verbatim:

> - **Verdict format** `[D-REVIEW-FORMAT]`. `REVIEWER.md` carries the deep adaptation of the Spotty body: named paths are
>   read whole and truncated files resume at the reported offset; the final answer is the last message, not `yield`.
>   Verdict: `CLEAN`, or `FINDINGS:` with numbered `FINDING n` blocks (REQUIREMENT, MISMATCH, EVIDENCE, REQUIRED OUTCOME;
>   DISPUTE, RULING and ANSWER only on a repeated disputed finding) and an optional `UNCHECKED:` section. REQUIRED OUTCOME
>   states one concrete end state; `<criterion>` sets the scope. Proof: `test/review.test.ts` format pins.
>   Earlier GPT prompt measurements: `notes/reviewer-prompt-gpt.md`, not proof for the deep prompt. Since: `e76994a`.

## A-0257 · archived 2026-10-24 · Work policy · Measurements in waves, reason naming the reviewer-v2 benchmark

Status: SUPERSEDED by `[D-WORK-MEASURE-WAVES]` (same rule, reason reworded) (DECISIONS.md#work-policy).
Source tree: `b0b3672`; introducing commit is the `Since:` of the entry.
Archived by: reviewer-codex-port squash (the commit is `git log -S'A-0257' -- DECISIONS-ARCHIVE.md`).
Original DECISIONS.md lines 257-266 at `b0b3672`, verbatim:

> - **Measurements in waves** `[D-WORK-MEASURE-WAVES]`. Owner (`16-27-59:3044`; `16-27-59:3059` to the five-step plan
>   whose step 5 is this rule; `16-27-59:3197`; `16-27-59:3202`):
>   «Так блять надо фиксить ты шо гонишь мы нахуй прогоны эти делаем . Мы прогоны делаем не ради прогонов. Мы прогоны делаем для того, чтобы найти косяки, найти хуйню, её пофиксить и делать пиздато всё. А ты, получается, просто всю ночь гоняешь прогоны и жгёшь лимиты. Для чего? Просто чтобы поставить галочку, что мы сделали прогоны нахуй?»
>   «Это нихуя не интеллектуально, нахуй. Что-то с этим делать надо.»
>   «Давай сейчас все прогоны останови, и мы обсудим дальнейшие шаги. Надо сейчас это все порефиксировать»
>   «1а»
>   «Смотри, я хочу, чтобы ты в процессе измерений прогонов сразу находил аномалии, сразу находил отклонения и сразу же останавливал прогоны и чинил. Если будут очевидные косяки жёсткие, надо их сразу чинить в моменте . Нет смысла ждать полных прогонов, если мы потом починим и будем заново перепрогонять. Ты на первых запусках, если видишь какую-то хуйню очевидную, надо её фиксить . И первые запуски делай на самых сильных моделях из того перечня, который у тебя есть, чтобы сразу получить отклонение на старте у сильных моделей»
>   «Мы не учитываем, что слабые модели в принципе не смогут какие-то вещи делать. Нам главное откалибровать на сильных моделях, а потом посмотрим, как они будут себя вести на слабых»
>   Reason: the reviewer-v2 benchmark burned a night on a checker defect visible in its first outputs. Carrier:
>   [PROCESS.md, Measurements and benchmarks](PROCESS.md#measurements-and-benchmarks), rules 1-5. Since: `ba1c273`.


## A-0258 · archived 2026-10-24 · Work policy · Temporary Sonnet-only subagents, wording about the reviewer finalisation task

Status: SUPERSEDED by `[D-WORK-TEMP-SONNET]` (same rule, wording reduced) (DECISIONS.md#work-policy).
Source tree: `b0b3672`; introducing commit is the `Since:` of the entry.
Archived by: reviewer-codex-port squash (the commit is `git log -S'A-0258' -- DECISIONS-ARCHIVE.md`).
Original DECISIONS.md lines 90-96 at `b0b3672`, verbatim:

> - **Temporary Sonnet-only Anthropic subagents** `[D-WORK-TEMP-SONNET]`. The temporary restriction and its explicit
>   expiry live in [PROCESS.md, Worker models](PROCESS.md#worker-models). After expiry the normal table applies.
>   Owner (`16-27-59:4789`, entry `de383e38`):
>   «Да, и временно нужно до конца недели из subagent убрать Opus, использовать только Sonnet. Надо зафиксировать это до вечера среды. Сейчас у нас 11:25 p.m. пятницы, и мы до следующей среды, до 19:00, не используем Opus модели с subagent в этой связке координатора, именно в этом проекте, в работе над проектом.»
>   Reason: limit Opus usage during project development. Carrier: PROCESS coordinator-rules and the dev guard.
>   The reviewer finalisation task alone carries its task-specific exception; this is not general worker permission.
>   Since: process-rules-oct23 squash.

## A-0259 · archived 2026-10-24 · Codex subscription transport · Codex compaction as backend V2 with opaque window

Status: SUPERSEDED by `[D-CODEX-SIMPLE-COMPACTION]` (DECISIONS.md#codex-subscription-transport).
Introduced: `2304f7e`. Superseded: the `codex-compaction-fix` change (squash hash is recorded by its delivery). Archived by: that change.
Verbatim text as it was in DECISIONS.md at `b0b3672`, line 1543 (this block is a single source line; the table row or paragraph is not wrapped):

> - **Compaction** `[D-CODEX-COMPACTION]`. Codex backend V2, `compaction_trigger` on the same `/codex/responses` endpoint, opaque backend item and atomic durable window installation, not legacy `/responses/compact` and not a Pi text-summary inference for Codex. Owner clarification (verbatim): «компакшен именно реализовать метод - т.е. эндпоинт и то как это делается механически, а не лимиты контекста». Source: user message `69c91527`, `2026-10-22T23:20:48.061Z`, physical JSONL line 2405 of `2026-10-21T16-27-59-062Z_01a15f4a-7ad5-7377-81be-0baf3b6ffa33.jsonl` in the owner's external Pi session directory. Coordinator interpretation: implement Codex's compaction method and endpoint mechanics, not its context limits; the trigger stays RQW-context's W/R rule. RQW-context keeps W = min(contextWindow, 500000), R = round(W/10), threshold W−R and existing explicit reserve precedence. RQW-codex replaces the summary method/projection only for its owned subscription sessions. Reason: the accepted 6b changes method, not physical limits. Carriers: `compaction.ts`, `history.ts`, `lifecycle.ts`; RQW-context remains the threshold owner.

## A-0260 · archived 2026-10-24 · Codex subscription transport · Portable original history beside the opaque Codex checkpoint

Status: SUPERSEDED by `[D-CODEX-SIMPLE-COMPACTION]` (DECISIONS.md#codex-subscription-transport).
Introduced: `2304f7e`. Superseded: the `codex-compaction-fix` change (squash hash is recorded by its delivery). Archived by: that change.
Verbatim text as it was in DECISIONS.md at `b0b3672`, line 1544 (this block is a single source line; the table row or paragraph is not wrapped):

> - **Portable original history** `[D-CODEX-HISTORY]`. Owner answer (verbatim) «1а 2б» (user message `92037bbf`, physical JSONL line 2414 of the same external session). Coordinator option 1a summary, not an owner quotation: retain original history beside encrypted Codex history; Claude receives the original history and Pi compacts it only if it does not fit its window, with an extra request only then. Original pre-compaction entries remain alongside opaque Codex state. Non-Codex providers and a disabled adapter get that original history; stock Pi compacts only when needed for their window. No extra inference otherwise and no blocking. Reason: opaque backend state must not strand a portable Pi session. Carriers: `history.ts`, `compaction.ts`, scoped lifecycle projection.

## A-0261 · archived 2026-10-24 · Codex subscription transport · Native differential checks paragraph with native compaction cases

Status: SUPERSEDED by the rewritten paragraph of the same section and `[D-CODEX-SIMPLE-COMPACTION]`.
Introduced: `2304f7e`. Superseded: the `codex-compaction-fix` change (squash hash is recorded by its delivery). Archived by: that change.
Verbatim text as it was in DECISIONS.md at `b0b3672`, line 1558 (this block is a single source line; the table row or paragraph is not wrapped):

> Coordinator technical implementation, not an owner quotation: replay pinned native responses through the real RQW-codex extension in a Pi `AgentSession` and compare the adapter's ordered request projection with the native capture projection. Reason: native oracle success alone does not establish adapter parity. `test/fixtures/native-differential.json` pins [normal oracle run 39956439677](https://github.com/ARQAWA/my-pi/actions/runs/39956439677), my-pi head `fe3e9ec554070811a76eb5403934b753825e67df`, with 10 cases: transport 4, retry 3, compaction 3. The shared projection checks transport/endpoint, turn state, request kind, compaction metadata, turn grouping, retry-body identity and conversation replay; selected cases also compare content encoding. Compaction before an agent follow-up sampling inside the same user turn uses `mid_turn`, not `pre_turn`; the hook tracks that nested check in `session-compaction.ts`.

## A-0262 · archived 2026-10-24 · Codex subscription transport · Exception ledger row for retained original history

Status: SUPERSEDED by the `Compaction method` row of the exception ledger and `[D-CODEX-SIMPLE-COMPACTION]`.
Introduced: `2304f7e`. Superseded: the `codex-compaction-fix` change (squash hash is recorded by its delivery). Archived by: that change.
Verbatim text as it was in DECISIONS.md at `b0b3672`, line 1569 (this block is a single source line; the table row or paragraph is not wrapped):

> | Original history retained for other providers/disabled adapter | Explicit 1a; opaque Codex state cannot be decoded by Claude/stock Pi; a Pi summary request occurs only on window overflow | RQW-codex history/compaction |

## A-0263 · archived 2026-10-24 · Task pipeline · Pause is interrupt, resume is send (shipped API, planned resume, one checkpoint before a Pi restart)

Status: SUPERSEDED by the updated `[D-PIPELINE-PAUSE-RESUME]` (DECISIONS.md#task-pipeline): `resume` is delivered, the planned-restart checkpoint exception is gone.
Introduced: process-pipeline squash. Source tree: `main` (`2171049`), the whole entry, verbatim.
Archived by: the agent-async change (stages 1 and 2, branch `agent-async`; stage 1 head `dd93a40`); the commit is `git log -S'A-0263' -- DECISIONS-ARCHIVE.md`.

> - **Pause is interrupt, resume is send** `[D-PIPELINE-PAUSE-RESUME]`. Pausing a task is an `agent` `interrupt` of its agent:
>   the session and its full history stay. Resuming it is an `agent` `send` of the next message to the same agent, which
>   continues with its full history. No checkpoint, continuation or handoff file is written for a pause or a resume, and
>   an agent is `stop`ped only when its task is finished or cancelled. Until child sessions survive a Pi restart, one
>   short checkpoint is written only immediately before a planned Pi restart. The current session queue stays the source
>   of the task order, not a file. Owner (`16-27-59:5087`, entry `ddd0ce47`): «Нет. Агент на паузе. Не надо писать никакой файл продолжения, надо просто уметь его возобновить. У нас же есть всё от него для того, чтобы его возобновить. У нас есть его сессия, есть его ID, есть всё от него. Надо просто, чтобы наш функционал саб-агентов мог возобновлять агентов и всё. Не надо никаких хендоффов делать.»
>   «И да, интерфейс должен разключать, когда агент стоит, когда он AFK, когда он работает.»
>   Owner (`16-27-59:5092`, entry `3c2122c8`), restart of the whole Pi process: «Я могу зайти в P, сделать resume и сказать: "Продолжай". И он должен уметь возобновить вообще всё: текущий чат возобновится, и агент основной текущего чата возобновит все предыдущие процессы.»
>   «В Kushore отдельная кнопка есть: можно основной чат не возобновлять, а возобновить только саб-агентов. И потом, когда они ответят, они сами дадут нотификацию основному чату, и основной чат сам продолжит работу.»
>   «основной чат не должен ни висеть, ни пулить, ничего. Он должен просто быть AFK, пока не придёт notification.»
>   Owner (`16-27-59:5103`, entry `8bb70dcd`), what resume means: «возобновить, значит просто retry тот запрос, на котором он был оборван. Вот и всё.»
>   Coordinator design text (not an owner quote; the future `resume` action of AGENT-SESSION-PERSIST): a paused or
>   interrupted agent resumes by retrying the interrupted model request without a new message, and the same `resume`
>   action works from a saved session after a Pi restart. A model request that was cut off is retried. A tool call that
>   was interrupted and may have side effects is never replayed blindly: the model sees it as interrupted and decides.
>   The shipped `agent` API stays as it is, `interrupt` then `send`, until the `resume` action is delivered; it is
>   not implemented by this entry.
>   Coordinator text (`16-27-59:5090`, entry `d044f551`, formatting marks removed): "Чего не хватает в самом функционале: 1. Сессии субагентов живут только в памяти, поэтому при перезапуске Pi они теряются. Их надо сохранять на диск со связью с родительской сессией. Тогда агента можно будет продолжить по номеру и после перезапуска, а `/remove` будет удалять их вместе с родителем. 2. В списке агентов будут видны три разных состояния: 'работает', 'ждёт' и 'простаивает'."
>   Coordinator text, scope of this entry: it records the rule only; disk-persisted subagent sessions and the three-state
>   agent list are queued in [BACKLOG.md](BACKLOG.md#agent-session-persist) and
>   [BACKLOG.md](BACKLOG.md#agent-states-ui) and are not implemented by it; AGENT-SESSION-PERSIST also carries the restart, subagents-only resume and notification wake-up above, linked to NONBLOCKING-WAITS and ASYNC-TOOL-CALLING.
>   Reason: closing paused agents lost their history and left only files they had written themselves; one Pi run
>   already resumes an interrupted agent with `send`. Carrier: [PROCESS.md, Task pipeline](PROCESS.md#task-pipeline).
>   Since: process-pipeline squash.

## A-0264 · archived 2026-10-24 · Tools · Background jobs (Esc kills jobs, polling only)

Status: SUPERSEDED in part by the updated `[D-TOOLS-BG]` and the new `[D-TOOLS-NOTIFY]` (DECISIONS.md#tools): a handed-off job survives Esc and new owner messages, and waits may be notifications instead of polling.
Introduced: `e5440f2`; scan and footprint safeguards `e1cca48`. Source tree: `main` (`2171049`), the whole entry, verbatim.
Archived by: the agent-async change (stages 1 and 2, branch `agent-async`; stage 1 head `dd93a40`); the commit is `git log -S'A-0264' -- DECISIONS-ARCHIVE.md`.

> - **Background jobs** `[D-TOOLS-BG]`. Owner (`16-27-59:2561`, `16-27-59:2574`, design answers `16-27-59:2598`):
>   «Да, и надо, чтобы основной агент. Нет, знаешь как? Надо, чтобы длительные shell процессы сами уходили в фон. Если он работает больше 20 секунд, чтобы он превращался в фоновый процесс, а не оставался висячим активным процессом. Надо, чтобы всё, что висит больше 20 секунд, любая операция, которая висит больше 20 секунд, уходила в background, и можно было просто её пропинговать через какое-то время. Чтобы у агента был инструмент проверки состояния.»
>   «только надо время сократить до 12 секунд, после 12 секунд уходит в фон.»
>   «1а2а3а»
>   «4 - надо разобраться с рейс кондишенами и найти самое интелектальное производительное и эффективное решение марщрутизации и оркестрации тулколов»
>   «5б»
>   «6а с учетом 4 пункта добавочного»
>   Rule: a top-level call of `bash`, `codemode` (the whole script) or `read`, `edit`, `write`, `grep`, `find` that has
>   not settled 12 s after it started, barrier wait included, returns at once as `job#N` with the command, elapsed time,
>   the output so far and a log file in the OS temp dir, and keeps running; a call that settles sooner returns exactly the
>   stock result. Calls inside a codemode script never go to the background. The `job` tool (`wait`, `status`, `kill`; `ids`, `id`,
>   `timeout_ms` default 300000 when omitted, `lines` default 20) waits mechanically until one selected job ends or the
>   caller's deadline, keeps collecting for 250 ms after the first one ends, shows state, exit code, elapsed time, tail
>   and log path, and kills a process job with its process tree or cancels a queued one. Approved caveat: a running
>   file-tool job (`read`, `edit`, `write`, `grep`, `find`) cannot be interrupted safely; `job kill` reports
>   `cannot_kill` and it finishes on its own. This is a design limit, not a defect; queued file-tool jobs can be
>   cancelled. Polling only; the descriptions say to wait for or kill one's jobs before the final answer. A process job
>   dies on Esc, `job kill`, its `timeout`, and the caller's shutdown or reload; jobs belong to the session whose call started them (one registry per `createTools`; RQW-agent
>   calls the offered `job` definition's `jobs.abortAll()` on interrupt and `jobs.dispose()` on close). `job` is active
>   whenever one of these tools is; when Pi's allowlist keeps it off, nothing goes to the background. Reason: long
>   operations must not hold the agent, and the agent needs a tool to check them; Codex unified exec yields the same way;
>   the threshold is the owner's value.
>   Ordering (D4). Owner (`16-27-59:2705`): «1a + живай проверка на хайку и луна хай ризонинга»; option 1a of the ordering
>   proposal is named in coordinator text "ordered until handoff, free after". Calls of the same response keep the barrier
>   order: a call after a backgrounded job waits for its real end and itself becomes a queued job after 12 s. At the
>   handoff a bash or codemode job is detached from the barrier (`detach` in `barrier.ts`, through `nested.ts`); calls of
>   later responses wait for it only for the resources it holds (H1). A read, edit or write job keeps its paths. A
>   dependency on a background job is explicit: `job wait`, then the dependent call. While a bash or codemode job of the
>   caller runs, a read, edit or write of a file changed outside the caller's tools since that job started gets one note
>   naming the job.
>   Routing (FR-safe). Owner (`16-27-59:3117`, the answer to the routing question): «2а». Holds (H1): at the handoff a
>   bash job keeps what `footprint.ts` reads with certainty from its command text: the package folder an install changes,
>   the git index and refs of a repository a git command changes (every subcommand except known reading ones), and the
>   exact files it writes (redirects, `tee`, `sed -i`, `curl -o`, `rm`, `mkdir`, `touch`, `cp`/`mv`/`ln` destinations).
>   `footprint.ts` restores the outer working directory when a subshell closes. Mutating `git symbolic-ref` and
>   `git reflog` forms hold the repository; their read-only forms remain reads.
>   A later call waits only for these; reads never wait; any doubt holds nothing. Package-folder and git holds are
>   process-wide (`ledger.ts`) across main, subagents, workers and reviewers; files are not ordered across sessions, they
>   get attributed notes. Effects report (O1): a top-level bash call that can become a job, or a top-level codemode call,
>   takes a snapshot of the working tree
>   (`git ls-files -co --exclude-standard`, or outside git a walk with one global limit of 20000 files, including
>   within a single wide directory, without .git, node_modules,
>   .next, target, .venv, __pycache__) right before its command starts, and a job takes another when it ends; what
>   changed is the difference of the two states, never a time cutoff. Approved caveat: a bash call with its own
>   positive `timeout` of 13 s or less never goes to the background, so it takes no pre-start snapshot. Calls with a
>   longer or absent timeout take the snapshot even if they finish before handoff; this is not a snapshot defect. Owner (`16-27-59:3621`), on the cost:
>   «Да, если это всего лишь 150 миллисекунд на 20 тыс. файлов, конечно, блядь, надо делать снимок файлов точный. Это 1А.»
>   The report lists files created and changed while the job ran (with the other session and tool), the caller's own
>   writes, own writes overwritten since, files deleted since the start, and the other jobs that ran alongside.
>   Unreadable directories, file-stat failures and git warnings recorded by either snapshot appear in `effects.errors`,
>   labelled before the start or at the end; failed or cancelled scans, git listing failures and the global walk bound
>   are reported in `effects.errors` or `scanned`. Unchecked paths are explicit, and an inaccessible file is not
>   classified as deleted. Write precondition (P1): a write over a file the session has read or written, changed
>   since by anyone else, is refused once with who changed it; the identical retry overwrites; a file never seen is
>   written without a check. Check, stock tool and ledger record run in one process-wide critical section per file
>   (`withFileLock`); files are keyed by native real path (`identityKey` in `keys.ts`); records belong to a registry
>   `owner`, the label is only shown. K1: `job kill` also cancels the queued same-response calls that wait for the killed
>   job and lists them in `cancelled_followers`; a killed queued call leaves the barrier at once (`withdraw`). N1: a job
>   that ended with an unseen non-empty effects report adds one note line to the caller's next top-level tool result.
>   W1: `job wait` takes `until`, a JavaScript regular expression on the output (a leading `(?i)` ignores case). S1: a
>   codemode script waits as a queued job for a free worker of the process (`PI_CODEMODE_MAX_WORKERS`, default 2). A
>   bash call inside a codemode script takes the same process-wide claims. Each session's label comes through the
>   optional `options.label` of the offered factory (`main`, `agent#1`, `agent#1/code_writer#2`, `review`, ...).
>   Children like main. Coordinator text, technical decision at the rebase onto subagent parity; the parity request,
>   owner (`16-27-59:2608`): «Надо что бы саб агенты были как в куросре посмотри реверз инжинеринг и скажи свои предложения».
>   With an RQW-tools offer, a child's or reviewer's `codemode` is Pi's definition built from that session's API, passed
>   as `options.codemode` and returned as one call of the child's barrier and a job of its registry, so a child script goes
>   to the background after 12 s like main's and S1 slots count main and every child together; without an offer the child
>   keeps Pi's stock codemode. Explorers inherit the caller's active base tools (`[D-AGENT-EXPLORE-TOOLS]`) and get `job` only when offered. The reviewer of RQW-review gets the offered `job`
>   tool; Esc of a review aborts its jobs and its end disposes them. The prompt section `rqw_tools_execution` says that a
>   background job holds the later calls of its response and, from later responses, only calls that change what it holds.
>   Reason: a replay of recorded tool calls left D4 alone with silent overlaps between jobs and later calls; FR-safe
>   leaves none silent and keeps the same-response order; the owner chose it. Probes, replay, snapshot cost, pilot defects
>   and code-review fixes: [notes/decisions-evidence.md](notes/decisions-evidence.md#background-jobs-evidence); races
>   R16-R24: `notes/analysis-races.md` section 9.
>   Carriers: `extensions/RQW-tools/jobs.ts`, `barrier.ts`, `nested.ts`, `footprint.ts`, `ledger.ts`, `keys.ts`,
>   `index.ts`, `codemode.ts`, `descriptions/bash.md`, `descriptions/job.md`, `descriptions/write.md`;
>   `extensions/RQW-agent/index.ts`, `extensions/RQW-agent/roles/*.md`; `extensions/RQW-review/index.ts`;
>   `notes/prompt-tools-isolation.md`. Proof: `extensions/RQW-tools/test/background.test.ts`, `barrier-detach.test.ts`,
>   `footprint.test.ts`, `ledger.test.ts`; `extensions/RQW-agent/test/wait.test.ts`, `nested-workers.test.ts`,
>   `agent.test.ts`; `extensions/RQW-review/test/review.test.ts`, `subagent.test.ts`;
>   `test/prompt-tools-isolation.test.ts`. Since: `e5440f2`; scan and footprint safeguards since `e1cca48`.

## A-0265 · archived 2026-10-24 · Agent · API and in-process runtime (seven actions, in-memory history)

Status: SUPERSEDED by the updated `[D-AGENT-API]` (DECISIONS.md#agent): `resume` and `blocking` exist and persisted callers keep child histories on disk.
Introduced: `7a9f505`; inherited defaults `c86e9bb`. Source tree: `main` (`2171049`), the whole entry, verbatim.
Archived by: the agent-async change (stages 1 and 2, branch `agent-async`; stage 1 head `dd93a40`); the commit is `git log -S'A-0265' -- DECISIONS-ARCHIVE.md`.

> - **API and in-process runtime** `[D-AGENT-API]`. One `agent` tool offers `start`, `wait`, `status`, `send`, `interrupt`, `stop`, `restart`; fields are `id`, `ids`, `timeout_ms`, `messages`, `until`, `wake_on_alert`, `depth`, `alert_after_ms`, `system`, `role`, `system_file`, `role_file`, `include`, `title`, `explore`, `task`, `model`, `thinking`, `tools`, `fast_gpt`, `interrupt`. Optional null fields mean omitted; start/send require task, not system. Defaults are the caller's model and thinking and all six base tools, plus the delegation tools allowed by [Workers](#workers). Sessions run in-process at caller cwd with in-memory settings/history, using `createAgentSession` and the caller's `ctx.modelRegistry.runtime` for credentials, OAuth and extension providers. Resources, context files, skills and external extensions are not independently loaded; the inherited prompt carries main's text. An inline forced `before_agent_start` prompt prevents Pi from appending cwd or other sections again.
>   Coordinator text. Reason: reuse Pi sessions and the caller's provider runtime without subprocesses or duplicate resource loading.
>   Carrier: `extensions/RQW-agent/index.ts`, `extensions/RQW-agent/test/agent.test.ts`. Since: `7a9f505`; inherited defaults since `c86e9bb`.

## A-0266 · archived 2026-10-24 · Agent · Accepted limits (sessions only in memory)

Status: SUPERSEDED by the updated `[D-AGENT-LIMITS]` (DECISIONS.md#agent): persisted children survive a Pi restart; the other limits stay.
Introduced: `7a9f505`. Source tree: `main` (`2171049`), the whole entry, verbatim.
Archived by: the agent-async change (stages 1 and 2, branch `agent-async`; stage 1 head `dd93a40`); the commit is `git log -S'A-0266' -- DECISIONS-ARCHIVE.md`.

> - **Accepted limits** `[D-AGENT-LIMITS]`. Results arriving after the caller session ended are lost. Children share the TUI process and may read files the main agent is editing; in-process cancellation cannot forcibly end an uncooperative tool. The process-wide [Context](#context) rule applies while an RQW-context owner exists. GPT Fast inheritance and overrides are defined once under [Settings](#settings).
>   Coordinator text. Reason: these are boundaries of the in-process session design, not unimplemented promises.
>   Carrier: `extensions/RQW-agent/index.ts`; details: [RQW-agent README](extensions/RQW-agent/README.md#wait-status-and-management). Since: `7a9f505`.

## A-0267 · archived 2026-10-24 · Agent · Ordered management and shutdown (bounded fallback for native-idle children)

Status: SUPERSEDED in part by the updated `[D-AGENT-MANAGEMENT]` (DECISIONS.md#agent): a native-idle child waits for its active workers by their completion events with no implicit timeout; the bounded fallback stays for external print/json hosts.
Introduced: `fe0e375`. Source tree: `main` (`11b0fe2`), the whole entry, verbatim.
Archived by: the agent-async change; the commit is `git log -S'A-0267' -- DECISIONS-ARCHIVE.md`.

> - **Ordered management and shutdown** `[D-AGENT-MANAGEMENT]`. Management calls across all three tools register in call order; wait releases that queue after subscription. Start, idle send and restart with task return once prompt preflight starts the run or `compaction_start` makes cancellation effective. Closing clears queues, calls abort and only then disposes, preventing requests after stop or shutdown. Print/JSON use a caller-wide non-consuming fallback wait in `agent_end`, subordinate to explicit waits; native-idle children use the same bounded fallback for their workers. TUI/RPC retain push wakeups. `session_shutdown` closes all descendants without result messages.
>   Coordinator text. Reason: parallel tool batches, pre-run compaction and disposal must not leave unowned requests.
>   Carrier: `extensions/RQW-agent/index.ts`, `extensions/RQW-agent/coordinator.ts`, `extensions/RQW-agent/test/agent.test.ts`; [historical proof](notes/decisions-evidence.md#agent-proof). Since: `fe0e375`.

## A-WEB-PHASE1 · archived 2026-10-24 · Web search CLI

Status: SUPERSEDED IN PART by the shipped web tool and ordinary temporary-file decision in DECISIONS.md#web-search-cli; unchanged mapping/auth/engine obligations are carried forward there.
Source tree: `a85b810e924010f35387045fc0cbbd9a1e7173cc`, the complete section verbatim. Archived by web-search-tool; provenance: `git log -S'A-WEB-PHASE1' -- DECISIONS-ARCHIVE.md`.

> ## Web search CLI
>
> The phase 1 contract of the repository-local `rqw-web` CLI on this task branch, pending merge. Usage and output: [cli/web/README.md](cli/web/README.md). Research with sources, kept outside the repository: `/Users/arkadijcukavin/ai-project/my-pi-evidence/web-search/RESEARCH.md`; exact owner records: `owner-authority.json` next to it. Not a shipped product feature, not a Pi extension and not in `pi.extensions`.
>
> - **Own thin CLI** `[D-WEB-CLI]`. Owner (`16-27-59:4782`, JSONL line 4782): «Надо посмотреть ее кишки, взять ее базу, облегчить ее.» Owner (`16-27-59:4888`, JSONL line 4888): «Это будет просто CLI, которую агент будет вызывать из shell.» Owner (`16-27-59:4917`, JSONL line 4917): «Делаем клон Codex, чтобы наш агент работал с этой хуйнёй так же, как с Codex.» Coordinator text: the owner ordered the CLI and its own lightweight base, so building it is the consent PROCESS asks for before an own mechanism. Ready-made alternatives were researched and not adopted: `pi-web-access` 0.44.0 (MIT, active) carries 9 direct and 208 lock-file dependencies, about 10.3 MB, 39 search providers, MCP, UI, video and GitHub cloning, and its OpenAI path is not the Responses Lite `web.run` mechanism of the current Codex CLI; Codex CLI as a separate product has its own agent environment and does not reuse our Pi credentials and transport; the OpenAI API with a key bills differently and is outside the subscription-only scope. Only ideas are taken from `pi-web-access`: query arrays with bounded concurrency, errors instead of memory answers, redirect safety, token hiding in errors, link deduplication, a temporary full-text file on truncation. Reason: a small tool on the existing subscription auth and native transport, with no second OAuth client. Carrier: `cli/web/`.
> - **One command, one invocation** `[D-WEB-INTERFACE]`. Owner (`16-27-59:4917`): «Если для агента это будет тяжело, то сделай две команды. А если казуально, то оставь одну» Coordinator text: one command is not hard for agents, so it stays one. Repeatable `--query` XOR repeatable `--url`; required `--caller-model provider/id` and `--thinking level`; `--focus` only with `--url`; `--mode cached|live|indexed`, default `cached`; `--response-length short|medium|long`. The answer is a short summary with links to the supporting pages. Owner (`16-27-59:4917`): «Это будет инструмент, который будет доступен всем агентам, и воркеры будут типа нашей матрицы агентов и исполнителей, она никак не меняется.» No new extension and no change of the worker matrix. Carrier: `cli/web/README.md`, the CLI help and repository-only `AGENTS.md`. Shipped system prompts and fixed worker roles do not advertise this development command.
> - **Model mapping** `[D-WEB-MAPPING]`. The canonical table, moved here from BACKLOG; carrier `cli/web/model-map.ts`. Owner (`16-27-59:4941`): «Да, всё именно так, как ты записал.» Owner (`16-27-59:4937`): «Давай так: для Haiku 5.5 будет Luna 5.6. Для Sonnet 5.5 будет Sol 6, а для Opus 5.5 будет Sol 6.1. Вот и всё. Только Sol 6.1 и Sol 6 знаешь как будут соответствовать Haiku? Следующим образом, смотри: Sonnet и Opus: low модель соответствует low модели. Sol 6.1 один к одному соответствует Sonnet. А вот Opus 5.5 и Sol 6.1 соответствуют следующим образом: Opus 5.5 low соответствует Sol 6.1 low, Opus 5.5 medium соответствует Sol 6.1 high, а Opus 5.5 high соответствует Sol 6.1 extra high. Соответственно, все высшие рислинги Opus соответствует Sol 6.1 max.» Owner (`16-27-59:4945`): «И потом в будущем, когда мы сделаем tooling, таблица соответствия модели будет прокидываться автоматически на уровне функционала. Не как аргументы CLI, а на уровне функционала tooling всё это будет пробрасываться, форвардиться» The model rule stays in [D-SCOPE-WEB-SEARCH-MODEL](#scope).
>
>   | Calling model | Search-side model | Thinking |
>   | --- | --- | --- |
>   | Any GPT caller, including `gpt-6-luna` | The same exact model | The same level |
>   | `anthropic/claude-haiku-5-5` | `gpt-5.6-luna` | The same level |
>   | `anthropic/claude-sonnet-5-5` | `gpt-6-sol` | The same level |
>   | `anthropic/claude-opus-5-5` | `gpt-6.1-sol` | `low` -> `low`, `medium` -> `high`, `high` -> `xhigh`, anything above `high` -> `max` |
>
>   Claude `off` and `minimal` have no owner mapping and are rejected with an error, never lowered silently. A GPT level the pinned capability record does not support is an error too.
> - **Engine** `[D-WEB-ENGINE]`. Coordinator technical decision from the source research of Codex CLI 0.164.0 (commit `6aaac694803004a63c6f393d153c96d22521a6b9`): the mapped GPT models use Responses Lite, whose ordinary search path is `function_call web.run` -> `POST alpha/search` -> `function_call_output` -> sourced answer, not the hosted `{type:"web_search"}` tool. The CLI runs that short loop per target as an ephemeral request with only `web.run` allowed, with no Pi `AgentSession`, prewarm, stored history or compaction, so it never enters the compaction path. It imports the pure modules of `extensions/RQW-codex` by path and works with `RQW-codex` switched off; the CLI is not an extension, so the extension isolation rule does not apply to it. The pinned transport stays Codex 0.163.0; no upgrade. Carrier: `cli/web/`.
> - **Credentials, read only** `[D-WEB-AUTH]`. Coordinator decision under the no-`~/.pi`-change rule of this phase: the CLI reads the saved `openai-codex` credential through a read-only store over the public `readStoredCredential`. It uses no private `ModelRuntime.credentials`, copies no auth file and writes nothing. It does not refresh OAuth itself. An expired credential or a 401 ends the target with a clear error that tells the user to start Pi and run `/login openai-codex`, or to use Pi so that it refreshes the grant, then repeat the command. Pi's own ordinary refresh and the RQW-codex recovery stay inside Pi; a forced refresh after 401 needs a write and is not done from the CLI. This limit does not change the mapping or the engine. Carrier: `cli/web/credentials.ts`. Exact behavior: [cli/web/README.md](cli/web/README.md#credentials).
> - **Defaults** `[D-WEB-DEFAULTS]`. These choices are `taken by default` under the night rule, `PROCESS.md` Night default; the owner accepted that rule: «да принимаю это ночное правило про проверку кодекс транспорта или там что то еще?» (`16-27-59:4911`). These are coordinator records, not owner quotations, reversible by the owner: 1. name `rqw-web` and default mode `cached`, `--mode live` for fresh facts; 2. at most three targets run at once, the rest are queued, a normal wave is up to four targets; 3. stdout is capped at 2000 lines or 48 KiB, the earlier wins, and the full normalized result goes to a private temporary file with the path and the next line printed; 4. Claude `off` and `minimal` are rejected as unmapped. Reason: the research recommendations, with a bounded subscription burst and a result that cannot flood the caller's context. The original build request explicitly authorized the small live subscription checks; they were performed and are not repeated for this scope correction, which authorizes no additional live calls.
> - **Phase 1 platform scope** `[D-WEB-PHASE1]`. Coordinator technical scope record under the latest explicit owner-authorized continuation: repository-local development tooling is macOS-only in this phase; Windows belongs to the later shipped package tool wrapper. This records the relayed phase decision, not an owner quotation or a new general OS policy. The eight new web test files use a non-darwin outer-suite skip with the reason `Repo-local development tooling is macOS-only by owner rule; Windows support belongs to later package tool-wrapper phase.` Every in-scope macOS assertion remains, including POSIX private-file mode and the exact raw schema hash; obsolete production-only package-install fixtures are replaced by repo-local dependency, no-registration and fake-expired-auth checks. The old Windows failures remain evidence, not fixed behavior: `/tmp/web-search-ci-failed.log:4198-4233` records the checkout-byte schema hash mismatch and private-file bits `54 !== 0`. Windows CRLF/hash and permission handling are deferred, not changed. Reason: the owner's corrected phase boundary, not a claim that the prior assertions were wrong on macOS. No workflow or delivery-gate change belongs to this CLI task. Carrier: `test/web-cli-{args,batch,credentials,main,output}.test.ts`, `extensions/RQW-codex/test/web-{engine,alpha,schema}.test.ts`, `cli/web/README.md`.
> - **Access for every repository agent** `[D-WEB-ACCESS]`. Phase 1 runs only from a macOS checkout after `npm ci`, with `node /absolute/repo/bin/rqw-web.mjs ...` from any cwd, replacing `/absolute/repo` with the checkout path. Pi 1.4.0, pi-ai 1.4.0 and jiti 2.7.0 are exact local development dependencies; baseline production `ws` and the Pi peer declaration stay unchanged. There is no npm `bin` registration, global link, installer step or `pi.extensions` change. Repository agents learn batching, help, own-model/effort, primary-source, known-URL and untrusted-text rules from `AGENTS.md`. Every agent and fixed worker can execute an exact absolute command supplied in its brief; fixed workers choose no targets, model or thinking, and their model matrix stays unchanged. Normal `INSTALL.md` package installation does not expose this CLI. Carrier: `package.json`, `bin/rqw-web.mjs`, `AGENTS.md`, `cli/web/README.md`.
> - **Future shipped tool and Windows** `[D-WEB-TOOL-LATER]`. Phase 2 is the separate shipped Pi tool wrapper with Windows support, not built in phase 1; it is the open item WEB-SEARCH-TOOL in [BACKLOG](BACKLOG.md#web-search-tool). It reuses the CLI core and applies the mapping from the session itself. Windows permissions and checkout-byte hash behavior are not claimed supported.
>
> Since: web-search-cli squash.
## A-0268 · archived 2026-10-24 · Local delivery gate · D-WORK-THIRD-PARTY

Status: SUPERSEDED in its delivery-test requirements by `[D-PIPELINE-LOCAL-GATE]` (DECISIONS.md#task-pipeline).
Provenance: verbatim DECISIONS.md entry at base commit `a85b810`; replaced by the local-delivery-gate squash.

> - **Third-party installation fast path** `[D-WORK-THIRD-PARTY]`. Install agreed third-party libraries/extensions
>   into the owner's Pi immediately, then add them to the my-pi package; this alone authorizes the needed ~/.pi
>   changes. Light self-review for unintended additions, commit and push main replace the full delivery pipeline,
>   CI gate and independent reviews for this narrow configuration path, not our own implementations.
>   Owner (`16-27-59:4782`, entry `f73155f0`):
>   «Я хочу, чтобы ты так же, как мы работаем над нашими задачами по этому репозиторию, мог ставить в этот репозиторий, в нашу сборку MyPy сторонние библиотеки, сторонние экстеншены. И мне надо, чтобы ты делал это суперреактивно: чтобы ты сначала ставил локально, чтобы оно локально уже работало прямо сейчас, а потом чтобы ты уже её парковал именно в репозитории, добавлял в сетап. И там не надо делать какой-то жёсткий pipeline всяких проверок, тестов и прочей хуйни. Надо просто добавить config, сделать commit push и лёгким саморевьюром проверить, что всё заебись, что нет никакой хуйни лишней.»
>   Coordinator text, question answered by the owner's approval: "1a: put the extension in the my-pi package,
>   not only in INSTALL.md." Owner (`16-27-59:4789`, entry `de383e38`):
>   «Да»
>   Reason: make the accepted external tool usable now without treating configuration as original feature work.
>   At first use decide package bundling against Pi documentation; no mechanism is chosen in advance.
>   Carrier: [PROCESS.md, Third-party installation fast path](PROCESS.md#third-party-installation-fast-path).
>   Since: process-rules-oct23 squash.
>
> Execution rules live in [PROCESS.md](PROCESS.md); an entry here keeps the owner's words, the reason and a link.

## A-0269 · archived 2026-10-24 · Local delivery gate · D-WORK-CI-LOGS

Status: SUPERSEDED in its delivery-test requirements by `[D-PIPELINE-LOCAL-GATE]` (DECISIONS.md#task-pipeline).
Provenance: verbatim DECISIONS.md entry at base commit `a85b810`; replaced by the local-delivery-gate squash.

> - **Heavy checks in CI, saved logs** `[D-WORK-CI-LOGS]`. Owner (`16-27-59:992`, then `16-27-59:1042`):
>   «Сделай так, чтобы у тебя были логи числа прогонов на Mac. Это что за хуйня? Такого не должно быть.»
>   «Ты запускаешь тесты или что? Ты не можешь проверить это? Это что за хуйня? Почему так, блядь?»
>   «Если ты делаешь какие-то тесты, пробы, нагрузки тяжёлые, именно процессорные, то их лучше прогонять в CI/CD, чтобы наш MacBook Air не охуевал. Не лучше, а надо их прогонять в CI/CD.»
>   «Нет нихуя не надо это была корректировка именно процесса на будущеее и того что что бы у тебя сохранялись логи»
>   Reason: CPU-heavy verification stays off the owner's MacBook Air and every reported number has an auditable log; a
>   future work policy, not a measurement request. Carriers:
>   [PROCESS.md, Sufficient proof](PROCESS.md#sufficient-proof-without-idle-reruns), [Delivery](PROCESS.md#delivery),
>   `.github/workflows/tests.yml`. Since: `fb322d9`.

## A-0270 · archived 2026-10-24 · Local delivery gate · D-WORK-CHECKS-ONCE

Status: SUPERSEDED in its delivery-test requirements by `[D-PIPELINE-LOCAL-GATE]` (DECISIONS.md#task-pipeline).
Provenance: verbatim DECISIONS.md entry at base commit `a85b810`; replaced by the local-delivery-gate squash.

> - **Checks once** `[D-WORK-CHECKS-ONCE]`. Relevant checks run once and their evidence is reused while inputs are
>   unchanged; no Linux requirement; docs-only work needs no tests; a squash of the tested head is not retested. Windows
>   Node tooling runs through Git Bash; the existing CI `pwsh` bootstrap is allowed infrastructure. Reason: no idle
>   reruns. Carrier: [PROCESS.md, Sufficient proof](PROCESS.md#sufficient-proof-without-idle-reruns). Since: `8f2ea64`.

## A-0271 · archived 2026-10-24 · Local delivery gate · D-WORK-DELIVER-CHECK

Status: SUPERSEDED in its delivery-test requirements by `[D-PIPELINE-LOCAL-GATE]` (DECISIONS.md#task-pipeline).
Provenance: verbatim DECISIONS.md entry at base commit `a85b810`; replaced by the local-delivery-gate squash.

> - **Deterministic delivery quality** `[D-WORK-DELIVER-CHECK]`. Owner (`16-27-59:440`, approval `16-27-59:450`):
>   «Теперь смотри насчет выполнения задач и пробелов, которые ты нашел. Я же не буду всегда тебя переспрашивать. Если бы я не спросил, ты бы об этом не узнал. Надо поэтому сделать какой-то процесс, как детерминированно эту проблему решить на постоянке, чтобы мне не надо было тебя постоянно переспрашивать, чтобы ты сам следил за качеством. Надо твое предложение по тому, как мы этот пробел будем закрывать.»
>   «Правила по Process MD я одобряю»
>   Coordinator text, the approved proposal in short (the verbatim text is in `DECISIONS-ARCHIVE.md`, A-0246): 1. test exactly
>   what is merged, rebased onto a fresh `main`, with the tests on the final commit (the Windows part is replaced by
>   [D-PIPELINE-MAC-GATE]); 2. a review covers only the commit it checked; 3. before every merge `deliver-check` checks the
>   branch contains current `main`, the CI of that exact commit (the macOS jobs, see [D-PIPELINE-MAC-GATE]), the review
>   numbers with CLEAN and the list of what was not verified live; 4. every report carries an evidence table and an honest
>   "not verified live" section.
>   Coordinator text, interpretation of rule 2: a conflict-free rebase onto `main` needs new tests and CI on the new head
>   but no new review; places changed while resolving conflicts go back to review.
>   Reason: branches tested alone were squashed onto a moved `main`, and a code-review CLEAN once covered an earlier commit
>   while two later fixes landed unreviewed. Carriers: [PROCESS.md](PROCESS.md) (Sufficient proof, Independent review,
>   Delivery), `scripts/deliver-check.mjs`, `test/deliver-check.test.ts`. Since: `47868b0`.

## A-0272 · archived 2026-10-24 · Local delivery gate · D-PIPELINE-SLOTS

Status: SUPERSEDED in its delivery-test requirements by `[D-PIPELINE-LOCAL-GATE]` (DECISIONS.md#task-pipeline).
Provenance: verbatim DECISIONS.md entry at base commit `a85b810`; replaced by the local-delivery-gate squash.

> - **Active slots and waiting tasks** `[D-PIPELINE-SLOTS]`. Only active execution holds one of the three slots. A task
>   that waits for CI, a reviewer, the merge queue or the owner holds none. A red required CI (a red macOS job of `tests.yml`, or
>   `pcli.yml` for `pcli-vscode`; not an advisory Windows job) sends the task to the top of the
>   queue; at the next free active slot its existing agent is resumed, and another is started only if its
>   session no longer exists. Owner (`16-27-59:5060`): «7 надо чет пиздатое придумать, по типу пятого пункта или же делать всегда но не делать из этого блокер, т.е. не ждать, свичиться на след задачу и переключаться интелекетуально как релаьный прогер»
>   «Работа должна быть суперконвейерная, суперэффективная, производительная, супербыстрая, без дрочи.»
>   Owner (`16-27-59:5068`) answered the quoted coordinator text with: «Делаем, да»
>   Coordinator text, the pipeline proposal (`16-27-59:5061`, formatting marks removed): "Про CI предлагаю конвейер, как у живого программиста, но без красного `main`. Агент доделал задачу, проверки чистые, ветка ушла в CI. Задача переходит в ожидание и место в тройке не занимает. Агенты сразу берут следующую задачу. Ожидающие задачи держит агент слияний. Зелёный CI он вливает сам. После сдвига `main` он заново гоняет CI тоже в фоне, никого не держа. Если CI красный, задача возвращается в начало очереди, и следующий освободившийся агент её чинит. Отличие от твоего варианта одно: вливаем после зелёного CI, а не до. Скорость та же, потому что никто не ждёт, а в `main` не попадает непроверенный код."
>   Coordinator text, the slot summary the owner quoted: "Получается так: три места только для активной работы. Задачи, которые ждут CI, проверку или тебя, места не занимают. Агент слияний и скрипт CI идут сбоку."
>   Reason: waits for CI, review and the owner idled slots; the analysis found CI and queue waits to be the largest
>   removable delay. Carrier: [PROCESS.md, Task pipeline](PROCESS.md#task-pipeline) and
>   [Isolated parallel execution](PROCESS.md#isolated-parallel-execution), replacing the former plain "three tasks at the
>   same time" wording of [D-WORK-PARALLEL].
>   Since: process-pipeline squash.

## A-0273 · archived 2026-10-24 · Local delivery gate · D-PIPELINE-MERGE-TRAIN

Status: SUPERSEDED in its delivery-test requirements by `[D-PIPELINE-LOCAL-GATE]` (DECISIONS.md#task-pipeline).
Provenance: verbatim DECISIONS.md entry at base commit `a85b810`; replaced by the local-delivery-gate squash.

> - **One merge agent, fixed order** `[D-PIPELINE-MERGE-TRAIN]`. One agent integrates branches in an order fixed in
>   the current session queue. It rebases onto current `main`, lets CI run in the background, and merges only when the macOS jobs on the exact
>   head are green and `deliver-check` passes ([D-PIPELINE-MAC-GATE]). Owner: «2а 3а» (item 3 a). Coordinator text, option 3a: "Слияниями занимается один агент в заранее заданном порядке. Повторов меньше, каждая итоговая версия проверяется."
>   Reason: moved `main` forced repeated final CI on ready branches. The exact-head gate stays for the macOS jobs: nothing untested is
>   merged. Carrier: [PROCESS.md, Task pipeline](PROCESS.md#task-pipeline) and [Delivery](PROCESS.md#delivery).
>   Since: process-pipeline squash.

## A-0274 · archived 2026-10-24 · Local delivery gate · D-PIPELINE-CI-WATCHER

Status: SUPERSEDED in its delivery-test requirements by `[D-PIPELINE-LOCAL-GATE]` (DECISIONS.md#task-pipeline).
Provenance: verbatim DECISIONS.md entry at base commit `a85b810`; replaced by the local-delivery-gate squash.

> - **Shared CI watcher** `[D-PIPELINE-CI-WATCHER]`. Owner (`16-27-59:5060`): «Окей, насчёт одного скрипта раз в минуту я согласен.»
>   One repo-local script, `npm run ci-watch`, reads all recent runs once a minute and atomically writes
>   `<git common dir>/ci-watch/status.json`. Agents read the file instead of calling `gh`; a file older than 3 minutes
>   is restarted with `npm run ci-watch -- --restart`; a fresh exact-head check before every merge stays in
>   `deliver-check`. The minute poll reads runs only; the open `qa-inbox` issues are an explicit separate read, `npm run ci-watch -- --refresh-inbox`
>   (`inbox.json`), run at triage, task takeover or after an issue change, not per agent. It replaces independent per-agent `gh` polling and the 10-minute per-process status cache of the
>   `qa-status` extension. Coordinator text, the explanation of how it works (`16-27-59:5061`): "Да, скрипт только для этого репозитория и только на твоём Mac, в наш продукт он не попадает. Помогает он так. Сейчас каждый агент сам спрашивает GitHub о своём прогоне, и десяток агентов съедают лимит. Скрипт одним запросом раз в минуту получает статус всех свежих прогонов репозитория и пишет его в файл, а агенты читают файл и в GitHub больше не ходят. Гонок не будет: скрипт запускается в одном экземпляре через метку, как координатор; файл он пишет целиком через переименование; если скрипт упал, файл устаревает, и следующий агент перезапускает скрипт."
>   Reason: independent pollers hit the GitHub limit and stopped every agent for at least 13 minutes (report). The file is
>   awareness only, never merge proof. Carrier: `scripts/ci-watch.mjs`, `scripts/qa-status.mjs`,
>   `scripts/deliver-check.mjs`, `.pi/extensions/qa-status/`, [PROCESS.md, Task pipeline](PROCESS.md#task-pipeline).
>   Since: process-pipeline squash.

## A-0275 · archived 2026-10-24 · Local delivery gate · D-PIPELINE-TEXT-CLASSES

Status: SUPERSEDED in its delivery-test requirements by `[D-PIPELINE-LOCAL-GATE]` (DECISIONS.md#task-pipeline).
Provenance: verbatim DECISIONS.md entry at base commit `a85b810`; replaced by the local-delivery-gate squash.

> - **Three classes of text change** `[D-PIPELINE-TEXT-CLASSES]`. Proofreading is checked locally with no independent
>   review and no application CI; a change of meaning gets review; runtime prompts are checked by agent behavior. Owner:
>   «2а 3а» (item 2 a). Coordinator text, option 2a: "Опечатки и правки формулировок проверяются локально. Изменения смысла идут на проверку. Рабочие промпты проверяются по поведению агента. Быстрее, а контроль остаётся."
>   The report's extra idea of dropping extension READMEs from application CI was not part of the chat option and is not
>   adopted; READMEs still need CI and code review. Reason: the 39-file documentation cleanup spent at least 50 minutes
>   of CI and found 9 real inconsistencies by review, so meaning review stays. Carrier:
>   [PROCESS.md, Independent review](PROCESS.md#independent-review), `scripts/deliver-check.mjs` (`Change-class:`,
>   `Doc-check:`). Since: process-pipeline squash.

## A-0276 · archived 2026-10-24 · Local delivery gate · D-PIPELINE-MAC-GATE

Status: SUPERSEDED in its delivery-test requirements by `[D-PIPELINE-LOCAL-GATE]` (DECISIONS.md#task-pipeline).
Provenance: verbatim DECISIONS.md entry at base commit `a85b810`; replaced by the local-delivery-gate squash.

> - **macOS gates the merge, Windows is advisory** `[D-PIPELINE-MAC-GATE]`. A merge needs every returned `macos-latest` job
>   of `tests.yml` green on the exact head and the expected macOS matrix fully present. The Windows jobs keep running, are not cancelled in the final run and are advisory:
>   a red Windows job neither has to be fixed before the merge nor blocks delivery. An agent explicitly creates or triages a
>   `qa-inbox` issue for it, or a failed scheduled or dispatched `main` run is picked up by `qa-inbox.yml`; no issue is
>   created automatically, and `ci-watch -- --refresh-inbox` only reads existing issues into the local snapshot. The workflow's overall result is not required green. Owner
>   (`16-27-59:5269`, entry `e3ac659f`): «надо обойти эти ошибки подумай»
>   Owner (`16-27-59:5273`, entry `815dd5b0`), about the Windows CI failures: «они не должны блокировать нас»
>   Coordinator text (`16-27-59:5277`, entry `1e8c825d`), formatting marks removed: "Принял: падения на Windows больше не блокируют слияния. Для слияния нужен зелёный CI на Mac. Windows-проверки продолжают запускаться, но только для информации. Каждое их падение уходит в копилку задачей и встаёт в очередь. Одно исключение: правки плагина для VS Code, который работает только на Windows, по-прежнему ждут его собственной проверки. Это идёт в правку конвейера. Веб-поиск сольётся уже по этому правилу."
>   Owner (`16-27-59:5309`, entry `1bbe27c1`), what happens to the ignored failures: «нужно все косяки Windows-тестов в конец бэклога засунуть, чтобы он их потом фиксил, чтобы они не были заброшены, чтобы Windows тоже поддерживалась, доводилась до конца.»
>   Coordinator text (`16-27-59:5312`, entry `4cf73f93`), formatting marks removed: "Да, все падения Windows будут уходить в конец бэклога, ни одно не потеряется. Это часть правила: агент слияний записывает каждое такое падение задачей со ссылкой на прогон. В бэклоге появится общий пункт 'Падения тестов на Windows' со всем известным сейчас: 1. нестабильные тесты фоновых задач;"
>   Obligation, the same for every ignored failure and no new automation: before the delivery closes, the merge agent
>   records each ignored Windows failure as a tail `BACKLOG.md` item (umbrella `WINDOWS-TEST-FAILURES`) or a linked
>   `qa-inbox` issue. If Windows jobs still run at the merge, it keeps tracking the run in the background without an
>   active slot and without model polling turns, and records a later failure the same way, so branch deletion loses nothing.
>   Coordinator narrow exception, coordinator text and not an owner quote: the `pcli-vscode` change, a product that runs only
>   on Windows, still waits for a green `pcli.yml` run on the exact head.
>   Supersedes the Windows part of [D-WORK-DELIVER-CHECK] (original in `DECISIONS-ARCHIVE.md`, A-0246) and the Windows
>   wording of [D-WORK-CI-LOGS] and [D-WORK-CHECKS-ONCE]. Reason: Windows timing failures blocked unrelated work; they are
>   tracked in the inbox ([D-PIPELINE-FLAKE-SKIP]) instead. Carrier: [PROCESS.md, Task pipeline](PROCESS.md#task-pipeline) and
>   [Delivery](PROCESS.md#delivery), `scripts/deliver-check.mjs`. Since: process-pipeline squash.

## A-0277 · archived 2026-10-24 · Golden rule: no avoidable token spending

Status: SUPERSEDED by `[D-WORK-GOLDEN-RULE]` in DECISIONS.md.
Source: `c101637:DECISIONS.md`, lines 75-98, whole entry verbatim.
Original provenance: process-pipeline squash.
Archived by: subagent-profiles; introducing archive commit: `git log -S'A-0277' -- DECISIONS-ARCHIVE.md`.

> - **Golden rule: no avoidable token spending** `[D-WORK-GOLDEN-RULE]`. A standing design and review requirement for the
>   harness and for the development workflow: spend no tokens where they can be avoided (no polling, no model turns
>   spent only waiting, no repeated reads or reviews without new input); every solution is engineered, thought through,
>   efficient, optimal and as simple as possible, with its trade-offs weighed and balanced to reach the right decision.
>   Owner (`16-27-59:5096`, entry `4a276e33`): «Мы вообще не должны тратить токены там, где мы токены можем не тратить. Это золотое правило нашего workflow разработки этого майпи харнеса.»
>   «Все должно быть суперинженерно, суперпродуманно, эффективно, оптимально и самым простым способом. Мы ищем баланс и разбираем трейд-оффы в реализации для того, чтобы принять правильное решение.»
>   Owner (`16-27-59:5107`, entry `5f6049b7`), where to record it: «Это еще можно зафиксировать в системном промте про золотое правило: не тратить токены там, где их можно не тратить, чтобы работать максимально эффективно и инженерно.»
>   Owner (`16-27-59:5111`, entry `8295a6f4`), on designing the first optimisation: «Короче, надо подумать, как следует сделать всё пиздато, максимально в соответствии с нашим манифестом workflow, с нашими стандартами качества и работы»
>   Owner (`16-27-59:5119`, entry `f6282fe9`), no reread to verify an own successful edit: «Когда мы правки делаем, мы знаем, в каких строках что должно быть написано. И если справка легла правильно, то мы знаем о том, что у нас там всё исправлено и всё. Не надо вообще читать файл для этого.»
>   This ships as one line in the `edit` and `write` descriptions and in `extensions/RQW-prompt/SYSTEM.md`: a successful
>   edit or write means the file holds the new text; do not reread it only to verify.
>   Follow-up read cache, approved and built directly with no pre-build measurement or trial:
>   [D-TOOLS-UNCHANGED-READ](#tools), reviewed at merge plus 3 days in
>   [BACKLOG.md](BACKLOG.md#token-efficiency-review). Coordinator question (`16-27-59:5122`): "Его делаем после веб-поиска?"
>   Owner (`16-27-59:5123`, entry `d0a9a090`): «да» Owner (`16-27-59:5131`, entry `1b3abc69`) on the mechanism: «Эта механика должна быть абсолютно полностью инженерной.»
>   Owner (`16-27-59:5135`, entry `171f4d82`), no trials: «через три дня после merge надо будет сделать review всех старых сессий на предмет того, помогло нам это или нет. И всё. Не будем никаких делать испытаний и прочей хуйни.»
>   Coordinator text (`16-27-59:5138`): the unchanged note only if the last read of the same range was at most 10 turns
>   and at most 30000 context tokens ago, otherwise full content.
>   Reason: tokens are a cost the owner wants spent only where nothing simpler works. Carriers:
>   [PROCESS.md, Golden rule](PROCESS.md#golden-rule), the owner's own record in
>   [WORKFLOW-MANIFEST.md](WORKFLOW-MANIFEST.md#золотое-правило), the code reviewer `.agents/reviewers/code.md`, the
>   review criterion line of every brief (`extensions/RQW-review/REVIEWER.md` already checks custom criteria), and the
>   product line in `extensions/RQW-prompt/SYSTEM.md` (a separate agent edits it with its prompt test).
>   Since: process-pipeline squash.

## A-0278 · archived 2026-10-24 · Temporary Sonnet-only Anthropic subagents

Status: SUPERSEDED by `[D-WORK-TEMP-GPT]` in DECISIONS.md.
Source: `c101637:DECISIONS.md`, lines 116-122, whole entry verbatim.
Original provenance: process-rules-oct23 squash.
Archived by: subagent-profiles; introducing archive commit: `git log -S'A-0278' -- DECISIONS-ARCHIVE.md`.

> - **Temporary Sonnet-only Anthropic subagents** `[D-WORK-TEMP-SONNET]`. The temporary restriction and its explicit
>   expiry live in [PROCESS.md, Subagent models](PROCESS.md#subagent-models). After expiry the normal table applies.
>   Owner (`16-27-59:4789`, entry `de383e38`):
>   «Да, и временно нужно до конца недели из subagent убрать Opus, использовать только Sonnet. Надо зафиксировать это до вечера среды. Сейчас у нас 11:25 p.m. пятницы, и мы до следующей среды, до 19:00, не используем Opus модели с subagent в этой связке координатора, именно в этом проекте, в работе над проектом.»
>   Reason: limit Opus usage during project development. Carrier: PROCESS coordinator-rules and the dev guard.
>   The arbiter title allowance in PROCESS is not general subagent permission.
>   Since: process-rules-oct23 squash.

## A-0279 · archived 2026-10-24 · Development subagent models

Status: SUPERSEDED by `[D-WORK-MODELS]` in DECISIONS.md.
Source: `c101637:DECISIONS.md`, lines 185-225, whole entry verbatim.
Original provenance: see the verbatim entry below
Archived by: subagent-profiles; introducing archive commit: `git log -S'A-0279' -- DECISIONS-ARCHIVE.md`.

> - **Development subagent models** `[D-WORK-MODELS]`. Rule for developing this repository with agents only, as the
>   owner confirmed; it is not a product model setting and not a rule for the rest of Pi. Three task classes:
>   ordinary, complex, and the hardest and most important. The classes, their model and reasoning pairs and the
>   machine-readable settings live only in the `coordinator-rules` JSON block of
>   [PROCESS.md, Subagent models](PROCESS.md#subagent-models); this entry does not repeat the pairs. Main starts only
>   ordinary `agent` subagents, gives `model` and `thinking` explicitly on every start and restart, and never starts
>   `explore` itself. Explorers and `review` are used by the subagents Main starts. The even Anthropic/GPT balance stays
>   (entry below). Product review `LEVELS` is unchanged.
>   Owner's messages or contiguous spans from the session file
>   `2026-10-21T16-27-59-062Z_01a15f4a-7ad5-7377-81be-0baf3b6ffa33.jsonl`; the physical JSONL line is named before
>   each. The second message cancels the Opus 5.5 low part of the first; the last message is the final table.
>   Line 4162:
> «Короче, по моделям. Сейчас, смотри, как я тебе скажу. Новые модели сабоагентов используешь для сложных задач: Sol-6.1 High и Opus Medium. Для простых задач используешь Opus Low и Sonnet High. Смотри, самая тупая модель — Opus Low, потом идёт Sonnet High. Это для простых задач. Для сложных задач — Opus Medium. Теперь по чату GPT-6.1. Sol Low для простых задач, Sol Medium для простых задач. Нет, не так. Смотри, по-другому. Для простых задач Opus Low и Sol Low. Для сложных задач это Sol Medium, Sol High либо Sonnet High, Opus Medium. Как понял, подтверди, пожалуйста.»
>   Line 4179:
> «Не, нихуя отмена! Простые задачи не Opus 5.5 low, а Sonnet 5.5 medium. У тебя Sonnet 5.5 medium и Sol 6.1 low. Вот так.
>
> Opus 5.5 Low — это слишком дорого»
>   Line 4183, the scope:
> «Но это касается только нашего с тобой Process MD. Это не на весь наш Pi, а именно на нашу репозиторию текущую, по нашему Process MD. Ты же понимаешь это, да или нет?»
>   Line 4188:
> «Да, и надо ещё чётко сконфигурировать, записать, отразить в правилах работы агента, что сложные задачи OPUS 5.5 Medium, Sonnet High и Sol 6.1 Medium, Sol 6.1 High. Я не знаю, понятно тебе это или нет, но OPUS 5.5 Medium в разы сильнее, чем Sonnet High. Если сложные делить на простые и ещё более сложные, если делить сложные на задачи попроще и посложнее, то посложнее делает Medium, а Sonnet High делает попроще. Ты это понимаешь, надеюсь, или нет? Потому что с Sol 6.1 всё понятно: там Medium слабее, а High сильнее.
>
> Это очень важно, чтобы не было такого, что ты на сложные задачи захуяриваешь solve high, а на более простые solve medium, блядь.
>
> Мне важно в этом плане с тобой, чтобы у нас была согласованность полная»
>   Line 4203, the final answer:
> «Да, ты прав. Это противоречие очень жёсткое и важное. Давай так сделаем. Смотри: Opus Medium и Soul High работают с самыми сложными задачами, а просто со сложными задачами работает Sonnet High и Soul Medium. Давай сделаем.
>
> У нас есть обычные задачи, сложные задачи и очень сложные, очень важные задачи. Так яснее?
> Я решил конфликт или еще нет?
>
> А почему у тебя дети молча получают родительскую модель? Такого не должно быть. Ты детей назначаешь сам. У тебя единственный, кто получает родительскую модель — это Explorer. Explorer получает родительскую модель, но это в обычной работе. А ты координатор, ты работаешь отдельно, у тебя другой flow, свой собственный. Понимаешь разницу?»
>   Final table, a separate contiguous span of the same message:
> «Ответы на твои вопросы. Простые задачи: Sonnet Medium и Sol 6.1 Low. Сложные задачи: Sonnet 5.5 High, Sol 6.1 Medium. И самые тяжёлые и самые важные задачи: Opus 5.5 Medium и Sol 6.1 High.»
>   Coordinator reading (agent text, not owner words): the final table is in the line 4203 message; it adds the third
>   class, the hardest and most important tasks; the Opus 5.5 low of line 4162 is cancelled. Main does not start
>   `explore`, while its subagents may use it.
>   Reason: owner decision, and the rule must not be lost again, so it has one source and a mechanical guard.
>   Carriers: [PROCESS.md, Subagent models](PROCESS.md#subagent-models) (the JSON block and the rules); the dev-only
>   project extension `.pi/extensions/coordinator-guard/` (Main's top-level session in this checkout only).
>   Superseded earlier entries: `DECISIONS-ARCHIVE.md`, A-0001 to A-0004.

## A-0280 · archived 2026-10-24 · Temporary result-review route

Status: SUPERSEDED by `[D-REVIEW-PROFILES]` in DECISIONS.md.
Source: `c101637:DECISIONS.md`, lines 284-293, whole entry verbatim.
Original provenance: `9b93931`.
Archived by: subagent-profiles; introducing archive commit: `git log -S'A-0280' -- DECISIONS-ARCHIVE.md`.

> - **Temporary result-review route** `[D-WORK-TEMP-REVIEW]`. While RQW-review is disabled, result review runs through an
>   `agent` subagent with the new reviewer text and the trailer `Review: agent#N CLEAN`. Coordinator text, the question
>   (`16-27-59`, before line 2042): "Слияния, пока ревьюер выключен ... a) Маленькой правкой научить проверку перед слиянием принимать ревью субагентом с текстом ревьюера, с честной отметкой agent#N. В процессе записать, что так делаем, пока ревьюер выключен."
>   Owner (`16-27-59:2042`, `16-27-59:2049`, and earlier `16-27-59:1849`):
>   «1а»
>   «только с текстом нового ревьюера»
>   «Сейчас ревьюеров надо отключить, пока мы их не дотюнили.»
>   Reason: the gate needs an honest result-review trailer while the reviewer is off. Carriers:
>   [PROCESS.md, Independent review](PROCESS.md#independent-review), `scripts/deliver-check.mjs`,
>   `test/deliver-check.test.ts`. Since: `9b93931`.

## A-0281 · archived 2026-10-24 · Postponed features

Status: SUPERSEDED by `[D-SCOPE-POSTPONED]` in DECISIONS.md.
Source: `c101637:DECISIONS.md`, lines 551-555, whole entry verbatim.
Original provenance: `d28ae41`.
Archived by: subagent-profiles; introducing archive commit: `git log -S'A-0281' -- DECISIONS-ARCHIVE.md`.

> - **Postponed features** `[D-SCOPE-POSTPONED]`. Postponed, not dropped: `codebase_explorer`, `custom`, the
>   `define-goal` skill and work orders, and the task list with the check before stopping (later switched on by a skill).
>   Coordinator text (historical unverified attribution): "мы их не упраздняем, а откладываем". Status of each item:
>   [BACKLOG.md](BACKLOG.md). The `agent` and `review` tools are separate decisions:
>   [Agent](#agent), [Review](#review). Since: `d28ae41`.

## A-0282 · archived 2026-10-24 · Reviewers

Status: SUPERSEDED by `[D-SCOPE-REVIEWERS]` in DECISIONS.md.
Source: `c101637:DECISIONS.md`, lines 556-559, whole entry verbatim.
Original provenance: `3dce6fa`.
Archived by: subagent-profiles; introducing archive commit: `git log -S'A-0282' -- DECISIONS-ARCHIVE.md`.

> - **Reviewers** `[D-SCOPE-REVIEWERS]`. Review is our own extension `RQW-review` on `createAgentSession`, not a ready
>   package; its contract, levels and models are in [Review](#review). Coordinator text (historical unverified attribution): "То, что ты предложил по ревьюерам — it's OK, я принимаю". Reason: the ready package was too large and failed
>   strict schemas ([notes/decisions-evidence.md](notes/decisions-evidence.md#scope-reviewer-package-sizing)). Carrier:
>   `extensions/RQW-review/`. Since: `3dce6fa`.

## A-0283 · archived 2026-10-24 · Enable the ready interface now

Status: SUPERSEDED by `[D-UI-ENABLE-NOW]` in DECISIONS.md.
Source: `c101637:DECISIONS.md`, lines 575-586, whole entry verbatim.
Original provenance: see the verbatim entry below
Archived by: subagent-profiles; introducing archive commit: `git log -S'A-0283' -- DECISIONS-ARCHIVE.md`.

> - **Enable the ready interface now** `[D-UI-ENABLE-NOW]`. Owner: «1а».
>   Source: `2026-10-21T16-27-59-062Z_01a15f4a-7ad5-7377-81be-0baf3b6ffa33.jsonl`, USER entry
>   `4035f0a6`, `2026-10-23T19:05:12Z`, under the repository session directory named in Provenance.
>   Coordinator text, option a, assistant entry `60ca78d9`, `2026-10-23T19:03:52Z`:
>   Включить сейчас всё готовое вместе с карточками агентов, а карточку ревьюера добавить позже, когда будет новый ревьюер. Ты получишь интерфейс в ближайшие часы.
>   Register thinking, naming, agent-ui and tool-ui now; statusbar is already registered.
>   Change of circumstances, coordinator text, not an owner answer: the owner answered 1а while the new reviewer was
>   still open. Since then the new reviewer has landed on `main` (`11b0fe2`), so the review card T14 is no longer
>   deferred. It is part of the same switch-on and is delivered with `RQW-agent-ui`: cards for `agent`
>   and for `[review#N]` results, matched to the new reviewer's output.
>   Reason: deliver the ready interface at once; the one deferred part became ready before delivery.
>   Carriers: `package.json`, `extensions/RQW-agent-ui/`.

## A-0284 · archived 2026-10-24 · Renderer order

Status: SUPERSEDED by `[D-UI-RENDERER-ORDER]` in DECISIONS.md.
Source: `c101637:DECISIONS.md`, lines 587-599, whole entry verbatim.
Original provenance: see the verbatim entry below
Archived by: subagent-profiles; introducing archive commit: `git log -S'A-0284' -- DECISIONS-ARCHIVE.md`.

> - **Renderer order** `[D-UI-RENDERER-ORDER]`. Technical decision under the activation approval above:
>   preserve the existing extension order, then append `RQW-thinking`, `RQW-naming`, `RQW-agent-ui`, `RQW-tool-ui`.
>   Pi 1.4.0 `dist/core/extensions/loader.js` `loadExtensionsInternal` initializes paths in order;
>   `runner.js` `resolveToolRenderers` calls resolvers in load order with `next()` delegating to later resolvers.
>   Thus agent-ui is the outer resolver. With both agent-ui and tool-ui loaded, a collapsed wait result is
>   tool-ui's: the summary part `Waited for N agents` and the live block `wait <ids>`, per the owner's wait amendment
>   "1а 2а". Owner words as recorded in the UI-port ledger; the source session file is no longer on disk, so the span is not machine-verified (taken by default). agent-ui delegates to `next()` while collapsed. On Ctrl+O it draws its own box with the expanded wait
>   cards: header with id, status, model, effort and seconds, then the full answer verbatim. With tool-ui off,
>   agent-ui shows its collapsed wait cards. The order is explicit and tested, not a claim that reversing it
>   gives the same result.
>   `getMessageRenderer` returns the first matching extension renderer; agent-ui owns `agent`
>   and `[review#N]` results. Thinking and naming register no competing tool/message renderer and keep the existing producers first.
>   Reason: preserve independent cards and compact tools without changing execution. Carrier: `package.json`.

## A-0285 · archived 2026-10-24 · Delivered results, not an agent board

Status: SUPERSEDED by `[D-UI-AGENT-CARDS]` in DECISIONS.md.
Source: `c101637:DECISIONS.md`, lines 636-651, whole entry verbatim.
Original provenance: see the verbatim entry below
Archived by: subagent-profiles; introducing archive commit: `git log -S'A-0285' -- DECISIONS-ARCHIVE.md`.

> - **Delivered results, not an agent board** `[D-UI-AGENT-CARDS]`. Owner: "Да с сабагентами +".
>   Source: the `18-16-12` session file named above, USER entry `96231cbd`, line 243. Owner words as recorded in the UI-port ledger; the source session file is no longer on disk, so the span is not machine-verified (taken by default).
>   Agent custom results show compact cards: ID, outcome, available actual
>   model/effort/duration, then the first nonempty answer line. Missing metadata stays omitted. The review card
>   (T14) is delivered with `RQW-agent-ui`: `[review#N]` results show a card matched to the new reviewer's output.
>   Delivered wait results: with both agent-ui and tool-ui loaded, the collapsed result is tool-ui's (summary part
>   `Waited for N agents`, live block `wait <ids>`) and Ctrl+O shows agent-ui's expanded wait cards, each with
>   id, status, model, effort, seconds and the full answer verbatim; with tool-ui off, agent-ui shows its
>   collapsed wait cards. Stored content, execution and delivery do not change. A card shows one delivered
>   result as finished or failed, never a live agent state. There is no agent list, board or child-log view.
>   T17 cards belong to agent-ui, T18 indicator to statusbar: actual running counts by agents/reviews come
>   from the existing activity producer, not a second registry in the cards. Ordinary busy letters shimmer silver;
>   compaction status and synchronized chrome shimmer gold; fully idle is a continuous rule. Title stays static gold.
>   The indicator's existing decision is [D-STATUSBAR-ACTIVITY](#status-bar).
>   Reason: readable delivered answers, independently switchable from activity. Carriers: `extensions/RQW-agent-ui/`,
>   `extensions/RQW-agent/activity.ts`, `extensions/RQW-statusbar/`, `package.json`, `INSTALL.md`.

## A-0286 · archived 2026-10-24 · Background jobs

Status: SUPERSEDED by `[D-TOOLS-BG]` in DECISIONS.md.
Source: `c101637:DECISIONS.md`, lines 919-1001, whole entry verbatim.
Original provenance: `e5440f2`; scan and footprint safeguards since `e1cca48`; handoff independence and notification waits since the final squash of branch `agent-async`. Earlier wording (Esc killed jobs, polling only): [DECISIONS-ARCHIVE.md](DECISIONS-ARCHIVE.md), A-0264.
Archived by: subagent-profiles; introducing archive commit: `git log -S'A-0286' -- DECISIONS-ARCHIVE.md`.

> - **Background jobs** `[D-TOOLS-BG]`. Owner (`16-27-59:2561`, `16-27-59:2574`, design answers `16-27-59:2598`):
>   «Да, и надо, чтобы основной агент. Нет, знаешь как? Надо, чтобы длительные shell процессы сами уходили в фон. Если он работает больше 20 секунд, чтобы он превращался в фоновый процесс, а не оставался висячим активным процессом. Надо, чтобы всё, что висит больше 20 секунд, любая операция, которая висит больше 20 секунд, уходила в background, и можно было просто её пропинговать через какое-то время. Чтобы у агента был инструмент проверки состояния.»
>   «только надо время сократить до 12 секунд, после 12 секунд уходит в фон.»
>   «1а2а3а»
>   «4 - надо разобраться с рейс кондишенами и найти самое интелектальное производительное и эффективное решение марщрутизации и оркестрации тулколов»
>   «5б»
>   «6а с учетом 4 пункта добавочного»
>   Rule: a top-level call of `bash`, `codemode` (the whole script) or `read`, `edit`, `write`, `grep`, `find` that has
>   not settled 12 s after it started, barrier wait included, returns at once as `job#N` with the command, elapsed time,
>   the output so far and a log file in the OS temp dir, and keeps running; a call that settles sooner returns exactly the
>   stock result. Calls inside a codemode script never go to the background. The `job` tool (`wait`, `status`, `kill`; `ids`, `id`,
>   `timeout_ms` default 300000 when omitted, `lines` default 20) waits mechanically until one selected job ends or the
>   caller's deadline, keeps collecting for 250 ms after the first one ends, shows state, exit code, elapsed time, tail
>   and log path, and kills a process job with its process tree or cancels a queued one. Approved caveat: a running
>   file-tool job (`read`, `edit`, `write`, `grep`, `find`) cannot be interrupted safely; `job kill` reports
>   `cannot_kill` and it finishes on its own. This is a design limit, not a defect; queued file-tool jobs can be
>   cancelled. A wait may be a notification instead of a held call (`[D-TOOLS-NOTIFY]`); the descriptions say to kill jobs
>   one no longer needs before the final answer. A process job dies on `job kill`, its `timeout`, a child's management
>   interrupt and the caller's shutdown or reload, and after the handoff not on Esc or a new owner message; jobs belong to the session whose call started them (one registry per `createTools`; RQW-agent
>   calls the offered `job` definition's `jobs.abortAll()` on interrupt and `jobs.dispose()` on close). `job` is active
>   whenever one of these tools is; when Pi's allowlist keeps it off, nothing goes to the background. Reason: long
>   operations must not hold the agent, and the agent needs a tool to check them; Codex unified exec yields the same way;
>   the threshold is the owner's value.
>   Ordering (D4). Owner (`16-27-59:2705`): «1a + живай проверка на хайку и луна хай ризонинга»; option 1a of the ordering
>   proposal is named in coordinator text "ordered until handoff, free after". Calls of the same response keep the barrier
>   order: a call after a backgrounded job waits for its real end and itself becomes a queued job after 12 s. At the
>   handoff a bash or codemode job is detached from the barrier (`detach` in `barrier.ts`, through `nested.ts`); calls of
>   later responses wait for it only for the resources it holds (H1). A read, edit or write job keeps its paths. A
>   dependency on a background job is explicit: `job wait`, then the dependent call. While a bash or codemode job of the
>   caller runs, a read, edit or write of a file changed outside the caller's tools since that job started gets one note
>   naming the job.
>   Routing (FR-safe). Owner (`16-27-59:3117`, the answer to the routing question): «2а». Holds (H1): at the handoff a
>   bash job keeps what `footprint.ts` reads with certainty from its command text: the package folder an install changes,
>   the git index and refs of a repository a git command changes (every subcommand except known reading ones), and the
>   exact files it writes (redirects, `tee`, `sed -i`, `curl -o`, `rm`, `mkdir`, `touch`, `cp`/`mv`/`ln` destinations).
>   `footprint.ts` restores the outer working directory when a subshell closes. Mutating `git symbolic-ref` and
>   `git reflog` forms hold the repository; their read-only forms remain reads.
>   A later call waits only for these; reads never wait; any doubt holds nothing. Package-folder and git holds are
>   process-wide (`ledger.ts`) across main, subagents and reviewers; files are not ordered across sessions, they
>   get attributed notes. Effects report (O1): a top-level bash call that can become a job, or a top-level codemode call,
>   takes a snapshot of the working tree
>   (`git ls-files -co --exclude-standard`, or outside git a walk with one global limit of 20000 files, including
>   within a single wide directory, without .git, node_modules,
>   .next, target, .venv, __pycache__) right before its command starts, and a job takes another when it ends; what
>   changed is the difference of the two states, never a time cutoff. Approved caveat: a bash call with its own
>   positive `timeout` of 13 s or less never goes to the background, so it takes no pre-start snapshot. Calls with a
>   longer or absent timeout take the snapshot even if they finish before handoff; this is not a snapshot defect. Owner (`16-27-59:3621`), on the cost:
>   «Да, если это всего лишь 150 миллисекунд на 20 тыс. файлов, конечно, блядь, надо делать снимок файлов точный. Это 1А.»
>   The report lists files created and changed while the job ran (with the other session and tool), the caller's own
>   writes, own writes overwritten since, files deleted since the start, and the other jobs that ran alongside.
>   Unreadable directories, file-stat failures and git warnings recorded by either snapshot appear in `effects.errors`,
>   labelled before the start or at the end; failed or cancelled scans, git listing failures and the global walk bound
>   are reported in `effects.errors` or `scanned`. Unchecked paths are explicit, and an inaccessible file is not
>   classified as deleted. Write precondition (P1): a write over a file the session has read or written, changed
>   since by anyone else, is refused once with who changed it; the identical retry overwrites; a file never seen is
>   written without a check. Check, stock tool and ledger record run in one process-wide critical section per file
>   (`withFileLock`); files are keyed by native real path (`identityKey` in `keys.ts`); records belong to a registry
>   `owner`, the label is only shown. K1: `job kill` also cancels the queued same-response calls that wait for the killed
>   job and lists them in `cancelled_followers`; a killed queued call leaves the barrier at once (`withdraw`). N1: a job
>   that ended with an unseen non-empty effects report adds one note line to the caller's next top-level tool result.
>   W1: `job wait` takes `until`, a JavaScript regular expression on the output (a leading `(?i)` ignores case). S1: a
>   codemode script waits as a queued job for a free worker of the process (`PI_CODEMODE_MAX_WORKERS`, default 2). A
>   bash call inside a codemode script takes the same process-wide claims. Each session's label comes through the
>   optional `options.label` of the offered factory (`main`, `agent#1`, `agent#1/agent#2`, `review`, ...).
>   Children like main. Coordinator text, technical decision at the rebase onto subagent parity; the parity request,
>   owner (`16-27-59:2608`): «Надо что бы саб агенты были как в куросре посмотри реверз инжинеринг и скажи свои предложения».
>   With an RQW-tools offer, a child's or reviewer's `codemode` is Pi's definition built from that session's API, passed
>   as `options.codemode` and returned as one call of the child's barrier and a job of its registry, so a child script goes
>   to the background after 12 s like main's and S1 slots count main and every child together; without an offer the child
>   keeps Pi's stock codemode. Explorers inherit the caller's active base tools (`[D-AGENT-EXPLORE-TOOLS]`) and get `job` only when offered. The reviewer of RQW-review gets the offered `job`
>   tool; Esc of a review aborts its jobs and its end disposes them. The prompt section `rqw_tools_execution` says that a
>   background job holds the later calls of its response and, from later responses, only calls that change what it holds.
>   Reason: a replay of recorded tool calls left D4 alone with silent overlaps between jobs and later calls; FR-safe
>   leaves none silent and keeps the same-response order; the owner chose it. Probes, replay, snapshot cost, pilot defects
>   and code-review fixes: [notes/decisions-evidence.md](notes/decisions-evidence.md#background-jobs-evidence); races
>   R16-R24: `notes/analysis-races.md` section 9.
>   Carriers: `extensions/RQW-tools/jobs.ts`, `barrier.ts`, `nested.ts`, `footprint.ts`, `ledger.ts`, `keys.ts`,
>   `index.ts`, `codemode.ts`, `descriptions/bash.md`, `descriptions/job.md`, `descriptions/write.md`;
>   `extensions/RQW-agent/index.ts`; `extensions/RQW-review/index.ts`;
>   `notes/prompt-tools-isolation.md`. Proof: `extensions/RQW-tools/test/background.test.ts`, `barrier-detach.test.ts`,
>   `footprint.test.ts`, `ledger.test.ts`; `extensions/RQW-agent/test/wait.test.ts`,
>   `agent.test.ts`; `extensions/RQW-review/test/review.test.ts`, `subagent.test.ts`;
>   `test/prompt-tools-isolation.test.ts`. Since: `e5440f2`; scan and footprint safeguards since `e1cca48`; handoff independence and notification waits since the final squash of branch `agent-async`. Earlier wording (Esc killed jobs, polling only): [DECISIONS-ARCHIVE.md](DECISIONS-ARCHIVE.md), A-0264.

## A-0287 · archived 2026-10-24 · Notification waits and independent jobs

Status: SUPERSEDED by `[D-TOOLS-NOTIFY]` in DECISIONS.md.
Source: `c101637:DECISIONS.md`, lines 1003-1028, whole entry verbatim.
Original provenance: the final squash of branch `agent-async`.
Archived by: subagent-profiles; introducing archive commit: `git log -S'A-0287' -- DECISIONS-ARCHIVE.md`.

> - **Notification waits and independent jobs** `[D-TOOLS-NOTIFY]`. Owner (`16-27-59:4876`, entry `85357ce9`) and (`16-27-59:4937`, entry `a8684155`):
>   Entry `16-27-59:4876` asked that waits wake the agent by notification and that owner steering stay possible without aborting
>   waits, children or jobs; its exact text is not kept in this repository, only the entry id and that summary. Entry
>   `16-27-59:4937` (the same spans are kept in [BACKLOG.md](BACKLOG.md#asynchronous-tool-research-sources)):
>   «Также добавь в список задач, что нам нужно сделать реализацию асинхронного tool calling, как в Codecs CLI, чтобы агент мог вызывать tool call и при этом асинхронно полностью работать, принимать от меня сообщения и не обрываться на этом.»
>   Rule, taken by default (coordinator text, not an owner quote): `job wait` registers its subscription and snapshot in one
>   synchronous step. A result that is ready now returns at once as before. Otherwise the call returns `reason: "waiting"`
>   with `terminate: true`, so the caller's turn ends with no further model request, and one notification (a job ended, an
>   `until` match, or the `timeout_ms` deadline; ends within 250 ms join one notification) later arrives as a `[job]`
>   message that wakes an idle caller. A busy caller gets it at the settlement boundary, held outside Pi's steering queue so
>   Esc and send-now do not drop it. A newer wait on the same job replaces the older one; a result already shown by
>   `status`, `wait` or `kill` is not announced again. `blocking: true` keeps the old held wait. Calls inside a codemode
>   script stay blocking. The print/json fallback is for external hosts only: a root session run by Pi in print or json mode ends
>   with its run, so its waits block; an in-process child agent with the `notify`/`retain` bridge keeps notifications even when its SDK mode reads print.
>   Any caller without a `notify` callback, including a reviewer's own tool session, keeps the blocking wait. The `notify` callback
>   of the job registry is the same one subagent waits use, so no second delivery registry exists. A child's offered factory also
>   gets the optional `retain` hook, taken only while a notification subscription is pending, so the child's assignment stays open;
>   both hooks are optional and keep the extensions independent.
>   A job that went to the background belongs to the session: Esc, abort of the run, a new owner message and send-now
>   do not kill it. `job kill`, a child's management interrupt (`jobs.abortAll()`), `stop`/`restart` and session shutdown
>   do. A foreground call still aborts with its run. This supersedes owner decision D5 (Esc kills all background jobs) of
>   `[D-TOOLS-BG]`; no owner quote for D5 is repeated here.
>   Reason: the owner wants a waiting agent not to hold a call and owner messages not to kill background work.
>   Carrier: `extensions/RQW-tools/jobs.ts` (`watch`, `notify`), `extensions/RQW-tools/index.ts` (`installNotifications`),
>   `extensions/RQW-tools/descriptions/job.md`. Proof: `extensions/RQW-tools/test/notify.test.ts`, `notify-sdk.test.ts`, `background.test.ts`.
>   Since: the final squash of branch `agent-async`.

## A-0288 · archived 2026-10-24 · GPT Fast inheritance

Status: SUPERSEDED by `[D-SETTINGS-GPT-FAST-CHILDREN]` in DECISIONS.md.
Source: `c101637:DECISIONS.md`, lines 1082-1085, whole entry verbatim.
Original provenance: `fa05edf`.
Archived by: subagent-profiles; introducing archive commit: `git log -S'A-0288' -- DECISIONS-ARCHIVE.md`.

> - **GPT Fast inheritance** `[D-SETTINGS-GPT-FAST-CHILDREN]`. Subagents and reviewers inherit their caller's GPT Fast state at start; nested children inherit from their direct caller. Later main-chat toggles do not update running children. Optional boolean `fast_gpt` overrides inheritance, and agent `send` or `restart` may explicitly change a child's state; omitted restart keeps it. A strict-schema null means omitted. Tool descriptions tell callers to pass `fast_gpt: false` when the user forbids Fast; `review` correctly says a reviewer inherits, not that every tool has identical wording. Independent extension-local `fast-gpt.ts` implementations query `rqw-settings:fast-gpt-query` synchronously; `rqw-settings:fast-gpt` notifies changes. Without a settings responder, inherited main-chat Fast is off.
>   Owner: the exact inheritance instruction is recorded in GPT Fast above.
>   Reason: child tier follows the caller's choice without live coupling or cross-extension imports.
>   Carrier: `extensions/RQW-agent/fast-gpt.ts`, `extensions/RQW-review/fast-gpt.ts`, their `index.ts` and `test/fast-gpt.test.ts`. Since: `fa05edf`.

## A-0289 · archived 2026-10-24 · Native prompt files

Status: SUPERSEDED by `[D-AGENT-PROMPT-FILES]` in DECISIONS.md.
Source: `c101637:DECISIONS.md`, lines 1102-1105, whole entry verbatim.
Original provenance: `dc4f32e`.
Archived by: subagent-profiles; introducing archive commit: `git log -S'A-0289' -- DECISIONS-ARCHIVE.md`.

> - **Native prompt files** `[D-AGENT-PROMPT-FILES]`. Agent start/restart accepts `system_file` or `role_file` instead of the corresponding inline prompt; paths resolve relative to the caller's cwd. A regular file supplies exact UTF-8 text, including whitespace and a literal BOM; invalid UTF-8, matching inline/file options, or mixing any system option with any role option is rejected. Restart inherits the prompt choice and re-reads a file before replacing the child, so failed validation leaves the old child intact. Push `details.prompt_file` and wait `details.results[i].display.prompt_file` carry the same `{kind, path, sha256}` for the absolute resolved path and bytes actually loaded. Explorers reject prompt-file overrides.
>   Owner: «Всё должно быть нативно. Подумай, как можно максимально интеллектуально прокачать этот функционал.» Source: `2026-10-21T16-27-59-062Z_01a15f4a-7ad5-7377-81be-0baf3b6ffa33.jsonl`, USER entry at physical line 3963, requested at 2026-10-23T13:01:47.145Z.
>   Reason: native prompt inputs replace manually copied prompt text without losing byte provenance.
>   Carrier: `extensions/RQW-agent/index.ts`, `extensions/RQW-agent/prompt-files.ts`, `extensions/RQW-agent/prompt.ts`; proof: `extensions/RQW-agent/test/prompt-files.test.ts`; [file contract](extensions/RQW-agent/README.md#prompt-files-and-caller-messages). Since: `dc4f32e`.

## A-0290 · archived 2026-10-24 · Native supervision

Status: SUPERSEDED by `[D-AGENT-SUPERVISION]` in DECISIONS.md.
Source: `c101637:DECISIONS.md`, lines 1110-1113, whole entry verbatim.
Original provenance: `dc4f32e`.
Archived by: subagent-profiles; introducing archive commit: `git log -S'A-0290' -- DECISIONS-ARCHIVE.md`.

> - **Native supervision** `[D-AGENT-SUPERVISION]`. The `agent` tool supports native wait/status options and optional `alert_after_ms` on start/restart; prompt-file and caller-message options remain agent configuration. Status alerts are `{kind, at, detail}`: `error`, `repetition`, `long_turn`, `schema_rejection_repeated` and `scope_block`; the latest 32 are presentation history, not an execution limit. The optional positive finite safe-integer threshold is disabled by default and inherited on restart; it reports a long native turn without stopping it, and turn end, logical run end and close cancel the timer, leaving none while idle. Repetition is diagnostic suspicion; schema alerts require a second matching detectable Pi argument-parsing/schema rejection, and scope alerts observe actual existing git-guard refusals. This F1/F3 work adds no F5 guard or sandbox, `stalled_tool` alert, F2 run manifest or F4 structured-output feature.
>   Coordinator text: technical realization of the native-supervision agreement in `[D-AGENT-PROMPT-FILES]`.
>   Reason: make supervision caller-controlled without polling wrappers or automatic cancellation.
>   Carrier: `extensions/RQW-agent/index.ts`, `extensions/RQW-agent/activity.ts`, `extensions/RQW-agent/coordinator.ts` and descriptions; proof: `extensions/RQW-agent/test/supervision-activity.test.ts`, `extensions/RQW-agent/test/supervision-coordinator.test.ts`, `extensions/RQW-agent/test/supervision.test.ts`; [supervision contract](extensions/RQW-agent/README.md#wait-status-and-management). Since: `dc4f32e`.

## A-0291 · archived 2026-10-24 · Subagent parity

Status: SUPERSEDED by `[D-AGENT-PARITY]` in DECISIONS.md.
Source: `c101637:DECISIONS.md`, lines 1123-1126, whole entry verbatim.
Original provenance: `c86e9bb`.
Archived by: subagent-profiles; introducing archive commit: `git log -S'A-0291' -- DECISIONS-ARCHIVE.md`.

> - **Subagent parity** `[D-AGENT-PARITY]`. General subagents use the main run's built prompt from public `ctx.getSystemPrompt()`, followed by a short subagent reminder and optional `role`; nested subagents receive the main prompt handed down, not their parent's role. Optional `system` or `system_file` replaces that whole prompt exactly; file alternatives and validation are defined in `[D-AGENT-PROMPT-FILES]`. General subagents get `agent` recursively with no depth or concurrency limit; explorers are leaves. Repository coordinator rules are not product policy, and the reminder excludes instructions addressed to the main agent or coordinator.
>   Owner: «Надо что бы саб агенты были как в куросре посмотри реверз инжинеринг и скажи свои предложения» Source: the same session, USER entry at line 2608.
>   Reason: share main's rules and context while allowing short role configuration and independent decomposition.
>   Carrier: `extensions/RQW-agent/index.ts`, `extensions/RQW-agent/prompt.ts`, `extensions/RQW-agent/test/agent.test.ts`; details: [RQW-agent README](extensions/RQW-agent/README.md#prompt-kinds-and-title). Since: `c86e9bb`.

## A-0292 · archived 2026-10-24 · Child settings and offered review

Status: SUPERSEDED by `[D-AGENT-CHILD-SETTINGS]` in DECISIONS.md.
Source: `c101637:DECISIONS.md`, lines 1127-1130, whole entry verbatim.
Original provenance: `c86e9bb`.
Archived by: subagent-profiles; introducing archive commit: `git log -S'A-0292' -- DECISIONS-ARCHIVE.md`.

> - **Child settings and offered review** `[D-AGENT-CHILD-SETTINGS]`. Children inherit session shell, image handling, retries, provider and transport timeouts, compaction, thinking budgets, queue modes and codemode settings, except warming stays off. Stock tools use the child's copied shell/image settings; offered RQW-tools read the caller's effective settings per call. Children get built-in codemode/tool_search when active for their caller; general subagents get caller-local review through `rqw-review:subagent-review` when offered. Reviewers inherit the same settings except queue modes. Parent-history fork, web search and MCP for children are deferred in [BACKLOG](BACKLOG.md), not present features; durable resume is delivered (`[D-AGENT-PERSIST]`).
>   Coordinator text: technical realization of the parity agreement.
>   Reason: children must not silently lose relevant caller capabilities.
>   Carrier: `extensions/RQW-agent/index.ts` (`childSettings`), `extensions/RQW-agent/prompt.ts`, `extensions/RQW-review/index.ts`; `extensions/RQW-review/test/subagent.test.ts`. Since: `c86e9bb`.

## A-0293 · archived 2026-10-24 · Title and explorer

Status: SUPERSEDED by `[D-AGENT-TITLE]` in DECISIONS.md.
Source: `c101637:DECISIONS.md`, lines 1131-1134, whole entry verbatim.
Original provenance: `c86e9bb`; explorer part reworded by `[D-AGENT-EXPLORE-TOOLS]` (earlier wording: [DECISIONS-ARCHIVE.md](DECISIONS-ARCHIVE.md), A-0241).
Archived by: subagent-profiles; introducing archive commit: `git log -S'A-0293' -- DECISIONS-ARCHIVE.md`.

> - **Title and explorer** `[D-AGENT-TITLE-EXPLORE]`. Optional `title` on start/restart appears in status, `results[i].display.title` and message `details.title`; delivered text keeps its `[agent#N]` form. Card rendering is `RQW-agent-ui`, see [Agent cards](#agent-cards). `explore` on agent start selects a search leaf as defined by `[D-AGENT-EXPLORE-TOOLS]`.
>   Coordinator text: the explorer option reuses the existing runtime rather than adding a tool.
>   Reason: retain compact metadata and a search mode without another lifecycle implementation.
>   Carrier: `extensions/RQW-agent/index.ts`, `extensions/RQW-agent/prompt.ts`. Since: `c86e9bb`; explorer part reworded by `[D-AGENT-EXPLORE-TOOLS]` (earlier wording: [DECISIONS-ARCHIVE.md](DECISIONS-ARCHIVE.md), A-0241).

## A-0294 · archived 2026-10-24 · Explorer tools and read-only

Status: SUPERSEDED by `[D-AGENT-PROFILES]` in DECISIONS.md.
Source: `c101637:DECISIONS.md`, lines 1135-1149, whole entry verbatim.
Original provenance: the explore-cursor change.
Archived by: subagent-profiles; introducing archive commit: `git log -S'A-0294' -- DECISIONS-ARCHIVE.md`.

> - **Explorer tools and read-only** `[D-AGENT-EXPLORE-TOOLS]`. `explore` keeps the main system prompt, the subagent reminder, a short search role and thoroughness `quick`, `medium` or `very thorough`, and takes no custom system/role/model/tools or prompt-file overrides. It runs on the current caller's model with the caller's active subset of the base tools `read`, `bash`, `edit`, `write`, `grep`, `find`, without `agent` or review; `codemode` and `tool_search` follow the caller's active tools, and `job` stays available when RQW-tools offers it. `restart` reads the caller's current model and active tools again. Read-only is an instruction of the role, not a mechanism: no file writes, edits or deletion, git state changes or installs, including through shell and codemode. No git guard or sandbox is installed for explorers. The separate `grep` and `find` tools stay for every agent next to `bash`, and no tool registration is added or removed. Reviewer read-only policy is a separate decision under [Review](#review), and this change modifies no RQW-review files.
>   Owner, session `2026-10-21T16-27-59-062Z_01a15f4a-7ad5-7377-81be-0baf3b6ffa33.jsonl`, `16-27-59:4416`, message `f3830a52`: «давай сделаем разведчика как в курсоре т.е. те же инструменты и шел
>
> баг бот и секьюрити ревью вообще не понял к чему ты их преплел
> Песочницы у нас нет»
>   Owner, `16-27-59:4424`, message `698dcebc`: «Смотри, у нас Explorer работает на той же модели, что и основной агент, поэтому его защита будет от записи просто инструкцией о том, что ему запрещено делать операции записи. Только чтение. Только редовые операции и всё. Этого будет достаточно, потому что если это будет тупая модель, то похуй. Я не видел таких ошибок вообще никогда, поэтому об этом даже не надо париться, о механической защите от записи.
>
> Я гоняю кодекс. Мой кодекс CLI никогда не работает в песочнице, он всегда работает на боевой, там песочница отключена. И ни разу не было такого, что reviewer что-нибудь напишет либо explorer что-нибудь напишет.»
>   Owner correction, `16-27-59:4429`, message `7690ba13`: «только read-only я хотел написать а не редовые»
>   Owner, `16-27-59:4433`, message `30ae092f`: «Тогда я думаю, отдельные инструменты типа grep и find не надо выносить в отдельные инструменты, пусть они будут в рамках шелла. И всё так же, как и раньше. Мы не будем ничего усложнять»
>   Owner, `16-27-59:4435`, message `331ce08c`: «И у ревьюера везде, где есть Read Only, просто будет Read Only на уровне инструкции, и всё»
>   Owner, `16-27-59:4451`, message `b1c5700f`: «Ну всё, тогда мы это оставляем и не трогаем. Это заебись!»
>   Coordinator text: the owner trusts the caller's model to obey the read-only instruction and explicitly rejects mechanical write protection. Cursor evidence: `my-pi-evidence/subagent-parity/cursor/REPORT.md:49`, explore has no tools override and inherits the caller's tools minus Task; the model inheritance and the read-only instruction are the owner's requirements, not a claim that Cursor enforces read-only.
>   Reason: a caller-model explorer with the caller's tools searches like a parent would, and the owner chose an instruction over protection code.
>   Carrier: `extensions/RQW-agent/index.ts`, `extensions/RQW-agent/prompt.ts`; details: [RQW-agent README](extensions/RQW-agent/README.md#prompt-kinds-and-title); proof: `extensions/RQW-agent/test/agent.test.ts`. Supersedes the git-guarded read/grep/find/bash allowlist of `[D-AGENT-TITLE-EXPLORE]` (A-0241). Since: the explore-cursor change.

## A-0295 · archived 2026-10-24 · API and in-process runtime

Status: SUPERSEDED by `[D-AGENT-API]` in DECISIONS.md.
Source: `c101637:DECISIONS.md`, lines 1150-1152, whole entry verbatim.
Original provenance: `7a9f505`; inherited defaults since `c86e9bb`; `resume` since `dd93a40`; `blocking` since the final squash of branch `agent-async`. Earlier wording: [DECISIONS-ARCHIVE.md](DECISIONS-ARCHIVE.md), A-0265.
Archived by: subagent-profiles; introducing archive commit: `git log -S'A-0295' -- DECISIONS-ARCHIVE.md`.

> - **API and in-process runtime** `[D-AGENT-API]`. One `agent` tool offers `start`, `wait`, `status`, `send`, `resume`, `interrupt`, `stop`, `restart`; fields are `id`, `ids`, `timeout_ms`, `blocking`, `messages`, `until`, `wake_on_alert`, `depth`, `alert_after_ms`, `system`, `role`, `system_file`, `role_file`, `include`, `title`, `explore`, `task`, `model`, `thinking`, `tools`, `fast_gpt`, `interrupt`. Optional null fields mean omitted; start/send require task, not system. Defaults are the caller's model and thinking and all six base tools, plus recursive `agent` delegation for general subagents. Sessions run in-process at caller cwd with in-memory settings; the history is in memory for an in-memory caller and in the owned `<parent.jsonl>.children/` tree for a persisted one (`[D-AGENT-PERSIST]`), using `createAgentSession` and the caller's `ctx.modelRegistry.runtime` for credentials, OAuth and extension providers. Resources, context files, skills and external extensions are not independently loaded; the inherited prompt carries main's text. An inline forced `before_agent_start` prompt prevents Pi from appending cwd or other sections again.
>   Coordinator text. Reason: reuse Pi sessions and the caller's provider runtime without subprocesses or duplicate resource loading.
>   Carrier: `extensions/RQW-agent/index.ts`, `extensions/RQW-agent/test/agent.test.ts`. Since: `7a9f505`; inherited defaults since `c86e9bb`; `resume` since `dd93a40`; `blocking` since the final squash of branch `agent-async`. Earlier wording: [DECISIONS-ARCHIVE.md](DECISIONS-ARCHIVE.md), A-0265.

## A-0296 · archived 2026-10-24 · Codex reviewer port

Status: SUPERSEDED by `[D-REVIEW-PORT]` in DECISIONS.md.
Source: `c101637:DECISIONS.md`, lines 1205-1220, whole entry verbatim.
Original provenance: see the verbatim entry below
Archived by: subagent-profiles; introducing archive commit: `git log -S'A-0296' -- DECISIONS-ARCHIVE.md`.

> - **Codex reviewer port** `[D-REVIEW-PORT]`. `RQW-review` carries the owner's working Codex CLI reviewer over to Pi, adapted
>   to this harness. The base is his existing cycle, not a newly invented workflow: the profiles `smarty` and `bossy`
>   (`agents/*.toml`) and the Main-side skills `subagents`, `blindreview` and `highreview` of his Codex CLI plugin
>   `scope-focus`, whose `.codex-plugin/plugin.json` names the developer `A. Chukavin` and supplies no licence text or other
>   attribution. The earlier reviewer flow, its dispute rules and its benchmark campaign are cancelled; their entries are
>   in [DECISIONS-ARCHIVE.md](DECISIONS-ARCHIVE.md) (A-0248 to A-0256). Pi's `read`, `bash`, `grep` and `find` replace the
>   Codex tools.
>   Owner (`16-27-59:5195`, `16-27-59:5210`, `16-27-59:5286`, `16-27-59:5291`):
>   «этот малой на Sol 6.1 Low очень хорошо защищает агента от ошибок»
>   «Мы отменяем текущий flow работы над reviewer и переобуваемся в новый прекрасный flow.»
>   «давай мы пойдём от того, что мы возьмём текущего ревьюера, рабочего уже, пиздатого, и его немножко прокачаем, подтюним, оптимизируем. Не будем смотреть на старого ревьюера.»
>   «Надо его перенести, адаптировав к нашему harness, потому что у них свой harness, у нас свой harness. Надо адаптацию сделать полную, чтобы по смыслу работало так же»
>   Reason: the Codex reviewer already works in practice, and the old reviewer missed errors. Carriers: `REVIEWER.md`,
>   `index.ts`, [RQW-review README](extensions/RQW-review/README.md), [PROCESS.md, Independent review](PROCESS.md#independent-review).
>   The whole-cycle comparison with the original plugin (five identical tasks, one run each, start to CLEAN including
>   repairs) waits until this port is delivered: [BACKLOG.md](BACKLOG.md#codex-reviewer-comparison).

## A-0297 · archived 2026-10-24 · Reviewer prompt

Status: SUPERSEDED by `[D-REVIEW-PROMPT]` in DECISIONS.md.
Source: `c101637:DECISIONS.md`, lines 1221-1236, whole entry verbatim.
Original provenance: this port.
Archived by: subagent-profiles; introducing archive commit: `git log -S'A-0297' -- DECISIONS-ARCHIVE.md`.

> - **Reviewer prompt** `[D-REVIEW-PROMPT]`. `extensions/RQW-review/REVIEWER.md` is the `developer_instructions` text of
>   `smarty.toml`, which is identical in `bossy.toml`, and the whole prompt of both levels; Pi adds only its `<cwd>` block.
>   Three changes, all harness differences: 1. the allowed tools are the `read`, `grep` and `find` tools and read-only
>   `bash` commands (Codex: "read-only inspection tools and commands"); 2. one sentence names the sections of the brief
>   that the tool assembles, `<user_messages>`, `<agreement>`, `<object>`, `<criterion>` and `<rejected_earlier>`; 3. the note
>   that ends a truncated `read` result, such as `Use offset=N to continue`, is not file content (Codex: "the reader's
>   continuation line"). Codex `fork_turns` has no counterpart: every pass is a fresh session from zero
>   (`[D-REVIEW-SESSION]`). The prompt has no rule about running tests, for or against, and no measured claim of quality is made.
>   Owner (`16-27-59:5210`, `16-27-59:5219`):
>   «reviewer должен делать полное review и находить все расхождения, а не по одному.»
>   «Reviewer должен находить всё говно и сразу выгребать его, чтобы main сразу всё почистил, чтобы это всё было быстро и производительно.»
>   «Я бы хотел его минимально улучшить, минимально усилить и без замеров просто использовать его.»
>   «Его промпт вообще никак не подвигает его к запуску тестов изначально. То, что ты придумал про запрет запуска тестов — это overengineering очевидный»
>   Reason: the owner's reviewer works as written; the three changes only fit it to this harness.
>   Carrier: `REVIEWER.md`. Proof: `test/review.test.ts` (loaded byte for byte) and `test/codex-policy.test.ts` (the request
>   starts with it). Since: this port.

## A-0298 · archived 2026-10-24 · Reviewer profiles

Status: SUPERSEDED by `[D-REVIEW-PROFILES]` in DECISIONS.md.
Source: `c101637:DECISIONS.md`, lines 1237-1250, whole entry verbatim.
Original provenance: this port.
Archived by: subagent-profiles; introducing archive commit: `git log -S'A-0298' -- DECISIONS-ARCHIVE.md`.

> - **Reviewer profiles** `[D-REVIEW-PROFILES]`. One table, `LEVELS` in `index.ts`, independent of the main agent's model:
>   `blind` is Smarty, `openai-codex/gpt-6.1-sol` thinking low; `high` is Bossy, `openai-codex/gpt-6.1-sol` thinking
>   medium. When the model is missing or `openai-codex` has no credentials, the review fails with an explicit error
>   (`review requires Codex credentials, no fallback`) and no other provider runs. A failed request gives
>   `Review failed: <reason>` and no automatic retry by the extension; Pi's own inherited request retries apply. The
>   review has no deadline of its own: only session shutdown, or the end of the subagent that asked, aborts a running
>   review, while an abort of the caller's run (Esc or RPC) leaves it running. Verdict `details` carry the model that ran.
>   Owner (`16-27-59:5291`):
>   «Для Claude надо будет замерить. Пока все review будет делать ChatGPT, потом как обновятся лимиты, и Claude померяем, выберем модель из того, что есть»
>   Coordinator text: Bossy medium is the `model_reasoning_effort` of `agents/bossy.toml`, which the source skill maps to
>   the `high` level. The Claude measurement is deferred: [BACKLOG.md](BACKLOG.md#claude-reviewer).
>   Reason: the owner's working reviewer runs on Sol; the Claude choice needs a measurement first.
>   Carrier: `index.ts` (`LEVELS`, `pickReviewer`). Proof: `test/levels.test.ts`, `test/codex-policy.test.ts`,
>   `test/startup-policy.test.ts`. Since: this port.

## A-0299 · archived 2026-10-24 · Review cycle on Main's side

Status: SUPERSEDED by `[D-REVIEW-CYCLE]` in DECISIONS.md.
Source: `c101637:DECISIONS.md`, lines 1251-1283, whole entry verbatim.
Original provenance: this port.
Archived by: subagent-profiles; introducing archive commit: `git log -S'A-0299' -- DECISIONS-ARCHIVE.md`.

> - **Review cycle on Main's side** `[D-REVIEW-CYCLE]`. Carried over from the skill `subagents` of the Codex plugin; it
>   lives in `DESCRIPTION`, `NEXT` and `startedText` of `index.ts`, so switching RQW-review off removes it, and in
>   [PROCESS.md, Independent review](PROCESS.md#independent-review).
>   - When: the review runs only when the owner asks for a review or a checked result, or a procedure he approved requires
>     it, such as the squash-merge rule of PROCESS; never on Main's own initiative or as an automatic step of other work.
>     `blind` unless the owner or that procedure asks for `high`. Main keeps working meanwhile but leaves the reviewed files unchanged until the verdict.
>   - Brief: `<user_messages>` is assembled by the tool from the branch, verbatim and in order, with compaction and branch
>     summaries labelled as not the user's words. Main gives `agreement` when there is any (accepted proposals and decisions
>     that are not the user's own messages, verbatim), `object` (exact paths or readable references to the object, the
>     primary requirements, applicable governing rules and source evidence, the diff as a file path, and the stage
>     `pre-action` or `pre-completion`), `criterion` (what the check confirms and which deliverable must fulfil each
>     obligation; an exclusion cannot silently waive a governing requirement of this pass) and, from the second pass on,
>     `rejected_earlier` (each rejected finding with its reason). No file, search, tool-call or turn quotas.
>   - `CLEAN` with complete `CHECKED:` and no `UNCHECKED:` passes: no extra pass for confidence, but every independent pass
>     and its order that the invoking procedure requires stays.
>   - `FINDINGS:` are the teammate's findings. Main finds each quote by searching for it. A finding whose two quotes stand
>     verbatim in their sources is admitted; for an omission Main verifies the quoted requirement and the complete
>     inspected file or section instead of demanding nonexistent text. Main fixes an admitted finding exactly to its
>     REQUIRED OUTCOME and no further, and does not reject it, argue with it or put it to the owner. Main rejects a finding
>     only when a quote is not verbatim, the allegedly missing content is present in the cited object, or a NOT AGREED
>     element is covered by a verbatim quote of the agreement, and gives that reason with the quote.
>   - All admitted fixes go in one batch. Then a fresh reviewer runs with the same level, object and criterion and every
>     rejection so far in `rejected_earlier`, until `CLEAN`.
>   - `UNCHECKED:` or missing `CHECKED:` evidence makes the check incomplete whatever the leading verdict is: resolve the
>     missing sources or evidence, or retry malformed output; never record it as acceptance.
>   - No verdict, an error or a reviewer that could not start: the check has not passed and no self-check replaces it.
>     Main launches it once more on the unchanged object; if it fails again, Main tells the owner and waits.
>   - When this review contract changes, validate it against known defective, corrected and missing-source examples before
>     claiming improved detection. These checks are not extra rounds in ordinary task reviews. The tests check mechanics,
>     such as a malformed verdict or a missing `CHECKED:`, and make no claim about detection quality.
>   Owner (`16-27-59:5210`): «Reviewer должен находить всё говно и сразу выгребать его, чтобы main сразу всё почистил, чтобы это всё было быстро и производительно.»
>   Reason: one complete pass, one batch of fixes and a fresh pass is the cycle the owner's reviewer already runs.
>   Carriers: `index.ts` (`DESCRIPTION`, `NEXT`, `startedText`, `verdictMessage`, `kindOf`). Since: this port.

## A-0300 · archived 2026-10-24 · No warming

Status: SUPERSEDED by `[D-REVIEW-PROFILES]` in DECISIONS.md.
Source: `c101637:DECISIONS.md`, lines 1284-1288, whole entry verbatim.
Original provenance: `b91f832`.
Archived by: subagent-profiles; introducing archive commit: `git log -S'A-0300' -- DECISIONS-ARCHIVE.md`.

> - **No warming** `[D-REVIEW-CACHE]`. `extensions/RQW-review/index.ts` sets `cacheWarming: "off"` in each reviewer's
>   in-memory SettingsManager, independently of RQW-settings and the main user's mode; prompt caching stays on. The
>   reviewer runs only Codex models, so it has no Anthropic cache policy of its own.
>   Owner: «Да, давайте мы исполнителям, ревьюерам кэш выключай.» (session `2026-10-21T16-27-59-062Z_01a15f4a`, line 440)
>   ([Anthropic subscription adapter](#anthropic-subscription-adapter)). Reason: review gaps are short. Proof: `test/review.test.ts`. Since: `b91f832`.

## A-0301 · archived 2026-10-24 · Reviewer GPT Fast

Status: SUPERSEDED by `[D-REVIEW-PROFILES]` in DECISIONS.md.
Source: `c101637:DECISIONS.md`, lines 1289-1291, whole entry verbatim.
Original provenance: `fa05edf`.
Archived by: subagent-profiles; introducing archive commit: `git log -S'A-0301' -- DECISIONS-ARCHIVE.md`.

> - **Reviewer GPT Fast** `[D-REVIEW-FAST]`. A reviewer inherits the main chat's GPT Fast state when it starts; the
>   optional `fast_gpt` of `review` overrides it for that reviewer. Rule, quotes and carrier: [Settings](#settings),
>   "GPT Fast" (`extensions/RQW-review/fast-gpt.ts`, `index.ts`). Since: `fa05edf`.

## A-0302 · archived 2026-10-24 · One tool, two levels

Status: SUPERSEDED by `[D-REVIEW-PROFILES]` in DECISIONS.md.
Source: `c101637:DECISIONS.md`, lines 1292-1295, whole entry verbatim.
Original provenance: `3389347`.
Archived by: subagent-profiles; introducing archive commit: `git log -S'A-0302' -- DECISIONS-ARCHIVE.md`.

> - **One tool, two levels** `[D-REVIEW-TOOL]`. `extensions/RQW-review/` registers one tool `review` with `level`
>   `blind` or `high`, held to the existing contract and nothing more.
>   Coordinator text (owner quotes not found in the Pi sessions): "То, что ты предложил по ревьюерам — it's OK, я принимаю"; "Smart не нужен ... будет Blind и High"; "эти три саб-агента должны быть забиты за тем контрактом, который есть, и всё" (the last one also appears in the task text the owner pasted, session
>   `2026-10-21T16-27-59-062Z_01a15f4a`, line 367). Carrier: `index.ts`, `package.json`. Since: `3389347`.

## A-0303 · archived 2026-10-24 · Parameters

Status: SUPERSEDED by `[D-REVIEW-PROFILES]` in DECISIONS.md.
Source: `c101637:DECISIONS.md`, lines 1296-1302, whole entry verbatim.
Original provenance: `3389347`.
Archived by: subagent-profiles; introducing archive commit: `git log -S'A-0303' -- DECISIONS-ARCHIVE.md`.

> - **Parameters** `[D-REVIEW-PARAMS]`. `level`, `object` (paths, the diff as a file path rather than a command, so the
>   reviewer reads it whole beside the named sources, the stage), `criterion`, optional `agreement`, optional
>   `rejected_earlier` (a list of `finding`, the rejected finding verbatim, and `reason`, why it was rejected, with the supporting quote)
>   and optional boolean `fast_gpt`. The extension saves each call's `rejected_earlier` with its level, object and criterion
>   in the session and carries every rejection of the same level, object and criterion into the next brief. Empty
>   strings, a null or empty `rejected_earlier` and a null `fast_gpt` count as not given, since strict mode fills every
>   field. Carrier: `index.ts`. Proof: `test/review.test.ts`. Since: `3389347`.

## A-0304 · archived 2026-10-24 · Brief from the branch

Status: SUPERSEDED by `[D-REVIEW-PROFILES]` in DECISIONS.md.
Source: `c101637:DECISIONS.md`, lines 1303-1306, whole entry verbatim.
Original provenance: `3389347`.
Archived by: subagent-profiles; introducing archive commit: `git log -S'A-0304' -- DECISIONS-ARCHIVE.md`.

> - **Brief from the branch** `[D-REVIEW-BRIEF]`. `buildBrief` writes the user's messages of the current branch, verbatim,
>   numbered and in order, with compaction and branch summaries labelled as not the user's words, then `agreement`,
>   `object`, `criterion` and `<rejected_earlier>`; images are `[image]`. Reason: Main no longer retypes the user's words,
>   the largest output cost of a call, and they cannot drift. Since: `3389347`.

## A-0305 · archived 2026-10-24 · Fresh reviewer session

Status: SUPERSEDED by `[D-REVIEW-PROFILES]` in DECISIONS.md.
Source: `c101637:DECISIONS.md`, lines 1307-1316, whole entry verbatim.
Original provenance: `3389347`.
Archived by: subagent-profiles; introducing archive commit: `git log -S'A-0305' -- DECISIONS-ARCHIVE.md`.

> - **Fresh reviewer session** `[D-REVIEW-SESSION]`. Each call is a fresh in-process session: `createAgentSession` with
>   in-memory `SessionManager` and `SettingsManager`, in the caller's `ctx.cwd`, keeping the caller's session settings
>   (shell, images, retries and provider timeouts, transport and its timeouts, compaction, thinking budgets, codemode;
>   the [Agent](#agent) parity entry records the owner's answer; `reviewerSettings`). The resource loader loads no user extensions, skills,
>   prompt templates, themes, context files or appended prompt. Its inline extension factories are Pi's `codemode` and
>   `tool_search` when the caller has them active, and one factory that installs GPT Fast inheritance and the bash git
>   guard. `REVIEWER.md` is the prompt; Pi adds only its `<cwd>` block. A general subagent of RQW-agent gets its own
>   `review` through the `pi.events` offer `rqw-review:subagent-review`: verdicts go to it, its brief is its own messages,
>   and its reviews end with it ([RQW-review README](extensions/RQW-review/README.md#review-in-subagents)).
>   Since: `3389347`.

## A-0306 · archived 2026-10-24 · Reviewer tools

Status: SUPERSEDED by `[D-REVIEW-PROFILES]` in DECISIONS.md.
Source: `c101637:DECISIONS.md`, lines 1317-1328, whole entry verbatim.
Original provenance: `a04a9c0`.
Archived by: subagent-profiles; introducing archive commit: `git log -S'A-0306' -- DECISIONS-ARCHIVE.md`.

> - **Reviewer tools** `[D-REVIEW-TOOLS]`. `read`, `bash`, `grep`, `find`, no `edit` or `write`, plus Pi's `codemode` and
>   `tool_search` when the caller has them active, plus RQW-tools' `job` when RQW-tools offers its definitions. Each
>   session requests fresh definitions over `pi.events` channel `rqw-tools:subagent-tools` with RQW-agent's
>   `{ offer(factory) }` handshake, passing cwd, a settings getter and options: `label` `review` for the main session's
>   reviewer, the caller's path plus `/review` for a subagent's (`agent#1/review`), and `codemode`, only when the reviewer
>   has codemode, as Pi's definition built from the reviewer's own API. It keeps the four names, `job` and the returned
>   `codemode`. Tools "Background jobs": a reviewer call still running after 12 s goes to the background; an abort of the review
>   (session shutdown or the end of its subagent) aborts its jobs, and the end of the review disposes them. Without an offer: the four stock
>   definitions (`reviewerTools`) and Pi's own `codemode`/`tool_search` when active; nothing goes to the background. Offered
>   and stock grep/find share `dropEmptyOptional`: `prepareArguments` drops optional arguments equal to `"null"`,
>   `"undefined"` or blank, then chains the existing `prepareArguments`. Reason: grep otherwise passes `--glob null` to rg,
>   a silent false negative. Proof: `test/review.test.ts`, stock and offered search paths. Since: `a04a9c0`.

## A-0307 · archived 2026-10-24 · Reviewer git guard

Status: SUPERSEDED by `[D-REVIEW-PROFILES]` in DECISIONS.md.
Source: `c101637:DECISIONS.md`, lines 1329-1333, whole entry verbatim.
Original provenance: `a04a9c0`.
Archived by: subagent-profiles; introducing archive commit: `git log -S'A-0307' -- DECISIONS-ARCHIVE.md`.

> - **Reviewer git guard** `[D-REVIEW-GITGUARD]`. `extensions/RQW-review/git-guard.ts` is self-contained.
>   Every child bash `tool_call`, offered or stock, checks `blockedGit` and returns its reason as the tool error. Limit: a
>   shell-syntax guard, not a sandbox. No file edits through bash is a prompt rule ("Do not edit files, perform
>   state-changing actions or spawn agents"), not runtime enforcement. Carrier: `index.ts`, `git-guard.ts`,
>   `REVIEWER.md`. Since: `a04a9c0`.

## A-0308 · archived 2026-10-24 · Session model runtime

Status: SUPERSEDED by `[D-REVIEW-PROFILES]` in DECISIONS.md.
Source: `c101637:DECISIONS.md`, lines 1334-1336, whole entry verbatim.
Original provenance: `3389347`.
Archived by: subagent-profiles; introducing archive commit: `git log -S'A-0308' -- DECISIONS-ARCHIVE.md`.

> - **Session model runtime** `[D-REVIEW-RUNTIME]`. The reviewer uses the session's own `ctx.modelRegistry.runtime`,
>   private to TypeScript only. Reason: providers and logins registered by extensions reach the reviewer (with this
>   package, RQW-anthropic's `anthropic` provider), and no second runtime refreshes the same OAuth login. Since: `3389347`.

## A-0309 · archived 2026-10-24 · Async verdicts

Status: SUPERSEDED by `[D-REVIEW-PROFILES]` in DECISIONS.md.
Source: `c101637:DECISIONS.md`, lines 1345-1351, whole entry verbatim.
Original provenance: `3389347`.
Archived by: subagent-profiles; introducing archive commit: `git log -S'A-0309' -- DECISIONS-ARCHIVE.md`.

> - **Async verdicts** `[D-REVIEW-ASYNC]`. The call returns `review#N started. ...` at once. The verdict, the reviewer's
>   last assistant text, arrives as `pi.sendMessage({ customType: "review", content: "[review#N] <verdict>\n\n<next step>",
>   display: true }, ...)`; `details` carry `n`, level, model, thinking and seconds. Numbers count per session and continue
>   after resume; each issued number is persisted with `pi.appendEntry("review", { n })` before any asynchronous work.
>   Recovery also accepts old direct review tool results and verdicts, not arbitrary tool text; this covers nested
>   `ctx.executeTool` callers. Without `session_start` after an SDK reload, the first execution restores context and
>   counter. `session_shutdown` aborts running reviews and delivers nothing. Since: `3389347`.

## A-0310 · archived 2026-10-24 · Exactly-once delivery

Status: SUPERSEDED by `[D-REVIEW-PROFILES]` in DECISIONS.md.
Source: `c101637:DECISIONS.md`, lines 1352-1363, whole entry verbatim.
Original provenance: `ca6e2dd`.
Archived by: subagent-profiles; introducing archive commit: `git log -S'A-0310' -- DECISIONS-ARCHIVE.md`.

> - **Exactly-once delivery** `[D-REVIEW-DELIVERY]`. A verdict never waits in the agent's queue and gets exactly one main
>   turn unless the run was aborted. Idle (`ctx.isIdle()`): sent with `triggerTurn: true, deliverAs: "followUp"` unless the
>   last main run was aborted. Busy: sent with `triggerTurn: false`; Pi appends it at the end of the current turn or run,
>   and the `agent_before_settle` handler returns `continue: true` while the verdict has no assistant message after it.
>   When that handler returns without `continue`, a `settling` flag holds until `turn_start` or `agent_settled`; verdicts
>   arriving meanwhile wait in `late` and `agent_settled` sends them, the last with `triggerTurn: !event.aborted`, so
>   several get one turn. `mainAborted` latches `agent_settled.aborted` until a new `agent_start` and suppresses delivery
>   turns only while idle. A verdict finishing after Esc or RPC abort while idle is saved once without starting Main; the
>   next prompt carries it once. In print and json mode `agent_end` waits for jobs with its active `ctx.signal`; abort
>   interrupts only that wait. Pi 1.4.0 has no active `ctx.signal` in `agent_before_settle`. Reason: review findings
>   showed lost verdicts in print/json mode, after queue clears, error-ended runs and slow foreign `agent_before_settle`
>   handlers. Proof: `test/review.test.ts`. Since: `ca6e2dd`.

## A-0311 · archived 2026-10-24 · Auth fallback

Status: SUPERSEDED by `[D-REVIEW-PROFILES]` in DECISIONS.md.
Source: `c101637:DECISIONS.md`, lines 1364-1366, whole entry verbatim.
Original provenance: `ca6e2dd`.
Archived by: subagent-profiles; introducing archive commit: `git log -S'A-0311' -- DECISIONS-ARCHIVE.md`.

> - **Auth fallback** `[D-REVIEW-AUTH]`. "No credentials" only when both `ctx.modelRegistry.hasConfiguredAuth(model)` and
>   `await runtime.checkAuth(provider, { signal })` say so, as in Pi's own prompt. Reason: the auth snapshot is filled
>   asynchronously and can miss credentials right after startup or reload. Since: `ca6e2dd`.

## A-0312 · archived 2026-10-24 · Whole-job cancellation

Status: SUPERSEDED by `[D-REVIEW-PROFILES]` in DECISIONS.md.
Source: `c101637:DECISIONS.md`, lines 1367-1372, whole entry verbatim.
Original provenance: `b4b23cf`.
Archived by: subagent-profiles; introducing archive commit: `git log -S'A-0312' -- DECISIONS-ARCHIVE.md`.

> - **Whole-job cancellation** `[D-REVIEW-CANCEL]`. Cancellation bounds the whole review job, including auth, session
>   creation and prompt preflight. `untilAborted` races each asynchronous stage, observes late rejection and removes its
>   listener; auth gets the signal; late-created sessions are disposed without prompting; prompt cancellation aborts and
>   disposes without awaiting an uncooperative provider. The reviewer's `agent.streamFunction` checks the job signal
>   before the SDK stream, so a preflight resuming after disposal cannot make a request; an unabortable underlying promise
>   may stay pending but cannot hold the job or deliver twice. Coordinator text (not found in the Pi sessions): "deadline boundsWHOLEjobinclcheckAuth/create/promptpreflight". Since: `b4b23cf`.

## A-0313 · archived 2026-10-24 · Deterministic regression coverage

Status: SUPERSEDED by `[D-REVIEW-PROFILES]` in DECISIONS.md.
Source: `c101637:DECISIONS.md`, lines 1373-1380, whole entry verbatim.
Original provenance: `b4b23cf`.
Archived by: subagent-profiles; introducing archive commit: `git log -S'A-0313' -- DECISIONS-ARCHIVE.md`.

> - **Deterministic regression coverage** `[D-REVIEW-TESTS]`. `test/review.test.ts` (real sessions, faux main and
>   reviewer providers) covers the five audit reproductions, post-abort delivery in all four modes, several verdicts,
>   nested reload and legacy ids, ignored auth/provider cancellation, native prompt-preflight after timeout or shutdown,
>   busy-time delivery, two verdicts held by a slow second extension (`test/slow-settle.ts`), and grep/find with `"null"`,
>   `"undefined"` and blank arguments. `test/cli.test.ts` runs real CLI print/json subprocesses on Node, and on Bun with
>   `PI_REVIEW_TEST_RUNTIME=bun`, with `test/cli-faux.ts` and the `test/offline.mjs` network tripwire. These establish
>   runtime behavior, not review quality. Historical live smoke runs:
>   [decisions evidence](notes/decisions-evidence.md#review-live-smoke). Since: `b4b23cf`.

## A-0314 · archived 2026-10-24 · Known limits

Status: SUPERSEDED by `[D-REVIEW-PROFILES]` in DECISIONS.md.
Source: `c101637:DECISIONS.md`, lines 1381-1386, whole entry verbatim.
Original provenance: `3389347`.
Archived by: subagent-profiles; introducing archive commit: `git log -S'A-0314' -- DECISIONS-ARCHIVE.md`.

> - **Known limits** `[D-REVIEW-LIMITS]`. `ctx.modelRegistry.runtime` may be renamed by a Pi update, then every review
>   fails with "the model runtime of the session is not reachable"; a verdict finishing after the session ended (quit,
>   `/new`, `/resume`, reload) is dropped; print and json mode wait for a slow review as long as it runs, and an abort of the caller's run only ends that wait, leaving the review running and its verdict saved without a turn; a verdict
>   arriving during a manual `/compact` with no run is appended and seen on the next turn; the reviewer may read a file
>   Main is still editing (`startedText` asks Main not to). The main agent's own RQW-tools grep still passes a string
>   `"null"` glob to rg: item GREP-NULL in [BACKLOG.md](BACKLOG.md#grep-null). Since: `3389347`.

## A-0315 · archived 2026-10-24 · Verdict format

Status: SUPERSEDED by `[D-REVIEW-VERDICT]` in DECISIONS.md.
Source: `c101637:DECISIONS.md`, lines 1337-1344, whole entry verbatim.
Original provenance: this port.
Archived by: subagent-profiles; introducing archive commit: `git log -S'A-0315' -- DECISIONS-ARCHIVE.md`.

> - **Verdict format** `[D-REVIEW-VERDICT]`. The reviewer's last message is `CLEAN` followed by `CHECKED:`, or `FINDINGS:` with
>   numbered `FINDING n` blocks (REQUIREMENT, MISMATCH, EVIDENCE, REQUIRED OUTCOME, each once) followed by `CHECKED:` and
>   `UNCHECKED:` sections when they apply; `REVIEWER.md` carries the exact format. `kindOf` in `index.ts` sorts a verdict
>   into `clean` (`CLEAN`, a non-empty `CHECKED:` and no `UNCHECKED:`), `findings` (an exact `FINDINGS:` line and complete
>   blocks), `incomplete` (anything else, including any `UNCHECKED:`, which is never acceptance) or `failed`. The text
>   stays as the reviewer wrote it, a preamble included. Structure cannot prove coverage: Main still assesses every required
>   obligation against `CHECKED:`. The message is `[review#N] <verdict>` and one `NEXT` paragraph for the kind.
>   Carrier: `index.ts`, `REVIEWER.md`. Proof: `test/review.test.ts`. Since: this port.

## A-0316 · archived 2026-10-24 · No invented data

Status: SUPERSEDED by `[D-STATUSBAR-SCOPE]` in DECISIONS.md.
Source: `c101637:DECISIONS.md`, lines 1644-1647, whole entry verbatim.
Original provenance: `0f356c4`.
Archived by: subagent-profiles; introducing archive commit: `git log -S'A-0316' -- DECISIONS-ARCHIVE.md`.

> - **No invented data** `[D-STATUSBAR-SCOPE]`. omp data without a stock Pi API is not shown: modes, collaboration,
>   streaming/recording and PR metadata. Running agent and review counts are shown, read from RQW-agent and
>   RQW-review over `pi.events` (`[D-STATUSBAR-ACTIVITY]`). Colours are the extension's own ANSI and truecolour values, not
>   stock theme roles. Limits and samples: `notes/statusbar-omp.md`. Since: `0f356c4`.

## A-0317 · archived 2026-10-24 · Activity chrome (UI port P6)

Status: SUPERSEDED by `[D-STATUSBAR-ACTIVITY]` in DECISIONS.md.
Source: `c101637:DECISIONS.md`, lines 1648-1658, whole entry verbatim.
Original provenance: `d84b541`.
Archived by: subagent-profiles; introducing archive commit: `git log -S'A-0317' -- DECISIONS-ARCHIVE.md`.

> - **Activity chrome (UI port P6)** `[D-STATUSBAR-ACTIVITY]`. The editor's top border shows the activity status after
>   `── `: the running tool's action (`Running <command>`, `Editing <file>`, `Searching files`) or `Planning next moves`,
>   then running counts (`2 agents, 1 review`) from the `rqw:running-counts:request`/`offer` channels, or
>   `Waiting for <counts>` when only background work runs, and `Compacting context` in gold during compaction; idle it is
>   the plain rule. Ordinary rules are silver, busy letters shimmer silver, compaction letters, chrome and context row shimmer
>   gold with the busy-letter mechanics (`[D-STATUSBAR-SHEEN]`). A static bold gold session title widget (`rqw-statusbar-title`) shows the session name above the
>   input. Off the original first branch the place row shows the English `⑂ fork #N` marker from the public session
>   tree, as defined in `[D-STATUSBAR-BRANCH-MARK]`. Footer effort colours: low plain, medium bold green, high bold
>   gold, xhigh bold bright purple, max bold red. Carrier: `extensions/RQW-statusbar/{activity,branch,render,editor,index}.ts`.
>   No owner quote for P6 is recorded here; the commit message lists the cross-extension native integration as not
>   verified. Since: `d84b541`.

## A-0318 · archived 2026-10-24 · D-SCOPE-WEB-SEARCH-MODEL

Status: SUPERSEDED by `[D-SCOPE-WEB-SEARCH-MODEL]` in DECISIONS.md.
Source: `c101637:DECISIONS.md`, lines 502-525, verbatim.
Archived by: subagent-profiles; archive commit: `git log -S'A-0318' -- DECISIONS-ARCHIVE.md`.

> - **Web-search model follows the caller** `[D-SCOPE-WEB-SEARCH-MODEL]`. The search-side GPT model matches the
>   calling agent, independently of the coordinator's development subagent table. GPT callers use the same model and
>   thinking; Claude callers use a fixed GPT counterpart from a product-side mapping, the same kind of cross-family
>   fallback as the reviewer. The owner's confirmed model/thinking table is in [D-WEB-MAPPING](#web-search-cli).
>   Search consumes the owner's ChatGPT
>   subscription usage like any Codex message; the subagent matrix is unchanged.
>   Owner (`16-27-59:4924`, entry `89d7b2e6`):
>   «Мы не привязываемся к координатам. Короче, модель будет та же, которая соответствует нашей модели, которая делает запрос. Вот так. Как понял меня? Давай синканемся здесь.»
>   «У нас у каждой cloud-модели есть соответственная модель GPT. А там какая модель на GPT? Там какая-то определённая модель выбирается, или как это происходит? Я не понимаю.»
>   Owner follow-up (`16-27-59:4928`, entry `e8dc0395`):
>   «Надо таблицу соответствия закрепить сразу же заранее. Просто надо понимать, какие модели ищут. Какая-то модель Soul 6, допустим.»
>   Coordinator text, interpretation before the owner's follow-up at line 4928: same GPT model/thinking for a GPT
>   caller; product-side fixed GPT counterpart for a Claude caller, not the coordinator's subagent classes;
>   searches spend subscription usage.
>   Owner fixed mapping (`16-27-59:4937`, entry `a8684155`):
>   «Давай так: для Haiku 5.5 будет Luna 5.6. Для Sonnet 5.5 будет Sol 6, а для Opus 5.5 будет Sol 6.1. Вот и всё. Только Sol 6.1 и Sol 6 знаешь как будут соответствовать Haiku? Следующим образом, смотри: Sonnet и Opus: low модель соответствует low модели. Sol 6.1 один к одному соответствует Sonnet. А вот Opus 5.5 и Sol 6.1 соответствуют следующим образом: Opus 5.5 low соответствует Sol 6.1 low, Opus 5.5 medium соответствует Sol 6.1 high, а Opus 5.5 high соответствует Sol 6.1 extra high. Соответственно, все высшие рислинги Opus соответствует Sol 6.1 max.»
>   Owner confirmed the complete table (`16-27-59:4941`, entry `2502a877`):
>   «Да, всё именно так, как ты записал.»
>   CLI callers may pass model/thinking arguments; the later tool applies the mapping automatically from its calling
>   agent's model/thinking, without model arguments for the agent. Owner (`16-27-59:4945`, entry `5a0f77bd`):
>   «И потом в будущем, когда мы сделаем tooling, таблица соответствия модели будет прокидываться автоматически на уровне функционала. Не как аргументы CLI, а на уровне функционала tooling всё это будет пробрасываться, форвардиться»
>   Reason: search follows the caller's capability instead of a universal cheap backend. Carrier: `cli/web/model-map.ts`,
>   table in [D-WEB-MAPPING](#web-search-cli).
>   Since: process-rules-oct23 squash.

## A-0319 · archived 2026-10-24 · D-SETTINGS-WARMING

Status: SUPERSEDED by `[D-SETTINGS-WARMING]` in DECISIONS.md.
Source: `c101637:DECISIONS.md`, lines 1065-1068, verbatim.
Archived by: subagent-profiles; archive commit: `git log -S'A-0319' -- DECISIONS-ARCHIVE.md`.

> - **Background cache warming** `[D-SETTINGS-WARMING]`. Background warming is off inside RQW-settings regardless of user configuration; normal inference still writes and reads prompt caches. A reversible session-owned `getCacheWarmingMode` policy leaves settings files, environment and cache-miss notices unchanged, restores the native getter on shutdown, and preserves other owners and foreign hooks through reload. Children carry their independent policy in Agent and Review.
>   Owner: «Да, и вообще надо убрать прогрев кэша, чтобы кэш прогревался, когда уходит сообщение первое, не раньше этого.» Source: `2026-10-21T16-27-59-062Z_01a15f4a-7ad5-7377-81be-0baf3b6ffa33.jsonl`, USER entry at line 440, in `~/.pi/agent/sessions/--Users-arkadijcukavin-ai-project-my-pi--/`.
>   Reason: no synthetic keepalive inference before the first real request.
>   Carrier: `extensions/RQW-settings/cache-warming.ts`, `extensions/RQW-settings/test/cache-warming.test.ts`, `test/cache-warming-reload.test.ts`; evidence: `notes/prompt-cache-policy.md`. Since: `b91f832`.

## A-0320 · archived 2026-10-24 · D-CODEX-OWNERSHIP

Status: SUPERSEDED by `[D-CODEX-OWNERSHIP]` in DECISIONS.md.
Source: `c101637:DECISIONS.md`, line 1982, whole entry verbatim.
Archived by: subagent-profiles; archive commit: `git log -S'A-0320' -- DECISIONS-ARCHIVE.md`.

> - **Ownership/coexistence** `[D-CODEX-OWNERSHIP]`. Provider hiding lives in the independently switchable `extensions/RQW-providers`, not in Anthropic or Codex transport registration. RQW-providers remains extension 14; RQW-codex is extension 15 immediately after it in `pi.extensions`. RQW-settings alone owns `/fast-gpt`, default off, priority through final payload hooks; child inheritance/overrides remain in RQW-agent/RQW-review. Children share native root cache affinity but never socket continuation, sticky turn state or opaque history. Reason: accepted 7a and extension isolation. Carriers: RQW-codex registration/lifecycle, optional `rqw-codex:session-policy` event in child factories; existing Fast owners unchanged.

## A-0321 · archived 2026-10-24 · Codex exception ledger: reviewer lifecycle

Status: SUPERSEDED by `[D-REVIEW-PROFILES]` in DECISIONS.md.
Source: `c101637:DECISIONS.md`, lines 2009-2009, verbatim.
Archived by: subagent-profiles; archive commit: `git log -S'A-0321' -- DECISIONS-ARCHIVE.md`.

> | Reviewer wall cap and explicit compaction-off policy | RQW-review keeps its existing safety and caller contract; native reconnect remains cancelable | RQW-review lifecycle |

## A-0322 · archived 2026-10-24 · D-SCOPE-POSTPONED · upstream corrected version

Status: SUPERSEDED by `[D-SCOPE-POSTPONED]` in DECISIONS.md.
Source: `d6fd638:DECISIONS.md`, lines 551-555, whole entry verbatim.
Archived by: subagent-profiles merge resolution; archive commit: `git log -S'A-0322' -- DECISIONS-ARCHIVE.md`.
The corrected upstream version is preserved separately from the earlier `c101637` version.

> - **Postponed features** `[D-SCOPE-POSTPONED]`. Postponed, not dropped: `custom`, the
>   `define-goal` skill and work orders, and the task list with the check before stopping (later switched on by a skill).
>   Coordinator text (historical unverified attribution): "мы их не упраздняем, а откладываем". Status of each item:
>   [BACKLOG.md](BACKLOG.md). The `agent` and `review` tools are separate decisions:
>   [Agent](#agent), [Review](#review). Since: `d28ae41`.

## A-0323 · archived 2026-10-24 · D-AGENT-PARITY · upstream corrected version

Status: SUPERSEDED by `[D-AGENT-PARITY]` in DECISIONS.md.
Source: `d6fd638:DECISIONS.md`, lines 1123-1126, whole entry verbatim.
Archived by: subagent-profiles merge resolution; archive commit: `git log -S'A-0323' -- DECISIONS-ARCHIVE.md`.
The corrected upstream version is preserved separately from the earlier `c101637` version.

> - **Subagent parity** `[D-AGENT-PARITY]`. General subagents use the main run's built prompt from public `ctx.getSystemPrompt()`, followed by a short subagent reminder and optional `role`; nested subagents receive the main prompt handed down, not their parent's role. Optional `system` or `system_file` replaces that whole prompt exactly; file alternatives and validation are defined in `[D-AGENT-PROMPT-FILES]`. General subagents get `agent` recursively with no depth or concurrency limit; explorers are leaves. Repository coordinator rules are not product policy, and the reminder excludes instructions addressed to the main agent or coordinator.
>   Owner: «Надо что бы саб агенты были как в куросре посмотри реверз инжинеринг и скажи свои предложения» Source: the same session, USER entry at line 2608.
>   Reason: share main's rules and context while allowing short role configuration and independent decomposition.
>   Carrier: `extensions/RQW-agent/index.ts`, `extensions/RQW-agent/prompt.ts`, `extensions/RQW-agent/test/agent.test.ts`; details: [RQW-agent README](extensions/RQW-agent/README.md#prompt-and-title). Since: `c86e9bb`.

## A-0324 · archived 2026-10-24 · D-AGENT-EXPLORE-TOOLS · upstream corrected version

Status: SUPERSEDED by `[D-AGENT-PROFILES]` in DECISIONS.md.
Source: `d6fd638:DECISIONS.md`, lines 1135-1149, whole entry verbatim.
Archived by: subagent-profiles merge resolution; archive commit: `git log -S'A-0324' -- DECISIONS-ARCHIVE.md`.
The corrected upstream version is preserved separately from the earlier `c101637` version.

> - **Explorer tools and read-only** `[D-AGENT-EXPLORE-TOOLS]`. `explore` keeps the main system prompt, the subagent reminder, a short search role and thoroughness `quick`, `medium` or `very thorough`, and takes no custom system/role/model/tools or prompt-file overrides. It runs on the current caller's model with the caller's active subset of the base tools `read`, `bash`, `edit`, `write`, `grep`, `find`, without `agent` or review; `codemode` and `tool_search` follow the caller's active tools, and `job` stays available when RQW-tools offers it. `restart` reads the caller's current model and active tools again. Read-only is an instruction of the role, not a mechanism: no file writes, edits or deletion, git state changes or installs, including through shell and codemode. No git guard or sandbox is installed for explorers. The separate `grep` and `find` tools stay for every agent next to `bash`, and no tool registration is added or removed. Reviewer read-only policy is a separate decision under [Review](#review), and this change modifies no RQW-review files.
>   Owner, session `2026-10-21T16-27-59-062Z_01a15f4a-7ad5-7377-81be-0baf3b6ffa33.jsonl`, `16-27-59:4416`, message `f3830a52`: «давай сделаем разведчика как в курсоре т.е. те же инструменты и шел
>
> баг бот и секьюрити ревью вообще не понял к чему ты их преплел
> Песочницы у нас нет»
>   Owner, `16-27-59:4424`, message `698dcebc`: «Смотри, у нас Explorer работает на той же модели, что и основной агент, поэтому его защита будет от записи просто инструкцией о том, что ему запрещено делать операции записи. Только чтение. Только редовые операции и всё. Этого будет достаточно, потому что если это будет тупая модель, то похуй. Я не видел таких ошибок вообще никогда, поэтому об этом даже не надо париться, о механической защите от записи.
>
> Я гоняю кодекс. Мой кодекс CLI никогда не работает в песочнице, он всегда работает на боевой, там песочница отключена. И ни разу не было такого, что reviewer что-нибудь напишет либо explorer что-нибудь напишет.»
>   Owner correction, `16-27-59:4429`, message `7690ba13`: «только read-only я хотел написать а не редовые»
>   Owner, `16-27-59:4433`, message `30ae092f`: «Тогда я думаю, отдельные инструменты типа grep и find не надо выносить в отдельные инструменты, пусть они будут в рамках шелла. И всё так же, как и раньше. Мы не будем ничего усложнять»
>   Owner, `16-27-59:4435`, message `331ce08c`: «И у ревьюера везде, где есть Read Only, просто будет Read Only на уровне инструкции, и всё»
>   Owner, `16-27-59:4451`, message `b1c5700f`: «Ну всё, тогда мы это оставляем и не трогаем. Это заебись!»
>   Coordinator text: the owner trusts the caller's model to obey the read-only instruction and explicitly rejects mechanical write protection. Cursor evidence: `my-pi-evidence/subagent-parity/cursor/REPORT.md:49`, explore has no tools override and inherits the caller's tools minus Task; the model inheritance and the read-only instruction are the owner's requirements, not a claim that Cursor enforces read-only.
>   Reason: a caller-model explorer with the caller's tools searches like a parent would, and the owner chose an instruction over protection code.
>   Carrier: `extensions/RQW-agent/index.ts`, `extensions/RQW-agent/prompt.ts`; details: [RQW-agent README](extensions/RQW-agent/README.md#prompt-and-title); proof: `extensions/RQW-agent/test/agent.test.ts`. Supersedes the git-guarded read/grep/find/bash allowlist of `[D-AGENT-TITLE-EXPLORE]` (A-0241). Since: the explore-cursor change.

## A-0325 · archived 2026-10-24 · D-REVIEW-PORT · upstream corrected version

Status: SUPERSEDED by `[D-REVIEW-PORT]` in DECISIONS.md.
Source: `5aacef79eb9b37846902efc9409cd1c8c8efc0f8:DECISIONS.md`, lines 1205-1220, whole entry verbatim.
Archived by: subagent-profiles merge resolution; archive commit: `git log -S'A-0325' -- DECISIONS-ARCHIVE.md`.
The corrected upstream version is preserved separately from the earlier `c101637` version.

> - **Codex reviewer port** `[D-REVIEW-PORT]`. `RQW-review` carries the owner's working Codex CLI reviewer over to Pi, adapted
>   to this harness. The base is his existing cycle, not a newly invented workflow: the profiles `smarty` and `bossy`
>   (`agents/*.toml`) and the Main-side skills `subagents`, `blindreview` and `highreview` of his Codex CLI plugin
>   `scope-focus`, whose `.codex-plugin/plugin.json` names the developer `A. Chukavin` and supplies no licence text or other
>   attribution. The earlier reviewer flow, its dispute rules and its benchmark campaign are cancelled; their entries are
>   in [DECISIONS-ARCHIVE.md](DECISIONS-ARCHIVE.md) (A-0248 to A-0256). Pi's `read`, `bash`, `grep` and `find` replace the
>   Codex tools.
>   Owner (`16-27-59:5195`, `16-27-59:5210`, `16-27-59:5286`, `16-27-59:5291`):
>   «этот малой на Sol 6.1 Low очень хорошо защищает агента от ошибок»
>   «Мы отменяем текущий flow работы над reviewer и переобуваемся в новый прекрасный flow.»
>   «давай мы пойдём от того, что мы возьмём текущего ревьюера, рабочего уже, пиздатого, и его немножко прокачаем, подтюним, оптимизируем. Не будем смотреть на старого ревьюера.»
>   «Надо его перенести, адаптировав к нашему harness, потому что у них свой harness, у нас свой harness. Надо адаптацию сделать полную, чтобы по смыслу работало так же»
>   Reason: the Codex reviewer already works in practice, and the old reviewer missed errors. Carriers: `REVIEWER.md`,
>   `index.ts`, [RQW-review README](extensions/RQW-review/README.md), [PROCESS.md, Independent review](PROCESS.md#independent-review).
>   The whole-cycle comparison with the original plugin is discarded by the owner, not queued:
>   [BACKLOG.md, Discarded](BACKLOG.md#codex-reviewer-comparison).

## A-0326 · archived 2026-10-24 · D-REVIEW-PROFILES · upstream corrected version

Status: SUPERSEDED by `[D-REVIEW-PROFILES]` in DECISIONS.md.
Source: `5aacef79eb9b37846902efc9409cd1c8c8efc0f8:DECISIONS.md`, lines 1237-1249, whole entry verbatim.
Archived by: subagent-profiles merge resolution; archive commit: `git log -S'A-0326' -- DECISIONS-ARCHIVE.md`.
The corrected upstream version is preserved separately from the earlier `c101637` version.

> - **Reviewer profiles** `[D-REVIEW-PROFILES]`. One table, `LEVELS` in `index.ts`, independent of the main agent's model:
>   `blind` is Smarty, `openai-codex/gpt-6.1-sol` thinking low; `high` is Bossy, `openai-codex/gpt-6.1-sol` thinking
>   medium. When the model is missing or `openai-codex` has no credentials, the review fails with an explicit error
>   (`review requires Codex credentials, no fallback`) and no other provider runs. A failed request gives
>   `Review failed: <reason>` and no automatic retry by the extension; Pi's own inherited request retries apply. The
>   review has no deadline of its own: only session shutdown, or the end of the subagent that asked, aborts a running
>   review, while an abort of the caller's run (Esc or RPC) leaves it running. Verdict `details` carry the model that ran.
>   Coordinator text: Bossy medium is the `model_reasoning_effort` of `agents/bossy.toml`, which the source skill maps to
>   the `high` level. The Claude reviewer measurement is discarded by the owner, not deferred:
>   [BACKLOG.md, Discarded](BACKLOG.md#claude-reviewer).
>   Reason: the owner's working reviewer runs on Sol; no Claude measurement or model selection is scheduled.
>   Carrier: `index.ts` (`LEVELS`, `pickReviewer`). Proof: `test/levels.test.ts`, `test/codex-policy.test.ts`,
>   `test/startup-policy.test.ts`. Since: this port.


## A-0318 · archived 2026-10-24 · D-WORK-NIGHT-DEFAULT

Status: SUPERSEDED by [D-WORK-ONLY-ORDERED] in DECISIONS.md.
Source: `df250746e1d2aa901612e8a020534531bfc94b90:DECISIONS.md`, whole entry verbatim.
Archived by: rule-only-ordered; exact commit: `git log -S'A-0318' -- DECISIONS-ARCHIVE.md`.

> - **Night defaults** `[D-WORK-NIGHT-DEFAULT]`. While the owner sleeps or does not answer overnight, Main takes the
>   recommended option for each question and records it as `taken by default` in DECISIONS and the handoff;
>   the owner may reverse it in the morning. Owner (`16-27-59:4911`, entry `75120103`):
>   «да принимаю это ночное правило»
>   Coordinator text, accepted proposal (`16-27-59:4907`, entry `08ec46e5`):
>
>   **Для остальных задач, которые ждут твоих ответов, предлагаю ночное правило.** Пока ты спишь, на каждый вопрос к тебе я беру рекомендованный вариант и записываю его как принятый по умолчанию. Утром ты можешь его отменить. Это касается, например, выбора структуры после исследования, параметров веб-поиска и мелких развилок. Без тебя ночью не делается:
>   1. публикация плагина в Marketplace;
>   2. удаление твоих данных и сессий;
>   3. изменения в `~/.pi` сверх установки сторонних расширений;
>   4. траты лимитов сверх замера ревьюера.
>
>   Never default-approve Marketplace publication, deletion of owner data/sessions, ~/.pi changes beyond installing
>   third-party extensions, or spending limits beyond the reviewer measurement. Resuming a task paused by its 2-hour
>   timebox ([D-PIPELINE-TIMEBOX]) is never default-approved. Reason: keep routine choices moving
>   without granting irreversible or excluded actions. Carrier:
>   [PROCESS.md, Isolated parallel execution](PROCESS.md#isolated-parallel-execution).
>   Since: process-rules-oct23 squash.


## A-0319 · archived 2026-10-24 · D-SCOPE-LEAN

Status: SUPERSEDED by [D-WORK-ONLY-ORDERED] in DECISIONS.md.
Source: `df250746e1d2aa901612e8a020534531bfc94b90:DECISIONS.md`, whole entry verbatim.
Archived by: rule-only-ordered; exact commit: `git log -S'A-0319' -- DECISIONS-ARCHIVE.md`.

> - **Lean engineering scope** `[D-SCOPE-LEAN]`. Fix obvious major failures, not speculative rare cases; completed native
>   physical routing and filesystem identity fixes stay. Coordinator text (historical unverified attribution): "Не надо
>   делать микроправки всяких хуёвин, которые возможно никогда не всплывут, и у них редкость возникновения очень высокая,
>   вероятность, что они возникнут, крайне мала. Надо править именно очевидные жирные ошибки, а не вылизывать до
>   предела."; "ты всю уже выполненную работу собираешь вместе. Просто ты дополнительной работы не делаешь и всё."
>   Carriers: `extensions/RQW-context/index.ts`, `extensions/RQW-tools/`, `notes/context-questions.md`; this does not
>   promise every rare filesystem or long-path case. Process side: [PROCESS.md](PROCESS.md#isolated-parallel-execution).
>   Since: `9ef1519`.


## A-0320 · archived 2026-10-24 · D-STRUCT-NIGHT-DEFAULTS

Status: SUPERSEDED by [D-WORK-ONLY-ORDERED] in DECISIONS.md.
Source: `df250746e1d2aa901612e8a020534531bfc94b90:DECISIONS.md`, whole entry verbatim.
Archived by: rule-only-ordered; exact commit: `git log -S'A-0320' -- DECISIONS-ARCHIVE.md`.

> - **Code-layout research night defaults** `[D-STRUCT-NIGHT-DEFAULTS]`. Coordinator record, not an owner quotation:
>   all seven recommended options in section 7 of
>   `/Users/arkadijcukavin/ai-project/my-pi-evidence/code-layout-research/REPORT.md` are `taken by default`
>   under [PROCESS.md, Night default](PROCESS.md#isolated-parallel-execution), reversible by the owner.
>   1. **1a:** Keep `test/` as the root, with mirrored tests in `test/extensions/RQW-<name>/`.
>   2. **2a:** Keep extensions flat: `index.ts`, concern-specific files and README; use subfolders only above
>      15 code files, currently only `RQW-codex`.
>   3. **3a:** Generate `INDEX.md` and each README's file table, run `--check` in `npm test`, and shorten
>      `AGENTS.md` to about 60 lines.
>   4. **4a:** Add `ast-grep` as a devDependency, `tsconfig.json` and `npm run typecheck`; consider hybrid
>      document search only after a measurement on 30 questions; do not install LSP or MCP.
>   5. **5a:** Adopt the proposed `PROCESS.md` Code quality text from report section 5.5; leave the manifesto unchanged.
>   6. **6a:** Do not run the dense-versus-decomposed measurement; accept the section 5.5 principle as proposed.
>   7. **7a:** Follow the queue: UI branches, small merges, then one structure-plus-index task using `git mv`
>      and index checking; audits follow afterwards.
>   Reason: record the report's recommended choices under the accepted night rule without attributing them to the owner.
>   Carrier: this decision records choices for later implementation; it does not claim those changes are implemented.

## A-0321 · archived 2026-10-24 · Replaced scope and review-brief rules

Status: SUPERSEDED by [D-WORK-ONLY-ORDERED] in DECISIONS.md.
Source: `df250746e1d2aa901612e8a020534531bfc94b90:PROCESS.md` and `extensions/RQW-review/skills/reviewer/SKILL.md`, replaced spans verbatim.
Archived by: rule-only-ordered; exact commit: `git log -S'A-0321' -- DECISIONS-ARCHIVE.md`.

> 4. Bring all material ambiguities, conflicts and missing outcome decisions to the owner in one question batch.
>    Do not decide for the customer without permission. Delegated technical choices, including subagent model selection,
>    remain the agent's responsibility within the agreed outcome; they are not permission to widen or shrink it.

> - Night default: while the owner is asleep or not answering overnight, take the recommended option on every question to
>   him, record the choice as `taken by default` in `DECISIONS.md` and the handoff, and keep it reversible by the
>   owner in the morning. This includes structure choices after research, web-search parameters and small design
>   forks; default choices are coordinator records under this accepted rule, not fabricated owner quotations.
>   Without the owner, never publish PCLI to the Marketplace, delete his data or sessions, change `~/.pi` beyond
>   installing third-party extensions, or spend limits beyond the reviewer measurement. These exceptions stay
>   blocked rather than being approved by default. Resuming a task paused by its 2-hour timebox is one more such
>   exception ([Task timebox](#task-timebox)).
> - Main drives the whole agreed task to completion autonomously through subagents: they implement, inspect, make the
>   needed probes and measurements, and fix obvious defects and relevant corner cases. Do not polish extremely
>   unlikely scenarios or expand the task.

>   a squash merge; never on Main's own initiative. The task has these sections in this order: `<agreement>` only
>   when there are accepted proposals and decisions that are not the owner's own messages, `<object>` (exact paths
>   or readable references, primary requirements, governing rules, source evidence, the diff as a file path, and the
>   stage `pre-action` or `pre-completion`), `<criterion>` (what the check confirms and which deliverable must fulfil
>   each obligation; an exclusion cannot silently waive a governing requirement of this pass) and, from the second
>   pass on, `<rejected_earlier>`. `include: ["user_messages"]` mechanically appends `<user_messages>` after the task:
>   every user-role text of the caller's selected branch, verbatim and in order, including entries before compaction.
>   Images and non-user messages are omitted; nested callers contribute their own messages. Do not retype the messages.
>   Set no file, search, tool-call or turn quotas, and leave the reviewed files unchanged until the verdict.

>   - `<agreement>`, only when there are any: accepted proposals and decisions that are not in the user's own messages, verbatim.

>   - `<criterion>`: what this check confirms and which deliverable must fulfill each obligation; an exclusion cannot silently waive a governing requirement of this pass.

## A-0322 · archived 2026-10-24 · D-WEB-DEFAULTS

Status: SUPERSEDED by [D-WORK-ONLY-ORDERED] in DECISIONS.md.
Source: `23e7413:DECISIONS.md`, whole entry verbatim.
Archived by: rule-only-ordered; exact commit: `git log -S'A-0322' -- DECISIONS-ARCHIVE.md`.

> - **Defaults** `[D-WEB-DEFAULTS]`. These choices are `taken by default` under the night rule, `PROCESS.md` Night default; the owner accepted that rule: «да принимаю это ночное правило про проверку кодекс транспорта или там что то еще?» (`16-27-59:4911`). These are coordinator records, not owner quotations, reversible by the owner: 1. name `rqw-web` and default mode `cached`, `--mode live` for fresh facts; 2. at most three targets run at once, the rest are queued, a normal wave is up to four targets; 3. stdout is capped at 2000 lines or 48 KiB, the earlier wins, and the full normalized result goes to a private temporary file with the path and the next line printed; 4. Claude `off` and `minimal` are rejected as unmapped. Reason: the research recommendations, with a bounded subscription burst and a result that cannot flood the caller's context. The original build request explicitly authorized the small live subscription checks; they were performed and are not repeated for this scope correction, which authorizes no additional live calls.

## A-0323 · archived 2026-10-24 · D-REVIEW-CYCLE brief procedure

Status: SUPERSEDED by [D-WORK-ONLY-ORDERED] in DECISIONS.md.
Source: `23e7413:DECISIONS.md`, replaced brief bullet verbatim.
Archived by: rule-only-ordered; exact commit: `git log -S'A-0323' -- DECISIONS-ARCHIVE.md`.

>   - Brief: `include: ["user_messages"]` mechanically appends user-role text from the caller's selected branch,
>     verbatim and in order, after the task; images and non-user summaries are omitted. Main gives `<agreement>` when there is any (accepted proposals and decisions
>     that are not the user's own messages, verbatim), `object` (exact paths or readable references to the object, the
>     primary requirements, applicable governing rules and source evidence, the diff as a file path, and the stage
>     `pre-action` or `pre-completion`), `criterion` (what the check confirms and which deliverable must fulfil each
>     obligation; an exclusion cannot silently waive a governing requirement of this pass) and, from the second pass on,
>     `rejected_earlier` (each rejected finding with its reason). These task sections keep that order, then
>     `<user_messages>` follows. No file, search, tool-call or turn quotas.


## A-0327 · archived 2026-10-25 · Unconditional full local delivery test assertion

Status: SUPERSEDED by [D-PIPELINE-DOC-GATE] in DECISIONS.md.
Source: `0521318:DECISIONS.md`, replaced passage verbatim.
Archived by: process-speed-delivery; exact commit: `git log -S'A-0327' -- DECISIONS-ARCHIVE.md`.

>   The full local delivery `npm test` is the exception under [D-PIPELINE-LOCAL-GATE].

## A-0328 · archived 2026-10-25 · Unconditional full local delivery test assertion

Status: SUPERSEDED by [D-PIPELINE-DOC-GATE] in DECISIONS.md.
Source: `0521318:DECISIONS.md`, replaced passage verbatim.
Archived by: process-speed-delivery; exact commit: `git log -S'A-0328' -- DECISIONS-ARCHIVE.md`.

>   unchanged, except for the full local delivery run under [D-PIPELINE-LOCAL-GATE]; no Linux requirement;

## A-0329 · archived 2026-10-25 · Unconditional full local delivery test assertion

Status: SUPERSEDED by [D-PIPELINE-DOC-GATE] in DECISIONS.md.
Source: `0521318:DECISIONS.md`, replaced passage verbatim.
Archived by: process-speed-delivery; exact commit: `git log -S'A-0329' -- DECISIONS-ARCHIVE.md`.

>   Coordinator text, the approved proposal in short (the verbatim text is in `DECISIONS-ARCHIVE.md`, A-0246): 1. test exactly
>   what is merged, rebased onto a fresh `main`, with full local `npm test` on the final commit ([D-PIPELINE-LOCAL-GATE]); 2. a review covers only the commit it checked; 3. before every merge `deliver-check` checks the
>   branch contains current `main`, full local `npm test` on that exact commit, the review
>   numbers with CLEAN and the list of what was not verified live; 4. every report carries an evidence table and an honest
>   "not verified live" section.
>   Coordinator text, interpretation of rule 2: a conflict-free rebase onto `main` needs the full local delivery test on the new head
>   but no new review; places changed while resolving conflicts go back to review.

## A-0330 · archived 2026-10-25 · Unconditional full local delivery test assertion

Status: SUPERSEDED by [D-PIPELINE-DOC-GATE] in DECISIONS.md.
Source: `0521318:DECISIONS.md`, replaced passage verbatim.
Archived by: process-speed-delivery; exact commit: `git log -S'A-0330' -- DECISIONS-ARCHIVE.md`.

>   `deliver-check` passes, including full local `npm test` on the exact committed head ([D-PIPELINE-LOCAL-GATE]). Owner:

## A-0331 · archived 2026-10-25 · Unconditional full local delivery test assertion

Status: SUPERSEDED by [D-PIPELINE-DOC-GATE] in DECISIONS.md.
Source: `0521318:DECISIONS.md`, replaced passage verbatim.
Archived by: process-speed-delivery; exact commit: `git log -S'A-0331' -- DECISIONS-ARCHIVE.md`.

>   review; the full local delivery test still applies ([D-PIPELINE-LOCAL-GATE]); a change of meaning gets review; runtime prompts are checked by agent behavior. Owner:

## A-0332 · archived 2026-10-25 · Unconditional full local delivery test assertion

Status: SUPERSEDED by [D-PIPELINE-DOC-GATE] in DECISIONS.md.
Source: `0521318:DECISIONS.md`, replaced passage verbatim.
Archived by: process-speed-delivery; exact commit: `git log -S'A-0332' -- DECISIONS-ARCHIVE.md`.

> - **Local delivery test gate** `[D-PIPELINE-LOCAL-GATE]`. The only delivery test condition is full local `npm test`
>   passing on the exact committed branch head on the owner's macOS. `deliver-check` runs it in the existing clean
>   task worktree, checking cleanliness and the head before and after the run; no receipt or new mechanism.

## A-0333 · archived 2026-10-25 · Process reading contract

Status: SUPERSEDED by [D-WORK-PROCESS-SPLIT] in DECISIONS.md.
Source: `0521318:DECISIONS.md`, replaced passage verbatim.
Archived by: process-speed-delivery; exact commit: `git log -S'A-0333' -- DECISIONS-ARCHIVE.md`.

> - **Process file and manifesto** `[D-WORK-PROCESS-LINK]`. `AGENTS.md` links `PROCESS.md` with mandatory lazy reading at
>   every task and context restoration; procedural rules belong in `PROCESS.md`.

## A-0334 · archived 2026-10-25 · Delivery gate and process-layout reference wording

Status: SUPERSEDED wording under [D-PIPELINE-DOC-GATE] and [D-WORK-PROCESS-SPLIT] in DECISIONS.md. Only the accepted document-only gate changes policy; the split preserves the other rules.
Source: `0521318:PROCESS.md`, replaced passages verbatim.
Archived by: process-speed-delivery; exact commit: `git log -S'A-0334' -- DECISIONS-ARCHIVE.md`.

Replaced fragment 1:

> full local `npm test` on the exact committed branch head on the owner's macOS.

Replaced fragment 2:

> except for the mandatory local delivery run below.

Replaced fragment 3:

> The delivery exception is full local `npm test` on the exact committed branch head, run by `deliver-check`.

Replaced fragment 4:

> `deliver-check` runs full local `npm test` on that final committed head, whose squash has the same
>   tree.

Replaced fragment 5:

> the full local delivery run still applies.

Replaced fragment 6:

> it needs the full local delivery test on the new head, not new review;

Replaced fragment 7:

> The only delivery test
>    condition is full local `npm test` on that exact committed head on the owner's macOS, run by `deliver-check`.

Replaced fragment 8:

> It runs full `npm test`
>    in the branch's existing clean task worktree on the owner's macOS, at the exact committed branch head, and
>    checks worktree cleanliness and the head before and after the run.

Replaced fragment 9:

> In `DECISIONS.md` and `PROCESS.md` text

Replaced fragment 10:

> `PROCESS.md` against the owner sessions

Replaced fragment 11:

> The block below is the only place that lists the pairs, and the source of truth for the dev guard.

## A-0335 · archived 2026-10-25 · Mandatory process reading preamble

Status: SUPERSEDED reading contract by [D-WORK-PROCESS-SPLIT] in DECISIONS.md.
Source: `0521318:PROCESS.md`, replaced passages verbatim.
Archived by: process-speed-delivery; exact commit: `git log -S'A-0335' -- DECISIONS-ARCHIVE.md`.

> This is the working procedure for agents developing my-pi. Read it before every task and restore it after
> compaction or a context handoff. `WORKFLOW-MANIFEST.md` is the owner's personal record of his working principles
> and aspirations, not a procedural gate. This file carries the agreed execution rules; `DECISIONS.md` carries
> the accepted decisions and their reasons. New owner instructions take precedence over older agreements.

## A-0336 · archived 2026-10-25 · AGENTS mandatory process reading contract

Status: SUPERSEDED reading contract by [D-WORK-PROCESS-SPLIT] in DECISIONS.md.
Source: `0521318:AGENTS.md`, replaced passages verbatim.
Archived by: process-speed-delivery; exact commit: `git log -S'A-0336' -- DECISIONS-ARCHIVE.md`.

> Before every task, read and follow [PROCESS.md](PROCESS.md). Restore it after compaction or a handoff before
> continuing. This is mandatory lazy loading, not optional background reading. Give subagents the relevant process
> rules in their briefs. The owner's personal manifesto is a separate memory document, not the execution procedure.

## A-0324 · archived 2026-10-25 · D-CONTEXT-ROUTING

Status: SUPERSEDED by [D-CONTEXT-ROUTING] in the context-simplify delivery.
Source base commit: `0521318:DECISIONS.md`, whole entry verbatim. Introduced: `6eb01a7`.
Archived by: context-simplify delivery; exact commit: `git log -S'A-0324' -- DECISIONS-ARCHIVE.md`.

> - **Native routing and reserve** `[D-CONTEXT-ROUTING]`. Stable capped copies are exposed through Agent state, `createLoopConfig`, `_buildRuntime` and native `ModelRuntime.getPhysicalModel`; registry entries are not mutated. Virtual selections keep their native identity, callback, thinking and declared or unknown window. Session/request-local `AsyncLocalStorage` supplies the physical target's W/R: automatic preparation uses its triggering target, manual preparation the latest successful response after abort. Default summaries preserve interception preparation and route once from the captured selection, retaining the original explicit reserve intent. On Pi 1.4.0 reserve rebinding does not size summary output; optional removal is tracked in [BACKLOG](BACKLOG.md).
>   Coordinator text. Reason: physical limits must not leak across concurrent operations or alter native selection identity.
>   Carrier: `extensions/RQW-context/index.ts` (`wrapAgentState`, `wrapRouting`, `wrapCompactionSettings`, `reserveIntents`); details: `notes/context-questions.md`. Since: `6eb01a7`.

## A-0327 · archived 2026-10-25 · Isolation · Tests beside extension code

Status: SUPERSEDED by `[D-STRUCT-TEST-LAYOUT]` and `[D-ISOLATION-SELF-CONTAINED]` in DECISIONS.md.
Source: `0521318:DECISIONS.md`, first paragraph of the isolation entry, verbatim.
Archived by: `test-layout-move`; exact commit: `git log -S'A-0327' -- DECISIONS-ARCHIVE.md`.

> - **Self-contained extensions** `[D-ISOLATION-SELF-CONTAINED]`. Each RQW extension is independently switchable and imports no file outside its folder, including in local tests. Shared helpers are copied: both `selection.ts` copies are 127 lines, and Fast event-channel constants are repeated in three extension-local files. Extension-local tests load only that extension; multi-extension tests live under root `test/`. Disabling an extension removes its owned behavior; process-wide Context and PCLI hooks stay active while any owner remains.


## Archived 2026-10-25 · Work policy · Temporary GPT-only development subagents

Status: superseded by `[D-WORK-MODELS]`, permanent policy effective 2026-10-01.
Source: `DECISIONS.md` at `d443f435e82d459be26c81f941ee7da279d9fc34`, lines 111-116.
Introducing commits: `7afb688e` for the task-class policy, `689da9c9` for the temporary override and profile update.
Replacement: rule-haiku-subagents commit, identifiable with `git log -S'Effective permanently from 2026-10-01' -- PROCESS.md`.

- **Temporary GPT-only development subagents** `[D-WORK-TEMP-GPT]`. Until 2026-10-28 19:00 Moscow time,
  `2026-10-28T16:00:00Z`, development subagents use only the GPT pairs of the task-class table. No Anthropic
  subagents run during this override; after expiry the normal table applies. Owner (`16-27-59:6096`, entry `bda4ad42`):
  «вот саб агенты будут толко GPT до среды 19:00 мск.»
  Reason: the owner's newer restriction replaces the earlier Sonnet-only Anthropic exception.
  Carrier: [PROCESS.md, Subagent models](PROCESS.md#subagent-models), coordinator guard. Since: subagent-profiles.


## Archived 2026-10-25 · Work policy · Development subagent models before permanent Haiku policy

Status: superseded by `[D-WORK-MODELS]`, permanent policy effective 2026-10-01.
Source: `DECISIONS.md` at `d443f435e82d459be26c81f941ee7da279d9fc34`, lines 179-219.
Introducing commits: `7afb688e` for the task-class policy, `689da9c9` for the temporary override and profile update.
Replacement: rule-haiku-subagents commit, identifiable with `git log -S'Effective permanently from 2026-10-01' -- PROCESS.md`.

- **Development subagent models** `[D-WORK-MODELS]`. Rule for developing this repository with agents only, as the
  owner confirmed; it is not a product model setting and not a rule for the rest of Pi. Three task classes:
  ordinary, complex, and the hardest and most important. The classes, their model and reasoning pairs and the
  machine-readable settings live only in the `coordinator-rules` JSON block of
  [PROCESS.md, Subagent models](PROCESS.md#subagent-models); this entry does not repeat the pairs. Main starts only
  ordinary `agent` subagents and gives `model` and `thinking` explicitly on every start and restart. Specialized
  roles use `agent_type` on that same lifecycle. The even Anthropic/GPT balance stays outside the temporary
  GPT-only override `[D-WORK-TEMP-GPT]`. Product reviewer profiles are separate settings under [Review](#review).
  Owner's messages or contiguous spans from the session file
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

А почему у тебя дети молча получают родительскую модель? Такого не должно быть. Ты детей назначаешь сам. У тебя единственный, кто получает родительскую модель — это Explorer. Explorer получает родительскую модель, но это в обычной работе. А ты координатор, ты работаешь отдельно, у тебя другой flow, свой собственный. Понимаешь разницу?»
  Final table, a separate contiguous span of the same message:
«Ответы на твои вопросы. Простые задачи: Sonnet Medium и Sol 6.1 Low. Сложные задачи: Sonnet 5.5 High, Sol 6.1 Medium. И самые тяжёлые и самые важные задачи: Opus 5.5 Medium и Sol 6.1 High.»
  Coordinator reading (agent text, not owner words): the final table is in the line 4203 message; it adds the third
  class, the hardest and most important tasks; the Opus 5.5 low of line 4162 is cancelled. The historical
  Explorer exception in the quoted message is superseded by `[D-AGENT-PROFILES]`; no explorer is provided.
  Reason: owner decision, and the rule must not be lost again, so it has one source and a mechanical guard.
  Carriers: [PROCESS.md, Subagent models](PROCESS.md#subagent-models) (the JSON block and the rules); the dev-only
  project extension `.pi/extensions/coordinator-guard/` (Main's top-level session in this checkout only).
  Superseded earlier entries: `DECISIONS-ARCHIVE.md`, A-0001 to A-0004.

## A-WEB-CLI-REMOVED - archived 2026-10-25

Replacement: the shipped `web` tool in `extensions/RQW-web/`, decision D-WEB-REMOVE-CLI.
Source: origin/main 4c8ff26; preceding active Web search CLI decision preserved verbatim below.
Owner order in the current repository session: «эту хуйню удалить - cli/web»; full owner message: «эту хуйню удалить - cli/web: прежняя команда поиска из терминала, её теперь заменяет web.»

## Web search CLI

The shipped independent `web` tool lives in `extensions/RQW-web/`; `bin/rqw-web.mjs` remains a compatible repository-local shell entry over the same core. Contract: [RQW-web README](extensions/RQW-web/README.md), [CLI README](cli/web/README.md). Research and ready-made alternatives: `/Users/arkadijcukavin/ai-project/my-pi-evidence/web-search/RESEARCH.md`. Superseded phase-1-only text is preserved in [the archive](DECISIONS-ARCHIVE.md#a-web-phase1--archived-2026-10-24--web-search-cli).

- **Own thin implementation** `[D-WEB-CLI]`. Owner (`16-27-59:4782`): «Надо посмотреть ее кишки, взять ее базу, облегчить ее.» Owner (`16-27-59:4888`): «Это будет просто CLI, которую агент будет вызывать из shell.» Owner (`16-27-59:4917`): «Делаем клон Codex, чтобы наш агент работал с этой хуйнёй так же, как с Codex.» The owner ordered a lightweight own base. Researched alternatives were not adopted: actively maintained MIT `pi-web-access` 0.44.0 has 9 direct dependencies, 208 lock entries and about 10.3 MB unpacked, many unrelated providers and features, and a different normal OpenAI search path; a separate Codex CLI duplicates the agent environment/auth; API-key Responses has different billing. Only batching, sourced answers, explicit errors and overflow continuation ideas are reused. Carrier: `extensions/RQW-web/`.
- **Tool and CLI interface** `[D-WEB-INTERFACE]`. Owner (`16-27-59:4917`): «Если для агента это будет тяжело, то сделай две команды. А если казуально, то оставь одну» One tool `web` takes nonempty `queries` OR `urls`, optional URL-only `focus`, `mode: cached|live|indexed` and `response_length: short|medium|long`. It returns concise summaries, supporting links, statuses and actual search model/thinking. The CLI preserves repeated `--query` OR `--url`, URL-only `--focus`, explicit required `--caller-model` and `--thinking`, `--mode` and `--response-length`. There is no npm bin or global command. Carrier: `extensions/RQW-web/tool.ts`, `description.md`, `cli/web/`, `bin/rqw-web.mjs`.
- **Automatic model mapping** `[D-WEB-MAPPING]`. Owner (`16-27-59:4941`): «Да, всё именно так, как ты записал.» Owner (`16-27-59:4937`): «Давай так: для Haiku 5.5 будет Luna 5.6. Для Sonnet 5.5 будет Sol 6, а для Opus 5.5 будет Sol 6.1. Вот и всё.» Owner (`16-27-59:4945`): «Не как аргументы CLI, а на уровне функционала tooling всё это будет пробрасываться, форвардиться» The tool captures `ctx.model` and its own Pi API's `getThinkingLevel()` at each invocation, not the coordinator model; model arguments are absent. The model rule stays in [D-SCOPE-WEB-SEARCH-MODEL](#scope).

  | Calling model | Search model | Thinking |
  | --- | --- | --- |
  | Recognized `openai-codex` GPT | Same exact model | Same level |
  | `anthropic/claude-haiku-5-5` | `gpt-5.6-luna` | Same level |
  | `anthropic/claude-sonnet-5-5` | `gpt-6-sol` | Same level |
  | `anthropic/claude-opus-5-5` | `gpt-6.1-sol` | low -> low, medium -> high, high -> xhigh, above high -> max |
  | Unknown or missing model, including unknown GPT slug | `gpt-6.1-sol` | low |

  Owner's fallback (`16-27-59:6331`, entry `e3aba5d4`): «если короче это модель не опознанная то всегда по дефолту 6.1 сол лоу юзать» Known callers with unsupported thinking fail explicitly; Claude `off` and `minimal` stay unmapped. Carrier: `extensions/RQW-web/core/model-map.ts`.
- **Engine** `[D-WEB-ENGINE]`. The existing Codex CLI 0.164.0 source research selected the Responses Lite path `web.run -> POST alpha/search -> function_call_output -> sourced answer`, not hosted-only `web_search`. Each target has an ephemeral web-only loop, no Pi AgentSession, stored history, provider registration, prewarm or compaction. Pure transport/auth code is a minimal local snapshot with original path and commit headers; no import reaches another extension. The snapshot retains the existing 0.163.0 transport pin. Reason: preserve the researched subscription mechanism while keeping RQW-web independently switchable. Carrier: `extensions/RQW-web/core/`, `vendor/`.
- **Read-only credentials** `[D-WEB-AUTH]`. The public `readStoredCredential` supplies only saved `openai-codex` OAuth. No auth writes, copied auth files, refresh, private ModelRuntime credentials or API-key/other-provider fallback. Missing, expiring or rejected login returns a hint to use Pi for refresh or `/login openai-codex`, then retry. Carrier: `extensions/RQW-web/core/credentials.ts`.
- **Defaults and bounds** `[D-WEB-DEFAULTS]`. The wrapper retains the existing CLI core's behavior: `cached`, `short`, three concurrent targets with the rest queued, target timeout 120000 ms, input-order results with independent errors. Normalized model-facing output is capped at 2000 lines or 48 KiB; overflow returns a full-result path and exact next line rather than another paid request. No raw reasoning, headers or secrets are written. Each target consumes subscription usage, with no requested GPT Fast. Carrier: `core/batch.ts`, `core/report.ts`, `core/truncate.ts`.
- **All agents, independent loading** `[D-WEB-ACCESS]`. Owner (`16-27-59:4917`): «Это будет инструмент, который будет доступен всем агентам, и воркеры будут типа нашей матрицы агентов и исполнителей, она никак не меняется.» Normal package loading registers `web`. RQW-agent receives the optional `rqw-web:subagent-web` offer on `pi.events` and registers against each child's own API, recursively. It needs neither RQW-tools nor RQW-codex enabled. Disabling RQW-web removes its main tool and offer; existing children retain their startup tools until restarted. The shell entry remains repository-local after `npm ci`. Carrier: `package.json`, `extensions/RQW-web/index.ts`, `extensions/RQW-agent/index.ts`.
- **Cross-platform ordinary temporary files** `[D-WEB-TEMP-FILES]`. Owner (`16-27-59:6372`, entry `f7f8b0ad`, 2026-10-24): «Насчет этой хуйни, заморочки с файлами на разных пользователей — поебать вообще» and «Не надо никаких заебов. Надо просто, чтобы все работало стабильно, быстро, производительно и эффективно». Overflow uses ordinary OS temporary files on every platform, with no explicit POSIX modes, per-user privacy contract, NTFS ACL handling or privacy assertions. This overrides the former phase-1 private-file requirement and the proposed NTFS treatment. Windows tests exercise actual behavior without mode-bit assumptions. `.gitattributes` pins `web-native-tools.json` with `-text` because the exact source-provenance hash must survive Windows checkout conversion. Carrier: `core/truncate.ts`, `.gitattributes`, web tests.

Since: web-search-tool.
## Statusbar title layout · archived 2026-10-25

Status: SUPERSEDED by the current `[D-STATUSBAR-ACTIVITY]`, `[D-STATUSBAR-TOP]`,
`[D-STATUSBAR-SHEEN]` and `[D-STATUSBAR-ANIMATION]`.
Verbatim source: `DECISIONS.md` at origin/main `0521318324f9c22707c7b1ff3d0cc725392f6e55`.
Replacement: statusbar-title-layout task, delivered by its squash commit.
Origin commits are retained in the quoted entries where recorded.

> - **Activity chrome (UI port P6)** `[D-STATUSBAR-ACTIVITY]`. The editor's top border shows the activity status after
>   `── `: the running tool's action (`Running <command>`, `Editing <file>`, `Searching files`) or `Planning next moves`,
>   then running counts (`2 agents`) from the `rqw:running-counts:request`/`offer` channels, or
>   `Waiting for <counts>` when only background work runs, and `Compacting context` in gold during compaction; idle it is
>   the plain rule. Ordinary rules are silver, busy letters shimmer silver, compaction letters, chrome and context row shimmer
>   gold with the busy-letter mechanics (`[D-STATUSBAR-SHEEN]`). A static bold gold session title widget (`rqw-statusbar-title`) shows the session name above the
>   input. Off the original first branch the place row shows the English `⑂ fork #N` marker from the public session
>   tree, as defined in `[D-STATUSBAR-BRANCH-MARK]`. Footer effort colours: low plain, medium bold green, high bold
>   gold, xhigh bold bright purple, max bold red. Carrier: `extensions/RQW-statusbar/{activity,branch,render,editor,index}.ts`.
>   No owner quote for P6 is recorded here; the commit message lists the cross-extension native integration as not
>   verified. Since: `d84b541`.

> - **Compaction sheen** `[D-STATUSBAR-SHEEN]`. The compaction sheen uses exactly the mechanics of the working-status
>   sheen: `shimmerText` and `shimmerPhase` (global column, the 160 ms elapsed-time phase, the same width and gradient),
>   only with the gold stops `GOLD` instead of silver. The separate six-cell metallic run is removed. The lightning pulse and
>   everything else are unchanged. Owner: «Смотри, как у нас идёт анимация блика подсветки в статусе. Надо с такой же скоростью сделать, чтобы был блик в compaction, потому что сейчас в compaction блик выглядит по-ублюдски.» (session `2026-10-21T16-27-59-062Z_01a15f4a`, last user message)
>   Carrier: `extensions/RQW-statusbar/render.ts`. Proof: `test/{chrome,lifecycle}.test.ts`.

> - **Animation cadence** `[D-STATUSBAR-ANIMATION]`. The status animation (busy letters, compaction gold shimmer, the
>   lightning) redraws every 20 ms, 50 nominal frames per second, and follows elapsed monotonic time, not tick counts.
>   Letters and compaction shimmer take one phase frame per 160 ms of elapsed time; the lightning keeps one colour step per 120 ms. The phase is read at render time. The
>   static gold title, the input text and the effort colours do not animate. The timer runs only while an animated status
>   or the working lightning is shown. While our editor owns the top border, Pi's hidden working spinner gets no frames
>   (`ctx.ui.setWorkingIndicator({ frames: [] })`); off, shutdown, reinstall and a foreign editor restore Pi's default,
>   checked on every tick and activity change. Pi 1.4 batches paints at most every 16 ms. Cost: every paint re-renders Pi's
>   component tree; terminal, GPU, remote and visible frame rate are not measured.
>   Owner: «Не ускорить, а сделать более плавной, в два раза плавнее.» (session `2026-10-21T16-27-59-062Z_01a15f4a`, line 3636);
>   «Давай попробуем сделать 50 FPS для начала.» (session `2026-10-21T16-27-59-062Z_01a15f4a`, line 3662); «Даже можно скорость блика сделать медленнее, чтобы она шла более медленно, более плавно.» (session `2026-10-21T16-27-59-062Z_01a15f4a`, line 3662)
>   Carrier: `extensions/RQW-statusbar/{index,render}.ts`. Proof: `test/{lifecycle,chrome,fast-gpt}.test.ts`; numbers in
>   `notes/statusbar-omp.md`. Since: `e3b3566`.

> - **Session ID in the top border** `[D-STATUSBAR-TOP]`. With our editor installed the whole top border is ours:
>   `render.ts` `topBorder`, called from `editor.ts` `renderTopBorder`, draws the silver rule, the activity status
>   (`[D-STATUSBAR-ACTIVITY]`) at the left, Pi's `↑ N more` hint centred, and the full session ID at the right end as
>   ` <id> ──` in the muted label colour; Pi's native working indicator is not drawn there. The ID is Pi's
>   `sessionManager.getSessionId()`, read on every render, with one plain space on each side so a selection copies it
>   whole; when the status or hint would be cut it is dropped whole. With the bar off or a foreign editor Pi's own border
>   returns and there is no ID. `sessionTopBorder` in `render.ts` is used only by `test/render.test.ts`.
>   Owner: «Можно добавить его в верхнюю часть там, где working крутится, хуйня. С левой стороны сделать также вставку id сессий с пробелами: идёт чёрточка, потом id, потом снова чёрточка. Прямо по левому краю.» (session `2026-10-21T16-27-59-062Z_01a15f4a`, line 191);
>   «Я бы так сделал, чтобы это было симметрично по левому краю именно, и чтобы между чёрточками и ID был какой-то пробел, хотя бы по одному, чтобы можно было нормально вырезать и вставить, скопировать и вставить.» (session `2026-10-21T16-27-59-062Z_01a15f4a`, line 191)
>   Correction: «По визуальному он должен стоять справа. Я ошибся: не с левого края, а с правого края. Слева working, справа ID сессии. Он прижат должен быть к правому краю, а ID к левому краю прижат. Если места нету, то он и не отображается, его просто не видно.» (session `2026-10-21T16-27-59-062Z_01a15f4a`, line 203)
>   Carrier: `extensions/RQW-statusbar/{editor,render,index}.ts`. Contract: `notes/statusbar-omp.md`. Since: `c6b642c`.

Superseded passage, same source SHA:

> compaction status and synchronized chrome shimmer gold; fully idle is a continuous rule. Title stays static gold.

Superseded passage, same source SHA:

> native name as a static gold title, empty before a name exists, with its rule retained.

## A-0337 · archived 2026-10-25 · Per-task main delivery wording

Status: SUPERSEDED by [D-PIPELINE-RELEASE] in DECISIONS.md.
Source: `923ba22:DECISIONS.md`, replaced passage verbatim.
Archived by: release-pipeline-priority; exact commit: `git log -S'A-0337' -- DECISIONS-ARCHIVE.md`.

> - **Branches, squash and history** `[D-WORK-BRANCHES]`. Each task works on its own branch and worktree, commits stages
>   without an extra gate, finishes with one squash into `main` and cleans up; history belongs in Git.

## A-0338 · archived 2026-10-25 · Per-task main delivery wording

Status: SUPERSEDED by [D-PIPELINE-RELEASE] in DECISIONS.md.
Source: `923ba22:DECISIONS.md`, replaced passage verbatim.
Archived by: release-pipeline-priority; exact commit: `git log -S'A-0338' -- DECISIONS-ARCHIVE.md`.

>   The full local delivery `npm test` is the exception under [D-PIPELINE-LOCAL-GATE].

## A-0339 · archived 2026-10-25 · Per-task main delivery wording

Status: SUPERSEDED by [D-PIPELINE-RELEASE] in DECISIONS.md.
Source: `923ba22:DECISIONS.md`, replaced passage verbatim.
Archived by: release-pipeline-priority; exact commit: `git log -S'A-0339' -- DECISIONS-ARCHIVE.md`.

>   unchanged, except for the full local delivery run under [D-PIPELINE-LOCAL-GATE]; no Linux requirement;

## A-0340 · archived 2026-10-25 · Per-task main delivery wording

Status: SUPERSEDED by [D-PIPELINE-RELEASE] in DECISIONS.md.
Source: `923ba22:DECISIONS.md`, replaced passage verbatim.
Archived by: release-pipeline-priority; exact commit: `git log -S'A-0340' -- DECISIONS-ARCHIVE.md`.

>   small ones one combined review ([D-PIPELINE-COMBINED-REVIEW]). Installed Pi is updated only for relevant runtime changes.

## A-0341 · archived 2026-10-25 · Per-task main delivery wording

Status: SUPERSEDED by [D-PIPELINE-RELEASE] in DECISIONS.md.
Source: `923ba22:DECISIONS.md`, replaced passage verbatim.
Archived by: release-pipeline-priority; exact commit: `git log -S'A-0341' -- DECISIONS-ARCHIVE.md`.

>   Coordinator text, the approved proposal in short (the verbatim text is in `DECISIONS-ARCHIVE.md`, A-0246): 1. test exactly
>   what is merged, rebased onto a fresh `main`, with full local `npm test` on the final commit ([D-PIPELINE-LOCAL-GATE]); 2. a review covers only the commit it checked; 3. before every merge `deliver-check` checks the
>   branch contains current `main`, full local `npm test` on that exact commit, the review
>   numbers with CLEAN and the list of what was not verified live; 4. every report carries an evidence table and an honest
>   "not verified live" section.
>   Coordinator text, interpretation of rule 2: a conflict-free rebase onto `main` needs the full local delivery test on the new head
>   but no new review; places changed while resolving conflicts go back to review.

## A-0342 · archived 2026-10-25 · Per-task main delivery wording

Status: SUPERSEDED by [D-PIPELINE-RELEASE] in DECISIONS.md.
Source: `923ba22:DECISIONS.md`, replaced passage verbatim.
Archived by: release-pipeline-priority; exact commit: `git log -S'A-0342' -- DECISIONS-ARCHIVE.md`.

>   the current session queue. It rebases onto current `main`, merges only when required reviews are clean and
>   `deliver-check` passes, including full local `npm test` on the exact committed head ([D-PIPELINE-LOCAL-GATE]).

## A-0343 · archived 2026-10-25 · Per-task main delivery wording

Status: SUPERSEDED by [D-PIPELINE-RELEASE] in DECISIONS.md.
Source: `923ba22:DECISIONS.md`, replaced passage verbatim.
Archived by: release-pipeline-priority; exact commit: `git log -S'A-0343' -- DECISIONS-ARCHIVE.md`.

>   review; the full local delivery test still applies ([D-PIPELINE-LOCAL-GATE]); a change of meaning gets review; runtime prompts are checked by agent behavior.

## A-0344 · archived 2026-10-25 · Per-task main delivery wording

Status: SUPERSEDED by [D-PIPELINE-RELEASE] in DECISIONS.md.
Source: `923ba22:DECISIONS.md`, replaced passage verbatim.
Archived by: release-pipeline-priority; exact commit: `git log -S'A-0344' -- DECISIONS-ARCHIVE.md`.

> - **Local delivery test gate** `[D-PIPELINE-LOCAL-GATE]`. The only delivery test condition is full local `npm test`
>   passing on the exact committed branch head on the owner's macOS. `deliver-check` runs it in the existing clean
>   task worktree, checking cleanliness and the head before and after the run; no receipt or new mechanism.

## A-0345 · archived 2026-10-25 · PROCESS Isolated parallel execution

Status: SUPERSEDED delivery wording by [D-PIPELINE-RELEASE] in DECISIONS.md; other section rules remain in force.
Source: `923ba22:PROCESS.md`, removed fragments verbatim from the replaced section.
Archived by: release-pipeline-priority; exact commit: `git log -S'A-0345' -- DECISIONS-ARCHIVE.md`.

Replaced fragment 1:

> - Start each change task from up-to-date `main` in its own branch and git worktree:
>   `git worktree add -b <task> ../my-pi-worktrees/<task> main`. Make all task edits there, never in the main checkout.

## A-0346 · archived 2026-10-25 · PROCESS Task pipeline

Status: SUPERSEDED delivery wording by [D-PIPELINE-RELEASE] in DECISIONS.md; other section rules remain in force.
Source: `923ba22:PROCESS.md`, removed fragments verbatim from the replaced section.
Archived by: release-pipeline-priority; exact commit: `git log -S'A-0346' -- DECISIONS-ARCHIVE.md`.

Replaced fragment 1:

>   `main` and pushes it. It merges only when the required reviews are clean and `deliver-check` passes, including
>   full local `npm test` on the exact committed branch head on the owner's macOS. When `main` moves, remaining
>   branches rebase and pass the gate on their new heads. No green GitHub run is required, including for `pcli-vscode`.

Replaced fragment 2:

> - A failed local delivery test or a conflicting rebase sends the task back to the top of the queue. GitHub CI does

## A-0347 · archived 2026-10-25 · PROCESS Sufficient proof, without idle reruns

Status: SUPERSEDED delivery wording by [D-PIPELINE-RELEASE] in DECISIONS.md; other section rules remain in force.
Source: `923ba22:PROCESS.md`, removed fragments verbatim from the replaced section.
Archived by: release-pipeline-priority; exact commit: `git log -S'A-0347' -- DECISIONS-ARCHIVE.md`.

Replaced fragment 1:

>   tested code, configuration and document contracts remain unchanged, except for the mandatory local delivery run below.

Replaced fragment 2:

>   Air. The delivery exception is full local `npm test` on the exact committed branch head, run by `deliver-check`.

Replaced fragment 3:

> - Test exactly what gets merged. If `main` moved since the branch was created, the subagent rebases the branch onto
>   current `main`; `deliver-check` runs full local `npm test` on that final committed head, whose squash has the same
>   tree. This is the only delivery test condition; no GitHub run needs to be triggered or awaited for a merge.

Replaced fragment 4:

>   the full local delivery run still applies. A workflow change does require validating its triggers and affected

## A-0348 · archived 2026-10-25 · PROCESS Independent review

Status: SUPERSEDED delivery wording by [D-PIPELINE-RELEASE] in DECISIONS.md; other section rules remain in force.
Source: `923ba22:PROCESS.md`, removed fragments verbatim from the replaced section.
Archived by: release-pipeline-priority; exact commit: `git log -S'A-0348' -- DECISIONS-ARCHIVE.md`.

Replaced fragment 1:

>   result review, and code review when the path-based requirement above applies. A conflict-free rebase onto `main`
>   changes no task places: it needs the full local delivery test on the new head, not new review; places changed

## A-0349 · archived 2026-10-25 · PROCESS Third-party installation fast path

Status: SUPERSEDED delivery wording by [D-PIPELINE-RELEASE] in DECISIONS.md; other section rules remain in force.
Source: `923ba22:PROCESS.md`, removed fragments verbatim from the replaced section.
Archived by: release-pipeline-priority; exact commit: `git log -S'A-0349' -- DECISIONS-ARCHIVE.md`.

Replaced fragment 1:

> Self-review the config and exact diff for unintended additions, commit and push to `main`. This narrow path

## A-0350 · archived 2026-10-25 · PROCESS Delivery

Status: SUPERSEDED delivery wording by [D-PIPELINE-RELEASE] in DECISIONS.md; other section rules remain in force.
Source: `923ba22:PROCESS.md`, removed fragments verbatim from the replaced section.
Archived by: release-pipeline-priority; exact commit: `git log -S'A-0350' -- DECISIONS-ARCHIVE.md`.

Replaced fragment 1:

> 2. Push the task branch; continue independent work during required reviews. Before merging, require sufficient
>    proof and the required clean reviews for the final head commit on current `main`. The only delivery test
>    condition is full local `npm test` on that exact committed head on the owner's macOS, run by `deliver-check`.

Replaced fragment 2:

>    and runs, from the clean main checkout,
>    `npm run deliver-check -- <branch> <message-file>` (`scripts/deliver-check.mjs`; it fails in any checkout
>    without `main` checked out). It requires: the branch
>    contains current `origin/main` and the main checkout's HEAD, the merge destination. It runs full `npm test`
>    in the branch's existing clean task worktree on the owner's macOS, at the exact committed branch head, and
>    checks worktree cleanliness and the head before and after the run. No receipt or extra worktree is needed.

Replaced fragment 3:

> 4. Squash merge into `main`: one task, one commit, with that message. Never merge the task's stage commits into main
>    as a merge commit. Push main autonomously; the squash tree equals the tested head, so it is not retested.

Replaced fragment 4:

>    `include: ["user_messages"]`. Object: `main`'s git log since the session

Replaced fragment 5:

> 6. Update the locally installed Pi when a runtime/package change requires it, preserving auth and other settings;
>    restart when process-wide patches require it. Documentation-only work needs no package update or restart.

Replaced fragment 6:

>    its branch on `origin`. Do not remove other tasks' worktrees or branches.

## A-0351 · archived 2026-10-25 · Third-party delivery destination

Status: SUPERSEDED destination wording by [D-PIPELINE-RELEASE] in DECISIONS.md; the narrow fast path is unchanged.
Source: `923ba22:DECISIONS.md`, replaced passage verbatim.
Archived by: release-pipeline-priority; exact commit: `git log -S'A-0351' -- DECISIONS-ARCHIVE.md`.

>   changes. Light self-review for unintended additions, commit and push main replace the full delivery pipeline,


### Retired caller-argument wording

Source: `60da29c:DECISIONS.md`, D-SCOPE-WEB-SEARCH-MODEL. Replaced by automatic shipped-tool mapping, D-WEB-REMOVE-CLI. Verbatim retired text:

  CLI callers may pass model/thinking arguments; the later tool applies the mapping automatically from its calling
  agent's model/thinking, without model arguments for the agent.


## A-0352 · archived 2026-10-25 · Short owner replies

Status: SUPERSEDED by D-WORK-SHORT-REPLIES and its runtime carrier.
Source: `7fb2a65`, DECISIONS.md and extensions/RQW-prompt/SYSTEM.md.
Archived by: owner-chat-style; exact commit: `git log -S'A-0352' -- DECISIONS-ARCHIVE.md`.

Verbatim superseded decision:

- **Short replies** `[D-WORK-SHORT-REPLIES]`. Owner (`13-49-40:204`, the line quoted in [D-WORK-BRANCHES], then):
  «Если это не требует расширения, конечно»
  Reason: the owner reads short Russian answers. Carrier:
  [PROCESS.md, Communication and continuity](PROCESS.md#communication-and-continuity). Since: `8f2ea64`.

Verbatim replaced runtime prompt paragraphs:

- Open with one bold sentence that carries the main point: the answer, the result or the blocking problem. The first sentence alone gives the user what he needs.

- By default one paragraph of one to four sentences, never more than twelve sentences; a plan requested for approval, a goal to accept, a requested set of options or the implementations `<general>` asks for keep every item, each short, and the detailed form below has its own limit. For separate parts, two or three short paragraphs of one to three sentences, separated by an empty line, `---` and an empty line.

- No headings. No bold beyond the first sentence, except the bold labels of the detailed form and the question format. A list or small table only for genuinely parallel items or ordered steps; lists flat, each item a complete point, numbered `1. 2. 3.`. Generated artifacts such as PR descriptions, release notes or user-requested docs keep their native format.

- When the user explicitly asks for an explanation or detail: the bold main point first, then two to five small blocks separated like paragraphs, each one idea in one to five short sentences opening with a bold label of one to four words; a question, when needed, ends the last block.

- Questions go into the chat; end the turn after them. Ask only what files and the request cannot settle; each question names the actual decision or missing fact and its consequence and is answerable from the chat alone, since a filename, link or quotation does not explain it. One focused question may simply end a short message. Several open questions go in one message, in this format: a bold line «**Вопросы · N**»; per question a bold line «**1 · Короткий заголовок**» with a title of two to four words, one line of context, options as list items **a)**, **b)**, ... each with its consequence in a few words, the recommended one marked «— *рекомендую*», or one line when there are no real options; a closing line «> Ответь одной строкой, например `1a 2b`, или своими словами. На что не ответишь, возьму рекомендованное.» When an invoked procedure asks to accept a whole goal or plan, its go line comes last, after the closing line. Match his free-text answer by meaning, treat a reply that fits no option as his own requirement, give an unanswered question the recommended option; his answer starts the work.

## A-0353 · archived 2026-10-25 · Release task document-check exception

Status: SUPERSEDED by [D-PIPELINE-DOC-GATE] in DECISIONS.md; release batching and other rules remain unchanged.
Source: `83a91db:PROCESS.md` on `origin/release`, replaced passages verbatim.
Archived by: process-speed-delivery second delivery; exact commit: `git log -S'A-0353' -- DECISIONS-ARCHIVE.md`.

Replaced fragment 1:

> proof, only the task's scoped tests, and the required clean reviews for the final head commit on current

Replaced fragment 2:

>    contains current `origin/release` and the release checkout's HEAD, the merge destination. Changed paths
>    mechanically select affected extension tests, isolation, changed tests and root tests loading changed files.
>    It runs those tests on that exact committed branch head in its existing clean task worktree on the owner's
>    macOS, and verifies worktree cleanliness and the head before and after the run. No new receipt or test trailer
>    is required. No full suite runs per task.

## A-0354 · archived 2026-10-25 · Release process mandatory reading contract

Status: SUPERSEDED by [D-WORK-PROCESS-SPLIT] in DECISIONS.md; release batching and other rules remain unchanged.
Source: `83a91db:PROCESS.md` on `origin/release`, replaced passages verbatim.
Archived by: process-speed-delivery second delivery; exact commit: `git log -S'A-0354' -- DECISIONS-ARCHIVE.md`.

Replaced fragment 1:

> This is the working procedure for agents developing my-pi. Read it before every task and restore it after
> compaction or a context handoff. `WORKFLOW-MANIFEST.md` is the owner's personal record of his working principles
> and aspirations, not a procedural gate. This file carries the agreed execution rules; `DECISIONS.md` carries
> the accepted decisions and their reasons. New owner instructions take precedence over older agreements.

## A-0355 · archived 2026-10-25 · Release AGENTS mandatory reading contract

Status: SUPERSEDED by [D-WORK-PROCESS-SPLIT] in DECISIONS.md; release batching and other rules remain unchanged.
Source: `83a91db:AGENTS.md` on `origin/release`, replaced passages verbatim.
Archived by: process-speed-delivery second delivery; exact commit: `git log -S'A-0355' -- DECISIONS-ARCHIVE.md`.

Replaced fragment 1:

> Before every task, read and follow [PROCESS.md](PROCESS.md). Restore it after compaction or a handoff before
> continuing. This is mandatory lazy loading, not optional background reading. Give subagents the relevant process
> rules in their briefs. The owner's personal manifesto is a separate memory document, not the execution procedure.

## Statusbar 30 FPS and single silver glint · archived 2026-10-25

Status: the 50 FPS cadence and repeated silver motion are SUPERSEDED by
`[D-STATUSBAR-ANIMATION]` in the statusbar-single-glint delivery; other rules in the entry remain current.
Verbatim prior entry from `DECISIONS.md` at origin/release `83a91dbcaf37bad6886e5709457ff6159f337fcd`.
Origin: `081d914` for the 50 FPS title-layout entry, with later native-row correction retained below.
Replacement commit: `git log -S'Statusbar 30 FPS and single silver glint' -- DECISIONS-ARCHIVE.md`.

> - **Animation cadence** `[D-STATUSBAR-ANIMATION]`. Keep the 20 ms redraw timer, 50 nominal frames per second,
>   and monotonic elapsed-time animation. Double silver and gold travel speed relative to origin/main
>   `0521318324f9c22707c7b1ff3d0cc725392f6e55`; the lightning keeps its 120 ms colour step.
>   The title animates during compaction, not otherwise. Input text and effort colours do not animate.
>   `STATUS_FRAME_MS = 80`, previously 160; `SHIMMER_MS = 20`, `FAST_STEP_MS = 120`.
>   `ContextEditor` uses `embedWorkingStatus: true` and `setWorkingIndicator({ frames: [] })` while our editor
>   is installed, restoring the pre-`081d914` suppression of Pi's native working row. Off, shutdown and another
>   editor restore the default indicator. The layout is tool block, one blank, shimmer status, one blank, title border.
>   Owner correction: «1а», supplied by Main in this task on 2026-10-25: hide the stock row as before the change.
>   `activityRows` supplies status and trailing blank; Pi supplies the leading spacer. Idle returns `[]`.
>   Owner: «Давай попробуем сделать 50 FPS для начала.»
>   Source: session `2026-10-21T16-27-59-062Z_01a15f4a`, line 3662; doubled-speed source: `[D-STATUSBAR-SHEEN]`.
>   Carrier: `extensions/RQW-statusbar/{index,render}.ts`; historical cost measurements: `notes/statusbar-omp.md`.

## Statusbar 30 FPS · superseded note cadence paragraphs

Status: 20 ms redraw cadence and repeated silver motion SUPERSEDED by `[D-STATUSBAR-ANIMATION]`
and the current title/activity contract in `notes/statusbar-omp.md`; unchanged details remain current.
Verbatim source: `notes/statusbar-omp.md` at base `83a91dbcaf37bad6886e5709457ff6159f337fcd`.
Replacement: statusbar-single-glint delivery, initial task commit `09ac9b30c7c144e362972123693bd36a3e379c24`;
final squash provenance: `git log -S'superseded note cadence paragraphs' -- DECISIONS-ARCHIVE.md`.

> Both silver and gold highlights travel exactly twice as fast as before this change, with no slant. Silver has
> three very bright peak cells; gold has six to seven. The falloff to the base colour is wide, soft and monotone
> between letters, with gold the smoothest. The redraw timer remains 20 ms; GPT Fast is unchanged.
> Only public Pi APIs are used, and the extension remains independent.

> `STATUS_FRAME_MS = 80` replaces 160; `SHIMMER_MS = 20` and `FAST_STEP_MS = 120` are unchanged.
> In `render.ts`, `SHIMMER_PERIOD_CELLS = 2 * Math.PI / 0.32` and `SHIMMER_CELLS_PER_FRAME = 0.22 / 0.32`.
> Silver uses a three-cell plateau, 4.5-cell cubic falloff and `#ffffff` peak; gold uses a 6.5-cell plateau,
> six-cell quintic falloff and `#fff4c2` peak. These are spatial profiles, not a higher redraw frequency.

## Explicit held-wait option · archived 2026-10-25

Status: explicit `blocking` option SUPERSEDED by `[D-TOOLS-NO-BLOCKING-FLAG]` in DECISIONS.md.
Source: `664e4d0f49239b2cc619bcabb82aa772430860c7:DECISIONS.md`, coordinator-default passages below, verbatim.
The codemode, external-host and no-notify paths remain unchanged by the owner's narrowed order.
Replacement commit: `git log -S'D-TOOLS-NO-BLOCKING-FLAG' -- DECISIONS.md`.

From `[D-TOOLS-NOTIFY]`:

>   `status`, `wait` or `kill` is not announced again. `blocking: true` keeps the old held wait. Calls inside a codemode
>   script stay blocking. The print/json fallback is for external hosts only: a root session run by Pi in print or json mode ends
>   with its run, so its waits block; an in-process child agent with the `notify`/`retain` bridge keeps notifications even when its SDK mode reads print.
>   Any caller without a `notify` callback keeps the blocking wait. Reviewer profiles use the ordinary child bridge. The `notify` callback

From `[D-AGENT-NOTIFY]`:

>   `terminate: true` and the result later wakes the caller once through the existing delivery broker; `blocking: true`
>   keeps the held wait, and a wait inside a codemode script stays blocking, as does an external root print/json host and any caller without a `notify` callback (an in-process child agent with the bridge
>   is not affected by its SDK mode). A timeout or alert

From `[D-AGENT-API]`:

> - **API and in-process runtime** `[D-AGENT-API]`. One `agent` tool offers `start`, `wait`, `status`, `send`, `resume`, `interrupt`, `stop`, `restart`; fields are `id`, `ids`, `timeout_ms`, `blocking`, `messages`, `until`, `wake_on_alert`, `depth`, `alert_after_ms`, `system`, `role`, `system_file`, `role_file`, `include`, `title`, `agent_type`, `task`, `model`, `thinking`, `tools`, `fast_gpt`, `interrupt`. Optional null fields mean omitted; start/send require task, not system. Defaults are the caller's model and thinking and all six base tools, plus recursive `agent` delegation for every child. Profile selection and defaults are defined in `[D-AGENT-PROFILES]`. Sessions run in-process at caller cwd with in-memory settings; the history is in memory for an in-memory caller and in the owned `<parent.jsonl>.children/` tree for a persisted one (`[D-AGENT-PERSIST]`), using `createAgentSession` and the caller's `ctx.modelRegistry.runtime` for credentials, OAuth and extension providers. Resources, context files, skills and external extensions are not independently loaded; the inherited prompt carries main's text. An inline forced `before_agent_start` prompt prevents Pi from appending cwd or other sections again.
>   Carrier: `extensions/RQW-agent/index.ts`, `extensions/RQW-agent/test/agent.test.ts`. Since: `7a9f505`; inherited defaults since `c86e9bb`; `resume` since `dd93a40`; `blocking` since the final squash of branch `agent-async`. Earlier wording: [DECISIONS-ARCHIVE.md](DECISIONS-ARCHIVE.md), A-0265.

## Provisional code quality · archived 2026-10-25

Status: SUPERSEDED by standing `[D-WORK-CODE-QUALITY]` and `[D-WORK-REPO-INDEX]` in DECISIONS.md.
Source: `61b81a3:DECISIONS.md`, provisional D-WORK-CODE-QUALITY entry, verbatim below.
Introduced: process-rules-oct23 squash, as recorded in the source entry.
Replacement: repo-code-index second delivery; commit provenance:
`git log -S'Provisional code quality · archived' -- DECISIONS-ARCHIVE.md`.

> - **Maintainable minimal code, provisional** `[D-WORK-CODE-QUALITY]`. Until the AI-maintainability research lands,
>   every change and review checks clean, short, readable,
>   easy-to-extend source, minimal code without garbage, and clear decomposition rather than clever one-liners or
>   dense expressions. This does not authorize unrelated refactoring. Owner (`16-27-59:4872`, entry `249fcb3b`):
>   «Я хочу, чтобы исходный код наших extension был максимально чистый, приятный, короткий, легко читаемый, легко дорабатываемый.»
>   «Качество значит лёгкость поддерживания. Даже джун тупой поймёт, что делает код, просто читая его по структуре. Он должен быть максимально красивым, коротким, чистым, минималистичным. Это значит никаких сложных one-line, comprehend выражений и прочей хуйни, а именно хороший декомпозированный код, который поймёт любой.»
>   Reason: quality is ease of maintenance, including maintenance by AI agents. Carriers:
>   [PROCESS.md, Code quality](PROCESS.md#code-quality), personal wording in `WORKFLOW-MANIFEST.md`.
>   Owner clarification (`16-27-59:4880`, entry `c47e60b3`):
>   «Workflow manifest — это принцип того, как я работаю. Надо дать пояснение, что так как это AI-репозиторий, то этот принцип надо адаптировать под AI-агентов.»
>   «Когда мы всё это исследуем, принцип надо будет переделать, потому что мы не знаем, как для AI-агентов более эффективно. Может, AI-агентам более эффективно работать с ванлайнерами.»
>   Research must adapt the personal principle to AI agents rather than assume decomposition is already proven best.
>   Research, architecture reorganisation and a mechanically checkable repository index are queued in `BACKLOG.md`;
>   detailed design still needs agreement before implementation. Since: process-rules-oct23 squash.
