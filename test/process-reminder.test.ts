import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ContextEvent, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import processReminder from "../.pi/extensions/process-reminder/index.ts";

test("reminder reads fresh rules beside the latest user message without changing context", async t => {
	const root = await mkdtemp(join(tmpdir(), "process-reminder-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const process = join(root, "PROCESS.md");
	await writeFile(process, "1. first\n2. second\n3. third\n4. fourth\n5. fifth\n5. unrelated\n6. other\n");
	let hook: ((event: ContextEvent) => Promise<any>) | undefined;
	processReminder({ on: (name: string, handler: typeof hook) => { if (name === "context") hook = handler; } } as unknown as ExtensionAPI, root);
	assert.ok(hook);
	const messages = [
		{ role: "user", content: "earlier", timestamp: 1 },
		{ role: "user", content: "latest", timestamp: 2 },
		{ role: "toolResult", toolCallId: "call", toolName: "read", content: [{ type: "text", text: "result" }], isError: false, timestamp: 3 },
	] as ContextEvent["messages"];
	const original = structuredClone(messages);
	const event: ContextEvent = { type: "context", messages };
	const result = await hook(event);
	assert.notEqual(result.messages, messages);
	assert.deepEqual(event.messages, original);
	assert.equal(result.messages[1], messages[1]);
	assert.equal(result.messages[3], messages[2]);
	const text = result.messages[2].content;
	for (const rule of ["1. first", "2. second", "3. third", "4. fourth", "5. fifth"]) assert.ok(text.includes(rule));
	assert.ok(!text.includes("5. unrelated"));
	await writeFile(process, "1. changed\n");
	const next = await hook(event);
	assert.ok(next.messages[2].content.includes("1. changed"));
	assert.ok(!next.messages[2].content.includes("1. first"));
	assert.deepEqual(event.messages, original);
	await rm(process);
	assert.equal(await hook(event), undefined);
});
