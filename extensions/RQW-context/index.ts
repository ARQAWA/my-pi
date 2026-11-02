// W = min(physical.contextWindow, 500000), R = round(W / 10), threshold W - R.
// Selection state and native canonical physical lookups expose stable capped copies, never mutate the catalog.
// Virtual selection stays native, including its unknown window. Request/check-local context supplies the physical
// reserve when Pi asks for the selection's settings. Preparation uses the triggering request/response (manual: latest
// successful response). Native Pi summaries use their model's output limit, not the compaction reserve.
// Explicit selection settings and native compaction policy still win. No owners means stock Pi again.
import { AsyncLocalStorage } from "node:async_hooks";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { AgentSession, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { type BackgroundSession, bindBackground, installBackground, maybeStart, ready, supersede } from "./background.ts";
import { installHook, isHooked } from "./hooks.ts";
import { compactSafeTail, installManagerProjection } from "./large-tail.ts";

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
	// A copy made under another module's cap is made again, so a reload that changes the rule applies it.
	if (!copy || (copy as { contextWindow?: number }).contextWindow !== MAX_WINDOW) {
		copy = { ...model, contextWindow: MAX_WINDOW };
		cappedCopies.set(model, copy);
		originals.set(copy, model);
	}
	return copy as T;
}

// The newest module instance's helpers. Agent hooks and state getters that an older instance left on running sessions
// call these, so a reload reaches sessions that are not rebuilt.
const LIVE = Symbol.for("rqw-context/live-helpers");
type Helpers = {
	capModel: typeof capModel; capStateModel: (state: AgentState) => void; wrapPrepareRequest: (agent: NativeAgent) => void;
	runRequest: <T>(agent: NativeAgent, run: () => T) => T;
};
const live = ((globalThis as { [LIVE]?: Helpers })[LIVE] ??= {} as Helpers);

// Live owners of the process-wide patches: one token per factory run, shared across module reloads.
const OWNER = Symbol.for("rqw-context/owner");
const owners = globalThis as { [OWNER]?: Set<object> };
const owned = () => (owners[OWNER]?.size ?? 0) > 0;

type GetCompactionSettings = SettingsManager["getCompactionSettings"];
type CompactionModel = Parameters<GetCompactionSettings>[0];
type AgentState = { model: unknown };
// Shared across module reloads: a state or request callback already capped by an older instance stays capped once.
const CAPPED = Symbol.for("rqw-context/capped-states");
const REQUEST_WRAPPERS = Symbol.for("rqw-context/request-wrappers");
const weak = globalThis as { [CAPPED]?: WeakSet<AgentState>; [REQUEST_WRAPPERS]?: WeakSet<Function> };
const cappedStates = (weak[CAPPED] ??= new WeakSet<AgentState>());
const requestWrappers = (weak[REQUEST_WRAPPERS] ??= new WeakSet<Function>());
// Pre-reload hooks of an older release marked the classes with these keys; they are not installed again over them.
const LEGACY_SESSION_HOOKS = Symbol.for("rqw-context/_buildRuntime");
const LEGACY_AGENT_HOOKS = Symbol.for("rqw-context/agent-state");
type NativeAgent = {
	state: AgentState;
	_state: AgentState;
	prepareRequest?: (...args: unknown[]) => unknown;
	createLoopConfig: (this: NativeAgent, ...args: unknown[]) => unknown;
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
};
type LimitScope = {
	request?: true;
	agent: NativeAgent;
	session?: SessionInternals;
	selectedModel?: CompactionModel;
	physical?: CompactionModel;
	/** A ready background summary: Pi's own threshold check says yes, so its normal path adopts it. */
	force?: boolean;
};
const SCOPE = Symbol.for("rqw-context/physical-scope");
const scopes = globalThis as { [SCOPE]?: AsyncLocalStorage<LimitScope> };
const physicalScope = (scopes[SCOPE] ??= new AsyncLocalStorage<LimitScope>());

/** Runs one request preparation in its physical scope while an owner is alive. */
function runRequest<T>(agent: NativeAgent, run: () => T): T {
	return owned() ? physicalScope.run({ agent, request: true }, run) : run();
}

/** Wrap the actual Agent's request callback, including old observers and callbacks replaced later by extensions. */
function wrapPrepareRequest(agent: NativeAgent): void {
	const original = agent.prepareRequest;
	if (typeof original !== "function" || requestWrappers.has(original)) return;
	const wrapped = function (this: NativeAgent, ...args: unknown[]) {
		return live.runRequest(agent, () => original.apply(this, args));
	};
	requestWrappers.add(wrapped);
	agent.prepareRequest = wrapped;
}

