# Reviewer probes: detection, disputes, main side

Measurements behind the `RQW-review` pair contract (`DECISIONS.md` section Review): which reviewer model and thinking level to use, and how the dispute wording in `extensions/RQW-review/REVIEWER.md` and `NEXT` behaves on models. Text under test: branch `review-pair` (ddcbc28, 254ae51), measured on 2026-10-21 and 2026-10-22. Raw runs are not bundled in the repository; they are kept outside it in `/Users/arkadijcukavin/ai-project/my-pi-evidence/reviewer-probes/` (see "Sources of the numbers"). This file keeps the summary tables only. Prices are Pi list prices; the campaign cost about 210 USD.

Result in short:
- Recommended wording: four edits in `REVIEWER.md` (variant v3h) and one sentence in `NEXT.findings` (variant n1), listed in "Recommended wording" below.
- Recommended reviewer configs: Claude main: `blind` Haiku 5.5 medium, `high` Sonnet 5.5 low (with tolerant verdict extraction); GPT main: `blind` GPT-6.1-Sol low, `high` GPT-6.1-Sol medium on quality; the owner chose GPT-5.6-Luna medium and high instead (section "GPT match for the Claude slots"). GPT-6-Luna is unusable.
- Adopted by the owner's answer «2а 3а» (`DECISIONS.md` section Review): the family table in `LEVELS` with the reviewer of the other family as fallback (its GPT row is the owner's choice, GPT-5.6-Luna medium for `blind` and high for `high`, see "GPT match for the Claude slots"), an unagreed addition that Main defends is `DECIDED` (the "or REQUIREMENT would be `NOT AGREED`" clause of v3h is dropped and one exception sentence is added after the probes, so the adopted text was not measured as a whole), and tolerant verdict extraction (`verdictOf` in `index.ts`).

## Method

- Phase 1, detection: 40 known-answer cases (documents, TypeScript, Python, clean cases, large changes) x 3 runs per config, production brief and read-only tools of the reviewer, judged by Opus 5.5 medium with 3 votes (majority). 1200 passes with the committed text, 960 with the recommended text (8 configs, Luna not rerun).
- Phase 2, disputes: 49 fixtures x 3 runs per config and text variant. A fixture is a finished piece of work, a reviewer finding, and Main's one rebuttal. The reviewer is a fresh session that gets the brief with `<disputes>` (the finding as written, Main's quote, source and explanation). The scorer reads the reply as the extension does: a reply that does not start with `CLEAN` or `FINDINGS:` answers nothing.
  - U (19 items): the finding is right, the rebuttal is invalid, the user's words settle it. Expected: repeated with `RULING: DECIDED`.
  - W/X (25 items): the finding misread the agreement or the object; the rebuttal quotes the user, the agreement or the code and shows it. Expected: the finding is left out (withdrawn).
  - N (12 items): the work supplied a value, default or rule the user never gave. Expected: repeated with `RULING: UNDECIDED`.
  - C (5 fixtures, added later): the user's words allow two readings (last calendar month or last 30 days, 5 MB as 10^6 or 2^20 bytes, "after three wrong entries" on the third or fourth, working days with or without public holidays, a session of 30 minutes from creation or from last activity), Main chose one, the finding insists on the other. Expected: `RULING: UNDECIDED`. Owner, 2026-10-21: «Если вдруг получилось так, что основной мейн-агент, который выполняет работу, проебался и не собрал детерминированное решение, и агенту пришлось выбирать, и оно конфликтует с тем, что сказал пользователь, то нужно вмешательство пользователя.»
  - U12 (one of the U items) is a finding with REQUIREMENT `NOT AGREED` (an addition Main defends as useful); it is reported apart (limits below).
  - Six mixed fixtures (M1-M6) carry several disputes in one pass.
- Main side: a main-model session with the real `RQW-prompt` system prompt and `RQW-tools`, stub `review` and `agent` tools with the real descriptions and refusal rules, and a fixed verdict message built by the real `verdictMessage`. Round 1: the first verdict with the disputed finding (expected: U fix, W/X rebut with the quote, N put to the user; a rebuttal on an N finding is an acceptable detour). Round 2: the next reviewer's final answer (U DECIDED: fix; N UNDECIDED: ask the user; W withdrawn: nothing to do). Round 2w: the reviewer wrongly repeats a valid-rebuttal finding as DECIDED (owner: Main "accepts or goes to the user", so fix, ask or report to the user are acceptable). 43 fixtures x 3 runs per round.
- Configs: Haiku 5.5 low and medium, Sonnet 5.5 low and medium, GPT-6.1-Sol low and medium, GPT-6-Sol low and medium, GPT-6-Luna low and medium; main configs GPT-6.1-Sol medium, Opus 5.5 low, Sonnet 5.5 high. All through the Pi SDK with the owner's OAuth logins.

Variants of the dispute text (against the committed v2 text):

| variant | change |
|---|---|
| v3a | silent withdrawal: never write that a dispute is withdrawn; no text before or after the verdict |
| v3b | RULING wording: DECIDED only when the user's own words state the value; UNDECIDED when the work or Main supplied a value, threshold, default, format or scope, or REQUIREMENT would be `NOT AGREED` |
| v3c | v3a + v3b |
| v3d | v3c with a longer silent-withdrawal sentence and the one-sentence 20-word rule tightened |
| v3e | v3d + one closing line in the brief (a change in `index.ts`): answer the disputes through the verdict only |
| v3f | v3c + the tightened 20-word rule of v3d |
| v3g | v3f + "or Main made a choice of its own that differs from what the user said" restored in UNDECIDED |
| v3h | v3g + a strict withdrawal test: a rebuttal withdraws a finding only when its quote rules the finding out; a quote that allows the finding's reading as well, or Main's own convention, preference or assumption, shows nothing |
| n1 | one sentence in `NEXT.findings`: a finding that rests on a value, rule or choice the user never gave is put to the user, not fixed with another choice of Main |

## Phase 1: detection

Recall is the judged hit rate over 270 chances per config; "mech." is the lower bound by verbatim quote match.

### Committed `REVIEWER.md` (no dispute text)

| config | recall (judge) | recall mech. lower bound | recall of 2 passes | perfect passes | false findings (trap+invalid) | unseeded valid | CLEAN on 33 clean cases | false CLEAN | reply format ok | findings over the one-sentence 20-word rule | sec mean / p90 | cost/pass | out tok |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Haiku 5.5 low | 93.3% (252/270) | 82.6% | 94.1% | 64/87 | 8 (3+5) | 2 | 31/33 | 0 | 119/120 | 32 | 10.1 / 16.3 | $0.0017 | 1678 |
| Haiku 5.5 medium | 97.0% (262/270) | 88.1% | 97.8% | 73/87 | 7 (2+5) | 0 | 32/33 | 0 | 120/120 | 34 | 12.6 / 19.4 | $0.0020 | 2116 |
| Sonnet 5.5 low | 96.7% (261/270) | 90.0% | 96.7% | 63/87 | 15 (2+13) | 2 | 33/33 | 0 | 116/120 | 56 | 7.2 / 10.5 | $0.0205 | 772 |
| Sonnet 5.5 medium | 96.3% (260/270) | 90.4% | 96.7% | 62/87 | 16 (3+13) | 2 | 33/33 | 0 | 116/120 | 54 | 8.0 / 10.9 | $0.0223 | 866 |
| GPT-6.1-Sol low | 95.6% (258/270) | 91.5% | 96.3% | 71/87 | 12 (1+11) | 8 | 30/33 | 0 | 120/120 | 0 | 17.3 / 22.7 | $0.0180 | 516 |
| GPT-6.1-Sol medium | 96.3% (260/270) | 93.7% | 96.7% | 69/87 | 20 (5+15) | 6 | 30/33 | 0 | 120/120 | 0 | 16.9 / 26.3 | $0.0180 | 583 |
| GPT-6-Sol low | 96.7% (261/270) | 88.5% | 96.7% | 70/87 | 26 (3+23) | 4 | 27/33 | 0 | 120/120 | 0 | 10.6 / 17.0 | $0.0159 | 526 |
| GPT-6-Sol medium | 97.0% (262/270) | 91.5% | 97.4% | 66/87 | 31 (4+27) | 12 | 29/33 | 0 | 120/120 | 0 | 19.4 / 30.1 | $0.0198 | 781 |
| GPT-6-Luna low | 77.8% (210/270) | 64.1% | 87.0% | 36/87 | 24 (8+16) | 0 | 18/33 | 0 | 120/120 | 6 | 7.1 / 11.5 | $0.0008 | 456 |
| GPT-6-Luna medium | 80.0% (216/270) | 70.4% | 91.5% | 44/87 | 22 (5+17) | 2 | 23/33 | 0 | 120/120 | 1 | 8.9 / 15.1 | $0.0009 | 504 |

### Recommended text (v3f; Luna not rerun)

