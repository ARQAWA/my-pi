# RQW-skill-dollar

Adds Codex-style skill mentions to Pi's input editor.

- Type `$` at the start of a line or after whitespace, including mid-line.
- Skills come from Pi's loaded resources through `pi.getCommands()`.
- Fuzzy suggestions use `ctx.ui.addAutocompleteProvider()` and keep every match selectable.
- Only active `$` suggestions change the live editor's public `setAutocompleteMaxVisible()` value. Overflow uses three items plus Pi's scroll row; four or fewer matches use up to four item rows. The previous height is restored for slash, file, and other autocompletes.
- Selecting a suggestion inserts `$skill-name` at the active token.
- On interactive submit, every valid mention is read and formatted exactly like Pi's native skill block through the `input` transform. Multiple blocks share one submission, duplicates are included once, and unknown dollar tokens stay unchanged.
- A submitted message with skills shows them as one line at the bottom of the user card, `└ skill  a · b`, instead of Pi's separate blue block, wrapped when long; Ctrl+O shows the text of every skill under it, in the same card. This patches Pi's component prototypes at runtime (not a public API); if Pi changes, stock rendering stays. See `[D-UI-SKILL-CARD]` in `DECISIONS.md`.

The extension never replaces the editor or its factory. Stock and RQW-statusbar factory identities stay intact across statusbar toggles.
