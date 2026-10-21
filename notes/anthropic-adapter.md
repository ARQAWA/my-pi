# RQW-anthropic research and design

## Agreement

Owner's current brief is the authority for this branch: "Work only here, other repos read-only";
"same Claude Code OAuth behavior as omp"; "self-healing (refresh/retry recoverable auth failures, no silent broken state)";
"only our Anthropic and openai-codex visible in login AND model picker";
"Preserve saved credentials; hide providers, never delete keys";
"Completely isolated self-contained toggleable extension RQW-anthropic; disabling restores Pi defaults";
"No live model calls, no Anthropic OAuth refresh/login/network probes using real account, no nested agents";
"Commit on branch, do not push/merge". No absent historical owner quotation is reconstructed.

## Sources inspected

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

`InteractiveMode.getLoginProviderOptions` enumerates `session.modelRuntime.getProviders()`.
The model selector uses `getAvailableSnapshot()`, with a separate scoped list from `AgentSession.scopedModels`;
model autocomplete/cycling also use those surfaces. `ModelRegistry.getAll()` delegates to `ModelRuntime.getModels()`.
`pi.unregisterProvider()` only removes extension layers: builtin providers immediately reappear through
`ModelRuntime.recomposeProvider`. Registering empty models does not remove login methods. Public APIs therefore
cannot hide builtins from both selectors.

Use a narrow in-memory reversible shim, owned entirely by this extension: filter ModelRuntime's provider/model
listing methods and AgentSession's scopedModels getter. Keep provider/auth stores and their contents untouched.
The shim is installed while the extension is loaded and restored on session_shutdown, including reload. Use
reference-counted shared patch state so concurrent extension instances do not restore each other's hooks. Check
all patched descriptors before changing anything. No node_modules edits, no disk core patch. Tests must exercise
Pi's real login-option builder and both model-selector input paths, plus restoration. This is version-sensitive
Pi 1.3.0 integration; a missing hook must produce an explicit load error, never a partial policy.

## Minimal implementation

1. A named `anthropic-messages` stream overlay preserves the catalog-enabled builtin provider. Register an OAuth
   adapter with Pi's own browser/copy-code login delegated unchanged, safe failure messages, and a bounded transient
   refresh retry implementation using omp's refresh endpoint and headers. Pi remains the sole credential owner.
2. The overlay keeps Pi's message/tool parser. A per-request fetch wrapper inserts the omp billing shape after
   serialization, keeps system instructions in place, stamps session metadata and user agent, and computes cch
   over the exact bytes sent. API-key calls pass through. No startup network/version lookup or ~/.claude reads.
3. On an HTTP 401 before stream delivery, compare the rejected bearer under the existing store's modify lock;
   reuse an already-rotated token or refresh once and persist it before replay. Cancellation stops waiting/requests,
   not an already-started rotating refresh. No replay after partial streamed output, no retry of 403/quota errors,
   no destructive logout. At most one auth replay and one explicit version upgrade replay per request.
4. Bind the credential store during the runtime registration of the overlay, not a new hard-coded ~/.pi auth path.
   The existing registration shim passes the checked ModelRuntime.credentials store to the marked handler.
   This also works before session_start and after headless SDK reloads. Surface actionable /login anthropic guidance on terminal auth
   failure and redact upstream auth failure bodies. Do not log request headers or credentials.
5. Installation must stop when pi-claude-auth or another Anthropic overlay is enabled. Explain how the owner can
   disable only that extension and keep auth.json. Do not automatically edit local configuration or uninstall it.
6. Toggle: disable this package extension using Pi's package extension filter, then reload/restart. Restore default
   visibility and provider composition, without restoring stale credential snapshots. The other RQW extensions stay.

## Risks and proof boundary

Subscription acceptance and billing cannot be proven with mock fetch; no assertion that an account will be billed
to its subscription. Anthropic may change policy/fingerprint requirements. Keep the omp wire behavior rather than
silently adopting the installed fork's contradictory SDK relocation/checksum behavior. Pi's parser/model feature
support stays Pi's, not all of omp's implementation. Stock delegated login retains Pi's endpoint/callback choice;
refresh, billing and auth recovery follow the inspected omp behavior. No account rotation or refusal model fallback.

Verification uses fake credentials, a mocked official Anthropic origin and faux providers only. Cover exact signing,
API-key bypass, refresh persistence/concurrency/cross-store locking, transient versus permanent errors, retry bounds,
abort-before-start and abort-during-refresh, second 401, invalid responses, provider visibility, co-load conflicts,
reload and disabling in the library and CLI bundle. Windows/Linux behavior is portable code plus tests suitable for
existing CI; actual execution on those systems is not claimed from this macOS worktree. Independent model review
and live model runs are excluded by the owner's no-nested-agents/no-live-calls restriction for this branch.

## Implemented result and verification

The extension is registered in the package and documented in AGENTS and DECISIONS. INSTALL now stops at a competing
Anthropic extension; no owner's local settings were read/rewritten for migration and no credential file was touched.
Runtime registration binds the actual credential store before any request, even before session_start. Shutdown uses
its public context to unregister the exact owned handler, including after an SDK reload that emits no session_start.
This lifecycle was tested through repeated enabled reload, a forced-401 request after that reload, then disabling.
A missing credential bridge rejects registration before changing the provider or its visibility.

Final offline check: `node --test --test-reporter=dot "extensions/*/test/*.test.ts"` completed with exit status 0.
This is the same suite as `npm test`. The adapter has 23 tests, including real Pi library and CLI-bundle loading,
copy-code PKCE login with a fake exchange, malformed-login preservation, proactive refresh, forced refresh after
reload, two file-backed stores sharing a lock, abort before/during refresh, saved API-key preservation, actual
serialized request signing, bounded 401/version retries, no partial-stream replay, and reversible picker/login hooks.
The full suite retains its platform-specific Windows skip on macOS. `git diff --cached --check` passed.

No live model requests, real-account login/refresh, account probes, token logging, nested agents or independent
subagent review were used. Windows/Linux execution and real subscription acceptance/billing remain unverified.
No push or merge is part of this branch delivery. The delegated stock login endpoint/callback and incomplete omp
SDK/advanced streaming parity are explicit limits, not silently replaced behavior.
