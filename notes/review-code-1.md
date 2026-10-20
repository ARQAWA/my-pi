# RQW-tools: corner-case hunt 1 (read-only)

Scope: `extensions/RQW-tools/*.ts` against `notes/tools-requirements.md`, `notes/tools-design.md`,
`notes/analysis-races.md`, stock Pi 1.3.0 in `node_modules/@earendil-works/`. Probes: `/tmp/rqw-hunt/probe*.mjs`,
`/tmp/rqw-hunt/hint*.mjs` (scratch, not part of the package).

Checked and clean (no finding):
- `npm test` passes on Node 26.7.0 and on Node 22.19.0 (`npx -p node@22.19.0 -- node --test ...`): 82 tests, 81 pass, 1 skipped.
- Description files load through Pi's real loaders: unbundled `loadExtensions` (jiti) and the bundled
  `dist/bundle/index.js` `DefaultResourceLoader` + `createAgentSession` with `additionalExtensionPaths`; all six
  descriptions are ours, no load errors. `import.meta.url` resolves to the source file in both.
- Strict mode: `makeStrictJsonSchema` accepts read, bash, edit, write; union parameters after Pi's optional->nullable
  rewrite: read 2, bash 1, edit 2, write 3 = 8 (Anthropic limit 16), optional 8 (limit 24); no `minItems`,
  `minimum`/`maximum`, no source unions. grep and find have no `constrainedSampling` (stock).
- Registration order: the CLI bundle (`dist/bundle/chunks/chunk-66G7ITPS.js`) has the same `executeToolCallsParallel`
  / `executePreparedToolCall` as `pi-agent-core/dist/agent-loop.js`; `wrapToolDefinition` calls `definition.execute`
  synchronously; `register()` calls `schedule(scopeOf(...))` before any await; `scopeOf` never throws.
- Null handling: `normalizeOptionalNulls` deletes optional nulls before validation (`write {path:null, content:null,
  files:[...]}` and `edit {path:null, ...}` validate to the intended form).
- grep/find `path: ""`: stock uses `searchDir || "."`, the key of `""` is the cwd key: same scope.

---

## Findings, ordered by severity

### 1. High: user settings `shellPath`, `shellCommandPrefix`, `images.autoResize` are dropped

- `extensions/RQW-tools/index.ts:58`: `const bash: any = createBashToolDefinition(cwd);`
- `extensions/RQW-tools/index.ts:55`: `const read: any = createReadToolDefinition(cwd);`
- Stock builds them with the settings, `pi-coding-agent/dist/core/agent-session.js:2944-2945`:
  `read: { autoResizeImages },` / `bash: { commandPrefix: shellCommandPrefix, shellPath },`
- Input: `settings.json` with `"shellPath": "D:\\tools\\Git\\bin\\bash.exe"` (Git not under Program Files) on Windows,
  or `"shellPath": "/opt/homebrew/bin/bash"` on macOS, or `"shellCommandPrefix": "source ~/.venv/bin/activate"`.
- Effect (proven from code): `createLocalBashOperations({ shellPath: undefined })` -> `getShellConfig(undefined)`
  (`dist/utils/shell.js:58`) searches only Program Files and PATH; on Windows without bash on PATH every `bash` call
  fails with "No bash shell found ... Set shellPath in settings.json" although the user did set it. On macOS the
  user's bash is replaced by `/bin/bash` 3.2. The command prefix is never prepended. `images.autoResize: false` is
  ignored by `read`. Stock Pi honours all three. Breaks requirement 9 (Windows) and design decision 1 ("same tools").
- Required outcome: our `read` and `bash` are built with the same options stock uses (`SettingsManager.create(cwd)`
  is exported: `getShellPath()`, `getShellCommandPrefix()`, `getImageAutoResize()`), so a configured `shellPath`,
  prefix and auto-resize behave exactly as in stock Pi; a test covers `shellPath`.

