# RQW-codex

Independent ChatGPT-subscription overlay of Pi 1.4.0's `openai-codex` / `openai-codex-responses`, targeting Codex CLI stable **0.163.0**, upstream **83086188ae0614bd882818ff1aa23f3194962012**. Not Pi's separate `openai` provider, an API-key transport, a Pi patch/fork or the entire Codex harness.

## Use and credentials

Keep an existing valid `openai-codex` OAuth credential in place. New `/login openai-codex` starts device code directly: open the displayed URL and approve the displayed code. No browser-login selector, callback listener, pasted authorization-code alternative or silent fallback. Failed/canceled login does not replace the existing grant. No automatic import from `openai`, another adapter's slot, `~/.codex`, keychain or browser cookies. Token rotation remains in Pi's credential-store transaction; diagnostics never include bearer/refresh tokens or upstream auth bodies.

Run only one Codex adapter. Preserve credentials when disabling an old adapter. Disable RQW-codex independently with the package filter `-extensions/RQW-codex/index.ts` (see [INSTALL](../../INSTALL.md#switch-one-extension-off)); reload/restart. It does not own provider visibility or depend on [RQW-providers](../RQW-providers/README.md). RQW-providers is extension 14; RQW-codex follows it as extension 15 in `pi.extensions`.

## Protocol contract

- Own native request/metadata codec, WS-first/SSE, socket-local continuation and raw completed-item history. Application-level identity is `codex_cli_rs` 0.163.0 with actual host/terminal and sanitized truthful git/workspace facts, not imported Codex installation identity.
- Native `generate:false` startup/prepared-idle prewarm, no periodic replay or synthetic assistant answer; RQW-settings' generic warmer remains off.
- Native retry/error distinctions and cancel controls; connection-failed sampling retries without a count limit with 5–60 s backoff until canceled. After a successful WebSocket upgrade, send/read transport errors and premature closes use the finite stream budget: five retries, then sticky SSE fallback. Subscription exhaustion/policy/auth failure is not an infinite network retry. Own Codex failures do not get Pi's overlapping retry budget, including stock summary calls. During compaction a session-local stream-result boundary rejects only marked Codex failures before Pi's separate summary retry helper; other providers and unmarked errors retain Pi retries.
- Stable effort override is **off**; capability-gated `configuration_update` is only for an explicitly enabled feature profile. Preserve actual RQW prompt/tools and requested effort, exact raw encrypted items, argument strings and phases.
- No `/models` requests. The offline 0.163.0 snapshot covers only our listed GPT models; unknown capabilities fail clearly. Pi/RQW catalog, model picker and context limits stay authoritative. Upgrades are manual reviewed protocol migrations, never startup downloads.
- RQW-settings alone owns `/fast-gpt`, default off; priority is taken from the final payload hook. Children keep their inherited/overridden Fast state, actual lineage and independent sockets/turn state while sharing root cache affinity.

### Automatic idle prewarm

RQW-codex itself observes the public session lifecycle. After a run really settles, or manual compaction finishes, one deferred check attempts native history prewarm only while the owned Codex session is idle. An already prepared healthy connection sends nothing. Duplicate completion signals are coalesced; there is no idle polling, periodic cache keepalive, synthetic assistant turn or user command. Aborted runs do not schedule it; a new busy operation or disposal cancels pending automatic work, and disposal removes the listener and deferred check.

The host channel `rqw-codex:prewarm-with-history` remains optional, not the package producer: a host may emit an object `{ threadId? }` to target an owned root or child. `accepted: true` means recognized, not necessarily sent. Busy/prepared sessions skip sending; unknown or foreign threads do not acquire credentials or start a transport.

Startup, including cold resume, stays cold: base prompt/tools and no history. Automatic and explicit history prewarm use the current effective full or compacted history, including Pi 1.4.0 pending system-section updates in their next-run position and the current visible tool catalog rather than obsolete replayed declarations. Prewarm and compaction respect codemode-only hidden declarations without disabling the executable tools behind codemode. An explicitly marked forced child prompt is projected as the caller actually forces it; soft reviewer prompts retain their SDK sections. These request-time projections do not rewrite the Pi transcript. RQW-prompt and RQW-tools contribute their own policies to the optional pure projection; no normal turn hook is synthetically invoked. The package-level carrier is `test/codex-prompt-tools.test.ts`. The first normal request joins pending setup within the remaining native budget. Prepared-response continuation is used only while the actual post-hook prefix still matches; later prompt/tool-loadout changes require a full request instead.

### Optional one-shot context fork

`rqw:context-fork:v1` accepts `{ sessionId, model, context, reasoning?, signal, offer }` on `pi.events`. The matching owner synchronously calls `offer(infer)` with a one-shot `() => Promise<AssistantMessage>`, or leaves an unsupported request unanswered. Capture sends nothing. The supplied normalized context must extend the last prepared request context with a completed-turn suffix and a final user report instruction. A textual observation of still-pending tool calls is also valid; unmatched native calls are refused, never supplied with invented results.

The fork clones the actual post-hook native input, prefix IDs, ordered tool schemas, reasoning baseline and root `prompt_cache_key` immediately. Inference uses its own transport, socket, in-memory ledger and fresh metadata, without the source socket's `previous_response_id`, sticky state or continuation. It invokes no session callbacks or tool executor and writes no session history. Hosted tool declarations are unsupported. A source turn can continue while the captured fork runs; lifecycle invalidation and stale-report rejection belong to the consumer. Aborting or finishing the fork closes only its own transport on every exit. There is no stream retry loop or added HTTP retry budget; existing bounded authorization recovery and upgrade fallback remain. Missing prepared state produces no request. Cache affinity and unchanged native prefix do not guarantee a server cache hit or free input.

## Compaction and portability

Codex sessions use **stock Pi compaction**: Pi runs its own compaction with its own summary generator and writes a normal Pi `compaction` entry, with Pi's own threshold, animation, chat summary and standard error messages. The public `session_before_compact` event only prepares the auxiliary transport and provider payload callbacks (it never returns a result or `cancel: true`), and the public `session_compact` event resets history and transport state. The summary request is a normal Codex request through this transport, routed per request because Pi gives each summary call a fresh routing session id. There is no native `compaction_trigger`, no opaque compaction item or checkpoint entry and no replacement of `AgentSession` compaction methods, because Pi 1.4.0 has no public native compaction hook. Decision and reason: [D-CODEX-SIMPLE-COMPACTION](../../DECISIONS.md#codex-subscription-transport). Native V2 compaction parity with Codex CLI is an accepted exception; native V2 request code that may remain in this folder is non-running source, not active behavior.

**RQW-context still owns the trigger**, W = min(contextWindow, 500000), R = round(W/10), threshold W−R, with the existing explicit-reserve precedence. After a compaction every original entry stays in the session file, but the active context is Pi's summary plus the kept tail, also with RQW-codex disabled or for another provider. The full original history is not replayed to other models.

**Not fully public.** Pi's compaction methods stay untouched; retry ownership uses a temporary wrapper of the public agent stream callback. Other parts of this extension (session lifecycle, auth layers, prompt projection) still use private Pi internals. Migrating them where possible is the backlog task [CODEX-PUBLIC-INTERNALS](../../BACKLOG.md#codex-public-internals).

## Independence and verification

No imports outside this extension folder; optional event-bus session policies bind RQW-agent/RQW-review children without an import dependency. Missing adapter means stock child behavior. Disable/reload/dispose must not unregister another owner's live provider or leak a child's continuation into its parent. Reviewer safety policy and wall cap remain theirs.

Source assertions and the pinned model snapshot: `test/extensions/RQW-codex/fixtures/`. Compatibility spikes cover stock library/bundle seams, while fake-server tests cover owned mechanics. `.github/workflows/codex-oracle.yml` executes pinned upstream fake-server scenarios and saves captures/logs in CI. Source-derived fixtures are not runtime captures; reconstructed WS JSON is not raw WS control-frame evidence. Full suites, Rust fixture generation and macOS/Windows/Bun checks run in CI, not on the owner's laptop.

The oracle's optional `--work <dir>` selects a parent directory inside OS temp, outside the source and protected checkouts. Every run creates a fresh `rqw-codex-oracle-*` child for its source copy and removes only that child on normal cleanup. The parent and its existing contents stay untouched. `--keep-work` retains the harness child instead.

On macOS the oracle applies one SHA-guarded socket-lifecycle cleanup only to its temporary upstream retry fixture and records it in `run.json` as `adaptedFixtures`. Native assertions, timeouts and `listen(128)` stay unchanged; original sources and runtime transport are untouched. The cause and coordinator technical decision are in [macOS oracle fixture](../../DECISIONS.md#macos-oracle-fixture). Diagnostic runs are not full oracle acceptance.

### Deterministic native differential

`test/extensions/RQW-codex/fixtures/native-differential.json` pins captures from [normal oracle run 39956439677](https://github.com/ARQAWA/my-pi/actions/runs/39956439677), my-pi head `fe3e9ec554070811a76eb5403934b753825e67df`: 10 cases, transport 4, retry 3 and compaction 3. `scripts/pin-native-differential.mjs` records capture/source hashes, captured SSE scripts and source-cited non-SSE stimuli. `test/extensions/RQW-codex/native-differential.test.ts` replays them through the real extension in a Pi `AgentSession`, with fake credentials and injected fetch/connect/sleep seams. The shared `test/extensions/RQW-codex/native-differential.mjs` projection compares ordered transport/endpoint, turn-state replay, request kind, compaction phase, turn grouping, retry-body identity and conversation items; selected cases also check content encoding. The fixture, pin script and oracle workflow are unchanged and the oracle still runs the full native reference. The adapter test replays the 7 transport and retry cases only; the three compaction cases stay pinned as provenance of the native mechanism, which the adapter no longer runs. Stock compaction is covered by `test/extensions/RQW-codex/standard-compaction.test.ts` and `test/extensions/RQW-codex/stock-compaction-history.test.ts`.

The normal oracle workflow regenerates this projection from fresh captures and uses `--check` to reject fixture/source drift, including all stable replay configuration fields. Baseline capture hashes identify provenance, not byte equality across runs. Source-backed `Retry-After` sleeps are compared with a deterministic clock, without real waiting; explicit fallback cases check upgrade order/count. Actual WebSocket frame replay remains uncovered: upgrades are simulated and these requests use the HTTP/SSE path. The pinned native run does not itself prove that the new differential checks passed CI. See [Native differential checks](../../DECISIONS.md#native-differential-checks) for the coordinator technical decision.

See the canonical [decision and exception ledger](../../DECISIONS.md#codex-subscription-transport) for all accepted deviations. No deterministic test establishes live subscription acceptance, equal answers, cache retention, subscription billing or free prewarm. Raw TLS/packet equivalence and optional managed/enterprise/Guardian/memory harness profiles are not claimed.

<!-- repo-index:start -->
## File map

Generated by `node scripts/repo-index.mjs --write` from the repository root.

| File | Responsibility |
| --- | --- |
| [`LICENSE-CODEX`](LICENSE-CODEX) | Third-party licence text |
| [`LICENSE-PI`](LICENSE-PI) | Third-party licence text |
| [`README.md`](README.md) | Hand-written contract and generated file map |
| [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md) | Third-party attribution and provenance |
| [`auth-boundary.ts`](auth-boundary.ts) | Authentication request boundary |
| [`auth-runtime.ts`](auth-runtime.ts) | Authentication runtime integration |
| [`auth.ts`](auth.ts) | Subscription credentials and OAuth recovery |
| [`compaction-wire.ts`](compaction-wire.ts) | Compaction wire request conversion |
| [`compaction.ts`](compaction.ts) | Compaction protocol handling |
| [`compression.ts`](compression.ts) | Request body compression |
| [`context-fork.ts`](context-fork.ts) | context fork module or resource |
| [`continuation.ts`](continuation.ts) | Response continuation state |
| [`cookies.ts`](cookies.ts) | Transport cookie handling |
| [`display.d.ts`](display.d.ts) | Display metadata bridge and declarations |
| [`display.mjs`](display.mjs) | Display metadata bridge and declarations |
| [`errors.ts`](errors.ts) | Transport error conversion |
| [`headers.ts`](headers.ts) | Subscription request headers |
| [`history.ts`](history.ts) | Conversation history conversion |
| [`index.ts`](index.ts) | Pi extension entrypoint: Codex subscription authentication and protocol overlay |
| [`lifecycle.ts`](lifecycle.ts) | Installation and teardown lifecycle |
| [`metadata.ts`](metadata.ts) | Request metadata |
| [`portable-history.ts`](portable-history.ts) | Portable conversation history representation |
| [`profile.ts`](profile.ts) | Pinned native protocol profile |
| [`registration.ts`](registration.ts) | Provider registration overlay |
| [`retry.ts`](retry.ts) | Transport retry classification and waiting |
| [`scripts/capture-oracle.mjs`](scripts/capture-oracle.mjs) | Capture native Codex protocol evidence |
| [`scripts/check-oracle.mjs`](scripts/check-oracle.mjs) | Compare protocol evidence |
| [`scripts/oracle-diagnostic.mjs`](scripts/oracle-diagnostic.mjs) | Diagnose native protocol evidence |
| [`scripts/pin-native-differential.mjs`](scripts/pin-native-differential.mjs) | Pinned native protocol comparison |
| [`session-compaction.ts`](session-compaction.ts) | Stock session compaction integration |
| [`session-history.ts`](session-history.ts) | Session history integration |
| [`session-metadata.ts`](session-metadata.ts) | Session request metadata |
| [`session-prefix.ts`](session-prefix.ts) | Session startup prefix |
| [`session.ts`](session.ts) | Session transport lifecycle |
| [`sse.ts`](sse.ts) | Server-sent event parsing |
| [`streaming.ts`](streaming.ts) | Streaming response conversion |
| [`tool-sampling.ts`](tool-sampling.ts) | Tool sampling request settings |
| [`transport.ts`](transport.ts) | Subscription request transport |
| [`web-THIRD-PARTY-NOTICES.md`](web-THIRD-PARTY-NOTICES.md) | Third-party attribution and provenance |
| [`web-alpha.ts`](web-alpha.ts) | Native web protocol definitions |
| [`web-commands.ts`](web-commands.ts) | Web command conversion |
| [`web-engine.ts`](web-engine.ts) | Native web request execution |
| [`web-native-tools.json`](web-native-tools.json) | Native web tool schemas |
| [`web-types.ts`](web-types.ts) | Web protocol types |
| [`websocket.ts`](websocket.ts) | WebSocket connection and response transport |
| [`wire.ts`](wire.ts) | Provider request and response conversion |

Tests: [`test/extensions/RQW-codex/`](../../test/extensions/RQW-codex/).
<!-- repo-index:end -->
