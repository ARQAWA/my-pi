// Skill rules, bundled switch and model catalog limits (codex-rs config/src/skills_config.rs, ext/skills/src/render.rs).
import { realpathSync } from "node:fs";
import { resolve, sep } from "node:path";
import { isTable, type CodexContext, type Table } from "./config.ts";
import type { Scope, SkillRoot } from "./skills.ts";

export interface SkillLike { name: string; description: string; filePath: string }
interface Rule { selector: { name: string } | { path: string }; enabled: boolean }
export interface SkillSettings { bundled: boolean; includeInstructions: boolean; maxContextTokens?: number }

const MAX_CONFIGURED_TOKENS = 10_000;
const MAX_DESCRIPTION_CHARS = 1_024;

const real = (path: string) => { try { return realpathSync(path); } catch { return resolve(path); } };
const selectorKey = (rule: Rule) => "name" in rule.selector ? `name:${rule.selector.name}` : `path:${rule.selector.path}`;

/** `skills.config` entries of the user layer; a repeated selector keeps only its last position. */
export function skillRules(ctx: CodexContext): Rule[] {
	const skills = ctx.user.skills;
	const entries = isTable(skills) && Array.isArray(skills.config) ? skills.config : [];
	const rules: Rule[] = [];
	for (const entry of entries) {
		if (!isTable(entry) || typeof entry.enabled !== "boolean") continue;
		const path = typeof entry.path === "string" ? entry.path : undefined;
		const name = typeof entry.name === "string" ? entry.name.trim() : undefined;
		if ((path === undefined) === (name === undefined) || name === "") continue;
		const rule: Rule = { selector: path !== undefined ? { path: real(resolve(ctx.env.codexHome, path)) } : { name: name! }, enabled: entry.enabled };
		rules.splice(0, rules.length, ...rules.filter(other => selectorKey(other) !== selectorKey(rule)), rule);
	}
	return rules;
}

/** Later rules win; a path rule stays effective even when no listed skill has that path. */
export function disabledPaths(rules: Rule[], skills: readonly SkillLike[]): Set<string> {
	const disabled = new Set<string>();
	for (const rule of rules) {
		if ("path" in rule.selector) {
			if (rule.enabled) disabled.delete(rule.selector.path); else disabled.add(rule.selector.path);
			continue;
		}
		for (const skill of skills) {
			if (skill.name !== rule.selector.name) continue;
			if (rule.enabled) disabled.delete(real(skill.filePath)); else disabled.add(real(skill.filePath));
		}
	}
	return disabled;
}

export function skillSettings(effective: Table): SkillSettings {
	const skills = isTable(effective.skills) ? effective.skills : {};
	const bundled = isTable(skills.bundled) && skills.bundled.enabled === false ? false : true;
	const tokens = skills.max_context_tokens;
	return {
		bundled,
		includeInstructions: skills.include_instructions !== false,
		maxContextTokens: typeof tokens === "number" && Number.isInteger(tokens) && tokens > 0 ? Math.min(tokens, MAX_CONFIGURED_TOKENS) : undefined,
	};
}

/** Scope of a skill file: the Codex root that holds it, else Pi's own scope. */
export function scopeOf(filePath: string, roots: readonly SkillRoot[], piScope?: string): Scope {
	const path = real(filePath);
	const holder = roots.filter(root => path.startsWith(real(root.path) + sep)).sort((a, b) => b.path.length - a.path.length)[0];
	return holder?.scope ?? (piScope === "project" ? "repo" : "user");
}

const RANK: Record<Scope, number> = { system: 0, admin: 1, repo: 2, user: 3 };
export const scopeRank = (scope: Scope) => RANK[scope];

const truncated = (text: string) => Array.from(text).length > MAX_DESCRIPTION_CHARS ? `${Array.from(text).slice(0, MAX_DESCRIPTION_CHARS - 3).join("")}...` : text;
type Budgeted = SkillLike & { disableModelInvocation?: boolean };

// Codex's catalog line and its cost: `ceil(bytes / 4)` tokens of the line and its newline (core-skills render.rs).
const lineOf = (skill: SkillLike, description: string) =>
	description ? `- ${skill.name}: ${description} (file: ${skill.filePath})` : `- ${skill.name}: (file: ${skill.filePath})`;
const costIn = (unit: "tokens" | "chars") => (text: string) =>
	unit === "tokens" ? Math.ceil(Buffer.byteLength(`${text}\n`) / 4) : Array.from(`${text}\n`).length;

/**
 * Fits skills into `limit` tokens (or characters, Codex's fallback when no window is known) with its per-line budget: full lines, else descriptions shrink round-robin,
 * else skills are omitted from the end. Skills Pi does not render (`disableModelInvocation`) cost nothing and stay.
 */
export function fitBudget<T extends Budgeted>(skills: T[], limit: number, unit: "tokens" | "chars" = "tokens"): T[] {
	const cost = costIn(unit);
	const visible = skills.filter(skill => !skill.disableModelInvocation);
	if (visible.length === 0) return skills;
	const chars = visible.map(skill => Array.from(truncated(skill.description)));
	const full = chars.map(list => list.length);
	const lineCost = (index: number, count: number) => cost(lineOf(visible[index], chars[index].slice(0, count).join("")));
	const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
	let counts: number[];
	if (sum(full.map((count, index) => lineCost(index, count))) <= limit) counts = full;
	else {
		const minimum = visible.map((_, index) => lineCost(index, 0));
		if (sum(minimum) <= limit) {
			counts = visible.map(() => 0);
			const costs = [...minimum];
			let used = sum(costs);
			for (let changed = true; changed;) {
				changed = false;
				for (let index = 0; index < visible.length; index++) {
					if (counts[index] >= full[index]) continue;
					const next = lineCost(index, counts[index] + 1);
					if (used - costs[index] + next > limit) continue;
					used += next - costs[index];
					costs[index] = next;
					counts[index] += 1;
					changed = true;
				}
			}
		} else {
			let used = 0;
			counts = minimum.map(line => {
				if (used + line > limit) return -1;
				used += line;
				return 0;
			});
		}
	}
	const byVisible = new Map(visible.map((skill, index) => [skill, index]));
	return skills.flatMap(skill => {
		const index = byVisible.get(skill);
		if (index === undefined) return [skill];
		return counts[index] < 0 ? [] : [{ ...skill, description: chars[index].slice(0, counts[index]).join("") }];
	});
}
