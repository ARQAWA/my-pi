// Extension 2: replaces Pi's default prompt prefix (preamble, tool list, rules, docs) with SYSTEM.md and appends the
// workstation, critical, environment and date blocks. Pi still appends project context, skills and <cwd> after it.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { accessSync, constants, readFileSync } from "node:fs";
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
				accessSync(join(dir, name + ext.toLowerCase()), constants.F_OK);
				return true;
			} catch {
				return false;
			}
		});
	});
}

// Computed once per process: PATH and home do not change during a session.
const ENVIRONMENT = (() => {
	const found = ENV_PROGRAMS.filter(onPath);
	const home = homedir().replace(/\\/g, "/");
	return `Environment: shell: the bash tool runs bash; paths: absolute like ${home}/... with forward slashes; programs on PATH: ${found.length ? found.join(", ") : "none found"}.`;
})();

function tail(model: string): string {
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
		// The working directory comes from Pi's own <cwd> section.
		`Today: ${new Date().toISOString().slice(0, 10)}. Do not repeat this information in your reply.`,
	].join("\n");
}

export default function prompt(pi: ExtensionAPI) {
	pi.on("before_agent_start", (event, ctx) => {
		const model = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "unknown";
		event.systemPromptOptions.customPrompt = `${SYSTEM}\n\n${tail(model)}`;
	});
}
