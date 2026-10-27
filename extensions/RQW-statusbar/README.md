# RQW-statusbar

Terminal footer, editor borders and activity display.

Modules and resources live beside `index.ts`; subfolders group needed resources.

## Subscription limits

The folder stays on the left; CX in gold, KM in platinum and CC in bronze sit on the right, immediately before the git branch. Narrow rows wrap instead of losing provider limits.
Each provider shows one remaining percent: CX and CC the weekly window, KM the monthly total.
Unknown values show `unavailable`.
The active footer requests fresh snapshots immediately and every five minutes, independently
of model responses. Disabling the footer or closing the session cancels requests and clears its timer.
Failed refreshes replace old percentages with `unavailable`.

CC consumes the existing session-bound `rqw-anthropic:quota:v1` offer when available.
CX and KM use Pi's public `readStoredCredential` for one-off read-only token reads.
CX reads `https://chatgpt.com/backend-api/wham/usage` with the stored Codex account ID;
it uses the main rate limit window lasting 604800 seconds.
KM reads `https://api.kimi.com/coding/v1/usages` and uses `limit_month_total`. Neither depends on RQW-codex.
Missing or expired OAuth credentials, failed requests and unrecognized response shapes
show `unavailable`. Requests have a five-second deadline. Tokens are never refreshed,
rotated or written; settings and installed packages are untouched. No model calls,
private APIs, cross-extension imports or new dependencies are used.
No live credential or endpoint verification was performed.

## Effort colour

The footer resolves all seven thinking levels through the supplied Pi theme's
`Theme.getThinkingBorderColor`, the same `thinking*` roles used by the model/effort picker.
It has no separate effort palette. Existing labels and bold levels stay unchanged.
The picker, theme palette, animation and other footer colours do not change.

## Activity and waits

While Main is active, retain its existing thinking or tool activity text and agent-count suffix.
After Main's full answer and run completion, pending work remains visible, for example
`Waiting for 2 agents, 1 background process`. The two categories are agents and background processes;
reviewer profiles are ordinary agents, with no worker or separate review category.

RQW-agent counts active logical assignments, pending sends or native activity recursively. A native-idle
child waiting for its jobs or children still counts, and its active descendant counts separately.
Completed undelivered results count zero. RQW-tools independently counts only Main's actual background jobs,
not child jobs again. Both producers use public `pi.events` v1 running-count sources; the consumer accepts
missing `backgroundProcesses` from older v1 sources as zero. Either producer may be disabled alone.

At genuine idle there is no activity line. This changes no visuals, timing, colours, agent lists, cards,
settings or dependencies. Contract and owner sources: [Status bar](../../DECISIONS.md#status-bar).
Source protocol: [Running-count contract](../RQW-agent/README.md#contract-for-p6).
