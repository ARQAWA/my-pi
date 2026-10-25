// RQW-providers alone, in real Pi sessions (library and CLI bundle). Fake credentials only, no provider requests.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { after, before, describe, it } from "node:test";
import type { Api, Model } from "@earendil-works/pi-ai";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import * as pi from "@earendil-works/pi-coding-agent";
import { installVisibility } from "../../../extensions/RQW-providers/index.ts";

// Pi hides its credential store behind package exports; resolve the installed internal entrypoint.
const { AuthStorage } = await import(new URL("./core/auth-storage.js", import.meta.resolve("@earendil-works/pi-coding-agent")).href);
const extensionPath = fileURLToPath(new URL("../../../extensions/RQW-providers/index.ts", import.meta.url));
const KEPT = ["anthropic", "kimi-coding", "openai-codex"];
const base = builtinProviders().find(provider => provider.id === "anthropic")!;
const entries: [string, typeof pi][] = [["library", pi]];
try {
	entries.push(["CLI bundle", await import(new URL("./bundle/index.js", import.meta.resolve("@earendil-works/pi-coding-agent")).href)]);
} catch (error) {
	// Stock Pi's npm bundle fails before extension loading on its release runtime.
	if (process.versions.bun !== "1.3.14" || !(error instanceof TypeError) ||
		!error.message.includes("webidl.util.markAsUncloneable is not a function")) throw error;
	it("stock Pi CLI bundle import on Bun 1.3.14", { skip: error.message }, () => {});
}

