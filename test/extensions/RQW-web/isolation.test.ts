import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { describe, it } from "node:test";
import { DefaultResourceLoader, type ExtensionAPI, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { createWebExtension } from "../../../extensions/RQW-web/index.ts";

const FOLDER = join(import.meta.dirname, "../../../extensions/RQW-web");
const EXTENSION = join(FOLDER, "index.ts");

async function sourceFiles(dir: string): Promise<string[]> {
	const out: string[] = [];
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) out.push(...await sourceFiles(path));
		else if (entry.name.endsWith(".ts")) out.push(path);
	}
	return out;
}

describe("RQW-web independence", () => {
	it("has no imports outside its folder, including tests and transport snapshot", async () => {
		for (const file of [...await sourceFiles(FOLDER), ...await sourceFiles(import.meta.dirname)]) {
			const text = await readFile(file, "utf8");
			for (const match of text.matchAll(/(?:from\s+|import\s*\(\s*|import\s+)["'](\.{1,2}\/[^"']+)["']/g)) {
				assert.ok(!relative(FOLDER, resolve(dirname(file), match[1])).startsWith(".."), `${file}: ${match[1]}`);
			}
		}
	});

	it("loads only this extension without either tools or Codex extensions", async () => {
		const dir = await mkdtemp(join(tmpdir(), "rqw-search-isolation-"));
		try {
			const loader = new DefaultResourceLoader({ cwd: dir, agentDir: dir, noExtensions: true, additionalExtensionPaths: [EXTENSION],
				noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
			await loader.reload();
			const result = loader.getExtensions();
			assert.deepEqual(result.errors, []);
			assert.equal(result.extensions.length, 1);
			const [extension] = result.extensions;
			assert.equal(extension.resolvedPath, EXTENSION);
			assert.deepEqual([...extension.tools.keys()], ["web"]);
			assert.equal(extension.commands.size, 0);
			assert.equal(extension.handlers.size, 0);
		} finally { await rm(dir, { recursive: true, force: true }); }
	});

	it("offers a registration that captures each recipient's thinking, not the parent's", async () => {
		let parentTool: ToolDefinition | undefined;
		let childTool: ToolDefinition | undefined;
		let handler: ((request: unknown) => void) | undefined;
		const runs: { model: string; effort: string }[] = [];
		const extension = createWebExtension({ runner: async run => {
			runs.push({ model: run.model, effort: run.effort });
			return { target: run.target, model: run.model, effort: run.effort, mode: run.mode, responseLength: run.responseLength,
				status: "ok", summary: "[Docs](https://example.com)", sources: [{ url: "https://example.com" }], citations: [], actions: [], results: [] };
		} });
		extension({ registerTool: tool => { parentTool = tool; }, getThinkingLevel: () => "low",
			events: { on: (name, callback) => { assert.equal(name, "rqw-search:subagent-web"); handler = callback; } } } as unknown as ExtensionAPI);
		assert.ok(parentTool);
		let register: ((api: ExtensionAPI) => void) | undefined;
		handler!({ offer: (value: typeof register) => { register = value; } });
		assert.ok(register);
		register({ registerTool: tool => { childTool = tool; }, getThinkingLevel: () => "high" } as unknown as ExtensionAPI);
		const ctx = { model: { provider: "anthropic", id: "claude-opus-5-5" } };
		await parentTool.execute("p", { queries: ["parent"] }, undefined, undefined, ctx as never);
		await childTool!.execute("c", { queries: ["child"] }, undefined, undefined, ctx as never);
		assert.deepEqual(runs, [{ model: "gpt-6.1-sol", effort: "low" }, { model: "gpt-6.1-sol", effort: "xhigh" }]);
	});
});
