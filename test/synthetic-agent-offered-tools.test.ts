import assert from "node:assert/strict";
import { it } from "node:test";
import { Type } from "typebox";
import { call, isTask, text, world } from "./synthetic/world.ts";

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
