import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import { it } from "node:test";

const ROOT = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { pi: { extensions: string[] } };

function sourceFiles(dir: string, resources = false): string[] {
	if (!existsSync(dir)) return [];
	return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return entry.name === "node_modules" ? [] : sourceFiles(path, resources);
		return (resources ? /\.(?:[cm]?[jt]s|md|toml|json)$/ : /\.[cm]?[jt]s$/).test(entry.name) ? [path] : [];
	});
}

it("harness sources do not reference repository development tooling", () => {
	const forbidden = /PROCESS\.md|coordinator\.lock|\.pi[\/\\]extensions|my-pi-evidence|my-pi-worktrees|qa-status|ci-watch|BACKLOG\.md|repository's mandatory weakening review|project `(?:test-reviewer|requirements-test-reviewer)`/;
	assert.doesNotMatch(JSON.stringify(manifest.pi), forbidden, "package.json pi resources");
	const files = [
		...sourceFiles(join(ROOT, "extensions"), true),
		...sourceFiles(join(ROOT, "pcli-vscode"), true)
			.filter(file => !inside(file, join(ROOT, "pcli-vscode", "test"))),
	];
	for (const file of files) {
		assert.doesNotMatch(readFileSync(file, "utf8"), forbidden, file);
	}
});

function inside(path: string, dir: string): boolean {
	return path === dir || path.startsWith(dir + sep);
}

it("every extension and its tests keep relative imports inside their own trees", () => {
	const outside: string[] = [];
	for (const entry of manifest.pi.extensions) {
		const extensionDir = dirname(resolve(ROOT, entry));
		const testDir = join(ROOT, "test", "extensions", basename(extensionDir));
		for (const file of [...sourceFiles(extensionDir), ...sourceFiles(testDir)]) {
			const text = readFileSync(file, "utf8");
			for (const match of text.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)["'](\.{1,2}\/[^"']+)["']/g)) {
				const target = resolve(dirname(file), match[1]);
				const allowed = inside(target, extensionDir) || (inside(file, testDir) && inside(target, testDir));
				if (!allowed) outside.push(`${file.slice(ROOT.length + 1)} -> ${match[1]}`);
			}
		}
	}
	assert.deepEqual(outside, []);
});
