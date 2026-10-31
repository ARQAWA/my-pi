// Pi's boundary for RQW-predictions tests: the session, the main stream function, the provider, the prompt
// source, the fork listeners, the event bus and the TUI. The extension's own code runs for real.
import { AgentSession, CustomEditor, createEventBus, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Api, AssistantMessage, Context, Message, Model } from "@earendil-works/pi-ai";
import { KeybindingsManager, setKeybindings, TUI_KEYBINDINGS } from "@earendil-works/pi-tui";
import predictions, { install } from "../../../extensions/RQW-predictions/index.ts";

// Fixed texts from the design, not from the code under test.
export const CONTEXT_FORK = "rqw:context-fork:v1";
export const ACTIVITY = "rqw-predictions:activity";
export const ACTIVITY_QUERY = "rqw-predictions:activity-query";
export const SILENCE_RULE = "If there is no obvious next user message, set suggestion to null.";
/** The gray of the suggestion in the fake theme: the `dim` role. */
export const DIM = "\x1b[38;2;127;126;124m";
export const ABORTED_MS = 2000;
export const CTRL_E = "\x05";
export const CTRL_R = "\x12";
/** Kitty key-release events of the same keys. */
export const CTRL_E_RELEASE = "\x1b[101;5:3u";
export const CTRL_R_RELEASE = "\x1b[114;5:3u";

/** Pi's manager: the TUI definitions plus the application actions this extension cares about. */
export function piKeybindings(userBindings: Record<string, string | string[]> = {}) {
	return new KeybindingsManager({
		...TUI_KEYBINDINGS,
		"app.session.rename": { defaultKeys: "ctrl+r", description: "Rename session" },
		"app.editor.external": { defaultKeys: "ctrl+g", description: "Open external editor" },
	}, userBindings);
}

export const MODEL = { provider: "anthropic", id: "claude-test", api: "anthropic-messages", contextWindow: 1_000_000 } as Model<Api>;
export const OTHER = { provider: "openai-codex", id: "gpt-test", api: "openai-codex-responses", contextWindow: 500_000 } as Model<Api>;
export const SYSTEM = { role: "system", content: "MAIN PROMPT", timestamp: 1 } as Message;
export const USER = { role: "user", content: "Fix the tests.", timestamp: 2 } as Message;

export function assistant(content: AssistantMessage["content"], stopReason: AssistantMessage["stopReason"] = "stop"): AssistantMessage {
	return { role: "assistant", content, api: "anthropic-messages", provider: "anthropic", model: "claude-test", stopReason, timestamp: 3,
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } } as AssistantMessage;
}
export const text = (value: string) => assistant([{ type: "text", text: value }]);
export const suggestion = (value: string | null) => text(JSON.stringify({ suggestion: value }));
export const failure = () => ({ ...assistant([], "error"), errorMessage: "provider exploded" }) as AssistantMessage;

export type Fork = { sessionId: string; model: Model<Api>; context: Context; reasoning?: string; signal: AbortSignal; cooperative?: boolean; offer(run: () => Promise<AssistantMessage>): void; decline?(reason: string): void };
export type Reply = AssistantMessage | Promise<AssistantMessage>;
type Activity = { sessionId: string; state: string; abortedUntil?: number };

export function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>(done => { resolve = done; });
	return { promise, resolve };
}
export const settle = () => new Promise(resolve => setImmediate(resolve));

