// Registration owner and child binder on real Pi 1.4.0 sessions (temporary auth.json, no models.json, no network).
// The session controller is an injected counter/fake; the real transport is never created here.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import {
	createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager, type AgentSession, type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";

import { PREWARM_HISTORY_CHANNEL, registerCodex, SESSION_POLICY_CHANNEL, type ControllerLineage, type CreateControllerOptions, type LineageSnapshot, type PrewarmHistoryRequest, type RegisteredController, type SessionPolicyRequest } from "../registration.ts";
import { CODEX_API, CODEX_PROVIDER } from "../profile.ts";

let root: string;
let counter = 0;
/** Every session and owner this file opens; disposed before the temporary root is removed. */
const opened: Array<{ dispose(): Promise<void> }> = [];
before(async () => { root = await mkdtemp(join(tmpdir(), "rqw-codex-registration-")); });
after(async () => {
	// Lease cleanup first (idempotent dispose of every owner and session), then the directory; bounded retries for Windows file locks.
	for (const item of opened.splice(0).reverse()) await item.dispose();
	await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 5));

/** Fake controller: records every call; `stream` returns a sentinel so the test sees exactly what came back. */
type Fake = RegisteredController & {
	calls: string[]; created: CreateControllerOptions; streamed: unknown[]; sentinel: object;
	/** Every lineage given by updateLineage, in order. */
	applied: ControllerLineage[];
	/** Every origin given by captureRunOrigin, in order. */
	origins: object[];
	/** The lineage snapshot this fake reports; the test sets it. */
	snap: { snapshot?: LineageSnapshot };
};
/** `legacy`: a controller that predates the snapshot and origin members (no lineageSnapshot, no captureRunOrigin). */
function fakeController(created: CreateControllerOptions, legacy = false): Fake {
	const calls: string[] = [];
	const streamed: unknown[] = [];
	const sentinel = {};
	const applied: ControllerLineage[] = [];
	const origins: object[] = [];
	const snap: { snapshot?: LineageSnapshot } = {};
	const id = created.session.sessionId;
	const controller = {
		calls, created, streamed, sentinel, applied, origins, snap,
		policy: {
			beginRun: () => calls.push("beginRun"),
			endRun: () => calls.push("endRun"),
			release: () => calls.push("policy.release"),
		},
		start: async () => { calls.push("start"); },
		updateLineage: (lineage: ControllerLineage) => { calls.push(`lineage:${JSON.stringify(lineage)}`); applied.push(lineage); },
		stream: (...args: unknown[]) => { streamed.push(args); return sentinel as never; },
		release: () => { calls.push("release"); },
		threadId: id,
		rootSessionId: created.rootSessionId ?? id,
	};
	if (!legacy) {
		Object.defineProperty(controller, "lineageSnapshot", { get: () => snap.snapshot, enumerable: true });
		Object.assign(controller, { captureRunOrigin: (origin: object) => { origins.push(origin); } });
	}
	return controller as Fake;
}

/** The lineage this controller runs with: the last updateLineage, else the one it was created with. */
const effective = (c: Fake): Partial<CreateControllerOptions> => c.applied.at(-1) ?? c.created;

type Opened = {
	session: AgentSession; runtime: ModelRuntime; controllers: Fake[]; directs: unknown[]; release: () => void; dispose: () => Promise<void>;
	emit: (req: SessionPolicyRequest) => void; prewarm: (req: PrewarmHistoryRequest) => void; select: (model: unknown) => Promise<void>; startup: () => Promise<void>; shutdown: () => Promise<void>;
};

