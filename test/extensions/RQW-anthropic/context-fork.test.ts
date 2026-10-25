import "./recovery-offline.mjs";
import assert from "node:assert/strict";
import { it, type TestContext } from "node:test";
import { normalizeContext, type AssistantMessage, type Context } from "@earendil-works/pi-ai";
import { createOverlay } from "../../../extensions/RQW-anthropic/transport.ts";
import { xxh64 } from "../../../extensions/RQW-anthropic/wire.ts";
import type { ContextForkRequest } from "../../../extensions/RQW-anthropic/context-fork.ts";
import { createAgentSession, DefaultResourceLoader, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { ACCESS, base, model, context, setup, response, textEvents, finish, start } from "./recovery-fixtures.ts";

const completed = (answer: AssistantMessage): Context => ({ messages: [
	...normalizeContext(context).messages, answer,
	{ role: "user", content: "Report progress from this snapshot only.", timestamp: 3 },
] });
async function sourceOverlay(t: TestContext) {
	const active = await setup();
	const overlay = createOverlay(base, () => active.store, "fake-device");
	const sessionId = active.session.sessionId;
	// Unit transport fixtures model the lifecycle registration of this actual SDK session.
	overlay.forks.registerSource(sessionId);
	t.after(() => { overlay.forks.clear(); active.session.dispose(); });
	return { ...overlay, forks: Object.assign(overlay.forks, { sessionId }), sessionId };
}
function offer(target: { sessionId: string; offer(request: ContextForkRequest): void }, snapshot: Context, signal = new AbortController().signal) {
	let infer: (() => Promise<AssistantMessage>) | undefined;
	target.offer({ sessionId: target.sessionId, model, context: snapshot, signal, reasoning: "low", offer(value) { infer = value; } });
	return infer;
}
function assertChecksum(body: any) {
	const text = body.system[0].text;
	const digest = /cch=([a-f0-9]{5})/.exec(text)![1];
	const copy = structuredClone(body);
	copy.system[0].text = text.replace(`cch=${digest}`, "cch=00000");
	assert.equal(digest, (xxh64(new TextEncoder().encode(JSON.stringify(copy)), 0x4d659218e32a3268n) & 0xfffffn).toString(16).padStart(5, "0"));
}

it("event offer is synchronous; fork stays on its completed snapshot while the child continues, without session writes or callbacks", async () => {
	const active = await setup();
	const originalFetch = globalThis.fetch;
	const bodies: any[] = [];
	globalThis.fetch = async (_input, init) => {
		bodies.push(JSON.parse(String(init?.body)));
		return response([...textEvents, ...finish]);
	};
	try {
		let hooks = 0;
		const options = { sessionId: active.session.sessionId, cacheRetention: "short" as const, reasoning: "low" as const,
			onPayload() { hooks++; }, onResponse() { hooks++; }, onProviderStreamEvent() { hooks++; } };
		const answer = await (await active.session.agent.streamFunction(model, context, options)).result();
		const snapshot = completed(answer);
		let infer: (() => Promise<AssistantMessage>) | undefined;
		const bus = (active.session.resourceLoader as any).eventBus;
		bus.emit("rqw:context-fork:v1", { sessionId: active.session.sessionId, model, context: snapshot, reasoning: "low",
			signal: new AbortController().signal, offer(value: typeof infer) { infer = value; } });
		assert.equal(typeof infer, "function");
		assert.equal(bodies.length, 1, "offer does not start inference");
		(snapshot.messages.at(-1) as any).content = "MUTATED";
		await (await active.session.agent.streamFunction(model, { ...context, messages: [
			...context.messages, answer, { role: "user", content: "New child turn", timestamp: 4 },
		] }, { ...options, cacheRetention: "long" })).result();
		const hookCount = hooks;
		const branch = structuredClone(active.session.sessionManager.getBranch());
		assert.equal((await infer!()).stopReason, "stop");
		assert.equal(hooks, hookCount, "no session observers are called by fork");
		assert.deepEqual(active.session.sessionManager.getBranch(), branch);
		assert.equal(bodies.length, 3);
		assert.deepEqual(bodies[2].system.slice(1), bodies[0].system.slice(1));
		assert.deepEqual(bodies[2].tools, bodies[0].tools);
		assert.deepEqual(bodies[2].messages.slice(0, bodies[0].messages.length), bodies[0].messages);
		assert.equal(bodies[2].messages.findLast((message: any) => message.role === "user").content.at(-1).text, "Report progress from this snapshot only.");
		assert.ok(!JSON.stringify(bodies[2]).includes('"ttl":"1h"'));
		assert.ok(JSON.stringify(bodies[1]).includes('"ttl":"1h"'));
		assert.equal(bodies[2].model, bodies[0].model);
		assert.deepEqual(bodies[2].thinking, bodies[0].thinking);
		assert.deepEqual(bodies[2].output_config, bodies[0].output_config);
		assert.equal(JSON.parse(bodies[2].metadata.user_id).session_id, active.session.sessionId);
		assertChecksum(bodies[0]);
		assertChecksum(bodies[2]);
		assert.notEqual(bodies[2].system[0].text, bodies[0].system[0].text, "valid checksum changes with the tail, so full prefix reuse is best effort");
		await assert.rejects(infer!(), /already consumed/);
	} finally { globalThis.fetch = originalFetch; active.session.dispose(); }
});

for (const reason of ["stop", "restart"] as const) it(`${reason} release removes only its source snapshot, not an already offered fork`, async () => {
	const active = await setup();
	const dir = process.env.PI_CODING_AGENT_DIR!;
	const loader = new DefaultResourceLoader({ cwd: dir, agentDir: dir, noExtensions: true, noSkills: true,
		noPromptTemplates: true, noThemes: true, noContextFiles: true });
	await loader.reload();
	const createChild = async () => (await createAgentSession({ cwd: dir, agentDir: dir, modelRuntime: active.runtime, model,
		resourceLoader: loader, sessionManager: SessionManager.inMemory(dir), settingsManager: SettingsManager.inMemory({ retry: { enabled: false } }) })).session;
	const child = await createChild();
	const sibling = await createChild();
	let replacement: typeof child | undefined;
	const previousFetch = globalThis.fetch;
	const bodies: any[] = [];
	globalThis.fetch = async (_input, init) => {
		bodies.push(JSON.parse(String(init?.body)));
		return response([...textEvents, ...finish]);
	};
	try {
		const bus = (active.session.resourceLoader as any).eventBus;
		const sourceId = child.sessionId;
		const options = { sessionId: sourceId, cacheRetention: "short" as const, reasoning: "low" as const };
		const answer = await (await active.session.agent.streamFunction(model, context, options)).result();
		await (await active.session.agent.streamFunction(model, context, { ...options, sessionId: sibling.sessionId })).result();
		const getOffer = (sessionId: string) => {
			let infer: (() => Promise<AssistantMessage>) | undefined;
			bus.emit("rqw:context-fork:v1", { sessionId, model, context: completed(answer), signal: new AbortController().signal,
				offer(value: typeof infer) { infer = value; } });
			return infer;
		};
		const captured = getOffer(sourceId);
		assert.ok(captured);
		const entries = structuredClone(active.session.sessionManager.getEntries());
		child.dispose(); child.dispose();
		assert.equal(getOffer(sourceId), undefined, "closed source context and body were removed");
		assert.equal(typeof getOffer(sibling.sessionId), "function", "another child's snapshot remains");
		assert.equal(bodies.length, 2, "cleanup and offers send nothing");
		assert.equal((await captured()).stopReason, "stop", "independent captured closure still works");
		assert.deepEqual(bodies[2].system.slice(1), bodies[0].system.slice(1));
		assert.deepEqual(bodies[2].tools, bodies[0].tools);
		assert.deepEqual(active.session.sessionManager.getEntries(), entries);
		assert.equal(getOffer(sourceId), undefined, "fork inference does not re-register the source");
		await (await active.session.agent.streamFunction(model, context, options)).result();
		assert.equal(getOffer(sourceId), undefined, "a late request cannot restore a disposed identity");
		replacement = await createChild();
		await (await active.session.agent.streamFunction(model, context, { ...options, sessionId: replacement.sessionId })).result();
		assert.equal(typeof getOffer(replacement.sessionId), "function", "replacement SDK session owns a newly registered source");
	} finally { globalThis.fetch = previousFetch; replacement?.dispose(); sibling.dispose(); child.dispose(); active.session.dispose(); }
});

it("unknown and released routing IDs are ignored before parsing or retaining a request", async (t) => {
	const overlay = await sourceOverlay(t);
	const normal = normalizeContext(context);
	const options = { apiKey: ACCESS, sessionId: overlay.sessionId, reasoning: "low" as const };
	overlay.forks.release(overlay.sessionId);
	assert.doesNotThrow(() => overlay.forks.capture(model, normal, options, "not JSON"), "unregistered request is never parsed");
	assert.equal(offer(overlay.forks, normal), undefined);
	overlay.forks.registerSource(overlay.sessionId);
	overlay.forks.capture(model, normal, options, JSON.stringify({ system: [], tools: [], messages: [] }));
	assert.equal(typeof offer(overlay.forks, normal), "function", "registered source can capture");
	overlay.forks.release(overlay.sessionId);
	assert.doesNotThrow(() => overlay.forks.capture(model, normal, options, "not JSON"), "late request cannot recreate released registration");
	assert.equal(offer(overlay.forks, normal), undefined);
});

it("released source cannot be retained by a late fetch after its signal was aborted", async (t) => {
	const overlay = await sourceOverlay(t);
	const fetch: typeof globalThis.fetch = async () => response([...textEvents, ...finish]);
	const normal = normalizeContext(context);
	const answer = await overlay.streamSimple(model, normal, { apiKey: ACCESS, fetch, sessionId: overlay.sessionId, reasoning: "low" }).result();
	overlay.forks.release(overlay.sessionId);
	overlay.forks.capture(model, normal, { apiKey: ACCESS, fetch, sessionId: overlay.sessionId, signal: AbortSignal.abort() }, "{}");
	assert.equal(offer(overlay.forks, completed(answer)), undefined);
});

it("tool calls are returned once without execution or a second model turn; hosted declarations are not offered", async (t) => {
	const bodies: any[] = [];
	let toolResponse = false;
	const fetch: typeof globalThis.fetch = async (_input, init) => {
		bodies.push(JSON.parse(String(init?.body)));
		return toolResponse ? response([start,
			{ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "read-id", name: "Read", input: {} } },
			{ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"path":"never-execute"}' } },
			{ type: "content_block_stop", index: 0 },
			{ type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 2 } },
			{ type: "message_stop" }]) : response([...textEvents, ...finish]);
	};
	const overlay = await sourceOverlay(t);
	const normal = normalizeContext(context);
	const answer = await overlay.streamSimple(model, normal, { apiKey: ACCESS, fetch, sessionId: overlay.sessionId, cacheRetention: "short", reasoning: "low" }).result();
	const infer = offer(overlay.forks, completed(answer));
	toolResponse = true;
	const result = await infer!();
	assert.equal(result.stopReason, "toolUse");
	assert.equal(result.content[0].type, "toolCall");
	assert.equal(bodies.length, 2, "no executor or tool loop exists");
	assert.equal(offer(overlay.forks, { messages: [{ role: "user", content: "not the child's transcript", timestamp: 1 }] }), undefined);
	const hosted = { model: model.id, system: bodies[0].system.slice(1), tools: [{ type: "web_search_20250305", name: "web_search" }], messages: bodies[0].messages };
	overlay.forks.capture(model, normal, { apiKey: ACCESS, fetch, sessionId: overlay.sessionId }, JSON.stringify(hosted));
	assert.equal(offer(overlay.forks, completed(answer)), undefined);
	assert.equal(bodies.length, 2, "hosted tool rejection sends no request");
	overlay.forks.clear();
	assert.equal(offer(overlay.forks, completed(answer)), undefined);
});

