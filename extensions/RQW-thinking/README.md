# RQW-thinking

Hides the model's reasoning text in the main transcript. Display only: stored messages, the session history and the
model context keep every thinking block unchanged.

- Shown-thinking branch: a public `registerMarkdownTransformer` returns empty Markdown for `assistant-thinking`.
- Hidden-thinking branch: `ctx.ui.setHiddenThinkingLabel("")` on every `session_start` (Pi restores its default label
  on `/reload` and session switches, and `session_start` follows each).
- Pi's own spacer and click-region rows around a thinking block remain; one or two blank rows per model step with
  thinking are an accepted native limit, not a zero-row promise. No Pi patch, no private state.

Off: the stock package resource filter (`pi config`) and `/reload`. Tests: `node --test extensions/RQW-thinking/test/`
(real interactive mode, scripted faux model, isolated temporary folders).
