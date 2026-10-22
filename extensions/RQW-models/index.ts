import { getSupportedThinkingLevels, type Model } from "@earendil-works/pi-ai";
import { AgentSession, parseArgs, type ExtensionAPI, type ExtensionContext, type ModelRuntime } from "@earendil-works/pi-coding-agent";

export const FAMILIES = [
	"claude-opus-5-5", "claude-sonnet-5-5", "gpt-6.1-sol", "gpt-6-sol", "claude-haiku-5-5", "gpt-5.6-luna", "gpt-6-luna",
] as const;
const ORDER = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
type Level = typeof ORDER[number];
type ChatModel = Model<string>;
// OMP reasoning-arrows ORDER/CAPS intersected with its canonical model efforts.
const FAMILY_LEVELS: Record<typeof FAMILIES[number], readonly Level[]> = {
	"claude-opus-5-5": ["low", "medium", "high"],
	"claude-sonnet-5-5": ["low", "medium", "high", "xhigh"],
	"gpt-6.1-sol": ["low", "medium", "high", "xhigh", "max"],
	"gpt-6-sol": ["low", "medium", "high", "xhigh", "max"],
	"claude-haiku-5-5": ["low", "medium", "high", "xhigh", "max"],
	"gpt-5.6-luna": ["low", "medium", "high", "xhigh", "max"],
	"gpt-6-luna": ["low", "medium", "high", "xhigh", "max"],
};

/** Match the same generation, including proxy paths, dated aliases and Bedrock IDs. */
export function familyOf(model: ChatModel): number {
	const claude = model.id.match(/(?:^|[/.])claude-(opus|sonnet|haiku)-5[.-]5(?:-\d{8})?(?:-v\d+:\d+)?$/i);
	const id = claude ? `claude-${claude[1].toLowerCase()}-5-5` : model.id.split("/").at(-1)?.toLowerCase();
	return FAMILIES.indexOf(id as typeof FAMILIES[number]);
}

export function levelsFor(model: ChatModel | undefined): Level[] {
	if (!model) return [];
	const supported = getSupportedThinkingLevels(model);
	const family = FAMILIES[familyOf(model)];
	return family
		? FAMILY_LEVELS[family].filter((level) => supported.includes(level))
		: supported.filter((level): level is Level => level !== "off" && level !== "minimal");
}

export function pickerModels(models: ChatModel[]): ChatModel[] {
	const sorted = models.filter((model) => familyOf(model) >= 0).sort((a, b) => {
		const family = familyOf(a) - familyOf(b);
		if (family) return family;
		const preferred = familyOf(a) === 0 || familyOf(a) === 1 || familyOf(a) === 4 ? "anthropic" : "openai-codex";
		const rank = (model: ChatModel) => Number(model.provider !== preferred) * 2 + Number(model.id !== FAMILIES[familyOf(model)]);
		return rank(a) - rank(b) || `${a.provider}/${a.id}`.localeCompare(`${b.provider}/${b.id}`, "en");
	});
	return sorted.filter((model, index) => index === 0 || familyOf(model) !== familyOf(sorted[index - 1]));
}

function nearestLevel(model: ChatModel, current: Level): Level | undefined {
	const levels = levelsFor(model);
	return levels.filter((level) => ORDER.indexOf(level) <= ORDER.indexOf(current)).at(-1) ?? levels[0];
}

/** Any provider variant of the listed families may be selected or requested; nothing else. */
export const isListed = (model: { id: string } | undefined) => !!model && familyOf(model as ChatModel) >= 0;
const name = (model: { provider: string; id: string }) => `${model.provider}/${model.id}`;
export const notListed = (model: { provider: string; id: string }) =>
	`${name(model)} is not in the RQW models list. Allowed: ${FAMILIES.join(", ")}.`;

