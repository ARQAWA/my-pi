// RQW-codex-compat: Codex skill roots, skill rules and project instructions on Pi's public extension APIs.
import { getAgentDir, parseArgs, type ExtensionAPI, type NormalizedBuildSystemPromptOptions } from "@earendil-works/pi-coding-agent";
import { disabledPaths, fitBudget, scopeOf, scopeRank, skillRules, skillSettings } from "./catalog.ts";
import { defaultEnv, loadContext, type CodexContext, type Env } from "./config.ts";
import { instructionFiles } from "./instructions.ts";
import { realpathSync, statSync } from "node:fs";
import { join } from "node:path";
import { skillRoots } from "./skills.ts";

export interface CompatDeps {
	env?: Env;
	/** Command line after the program name; defaults to `process.argv.slice(2)`. */
	argv?: string[];
}

/** Same channel as RQW-prompt's startup projection (literal, no import across folders). */
const STARTUP_PROJECTION = "rqw-prompt:startup-projection";
/** Sessions already warned; kept on `globalThis` because a reload runs this factory again. */
const warnedSessions = ((globalThis as Record<symbol, unknown>)[Symbol.for("rqw-codex-compat:warned")] ??= new Set<string>()) as Set<string>;
/** Channel on which RQW-skill-dollar asks for a skill filter; `offer` takes `(skills) => skills` (literal, no import). */
const FALLBACK_CHARS = 8000;
const SKILL_FILTER = "rqw-skill-dollar:filter";

type Skill = NormalizedBuildSystemPromptOptions["skills"][number];
const real = (path: string) => { try { return realpathSync(path); } catch { return path; } };

/** The skills a Codex config leaves enabled: `skills.config` rules and the bundled switch. */
function enabledSkills<T extends Skill>(ctx: CodexContext, skills: readonly T[]): T[] {
	const settings = skillSettings(ctx.effective);
	const roots = skillRoots(ctx, true);
	const disabled = disabledPaths(skillRules(ctx), skills);
	return skills.filter(skill => !disabled.has(real(skill.filePath))
		&& (settings.bundled || scopeOf(skill.filePath, roots, skill.sourceInfo?.scope) !== "system"));
}

/** The model-visible skills: enabled ones, none when instructions are off, else fitted to the catalog limit. */
function catalogOf(ctx: CodexContext, given: readonly Skill[], contextWindow?: number): Skill[] {
	const settings = skillSettings(ctx.effective);
	if (!settings.includeInstructions) return [];
	const roots = skillRoots(ctx, true);
	const rank = (skill: Skill) => scopeRank(scopeOf(skill.filePath, roots, skill.sourceInfo?.scope));
	// Codex budget order: System, Admin, Repo, User; the last skills are the first to go.
	const skills = enabledSkills(ctx, given).sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name) || a.filePath.localeCompare(b.filePath));
	// The limit is `skills.max_context_tokens`, else 2% of the model's context window, as in Codex.
	const limit = settings.maxContextTokens ?? (contextWindow && contextWindow > 0 ? Math.max(1, Math.floor(contextWindow * 2 / 100)) : undefined);
	// Neither a configured limit nor a known window: Codex's 8000-character fallback.
	return limit === undefined ? fitBudget(skills, FALLBACK_CHARS, "chars") : fitBudget(skills, limit);
}

/** Size and mtime of the config files a context read, a cheap check that they still are the same. */
function configStamp(ctx: CodexContext): string {
	return [join(ctx.env.codexHome, "config.toml"), ...ctx.layers.map(layer => join(layer.folder, "config.toml"))].map(file => {
		try { const info = statSync(file); return `${info.mtimeMs}:${info.size}`; } catch { return "-"; }
	}).join("|");
}

export default function codexCompat(pi: ExtensionAPI, deps: CompatDeps = {}): void {
	const env = () => deps.env ?? defaultEnv(getAgentDir());
	// Pi has no extension API for its own `--no-context-files`, so the command line is parsed with Pi's public parser once.
	const args = parseArgs(deps.argv ?? process.argv.slice(2));
	const noContextFiles = args.noContextFiles === true;
	const noSkills = args.noSkills === true;
	let latest: CodexContext | undefined;
	let stamp = "";
	const refresh = (cwd: string) => {
		latest = loadContext(cwd, env());
		stamp = configStamp(latest);
		return latest;
	};
	// Applies the skill catalog and the instruction files; returns the path of a project file cut by the byte limit.
	const apply = (options: NormalizedBuildSystemPromptOptions, contextWindow?: number): string | undefined => {
		const ctx = refresh(options.cwd);
		options.skills = catalogOf(ctx, options.skills, contextWindow);
		if (noContextFiles) return undefined;
		const instructions = instructionFiles(ctx, options.contextFiles);
		options.contextFiles = instructions.files;
		return instructions.truncatedPath;
	};

	pi.on("resources_discover", event => {
		const roots = skillRoots(refresh(event.cwd));
		if (noSkills) return undefined;
		return roots.length > 0 ? { skillPaths: roots.map(root => root.path) } : undefined;
	});
	// The prewarm knows its model only by name; the registry of the session gives the window.
	let registry: { find(provider: string, id: string): { contextWindow?: number } | undefined } | undefined;
	pi.on("session_start", (_event, ctx) => { registry = ctx.modelRegistry; refresh(ctx.cwd); });
	pi.on("before_agent_start", (event, ctx) => {
		const truncated = apply(event.systemPromptOptions, ctx.model?.contextWindow);
		// One warning per session, also across a reload of the extension: the session id is the key.
		if (truncated === undefined) return;
		const session = ctx.sessionManager.getSessionId();
		if (!warnedSessions.has(session)) {
			warnedSessions.add(session);
			ctx.ui.notify(`Codex project_doc_max_bytes cut ${truncated}`, "warning");
		}
	});

	// RQW-skill-dollar lists and expands only skills a Codex config leaves enabled.
	pi.events.on(SKILL_FILTER, request => {
		(request as { offer?: (filter: (skills: Skill[]) => Skill[]) => void })?.offer?.(skills => {
			// Mentions follow the config as it is now: a changed config file is read again before the input is processed.
			if (latest && configStamp(latest) !== stamp) refresh(latest.cwd);
			return latest ? enabledSkills(latest, skills) : skills;
		});
	});

	// The idle prewarm builds its prompt from a cloned options object; it gets the same result.
	let unsubscribe: (() => void) | undefined;
	const subscribe = () => {
		unsubscribe ??= pi.events.on(STARTUP_PROJECTION, request => {
			const req = request as { options?: NormalizedBuildSystemPromptOptions; model?: { provider: string; id: string }; error?: string } | undefined;
			if (!req?.options || req.error !== undefined) return;
			try { apply(req.options, req.model ? registry?.find(req.model.provider, req.model.id)?.contextWindow : undefined); }
			catch (error) { req.error = `rqw-codex-compat startup projection failed: ${error instanceof Error ? error.message : String(error)}`; }
		});
	};
	subscribe();
	pi.on("session_start", subscribe);
	pi.on("session_shutdown", () => { unsubscribe?.(); unsubscribe = undefined; });
}
