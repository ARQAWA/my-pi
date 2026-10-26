import assert from "node:assert/strict";
import { AgentSession, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { it } from "node:test";
import settings from "../../../extensions/RQW-settings/index.ts";

function activeTools(selected: boolean, manualReload = false): string[] {
	const prototype = AgentSession.prototype;
	const native = Object.getOwnPropertyDescriptor(prototype, "bindExtensions")!;
	const argv = process.argv;
	Object.defineProperty(prototype, "bindExtensions", { ...native, value: function () { return "native"; } });
	process.argv = argv.slice(0, 2);
	const handlers = new Map<string, ((event: any, ctx: any) => void)[]>();
	let active = ["bash", "read"];
	const pi = {
		on(name: string, handler: (event: any, ctx: any) => void) {
			handlers.set(name, [...(handlers.get(name) ?? []), handler]);
			return () => {};
		},
		registerCommand() {},
		events: { on: () => () => {}, emit: () => {} },
		getSettings: () => ({}),
		getAllTools: () => ["bash", "read", "codemode", "tool_search"].map(name => ({ name })),
		getActiveTools: () => active,
		setActiveTools: (names: string[]) => { active = names; },
	};
	const manager = {};
	const session = {
		sessionManager: manager,
		_usesDefaultTools: !selected,
		_defaultToolModifiers: selected ? ["read"] : [],
		_excludedTools: undefined,
		_allowedTools: undefined,
	};
	try {
		settings(pi as unknown as ExtensionAPI);
		prototype.bindExtensions.call(session);
		for (const handler of handlers.get("session_start") ?? []) handler({ reason: "startup" }, { sessionManager: manager });
		if (manualReload) {
			active = ["bash", "read"];
			prototype.bindExtensions.call(session);
			for (const handler of handlers.get("session_start") ?? []) handler({ reason: "reload" }, { sessionManager: manager });
		}
		return active;
	} finally {
		for (const handler of handlers.get("session_shutdown") ?? []) handler({}, {});
		process.argv = argv;
		Object.defineProperty(prototype, "bindExtensions", native);
	}
}

it("enables codemode and tool_search when no tool selection was given", () => {
	assert.deepEqual(activeTools(false).sort(), ["bash", "codemode", "read", "tool_search"]);
});

it("keeps an explicit tool selection unchanged", () => {
	assert.deepEqual(activeTools(true), ["bash", "read"]);
});

it("regression: manual tool removal survives reload", () => {
	assert.deepEqual(activeTools(false, true), ["bash", "read"]);
});
