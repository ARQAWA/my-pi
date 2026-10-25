// RQW-tools answers the startup projection channel of RQW-prompt with the same two tool sections as its normal turn.
// Real AgentSession (Pi 1.4.0 SDK, faux provider) loads RQW-tools from its file and nothing else; a test-only factory
// observes the normal before_agent_start options and the pi.events bus. No other extension, no network, no real home.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { fauxAssistantMessage, fauxProvider, fauxText } from "@earendil-works/pi-ai";
import {
	type AgentSession,
	createAgentSession,
	DefaultResourceLoader,
	type ExtensionAPI,
	ModelRuntime,
	type NormalizedBuildSystemPromptOptions,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";

const EXTENSION = join(dirname(fileURLToPath(import.meta.url)), "../../../extensions/RQW-tools/index.ts");
const CHANNEL = "rqw-prompt:startup-projection";
const SEARCH = "- Search with the grep and find tools and read files with read, following the method in the grep description.";
const BARRIER = "- A shell command waits for the calls before it and holds the calls after it; one still running after 12 seconds continues in the background as a job, which holds the later calls of the same response and, from later responses, only calls that change what it names as held: a package folder it installs, the git index, files it writes.";

type Request = { options: NormalizedBuildSystemPromptOptions; model?: { provider: string; id: string }; error?: string };
type Bus = ExtensionAPI["events"];

const faux = fauxProvider();
let root: string;
let agentDir: string;
let modelRuntime: ModelRuntime;

before(async () => {
	root = await mkdtemp(join(tmpdir(), "rqw-tools-projection-"));
	agentDir = join(root, "agent");
	await mkdir(agentDir, { recursive: true });
	modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: null, refreshOnCreate: false });
	modelRuntime.registerNativeProvider(faux.provider);
});

after(async () => {
	await rm(root, { recursive: true, force: true });
});

/** Sections of an options object, as the rest of the pipeline sees them (name to text). */
const sectionsOf = (options: NormalizedBuildSystemPromptOptions) => ({ ...options.sections });

/** Internal fields of a real session: the base options and the hidden declarations (read only; the test changes nothing). */
const internalsOf = (session: AgentSession) => session as unknown as { _baseSystemPromptOptions: NormalizedBuildSystemPromptOptions; _hiddenDeclarations: Set<string> };

/** The clone the projection receives: the base options with the actual active and hidden tools, as RQW-codex builds it. */
function projectionClone(session: AgentSession): NormalizedBuildSystemPromptOptions {
	const { _baseSystemPromptOptions: base, _hiddenDeclarations: hidden } = internalsOf(session);
	return { ...structuredClone(base), selectedTools: session.getActiveToolNames(), hiddenTools: [...hidden] };
}

/** A real session with RQW-tools loaded from its file, plus a passive observer of the normal turn and the bus. */
async function start(): Promise<{ session: AgentSession; bus: () => Bus; normal: () => NormalizedBuildSystemPromptOptions | undefined; prompt: () => Promise<void> }> {
	const dir = await mkdtemp(join(root, "w-"));
	let bus: Bus | undefined;
	let normal: NormalizedBuildSystemPromptOptions | undefined;
	const observer = (pi: ExtensionAPI) => {
		bus = pi.events;
		pi.on("before_agent_start", (event) => {
			normal = structuredClone(event.systemPromptOptions);
		});
	};
	const resourceLoader = new DefaultResourceLoader({
		cwd: dir,
		agentDir,
		additionalExtensionPaths: [EXTENSION],
		extensionFactories: [observer],
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
	});
	await resourceLoader.reload();
	assert.deepEqual(resourceLoader.getExtensions().errors, []);
	assert.equal(resourceLoader.getExtensions().extensions.length, 2, "RQW-tools and the observer only");
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
	await session.bindExtensions({});
	return {
		session,
		bus: () => {
			if (!bus) throw new Error("the observer did not receive pi.events");
			return bus;
		},
		normal: () => normal,
		prompt: async () => {
			faux.setResponses([fauxAssistantMessage(fauxText("ok"))]);
			await session.prompt("go");
		},
	};
}

