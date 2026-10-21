// W = min(physical.contextWindow, 500000), R = round(W / 10), threshold W - R.
// Selection state and native canonical physical lookups expose stable capped copies, never mutate the catalog.
// Virtual selection stays native, including its unknown window. Request/check-local context supplies the physical
// reserve when Pi asks for the selection's settings. Preparation uses the triggering request/response (manual: latest
// successful response); native default summaries bind R once to their actual direct-route target, after routing.
// Explicit selection settings and native compaction policy still win. No owners means stock Pi again.
import { AsyncLocalStorage } from "node:async_hooks";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { AgentSession, ModelRuntime, SettingsManager } from "@earendil-works/pi-coding-agent";

export const MAX_WINDOW = 500_000;
const VIRTUAL_MODEL_API = "pi-virtual";

/** The owner's rule for a declared physical window. */
export function contextRule(contextWindow: number): { window: number; reserve: number; threshold: number } {
	const window = Math.min(contextWindow, MAX_WINDOW);
	const reserve = Math.round(window / 10);
	return { window, reserve, threshold: window - reserve };
}

/** A user reserve below W wins; otherwise use R. Also supports callers holding the declared physical object. */
export function reserveFor(contextWindow: number, userReserve?: number): number {
	const { window, threshold } = contextRule(contextWindow);
	const target = userReserve !== undefined && userReserve < window ? window - userReserve : threshold;
	return contextWindow - target;
}

// Shared weak mappings preserve round trips and identity across extension reloads, without retaining models.
const MODELS = Symbol.for("rqw-context/models");
const modelCache = globalThis as { [MODELS]?: { copies: WeakMap<object, object>; originals: WeakMap<object, object> } };
const { copies: cappedCopies, originals } = (modelCache[MODELS] ??= {
	copies: new WeakMap(),
	originals: new WeakMap(),
});

function declaredModel<T>(model: T): T {
	return model && typeof model === "object" ? (originals.get(model) as T | undefined) ?? model : model;
}

/** Selection wrappers are not physical limits, including when they declare a window. */
export function capModel<T>(model: T): T {
	model = declaredModel(model);
	if (!model || typeof model !== "object") return model;
	const { api, contextWindow } = model as { api?: unknown; contextWindow?: unknown };
	if (api === VIRTUAL_MODEL_API || typeof contextWindow !== "number" || !(contextWindow > MAX_WINDOW)) return model;
	let copy = cappedCopies.get(model);
	if (!copy) {
		copy = { ...model, contextWindow: MAX_WINDOW };
		cappedCopies.set(model, copy);
		originals.set(copy, model);
	}
	return copy as T;
}

// Live owners of the process-wide patches: one token per factory run, shared across module reloads.
const OWNER = Symbol.for("rqw-context/owner");
const owners = globalThis as { [OWNER]?: Set<object> };
const owned = () => (owners[OWNER]?.size ?? 0) > 0;

type GetCompactionSettings = SettingsManager["getCompactionSettings"];
type CompactionModel = Parameters<GetCompactionSettings>[0];
type CompactionSettings = ReturnType<GetCompactionSettings>;
type Preparation = { settings: CompactionSettings };
type AgentState = { model: unknown };
const cappedStates = new WeakSet<AgentState>();
const WRAPPED_AGENT = Symbol.for("rqw-context/agent-state");
type NativeAgent = {
	state: AgentState;
	_state: AgentState;
	prepareRequest?: (...args: unknown[]) => unknown;
	createLoopConfig: (this: NativeAgent, ...args: unknown[]) => unknown;
	[WRAPPED_AGENT]?: boolean;
};
type BuildRuntime = (this: SessionInternals, ...args: unknown[]) => unknown;
type GetModel = (this: SessionInternals) => unknown;
type SessionInternals = {
	agent: NativeAgent;
	model?: CompactionModel;
	settingsManager: SettingsManager;
	_modelForMessage(message: unknown): CompactionModel;
	_limitsModel(): CompactionModel;
	_buildRuntime?: BuildRuntime;
	[WRAPPED_SESSION]?: BuildRuntime;
	[WRAPPED_MODEL]?: GetModel;
};
type LimitScope = {
	agent: NativeAgent;
	session?: SessionInternals;
	physical?: CompactionModel;
	preparation?: Preparation;
};
const SCOPE = Symbol.for("rqw-context/physical-scope");
const scopes = globalThis as { [SCOPE]?: AsyncLocalStorage<LimitScope> };
const physicalScope = (scopes[SCOPE] ??= new AsyncLocalStorage<LimitScope>());
const requestWrappers = new WeakSet<Function>();

