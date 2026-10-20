# Draft: `edit` and `write` descriptions with multi-file calls

Sources: `notes/tools-requirements.md` (items 3, 5, 6, 7), `notes/analysis-pi-tools.md` (1.5-1.7, 5, facts 7 and 10),
`notes/analysis-omplite-tools.md` (edit, write, bugs 3.2-3.5, section 4), omp-lite `edit/description.md`,
`write/description.md`. With `customPrompt` set, the description and the parameter descriptions are the only tool
text the model sees (analysis-pi-tools fact 7), so every behaviour rule lives here.

---

## 1. `edit`

### 1.1 Description

```text
Replace exact text in files. Give path and edits: [{oldText, newText}, ...] for one file, or put a path on each edits[] entry to change several files in one call; the top-level path is the default for entries without their own. All edits of one file are matched against the original file, not one after another: each oldText must be unique in that file and must not overlap another edit of it; add surrounding lines to make it unique. Each file changes all-or-nothing: if any of its edits fails, that file stays untouched and the other files are still edited. Files are edited in parallel; edits and writes of one file run in call order. A later bash, read, grep or find in the same response sees the changed files. Read a file before editing it. The result has one line per file; when text is not found, it shows the nearest matching lines with line numbers.
```

Reason per sentence:

1. "Replace exact text in files." Purpose in four words; "exact" warns that the match is literal (fuzzy is only a stock fallback, not worth teaching).
2. "Give path and edits ... for one file, or put a path on each edits[] entry ... default for entries without their own." The whole multi-file shape in Pi names (requirement 5); says the per-entry path is optional, since a required `edits[].path` broke MiniMax calls (omplite edit table, D:154).
3. "All edits of one file are matched against the original file ... unique ... must not overlap ... add surrounding lines." Stock Pi semantics (`edit-diff.js` 215-260); models used to sequential edits otherwise chain an edit on the text of the previous one and get "not found" or "overlap". The fix hint saves the retry step that the duplicate error costs.
4. "Each file changes all-or-nothing ... other files are still edited." The model must know the state after a partial failure: failed file is original, others are done, so it retries only the failed file (fixes omp-lite bug 3.4 half-edited file).
5. "Files are edited in parallel; edits and writes of one file run in call order." Tells the model it may put a write and a later edit of the same file in one response; replaces omp-lite's busy refusal (bug 3.2) with Pi's waiting queue (`file-mutation-queue.js`), no retry needed.
6. "A later bash, read, grep or find in the same response sees the changed files." Lets the model batch edit + check in one response (requirement 7 barrier); without it a careful model spends a step to verify.
7. "Read a file before editing it." Kept from omp-lite; prevents guessed `oldText`.
8. "The result has one line per file; when text is not found, it shows the nearest matching lines with line numbers." The model learns it can fix `oldText` from the hint without a re-read (omplite edit table, nearest-match row); the hint is shown only for "not found", not for duplicates (bug 3.5).

Not said, on purpose: `replace_all` (not ported), busy refusal (not ported), `apply_patch` (agreement item 3), fuzzy matching details (no behaviour change for the model), CRLF/BOM preservation (automatic).

### 1.2 Parameter descriptions

| Parameter | Description | Reason |
|---|---|---|
| `path` | `Path of the file to edit, relative or absolute. Default for edits[] entries without their own path; omit it when every entry has a path.` | Says it is optional and how it combines with per-entry paths. |
| `edits` | `One or more replacements, in one or many files. Edits of one file are matched against its original content, not incrementally.` | Repeats the matching rule where the model builds the array; stock text kept in spirit. |
| `edits[].path` | `File of this edit. Omit it to use the top-level path.` | Minimal; optional so single-file calls stay stock-shaped. |
| `edits[].oldText` | `Exact text to replace. It must be unique in the original file and must not overlap any other oldText of the same file.` | Stock wording, "same call" changed to "same file" because one call now spans files. |
| `edits[].newText` | `Replacement text for this edit.` | Stock. |

### 1.3 Schema sketch (TypeBox)

```ts
const editEntry = Type.Object({
  path: Type.Optional(Type.String({ description: "File of this edit. Omit it to use the top-level path." })),
  oldText: Type.String({ description: "Exact text to replace. It must be unique in the original file and must not overlap any other oldText of the same file." }),
  newText: Type.String({ description: "Replacement text for this edit." }),
});

const editSchema = Type.Object({
  path: Type.Optional(Type.String({ description: "Path of the file to edit, relative or absolute. Default for edits[] entries without their own path; omit it when every entry has a path." })),
  edits: Type.Array(editEntry, { description: "One or more replacements, in one or many files. Edits of one file are matched against its original content, not incrementally." }),
});
```

