## Quality control loop

The full regression runs on `main` by itself; Main reads its failures, it does not run or watch it. Decisions and
reasons: [Quality control](../DECISIONS.md#quality-control).

**Schedule.**
- `tests.yml` runs on `main` every 2 hours, `pcli.yml` daily.
- Task branches get no scheduled reruns, and nothing retries automatically: no test retry, no rerun of failed
  jobs, no `continue-on-error`. A flake is measured as k failures in n runs, not retried away.
- `tests.yml` has no concurrency group: overlapping scheduled runs both run, so no run is cancelled.

**Awareness.**
- At task start and when taking over a branch, Main reads the QA status: the `qa-status` message of the dev-only
  `.pi/extensions/qa-status` extension, `/qa` for the full view, or `npm run qa-status` (subagents use this one).
  All three read the shared [CI watcher](../PROCESS.md#task-pipeline) file instead of calling `gh` themselves.
- A red scheduled `main` is mentioned to the owner in one line and triaged. Main never polls CI itself.
- A red `main` does not block merges. `deliver-check` shows cached red `main` runs as information.

**Triage.** Before any fix, a read-only subagent classifies the failure and supplies the class with its evidence:

| Class | Evidence required |
| --- | --- |
| Product bug | The failing assertion and the code path that breaks the agreed behavior; for an intermittent case the race or ordering seen in the logs. Fix the product, keep the test. |
| Test bug | Why the old assertion is wrong, citing the contract in `DECISIONS.md` or a README. |
| Infra | The failed step's log lines. No test change; fix only our own CI configuration. |
| Drift | The version diff between the last green and the first red run (Facts step). Fix the compatibility or pin the version with a `DECISIONS.md` entry; dropping a platform or version needs the owner. |

**Forbidden without proof.** These need triage proof that the old value or assertion was wrong; the test-integrity review
applies only when `deliver-check` mechanically detects the weakening (see below): raising a timeout or deadline; retries or job reruns; `skip`, `todo` or a platform skip;
deleting a test or an assertion; weakening an assertion (exact to range, `includes`, truthy); swallowing an error;
rewriting an expected value to the current output; `continue-on-error`; removing a matrix entry; changing
`paths-ignore` to avoid a run. Replacing a time-based assertion by an event-based one is allowed with that proof.

**Interim skip retired.** The owner-approved Windows skip for failures #3, #4 and #5 was applied and then removed: the causal
fix landed as `2b9c088` and no skip is in the tests. The forbidden list above applies in full again; a new narrow skip
needs a fresh owner decision ([D-PIPELINE-FLAKE-SKIP](../DECISIONS.md#task-pipeline)).

**Proof of a fix.**
- Red before, green after: the test fails on the pre-fix code (or with the fault put back) and passes after, both in
  CI logs.
- Intermittent failure: n repeat runs after the fix with no failure, where (1-p)^n < 0.05 and p is the failure rate
  before the fix. Use the manual `codemode-stress.yml` repeat harness (dispatch inputs: test file, name pattern, os, node, runs) or a dispatch of `tests.yml`; CPU-heavy repeats stay in CI.

**Test-integrity review.** Routine test changes are covered by the one ordinary independent review; they get no
separate test-integrity pass. For a test or workflow change that weakens a check, as `deliver-check` mechanically
detects it (`skip`, `todo`, retry, raised timeout, `continue-on-error`, fewer assertions), a reviewer subagent runs
through `agent` with `agent_type: "test-reviewer"`, in parallel with the other required reviews. Critical/high-risk
changes also receive separate code review under [Independent review](independent-review.md).
The project profile `.pi/agents/test-reviewer.toml` owns its prompt and Sol 6.1 low defaults.
Its brief names the exact review scope and supplies the triage claim, the diff, `Test-change:` and its supporting
contract and evidence, with red/green and repeat evidence when applicable.

**Trailers** of the squash message. `deliver-check` requires
`Test-change: <why the old test was wrong or what it proves now>` and `Test-review: agent#N CLEAN` when the
test-integrity rule triggers: a test or workflow change adds `skip`, `todo`, `--test-retry` or `continue-on-error`,
raises a timeout, or leaves fewer assertions in a test file. An ordinary test change needs neither.
