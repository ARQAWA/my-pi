// RQW-settings in the real Pi pipeline, no model: real AgentSession, the faux provider from pi-ai, RQW-settings alone
// loaded from its file the way Pi loads a package, and Pi's own codemode and tool_search extensions (the CLI loads them
// as built-ins; here they come as inline factories, which register them the same way). RQW-settings together with the
// other extensions of the package: test/package.test.ts.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
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

const SETTINGS = join(dirname(fileURLToPath(import.meta.url)), "..", "index.ts");
const ORIGINAL_CWD = process.cwd();

// Pi's default active tools, and what RQW-settings adds to them.
const STOCK_FOUR = ["bash", "edit", "read", "write"];
const DEFAULT_ON = [...STOCK_FOUR, "codemode", "tool_search"].sort();

const live = new Set<AgentSession>();
let root: string;
let agentDir: string;
let counter = 0;
const faux = fauxProvider();
let modelRuntime: ModelRuntime;

before(async () => {
	root = await mkdtemp(join(tmpdir(), "rqw-settings-"));
	agentDir = join(root, "agent");
	await mkdir(agentDir, { recursive: true });
	modelRuntime = await ModelRuntime.create({
		authPath: join(agentDir, "auth.json"),
		modelsPath: null,
		refreshOnCreate: false,
	});
	modelRuntime.registerNativeProvider(faux.provider);
});

after(async () => {
	process.chdir(ORIGINAL_CWD);
	await rm(root, { recursive: true, force: true });
});

const textOf = (content: readonly { type: string; text?: string }[]) => content.filter((c) => c.type === "text").map((c) => c.text).join("\n");

// The watchdog of every run that sends calls: a deadlock fails the test after 5 s instead of hanging the run (the one
// real timer here). The sessions still running are aborted, which also stops their script's worker thread; otherwise
// it would keep the process alive.
function guard<T>(promise: Promise<T>): Promise<T> {
	let timer: NodeJS.Timeout;
	const watchdog = new Promise<never>((_, reject) => {
		timer = setTimeout(() => {
			for (const session of live) void session.abort();
			reject(new Error("no result after 5 s (deadlock?)"));
		}, 5000);
	});
	return Promise.race([promise, watchdog]).finally(() => clearTimeout(timer));
}

type Options = {
	paths?: string[];
	builtins?: ("codemode" | "tool_search")[];
	tools?: string[];
	excludeTools?: string[];
	noTools?: "builtin" | "all";
	settings?: Record<string, unknown>;
	setup?: (dir: string) => Promise<void>;
	/** Global settings file of the user (agentDir/settings.json), read by the resource loader. */
	userSettings?: Record<string, unknown>;
	/** Runs once the extensions are bound and `started` is taken, before the assistant message of `calls`. */
	drive?: (session: AgentSession) => Promise<void>;
	calls?: [name: string, args: Record<string, unknown>][];
};
type Run = {
	dir: string;
	/** Active tools after `drive` (right after the bind without one). */
	active: string[];
	/** Active tools right after the session started. */
	started: string[];
	declared: Map<string, string>;
	outcomes: { id: string; name: string; text: string; isError: boolean }[];
	errors: string[];
	/** The registered `codemode`: where it comes from, and its definition (without functions that differ per load). */
	codemode?: { path: string; source: string; definition: Record<string, unknown> };
};

// The SDK takes the selection as options; the CLI turns the same selection into flags. The extensions can only see
// the flags, so a test that passes an option also puts its CLI spelling into argv.
const flagsOf = (o: Options) => [
	...(o.tools ? ["--tools", o.tools.join(",")] : []),
	...(o.excludeTools ? ["--exclude-tools", o.excludeTools.join(",")] : []),
	...(o.noTools ? ["--no-builtin-tools"] : []),
];

