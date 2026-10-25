# RQW-anthropic

Subscription transport for stock Pi 1.4.0. `/login anthropic` still uses Pi's browser or copy-code login.
The builtin model catalog and Pi's message/tool parser stay intact. Plain API-key requests pass through unchanged,
including native custom SDK clients. OAuth requests ignore `options.client` and use Pi's OAuth builder with the
protected subscription fetch, so a custom client's origin or fetch cannot bypass signing, origin checks or recovery.
This extension is the Anthropic transport only. Hiding the other providers (only `anthropic` and `openai-codex`
stay visible) is the separate [RQW-providers](../RQW-providers/README.md); each works with the other switched off.

## Before enabling

Follow the [installation prompt](../../INSTALL.md): it replaces the known old adapter with official
`pi remove git:github.com/edxeth/pi-claude-auth` in its installed scope, adding `--local` for a project install,
then installs or updates `git:github.com/ARQAWA/my-pi`. It preserves `auth.json` and unrelated packages/settings.
The saved `anthropic` OAuth credential is reused unless the grant is invalid. Migration belongs to the installation
prompt; the extension itself does not edit package settings, remove packages or perform login automatically.

Run only one Anthropic adapter. Inspect personal/project scope and explicit `-e` arguments with `pi list` and
`pi config`; omit old adapter arguments on the next launch. An unknown competing adapter must be disabled before
installation continues. A conflicting registration produces Pi's native diagnostic in either load order; Pi may
continue session binding. This is not runtime quarantine, an early fatal barrier or replacement of a future
`refresh()` call. Mixed-adapter operation is unsupported. Restart Pi after replacement.

## Disable and restore stock Pi

Use `pi config` to disable only `extensions/RQW-anthropic/index.ts` in my-pi, then `/reload` or restart Pi.
Equivalent personal package declaration:

```json
{
  "source": "git:github.com/ARQAWA/my-pi",
  "extensions": ["**", "!extensions/RQW-anthropic/index.ts"]
}
```

Pi package filters narrow the package's manifest; they do not enable undeclared files. Keep any other filters you
already have. Disable duplicates in both project and personal scope. A reload unregisters this Anthropic overlay
and restores the original registration and request hooks when the last owning session is gone. Public SDK `session.dispose()`
also releases this exact session's overlay synchronously before Pi invalidates the extension context. Disposing
an unowned reviewer or generic child sharing its runtime leaves the main adapter active. The last owner restores
the original hooks; a surviving instance of this same adapter keeps its registration. Disposal and shutdown are
idempotent, including after reload and with independent concurrent sessions. Credentials, including
successfully rotated refresh tokens, stay.
The local `~/.pi/agent/rqw-anthropic-install-id` is a non-secret random installation id, created with mode 0600.
It is not a token or an imported Claude Code identity and is inert when the extension is disabled.

## Prompt cache

OAuth subscription requests default to the 1-hour Anthropic prompt cache. Explicit `cacheRetention` options
(`none`, `short`, `long`) and user-set scoped/process `PI_CACHE_RETENTION` remain untouched, including empty values.
Pi interprets only env `long` as long retention; other env values retain its short default. Use the request option
`cacheRetention: "none"`, not env `none`, to disable caching. Ordinary API-key requests keep stock defaults.