### 2. High: the tool selection of the user is overridden (`defaultTools`, `--tools +x/-x`)

- `extensions/RQW-tools/index.ts:39`: `pi.registerTool({` (no `defaultActive`), and
  `extensions/RQW-tools/index.ts:118-121`: `pi.on("session_start", () => { ... if (missing.length > 0) pi.setActiveTools([...active, ...missing]);`
- Cause: overrides of `read`, `bash`, `edit`, `write` are extension tools; at startup
  `_refreshToolRegistry` (`agent-session.js:2908-2911`, `includeAllExtensionTools`) activates every extension tool
  whose `defaultActive !== false`, regardless of `defaultTools` or `--tools` modifiers.
- Input and observed effect (`/tmp/rqw-hunt/probe4.mjs` with our factory vs `probe4s.mjs` without it, real
  `createAgentSession`):

  | Configuration | Stock Pi | With RQW-tools |
  |---|---|---|
  | default | bash,edit,read,write | bash,edit,find,grep,read,write |
  | `--tools -edit` | bash,read,write | bash,**edit**,find,grep,read,write |
  | `defaultTools: ["read","grep","find"]` (read-only setup) | find,grep,read | **bash,edit**,find,grep,read,**write** |

  A user who configured a read-only tool set gets `bash`, `edit` and `write`. In addition, on a resumed session the
  `session_start` handler re-adds `grep`/`find` even when the user removed them with `--tools -grep` or with
  `defaultTools` (the handler does not distinguish "lacks because old transcript" from "user turned it off").
- Probe `/tmp/rqw-hunt/probe5.mjs` shows `defaultActive: false` on the registered tools restores stock selection
  for the four overridden tools (`--tools -edit` -> bash,read,write; read-only defaultTools -> find,grep,read).
- Required outcome: `defaultTools`, `--tools` lists and `+name`/`-name` modifiers give the same active set as stock
  for read/bash/edit/write; grep and find are added only where the user did not configure the tool set (or the
  turning-on mechanism is documented and respects an explicit `-grep`/`-find`); a test runs the three rows above.

### 3. High: the nearest-match hint blocks the event loop for seconds

- `extensions/RQW-tools/hint.ts:6`: `const MAX_COMPARISONS = 50_000; // window count x oldText lines` and
  `hint.ts:45`: `if (windows * size > MAX_COMPARISONS) return undefined;`; the loop at `hint.ts:50`
  `for (let start = 0; start < windows; start++) {` is fully synchronous; each comparison is a Levenshtein of up to
  `MAX_LINE` x `MAX_LINE` = 200 x 200 cells, which the cap does not count.
- Input: any `edit` whose oldText is not found ("Could not find", the most common edit failure), measured with
  `/tmp/rqw-hunt/hint2.mjs` on this machine:
  - 2500-line file, 100-char lines, 20-line oldText: **3.7 s**
  - 5000-line file, 120-char lines, 10-line oldText: **5.5 s**
  - 1000-line file, 200-char lines, 50-line oldText: **14.5 s**
  - 49 999-line file, 200-char lines, 1-line oldText: **12.2 s** (`hint.mjs`)
- Effect: the whole Pi process is frozen for that time: TUI does not repaint, Escape/abort is not processed, timers of
  parallel `bash` calls (timeout, output throttling) and every other tool call of the batch stall. The hint runs
  even for a single-file edit (`edit.ts` `withHint` on the one-group path).
- Required outcome: the hint's worst case is bounded in CPU time, not only in comparison count (e.g. cap on
  total Levenshtein cells, or a cheaper similarity), so no input makes a failed edit block the event loop for more
  than a few tens of milliseconds; a test with a large long-line file asserts the bound.

### 4. Medium: race between `read` and `write`/`edit` when `read` resolves through a stock fallback

