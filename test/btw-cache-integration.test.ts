import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { normalizeContext, type Api, type AssistantMessage, type Context, type Message, type Model } from "@earendil-works/pi-ai";
import { AgentSession, createEventBus, initTheme, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import btw from "../extensions/RQW-btw/index.ts";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import { createOverlay } from "../extensions/RQW-anthropic/transport.ts";
import prompt from "../extensions/RQW-prompt/index.ts";

// Fixed texts from the design, not from the code under test.
const CONTEXT_FORK = "rqw:context-fork:v1";
const SHORT_NOTE = "This answer used a shorter context.";

initTheme();

const MODEL = { provider: "anthropic", id: "claude-test", api: "anthropic-messages", contextWindow: 1_000_000 } as Model<Api>;
const SYSTEM = { role: "system", content: "MAIN PROMPT", timestamp: 1 } as Message;
const USER = { role: "user", content: "Fix the tests.", timestamp: 2 } as Message;
const strip = (value: string) => value.replace(/\x1b\[[0-9;]*m|\x1b\]8;;[^\x07]*\x07|\x1b\]133;[A-Z]\x07|\x1b_[^\x07]*\x07/g, "");

function assistant(content: AssistantMessage["content"], stopReason: AssistantMessage["stopReason"] = "stop"): AssistantMessage {
	return { role: "assistant", content, api: "anthropic-messages", provider: "anthropic", model: "claude-test", stopReason, timestamp: 3,
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } } as AssistantMessage;
}
const text = (value: string) => assistant([{ type: "text", text: value }]);

type Request = { model: Model<Api>; context: Context; options: Record<string, unknown> };
type Fork = { sessionId: string; model: Model<Api>; context: Context; reasoning?: string; signal: AbortSignal; offer(run: () => Promise<AssistantMessage>): void };
type Panel = { render(width: number): string[]; handleInput(data: string): void; handleMouse(event: unknown): unknown; focused: boolean };
type Reply = AssistantMessage | Promise<AssistantMessage>;

/** Pi's boundary: the session file, the main agent's stream function, the provider, the fork listeners and the TUI. */
type Entry = { type: string; id: string; parentId: string | null; summary?: string; message?: Message };
/** Every panel a test opened; closed after each test so no spinner timer outlives it. */
const panels = new Set<{ panel?: Panel; closed: boolean }>();

