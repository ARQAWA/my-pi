## Sufficient proof, without idle reruns

This is the canonical testing and proof rule. QA-specific triage and intermittent-failure evidence stay in
[Quality control loop](quality-control-loop.md); delivery mechanics stay in [Delivery](../PROCESS.md#delivery).

- Test risk and public behavior, not implementation details or coverage. Every test protects a concrete behavior:
  real bugs get regression tests and critical scenarios get contract tests. There is no test without a risk,
  no coverage target and no duplicate check of the same risk.
- Use the cheapest adequate level: unit tests only for algorithms, integration tests for interactions and
  end-to-end tests only for critical paths. Use controlled network doubles, but real files and real Pi where
  applicable. Windows behavior is proven on Windows.
- Do not use blind sleeps, arbitrary timeouts or reruns until green. Replace timing assumptions with observable
  events when the old timing was not a requirement.
- Match proof to the change:
  1. An ordinary change tests the affected contracts.
  2. A bug fix proves red before and green after.
  3. A refactor uses the existing checks.
  4. Documents get the touched-quote, link and format checks in [Delivery](../PROCESS.md#delivery).
  5. A platform bug gets targeted CI on that platform.
  6. Each release gets one full local regression on the exact release head under [Delivery](../PROCESS.md#delivery).
- Run existing relevant checks once, in the background where possible. A repeat needs new information: a relevant
  fix, changed input or statistically necessary intermittent-failure evidence. Reuse valid evidence while the tested
  code, configuration and document contracts remain unchanged, subject to [Delivery](../PROCESS.md#delivery).
- Use deterministic tests for mechanics and actual model probes for model-behavior claims. Do not burn tokens on
  live compaction when the owner requests documentation-only proof.
- CPU-heavy repeat loops, pressure runs and load probes run in GitHub Actions, not on the owner's MacBook Air.
  Other local checks stay focused. Windows checks run in CI too, including relevant Node, Bun and PortableGit
  coverage, but are advisory and do not gate a merge ([Task pipeline](task-pipeline.md)). Linux is out of scope.
- Run `npm run test:bun` in CI when Bun/codemode behavior is affected. Test extension isolation when affected.
- Save check and probe logs in OS temporary storage. Every number in a report or documentation points to a CI run
  URL or a named saved log; never report counts from memory.
- Test exactly what gets merged. The base and final-head checks follow [Delivery](../PROCESS.md#delivery). No GitHub
  run needs to be triggered or awaited for a merge.
- Root documentation, notes and development instructions alone do not justify application tests or model runs.
  A workflow change requires validating its triggers and affected Windows jobs. Never claim a queued or incomplete
  run passed.
- Everyone who writes, generates, fixes or reviews tests checks that behavior matches requirements, never that the
  run becomes green. No fanaticism, perfectionism, polishing or taste.
- Do not mass-rewrite old tests. Clean only a touched component. Standalone test-only P3 and cosmetic tasks are
  cancelled; a grouped current-queue cleanup is not permission to recreate them. Delete a demonstrably useless test
  instead of repairing it, with proof that deletion removes no needed risk coverage. Never delete or weaken a
  meaningful check to hide a failure.
- Fix failures caused by the task, including assertions for deliberately changed behavior. Report unrelated failures
  without repairing them or counting a failed required check as clean. If they block delivery, ask the owner.
- For prompt/tool performance claims, compare against the relevant baseline. Do not launch a full benchmark for an
  unrelated edit.
- Stop when critical scenarios pass, real findings are resolved and the required review is complete. Run no extra
  check without new information.