- `extensions/RQW-tools/keys.ts:77-79`: `case "read":` / `kind = "read";` / `paths = [args.path];`
  -- the key is built from the typed path, but stock `read` opens a different file:
  `pi-coding-agent/dist/core/tools/read.js:73`: `const absolutePath = await resolveReadPathAsync(path, ctx?.cwd || cwd);`
  which falls back to the curly-quote (`'` -> `’`), NFD and combined variants when the typed path does not exist.
  `notes/analysis-races.md` section 4 step 1 specifies `resolveReadPath` for read keys; the implementation skipped it.
- Input (one response, message order): `read {path: "Capture d'écran.txt"}` (straight quote), then
  `write {path: "Capture d’écran.txt", content: "NEW"}`; only the curly-quote file exists with `OLD`.
  Keys: `/private/tmp/rqw-hunt/q/capture d'écran.txt` vs `/private/tmp/rqw-hunt/q/capture d’écran.txt`: no conflict.
- Observed (`/tmp/rqw-hunt/probe3.mjs`, 30 runs each): straight-quote read saw **NEW 30/30** (program order says
  OLD); the same batch with the curly spelling (equal keys) saw OLD 30/30. On Linux the NFD fallback gives the same
  race for `read "café.md"` (NFC) vs `edit "café.md"` (NFD), since Linux keys are not NFC-normalised.
- Required outcome: the read key names the file stock `read` will open (apply Pi's `resolveReadPath` fallbacks
  before canonicalising, as analysis-races.md section 4 says); a key test covers the curly-quote and NFD cases.

### 5. Medium: one multi-file `write` with a file and a path below it has a nondeterministic result

- `extensions/RQW-tools/write.ts:55`: `const seen = new Set<string>();` rejects only equal keys; then
  `write.ts:67`: `const settled = await Promise.allSettled(files.map(runFile));` runs `a` and `a/b` in parallel.
  The barrier's ancestor rule (race #13 of analysis-races.md) is not applied inside one call.
- Input: `write {files: [{path: "a", content: "file"}, {path: "a/b", content: "nested"}]}` in an empty directory.
- Observed (`/tmp/rqw-hunt/probe8.mjs`, 20 runs): 19x `Failed: a: EISDIR ... | Written: a/b`, 1x
  `Written: a | Failed: a/b: EEXIST ... mkdir`. Same input, two different end states of the file system.
- Required outcome: deterministic: either reject the call before writing anything when one entry's key is an
  ancestor of another's (like duplicates), or run such entries in list order.

### 6. Medium: `write.files` sent as a JSON string is rejected