it("fork abort only cancels its own HTTP request and does not abort the child", async (t) => {
	const child = new AbortController();
	let begin!: () => void;
	const begun = new Promise<void>(resolve => { begin = resolve; });
	let pending = false;
	const fetch: typeof globalThis.fetch = async (_input, init) => {
		if (!pending) return response([...textEvents, ...finish]);
		begin();
		return new Promise((_resolve, reject) => {
			init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason), { once: true });
		});
	};
	const overlay = await sourceOverlay(t);
	const answer = await overlay.streamSimple(model, normalizeContext(context), { apiKey: ACCESS, fetch, sessionId: overlay.sessionId, signal: child.signal, cacheRetention: "short", reasoning: "low" }).result();
	const controller = new AbortController();
	const infer = offer(overlay.forks, completed(answer), controller.signal)!;
	pending = true;
	const result = infer();
	await begun;
	controller.abort();
	await assert.rejects(result, { name: "AbortError" });
	assert.equal(child.signal.aborted, false);
	pending = false;
	assert.equal((await overlay.streamSimple(model, normalizeContext(context), { apiKey: ACCESS, fetch, sessionId: overlay.sessionId, signal: child.signal, reasoning: "low" }).result()).stopReason, "stop");
});

it("dangling tool calls decline without HTTP; completed tool results are included without fabrication", async (t) => {
	const bodies: any[] = [];
	const fetch: typeof globalThis.fetch = async (_input, init) => {
		bodies.push(JSON.parse(String(init?.body)));
		return response([...textEvents, ...finish]);
	};
	const overlay = await sourceOverlay(t);
	const answer = await overlay.streamSimple(model, normalizeContext(context), { apiKey: ACCESS, fetch, sessionId: overlay.sessionId, cacheRetention: "short", reasoning: "low" }).result();
	const call: AssistantMessage = { ...answer, stopReason: "toolUse", content: [{ type: "toolCall", id: "call-1", name: "read", arguments: { path: "already-read" } }] };
	const snapshot = completed(call);
	assert.equal(offer(overlay.forks, snapshot), undefined);
	assert.equal(bodies.length, 1);
	snapshot.messages.splice(snapshot.messages.length - 1, 0, { role: "toolResult", toolCallId: "call-1", toolName: "read", content: [{ type: "text", text: "real tool result" }], isError: false, timestamp: 2 });
	const infer = offer(overlay.forks, snapshot)!;
	assert.equal((await infer()).stopReason, "stop");
	assert.equal(bodies.length, 2);
	assert.ok(JSON.stringify(bodies[1].messages).includes("real tool result"));
	assert.ok(JSON.stringify(bodies[1].messages).includes('"tool_use_id":"call-1"'));
});

