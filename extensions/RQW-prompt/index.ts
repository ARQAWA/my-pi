// Extension 2: replaces Pi's default prompt prefix (preamble, tool list, rules, docs) with SYSTEM.md and appends the
// workstation, critical, environment and date blocks. Pi still appends project context, skills and <cwd> after it.
import type { ExtensionAPI, NormalizedBuildSystemPromptOptions } from "@earendil-works/pi-coding-agent";
import { accessSync, constants, readFileSync, statSync } from "node:fs";
import { arch, homedir, release } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SYSTEM = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "SYSTEM.md"), "utf8").trimEnd();

const ENV_PROGRAMS = ["git", "node", "bun", "npm", "pnpm", "python3", "python", "cargo", "rustc", "go", "java", "docker", "gh", "rg", "fd", "jq", "make", "cmake"];

function onPath(name: string): boolean {
	// Windows finds programs by PATHEXT suffixes such as .exe; Unix by the bare name.
	const suffixes = process.platform === "win32" ? ["", ...(process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";")] : [""];
	return (process.env.PATH ?? "").split(delimiter).some(dir => {
		if (!dir) return false;
		return suffixes.some(ext => {
			try {
				const path = join(dir, name + ext.toLowerCase());
				if (!statSync(path).isFile()) return false;
				if (process.platform !== "win32") accessSync(path, constants.X_OK);
				return true;
			} catch {
				return false;
			}
		});
	});
}

function environment(options: NormalizedBuildSystemPromptOptions): string {
	const found = ENV_PROGRAMS.filter(onPath);
	const home = homedir().replace(/\\/g, "/");
	const shell = options.selectedTools.includes("bash") && !options.hiddenTools.includes("bash")
		? "shell: the bash tool runs bash; " : "";
	return `Environment: ${shell}paths: absolute like ${home}/... with forward slashes; programs on PATH: ${found.length ? found.join(", ") : "none found"}.`;
}

function tail(model: string, options: NormalizedBuildSystemPromptOptions): string {
	return [
		"<project-context>",
		"<workstation>",
		`- OS: ${process.platform} ${release()}`,
		`- Arch: ${arch()}`,
		`- Model: ${model}`,
		"</workstation>",
		"</project-context>",
		"",
		"<critical>",
		"- Each response MUST advance the task; completion only stopping condition.",
		"- MUST default to informed action; do not ask for confirmation when tools or repo context can answer.",
		"- Before yielding, MUST verify significant behavioral changes: run the specific test, command, or scenario covering the change.",
		"</critical>",
		"",
		environment(options),
		// The working directory comes from Pi's own <cwd> section.
		`Today (UTC): ${new Date().toISOString().slice(0, 10)}. Do not repeat this information in your reply.`,
	].join("\n");
}

/** Sets `options.customPrompt` to the RQW prefix for `modelName` and returns it. Assigns only after the text is built. */
function applyPrefix(options: NormalizedBuildSystemPromptOptions, modelName: string): string {
	const value = `${SYSTEM}\n\n${tail(modelName, options)}`;
	options.customPrompt = value;
	return value;
}

/**
 * Channel on `pi.events` for the startup projection: a caller that has cloned its normalized prompt options emits
 * `StartupProjectionRequest` synchronously and gets the same prefix that `before_agent_start` would set. Only
 * `request.options.customPrompt` is written. No handler means the caller keeps Pi's stock prompt.
 */
export const STARTUP_PROJECTION = "rqw-prompt:startup-projection";

export interface StartupProjectionRequest {
	options: NormalizedBuildSystemPromptOptions;
	model?: { provider: string; id: string };
	/** Set (and nothing else written) when the projection could not be made; the caller must not use a stale answer. */
	error?: string;
}

function projectStartup(request: unknown): void {
	if (!request || typeof request !== "object") return;
	const req = request as StartupProjectionRequest;
	try {
		const options = req.options;
		if (!options || typeof options !== "object") throw new TypeError("startup projection needs normalized options");
		// Same rule as before_agent_start: Pi's own custom or forced prompts are left alone.
		if (options.customPrompt !== undefined || options.forceSystemPrompt !== undefined) return;
		applyPrefix(options, req.model ? `${req.model.provider}/${req.model.id}` : "unknown");
	} catch (error) {
		req.error = `rqw-prompt startup projection failed: ${error instanceof Error ? error.message : String(error)}`;
	}
}

export default function prompt(pi: ExtensionAPI) {
	let prepared: { options: NormalizedBuildSystemPromptOptions; value: string } | undefined;
	let unsubscribeProjection: (() => void) | undefined;
	const subscribeProjection = () => { unsubscribeProjection ??= pi.events.on(STARTUP_PROJECTION, projectStartup); };
	subscribeProjection();
	pi.on("session_start", subscribeProjection);
	pi.on("session_shutdown", () => { unsubscribeProjection?.(); unsubscribeProjection = undefined; });

	pi.on("before_agent_start", (event, ctx) => {
		prepared = undefined;
		const options = event.systemPromptOptions;
		// Pi creates fresh run options from the loader, not from our previous prefix.
		if (options.customPrompt !== undefined || options.forceSystemPrompt !== undefined) return;
		const model = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "unknown";
		prepared = { options, value: applyPrefix(options, model) };
	});
	pi.on("model_select", (event) => {
		// A later before_agent_start handler can select the model or take over the prefix.
		if (!prepared || prepared.options.forceSystemPrompt !== undefined || prepared.options.customPrompt !== prepared.value) return;
		prepared.value = applyPrefix(prepared.options, `${event.model.provider}/${event.model.id}`);
	});
	pi.on("agent_start", () => { prepared = undefined; });
}
