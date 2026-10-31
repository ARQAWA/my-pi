import assert from "node:assert/strict";
import test from "node:test";
import { AgentSession, createCodemodeExtension, createEventBus, createReadToolDefinition } from "@earendil-works/pi-coding-agent";
import { createTools, installRqwTools } from "../../../extensions/RQW-tools/index.ts";
import { defaultSearchSelection, installSelectionAliases } from "../../../extensions/RQW-tools/selection-alias.ts";

function host(allow?: string[], exclude?: string[], codemode?: any, definitions = createTools(process.cwd(), () => ({}), { codemode })) {
	const registered = definitions.map((definition) => ({ definition, sourceInfo: { source: "extension", path: "test" } }));
	const session: any = Object.create(AgentSession.prototype);
	Object.assign(session, {
		sessionManager: {}, agent: { state: { tools: [] } }, _pendingToolNames: new Set(),
		_usesDefaultTools: true, _defaultToolModifiers: [],
		_allowedTools: allow && ((name: string) => allow.includes(name)),
		_excludedTools: exclude && ((name: string) => exclude.includes(name)),
		_allowlistFiltersMcp: true, _customTools: [], _baseToolDefinitions: new Map(),
		_toolDefinitions: new Map(), _toolRegistry: new Map(), _toolPromptSnippets: new Map(), _toolPromptGuidelines: new Map(),
		_extensionRunner: { getAllRegisteredTools: () => registered },
		_rebuildSystemPrompt: () => {},
	});
	return session;
}

function refresh(session: any, names: string[]) {
	session._refreshToolRegistry({ activeToolNames: names });
	return session.getActiveToolNames().sort();
}

test("real Pi registry maps legacy selections and excludes them from callable tools", () => {
	const release = installSelectionAliases();
	const session = host(["read", "grep", "find"], ["grep"]);
	try {
		assert.deepEqual(refresh(session, ["read", "grep", "find"]), ["rqw_glob", "rqw_readfile"]);
		assert.deepEqual(session.getCallableToolNames().sort(), ["rqw_glob", "rqw_readfile"]);
		assert.equal(session._toolRegistry.has("rqw_rg"), false);
	} finally { release(session.sessionManager); }
});

test("reload restores stock names and original matchers", () => {
	const release = installSelectionAliases();
	const session = host(["read"]);
	const allowed = session._allowedTools;
	refresh(session, ["read"]);
	assert.deepEqual(session.getActiveToolNames(), ["rqw_readfile"]);
	release(session.sessionManager, true);
	assert.deepEqual(session.getActiveToolNames(), ["read"]);
	assert.equal(session._allowedTools, allowed);
	session._extensionRunner = { getAllRegisteredTools: () => [] };
	session._baseToolDefinitions = new Map([["read", createReadToolDefinition(process.cwd())]]);
	assert.deepEqual(refresh(session, session.getActiveToolNames()), ["read"]);
	assert.equal(session.getCallableToolNames().includes("rqw_readfile"), false);
});

test("old transcript restores new selectors without changing saved messages", () => {
	const release = installSelectionAliases();
	const session = host();
	const branch = [{ type: "message", message: { role: "system", content: "", timestamp: 1,
		toolsAdded: [{ name: "read" }, { name: "grep" }], toolsRemoved: [] } }];
	const before = JSON.stringify(branch);
	session.sessionManager.getBranch = () => branch;
	try {
		refresh(session, ["read"]);
		session._restoreToolsFromTranscript();
		assert.deepEqual(session.getActiveToolNames().sort(), ["rqw_readfile", "rqw_rg"]);
		assert.deepEqual(defaultSearchSelection(session.sessionManager, {}), []);
		assert.equal(JSON.stringify(branch), before);
	} finally { release(session.sessionManager); }
});

test("history modifiers remove either old or new names", () => {
	const release = installSelectionAliases();
	const session = host();
	session._defaultToolModifiers = ["-grep"];
	try {
		refresh(session, ["read"]);
		for (const name of ["grep", "rqw_rg"]) {
			session.sessionManager.getBranch = () => [{ type: "message", message: { role: "system", content: "", timestamp: 1,
				toolsAdded: [{ name: "read" }, { name }], toolsRemoved: [] } }];
			session._restoreToolsFromTranscript(session._defaultToolModifiers);
			assert.deepEqual(session.getActiveToolNames(), ["rqw_readfile"]);
		}
	} finally { release(session.sessionManager); }
});

