# RQW-providers

Provider visibility for stock Pi 1.4.0: only `anthropic` and `openai-codex` stay in `/login`, the model selector,
model autocomplete and cycling, `--list-models` and the scoped-model list. Every other builtin provider (including the
new `openai`, "Sign in with ChatGPT") is hidden. It is the owner's rule, its record is [Providers](../../DECISIONS.md#providers).

This is a visibility policy, not a credential access sandbox. Credentials of every provider stay saved in `auth.json`;
explicit SDK lookups and a previously selected hidden model are not erased or silently switched. The extension
registers no provider, tool or command and edits no credential store, setting or file of Pi.

## How it works

Pi 1.4.0 has no hook that hides builtin providers: `pi.unregisterProvider()` only removes extension layers and the
builtins return. So `index.ts` installs a checked, reference-counted, reversible in-memory patch of Pi's exported classes:
`ModelRuntime.getProviders`, `getModels`, `getAvailableSnapshot` and `getAvailable` filter by the allowed set
(`ALLOWED`), and `AgentSession.scopedModels` filters the same way. Nothing in `node_modules` is touched. If a hook is
missing or not configurable, the extension fails to load with `incompatible Pi internals; requires Pi 1.4.0. Nothing was patched.`,
never a partial policy.

The policy applies only to a runtime that has an owning session of this extension. Pi's patched `_bindExtensionCore`
hands every loaded instance the session it was bound to, before the session emits any event, so the policy holds in
`pi --list-models`, after `/reload` and for SDK hosts that never emit `session_start`. Loading the file alone, or a
runtime nobody owns, keeps Pi's own lists. In-process subagents and reviewers share the main runtime, so they see the
same lists; disposing such an unowned child changes nothing. An owner is dropped when its session shuts down, reloads
or is disposed (Pi invalidates its extension API; the extension reads that). Pi 1.4.0 has no shutdown hook for an SDK
`session.dispose()`, so the patch also wraps `AgentSession.dispose` and releases the instances bound to that session.
The last owner restores Pi's methods.

`RQW-anthropic`'s lifecycle wraps the same two methods (`_bindExtensionCore`, `dispose`) and, when its last owner
leaves, puts Pi's own methods back, which removes this extension's wrapper from under it. So every time an instance
loads, `installVisibility` checks that its wrapper is still the one in each slot and wraps again when it is not;
a session bound after that is covered as before. `test/providers-anthropic.test.ts` loads both together.

## Independence

It does not depend on `RQW-anthropic`, nor the other way round: Anthropic's subscription transport (login, recovery,
cache) works with all providers visible, and this extension hides providers with Pi's own `anthropic` and
`openai-codex`. Switch either off alone in `pi config` or with the filter in [INSTALL.md](../../INSTALL.md#switch-one-extension-off)
(`-extensions/RQW-providers/index.ts`), then `/reload` or restart: Pi's own lists return. `test/isolation.test.ts` and
`test/anthropic-models.test.ts` prove each combination.

## Limits

- The default model and `--models` patterns are resolved before the session is bound, so they still see all providers;
  the login and pickers do not.
- Keep the manifest order (this extension after `RQW-anthropic`). Both extensions wrap the same session methods and a
  wrapper can only be taken off from the top. In the manifest order every shutdown, reload and SDK dispose leaves Pi's own
  methods back. In the other order (this extension loaded first) a normal shutdown or reload can leave an inert
  pass-through wrapper of this extension on the class: it filters nothing and only passes calls on.
- Another extension that registers a provider other than the two allowed ones registers it, but it is not listed.

Tests: `extensions/RQW-providers/test/providers.test.ts` (real Pi library and CLI bundle, fake credentials, no network, the
actual `pi --list-models`), `npm test`. Mechanism research: `notes/anthropic-adapter.md`, "Provider visibility".
