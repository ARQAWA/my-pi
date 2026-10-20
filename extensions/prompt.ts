// Replaces Pi's default prompt prefix (preamble, tool list, rules, docs) with prompt/SYSTEM.md and appends the
// workstation, critical and environment blocks. Pi keeps its own project context, skills and cwd sections after it.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { accessSync, constants, readFileSync } from "node:fs";
import { arch, homedir, release } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SYSTEM = readFileSync(join(ROOT, "prompt", "SYSTEM.md"), "utf8").trimEnd();

const ENV_PROGRAMS = ["git", "node", "bun", "npm", "pnpm", "python3", "python", "cargo", "rustc", "go", "java", "docker", "gh", "rg", "fd", "jq", "make", "cmake"];

function onPath(name: string): boolean {
	for (const dir of (process.env.PATH ?? "").split(delimiter)) {
		if (!dir) continue;
		try {
			accessSync(join(dir, name), constants.X_OK);
			return true;
		} catch {}
	}
	return false;
}

// Computed once per process: PATH and home do not change during a session.
const ENVIRONMENT = (() => {
	const found = ENV_PROGRAMS.filter(onPath);
	const home = homedir().replace(/\\/g, "/");
	return `Environment: shell: the bash tool runs bash; paths: absolute like ${home}/... with forward slashes; programs on PATH: ${found.length ? found.join(", ") : "none found"}.`;
})();

function tail(model: string, cwd: string): string {
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
		ENVIRONMENT,
		`Today: ${new Date().toISOString().slice(0, 10)}; current working directory: '${cwd}'. Do not repeat this information in your reply.`,
	].join("\n");
}

export default function prompt(pi: ExtensionAPI) {
	pi.on("before_agent_start", (event, ctx) => {
		const model = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "unknown";
		event.systemPromptOptions.customPrompt = `${SYSTEM}\n\n${tail(model, ctx.cwd)}`;
	});
}
