import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { createEventBus } from "@earendil-works/pi-coding-agent";
import { createCodexExtension } from "../extensions/RQW-codex/index.ts";
import { SESSION_BIND } from "../extensions/RQW-codex/lifecycle.ts";
import { installRqwTools } from "../extensions/RQW-tools/index.ts";

const names = ["rqw_glob", "rqw_readfile", "rqw_rg"];
const model: any = {
	id: "gpt-6-luna", name: "GPT-6-Luna", provider: "openai-codex", api: "openai-codex-responses",
	baseUrl: "https://example.invalid", reasoning: true, input: ["text"], contextWindow: 500000, maxTokens: 100000,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, thinkingLevelMap: {},
};
const events = [
	{ type: "response.created", response: { id: "response" } },
	{ type: "response.output_item.added", output_index: 0, item: { type: "message", id: "message", role: "assistant", content: [], status: "in_progress" } },
	{ type: "response.output_text.delta", item_id: "message", output_index: 0, content_index: 0, delta: "ok" },
	{ type: "response.output_item.done", output_index: 0, item: { type: "message", id: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "ok", annotations: [] }] } },
	{ type: "response.completed", response: { id: "response", status: "completed", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } } },
];

test("RQW-tools catalogue reaches RQW-codex lite request unchanged", async () => {
	const handlers = new Map<string, Array<(event: any, ctx: any) => any>>();
	const tools: any[] = [];
	const pi: any = {
		events: createEventBus(), registerTool: (tool: any) => tools.push(tool), getSettings: () => ({}), getActiveTools: () => [],
		on(name: string, handler: (event: any, ctx: any) => any) {
			handlers.set(name, [...(handlers.get(name) ?? []), handler]);
			return () => handlers.set(name, (handlers.get(name) ?? []).filter((item) => item !== handler));
		},
	};
	const sent: any[] = [];
	const connect = async () => {
		let open = true;
		let response: any[] = [];
		return {
			get isOpen() { return open; }, socketIdentity: "test-socket",
			events: () => (async function* () { for (const value of response) yield { text: JSON.stringify(value), value }; })(),
			async send(frame: unknown) { sent.push(frame); response = events; },
			async close() { open = false; }, async interrupt() { return { acknowledged: true, completed: false }; },
		};
	};
	const store = new InMemoryCredentialStore();
	const access = `e30.${Buffer.from(JSON.stringify({ exp: 4000000000, "https://api.openai.com/auth": { chatgpt_account_id: "test" } })).toString("base64url")}.sig`;
	await store.modify("openai-codex", async () => ({ type: "oauth", access, refresh: "test", expires: 4000000000000, accountId: "test" }) as never);
	let config: any;
	const noop = () => undefined;
	const runtime: any = {
		getAuth: noop, prepareRequest: noop, stream: noop, streamSimple: noop, composeProvider: noop, models: { getAuth: noop }, credentials: store,
		getRegisteredProviderConfig: () => config,
		registerProvider: (_name: string, value: any) => { config = value; }, unregisterProvider: () => { config = undefined; },
	};
	const entries: any[] = [];
	const manager: any = { getHeader: () => null, getEntries: () => entries, getBranch: () => entries, getLeafId: () => entries.at(-1)?.id ?? null,
		getCwd: () => process.cwd(), buildSessionProjection: () => ({ entries: [], messages: [] }),
		appendCustomEntry(customType: string, data: unknown) {
			const entry = { type: "custom", customType, data, id: `entry-${entries.length + 1}`, parentId: entries.at(-1)?.id ?? null, timestamp: 1 };
			entries.push(entry);
			return entry.id;
		} };
	const session: any = { sessionId: "root", sessionManager: manager, modelRuntime: runtime, model, agent: { state: { tools: [] } },
		_hiddenDeclarations: new Set(), subscribe: () => () => {}, dispose: noop, _isRetryableError: () => false };
	installRqwTools(pi);
	createCodexExtension({ installationId: "11111111-2222-4333-8444-555555555555",
		dependencies: { connect: connect as any, clock: { now: () => 1000000 }, random: () => 0.5, sleep: async () => {} } })(pi);
	try {
		for (const handler of handlers.get(SESSION_BIND) ?? []) handler({ type: SESSION_BIND, session }, {});
		const selected = tools.filter((tool) => names.includes(tool.name)).map(({ name, description, parameters }) => ({ name, description, parameters }));
		const result = await config.streamSimple(model, { messages: [{ role: "user", content: "hello", timestamp: 1 }], tools: selected }, { sessionId: "root" }).result();
		assert.equal(result.stopReason, "stop", result.errorMessage);
		assert.equal(sent.length, 1);
		const additional = sent[0].input.find((item: any) => item.type === "additional_tools");
		const namespace = additional.tools.find((item: any) => item.type === "namespace" && item.name === "functions");
		assert.deepEqual(namespace.tools.map((tool: any) => tool.name).sort(), names);
	} finally {
		for (const handler of handlers.get("session_shutdown") ?? []) await handler({ reason: "shutdown" }, { sessionManager: manager });
	}
});
