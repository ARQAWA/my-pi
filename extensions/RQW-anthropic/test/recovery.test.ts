import "./recovery-offline.mjs";
import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import Anthropic from "@anthropic-ai/sdk";
import { normalizeContext } from "@earendil-works/pi-ai";
import { refreshCredential, recoverCredential, TOKEN_URL } from "../auth.ts";
import { createOverlay } from "../transport.ts";
import { installRecoveryHooks } from "../retry.ts";
import { entries } from "./pi-entrypoints.ts";
import { ACCESS, NEXT, credential, AuthStorage, base, model, context, refreshed, setup, within, sse, start, textEvents, finish, response } from "./recovery-fixtures.ts";

const retrySettings = { retry: { enabled: true, maxRetries: 1, baseDelayMs: 1 } };
const lastAssistant = (session: { messages: readonly { role: string }[] }) => session.messages.filter(message => message.role === "assistant").at(-1) as import("@earendil-works/pi-ai").AssistantMessage;

for (const [label, entry] of entries) {
	it(`${label}: final SDK and AgentSession auth failures keep HTTP meaning and login help without outer retry`, async () => {
		const { runtime, store, session } = await setup(retrySettings, entry);
		const previous = globalThis.fetch;
		try {
			for (const failure of ["second401", "403", "invalid_grant"]) {
				for (const sessionCall of [false, true]) {
					await store.modify("anthropic", async () => credential);
					let inference = 0, refreshes = 0, outerRetries = 0;
					const unsubscribe = session.subscribe(event => { if (event.type === "auto_retry_start") outerRetries++; });
					const fetch: typeof globalThis.fetch = async input => {
						if (String(input) === TOKEN_URL) { refreshes++; return failure === "invalid_grant" ? new Response("invalid_grant", { status: 400 }) : refreshed(); }
						inference++; return new Response("not a connection failure", { status: failure === "403" ? 403 : 401 });
					};
					globalThis.fetch = fetch;
					const result = sessionCall ? (await session.prompt("offline permanent auth failure"), lastAssistant(session)) :
						await runtime.completeSimple(session.model!, context, { fetch });
					unsubscribe();
					assert.equal(result.stopReason, "error");
					assert.match(result.errorMessage!, /\/login anthropic/);
					assert.doesNotMatch(result.errorMessage!, /Connection error\./);
					assert.match(result.errorMessage!, failure === "403" ? /403.*permissions/ : failure === "invalid_grant" ? /Refresh HTTP 400.*grant.*invalid/ : /401.*authentication failed/);
					assert.equal(inference, failure === "second401" ? 2 : 1);
					assert.equal(refreshes, failure === "403" ? 0 : 1);
					assert.equal(outerRetries, 0);
				}
			}
		} finally { globalThis.fetch = previous; session.dispose(); }
	});

	it(`${label}: proactive failure is actionable at getAuth, completeSimple and session boundaries, with no API billing fallback`, async () => {
		const { runtime, store, session } = await setup(retrySettings, entry);
		const previous = globalThis.fetch;
		let inference = 0;
		try {
			await store.modify("anthropic", async () => ({ ...credential, expires: 1 }));
			globalThis.fetch = async input => { if (String(input) === TOKEN_URL) return new Response("invalid_grant", { status: 400 }); inference++; throw new Error("must not infer"); };
			await assert.rejects(runtime.getAuth("anthropic", { env: { ANTHROPIC_API_KEY: "fake-billing" } }), /Refresh HTTP 400.*grant/);
			const result = await runtime.completeSimple(session.model!, context, { env: { ANTHROPIC_API_KEY: "fake-billing" } });
			assert.equal(result.stopReason, "error"); assert.match(result.errorMessage!, /\/login anthropic/);
			await session.prompt("offline proactive failure");
			assert.match(lastAssistant(session).errorMessage!, /\/login anthropic/);
			assert.equal(inference, 0); assert.equal((await store.read("anthropic"))?.access, ACCESS);
		} finally { globalThis.fetch = previous; session.dispose(); }
	});

	it(`${label}: partial SSE error, EOF, overflow and length never auto-replay or lose content/diagnostics`, async () => {
		for (const tail of [
			[{ type: "error", error: { type: "overloaded_error", message: "Overloaded original diagnostic" } }],
			[],
			[{ type: "error", error: { type: "invalid_request_error", message: "prompt is too long: original diagnostic" } }],
			[{ type: "message_delta", delta: { stop_reason: "max_tokens" }, usage: { output_tokens: 2 } }, { type: "message_stop" }],
		]) {
			const { session } = await setup(retrySettings, entry);
			const previous = globalThis.fetch;
			let calls = 0, retries = 0, compactions = 0;
			const emitted: string[] = [];
			session.subscribe(event => {
				if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") emitted.push(event.assistantMessageEvent.delta);
				if (event.type === "auto_retry_start") retries++;
				if (event.type === "compaction_start") compactions++;
			});
			try {
				globalThis.fetch = async () => { calls++; return response([...textEvents, ...tail]); };
				await session.prompt("offline partial stream fixture");
				const result = lastAssistant(session);
				assert.equal(calls, 1); assert.equal(retries, 0); assert.equal(compactions, 0);
				assert.deepEqual(emitted, ["PARTIAL"]); assert.deepEqual(result.content[0], { type: "text", text: "PARTIAL" });
				assert.equal(result.stopReason, tail[0]?.type === "message_delta" ? "length" : "error");
				if (result.stopReason === "error") assert.equal(result.errorMessage, tail.length ? JSON.stringify(tail[0]) : "Anthropic stream ended before message_stop");
				assert.ok(result.diagnostics?.some(item => item.type === "rqw_anthropic_partial_stream"));
				assert.equal(session.sessionManager.getBranch().some(item => item.type === "context_edit"), false);
				// The durable marker also protects a restored message at the pre-prompt compaction boundary.
				const internal = session as unknown as { _checkCompaction(message: unknown, skip: boolean): Promise<boolean>; _runAutoCompaction(): Promise<boolean> };
				internal._runAutoCompaction = async () => { compactions++; return true; };
				assert.equal(await internal._checkCompaction(JSON.parse(JSON.stringify(result)), false), false);
				assert.equal(compactions, 0);
			} finally { globalThis.fetch = previous; session.dispose(); }
		}
	});

	it(`${label}: no partial output still follows stock automatic retry policy`, async () => {
		const { session } = await setup(retrySettings, entry);
		const previous = globalThis.fetch;
		let calls = 0, retries = 0;
		session.subscribe(event => { if (event.type === "auto_retry_start") retries++; });
		try {
			globalThis.fetch = async () => ++calls === 1 ? new Response("overloaded", { status: 529 }) : response([...textEvents, ...finish]);
			await session.prompt("offline retryable pre-stream rejection");
			assert.equal(calls, 2); assert.equal(retries, 1); assert.equal(lastAssistant(session).stopReason, "stop");
			assert.equal(session.autoRetryEnabled, true);
		} finally { globalThis.fetch = previous; session.dispose(); }
	});

	it(`${label}: explicit unrelated and ambient OAuth never borrow a stored bearer; owned concurrent rotation is reusable`, async () => {
		const { runtime, store, session } = await setup(undefined, entry);
		try {
			const sent: string[] = []; let refreshes = 0;
			const result = await runtime.completeSimple(model, context, { apiKey: "sk-ant-oat01-other-account", fetch: async (input, init) => {
				if (String(input) === TOKEN_URL) { refreshes++; return refreshed(); }
				sent.push(new Headers(init?.headers).get("authorization")!); return new Response("rejected", { status: 401 });
			} });
			assert.equal(result.stopReason, "error"); assert.match(result.errorMessage!, /\/login anthropic/);
			assert.deepEqual(sent, ["Bearer sk-ant-oat01-other-account"]); assert.equal(refreshes, 0);
			assert.deepEqual(await store.read("anthropic"), credential);
			let calls = 0;
			const rotated = await runtime.completeSimple(model, context, { fetch: async (input, init) => {
				assert.notEqual(String(input), TOKEN_URL);
				if (++calls === 1) {
					await store.modify("anthropic", async current => refreshCredential(current as typeof credential,
						new AbortController().signal, async () => refreshed()));
					return new Response("expired", { status: 401 });
				}
				assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${NEXT}`); return response([...textEvents, ...finish]);
			} });
			assert.equal(rotated.stopReason, "stop"); assert.equal(calls, 2);
			await store.delete("anthropic"); calls = 0;
			const ambient = await runtime.completeSimple(model, context, { env: { ANTHROPIC_OAUTH_TOKEN: ACCESS }, fetch: async input => {
				assert.notEqual(String(input), TOKEN_URL); calls++; return new Response("expired", { status: 401 });
			} });
			assert.match(ambient.errorMessage!, /\/login anthropic/); assert.equal(calls, 1); assert.equal(await store.read("anthropic"), undefined);
		} finally { session.dispose(); }
	});

	it(`${label}: eight full runtime requests share one refresh and persist optional refresh-token success before replay`, async () => {
		const { runtime, store, session } = await setup(undefined, entry);
		let old = 0, inference = 0, refreshes = 0;
		const allSent = Promise.withResolvers<void>();
		try {
			const fetch: typeof globalThis.fetch = async (input, init) => {
				if (String(input) === TOKEN_URL) { refreshes++; return Response.json({ access_token: NEXT, expires_in: 540 }); }
				inference++;
				if (new Headers(init?.headers).get("authorization") === `Bearer ${ACCESS}`) {
					if (++old === 8) allSent.resolve(); await allSent.promise; return new Response("expired", { status: 401 });
				}
				const saved = await store.read("anthropic"); assert.equal(saved?.access, NEXT); assert.equal(saved?.refresh, credential.refresh);
				return response([...textEvents, ...finish]);
			};
			const results = await within(Promise.all(Array.from({ length: 8 }, () => runtime.completeSimple(model, context, { fetch }))), 5000);
			assert.ok(results.every(result => result.stopReason === "stop")); assert.equal(inference, 16); assert.equal(refreshes, 1);
		} finally { session.dispose(); }
	});

	it(`${label}: native complete retains thinkingDisplay, interleavedThinking and real SDK client; simple defaults remain distinct`, async () => {
		const { runtime, session } = await setup(undefined, entry);
		const stock = await entry.ModelRuntime.create({ credentials: AuthStorage.inMemory({ anthropic: credential }), modelsPath: null, refreshOnCreate: false });
		try {
			for (const apiKey of ["fake-api-key", ACCESS]) {
				const bodies: Record<string, unknown>[] = [];
				const fetch: typeof globalThis.fetch = async (_input, init) => { bodies.push(JSON.parse(String(init?.body))); return new Response("fixture", { status: 400 }); };
				await stock.complete(model, context, { apiKey, fetch, thinkingDisplay: "omitted" });
				await runtime.complete(model, context, { apiKey, fetch, thinkingDisplay: "omitted" });
				assert.deepEqual(bodies[1].thinking, bodies[0].thinking); assert.equal((bodies[1].thinking as { display: string }).display, "omitted");
				bodies.length = 0;
				await stock.completeSimple(model, context, { apiKey, fetch }); await runtime.completeSimple(model, context, { apiKey, fetch });
				assert.deepEqual(bodies[1].thinking, bodies[0].thinking);
				bodies.length = 0;
				await stock.completeSimple(model, context, { apiKey, fetch, reasoning: "low" });
				await runtime.completeSimple(model, context, { apiKey, fetch, reasoning: "low" });
				assert.deepEqual(bodies[1].thinking, bodies[0].thinking);
				assert.deepEqual(bodies[1].output_config, bodies[0].output_config);
				assert.equal(bodies[1].max_tokens, bodies[0].max_tokens);
			}
			const older = base.getModels().find(item => item.reasoning && item.compat?.forceAdaptiveThinking !== true && item.compat?.supportsMidConvoEffort !== true)!;
			const bodies: Record<string, unknown>[] = [];
			const fetch: typeof globalThis.fetch = async (_input, init) => { bodies.push(JSON.parse(String(init?.body))); return response([...textEvents, ...finish]); };
			await runtime.complete(older, context, { apiKey: "fake-api-key", thinkingEnabled: true, interleavedThinking: false, fetch });
			assert.equal((bodies[0].betas as string[] | undefined)?.includes("interleaved-thinking-2025-05-14") ?? false, false);
			let clientCalls = 0;
			const client = new Anthropic({ apiKey: "fake-client-key", fetch: async () => { clientCalls++; return response([...textEvents, ...finish]); } });
			const result = await runtime.complete(model, context, { apiKey: "fake-api-key", client, fetch: async () => { throw new Error("client option was dropped"); } });
			assert.equal(result.stopReason, "stop"); assert.equal(clientCalls, 1);
		} finally { session.dispose(); }
	});

	it(`${label}: fresh 540-second TTL stays stable across concurrent getAuth calls under a real file lock`, async () => {
		const { runtime, session } = await setup(undefined, entry);
		const root = await mkdtemp(join(tmpdir(), "rqw-short-ttl-"));
		const path = join(root, "fake-auth.json");
		const previous = globalThis.fetch;
		try {
			await writeFile(path, JSON.stringify({ anthropic: { ...credential, expires: 1 } }));
			// Use the installed extension's composed provider and native Pi auth resolver with two file stores.
			const provider = (runtime as unknown as { models: { getProvider(id: string): import("@earendil-works/pi-ai").Provider } }).models.getProvider("anthropic");
			const runtimes = await Promise.all([0, 1].map(async () => {
				const item = await entry.ModelRuntime.create({ credentials: AuthStorage.create(path), modelsPath: null, refreshOnCreate: false });
				item.registerNativeProvider(provider); return item;
			}));
			let refreshes = 0;
			globalThis.fetch = async input => { assert.equal(String(input), TOKEN_URL); refreshes++; return refreshed(NEXT, 540); };
			await Promise.all(Array.from({ length: 8 }, (_, i) => runtimes[i % 2].getAuth("anthropic")));
			for (let i = 0; i < 8; i++) await runtimes[i % 2].getAuth("anthropic");
			assert.equal(refreshes, 1);
			const saved = await AuthStorage.create(path).read("anthropic");
			assert.ok(saved!.expires - Date.now() > 535_000 && saved!.expires - Date.now() <= 540_000);
		} finally { globalThis.fetch = previous; session.dispose(); await rm(root, { recursive: true, force: true }); }
	});

	it(`${label}: recovery hook owners restore exact descriptors on final release and reject incomplete classes atomically`, () => {
		const snapshots = () => [
			...["stream", "streamSimple", "prepareRequest", "getAuth"].map(name => Object.getOwnPropertyDescriptor(entry.ModelRuntime.prototype, name)),
			...["_isRetryableError", "_checkCompaction"].map(name => Object.getOwnPropertyDescriptor(entry.AgentSession.prototype, name)),
		];
		const original = snapshots(); const a = installRecoveryHooks(entry.ModelRuntime, entry.AgentSession); const b = installRecoveryHooks(entry.ModelRuntime, entry.AgentSession);
		a(); assert.notDeepEqual(snapshots(), original); a(); b(); assert.deepEqual(snapshots(), original);
		class MissingRuntime {} class MissingSession {}
		assert.throws(() => installRecoveryHooks(MissingRuntime as typeof entry.ModelRuntime, MissingSession as typeof entry.AgentSession), /Nothing was patched/);
		assert.deepEqual(Object.getOwnPropertyNames(MissingRuntime.prototype), ["constructor"]);
	});
}

it("optional refresh_token retains the previous token only when absent; explicit malformed values fail without mutation", async () => {
	const result = await refreshCredential(credential, new AbortController().signal, async () => Response.json({ access_token: NEXT, expires_in: 540 }));
	assert.equal(result.refresh, credential.refresh); assert.ok(result.expires - Date.now() > 539_000);
	for (const refresh_token of ["", " ", "\n", null, 1, {}, []]) {
		const store = AuthStorage.inMemory({ anthropic: credential });
		await assert.rejects(recoverCredential(store, ACCESS, new AbortController().signal, async () => Response.json({ access_token: NEXT, refresh_token, expires_in: 540 })), /Invalid token response/);
		assert.deepEqual(await store.read("anthropic"), credential);
	}
});

it("tool SSE, signatures, usage and scratch cleanup still use the native parser", async () => {
	const events = [start,
		{ type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "", signature: "" } },
		{ type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "reason" } },
		{ type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "opaque-signature" } },
		{ type: "content_block_stop", index: 0 },
		{ type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "fake-tool", name: "Read", input: {} } },
		{ type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"path":' } },
		{ type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '"file.txt"}' } },
		{ type: "content_block_stop", index: 1 },
		{ type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 7 } }, { type: "message_stop" }];
	const result = await createOverlay(base, () => undefined, "d").streamSimple(model, normalizeContext(context), { apiKey: ACCESS, fetch: async () => response(events) }).result();
	assert.equal(result.stopReason, "toolUse");
	assert.deepEqual(result.content[0], { type: "thinking", thinking: "reason", thinkingSignature: "opaque-signature" });
	assert.deepEqual(result.content[1], { type: "toolCall", id: "fake-tool", name: "read", arguments: { path: "file.txt" } });
	assert.equal(result.usage.input, 5); assert.equal(result.usage.output, 7);
});

it("partial SSE abort remains aborted, cancels the body and releases caller recovery listeners", async () => {
	const abort = new AbortController(); let calls = 0, cancelled = false;
	const stream = createOverlay(base, () => undefined, "d").streamSimple(model, normalizeContext(context), { apiKey: ACCESS, signal: abort.signal, fetch: async (_input, init) => {
		calls++;
		return new Response(new ReadableStream({ start(controller) {
			controller.enqueue(new TextEncoder().encode(sse(textEvents)));
			init?.signal?.addEventListener("abort", () => { cancelled = true; controller.error(init.signal?.reason); }, { once: true });
		} }), { headers: { "content-type": "text/event-stream" } });
	} });
	for await (const event of stream) if (event.type === "text_delta") abort.abort();
	const result = await within(stream.result());
	assert.equal(result.stopReason, "aborted"); assert.deepEqual(result.content[0], { type: "text", text: "PARTIAL" });
	assert.equal(calls, 1); assert.equal(cancelled, true);
	const signal = new AbortController().signal; const count = getEventListeners(signal, "abort").length;
	await recoverCredential(AuthStorage.inMemory({ anthropic: credential }), ACCESS, signal, async () => refreshed());
	assert.equal(getEventListeners(signal, "abort").length, count);
});
