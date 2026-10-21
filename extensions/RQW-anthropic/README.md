# RQW-anthropic

Subscription transport for stock Pi 1.3.0. `/login anthropic` still uses Pi's browser or copy-code login.
The builtin model catalog and Pi's message/tool parser stay intact. Plain API-key requests pass through unchanged.
Only `anthropic` and `openai-codex` are listed in login and model pickers while the adapter is active.
Credentials for every other provider remain saved. This is a visibility policy, not a credential access sandbox:
explicit SDK lookups and previously selected hidden models are not erased or silently switched.

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
and restores the original visibility methods when the last owning session is gone. Public SDK `session.dispose()`
also releases this exact session's overlay synchronously before Pi invalidates the extension context. Disposing
an unowned reviewer or generic child sharing its runtime leaves the main adapter active. The last owner restores
the original hooks; a surviving instance of this same adapter keeps its registration. Disposal and shutdown are
idempotent, including after reload and with independent concurrent sessions. Credentials, including
successfully rotated refresh tokens, stay.
The local `~/.pi/agent/rqw-anthropic-install-id` is a non-secret random installation id, created with mode 0600.
It is not a token or an imported Claude Code identity and is inert when the extension is disabled.

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
  account. A concurrent changed bearer is reusable only through refresh transitions proven in this process. Up to
  256 SHA-256 access/refresh hash edges are shared across module copies and reloads, with no secret token history
  or new credential fields. An unrelated login, unknown external rotation or evicted proof fails with new-turn
  and login guidance instead of switching accounts. A fresh turn can resolve the currently saved login.
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

Provider hiding needs a version-guarded, reversible in-memory shim of Pi's exported classes because the public
extension API cannot remove builtin login methods. No node_modules file is patched. The policy is limited to
runtimes with this marked overlay. The hooks are reference-counted and removed on shutdown, reload or SDK
dispose. A separate checked shim wraps `AgentSession.dispose` because Pi 1.3.0 has no public SDK pre-dispose
event, and `_bindExtensionCore` to associate cleanup with the exact owning session, even without `session_start`.
Recovery hooks preserve native `stream` versus `streamSimple` options and OAuth provenance. Only visible main-turn
recovery is guarded; native summary retry is not wrapped. Unrelated SDK runtimes retain stock Pi behavior.

Research, mechanisms and risks: `notes/anthropic-adapter.md`. Attribution: `THIRD-PARTY-NOTICES.md`.
Tests: `npm test`, using fake credentials and mock fetch only. No live OAuth or model calls.
The unsupported co-load regression uses a portable competing-registration fixture with a temporary home and
`PI_OFFLINE=1`; it expects native diagnostics, not a mandatory early-fatal policy.
Targeted `bun test extensions/RQW-anthropic/test/` still runs library, transport and lifecycle tests on Bun 1.3.14;
only bundle-dependent tests explicitly skip its known stock Pi npm-bundle import failure. Other import errors fail.
