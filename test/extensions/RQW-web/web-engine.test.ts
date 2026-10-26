import assert from "node:assert/strict";
import { it } from "node:test";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { researchTarget } from "../../../extensions/RQW-web/core/web-engine.ts";
import type { ResearchTargetOptions, WebTransport } from "../../../extensions/RQW-web/core/web-types.ts";

const searchCall = { type: "function_call", namespace: "web", name: "run", call_id: "call-1",
	arguments: JSON.stringify({ search_query: [{ q: "Pi documentation" }] }), status: "completed" };
const answer = { type: "message", role: "assistant", content: [{ type: "output_text",
	text: "Verified [documentation](https://example.com/docs).", annotations: [] }], status: "completed" };
const events = (...items: unknown[]) => [
	...items.map((item, output_index) => ({ type: "response.output_item.done", item, output_index })),
	{ type: "response.completed", response: { id: "response", status: "completed" } },
];
async function setup(scripts: unknown[][]): Promise<ResearchTargetOptions> {
	const credentialStore = new InMemoryCredentialStore();
	await credentialStore.modify("openai-codex", async () => ({
		type: "oauth", access: "fake-access", refresh: "fake-refresh", expires: Number.MAX_SAFE_INTEGER, accountId: "fake-owner",
	}));
	const transport: WebTransport = {
		beginTurn() {}, endTurn() {}, dispose() {},
		async *sendRaw() { for (const event of scripts.shift() ?? []) yield event as Record<string, unknown>; },
	};
	return {
		target: { kind: "query", value: "Pi documentation" }, model: "gpt-6-luna", effort: "medium", credentialStore,
		network: {
			createTransport: () => transport,
			fetch: async () => Response.json({ output: "Source content", results: [{ opaque: "kept" }] }),
		},
	};
}

it("returns a sourced answer after one fake native search", async () => {
	const result = await researchTarget(await setup([events(searchCall), events(answer)]));
	assert.equal(result.status, "ok");
	assert.equal(result.summary, "Verified [documentation](https://example.com/docs).");
	assert.deepEqual(result.sources, [{ url: "https://example.com/docs" }]);
	assert.deepEqual(result.results, [{ opaque: "kept" }]);
});

it("rejects a memory-only answer without web evidence", async () => {
	const result = await researchTarget(await setup([events(answer)]));
	assert.equal(result.status, "error");
	assert.equal(result.error?.code, "no_web_evidence");
});
