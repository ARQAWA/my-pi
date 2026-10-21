# Settings: what turning on `codemode` and `tool_search` changes for the model

RQW-settings also disables background prompt-cache warming, without disabling prompt caching or writing user
settings. Config values cannot enable warming; switching the extension off restores stock Pi behavior. The policy and
mechanism live in [DECISIONS.md, Settings](../DECISIONS.md#settings); tests: `extensions/RQW-settings/test/cache-warming.test.ts`.

Decision: `extensions/RQW-settings/index.ts` adds `codemode` and `tool_search` to the active tools at `session_start`
when the user made no tool selection (owner: «Давай включим CodeMode и Tool Search»). Pi 1.3.0. Source paths below are
relative to `node_modules/@earendil-works/pi-coding-agent/dist/`.

Captured by building a real session (three extensions in package order, faux provider, no model call) and reading the
system message that the request carries: `toolsAdded[]` of the first `role: "system"` message in the faux provider's
received context. The same text is in `session.agent.state.tools[].description`.

## How the text gets there

1. `extensions/codemode/index.js:19-29` registers `codemode` with `defaultActive: false`; `extensions/tool-search/index.js:11`
   registers `tool_search` the same way. Neither is active until someone activates it (here: RQW-settings).
2. `core/agent-session.js:1104` `setActiveToolsByName` -> `_setActiveTools` -> `_applyToolLoadout` (`:1160`).
   `_applyToolLoadout` calls the `prepareLoadout` hook of every active tool that has one; only `codemode` has one
   (`extensions/codemode/tool.js:265`). The hook returns replacement `descriptions`; `declared` tools get them
   (`core/agent-session.js:1170-1203`). It runs on every change of the active set, so the note is rebuilt each time.
3. `prepareCodemodeLoadout` (`extensions/codemode/tool.js:209-241`): with `codemode.mode` `"on"` (default,
   `core/settings-defaults.js:57`) every declared tool that is callable from scripts gets `describeScriptCall(tool)`
   (`tool.js:194-196`): its own description, a blank line, then the note. `codemode` itself lists only callable tools
   whose exposure is not `direct` (`tool.js:221`); our six are `direct`, so the codemode description has no tool
   sections (no `Nested tools:` block). In `"only"` mode all six would be hidden from the model; not used.
4. `tool_search` description is a constant, `extensions/tool-search/tool.js:159`, used at `:164`.

## Text appended to our six tools (verbatim, after the tool's own description)

Format, `extensions/codemode/tool.js:195`: `<description.trim()>` + `\n\nCodemode: \`tools.<name>(args)\` resolves to <output>.`

```
read:  Codemode: `tools.read(args)` resolves to `string | { data: string; mimeType: string; note: string; type: "image"; }`.
bash:  Codemode: `tools.bash(args)` resolves to `{ output, truncated, full_output_path?, exit_code, wall_time_seconds }`.
edit:  Codemode: `tools.edit(args)` resolves to a string.
write: Codemode: `tools.write(args)` resolves to a string.
grep:  Codemode: `tools.grep(args)` resolves to a string.
find:  Codemode: `tools.find(args)` resolves to a string.
```

Each is separated from the description by one empty line. The six descriptions of `extensions/RQW-tools/descriptions/*.md`
are otherwise unchanged. The note is not a property of our tools: it is added to the copy Pi sends, so the registered
definitions stay as they are.

## `codemode` description (verbatim, 1393 characters)

Line references: intro `extensions/codemode/tool.js:49-51`, globals `:53-64`, assembly `:124-160`.

~~~~text
Run JavaScript that calls other tools. The input is raw JavaScript (not JSON, no code fence), run as an async function body in a QuickJS sandbox: top-level `await` and `return` work. No Node, file system, network, or timers.
- `await tools.<name>({ ...args })` resolves to a string, or an object if the tool's declaration says so, and rejects with an Error on failure. A tool whose declaration returns an object resolves on failure too when it returned that object; check its fields. Calls still running when the script ends are cancelled.
- Optional first line: `// @options: {"max_output_tokens": 10000, "timeout_ms": 60000}`

Globals:
- `text(value)`, `image(dataUrlOrImageBlock)`, `console.log(...)`, and top-level `return` add output; `exit()` ends the script. With several text items, each starts with a `==> text N/M <==` line, and `console` lines follow the other output in one `<console_output>` block. `image()` also saves the image to a temp file and the result names its path.
- `store(key, value)` and `load(key)` keep JSON values across codemode calls.
- `ALL_TOOLS`, `await searchTools(query, { limit?, namespace? })`, `await describeTool(name)`, `await describeNamespace(name)`: find unlisted tools, such as MCP tools.
- `models`: classifiers and image generation. Read /Users/arkadijcukavin/ai-project/my-pi/node_modules/@earendil-works/pi-coding-agent/docs/codemode.md first.
~~~~

- The last line carries an absolute path, `getDocsPath()` + `codemode.md` (`tool.js:48`, `:61`). It differs per machine
  and install; on the Windows bundle it is a path inside the bundled Pi.
- Parameters: `{ code: string }`, description "Raw JavaScript source." (`tool.js:36-40`). The tool also carries
  `constrainedSampling` with an `openai_lark` grammar for raw JavaScript (`tool.js:268`).
- Prompt snippet "Run JavaScript that calls other tools" and the guideline "Use codemode to batch independent tool
  calls (Promise.allSettled), chain them, or filter large output, instead of many separate calls." (`tool.js:41-46`).
  Pi's default system prompt puts them into its `<tools>` and `<rules>` sections. RQW-prompt sets `customPrompt`, which
  replaces those sections: in the captured request the system message has only the sections `preamble` and `cwd`, and
  the word `codemode` is not in them. The model learns of codemode only from the tool definitions, not from the system
  prompt text.

## `tool_search` description (verbatim, 338 characters)

~~~~text
# Tool discovery

Searches over deferred tool metadata with BM25 and exposes matching tools for the next model call.

Some of the tools, such as tools of MCP servers, may not have been provided to you upfront, and you should use this tool (`tool_search`) to search for the required tools. For MCP tool discovery, always use `tool_search`.
~~~~

- Parameters: `{ query: string, limit?: number }`; "Search query for deferred tools.", "Maximum number of tools to
  return. Defaults to 8." (`extensions/tool-search/tool.js:132-133`).
- Snippet "Search for tools that are not loaded yet and load the matches" (`:165`). It finds only tools with exposure
  `codemode` or `deferred` (`:136-145`); with no MCP servers there are none, so it returns nothing useful.
- Its description is about MCP tools, which this setup does not have. It costs 338 characters per request and gives the
  model a tool that cannot find anything.

## Size

The six notes plus the two new descriptions add about 2200 characters (about 550 tokens) to every request.

## Order of the active tools

RQW-settings loads first, so its `session_start` handler runs first: `codemode` and `tool_search` come before `grep`
and `find` in the declared tool list (`read, bash, edit, write, codemode, tool_search, grep, find`). Both handlers read
`pi.getActiveTools()` at call time and call `pi.setActiveTools` with the union, so neither drops what the other added;
`test/package.test.ts` checks three load orders.

## Calls from a script and the barrier

Source paths below are relative to `node_modules/@earendil-works/pi-coding-agent/dist/` unless they start with
`pi-codemode/` (`node_modules/@earendil-works/pi-codemode/dist/`).

### The race this fixes

A model message is run with all its calls in parallel; the barrier (`notes/analysis-races.md` section 5) orders them by
registration at the top of each of our `execute` wrappers. `codemode` is not one of our tools, so it was not registered:
in `[codemode(script: write f), read f]` the `read` registered first and ran before the script, which needs tens of
milliseconds to start its worker, reached `write`. The model order said codemode first.

### Required semantics

- The `codemode` call is one call of the barrier with scope `all`, like `bash`: it waits for every earlier call of the
  message, and every later call waits for it.
- The tool calls made by its own script are ordered among themselves by a separate barrier that belongs to that
  codemode call (`write` then `read`, `Promise.all([write, read])`), and never wait for the outer entry. Waiting would
  deadlock: the outer entry ends only when the script ends.

### Mechanism (`extensions/RQW-tools/nested.ts`, `extensions/RQW-tools/codemode.ts`)

1. `createNestedBarrier()` holds the outer barrier and a map from the tool call id of a running group to the barrier
   of its calls. `schedule(id, scope, run)` gets the tool call id Pi passes to `execute`; every `execute` of our six
   tools calls it. A call whose id has a `/` walks up its id (`c0/1/1` -> `c0/1` -> `c0`) and uses the barrier of the
   first registered group. With none, it uses the outer barrier, unless one of those ancestor ids has a live entry
   there: then it runs at once, because waiting there could mean waiting for its own ancestor.
2. `group(id, run)` registers a new barrier under `id` at once, before it waits, then registers one `all` entry where
   `schedule(id, ...)` puts it (the outer barrier for a model call). When `run` ends it waits for every call still live
   in its own barrier (a script that does not await a nested call), so later outer calls wait for those too. Then the
   registration is removed. A call that has not started when the script ends is cancelled: the sandbox aborts the
   signal of every pending call (`pi-codemode/runtime/execution.js:347`, `pending.controller.abort()`), and our
   wrappers check the signal after waiting and return "Operation aborted" without side effects.
3. `takeOverBuiltinCodemode(pi, nested)` runs in the `session_start` handler of RQW-tools, for every reason. When the
   registered `codemode` has `sourceInfo.source === "builtin"`, it calls Pi's own factory `createCodemodeExtension()`
   (exported by the package; the built-in extension is the same call with no options, `extensions/codemode/index.js:32`)
   with a copy of `pi` whose `registerTool` only captures the definition, and registers `{ ...definition, execute }` where
   `execute` is `(id, ...rest) => nested.group(id, () => definition.execute(id, ...rest))`. Description, parameters, `exposure`,
   `prepareLoadout`, `reachesTools`, `constrainedSampling`, `defaultActive: false` and the renderers are the built-in's
   own objects. Test: "the definition equals the built-in one except for the closures that differ per load" compares
   the registered definition and the description the model reads, with and without RQW-tools.

### Why this way and not another

- `omitReplacedExtensions` (`core/resource-loader.js:71`) is the "replaceable" takeover: "an extension that registers
  `codemode` ... takes over instead of the built-in one" (`extensions/index.js:7-8`). It cannot honour
  `-builtin:codemode`: a tool registered while the extension loads is registered whatever the setting says, and
  `getAllTools` is `notInitialized` then (`core/extensions/loader.js:125`), so the setting cannot be read. It also puts
  a warning on every start: "so built-in extension `codemode` was not loaded" (`core/resource-loader.js:94`).
- Registering at `session_start` has no such problem: with `-builtin:codemode`, or with the tool excluded, no
  `codemode` is registered, so nothing is taken over and there is no `codemode` at all. Tests: "`-builtin:codemode`
  leaves no codemode at all" (with the whole package in `test/package.test.ts`, with RQW-settings alone in
  `settings.test.ts`, and with RQW-tools alone in `extensions/RQW-tools/test/codemode.test.ts`).
