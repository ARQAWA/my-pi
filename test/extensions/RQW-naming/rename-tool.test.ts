import assert from "node:assert/strict";
import { describe, it } from "node:test";
import naming from "../../../extensions/RQW-naming/index.ts";

function load() {
	const names: string[] = [];
	let tool: any;
	const pi = {
		on() {},
		registerCommand() {},
		registerTool: (t: unknown) => { tool = t; },
		setSessionName: (name: string) => { names.push(name); },
	};
	naming(pi as never);
	return { names, tool };
}

describe("RQW-naming rename_session tool", () => {
	it("registers rename_session with one required string name", () => {
		const { tool } = load();
		assert.equal(tool.name, "rename_session");
		assert.deepEqual(tool.parameters.required, ["name"]);
		assert.deepEqual(Object.keys(tool.parameters.properties), ["name"]);
		assert.equal(tool.parameters.properties.name.type, "string");
	});

	it("sets the trimmed name", async () => {
		const { names, tool } = load();
		const result = await tool.execute("1", { name: "  Lisbon trip  " });
		assert.deepEqual(names, ["Lisbon trip"]);
		assert.equal(result.content[0].text, 'Session renamed to "Lisbon trip".');
	});

	it("rejects an empty name and sets nothing", async () => {
		const { names, tool } = load();
		await assert.rejects(tool.execute("1", { name: "   " }));
		assert.deepEqual(names, []);
	});
});
