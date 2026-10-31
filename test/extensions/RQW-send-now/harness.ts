import { type TestContext } from "node:test";
import { AgentSession, CustomEditor, createEventBus, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import sendNow from "../../../extensions/RQW-send-now/index.ts";

export const ESC = "\x1b";
export const CTRL_ENTER = "\x1b[13;5u";
export const CTRL_ENTER_OTHER_KEYS = "\x1b[27;5;13~";
export const ALT_ENTER = "\x1b\r";

/** Pi's session with its queues as plain data; the queue methods are Pi's real ones. */
export function fakeSession(manager: object, onAbort: () => void, onRun: (trigger: any) => void = () => {}) {
	const session: any = Object.create(AgentSession.prototype);
	session.sessionManager = manager;
	session._steeringMessages = [];
	session._followUpMessages = [];
	session.emits = 0;
	session.aborts = 0;
	session.started = 0;
	session.agent = {
		steeringQueue: { messages: [] as any[] }, followUpQueue: { messages: [] as any[] },
		steer(message: unknown) { this.steeringQueue.messages.push(message); },
		followUp(message: unknown) { this.followUpQueue.messages.push(message); },
	};
	session._emitQueueUpdate = () => { session.emits++; };
	session.getSteeringMessages = () => session._steeringMessages;
	// Getters on Pi's prototype; plain data here.
	for (const [name, value] of [["promptTemplates", []], ["isStreaming", true]] as const) Object.defineProperty(session, name, { value, writable: true, configurable: true });
	session._expandSkillCommand = (text: string) => text;
	session._runInputHandlers = async (text: string, images: unknown) => ({ text, images });
	// Pi's run path: what a force-send starts, without input handlers.
	session._startRun = async (trigger: any, onStarted?: () => void) => { session.started++; onRun(trigger); onStarted?.(); };
	session.abort = async () => { session.aborts++; session.isStreaming = false; onAbort(); };
	session.clearQueue = () => {
		const cleared = { steering: [...session._steeringMessages], followUp: [...session._followUpMessages] };
		session._steeringMessages = []; session._followUpMessages = [];
		session.agent.steeringQueue.messages = []; session.agent.followUpQueue.messages = [];
		return cleared;
	};
	return session;
}

/** A TUI session with a fake clock; `state` is what a test flips between presses. */
export function harness(t: TestContext, options: { factory?: typeof sendNow; provider?: string } = {}) {
	t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 10_000 });
	t.mock.method(AgentSession.prototype as any, "_bindExtensionCore", function() {});
	const events = createEventBus();
	const handlers = new Map<string, ((event: any, ctx: any) => unknown)[]>();
	/** The runs a force-send started. */
	const sent: unknown[] = [];
	const entries: unknown[] = [];
	const stops: unknown[] = [];
	const notices: string[] = [];
	const inputs: string[] = [];
	const state = { idle: false, compacting: false, background: 0, editor: "", autocomplete: false, focused: true, provider: options.provider ?? "openai-codex", model: true, ctrlAborts: 0 };
	events.on("rqw:stop-background:v1", (value: any) => { stops.push(value); value.reply({ agents: state.background }); });
	events.on("rqw:running-counts:request", (request: any) => request.reply({ version: 1, snapshot: () => ({ agents: state.background }), subscribe: () => () => {} }));
	const pi = {
		events, registerShortcut() {}, appendEntry: (_type: string, data: unknown) => entries.push(data), sendUserMessage() {},
		on: (name: string, handler: any) => { handlers.set(name, [...(handlers.get(name) ?? []), handler]); },
	};
	(options.factory ?? sendNow)(pi as unknown as ExtensionAPI);
	let input: ((data: string) => unknown) | undefined;
	const editor = Object.assign(Object.create(CustomEditor.prototype), {
		isShowingAutocomplete: () => state.autocomplete,
		actionHandlers: new Map([["app.message.followUp", () => inputs.push("follow-up")]]),
		handleInput: (data: string) => inputs.push(data),
	});
	const manager = { getEntries: () => [] as unknown[], getSessionId: () => "session" };
	const session = fakeSession(manager, () => { state.idle = true; }, (trigger) => sent.push({ prompt: trigger.prompt, images: trigger.images ?? [] }));
	const ctx = {
		mode: "tui", get model() { return state.model ? { provider: state.provider } : undefined; }, sessionManager: manager,
		hasPendingMessages: () => session._steeringMessages.length + session._followUpMessages.length > 0, isIdle: () => state.idle,
		// Pi's own abort: both queues go back to the editor, then the run stops.
		abort: () => {
			state.ctrlAborts++; state.idle = true; session.isStreaming = false;
			const cleared = session.clearQueue();
			state.editor = [...cleared.steering, ...cleared.followUp, state.editor].filter(Boolean).join("\n\n");
		},
		ui: {
			getEditorText: () => state.editor, setEditorText: (value: string) => { state.editor = value; }, notify: (text: string) => notices.push(text),
			setWidget: (_key: string, factory: any) => { if (factory) factory({ getFocusedComponent: () => state.focused ? editor : {} }); },
			onTerminalInput: (handler: typeof input) => { input = handler; return () => {}; },
		},
	} as unknown as ExtensionContext;
	Object.defineProperty(session, "isCompacting", { get: () => state.compacting });
	session._bindExtensionCore();
	const fire = (name: string, event: any = {}) => (handlers.get(name) ?? []).map((handler) => handler(event, ctx));
	fire("session_start");
	t.after(() => fire("session_shutdown"));
	return {
		state, session, sent, entries, stops, notices, inputs, ctx, fire, events, manager,
		press: (data = ESC) => input!(data),
		tick: (ms: number) => t.mock.timers.tick(ms),
		/** Lets promise chains finish; the fake clock does not touch setImmediate. */
		flush: () => new Promise<void>((resolve) => setImmediate(resolve)),
		/** A steering message queued through Pi's real queue method. */
		steer: (text: string, images?: unknown[]) => session._queueSteer(text, images),
		followUp: (text: string) => { session._followUpMessages.push(text); session.agent.followUp({ role: "user", content: [{ type: "text", text }], timestamp: 1 }); },
		shutdown: () => fire("session_shutdown"),
	};
}
