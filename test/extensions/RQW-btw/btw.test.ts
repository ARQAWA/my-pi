import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { Api, AssistantMessage, Context, Message, Model } from "@earendil-works/pi-ai";
import { AgentSession, createEventBus, estimateTokens, initTheme, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import btw from "../../../extensions/RQW-btw/index.ts";

// Fixed texts from the design, not from the code under test.
const CONTEXT_FORK = "rqw:context-fork:v1";
const INSTRUCTION = "Side chat from the user via /btw. Answer only from this conversation. Tools are unavailable: do not call or write tool calls. Do not continue the main task.";
const TOOL_NOTE = "Tool calls in this answer were not executed.";
const SHORT_NOTE = "This answer used a shorter context.";
const UNSENT_NOTE = "Earlier side messages are no longer sent to the model.";

initTheme();

const MODEL = { provider: "anthropic", id: "claude-test", api: "anthropic-messages", contextWindow: 1_000_000 } as Model<Api>;
const OTHER = { provider: "openai-codex", id: "gpt-test", api: "openai-codex-responses", contextWindow: 500_000 } as Model<Api>;
const SMALL = { ...MODEL, contextWindow: 40_000 } as Model<Api>;
const SYSTEM = { role: "system", content: "MAIN PROMPT", timestamp: 1 } as Message;
const USER = { role: "user", content: "Fix the tests.", timestamp: 2 } as Message;
const user = (content: string) => ({ role: "user", content, timestamp: 5 }) as Message;
const strip = (value: string) => value.replace(/\x1b\[[0-9;]*m|\x1b\]8;;[^\x07]*\x07|\x1b\]133;[A-Z]\x07|\x1b_[^\x07]*\x07/g, "");

function assistant(content: AssistantMessage["content"], stopReason: AssistantMessage["stopReason"] = "stop"): AssistantMessage {
	return { role: "assistant", content, api: "anthropic-messages", provider: "anthropic", model: "claude-test", stopReason, timestamp: 3,
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } } as AssistantMessage;
}
const text = (value: string) => assistant([{ type: "text", text: value }]);
const toolCall = (id: string) => assistant([{ type: "toolCall", id, name: "bash", arguments: { command: "npm test" } }], "toolUse");
const overflow = () => ({ ...assistant([], "error"), errorMessage: "prompt is too long: 250000 tokens > 200000 maximum" }) as AssistantMessage;

type Request = { model: Model<Api>; context: Context; options: Record<string, unknown> };
type Fork = { sessionId: string; model: Model<Api>; context: Context; reasoning?: string; signal: AbortSignal; offer(run: () => Promise<AssistantMessage>): void };
type Panel = { render(width: number): string[]; handleInput(data: string): void; handleMouse(event: unknown): unknown; focused: boolean };
type Reply = AssistantMessage | Promise<AssistantMessage>;

function deferred() {
	let resolve!: (message: AssistantMessage) => void;
	const promise = new Promise<AssistantMessage>(done => { resolve = done; });
	return { promise, resolve };
}

/** Pi's boundary: the session file, the main agent's stream function, the provider, the fork listeners and the TUI. */
type Entry = { type: string; id: string; parentId: string | null; summary?: string; message?: Message };
/** Every panel a test opened; closed after each test so no spinner timer outlives it. */
const panels = new Set<{ panel?: Panel; closed: boolean }>();

