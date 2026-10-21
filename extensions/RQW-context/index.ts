// Extension 4: the context window and the compaction threshold. W = min(model.contextWindow, 500000),
// R = round(W / 10); Pi uses W as the model's context window and compacts when context tokens exceed W - R, for every
// model, without a per-model list.
//
// The window: Pi reads every limit from the session model `agent.state.model` (compaction trigger, overflow check,
// context usage, the output cap of a request, summaries). The extension API cannot change that object, so each
// session's agent state gets a `model` accessor that stores a copy with contextWindow 500 000 for a model above it.
// It is installed from `AgentSession._buildRuntime`, which Pi runs in the session constructor and on `/reload`.
// A model up to 500 000 is stored as the same object.
//
// The reserve: Pi triggers at `contextTokens > model.contextWindow - reserveTokens` and reads reserveTokens from
// `SettingsManager.getCompactionSettings(model)` at every check (`pi.getSettings()` returns a copy, no setter), so
// that method is wrapped to return `contextWindow - (W - R)`, which is R once the window is W. A reserve the user set
// counts against W, unless it is W or more (no positive threshold left), then R applies. Virtual models keep Pi's own
// values: Pi checks their threshold against the routed physical model's window.
// Both internals are checked before either is patched, so a failed load changes nothing.
// The patches stay in Pi's classes for the life of the process, but act only while a loaded RQW-context owns them:
// the factory sets the owner, its session_shutdown clears it, so a /reload without the extension gives stock Pi.
// Design and proof: DECISIONS.md section Context.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { AgentSession, SettingsManager } from "@earendil-works/pi-coding-agent";

export const MAX_WINDOW = 500_000;
// `VIRTUAL_MODEL_API` in Pi's `core/virtual-models.js`; virtual models are out of scope (DECISIONS.md, Context).
const VIRTUAL_MODEL_API = "pi-virtual";

/** The owner's rule for a declared context window: effective window, reserve, and the compaction threshold. */
export function contextRule(contextWindow: number): { window: number; reserve: number; threshold: number } {
	const window = Math.min(contextWindow, MAX_WINDOW);
	// W / 10 is exact for an integer W; Math.round rounds a .5 up.
	const reserve = Math.round(window / 10);
	return { window, reserve, threshold: window - reserve };
}

/**
 * The reserveTokens that makes Pi's `contextWindow - reserveTokens` equal the threshold: W - userReserve for a reserve
 * the user set below W, else W - R. For the session model, whose window is already W, that is the reserve itself.
 */
export function reserveFor(contextWindow: number, userReserve?: number): number {
	const { window, threshold } = contextRule(contextWindow);
	const target = userReserve !== undefined && userReserve < window ? window - userReserve : threshold;
	return contextWindow - target;
}

// One copy per original model object, so repeated assignments of the same model give the same object.
const cappedCopies = new WeakMap<object, object>();

/** The model as the session uses it: the same object up to 500 000, a copy with contextWindow 500 000 above. */
export function capModel<T>(model: T): T {
	if (!model || typeof model !== "object") return model;
	const { api, contextWindow } = model as { api?: unknown; contextWindow?: unknown };
	if (api === VIRTUAL_MODEL_API || typeof contextWindow !== "number" || !(contextWindow > MAX_WINDOW)) return model;
	let copy = cappedCopies.get(model);
	if (!copy) {
		copy = { ...model, contextWindow: MAX_WINDOW };
		cappedCopies.set(model, copy);
	}
	return copy as T;
}

// The loaded RQW-context that owns the patches: a token per factory run, on globalThis because a /reload evaluates
// this module again while the patches of the first evaluation stay in place.
const OWNER = Symbol.for("rqw-context/owner");
const owners = globalThis as { [OWNER]?: object };
const owned = () => owners[OWNER] !== undefined;

type AgentState = { model: unknown };
const cappedStates = new WeakSet<AgentState>();

/** This agent state reads every model, now and later, through `capModel` while an owner is alive. */
function capStateModel(state: AgentState): void {
	if (cappedStates.has(state)) return;
	let model = state.model;
	Object.defineProperty(state, "model", {
		configurable: true,
		enumerable: true,
		get: () => (owned() ? capModel(model) : model),
		set: (next: unknown) => {
			model = next;
		},
	});
	cappedStates.add(state);
}

type GetCompactionSettings = SettingsManager["getCompactionSettings"];
type CompactionModel = Parameters<GetCompactionSettings>[0];

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

// One wrap per class for the life of the process; a /reload runs the factory again and finds it in place. Without an
// owner both wraps pass Pi's own values through.
const WRAPPED_SETTINGS = Symbol.for("rqw-context/getCompactionSettings");
const WRAPPED_SESSION = Symbol.for("rqw-context/_buildRuntime");
type SettingsPrototype = SettingsManager & { [WRAPPED_SETTINGS]?: GetCompactionSettings };
type BuildRuntime = (this: SessionInternals, ...args: unknown[]) => unknown;
// `_buildRuntime` is private in Pi's types; `agent` is set before the constructor calls it.
type SessionInternals = { agent: { state: AgentState }; _buildRuntime?: BuildRuntime; [WRAPPED_SESSION]?: BuildRuntime };

function wrapCompactionSettings(proto: SettingsPrototype): void {
	if (proto[WRAPPED_SETTINGS]) return;
	const original = proto.getCompactionSettings;
	proto.getCompactionSettings = function getCompactionSettings(this: SettingsManager, model?: CompactionModel) {
		const settings = original.call(this, model);
		const contextWindow = contextWindowOf(model);
		// No owner, no model, no known window, or a virtual model: Pi's own values, as stock Pi.
		if (!owned() || !model || contextWindow === undefined || isVirtual(model)) return settings;
		const userReserve = userSetReserve(this, model) ? settings.reserveTokens : undefined;
		return { ...settings, reserveTokens: reserveFor(contextWindow, userReserve) };
	};
	proto[WRAPPED_SETTINGS] = original;
}

function wrapSessionModel(proto: SessionInternals): void {
	if (proto[WRAPPED_SESSION]) return;
	const original = proto._buildRuntime as BuildRuntime;
	proto._buildRuntime = function _buildRuntime(this: SessionInternals, ...args: unknown[]) {
		if (owned()) capStateModel(this.agent.state);
		return original.apply(this, args);
	};
	proto[WRAPPED_SESSION] = original;
}

export default function context(pi: ExtensionAPI) {
	const settings: SettingsPrototype = SettingsManager.prototype;
	const session = AgentSession.prototype as unknown as SessionInternals;
	const missing = [
		typeof session._buildRuntime !== "function" && "AgentSession._buildRuntime",
		typeof settings.getCompactionSettings !== "function" && "SettingsManager.getCompactionSettings",
	].filter(Boolean);
	if (missing.length > 0) {
		throw new Error(
			`RQW-context: ${missing.join(" and ")} not found; the 500 000 window rule is built for Pi 1.3.0, nothing is changed`,
		);
	}
	wrapCompactionSettings(settings);
	wrapSessionModel(session);
	// Pi emits session_shutdown before it loads the extensions of the next runtime (reload, new, resume, fork), so the
	// next factory run, or none when the extension is switched off, decides. The token keeps a late shutdown of the
	// old runtime from clearing a newer owner.
	const token = {};
	owners[OWNER] = token;
	pi.on("session_shutdown", () => {
		if (owners[OWNER] === token) delete owners[OWNER];
	});
}
