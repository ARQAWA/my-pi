# RQW-statusbar

Terminal footer, editor borders and activity display.

Modules and resources live beside `index.ts`; subfolders group needed resources.

The Pi 1.4.0 runtime patch in `early.ts` decorates the stock editor and footer before startup paints and during session replacement. The usual editor and footer are installed at `session_start`; Git and quotas arrive later. No paint is held. Dialogs, errors and input remain stock. Disabled or incompatible shapes fall back to Pi (`[D-STATUSBAR-STARTUP]`).

## Subscription limits

The folder stays on the left; CXC and CX in soft light blue and CC in soft pink-red sit on the right, immediately before the git branch. Narrow rows wrap instead of losing provider limits.
Each provider shows one remaining percent: CX and CC the weekly window.
CXC, shown before CX, is the Codex credits balance as Codex shows it: whole credits with a dot between thousands
(`10.000`), or `Unlimited`. It comes from the same CX request. No credits means no CXC block;
stale data gets the same `*` star as the percent.
Providers without stored login credentials are hidden. Unknown values show `???`.
The git branch keeps one colour; only the marks `*`, `+` and `?` after it carry the state colours.
A git or quota refresh that changes nothing asks for no repaint.
The active footer checks the shared cache immediately and once a minute, independently of model responses.
Files in the system temporary directory under `rqw-quota/` are separate per provider and account.
Codex credentials supply `accountId`; Pi's Anthropic credentials have no account ID, so the refresh token
is the fallback identity. File names use the first 16 hex characters of its SHA-256 hash, never a token. The Codex file is `CX-credits-<hash>.json`:
older releases still running in other tabs write `CX-<hash>.json` without credits and would otherwise erase CXC.
Files contain only `percent`, `credits` (raw digits or `Unlimited`), `okAt` and `checkedAt`. Tabs reuse each attempt for three minutes;
an exclusive `.lock` file prevents parallel requests. Locks older than 30 seconds are replaced.
Writes use a temporary file and rename; file errors retain the last displayed value.
Failed reads keep the last good percentage with a `*` directly before the number, in the same colour (`CX *77%`);
the next good read removes the star. `???` means no good value for this account yet.
The star shows when the last attempt (`checkedAt`) is newer than the last good value (`okAt`).
Providers without credentials stay hidden. Disabling the footer or closing the session cancels requests
and clears its timer, not the shared cache.

CC checks the stored `anthropic` credential and consumes the existing session-bound `rqw-anthropic:quota:v1` offer when available.
CX uses Pi's public `readStoredCredential` for one-off read-only token reads.
CX reads `https://chatgpt.com/backend-api/wham/usage` with the stored Codex account ID;
it uses the main rate limit window lasting 604800 seconds.
It does not depend on RQW-codex.
Expired OAuth credentials, failed requests and unrecognized response shapes
keep the last good percentage marked with `*`, or show `???` when none is available.
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

While Main is active, its thinking or tool text includes active agents and background processes.
After Main finishes, running background work remains visible, for example
`Waiting for 2 agents, 1 background process`. Reviewer profiles are ordinary agents.

RQW-agent supplies the agent tree and counts active agents and child processes. RQW-tools counts Main's
background processes. Both use public `pi.events` v1 running-count sources, with optional process counts and agent lists.
Every agent is listed below the activity text with its title and state. Nested agents are indented.
Idle and AFK agents are dim and excluded from the active count. At full idle the dim list stays visible
without an activity line. Agent rows are cached by width, list and theme.

RQW-send-now's Esc key hint (for example `esc esc to stop background`) is drawn dim italic two spaces right of the
activity text, taken from its `rqw:activity-hint:offer` source on `pi.events`; nothing is imported. It is left out when
it does not fit whole and beside Pi's own retry and summary text (they carry their key).
Without RQW-send-now or with the status bar off no hint is drawn. The painted hint is cached per text and theme.

At genuine idle there is no activity line. Contract and owner sources: [Status bar](../../DECISIONS.md#status-bar).
Source protocol: [Running-count contract](../RQW-agent/README.md#contract-for-p6).
