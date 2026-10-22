# RQW-models

Independent model picker and shortcuts. Only the listed models (Opus, Sonnet, GPT 6.1 Sol, GPT 6 Sol, GPT 6 Luna,
GPT 5.6 Luna, Haiku) can be selected; a new session starts on Opus medium. List, order, effort lists and the
reasons: [DECISIONS.md, Models](../../DECISIONS.md#models).

## Keys

| Key | Action |
| --- | --- |
| Shift+Up | next stronger model in the list |
| Shift+Down | next weaker model in the list |
| Shift+Right | more reasoning |
| Shift+Left | less reasoning |

Model and reasoning stop at either end (no wrap). From outside the list Shift+Up enters at the strongest model and
Shift+Down at the weakest. A model switch keeps the reasoning level if the new model has it, otherwise the nearest
lower level. The terminal sends Shift+arrow as `CSI 1;2A`..`D` (the Kitty protocol too), so no terminal setup is needed;
Pi 1.4.0 binds none of these keys. `/rqw-models` opens the picker. Tests: `test/models.test.ts`, `npm test`.
