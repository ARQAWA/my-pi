# Development process

This is the working procedure for agents developing my-pi. Read this file's mandatory part before every task and restore it after
compaction or a context handoff. `WORKFLOW-MANIFEST.md` is the owner's personal record of his working principles
and aspirations, not a procedural gate. This file carries the agreed execution rules; `DECISIONS.md` carries
the accepted decisions and their reasons. New owner instructions take precedence over older agreements.

The mandatory part ends before the task-loaded Delivery section. Before acting, load the sections below that apply to the task and your role. After compaction or a handoff,
restore those sections too. A section link is navigation, not permission to omit an applicable rule.

## Research and agreement

1. Main and every agent implement only the owner's requirements and decisions the owner himself accepted.
   Add no protections, fallbacks, edge-case handling, options, settings or mechanisms beyond them. Main cannot
   accept a technical decision that adds behavior on the owner's behalf. Delegated technical choices concern only
   how to implement what was ordered, never what to add. Propose an addition only as a question to the owner and
   only when Main considers it critical; do not raise non-critical proposals until the owner asks.
   While the owner discusses or plans, change nothing. A proposal or question is not permission to implement it.
2. Delegate initial research of the request and relevant source code to subagents, in parallel where useful.
   Main compiles all requirements across the conversation and accepted proposals, retaining the owner's exact words.
   Keep agreed work intact: do not lose, silently drop, reinterpret or invent requirements.
3. Before a new feature or mechanism, search for ready-made solutions in Pi packages, npm, GitHub and other
   agents. Report candidates with their license, maintenance, size and dependency risk, and explain suitability.
   Build our own only with the owner's consent, recorded in `DECISIONS.md`. Keep the no-fork/no-Pi-patch and
   independent-extension boundaries. Small changes, bug fixes and test fixes do not require this search.
4. Bring material ambiguities, conflicts and missing decisions needed to deliver the ordered outcome to the owner
   in one question batch, under rule 1. An unanswered question is not acceptance, including overnight.
5. The owner's answers or approval start the agreed work without another go question. If nothing is open and the
   owner has explicitly requested execution, start. Keep the minimal necessary agreed scope, not a smaller scope.

<a id="isolated-parallel-execution"></a>
[Isolated parallel execution](process/isolated-parallel-execution.md): One execution task is active at a time, with no separate test lane.
Before development work; Main also loads this before coordination.

<a id="task-pipeline"></a>
[Task pipeline](process/task-pipeline.md): When scheduling, pausing, resuming, integrating, tracking CI or choosing wait behavior.

<a id="task-timebox"></a>
[Task timebox](process/task-timebox.md): Before substantive development work.

<a id="subagent-models"></a>
[Subagent models](process/subagent-models.md): Before starting or restarting an agent, or writing owner quotes.

## Golden rule

