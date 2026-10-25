# RQW-theme

The `RQW-theme` colour theme for Pi 1.4.0, one asset: `theme.json`. It uses only Pi's native theme tokens.
The owner's decisions are recorded in [Theme](../../DECISIONS.md#theme).

**Registration.** `package.json` lists the theme in `pi.themes`. Select `RQW-theme` once through `/settings` ->
Theme; Pi persists the choice across reload and restart, and the same selector switches back.

## Card backgrounds

The four card surfaces are direct hex values of option C on the comparison page:

| Token | Card | Colour |
| --- | --- | --- |
| `toolPendingBg` | running tool | `#222222` dark grey |
| `toolSuccessBg` | finished tool | `#062b29` turquoise |
| `toolErrorBg` | failed tool | `#351c22` dark red |
| `customMessageBg` | agent answer (custom message) | `#192538` slate |

All four have the same OKLCH lightness, about 26 %. Text contrast on the surfaces is at least 4.56:1 (the muted
output text `#8d8d8c` on the turquoise), the main text `#d6d6dd` stays above 10:1.

No other token reuses these values. The export info panel `infoBg` keeps `panel`, selected rows keep `cardHi`,
user messages keep `card`.

## Tests

`test/extensions/RQW-theme/schema.test.ts` checks the asset against Pi's theme schema and pins the four card backgrounds.
