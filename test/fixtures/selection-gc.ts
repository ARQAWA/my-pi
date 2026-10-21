// Run with --expose-gc: weak bootstrap cleanup is observed on the next native bind, never promised at rejection.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { fauxProvider } from "@earendil-works/pi-ai";
import * as library from "@earendil-works/pi-coding-agent";

const root = await mkdtemp(join(tmpdir(), "rqw-selection-gc-"));
const SETTINGS = fileURLToPath(new URL("../../extensions/RQW-settings/index.ts", import.meta.url));
const TOOLS = fileURLToPath(new URL("../../extensions/RQW-tools/index.ts", import.meta.url));
const HOOK = Symbol.for("rqw/tool-selection-intent/1.3.0");
const FOUR = ["bash", "edit", "read", "write"];
const SIX = [...FOUR, "find", "grep"].sort();
const bundle = await import(new URL("./bundle/index.js", import.meta.resolve("@earendil-works/pi-coding-agent")).href) as typeof library;
const gc = (globalThis as unknown as { gc: () => void }).gc;
assert.equal(typeof gc, "function");
globalThis.fetch = async () => { throw new Error("Unexpected network request in selection regression"); };
let serial = 0;

try {
	for (const [name, sdk] of [["library", library], ["bundle", bundle]] as const) {
		const agentDir = join(root, name);
		await mkdir(agentDir);
		const runtime = await sdk.ModelRuntime.create({ authPath: join(agentDir, "fake-auth.json"), modelsPath: null, refreshOnCreate: false });
		const faux = fauxProvider();
		runtime.registerNativeProvider(faux.provider);

		async function prepare(paths: string[], tools?: string[], ownLoader = false, selectModel = true) {
			const cwd = join(root, `s${serial++}`);
			await mkdir(cwd);
			const settingsManager = sdk.SettingsManager.inMemory({ extensions: paths, compaction: { enabled: false }, retry: { enabled: false } });
			let resourceLoader: library.DefaultResourceLoader | undefined;
			if (ownLoader) {
				resourceLoader = new sdk.DefaultResourceLoader({ cwd, agentDir, settingsManager, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
				await resourceLoader.reload();
				assert.deepEqual(resourceLoader.getExtensions().errors, []);
			}
			return () => sdk.createAgentSession({
				cwd, agentDir, settingsManager, resourceLoader, tools,
				modelRuntime: runtime, model: selectModel ? faux.getModel() : undefined, sessionManager: sdk.SessionManager.inMemory(cwd),
			});
		}
		async function create(paths: string[], tools?: string[], ownLoader = false, selectModel = true) {
			return (await prepare(paths, tools, ownLoader, selectModel))();
		}
		async function bind(session: library.AgentSession) {
			const errors: string[] = [];
			await session.bindExtensions({ onError: (error) => errors.push(error.error) });
			assert.deepEqual(errors, []);
		}
		async function close(session: library.AgentSession) {
			try { await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" }); }
			finally { session.dispose(); }
		}

		for (const paths of [[SETTINGS, TOOLS], [TOOLS, SETTINGS]]) {
			const descriptor = Object.getOwnPropertyDescriptor(sdk.AgentSession.prototype, "bindExtensions");
			async function exercise() {
				for (const ownLoader of [false, true]) {
					for (const selectModel of [false, true]) {
						await assert.rejects(create(paths, ["read", "-grep"], ownLoader, selectModel), /Invalid tools option/);
					}
				}
				const state = (sdk.AgentSession.prototype as unknown as { [HOOK]: { registrations: Set<WeakRef<object>> } })[HOOK];
				assert.ok(state.registrations.size >= 2);
				assert.ok([...state.registrations].every((reference) => reference instanceof WeakRef));
				assert.equal(Object.hasOwn(state, "count"), false, "failed factories cannot create counted lifecycle leases");

				// Two factories loaded, with no AgentSession yet; both must still capture after B closes.
				const pendingA = await prepare(paths, undefined, true);
				const pendingC = await prepare(paths, [], true);
				const b = await create(paths);
				await bind(b.session);
				assert.deepEqual(b.session.getActiveToolNames().sort(), SIX);
				await close(b.session);
				await new Promise<void>((resolve) => setImmediate(resolve));
				gc();
				const c = await pendingC();
				await bind(c.session);
				assert.deepEqual(c.session.getActiveToolNames(), []);
				await close(c.session);
				const a = await pendingA();
				await bind(a.session);
				assert.deepEqual(a.session.getActiveToolNames().sort(), SIX);
				a.session.setActiveToolsByName(FOUR);
				await a.session.reload();
				assert.deepEqual(a.session.getActiveToolNames().sort(), FOUR);
				await close(a.session);

				await assert.rejects(create(paths, ["read", "-grep"]), /Invalid tools option/);
				// A bootstrap left by failure is metadata-only even for a session with both modules off.
				const bootstrap = Object.getOwnPropertyDescriptor(sdk.AgentSession.prototype, "bindExtensions")!;
				let foreignCalls = 0;
				const foreign = function(this: object, ...args: unknown[]) {
					foreignCalls++;
					return bootstrap.value.apply(this, args);
				};
				Object.defineProperty(sdk.AgentSession.prototype, "bindExtensions", { ...bootstrap, value: foreign });
				const native = await create([]);
				const fields = ["sessionManager", "_usesDefaultTools", "_defaultToolModifiers", "_excludedTools", "_allowedTools"];
				const before = fields.map((field) => Object.getOwnPropertyDescriptor(native.session, field));
				await bind(native.session);
				assert.deepEqual(native.session.getActiveToolNames().sort(), FOUR);
				assert.deepEqual(fields.map((field) => Object.getOwnPropertyDescriptor(native.session, field)), before);
				await close(native.session);
				assert.equal(foreignCalls, 1);
				assert.equal(sdk.AgentSession.prototype.bindExtensions, foreign, "foreign hook is never clobbered");
				Object.defineProperty(sdk.AgentSession.prototype, "bindExtensions", bootstrap);
			}
			await exercise();
			// SDK 1.3.0 has no pre-constructor failure event. Collection is not synchronous with its rejection.
			// Once orphan factories are collected, the next bind prunes weak registrations and restores native.
			await new Promise<void>((resolve) => setImmediate(resolve));
			gc();
			await new Promise<void>((resolve) => setImmediate(resolve));
			const native = await create([]);
			try {
				await bind(native.session);
				assert.deepEqual(Object.getOwnPropertyDescriptor(sdk.AgentSession.prototype, "bindExtensions"), descriptor);
			} finally { await close(native.session); }
			console.log(`${name} ${paths[0] === SETTINGS ? "settings-first" : "tools-first"}: failure, pending binds, shutdown, reload, off, weak cleanup PASS`);
		}
	}
} finally { await rm(root, { recursive: true, force: true }); }
