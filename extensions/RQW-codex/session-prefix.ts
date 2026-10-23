// RQW-codex: pending system-section patch of the next run, for the idle prewarm only (never sent as a turn, never stored).
// Pi 1.4.0 keeps the prompt as named sections; its pure builders are not exported from the package root, so the pure logic
// is ported here, with the source attribution below. No Pi module is imported beyond the package roots.
// Ported (MIT, Pi 1.4.0, LICENSE-PI; source dist/core/system-prompt.js of the installed npm package @earendil-works/pi-coding-agent
// 1.4.0, whose repository is github.com/earendil-works/pi, packages/coding-agent; no upstream tag or commit was verified): normalizeBuildSystemPromptOptions, renderProjectContext,
// buildRules, buildSystemPromptSections, diffSystemPromptSections. Only the sections the prewarm needs are kept verbatim.
// The replay of the transcript's current sections uses the public getCurrentSystemMessage of @earendil-works/pi-ai.
// The tool declarations use the public getCurrentTools, getToolStateChanges and toToolDeclaration of @earendil-works/pi-ai, as
// Pi 1.4.0 agent-loop declareToolChanges and agent-session _installHiddenDeclarationsProjection do.
import {
	formatSkillsForPrompt,
	getDocsPath,
	getExamplesPath,
	getReadmePath,
	type NormalizedBuildSystemPromptOptions,
} from "@earendil-works/pi-coding-agent";
import { getCurrentSystemMessage, getCurrentTools, getToolStateChanges, toToolDeclaration, type Tool, type ToolStateChanges } from "@earendil-works/pi-ai";

const SYSTEM_PROMPT_SECTION_NAME = /^[a-z][a-z0-9_-]*$/;

/** Normalize prompt input into the mutable, collection-complete shape (Pi 1.4.0 normalizeBuildSystemPromptOptions). */
export function normalizeRunOptions(input: NormalizedBuildSystemPromptOptions): NormalizedBuildSystemPromptOptions {
	return {
		customPrompt: input.customPrompt,
		forceSystemPrompt: input.forceSystemPrompt,
		selectedTools: [...(input.selectedTools ?? ["read", "bash", "edit", "write"])],
		hiddenTools: [...(input.hiddenTools ?? [])],
		toolSnippets: { ...(input.toolSnippets ?? {}) },
		toolGuidelines: Object.fromEntries(Object.entries(input.toolGuidelines ?? {}).map(([name, guidelines]) => [name, [...guidelines]])),
		promptGuidelines: [...(input.promptGuidelines ?? [])],
		appendSystemPrompt: input.appendSystemPrompt ?? "",
		sections: { ...(input.sections ?? {}) },
		cwd: input.cwd,
		contextFiles: (input.contextFiles ?? []).map((file) => ({ ...file })),
		skills: (input.skills ?? []).map((skill) => ({ ...skill })),
	};
}

function renderProjectContext(contextFiles: NormalizedBuildSystemPromptOptions["contextFiles"]): string {
	return [
		"Project-specific instructions and guidelines:",
		...contextFiles.map(({ path, content }) => `<project_instructions path="${path}">\n${content}\n</project_instructions>`),
	].join("\n\n");
}

function buildRules(selectedTools: string[], toolGuidelines: Record<string, string[]>, promptGuidelines: string[]): string {
	const rules: string[] = [];
	const seen = new Set<string>();
	const addRule = (rule: string) => {
		const normalized = rule.trim();
		if (!normalized || seen.has(normalized)) return;
		seen.add(normalized);
		rules.push(normalized);
	};
	const hasBash = selectedTools.includes("bash");
	const hasPowerShell = selectedTools.includes("powershell");
	const hasGrep = selectedTools.includes("grep");
	const hasFind = selectedTools.includes("find");
	const hasLs = selectedTools.includes("ls");
	if ((hasBash || hasPowerShell) && !hasGrep && !hasFind && !hasLs) {
		if (hasBash && hasPowerShell) {
			addRule("Use bash or PowerShell for file operations like listing, searching, and finding files");
		} else if (hasPowerShell) {
			addRule("Use PowerShell for file operations like listing, searching, and finding files");
		} else {
			addRule("Use bash for file operations like ls, rg, find");
		}
	}
	for (const name of selectedTools) {
		for (const rule of toolGuidelines[name] ?? []) addRule(rule);
	}
	for (const rule of promptGuidelines) addRule(rule);
	addRule("Be concise in your responses");
	addRule("Show file paths clearly when working with files");
	return rules.map((rule) => `- ${rule}`).join("\n");
}