/** One session; with `calls` it also runs one assistant message holding all of them, then a final text. */
async function run(o: Options = {}): Promise<Run> {
	const dir = join(root, `w${counter++}`);
	await mkdir(dir, { recursive: true });
	await o.setup?.(dir);
	process.chdir(dir); // RQW-tools takes process.cwd() when its factory runs
	const argv = process.argv;
	process.argv = [...argv, ...flagsOf(o)];
	const out: Run = { dir, active: [], started: [], declared: new Map(), outcomes: [], errors: [] };
	const settingsFile = join(agentDir, "settings.json");
	if (o.userSettings) await writeFile(settingsFile, JSON.stringify(o.userSettings));
	try {
		faux.setResponses([
			(context) => {
				for (const message of context.messages) {
					if (message.role !== "system") continue;
					for (const tool of message.toolsAdded ?? []) out.declared.set(tool.name, tool.description);
					for (const ref of message.toolsRemoved ?? []) out.declared.delete(ref.name);
				}
				return fauxAssistantMessage(
					(o.calls ?? []).map(([name, args], i) => fauxToolCall(name, args as any, { id: `c${i}` })),
					{ stopReason: "toolUse" },
				);
			},
			fauxAssistantMessage(fauxText("done")),
		]);
		const builtins = o.builtins ?? ["codemode", "tool_search"];
		const resourceLoader = new DefaultResourceLoader({
			cwd: dir,
			agentDir,
			additionalExtensionPaths: o.paths ?? [SETTINGS],
			extensionFactories: [
				...(builtins.includes("codemode")
					? [{ name: "codemode", factory: createCodemodeExtension(), replaceable: true, builtin: true as const }]
					: []),
				...(builtins.includes("tool_search")
					? [{ name: "tool-search", factory: createToolSearchExtension(), replaceable: true, builtin: true as const }]
					: []),
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
			settingsManager: SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false }, ...o.settings }),
			...(o.tools ? { tools: o.tools } : {}),
			...(o.excludeTools ? { excludeTools: o.excludeTools } : {}),
			...(o.noTools ? { noTools: o.noTools } : {}),
		});
		try {
			live.add(session);
			// session_start is emitted here; a handler that throws shows up in `errors`
			await session.bindExtensions({ onError: (e) => out.errors.push(`${e.event}: ${e.error}`) });
			out.started = session.getActiveToolNames().slice().sort();
			await o.drive?.(session);
			out.active = session.getActiveToolNames().slice().sort();
			const registered = session.getAllTools().find((tool) => tool.name === "codemode");
			const definition: any = session.getToolDefinition("codemode");
			if (registered && definition) {
				const { execute: _execute, prepareLoadout: _loadout, reachesTools: _reaches, ...rest } = definition;
				out.codemode = { path: registered.sourceInfo.path, source: registered.sourceInfo.source, definition: rest };
			}
			if (o.calls) {
				session.subscribe((event) => {
					if (event.type === "tool_execution_end") {
						out.outcomes.push({
							id: event.toolCallId,
							name: event.toolName,
							text: textOf(event.result?.content ?? []),
							isError: !!event.isError,
						});
					}
				});
				await guard(session.prompt("go"));
			}
		} finally {
			live.delete(session);
			session.dispose();
		}
	} finally {
		process.argv = argv;
		process.chdir(ORIGINAL_CWD);
		if (o.userSettings) await rm(settingsFile, { force: true });
	}
	return out;
}

