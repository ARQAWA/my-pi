// Real caller and worker sessions; only RQW-agent is loaded. All inference and credentials are faux/offline.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test, type TestContext } from "node:test";
import { fauxProvider, fauxToolCall, getSystemMessageText, type TranscriptContext, type SimpleStreamOptions } from "@earendil-works/pi-ai";
import { AgentSession, createBashToolDefinition } from "@earendil-works/pi-coding-agent";
import { answer, fixture, gate, tick, until } from "./audit-fixture.ts";
import { blockedGit } from "../git-guard.ts";
import type { WorkerRole } from "../worker-model.ts";

const ROLES: WorkerRole[] = ["code_writer", "shell_runner"];
const toolNames = (context: TranscriptContext) => {
	const names = new Set<string>();
	for (const message of context.messages) if (message.role === "system") {
		for (const tool of message.toolsAdded ?? []) names.add(tool.name);
		for (const tool of message.toolsRemoved ?? []) names.delete(tool.name);
	}
	return [...names].sort();
};
const resultTexts = (context: TranscriptContext) => context.messages.flatMap(message =>
	message.role === "toolResult" ? [message] : []);

async function workers(t: TestContext) {
	const f = await fixture();
	const registry = f.session.extensionRunner.createContext().modelRegistry;
	let credentials: string[] = ["anthropic", "openai-codex"];
	// The snapshot and live-auth fallback are both fake, never inherited environment or owner auth.
	t.mock.method(registry, "hasConfiguredAuth", (model: { provider: string }) => credentials.includes(model.provider));
	t.mock.method(f.runtime, "checkAuth", async (provider: string) => credentials.includes(provider));
	const requests: { provider: string; context: TranscriptContext; options?: SimpleStreamOptions }[] = [];
	const replies: (ReturnType<typeof answer> | ReturnType<typeof gate>["reply"])[] = [];
	for (const [provider, id] of [["anthropic", "claude-haiku-5-5"], ["openai-codex", "gpt-6-luna"]]) {
		const faux = fauxProvider({ provider, api: `worker-faux-${provider}`, models: [{ id, reasoning: true }] });
		faux.setResponses(Array.from({ length: 30 }, () => async (context: TranscriptContext, options?: SimpleStreamOptions) => {
			requests.push({ provider, context: structuredClone(context), options });
			const next = replies.shift();
			return typeof next === "function" ? await next(context, options) : next ?? answer("done");
		}));
		f.runtime.registerNativeProvider(faux.provider);
	}
	const call = async (role: WorkerRole, task: string, signal?: AbortSignal) => {
		const result = await f.session.getToolDefinition(role)!.execute("worker-test", { task }, signal, undefined,
			f.session.extensionRunner.createContext());
		return result.content.map(c => c.type === "text" ? c.text : "").join("");
	};
	const delivered = () => f.session.messages.flatMap(m => m.role === "custom" && ROLES.includes(m.customType as WorkerRole)
		&& typeof m.content === "string" ? [m.content] : []);
	return { ...f, call, delivered, requests, mainRequests: f.requests.main, replies, auth: (providers: string[]) => { credentials = providers; } };
}

test("main starts both workers immediately and receives their results as caller messages", async t => {
	const f = await workers(t);
	const first = gate("CODE_DONE"), second = gate("SHELL_DONE");
	f.replies.push(first.reply, second.reply);
	f.mainReplies.push(answer([
		fauxToolCall("code_writer", { task: "CODE_BRIEF" }),
		fauxToolCall("shell_runner", { task: "SHELL_BRIEF" }),
	], { stopReason: "toolUse" }), answer("STARTED"));
	try {
		await f.session.prompt("GO");
		await until(() => f.requests.length === 2, "both worker requests");
		assert.deepEqual(f.delivered(), [], "caller returns while workers remain held");
		const starts = f.session.messages.filter(m => m.role === "toolResult").map(m => m.content);
		assert.deepEqual(starts.map(c => c.map(p => p.type === "text" ? p.text : "").join("")).sort(),
			["code_writer#1 started", "shell_runner#1 started"]);
		for (const role of ROLES) {
			const request = f.requests.find(r => r.context.messages.some(m => m.role === "user"
				&& JSON.stringify(m.content).includes(role === "code_writer" ? "CODE_BRIEF" : "SHELL_BRIEF")))!;
			assert.equal(request.provider, "anthropic");
			assert.equal(request.options?.reasoning, "low");
			assert.deepEqual(request.context.messages.filter(m => m.role === "system").map(getSystemMessageText),
				[await readFile(new URL(`../roles/${role}.md`, import.meta.url), "utf8")]);
			assert.deepEqual(toolNames(request.context), role === "code_writer"
				? ["bash", "edit", "find", "grep", "read", "write"] : ["bash", "find", "grep", "read"]);
			const definition = f.session.getToolDefinition(role)!;
			assert.deepEqual(Object.keys(definition.parameters.properties), ["task"]);
			assert.deepEqual(definition.parameters.required, ["task"]);
		}
		first.release(); second.release();
		await until(() => f.delivered().length === 2, "caller messages");
		await f.session.waitForIdle();
		assert.deepEqual(f.delivered().sort(), ["[code_writer#1] CODE_DONE", "[shell_runner#1] SHELL_DONE"]);
		assert.ok(f.mainRequests.some(c => JSON.stringify(c).includes("[code_writer#1] CODE_DONE")));
		assert.ok(f.mainRequests.some(c => JSON.stringify(c).includes("[shell_runner#1] SHELL_DONE")));
		assert.deepEqual(f.errors, []);
	} finally { first.release(); second.release(); await f.cleanup(); }
});

