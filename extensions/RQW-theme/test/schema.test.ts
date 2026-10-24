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
		// Card colours, option C of the comparison page (DECISIONS.md Theme): grey running, turquoise success,
		// dark red error, slate agent answer. All four are direct hex values, no shared variable.
		assert.equal(theme.colors.toolPendingBg, "#222222");
		assert.equal(theme.colors.toolSuccessBg, "#062b29");
		assert.equal(theme.colors.toolErrorBg, "#351c22");
		assert.equal(theme.colors.customMessageBg, "#192538");
		assert.equal("coal" in theme.vars, false);
		// Neighbouring surfaces stay as they were: the export info panel keeps `panel`, selected rows keep `cardHi`.
		assert.equal(theme.vars.panel, "#1c1b1a");
		assert.equal(theme.export.infoBg, "panel");
		assert.equal(theme.colors.selectedBg, "cardHi");
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

// The owner's OMP theme `titanium-arq` (~/.omp/agent/themes/titanium-arq.json, sha256
// 90dc449809ef97389ec7ffec56ac00f758d4311aa7696f13c2eba3aa062beb43, identical to settings/titanium-arq.json on master of the
// OMP harness): every colour Pi's schema can carry, as the source resolves it. The only deliberate differences are the
// four agreed card backgrounds and the five accepted effort colours; they are pinned in the tests above.
describe("RQW-theme fidelity to the OMP source theme", () => {
	const SOURCE: Record<string, string> = {
		"accent": "",
		"border": "#2c2b2a",
		"borderAccent": "#5f5e5c",
		"borderMuted": "#222120",
		"success": "#00ff88",
		"error": "#ff4757",
		"warning": "#ffb347",
		"muted": "#8d8d8c",
		"dim": "#5f5e5c",
		"text": "",
		"thinkingText": "#8d8d8c",
		"selectedBg": "#2a2826",
		"userMessageBg": "#232120",
		"userMessageText": "",
		"customMessageText": "",
		"customMessageLabel": "#b6b6b5",
		"toolTitle": "",
		"toolOutput": "#8d8d8c",
		"mdHeading": "#f0f0f0",
		"mdLink": "#d6d6dd",
		"mdLinkUrl": "#8d8d8c",
		"mdCode": "#b6b6b5",
		"mdCodeBlock": "#d6d6dd",
		"mdCodeBlockBorder": "#2c2b2a",
		"mdQuote": "#8d8d8c",
		"mdQuoteBorder": "#3a3836",
		"mdHr": "#2c2b2a",
		"mdListBullet": "#8d8d8c",
		"toolDiffAdded": "#00ff88",
		"toolDiffRemoved": "#ff4757",
		"toolDiffContext": "#8d8d8c",
		"syntaxComment": "#5f5e5c",
		"syntaxKeyword": "#b6b6b5",
		"syntaxFunction": "#f0f0f0",
		"syntaxVariable": "#d6d6dd",
		"syntaxString": "#8d8d8c",
		"syntaxNumber": "#b6b6b5",
		"syntaxType": "#d6d6dd",
		"syntaxOperator": "#b6b6b5",
		"syntaxPunctuation": "#8d8d8c",
		"thinkingOff": "#3a3836",
		"thinkingMinimal": "#4a4846",
		"thinkingLow": "#5f5e5c",
		"bashMode": "#00ff88"
	};
	const resolve = (key: string) => (theme.colors[key] === "" ? "" : theme.vars[theme.colors[key]] ?? theme.colors[key]);

	it("every non-overridden colour is the source value, userMessageBg included", () => {
		for (const [key, value] of Object.entries(SOURCE)) assert.equal(resolve(key), value, key);
		assert.equal(resolve("userMessageBg"), "#232120");
		assert.equal(resolve("userMessageText"), "", "empty: the terminal default, as in the source");
	});

	it("no colour outside the source set and the agreed overrides appears", () => {
		const agreed = ["customMessageBg", "toolPendingBg", "toolSuccessBg", "toolErrorBg", "thinkingMedium", "thinkingHigh", "thinkingXhigh", "thinkingMax"];
		assert.deepEqual(Object.keys(theme.colors).filter((key) => !(key in SOURCE) && !agreed.includes(key)), []);
	});
});
