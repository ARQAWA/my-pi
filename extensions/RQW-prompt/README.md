# RQW-prompt

System prompt replacement and environment context.

`rqw-prompt:startup-projection` synchronously fills cloned normalized prompt options with the same prefix used at startup, unless a custom or forced prompt is already present. On failure it sets `error` without writing the prefix. With no subscriber, callers keep Pi's stock prompt. RQW-codex, RQW-predictions and RQW-codex-compat consume this projection.

Modules and resources live beside `index.ts`; subfolders group needed resources.
