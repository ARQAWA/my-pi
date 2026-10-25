import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { validateToolArguments } from "@earendil-works/pi-ai/utils/validation";
import { createTools } from "../../../extensions/RQW-tools/index.ts";

const tools = createTools(process.cwd(), () => ({}));
after(() => (tools.find((tool) => tool.name === "job") as any).jobs.dispose());
let dir: string;
before(async () => {
	dir = await mkdtemp(join(tmpdir(), "rqw-search-null-"));
	await writeFile(join(dir, "a.txt"), "hit\nhit\nhit\n");
});
after(() => rm(dir, { recursive: true, force: true }));

function prepare(tool: any, args: any): any {
	return tool.prepareArguments ? tool.prepareArguments(args) : args;
}

function validated(tool: any, args: any): any {
	return validateToolArguments(tool, { type: "toolCall", id: "search", name: tool.name, arguments: prepare(tool, args) });
}

for (const name of ["grep", "find"]) {
	const tool: any = tools.find((entry) => entry.name === name);
	const required = tool.parameters.required ?? [];
	const optional = Object.keys(tool.parameters.properties).filter((key) => !required.includes(key));
	const base = { pattern: name === "grep" ? "hit" : "*.txt" };
	describe(`${name} null optional fields`, () => {
		for (const key of optional) {
			for (const value of [null, "null", undefined]) {
				it(`${key}: ${String(value)} behaves as absent before validation`, () => {
					const input = { ...base, [key]: value };
					assert.deepEqual(prepare(tool, input), base);
					assert.deepEqual(validated(tool, input), validated(tool, base));
					assert.ok(Object.hasOwn(input, key), "does not mutate the input");
				});
			}
		}

		it("all null optional fields give the same search results as absent fields", async () => {
			const execute = (args: any) => tool.execute("search", validated(tool, args), undefined, undefined, { cwd: dir });
			const expected = await execute(base);
			for (const value of [null, "null"]) {
				assert.deepEqual(await execute({ ...base, ...Object.fromEntries(optional.map((key) => [key, value])) }), expected);
			}
			assert.match(expected.content[0].text, /a\.txt/);
		});

		it("preserves required patterns and meaningful optional values", () => {
			const values = name === "grep"
				? { path: ".", glob: "*.txt", ignoreCase: false, literal: true, context: 0, limit: 2 }
				: { path: ".", limit: 2 };
			const input = { pattern: "null", ...values };
			assert.deepEqual(prepare(tool, input), input);
			assert.deepEqual(validated(tool, input), input);
			assert.deepEqual(prepare(tool, { pattern: null }), { pattern: null });
			assert.deepEqual(prepare(tool, { ...base, path: "" }), { ...base, path: "" });
		});
	});
}