/** A real main session on a fresh runtime, with registerCodex loaded through a resource loader extension factory. */
async function open(options: { installationId?: string; direct?: boolean; legacy?: boolean; runtime?: ModelRuntime; extra?: (pi: ExtensionAPI) => void } = {}): Promise<Opened> {
	const dir = join(root, `s${counter++}`);
	await mkdir(dir, { recursive: true });
	const runtime = options.runtime ?? await ModelRuntime.create({ authPath: join(dir, "auth.json"), modelsPath: null, refreshOnCreate: false });
	await writeFile(join(dir, "auth.json"), "{}");
	const main = fauxProvider({ provider: `reg-main-${counter}`, api: `reg-main-${counter}`, models: [{ id: "m", reasoning: true }] });
	main.setResponses(Array.from({ length: 4 }, () => () => fauxAssistantMessage("ok")));
	runtime.registerNativeProvider(main.provider);
	const controllers: Fake[] = [];
	const directs: unknown[] = [];
	let release: () => void = () => {};
	let bus: ExtensionAPI | undefined;
	const factory = (pi: ExtensionAPI) => {
		bus = pi;
		release = registerCodex(pi, {
			installationId: options.installationId ?? "inst-1",
			createController: (created) => { const c = fakeController(created, options.legacy === true); controllers.push(c); return c; },
			createDirectTransport: options.direct === false ? undefined : () => ({ stream: (...args: unknown[]) => { directs.push(args); return {} as never; } }),
		});
		options.extra?.(pi);
	};
	const loader = new DefaultResourceLoader({ cwd: dir, agentDir: dir, additionalExtensionPaths: [], extensionFactories: [factory],
		noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
	await loader.reload();
	assert.deepEqual(loader.getExtensions().errors, []);
	const { session } = await createAgentSession({ cwd: dir, agentDir: dir, modelRuntime: runtime, model: main.getModel("m"), thinkingLevel: "off",
		resourceLoader: loader, sessionManager: SessionManager.inMemory(dir),
		settingsManager: SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false }, transport: "sse" }) });
	await session.bindExtensions({ mode: "tui" });
	const runner = () => session.extensionRunner as unknown as { emit(event: unknown): Promise<unknown> };
	let disposed = false;
	const handle: Opened = {
		session, runtime, controllers, directs, release: () => release(),
		dispose: async () => { if (!disposed) { disposed = true; session.dispose(); } },
		emit: (req) => bus!.events.emit(SESSION_POLICY_CHANNEL, req),
		prewarm: (req) => bus!.events.emit(PREWARM_HISTORY_CHANNEL, req),
		select: async (model) => { await runner().emit({ type: "model_select", model, previousModel: undefined, source: "set" }); },
		startup: async () => { await runner().emit({ type: "session_start", reason: "new" }); },
		shutdown: async () => { await runner().emit({ type: "session_shutdown", reason: "quit" }); },
	};
	opened.push(handle);
	return handle;
}

const codexModel = (runtime: ModelRuntime) => runtime.getModels(CODEX_PROVIDER)[0]!;

const registeredConfig = (runtime: ModelRuntime) => runtime.getRegisteredProviderConfig(CODEX_PROVIDER);
const streamOf = (runtime: ModelRuntime) => registeredConfig(runtime)!.streamSimple as (...args: unknown[]) => unknown;

