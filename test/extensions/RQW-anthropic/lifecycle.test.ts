import "./recovery-offline.mjs";
import assert from "node:assert/strict";
import { normalizeContext, type AssistantMessage, type Context } from "@earendil-works/pi-ai";
import { it } from "node:test";
import { entries } from "./pi-entrypoints.ts";
import { setup, credential, context, textEvents, finish, response } from "./recovery-fixtures.ts";

for (const [label, entry] of entries) {
	it(`${label}: disposing unowned native generic and reviewer children keeps the main subscription transport alive`, async () => {
		const active = await setup(undefined, entry);
		const overlay = active.runtime.getRegisteredProviderConfig("anthropic")!.streamSimple;
		try {
			for (const role of ["generic", "reviewer"]) {
				const dir = process.env.PI_CODING_AGENT_DIR!;
				const resourceLoader = new entry.DefaultResourceLoader({ cwd: dir, agentDir: dir, noExtensions: true,
					noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
				await resourceLoader.reload();
				const { session: child } = await entry.createAgentSession({ cwd: dir, agentDir: dir, modelRuntime: active.runtime,
					model: active.session.model, resourceLoader, sessionManager: entry.SessionManager.inMemory(dir),
					settingsManager: entry.SettingsManager.inMemory({ compaction: { enabled: false } }),
					...(role === "reviewer" ? { tools: ["read", "grep", "find"] } : {}) });
				assert.equal(child.modelRuntime, active.runtime);
				assert.equal(child.resourceLoader.getExtensions().extensions.length, 0);
				child.dispose(); child.dispose();
				assert.equal(active.runtime.getRegisteredProviderConfig("anthropic")!.streamSimple, overlay);
				let calls = 0;
				const result = await active.runtime.completeSimple(active.session.model!, context, { fetch: async (_input, init) => {
					calls++; assert.ok(String(init?.body).includes("cc_entrypoint=cli;"));
					return response([...textEvents, ...finish]);
				} });
				assert.equal(calls, 1); assert.equal(result.stopReason, "stop");
			}
			assert.deepEqual(await active.store.read("anthropic"), credential);
		} finally { active.session.dispose(); }
		assert.equal(active.runtime.getRegisteredProviderConfig("anthropic"), undefined);
	});

	it(`${label}: an old disposed session cannot release a new owner reusing its session manager`, async () => {
		const first = await setup(undefined, entry);
		first.session.dispose();
		const second = await setup(undefined, entry, first);
		try {
			assert.equal(second.runtime, first.runtime);
			assert.equal(second.session.sessionManager, first.session.sessionManager);
			assert.notEqual(second.session, first.session);
			first.session.dispose(); first.session.dispose();
			assert.ok(second.runtime.getRegisteredProviderConfig("anthropic"));
			let calls = 0;
			const result = await second.runtime.completeSimple(second.session.model!, context, { fetch: async () => {
				calls++; return response([...textEvents, ...finish]);
			} });
			assert.equal(calls, 1); assert.equal(result.stopReason, "stop");
		} finally { second.session.dispose(); }
		assert.equal(second.runtime.getRegisteredProviderConfig("anthropic"), undefined);
	});

	it(`${label}: actual Pi compaction's fresh routing ID never retains an auxiliary snapshot`, async (t) => {
		const active = await setup({ retry: { enabled: false }, compaction: { keepRecentTokens: 32 } }, entry);
		const previousFetch = globalThis.fetch;
		const auxiliary: { sessionId: string; context: Context; retention: unknown }[] = [];
		const bus = (active.session.resourceLoader as any).eventBus;
		const query = (sessionId: string, snapshot: Context) => {
			let infer: (() => Promise<AssistantMessage>) | undefined;
			bus.emit("rqw:context-fork:v1", { sessionId, model: active.session.model!,
				context: { messages: [...snapshot.messages, { role: "user", content: "Report progress.", timestamp: 4 }] },
				signal: new AbortController().signal, offer(value: typeof infer) { infer = value; } });
			return infer;
		};
		try {
			globalThis.fetch = async () => response([...textEvents, ...finish]);
			const answer = await active.runtime.streamSimple(active.session.model!, normalizeContext(context),
				{ sessionId: active.session.sessionId, reasoning: "low" }).result();
			assert.equal(typeof query(active.session.sessionId, normalizeContext(context)), "function", "real SDK session has a snapshot");
			const source = active.session.agent.streamFunction!;
			t.mock.method(active.session.agent, "streamFunction", (model, current, options) => {
				auxiliary.push({ sessionId: options.sessionId!, context: structuredClone(current), retention: options.cacheRetention });
				return source(model, current, options);
			});
			const messages = [{ role: "user" as const, content: "Old request ".repeat(40), timestamp: 1 }, answer,
				{ role: "user" as const, content: "Retained request ".repeat(80), timestamp: 3 }];
			for (const message of messages) active.session.sessionManager.appendMessage(message);
			active.session.agent.state.messages = messages;
			const result = await active.session.compact();
			assert.ok(result.summary.includes("PARTIAL"));
			assert.ok(auxiliary.length > 0, "actual Pi summarizer called the source stream");
			for (const request of auxiliary) {
				assert.match(request.sessionId, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
				assert.notEqual(request.sessionId, active.session.sessionId);
				assert.equal(request.retention, "none");
				assert.equal(query(request.sessionId, request.context), undefined, "fresh summary routing ID is not a source session");
			}
			assert.equal(typeof query(active.session.sessionId, normalizeContext(context)), "function", "summary did not replace the source snapshot");
		} finally { globalThis.fetch = previousFetch; active.session.dispose(); }
	});

	it(`${label}: real SDK compaction routing IDs retain no snapshots and leave an actual child source intact`, async () => {
		const active = await setup({ retry: { enabled: false }, compaction: { keepRecentTokens: 32 } }, entry);
		const dir = process.env.PI_CODING_AGENT_DIR!;
		const loader = new entry.DefaultResourceLoader({ cwd: dir, agentDir: dir, noExtensions: true, noSkills: true,
			noPromptTemplates: true, noThemes: true, noContextFiles: true });
		await loader.reload();
		const { session: child } = await entry.createAgentSession({ cwd: dir, agentDir: dir, modelRuntime: active.runtime,
			model: active.session.model, resourceLoader: loader, sessionManager: entry.SessionManager.inMemory(dir),
			settingsManager: entry.SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } }) });
		const previousFetch = globalThis.fetch;
		const sentIds: string[] = [];
		globalThis.fetch = async (_input, init) => {
			sentIds.push(new Headers(init?.headers).get("x-claude-code-session-id")!);
			return response([...textEvents, ...finish]);
		};
		const model = active.session.model!;
		const bus = (active.session.resourceLoader as any).eventBus;
		const query = (sessionId: string, source: Context) => {
			let infer: (() => Promise<AssistantMessage>) | undefined;
			bus.emit("rqw:context-fork:v1", { sessionId, model, signal: new AbortController().signal,
				context: { messages: [...source.messages, { role: "user", content: "Report progress.", timestamp: 4 }] },
				offer(value: typeof infer) { infer = value; } });
			return infer;
		};
		try {
			const answer = await active.runtime.streamSimple(model, normalizeContext(context), { sessionId: child.sessionId,
				cacheRetention: "short", reasoning: "low" }).result();
			const childContext: Context = { messages: [...normalizeContext(context).messages, answer] };
			assert.equal(typeof query(child.sessionId, childContext), "function", "real SDK child identity is registered");
			const preserved = query(child.sessionId, childContext)!;
			for (const message of [
				{ role: "user", content: "Old request ".repeat(40), timestamp: 1 },
				answer,
				{ role: "user", content: "Retained request ".repeat(80), timestamp: 3 },
			]) active.session.sessionManager.appendMessage(message as never);
			active.session.refreshContext();
			const auxiliaries: { sessionId: string; context: Context; cacheRetention?: string }[] = [];
			const stream = active.session.agent.streamFunction;
			active.session.agent.streamFunction = (selected, source, options) => {
				auxiliaries.push({ sessionId: options!.sessionId!, context: structuredClone(source), cacheRetention: options?.cacheRetention });
				return stream(selected, source, options);
			};
			const result = await active.session.compact();
			assert.equal(result.summary, "PARTIAL", "stock SDK compaction completed through the fake subscription transport");
			assert.equal(auxiliaries.length, 1);
			const auxiliary = auxiliaries[0];
			assert.match(auxiliary.sessionId, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
			assert.notEqual(auxiliary.sessionId, active.session.sessionId);
			assert.notEqual(auxiliary.sessionId, child.sessionId);
			assert.equal(auxiliary.cacheRetention, "none");
			assert.deepEqual(sentIds, [child.sessionId, auxiliary.sessionId], "the new routing ID belongs to the real SDK summary call");
			assert.equal(query(auxiliary.sessionId, auxiliary.context), undefined, "summary context and body are not retained as a source");
			assert.equal(typeof query(child.sessionId, childContext), "function", "compaction did not replace the child's snapshot");
			child.dispose();
			assert.equal(query(child.sessionId, childContext), undefined, "disposal removes the real registered source");
			assert.equal(query(auxiliary.sessionId, auxiliary.context), undefined);
			assert.equal((await preserved()).stopReason, "stop", "already-offered snapshot is independent of source registration");
		} finally { globalThis.fetch = previousFetch; child.dispose(); active.session.dispose(); }
	});

	it(`${label}: stop and restart release source snapshots while offered forks remain independent and cancellable`, async () => {
		const active = await setup(undefined, entry);
		const dir = process.env.PI_CODING_AGENT_DIR!;
		const loader = new entry.DefaultResourceLoader({ cwd: dir, agentDir: dir, noExtensions: true, noSkills: true,
			noPromptTemplates: true, noThemes: true, noContextFiles: true });
		await loader.reload();
		const createChild = async () => (await entry.createAgentSession({ cwd: dir, agentDir: dir, modelRuntime: active.runtime,
			model: active.session.model, resourceLoader: loader, sessionManager: entry.SessionManager.inMemory(dir),
			settingsManager: entry.SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } }) })).session;
		const stopped = await createChild();
		const survivor = await createChild();
		let replacement: typeof stopped | undefined;
		let block = false;
		let forkSignal: AbortSignal | undefined;
		const began = Promise.withResolvers<void>();
		const fetch: typeof globalThis.fetch = async (_input, init) => {
			if (!block) return response([...textEvents, ...finish]);
			forkSignal = init!.signal!;
			began.resolve();
			return new Promise((_resolve, reject) => forkSignal!.addEventListener("abort", () => reject(forkSignal!.reason), { once: true }));
		};
		const model = active.session.model!;
		const options = { fetch, cacheRetention: "short" as const, reasoning: "low" as const };
		const bus = (active.session.resourceLoader as any).eventBus;
		const query = (sessionId: string, answer: AssistantMessage, signal = new AbortController().signal) => {
			let infer: (() => Promise<AssistantMessage>) | undefined;
			const snapshot: Context = { messages: [...normalizeContext(context).messages, answer,
				{ role: "user", content: "Report progress.", timestamp: 3 }] };
			bus.emit("rqw:context-fork:v1", { sessionId, model, context: snapshot, signal, offer(value: typeof infer) { infer = value; } });
			return infer;
		};
		try {
			const answer = await active.runtime.streamSimple(model, normalizeContext(context), { ...options, sessionId: stopped.sessionId }).result();
			const sibling = await active.runtime.streamSimple(model, normalizeContext(context), { ...options, sessionId: survivor.sessionId }).result();
			const offered = query(stopped.sessionId, answer)!;
			const abort = new AbortController();
			const running = query(stopped.sessionId, answer, abort.signal)!;
			assert.equal(typeof offered, "function");
			block = true;
			const pending = running();
			await began.promise;
			stopped.dispose(); stopped.dispose();
			assert.equal(query(stopped.sessionId, answer), undefined, "existing dispose lease releases source state without a consumer event");
			assert.equal(typeof query(survivor.sessionId, sibling), "function", "a sibling's snapshot survives");
			assert.equal(forkSignal!.aborted, false, "source disposal does not abort an offered fork");
			abort.abort();
			await assert.rejects(pending, { name: "AbortError" });
			assert.equal(forkSignal!.aborted, true, "offered fork still owns cancellation");
			block = false;
			assert.equal((await offered()).stopReason, "stop", "an already captured snapshot still works after source disposal");
			assert.equal(query(stopped.sessionId, answer), undefined, "old inference does not re-register disposed source");
			replacement = await createChild();
			assert.notEqual(replacement.sessionId, stopped.sessionId);
			const next = await active.runtime.streamSimple(model, normalizeContext(context), { ...options, sessionId: replacement.sessionId }).result();
			assert.equal(typeof query(replacement.sessionId, next), "function", "replacement owns fresh state");
			assert.equal(query(stopped.sessionId, answer), undefined);
			assert.ok(active.runtime.getRegisteredProviderConfig("anthropic"), "root provider lease remains live");
		} finally { block = false; replacement?.dispose(); survivor.dispose(); stopped.dispose(); active.session.dispose(); }
	});
}
