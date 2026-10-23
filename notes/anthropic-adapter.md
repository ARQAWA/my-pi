# RQW-anthropic research and design

## Agreement

Owner requests in the omp session (`C:<line>`), summarized here, not verbatim quotes: an Anthropic subscription
adapter in this repository, the same as in omp, with self-healing, that can also be used to log in (C:3133);
only Codex and Anthropic in login (C:3171, now carried by RQW-providers, `DECISIONS.md` section Providers).
Module independence is required by C:3046; work only in my-pi by C:1653. `C:<line>` uses the raw session reference
in `DECISIONS.md`. Credential preservation, reversible hooks and retry bounds are engineering choices implementing
those requests, not English direct quotations of the owner. The authorized known-adapter replacement is recorded in
`DECISIONS.md` and carried by `INSTALL.md`.
The old Claude benchmark and tuning campaigns once paused at C:3244 are dead, superseded by the v3 benchmark
([BACKLOG.md, R02](../BACKLOG.md#r02)). Offline fixtures document only the proof they provide, not live acceptance.

## Sources inspected

Research snapshot: Pi 1.3.0 at the time; the package now pins Pi 1.4.0.

- Pi 1.3.0 installed in this worktree, `@earendil-works/pi-coding-agent/dist/core/{model-runtime,model-registry,provider-composer,auth-storage,agent-session}.js`,
  `dist/modes/interactive/interactive-mode.js` and `components/model-selector.js`.
- Pi AI 1.3.0 `dist/{auth/resolve,auth/oauth/anthropic,providers/anthropic,api/anthropic-messages}.js`.
- Installed `~/.pi/agent/git/github.com/edxeth/pi-claude-auth` package version 1.3.0, commit `1f6920ff431538079966dcd634516bc60e8ab9ed`: README, package manifest,
  provider, signing, transforms, checksum and wiring/request-path tests. README says MIT, but no LICENSE file is
  installed and package.json has no license field. Do not vendor its implementation without a complete grant.
- Read-only `~/Documents/ChatGPT/oh-my-pi` at `fa5ff4a3a977a28b93d025f4cf50f046e019f18c`: `packages/ai/src/providers/{anthropic,anthropic-identity,claude-code-fingerprint}.ts`,
  `src/auth-retry.ts`, `src/registry/oauth/anthropic.ts`, catalog `compat/rules/auth/anthropic.kdl`, root MIT LICENSE.
- Read-only `~/Documents/ChatGPT/my-omp-harness`: DECISIONS, settings/config.yml, settings/models.yml and recent Git history.
  Current harness restricts enabledModels to Anthropic and openai-codex. No account credential files were read.

## Current behavior and important differences

Pi already has subscription OAuth: Claude Code's public client id, PKCE, claude.ai authorization, browser callback
and manual copy-code methods. It saves `anthropic` in auth.json. Stored OAuth wins over environment API keys.
`auth/resolve.js:refreshStoredOAuthCredential` refreshes under the credential-store lock with a second check;
a refresh that already started survives caller abort to persist rotated tokens. Errors preserve stored credentials.
It proactively refreshes within five minutes. Pi does not retry a rejected, unexpired bearer with a forced refresh.
Stock refresh/token exchange uses platform.claude.com rather than omp's api.anthropic.com.

Stock Anthropic transport emits bearer auth, a bare claude-cli user agent, the CLI identity system block,
feature-dependent beta headers, OAuth tool-name conversion, but no billing block or cch.

The installed pi-claude-auth is an overlay, not a complete auth adapter. It preserves Pi's catalog and login,
fetches a Claude Code version from npm, changes identity to Agent SDK with entrypoint sdk-cli, moves the system
prompt into the first user message, hashes a normalized body with model blanked and max_tokens removed, and adds
prompt/turn stamps. It reads ~/.claude.json for identity and includes refusal/model-switch UI. Its README's billing
claims are not independently established by this offline work. These are NOT the behavior of the inspected omp.

omp uses entrypoint cli, retains the original system instructions as system blocks after the Claude Code identity,
SHA256 salt 59cf53e54c78 with characters 4/7/20 of the first non-empty user text block for the version suffix, and seeded XXH64 over the actual
serialized body with cch=00000. Seed: 0x4d659218e32a3268. Version fallback: 2.1.280. It adopts a newer minimum from
an explicit claude_code_version_too_old rejection. It sends installation/session metadata, optional account identity,
and has a larger streaming implementation with tool prefix _, SDK fingerprint headers and advanced model features.
Its OAuth refresh goes to api.anthropic.com, includes oauth-2025-04-20 and the SDK userOAuthProvider user agent.
Its auth driver refreshes the same account once on 401 before rotating through sibling accounts. Pi stores one
credential per provider, so sibling rotation does not apply. Policy/permission 403 and quota errors are not cured
by blindly refreshing. omp's bootstrap identity fetch is unnecessary for a single saved Pi credential and is omitted.

## Provider visibility: concrete mechanism, not an unsupported claim

(Carried by the separate extension `RQW-providers` since the owner's answer «7a»; `DECISIONS.md` section Providers.
Ownership there comes from the patched `_bindExtensionCore`, not from the Anthropic overlay registration described below.)

`InteractiveMode.getLoginProviderOptions` enumerates `session.modelRuntime.getProviders()`.
The model selector uses `getAvailableSnapshot()`, with a separate scoped list from `AgentSession.scopedModels`;
model autocomplete/cycling also use those surfaces. `ModelRegistry.getAll()` delegates to `ModelRuntime.getModels()`.
`pi.unregisterProvider()` only removes extension layers: builtin providers immediately reappear through
`ModelRuntime.recomposeProvider`. Registering empty models does not remove login methods. Public APIs therefore
cannot hide builtins from both selectors.

Use a narrow in-memory reversible shim, owned entirely by this extension: filter ModelRuntime's provider/model
listing methods and AgentSession's scopedModels getter. Keep provider/auth stores and their contents untouched.
The shim is installed while the extension is loaded and restored on session_shutdown, including reload, or
public SDK dispose. Pi 1.4.0 has no native pre-dispose event: `lifecycle.ts` narrowly wraps checked
`AgentSession.dispose` and performs synchronous idempotent cleanup before invalidation, without synthesizing
shutdown events for other extensions. `_bindExtensionCore` associates cleanup with the exact owning session,
even without session_start. Disposing an unowned reviewer or generic child sharing the runtime leaves the main
adapter active. Reference-counted shared patch state preserves surviving owners and restores the original hooks
after the last owner releases them. Check all patched descriptors before changing anything. No node_modules edits, no disk core patch. Tests must exercise
Pi's real login-option builder and both model-selector input paths, plus restoration. This is version-sensitive
Pi 1.4.0 integration; a missing hook must produce an explicit load error, never a partial policy.

## Minimal implementation

1. A named `anthropic-messages` stream overlay preserves the catalog-enabled builtin provider. Register an OAuth
   adapter with Pi's own browser/copy-code login delegated unchanged, safe failure messages, and a bounded transient
   refresh retry implementation using omp's refresh endpoint and headers. Pi remains the sole credential owner.
2. The overlay keeps Pi's message/tool parser. A per-request fetch wrapper inserts the omp billing shape after
   serialization, keeps system instructions in place, stamps session metadata and user agent, and computes cch
   over the exact bytes sent. API-key calls pass through. Subscription Authorization headers are explicitly rejected before delegation;
   Pi resolves ANTHROPIC_AUTH_TOKEN to that header path. Only canonical OAuth apiKey auth is signed.
   No startup network/version lookup or ~/.claude reads.
3. On an HTTP 401 before stream delivery, compare the rejected bearer under the existing store's modify lock;
   reuse an already-rotated token or refresh once and persist it before replay. Cancellation stops waiting/requests,
   not an already-started rotating refresh. No replay after visible main-turn partial output, no retry of 403/quota errors,
   no destructive logout. At most one auth replay and one explicit version upgrade replay per request.
4. Bind the credential store during the runtime registration of the overlay, not a new hard-coded ~/.pi auth path.
   The existing registration shim passes the checked ModelRuntime.credentials store to the marked handler.
   This also works before session_start and after headless SDK reloads. Surface actionable /login anthropic guidance on terminal auth
   failure and redact upstream auth failure bodies. Do not log request headers or credentials.
5. Run one Anthropic adapter. `INSTALL.md` handles the authorized known-adapter replacement using official
   `pi remove git:github.com/edxeth/pi-claude-auth` in its installed scope, then normal my-pi installation/update.
   Preserve auth.json and unrelated packages/settings. The extension does not edit package settings or perform login
   automatically. Unknown competing adapters must be disabled before installation continues. The registration guard
   reports a conflict through native Pi diagnostics in either load order; session binding may continue. It does not
   persist a quarantine, force early CLI failure or replace future refresh calls. Mixed-adapter operation is unsupported.
6. Toggle: disable this package extension using Pi's package extension filter, then reload/restart. Pi's stock
   Anthropic transport and provider composition return, without restoring stale credential snapshots. Provider
   visibility belongs to RQW-providers and stays filtered while that extension is enabled. The other RQW extensions stay.

## Risks and proof boundary

Subscription acceptance and billing cannot be proven with mock fetch; no assertion that an account will be billed
to its subscription. Anthropic may change policy/fingerprint requirements. Keep the omp wire behavior rather than
silently adopting the installed fork's contradictory SDK relocation/checksum behavior. Pi's parser/model feature
support stays Pi's, not all of omp's implementation. Stock delegated login retains Pi's endpoint/callback choice;
refresh, billing and auth recovery follow the inspected omp behavior. No account rotation or refusal model fallback.

Offline coverage uses fake credentials, a mocked official Anthropic origin and faux providers. The adapter tests
cover signing, API-key bypass, refresh persistence/concurrency and file-backed locking, transient versus permanent
errors, retry bounds, abort and rotated-token persistence, invalid responses, native conflict diagnostics, reload and
disposal. Provider visibility is covered separately by `extensions/RQW-providers/test/providers.test.ts`. Exact owner cleanup includes shared-runtime child disposal and surviving owners.
These fixtures are not proof of live subscription acceptance or billing, nor a claim of execution on Windows/Linux.

## Recovery mechanisms and proof limits

Runtime registration binds the actual credential store before requests, including before session_start and after
headless SDK reload. Canonical OAuth auth is signed; resolved or configured subscription Authorization headers are
rejected before delegation. Ordinary API-key gateway requests retain stock behavior. A stored-account 401 permits
one refresh/replay under the store lock. Reusing a concurrent bearer requires in-process proof of the refresh
transition, not just a changed saved token; unknown login/rotation requires a fresh turn or login guidance.

Native compact, branch and bug-report summaries forward resolved auth as an explicit key. Operation-scoped
provenance preserves their stored-OAuth origin without allowing unrelated explicit or ambient credentials to borrow
that account. The adapter preserves native stream versus streamSimple options. Visible main-turn partial output
blocks automatic replay and overflow recovery, but internal partial summaries keep stock transient retries and
callbacks. Pi applies its native minimum-validity check to refreshed credentials; the adapter does not subtract
another five minutes from the saved TTL. Regression fixtures include concurrent getAuth calls with a 540-second TTL.

Current coverage is in `extensions/RQW-anthropic/test/`, including native summary recovery, credential TTL,
auth-boundary and shared-runtime lifecycle fixtures. Test definitions are coverage descriptions, not a report of
execution on the assembled revision.
No real-account login/refresh, live Claude acceptance, subscription billing or complete omp SDK/streaming parity is
established by these offline fixtures.
