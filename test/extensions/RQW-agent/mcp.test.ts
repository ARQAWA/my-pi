import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { createFauxCore, fauxAssistantMessage, fauxToolCall, getCurrentTools } from "@earendil-works/pi-ai";
import { createEventBus, SessionManager } from "@earendil-works/pi-coding-agent";
import { registerSessionRuntime } from "../../../extensions/RQW-agent/index.ts";
import { world } from "./fixture.ts";

const ECHO = { name: "echo", description: "Echo the text", inputSchema: { type: "object", properties: { text: { type: "string" } } } };

/**
 * Streamable HTTP MCP servers behind a mocked `fetch`: each answers with JSON, names a session per `initialize`
 * and counts the sessions Pi opens and closes (DELETE) per host. `broken.test` answers 404 and `login.test` 401,
 * as a server that is down for good and one that needs OAuth sign-in. `when` resolves once its check holds.
 */
function mcpServers() {
	const seen = new Set<string>();
	const opened: string[] = [];
	const closed: string[] = [];
	const waiters = new Set<() => void>();
	const json = (body: unknown, session: string) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json", "mcp-session-id": session } });
	// Not t.mock.method: a mock keeps the stack of every call, and its frames hold the child sessions they ran on.
	const realFetch = globalThis.fetch;
	globalThis.fetch = (async (input: string | URL, init: RequestInit) => {
		const url = new URL(String(input));
		if (!url.hostname.endsWith(".test")) throw new TypeError(`unexpected fetch ${url}`);
		seen.add(url.hostname);
		const session = new Headers(init.headers).get("mcp-session-id") ?? `${url.hostname}#${opened.length}`;
		try {
			if (url.hostname === "broken.test") return new Response("gone", { status: 404 });
			if (url.hostname === "login.test") return new Response("sign in", { status: 401, headers: { "www-authenticate": "Bearer" } });
			if (init.method === "GET") return new Response(null, { status: 405 });
			if (init.method === "DELETE") { closed.push(url.hostname); return new Response(null, { status: 200 }); }
			const message = JSON.parse(String(init.body));
			if (message.id === undefined) return new Response(null, { status: 202 });
			if (message.method === "initialize") {
				opened.push(url.hostname);
				return json({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: url.hostname, version: "1" } } }, session);
			}
			if (message.method === "tools/list") return json({ jsonrpc: "2.0", id: message.id, result: { tools: [ECHO] } }, session);
			if (message.method === "tools/call") return json({ jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: `${url.hostname}:${message.params.arguments.text}` }] } }, session);
			return json({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "unknown method" } }, session);
		} finally {
			for (const waiter of waiters) waiter();
		}
	}) as typeof fetch;
	const restore = () => { globalThis.fetch = realFetch; };
	const when = (ok: () => boolean) => new Promise<void>(resolve => {
		const waiter = () => { if (ok()) { waiters.delete(waiter); resolve(); } };
		waiters.add(waiter);
		waiter();
	});
	const count = (list: string[], host: string) => list.filter(item => item === host).length;
	return { seen, opened, closed, when, count, restore };
}

type Command = { name: string; sourceInfo: { source: string } };
const BUILTIN: Command[] = [{ name: "mcp", sourceInfo: { source: "builtin" } }];
const server = (host: string, extra: object = {}) => ({ url: `https://${host}.test/mcp`, headers: { Authorization: "Bearer test" }, exposure: "direct", ...extra });

type Options = {
	commands?: Command[];
	/** Servers an extension registered in main (`pi.registerMcpServer`). */
	registered?: any[];
	/** Extra user servers beside `fake`; `project` servers go to the project's `.pi/mcp.json`. */
	user?: Record<string, object>;
	project?: Record<string, object>;
	trusted?: boolean;
	active?: string[];
};

