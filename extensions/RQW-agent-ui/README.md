# RQW-agent-ui

Display of subagent results in the transcript: a compact card instead of Pi's default `[agent]` box. This folder is
self-contained (no import outside it; only public `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui`
exports) and changes nothing in Pi. It never changes stored messages, details or what the model sees.
No Pi patches, method replacement or wrapping, private fields, component-tree splicing or production deep imports
are allowed. Only public extension and TUI APIs are used.

Current state: the agent card (`card.ts`, `fit.ts`) and its wiring to both ways a result arrives (`index.ts`,
`wait.ts` and `self.ts`, below), plus the review custom-message card (`review.ts`). The package registers it in
`pi.extensions` before RQW-tool-ui. The upper-input activity indicator is not here (RQW-statusbar).

## Wiring (`index.ts`, `wait.ts`, `self.ts`)

A subagent result reaches the transcript in one of two ways, and both get the card. Everything is display
only: stored messages, tool results, their details and what the model sees are never changed.

- **Custom message** `[<name>#<id>] ...` (type `agent`): `index.ts` registers the card
  with `pi.registerMessageRenderer` for that type. The display details are the message's own `details`
  (`id`, `outcome`, `model`, `thinking`, `seconds`, optional `title` and `prompt_file`, beside `delivery` and `run`).
  `prompt_file` provenance (`kind`, absolute `path`, `sha256`) and delivery tokens stay stored but are not card text.
- **`wait` result** of the `agent` tool: `index.ts` registers one
  `pi.registerToolRenderer` resolver. For this tool it returns the renderers of whatever comes after it
  (`next()`: another extension's, else the tool's). Without a self shell, only `renderResult` is replaced (`wait.ts`):
  a finished, collapsed call with `action: "wait"` shows one card per delivered result of `details.results[i]`, with that item's
  `display` details (the RQW-agent metadata), its `id` and its `text`. Results without metadata still get a card
  (id from the item, unknown parts omitted). `until: "all"` returns the same `reason: "result"` shape with multiple
  items, so each delivered answer gets a card. The call row, the tool shell and every other call (`start`, `status`,
  `send`, timeouts and receipts without results, errors, partial updates) are left to the next renderer. `reason:
  "alert"` and `target_changed` are diagnostics and stay stock, including `statuses[].alerts` and `long_turn` alerts.
- **`child_wait` notification** (`child-wait.ts`): when a `wait` ends through a notification, RQW-agent delivers the
  result as a custom message `child_wait` whose `details` are the wait result and whose content is the same object as
  JSON text. `index.ts` registers `createChildWaitCard` for it. With `reason: "result"` and at least one
  `results[i]` (`id`, `text`, `outcome`) it shows cards like the other paths: a single result is one card named
  `child_wait · <id>`; several get a summary row `child_wait · N results` (plus `· K failed` in the error color) and one
  indented card per result. The coordinator `outcome` maps `completed` to `finished` and `error` to `failed`; any other
  value shows no status. The notification carries no model or seconds (`display`), so the cards show none. Timeouts,
  alerts, receipts, `idle` and anything without a delivered result, or unreadable JSON, return `undefined` and stay
  Pi's stock box. Ctrl+O shows the whole answer of every result.
- **Ctrl+O** (expanded tools): custom messages show the full card body. With tool-ui, each wait result shows its
  expanded cards once inside a stock-look box, with the full answer text instead of the raw result JSON. Without
  tool-ui, the existing standalone behaviour stays: expanded waits show the original result text through the next
  renderer or Pi's fallback. Non-result diagnostics always keep the next renderer's view. Images remain entirely
  Pi's responsibility; this extension adds no image rendering.
- **RQW-tool-ui**: load **agent-ui before tool-ui** in `pi.extensions`. Pi resolves in load order, so agent-ui's
  `next()` sees tool-ui's `renderShell: "self"`, which agent-ui preserves. Collapsed calls delegate both renderers
  with their exact contexts: tool-ui keeps the group summary, current live block and zero-row nonleaders. Expanded
  calls still update tool-ui's renderers, but delivered wait results are drawn by agent-ui in a public `Box` using
  Pi's stock call header, output padding and `toolPendingBg` / `toolSuccessBg` / `toolErrorBg` roles. This is an outer
  display branch, not an insertion into tool-ui's private state or components. Alerts, partials, errors, timeouts and
  statuses without results delegate unchanged. Folding again restores tool-ui's current group view, with no extra
  card below it. There are no tool definitions, cross-folder imports or competing subscriptions here. The root
  integration test composes both packages; this folder's tests load only agent-ui.
- **Lifecycle**: there is no session registry. The expanded wrapper keeps only per-call display state in Pi's public
  renderer `context.state`. It subscribes to no event, starts no timer or process and keeps no reference to a session. Pi builds it again for every new session and `/reload`, and the old registrations die with
  the old extension instance, so a session switch or reload leaves nothing stale. Switching it off is Pi's package filter
  and `/reload`: both paths are then Pi's stock view. In `pi config`, exclude
  `extensions/RQW-agent-ui/index.ts` from this package's extension resources, then run `/reload`. Include it again
  and `/reload` to enable it. There is no private toggle or settings write.

## Layout and Markdown (`fit.ts`, `card.ts`)

The cards drawn as custom messages (`agent`, `child_wait`, `review`, and the dev `qa-status`) keep
Pi's output padding: `padded` in `fit.ts` leaves `options.outputPad` cells free at both sides, so a header and its body line up
with the text blocks around the card, collapsed and expanded, and the wrapping uses the narrower width. A width at or below
the padding is drawn without it. Cards inside a tool result are already inside Pi's own box and are not padded again.
The collapsed answer line is rendered by Pi's own `Markdown` component with the card's theme roles, so wrappers such as `**` and
backticks become styling instead of showing as characters; other source characters stay, and the expanded card shows the
original text unchanged.

