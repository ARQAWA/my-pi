// Oracle tests: the port in ../tool-sampling.ts against the actual Pi 1.4.0 files (sha256 pinned in the port header).
// The Pi files are read through the package's public `./api/*` export in tests only; production imports nothing from Pi's subpaths.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Api, Context, Model, Tool } from "@earendil-works/pi-ai";
import * as pi from "@earendil-works/pi-ai/api/constrained-sampling";
import * as piResponses from "@earendil-works/pi-ai/api/openai-responses-shared";
import { buildTools, toolWireFlags, grammarToolInputProperties } from "../wire.ts";
import * as port from "../tool-sampling.ts";

type AnyTool = Tool;
const tool = (name: string, parameters: unknown, constrainedSampling?: Tool["constrainedSampling"]): AnyTool =>
	({ name, description: `${name} tool`, parameters, ...(constrainedSampling === undefined ? {} : { constrainedSampling })}) as unknown as AnyTool;

const OBJECT = { type: "object", properties: { path: { type: "string" }, limit: { type: "integer" }, mode: { anyOf: [{ type: "string" }, { type: "null" }] } }, required: ["path"] };
const REF = { type: "object", properties: { path: { $ref: "#/$defs/p" } }, required: ["path"], $defs: { p: { type: "string" } } };
const UNION_OBJECT = { type: "object", properties: { a: { anyOf: [{ type: "object", properties: {} }, { type: "string" }] } }, required: ["a"] };
const UNICODE = { type: "object", properties: { "путь": { type: "string" }, "文件": { type: "integer" } }, required: ["путь"] };
const CODE = { type: "object", properties: { code: { type: "string" } }, required: ["code"] };
const TWO_REQUIRED = { type: "object", properties: { a: { type: "string" }, b: { type: "string" } }, required: ["a", "b"] };
const TUPLE = { type: "object", properties: { t: { type: "array", items: [{ type: "string" }] } }, required: ["t"] };
const NUMERIC_ITEMS = { type: "object", properties: { xs: { type: "array", items: { type: "string" } } }, required: ["xs"] };
const EMPTY_SCHEMA = { type: "object", properties: {}, required: [] };

const SAMPLES: AnyTool[] = [
	tool("plain", OBJECT),
	tool("prefer", OBJECT, { type: "json_schema", strict: "prefer" }),
	tool("require", OBJECT, { type: "json_schema", strict: "require" }),
	tool("prefer-ref", REF, { type: "json_schema", strict: "prefer" }),
	tool("require-ref", REF, { type: "json_schema", strict: "require" }),
	tool("prefer-union", UNION_OBJECT, { type: "json_schema", strict: "prefer" }),
	tool("prefer-tuple", TUPLE, { type: "json_schema", strict: "prefer" }),
	tool("prefer-unicode", UNICODE, { type: "json_schema", strict: "prefer" }),
	tool("prefer-items", NUMERIC_ITEMS, { type: "json_schema", strict: "prefer" }),
	tool("prefer-empty", EMPTY_SCHEMA, { type: "json_schema", strict: "prefer" }),
	tool("off", OBJECT, false),
	tool("grammar-lark", CODE, { type: "grammar", variants: { openai_lark: "start: /.+/" } }),
	tool("grammar-regex", CODE, { type: "grammar", variants: { openai_regex: "^.+$" } }),
	tool("grammar-both", CODE, { type: "grammar", variants: { openai_lark: "start: /x/", openai_regex: "^x$" } }),
	tool("grammar-blank", CODE, { type: "grammar", variants: { openai_lark: "   " } }),
	tool("grammar-none", CODE, { type: "grammar", variants: {} }),
	tool("grammar-two-required", TWO_REQUIRED, { type: "grammar", variants: { openai_lark: "start: /x/" } }),
	tool("grammar-unicode", UNICODE, { type: "grammar", variants: { openai_lark: "start: /ж/" } }),
];

function attempt<T>(fn: () => T): { ok: true; value: T } | { ok: false; message: string } {
	try {
		return { ok: true, value: fn() };
	} catch (error) {
		return { ok: false, message: error instanceof Error ? error.message : String(error) };
	}
}

