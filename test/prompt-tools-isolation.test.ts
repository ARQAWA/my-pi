// Package integration: real Pi prompt assembly and reload, scripted provider only.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, it } from "node:test";
import { fauxAssistantMessage, fauxProvider, fauxText } from "@earendil-works/pi-ai";
import { type AgentSession, createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";

const PACKAGE = dirname(dirname(fileURLToPath(import.meta.url)));
const PROMPT = "extensions/RQW-prompt/index.ts";
const TOOLS = "extensions/RQW-tools/index.ts";
const SEARCH = "- Search with the grep and find tools and read files with read, following the method in the grep description.";
const BARRIER = "- A shell command waits for the calls before it and holds the calls after it.";
const faux = fauxProvider();
let root: string;
let runtime: ModelRuntime;

before(async () => {
	root = await mkdtemp(join(tmpdir(), "rqw-prompt-tools-"));
	runtime = await ModelRuntime.create({ authPath: join(root, "auth.json"), modelsPath: null, refreshOnCreate: false });
	runtime.registerNativeProvider(faux.provider);
});
after(async () => { await rm(root, { recursive: true, force: true }); });

async function start(paths: string[], tools?: string[], reverse = false) {
	const cwd = await mkdtemp(join(root, "session-"));
	const agentDir = join(cwd, "agent");
	await mkdir(agentDir);
	const settings = SettingsManager.inMemory({
		packages: [{ source: PACKAGE, extensions: paths }],
		compaction: { enabled: false }, retry: { enabled: false },
	});
	const loader = new DefaultResourceLoader({
		cwd, agentDir, settingsManager: settings,
		noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
		extensionsOverride: (base) => ({ ...base, extensions: reverse ? base.extensions.slice().reverse() : base.extensions }),
	});
	await loader.reload();
	assert.deepEqual(loader.getExtensions().errors, []);
	assert.equal(loader.getExtensions().extensions.length, paths.length);
	const argv = process.argv;
	if (tools) process.argv = [...argv, "--tools", tools.join(",")];
	try {
		const { session } = await createAgentSession({
			cwd, agentDir, model: faux.getModel(), thinkingLevel: "off", modelRuntime: runtime,
			resourceLoader: loader, settingsManager: settings, sessionManager: SessionManager.inMemory(cwd),
			...(tools ? { tools } : {}),
		});
		await session.bindExtensions({});
		return { session, loader, settings };
	} finally { process.argv = argv; }
}

interface Running {
	session: AgentSession;
	loader: DefaultResourceLoader;
	settings: SettingsManager;
}
async function capture(run: Running) {
	let prompt = "";
	const descriptions = new Map<string, string>();
	faux.setResponses([(context) => {
		// Replay section/tool patches, not just the last message: reload must delete stale sections.
		const sections: Record<string, string> = {};
		for (const message of context.messages) {
			if (message.role !== "system") continue;
			if (typeof message.content === "string" && message.content) prompt = message.content;
			for (const [name, text] of Object.entries(message.sections ?? {})) {
				if (text === null) delete sections[name];
				else sections[name] = text;
			}
			for (const tool of message.toolsAdded ?? []) descriptions.set(tool.name, tool.description);
			for (const tool of message.toolsRemoved ?? []) descriptions.delete(tool.name);
		}
		prompt += Object.values(sections).join("\n\n");
		return fauxAssistantMessage(fauxText("done"));
	}]);
	await run.session.prompt("go");
	assert.ok(prompt);
	return { prompt, descriptions };
}

function once(text: string, needle: string) {
	assert.equal(text.split(needle).length - 1, 1, needle);
}

it("prompt alone names only the default stock tools and no RQW execution rules", async () => {
	const run = await start([PROMPT]);
	try {
		const { prompt, descriptions } = await capture(run);
		assert.deepEqual([...descriptions.keys()].sort(), ["bash", "edit", "read", "write"]);
		assert.doesNotMatch(prompt, /\b(?:grep|find) (?:and|tools?|description)|<search_method>|<rqw_tools_execution>/);
		assert.doesNotMatch(prompt, /shell command waits|long file (?:written in parts|still goes in parts)/);
	} finally { run.session.dispose(); }
});

it("tools alone supplies the search method, shell barrier and existing parts rule", async () => {
	const run = await start([TOOLS]);
	try {
		const { prompt, descriptions } = await capture(run);
		once(prompt, SEARCH);
		once(prompt, BARRIER);
		assert.match(descriptions.get("grep")!, /Search greedily in waves/);
		assert.match(descriptions.get("write")!, /write a file over about 400 lines in parts, each part in its own response/);
	} finally { run.session.dispose(); }
});

for (const reverse of [false, true]) {
	it(`both extensions preserve the text once, tools ${reverse ? "first" : "last"}`, async () => {
		const run = await start([PROMPT, TOOLS], undefined, reverse);
		try {
			const { prompt } = await capture(run);
			once(prompt, SEARCH);
			once(prompt, BARRIER);
			once(prompt, "You are a coding agent in pi");
			assert.ok(prompt.indexOf("<search_method>") > prompt.indexOf("<cwd>"));
		} finally { run.session.dispose(); }
	});
}

for (const tools of [["read", "bash"], ["read", "grep"], ["read", "find"], ["grep", "find"], ["read", "grep", "find"]]) {
	it(`--tools ${tools.join(",")} controls the instruction sections`, async () => {
		const run = await start([PROMPT, TOOLS], tools);
		try {
			const { prompt, descriptions } = await capture(run);
			assert.deepEqual([...descriptions.keys()].sort(), tools.slice().sort());
			assert.equal(prompt.includes(SEARCH), ["read", "grep", "find"].every((name) => tools.includes(name)));
			assert.equal(prompt.includes(BARRIER), tools.includes("bash"));
		} finally { run.session.dispose(); }
	});
}

for (const removed of [PROMPT, TOOLS]) {
	it(`disable ${removed} through package settings and reload removes its instructions`, async () => {
		const run = await start([PROMPT, TOOLS]);
		try {
			once((await capture(run)).prompt, SEARCH);
			run.settings.setPackages([{ source: PACKAGE, extensions: [removed === PROMPT ? TOOLS : PROMPT] }]);
			await run.session.reload();
			assert.deepEqual(run.loader.getExtensions().errors, []);
			assert.equal(run.loader.getExtensions().extensions.length, 1);
			const { prompt } = await capture(run);
			assert.equal(prompt.includes(SEARCH), removed !== TOOLS);
			assert.equal(prompt.includes(BARRIER), removed !== TOOLS);
			assert.equal(prompt.includes("You are a coding agent in pi"), removed !== PROMPT);
		} finally { run.session.dispose(); }
	});
}

it("changing the active tools removes and restores sections without reload", async () => {
	const run = await start([PROMPT, TOOLS]);
	try {
		once((await capture(run)).prompt, SEARCH);
		run.session.setActiveToolsByName(["read"]);
		const { prompt } = await capture(run);
		assert.ok(!prompt.includes(SEARCH));
		assert.ok(!prompt.includes(BARRIER));
		run.session.setActiveToolsByName(["read", "bash", "grep", "find"]);
		once((await capture(run)).prompt, SEARCH);
	} finally { run.session.dispose(); }
});

it("RQW-prompt source has no tools-specific instructions or cross-folder imports", async () => {
	const system = await readFile(join(PACKAGE, "extensions/RQW-prompt/SYSTEM.md"), "utf8");
	const index = await readFile(join(PACKAGE, PROMPT), "utf8");
	assert.doesNotMatch(system, /<search_method>|shell command waits|long file (?:written in parts|still goes in parts)/);
	assert.doesNotMatch(index, /RQW-tools|\.\.\//);
});