// Instance-level masks: own properties shadow Pi's prototype (and any other extension's prototype
// patches, which keep running underneath) and are deleted when the last owner releases them.
type Mask = { count: number; restore: () => void; cleanups: Set<() => void>; warn?: (text: string) => void };
const SESSION_MASK = Symbol.for("rqw-models/session-mask");
const RUNTIME_MASK = Symbol.for("rqw-models/runtime-mask");
type Masked = { [key: symbol]: Mask | undefined };

function override(target: object, props: Record<string, PropertyDescriptor>): () => void {
	const saved = Object.keys(props).map((key) => [key, Object.getOwnPropertyDescriptor(target, key)] as const);
	for (const [key, descriptor] of Object.entries(props)) Object.defineProperty(target, key, { configurable: true, ...descriptor });
	return () => {
		for (const [key, descriptor] of saved) {
			if (descriptor) Object.defineProperty(target, key, descriptor);
			else Reflect.deleteProperty(target, key);
		}
	};
}

function lease(target: object, key: symbol, install: (mask: Mask) => () => void): [Mask, () => void] {
	const holder = target as Masked;
	let mask = holder[key];
	if (!mask) {
		const created: Mask = { count: 0, restore: () => {}, cleanups: new Set() };
		created.restore = install(created);
		Object.defineProperty(target, key, { value: created, configurable: true });
		mask = created;
	}
	mask.count++;
	const owned = mask;
	let released = false;
	return [owned, () => {
		if (released) return;
		released = true;
		if (--owned.count) return;
		Reflect.deleteProperty(target, key);
		owned.restore();
	}];
}

/** Pi 1.4.0 gives extensions no session handle; borrow it for one synchronous call. */
function sessionOf(ctx: ExtensionContext): AgentSession | undefined {
	const prototype = AgentSession.prototype;
	const descriptor = Object.getOwnPropertyDescriptor(prototype, "getContextUsage");
	if (typeof descriptor?.value !== "function" || !descriptor.configurable) return undefined;
	let captured: unknown;
	Object.defineProperty(prototype, "getContextUsage", { ...descriptor, value(this: unknown) { captured = this; return undefined; } });
	try { ctx.getContextUsage(); } catch { captured = undefined; } finally { Object.defineProperty(prototype, "getContextUsage", descriptor); }
	const session = captured as AgentSession | undefined;
	return session && session.sessionManager === ctx.sessionManager && session.modelRuntime ? session : undefined;
}

function maskRuntime(runtime: ModelRuntime) {
	const prototype = () => Object.getPrototypeOf(runtime) as ModelRuntime;
	return lease(runtime, RUNTIME_MASK, () => override(runtime, {
		// Stock /model, Ctrl+L, Ctrl+P, autocomplete, /scoped-models, /settings and RPC read this snapshot.
		getAvailableSnapshot: { value: () => [], writable: true },
		// Every request on this runtime, including in-process subagents and reviewers, passes here.
		prepareRequest: { writable: true, value: async function(this: ModelRuntime, ...args: Parameters<ModelRuntime["prepareRequest"]>) {
			const [model] = args;
			if ((model.type ?? "chat") === "chat" && !isListed(model)) throw new Error(`RQW-models refused the request: ${notListed(model)}`);
			return prototype().prepareRequest.apply(this, args);
		} },
	}));
}

function maskSession(session: AgentSession) {
	const prototype = () => Object.getPrototypeOf(session) as AgentSession;
	return lease(session, SESSION_MASK, (mask) => override(session, {
		scopedModels: { get: () => [] },
		setModel: { writable: true, value: async function(this: AgentSession, ...args: Parameters<AgentSession["setModel"]>) {
			if (!isListed(args[0])) {
				mask.warn?.(notListed(args[0]));
				throw new Error(notListed(args[0]));
			}
			return prototype().setModel.apply(this, args);
		} },
		// SDK hosts may dispose without session_shutdown.
		dispose: { writable: true, value: function(this: AgentSession) {
			for (const cleanup of [...mask.cleanups]) cleanup();
			return prototype().dispose.call(this);
		} },
	}));
}

