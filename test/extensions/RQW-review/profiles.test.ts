import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { it } from "node:test";
import { fauxProvider } from "@earendil-works/pi-ai";
import {
	createAgentSession, createEventBus, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { parse } from "smol-toml";
import reviewProfiles from "../../../extensions/RQW-review/index.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../extensions/RQW-review");
const PROFILES = ["spotty", "bossy", "requirements-test-reviewer"].map((name) => join(ROOT, "profiles", `${name}.toml`));
const SKILLS = ["reviewer", "blindreview", "highreview", "testreview"];
const text = (path: string) => readFileSync(join(ROOT, path), "utf8");
const probe = (path: string) => readFileSync(join(import.meta.dirname, "fixtures/reviewer", path), "utf8");

it("offers all absolute native profile paths without registering a tool or runner", () => {
	const events = createEventBus();
	const handlers = new Map<string, () => { skillPaths: string[] }>();
	// A data provider needs only these APIs; any tool/session API call fails this harness.
	reviewProfiles({ events, on: (event: string, handler: () => { skillPaths: string[] }) => handlers.set(event, handler) } as never);
	let paths: string[] = [];
	events.emit("rqw-agent:profiles", { offer: (offered: string[]) => { paths = offered; } });
	assert.deepEqual(paths, PROFILES);
	assert.ok(paths.every(isAbsolute));
	assert.deepEqual([...handlers.keys()], ["session_shutdown", "resources_discover"]);
	assert.deepEqual(handlers.get("resources_discover")!().skillPaths, SKILLS.map((name) => join(ROOT, "skills", name, "SKILL.md")));
});

it("pins source descriptions, bare Codex model and efforts with byte-identical canonical instructions", () => {
	const profiles = PROFILES.slice(0, 2).map((path) => parse(readFileSync(path, "utf8")));
	const description = "Blind reviewer: checks one object or one part of it from primary requirements and evidence that everything agreed is done, nothing unagreed is added and the brief's criterion holds; decides nothing and returns CLEAN or every finding at once.";
	for (const [i, profile] of profiles.entries()) {
		assert.deepEqual(Object.keys(profile).sort(), ["description", "developer_instructions", "model", "model_reasoning_effort", "name"]);
		assert.equal(profile.name, ["spotty", "bossy"][i]);
		assert.equal(profile.description, description);
		assert.equal(profile.model, "gpt-6.1-sol");
		assert.equal(profile.model_reasoning_effort, ["low", "medium"][i]);
	}
	assert.equal(profiles[0].developer_instructions, profiles[1].developer_instructions);
	assert.equal(profiles[0].developer_instructions, text("REVIEWER.md"), "the explicit role file must be the canonical package prompt");
	// SHA256 of the shared reviewer instructions, including the concise-evidence amendment.
	assert.equal(createHash("sha256").update(profiles[0].developer_instructions as string).digest("hex"),
		"27e51994b2f24a432666878d3300407a9d46cd2b7206e84a7f273ab523a6c311");
});

it("skills use ordinary agent profiles, mechanical end-of-task inclusion and the source review cycle", () => {
	const common = text("skills/reviewer/SKILL.md");
	for (const newline of ["\n", "\r\n"]) {
		assert.match(common.replace(/\r?\n/g, newline), /^---\r?\nname: reviewer\r?\ndescription: .+\r?\n---\r?\n/);
	}
	assert.ok(common.includes('agent({action: "start", agent_type: "spotty", role_file: "<absolute RQW-review/REVIEWER.md>", include: ["user_messages"], task: ...})'));
	assert.ok(common.includes('agent({action: "start", agent_type: "bossy", role_file: "<absolute RQW-review/REVIEWER.md>", include: ["user_messages"], task: ...})'));
	assert.ok(common.includes("found at `../../REVIEWER.md` from this skill file"));
	assert.ok(common.includes("Do not reproduce user messages yourself."));
	assert.ok(common.includes("END, after the task"));
	assert.ok(common.includes("raw user texts, not compaction or branch summaries"));
	assert.ok(common.includes("The ordinary `agent` tool from RQW-agent is required"));
	assert.ok(common.includes("if it, the selected profile or the package role file is unavailable, report that the reviewer cannot run"));
	assert.ok(common.includes("Launch a fresh child for the initial review and for each changed-object pass"));
	assert.ok(common.includes("`CLEAN` with concise concrete `CHECKED:` evidence and no `UNCHECKED:`"));
	assert.ok(common.includes("`send` the SAME reviewer"));
	assert.ok(common.includes("Do not start a fresh reviewer merely for format or evidence completion"));
	assert.ok(common.includes("Fix all admitted findings in one batch"));
	assert.ok(common.includes("every rejection so far in `<rejected_earlier>`, until CLEAN"));
	assert.ok(common.includes("Reject a finding only when a quote is not verbatim"));
	assert.ok(common.includes("Do not impose file, search, tool-call or turn quotas"));
	assert.doesNotMatch(common, /fork_turns|spawn_agent|wait_agent/);
	for (const [name, level, profile] of [["blindreview", "blind", "spotty"], ["highreview", "high", "bossy"]]) {
		const wrapper = text(`skills/${name}/SKILL.md`);
		assert.ok(wrapper.includes(`name: ${name}`));
		assert.ok(wrapper.includes("Read `../reviewer/SKILL.md` relative to this skill file"));
		assert.ok(wrapper.includes(`Level ${level} uses \`${profile}\``));
	}
});