- The registry takes the first registration per name: "Get all registered tools from all extensions (first
  registration per name wins)" (`core/extensions/runner.js:410`), in extension load order. Pi loads built-ins last:
  "Built-in extensions load after file and package extensions, whichever scope enables them."
  (`core/package-manager.js:63`, `resourcePrecedenceRank`; `-e builtin:codemode` is sorted the same way). So the
  registration of RQW-tools wins. The test "the definition equals ..." asserts that the registered `codemode` is ours
  (`sourceInfo.source` is not `builtin`), so a Pi update that changes this order fails a test.
- A `codemode` registered by another extension (not `builtin`) is left alone.
- Wrapping through a hook was not possible: the `tool_call` event runs before `execute` and cannot wait for earlier
  calls, and `analysis-races.md` section 1 rules out registering a barrier entry from an event handler (a later handler
  may block the call and leave an entry that never ends).

### Why the id reaches our `execute` (proof from the source)

The script runs in a worker thread, and a script call comes back as a message of that worker. The chain from the
`execute` of `codemode` to the `execute` of our tool carries the id as an argument at every step:

1. `extensions/codemode/tool.js:270`: `execute: async (toolCallId, params, ...) => (await loadCodemodeExecutor())
   .executeCodemode(toolCallId, params, ...)`; `extensions/codemode/execute.js:383` `executeCodemode(toolCallId, ...)`.
   Our wrapper registers the group under this same `toolCallId`.
