import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { it } from "node:test";
import { AgentSession, CustomEditor, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import sendNow from "../../../extensions/RQW-send-now/index.ts";

function harness(factory = sendNow) {
	const handlers = new Map<string, ((event: any, ctx: any) => void)[]>();
	const sent: string[] = [];
	factory({
		on: (name: string, handler: any) => { handlers.set(name, [...(handlers.get(name) ?? []), handler]); },
		sendUserMessage: (text: string) => sent.push(text), appendEntry() {},
	} as unknown as ExtensionAPI);
	let editor = "";
	let idle = false;
	let aborts = 0;
	let input: (data: string) => unknown = () => undefined;
	const session = Object.create(AgentSession.prototype);
	let messages: unknown = [];
	session.sessionManager = { getEntries: () => [] };
	session.getSteeringMessages = () => { if (messages === "throw") throw Error("bad"); return messages; };
	const ctx = {
		mode: "tui", model: {}, sessionManager: session.sessionManager,
		hasPendingMessages: () => Array.isArray(messages) && messages.length > 0, isIdle: () => idle,
		abort: () => { aborts++; idle = true; editor = (messages as string[]).join("\n\n"); messages = []; },
		ui: {
			getEditorText: () => editor, setEditorText: (value: string) => { editor = value; }, notify() {},
			setWidget: (_key: string, make: any) => { if (make) make({ getFocusedComponent: () => Object.create(CustomEditor.prototype) }); },
			onTerminalInput: (handler: typeof input) => { input = handler; return () => {}; },
		},
	} as unknown as ExtensionContext;
	return {
		session, sent, setMessages: (value: unknown) => { messages = value; idle = false; },
		start: () => { for (const handler of handlers.get("session_start")!) handler({}, ctx); },
		shutdown: () => { for (const handler of handlers.get("session_shutdown")!) handler({}, ctx); },
		enter: () => input("\r"), aborts: () => aborts,
	};
}

it("captures each session on start and reload without removing foreign wrappers", (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
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
	a.setMessages(["first"]); b.setMessages([]);
	assert.equal(b.enter(), undefined);
	assert.equal(b.aborts(), 0);
	assert.deepEqual(a.enter(), { consume: true });
	t.mock.timers.tick(0);
	assert.deepEqual(a.sent, ["first"]);
	assert.deepEqual(b.sent, []);
	a.shutdown();
	b.setMessages(["second"]);
	assert.deepEqual(b.enter(), { consume: true });
	t.mock.timers.tick(0);
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
	reload.setMessages(["reloaded"]);
	assert.deepEqual(reload.enter(), { consume: true });
	t.mock.timers.tick(0);
	assert.deepEqual(reload.sent, ["reloaded"]);
	reload.shutdown();
	assert.deepEqual(calls, ["below", "base:a", "below", "base:b", "above", "below", "base:after shutdown", "above", "below", "base:reload"]);
	proto._bindExtensionCore = ours;
	const last = harness();
	last.shutdown();
	assert.equal(proto._bindExtensionCore, below);
});

it("does not swallow Enter when queue data or the binding hook is unavailable", (t) => {
	const proto = AgentSession.prototype as any;
	t.mock.method(proto, "_bindExtensionCore", function() {});
	const app = harness();
	t.after(() => app.shutdown());
	app.session._bindExtensionCore();
	app.start();
	for (const bad of [null, ["ok", 1], "throw"]) {
		app.setMessages(bad);
		assert.equal(app.enter(), undefined);
		assert.equal(app.aborts(), 0);
	}
	app.session.getSteeringMessages = undefined;
	app.setMessages(["queued"]);
	assert.equal(app.enter(), undefined);
	assert.equal(app.aborts(), 0);
	app.shutdown();
	delete proto._bindExtensionCore;
	const missing = harness();
	t.after(() => missing.shutdown());
	missing.start();
	missing.setMessages(["queued"]);
	assert.equal(missing.enter(), undefined);
	assert.equal(missing.aborts(), 0);
});

it("does not swallow Enter on an incompatible Pi version", async (t) => {
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
	app.setMessages(["queued"]);
	assert.equal(app.enter(), undefined);
	assert.equal(app.aborts(), 0);
});
