# RQW-commands

This independent extension removes interactive entrances to Pi 1.4.0's `/model`, `/thinking`, `/tree`, `/scoped-models`, `/share` and `/bug`, and to the `builtin:llama.cpp` extension command. It also hides only RQW-session's `/session-deleted` from suggestions; its service invocation still works. Templates and third-party commands are not removed, though Pi's built-in command precedence still applies.

The runtime patch checks the autocomplete groups and Pi's method shapes before applying the command policy. Incompatible shapes leave commands unchanged and show a warning. Disabling this extension restores Pi's previous behavior, subject to other enabled extensions. RPC and SDK inputs, shortcuts, menus, settings and credentials are unchanged.

Tests: `test/extensions/RQW-commands/`.