describe("RQW-codex registration: provider owner", () => {
	it("registers openai-codex on the Codex API with device-only oauth and no models, catalog unchanged", async () => {
		const before = await ModelRuntime.create({ authPath: join(root, "catalog-auth.json"), modelsPath: null, refreshOnCreate: false });
		const catalog = before.getModels(CODEX_PROVIDER).map((m) => m.id);
		const f = await open({ runtime: before });
		try {
			const config = registeredConfig(f.runtime)!;
			assert.equal(config.api, CODEX_API);
			assert.equal(config.models, undefined, "no models are registered");
			assert.equal(config.apiKey, undefined);
			assert.equal(config.oauth?.isSubscription, true);
			assert.deepEqual(f.runtime.getModels(CODEX_PROVIDER).map((m) => m.id), catalog);
			assert.equal(typeof config.oauth?.login, "function");
			assert.equal(typeof config.oauth?.refreshToken, "function");
			assert.equal(typeof config.oauth?.getApiKey, "function");
			assert.equal(config.oauth?.getApiKey({ access: "A", refresh: "R", expires: 1 } as never), "A");
		} finally { await f.dispose(); }
	});

	it("creates one controller per actual session with the installation id and the session's store; a non-Codex session is not started", async () => {
		const f = await open({ installationId: "inst-xyz" });
		try {
			assert.equal(f.controllers.length, 1);
			const [c] = f.controllers;
			assert.equal(c.created.session, f.session);
			assert.equal(c.created.installationId, "inst-xyz");
			assert.equal(c.created.parentThreadId, undefined);
			assert.equal(c.created.store, (f.runtime as unknown as { credentials: unknown }).credentials);
			await flush();
			assert.equal(c.calls.includes("start"), false, "a non-Codex session never starts (no latch for a later Codex choice)");
			await f.select(codexModel(f.runtime));
			await f.select(codexModel(f.runtime));
			assert.equal(c.calls.filter((call) => call === "start").length, 1, "a Codex choice starts the root exactly once");
		} finally { await f.dispose(); }
	});

	it("dispatches options.sessionId to the bound controller and passes the options through untouched", async () => {
		const f = await open();
		try {
			const [c] = f.controllers;
			const options = { sessionId: c.threadId, reasoning: "low", extra: 1 };
			const model = { provider: CODEX_PROVIDER, id: "gpt-6.1-sol" };
			const result = streamOf(f.runtime)(model, { messages: [] }, options);
			assert.equal(result, c.sentinel);
			assert.equal(c.streamed.length, 1);
			const [args] = c.streamed as unknown[][];
			assert.equal(args[0], model);
			assert.equal(args[2], options, "the same options object reaches the controller");
		} finally { await f.dispose(); }
	});

	it("without a session id uses a request-local direct transport and never a bound controller", async () => {
		const f = await open();
		try {
			const [c] = f.controllers;
			streamOf(f.runtime)({ provider: CODEX_PROVIDER }, { messages: [] }, { reasoning: "low" });
			streamOf(f.runtime)({ provider: CODEX_PROVIDER }, { messages: [] }, { reasoning: "low" });
			assert.equal(f.directs.length, 2, "one request-local transport per call");
			assert.equal(c.streamed.length, 0);
		} finally { await f.dispose(); }
	});

	it("without a session id and without a direct transport the request fails closed", async () => {
		const f = await open({ direct: false });
		try {
			assert.throws(() => streamOf(f.runtime)({ provider: CODEX_PROVIDER }, { messages: [] }, {}), /no direct transport/);
		} finally { await f.dispose(); }
	});

	it("an unknown session id fails closed instead of borrowing another session", async () => {
		const f = await open();
		try {
			assert.throws(() => streamOf(f.runtime)({ provider: CODEX_PROVIDER }, { messages: [] }, { sessionId: "nope" }), /no bound controller/);
		} finally { await f.dispose(); }
	});

	it("disposing the session releases its controller and restores the stock provider when it was the last owner", async () => {
		const f = await open();
		const [c] = f.controllers;
		assert.ok(registeredConfig(f.runtime));
		await f.dispose();
		assert.ok(c.calls.includes("release"));
		assert.equal(registeredConfig(f.runtime), undefined, "stock provider restored");
	});

	it("a competing unknown Codex adapter is rejected and never overwritten", async () => {
		const runtime = await ModelRuntime.create({ authPath: join(root, "competing-auth.json"), modelsPath: null, refreshOnCreate: false });
		const foreign = () => { throw new Error("foreign"); };
		runtime.registerProvider(CODEX_PROVIDER, { api: CODEX_API as never, streamSimple: foreign as never });
		await assert.rejects(open({ runtime }), /competing Codex adapter/);
		assert.equal(registeredConfig(runtime)?.streamSimple, foreign, "foreign registration kept");
	});

	it("two owners on one runtime coexist: the provider stays while either owner remains, in both disposal orders", async () => {
		for (const order of [[0, 1], [1, 0]]) {
			const first = await open();
			const second = await open({ runtime: first.runtime });
			const owners = [first, second];
			assert.equal(registeredConfig(first.runtime)?.streamSimple, streamOf(first.runtime), "one shared registration");
			await owners[order[0]].dispose();
			assert.ok(registeredConfig(first.runtime), "the surviving owner keeps the provider");
			streamOf(first.runtime)({ provider: CODEX_PROVIDER }, { messages: [] }, { sessionId: owners[order[1]].controllers[0].threadId });
			assert.equal(owners[order[1]].controllers[0].streamed.length, 1, "survivor still dispatches");
			await owners[order[1]].dispose();
			assert.equal(registeredConfig(first.runtime), undefined, "last owner restores stock");
		}
	});

	it("explicit release of the owner tears down every session it bound", async () => {
		const f = await open();
		f.release();
		assert.ok(f.controllers[0].calls.includes("release"));
		assert.equal(registeredConfig(f.runtime), undefined);
		await f.dispose();
	});
});

