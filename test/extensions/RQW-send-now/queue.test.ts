import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { it } from "node:test";
import { AgentSession, CustomEditor, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import sendNow from "../../../extensions/RQW-send-now/index.ts";
import { CTRL_ENTER, fakeSession } from "./harness.ts";

/** One Codex TUI session on the real Pi queue methods; Ctrl+Enter on an empty editor forces its steering. */
function harness(factory = sendNow) {
	const handlers = new Map<string, ((event: any, ctx: any) => void)[]>();
	const sent: unknown[] = [];
	factory({
		on: (name: string, handler: any) => { handlers.set(name, [...(handlers.get(name) ?? []), handler]); },
		sendUserMessage() {}, appendEntry() {},
	} as unknown as ExtensionAPI);
	let input: (data: string) => unknown = () => undefined;
	const manager = { getEntries: () => [] };
	const session = fakeSession(manager, () => {}, (trigger) => sent.push(trigger.prompt));
	const ctx = {
		mode: "tui", model: { provider: "openai-codex" }, sessionManager: manager,
		hasPendingMessages: () => session._steeringMessages.length > 0, isIdle: () => session.aborts > 0,
		ui: {
			getEditorText: () => "", setEditorText() {}, notify() {},
			setWidget: (_key: string, make: any) => { if (make) make({ getFocusedComponent: () => Object.assign(Object.create(CustomEditor.prototype), { isShowingAutocomplete: () => false }) }); },
			onTerminalInput: (handler: typeof input) => { input = handler; return () => {}; },
		},
	} as unknown as ExtensionContext;
	return {
		session, sent,
		start: () => { for (const handler of handlers.get("session_start")!) handler({}, ctx); },
		shutdown: () => { for (const handler of handlers.get("session_shutdown")!) handler({}, ctx); },
		press: () => input(CTRL_ENTER),
		flush: () => new Promise<void>((resolve) => setImmediate(resolve)),
	};
}

it("captures each session on start and reload without removing foreign wrappers", async (t) => {
	const calls: string[] = [];
	const proto = AgentSession.prototype as any;
	t.mock.method(proto, "_bindExtensionCore", function(value: string) { calls.push(`base:${value}`); return value; });
	const base = proto._bindExtensionCore;
	proto._bindExtensionCore = function(value: string) { calls.push("below"); return base.call(this, value); };
	const below = proto._bindExtensionCore;
	const a = harness(), b = harness();
	t.after(() => { a.shutdown(); b.shutdown(); });
	assert.equal(a.session._bindExtensionCore("a"), "a");
	b.session._bindExtensionCore("b");
	a.start(); b.start();
	await a.session._queueSteer("first");
	assert.equal(b.press(), undefined);
	assert.equal(b.session.aborts, 0);
	assert.deepEqual(a.press(), { consume: true });
	await a.flush();
	assert.deepEqual(a.sent, ["first"]);
	assert.deepEqual(b.sent, []);
	a.shutdown();
	await b.session._queueSteer("second");
	assert.deepEqual(b.press(), { consume: true });
	await b.flush();
	assert.deepEqual(b.sent, ["second"]);
	const ours = proto._bindExtensionCore;
	proto._bindExtensionCore = function(value: string) { calls.push("above"); return ours.call(this, value); };
	const above = proto._bindExtensionCore;
	b.shutdown();
	assert.equal(proto._bindExtensionCore, above);
	assert.equal(a.session._bindExtensionCore("after shutdown"), "after shutdown");
	const reload = harness();
	t.after(() => reload.shutdown());
	reload.session._bindExtensionCore("reload");
	reload.start();
	await reload.session._queueSteer("reloaded");
	assert.deepEqual(reload.press(), { consume: true });
	await reload.flush();
	assert.deepEqual(reload.sent, ["reloaded"]);
	reload.shutdown();
	for (const name of ["prompt", "_queueSteer", "_queueUserInput"]) {
		assert.equal(Object.getOwnPropertyDescriptor(reload.session, name), undefined, `${name} wrapper is removed with the last lease`);
	}
	assert.deepEqual(calls, ["below", "base:a", "below", "base:b", "above", "below", "base:after shutdown", "above", "below", "base:reload"]);
	proto._bindExtensionCore = ours;
	const last = harness();
	last.shutdown();
	assert.equal(proto._bindExtensionCore, below);
});

it("does not force when queue data or the binding hook is unavailable", async (t) => {
	const proto = AgentSession.prototype as any;
	t.mock.method(proto, "_bindExtensionCore", function() {});
	const app = harness();
	t.after(() => app.shutdown());
	app.session._bindExtensionCore();
	app.start();
	await app.session._queueSteer("queued");
	const queue = app.session._steeringMessages;
	app.session._steeringMessages = null;
	assert.equal(app.press(), undefined);
	Object.defineProperty(app.session, "_steeringMessages", { get() { throw Error("bad"); }, configurable: true });
	assert.equal(app.press(), undefined);
	Object.defineProperty(app.session, "_steeringMessages", { value: queue, configurable: true, writable: true });
	app.session._emitQueueUpdate = undefined;
	assert.equal(app.press(), undefined);
	assert.equal(app.session.aborts, 0);
	app.shutdown();
	delete proto._bindExtensionCore;
	const missing = harness();
	t.after(() => missing.shutdown());
	missing.start();
	await missing.session._queueSteer("queued");
	assert.equal(missing.press(), undefined);
	assert.equal(missing.session.aborts, 0);
});

it("does not force on an incompatible Pi version", async (t) => {
	const packageUrl = import.meta.resolve("@earendil-works/pi-coding-agent");
	const fakePackage = `data:text/javascript,${encodeURIComponent(`export * from ${JSON.stringify(packageUrl)}; export const VERSION = "2.0.0";`)}`;
	const hooks = registerHooks({
		resolve(specifier, context, nextResolve) {
			if (specifier === "./queue.ts" && context.parentURL?.includes("RQW-send-now/index.ts?incompatible")) {
				return nextResolve("./queue.ts?incompatible", context);
			}
			if (specifier === "@earendil-works/pi-coding-agent" && context.parentURL?.includes("RQW-send-now/queue.ts?incompatible")) {
				return { url: fakePackage, shortCircuit: true };
			}
			return nextResolve(specifier, context);
		},
	});
	let factory: typeof sendNow;
	const entry = "../../../extensions/RQW-send-now/index.ts?incompatible";
	try { factory = (await import(entry)).default; }
	finally { hooks.deregister(); }
	t.mock.method(AgentSession.prototype as any, "_bindExtensionCore", function() {});
	const app = harness(factory);
	t.after(() => app.shutdown());
	app.session._bindExtensionCore();
	app.start();
	await app.session._queueSteer("queued");
	assert.equal(app.press(), undefined);
	assert.equal(app.session.aborts, 0);
});