Standing requirement for designing and reviewing the harness and the development workflow. Owner's words and reason:
[DECISIONS.md, Work policy](DECISIONS.md#work-policy), `D-WORK-GOLDEN-RULE`; personal wording:
[WORKFLOW-MANIFEST.md](WORKFLOW-MANIFEST.md#золотое-правило).

- Spend no tokens where they can be avoided: no polling, no model turns spent only waiting, no repeated reads or
  reviews without new input.
- Solutions are engineered, thought through, efficient, optimal and as simple as possible. Weigh the trade-offs and
  balance them to reach the right decision.
- Every design, implementation and review checks this. The review criterion of every brief carries this line:
  "Golden rule: no avoidable token spending (no polling, no model turns only to wait, no repeated reads or reviews
  without new input); engineered, simple, optimal; trade-offs weighed." Reviewers report only an evidenced
  violation, not taste.

## Code quality

Every change and every review must keep extension source clean, readable, minimal and easy to extend.
Quality means ease of maintenance by agents and people through clear structure and meaningful decomposition.
Use the minimal code needed for the agreed result, without garbage. Prefer straightforward code over clever
one-liners or dense compound expressions. Brevity must not hide structure or understanding.
This is a standing implementation and review principle, with no numeric limits and no permission for unrelated
refactoring or scope expansion.

Use the same extension framework: `index.ts` with meaning-named modules and resources beside it, subfolders
where needed, and no `src/` layer. Tests belong in the separate mirrored
`test/extensions/<extension>/` tree, not inside extensions.
Root `INDEX.md` is the repository navigation map; every extension README has a generated file map.
After relevant file, manifest or map changes, run `node scripts/repo-index.mjs --write`.
Freshness is checked by `node scripts/repo-index.mjs --check` through root `test/repo-index.test.ts`
in `npm test`. This delivery maps large files without splitting them; it adds no runtime changes,
mandatory file headers, numeric size limits, new search tooling or audits.
Accepted choices and sources: [DECISIONS.md, Work policy](DECISIONS.md#work-policy),
`D-WORK-CODE-QUALITY` and `D-WORK-REPO-INDEX`; personal wording:
[WORKFLOW-MANIFEST.md](WORKFLOW-MANIFEST.md#качество-и-объём-работы).

<a id="sufficient-proof-without-idle-reruns"></a>
[Sufficient proof, without idle reruns](process/sufficient-proof-without-idle-reruns.md): Before choosing or running checks, or making evidence claims.

<a id="measurements-and-benchmarks"></a>
[Measurements and benchmarks](process/measurements-and-benchmarks.md): Before measurements or benchmarks with model calls.

<a id="independent-review"></a>
[Independent review](process/independent-review.md): Before classifying a change, preparing review or reviewing a result.

<a id="quality-control-loop"></a>
[Quality control loop](process/quality-control-loop.md): At task takeover, QA triage, or test and workflow changes.

<a id="third-party-installation-fast-path"></a>
[Third-party installation fast path](process/third-party-installation-fast-path.md): Before an agreed third-party installation.

[Delivery](#delivery): Before documentation updates, commits, integration or delivery; task-loaded below.

## Communication and continuity

Always answer in Russian, with the main point first. At most three paragraphs of at most two lines each unless
content genuinely requires expansion. No repeated waiting messages or lists of unfinished work. During execution,
ask only about a real blocker needing the owner; answer direct questions and requested status, then continue.
Reports and questions do not stop independent background subagents or checks.

After compaction, a model switch or a handoff, reload this procedure and recover the actual agreement and evidence
from their sources before continuing. Do not substitute an unaccepted agent plan for the owner's words.

## Coordinator rules

The guard reads this block from the root file. Its policy is in [Subagent models](process/subagent-models.md).

```json coordinator-rules
{
  "agentModels": {
    "simple": [["kimi-coding/k3.1-pro", "low"]],
    "complex": [["kimi-coding/k3.1-pro", "low"]],
    "hardest": [["kimi-coding/k3.1-pro", "high"]]
  },
  "reviewerProfiles": {
    "spotty": ["openai-codex/gpt-6.1-sol", "low"],
    "bossy": ["openai-codex/gpt-6.1-sol", "medium"],
    "code-reviewer": ["openai-codex/gpt-6.1-sol", "low"],
    "test-reviewer": ["openai-codex/gpt-6.1-sol", "low"],
    "requirements-test-reviewer": ["openai-codex/gpt-6.1-sol", "low"]
  }
}
```

<!-- Task-loaded section: not part of the mandatory read. -->

## Delivery

1. Update the affected documentation with the code. Record active accepted decisions in `DECISIONS.md` with the
   owner's verbatim quote, source session, reason and carrier; keep each rule in one place and link elsewhere.
   Superseded and obsolete decisions go verbatim into root `DECISIONS-ARCHIVE.md`, an append-only archive with
   replacement and commit provenance, not routine agent reading. `BACKLOG.md` is the canonical list of open and
   owner-deferred work with source, status and branch; remove done and dead tasks instead of keeping a second ledger; owner-discarded tasks move to `BACKLOG.md` Discarded.
   Current docs describe current facts, not a history ledger.
2. Bootstrap this release-pipeline change first by squashing it into `main` under the owner's explicit targeted-check
   exception, without full `npm test`. Then create `release` from that `main`, push it, and switch the clean
   integration checkout to `release`. Start each new task from up-to-date `origin/release` in its own branch and worktree:
   `git worktree add -b <task> ../my-pi-worktrees/<task> origin/release`.
   Push the task branch; continue independent work during required reviews. Before merging, require sufficient
   proof, the checks in step 3, and the required clean reviews for the final head commit on current
   `release`. Rebase remaining task branches when `release` moves and check their new heads.
   No green GitHub Actions run is required, including `pcli.yml`; CI evidence trailers are not required.
3. Before every squash merge, the merge agent ([Task pipeline](#task-pipeline)) writes the planned squash message
   and runs, from the clean `release` checkout,
   `npm run deliver-check -- <branch> <message-file>` (`scripts/deliver-check.mjs`). It requires: the branch
   contains current `origin/release` and the release checkout's HEAD, the merge destination.
   When the changed set contains only documents or process rules, saved owner-quote checks for touched quotes,
   link checks and format checks for touched files replace application tests. This exception never applies when
   runtime prompts (`SYSTEM.md`, agent roles or profiles, reviewer profiles or skills, tool descriptions),
   executable code, workflows, `package.json` or the `coordinator-rules` block change. Meaning-change result review
   and the release batch checks in step 4 remain unchanged.
   For all other changed sets, changed paths mechanically select affected extension tests, isolation, changed tests
   and root tests loading changed files. It runs those tests on that exact committed branch head in its existing
   clean task worktree on the owner's macOS, and verifies worktree cleanliness and the head before and after the
   run. No new receipt or test trailer is required. No full suite runs per task.
   The message carries the
   trailers `Review: agent#N CLEAN` (at least one clean profile-based result review under
   [Independent review](#independent-review)), `Code-review: CLEAN` (any path outside
   the workflow exclusions, including extension READMEs),
   or instead of both for small work `Combined-review: agent#N CLEAN`, or for proofreading no review trailer and
   `Change-class: proofreading` with `Doc-check: <absolute log path>` ([Independent review](#independent-review)),
   and `Unverified: <what was not verified live, or none>`. An optional
   `Decision: D-<SECTION>-<NAME>` trailer links the squash to a stable decision ID; it is not a gate requirement.
   When the
   test-integrity rule triggers it also requires `Test-change:` and `Test-review:`; a `QA: #N` line requires
   `Test-change:` when test or workflow files changed, and issue N must carry the `qa-inbox`
   label ([Quality control loop](#quality-control-loop)). It lists the open `qa-inbox` issues as information:
   a red `main` does not block a merge. Any failure: no merge.
4. Squash merge into `release`: one task, one commit, with that message. Never merge the task's stage commits into
   release as a merge commit. Push release autonomously; the squash tree equals the tested head, so it is not retested.
   Main determines when a release is due from Git alone: the first-parent task commits in
   `git log --first-parent --reverse --format='%H %ct' origin/main..origin/release` and the first commit's committer
   timestamp. After 10 task commits or 2 hours from the first task since the prior release merge, whichever comes
   first, Main schedules a full-release-regression task in the single execution queue to run local `npm test` on the
   exact committed `release` head on the owner's macOS. It has no independent concurrent lane. Serialize merges while
   that full run is in progress so the release head stays the tested head.
   An empty batch never runs. No counters, state files, daemon or new lock are added.
   If the full run fails, do not move `main`: a fix task in the same single execution queue finds the guilty task and
   fixes it, then the full suite runs again. After a clean full run, merge that tested release head into `main` by an ordinary merge or
   fast-forward, preserving the per-task commits, and push `main`. Switch the integration checkout to `main` for
   that merge, then return it to `release`. Never squash the batch or promote an untested head.
   Scheduled GitHub runs on `main` remain unchanged.
5. Run a completeness check for the session once after 7 merges or 120 minutes, whichever comes first, counted from
   the previous check or the session start, and always before the final report: a fresh independent profile reviewer
   through `agent`, following the `reviewer` skill and [Independent review](#independent-review), with
   `include: ["user_messages"]`. Object: `release`'s and `main`'s git logs since the session
   start, plus the in-progress branches and worktrees and the items the owner cancelled. Criterion: every owner
   request is marked done (by which commit), in progress (by which branch) or cancelled by the owner. A request
   with no mark is a finding: do it, or ask the owner.
6. The owner's locally installed Pi follows `release` immediately after every task merge. Once `release` exists,
   point the installed package at it with `pi install git:github.com/ARQAWA/my-pi@release`, preserving auth,
   package filters and other settings. Restart when process-wide patches require it.
7. After successful delivery, and after every ignored Windows failure is recorded and any still-running Windows run is
   handed to background tracking ([Task pipeline](#task-pipeline)), remove this task's worktree, its local branch and
   its branch on `origin`. Keep `release`; do not remove other tasks' worktrees or branches.
   Publishing a release or Marketplace version requires the owner's direct request.
8. Report the result once, unprompted with an evidence table (claim, check, result or run link) and an honest
   "not verified live" section, plus any real limitation and manual commands only when useful.
