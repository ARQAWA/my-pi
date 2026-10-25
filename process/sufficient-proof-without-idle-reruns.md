## Sufficient proof, without idle reruns

- Main ensures subagents choose and perform checks for the changed behavior and claim under the rules below.
  Subagents inspect documentation and Pi sources where needed.
  Use deterministic tests for mechanics and actual model probes when the claim concerns model behavior.
  Do not burn tokens on live compaction when the owner requests documentation-only proof.
- Run existing relevant checks once, in the background where possible. Repeat after a relevant fix or a changed
  tested input, not merely for confidence, staging, a commit ID or a squash merge. Reuse valid evidence while the
  tested code, configuration and document contracts remain unchanged, subject to the delivery checks in [Delivery](../PROCESS.md#delivery).
- CPU-heavy work (repeat loops, pressure runs and load probes) runs in GitHub Actions, not on the owner's MacBook
  Air. The local delivery checks follow [Delivery](../PROCESS.md#delivery).
  Other local checks stay focused on the change. Windows checks run in CI too,
  including relevant Node, Bun and PortableGit coverage, but they are advisory and do not gate a merge
  ([Task pipeline](../PROCESS.md#task-pipeline)). Linux is out of scope.
- Run `npm run test:bun` in CI when Bun/codemode behavior is affected. Test extension isolation when affected.
- Subagents save their check and probe logs. Every number in a report or documentation must point to a CI run URL
  or a named saved log file; never report counts from memory. Save local logs in OS temporary storage.
- Test exactly what gets merged. The base, rebase and final-head delivery checks follow [Delivery](../PROCESS.md#delivery).
  No GitHub run needs to be triggered or awaited for a merge.
- Root documentation, notes and development instructions alone do not justify extra application tests or model runs;
  the delivery checks in [Delivery](../PROCESS.md#delivery) still apply. A workflow change does require validating its triggers and affected
  Windows jobs. Do not claim a queued or incomplete run passed.
- Everyone who writes, generates or fixes tests, a subagent, a reviewer or the test-fix lane, has one purpose: to check
  that the behavior matches the requirements, never to turn the run green. The bound is the reviewer's: no
  fanaticism, perfectionism, polishing or taste.
- Fix failures caused by the task, including assertions for deliberately changed behavior. Report unrelated failures
  without repairing them or falsely counting a failing required check as clean. If they block delivery, ask the owner.
- For prompt/tool behavior performance claims, compare against the relevant baseline. The product goal remains
  my-pi better than stock Pi and Pi plus our prompt; do not launch a full benchmark for every unrelated edit.