function harness({ fork = true, projection = [SYSTEM, USER] as Message[], replies = [] as Reply[], tree = [] as Entry[], rows = 30, mode = "tui", transport, startup = false } : { fork?: boolean; projection?: Message[]; replies?: Reply[]; tree?: Entry[]; rows?: number; mode?: string; transport?: typeof fetch; startup?: boolean } = {}) {
	const handlers = new Map<string, ((event: unknown, ctx: unknown) => unknown)[]>();
	const commands = new Map<string, { handler(args: string, ctx: unknown): Promise<void> }>();
	const events = createEventBus();
	const pi = {
		on(name: string, handler: (event: unknown, ctx: unknown) => unknown) { handlers.set(name, [...(handlers.get(name) ?? []), handler]); },
		registerCommand(name: string, definition: { handler(args: string, ctx: unknown): Promise<void> }) { commands.set(name, definition); },
		events,
		getActiveTools: () => ["read"],
		getAllTools: () => [
			{ name: "read", description: "Read a file", parameters: { type: "object" } },
			{ name: "write", description: "Write a file", parameters: { type: "object" } },
		],
		getThinkingLevel: () => "medium",
	} as unknown as ExtensionAPI;
	btw(pi);
	if (startup) prompt(pi);

	const entries = [{ type: "message", id: "e1", message: USER }];
	let sessionId = "main";
	const state = { projection, prompt: "CURRENT PROMPT", leaf: tree.at(-1)?.id ?? null };
	const sessionManager = {
		getSessionId: () => sessionId,
		getEntries: () => entries,
		buildSessionProjection: () => ({ messages: state.projection }),
		getLeafId: () => state.leaf,
		getEntry: (id: string) => tree.find(entry => entry.id === id),
		// The live branch, root first, from the current leaf.
		getBranch() {
			const branch: Entry[] = [];
			for (let id = state.leaf; id !== null;) {
				const entry = tree.find(item => item.id === id);
				if (!entry) break;
				branch.unshift(entry);
				id = entry.parentId;
			}
			return branch;
		},
	};
	const main: Request[] = [];
	const overlay = transport ? createOverlay(builtinProviders().find(provider => provider.id === "anthropic")!, () => undefined, "device") : undefined;
	overlay?.forks.registerSource("main");
	const original = (model: Model<Api>, context: Context, options: Record<string, unknown>) => {
		main.push({ model, context, options });
		return overlay ? overlay.streamSimple(model, normalizeContext(context), { ...options, apiKey: "sk-ant-oat01-fake", fetch: transport }).result() : "main stream";
	};
	const agent = { streamFunction: original as unknown };
	const session = Object.create(AgentSession.prototype) as AgentSession;
	Object.defineProperties(session, { sessionManager: { value: sessionManager }, agent: { value: agent } });
	if (startup) Object.defineProperties(session, {
		_baseSystemPromptOptions: { value: { selectedTools: [], hiddenTools: [] } },
		_runSystemPromptOptions: { value: undefined, writable: true },
		_hiddenDeclarations: { value: new Set() },
		getActiveToolNames: { value: () => ["read"] },
		systemPrompt: { configurable: true, get() { return (this._runSystemPromptOptions as { customPrompt?: string } | undefined)?.customPrompt ?? "CURRENT PROMPT"; } },
	});

	const forks: Fork[] = [];
	const provider: Request[] = [];
	const next = () => Promise.resolve(replies.shift() ?? text("side answer"));
	if (overlay) events.on(CONTEXT_FORK, data => { overlay.forks.offer(data as Parameters<typeof overlay.forks.offer>[0]); });
	else if (fork) events.on(CONTEXT_FORK, data => { forks.push(data as Fork); (data as Fork).offer(next); });
	const notes: string[] = [];
	const popup: { panel?: Panel; closed: boolean; options?: unknown; opened: number } = { closed: false, opened: 0 };
	panels.add(popup);
	const ctx = {
		mode, model: MODEL, sessionManager,
		isIdle: () => (session as unknown as { isIdle: boolean }).isIdle,
		getSystemPrompt: () => state.prompt,
		modelRegistry: {
			streamSimple(model: Model<Api>, context: Context, options: Record<string, unknown>) {
				provider.push({ model, context, options });
				return overlay ? overlay.streamSimple(model, normalizeContext(context), { ...options, apiKey: "sk-ant-oat01-fake", fetch: transport }) : { result: next };
			},
		},
		ui: {
			notify: (message: string) => notes.push(message),
			custom(factory: (...args: unknown[]) => Panel, options: unknown) {
				popup.options = options;
				popup.opened++;
				popup.closed = false;
				return new Promise<void>(resolve => {
					const done = () => { popup.closed = true; resolve(); };
					const theme = { fg: (_color: string, value: string) => value, bg: (_color: string, value: string) => value, bold: (value: string) => value };
					popup.panel = factory({ requestRender() {}, terminal: { rows, columns: 80 } }, theme, {}, done);
					popup.panel.focused = true;
				});
			},
		},
	};
	const fire = (name: string, event: unknown = {}) => { for (const handler of handlers.get(name) ?? []) handler(event, ctx); };
	fire("session_start", { reason: "startup" });
	const h = {
		ctx, entries, main, forks, provider, notes, popup, agent, original, fire, state, tree, events, session,
		requests: () => [...forks.map(f => f.context), ...provider.map(p => p.context)],
		setModel(model: Model<Api>) { ctx.model = model; },
		switchTo(id: string) { fire("session_shutdown"); sessionId = id; fire("session_start", { reason: "new" }); },
		request: (context: Context, options: Record<string, unknown> = { sessionId: "main", reasoning: "high" }) =>
			(agent.streamFunction as typeof original)(ctx.model, context, options),
		async btw(args: string) { await commands.get("btw")!.handler(args, ctx); await settle(); },
		key(data: string) { popup.panel!.handleInput(data); },
		async say(value: string) { for (const char of value) h.key(char); h.key("\r"); await settle(); },
		wheel: (wheelDelta: number) => popup.panel!.handleMouse({ type: "wheel", button: "none", wheelDelta, x: 1, y: 1, screenX: 1, screenY: 1, width: 80, height: rows, shift: false, alt: false, ctrl: false }),
		screen: (width = 80) => popup.panel!.render(width).map(strip),
	};
	return h;
}
const settle = () => new Promise(resolve => setImmediate(resolve));
const shows = (screen: string[], value: string) => screen.some(row => row.includes(value));

