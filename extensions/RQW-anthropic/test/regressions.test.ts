import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import type { AgentSession, ModelRuntime } from "@earendil-works/pi-coding-agent";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import { createOverlay, subscriptionFetch } from "../transport.ts";
import { IDENTITY, versionState } from "../wire.ts";
import { entries } from "./pi-entrypoints.ts";

// Deliberately test Pi's internal store and independently loaded bundle, not API stand-ins.
const { AuthStorage } = await import(new URL("./core/auth-storage.js", import.meta.resolve("@earendil-works/pi-coding-agent")).href);
const extensionPath = fileURLToPath(new URL("../index.ts", import.meta.url));
const ACCESS = "sk-ant-oat01-fake-regression";
const credential = { type: "oauth" as const, access: ACCESS, refresh: "fake-refresh", expires: Date.now() + 3600_000 };
const context = { messages: [{ role: "user" as const, content: "offline fixture" }] };
const raw = JSON.stringify({ system: [{ type: "text", text: IDENTITY }], messages: [{ role: "user", content: "fixture" }] });
const savedFetch = globalThis.fetch;
const envNames = ["HOME", "USERPROFILE", "PI_CODING_AGENT_DIR", "PI_OFFLINE"];
const savedEnv = envNames.map(name => process.env[name]);
let root: string;
let competitorPath: string;
before(async () => {
	root = await mkdtemp(join(tmpdir(), "rqw-anthropic-regressions-"));
	for (const name of envNames) process.env[name] = name === "PI_OFFLINE" ? "1" : root;
	globalThis.fetch = async () => { throw new Error("External network forbidden in regression tests"); };
	competitorPath = process.env.RQW_ANTHROPIC_CONFLICT_EXTENSION ?? join(root, "competitor.ts");
	if (!process.env.RQW_ANTHROPIC_CONFLICT_EXTENSION) await writeFile(competitorPath, `export default function(pi) {
		pi.registerProvider("anthropic", {api:"anthropic-messages", streamSimple(){throw new Error("unused competitor transport");}});
		pi.on("session_start", () => {}); pi.on("agent_end", () => {}); pi.on("context", () => {});
		pi.registerCommand("claude-refusal-rewind", {handler: async () => {}});
	}`);
});
after(async () => {
	globalThis.fetch = savedFetch;
	envNames.forEach((name, i) => { if (savedEnv[i] === undefined) delete process.env[name]; else process.env[name] = savedEnv[i]; });
	await rm(root, { recursive: true, force: true });
});

describe("concurrent minimum-version rejections", () => {
	it("replays both old requests exactly once after either neighbor adopts the minimum", async () => {
		for (const pinned of [false, true]) {
			const version = pinned ? versionState("2.1.280") : versionState();
			const bothSent = Promise.withResolvers<void>();
			let calls = 0;
			const sent: string[] = [];
			const transport: typeof fetch = async (_url, init) => {
				calls++;
				const agent = new Headers(init?.headers).get("user-agent")!;
				sent.push(agent);
				if (agent.includes("2.1.280")) {
					if (calls === 2) bothSent.resolve();
					await bothSent.promise;
					return new Response("claude_code_version_too_old: version 2.2.0 or newer is required", { status: 400 });
				}
				assert.ok(String(init?.body).includes("cc_version=2.2.0."));
				return new Response("ok");
			};
			const wrapped = subscriptionFetch(transport, undefined, version, "s", "d");
			const responses = await Promise.all([0, 1].map(() => wrapped("https://api.anthropic.com/v1/messages", {
				method: "POST", body: raw, headers: { authorization: `Bearer ${ACCESS}` },
			})));
			assert.deepEqual(responses.map(response => response.status), pinned ? [400, 400] : [200, 200]);
			assert.equal(calls, pinned ? 2 : 4);
			assert.equal(sent.filter(agent => agent.includes("2.1.280")).length, 2);
			assert.equal(version.value, pinned ? "2.1.280" : "2.2.0");
		}
	});
	it("keeps the per-request replay bound and rejects unrelated or already-current errors", async () => {
		for (const message of ["claude_code_version_too_old: version 2.2.0 or newer is required", "version 9.0.0 or newer is required", "claude_code_version_too_old: version 2.1.280 or newer is required"]) {
			let calls = 0;
			const wrapped = subscriptionFetch(async () => { calls++; return new Response(message, { status: 400 }); }, undefined, versionState(), "s", "d");
			assert.equal((await wrapped("https://api.anthropic.com/v1/messages", { method: "POST", body: raw })).status, 400);
			assert.equal(calls, message.includes("version 2.2.0") ? 2 : 1);
		}
	});
});