/** Use the session's actual Agent class: the CLI bundle has a different class from the library SDK. */
function wrapAgentState(agent: NativeAgent): void {
	const proto = Object.getPrototypeOf(agent) as NativeAgent;
	if (Object.hasOwn(proto, LEGACY_AGENT_HOOKS)) {
		wrapPrepareRequest(agent);
		return;
	}
	const descriptor = Object.getOwnPropertyDescriptor(proto, "state");
	const loopDescriptor = Object.getOwnPropertyDescriptor(proto, "createLoopConfig");
	if (
		!isHooked(proto, "state") && (
		!Object.isExtensible(proto) ||
		typeof descriptor?.get !== "function" || !descriptor.configurable || descriptor.set ||
		typeof loopDescriptor?.value !== "function" || !loopDescriptor.configurable ||
		!Object.hasOwn(agent, "_state") || descriptor.get.call(agent) !== agent._state ||
		!Object.getOwnPropertyDescriptor(agent._state, "model")?.configurable)
	) {
		throw new Error("RQW-context: native Agent.state/createLoopConfig shape differs from Pi 1.4.0");
	}
	installHook(proto, "state", "get", (original: () => AgentState) => function (this: NativeAgent) {
		const state = original.call(this);
		if (owned()) { live.capStateModel(state); live.wrapPrepareRequest(this); }
		return state;
	});
	installHook(proto, "createLoopConfig", "value", (original: NativeAgent["createLoopConfig"]) => function (this: NativeAgent, ...args: unknown[]) {
		if (owned()) { live.capStateModel(this._state); live.wrapPrepareRequest(this); }
		return original.apply(this, args);
	});
	wrapPrepareRequest(agent);
}

