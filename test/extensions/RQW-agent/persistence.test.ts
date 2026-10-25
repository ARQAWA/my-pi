import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { test, type TestContext } from "node:test";
import { Type } from "typebox";
import { Agent } from "@earendil-works/pi-agent-core";
import { fauxAssistantMessage as answer, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager, type AgentSession } from "@earendil-works/pi-coding-agent";
import { CHILD_ENTRY, createChildManager, installExecutionIntent, openChildManager, repairInterrupted, retainedChildManager } from "../../../extensions/RQW-agent/persistence.ts";

const interrupted = "Interrupted before a durable result was recorded. The tool may already have had side effects; inspect state before deciding what to do. This call was not replayed.";
function root(t: TestContext) {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), "rqw-persistence-")));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	return dir;
}
function user(manager: SessionManager) {
	manager.appendMessage({ role: "user", content: "task", timestamp: 1 });
}
function repair(manager: SessionManager) {
	const agent = new Agent({ streamFn: () => { throw new Error("No model calls allowed"); } });
	const canContinue = repairInterrupted({ agent, sessionManager: manager } as AgentSession);
	assert.deepEqual(agent.state.messages, manager.buildSessionProjection().messages);
	return canContinue;
}

test("durable child roots, reopen, nested roots and memory isolation", t => {
	const cwd = root(t);
	const parent = SessionManager.create(cwd, join(cwd, "parent"));
	user(parent);
	assert.equal(CHILD_ENTRY, "rqw-agent-child");
	const child = createChildManager(parent, cwd, "agent", 1);
	user(child);
	const childFile = child.getSessionFile()!;
	assert.equal(child.getSessionDir(), join(`${parent.getSessionFile()}.children`, "agent-1"));
	const reopened = openChildManager(parent, childFile, cwd, "agent", 1);
	assert.deepEqual(reopened.buildSessionContext(), child.buildSessionContext());
	assert.equal(reopened.getHeader()?.parentSession, parent.getSessionFile());
	const grandchild = createChildManager(child, cwd, "agent", 2);
	user(grandchild);
	assert.equal(grandchild.getSessionDir(), join(`${childFile}.children`, "agent-2"));
	assert.equal(createChildManager(SessionManager.inMemory(cwd), cwd, "agent", 1).getSessionFile(), undefined);
	assert.throws(() => openChildManager(SessionManager.inMemory(cwd), childFile, cwd, "agent", 1), /in-memory/);
	assert.throws(() => createChildManager(parent, cwd, "../escape", 1), /Invalid/);
	assert.throws(() => createChildManager(parent, cwd, "agent", 0), /Invalid/);
	assert.throws(() => openChildManager(parent, childFile, cwd, "agent", 2), /outside/);
	assert.throws(() => openChildManager(parent, parent.getSessionFile()!, cwd, "agent", 1), /outside/);
	assert.throws(() => openChildManager(parent, child.getSessionDir(), cwd, "agent", 1), /outside/);
});

test("retained memory children are caller-scoped and replaced on restart", t => {
	const cwd = root(t);
	const parent = SessionManager.inMemory(cwd);
	const unrelated = SessionManager.inMemory(cwd);
	assert.equal(retainedChildManager(parent, "agent", 1), undefined);
	const child = createChildManager(parent, cwd, "agent", 1);
	user(child);
	const nested = createChildManager(child, cwd, "agent", 2);
	assert.equal(retainedChildManager(parent, "agent", 1), child);
	assert.equal(retainedChildManager(child, "agent", 2), nested);
	assert.equal(retainedChildManager(unrelated, "agent", 1), undefined);
	assert.equal(retainedChildManager(parent, "agent", 2), undefined);
	const replacement = createChildManager(parent, cwd, "agent", 1);
	assert.notEqual(replacement, child);
	assert.equal(retainedChildManager(parent, "agent", 1), replacement);
	assert.equal(retainedChildManager(replacement, "agent", 2), undefined);
	assert.deepEqual(replacement.buildSessionContext().messages, []);
	assert.deepEqual(readdirSync(cwd), []);
});

