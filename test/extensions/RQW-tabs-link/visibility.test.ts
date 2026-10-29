import assert from "node:assert/strict";
import { it } from "node:test";
import { registerApiProvider, unregisterApiProviders } from "@earendil-works/pi-ai/compat";
import { createToolSearchExtension } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { FAKE_API, openTab, pairOfTabs, tempDir } from "./harness.ts";

// The fixed line, copied literally from the approved design; the code constant must not be its own reference.
const HINT = 'Chat tools for other open Pi chats: list_chats, read_chat, send_message_to_chat. Load them with tool_search query "rqwchat".';
const NAMES = ["list_chats", "read_chat", "send_message_to_chat"];

async function started(t: Parameters<typeof tempDir>[0]) {
	const tab = openTab({ dir: tempDir(t) }, "chat-a");
	await tab.fire("session_start", { reason: "startup" });
	return tab;
}
const promptOptions = (customPrompt?: string) => ({ systemPromptOptions: { customPrompt, sections: {} as Record<string, string> } });

it("the three tools are deferred and the prompt gets one fixed hint section, also with a custom prompt", async (t) => {
	const tab = await started(t);
	assert.deepEqual(tab.tools.map(tool => [tool.name, tool.exposure]), NAMES.map(name => [name, "deferred"]));
	for (const tool of tab.tools) assert.match(tool.description, /Search key: rqwchat\.$/);
	const hints = [];
	for (const custom of [undefined, "own prompt", "own prompt"]) {
		const event = promptOptions(custom);
		await tab.fire("before_agent_start", event);
		hints.push(event.systemPromptOptions.sections.chat_tools);
	}
	assert.deepEqual(hints, [HINT, HINT, HINT]);
});

it("the real tool_search finds exactly the three chat tools, even among many foreign chat tools", async (t) => {
	const tab = await started(t);
	for (let n = 0; n < 12; n++) {
		tab.pi.registerTool({
			name: `other_chat_${n}`, label: "x", description: `Chat helper ${n}: read chat, list chats, send message to chat.`,
			parameters: Type.Object({ chat: Type.String() }), exposure: "deferred", execute: async () => ({ content: [], details: {} }),
		});
	}
	createToolSearchExtension()(tab.pi);
	const found = await tab.run("tool_search", { query: "rqwchat" });
	assert.deepEqual([...found.details.loaded].sort(), [...NAMES].sort());
});

it("without an active tool_search there is no hint and the three tools are active directly", async (t) => {
	const tab = await started(t);
	tab.world.active = ["read"];
	const event = promptOptions();
	await tab.fire("before_agent_start", event);
	assert.equal(event.systemPromptOptions.sections.chat_tools, undefined);
	assert.deepEqual(tab.world.active, ["read", ...NAMES]);
});

it("a non-TUI mode adds no hint and no tools", async (t) => {
	const tab = openTab({ dir: tempDir(t) }, "chat-a");
	await tab.fire("session_start", { reason: "startup" }, "print");
	const event = promptOptions();
	await tab.fire("before_agent_start", event);
	assert.deepEqual(event.systemPromptOptions.sections, {});
});

it("the three tools never reach a model provider", async (t) => {
	const { recv, send } = await pairOfTabs(t);
	// pi-ai's real provider registry: any model call through the fake models' api would land here.
	let calls = 0;
	const reached = () => { calls++; throw new Error("provider reached"); };
	registerApiProvider({ api: FAKE_API, stream: reached, streamSimple: reached }, "rqw-tabs-link-test");
	t.after(() => unregisterApiProviders("rqw-tabs-link-test"));
	recv.world.entries.push({ id: "u1", type: "message", parentId: null, timestamp: "2026-01-01T00:00:00Z", message: { role: "user", content: "hi" } });
	await send.run("list_chats", {});
	await send.run("read_chat", { chatId: "recv" });
	await send.run("send_message_to_chat", { chatId: "recv", prompt: "go", model: "p/other" });
	assert.equal(calls, 0);
});