describe("RQW-btw with Anthropic transport", () => {
	afterEach(() => {
		for (const popup of panels) if (popup.panel && !popup.closed) popup.panel.handleInput("\x1b");
		panels.clear();
	});

	it("fresh /btw projects the actual startup prompt without changing the main session", async () => {
		const bodies: any[] = [];
		const transport: typeof fetch = async (_input, init) => {
			const body = JSON.parse(String(init?.body)); bodies.push(body);
			const blocks = [...(body.tools ?? []), ...(body.system ?? []), ...body.messages.flatMap((m: any) => Array.isArray(m.content) ? m.content : [])];
			if (blocks.filter((block: any) => block.cache_control).length > 4) return Response.json({ type: "error", error: { type: "invalid_request_error", message: "too many cache_control blocks" } }, { status: 400 });
			const events = [
				{ type: "message_start", message: { id: "fake", model: body.model, usage: { input_tokens: 1, output_tokens: 0 } } },
				{ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
				{ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "side answer" } },
				{ type: "content_block_stop", index: 0 },
				{ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 2 } }, { type: "message_stop" },
			];
			return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } });
		};
		const h = harness({ startup: true, transport });
		h.setModel(builtinProviders().find(provider => provider.id === "anthropic")!.getModels()[0]);
		await h.btw("hello");
		for (let i = 0; i < 5000 && !shows(h.screen(), "side answer"); i++) await settle();
		assert.ok(shows(h.screen(), "side answer"));
		assert.match(bodies[0].system[2].text, /^You operate in pi\./);
		assert.equal(h.ctx.getSystemPrompt(), "CURRENT PROMPT");
	});

	it("keeps the current prompt for an overflow retry and after compaction", async () => {
		const overflow = { ...assistant([], "error"), errorMessage: "prompt is too long: 250000 tokens > 200000 maximum" } as AssistantMessage;
		const h = harness({ startup: true, replies: [overflow] });
		h.request({ messages: [SYSTEM, USER] });
		h.state.prompt = "PROMPT CHANGED BY ANOTHER EXTENSION";
		await h.btw("retry?");
		assert.equal(h.provider[0].context.messages[0].content, "PROMPT CHANGED BY ANOTHER EXTENSION");
		h.fire("session_compact");
		await h.btw("after compaction?");
		assert.equal(h.provider[1].context.messages[0].content, "PROMPT CHANGED BY ANOTHER EXTENSION");
	});

	it("keeps the current prompt when reopening a session with a previous main answer", async () => {
		const h = harness({ startup: true });
		h.entries.push({ type: "message", id: "e2", message: text("earlier answer") });
		h.fire("session_start");
		h.state.prompt = "PROMPT RESTORED BY ANOTHER EXTENSION";
		await h.btw("hello");
		assert.equal(h.provider[0].context.messages[0].content, "PROMPT RESTORED BY ANOTHER EXTENSION");
	});

	for (const value of [undefined, "", 42]) it(`keeps the current prompt when the startup getter returns ${String(value)}`, async () => {
		const h = harness({ startup: true });
		Object.defineProperty(h.session, "systemPrompt", { configurable: true, get: () => value });
		await h.btw("hello");
		assert.equal(h.provider[0].context.messages[0].content, "CURRENT PROMPT");
	});

	it("keeps the current prompt when the startup prompt is not a getter", async () => {
		const h = harness({ startup: true });
		Object.defineProperty(h.session, "systemPrompt", { configurable: true, value: "WRONG PROMPT" });
		await h.btw("hello");
		assert.equal(h.provider[0].context.messages[0].content, "CURRENT PROMPT");
	});

	for (const retry of [false, true]) it(`keeps cache breakpoints valid across side turns${retry ? " and overflow retry" : ""}`, async () => {
		const requests: any[] = [];
		let overflowNext = retry;
		const transport: typeof fetch = async (_input, init) => {
			const body = JSON.parse(String(init?.body));
			requests.push(body);
			const blocks = [...(body.tools ?? []), ...(body.system ?? []), ...body.messages.flatMap((m: any) => Array.isArray(m.content) ? m.content : [])];
			if (blocks.filter((block: any) => block.cache_control).length > 4) {
				return Response.json({ type: "error", error: { type: "invalid_request_error", message: "A maximum of 4 blocks with cache_control may be provided. Found 5." } }, { status: 400 });
			}
			if (requests.length > 1 && overflowNext) {
				overflowNext = false;
				return Response.json({ type: "error", error: { type: "invalid_request_error", message: "prompt is too long: 250000 tokens > 200000 maximum" } }, { status: 400 });
			}
			const events = [
				{ type: "message_start", message: { id: "fake", model: body.model, usage: { input_tokens: 1, output_tokens: 0 } } },
				{ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
				{ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "side answer" } },
				{ type: "content_block_stop", index: 0 },
				{ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 2 } },
				{ type: "message_stop" },
			];
			return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } });
		};
		const h = harness({ transport });
		const model = builtinProviders().find(provider => provider.id === "anthropic")!.getModels()[0];
		h.setModel(model);
		const system = { ...SYSTEM, toolsAdded: [{ name: "read", description: "Read", parameters: { type: "object", properties: {} } }] } as Message;
		const mainContext = { messages: [system, USER] };
		const original = structuredClone(mainContext);
		await h.request(mainContext);
		const source = structuredClone(requests[0]);
		await h.btw("first?");
		const waitFor = async (needle: string) => {
			for (let i = 0; i < 5000 && !shows(h.screen(), needle); i++) await settle();
			assert.ok(shows(h.screen(), needle), h.screen().join("\n"));
		};
		await waitFor("side answer");
		await h.say("second?");
		await waitFor("second?");
		for (let i = 0; i < 5000 && h.screen().filter(row => row.includes("side answer")).length < 2; i++) await settle();
		assert.equal(h.screen().filter(row => row.includes("side answer")).length, 2);
		assert.equal(requests.length, retry ? 4 : 3);
		assert.deepEqual(mainContext, original);
		assert.deepEqual(requests[0], source);
		const prefix = (body: any) => [body.tools, body.system.slice(1), body.messages[0]];
		assert.deepEqual(prefix(requests[1]), prefix(source));
		assert.equal(requests[1].messages.at(-1).content.some((part: any) => part.cache_control), false);
		if (retry) assert.ok(shows(h.screen(), SHORT_NOTE));
	});
});


