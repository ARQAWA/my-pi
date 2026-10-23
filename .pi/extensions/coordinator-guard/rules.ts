// Reads the `json coordinator-rules` block of PROCESS.md. Any problem is an error: the guard fails closed on it.
import { readFileSync } from "node:fs";

export const THINKING = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

export type Pair = [model: string, thinking: string];
export type Rules = { workerModels: Record<string, Pair[]>; fixedWorkers: "block" | "allow" };

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
	const models = data.workerModels;
	if (!models || typeof models !== "object" || Array.isArray(models)) throw new Error("workerModels must be an object of classes");
	const classes = Object.entries(models);
	if (classes.length === 0) throw new Error("workerModels has no classes");
	const workerModels: Record<string, Pair[]> = {};
	for (const [name, pairs] of classes) {
		if (!Array.isArray(pairs) || pairs.length === 0) throw new Error(`workerModels.${name} must be a non-empty array of [model, thinking] pairs`);
		workerModels[name] = pairs.map((pair, i) => {
			const where = `workerModels.${name}[${i}]`;
			if (!Array.isArray(pair) || pair.length !== 2) throw new Error(`${where} must be [model, thinking]`);
			const [model, thinking] = pair;
			if (typeof model !== "string" || !/^[^/\s]+\/\S+$/.test(model)) throw new Error(`${where}: model must be "provider/id"`);
			if (typeof thinking !== "string" || !(THINKING as readonly string[]).includes(thinking)) {
				throw new Error(`${where}: thinking must be one of ${THINKING.join(", ")}`);
			}
			return [model, thinking] as Pair;
		});
	}
	if (data.fixedWorkers !== "block" && data.fixedWorkers !== "allow") throw new Error('fixedWorkers must be "block" or "allow"');
	return { workerModels, fixedWorkers: data.fixedWorkers };
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

export function isAllowed(rules: Rules, model: string, thinking: string): boolean {
	return Object.values(rules.workerModels).some((pairs) => pairs.some(([m, t]) => m === model && t === thinking));
}

/** `simple: a/b medium, c/d low; complex: ...`, the one rendering used in reasons, the prompt and child tasks. */
export function describePairs(rules: Rules): string {
	return Object.entries(rules.workerModels)
		.map(([name, pairs]) => `${name}: ${pairs.map(([m, t]) => `${m} ${t}`).join(", ")}`)
		.join("; ");
}
