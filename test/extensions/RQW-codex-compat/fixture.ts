import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import assert from "node:assert/strict";
import { formatSkillsForPrompt, loadSkillsFromDir } from "@earendil-works/pi-coding-agent";
import codexCompat from "../../../extensions/RQW-codex-compat/index.ts";

/** Temporary Codex world: fake home, CODEX_HOME, admin folder, Pi agent dir and a git project with a nested cwd. */
export function world(t: { after(fn: () => void): void }) {
	const base = realpathSync(mkdtempSync(join(tmpdir(), "rqw-codex-compat-")));
	t.after(() => rmSync(base, { recursive: true, force: true }));
	const path = (...parts: string[]) => join(base, ...parts);
	const put = (rel: string, text = "") => {
		mkdirSync(dirname(path(rel)), { recursive: true });
		writeFileSync(path(rel), text);
		return path(rel);
	};
	const skill = (rel: string, name: string, description = `${name} description`) =>
		put(join(rel, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\n${name} body\n`);
	put("project/.git/HEAD", "ref: refs/heads/main\n");
	mkdirSync(path("project", "pkg"), { recursive: true });
	const env = { codexHome: path("codex"), home: path("home"), systemDir: path("etc-codex"), agentDir: path("agent") };
	return { base, path, put, skill, env, root: path("project"), cwd: path("project", "pkg") };
}

/**
 * A linked worktree `wt` of the checkout `main`, with the metadata Git writes. `separate` puts the common directory
 * next to a plain `main/.git` pointer file, as `git init --separate-git-dir` does.
 */
export function linkedWorktree(w: ReturnType<typeof world>, separate = false) {
	const common = separate ? "main/.git-data" : "main/.git";
	if (separate) w.put("main/.git", `gitdir: ${w.path(common)}\n`);
	w.put(`${common}/HEAD`, "ref: refs/heads/main\n");
	w.put(`${common}/worktrees/wt/gitdir`, `${w.path("wt/.git")}\n`);
	w.put(`${common}/worktrees/wt/commondir`, "../..\n");
	w.put("wt/.git", `gitdir: ${w.path(`${common}/worktrees/wt`)}\n`);
	return { main: w.path("main"), wt: w.path("wt"), admin: w.path(`${common}/worktrees/wt`) };
}

export function fakePi(deps: Parameters<typeof codexCompat>[1]) {
	const handlers = new Map<string, ((event: any, ctx: any) => unknown)[]>();
	const channels = new Map<string, ((data: unknown) => void)[]>();
	const pi = {
		on(name: string, handler: any) { handlers.set(name, [...(handlers.get(name) ?? []), handler]); },
		events: {
			on(channel: string, handler: (data: unknown) => void) {
				channels.set(channel, [...(channels.get(channel) ?? []), handler]);
				return () => channels.set(channel, (channels.get(channel) ?? []).filter(item => item !== handler));
			},
			emit(channel: string, data: unknown) { for (const handler of channels.get(channel) ?? []) handler(data); },
		},
	};
	codexCompat(pi as unknown as ExtensionAPI, deps);
	return {
		pi,
		async fire(name: string, event: any, ctx: any = {}) {
			let result: unknown;
			for (const handler of handlers.get(name) ?? []) result = (await handler(event, ctx)) ?? result;
			return result;
		},
	};
}

export const trust = (path: string, level: string) => `[projects.${JSON.stringify(path)}]\ntrust_level = "${level}"\n`;

export type Files = { path: string; content: string }[];

let sessions = 0;
export async function run(w: ReturnType<typeof world>, current: Files = [], notes: string[] = [], session = `session-${++sessions}`, argv: string[] = []) {
	const pi = fakePi({ env: w.env, argv });
	const ctx = { cwd: w.cwd, sessionManager: { getSessionId: () => session }, ui: { notify: (message: string) => notes.push(message) } };
	await pi.fire("session_start", {}, ctx);
	const event = { systemPromptOptions: { cwd: w.cwd, skills: [], contextFiles: current.map(file => ({ ...file })) } };
	await pi.fire("before_agent_start", event, ctx);
	// The idle prewarm projection gets exactly the same files as the real prompt.
	const request = { options: { cwd: w.cwd, skills: [], contextFiles: current.map(file => ({ ...file })) } };
	pi.pi.events.emit("rqw-prompt:startup-projection", request);
	assert.deepEqual(request.options.contextFiles, event.systemPromptOptions.contextFiles);
	return event.systemPromptOptions.contextFiles as Files;
}

/** Test-side rendering of the two Pi 1.4 prompt sections the extension changes: project context and skills. */
export function renderPrompt(options: { contextFiles: { path: string; content: string }[]; skills: any[] }): string {
	const context = options.contextFiles.length === 0 ? "" : `<project_context>\nProject-specific instructions and guidelines:\n\n${options.contextFiles
		.map(file => `<project_instructions path="${file.path}">\n${file.content}\n</project_instructions>`).join("\n\n")}\n</project_context>\n`;
	return `${context}<skills>\n${formatSkillsForPrompt(options.skills, "read")}\n</skills>`;
}

/**
 * One synthetic turn: the skills Pi would load from the roots the extension offers (Pi's public loader over fixed
 * fixture folders), the `before_agent_start` result and the prewarm projection, both rendered as prompt text.
 */
export async function promptOf(w: ReturnType<typeof world>, deps: Parameters<typeof codexCompat>[1], contextWindow: number | null = 100000) {
	const pi = fakePi(deps);
	const model = { provider: "compat-test", id: "model", contextWindow: contextWindow ?? undefined };
	const notes: string[] = [];
	const ctx = { cwd: w.cwd, model, modelRegistry: { find: () => model }, sessionManager: { getSessionId: () => `session-${++sessions}` }, ui: { notify: (message: string) => notes.push(message) } };
	await pi.fire("session_start", {}, ctx);
	const found = await pi.fire("resources_discover", { cwd: w.cwd, reason: "startup" }) as { skillPaths?: string[] } | undefined;
	const loaded = () => (found?.skillPaths ?? []).flatMap(dir => loadSkillsFromDir({ dir, source: "fixture" }).skills);
	const event = { systemPromptOptions: { cwd: w.cwd, contextFiles: [], skills: loaded() } };
	await pi.fire("before_agent_start", event, ctx);
	const request = { options: { cwd: w.cwd, contextFiles: [], skills: loaded() }, model: { provider: model.provider, id: model.id } };
	pi.pi.events.emit("rqw-prompt:startup-projection", request);
	return { system: renderPrompt(event.systemPromptOptions), prewarm: renderPrompt(request.options), options: event.systemPromptOptions, notes };
}
