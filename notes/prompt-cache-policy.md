# Prompt caching: mechanics and role TTL policy

The warming decision is in [DECISIONS.md, Settings](../DECISIONS.md#settings). Warming means synthetic replay;
prompt caching means provider cache markers on real requests. Turning warming off does not remove the markers.
The accepted built-in role policy is main OAuth 1h, child/reviewer 5m, with no new config knobs.
Approval: [DECISIONS.md, Anthropic subscription adapter](../DECISIONS.md#anthropic-subscription-adapter).

Owner: «Разберись, как это работает у основных. Разберись, как работает кэширование у саб-агентов.»

## Request path

Researched on Pi 1.3.0 and kept as frozen evidence; the package now pins Pi 1.4.0. With RQW-anthropic active and an
OAuth subscription:

| Session | Default TTL | Warmer | Lifetime / reuse |
| --- | --- | --- | --- |
| Main with RQW-settings | 1h | Off regardless of user config | Persists; can be resumed after pauses |
| RQW-agent child | Built-in 5m | Off in its own in-memory settings | Kept for `send`; `restart` replaces history; stop/main shutdown disposes it |
| RQW-review reviewer | Built-in 5m | Off in its own in-memory settings | Fresh per review call, disposed after verdict/error/timeout |

On the main/generic path, explicit request `cacheRetention` or scoped/process `PI_CACHE_RETENTION` wins over the
adapter's OAuth default. API keys keep Pi's short default. RQW-agent/reviewer wrappers instead supply their own
explicit `short` on Anthropic Messages requests, so user env cannot change their built-in tier. Both adapter cache
boundaries preserve this explicit option. Without RQW-anthropic, children still send 5m; the main returns to native
Pi retention. No new config settings are added.

Carriers: `extensions/RQW-anthropic/cache.ts` wraps each bound session before the SDK arms its warmer;
`lifecycle.ts` binds shared-runtime children even when their loaders have no adapter. `transport.ts` also supplies
OAuth `long` on direct provider calls. RQW-agent and RQW-review share the main ModelRuntime, but build independent
SettingsManagers; neither disables prompt caching. They do not inherit the main warming setting. Their existing
stream guards apply `cacheRetention: "short"` before the bound adapter wrapper, independently in each extension.
Package `test/prompt-cache.test.ts` captures actual child and reviewer wire markers in library/bundle SDKs with
RQW-anthropic on/off and env unset/long: markers remain ephemeral, with no `ttl: "1h"`; main with the adapter
retains 1h. No imports between extension folders are needed.

Pi-ai `dist/api/anthropic-messages.js` puts `cache_control` on OAuth identity/system blocks (`:934-953`), the last
tool (`:1328`), and the eligible final message block (`:1219-1241`). Child requests traverse this same provider.
The cache order is tools, system, messages. A child with different prompt/tools/model is not guaranteed to reuse
its parent's prefix; it builds and then reuses its own. Tiny prefixes below the provider's minimum may not cache.

## Six-request live check

On 2026-10-21, six real subscription requests: two turns each in main-like Opus, subagent-like Sonnet, and
reviewer-like Haiku SDK sessions. The children shared the main runtime and loaded no adapter of their own. Tools
were six stock tools for main/child and read/grep/find for reviewer. A synthetic stable prompt exceeded model cache
minimums; replies were capped at 32 tokens, thinking off, and no tools were called. All warmers were off.
This measured the generic SDK 1h fallback before applying the child-specific 5m policy; it is the repricing baseline,
not a live verification of the new short tier. The short wire tier is proved by deterministic package tests.
Only usage was printed. Credentials were read into an in-memory store, the SDK agent directory was temporary,
and no owner settings or credentials were written. No additional live requests were made.

| Role / model | Turn | Input | Output | Cache read | Cache write | Of write, 1h |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Main / Opus 5.5 | 1 | 4 | 4 | 0 | 31819 | 31819 |
| Main / Opus 5.5 | 2 | 4 | 4 | 31819 | 13 | 13 |
| Child / Sonnet 5.5 | 1 | 4 | 4 | 0 | 31819 | 31819 |
| Child / Sonnet 5.5 | 2 | 4 | 4 | 31819 | 13 | 13 |
| Reviewer / Haiku 5.5 | 1 | 4 | 4 | 0 | 31019 | 31019 |
| Reviewer / Haiku 5.5 | 2 | 4 | 4 | 31019 | 15 | 15 |

This proves subscription requests can write 1h entries and read them on the next turn with warming off.
These are SDK configurations matching the roles, not a performance benchmark of complete agent/review tool runs.
The live fixture uses a large artificial prefix and cannot establish typical production prompt size, 5m expiry
behavior, subscription quota accounting, or the historical cause of a limit exhaustion. Offline adapter tests
capture the child wire markers and TTL independently (`extensions/RQW-anthropic/test/cache.test.ts`).

## Historical host evidence and its boundaries

Read-only scan of `~/.pi/agent/sessions/**/*.jsonl` and `~/.omp/agent/sessions/**/*.jsonl`, for entry timestamps on
2026-10-20/21 (UTC). Assistant messages only, provider `anthropic`; copied fork entries deduplicated by entry id,
timestamp and model. This is available persisted traffic, not all activity on the account.

| Engine | Day | Model | Requests | Cache read | Cache write | Explicitly reported 1h writes |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| Pi | 20 | Opus 5.5 | 73 | 8817127 | 821144 | 0 |
| Pi | 20 | Haiku 5.5 | 18 | 142586 | 29666 | 0 |
| Pi | 21 | Opus 5.5 | 344 | 42559445 | 1947958 | 213390 |
| Pi | 21 | Sonnet 5.5 | 35 | 1408028 | 69465 | 0 |
| omp | 20 | Opus 5.5 | 1566 | 330196560 | 5042922 | 5042922 |
| omp | 20 | Sonnet 5.5 | 3 | 57911 | 33577 | 33577 |
| omp | 21 | Opus 5.5 | 37 | 9962261 | 28746 | 28746 |

Pi also has one older Haiku 4.5 request on day 20: read 0, write 9382. Pi reports long writes as `cacheWrite1h`;
omp uses `usage.cttl.ephemeral1h`. The Pi rows include previous retention policies, not only today's adapter.

Neither harness gives complete persisted per-child token telemetry:

- RQW-agent's SessionManager is in-memory; parent results carry text and a delivery id, not child usage. Review
  results carry level/model/thinking/seconds, not tokens. Historical child read/write counts cannot be recovered
  from those results. Main-session totals do not include all child inference costs.
- The owner's omp harness (`extensions/shared/subagents.ts:72-89`) also uses in-memory sessions and passes
  `cacheWarming: false`, **not** `cacheRetention: "none"`. Its result metadata has model/thinking/seconds/failed,
  not token usage. Current omp source defaults OAuth to 1h and leaves breakpoints on. Thus no evidence supports
  the hypothesis that this flag disabled subagent prompt caching. Exact yesterday's in-memory child hits are not
  recoverable from these parent entries.
- Some persisted omp sessions have `parentSession` headers, but these can be forks and are not attributable to
  the harness's in-memory workers; their copied messages must not be counted twice or relabeled as those workers.
- Read-only SQLite connection: `file:~/.omp/agent/agent.db?mode=ro` (expanded absolute path). `client_usage` has
  zero rows. `usage_history` has account quota snapshots, not per-child token usage. No credential rows were read.
  The 504 dated `model_usage` session entries were `judge_batch`, not worker or cache-warmer attribution.

Available timing, not guessed per-child request intervals:

| Population | Samples | Median | Maximum | Meaning |
| --- | ---: | ---: | ---: | --- |
| Persisted Pi assistant-to-assistant gaps | 455 | 8.47s | 10636.32s | Mixed main traffic; 13 gaps >5m, 3 >1h |
| Pi matched child task result latency | 24 | 133.87s | 1395.36s | From start/send result to child delivery; not internal request gaps |
| Pi matched child resend gap | 7 | 163.35s | 1279.18s | Delivery to next send; one gap >5m, none >1h |
| Pi observed child lifetime | 19 | 111.14s | 3170.19s | First start to last observed result; not disposal time |
| Pi reviewer result seconds | 30 | 30.9s | 178s | Whole review duration; all <5m |
| omp Opus child result seconds | 55 | 505s | 3441s | Whole task; repeated internal requests may keep a 5m entry alive |
| omp Sonnet child result seconds | 14 | 161.5s | 1106s | Same limitation |
| omp Haiku child result seconds | 3 | 57s | 523s | Same limitation |

These small matched samples do not support a precise workload-wide savings estimate. A task lasting longer than
five minutes does not imply cache expiry: real cache hits reset the TTL. Large cached reads and generated output
still consume subscription usage. The data does not identify the cause of the owner's exhausted limits.

## Cost comparison

Pi catalog USD per million tokens, as inspected through `builtinProviders()`:

| Model | Input | Output | 5m write (1.25x) | 1h write (2x) | Read |
| --- | ---: | ---: | ---: | ---: | ---: |
| Opus 5.5 | 4 | 20 | 5 | 8 | 0.20 |
| Sonnet 5.5 | 2 | 10 | 2.5 | 4 | 0.10 |
| Haiku 5.5, <=100k input | 0.1 | 0.5 | 0.125 | 0.2 | 0.01 |

**Catalog discrepancy:** the requested 0.1x read assumption matches Haiku, but Opus/Sonnet catalog reads are
0.05x. Haiku has a higher price tier above 100k input. No catalog prices were changed.

Repricing the exact six-request token counts above, assuming both turns fit within five minutes and have identical
cache hits under either TTL (5m is calculated, not a second live run):

| Session pair | Catalog 5m USD | Catalog 1h USD | Saving with 5m | With requested 0.1x read: 5m / 1h |
| --- | ---: | ---: | ---: | --- |
| Main-like Opus | 0.16571580 | 0.26121180 | 0.09549600 (36.56%) | 0.17207960 / 0.26757560 |
| Child-like Sonnet | 0.08285790 | 0.13060590 | 0.04774800 (36.56%) | 0.08603980 / 0.13378780 |
| Reviewer-like Haiku | 0.00419424 | 0.00652179 | 0.00232755 (35.69%) | 0.00419424 / 0.00652179 |

For a fixed 100k-token Opus prefix, one write costs $0.50 at 5m versus $0.80 at 1h; one catalog read is $0.02.
If a second request arrives after 5m but within 1h, two short writes cost $1.00, versus $0.82 for long write + read.
At the requested 0.1x read rate, the latter is $0.84. Output and genuinely new input are additional in both cases.
The long write premium is 60% over short (short saves 37.5% of long write cost).

For a simple two-request, fixed-prefix decision, let p be the chance of a 5m-to-1h gap. Long wins only when
`p > 0.75 / (1.25 - read_multiplier)`: 62.5% at the Opus/Sonnet catalog read rate, or 65.2% at 0.1x.
This is not a general break-even rule for growing transcripts or repeated resumptions. Catalog USD estimates
are not a measurement of Anthropic subscription quota weighting.

## Official Claude Code and accepted policy

Official documentation, inspected 2026-10-21:

- [Prompt caching: which TTL each request gets](https://code.claude.com/docs/en/prompt-caching#which-ttl-each-request-gets):
  included-usage subscriptions default the main conversation to 1h; other requests to 5m. API/usage-credit billing
  defaults both to 5m. The server controls a small set of helper exceptions.
- [Subagents and the cache](https://code.claude.com/docs/en/prompt-caching#subagents-and-the-cache): subagents build
  their own cache, default to 5m even on subscriptions, and can read it again on resume. This is not cache disabling.
- [TTL controls](https://code.claude.com/docs/en/prompt-caching#choose-the-ttl-yourself): separate main/subagent
  settings and env values, and per-subagent `experimental.cacheTtl` frontmatter. This documents Claude Code,
  not a compatible Pi settings interface.

Anthropic offers only **5m and 1h**, not a 10m or 15m tier. The owner accepted the measured 5m child policy
(quote in [DECISIONS.md](../DECISIONS.md#anthropic-subscription-adapter)).

1. Keep the main **OAuth 1h default** for continuity through human pauses, consistent with the accepted main
   retention decision and Claude Code. It pays more per write; do not infer that 1h is universally cheaper.
2. Use built-in **5m for RQW-agent and RQW-review Anthropic Messages requests**, leaving caching on and warming off.
   Short reviews and ordinary tool loops benefit from reads without buying an unused long lifetime. RQW-agent
   does reuse children on send; the observed occasional >5m resend gap remains a tradeoff, not a claim of no reuse.
3. The child policy is in each extension's own session request wrapper, before the adapter's OAuth default. It
   has no config knob and overrides user env for those requests. Main/generic adapter precedence and unrelated
   providers remain unchanged. No process-wide env write or Pi source patch is used.

The missing historical per-child token telemetry remains a real limit, not permission for unrelated observability
changes or extra subscription probes.
