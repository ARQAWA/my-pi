# RQW-statusbar

Terminal footer, editor borders and activity display.

Modules and resources live beside `index.ts`; subfolders group needed resources.

The Pi 1.4.0 runtime patch in `early.ts` decorates the stock editor and footer before startup paints and during session replacement. The usual editor and footer are installed at `session_start`; Git and quotas arrive later. No paint is held. Dialogs, errors and input remain stock. Disabled or incompatible shapes fall back to Pi (`[D-STATUSBAR-STARTUP]`).

## Subscription limits

The folder stays on the left; CX in soft light blue and CC in soft pink-red sit on the right, immediately before the git branch. Narrow rows wrap instead of losing provider limits.
Each provider shows one remaining percent: CX and CC the weekly window.
Providers without stored login credentials are hidden. Unknown values show `???`.
The active footer checks the shared cache immediately and once a minute, independently of model responses.
Files in the system temporary directory under `rqw-quota/` are separate per provider and account.
Codex credentials supply `accountId`; Pi's Anthropic credentials have no account ID, so the refresh token
is the fallback identity. File names use the first 16 hex characters of its SHA-256 hash, never a token.
Files contain only `percent`, `okAt` and `checkedAt`. Tabs reuse each attempt for three minutes;
an exclusive `.lock` file prevents parallel requests. Locks older than 30 seconds are replaced.
Writes use a temporary file and rename; file errors retain the last displayed value.
Failed reads keep the last good percentage; `???` means no good value for this account yet.
Providers without credentials stay hidden. Disabling the footer or closing the session cancels requests
and clears its timer, not the shared cache.

CC checks the stored `anthropic` credential and consumes the existing session-bound `rqw-anthropic:quota:v1` offer when available.
CX uses Pi's public `readStoredCredential` for one-off read-only token reads.
CX reads `https://chatgpt.com/backend-api/wham/usage` with the stored Codex account ID;
it uses the main rate limit window lasting 604800 seconds.
It does not depend on RQW-codex.
Expired OAuth credentials, failed requests and unrecognized response shapes
keep the last good percentage, or show `???` when none is available.
Requests have a five-second deadline. Tokens are never refreshed,
rotated or written; settings and installed packages are untouched. No model calls,
private APIs, cross-extension imports or new dependencies are used.
No live credential or endpoint verification was performed.

## Background warnings

`pi.events` channel `rqw:background-warning:v1` accepts `{ sessionId, text }` for the current session.
A warning appears in the theme's `warning` colour immediately before `cmp` for three seconds.
A new warning replaces it and restarts the timer. It is hidden if the whole text cannot fit beside the existing row.
Switching sessions, disabling the bar or shutting down clears it. The channel has no required producer.

## Background compaction

While the current session's background summary runs, `bg compaction` shimmers in gold after the folder. It shares the existing animation timer and disappears when the request ends or the session changes. The folder and limits retain their existing narrow-row layout.

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