export function harness({ fork = true, replies = [] as Reply[], prompts = [] as Promise<{ prompt: string } | null>[], consumer = false, keybindings = piKeybindings() as unknown, extraRow = false, width = 80, entry = false, startFocus = undefined as unknown, projection = [USER, text("Tests run.")] as unknown[] } = {}) {
	setKeybindings(keybindings as KeybindingsManager);
	const handlers = new Map<string, ((event: unknown, ctx: unknown) => unknown)[]>();
	const events = createEventBus();
	const clock = { now: 1000 };
	const cleared: number[] = [];
	const gets: AbortSignal[] = [];
	const pi = {
		on(name: string, handler: (event: unknown, ctx: unknown) => unknown) { handlers.set(name, [...(handlers.get(name) ?? []), handler]); },
		events,
		getActiveTools: () => ["read"],
		getAllTools: () => [{ name: "read", description: "Read a file", parameters: { type: "object" } }],
		getThinkingLevel: () => "medium",
	} as unknown as ExtensionAPI;
	// `entry` loads the extension the way Pi does, with its real prompt loader; otherwise the loader is replaced.
	const controller = entry ? (predictions(pi), undefined as never) : install(pi, {
		source: { get(signal) { gets.push(signal); return prompts.shift() ?? Promise.resolve({ prompt: "PREDICT PROMPT" }); } },
		now: () => clock.now,
	}, () => cleared.push(1));

	const state = { idle: true, pending: false, sessionId: "main", branch: [{ type: "message", message: USER }, { type: "message", message: text("Tests run.") }] as unknown[] };
	const sessionManager = {
		getSessionId: () => state.sessionId,
		getEntries: () => state.branch,
		buildSessionProjection: () => ({ messages: projection }),
	};
	const main: { context: Context; options: Record<string, unknown> }[] = [];
	const original = (_model: Model<Api>, context: Context, options: Record<string, unknown>) => { main.push({ context, options }); return "main stream"; };
	const agent = { streamFunction: original as unknown };
	const session = Object.create(AgentSession.prototype) as AgentSession;
	Object.defineProperties(session, { sessionManager: { value: sessionManager }, agent: { value: agent } });
	// Pi's isIdle getter reads this field; RQW-predictions borrows the session through that getter.
	Object.defineProperty(session, "_isAgentRunActive", { get: () => !state.idle });

	const forks: Fork[] = [];
	const provider: { model: Model<Api>; context: Context; options: Record<string, unknown> }[] = [];
	const next = () => Promise.resolve(replies.shift() ?? suggestion("run the tests"));
	if (fork) events.on(CONTEXT_FORK, data => { forks.push(data as Fork); (data as Fork).offer(next); });
	const activity: Activity[] = [];
	events.on(ACTIVITY, data => { activity.push(data as Activity); });

	const statuses: (string | undefined)[] = [];
	const notes: string[] = [];
	const inputListeners: ((data: string) => unknown)[] = [];
	const theme = {
		dim: DIM,
		/** How many times the dim role was painted: a cheap render paints nothing again. */
		paints: 0,
		getBgAnsi: () => "\x1b[48;2;53;28;34m",
		fg(color: string, value: string) {
			if (color !== "dim") return value;
			theme.paints++;
			return `${theme.dim}${value}\x1b[39m`;
		},
	};
	const editor = new CustomEditor({ requestRender() {}, terminal: { rows: 40, columns: 80 } } as never,
		{ borderColor: (value: string) => value, selectList: {} } as never, { matches: () => false } as never);
	// What reaches the editor's own handler: the decoration sits on top of this spy.
	const reached: string[] = [];
	const stockInput = editor.handleInput;
	editor.handleInput = function(this: CustomEditor, data: string) { reached.push(data); stockInput.call(this, data); };
	if (extraRow) {
		const stockRender = editor.render;
		editor.render = function(this: CustomEditor, columns: number) { return [...stockRender.call(this, columns), "EXTRA"]; };
	}
	let renders = 0;
	const tui = { requestRender: () => { renders++; }, getFocusedComponent: () => focus };
	// Pi gives its main editor the submit handler; a replaced editor gets the same one.
	editor.onSubmit = () => {};
	editor.onCtrlD = () => {};
	editor.onAction("app.clear", () => {});
	let focus: unknown = startFocus ?? editor;
	editor.focused = true;
	const ctx = {
		mode: "tui", model: MODEL, sessionManager,
		isIdle: () => (session as unknown as { isIdle: boolean }).isIdle,
		hasPendingMessages: () => state.pending,
		getSystemPrompt: () => "CURRENT PROMPT",
		modelRegistry: {
			streamSimple(model: Model<Api>, context: Context, options: Record<string, unknown>) {
				provider.push({ model, context, options });
				return { result: next };
			},
		},
		ui: {
			theme,
			notify: (message: string) => notes.push(message),
			setStatus: (_key: string, value: string | undefined) => statuses.push(value),
			setWidget: (_key: string, factory: unknown) => { if (typeof factory === "function") (factory as (tui: unknown) => unknown)(tui); },
			onTerminalInput(listener: (data: string) => unknown) { inputListeners.push(listener); return () => { inputListeners.splice(inputListeners.indexOf(listener), 1); }; },
		},
	};
	const fire = (name: string, event: unknown = {}) => { for (const handler of handlers.get(name) ?? []) handler(event, ctx); };
	if (consumer) events.on(ACTIVITY_QUERY, () => {});
	fire("session_start", { reason: "startup" });
	if (consumer) events.emit(ACTIVITY_QUERY, { offer() {} });

	let answers = 0;
	const h = {
		ctx, theme, state, reached, main, forks, provider, notes, statuses, activity, gets, cleared, events, editor, controller, fire, session, clock, original, agent,
		setFocus(component: unknown) { focus = component; },
		/** A main request, as the agent loop makes it. */
		request: (context: Context, options: Record<string, unknown> = { sessionId: "main" }) =>
			(agent.streamFunction as typeof original)(ctx.model, context, options),
		/** The main agent finished an answer: the message ends, then the turn ends. */
		answer(message: AssistantMessage = text("Tests run."), outcome = "completed") {
			h.request({ messages: [SYSTEM, USER] });
			fire("message_end", { message });
			fire("turn_end", { outcome, message, messageEntryId: `answer-${++answers}`, toolResults: [], toolResultEntryIds: [] });
		},
		/** The same turn end again, as a repeated event. */
		repeatTurn(id: string, message: AssistantMessage = text("Tests run.")) {
			fire("turn_end", { outcome: "completed", message, messageEntryId: id, toolResults: [], toolResultEntryIds: [] });
		},
		key(data: string) {
			for (const listener of [...inputListeners]) listener(data);
			(focus as { handleInput?(data: string): void }).handleInput?.(data);
		},
		/** A main request and its answer, without the turn end. */
		ran(message: AssistantMessage = text("Tests run.")) {
			h.request({ messages: [SYSTEM, USER] });
			fire("message_end", { message });
		},
		setModel(model: Model<Api>) { ctx.model = model; fire("model_select", { model }); },
		switchTo(id: string) { fire("session_shutdown", { reason: "new" }); state.sessionId = id; fire("session_start", { reason: "new" }); },
		states: () => activity.map(item => item.state),
		renders: () => renders,
		/** The editor as drawn now, in the harness width. */
		screen: (columns = width) => editor.render(columns),
	};
	return h;
}

export const last = (context: Context) => context.messages.at(-1)!;
