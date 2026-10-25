import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { Provider } from "@earendil-works/pi-ai";
import { createOverlay } from "../../../extensions/RQW-anthropic/transport.ts";
import { isOAuth } from "../../../extensions/RQW-anthropic/auth-boundary.ts";
import { TOKEN_URL } from "../../../extensions/RQW-anthropic/auth.ts";
import { entries } from "./pi-entrypoints.ts";

// Pi hides this store behind package exports; resolve its installed internal entrypoint.
const { AuthStorage } = await import(new URL("./core/auth-storage.js", import.meta.resolve("@earendil-works/pi-coding-agent")).href);
const extensionPath = fileURLToPath(new URL("../../../extensions/RQW-anthropic/index.ts", import.meta.url));
const ACCESS = "sk-ant-oat01-FAKE-AUDIT-ONLY";
const NEXT = "sk-ant-oat01-FAKE-ROTATED";
const credential = { type: "oauth" as const, access: ACCESS, refresh: "FAKE-refresh", expires: Date.now() + 3600_000 };
const context = { messages: [{ role: "user" as const, content: "offline boundary fixture" }] };
const base = builtinProviders().find(provider => provider.id === "anthropic")!;
const savedEnv = { ...process.env };
const savedFetch = globalThis.fetch;
let root: string;
let fixture = 0;
before(async () => {
	root = await mkdtemp(join(tmpdir(), "rqw-auth-boundary-"));
	for (const name of ["HOME", "USERPROFILE", "PI_CODING_AGENT_DIR"]) process.env[name] = root;
	process.env.PI_OFFLINE = "1";
	for (const name of Object.keys(process.env)) if (name.startsWith("ANTHROPIC_")) delete process.env[name];
	globalThis.fetch = async () => { throw new Error("External network forbidden in auth boundary tests"); };
});
after(async () => {
	globalThis.fetch = savedFetch;
	for (const name of Object.keys(process.env)) if (!(name in savedEnv)) delete process.env[name];
	Object.assign(process.env, savedEnv);
	await rm(root, { recursive: true, force: true });
});
const rejection = () => Response.json({ error: { message: "mock fixture" } }, { status: 400 });

it("matches native includes classification and rejects unsupported OAuth before the direct delegate", () => {
	for (const value of [ACCESS, ` ${ACCESS}`, `${ACCESS} `, `prefix-${ACCESS}`, `Bearer ${ACCESS}`]) assert.equal(isOAuth(value), true);
	for (const value of [undefined, "", "fake-key", "fake-gateway-token"]) assert.equal(isOAuth(value), false);
	let calls = 0;
	const stream = createAssistantMessageEventStream();
	const faux: Provider = { ...base,
		stream() { calls++; return stream; }, streamSimple() { calls++; return stream; },
	};
	const overlay = createOverlay(faux, () => undefined, "fake-device");
	for (const baseUrl of ["https://api.anthropic.com", "https://untrusted.example"]) {
		for (const auth of [
			{ apiKey: ` ${ACCESS}` }, { apiKey: `${ACCESS} ` }, { apiKey: `prefix-${ACCESS}` },
			{ apiKey: "fake-key", headers: { Authorization: `Basic ${ACCESS}` } },
			{ apiKey: "fake-key", headers: { "x-api-key": ACCESS } },
			{ apiKey: "fake-key", headers: { "x-trace": `prefix ${ACCESS} suffix` } },
		]) assert.throws(() => overlay.streamSimple({ ...base.getModels()[0], baseUrl }, context, auth), error => {
			assert.ok(error instanceof Error && error.message.includes("RQW-anthropic"));
			assert.ok(!String(error).includes(ACCESS));
			return true;
		});
	}
	assert.equal(calls, 0);
	assert.throws(() => overlay.streamSimple({ ...base.getModels()[0], api: "openai-completions" }, context, { apiKey: ACCESS }), /using anthropic-messages/);
	assert.equal(calls, 0);
	const ordinary = { apiKey: "fake-key", headers: { Authorization: "Bearer fake-gateway-token" } };
	assert.equal(overlay.streamSimple({ ...base.getModels()[0], baseUrl: "https://gateway.example" }, context, ordinary), stream);
	assert.equal(calls, 1);
	assert.equal(overlay.streamSimple(base.getModels()[0], context, { apiKey: ACCESS }), stream);
	assert.equal(calls, 2);
});

