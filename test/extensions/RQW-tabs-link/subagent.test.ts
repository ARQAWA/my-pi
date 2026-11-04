import assert from "node:assert/strict";
import { it } from "node:test";
import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { listEntries } from "../../../extensions/RQW-tabs-link/registry.ts";
import { pairOfTabs, type Tab } from "./harness.ts";

const NAMES = ["list_chats", "read_chat", "send_message_to_chat", "wait_answer"];
const CHANNEL = "rqw-agent:subagent-extension-factories";

type Offer = { factory: (child: ExtensionAPI) => void; names: string[] };

/** What RQW-agent does for a child: ask the shared bus for factories, then run them with the child's own API. */
function offered(tab: Tab): Offer[] {
	const offers: Offer[] = [];
	tab.pi.events.emit(CHANNEL, { offer: (factory: Offer["factory"], names: string[]) => offers.push({ factory, names }) });
	return offers;
}

function startChild(tab: Tab, active: string[]) {
	const [{ factory }] = offered(tab);
	const tools: ToolDefinition[] = [];
	const handlers = new Map<string, (event: any) => unknown>();
	let activeTools = active;
	const child = {
		events: tab.pi.events,
		registerTool: (tool: ToolDefinition) => { tools.push(tool); },
		on: (name: string, handler: (event: any) => unknown) => { handlers.set(name, handler); },
		getActiveTools: () => [...activeTools],
		setActiveTools: (names: string[]) => { activeTools = names; },
	} as unknown as ExtensionAPI;
	factory(child);
	const ctx = () => {
		const base = tab.ctx();
		return { ...base, sessionManager: { ...base.sessionManager, getSessionId: () => "child-1" } };
	};
	const run = (name: string, params: object, callId = "child-call"): Promise<any> =>
		tools.find(tool => tool.name === name)!.execute(callId, params as never, undefined, undefined, ctx() as never);
	return { tools, handlers, run, active: () => activeTools };
}

it("a child is offered the four chat tools as deferred tools, the same offer at every depth", async (t) => {
	const { send } = await pairOfTabs(t);
	const [first, second] = [offered(send), offered(send)];
	assert.equal(first.length, 1);
	// Wildcards allow the tools without activating them, so tool_search can still load them.
	assert.deepEqual(first[0].names, NAMES.map(name => `${name}*`));
	assert.equal(first[0].factory, second[0].factory);
	const child = startChild(send, ["tool_search"]);
	assert.deepEqual(child.tools.map(tool => [tool.name, tool.exposure]), NAMES.map(name => [name, "deferred"]));
});

it("without tool_search the child's tools are active directly", async (t) => {
	const { send } = await pairOfTabs(t);
	const child = startChild(send, ["read"]);
	child.handlers.get("before_agent_start")!({ systemPromptOptions: { sections: {} } });
	assert.deepEqual(child.active(), ["read", ...NAMES]);
});

it("a child lists, reads and messages an open chat as itself and leaves no registry entry", async (t) => {
	const { recv, send, dir } = await pairOfTabs(t);
	recv.world.entries.push({ id: "u1", type: "message", parentId: null, timestamp: "2026-01-01T00:00:00Z", message: { role: "user", content: "hello there" } });
	const child = startChild(send, ["tool_search"]);
	const listed = JSON.parse((await child.run("list_chats", {})).content[0].text);
	assert.ok(listed.chats.some((chat: { id: string }) => chat.id === "recv"));
	const read = JSON.parse((await child.run("read_chat", { chatId: "recv" })).content[0].text);
	assert.equal(read.chat.id, "recv");
	const sent = JSON.parse((await child.run("send_message_to_chat", { chatId: "recv", prompt: "from the child" })).content[0].text);
	assert.deepEqual(sent, { chatId: "recv", status: "accepted" });
	assert.equal(recv.world.sent[0].message.details.from, "child-1");
	assert.deepEqual(listEntries(dir).map(entry => entry.id).sort(), ["recv", "send"]);
});

it("a child's wait_answer returns a saved answer of an open chat", async (t) => {
	const { recv, send } = await pairOfTabs(t);
	recv.world.entries.push({ id: "u1", type: "message", parentId: null, timestamp: "2026-01-01T00:00:00Z", message: { role: "user", content: "hi" } });
	recv.world.entries.push({ id: "a1", type: "message", parentId: "u1", timestamp: "2026-01-01T00:00:01Z", message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "ok" }] } });
	const child = startChild(send, ["tool_search"]);
	const result = JSON.parse((await child.run("wait_answer", { chatId: "recv", afterEntryId: "u1", timeout_ms: 500 })).content[0].text);
	assert.equal(result.reason, "answer");
});

it("a child cannot open a closed chat", async (t) => {
	const { send } = await pairOfTabs(t);
	const child = startChild(send, ["tool_search"]);
	const error = await child.run("read_chat", { chatId: "nothing-here" }).catch((e: Error) => JSON.parse(e.message));
	assert.equal(error.error, "unknown");
});
