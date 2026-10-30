# RQW-skill-dollar

Adds Codex-style skill mentions to Pi's input editor.

- Type `$` at the start of a line or after whitespace, including mid-line.
- Skills come from Pi's loaded resources through `pi.getCommands()`.
- Fuzzy suggestions use `ctx.ui.addAutocompleteProvider()` and keep every match selectable.
- Only active `$` suggestions change the live editor's public `setAutocompleteMaxVisible()` value. Overflow uses three items plus Pi's scroll row; four or fewer matches use up to four item rows. The previous height is restored for slash, file, and other autocompletes.
- Selecting a suggestion inserts `$skill-name` at the active token.
- On interactive submit, every valid mention is read and formatted exactly like Pi's native skill block through the `input` transform. Multiple blocks share one submission, duplicates are included once, and unknown dollar tokens stay unchanged.
- A submitted message with skills shows them as one line at the bottom of the user card, `└ skill  a · b`, instead of Pi's separate blue block, wrapped when long; Ctrl+O shows the text of every skill under it, in the same card. This patches Pi's component prototypes at runtime (not a public API); if Pi changes, stock rendering stays. See `[D-UI-SKILL-CARD]` in `DECISIONS.md`.

- Same-name skills (offered by a filter) are all listed, with their paths. `$name` takes the first in the filter's order; a Codex link `[$name](skill://path)` takes exactly that path, and the suggestion for each later skill of a name inserts such a link. A link to an unknown path stays text.

Skill cards use Pi's selected theme before `session_start`. During a session replacement, the old cards keep their appearance until the new history is built. If the extension is disabled, that new history uses stock rendering. The runtime hooks are limited to Pi 1.4.0 and fall back to stock on an incompatible shape.

The extension never replaces the editor or its factory. Stock and RQW-statusbar factory identities stay intact across statusbar toggles.

Optional filter: another extension may answer the `pi.events` channel `rqw-skill-dollar:filter` with `offer(filter)`,
where `filter(skills)` returns the skills that may be listed and expanded. A skill it drops is neither suggested nor
expanded. Without an offer the behaviour above is unchanged.
