# RQW-agent-ui

Display of subagent results in the transcript: a compact card instead of Pi's default `[agent]` box. This folder is
self-contained (no import outside it; only public `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui`
exports) and changes nothing in Pi. It never changes stored messages, details or what the model sees.
No Pi patches, method replacement or wrapping, private fields, component-tree splicing or production deep imports
are allowed. Only public extension and TUI APIs are used.

Current state: agent cards (`card.ts`, `fit.ts`) for ordinary children, including the `spotty` and `bossy`
reviewer profiles. A current result arrives as one hidden automatic message with no card; the `wait` result cards below draw only older stored sessions. The cards for `agent` messages and
`child_wait` notifications stay only for results stored by older versions. Stored `review`, `job`, `code_writer` and
`shell_runner` messages of older sessions have no card and show Pi's stock block (`[D-UI-OLD-CARDS]`). The package registers agent-ui in `pi.extensions`
before RQW-tool-ui. The upper-input activity indicator is not here (RQW-statusbar).

## Wiring (`index.ts`, `wait.ts`, `self.ts`)

A current subagent result reaches the transcript as a hidden automatic message; the `wait` result of the `agent` tool (second item below) exists only in older sessions. The
other two paths below show only results that older versions stored, and each gets the ordinary agent card.
Reviewer profiles use the same cards. Everything is display
only: stored messages, tool results, their details and what the model sees are never changed.

- **Custom message, stored history only** `[<name>#<id>] ...` (type `agent`): `index.ts` registers the card
  with `pi.registerMessageRenderer` for that type. The display details are the message's own `details`
  (`id`, `outcome`, `model`, `thinking`, `seconds`, optional `title`, `prompt_file` and `profile`, beside `delivery`
  and `run`). Profile provenance is `{ name, path, sha256 }`; all three fields stay in stored details, not card text. `prompt_file` provenance (`kind`, absolute `path`, `sha256`) and delivery
  tokens also stay stored but are not card text.
- **`wait` result** of the `agent` tool, stored history only: `index.ts` registers one
  `pi.registerToolRenderer` resolver. For this tool it returns the renderers of whatever comes after it
  (`next()`: another extension's, else the tool's). Without a self shell, only `renderResult` is replaced (`wait.ts`):
  a finished, collapsed call with `action: "wait"` shows one card per delivered result of `details.results[i]`, with that item's
  `display` details (the RQW-agent metadata), its `id` and its `text`. Results without metadata still get a card
  (id from the item, unknown parts omitted). `until: "all"` returns the same `reason: "result"` shape with multiple
  items, so each delivered answer gets a card. The call row, the tool shell and every other call (`start`, `status`,
  `send`, timeouts and receipts without results, errors, partial updates) are left to the next renderer. A wait that returns no
  answer (`interrupted`, `timeout`, `alert`, `target_changed`, receipt) is one short text line and stays stock; wait
  details carry no `statuses` (`[D-AGENT-STATUS]`).
- **`child_wait` notification, stored history only** (`child-wait.ts`): an older `wait` ended through a notification, and RQW-agent
  delivered the result as a custom message `child_wait` whose `details` are the wait result and whose content is the same object as
  JSON text. `index.ts` registers `createChildWaitCard` for it. With `reason: "result"` and at least one
  `results[i]` (`id`, `text`, `outcome`) it shows cards like the other paths: a single result is one card named
  `child_wait · <id>`; several get a summary row `child_wait · N results` (plus `· K failed` in the error color) and one
  indented card per result. The coordinator `outcome` maps `completed` to `finished` and `error` to `failed`; any other
  value shows no status. When an item carries `display`, its model, effort, duration and title
  are rendered like ordinary agent cards; profile provenance stays in stored metadata. Without `display`, only the item ID, mapped outcome and answer are used;
  missing metadata is not invented. Non-result `child_wait` notifications show one short line; Ctrl+O shows their full original text. A child `agent_progress` notice is collapsed to `agent#N progress [click to show]`; a left click shows the whole summary as markdown under the header (not the fixed instructions or the embedded skill), a left click on the card again collapses it. The state is kept per message, a new notice starts collapsed, and clicks need the terminal mouse (also inside a `worked for` fold). Ctrl+O shows the full original text. The model's context is unchanged. Ctrl+O shows the whole answer of every result.
