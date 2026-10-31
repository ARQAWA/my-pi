import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parse } from "smol-toml";
import { runtime, world } from "./fixture.ts";

/**
 * Regression guard for the shipped, personal and repo reviewer profiles. Copies of the real package and repo
 * profile files are resolved through the same path `agent start` uses (resolveConfig), and the result is compared
 * with values written down here as origin/release resolves them: not with the files being tested.
 * The owner's personal Codex files are never copied into this repo; a fixture CODEX_HOME mirrors their shape.
 */
const REPO = join(import.meta.dirname, "..", "..", "..");
const PERSONAL = join(homedir(), ".codex", "agents");
const TERRA = "gpt-6.1-terra";
const REVIEW_PREFIX = "You are a read-only blind reviewer on Main's team: Main does the work, you check it, and together you deliver";
const DEFAULT_TOOLS = ["read", "bash", "edit", "write", "grep", "find"];

/** sha256 of a UTF-8 text with LF endings (git may check files out with CRLF on Windows); the pinned values below are of origin/release, never of the files under test. */
const digest = (text: string) => createHash("sha256").update(text.replace(/\r\n/g, "\n"), "utf8").digest("hex");
const REVIEW_SHA = "91f42b8f6e1792287f020544ed5856e4f8caeba41d3ecfcca12c7ecd443c3605";
/** sha256 of the owner's personal spotty and bossy developer_instructions; checked only where those files exist. */
const PERSONAL_SHA = "8ca0dec75595b08693706d1a253f35f0e49ce80115449d89d2c9ccd6aa7c03af";

type Expected = { model: string; effort: string; prefix: string; sha256?: string };
// origin/release: model, effort and the start of each role text, per profile.
const PACKAGE: Record<string, Expected> = {
	spotty: { model: TERRA, effort: "medium", prefix: REVIEW_PREFIX, sha256: REVIEW_SHA },
	bossy: { model: TERRA, effort: "xhigh", prefix: REVIEW_PREFIX, sha256: REVIEW_SHA },
};
const REPO_PROFILES: Record<string, Expected> = {
	"code-reviewer": { model: TERRA, effort: "high", prefix: "You are an independent, read-only code reviewer on the implementation team's side. Find real defects", sha256: "d79b76ab709bab0520a52e2120f8d87d930393cd3d5556a1793bd058384ef30b" },
	"test-reviewer": { model: TERRA, effort: "high", prefix: "You are an independent, read-only test reviewer. Check whether tests verify the stated requirements", sha256: "6b1773ae06bf4b431322dc20dbc343e5b76c8717268e69a6058d3e750248c7b4" },
	"requirements-test-reviewer": { model: TERRA, effort: "high", prefix: "You are an independent, read-only reviewer of test code as the deliverable. Check whether its checks", sha256: "b0a7de09a144ac4e6db179f4014fa626a4ee7afe88702b9ebaad6d7c83b20ecb" },
};
// Same-name personal overrides outrank the package ones; by shape they mirror the owner's own files.
const FIXTURE_PERSONAL: Record<string, Expected> = {
	spotty: { model: TERRA, effort: "low", prefix: "PLACEHOLDER SPOTTY ROLE" },
	bossy: { model: TERRA, effort: "medium", prefix: "PLACEHOLDER BOSSY ROLE" },
};

function personalToml(name: string, effort: string, role: string) {
	return `name = "${name}"\ndescription = "placeholder ${name}"\nmodel = "${TERRA}"\nmodel_reasoning_effort = "${effort}"\nsandbox_mode = "read-only"\ndeveloper_instructions = """\n${role}\nsecond line\n"""\n`;
}

async function setup(t: Parameters<typeof world>[0], personal: "none" | "fixture" | "real") {
	const w = await world(t);
	await cp(join(REPO, "extensions", "RQW-review", "profiles"), join(w.base, "package-profiles"), { recursive: true });
	await cp(join(REPO, ".pi", "agents"), join(w.project, ".pi", "agents"), { recursive: true });
	await cp(join(REPO, "extensions", "RQW-review", "REVIEWER.md"), join(w.base, "REVIEWER.md"));
	await mkdir(join(w.base, "codex", "agents"), { recursive: true });
	if (personal === "fixture") for (const [name, e] of Object.entries(FIXTURE_PERSONAL)) await writeFile(join(w.base, "codex", "agents", `${name}.toml`), personalToml(name, e.effort, e.prefix));
	if (personal === "real") await cp(PERSONAL, join(w.base, "codex", "agents"), { recursive: true });
	const run = runtime(w.cwd, w.base, "off", [TERRA]);
	run.events.on("rqw-agent:profiles", (request: any) => request.offer([join(w.base, "package-profiles")]));
	return { w, run };
}

/** The saved child record: resolved model, thinking, tools, role, prompt file and GPT Fast. */
const saved = (run: ReturnType<typeof runtime>, id: number) => {
	const records = run.parent.getEntries().flatMap((e: any) => e.type === "custom" && e.data?.kind === "agent" && e.data.id === id ? [e.data] : []);
	// Later records of one child omit the unchanged config; fast and the config come from the first full one.
	return { ...records.find(r => r.config)!, fast: records.at(-1)!.fast };
};

