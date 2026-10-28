import assert from "node:assert/strict";
import { it } from "node:test";
import { actionPhrase, CountsWatch, countParts, COUNTS_REQUEST, statusText } from "../../../extensions/RQW-statusbar/activity.ts";

it("renders main activity, compaction and counts", () => {
	assert.deepEqual(statusText({ compacting: false, running: true, counts: { agents: 2 } }),
		{ text: "Planning next moves · 2 agents", compacting: false });
	assert.deepEqual(statusText({ compacting: true, running: true, counts: { agents: 0 } }),
		{ text: "Compacting context", compacting: true });
	assert.equal(statusText({ compacting: false, running: false, counts: { agents: 0 } }), undefined);
	assert.deepEqual(countParts({ agents: 2 }), ["2 agents"]);
	assert.equal(actionPhrase("bash", { command: "npm test" }), "Running npm test");
	assert.equal(actionPhrase("edit", { path: "src/app.ts" }), "Editing app.ts");
});

it("keeps inactive agent and process waits visible after the main answer", () => {
	// Regression for 0870ef56d9e86367639a3997cd6d07b620c07c8b.
	assert.equal(statusText({ compacting: false, running: false, counts: { agents: 2, backgroundProcesses: 3 } })?.text,
		"Waiting for 2 agents, 3 background processes");
	assert.equal(statusText({ compacting: false, running: false, counts: { agents: 0, backgroundProcesses: 1 } })?.text,
		"Waiting for 1 background process");
});

it("consumes a count source and drops it on stop", () => {
	const handlers = new Map<string, (data: unknown) => void>();
	const events = {
		on(channel: string, handler: (data: unknown) => void) { handlers.set(channel, handler); return () => handlers.delete(channel); },
		emit(channel: string, data: unknown) { handlers.get(channel)?.(data); },
	};
	let count = 2;
	const listeners = new Set<(counts: { agents: number }) => void>();
	const source = {
		version: 1,
		snapshot: () => ({ agents: count }),
		subscribe(listener: (counts: { agents: number }) => void) { listeners.add(listener); return () => listeners.delete(listener); },
	};
	handlers.set(COUNTS_REQUEST, (request) => (request as { reply(source: unknown): void }).reply(source));
	const watch = new CountsWatch(events as never, () => undefined);
	watch.start();
	assert.deepEqual(watch.get(), { agents: 2 });
	count = 3;
	for (const listener of listeners) listener({ agents: count });
	assert.deepEqual(watch.get(), { agents: 3 });
	watch.stop();
	assert.deepEqual(watch.get(), { agents: 0 });
});

