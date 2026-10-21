# Install my-pi into this Pi

You are running inside Pi. Install the my-pi package into this Pi installation, then report the result in one short message.

0. Run `pi --version`. The package is built and tested for Pi 1.3.0. If the version differs, tell the user and stop:
   the tools wrap Pi's own tool code, which may change between versions.
1. Run `pi list`. If it already shows `git:github.com/ARQAWA/my-pi`, run `pi update git:github.com/ARQAWA/my-pi` and skip step 2.
2. Run `pi install git:github.com/ARQAWA/my-pi`. It writes the package to `~/.pi/agent/settings.json` under `packages`.
3. Run `pi list` again and check that it shows `git:github.com/ARQAWA/my-pi`.
4. Tell the user to run `/reload` in this session, or to restart Pi, so the package's extensions load. After
   `pi update` in step 1, tell the user to restart Pi: RQW-context patches Pi's classes once per process, so a
   `/reload` keeps its old code.

Change nothing else: no other packages, settings or files.

## Switch one extension off

For the user, not part of the install. Every `RQW-*` extension can be switched off alone. In
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
- `pi -e <dir>` ignores this filter and loads every extension. For one run without an extension pass the wanted
  files instead: `pi -e <dir>/extensions/RQW-settings/index.ts -e <dir>/extensions/RQW-prompt/index.ts`. Add `-ne`
  when the installed package must not load as well; it also drops Pi's built-ins, add them back with
  `-e builtin:codemode -e builtin:tool-search`.
- Pi's built-in extensions are not part of the package. Switch one off with the top-level `extensions` setting:
  `"extensions": ["-builtin:codemode"]` (names: `codemode`, `tool-search`, `mcp`, `llama.cpp`).
