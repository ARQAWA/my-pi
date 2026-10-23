# RQW-tools: design (coordinator decisions)

Status: frozen evidence, the original design of 2026-10-20 on Pi 1.3.0. Later work overrides parts of it: each tool
now runs its own `execute` around the stock call, with the barrier, background jobs, shared resource claims and
locks (`extensions/RQW-tools/index.ts`); grep and find are added only when the user made no tool selection; a
seventh tool `job` is registered; a bash call still running after 12 seconds continues as a background job; CI runs
on macOS and Windows only. Current contract: [DECISIONS.md, Tools](../DECISIONS.md#tools).

Agreement: `notes/tools-requirements.md`. Evidence: `analysis-pi-tools.md`, `analysis-omplite-tools.md`,
`analysis-races.md`, `analysis-windows.md`. Manifest: the simplest thing that is correct and fast.

## Layout

```
extensions/RQW-tools/
  index.ts          factory: one barrier per extension instance; registers read, bash, edit, write, grep, find
  barrier.ts        ordered conflict barrier (OCB), analysis-races.md section 5
  keys.ts           path key, analysis-races.md section 4
  edit.ts, write.ts multi-file wrappers over the stock definitions
  descriptions/<tool>.md   model-facing descriptions (loaded at runtime; drafts in notes/drafts/)
  test/*.test.ts    node --test, no model
.github/workflows/tests.yml  macos-latest, ubuntu-latest, windows-latest x Node 22.19.0, 24
```

## Decisions

1. Every tool wraps the stock definition from `@earendil-works/pi-coding-agent` (`create<X>ToolDefinition(cwd)`):
   same name, same parameters (plus the two multi-file fields below), stock `execute` does the work, stock
   `prepareArguments`, `renderShell`, `constrainedSampling` kept by spreading the stock definition. Only
   `description` / parameter descriptions and the wrappers change; edit drops `constrainedSampling`
   (`DECISIONS.md`, section Tools).
2. Barrier: OCB exactly as in `analysis-races.md` section 5. Scope registered synchronously at the top of `execute()`.
   `read` -> read [key]; `grep`/`find` -> read [key(path ?? ".")]; `edit`/`write` -> mutate [keys of all files];
   `bash` -> all. bash conflicts with everything, including bash (D1). read never conflicts with read. Otherwise
   conflict = equal key or ancestor. After the deps settle, an aborted call throws `Operation aborted` without work.
   State lives in the factory closure. No `executionMode: "sequential"` anywhere.
3. Path key: `analysis-races.md` section 4, with our own small resolver (strip leading `@`, `~` expansion, win32
   `/c/x` -> `C:/x`, `path.resolve(cwd, p)`), then realpath of the deepest existing ancestor, darwin NFC + lower case,
   win32 trailing dots/spaces stripped + lower case. Any error -> scope "all".
4. edit: top-level `path` optional; each `edits[]` entry has optional `path` (default: top-level `path`). Entries are
   grouped by key in first-seen order; each group is one stock `edit.execute({path, edits})` (Pi semantics: matched
   against the original, unique, non-overlapping, all-or-nothing per file); groups run in parallel. Result: one line
   per file (`Edited: <path> (n block(s))` / `Failed: <path>: <stock error>`), failures last; `isError` if any failed.
   A "Could not find" failure gets a nearest-match hint (best window by line similarity, minimum score, never on
   "Found N occurrences"). Single-file calls return the stock result unchanged (keeps the stock diff renderer).
5. write: `path` + `content` (stock) or `files: [{path, content}]`; exactly one form, else an error. Duplicate keys in
   one call -> error, nothing written. Files in parallel through stock `write.execute`. One line per file, `isError`
   if any failed. Single-file calls return the stock result unchanged.
6. Windows locks: stock `edit`/`write` execute is retried on `EBUSY`/`EPERM`/`EACCES` with backoff for up to 2 s
   (analysis-windows.md section 3). In-place write stays (D2), no temp+rename.
7. Limits: grep default `limit` when unset = 100000 matches (no practical match cap; omp-lite safety cap), stock
   50KB output cap stays (= omp-lite's 51 200-char budget for ASCII, measured in bench19-22). find default `limit`
   when unset = 100000, stock 50KB cap. read and bash keep stock limits (2000 lines / 50KB): bench41 measured the
   prompt with them. No own truncation code.
8. grep and find are on by registration; `session_start` adds them to the active tools if a resumed session lacks them.
9. Rendering must never throw. Multi-file calls (more than one file) get a minimal own `renderCall`/`renderResult`
   that lists the files and their status; single-file calls use the stock renderers.
10. Not ported: busy refusal, replace_all, apply_patch, code-range read expansion, grep cache, persistent shell,
    bash temp-script transport, CRLF/encoding rewrites (stock edit keeps CRLF and BOM). Background processes started
    by bash are not tracked (documented in the bash description).
11. Prompt: `<search_method>` leaves `SYSTEM.md`; the wave method lives in the grep description; the prompt keeps one
    line (drafts/bash-prompt.md).