/** Wrap the actual Agent's request callback, including old observers and callbacks replaced later by extensions. */
function wrapPrepareRequest(agent: NativeAgent): void {
	const original = agent.prepareRequest;
	if (typeof original !== "function" || requestWrappers.has(original)) return;
	const wrapped = function (this: NativeAgent, ...args: unknown[]) {
		return owned() ? physicalScope.run({ agent }, () => original.apply(this, args)) : original.apply(this, args);
	};
	requestWrappers.add(wrapped);
	agent.prepareRequest = wrapped;
}

/** Use the session's actual Agent class: the CLI bundle has a different class from the library SDK. */
function wrapAgentState(agent: NativeAgent): void {
	const proto = Object.getPrototypeOf(agent) as NativeAgent;
	if (Object.hasOwn(proto, WRAPPED_AGENT)) {
		wrapPrepareRequest(agent);
		return;
	}
	const descriptor = Object.getOwnPropertyDescriptor(proto, "state");
	const loopDescriptor = Object.getOwnPropertyDescriptor(proto, "createLoopConfig");
	if (
		!Object.isExtensible(proto) ||
		typeof descriptor?.get !== "function" || !descriptor.configurable || descriptor.set ||
		typeof loopDescriptor?.value !== "function" || !loopDescriptor.configurable ||
		!Object.hasOwn(agent, "_state") || descriptor.get.call(agent) !== agent._state ||
		!Object.getOwnPropertyDescriptor(agent._state, "model")?.configurable
	) {
		throw new Error("RQW-context: native Agent.state/createLoopConfig shape differs from Pi 1.3.0");
	}
	const originalLoop = loopDescriptor.value as NativeAgent["createLoopConfig"];
	Object.defineProperty(proto, "state", {
		...descriptor,
		get(this: NativeAgent) {
			const state = descriptor.get!.call(this) as AgentState;
			if (owned()) { capStateModel(state); wrapPrepareRequest(this); }
			return state;
		},
	});
	Object.defineProperty(proto, "createLoopConfig", {
		...loopDescriptor,
		value(this: NativeAgent, ...args: unknown[]) {
			if (owned()) { capStateModel(this._state); wrapPrepareRequest(this); }
			return originalLoop.apply(this, args);
		},
	});
	Object.defineProperty(proto, WRAPPED_AGENT, { value: true });
	wrapPrepareRequest(agent);
}

/** This agent state reads every model, now and later, through `capModel` while an owner is alive. */
function capStateModel(state: AgentState): void {
	if (cappedStates.has(state)) return;
	let model = declaredModel(state.model);
	Object.defineProperty(state, "model", {
		configurable: true,
		enumerable: true,
		get: () => (owned() ? capModel(model) : model),
		set: (next: unknown) => {
			model = declaredModel(next);
		},
	});
	cappedStates.add(state);
}

/** The window of the model Pi passes in; its type names only provider and id, the object is the model. */
function contextWindowOf(model: CompactionModel): number | undefined {
	if (!model || !("contextWindow" in model)) return undefined;
	const value = model.contextWindow;
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}
const isVirtual = (model: NonNullable<CompactionModel>) => "api" in model && model.api === VIRTUAL_MODEL_API;

/** True when the user set reserveTokens: per model in `compaction.modelOverrides`, or for all models. */
function userSetReserve(manager: SettingsManager, model: NonNullable<CompactionModel>): boolean {
	const compaction = manager.getSettings().compaction;
	if (compaction?.reserveTokens !== undefined) return true;
	return compaction?.modelOverrides?.[`${model.provider}/${model.id}`]?.reserveTokens !== undefined;
}

