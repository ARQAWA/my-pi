// Public hooks prepare routing only. Pi owns summary generation, persistence and failures.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { zstdDecompressSync } from "node:zlib";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { InMemoryCredentialStore, type Api, type Model } from "@earendil-works/pi-ai";
import { createCodexExtension } from "../index.ts";
import { SESSION_POLICY_CHANNEL } from "../registration.ts";
import { installSessionCompaction } from "../session-compaction.ts";
import { SocketError } from "../websocket.ts";

const MODEL = {
	id: "gpt-6.1-sol", name: "GPT-6.1-Sol", api: "openai-codex-responses", provider: "openai-codex",
	baseUrl: "https://chatgpt.com/backend-api", reasoning: true, input: ["text", "image"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 500_000, maxTokens: 100_000,
} as Model<Api>;
const SUMMARY = "Preserve the original request and the earlier progress.";
const USAGE = { input: 10, output: 3, cacheRead: 0, cacheWrite: 0, totalTokens: 13, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
type Handler = (event: any, context: any) => any;

function preparation() {
	return {
		firstKeptEntryId: "kept-user-entry", tokensBefore: 123,
		messagesToSummarize: [
			{ role: "user", content: "Original request", timestamp: 1 },
			{ role: "assistant", content: [{ type: "text", text: "Earlier progress" }], api: MODEL.api, provider: MODEL.provider, model: MODEL.id, stopReason: "stop", timestamp: 2, usage: USAGE },
		],
		turnPrefixMessages: [], isSplitTurn: false, previousSummary: undefined,
		fileOps: { read: new Set<string>(), written: new Set<string>(), edited: new Set<string>() },
		settings: { enabled: true, reserveTokens: 10_000, keepRecentTokens: 1 },
	};
}

function fixture(options: { accepts?: (context: any) => boolean; failure?: boolean } = {}) {
	const handlers = new Map<string, Handler>();
	const prepared: Array<{ event: any; context: any }> = [];
	const lifecycle: Array<{ kind: string; context: any }> = [];
	const pi = {
		on(name: string, handler: Handler) {
			assert.equal(handlers.has(name), false, "each public event is registered once");
			let subscribed = true;
			handlers.set(name, (event, context) => subscribed ? handler(event, context) : undefined);
			return () => { subscribed = false; };
		},
	};
	const context = { model: MODEL, thinkingLevel: "off" };
	const release = installSessionCompaction(pi as never, {
		accepts: options.accepts,
		prepare: (event, ctx) => {
			prepared.push({ event, context: ctx });
			if (options.failure) throw new Error("fake preparation failure");
		},
		onCompacted: (ctx) => lifecycle.push({ kind: "compacted", context: ctx }),
		onFinished: (ctx) => lifecycle.push({ kind: "finished", context: ctx }),
	});
	const event = (reason = "manual") => ({ type: "session_before_compact", preparation: preparation(), branchEntries: [], customInstructions: "Focus on unfinished work.", reason, willRetry: reason === "overflow", signal: new AbortController().signal });
	return { handlers, prepared, lifecycle, context, release, event };
}

describe("public session compaction readiness helper", () => {
	it("registers public preparation, success and failure events only", () => {
		const f = fixture();
		assert.deepEqual([...f.handlers.keys()].sort(), ["session_before_compact", "session_compact", "session_compact_failed"]);
		assert.deepEqual(f.prepared, []);
		f.release();
	});

	for (const reason of ["manual", "threshold", "overflow"]) {
		it(`${reason}: prepares the exact event and context without supplying or cancelling Pi's summary`, async () => {
			const f = fixture();
			try {
				const event = f.event(reason);
				const before = JSON.stringify(event);
				assert.equal(await f.handlers.get("session_before_compact")!(event, f.context), undefined);
				assert.equal(f.prepared.length, 1);
				assert.equal(f.prepared[0].event, event);
				assert.equal(f.prepared[0].context, f.context);
				assert.equal(JSON.stringify(event), before, "preparation does not rewrite Pi's event");
				assert.deepEqual(f.lifecycle, [], "no reset before Pi accepts the compaction");
				await f.handlers.get("session_compact")!({ type: "session_compact", reason }, f.context);
				assert.deepEqual(f.lifecycle, [{ kind: "finished", context: f.context }, { kind: "compacted", context: f.context }]);
			} finally { f.release(); }
		});
	}

	it("leaves foreign providers, foreign APIs and missing models to Pi", async () => {
		const f = fixture();
		try {
			for (const model of [{ ...MODEL, provider: "other-provider" }, { ...MODEL, api: "openai-responses" }, undefined]) {
				assert.equal(await f.handlers.get("session_before_compact")!(f.event(), { ...f.context, model }), undefined);
			}
			assert.deepEqual(f.prepared, []);
			assert.deepEqual(f.lifecycle, []);
		} finally { f.release(); }
	});

	it("does not handle contexts rejected by the owner's predicate", async () => {
		const f = fixture({ accepts: () => false });
		try {
			for (const name of f.handlers.keys()) assert.equal(await f.handlers.get(name)!({ type: name }, f.context), undefined);
			assert.deepEqual(f.prepared, []);
			assert.deepEqual(f.lifecycle, []);
		} finally { f.release(); }
	});

	it("finishes failed or aborted compaction without installing a boundary", async () => {
		const f = fixture();
		try {
			for (const aborted of [false, true]) await f.handlers.get("session_compact_failed")!({ type: "session_compact_failed", aborted }, f.context);
			assert.deepEqual(f.lifecycle, [{ kind: "finished", context: f.context }, { kind: "finished", context: f.context }]);
		} finally { f.release(); }
	});

	it("does not turn preparation failures into a custom summary or cancellation", () => {
		const f = fixture({ failure: true });
		try {
			assert.throws(() => f.handlers.get("session_before_compact")!(f.event(), f.context), /fake preparation failure/);
			assert.equal(f.prepared.length, 1);
			assert.deepEqual(f.lifecycle, []);
		} finally { f.release(); }
	});

	it("release unsubscribes all handlers and is idempotent", async () => {
		const f = fixture();
		f.release();
		f.release();
		for (const name of f.handlers.keys()) assert.equal(await f.handlers.get(name)!({ type: name }, f.context), undefined);
		assert.deepEqual(f.prepared, []);
		assert.deepEqual(f.lifecycle, []);
	});
});

it("child hook bridges isolate stock Pi summaries, routing and concurrent callbacks", { timeout: 15_000 }, async () => {
	const dir = await mkdtemp(join(tmpdir(), "rqw-child-standard-compaction-"));
	const sessions: Array<Awaited<ReturnType<typeof createAgentSession>>["session"]> = [];
	const releases: Array<() => void> = [];
	try {
		const store = new InMemoryCredentialStore();
		const exp = Math.floor(Date.now() / 1000) + 3600;
		const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
		await store.modify(MODEL.provider, async () => ({ type: "oauth", access: `${b64({ alg: "none" })}.${b64({ exp, "https://api.openai.com/auth": { chatgpt_account_id: "acct_fake_child" } })}.sig`, refresh: "fake-refresh", expires: exp * 1000, accountId: "acct_fake_child" }));
		const runtime = await ModelRuntime.create({ credentials: store, modelsPath: null, refreshOnCreate: false });
		const posts: Array<{ body: any; headers: Record<string, string> }> = [];
		let routeChecks: Promise<void> | undefined;
		const childApis = new WeakMap<object, any>();
		let rootApi: any;
		let concurrentGate: Promise<void> | undefined;
		let releaseConcurrent: (() => void) | undefined;
		const concurrentOwners = new Set<string>();
		const factory = createCodexExtension({ installationId: "11111111-2222-4333-8444-555555555555", agentDir: dir, dependencies: {
			connect: async () => { throw new SocketError(426, {}, "upgrade required", "upgrade-rejected"); },
			fetch: async () => { throw new Error("real network forbidden"); },
			postEvents: (options: any) => {
				const body = JSON.parse(zstdDecompressSync(Buffer.from(options.body)).toString("utf8"));
				posts.push({ body, headers: options.headers });
				const probe = /BOUND_ROUTE_PROBE|AUX_ROUTE_PROBE/.test(JSON.stringify(body.input));
				const owner = body.client_metadata?.test_owner as string | undefined;
				if (owner) {
					concurrentOwners.add(owner);
					if (concurrentOwners.size === 3) releaseConcurrent?.();
				}
				const id = `resp_${owner ?? "child"}_${posts.length}`;
				const text = owner ? `${SUMMARY} CALLBACK_OWNER_${owner}` : SUMMARY;
				const values = [
					{ type: "response.created", response: { id } },
					{ type: "response.output_item.done", output_index: 0, item: { type: "message", id: `msg_${id}`, role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }] } },
					{ type: "response.completed", response: { id, status: "completed", usage: { input_tokens: 10, output_tokens: 3, total_tokens: 13, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } } },
				];
				return (async function* () {
					// Keep the real compaction active until both routing probes settle.
					if (!probe) await routeChecks;
					if (owner) await concurrentGate;
					options.onResponse({ status: 200, headers: owner ? { "x-test-owner": owner } : {} });
					for (const value of values) yield { text: JSON.stringify(value), value };
				})();
			},
		} });
		let bus: any;
		const loader = new DefaultResourceLoader({ cwd: dir, agentDir: dir, additionalExtensionPaths: [], noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
			extensionFactories: [(pi) => { rootApi = pi; bus = pi.events; factory(pi); }] });
		await loader.reload();
		assert.deepEqual(loader.getExtensions().errors, []);
		const model = runtime.getModels(MODEL.provider)[0]!;
		const create = async (child: boolean) => {
			let childApi: any;
			const resources = child ? new DefaultResourceLoader({ cwd: dir, agentDir: dir, additionalExtensionPaths: [], noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
				extensionFactories: [(pi) => { childApi = pi; }] }) : loader;
			if (child) await resources.reload();
			assert.equal(resources.getExtensions().extensions.length, 1, child ? "child loads only the public API capture, not the Codex extension" : "root loads Codex");
			const manager = SessionManager.inMemory(dir);
			manager.appendMessage({ role: "user", content: child ? "CHILD_ORIGINAL_TASK" : "ROOT_ORIGINAL_TASK", timestamp: 1 });
			manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "Earlier progress" }], api: model.api, provider: model.provider, model: model.id, stopReason: "stop", timestamp: 2, usage: USAGE });
			const { session } = await createAgentSession({ cwd: dir, agentDir: dir, modelRuntime: runtime, model, thinkingLevel: "off", resourceLoader: resources, sessionManager: manager,
				settingsManager: SettingsManager.inMemory({ compaction: { enabled: true, reserveTokens: 10_000, keepRecentTokens: 1 }, retry: { enabled: false }, transport: "sse" }) });
			sessions.push(session);
			if (child) childApis.set(session, childApi);
			await session.bindExtensions({ mode: "tui" });
			return session;
		};
		const root = await create(false);
		await root.prompt("ROOT_CURRENT_TASK");
		let rootBefore = JSON.stringify(root.sessionManager.getBranch());
		for (const kind of ["collab_spawn", "review"]) {
			const child = await create(true);
			const request: any = { session: child, parentThreadId: root.sessionId, kind, childName: kind };
			bus.emit(SESSION_POLICY_CHANNEL, request);
			assert.equal(request.error, undefined);
			assert.equal(typeof request.release, "function");
			assert.equal(typeof request.installCompactionHooks, "function");
			request.installCompactionHooks(childApis.get(child));
			request.installCompactionHooks(childApis.get(child));
			releases.push(request.release);
			await child.prompt("CHILD_CURRENT_TASK");
			let acceptedAtEnd = false;
			const auxiliaryId = "11111111-2222-7333-8444-555555555555";
			let probeOnce = true;
			childApis.get(child).on("session_before_compact", (event: any) => {
				if (!probeOnce || kind !== "collab_spawn") return;
				probeOnce = false;
				routeChecks = (async () => {
					for (const [sessionId, marker] of [[root.sessionId, "BOUND_ROUTE_PROBE"], [auxiliaryId, "AUX_ROUTE_PROBE"]]) {
						const result = await runtime.streamSimple(model, { messages: [{ role: "user", content: marker, timestamp: Date.now() }] }, { sessionId, cacheRetention: "none", signal: event.signal }).result();
						assert.equal(result.stopReason, "stop", `routing probe ${marker} succeeds with the active preparation signal`);
					}
					const known = posts.find((post) => JSON.stringify(post.body.input).includes("BOUND_ROUTE_PROBE"))!;
					const auxiliary = posts.find((post) => JSON.stringify(post.body.input).includes("AUX_ROUTE_PROBE"))!;
					assert.equal(known.headers["thread-id"], root.sessionId, "a bound sessionId stays on its controller even with cacheRetention none during another session's compaction");
					assert.notEqual(auxiliary.headers["thread-id"], auxiliaryId, "an unknown UUIDv7 with the exact signal uses the request-local auxiliary transport");
					assert.notEqual(auxiliary.headers["thread-id"], root.sessionId);
					assert.notEqual(auxiliary.headers["thread-id"], child.sessionId);
					rootBefore = JSON.stringify(root.sessionManager.getBranch());
				})();
				// The response barrier awaits this promise and reports any failure.
				void routeChecks.catch(() => undefined);
			});
			const unsubscribe = child.subscribe((event) => {
				if (event.type === "compaction_end" && event.result && !event.aborted) acceptedAtEnd = child.sessionManager.getBranch().some((entry) => entry.type === "compaction");
			});
			const beforeCompaction = posts.length;
			const compacted = await child.compact();
			await routeChecks;
			unsubscribe();
			assert.ok(compacted.summary.includes(SUMMARY));
			assert.equal(acceptedAtEnd, true, "Pi entry exists before a success listener sees compaction_end");
			assert.equal(child.sessionManager.buildSessionContext().messages.filter((message) => message.role === "compactionSummary").length, 1);
			assert.equal(Object.hasOwn(child, "compact"), false);
			assert.equal(Object.hasOwn(child, "_runAutoCompaction"), false);
			// Pi may separately summarize the earlier history and the retained turn prefix.
			const summaryRequests = posts.slice(beforeCompaction).filter((post) => !/BOUND_ROUTE_PROBE|AUX_ROUTE_PROBE/.test(JSON.stringify(post.body.input)));
			assert.ok(summaryRequests.length > 0);
			for (const request of summaryRequests) assert.notEqual(request.headers["thread-id"], child.sessionId, "standalone summary gets a request-local transport");
			const summaryInput = JSON.stringify(summaryRequests.map((request) => request.body.input));
			assert.ok(summaryInput.includes("CHILD_ORIGINAL_TASK"));
			assert.equal(summaryInput.includes("ROOT_ORIGINAL_TASK"), false);
			await child.prompt("Continue after the child summary");
			assert.ok(JSON.stringify(posts.at(-1)!.body.input).includes(SUMMARY));
			assert.equal(JSON.stringify(root.sessionManager.getBranch()), rootBefore, "child summaries do not pollute the root controller");
		}
		let wrongSignalCheck: Promise<void> | undefined;
		rootApi.on("session_before_compact", () => {
			if (wrongSignalCheck) return;
			wrongSignalCheck = (async () => {
				await assert.rejects(async () => {
					const result = await runtime.streamSimple(model, { messages: [{ role: "user", content: "wrong-signal", timestamp: 1 }] }, { sessionId: "11111111-2222-7333-8444-555555555555", cacheRetention: "none", signal: new AbortController().signal }).result();
					if (result.stopReason === "error") throw new Error(result.errorMessage);
				}, /no bound controller/);
			})();
			void wrongSignalCheck.catch(() => undefined);
		});
		const beforeWrongSignal = posts.length;
		await root.compact();
		assert.ok(wrongSignalCheck);
		await wrongSignalCheck;
		assert.equal(posts.slice(beforeWrongSignal).some((post) => JSON.stringify(post.body.input).includes("wrong-signal")), false, "one prepared root cannot lend its auxiliary route to another signal");
		await root.prompt("Continue before the concurrent summaries");
		// All three sessions ask for the same summary focus on the same model, concurrently.
		// Owner-tagged fake replies expose callbacks borrowed from another active session.
		const targets = [root, ...sessions.filter((session) => session !== root)];
		const names = ["ROOT", "COLLAB", "REVIEW"];
		const callbacks = names.map(() => ({ payload: 0, response: [] as unknown[], events: [] as string[] }));
		concurrentGate = new Promise<void>((resolve) => { releaseConcurrent = resolve; });
		const concurrentStart = posts.length;
		for (const [index, session] of targets.entries()) {
			const name = names[index];
			const api = session === root ? rootApi : childApis.get(session);
			api.on("session_before_compact", (event: any) => {
				// Equal summary inputs ensure routing cannot infer ownership from request content.
				// Keep Pi's real retained-entry boundary and signal for each session.
				Object.assign(event.preparation, {
					messagesToSummarize: preparation().messagesToSummarize,
					turnPrefixMessages: [], isSplitTurn: false, previousSummary: undefined,
				});
			});
			session.agent.onPayload = (payload) => {
				callbacks[index].payload++;
				const body = payload as Record<string, any>;
				return { ...body, service_tier: "flex", client_metadata: { ...body.client_metadata, test_owner: name } };
			};
			session.agent.onResponse = (head) => { callbacks[index].response.push(head.headers["x-test-owner"]); };
			session.agent.onProviderStreamEvent = (event) => {
				const value = event as any;
				callbacks[index].events.push(value.response?.id ?? value.item?.id);
			};
		}
		const results = await Promise.all(targets.map((session) => session.compact("Identical summary focus.")));
		for (const [index, result] of results.entries()) {
			const name = names[index];
			assert.ok(result.summary.includes(`CALLBACK_OWNER_${name}`), `${name} receives its own callback-selected summary`);
			for (const other of names.filter((value) => value !== name)) assert.equal(result.summary.includes(`CALLBACK_OWNER_${other}`), false);
			const ownPosts = posts.slice(concurrentStart).filter((post) => post.body.client_metadata?.test_owner === name);
			assert.equal(ownPosts.length, 1, "one identical unsplit summary per session");
			assert.equal(ownPosts.every((post) => post.body.service_tier === "flex"), true, "the public payload transformation reaches the wire");
			assert.equal(callbacks[index].payload, ownPosts.length, "one payload callback per own summary request");
			assert.deepEqual(callbacks[index].response, ownPosts.map(() => name), "response callback identity stays session-local");
			assert.equal(callbacks[index].events.length, ownPosts.length * 3);
			assert.equal(callbacks[index].events.every((id) => id.includes(`resp_${name}_`)), true, "raw provider events reach only their own session");
		}
		const inputs = posts.slice(concurrentStart).map((post) => post.body.input.map(({ type, role, content }: any) => ({ type, role, content })));
		assert.equal(inputs.length, 3);
		assert.deepEqual(inputs[0], inputs[1], "root and child summarize identical model-visible input");
		assert.deepEqual(inputs[1], inputs[2], "both child kinds summarize identical model-visible input");
		assert.deepEqual([...concurrentOwners].sort(), [...names].sort());
		const callbacksBeforeSdk = structuredClone(callbacks);
		const sdkChild = await create(true);
		const sdkRequest: any = { session: sdkChild, parentThreadId: root.sessionId, kind: "collab_spawn" };
		bus.emit(SESSION_POLICY_CHANNEL, sdkRequest);
		assert.equal(sdkRequest.error, undefined);
		releases.push(sdkRequest.release);
		// Deliberately omit installCompactionHooks, as a generic SDK caller does.
		await sdkChild.prompt("SDK child current task");
		const sdkCallbacks = { payload: 0, response: 0, events: 0 };
		sdkChild.agent.onPayload = () => { sdkCallbacks.payload++; };
		sdkChild.agent.onResponse = () => { sdkCallbacks.response++; };
		sdkChild.agent.onProviderStreamEvent = () => { sdkCallbacks.events++; };
		const beforeSdk = posts.length;
		const sdkResult = await sdkChild.compact();
		assert.ok(sdkResult.summary.includes(SUMMARY));
		assert.deepEqual(sdkCallbacks, { payload: 0, response: 0, events: 0 }, "generic fallback borrows no Agent callbacks without a preparation signal");
		assert.deepEqual(callbacks, callbacksBeforeSdk, "generic fallback does not invoke any other session's response or provider-event callbacks");
		assert.equal(posts.slice(beforeSdk).every((post) => post.body.client_metadata?.test_owner === undefined), true, "generic fallback does not borrow the root's payload callback");
		assert.equal(posts.some(({ body }) => body.input.some((item: any) => item.type === "compaction_trigger" || item.type === "compaction")), false);
		const beforeUnknown = posts.length;
		await assert.rejects(async () => {
			const result = await runtime.streamSimple(model, { messages: [{ role: "user", content: "unknown", timestamp: Date.now() }] }, { sessionId: "11111111-2222-7333-8444-555555555555", cacheRetention: "none" }).result();
			if (result.stopReason === "error") throw new Error(result.errorMessage);
		}, /no bound controller/);
		assert.equal(posts.length, beforeUnknown, "an unknown UUIDv7 cannot use the auxiliary route outside compaction");
	} finally {
		for (const release of releases) release();
		for (const session of sessions.reverse()) session.dispose();
		await rm(dir, { recursive: true, force: true });
	}
});
