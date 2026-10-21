// The extensions of the package together, in the real Pi pipeline, no model: real AgentSession, the faux provider from
// pi-ai, the extensions loaded from their files the way Pi loads a package, and Pi's own codemode and tool_search
// extensions as inline factories (the CLI loads them as built-ins). Each extension's own tests load only that
// extension; the cases here are about two of them acting on the same active tool set: RQW-settings adds codemode and
// tool_search, RQW-tools adds grep and find, and neither may undo the other.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { fauxAssistantMessage, fauxProvider, fauxText } from "@earendil-works/pi-ai";
import {
	type AgentSession,
	createAgentSession,
	createCodemodeExtension,
	createToolSearchExtension,
	DefaultResourceLoader,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
// The whole package in its manifest order, as Pi loads it.
const PACKAGE: string[] = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).pi.extensions.map((p: string) => join(ROOT, p));
const SETTINGS = join(ROOT, "extensions", "RQW-settings", "index.ts");
const PROMPT = join(ROOT, "extensions", "RQW-prompt", "index.ts");
const TOOLS = join(ROOT, "extensions", "RQW-tools", "index.ts");
const ORIGINAL_CWD = process.cwd();
const ORIGINAL_ARGV = process.argv;

const OUR_SIX = ["bash", "edit", "find", "grep", "read", "write"];
const DEFAULT_ON = [...OUR_SIX, "codemode", "tool_search"].sort();
const PACKAGE_ON = [...DEFAULT_ON, "agent", "review"].sort();

let root: string;
let agentDir: string;
let counter = 0;
const faux = fauxProvider({ provider: "openai-codex" });
const ORIGINAL_AGENT_DIR = process.env.PI_CODING_AGENT_DIR;
const ORIGINAL_FETCH = globalThis.fetch;
let modelRuntime: ModelRuntime;

before(async () => {
	root = await mkdtemp(join(tmpdir(), "rqw-package-"));
	agentDir = join(root, "agent");
	await mkdir(agentDir, { recursive: true });
	modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: null, refreshOnCreate: false });
	process.env.PI_CODING_AGENT_DIR = agentDir;
	globalThis.fetch = async () => { throw new Error("Unexpected network request in package test"); };
	faux.provider.auth.apiKey = { name: "Fake package key", resolve: async () => ({ auth: { apiKey: "fake-package-key" } }) };
	modelRuntime.registerNativeProvider(faux.provider);
	await modelRuntime.setRuntimeApiKey("openai-codex", "fake-package-key");
	await modelRuntime.getAvailable();
});