/** A main caller with `fake.test` (`direct`) in the user `mcp.json`; `commands` decides where its `/mcp` comes from. */
async function mcpWorld(t: TestContext, options: Options, response: (task: string, results: any[]) => ReturnType<typeof fauxAssistantMessage>) {
	const w = await world(t);
	const servers = mcpServers();
	await w.put("agent/mcp.json", JSON.stringify({ mcpServers: { fake: server("fake"), ...options.user } }));
	if (options.project) await w.put("project/pkg/.pi/mcp.json", JSON.stringify({ mcpServers: options.project }));
	const core = createFauxCore({ provider: "mcp-test", models: [{ id: "model" }] });
	const model = core.getModel("model")!;
	const requests: any[] = [];
	core.setResponses(Array.from({ length: 16 }, () => async (context: any) => {
		requests.push(context);
		const users = context.messages.filter((m: any) => m.role === "user");
		const task = users.at(-1).content[0].text;
		return response(task, context.messages.filter((m: any) => m.role === "toolResult" && context.messages.indexOf(m) > context.messages.indexOf(users.at(-1))));
	}));
	const modelRuntime = {
		getModel: () => model, getPhysicalModel: () => model, hasConfiguredAuth: () => true, getAuth: async () => ({ apiKey: "fake" }),
		checkAuth: async () => ({}), isUsingOAuth: () => false, getAvailableSnapshot: () => [model], getRegisteredProviderIds: () => [],
		stream: core.streamSimple, streamSimple: core.streamSimple,
	};
	const parent = SessionManager.inMemory(w.cwd);
	const ctx: any = {
		cwd: w.cwd, sessionManager: parent, model, modelRegistry: { runtime: modelRuntime, find: () => model, hasConfiguredAuth: () => true },
		isIdle: () => true, isProjectTrusted: () => options.trusted ?? true, getSystemPrompt: () => "original prompt", signal: new AbortController().signal, mode: "tui",
	};
	let definition: any;
	const pi: any = {
		events: createEventBus(), on: () => {}, registerTool: (tool: any) => { definition = tool; },
		appendEntry: (name: string, data: any) => parent.appendCustomEntry(name, data),
		getSettings: () => ({ retry: { enabled: false }, compaction: { enabled: false } }),
		getThinkingLevel: () => "off", getActiveTools: () => options.active ?? [],
		getCommands: () => options.commands ?? BUILTIN, getMcpServers: () => options.registered ?? [],
		sendMessage: (message: any) => parent.appendCustomMessageEntry(message.customType, message.content, message.display, message.details),
	};
	const live = registerSessionRuntime(pi, pi.events, false, undefined, undefined, undefined, undefined, "", undefined);
	// Every connection closes while fetch is still mocked, so nothing reaches the network after the test.
	t.after(async () => {
		live.close();
		await servers.when(() => servers.closed.length === servers.opened.length);
		servers.restore();
	});
	const run = async (task: string) => {
		await definition.execute("call", { action: "start", task, tools: [] }, new AbortController().signal, undefined, ctx);
		await live.wait(new AbortController().signal);
	};
	return { live, requests, servers, run };
}

const declared = (request: any) => getCurrentTools(request.messages.filter((m: any) => m.role === "system")).map(tool => tool.name);
const system = (request: any) => request.messages.filter((m: any) => m.role === "system").map((m: any) => m.content).join("\n");
const result = (requests: any[], id: string) => requests.flatMap(r => r.messages).find((m: any) => m.role === "toolResult" && m.toolCallId === id)
	?.content.filter((block: any) => block.type === "text").map((block: any) => block.text).join("\n");
const echoOnce = (task: string, done: any[]) => done.length
	? fauxAssistantMessage("done")
	: fauxAssistantMessage([fauxToolCall("mcp__fake__echo", { text: task }, { id: `fake-${task}` })], { stopReason: "toolUse" });

