# Reviewer prompt: measured GPT candidate

Carrier: `extensions/RQW-review/REVIEWER.md`, copied byte-for-byte from `~/stock-bench/review-bench/prompts/gpt-final.md` (SHA256 `a9cc1a3fac50fe32b6911e5bb8bf152caecad9947e2d36d162696eed5db3117a`). Baseline was the production prompt (SHA256 `4ff692b9440a0ae85098200c379a55bd3530885777ea719fa62a9a6886308227`). Source report: `/tmp/reviewer-prompt-gpt-report.md`; raw and scored results: `~/stock-bench/review-bench/gpt/`. These are read-only sources, not bundled with the product.

## Criterion coverage

| Criterion or situation | Final reviewer rule | Boundary |
|---|---|---|
| Agreement-only check | Two passes over in-scope requirements, then in-scope changes | No new stylistic requirements |
| Custom criterion beyond agreement | Criterion sets scope; REQUIREMENT quotes agreement **or criterion** with source | A valid criterion-only defect remains reportable |
| Excluded subject or deferred pass | Do not report what criterion excludes or leaves to another pass | Do not treat excluded work as a missing requirement |
| Independent reviewer on Main's team | Main's verdict is not evidence; quote both sources verbatim | Main still resolves verdict through plugin-only `NEXT` |
| Named source or reference | Initial whole-file reads without offset/limit; follow truncation offset; read required definitions | Missing source becomes UNCHECKED, not a made-up finding |
| Multiple defects or repeated value | Independently fixable omissions get separate findings; repeated wrong value and its test get one | General request for tests does not imply extra coverage |
| Evidence and output | Copy file text without escaping, diff markers or placeholders; one EVIDENCE field and one concrete REQUIRED OUTCOME | No line numbers, no `yield`; exactly `CLEAN` on checked clean work |
| Unavailable source or runtime-only check | UNCHECKED names source or check and reason | An available in-scope file must be read |

`buildBrief` passes user messages verbatim, optional `<agreement>`, `<object>`, `<criterion>` and optional `<rejected_earlier>`. The extension still loads only `REVIEWER.md` plus Pi's `<cwd>` for the reviewer, with read/grep/find; `DESCRIPTION` and verdict `NEXT` are the main-agent side of this plugin-only pair. `LEVELS` stays Haiku 5.5 medium / Sonnet 5.5 low. No `SYSTEM.md` change and no Claude-model inference from these GPT runs.

## Paired result and limits

Final comparison: the same 12 cases, three runs per case per model and prompt (36 runs each), with GPT-6-sol low and GPT-6.1-sol low. The 12 include eight repeated controls and four GPT-held-out cases (`docs-sla-far`, `py-order-mismatch`, `ts-wrong-paths`, `py-medium-clean`); these four had historical Claude runs, not new Claude probes. Three GPT-6.1-sol low judge votes per answer, majority; baseline success/judge caches reused. Historical inventory was recovered without reruns: 49 configurations, 4142 successful runs and 2453 saved judge-vote files. The candidate followed two rejected/revised variants; 408 new reviewer runs were made across the bounded rounds, plus two OAuth probes.

| Metric | GPT-6 baseline | GPT-6 final | GPT-6.1 baseline | GPT-6.1 final |
|---|---:|---:|---:|---:|
| Successful runs | 36/36 | 36/36 | 36/36 | 36/36 |
| Seeded recall | 87/90 | 86/90 | 87/90 | 87/90 |
| False findings after symmetric audit | 6 | 0 | 0 | 0 |
| Clean-case CLEAN | 3/3 | 3/3 | 3/3 | 3/3 |
| Format | 36/36 | 36/36 | 36/36 | 36/36 |
| Merged independent defects | 2 | 0 | 3 | 1 |
| Distorted EVIDENCE spans | 5 | 1 | 1 | 0 |
| Numeric initial read offset/limit | 0 | 0 | 40 | 0 |
| Mean seconds | 7.9 | 9.2 | 10.8 | 12.3 |

The original GPT judge marked two GPT-6 baseline false findings; symmetric source audit found six. Both final configurations were already at zero before audit. The extra GPT-6 missed requirement is `docs-long-spec` run 1, the old `four channels` statement. Paired case bootstrap for its recall difference is -1.11 percentage points, 95% interval [-3.23, 0.00]; the historical -2-point noninferiority threshold is not met. GPT-6.1 unchanged recall on this saturated small set does not establish universal non-regression. All four configurations found 27/27 seeded defects on the four held-out cases; each had 3/3 CLEAN and 12/12 format there. Both prompts still miss `requests per hour` in `ts-contradiction-parts`. One final GPT-6 quote lost inner backticks, and duplicate findings remain. Large truncated-file continuation was not separately tested. Timings are descriptive, not causal: baseline runs were reused. This adopts the measured functional scope, flexibility and quote-format changes, not a claim of universal recall improvement or better speed. Product Haiku/Sonnet prompt behavior has not been measured with this candidate.
