import assert from "node:assert/strict";
import { test } from "node:test";
import { InteractiveMode, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { installClone } from "../extensions/RQW-session/clone.ts";
import commands from "../extensions/RQW-commands/index.ts";

test("session and commands patches restore prototypes in either shutdown order", async (t) => {
 t.mock.timers.enable({ apis: ["setImmediate"] });
 const proto: any = InteractiveMode.prototype;
 const original = [proto.createBaseAutocompleteProvider, proto.showSelector];
 for (const reverse of [false, true]) {
  for (let i = 0; i < 2; i++) {
   const handlers = new Map<string, Function[]>();
   const pi = { on(name: string, fn: Function) { const list = handlers.get(name) ?? []; list.push(fn); handlers.set(name, list); return () => {}; } } as unknown as ExtensionAPI;
   const dispose = installClone(pi); commands(pi);
   if (!reverse) await dispose();
   // A later shutdown handler can wait for an arbitrary asynchronous operation.
   let release!: () => void;
   const pending = new Promise<void>(resolve => { release = resolve; });
   const shutdown = (async () => { await pending; for (const fn of handlers.get("session_shutdown") ?? []) await fn(); })();
   await Promise.resolve();
   t.mock.timers.tick(0);
   release();
   await shutdown;
   if (reverse) await dispose();
   assert.deepEqual([proto.createBaseAutocompleteProvider, proto.showSelector], original);
  }
 }
});

