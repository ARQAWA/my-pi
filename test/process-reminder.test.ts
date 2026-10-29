import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ContextEvent, ContextEventResult, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import processReminder from "../.pi/extensions/process-reminder/index.ts";

test("request context gets fresh rules beside every user message", async t => {
	const root = await mkdtemp(join(tmpdir(), "process-reminder-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const process = join(root, "PROCESS.md");
	await writeFile(process, "1. first\n2. second\n3. third\n4. fourth\n5. fifth\n5. unrelated\n6. other\n");
	let hook!: (event: ContextEvent) => Promise<ContextEventResult | undefined>;
	processReminder({ on: (name: string, handler: typeof hook) => { if (name === "context") hook = handler; } } as unknown as ExtensionAPI, root);
	assert.ok(hook);
	const messages = [
		{ role: "user", content: "first", timestamp: 1 },
		{ role: "toolResult", toolCallId: "a", toolName: "read", content: [{ type: "text", text: "result" }], isError: false, timestamp: 2 },
		{ role: "user", content: "queued steering", timestamp: 3 },
		{ role: "custom", customType: "agent", content: "result", display: true, timestamp: 4 },
	] as ContextEvent["messages"];
	const original = structuredClone(messages);
	const event: ContextEvent = { type: "context", messages };
	const result = (await hook(event))!.messages!;
	assert.deepEqual((await hook(event))!.messages, result);
	assert.deepEqual(messages, original);
	assert.equal(result.length, 6);
	assert.deepEqual(result.filter(m => m.role !== "custom" || m.customType !== "process-reminder"), messages);
	for (const i of [1, 4]) {
		const memo = result[i];
		assert.equal(memo.role, "custom");
		if (memo.role !== "custom") throw new Error("missing reminder");
		assert.equal(memo.customType, "process-reminder");
		assert.equal(memo.display, false);
		assert.equal(typeof memo.content, "string");
		if (typeof memo.content !== "string") throw new Error("invalid reminder content");
		for (const rule of ["1. first", "2. second", "3. third", "4. fourth", "5. fifth"]) assert.ok(memo.content.includes(rule));
		assert.ok(!memo.content.includes("5. unrelated"));
	}
	await writeFile(process, "1. changed\n");
	const next = (await hook(event))!.messages![1];
	assert.ok(next.role === "custom" && typeof next.content === "string" && next.content.includes("1. changed"));
	assert.ok(!next.content.includes("1. first"));
	await rm(process);
	assert.equal(await hook(event), undefined);
});
