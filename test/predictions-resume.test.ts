import assert from "node:assert/strict";
import { it } from "node:test";
import { InMemoryCredentialStore, normalizeContext, type AssistantMessage, type Context } from "@earendil-works/pi-ai";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import { ModelRegistry, ModelRuntime } from "@earendil-works/pi-coding-agent";
import { createOverlay } from "../extensions/RQW-anthropic/transport.ts";
import { versionState } from "../extensions/RQW-anthropic/wire.ts";
import { CTRL_E, harness, settle } from "./extensions/RQW-predictions/harness.ts";

// Cross-extension transport contract: Pi, credentials, prompt source and network are fixtures.
it("a resumed prediction before the first main request keeps the main Claude Code identity", async t => {
	const credentials = new InMemoryCredentialStore();
	await credentials.modify("anthropic", async () => ({
		type: "oauth", access: "sk-ant-oat01-offline", refresh: "unused", expires: 4_102_444_800_000,
	}));
	const runtime = await ModelRuntime.create({ credentials, modelsPath: null, refreshOnCreate: false });
	const base = builtinProviders().find(provider => provider.id === "anthropic")!;
	const overlay = createOverlay(base, () => credentials, "offline-device", versionState("2.1.280"));
	runtime.registerProvider("anthropic", overlay);
	const registry = new ModelRegistry(runtime);
	const model = runtime.getModel("anthropic", "claude-opus-5-5")!;
	const requests: { headers: Headers; body: Record<string, any> }[] = [];
	t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
		const request = new Request(input, init);
		assert.equal(new URL(request.url).origin, "https://api.anthropic.com");
		requests.push({ headers: request.headers, body: JSON.parse(await request.text()) });
		const events = [
			{ type: "message_start", message: { id: "offline", type: "message", role: "assistant", model: model.id,
				content: [], usage: { input_tokens: 1, output_tokens: 0 } } },
			{ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
			{ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: '{"suggestion":"run the tests"}' } },
			{ type: "content_block_stop", index: 0 },
			{ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } },
			{ type: "message_stop" },
		];
		return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""), {
			headers: { "content-type": "text/event-stream" },
		});
	});

	const h = harness({ fork: false });
	t.after(() => h.fire("session_shutdown", { reason: "quit" }));
	h.ctx.model = model;
	Object.assign(h.ctx, { modelRegistry: registry });
	h.events.on("rqw:context-fork:v1", request => overlay.forks.offer(request as Parameters<typeof overlay.forks.offer>[0]));
	overlay.forks.registerSource(h.state.sessionId);
	h.fire("session_start", { reason: "resume" });
	h.key(CTRL_E);
	for (let i = 0; i < 100 && h.controller.suggestion() === undefined && h.notes.length === 0; i++) await settle();
	assert.deepEqual(h.notes, []);
	assert.equal(h.controller.suggestion(), "run the tests");
	assert.equal(h.main.length, 0, "no main request has been recorded since resume");
	assert.equal(requests.length, 1);

	const context: Context = { messages: [
		{ role: "system", content: h.ctx.getSystemPrompt(), timestamp: 1,
			toolsAdded: [{ name: "read", description: "Read a file", parameters: { type: "object" } }] },
		...h.ctx.sessionManager.buildSessionProjection().messages,
	] } as Context;
	const main = await registry.streamSimple(model, context, { sessionId: h.state.sessionId, reasoning: "medium" }).result();
	assert.equal(main.stopReason, "stop");
	assert.equal(requests.length, 2);
	const [prediction, control] = requests;
	assert.equal(control.headers.get("x-claude-code-session-id"), h.state.sessionId);
	assert.equal(prediction.headers.get("x-claude-code-session-id"), control.headers.get("x-claude-code-session-id"));
	assert.deepEqual(prediction.body.metadata, control.body.metadata);
	assert.deepEqual(prediction.body.system, control.body.system);
	assert.deepEqual(prediction.body.tools, control.body.tools);
	for (const header of ["user-agent", "x-app", "anthropic-beta"]) {
		assert.equal(prediction.headers.get(header), control.headers.get(header), header);
	}

	// A side request for another model must not replace the main request's fork source.
	const other = base.getModels().find(candidate => candidate.id !== model.id)!;
	h.setModel(other);
	h.key(CTRL_E);
	for (let i = 0; i < 100 && requests.length < 3 && h.notes.length === 0; i++) await settle();
	assert.deepEqual(h.notes, []);
	assert.equal(requests.length, 3);
	assert.equal(requests[2].headers.get("x-claude-code-session-id"), h.state.sessionId);
	let infer: (() => Promise<AssistantMessage>) | undefined;
	h.events.emit("rqw:context-fork:v1", {
		sessionId: h.state.sessionId, model, context: normalizeContext(context), signal: new AbortController().signal,
		offer: (run: () => Promise<AssistantMessage>) => { infer = run; },
	});
	assert.ok(infer, "the original main model and context remain available to side-chat forks");
	assert.equal((await infer()).stopReason, "stop");
});