test("raw tmpdir and trusted parent-directory aliases are accepted", t => {
	const cwd = mkdtempSync(join(tmpdir(), "rqw-persistence-raw-"));
	t.after(() => rmSync(cwd, { recursive: true, force: true }));
	const target = join(cwd, "trusted-target");
	const alias = join(cwd, "trusted-alias");
	mkdirSync(target);
	symlinkSync(target, alias, "dir");
	for (const base of [cwd, alias]) {
		const parent = SessionManager.create(cwd, join(base, "sessions"));
		user(parent);
		const child = createChildManager(parent, cwd, "agent", 1);
		user(child);
		const reopened = openChildManager(parent, child.getSessionFile()!, cwd, "agent", 1);
		assert.deepEqual(reopened.buildSessionContext(), child.buildSessionContext());
	}
});

test("owned files, directories and ancestors cannot be symlinks", t => {
	const cwd = root(t);
	const parent = SessionManager.create(cwd, join(cwd, "parent"));
	user(parent);
	const child = createChildManager(parent, cwd, "agent", 1);
	user(child);
	const alias = join(child.getSessionDir(), "alias.jsonl");
	symlinkSync(child.getSessionFile()!, alias);
	assert.throws(() => openChildManager(parent, alias, cwd, "agent", 1), /Unsafe/);
	const sibling = join(`${parent.getSessionFile()}.children`, "agent-2");
	symlinkSync(child.getSessionDir(), sibling, "dir");
	assert.throws(() => createChildManager(parent, cwd, "agent", 2), /Unsafe/);
	assert.throws(() => openChildManager(parent, join(sibling, basename(child.getSessionFile()!)), cwd, "agent", 2), /Unsafe/);
});

test("failed assistant attempts are omitted append-only and completed assistants remain", t => {
	const cwd = root(t);
	const manager = SessionManager.create(cwd, join(cwd, "sessions"));
	user(manager);
	manager.appendMessage(answer("cut off", { stopReason: "aborted" }));
	manager.appendMessage(answer("failed", { stopReason: "error" }));
	const before = readFileSync(manager.getSessionFile()!, "utf8");
	assert.equal(repair(manager), true);
	assert.ok(readFileSync(manager.getSessionFile()!, "utf8").startsWith(before));
	assert.deepEqual(manager.buildSessionContext().messages.map(m => m.role), ["user"]);
	assert.equal(manager.getEntries().filter(e => e.type === "context_edit").length, 2);
	manager.appendMessage(answer("finished"));
	const entries = manager.getEntries().length;
	assert.equal(repair(manager), false);
	assert.equal(manager.getEntries().length, entries);
	assert.equal(repair(SessionManager.inMemory(cwd)), false);
});

for (const stopReason of ["toolUse", "aborted", "error"] as const) {
	test(`missing results repaired without replay for ${stopReason}`, t => {
		const cwd = root(t);
		const manager = SessionManager.create(cwd, join(cwd, "sessions"));
		user(manager);
		manager.appendMessage(answer([fauxToolCall("read", { path: "a" }, { id: "one" }), fauxToolCall("write", {}, { id: "two" })], { stopReason }));
		manager.appendMessage({ role: "toolResult", toolCallId: "one", toolName: "read", content: [{ type: "text", text: "done" }], isError: false, timestamp: 2 });
		manager.appendMessage(answer("cut off after results", { stopReason: "aborted" }));
		const before = readFileSync(manager.getSessionFile()!, "utf8");
		assert.equal(repair(manager), true);
		const messages = manager.buildSessionContext().messages;
		assert.deepEqual(messages.map(m => m.role), ["user", "assistant", "toolResult", "toolResult"]);
		assert.deepEqual(messages.at(-1), { role: "toolResult", toolCallId: "two", toolName: "write", content: [{ type: "text", text: interrupted }], isError: true, timestamp: messages.at(-1)!.timestamp });
		assert.ok(readFileSync(manager.getSessionFile()!, "utf8").startsWith(before));
		const count = manager.getEntries().length;
		assert.equal(repair(manager), true);
		assert.equal(manager.getEntries().length, count);
		assert.deepEqual(SessionManager.open(manager.getSessionFile()!).buildSessionContext(), manager.buildSessionContext());
	});
}

