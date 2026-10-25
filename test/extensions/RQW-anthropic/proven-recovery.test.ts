import "./recovery-offline.mjs";
import assert from "node:assert/strict";
import { it } from "node:test";
import { createAssistantMessageEventStream, normalizeContext, type AssistantMessage } from "@earendil-works/pi-ai";
import { refreshCredential, recoverCredential, TOKEN_URL } from "../../../extensions/RQW-anthropic/auth.ts";
import { protectPartialStream } from "../../../extensions/RQW-anthropic/retry.ts";
import { entries } from "./pi-entrypoints.ts";
import { ACCESS, NEXT, credential, AuthStorage, base, model, context, setup, refreshed, within,
	start, textEvents, finish, response, sse, subscriptionFetch, versionState, url, request, type SseEvent } from "./recovery-fixtures.ts";

const retrySettings = { retry: { enabled: true, maxRetries: 1, baseDelayMs: 1 } };
const marker = (message: AssistantMessage) => message.diagnostics?.some(item => item.type === "rqw_anthropic_partial_stream") === true;
const last = (session: { messages: readonly { role: string }[] }) => session.messages.filter(m => m.role === "assistant").at(-1) as AssistantMessage;
const overloaded = { type: "error", error: { type: "overloaded_error", message: "Overloaded fixture" } };