describe("RQW-codex registration: child policy binder", () => {
	const request = (session: AgentSession, parentThreadId: string, kind: string): SessionPolicyRequest => ({ session, parentThreadId, kind: kind as never });

	it("refuses an unknown parent, an unknown kind and a session from another runtime, with an error and no release", async () => {
		const other = await open();
		const f = await open();
		try {
			const unknown = request(f.session, "missing-parent", "review");
			f.emit(unknown);
			assert.match(unknown.error ?? "", /unknown parent/);
			assert.equal(unknown.release, undefined);

			const parent = f.controllers[0].threadId;
			const badKind = request(f.session, parent, "other");
			f.emit(badKind);
			assert.match(badKind.error ?? "", /unknown subagent kind/);

			const foreign = request(other.session, f.controllers[0].threadId, "collab_spawn");
			f.emit(foreign);
			assert.match(foreign.error ?? "", /unknown parent/, "a parent from another runtime is not used");
		} finally { await f.dispose(); await other.dispose(); }
	});

	it("binds a known same-runtime child with parent, root and kind before start and releases it idempotently", async () => {
		const f = await open();
		try {
			const parent = f.controllers[0];
			const child = await openChild(f);
			const req = request(child, parent.threadId, "collab_spawn");
			f.emit(req);
			assert.equal(req.error, undefined);
			const childController = f.controllers.find((c) => c.threadId === child.sessionId)!;
			assert.ok(childController.calls.some((call) => call.startsWith("lineage:") && call.includes(`"parentThreadId":"${parent.threadId}"`) && call.includes(`"subagentKind":"collab_spawn"`)));
			assert.equal(childController.calls.indexOf("start"), -1, "lineage is set before any start");
			assert.equal(childController.created.parentThreadId, undefined, "the child was constructed before the request");
			assert.equal(typeof req.release, "function");
			req.release!();
			req.release!();
			assert.equal(childController.calls.filter((c) => c === "release").length, 1, "release is idempotent");
		} finally { await f.dispose(); }
	});

	it("carries the child's optional startupSystemPrompt into its controller before start; without it the field stays absent", async () => {
		const f = await open();
		try {
			const parent = f.controllers[0];
			const child = await openChild(f);
			const req = { ...request(child, parent.threadId, "review"), startupSystemPrompt: "FORCED-REVIEWER" };
			f.emit(req);
			assert.equal(req.error, undefined);
			const childController = f.controllers.find((c) => c.threadId === child.sessionId)!;
			assert.ok(childController.calls.some((call) => call.startsWith("lineage:") && call.includes(`"startupSystemPrompt":"FORCED-REVIEWER"`)), "the prompt reaches updateLineage");
			assert.equal(childController.calls.indexOf("start"), -1, "the prompt is set before any start");
			const plain = await openChild(f);
			f.emit(request(plain, parent.threadId, "collab_spawn"));
			const plainController = f.controllers.find((c) => c.threadId === plain.sessionId)!;
			assert.equal(plainController.calls.some((c) => c.includes("startupSystemPrompt")), false, "no prompt key without the request field");
		} finally { await f.dispose(); }
	});

	it("a generic same-runtime child without a request keeps no parent lineage", async () => {
		const f = await open();
		try {
			const child = await openChild(f);
			const generic = f.controllers.find((c) => c.threadId === child.sessionId)!;
			assert.equal(generic.created.parentThreadId, undefined);
			assert.equal(generic.calls.some((c) => c.startsWith("lineage:")), false);
		} finally { await f.dispose(); }
	});
});

/** A same-runtime child session: constructed with the parent's runtime, the same owner extension (its lease binds it). */
async function openChild(f: Opened): Promise<AgentSession> {
	const dir = join(root, `c${counter++}`);
	await mkdir(dir, { recursive: true });
	const loader = new DefaultResourceLoader({ cwd: dir, agentDir: dir, additionalExtensionPaths: [], extensionFactories: [],
		noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
	await loader.reload();
	const { session } = await createAgentSession({ cwd: dir, agentDir: dir, modelRuntime: f.runtime, model: f.session.model, thinkingLevel: "off",
		resourceLoader: loader, sessionManager: SessionManager.inMemory(dir),
		settingsManager: SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false }, transport: "sse" }) });
	opened.push({ dispose: async () => { session.dispose(); } });
	return session;
}