/** This agent state reads every model, now and later, through `capModel` while an owner is alive. */
function capStateModel(state: AgentState): void {
	if (cappedStates.has(state)) return;
	let model = declaredModel(state.model);
	Object.defineProperty(state, "model", {
		configurable: true,
		enumerable: true,
		get: () => (owned() ? live.capModel(model) : model),
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

// Each class gets one forwarding slot per process (`installHook`); /reload swaps what the slot runs. Without an owner, stock Pi.
function wrapCompactionSettings(proto: SettingsManager): void {
	installHook(proto, "getCompactionSettings", "value", (original: GetCompactionSettings) => function getCompactionSettings(this: SettingsManager, model?: CompactionModel) {
		const settings = original.call(this, model);
		if (!owned() || !model) return settings;
		const scope = physicalScope.getStore();
		const bound = scope?.session?.settingsManager === this && scope.selectedModel === model;
		const limits = bound ? scope!.physical : isVirtual(model) ? undefined : model;
		const contextWindow = contextWindowOf(limits);
		const explicitReserve = userSetReserve(this, model) ? settings.reserveTokens : undefined;
		return contextWindow === undefined || (limits && isVirtual(limits)) ? settings
			: { ...settings, reserveTokens: bound && scope!.force ? contextWindow : reserveFor(contextWindow, explicitReserve) };
	});
}

function wrapModelGetter(proto: SessionInternals): void {
	installHook(proto, "model", "get", (original: GetModel) => function (this: SessionInternals) {
		if (owned()) capStateModel(this.agent.state);
		return original.call(this);
	});
}

function wrapSessionModel(proto: SessionInternals): void {
	installHook(proto, "_buildRuntime", "value", (original: BuildRuntime) => function _buildRuntime(this: SessionInternals, ...args: unknown[]) {
		if (owned()) {
			wrapAgentState(this.agent);
			capStateModel(this.agent.state);
		}
		return original.apply(this, args);
	});
}

// Checked Pi 1.4.0 method boundaries, not rewritten compaction or routing implementations.
const ROUTING_METHODS = {
	_exceedsCompactionThreshold: 2, _checkCompaction: 1, _runAutoCompaction: 2, compact: 1,
	_modelForMessage: 1, _limitsModel: 0,
};
type NativeMethod = (this: SessionInternals, ...args: any[]) => any;
type RoutingPrototype = SessionInternals & Record<string | symbol, any>;

function withPhysical(session: SessionInternals, physical: CompactionModel, run: () => unknown, force?: boolean) {
	return physicalScope.run({ agent: session.agent, session, selectedModel: session.model, physical, force }, run);
}

const background = (session: SessionInternals) => session as unknown as BackgroundSession;

function wrapRouting(proto: RoutingPrototype, runtime: ModelRuntime): void {
	installHook(runtime, "getPhysicalModel", "value", (original: ModelRuntime["getPhysicalModel"]) => function (this: ModelRuntime, provider: string, id: string) {
		const model = original.call(this, provider, id);
		return owned() ? capModel(model) : model;
	});
	const wrap = (name: string, make: (original: NativeMethod) => NativeMethod) => installHook(proto, name, "value", make);
	wrap("_exceedsCompactionThreshold", (original) => function (model, projection) {
		if (!owned()) return original.call(this, model, projection);
		const physical = capModel(model);
		const request = physicalScope.getStore();
		// Bind only prepareRequest, never a compaction scope inherited by a queued prompt's continuation.
		if (request?.request && request.agent === this.agent) {
			request.session = this; request.selectedModel = this.model; request.physical = physical;
		}
		const force = ready(background(this));
		return withPhysical(this, physical, () => {
			const due = original.call(this, physical, projection);
			if (!due && !force) maybeStart(background(this), physical);
			return due;
		}, force);
	});
	wrap("_checkCompaction", (original) => function (message, ...args) {
		if (!owned()) return original.call(this, message, ...args);
		const physical = this._modelForMessage(message) ?? this.model;
		const force = ready(background(this));
		return withPhysical(this, physical, async () => {
			const result = await original.call(this, message, ...args);
			if (!force) maybeStart(background(this), physical);
			return result;
		}, force);
	});
	for (const name of ["_runAutoCompaction", "compact"]) {
		wrap(name, (original) => function (...args) {
			if (!owned()) return original.apply(this, args);
			const finishBackground = supersede(background(this), name === "compact" ? "manual" : args[0]);
			if (name === "compact") {
				const session = this;
				// Native compact aborts the current run before reading settings. Read its response limits then, not now.
				return physicalScope.run({ agent: this.agent, session,
					get selectedModel() { return session.model; }, get physical() { return session._limitsModel(); } },
					() => compactSafeTail(this, () => original.apply(this, args), "manual", false, args[0]));
			}
			const scope = physicalScope.getStore();
			const physical = scope?.session === this ? scope.physical : this._limitsModel();
			return Promise.resolve(withPhysical(this, physical,
				() => compactSafeTail(this, () => original.apply(this, args), args[0], args[1]))).finally(finishBackground);
		});
	}
}

export default function context(pi: ExtensionAPI) {
	Object.assign(live, { capModel, capStateModel, wrapPrepareRequest, runRequest });
	const settings = SettingsManager.prototype;
	const session = AgentSession.prototype as unknown as RoutingPrototype;
	const runtime = ModelRuntime.prototype;
	const modelDescriptor = Object.getOwnPropertyDescriptor(session, "model");
	const physicalDescriptor = Object.getOwnPropertyDescriptor(runtime, "getPhysicalModel");
	const buildDescriptor = Object.getOwnPropertyDescriptor(session, "_buildRuntime");
	const settingsDescriptor = Object.getOwnPropertyDescriptor(settings, "getCompactionSettings");
	// A process that started on an older release already holds its own hooks; only a restart replaces those.
	const legacy = Object.hasOwn(session, LEGACY_SESSION_HOOKS);
	const missing = legacy ? [] : [
		(typeof buildDescriptor?.value !== "function" || !buildDescriptor.configurable || !buildDescriptor.writable) && "AgentSession._buildRuntime",
		(typeof modelDescriptor?.get !== "function" || !modelDescriptor.configurable) && "AgentSession.model getter",
		(typeof settingsDescriptor?.value !== "function" || !settingsDescriptor.configurable || !settingsDescriptor.writable) && "SettingsManager.getCompactionSettings",
		...Object.entries(ROUTING_METHODS).filter(([name, arity]) => {
			const descriptor = Object.getOwnPropertyDescriptor(session, name);
			return typeof descriptor?.value !== "function" || !descriptor.configurable || !descriptor.writable ||
				(!isHooked(session, name) && descriptor.value.length !== arity);
		}).map(([name]) => `AgentSession.${name}`),
		(typeof physicalDescriptor?.value !== "function" || !physicalDescriptor.configurable || !physicalDescriptor.writable ||
			(!isHooked(runtime, "getPhysicalModel") && physicalDescriptor.value.length !== 2)) && "ModelRuntime.getPhysicalModel",
		(!Object.isExtensible(session) || !Object.isExtensible(settings) || !Object.isExtensible(runtime)) && "extensible native prototypes",
	].filter(Boolean);
	if (missing.length > 0) {
		throw new Error(`RQW-context: ${missing.join(" and ")} not found; the 500 000 window rule is built for Pi 1.4.0, nothing is changed`);
	}
	if (!legacy) {
		wrapCompactionSettings(settings);
		wrapModelGetter(session);
		wrapSessionModel(session);
		wrapRouting(session, runtime);
		installBackground(session, owned);
	}
	bindBackground((event, handler) => pi.on(event as "session_start", handler), pi.events);
	pi.on("session_start", (_event, ctx) => installManagerProjection(ctx.sessionManager, owned));
	const token = {};
	(owners[OWNER] ??= new Set()).add(token);
	installManagerProjection(SessionManager.inMemory(), owned);
	// Removing only this factory's token preserves concurrent sessions and renewed runtimes.
	pi.on("session_shutdown", () => {
		owners[OWNER]?.delete(token);
	});
}