| config | recall (judge) | recall mech. lower bound | recall of 2 passes | perfect passes | false findings (trap+invalid) | unseeded valid | CLEAN on 33 clean cases | false CLEAN | reply format ok | findings over the one-sentence 20-word rule | sec mean / p90 | cost/pass | out tok |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Haiku 5.5 low | 94.1% (254/270) | 83.0% | 95.2% | 69/87 | 2 (0+2) | 0 | 33/33 | 0 | 117/120 | 9 | 11.2 / 17.7 | $0.0018 | 1717 |
| Haiku 5.5 medium | 95.6% (258/270) | 86.3% | 97.0% | 75/87 | 1 (0+1) | 1 | 33/33 | 0 | 116/120 | 7 | 14.4 / 22.3 | $0.0022 | 2365 |
| Sonnet 5.5 low | 96.7% (261/270) | 89.6% | 96.7% | 64/87 | 15 (0+15) | 1 | 33/33 | 0 | 113/120 | 18 | 6.7 / 9.5 | $0.0226 | 768 |
| Sonnet 5.5 medium | 96.7% (261/270) | 88.5% | 96.7% | 60/87 | 18 (1+17) | 0 | 33/33 | 0 | 118/120 | 26 | 7.6 / 10.5 | $0.0245 | 873 |
| GPT-6.1-Sol low | 95.2% (257/270) | 90.7% | 95.6% | 69/87 | 11 (1+10) | 9 | 30/33 | 0 | 111/120 | 9 | 13.9 / 21.9 | $0.0158 | 534 |
| GPT-6.1-Sol medium | 96.3% (260/270) | 91.9% | 97.0% | 71/87 | 14 (1+13) | 8 | 30/33 | 0 | 111/120 | 9 | 15.5 / 23.0 | $0.0162 | 583 |
| GPT-6-Sol low | 96.7% (261/270) | 89.3% | 96.7% | 66/87 | 24 (5+19) | 2 | 27/33 | 0 | 120/120 | 0 | 9.3 / 13.8 | $0.0133 | 528 |
| GPT-6-Sol medium | 96.3% (260/270) | 91.5% | 96.7% | 67/87 | 19 (1+18) | 10 | 31/33 | 0 | 120/120 | 0 | 15.2 / 23.4 | $0.0166 | 770 |

The "format" failures of GPT-6.1-Sol (9 passes) and Haiku (3 and 4 passes) in this rerun are the three old `rejected` cases: the Phase 1 brief still passes the old `rejected` block and the new text answers it with dispute fields. The pair contract has no such block any more. v3h differs from v3f only inside the dispute paragraph, which a brief without `<disputes>` does not trigger.

### Pooled over both runs

| config | recall, both Phase 1 runs pooled (6 passes per case) | false findings per 240 passes | CLEAN on clean cases (of 66) | sec mean | cost/pass |
|---|---|---|---|---|---|
| Haiku 5.5 low | 93.7% (506/540) | 10 | 64/66 | 10.6 | $0.0018 |
| Haiku 5.5 medium | 96.3% (520/540) | 8 | 65/66 | 13.5 | $0.0021 |
| Sonnet 5.5 low | 96.7% (522/540) | 30 | 66/66 | 7.0 | $0.0216 |
| Sonnet 5.5 medium | 96.5% (521/540) | 34 | 66/66 | 7.8 | $0.0234 |
| GPT-6.1-Sol low | 95.4% (515/540) | 23 | 60/66 | 15.6 | $0.0169 |
| GPT-6.1-Sol medium | 96.3% (520/540) | 34 | 60/66 | 16.2 | $0.0171 |
| GPT-6-Sol low | 96.7% (522/540) | 50 | 54/66 | 10.0 | $0.0146 |
| GPT-6-Sol medium | 96.7% (522/540) | 50 | 60/66 | 17.3 | $0.0182 |

At 540 chances the standard error of a recall near 96% is about 0.8 points, so Haiku medium, Sonnet low and medium, GPT-6.1-Sol and GPT-6-Sol cannot be told apart on recall; Haiku low is about 2.6 points lower. A second, different reviewer adds little (union recall in the first run: Haiku medium + Sonnet low 97.4%, Haiku medium + GPT-6.1-Sol low 97.8%, Sonnet low + GPT-6.1-Sol low 98.1%, against 95.6-97.0% single). Sonnet answers all 66 clean cases with CLEAN; GPT-6.1-Sol 60/66; GPT-6-Sol low 54/66.

The recommended text shortens findings: findings over the one-sentence 20-word rule fall from 32 to 9 (Haiku low), 34 to 7 (Haiku medium), 56 to 18 (Sonnet low), 54 to 26 (Sonnet medium); GPT stays at 0.

GPT-6-Luna (low / medium) is unusable: recall 77.8% / 80.0%, 18/33 and 23/33 clean cases answered CLEAN, 24 and 22 false findings; in disputes (v2) it repeats withdrawn findings in 28 and 14 of 75 W/X items and finds 62/174 and 103/174 seeded defects (the other configs 116-162). Its only strengths are price (0.0006-0.0009 USD per pass) and speed (8 s).

## Phase 2: disputes

Columns: U = items repeated with `RULING: DECIDED` (U12 aside); U12 = DECIDED on the unagreed addition (of 3); W/X = items withdrawn (of 75); N = items ruled UNDECIDED (of 36); N withdrawn = undecided items the reviewer left out; N wrongly DECIDED; "reply start broken" = passes whose reply does not start with `CLEAN` or `FINDINGS:` (the dispute stays open); "length rule" = passes with a MISMATCH or REQUIRED OUTCOME over 20 words or with a second sentence; "seeded defects also found" = other seeded defects of the case that the reply quotes (mechanical lower bound); "unmatched new findings" = findings that match neither the dispute nor a seeded defect.

### Baseline: the committed v2 dispute text

| config | U DECIDED (U12 aside) | U12 unagreed addition: DECIDED | W/X withdrawn | N UNDECIDED | N withdrawn | N wrongly DECIDED | W/X repeated or invalid | verdict start broken (prose before) | length-rule passes | strict format ok | seeded defects also found | unmatched new findings | sec | cost/pass |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Haiku 5.5 low | 54/54 | 3/3 | 74/75 | 33/36 | 0 | 3 | 1 | 1 | 7/147 | 137/147 | 140/174 | 26 | 11.4 | $0.0017 |
| Haiku 5.5 medium | 54/54 | 3/3 | 75/75 | 29/36 | 4 | 3 | 0 | 0 | 10/147 | 137/147 | 144/174 | 23 | 14.1 | $0.0020 |
| Sonnet 5.5 low | 48/54 | 3/3 | 49/75 | 33/36 | 2 | 0 | 26 | 22 | 41/147 | 83/147 | 116/174 | 34 | 7.0 | $0.0205 |
| Sonnet 5.5 medium | 51/54 | 2/3 | 64/75 | 32/36 | 2 | 0 | 11 | 10 | 35/147 | 97/147 | 142/174 | 30 | 7.8 | $0.0223 |
| GPT-6.1-Sol low | 54/54 | 3/3 | 75/75 | 24/36 | 12 | 0 | 0 | 0 | 0/147 | 147/147 | 162/174 | 35 | 13.9 | $0.0158 |
| GPT-6.1-Sol medium | 54/54 | 3/3 | 75/75 | 24/36 | 12 | 0 | 0 | 0 | 1/147 | 146/147 | 162/174 | 37 | 15.6 | $0.0164 |
| GPT-6-Sol low | 54/54 | 3/3 | 75/75 | 12/36 | 23 | 1 | 0 | 0 | 0/147 | 147/147 | 151/174 | 53 | 10.2 | $0.0117 |
| GPT-6-Sol medium | 54/54 | 3/3 | 75/75 | 14/36 | 22 | 0 | 0 | 0 | 0/147 | 147/147 | 150/174 | 65 | 17.1 | $0.0152 |
| GPT-6-Luna low | 50/54 | 3/3 | 47/75 | 34/36 | 0 | 2 | 28 | 0 | 2/147 | 140/147 | 62/174 | 15 | 8.4 | $0.0006 |
| GPT-6-Luna medium | 51/54 | 3/3 | 61/75 | 25/36 | 8 | 3 | 14 | 0 | 1/147 | 142/147 | 103/174 | 35 | 8.5 | $0.0007 |

### Recommended text: v3h

