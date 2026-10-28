# Development process

<a id="isolated-parallel-execution"></a>
## Isolated parallel execution

1. Give each task one branch from `release` in a worktree under `/Users/arkadijcukavin/ai-project/my-pi-worktrees/`.
2. Make the change. Update docs only when an agreement or behavior changes.
3. Follow the testing rule below. Run only the touched extension's tests.

## Independent review

1. Keep tasks at one to three story points.
2. Give each leaf one independent review after its scoped checks.
3. Use `spotty` by default and `bossy` when the owner asks for a high review.
4. A short review checks that the task is done right, with nothing extra and nothing forgotten.
5. Keep the `code-reviewer` and `test-reviewer` profiles available.
6. Findings need evidence and impact. Send missing evidence back to the same reviewer.

## Delivery

1. Deliver in large chunks, not separate leaf releases.
2. At each chunk boundary, run `code-reviewer` and `test-reviewer` over the chunk and resolve evidenced findings.
3. Squash the reviewed chunk into `release` and push once.
4. After runtime changes only, update the owner's installed Pi once from `@release`, preserving settings.
5. Merge into `main` only after one full `npm test` on the exact head.

Run `npm run knip` on demand only. Findings are audit input, not deletion authority, and do not block default checks or delivery.

## Golden rule

No polling, no confidence reruns, no avoidable tokens.

<a id="subagent-models"></a>
## Subagent models

Main passes the category name as `model`, with optional `thinking`. The guard picks one pair uniformly at random from that category using `crypto.randomInt`:
1. Code and fixes: `openai-codex/gpt-6.1-terra` high / `anthropic/claude-sonnet-5-5` high.
2. Git, merge and mechanical work: `openai-codex/gpt-6.1-terra` low / `anthropic/claude-sonnet-5-5` medium.
3. Ordinary work, research and search: `openai-codex/gpt-6.1-terra` medium / `anthropic/claude-sonnet-5-5` high.
4. Hardest tasks: `openai-codex/gpt-6.1-sol` medium / `anthropic/claude-opus-5-5` medium.

Spotty uses `openai-codex/gpt-6.1-terra` low; Bossy uses `openai-codex/gpt-6.1-terra` medium.
Code-reviewer, test-reviewer and requirements-test-reviewer use `openai-codex/gpt-6.1-terra` medium.

The guard reads this machine-readable block.

```json coordinator-rules
{
  "agentModels": {
    "code": [["openai-codex/gpt-6.1-terra", "high"], ["anthropic/claude-sonnet-5-5", "high"]],
    "mechanical": [["openai-codex/gpt-6.1-terra", "low"], ["anthropic/claude-sonnet-5-5", "medium"]],
    "ordinary": [["openai-codex/gpt-6.1-terra", "medium"], ["anthropic/claude-sonnet-5-5", "high"]],
    "hardest": [["openai-codex/gpt-6.1-sol", "medium"], ["anthropic/claude-opus-5-5", "medium"]]
  },
  "reviewerProfiles": {
    "spotty": ["openai-codex/gpt-6.1-terra", "low"],
    "bossy": ["openai-codex/gpt-6.1-terra", "medium"],
    "code-reviewer": ["openai-codex/gpt-6.1-terra", "medium"],
    "test-reviewer": ["openai-codex/gpt-6.1-terra", "medium"],
    "requirements-test-reviewer": ["openai-codex/gpt-6.1-terra", "medium"]
  }
}
```

<a id="sufficient-proof-without-idle-reruns"></a>
## Sufficient proof, without idle reruns

1. For a new feature, write one happy-path test and only its critical branches tied to the target behavior.
2. For a real bug, write one regression test.
3. Call the module's public function.
4. Assert only the returned result, never internal calls or call order.
5. Use fakes only for the outside world: network, model, clock and Pi.
6. Do not mock our own modules.
7. Keep small test data inline in the test.
8. A temporary folder is allowed.
9. Use no sleeps, real timers, end-to-end tests or integration tests; all tests are synthetic.
10. Use a fixed clock and fixed data, with no randomness; tests are independent of order.
11. Write the test from the requirement, not the code. It must fail without the change; no tautologies.
12. Compare bytes only for the exact static fragment that must be static, never a whole file or dynamic parts.
13. One test runs in milliseconds; an extension's suite runs in about a second.
14. Documentation-only changes get source checks, not invented runtime tests.
15. Per task, run `npm run check -- --test "test/extensions/<touched>/*.test.ts"` for full calibrated lint and only the touched tests, concurrently. Repeat `--test <paths>` for more paths. Run `npm run check` once before merging into main: full lint and the unchanged `npm test` run concurrently. All jobs finish before a failure is returned; no automatic fixes or retries. Adding `--typecheck` runs `tsc` concurrently on request. TypeScript is never part of the default check or push CI.
