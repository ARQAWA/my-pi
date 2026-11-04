import assert from "node:assert/strict";
import { describe, it } from "node:test";
import naming from "../../../extensions/RQW-naming/index.ts";

function load() {
	const names: string[] = [];
	let tool: any;
	const pi = {
		events: { on() {}, emit() {} },
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

	it("offers only the tool to a child, bound to the child's own session", async () => {
		const parentNames: string[] = [];
		const listeners: Record<string, (request: unknown) => void> = {};
		const parent = {
			events: { on: (name: string, listener: (request: unknown) => void) => { listeners[name] = listener; }, emit() {} },
			on() {},
			registerCommand() {},
			registerTool() {},
			setSessionName: (name: string) => { parentNames.push(name); },
		};
		naming(parent as never);
		let offered: ((child: unknown) => void) | undefined;
		let offeredTools: string[] | undefined;
		listeners["rqw-agent:subagent-extension-factories"]!({ offer: (factory: (child: unknown) => void, tools: string[]) => { offered = factory; offeredTools = tools; } });
		assert.ok(offered);
		assert.deepEqual(offeredTools, ["rename_session"]);

		const childNames: string[] = [];
		const registered: any[] = [];
		const hooks: string[] = [];
		const commands: string[] = [];
		offered!({
			events: { on() {}, emit() {} },
			on: (name: string) => { hooks.push(name); },
			registerCommand: (name: string) => { commands.push(name); },
			registerTool: (tool: unknown) => { registered.push(tool); },
			setSessionName: (name: string) => { childNames.push(name); },
		});
		assert.deepEqual(registered.map((tool) => tool.name), ["rename_session"]);
		assert.deepEqual(hooks, []);
		assert.deepEqual(commands, []);
		await registered[0].execute("1", { name: "Child work" });
		assert.deepEqual(childNames, ["Child work"]);
		assert.deepEqual(parentNames, []);
	});
});
