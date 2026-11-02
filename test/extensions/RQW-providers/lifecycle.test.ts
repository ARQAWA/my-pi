import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { AgentSession, ModelRuntime } from "@earendil-works/pi-coding-agent";
import providers, { installVisibility } from "../../../extensions/RQW-providers/index.ts";

describe("provider visibility lifecycle", () => {
const CHAIN = Symbol.for("rqw:method-chain/v1");
const INNER = Symbol.for("rqw:method-inner");
const OWNER = Symbol.for("rqw:method-owner");
const allowed = ["anthropic", "openai-codex"];
const models = [
	{ id: "claude", provider: "anthropic" },
	{ id: "codex", provider: "openai-codex" },
	{ id: "other", provider: "openrouter" },
];
const runtimeMethods = ["getProviders", "getModels", "getAvailableSnapshot", "getAvailable"] as const;
const sessionMethods = ["_bindExtensionCore", "dispose", "scopedModels"] as const;
const stockCalls: string[] = [];
// What Pi's own bind sees on the runtime of the session it binds.
let seenInBind: string[] = [];

type Targets = [object, string][];
const targets: Targets = [
	...runtimeMethods.map(name => [ModelRuntime.prototype, name] as [object, string]),
	...sessionMethods.map(name => [AgentSession.prototype, name] as [object, string]),
];
let saved: PropertyDescriptor[] = [];
let stubbed: PropertyDescriptor[] = [];
const pis: FakePi[] = [];

// Pi's real prototypes carry simple stubs; the real Pi methods are put back after each test.
beforeEach(() => {
	stockCalls.length = 0;
	seenInBind = [];
	saved = targets.map(([target, name]) => Object.getOwnPropertyDescriptor(target, name)!);
	const stubs: Record<string, unknown> = {
		getProviders() { return models.map(model => ({ id: model.provider })); },
		getModels() { return models; },
		getAvailableSnapshot() { return models; },
		async getAvailable() { return models; },
		_bindExtensionCore(this: AgentSession) { stockCalls.push("stock bind"); seenInBind = providerIds(this.modelRuntime); },
		dispose() { stockCalls.push("stock dispose"); },
	};
	targets.forEach(([target, name]) => {
		const descriptor = Object.getOwnPropertyDescriptor(target, name)!;
		if (name === "scopedModels") {
			Object.defineProperty(target, name, { ...descriptor, get(this: { entries: unknown }) { return this.entries; } });
		} else Object.defineProperty(target, name, { ...descriptor, value: stubs[name] });
	});
	stubbed = targets.map(([target, name]) => Object.getOwnPropertyDescriptor(target, name)!);
});
afterEach(() => {
	(globalThis as unknown as Record<symbol, WeakMap<object, unknown> | undefined>)[CHAIN]?.delete(FakeSession.prototype);
	for (const pi of pis.splice(0)) shutdown(pi);
	targets.forEach(([target, name], i) => Object.defineProperty(target, name, saved[i]!));
});

type Handler = (event: object) => void;
type FakePi = { stale: boolean; handlers: Map<string, Handler[]>; on(name: string, handler: Handler): () => unknown };
function fakePi(): FakePi {
	const handlers = new Map<string, Handler[]>();
	const api = { stale: false, handlers, on(name: string, handler: Handler) {
		if (api.stale) throw new Error("stale extension API");
		handlers.set(name, [...(handlers.get(name) ?? []), handler]);
		return () => handlers.set(name, (handlers.get(name) ?? []).filter(item => item !== handler));
	} };
	pis.push(api);
	return api;
}
function shutdown(pi: FakePi) {
	for (const handler of pi.handlers.get("session_shutdown") ?? []) handler({});
}

function fakeSession(runtime: object, pis: FakePi[]): AgentSession {
	const session = Object.create(AgentSession.prototype) as AgentSession;
	Object.defineProperty(session, "modelRuntime", { value: runtime });
	Object.defineProperty(session, "entries", { value: models.map(model => ({ model })) });
	const extensions = pis.map(pi => ({ handlers: pi.handlers }));
	Object.defineProperty(session, "resourceLoader", { value: { getExtensions: () => ({ extensions }) } });
	return session;
}
const newRuntime = () => Object.create(ModelRuntime.prototype) as ModelRuntime;
const providerIds = (runtime: ModelRuntime) => runtime.getProviders().map(provider => provider.id);
const slot = (target: object, name: string) => Object.getOwnPropertyDescriptor(target, name)!.value as unknown;
const bind = (session: AgentSession) => Reflect.apply(Reflect.get(session, "_bindExtensionCore"), session, [{}]);

it("owns the runtime before Pi's own bind and releases it on session shutdown", () => {
	const pi = fakePi();
	providers(pi as never);
	const owned = newRuntime();
	const foreign = newRuntime();
	const session = fakeSession(owned, [pi]);
	assert.equal(providerIds(owned).length, models.length);
	bind(session);
	assert.deepEqual(stockCalls, ["stock bind"]);
	assert.deepEqual(seenInBind, allowed);
	assert.deepEqual(providerIds(owned), allowed);
	assert.deepEqual(session.scopedModels.map(entry => entry.model.provider), allowed);
	assert.equal(providerIds(foreign).length, models.length);
	shutdown(pi);
	assert.equal(providerIds(owned).length, models.length);
	assert.equal(session.scopedModels.length, models.length);
	assert.equal(slot(AgentSession.prototype, "dispose"), stubbed[sessionMethods.indexOf("dispose") + runtimeMethods.length]!.value);
});

it("stops filtering once the extension API is stale and no other owner is live", () => {
	const pi = fakePi();
	providers(pi as never);
	const runtime = newRuntime();
	bind(fakeSession(runtime, [pi]));
	assert.deepEqual(providerIds(runtime), allowed);
	pi.stale = true;
	assert.equal(providerIds(runtime).length, models.length);
});

it("keeps the policy for a second owner and restores Pi when the session is disposed", () => {
	const first = fakePi();
	const second = fakePi();
	providers(first as never);
	providers(second as never);
	const runtime = newRuntime();
	const session = fakeSession(runtime, [first, second]);
	bind(session);
	shutdown(first);
	assert.deepEqual(providerIds(runtime), allowed);
	session.dispose();
	assert.deepEqual(stockCalls, ["stock bind", "stock dispose"]);
	assert.equal(providerIds(runtime).length, models.length);
	shutdown(second);
	assert.equal(slot(AgentSession.prototype, "_bindExtensionCore"), stubbed[sessionMethods.indexOf("_bindExtensionCore") + runtimeMethods.length]!.value);
	assert.equal(slot(ModelRuntime.prototype, "getModels"), stubbed[1]!.value);
});

class FakeRuntime {
	getProviders() { return []; }
	getModels() { return []; }
	getAvailableSnapshot() { return []; }
	async getAvailable() { return []; }
}
class FakeSession {
	get scopedModels() { return []; }
	_bindExtensionCore() {}
	dispose() {}
}

it("patches nothing when a session hook is missing", () => {
	class NoDispose { get scopedModels() { return []; } _bindExtensionCore() {} }
	const before = Object.getOwnPropertyDescriptor(FakeRuntime.prototype, "getModels");
	const scopedBefore = Object.getOwnPropertyDescriptor(NoDispose.prototype, "scopedModels");
	assert.throws(() => installVisibility(FakeRuntime as never, NoDispose as never), /incompatible Pi internals/);
	assert.deepEqual(Object.getOwnPropertyDescriptor(FakeRuntime.prototype, "getModels"), before);
	assert.deepEqual(Object.getOwnPropertyDescriptor(NoDispose.prototype, "scopedModels"), scopedBefore);
});

type Chains = WeakMap<object, Map<string, { owners: Set<object> }>>;

// A cooperating foreign owner joins the shared chain of `_bindExtensionCore` on top of the current layer.
function joinForeign() {
	const current = Object.getOwnPropertyDescriptor(FakeSession.prototype, "_bindExtensionCore")!;
	const owner = {};
	const layer = function() {} as unknown as Record<symbol, unknown>;
	const chains = (globalThis as unknown as Record<symbol, Chains>)[CHAIN];
	chains.get(FakeSession.prototype)!.get("_bindExtensionCore")!.owners.add(owner);
	Object.defineProperty(layer, INNER, { value: current.value, writable: true, configurable: true });
	Object.defineProperty(layer, OWNER, { value: owner });
	Object.defineProperty(FakeSession.prototype, "_bindExtensionCore", { ...current, value: layer });
	// What the foreign extension's own release does: unlink its layer and leave the owner set.
	const leave = () => {
		chains.get(FakeSession.prototype)!.get("_bindExtensionCore")!.owners.delete(owner);
		Object.defineProperty(FakeSession.prototype, "_bindExtensionCore", { ...current, value: layer[INNER] });
	};
	return { layer, leave };
}
const hookDescriptors = () => ["_bindExtensionCore", "dispose"].map(name => Object.getOwnPropertyDescriptor(FakeSession.prototype, name));

it("keeps another extension's lifecycle layer when it releases", () => {
	const before = hookDescriptors();
	const stock = FakeSession.prototype._bindExtensionCore;
	const stockDispose = FakeSession.prototype.dispose;
	const visibility = installVisibility(FakeRuntime as never, FakeSession as never);
	const { layer, leave } = joinForeign();
	visibility.release();
	assert.equal(slot(FakeSession.prototype, "_bindExtensionCore"), layer);
	assert.equal(layer[INNER], stock);
	assert.equal(slot(FakeSession.prototype, "dispose"), stockDispose);
	// The foreign owner leaves last, so the next test starts from the stock hooks.
	leave();
	assert.deepEqual(hookDescriptors(), before);
});

it("restores the exact stock hooks when the other extension leaves first", () => {
	const before = hookDescriptors();
	const visibility = installVisibility(FakeRuntime as never, FakeSession as never);
	const { leave } = joinForeign();
	leave();
	assert.notDeepEqual(hookDescriptors(), before);
	visibility.release();
	assert.deepEqual(hookDescriptors(), before);
});
});
