import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createFauxCore, fauxAssistantMessage } from "@earendil-works/pi-ai";
import { AgentSession, createAgentSession, createEventBus, DefaultResourceLoader, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import rqwTools, { installRqwTools } from "../extensions/RQW-tools/index.ts";
import registerAgent from "../extensions/RQW-agent/index.ts";

const expected = "Use the rqw_readfile tool to load a skill's file when the task matches its description.";
const bashHint = "Use bash to load a skill's file when the task matches its description.";
const readHint = "Use the read tool to load a skill's file when the task matches its description.";
const skill = { name: "sample", description: "Useful instructions", filePath: "/skills/sample/SKILL.md" };

async function sessionWith(tools: string[], extension: boolean, fallback = false, stockPrompt = false) {
	const cwd = process.cwd();
	const core = createFauxCore({ provider: "faux", models: [{ id: "m", contextWindow: 100000, maxTokens: 1000 }] });
	const model = core.getModel("m")!;
	let request: any;
	let inherited = "";
	core.setResponses([(context: any) => { request = context; return fauxAssistantMessage("ok"); }]);
	const runtime: any = { getModel: () => model, getPhysicalModel: () => model, hasConfiguredAuth: () => true,
		getAuth: async () => ({ apiKey: "test" }), checkAuth: async () => ({}), isUsingOAuth: () => false,
		getAvailableSnapshot: () => [model], getRegisteredProviderIds: () => [],
		streamSimple: (m: any, c: any, o: any) => core.streamSimple(m, c, o), getProviderHeaders: () => undefined };
	const settingsManager = SettingsManager.inMemory({ retry: { enabled: false } } as never);
	const events = createEventBus();
	const observer = (pi: any) => pi.on("before_agent_start", (_event: any, ctx: any) => { inherited = ctx.getSystemPrompt(); });
	const loader = new DefaultResourceLoader({ cwd, agentDir: cwd, settingsManager, eventBus: events,
		noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
		...(stockPrompt ? {} : { systemPromptOverride: () => "system" }), extensionFactories: extension ? [rqwTools, observer] : [observer] } as never);
	const descriptor = Object.getOwnPropertyDescriptor(AgentSession.prototype, "_setActiveTools")!;
	const warn = console.warn;
	try {
		if (fallback) {
			Object.defineProperty(AgentSession.prototype, "_setActiveTools", { ...descriptor, writable: false });
			console.warn = () => {};
		}
		await loader.reload();
	} finally {
		if (fallback) Object.defineProperty(AgentSession.prototype, "_setActiveTools", descriptor);
		console.warn = warn;
	}
	(loader as any).getSkills = () => ({ skills: [skill], diagnostics: [] });
	const { session } = await createAgentSession({ cwd, modelRuntime: runtime, model: model as never, resourceLoader: loader,
		settingsManager, sessionManager: SessionManager.inMemory(cwd), tools });
	await session.bindExtensions({});
	return { session, events, inherited: () => inherited, request: () => request };
}

async function close(session: any) {
	await session._extensionRunner.emit({ type: "session_shutdown", reason: "shutdown" });
	session.dispose();
}

test("skill hint uses the new reader in the request, startup projection and child prompt", async () => {
	for (const tools of [["rqw_readfile", "bash"], ["rqw_readfile"]]) {
		const run = await sessionWith(tools, true);
		try {
			const options = structuredClone((run.session as any)._baseSystemPromptOptions);
			const projection: any = { options };
			run.events.emit("rqw-prompt:startup-projection", projection);
			assert.equal(projection.error, undefined);
			assert.match(options.sections.skills, /Use the rqw_readfile tool to load a skill's file/);
			assert.doesNotMatch(options.sections.skills, /Use bash to load a skill's file/);
			const hidden = structuredClone((run.session as any)._baseSystemPromptOptions);
			hidden.hiddenTools = ["rqw_readfile"];
			run.events.emit("rqw-prompt:startup-projection", { options: hidden });
			assert.ok(hidden.sections.skills.includes(expected));
			const empty = structuredClone((run.session as any)._baseSystemPromptOptions);
			empty.skills = [{ ...skill, disableModelInvocation: true }];
			run.events.emit("rqw-prompt:startup-projection", { options: empty });
			assert.equal(empty.sections.skills, undefined);
			const custom = structuredClone((run.session as any)._baseSystemPromptOptions);
			custom.sections.skills = "Custom skill instructions";
			run.events.emit("rqw-prompt:startup-projection", { options: custom });
			assert.equal(custom.sections.skills, "Custom skill instructions");
			await run.session.prompt("hello");
			const messages = run.request().messages;
			const rendered = messages.filter((message: any) => message.role === "system").map((message: any) => JSON.stringify(message)).join("\n");
			assert.ok(rendered.includes(expected));
			assert.ok(!rendered.includes(bashHint));
			assert.ok(run.inherited().includes(expected));
		} finally { await close(run.session); }
	}
});

test("a real child receives the new skill hint in its request", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "rqw-skill-child-"));
	await mkdir(join(cwd, ".git"));
	const previousCodex = process.env.CODEX_HOME;
	const previousPi = process.env.PI_CODING_AGENT_DIR;
	process.env.CODEX_HOME = join(cwd, "codex");
	process.env.PI_CODING_AGENT_DIR = join(cwd, "pi");
	const parentRun = await sessionWith(["rqw_readfile", "bash"], true);
	const hooks = new Map<string, ((event: any, ctx: any) => unknown)[]>();
	const tools = new Map<string, any>();
	const parent = SessionManager.inMemory(cwd);
	parent.appendMessage({ role: "user", content: "parent", timestamp: 1 });
	const core = createFauxCore({ provider: "skill-child-test", models: [{ id: "model" }] });
	const model = core.getModel()!;
	const requests: any[] = [];
	core.setResponses([(context: any) => { requests.push(context); return fauxAssistantMessage("done"); }]);
	const runtime: any = { getModel: () => model, getPhysicalModel: () => model, hasConfiguredAuth: () => true,
		getAuth: async () => ({ apiKey: "fake" }), checkAuth: async () => ({}), isUsingOAuth: () => false,
		getAvailableSnapshot: () => [model], getRegisteredProviderIds: () => [], streamSimple: core.streamSimple };
	const ctx: any = { cwd, sessionManager: parent, model, modelRegistry: { runtime, find: () => model, hasConfiguredAuth: () => true },
		isIdle: () => true, isProjectTrusted: () => true, getSystemPrompt: () => parentRun.inherited(),
		signal: new AbortController().signal, mode: "tui", ui: { notify() {} } };
	const pi: any = { events: createEventBus(), on(name: string, hook: any) { hooks.set(name, [...hooks.get(name) ?? [], hook]); },
		registerTool: (tool: any) => tools.set(tool.name, tool), registerCommand() {}, registerEntryRenderer() {},
		appendEntry: (name: string, data: any) => parent.appendCustomEntry(name, data),
		getSettings: () => ({ retry: { enabled: false }, compaction: { enabled: false } }), getThinkingLevel: () => "off", getActiveTools: () => [],
		sendMessage: (message: any) => parent.appendCustomMessageEntry(message.customType, message.content, message.display, message.details) };
	try {
		await parentRun.session.prompt("hello");
		installRqwTools(pi);
		registerAgent(pi);
		const call = (id: string, args: any) => tools.get("agent").execute(id, args, ctx.signal, undefined, ctx);
		await call("start", { action: "start", task: "child" });
		await call("outer/wait", { action: "wait", ids: ["agent#1"] });
		assert.ok(requests.length > 0);
		const system = requests[0].messages.filter((message: any) => message.role === "system");
		assert.ok(JSON.stringify(system).includes(expected));
		assert.ok(!JSON.stringify(system).includes(bashHint));
	} finally {
		for (const hook of hooks.get("session_shutdown") ?? []) await hook({ reason: "shutdown" }, ctx);
		await close(parentRun.session);
		if (previousCodex === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = previousCodex;
		if (previousPi === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previousPi;
		await rm(cwd, { recursive: true, force: true });
	}
});

test("legacy reader selection becomes the new reader when the extension works", async () => {
	const run = await sessionWith(["read", "bash"], true);
	try {
		assert.ok(run.session.getActiveToolNames().includes("rqw_readfile"));
		assert.ok(!run.session.getActiveToolNames().includes("read"));
		await run.session.prompt("hello");
		assert.ok(run.inherited().includes(expected));
	} finally { await close(run.session); }
});

test("stock and restricted loadouts retain Pi's original skill hint", async () => {
	for (const item of [{ tools: ["read", "bash"], extension: false, hint: readHint },
		{ tools: ["read", "bash"], extension: true, fallback: true, hint: readHint },
		{ tools: ["bash"], extension: true, hint: bashHint }]) {
		const run = await sessionWith(item.tools, item.extension, item.fallback);
		try {
			await run.session.prompt("hello");
			assert.ok(run.inherited().includes(item.hint));
			assert.ok(!run.inherited().includes(expected));
		} finally { await close(run.session); }
	}
});

const searchLine = "- When searching for text or files, prefer the dedicated search tools available to you (`rqw_rg`, `rqw_glob`) over shell search commands.";
const legacySearchLine = "- Search with the grep and find tools and read files with read, following the method in the grep description.";

async function projectedSections(tools: string[], fallback: boolean) {
	const run = await sessionWith(tools, true, fallback);
	try {
		const options = structuredClone((run.session as any)._baseSystemPromptOptions);
		run.events.emit("rqw-prompt:startup-projection", { options });
		return options.sections;
	} finally { await close(run.session); }
}

test("getting_work_done names the search tools; the old search line only serves the stock fallback", async () => {
	const modern = await projectedSections(["rqw_rg", "rqw_glob", "rqw_readfile", "bash"], false);
	assert.equal(modern.getting_work_done, searchLine);
	assert.equal(modern.search_method, undefined);
	const legacy = await projectedSections(["read", "grep", "find", "bash"], true);
	assert.equal(legacy.search_method, legacySearchLine);
	assert.equal(legacy.getting_work_done, undefined);
});

async function promptedSystem(tools: string[], fallback: boolean): Promise<string> {
	const run = await sessionWith(tools, true, fallback, true);
	try {
		await run.session.prompt("hello");
		const messages = run.request().messages;
		return messages.filter((message: any) => message.role === "system").map((message: any) => JSON.stringify(message)).join("\n");
	} finally { await close(run.session); }
}

test("a normal request carries getting_work_done with the new tools and search_method only in the fallback", async () => {
	const modern = await promptedSystem(["rqw_rg", "rqw_glob", "rqw_readfile", "bash"], false);
	assert.ok(modern.includes(JSON.stringify(searchLine).slice(1, -1)));
	assert.ok(!modern.includes(JSON.stringify(legacySearchLine).slice(1, -1)));
	const legacy = await promptedSystem(["read", "grep", "find", "bash"], true);
	assert.ok(legacy.includes(JSON.stringify(legacySearchLine).slice(1, -1)));
	assert.ok(!legacy.includes(JSON.stringify(searchLine).slice(1, -1)));
});