2. `extensions/codemode/execute.js:421`: `const outcome = await ctx.executeTool(tool.name, args, { signal: callSignal });`.
   `ctx` is the tool context of the codemode call: `core/extensions/wrapper.js:13`
   `runner.createToolContext(toolCallId, signal)`, and its `executeTool` passes that id on
   (`core/extensions/runner.js:696`, `:719` `return runner.executeToolFn(toolCallId, name, args, ...)`).
3. `core/agent-session.js:2816` `executeTool: (callerId, name, args, options) => this._executeNestedToolCall(...)` ->
   `:388` `_executeNestedToolCall(parentToolCallId, ...)` -> `core/nested-tool-calls.js:98` `execute(callerId, ...)`.
   `:95`: "The nested call gets the id `<callerId>/<n>`."; `:106`: ``id: `${callerId}/${scope.nextId++}` ``.
4. `core/nested-tool-calls.js:136` `outcome = await this.host.runToolCall(toolCall, ...)` -> `core/agent-session.js:401`
   `return runToolCall(toolCall, ...)` -> `core/tools/tool-definition-wrapper.js:12`
   `definition.execute(toolCallId, params, ..., ctx ?? ctxFactory?.(toolCallId, signal))`: our `execute` gets `c0/1`.
   A nested call that itself calls `ctx.executeTool` (the `relay` test tool) gets a context for `c0/1`, so its call is
   `c0/1/1`.

