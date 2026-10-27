import assert from "node:assert/strict";
import { AgentSession, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { it } from "node:test";
import { installSelectionIntent, noToolSelection } from "../extensions/RQW-tools/selection.ts";

type Session = {
	sessionManager: object;
	_usesDefaultTools: boolean;
	_defaultToolModifiers: string[];
	_excludedTools?: () => boolean;
	_allowedTools?: () => boolean;
};

const session = (manager: object, selected: boolean): Session => ({
	sessionManager: manager,
	_usesDefaultTools: !selected,
	_defaultToolModifiers: selected ? ["read"] : [],
	_excludedTools: undefined,
	_allowedTools: undefined,
});

function capture(sessions: Session[]): boolean {
	const prototype = AgentSession.prototype;
	const native = Object.getOwnPropertyDescriptor(prototype, "bindExtensions")!;
	const argv = process.argv;
	Object.defineProperty(prototype, "bindExtensions", { ...native, value: function () { return "native"; } });
	process.argv = argv.slice(0, 2);
	const release = installSelectionIntent();
	try {
		for (const item of sessions) prototype.bindExtensions.call(item, undefined as never);
		return noToolSelection({ getSettings: () => ({}) } as unknown as ExtensionAPI, sessions.at(-1)!.sessionManager);
	} finally {
		release();
		process.argv = argv;
		Object.defineProperty(prototype, "bindExtensions", native);
	}
}

it("distinguishes default tools from an explicit selection", () => {
	assert.equal(capture([session({}, false)]), true);
	assert.equal(capture([session({}, true)]), false);
});

it("regression: a reused manager takes the new session's selection", () => {
	const manager = {};
	assert.equal(capture([session(manager, false), session(manager, true)]), false);
	assert.equal(capture([session(manager, true), session(manager, false)]), true);
});

it("regression: reloading one session preserves its original intent", () => {
	const manager = {};
	const original = session(manager, false);
	assert.equal(capture([original]), true);
	original._usesDefaultTools = false;
	assert.equal(capture([original]), true);
});

it("regression: the last release restores the native hook", () => {
	const prototype = { bindExtensions() { return "native"; } };
	const native = Object.getOwnPropertyDescriptor(prototype, "bindExtensions")!;
	const releaseFirst = installSelectionIntent({ prototype });
	const releaseLast = installSelectionIntent({ prototype });
	const state = Object.getOwnPropertyDescriptor(prototype, Symbol.for("rqw/tool-selection-intent/1.4.0"))!.value as {
		registrations: Set<WeakRef<object>>;
	};
	assert.equal(state.registrations.size, 2);
	releaseFirst();
	releaseLast();
	assert.equal(state.registrations.size, 0);
	assert.deepEqual(Object.getOwnPropertyDescriptor(prototype, "bindExtensions"), native);
});

it("regression: a collected registration restores the native hook on the next bind", () => {
	const prototype = { bindExtensions() { return "native"; } };
	const native = Object.getOwnPropertyDescriptor(prototype, "bindExtensions")!;
	installSelectionIntent({ prototype });
	const state = Object.getOwnPropertyDescriptor(prototype, Symbol.for("rqw/tool-selection-intent/1.4.0"))!.value as {
		registrations: Set<WeakRef<object>>;
	};
	for (const reference of state.registrations) Object.defineProperty(reference, "deref", { value: () => undefined });
	prototype.bindExtensions();
	assert.equal(state.registrations.size, 0);
	assert.deepEqual(Object.getOwnPropertyDescriptor(prototype, "bindExtensions"), native);
});
