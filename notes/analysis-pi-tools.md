# Analysis: Pi 1.3.0 stock tools and how to replace them (for `extensions/RQW-tools/`)

Status: frozen evidence on Pi 1.3.0; the package now pins Pi 1.4.0. Current contract:
[DECISIONS.md, Tools](../DECISIONS.md#tools).

Read-only analysis of the installed Pi 1.3.0 (`/Users/arkadijcukavin/stock-bench/pi/node_modules/@earendil-works/`,
same version as the global `/opt/homebrew/bin/pi`, which runs `pi-coding-agent/dist/bundle/cli.js`).
Agreement: `notes/tools-requirements.md`.

Path abbreviations used below:

- `T/` = `pi-coding-agent/dist/core/tools/`
- `CORE/` = `pi-coding-agent/dist/core/`
- `LOOP` = `pi-agent-core/dist/agent-loop.js`
- `AI/` = `pi-ai/dist/`

Line numbers refer to the unbundled `dist` files. The CLI runs the bundle (`dist/bundle/chunks/chunk-*.js`), which is
the same code minified; only one copy of `fileMutationQueues` exists in the bundle (`chunk-66G7ITPS.js`).

---

## 1. Stock tools

### 1.1 Shared truncation (`T/truncate.js`)

- `DEFAULT_MAX_LINES = 2000` (line 10), `DEFAULT_MAX_BYTES = 50 * 1024` (line 11), `GREP_MAX_LINE_LENGTH = 500` chars
  (line 12). All limits are **bytes (UTF-8) and lines**, not characters, except `truncateLine` (chars).
- `truncateHead` (line 44): keeps whole leading lines; if the first line alone exceeds `maxBytes`, returns empty content
  with `firstLineExceedsLimit: true`. Used by read, grep, find.
- `truncateTail` (line 123): keeps trailing lines; may cut the last line partially (`lastLinePartial`). Used by bash via
  `OutputAccumulator`.
- `truncateLine` (line 209): `line.slice(0, 500) + "... [truncated]"`.
- `truncateMiddle` exists but is not used by the stock tools.

### 1.2 Path resolution (`T/path-utils.js`, `pi-coding-agent/dist/utils/paths.js`)

- `resolveToCwd(filePath, cwd)` (path-utils 42) -> `resolvePath(..., { normalizeUnicodeSpaces: true, stripAtPrefix: true })`.
- `normalizePath` (paths.js 59-82): unicode spaces -> space, strips a leading `@`, on win32 `normalizeWindowsShellPath`
  (Git-Bash style `/c/...`), expands `~` and `~/` (and `~\` on win32), `file://` URLs -> path.
- `resolvePath` (paths.js 83-87): absolute -> `path.resolve(p)`, else `path.resolve(cwd, p)`. No realpath, no case
  folding.
- `resolveReadPathAsync` (path-utils 72): only `read` uses it; if the resolved path does not exist it tries macOS
  variants: ` AM.`/` PM.` with U+202F, NFD, curly apostrophe U+2019, NFD+curly.
- Every tool uses `ctx?.cwd || cwd` (e.g. read.js:73, edit.js:94, write.js:32, grep/find `resolveToCwd(searchDir || ".")`).

### 1.3 `read` (`T/read.js`)

- Schema (line 10): `{ path: string "Path to the file to read (relative or absolute)", offset?: number "Line number to start
  reading from (1-indexed)", limit?: number "Maximum number of lines to read" }`.
- Description (line 53): "Read the contents of a file. Supports text files and images (jpg, png, gif, webp, bmp). Images are
  sent as attachments. For text files, output is truncated to 2000 lines or 50KB (whichever is hit first). Use offset/limit
  for large files. When you need the full file, continue with offset until complete."
- `promptSnippet` "Read file contents"; `promptGuidelines` ["Use read to examine files instead of cat or sed."] (15-18).
- `constrainedSampling: { type: "json_schema", strict: "prefer" }` (58). `outputSchema` string | image object.
- Mechanics: `access(R_OK)`, image detection by file content (`detectSupportedImageMimeTypeFromFile`), image resize via
  `processImage`; text is `buffer.toString("utf-8").split("\n")`, **no line numbers** in output.
- Errors / notices: `Offset N is beyond end of file (M lines total)` (120); first line over 50KB ->
  `[Line N is X, exceeds 50.0KB limit. Use bash: sed -n 'Np' path | head -c 51200]` (136-139);
  `[Showing lines a-b of N. Use offset=K to continue.]` (148) or with `(50.0KB limit)` (151);
  `[R more lines in file. Use offset=K to continue.]` (159). Missing file -> raw `ENOENT` error from `access`.
- Abort: rejects `Operation aborted` immediately on the signal, in-flight fs work is abandoned.
- Not in the mutation queue: a `read` in the same batch as an `edit` of the same file is a race.

### 1.4 `bash` (`T/bash.js`)

- Schema (28): `{ command: string "Shell command to execute", timeout?: number "Timeout in seconds (optional, no default
  timeout)" }`.
- Description (166): "Execute a bash command in the current working directory. Returns stdout and stderr. Output is
  truncated to last 2000 lines or 50KB (whichever is hit first). If truncated, full output is saved to a temp file.
  Optionally provide a timeout in seconds."
- `promptSnippet` "Execute bash commands (ls, grep, find, etc.)"; guideline "You can inspect PI_* environment variables for
  current model and session details." (32-35, only when `exposeSessionEnvironment`, default true, 161).
- Timeout: none by default; `Invalid timeout: must be a finite number of seconds` / `maximum is 2147483.647 seconds`
  (17-27). Timeout and abort kill the whole process tree (`detached` on non-win32, line 65).
- Shell: `getShellConfig(shellPath)` (`dist/utils/shell.js` 57+): custom `shellPath` setting, on Windows Git Bash in
  `%ProgramFiles%\Git\bin\bash.exe` etc., then `bash.exe` on PATH; on Unix `/bin/bash`, then `bash`, then `sh`; args `-c`.
  Settings `shellCommandPrefix` is prepended as `prefix\ncommand` (173).
- Output: `OutputAccumulator` (`T/output-accumulator.js` 33-37) with tail truncation 2000 lines / 50KB, rolling buffer
  2x, full output to a temp file `pi-bash-*.log` when truncated. Notices:
  `[Showing lines a-b of N. Full output: <path>]`, `(50.0KB limit)` variant, `[Showing last X of line N (line is Y). Full
  output: ...]` (233-252). Empty -> `(no output)`.
- Results: non-zero exit -> content + `Command exited with code N`, `isError: true` (295-300); abort -> throws
  `...Command aborted` (271); timeout -> throws `...Command timed out after N seconds` (275).
  `structuredContent` up to 1 MiB (`STRUCTURED_OUTPUT_MAX_BYTES`, 14).
- Not in the mutation queue at all: this is the race in requirement 7.

### 1.5 `edit` (`T/edit.js`, `T/edit-diff.js`)

- Schema (10-22): `{ path: string "Path to the file to edit (relative or absolute)", edits: Array<{ oldText: string "Exact
  text for one targeted replacement. It must be unique in the original file and must not overlap with any other
  edits[].oldText in the same call.", newText: string "Replacement text for this targeted edit." }> "One or more targeted
  replacements. Each edit is matched against the original file, not incrementally. ..." }`.
- Description (85): "Edit a single file using exact text replacement. Every edits[].oldText must match a unique,
  non-overlapping region of the original file. ..."
- Snippet + 4 guidelines (23-31). `renderShell: "self"` (90). `prepareArguments: prepareEditArguments` (43-71):
  `edits` as JSON string -> parsed; single object -> `[obj]`; legacy top-level `oldText`/`newText` -> appended to `edits`.
- `validateEditInput` (74-78): `Edit tool input is invalid. edits must contain at least one replacement.`
- Execution (92-143): `resolveToCwd`, then **the whole read-modify-write inside `withFileMutationQueue(absolutePath)`**;
  `access(R_OK|W_OK)` else `Could not edit file: <path>. Error code: ENOENT.` (112); strips BOM, detects CRLF vs LF by the
  first newline, normalizes to LF, applies edits, restores line ending and BOM, `writeFile utf-8`.
  Success text: `Successfully replaced N block(s) in <path>.` (134); `details: { diff, patch, firstChangedLine }`.
- Matching (`applyEditsToNormalizedContent`, edit-diff 215-260):
  1. `oldText`/`newText` normalized to LF; empty `oldText` -> `oldText must not be empty in <path>.` (196/198).
  2. Each edit: exact `indexOf` first, then **fuzzy**: `normalizeForFuzzyMatch` (31) = NFKC, trim trailing whitespace per
     line, smart quotes -> ASCII, Unicode dashes -> `-`, special spaces -> space.
  3. If any edit needed fuzzy, **all** edits are matched in the fuzzy-normalized content (227), and the result is
     overlaid back so untouched lines keep their bytes (`applyReplacementsPreservingUnchangedLines`).
  4. Uniqueness: `countOccurrences` always counts in fuzzy-normalized space (177-181), so an exact match can still be
     rejected as a duplicate. Errors: `Could not find the exact text in <path>. The old text must match exactly including
     all whitespace and newlines.` / `Could not find edits[i] in <path>...` (184-186); `Found N occurrences of the text in
     <path>. The text must be unique. Please provide more context to make it unique.` / `edits[i]` variant (190-192).
  5. Overlap after sorting by index: `edits[i] and edits[j] overlap in <path>. Merge them into one edit or target disjoint
     regions.` (251). Touching (end == start) is allowed.
  6. No-op: `No changes made to <path>. ...` (202/204).
- Abort: checked after every await, never rejects from the listener, so the queue stays locked until fs work settles.
- TUI preview: `editRenderers.renderCall` (`T/renderers/edit.js`) calls `computeEditsDiff(args.path, args.edits)` when
  args are complete; it needs a top-level `args.path` and every `edits[]` with `oldText`/`newText`, else no preview.

### 1.6 `write` (`T/write.js`)

- Schema (8-11): `{ path: string "Path to the file to write (relative or absolute)", content: string "Content to write to
  the file" }`. Description (25): "Write content to a file. Creates the file if it doesn't exist, overwrites if it does.
  Automatically creates parent directories." Snippet "Create or overwrite files", guideline "Use write only for new files
  or complete rewrites." (12-15).
- Execution (31-53): inside `withFileMutationQueue(absolutePath)`: `mkdir(dirname, recursive)`, `writeFile(utf-8)`
  (plain overwrite, not atomic, no BOM/CRLF handling). Result `Successfully wrote to <path>`, `details: undefined`.

### 1.7 `withFileMutationQueue` (`T/file-mutation-queue.js`)

- Key (11-22): `realpath(path.resolve(filePath))`; on `ENOENT`/`ENOTDIR` falls back to the unresolved `path.resolve`.
  So existing files are keyed by the canonical path (symlinks resolved); **not-yet-existing files are keyed by the
  spelled path**, so two spellings of a new file (symlinked parent, different case on case-insensitive APFS/NTFS) get
  different keys.
- Ordering (27-50): a global `registrationQueue` serializes key computation, so queue slots are taken in the order the
  calls to `withFileMutationQueue` were made. Same key -> strict FIFO; different keys -> parallel.
- Only stock `edit` and `write` use it. `read`, `bash`, `grep`, `find` never wait on it.
- Exported from the package (`dist/index.d.ts` line 26). Extensions importing `@earendil-works/pi-coding-agent` get the
  same module instance as the stock tools: bundled runtime maps the import to the bundled index through
  `VIRTUAL_MODULES` (`CORE/extensions/virtual-modules.js`, loader.js 21, 471-476); the unbundled runtime aliases it to
  `dist/index.js`. So a custom tool can join the same queue as stock `edit`/`write`.

### 1.8 `grep` (`T/grep.js`)

- Schema (11-19): `pattern: string "Search pattern (regex or literal string)"`, `path?: string "Directory or file to search
  (default: current directory)"`, `glob?: string "Filter files by glob pattern, e.g. '*.ts' or '**/*.spec.ts'"`,
  `ignoreCase?: boolean`, `literal?: boolean`, `context?: number "Number of lines to show before and after each match
  (default: 0)"`, `limit?: number "Maximum number of matches to return (default: 100)"`.
- Description (34): "Search file contents for a pattern. Returns matching lines with file paths and line numbers. Respects
  .gitignore. Output is truncated to 100 matches or 50KB (whichever is hit first). Long lines are truncated to 500 chars."
  Snippet "Search file contents for patterns (respects .gitignore)", guidelines `[]`.
- **No `constrainedSampling`** (also on find), so these two are never sent as strict tools.
- rg args (93-99): `--json --line-number --color=never --hidden [--ignore-case] [--fixed-strings] [--glob g] -- pattern
  path`. Context lines are not taken from rg; the tool re-reads each matched file and slices lines itself.
- Output line formats: `rel:line: text` for matches, `rel-line- text` for context. Paths relative to the search dir, or
  basename when a file was given. Byte cap 50KB via `truncateHead(maxLines: MAX_SAFE_INTEGER)` (215).
- Notices: `[100 matches limit reached. Use limit=200 for more, or refine pattern. 50.0KB limit reached. Some lines
  truncated to 500 chars. Use read tool to see full lines]` (219-231). Empty: `No matches found` (192).
- Errors: `ripgrep (rg) is not available and could not be downloaded` (54), `Path not found: <abs>` (64), rg stderr or
  `ripgrep exited with code N` for exit codes other than 0/1.

### 1.9 `find` (`T/find.js`)

- Schema (17-23): `pattern: string "Glob pattern to match files, e.g. '*.ts', '**/*.json', or 'src/**/*.spec.ts'"`,
  `path?: string "Directory to search in (default: current directory)"`, `limit?: number "Maximum number of results
  (default: 1000)"`.
- Description (39): "Search for files by glob pattern. Returns matching file paths relative to the search directory.
  Respects .gitignore. Output is truncated to 1000 results or 50KB (whichever is hit first)." Snippet "Find files by glob
  pattern (respects .gitignore)".
- fd args (128-160): `--glob --color=never --hidden`, `--no-require-git` only outside a git repo (walks up for `.git`),
  `--max-results limit`; a pattern containing `/` adds `--full-path` and a leading `**/`; on win32 `/` -> `[/\\]`.
- Notices: `[1000 results limit reached. Use limit=2000 for more, or refine pattern. 50.0KB limit reached]` (216-224).
  Empty: `No files found matching pattern`. Errors: `fd is not available and could not be downloaded` (125),
  `Path not found: <abs>` only on the custom-ops path (71); with fd a missing dir surfaces as fd's stderr.

### 1.10 rg/fd provisioning (`pi-coding-agent/dist/utils/tools-manager.js`)

- `ensureTool(tool, onStatus)` (300): `getToolPath` first (75-92): `~/.pi/agent/bin/<rg|fd>[.exe]` (`getBinDir()` =
  `getAgentDir()/bin`, `config.js` 519), then PATH by **`spawnSync(cmd, ["--version"])`** for `rg`, or `fd`/`fdfind`.
  This sync spawn runs on every grep/find call when the binary is only on PATH, blocking the event loop.
- Missing: skipped when `PI_OFFLINE` is set (13-17) or on Android; else downloads the latest GitHub release
  (`releases/latest` redirect, 99-121) to `~/.pi/agent/bin`, extracts with `tar` (win32: System32 `tar.exe`, then
  PowerShell `Expand-Archive`). grep/find pass no `onStatus`, so the download is silent. The archive path
  `join(TOOLS_DIR, assetName)` (244) is shared, so two first-time concurrent downloads of the same tool can collide;
  the extract dir is unique.
- On this machine `~/.pi/agent/bin` contains only `fd`; `rg` comes from PATH.

---

## 2. Replacing a built-in tool from an extension

- `pi.registerTool(def)` (`CORE/extensions/loader.js` 231-241) stores the definition in the extension; requires an object
  `parameters` schema.
- `_refreshToolRegistry` (`CORE/agent-session.js` 2841-2924): built-ins are wrapped first, then
  `toolRegistry.set(tool.name, tool)` for extension tools (2895) and `definitionRegistry.set` (2865). **An extension tool
  with a built-in name replaces it.** Between extensions the **first** registration wins
  (`runner.getAllRegisteredTools`, `CORE/extensions/runner.js` 411-421), so `RQW-tools` must be the only extension that
  registers these names.
- Activation: at startup `_buildRuntime` passes `includeAllExtensionTools: true` (agent-session 210-213), and every extension
  tool with `exposure` direct (default) and `defaultActive !== false` is activated on registration (2908-2911, 2931).
  Defaults otherwise `["read","bash","edit","write"]` (2962; `DEFAULT_TOOL_NAMES`, `CORE/settings-manager.js` 35).
  **So registering `grep` and `find` from the extension activates them without any setting.**
- `defaultTools` setting (`CORE/settings-schema.js` 216; resolution `settings-manager.js` 75-93, 1060): plain names replace
  the default list, `+name`/`-name` modify it; read by `sdk.js` 148-160. There is no setter in the extension API
  (`bindCore` exposes `getSettings`, `setActiveTools`, `refreshTools`, agent-session 2770-2774). An extension can call
  `pi.setActiveTools(names)` after bind (e.g. in `session_start`); unknown names are ignored.
- Resume caveat: when `usesDefaultTools`, `_restoreToolsFromTranscript` (1374-1382, called at 214-215) resets the active
  set to the tools recorded in the transcript's system message. A session started without grep/find stays without them
  on resume unless the extension calls `setActiveTools`.
- Factories exported for reuse (`dist/index.d.ts` 26): `createReadToolDefinition`, `createBashToolDefinition`,
  `createEditToolDefinition`, `createWriteToolDefinition`, `createGrepToolDefinition`, `createFindToolDefinition`,
  `createLocalBashOperations`, `withFileMutationQueue`, `truncateHead`, `truncateTail`, `truncateLine`,
  `DEFAULT_MAX_BYTES`, `DEFAULT_MAX_LINES`, `formatSize`. Not exported: `edit-diff.js` helpers
  (`applyEditsToNormalizedContent`, `fuzzyFindText`), `resolveToCwd`, `ensureTool`, renderers.
- `ToolDefinition` fields (`CORE/extensions/types.d.ts` 453-519): `name, label, description, promptSnippet,
  promptGuidelines, parameters, constrainedSampling, renderShell, prepareArguments, outputSchema, exposure, namespace,
  reachesTools, annotations, defaultActive, prepareLoadout, executionMode, execute, renderCall, renderResult`.
  The stock definition is a plain object: `{ ...createEditToolDefinition(cwd), description, parameters, execute }` keeps
  `prepareArguments`, `renderShell`, `constrainedSampling`, renderers. `wrapToolDefinition` (`T/tool-definition-wrapper.js`
  2-14) passes through `name, label, description, parameters, outputSchema, constrainedSampling, prepareArguments,
  executionMode, execute` to the agent core.
- UI kept automatically: `withBuiltInRenderers(toolName, definition)` (`T/renderers/index.js` 35-46, used by
  `modes/interactive/interactive-mode.js` 1706) fills missing `renderCall`/`renderResult` with the built-in renderers
  **by tool name** (not `renderShell`). Renderers receive the raw model args. Stock renderers read `args.path`
  (or `file_path`), `args.offset/limit`, `args.content`, `args.edits[].oldText/newText`. A new multi-file shape (a
  `files` list on write, `edits[].path` without a top-level `path`) will show no path and no diff preview with the
  stock renderers; it needs own renderers or a shape that keeps the top-level fields.
- `pi.registerToolRenderer((toolName, next) => ...)` (docs/extensions.md 193) can override renderers for any name.

---

## 3. Execution of tool calls in one assistant message (`LOOP`)

- Dispatch (366-372): if the agent's `toolExecution === "sequential"` **or any call in the batch** targets a tool whose
  `executionMode === "sequential"`, the **whole batch** runs sequentially; else parallel. Agent default is `"parallel"`
  (`pi-agent-core/dist/agent.js` 145); pi-coding-agent never sets it (no `toolExecution` in `sdk.js`), no setting exists.
- Truncated output (`stopReason === "length"`, 163-164): every call fails without execution with
  `Tool call "x" was not executed: the response hit the output token limit ...` (342-364).
- Parallel path (411-460):
  1. Preparation loop **in the order the model emitted the calls** (`message.content.filter(type === "toolCall")`): for each
     call `await emit(tool_execution_start)`, then `await prepareToolCall` (420). `prepareToolCall` (481-532) =
     find tool (`Tool x not found`), `prepareArguments`, `validateToolArguments`, `await beforeToolCall` = the extension
     `tool_call` event (agent-session 327). **All calls are prepared one after another before any `execute` starts.**
  2. Calls that fail preparation (unknown tool, validation error, blocked by `tool_call`) become immediate results; their
     `tool_execution_end` is emitted during the loop and they **never reach execute** (422-432).
  3. Then `Promise.all(finalizedCalls.map(entry => entry()))` (453). `map` invokes the entries in emitted order; each
     entry calls `executePreparedToolCall` which calls `prepared.tool.execute(...)` (574) synchronously, and
     `wrapToolDefinition`/`wrapRegisteredTool` (`CORE/extensions/wrapper.js` 12-14) and `createToolContext` (runner 696)
     are synchronous too. **So the synchronous prefix of `execute()` of call i runs to its first `await` before call i+1's
     `execute()` is invoked, and all executes of one batch start in one synchronous stretch.**
  4. Results: `Promise.all` keeps emitted order; tool result messages are emitted in emitted order after **all** calls
     settle (454-459). `tool_execution_end` fires in completion order. `afterToolCall` (`tool_result` event) runs per call
     right after its execute.
- Sequential path (374-409): per call prepare -> execute -> finalize -> result message, in order; stops after a call if
  aborted.
- Abort: the Agent's `AbortController` signal is passed to `execute`. If aborted during the preparation loop, the loop
  `break`s (429, 449) and later calls get no result from the loop (the provider layer later inserts `No result provided`,
  `AI/api/transform-messages.js` 138-160). An entry that starts after abort returns `Operation aborted` without executing
  (435-442). Executes already running are awaited: `Promise.all` waits for them, so a tool that ignores the signal holds
  the turn.
- Consequence for a barrier: registering a call in a module-level structure in the synchronous part of `execute()` (before
  the first `await`) gives the exact emitted order, without knowing the batch size. A barrier must never wait for calls
  that did not reach `execute` (step 2), and must release on abort.
- Nested calls (`ctx.executeTool`, used by codemode scripts; `CORE/nested-tool-calls.js` 98-150, LOOP `runToolCall` 559):
  go through `prepareToolCall` (with an awaited `tool_call` event) before execute, so their execute start is not
  synchronous with the batch; they are serialized only when the target tool is `sequential` (118-128). Ids are
  `<parent>/<n>`.

---

## 4. System prompt and where tool text reaches the model (`CORE/system-prompt.js`)

- `buildSystemPromptSections` (68-128): **when `customPrompt` is set, the preamble is the custom prompt and the `tools`
  (snippets) and `rules` (guidelines) sections are not built at all** (78-88). Only `addendum`, `project_context`,
  `skills`, `cwd` and custom sections follow.
- `RQW-prompt` sets `event.systemPromptOptions.customPrompt` in `before_agent_start`
  (`extensions/RQW-prompt/index.ts` 55-58). So in my-pi **`promptSnippet` and `promptGuidelines` never reach the model**.
- The model sees tools only through the provider request: name, `description`, `parameters` (with property
  descriptions). `toToolDeclaration` (`AI/utils/transcript.js` 106-113) records `name, description, parameters,
  constrainedSampling`; providers send `description: tool.description` (e.g. `AI/api/openai-completions.js` 1152-1161,
  `AI/api/openai-responses-shared.js` 304-316, `AI/api/anthropic-messages.js` 1303-1330). `prepareLoadout` can replace
  descriptions of declared tools (agent-session `_applyToolLoadout`).
- A change of a tool declaration mid-session is a remove + add in the transcript system message and can invalidate the
  prompt cache (docs/extensions.md 189).
- `extensions/RQW-prompt/SYSTEM.md` line 23 currently says "This harness has no search tool: search the workspace with
  `rg` through bash"; it contradicts enabling `grep`/`find` and must change with RQW-tools (requirement 4).

---

## 5. Pi behaviour that can break a wrapper

- Validation (`AI/utils/validation.js` 280-311): `structuredClone(args)`, `normalizeOptionalNulls` deletes `null` for
  optional properties whose schema rejects null (204-236, also inside array items), `Value.Convert` coerces types
  (`"5"` -> 5, `"true"` -> true), then TypeBox `Check`. Failure is an immediate error result:
  `Validation failed for tool "x":\n  - path: message\n\nReceived arguments: ...`. Additional properties are allowed
  by TypeBox `Type.Object` unless `additionalProperties: false`.
- `prepareArguments` runs before validation on raw args and must return the shape the schema validates; the stock edit
  one only fixes `edits` shape and legacy `oldText/newText`.
- Strict mode (`AI/api/constrained-sampling.js`): with `constrainedSampling: { type: "json_schema", strict: "prefer" }`
  and a provider that supports strict, the schema is converted (42-105): every optional property becomes required with
  `anyOf: [T, null]`, `additionalProperties: false`. Unsupported -> silently non-strict for `prefer` (171-193):
  `$ref`, `allOf`, `oneOf`, `not`, tuples, unions of object/array variants (`Type.Union([Type.String(), Type.Array(...)])`
  falls back), schema-valued `additionalProperties`. Anthropic also rejects `minimum/maximum/maxItems/...`, `minItems`
  other than 0/1, and unknown `format` (anthropic-messages 1265-1300) and has a "Too many strict tools" limit with an
  automatic non-strict retry (455-475). OpenAI completions sends `strict: false` when unsupported/fallback (1159-1160).
  Nulls the model sends for optional fields in strict mode are removed by `normalizeOptionalNulls`.
- Anthropic OAuth renames tools to Claude Code casing on the wire (`Read`, `Write`, `Edit`, `Bash`, `Grep`; `find` stays
  `find`) and maps them back (anthropic-messages 47-77). Names in Pi stay lowercase.
- Tool count: no limit in the agent loop or session; only the Anthropic strict-tools limit above.
- `ctx.executeTool(name, ...)` from inside our `edit` would call our own registered `edit` (registry is by name) and
  runs the `tool_call`/`tool_result` handlers again; call the stock definitions' `execute` directly instead.
- Errors: a thrown `Error` becomes `{ content: [text: message], details: {} }` with `isError` (LOOP 584-591, 640-645); returning
  `isError: true` keeps `structuredContent`. `terminate` only matters if every call in the batch sets it.
- `executionMode: "sequential"` on any one tool serializes every batch that contains it, including parallel reads.

---

## Facts the design depends on

1. Extension `registerTool` with names `read`, `bash`, `edit`, `write`, `grep`, `find` replaces the built-ins
   (agent-session 2895) and activates them at startup (2908); no `defaultTools` setting is needed for grep/find, except
   for resumed sessions whose transcript lacks them (1374) where `pi.setActiveTools` fixes it.
2. In a parallel batch all calls are prepared (validation + `tool_call`) in emitted order before any execute; then all
   `execute()` calls start in emitted order in one synchronous stretch (LOOP 418-453). An in-order barrier can be built
   by registering synchronously at the top of `execute()`.
3. Calls that fail preparation never reach `execute()`; a barrier must only wait for registered calls.
4. Results reach the model in emitted order after the whole batch settles; a hung execute holds the turn, so every wait
   must honor the abort signal.
5. Any `executionMode: "sequential"` tool makes the whole batch sequential; do not use it for parallelism goals.
6. Stock `withFileMutationQueue` is shared with our code (same module instance), keyed by realpath for existing files
   and by the resolved spelled path for new files; FIFO per key in call order. Only edit/write use it; read, bash, grep,
   find do not, which is the source of the read-after-write and bash races.
7. With `customPrompt` set (RQW-prompt), `promptSnippet`/`promptGuidelines` are dropped; the tool `description` and
   parameter descriptions are the only tool text the model sees.
8. Stock renderers are picked by tool name and read `args.path`, `args.content`, `args.edits[].oldText/newText`; a new
   multi-file argument shape needs its own `renderCall`/`renderResult`.
9. Stock limits are 2000 lines / 50KB bytes (500 chars per grep line, 100 matches, 1000 find results); character-based
   limits (requirement 8) mean own truncation code, `truncateHead/Tail` work in bytes.
10. Keep schemas strict-compatible (no object/array unions, no `minItems > 1`, no min/max) so `strict: "prefer"` stays
    strict on OpenAI and Anthropic; grep/find stock definitions have no `constrainedSampling` at all.
11. rg/fd come from `~/.pi/agent/bin` or PATH via `ensureTool`, downloaded silently if missing; on Windows the binaries
    are `rg.exe`/`fd.exe` from the GitHub zip; reusing the stock grep/find `execute` keeps this behaviour.
