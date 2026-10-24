// Native /skill:highreview and /skill:blindreview through Pi's real package filter, resource loader and session.
// A temporary package holds only RQW-review (no RQW-agent, no pi.skills): its resources_discover handler offers the
// two skill folders, the scripted main model reads the shared cycle file and calls the real `review` tool, and the
// fresh reviewer session answers from a faux provider. No network, no real model, no owner settings.
// The canonical text of the cycle is checked by the static contract tests, not here.
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
	fauxAssistantMessage,
	fauxProvider,
	fauxText,
	fauxToolCall,
	getSystemMessageText,
	type SimpleStreamOptions,
	type TranscriptContext,
} from "@earendil-works/pi-ai";
import {
	type AgentSession,
	createAgentSession,
	DefaultResourceLoader,
	initTheme,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";

const FOLDER = dirname(dirname(fileURLToPath(import.meta.url)));
const REPOSITORY = dirname(dirname(FOLDER));
const REVIEWER = readFileSync(join(FOLDER, "REVIEWER.md"), "utf8").replace(/\r\n/g, "\n").trimEnd();
const SKILLS = ["blindreview", "highreview"];
const ENTRY = "-extensions/RQW-review/index.ts";

type Level = "blind" | "high";
const LEVEL_OF: Record<string, Level> = { blindreview: "blind", highreview: "high" };
const EFFORT: Record<Level, string> = { blind: "low", high: "medium" };

const root = mkdtempSync(join(tmpdir(), "rqw-review-skills-"));
const agentDir = join(root, "agent");
let cwdCounter = 0;
let savedAgentDir: string | undefined;

// A temporary package holding only this extension and its skills, switched the way a user does it.
const pkg = join(root, "pkg");
before(() => {
	mkdirSync(agentDir, { recursive: true });
	savedAgentDir = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = agentDir;
	process.env.PI_OFFLINE = "1";
	process.env.PI_SKIP_VERSION_CHECK = "1";
	initTheme("dark", false);
	cpSync(FOLDER, join(pkg, "extensions", "RQW-review"), { recursive: true, filter: (src) => !src.startsWith(join(FOLDER, "test")) });
	// No `pi.skills`: the skills come only from the extension's resources_discover.
	writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "review-skills-fixture", private: true, pi: { extensions: ["./extensions/RQW-review/index.ts"] } }));
});
after(() => {
	if (savedAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = savedAgentDir;
	rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

const settings = (on: boolean) =>
	writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ packages: [on ? pkg : { source: pkg, extensions: [ENTRY] }], extensions: [] }));

const textOf = (content: unknown): string =>
	typeof content === "string"
		? content
		: Array.isArray(content)
			? content.map((c) => (c && typeof c === "object" && "text" in c ? String(c.text) : "")).join("\n")
			: "";

type Declared = { name: string };
function declaredTools(context: TranscriptContext): string[] {
	const declared = new Map<string, Declared>();
	for (const message of context.messages) {
		if (message.role !== "system") continue;
		for (const tool of message.toolsAdded ?? []) declared.set(tool.name, tool);
		for (const ref of message.toolsRemoved ?? []) declared.delete(ref.name);
	}
	return [...declared.keys()].sort();
}

const within = async <T>(promise: Promise<T>, ms: number, what: string): Promise<T> => {
	const guard = Promise.withResolvers<never>();
	const timer = setTimeout(() => guard.reject(new Error(`timeout: ${what}`)), ms);
	try { return await Promise.race([promise, guard.promise]); } finally { clearTimeout(timer); }
};

type ReviewerRequest = { model: string; reasoning?: string; sessionId?: string; system: string; tools: string[]; messages: number; users: string };

