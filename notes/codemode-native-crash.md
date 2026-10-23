# Native codemode crash on macOS Node 24

## Finding and confidence

The captured failure is a native Node/V8 crash in the main thread while garbage collection scans an INTERNAL
stack frame entered through `Builtins_BaselineOutOfLinePrologue`. It is not a JavaScript assertion, a demonstrated
QuickJS exception, or an observed `Worker.terminate()` failure. The closest known defect is Node
[#62393](https://github.com/nodejs/node/issues/62393): a baseline-prologue register incorrectly treated as a tagged
GC root. The accepted [Node fix](https://github.com/nodejs/node/commit/fb0d0ca28993802d67360edc84d467fe3ccdc20b)
is included in Node 24.22.0, but not the crashed 24.21.0.

This is a strong source-and-stack match, not a proven attribution of this particular crash. There is no core dump
showing the bad stack slot, and a clean finite stress sample cannot establish that the incident is fixed. A
[same-signature report on Node 26.7.0](https://github.com/nodejs/node/issues/62393#issuecomment-5352288299)
also prevents treating the top frame alone as a unique diagnosis. No application runtime change or Pi patch is
justified by the current evidence.

## Captured evidence

The primary run is [39974096207](https://github.com/ARQAWA/my-pi/actions/runs/39974096207), head
`61355cb84220930e79757b8ce99afadefb6115e7`, branch `rqw-codex`, job
[`test (macos-latest, node 24)`](https://github.com/ARQAWA/my-pi/actions/runs/39974096207/job/120484085793).
Its artifact is `test-evidence-macos-latest-node24-attempt1`.

- `npm-test-path-with-spaces.tap:17956-17966`: the child running
  `extensions/RQW-tools/test/codemode.test.ts` has `exitCode: null`, `signal: SIGSEGV`, `ERR_TEST_FAILURE`.
- `node-2026-10-23-150758.ips`: `EXC_BAD_ACCESS`, `KERN_INVALID_ADDRESS at 0x6`, `faultingThread: 0`,
  `MainThread`, capture time `2026-10-23 15:07:49.1363 +0000`.
- The job log identifies Node `v24.21.0`, arm64, runner image `macos-26-arm64`, image version
  `20261013.0424.1`. The report identifies macOS `26.6.2`, build `25G83`. The `.ips` alone has no Node
  release version; that value comes from the job log.
- The first 12 MB write/read case completed its ten iterations. The process died before the following 12 MB
  write/bash case completed. Neither the exact iteration nor the JavaScript statement is recoverable from this
  report.

The relevant faulting chain is:

```text
ClearStaleLeftTrimmedPointerVisitor::VisitRootPointers
InternalFrame::Iterate
Isolate::Iterate
Heap::IterateRoots
MarkCompactCollector::MarkRoots / MarkLiveObjects / CollectGarbage
Heap::MarkCompact / PerformGarbageCollection / CollectGarbage
StackGuard::HandleInterrupts
Runtime_StackGuardWithGap
Builtins_CEntry_Return1_ArgvOnStack_NoBuiltinExit
Builtins_BaselineOutOfLinePrologue
...
Builtins_ArrayMap
Builtins_PromiseFulfillReactionJob
...
node::worker::MessagePort::OnMessage
```

All captured threads were inspected. The sole named `WorkerThread` is polling `uv_run`; V8 background workers
are waiting on their queues. Thread 7 has no frames. No captured call stack contains QuickJS, wasm execution,
wasm code freeing, `terminate`, or worker isolate teardown. `MessagePort::OnMessage` identifies the message
callback context, not the origin of the invalid root. `Builtins_ArrayMap` does not identify a source-level `.map()`.
This is not evidence of an operating-system out-of-memory kill.

Downloaded originals are retained in `/tmp/codemode-segv-original-evidence/`; the original job log is
`/tmp/codemode-segv-original-job.log`; decoded frames are `/tmp/codemode-segv-crash-decoded.txt`.

## RQW-codex isolation

`extensions/RQW-tools/test/codemode.test.ts` creates fresh temporary `cwd` and `agentDir` directories. Its
`DefaultResourceLoader.additionalExtensionPaths` defaults to the exact file `extensions/RQW-tools/index.ts`,
not this package's root. Its inline factories are `createCodemodeExtension()` and `createToolSearchExtension()`.
The only alternate file is its own `test/fixtures/probe.ts`. There is no import or configured load of `RQW-codex`.
The faux provider and temporary auth/settings paths prevent selection of the Codex transport.

A read-only reproduction of those loader options on the actual `rqw-codex` worktree at `61355cb` returned exactly
these extension paths and no errors:

```text
extensions/RQW-tools/index.ts
builtin:codemode
builtin:tool-search
```

The probe also returned the same set on the investigation branch. Script and output:
`/tmp/codemode-segv-isolation-probe.mjs`, `/tmp/codemode-segv-isolation-probe.log`; local Node `v26.7.0`.
This is a loader isolation check, not a native-crash reproduction on Node 24.

The first unexplained death, [39948373095](https://github.com/ARQAWA/my-pi/actions/runs/39948373095), ran
`bg-test-flake` at `ad027fe446ccf387f3170d7a0cbfe072e5a26432`, whose manifest has no `RQW-codex`.
There was no crash report then, so its native signature cannot be equated with the new one. The codemode test
and `codemode.ts` are unchanged between that commit and this investigation's base.

Do not conclude that the entire `rqw-codex` branch is physically incapable of affecting timing. Its
`RQW-tools/index.ts` diff factors identical prompt-section logic into `applyToolSections` and subscribes to
`rqw-prompt:startup-projection`; the latter has no emitter in the isolated test. Its lockfile moves the unchanged
`openai@7.19.0` under `pi-ai` and promotes the unchanged `ws@8.22.0`. Other test files run in separate child
processes, but can change host CPU and memory pressure. These are possible workload differences, not evidence
that the Codex extension ran or caused the crash.

## Worker lifecycle and the 12 MB cases

Installed dependencies are `@earendil-works/pi-codemode@1.4.0` and `quickjs-wasi@3.6.2`.
The installed `pi-codemode/dist/runtime/host.js` creates one `Worker` per script, gives it a compiled wasm module
and interrupt `SharedArrayBuffer`, and implements shutdown by setting the interrupt flag, requesting
`void worker.terminate().catch(...)`, then calling `worker.unref()`. This is intentional upstream behavior for
Bun's non-interruptible built-ins. `CodemodeSandboxBase.close()` requests shutdown, not confirmed worker exit.

The public sandbox option `onWorkerStarted(exited)` exposes an actual exit promise. A tiny package-only local
probe observed `execute-resolved`, then `close-resolved`, then `worker-exit`:
`/tmp/codemode-segv-worker-lifecycle.mjs`, `/tmp/codemode-segv-worker-lifecycle.log`, Node `v26.7.0`.
The probe holds a bounded referenced timer while awaiting exit because upstream unrefs the worker. This confirms
the documented lifecycle, not a termination defect or the incident's cause.

Pi's `dist/extensions/codemode/execute.js` already reserves workers until their actual `exit` with
`acquireWorker`, `releaseCodemodeWorker`, and `activeCodemodeWorkers`. `PI_CODEMODE_MAX_WORKERS` defaults to
`2`. It also sets `CODEMODE_MEMORY_LIMIT_BYTES = 256 * 1024 * 1024`. `createCodemodeExtension()` exposes
`mode`, `inlineBudget`, and `models`, but no worker handle or `onWorkerStarted` option. Our
`extensions/RQW-tools/codemode.ts` wraps the tool definition and cannot safely await a private worker's exit.
Replacing the built-in sandbox, monkey-patching Worker, or inserting sleeps would not be a demonstrated fix.

Each large test builds `"NEW-C\n".repeat(2000000)` or `"NEW-D\n".repeat(2000000)` in QuickJS, producing
12,000,000 ASCII bytes, and sends write/read or write/bash through `Promise.all`, ten times. The read checks
near line 1,999,990; bash checks the exact byte count. Serialization, host strings, line arrays, and session
records also allocate outside the guest's 256 MiB limit. The file size therefore is not the total process heap
usage. Large allocation churn can trigger GC, but size alone does not explain an invalid native root. Payloads,
iterations, assertions, and watchdog remain unchanged.

## Upstream comparisons

The closest fix is V8
[`0b94a9fd23ba`](https://github.com/v8/v8/commit/0b94a9fd23ba5f59b3f675fb04d60a9b0102e27d),
backported as Node
[`fb0d0ca289`](https://github.com/nodejs/node/commit/fb0d0ca28993802d67360edc84d467fe3ccdc20b).
The backport explains that Node 24 enables leaptiering without the V8 sandbox, yet the baseline prologue saves
`kJavaScriptCallDispatchHandleRegister`, `x4` on arm64, as a tagged INTERNAL-frame slot when the calling convention
does not carry that register. GC can dereference the unrelated value through the exact visitor in our stack.
The fix changes `V8_ENABLE_LEAPTIERING_BOOL` to `V8_JS_LINKAGE_INCLUDES_DISPATCH_HANDLE_BOOL` and adds
`AssertSmi`. Compare the immutable
[24.21.0 source](https://github.com/nodejs/node/blob/v24.21.0/deps/v8/src/builtins/arm64/builtins-arm64.cc#L1294-L1304)
and [24.22.0 source](https://github.com/nodejs/node/blob/v24.22.0/deps/v8/src/builtins/arm64/builtins-arm64.cc#L1294-L1305).
The [24.22.0 release](https://github.com/nodejs/node/pull/66667) includes the backport.

The distinct [Node wasm lifetime issue #66366](https://github.com/nodejs/node/issues/66366) concerns shared wasm
code and wrapper lifetime during teardown, with `NativeModule::FreeCode`, `WasmCodeRefScope`, or allocation-table
checks. Its [backport #66376](https://github.com/nodejs/node/pull/66376) was still open at investigation time.
None of those distinguishing frames occurs here. It is not evidence that awaiting termination would repair this
GC-root failure.

`quickjs-wasi@3.6.2` separately has a
[settled-promise payload retention defect](https://github.com/vercel-labs/quickjs-wasi/issues/55),
[fixed in 3.6.3](https://github.com/vercel-labs/quickjs-wasi/commit/2d87476e631bb37f78e1c852eb9dc1bcb2e2ca70).
It could increase guest allocations, but is not linked to this invalid main-isolate root. The older
[memory-limit accounting defect](https://github.com/vercel-labs/quickjs-wasi/issues/30) was fixed in 3.3.1 and is
already absent from the installed version. Reports against `quickjs-emscripten` concern a different wrapper.

Detailed primary-source research and saved responses are indexed in
`/tmp/codemode-segv-upstream-research.txt`.

## Controlled samples

The unchanged codemode test source was repeated on macOS arm64 with pattern `12 MB`:

| Configuration | Failed / runs | Evidence |
| --- | --- | --- |
| Node 22.19.0, default compiler | 0 / 40 | [39979196156](https://github.com/ARQAWA/my-pi/actions/runs/39979196156) |
| Node 24.21.0, default compiler | 0 / 40 | [39979196156](https://github.com/ARQAWA/my-pi/actions/runs/39979196156) |
| Node 24.22.0, default compiler | 0 / 40 | [39979907143](https://github.com/ARQAWA/my-pi/actions/runs/39979907143) |
| Node 24.21.0, direct `--no-sparkplug` | 0 / 40 | [39979911437](https://github.com/ARQAWA/my-pi/actions/runs/39979911437) |

These exact runtime versions are confirmed in the jobs' Facts logs, not inferred from floating setup-node inputs.
The summaries are retained under `/tmp/codemode-segv-run-<run-id>/`; logs are
`/tmp/codemode-segv-job-<run-id>.log`. The downloaded stress artifacts contain no `.ips` or nonzero run exit.
All samples were clean, including the affected baseline, so this is not a red-before/green-after experiment and
does not demonstrate Sparkplug suppression or repair of this incident. An additional queued 60-run baseline
[39978860137](https://github.com/ARQAWA/my-pi/actions/runs/39978860137) was cancelled before any iteration to
avoid duplicating the explicit-version comparison; it is not counted as passed or used to estimate a rate.

## CI policy

Keep native deaths red. Do not add retries, `continue-on-error`, a test skip, a smaller payload, a longer watchdog,
or a blanket exception for Node 24. A later green run does not erase a captured failure. Keep the TAP and `.ips`
artifacts and distinguish an assertion failure from a native signal.

Use separate `.github/workflows/codemode-stress.yml` dispatches with exact `node` values `22.19.0`, `24.21.0`,
and `24.22.0`; `name_pattern=12 MB` selects the existing large cases and `runs` sets the sample size.
`no_sparkplug` adds a direct Node `--no-sparkplug` argument only for diagnosis. That flag is not accepted in
`NODE_OPTIONS`. The existing `test` and `os` inputs still support other files and Windows. Use the explicit
`name_pattern=.` for whole-file probes: an empty value supplied by dispatch was observed as the default `12 MB`
in the [Windows smoke log](https://github.com/ARQAWA/my-pi/actions/runs/39983759617), so a blank request alone is
not evidence of whole-file execution. Verify the effective `PATTERN` in the job log. The shell's empty-pattern
branch is preserved, but that smoke did not exercise it. Every nonzero run remains a failure; the summary
identifies the runtime, and erroneous TAP output and macOS crash reports are retained. These settings do not
alter the normal `tests.yml` gate.

The owner accepted the normal gate's Node 24 floor. `.github/workflows/tests.yml` keeps matrix labels `22.19.0`
and `24`, but passes `>=24.22.0 <25` to `actions/setup-node@v4` for the `24` jobs. The labels remain stable for
artifact names and the QA canary selector; Node 22.19.0, Windows coverage, evidence collection and failure
handling are unchanged. The range excludes a cached 24.21.0 even when `check-latest` is false. Verify the resolved
Node version in each job's setup-node and Facts logs, not from its `node 24` label. This applies a known upstream
fix in CI; the exact incident remains unproven, and a green run is not a red-before/green-after demonstration.

## Upstream issue draft

Suggested destination: a comment on [nodejs/node#62393](https://github.com/nodejs/node/issues/62393), not a
separate assertion that QuickJS or `Worker.terminate()` is defective. Nothing has been posted upstream.

> Additional macOS arm64 occurrence on Node 24.21.0, with artifacts from a public GitHub Actions run.
>
> Environment: macOS 26.6.2 build 25G83, GitHub image macos-26-arm64 20261013.0424.1, official setup-node
> Node 24.21.0. Workload uses node:test, Pi 1.4.0, pi-codemode 1.4.0, quickjs-wasi 3.6.2. Each script runs in a
> Worker and a fresh QuickJS wasm VM. Two ordering tests pass 12 MB strings through the tool bridge, ten times
> each. The host terminates the worker asynchronously after script completion.
>
> Run: https://github.com/ARQAWA/my-pi/actions/runs/39974096207, head 61355cb84220930e79757b8ce99afadefb6115e7,
> job 120484085793, artifact test-evidence-macos-latest-node24-attempt1. TAP reports child SIGSEGV, not a
> JavaScript assertion. The attached node-2026-10-23-150758.ips has EXC_BAD_ACCESS at 0x6, MainThread.
>
> The chain is ClearStaleLeftTrimmedPointerVisitor -> InternalFrame::Iterate -> root scanning / MarkCompact ->
> StackGuard -> Runtime_StackGuardWithGap -> BaselineOutOfLinePrologue. Later frames include ArrayMap,
> PromiseFulfillReactionJob, and MessagePort::OnMessage. No captured stack contains wasm execution/freeing or
> worker termination. The first 12 MB write/read case completed before the file died during the following case.
>
> The signature and affected version match the baseline INTERNAL-root explanation in fb0d0ca289. We cannot
> prove the invalid slot's origin from an .ips report alone. Isolated 12 MB samples were 0/40 failures on each of
> Node 22.19.0, 24.21.0, 24.22.0, and 24.21.0 with direct --no-sparkplug. See runs 39979196156, 39979907143,
> and 39979911437 in the same public repository. The affected baseline also passed, so these comparisons do not
> demonstrate a fix. Pi and V8 were not patched. Please advise whether this is sufficient to associate this
> instance with #62393 and what additional diagnostic capture would discriminate another same-signature cause.
>
> Reproduction commands: checkout the referenced public commit, run npm ci, then run
> `node --test --test-name-pattern="12 MB" extensions/RQW-tools/test/codemode.test.ts` on macOS arm64. This is
> intermittent and the isolated command is a workload candidate, not a guaranteed minimal reproducer. The actual
> failing invocation was npm test in a path containing spaces and Cyrillic, with the full suite's normal concurrency.
> Successful isolated stress samples do not establish absence of the bug.
