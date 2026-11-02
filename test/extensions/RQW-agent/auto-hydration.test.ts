import assert from "node:assert/strict";
import { test } from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { runtime, world } from "./fixture.ts";

test("a saved automatic result is not delivered again after hydration", async t => {
	const w = await world(t);
	const first = runtime(w.cwd, w.base);
	first.parent.appendMessage({ role: "user", content: "parent", timestamp: 1 });
	await first.emit("session_start");
	await first.execute({ action: "start", task: "test", tools: [] });
	await first.live.wait(new AbortController().signal);
	const record = first.parent.getBranch().findLast((entry: any) => entry.type === "custom" && entry.customType === "rqw-agent-child" && entry.data?.result) as any;
	assert.ok(record);
	first.parent.appendCustomMessageEntry("rqw-auto-wait-results", "answer", false, { batch: "batch", results: [{ run: record.data.result.run, delivery: record.data.result.delivery }] });
	const file = first.parent.getSessionFile()!;
	first.live.close();
	// A new registration reads the saved custom message while restoring its child outbox.
	const second = runtime(w.cwd, w.base, "off", [], [], SessionManager.open(file));
	t.after(() => second.live.close());
	await second.emit("session_start");
	const waited = await second.execute({ action: "wait", ids: ["agent#1"] });
	assert.deepEqual(waited.details.results, []);
});