describe("RQW-codex registration: owner lifecycle", () => {
	it("session_start after the owner is released never reinstalls the provider", async () => {
		const f = await open();
		f.release();
		await f.startup();
		assert.equal(registeredConfig(f.runtime), undefined);
		await f.dispose();
	});

	it("a session_start of one owner never starts the controller of an owner on another runtime", async () => {
		const a = await open();
		const b = await open();
		try {
			await a.select(codexModel(a.runtime));
			assert.equal(a.controllers[0].calls.filter((call) => call === "start").length, 1);
			await b.startup();
			assert.equal(b.controllers[0].calls.includes("start"), false, "b's model is not Codex: no start");
			await a.startup();
			assert.equal(a.controllers[0].calls.filter((call) => call === "start").length, 1, "the root starts once");
		} finally { await a.dispose(); await b.dispose(); }
	});

	it("a manager id change on the same root replaces its controller and registry entry, and the old closure is gone", async () => {
		const f = await open();
		try {
			const [first] = f.controllers;
			const dir = join(root, `m${counter++}`);
			await mkdir(dir, { recursive: true });
			const manager = SessionManager.inMemory(dir);
			// Pi rebuilds the runner with the new manager after /new, /resume or /fork; the session and its runner follow.
			(f.session as unknown as { sessionManager: unknown }).sessionManager = manager;
			(f.session.extensionRunner as unknown as { sessionManager: unknown }).sessionManager = manager;
			await f.startup();
			assert.equal(f.controllers.length, 2, "one new controller for the new id");
			const [, second] = f.controllers;
			assert.notEqual(second.threadId, first.threadId);
			assert.ok(first.calls.includes("release"), "the old controller is released");
			assert.equal(second.calls.includes("start"), false, "no Codex model: no start");
			assert.throws(() => streamOf(f.runtime)({ provider: CODEX_PROVIDER }, { messages: [] }, { sessionId: first.threadId }), /no bound controller/);
			streamOf(f.runtime)({ provider: CODEX_PROVIDER }, { messages: [] }, { sessionId: second.threadId });
			assert.equal(second.streamed.length, 1, "the new id dispatches to the new controller");
			await f.select(codexModel(f.runtime));
			assert.equal(second.calls.filter((call) => call === "start").length, 1, "the rebound root starts with its own controller");
		} finally { await f.dispose(); }
	});

	it("a child bound after the root rebinds takes the actual new root lineage before start", async () => {
		const f = await open();
		try {
			const dir = join(root, `r${counter++}`);
			await mkdir(dir, { recursive: true });
			const manager = SessionManager.inMemory(dir);
			(f.session as unknown as { sessionManager: unknown }).sessionManager = manager;
			(f.session.extensionRunner as unknown as { sessionManager: unknown }).sessionManager = manager;
			await f.startup();
			const newRoot = f.controllers[1];
			const child = await openChild(f);
			const req = { session: child, parentThreadId: newRoot.threadId, kind: "collab_spawn" } as SessionPolicyRequest;
			f.emit(req);
			assert.equal(req.error, undefined);
			const childController = f.controllers.find((c) => c.threadId === child.sessionId)!;
			assert.ok(childController.calls.includes(`lineage:${JSON.stringify({ rootSessionId: newRoot.threadId, parentThreadId: newRoot.threadId, subagentKind: "collab_spawn" })}`));
		} finally { await f.dispose(); }
	});

	it("releasing one child releases only that child; the root, the other child and the provider stay", async () => {
		const f = await open();
		try {
			const [rootController] = f.controllers;
			const a = await openChild(f);
			const b = await openChild(f);
			const reqA = { session: a, parentThreadId: rootController.threadId, kind: "review" } as SessionPolicyRequest;
			const reqB = { session: b, parentThreadId: rootController.threadId, kind: "review" } as SessionPolicyRequest;
			f.emit(reqA);
			f.emit(reqB);
			const ca = f.controllers.find((c) => c.threadId === a.sessionId)!;
			const cb = f.controllers.find((c) => c.threadId === b.sessionId)!;
			reqA.release!();
			assert.ok(ca.calls.includes("release"));
			assert.equal(cb.calls.includes("release"), false);
			assert.equal(rootController.calls.includes("release"), false);
			assert.ok(registeredConfig(f.runtime), "provider unchanged");
			streamOf(f.runtime)({ provider: CODEX_PROVIDER }, { messages: [] }, { sessionId: cb.threadId });
			assert.equal(cb.streamed.length, 1, "the surviving child still dispatches");
		} finally { await f.dispose(); }
	});

	it("a child already bound to another owner on the runtime is refused, never inherited", async () => {
		const a = await open();
		const b = await open({ runtime: a.runtime });
		try {
			const child = await openChild(a);
			const req = { session: child, parentThreadId: b.controllers[0].threadId, kind: "review" } as SessionPolicyRequest;
			// Each owner loads its own bus; the request reaches both, as a session's own bus would.
			a.emit(req);
			b.emit(req);
			assert.equal(req.release, undefined, "no release is handed out");
			assert.match(req.error ?? "", /bound to another owner/);
			assert.ok(a.controllers.find((c) => c.threadId === child.sessionId), "the owner that bound the child keeps it");
			assert.equal(b.controllers.find((c) => c.threadId === child.sessionId), undefined, "the parent's owner does not take it over");
		} finally { await a.dispose(); await b.dispose(); }
	});

	it("a foreign-API registration on openai-codex is replaced and restored on release, not treated as a competing adapter", async () => {
		const runtime = await ModelRuntime.create({ authPath: join(root, "foreign-api-auth.json"), modelsPath: null, refreshOnCreate: false });
		const foreign = () => { throw new Error("foreign"); };
		runtime.registerProvider(CODEX_PROVIDER, { api: "faux-iso" as never, streamSimple: foreign as never });
		const f = await open({ runtime });
		assert.ok(registeredConfig(runtime)?.streamSimple !== foreign, "owned registration in place");
		f.release();
		assert.equal(registeredConfig(runtime)?.streamSimple, foreign, "the foreign registration is restored");
		await f.dispose();
	});

	it("device-only /login: an owned Codex provider drops a models.json raw apiKey; other providers and the stock release keep it", async () => {
		const dir = join(root, "login-only");
		await mkdir(dir, { recursive: true });
		await writeFile(join(dir, "models.json"), JSON.stringify({ providers: { [CODEX_PROVIDER]: { apiKey: "sk-raw-codex" }, anthropic: { apiKey: "sk-ant-raw" } } }));
		const runtime = await ModelRuntime.create({ authPath: join(dir, "auth.json"), modelsPath: join(dir, "models.json"), refreshOnCreate: false });
		assert.equal(runtime.getProvider(CODEX_PROVIDER)?.auth.apiKey !== undefined, true, "stock: the raw key is offered");
		const f = await open({ runtime });
		try {
			const codex = runtime.getProvider(CODEX_PROVIDER)!;
			assert.equal(codex.auth.apiKey, undefined, "owned: no API-key login");
			assert.ok(codex.auth.oauth, "owned: device login remains");
			assert.ok(runtime.getProvider("anthropic")?.auth.apiKey, "other providers keep their API-key method");
		} finally { await f.dispose(); }
		assert.ok(runtime.getProvider(CODEX_PROVIDER)?.auth.apiKey !== undefined, "released: the stock API-key method is back");
	});
});

