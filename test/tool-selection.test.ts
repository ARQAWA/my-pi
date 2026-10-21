// Native SDK reuse of one manager across fresh sessions, with both defaults extensions.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { fauxProvider } from "@earendil-works/pi-ai";
import * as library from "@earendil-works/pi-coding-agent";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SETTINGS = join(ROOT, "extensions/RQW-settings/index.ts");
const TOOLS = join(ROOT, "extensions/RQW-tools/index.ts");
const FOUR = ["bash", "edit", "read", "write"];
const SIX = [...FOUR, "find", "grep"].sort();
const EIGHT = [...SIX, "codemode", "tool_search"].sort();
const bundle = await import(new URL("./bundle/index.js", import.meta.resolve("@earendil-works/pi-coding-agent")).href) as typeof library;
type Options = { tools?: string[]; excludeTools?: string[]; noTools?: "builtin" | "all" };
let root: string;
let serial = 0;
before(async () => { root = await mkdtemp(join(tmpdir(), "rqw-fresh-selection-")); });
after(async () => { await rm(root, { recursive: true, force: true }); });

for (const [name, sdk] of [["library", library], ["bundle", bundle]] as const) {
	describe(`fresh selection: both extensions in native ${name}`, () => {
		let runtime: library.ModelRuntime;
		let agentDir: string;
		const faux = fauxProvider();
		before(async () => {
			agentDir = join(root, name);
			await mkdir(agentDir);
			runtime = await sdk.ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: null, refreshOnCreate: false });
			runtime.registerNativeProvider(faux.provider);
		});

		async function open(paths: string[], ownLoader: boolean, options: Options = {}, manager?: library.SessionManager) {
			const cwd = join(root, `s${serial++}`);
			await mkdir(cwd);
			const settingsManager = sdk.SettingsManager.inMemory({ extensions: paths, compaction: { enabled: false }, retry: { enabled: false } });
			let resourceLoader: library.DefaultResourceLoader | undefined;
			if (ownLoader) {
				resourceLoader = new sdk.DefaultResourceLoader({
					cwd, agentDir, settingsManager,
					extensionFactories: [
						{ name: "codemode", factory: sdk.createCodemodeExtension(), replaceable: true, builtin: true },
						{ name: "tool-search", factory: sdk.createToolSearchExtension(), replaceable: true, builtin: true },
					],
					noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
				});
				await resourceLoader.reload();
			}
			const argv = [...process.argv];
			const { session, extensionsResult } = await sdk.createAgentSession({
				cwd, agentDir, settingsManager, modelRuntime: runtime, model: faux.getModel(),
				sessionManager: manager ?? sdk.SessionManager.inMemory(cwd), resourceLoader, ...options,
			});
			assert.deepEqual(extensionsResult.errors, []);
			const errors: string[] = [];
			let closed = false;
			const close = async () => {
				if (closed) return;
				closed = true;
				try { await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" }); }
				finally { session.dispose(); }
			};
			try {
				await session.bindExtensions({ onError: (error) => errors.push(error.error) });
				assert.deepEqual(errors, []);
				assert.deepEqual(process.argv, argv);
			} catch (error) { await close(); throw error; }
			return { session, close, errors, names: () => session.getActiveToolNames().slice().sort() };
		}

		for (const ownLoader of [true, false]) {
			for (const paths of [[SETTINGS, TOOLS], [TOOLS, SETTINGS]]) {
				const order = paths[0] === SETTINGS ? "settings first" : "tools first";
				it(`${order}, ${ownLoader ? "supplied" : "SDK-owned"} loader: fresh session intent and manual-off reload`, async () => {
					const defaults = ownLoader ? EIGHT : SIX;
					const descriptor = Object.getOwnPropertyDescriptor(sdk.AgentSession.prototype, "bindExtensions");
					const manager = sdk.SessionManager.inMemory(root);
					for (const options of [{}, { noTools: "builtin" }, { excludeTools: [] }, {}, { tools: [] }, {}] satisfies Options[]) {
						const active = await open(paths, ownLoader, options, manager);
						try {
							const expected = options.noTools || options.tools ? [] : options.excludeTools ? FOUR : defaults;
							assert.deepEqual(active.names(), expected);
							await active.session.reload();
							assert.deepEqual(active.names(), expected, "ordinary reload keeps the active set");
							if (expected === defaults) {
								active.session.setActiveToolsByName(FOUR);
								await active.session.reload();
								assert.deepEqual(active.names(), FOUR, "manual off survives reload on the same session");
							}
							assert.deepEqual(active.errors, []);
						} finally { await active.close(); }
						assert.deepEqual(Object.getOwnPropertyDescriptor(sdk.AgentSession.prototype, "bindExtensions"), descriptor);
					}
					const native = await open([], ownLoader, {}, manager);
					try {
						assert.deepEqual(native.names(), FOUR, "disabled extensions preserve native behavior");
						assert.deepEqual(Object.getOwnPropertyDescriptor(sdk.AgentSession.prototype, "bindExtensions"), descriptor);
					} finally { await native.close(); }
				});
			}
		}
	});
}

// Separate GC-enabled process keeps collection deterministic and never changes the SDK or process argv.
it("failed factories leave only weak metadata, preserve delayed binds, and restore native after collection", async () => {
	const result = await promisify(execFile)(process.execPath, ["--expose-gc", join(ROOT, "test/fixtures/selection-gc.ts")], { timeout: 30000 });
	assert.equal(result.stdout.trim().split("\n").length, 4);
	assert.equal(result.stderr, "");
});