test("two calls create two fresh sessions, keep cwd, and persist non-repeating ids across reload", async t => {
	const sessions: AgentSession[] = [];
	const prompt = AgentSession.prototype.prompt;
	t.mock.method(AgentSession.prototype, "prompt", function(this: AgentSession, ...args: Parameters<typeof prompt>) {
		sessions.push(this);
		return prompt.apply(this, args);
	});
	const f = await workers(t);
	try {
		for (const role of ROLES) {
			for (const n of [1, 2]) {
				assert.equal(await f.call(role, `ONLY_${role}_${n}`), `${role}#${n} started`);
				await until(() => f.delivered().length === (role === "code_writer" ? n : n + 2), "fresh answer");
				await f.session.waitForIdle();
			}
		}
		const children = [...new Set(sessions.filter(s => s !== f.session))];
		assert.equal(children.length, 4);
		for (const child of children) assert.equal(child.sessionManager.getCwd(), f.root);
		for (const request of f.requests) {
			assert.equal(request.context.messages.filter(m => m.role === "user").length, 1);
			assert.equal(request.context.messages.filter(m => m.role === "assistant").length, 0);
		}
		for (const role of ROLES) assert.deepEqual(f.session.sessionManager.getEntries().flatMap(e =>
			e.type === "custom" && e.customType === role ? [e.data] : []), [{ id: 1 }, { id: 2 }]);
		await f.session.reload();
		for (const role of ROLES) assert.equal(await f.call(role, "AFTER_RELOAD"), `${role}#3 started`);
	} finally { await f.cleanup(); }
});

test("every worker bash call is git-guarded through tool_call, stock or offered definitions", async t => {
	const f = await workers(t);
	let executed = 0;
	try {
		for (const offered of [false, true]) {
			const off = offered ? f.bus.on("rqw-tools:subagent-tools", request => request.offer((() => [{
				...createBashToolDefinition(f.root), execute: async () => {
					executed++;
					return { content: [{ type: "text", text: "offered bash" }], details: {} };
				},
			}]) as never)) : () => {};
			try {
				for (const role of ROLES) {
					const before = f.requests.length, messages = f.delivered().length;
					const commands = ["git add should-not-exist", "true && git -C . commit -m forbidden"];
					f.replies.push(...commands.map(command => answer([fauxToolCall("bash", { command, timeout: 5 })], { stopReason: "toolUse" })),
						answer([fauxToolCall("bash", { command: "printf allowed", timeout: 5 })], { stopReason: "toolUse" }), answer("GUARD_SEEN"));
					await f.call(role, "GUARD");
					await until(() => f.delivered().length === messages + 1, "guard result");
					await f.session.waitForIdle();
					const results = resultTexts(f.requests[before + 3].context);
					assert.equal(results.length, 3);
					for (let i = 0; i < commands.length; i++) {
						assert.equal(results[i].isError, true);
						assert.ok(JSON.stringify(results[i].content).includes(blockedGit(commands[i])!));
					}
					assert.equal(results[2].isError, false);
					if (offered) assert.ok(JSON.stringify(results[2].content).includes("offered bash"));
				}
			} finally { off(); }
		}
		assert.equal(executed, 2, "offered bash executes only allowed commands");
	} finally { await f.cleanup(); }
});

test("model fallback uses Luna without Anthropic credentials and fails clearly without either", async t => {
	const f = await workers(t);
	try {
		f.auth(["openai-codex"]);
		for (const role of ROLES) {
			await f.call(role, "FALLBACK");
			await until(() => f.delivered().length === (role === "code_writer" ? 1 : 2), "fallback result");
			await f.session.waitForIdle();
		}
		assert.deepEqual(f.requests.map(r => [r.provider, r.options?.reasoning]),
			[["openai-codex", "low"], ["openai-codex", "medium"]]);
		f.auth([]);
		for (const role of ROLES) await assert.rejects(f.call(role, "NO_AUTH"), /No credentials for worker providers/);
		assert.equal(f.requests.length, 2, "no inference on missing credentials");
	} finally { await f.cleanup(); }
});

test("stopping the caller session aborts its workers and drops results; caller Esc does not", async t => {
	const f = await workers(t);
	const code = gate("LATE_CODE"), shell = gate("LATE_SHELL"), busy = gate("MAIN_BUSY"), stoppedCode = gate("DROPPED_CODE");
	f.replies.push(code.reply, shell.reply);
	try {
		for (const role of ROLES) await f.call(role, "RUN");
		await until(() => f.requests.length === 2, "held workers");
		f.mainReplies.push(busy.reply);
		const running = f.session.prompt("BUSY");
		await until(() => busy.entered(), "busy caller");
		f.session.clearQueue();
		await f.session.abort();
		await running;
		assert.equal(code.aborted(), false);
		assert.equal(shell.aborted(), false);
		code.release();
		await until(() => f.delivered().length === 1, "late-after-abort result");
		await tick();
		assert.equal(f.mainRequests.length, 1, "late result does not wake an aborted caller");
		f.replies.push(stoppedCode.reply);
		await f.call("code_writer", "STOP_WITH_SESSION");
		await until(() => stoppedCode.entered(), "another pending code worker");
		await f.session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
		await until(() => shell.aborted() && stoppedCode.aborted(), "session shutdown aborts both worker roles");
		await tick();
		assert.deepEqual(f.delivered(), ["[code_writer#1] LATE_CODE"]);
	} finally { code.release(); shell.release(); stoppedCode.release(); busy.release(); await f.cleanup(); }
});