test("an incompatible session keeps the stock catalogue", () => {
	const release = installSelectionAliases();
	const session = host();
	session._usesDefaultTools = undefined;
	const warnings: string[] = [];
	const warn = console.warn;
	console.warn = (text: string) => warnings.push(text);
	try {
		assert.deepEqual(refresh(session, ["read"]), ["read"]);
		assert.equal(session._getToolExposure("rqw_readfile"), "hidden");
		assert.match(warnings[0], /using stock file tools/);
	} finally { console.warn = warn; release(session.sessionManager); }
});

test("empty selection is never expanded", () => {
	const release = installSelectionAliases();
	const session = host([]);
	session._usesDefaultTools = false;
	try {
		assert.deepEqual(refresh(session, []), []);
		assert.deepEqual(defaultSearchSelection(session.sessionManager, {}), []);
	} finally { release(session.sessionManager); }
});

test("codemode-only loadout lists new names and cannot call hidden legacy tools", () => {
	let codemode: any;
	createCodemodeExtension({ mode: "only", inlineBudget: 20000 })({ registerTool: (tool: any) => { codemode = tool; } } as any);
	const release = installSelectionAliases();
	const session = host(["read", "grep", "find", "codemode"], undefined, codemode);
	try {
		refresh(session, ["read", "grep", "find", "codemode"]);
		const description = session.agent.state.tools.find((tool: any) => tool.name === "codemode").description;
		for (const name of ["rqw_readfile", "rqw_rg", "rqw_glob"]) assert.match(description, new RegExp(`\\b${name}\\(args:`));
		for (const name of ["read", "grep", "find"]) assert.doesNotMatch(description, new RegExp(`\\b${name}\\(args:`));
		assert.doesNotMatch(description, /Use read to examine files/);
		assert.deepEqual([...session._hiddenDeclarations].sort(), ["rqw_glob", "rqw_readfile", "rqw_rg"]);
		assert.deepEqual(session.getCallableToolNames().sort(), ["rqw_glob", "rqw_readfile", "rqw_rg"]);
	} finally { release(session.sessionManager); }
});

test("startup keeps unexcluded default search and does not bypass selection", async () => {
	const events = createEventBus();
	const handlers = new Map<string, Function[]>();
	const definitions: any[] = [];
	let session: any;
	const pi: any = {
		events, registerTool: (tool: any) => definitions.push(tool), getSettings: () => ({}),
		getActiveTools: () => session.getActiveToolNames(), getAllTools: () => session.getAllTools(),
		setActiveTools: (names: string[]) => session.setActiveToolsByName(names),
		on(name: string, handler: Function) { handlers.set(name, [...(handlers.get(name) ?? []), handler]); },
	};
	installRqwTools(pi);
	session = host(undefined, ["grep"], undefined, definitions);
	const ctx = { sessionManager: session.sessionManager, mode: "print", isIdle: () => true };
	try {
		refresh(session, ["read"]);
		for (const handler of handlers.get("session_start") ?? []) await handler({ reason: "startup" }, ctx);
		assert.deepEqual(session.getActiveToolNames().sort(), ["job", "rqw_glob", "rqw_readfile"]);
		assert.equal(session._toolRegistry.has("rqw_rg"), false);
	} finally {
		for (const handler of handlers.get("session_shutdown") ?? []) await handler({ reason: "shutdown" }, ctx);
	}
});

test("fallback keeps implicit stock search defaults", async () => {
	const events = createEventBus();
	const handlers = new Map<string, Function[]>();
	const definitions: any[] = [];
	let session: any;
	const pi: any = {
		events, registerTool: (tool: any) => definitions.push(tool), getSettings: () => ({}),
		getActiveTools: () => session.getActiveToolNames(), getAllTools: () => session.getAllTools(),
		setActiveTools: (names: string[]) => session.setActiveToolsByName(names),
		on(name: string, handler: Function) { handlers.set(name, [...(handlers.get(name) ?? []), handler]); },
	};
	installRqwTools(pi);
	session = host(undefined, undefined, undefined, definitions);
	session._defaultToolModifiers = undefined;
	const ctx = { sessionManager: session.sessionManager, mode: "print", isIdle: () => true };
	const warn = console.warn;
	console.warn = () => {};
	try {
		refresh(session, ["read"]);
		for (const handler of handlers.get("session_start") ?? []) await handler({ reason: "startup" }, ctx);
		assert.deepEqual(session.getActiveToolNames().sort(), ["find", "grep", "read"]);
		session._usesDefaultTools = false;
		session.setActiveToolsByName(["read"]);
		for (const handler of handlers.get("session_start") ?? []) await handler({ reason: "startup" }, ctx);
		assert.deepEqual(session.getActiveToolNames(), ["read"]);
	} finally {
		console.warn = warn;
		for (const handler of handlers.get("session_shutdown") ?? []) await handler({ reason: "shutdown" }, ctx);
	}
});

