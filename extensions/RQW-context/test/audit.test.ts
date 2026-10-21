// Regression coverage for audit findings 5 and 6. Real library and CLI bundle sessions, fake auth, no model calls.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createProvider } from "@earendil-works/pi-ai";
import * as library from "@earendil-works/pi-coding-agent";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { capModel } from "../index.ts";

// Pi's exports map hides the CLI bundle; resolve it next to the installed library entry.
const bundle: typeof library = await import(new URL("./bundle/index.js", import.meta.resolve("@earendil-works/pi-coding-agent")).href);
const ENTRIES: [string, typeof library][] = [["library", library], ["bundle", bundle]];
const EXTENSION = join(dirname(fileURLToPath(import.meta.url)), "..", "index.ts");
const NO_RESOURCES = { noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true };
const STOCK = { window: 1_000_000, reserve: 16_384 };
const CAPPED = { window: 500_000, reserve: 50_000 };
let root: string;
let next = 0;

before(async () => { root = await mkdtemp(join(tmpdir(), "rqw-context-audit-")); });
after(async () => { await rm(root, { recursive: true, force: true }); });

async function open(pi: typeof library, owner = false) {
	const cwd = join(root, String(next++));
	const agentDir = join(cwd, "agent");
	await mkdir(agentDir, { recursive: true });
	const select = (on: boolean) => writeFile(join(agentDir, "settings.json"), JSON.stringify({
		extensions: on ? [EXTENSION] : [],
	}));
	await select(owner);
	const runtime = await pi.ModelRuntime.create({
		authPath: join(agentDir, "auth.json"), modelsPath: null, refreshOnCreate: false,
	});
	const unexpectedRequest = () => { throw new Error("Audit lifecycle tests must not call a model"); };
	runtime.registerNativeProvider(createProvider({
		id: "context-audit",
		auth: { apiKey: { name: "Fake", resolve: async () => ({ auth: {} }) } },
		models: [{
			id: "big", name: "big", api: "context-audit", provider: "context-audit",
			baseUrl: "http://127.0.0.1:0", reasoning: false, input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 1_000_000, maxTokens: 128_000,
		}],
		api: { stream: unexpectedRequest, streamSimple: unexpectedRequest },
	} as Parameters<typeof createProvider>[0]));
	await runtime.refresh({ allowNetwork: false });
	const declared = runtime.getModel("context-audit", "big")!;
	Object.freeze(declared);
	const resourceLoader = new pi.DefaultResourceLoader({ cwd, agentDir, ...NO_RESOURCES });
	await resourceLoader.reload();
	assert.deepEqual(resourceLoader.getExtensions().errors, []);
	const { session } = await pi.createAgentSession({
		cwd, agentDir, model: declared, thinkingLevel: "off", modelRuntime: runtime, resourceLoader,
		sessionManager: pi.SessionManager.inMemory(cwd),
		settingsManager: pi.SettingsManager.inMemory({ retry: { enabled: false } }),
	});
	await session.bindExtensions({});
	return { session, declared, runtime, select };
}

async function shutdown(session: AgentSession) {
	try {
		await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
	} finally {
		session.dispose();
	}
}

function values(session: AgentSession) {
	const model = session.model!;
	return { window: model.contextWindow, reserve: session.settingsManager.getCompactionSettings(model).reserveTokens };
}

