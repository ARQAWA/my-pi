---
name: testreview
description: "Review test code against requirements, test plan and conversation evidence without running tests; only when requested."
---

# Test review

Use when the owner requests review of test code against requirements, a test plan or acceptance criteria. Do not launch it automatically.

Collect the exact test paths or ranges, primary requirements, test plan, acceptance criteria and relevant conversation sources. Use readable absolute paths when the review runs in another directory. Collect the supplied external conversation with both user and assistant turns, not just a summary; follow relevant references without searching unrelated sessions. Preserve the owner's accepted decisions and their source, not agent proposals as agreement. If required sources are unavailable, name the missing input instead of inventing it.

Start a fresh ordinary `agent` with `agent_type: "requirements-test-reviewer"`, `include: ["user_messages"]` and the collected sources in `task`. The profile defaults to `openai-codex/gpt-6.1-sol` low. Agent mechanically appends the current caller's raw user messages; this does not include assistant turns or replace an external conversation. Do not retype those user messages. Use `<agreement>` when needed for owner-accepted decisions and their sources, `<object>` for exact test scope, primary sources, conversation paths and stage, and `<criterion>` for what the tests must verify. Include: "Any element beyond the owner's requirements and decisions the owner himself accepted is a finding."

The reviewer reads code and evidence only. Do not run tests or execute reviewed code. Do not require a diff, before/after commits, QA issue, execution logs or delivery trailers. No runtime, tool filtering or model permissions are added. If the ordinary `agent` or selected profile is unavailable, report that the review cannot run; do not substitute another runner.

Keep reviewed files unchanged until the verdict. Check evidenced findings, fix admitted defects as one batch and use a fresh reviewer for changed places when a recheck is needed. Missing primary evidence makes the review incomplete, never CLEAN. A CLEAN names the checked requirements and test scope, not a passing test run. Report the verdict and material limits, including that tests were not run.
