import assert from "node:assert/strict";
import { it } from "node:test";
import { Type } from "typebox";
import { call, isTask, text, world } from "./synthetic/world.ts";
import { untilWake } from "./synthetic/wake.ts";

it("offers named extension tools to a child", async (t) => {
	const w = await world(t);
	const bus = (w.runtime.services.resourceLoader as any).eventBus;
	bus.on("rqw-agent:subagent-extension-factories", (request: any) => request.offer((pi: any) => {
		pi.registerTool({ name: "offered_test", label: "Test", description: "test", parameters: Type.Object({}), execute: async () => ({ content: [{ type: "text", text: "ok" }] }) });
	}, ["offered_test", "offered_test"]));
	w.model.when(isTask("child task"), call("offered_test", {}, "offered-call"));
	const held = w.model.hold(request => request.context.messages.some(message => message.role === "toolResult" && message.toolCallId === "offered-call"));
	w.model.script(call("agent", { action: "start", task: "child task" }), text("started"), text("received"));
	await w.submit("start child");
	await w.until(() => held.arrived, "child tool result");
	const result = held.request!.context.messages.find(message => message.role === "toolResult" && message.toolCallId === "offered-call");
	assert.equal(result?.role === "toolResult" && result.isError, false);
	held.reply(text("done"));
	await w.until(() => w.requests.some(request => request.context.messages.some(message => message.role === "user" && JSON.stringify(message.content).includes("results"))), "child result delivered");
	await w.settle();
	assert.deepEqual(w.model.unscripted, []);
	assert.deepEqual(w.networkAttempts, []);
	await w.dispose();
	assert.deepEqual(w.patched(), []);
});

it("starts a child without the removed todo feature", async (t) => {
	const widgets: string[] = [];
	let childTools: string[] = [];
	const probe = { name: "widget-probe", factory: (pi: any) => {
		pi.events.on("rqw-agent:subagent-extension-factories", (request: any) => request.offer((child: any) => {
			child.on("before_agent_start", () => { childTools = child.getActiveTools(); });
		}, []));
		pi.on("session_start", (_event: unknown, ctx: any) => {
			const original = ctx.ui.setWidget;
			ctx.ui.setWidget = (key: string, ...args: unknown[]) => {
				widgets.push(key);
				return original.call(ctx.ui, key, ...args);
			};
		});
	} };
	let w = await world(t, { beforeExtensions: [probe] });
	w.session.sessionManager.appendCustomEntry("rqw-todo-mode", { enabled: true });
	w.session.sessionManager.appendMessage({
		role: "toolResult", toolCallId: "old-todo", toolName: "todo",
		content: [{ type: "text", text: "ok" }],
		details: { items: [{ id: "old", text: "Old open task", status: "active" }] },
		isError: false, timestamp: Date.now(),
	});
	w = await w.restart();
	const extensions = w.runtime.services.resourceLoader.getExtensions().extensions;
	assert.ok(!extensions.some(extension => extension.commands.has("todo")));
	assert.ok(!extensions.some(extension => extension.tools.has("todo")));
	assert.ok(!w.session.extensionRunner!.getActiveTools().includes("todo"));
	const child = w.model.hold(isTask("child task"));
	w.model.script(call("agent", { action: "start", task: "child task" }), text("started"), text("received"));
	await w.submit("start child");
	await w.until(() => child.arrived, "child request");
	assert.ok(childTools.includes("agent"));
	assert.ok(!childTools.includes("todo"));
	child.reply(text("done"));
	const delivered = JSON.parse(await untilWake(w));
	assert.equal(delivered.results[0].outcome, "completed");
	assert.match(delivered.results[0].text, /^done(?:\n|$)/);
	assert.ok(!widgets.includes("rqw-todo-panel"));
	w.notSee("Old open task");
	assert.deepEqual(w.model.unscripted, []);
	assert.deepEqual(w.errors, []);
});
