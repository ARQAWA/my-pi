// RQW-codex-compat: Codex skill roots, skill rules and project instructions on Pi's public extension APIs.
import { getAgentDir, parseArgs, stripFrontmatter, type ExtensionAPI, type ExtensionContext, type NormalizedBuildSystemPromptOptions } from "@earendil-works/pi-coding-agent";
import { byteOrder, disabledPaths, fitBudget, real, scopeOf, scopeRank, skillRules, skillSettings, type SkillLike } from "./catalog.ts";
import { defaultEnv, loadContext, type CodexContext, type Env } from "./config.ts";
import { instructionFiles } from "./instructions.ts";
import { readFileSync, statSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { orderSameName, scanRoots, withScanned } from "./selection.ts";
import { skillRoots, type SkillRoot } from "./skills.ts";

export interface CompatDeps {
	env?: Env;
	/** Command line after the program name; defaults to `process.argv.slice(2)`. */
	argv?: string[];
}

/** Same channel as RQW-prompt's startup projection (literal, no import across folders). */
const STARTUP_PROJECTION = "rqw-prompt:startup-projection";
/** Sessions already warned; kept on `globalThis` because a reload runs this factory again. */
const warnedSessions = ((globalThis as Record<symbol, unknown>)[Symbol.for("rqw-codex-compat:warned")] ??= new Set<string>()) as Set<string>;
const FALLBACK_CHARS = 8000;
const SKILL_FILTER = "rqw-skill-dollar:filter";

type Skill = NormalizedBuildSystemPromptOptions["skills"][number];
/** What the selection needs of a skill: Pi's skills, and the name, description and path of a command. */
type Selectable = SkillLike & { baseDir?: string; sourceInfo?: { scope?: string } };

/** The skills a Codex config leaves enabled: `skills.config` rules, the bundled switch and project trust as just read. */
function enabledSkills<T extends Selectable>(ctx: CodexContext, skills: readonly T[], scope = scopeOf(skillRoots(ctx, true))): T[] {
	const settings = skillSettings(ctx.effective);
	const disabled = disabledPaths(skillRules(ctx), skills);
	// Trust removed since the resources were loaded: the skills of that layer leave the list at once.
	// A skill linked into that folder from elsewhere counts too: its own path and its real path are both checked.
	const untrusted = ctx.layers.filter(layer => !layer.trusted).flatMap(layer => [join(layer.folder, "skills"), real(join(layer.folder, "skills"))].map(dir => dir + sep));
	const inUntrusted = (path: string) => untrusted.some(prefix => path.startsWith(prefix));
	return skills.filter(skill => !disabled.has(real(skill.filePath))
		&& !inUntrusted(skill.filePath) && !inUntrusted(real(skill.filePath))
		&& (settings.bundled || scope(skill.filePath, skill.sourceInfo?.scope) !== "system"));
}

/** The model-visible skills: enabled ones, none when instructions are off, else fitted to the catalog limit. */
function catalogOf(ctx: CodexContext, given: readonly Skill[], contextWindow?: number): Skill[] {
	const settings = skillSettings(ctx.effective);
	if (!settings.includeInstructions) return [];
	const roots = skillRoots(ctx, true);
	const scope = scopeOf(roots);
	// Codex budget order: System, Admin, Repo, User; the last skills are the first to go.
	const skills = enabledSkills(ctx, given, scope)
		.map(skill => ({ skill, rank: scopeRank(scope(skill.filePath, skill.sourceInfo?.scope)) }))
		.sort((a, b) => a.rank - b.rank || byteOrder(a.skill.name, b.skill.name) || byteOrder(a.skill.filePath, b.skill.filePath))
		.map(({ skill }) => skill);
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
	// The skills of the offered roots, Pi's same-name losers included; read once per resource load, as Pi's own list.
	let offered: SkillRoot[] = [];
	let scanned: Skill[] | undefined;
	const withAll = <T extends Selectable>(given: readonly T[]): T[] => withScanned(given, (scanned ??= scanRoots(offered)) as unknown as T[]);
	// The last ordered list `selectable` built, with the skills it was built from; dropped whenever the context is read again.
	let ordered: { key: string; result: Selectable[] } | undefined;
	const refresh = (cwd: string) => {
		ordered = undefined;
		latest = loadContext(cwd, env());
		stamp = configStamp(latest);
		return latest;
	};
	// Applies the skill catalog and the instruction files; returns the path of a project file cut by the byte limit.
	const apply = (options: NormalizedBuildSystemPromptOptions, contextWindow?: number): string | undefined => {
		const ctx = refresh(options.cwd);
		options.skills = catalogOf(ctx, withAll(options.skills), contextWindow);
		if (noContextFiles) return undefined;
		const instructions = instructionFiles(ctx, options.contextFiles);
		options.contextFiles = instructions.files;
		return instructions.truncatedPath;
	};

	pi.on("resources_discover", event => {
		const roots = skillRoots(refresh(event.cwd));
		scanned = undefined;
		offered = noSkills ? [] : roots;
		if (noSkills) return undefined;
		return roots.length > 0 ? { skillPaths: roots.map(root => root.path) } : undefined;
	});
	// The prewarm knows its model only by name; the registry of the session gives the window.
	let registry: { find(provider: string, id: string): { contextWindow?: number } | undefined } | undefined;
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

	// The enabled skills in selection order, same-name ones included: the one list `$name`, `[$name](skill://path)` and `/skill:name` read.
	// The list is built once and reused until the skills, the resources, the cwd or the config change: an autocomplete
	// request does no file access. A changed config file is noticed by one stat per submit (`fresh`), never per keystroke.
	const selectable = <T extends Selectable>(given: readonly T[], cwd?: string, fresh = false): T[] | undefined => {
		if (fresh && latest && configStamp(latest) !== stamp) refresh(latest.cwd);
		const ctx = latest ?? (cwd === undefined ? undefined : refresh(cwd));
		if (!ctx) return undefined;
		const key = JSON.stringify(given.map(skill => [skill.name, skill.description, skill.filePath, skill.baseDir, skill.sourceInfo?.scope]));
		if (ordered?.key === key) return ordered.result as T[];
		const result = orderSameName(enabledSkills(ctx, withAll(given)), skillRoots(ctx, true));
		ordered = { key, result };
		return result;
	};
	// `/skill:name` picks from the same list; Pi's own expansion still runs when it would pick the same skill.
	const skillCommand = (event: { text: string }, ctx: ExtensionContext, throwOnDisabled = false) => {
		if (!event.text.startsWith("/skill:")) return undefined;
		const space = event.text.indexOf(" ");
		const name = space === -1 ? event.text.slice(7) : event.text.slice(7, space);
		const args = space === -1 ? "" : event.text.slice(space + 1).trim();
		const own = pi.getCommands().flatMap(command => command.source === "skill" && command.name === `skill:${name}`
			? [{ name, description: command.description ?? "", filePath: command.sourceInfo.path }] : []);
		const chosen = selectable(own, ctx.cwd, true)?.find(skill => skill.name === name);
		if (!chosen) {
			if (own.length === 0) return undefined;
			const warning = `Skill ${name} is disabled by the Codex config`;
			ctx.ui.notify(warning, "warning");
			if (throwOnDisabled) throw new Error(warning);
			return { action: "handled" as const };
		}
		if (chosen.filePath === own[0]?.filePath) return undefined;
		try {
			const body = stripFrontmatter(readFileSync(chosen.filePath, "utf-8")).trim();
			const block = `<skill name="${name}" location="${chosen.filePath}">\nReferences are relative to ${dirname(chosen.filePath)}.\n\n${body}\n</skill>`;
			return { action: "transform" as const, text: args ? `${block}\n\n${args}` : block };
		} catch { return undefined; }
	};
	pi.events.on(SKILL_FILTER, request => {
		const offer = request as { offer?: (filter: (skills: Skill[], submit?: boolean) => Skill[]) => void; offerCommand?: (handler: typeof skillCommand) => void };
		offer?.offer?.((skills, submit) => selectable(skills, undefined, submit) ?? skills);
		offer?.offerCommand?.((event, ctx) => skillCommand(event, ctx, true));
	});
	pi.on("input", skillCommand);

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
	pi.on("session_start", (_event, ctx) => { registry = ctx.modelRegistry; refresh(ctx.cwd); subscribe(); });
	pi.on("session_shutdown", () => { unsubscribe?.(); unsubscribe = undefined; });
}
