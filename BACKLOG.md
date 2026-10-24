# Open and deferred work

This is the canonical task list. Keep source, status and branch with every item. Remove completed and dead tasks;
Git and `DECISIONS-ARCHIVE.md` preserve their history. Accepted limits and unverified live behavior stay in
`DECISIONS.md` or their research note unless there is actual remaining work.

Sources: docs-cleanup `AUDIT.md` section 5 and `parts/backlog.md`, outside the repository under
`/Users/arkadijcukavin/ai-project/my-pi-evidence/docs-cleanup/`. IDs below remain stable. `handoff` and `completeness`
mean the source documents identified by that audit. Branch status is the audited snapshot at `30952e6`, not a
claim that remote state has since been revalidated. Explicit later integration status takes precedence over that
snapshot. Descriptions are coordinator summaries unless explicitly marked as verbatim owner quotations.
Deferred rows explicitly identify coordinator records of deferral where no authenticated verbatim owner message
is supplied.

## Open

| ID | Work | Status/branch | Source |
| --- | --- | --- | --- |
| <a id="u05"></a>U05 | Finish and integrate agent/worker cards, delivered-message and wait-result wiring, and title headers. Review cards are U06. | OPEN, off main: `p5-agent-ui`, audited head `7f7d71f`; rebase and final proof required. No `RQW-agent-ui` on main. | Backlog U05/A05; handoff 98; completeness 55/199; UI execution brief P5 T13/T17. |
| <a id="u06"></a>U06 | Build the review card against the delivered reply format: `CLEAN` with `CHECKED:`, `FINDINGS:` and `UNCHECKED:` sections. | OPEN, blocked by delivery of `reviewer-codex-port`; no T14 branch assigned. Coordinate with `p5-agent-ui`. | Backlog U06; handoff 98; UI execution brief P5 T14; `D-REVIEW-VERDICT`. |
| <a id="u12"></a>U12 | UI integration P10 T12/T20/T22/T30: register naming, thinking, tool-ui and agent-ui in `pi.extensions`, agent-ui before tool-ui; theme in `pi.themes`; update root user docs. | OPEN, no branch assigned. Four existing UI source folders remain unregistered; agent-ui awaits U05/U06. | Backlog U12; handoff 100; UI execution brief P10; current registration carrier `package.json`. |
| <a id="u13"></a>U13 | Real-Pi scripted faux-provider end-to-end tests for tool-ui, thinking hiding, activity indicator and cards; composition, load order and remaining physical-terminal appearance checks from U18. | OPEN, waits for U12 and cards; no P11 branch assigned. Isolated tests do not prove composition. | Backlog U13/U18; handoff 30/49-50/100; completeness 55; UI execution brief P11 T19. |
| <a id="agent-session-persist"></a>AGENT-SESSION-PERSIST | RQW-agent: persist subagent sessions on disk, linked to the parent session, so an agent resumes by its id after a Pi restart with its full history. `/remove` removes the child sessions together with their parent, as in the earlier `/remove` decision ([D-SESSION-COMMANDS](DECISIONS.md#session-commands)). Until it lands, only a short checkpoint right before a planned Pi restart is allowed ([PROCESS.md](PROCESS.md#task-pipeline)). Extension: after the whole Pi process ends (Ctrl+D or a closed terminal tab), `pi -r` and a continue message resume the main chat, and the main agent mechanically resumes all earlier subagents from their saved sessions, as in Cursor. A separate option resumes only the subagents without the main chat; when they finish, the main chat gets a notification and continues by itself. Main never hangs or polls while it waits: it stays idle until the notification. Coordinator design text, not an owner quote: a `resume` action resumes a paused or interrupted agent by retrying the cut-off model request without a new message, also from a saved session after a Pi restart; an interrupted tool call that may have side effects is never replayed blindly, the model sees it as interrupted and decides. The shipped `interrupt` then `send` stays until `resume` is delivered. Linked: [NONBLOCKING-WAITS](#nonblocking-waits) and [ASYNC-TOOL-CALLING](#async-tool-calling), which own the notification wake-up and the non-blocking waits; design may merge them. | QUEUED, no branch, entry only; nothing implemented. Blocked by: none. The coordinator proposed placing it right after WEB-SEARCH (`16-27-59:5090`); the owner has not set the order. | Owner `16-27-59:5087`, entry `ddd0ce47` ([D-PIPELINE-PAUSE-RESUME](DECISIONS.md#task-pipeline)); coordinator text `16-27-59:5090`. Owner `16-27-59:5092`, entry `3c2122c8`, and `16-27-59:5103`, entry `8bb70dcd` (quotes in the decision entry). |
| <a id="agent-states-ui"></a>AGENT-STATES-UI | New UI agent list and cards show three distinct states: working; waiting (CI, review, owner or children); idle or AFK. An idle agent must never look active and never carries a waiting label. | OPEN, part of the new UI with U05 and U12; no branch; entry only, nothing implemented. | Owner `16-27-59:5085`, entry `04f64a5e`: «Если у нас какие-то агенты в афк стоят, то они не должны отображаться, как будто они рабочие и их ожидание происходит.» and `16-27-59:5087`: «И да, интерфейс должен разключать, когда агент стоит, когда он AFK, когда он работает.» |
| <a id="codex-reviewer-comparison"></a>CODEX-REVIEWER-COMPARISON | Whole-cycle comparison of the original Codex CLI reviewer plugin on Sol low with the Pi port: five identical tasks, one run each, from the start to CLEAN including repairs, with the same sources, model and criterion. | QUEUED, starts only after `reviewer-codex-port` is delivered; the plan is not prepared yet; no branch. | Owner `16-27-59:5225`, `16-27-59:5289`; quotes below. |
| <a id="extension-audits"></a>EXTENSION-AUDITS | Full independent re-check of each implemented extension, one queued task each; criteria and simplest-first task list below. | QUEUED after small near-ready merges and rebuild/knowledge base, before remaining flaky-test work; all audits and their fixes blocked until rebuild/knowledge base are delivered; auditor never fixes. | Owner `16-27-59:4864/4868/4872/4892`, entries `c7934716`, `6e47c19b`, `249fcb3b`, `40d49370`. |
| <a id="grep-null"></a>GREP-NULL | Normalize optional grep fields so the main tool does not pass literal string `null` as a glob. | OPEN, no branch assigned; reviewer already has `dropEmptyOptional`, main path does not. | AUDIT section 5, Review limits; `extensions/RQW-review/index.ts`, `extensions/RQW-tools/index.ts`. |
| <a id="publish-skill"></a>PUBLISH-SKILL | Reconcile separate commit/push permission with PROCESS; require successful publication CI on the exact packaged commit, not merely the latest green branch run, and dispatch the intended ref when needed. | OPEN, no branch assigned; skill edits outside this cleanup. Marketplace publishing still needs a direct owner request. | AUDIT item 15 and docs-consistency findings; `.agents/skills/publish-pcli/SKILL.md`. |
| <a id="web-search"></a>WEB-SEARCH | Codex-subscription web search, CLI-first: agents call it from Bash/shell like grep/find; later wrap it as a separate tool as our grep/find wrap Pi's rg/fd. CLI must support unattended background research while the owner sleeps. | QUEUED after this process-rules task; implementation/design still follows research and agreement; no branch assigned here. | Owner `16-27-59:4782/4880/4888`, entries `f73155f0`, `c47e60b3`, `0aa23856`; CLI quote below. |
| <a id="token-efficiency-review"></a>TOKEN-EFFICIENCY-REVIEW | Follow-up review of the read cache. At the merge date plus 3 days, inspect the sessions since the merge: tokens saved, failed edits, retries. Then tune the cutoff or remove the mechanism. The coordinator reminds the owner in the first conversation after that date; it does not wake itself. | QUEUED. The read cache merged into `main` from branch `unchanged-read`, built ahead of WEB-SEARCH on the owner's explicit request; the review is due at its merge date plus 3 days, planned `2026-10-27` for a merge on `2026-10-24`. The merge agent corrects the date here if the merge lands on another day. | Owner `16-27-59:5135`, entry `171f4d82`: «Мы просто это запилим, я буду с этим работать, а потом через какое-то время ты мне напомнишь, поставишь задачу» and «через три дня после merge надо будет сделать review всех старых сессий на предмет того, помогло нам это или нет. И всё. Не будем никаких делать испытаний и прочей хуйни.» Sessions since the merge, tune or remove, and the reminder rule are coordinator text (`16-27-59:5138`). |
| <a id="timebox-practices"></a>TIMEBOX-PRACTICES | Research, a record only, not started: how practising professional engineers avoid sunk cost, experiment loops, runaway cost and over-testing. Credible primary sources, found with our WEB-SEARCH CLI once it is available. Output: a short evidence-based proposal of timeboxing, stop criteria, uncertainty spikes, cost versus information, escalation and minimal acceptance checks, adapted to this repository. Not an open-ended benchmark. Linked: [D-PIPELINE-TIMEBOX](DECISIONS.md#task-pipeline). | QUEUED, no branch; do not start. Blocked by: WEB-SEARCH delivery. The owner has not set its place in the queue. | Owner `16-27-59:5231`, entry `ce0d83d8`: «Надо понять, как их избегать, как не попадать в такие ловушки. Надо поресёрчить, как люди с этим справляются уже — реальные программисты, реальные профессионалы. Это просто как web search работать» |
| <a id="nonblocking-waits"></a>NONBLOCKING-WAITS | Background child/job/long-call waits wake the agent by notification; owner steering remains available without aborting those waits or children/jobs. | QUEUED, next after the delivered TOKEN-EFFICIENCY read cache; no branch; open design: interruptible calls and how queued user input ends a wait early while children/jobs continue. | Owner `16-27-59:4876`, entry `85357ce9`; queue placement is coordinator recommendation without owner objection, not a separate owner quotation. |
| <a id="async-tool-calling"></a>ASYNC-TOOL-CALLING | Asynchronous tool calling as in Codex CLI: agents call tools, keep working, receive owner messages and are not cut off. | QUEUED, next after the delivered TOKEN-EFFICIENCY read cache, with NONBLOCKING-WAITS; linked theme, design may merge them; no branch. | Owner `16-27-59:4937`, entry `a8684155`; exact request below. |
| <a id="codex-changelog"></a>CODEX-CHANGELOG | Review the last six months of Codex CLI changelog/source for strong implementations portable to Pi; return a ranked list with sources to the owner. | QUEUED after NONBLOCKING-WAITS / ASYNC-TOOL-CALLING; not blocked by WEB-SEARCH, use GitHub via git; no branch. | Owner `16-27-59:4937`, entry `a8684155`; exact request below. |
| <a id="qa-flakes-last"></a>QA-FLAKES-LAST | Causal fix of the flaky background-test failures, QA #3 with duplicates #4 and #5, without retries, raised timeouts or weakened assertions. Interim narrow Windows assertion skips are the owner-approved stop-gap ([PROCESS.md](PROCESS.md#quality-control-loop)). | QUEUED last, worked by the test lane whenever items exist ([D-PIPELINE-TEST-LANE](DECISIONS.md#task-pipeline)), existing branch `bg-port-flake`; remaining proof belongs to that task, not this documentation change. It no longer blocks new UI or small merges. | Owner `16-27-59:5060`, entry `46a9e546`, answer to item 4 ([D-PIPELINE-FLAKE-SKIP](DECISIONS.md#task-pipeline)); QA issues #3, #4, #5. Replaces the earlier promotion at `16-27-59:4900`. |
| <a id="agent-structure-research"></a>AGENT-STRUCTURE-RESEARCH | Research TypeScript code and folder organisation for AI maintenance, plus code search/navigation: AST structural search, grep, LSP, BM25, E5 embeddings and hybrid retrieval. Test the owner hypothesis that senior well-decomposed code plus fast search works best; propose uniform extension structure and adapt the provisional code-quality principle from evidence. | QUEUED after WEB-SEARCH; blocked until its CLI is delivered into main; research must use that web search; no branch. | Owner `16-27-59:4872/4880/4884`, entries `249fcb3b`, `c47e60b3`, `17c100e6`; quotes below. |
| <a id="extension-structure"></a>EXTENSION-STRUCTURE | Rebuild with one identical structure framework per extension; move tests into a separate folder mirroring the extension tree, with no tests in extensions; fix the structure as a repo rule. | QUEUED after research, new UI and small near-ready merges; blocked by all three; no branch. Detailed design still requires agreement. | Owner `16-27-59:4872/4892/4900`, entries `249fcb3b`, `40d49370`, `d4622d56`; questions and quotes below. |
| <a id="repo-knowledge-index"></a>REPO-KNOWLEDGE-INDEX | Skeletal Markdown repository index/folder groups so agents locate code without grep/find; agents maintain it on every change with mechanical consistency checks. | QUEUED with rebuild after research, new UI and small merges; blocked by all three; no branch. Detailed design still requires agreement. | Owner `16-27-59:4872/4892/4900`, entries `249fcb3b`, `40d49370`, `d4622d56`; quotes below. |

| <a id="project-explorer"></a>PROJECT-EXPLORER | Rework `explore` into an appropriately renamed project or file explorer, limited to this project's codebase on this computer. Coordinator summary, not owner words: the explorer does not write its report in the answer. Through a tool call it creates one combined file in the operating system's temporary directory from a template: an analytic report of about 50000 tokens (the owner's target within the 128k output limit, not a measured guarantee) with placeholders, and the tool fills the placeholders with the actual code excerpts of the referenced ranges, reading them in parallel. The code excerpts come on top of the 50000 tokens, not inside them, and the model never reprints code. The explorer returns only the file path to main, and main reads the file in chunks. The report is very detailed, dense and self-contained, so that main can continue alone: the files and their contents, who owns what, the structure and the important code. Coordinator text, not an owner quote: the file starts with a table of contents giving the line range of every section, so main reads only the sections it needs and not the whole file. Afterwards a small measurement: Sonnet 5.5 medium against Haiku 5.5 high, the same research, 3 attempts each. Today's explorer: [D-AGENT-EXPLORE-TOOLS](DECISIONS.md#agent). | QUEUED at the very end of the queue, low priority, after every other entry including TIMEBOX-PRACTICES and QA-FLAKES-LAST and before WINDOWS-TEST-FAILURES; a record only, no branch, nothing started, no model launched. The measurement waits for the Anthropic limits refresh; nothing else needs the owner. The current development model table gets no exception now. | Owner `16-27-59:5303`, entry `08ec21d0`: «Надо его переименовать во projects explorer, чтобы он был explorer только в рамках кодовой базы этого проекта и этого компьютера.» «Хорошо, не все, а хотя бы чтобы он старался на 50 тыс. Уложиться, но при этом не перепечатывать код» «Не Opus, давай Sonnet Medium против Haiku High. Чисто такой замер бы сделал на трёх попытках одного и того же ресёрча.» «Эта задача не приоритетная, на будущее, в самый конец» Owner correction `16-27-59:5315`, entry `27bf102e`: «Explorer будет не писать отчёт основному агенту, а через tool call будет писать комбинированный файл.» «И это всё будет параллельный tool call: параллельно читаются куски файлов, параллельно он записывает файл и куски файлов эти подкрепляет в placeholder куда-нибудь, как будет по шаблону.» «Он этот файл генерирует и потом отдаёт ссылку на этот файл основному агенту. А файл этот где-то во временных файлах системы генерируется.» «Таким образом, он реально полезную нагрузку на 50К токенов генерирует, а содержимое файлов идет сверх этого. Основной агент просто вычитывает этот огромный файл кусками и дальше от него уже пляшет.» Coordinator text `16-27-59:5318` (the table of contents). |
| <a id="windows-test-failures"></a>WINDOWS-TEST-FAILURES | Umbrella for every Windows test failure ignored by the merge gate, so Windows support is finished later. New ignored failures are added here or as a linked `qa-inbox` issue ([PROCESS.md](PROCESS.md#task-pipeline)); fixes follow the triage and proof rules of [PROCESS.md](PROCESS.md#quality-control-loop), real fixes and not skips. Known now, all causes unresolved unless stated; existing canonical entries are linked, not duplicated: (1) background-test timing, QA #3 with duplicates #4 and #5: [QA-FLAKES-LAST](#qa-flakes-last), issues [#3](https://github.com/ARQAWA/my-pi/issues/3), [#4](https://github.com/ARQAWA/my-pi/issues/4), [#5](https://github.com/ARQAWA/my-pi/issues/5). (2) Bun RPC, QA #2: [issue #2](https://github.com/ARQAWA/my-pi/issues/2), branch `qa-2-bun-rpc`; a product, test or infra cause is not proven. (3) `QA-CODEX-CHILD-EBUSY`: Windows temporary-directory cleanup in `extensions/RQW-codex/test/session-compaction.test.ts:136`, [run 40045058810](https://github.com/ARQAWA/my-pi/actions/runs/40045058810); its own entry is on branch `codex-compaction-fix` (commit `6500f63`, not on `main` yet). (4) `web-search-cli`: [run 40044105379](https://github.com/ARQAWA/my-pi/actions/runs/40044105379), head `f538245701d59a832e5903ff083a078b5ec3f697`; a POSIX file-permission check and a file hash mismatch, line endings only a coordinator hypothesis; its tests are scoped to macOS for now. (5) `qa-status-ack`: [run 40007862125](https://github.com/ARQAWA/my-pi/actions/runs/40007862125), [attempt 2](https://github.com/ARQAWA/my-pi/actions/runs/40007862125/attempts/2), `background.test.ts:256` on Windows, noted on [issue #3](https://github.com/ARQAWA/my-pi/issues/3#issuecomment-6372940758) for triage; not claimed to be the same cause. (6) `theme-card-colors`: [run 40008518122](https://github.com/ARQAWA/my-pi/actions/runs/40008518122), job `test (windows-latest, node 22.19.0)`, step "Tests in a path with spaces and Cyrillic", background-job tests of `RQW-tools`; cause not established. | QUEUED at the very end of the queue, after PROJECT-EXPLORER, worked by the test lane whenever items exist ([D-PIPELINE-TEST-LANE](DECISIONS.md#task-pipeline)); a record only, no fix branch, nothing fixed here. Sources are coordinator reports of the session, not owner words. | Owner `16-27-59:5309`, entry `1bbe27c1`: «нужно все косяки Windows-тестов в конец бэклога засунуть, чтобы он их потом фиксил, чтобы они не были заброшены, чтобы Windows тоже поддерживалась, доводилась до конца.» Coordinator text `16-27-59:5312` (the list) and `5310` (the brief to the agents). [D-PIPELINE-MAC-GATE](DECISIONS.md#task-pipeline). |

## Waiting for owner

| ID | Work | Status/branch | Source |
| --- | --- | --- | --- |
| <a id="i01"></a>I01 | Confirm whether the owner completed QA mail setup with `QA_SMTP_USER`, `QA_SMTP_PASSWORD`, `QA_MAIL_TO` and switched Actions notifications to On GitHub only. | OPEN confirmation, completion unverified, not known to be pending. QA loop implementation is delivered on main; no implementation branch or further code task. Never store secret values in evidence. | Main QA loop `3bdac4f`; `D-QA-DIGEST`, `D-QA-NOTIFICATIONS`; `.github/workflows/qa-digest.yml`; PROCESS Quality control loop. |
| <a id="a02"></a>A02 | Choose bash isolation and batch concurrency for the native-subagents proposal before implementation. | OPEN, awaiting owner answers; no code or branch. | Backlog A02; completeness 227; external `my-pi-evidence/native-subagents/PROPOSAL.md`. |
| <a id="vdi-update"></a>VDI-UPDATE | Confirm whether the owner has completed the requested PCLI package update on the VDI. | OPEN, awaiting owner confirmation of completion, not a claim that installation is still pending; no branch. Publication is complete and is not an open task. Not the removed VDI wheel-check task. | Coordinator record of the approved release-then-VDI-update sequence in DECISIONS PCLI; AUDIT section 5 and `parts/decisions-C.md` one-off update entry. |
| <a id="context-simplify"></a>CONTEXT-SIMPLIFY | Decide whether to remove summary-reserve rebinding that has no effect on Pi 1.4.0. | OPEN proposal, optional simplification, not an approved runtime change; no branch. | AUDIT section 5, Context findings; `extensions/RQW-context/index.ts`. |

## Deferred by owner

| ID | Work | Status/branch | Source |
| --- | --- | --- | --- |
| <a id="u10"></a>U10 | Image paste markers `[image #N]` with unchanged stock paste mechanics. | DEFERRED, coordinator record of owner deferral; no authenticated quote supplied. Not built; blocked by private editor paste, undo and deletion state; no T25 branch. | Backlog U10; handoff 99-100/115; completeness 55; UI execution brief P8 T25; external T25-gate.md. |
| <a id="u14"></a>U14 | Todo-list producer, three-line panel and task-list check before stopping; task-list overlap with I05 is owned here. | DEFERRED by owner: «Да давай потом, пока отложим это». Not dropped or implemented; no branch. | Backlog U14/I05; handoff 103; UI execution brief section 2 item 1; DECISIONS Scope. USER entry `2026-10-21T18-16-12-433Z_01a15fad-8f91-7306-bd46-1528008fbdc6.jsonl:901`. |
| <a id="u15"></a>U15 | A better duration-line proposal after todo work; rejected static grey line is not an open implementation task. | DEFERRED to the end, coordinator record of owner deferral; no authenticated quote supplied; no branch. | Backlog U15; handoff 103; UI execution brief section 2 item 2. |
| <a id="a01"></a>A01 | Remaining Codex-style child capabilities: parent-history fork, web search and MCP. Durable resume is AGENT-SESSION-PERSIST. | DEFERRED, coordinator record of owner deferral; no authenticated quote supplied. Not delivered by in-process sessions; no branch. | Backlog A01; DECISIONS Agent deferred-capabilities entry. |
| <a id="r11"></a>R11 | Reviewer checking test code against requirements and test plan, including conversation collection; distinct from repository checks reviewers may already run. | DEFERRED by owner, not built; no branch. Exact USER entry below. | Backlog R11; completeness 147; `2026-10-21T16-27-59-062Z_01a15f4a-7ad5-7377-81be-0baf3b6ffa33.jsonl:1602`. |
| <a id="claude-reviewer"></a>CLAUDE-REVIEWER | Measure a Claude reviewer and choose its model among the available ones. Until then every review runs on `openai-codex`. | DEFERRED by owner until the Anthropic limits refresh; not built; no branch. | Owner `16-27-59:5291`; quote below; `D-REVIEW-PROFILES`. |
| <a id="i05"></a>I05 | `codebase_explorer`, `custom`, `define-goal` and work orders; clarify explorer purpose against existing `explore`. Task list is U14. | DEFERRED, coordinator record of owner deferral; no authenticated quote supplied. Not abolished; no new implementation permission or branch. | Backlog I05; active `D-SCOPE-POSTPONED`; DECISIONS Scope postponed-items entry. |

R11 exact USER entry from the session above. Session files are under
`/Users/arkadijcukavin/.pi/agent/sessions/--Users-arkadijcukavin-ai-project-my-pi--/`.

```text
Нет, я думаю, что в автотестах тесты сами не надо запускать, когда он review делает.

 Я могу достать переписку. Я смогу достать код, но я не смогу достать коммит до и коммит после, скорее всего. Я хз.

 Давай пока скипнем тему с автотестами, потом к этому вернёмся.
```

Owner quotes for CODEX-REVIEWER-COMPARISON and CLAUDE-REVIEWER, session
`2026-10-21T16-27-59-062Z_01a15f4a-7ad5-7377-81be-0baf3b6ffa33.jsonl`:

> «Я согласен провести такой эксперимент. Пять одинаковых заданий по одному запуску» (`16-27-59:5225`)
>
> «сравнивать надо весь цикл целиком, как есть» (`16-27-59:5289`)
>
> «Для Claude надо будет замерить. Пока все review будет делать ChatGPT, потом как обновятся лимиты, и Claude померяем, выберем модель из того, что есть» (`16-27-59:5291`)

## Current execution order and dependencies

This is the current owner-directed queue, not a permanent PROCESS rule. Detailed design still follows Research and
agreement. WEB-SEARCH is CLI-first; the TOKEN-EFFICIENCY read cache was built ahead of it on the owner's explicit request, then NONBLOCKING-WAITS and ASYNC-TOOL-CALLING together, then CODEX-CHANGELOG.
The waits placement is coordinator recommendation without owner objection. Research uses the delivered web-search CLI.
Rebuild and knowledge base follow research, new UI and small merges; audits and every audit fix wait for that rebuild.
Flaky-test work (QA-FLAKES-LAST) stays last, after interim Windows skips.

```text
TOKEN-EFFICIENCY-REVIEW (read cache merge + 3 days, then tune or remove)
WEB-SEARCH (CLI delivered into main)
|- NONBLOCKING-WAITS + ASYNC-TOOL-CALLING (after the delivered TOKEN-EFFICIENCY read cache)
`- AGENT-STRUCTURE-RESEARCH
CODEX-CHANGELOG (after waits/async; no web-search dependency)
New UI
Small near-ready merges
AGENT-STRUCTURE-RESEARCH + New UI + Small near-ready merges
`- EXTENSION-STRUCTURE + REPO-KNOWLEDGE-INDEX
   `- Per-extension audits
      `- Audit fix tasks (end of queue)
QA-FLAKES-LAST (interim Windows skips first; causal fix last)
PROJECT-EXPLORER (very end of the queue, low priority; measurement after the Anthropic limits refresh)
WINDOWS-TEST-FAILURES (very end of the queue, after PROJECT-EXPLORER)
```

### WEB-SEARCH

Blocked by: none; queued after the process-rules change.
One command searches and reads a page by URL; use two commands if the combined command is hard for agents to use.
The interaction is a Codex clone: our agent uses it exactly like Codex web search and receives a short summary with
sources and links. Optimise the prompt and the command's own help text for effective agent use; the tool itself
explains how to use it. It is available to every agent and worker; the agent/worker model matrix does not change.
Search-side GPT follows the calling agent, not the coordinator's worker table: a GPT caller uses the same model
and thinking; a Claude caller uses the fixed product-side GPT mapping below, independent of coordinator classes.
Searches spend the owner's ChatGPT subscription usage like any Codex message. The worker matrix remains unchanged.
See `D-SCOPE-WEB-SEARCH-MODEL`.

| Calling model | Search-side GPT | Thinking |
| --- | --- | --- |
| Any GPT caller | The caller's own model | The caller's own thinking. |
| Haiku 5.5 | Luna 5.6, `gpt-5.6-luna` | Same thinking level. |
| Sonnet 5.5 | Sol 6, `gpt-6-sol` | Same thinking level, one to one. |
| Opus 5.5 | Sol 6.1, `gpt-6.1-sol` | `low` -> `low`; `medium` -> `high`; `high` -> `xhigh`; any higher level -> `max`. |

Owner confirmed the complete table (`16-27-59:4941`, entry `2502a877`):
«Да, всё именно так, как ты записал.»

In the CLI phase, caller model/thinking may be passed as CLI arguments. In the later tool phase, the tool forwards
the calling agent's model and thinking through the mapping automatically inside its functionality; the agent
passes no model arguments.
Owner (`16-27-59:4945`, entry `5a0f77bd`):
«И потом в будущем, когда мы сделаем tooling, таблица соответствия модели будет прокидываться автоматически на уровне функционала. Не как аргументы CLI, а на уровне функционала tooling всё это будет пробрасываться, форвардиться»

### NONBLOCKING-WAITS and ASYNC-TOOL-CALLING

Blocked by: WEB-SEARCH.
These are the same interaction theme; the design may merge them. Waits must not prevent owner steering, and full
asynchronous tool calling lets the agent keep working and receive messages while tool calls continue.

### CODEX-CHANGELOG

Blocked by: none; queue after NONBLOCKING-WAITS and ASYNC-TOOL-CALLING. Read the changelog and source through GitHub
via git, so this research does not require WEB-SEARCH.

### AGENT-STRUCTURE-RESEARCH

Blocked by: WEB-SEARCH, including the local CLI, delivered into main; it may not start earlier.

### New UI and small near-ready merges

Blocked by: none beyond the prerequisites below.
New UI still includes its existing reviewer/card prerequisites U05/U06/U12/U13. Small near-ready merges are the
existing task branches named in the handoff, not permission to invent new work.

### EXTENSION-STRUCTURE and REPO-KNOWLEDGE-INDEX

Blocked by: AGENT-STRUCTURE-RESEARCH, new UI and all small near-ready merges, delivered before files are moved.

### EXTENSION-AUDITS and every audit fix task

Blocked by: EXTENSION-STRUCTURE and REPO-KNOWLEDGE-INDEX, both delivered. No audit or audit fix starts earlier;
reviewer, Codex-live-check and UI-enable prerequisites below also still apply.

Verbatim owner background-wait proposal from the same message:

> «Также я что хочу? У нас есть всякие механики, ожидания и прочее. Я хочу, чтобы когда у нас агент ждёт ответов от саб-агентов, wait, всякие инструменты и прочее, чтобы они не висели как исполняемый процесс. Допустим, он когда ждёт, я могу нормально переписываться с агентом, и я не буду обрывать этот wait инструмент его. Чтобы wait инструмент был в background фоне, и он прислал нотификацию агенту, будил его. Это, по-моему, очень очевидная простая механика, но она не реализована. Я, по крайней мере, не видел. Я хочу, чтобы такие штуки, когда что-то висит на ожидании, чтобы оно висело всегда сразу же в фоне, в background, и агент ставил нотификацию и ожидал нотификации, и я мог с ним общаться, не обрывая эти фоновые штуки. Понимаешь, о чём я? Чтобы когда я пишу какое-нибудь сообщение, steering делаю агенту, чтобы его tool call не обрывались нахуй. Я не знаю, как это правильно сформулировать. Чтобы какие-то tool call обрывались, а какие-то нет. Типа того.»

## Independent extension audits

EXTENSION-AUDITS is one backlog entry containing one queued task per extension, not authorization to start all audits.
For each audit, independently re-check all delivered work against its original task: the owner's requests and
`DECISIONS.md`. Thoroughly hunt bugs, rerun relevant tests, assess how to strengthen them and identify implementation
weak spots. Also check a minimal solution, minimal code and no garbage, under PROCESS Code quality.
The auditor only finds and describes defects; it fixes nothing. On completion, replace its audit task with one fix
task per defect at the end of the queue. Audits sit after small near-ready merges and the delivered rebuild/knowledge
base, before the flaky-test fix (QA-FLAKES-LAST).

Ready tasks, simplest to most complex; one-line ordering rationale uses source size and coupling, not test counts:

1. `RQW-mouse`: one small Windows hook, no extension-to-extension coupling.
2. `RQW-scroll`: one small Escape handler, no extension-to-extension coupling.
3. `RQW-providers`: one provider-registry filter with a session-binding contract.
4. `RQW-send-now`: one small module, but depends on Pi's queued-input state.
5. `RQW-settings`: a few small modules, with GPT Fast contracts consumed by other extensions.
6. `RQW-prompt`: small loader and prompt text, but its instructions affect the whole agent.
7. `RQW-context`: one larger module controlling context policy and async request state.
8. `RQW-session`: small source, but permanent session/artifact deletion raises the risk.
9. `pcli-vscode`: small source, but packaging, bundled Pi and the VS Code terminal cross system boundaries.
10. `RQW-models`: a medium-sized picker and effort state machine using Pi's session setters.
11. `RQW-statusbar`: larger rendering code, editor/footer replacement and settings integration.
12. `RQW-anthropic`: multi-module OAuth/network transport with retries and session binding.
13. `RQW-tools`: large base-tool wrappers, background jobs and ordering barrier used by agent/review.
14. `RQW-agent`: large recursive-session lifecycle with settings/tools/review event contracts.

Conditional tasks join the same simplest-first queue only after their prerequisites, reassessed against delivered code:

1. `RQW-theme`: after UI enablement; data-only theme, insert before the small code extensions.
2. `RQW-thinking`: after UI enablement; tiny standalone display hook, insert among the simplest extensions.
3. `RQW-naming`: after UI enablement; small naming modules with model calls, insert near the small session features.
4. `RQW-agent-ui`: after UI enablement; cards consume agent/review lifecycle data, place by delivered size and coupling.
5. `RQW-tool-ui`: after UI enablement; sizeable tool rendering integration, insert near statusbar.
6. `RQW-review`: after the new reviewer lands; sizeable git/review lifecycle with tools/agent/settings contracts,
   provisionally between anthropic and tools, reassess the new implementation.
7. `RQW-codex`: after merge and the owner's live check; the large multi-module transport candidate suggests last,
   reassess its merged size and coupling before inserting.

Verbatim owner request, `16-27-59:4864`, entry `c7934716`:

> «Я хочу, чтобы ты добавил в бэклог, чтобы ты навешал на каждый уже существующий установленный extension, созданный в нашем репозитории, задачу полной независимой перепроверки всей проделанной работы, тщательного поиска багов, перезапуска тестов, проверки, как можно тесты усилить, и есть ли какие-то слабые места, которые были пропущены при реализации. Такой аудит каждого extension, который уже сейчас реализован. И ты их поставь в очередь. Предложи клиент поставить эти задачи в очередь.»

Verbatim owner order and fix policy, `16-27-59:4868`, entry `6e47c19b`:

> «Порядок обратный: сначала самые простые, а потом самые сложные. От простых к сложным пойдём. Теперь место в очереди. Да. После мелких слияний, перед нестабильными тестами. Всё правильно. Аудитор находит ошибки и добавляет в конец очереди задачи на исправление. Аудитор только всё находит, дефицирует и ставит вместо себя задачу на доработку, на исправление. Но при этом надо строго проверить, что именно с первоначальной задачей всё соответствует и всё сделано пиздато.»

Verbatim owner quality and architecture/research/index source, `16-27-59:4872`, entry `249fcb3b`:

> «Чтобы было минималистичное решение, минимальный код написан, чтобы не было никакого мусора.»
> «Также можно добавить задачу на пересборку архитектуры, чтобы мы развели сами extension и их тесты. Мы тесты выведем в отдельную папку, и там будет дублирующее дерево extension, чтобы у нас сами по себе extension тесты в себе не несли, грубо говоря. И таким образом закрепим это внутри нашего репозитория.»
> «Но так как всей хуйнёй занимается AI-agent, то надо поискать практики именно на этом языке программирования, которые лучше всего поддерживаются AI-agent, и провести research на тему того, как эффективнее всего организовывать код таким образом, чтобы AI-agent суперэффективно его поддерживал и дорабатывал. И надо сделать базу знаний в виде markdown-файлов, которую агент будет вести постоянно, и она будет консистентна с нашим репозиторием, а именно базу знаний скелетную по нашему репозиторию, чтобы агент мог быстро её прочитать и по ней быстро понять, где что искать. Без grep, без find, а просто прочёл указатель индексов, прочёл какие-то группы папок, где что лежит, максимально быстро, просто, эффективно. Он понял, в каких папках что лежит, где что искать. У каждого extension должна быть идентичная схожая структура фреймворка. Надо сделать какой-то research и улучшить архитектуру именно папок, файлов, чтобы она была заточена под агентов, чтобы агенты суперэффективно, быстро и легко дорабатывали всю эту историю. Это суперкритически важно.»

## Queue corrections and research sources

Owner (`16-27-59:4880`, entry `c47e60b3`):

> «Мне кажется, что выяснится, что более эффективно, чтобы это был сеньорский хороший декомпозированный код и просто к нему припаркованы какой-нибудь aft, grep, lsp, bm25, e5, суперпроизводительные инструменты для поиска.»

Owner (`16-27-59:4880`, entry `c47e60b3`):

> «Кстати, самое супер критически важное: вся эта история с поиском должна пойти после того, как ты делаешь веб-поиск, и она должна идти через веб-поиск. И так как это будет происходить в фоне, а я буду спать и веб-поиск я не смогу запустить, то ты должен сделать программный адаптер такой, чтобы ты запускал веб-поиск через Shell. Надо временно сделать локальный CLI, который ты будешь через Bash, через Shell вызывать и делать поисковые запросы в интернет через наш web search. Поэтому это надо делать после web search. Без web search это не будет работать нахуй. Тебе нужно будет провести research, надо будет выяснить, что такое AST, grep, lsp, BM25, E5 и ещё мне кореш писал всякие штуки, которые тоже помогают с кодом работать. Это сейчас скажу: AST, lsp, BM25, E5 hybrid. Вот»

Owner (`16-27-59:4884`, entry `17c100e6`):

> «И надо его поставить в зависимость. Он заблокирован, пока не будет сделан web-поиск»

Owner (`16-27-59:4888`, entry `0aa23856`):

> «Кстати, это охуенная идея. Смотри, веб-поиск можно сделать вообще не расширением, а именно CLI, чтобы он был как grep и как find инструмент. Это будет просто CLI, которую агент будет вызывать из shell. Потом в будущем мы её обернём в отдельный инструмент, так же как grep и find у нас работают сейчас поверх нашего пишного grep и find.»

Owner (`16-27-59:4892`, entry `40d49370`):

> «Перестройка базы знаний идёт сразу после исследования, как раскладывать код для агентов. Она заблокирована этой задачей, они связаны. А соответственно, правки по аудиту связаны и заблокированы на эту задачу. Пока не будет перестройки базы знаний, не будет готова, аудит и правки по аудиту не надо запускать вообще.»

Coordinator text, the questions answered by the owner below (same session, before line 4900):

**1 · Нестабильный тест мешает слияниям**
На Windows тест #3 уже уронил проверку копилки и цвета карточек, оба раза с перезапуском. Значит, мелкие слияния и интерфейс на деле ждут его починки, хотя он в самом конце очереди.
- **a)** Поднять починку #3 перед мелкими слияниями. Тогда они сольются без ручных перезапусков. — *рекомендую*
- **b)** Оставить #3 последним, а слияния пропускать при известном красном Windows с записью в коммите.

**2 · Перестройка и незавершённые ветки**
Перестройка двигает файлы всех расширений. Ветки интерфейса и девяти мелких слияний после неё придётся переделывать.
- **a)** Влить интерфейс и мелкие слияния до перестройки. Тогда перестройка встаёт после них, и переделывать ничего не придётся. — *рекомендую*
- **b)** Оставить перестройку раньше, а ветки потом переносить на новую структуру.


Owner (`16-27-59:4900`, entry `d4622d56`):

> «1а 2а»

## Web-search interface decisions

Owner (`16-27-59:4917`, entry `b86db4f5`), exact spans:

> «2 Про модель для веб-поиска не понял. Я думаю, веб-поиск будет делать любой агент. Это будет инструмент, который будет доступен всем агентам, и воркеры будут типа нашей матрицы агентов и исполнителей, она никак не меняется. Я так думал.»

> «3а - Главное, чтобы агент не охуел этим пользоваться. Если для агента это будет тяжело, то сделай две команды. А если казуально, то оставь одну»

> «4а - Делаем клон Codex, чтобы наш агент работал с этой хуйнёй так же, как с Codex. Мы максимально эффективно прописываем prompt, чтобы он суперэффективно ей пользовался, как и другими инструментами, чтобы сам инструмент подсказывал, как собой пользоваться»

Coordinator text, accepted options 3a and 4a from the question before that message:

1. Одна команда умеет и искать, и читать страницу по ссылке.
2. Короткую сводку с источниками и ссылками, как в Codex.

Web-search model decision, owner (`16-27-59:4924`, entry `89d7b2e6`), exact spans:

> «Мы не привязываемся к координатам. Короче, модель будет та же, которая соответствует нашей модели, которая делает запрос. Вот так. Как понял меня? Давай синканемся здесь.»

> «У нас у каждой cloud-модели есть соответственная модель GPT. А там какая модель на GPT? Там какая-то определённая модель выбирается, или как это происходит? Я не понимаю.»

Owner follow-up (`16-27-59:4928`, entry `e8dc0395`):

> «Надо таблицу соответствия закрепить сразу же заранее. Просто надо понимать, какие модели ищут. Какая-то модель Soul 6, допустим.»

## Fixed search mapping and asynchronous-tool research sources

Owner (`16-27-59:4937`, entry `a8684155`), exact spans:

> «Также добавь в список задач, что нам нужно сделать реализацию асинхронного tool calling, как в Codecs CLI, чтобы агент мог вызывать tool call и при этом асинхронно полностью работать, принимать от меня сообщения и не обрываться на этом.»

> «Изучение это давно уже реализовали. И вообще отдельные задачи надо по changelog за последние полгода пройтись и подобрать охуенные реализации, которые мы можем себе спиздить в наш Pi.»

> «Давай так: для Haiku 5.5 будет Luna 5.6. Для Sonnet 5.5 будет Sol 6, а для Opus 5.5 будет Sol 6.1. Вот и всё. Только Sol 6.1 и Sol 6 знаешь как будут соответствовать Haiku? Следующим образом, смотри: Sonnet и Opus: low модель соответствует low модели. Sol 6.1 один к одному соответствует Sonnet. А вот Opus 5.5 и Sol 6.1 соответствуют следующим образом: Opus 5.5 low соответствует Sol 6.1 low, Opus 5.5 medium соответствует Sol 6.1 high, а Opus 5.5 high соответствует Sol 6.1 extra high. Соответственно, все высшие рислинги Opus соответствует Sol 6.1 max.»
