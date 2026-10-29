// Skill roots of Codex, in the order of codex-rs ext/skills host_roots.rs.
import { join, resolve } from "node:path";
import { skillSettings } from "./catalog.ts";
import { isDirectory, type CodexContext } from "./config.ts";

export type Scope = "repo" | "user" | "system" | "admin";
export interface SkillRoot { path: string; scope: Scope }

/** Existing Codex skill roots: trusted project layers (nearest first), user, system cache, admin, then `.agents/skills` per directory. */
export function skillRoots(ctx: CodexContext, bundled = skillSettings(ctx.effective).bundled): SkillRoot[] {
	const { env } = ctx;
	const candidates: SkillRoot[] = [];
	for (const layer of [...ctx.layers].reverse()) {
		if (layer.trusted) candidates.push({ path: join(layer.folder, "skills"), scope: "repo" });
	}
	candidates.push({ path: join(env.codexHome, "skills"), scope: "user" });
	candidates.push({ path: join(env.home, ".agents", "skills"), scope: "user" });
	// `skills.bundled.enabled = false` drops the bundled (system) skills.
	if (bundled) candidates.push({ path: join(env.codexHome, "skills", ".system"), scope: "system" });
	if (env.systemDir) candidates.push({ path: join(env.systemDir, "skills"), scope: "admin" });
	for (const dir of ctx.dirs) candidates.push({ path: join(dir, ".agents", "skills"), scope: "repo" });

	const seen = new Set<string>();
	return candidates.filter(root => {
		const path = resolve(root.path);
		if (seen.has(path) || !isDirectory(path)) return false;
		seen.add(path);
		return true;
	});
}
