# Open and deferred work

This is the canonical task list. Keep source, status and branch with every item. Remove completed and dead tasks;
Git and `DECISIONS-ARCHIVE.md` preserve their history. Accepted limits and unverified live behavior stay in
`DECISIONS.md` or their research note unless there is actual remaining work.

Sources: docs-cleanup `AUDIT.md` section 5 and `parts/backlog.md`, outside the repository under
`/Users/arkadijcukavin/ai-project/my-pi-evidence/docs-cleanup/`. IDs below remain stable. `handoff` and `completeness`
mean the source documents identified by that audit. Branch status is the audited snapshot at `30952e6`, not a
claim that remote state has since been revalidated. Explicit later integration status takes precedence over that
snapshot. All descriptions are coordinator summaries, not owner quotations.
Deferred rows explicitly identify coordinator records of deferral where no authenticated verbatim owner message
is supplied. Old Claude benchmark campaigns are dead, superseded by the reduced v3 campaign R02, not paused tasks.

## Open

| ID | Work | Status/branch | Source |
| --- | --- | --- | --- |
| <a id="u05"></a>U05 | Finish and integrate agent/worker cards, delivered-message and wait-result wiring, and title headers. Review cards are U06. | OPEN, off main: `p5-agent-ui`, audited head `7f7d71f`; rebase and final proof required. No `RQW-agent-ui` on main. | Backlog U05/A05; handoff 98; completeness 55/199; UI execution brief P5 T13/T17. |
| <a id="u06"></a>U06 | Build the review card against the delivered reviewer-v2 reply format. | OPEN, blocked by R01; no T14 branch assigned. Coordinate with `p5-agent-ui`. | Backlog U06; handoff 98; UI execution brief P5 T14. |
| <a id="u12"></a>U12 | UI integration P10 T12/T20/T22/T30: register naming, thinking, tool-ui and agent-ui in `pi.extensions`, agent-ui before tool-ui; theme in `pi.themes`; update root user docs. | OPEN, no branch assigned. Four existing UI source folders remain unregistered; agent-ui awaits U05/U06. | Backlog U12; handoff 100; UI execution brief P10; current registration carrier `package.json`. |
| <a id="u13"></a>U13 | Real-Pi scripted faux-provider end-to-end tests for tool-ui, thinking hiding, activity indicator and cards; composition, load order and remaining physical-terminal appearance checks from U18. | OPEN, waits for U12 and cards; no P11 branch assigned. Isolated tests do not prove composition. | Backlog U13/U18; handoff 30/49-50/100; completeness 55; UI execution brief P11 T19. |
| <a id="u17"></a>U17 | Record nested codemode results in RQW-tools for tool-ui targets, exit codes and edit line counts that Pi 1.4.0 does not persist. | OPEN, accepted for after UI integration, not built; no branch assigned. Not awaiting an owner decision. | Backlog U17; newer handoff 103 supersedes completeness 198; `extensions/RQW-tool-ui/README.md`. |
| <a id="r01"></a>R01 | Integrate reviewer v2: git-based review, quote checking, disputes, UNCHECKED sources and wait/status replacing the current 30-minute hang guard. Includes R07. | OPEN, `reviewer-v2`, audited head `9e3ccdd`; blocked on owner model/prompt choice and clean R02. Temporary agent-review route remains until delivery and owner re-enablement. | Backlog R01/R07/R08; handoff 59/115; completeness 135/154; `extensions/RQW-review/index.ts`. |
| <a id="r02"></a>R02 | Reduced v3 reviewer benchmark, first wave after offline source readiness; prompt C measurement, independent judge-v2 disagreement and re-judging saved answers. Includes R04/R14. | OPEN, external evidence; `bench/real-build-pilot`, audited head `22d032b`. Do not resume superseded Claude campaigns. | Backlog R02/R04/R14; handoff 59-80; completeness 154/224/228; external `my-pi-evidence/real-bench/v3-*` and `my-pi-evidence/reviewer-origins/REPORT.md`. |
| <a id="c01"></a>C01 | RQW-codex subscription transport with Codex CLI parity, device-only login and a pinned oracle; resolve native oracle telemetry-wait failure and finish the full oracle.  Add the daily `codex-oracle.yml` schedule when this transport lands on `main`. | OPEN, off main: `rqw-codex`, audited head `e7b8412`. | Backlog C01; handoff 43/87-92; completeness 173.  Active `D-QA-CODEX-SCHEDULE`, main QA loop `3bdac4f`. |
| <a id="grep-null"></a>GREP-NULL | Normalize optional grep fields so the main tool does not pass literal string `null` as a glob. | OPEN, no branch assigned; reviewer already has `dropEmptyOptional`, main path does not. | AUDIT section 5, Review limits; `extensions/RQW-review/index.ts`, `extensions/RQW-tools/index.ts`. |
| <a id="publish-skill"></a>PUBLISH-SKILL | Reconcile separate commit/push permission with PROCESS; require successful publication CI on the exact packaged commit, not merely the latest green branch run, and dispatch the intended ref when needed. | OPEN, no branch assigned; skill edits outside this cleanup. Marketplace publishing still needs a direct owner request. | AUDIT item 15 and docs-consistency findings; `.agents/skills/publish-pcli/SKILL.md`. |
| <a id="code-comments"></a>CODE-COMMENTS | Remove the stale statement that the Claude high reviewer slot is being re-measured. | OPEN, no branch assigned; source comment only, outside this docs cleanup. Do not change `LEVELS` or reviewer model policy. | `extensions/RQW-review/index.ts:36`; completed README cleanup and integration check. |

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
| <a id="a01"></a>A01 | Remaining Codex-style child capabilities: durable resume, parent-history fork, web search and MCP. | DEFERRED, coordinator record of owner deferral; no authenticated quote supplied. Not delivered by in-process sessions; no branch. | Backlog A01; DECISIONS Agent deferred-capabilities entry. |
| <a id="r11"></a>R11 | Reviewer checking test code against requirements and test plan, including conversation collection; distinct from repository checks reviewers may already run. | DEFERRED by owner, not built; no branch. Exact USER entry below. | Backlog R11; completeness 147; `2026-10-21T16-27-59-062Z_01a15f4a-7ad5-7377-81be-0baf3b6ffa33.jsonl:1602`. |
| <a id="i05"></a>I05 | `codebase_explorer`, `custom`, `define-goal` and work orders; clarify explorer purpose against existing `explore`. Task list is U14. | DEFERRED, coordinator record of owner deferral; no authenticated quote supplied. Not abolished; no new implementation permission or branch. | Backlog I05; active `D-SCOPE-POSTPONED`; DECISIONS Scope postponed-items entry. |

R11 exact USER entry from the session above. Session files are under
`/Users/arkadijcukavin/.pi/agent/sessions/--Users-arkadijcukavin-ai-project-my-pi--/`.

```text
Нет, я думаю, что в автотестах тесты сами не надо запускать, когда он review делает.

 Я могу достать переписку. Я смогу достать код, но я не смогу достать коммит до и коммит после, скорее всего. Я хз.

 Давай пока скипнем тему с автотестами, потом к этому вернёмся.
```
