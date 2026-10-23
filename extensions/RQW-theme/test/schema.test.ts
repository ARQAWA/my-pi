// The theme asset against Pi 1.4.0's shipped theme schema (read as data) and the public typebox compiler.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { Compile } from "typebox/compile";

const HERE = dirname(fileURLToPath(import.meta.url));
const ASSET = join(HERE, "..", "theme.json");
const DONOR_UNSUPPORTED = /^(pythonMode|statusLine[A-Za-z]+)$/;
// Pi 1.4.0 from the package's own dependency tree (byte-identical to the global install, see the evidence log).
const SCHEMA = join(HERE, "..", "..", "..", "node_modules", "@earendil-works", "pi-coding-agent", "schemas", "theme.schema.json");

const theme = JSON.parse(readFileSync(ASSET, "utf8"));
const schema = JSON.parse(readFileSync(SCHEMA, "utf8"));
const check = Compile(schema);

describe("RQW-theme strict native schema", () => {
	it("schema-accepts-asset", () => {
		const ok = check.Check(theme);
		assert.equal(ok, true, JSON.stringify([...check.Errors(theme)].slice(0, 5)));
	});

	it("schema-rejects-donor-shape", () => {
		// The donor is OMP JSON with unknown keys; the same compiler must reject it, proving the check is strict.
		const donor = { ...theme, symbols: { overrides: {} }, colors: { ...theme.colors, pythonMode: "#ffb347", statusLineBg: "" } };
		assert.equal(check.Check(donor), false);
	});

	it("name-is-own-and-slash-free", () => {
		assert.equal(theme.name, "RQW-theme");
		assert.ok(!theme.name.includes("/"));
	});

	it("colors-only-native-tokens", () => {
		const allowed = new Set(Object.keys(schema.properties.colors.properties));
		const extra = Object.keys(theme.colors).filter((k) => !allowed.has(k));
		assert.deepEqual(extra, []);
		assert.equal(Object.keys(theme.colors).some((k) => DONOR_UNSUPPORTED.test(k)), false);
		assert.equal("symbols" in theme, false);
		assert.equal("$schema" in theme, false);
	});

	it("every-required-token-present", () => {
		for (const key of schema.properties.colors.required) {
			assert.ok(key in theme.colors, `missing ${key}`);
		}
	});

	it("terminal-default-delegation-kept", () => {
		for (const key of ["accent", "text", "userMessageText", "customMessageText", "toolTitle"]) {
			assert.equal(theme.colors[key], "", `${key} must delegate to the terminal default`);
		}
		assert.equal(theme.export.pageBg, "ink");
	});

	it("approved-surfaces-exact", () => {
		assert.equal(theme.vars.coal, "#181818");
		assert.equal(theme.colors.toolPendingBg, "coal");
		assert.equal(theme.colors.toolSuccessBg, "coal");
		assert.equal(theme.vars.card, "#232120");
		assert.equal(theme.colors.userMessageBg, "card");
	});

	it("thinking-tokens-kept", () => {
		for (const key of ["thinkingOff", "thinkingMinimal", "thinkingLow", "thinkingMedium", "thinkingHigh", "thinkingXhigh", "thinkingMax"]) {
			assert.ok(key in theme.colors, `missing ${key}`);
		}
	});

	// Effort colours (brief section 0: low ordinary, medium green, high gold, extra-high bright purple, max bright red).
	// Gold #c9a227 is the brief's source gold; purple #b97cff is the owner-accepted carrier purple (browser-preview/index.html
	// P.purple). Pi colours the editor border by level with these tokens, and the RQW-agent-ui card paints the effort with them.
	it("effort-colours-pinned", () => {
		const resolve = (key: string) => theme.vars[theme.colors[key]] ?? theme.colors[key];
		assert.equal(theme.colors.thinkingLow, "steel");
		assert.equal(theme.colors.thinkingOff, "graphite");
		assert.equal(theme.colors.thinkingMinimal, "#4a4846");
		assert.equal(resolve("thinkingMedium"), theme.vars.readoutGreen);
		assert.equal(resolve("thinkingMedium"), "#00ff88");
		assert.equal(resolve("thinkingHigh"), "#c9a227");
		assert.equal(resolve("thinkingXhigh"), "#b97cff");
		assert.equal(resolve("thinkingMax"), theme.vars.alertRed);
		assert.equal(resolve("thinkingMax"), "#ff4757");
		// The generic tokens are untouched: accent delegates to the terminal, warning stays amber.
		assert.equal(theme.colors.accent, "");
		assert.equal(resolve("warning"), "#ffb347");
	});
});
