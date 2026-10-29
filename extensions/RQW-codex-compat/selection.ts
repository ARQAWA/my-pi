// Same-name skills: the catalog keys skills by path, and one name picks like Codex (codex-rs ext/skills loader/host_merge.rs,
// selection.rs). Pi's loader keeps only the first skill of a name, so the skills of the Codex roots are read again here.
import { loadSkillsFromDir } from "@earendil-works/pi-coding-agent";
import { mergeRank, real, scopeOf, type SkillLike } from "./catalog.ts";
import type { SkillRoot } from "./skills.ts";

/** Every skill of the Codex roots, same-name ones included; the folders are the ones Pi was offered. */
export function scanRoots(roots: readonly SkillRoot[]): ReturnType<typeof loadSkillsFromDir>["skills"] {
	return roots.flatMap(root => loadSkillsFromDir({ dir: root.path, source: "path" }).skills);
}

/** Pi's skills plus the scanned ones, one entry per real path; Pi's own entry wins. */
export function withScanned<T extends SkillLike>(given: readonly T[], scanned: readonly T[]): T[] {
	const seen = new Set(given.map(skill => real(skill.filePath)));
	return [...given, ...scanned.filter(skill => {
		const path = real(skill.filePath);
		if (seen.has(path)) return false;
		seen.add(path);
		return true;
	})];
}

/**
 * Orders each same-name group by Codex's merge rule (scope Repo, User, System, Admin, then path); the first one is what a
 * plain name selects. A group stays where its first member stood, so lists without duplicates keep their order.
 */
export function orderSameName<T extends SkillLike & { sourceInfo?: { scope?: string } }>(skills: readonly T[], roots: readonly SkillRoot[]): T[] {
	const groups = new Map<string, T[]>();
	for (const skill of skills) groups.set(skill.name, [...(groups.get(skill.name) ?? []), skill]);
	const rank = (skill: T) => mergeRank(scopeOf(skill.filePath, roots, skill.sourceInfo?.scope));
	return [...groups.values()].flatMap(group => group.sort((a, b) => rank(a) - rank(b) || (a.filePath < b.filePath ? -1 : a.filePath > b.filePath ? 1 : 0)));
}