- **Ctrl+O** (expanded tools): custom messages show the full card body. With tool-ui, each wait result shows its
  expanded cards once inside a stock-look box, with the full answer text instead of the raw result JSON. Without
  tool-ui, the existing standalone behaviour stays: expanded waits show the original result text through the next
  renderer or Pi's fallback. Non-result diagnostics always keep the next renderer's view. Images remain entirely
  Pi's responsibility; this extension adds no image rendering.
- **RQW-tool-ui**: load **agent-ui before tool-ui** in `pi.extensions`. Pi resolves in load order, so agent-ui's
  `next()` sees tool-ui's `renderShell: "self"`, which agent-ui preserves. Collapsed calls delegate both renderers
  with their exact contexts: tool-ui keeps the group summary, current live block and zero-row nonleaders. Expanded
  calls still update tool-ui's renderers, but delivered wait results are drawn by agent-ui in a public `Box` using
  Pi's stock call header, output padding and the `toolSuccessBg` role. This is an outer
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

The cards drawn as custom messages (`agent` and `child_wait`) keep
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

A finished answer whose first line is `CLEAN` or `FINDINGS: N` shows its green label or its red `N findings` instead of `finished`;
N is read from that line, never counted in the answer. Without a number (answers of older reviewers) the red label is `findings`, never `0 findings`.

Collapsed, two rows:

```
agent#3 finished · Opus 5.5 md · 42s
  Проверил отступы.
```

- Header: `<name>#<id>`, then the child's short title from `details.title` when RQW-agent supplies it (the caller's
  optional `title`, one line, muted; it gets only the width the rest of the header leaves and is cut with `…`, or left
  out below two cells), then the status `finished` / `failed` from `details.outcome` (nothing when absent, neutral),
  then ` · <model> <effort>` and ` · <seconds>` when `details` supplies them. Unknown or unusable parts are left out; no details at all gives just `agent#3`.
- Model: shown as its picker label, looked up once per model string in the Pi model registry captured at session start (name without `Claude `, e.g. `Sonnet 5.5`, `GPT-6.1 Terra`), in the `text` colour, not bold; an unknown model shows its id without the provider. Effort: the status-bar short label (`no`, `min`, `lo`, `md`, `hi`, `xh`, `mx`). Seconds: `42s`, `12.3s`,
  `1m 05s`.
- Below the header the tail of the answer: its last 400 characters as plain text on one line, indented, cut at the front with `…`.

Expanded (Ctrl+O): the header, then the whole answer wrapped to the width (breaks after the last space that fits,
else inside a word; empty lines kept). Nothing is dropped or added.

Only the outer `[<type>#<id>]` prefix of the content (the card's own type) is recognized and removed; brackets inside
the answer stay. Without a prefix the id comes from `details.id`, else the message type.

Display text has terminal escape sequences and control characters removed and tabs shown as four spaces, because the
text is a model's output and must not reach the terminal as commands; the stored message keeps it as is.

## Colors

Only the supplied Pi theme is painted with semantic colors, nothing hardcoded: header muted, `finished` `success`, `failed` and the answer of
a failed run `error`, seconds `dim`, the model `text`, plain. The effort uses Pi's own per-level theme tokens (`thinkingLow` to `thinkingMax`, the ones that colour the editor border by
level): `low`, `minimal` and `off` `thinkingLow`, plain; `medium` `thinkingMedium`, `high` `thinkingHigh`, `xhigh`
`thinkingXhigh`, `max` `thinkingMax`, all bold. An unknown level is painted like `low`. The exact hue comes from the active theme (in
RQW-theme: green, gold, purple, red).

## Width

Every row is at most the given width; at width 0 nothing is rendered. The tests check widths 8, 40, 60, 80 and 100, with
emoji, combining characters and terminal sequences; width 0 is by code only.

## Tests

Run `npm run check -- --test 'test/extensions/RQW-agent-ui/*.test.ts'` (`card.test.ts` and `notification.test.ts`).
