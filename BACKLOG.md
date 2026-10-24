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
| <a id="u12"></a>U12 | UI integration P10 T12/T20/T22/T30: register naming, thinking, tool-ui and agent-ui in `pi.extensions`, agent-ui before tool-ui; theme in `pi.themes`; update root user docs. | OPEN, no branch assigned. UI resources still need P10 package registration and root documentation. | Backlog U12; handoff 100; UI execution brief P10; current registration carrier `package.json`. |
| <a id="u13"></a>U13 | Real-Pi scripted faux-provider end-to-end tests for tool-ui, thinking hiding, activity indicator and cards; composition, load order and remaining physical-terminal appearance checks from U18. | OPEN, waits for U12 and cards; no P11 branch assigned. Isolated tests do not prove composition. | Backlog U13/U18; handoff 30/49-50/100; completeness 55; UI execution brief P11 T19. |
| <a id="agent-session-persist"></a>AGENT-SESSION-PERSIST | RQW-agent: persist subagent sessions on disk, linked to the parent session, so an agent resumes by its id after a Pi restart with its full history. `/remove` removes the child sessions together with their parent, as in the earlier `/remove` decision ([D-SESSION-COMMANDS](DECISIONS.md#session-commands)). Until it lands, only a short checkpoint right before a planned Pi restart is allowed ([PROCESS.md](PROCESS.md#task-pipeline)). Extension: after the whole Pi process ends (Ctrl+D or a closed terminal tab), `pi -r` and a continue message resume the main chat, and the main agent mechanically resumes all earlier subagents from their saved sessions, as in Cursor. A separate option resumes only the subagents without the main chat; when they finish, the main chat gets a notification and continues by itself. Main never hangs or polls while it waits: it stays idle until the notification. Coordinator design text, not an owner quote: a `resume` action resumes a paused or interrupted agent by retrying the cut-off model request without a new message, also from a saved session after a Pi restart; an interrupted tool call that may have side effects is never replayed blindly, the model sees it as interrupted and decides. The shipped `interrupt` then `send` stays until `resume` is delivered. Linked: [NONBLOCKING-WAITS](#nonblocking-waits) and [ASYNC-TOOL-CALLING](#async-tool-calling), which own the notification wake-up and the non-blocking waits; design may merge them. | QUEUED, no branch, entry only; nothing implemented. Blocked by: none. The coordinator proposed placing it right after WEB-SEARCH (`16-27-59:5090`); the owner has not set the order. | Owner `16-27-59:5087`, entry `ddd0ce47` ([D-PIPELINE-PAUSE-RESUME](DECISIONS.md#task-pipeline)); coordinator text `16-27-59:5090`. Owner `16-27-59:5092`, entry `3c2122c8`, and `16-27-59:5103`, entry `8bb70dcd` (quotes in the decision entry). |
| <a id="agent-states-ui"></a>AGENT-STATES-UI | New UI agent list and cards show three distinct states: working; waiting (CI, review, owner or children); idle or AFK. An idle agent must never look active and never carries a waiting label. | OPEN, part of the new UI with U05 and U12; no branch; entry only, nothing implemented. | Owner `16-27-59:5085`, entry `04f64a5e`: «Если у нас какие-то агенты в афк стоят, то они не должны отображаться, как будто они рабочие и их ожидание происходит.» and `16-27-59:5087`: «И да, интерфейс должен разключать, когда агент стоит, когда он AFK, когда он работает.» |
| <a id="codex-reviewer-comparison"></a>CODEX-REVIEWER-COMPARISON | Whole-cycle comparison of the original Codex CLI reviewer plugin on Sol low with the Pi port: five identical tasks, one run each, from the start to CLEAN including repairs, with the same sources, model and criterion. | QUEUED, starts only after `reviewer-codex-port` is delivered; the plan is not prepared yet; no branch. | Owner `16-27-59:5225`, `16-27-59:5289`; quotes below. |
| <a id="extension-audits"></a>EXTENSION-AUDITS | Full independent re-check of each implemented extension, one queued task each; criteria and simplest-first task list below. | QUEUED after small near-ready merges and rebuild/knowledge base, before remaining flaky-test work; all audits and their fixes blocked until rebuild/knowledge base are delivered; auditor never fixes. | Owner `16-27-59:4864/4868/4872/4892`, entries `c7934716`, `6e47c19b`, `249fcb3b`, `40d49370`. |
| <a id="grep-null"></a>GREP-NULL | Normalize optional grep fields so the main tool does not pass literal string `null` as a glob. | OPEN, no branch assigned; reviewer already has `dropEmptyOptional`, main path does not. | AUDIT section 5, Review limits; `extensions/RQW-review/index.ts`, `extensions/RQW-tools/index.ts`. |
| <a id="publish-skill"></a>PUBLISH-SKILL | Reconcile separate commit/push permission with PROCESS; require successful publication CI on the exact packaged commit, not merely the latest green branch run, and dispatch the intended ref when needed. | OPEN, no branch assigned; skill edits outside this cleanup. Marketplace publishing still needs a direct owner request. | AUDIT item 15 and docs-consistency findings; `.agents/skills/publish-pcli/SKILL.md`. |
| <a id="qa-inbox-followups"></a>QA-INBOX-FOLLOWUPS | Adapt retained implementations to the shared ci-watch cache snapshot architecture: acknowledgement of closed inbox failures in `qa-status-ack` at `4826b43`, and atomic claim helper semantics in `qa-claim` at `0ab8e1a`. | OPEN, NOT delivered; branches retained. No implementation is authorized in this train. | Owner integration bookkeeping and completeness review; superseded architecture does not deliver these behaviors. |
| <a id="web-search-tool"></a>WEB-SEARCH-TOOL | Phase 2: ship a separate Pi web tool wrapper with Windows support, reusing the phase 1 macOS repo-local CLI core; forward the caller's model and thinking through the mapping itself. | OPEN, no branch; blocked by none, the macOS repo-local CLI is delivered ([D-WEB-CLI](DECISIONS.md#web-search-cli)). | Owner `16-27-59:4888/4945`; [D-WEB-MAPPING](DECISIONS.md#web-search-cli). |
| <a id="token-efficiency-review"></a>TOKEN-EFFICIENCY-REVIEW | Follow-up review of the read cache. At the merge date plus 3 days, inspect the sessions since the merge: tokens saved, failed edits, retries. Then tune the cutoff or remove the mechanism. The coordinator reminds the owner in the first conversation after that date; it does not wake itself. | QUEUED. The read cache merged into `main` from branch `unchanged-read`, built ahead of WEB-SEARCH on the owner's explicit request; the review is due at its merge date plus 3 days, planned `2026-10-27` for a merge on `2026-10-24`. The merge agent corrects the date here if the merge lands on another day. | Owner `16-27-59:5135`, entry `171f4d82`: «Мы просто это запилим, я буду с этим работать, а потом через какое-то время ты мне напомнишь, поставишь задачу» and «через три дня после merge надо будет сделать review всех старых сессий на предмет того, помогло нам это или нет. И всё. Не будем никаких делать испытаний и прочей хуйни.» Sessions since the merge, tune or remove, and the reminder rule are coordinator text (`16-27-59:5138`). |
| <a id="timebox-practices"></a>TIMEBOX-PRACTICES | Research, a record only, not started: how practising professional engineers avoid sunk cost, experiment loops, runaway cost and over-testing. Credible primary sources, found with the delivered `rqw-web` CLI ([D-WEB-CLI](DECISIONS.md#web-search-cli)). Output: a short evidence-based proposal of timeboxing, stop criteria, uncertainty spikes, cost versus information, escalation and minimal acceptance checks, adapted to this repository. Not an open-ended benchmark. Linked: [D-PIPELINE-TIMEBOX](DECISIONS.md#task-pipeline). | QUEUED, no branch; do not start. Blocked by: none; the WEB-SEARCH CLI is delivered. The owner has not set its place in the queue. | Owner `16-27-59:5231`, entry `ce0d83d8`: «Надо понять, как их избегать, как не попадать в такие ловушки. Надо поресёрчить, как люди с этим справляются уже — реальные программисты, реальные профессионалы. Это просто как web search работать» |
| <a id="nonblocking-waits"></a>NONBLOCKING-WAITS | Background child/job/long-call waits wake the agent by notification; owner steering remains available without aborting those waits or children/jobs. | QUEUED, next after the delivered TOKEN-EFFICIENCY read cache; no branch; open design: interruptible calls and how queued user input ends a wait early while children/jobs continue. | Owner `16-27-59:4876`, entry `85357ce9`; queue placement is coordinator recommendation without owner objection, not a separate owner quotation. |
| <a id="async-tool-calling"></a>ASYNC-TOOL-CALLING | Asynchronous tool calling as in Codex CLI: agents call tools, keep working, receive owner messages and are not cut off. | QUEUED, next after the delivered TOKEN-EFFICIENCY read cache, with NONBLOCKING-WAITS; linked theme, design may merge them; no branch. | Owner `16-27-59:4937`, entry `a8684155`; exact request below. |
| <a id="codex-changelog"></a>CODEX-CHANGELOG | Review the last six months of Codex CLI changelog/source for strong implementations portable to Pi; return a ranked list with sources to the owner. | QUEUED after NONBLOCKING-WAITS / ASYNC-TOOL-CALLING; not blocked by WEB-SEARCH, use GitHub via git; no branch. | Owner `16-27-59:4937`, entry `a8684155`; exact request below. |
| <a id="qa-flakes-last"></a>QA-FLAKES-LAST | Causal fix of the flaky background-test failures, QA #3 with duplicates #4 and #5, without retries, raised timeouts or weakened assertions. Interim narrow Windows assertion skips are the owner-approved stop-gap ([PROCESS.md](PROCESS.md#quality-control-loop)). | QUEUED last, worked by the test lane whenever items exist ([D-PIPELINE-TEST-LANE](DECISIONS.md#task-pipeline)), existing branch `bg-port-flake`; remaining proof belongs to that task, not this documentation change. It no longer blocks new UI or small merges. | Owner `16-27-59:5060`, entry `46a9e546`, answer to item 4 ([D-PIPELINE-FLAKE-SKIP](DECISIONS.md#task-pipeline)); QA issues #3, #4, #5. Replaces the earlier promotion at `16-27-59:4900`. |
| <a id="agent-structure-research"></a>AGENT-STRUCTURE-RESEARCH | Research TypeScript code and folder organisation for AI maintenance, plus code search/navigation: AST structural search, grep, LSP, BM25, E5 embeddings and hybrid retrieval. Test the owner hypothesis that senior well-decomposed code plus fast search works best; propose uniform extension structure and adapt the provisional code-quality principle from evidence. | QUEUED after WEB-SEARCH; its macOS repo-local WEB-SEARCH CLI prerequisite is delivered ([D-WEB-CLI](DECISIONS.md#web-search-cli)); research must use `rqw-web` from the checkout; no branch. | Owner `16-27-59:4872/4880/4884`, entries `249fcb3b`, `c47e60b3`, `17c100e6`; quotes below. |
| <a id="extension-structure"></a>EXTENSION-STRUCTURE | Rebuild with one identical structure framework per extension; move tests into a separate folder mirroring the extension tree, with no tests in extensions; fix the structure as a repo rule. | QUEUED after research, new UI and small near-ready merges; blocked by all three; no branch. Detailed design still requires agreement. | Owner `16-27-59:4872/4892/4900`, entries `249fcb3b`, `40d49370`, `d4622d56`; questions and quotes below. |
| <a id="repo-knowledge-index"></a>REPO-KNOWLEDGE-INDEX | Skeletal Markdown repository index/folder groups so agents locate code without grep/find; agents maintain it on every change with mechanical consistency checks. | QUEUED with rebuild after research, new UI and small merges; blocked by all three; no branch. Detailed design still requires agreement. | Owner `16-27-59:4872/4892/4900`, entries `249fcb3b`, `40d49370`, `d4622d56`; quotes below. |
| <a id="codex-public-internals"></a>CODEX-PUBLIC-INTERNALS | Move RQW-codex lifecycle, auth and prompt internals to public Pi API where possible; for each seam that stays private, list what breaks, why no public API exists and the cost to the owner, then ask him. Seams found in source: `lifecycle.ts` (`AgentSession.prototype._bindExtensionCore`; instance `dispose` and `_isRetryableError`; its `subscribe` use is the public session subscription and is not a private seam), `auth-runtime.ts` (ModelRuntime `models` and `credentials` layers), `session.ts` (`_hiddenDeclarations`, `_baseSystemPromptOptions`, `_runSystemPromptOptions`, `modelRuntime.credentials`, `extensionRunner`). | QUEUED, not started and NOT implemented by the simple-compaction change; no branch; not in the execution tree below, priority is the owner's to set. | Coordinator interpretation, not a quotation: the owner answered «Да простое сжатие делаем» to a question that offered the Pi-internals replacements as a separate task (session `2026-10-21T16-27-59-062Z_01a15f4a-7ad5-7377-81be-0baf3b6ffa33.jsonl`, lines 5067 and 5073); `DECISIONS.md` `D-CODEX-SIMPLE-COMPACTION`; unfiled upstream request draft `my-pi-evidence/codex-parity/PI-NATIVE-COMPACTION-ISSUE-DRAFT.md`. |
| <a id="qa-codex-child-ebusy"></a>QA-CODEX-CHILD-EBUSY | Classify and fix Windows temporary-directory cleanup failure in `extensions/RQW-codex/test/session-compaction.test.ts:136`, test `child hook bridges isolate stock Pi summaries, routing and concurrent callbacks`; preserve the assertions and investigate resource lifetime before choosing a fix. | QUEUED, no fix branch; Windows advisory under the owner's delivery rule, not a blocker for Codex compaction delivery once the `process-pipeline` gate change lands. Not fixed or retried by `codex-compaction-fix`. | [tests run 40045058810](https://github.com/ARQAWA/my-pi/actions/runs/40045058810), exact head `ce9425611a1a29499295fe5d21f5a595755f7baf`, push attempt 1; Windows Node 24 and PortableGit Node 22.19.0; log excerpt below. Owner instruction after the task pause: queue Windows failures and do not fix this EBUSY now. |

### QA-CODEX-CHILD-EBUSY evidence

The failure is `EBUSY` while removing a temporary `rqw-child-standard-compaction-*` directory. Its handle/lifetime cause is not classified yet. macOS jobs passed on the same head. Windows results remain recorded as failures, not relabelled as green.

Saved CI log: `/tmp/codex-compaction-ci-ce-tests-logs/5_windows-portable-git (node 22.19.0).txt`, lines 8659-8666, from [run 40045058810](https://github.com/ARQAWA/my-pi/actions/runs/40045058810):

```text
not ok 522 - child hook bridges isolate stock Pi summaries, routing and concurrent callbacks
location: 'D:\\a\\my-pi\\my-pi\\extensions\\RQW-codex\\test\\session-compaction.test.ts:136:1'
error: "EBUSY: resource busy or locked, rmdir 'C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\rqw-child-standard-compaction-YizWq5'"
code: 'EBUSY'
```

This is a backlog entry rather than a bot-owned inbox issue: `scripts/qa-inbox.mjs` accepts only scheduled/dispatched `main` runs for writes and permits `--force-any-branch` only with `--dry-run`. This failure came from a task-branch push; do not manufacture a `main` occurrence or change the QA state format.

| <a id="compaction-sheen-delivery"></a>COMPACTION-SHEEN-DELIVERY | Deliver branch `compaction-sheen`, retained head `718aa9d`. | OPEN, NOT delivered. Exact-head CI [run 40068478428](https://github.com/ARQAWA/my-pi/actions/runs/40068478428) succeeded, but the head still lacks the required independent test-integrity review: `deliver-check` failed because `extensions/RQW-statusbar/test/chrome.test.ts` removes assertions (removed 24, added 8) and the squash message has no `Test-change:` and `Test-review: agent#N CLEAN` trailers. Evidence log: `/tmp/train-compaction-gate.log`. Do not merge until that review is clean ([PROCESS.md](PROCESS.md#independent-review)). | Coordinator report of the merge train, not owner words. |
| <a id="agent-async-delivery"></a>AGENT-ASYNC-DELIVERY | Deliver branch `agent-async`, head `62bb752`. | OPEN, blocked, NOT merged. The required exact-head CI [run 40072884531](https://github.com/ARQAWA/my-pi/actions/runs/40072884531) failed in both macOS test jobs: [test (macos-latest, node 22.19.0)](https://github.com/ARQAWA/my-pi/actions/runs/40072884531/job/120809934762) and [test (macos-latest, node 24)](https://github.com/ARQAWA/my-pi/actions/runs/40072884531/job/120809934845). A macOS job is required, so the head is not mergeable. The original owner-named run [40067206370](https://github.com/ARQAWA/my-pi/actions/runs/40067206370) also failed, so the failure is not only in the integration head; five earlier agent-async runs, listed in WINDOWS-TEST-FAILURES item (8), also had both macOS test jobs red. None of these runs is accepted merge evidence. Evidence: `/tmp/train-agent-async-jobs.json`, `/tmp/train-agent-async-earlier-jobs.json` and `/tmp/train-agent-async-failed.log`. Cause not established here, no fix claimed. | Coordinator report of the merge train, not owner words. |
| <a id="project-explorer"></a>PROJECT-EXPLORER | Rework `explore` into an appropriately renamed project or file explorer, limited to this project's codebase on this computer. Coordinator summary, not owner words: the explorer does not write its report in the answer. Through a tool call it creates one combined file in the operating system's temporary directory from a template: an analytic report of about 50000 tokens (the owner's target within the 128k output limit, not a measured guarantee) with placeholders, and the tool fills the placeholders with the actual code excerpts of the referenced ranges, reading them in parallel. The code excerpts come on top of the 50000 tokens, not inside them, and the model never reprints code. The explorer returns only the file path to main, and main reads the file in chunks. The report is very detailed, dense and self-contained, so that main can continue alone: the files and their contents, who owns what, the structure and the important code. Coordinator text, not an owner quote: the file starts with a table of contents giving the line range of every section, so main reads only the sections it needs and not the whole file. Afterwards a small measurement: Sonnet 5.5 medium against Haiku 5.5 high, the same research, 3 attempts each. Today's explorer: [D-AGENT-EXPLORE-TOOLS](DECISIONS.md#agent). | QUEUED at the very end of the queue, low priority, after every other entry including TIMEBOX-PRACTICES and QA-FLAKES-LAST and before WINDOWS-TEST-FAILURES; a record only, no branch, nothing started, no model launched. The measurement waits for the Anthropic limits refresh; nothing else needs the owner. The current development model table gets no exception now. | Owner `16-27-59:5303`, entry `08ec21d0`: «Надо его переименовать во projects explorer, чтобы он был explorer только в рамках кодовой базы этого проекта и этого компьютера.» «Хорошо, не все, а хотя бы чтобы он старался на 50 тыс. Уложиться, но при этом не перепечатывать код» «Не Opus, давай Sonnet Medium против Haiku High. Чисто такой замер бы сделал на трёх попытках одного и того же ресёрча.» «Эта задача не приоритетная, на будущее, в самый конец» Owner correction `16-27-59:5315`, entry `27bf102e`: «Explorer будет не писать отчёт основному агенту, а через tool call будет писать комбинированный файл.» «И это всё будет параллельный tool call: параллельно читаются куски файлов, параллельно он записывает файл и куски файлов эти подкрепляет в placeholder куда-нибудь, как будет по шаблону.» «Он этот файл генерирует и потом отдаёт ссылку на этот файл основному агенту. А файл этот где-то во временных файлах системы генерируется.» «Таким образом, он реально полезную нагрузку на 50К токенов генерирует, а содержимое файлов идет сверх этого. Основной агент просто вычитывает этот огромный файл кусками и дальше от него уже пляшет.» Coordinator text `16-27-59:5318` (the table of contents). |
| <a id="windows-test-failures"></a>WINDOWS-TEST-FAILURES | Umbrella for every Windows test failure ignored by the merge gate, so Windows support is finished later. New ignored failures are added here or as a linked `qa-inbox` issue ([PROCESS.md](PROCESS.md#task-pipeline)); fixes follow the triage and proof rules of [PROCESS.md](PROCESS.md#quality-control-loop), real fixes and not skips. Known now, all causes unresolved unless stated; existing canonical entries are linked, not duplicated: (1) background-test timing, QA #3 with duplicates #4 and #5: [QA-FLAKES-LAST](#qa-flakes-last), issues [#3](https://github.com/ARQAWA/my-pi/issues/3), [#4](https://github.com/ARQAWA/my-pi/issues/4), [#5](https://github.com/ARQAWA/my-pi/issues/5). (2) Bun RPC, QA #2: [issue #2](https://github.com/ARQAWA/my-pi/issues/2), branch `qa-2-bun-rpc`; a product, test or infra cause is not proven. (3) `QA-CODEX-CHILD-EBUSY`: Windows temporary-directory cleanup in `extensions/RQW-codex/test/session-compaction.test.ts:136`, [run 40045058810](https://github.com/ARQAWA/my-pi/actions/runs/40045058810); its own entry is on branch `codex-compaction-fix` (commit `6500f63`, not on `main` yet). (4) `web-search-cli`: [run 40044105379](https://github.com/ARQAWA/my-pi/actions/runs/40044105379), head `f538245701d59a832e5903ff083a078b5ec3f697`; a POSIX file-permission check and a file hash mismatch, line endings only a coordinator hypothesis; its tests are scoped to macOS for now. (5) `qa-status-ack`: [run 40007862125](https://github.com/ARQAWA/my-pi/actions/runs/40007862125), [attempt 2](https://github.com/ARQAWA/my-pi/actions/runs/40007862125/attempts/2), `background.test.ts:256` on Windows, noted on [issue #3](https://github.com/ARQAWA/my-pi/issues/3#issuecomment-6372940758) for triage; not claimed to be the same cause. (6) `theme-card-colors`: [run 40008518122](https://github.com/ARQAWA/my-pi/actions/runs/40008518122), job `test (windows-latest, node 22.19.0)`, step "Tests in a path with spaces and Cyrillic", background-job tests of `RQW-tools`; cause not established. (7) Old `qa-2-bun-rpc` head `d0e9d04`: completed failed [run 40051822563](https://github.com/ARQAWA/my-pi/actions/runs/40051822563); fresh finished-run evidence `/tmp/train-qa2-old-jobs.json` shows only [windows-portable-git (node 22.19.0)](https://github.com/ARQAWA/my-pi/actions/runs/40051822563/job/120745944856) failed. Cause not inspected or established. (8) Branch `agent-async` head `62bb752`, [run 40072884531](https://github.com/ARQAWA/my-pi/actions/runs/40072884531): all three Windows jobs red, [windows-portable-git (node 22.19.0), job 120809934531](https://github.com/ARQAWA/my-pi/actions/runs/40072884531/job/120809934531), [test (windows-latest, node 24), job 120809934791](https://github.com/ARQAWA/my-pi/actions/runs/40072884531/job/120809934791), [test (windows-latest, node 22.19.0), job 120809934836](https://github.com/ARQAWA/my-pi/actions/runs/40072884531/job/120809934836); evidence `/tmp/train-agent-async-jobs.json`. Earlier `agent-async` runs, same recorded failure set in each: the three Windows jobs (node 22.19.0, node 24, PortableGit node 22.19.0) and both macOS test jobs failed; failure log signatures of these runs were not inspected, so no grouping by signature is claimed; evidence `/tmp/train-agent-async-earlier-jobs.json`: [run 40070314137](https://github.com/ARQAWA/my-pi/actions/runs/40070314137) (Windows: [win node 22.19.0, job 120802139486](https://github.com/ARQAWA/my-pi/actions/runs/40070314137/job/120802139486), [win node 24, job 120802139501](https://github.com/ARQAWA/my-pi/actions/runs/40070314137/job/120802139501), [PortableGit node 22.19.0, job 120802139492](https://github.com/ARQAWA/my-pi/actions/runs/40070314137/job/120802139492)); [run 40067206370](https://github.com/ARQAWA/my-pi/actions/runs/40067206370) (Windows: [win node 22.19.0, job 120792850229](https://github.com/ARQAWA/my-pi/actions/runs/40067206370/job/120792850229), [win node 24, job 120792850214](https://github.com/ARQAWA/my-pi/actions/runs/40067206370/job/120792850214), [PortableGit node 22.19.0, job 120792850140](https://github.com/ARQAWA/my-pi/actions/runs/40067206370/job/120792850140)); [run 40066540479](https://github.com/ARQAWA/my-pi/actions/runs/40066540479) (Windows: [win node 22.19.0, job 120790879491](https://github.com/ARQAWA/my-pi/actions/runs/40066540479/job/120790879491), [win node 24, job 120790879424](https://github.com/ARQAWA/my-pi/actions/runs/40066540479/job/120790879424), [PortableGit node 22.19.0, job 120790879447](https://github.com/ARQAWA/my-pi/actions/runs/40066540479/job/120790879447)); [run 40065744954](https://github.com/ARQAWA/my-pi/actions/runs/40065744954) (Windows: [win node 22.19.0, job 120788507595](https://github.com/ARQAWA/my-pi/actions/runs/40065744954/job/120788507595), [win node 24, job 120788507480](https://github.com/ARQAWA/my-pi/actions/runs/40065744954/job/120788507480), [PortableGit node 22.19.0, job 120788507278](https://github.com/ARQAWA/my-pi/actions/runs/40065744954/job/120788507278)); [run 40064495413](https://github.com/ARQAWA/my-pi/actions/runs/40064495413) (Windows: [win node 22.19.0, job 120784785702](https://github.com/ARQAWA/my-pi/actions/runs/40064495413/job/120784785702), [win node 24, job 120784785680](https://github.com/ARQAWA/my-pi/actions/runs/40064495413/job/120784785680), [PortableGit node 22.19.0, job 120784785698](https://github.com/ARQAWA/my-pi/actions/runs/40064495413/job/120784785698)); [run 40063661836](https://github.com/ARQAWA/my-pi/actions/runs/40063661836) (Windows: [win node 22.19.0, job 120782272943](https://github.com/ARQAWA/my-pi/actions/runs/40063661836/job/120782272943), [win node 24, job 120782272993](https://github.com/ARQAWA/my-pi/actions/runs/40063661836/job/120782272993), [PortableGit node 22.19.0, job 120782272869](https://github.com/ARQAWA/my-pi/actions/runs/40063661836/job/120782272869)). None is accepted merge evidence. Cause not established for any of them, no fix claimed. | QUEUED at the very end of the queue, after PROJECT-EXPLORER, worked by the test lane whenever items exist ([D-PIPELINE-TEST-LANE](DECISIONS.md#task-pipeline)); a record only, no fix branch, nothing fixed here. Sources are coordinator reports of the session, not owner words. | Owner `16-27-59:5309`, entry `1bbe27c1`: «нужно все косяки Windows-тестов в конец бэклога засунуть, чтобы он их потом фиксил, чтобы они не были заброшены, чтобы Windows тоже поддерживалась, доводилась до конца.» Coordinator text `16-27-59:5312` (the list) and `5310` (the brief to the agents). [D-PIPELINE-MAC-GATE](DECISIONS.md#task-pipeline). |

Windows advisory follow-up for WINDOWS-TEST-FAILURES: pre-rebase `fix/web-cli-setup` head `5f607a8`,
completed failed run `40075615612`: [test (windows-latest, node 24)](https://github.com/ARQAWA/my-pi/actions/runs/40075615612/job/120818186253)
and [test (windows-latest, node 22.19.0)](https://github.com/ARQAWA/my-pi/actions/runs/40075615612/job/120818186324)
failed in `Tests in a path with spaces and Cyrillic`. Evidence: `/tmp/my-pi-web-ci-first-jobs.json` and
`/tmp/my-pi-web-ci-first-failed.log`. QUEUED with the umbrella entry for later triage; cause not established,
no Windows fix claimed. Coordinator record, not owner words.

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
| <a id="todo-panel"></a>TODO-PANEL | Todo list with compact panel above the input: agent working-memory list, three-line panel, expand, history, completion check. Open choices named in the owner text: skill name and activation duration; three-line layout with sub-steps; expand method and depth; behaviour on blocker, wait or cancel. | DEFERRED by owner until the current UI changes land (P5/P10/P11: U05, U12, U13). Not authorised for implementation; no branch. Overlaps U14, which owns the same todo-list producer and panel. Exact USER entry below. | Owner message "Вот еще принес задачек запиши" in session `2026-10-21T16-27-59-062Z_01a15f4a-7ad5-7377-81be-0baf3b6ffa33.jsonl`. |

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
agreement. The phase 1 macOS repo-local WEB-SEARCH CLI is delivered ([D-WEB-CLI](DECISIONS.md#web-search-cli)); the TOKEN-EFFICIENCY read cache was built ahead of it on the owner's explicit request, then NONBLOCKING-WAITS and ASYNC-TOOL-CALLING together, then CODEX-CHANGELOG.
The waits placement is coordinator recommendation without owner objection. Research uses the macOS checkout CLI.
Rebuild and knowledge base follow research, new UI and small merges; audits and every audit fix wait for that rebuild.
Flaky-test work (QA-FLAKES-LAST) stays last, after interim Windows skips.

```text
TOKEN-EFFICIENCY-REVIEW (read cache merge + 3 days, then tune or remove)
WEB-SEARCH CLI (macOS repo-local; delivered: D-WEB-CLI)
|- WEB-SEARCH-TOOL (phase 2 shipped wrapper + Windows)
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

### WEB-SEARCH-TOOL

Blocked by: none; the phase 1 macOS repo-local CLI is delivered ([D-WEB-CLI](DECISIONS.md#web-search-cli)).
Open phase 2: add Windows support and ship one separate Pi tool wrapper over the repository CLI core, as our `grep` and `find` wrap stock search. The tool takes `queries` OR `urls`,
`focus`, `mode` and `response_length`, takes the calling agent's model and thinking from the session and applies the
mapping in `cli/web/model-map.ts` itself, with no model arguments for the agent. The CLI core is reused, not copied. No tool exists yet.

### NONBLOCKING-WAITS and ASYNC-TOOL-CALLING

Blocked by: none; queued after TOKEN-EFFICIENCY, and the phase 1 macOS repo-local WEB-SEARCH CLI prerequisite is delivered.
These are the same interaction theme; the design may merge them. Waits must not prevent owner steering, and full
asynchronous tool calling lets the agent keep working and receive messages while tool calls continue.

### CODEX-CHANGELOG

Blocked by: none; queue after NONBLOCKING-WAITS and ASYNC-TOOL-CALLING. Read the changelog and source through GitHub
via git, so this research does not use the web-search CLI.

### AGENT-STRUCTURE-RESEARCH

Blocked by: none; the phase 1 macOS repo-local WEB-SEARCH CLI is delivered into main.

### New UI and small near-ready merges

Blocked by: none beyond the prerequisites below.
New UI still requires U12 registration, followed by U13 end-to-end proof. Small near-ready merges are the
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

## Asynchronous-tool research sources

Owner (`16-27-59:4937`, entry `a8684155`), exact spans:

> «Также добавь в список задач, что нам нужно сделать реализацию асинхронного tool calling, как в Codecs CLI, чтобы агент мог вызывать tool call и при этом асинхронно полностью работать, принимать от меня сообщения и не обрываться на этом.»

> «Изучение это давно уже реализовали. И вообще отдельные задачи надо по changelog за последние полгода пройтись и подобрать охуенные реализации, которые мы можем себе спиздить в наш Pi.»

## Todo list with compact panel above the input

Deferred until the current UI changes land (P5/P10/P11). Not authorised for implementation. Open choices named in the text: skill name and activation duration; three-line layout with sub-steps; expand method and depth; behaviour on blocker, wait or cancel.

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
