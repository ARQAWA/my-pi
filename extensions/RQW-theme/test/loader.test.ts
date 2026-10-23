// Pi's own resource loader finds the asset through a temporary package (package.json `pi.themes`), with isolated
// agent and project directories. No extension of this package is loaded: this proves the theme resource alone.
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { DefaultResourceLoader, SettingsManager } from "@earendil-works/pi-coding-agent";

const HERE = dirname(fileURLToPath(import.meta.url));
const ASSET = join(HERE, "..", "theme.json");

let root: string;
let agentDir: string;
let cwd: string;
let pkg: string;

/** A package that declares the asset the way the repository's package.json will (pi.themes, package-relative). */
function makePackage(dir: string) {
	mkdirSync(dir, { recursive: true });
	copyFileSync(ASSET, join(dir, "theme.json"));
	writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "rqw-theme-fixture", version: "0.0.0", pi: { themes: ["./theme.json"] } }, null, 2));
}

async function loadThemes(packages: string[]) {
	writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ packages }));
	const settingsManager = SettingsManager.create(cwd, agentDir);
	const loader = new DefaultResourceLoader({
		cwd, agentDir, settingsManager,
		noExtensions: true, noSkills: true, noPromptTemplates: true, noContextFiles: true,
	});
	await loader.reload();
	return loader.getThemes();
}

before(() => {
	root = mkdtempSync(join(tmpdir(), "rqw-theme-loader-"));
	agentDir = join(root, "agent");
	cwd = join(root, "project");
	pkg = join(root, "pkg");
	mkdirSync(agentDir, { recursive: true });
	mkdirSync(cwd, { recursive: true });
	makePackage(pkg);
});
after(() => {
	rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

describe("RQW-theme loader", () => {
	it("loader-accepts-asset-once", async () => {
		const { themes, diagnostics } = await loadThemes([pkg]);
		const named = themes.filter((t) => t.name === "RQW-theme");
		assert.equal(named.length, 1, `expected exactly one RQW-theme, got ${named.length}`);
		assert.deepEqual(diagnostics.filter((d) => d.type !== "info"), [], JSON.stringify(diagnostics));
		assert.ok(named[0].sourcePath?.endsWith(join("pkg", "theme.json")), "loaded from the package, not a copy elsewhere");
	});

	it("no-theme-without-package", async () => {
		const { themes } = await loadThemes([]);
		assert.equal(themes.some((t) => t.name === "RQW-theme"), false);
	});
});