test("children, nested too, use the caller's built-in MCP servers like the caller and close them on release", async t => {
	// `reg`, registered by an extension in the caller, reaches the nested child too.
	const registered = [{ name: "reg", config: server("reg"), extensionPath: "reg-extension" }];
	const live = await mcpWorld(t, { registered }, (task, done) => {
		if (done.length) return fauxAssistantMessage("done");
		const calls = [fauxToolCall("mcp__fake__echo", { text: task }, { id: `fake-${task}` })];
		if (task === "nested") calls.push(fauxToolCall("mcp__reg__echo", { text: task }, { id: `reg-${task}` }));
		if (task === "outer") calls.push(fauxToolCall("agent", { action: "start", task: "nested", tools: [] }, { id: "delegate" }));
		return fauxAssistantMessage(calls, { stopReason: "toolUse" });
	});
	const { servers } = live;
	await live.run("outer");
	// `fake` is `direct`: declared to each child and called directly.
	assert.ok(declared(live.requests[0]).includes("mcp__fake__echo"));
	assert.equal(result(live.requests, "fake-outer"), "fake.test:outer");
	assert.equal(result(live.requests, "fake-nested"), "fake.test:nested");
	assert.equal(result(live.requests, "reg-nested"), "reg.test:nested");
	assert.deepEqual([servers.count(servers.opened, "fake.test"), servers.count(servers.opened, "reg.test")], [2, 2]);
	live.live.close();
	await servers.when(() => servers.closed.length === 4);
	assert.deepEqual([...servers.closed].sort(), [...servers.opened].sort());
});

test("a server an extension registered in the caller reaches the child with its codemode exposure", async t => {
	const registered = [{ name: "docs", config: { url: "https://docs.test/mcp", headers: { Authorization: "Bearer test" }, description: "Fake docs" }, extensionPath: "docs-extension" }];
	const live = await mcpWorld(t, { registered, active: ["codemode"] }, (_task, done) => done.length
		? fauxAssistantMessage("done")
		: fauxAssistantMessage([fauxToolCall("codemode", { code: 'return (await tools.mcp__docs__echo({ text: "script" })).content[0].text;' }, { id: "docs-script" })], { stopReason: "toolUse" }));
	await live.run("plain");
	// Listed in the child's prompt, not declared, and called from a script.
	assert.match(system(live.requests[0]), /<mcp_servers>[\s\S]*mcp__docs \(codemode\): Fake docs[\s\S]*<\/mcp_servers>/);
	assert.ok(!declared(live.requests[0]).some(name => name.startsWith("mcp__docs")));
	assert.match(result(live.requests, "docs-script"), /docs\.test:script/);
});

for (const trusted of [true, false]) {
	test(`a child ${trusted ? "reads" : "skips"} the project's mcp.json when the caller's project is ${trusted ? "" : "not "}trusted`, async t => {
		const live = await mcpWorld(t, { trusted, project: { proj: server("proj") } }, echoOnce);
		await live.run("plain");
		assert.equal(declared(live.requests[0]).includes("mcp__proj__echo"), trusted);
		assert.ok(declared(live.requests[0]).includes("mcp__fake__echo"));
	});
}

test("a server that is down or needs sign-in leaves the child's other MCP tools working", async t => {
	const live = await mcpWorld(t, { user: { broken: server("broken"), login: { url: "https://login.test/mcp", exposure: "direct" } } }, echoOnce);
	await live.run("plain");
	assert.ok(live.servers.seen.has("broken.test") && live.servers.seen.has("login.test"));
	const tools = declared(live.requests[0]);
	assert.ok(!tools.some(name => name.startsWith("mcp__broken") || name.startsWith("mcp__login")));
	assert.equal(result(live.requests, "fake-plain"), "fake.test:plain");
});

for (const [name, commands] of [["is disabled", []], ["is replaced by an extension's /mcp", [{ name: "mcp", sourceInfo: { source: "local" } }]]] as const) {
	test(`a child gets no MCP when the caller's built-in client ${name}`, async t => {
		const live = await mcpWorld(t, { commands: [...commands] }, () => fauxAssistantMessage("done"));
		await live.run("plain");
		assert.ok(declared(live.requests[0]).includes("agent"));
		assert.ok(!declared(live.requests[0]).some(tool => tool.startsWith("mcp__")));
		assert.doesNotMatch(system(live.requests[0]), /mcp_servers/);
		assert.deepEqual(live.servers.opened, []);
	});
}