for (const [label, entry] of entries) describe(`auth boundary with real Pi: ${label}`, () => {
	async function setup(config?: unknown, credentials: Record<string, typeof credential> = { anthropic: credential }) {
		let modelsPath: string | null = null;
		if (config) {
			modelsPath = join(root, `models-${++fixture}.json`);
			await writeFile(modelsPath, JSON.stringify(config));
		}
		const store = AuthStorage.inMemory(credentials);
		const runtime = await entry.ModelRuntime.create({ credentials: store, modelsPath, refreshOnCreate: false });
		await runtime.refresh({ allowNetwork: false });
		const loader = new entry.DefaultResourceLoader({ cwd: root, agentDir: root, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
			extensionPathsOverride: [], additionalExtensionPaths: [extensionPath] });
		await loader.reload();
		assert.deepEqual(loader.getExtensions().errors, []);
		const { session } = await entry.createAgentSession({ cwd: root, agentDir: root, modelRuntime: runtime,
			model: runtime.getModels("anthropic")[0], resourceLoader: loader, noTools: "all",
			sessionManager: entry.SessionManager.inMemory(root), settingsManager: entry.SettingsManager.inMemory({ retry: { enabled: false }, cacheWarming: "off" }) });
		await session.bindExtensions({});
		return { session, runtime, store };
	}
	it("blocks stored OAuth with provider-level and model-level models.json API overrides before stock dispatch", async () => {
		for (const api of ["openai-completions", "openai-responses", "google-generative-ai"]) {
			for (const level of ["provider", "model"]) {
				for (const baseUrl of ["https://untrusted.example/v1", "https://api.anthropic.com"]) {
					const definition = { id: "fake-custom-api", ...(level === "model" ? { api } : {}), contextWindow: 10000, maxTokens: 32, reasoning: false, input: ["text"] };
					const { session, runtime, store } = await setup({ providers: { anthropic: { ...(level === "provider" ? { api } : {}), baseUrl, models: [definition] } } });
					try {
						const model = runtime.getModel("anthropic", definition.id)!;
						assert.equal(model.api, api);
						assert.deepEqual(await store.read("anthropic"), credential);
						for (const complete of [runtime.complete.bind(runtime), runtime.completeSimple.bind(runtime)]) {
							let calls = 0;
							const result = await complete(model, context, { maxRetries: 0, fetch: async () => { calls++; return rejection(); } });
							assert.equal(calls, 0, `${api}, ${level}, ${baseUrl}`);
							assert.match(result.errorMessage!, /RQW-anthropic: subscription tokens.*using anthropic-messages/);
							assert.ok(!result.errorMessage!.includes(ACCESS));
						}
					} finally { session.dispose(); }
				}
			}
		}
	});
	it("rejects all audit key/header forms, including effective transforms, on both origins", async () => {
		const { session, runtime } = await setup();
		try {
			for (const api of ["anthropic-messages", "openai-completions", "openai-responses"]) {
				for (const baseUrl of ["https://untrusted.example", "https://api.anthropic.com"]) {
					for (const auth of [
						{ apiKey: "FAKE-normal", headers: { "x-api-key": ACCESS } },
						{ apiKey: "FAKE-normal", headers: { Authorization: `Basic ${ACCESS}` } },
						{ apiKey: "FAKE-normal", headers: { Authorization: `Bearer  ${ACCESS} ` } },
						{ apiKey: "FAKE-normal", headers: { "x-observation": `prefix-${ACCESS}-suffix` } },
						{ apiKey: ` ${ACCESS}` }, { apiKey: `${ACCESS} ` }, { apiKey: `prefix-${ACCESS}` },
						{ apiKey: `Bearer ${ACCESS}` }, { apiKey: `${ACCESS}\n` },
						{ apiKey: "FAKE-normal", transformHeaders: async () => ({ "x-api-key": ACCESS }) },
						{ apiKey: "FAKE-normal", transformHeaders: async () => ({ Authorization: `Basic ${ACCESS}` }) },
					]) {
						let calls = 0;
						const result = await runtime.completeSimple({ ...session.model!, api, baseUrl }, context,
							{ ...auth, maxRetries: 0, fetch: async () => { calls++; return rejection(); } });
						assert.equal(calls, 0);
						assert.match(result.errorMessage!, /RQW-anthropic:.*unsupported/);
						assert.ok(!result.errorMessage!.includes(ACCESS));
					}
					// A transform changes prepared options, but cannot remove separately supplied model headers.
					let calls = 0;
					const result = await runtime.completeSimple({ ...session.model!, api, baseUrl, headers: { "x-model": ACCESS } }, context,
						{ apiKey: "FAKE-normal", transformHeaders: async () => ({}), fetch: async () => { calls++; return rejection(); } });
					assert.equal(calls, 0);
					assert.match(result.errorMessage!, /OAuth-bearing headers/);
				}
			}
		} finally { session.dispose(); }
	});
	it("checks resolved configured model headers and native env auth, not raw config strings", async () => {
		for (const headers of [{ "x-api-key": ACCESS }, { Authorization: `Basic ${ACCESS}` }, { "x-other": `prefix-${ACCESS}` }]) {
			const { session, runtime } = await setup({ providers: { anthropic: { baseUrl: "https://untrusted.example", modelOverrides: {
				[base.getModels()[0].id]: { headers },
			} } } });
			try {
				let calls = 0;
				const result = await runtime.completeSimple(session.model!, context, { apiKey: "FAKE-normal", fetch: async () => { calls++; return rejection(); } });
				assert.equal(calls, 0);
				assert.match(result.errorMessage!, /OAuth-bearing headers/);
			} finally { session.dispose(); }
		}
		const { session, runtime } = await setup(undefined, {});
		try {
			for (const env of [{ ANTHROPIC_AUTH_TOKEN: ACCESS }, { ANTHROPIC_OAUTH_TOKEN: ` ${ACCESS}` }, { ANTHROPIC_API_KEY: `prefix-${ACCESS}` }]) {
				let calls = 0;
				const result = await runtime.completeSimple({ ...session.model!, baseUrl: "https://untrusted.example" }, context,
					{ env, maxRetries: 0, fetch: async () => { calls++; return rejection(); } });
				assert.equal(calls, 0);
				assert.match(result.errorMessage!, /RQW-anthropic:.*unsupported/);
				assert.ok(!result.errorMessage!.includes(ACCESS));
			}
			for (const headers of [`x-api-key: ${ACCESS}`, `Authorization: Basic ${ACCESS}`, `x-sdk-observation: prefix-${ACCESS}`]) {
				process.env.ANTHROPIC_CUSTOM_HEADERS = headers;
				try {
					let calls = 0;
					const result = await runtime.completeSimple({ ...session.model!, baseUrl: "https://untrusted.example" }, context,
						{ apiKey: "FAKE-normal", maxRetries: 0, fetch: async () => { calls++; return rejection(); } });
					assert.equal(calls, 0);
					assert.match(result.errorMessage!, /OAuth-bearing headers/);
				} finally { delete process.env.ANTHROPIC_CUSTOM_HEADERS; }
			}
		} finally { session.dispose(); }
	});
	it("keeps canonical OAuth protected, rejects nonofficial origins, and refreshes only at the trusted endpoint", async () => {
		const { session, runtime, store } = await setup();
		try {
			for (const baseUrl of ["http://api.anthropic.com", "https://api.anthropic.com.evil.example", "https://api.anthropic.com:444", "https://untrusted.example"]) {
				let calls = 0;
				const result = await runtime.completeSimple({ ...session.model!, baseUrl }, context, { fetch: async () => { calls++; return rejection(); } });
				assert.equal(calls, 0);
				assert.match(result.errorMessage!, /subscription tokens may only be sent/);
			}
			for (const auth of [{}, { apiKey: ACCESS }]) {
				let calls = 0;
				await runtime.completeSimple(session.model!, context, { ...auth, fetch: async (url, init) => {
					calls++;
					assert.equal(new URL(String(url)).origin, "https://api.anthropic.com");
					assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${ACCESS}`);
					assert.equal(init?.redirect, "error");
					assert.ok(String(init?.body).includes("cc_entrypoint=cli;"));
					return rejection();
				} });
				assert.equal(calls, 1);
			}
			await store.modify("anthropic", async () => ({ ...credential, expires: 1 }));
			let refreshes = 0;
			const forbidden = globalThis.fetch;
			globalThis.fetch = async input => {
				assert.equal(String(input), TOKEN_URL);
				refreshes++;
				return Response.json({ access_token: NEXT, refresh_token: "FAKE-rotated", expires_in: 3600 });
			};
			try {
				let calls = 0;
				const result = await runtime.completeSimple({ ...session.model!, api: "openai-completions", baseUrl: "https://untrusted.example/v1" }, context,
					{ fetch: async () => { calls++; return rejection(); } });
				assert.equal(refreshes, 1);
				assert.equal(calls, 0);
				assert.match(result.errorMessage!, /subscription tokens may only be sent/);
				assert.equal((await store.read("anthropic"))?.access, NEXT);
			} finally { globalThis.fetch = forbidden; }
		} finally { session.dispose(); }
	});
	it("preserves ordinary API-key and bearer gateways across APIs and effective header transformations", async () => {
		const { session, runtime } = await setup(undefined, {});
		try {
			for (const api of ["anthropic-messages", "openai-completions", "openai-responses"]) {
				for (const auth of [
					{ apiKey: "sk-ant-api03-FAKE-ordinary" },
					{ apiKey: "FAKE-normal", headers: { Authorization: "Bearer fake-gateway-token" } },
					{ env: { ANTHROPIC_AUTH_TOKEN: "fake-gateway-token" } },
					{ apiKey: "FAKE-normal", headers: { "x-api-key": ACCESS }, transformHeaders: async () => ({ Authorization: "Bearer fake-gateway-token" }) },
				]) {
					let calls = 0;
					await runtime.completeSimple({ ...session.model!, api, baseUrl: "https://gateway.example/v1" }, context,
						{ ...auth, maxRetries: 0, fetch: async (url, init) => {
							calls++;
							assert.equal(new URL(String(url)).origin, "https://gateway.example");
							assert.ok(![...new Headers(init?.headers).values()].some(value => value.includes(ACCESS)));
							if (auth.headers?.Authorization || auth.env || auth.transformHeaders) assert.equal(new Headers(init?.headers).get("authorization"), "Bearer fake-gateway-token");
							assert.ok(!String(init?.body).includes("cc_entrypoint=cli;"));
							return rejection();
						} });
					assert.equal(calls, 1, api);
				}
			}
			// The boundary is not a credential sandbox for unrelated providers.
			let calls = 0;
			await runtime.completeSimple({ ...session.model!, provider: "openai", api: "openai-completions", baseUrl: "https://gateway.example/v1" }, context,
				{ apiKey: `FAKE-other-${ACCESS}`, maxRetries: 0, fetch: async () => { calls++; return rejection(); } });
			assert.equal(calls, 1);
		} finally { session.dispose(); }
	});
});