const savedFetch = globalThis.fetch;
const savedAgentDir = process.env.PI_CODING_AGENT_DIR;
let root: string;
before(async () => {
	root = await mkdtemp(join(tmpdir(), "rqw-providers-"));
	process.env.PI_CODING_AGENT_DIR = root;
	globalThis.fetch = async () => { throw new Error("Unexpected external network request in offline test"); };
});
after(async () => {
	globalThis.fetch = savedFetch;
	if (savedAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = savedAgentDir;
	await rm(root, { recursive: true, force: true });
});

// Like Pi's modes, the session binds its extensions with an error listener.
const bindings = { onError: () => {} };
const RUNTIME_METHODS = ["getProviders", "getModels", "getAvailableSnapshot", "getAvailable"];
const descriptors = (entry: typeof pi) => [
	...RUNTIME_METHODS.map(name => Object.getOwnPropertyDescriptor(entry.ModelRuntime.prototype, name)),
	...["scopedModels", "dispose", "_bindExtensionCore"].map(name => Object.getOwnPropertyDescriptor(entry.AgentSession.prototype, name)),
];

// Pi's own methods, taken before any test loaded the extension: every restore check compares with these.
const NATIVE = new Map(entries.map(([, entry]) => [entry, descriptors(entry)]));

describe("compatibility guard", () => {
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

for (const [label, entry] of entries) describe(`real Pi: ${label}`, () => {
	const credential = { type: "api_key" as const, key: "fake-key" };
	async function setup(options: { extensions?: string[]; credentials?: Record<string, typeof credential>; runtime?: pi.ModelRuntime; models?: { other: Model<Api>; anthropic: Model<Api> } } = {}) {
		const dir = await mkdtemp(join(root, "session-"));
		const store = AuthStorage.inMemory(options.credentials ?? { anthropic: credential, openrouter: { ...credential, key: "fake-other" }, "openai-codex": credential });
		const runtime: pi.ModelRuntime = options.runtime ?? await entry.ModelRuntime.create({ credentials: store, modelsPath: null, refreshOnCreate: false });
		await runtime.refresh({ allowNetwork: false });
		// A live owner on a shared runtime already hides openrouter, so a second session reuses the first one's models.
		const other = options.models?.other ?? runtime.getModels("openrouter")[0];
		const anthropic = options.models?.anthropic ?? runtime.getModels("anthropic")[0];
		assert.ok(other && anthropic);
		const loader = new entry.DefaultResourceLoader({ cwd: dir, agentDir: root, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
			extensionPathsOverride: [], additionalExtensionPaths: options.extensions ?? [extensionPath] });
		await loader.reload();
		assert.deepEqual(loader.getExtensions().errors, []);
		const { session } = await entry.createAgentSession({ cwd: dir, agentDir: root, modelRuntime: runtime, model: anthropic,
			scopedModels: [{ model: other }, { model: anthropic }], resourceLoader: loader,
			sessionManager: entry.SessionManager.inMemory(dir), settingsManager: entry.SettingsManager.inMemory({ retry: { enabled: false } }) });
		return { session, runtime, store, loader, other, anthropic };
	}
	const login = (session: pi.AgentSession) => [...new Set((entry.InteractiveMode.prototype as unknown as {
		getLoginProviderOptions(this: { session: pi.AgentSession }): { id: string }[];
	}).getLoginProviderOptions.call({ session }).map(provider => provider.id))].sort();

	it("filters login, all, available and scoped picker inputs; credentials stay; reload without it restores defaults", async () => {
		const original = NATIVE.get(entry)!;
		const { session, runtime, store, loader } = await setup();
		let enabled = true;
		const originalReload = loader.reload.bind(loader);
		loader.reload = async () => { if (enabled) await originalReload(); else loader.getExtensions().extensions.length = 0; };
		await session.bindExtensions(bindings);
		try {
			assert.notDeepEqual(descriptors(entry), original);
			assert.deepEqual(runtime.getProviders().map(provider => provider.id).sort(), KEPT);
			assert.deepEqual(login(session), KEPT);
			for (const list of [runtime.getModels(), await runtime.getAvailable(), runtime.getAvailableSnapshot(), session.scopedModels.map(item => item.model)]) {
				assert.ok(list.length > 0);
				assert.ok(list.every(model => KEPT.includes(model.provider)));
			}
			assert.equal(session.scopedModels.length, 1);
			assert.deepEqual(await store.read("openrouter"), { ...credential, key: "fake-other" });
			await session.reload();
			assert.deepEqual(runtime.getProviders().map(provider => provider.id).sort(), KEPT, "a reload with the extension on keeps the policy");
			enabled = false;
			await session.reload();
			assert.ok(runtime.getProviders().length > 2);
			assert.ok(login(session).includes("openrouter"));
			assert.ok(runtime.getAvailableSnapshot().some(model => model.provider === "openrouter"));
			assert.equal(session.scopedModels.length, 2);
			assert.deepEqual(descriptors(entry), original, "no Pi descriptor is left behind");
			assert.deepEqual(await store.read("openrouter"), { ...credential, key: "fake-other" });
		} finally { session.dispose(); }
	});

	it("hides as soon as the session is bound to its runtime, before any event, and across an SDK reload without bindings", async () => {
		const { session, runtime } = await setup();
		try {
			// `pi --list-models` reads the lists at this point: no session_start has run.
			assert.deepEqual(runtime.getProviders().map(provider => provider.id).sort(), KEPT);
			assert.equal(session.scopedModels.length, 1);
			await session.bindExtensions({});
			await session.reload();
			assert.deepEqual(runtime.getProviders().map(provider => provider.id).sort(), KEPT);
		} finally { session.dispose(); }
	});

	it("works with no Anthropic extension loaded, and the other extensions of the package do not matter", async () => {
		const { session, runtime } = await setup();
		await session.bindExtensions(bindings);
		try {
			assert.equal(runtime.getRegisteredProviderConfig("anthropic"), undefined);
			assert.deepEqual(runtime.getProviders().map(provider => provider.id).sort(), KEPT);
		} finally { session.dispose(); }
	});

	it("keeps kimi-coding in login, model, available and scoped lists", async () => {
		const { session, runtime, other } = await setup({ credentials: {
			anthropic: credential, "kimi-coding": credential, openrouter: credential,
		} });
		try {
			await session.bindExtensions(bindings);
			const kimi = runtime.getModels("kimi-coding")[0];
			assert.ok(kimi);
			session.setScopedModels([{ model: kimi }, { model: other }]);
			assert.deepEqual(login(session), KEPT);
			for (const list of [runtime.getModels(), await runtime.getAvailable(), runtime.getAvailableSnapshot(), session.scopedModels.map(item => item.model)]) {
				assert.ok(list.some(model => model.provider === "kimi-coding"));
				assert.ok(list.every(model => KEPT.includes(model.provider)));
			}
			assert.deepEqual(session.scopedModels.map(item => item.model), [kimi]);
		} finally { session.dispose(); }
	});

	it("an unloaded extension hides nothing", async () => {
		const { session, runtime } = await setup({ extensions: [] });
		await session.bindExtensions(bindings);
		try {
			assert.ok(runtime.getProviders().length > 2);
			assert.equal(session.scopedModels.length, 2);
		} finally { session.dispose(); }
	});

	it("hides all Object.prototype aliases on every list and scoped/login path while preserving native fixtures", async () => {
		const aliases = ["constructor", "toString", "__proto__", "valueOf", "hasOwnProperty", "normal-hidden"];
		const { session, runtime, store } = await setup();
		await session.bindExtensions(bindings);
		try {
			const models = aliases.map(id => ({ ...base.getModels()[0], provider: id }));
			for (const model of models) {
				await store.modify(model.provider, async () => ({ type: "api_key", key: "FAKE-alias" }));
				runtime.registerNativeProvider({ ...base, id: model.provider, name: model.provider,
					auth: { apiKey: { name: "fake", resolve: async () => ({ auth: { apiKey: "FAKE-alias" }, source: "fake fixture" }) } },
					getModels: () => [model], getAllModels: () => [model] });
			}
			await runtime.refresh({ allowNetwork: false });
			session.setScopedModels([...models, session.model!].map(model => ({ model })));
			assert.deepEqual(runtime.getProviders().map(provider => provider.id).sort(), KEPT);
			for (const list of [runtime.getModels(), await runtime.getAvailable(), runtime.getAvailableSnapshot(), session.scopedModels.map(item => item.model)]) {
				assert.ok(list.length > 0);
				assert.ok(list.every(model => KEPT.includes(model.provider)));
			}
			assert.deepEqual(login(session), KEPT);
		} finally { session.dispose(); }
		// These are valid, authenticated native providers, not fixtures that disappear on their own.
		await runtime.refresh({ allowNetwork: false });
		for (const id of aliases) {
			assert.ok(runtime.getProviders().some(provider => provider.id === id));
			for (const list of [runtime.getModels(), await runtime.getAvailable(), runtime.getAvailableSnapshot()]) assert.ok(list.some(model => model.provider === id), id);
			assert.deepEqual(await store.read(id), { type: "api_key", key: "FAKE-alias" });
		}
		assert.equal(session.scopedModels.length, aliases.length + 1);
	});

	it("applies only to a runtime that has an owning session: loading alone and unrelated runtimes keep Pi's lists", async () => {
		const unrelated = await setup({ extensions: [] });
		const dir = await mkdtemp(join(root, "load-only-"));
		const runtime = await entry.ModelRuntime.create({ credentials: AuthStorage.inMemory({ anthropic: credential, openrouter: credential }), modelsPath: null, refreshOnCreate: false });
		const loader = new entry.DefaultResourceLoader({ cwd: dir, agentDir: root, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
			extensionPathsOverride: [], additionalExtensionPaths: [extensionPath] });
		await loader.reload();
		assert.deepEqual(loader.getExtensions().errors, []);
		const owner = await setup();
		try {
			assert.ok(runtime.getProviders().length > 2, "source loading alone hides nothing");
			assert.deepEqual(owner.runtime.getProviders().map(provider => provider.id).sort(), KEPT);
			assert.ok(unrelated.runtime.getProviders().length > 2);
			assert.equal(unrelated.session.scopedModels.length, 2);
		} finally {
			owner.session.dispose(); unrelated.session.dispose();
			// The loaded instance never got a session; shut it down by hand so it releases the Pi patch.
			for (const extension of loader.getExtensions().extensions) for (const handler of extension.handlers.get("session_shutdown") ?? []) await handler({ type: "session_shutdown", reason: "quit" }, undefined as never);
		}
	});

	it("disposing an unowned child session on the shared runtime keeps the policy; disposing the owner ends it", async () => {
		const original = NATIVE.get(entry)!;
		const { session, runtime, anthropic } = await setup();
		await session.bindExtensions(bindings);
		try {
			for (let i = 0; i < 2; i++) {
				const resourceLoader = new entry.DefaultResourceLoader({ cwd: root, agentDir: root, noExtensions: true,
					noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
				await resourceLoader.reload();
				const { session: child } = await entry.createAgentSession({ cwd: root, agentDir: root, modelRuntime: runtime, model: anthropic, resourceLoader,
					sessionManager: entry.SessionManager.inMemory(root), settingsManager: entry.SettingsManager.inMemory({ compaction: { enabled: false } }) });
				assert.equal(child.modelRuntime, runtime);
				child.dispose(); child.dispose();
				assert.deepEqual(runtime.getProviders().map(provider => provider.id).sort(), KEPT);
			}
		} finally { session.dispose(); session.dispose(); }
		// An SDK host may dispose without session_shutdown: the stale owner no longer hides anything.
		assert.ok(runtime.getProviders().length > 2);
		assert.ok((await runtime.getAvailable()).some(model => model.provider === "openrouter"));
		assert.deepEqual(descriptors(entry), original, "dispose alone releases the owner and restores Pi's methods");
		await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" }).catch(() => {});
		assert.deepEqual(descriptors(entry), original);
	});

	it("a later session is still covered after another extension restored Pi's own session methods (as RQW-anthropic's lifecycle does)", async () => {
		const original = NATIVE.get(entry)!;
		const nativeBind = original[original.length - 1]!, nativeDispose = original[original.length - 2]!;
		const first = await setup();
		await first.session.bindExtensions(bindings);
		const second = await setup({ extensions: [] });
		try {
			assert.deepEqual(first.runtime.getProviders().map(provider => provider.id).sort(), KEPT);
			// Another extension's last owner leaves and restores the native methods under our wrappers.
			Object.defineProperty(entry.AgentSession.prototype, "_bindExtensionCore", nativeBind);
			Object.defineProperty(entry.AgentSession.prototype, "dispose", nativeDispose);
			const later = await setup();
			try {
				await later.session.bindExtensions(bindings);
				assert.deepEqual(later.runtime.getProviders().map(provider => provider.id).sort(), KEPT, "the new session's runtime is hidden");
				assert.equal(later.session.scopedModels.length, 1);
				assert.deepEqual(first.runtime.getProviders().map(provider => provider.id).sort(), KEPT, "the first session is still owned");
				first.session.dispose();
				assert.deepEqual(later.runtime.getProviders().map(provider => provider.id).sort(), KEPT, "an owner's dispose keeps the others'");
			} finally { later.session.dispose(); }
		} finally { first.session.dispose(); second.session.dispose(); }
		assert.deepEqual(descriptors(entry), original);
	});

	it("two sessions on one runtime: each owner's shutdown, reload and dispose keep the other's policy; the last one restores Pi", async () => {
		const original = NATIVE.get(entry)!;
		for (const mode of ["dispose", "reload", "shutdown"]) {
			const a = await setup();
			const b = await setup({ runtime: a.runtime, models: a });
			try {
				await a.session.bindExtensions(bindings);
				await b.session.bindExtensions(bindings);
				if (mode === "reload") await a.session.reload();
				if (mode === "shutdown") {
					await a.session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
					await a.session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
				}
				a.session.dispose(); a.session.dispose();
				assert.deepEqual(a.runtime.getProviders().map(provider => provider.id).sort(), KEPT, mode);
				b.session.dispose();
				assert.ok(a.runtime.getProviders().length > 2, mode);
				await b.session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" }).catch(() => {});
			} finally { a.session.dispose(); b.session.dispose(); }
			assert.deepEqual(descriptors(entry), original, mode);
		}
	});
});

it("actual CLI: `--list-models` shows only the kept providers with the extension, all of them without it", {
	skip: entries.some(([label]) => label === "CLI bundle") ? false : "stock CLI bundle cannot import on Bun 1.3.14",
	timeout: 120_000,
}, async () => {
	const dir = await mkdtemp(join(root, "cli-"));
	await writeFile(join(dir, "offline.mjs"), "globalThis.fetch=async()=>{throw new Error('External network forbidden');};");
	await writeFile(join(dir, "auth.json"), JSON.stringify({ anthropic: { type: "api_key", key: "fake" }, openrouter: { type: "api_key", key: "fake-other" } }));
	await writeFile(join(dir, "settings.json"), JSON.stringify({ packages: [], extensions: [] }));
	const env = { ...process.env, HOME: dir, USERPROFILE: dir, PI_CODING_AGENT_DIR: dir, PI_OFFLINE: "1", PI_SKIP_VERSION_CHECK: "1", NO_COLOR: "1" };
	for (const key of Object.keys(env)) if (/(API_KEY|AUTH_TOKEN|OAUTH_TOKEN)$/.test(key)) delete env[key];
	const cli = fileURLToPath(new URL("./bundle/cli.js", import.meta.resolve("@earendil-works/pi-coding-agent")));
	const listed = (extensions: string[]) => new Promise<string[]>((resolve, reject) => {
		const child = spawn(process.execPath, ["--import", pathToFileURL(join(dir, "offline.mjs")).href, cli, "--no-skills", "--no-prompt-templates", "--no-themes",
			"--no-context-files", "--no-session", ...extensions.flatMap(path => ["-e", path]), "--list-models"], { cwd: dir, env, stdio: ["pipe", "pipe", "pipe"] });
		let out = "", err = "";
		// Real child-process watchdog only; success waits on close, never on elapsed time.
		const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("Offline CLI timed out")); }, 25_000);
		child.stdout.on("data", data => { out += data; });
		child.stderr.on("data", data => { err += data; });
		child.on("error", error => { clearTimeout(timer); reject(error); });
		child.on("close", code => {
			clearTimeout(timer);
			if (code !== 0) reject(new Error(`CLI exited ${code}: ${err}`));
			else resolve([...new Set(out.split("\n").slice(1).map(line => line.split(/\s+/)[0]).filter(Boolean))].sort());
		});
		child.stdin.end();
	});
	assert.deepEqual(await listed([extensionPath]), ["anthropic"]);
	const all = await listed([]);
	assert.ok(all.includes("anthropic") && all.includes("openrouter"));
});
