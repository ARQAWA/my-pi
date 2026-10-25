// Focused isolation check for the real Codex transport (RQW-codex). Only three child sessions run here: everything on,
// RQW-codex off at start, and RQW-codex switched off with /reload. Each child is bounded to 30 seconds. The full
// per-extension matrix stays in isolation.test.ts. The faux provider in isolation-run.ts is a fixture on API "faux-iso",
// outside the owned Codex wire profile; the real Codex transport has its own focused tests in test/extensions/RQW-codex.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const RUN = join(HERE, "isolation-run.ts");
const NAMES: string[] = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).pi.extensions.map(
	(p: string) => /extensions\/([^/]+)\//.exec(p)![1],
);
const CODEX = "RQW-codex";
const WITHOUT_CODEX = NAMES.filter((n) => n !== CODEX);

const POISON = { ANTHROPIC_API_KEY: "isolation-not-a-real-key", OPENROUTER_API_KEY: "isolation-not-a-real-key" };
type Tool = { name: string; by: string; description: string };
type Run = {
	loaded: string[]; errors: string[]; tools: Tool[]; turn: string[]; finished: boolean;
	reserveFor1M: number; sessionWindow: number; selectedModel: string; availableOpus: string[]; networkAttempts: string[];
};

function run(o: { off?: string; reloadOff?: string }): Run {
	const r = spawnSync(process.execPath, [RUN, JSON.stringify({ root: ROOT, ...o })], {
		encoding: "utf8", timeout: 30_000, env: { ...process.env, ...POISON },
	});
	assert.ifError(r.error);
	assert.equal(r.status, 0, `child failed (${r.signal}): ${r.stderr.slice(-2000)}`);
	const line = r.stdout.split("\n").find((l) => l.startsWith("{"));
	assert.ok(line, `child produced no result: ${r.stderr.slice(-2000)}`);
	const result: Run = JSON.parse(line);
	assert.equal(result.selectedModel, "openai-codex/gpt-6.1-sol", "explicit faux model survives startup and reload");
	assert.ok(result.availableOpus.some((id) => id.startsWith("openrouter/")), "poisoned inherited auth makes real OpenRouter Opus available");
	assert.deepEqual(result.networkAttempts, [], "no external network was attempted");
	return result;
}

const key = (t: Tool) => `${t.name} by ${t.by}: ${t.description}`;

describe("isolation (Codex): the real Codex transport on and off", () => {
	const full = run({});
	const off = run({ off: CODEX });
	const viaReload = run({ reloadOff: CODEX });

	it("everything on: loads with no errors and the read tool round-trips through the faux transport", () => {
		assert.deepEqual(full.errors, []);
		assert.deepEqual(full.loaded, NAMES);
		assert.deepEqual(full.turn, ["read:ok"]);
		assert.equal(full.finished, true);
		assert.deepEqual(full.networkAttempts, []);
	});

	it("RQW-codex off at start: the others load with no errors and the read tool round-trips", () => {
		assert.deepEqual(off.errors, []);
		assert.deepEqual(off.loaded, WITHOUT_CODEX);
		assert.deepEqual(off.turn, ["read:ok"]);
		assert.equal(off.finished, true);
	});

	it("RQW-codex off at start: the same registered tools as with everything on, with the same descriptions", () => {
		const others = (x: Run) => x.tools.filter((t) => t.by !== "builtin" && t.by !== CODEX).map(key).sort();
		assert.deepEqual(others(off), others(full));
	});

	it("RQW-codex off at start: compaction reserve and context window of the 1M session match everything on", () => {
		assert.equal(off.reserveFor1M, full.reserveFor1M, "compaction reserve Pi reads for a 1M model");
		assert.equal(off.sessionWindow, full.sessionWindow, "context window of the session model");
	});

	it("RQW-codex switched off with /reload: no errors, the same loaded extensions and tools as starting without it", () => {
		assert.deepEqual(viaReload.errors, []);
		assert.deepEqual(viaReload.loaded, off.loaded, "loaded extensions");
		assert.deepEqual(viaReload.tools.map(key).sort(), off.tools.map(key).sort(), "registered tools");
	});

	it("RQW-codex switched off with /reload: the read tool round-trips and the session finishes", () => {
		assert.deepEqual(viaReload.turn, ["read:ok"]);
		assert.equal(viaReload.finished, true);
	});

	it("RQW-codex switched off with /reload: compaction reserve and context window match starting without it", () => {
		assert.equal(viaReload.reserveFor1M, off.reserveFor1M, "compaction reserve Pi reads for a 1M model");
		assert.equal(viaReload.sessionWindow, off.sessionWindow, "context window of the session model");
	});
});
