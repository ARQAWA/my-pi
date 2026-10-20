# Refining the find description by probes (2026-10-21)

Stand: this copy (`/tmp/refine-find`, branch rqw-write export). Probe: `/tmp/probe/probe3.sh`, runner
`/tmp/probe/f3run.sh <variant> <tasks...>` (copies `notes/refine-find-texts/find.<variant>.md` into
`extensions/RQW-tools/descriptions/find.md`, 3 runs per model, 4 at once). Models gpt-6.1-sol medium, gpt-6-sol low.
Raw runs: `/tmp/probe/out/f3-<variant>-<task>-<model>-<n>.json(l)`; `v1b` is a second set of runs of the same text
as `v1`, pooled with it below. Per-point scores: `notes/refine-find-texts/scores.json`.

Checklist coverage: the full final answer (from the jsonl, not the 3000-character cut in the json) graded against
`~/stock-bench/bench41/checklists.py` by a model twice; a point counts when both passes say yes. The 3 disagreements
were all T01 `py_use`, decided by the earlier rule: counted when the answer names the use site in
`src/superbot_ng/workers/auth/cache_warmer.py` (all 3 did).

## Problem

On WRITE gpt-6.1-sol starts with a brace list of top-level names taken from the task, e.g.
`{app,tests,pyproject.toml,pytest.ini,setup.cfg,DISCOUNT.md}`. fd matches the basename, so it gets back only `app/`
and `tests/`, and spends one more response on `{app/*,tests/*}` or `{app/**,tests/**}`. gpt-6-sol also tried
`{app/,tests/}` once (matches nothing) and fell back to `ls` through bash.

## Variants

- base: the text as on the branch (`find.base.md`).
- v1: says that names match directories too and that a directory name returns the directory alone, gives
  `app/**` as the way to list what is under it, and swaps the brace example for one that mixes a directory listing
  with run files: `{app/**,*.toml,*compose*,Dockerfile*}` (`find.v1.md`).
- v2: base plus one sentence: `"{app,tests}"` returns `"app/"` and `"tests/"`; `"{app/**,tests/**}"` returns the
  files under them (`find.v2.md`).

Facts checked against `find.js` and fd: a pattern without "/" is a basename glob (directories match and come back
with a trailing "/"); a pattern with "/" gets `--full-path` and a `**/` prefix, so `app/**` lists everything under
any `app`, and `{app/**,*.toml,*compose*,Dockerfile*}` matched `app/a.py`, `app/sub/`, `app/sub/b.py`, `x.toml`,
`deploy/docker-compose.yml` and `Dockerfile.prod` in a scratch tree (`*` does not cross "/").

## Stage 1: WRITE, T01, T06, 3 runs per model

| Variant | Task | Model | ok | Checklist | Seconds | Responses | finds |
|---|---|---|---|---|---|---|---|
| base | WRITE | gpt-6.1-sol | 3/3 | - | 17.3 | 4.67 | 1.67 |
| base | WRITE | gpt-6-sol | 3/3 | - | 16.1 | 5.33 | 1.67 |
| base | T01 | gpt-6.1-sol | 3/3 | 15/15 | 26.5 | 4.33 | 1.00 |
| base | T01 | gpt-6-sol | 3/3 | 14/15 | 20.0 | 3.67 | 1.00 |
| base | T06 | gpt-6.1-sol | 3/3 | 17/18 | 46.8 | 4.67 | 2.33 |
| base | T06 | gpt-6-sol | 3/3 | 15/18 | 28.8 | 4.67 | 1.67 |
| v1 | WRITE | gpt-6.1-sol | 3/3 | - | 18.2 | 4.67 | 1.67 |
| v1 | WRITE | gpt-6-sol | 3/3 | - | 13.4 | 3.67 | 0.67 |
| v1 | T01 | gpt-6.1-sol | 3/3 | 15/15 | 23.6 | 3.33 | 1.33 |
| v1 | T01 | gpt-6-sol | 3/3 | 15/15 | 17.1 | 3.33 | 1.00 |
| v1 | T06 | gpt-6.1-sol | 3/3 | 17/18 | 42.1 | 4.67 | 2.67 |
| v1 | T06 | gpt-6-sol | 3/3 | 16/18 | 29.5 | 5.00 | 2.00 |
| v2 | WRITE | gpt-6.1-sol | 3/3 | - | 16.9 | 5.00 | 2.00 |
| v2 | WRITE | gpt-6-sol | 3/3 | - | 15.9 | 5.33 | 1.33 |
| v2 | T01 | gpt-6.1-sol | 3/3 | 15/15 | 25.7 | 3.67 | 1.00 |
| v2 | T01 | gpt-6-sol | 3/3 | 15/15 | 18.3 | 3.67 | 1.00 |
| v2 | T06 | gpt-6.1-sol | 3/3 | 17/18 | 46.9 | 5.00 | 3.00 |
| v2 | T06 | gpt-6-sol | 3/3 | 15/18 | 29.2 | 6.00 | 2.67 |