/** Ordered, independently replaceable sections of the structured system prompt (Pi 1.4.0 buildSystemPromptSections). */
export function buildSystemPromptSectionsOf(input: NormalizedBuildSystemPromptOptions): Record<string, string> {
	const options = normalizeRunOptions(input);
	const { customPrompt, selectedTools, hiddenTools, toolSnippets, toolGuidelines, promptGuidelines, appendSystemPrompt, sections: customSections, cwd, contextFiles, skills } = options;
	for (const name of Object.keys(customSections)) {
		if (!SYSTEM_PROMPT_SECTION_NAME.test(name) || name === "preamble") throw new Error(`Invalid system prompt section name: ${name}`);
	}
	const declaredTools = selectedTools.filter((name) => !hiddenTools.includes(name));
	const promptSections: Record<string, string> = {};
	if (customPrompt) {
		promptSections.preamble = customPrompt;
	} else {
		promptSections.preamble =
			"You are an expert coding assistant operating inside pi, a coding agent harness. You help users by reading files, executing commands, editing code, and writing new files.";
		const visibleTools = declaredTools.filter((name) => !!toolSnippets[name]);
		const tools = visibleTools.length > 0 ? visibleTools.map((name) => `- ${name}: ${toolSnippets[name]}`).join("\n") : "(none)";
		promptSections.tools = `${tools}\n\nIn addition to the tools above, you may have access to other custom tools depending on the project.`;
		promptSections.rules = buildRules(declaredTools, toolGuidelines, promptGuidelines);
		promptSections.docs = `Pi documentation (read only when the user asks about pi itself, its SDK, extensions, themes, skills, or TUI):
- Main documentation: ${getReadmePath()}
- Additional docs: ${getDocsPath()}
- Examples: ${getExamplesPath()} (extensions, custom tools, SDK)
- When reading pi docs or examples, resolve docs/... under Additional docs and examples/... under Examples, not the current working directory
- When asked about: extensions (docs/extensions.md, examples/extensions/), themes (docs/themes.md), skills (docs/skills.md), prompt templates (docs/prompt-templates.md), TUI components (docs/tui.md), keybindings (docs/keybindings.md), SDK integrations (docs/sdk.md), custom providers (docs/custom-provider.md), adding models (docs/models.md), pi packages (docs/packages.md), environment variables (docs/environment-variables.md), MCP servers (docs/mcp.md), codemode scripts and non-LLM models such as classifiers and image models (docs/codemode.md)
- When working on pi topics, read the docs and examples, and follow .md cross-references before implementing
- Always read pi .md files completely and follow links to related docs (e.g., tui.md for TUI API details)`;
	}
	if (appendSystemPrompt) promptSections.addendum = appendSystemPrompt;
	if (contextFiles.length > 0) promptSections.project_context = renderProjectContext(contextFiles);
	// A hidden reader is still reachable through another tool, so skills stay but the hint names no tool.
	const readers = ["read", "bash"] as const;
	const skillFileReadTool = readers.find((tool) => declaredTools.includes(tool)) ?? (readers.some((tool) => selectedTools.includes(tool)) ? "indirect" : undefined);
	if (skillFileReadTool && skills.length > 0) {
		const skillsPrompt = formatSkillsForPrompt(skills, skillFileReadTool).trim();
		if (skillsPrompt) promptSections.skills = skillsPrompt;
	}
	promptSections.cwd = cwd.replace(/\\/g, "/");
	for (const [name, content] of Object.entries(customSections)) {
		if (content) promptSections[name] = content;
	}
	const sections: Record<string, string> = { preamble: promptSections.preamble };
	for (const [name, content] of Object.entries(promptSections)) {
		if (name !== "preamble") sections[name] = `<${name}>\n${content}\n</${name}>`;
	}
	return sections;
}