test("adapter installation fallback honors modifiers and narrow selections", async () => {
	const prototype: any = AgentSession.prototype;
	const originalSet = Object.getOwnPropertyDescriptor(prototype, "_setActiveTools")!;
	const originalBind = Object.getOwnPropertyDescriptor(prototype, "bindExtensions")!;
	const argv = process.argv;
	const handlers = new Map<string, Function[]>();
	const definitions: any[] = [];
	let session: any;
	const pi: any = {
		events: createEventBus(), registerTool: (tool: any) => definitions.push(tool), getSettings: () => ({}),
		getActiveTools: () => session.getActiveToolNames(), getAllTools: () => session.getAllTools(),
		setActiveTools: (names: string[]) => session.setActiveToolsByName(names),
		on(name: string, handler: Function) { handlers.set(name, [...(handlers.get(name) ?? []), handler]); },
	};
	Object.defineProperty(prototype, "_setActiveTools", { ...originalSet, writable: false });
	Object.defineProperty(prototype, "bindExtensions", { ...originalBind, value() {} });
	process.argv = [...argv.slice(0, 2), "--tools", "-grep"];
	const warn = console.warn;
	console.warn = () => {};
	try {
		installRqwTools(pi);
		Object.defineProperty(prototype, "_setActiveTools", originalSet);
		session = host(undefined, undefined, undefined, definitions);
		session._defaultToolModifiers = ["-grep"];
		prototype.bindExtensions.call(session, {});
		refresh(session, ["read"]);
		let ctx = { sessionManager: session.sessionManager, mode: "print", isIdle: () => true };
		for (const handler of handlers.get("session_start") ?? []) await handler({ reason: "startup" }, ctx);
		assert.deepEqual(session.getActiveToolNames().sort(), ["find", "read"]);
		session = host(["read"], undefined, undefined, definitions);
		session._usesDefaultTools = false;
		prototype.bindExtensions.call(session, {});
		refresh(session, ["read"]);
		ctx = { sessionManager: session.sessionManager, mode: "print", isIdle: () => true };
		for (const handler of handlers.get("session_start") ?? []) await handler({ reason: "startup" }, ctx);
		assert.deepEqual(session.getActiveToolNames(), ["read"]);
		for (const handler of handlers.get("session_shutdown") ?? []) await handler({ reason: "shutdown" }, ctx);
	} finally {
		console.warn = warn;
		process.argv = argv;
		Object.defineProperty(prototype, "_setActiveTools", originalSet);
		Object.defineProperty(prototype, "bindExtensions", originalBind);
	}
});

test("an abandoned registration restores Pi's original methods", () => {
	const prototype: any = AgentSession.prototype;
	const refresh = Object.getOwnPropertyDescriptor(prototype, "_refreshToolRegistry");
	const set = Object.getOwnPropertyDescriptor(prototype, "_setActiveTools");
	const release = installSelectionAliases();
	const state = prototype[Symbol.for("rqw/tool-selection-aliases/1.4.0")];
	for (const reference of state.leases) Object.defineProperty(reference, "deref", { value: () => undefined });
	try {
		const session = host();
		refreshSessionWithoutAliases(session);
		assert.deepEqual(Object.getOwnPropertyDescriptor(prototype, "_refreshToolRegistry"), refresh);
		assert.deepEqual(Object.getOwnPropertyDescriptor(prototype, "_setActiveTools"), set);
	} finally { release(); }
});

function refreshSessionWithoutAliases(session: any) {
	session._refreshToolRegistry({ activeToolNames: [] });
}

test("implicit search defaults respect modifiers and explicit settings", () => {
	const release = installSelectionAliases();
	const session = host();
	session._defaultToolModifiers = ["-grep"];
	try {
		refresh(session, ["read"]);
		assert.deepEqual(defaultSearchSelection(session.sessionManager, {}), ["rqw_glob"]);
		assert.deepEqual(defaultSearchSelection(session.sessionManager, { defaultTools: ["read"] }), []);
	} finally { release(session.sessionManager); }
});