/** Everything one test needs: the main session plus the recorded requests of the main and reviewer models. */
async function open(o: { on?: boolean; levels?: (skill: Level) => Level[]; gateAll?: boolean } = {}) {
	const dir = join(root, `w${cwdCounter++}`);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "a.ts"), "export const a = 1;\n");
	settings(o.on ?? true);

	const mainFaux = fauxProvider({ provider: "skills-main", models: [{ id: "main" }] });
	const reviewerFaux = fauxProvider({ provider: "openai-codex", models: [{ id: "gpt-6.1-sol", reasoning: true }] });
	for (const faux of [mainFaux, reviewerFaux]) faux.provider.auth.apiKey = { name: "Fake", resolve: async () => ({ auth: { apiKey: "fake" } }) };

	const reviewerRequests: ReviewerRequest[] = [];
	const bothStarted = Promise.withResolvers<void>();
	reviewerFaux.setResponses(Array.from({ length: 6 }, () => async (context: TranscriptContext, options: SimpleStreamOptions | undefined) => {
		reviewerRequests.push({
			model: reviewerFaux.getModel().id,
			reasoning: options?.reasoning,
			sessionId: options?.sessionId,
			system: (() => { const s = context.messages.find((m) => m.role === "system"); return s ? getSystemMessageText(s) : ""; })(),
			tools: declaredTools(context),
			messages: context.messages.filter((m) => m.role !== "system").length,
			users: context.messages.filter((m) => m.role === "user").map((m) => textOf(m.content)).join("\n---\n"),
		});
		const n = reviewerRequests.length;
		// Concurrent reviewers: neither answers before both have started.
		if (o.gateAll) {
			if (n === 2) bothStarted.resolve();
			await within(bothStarted.promise, 5000, "both reviewers started");
		}
		return fauxAssistantMessage(fauxText(`CLEAN\nCHECKED:\n- verdict-token-${n}: ${options?.reasoning} reviewer inspected a.ts.`));
	}));

	// The main model: skill block -> read the shared cycle file -> call review -> end silently -> handle the verdict.
	const cycleReads: string[] = [];
	const reviewCalls: { level: Level; object: string; criterion: string }[] = [];
	const mainTools: string[][] = [];
	const verdictTexts: string[] = [];
	const seenVerdicts = new Set<string>();
	const expected = o.levels ?? ((skill: Level) => [skill]);
	const verdicts = Promise.withResolvers<void>();
	let expectedVerdicts = 0;
	let mainRequests = 0;
	const step = (context: TranscriptContext) => {
		mainRequests++;
		mainTools.push(declaredTools(context));
		const last = context.messages.at(-1);
		const lastText = last?.role === "user" ? textOf(last.content) : "";
		const skill = /^<skill name="(\w+)"/.exec(lastText)?.[1];
		if (skill) {
			const location = /location="([^"]+)"/.exec(lastText)![1];
			return fauxAssistantMessage(fauxToolCall("read", { path: resolve(dirname(location), "..", "review-cycle.md") }, { id: `read-${mainRequests}` }), { stopReason: "toolUse" });
		}
		if (last?.role === "toolResult" && last.toolName === "read") {
			cycleReads.push(textOf(last.content));
			const skillName = [...context.messages].reverse().map((m) => (m.role === "user" ? /^<skill name="(\w+)"/.exec(textOf(m.content))?.[1] : undefined)).find(Boolean)!;
			const levels = expected(LEVEL_OF[skillName]);
			expectedVerdicts += levels.length;
			return fauxAssistantMessage(levels.map((level, i) => {
				const call = { level, object: `${dir}/a.ts; stage pre-completion`, criterion: `Criterion of ${level} pass ${i}.` };
				reviewCalls.push(call);
				return fauxToolCall("review", { ...call, fast_gpt: false }, { id: `review-${reviewCalls.length}` });
			}), { stopReason: "toolUse" });
		}
		if (last?.role === "toolResult") return fauxAssistantMessage([]); // obeying the pending-review rule: end silently
		if (lastText.startsWith("[review#")) {
			// Concurrent verdicts can both be in this context with only one of them last: collect every one the model sees.
			for (const message of context.messages) {
				const text = message.role === "user" ? textOf(message.content) : "";
				const tag = /^\[review#\d+\]/.exec(text)?.[0];
				if (tag && !seenVerdicts.has(tag)) { seenVerdicts.add(tag); verdictTexts.push(text); }
			}
			if (seenVerdicts.size >= expectedVerdicts) verdicts.resolve();
			return fauxAssistantMessage(fauxText("VERDICT_HANDLED"));
		}
		return fauxAssistantMessage(fauxText("ok"));
	};
	mainFaux.setResponses(Array.from({ length: 14 }, () => step));

	const modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: null, refreshOnCreate: false });
	modelRuntime.registerNativeProvider(mainFaux.provider);
	modelRuntime.registerNativeProvider(reviewerFaux.provider);
	// noSkills only drops the default folders; skill paths offered by extensions still load.
	const loader = new DefaultResourceLoader({ cwd: dir, agentDir, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
	await loader.reload();
	const { session } = await createAgentSession({
		cwd: dir,
		agentDir,
		model: mainFaux.getModel(),
		thinkingLevel: "off",
		modelRuntime,
		resourceLoader: loader,
		sessionManager: SessionManager.inMemory(dir),
		settingsManager: SettingsManager.create(dir, agentDir),
	});
	const errors: string[] = [];
	await session.bindExtensions({ mode: "tui", onError: (e) => errors.push(`${e.event}: ${e.error}`) });
	return {
		dir, session, loader, errors, reviewerRequests, cycleReads, reviewCalls, mainTools, verdictTexts, verdicts: verdicts.promise,
		mainRequests: () => mainRequests,
	};
}

type Opened = Awaited<ReturnType<typeof open>>;
const skillOf = (h: Opened, name: string) => h.loader.getSkills().skills.find((s) => s.name === name);
const reviewMessages = (session: AgentSession) => session.messages.filter((m) => m.role === "custom" && m.customType === "review");
const firstUserText = (session: AgentSession, from = 0) =>
	textOf(session.messages.filter((m) => m.role === "user")[from]?.content);
const stripFrontmatter = (text: string) => text.replace(/\r\n/g, "\n").replace(/^---\n[\s\S]*?\n---\n?/, "").trim();

/** One skill invocation to its delivered verdict. */
async function invoke(h: Opened, skill: string, args: string) {
	await h.session.prompt(`/skill:${skill} ${args}`);
	await within(h.verdicts, 10000, `verdict of ${skill}`);
	await h.session.waitForIdle();
}

describe("native review skills", () => {
	it("the package offers exactly the two skill folders by resources_discover, nothing through pi.skills", async () => {
		const h = await open();
		try {
			const manifest = JSON.parse(readFileSync(join(REPOSITORY, "package.json"), "utf8")) as { pi: Record<string, unknown> };
			assert.equal(manifest.pi.skills, undefined, "the repository registers no skills through the manifest");
			assert.equal(JSON.parse(readFileSync(join(pkg, "package.json"), "utf8")).pi.skills, undefined);

			const found = await h.session.extensionRunner.emitResourcesDiscover(h.dir, "startup");
			const paths = found.skillPaths.map((entry: { path: string }) => entry.path).sort();
			assert.deepEqual(paths.map((p: string) => basename(p)), SKILLS);
			for (const p of paths) {
				assert.ok(isAbsolute(p), `${p} is absolute`);
				assert.equal(realpathSync(dirname(p)), realpathSync(join(pkg, "extensions", "RQW-review", "skills")), "individual folders under skills/");
			}
			assert.deepEqual(found.promptPaths, []);
			assert.deepEqual(found.themePaths, []);

			// The loader accepted both without diagnostics, under the names of their folders.
			assert.deepEqual(h.loader.getSkills().skills.map((s) => s.name).sort(), SKILLS);
			assert.deepEqual(h.loader.getSkills().diagnostics, []);
			for (const name of SKILLS) assert.ok(skillOf(h, name)!.description.length > 0, `${name} has a description`);
			assert.ok(!h.loader.getSkills().skills.some((s) => s.name === "review-cycle"), "the shared cycle file is not a skill");
			assert.deepEqual(h.errors, []);
		} finally { h.session.dispose(); }
	});

	for (const skill of SKILLS) {
		const level = LEVEL_OF[skill];
		it(`/skill:${skill}: expands, reads the shared cycle, calls review ${level} once; the fresh reviewer is the pinned profile`, { timeout: 30000 }, async () => {
			const h = await open();
			try {
				const args = `Check a.ts for ${skill}. OWNER_ARGS_${skill}`;
				await invoke(h, skill, args);

				// The native expansion: one skill block with the selected profile's instructions, then the arguments.
				const loaded = skillOf(h, skill)!;
				const body = stripFrontmatter(readFileSync(loaded.filePath, "utf8"));
				assert.equal(firstUserText(h.session),
					`<skill name="${skill}" location="${loaded.filePath}">\nReferences are relative to ${loaded.baseDir}.\n\n${body}\n</skill>\n\n${args}`);
				assert.ok(body.includes(`level: "${level}"`) || body.includes(`level \`${level}\``), "the profile selects its own level");
				assert.ok(!body.includes(`level: "${level === "high" ? "blind" : "high"}"`), "and not the other one");

				// The model read the shared cycle file the skill points to.
				assert.equal(h.cycleReads.length, 1);
				assert.equal(h.cycleReads[0].trimEnd(), readFileSync(resolve(loaded.baseDir, "..", "review-cycle.md"), "utf8").replace(/\r\n/g, "\n").trimEnd());

				// The actual review tool ran at this level, once; RQW-agent is absent.
				assert.deepEqual(h.reviewCalls.map((c) => c.level), [level]);
				assert.ok(h.mainTools[0].includes("review"), "review is declared to the main model");
				assert.ok(!h.mainTools[0].includes("agent"), "no RQW-agent in this package");

				// The fresh child: exact REVIEWER.md prompt, pinned model and effort, read-only tools, only its own brief.
				assert.equal(h.reviewerRequests.length, 1);
				const [r] = h.reviewerRequests;
				assert.equal(r.model, "gpt-6.1-sol");
				assert.equal(r.reasoning, EFFORT[level]);
				assert.ok(r.system.startsWith(REVIEWER), "the prompt starts with REVIEWER.md");
				assert.match(r.system.slice(REVIEWER.length), /^\n\n<cwd>\n[^\n]+\n<\/cwd>$/, "only Pi's <cwd> block follows it");
				assert.deepEqual(r.tools, ["bash", "find", "grep", "read"]);
				assert.equal(r.messages, 1, "a fresh session holds only its brief");
				assert.ok(r.users.includes(`OWNER_ARGS_${skill}`), "the owner's words are in the brief");
				assert.ok(r.users.includes(`<object>\n${h.reviewCalls[0].object}\n</object>`));
				assert.ok(r.users.includes(`<criterion>\n${h.reviewCalls[0].criterion}\n</criterion>`));
				assert.ok(!r.users.includes("VERDICT_HANDLED") && !r.users.includes("[review#"), "nothing of the main chat after the owner's message");

				// One verdict, one main turn that handled it, and nothing more.
				const delivered = reviewMessages(h.session);
				assert.equal(delivered.length, 1, "the verdict is delivered once");
				assert.match(textOf(delivered[0].content), /^\[review#1\] CLEAN\nCHECKED:\n- verdict-token-1:/);
				assert.deepEqual((delivered[0].details as { level: string; model: string; thinking: string }).level, level);
				assert.equal(h.verdictTexts.length, 1);
				assert.equal(h.session.getLastAssistantText(), "VERDICT_HANDLED");
				const requestsBefore = h.mainRequests();
				for (let i = 0; i < 5; i++) await new Promise((done) => setImmediate(done));
				assert.equal(h.mainRequests(), requestsBefore, "no extra main turn after the verdict");
				assert.deepEqual(h.errors, []);
			} finally { h.session.dispose(); }
		});
	}

	it("two invocations in one chat start two fresh reviewer sessions, the second without the first's verdict", { timeout: 30000 }, async () => {
		const h = await open();
		try {
			await invoke(h, "blindreview", "FIRST_OWNER_ARGS");
			const firstVerdicts = h.verdictTexts.length;
			assert.equal(firstVerdicts, 1);
			// The second skill call starts a new round of the same scripted main.
			const second = Promise.withResolvers<void>();
			const poll = async () => { while (reviewMessages(h.session).length < 2) await new Promise((done) => setImmediate(done)); second.resolve(); };
			void poll();
			await h.session.prompt("/skill:highreview SECOND_OWNER_ARGS");
			await within(second.promise, 10000, "second verdict");
			await h.session.waitForIdle();

			assert.equal(h.reviewerRequests.length, 2);
			const [one, two] = h.reviewerRequests;
			assert.deepEqual([one.reasoning, two.reasoning], ["low", "medium"], "blind then high");
			assert.ok(one.sessionId && two.sessionId && one.sessionId !== two.sessionId, "different reviewer sessions");
			for (const r of h.reviewerRequests) {
				assert.equal(r.messages, 1, "each starts from zero with its own brief");
				assert.ok(r.system.startsWith(REVIEWER));
				assert.deepEqual(r.tools, ["bash", "find", "grep", "read"]);
			}
			assert.ok(!two.users.includes("verdict-token-1") && !two.users.includes("[review#1]"), "the second reviewer saw no verdict of the first");
			assert.ok(two.users.includes("FIRST_OWNER_ARGS") && two.users.includes("SECOND_OWNER_ARGS"), "both owner messages, as in any review");
			assert.ok(!one.users.includes("SECOND_OWNER_ARGS"));
			assert.equal(reviewMessages(h.session).length, 2, "each verdict delivered once");
			assert.deepEqual(h.session.messages.filter((m) => m.role === "custom" && m.customType === "review")
				.map((m) => (m.details as { n: number; level: string }).level), ["blind", "high"]);
		} finally { h.session.dispose(); }
	});

	it("concurrent blind and high reviewers are different fresh sessions that never see each other", { timeout: 30000 }, async () => {
		const h = await open({ gateAll: true, levels: () => ["blind", "high"] });
		try {
			await invoke(h, "highreview", "CONCURRENT_ARGS");
			assert.equal(h.reviewerRequests.length, 2, "both ran (the gate holds each until both started)");
			const byEffort = Object.fromEntries(h.reviewerRequests.map((r) => [r.reasoning, r]));
			assert.ok(byEffort.low && byEffort.medium, "one Smarty low and one Bossy medium");
			assert.notEqual(byEffort.low.sessionId, byEffort.medium.sessionId);
			for (const r of h.reviewerRequests) {
				assert.equal(r.messages, 1);
				assert.ok(r.system.startsWith(REVIEWER));
				assert.deepEqual(r.tools, ["bash", "find", "grep", "read"]);
				assert.ok(!r.users.includes("verdict-token"), "no verdict of the other one");
			}
			assert.equal(reviewMessages(h.session).length, 2);
			assert.equal(new Set(h.verdictTexts.map((t) => /^\[review#\d+\]/.exec(t)![0])).size, 2, "each verdict reached the main model once");
		} finally { h.session.dispose(); }
	});

	it("disabled through Pi's package filter: no skills, no command expansion; on again after /reload", { timeout: 30000 }, async () => {
		const h = await open({ on: false });
		try {
			assert.deepEqual(h.loader.getSkills().skills, [], "off: no skill discovered");
			assert.deepEqual(h.session.extensionRunner.getAllRegisteredTools().map((t: { definition: { name: string } }) => t.definition.name).filter((n: string) => n === "review"), []);
			await h.session.prompt("/skill:highreview not expanded");
			await h.session.waitForIdle();
			assert.equal(firstUserText(h.session), "/skill:highreview not expanded", "an unknown skill command passes through");
			assert.equal(h.cycleReads.length, 0);
			assert.equal(h.reviewerRequests.length, 0);

			settings(true);
			await h.session.reload();
			assert.deepEqual(h.loader.getSkills().skills.map((s) => s.name).sort(), SKILLS, "on again after /reload");
			settings(false);
			await h.session.reload();
			assert.deepEqual(h.loader.getSkills().skills, [], "off again after /reload");
			assert.deepEqual(h.errors, []);
		} finally { h.session.dispose(); }
	});

});