function harness({ fork = true, projection = [SYSTEM, USER] as Message[], replies = [] as Reply[], tree = [] as Entry[], rows = 30, mode = "tui" } = {}) {
	const handlers = new Map<string, ((event: unknown, ctx: unknown) => unknown)[]>();
	const commands = new Map<string, { handler(args: string, ctx: unknown): Promise<void> }>();
	const events = createEventBus();
	btw({
		on(name: string, handler: (event: unknown, ctx: unknown) => unknown) { handlers.set(name, [...(handlers.get(name) ?? []), handler]); },
		registerCommand(name: string, definition: { handler(args: string, ctx: unknown): Promise<void> }) { commands.set(name, definition); },
		events,
		getActiveTools: () => ["read"],
		getAllTools: () => [
			{ name: "read", description: "Read a file", parameters: { type: "object" } },
			{ name: "write", description: "Write a file", parameters: { type: "object" } },
		],
		getThinkingLevel: () => "medium",
	} as unknown as ExtensionAPI);

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
	const original = (model: Model<Api>, context: Context, options: Record<string, unknown>) => { main.push({ model, context, options }); return "main stream"; };
	const agent = { streamFunction: original as unknown };
	const session = Object.create(AgentSession.prototype) as AgentSession;
	Object.defineProperties(session, { sessionManager: { value: sessionManager }, agent: { value: agent } });

	const forks: Fork[] = [];
	const provider: Request[] = [];
	const next = () => Promise.resolve(replies.shift() ?? text("side answer"));
	if (fork) events.on(CONTEXT_FORK, data => { forks.push(data as Fork); (data as Fork).offer(next); });
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
				return { result: next };
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
		ctx, entries, main, forks, provider, notes, popup, agent, original, fire, state, tree,
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
const last = (context: Context) => context.messages.at(-1)!;
const hasToolCall = (context: Context) => context.messages.some(m => m.role === "assistant" && m.content.some(p => p.type === "toolCall"));
const size = (context: Context) => context.messages.reduce((sum, m) => sum + estimateTokens(m), 0);
const shows = (screen: string[], value: string) => screen.some(row => row.includes(value));

describe("RQW-btw", () => {
	afterEach(() => {
		for (const popup of panels) if (popup.panel && !popup.closed) popup.panel.handleInput("\x1b");
		panels.clear();
	});

	it("forks the last main request while the agent works and leaves the session and the next main request unchanged", async () => {
		const h = harness();
		h.request({ messages: [SYSTEM, USER] });
		h.fire("message_end", { message: text("Tests run.") });
		const before = structuredClone(h.entries);
		await h.btw("what changed?");

		assert.equal(h.forks.length, 1);
		const fork = h.forks[0];
		assert.equal(fork.sessionId, "main");
		assert.equal(fork.model, MODEL);
		assert.equal(fork.reasoning, "high");
		assert.deepEqual(fork.context.messages.slice(0, -1), [SYSTEM, USER, text("Tests run.")]);
		assert.equal(last(fork.context).content, `${INSTRUCTION}\n\nQuestion: what changed?`);
		assert.equal(h.provider.length, 0);
		assert.ok(shows(h.screen(), "what changed?"));
		assert.ok(shows(h.screen(), "side answer"));
		assert.deepEqual(h.entries, before);
		const next = { messages: [SYSTEM, USER, text("Tests run.")] };
		h.request(next, { sessionId: "main" });
		assert.equal(h.main.at(-1)!.context, next);
		assert.deepEqual(h.main.at(-1)!.options, { sessionId: "main" });
	});

	it("opens a full-screen side chat that grows from a frozen mark; later main progress stays out, tool calls are noted and dropped", async () => {
		const h = harness({ replies: [assistant([{ type: "thinking", thinking: "hm" }, { type: "text", text: "First." }, { type: "toolCall", id: "t", name: "read", arguments: {} }], "toolUse")] });
		h.request({ messages: [SYSTEM, USER] });
		await h.btw("first?");
		assert.deepEqual(h.popup.options, { overlay: true, overlayOptions: { anchor: "top-left", row: 0, col: 0, width: "100%", maxHeight: "100%" } });
		assert.equal(h.screen().length, 30);
		assert.ok(shows(h.screen(), TOOL_NOTE));
		assert.ok(h.screen().some(row => row.startsWith("─ /btw ─")));

		h.fire("message_end", { message: text("Main went on.") });
		h.request({ messages: [SYSTEM, USER, text("Main went on.")] });
		await h.say("second?");
		const messages = h.forks[1].context.messages;
		assert.deepEqual(messages.slice(0, 2), [SYSTEM, USER]);
		assert.equal(messages[2].content, `${INSTRUCTION}\n\nQuestion: first?`);
		assert.deepEqual(messages[3].role === "assistant" && messages[3].content, [{ type: "text", text: "First." }]);
		assert.equal(messages[4].content, "second?");
		assert.equal(messages.length, 5);
		assert.equal(hasToolCall(h.forks[1].context), false);
	});

	it("describes a running tool call as text in the snapshot path and the fallback path", async () => {
		const h = harness();
		h.request({ messages: [SYSTEM, USER] });
		h.fire("message_end", { message: toolCall("call-1") });
		await h.btw("status?");
		assert.deepEqual(h.forks[0].context.messages.slice(0, -1), [SYSTEM, USER]);
		assert.equal(hasToolCall(h.forks[0].context), false);
		assert.match(String(last(h.forks[0].context).content), /may still be running:.*call-1.*npm test/s);

		const f = harness({ fork: false, projection: [USER, toolCall("call-2"), text("after")] });
		await f.btw("status?");
		assert.equal(hasToolCall(f.provider[0].context), false);
		assert.match(String(last(f.provider[0].context).content), /may still be running:.*call-2.*after/s);
	});

	it("falls back after a compaction to the summary and kept tail with the current prompt and active tools", async () => {
		const h = harness({ projection: [SYSTEM, user("Summary."), text("Kept tail.")] });
		h.request({ messages: [SYSTEM, USER] });
		h.fire("session_compact");
		await h.btw("why?");
		assert.equal(h.forks.length, 0);
		const { context, options } = h.provider[0];
		assert.equal(options.sessionId, undefined);
		assert.equal(options.reasoning, "medium");
		const [system, ...rest] = context.messages;
		assert.equal(system.role === "system" && system.content, "CURRENT PROMPT");
		assert.deepEqual(system.role === "system" && system.toolsAdded?.map(tool => tool.name), ["read"]);
		assert.deepEqual(rest.slice(0, -1), [user("Summary."), text("Kept tail.")]);
		assert.match(String(last(context).content), /Question: why\?$/);
	});

	it("builds the mark from the new branch after tree navigation", async () => {
		const h = harness({ projection: [SYSTEM, user("Other branch.")] });
		h.request({ messages: [SYSTEM, USER] });
		h.fire("session_tree");
		await h.btw("where am I?");
		assert.equal(h.forks.length, 0);
		assert.equal(h.provider[0].context.messages[1].content, "Other branch.");
	});

	it("forgets the old session's request after a session switch and restores Pi's stream function", async () => {
		const h = harness({ projection: [SYSTEM, user("New session.")] });
		h.request({ messages: [SYSTEM, USER] });
		h.fire("session_shutdown");
		assert.equal(h.agent.streamFunction, h.original);
		h.switchTo("next");
		await h.btw("hi?");
		assert.equal(h.forks.length, 0);
		assert.equal(h.provider[0].context.messages[1].content, "New session.");
		h.request({ messages: [SYSTEM, USER] }, { sessionId: "next" });
		await h.btw("again?");
		assert.equal(h.forks.at(-1)!.sessionId, "next");
	});

	it("does not use the last request after a model change or for requests with another routing id", async () => {
		const h = harness();
		h.request({ messages: [SYSTEM, USER] });
		h.setModel(OTHER);
		await h.btw("q?");
		assert.equal(h.forks.length, 0);
		assert.equal(h.provider[0].model, OTHER);

		const g = harness();
		g.request({ messages: [SYSTEM, user("summary request")] }, { sessionId: "summary-1" });
		await g.btw("q?");
		assert.equal(g.forks.length, 0);
	});

	it("answers right before the main compaction without compacting: the last request stays whole, the newest tail goes as cut text", async () => {
		const h = harness();
		h.setModel(SMALL);
		h.request({ messages: [SYSTEM, USER] });
		h.fire("message_end", { message: assistant([{ type: "toolCall", id: "c", name: "bash", arguments: {} }], "toolUse") });
		h.fire("message_end", { message: { role: "toolResult", toolCallId: "c", toolName: "bash", content: [{ type: "text", text: "old ".repeat(30_000) + "NEWEST LINE" }], isError: false, timestamp: 4 } });
		await h.btw("what now?");

		assert.equal(h.forks.length, 1);
		assert.equal(h.provider.length, 0);
		assert.deepEqual(h.forks[0].context.messages.slice(0, -1), [SYSTEM, USER]);
		assert.match(String(last(h.forks[0].context).content), /\[earlier part cut\] .*NEWEST LINE.*Question: what now\?$/s);
		assert.ok(size(h.forks[0].context) <= SMALL.contextWindow - 16_384);
	});

	it("stops sending the oldest side exchanges once the side chat outgrows the window and says so once", async () => {
		const long = (label: string) => text(label + " " + "word ".repeat(16_000));
		const h = harness({ replies: [long("a1"), long("a2"), long("a3")] });
		h.setModel(SMALL);
		h.request({ messages: [SYSTEM, USER] });
		await h.btw("q1");
		await h.say("q2");
		await h.say("q3");
		assert.ok(!shows(h.screen(), UNSENT_NOTE));
		await h.say("q4");
		const messages = h.forks[3].context.messages;
		assert.deepEqual(messages.slice(0, 2), [SYSTEM, USER]);
		assert.equal(messages[2].content, `${INSTRUCTION}\n\nQuestion: q3`);
		assert.equal(last(h.forks[3].context).content, "q4");
		assert.ok(size(h.forks[3].context) <= SMALL.contextWindow - 16_384);
		// Scroll up page by page through the whole chat: the note stands once, right above the first sent question.
		const seen: string[] = [];
		for (let page = 0; page < 400 && !shows(h.screen(), "q1"); page++) {
			seen.push(...h.screen().filter(row => row.includes(UNSENT_NOTE) || row.includes("q3")));
			h.key("\x1b[5~");
		}
		assert.ok(shows(h.screen(), "q1"));
		// Seen scrolling upward: first the question, then the note above it, and nowhere else.
		assert.deepEqual([...new Set(seen.map(row => row.trim()))], ["q3", UNSENT_NOTE]);
	});

	it("retries a provider overflow once in a shorter form without compacting and marks the answer", async () => {
		const h = harness({ replies: [overflow()], tree: [
			{ type: "compaction", id: "c1", parentId: null, summary: "SUMMARY OF EARLIER WORK" },
			{ type: "message", id: "e1", parentId: "c1", message: USER },
		] });
		h.setModel(SMALL);
		h.request({ messages: [SYSTEM, user("old ".repeat(30_000)), USER] });
		await h.btw("q1");

		assert.equal(h.forks.length, 1);
		assert.equal(h.provider.length, 1);
		const { context, options } = h.provider[0];
		assert.equal(options.sessionId, undefined);
		assert.equal(context.messages[0].role === "system" && context.messages[0].content, "CURRENT PROMPT");
		assert.match(String(context.messages[1].content), /^Side chat.*Summary of the earlier conversation:\nSUMMARY OF EARLIER WORK\n\n\[earlier part cut\] .*Fix the tests\..*Question: q1$/s);
		assert.ok(size(context) <= SMALL.contextWindow / 2 + 100);
		assert.ok(shows(h.screen(), "side answer"));
		assert.ok(shows(h.screen(), SHORT_NOTE));
	});

	it("builds the overflow retry from the summary and prompt frozen at opening, not from a later main compaction", async () => {
		const h = harness({ replies: [text("first answer"), overflow()], tree: [
			{ type: "compaction", id: "c1", parentId: null, summary: "OLD SUMMARY" },
			{ type: "message", id: "e1", parentId: "c1", message: USER },
		] });
		h.setModel(SMALL);
		h.request({ messages: [SYSTEM, USER] });
		await h.btw("q1");
		// The main chat compacts while the side chat is open.
		h.tree.push({ type: "message", id: "e2", parentId: "e1", message: user("later main work") });
		h.tree.push({ type: "compaction", id: "c2", parentId: "e2", summary: "NEW SUMMARY" });
		h.state.leaf = "c2";
		h.state.prompt = "NEWER PROMPT";
		h.fire("session_compact");
		await h.say("q2");

		assert.equal(h.provider.length, 1);
		const retry = h.provider[0].context;
		assert.equal(retry.messages[0].role === "system" && retry.messages[0].content, "CURRENT PROMPT");
		const all = JSON.stringify(retry.messages);
		assert.match(all, /OLD SUMMARY/);
		assert.doesNotMatch(all, /NEW SUMMARY|NEWER PROMPT|later main work/);
		assert.ok(shows(h.screen(), SHORT_NOTE));
	});

	it("shows the provider error after a second overflow, sends no third request and keeps the chat", async () => {
		const h = harness({ replies: [overflow(), overflow()] });
		h.request({ messages: [SYSTEM, USER] });
		await h.btw("q?");
		assert.equal(h.forks.length + h.provider.length, 2);
		assert.ok(shows(h.screen(), "prompt is too long"));
		assert.equal(h.popup.closed, false);
		await h.say("again?");
		assert.equal(h.forks.length + h.provider.length, 3);
		// The failed question is not sent again.
		assert.ok(!JSON.stringify(h.forks.at(-1)!.context.messages.slice(2)).includes("q?"));
		assert.ok(shows(h.screen(), "side answer"));
	});

	it("sends without a fork listener as one normalized provider request without a session id", async () => {
		const h = harness({ fork: false });
		h.request({ messages: [SYSTEM, USER] });
		await h.btw("q?");
		assert.equal(h.provider.length, 1);
		assert.equal(h.provider[0].options.sessionId, undefined);
		assert.equal(h.provider[0].options.reasoning, "high");
		assert.equal(h.provider[0].context.messages[0].role, "system");
	});

	it("shows a spinner while waiting, ignores Enter until the answer arrives and keeps the draft", async () => {
		const pending = deferred();
		const h = harness({ replies: [pending.promise] });
		h.request({ messages: [SYSTEM, USER] });
		await h.btw("slow?");
		assert.ok(h.screen().some(row => /^ [⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]$/.test(row)));
		await h.say("next");
		assert.equal(h.forks.length, 1);
		pending.resolve(text("done"));
		await settle();
		assert.ok(!h.screen().some(row => /^ [⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]$/.test(row)));
		h.key("\r");
		await settle();
		assert.equal(h.forks.length, 2);
		assert.equal(last(h.forks[1].context).content, "next");
	});

	it("scrolls with the wheel, PageUp, PageDown and Up or Down on an empty input, taking the wheel from the main chat", async () => {
		const h = harness({ rows: 20, replies: [text(Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n\n"))] });
		h.request({ messages: [SYSTEM, USER] });
		await h.btw("list");
		const end = h.screen();
		assert.ok(shows(end, "line 39"));
		assert.deepEqual(h.wheel(-3), { handled: true });
		const up = h.screen();
		assert.notDeepEqual(up, end);
		h.wheel(3);
		assert.deepEqual(h.screen(), end);
		h.key("\x1b[5~");
		assert.ok(!shows(h.screen(), "line 39"));
		h.key("\x1b[6~");
		assert.deepEqual(h.screen(), end);
		h.key("\x1b[A");
		assert.notDeepEqual(h.screen(), end);
		h.key("\x1b[B");
		assert.deepEqual(h.screen(), end);
		h.key("x");
		h.key("\x1b[A");
		assert.deepEqual(h.screen().slice(0, 15), end.slice(0, 15));
	});

	it("keeps the visible text in place when an answer arrives while scrolled up; the end is followed again after scrolling down", async () => {
		const pending = deferred();
		const h = harness({ rows: 20, replies: [text(Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n\n")), pending.promise] });
		h.request({ messages: [SYSTEM, USER] });
		await h.btw("list");
		await h.say("more?");
		h.key("\x1b[5~");
		const before = h.screen();
		pending.resolve(text("THE NEW ANSWER"));
		await settle();
		assert.deepEqual(h.screen(), before);
		h.key("\x1b[6~");
		h.key("\x1b[6~");
		assert.ok(shows(h.screen(), "THE NEW ANSWER"));
	});

	for (const [name, data] of [["Escape", "\x1b"], ["Ctrl+C", "\x03"]]) {
		it(`${name} leaves the side chat, cancels a running answer and forgets everything`, async () => {
			const h = harness({ replies: [deferred().promise] });
			h.request({ messages: [SYSTEM, USER] });
			await h.btw("quick?");
			h.key(data);
			await settle();
			assert.equal(h.popup.closed, true);
			assert.equal(h.forks[0].signal.aborted, true);

			await h.btw("");
			assert.equal(h.popup.opened, 2);
			assert.equal(h.forks.length, 1);
			assert.ok(!shows(h.screen(), "quick?"));
		});
	}

	it("bare /btw opens an empty side chat without a request; outside the interactive view it only warns", async () => {
		const h = harness();
		h.request({ messages: [SYSTEM, USER] });
		await h.btw("   ");
		assert.equal(h.popup.opened, 1);
		assert.equal(h.forks.length + h.provider.length, 0);
		await h.say("now?");
		assert.equal(h.forks.length, 1);

		const p = harness({ mode: "print" });
		await p.btw("q?");
		assert.equal(p.popup.opened, 0);
		assert.deepEqual(p.notes, ["/btw needs the interactive view."]);
	});

	it("closes the side chat and restores Pi's stream function at session end", async () => {
		const h = harness({ replies: [deferred().promise] });
		h.request({ messages: [SYSTEM, USER] });
		await h.btw("long?");
		h.fire("session_shutdown");
		await settle();
		assert.equal(h.agent.streamFunction, h.original);
		assert.equal(h.forks[0].signal.aborted, true);
		assert.equal(h.popup.closed, true);
	});
});
