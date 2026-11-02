import assert from "node:assert/strict";
import { it, mock } from "node:test";
import { getDocsPath, getExamplesPath, getReadmePath, type NormalizedBuildSystemPromptOptions } from "@earendil-works/pi-coding-agent";
import { getCurrentSystemMessage, type Tool } from "@earendil-works/pi-ai";
import { buildSystemPromptSectionsOf, pendingSystemMessage, pendingToolChanges, withHiddenTools } from "../../../extensions/RQW-codex/session-prefix.ts";

const options: NormalizedBuildSystemPromptOptions = {
	selectedTools: ["write", "secret", "read"], hiddenTools: ["secret"],
	toolSnippets: { write: "Write files", secret: "Hidden", read: "Read files" },
	toolGuidelines: { write: ["Write carefully"], secret: ["Hidden rule"], read: ["Read first", "Write carefully"] },
	promptGuidelines: ["Read first", "Keep scope"], appendSystemPrompt: "Extra",
	sections: { policy: "Policy" }, cwd: "C:\\work", contextFiles: [{ path: "/project/AGENTS.md", content: "Instructions" }], skills: [],
};

const tool = (name: string): Tool => ({ name, description: `${name} description`, parameters: { type: "object", properties: {} } }) as Tool;

it("uses the exact Pi 1.5 stock sections and active tool order without RQW-prompt", () => {
	assert.deepEqual(buildSystemPromptSectionsOf(options), {
		preamble: "You are a coding assistant running inside pi, a coding agent harness. Help users inspect files, run commands, and modify code.",
		tools: "<tools>\n- write: Write files\n- read: Read files\n\nAdditional tools may be available.\n</tools>",
		rules: "<rules>\n- Write carefully\n- Read first\n- Keep scope\n- Be concise in your responses\n- Show file paths clearly when working with files\n</rules>",
		docs: `<docs>\nPi documentation (read only when the user asks about the harness itself, its SDK, extensions, themes, skills, or TUI):
- Main documentation: ${getReadmePath()}
- Additional docs: ${getDocsPath()}
- Examples: ${getExamplesPath()} (extensions, custom tools, SDK)
- When reading pi docs or examples, resolve docs/... under Additional docs and examples/... under Examples, not the current working directory
- When asked about: extensions (docs/extensions.md, examples/extensions/), themes (docs/themes.md), skills (docs/skills.md), prompt templates (docs/prompt-templates.md), TUI components (docs/tui.md), keybindings (docs/keybindings.md), SDK integrations (docs/sdk.md), custom providers (docs/custom-provider.md), adding models (docs/models.md), packages (docs/packages.md), environment variables (docs/environment-variables.md), MCP servers (docs/mcp.md), codemode scripts and non-LLM models such as classifiers and image models (docs/codemode.md)
- Before implementing harness changes, read the relevant docs and examples in full, following related cross-references.\n</docs>`,
		addendum: "<addendum>\nExtra\n</addendum>",
		project_context: '<project_context>\nProject-specific instructions and guidelines:\n\n<project_instructions path="/project/AGENTS.md">\nInstructions\n</project_instructions>\n</project_context>',
		cwd: "<cwd>\nC:/work\n</cwd>", policy: "<policy>\nPolicy\n</policy>",
	});
});

it("builds the stock next-run patch and ordered declarations for an existing transcript", () => {
	const clock = mock.method(Date, "now", () => 42);
	try {
		const messages = [{ role: "system", content: "", timestamp: 1, sections: { preamble: "previous", old: "old section" }, toolsAdded: [tool("obsolete"), tool("secret")] }];
		const changes = pendingToolChanges(messages, [tool("write"), tool("secret"), tool("read")], new Set(["secret"]));
		const pending = pendingSystemMessage(messages, options, changes);
		assert.deepEqual(pending?.sections, { ...buildSystemPromptSectionsOf(options), old: null });
		assert.deepEqual(pending?.toolsAdded?.map((item) => item.name), ["write", "read"]);
		assert.deepEqual(pending?.toolsRemoved, [{ name: "obsolete" }]);
	} finally {
		clock.mock.restore();
	}
});

it("projects the next run with a custom RQW prompt and hides declarations throughout the transcript", () => {
	const clock = mock.method(Date, "now", () => 42);
	try {
		const old = tool("old");
		const secret = tool("secret");
		const read = tool("read");
		const write = tool("write");
		const messages = [{ role: "system", content: "", timestamp: 1, sections: { preamble: "old", tools: "old tools", rules: "old rules", docs: "old docs", obsolete: "obsolete" }, toolsAdded: [old, secret] }];
		const projected = { ...options, customPrompt: "RQW prefix" };
		const changes = pendingToolChanges(messages, [write, secret, read], new Set(["secret"]));
		const pending = pendingSystemMessage(messages, projected, changes);
		assert.deepEqual(pending, {
			role: "system", content: "", timestamp: 42,
			sections: { preamble: "RQW prefix", addendum: "<addendum>\nExtra\n</addendum>", project_context: '<project_context>\nProject-specific instructions and guidelines:\n\n<project_instructions path="/project/AGENTS.md">\nInstructions\n</project_instructions>\n</project_context>', cwd: "<cwd>\nC:/work\n</cwd>", policy: "<policy>\nPolicy\n</policy>", tools: null, rules: null, docs: null, obsolete: null },
			toolsAdded: [write, read], toolsRemoved: [{ name: "old" }],
		});
		const visible = withHiddenTools([...messages, pending!], new Set(["secret"]));
		assert.deepEqual(getCurrentSystemMessage(visible as never)?.toolsAdded?.map((item) => item.name), ["write", "read"]);
		assert.deepEqual((visible[0] as typeof messages[0]).toolsAdded.map((item) => item.name), ["old"]);
		assert.deepEqual(messages[0].toolsAdded.map((item) => item.name), ["old", "secret"]);
		assert.equal(pendingSystemMessage(visible, projected, pendingToolChanges(visible, [write, secret, read], new Set(["secret"]))), undefined);
	} finally {
		clock.mock.restore();
	}
});
