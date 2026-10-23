# bench46 GPT: four SYSTEM.md edits

Decision: do not adopt the four edits as a package in the shared prompt. Main's `extensions/RQW-prompt/SYSTEM.md` remains unchanged. The measured rejection completes this prompt task; it is not a paused task. The candidate is preserved at commit `f6e9327ea74f87bf241a34153828947cc93a6a72` and its parent `80bec26769530f94a8c7bd6ac8cadf10b2e95b81`.

Frozen stands: base `80bec26769530f94a8c7bd6ac8cadf10b2e95b81` and edit `f6e9327ea74f87bf241a34153828947cc93a6a72`, extracted with `git archive`. File hashes differed **only** for `extensions/RQW-prompt/SYSTEM.md`. The four changes jointly add a shortest proven path, prefer one automatic general solution, ask unresolved questions together before work while deciding open choices, and treat open choices as non-blockers. They were not isolated individually.

Models: `openai-codex/gpt-6-sol` low and `openai-codex/gpt-6.1-sol` medium. Seven code questions T01-T07 each ran five times per stand/model (140 runs). EDIT, WRITE and MULTI each ran three times per stand/model (36 runs). Same-task, same-run pairs started together. All 176 runs returned final answers; all 36 edit runs passed pytest and semantic acceptance checks with no extra edits. The question runs made no repository changes or inappropriate clarification requests.

Question averages, equal task weights (quality is percentage of checklist points; wall is process seconds):

| Model | Stand | Quality % | Wall s | secondsAt60 | Steps | Tools |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| GPT-6 low | base | 75.19 | 27.50 | 25.00 | 4.60 | 23.31 |
| GPT-6 low | edit | 76.84 | 25.61 | 22.48 | 4.20 | 21.66 |
| GPT-6.1 medium | base | 91.24 | 67.71 | 48.47 | 6.83 | 32.20 |
| GPT-6.1 medium | edit | 88.95 | 65.99 | 47.86 | 7.00 | 30.89 |

Paired edit minus base, 90% bootstrap confidence intervals (20,000 resamples, seed 46061, paired within each fixed task):

| Model | Quality pp | Wall s | secondsAt60 | Steps | Tools |
| --- | --- | --- | --- | --- | --- |
| GPT-6 low | +1.65 [-2.23, +5.33] | -1.89 [-3.09, -0.68] | -2.53 [-3.45, -1.63] | -0.40 [-0.74, -0.06] | -1.66 [-3.26, -0.14] |
| GPT-6.1 medium | -2.29 [-5.81, +1.24] | -1.72 [-4.03, +0.63] | -0.62 [-2.22, +1.01] | +0.17 [-0.26, +0.60] | -1.31 [-4.20, +1.54] |

GPT-6 low is about 6.9% faster in wall time, while GPT-6.1 medium's quality estimate is 2.29 percentage points lower. Its interval includes zero, so this does **not** prove a general regression; it also permits a meaningful loss. No noninferiority margin was specified, and these results cannot establish safe noninferiority for a shared prompt. Medium wall-time change is uncertain. The intervals quantify repeats of these seven questions, not generalization to other projects or long dialogues. Rate-limit retries affected both stands in three pairs; omitting those pairs did not change the speed conclusion. A strict three-vote judge scored compound checklist items; its systematic error was not validated on a separate known-answer set.

The judge was explicitly `openai-codex/gpt-6.1-sol` low with three independent votes and majority per checklist point. This differs from the earlier five-vote implicit-completion method, so absolute quality figures must not be compared with bench44/45 or the old Claude benchmark campaigns, which are dead and superseded by the v3 benchmark ([BACKLOG.md, R02](../BACKLOG.md#r02)). `secondsAt60` is output tokens divided by 60, not elapsed time. Unknown: effects of individual edits, behavior on other tasks/models, and real clarification decisions. No further tests or Claude runs are required for this decision.

Raw per-run metrics (176 rows, no histories): [`bench46-gpt.csv`](bench46-gpt.csv). Detailed source report: `/tmp/bench46-gpt-report.md` and `~/stock-bench/bench46-gpt/report.md`; frozen stand manifest and grading detail remain under `~/stock-bench/bench46-gpt/`.
