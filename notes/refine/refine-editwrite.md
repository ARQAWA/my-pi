# Refining the `edit` and `write` descriptions by probes (2026-10-20)

Stand: copy of the package in `/tmp/refine-editwrite`, one stand per variant in `stands/<v>/` (package.json,
extensions, node_modules symlink; made by `mkstand.sh`). Runner `run.sh <v>`: 3 runs x 2 models x 3 tasks, 4 at a
time. Probe `probe2.sh` = `/tmp/probe/probe.sh` plus task MULTI. Metrics: `analyze.py <v>` and the table script below
read `/tmp/probe/out/ew-<v>-<task>-<model>-<n>.json(l)`.

Tasks:
- EDIT: rename `calc_total` to `compute_total` across 4 files plus the test, add a docstring, run pytest.
- WRITE: create 3 files, run pytest.
- MULTI (new, `probe-fixture2/`): 3 separate blocks in `app/pricing.py` (CURRENCY, shipping_cost, format_price) plus
  `app/cart.py` and `app/invoice.py` (stop hard-coding USD); tests are written for the target; leftovers = `USD` in `app/`.

Models: gpt-6.1-sol medium, gpt-6-sol low. "edit calls (multi)" = edit calls, in brackets those whose `edits[]` span
more than one file. "failed edits" = edit calls whose result had `isError`. "write calls (files[])" likewise.

## Variants