for (const [label, entry] of entries) {
	for (const method of ["complete", "completeSimple"] as const) {
		it(`${label} ${method}: delayed native A cannot replay with an independent whole-store login B`, async () => {
			const { runtime, store, session } = await setup(retrySettings, entry);
			const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
			const b = { ...credential, access: `sk-ant-oat01-independent-${label.replaceAll(" ", "-")}-${method}`, refresh: "independent-B-refresh" };
			const sent: string[] = [];
			let refreshes = 0;
			const fetch: typeof globalThis.fetch = async (input, init) => {
				if (String(input) === TOKEN_URL) { refreshes++; return refreshed(); }
				const bearer = new Headers(init?.headers).get("authorization")!;
				sent.push(bearer);
				return bearer === `Bearer ${b.access}` ? response([...textEvents, ...finish]) : new Response("expired A", { status: 401 });
			};
			const delayed = runtime[method](model, context, { fetch, onPayload: async payload => {
				entered.resolve(); await release.promise; return payload;
			} });
			try {
				await within(entered.promise, 5000);
				assert.deepEqual(sent, []);
				await store.modify("anthropic", async () => b);
				release.resolve();
				const result = await within(delayed, 5000);
				assert.equal(result.stopReason, "error");
				assert.match(result.errorMessage!, /Saved login changed.*Start a new turn/);
				assert.match(result.errorMessage!, /\/login anthropic/);
				for (const secret of [ACCESS, b.access, b.refresh]) assert.ok(!result.errorMessage!.includes(secret));
				assert.deepEqual(sent, [`Bearer ${ACCESS}`]); assert.equal(refreshes, 0);
				assert.deepEqual(await store.read("anthropic"), b);
				// A fresh user request deliberately resolves B, rather than inheriting delayed A's origin.
				assert.equal((await runtime[method](model, context, { fetch })).stopReason, "stop");
				assert.deepEqual(sent, [`Bearer ${ACCESS}`, `Bearer ${b.access}`]);
			} finally { release.resolve(); await delayed; session.dispose(); }
		});

		for (const proactive of [false, true]) {
			it(`${label} ${method}: delayed A reuses a genuine ${proactive ? "native proactive" : "reactive"} refresh with one rotation`, async () => {
				const { runtime, store, session } = await setup(undefined, entry);
				const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
				let refreshes = 0;
				const sent: string[] = [];
				const previous = globalThis.fetch;
				const fetch: typeof globalThis.fetch = async (input, init) => {
					if (String(input) === TOKEN_URL) { refreshes++; return refreshed(); }
					const bearer = new Headers(init?.headers).get("authorization")!; sent.push(bearer);
					return bearer === `Bearer ${ACCESS}` ? new Response("expired", { status: 401 }) : response([...textEvents, ...finish]);
				};
				const delayed = runtime[method](model, context, { fetch, onPayload: async payload => {
					entered.resolve(); await release.promise; return payload;
				} });
				try {
					await within(entered.promise, 5000);
					if (proactive) {
						await store.modify("anthropic", async current => ({ ...current!, expires: 1 }));
						globalThis.fetch = fetch;
						await runtime.getAuth("anthropic");
					} else assert.equal((await runtime[method](model, context, { fetch })).stopReason, "stop");
					assert.equal((await store.read("anthropic"))?.access, NEXT);
					release.resolve();
					const result = await within(delayed, 5000);
					assert.equal(result.stopReason, "stop", result.errorMessage); assert.equal(refreshes, 1);
					assert.deepEqual(sent, (proactive ? [ACCESS, NEXT] : [ACCESS, NEXT, ACCESS, NEXT]).map(v => `Bearer ${v}`));
				} finally { globalThis.fetch = previous; release.resolve(); await delayed; session.dispose(); }
			});
		}
	}

	it(`${label}: eight mixed native/simple requests use one proven refresh, without changing credential shape`, async () => {
		const { runtime, store, session } = await setup(undefined, entry);
		let old = 0, refreshes = 0;
		const sent = Promise.withResolvers<void>();
		try {
			const fetch: typeof globalThis.fetch = async (input, init) => {
				if (String(input) === TOKEN_URL) { refreshes++; return refreshed(); }
				if (new Headers(init?.headers).get("authorization") === `Bearer ${ACCESS}`) {
					if (++old === 8) sent.resolve(); await sent.promise; return new Response("expired", { status: 401 });
				}
				const saved = await store.read("anthropic");
				assert.equal(saved?.access, NEXT); assert.equal(saved?.refresh, "audit-rotated");
				assert.deepEqual(Object.keys(saved!).sort(), Object.keys(credential).sort());
				return response([...textEvents, ...finish]);
			};
			const results = await within(Promise.all(Array.from({ length: 8 }, (_, i) =>
				i % 2 ? runtime.complete(model, context, { fetch }) : runtime.completeSimple(model, context, { fetch }))), 5000);
			assert.ok(results.every(result => result.stopReason === "stop")); assert.equal(refreshes, 1); assert.equal(old, 8);
		} finally { session.dispose(); }
	});

	for (const [name, prelude] of [
		["message_start", [start]],
		["ping and usage only", [{ type: "ping" }, { type: "message_delta", delta: {}, usage: { output_tokens: 17 } }]],
		["message_start plus ping and usage", [start, { type: "ping" }, { type: "message_delta", delta: {}, usage: { output_tokens: 17 } }]],
		["empty text block", [start, { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }]],
		["empty thinking block", [start, { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } }]],
	] as [string, SseEvent[]][]) {
		it(`${label}: ${name} then overload keeps the same zero-output retry as native Pi`, async () => {
			for (const overlay of [false, true]) {
				const active = await setup(retrySettings, entry);
				// Use the same native session/parser, with the overlay disabled for the control.
				if (!overlay) active.runtime.unregisterProvider("anthropic");
				const previous = globalThis.fetch;
				let calls = 0, retries = 0;
				const failed: AssistantMessage[] = [];
				active.session.subscribe(event => {
					if (event.type === "auto_retry_start") retries++;
					if (event.type === "message_end" && event.message.role === "assistant" && event.message.stopReason === "error") failed.push(event.message);
				});
				try {
					globalThis.fetch = async () => ++calls === 1 ? response([...prelude, overloaded]) : response([...textEvents, ...finish]);
					await within(active.session.prompt("offline zero-output stream retry"), 5000);
					assert.equal(calls, 2); assert.equal(retries, 1); assert.equal(last(active.session).stopReason, "stop");
					assert.equal(failed.length, 1); assert.equal(marker(failed[0]), false);
					assert.equal(failed[0].errorMessage, JSON.stringify(overloaded));
				} finally { globalThis.fetch = previous; active.session.dispose(); }
			}
		});
	}

	for (const [name, blocks] of [
		["initial text before any delta", [{ type: "content_block_start", index: 0, content_block: { type: "text", text: "INITIAL" } }]],
		["initial thinking before any delta", [{ type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "REASON" } }]],
		["redacted thinking", [{ type: "content_block_start", index: 0, content_block: { type: "redacted_thinking", data: "opaque-signature" } }]],
		["tool start with no arguments", [{ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "fake-tool", name: "Read", input: {} } }]],
		["partial tool arguments", [{ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "fake-tool", name: "Read", input: {} } },
			{ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"path":"part' } }]],
		["thinking delta", [{ type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } },
			{ type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "PARTIAL REASON" } }]],
		["text delta", textEvents.slice(1)],
	] as [string, SseEvent[]][]) {
		it(`${label}: ${name} protects overload, EOF, overflow and restored length without changing native content`, async () => {
			for (const tail of [[overloaded], [],
				[{ type: "error", error: { type: "invalid_request_error", message: "prompt is too long: fixture" } }],
				[{ type: "message_delta", delta: { stop_reason: "max_tokens" }, usage: { output_tokens: 2 } }, { type: "message_stop" }],
			] as SseEvent[][]) {
				const { runtime, session } = await setup(retrySettings, entry);
				const previous = globalThis.fetch;
				let calls = 0, retries = 0, compactions = 0;
				session.subscribe(event => {
					if (event.type === "auto_retry_start") retries++;
					if (event.type === "compaction_start") compactions++;
				});
				try {
					const events = [start, ...blocks, ...tail];
					const control = await base.stream(model, normalizeContext(context), { apiKey: ACCESS, fetch: async () => response(events) }).result();
					globalThis.fetch = async () => {
						calls++;
						// Split the SSE at arbitrary byte boundaries without a second parser or buffering layer.
						const bytes = new TextEncoder().encode(sse(events)); let offset = 0;
						return new Response(new ReadableStream({ pull(controller) {
							if (offset === bytes.length) { controller.close(); return; }
							const end = Math.min(offset + 13, bytes.length); controller.enqueue(bytes.slice(offset, end)); offset = end;
						} }), { headers: { "content-type": "text/event-stream" } });
					};
					// Pi normally continues after a truncated tool call. Check that result at the native
					// completion and restored retry boundaries, not by disabling normal tool turns.
					const truncatedTool = control.stopReason === "length" && control.content.some(b => b.type === "toolCall");
					const result = truncatedTool ? await runtime.completeSimple(model, context, { fetch: globalThis.fetch }) :
						(await within(session.prompt("offline real partial content"), 5000), last(session));
					assert.equal(calls, 1); assert.equal(retries, 0); assert.equal(compactions, 0); assert.equal(marker(result), true);
					assert.deepEqual(result.content, control.content); assert.deepEqual(result.usage, control.usage);
					assert.equal(result.stopReason, control.stopReason); assert.equal(result.errorMessage, control.errorMessage);
					assert.deepEqual(result.diagnostics?.filter(d => d.type !== "rqw_anthropic_partial_stream"), control.diagnostics ?? []);
					const restored = JSON.parse(JSON.stringify(result));
					const internal = session as unknown as { _isRetryableError(m: AssistantMessage): boolean; _checkCompaction(m: AssistantMessage, skip: boolean): Promise<boolean>; _runAutoCompaction(): Promise<boolean> };
					internal._runAutoCompaction = async () => { compactions++; return true; };
					assert.equal(internal._isRetryableError(restored), false); assert.equal(await internal._checkCompaction(restored, false), false);
					assert.equal(compactions, 0);
				} finally { globalThis.fetch = previous; session.dispose(); }
			}
		});
	}
}

