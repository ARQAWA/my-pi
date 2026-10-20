// RQW-settings in the real Pi pipeline, no model: real AgentSession, the faux provider from pi-ai, our three
// extensions loaded from their files the way Pi loads a package, and Pi's own codemode and tool_search extensions
// (the CLI loads them as built-ins; here they come as inline factories, which register them the same way).
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Type } from "typebox";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import {
	type AgentSession,
	createAgentSession,
	createCodemodeExtension,
	createToolSearchExtension,
	DefaultResourceLoader,
	defineTool,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";

const EXTENSIONS = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SETTINGS = join(EXTENSIONS, "RQW-settings", "index.ts");
const PROMPT = join(EXTENSIONS, "RQW-prompt", "index.ts");
const TOOLS = join(EXTENSIONS, "RQW-tools", "index.ts");
const PROBE = join(EXTENSIONS, "RQW-settings", "test", "fixtures", "probe.ts");
const PACKAGE_ORDER = [SETTINGS, PROMPT, TOOLS];
const ORIGINAL_CWD = process.cwd();

const OUR_SIX = ["bash", "edit", "find", "grep", "read", "write"];
const DEFAULT_ON = [...OUR_SIX, "codemode", "tool_search"].sort();

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
	/** SDK custom tools, registered next to the extensions' tools. */
	customTools?: ReturnType<typeof defineTool>[];
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
// the flags, so a test that passes an option also puts its CLI spelling into argv (as RQW-tools' pipeline test does).
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
			additionalExtensionPaths: o.paths ?? PACKAGE_ORDER,
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
			...(o.customTools ? { customTools: o.customTools } : {}),
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
	it("defaults give our six tools plus codemode and tool_search", async () => {
		assert.deepEqual((await run()).active, DEFAULT_ON);
	});

	it("the result does not depend on the load order of RQW-settings and RQW-tools", async () => {
		assert.deepEqual((await run({ paths: [SETTINGS, TOOLS] })).active, DEFAULT_ON);
		assert.deepEqual((await run({ paths: [TOOLS, SETTINGS] })).active, DEFAULT_ON);
		assert.deepEqual((await run({ paths: [TOOLS, PROMPT, SETTINGS] })).active, DEFAULT_ON);
	});

	it("without RQW-tools the stock four plus codemode and tool_search", async () => {
		assert.deepEqual((await run({ paths: [SETTINGS] })).active, ["bash", "codemode", "edit", "read", "tool_search", "write"]);
	});

	it("a built-in turned off is not an error and the other is still added", async () => {
		assert.deepEqual((await run({ builtins: ["tool_search"] })).active, [...OUR_SIX, "tool_search"].sort());
		assert.deepEqual((await run({ builtins: ["codemode"] })).active, [...OUR_SIX, "codemode"].sort());
		assert.deepEqual((await run({ builtins: [] })).active, OUR_SIX);
	});

	it("the model request declares both tools and every one of our six ends with the codemode note", async () => {
		const r = await run({ calls: [] });
		assert.deepEqual([...r.declared.keys()].sort(), DEFAULT_ON);
		for (const name of OUR_SIX) {
			assert.match(r.declared.get(name)!, new RegExp(`\\n\\nCodemode: \`tools\\.${name}\\(args\\)\` resolves to `), name);
		}
		assert.match(r.declared.get("codemode")!, /^Run JavaScript that calls other tools\./);
		assert.match(r.declared.get("tool_search")!, /^# Tool discovery/);
		// Our six are all direct tools, so the codemode description lists no tool sections.
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
		it(`${name}: the active set equals stock Pi without our extensions`, async () => {
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

describe("settings: the RQW-tools barrier holds for calls made from a codemode script", () => {
	// A script reaches tools through ctx.executeTool(): the session runs each call against the registered tools,
	// which are our wrapped definitions, so every nested call goes through the same barrier as a model call.
	const codemode = (code: string): [string, Record<string, unknown>][] => [["codemode", { code }]];
	const outcome = (r: Run) => {
		const o = r.outcomes.find((x) => x.id === "c0");
		assert.ok(o, "no result of the codemode call");
		assert.equal(o.isError, false, o.text);
		return o.text;
	};
	const setup = (d: string) => writeFile(join(d, "f.txt"), "old\n");

	it("script: await write f, then read f -> read sees the new content", async () => {
		const r = await run({
			setup,
			calls: codemode(`await tools.write({ path: "f.txt", content: "NEW-A\\n" });\nreturn await tools.read({ path: "f.txt" });`),
		});
		assert.match(outcome(r), /NEW-A/);
		assert.doesNotMatch(outcome(r), /old/);
		assert.equal(await readFile(join(r.dir, "f.txt"), "utf-8"), "NEW-A\n");
	});

	it("script: await write f, then bash cat f -> bash sees the new content", async () => {
		const r = await run({
			setup,
			calls: codemode(`await tools.write({ path: "f.txt", content: "NEW-B\\n" });\nreturn (await tools.bash({ command: "cat f.txt" })).output;`),
		});
		assert.match(outcome(r), /NEW-B/);
		assert.doesNotMatch(outcome(r), /old/);
	});

	it("script: the nested calls are our tools (multi-file write with files[], edit on several files)", async () => {
		const r = await run({
			setup,
			calls: codemode(
				`await tools.write({ files: [{ path: "x.txt", content: "X1\\n" }, { path: "y.txt", content: "Y1\\n" }] });\n` +
					`await tools.edit({ edits: [{ path: "x.txt", oldText: "X1", newText: "X2" }, { path: "y.txt", oldText: "Y1", newText: "Y2" }] });\n` +
					`return await tools.bash({ command: "cat x.txt y.txt" });`,
			),
		});
		assert.match(outcome(r), /X2/);
		assert.match(outcome(r), /Y2/);
	});

	it("script: write f (12 MB) and read f started together (Promise.all) -> read of line 1999990 sees the new content, 10 of 10", async () => {
		for (let i = 0; i < 10; i++) {
			const r = await run({
				setup,
				calls: codemode(
					`const [w, rd] = await Promise.all([tools.write({ path: "f.txt", content: "NEW-C\\n".repeat(2000000) }), tools.read({ path: "f.txt", offset: 1999990, limit: 3 })]);\nreturn rd;`,
				),
			});
			assert.match(outcome(r), /NEW-C/, `run ${i}`);
		}
	});

	it("script: write f (12 MB) and bash wc -c f started together (Promise.all) -> bash sees the full new size, 10 of 10", async () => {
		for (let i = 0; i < 10; i++) {
			const r = await run({
				setup,
				calls: codemode(
					`const [w, b] = await Promise.all([tools.write({ path: "f.txt", content: "NEW-D\\n".repeat(2000000) }), tools.bash({ command: "wc -c < f.txt" })]);\nreturn b.output;`,
				),
			});
			assert.match(outcome(r), new RegExp(`^\\s*${6 * 2000000}$`, "m"), `run ${i}: ${outcome(r)}`);
		}
	});
});

// ---------------------------------------------------------------------------------------------------------------
// The `codemode` call itself is a call of the barrier (scope "all", like bash); the calls of its script are ordered
// by a barrier of that script. RQW-tools replaces Pi's built-in `codemode` at session_start (codemode.ts, nested.ts).
// ---------------------------------------------------------------------------------------------------------------

/** Text of the result of call `id`; a failed call fails the test. */
function result(r: Run, id: string): string {
	const o = r.outcomes.find((x) => x.id === id);
	assert.ok(o, `no result of ${id}`);
	assert.equal(o.isError, false, o.text);
	return o.text;
}

type Call = [name: string, args: Record<string, unknown>];
const script = (code: string): Call => ["codemode", { code }];
const OLD = (d: string) => writeFile(join(d, "f.txt"), "old\n");

// A tool that calls another tool through ctx.executeTool: a nested call of a nested call.
const relay = defineTool({
	name: "relay",
	label: "relay",
	description: "Runs another tool through ctx.executeTool and returns its result.",
	parameters: Type.Object({ tool: Type.String(), args: Type.Optional(Type.Record(Type.String(), Type.Any())) }),
	async execute(_id, params, _signal, _onUpdate, ctx) {
		const outcome = await ctx.executeTool(params.tool, params.args ?? {});
		return { content: outcome.result.content, details: {} };
	},
});

describe("settings: codemode is one call of the barrier, with scope all like bash", () => {
	it("[codemode(write f), read f] -> the read sees the new content, 10 of 10", async () => {
		for (let i = 0; i < 10; i++) {
			const r = await run({ setup: OLD, calls: [script(`await tools.write({ path: "f.txt", content: "NEW-F\\n" });\nreturn "written";`), ["read", { path: "f.txt" }]] });
			assert.match(result(r, "c1"), /NEW-F/, `run ${i}`);
			assert.doesNotMatch(result(r, "c1"), /old/, `run ${i}`);
		}
	});

	it("[write f (500 KB), codemode(script: bash wc -c f)] -> the script sees the full new size, 10 of 10", async () => {
		for (let i = 0; i < 10; i++) {
			const r = await run({
					setup: OLD,
					calls: [
						["write", { path: "f.txt", content: "NEW-G".repeat(100000) }],
						script(`return (await tools.bash({ command: "wc -c < f.txt" })).output;`),
					],
				});
			assert.match(result(r, "c1"), /^\s*500000$/m, `run ${i}`);
		}
	});

	it("[bash writes g after 0.3 s, codemode(script reads g)] -> the script waits for the earlier bash", async () => {
		const r = await run({
				calls: [["bash", { command: "sleep 0.3 && echo FROM-BASH > g.txt" }], script(`return await tools.read({ path: "g.txt" });`)],
			});
		assert.match(result(r, "c1"), /FROM-BASH/);
	});

	it("[codemode(script: bash writes g after 0.3 s), read g] -> the read waits for the whole script", async () => {
		const r = await run({
				calls: [script(`await tools.bash({ command: "sleep 0.3 && echo FROM-SCRIPT > g.txt" });\nreturn "done";`), ["read", { path: "g.txt" }]],
			});
		assert.match(result(r, "c1"), /FROM-SCRIPT/);
	});

	it("[codemode(write f), codemode(read f)] -> two scripts run one after the other, in message order", async () => {
		const r = await run({
				setup: OLD,
				calls: [
					script(`await tools.write({ path: "f.txt", content: "NEW-H\\n" });\nreturn "written";`),
					script(`return await tools.read({ path: "f.txt" });`),
				],
			});
		assert.match(result(r, "c1"), /NEW-H/);
	});

	it("[codemode(script reads f), write f] -> the later write waits for the script, which still sees the old content", async () => {
		const r = await run({ setup: OLD, calls: [script(`return await tools.read({ path: "f.txt" });`), ["write", { path: "f.txt", content: "NEW-I\n" }]] });
		assert.match(result(r, "c0"), /old/);
		assert.equal(await readFile(join(r.dir, "f.txt"), "utf-8"), "NEW-I\n");
	});

	it("inside a script, write then read and Promise.all of both stay ordered while the codemode call waits in the outer barrier", async () => {
		const r = await run({
				setup: OLD,
				calls: [
					["bash", { command: "sleep 0.1" }],
					script(
						`const [w, rd] = await Promise.all([tools.write({ path: "f.txt", content: "NEW-J\\n".repeat(100000) }), tools.read({ path: "f.txt", offset: 99990, limit: 3 })]);\nreturn rd;`,
					),
					["read", { path: "f.txt", offset: 99999, limit: 1 }],
				],
			});
		assert.match(result(r, "c1"), /NEW-J/);
		assert.match(result(r, "c2"), /NEW-J/);
	});

	it("a nested call of a nested call (a tool that runs ctx.executeTool) and Promise.all of such calls do not deadlock", async () => {
		const r = await run({
				setup: OLD,
				customTools: [relay],
				calls: [
					script(
						`await tools.write({ path: "f.txt", content: "NEW-K\\n" });\n` +
							`const viaRelay = await tools.relay({ tool: "read", args: { path: "f.txt" } });\n` +
							`const both = await Promise.all([tools.read({ path: "f.txt" }), tools.relay({ tool: "read", args: { path: "f.txt" } })]);\n` +
							`return [viaRelay, ...both].join("|");`,
					),
					["relay", { tool: "read", args: { path: "f.txt" } }],
				],
			});
		assert.equal(result(r, "c0").match(/NEW-K/g)?.length, 3);
		assert.match(result(r, "c1"), /NEW-K/);
	});

	it("the context of the codemode call reaches a tool through Pi's sandbox: a nested call sees the barrier of its script", async () => {
		// The probe tool and the take-over come from a test extension with a nested barrier of its own.
		const r = await run({
				paths: [SETTINGS, PROBE],
				customTools: [relay],
				calls: [
					["probe", {}],
					script(
						`const a = await tools.probe({});\nconst b = await tools.relay({ tool: "probe" });\n` +
							`const [c, d] = await Promise.all([tools.probe({}), tools.relay({ tool: "probe" })]);\nreturn [a, b, c, d].join(",");`,
					),
					script(`return await tools.probe({});`),
				],
			});
		assert.equal(r.errors.length, 0, r.errors.join("\n"));
		assert.equal(result(r, "c0"), "no-group", "a model call is not in a group");
		assert.match(result(r, "c1"), /group-1,group-1,group-1,group-1/, "one barrier for every call of the script, nested or not");
		assert.match(result(r, "c2"), /group-2/);
		assert.doesNotMatch(result(r, "c2"), /group-1/, "another script, another barrier");
	});
});

describe("settings: the codemode that RQW-tools registers is Pi's own", () => {
	const flags: Options = { tools: ["+codemode"], calls: [] };

	it("the definition equals the built-in one except for the closures that differ per load", async () => {
		const stock = await run({ ...flags, paths: [] });
		const ours = await run({ ...flags, paths: [TOOLS] });
		assert.equal(stock.codemode?.source, "builtin", "without our extension the built-in is registered");
		assert.notEqual(ours.codemode?.source, "builtin", "with RQW-tools the registered codemode is ours");
		assert.deepEqual(ours.codemode?.definition, stock.codemode?.definition);
		assert.equal(ours.declared.get("codemode"), stock.declared.get("codemode"), "the description the model reads");
		assert.ok(ours.declared.get("codemode"));
	});

	it("`-builtin:codemode` leaves no codemode at all", async () => {
		const r = await run({ userSettings: { extensions: ["-builtin:codemode"] } });
		assert.equal(r.codemode, undefined, "no codemode tool is registered");
		assert.deepEqual(r.active, [...OUR_SIX, "tool_search"].sort());
		assert.deepEqual(r.errors, []);
	});

	it("`-builtin:codemode` with RQW-tools alone: still no codemode", async () => {
		const r = await run({ paths: [TOOLS], userSettings: { extensions: ["-builtin:codemode"] } });
		assert.equal(r.codemode, undefined);
		assert.deepEqual(r.errors, []);
	});
});

describe("settings: /reload keeps the choice of the user", () => {
	const SWITCHED_OFF = ["codemode", "tool_search", "grep", "find"];

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

	it("the codemode of RQW-tools is registered again after a reload and still orders its calls", async () => {
		const r = await run({
				setup: OLD,
				drive: async (session) => {
					await session.reload();
				},
				calls: [script(`await tools.write({ path: "f.txt", content: "NEW-L\\n" });\nreturn "written";`), ["read", { path: "f.txt" }]],
			});
		assert.notEqual(r.codemode?.source, "builtin");
		assert.deepEqual(r.errors, []);
		assert.match(result(r, "c1"), /NEW-L/);
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