it("HTTP failures and cache misses do not retry a fork or affect subsequent child turns", async (t) => {
	let calls = 0;
	let fail = false;
	const fetch: typeof globalThis.fetch = async () => {
		calls++;
		return fail ? Response.json({ type: "error", error: { type: "overloaded_error", message: "offline failure" } }, { status: 529 }) : response([...textEvents, ...finish]);
	};
	const overlay = await sourceOverlay(t);
	const options = { apiKey: ACCESS, fetch, sessionId: overlay.sessionId, cacheRetention: "short" as const, reasoning: "low" as const };
	const answer = await overlay.streamSimple(model, normalizeContext(context), options).result();
	const infer = offer(overlay.forks, completed(answer))!;
	fail = true;
	assert.equal((await infer()).stopReason, "error");
	assert.equal(calls, 2, "one failed HTTP request, no retry storm");
	fail = false;
	const miss = await offer(overlay.forks, completed(answer))!();
	assert.equal(miss.usage.cacheRead, 0);
	assert.equal(miss.stopReason, "stop");
	assert.equal(calls, 3, "a cache miss does not trigger retries");
	assert.equal((await overlay.streamSimple(model, normalizeContext(context), options).result()).stopReason, "stop");
	assert.equal(calls, 4);
});

it("inherited SDK timeout expires without external abort and leaves the child usable", async (t) => {
	const child = new AbortController();
	const fork = new AbortController();
	const begun = Promise.withResolvers<void>();
	let requests = 0;
	let timedOutSignal: AbortSignal | undefined;
	const fetch: typeof globalThis.fetch = async (_input, init) => {
		requests++;
		if (requests !== 2) return response([...textEvents, ...finish]);
		timedOutSignal = init!.signal!;
		begun.resolve();
		return new Promise((_resolve, reject) => {
			init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason), { once: true });
		});
	};
	const overlay = await sourceOverlay(t);
	const options = { apiKey: ACCESS, fetch, sessionId: overlay.sessionId, signal: child.signal, timeoutMs: 25,
		cacheRetention: "short" as const, reasoning: "low" as const };
	const answer = await overlay.streamSimple(model, normalizeContext(context), options).result();
	t.mock.timers.enable({ apis: ["setTimeout"] });
	try {
		const pending = offer(overlay.forks, completed(answer), fork.signal)!();
		await begun.promise;
		t.mock.timers.tick(options.timeoutMs);
		const report = await pending;
		assert.equal(report.stopReason, "error");
		assert.match(report.errorMessage!, /timed? ?out/i);
		assert.equal(timedOutSignal!.aborted, true, "SDK's inherited timeout aborted its fetch");
		assert.equal(fork.signal.aborted, false, "consumer did not cancel");
		assert.equal(child.signal.aborted, false);
		assert.equal(requests, 2, "no SDK timeout retry");
	} finally { t.mock.timers.reset(); }
	assert.equal((await overlay.streamSimple(model, normalizeContext(context), options).result()).stopReason, "stop");
	assert.equal(requests, 3, "the next child turn runs normally");
});

