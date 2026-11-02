import assert from "node:assert/strict";
import { it } from "node:test";
import { call, fail, isTask, text, world } from "./synthetic/world.ts";
import { untilWake } from "./synthetic/wake.ts";

it("reminds about a child's open list after recovery", async (t) => {
	const w = await world(t);
	w.model.when(isTask("resume task"), call("todo", { items: [{ id: "a", text: "Open child work", status: "active" }] }), fail("network down"));
	w.model.script(call("agent", { action: "start", task: "resume task" }), text("started"), text("failed"));
	await w.submit("start child");
	assert.match(await untilWake(w), /network down/);
	const resumed = await w.restart();
	resumed.model.when(isTask("resume task"), text("finished"), text("still working"));
	resumed.model.script(call("agent", { action: "resume", id: "agent#1" }), text("resumed"), text("received"));
	await resumed.submit("retry child");
	await untilWake(resumed);
	assert.equal(resumed.requests.filter(request => JSON.stringify(request.context.messages).includes("Остались открытые пункты")).length, 1);
	assert.deepEqual(resumed.networkAttempts, []);
	assert.deepEqual(resumed.errors, []);
	await resumed.dispose();
	assert.deepEqual(resumed.patched(), []);
});
