import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { describe, it } from "node:test";
import { DefaultResourceLoader } from "@earendil-works/pi-coding-agent";

const FOLDER = join(import.meta.dirname, "..");
const EXTENSION = join(FOLDER, "index.ts");
const PACKAGES = new Set(["@earendil-works/pi-ai", "@earendil-works/pi-coding-agent"]);
const EVENTS = ["session_start", "message_end", "session_compact", "session_info_changed", "session_shutdown"];

async function sourceFiles(dir: string): Promise<string[]> {
	const out: string[] = [];
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) out.push(...await sourceFiles(path));
		else if (entry.name.endsWith(".ts")) out.push(path);
	}
	return out;
}

describe("RQW-naming isolation", () => {
	it("imports stay inside the folder or the public root packages (tests included)", async () => {
		const files = await sourceFiles(FOLDER);
		assert.ok(files.length >= 5, "found the naming sources and tests");
		const pattern = /(?:from|import)\s*\(?\s*["']([^"']+)["']/g;
		for (const file of files) {
			const text = await readFile(file, "utf8");
			for (const match of text.matchAll(pattern)) {
				const specifier = match[1];
				if (specifier.startsWith(".")) {
					const target = resolve(join(file, ".."), specifier);
					assert.ok(!relative(FOLDER, target).startsWith(".."), `${relative(FOLDER, file)} imports outside the folder: ${specifier}`);
				} else {
					assert.ok(PACKAGES.has(specifier) || specifier.startsWith("node:"), `${relative(FOLDER, file)} imports ${specifier}`);
				}
			}
		}
	});

	it("loads only this extension, with only its public event and command surface", async () => {
		const dir = await mkdtemp(join(tmpdir(), "rqw-naming-isolation-"));
		try {
			const loader = new DefaultResourceLoader({ cwd: dir, agentDir: dir, noExtensions: true, additionalExtensionPaths: [EXTENSION],
				noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
			await loader.reload();
			const result = loader.getExtensions();
			assert.deepEqual(result.errors, []);
			assert.equal(result.extensions.length, 1);
			const [extension] = result.extensions;
			assert.equal(extension.resolvedPath, EXTENSION);
			assert.deepEqual([...extension.commands.keys()], ["rename-gen"]);
			assert.deepEqual([...extension.handlers.keys()].sort(), [...EVENTS].sort());
			assert.equal(extension.tools.size, 0);
		} finally { await rm(dir, { recursive: true, force: true }); }
	});
});
