import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import type { OAuthCredential, Provider } from "@earendil-works/pi-ai";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import * as pi from "@earendil-works/pi-coding-agent";
import { IDENTITY, billingBody, versionState, xxh64 } from "../wire.ts";
import { LOGIN_HELP, recoverCredential, refreshCredential, TOKEN_URL } from "../auth.ts";
import { subscriptionFetch, createOverlay } from "../transport.ts";
import { installVisibility, OVERLAY, BIND_STORE } from "../visibility.ts";
import { entries } from "./pi-entrypoints.ts";

// Internal storage import deliberately tests Pi's file locking boundary, not a public extension dependency.
const { AuthStorage } = await import(new URL("./core/auth-storage.js", import.meta.resolve("@earendil-works/pi-coding-agent")).href);

const ACCESS = "sk-ant-oat01-fake-old";
const NEXT = "sk-ant-oat01-fake-new";
const credential: OAuthCredential = { type: "oauth", access: ACCESS, refresh: "fake-refresh", expires: Date.now() + 3600_000 };
const raw = JSON.stringify({ model: "claude-test", max_tokens: 32, stream: true,
	system: [{ type: "text", text: IDENTITY }, { type: "text", text: "Keep this system instruction", cache_control: { type: "ephemeral" } }],
	messages: [{ role: "user", content: [{ type: "text", text: "Hello cch=00000; world" }] }] });
