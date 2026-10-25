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
Each owner releases only its own lifecycle layers; after the last cooperating owner leaves, Pi's exact methods are restored.

Session lifecycle methods cooperate with RQW-anthropic, RQW-settings and RQW-codex through the shared
`rqw:method-chain/v1` lease contract, copied inside each extension without cross-folder imports. Wrappers read their
inner link at call time; release removes only the departing owner's layers and preserves surviving owners. A layer
that is still reachable is reused rather than wrapped again. Package-level integration tests are
`test/providers-anthropic.test.ts` and `test/codex-providers.test.ts`.

## Independence

It does not depend on `RQW-anthropic`, nor the other way round: Anthropic's subscription transport (login, recovery,
cache) works with all providers visible, and this extension hides providers with Pi's own `anthropic` and
`openai-codex`. Switch either off alone in `pi config` or with the filter in [INSTALL.md](../../INSTALL.md#switch-one-extension-off)
(`-extensions/RQW-providers/index.ts`), then `/reload` or restart: Pi's own lists return. `test/isolation.test.ts` and
`test/anthropic-models.test.ts` prove each combination.

## Limits

- The default model and `--models` patterns are resolved before the session is bound, so they still see all providers;
  the login and pickers do not.
- Keep the manifest order: RQW-anthropic, RQW-providers (extension 14), then RQW-codex (extension 15). Cooperating
  lifecycle layers preserve surviving owners and restore stock after the last one leaves; Codex integration tests
  cover both load orders. An unrelated extension without the shared inner links can prevent removing a layer below
  it; an inactive pass-through may remain rather than clobbering that foreign wrapper.
- Another extension that registers a provider other than the two allowed ones registers it, but it is not listed.

Tests: `test/extensions/RQW-providers/providers.test.ts` (real Pi library and CLI bundle, fake credentials, no network, the
actual `pi --list-models`), `npm test`. Mechanism research: `notes/anthropic-adapter.md`, "Provider visibility".
