# Install my-pi into this Pi

## Windows through ARQAWA PCLI

PCLI bundles Pi and my-pi. Install or update the VS Code extension, then open `Pi CLI: New Tab`.
Do not run the manual package installation below inside PCLI. Loading the bundled package needs no Git command
or GitHub access. The existing Git Bash launch prerequisite remains.
At build time the VSIX takes the public repository's `main` head, recorded in `my-pi/.revision`.
The extension manages only my-pi's package source in Pi settings, preserving its resource filters,
unrelated settings, packages and authentication. Close old tabs and open a new tab after updating PCLI.
Login remains `/login` inside Pi. Real VDI launch is not verified by synthetic tests.

To update only my-pi without a new PCLI release, use Ctrl+Shift+P -> `Pi CLI: Update`.
It downloads the latest public `ARQAWA/my-pi` `main` archive over HTTPS, without Git or npm.
Existing libraries are reused only when dependency names and versions match, regardless of key order.
Changed dependencies leave the current copy untouched and ask you to update the VS Code extension instead.
Successful updates activate an immutable managed copy for new tabs; old copies stay for running tabs.
Open a new Pi tab after the success notification. Pi itself stays pinned until PCLI is updated.
A crashed extension host does not leave a persistent update lock.
The command changes no settings or authentication; opening the new tab preserves the package filters.
A later PCLI version starts from its newly bundled package instead of an older managed override.

## Manual installation outside PCLI

You are running inside Pi. Install the my-pi package into this Pi installation, then report the result in one short message.

0. Run `pi --version`. The package is built and tested for Pi 1.4.0. If the version differs, tell the user and stop:
   the tools wrap Pi's own tool code, which may change between versions.
0.1. Run `pi list` and inspect enabled extensions in personal and project scope with `pi config`, plus any explicit
   `-e` arguments. If `git:github.com/edxeth/pi-claude-auth` is installed, run
   `pi remove git:github.com/edxeth/pi-claude-auth` in its installed scope, adding `--local` for a project install.
   This known adapter replacement is authorized; do not ask for confirmation. Preserve `auth.json` and all unrelated
   packages and settings. RQW-anthropic must run as the only Anthropic adapter. Omit any old adapter's explicit `-e`
   arguments on the next launch; do not edit other projects' scripts. If another competing adapter is enabled,
   stop and ask the owner to disable it. Migration and the opt-out filter are in
   `extensions/RQW-anthropic/README.md`.
1. Run `pi list`. If it already shows `git:github.com/ARQAWA/my-pi`, run `pi update git:github.com/ARQAWA/my-pi` and skip step 2.
2. Run `pi install git:github.com/ARQAWA/my-pi`. It writes the package to `~/.pi/agent/settings.json` under `packages`.
3. Run `pi list` again and check that it shows `git:github.com/ARQAWA/my-pi`.
4. Tell the user to run `/reload` in this session, or to restart Pi, so the package's extensions load. After
   `pi update` in step 1, tell the user to restart Pi: RQW-context patches Pi's classes once per process, so a
   `/reload` keeps its old code.

Apart from the authorized old adapter replacement above, installing or updating my-pi and the one-time setup profile
below, change nothing else: no unrelated packages, settings, credentials or files.

The first start after install applies the setup profile once: RQW-settings writes the keys of
`extensions/RQW-settings/setup-profile.json`, including `theme: "RQW-theme"`, and the marker `rqwSetupVersion` to the
global `~/.pi/agent/settings.json`, before Pi builds its interface. Packages, credentials and all other keys stay as
they were. Later changes by the owner stay; the profile is not applied again. If an extension or the theme of this
package is switched off or filtered, or the file is not valid JSON, nothing is written and Pi shows a warning at
start; fix the cause and restart Pi. Reload alone does not apply a profile that failed before.

## History editing

Double Escape opens your messages for editing. Enter on the edited text permanently cuts the current session history. Escape cancels. `/fork` is unchanged. Disable this feature independently with `-extensions/RQW-history-edit/index.ts`. Details: [RQW-history-edit](extensions/RQW-history-edit/README.md).

## Model and reasoning shortcuts