v2 made it worse: gpt-6.1-sol still started with `{app,tests,...}` in 3 of 3 runs and then listed `{app/**,tests/**}`
(5.00 responses), and T06 grew on both models. The sentence names the right second pattern but the first pattern
stays as it was. v1 went to stage 2.

## Stage 2: base vs v1 on all six tasks (v1 WRITE, T01, T06 pooled over 6 runs per model)

| Variant | Task | Model | Runs | ok | Checklist | Seconds | Responses | finds | WRITE runs with a second find response |
|---|---|---|---|---|---|---|---|---|---|
| base | WRITE | gpt-6.1-sol | 3 | 3/3 | - | 17.3 | 4.67 | 1.67 | 2/3 |
| base | WRITE | gpt-6-sol | 3 | 3/3 | - | 16.1 | 5.33 | 1.67 | 1/3 |
| base | EDIT | gpt-6.1-sol | 3 | 3/3 | - | 23.2 | 5.00 | 1.00 | - |
| base | EDIT | gpt-6-sol | 3 | 3/3 | - | 22.5 | 5.33 | 1.67 | - |
| base | MULTI | gpt-6.1-sol | 3 | 3/3 | - | 19.6 | 5.00 | 1.00 | - |
| base | MULTI | gpt-6-sol | 3 | 3/3 | - | 17.4 | 4.67 | 0.67 | - |
| base | T01 | gpt-6.1-sol | 3 | 3/3 | 15/15 | 26.5 | 4.33 | 1.00 | - |
| base | T01 | gpt-6-sol | 3 | 3/3 | 14/15 | 20.0 | 3.67 | 1.00 | - |
| base | T03 | gpt-6.1-sol | 3 | 3/3 | 15/15 | 42.2 | 4.67 | 2.00 | - |
| base | T03 | gpt-6-sol | 3 | 3/3 | 15/15 | 22.9 | 3.67 | 1.00 | - |
| base | T06 | gpt-6.1-sol | 3 | 3/3 | 17/18 | 46.8 | 4.67 | 2.33 | - |
| base | T06 | gpt-6-sol | 3 | 3/3 | 15/18 | 28.8 | 4.67 | 1.67 | - |
| v1 | WRITE | gpt-6.1-sol | 6 | 6/6 | - | 16.7 | 4.33 | 1.33 | 2/6 |
| v1 | WRITE | gpt-6-sol | 6 | 6/6 | - | 14.0 | 4.33 | 0.83 | 0/6 |
| v1 | EDIT | gpt-6.1-sol | 3 | 3/3 | - | 20.9 | 5.00 | 1.00 | - |
| v1 | EDIT | gpt-6-sol | 3 | 3/3 | - | 18.7 | 5.33 | 1.33 | - |
| v1 | MULTI | gpt-6.1-sol | 3 | 3/3 | - | 20.3 | 5.00 | 1.00 | - |
| v1 | MULTI | gpt-6-sol | 3 | 3/3 | - | 17.4 | 5.00 | 1.33 | - |
| v1 | T01 | gpt-6.1-sol | 6 | 6/6 | 30/30 | 23.9 | 3.50 | 1.50 | - |
| v1 | T01 | gpt-6-sol | 6 | 6/6 | 30/30 | 17.3 | 3.33 | 1.00 | - |
| v1 | T03 | gpt-6.1-sol | 3 | 3/3 | 15/15 | 45.3 | 5.00 | 1.67 | - |
| v1 | T03 | gpt-6-sol | 3 | 3/3 | 15/15 | 24.6 | 4.67 | 1.33 | - |
| v1 | T06 | gpt-6.1-sol | 6 | 6/6 | 35/36 | 44.7 | 4.83 | 3.00 | - |
| v1 | T06 | gpt-6-sol | 6 | 6/6 | 31/36 | 27.8 | 4.83 | 1.67 | - |

