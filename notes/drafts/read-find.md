# Draft: `read` and `find` tool descriptions

Placeholders `{READ_LINES}`, `{READ_CHARS}`, `{FIND_CHARS}` are filled with the measured limits (agreement item 8).
Names and parameters are Pi's exactly (agreement item 3). Sources: `PI` = `notes/analysis-pi-tools.md`,
`OL` = `notes/analysis-omplite-tools.md`, `REQ` = `notes/tools-requirements.md`, `D:<n>` = omp-lite `DECISIONS.md`
line as cited in `OL`.

## read

### Description

```text
Read a file from the local filesystem. Text files and images (jpg, png, gif, webp, bmp); images are sent as attachments.
- Without offset and limit, a file of up to {READ_LINES} lines comes back whole; a longer file returns its first {READ_LINES} lines and the offset to continue from. Prefer this whole-file read.
- Any read returns at most {READ_CHARS} characters; a longer result is cut and ends with "Use offset=N to continue".
- Several reads in one response run in parallel. Read every file that may relate to the subject in one response.
- A read waits for an earlier write or edit of the same file in the same response and sees the new content.
- Use read to examine files instead of cat or sed through bash.
```

### Reasons

| Line | Reason | Source |
|---|---|---|
| Text and images, attachments | Pi read supports these formats natively; no PDF, so the omp-lite PDF claim is dropped | PI 1.3 (description, `read.js:80-108`); OL read table, 3.8 |
| Whole file up to {READ_LINES}, offset to continue; prefer it | First read of the whole file was accepted as final; a smaller cut lost 2.6-3.1 quality points | OL 4 (`read/description.md:15`), D:20, D:166 |
| {READ_CHARS} cap, partial result plus hint | Char cap kept, but Pi's "partial + offset hint" instead of omp-lite's empty error | OL read table, 3.8; brief decision |
| Parallel, read every related file in one response | A step costs about 2.2 s plus output time; batching saves steps | OL 4 (`read/description.md:6, 15`), D:44, D:47; REQ 5, 6 |
| Waits for earlier write/edit of the same file | Tells the model it may read right after editing in one response; the barrier removes the race | REQ 7; OL 3.1; PI 1.3 ("Not in the mutation queue") |
| read instead of cat or sed | Pi's own guideline for read, moved into the description | PI 1.3 (`promptGuidelines`, `read.js:15-18`) |

Left out on purpose: line numbers (Pi prints none), code-range expansion (not ported, D:131), internal URLs and PDF
(not in Pi), the empty-file notice (not verified in Pi's code).

### Parameters

| Parameter | Description | Reason |
|---|---|---|
| `path` | `Path to the file to read, relative to the working directory or absolute.` | Pi text plus the base it is relative to (PI 1.2, 1.3) |
| `offset` | `Line number to start reading from, 1-indexed. Use it to continue a cut read or, with limit, to read around a known line.` | Point reads of other hits around their lines (OL 4, wave method; SYSTEM.md `<search_method>`) |
| `limit` | `Maximum number of lines to read from offset.` | Pi text (PI 1.3); the char cap still applies |

## find

### Description

```text
Find files by glob pattern. Returns paths relative to the search directory, unsorted. Respects .gitignore; hidden files are included.
- A pattern without "/" matches file names at any depth, e.g. "*.ts"; a pattern with "/" matches the whole path, e.g. "src/**/*.spec.ts".
- No result count cap by default; output is cut at {FIND_CHARS} characters. If cut, narrow the pattern or path.
- Use find for file names and grep for file contents.
- Several searches in one response run in parallel. Run every search that may be useful in one response.
```

### Reasons

| Line | Reason | Source |
|---|---|---|
| Relative paths, unsorted, .gitignore, hidden | What Pi's fd call does; omp-lite's "sorted by modification time" is false for Pi | PI 1.9 (`--hidden`, description); OL find table, OL 4 |
| Basename match unless the pattern has `/` | fd adds `--full-path` and `**/` only when the pattern contains `/`; without this line `src/*.ts`-style intent is unclear | PI 1.9 (`find.js:147-160`) |
| No count cap, {FIND_CHARS} char cap | Char budget instead of a 1000-result cap, as in omp-lite glob | OL find table (`glob/index.ts:40-47`); REQ 8; brief decision |
| find for names, grep for contents | Splits the two search tools now that both are on | REQ 1, 4; PI 1.9 snippet "Find files by glob pattern" |
| Parallel, batch searches | Same step-cost argument as read | OL 4 (`glob/description.md:6`), D:44; REQ 6 |

Left out on purpose: mtime sort, `target_directory`, the glob-tool name (OL find table); the wave method lives in the
`grep` description, which names `find` for run and entrypoint files (OL 4).

### Parameters

| Parameter | Description | Reason |
|---|---|---|
| `pattern` | `Glob pattern. Without "/" it matches file names at any depth, e.g. "*.ts"; with "/" it matches the whole path, e.g. "src/**/*.spec.ts".` | PI 1.9 schema examples plus the `/` rule |
| `path` | `Directory to search in (default: current directory).` | Pi text (PI 1.9) |
| `limit` | `Maximum number of results (default: no limit).` | Count cap off by default (brief decision; OL find table) |
