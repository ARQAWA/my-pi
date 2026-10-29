import assert from "node:assert/strict";
import { it, type TestContext } from "node:test";
import { AgentSession, CustomEditor, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import sendNow from "../../../extensions/RQW-send-now/index.ts";

function setup(t: TestContext) {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	t.mock.method(AgentSession.prototype as any, "_bindExtensionCore", function() {});
	const handlers = new Map<string, ((event: any, ctx: any) => void)[]>();
	const sent: string[] = [];
	const pi = { on: (name: string, fn: any) => handlers.set(name, [...(handlers.get(name) ?? []), fn]),
		sendUserMessage: (text: string) => sent.push(text), appendEntry() {} };
	sendNow(pi as unknown as ExtensionAPI);
	let editor = "", idle = false, aborts = 0;
	let steering: unknown = [];
	let followups: string[] = [];
	let input: (data: string) => unknown = () => undefined;
	const manager = { getEntries: () => [] };
	const session = Object.create(AgentSession.prototype);
	session.sessionManager = manager;
	session.getSteeringMessages = () => { if (steering === "throw") throw Error("bad queue"); return steering; };
	session._bindExtensionCore();
	const ctx = {
		mode: "tui", model: {}, sessionManager: manager,
		hasPendingMessages: () => (Array.isArray(steering) && steering.length > 0) || followups.length > 0,
		isIdle: () => idle,
		abort: () => { aborts++; idle = true; editor = [...(Array.isArray(steering) ? steering : []), ...followups].join("\n\n"); steering = []; followups = []; },
		ui: { getEditorText: () => editor, setEditorText: (text: string) => { editor = text; }, notify() {},
			setWidget: (_key: string, factory: any) => { if (factory) factory({ getFocusedComponent: () => Object.create(CustomEditor.prototype) }); },
			onTerminalInput: (fn: typeof input) => { input = fn; return () => {}; } },
	} as unknown as ExtensionContext;
	const fire = (name: string, event: any = {}) => { for (const fn of handlers.get(name) ?? []) fn(event, ctx); };
	fire("session_start");
	t.after(() => fire("session_shutdown"));
	return { fire, sent, key: () => input("\r"), tick: () => t.mock.timers.tick(0),
		setSteering: (value: unknown) => { steering = value; }, setFollowups: (value: string[]) => { followups = value; },
		get aborts() { return aborts; } };
}

it("ignores a swallowed steering input with only follow-up after the provisional period", (t) => {
	const h = setup(t); h.setFollowups(["later"]); h.fire("input", { streamingBehavior: "steer" }); h.tick();
	assert.equal(h.key(), undefined); assert.equal(h.aborts, 0); assert.deepEqual(h.sent, []);
});

it("sends a delayed steering input after an early Enter and queue arrival", (t) => {
	const h = setup(t); h.fire("input", { streamingBehavior: "steer" }); h.tick();
	assert.equal(h.key(), undefined); h.setSteering(["delayed"]);
	assert.deepEqual(h.key(), { consume: true }); h.tick(); assert.deepEqual(h.sent, ["delayed"]);
});

it("preserves the provisional two-Enter gesture and sends the late queue", (t) => {
	const h = setup(t); h.fire("input", { streamingBehavior: "steer" });
	assert.deepEqual(h.key(), { consume: true }); h.setSteering(["late"]); h.tick();
	assert.deepEqual(h.sent, ["late"]);
});

it("leaves Enter to Pi when the queue is malformed or throws", (t) => {
	const h = setup(t); h.fire("input", { streamingBehavior: "steer" });
	for (const value of [null, [42], "throw"]) { h.setSteering(value); assert.equal(h.key(), undefined); }
	assert.equal(h.aborts, 0); assert.deepEqual(h.sent, []);
});
