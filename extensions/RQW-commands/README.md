# RQW-commands

This independent extension removes interactive entrances to Pi 1.4.0's `/model`, `/thinking`, `/tree`, `/scoped-models`, `/share` and `/bug`, and to the `builtin:llama.cpp` extension command. It also hides only RQW-session's `/session-deleted` from suggestions; its service invocation still works. Templates and third-party commands are not removed, though Pi's built-in command precedence still applies.

The controls policy disables the four model and thinking cycle actions, including custom bindings, while leaving their keys available to other actions. It hides cache warming, model thinking, double escape and tree filter settings, and limits the logout menu to currently visible providers. Settings and credentials are not changed. Ctrl+T and other actions remain available.

The runtime patches check Pi's shapes and fall back to stock with a warning when incompatible. Disabling this extension restores Pi's previous behavior, subject to other enabled extensions. RPC and SDK inputs are unchanged.

Tests: `test/extensions/RQW-commands/`.