/** Starts one child per profile through the real start path and checks everything the owner's setup relies on. */
async function check(t: Parameters<typeof world>[0], personal: "none" | "fixture" | "real", table: Record<string, Expected>) {
	const { w, run } = await setup(t, personal);
	t.after(() => run.live.close());
	// The profile file the resolver should have read: a copy of the same-name file that wins in this world.
	const sourceOf = (name: string) => personal !== "none" ? join(w.base, "codex", "agents", `${name}.toml`)
		: name in PACKAGE ? join(w.base, "package-profiles", `${name}.toml`) : join(w.project, ".pi", "agents", `${name}.toml`);
	let id = 0;
	for (const [name, expected] of Object.entries(table)) {
		id += 1;
		await run.execute({ action: "start", task: `as ${name}`, agent_type: name });
		await run.live.wait(new AbortController().signal);
		const result = await run.resultOf(`as ${name}`, `agent#${id}`);
		const record = saved(run, id);
		assert.equal(result.model.id, expected.model, `${name} model`);
		assert.equal(result.effort, expected.effort, `${name} thinking`);
		assert.equal(record.config.thinking, expected.effort, `${name} saved thinking`);
		assert.deepEqual(record.config.tools, DEFAULT_TOOLS, `${name} tools`);
		assert.equal(record.fast, false, `${name} fast_gpt default`);
		assert.equal(record.config.profile.name, name);
		assert.ok(record.config.role.startsWith(expected.prefix), `${name} role prefix`);
		// Lossless resolution: the role is exactly the developer_instructions of the profile file.
		const file = parse(await readFile(sourceOf(name), "utf8")) as { developer_instructions: string };
		assert.equal(record.config.role, file.developer_instructions, `${name} role equals its profile file text`);
		if (expected.sha256) assert.equal(digest(record.config.role), expected.sha256, `${name} full role text matches the release baseline`);
		assert.ok(result.system.includes(expected.prefix), `${name} system prompt carries the role`);
		assert.ok(result.system.includes(file.developer_instructions), `${name} model request carries the full role text`);
		assert.equal(record.config.prompt_file, undefined, `${name} has no prompt file without role_file`);
	}
}

test("package and repo profiles start with their release model, thinking, tools, fast default and role text", async (t) => {
	await check(t, "none", { ...PACKAGE, ...REPO_PROFILES });
});

test("fixture personal spotty and bossy outrank the package ones and keep model, thinking and role by shape", async (t) => {
	await check(t, "fixture", FIXTURE_PERSONAL);
});

test("the real personal spotty and bossy, when this machine has them, keep their release model and thinking", async (t) => {
	const present = await readdir(PERSONAL).catch(() => []);
	if (!(present as string[]).includes("spotty.toml") || !(present as string[]).includes("bossy.toml")) return t.skip("no personal profiles on this machine");
	await check(t, "real", { spotty: { ...PACKAGE.spotty, sha256: PERSONAL_SHA }, bossy: { ...PACKAGE.bossy, sha256: PERSONAL_SHA } });
});

test("role_file, explicit model, thinking and fast_gpt keep their ordinary meaning with a reviewer profile", async (t) => {
	const { w, run } = await setup(t, "fixture");
	t.after(() => run.live.close());
	const reviewer = join(w.base, "REVIEWER.md");
	await run.execute({ action: "start", task: "file", agent_type: "spotty", role_file: reviewer, tools: ["read"], fast_gpt: true });
	await run.execute({ action: "start", task: "explicit", agent_type: "bossy", model: "persist-test/other", thinking: "high", fast_gpt: false });
	await run.live.wait(new AbortController().signal);
	// The file replaces the profile role, the profile still gives model and thinking, and the other options stay as given.
	const file = await run.resultOf("file", "agent#1");
	assert.equal(file.model.id, TERRA);
	assert.equal(file.effort, "low");
	assert.ok(file.system.includes(REVIEW_PREFIX));
	assert.ok(file.system.includes(await readFile(reviewer, "utf8")), "model request carries the full role_file text");
	assert.ok(!file.system.includes("PLACEHOLDER SPOTTY ROLE"));
	const fileRecord = saved(run, 1);
	assert.deepEqual(fileRecord.config.tools, ["read"]);
	assert.equal(fileRecord.fast, true);
	assert.equal(fileRecord.config.prompt_file.kind, "role");
	assert.equal(fileRecord.config.prompt_file.path, reviewer);
	assert.ok(fileRecord.config.role.startsWith(REVIEW_PREFIX));
	// The role_file text is REVIEWER.md in full: pinned hash of release, and lossless against the file itself.
	assert.equal(digest(fileRecord.config.role), REVIEW_SHA);
	assert.equal(fileRecord.config.role, await readFile(reviewer, "utf8"));
	// Explicit model and thinking beat the profile; its role text is still the profile's.
	const explicit = await run.resultOf("explicit", "agent#2");
	assert.equal(explicit.model.id, "other");
	assert.equal(explicit.effort, "high");
	assert.ok(explicit.system.includes("PLACEHOLDER BOSSY ROLE"));
	assert.equal(saved(run, 2).fast, false);
});