describe("RQW-codex registration: per-operation turn provenance", () => {
	const request = (session: AgentSession, parentThreadId: string, childName?: string): SessionPolicyRequest =>
		({ session, parentThreadId, kind: "collab_spawn", ...(childName === undefined ? {} : { childName }) }) as SessionPolicyRequest;

	it("a child bound to a root at turn A takes A as its parent and root turn, with the root label and the child's name, and captures A at bind", async () => {
		const f = await open();
		try {
			const [root] = f.controllers;
			root.snap.snapshot = { threadId: root.threadId, rootSessionId: root.threadId, agentName: "main", turnId: "A", rootTurnId: "A" };
			const child = await openChild(f);
			const req = request(child, root.threadId, "reviewer#1");
			f.emit(req);
			assert.equal(req.error, undefined);
			const c = f.controllers.find((x) => x.threadId === child.sessionId)!;
			assert.equal(effective(c).parentTurnId, "A");
			assert.equal(effective(c).rootTurnId, "A");
			assert.equal(effective(c).agentName, "main/reviewer#1");
			assert.deepEqual(c.origins, [{ rootTurnId: "A" }], "the initial origin is captured at bind");
		} finally { await f.dispose(); }
	});

	it("the lineage is frozen at bind: a parent that settles to a later turn does not change the child's parent or root turn", async () => {
		const f = await open();
		try {
			const [root] = f.controllers;
			root.snap.snapshot = { threadId: root.threadId, rootSessionId: root.threadId, turnId: "A", rootTurnId: "A" };
			const child = await openChild(f);
			f.emit(request(child, root.threadId, "reviewer#1"));
			const c = f.controllers.find((x) => x.threadId === child.sessionId)!;
			root.snap.snapshot = { threadId: root.threadId, rootSessionId: root.threadId, turnId: "B", rootTurnId: "B" };
			await flush();
			assert.equal(effective(c).parentTurnId, "A", "still the creation parent turn");
			assert.equal(effective(c).rootTurnId, "A");
			assert.deepEqual(c.origins, [{ rootTurnId: "A" }], "nothing re-reads the parent by itself");
		} finally { await f.dispose(); }
	});

	it("a follow-up from caller B is captured synchronously with B, before any async schedule, and stays B", async () => {
		const f = await open();
		try {
			const [root] = f.controllers;
			root.snap.snapshot = { threadId: root.threadId, rootSessionId: root.threadId, turnId: "A", rootTurnId: "A" };
			const child = await openChild(f);
			const req = request(child, root.threadId, "reviewer#1");
			f.emit(req);
			const c = f.controllers.find((x) => x.threadId === child.sessionId)!;
			root.snap.snapshot = { threadId: root.threadId, rootSessionId: root.threadId, turnId: "B", rootTurnId: "B" };
			req.captureRun!(root.threadId);
			assert.deepEqual(c.origins.at(-1), { rootTurnId: "B" }, "captured at the call itself");
			await flush();
			assert.deepEqual(c.origins, [{ rootTurnId: "A" }, { rootTurnId: "B" }]);
		} finally { await f.dispose(); }
	});

	it("a nested child keeps its ancestor's root turn, not its immediate parent's turn, and captures from that parent per operation", async () => {
		const f = await open();
		try {
			const [root] = f.controllers;
			root.snap.snapshot = { threadId: root.threadId, rootSessionId: root.threadId, turnId: "A", rootTurnId: "A" };
			const first = await openChild(f);
			const firstReq = request(first, root.threadId, "agent#1");
			f.emit(firstReq);
			const c1 = f.controllers.find((x) => x.threadId === first.sessionId)!;
			c1.snap.snapshot = { threadId: c1.threadId, rootSessionId: root.threadId, agentName: "main/agent#1", turnId: "C1-t1", rootTurnId: "A" };
			const nested = await openChild(f);
			const nestedReq = request(nested, c1.threadId, "agent#1");
			f.emit(nestedReq);
			const c2 = f.controllers.find((x) => x.threadId === nested.sessionId)!;
			assert.equal(effective(c2).parentTurnId, "C1-t1");
			assert.equal(effective(c2).rootTurnId, "A", "the ancestor's root, not the immediate parent's turn");
			assert.equal(effective(c2).agentName, "main/agent#1/agent#1");
			c1.snap.snapshot = { threadId: c1.threadId, rootSessionId: root.threadId, agentName: "main/agent#1", turnId: "C1-t2", rootTurnId: "A" };
			nestedReq.captureRun!(c1.threadId);
			assert.deepEqual(c2.origins.at(-1), { rootTurnId: "A" });
		} finally { await f.dispose(); }
	});

	it("an absent parent turn omits the origin and never reuses an earlier caller turn", async () => {
		const f = await open();
		try {
			const [root] = f.controllers;
			root.snap.snapshot = { threadId: root.threadId, rootSessionId: root.threadId, turnId: "A", rootTurnId: "A" };
			const child = await openChild(f);
			const req = request(child, root.threadId);
			f.emit(req);
			const c = f.controllers.find((x) => x.threadId === child.sessionId)!;
			assert.equal(effective(c).agentName, undefined, "no child name, no agent name");
			root.snap.snapshot = { threadId: root.threadId, rootSessionId: root.threadId };
			req.captureRun!(root.threadId);
			assert.deepEqual(c.origins.at(-1), {}, "no rootTurnId key: the earlier A is not reused");
		} finally { await f.dispose(); }
	});

	it("a controller without the optional members, and a released child, keep the binder working and capture nothing", async () => {
		const f = await open({ legacy: true });
		try {
			const [root] = f.controllers;
			const child = await openChild(f);
			const req = request(child, root.threadId, "reviewer#1");
			f.emit(req);
			assert.equal(req.error, undefined, "bound without the optional members");
			const c = f.controllers.find((x) => x.threadId === child.sessionId)!;
			assert.equal(effective(c).parentTurnId, undefined);
			req.captureRun!(root.threadId);
			assert.equal(c.origins.length, 0);
			req.release!();
			assert.equal(req.captureRun, undefined, "release drops the capture closure");
			assert.equal(c.calls.filter((call) => call === "release").length, 1);
		} finally { await f.dispose(); }
	});
});

