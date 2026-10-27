# Development process

<a id="isolated-parallel-execution"></a>
## Isolated parallel execution

1. Give each task one branch from `release` in a worktree under `/Users/arkadijcukavin/ai-project/my-pi-worktrees/`.
2. Make the change. Update docs only when an agreement or behavior changes.
3. Follow the testing rule below. Run only the touched extension's tests.

## Independent review

1. Use one independent review per task, short for small tasks.
2. Use `spotty` by default and `bossy` when the owner asks for a high review.
3. Keep the `code-reviewer` and `test-reviewer` profiles available.
4. Findings need evidence and impact. Send missing evidence back to the same reviewer.

## Delivery

1. Squash into `release` and push.
2. After runtime changes only, update the owner's installed Pi from `@release`, preserving settings.
3. Merge into `main` only after one full `npm test` on the exact head.

## Golden rule

No polling, no confidence reruns, no avoidable tokens.

<a id="subagent-models"></a>
## Subagent models

Executors use these main / fallback pairs:
1. Code and fixes: `openai-codex/gpt-6.1-sol` low / `kimi-coding/k3.1-pro` low.
2. Git, merge and mechanical work: `openai-codex/gpt-6.1-terra` low / `kimi-coding/kimi-for-coding` low.
3. Ordinary work, research and search: `kimi-coding/kimi-for-coding` high / `openai-codex/gpt-6.1-terra` high.
4. Hardest tasks: `kimi-coding/k3.1-pro` high / `openai-codex/gpt-6.1-sol` medium.

Reviewers use their Sol profiles. Agents use no Anthropic models.

The guard reads this machine-readable block.

```json coordinator-rules
{
  "agentModels": {
    "code": [["openai-codex/gpt-6.1-sol", "low"], ["kimi-coding/k3.1-pro", "low"]],
    "mechanical": [["openai-codex/gpt-6.1-terra", "low"], ["kimi-coding/kimi-for-coding", "low"]],
    "ordinary": [["kimi-coding/kimi-for-coding", "high"], ["openai-codex/gpt-6.1-terra", "high"]],
    "hardest": [["kimi-coding/k3.1-pro", "high"], ["openai-codex/gpt-6.1-sol", "medium"]]
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
14. Per task, run `npm run check -- --test "test/extensions/<touched>/*.test.ts"` for full calibrated lint and only the touched tests, concurrently. Repeat `--test <paths>` for more paths. Run `npm run check` once before merging into main: full lint and the unchanged `npm test` run concurrently. All jobs finish before a failure is returned; no automatic fixes or retries. TypeScript is a later, opt-in task, not part of the default check.