// One wrap per class for the life of the process; /reload finds it in place. Without an owner, stock Pi.
const WRAPPED_SETTINGS = Symbol.for("rqw-context/getCompactionSettings");
const WRAPPED_SESSION = Symbol.for("rqw-context/_buildRuntime");
const WRAPPED_MODEL = Symbol.for("rqw-context/model");
const WRAPPED_PHYSICAL = Symbol.for("rqw-context/getPhysicalModel");
const WRAPPED_ROUTING = Symbol.for("rqw-context/routing");
type SettingsPrototype = SettingsManager & { [WRAPPED_SETTINGS]?: GetCompactionSettings };

function wrapCompactionSettings(proto: SettingsPrototype): void {
	if (proto[WRAPPED_SETTINGS]) return;
	const original = proto.getCompactionSettings;
	proto.getCompactionSettings = function getCompactionSettings(this: SettingsManager, model?: CompactionModel) {
		const settings = original.call(this, model);
		if (!owned() || !model) return settings;
		const scope = physicalScope.getStore();
		const limits = isVirtual(model)
			? scope?.session?.settingsManager === this && scope.session.model === model ? scope.physical : undefined
			: model;
		const contextWindow = contextWindowOf(limits);
		if (contextWindow === undefined || (limits && isVirtual(limits))) return settings;
		const userReserve = userSetReserve(this, model) ? settings.reserveTokens : undefined;
		return { ...settings, reserveTokens: reserveFor(contextWindow, userReserve) };
	};
	proto[WRAPPED_SETTINGS] = original;
}

function wrapModelGetter(proto: SessionInternals, descriptor: PropertyDescriptor): void {
	if (proto[WRAPPED_MODEL]) return;
	const original = descriptor.get as GetModel;
	Object.defineProperty(proto, "model", {
		...descriptor,
		get(this: SessionInternals) {
			if (owned()) capStateModel(this.agent.state);
			return original.call(this);
		},
	});
	proto[WRAPPED_MODEL] = original;
}

function wrapSessionModel(proto: SessionInternals): void {
	if (proto[WRAPPED_SESSION]) return;
	const original = proto._buildRuntime as BuildRuntime;
	proto._buildRuntime = function _buildRuntime(this: SessionInternals, ...args: unknown[]) {
		if (owned()) {
			wrapAgentState(this.agent);
			capStateModel(this.agent.state);
		}
		return original.apply(this, args);
	};
	proto[WRAPPED_SESSION] = original;
}

// Checked Pi 1.3.0 method boundaries, not rewritten compaction or routing implementations.
const ROUTING_METHODS = {
	_exceedsCompactionThreshold: 2, _checkCompaction: 1, _runAutoCompaction: 2, compact: 1,
	_runDefaultCompaction: 5, _getSummarizationRequestAuth: 2, _modelForMessage: 1, _limitsModel: 0,
};
type NativeMethod = (this: SessionInternals, ...args: any[]) => any;
type RoutingPrototype = SessionInternals & Record<string | symbol, any>;

function withPhysical(session: SessionInternals, physical: CompactionModel, run: () => unknown) {
	return physicalScope.run({ agent: session.agent, session, physical }, run);
}

