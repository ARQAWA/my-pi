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
Only the current queue below is runnable. Independent executors may work in parallel under
[PROCESS.md](PROCESS.md#isolated-parallel-execution), one branch and worktree per task.
Owner (`16-27-59:6573`): «Давай дальше выполняй по пять задач параллельно за раз».
The later branch rule (`16-27-59:13774`): «В любом случае для каждой задачи нужно делать отдельную ветку.»
The conserved old queue is evidence for
later item-by-item review, not an alternate execution lane. Completed work is never queued again.
Every newly added task goes immediately before `OLD-QUEUE-REVIEW`. The reminder stays permanently last until the old
queue is empty; it remains or reappears last whenever anything remains. Conserved branches, worktrees, drafts, issues,
evidence, dependencies and CI state are not physically deleted by the reset.

## Current queue

| # | ID and approved work | Status, branch and dependencies | Source |
| --- | --- | --- | --- |
| 8 | <a id="composer-predictions"></a>COMPOSER-PREDICTIONS: gray next-message suggestion in the empty input, Tab accepts. | QUEUED; implementation must be discussed before code. The [draft reference](file:///Users/arkadijcukavin/ai-project/my-pi-evidence/composer-predictions/DRAFT-TZ.md) is discussion material, not an agreed specification. | Owner line 13428; original request: «Эту хуйню в soft complete надо добавить в задачу, но обсудить, как она будет у нас имплементирована. Это просто рандомный агент написал текст задачи. Это не сама задача, это на подумать.» |
| 9 | <a id="agent-states-ui"></a>AGENT-STATES-UI and <a id="u14"></a><a id="todo-panel"></a>U14 / TODO-PANEL: retain the agent-list states and the todo working-memory/panel requirements with all existing design questions. | QUEUED; no implementation branch. Existing requirements and unresolved design choices remain in [current design details](#current-design-details). | Owner line 13422 explicitly keeps Agent list, todo panel; earlier owner sources below. |
| 10 | <a id="a01"></a>A01: remaining scoped Codex-style child capabilities: parent-history fork and MCP, for later design. | QUEUED; no blanket Codex CLI parity and no implementation before design. Durable resume and child web access are already delivered and are not queued again. | Owner line 13422 keeps new Codex capabilities; Backlog A01 and [RQW-agent persistence](extensions/RQW-agent/README.md#persistence-and-resume). |
| 11 | <a id="copy-measure"></a>COPY-MEASURE: on or after 2026-11-01 re-run the `my-pi-evidence/designs/copy-not-retype/measure` script and compare with the baseline; report to the owner. | QUEUED; no branch. Checks whether agents follow the copy-not-retype rule in `SYSTEM.md`. | Owner: «Надо понять, как мы это потом проверим, замерим через два-три дня работы, допустим»; [D-PROMPT-COPY-NOT-RETYPE](DECISIONS.md). |
| 12 | <a id="old-queue-review"></a>OLD-QUEUE-REVIEW: review every conserved old-queue item after all other current work is done. | PERMANENTLY LAST while the old queue is nonempty. New tasks always insert before this row. Remove only when the old queue is empty; otherwise retain/reappend last. Never resurrect completed work. | Owner line 13441, entry `59a789ef`; [D-PIPELINE-QUEUE-RESET](DECISIONS.md). |

### Research pocket: after the plan and its execution

**Not current work.** These investigations start immediately after the plan is written **and executed**, not merely
after it is saved. They are outside both queues, do not move OLD-QUEUE-REVIEW earlier, authorize no runtime changes
and permit no settings or auth edits during research. Quotes are verbatim from the owner text supplied on
2026-10-27; ellipses in the quotations denote unavailable text, not reconstructed wording.

- **RP2 — Huge agent blocks: the remaining non-result notifications.** Owner supplied historical wording: «в старых задачах была задача на то, чтобы убрать огромные, монструозные ответы от агентов синего цвета … это важно тоже для меня. Это такие мысли на будущие задачи». Resolved historical link: the purple cards. Delivered results already have cards (`66c154c`); what remains is `child_wait` without a result. Merge this with D2/Q2: investigate once, then ask for the one-line card and fragment-only wake change. **Still needs the owner's yes before implementation.** Docs only, no Pi install; conditional files and tests are in D2.
- **RP3 — Instant message display and planning status.** Owner: «У меня бывает такое, что я отправляю сообщение для Claude, для Codex или для Kimi, и оно подвисает на несколько секунд. … Хотя оно должно выглядеть моментально: что моментально появилось сообщение, моментально пошло planning next moves, а под капотом оно всё работает уже само. Не должно быть этой синхронизации интерфейса с under the hood обработками, процессингом.» Investigate submit-to-visible-message and submit-to-working-status separately from model latency. Docs only, no Pi install during research.

## Conserved old queue

These items are conserved for item-by-item review only after every current queue item above is complete. They are not
resumed by old priorities, branch readiness, CI state or earlier deferral exceptions. No conserved artifact is deleted
by this documentation change.

### Conserved prepared branches and evidence

| ID | Conserved state | Source |
| --- | --- | --- |
| WAIT-RESULT-METADATA | Branch `fix-agent-wait-result-metadata`, head `e0aaa0aed4f5db25a6c1b7bb495b23e8dea80511`, existing worktree. Prepared wait metadata remains unmerged and is not current work. | Owner conservation order; branch and worktree evidence. |

### Conserved active and near queue

These former active and near-queue items are conserved, not runnable. Their branch, evidence and dependency states
remain unchanged until OLD-QUEUE-REVIEW. Current approved tasks may run in isolated parallel worktrees.

| ID | Work | Status/branch | Source |
| --- | --- | --- | --- |
| <a id="u13"></a>U13 / U18 | Remaining physical-terminal appearance verification only: actual display/font rendering and perceived animation smoothness. | Physical checks NOT PERFORMED; no implementation branch. Automated P11/U13 scope is delivered; this does not resume unrelated held UI work. | Backlog U13/U18; handoff 30/49-50/100; completeness 55; UI execution brief P11 T19 and evidence limits G8; explicit P11 resumption. |
| <a id="extension-audits"></a>EXTENSION-AUDITS | Full independent re-check of each listed implemented extension, one queued task each; criteria and simplest-first reference task list below. | CONSERVED, NOT STARTED by owner current queue correction, 2026-10-25. After small near-ready merges, preserving remaining prerequisites below; fix tasks follow audits; auditor never fixes. | Owner `16-27-59:4864/4868/4872/4892`, entries `c7934716`, `6e47c19b`, `249fcb3b`, `40d49370`. |

### Conserved Windows CI queue

These genuine existing Windows CI failures are CONSERVED in the old queue, not a separate lane. Every item has the direct owner Windows-test instruction quoted below and the later owner
corrections above. All evidence and unresolved causes
are retained; triage, proven-cause, no-skip/no-weakening and real CI proof rules apply. No Windows work starts during
the current policy task.

| ID | Work | Status/branch | Source |
| --- | --- | --- | --- |
| <a id="windows-test-failures"></a>WINDOWS-TEST-FAILURES | Umbrella for every Windows test failure ignored by the merge gate, so Windows support is finished later. New ignored failures are added here ([PROCESS.md](PROCESS.md)); fixes follow the triage and proof rules of [PROCESS.md](PROCESS.md), real fixes and not skips. Known now, all causes unresolved unless stated; existing canonical entries are linked, not duplicated: (8) Branch `agent-async` head `62bb752`, [run 40072884531](https://github.com/ARQAWA/my-pi/actions/runs/40072884531): all three Windows jobs red, [windows-portable-git (node 22.19.0), job 120809934531](https://github.com/ARQAWA/my-pi/actions/runs/40072884531/job/120809934531), [test (windows-latest, node 24), job 120809934791](https://github.com/ARQAWA/my-pi/actions/runs/40072884531/job/120809934791), [test (windows-latest, node 22.19.0), job 120809934836](https://github.com/ARQAWA/my-pi/actions/runs/40072884531/job/120809934836); evidence `/tmp/train-agent-async-jobs.json`. Earlier `agent-async` runs, same recorded failure set in each: the three Windows jobs (node 22.19.0, node 24, PortableGit node 22.19.0) and both macOS test jobs failed; failure log signatures of these runs were not inspected, so no grouping by signature is claimed; evidence `/tmp/train-agent-async-earlier-jobs.json`: [run 40070314137](https://github.com/ARQAWA/my-pi/actions/runs/40070314137) (Windows: [win node 22.19.0, job 120802139486](https://github.com/ARQAWA/my-pi/actions/runs/40070314137/job/120802139486), [win node 24, job 120802139501](https://github.com/ARQAWA/my-pi/actions/runs/40070314137/job/120802139501), [PortableGit node 22.19.0, job 120802139492](https://github.com/ARQAWA/my-pi/actions/runs/40070314137/job/120802139492)); [run 40067206370](https://github.com/ARQAWA/my-pi/actions/runs/40067206370) (Windows: [win node 22.19.0, job 120792850229](https://github.com/ARQAWA/my-pi/actions/runs/40067206370/job/120792850229), [win node 24, job 120792850214](https://github.com/ARQAWA/my-pi/actions/runs/40067206370/job/120792850214), [PortableGit node 22.19.0, job 120792850140](https://github.com/ARQAWA/my-pi/actions/runs/40067206370/job/120792850140)); [run 40066540479](https://github.com/ARQAWA/my-pi/actions/runs/40066540479) (Windows: [win node 22.19.0, job 120790879491](https://github.com/ARQAWA/my-pi/actions/runs/40066540479/job/120790879491), [win node 24, job 120790879424](https://github.com/ARQAWA/my-pi/actions/runs/40066540479/job/120790879424), [PortableGit node 22.19.0, job 120790879447](https://github.com/ARQAWA/my-pi/actions/runs/40066540479/job/120790879447)); [run 40065744954](https://github.com/ARQAWA/my-pi/actions/runs/40065744954) (Windows: [win node 22.19.0, job 120788507595](https://github.com/ARQAWA/my-pi/actions/runs/40065744954/job/120788507595), [win node 24, job 120788507480](https://github.com/ARQAWA/my-pi/actions/runs/40065744954/job/120788507480), [PortableGit node 22.19.0, job 120788507278](https://github.com/ARQAWA/my-pi/actions/runs/40065744954/job/120788507278)); [run 40064495413](https://github.com/ARQAWA/my-pi/actions/runs/40064495413) (Windows: [win node 22.19.0, job 120784785702](https://github.com/ARQAWA/my-pi/actions/runs/40064495413/job/120784785702), [win node 24, job 120784785680](https://github.com/ARQAWA/my-pi/actions/runs/40064495413/job/120784785680), [PortableGit node 22.19.0, job 120784785698](https://github.com/ARQAWA/my-pi/actions/runs/40064495413/job/120784785698)); [run 40063661836](https://github.com/ARQAWA/my-pi/actions/runs/40063661836) (Windows: [win node 22.19.0, job 120782272943](https://github.com/ARQAWA/my-pi/actions/runs/40063661836/job/120782272943), [win node 24, job 120782272993](https://github.com/ARQAWA/my-pi/actions/runs/40063661836/job/120782272993), [PortableGit node 22.19.0, job 120782272869](https://github.com/ARQAWA/my-pi/actions/runs/40063661836/job/120782272869)). None is accepted merge evidence. Cause not established for any of them, no fix claimed. (9) `compaction-sheen` head `b1896ed`, [run 40075629129](https://github.com/ARQAWA/my-pi/actions/runs/40075629129): [test (windows-latest, node 24), job 120818227098](https://github.com/ARQAWA/my-pi/actions/runs/40075629129/job/120818227098) failed; both macOS jobs passed. Evidence `/tmp/sheen-final-jobs.json`; cause not inspected or established, no fix claimed. Later head `2c4d26e`, [run 40077061859](https://github.com/ARQAWA/my-pi/actions/runs/40077061859): [test (windows-latest, node 22.19.0), job 120822590855](https://github.com/ARQAWA/my-pi/actions/runs/40077061859/job/120822590855) failed; both macOS jobs passed. Evidence `/tmp/sheen-2c4-jobs.json`; cause not inspected or established, no fix claimed. Head `8b73101`, [run 40078355014](https://github.com/ARQAWA/my-pi/actions/runs/40078355014): only [test (windows-latest, node 22.19.0), job 120826483009](https://github.com/ARQAWA/my-pi/actions/runs/40078355014/job/120826483009) failed; all other jobs, including both macOS jobs, passed. Evidence `/tmp/sheen-8b-jobs.json`; cause not established, no fix claimed. Later head `dfc9be2`, [run 40082629878](https://github.com/ARQAWA/my-pi/actions/runs/40082629878): [test (windows-latest, node 22.19.0), job 120839135023](https://github.com/ARQAWA/my-pi/actions/runs/40082629878/job/120839135023) failed; the required macOS jobs were green. Evidence `/tmp/train-compaction-gate.log`; cause unknown, no fix claimed. Head `f0eb861`, [run 40084189694](https://github.com/ARQAWA/my-pi/actions/runs/40084189694): the macOS jobs and all Windows jobs passed, so no Windows failure is observed on this head. (11) Final delivery bookkeeping, evidence `/tmp/merge-final-windows-evidence.json`, finished-run jobs; no cause or signature inferred here, no fix claimed. Branch `agent-async`, runs where the same three Windows jobs failed (`test (windows-latest, node 22.19.0)`, `test (windows-latest, node 24)`, `windows-portable-git (node 22.19.0)`): [40088381679](https://github.com/ARQAWA/my-pi/actions/runs/40088381679) (head `3710c3c`), [40087549694](https://github.com/ARQAWA/my-pi/actions/runs/40087549694) (head `0e3961e`), [40086580163](https://github.com/ARQAWA/my-pi/actions/runs/40086580163) (head `e849ff4`), [40084177463](https://github.com/ARQAWA/my-pi/actions/runs/40084177463) (head `9966068`), [40081590533](https://github.com/ARQAWA/my-pi/actions/runs/40081590533) (head `7a0d5e0`), [40079446756](https://github.com/ARQAWA/my-pi/actions/runs/40079446756) (head `377ed74`), [40077841447](https://github.com/ARQAWA/my-pi/actions/runs/40077841447) (head `de537fd`). The final exact head `3710c3c` of run 40088381679 had all macOS jobs green by the fresh gate `/tmp/train-agent-async-gate.log`, and these Windows jobs red: [test (windows-latest, node 22.19.0), job 120855851237](https://github.com/ARQAWA/my-pi/actions/runs/40088381679/job/120855851237), [windows-portable-git (node 22.19.0), job 120855851281](https://github.com/ARQAWA/my-pi/actions/runs/40088381679/job/120855851281), [test (windows-latest, node 24), job 120855851323](https://github.com/ARQAWA/my-pi/actions/runs/40088381679/job/120855851323). The older [40077802439](https://github.com/ARQAWA/my-pi/actions/runs/40077802439) (head `cfb53b5`) also failed both macOS test jobs besides the same three Windows jobs; it is not merge evidence, since the latest exact head had all macOS jobs green. Branch `qa-status-ack`, only `test (windows-latest, node 22.19.0)` failed: [40078282713](https://github.com/ARQAWA/my-pi/actions/runs/40078282713) (head `48e6a7f`, job 120826275809) and [40081633542](https://github.com/ARQAWA/my-pi/actions/runs/40081633542) (head `38d0384`, job 120836225307); the later final `qa-status-ack` run succeeded on all Windows jobs, which neither fixes nor explains the cause of these two old failures. | CONSERVED in the old queue for unresolved nonduplicate Windows CI failures; not runnable before OLD-QUEUE-REVIEW. No fixes started in this policy task. Triage retained evidence first; later-green or delivered fixes are not reimplemented. Real Windows, PortableGit and Bun checks are mechanical verification inside this owner-ordered work, not standalone tasks. Sources are coordinator reports of the session, not owner words. | Owner `16-27-59:5309`, entry `1bbe27c1`: «нужно все косяки Windows-тестов в конец бэклога засунуть, чтобы он их потом фиксил, чтобы они не были заброшены, чтобы Windows тоже поддерживалась, доводилась до конца.» Coordinator text `16-27-59:5312` (the list) and `5310` (the brief to the agents). Historical Windows CI evidence; current checks follow [PROCESS.md](PROCESS.md). |

### Conserved waiting for owner

These pre-reset requests remain DEFERRED / ON HOLD in the conserved old queue until OLD-QUEUE-REVIEW.

| ID | Work | Status/branch | Source |
| --- | --- | --- | --- |
| <a id="vdi-update"></a>VDI-UPDATE | Confirm whether the owner has completed the requested PCLI package update on the VDI. | DEFERRED / ON HOLD by owner, awaiting owner confirmation of completion, not a claim that installation is still pending; no branch. Publication is complete and is not an open task. Not the removed VDI wheel-check task. | Coordinator record of the approved release-then-VDI-update sequence in DECISIONS PCLI; AUDIT section 5 and `parts/decisions-C.md` one-off update entry. |

### Conserved deferred items

Every row below is conserved outside the current queue until OLD-QUEUE-REVIEW. Earlier task-specific deferrals and
prerequisite constraints remain evidence; prerequisite delivery never starts a held task.

| ID | Work | Status/branch | Source |
| --- | --- | --- | --- |
| <a id="publish-skill"></a>PUBLISH-SKILL | Reconcile separate commit/push permission with PROCESS; require successful publication CI on the exact packaged commit, not merely the latest green branch run, and dispatch the intended ref when needed. | DEFERRED / ON HOLD; coordinator-origin audit finding, not a newly owner-approved implementation. No branch assigned; skill edits outside this cleanup. Marketplace publishing still needs a direct owner request. Its generic hold is unchanged; no Windows verification task is resumed. | AUDIT item 15 and docs-consistency findings; `.agents/skills/publish-pcli/SKILL.md`. |
| <a id="timebox-practices"></a>TIMEBOX-PRACTICES | Remaining professional-practices research and deferred blocking paths; automatic child progress notifications are governed by [D-AGENT-PROGRESS](DECISIONS.md#agent), not open work here. Research, a record only, not started: how practising professional engineers avoid sunk cost, experiment loops, runaway cost and over-testing. Credible primary sources, found with the shipped `web` tool ([D-WEB-CLI](DECISIONS.md#web-search)). Output: a short evidence-based proposal of timeboxing, stop criteria, uncertainty spikes, cost versus information, escalation and minimal acceptance checks, adapted to this repository. Not an open-ended benchmark. Include the three remaining blocking paths deferred by the owner in the historical record, commit `5f96a70`: the shared agent operation queue with long `start`/`restart`/`resume` calls, waits inside codemode scripts, and the external print/json host path. Current execution rules: [PROCESS.md](PROCESS.md). | DEFERRED / ON HOLD by owner, no branch; do not start. Blocked by: none; the web tool is delivered. The owner has not set its place in a resumed execution order. | Owner `16-27-59:5231`, entry `ce0d83d8`: «Надо понять, как их избегать, как не попадать в такие ловушки. Надо поресёрчить, как люди с этим справляются уже — реальные программисты, реальные профессионалы. Это просто как web search работать» |
| <a id="codex-changelog"></a>CODEX-CHANGELOG | Adopt selected findings from the [Codex changelog report](../../my-pi-evidence/codex-changelog/REPORT.md). | DEFERRED / ON HOLD until the owner explicitly resumes it; no adoption or implementation queued; no branch. | Owner `16-27-59:4937`, entry `a8684155`; report linked here. |
| <a id="i05"></a>I05 | `custom`, `define-goal` and work orders. Task list is [U14](#u14). | DEFERRED / ON HOLD, coordinator record of owner deferral; no authenticated quote supplied. Not abolished; no new implementation permission or branch. | Backlog I05; active `D-SCOPE-POSTPONED`; DECISIONS Scope postponed-items entry. |

### Conserved reference order and dependencies

This is a DEFERRED REFERENCE ORDER, not the current execution queue. All pre-reset nodes remain conserved
in the old queue. This tree resumes no tasks before OLD-QUEUE-REVIEW. Detailed design still
follows Research and agreement. The shipped web tool is delivered ([D-WEB-CLI](DECISIONS.md#web-search)); the waits and async-tool work is delivered ([D-TOOLS-NOTIFY](DECISIONS.md#tools)). CODEX-CHANGELOG adoption remains on hold until explicitly resumed.
Architecture/index choices are recorded in [D-WORK-REPO-INDEX](DECISIONS.md#work-policy).
Their delivery does not start queued audits or fixes. Remaining dependencies never authorize automatic starts.

```text
DEFERRED REFERENCE ONLY - NOT RUNNABLE
New UI
Small near-ready merges
CODEX-CHANGELOG adoption (DEFERRED until the owner asks; not in the queue)
New UI + Small near-ready merges
`- Per-extension audits (queued, not started)
   `- Audit fix tasks (after audits)
WINDOWS-TEST-FAILURES (conserved old-queue order)
```

### CODEX-CHANGELOG

Adoption of findings from the [report](../../my-pi-evidence/codex-changelog/REPORT.md) is DEFERRED / ON HOLD until explicitly resumed by the owner; no implementation is queued. Blocked by: none.

### New UI and small near-ready merges

Other retained work remains DEFERRED / ON HOLD in the conserved old queue until OLD-QUEUE-REVIEW.

Blocked by: none beyond the prerequisites below.
Small near-ready merges are the existing task branches named in the handoff, not permission to invent new work.

### EXTENSION-AUDITS and every audit fix task

CONSERVED, NOT STARTED. Completing the prerequisites below never starts this work automatically.

Blocked by: remaining small near-ready merges and the Codex-live-check and UI-enable prerequisites below.
Architecture/index delivery alone does not start any audit or audit fix.

Verbatim owner background-wait proposal from the same message:

> «Также я что хочу? У нас есть всякие механики, ожидания и прочее. Я хочу, чтобы когда у нас агент ждёт ответов от саб-агентов, wait, всякие инструменты и прочее, чтобы они не висели как исполняемый процесс. Допустим, он когда ждёт, я могу нормально переписываться с агентом, и я не буду обрывать этот wait инструмент его. Чтобы wait инструмент был в background фоне, и он прислал нотификацию агенту, будил его. Это, по-моему, очень очевидная простая механика, но она не реализована. Я, по крайней мере, не видел. Я хочу, чтобы такие штуки, когда что-то висит на ожидании, чтобы оно висело всегда сразу же в фоне, в background, и агент ставил нотификацию и ожидал нотификации, и я мог с ним общаться, не обрывая эти фоновые штуки. Понимаешь, о чём я? Чтобы когда я пишу какое-нибудь сообщение, steering делаю агенту, чтобы его tool call не обрывались нахуй. Я не знаю, как это правильно сформулировать. Чтобы какие-то tool call обрывались, а какие-то нет. Типа того.»

<a id="independent-extension-audits"></a>
### Old independent extension audits

EXTENSION-AUDITS contains one queued task per extension listed below. Do not start audits yet.
Resulting fix work follows audits. Remaining prerequisites do not authorize an automatic start.
For each audit, independently re-check all delivered work against its original task: the owner's requests and
`DECISIONS.md`. Thoroughly hunt bugs, rerun relevant tests, assess how to strengthen them and identify implementation
weak spots. Also check a minimal solution, minimal code and no garbage, under PROCESS Code quality.
The auditor only finds and describes defects; it fixes nothing. On completion, replace its audit task with one fix
task per defect after the audits. Audits still follow small near-ready merges and the remaining live-check
prerequisites below. The owner's local-Pi verification is not resumed by this correction.

Conserved tasks, not started, simplest to most complex; one-line ordering rationale uses source size and coupling, not test counts:

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
13. `RQW-tools`: large base-tool wrappers, background jobs and ordering barrier used by ordinary agents, including reviewer profiles.
14. `RQW-agent`: large recursive-session lifecycle with settings, tool and profile event contracts.

Conditional conserved tasks, not started, use the same simplest-first order only after their prerequisites, reassessed against delivered code:

1. `RQW-theme`: after UI enablement; data-only theme, insert before the small code extensions.
2. `RQW-naming`: after UI enablement; small naming modules with model calls, insert near the small session features.
3. `RQW-agent-ui`: after UI enablement; cards consume agent lifecycle data, including reviewer-profile results, place by delivered size and coupling.
4. `RQW-tool-ui`: after UI enablement; sizeable tool rendering integration, insert near statusbar.
5. `RQW-codex`: after merge and the owner's live check; the large multi-module transport candidate suggests last,
   reassess its merged size and coupling before inserting.

Verbatim owner request, `16-27-59:4864`, entry `c7934716`:

> «Я хочу, чтобы ты добавил в бэклог, чтобы ты навешал на каждый уже существующий установленный extension, созданный в нашем репозитории, задачу полной независимой перепроверки всей проделанной работы, тщательного поиска багов, перезапуска тестов, проверки, как можно тесты усилить, и есть ли какие-то слабые места, которые были пропущены при реализации. Такой аудит каждого extension, который уже сейчас реализован. И ты их поставь в очередь. Предложи клиент поставить эти задачи в очередь.»

Verbatim owner order and fix policy, `16-27-59:4868`, entry `6e47c19b`:

> «Порядок обратный: сначала самые простые, а потом самые сложные. От простых к сложным пойдём. Теперь место в очереди. Да. После мелких слияний, перед нестабильными тестами. Всё правильно. Аудитор находит ошибки и добавляет в конец очереди задачи на исправление. Аудитор только всё находит, дефицирует и ставит вместо себя задачу на доработку, на исправление. Но при этом надо строго проверить, что именно с первоначальной задачей всё соответствует и всё сделано пиздато.»

Verbatim owner quality and architecture/research/index source, `16-27-59:4872`, entry `249fcb3b`:

> «Чтобы было минималистичное решение, минимальный код написан, чтобы не было никакого мусора.»
> «Также можно добавить задачу на пересборку архитектуры, чтобы мы развели сами extension и их тесты. Мы тесты выведем в отдельную папку, и там будет дублирующее дерево extension, чтобы у нас сами по себе extension тесты в себе не несли, грубо говоря. И таким образом закрепим это внутри нашего репозитория.»
> «Но так как всей хуйнёй занимается AI-agent, то надо поискать практики именно на этом языке программирования, которые лучше всего поддерживаются AI-agent, и провести research на тему того, как эффективнее всего организовывать код таким образом, чтобы AI-agent суперэффективно его поддерживал и дорабатывал. И надо сделать базу знаний в виде markdown-файлов, которую агент будет вести постоянно, и она будет консистентна с нашим репозиторием, а именно базу знаний скелетную по нашему репозиторию, чтобы агент мог быстро её прочитать и по ней быстро понять, где что искать. Без grep, без find, а просто прочёл указатель индексов, прочёл какие-то группы папок, где что лежит, максимально быстро, просто, эффективно. Он понял, в каких папках что лежит, где что искать. У каждого extension должна быть идентичная схожая структура фреймворка. Надо сделать какой-то research и улучшить архитектуру именно папок, файлов, чтобы она была заточена под агентов, чтобы агенты суперэффективно, быстро и легко дорабатывали всю эту историю. Это суперкритически важно.»

### Old queue corrections and research sources

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

<a id="asynchronous-tool-research-sources"></a>
### Old asynchronous-tool research sources

Owner (`16-27-59:4937`, entry `a8684155`), exact spans:

> «Также добавь в список задач, что нам нужно сделать реализацию асинхронного tool calling, как в Codecs CLI, чтобы агент мог вызывать tool call и при этом асинхронно полностью работать, принимать от меня сообщения и не обрываться на этом.»

> «Изучение это давно уже реализовали. И вообще отдельные задачи надо по changelog за последние полгода пройтись и подобрать охуенные реализации, которые мы можем себе спиздить в наш Pi.»

## Current design details

### AGENT-STATES-UI details

Agent-list and card-state work is current queue item 9, with no implementation branch. Preserve the working, waiting
and fully idle or AFK distinction. A fully idle or AFK agent with no pending waits must never look active or waiting.
Reviewer profiles are ordinary agents, not a separate category; no worker category exists. Statusbar completion does
not resume other held UI work. Its waiting contract is delivered in [D-STATUSBAR-WAITS](DECISIONS.md#status-bar), not
queued again.

Owner sources in session `2026-10-21T16-27-59-062Z_01a15f4a-7ad5-7377-81be-0baf3b6ffa33.jsonl`:
`16-27-59:5085`, entry `04f64a5e`: «Если у нас какие-то агенты в афк стоят, то они не должны отображаться, как будто они рабочие и их ожидание происходит.»
`16-27-59:5087`, entry `ddd0ce47`: «И да, интерфейс должен разключать, когда агент стоит, когда он AFK, когда он работает.»
`16-27-59:6301`, entry `a8793e4c`: «строка статуса должна отражать все фоновые ожидания. Не только саб-агентов, которые работают, но и если саб-агент ожидает какой-то фоновый процесс, они тоже должны отображаться в строке статусов».
`16-27-59:6305`, entry `217beed6`: «Если агент think-ает основной, что-то делает, то это отражается в статусе. Если же он ничего не делает, но он ожидает саб-агентов какие-то, background процессы, это тоже должно отражаться. Есть саб-агенты, а есть background процессы. Worker там быть не должно, мы вообще worker удалили.»

## U14 details

U14 owns this complete todo-list and panel specification as current queue item 9. Existing prerequisites and design questions remain; implementation still requires the agreed design. Open choices named in the text: skill name and activation duration; three-line layout with sub-steps; expand method and depth; behaviour on blocker, wait or cancel.

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