it("terminal native parser content protects text, thinking and tool start even without higher-level output events", async () => {
	for (const content_block of [{ type: "text", text: "PARSED" }, { type: "thinking", thinking: "PARSED" },
		{ type: "tool_use", id: "t", name: "Read", input: {} }]) {
		const native = base.stream(model, normalizeContext(context), { apiKey: ACCESS, fetch: async () => response([
			start, { type: "content_block_start", index: 0, content_block }, overloaded,
		]) });
		const terminalOnly = createAssistantMessageEventStream();
		void (async () => {
			for await (const event of native) if (event.type === "start" || event.type === "error" || event.type === "done") terminalOnly.push(event);
			terminalOnly.end(await native.result());
		})();
		const result = await protectPartialStream(terminalOnly).result();
		assert.equal(marker(result), true); assert.equal(result.content.length, 1); assert.equal(result.errorMessage, JSON.stringify(overloaded));
	}
});

it("successful bodies stay identical, lazy and streaming", async () => {
	let pulled = 0;
	const body = new ReadableStream({ pull(controller) { pulled++; controller.enqueue(new Uint8Array([65])); controller.close(); } }, { highWaterMark: 0 });
	const original = new Response(body, { headers: { "content-type": "text/event-stream" } });
	const result = await subscriptionFetch(async () => original, undefined, versionState(), "s", "d")(url, request());
	assert.equal(result, original); assert.equal(pulled, 0); assert.equal(await result.text(), "A"); assert.equal(pulled, 1);
});

