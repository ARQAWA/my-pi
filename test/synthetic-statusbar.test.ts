import assert from "node:assert/strict";
import { after, it } from "node:test";
import { call, isTask, reportTimings, text, world } from "./synthetic/world.ts";

after(() => reportTimings(import.meta.filename));

it("shows the model, context meter and session ID in the frame", async (t) => {
	const w = await world(t);
	w.model.script(text("hello"));
	await w.submit("hi");

	const frame = w.screen();
	assert.ok(frame.some((line) => line.includes(w.session.sessionManager.getSessionId())));
	assert.ok(frame.some((line) => line.includes("Opus 5.5 md")), frame.join("\n"));
	assert.ok(frame.some((line) => /[━─]+\s+\d+%\s+[\d.]+[kM]\/[\d.]+[kM]/.test(line)), "context meter shows usage and limit");
	assert.deepEqual(w.networkAttempts, []);
});

it("shows a child's working and idle states on the screen", async (t) => {
	const w = await world(t);
	const child = w.model.hold(isTask("check status"));
	w.model.script(call("agent", { action: "start", task: "check status", title: "Status" }, "a1"), text("started"), text("child finished"));
	await w.submit("go");
	await w.until(() => child.arrived, "child started");
	w.see("agent#1 Status · working");
	child.reply(text("done"));
	await w.until(() => w.screen().some(line => line.includes("agent#1 Status · idle")), "child idle");
	w.see("agent#1 Status · idle");
	assert.deepEqual(w.networkAttempts, []);
});

it("statusbar off restores Pi's stock footer and editor border", async (t) => {
	const w = await world(t);
	const id = w.session.sessionManager.getSessionId();
	w.see(id);
	w.see("cmp 0");

	await w.submit("/statusbar off");
	w.notSee(id);
	w.notSee("cmp 0");
	w.see("(auto)");
	assert.deepEqual(w.networkAttempts, []);
});
