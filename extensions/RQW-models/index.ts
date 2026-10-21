import { getSupportedThinkingLevels, type Model } from "@earendil-works/pi-ai";
import { parseArgs, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";

export const FAMILIES = [
	"claude-opus-5-5", "claude-sonnet-5-5", "gpt-6.1-sol", "gpt-6-sol", "gpt-6-luna", "claude-haiku-5-5",
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
	"gpt-6-luna": ["low", "medium", "high", "xhigh", "max"],
	"claude-haiku-5-5": ["low", "medium", "high", "xhigh", "max"],
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
		const preferred = familyOf(a) === 0 || familyOf(a) === 1 || familyOf(a) === 5 ? "anthropic" : "openai-codex";
		const rank = (model: ChatModel) => Number(model.provider !== preferred) * 2 + Number(model.id !== FAMILIES[familyOf(model)]);
		return rank(a) - rank(b) || `${a.provider}/${a.id}`.localeCompare(`${b.provider}/${b.id}`, "en");
	});
	return sorted.filter((model, index) => index === 0 || familyOf(model) !== familyOf(sorted[index - 1]));
}

function nearestLevel(model: ChatModel, current: Level): Level | undefined {
	const levels = levelsFor(model);
	return levels.filter((level) => ORDER.indexOf(level) <= ORDER.indexOf(current)).at(-1) ?? levels[0];
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
	const available = (ctx: ExtensionContext) => pickerModels(ctx.modelRegistry.getAvailable());
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
	for (const [key, direction] of [["alt+=", 1], ["alt+-", -1]] as const) {
		pi.registerShortcut(key, {
			description: direction > 0 ? "RQW: stronger model" : "RQW: weaker model",
			handler: (ctx) => cycleModel(ctx, direction),
		});
	}
	// Legacy terminals send ESC + '+'/'_', without a separate Shift modifier.
	for (const [key, direction] of [["alt+shift+=", 1], ["alt+shift+-", -1], ["alt++", 1], ["alt+_", -1], ["alt+shift++", 1], ["alt+shift+_", -1]] as const) {
		pi.registerShortcut(key, {
			description: direction > 0 ? "RQW: increase reasoning" : "RQW: decrease reasoning",
			handler: () => cycleThinking(direction),
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
	pi.on("session_start", async (event, ctx) => {
		liveContext = ctx;
		if (event.reason !== "startup" && event.reason !== "new") return;
		const args = parseArgs(process.argv.slice(2));
		if (event.reason === "startup") {
			if (args.continue || args.resume || args.session) return;
			if (ctx.sessionManager.getBranch().some((entry) => entry.type === "message" || entry.type === "compaction" || entry.type === "branch_summary")) return;
		}
		// Pi has already resolved model patterns, scoped suffixes and thinking precedence.
		if (args.model !== undefined || args.models !== undefined) return;
		const opus = available(ctx).find((model) => familyOf(model) === 0);
		if (opus && !(await pi.setModel(opus))) return;
		if (args.thinking) pi.setThinkingLevel(args.thinking);
		else {
			const currentModel = liveContext.model;
			const next = currentModel && nearestLevel(currentModel, "medium");
			if (next) pi.setThinkingLevel(next);
		}
	});
}