/** Pi 1.4.0 diffSystemPromptSections: the patch of the sections the transcript has, or undefined when nothing changed. */
function diffSections(previous: Record<string, string | null>, current: Record<string, string>): Record<string, string | null> | undefined {
	const patch: Record<string, string | null> = {};
	for (const [name, text] of Object.entries(current)) {
		if (previous[name] !== text) patch[name] = text;
	}
	for (const name of Object.keys(previous)) {
		if (current[name] === undefined) patch[name] = null;
	}
	return Object.keys(patch).length > 0 ? patch : undefined;
}

/**
 * The tool declarations the next run declares (Pi 1.4.0 agent-loop declareToolChanges): the executable catalog against the
 * tools the transcript replays. Hidden names are dropped as Pi's request projection drops them.
 */
export function pendingToolChanges(messages: readonly unknown[], catalog: readonly Tool[], hidden: ReadonlySet<string>): ToolStateChanges {
	const changes = getToolStateChanges(getCurrentTools(messages as never), catalog.map(toToolDeclaration));
	return {
		toolsAdded: changes.toolsAdded.filter((tool) => !hidden.has(tool.name)),
		toolsRemoved: changes.toolsRemoved.filter((tool) => !hidden.has(tool.name)),
	};
}

/** Pi 1.4.0 _installHiddenDeclarationsProjection: system messages without the hidden names in their tool fields. */
export function withHiddenTools<M extends { role: string }>(messages: readonly M[], hidden: ReadonlySet<string>): M[] {
	if (hidden.size === 0) return [...messages];
	return messages.map((message) => {
		const tools = message as unknown as { toolsAdded?: Tool[]; toolsRemoved?: Tool[] };
		if (message.role !== "system" || (!tools.toolsAdded && !tools.toolsRemoved)) return message;
		const { toolsAdded, toolsRemoved, ...rest } = tools;
		const added = toolsAdded?.filter((tool) => !hidden.has(tool.name)) ?? [];
		const removed = toolsRemoved?.filter((tool) => !hidden.has(tool.name)) ?? [];
		return { ...rest, ...(added.length > 0 ? { toolsAdded: added } : {}), ...(removed.length > 0 ? { toolsRemoved: removed } : {}) } as unknown as M;
	});
}

/**
 * The system message Pi's next run adds after the transcript (Pi 1.4.0 _preparePromptAndToolLoadout and declareToolChanges): the
 * sections patch against the sections the transcript replays, plus the tool delta, or undefined when neither changed. Input is the
 * physical transcript messages (converted to the LLM form); the result is a transient request-time message, never stored.
 */
export function pendingSystemMessage(messages: readonly unknown[], options: NormalizedBuildSystemPromptOptions, tools: ToolStateChanges): { role: "system"; content: string; sections?: Record<string, string | null>; toolsAdded?: Tool[]; toolsRemoved?: ToolStateChanges["toolsRemoved"]; timestamp: number } | undefined {
	const replayed = getCurrentSystemMessage(messages as never)?.sections ?? {};
	const sections = diffSections(replayed as Record<string, string>, buildSystemPromptSectionsOf(options));
	const added = tools.toolsAdded.length > 0 ? { toolsAdded: tools.toolsAdded } : {};
	const removed = tools.toolsRemoved.length > 0 ? { toolsRemoved: tools.toolsRemoved } : {};
	if (!sections && Object.keys(added).length === 0 && Object.keys(removed).length === 0) return undefined;
	return { role: "system", content: "", ...(sections ? { sections } : {}), ...added, ...removed, timestamp: Date.now() };
}