export default function modelsExtension(pi: ExtensionAPI) {
	// Event contexts have live getters; the TUI shortcut dispatcher passes snapshots.
	let liveContext: ExtensionContext;
	// Pi invokes shortcut handlers without awaiting the previous press.
	let pending = Promise.resolve();
	const enqueue = (action: () => Promise<void>) => {
		const result = pending.then(action);
		pending = result.catch(() => {});
		return result;
	};
	// The masked snapshot is Pi's credential-aware availability (provider filterModels included); read it
	// through the prototype, so other extensions' prototype filters still apply. Unbound: Pi's own list.
	const available = (ctx: ExtensionContext) => {
		const runtime = bound?.session.modelRuntime;
		return pickerModels(runtime
			? (Object.getPrototypeOf(runtime) as ModelRuntime).getAvailableSnapshot.call(runtime)
			: ctx.modelRegistry.getAvailable());
	};
	// session_start can run while an availability pass started by a provider registration is pending;
	// query each provider directly: a whole-runtime getAvailable pass can be superseded by a background
	// refresh and return the old shared snapshot. Provider-scoped reads return their own auth/filter results.
	// At most 15 s like Pi's model selector; on a timeout or error the snapshot is used.
	const settled = async (ctx: ExtensionContext) => {
		const runtime = bound?.session.modelRuntime;
		if (!runtime) return available(ctx);
		try {
			const signal = AbortSignal.timeout(15_000);
			return pickerModels((await Promise.all(runtime.getProviders().map((provider) => runtime.getAvailable(provider.id, { signal })))).flat());
		} catch { return available(ctx); }
	};
	const warn = (ctx: ExtensionContext, text: string, fallback = false) => {
		try {
			if (ctx.hasUI) ctx.ui.notify(text, "warning");
			else if (fallback) process.stderr.write(`Warning: ${text}\n`);
		} catch {}
	};
	let bound: { session: AgentSession; release: () => void } | undefined;
	const unbind = () => { bound?.release(); bound = undefined; };
	const bind = (ctx: ExtensionContext) => {
		const session = sessionOf(ctx);
		if (!session) {
			unbind();
			warn(ctx, "RQW-models cannot restrict Pi's own model selection: incompatible Pi internals (requires Pi 1.4.0)", true);
			return;
		}
		if (bound?.session === session) return;
		unbind();
		const [sessionMask, releaseSession] = maskSession(session);
		const [, releaseRuntime] = maskRuntime(session.modelRuntime);
		const release = () => { sessionMask.cleanups.delete(release); releaseRuntime(); releaseSession(); };
		sessionMask.cleanups.add(release);
		sessionMask.warn = (text) => warn(ctx, text);
		bound = { session, release };
	};
	const select = async (ctx: ExtensionContext, model: ChatModel, level = pi.getThinkingLevel()) => {
		if (!(await pi.setModel(model))) {
			if (ctx.hasUI) ctx.ui.notify(`No authentication for ${model.provider}/${model.id}`, "warning");
			return;
		}
		const next = nearestLevel(model, level);
		if (next) pi.setThinkingLevel(next);
	};
	const cycleModel = (ctx: ExtensionContext, direction: number) => enqueue(async () => {
		const models = available(ctx);
		const currentModel = liveContext.model;
		const currentFamily = currentModel ? familyOf(currentModel) : -1;
		const index = models.findIndex((model) => familyOf(model) === currentFamily);
		// Display order is strongest first; positive direction increases strength.
		const next = index < 0 ? (direction > 0 ? 0 : models.length - 1) : Math.max(0, Math.min(models.length - 1, index - direction));
		if (next === index || !models[next]) return;
		await select(ctx, models[next]);
	});
	const cycleThinking = (direction: number) => enqueue(async () => {
		const levels = levelsFor(liveContext.model);
		const current = ORDER.indexOf(pi.getThinkingLevel());
		const next = direction > 0
			? levels.find((level) => ORDER.indexOf(level) > current) ?? levels.at(-1)
			: levels.findLast((level) => ORDER.indexOf(level) < current) ?? levels[0];
		if (next) pi.setThinkingLevel(next);
	});
	// Shift+Left/Right change reasoning, Shift+Up/Down change the model; Up is stronger, Right is more effort.
	for (const [key, direction] of [["shift+right", 1], ["shift+left", -1]] as const) {
		pi.registerShortcut(key, {
			description: direction > 0 ? "RQW: increase reasoning" : "RQW: decrease reasoning",
			handler: () => cycleThinking(direction),
		});
	}
	for (const [key, direction] of [["shift+up", 1], ["shift+down", -1]] as const) {
		pi.registerShortcut(key, {
			description: direction > 0 ? "RQW: stronger model" : "RQW: weaker model",
			handler: (ctx) => cycleModel(ctx, direction),
		});
	}
	pi.registerCommand("rqw-models", {
		description: "Select an authenticated RQW model",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) return;
			const models = available(ctx);
			if (!models.length) {
				ctx.ui.notify("No authenticated RQW models available", "warning");
				return;
			}
			const labels = models.map((model) => `${model.provider}/${model.id}`);
			const chosen = await ctx.ui.select("RQW models", labels);
			const model = models[labels.indexOf(chosen ?? "")];
			if (model) await enqueue(() => select(ctx, model));
		},
	});
	const applyThinking = (thinking: Level | undefined) => {
		if (thinking) pi.setThinkingLevel(thinking);
		else {
			const currentModel = liveContext.model;
			const next = currentModel && nearestLevel(currentModel, "medium");
			if (next) pi.setThinkingLevel(next);
		}
	};
	// pi.setModel first checks the same possibly stale configured-auth snapshot. The owning session's
	// setModel checks real auth asynchronously, retains the list guard and emits the normal selection event.
	const setStartupModel = async (model: ChatModel) => {
		if (!bound) return pi.setModel(model);
		await bound.session.setModel(model);
		return true;
	};
	const startDefault = async (reason: string, ctx: ExtensionContext, args: ReturnType<typeof parseArgs>, models: () => Promise<ChatModel[]>) => {
		if (reason !== "startup" && reason !== "new") return;
		if (reason === "startup") {
			if (args.continue || args.resume || args.session) return;
			if (ctx.sessionManager.getBranch().some((entry) => entry.type === "message" || entry.type === "compaction" || entry.type === "branch_summary")) return;
		}
		// Pi has already resolved model patterns, scoped suffixes and thinking precedence.
		if (args.model !== undefined || args.models !== undefined) return;
		const opus = (await models()).find((model) => familyOf(model) === 0);
		if (opus && !(await setStartupModel(opus))) return;
		applyThinking(args.thinking);
	};
	pi.on("session_start", async (event, ctx) => {
		liveContext = ctx;
		bind(ctx);
		const args = parseArgs(process.argv.slice(2));
		// Only an actual choice waits for the availability pass.
		let pass: Promise<ChatModel[]> | undefined;
		const models = () => pass ??= settled(ctx);
		await startDefault(event.reason, ctx, args, models);
		// CLI --model/--models, a saved default or a restored session may name a model outside the list.
		const current = liveContext.model;
		if (!current || isListed(current)) return;
		const fallback = (await models())[0];
		if (!fallback || !(await setStartupModel(fallback))) {
			warn(ctx, `${notListed(current)} No listed model is authenticated; its requests are refused.`, true);
			return;
		}
		applyThinking(event.reason === "startup" || event.reason === "new" ? args.thinking : undefined);
		warn(ctx, `${notListed(current)} Switched to ${name(fallback)} (${pi.getThinkingLevel()}).`, true);
	});
	pi.on("session_shutdown", () => unbind());
}