The first version carried the group's barrier in `AsyncLocalStorage` instead. Node keeps that context in the
`message` callback of a worker created inside it; Bun does not (review A: `worker.on(message) store = undefined` on
Bun 1.4.3). Pi's release binaries run on Bun (`config.js:424` `isBunBinary ? "bun-binary"`), the Windows `pi.exe` of
PCLI included. There every script call went to the outer barrier, waited for its own codemode call, and hung: the
real 1.3.0 binary printed `tool_execution_start c0 codemode`, `tool_execution_start c0/1 write`, then nothing.

Tests that prove the routing, on Node 22.19 and Node 26, and on Bun 1.3.14 (the runtime inside the Pi 1.3.0 binaries)
and Bun 1.4.3:

- `extensions/RQW-tools/test/bun/codemode-check.mjs` (`npm run test:bun`, CI job `bun-codemode` on Ubuntu and
  Windows, both Bun versions): runs Pi's own CLI under Bun (`dist/bun/cli.js`, the entry of the release binary) with
  this package and a faux model (`test/bun/faux-codemode.ts`). The script is
  `await tools.write({ path: "f.txt", content: "NEW\n" }); return await tools.read({ path: "f.txt" });`. It passes
  when the turn ends within 60 s, `c0/2 read` returns `NEW`, and f.txt is `NEW`. On the AsyncLocalStorage version
  (feefe18) it fails on both Bun versions: `FAIL after 20.0 s: no end after 20 s (hang)`, f.txt still `old`. The same
  package also passes on the Pi 1.3.0 darwin-arm64 release binary.
- `extensions/RQW-tools/test/nested.test.ts`: the barrier without Pi, by ids: a call of a call (`c0/1/1`) finds the
  group `c0`, a group inside a group, removal when the group ends, a call from a worker's `message` callback lands in
  the group's barrier, and a nested id with no group either runs at once (an ancestor is live in the outer barrier) or
  is ordered in the outer barrier (an ancestor that is not ours).
- `extensions/RQW-tools/test/codemode.test.ts`, "the id Pi gives a script's call leads to its script through Pi's
  sandbox": a test extension (`test/fixtures/probe.ts`) takes over `codemode` with the production function and
  registers a `probe` tool that reports `nested.groupOf(id)`. Results: a model call of `probe` -> `no-group`; one
  script calling `probe` directly, through a tool that runs `ctx.executeTool` (a nested call of a nested call), and in
  `Promise.all` -> `group-1,group-1,group-1,group-1`; a second script -> `group-2`.

### Tests of the semantics

`extensions/RQW-tools/test/codemode.test.ts`, describe "the codemode call is one call of the barrier, with scope all
like bash": `[codemode(write f), read f]` (10 of 10), `[write f 500 KB, codemode(script: bash wc -c f)]` (10 of 10),
`[bash sleep 0.3 && echo > g, codemode(read g)]`, `[codemode(bash sleep 0.3 && echo > g), read g]`,
`[codemode(write f), codemode(read f)]`, `[codemode(read f), write f]` (the script still sees the old content), a nested
`Promise.all` with a bash before and a read after, and nested calls of nested calls without deadlock. Every run has a
5 s watchdog that aborts the session. With the take-over switched off, six of them fail; the older describe "the
RQW-tools barrier holds for calls made from a codemode script" stays green. `extensions/RQW-tools/test/nested.test.ts`
tests the barrier without Pi (order, scope all, no wait for the group's entry, still-running calls, routing by id,
`groupOf()`).