- `extensions/RQW-tools/index.ts:76-85`: `write` gets no `prepareArguments`, while stock `edit` exists precisely to
  repair this model behaviour (`dist/core/tools/edit.js`: "Some models (Opus 4.6, GLM-5.1) send edits as a JSON
  string instead of an array").
- Input: `write {files: "[{\"path\":\"a\",\"content\":\"x\"},{\"path\":\"b\",\"content\":\"y\"}]"}`.
- Observed (`/tmp/rqw-hunt/probe1.mjs`, real `validateToolArguments`): `Validation failed for tool "write": - files.0:
  must be object` (TypeBox `Convert` wraps the string into a one-element array). The same models get a working
  multi-file `edit` (stock prepare parses `edits`) but a failing multi-file `write`.
- Required outcome: `write` parses a JSON-string `files` (array, or a single `{path, content}` object) like stock
  edit does for `edits`; a test covers it.

### 7. Low-medium: Pi's own consumers read only `args.path`; per-entry paths and `files[]` are invisible or wrong

- `extensions/RQW-tools/render.ts:37`: `return files.length === 1 && !str(args?.path) ? { ...args, path: files[0].path } : args;`
- Input A: `edit {path: "a.txt", edits: [{path: "b.txt", oldText: "x", newText: "y"}]}` (top-level path as a default,
  every entry overrides it). Observed (`/tmp/rqw-hunt/probe6.mjs`): the stock renderer receives `path: "a.txt"` in
  both `renderCall` and `renderResult`; the stock preview computes the diff of these edits against `a.txt` (red
  "Could not find" preview) while execute edits `b.txt`, and the header says `edit a.txt`.
- Input B: any `write {files: [...]}` or `edit` with per-entry paths, followed by compaction.
  `pi-coding-agent/dist/core/compaction/utils.js:38`: `const path = typeof args?.path === "string" ? args.path : undefined;`
  -> these files are missing from the compaction summary's `<modified-files>` (Input A even lists the wrong file).
  `tree-selector.js:799-805` and `export-html/template.js` show `[edit: ]` / `[write: ]` for the same calls.
- Required outcome: the renderer passes the single distinct file whenever there is exactly one, regardless of the
  top-level path; and the compaction file list stays correct for multi-file calls (e.g. a `session_before_compact`
  contribution, or documented as a known gap in DECISIONS.md if accepted).

### 8. Low-medium: strict-mode "fill every key" outputs fail `write`

- `extensions/RQW-tools/write.ts:38-39`: `const hasSingle = params?.path != null || params?.content != null;` /
  `if (hasFiles === hasSingle) throw new Error(FORM_ERROR);`
- In strict mode Pi sends `required: ["path","content","files"]` (probe1 output), so the model must emit all three.
  Input: `{path: "", content: "", files: [{path: "a", content: "x"}]}` or `{path: "a", content: "x", files: []}`.
  Observed: both validate (probe1: `write empty strings` passes validation) and then both throw
  `Give path and content, or files, not both` (`hasFiles` and `hasSingle` are both true), nothing is written.
- Required outcome: an empty `files` array, or an empty `path` together with an empty `content`, counts as "form not
  used", so these strict-mode shapes write the intended files.

### 9. Low: multi-file edit errors cite indices the model never sent

- `extensions/RQW-tools/edit.ts:96`: `const settled = await Promise.allSettled(groups.map(runGroup));` each group is a
  separate stock call, so stock messages number entries within the group.
- Input: `edit {edits: [{path:"a.txt", oldText:"one",...}, {path:"b.txt", oldText:"alpha",...}, {path:"b.txt", oldText:"gamma",...}]}`.
- Observed (`probe6.mjs`): `Failed: b.txt: Could not find edits[1] in b.txt ...` -- the failing entry is `edits[2]`
  of the call; `edits[1]` of the call (`alpha`) exists. Same for "Found N occurrences of edits[i]" and overlap errors.
- Required outcome: messages in multi-file results refer to the model's own indices (map group index back to the
  call index).

### 10. Low: the hint reads a different file than stock for `@`, `~` and Git Bash paths

- `extensions/RQW-tools/edit.ts:57`: `group = { path, abs: resolve(cwd, path), edits: [] };` -- plain
  `path.resolve`, no `@` strip, no `~` expansion, no win32 `/c/x` conversion (stock uses `resolveToCwd`).
- Input: `edit {path: "~/proj/a.ts", ...}` or `"@src/a.ts"` or, on Windows, `"/c/Users/me/a.ts"` with a mismatching oldText.
- Effect: `nearestMatchHint` reads `<cwd>/~/proj/a.ts` / `<cwd>/@src/a.ts` / `C:\c\Users\...`, fails, and the hint
  silently disappears (never wrong content, only lost).
- Required outcome: `abs` comes from the same resolver stock edit uses (`resolveToCwd`).

### 11. Low (outside the six, note only): stock `ls` and `powershell` bypass the barrier

- `ls` and `powershell` are registered stock tools in Pi 1.3.0 (`getAllTools()` lists them, probe7) and are not
  wrapped. If a user enables them (`--tools +ls`, `+powershell`), `[write a, ls]` and `[write a, powershell "Get-Content a"]`
  race exactly like stock. Requirement 7 names the base set; requirement 9 mentions PowerShell.
- Required outcome: either both get barrier scopes (`ls` -> read [key(path ?? ".")], `powershell` -> all), or the gap
  is recorded in DECISIONS.md.