describe("RQW-codex registration: explicit idle prewarm request", () => {
	/** Gives a fake controller an optional prewarm member that records each call; the session reports a Codex model. */
	const withPrewarm = (c: Fake, session: AgentSession, codex: boolean, fail = false): { count: () => number } => {
		let count = 0;
		c.prewarmWithHistory = async () => { count++; c.calls.push("prewarm"); if (fail) throw new Error("prewarm failed"); };
		if (codex) Object.defineProperty(session, "model", { get: () => ({ provider: CODEX_PROVIDER, api: CODEX_API, id: "gpt-6.1-sol" }), configurable: true });
		return { count: () => count };
	};
	const prewarmReq = (threadId?: string): PrewarmHistoryRequest => (threadId === undefined ? {} : { threadId });

	it("the explicit root request is accepted once and prewarms the root; an explicit child thread prewarms that child", async () => {
		const f = await open();
		try {
			const [rootController] = f.controllers;
			const rootCount = withPrewarm(rootController, f.session, true);
			const child = await openChild(f);
			f.emit({ session: child, parentThreadId: rootController.threadId, kind: "review" } as SessionPolicyRequest);
			const childController = f.controllers.find((c) => c.threadId === child.sessionId)!;
			const childCount = withPrewarm(childController, child, true);

			const rootReq = prewarmReq();
			f.prewarm(rootReq);
			assert.equal(rootReq.accepted, true);
			assert.equal(rootReq.error, undefined);

			const childReq = prewarmReq(child.sessionId);
			f.prewarm(childReq);
			assert.equal(childReq.accepted, true);
			await flush();
			assert.equal(rootCount.count(), 1);
			assert.equal(childCount.count(), 1);
			assert.equal(rootController.calls.includes("start"), false, "the prewarm request never starts a controller");
		} finally { await f.dispose(); }
	});

	it("an unknown thread, a non-Codex session and a controller without the member are left unanswered and never prewarmed", async () => {
		const f = await open();
		try {
			const [rootController] = f.controllers;
			const nonCodex = withPrewarm(rootController, f.session, false);
			const unknown = prewarmReq("missing-thread");
			f.prewarm(unknown);
			assert.equal(unknown.accepted, undefined);
			assert.equal(unknown.error, undefined);

			const stock = prewarmReq();
			f.prewarm(stock);
			assert.equal(stock.accepted, undefined, "a non-Codex root is not accepted");
			assert.equal(nonCodex.count(), 0);

			delete rootController.prewarmWithHistory;
			Object.defineProperty(f.session, "model", { get: () => ({ provider: CODEX_PROVIDER, api: CODEX_API, id: "gpt-6.1-sol" }), configurable: true });
			const legacy = prewarmReq();
			f.prewarm(legacy);
			assert.equal(legacy.accepted, undefined, "a controller without the member is not accepted");
			assert.equal(rootController.calls.includes("start"), false);
		} finally { await f.dispose(); }
	});

	it("a request already accepted or carrying an error is ignored", async () => {
		const f = await open();
		try {
			const [rootController] = f.controllers;
			const count = withPrewarm(rootController, f.session, true);
			const accepted = { accepted: true } as PrewarmHistoryRequest;
			f.prewarm(accepted);
			const failed = { error: "earlier" } as PrewarmHistoryRequest;
			f.prewarm(failed);
			assert.equal(failed.accepted, undefined);
			assert.equal(count.count(), 0);
		} finally { await f.dispose(); }
	});

	it("two owners on one runtime: the request is handled once, by the owner that holds the session", async () => {
		const a = await open();
		const b = await open({ runtime: a.runtime });
		try {
			const countA = withPrewarm(a.controllers[0], a.session, true);
			const countB = withPrewarm(b.controllers[0], b.session, true);
			const req = prewarmReq();
			a.prewarm(req);
			b.prewarm(req);
			assert.equal(req.accepted, true);
			await flush();
			assert.equal(countA.count() + countB.count(), 1, "exactly one prewarm across both owners");

			const explicit = prewarmReq(b.controllers[0].threadId);
			a.prewarm(explicit);
			assert.equal(explicit.accepted, undefined, "the owner without the session leaves it unanswered");
			b.prewarm(explicit);
			assert.equal(explicit.accepted, true);
			await flush();
			assert.equal(countB.count(), 1, "the first request went to A; the explicit one prewarms B once");
			assert.equal(countA.count(), 1);
		} finally { await a.dispose(); await b.dispose(); }
	});

	it("a failing prewarm is swallowed: the request stays accepted and nothing is thrown", async () => {
		const f = await open();
		try {
			const [rootController] = f.controllers;
			withPrewarm(rootController, f.session, true, true);
			const req = prewarmReq();
			f.prewarm(req);
			assert.equal(req.accepted, true);
			await flush();
		} finally { await f.dispose(); }
	});

	it("owner release unregisters only its own listener; after release nothing answers, and other owners keep answering", async () => {
		const a = await open();
		const b = await open({ runtime: a.runtime });
		try {
			const countA = withPrewarm(a.controllers[0], a.session, true);
			const countB = withPrewarm(b.controllers[0], b.session, true);
			a.release();
			const afterRelease = prewarmReq();
			a.prewarm(afterRelease);
			assert.equal(afterRelease.accepted, undefined, "released owner's listener is gone");
			assert.equal(countA.count(), 0);
			const survivor = prewarmReq(b.controllers[0].threadId);
			b.prewarm(survivor);
			assert.equal(survivor.accepted, true, "the surviving owner still answers");
			await flush();
			assert.equal(countB.count(), 1);
		} finally { await a.dispose(); await b.dispose(); }
	});
});