describe("settings: codemode and tool_search are on by default", () => {
	it("defaults give Pi's four tools plus codemode and tool_search", async () => {
		assert.deepEqual((await run()).active, DEFAULT_ON);
	});

	it("a built-in turned off is not an error and the other is still added", async () => {
		assert.deepEqual((await run({ builtins: ["tool_search"] })).active, [...STOCK_FOUR, "tool_search"].sort());
		assert.deepEqual((await run({ builtins: ["codemode"] })).active, [...STOCK_FOUR, "codemode"].sort());
		assert.deepEqual((await run({ builtins: [] })).active, STOCK_FOUR);
	});

	it("`-builtin:codemode` in the user's settings leaves no codemode and no error", async () => {
		const r = await run({ userSettings: { extensions: ["-builtin:codemode"] } });
		assert.equal(r.codemode, undefined, "no codemode tool is registered");
		assert.deepEqual(r.active, [...STOCK_FOUR, "tool_search"].sort());
		assert.deepEqual(r.errors, []);
	});

	it("the model request declares both tools and every direct tool ends with the codemode note", async () => {
		const r = await run({ calls: [] });
		assert.deepEqual([...r.declared.keys()].sort(), DEFAULT_ON);
		for (const name of STOCK_FOUR) {
			assert.match(r.declared.get(name)!, new RegExp(`\\n\\nCodemode: \`tools\\.${name}\\(args\\)\` resolves to `), name);
		}
		assert.match(r.declared.get("codemode")!, /^Run JavaScript that calls other tools\./);
		assert.match(r.declared.get("tool_search")!, /^# Tool discovery/);
		// The four are all direct tools, so the codemode description lists no tool sections.
		assert.doesNotMatch(r.declared.get("codemode")!, /Nested tools:/);
	});
});

describe("settings: any tool selection of the user leaves the stock active set", () => {
	const rows: [string, Options][] = [
		["tools -codemode", { tools: ["-codemode"] }],
		["tools -grep", { tools: ["-grep"] }],
		["tools +codemode", { tools: ["+codemode"] }],
		["tools read,bash", { tools: ["read", "bash"] }],
		["excludeTools codemode", { excludeTools: ["codemode"] }],
		["excludeTools edit", { excludeTools: ["edit"] }],
		["defaultTools read,bash", { settings: { defaultTools: ["read", "bash"] } }],
		["defaultTools +codemode", { settings: { defaultTools: ["+codemode"] } }],
		["defaultTools -codemode", { settings: { defaultTools: ["-codemode"] } }],
		["noTools builtin", { noTools: "builtin" }],
	];
	for (const [name, options] of rows) {
		it(`${name}: the active set equals stock Pi without RQW-settings`, async () => {
			const stock = (await run({ ...options, paths: [] })).active;
			assert.deepEqual((await run(options)).active, stock);
		});
	}

	it("explicit rows are exactly the expected sets", async () => {
		assert.deepEqual((await run({ tools: ["-codemode"] })).active, ["bash", "edit", "read", "write"]);
		assert.deepEqual((await run({ settings: { defaultTools: ["read", "bash"] } })).active, ["bash", "read"]);
		assert.deepEqual((await run({ noTools: "builtin" })).active, []);
		assert.deepEqual((await run({ tools: ["+codemode"] })).active, ["bash", "codemode", "edit", "read", "write"]);
		assert.deepEqual((await run({ excludeTools: ["codemode"] })).active, ["bash", "edit", "read", "write"]);
	});
});

describe("settings: /reload keeps the choice of the user", () => {
	const SWITCHED_OFF = ["codemode", "tool_search"];

	it("tools switched off during the session stay off after a reload", async () => {
		const r = await run({
			drive: async (session) => {
				session.setActiveToolsByName(session.getActiveToolNames().filter((name) => !SWITCHED_OFF.includes(name)));
				await session.reload();
			},
		});
		assert.deepEqual(r.started, DEFAULT_ON);
		assert.deepEqual(r.active, ["bash", "edit", "read", "write"]);
		assert.deepEqual(r.errors, []);
	});

	it("a reload with nothing switched off changes nothing, and a tool the user switched on stays on", async () => {
		const r = await run({
			tools: ["+codemode"],
			drive: async (session) => {
				await session.reload();
			},
		});
		assert.deepEqual(r.active, r.started);
	});
});

describe("settings: the session_start handler acts on every reason but reload", () => {
	const REASONS = ["startup", "new", "resume", "fork"] as const;

	// A minimal pi that records what the extension asks for. (The same check for RQW-tools is in its tools.test.ts.)
	function fakePi(active: string[], registered: string[]) {
		const handlers = new Map<string, (event: unknown) => unknown>();
		const set: string[][] = [];
		const pi: any = {
			on: (event: string, handler: (event: unknown) => unknown) => handlers.set(event, handler),
			getActiveTools: () => active,
			getAllTools: () => registered.map((name) => ({ name })),
			getSettings: () => ({}),
			setActiveTools: (names: string[]) => set.push(names),
		};
		return { pi, set, fire: (reason: string) => handlers.get("session_start")!({ type: "session_start", reason }) };
	}

	it("RQW-settings adds codemode and tool_search on startup, new, resume and fork, and nothing on reload", async () => {
		const argv = process.argv;
		process.argv = argv.slice(0, 2); // no tool flag
		try {
			const factory = (await import(pathToFileURL(SETTINGS).href)).default;
			for (const reason of REASONS) {
				const { pi, set, fire } = fakePi(["read"], ["codemode", "tool_search"]);
				factory(pi);
				await fire(reason);
				assert.deepEqual(set, [["read", "codemode", "tool_search"]], reason);
			}
			const { pi, set, fire } = fakePi(["read"], ["codemode", "tool_search"]);
			factory(pi);
			await fire("reload");
			assert.deepEqual(set, [], "reload");
		} finally {
			process.argv = argv;
		}
	});
});