| config | U DECIDED (U12 aside) | U12 unagreed addition: DECIDED | W/X withdrawn | N UNDECIDED | N withdrawn | N wrongly DECIDED | W/X repeated or invalid | verdict start broken (prose before) | length-rule passes | strict format ok | seeded defects also found | unmatched new findings | sec | cost/pass |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Haiku 5.5 low | 54/54 | 2/3 | 75/75 | 36/36 | 0 | 0 | 0 | 0 | 0/147 | 145/147 | 137/174 | 29 | 11.9 | $0.0018 |
| Haiku 5.5 medium | 54/54 | 3/3 | 74/75 | 36/36 | 0 | 0 | 1 | 1 | 2/147 | 141/147 | 145/174 | 22 | 15.0 | $0.0021 |
| Sonnet 5.5 low | 54/54 | 2/3 | 67/75 | 33/36 | 0 | 0 | 8 | 11 | 6/147 | 127/147 | 136/174 | 33 | 6.3 | $0.0208 |
| Sonnet 5.5 medium | 53/54 | 1/3 | 72/75 | 36/36 | 0 | 0 | 3 | 4 | 14/147 | 126/147 | 149/174 | 38 | 7.2 | $0.0230 |
| GPT-6.1-Sol low | 54/54 | 0/3 | 75/75 | 36/36 | 0 | 0 | 0 | 0 | 0/147 | 147/147 | 159/174 | 41 | 15.0 | $0.0152 |
| GPT-6.1-Sol medium | 54/54 | 0/3 | 75/75 | 36/36 | 0 | 0 | 0 | 0 | 0/147 | 147/147 | 159/174 | 39 | 14.7 | $0.0159 |
| GPT-6-Sol low | 54/54 | 2/3 | 74/75 | 33/36 | 3 | 0 | 1 | 0 | 1/147 | 146/147 | 150/174 | 37 | 8.9 | $0.0120 |
| GPT-6-Sol medium | 54/54 | 0/3 | 75/75 | 35/36 | 1 | 0 | 0 | 0 | 0/147 | 147/147 | 153/174 | 61 | 14.9 | $0.0153 |

### All variants

Every cell is 147 passes (3 runs x 49 fixtures: 43 single-dispute fixtures and M1-M6); `-` = not run; Luna ran only on v2.

**A. Dispute items resolved as intended (165 items: 54 U DECIDED + 75 W/X withdrawn + 36 N UNDECIDED; U12 aside)**

| config | v2 | v3a | v3b | v3c | v3d | v3e | v3f | v3h |
|---|---|---|---|---|---|---|---|---|
| Haiku 5.5 low | 161/165 | 159/165 | 165/165 | 165/165 | 165/165 | 165/165 | 165/165 | 165/165 |
| Haiku 5.5 medium | 158/165 | 162/165 | 165/165 | 164/165 | 164/165 | 165/165 | 165/165 | 164/165 |
| Sonnet 5.5 low | 130/165 | 148/165 | 133/165 | 156/165 | 144/165 | 149/165 | 150/165 | 154/165 |
| Sonnet 5.5 medium | 147/165 | 148/165 | 140/165 | 161/165 | 156/165 | 148/165 | 156/165 | 161/165 |
| GPT-6.1-Sol low | 153/165 | 151/165 | 161/165 | 162/165 | 161/165 | - | 163/165 | 165/165 |
| GPT-6.1-Sol medium | 153/165 | 151/165 | 164/165 | 162/165 | 162/165 | - | 164/165 | 165/165 |
| GPT-6-Sol low | 141/165 | 143/165 | 151/165 | 154/165 | 153/165 | - | 152/165 | 161/165 |
| GPT-6-Sol medium | 143/165 | 144/165 | 156/165 | 153/165 | 155/165 | - | 156/165 | 164/165 |
| GPT-6-Luna low | 131/165 | - | - | - | - | - | - | - |
| GPT-6-Luna medium | 137/165 | - | - | - | - | - | - | - |

**B. N items ruled UNDECIDED (of 36)**

| config | v2 | v3a | v3b | v3c | v3d | v3e | v3f | v3h |
|---|---|---|---|---|---|---|---|---|
| Haiku 5.5 low | 33/36 | 30/36 | 36/36 | 36/36 | 36/36 | 36/36 | 36/36 | 36/36 |
| Haiku 5.5 medium | 29/36 | 34/36 | 36/36 | 36/36 | 36/36 | 36/36 | 36/36 | 36/36 |
| Sonnet 5.5 low | 33/36 | 33/36 | 31/36 | 34/36 | 34/36 | 34/36 | 34/36 | 33/36 |
| Sonnet 5.5 medium | 32/36 | 32/36 | 36/36 | 36/36 | 36/36 | 35/36 | 36/36 | 36/36 |
| GPT-6.1-Sol low | 24/36 | 22/36 | 32/36 | 33/36 | 32/36 | - | 34/36 | 36/36 |
| GPT-6.1-Sol medium | 24/36 | 22/36 | 35/36 | 33/36 | 33/36 | - | 35/36 | 36/36 |
| GPT-6-Sol low | 12/36 | 15/36 | 22/36 | 26/36 | 24/36 | - | 25/36 | 33/36 |
| GPT-6-Sol medium | 14/36 | 15/36 | 27/36 | 24/36 | 26/36 | - | 27/36 | 35/36 |
| GPT-6-Luna low | 34/36 | - | - | - | - | - | - | - |
| GPT-6-Luna medium | 25/36 | - | - | - | - | - | - | - |

**C. W/X items withdrawn (of 75)**

| config | v2 | v3a | v3b | v3c | v3d | v3e | v3f | v3h |
|---|---|---|---|---|---|---|---|---|
| Haiku 5.5 low | 74/75 | 75/75 | 75/75 | 75/75 | 75/75 | 75/75 | 75/75 | 75/75 |
| Haiku 5.5 medium | 75/75 | 74/75 | 75/75 | 74/75 | 74/75 | 75/75 | 75/75 | 74/75 |
| Sonnet 5.5 low | 49/75 | 67/75 | 50/75 | 68/75 | 59/75 | 63/75 | 69/75 | 67/75 |
| Sonnet 5.5 medium | 64/75 | 66/75 | 54/75 | 71/75 | 70/75 | 60/75 | 66/75 | 72/75 |
| GPT-6.1-Sol low | 75/75 | 75/75 | 75/75 | 75/75 | 75/75 | - | 75/75 | 75/75 |
| GPT-6.1-Sol medium | 75/75 | 75/75 | 75/75 | 75/75 | 75/75 | - | 75/75 | 75/75 |
| GPT-6-Sol low | 75/75 | 74/75 | 75/75 | 74/75 | 75/75 | - | 73/75 | 74/75 |
| GPT-6-Sol medium | 75/75 | 75/75 | 75/75 | 75/75 | 75/75 | - | 75/75 | 75/75 |
| GPT-6-Luna low | 47/75 | - | - | - | - | - | - | - |
| GPT-6-Luna medium | 61/75 | - | - | - | - | - | - | - |

**D. Passes whose reply does not start with CLEAN or FINDINGS: (of 147)**

| config | v2 | v3a | v3b | v3c | v3d | v3e | v3f | v3h |
|---|---|---|---|---|---|---|---|---|
| Haiku 5.5 low | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Haiku 5.5 medium | 0 | 1 | 0 | 1 | 0 | 0 | 0 | 1 |
| Sonnet 5.5 low | 22 | 11 | 21 | 5 | 15 | 11 | 11 | 11 |
| Sonnet 5.5 medium | 10 | 5 | 14 | 2 | 7 | 12 | 5 | 4 |
| GPT-6.1-Sol low | 0 | 0 | 0 | 0 | 0 | - | 0 | 0 |
| GPT-6.1-Sol medium | 0 | 0 | 0 | 0 | 0 | - | 0 | 0 |
| GPT-6-Sol low | 0 | 1 | 0 | 1 | 0 | - | 2 | 0 |
| GPT-6-Sol medium | 0 | 0 | 0 | 0 | 0 | - | 0 | 0 |
| GPT-6-Luna low | 0 | - | - | - | - | - | - | - |
| GPT-6-Luna medium | 0 | - | - | - | - | - | - | - |

**E. Passes breaking the one-sentence 20-word rule of MISMATCH / REQUIRED OUTCOME (of 147)**

| config | v2 | v3a | v3b | v3c | v3d | v3e | v3f | v3h |
|---|---|---|---|---|---|---|---|---|
| Haiku 5.5 low | 7 | 10 | 8 | 10 | 3 | 1 | 0 | 0 |
| Haiku 5.5 medium | 10 | 11 | 14 | 5 | 1 | 2 | 1 | 2 |
| Sonnet 5.5 low | 41 | 29 | 42 | 30 | 12 | 7 | 5 | 6 |
| Sonnet 5.5 medium | 35 | 44 | 35 | 38 | 12 | 18 | 21 | 14 |
| GPT-6.1-Sol low | 0 | 0 | 0 | 0 | 0 | - | 0 | 0 |
| GPT-6.1-Sol medium | 1 | 0 | 0 | 0 | 0 | - | 0 | 0 |
| GPT-6-Sol low | 0 | 0 | 0 | 0 | 0 | - | 0 | 1 |
| GPT-6-Sol medium | 0 | 0 | 0 | 0 | 0 | - | 0 | 0 |
| GPT-6-Luna low | 2 | - | - | - | - | - | - | - |
| GPT-6-Luna medium | 1 | - | - | - | - | - | - | - |

**F. U12 (unagreed addition, a NOT AGREED finding) ruled DECIDED (of 3)**

