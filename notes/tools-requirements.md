# RQW-tools: requirements (compiled by the coordinator from the omp chat, 2026-10-20)

Every item is the coordinator's record of the owner's requests at that time. This file was the agreement for the tools
work; reviewers checked against it.

Status: frozen evidence, the agreement of the first RQW-tools task (2026-10-20). Later decisions override parts of
it; the current rules are in [DECISIONS.md, Tools](../DECISIONS.md#tools), and current development worker models are
in `PROCESS.md`, not item 11. Convention: text marked `[coordinator record: "..."]` reproduces wording from the omp
session of that day as the coordinator recorded it. It is coordinator text, not an owner quotation: it was not
verified against the my-pi Pi session files.

## Goal
1. A new extension `extensions/RQW-tools/` replaces the stock Pi tools `read`, `bash`, `edit`, `write` and turns on
   the stock `grep` and `find`. Same tools, improved mechanics and descriptions ([coordinator record: "Сами инструменты останутся те же, но
   мы просто подтюним описание так, чтобы агент ещё эффективнее пользовался"]).
2. Every extension of the package has the prefix `RQW-` ([coordinator record: "у всех наших extension был префикс типа RQW- и название"]).
3. Tool names and parameter names stay exactly as in Pi: `read`, `bash`, `edit`, `write`, `grep`, `find`, `path`,
   `offset`, `limit`, `edits[].oldText`, `newText`, `pattern`, `glob`, `ignoreCase`, `literal`, `context`, `timeout`,
   `content` ([coordinator record: "имена такие же, как в P... никакой хуйни не надо навяливать из ОМП лайта"]; [coordinator record: "переименовывать ничего
   не надо"]). No `apply_patch`, one edit format for all models ([coordinator record: "Нет, не надо для GPT patch делать. Пусть работает
   одинаково везде"]).
4. Search rules move from the system prompt into the tool descriptions, as in omp-lite; the prompt keeps a minimal
   mention ([coordinator record: "переносит всё, что касается именно поиска... в описание tools, чтобы в промпте было минимально об этом
   сказано"]).

## Mechanics
5. Many files per call: [coordinator record: "агент правил дохуя файлов за вызов, дохуя чтений делал за вызов"]. `edit` and `write` accept
   several files in one call; reads of many files run in one response in parallel. Any new parameter keeps Pi's
   naming (e.g. a `path` on each `edits[]` entry, a `files` list of `{path, content}`), never omp-lite names.
6. Everything independent runs in parallel, as in omp-lite ([coordinator record: "чтобы эти лиды, edit и write шли параллельно"]).
7. No race of any kind in the base tool set: in particular `bash` must not read files before an earlier `write` or
   `edit` of the same response finished ([coordinator record: "bash запускается параллельно с write и читает старые файлы до их
   редактирования"]). All race conditions and barriers are designed, measured and proven by the coordinator
   ([coordinator record: "проверить вообще на все возможные виды гонок именно базовый tooling... Сам замерь, протестируй"]).
8. Output limits chosen by the coordinator, character-based, by measurement ([coordinator record: "Лимиты надо подобрать"]).
9. Works on macOS and on Windows: PowerShell, then Git Bash, Pi runs inside Git Bash; no WSL, no admin rights.
   Proof without the owner's hands: GitHub Actions Windows runner and documentation ([coordinator record: "доверился тебе, чтобы ты на базе
   всей документации... теоретически сделал всё пиздато на Windows"]).

## Method
10. Workflow manifest (`my-omp-harness` `436aa2e:WORKFLOW-MANIFEST.md`): simplest working solution, no over-engineering,
    nothing beyond the agreement; speed first. Exception: everything is proven ([coordinator record: "всё должно быть доказано"]).
11. Swarm of subagents, coordinated by Main: drafts, then refinement with mechanical probes, then review, then a
    separate probe set per tool, and a corner-case hunt. Probes are mechanical and synthetic: no model runs ([coordinator record: "Не
    запускать агента самого, а просто синтетически проверить"]). Discovery check of what Pi actually hands the model.
    Models: Opus medium or high, Sonnet high or xhigh, chosen by Main.
12. At the end, a bench against bench41 (three models, 3 runs). Autonomous; the owner gets only the final result.
