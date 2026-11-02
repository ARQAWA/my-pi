# RQW-theme

The `RQW-theme` colour theme for Pi 1.4.0, one asset: `theme.json`. It uses only Pi's native theme tokens.
The owner's decisions are recorded in [Theme](../../DECISIONS.md#theme).

**Registration.** `package.json` lists the theme in `pi.themes`. RQW-settings selects `RQW-theme` once on first start
(`[D-SETTINGS-SETUP]`); Pi persists the choice across reload and restart, and `/settings` -> Theme switches it later.
Dialog and list accents use gold (`#c9a227`).

## Card backgrounds

The three card surfaces are direct hex values of option C on the comparison page:

| Token | Card | Colour |
| --- | --- | --- |
| `toolPendingBg` | running tool | `#222222` dark grey |
| `toolSuccessBg` | finished tool | `#062b29` turquoise |
| `toolErrorBg` | failed tool | `#351c22` dark red |

Agent answers (custom messages) have no background: `customMessageBg` is empty and `customMessageLabel` is gold.
All three cards have about the same OKLCH lightness, 26 %.

No other token reuses these values. The export info panel `infoBg` keeps `panel` and selected rows keep `cardHi`.
User messages use `userMessageBg` `#36312c`; `muted` is `#b8b3aa` and `dim` is `#96918a`.
These are direct values; the shared `card`, `smoke` and `steel` variables stay unchanged.

## Thinking greens

`thinkingLow` is `#80ffc4`: the previous medium green `#00ff88` mixed halfway toward white in RGB,
rounded to bytes. `thinkingMedium` is `#00df77`, a deeper green at effectively the same hue.
The previous medium already had maximum HSL/HSV saturation; the richer appearance comes from darkening,
not a numerical saturation increase. Native thinking roles share these colours wherever used, including the
model/effort chooser's selected row. Muted neighbours, low's normal weight and other levels stay unchanged.
The shared `readoutGreen` variable stays `#00ff88`, so unrelated green roles do not change.

## Tests

Tests: `test/extensions/RQW-theme/schema.test.ts`.