| config | v2 | v3a | v3b | v3c | v3d | v3e | v3f | v3h |
|---|---|---|---|---|---|---|---|---|
| Haiku 5.5 low | 3/3 | 3/3 | 3/3 | 2/3 | 3/3 | 3/3 | 2/3 | 2/3 |
| Haiku 5.5 medium | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 2/3 | 1/3 | 3/3 |
| Sonnet 5.5 low | 3/3 | 2/3 | 1/3 | 2/3 | 1/3 | 0/3 | 1/3 | 2/3 |
| Sonnet 5.5 medium | 2/3 | 2/3 | 0/3 | 0/3 | 1/3 | 1/3 | 1/3 | 1/3 |
| GPT-6.1-Sol low | 3/3 | 3/3 | 0/3 | 0/3 | 0/3 | - | 0/3 | 0/3 |
| GPT-6.1-Sol medium | 3/3 | 3/3 | 0/3 | 0/3 | 0/3 | - | 0/3 | 0/3 |
| GPT-6-Sol low | 3/3 | 3/3 | 0/3 | 2/3 | 1/3 | - | 1/3 | 2/3 |
| GPT-6-Sol medium | 3/3 | 3/3 | 0/3 | 0/3 | 0/3 | - | 0/3 | 0/3 |
| GPT-6-Luna low | 3/3 | - | - | - | - | - | - | - |
| GPT-6-Luna medium | 3/3 | - | - | - | - | - | - | - |

### Sonnet's remark before `FINDINGS:`

Pooled over the variants that carry the silent-withdrawal sentence (v3a, c, d, e, f) against those that do not (v2, v3b):

| Sonnet config | variants | passes | reply does not start with CLEAN/FINDINGS: | share |
|---|---|---|---|---|
| Sonnet 5.5 low | without the silent sentence (v2, v3b) | 294 | 43 | 14.6% |
| Sonnet 5.5 low | with it (v3a, v3c, v3d, v3e, v3f) | 735 | 53 | 7.2% |
| Sonnet 5.5 medium | without the silent sentence (v2, v3b) | 294 | 24 | 8.2% |
| Sonnet 5.5 medium | with it (v3a, v3c, v3d, v3e, v3f) | 735 | 31 | 4.2% |

The sentence halves the failure; no wording removes it (v3h: 11/147 on low, 4/147 on medium). Haiku and the GPT configs show 0-2 passes in every variant. The failure is always a one-line remark about the dispute before `FINDINGS:`, mostly when a dispute is withdrawn and other findings remain. A closing reminder in the brief (v3e) did not help. In the extension such a reply is classified `findings` but has no finding blocks, so the dispute stays open and Main receives findings it cannot rebut. If the verdict started at the first line that is exactly `FINDINGS:` (or `CLEAN` were accepted as the last line), the same replies would score as follows (v3h):

| config | U DECIDED (U12 aside) | U12 unagreed addition: DECIDED | W/X withdrawn | N UNDECIDED | N withdrawn | N wrongly DECIDED | W/X repeated or invalid | verdict start broken (prose before) | length-rule passes | strict format ok | seeded defects also found | unmatched new findings | sec | cost/pass |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Haiku 5.5 low | 54/54 | 2/3 | 75/75 | 36/36 | 0 | 0 | 0 | 0 | 0/147 | 145/147 | 137/174 | 29 | 11.9 | $0.0018 |
| Haiku 5.5 medium | 54/54 | 3/3 | 74/75 | 36/36 | 0 | 0 | 1 | 1 | 2/147 | 141/147 | 145/174 | 22 | 15.0 | $0.0021 |
| Sonnet 5.5 low | 54/54 | 2/3 | 75/75 | 36/36 | 0 | 0 | 0 | 0 | 6/147 | 138/147 | 157/174 | 36 | 6.3 | $0.0208 |
| Sonnet 5.5 medium | 54/54 | 1/3 | 75/75 | 36/36 | 0 | 0 | 0 | 0 | 15/147 | 129/147 | 160/174 | 39 | 7.2 | $0.0230 |

### Two-readings fixtures (C01-C05)

Per fixture: UNDECIDED out of 3 runs. C03 has the weakest second reading and nearly every config withdraws it.

**v2 (committed 254ae51)**

| config | UNDECIDED (of 15) | withdrawn | DECIDED | invalid | per fixture UNDECIDED (C01 C02 C03 C04 C05, of 3 each) |
|---|---|---|---|---|---|
| Haiku 5.5 low | 6/15 | 8 | 0 | 0 | 3 3 0 0 0 |
| Haiku 5.5 medium | 5/15 | 8 | 0 | 0 | 2 3 0 0 0 |
| Sonnet 5.5 low | 3/15 | 8 | 0 | 4 | 0 3 0 0 0 |
| Sonnet 5.5 medium | 6/15 | 9 | 0 | 0 | 3 3 0 0 0 |
| GPT-6.1-Sol low | 0/15 | 12 | 0 | 0 | 0 0 0 0 0 |
| GPT-6.1-Sol medium | 0/15 | 12 | 0 | 0 | 0 0 0 0 0 |
| GPT-6-Sol low | 1/15 | 14 | 0 | 0 | 1 0 0 0 0 |
| GPT-6-Sol medium | 1/15 | 14 | 0 | 0 | 0 0 0 1 0 |

**v3f**

| config | UNDECIDED (of 15) | withdrawn | DECIDED | invalid | per fixture UNDECIDED (C01 C02 C03 C04 C05, of 3 each) |
|---|---|---|---|---|---|
| Haiku 5.5 low | 10/15 | 5 | 0 | 0 | 3 3 1 0 3 |
| Haiku 5.5 medium | 8/15 | 7 | 0 | 0 | 3 3 1 1 0 |
| Sonnet 5.5 low | 2/15 | 6 | 0 | 6 | 1 1 0 0 0 |
| Sonnet 5.5 medium | 7/15 | 8 | 0 | 0 | 3 3 0 0 1 |
| GPT-6.1-Sol low | 2/15 | 11 | 0 | 0 | 2 0 0 0 0 |
| GPT-6.1-Sol medium | 1/15 | 11 | 0 | 0 | 0 0 0 1 0 |
| GPT-6-Sol low | 0/15 | 15 | 0 | 0 | 0 0 0 0 0 |
| GPT-6-Sol medium | 2/15 | 13 | 0 | 0 | 0 0 0 2 0 |

**v3g (v3f + 'a choice Main made itself that differs from what the user said')**

| config | UNDECIDED (of 15) | withdrawn | DECIDED | invalid | per fixture UNDECIDED (C01 C02 C03 C04 C05, of 3 each) |
|---|---|---|---|---|---|
| Haiku 5.5 low | 10/15 | 5 | 0 | 0 | 3 3 1 0 3 |
| Haiku 5.5 medium | 8/15 | 7 | 0 | 0 | 3 3 1 0 1 |
| Sonnet 5.5 low | 2/15 | 6 | 0 | 6 | 1 0 0 1 0 |
| Sonnet 5.5 medium | 5/15 | 7 | 0 | 1 | 3 2 0 0 0 |
| GPT-6.1-Sol low | 0/15 | 12 | 0 | 0 | 0 0 0 0 0 |
| GPT-6.1-Sol medium | 2/15 | 10 | 0 | 0 | 1 0 0 1 0 |
| GPT-6-Sol low | 0/15 | 14 | 0 | 0 | 0 0 0 0 0 |
| GPT-6-Sol medium | 0/15 | 15 | 0 | 0 | 0 0 0 0 0 |

**v3h (v3g + strict withdrawal test)**

| config | UNDECIDED (of 15) | withdrawn | DECIDED | invalid | per fixture UNDECIDED (C01 C02 C03 C04 C05, of 3 each) |
|---|---|---|---|---|---|
| Haiku 5.5 low | 11/15 | 4 | 0 | 0 | 3 3 1 1 3 |
| Haiku 5.5 medium | 11/15 | 3 | 0 | 0 | 3 3 1 3 1 |
| Sonnet 5.5 low | 3/15 | 6 | 0 | 5 | 3 0 0 0 0 |
| Sonnet 5.5 medium | 9/15 | 4 | 0 | 0 | 3 3 0 1 2 |
| GPT-6.1-Sol low | 8/15 | 4 | 0 | 0 | 3 2 0 3 0 |
| GPT-6.1-Sol medium | 9/15 | 4 | 0 | 0 | 3 3 0 3 0 |
| GPT-6-Sol low | 5/15 | 10 | 0 | 0 | 3 0 0 2 0 |
| GPT-6-Sol medium | 8/15 | 7 | 0 | 0 | 3 2 0 3 0 |

Restoring the "choice of its own" clause (v3g) did not change the reviewers; the strict withdrawal test of v3h did (GPT-6.1-Sol 0-2/15 to 8-9/15, Haiku 5-10/15 to 11/15). Restoring the clause does not turn clear decisions into UNDECIDED: v3g on 16 U fixtures gave 54/54 DECIDED on seven configs and 48/54 on Sonnet low.