Strict-mode notes: only `Type.Optional`, `Type.String`, `Type.Array`, `Type.Object`; no unions, no `minItems`, no
min/max (analysis-pi-tools section 5, fact 10). Strict conversion turns the optionals into `anyOf: [string, null]`;
`normalizeOptionalNulls` strips the nulls before execute. Rules the schema cannot carry are checked in code:

- `edits` empty -> stock error `edits must contain at least one replacement.`
- an entry without `path` and no top-level `path` -> `edits[i] has no path and there is no top-level path.` (that entry's group fails, other files still run).
- `prepareArguments`: keep stock `prepareEditArguments` (JSON-string `edits`, single object, legacy top-level `oldText/newText`), then group by resolved path in first-appearance order.

Result lines (one per file, in first-appearance order, `isError` if any file failed):

```text
Edited: src/a.ts (2 blocks)
Failed: src/b.ts: Could not find edits[1] in src/b.ts. ...
  nearest match:
  41|  const x = foo(bar);
  42|  return x;
```

---

## 2. `write`

### 2.1 Description

```text
Create or overwrite files; missing parent directories are created. Give path and content for one file, or files: [{path, content}, ...] for several files, never both in one call. Files are written in parallel; writes and edits of one file run in call order. A later bash, read, grep or find in the same response sees the written files. Use write for new files and full rewrites; change part of a file with edit. A response has an output limit: write a file over about 400 lines in parts, the first part with write, then each next part with edit whose oldText is the unique last lines of the file and whose newText is those lines plus the next part. The result has one line per file.
```

Reason per sentence:

1. "Create or overwrite files; missing parent directories are created." Stock behaviour; the mkdir part saves a `mkdir -p` bash step.
2. "Give path and content ... or files: [...] ..., never both in one call." The multi-file shape in Pi names (requirement 5); "never both" because exactly one form is accepted and a mixed call is an error.
3. "Files are written in parallel; writes and edits of one file run in call order." Same queue rule as edit; no busy refusal, so duplicate paths and write-then-edit in one response are safe (bug 3.2).
4. "A later bash, read, grep or find in the same response sees the written files." Lets the model write and run/test in one response (requirement 7).
5. "Use write for new files and full rewrites; change part of a file with edit." Stock guideline (dropped from the prompt with `customPrompt`, so it moves here); stops whole-file rewrites for small changes, which cost output tokens.
6. "A response has an output limit: write a file over about 400 lines in parts ... edit whose oldText is the unique last lines ..." omp-lite rule with evidence (bench35 lost a response at the output limit, D:102); Pi has no append, so the edit anchor must be named, else the model picks a non-unique last line like `}`.
7. "The result has one line per file." Tells the model failures are reported per file and others are written.

Not said, on purpose: internal URLs (omp-only), busy refusal, atomic write details, BOM/CRLF.

### 2.2 Parameter descriptions

| Parameter | Description | Reason |
|---|---|---|
| `path` | `Path of the file to write, relative or absolute. Use with content; omit both when using files.` | Marks the single form and that it excludes `files`. |
| `content` | `Full content of the file at path.` | "Full" says it replaces everything. |
| `files` | `Several files to write in parallel, each {path, content}. Use instead of path and content.` | The batch form and its exclusivity. |
| `files[].path` | `Path of the file to write, relative or absolute.` | Stock. |
| `files[].content` | `Full content of this file.` | Same as `content`. |

### 2.3 Schema sketch (TypeBox)

```ts
const writeFile = Type.Object({
  path: Type.String({ description: "Path of the file to write, relative or absolute." }),
  content: Type.String({ description: "Full content of this file." }),
});

const writeSchema = Type.Object({
  path: Type.Optional(Type.String({ description: "Path of the file to write, relative or absolute. Use with content; omit both when using files." })),
  content: Type.Optional(Type.String({ description: "Full content of the file at path." })),
  files: Type.Optional(Type.Array(writeFile, { description: "Several files to write in parallel, each {path, content}. Use instead of path and content." })),
});
```

Strict-mode notes: no union of the two forms (an object/array union would drop strict mode, section 5), so
"exactly one form" is checked in code:

- `files` given together with `path` or `content` -> `Give either path and content, or files, not both.`
- neither form complete (`path` without `content`, `content` without `path`, empty `files`) -> `write needs path and content, or a non-empty files list.`
- `content: ""` is a valid empty file; only a missing `content` is an error.
- Duplicate paths inside `files` run in list order through the shared queue; the last one wins.

Result lines (one per file, in list order, `isError` if any file failed):

```text
Written: src/a.ts
Failed: /root/x.ts: EACCES: permission denied
```