For the user, not part of the install. The first Shift+arrow opens a draft chooser already advanced one step:
Shift+Up / Shift+Down select a stronger / weaker model; Shift+Right / Shift+Left select higher / lower reasoning.
Further ordinary or Shift arrows navigate the draft in the same directions. Enter applies both model and reasoning;
Esc closes the chooser without changing the live selection. Opening and navigation also leave the live selection unchanged.
The model order and clamps are in the
[Models decision](DECISIONS.md#models), including the GPT 5.6 Luna addition. The keys
need no terminal setup: iTerm2, Terminal.app and the VS Code terminal send them as standard sequences, and Pi 1.4.0
binds none of them itself.

## Compact interface and theme

Normal package loading enables compact tool display, agent cards and automatic session naming. Reviewer profiles `spotty` and `bossy` deliver ordinary `agent#N` results and use the same agent
cards and agent count category as other subagents. Standalone `[review#N]` cards remain only for legacy session
history, not current reviewer delivery. With both agent-ui and tool-ui loaded, a collapsed wait result is tool-ui's (`Waited for N agents` in the summary, `wait <ids>` in the live block);
with tool-ui off, agent-ui shows its collapsed wait cards. Ctrl+O shows full original tool and agent results,
including agent-ui's expanded wait cards, and folds back. Native thinking spacer rows remain and stock image
output is unchanged.

Naming runs in the background after the first user message and each successful compaction, using all available
context. It generates ten candidates and automatically chooses the best by meaning. Generated names have at most
four words and 32 Unicode code points; invalid names are rejected, not shortened. The model is
`anthropic/claude-haiku-5-5`, falling back to authenticated `openai-codex/gpt-6-luna`, at its lowest supported reasoning.
An initial failed attempt gets up to three retries, then a warning preserves the old name. `/rename-gen` regenerates.
Native `/name` still works; only the next automatic trigger or `/rename-gen` may replace a manual name.
RQW-statusbar shows the current native name as a static gold title above the input.

The theme `RQW-theme` is activated by the setup profile; no manual step. Change it later through `/settings` -> Theme;
Pi saves the choice and the profile does not override it. Disabling a UI extension does not restore a previous theme.
The theme is an independent `pi.themes` resource.

## Switch one extension off

For the user, not part of the install. Every registered package extension can be switched off alone. In
`~/.pi/agent/settings.json`, replace the string entry of the package with its object form and list one `-` line per
extension to switch off. The `source` stays exactly as it was; the pattern must name the file `index.ts`, a folder
excludes nothing.

```json
{
  "packages": [
    {
      "source": "git:github.com/ARQAWA/my-pi",
      "extensions": ["-extensions/RQW-context/index.ts"]
    }
  ]
}
```

- It takes effect after `/reload` or a restart. To switch the extension on again, delete its line.
- The streaming placeholder «ответ готовится» switches off alone with `-extensions/RQW-live-tail/index.ts`.
- The compact UI switches independently with `-extensions/RQW-tool-ui/index.ts`,
  `-extensions/RQW-agent-ui/index.ts` and `-extensions/RQW-naming/index.ts`, one exclusion per extension.
  Tool-ui off restores stock old and new tool calls, except that agent-ui then shows its collapsed wait cards;
  agent-ui off restores stock agent results, including reviewer-profile results, and stock rendering of legacy review
  history; naming off stops automatic generation and removes `/rename-gen`, leaving the persisted native name and `/name`.
  The separate activity indicator and static title belong to RQW-statusbar, switched with
  `-extensions/RQW-statusbar/index.ts` or `/statusbar off`; cards do not own that indicator. It shows the actual
  running agent counts, including reviewer profiles, with no separate review category; ordinary busy letters shimmer
  silver, compaction shimmers gold, and a
  fully idle rule is continuous.
- After `/reload` Pi keeps the active tool set, so tools of a switched-off extension stay active, now Pi's own,
  until `/new` or a restart.
- `pi -e <dir>` ignores this installed-package filter and loads the extensions listed in that directory's package
  manifest, not every source folder. For one run without an extension pass the wanted
  files instead: `pi -e <dir>/extensions/RQW-settings/index.ts -e <dir>/extensions/RQW-prompt/index.ts`. Add `-ne`
  when the installed package must not load as well; it also drops Pi's built-ins, add them back with
  `-e builtin:codemode -e builtin:tool-search`.
- Pi's built-in extensions are not part of the package. Switch one off with the top-level `extensions` setting:
  `"extensions": ["-builtin:codemode"]` (names: `codemode`, `tool-search`, `mcp`, `llama.cpp`).

## Web search and URL reading

Normal package loading exposes the independent `web` tool to the main agent and subagents on macOS and Windows.
It uses the saved Codex subscription login read-only; no API key or second login is needed. Missing or expired login:
use Pi to refresh it or run `/login openai-codex`, then retry. Model and thinking follow the caller automatically;
unknown models use `openai-codex/gpt-6.1-sol` with `low`. Each search spends subscription usage.

The tool batches `queries` or reads `urls` with a `focus`, returns short sourced summaries, and supports `mode: live`
for fresh facts. Overflow is an ordinary OS temporary file with exact continuation. Disable independently with
`-extensions/RQW-web/index.ts`, then reload or restart. Existing child sessions keep their startup tools until restarted.
The local shell command is not globally installed. Full contract: [RQW-web README](extensions/RQW-web/README.md).

## Codex subscription transport

RQW-codex targets stock Pi 1.4.0 and Codex CLI stable 0.163.0. Its native `generate:false` startup and automatic one-shot idle prewarm are the explicit Codex exception to the general no-cache-warming rule; no host event or extra setting is required, and no periodic keepalive is installed. Keep a valid existing `openai-codex` login; new `/login openai-codex` logins use device code only. Do not export tokens, import `~/.codex`, copy the different `openai` grant, or configure API-key billing. If another Codex adapter is enabled, stop and ask the owner to disable it in its installed scope before loading this overlay; preserve credentials and unrelated settings.

Disable independently with `-extensions/RQW-codex/index.ts` using the package filter above; re-enable by removing that line, then reload/restart. Compaction is stock Pi summary compaction through the Codex transport, with no native `compaction_trigger`: every original entry stays in the session file, but the active context is Pi's summary plus the kept tail, also for other providers and with RQW-codex disabled. RQW-context still owns the W/R trigger. Provider hiding belongs to the independent [RQW-providers](extensions/RQW-providers/README.md), not to either subscription transport; it is not a dependency of this adapter. GPT Fast remains `/fast-gpt`, default off, owned by RQW-settings, with existing child inheritance.

No native `/models` requests: wire capabilities are pinned offline; unknown model capabilities fail clearly without changing the picker. Pin upgrades require manual protocol review. Full contract, support boundary and verification limits: [RQW-codex README](extensions/RQW-codex/README.md), [decision and exception ledger](DECISIONS.md#codex-subscription-transport).