### What each variant fixed

- GPT-sol "over-claiming DECIDED" was not reproduced on undecided points: GPT-6.1-Sol never ruled DECIDED on an N item in any variant. In v2 it did the opposite and withdrew 12 of 36 undecided findings (GPT-6 Sol 22-23), treating Main's default as acceptable. The DECIDED over-claims that occurred were Haiku's (3 N items in v2, 2-4 in v3a). v3h brings GPT-6.1-Sol to 36/36 UNDECIDED.
- 20-word rule: v3a-v3c did nothing for it (Sonnet 29-44 passes, Haiku 5-14). The tightened sentence of v3d/f/h takes Haiku to 0-3 passes and Sonnet low to 5-12; Sonnet medium stays at 12-21 (two short sentences).
- Sonnet's remark before the verdict: halved, not removed (above).

### U12: an unagreed addition that Main defends

U12 is a finding with REQUIREMENT `NOT AGREED` (a debug print that mixes into the CSV output); Main's rebuttal says the print is useful. The v2 text rules DECIDED (23/24 passes over the 8 configs). With the `NOT AGREED` clause of v3b-v3h GPT-6.1-Sol rules UNDECIDED in every run (0/3 DECIDED), GPT-6 Sol 0-2/3, Haiku 1-3/3, Sonnet 0-2/3. One fixture, three runs: the wording does not pin it.

## Main side