it("pre-aborted and timed-out forks close only their own work", async (t) => {
	let calls = 0;
	let pending = false;
	const child = new AbortController();
	const fetch: typeof globalThis.fetch = async (_input, init) => {
		calls++;
		if (!pending) return response([...textEvents, ...finish]);
		return new Promise((_resolve, reject) => {
			init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason), { once: true });
		});
	};
	const overlay = await sourceOverlay(t);
	const options = { apiKey: ACCESS, fetch, sessionId: overlay.sessionId, signal: child.signal, cacheRetention: "short" as const, reasoning: "low" as const };
	const answer = await overlay.streamSimple(model, normalizeContext(context), options).result();
	const aborted = new AbortController();
	aborted.abort();
	await assert.rejects(offer(overlay.forks, completed(answer), aborted.signal)!(), { name: "AbortError" });
	assert.equal(calls, 1);
	pending = true;
	const deadline = new AbortController();
	const timer = setTimeout(() => deadline.abort(new DOMException("fork deadline", "TimeoutError")), 20);
	try { await assert.rejects(offer(overlay.forks, completed(answer), deadline.signal)!(), { name: "TimeoutError" }); }
	finally { clearTimeout(timer); }
	assert.equal(child.signal.aborted, false);
	assert.equal(calls, 2);
	pending = false;
	assert.equal((await overlay.streamSimple(model, normalizeContext(context), options).result()).stopReason, "stop");
});
