// Pi's real InteractiveMode on a scripted terminal, a faux streaming model, and only this extension loaded.
// Keys go through Pi's own TUI input path: extension listeners, then the focused editor or dialog.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, it } from "node:test";
import { fileURLToPath } from "node:url";
import { type AssistantMessage, fauxAssistantMessage, fauxProvider, type Message } from "@earendil-works/pi-ai";
import { getKeybindings, isKeyRelease } from "@earendil-works/pi-tui";
import {
	type AgentSession,
	type AgentSessionRuntime,
	createAgentSessionFromServices,
	createAgentSessionRuntime,
	createAgentSessionServices,
	CustomEditor,
	type ExtensionAPI,
	type ExtensionContext,
	initTheme,
	InteractiveMode,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { ENTRY, keptReply } from "../../../extensions/RQW-send-now/index.ts";

const EXTENSION = join(dirname(fileURLToPath(import.meta.url)), "../../../extensions/RQW-send-now", "index.ts");
const { transformMessages } = await import(new URL("./dist/api/transform-messages.js",
	new URL("..", import.meta.resolve("@earendil-works/pi-ai"))).href) as {
	transformMessages: (messages: Message[], model: unknown) => Message[];
};

const LONG = Array.from({ length: 400 }, (_, i) => `word${i}`).join(" ");
const ENTER = "\r";
const ALT_ENTER = "\x1b\r";
/** Pi's dequeue key: Alt+Up, Alt+Q on Windows. */
function dequeueKey(): string {
	const key = ["\x1b[1;3A", "\x1b\x1b[A", "\x1bq"].find((data) => getKeybindings().matches(data, "app.message.dequeue"));
	assert.ok(key, "Pi's dequeue key is one of the defaults");
	return key;
}
/** Pi's follow-up key: Alt+Enter, Ctrl+Q on Windows. Read from the keybindings Pi's interactive mode installed. */
function followUpKey(): string {
	const key = [ALT_ENTER, "\x11"].find((data) => getKeybindings().matches(data, "app.message.followUp"));
	assert.ok(key, "Pi's follow-up key is one of the defaults");
	return key;
}

let root: string;
const savedEnv = { ...process.env };
before(() => {
	root = mkdtempSync(join(tmpdir(), "rqw-send-now-"));
	// Pi reads keybindings and settings from here, never from the owner's ~/.pi.
	process.env.PI_CODING_AGENT_DIR = join(root, "agent");
	process.env.PI_OFFLINE = "1";
	mkdirSync(process.env.PI_CODING_AGENT_DIR, { recursive: true });
	initTheme("dark", false);
});
after(() => {
	process.env = savedEnv;
	rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

/** A terminal that records nothing and lets the test type. */
class ScriptedTerminal {
	onInput: ((data: string) => void) | undefined;
	start(onInput: (data: string) => void) { this.onInput = onInput; }
	stop() {}
	async drainInput() {}
	write() {}
	get columns() { return 100; }
	get rows() { return 40; }
	get kittyProtocolActive() { return false; }
	moveBy() {} hideCursor() {} showCursor() {} clearLine() {} clearFromCursor() {} clearScreen() {}
	setTitle() {} setProgress() {} setProgramStatus() {}
	type(text: string) { for (const ch of text) this.onInput!(ch); }
	key(data: string) { this.onInput!(data); }
}

async function until(what: string, check: () => boolean, ms = 10_000) {
	const end = Date.now() + ms;
	while (!check()) {
		if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 50));

type Harness = {
	session: AgentSession; terminal: ScriptedTerminal; mode: InteractiveMode; runtime: AgentSessionRuntime;
	requests: Message[][]; streamed: () => string; editor: () => string; helper: () => ExtensionContext;
	dispose(): Promise<void>;
};

/** Pi's interactive mode with this extension (unless `off`) and a test helper that only exposes its context. */
async function start(name: string, options: { off?: boolean; beforeStart?: () => Promise<void> } = {}): Promise<Harness> {
	const cwd = join(root, name);
	mkdirSync(cwd, { recursive: true });
	const agentDir = process.env.PI_CODING_AGENT_DIR!;
	const requests: Message[][] = [];
	// Slow first reply, so keys arrive while it streams; later replies answer at once.
	const faux = fauxProvider({ api: `faux-${name}`, provider: `faux-${name}`, models: [{ id: "m" }], tokensPerSecond: 400, tokenSize: { min: 1, max: 1 } });
	faux.setResponses([
		(context) => { requests.push(structuredClone(context.messages) as Message[]); return fauxAssistantMessage(LONG); },
		...Array.from({ length: 4 }, () => (context: { messages: unknown[] }) => {
			requests.push(structuredClone(context.messages) as Message[]);
			return fauxAssistantMessage("done");
		}),
	]);
	const modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: null, refreshOnCreate: false });
	faux.provider.auth.apiKey = { name: "Fake key", resolve: async () => ({ auth: { apiKey: "fake" } }) };
	modelRuntime.registerNativeProvider(faux.provider);
	await modelRuntime.setRuntimeApiKey(`faux-${name}`, "fake");
	let helperCtx: ExtensionContext | undefined;
	const helper = (pi: ExtensionAPI) => {
		pi.on("session_start", (_event, ctx) => { helperCtx = ctx; });
		// A slow before_agent_start handler, as some extensions have: the run is busy before its prompt is emitted.
		pi.on("before_agent_start", async () => { await options.beforeStart?.(); });
	};
	const runtime = await createAgentSessionRuntime(async ({ cwd, sessionManager, sessionStartEvent }) => {
		const services = await createAgentSessionServices({
			cwd, agentDir, modelRuntime,
			settingsManager: SettingsManager.inMemory({ retry: { enabled: false }, quietStartup: true }),
			resourceLoaderOptions: {
				additionalExtensionPaths: options.off ? [] : [EXTENSION],
				extensionFactories: [{ name: "test-helper", factory: helper }],
				noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
			},
		});
		const created = await createAgentSessionFromServices({ services, sessionManager, sessionStartEvent, model: faux.getModel("m"), thinkingLevel: "off" });
		return { ...created, services, diagnostics: services.diagnostics };
	}, { cwd, agentDir, sessionManager: SessionManager.inMemory(cwd) });
	const terminal = new ScriptedTerminal();
	const mode = new InteractiveMode(runtime, { terminal: terminal as never });
	await mode.init();
	const session = runtime.session;
	assert.deepEqual(session.resourceLoader.getExtensions().errors, []);
	let streamed = "";
	session.subscribe((event) => {
		if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") streamed += event.assistantMessageEvent.delta;
	});
	return {
		session, terminal, mode, runtime, requests,
		streamed: () => streamed,
		editor: () => helperCtx!.ui.getEditorText(),
		helper: () => helperCtx!,
		async dispose() {
			if (!session.isIdle) await session.abort();
			mode.stop();
			await runtime.dispose();
		},
	};
}

/** Stop reasons of the assistant replies so far. */
const replies = (h: Harness) => h.session.messages.flatMap((m) => (m.role === "assistant" ? [(m as AssistantMessage).stopReason] : []));

/** Start the slow reply and wait until it is visibly streaming. */
async function streaming(h: Harness) {
	void h.session.prompt("start");
	await until("streaming text", () => h.streamed().length > 20);
}

/** Type a steering message and press Enter, as the owner does while the agent works. */
async function steer(h: Harness, text: string) {
	h.terminal.type(text);
	h.terminal.key(ENTER);
	await until("steering queued", () => h.session.getSteeringMessages().length > 0);
}

it("keys: Enter is Pi's submit key on every terminal encoding; key release and Alt+Enter are not", () => {
	const keys = getKeybindings();
	for (const enter of ["\r", "\x1b[13u", "\x1b[13;1u"]) assert.ok(keys.matches(enter, "tui.input.submit"), JSON.stringify(enter));
	assert.ok(isKeyRelease("\x1b[13;1:3u"));
	assert.ok(!keys.matches(ALT_ENTER, "tui.input.submit"));
	assert.ok(!keys.matches("\x1b[200~\r\x1b[201~", "tui.input.submit"), "a pasted newline is not a key press");
});

it("empty Enter with queued steering interrupts the turn and sends the queue at once", async () => {
	const h = await start("force");
	try {
		await streaming(h);
		await steer(h, "steer me");
		assert.ok(h.session.isStreaming, "Enter with text only queues the message, as stock Pi does");
		assert.equal(h.editor(), "");

		h.terminal.key(ENTER);
		await until("the queued message was answered", () => h.requests.length === 2 && h.session.isIdle);

		const messages = h.session.messages.filter((m) => m.role !== "system") as Message[];
		assert.deepEqual(messages.map((m) => m.role === "assistant" ? `assistant:${m.stopReason}` : m.role),
			["user", "assistant:aborted", "user", "assistant:stop"]);
		const interrupted = messages[1] as AssistantMessage;
		const partial = interrupted.content.map((b) => (b.type === "text" ? b.text : "")).join("");
		assert.ok(partial.length > 0 && partial.length < LONG.length && LONG.startsWith(partial), "the turn was cut while streaming");
		assert.equal((messages[2].content as { text: string }[])[0].text, "steer me");
		assert.equal(h.editor(), "", "the editor is empty afterwards");
		assert.equal(h.session.pendingMessageCount, 0);

		// The model sees the interrupted text as a finished reply before the new message, like oh-my-pi.
		const request = h.requests[1].filter((m) => m.role !== "system");
		const roles = request.map((m) => m.role === "assistant" ? `assistant:${m.stopReason}` : m.role);
		assert.deepEqual(roles, ["user", "assistant:stop", "user"]);
		assert.deepEqual((request[1] as AssistantMessage).content, [{ type: "text", text: partial }]);
		const replayed = transformMessages(h.requests[1], h.session.model).filter((m) => m.role === "assistant");
		assert.equal(replayed.length, 1, "pi-ai keeps it; an aborted reply would be dropped");
		// The choice is recorded in the session, so a resumed session builds the same request.
		const entries = h.session.sessionManager.getEntries().filter((e) => e.type === "custom" && e.customType === ENTRY);
		assert.deepEqual(entries.map((e) => (e as { data: unknown }).data), [{ timestamp: interrupted.timestamp }]);
		await h.session.reload();
		await h.session.prompt("again");
		const later = h.requests[2].filter((m) => m.role !== "system");
		assert.deepEqual(later.slice(0, 3).map((m) => m.role === "assistant" ? `assistant:${m.stopReason}` : m.role),
			["user", "assistant:stop", "user"], "after /reload the next request keeps the same history");
	} finally {
		await h.dispose();
	}
});

it("works the same in a custom editor that extends Pi's CustomEditor, as RQW-statusbar installs", async () => {
	const h = await start("custom-editor");
	try {
		class OtherEditor extends CustomEditor {}
		h.helper().ui.setEditorComponent((tui, theme, keybindings) => new OtherEditor(tui, theme, keybindings));
		await streaming(h);
		await steer(h, "steer me");
		h.terminal.key(ENTER);
		await until("the queued message was answered", () => h.requests.length === 2 && h.session.isIdle);
		const users = h.session.messages.filter((m) => m.role === "user") as Message[];
		assert.deepEqual(users.map((m) => (m.content as { text: string }[])[0].text), ["start", "steer me"]);
		assert.deepEqual(replies(h), ["aborted", "stop"]);
		assert.equal(h.editor(), "");
	} finally {
		await h.dispose();
	}
});

it("text, Enter and Enter in one terminal chunk force-send the message that was still on its way to the queue", async () => {
	const h = await start("batch");
	try {
		await streaming(h);
		// One stdin chunk: Pi dispatches its keys synchronously, before the first Enter's message is queued.
		h.terminal.type("steer me");
		h.terminal.key(ENTER);
		assert.equal(h.session.pendingMessageCount, 0, "Pi has not queued it yet");
		h.terminal.key(ENTER);
		await until("the queued message was answered", () => h.requests.length === 2 && h.session.isIdle);
		const users = h.session.messages.filter((m) => m.role === "user") as Message[];
		assert.deepEqual(users.map((m) => (m.content as { text: string }[])[0].text), ["start", "steer me"]);
		assert.deepEqual(replies(h), ["aborted", "stop"], "the reply was interrupted, not waited out");
		assert.equal(h.session.pendingMessageCount, 0, "nothing is stranded in Pi's queue");
		assert.equal(h.editor(), "");
	} finally {
		await h.dispose();
	}
});

it("steering queued while the run prepares is still counted after the run's own prompt", async () => {
	let release!: () => void;
	let gate: Promise<void> | undefined = new Promise<void>((resolve) => { release = resolve; });
	const h = await start("preparing", { beforeStart: async () => { const g = gate; gate = undefined; await g; } });
	try {
		void h.session.prompt("start");
		await until("the run is busy preparing", () => h.session.isStreaming);
		await steer(h, "s1");
		h.terminal.type("s2");
		h.terminal.key(ENTER);
		await until("two steering messages queued", () => h.session.getSteeringMessages().length === 2);
		release();
		// Pi delivers one steering message per turn: s1 goes with the prompt, s2 waits.
		await until("streaming text", () => h.streamed().length > 20);
		assert.deepEqual(h.session.getSteeringMessages(), ["s2"]);
		h.terminal.key(ENTER);
		await until("the queued message was answered", () => h.requests.length === 2 && h.session.isIdle);
		const users = h.session.messages.filter((m) => m.role === "user") as Message[];
		assert.deepEqual(users.map((m) => (m.content as { text: string }[])[0].text), ["start", "s1", "s2"]);
		assert.deepEqual(replies(h), ["aborted", "stop"], "the reply was interrupted, not waited out");
		assert.equal(h.session.pendingMessageCount, 0);
	} finally {
		release();
		await h.dispose();
	}
});

it("empty Enter with nothing queued does nothing, as in stock Pi", async () => {
	const h = await start("empty");
	try {
		await streaming(h);
		h.terminal.key(ENTER);
		await tick();
		assert.ok(h.session.isStreaming, "the turn goes on");
		await until("the reply finished", () => h.session.isIdle);
		const last = h.session.messages.at(-1) as AssistantMessage;
		assert.equal(last.stopReason, "stop");
		assert.equal(h.requests.length, 1);
	} finally {
		await h.dispose();
	}
});

it("a follow-up-only queue is left to Pi: empty Enter does nothing", async () => {
	const h = await start("followup");
	try {
		await streaming(h);
		h.terminal.type("later");
		h.terminal.key(followUpKey());
		await until("follow-up queued", () => h.session.getFollowUpMessages().length === 1);
		h.terminal.key(ENTER);
		await tick();
		assert.ok(h.session.isStreaming);
		assert.equal(h.session.getFollowUpMessages().length, 1);
	} finally {
		await h.dispose();
	}
});

it("a dialog keeps its own Enter while steering is queued", async () => {
	const h = await start("dialog");
	try {
		await streaming(h);
		await steer(h, "steer me");
		const dialog = new AbortController();
		const answer = h.helper().ui.select("Pick", ["first", "second"], { signal: dialog.signal });
		await tick();
		h.terminal.key(ENTER);
		const timeout = setTimeout(() => dialog.abort(), 2000);
		assert.equal(await answer, "first", "the dialog got the Enter");
		clearTimeout(timeout);
		assert.ok(h.session.isStreaming, "the turn was not interrupted");
		assert.deepEqual(h.session.getSteeringMessages(), ["steer me"]);
	} finally {
		await h.dispose();
	}
});

it("switched off: empty Enter leaves the queued steering alone, as in stock Pi", async () => {
	const h = await start("off", { off: true });
	try {
		await streaming(h);
		await steer(h, "steer me");
		h.terminal.key(ENTER);
		await tick();
		assert.ok(h.session.isStreaming);
		assert.deepEqual(h.session.getSteeringMessages(), ["steer me"]);
	} finally {
		await h.dispose();
	}
});

it("if the session ends before the interrupted turn settles, the text goes back to the editor", async () => {
	const h = await start("shutdown");
	// Hold the end of the aborted run in an awaited agent listener, as a slow agent_end handler would.
	let release!: () => void;
	const held = new Promise<void>((resolve) => { release = resolve; });
	const gate = h.session.agent.subscribe(async (event) => { if (event.type === "agent_end") await held; });
	try {
		await streaming(h);
		await steer(h, "keep me");
		h.terminal.key(ENTER);
		await tick();
		assert.equal(h.editor(), "", "the queue left the editor for sending");
		assert.ok(!h.session.isIdle, "the aborted run has not settled yet");
		await h.session.extensionRunner.emit({ type: "session_shutdown", reason: "reload" });
		assert.equal(h.editor(), "keep me");
		release();
		await until("idle", () => h.session.isIdle);
		await tick();
		assert.equal(h.requests.length, 1, "nothing was sent after the session ended");
	} finally {
		release();
		gate();
		await h.dispose();
	}
});

it("keys batched in one chunk, then the session ends before the abort settles: the late steering and the draft stay", async () => {
	const h = await start("batch-shutdown");
	let release!: () => void;
	const held = new Promise<void>((resolve) => { release = resolve; });
	const gate = h.session.agent.subscribe(async (event) => { if (event.type === "agent_end") await held; });
	try {
		await streaming(h);
		h.terminal.type("steer me");
		h.terminal.key(ENTER);
		h.terminal.key(ENTER);
		await tick();
		assert.ok(!h.session.isIdle, "the aborted run has not settled yet");
		assert.ok(h.session.pendingMessageCount > 0, "the steering landed in Pi's queue after the abort");
		h.terminal.type("draft");
		await h.session.extensionRunner.emit({ type: "session_shutdown", reason: "new" });
		assert.equal(h.editor(), "steer me\n\ndraft");
		assert.equal(h.session.pendingMessageCount, 0);
		release();
		await until("idle", () => h.session.isIdle);
		await tick();
		assert.equal(h.requests.length, 1, "nothing was sent after the session ended");
	} finally {
		release();
		gate();
		await h.dispose();
	}
});

it("steering dequeued with Pi's key and requeued as a follow-up is a follow-up-only queue: empty Enter does nothing", async () => {
	const h = await start("dequeue");
	try {
		await streaming(h);
		await steer(h, "s1");
		await tick();
		h.terminal.key(dequeueKey());
		await until("dequeued into the editor", () => h.session.pendingMessageCount === 0 && h.editor() === "s1");
		h.terminal.key(followUpKey());
		await until("follow-up queued", () => h.session.getFollowUpMessages().length === 1);
		h.terminal.key(ENTER);
		await tick();
		assert.ok(h.session.isStreaming, "the turn was not interrupted");
		assert.deepEqual(h.session.getFollowUpMessages(), ["s1"]);
	} finally {
		await h.dispose();
	}
});

it("several queued messages, follow-ups included, go as one message in queue order", async () => {
	const h = await start("several");
	try {
		await streaming(h);
		await steer(h, "one");
		await steer(h, "two");
		h.terminal.type("three");
		h.terminal.key(followUpKey());
		await until("follow-up queued", () => h.session.getFollowUpMessages().length === 1);
		h.terminal.key(ENTER);
		await until("the queued messages were answered", () => h.requests.length === 2 && h.session.isIdle);
		const users = h.session.messages.filter((m) => m.role === "user") as Message[];
		assert.deepEqual(users.map((m) => (m.content as { text: string }[])[0].text), ["start", "one\n\ntwo\n\nthree"]);
		assert.equal(h.session.pendingMessageCount, 0);
		assert.equal(h.editor(), "");
	} finally {
		await h.dispose();
	}
});

it("keptReply keeps only non-empty text as a finished reply", () => {
	const base = { role: "assistant", api: "x", provider: "x", model: "x", usage: {} as never, timestamp: 1, stopReason: "aborted", errorMessage: "Request was aborted" } as const;
	assert.equal(keptReply({ ...base, content: [{ type: "thinking", thinking: "hm" }] } as AssistantMessage), undefined);
	const kept = keptReply({ ...base, content: [{ type: "thinking", thinking: "hm" }, { type: "text", text: "half", textSignature: "sig" },
		{ type: "toolCall", id: "c", name: "read", arguments: {} }] } as AssistantMessage)!;
	assert.deepEqual(kept.content, [{ type: "text", text: "half" }]);
	assert.equal(kept.stopReason, "stop");
	assert.ok(!("errorMessage" in kept));
});