function wrapRouting(proto: RoutingPrototype, runtime: ModelRuntime & Record<symbol, any>): void {
	if (!runtime[WRAPPED_PHYSICAL]) {
		const original = runtime.getPhysicalModel;
		runtime.getPhysicalModel = function (provider, id) {
			const model = original.call(this, provider, id);
			return owned() ? capModel(model) : model;
		};
		runtime[WRAPPED_PHYSICAL] = original;
	}
	if (proto[WRAPPED_ROUTING]) return;
	const wrap = (name: string, make: (original: NativeMethod) => NativeMethod) => {
		proto[name] = make(proto[name]);
	};
	wrap("_exceedsCompactionThreshold", (original) => function (model, projection) {
		if (!owned()) return original.call(this, model, projection);
		const physical = capModel(model);
		const request = physicalScope.getStore();
		// This synchronous check binds only this prepareRequest, not the shared ModelRuntime or virtual entry.
		if (request?.agent === this.agent) { request.session = this; request.physical = physical; }
		return withPhysical(this, physical, () => original.call(this, physical, projection));
	});
	wrap("_checkCompaction", (original) => function (message, ...args) {
		if (!owned()) return original.call(this, message, ...args);
		return withPhysical(this, this._modelForMessage(message) ?? this.model, () => original.call(this, message, ...args));
	});
	for (const name of ["_runAutoCompaction", "compact"]) {
		wrap(name, (original) => function (...args) {
			if (!owned()) return original.apply(this, args);
			if (name === "compact") {
				const session = this;
				// Native compact aborts the current run before reading settings. Read its response limits then, not now.
				return physicalScope.run({ agent: this.agent, session, get physical() { return session._limitsModel(); } },
					() => original.apply(this, args));
			}
			const scope = physicalScope.getStore();
			const physical = scope?.session === this ? scope.physical : this._limitsModel();
			return withPhysical(this, physical, () => original.apply(this, args));
		});
	}
	wrap("_runDefaultCompaction", (original) => function (preparation: Preparation, ...args) {
		if (!owned()) return original.call(this, preparation, ...args);
		// Keep the interception hook's preparation intact. Only the native default summary rebinds its reserve.
		const summaryPreparation = { ...preparation, settings: { ...preparation.settings } };
		return physicalScope.run({ agent: this.agent, session: this, preparation: summaryPreparation },
			() => original.call(this, summaryPreparation, ...args));
	});
	wrap("_getSummarizationRequestAuth", (original) => async function (model, signal) {
		const request = await original.call(this, model, signal);
		const scope = physicalScope.getStore();
		if (owned() && scope?.session === this && scope.preparation && model && isVirtual(model)) {
			const settings = withPhysical(this, request.model, () => this.settingsManager.getCompactionSettings(model)) as CompactionSettings;
			scope.preparation.settings.reserveTokens = settings.reserveTokens;
		}
		return request;
	});
	proto[WRAPPED_ROUTING] = true;
}

export default function context(pi: ExtensionAPI) {
	const settings: SettingsPrototype = SettingsManager.prototype;
	const session = AgentSession.prototype as unknown as RoutingPrototype;
	const runtime = ModelRuntime.prototype as ModelRuntime & Record<symbol, any>;
	const modelDescriptor = Object.getOwnPropertyDescriptor(session, "model");
	const physicalDescriptor = Object.getOwnPropertyDescriptor(runtime, "getPhysicalModel");
	const buildDescriptor = Object.getOwnPropertyDescriptor(session, "_buildRuntime");
	const settingsDescriptor = Object.getOwnPropertyDescriptor(settings, "getCompactionSettings");
	const missing = [
		(typeof buildDescriptor?.value !== "function" || !buildDescriptor.configurable || !buildDescriptor.writable) && "AgentSession._buildRuntime",
		(typeof modelDescriptor?.get !== "function" || !modelDescriptor.configurable) && "AgentSession.model getter",
		(typeof settingsDescriptor?.value !== "function" || !settingsDescriptor.configurable || !settingsDescriptor.writable) && "SettingsManager.getCompactionSettings",
		...Object.entries(ROUTING_METHODS).filter(([name, arity]) => {
			const descriptor = Object.getOwnPropertyDescriptor(session, name);
			return typeof descriptor?.value !== "function" || !descriptor.configurable || !descriptor.writable ||
				(!session[WRAPPED_ROUTING] && descriptor.value.length !== arity);
		}).map(([name]) => `AgentSession.${name}`),
		(typeof physicalDescriptor?.value !== "function" || !physicalDescriptor.configurable || !physicalDescriptor.writable ||
			(!runtime[WRAPPED_PHYSICAL] && physicalDescriptor.value.length !== 2)) && "ModelRuntime.getPhysicalModel",
		(!Object.isExtensible(session) || !Object.isExtensible(settings) || !Object.isExtensible(runtime)) && "extensible native prototypes",
	].filter(Boolean);
	if (missing.length > 0) {
		throw new Error(`RQW-context: ${missing.join(" and ")} not found; the 500 000 window rule is built for Pi 1.3.0, nothing is changed`);
	}
	wrapCompactionSettings(settings);
	wrapModelGetter(session, modelDescriptor!);
	wrapSessionModel(session);
	wrapRouting(session, runtime);
	const token = {};
	(owners[OWNER] ??= new Set()).add(token);
	// Removing only this factory's token preserves concurrent sessions and renewed runtimes.
	pi.on("session_shutdown", () => {
		owners[OWNER]?.delete(token);
	});
}
