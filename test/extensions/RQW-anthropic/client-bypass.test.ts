import "./recovery-offline.mjs";
import assert from "node:assert/strict";
import { it } from "node:test";
import Anthropic from "@anthropic-ai/sdk";
import { TOKEN_URL } from "../../../extensions/RQW-anthropic/auth.ts";
import { IDENTITY, xxh64 } from "../../../extensions/RQW-anthropic/wire.ts";
import { entries } from "./pi-entrypoints.ts";
import { ACCESS, NEXT, context, credential, finish, model, refreshed, response, setup, textEvents } from "./recovery-fixtures.ts";

for (const [label, entry] of entries) {
	for (const method of ["complete", "completeSimple"] as const) {
		for (const explicit of [false, true]) {
			it(`${label}: ${method} ${explicit ? "explicit" : "stored"} OAuth cannot use a custom client's origin or bypass wrapped fetch`, async t => {
				const { runtime, store, session } = await setup(undefined, entry);
				const clientRequests: Request[] = [];
				const client = new Anthropic({ apiKey: null, authToken: ACCESS, baseURL: "https://gateway.invalid", fetch: async (input, init) => {
					clientRequests.push(new Request(input, init));
					return response([...textEvents, ...finish]);
				} });
				const sent: string[] = [];
				let refreshes = 0;
				try {
					const result = await runtime[method](model, context, { client, ...(explicit ? { apiKey: ACCESS } : {}), fetch: async (input, init) => {
						if (String(input) === TOKEN_URL) { refreshes++; return refreshed(); }
						const request = new Request(input, init);
						assert.equal(new URL(request.url).origin, "https://api.anthropic.com");
						assert.equal(request.redirect, "error");
						assert.equal(request.headers.has("x-api-key"), false);
						const bearer = request.headers.get("authorization")!;
						sent.push(bearer);
						const body = JSON.parse(await request.text());
						assert.equal(body.system[1].text, IDENTITY);
						assert.match(body.system[0].text, /^x-anthropic-billing-header: .*cch=[0-9a-f]{5};$/);
						const checksum = /cch=([0-9a-f]{5})/.exec(body.system[0].text)![1];
						body.system[0].text = body.system[0].text.replace(`cch=${checksum}`, "cch=00000");
						const hash = xxh64(new TextEncoder().encode(JSON.stringify(body)), 0x4d659218e32a3268n);
						assert.equal(checksum, (hash & 0xfffffn).toString(16).padStart(5, "0"));
						if (!explicit && sent.length === 1) return new Response("expired", { status: 401 });
						assert.equal((await store.read("anthropic"))?.access, explicit ? ACCESS : NEXT);
						return response([...textEvents, ...finish]);
					} });
					t.diagnostic(JSON.stringify({ clientOrigins: clientRequests.map(request => new URL(request.url).origin), wrappedFetchCalls: sent.length, refreshes }));
					assert.equal(clientRequests.length, 0, "OAuth must never enter the caller's SDK client");
					assert.equal(result.stopReason, "stop", result.errorMessage);
					assert.deepEqual(sent, explicit ? [`Bearer ${ACCESS}`] : [`Bearer ${ACCESS}`, `Bearer ${NEXT}`]);
					assert.equal(refreshes, explicit ? 0 : 1);
				} finally { session.dispose(); }
			});
		}
	}

	it(`${label}: ordinary API-key custom client keeps its own origin and fetch`, async () => {
		const { runtime, store, session } = await setup(undefined, entry);
		const sent: Request[] = [];
		const client = new Anthropic({ apiKey: "fake-client-key", baseURL: "https://gateway.invalid", fetch: async (input, init) => {
			sent.push(new Request(input, init));
			return response([...textEvents, ...finish]);
		} });
		let wrappedFetchCalls = 0;
		try {
			const result = await runtime.complete(model, context, { apiKey: "fake-api-key", client, fetch: async () => {
				wrappedFetchCalls++; throw new Error("API-key custom client must remain native");
			} });
			assert.equal(result.stopReason, "stop", result.errorMessage);
			assert.equal(sent.length, 1);
			assert.equal(wrappedFetchCalls, 0);
			for (const request of sent) {
				assert.equal(new URL(request.url).origin, "https://gateway.invalid");
				assert.equal(request.headers.get("x-api-key"), "fake-client-key");
				assert.equal(request.headers.has("authorization"), false);
				assert.equal((await request.text()).includes("x-anthropic-billing-header"), false);
			}
			assert.deepEqual(await store.read("anthropic"), credential);
		} finally { session.dispose(); }
	});
}