`cache.ts` wraps the session's stream function before Pi's SDK starts CacheWarmer, resolving auth through Pi and
passing a request-local `cacheRetention: "long"` only for OAuth. Native provider preparation still resolves its own
credentials; no resolved key is forwarded. `transport.ts` supplies the same default for direct SDK/provider calls.
Generic sessions sharing the active runtime get the rule even without loading their own adapter. RQW-agent and
RQW-review own a built-in Anthropic `cacheRetention: "short"` request policy (5m), applied before this wrapper;
both `cache.ts` and `transport.ts` preserve it. They keep cache markers, with no `ttl: "1h"`, independently of
user config and whether this adapter is enabled. The main session retains the OAuth 1h default.
Unrelated runtimes/providers are unchanged. This adapter edits no process env or notice/warming settings.
Background warming is separately disabled by RQW-settings regardless of user config, and off in RQW-agent/reviewer
sessions; prompt caching remains on. Built-in policy: [Settings](../../DECISIONS.md#settings).
Disabling the last adapter owner restores the stream functions; surviving owners keep their runtime's rule.

For Opus 5.5 the catalog TTLs are 300/3600 seconds. With RQW-settings on, no warmer timer is armed; real requests
alone write and read the cache. If RQW-settings is disabled, stock Pi behavior returns: an enabled warmer schedules
at 90% of TTL (54 minutes, not 4m30s). Its one-hour streaming safety horizon allows at most one such warm;
the 30-minute idle horizon prevents idle warming with this TTL. Replay safety and Pi's economic decision apply.

Catalog USD estimates per million Opus 5.5 tokens: input 4, output 20, cache read 0.20, short cache write 5.
Anthropic's 1-hour write costs 2x input (8), versus 1.25x (5) for five minutes, but can avoid repeated writes.
Pi's parser records `cacheWrite1h`, and `calculateCost` charges those tokens at 2x input, so reported long-write
usage is not incorrectly priced at the short rate. Limitation: Pi's warmer's prospective miss-cost estimate still
uses the catalog's short-write rate, not 2x, and can underestimate the benefit of warming; this adapter does not
patch that calculation. These are catalog cost estimates, not proof of subscription billing or live cache hits.

The process-wide env alternative is deliberately not used: Pi's `openai-responses` maps `long` to 24h retention
or (for explicit-mode models) 30m, subject to model compatibility and ChatGPT-sign-in field suppression.
`openai-codex-responses` does not read that env for retention; only explicit option `none` removes its session
cache key. Neither provider is changed by this adapter's request-local Anthropic default.

Proof: `test/extensions/RQW-anthropic/cache.test.ts` uses fake OAuth, real Pi SDK/library and CLI-bundle sessions, captured payloads and fake
timers. It covers 1h TTL, no warm at 4m30s, generic shared-runtime children, explicit preferences, API keys and disable/reload.
Package `test/prompt-cache.test.ts` exercises actual RQW-agent and RQW-review sessions: 5m markers, main 1h,
adapter on/off, and a conflicting `PI_CACHE_RETENTION=long`, in the library and CLI-bundle SDKs.

## On-demand subscription quota

`quota.ts` implements the current Claude Code 2.1.310 plain quota read:
`GET https://api.anthropic.com/api/oauth/usage`, using only the bound Pi provider's saved OAuth access token.
No Claude Code installation, credentials file, package, model call, auth refresh or auth write is involved.
The client requires `user:inference` and `user:profile`; normal Pi login requests both. Existing imported
credentials may lack them. A rejected grant stays an explicit error, with no fallback or automatic login.
Current primary evidence and sanitized live HTTP 200 proof: [quota protocol](../../notes/anthropic-quota.md).

A later consumer emits `pi.events.emit("rqw-anthropic:quota:v1", { sessionId, offer(access) { ... } })`.
The matching owning session synchronously offers `{ read, refresh }`. There is no offer when this extension
is disabled, disposed, or belongs to another session. `read()` returns a copy of the last successful snapshot,
or `undefined`. `refresh(signal?)` makes one quota GET with a five-second deadline and returns
`{ fetchedAt, windows }`. Window names match the native response; each non-null window has
`{ utilization, remainingPercent, resetsAt }`, with nullable percentage/reset data preserved. Remaining
percent is `max(0, 100 - utilization)`. Reset strings come from the server, without invented boundaries.
Only the seven native percentage windows are projected; financial and auxiliary limits data is not exposed.

Loading, offering and reading this boundary send no requests. The consumer owns the intended five-minute
cadence; this provider has no timer. Refresh errors reject with a sanitized `QuotaError`: `kind` is `auth`,
`http`, `response` or `network`; HTTP errors carry `status` and optional raw `retryAfter`. They do not erase
or re-date the last successful snapshot. Callers must use `fetchedAt` to distinguish cached data from a fresh
result. Upstream bodies and credential values are never exposed. Abort cancels this quota read; provider
disposal aborts pending reads and clears the cache. A late earlier refresh cannot overwrite a newer result.
No statusbar display, colors, scheduler, options or settings are added here.

## One-shot context fork

`pi.events` channel `rqw:context-fork:v1` accepts `{ sessionId, model, context, reasoning?, signal, offer }`.
The synchronous handler captures independent transport state and calls `offer(infer)` without starting inference.
The consumer later invokes this one-shot `() => Promise<AssistantMessage>` with no arguments. `context` is the
normalized completed child transcript plus a tail report instruction, extending the last captured request.
Missing snapshots, another model, hosted tools and dangling tool calls receive no offer. Tool results must already
be present; the fork neither waits for the child nor fabricates results. No idle-session condition is required.

The fork uses the existing Anthropic builder and subscription transport with cloned context/options and its own
version state and abort signal. The version copy retains the current version and whether it was explicitly pinned
by `PI_AI_CLAUDE_CODE_VERSION`; fork adoption does not change the source version. It keeps the source system
blocks, tool order and actual cache retention, including
children's explicit short policy. Matching message-prefix cache markers are retained. Billing checksums are
recomputed normally, so cache reuse is best effort, never guaranteed. A cache miss causes no retry. Existing
bounded HTTP auth/version recovery remains; SDK retries are disabled. OAuth refresh may persist a rotated grant.
There are no session callbacks, history writes, executor or tool loop. A returned tool call is just data for the
consumer to reject. Errors and abort affect only the fork; stale-result cancellation belongs to its consumer.
Only SDK session identities registered by the existing runtime lifecycle lease may retain snapshots. Auxiliary
routing IDs, including stock compaction's fresh summary ID, never enter the snapshot map. Rebinding a session
releases its former identity; disposal releases its saved snapshot, including stopped or restarted children
sharing the runtime without loading this extension. Already-offered forks keep independent copies and
their own cancellation signal. Another session's snapshot stays intact. No consumer release event or additional
Pi method patch is required. Adapter cleanup removes the inference listener and all remaining source snapshots.
Focused offline coverage: `test/extensions/RQW-anthropic/context-fork.test.ts`.

## Recovery and security

- Pi proactively refreshes expiring OAuth credentials under its store lock. This extension supplies a refresh
  handler using `https://api.anthropic.com/v1/oauth/token`, with at most two attempts for transient transport,
  HTTP 429 or 5xx failures and a 15-second total budget in Pi's refresh path. A missing or blank saved refresh
  token fails before the token request. An omitted response refresh token retains a valid previous token. Pi
  applies its own minimum validity check; the adapter does not subtract another five minutes from the saved TTL.
- An inference HTTP 401 gets one forced refresh/reuse of a newer saved bearer and one replay. The authoritative
  comparison and update run under the same store lock, including across Pi processes. Abort returns promptly;
  a refresh that already started finishes and persists its rotated token instead of losing it. Native OAuth source
  and bearer are captured per request before async payload hooks, including native compact, branch and bug-report
  summaries that forward resolved auth as an explicit key. Explicit or ambient credentials cannot borrow the saved
  account. A concurrent changed bearer is reusable only through proven refresh transitions. The OAuth credential's
  `rqwAnthropicRefresh` metadata retains up to 256 previous bearer SHA-256 hashes, bound to hashes of the current
  access and refresh tokens. Pi persists this proof with the rotated credential under the same lock, so independent
  Pi processes can reuse it without secret token history or a separate file. An unrelated login, unknown external
  rotation or evicted proof fails with new-turn and login guidance instead of switching accounts. A fresh turn
  can resolve the currently saved login. `cross-process-refresh.test.ts` exercises a real sibling process calling
  `refreshCredential()` against shared fake file-backed credentials and the unknown-login rejection control.
- An explicit `claude_code_version_too_old` HTTP 400 may adopt the newer required version and replay once per
  request, including when another concurrent request already adopted a sufficient newer version.
  The default is `2.1.280`, as in the inspected omp source. `PI_AI_CLAUDE_CODE_VERSION=major.minor.patch` pins it
  and disables version adoption. No version-discovery network calls happen at startup.
- HTTP 403 and quota errors do not trigger an auth-refresh loop. Permanent authentication errors tell you to retry
  or use `/login anthropic`. Saved credentials are not silently deleted or replaced with an environment API key.
- Auth replay only handles HTTP rejection before stream delivery. Visible main-agent text, thinking or tool-call
  start blocks automatic turn replay and overflow recovery without discarding partial content or diagnostics.
  Message-start, ping and usage-only traffic retain stock zero-output retry. Internal partial summaries are not
  published and keep Pi's native transient retry and callbacks unchanged. No extra SSE parser or body buffer is
  added. No automatic fallback to another model, account or billing mode.
- Subscription requests are restricted to `https://api.anthropic.com`; redirects are rejected. Custom Anthropic
  gateways with OAuth are deliberately unsupported. OAuth bearer headers, including the resolved
  `ANTHROPIC_AUTH_TOKEN` path and model/request Authorization headers, are rejected before delegation, even
  on the official origin. Use `/login anthropic`, `ANTHROPIC_OAUTH_TOKEN` or an explicit OAuth `apiKey` instead.
  Ordinary API keys and non-subscription gateway bearer headers retain Pi's normal gateway support.
- Auth failures do not print upstream token-response bodies. There are no credential logs or debug dumps.

## What is and is not equivalent to omp

The CLI billing block, original Claude Code identity, retained system role, first-user fingerprint and exact-body
XXH64 checksum follow the inspected omp implementation. This is NOT the installed adapter's SDK entrypoint,
system-to-user relocation or normalized-body checksum. Pi still handles tool conversion, parsing and feature betas.
The installation/session metadata uses our own stable device id, not a fabricated account uuid.

Pi's own PKCE browser/copy-code flow is delegated unchanged, including its platform.claude.com exchange endpoint
and callback port. Only refresh uses omp's api.anthropic.com endpoint/headers. Multi-account rotation, bootstrap
account lookup, all omp SDK fingerprint headers and advanced streaming features are not ported. Real Anthropic
acceptance and subscription billing have not been verified by offline tests and cannot be promised by this adapter.

The registration guard (`registration.ts`) is a version-guarded, reversible in-memory shim of three `ModelRuntime`
methods: it rejects a second Anthropic overlay in either order, binds the runtime credential store to this overlay,
and checks the auth boundary before each request. No node_modules file is patched. It is limited to runtimes with this
marked overlay. The hooks are reference-counted and removed on shutdown, reload or SDK
dispose. A separate checked shim wraps `AgentSession.dispose` because Pi 1.4.0 has no public SDK pre-dispose
event, and `_bindExtensionCore` to associate cleanup with the exact owning session, even without `session_start`.
Recovery hooks preserve native `stream` versus `streamSimple` options and OAuth provenance. Only visible main-turn
recovery is guarded; native summary retry is not wrapped. Unrelated SDK runtimes retain stock Pi behavior.

Research, mechanisms and risks: `notes/anthropic-adapter.md`. TTL evidence and the accepted role policy:
[Prompt cache policy](../../notes/prompt-cache-policy.md). Attribution: `THIRD-PARTY-NOTICES.md`.
Tests: `npm test`, using fake credentials and mock fetch only. No live OAuth or model calls in tests.
The separately authorized read-only quota verification is recorded in the quota protocol note.
The unsupported co-load regression uses a portable competing-registration fixture with a temporary home and
`PI_OFFLINE=1`; it expects native diagnostics, not a mandatory early-fatal policy.
Targeted `bun test test/extensions/RQW-anthropic/` still runs library, transport and lifecycle tests on Bun 1.3.14;
only bundle-dependent tests explicitly skip its known stock Pi npm-bundle import failure. Other import errors fail.

<!-- repo-index:start -->
## File map

Generated by `node scripts/repo-index.mjs --write` from the repository root.

| File | Responsibility |
| --- | --- |
| [`README.md`](README.md) | Hand-written contract and generated file map |
| [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md) | Third-party attribution and provenance |
| [`auth-boundary.ts`](auth-boundary.ts) | Authentication request boundary |
| [`auth.ts`](auth.ts) | Subscription credentials and OAuth recovery |
| [`cache.ts`](cache.ts) | Prompt cache policy |
| [`context-fork.ts`](context-fork.ts) | context fork module or resource |
| [`index.ts`](index.ts) | Pi extension entrypoint: Anthropic subscription authentication and transport |
| [`lifecycle.ts`](lifecycle.ts) | Installation and teardown lifecycle |
| [`quota.ts`](quota.ts) | quota module or resource |
| [`registration.ts`](registration.ts) | Provider registration overlay |
| [`retry.ts`](retry.ts) | Transport retry classification and waiting |
| [`transport.ts`](transport.ts) | Subscription request transport |
| [`wire.ts`](wire.ts) | Provider request and response conversion |

Tests: [`test/extensions/RQW-anthropic/`](../../test/extensions/RQW-anthropic/).
<!-- repo-index:end -->
