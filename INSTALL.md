# Install my-pi into this Pi

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

Apart from the authorized old adapter replacement above and installing or updating my-pi, change nothing else:
no unrelated packages, settings, credentials or files.

## Model and reasoning shortcuts

For the user, not part of the install. The first Shift+arrow opens a draft chooser already advanced one step:
Shift+Up / Shift+Down select a stronger / weaker model; Shift+Right / Shift+Left select higher / lower reasoning.
Further ordinary or Shift arrows navigate the draft in the same directions. Enter applies both model and reasoning;
Esc closes the chooser without changing the live selection. Opening and navigation also leave the live selection unchanged.
The model order and clamps are in the
[Models decision](DECISIONS.md#models), including the GPT 5.6 Luna addition (the GPT reviewers use it). The keys
need no terminal setup: iTerm2, Terminal.app and the VS Code terminal send them as standard sequences, and Pi 1.4.0
binds none of them itself.

## Unregistered UI sources

The source folders `extensions/RQW-naming/`, `extensions/RQW-theme/`, `extensions/RQW-thinking/` and
`extensions/RQW-tool-ui/` are on main but not registered in `package.json` until UI integration P10.
There is no `pi.themes` entry and no `extensions/RQW-agent-ui/` on main. Normal installation and `pi -e <dir>`
do not enable these sources. See [remaining UI integration](BACKLOG.md#u12). Do not register them during installation.
Package isolation checks cover the registered `pi.extensions` entries, not these source folders.

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
- After `/reload` Pi keeps the active tool set, so tools of a switched-off extension stay active, now Pi's own,
  until `/new` or a restart.
- `pi -e <dir>` ignores this installed-package filter and loads the extensions listed in that directory's package
  manifest, not every source folder. For one run without an extension pass the wanted
  files instead: `pi -e <dir>/extensions/RQW-settings/index.ts -e <dir>/extensions/RQW-prompt/index.ts`. Add `-ne`
  when the installed package must not load as well; it also drops Pi's built-ins, add them back with
  `-e builtin:codemode -e builtin:tool-search`.
- Pi's built-in extensions are not part of the package. Switch one off with the top-level `extensions` setting:
  `"extensions": ["-builtin:codemode"]` (names: `codemode`, `tool-search`, `mcp`, `llama.cpp`).
