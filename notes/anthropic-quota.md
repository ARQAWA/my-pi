# Anthropic subscription quota protocol

Inspected on 2026-10-25: public Claude Code npm latest **2.1.310**, build commit
`0d2056ecf42d9452a8cd8e054600024e7c557add`, build time `2026-10-23T17:43:32Z`.
The public platform package embeds readable JavaScript. It was downloaded to OS temporary storage,
not installed or executed. No Claude Code installation is needed by RQW-anthropic.

## Primary evidence

- [Wrapper metadata](https://registry.npmjs.org/@anthropic-ai/claude-code/2.1.310)
- [Native metadata](https://registry.npmjs.org/@anthropic-ai/claude-code-linux-x64/2.1.310)
- [Native tarball](https://registry.npmjs.org/@anthropic-ai/claude-code-linux-x64/-/claude-code-linux-x64-2.1.310.tgz)
- [Pi auth package](https://registry.npmjs.org/@earendil-works/pi-ai/1.4.0)

Native tarball SHA-256: `8c90b0170d08fdb370db282c61d74897b834fc2569dd14c35eb1e491212dc6de`.
Executable SHA-256: `b73676430af12f97316a798b8371f81d640f90a58bdcb8f3ce56a835bb47df56`.
Both wrapper and native tarball integrity matched npm's SHA-512 metadata. Exact extracted source fragments,
byte offsets and individual hashes are saved outside the repository at
`/Users/arkadijcukavin/ai-project/my-pi-evidence/anthropic-direct-limits/manifest.json` and `REPORT.md`.
This is reverse-engineered current client behavior, not an officially supported public quota API.

## Request and auth

The plain client read uses `GET https://api.anthropic.com/api/oauth/usage`, without body or query.
Its application headers are `Authorization: Bearer <access>`, `anthropic-beta: oauth-2025-04-20`,
`Content-Type: application/json`, and `User-Agent: claude-cli/2.1.310 (external, cli)`.
The native transport sets a 5000 ms timeout. No explicit API key, organization, cookie or
`anthropic-version` header is present on this call. Ordinary network defaults are not a captured wire trace.

The client checks both `user:inference` and `user:profile`. Pi 1.4.0 requests both during its normal
browser/copy-code login with the same OAuth client ID. Pi does not retain granted scopes, so arbitrary
imported credentials cannot be assumed compatible. RQW-anthropic reads only its already-bound
`CredentialStore.read("anthropic")`, Pi's documented status-read boundary. It never reads Claude Code auth,
refreshes a token, writes auth, or retries rejected credentials for quota acquisition.

## Response and errors

The native cache schema accepts optional or null `five_hour`, `seven_day`, `seven_day_oauth_apps`,
`seven_day_opus`, `seven_day_sonnet`, `cinder_cove`, and `wattle_ember` windows. Each has required nullable
`utilization` and `resets_at`. Native rendering uses the number directly as percent used, not a fraction.
Reset values are date strings, not epoch seconds. The client schema does not require ISO syntax.
Our projection preserves these windows, nullable values and raw reset strings, adding
`remainingPercent = max(0, 100 - utilization)` without display rounding. Missing windows remain missing.
No financial `extra_usage` or auxiliary `limits` rows are exposed by this basic window boundary.

The native client classifies network failures, HTTP 401, 403, 429 and other HTTP failures separately.
It can remember auth rejection and rate limiting using `Retry-After`, and can refresh/replay auth.
Those auth mutations and error-cache policies are not ported. Our read makes one GET, reports HTTP
status plus the raw optional `Retry-After`, and exposes no upstream body. A 403 alone is not proof of
an expired token; a 429 is not proof that the subscription's five-hour allowance is exhausted.
Errors leave the last successful snapshot and its original fetch time intact. There is no retry scheduler.

## Ready-made search and proof

`@pi-plugins/usage` 0.8.0 is MIT, 4,942,633 unpacked bytes, seven files, no declared runtime dependencies,
wildcard Pi peers; its repository was updated 2026-10-21. It bundles a widget and broader auth behavior,
which exceeds this dependency-free provider boundary. `ccusage` 20.0.44 is MIT, 538,451 unpacked bytes,
five files, no declared runtime dependencies, repository updated 2026-10-25; its local-log/cost CLI is not
an in-process direct quota provider. Package/repository metadata is saved in the external evidence folder.
The owner explicitly required an own implementation without external dependencies.

Focused deterministic proof: `test/extensions/RQW-anthropic/quota.test.ts`. After it passed, one authorized
read-only live quota GET returned HTTP 200 at `2026-10-25T04:11:29.876Z`. `five_hour` and `seven_day` had
numeric utilization and parseable reset dates; the other known windows were null. No usage values,
reset values, bearer, or raw response were printed or saved. The auth file hash was unchanged.
Sanitized proof: external evidence `live-result.json`; reproducible read-only probe: `live-probe.mjs`.
This proves that saved grant worked then, not that all future or imported grants have the required scopes.
No model request, token generation, live auth refresh, or live 401/403/429 experiment was performed.
