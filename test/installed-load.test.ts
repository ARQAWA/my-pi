// An installed package has only its production dependencies in node_modules: every entry must load through Pi's real
// loader with only Pi's own aliases and those dependencies.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { it } from "node:test";

// Not fs.cpSync: on Windows Node 22.19.0 it kills the process with 0xC0000409 when the source path has Cyrillic letters.
function copyTree(from: string, to: string, skip: (name: string) => boolean = () => false) {
	mkdirSync(to, { recursive: true });
	for (const entry of readdirSync(from, { withFileTypes: true })) {
		if (skip(entry.name)) continue;
		const source = join(from, entry.name), target = join(to, entry.name);
		if (entry.isDirectory()) copyTree(source, target, skip);
		else copyFileSync(source, target);
	}
}

it("every pi.extensions entry loads from a copy with production dependencies only", async () => {
	const root = new URL("../", import.meta.url);
	const source = fileURLToPath(root);
	const manifest = JSON.parse(readFileSync(new URL("package.json", root), "utf8")) as { dependencies: Record<string, string>; pi: { extensions: string[] } };
	const copy = mkdtempSync(join(tmpdir(), "rqw-installed-"));
	try {
		copyTree(join(source, "extensions"), join(copy, "extensions"), name => name === "node_modules");
		for (const name of Object.keys(manifest.dependencies)) {
			copyTree(join(source, "node_modules", name), join(copy, "node_modules", name));
		}
		const home = join(copy, "home");
		mkdirSync(home);
		const loader = join(source, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "core", "extensions", "loader.js");
		const run = spawnSync(process.execPath, [join(source, "test", "installed-load-child.mjs"), loader, copy, ...manifest.pi.extensions.map(entry => join(copy, entry))], {
			encoding: "utf8",
			// Factories write state (RQW-anthropic's install id): keep it inside the temp copy, away from the real agent dir.
			env: { ...process.env, HOME: home, USERPROFILE: home, PI_CODING_AGENT_DIR: join(home, "agent") },
		});
		assert.equal(run.status, 0, run.stderr);
		const loaded = JSON.parse(run.stdout) as { errors: unknown[]; count: number };
		assert.deepEqual(loaded.errors, []);
		assert.equal(loaded.count, manifest.pi.extensions.length);
	} finally {
		rmSync(copy, { recursive: true, force: true });
	}
});