## The card (`card.ts`)

`createAgentCard` is a Pi `MessageRenderer` for the custom message type `agent`, as
`extensions/RQW-agent` delivers it (content `[<name>#<id>] <text>`). Any other type returns `undefined`, so Pi renders
it as before.

Collapsed, two rows:

```
agent#3 finished · opus medium · 42s
  Проверил отступы.
```

- Header: `<name>#<id>`, then the child's short title from `details.title` when RQW-agent supplies it (the caller's
  optional `title`, one line, muted; it gets only the width the rest of the header leaves and is cut with `…`, or left
  out below two cells), then the status `finished` / `failed` from `details.outcome` (nothing when absent, neutral),
  then ` · <model> <effort>` and ` · <seconds>` when `details` supplies them. Unknown or unusable parts are left out; no
  details at all gives just `agent#3`.
- Model: `anthropic/claude-opus-5-5` shows as `opus`; any other `provider/id` shows as `id`. Seconds: `42s`, `12.3s`,
  `1m 05s`.
- Below the header the first nonempty line of the answer, indented, cut at the end with `…`.

Expanded (Ctrl+O): the header, then the whole answer wrapped to the width (breaks after the last space that fits,
else inside a word; empty lines kept). Nothing is dropped or added.

Only the outer `[<type>#<id>]` prefix of the content (the card's own type) is recognized and removed; brackets inside
the answer stay. Without a prefix the id comes from `details.id`, else the message type.

Display text has terminal escape sequences and control characters removed and tabs shown as four spaces, because the
text is a model's output and must not reach the terminal as commands; the stored message keeps it as is.

## Review card (`review.ts`)

`index.ts` registers `createReviewCard` for custom type `review`. The merged reviewer delivers
`[review#N] <verdict>` with `details.n`, level, model, thinking and seconds. Unlike agents, it has no wait-result
verdict path: the tool returns a start acknowledgement, and the verdict arrives as a custom message. Tool-ui does
not intercept this message renderer. No review policy or producer is changed.

Collapsed: muted ID, verdict, then the first nonempty body line. An exact `CLEAN` verdict line is success;
`CLEAN-ish` and `CLEAN, but` are muted. `FINDINGS:` shows the count of actual `FINDING n` headings, muted.
`UNCHECKED:` adds ` · N unchecked` in warning color, counting its `- ...` entries only. Source quotes and fenced
examples do not contribute headings or entries. `Review failed:` is error; disputes and rulings are otherwise muted.
The colors describe text, not policy acceptance: CLEAN with unchecked evidence still carries the warning.

Ctrl+O shows the entire body, width-wrapped, with only the outer review prefix removed. Inner brackets, blank lines,
Russian and every field remain visible. The same terminal-control sanitization and narrow-glyph limit as agent cards
apply. Stored content and details never change.

Merged-format differences from the execution brief: findings have `REQUIREMENT`, `MISMATCH`, `EVIDENCE` and
`REQUIRED OUTCOME`, followed by `CHECKED:` and optional `UNCHECKED:`. The merged prompt does not produce `DISPUTE`,
`RULING` or `ANSWER`, but such text is preserved if received. `verdictMessage` appends `NEXT[kindOf(...)]` as plain
advice, without a literal `NEXT:` label. The expanded card retains that advice too. Exact CLEAN coloring does not
replace `kindOf`'s stricter structural and evidence checks.

## Colors

Only the supplied Pi theme is painted with semantic colors, nothing hardcoded: header muted, `finished` `success`, `failed` and the answer of
a failed run `error`, model and seconds `dim`. The effort uses Pi's own per-level theme tokens (`thinkingLow` to `thinkingMax`, the ones that colour the editor border by
level): `low`, `minimal` and `off` `thinkingLow`, plain; `medium` `thinkingMedium`, `high` `thinkingHigh`, `xhigh`
`thinkingXhigh`, `max` `thinkingMax`, all bold. An unknown level is painted like `low`. The exact hue comes from the active theme (in
RQW-theme: green, gold, purple, red).

## Width

Every row is at most the given width (0 to 160 is tested with Cyrillic, emoji, wide and combining characters, tabs
and ANSI); at width 0 nothing is rendered.

## Tests

- `node --test extensions/RQW-agent-ui/test/card.test.ts`: the card (pure).
- `node --test extensions/RQW-agent-ui/test/review.test.ts`: review verdicts, source-aware counts, full body, width and purity.
- `node --test extensions/RQW-agent-ui/test/child-wait.test.ts`: the `child_wait` card rows (pure).
- `node --test extensions/RQW-agent-ui/test/wait.test.ts`: the wait cards, the stock view parity, layering, width, purity.
- `node --test extensions/RQW-agent-ui/test/self.test.ts`: a tool-ui-like self shell, exact folded delegation, full
  expanded cards, native box parity, output padding, diagnostics, invalidation and repeated expansion.
- `node --test extensions/RQW-agent-ui/test/wire.test.ts`: Pi's real `InteractiveMode` on a scripted terminal with a
  faux model and only this extension: both delivery paths, Ctrl+O and back, off = stock, `/reload` and a new session
  register the cards again, the extension has no handler or subscription. The delivery shapes are stand-ins for
  RQW-agent's, as its README describes them.
- `node --test test/agent-ui-delivery.test.ts`: the same two paths for `agent` on
  what the real RQW-agent delivers (faux providers, isolated directory), drawn by Pi's exported host components;
  current wait-for-all, status/alert shapes and composition with tool-ui. Also tests merged `verdictMessage` review
  custom messages with both UI extensions independently absent or present, not review tool results.
