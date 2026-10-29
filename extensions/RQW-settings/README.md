# RQW-settings

Harness defaults, tool selection and GPT Fast settings.

`setup.ts` applies `setup-profile.json` once to the global Pi settings, so every machine starts like the owner's:
a bridge on Pi 1.4.0's resource loader writes the profile keys (including the theme `RQW-theme`) and the marker
`rqwSetupVersion` in one settings lock, before the interface is built. With the marker present nothing changes, so
later owner changes stay. If an extension or the theme is filtered out, the file is invalid or Pi's shape differs,
nothing is written and a warning appears at session start. Decision `[D-SETTINGS-SETUP]` in `DECISIONS.md`.
Test: `test/extensions/RQW-settings/setup.test.ts`.

Modules and resources live beside `index.ts`; subfolders group needed resources.
