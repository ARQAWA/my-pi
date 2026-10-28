// Reads the `json coordinator-rules` block of PROCESS.md. Any problem is an error: the guard fails closed on it.
import { readFileSync } from "node:fs";
import { randomInt } from "node:crypto";

export const THINKING = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

export type Pair = [model: string, thinking: string];
/** Optional GPT-only override, active while now < untilMs. */
export type GptOnlyRestriction = { until: string; untilMs: number };
export type Rules = {
	agentModels: Record<string, Pair[]>;
	reviewerProfiles: Record<string, Pair>;
	temporaryGptOnly?: GptOnlyRestriction;
};

const GPT_MODEL = "openai-codex/gpt-6.1-sol";
const UTC_SECONDS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

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
	const rules: Rules = { agentModels, reviewerProfiles };
	// An absent key means no temporary restriction; a present key must parse.
	if (data.temporaryGptOnly !== undefined) rules.temporaryGptOnly = parseRestriction(data.temporaryGptOnly);
	return rules;
}

function parseRestriction(raw: any): GptOnlyRestriction {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
		throw new Error('temporaryGptOnly must be an object {"until": "...Z", "arbiterTitlePrefix": "..."}');
	}
	const { until } = raw;
	if (typeof until !== "string" || !UTC_SECONDS.test(until)) throw new Error('temporaryGptOnly.until must be a UTC time like "2026-10-28T16:00:00Z"');
	const untilMs = Date.parse(until);
	// Date.parse rolls an impossible date such as 02-30 over; the round trip rejects it.
	if (Number.isNaN(untilMs) || new Date(untilMs).toISOString().slice(0, 19) + "Z" !== until) throw new Error(`temporaryGptOnly.until is not a real date: ${until}`);
	return { until, untilMs };
}

export function restrictionActive(rules: Rules, now: number): boolean {
	return rules.temporaryGptOnly !== undefined && now < rules.temporaryGptOnly.untilMs;
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
export function isAllowed(rules: Rules, model: string, thinking: string, now: number, agentType?: string): boolean {
	const reviewerPair = agentType === undefined ? undefined : rules.reviewerProfiles[agentType];
	const inTable = reviewerPair === undefined && Object.values(rules.agentModels).some((pairs) => pairs.some(([m, t]) => m === model && t === thinking));
	const inReviewerProfile = reviewerPair?.[0] === model && reviewerPair[1] === thinking;
	return (inTable || inReviewerProfile) && (!restrictionActive(rules, now) || model === GPT_MODEL);
}

/** Draw uniformly from the category's currently permitted pairs. */
export function drawPair(rules: Rules, category: string, now: number, random: (max: number) => number = randomInt): Pair | undefined {
	const pairs = Object.hasOwn(rules.agentModels, category) ? rules.agentModels[category] : undefined;
	const allowed = pairs?.filter(([model, thinking]) => isAllowed(rules, model, thinking, now));
	return allowed?.length ? allowed[random(allowed.length)] : undefined;
}

export function describeReviewerProfiles(rules: Rules): string {
	return Object.entries(rules.reviewerProfiles).map(([name, [model, thinking]]) => `${name}: ${model} ${thinking}`).join("; ");
}

/** The one allowed-pair rendering used in reasons, the prompt and child tasks. */
export function describePairs(rules: Rules, now: number): string {
	const gptOnly = restrictionActive(rules, now);
	const classes: string[] = [];
	for (const [name, pairs] of Object.entries(rules.agentModels)) {
		const shown = gptOnly ? pairs.filter(([model]) => model === GPT_MODEL) : pairs;
		if (shown.length === 0) continue;
		const list = shown.map(([model, thinking]) => `${model} ${thinking}`).join(", ");
		classes.push(`${name}: ${list}`);
	}
	return classes.join("; ");
}

/** The temporary rule as one sentence group for the prompt and the child line; undefined once it has expired. */
export function restrictionText(rules: Rules, now: number): string | undefined {
	const restriction = rules.temporaryGptOnly;
	if (!restriction || !restrictionActive(rules, now)) return undefined;
	return `Temporary rule until ${restriction.until}: only the allowed ${GPT_MODEL} task pairs may be used. All Anthropic models are blocked, including benchmark arbiters. After that time the normal table applies again.`;
}
