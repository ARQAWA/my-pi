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
// that method is wrapped to return `contextWindow - (W - R)`, which is R once the window is W.
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

/** The reserveTokens that makes Pi's `contextWindow - reserveTokens` equal W - R; R itself for a window up to W. */
export function reserveFor(contextWindow: number): number {
	return contextWindow - contextRule(contextWindow).threshold;
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

type AgentState = { model: unknown };
const cappedStates = new WeakSet<AgentState>();

/** Every model assigned to this agent state, now and later, is stored through `capModel`. */
function capStateModel(state: AgentState): void {
	if (cappedStates.has(state)) return;
	let model = capModel(state.model);
	Object.defineProperty(state, "model", {
		configurable: true,
		enumerable: true,
		get: () => model,
		set: (next: unknown) => {
			model = capModel(next);
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

/** True when the user set reserveTokens: per model in `compaction.modelOverrides`, or for all models. */
function userSetReserve(manager: SettingsManager, model: NonNullable<CompactionModel>): boolean {
	const compaction = manager.getSettings().compaction;
	if (compaction?.reserveTokens !== undefined) return true;
	return compaction?.modelOverrides?.[`${model.provider}/${model.id}`]?.reserveTokens !== undefined;
}

// One wrap per class for the life of the process; a /reload runs the factory again and finds it in place.
const WRAPPED_SETTINGS = Symbol.for("rqw-context/getCompactionSettings");
const WRAPPED_SESSION = Symbol.for("rqw-context/_buildRuntime");
type SettingsPrototype = SettingsManager & { [WRAPPED_SETTINGS]?: GetCompactionSettings };
type BuildRuntime = (this: SessionInternals, ...args: unknown[]) => unknown;
// `_buildRuntime` is private in Pi's types; `agent` is set before the constructor calls it.
type SessionInternals = { agent: { state: AgentState }; _buildRuntime?: BuildRuntime; [WRAPPED_SESSION]?: BuildRuntime };

function wrapCompactionSettings(): void {
	const proto: SettingsPrototype = SettingsManager.prototype;
	if (proto[WRAPPED_SETTINGS]) return;
	const original = proto.getCompactionSettings;
	proto.getCompactionSettings = function getCompactionSettings(this: SettingsManager, model?: CompactionModel) {
		const settings = original.call(this, model);
		const contextWindow = contextWindowOf(model);
		// No model or no known window: Pi's own values; Pi skips its window checks for such models.
		if (!model || contextWindow === undefined || userSetReserve(this, model)) return settings;
		return { ...settings, reserveTokens: reserveFor(contextWindow) };
	};
	proto[WRAPPED_SETTINGS] = original;
}

function wrapSessionModel(): void {
	const proto = AgentSession.prototype as unknown as SessionInternals;
	if (proto[WRAPPED_SESSION]) return;
	const original = proto._buildRuntime;
	if (typeof original !== "function") {
		throw new Error("RQW-context: AgentSession._buildRuntime not found; the 500 000 window cap is built for Pi 1.3.0");
	}
	proto._buildRuntime = function _buildRuntime(this: SessionInternals, ...args: unknown[]) {
		capStateModel(this.agent.state);
		return original.apply(this, args);
	};
	proto[WRAPPED_SESSION] = original;
}

export default function context(_pi: ExtensionAPI) {
	wrapCompactionSettings();
	wrapSessionModel();
}
