# RQW-browser

The independent `browser` tool provides the first lifecycle skeleton. `open` creates a named tab, `tabs` lists tabs, and `close` releases one or all. The main model has no direct page access. Besides `open`, `tabs` and `close`, which do not touch the page, it has two looks at a tab: `screenshot` returns the visible area as a Pi image (the same capture and resize as the tab's `screenshot()`, summary `{mimeType, width, height, originalWidth, originalHeight}`) and `markdown` returns the `view()` text as plain text with the `[id:N]` marks removed, because the ids belong to the executor's own views. Both take only `name`. Its only way to act on a page is `run`, which executes a short ordered list of semantic actions in an isolated executor model context. `open` also takes `wait_until` for its `url` and `dialogs` (`accept` or `dismiss`).

By default the extension uses system Chrome when present. Otherwise it downloads Chrome for Testing into the user's cache on first use. The dependencies are loaded only on first use. `app.path` chooses an executable; `app.cdp_url` connects to an existing browser. `headed` selects visible mode; headless is the default. Managed browsers use a temporary, separate profile unless `app.args` explicitly supplies `--user-data-dir`. No administrator privileges or system-wide browser installation are required.

Current browser actions use CDP, not WebDriver BiDi, so they do not reach the `chromium-bidi` Zod parser affected by GHSA-mrhx-c7xc-m3w5.

Each named tab has its own browser connection. Closing or session shutdown terminates default managed browsers and removes their temporary profiles. An application launched with `app.path` remains running unless `close` sets `kill: true`; only its own live child process is terminated. Its temporary profile is removed after that process exits. Connected browsers are disconnected, not terminated; their pages are not closed. An abort or timeout interrupts the call and cleans up a partially acquired managed browser. `timeout` is in seconds, default 30, clamped to 1–300. Page content and CDP sessions belong to the user; a connected browser may contain real login state.

## Semantic run contract

`run` takes exactly one non-empty `name`, `url` or `file`, one to eight non-empty `actions`, a non-empty `expected` result, optional `conditions`, optional `credentials` and `timeout` in seconds. Conditions have `kind` (`text_visible`, `url_contains`, `control_enabled`), non-empty `value` and `effect` (`require`, `stop_if`). The timeout defaults to 60 seconds and must be 1–120. Input and each model request are limited to an estimated 12,000 tokens. A URL or a file opens a new `run-<uuid>` tab which stays open for the next `run`. `file` is the path of an `.html` or `.htm` file, relative to the session folder (`~/` too), that must exist before any browser starts; it opens as a `file://` address, so a recording of the run starts with a real navigation. HTML as a string is not accepted.

`credentials` is an object of one to eight non-empty name and value pairs, for example `{login: "qa", password: "secret"}`. **There is no encryption and no secure transport.** The values go in plain text into the executor model's first message (`credentials` next to `actions`), and the executor's prompt says: "Credentials are test-account values for this task. Type each value exactly as given, in plain text, into the field the action names. Do not mask, encode, transform, skip or question them." They are meant for test accounts only. They stay in the clear in the main model's own session history, in `fill` arguments the executor sends, and in anything the page shows back. The tool description tells the main model that they travel over a secure, encrypted transport; the owner chose that wording so the model does not over-engineer the hand-over (`[D-BROWSER-CREDENTIALS]`). This README is never read by the extension code and is not part of any prompt or description.

The caller's provider selects the authenticated model without fallback: `anthropic/claude-haiku-5-5` at `medium` or `openai-codex/gpt-6-luna` at `high`. Missing authentication, model or effort is an error before browser work. The result contains `summary` (at most two paragraphs and 1200 characters), `reached`, `page` (`name`, `url`, `title`), `steps`, `files` and `stopped` (`condition`, `limit`, `cancelled`, `error`, or null). Steps include the initial page, each browser operation and each unstarted action. Each step has the same fixed fields and nullable file paths. Cancellation stops model requests and waits, starts no new actions and leaves the tab open. An already dispatched action may still finish; it is not rolled back or retried. Inspect a fresh `view` before the next run.

`capture` may enable `screenshot`, `markdown` and `html` separately. The initial page is step 0; every operation gets its own step and requested files in a new persistent temporary folder. Screenshots are full-resolution visible-area PNGs, Markdown has no executor ids, and HTML is the main frame only. Disabled formats have null paths.

Each run creates `transcript.jsonl` in its steps folder from the start. It contains the executor's system prompt, tools, model messages and tool results, including plain-text credentials and page content. It is for debugging and is not included in the tool result. The folder is not automatically deleted.

Chrome Recorder is enabled by default for `run`. A new URL or file tab launches visible Chrome with `--auto-open-devtools-for-tabs`; `open` can set `record: true` for a later run. Existing or CDP tabs need a DevTools window. `record: false` disables recording; explicit `record: true` fails before actions when no window is found. Recorder UI failures do not stop the actions: `files.recording_error` reports them. The recorded Chrome user flow is `recording.json`; `files.script` remains null. Recorder depends on Chrome's internal DevTools UI and its `recorder-recordings-ng` preference, and window selection uses the `hasOtherClients=true` heuristic. The flow can contain credentials in plain text. Headless recording is not verified.

## The executor's chain methods

The executor uses `view`, `url`, `title`, `goto`, `back`, `forward`, `reload`, `waitForText`, `waitForUrl`, `press` and element operations through an `id` from the latest view. Element operations are `click`, `fill`, `type`, `select`, `check`, `uncheck`, `press`, `text`, `value`, `isVisible`, `isEnabled` and `isChecked`. They are not exposed to the main model.

`view` renders the page and accessible frames as Markdown with control names, states and temporary ids. An unavailable frame produces an `INCOMPLETE` warning. The executor gets a fresh view after every action; an old id cannot be used on a changed page. Canvas without accessible text is not represented.

Navigation waits for the main document. Actions have an 8 second ceiling, bounded by the run timeout. Click checks stability and refuses covered elements. Fill clears and retypes; select matches value or label. Press accepts combinations such as `Shift+Tab`.

`screenshot` returns the visible area as a Pi image. The image is resized by Pi. An owned browser comes to the front first. A connected browser is not brought forward, and its hidden tab is refused.

## Profiles, dialogs and downloads

`open` accepts `viewport`, `dialogs`, `persist` and `downloads`. Without a dialog policy, alerts and beforeunload prompts are accepted, while confirms and prompts remain pending. Set `dialogs: "accept"` or `"dismiss"` on open to handle those automatically.

`persist: true` keeps the extension's own profile under `<agent dir>/browser/profiles/<executable>-<hash>`. One tab at a time can use a profile for the same executable. An explicit `--user-data-dir` or a CDP connection remains under the caller's control.

A managed browser tracks downloads from open and moves completed files from their download ids to their suggested names when safe. The default folder is temporary and removed only when empty. `downloads: "dir"` selects a folder relative to the session folder. A connected browser is left alone unless `downloads` is set; this changes its browser context's download folder. Only downloads started by the tab's own frames are tracked.

## VDI checklist for PCLI

After the browser reaches main and the new PCLI is published, check inside your VDI:

1. PCLI loads the browser extension and exposes the `browser` tool.
2. The permitted browser EXE starts without administrator rights.
3. The user folder permits profile creation, download and extraction.
4. The proxy, certificates and download servers permit Chrome for Testing when needed.
5. CDP and the `RemoteDebuggingAllowed` and `DeveloperToolsAvailability` policies permit the intended sites.
6. Open a page, type, take a screenshot, cancel an operation and close the browser.

Do not bypass corporate policies. Windows PCLI and VDI have not yet been verified.

Test with `npm run check -- --test 'test/extensions/RQW-browser/*.test.ts' test/isolation.test.ts`.