Totals: WRITE+EDIT+MULTI base 19.4 s / 5.00 responses (18 runs), v1 17.3 s / 4.71 (24 runs); T01+T03+T06 base
31.2 s / 4.28 (18 runs), v1 29.7 s / 4.27 (30 runs). Checklist: base 91/96 (94.8%), v1 156/162 (96.3%). Missed
points: base T06 `auth` x3, T06 `on_429` x1, T01 `rust_use` x1; v1 T06 `auth` x6. `T06:auth` is the known
gpt-6-sol gap from `refine-search.md` (it reads the section and leaves the key out), 5 of 6 v1 misses and 3 of 3 base
misses are gpt-6-sol. Every EDIT and MULTI run passed the tests with no leftovers; no run left the question repo
dirty; no run searched through bash.

## What the runs show

- gpt-6-sol on WRITE: with v1 it lists `{app/**,tests/**,pyproject.toml,...}` in its first find in 6 of 6 runs and
  never needs a second find response (base 1 of 3); 4.33 vs 5.33 responses, 14.0 vs 16.1 s.
- gpt-6.1-sol on WRITE: v1 halves the extra find response, from 2 of 3 runs to 2 of 6; 4.33 vs 4.67 responses. It
  still opens with `{app,tests,...}` in 4 of 6 runs: it is checking whether the target directories exist, and in 2
  of those it then wrote without looking inside. So the gap is cut, not closed.
- Search questions: equal or better coverage on every task; responses equal overall (4.27 vs 4.28). T01 got faster
  on both models (3.50 / 3.33 vs 4.33 / 3.67). T03 took more responses on v1 (5.00 / 4.67 vs 4.67 / 3.67); the extra
  responses there are read and grep chains of 1-3 calls, not finds (one run used the new `rust/**/auth/**/*.rs`
  form), and that cell spreads 3 to 6 responses within one variant, so with 3 runs it is noise-level.
- No variant moved the run-file find of the question tasks: it stays one brace pattern of `*compose*`, `Dockerfile*`,
  `Makefile`, `*.service`, `main.*` in the first response, so the new brace example did not cost that habit.

## Chosen: v1

By the rule correctness first, then responses, then seconds: v1 has every test passing and the higher checklist
coverage (96.3% vs 94.8%), fewer responses on the edit and write tasks (4.71 vs 5.00) and equal ones on questions
(4.27 vs 4.28), and fewer seconds on both groups. `grep.md` stays unchanged: its "one find for the deploy, run and
entrypoint files" sentence was not involved in the WRITE detour.

```diff
--- a/extensions/RQW-tools/descriptions/find.md
+++ b/extensions/RQW-tools/descriptions/find.md
@@ -1,5 +1,5 @@
 Find files and directories by glob pattern; directories end with "/". Returns paths relative to the search directory, unsorted. Respects .gitignore; hidden files are included.
-- A pattern without "/" matches file names at any depth, e.g. "*.ts"; a pattern with "/" matches the end of the path at any depth, e.g. "src/**/*.spec.ts". Braces list alternatives in one pattern, e.g. "{*compose*,Dockerfile*,Makefile,main.*}".
+- A pattern without "/" matches file and directory names at any depth, e.g. "*.ts"; "app" returns "app/" only, not its files. A pattern with "/" matches the end of the path at any depth, e.g. "src/**/*.spec.ts"; "app/**" returns everything under app. Braces list alternatives in one pattern, e.g. "{app/**,*.toml,*compose*,Dockerfile*}".
 - No result count cap by default; output is cut at 50KB. If cut, narrow the pattern or path.
 - Use find for file names and grep for file contents.
 - Several searches in one response run in parallel. Run every search that may be useful in one response.
```

Limits: 3 to 6 runs per cell; differences under one response or a few seconds are within noise. gpt-6.1-sol still
takes the second find response in about one WRITE run in three.