it("proof spans independent auth module copies and multiple refresh edges, but never trusts an unknown terminal grant", async () => {
	const copy = await import("../../../extensions/RQW-anthropic/auth.ts?independent-rotation-module");
	const old = { ...credential, access: "sk-ant-oat01-copy-original", refresh: "copy-refresh" };
	const store = AuthStorage.inMemory({ anthropic: old });
	const signal = new AbortController().signal;
	await store.modify("anthropic", async current => copy.refreshCredential(current!, signal, async () => refreshed("sk-ant-oat01-copy-middle")));
	await store.modify("anthropic", async current => copy.refreshCredential(current!, signal, async () => refreshed("sk-ant-oat01-copy-final")));
	const noFetch: typeof globalThis.fetch = async () => { throw new Error("must reuse proof without a token request"); };
	assert.equal(await recoverCredential(store, old.access, signal, noFetch), "sk-ant-oat01-copy-final");
	await store.modify("anthropic", async current => ({ ...current!, refresh: "unknown-current-grant" }));
	await assert.rejects(recoverCredential(store, old.access, signal, noFetch), /Saved login changed.*Start a new turn/);
});

it("unknown external rotation fails without HTTP; bounded shared metadata contains hashes only and evicts old proof safely", async () => {
	const signal = new AbortController().signal;
	const old = { ...credential, access: "sk-ant-oat01-bound-original", refresh: "bound-refresh" };
	const next = await refreshCredential(old, signal, async () => refreshed("sk-ant-oat01-bound-next"));
	const store = AuthStorage.inMemory({ anthropic: next });
	const noFetch: typeof globalThis.fetch = async () => { throw new Error("must not send HTTP"); };
	assert.equal(await recoverCredential(store, old.access, signal, noFetch), next.access);
	for (let i = 0; i < 256; i++) await refreshCredential({ ...old, access: `sk-ant-oat01-bound-${i}` }, signal, async () => refreshed(`sk-ant-oat01-bound-new-${i}`));
	await assert.rejects(recoverCredential(store, old.access, signal, noFetch), /Saved login changed/);
	const metadata = (globalThis as Record<symbol, unknown>)[Symbol.for("rqw-anthropic/proven-refresh-rotations/v1")] as Map<string, { access: string; refresh: string }>;
	assert.equal(metadata.size, 256);
	for (const [key, edge] of metadata) for (const value of [key, edge.access, edge.refresh]) assert.match(value, /^[a-f0-9]{64}$/);
	await store.modify("anthropic", async () => ({ ...old, access: "sk-ant-oat01-external-unknown", refresh: "external-unknown-refresh" }));
	await assert.rejects(recoverCredential(store, old.access, signal, noFetch), /Saved login changed/);
});
