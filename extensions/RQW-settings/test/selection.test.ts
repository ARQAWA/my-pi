// Native SDK selection intent: no prompt, argv substitution, or network access.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { fauxProvider } from "@earendil-works/pi-ai";
import * as library from "@earendil-works/pi-coding-agent";
import { installSelectionIntent, noToolSelection } from "../selection.ts";

const EXTENSION = join(dirname(fileURLToPath(import.meta.url)), "..", "index.ts");
const HOOK = Symbol.for("rqw/tool-selection-intent/1.3.0");
const FOUR = ["bash", "edit", "read", "write"];
const ADDED = ["codemode", "tool_search"];
const intentMap = (Session: { prototype: object }): WeakMap<object, boolean> => (Session.prototype as any)[HOOK].intents;

class NativeShape {
	sessionManager = {};
	_usesDefaultTools = true;
	_defaultToolModifiers: string[] = [];
	_excludedTools: undefined | (() => boolean);
	_allowedTools: undefined | (() => boolean);
	bindExtensions(...args: unknown[]) { return args; }
}

describe("selection hook: checked native fields and descriptor leases", () => {
	it("rejects unsupported versions and descriptors without changing the method", () => {
		const before = Object.getOwnPropertyDescriptor(NativeShape.prototype, "bindExtensions");
		assert.throws(() => installSelectionIntent(NativeShape, "1.4.0"), /requires Pi 1.3.0/);
		assert.deepEqual(Object.getOwnPropertyDescriptor(NativeShape.prototype, "bindExtensions"), before);
		for (const descriptor of [
			{ get: () => () => {}, configurable: true },
			{ value: () => {}, configurable: false, writable: true },
			{ value: () => {}, configurable: true, writable: false },
		]) {
			const prototype = Object.defineProperty({}, "bindExtensions", descriptor);
			const before = Object.getOwnPropertyDescriptor(prototype, "bindExtensions");
			assert.throws(() => installSelectionIntent({ prototype }), /descriptor/);
			assert.deepEqual(Object.getOwnPropertyDescriptor(prototype, "bindExtensions"), before);
			assert.equal(Object.getOwnPropertyDescriptor(prototype, HOOK), undefined);
		}
	});

	it("captures before the native method, distinguishes no-op intent, and never recaptures a manager", () => {
		class Session extends NativeShape {
			bindExtensions(...args: unknown[]) {
				assert.equal(intentMap(Session).has(this.sessionManager), true, "capture precedes native bind");
				return super.bindExtensions(...args);
			}
		}
		const release = installSelectionIntent(Session);
		try {
			for (const [fields, expected] of [
				[{}, false],
				[{ _defaultToolModifiers: ["-codemode", "-grep"] }, true],
				[{ _excludedTools: () => false }, true],
				[{ _usesDefaultTools: false }, true],
				[{ _usesDefaultTools: false, _allowedTools: () => false }, true],
			] as const) {
				const session = Object.assign(new Session(), fields);
				const arg = {};
				assert.deepEqual(session.bindExtensions(arg), [arg]);
				assert.equal(intentMap(Session).get(session.sessionManager), expected);
				session._usesDefaultTools = !session._usesDefaultTools;
				session._defaultToolModifiers = ["+read"];
				session.bindExtensions();
				assert.equal(intentMap(Session).get(session.sessionManager), expected, "first bind is immutable");
			}
		} finally { release(); }
	});

	it("rejects missing, accessor, and malformed fields before calling native bind", () => {
		let calls = 0;
		class Session extends NativeShape { bindExtensions() { calls++; return []; } }
		const release = installSelectionIntent(Session);
		try {
			for (const [field, value] of [
				["sessionManager", null], ["_usesDefaultTools", undefined],
				["_defaultToolModifiers", undefined], ["_defaultToolModifiers", [1]],
				["_excludedTools", []], ["_allowedTools", {}],
			] as const) {
				const session = new Session();
				Object.defineProperty(session, field, { value, configurable: true });
				assert.throws(() => session.bindExtensions(), new RegExp(field));
			}
			for (const descriptor of [undefined, { get: () => true, configurable: true }]) {
				const session = new Session();
				delete (session as any)._usesDefaultTools;
				if (descriptor) Object.defineProperty(session, "_usesDefaultTools", descriptor);
				assert.throws(() => session.bindExtensions(), /_usesDefaultTools/);
			}
			assert.equal(calls, 0);
		} finally { release(); }
	});

	it("restores the exact last-lease descriptor, is idempotent, and keeps only weak intent across lease gaps", () => {
		const descriptor = Object.getOwnPropertyDescriptor(NativeShape.prototype, "bindExtensions");
		const first = installSelectionIntent(NativeShape);
		const wrapped = NativeShape.prototype.bindExtensions;
		const second = installSelectionIntent(NativeShape);
		assert.equal(NativeShape.prototype.bindExtensions, wrapped);
		const session = new NativeShape();
		session.bindExtensions();
		const intents = intentMap(NativeShape);
		first(); first();
		assert.equal(NativeShape.prototype.bindExtensions, wrapped);
		second(); second();
		assert.deepEqual(Object.getOwnPropertyDescriptor(NativeShape.prototype, "bindExtensions"), descriptor);
		assert.ok(intents instanceof WeakMap);
		session._usesDefaultTools = false;
		const third = installSelectionIntent(NativeShape);
		try {
			session.bindExtensions();
			assert.equal(intentMap(NativeShape), intents);
			assert.equal(intents.get(session.sessionManager), false, "reload never reclassifies initial defaults");
		} finally { third(); }
		assert.deepEqual(Object.getOwnPropertyDescriptor(NativeShape.prototype, "bindExtensions"), descriptor);
	});

	it("does not clobber another lifecycle hook and unwraps a dormant lease restored later", () => {
		class Session extends NativeShape { bindExtensions(...args: unknown[]) { return args; } }
		const descriptor = Object.getOwnPropertyDescriptor(Session.prototype, "bindExtensions")!;
		const release = installSelectionIntent(Session);
		const dormant = Object.getOwnPropertyDescriptor(Session.prototype, "bindExtensions")!;
		const foreign = function(this: object, ...args: unknown[]) { return dormant.value.apply(this, args); };
		Object.defineProperty(Session.prototype, "bindExtensions", { ...descriptor, value: foreign });
		release();
		assert.equal(Session.prototype.bindExtensions, foreign, "foreign hook remains installed");
		assert.deepEqual(foreign.call({}, "native"), ["native"], "inactive wrapper never reads private fields");
		// The other hook now releases its saved descriptor, like Pi's authentication lifecycle hook.
		Object.defineProperty(Session.prototype, "bindExtensions", dormant);
		const again = installSelectionIntent(Session);
		try {
			const session = new Session();
			session.bindExtensions();
			assert.equal(intentMap(Session).get(session.sessionManager), false);
		} finally { again(); }
		assert.deepEqual(Object.getOwnPropertyDescriptor(Session.prototype, "bindExtensions"), descriptor);
	});

	it("does not silently apply defaults without a captured sessionManager", () => {
		assert.throws(() => noToolSelection({} as any, {}), /not captured before session_start/);
	});
});

