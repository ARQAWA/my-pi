# RQW-agent-ui

Display of subagent results in the transcript: a compact card instead of Pi's default `[agent]` box. This folder is
self-contained (no import outside it; only public `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui`
exports) and changes nothing in Pi. It never changes stored messages, details or what the model sees.
No Pi patches, method replacement or wrapping, private fields, component-tree splicing or production deep imports
are allowed. Only public extension and TUI APIs are used.

Current state: agent cards (`card.ts`, `fit.ts`) for ordinary children, including the `spotty` and `bossy`
reviewer profiles, on `agent` messages, `wait` results and `child_wait` notifications. The `review` custom-message
card (`review.ts`) remains only for legacy stored history. The package registers agent-ui in `pi.extensions`
before RQW-tool-ui. The upper-input activity indicator is not here (RQW-statusbar).

## Wiring (`index.ts`, `wait.ts`, `self.ts`)

A current subagent result reaches the transcript through the three delivery paths below, and each gets the
ordinary agent card. Reviewer profiles use these same paths, not the legacy review card. Everything is display
only: stored messages, tool results, their details and what the model sees are never changed.

- **Custom message** `[<name>#<id>] ...` (type `agent`): `index.ts` registers the card
  with `pi.registerMessageRenderer` for that type. The display details are the message's own `details`
  (`id`, `outcome`, `model`, `thinking`, `seconds`, optional `title`, `prompt_file` and `profile`, beside `delivery`
  and `run`). Profile provenance is `{ name, path, sha256 }`; all three fields stay in stored details, not card text. `prompt_file` provenance (`kind`, absolute `path`, `sha256`) and delivery
  tokens also stay stored but are not card text.
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
  value shows no status. When an item carries `display`, its model, effort, duration and title
  are rendered like ordinary agent cards; profile provenance stays in stored metadata. Without `display`, only the item ID, mapped outcome and answer are used;
  missing metadata is not invented. Non-result `child_wait`, `agent_progress` and `job` notifications show one short line; Ctrl+O shows their full original text. Ctrl+O shows the whole answer of every result.
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
  card below it. There are no tool definitions, cross-folder imports or competing subscriptions here.
- **Lifecycle**: there is no session registry. The expanded wrapper keeps only per-call display state in Pi's public
  renderer `context.state`. It subscribes to no event, starts no timer or process and keeps no reference to a session. Pi builds it again for every new session and `/reload`, and the old registrations die with
  the old extension instance, so a session switch or reload leaves nothing stale. Switching it off is Pi's package filter
  and `/reload`: both paths are then Pi's stock view. In `pi config`, exclude
  `extensions/RQW-agent-ui/index.ts` from this package's extension resources, then run `/reload`. Include it again
  and `/reload` to enable it. There is no private toggle or settings write.

## Layout and cache (`fit.ts`, `card.ts`)

The cards drawn as custom messages (`agent`, `child_wait` and legacy `review`) keep
Pi's output padding: `padded` in `fit.ts` leaves `options.outputPad` cells free at both sides, so a header and its body line up
with the text blocks around the card, collapsed and expanded, and the wrapping uses the narrower width. A width at or below
the padding is drawn without it. Cards inside a tool result are already inside Pi's own box and are not padded again.
The collapsed answer line is plain text of the last 400 characters of the answer, on one line, cut at the front with `…`.
No Markdown is parsed, so `**` and backticks show as written, and the rest of the answer is not read. Each card keeps its rows for
the last width (`cached` in `fit.ts`), so a repeat frame of an unchanged card costs nothing; `invalidate` drops them.
The expanded card shows the original text unchanged and is drawn only when the user expands it.
Owner: «Вообще не надо отрисовывать. [...] для их отрисовки тебе не надо весь текст, тебе надо только конец текста.»

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
  then ` · <model> <effort>` and ` · <seconds>` when `details` supplies them. Unknown or unusable parts are left out; no details at all gives just `agent#3`.
- Model: `anthropic/claude-opus-5-5` shows as `opus`; any other `provider/id` shows as `id`. Seconds: `42s`, `12.3s`,
  `1m 05s`.
- Below the header the tail of the answer: its last 400 characters as plain text on one line, indented, cut at the front with `…`.

Expanded (Ctrl+O): the header, then the whole answer wrapped to the width (breaks after the last space that fits,
else inside a word; empty lines kept). Nothing is dropped or added.

Only the outer `[<type>#<id>]` prefix of the content (the card's own type) is recognized and removed; brackets inside
the answer stay. Without a prefix the id comes from `details.id`, else the message type.

Display text has terminal escape sequences and control characters removed and tabs shown as four spaces, because the
text is a model's output and must not reach the terminal as commands; the stored message keeps it as is.

## Legacy review card (`review.ts`)

`index.ts` retains `createReviewCard` for custom type `review` only to render legacy stored history from older
sessions. It recognizes the stored `[review#N] <verdict>` prefix, with `details.n` as an ID fallback. Tool-ui does
not intercept this message renderer. It starts no reviewer and is not a current verdict producer.

Current `spotty` and `bossy` reviewers are ordinary profiled agents. Their results use the `agent`, `wait` and
`child_wait` cards described above, with `profile: { name, path, sha256 }` in display details when supplied;
they do not create standalone `review` messages or use this legacy verdict summary.

Collapsed: muted ID, verdict, then the first nonempty body line. An exact `CLEAN` verdict line is success;
`CLEAN-ish` and `CLEAN, but` are muted. `FINDINGS:` shows the count of actual `FINDING n` headings, muted.
`UNCHECKED:` adds ` · N unchecked` in warning color, counting its `- ...` entries only. Source quotes and fenced
examples do not contribute headings or entries. `Review failed:` is error; disputes and rulings are otherwise muted.
The colors describe text, not policy acceptance: CLEAN with unchecked evidence still carries the warning.

Ctrl+O shows the entire body, width-wrapped, with only the outer review prefix removed. Inner brackets, blank lines,
Russian and every field remain visible. The same terminal-control sanitization and narrow-glyph limit as agent cards
apply. Stored content and details never change.

Stored findings may contain `REQUIREMENT`, `MISMATCH`, `EVIDENCE` and `REQUIRED OUTCOME`, followed by `CHECKED:`
and optional `UNCHECKED:`. Expanded cards retain all stored fields and appended advice, including dispute, ruling
or answer text when present. The renderer generates no advice and performs no review acceptance or coverage check;
its colors and counts describe only the stored text.

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

Run `node --test test/extensions/RQW-agent-ui/card.test.ts`.
