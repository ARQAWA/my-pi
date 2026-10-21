import { getSupportedThinkingLevels, type Model } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export const FAMILIES = [
	"claude-opus-5-5", "claude-sonnet-5-5", "gpt-6.1-sol", "gpt-6-sol", "gpt-6-luna", "claude-haiku-5-5",
] as const;
const ORDER = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
type Level = typeof ORDER[number];
type ChatModel = Model<string>;

/** Match the same generation, including proxy paths, dated aliases and Bedrock IDs. */
export function familyOf(model: ChatModel): number {
	const claude = model.id.match(/(?:^|[/.])claude-(opus|sonnet|haiku)-5[.-]5(?:-\d{8})?(?:-v\d+:\d+)?$/i);
	const id = claude ? `claude-${claude[1].toLowerCase()}-5-5` : model.id.split("/").at(-1)?.toLowerCase();
	return FAMILIES.indexOf(id as typeof FAMILIES[number]);
}

export function levelsFor(model: ChatModel | undefined): Level[] {
	return model ? getSupportedThinkingLevels(model).filter((level): level is Level => level !== "off" && level !== "minimal") : [];
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

function cliValue(name: string): string | undefined {
	const args = process.argv.slice(2);
	let value: string | undefined;
	for (let i = 0; i < args.length; i++) {
		if (args[i] === name) value = args[i + 1];
		else if (args[i].startsWith(`${name}=`)) value = args[i].slice(name.length + 1);
	}
	return value;
}

export default function modelsExtension(pi: ExtensionAPI) {
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
		const currentFamily = ctx.model ? familyOf(ctx.model) : -1;
		const index = models.findIndex((model) => familyOf(model) === currentFamily);
		const next = index < 0 ? (direction > 0 ? 0 : models.length - 1) : Math.max(0, Math.min(models.length - 1, index + direction));
		if (next === index || !models[next]) return;
		await select(ctx, models[next]);
	});
	const cycleThinking = (ctx: ExtensionContext, direction: number) => enqueue(async () => {
		const levels = levelsFor(ctx.model);
		const current = ORDER.indexOf(pi.getThinkingLevel());
		const next = direction > 0
			? levels.find((level) => ORDER.indexOf(level) > current) ?? levels.at(-1)
			: levels.findLast((level) => ORDER.indexOf(level) < current) ?? levels[0];
		if (next) pi.setThinkingLevel(next);
	});
	for (const [key, direction] of [["alt+=", 1], ["alt+-", -1]] as const) {
		pi.registerShortcut(key, {
			description: direction > 0 ? "RQW: next model" : "RQW: previous model",
			handler: (ctx) => cycleModel(ctx, direction),
		});
	}
	// Legacy terminals send ESC + '+'/'_', without a separate Shift modifier.
	for (const [key, direction] of [["alt+shift+=", 1], ["alt+shift+-", -1], ["alt++", 1], ["alt+_", -1], ["alt+shift++", 1], ["alt+shift+_", -1]] as const) {
		pi.registerShortcut(key, {
			description: direction > 0 ? "RQW: increase reasoning" : "RQW: decrease reasoning",
			handler: (ctx) => cycleThinking(ctx, direction),
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
		if (event.reason !== "startup" && event.reason !== "new") return;
		if (event.reason === "startup") {
			const args = process.argv.slice(2);
			if (args.some((arg) => ["--continue", "-c", "--resume", "-r", "--session"].includes(arg) || arg.startsWith("--session="))) return;
			if (ctx.sessionManager.getBranch().some((entry) => entry.type === "message" || entry.type === "compaction" || entry.type === "branch_summary")) return;
		}
		const explicitModel = cliValue("--model") !== undefined || cliValue("--models") !== undefined;
		const requestedThinking = cliValue("--thinking") ?? cliValue("--model")?.match(/:(off|minimal|low|medium|high|xhigh|max)$/)?.[1];
		const explicitThinking = ORDER.find((level) => level === requestedThinking);
		const level = explicitThinking ?? "medium";
		if (!explicitModel) {
			const opus = available(ctx).find((model) => familyOf(model) === 0);
			if (opus && !(await pi.setModel(opus))) return;
		}
		// Explicit CLI thinking is left to Pi, including off/minimal and its native clamping.
		if (explicitThinking) pi.setThinkingLevel(level);
		else {
			const next = ctx.model && nearestLevel(ctx.model, level);
			if (next) pi.setThinkingLevel(next);
		}
	});
}
