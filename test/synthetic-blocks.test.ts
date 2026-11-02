import assert from "node:assert/strict";
import { after, it } from "node:test";
import { reportTimings, text, world } from "./synthetic/world.ts";

after(() => reportTimings(import.meta.filename));

it("shows older messages after compaction and after resuming the branch", async (t) => {
	const w = await world(t);
	const longAnswer = Array.from({ length: 50 }, (_, index) => `history line ${index}`).join("\n\n");
	w.model.script(text("old answer"), text(longAnswer), text("new answer"));
	await w.submit("old message");
	await w.submit("kept message");
	const manager = w.session.sessionManager;
	const kept = manager.getBranch().find((entry: any) => entry.type === "message" && entry.message.role === "user" && JSON.stringify(entry.message.content).includes("kept message"));
	assert.ok(kept);
	const id = manager.appendCompaction("summary", kept.id, 1000);
	await w.host.handleEvent({ type: "entry_appended", entry: manager.getEntry(id) });
	await w.submit("new message");
	w.notSee("old message");
	w.press("\x1b[1;5H");
	w.screen();
	w.press("\x1b[1;5H");
	w.see("old message");

	const resumed = await w.restart();
	resumed.notSee("old message");
	resumed.press("\x1b[1;5H");
	resumed.screen();
	resumed.press("\x1b[1;5H");
	resumed.see("old message");
});
