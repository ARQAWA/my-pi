// Reads the `json coordinator-rules` block of PROCESS.md. Any problem is an error: the guard fails closed on it.
import { readFileSync } from "node:fs";
import { randomInt } from "node:crypto";

export const THINKING = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

export type Pair = [model: string, thinking: string];
export type Rules = {
	agentModels: Record<string, Pair[]>;
	reviewerProfiles: Record<string, Pair>;
	/** Most direct starts of Main per model at one time; a model without an entry has no limit. */
	slots: Record<string, number>;
};

const FENCE = /^```json coordinator-rules[ \t]*\r?\n([\s\S]*?)^```[ \t]*$/gm;

function parsePair(pair: any, where: string): Pair {
	if (!Array.isArray(pair) || pair.length !== 2) throw new Error(`${where} must be [model, thinking]`);
	const [model, thinking] = pair;
	if (typeof model !== "string" || !/^[^/\s]+\/\S+$/.test(model)) throw new Error(`${where}: model must be "provider/id"`);
	if (typeof thinking !== "string" || !(THINKING as readonly string[]).includes(thinking)) {
		throw new Error(`${where}: thinking must be one of ${THINKING.join(", ")}`);
	}
	return [model, thinking];
}

export function parseRules(markdown: string): Rules {
	const blocks = [...markdown.matchAll(FENCE)];
	if (blocks.length === 0) throw new Error("no ```json coordinator-rules block found");
	if (blocks.length > 1) throw new Error(`${blocks.length} coordinator-rules blocks found; keep exactly one`);
	let data: any;
	try {
		data = JSON.parse(blocks[0][1]);
	} catch (error) {
		throw new Error(`coordinator-rules is not valid JSON: ${(error as Error).message}`);
	}
	if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("coordinator-rules must be a JSON object");
	const models = data.agentModels;
	if (!models || typeof models !== "object" || Array.isArray(models)) throw new Error("agentModels must be an object of classes");
	const classes = Object.entries(models);
	if (classes.length === 0) throw new Error("agentModels has no classes");
	const agentModels: Record<string, Pair[]> = {};
	for (const [name, pairs] of classes) {
		if (!Array.isArray(pairs) || pairs.length === 0) throw new Error(`agentModels.${name} must be a non-empty array of [model, thinking] pairs`);
		agentModels[name] = pairs.map((pair, i) => parsePair(pair, `agentModels.${name}[${i}]`));
	}
	const reviewerProfiles: Record<string, Pair> = {};
	if (data.reviewerProfiles !== undefined) {
		if (!data.reviewerProfiles || typeof data.reviewerProfiles !== "object" || Array.isArray(data.reviewerProfiles)) {
			throw new Error("reviewerProfiles must be an object of [model, thinking] pairs");
		}
		for (const [name, pair] of Object.entries(data.reviewerProfiles)) {
			reviewerProfiles[name] = parsePair(pair, `reviewerProfiles.${name}`);
		}
	}
	return { agentModels, reviewerProfiles, slots: parseSlots(data.slots) };
}

function parseSlots(value: any): Record<string, number> {
	if (value === undefined) return {};
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("slots must be an object of model limits");
	const slots: Record<string, number> = {};
	for (const [model, limit] of Object.entries(value)) {
		if (!/^[^/\s]+\/\S+$/.test(model)) throw new Error(`slots.${model}: model must be "provider/id"`);
		if (!Number.isSafeInteger(limit) || (limit as number) < 0) throw new Error(`slots.${model} must be a non-negative integer`);
		slots[model] = limit as number;
	}
	return slots;
}

export type Loaded = { ok: true; rules: Rules } | { ok: false; error: string };

/** Reads the file fresh on every call, so an edit of the block takes effect on the next event without reload. */
export function loadRules(file: string): Loaded {
	try {
		return { ok: true, rules: parseRules(readFileSync(file, "utf8")) };
	} catch (error) {
		return { ok: false, error: (error as Error).message };
	}
}

/** Executors use table pairs; a named reviewer profile may instead use its own exact pair. */
export function isAllowed(rules: Rules, model: string, thinking: string, agentType?: string): boolean {
	const reviewerPair = agentType === undefined ? undefined : rules.reviewerProfiles[agentType];
	const inTable = reviewerPair === undefined && Object.values(rules.agentModels).some((pairs) => pairs.some(([m, t]) => m === model && t === thinking));
	const inReviewerProfile = reviewerPair?.[0] === model && reviewerPair[1] === thinking;
	return inTable || inReviewerProfile;
}

/** The category's permitted pairs, or undefined for an unknown category. */
export function categoryPairs(rules: Rules, category: string): Pair[] | undefined {
	return Object.hasOwn(rules.agentModels, category) ? rules.agentModels[category] : undefined;
}

/** Draw uniformly from the pairs whose model still has a free slot; undefined when none is free. */
export function drawPair(pairs: Pair[], isFree: (model: string) => boolean, random: (max: number) => number = randomInt): Pair | undefined {
	const free = pairs.filter(([model]) => isFree(model));
	return free.length ? free[random(free.length)] : undefined;
}

export function describeReviewerProfiles(rules: Rules): string {
	return Object.entries(rules.reviewerProfiles).map(([name, [model, thinking]]) => `${name}: ${model} ${thinking}`).join("; ");
}

/** The one allowed-pair rendering used in reasons, the prompt and child tasks. */
export function describePairs(rules: Rules): string {
	const classes: string[] = [];
	for (const [name, pairs] of Object.entries(rules.agentModels)) {
		const list = pairs.map(([model, thinking]) => `${model} ${thinking}`).join(", ");
		classes.push(`${name}: ${list}`);
	}
	return classes.join("; ");
}

/** The slot limits as rendered in the prompt. */
export function describeSlots(rules: Rules): string {
	return Object.entries(rules.slots).map(([model, limit]) => `${model} ${limit}`).join(", ");
}