test("all missing results are appended in memory and no files are created", t => {
	const cwd = root(t);
	const manager = SessionManager.inMemory(cwd);
	user(manager);
	manager.appendMessage(answer([fauxToolCall("write", {}, { id: "a" }), fauxToolCall("write", {}, { id: "b" })], { stopReason: "aborted" }));
	assert.equal(repair(manager), true);
	assert.equal(manager.getSessionFile(), undefined);
	assert.deepEqual(manager.buildSessionContext().messages.filter(m => m.role === "toolResult").map(m => m.toolCallId), ["a", "b"]);
	assert.equal(manager.getEntries().filter(e => e.type === "context_edit").length, 0);
	assert.deepEqual(readdirSync(cwd), []);
});

test("history without any user message cannot continue", t => {
	const manager = SessionManager.inMemory(root(t));
	assert.equal(repair(manager), false);
	manager.appendMessage({ role: "toolResult", toolCallId: "orphan-result", toolName: "read", content: [], isError: true, timestamp: 1 });
	assert.equal(repair(manager), false);
});

test("interior orphan fails safely without any partial edits", t => {
	const cwd = root(t);
	const manager = SessionManager.inMemory(cwd);
	user(manager);
	manager.appendMessage(answer(fauxToolCall("write", {}, { id: "orphan" }), { stopReason: "toolUse" }));
	manager.appendMessage(answer("later finalized answer"));
	manager.appendMessage(answer("failed", { stopReason: "error" }));
	const entries = manager.getEntries();
	assert.throws(() => repair(manager), /Unsafe recovery.*interrupted tool call/);
	assert.deepEqual(manager.getEntries(), entries);
});

for (const fails of [false, true]) {
	test(`real SDK tool_call intent ${fails ? "failure blocks execution" : "precedes execution"}`, async t => {
		const cwd = root(t);
		const agentDir = join(cwd, "home");
		mkdirSync(agentDir);
		const manager = SessionManager.create(cwd, join(cwd, "sessions"));
		const settingsManager = SettingsManager.inMemory({ cacheWarming: "off", retry: { enabled: false } });
		const provider = fauxProvider();
		provider.setResponses([answer(fauxToolCall("effect", {}, { id: "intent-call" }), { stopReason: "toolUse" }), answer("done")]);
		const runtime = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: null, refreshOnCreate: false });
		runtime.registerNativeProvider(provider.provider);
		const loader = new DefaultResourceLoader({ cwd, agentDir, settingsManager,
			noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
			extensionFactories: [pi => installExecutionIntent(pi, manager)] });
		await loader.reload();
		assert.deepEqual(loader.getExtensions().errors, []);
		let executions = 0;
		const { session } = await createAgentSession({ cwd, agentDir, modelRuntime: runtime, model: provider.getModel(),
			settingsManager, sessionManager: manager, resourceLoader: loader, tools: ["effect"],
			customTools: [{ name: "effect", label: "Effect", description: "Test side effect", parameters: Type.Object({}),
				execute: async () => {
					executions++;
					const disk = SessionManager.open(manager.getSessionFile()!).getEntries();
					const intent = disk.find(e => e.type === "custom" && e.customType === "rqw-agent-tool-intent");
					assert.ok(intent && intent.type === "custom");
					assert.deepEqual(intent.data, { version: 1, toolCallId: "intent-call", toolName: "effect", args: {} });
					return { content: [{ type: "text", text: "effect happened" }] };
				} }] });
		t.after(() => session.dispose());
		await session.bindExtensions({ mode: "print" });
		if (fails) t.mock.method(manager, "appendCustomEntry", () => { throw new Error("intent persistence failed"); });
		await session.prompt("execute effect");
		assert.equal(executions, fails ? 0 : 1);
		if (fails) {
			const result = session.messages.find(m => m.role === "toolResult");
			assert.ok(result && result.role === "toolResult" && result.isError);
			assert.match(JSON.stringify(result.content), /intent persistence failed/);
		}
	});
}
