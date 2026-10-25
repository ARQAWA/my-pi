# Open and deferred work

This is the canonical task list. Keep source, status and branch with every item. Remove completed tasks;
move owner-discarded tasks to [Discarded](#discarded), outside open work and the execution queue.
Git and `DECISIONS-ARCHIVE.md` preserve other task history. Accepted limits and unverified live behavior stay in
`DECISIONS.md` or their research note unless there is actual remaining work.

Sources: docs-cleanup `AUDIT.md` section 5 and `parts/backlog.md`, outside the repository under
`/Users/arkadijcukavin/ai-project/my-pi-evidence/docs-cleanup/`. IDs below remain stable. `handoff` and `completeness`
mean the source documents identified by that audit. Branch status is the audited snapshot at `30952e6`, not a
claim that remote state has since been revalidated. Explicit later integration status takes precedence over that
snapshot. Descriptions are coordinator summaries unless explicitly marked as verbatim owner quotations.
Deferred rows explicitly identify coordinator records of deferral where no authenticated verbatim owner message
is supplied.

Owner queue reset (`16-27-59:6102`, entry `ca0e7e7e`):
«И паралельно по 2 задачи очередь новая с нуля старые все в бэклог и холде».
Source: `2026-10-21T16-27-59-062Z_01a15f4a-7ad5-7377-81be-0baf3b6ffa33.jsonl`, in the owner session directory
named below. All pre-reset tasks are DEFERRED / ON HOLD outside the execution queue until the owner explicitly
resumes each task. Requirements, sources, retained branches and dependencies are preserved. A delivered prerequisite
or an old due date never lifts the hold. The current parallel cap is governed by
[PROCESS.md](PROCESS.md#isolated-parallel-execution), not the earlier number in this reset quotation.

## Windows advisory follow-ups

New post-reset failures stay at the tail of the test-lane backlog under [PROCESS.md](PROCESS.md#task-pipeline).
These are follow-up records, not fixes or a resumption of the held pre-reset investigations below.

<a id="qa-flakes-last"></a>Background-test flake, `qa-inbox` [issue #3](https://github.com/ARQAWA/my-pi/issues/3): the causal fix is on `main` as commit `2b9c088` (`QA: #3`). Issue #3 stays OPEN only for scheduled-run monitoring: it closes when at least max(6, ceil(3/p)) scheduled `main` runs after that commit are green ([PROCESS.md](PROCESS.md#quality-control-loop)); nothing else is left to do. The duplicates [#4](https://github.com/ARQAWA/my-pi/issues/4) and [#5](https://github.com/ARQAWA/my-pi/issues/5) are already closed (`gh issue view`, closedAt 2026-10-23T23:58Z). No branch, no queue slot.

Windows advisory follow-up for WINDOWS-TEST-FAILURES: pre-rebase `fix/web-cli-setup` head `5f607a8`, completed failed run
[40075615612](https://github.com/ARQAWA/my-pi/actions/runs/40075615612), step `Tests in a path with spaces and Cyrillic`, node 22.19.0 job. Two `RQW-codex real CLI [Node bundle]` tests of `extensions/RQW-codex/test/cli.test.ts` failed with exit `null` after the 30 s kill, stdout already `CLI CODEX OK`, empty stderr. Unclassified, cause not found. The same tests passed in [run 40076417175](https://github.com/ARQAWA/my-pi/actions/runs/40076417175) on the rebased branch and in the Windows jobs of [run 40083405523](https://github.com/ARQAWA/my-pi/actions/runs/40083405523), and [codemode-stress run 40084782574](https://github.com/ARQAWA/my-pi/actions/runs/40084782574) (pattern `RQW-codex real CLI`, windows-latest, node 22.19.0) gave 0 failures in 30 runs; the failure rate before is unknown, so 0/30 is no proof of absence. Investigation DEFERRED / ON HOLD with the [umbrella entry](#windows-test-failures), outside the execution queue until explicitly resumed; a recurrence also opens a `qa-inbox` issue. Coordinator record, not owner words.

Windows advisory follow-up for WINDOWS-TEST-FAILURES, subagent profiles: runtime head
`33603edc40dd120e59ab857c2f42c9d6caef5b05`, completed `tests.yml`
[run 40129717626](https://github.com/ARQAWA/my-pi/actions/runs/40129717626).
Both macOS jobs, Node 22.19.0 and 24, passed. The Windows jobs failed:
[Node 22.19.0, job 120978637407](https://github.com/ARQAWA/my-pi/actions/runs/40129717626/job/120978637407),
[Node 24, job 120978637326](https://github.com/ARQAWA/my-pi/actions/runs/40129717626/job/120978637326), and
[PortableGit, job 120978637348](https://github.com/ARQAWA/my-pi/actions/runs/40129717626/job/120978637348).
Each has exactly two new assertion failures. `extensions/RQW-agent/test/profiles.test.ts:366` hashes the unchanged
original Bossy fixture: expected SHA-256 `6a1cb141944e448fcf1f3f6cf02fda02ab82c6c6fa606762114021efc6e40961`,
actual `5df59458a41ee6378874ba6871e543f3fc94abb2a7403b7b3536f3a3987ad8aa`.
The locally computed CRLF version matches the CI actual hash, establishing checkout line-ending conversion as the
cause of this byte mismatch. `extensions/RQW-review/test/profiles.test.ts:51` uses an LF-only regular expression
that rejects the actual CRLF skill header, a test assumption rather than a skill-semantics failure.
No product parser error was observed. Evidence: `/tmp/subagent-profiles-ci-windows22-failed.log`,
`/tmp/subagent-profiles-ci-windows24-failed.log`, `/tmp/subagent-profiles-ci-windows-portable-failed.log` and
`/tmp/subagent-profiles-windows-triage.log`. These are not the earlier issues
[#6](https://github.com/ARQAWA/my-pi/issues/6) and [#7](https://github.com/ARQAWA/my-pi/issues/7), whose fixes are
in inherited `main` commit `435cafd`. OPEN at the tail of the test-lane queue, no fix branch; nothing fixed here.
Future fixes must preserve the original-fixture byte check and skill semantics, without skips or weakened assertions.
Advisory Windows failures are recorded, not fixed before this merge, under [PROCESS.md](PROCESS.md#task-pipeline).
Run state and triage are coordinator evidence, not owner quotations.

## Open tasks

| ID | Work | Status/branch | Source |
| --- | --- | --- | --- |
| <a id="composer-predictions"></a>COMPOSER-PREDICTIONS | Next-prompt prediction: Codex-style suggestion of the next user message as gray text in the empty input; Tab accepts. Discuss implementation with the owner before any design or code. The [draft reference](file:///Users/arkadijcukavin/ai-project/my-pi-evidence/composer-predictions/DRAFT-TZ.md) is material for discussion only, not an agreed specification. | OPEN; awaiting discussion with the owner; no implementation branch. | Owner: «Эту хуйню в soft complete надо добавить в задачу, но обсудить, как она будет у нас имплементирована. Это просто рандомный агент написал текст задачи. Это не сама задача, это на подумать.» |

## Waiting for owner

These pre-reset requests are also DEFERRED / ON HOLD outside the execution queue until explicitly resumed.

| ID | Work | Status/branch | Source |
| --- | --- | --- | --- |
| <a id="vdi-update"></a>VDI-UPDATE | Confirm whether the owner has completed the requested PCLI package update on the VDI. | DEFERRED / ON HOLD by owner, awaiting owner confirmation of completion, not a claim that installation is still pending; no branch. Publication is complete and is not an open task. Not the removed VDI wheel-check task. | Coordinator record of the approved release-then-VDI-update sequence in DECISIONS PCLI; AUDIT section 5 and `parts/decisions-C.md` one-off update entry. |

## Deferred by owner

Every row below is outside the execution queue until explicitly resumed by the owner. Earlier task-specific
deferrals and all prerequisite constraints still apply; prerequisite delivery never starts a held task.

| ID | Work | Status/branch | Source |
| --- | --- | --- | --- |
| <a id="u13"></a>U13 | Real-Pi scripted faux-provider end-to-end tests for tool-ui, thinking hiding, activity indicator and cards; composition, load order and remaining physical-terminal appearance checks from U18. | DEFERRED / ON HOLD by owner; no P11 branch assigned; registration and cards are delivered. Isolated tests do not prove composition. | Backlog U13/U18; handoff 30/49-50/100; completeness 55; UI execution brief P11 T19. |
| <a id="extension-audits"></a>EXTENSION-AUDITS | Full independent re-check of each listed implemented extension, one held task each; criteria and simplest-first reference task list below. | DEFERRED / ON HOLD by owner. Reference order after small near-ready merges; architecture/index delivery does not resume held audits or fixes; auditor never fixes. | Owner `16-27-59:4864/4868/4872/4892`, entries `c7934716`, `6e47c19b`, `249fcb3b`, `40d49370`. |
| <a id="publish-skill"></a>PUBLISH-SKILL | Reconcile separate commit/push permission with PROCESS; require successful publication CI on the exact packaged commit, not merely the latest green branch run, and dispatch the intended ref when needed. | DEFERRED / ON HOLD by owner, no branch assigned; skill edits outside this cleanup. Marketplace publishing still needs a direct owner request. | AUDIT item 15 and docs-consistency findings; `.agents/skills/publish-pcli/SKILL.md`. |
| <a id="qa-inbox-followups"></a>QA-INBOX-FOLLOWUPS | Adapt the retained atomic claim helper implementation `qa-claim` at `0ab8e1a` to the shared ci-watch cache snapshot architecture. | DEFERRED / ON HOLD by owner, outside the execution queue; reference order with the small merges, NOT delivered; branch `qa-claim` retained. Requires explicit resumption, rebase and fresh required reviews before delivery. Leave the `qa-claim` branch unchanged in this integration. | Latest owner integration bookkeeping; the retained implementation does not deliver the shared-cache behavior. |
| <a id="token-efficiency-review"></a>TOKEN-EFFICIENCY-REVIEW | Follow-up review of the read cache. At the merge date plus 3 days, inspect the sessions since the merge: tokens saved, failed edits, retries. Then tune the cutoff or remove the mechanism. The coordinator reminds the owner in the first conversation after that date; it does not wake itself. | DEFERRED / ON HOLD by owner. Review and reminder timing is retained as a requirement, not an automatic trigger while held. The read cache merged into `main` from branch `unchanged-read`, built ahead of WEB-SEARCH on the owner's explicit request; the review is due at its merge date plus 3 days, planned `2026-10-27` for a merge on `2026-10-24`. The merge agent corrects the date here if the merge lands on another day. | Owner `16-27-59:5135`, entry `171f4d82`: «Мы просто это запилим, я буду с этим работать, а потом через какое-то время ты мне напомнишь, поставишь задачу» and «через три дня после merge надо будет сделать review всех старых сессий на предмет того, помогло нам это или нет. И всё. Не будем никаких делать испытаний и прочей хуйни.» Sessions since the merge, tune or remove, and the reminder rule are coordinator text (`16-27-59:5138`). |
| <a id="timebox-practices"></a>TIMEBOX-PRACTICES | Remaining professional-practices research and deferred blocking paths; automatic child progress notifications are governed by [D-AGENT-PROGRESS](DECISIONS.md#agent), not open work here. Research, a record only, not started: how practising professional engineers avoid sunk cost, experiment loops, runaway cost and over-testing. Credible primary sources, found with the shipped `web` tool ([D-WEB-CLI](DECISIONS.md#web-search)). Output: a short evidence-based proposal of timeboxing, stop criteria, uncertainty spikes, cost versus information, escalation and minimal acceptance checks, adapted to this repository. Not an open-ended benchmark. Include the three remaining blocking paths deferred by the owner in [D-TOOLS-NO-BLOCKING-FLAG](DECISIONS.md#tools), recorded by commit `5f96a70`: the shared agent operation queue with long `start`/`restart`/`resume` calls, waits inside codemode scripts, and the external print/json host path. Linked: [D-PIPELINE-TIMEBOX](DECISIONS.md#task-pipeline). | DEFERRED / ON HOLD by owner, no branch; do not start. Blocked by: none; the web tool is delivered. The owner has not set its place in a resumed execution order. | Owner `16-27-59:5231`, entry `ce0d83d8`: «Надо понять, как их избегать, как не попадать в такие ловушки. Надо поресёрчить, как люди с этим справляются уже — реальные программисты, реальные профессионалы. Это просто как web search работать» |
| <a id="codex-changelog"></a>CODEX-CHANGELOG | Adopt selected findings from the [Codex changelog report](../../my-pi-evidence/codex-changelog/REPORT.md). | DEFERRED / ON HOLD until the owner explicitly resumes it; no adoption or implementation queued; no branch. | Owner `16-27-59:4937`, entry `a8684155`; report linked here. |
| <a id="windows-test-failures"></a>WINDOWS-TEST-FAILURES | Umbrella for every Windows test failure ignored by the merge gate, so Windows support is finished later. New ignored failures are added here or as a linked `qa-inbox` issue ([PROCESS.md](PROCESS.md#task-pipeline)); fixes follow the triage and proof rules of [PROCESS.md](PROCESS.md#quality-control-loop), real fixes and not skips. Known now, all causes unresolved unless stated; existing canonical entries are linked, not duplicated: (2) Bun RPC, QA #2: [issue #2](https://github.com/ARQAWA/my-pi/issues/2), branch `qa-2-bun-rpc`; a product, test or infra cause is not proven. (8) Branch `agent-async` head `62bb752`, [run 40072884531](https://github.com/ARQAWA/my-pi/actions/runs/40072884531): all three Windows jobs red, [windows-portable-git (node 22.19.0), job 120809934531](https://github.com/ARQAWA/my-pi/actions/runs/40072884531/job/120809934531), [test (windows-latest, node 24), job 120809934791](https://github.com/ARQAWA/my-pi/actions/runs/40072884531/job/120809934791), [test (windows-latest, node 22.19.0), job 120809934836](https://github.com/ARQAWA/my-pi/actions/runs/40072884531/job/120809934836); evidence `/tmp/train-agent-async-jobs.json`. Earlier `agent-async` runs, same recorded failure set in each: the three Windows jobs (node 22.19.0, node 24, PortableGit node 22.19.0) and both macOS test jobs failed; failure log signatures of these runs were not inspected, so no grouping by signature is claimed; evidence `/tmp/train-agent-async-earlier-jobs.json`: [run 40070314137](https://github.com/ARQAWA/my-pi/actions/runs/40070314137) (Windows: [win node 22.19.0, job 120802139486](https://github.com/ARQAWA/my-pi/actions/runs/40070314137/job/120802139486), [win node 24, job 120802139501](https://github.com/ARQAWA/my-pi/actions/runs/40070314137/job/120802139501), [PortableGit node 22.19.0, job 120802139492](https://github.com/ARQAWA/my-pi/actions/runs/40070314137/job/120802139492)); [run 40067206370](https://github.com/ARQAWA/my-pi/actions/runs/40067206370) (Windows: [win node 22.19.0, job 120792850229](https://github.com/ARQAWA/my-pi/actions/runs/40067206370/job/120792850229), [win node 24, job 120792850214](https://github.com/ARQAWA/my-pi/actions/runs/40067206370/job/120792850214), [PortableGit node 22.19.0, job 120792850140](https://github.com/ARQAWA/my-pi/actions/runs/40067206370/job/120792850140)); [run 40066540479](https://github.com/ARQAWA/my-pi/actions/runs/40066540479) (Windows: [win node 22.19.0, job 120790879491](https://github.com/ARQAWA/my-pi/actions/runs/40066540479/job/120790879491), [win node 24, job 120790879424](https://github.com/ARQAWA/my-pi/actions/runs/40066540479/job/120790879424), [PortableGit node 22.19.0, job 120790879447](https://github.com/ARQAWA/my-pi/actions/runs/40066540479/job/120790879447)); [run 40065744954](https://github.com/ARQAWA/my-pi/actions/runs/40065744954) (Windows: [win node 22.19.0, job 120788507595](https://github.com/ARQAWA/my-pi/actions/runs/40065744954/job/120788507595), [win node 24, job 120788507480](https://github.com/ARQAWA/my-pi/actions/runs/40065744954/job/120788507480), [PortableGit node 22.19.0, job 120788507278](https://github.com/ARQAWA/my-pi/actions/runs/40065744954/job/120788507278)); [run 40064495413](https://github.com/ARQAWA/my-pi/actions/runs/40064495413) (Windows: [win node 22.19.0, job 120784785702](https://github.com/ARQAWA/my-pi/actions/runs/40064495413/job/120784785702), [win node 24, job 120784785680](https://github.com/ARQAWA/my-pi/actions/runs/40064495413/job/120784785680), [PortableGit node 22.19.0, job 120784785698](https://github.com/ARQAWA/my-pi/actions/runs/40064495413/job/120784785698)); [run 40063661836](https://github.com/ARQAWA/my-pi/actions/runs/40063661836) (Windows: [win node 22.19.0, job 120782272943](https://github.com/ARQAWA/my-pi/actions/runs/40063661836/job/120782272943), [win node 24, job 120782272993](https://github.com/ARQAWA/my-pi/actions/runs/40063661836/job/120782272993), [PortableGit node 22.19.0, job 120782272869](https://github.com/ARQAWA/my-pi/actions/runs/40063661836/job/120782272869)). None is accepted merge evidence. Cause not established for any of them, no fix claimed. (9) `compaction-sheen` head `b1896ed`, [run 40075629129](https://github.com/ARQAWA/my-pi/actions/runs/40075629129): [test (windows-latest, node 24), job 120818227098](https://github.com/ARQAWA/my-pi/actions/runs/40075629129/job/120818227098) failed; both macOS jobs passed. Evidence `/tmp/sheen-final-jobs.json`; cause not inspected or established, no fix claimed. Later head `2c4d26e`, [run 40077061859](https://github.com/ARQAWA/my-pi/actions/runs/40077061859): [test (windows-latest, node 22.19.0), job 120822590855](https://github.com/ARQAWA/my-pi/actions/runs/40077061859/job/120822590855) failed; both macOS jobs passed. Evidence `/tmp/sheen-2c4-jobs.json`; cause not inspected or established, no fix claimed. Head `8b73101`, [run 40078355014](https://github.com/ARQAWA/my-pi/actions/runs/40078355014): only [test (windows-latest, node 22.19.0), job 120826483009](https://github.com/ARQAWA/my-pi/actions/runs/40078355014/job/120826483009) failed; all other jobs, including both macOS jobs, passed. Evidence `/tmp/sheen-8b-jobs.json`; cause not established, no fix claimed. Later head `dfc9be2`, [run 40082629878](https://github.com/ARQAWA/my-pi/actions/runs/40082629878): [test (windows-latest, node 22.19.0), job 120839135023](https://github.com/ARQAWA/my-pi/actions/runs/40082629878/job/120839135023) failed; the required macOS jobs were green. Evidence `/tmp/train-compaction-gate.log`; cause unknown, no fix claimed. Head `f0eb861`, [run 40084189694](https://github.com/ARQAWA/my-pi/actions/runs/40084189694): the macOS jobs and all Windows jobs passed, so no Windows failure is observed on this head. (10) Windows signatures of the `agent-async` head `62bb752` run 40072884531 (log `/tmp/aa-failed.log`): besides the three tests that also failed on macOS and were fixed on the branch, two Windows-only failures remain after that fix and are not fixed here: `extensions/RQW-agent/test/persistence.test.ts:89` "owned files, directories and ancestors cannot be symlinks" (`assert.throws` expects `/Unsafe/`, while `openChildManager` safely refuses with `Child session file is outside its owned directory`; an observed diagnostic mismatch, the cause, the order of the Windows path checks, is not proven; do not weaken or skip the assertion), and `extensions/RQW-tools/test/notify.test.ts:18` hook failure `EBUSY: resource busy or locked, rmdir` of the temporary fixture directory on Windows (cleanup, cause not established). Both failed in the three Windows jobs of that run. (11) Final delivery bookkeeping, evidence `/tmp/merge-final-windows-evidence.json`, finished-run jobs; no cause or signature inferred here, no fix claimed. Branch `agent-async`, runs where the same three Windows jobs failed (`test (windows-latest, node 22.19.0)`, `test (windows-latest, node 24)`, `windows-portable-git (node 22.19.0)`): [40088381679](https://github.com/ARQAWA/my-pi/actions/runs/40088381679) (head `3710c3c`), [40087549694](https://github.com/ARQAWA/my-pi/actions/runs/40087549694) (head `0e3961e`), [40086580163](https://github.com/ARQAWA/my-pi/actions/runs/40086580163) (head `e849ff4`), [40084177463](https://github.com/ARQAWA/my-pi/actions/runs/40084177463) (head `9966068`), [40081590533](https://github.com/ARQAWA/my-pi/actions/runs/40081590533) (head `7a0d5e0`), [40079446756](https://github.com/ARQAWA/my-pi/actions/runs/40079446756) (head `377ed74`), [40077841447](https://github.com/ARQAWA/my-pi/actions/runs/40077841447) (head `de537fd`). The final exact head `3710c3c` of run 40088381679 had all macOS jobs green by the fresh gate `/tmp/train-agent-async-gate.log`, and these Windows jobs red: [test (windows-latest, node 22.19.0), job 120855851237](https://github.com/ARQAWA/my-pi/actions/runs/40088381679/job/120855851237), [windows-portable-git (node 22.19.0), job 120855851281](https://github.com/ARQAWA/my-pi/actions/runs/40088381679/job/120855851281), [test (windows-latest, node 24), job 120855851323](https://github.com/ARQAWA/my-pi/actions/runs/40088381679/job/120855851323). The older [40077802439](https://github.com/ARQAWA/my-pi/actions/runs/40077802439) (head `cfb53b5`) also failed both macOS test jobs besides the same three Windows jobs; it is not merge evidence, since the latest exact head had all macOS jobs green. Branch `qa-status-ack`, only `test (windows-latest, node 22.19.0)` failed: [40078282713](https://github.com/ARQAWA/my-pi/actions/runs/40078282713) (head `48e6a7f`, job 120826275809) and [40081633542](https://github.com/ARQAWA/my-pi/actions/runs/40081633542) (head `38d0384`, job 120836225307); the later final `qa-status-ack` run succeeded on all Windows jobs, which neither fixes nor explains the cause of these two old failures. | DEFERRED / ON HOLD by owner for the pre-reset investigations, outside the execution queue until explicitly resumed. Retain the very-end reference order for the test lane ([D-PIPELINE-TEST-LANE](DECISIONS.md#task-pipeline)); no fix branch, nothing fixed here. New post-reset Windows advisories below remain tail follow-up records under PROCESS, not a resumption of older work. Sources are coordinator reports of the session, not owner words. | Owner `16-27-59:5309`, entry `1bbe27c1`: «нужно все косяки Windows-тестов в конец бэклога засунуть, чтобы он их потом фиксил, чтобы они не были заброшены, чтобы Windows тоже поддерживалась, доводилась до конца.» Coordinator text `16-27-59:5312` (the list) and `5310` (the brief to the agents). [D-PIPELINE-MAC-GATE](DECISIONS.md#task-pipeline). |
| <a id="agent-states-ui"></a>AGENT-STATES-UI | UI agent list, cards and statusbar top border retain working, waiting and idle or AFK states. While Main is active, show its existing activity. When Main is not active but awaits work, show waits in exactly two categories: subagents and background processes. Include a subagent waiting for its own background processes or children in the subagent category. No worker category and no separate review category: a reviewer is an ordinary profile subagent. A fully idle or AFK agent with no pending waits must never look active or waiting. | DEFERRED / ON HOLD by owner; NOT STARTED, no branch. Outside the execution queue; do not auto-start after profile delivery. Prerequisite information only: subagent profiles are delivered by this change and update RQW-agent activity reporting. This is future state and status reporting, not the delivered result cards: each delivered card shows one finished or failed result, no agent list exists and the agent board remains outside the delivered UI brief. See [task details](#agent-states-ui-details). | Owner `16-27-59:5085`, entry `04f64a5e`: «Если у нас какие-то агенты в афк стоят, то они не должны отображаться, как будто они рабочие и их ожидание происходит.» and `16-27-59:5087`: «И да, интерфейс должен разключать, когда агент стоит, когда он AFK, когда он работает.» New owner requirement `16-27-59:6301`, entry `a8793e4c`: «строка статуса должна отражать все фоновые ожидания. Не только саб-агентов, которые работают, но и если саб-агент ожидает какой-то фоновый процесс, они тоже должны отображаться в строке статусов». Latest correction `16-27-59:6305`, entry `217beed6`: «Если агент think-ает основной, что-то делает, то это отражается в статусе. Если же он ничего не делает, но он ожидает саб-агентов какие-то, background процессы, это тоже должно отражаться. Есть саб-агенты, а есть background процессы. Worker там быть не должно, мы вообще worker удалили.» Hold instruction `16-27-59:6313`, entry `f148804a`: «Эта задача пока в бэклоге отложена тоже, как и все остальные». |
| <a id="u10"></a>U10 | Image paste markers `[image #N]` with unchanged stock paste mechanics. | DEFERRED / ON HOLD, coordinator record of owner deferral; no authenticated quote supplied. Not built; blocked by private editor paste, undo and deletion state; no T25 branch. | Backlog U10; handoff 99-100/115; completeness 55; UI execution brief P8 T25; external T25-gate.md. |
| <a id="u14"></a>U14 | Todo-list producer and agent working-memory list; compact three-line panel above input, sub-steps, expand, history and completion check. Open choices: skill name and activation duration; three-line layout with sub-steps; expand method and depth; behaviour on blocker, wait or cancel. Task-list overlap with I05 is owned here. [Full owner text and details](#u14-details). | DEFERRED / ON HOLD by owner: «Да давай потом, пока отложим это». Retains prerequisites in the held UI work P5/P10/P11: U05, U12, U13; not authorised for implementation; no branch. | Backlog U14/I05; handoff 103; UI execution brief section 2 item 1; DECISIONS Scope. USER entry `2026-10-21T18-16-12-433Z_01a15fad-8f91-7306-bd46-1528008fbdc6.jsonl:901`; owner message "Вот еще принес задачек запиши" in session `2026-10-21T16-27-59-062Z_01a15f4a-7ad5-7377-81be-0baf3b6ffa33.jsonl`. |
| <a id="u15"></a>U15 | A better duration-line proposal after todo work; rejected static grey line is not an open implementation task. | DEFERRED / ON HOLD; retained reference order at the end, coordinator record of owner deferral; no authenticated quote supplied; no branch. | Backlog U15; handoff 103; UI execution brief section 2 item 2. |
| <a id="a01"></a>A01 | Remaining Codex-style child capabilities: parent-history fork, web search and MCP. Durable resume is delivered, see [RQW-agent README](extensions/RQW-agent/README.md#persistence-and-resume). | DEFERRED / ON HOLD, coordinator record of owner deferral; no authenticated quote supplied. Not delivered by in-process sessions; no branch. | Backlog A01; DECISIONS Agent deferred-capabilities entry. |
| <a id="r11"></a>R11 | Reviewer checking test code against requirements and test plan, including conversation collection; distinct from repository checks reviewers may already run. | DEFERRED / ON HOLD by owner, not built; no branch. Exact USER entry below. | Backlog R11; completeness 147; `2026-10-21T16-27-59-062Z_01a15f4a-7ad5-7377-81be-0baf3b6ffa33.jsonl:1602`. |
| <a id="i05"></a>I05 | `custom`, `define-goal` and work orders. Task list is [U14](#u14). | DEFERRED / ON HOLD, coordinator record of owner deferral; no authenticated quote supplied. Not abolished; no new implementation permission or branch. | Backlog I05; active `D-SCOPE-POSTPONED`; DECISIONS Scope postponed-items entry. |

R11 exact USER entry from the session above. Session files are under
`/Users/arkadijcukavin/.pi/agent/sessions/--Users-arkadijcukavin-ai-project-my-pi--/`.

```text
Нет, я думаю, что в автотестах тесты сами не надо запускать, когда он review делает.

 Я могу достать переписку. Я смогу достать код, но я не смогу достать коммит до и коммит после, скорее всего. Я хз.

 Давай пока скипнем тему с автотестами, потом к этому вернёмся.
```

### AGENT-STATES-UI details

DEFERRED / ON HOLD by owner; NOT STARTED, no branch. This task is outside the execution queue and must not
start automatically when profiles are delivered; a new owner instruction is required to resume it.
Prerequisite information only: subagent profiles are delivered by this change and update RQW-agent activity
reporting. This is not a runnable dependency or a release from the hold. The existing
[AGENT-STATES-UI](#agent-states-ui) task retains its requirements and sources.
The statusbar top-border path `extensions/RQW-statusbar/activity.ts`, `statusText`, consumes active agent counts.
A child that hands off a background job or CI wait and ends its native turn drops out of that count; main and child
background jobs are not represented. Required outcome: every pending background wait stays visible in the status
line. While Main is active, keep its existing thinking or tool activity. When Main is not active but has pending
waits, show exactly two categories: subagents and background processes. The subagent category includes children
waiting for their own background processes or children, not only active model turns. Reviewers remain ordinary
profile subagents, not a separate category; no worker category exists. Keep working, waiting and fully idle or AFK
states distinct. Fully idle means no pending waits and must never look active or waiting. The original agent-list
and card-state request and both later owner messages remain part of this same task.

## Deferred reference order and dependencies

This is a DEFERRED REFERENCE ORDER, not the current execution queue. Every unfinished pre-reset node is
DEFERRED / ON HOLD and non-runnable until explicitly resumed by the owner, even if its prerequisites are delivered.
This tree does not populate the new execution queue. Detailed design still
follows Research and agreement. The shipped web tool is delivered ([D-WEB-CLI](DECISIONS.md#web-search)); the TOKEN-EFFICIENCY read cache was built ahead of it on the owner's explicit request, the waits and async-tool work is delivered ([D-TOOLS-NOTIFY](DECISIONS.md#tools)). CODEX-CHANGELOG adoption remains on hold until explicitly resumed.
Architecture/index choices are recorded in [D-WORK-REPO-INDEX](DECISIONS.md#work-policy).
Their delivery does not resume held audits or fixes. Remaining dependencies never authorize automatic starts.

```text
DEFERRED REFERENCE ONLY - NOT RUNNABLE
TOKEN-EFFICIENCY-REVIEW (read cache merge + 3 days, then tune or remove)
New UI
Small near-ready merges
CODEX-CHANGELOG adoption (DEFERRED until the owner asks; not in the queue)
New UI + Small near-ready merges
`- Per-extension audits
   `- Audit fix tasks (end of queue)
WINDOWS-TEST-FAILURES (very end of the queue)
```

### CODEX-CHANGELOG

Adoption of findings from the [report](../../my-pi-evidence/codex-changelog/REPORT.md) is DEFERRED / ON HOLD until explicitly resumed by the owner; no implementation is queued. Blocked by: none.

### New UI and small near-ready merges

DEFERRED / ON HOLD outside the execution queue; every retained task requires explicit owner resumption.

- HTML task viewer: On hold by owner; branch `tasks-view`, head `4e8587257a6739e2841ed2d5b900eb10b16fd5cf`.
- Task-list cleanup: On hold by owner; branch `task-list-revision`, head `6ec1aa4`.
- Reviewer terminal parity: On hold by owner; branch `fix/reviewer-terminal-parity`, head `851888f`; superseded by the new subagent plan, retained as evidence.

Blocked by: none beyond the prerequisites below.
If explicitly resumed, New UI still includes the end-to-end tests U13. Small near-ready merges are the
existing task branches named in the handoff, not permission to invent new work.

### EXTENSION-AUDITS and every audit fix task

DEFERRED / ON HOLD until explicitly resumed; completing the prerequisites below never starts this work.

Blocked by: remaining small near-ready merges and the Codex-live-check and UI-enable prerequisites below.
Architecture/index delivery does not release the owner hold on any audit or audit fix.

Verbatim owner background-wait proposal from the same message:

> «Также я что хочу? У нас есть всякие механики, ожидания и прочее. Я хочу, чтобы когда у нас агент ждёт ответов от саб-агентов, wait, всякие инструменты и прочее, чтобы они не висели как исполняемый процесс. Допустим, он когда ждёт, я могу нормально переписываться с агентом, и я не буду обрывать этот wait инструмент его. Чтобы wait инструмент был в background фоне, и он прислал нотификацию агенту, будил его. Это, по-моему, очень очевидная простая механика, но она не реализована. Я, по крайней мере, не видел. Я хочу, чтобы такие штуки, когда что-то висит на ожидании, чтобы оно висело всегда сразу же в фоне, в background, и агент ставил нотификацию и ожидал нотификации, и я мог с ним общаться, не обрывая эти фоновые штуки. Понимаешь, о чём я? Чтобы когда я пишу какое-нибудь сообщение, steering делаю агенту, чтобы его tool call не обрывались нахуй. Я не знаю, как это правильно сформулировать. Чтобы какие-то tool call обрывались, а какие-то нет. Типа того.»

## Independent extension audits

EXTENSION-AUDITS is one DEFERRED / ON HOLD backlog entry containing one held task per extension listed below.
No audit or resulting fix enters execution until explicitly resumed by the owner, even after its prerequisites are delivered.
If resumed, for each audit, independently re-check all delivered work against its original task: the owner's requests and
`DECISIONS.md`. Thoroughly hunt bugs, rerun relevant tests, assess how to strengthen them and identify implementation
weak spots. Also check a minimal solution, minimal code and no garbage, under PROCESS Code quality.
The auditor only finds and describes defects; it fixes nothing. On completion, replace its audit task with one fix
task per defect at the end of the retained reference order; the hold still applies to each fix. If resumed, audits
still follow small near-ready merges and the remaining live-check prerequisites below.

Held tasks, simplest to most complex in the reference order; one-line ordering rationale uses source size and coupling, not test counts:

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

If explicitly resumed, these conditional held tasks use the same simplest-first reference order only after their prerequisites, reassessed against delivered code:

1. `RQW-theme`: after UI enablement; data-only theme, insert before the small code extensions.
2. `RQW-thinking`: after UI enablement; tiny standalone display hook, insert among the simplest extensions.
3. `RQW-naming`: after UI enablement; small naming modules with model calls, insert near the small session features.
4. `RQW-agent-ui`: after UI enablement; cards consume agent lifecycle data, including reviewer-profile results, place by delivered size and coupling.
5. `RQW-tool-ui`: after UI enablement; sizeable tool rendering integration, insert near statusbar.
6. `RQW-codex`: after merge and the owner's live check; the large multi-module transport candidate suggests last,
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

## U14 details

U14 owns this complete todo-list and panel specification. DEFERRED / ON HOLD until explicitly resumed by the owner. The UI changes P5/P10/P11 remain prerequisites; their delivery never lifts the hold. Not authorised for implementation. Open choices named in the text: skill name and activation duration; three-line layout with sub-steps; expand method and depth; behaviour on blocker, wait or cancel.

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

## Discarded

These are tasks the owner threw out. Do not run them; they are not open work or part of the execution queue.
The explorer and reviewer items below were explicitly discarded in owner message `348f1995`, physical line 6149
of the `16-27-59` session named in [DECISIONS.md](DECISIONS.md#agent); older sources record their original requests.

| ID | Description | Source | Reason |
| --- | --- | --- | --- |
| <a id="codex-public-internals"></a>CODEX-PUBLIC-INTERNALS | Preventive migration of RQW-codex lifecycle, auth and prompt seams from private Pi internals to public APIs; discarded, not pending work. | Owner `16-27-59:7338`, entry `d668a6e1`, session `2026-10-21T16-27-59-062Z_01a15f4a-7ad5-7377-81be-0baf3b6ffa33.jsonl`; original record: [D-CODEX-SIMPLE-COMPACTION](DECISIONS.md#codex-subscription-transport), owner lines 5067/5073; unfiled draft `my-pi-evidence/codex-parity/PI-NATIVE-COMPACTION-ISSUE-DRAFT.md`. | discarded by owner 2026-10-25; fix concrete private-internals breakage if it occurs instead of preventive migration; the owner does not update Pi for every new version. |
| <a id="project-explorer"></a>PROJECT-EXPLORER | Project-scoped explorer producing a combined report with code excerpts, plus a model comparison. | [Agent decision](DECISIONS.md#agent); owner `16-27-59:5303/5315`. | discarded by owner 2026-10-24 |
| <a id="claude-reviewer"></a>CLAUDE-REVIEWER | Measure and select a Claude reviewer model. | [Review decision](DECISIONS.md#review); owner `16-27-59:5291`. | discarded by owner 2026-10-24 |
| <a id="codex-reviewer-comparison"></a>CODEX-REVIEWER-COMPARISON | On hold; discarded, not queued. Old/new reviewer comparison on five real tasks; no branch, zero runs. | [Review decision](DECISIONS.md#review); owner `16-27-59:5225/5289`. | discarded by owner 2026-10-24 |
| <a id="extension-audits-rqw-review"></a>EXTENSION-AUDITS/RQW-review | Independent audit of RQW-review only. | [Extension audit source](#independent-extension-audits); owner `16-27-59:4864/4868`. | discarded by owner 2026-10-24 |
| <a id="i05-codebase-explorer"></a>I05/codebase_explorer | Additional codebase explorer and clarification against existing explore. | [Scope decision](DECISIONS.md#scope); Backlog I05. | discarded by owner 2026-10-24 |