function refreshed() { return Response.json({ access_token: NEXT, refresh_token: "fake-rotated", expires_in: 3600 }); }
function request(signal?: AbortSignal) {
	return { method: "POST", body: raw, headers: { authorization: `Bearer ${ACCESS}` }, signal };
}
const url = "https://api.anthropic.com/v1/messages";
const savedFetch = globalThis.fetch;
let root: string;
const savedAgentDir = process.env.PI_CODING_AGENT_DIR;
before(async () => {
	root = await mkdtemp(join(tmpdir(), "rqw-anthropic-"));
	process.env.PI_CODING_AGENT_DIR = root;
	globalThis.fetch = async () => { throw new Error("Unexpected external network request in offline test"); };
});
after(async () => {
	globalThis.fetch = savedFetch;
	if (savedAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = savedAgentDir;
	await rm(root, { recursive: true, force: true });
});

describe("omp-compatible wire", () => {
	it("matches independent XXH64 reference vectors", () => {
		for (const [text, hash] of [["", "ef46db3751d8e999"], ["a", "d24ec4f1a98c6e5b"], ["abc", "44bc2cf5ad770999"], ["The quick brown fox jumps over the lazy dog", "b242d361fda71bc"]]) {
			assert.equal(xxh64(new TextEncoder().encode(text)).toString(16), hash);
		}
	});
	it("retains system role, hashes exact body, leaves user checksum literals intact", () => {
		const signed = billingBody(raw, "2.1.280", "session", "device");
		const body = JSON.parse(signed);
		assert.equal(body.system[1].text, IDENTITY);
		assert.equal(body.system[2].text, "Keep this system instruction");
		assert.deepEqual(body.messages, JSON.parse(raw).messages);
		assert.deepEqual(body.system[2].cache_control, { type: "ephemeral" });
		const fingerprint = createHash("sha256").update("59cf53e54c78" + [4, 7, 20].map(i => "Hello cch=00000; world"[i] ?? "0").join("") + "2.1.280").digest("hex").slice(0, 3);
		assert.ok(body.system[0].text.includes(`cc_version=2.1.280.${fingerprint}; cc_entrypoint=cli;`));
		const digest = /cch=([0-9a-f]{5});/.exec(body.system[0].text)![1];
		body.system[0].text = body.system[0].text.replace(`cch=${digest}`, "cch=00000");
		assert.equal((xxh64(new TextEncoder().encode(JSON.stringify(body)), 0x4d659218e32a3268n) & 0xfffffn).toString(16).padStart(5, "0"), digest);
		assert.throws(() => billingBody("{}", "2.1.280", "s", "d"), /unsupported/);
	});
    it("uses omp's first non-empty block fingerprint, not the installed fork's concatenation", () => {
        const fixture = JSON.parse(raw);
        fixture.messages[0].content = [{ type: "text", text: "    " }, { type: "text", text: "first" }, { type: "text", text: "second block" }];
        const signed = JSON.parse(billingBody(JSON.stringify(fixture), "2.1.280", "s", "d"));
        const suffix = createHash("sha256").update("59cf53e54c78t00" + "2.1.280").digest("hex").slice(0, 3);
        assert.ok(signed.system[0].text.includes(`cc_version=2.1.280.${suffix};`));
    });
	it("adopts increasing explicit minimum versions only, respects override", () => {
		const version = versionState();
		assert.equal(version.adopt("claude_code_version_too_old: version 2.1.999 or newer is required"), true);
		assert.equal(version.adopt("claude_code_version_too_old: version 2.1.999 or newer is required"), false);
		assert.equal(version.adopt("version 3.0.0 or newer is required"), false);
		assert.equal(versionState("2.1.1").adopt("claude_code_version_too_old: version 3.0.0 or newer is required"), false);
		assert.throws(() => versionState("bad"), /major.minor.patch/);
	});
});

describe("refresh and atomic credential recovery", () => {
	it("retries transient failures once and retains extra credential fields", async () => {
		for (const failure of [429, 500, "network"]) {
			let calls = 0;
			const transport: typeof fetch = async (input, init) => {
				assert.equal(String(input), TOKEN_URL);
				assert.equal(new Headers(init?.headers).get("anthropic-beta"), "oauth-2025-04-20");
				if (++calls === 1) {
					if (failure === "network") throw new Error("offline");
					return new Response("redacted", { status: Number(failure) });
				}
				return refreshed();
			};
			const result = await refreshCredential({ ...credential, accountId: "fake-account" }, new AbortController().signal, transport);
			assert.equal(calls, 2);
			assert.equal(result.accountId, "fake-account");
			assert.ok(result.refresh !== credential.refresh);
		}
	});
	it("does not retry invalid_grant or malformed responses, does not expose upstream bodies", async () => {
		for (const response of [new Response("sensitive upstream body", { status: 400 }), Response.json({}), new Response("bad json")]) {
			let calls = 0;
			await assert.rejects(refreshCredential(credential, new AbortController().signal, async () => { calls++; return response; }), error => {
				assert.ok(error instanceof Error && error.message.includes("/login anthropic"));
				assert.ok(!String(error).includes("sensitive upstream"));
				return true;
			});
			assert.equal(calls, 1);
		}
	});
	it("serializes concurrent 401 recovery across separate file-backed stores", async () => {
		const path = join(root, "concurrent-auth.json");
		await writeFile(path, JSON.stringify({ anthropic: credential, other: { type: "api_key", key: "fake-other" } }));
		const stores = [AuthStorage.create(path), AuthStorage.create(path)];
		let calls = 0;
		const transport: typeof fetch = async () => { calls++; return refreshed(); };
		await Promise.all(Array.from({ length: 8 }, (_, i) => recoverCredential(stores[i % 2], ACCESS, new AbortController().signal, transport)));
		assert.equal(calls, 1);
		const persisted = JSON.parse(await readFile(path, "utf8"));
		assert.ok(persisted.anthropic.access !== ACCESS);
		assert.deepEqual(persisted.other, { type: "api_key", key: "fake-other" });
	});
	it("preserves credentials on failed refresh and never refreshes a logged-out or API-key entry", async () => {
		const store = AuthStorage.inMemory({ anthropic: credential });
		await assert.rejects(recoverCredential(store, ACCESS, new AbortController().signal, async () => new Response("no", { status: 400 })), /authentication failed/);
		assert.deepEqual(await store.read("anthropic"), credential);
        await store.modify("anthropic", async () => ({ type: "api_key", key: "fake-key" }));
        let apiKeyFetched = false;
        await assert.rejects(recoverCredential(store, ACCESS, new AbortController().signal, async () => { apiKeyFetched = true; return refreshed(); }), /authentication failed/);
        assert.equal(apiKeyFetched, false);
        assert.deepEqual(await store.read("anthropic"), { type: "api_key", key: "fake-key" });
		await store.delete("anthropic");
		await assert.rejects(recoverCredential(store, ACCESS, new AbortController().signal, async () => { throw new Error("must not fetch"); }), /authentication failed/);
	});
	it("cancels the caller but persists an already-started refresh", async () => {
		const store = AuthStorage.inMemory({ anthropic: credential });
		const started = Promise.withResolvers<void>();
		const finish = Promise.withResolvers<void>();
		const controller = new AbortController();
		const pending = recoverCredential(store, ACCESS, controller.signal, async () => { started.resolve(); await finish.promise; return refreshed(); });
		await started.promise;
		controller.abort();
		await assert.rejects(pending, /abort/i);
		finish.resolve();
		// A serialized mutation is a barrier behind the refresh and its persistence.
		await store.modify("anthropic", async () => undefined);
		assert.ok((await store.read("anthropic") as OAuthCredential).access !== ACCESS);
	});
    it("abort while waiting for the lock never starts refresh", async () => {
        const store = AuthStorage.inMemory({ anthropic: credential });
        const locked = Promise.withResolvers<void>();
        const unlock = Promise.withResolvers<void>();
        const holding = store.modify("anthropic", async () => { locked.resolve(); await unlock.promise; return undefined; });
        await locked.promise;
        const controller = new AbortController();
        let fetched = false;
        const operation = recoverCredential(store, ACCESS, controller.signal, async () => { fetched = true; return refreshed(); });
        controller.abort();
        await assert.rejects(operation, /abort/i);
        unlock.resolve(); await holding;
        await store.modify("anthropic", async () => undefined);
        assert.equal(fetched, false);
    });
	it("an already-aborted caller never touches credentials or fetch", async () => {
		const controller = new AbortController(); controller.abort();
		const store = AuthStorage.inMemory({ anthropic: credential });
		await assert.rejects(recoverCredential(store, ACCESS, controller.signal, async () => { throw new Error("must not fetch"); }), /abort/i);
		assert.deepEqual(await store.read("anthropic"), credential);
	});
});

describe("faux provider contracts", () => {
    it("keeps API keys unchanged and routes API-shaped options without reinterpreting thinking", () => {
        const model = builtinProviders().find(p => p.id === "anthropic")!.getModels()[0];
        const context = { messages: [] };
        const stream = createAssistantMessageEventStream();
        const calls: { simple: boolean; options: unknown }[] = [];
        const faux: Provider = {
            id: "anthropic", name: "Faux Anthropic", auth: {}, getModels: () => [model],
            stream(_model, _context, options) { calls.push({ simple: false, options }); return stream; },
            streamSimple(_model, _context, options) { calls.push({ simple: true, options }); return stream; },
        };
        const overlay = createOverlay(faux, () => undefined, "device");
        const apiKeyOptions = { apiKey: "fake-api-key", reasoning: "low" as const };
        assert.equal(overlay.streamSimple(model, context, apiKeyOptions), stream);
        assert.equal(calls[0].options, apiKeyOptions);
        assert.equal(calls[0].simple, true);
        overlay.streamSimple(model, context, { apiKey: ACCESS, reasoning: "low" });
        assert.equal(calls[1].simple, true);
        const apiOptions = { apiKey: ACCESS, thinkingEnabled: true, effort: "high" };
        overlay.streamSimple(model, context, apiOptions);
        assert.equal(calls[2].simple, false);
    });
});

describe("bounded transport recovery", () => {
	it("refreshes one rejected bearer and replays before delivering the response", async () => {
		const store = AuthStorage.inMemory({ anthropic: credential });
		let inference = 0; let refreshes = 0;
		const transport: typeof fetch = async (input, init) => {
			if (String(input) === TOKEN_URL) { refreshes++; return refreshed(); }
			inference++;
			const headers = new Headers(init?.headers);
			assert.equal(headers.get("user-agent"), "claude-cli/2.1.280 (external, cli)");
			assert.ok(headers.get("authorization") === `Bearer ${inference === 1 ? ACCESS : NEXT}`);
			assert.ok(String(init?.body).includes("cc_entrypoint=cli;"));
			return inference === 1 ? new Response("expired", { status: 401 }) : new Response("ok");
		};
		const result = await subscriptionFetch(transport, store, versionState(), "session", "device")(url, request());
		assert.equal(await result.text(), "ok");
		assert.equal(inference, 2); assert.equal(refreshes, 1);
	});
	it("stops at a second 401, permission 403, and quota 429", async () => {
		for (const status of [401, 403, 429]) {
			const store = AuthStorage.inMemory({ anthropic: credential });
			let inference = 0; let refreshes = 0;
			const transport: typeof fetch = async input => {
				if (String(input) === TOKEN_URL) { refreshes++; return refreshed(); }
				inference++; return new Response("denied", { status });
			};
			const operation = subscriptionFetch(transport, store, versionState(), "s", "d")(url, request());
			if (status === 429) assert.equal((await operation).status, 429);
			else await assert.rejects(operation, status === 401 ? /\/login anthropic/ : /permissions and quota/);
			assert.equal(inference, status === 401 ? 2 : 1);
			assert.equal(refreshes, status === 401 ? 1 : 0);
		}
	});
	it("re-signs once for an explicit version rejection and handles Request inputs", async () => {
		let calls = 0;
		const version = versionState();
		const transport: typeof fetch = async (_input, init) => {
			calls++;
			if (calls === 1) return new Response("claude_code_version_too_old: version 2.2.0 or newer is required", { status: 400 });
			assert.ok(String(init?.body).includes("cc_version=2.2.0."));
			return new Response("ok");
		};
		await subscriptionFetch(transport, undefined, version, "s", "d")(new Request(url, request()));
		assert.equal(calls, 2);
	});
    it("aborts in-flight inference without refresh/replay", async () => {
        const started = Promise.withResolvers<void>();
        const controller = new AbortController();
        let calls = 0;
        const transport: typeof fetch = async (_input, init) => {
            calls++;
            const stopped = Promise.withResolvers<Response>();
            init?.signal?.addEventListener("abort", () => stopped.reject(new DOMException("Aborted", "AbortError")), { once: true });
            started.resolve();
            return stopped.promise;
        };
        const operation = subscriptionFetch(transport, undefined, versionState(), "s", "d")(url, request(controller.signal));
        await started.promise; controller.abort();
        await assert.rejects(operation, /abort/i);
        assert.equal(calls, 1);
    });
	it("never sends OAuth to a proxy origin or follows redirects", async () => {
		let calls = 0;
		const transport: typeof fetch = async (_input, init) => { calls++; assert.equal(init?.redirect, "error"); return new Response("", { status: 307 }); };
		const wrapped = subscriptionFetch(transport, undefined, versionState(), "s", "d");
		await assert.rejects(wrapped("https://example.com/v1/messages", request()), /only be sent/);
		assert.equal(calls, 0);
		assert.equal((await wrapped(url, request())).status, 307);
		assert.equal(calls, 1);
	});
});

// The package exports hide the CLI bundle. Deliberately exercise its independent class/loader boundary.
describe("compatibility guards", () => {
    it("checks every hook before mutating either class", () => {
        class RuntimeStub { getProviders() { return []; } }
        class SessionStub {}
        const before = Object.getOwnPropertyDescriptors(RuntimeStub.prototype);
        // Deliberately incomplete stand-ins test the guarded private integration boundary.
        assert.throws(() => installVisibility(RuntimeStub as unknown as typeof pi.ModelRuntime,
            SessionStub as unknown as typeof pi.AgentSession), /Nothing was patched/);
        assert.deepEqual(Object.getOwnPropertyDescriptors(RuntimeStub.prototype), before);
    });
});

for (const [label, entry] of entries) describe(`real Pi integration: ${label}`, () => {
	it("loads the isolated extension; filters login, all and scoped picker inputs; reload without it restores defaults", async () => {
		const dir = await mkdtemp(join(root, "session-"));
		const store = AuthStorage.inMemory({ anthropic: credential, openrouter: { type: "api_key", key: "fake-other" }, "openai-codex": { ...credential } });
		const runtime = await entry.ModelRuntime.create({ credentials: store, modelsPath: null, refreshOnCreate: false });
		await runtime.refresh({ allowNetwork: false });
		const other = runtime.getModels("openrouter")[0];
		const anthropic = runtime.getModels("anthropic")[0];
		assert.ok(other && anthropic);
		let enabled = true;
		const extensionPath = fileURLToPath(new URL("../index.ts", import.meta.url));
		const loader = new entry.DefaultResourceLoader({ cwd: dir, agentDir: root, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
			extensionPathsOverride: [], additionalExtensionPaths: [extensionPath] });
		await loader.reload();
		assert.deepEqual(loader.getExtensions().errors, []);
		const originalReload = loader.reload.bind(loader);
		loader.reload = async () => { if (enabled) await originalReload(); else loader.getExtensions().extensions.length = 0; };
		const { session } = await entry.createAgentSession({ cwd: dir, agentDir: root, modelRuntime: runtime, model: anthropic,
			scopedModels: [{ model: other }, { model: anthropic }], resourceLoader: loader,
			sessionManager: entry.SessionManager.inMemory(dir), settingsManager: entry.SettingsManager.inMemory({ retry: { enabled: false } }) });
		await session.bindExtensions({});
		try {
			const login = entry.InteractiveMode.prototype as unknown as { getLoginProviderOptions(this: { session: typeof session }): { id: string }[] };
			assert.deepEqual([...new Set(login.getLoginProviderOptions.call({ session }).map(p => p.id))].sort(), ["anthropic", "openai-codex"]);
			assert.ok(runtime.getAvailableSnapshot().every(m => ["anthropic", "openai-codex"].includes(m.provider)));
			assert.ok(runtime.getModels().every(m => ["anthropic", "openai-codex"].includes(m.provider)));
			assert.equal(session.scopedModels.length, 1);
            const captures: string[] = [];
            const transport: typeof fetch = async (_input, init) => {
                captures.push(String(init?.body));
                return Response.json({ type: "error", error: { type: "invalid_request_error", message: "fixture" } }, { status: 400 });
            };
            const context = { systemPrompt: "Keep system role", messages: [{ role: "user" as const, content: [{ type: "text" as const, text: "fake prompt" }] }] };
            await runtime.completeSimple(anthropic, context, { fetch: transport, maxRetries: 0, apiKey: "fake-api-key" });
            await runtime.completeSimple(anthropic, context, { fetch: transport, maxRetries: 0 });
            assert.equal(captures.length, 2);
            assert.ok(!captures[0].includes("x-anthropic-billing-header"));
            assert.ok(captures[1].includes("cc_entrypoint=cli;"));
            assert.equal(JSON.parse(captures[1]).system[2].text, "Keep system role");

            // Real Pi login orchestration, but only a copy-code fixture and mocked token exchange.
            const network = globalThis.fetch;
            let state = "";
            let exchanges = 0;
            globalThis.fetch = async (input, init) => {
                exchanges++;
                assert.equal(String(input), "https://platform.claude.com/v1/oauth/token");
                const body = JSON.parse(String(init?.body));
                assert.equal(body.grant_type, "authorization_code");
                assert.equal(body.state, state);
                return refreshed();
            };
            const interaction = {
                notify(event: { type: string; url?: string }) {
                    if (event.type === "auth_url") {
                        const authorize = new URL(event.url!);
                        assert.equal(authorize.origin, "https://claude.ai");
                        assert.equal(authorize.searchParams.get("code_challenge_method"), "S256");
                        assert.ok(authorize.searchParams.get("scope")?.includes("user:inference"));
                        state = authorize.searchParams.get("state")!;
                    }
                },
                async prompt(prompt: { type: string }) { return prompt.type === "select" ? "copy_code" : `fake-code#${state}`; },
            };
            try {
                await runtime.login("anthropic", "oauth", interaction);
                assert.equal(exchanges, 1);
                const loggedIn = await store.read("anthropic");
                assert.ok(loggedIn?.type === "oauth" && loggedIn.access !== ACCESS);
                globalThis.fetch = async () => Response.json({});
                await assert.rejects(runtime.login("anthropic", "oauth", interaction), /login failed/);
                assert.deepEqual(await store.read("anthropic"), loggedIn);
                // Proactive refresh uses our handler inside Pi's existing storage lock.
                await store.modify("anthropic", async current => ({ ...current as OAuthCredential, expires: 1 }));
                let proactive = 0;
                globalThis.fetch = async input => { assert.equal(String(input), TOKEN_URL); proactive++; return refreshed(); };
                await runtime.getAuth("anthropic");
                assert.equal(proactive, 1);
            } finally {
                globalThis.fetch = network;
                await store.modify("anthropic", async () => credential);
            }
			assert.deepEqual(await store.read("openrouter"), { type: "api_key", key: "fake-other" });
			await session.reload();
			assert.equal(session.scopedModels.length, 1);
            assert.equal(runtime.getProviders().length, 2);
            let afterReload = 0;
            let reloadRefresh = 0;
            const recoverAfterReload: typeof fetch = async input => {
                if (String(input) === TOKEN_URL) { reloadRefresh++; return refreshed(); }
                afterReload++;
                return new Response("fixture", { status: afterReload === 1 ? 401 : 400 });
            };
            await runtime.completeSimple(anthropic, context, { fetch: recoverAfterReload, maxRetries: 0 });
            assert.equal(afterReload, 2, "SDK reload binds recovery even without session_start");
            assert.equal(reloadRefresh, 1);
            await store.modify("anthropic", async () => credential);
            enabled = false;
			await session.reload();
			assert.ok(runtime.getProviders().length > 2);
			assert.ok(runtime.getAvailableSnapshot().some(m => m.provider === "openrouter"));
			assert.equal(session.scopedModels.length, 2);
			assert.equal(runtime.getRegisteredProviderConfig("anthropic"), undefined);
			assert.deepEqual(await store.read("anthropic"), credential);
		} finally { session.dispose(); }
	});
	it("conflicting Anthropic overlays are rejected in either registration order; shim restores exact methods", async () => {
		const original = entry.ModelRuntime.prototype.getProviders;
		const release = installVisibility(entry.ModelRuntime, entry.AgentSession);
		const secondRelease = installVisibility(entry.ModelRuntime, entry.AgentSession);
		try {
			for (const ownFirst of [true, false]) {
				const runtime = await entry.ModelRuntime.create({ credentials: AuthStorage.inMemory(), modelsPath: null, refreshOnCreate: false });
				const marked = Object.assign(() => { throw new Error("unused faux provider"); }, { [OVERLAY]: true });
				const ours = { api: "anthropic-messages", streamSimple: marked };
				const other = { api: "anthropic-messages", streamSimple: () => { throw new Error("unused faux provider"); } };
				runtime.registerProvider("anthropic", ownFirst ? ours : other);
				assert.throws(() => runtime.registerProvider("anthropic", ownFirst ? other : ours), /another Anthropic extension/);
			}
            const missingBridge = await entry.ModelRuntime.create({ credentials: AuthStorage.inMemory(), modelsPath: null, refreshOnCreate: false });
            Reflect.deleteProperty(missingBridge, "credentials");
            const needsStore = Object.assign(() => { throw new Error("unused"); }, { [OVERLAY]: true, [BIND_STORE]: () => {} });
            assert.throws(() => missingBridge.registerProvider("anthropic", { api: "anthropic-messages", streamSimple: needsStore }), /credential bridge is unavailable/);
            assert.equal(missingBridge.getRegisteredProviderConfig("anthropic"), undefined);
            assert.ok(missingBridge.getProviders().length > 2);
            release();
            assert.notEqual(entry.ModelRuntime.prototype.getProviders, original);
		} finally { release(); secondRelease(); }
		assert.equal(entry.ModelRuntime.prototype.getProviders, original);
	});
});