for (const [entry, pi] of ENTRIES) {
	describe(`${entry}: context audit regressions`, () => {
		it("a missing model getter fails before any hooks or owner are installed", async () => {
			const proto = pi.AgentSession.prototype;
			const descriptor = Object.getOwnPropertyDescriptor(proto, "model")!;
			const buildRuntime = (proto as unknown as Record<string, unknown>)._buildRuntime;
			const compaction = pi.SettingsManager.prototype.getCompactionSettings;
			const cwd = join(root, String(next++));
			await mkdir(cwd);
			const loader = new pi.DefaultResourceLoader({
				cwd, agentDir: cwd, additionalExtensionPaths: [EXTENSION], ...NO_RESOURCES,
			});
			Reflect.deleteProperty(proto, "model");
			try {
				await loader.reload();
				const errors = loader.getExtensions().errors;
				assert.equal(errors.length, 1);
				assert.match(errors[0].error, /AgentSession\.model getter not found; .*nothing is changed/);
				assert.equal((proto as unknown as Record<string, unknown>)._buildRuntime, buildRuntime);
				assert.equal(pi.SettingsManager.prototype.getCompactionSettings, compaction);
				assert.equal((globalThis as Record<symbol, Set<object>>)[Symbol.for("rqw-context/owner")]?.size ?? 0, 0);
			} finally {
				Object.defineProperty(proto, "model", descriptor);
			}
		});

		it("observers before the first owner, after it, and during off all follow on/off/re-enable without reload", async () => {
			// This session predates even the first installation of the class hooks in this entrypoint.
			const before = await open(pi);
			const sessions = [before.session];
			try {
				assert.deepEqual(values(before.session), STOCK);
				assert.equal(before.session.model, before.declared);
				assert.equal(Object.getOwnPropertyDescriptor(before.session.agent.state, "model")?.get, undefined);
				const owner = await open(pi, true);
				sessions.push(owner.session);
				assert.deepEqual(values(before.session), CAPPED, "a public SDK model read must cap the old state immediately");
				const beforeCopy = before.session.model;
				assert.equal(before.session.agent.state.model, beforeCopy);
				assert.equal(before.declared.contextWindow, 1_000_000);
				assert.equal(before.runtime.getModel("context-audit", "big"), before.declared);
				const after = await open(pi);
				sessions.push(after.session);
				// New runtime installation must work without first reading the public model getter.
				assert.equal(after.session.agent.state.model.contextWindow, 500_000);
				assert.deepEqual(values(after.session), CAPPED);
				assert.deepEqual(values(owner.session), CAPPED);

				await owner.select(false);
				await owner.session.reload();
				for (const session of sessions) assert.deepEqual(values(session), STOCK);
				assert.equal(before.session.model, before.declared);
				assert.equal(after.session.model, after.declared);
				const gap = await open(pi);
				sessions.push(gap.session);
				assert.deepEqual(values(gap.session), STOCK);

				await owner.select(true);
				await owner.session.reload();
				for (const session of sessions) assert.deepEqual(values(session), CAPPED);
				assert.equal(before.session.model, beforeCopy, "the same declared model keeps the same capped identity");
				assert.equal(gap.declared.contextWindow, 1_000_000);
				await shutdown(owner.session);
				for (const session of sessions) assert.deepEqual(values(session), STOCK);
				assert.equal(gap.session.model, gap.declared);
			} finally {
				for (const session of sessions) await shutdown(session);
			}
		});

		it("setModel(current) before the last shutdown preserves the declared object and capped identity", async () => {
			const owner = await open(pi, true);
			const observer = await open(pi);
			try {
				for (const { session } of [owner, observer]) {
					const capped = session.model!;
					for (let i = 0; i < 3; i++) {
						await session.setModel(session.model!);
						assert.equal(session.model, capped);
						assert.deepEqual(values(session), CAPPED);
					}
				}
				await owner.session.reload();
				await owner.session.setModel(owner.session.model!);
				await shutdown(owner.session);
				for (const { session, declared } of [owner, observer]) {
					assert.deepEqual(values(session), STOCK);
					assert.equal(session.model, declared);
				}
			} finally {
				await shutdown(owner.session);
				await shutdown(observer.session);
			}
		});

		it("setModel(current) survives off/reload, stale-copy assignment while off, and re-enable", async () => {
			const owner = await open(pi, true);
			try {
				const capped = owner.session.model!;
				await owner.session.setModel(capped);
				await owner.select(false);
				await owner.session.reload();
				assert.deepEqual(values(owner.session), STOCK);
				assert.equal(owner.session.model, owner.declared);
				await owner.session.setModel(capped);
				assert.equal(owner.session.model, owner.declared, "a retained capped copy is not a new declaration");
				await owner.select(true);
				await owner.session.reload();
				assert.deepEqual(values(owner.session), CAPPED);
				assert.equal(owner.session.model, capped);
				await owner.session.setModel(owner.session.model!);
				await owner.select(false);
				await owner.session.reload();
				assert.deepEqual(values(owner.session), STOCK);
				assert.equal(owner.session.model, owner.declared);
				// Only our exact capped copies unwrap; an independently declared 500k model stays 500k.
				const independent = { ...owner.declared, contextWindow: 500_000 };
				await owner.session.setModel(independent);
				assert.equal(owner.session.model, independent);
				assert.equal(owner.declared.contextWindow, 1_000_000);
			} finally {
				await shutdown(owner.session);
			}
		});

		it("copies from a separate extension module instance unwrap by identity, not provider/id", async () => {
			const owner = await open(pi, true);
			const observer = await open(pi);
			try {
				// Native import and Pi's reloaded extension factory are separate module instances.
				const capped = capModel(owner.declared);
				assert.equal(owner.session.model, capped);
				await observer.session.setModel(capped);
				assert.equal(observer.session.model, capped);
				await shutdown(owner.session);
				assert.equal(observer.session.model, owner.declared);
				assert.notEqual(observer.session.model, observer.declared);
				assert.equal(observer.runtime.getModel("context-audit", "big"), observer.declared);
				assert.deepEqual(values(observer.session), STOCK);
			} finally {
				await shutdown(owner.session);
				await shutdown(observer.session);
			}
		});
	});
}