describe("RQW-tools startup projection: same sections as the normal turn", () => {
	it("the projected clone carries exactly the two normal sections, and the normal turn's options are the same", async () => {
		const host = await start();
		try {
			await host.prompt();
			const normal = host.normal();
			assert.ok(normal, "the normal before_agent_start ran");
			assert.equal(normal.sections.search_method, SEARCH);
			assert.equal(normal.sections.rqw_tools_execution, BARRIER);

			const request: Request = { options: projectionClone(host.session) };
			host.bus().emit(CHANNEL, request);
			assert.equal(request.error, undefined);
			assert.deepEqual(sectionsOf(request.options), sectionsOf(normal), "projected sections equal the normal turn's sections");
			assert.deepEqual(Object.keys(request.options.sections).sort(), ["rqw_tools_execution", "search_method"]);
		} finally {
			await host.session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
			host.session.dispose();
		}
	});

	it("visibility decides the sections: grep hidden drops search_method, bash hidden drops rqw_tools_execution", async () => {
		const host = await start();
		try {
			const options = (patch: Partial<NormalizedBuildSystemPromptOptions>) => ({ ...projectionClone(host.session), ...patch }) as NormalizedBuildSystemPromptOptions;
			const selected = ["read", "bash", "edit", "write", "grep", "find"];

			const hiddenGrep: Request = { options: options({ selectedTools: selected, hiddenTools: ["grep"] }) };
			host.bus().emit(CHANNEL, hiddenGrep);
			assert.equal(hiddenGrep.options.sections.search_method, undefined);
			assert.equal(hiddenGrep.options.sections.rqw_tools_execution, BARRIER);

			const noBash: Request = { options: options({ selectedTools: selected.filter((name) => name !== "bash"), hiddenTools: [] }) };
			host.bus().emit(CHANNEL, noBash);
			assert.equal(noBash.options.sections.search_method, SEARCH);
			assert.equal(noBash.options.sections.rqw_tools_execution, undefined);

			const hiddenBash: Request = { options: options({ selectedTools: selected, hiddenTools: ["bash"] }) };
			host.bus().emit(CHANNEL, hiddenBash);
			assert.equal(hiddenBash.options.sections.rqw_tools_execution, undefined);
		} finally {
			await host.session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
			host.session.dispose();
		}
	});

	it("other options are not mutated; only sections are added", async () => {
		const host = await start();
		try {
			const before = projectionClone(host.session);
			before.customPrompt = "CALLER_CUSTOM";
			before.toolSnippets = { read: "snippet" };
			before.promptGuidelines = ["guideline"];
			before.appendSystemPrompt = "addendum";
			const request: Request = { options: structuredClone(before) };
			host.bus().emit(CHANNEL, request);
			const { sections: _a, ...afterRest } = request.options;
			const { sections: _b, ...beforeRest } = before;
			assert.deepEqual(afterRest, beforeRest);
			assert.equal(request.options.customPrompt, "CALLER_CUSTOM", "a caller's custom prompt is kept");
		} finally {
			await host.session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
			host.session.dispose();
		}
	});

	it("an invalid request is reported through request.error and nothing is written", async () => {
		const host = await start();
		try {
			const broken: Request = { options: {} as NormalizedBuildSystemPromptOptions };
			host.bus().emit(CHANNEL, broken);
			assert.equal(typeof broken.error, "string");
			assert.equal(broken.options.sections, undefined);

			const missing: Request = { options: undefined as unknown as NormalizedBuildSystemPromptOptions };
			host.bus().emit(CHANNEL, missing);
			assert.equal(typeof missing.error, "string");

			const earlier: Request = { options: projectionClone(host.session), error: "another projector failed" };
			host.bus().emit(CHANNEL, earlier);
			assert.equal(earlier.error, "another projector failed");
			assert.deepEqual(earlier.options.sections, {}, "a request that already carries an error is left alone");
		} finally {
			await host.session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
			host.session.dispose();
		}
	});

	it("session_shutdown drops the projection listener; session_start subscribes it again", async () => {
		const host = await start();
		try {
			const bus = host.bus();
			await host.session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
			const off: Request = { options: projectionClone(host.session) };
			bus.emit(CHANNEL, off);
			assert.deepEqual(off.options.sections, {}, "no listener after shutdown");

			await host.session.extensionRunner.emit({ type: "session_start", reason: "startup" });
			const on: Request = { options: projectionClone(host.session) };
			bus.emit(CHANNEL, on);
			assert.equal(on.options.sections.search_method, SEARCH);
			assert.equal(on.options.sections.rqw_tools_execution, BARRIER);
		} finally {
			host.session.dispose();
		}
	});
});
