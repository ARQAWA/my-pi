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
		prototype.bindExtensions.call(session, undefined as never);
		for (const handler of handlers.get("session_start") ?? []) handler({ reason: "startup" }, { sessionManager: manager });
		if (manualReload) {
			active = ["bash", "read"];
			prototype.bindExtensions.call(session, undefined as never);
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

it("an unknown Pi shape turns off only the patched parts and keeps /fast-gpt", () => {
	const prototype = AgentSession.prototype as unknown as Record<string, unknown>;
	const names = ["bindExtensions", "_bindExtensionCore"];
	const natives = names.map(name => Object.getOwnPropertyDescriptor(prototype, name)!);
	for (const [index, name] of names.entries()) Object.defineProperty(prototype, name, { ...natives[index], value: undefined });
	const handlers = new Map<string, ((event: any, ctx: any) => void)[]>();
	const commands: string[] = [];
	const notes: string[] = [];
	const pi = {
		on: (name: string, handler: (event: any, ctx: any) => void) => handlers.set(name, [...(handlers.get(name) ?? []), handler]),
		registerCommand: (name: string) => commands.push(name),
		events: { on: () => () => {}, emit: () => {} },
		getSettings: () => ({}),
		getAllTools: () => [{ name: "codemode" }],
		getActiveTools: () => ["bash"],
		setActiveTools: () => assert.fail("default tools must stay untouched on an unknown shape"),
	};
	try {
		settings(pi as unknown as ExtensionAPI);
		assert.ok(commands.includes("fast-gpt"));
		const ctx = { hasUI: true, sessionManager: {}, ui: { notify: (text: string) => notes.push(text) } };
		for (const handler of handlers.get("session_start") ?? []) handler({ reason: "startup" }, ctx);
		assert.equal(notes.filter(text => text.startsWith("RQW-settings:") && text.endsWith("that part is off")).length, 2);
		for (const handler of handlers.get("session_shutdown") ?? []) handler({}, {});
	} finally {
		for (const [index, name] of names.entries()) Object.defineProperty(prototype, name, natives[index]);
	}
});

it("a session without the expected intent fields gets no default tools and a warning, not an error", () => {
	const prototype = AgentSession.prototype;
	const native = Object.getOwnPropertyDescriptor(prototype, "bindExtensions")!;
	Object.defineProperty(prototype, "bindExtensions", { ...native, value: function () { return "native"; } });
	const handlers = new Map<string, ((event: any, ctx: any) => void)[]>();
	const notes: string[] = [];
	const pi = {
		on: (name: string, handler: (event: any, ctx: any) => void) => handlers.set(name, [...(handlers.get(name) ?? []), handler]),
		registerCommand() {},
		events: { on: () => () => {}, emit: () => {} },
		getSettings: () => ({}),
		getAllTools: () => [{ name: "codemode" }],
		getActiveTools: () => ["bash"],
		setActiveTools: () => assert.fail("default tools must stay untouched on an unknown session shape"),
	};
	const manager = {};
	try {
		settings(pi as unknown as ExtensionAPI);
		prototype.bindExtensions.call({ sessionManager: manager } as never, undefined as never);
		const ctx = { hasUI: true, sessionManager: manager, ui: { notify: (text: string) => notes.push(text) } };
		for (const handler of handlers.get("session_start") ?? []) handler({ reason: "startup" }, ctx);
		assert.equal(notes.length, 1);
		assert.match(notes[0], /^RQW-settings: .*session intent was not captured/);
	} finally {
		for (const handler of handlers.get("session_shutdown") ?? []) handler({}, {});
		Object.defineProperty(prototype, "bindExtensions", native);
	}
});
