# RQW-prompt

System prompt replacement and environment context.

`rqw-prompt:startup-projection` synchronously fills cloned normalized prompt options with the same prefix used at startup, unless a custom or forced prompt is already present. On failure it sets `error` without writing the prefix. With no subscriber, callers keep Pi's stock prompt. RQW-codex, RQW-predictions and RQW-btw read it: each clones its normalized options, emits the request and uses the prompt built from them. Two other extensions also subscribe to the channel and change the same options: RQW-tools writes its tool sections and RQW-codex-compat appends the Codex context. Both skip a request that already carries `error`.

Modules and resources live beside `index.ts`; subfolders group needed resources.
