# RQW-tools: race analysis and barrier design

Scope: the six base tools `read`, `bash`, `edit`, `write`, `grep`, `find` as wrapped by `extensions/RQW-tools/`, under
Pi 1.3.0. Agreement: `notes/tools-requirements.md` items 5-7 ("many files per call", "everything independent in
parallel", "no race of any kind ... bash must not read files before an earlier write or edit of the same response").
All experiments are in `/tmp/rqw-races/` (scratch; not part of the package).

Sources read (paths relative to `/Users/arkadijcukavin/stock-bench/pi/node_modules/@earendil-works/`):
`pi-agent-core/dist/agent-loop.js`, `pi-agent-core/dist/agent.js`, `pi-coding-agent/dist/core/tools/{write,edit,bash,read,grep,find,file-mutation-queue,path-utils,tool-definition-wrapper}.js`,
`pi-coding-agent/dist/core/{agent-session,nested-tool-calls}.js`, `pi-coding-agent/dist/core/extensions/{runner,wrapper}.js`,
`pi-coding-agent/dist/utils/{paths,shell,child-process}.js`, `pi-coding-agent/docs/{extensions,codemode,cli}.md`;
omp-lite: `my-omp-harness/extensions/shared/locks.ts`, `extensions/tools/{write,edit}/index.ts`.
The CLI (`bin.pi = dist/bundle/cli.js`) runs a bundled copy of the agent loop; its `executeToolCallsParallel`,
`prepareToolCall` and `executePreparedToolCall` are textually the same as `pi-agent-core/dist/agent-loop.js`.

---

## 1. Execution model (established from code and probe `/tmp/rqw-races/loop.mjs`)

Per assistant message (`agent-loop.js`):

1. Mode. `executeToolCalls` (l.366) runs the batch **parallel** unless `config.toolExecution === "sequential"` or
   *any* tool of the batch has `executionMode: "sequential"` (l.368); then the whole batch is sequential.
   `Agent.toolExecution` defaults to `"parallel"` (`agent.js` l.145); the coding agent never sets it (no setting exists).
2. Preparation is strictly serial and in message order, for all calls, before any execution:
   for each call: emit `tool_execution_start` -> `prepareToolCall` (argument `prepareArguments`, schema validation,
   then `beforeToolCall`, which is where the extension `tool_call` event fires, `agent-session.js` l.327) -> next call.
   Unknown tool, invalid args, or a blocking `tool_call` handler produce an *immediate* error result; such calls never
   reach `execute`.
3. Execution start: after the loop, `Promise.all(finalizedCalls.map(entry => entry()))` (l.453). Every `entry()` runs
   synchronously up to its first `await`, and `executePreparedToolCall` calls `tool.execute(...)` synchronously
   (l.574); `wrapToolDefinition` / `wrapRegisteredTool` add only synchronous code (ctx factory). Therefore
   **the synchronous prefix of each `execute()` runs in message order, all in one tick, before any of them can finish.**
   Probe output (parallel): `execute-enter c1, c2, c4` at the same millisecond, in order; `c3` (unknown tool) skipped.
4. Concurrency: all executes of a batch run concurrently; nothing in the loop orders them. Completion order is free
   (`tool_execution_end` events in completion order: probe shows c2, c4 before c1).
5. Result order: tool-result messages are emitted and appended **in message order** after `Promise.all` (l.453-460).
6. Batch boundary: the next assistant request starts only after `Promise.all` settled, i.e. after every `execute()` of
   the batch returned or threw. Steering and follow-up messages are polled only between turns (l.85, 111, 186), so they
   never overlap tool execution. Compaction runs in `prepareNextTurn`/`prepareRequest`, also between turns.
7. Sequential mode: `execute` of call i+1 is entered only after call i fully finished (probe "sequential", "seqtool").
8. Abort: one `AbortSignal` for the whole run. If it fires during preparation, the loop `break`s (l.429/449) and later
   calls are neither prepared nor executed. If it fires before `Promise.all`, every closure returns
   `"Operation aborted"` without calling `execute` (l.435). If it fires during execution, every running `execute` sees
   `signal.aborted`; Pi still waits for all of them (probe "parallel 30": c1 returned after its full 60 ms). Stock
   `write`/`edit` check `signal.aborted` only between awaits, so an in-flight `writeFile` always completes.
   Stock `bash` kills the process group (`detached: true` on POSIX, `taskkill /F /T` on Windows) and then awaits
   `waitForChildProcess` (exit plus idle pipes).
9. Nested calls: `ctx.executeTool()` (used by `codemode`, which is off by default: `docs/cli.md` "Enable codemode") runs
   `runToolCall` with id `<parentId>/<n>`; concurrent unless sequential (`nested-tool-calls.js`). Nested calls have no
   position in the assistant message; their `execute` entry order is the script's call order.
10. Cross-actor concurrency inside one Pi process: interactive `!cmd` (user bash) runs even while the agent streams
    (`interactive-mode.js` `handleBashCommand`; `agent-session.js` `recordBashResult` defers only the transcript entry).

### Can a tool know its index among the calls of the same message?

- `execute(toolCallId, params, signal, onUpdate, ctx)`: no index, no assistant message. `ctx` is the extension context
  plus `tools` and `executeTool` (`runner.js` `createToolContext`).
- `tool_call` event: `{ toolName, toolCallId, input, parentToolCallId? }`, no index; handlers are awaited in message
  order. The core `beforeToolCall` hook does receive `assistantMessage`, but `AgentSession` owns that hook and does not
  pass the message to extensions.
- The index is still recoverable three ways: (a) **registration order at `execute()` entry** (point 3: exact message
  order in parallel mode; in sequential mode earlier calls are already finished, so order is moot); (b) order of
  `tool_call` handler invocations; (c) looking up `toolCallId` in the last assistant message of
  `ctx.sessionManager.getBranch()`.
- Use (a). (b) is unsafe: a later `tool_call` handler of another extension may block or rewrite the call after we
  registered it, leaving a phantom entry that later calls would wait on forever, or a stale path. (c) is heavier and
  adds nothing over (a). Requirement on our code: **register synchronously, before the first `await` in `execute()`.**

---

## 2. Stock behaviour measured (probe `/tmp/rqw-races/stockrace.mjs`, stock tools, stock parallel loop, macOS APFS)

| Batch in one message | Program-order result | Observed (20 runs) |
|---|---|---|
| `read b`, `write b` | read sees OLD | read saw NEW in 20/20 |
| `bash "sleep .05; echo GEN > gen.txt"`, `read gen.txt` | read sees GEN | read missed it in 20/20 |
| `write New.txt (2 MB)`, `write new.txt "B"` (file missing) | final content `B` | wrong in 20/20 |
| `write a.txt`, `bash "wc -c < a.txt"` | bash sees new file | stale: 0/20 at 4 MB, 1/20 at 8 MB, 20/20 at >=16 MB |

The last row is the reported omp-lite bug. In stock Pi it hides behind shell spawn latency for small files, but it is a
real race: any write slower than the bash start (large file, slow disk, Windows Defender scanning, network drive) loses.
Rows 1-3 are deterministic, not timing luck.

---

## 3. Race catalogue

Notation: R = read/grep/find, M = edit/write, B = bash. "Real" means reachable under the model in section 1.
Fix column refers to the design in section 5 (ordered conflict barrier, "OCB").

| # | Race | Real? | Severity | Simplest fix |
|---|---|---|---|---|
| 1 | M/M same file, same message (`write a`, `edit a`; `edit a`, `edit a`) | Real; stock `withFileMutationQueue` already orders by entry, omp-lite returned "busy" (nondeterministic failure) | High | OCB: later M waits for earlier M of same key. Keep stock queue inside as process-wide atomicity |
| 2 | Same file via other spellings: relative vs absolute, `./`, `..`, trailing separator | Real only if keys are compared raw; `path.resolve` folds all of these (probe `paths.mjs`) | High | Key = `resolveToCwd` (Pi's own) then `path.resolve` |
| 3 | Symlinked file or symlinked directory | Real for missing targets: stock queue falls back to the lexical path when `realpath` fails | Medium | Key = `realpathSync.native` of the deepest existing ancestor + remaining segments |
| 4 | Case-insensitive FS (macOS default APFS, Windows NTFS): `README.md` vs `readme.md` | Real (row 3 of section 2). `realpathSync.native` canonicalises case only for existing paths; JS `realpathSync` never does | High | Fold key on darwin and win32: `toLowerCase()`; harmless over-serialisation on case-sensitive volumes |
| 5 | Unicode NFC/NFD (macOS) | Real: NFD and NFC spellings open the same file (probe) | Low | On darwin also `normalize("NFC")` of the key |
| 6 | Windows-only spellings: `/c/x` (Git Bash), `C:/x`, drive-letter case, trailing `.`/space, 8.3 short names | `/c/x` handled by Pi `normalizePath` on win32; `path.win32.resolve` does not strip trailing dots (probe) | Low | win32: strip trailing dots/spaces per component, fold case; `realpathSync.native` expands short names for existing parents |
| 7 | Hardlinks, dangling symlink written through | Real but different keys survive normalisation | Very low | Accept, document |
| 8 | Duplicate paths inside one `write` call | Real (two items race inside the call) | Medium | Reject the whole call before writing anything when two items have the same key |
| 9 | Duplicate paths inside one multi-file `edit` call | Real | Medium | Group `edits[]` by key; one read-apply-write per file, all hunks matched against the original (Pi semantics) |
| 10 | Same file edited in two calls of one message | Real (= #1) | High | OCB order; second edit sees the first edit's result |
| 11 | R during M of the same file, same message, either order | Real (section 2 row 1); RAW and WAR both | High | OCB: R and M of overlapping keys run in message order |
| 12 | `grep`/`find` over a directory while a file under it is written | Real | Medium | OCB with ancestor overlap: root key is an ancestor of the written key |
| 13 | File vs directory clash: `write a` and `write a/b.txt` in one message | Real: which call fails (`ENOTDIR`/`EISDIR`) depends on timing | Low | OCB overlap = equal **or ancestor**, for every kind |
| 14 | B after M in the same message (the reported bug) | Real (section 2 row 4) | High | OCB: B waits for every earlier call |
| 15 | M or R after B in the same message, B writes the file (`bash gen > f`, `read f`) | Real, deterministic (section 2 row 2) | High | OCB: every later call waits for an earlier B |
| 16 | B before R where B only reads (`bash cat`, `read`) | Harmless, but unknowable: bash footprint is opaque | - | Covered by #15 at small cost |
| 17 | B after R (`read f`, `bash sed -i f`) | Real WAR: read may see post-bash content | Medium | OCB: B waits for earlier R |
| 18 | Two B in one message (`bash mkdir x`, `bash cp a x/`) | Real (stock runs them in parallel) | High when dependent | OCB: B conflicts with B (serialised in message order). See decision D1 |
| 19 | Background processes started by B (`cmd &`, `nohup`, `setsid`, Windows `start`) | Real; they escape the process group or outlive the call and write at any time later | Medium | Out of reach for any in-process barrier. Document in the bash description; not fixable without process tracking |
| 20 | Cross-message overlap | Not real: next request starts after all executes settled (point 6). Holds as long as no tool returns before its side effects settle | - | Invariant for our code: never return early; wait for in-flight fs ops and child exit |
| 21 | Partial failure mid-batch (one call fails, later dependent calls still run) | Not a race: deterministic, same as stock. Failure does not cancel siblings | Low | Keep; dependents run after the failed call settled; result says what failed |
| 22 | Partial failure inside a multi-file call | Not a race | Low | Per-file status in the result (file-level all-or-nothing; no cross-file transaction) |
| 23 | Abort while a call waits in the barrier | Would be a race if a waiter released its slot early: a later conflicting call could pass a still-running earlier one | High if done wrong | A call's "done" settles only after all its deps settled; an aborted waiter then skips its work. Proven by construction (`done = allSettled(deps).then(run)`) |
| 24 | Abort during a write (torn file) | Not real for abort: `writeFile` is not interruptible and stock checks abort only between awaits | - | Keep; multi-file write on abort stops *starting* files, awaits in-flight ones, returns per-file status (not a bare throw) |
| 25 | Crash during write (process killed, power loss) with in-place `writeFile` (`O_TRUNC` then write) | Real but tiny window (ms) | Low | See decision D2: keep in-place. Temp+rename adds Windows `EPERM`/`EBUSY`/`EACCES` on rename when AV, indexer or editor holds the target without share-delete, loses mode/ACL/hardlink, replaces symlinks, leaves temp files on crash |
| 26 | Edit read-modify-write vs external writer (IDE autosave, background process) | Real, outside Pi | Low | Out of scope (#19 class) |
| 27 | Concurrent `mkdir -p` of a shared new parent by two writes | Not real: recursive `mkdir` tolerates `EEXIST` | - | Covered by a probe |
| 28 | Steering / follow-up messages | Not real (point 6) | - | - |
| 29 | User `!cmd` while the agent runs tools | Real, user-initiated (point 10) | Low | Out of scope; optional later: route `user_bash` through the barrier as a B scope |
| 30 | Nested calls (`codemode` scripts, any `ctx.executeTool`) | Real if enabled; order = script call order | Low | Register at entry like any call. Never put an orchestrating tool into the barrier (it would wait on its own children: deadlock) |
| 31 | Calls of another extension's file tools | Not ours | - | Out of scope |
| 32 | Two Pi sessions (two processes) on one repo | Real, same class as a human editing concurrently | Medium | **Out of scope**: needs cross-process locks on every call; not in the agreement |
| 33 | Two agent sessions in one Pi process (future in-process subagents) | Possible later | Medium | Barrier state per session (factory closure). Stock `withFileMutationQueue` (module-global) still keeps same-file mutations atomic across sessions |

---

## 4. Path key (one function, synchronous, never throws)

`key(path, cwd, forRead)`:

1. `p = forRead ? resolveReadPath(path, cwd) : resolveToCwd(path, cwd)` (Pi's own resolvers, so the key names the file
   the stock tool will actually touch, including Pi's AM/PM, NFD and curly-quote fallbacks for `read`).
2. `p = path.resolve(p)` (folds `./`, `..`, duplicate and trailing separators; lexical, same as the stock tools).
3. Canonical prefix: walk up to the deepest existing ancestor, `realpathSync.native` it, append the missing segments.
   Native realpath resolves symlinks and, on macOS, returns on-disk case and NFC (probe: `readme.md` ->
   `ReadMe.md`). Cost measured: 6 us per call (8.5 us on a miss).
4. darwin: `normalize("NFC").toLowerCase()`; win32: strip trailing dots and spaces per component, `toLowerCase()`.
   Linux: unchanged.
5. Any error: return the scope "everything" (conservative, behaves like bash).

---

## 5. Barrier designs compared

| Design | Correct (no race in section 3) | Parallelism | Complexity |
|---|---|---|---|
| A. Pi sequential: `executionMode: "sequential"` on our tools | Yes | None: any batch containing one of our tools runs serially | Zero code |
| B. Stock per-file mutation queue only (Pi today) | No: #11, #12, #14, #15, #17, #18, #4 for new files | Full | Zero code |
| C. omp-lite: reject-on-busy set of in-flight paths | No: "busy" failures are timing-dependent, bash unordered, no case folding on macOS, no symlinks | Full | Small |
| D. Phase scheduler: all reads, then mutations, then bash | No: reorders against message order (#11 WAR, #15) | High | Medium |
| **E. Ordered conflict barrier (OCB)** | **Yes** | Maximal under message-order semantics: a call waits only for earlier calls it conflicts with | ~30 lines |

Recommended: **E**.

### OCB specification

- Scope of a call, computed synchronously at `execute()` entry from validated args:
  `read {path}` -> `read [key]`; `grep`/`find {path?}` -> `read [key(path ?? ".")]`;
  `write {files}` / `edit {edits[].path}` -> `mutate [keys...]` (one scope per call); `bash` -> `all`.
- Conflict: `all` conflicts with everything; `read` vs `read` never; otherwise two scopes conflict when any pair of keys
  is equal or one is an ancestor directory of the other (`y.startsWith(x + sep)`).
- Rule: a call starts after every **earlier-registered** conflicting call has settled. Nothing else waits.
- Registration happens in the synchronous prefix of `execute()`, so registration order = message order (section 1).
- Settlement: `done = Promise.allSettled(deps).then(run)`; the entry leaves the live set when `done` settles. Waiting on
  earlier entries only makes the wait graph acyclic: no deadlock in parallel mode, sequential mode, or nested calls.
- Abort: no special path. After its deps settle, `run` checks `signal.aborted` and returns "aborted" without side
  effects. Abort latency equals that of the earlier conflicting calls, which Pi waits for anyway.
- Failure: a thrown or failed call settles its `done` like a success; dependents run.
- State lives in the extension factory closure (per session), not in module scope or `globalThis`.
- Inside the call the stock tool still runs under `withFileMutationQueue` (process-wide same-file atomicity, #33).

Prototype (`/tmp/rqw-races/barrier.mjs`, 25 lines of logic):

```js
const live = new Set();
function schedule(scope, run) {           // call synchronously at execute() entry
  const deps = [];
  for (const e of live) if (conflicts(e.scope, scope)) deps.push(e.done);
  const entry = { scope, done: Promise.allSettled(deps).then(run) };
  live.add(entry);
  entry.done.then(() => live.delete(entry), () => live.delete(entry));
  return entry.done;
}
```

Model-facing rule for the descriptions (one sentence): "Calls in one response run in parallel; calls on the same file
run in response order; a `bash` call waits for all calls before it and holds all calls after it, so put reads before
`bash` and join independent long commands into one `bash` call."

### Decisions for the coordinator

- **D1. bash vs bash: serialise (recommended).** Bash footprint is opaque; dependent bash pairs in one response are
  common and stock Pi races on them. Cost: two long independent commands in one response take the sum of their times;
  the model can run them in one call with `&` and `wait`. Alternative: let consecutive bash calls run in parallel with
  each other (still barriers for everything else); this keeps #18 open.
- **D2. In-place write (recommended, stock behaviour) vs temp+rename.** In-process readers can no longer observe a
  partial file (OCB), so temp+rename only buys crash safety for a ms-long window, at the price of Windows rename
  failures (needs retry loop on `EPERM`/`EACCES`/`EBUSY`), lost file mode/ACL/hardlinks, symlink replacement and
  orphaned temp files. Revisit only if the Windows CI shows torn files.
- **D3. Multi-file edit failure policy** (not a race): per-file all-or-nothing with per-file status (recommended,
  matches omp-lite), or validate all files first and write none on any mismatch.

---

## 6. Invariants

- **I1 Order on conflict.** For calls i < j (registration order) that conflict: `start(j) >= end(i)`.
- **I2 No false waiting.** `start(j) <= max(entry(j), end(i) for conflicting i < j) + epsilon`.
- **I3 Key equivalence.** All spellings in section 4 of one file give one key; two different files give different keys
  (except case-only differences on darwin/win32 and hardlinks, by design).
- **I4 No torn reads inside Pi.** A read never returns a mix of old and new content of a file our tools mutate.
- **I5 Liveness.** Every registered call settles if its own work settles; holds in parallel mode, sequential mode,
  nested calls, abort, thrown errors.
- **I6 Abort.** A call whose deps settle after abort performs no side effect; no later conflicting call starts before
  an earlier running call settled, even if waiters in between were aborted.
- **I7 Failure isolation.** A failing call releases its dependents.
- **I8 Within-call duplicates.** `write` with duplicate keys writes nothing and errors; `edit` groups by key and writes
  each file once.
- **I9 Result order and batch boundary** (Pi guarantees, re-verified): results in message order; no call of message
  N+1 starts before every call of message N returned.
- **I10 Registration order.** Through a real `AgentSession` with the extension loaded, registration order equals
  message order.

---

## 7. Test plan (synthetic, no model; `node --test` under `extensions/RQW-tools/test/`)

Layer 1, barrier unit tests (fake ops = timers):
- T1 (I1/I2) table of fixed batches with expected start relations: `[M a, R a]`, `[R a, M a]`, `[M a, M b]` (parallel),
  `[R a, R a]` (parallel), `[M a, B]`, `[B, R x]`, `[B, B]`, `[R dir, M dir/f]`, `[M a, M a/b]`, `[M a, B, R b]` (R b
  waits for B, B waits for M a). Gate-driven eligibility checks cover each fixed batch and reuse after settled calls;
  real-timer batches assert ordering, not elapsed slack.
- T2 randomized interleavings (I1, I2, I5, I6, I7): seeded LCG; per round 2-10 ops, kinds read/read/mutate/mutate/
  bash/tree-read, keys from a pool with ancestors, multi-key mutates, random durations 0-15 ms, 10% throws, 20% rounds
  with abort at a random time, 15% rounds driven sequentially; 5 s deadlock guard per round; check I1 for every
  conflicting pair. Elapsed I2 slack is diagnostic only: host pauses are not barrier dependencies. For each generated
  batch, an additional gate-driven run checks the exact eligible set after promise reactions drain, then completes
  the latest eligible call first while unrelated calls remain held. Seeded throws also reject gates; settled calls
  release successors whether fulfilled or rejected. This detects both missing and unnecessary waits
  without an elapsed-time threshold. The decision and rationale live in [DECISIONS.md, Tools](../DECISIONS.md#tools).
- T3 mutation check of the checker: disabling dependency collection must produce ordering violations. T2's eligibility
  oracle is also checked against both ignored dependencies and forced serialization of independent calls.
- T4 nested calls: an orchestrator outside the barrier calls our tools via `Promise.all` and sequential `await`s;
  completes within the guard, checks ordering, and reports elapsed slack only as a diagnostic.

Layer 2, key function (I3), real filesystem in a temp dir, run on macOS, Linux and Windows CI:
- relative/absolute/`./`/`../`/trailing separator; symlinked file; symlinked directory with a missing file below;
  case variants of existing and missing files; NFC vs NFD (darwin); `C:/x`, `/c/x`, `c:\X`, trailing dot, 8.3 short
  name of an existing parent (win32); `realpath` error path returns "everything".

Layer 3, integration through the real Pi pipeline: `createAgentSession` with the extension in `extensionFactories` and
the `faux` provider (`pi-ai/dist/providers/faux.js`, `fauxToolCall`) scripting one assistant message per scenario,
temp repo as cwd, each scenario repeated 50 times:
- S1 the reported bug: `[write a (32 MB), bash "wc -c < a"]` -> bash sees the new size every time (stock: 20/20 stale).
- S2 `[bash "sleep 0.05; echo GEN > g", read g]` -> GEN every time.
- S3 `[read f, write f]` -> read returns OLD every time; `[write f, read f]` -> NEW.
- S4 `[edit f hunk1, edit F hunk2]` (case variant on darwin/win32) -> both hunks applied.
- S5 `[write New.txt, write new.txt]` on a missing file -> final content from the second call.
- S6 `[write d/x, grep pattern d, find "*.x" d]` -> grep and find see the new file.
- S7 `[bash "sleep 1", bash "sleep 1"]` -> wall >= 2 s (D1); `[read a] x 20` and `[write a..t]` -> wall close to one
  op (no false waiting); `[bash "sleep 1", read x]` vs `[read x, bash "sleep 1"]` -> read latency ~1 s vs ~0.
- S8 one extra tool with `executionMode: "sequential"` in the batch -> same results, no hang (sequential mode).
- S9 abort 20 ms into `[bash "sleep 1", write a, write b]` -> neither file written; tool results present; next prompt works.
- S10 `[edit a (bad hunk), bash "cat a"]` -> bash runs, sees unchanged a.
- S11 `write` with duplicate keys (`a`, `./A`) -> error, nothing written; `edit` with two entries for one file ->
  single write with both hunks.
- S12 registration order (I10): instrument entry order for a 10-call batch; equals message order.
- S13 two writes into a new shared parent directory -> both succeed.
- S14 timing evidence for the report: makespan of a mixed 12-call batch vs Pi sequential vs stock parallel.

Layer 4, platforms: GitHub Actions matrix `macos-latest`, `ubuntu-latest`, `windows-latest` (PowerShell shell and Git
Bash shell for `bash`) runs layers 1-3. Windows adds: S1 with Defender active (default runner), and a probe that holds
a file open with `FileShare.ReadWrite` (no delete) while `write` overwrites it (documents D2: in-place succeeds,
rename would fail).

---

## 8. Out of scope and residual risk

- Two Pi processes on one repo, IDE or human edits, background processes started by `bash` (#19, #26, #32): no
  in-process barrier can order them. State it in the `bash` description ("background processes are not tracked").
- Hardlinks and writes through dangling symlinks (#7): different keys; accepted.
- `codemode` ordering relative to its sibling top-level calls: the orchestrator is not in the barrier by design (#30).
- Tool calls of other extensions that mutate files.