it("rejects model-level OAuth Authorization before even calling the stock delegate", () => {
	const base = builtinProviders().find(provider => provider.id === "anthropic")!;
	const overlay = createOverlay(base, () => undefined, "device");
	assert.throws(() => overlay.streamSimple({ ...base.getModels()[0], baseUrl: "https://untrusted.example", headers: { aUtHoRiZaTiOn: `bEaReR ${ACCESS}` } }, context,
		{ apiKey: "fake-key", fetch: async () => { throw new Error("must not delegate"); } }), /OAuth Authorization headers.*unsupported/);
});

for (const [label, entry] of entries) describe(`regressions with real Pi: ${label}`, () => {
	async function setup(paths = [extensionPath], withCredential = true, modelsPath: string | null = null) {
		const store = AuthStorage.inMemory({ ...(withCredential ? { anthropic: credential } : {}), openrouter: { type: "api_key", key: "fake-other" } });
		const runtime = await entry.ModelRuntime.create({ credentials: store, modelsPath, refreshOnCreate: false });
		await runtime.refresh({ allowNetwork: false });
		const model = runtime.getModels("anthropic")[0];
		const loader = new entry.DefaultResourceLoader({ cwd: root, agentDir: root, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
			extensionPathsOverride: [], additionalExtensionPaths: paths });
		await loader.reload();
		assert.deepEqual(loader.getExtensions().errors, []);
		const { session, extensionsResult } = await entry.createAgentSession({ cwd: root, agentDir: root, modelRuntime: runtime, model, resourceLoader: loader,
			sessionManager: entry.SessionManager.inMemory(root), settingsManager: entry.SettingsManager.inMemory({ retry: { enabled: false } }) });
		return { session, runtime, store, extensionsResult };
	}
	it("blocks resolved environment and header OAuth on official and external origins; keeps API-key gateways", async () => {
		const { session, runtime } = await setup(undefined, false);
		try {
			await session.bindExtensions({});
			for (const baseUrl of ["https://api.anthropic.com", "https://untrusted.example"]) {
				for (const auth of [
					{ env: { ANTHROPIC_AUTH_TOKEN: ACCESS } },
					{ apiKey: "fake-api-key", headers: { aUtHoRiZaTiOn: `Bearer ${ACCESS}` } },
					{ env: { ANTHROPIC_OAUTH_TOKEN: ACCESS } },
				]) {
					let calls = 0;
					const result = await runtime.completeSimple({ ...session.model!, baseUrl }, context, { ...auth, maxRetries: 0, fetch: async (_url, init) => {
						calls++;
						assert.equal(baseUrl, "https://api.anthropic.com");
						assert.ok(String(init?.body).includes("cc_entrypoint=cli;"));
						return Response.json({ error: { message: "fixture" } }, { status: 400 });
					} });
					const canonical = "ANTHROPIC_OAUTH_TOKEN" in (auth.env ?? {});
					assert.equal(calls, canonical && baseUrl === "https://api.anthropic.com" ? 1 : 0);
					if (!canonical) {
						assert.match(result.errorMessage!, /OAuth Authorization headers.*unsupported/);
						assert.ok(!result.errorMessage!.includes(ACCESS));
					}
				}
			}
			// A real process-env path, not just options.env resolution.
			const saved = process.env.ANTHROPIC_AUTH_TOKEN;
			process.env.ANTHROPIC_AUTH_TOKEN = ACCESS;
			try {
				let calls = 0;
				const result = await runtime.completeSimple({ ...session.model!, baseUrl: "https://untrusted.example" }, context,
					{ maxRetries: 0, fetch: async () => { calls++; throw new Error("must not send"); } });
				assert.equal(calls, 0);
				assert.match(result.errorMessage!, /OAuth Authorization headers.*unsupported/);
			} finally { if (saved === undefined) delete process.env.ANTHROPIC_AUTH_TOKEN; else process.env.ANTHROPIC_AUTH_TOKEN = saved; }
			for (const auth of [{ apiKey: "fake-api-key" }, { env: { ANTHROPIC_AUTH_TOKEN: "fake-gateway-token" } }]) {
				let calls = 0;
				await runtime.completeSimple({ ...session.model!, baseUrl: "https://gateway.example" }, context, { ...auth, maxRetries: 0, fetch: async (url, init) => {
					calls++;
					assert.ok(String(url).startsWith("https://gateway.example/"));
					assert.ok(!String(init?.body).includes("cc_entrypoint=cli;"));
					return Response.json({ error: { message: "fixture" } }, { status: 400 });
				} });
				assert.equal(calls, 1);
			}
		} finally { session.dispose(); }
	});
	it("rejects OAuth headers resolved from a real models.json before transport", async () => {
		const path = join(root, `headers-${label.replaceAll(" ", "-")}.json`);
		await writeFile(path, JSON.stringify({ providers: { anthropic: { baseUrl: "https://untrusted.example", headers: { Authorization: `Bearer ${ACCESS}` } } } }));
		const { session, runtime } = await setup(undefined, true, path);
		try {
			await session.bindExtensions({});
			let calls = 0;
			const result = await runtime.completeSimple(session.model!, context, { maxRetries: 0, fetch: async () => { calls++; throw new Error("must not send"); } });
			assert.equal(calls, 0);
			assert.match(result.errorMessage!, /OAuth Authorization headers.*unsupported/);
		} finally { session.dispose(); }
	});
	it("unsupported co-load keeps native session diagnostics without poisoning another runtime", async () => {
		const independent = await setup();
		try {
			for (const paths of [[extensionPath, competitorPath], [competitorPath, extensionPath]]) {
				const { session, runtime, extensionsResult } = await setup(paths);
				try {
					const competing = extensionsResult.extensions.find(extension => extension.path === competitorPath)!;
					assert.ok(competing.handlers.has("context"));
					assert.ok(session.extensionRunner.getRegisteredCommands().some(command => command.name === "claude-refusal-rewind"));
					let competingStart = 0;
					competing.handlers.set("session_start", [() => { competingStart++; }]);
					const errors: string[] = [];
					session.extensionRunner.onError(error => errors.push(error.error));
					await session.bindExtensions({});
					assert.equal(competingStart, 1, "native Pi does not quarantine competing handlers");
					assert.deepEqual(errors, paths[0] === extensionPath ? [] : ["RQW-anthropic: subscription authentication failed. Retry the turn; if it persists, use /login anthropic. Saved credentials were not removed. Adapter registration is unavailable."]);
					assert.ok(runtime.getProviders().length >= 2);
					assert.ok(runtime.getModels().length > 0);
					assert.equal(independent.runtime.getProviders().length, 2);
				} finally { session.dispose(); }
			}
		} finally { independent.session.dispose(); }
	});
	it("SDK dispose cleans both session orders, reload and repeated shutdown without leaking any descriptor or overlay", async () => {
		const runtimeNames = ["getProviders", "getModels", "getAvailableSnapshot", "getAvailable", "prepareRequest", "registerProvider", "registerNativeProvider"];
		const sessionNames = ["scopedModels", "dispose", "bindExtensions", "_bindExtensionCore"];
		const snapshot = () => [
			...runtimeNames.map(name => Object.getOwnPropertyDescriptor(entry.ModelRuntime.prototype, name)),
			...sessionNames.map(name => Object.getOwnPropertyDescriptor(entry.AgentSession.prototype, name)),
		];
		const original = snapshot();
		for (const first of [0, 1]) {
			for (const mode of ["dispose", "reload", "shutdown"]) {
				const sessions: { session: AgentSession; runtime: ModelRuntime; store: InstanceType<typeof AuthStorage> }[] = [await setup(), await setup()];
				try {
					for (const item of sessions) await item.session.bindExtensions({});
					const a = sessions[first], b = sessions[1 - first];
					if (mode === "reload") { await a.session.reload(); await b.session.reload(); }
					if (mode === "shutdown") {
						await a.session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
						await a.session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
					}
					a.session.dispose(); a.session.dispose();
					assert.equal(a.runtime.getRegisteredProviderConfig("anthropic"), undefined);
					assert.ok(a.runtime.getProviders().length > 2);
					assert.equal(b.runtime.getProviders().length, 2);
					assert.notDeepEqual(snapshot(), original);
					b.session.dispose(); b.session.dispose();
					for (const item of sessions) {
						const errors: string[] = [];
						item.session.extensionRunner.onError(error => errors.push(error.error));
						await item.session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
						assert.deepEqual(errors, []);
						assert.equal(item.runtime.getRegisteredProviderConfig("anthropic"), undefined);
						assert.deepEqual(await item.store.read("anthropic"), credential);
						assert.deepEqual(await item.store.read("openrouter"), { type: "api_key", key: "fake-other" });
					}
					assert.deepEqual(snapshot(), original);
				} finally { for (const item of sessions) item.session.dispose(); }
			}
		}
	});
});