- base: current text.
- v1: edit split into short lines; the multi-file form named first ("For several files use one call and put a path on
  each edits[] entry"); the uniqueness rule spelled out for a name that occurs several times; "resend only the failed
  files". write: "for several files use one call with files". Parameter strings unchanged.
- v2: v1 plus edit.ts parameter strings: `oldText` "must occur exactly once ... same file; a bare name that occurs
  several times fails", `edits` "in one file or, with a path on each entry, in several files".
- v3: v1 plus one line in edit and write: "A bash call placed after the edit/write in the same response sees the
  changed files, so the edit and the test run can go in one response."

## Results (3 runs per cell)

| Variant | Task | Model | ok | Responses | Seconds | edit calls (multi) | failed edits | write calls (files[]) |
|---|---|---|---|---|---|---|---|---|
| base | EDIT | 6.1-sol | 3/3 | 5.0 | 23.1 | 3 (3) | 0 | 0 (0) |
| base | EDIT | 6-sol | 3/3 | 6.0 | 22.4 | 12 (4) | 5 | 0 (0) |
| base | MULTI | 6.1-sol | 3/3 | 4.0 | 18.3 | 3 (3) | 0 | 0 (0) |
| base | MULTI | 6-sol | 3/3 | 4.7 | 16.8 | 5 (2) | 0 | 0 (0) |
| base | WRITE | 6.1-sol | 3/3 | 5.3 | 19.1 | 0 (0) | 0 | 3 (3) |
| base | WRITE | 6-sol | 3/3 | 5.0 | 16.8 | 0 (0) | 0 | 3 (3) |
| v1 | EDIT | 6.1-sol | 3/3 | 5.0 | 23.3 | 3 (3) | 0 | 0 (0) |
| v1 | EDIT | 6-sol | 3/3 | 5.0 | 20.3 | 3 (3) | 0 | 0 (0) |
| v1 | MULTI | 6.1-sol | 3/3 | 4.7 | 24.6 | 4 (3) | 0 | 0 (0) |
| v1 | MULTI | 6-sol | 3/3 | 4.7 | 17.9 | 3 (3) | 0 | 0 (0) |
| v1 | WRITE | 6.1-sol | 3/3 | 5.3 | 19.2 | 0 (0) | 0 | 3 (3) |
| v1 | WRITE | 6-sol | 3/3 | 5.0 | 15.7 | 0 (0) | 0 | 3 (3) |
| v2 | EDIT | 6.1-sol | 3/3 | 5.0 | 22.9 | 3 (3) | 0 | 0 (0) |
| v2 | EDIT | 6-sol | 3/3 | 5.7 | 23.7 | 5 (5) | 2 | 0 (0) |
| v2 | MULTI | 6.1-sol | 3/3 | 4.0 | 18.9 | 3 (3) | 0 | 0 (0) |
| v2 | MULTI | 6-sol | 3/3 | 4.7 | 18.0 | 5 (2) | 0 | 0 (0) |
| v2 | WRITE | 6.1-sol | 3/3 | 5.7 | 21.9 | 0 (0) | 0 | 3 (3) |
| v2 | WRITE | 6-sol | 3/3 | 5.0 | 16.4 | 0 (0) | 0 | 3 (3) |
| v3 | EDIT | 6.1-sol | 3/3 | 10.0 | 30.4 | 3 (3) | 0 | 0 (0) |
| v3 | EDIT | 6-sol | 3/3 | 5.3 | 20.6 | 4 (4) | 1 | 0 (0) |
| v3 | MULTI | 6.1-sol | 3/3 | 5.3 | 22.3 | 3 (3) | 0 | 0 (0) |
| v3 | MULTI | 6-sol | 3/3 | 4.3 | 19.2 | 3 (3) | 0 | 0 (0) |
| v3 | WRITE | 6.1-sol | 3/3 | 5.7 | 21.2 | 0 (0) | 0 | 3 (3) |
| v3 | WRITE | 6-sol | 3/3 | 5.0 | 17.1 | 0 (0) | 0 | 3 (3) |

Totals over 18 runs per variant:

| Variant | ok | Mean responses | Mean seconds | Edit calls multi-file / all | Failed edit calls | write with files[] |
|---|---|---|---|---|---|---|
| base | 18/18 | 5.00 | 19.4 | 12 / 23 | 5 | 6 / 6 |
| v1 | 18/18 | 4.94 | 20.2 | 15 / 16 | 0 | 6 / 6 |
| v2 | 18/18 | 5.00 | 20.3 | 16 / 19 | 2 | 6 / 6 |
| v3 | 18/18 | 5.94 | 21.8 | 16 / 16 | 1 | 6 / 6 |

## What the runs show

- Every variant is correct: tests pass, no leftovers, all 3 files created.
- The base failure is one pattern: gpt-6-sol low sends `oldText: "calc_total"`, a bare name that occurs twice in
  `cart.py`, `invoice.py` and the test, and gets "Found 2 occurrences" (5 failed calls in 3 runs, one run with 5
  single-file calls in one response). v1 names this case and how to fix it; 0 failures, every EDIT call multi-file.
- v2 moves the same rule also into the parameter strings; it did not help (2 failures, MULTI back to one call per
  file). The extra text is noise, so the stock parameter strings stay.
- v3 repeats the known lesson: a sentence about what a later call in the same response sees made gpt-6.1-sol issue one
  call per response (EDIT 11 responses in 2 of 3 runs, MULTI once), and no model put the test run next to the write
  anyway. Rejected.
- write: every variant used `files[]` in every run; the write text only had to stay as clear. The remaining WRITE
  responses go to exploring and the test run, not to write.
- Seconds: v1 is 0.8 s slower on average than base; the difference is one gpt-6.1-sol MULTI run with an extra single
  edit and a separate `git diff` response (24.6 s cell), not the edit text. In the other cells v1 equals or beats base.

## Chosen: v1

Correctness ties, v1 has the fewest responses (4.94), no failed edit, and the highest share of multi-file edit
calls among the variants without the batching regression. Left in `extensions/RQW-tools/descriptions/edit.md` and
`write.md`; `edit.ts` and `write.ts` unchanged.

`edit.md`:

```text
Replace exact text in files. For one file give path and edits: [{oldText, newText}, ...]. For several files use one call and put a path on each edits[] entry; the top-level path is the default for entries without their own.
- All edits of one file are matched against the original file, not one after another. Each oldText must occur exactly once in that file and must not overlap another edit of it. A name that occurs several times, as in a rename, needs one edit per occurrence with enough of its line to be unique, or one edit whose oldText spans all of them.
- Each file changes all-or-nothing: if any of its edits fails, that file stays untouched and the other files are still edited; resend only the failed files.
- Read a file before editing it.
- The result has one line per file; when text is not found, it shows the nearest matching lines with line numbers.
```

`write.md`:

```text
Create or overwrite files; missing parent directories are created. For one file give path and content; for several files use one call with files: [{path, content}, ...]. Never both forms in one call and never one file twice. Use write for new files and full rewrites; change part of a file with edit. A response has an output limit: write a file over about 400 lines in parts, each part in its own response: the first with write, then each next with edit whose oldText is the unique last lines of the file and whose newText is those lines plus the next part. The result has one line per file.
```

Facts behind the text: `edit.ts` groups entries by path, each group is one stock edit (matched against the original,
unique, non-overlapping, all-or-nothing), groups run in parallel, one result line per file, nearest-match hint only on
"Could not find"; `write.ts` rejects both forms in one call and the same file twice.

Limit: 3 runs per cell; differences of under one response or a few seconds are within noise.
