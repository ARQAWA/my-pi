import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
import { Readable } from "node:stream";
import { after, it, type TestContext } from "node:test";
import { join } from "node:path";
import { writeFileSync } from "node:fs";
import * as zlib from "node:zlib";
import { call, reportTimings, text, world } from "./synthetic/world.ts";

const stockRequest = https.request;
const stockFetch = globalThis.fetch;

after(() => {
	reportTimings(import.meta.filename);
	assert.equal("mock" in globalThis.fetch, false, "a test left its fetch route behind");
});

type World = Awaited<ReturnType<typeof world>>;

const searchCall = {
	type: "function_call", namespace: "web", name: "run", call_id: "call-1", status: "completed",
	arguments: JSON.stringify({ search_query: [{ q: "Pi documentation" }] }),
};
const answer = {
	type: "message", role: "assistant", status: "completed",
	content: [{ type: "output_text", text: "Verified [documentation](https://example.com/docs).", annotations: [] }],
};
/** The events of one model round of the search backend, as items of one response. */
const round = (...items: unknown[]) => [
	...items.map((item, output_index) => ({ type: "response.output_item.done", item, output_index })),
	{ type: "response.completed", response: { id: "response", status: "completed" } },
];

/** What the fake Codex backend saw: the refused upgrades, the model rounds as decoded request bodies, the page searches. */
interface Backend {
	upgrades: string[];
	rounds: { model: string; effort: string }[];
	searches: number;
	unrouted: string[];
}

/**
 * The outside of RQW-web: the websocket upgrade is refused with 426, so the search falls back to the event stream,
 * and the event stream and the page search answer from the scripted rounds. Anything else is recorded and fails.
 * Installed on top of the world's network block; the route is taken back before the world gives the real functions back.
 */
function fakeBackend(t: TestContext, scripted: unknown[][]): { backend: Backend; install(): void } {
	const backend: Backend = { upgrades: [], rounds: [], searches: 0, unrouted: [] };
	const restores: (() => void)[] = [];
	t.after(() => { while (restores.length) restores.pop()!(); });
	const refuseUpgrade = (options: { host?: string; hostname?: string }) => {
		backend.upgrades.push(String(options.hostname ?? options.host));
		const request: any = new EventEmitter();
		request.end = () => queueMicrotask(() => {
			const response: any = Readable.from([]);
			response.statusCode = 426;
			response.headers = {};
			request.emit("response", response);
		});
		request.destroy = () => request;
		request.abort = () => {};
		return request;
	};
	const route = async (input: string | URL | Request, init?: RequestInit) => {
		const url = String(input);
		if (url.endsWith("/codex/responses")) {
			const request = JSON.parse(zlib.zstdDecompressSync(init!.body as Uint8Array).toString("utf8"));
			backend.rounds.push({ model: request.model, effort: request.reasoning?.effort });
			const events = scripted.shift() ?? [];
			return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } });
		}
		if (url.endsWith("/codex/alpha/search")) {
			backend.searches++;
			return Response.json({ output: "Source content", results: [{ title: "Docs" }] });
		}
		backend.unrouted.push(url);
		throw new Error(`unrouted: ${url}`);
	};
	return {
		backend,
		install() {
			const previousRequest = https.request;
			const previousFetch = globalThis.fetch;
			https.request = refuseUpgrade as never;
			globalThis.fetch = route as typeof fetch;
			restores.push(() => {
				https.request = previousRequest;
				globalThis.fetch = previousFetch;
				syncBuiltinESMExports();
			});
			syncBuiltinESMExports();
		},
	};
}

/** The saved Codex login the tool reads, read-only, from the agent folder; the world's own logins live in memory. */
function saveLogin(w: World) {
	const login = { type: "oauth", access: "opaque-access", refresh: "opaque-refresh", expires: 4_102_444_800_000, accountId: "acct" };
	writeFileSync(join(w.dirs.agent, "auth.json"), JSON.stringify({ "openai-codex": login }));
}

/** The tool result the model saw in its request after `toolCallId`. */
function toolResultText(w: World, toolCallId: string): string {
	const result = w.requests.flatMap((request) => request.context.messages).findLast((message) => message.role === "toolResult" && message.toolCallId === toolCallId) as any;
	return JSON.stringify(result?.content ?? "");
}

it("a web call is answered through the fake backend and comes back to the model as a sourced report", async (t) => {
	const { backend, install } = fakeBackend(t, [round(searchCall), round(answer)]);
	const w = await world(t, { model: "anthropic/claude-opus-5-5", thinking: "medium" });
	install();
	saveLogin(w);
	w.model.script(call("web", { queries: ["Pi documentation"] }, "w1"), text("read it"));
	await w.submit("look it up");
	w.see("read it");
	const report = toolResultText(w, "w1");
	assert.match(report, /1 target, 1 ok, 0 failed/);
	assert.match(report, /Verified \[documentation\]\(https:\/\/example\.com\/docs\)/);
	assert.deepEqual(backend.rounds, [{ model: "gpt-6.1-sol", effort: "medium" }, { model: "gpt-6.1-sol", effort: "medium" }]);
	assert.equal(backend.searches, 1);
	assert.deepEqual(backend.upgrades, ["chatgpt.com"]);
	assert.deepEqual(backend.unrouted, []);
});

it("a caller model the search does not know is searched with Sol at low effort", async (t) => {
	const { backend, install } = fakeBackend(t, [round(searchCall), round(answer)]);
	const w = await world(t, { model: "anthropic/claude-opus-5-5", thinking: "high" });
	// The picker offers only listed models, so a caller outside the list is put straight into the agent state.
	const state = w.session.agent.state;
	state.model = { ...state.model, id: "claude-sonnet-4-5" };
	install();
	saveLogin(w);
	w.model.script(call("web", { queries: ["Pi documentation"] }, "w1"), text("read it"));
	await w.submit("look it up");
	assert.match(toolResultText(w, "w1"), /1 target, 1 ok, 0 failed/);
	assert.deepEqual(backend.rounds.map(({ model, effort }) => `${model} ${effort}`), ["gpt-6.1-sol low", "gpt-6.1-sol low"]);
});

it("without a saved Codex login the call fails with the login hint and nothing goes out", async (t) => {
	const { backend, install } = fakeBackend(t, [round(searchCall), round(answer)]);
	const w = await world(t);
	install();
	w.model.script(call("web", { queries: ["Pi documentation"] }, "w1"), text("could not"));
	await w.submit("look it up");
	assert.match(toolResultText(w, "w1"), /0 ok, 1 failed.*authentication_failed.*\/login openai-codex/s);
	assert.deepEqual(backend.upgrades, []);
	assert.deepEqual(backend.rounds, []);
});

it("restores the network functions after the web scenarios", () => {
	assert.equal(https.request, stockRequest);
	assert.equal(globalThis.fetch, stockFetch);
});