### Test watchdog

The ordering tests guard the entire `session.prompt()`, including the faux assistant's streaming before tools start.
Pi 1.3.0's `pi-ai/dist/providers/faux.js` defaults to random chunks of 3-5 tokens (12-20 characters), queues a
microtask for each, and emits a `toolcall_delta` for each piece of the JSON arguments. The 500 KB write therefore
produces about 31,000 stream events unrelated to the barrier. `pi-agent-core/dist/agent-loop.js` forwards each as
an awaited `message_update`; tools cannot execute until the assistant message ends. A loaded Windows runner can
exhaust the test's deadline in this setup, before either the write or codemode enters the barrier.

The test-only fix and unchanged deadlock protection are recorded in [DECISIONS.md, Tools](../DECISIONS.md#tools).
The 500 KB case also asserts the exact stream-event count, so accidentally restoring tiny faux chunks fails
deterministically rather than depending on runner speed. There is no change to real model streaming or product code.

Measured before/after: Windows under CPU pressure had 2/10 deadline misses before and 0/10 after
([run](https://github.com/ARQAWA/my-pi/actions/runs/39656398851)). A Windows full-file loop passed all ten
iterations per variant, each including ten repetitions of the 500 KB case: 100 samples per variant, no misses
([loop run](https://github.com/ARQAWA/my-pi/actions/runs/39655943709)).

### Limits

- Two `codemode` calls in one message run one after the other (`all` against `all`), like two `bash` calls.
- Stock Pi 1.3.0 on Bun, `pi.exe` included, allows 2 codemode workers (`extensions/codemode/execute.js:23`
  `MAX_CONCURRENT_CODEMODE_WORKERS = 2`) and frees a slot only on the worker's `exit` event
  (`pi-codemode/dist/runtime/host.js:36-37`), which Bun sends late. A codemode call that starts right after other
  scripts, such as the third in one message, can fail at once with "Codemode worker limit reached (2 workers are still
  running or shutting down)". Node does not do this. It is the same with the take-over switched off (review B).
- The routing relies on Pi's nested id format `<parent id>/<n>` (`core/nested-tool-calls.js:106`). A Pi update that
  changes it sends script calls to the outer barrier, where they wait for their codemode call: the Bun check and the
  codemode tests of RQW-tools then fail on their watchdogs. A model call id that has a `/` and starts with the id of a running
  codemode call would be ordered with the calls of that script instead of after it; it would not hang.
- A script that does not await a nested call keeps its group open until that call ends (see 2 above).
- Calls of one script are registered in the order the script made them, as long as the awaits between the script's
  call and our `execute` take the same time (`emit` of `tool_execution_start`, `tool_call` handlers). A `tool_call`
  handler of another extension that waits for I/O could reorder two calls started in the same tick of one script.
- The take-over relies on `createCodemodeExtension()` having no options in the built-in. A Pi update that changes that
  is caught by the definition test only if it changes a field the test compares (description, parameters, ...).
- After `session.reload()` the take-over runs again only when the session has bindings (`core/agent-session.js:2999`:
  `session_start` with reason `reload` is emitted only then); interactive and RPC modes always have them.

## `/reload`

`core/agent-session.js:2982-2983`: "Activate tools newly added to defaultTools. Removed ones stay active, and tools
disabled during the session stay disabled unless the setting newly adds them." Pi therefore keeps the user's choice
through a reload, and the `session_start` handlers of RQW-settings (`codemode`, `tool_search`) and RQW-tools (`grep`,
`find`) used to override it, because the event arrives with `reason: "reload"`. Both handlers now return on `reload` and
keep the behaviour for `startup`, `new`, `resume` and `fork`. The `codemode` take-over is not an active-set change and
runs on every reason: a reload builds a fresh registry with the built-in again. Tests: describe "/reload keeps the
choice of the user" in `settings.test.ts` and the `/reload` case of `test/package.test.ts` (real
`session.reload()`), and the handler tests for all five reasons in `settings.test.ts` and `tools.test.ts`.