after(async () => {
	process.chdir(ORIGINAL_CWD);
	globalThis.fetch = ORIGINAL_FETCH;
	if (ORIGINAL_AGENT_DIR === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = ORIGINAL_AGENT_DIR;
	await rm(root, { recursive: true, force: true });
});

type Options = {
	paths?: string[];
	/** Global settings file of the user (agentDir/settings.json), read by the resource loader. */
	userSettings?: Record<string, unknown>;
	/** Runs once the extensions are bound and `started` is taken. */
	drive?: (session: AgentSession) => Promise<void>;
	/** Sends one prompt and records the tools the first model request declares. */
	prompt?: boolean;
};
type Run = { started: string[]; active: string[]; declared: Map<string, string>; errors: string[]; codemode: boolean };

/** One session of the given extensions (the whole package unless given), with no tool selection of the user. */
async function run(o: Options = {}): Promise<Run> {
	const dir = join(root, `w${counter++}`);
	await mkdir(dir, { recursive: true });
	process.chdir(dir); // RQW-tools takes process.cwd() when its factory runs
	// Keep this faux-model package probe independent of any locally authenticated Opus.
	process.argv = [...ORIGINAL_ARGV, "--model", `${faux.provider.id}/${faux.getModel().id}`];
	const settingsFile = join(agentDir, "settings.json");
	if (o.userSettings) await writeFile(settingsFile, JSON.stringify(o.userSettings));
	const out: Run = { started: [], active: [], declared: new Map(), errors: [], codemode: false };
	try {
		faux.setResponses([
			(context) => {
				for (const message of context.messages) {
					if (message.role !== "system") continue;
					for (const tool of message.toolsAdded ?? []) out.declared.set(tool.name, tool.description);
					for (const ref of message.toolsRemoved ?? []) out.declared.delete(ref.name);
				}
				return fauxAssistantMessage(fauxText("done"));
			},
		]);
		const resourceLoader = new DefaultResourceLoader({
			cwd: dir,
			agentDir,
			additionalExtensionPaths: o.paths ?? PACKAGE,
			extensionFactories: [
				{ name: "codemode", factory: createCodemodeExtension(), replaceable: true, builtin: true as const },
				{ name: "tool-search", factory: createToolSearchExtension(), replaceable: true, builtin: true as const },
			],
			noSkills: true,
			noPromptTemplates: true,
			noThemes: true,
			noContextFiles: true,
		});
		await resourceLoader.reload();
		assert.deepEqual(resourceLoader.getExtensions().errors, [], "extension load errors");
		const { session } = await createAgentSession({
			cwd: dir,
			agentDir,
			model: faux.getModel(),
			thinkingLevel: "off",
			modelRuntime,
			resourceLoader,
			sessionManager: SessionManager.inMemory(dir),
			settingsManager: SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } }),
		});
		try {
			await session.bindExtensions({ onError: (e) => out.errors.push(`${e.event}: ${e.error}`) });
			out.started = session.getActiveToolNames().slice().sort();
			await o.drive?.(session);
			out.active = session.getActiveToolNames().slice().sort();
			out.codemode = session.getAllTools().some((tool) => tool.name === "codemode");
			if (o.prompt) {
				assert.equal(session.model?.provider, faux.provider.id);
				assert.equal(session.model?.id, faux.getModel().id);
				await session.prompt("go");
			}
		} finally {
			await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
			session.dispose();
		}
	} finally {
		process.chdir(ORIGINAL_CWD);
		process.argv = ORIGINAL_ARGV;
		if (o.userSettings) await rm(settingsFile, { force: true });
	}
	return out;
}

describe("package: RQW-settings and RQW-tools on one active tool set", () => {
	it("the whole package gives our six tools plus agent, review, codemode and tool_search", async () => {
		const r = await run();
		assert.deepEqual(r.active, PACKAGE_ON);
		assert.deepEqual(r.errors, []);
	});

	it("the result does not depend on the load order of RQW-settings and RQW-tools", async () => {
		assert.deepEqual((await run({ paths: [SETTINGS, TOOLS] })).active, DEFAULT_ON);
		assert.deepEqual((await run({ paths: [TOOLS, SETTINGS] })).active, DEFAULT_ON);
		assert.deepEqual((await run({ paths: [TOOLS, PROMPT, SETTINGS] })).active, DEFAULT_ON);
	});

	it("the model request declares both tools and every one of our six ends with the codemode note", async () => {
		const r = await run({ prompt: true });
		assert.deepEqual([...r.declared.keys()].sort(), PACKAGE_ON);
		for (const name of OUR_SIX) {
			assert.match(r.declared.get(name)!, new RegExp(`\\n\\nCodemode: \`tools\\.${name}\\(args\\)\` resolves to `), name);
		}
		// Our six are all direct tools, so the codemode description lists no tool sections.
		assert.doesNotMatch(r.declared.get("codemode")!, /Nested tools:/);
	});

	it("`-builtin:codemode` leaves no codemode at all", async () => {
		const r = await run({ userSettings: { extensions: ["-builtin:codemode"] } });
		assert.equal(r.codemode, false, "no codemode tool is registered");
		assert.deepEqual(r.active, [...OUR_SIX, "agent", "review", "tool_search"].sort());
		assert.deepEqual(r.errors, []);
	});

	it("/reload: tools switched off during the session stay off, ours and the built-ins", async () => {
		const SWITCHED_OFF = ["codemode", "tool_search", "grep", "find"];
		const r = await run({
			drive: async (session) => {
				session.setActiveToolsByName(session.getActiveToolNames().filter((name) => !SWITCHED_OFF.includes(name)));
				await session.reload();
			},
		});
		assert.deepEqual(r.started, PACKAGE_ON);
		assert.deepEqual(r.active, ["agent", "bash", "edit", "read", "review", "write"]);
		assert.deepEqual(r.errors, []);
	});
});