it("native Pi discovers skills and removes skills and profile offers when disabled on reload", async () => {
	const dir = mkdtempSync(join(tmpdir(), "rqw-review-profiles-"));
	const events = createEventBus();
	const settingsPath = join(dir, "settings.json");
	const configure = (enabled: boolean) => writeFileSync(settingsPath, JSON.stringify({
		cacheWarming: "off", retry: { enabled: false },
		packages: [{ source: resolve(ROOT, "../.."), extensions: enabled ? ["extensions/RQW-review/index.ts"] : [] }],
	}));
	configure(true);
	const settings = SettingsManager.create(dir, dir);
	const loader = new DefaultResourceLoader({
		cwd: dir, agentDir: dir, settingsManager: settings, eventBus: events,
		noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
	});
	const runtime = await ModelRuntime.create({ authPath: join(dir, "auth.json"), modelsPath: null, refreshOnCreate: false });
	const faux = fauxProvider({ provider: "review-data-test", api: "review-data-test", models: [{ id: "main" }] });
	runtime.registerNativeProvider(faux.provider);
	let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
	try {
		await loader.reload();
		assert.deepEqual(loader.getExtensions().errors, []);
		({ session } = await createAgentSession({ cwd: dir, agentDir: dir, modelRuntime: runtime,
			model: faux.getModel("main"), resourceLoader: loader, sessionManager: SessionManager.inMemory(dir), settingsManager: settings }));
		await session.bindExtensions({ mode: "rpc" });
		const offered = () => {
			const paths: string[] = [];
			events.emit("rqw-agent:profiles", { offer: (p: string[]) => paths.push(...p) });
			return paths;
		};
		assert.deepEqual(offered(), PROFILES);
		assert.deepEqual(loader.getSkills().skills.map((skill) => skill.name).sort(), [...SKILLS].sort());
		assert.deepEqual(loader.getSkills().diagnostics, []);
		assert.equal(session.getToolDefinition("review"), undefined);
		assert.equal(session.getToolDefinition("agent"), undefined, "review extension alone cannot run a reviewer");
		configure(false);
		await session.reload();
		assert.deepEqual(offered(), []);
		assert.deepEqual(loader.getSkills().skills, []);
		assert.deepEqual(loader.getExtensions().errors, []);
	} finally {
		if (session) {
			await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
			session.dispose();
		}
		rmSync(dir, { recursive: true, force: true });
	}
});

it("has no cross-extension relative imports and no obsolete runner files", () => {
	const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
		entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)]);
	for (const file of [...files(ROOT), ...files(import.meta.dirname)].filter((path) => path.endsWith(".ts"))) {
		for (const match of readFileSync(file, "utf8").matchAll(/(?:from\s+|import\s*\(\s*|import\s+)["'](\.{1,2}\/[^"']+)["']/g)) {
			assert.ok(resolve(dirname(file), match[1]).startsWith(resolve(ROOT) + sep), `${file}: ${match[1]}`);
		}
	}
	assert.deepEqual(readdirSync(ROOT).sort(), ["README.md", "REVIEWER.md", "index.ts", "profiles", "skills"]);
});

it("keeps tiny synthetic probes aligned with all review output contracts", () => {
	const role = text("REVIEWER.md");
	const common = text("skills/reviewer/SKILL.md");
	assert.match(probe("requirements.md"), /must contain exactly `status = "ready"`/);
	assert.equal(probe("correct/object.txt"), 'status = "ready"\n');
	assert.equal(probe("defective/object.txt"), 'status = "broken"\n');
	assert.match(role, /With no findings, return `CLEAN` followed by the verification sections below/);
	assert.match(role, /concise concrete evidence for the inspected object and criterion/);
	assert.match(role, /without one line per obligation or a long checklist/);
	assert.match(role, /Never return a bare CLEAN when you inspected evidence/);
	assert.match(role, /Otherwise return `FINDINGS:` followed by every finding/);
	assert.match(role, /If a required source remains unavailable, report it under UNCHECKED/);
	assert.match(role, /CLEAN with UNCHECKED is an incomplete review, never acceptance/);
	assert.match(common, /`send` the SAME reviewer a short request to supply concise concrete evidence/);
	assert.match(common, /Do not start a fresh reviewer merely for format or evidence completion/);
});
