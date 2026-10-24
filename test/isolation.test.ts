// Every extension of the package can be switched off alone, the way a user does it (a `packages` settings entry with
// `-extensions/<name>/index.ts`), and the others keep working unchanged. The list comes from package.json
// `pi.extensions`, so a new extension is covered without a change here. Each session runs in a child process
// (isolation-run.ts), because an extension may patch Pi's classes for the life of the process.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { DefaultResourceLoader, SettingsManager } from "@earendil-works/pi-coding-agent";
import { dirname, join, resolve, sep } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const RUN = join(HERE, "isolation-run.ts");
const MANIFEST = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const NAMES: string[] = MANIFEST.pi.extensions.map(
	(p: string) => /extensions\/([^/]+)\//.exec(p)![1],
);

it("isolation: manifest resources are unique and agent cards precede compact tool rendering", () => {
	assert.equal(new Set(MANIFEST.pi.extensions).size, MANIFEST.pi.extensions.length);
	assert.deepEqual(NAMES.slice(-4), ["RQW-thinking", "RQW-naming", "RQW-agent-ui", "RQW-tool-ui"]);
	assert.ok(NAMES.indexOf("RQW-agent-ui") < NAMES.indexOf("RQW-tool-ui"));
	assert.deepEqual(MANIFEST.pi.themes, ["./extensions/RQW-theme/theme.json"]);
	assert.ok(!NAMES.includes("RQW-theme"));
});

it("isolation: the native package loader discovers the manifest theme without extensions", async () => {
	const dir = mkdtempSync(join(tmpdir(), "rqw-theme-resource-"));
	const agentDir = join(dir, "agent");
	const cwd = join(dir, "work");
	mkdirSync(agentDir);
	mkdirSync(cwd);
	writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ packages: [ROOT] }));
	try {
		const loader = new DefaultResourceLoader({ cwd, agentDir, settingsManager: SettingsManager.create(cwd, agentDir),
			noExtensions: true, noSkills: true, noPromptTemplates: true, noContextFiles: true });
		await loader.reload();
		assert.deepEqual(loader.getExtensions().extensions, []);
		assert.deepEqual(loader.getThemes().diagnostics, []);
		assert.deepEqual(loader.getThemes().themes.map(theme => theme.name), ["RQW-theme"]);
		assert.equal(loader.getThemes().themes[0].sourcePath, join(ROOT, MANIFEST.pi.themes[0]));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

// Deliberately inherit apparently configured providers, not real keys. No owner configuration is changed.
const POISON = { OPENROUTER_API_KEY: "isolation-not-a-real-key" };
type Tool = { name: string; by: string; description: string };
type Run = {
	loaded: string[]; errors: string[]; tools: Tool[]; turn: string[]; finished: boolean;
	reserveFor1M: number; sessionWindow: number; selectedModel: string; availableOpus: string[]; networkAttempts: string[];
};

function run(o: { off?: string; reloadOff?: string }): Run {
	const r = spawnSync(process.execPath, [RUN, JSON.stringify({ root: ROOT, ...o })], {
		encoding: "utf8", timeout: 120_000, env: { ...process.env, ...POISON },
	});
	assert.ifError(r.error);
	assert.equal(r.status, 0, `child failed (${r.signal}): ${r.stderr.slice(-2000)}`);
	const line = r.stdout.split("\n").find((l) => l.startsWith("{"));
	assert.ok(line, `child produced no result: ${r.stderr.slice(-2000)}`);
	const result: Run = JSON.parse(line);
	assert.equal(result.selectedModel, "openai-codex/gpt-6.1-sol", "explicit faux model survives startup and reload");
	assert.ok(result.availableOpus.some((id) => id.startsWith("openrouter/")), "poisoned inherited auth makes real OpenRouter Opus available");
	assert.deepEqual(result.networkAttempts, [], "no transport was attempted");
	return result;
}

function files(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
		d.isDirectory() ? (d.name === "node_modules" ? [] : files(join(dir, d.name))) : /\.(m?[jt]s)$/.test(d.name) ? [join(dir, d.name)] : [],
	);
}

it("isolation: a swallowed external fetch is blocked and still fails the helper", () => {
	const r = spawnSync(process.execPath, [RUN, JSON.stringify({ root: ROOT, probeNetwork: true })], {
		encoding: "utf8", timeout: 120_000, env: { ...process.env, ...POISON },
	});
	assert.ifError(r.error);
	assert.equal(r.status, 1);
	assert.match(r.stderr, /Isolation network blocked: fetch/);
	assert.equal(r.stdout, "");
});

describe("isolation: no extension reaches into another extension's folder", () => {
	for (const name of NAMES) {
		it(`${name}: every relative import, tests included, stays inside extensions/${name}/`, () => {
			const own = join(ROOT, "extensions", name) + sep;
			const outside: string[] = [];
			for (const file of files(own)) {
				const text = readFileSync(file, "utf8");
				for (const m of text.matchAll(/(?:from\s+|import\s*\(\s*|import\s+)["'](\.{1,2}\/[^"']+)["']/g)) {
					if (!resolve(dirname(file), m[1]).startsWith(own)) outside.push(`${file.slice(own.length)} -> ${m[1]}`);
				}
			}
			assert.deepEqual(outside, []);
		});
	}
});

describe("isolation: the package with one extension switched off", () => {
	const full = run({});
	const key = (t: Tool) => `${t.name} by ${t.by}: ${t.description}`;

	it("everything on: loads and works", () => {
		assert.deepEqual(full.errors, []);
		assert.deepEqual(full.loaded, NAMES);
		assert.deepEqual(full.turn, ["read:ok"]);
		assert.equal(full.finished, true);
	});

	for (const off of NAMES) {
		describe(`${off} off`, () => {
			const r = run({ off });
			const viaReload = run({ reloadOff: off });

			it("the others load, with no errors", () => {
				assert.deepEqual(r.errors, []);
				assert.deepEqual(r.loaded, NAMES.filter((n) => n !== off));
			});

			it("the others register exactly the tools they register with everything on, with the same descriptions", () => {
				const others = (x: Run) => x.tools.filter((t) => t.by !== "builtin" && t.by !== off).map(key).sort();
				assert.deepEqual(others(r), others(full));
			});

			it("a model turn with a tool call completes", () => {
				assert.deepEqual(r.turn, ["read:ok"]);
				assert.equal(r.finished, true);
			});

			it("switching it off with /reload leaves the same state as starting without it", () => {
				assert.deepEqual(viaReload.errors, []);
				assert.deepEqual(viaReload.loaded, r.loaded, "loaded extensions");
				assert.deepEqual(viaReload.tools.map(key).sort(), r.tools.map(key).sort(), "registered tools");
				assert.equal(viaReload.reserveFor1M, r.reserveFor1M, "compaction reserve Pi reads for a 1M model");
				assert.equal(viaReload.sessionWindow, r.sessionWindow, "context window of the session model");
			});
		});
	}
});