describe("port matches Pi 1.4.0 constrained-sampling", () => {
	for (const sample of SAMPLES) {
		it(`${sample.name}: strict decision, parameters and grammar resolution agree with Pi`, () => {
			for (const supportsStrict of [true, false]) {
				assert.deepEqual(
					attempt(() => port.resolveJsonSchemaStrictSampling(sample, supportsStrict)),
					attempt(() => pi.resolveJsonSchemaStrictSampling(sample, supportsStrict)),
				);
			}
			const strict = attempt(() => port.resolveJsonSchemaStrictSampling(sample, true));
			if (strict.ok) {
				assert.deepEqual(port.getJsonSchemaToolParameters(sample, strict.value), pi.getJsonSchemaToolParameters(sample, strict.value));
			}
			assert.deepEqual(attempt(() => port.resolveGrammarConstrainedSampling(sample, true)), attempt(() => pi.resolveGrammarConstrainedSampling(sample, true)));
			assert.deepEqual(attempt(() => port.resolveGrammarConstrainedSampling(sample, false)), attempt(() => pi.resolveGrammarConstrainedSampling(sample, false)));
		});
	}

	it("the grammar input-property map agrees with Pi", () => {
		const a = attempt(() => port.createGrammarToolInputProperties(SAMPLES, true));
		const b = attempt(() => pi.createGrammarToolInputProperties(SAMPLES, true));
		assert.equal(a.ok, b.ok);
		if (a.ok && b.ok) assert.deepEqual([...a.value.entries()], [...b.value.entries()]);
	});

	it("unsupported prefer is non-strict and unsupported require throws the same message as Pi", () => {
		assert.equal(attempt(() => port.resolveJsonSchemaStrictSampling(SAMPLES[3], true)).ok && port.resolveJsonSchemaStrictSampling(SAMPLES[3], true), undefined);
		const r = attempt(() => port.resolveJsonSchemaStrictSampling(SAMPLES[4], true));
		const p = attempt(() => pi.resolveJsonSchemaStrictSampling(SAMPLES[4], true));
		assert.equal(r.ok, false);
		assert.deepEqual(r, p);
	});
});

describe("grammar tool input (lexical, unicode, empty arguments)", () => {
	it("raw input is the named property; empty or non-string arguments refuse as Pi does", () => {
		assert.equal(port.getGrammarToolInput("exec", { code: "ls \"a\"\n" }, "code"), pi.getGrammarToolInput("exec", { code: "ls \"a\"\n" }, "code"));
		assert.equal(port.getGrammarToolInput("exec", { code: "ж" }, "code"), "ж");
		assert.throws(() => port.getGrammarToolInput("exec", {}, "code"), /requires argument "code"/);
		assert.throws(() => pi.getGrammarToolInput("exec", {}, "code"), /requires argument "code"/);
	});
});

describe("wire tool declarations agree with Pi 1.4.0 convertResponsesTools", () => {
	const model = { id: "m", api: "openai-codex-responses", provider: "openai-codex", input: ["text"], compat: { supportsStrictMode: true, supportsOpenAIGrammarTools: true } } as unknown as Model<Api>;
	const cases = SAMPLES.filter((s) => attempt(() => pi.resolveJsonSchemaStrictSampling(s, true)).ok && attempt(() => pi.resolveGrammarConstrainedSampling(s, true)).ok);
	const context: Context = { messages: [], tools: cases };

	it("non-lite: each declaration has the same type, name, description, strict, grammar and parameters as Pi", () => {
		const ours = buildTools(cases, false, toolWireFlags(model)) as Record<string, unknown>[];
		const theirs = piResponses.convertResponsesTools(cases, { strict: undefined, supportsStrictMode: true, supportsOpenAIGrammarTools: true }) as Record<string, unknown>[];
		assert.deepEqual(ours.map((item) => ({ ...item, strict: item.type === "function" ? item.strict : undefined })), theirs.map((item) => ({ ...item, strict: item.type === "function" ? item.strict : undefined })));
	});

	it("the grammar map from wire equals Pi's map for the same transcript catalog", () => {
		const ours = grammarToolInputProperties(model, context);
		const theirs = pi.createGrammarToolInputProperties(cases, true);
		assert.deepEqual([...ours.entries()], [...theirs.entries()]);
	});
});
