import assert from "node:assert/strict";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { createFauxCore, fauxAssistantMessage } from "@earendil-works/pi-ai";
import { createEventBus, SessionManager } from "@earendil-works/pi-coding-agent";
import { registerSessionRuntime } from "../extensions/RQW-agent/index.ts";
import historyEdit from "../extensions/RQW-history-edit/index.ts";

const REMINDER = "<subagent>\nYou are running as a subagent under a parent agent. Do not spawn additional subagents unless requested by the user or by your instructions.\n</subagent>";

/** RQW-agent's runtime on `parent` with a faux model; Pi's host is the only fake. */
function agentRuntime(parent: SessionManager, cwd: string) {
	const core = createFauxCore({ provider: "persist-test", models: [{ id: "model" }] });
	const model = core.getModel();
	const requests: any[] = [];
	core.setResponses(Array.from({ length: 4 }, () => async (context: any) => { requests.push(context); return fauxAssistantMessage("answer", { timestamp: 1 }); }));
	const modelRuntime = {
		getModel: () => model, getPhysicalModel: () => model, hasConfiguredAuth: () => true, getAuth: async () => ({ apiKey: "fake" }),
		checkAuth: async () => ({}), isUsingOAuth: () => false, getAvailableSnapshot: () => [model], getRegisteredProviderIds: () => [],
		streamSimple: core.streamSimple,
	};
	let definition: any;
	const ctx: any = {
		cwd, sessionManager: parent, model, modelRegistry: { runtime: modelRuntime, find: () => model, hasConfiguredAuth: () => true },
		isIdle: () => true, isProjectTrusted: () => true, getSystemPrompt: () => "original prompt", signal: new AbortController().signal, mode: "tui",
		ui: { notify() {} },
	};
	const pi: any = {
		events: createEventBus(), on() {}, registerTool: (tool: any) => { definition = tool; },
		appendEntry: (name: string, data: any) => parent.appendCustomEntry(name, data),
		getSettings: () => ({ retry: { enabled: false }, compaction: { enabled: false } }),
		getThinkingLevel: () => "off", getActiveTools: () => [],
		sendMessage: (message: any) => parent.appendCustomMessageEntry(message.customType, message.content, message.display, message.details),
	};
	const runtime = registerSessionRuntime(pi, pi.events, false, undefined, undefined, undefined, undefined, undefined, "", undefined);
	return { runtime, requests, execute: (params: any) => definition.execute("call", params, new AbortController().signal, undefined, ctx) };
}

/** Edits the user message `edited` of `parent` through RQW-history-edit's command: pick, submit new text, commit. */
async function editHistory(parent: SessionManager, edited: string) {
	const hooks = new Map<string, (event: any, ctx: any) => unknown>();
	let command: ((args: string, ctx: any) => Promise<void>) | undefined;
	let committed: Promise<void> | undefined;
	const notices: string[] = [];
	const ctx: any = {
		mode: "tui", sessionManager: parent, isIdle: () => true,
		ui: { getEditorText: () => "", setEditorText() {}, notify: (message: string) => notices.push(message), custom: async () => edited },
		navigateTree: async (id: string) => { const target = parent.getEntry(id)!; if (target.parentId) parent.branch(target.parentId); else parent.resetLeaf(); return { cancelled: false }; },
		switchSession: async (_path: string, options: any) => { await options.withSession({ ui: { setEditorText() {} }, sendUserMessage: async () => {} }); return { cancelled: false }; },
	};
	const pi: any = {
		events: createEventBus(), on: (name: string, hook: any) => hooks.set(name, hook),
		registerCommand: (_name: string, options: any) => { command = options.handler; },
		sendUserMessage: () => { committed = command!("", ctx); },
		appendEntry: (name: string, data: unknown) => parent.appendCustomEntry(name, data),
		setLabel: (id: string, label: string | undefined) => parent.appendLabelChange(id, label),
		setSessionName: (name: string) => parent.appendSessionInfo(name),
	};
	historyEdit(pi);
	await command!("", ctx);
	assert.deepEqual(await hooks.get("input")!({ source: "interactive", text: "edited" }, ctx), { action: "handled" });
	await new Promise(resolve => queueMicrotask(() => resolve(undefined)));
	await committed;
	assert.deepEqual(notices, ["Enter truncates history. Esc cancels the edit."]);
}

/** A parent session file with one finished child started after the user message `first`. */
async function parentWithChild(t: TestContext) {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const root = await realpath(await mkdtemp(join(tmpdir(), "agent-history-edit-")));
	t.after(() => rm(root, { recursive: true, force: true }));
	const parent = SessionManager.create(root, join(root, "parent"));
	const first = parent.appendMessage({ role: "user", content: "first", timestamp: 1 });
	const source = agentRuntime(parent, root);
	await source.execute({ action: "start", task: "task", tools: [], role: "R" });
	await source.runtime.wait(new AbortController().signal);
	source.runtime.close();
	return { root, first, path: parent.getSessionFile()!, parent };
}

/** The system prompt agent#1 gets after a restore from the session file alone. */
async function restoredPrompt(path: string, root: string) {
	const restored = agentRuntime(SessionManager.open(path), root);
	await restored.execute({ action: "send", id: "agent#1", task: "again" });
	await restored.runtime.wait(new AbortController().signal);
	restored.runtime.close();
	return restored.requests.at(-1).messages.find((message: any) => message.role === "system").content;
}

const PROMPT = `original prompt\n\n${REMINDER}\n\n<role>\nR\n</role>`;

// Regression: the history rewrite kept child records but dropped the base entry they name, so the child no longer restored.
test("/edit-history before a child's start keeps the child restorable with its exact prompt", async t => {
	const { root, first, path, parent } = await parentWithChild(t);
	await editHistory(parent, first);
	assert.ok(!SessionManager.open(path).getEntries().some(entry => entry.id === first));
	assert.equal(await restoredPrompt(path, root), PROMPT);
});

// Regression: a base already on the kept path was carried again, doubling its copies with every edit.
test("two history edits in a row keep each base text once and the child restorable", async t => {
	const { root, first, path, parent } = await parentWithChild(t);
	await editHistory(parent, first);
	// The second edit cuts after the base: it stays on the kept path.
	const reopened = SessionManager.open(path);
	const second = reopened.appendMessage({ role: "user", content: "second", timestamp: 2 });
	await editHistory(reopened, second);
	assert.equal((await readFile(path, "utf8")).split("original prompt").length - 1, 1);
	assert.equal(await restoredPrompt(path, root), PROMPT);
});