const bundle = await import(new URL("./bundle/index.js", import.meta.resolve("@earendil-works/pi-coding-agent")).href) as typeof library;
let root: string;
let serial = 0;
before(async () => { root = await mkdtemp(join(tmpdir(), "rqw-selection-")); });
after(async () => { await rm(root, { recursive: true, force: true }); });

type Options = { tools?: string[]; excludeTools?: string[]; noTools?: "builtin" | "all" };
for (const [name, sdk] of [["library", library], ["bundle", bundle]] as const) {
	describe(`selection intent: native ${name} SDK`, () => {
		let runtime: library.ModelRuntime;
		const faux = fauxProvider();
		before(async () => {
			const agentDir = join(root, name);
			await mkdir(agentDir);
			runtime = await sdk.ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: null, refreshOnCreate: false });
			runtime.registerNativeProvider(faux.provider);
		});

		async function open(options: Options = {}, enabled = true, settings: Record<string, unknown> = {}, reason: library.SessionStartEvent["reason"] = "startup", manager?: library.SessionManager) {
			const dir = join(root, `s${serial++}`);
			await mkdir(dir);
			const paths = enabled ? [EXTENSION] : [];
			const loader = new sdk.DefaultResourceLoader({
				cwd: dir, agentDir: join(root, name), additionalExtensionPaths: paths,
				extensionFactories: [
					{ name: "codemode", factory: sdk.createCodemodeExtension(), replaceable: true, builtin: true },
					{ name: "tool-search", factory: sdk.createToolSearchExtension(), replaceable: true, builtin: true },
				],
				noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
			});
			await loader.reload();
			assert.deepEqual(loader.getExtensions().errors, []);
			const { session } = await sdk.createAgentSession({
				cwd: dir, agentDir: join(root, name), modelRuntime: runtime, model: faux.getModel(), resourceLoader: loader,
				sessionManager: manager ?? sdk.SessionManager.inMemory(dir),
				settingsManager: sdk.SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false }, ...settings }),
				sessionStartEvent: { type: "session_start", reason }, ...options,
			});
			const errors: string[] = [];
			let closed = false;
			const close = async () => {
				if (closed) return;
				closed = true;
				try { await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" }); }
				finally { session.dispose(); }
			};
			try { await session.bindExtensions({ onError: (error) => errors.push(error.error) }); }
			catch (error) { await close(); throw error; }
			assert.deepEqual(errors, []);
			return { session, paths, errors, close, extensionsResult: loader.getExtensions(), names: () => session.getActiveToolNames().slice().sort() };
		}

		for (const options of [
			{ tools: [] }, { tools: ["read", "bash"] }, { tools: ["-codemode", "-grep"] },
			{ tools: ["+codemode", "+grep", "-edit"] }, { excludeTools: [] }, { excludeTools: ["edit"] },
			{ excludeTools: ["codemode", "tool_search", "grep", "find"] },
			{ noTools: "builtin" }, { noTools: "all" },
		] satisfies Options[]) {
			it(`preserves raw SDK selection ${JSON.stringify(options)}`, async () => {
				const argv = [...process.argv];
				const stock = await open(options, false);
				try {
					const ours = await open(options);
					try {
						assert.deepEqual(ours.names(), stock.names());
						assert.equal(intentMap(sdk.AgentSession).get(ours.session.sessionManager), true);
						assert.deepEqual(process.argv, argv);
					} finally { await ours.close(); }
				} finally { await stock.close(); }
			});
		}

		for (const defaultTools of [[], ["read"], ["-codemode", "-grep"]]) {
			it(`preserves defaultTools ${JSON.stringify(defaultTools)}`, async () => {
				const stock = await open({}, false, { defaultTools });
				const ours = await open({}, true, { defaultTools });
				try { assert.deepEqual(ours.names(), stock.names()); }
				finally { await ours.close(); await stock.close(); }
			});
		}

		it("separate managers in one runtime keep explicit and default intent independent for every start reason", async () => {
			for (const reason of ["startup", "new", "resume", "fork"] as const) {
				const explicit = await open({ excludeTools: [] }, true, {}, reason);
				const defaults = await open({}, true, {}, reason);
				try {
					assert.deepEqual(explicit.names(), FOUR);
					assert.deepEqual(defaults.names(), [...FOUR, ...ADDED].sort());
					await explicit.close();
					await defaults.session.bindExtensions({});
					assert.deepEqual(defaults.names(), [...FOUR, ...ADDED].sort());
				} finally { await explicit.close(); await defaults.close(); }
			}
		});

		it("native newSession and in-memory fork retain default versus explicit intent without inheriting manual-off as SDK intent", async () => {
			for (const options of [{}, { excludeTools: [] }] satisfies Options[]) {
				const descriptor = Object.getOwnPropertyDescriptor(sdk.AgentSession.prototype, "bindExtensions");
				const createRuntime: Parameters<typeof sdk.createAgentSessionRuntime>[0] = async (target) => {
					const next = await open(options, true, {}, target.sessionStartEvent?.reason, target.sessionManager);
					return { session: next.session, extensionsResult: next.extensionsResult, services: { cwd: target.cwd, agentDir: target.agentDir } as any, diagnostics: [] };
				};
				const lifecycle = await sdk.createAgentSessionRuntime(createRuntime, {
					cwd: root, agentDir: join(root, name), sessionManager: sdk.SessionManager.inMemory(root),
				});
				try {
					const expected = Object.keys(options).length ? FOUR : [...FOUR, ...ADDED].sort();
					const initialManager = lifecycle.session.sessionManager;
					lifecycle.session.setActiveToolsByName(FOUR);
					await lifecycle.newSession();
					assert.notEqual(lifecycle.session.sessionManager, initialManager);
					assert.deepEqual(lifecycle.session.getActiveToolNames().sort(), expected);
					const manager = lifecycle.session.sessionManager;
					lifecycle.session.setActiveToolsByName(FOUR);
					const entryId = manager.appendMessage({ role: "user", content: "fork", timestamp: Date.now() });
					await lifecycle.fork(entryId, { position: "at" });
					assert.equal(lifecycle.session.sessionManager, manager, "native in-memory fork reuses the manager");
					assert.deepEqual(lifecycle.session.getActiveToolNames().sort(), expected);
					assert.equal(intentMap(sdk.AgentSession).get(manager), Object.keys(options).length > 0);
				} finally { await lifecycle.dispose(); }
				assert.deepEqual(Object.getOwnPropertyDescriptor(sdk.AgentSession.prototype, "bindExtensions"), descriptor);
			}
		});

		it("reload keeps manual off and initial intent, and disabling restores the native descriptor", async () => {
			const descriptor = Object.getOwnPropertyDescriptor(sdk.AgentSession.prototype, "bindExtensions");
			const ours = await open();
			try {
				assert.deepEqual(ours.names(), [...FOUR, ...ADDED].sort());
				ours.session.setActiveToolsByName(FOUR);
				const manager = ours.session.sessionManager;
				const intents = intentMap(sdk.AgentSession);
				await ours.session.reload();
				assert.deepEqual(ours.names(), FOUR);
				assert.equal(intentMap(sdk.AgentSession), intents);
				assert.equal(intents.get(manager), false);
				ours.paths.splice(0);
				await ours.session.reload();
				assert.deepEqual(ours.names(), FOUR);
				assert.deepEqual(ours.errors, []);
				assert.deepEqual(Object.getOwnPropertyDescriptor(sdk.AgentSession.prototype, "bindExtensions"), descriptor);
			} finally { await ours.close(); }
			assert.deepEqual(Object.getOwnPropertyDescriptor(sdk.AgentSession.prototype, "bindExtensions"), descriptor);
		});
	});
}