Decision classes come from the tool calls and the final text: `fix`, `rebut`, `ask` (a question block or question mark with no edit and no review call), `report` (round 2w: no edit, tells the user about the reviewer's claim), "extra edits elsewhere" (an edit that does not touch the disputed finding; Sonnet high fixes other real defects after a CLEAN or withdrawn answer), `none`. [v2] = committed `NEXT`; [n1] = with the one added sentence. Opus medium was not used: the development subagent rule of that time excluded it. The current table in `PROCESS.md` allows Opus 5.5 medium.

### Round 1

| main config | kind | n | acceptable | exact target | fix | rebut | fix+rebut | extra edits elsewhere | ask | report | rereview | none | errors | sec mean | cost/pass |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| GPT-6.1-Sol medium [v2] | uphold | 39 | 39/39 | 39/39 | 39 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 33.0 | $0.038 |
| GPT-6.1-Sol medium [v2] | withdraw | 60 | 60/60 | 60/60 | 0 | 60 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 28.0 | $0.033 |
| GPT-6.1-Sol medium [v2] | undecided | 30 | 18/30 | 12/30 | 12 | 6 | 0 | 0 | 12 | 0 | 0 | 0 | 0 | 22.5 | $0.028 |
| Opus 5.5 low [v2] | uphold | 39 | 39/39 | 39/39 | 39 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 13.7 | $0.056 |
| Opus 5.5 low [v2] | withdraw | 60 | 60/60 | 60/60 | 0 | 60 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 9.9 | $0.046 |
| Opus 5.5 low [v2] | undecided | 30 | 13/30 | 12/30 | 15 | 1 | 0 | 0 | 12 | 0 | 0 | 2 | 0 | 9.9 | $0.049 |
| Sonnet 5.5 high [v2] | uphold | 39 | 39/39 | 39/39 | 39 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 14.3 | $0.033 |
| Sonnet 5.5 high [v2] | withdraw | 60 | 60/60 | 60/60 | 0 | 48 | 0 | 12 | 0 | 0 | 0 | 0 | 0 | 12.3 | $0.033 |
| Sonnet 5.5 high [v2] | undecided | 30 | 13/30 | 13/30 | 17 | 0 | 0 | 0 | 13 | 0 | 0 | 0 | 0 | 11.6 | $0.030 |

| main config | kind | n | acceptable | exact target | fix | rebut | fix+rebut | extra edits elsewhere | ask | report | rereview | none | errors | sec mean | cost/pass |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| GPT-6.1-Sol medium [n1] | uphold | 39 | 39/39 | 39/39 | 39 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 30.4 | $0.036 |
| GPT-6.1-Sol medium [n1] | withdraw | 60 | 60/60 | 60/60 | 0 | 60 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 26.8 | $0.032 |
| GPT-6.1-Sol medium [n1] | undecided | 30 | 29/30 | 29/30 | 1 | 0 | 0 | 0 | 29 | 0 | 0 | 0 | 0 | 9.7 | $0.018 |
| Opus 5.5 low [n1] | uphold | 39 | 39/39 | 39/39 | 39 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 15.6 | $0.058 |
| Opus 5.5 low [n1] | withdraw | 60 | 60/60 | 60/60 | 0 | 59 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 10.4 | $0.046 |
| Opus 5.5 low [n1] | undecided | 30 | 27/30 | 27/30 | 3 | 0 | 0 | 0 | 27 | 0 | 0 | 0 | 0 | 6.2 | $0.035 |
| Sonnet 5.5 high [n1] | uphold | 39 | 39/39 | 39/39 | 39 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 13.9 | $0.033 |
| Sonnet 5.5 high [n1] | withdraw | 60 | 60/60 | 60/60 | 0 | 50 | 0 | 10 | 0 | 0 | 0 | 0 | 0 | 11.8 | $0.031 |
| Sonnet 5.5 high [n1] | undecided | 30 | 23/30 | 23/30 | 7 | 0 | 0 | 0 | 23 | 0 | 0 | 0 | 0 | 8.3 | $0.022 |

With the committed text, undecided points were fixed with another choice of Main's own in 12-17 of 30 passes and put to the user in 12-13 (GPT also rebutted 6). With n1, 23-29 of 30 go to the user; the remaining fixes are the removal-type fixtures N06, N07 and N09, whose REQUIRED OUTCOME is a plain removal of the addition (Sonnet high 7, Opus 3, GPT 1). Clear cases did not move.

### Round 2

| main config | kind | n | acceptable | exact target | fix | rebut | fix+rebut | extra edits elsewhere | ask | report | rereview | none | errors | sec mean | cost/pass |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| GPT-6.1-Sol medium [v2] | uphold | 39 | 39/39 | 39/39 | 39 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 27.2 | $0.034 |
| GPT-6.1-Sol medium [v2] | withdraw | 60 | 59/60 | 59/60 | 1 | 0 | 0 | 1 | 0 | 0 | 0 | 58 | 0 | 6.4 | $0.014 |
| GPT-6.1-Sol medium [v2] | undecided | 30 | 30/30 | 30/30 | 0 | 0 | 0 | 0 | 30 | 0 | 0 | 0 | 0 | 7.5 | $0.017 |
| Opus 5.5 low [v2] | uphold | 39 | 39/39 | 39/39 | 39 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 18.6 | $0.065 |
| Opus 5.5 low [v2] | withdraw | 60 | 59/60 | 59/60 | 0 | 0 | 0 | 2 | 1 | 0 | 0 | 57 | 0 | 8.5 | $0.038 |
| Opus 5.5 low [v2] | undecided | 30 | 30/30 | 30/30 | 0 | 0 | 0 | 0 | 30 | 0 | 0 | 0 | 0 | 4.9 | $0.032 |
| Sonnet 5.5 high [v2] | uphold | 39 | 39/39 | 39/39 | 39 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 16.4 | $0.038 |
| Sonnet 5.5 high [v2] | withdraw | 60 | 59/60 | 59/60 | 0 | 0 | 0 | 18 | 0 | 0 | 0 | 42 | 0 | 14.4 | $0.036 |
| Sonnet 5.5 high [v2] | undecided | 30 | 29/30 | 29/30 | 0 | 0 | 0 | 0 | 29 | 0 | 0 | 1 | 0 | 6.0 | $0.018 |

| main config | kind | n | acceptable | exact target | fix | rebut | fix+rebut | extra edits elsewhere | ask | report | rereview | none | errors | sec mean | cost/pass |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| GPT-6.1-Sol medium [n1] | uphold | 39 | 39/39 | 39/39 | 39 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 26.4 | $0.036 |
| GPT-6.1-Sol medium [n1] | withdraw | 60 | 59/60 | 59/60 | 1 | 0 | 0 | 1 | 0 | 0 | 0 | 58 | 0 | 5.7 | $0.015 |
| GPT-6.1-Sol medium [n1] | undecided | 30 | 30/30 | 30/30 | 0 | 0 | 0 | 0 | 30 | 0 | 0 | 0 | 0 | 6.9 | $0.016 |
| Opus 5.5 low [n1] | uphold | 39 | 39/39 | 39/39 | 39 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 19.3 | $0.065 |
| Opus 5.5 low [n1] | withdraw | 60 | 60/60 | 60/60 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 59 | 0 | 8.5 | $0.038 |
| Opus 5.5 low [n1] | undecided | 30 | 30/30 | 30/30 | 0 | 0 | 0 | 0 | 30 | 0 | 0 | 0 | 0 | 5.7 | $0.036 |
| Sonnet 5.5 high [n1] | uphold | 39 | 39/39 | 39/39 | 39 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 17.7 | $0.040 |
| Sonnet 5.5 high [n1] | withdraw | 60 | 60/60 | 60/60 | 0 | 0 | 0 | 16 | 0 | 0 | 0 | 44 | 0 | 13.2 | $0.034 |
| Sonnet 5.5 high [n1] | undecided | 30 | 29/30 | 29/30 | 0 | 0 | 0 | 0 | 29 | 0 | 0 | 1 | 0 | 5.4 | $0.020 |

Round 2 is clean for all configs with and without n1. The exceptions are single passes: GPT edits the withdrawn finding (both texts), Opus asks a question [v2], Sonnet high rebuts again [v2]. Sonnet high also makes extra edits elsewhere in 16-18 passes (other real defects of the repository; none touched the withdrawn finding).

### Round 2w (the reviewer repeats a finding as DECIDED against the user's own words)

| main config | kind | n | acceptable | exact target | fix | rebut | fix+rebut | extra edits elsewhere | ask | report | rereview | none | errors | sec mean | cost/pass |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| GPT-6.1-Sol medium [v2] | withdraw | 42 | 42/42 | 42/42 | 42 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 26.2 | $0.035 |
| Opus 5.5 low [v2] | withdraw | 42 | 39/42 | 39/42 | 13 | 0 | 1 | 0 | 4 | 22 | 0 | 2 | 0 | 15.5 | $0.058 |
| Sonnet 5.5 high [v2] | withdraw | 42 | 40/42 | 40/42 | 24 | 0 | 1 | 0 | 5 | 11 | 0 | 1 | 0 | 23.0 | $0.052 |

| main config | kind | n | acceptable | exact target | fix | rebut | fix+rebut | extra edits elsewhere | ask | report | rereview | none | errors | sec mean | cost/pass |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| GPT-6.1-Sol medium [n1] | withdraw | 42 | 42/42 | 42/42 | 40 | 0 | 0 | 0 | 2 | 0 | 0 | 0 | 0 | 24.0 | $0.036 |
| Opus 5.5 low [n1] | withdraw | 42 | 42/42 | 42/42 | 7 | 0 | 0 | 0 | 11 | 24 | 0 | 0 | 0 | 11.9 | $0.049 |
| Sonnet 5.5 high [n1] | withdraw | 42 | 41/42 | 41/42 | 24 | 0 | 0 | 0 | 7 | 10 | 1 | 0 | 0 | 22.1 | $0.051 |

GPT-6.1-Sol medium obeys the wrong DECIDED almost always (42/42 fix before, 40/42 after n1), i.e. it changes the work against what the user said (for example the public name the user forbade to touch). Opus low fixes 7-13 of 42 and otherwise asks or reports the conflict; Sonnet high fixes 24 of 42. This follows from the final-answer rule and is within "accepts or goes to the user", but it is the one place where a reviewer error becomes a change against the user. No wording was tested for it.

## Recommended wording

Carrier: `extensions/RQW-review/REVIEWER.md` and `NEXT.findings` in `extensions/RQW-review/index.ts`, adopted as listed here except that item 2 has no "or REQUIREMENT would be `NOT AGREED`" and has one more sentence (see the note after item 4).

### REVIEWER.md (v3h): four edits against 254ae51

1. In the dispute paragraph, before "If it does, leave the finding out; that withdraws it.":

```text
A rebuttal shows this only when its quote, read with the user's messages and the agreement, rules the finding out; a quote that allows the finding's reading as well, or an argument that is only Main's convention, preference or assumption, shows nothing. If it shows it, leave the finding out; that withdraws it.
```

2. The two RULING sentences are replaced by:

```text
RULING is `DECIDED` when the user's own words, quoted verbatim in REQUIREMENT, state the value, name or behavior the finding requires, whatever the work or Main's rebuttal says; Main must then fix it. RULING is `UNDECIDED` when the user's words do not state it, so the work or Main supplied a value, rule or choice the user never gave (a number, threshold, default, format or scope), or Main made a choice of its own that differs from what the user said, or when the words allow two readings; the user then decides. Test: if you would have to invent the number or rule to write the REQUIRED OUTCOME from the user's words alone, or REQUIREMENT would be `NOT AGREED`, the ruling is `UNDECIDED`.
```

3. At the end of the dispute paragraph, after "otherwise leave it out.":

```text
A withdrawal is silent: never write that a dispute is withdrawn, holds or fails, and never add text before `CLEAN` or `FINDINGS:` or after the last field; the ruling and the reason go only in RULING and ANSWER.
```

4. In the reply paragraph, the length rule becomes:

```text
with MISMATCH and REQUIRED OUTCOME each a single English sentence of at most 20 words, one full stop and no second sentence: count the words before you write. MISMATCH states only the defect, never the rebuttal or the reasons, which belong in ANSWER; REQUIRED OUTCOME states one concrete end state, never asks Main or the owner to decide:
```

The clause "or REQUIREMENT would be `NOT AGREED`" is what makes GPT rule UNDECIDED on U12; dropping it returns that case to the v2 behavior. The adopted `REVIEWER.md` drops it and adds, after the end of the probes (so it is unmeasured), the sentence: "Exception to the two rulings and the test: an addition the user never asked for (an extra feature, output, option or file) that Main defends only as useful or harmless is a finding with REQUIREMENT `NOT AGREED` and RULING `DECIDED`; Main removes it without asking the user." It is there because the DECIDED condition (the user's words quoted in REQUIREMENT) cannot hold for `NOT AGREED`.

### NEXT.findings (n1)

One sentence is added after "Without such proof, fix it.", and "Fix all in one batch" becomes "Fix all the others in one batch":

```text
But a finding that rests on a value, rule or choice the user never gave is not yours to settle: put it to the user and follow the user's decision; do not fix it with another choice of your own.
```

`DESCRIPTION`, `NEXT.decided`, `NEXT.undecided` and `NEXT.withdrawn` stay as committed. Any test that pins `NEXT` or its length needs the new text (926 characters).

## Recommended reviewer configs

Per config: detection pooled over both Phase 1 runs; disputes with v3h (items right of 165: 54 U + 75 W/X + 36 N; "tolerant" = with the tolerant extraction above).

| config | recall | false findings per 240 passes | clean cases CLEAN | dispute items right | broken reply start of 147 | 20-word rule passes of 147 | sec | USD/pass |
|---|---|---|---|---|---|---|---|---|
| Haiku 5.5 low | 93.7% | 10 | 64/66 | 165 | 0 | 0 | 10.6 | 0.0018 |
| Haiku 5.5 medium | 96.3% | 8 | 65/66 | 164 | 1 | 2 | 13.5 | 0.0021 |
| Sonnet 5.5 low | 96.7% | 30 | 66/66 | 154 (165 tolerant) | 11 | 6 | 7.0 | 0.0216 |
| Sonnet 5.5 medium | 96.5% | 34 | 66/66 | 161 (165 tolerant) | 4 | 14 | 7.8 | 0.0234 |
| GPT-6.1-Sol low | 95.4% | 23 | 60/66 | 165 | 0 | 0 | 15.6 | 0.0169 |
| GPT-6.1-Sol medium | 96.3% | 34 | 60/66 | 165 | 0 | 0 | 16.2 | 0.0171 |
| GPT-6-Sol low | 96.7% | 50 | 54/66 | 161 | 0 | 1 | 10.0 | 0.0146 |
| GPT-6-Sol medium | 96.7% | 50 | 60/66 | 164 | 0 | 0 | 17.3 | 0.0182 |

| main is | `blind` | `high` |
|---|---|---|
| Claude | Haiku 5.5 medium | Sonnet 5.5 low, with tolerant verdict extraction (without it Haiku 5.5 medium again) |
| GPT (quality recommendation of the first campaign; the owner chose GPT-5.6-Luna medium / high, see the next section) | GPT-6.1-Sol low | GPT-6.1-Sol medium |

Recall of all usable configs is the same within noise (95.4-96.7%), so the choice rests on false findings, clean-case accuracy, dispute and format reliability, cost and speed; the two levels cannot be separated by quality, so the first campaign recommended that `high` keep the committed Sonnet for Claude and the medium thinking level for GPT. That is the superseded first-campaign recommendation for GPT: GPT `high` is now GPT-5.6-Luna high (owner's choice, `DECISIONS.md` section Review, and section "GPT match for the Claude slots" below); the Claude `high` slot stays Sonnet 5.5 low in `LEVELS`.

- Haiku low suffices for disputes (165/165) but not for detection: pooled recall 93.7% against 96.3% for medium; it saves 3 s and 0.0003 USD per pass. Keep medium.
- Sonnet low or medium instead of Haiku brings no recall (96.7% and 96.5% against 96.3%), about 4 times the false findings, about 10 times the cost and half the time; 3-7% of its dispute replies start with a remark and are lost unless the extension tolerates it. Its pluses: all 66 clean cases answered CLEAN and speed.
- GPT-6 Sol against GPT-6.1-Sol: the same recall, cheaper and faster, but about twice the false findings, fewer clean cases answered CLEAN (54-60/66 against 60/66) and weaker undecided points with v3h (33-35/36 against 36/36). 6.1 is the better choice; 6 only for cost.
- GPT-6 Luna: unusable at any level.
- Higher thinking is not needed: low equals medium for Sonnet, GPT-6.1-Sol and GPT-6-Sol within noise; only Haiku gains from medium (about 2.6 points).
- The reviewer measurements do not depend on the main model and the main-side runs used fixed verdict messages, so no interaction between the main family and the reviewer family was measured; the split by main family is a choice about the provider pool, not a measured effect.

## GPT match for the Claude slots

Question (owner, 2026-10-22), summarized, not a verbatim quote: find a GPT reviewer comparable to the Claude slots, try GPT-5.6 Luna and stronger models such as GPT-6 and GPT-6.1 Sol at medium reasoning, and put Haiku 5.5 above GPT-5.6 Luna and GPT-6 Luna in the model order. Goal: a GPT reviewer comparable to Haiku 5.5 medium (Claude `blind`) and Sonnet 5.5 low (Claude `high`). Owner's decision on the GPT row: «Давай тогда сделаем, что на blind review будет Luna Medium. На high review будет Luna High. Да» (`DECISIONS.md`, Review): `blind` GPT-5.6-Luna medium, `high` GPT-5.6-Luna high.

Source: `/Users/arkadijcukavin/ai-project/my-pi-evidence/reviewer-probes/bench/results/gpt-match.md` (generated tables `results/gpt-match.table.md`, `results/gpt-match.phase2-luna.md`, costs `results/gpt-match.costs.txt`; run logs `results/gm-*.log`). All measured with the v3h dispute text and concurrency of at most 4 sessions. Phase 1: 40 cases x 3 runs (270 defect chances, 33 clean-case runs), judged by Opus 5.5 medium with 3 votes. The GPT-5.6-Luna and GPT-6-Luna rows ran with v3h; the other rows are the Phase 1 rerun with v3f, which differs from v3h only inside the dispute paragraph that a brief without `<disputes>` does not trigger. Phase 2: v3h on 49 fixtures x 3 runs (165 items: U DECIDED + W/X withdrawn + N UNDECIDED; reply parsed strictly, so Sonnet's replies that start with a remark count as wrong) plus the 5 two-readings fixtures (C, expected UNDECIDED). Rows of Haiku, Sonnet, GPT-6.1-Sol and GPT-6-Sol are the existing cells, not rerun. sec and USD are per pass at Pi list prices.

### Comparison table

| config | Phase 1 recall | false findings | CLEAN of 33 clean cases | Phase 1 sec/pass | Phase 1 USD/pass | Phase 2 v3h items right of 165 | two-readings C of 15 | broken reply start of 147 | Phase 2 sec/pass | Phase 2 USD/pass |
|---|---|---|---|---|---|---|---|---|---|---|
| Haiku 5.5 low | 94.1% (254/270) | 2 | 33/33 | 11.2 | $0.0018 | 165 | 11/15 | 0 | 11.9 | $0.0018 |
| Haiku 5.5 medium | 95.6% (258/270) | 1 | 33/33 | 14.4 | $0.0022 | 164 | 11/15 | 1 | 15.0 | $0.0021 |
| Sonnet 5.5 low | 96.7% (261/270) | 15 | 33/33 | 6.7 | $0.0226 | 154 | 3/15 | 11 | 6.3 | $0.0208 |
| GPT-6.1-Sol low | 95.2% (257/270) | 11 | 30/33 | 13.9 | $0.0158 | 165 | 8/15 | 0 | 15.0 | $0.0152 |
| GPT-6.1-Sol medium | 96.3% (260/270) | 14 | 30/33 | 15.5 | $0.0162 | 165 | 9/15 | 0 | 14.7 | $0.0159 |
| GPT-6-Sol low | 96.7% (261/270) | 24 | 27/33 | 9.3 | $0.0133 | 161 | 5/15 | 0 | 8.9 | $0.0120 |
| GPT-6-Sol medium | 96.3% (260/270) | 19 | 31/33 | 15.2 | $0.0166 | 164 | 8/15 | 0 | 14.9 | $0.0153 |
| GPT-5.6-Luna low | 91.9% (248/270) | 13 | 28/33 | 8.6 | $0.0021 | 164 | 5/15 | 0 | 8.3 | $0.0017 |
| GPT-5.6-Luna medium | 94.1% (254/270) | 10 | 30/33 | 12.6 | $0.0027 | 164 | 7/15 | 0 | 12.2 | $0.0025 |
| GPT-5.6-Luna high | 96.3% (260/270) | 17 | 31/33 | 20.8 | $0.0043 | 165 | 10/15 | 0 | 19.4 | $0.0039 |
| GPT-6-Luna low | 68.5% (185/270) | 16 | 20/33 | 5.4 | $0.0007 | 132 | 9/15 | 0 | 4.9 | $0.0005 |
| GPT-6-Luna medium | 78.1% (211/270) | 22 | 20/33 | 6.7 | $0.0007 | 152 | 9/15 | 0 | 7.5 | $0.0006 |

Phase 1 recall standard error is about 1.2-1.5 points at 270 chances, so the gaps among Haiku medium (95.6%), GPT-6.1-Sol low (95.2%), GPT-5.6-Luna medium (94.1%) and the high-slot group (Sonnet low 96.7%, GPT-5.6-Luna high 96.3%, GPT-6.1-Sol medium 96.3%) are mostly within noise; the clearer differences are the false findings and the clean cases. The "format ok" misses of GPT-5.6-Luna in Phase 1 (115, 113, 112 of 120) are the three old `rejected` cases that the Phase 1 brief still builds, the same artifact as in the other rerun rows.

### Phase 2 detail for the Luna rows

| config | U DECIDED (U12 aside) | U12 unagreed addition: DECIDED | W/X withdrawn | N UNDECIDED | N withdrawn | N wrongly DECIDED | W/X repeated or invalid | verdict start broken (prose before) | length-rule passes | strict format ok | seeded defects also found | unmatched new findings | sec | cost/pass |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| GPT-5.6-Luna low | 54/54 | 1/3 | 74/75 | 36/36 | 0 | 0 | 1 | 0 | 0/147 | 147/147 | 138/174 | 32 | 8.3 | $0.0017 |
| GPT-5.6-Luna medium | 54/54 | 3/3 | 74/75 | 36/36 | 0 | 0 | 1 | 0 | 0/147 | 146/147 | 145/174 | 25 | 12.2 | $0.0025 |
| GPT-5.6-Luna high | 54/54 | 3/3 | 75/75 | 36/36 | 0 | 0 | 0 | 0 | 0/147 | 147/147 | 148/174 | 32 | 19.4 | $0.0039 |
| GPT-6-Luna low | 48/54 | 2/3 | 48/75 | 36/36 | 0 | 0 | 27 | 0 | 0/147 | 143/147 | 63/174 | 20 | 4.9 | $0.0005 |
| GPT-6-Luna medium | 50/54 | 3/3 | 66/75 | 36/36 | 0 | 0 | 9 | 0 | 0/147 | 140/147 | 108/174 | 31 | 7.5 | $0.0006 |

| config | UNDECIDED (of 15) | withdrawn | DECIDED | invalid | per fixture UNDECIDED (C01 C02 C03 C04 C05, of 3 each) |
|---|---|---|---|---|---|
| GPT-5.6-Luna low | 5/15 | 10 | 0 | 0 | 2 2 0 1 0 |
| GPT-5.6-Luna medium | 7/15 | 8 | 0 | 0 | 3 3 0 1 0 |
| GPT-5.6-Luna high | 10/15 | 5 | 0 | 0 | 3 3 0 3 1 |
| GPT-6-Luna low | 9/15 | 5 | 1 | 0 | 2 3 1 2 1 |
| GPT-6-Luna medium | 9/15 | 5 | 1 | 0 | 3 3 1 2 0 |
| Haiku 5.5 medium | 11/15 | 3 | 0 | 0 | 3 3 1 3 1 |
| Sonnet 5.5 low | 3/15 | 6 | 0 | 5 | 3 0 0 0 0 |
| GPT-6.1-Sol low | 8/15 | 4 | 0 | 0 | 3 2 0 3 0 |
| GPT-6.1-Sol medium | 9/15 | 4 | 0 | 0 | 3 3 0 3 0 |

### Reading

- `blind`: GPT-5.6-Luna medium is the closest to Haiku 5.5 medium: the same speed and price class (12.6 s and 0.0027 USD against 14.4 s and 0.0022), the same dispute quality (164/165 for both; no broken reply start against 1 for Haiku), recall 94.1% against 95.6% (within about one standard error). Alternative: GPT-6.1-Sol low (recall 95.2%, 165/165, 7 times Haiku's price, 30/33 clean cases).
- `high`: GPT-5.6-Luna high against Sonnet 5.5 low: recall 96.3% against 96.7%, false findings 17 against 15, 31/33 clean cases against 33/33, disputes 165/165 against 154/165 (strict parse), 5 times cheaper (0.0043 against 0.0226 USD) but 3 times slower (20.8 s against 6.7 s). Alternative: GPT-6.1-Sol medium (the same quality at 3.8 times the price of Luna high, 5 s faster).
- The weak-model order the owner asked for holds: Haiku 5.5 medium (95.6%) is above GPT-5.6-Luna medium (94.1%), far above GPT-6-Luna medium (78.1%). GPT-6-Luna is not usable at any level.
- GPT-5.6-Luna low (91.9%, 13 false findings, 28/33 clean cases) is below Haiku 5.5 low: not for `blind`.
- Weak points of GPT-5.6-Luna against the Claude configs: more false findings than Haiku medium (10 against 1 in the rerun), 28-31 of 33 clean cases answered CLEAN (Haiku 33, Sonnet 33), fewer two-readings fixtures put to the user (low 5/15, medium 7/15, high 10/15; Haiku medium 11/15).
- One run set per cell, no repeat: a one- or two-item difference is noise. GPT-5.6-Luna high was added because medium looked promising; the other models were not run at high. The adopted `REVIEWER.md` has one sentence these runs did not see (see Limits).

## Limits

1. Unagreed additions (U12): decided by the owner as `DECIDED` (Main removes the addition without asking). v2 gave DECIDED almost everywhere; the v3 `NOT AGREED` test gave UNDECIDED for GPT-6.1-Sol and a mix for the others. The adopted text drops the test clause and adds an explicit exception sentence (unmeasured), and has not been measured on this case.
2. Tolerant extraction: 3-7% of Sonnet's dispute replies start with a remark. The extension starts the verdict at the first line that is exactly `FINDINGS:` (`verdictOf`), which recovers all of them in the rescore; this code is outside the tested wording and is covered by `review.test.ts`.
3. A reviewer's wrong DECIDED is obeyed by GPT main almost always (round 2w); whether `NEXT` or the extension should keep Main from changing something the user explicitly forbade was not tested.
4. `LEVELS` is family-dependent. The Claude row is the recommendation above and is the current `LEVELS` value. The GPT row is the owner's choice, GPT-5.6-Luna medium and high. The reviewer model and prompt choice for reviewer v2 is open work: [BACKLOG.md, R01](../BACKLOG.md#r01).
5. The Phase 1 rerun used the same Opus 5.5 medium judge as the first run, to keep the two comparable.
6. Three runs per cell, 54 fixtures (12 undecided, 5 two-readings): a difference of one or two items between variants is noise (for example Sonnet low in v3d, v3e, v3f: 144, 149, 150 of 165). The conclusions rest on the large gaps: GPT undecided 24 to 36 of 36, Haiku and GPT 164-165 of 165 against Sonnet 154-161, two-readings 0-2 to 8-11 of 15, Main fixing 12-17 of 30 to 1-7.
7. Fixtures are synthetic and the findings were written by hand in the committed finding format; C03 is a weak ambiguity; N06, N07 and N09 allow a removal fix, which counts for Main as a defensible alternative to asking.
8. The Phase 1 harness still builds the old `rejected` brief (3 cases are obsolete for the pair contract).
9. Not measured: reviewer levels above medium, a Luna rerun, a live run in the owner's Pi, cross-family independence beyond the union recall, a main-side wording for a wrong DECIDED.
10. The runs used up to about 30 concurrent LLM sessions (10 per family chain, several chains in parallel). Later measurements follow `PROCESS.md`, Measurements and benchmarks.

## Sources of the numbers

All files are in `/Users/arkadijcukavin/ai-project/my-pi-evidence/reviewer-probes/` (outside the repository; paths below are relative to its `bench/` directory, and `../dispute` and `../snap-*` are its sibling directories). It is a verified copy of the campaign's temporary probe directory: 37427 files and 585233064 bytes on both sides, recorded with a content diff in `COPY.txt` in that folder (node_modules, `__pycache__` and `.DS_Store` excluded). Every table cell is computed by the named script from the named raw run files; the generated markdown of each table is saved under `results/final-data/`. No number in this file comes from a CI run; the only CI-free measurements are the model probes (network-bound, no local test runs).

| table or number | generated file | raw run files | run logs |
|---|---|---|---|
| Phase 1, committed text; pooled recall | `results/final-data/p1.md`, `p1-pooled.md` (script `p1md.py`); first table also `results/p1-table.md` | `results/p1-<cfg>/score.json`, `results/p1-<cfg>/<case>/r<n>.json` and `r<n>.judge.json` | `results/p1-run.log`, `results/p1-score.log`, `results/p1-score2.log`, `results/report-2026-10-21T18-32-27-714Z.md`, `results/report-2026-10-21T18-38-47-207Z.md` |
| Phase 1, recommended text (v3f) | `results/final-data/p1.md` | `results/p1f-<cfg>/score.json`, `results/p1f-<cfg>/<case>/r<n>.json` and `r<n>.judge.json` | `results/p1f-run.log`, `results/p1f-score.log`, `results/report-2026-10-21T20-47-46-064Z.md` |
| union recall of two reviewers | `results/final-data/p1-union.txt` (script `union_recall.py`) | `results/p1-<cfg>/score.json` | as Phase 1, committed text |
| Phase 2 v2 table, Luna dispute numbers | `results/final-data/p2-v2.md` (scripts `final_tables.py`, `dscore.py`) | `results-disp/d2-<cfg>/<fixture>/r<n>.json` | `results/d2-claude-run.log`, `results/d2-gpt-run.log`, `results/d2-extra-run.log` |
| Phase 2 v3h table, variant matrix, Sonnet pooled remark rate | `results/final-data/p2-v3h.md`, `p2-matrix.md`, `p2-sonnet-pool.md` (script `make_data.py`; `matrix.py`) | `results-disp/d3a-<cfg>` ... `d3h-<cfg>` (a, b, c, d, f, h on 8 configs; e on the 4 Claude configs); per-variant tables `results/final-data/p2-v3a.md` ... `p2-v3h.md` | `results/d3<x>-claude-run.log`, `results/d3<x>-gpt-run.log` for x in a, b, c, d, f, h; `results/d3e-claude-run.log` |
| tolerant-extraction rescore | `results/final-data/p2-tol-v3h.md` (script `tolerant.py`) | same as the v3h table | same |
| two-readings fixtures C01-C05 | `results/final-data/p2-c.md` (script `ctable.py`; fixtures built by `../dispute/build_c.py`) | `results-disp/dc2-<cfg>`, `dc3f-<cfg>`, `dc3g-<cfg>`, and the C items inside `results-disp/d3h-<cfg>` | `results/dc2-<family>-run.log`, `results/dc3f-<family>-run.log`, `results/dc3g-<family>-run.log`, `results/d3h-<family>-run.log` |
| v3g regression on U fixtures | `results/final-data/u3g.txt` (script `u_regression.py`): 54/54 on seven configs, 48/54 on Sonnet low | `results-disp/du3g-<cfg>/<fixture>/r<n>.json` | `results/du3g-claude-run.log`, `results/du3g-gpt-run.log` |
| main side, committed `NEXT` [v2] | `results/final-data/main-v2-r1.md`, `main-v2-r2.md`, `main-v2-r2w.md` (script `mfinal.py`) | `results-main/m2-r<round>-<config>/<fixture>/r<n>.json` (configs `opuslow`, `sonnethigh`, `gptsol61`) | `results/m2-opuslow-run.log`, `results/m2-sonnethigh-run.log`, `results/m2-gptsol61-run2.log`, `results/m2-gpt-run.log` (first part of the GPT-6.1-Sol runs) |
| main side, with the n1 sentence | `results/final-data/main-n1-r1.md`, `main-n1-r2.md`, `main-n1-r2w.md` | `results-main/mn1-r<round>-<config>/<fixture>/r<n>.json` | `results/mn1-opuslow-run.log`, `results/mn1-gptsol61-run.log`, `results/mn1-sonnethigh-run.log`, `results/mn1-r2-a.log` (GPT and Sonnet, rounds 2 and 2w), `results/mn1-r2-b.log` (Opus, rounds 2 and 2w) |
| cost of the campaign (about 210 USD) | `results/final-data/costs.txt` (script `costs.py`); judge cost from `results/p1f-score.log` (24.289 USD) and `results/p1-score.log` (30.433 USD) | the `usage.cost` fields of the run files above | as above |
| text snapshots under test | `../snap-pair2` (committed 254ae51), `../snap-v3a` ... `../snap-v3h`, `../snap-n1`; recommended file `results/final-REVIEWER.md`, `results/final-NEXT.findings.txt` | | |
