// Reads the `json coordinator-rules` block of PROCESS.md. Any problem is an error: the guard fails closed on it.
import { readFileSync } from "node:fs";

export const THINKING = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

export type Pair = [model: string, thinking: string];
/** Optional. Absent means no temporary ban. Temporary ban of `OPUS_MODEL`: active while now < untilMs; a start whose title begins with arbiterTitlePrefix is exempt. */
export type OpusRestriction = { until: string; untilMs: number; arbiterTitlePrefix: string };
export type Rules = { agentModels: Record<string, Pair[]>; temporaryOpusRestriction?: OpusRestriction };

export const OPUS_MODEL = "anthropic/claude-opus-5-5";
const UTC_SECONDS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

const FENCE = /^```json coordinator-rules[ \t]*\r?\n([\s\S]*?)^```[ \t]*$/gm;

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
		agentModels[name] = pairs.map((pair, i) => {
			const where = `agentModels.${name}[${i}]`;
			if (!Array.isArray(pair) || pair.length !== 2) throw new Error(`${where} must be [model, thinking]`);
			const [model, thinking] = pair;
			if (typeof model !== "string" || !/^[^/\s]+\/\S+$/.test(model)) throw new Error(`${where}: model must be "provider/id"`);
			if (typeof thinking !== "string" || !(THINKING as readonly string[]).includes(thinking)) {
				throw new Error(`${where}: thinking must be one of ${THINKING.join(", ")}`);
			}
			return [model, thinking] as Pair;
		});
	}
	const rules: Rules = { agentModels };
	// An absent key means no temporary restriction; a present key must parse.
	if (data.temporaryOpusRestriction !== undefined) rules.temporaryOpusRestriction = parseRestriction(data.temporaryOpusRestriction);
	return rules;
}

function parseRestriction(raw: any): OpusRestriction {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
		throw new Error('temporaryOpusRestriction must be an object {"until": "...Z", "arbiterTitlePrefix": "..."}');
	}
	const { until, arbiterTitlePrefix } = raw;
	if (typeof until !== "string" || !UTC_SECONDS.test(until)) throw new Error('temporaryOpusRestriction.until must be a UTC time like "2026-10-28T16:00:00Z"');
	const untilMs = Date.parse(until);
	// Date.parse rolls an impossible date such as 02-30 over; the round trip rejects it.
	if (Number.isNaN(untilMs) || new Date(untilMs).toISOString().slice(0, 19) + "Z" !== until) throw new Error(`temporaryOpusRestriction.until is not a real date: ${until}`);
	if (typeof arbiterTitlePrefix !== "string" || arbiterTitlePrefix.trim() === "") throw new Error("temporaryOpusRestriction.arbiterTitlePrefix must be a non-empty string");
	return { until, untilMs, arbiterTitlePrefix };
}

export function restrictionActive(rules: Rules, now: number): boolean {
	return rules.temporaryOpusRestriction !== undefined && now < rules.temporaryOpusRestriction.untilMs;
}

export function isArbiterTitle(rules: Rules, title: unknown): boolean {
	const restriction = rules.temporaryOpusRestriction;
	return restriction !== undefined && typeof title === "string" && title.startsWith(restriction.arbiterTitlePrefix);
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

/**
 * Table lookup. While the restriction is active `OPUS_MODEL` is refused unless the title starts with the arbiter
 * prefix; the exception only permits pairs already in the table, so it adds no thinking level.
 */
export function isAllowed(rules: Rules, model: string, thinking: string, now: number, title?: unknown): boolean {
	const inTable = Object.values(rules.agentModels).some((pairs) => pairs.some(([m, t]) => m === model && t === thinking));
	if (!inTable) return false;
	if (model === OPUS_MODEL && restrictionActive(rules, now) && !isArbiterTitle(rules, title)) return false;
	return true;
}

/** `simple: a/b medium, c/d low; complex: ...`, the one rendering used in reasons, the prompt and child tasks. Hides Opus while restricted. */
export function describePairs(rules: Rules, now: number): string {
	const hideOpus = restrictionActive(rules, now);
	const classes: string[] = [];
	for (const [name, pairs] of Object.entries(rules.agentModels)) {
		const shown = hideOpus ? pairs.filter(([model]) => model !== OPUS_MODEL) : pairs;
		if (shown.length === 0) continue;
		const list = shown.map(([model, thinking]) => `${model} ${thinking}`).join(", ");
		classes.push(`${name}: ${list}`);
	}
	return classes.join("; ");
}

/** The temporary rule as one sentence group for the prompt and the child line; undefined once it has expired. */
export function restrictionText(rules: Rules, now: number): string | undefined {
	const restriction = rules.temporaryOpusRestriction;
	if (!restriction || !restrictionActive(rules, now)) return undefined;
	const { until, arbiterTitlePrefix } = restriction;
	const opusPairs = new Set<string>();
	for (const pairs of Object.values(rules.agentModels)) {
		for (const [model, thinking] of pairs) {
			if (model === OPUS_MODEL) opusPairs.add(`${model} ${thinking}`);
		}
	}
	const sentences = [`Temporary rule until ${until}: ${OPUS_MODEL} is not allowed.`];
	if (opusPairs.size > 0) {
		const pairList = [...opusPairs].join(", ");
		sentences.push(`Only a start whose title begins with "${arbiterTitlePrefix}" (the reviewer benchmark arbiter) may use the normal allowed Opus pair (${pairList}), with no other thinking level.`);
	}
	sentences.push("After that time the normal table applies again.");
	return sentences.join(" ");
}
