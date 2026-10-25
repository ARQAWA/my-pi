import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { ProfileCatalogue, type ProfileOptions, type ProfileRef } from "../../../extensions/RQW-agent/profiles.ts";

const hash = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const role = (name: string, description = name, extra = "") => `name = ${JSON.stringify(name)}\ndescription = ${JSON.stringify(description)}\ndeveloper_instructions = " instructions "\n${extra}`;
async function fixture() {
	const root = await fs.mkdtemp(join(tmpdir(), "rqw-profiles-"));
	const repo = join(root, "repo");
	await fs.mkdir(join(repo, ".git"), { recursive: true });
	const options: ProfileOptions = { cwd: repo, agentDir: join(root, "pi"), codexHome: join(root, "codex"), extensionPaths: [] };
	return {
		root, repo, options, catalogue: new ProfileCatalogue(),
		async put(path: string, text: string | Uint8Array) { await fs.mkdir(dirname(path), { recursive: true }); await fs.writeFile(path, text); return path; },
		async cleanup() { await fs.rm(root, { recursive: true, force: true }); },
	};
}

test("supported native metadata, exact byte provenance and unsupported effort strings", async () => {
	const f = await fixture();
	try {
		const text = 'name = " scout "\r\ndescription = " Description "\r\nmodel = "gpt-6.1-sol"\r\nmodel_reasoning_effort = "future-effort"\r\nnickname_candidates = [" Ada ", "Turing"]\r\ndeveloper_instructions = """\r\nFirst line.\r\n  Second line.\r\n"""\r\n';
		const path = await f.put(join(f.options.agentDir, "agents", "scout.toml"), text);
		const [profile] = await f.catalogue.refresh(f.options);
		const ref: ProfileRef = { name: profile.name, path: profile.path, sha256: profile.sha256 };
		assert.deepEqual(ref, { name: "scout", path, sha256: hash(text) });
		assert.equal(profile.description, "Description");
		assert.equal(profile.model, "gpt-6.1-sol");
		assert.equal(profile.model_reasoning_effort, "future-effort");
		assert.deepEqual(profile.nickname_candidates, ["Ada", "Turing"]);
		assert.equal(profile.developer_instructions, "First line.\r\n  Second line.\r\n");
		assert.equal(profile.error, undefined);
		assert.equal(f.catalogue.get("scout"), profile);
		assert.equal(f.catalogue.get("missing"), undefined);
	} finally { await f.cleanup(); }
});

test("priority is extensions, Codex home, Pi home, then root-to-cwd with Pi winning each directory", async () => {
	const f = await fixture();
	try {
		f.options.cwd = join(f.repo, "a", "b");
		await fs.mkdir(f.options.cwd, { recursive: true });
		const layers = [join(f.root, "extension"), f.options.codexHome!, f.options.agentDir,
			join(f.repo, ".codex"), join(f.repo, ".pi"), join(f.repo, "a", ".codex"), join(f.repo, "a", ".pi"),
			join(f.options.cwd, ".codex"), join(f.options.cwd, ".pi")];
		f.options.extensionPaths = [join(layers[0], "agents")];
		for (let layer = 0; layer < layers.length; layer++) {
			for (let name = layer; name < layers.length; name++) await f.put(join(layers[layer], "agents", `role${name}.toml`), role(`role${name}`, `layer${layer}`));
		}
		const profiles = await f.catalogue.refresh(f.options);
		assert.equal(profiles.length, layers.length);
		for (let i = 0; i < layers.length; i++) assert.equal(f.catalogue.get(`role${i}`)?.description, `layer${i}`);
	} finally { await f.cleanup(); }
});

test("project and extension files load directly, repo boundary accepts .git files", async () => {
	const f = await fixture();
	try {
		await fs.rm(join(f.repo, ".git"), { recursive: true });
		await f.put(join(f.repo, ".git"), "gitdir: another-location");
		await f.put(join(f.root, ".pi", "agents", "outside.toml"), role("outside"));
		await f.put(join(f.repo, ".codex", "agents", "project.toml"), role("project"));
		await f.put(join(f.options.agentDir, "agents", "global.toml"), role("global"));
		const path = await f.put(join(f.root, "offered.toml"), role("offered"));
		f.options.extensionPaths = [path];
		assert.deepEqual((await f.catalogue.refresh(f.options)).map(p => p.name), ["global", "offered", "project"]);
		assert.equal(f.catalogue.get("outside"), undefined);
	} finally { await f.cleanup(); }
});

test("declarations resolve relative and absolute config_file, file metadata wins, declared files are not rediscovered", async () => {
	const f = await fixture();
	try {
		const directory = f.options.agentDir;
		const file = await f.put(join(directory, "agents", "nested", "referenced.toml"), 'name = "actual"\ndescription = "file description"\nnickname_candidates = ["File"]\nmodel = "gpt-6.1-sol"\n');
		const absolute = await f.put(join(f.root, "outside.toml"), 'model_reasoning_effort = "low"\n');
		await f.put(join(directory, "config.toml"), `[agents.alias]\nconfig_file = "agents/nested/referenced.toml"\ndescription = "old description"\nnickname_candidates = ["Old"]\n[agents.legacy]\nconfig_file = ${JSON.stringify(absolute)}\ndescription = "Legacy"\n`);
		assert.deepEqual((await f.catalogue.refresh(f.options)).map(p => p.name), ["actual", "legacy"]);
		assert.equal(f.catalogue.get("actual")?.description, "file description");
		assert.deepEqual(f.catalogue.get("actual")?.nickname_candidates, ["File"]);
		assert.equal(f.catalogue.get("actual")?.path, file);
		assert.equal(f.catalogue.get("actual")?.developer_instructions, undefined);
		assert.equal(f.catalogue.get("legacy")?.path, absolute);
		assert.equal(f.catalogue.get("legacy")?.model_reasoning_effort, "low");
		assert.equal(f.catalogue.get("legacy")?.error, undefined);
	} finally { await f.cleanup(); }
});

test("declarations silently ignore inline execution fields and name regardless of type", async () => {
	const f = await fixture();
	try {
		const configPath = join(f.options.agentDir, "config.toml");
		for (const values of [
			'name = "renamed"\nmodel = "inline-model"\ndeveloper_instructions = "inline instructions"\nmodel_reasoning_effort = "high"\n',
			'name = []\nmodel = 42\ndeveloper_instructions = false\nmodel_reasoning_effort = {}\n',
		]) {
			const config = `[agents.example]\ndescription = "Example"\nnickname_candidates = ["Ada"]\n${values}`;
			await f.put(configPath, config);
			assert.deepEqual((await f.catalogue.refresh(f.options)).map(p => p.name), ["example"]);
			const profile = f.catalogue.get("example")!;
			assert.equal(profile.error, undefined);
			assert.equal(profile.description, "Example");
			assert.deepEqual(profile.nickname_candidates, ["Ada"]);
			assert.equal(profile.model, undefined);
			assert.equal(profile.developer_instructions, undefined);
			assert.equal(profile.model_reasoning_effort, undefined);
			assert.equal(profile.path, configPath);
			assert.equal(profile.sha256, hash(config));
			assert.equal("warnings" in profile, false);
		}
	} finally { await f.cleanup(); }
});

test("referenced role configs retain execution fields while declarations only override metadata", async () => {
	const f = await fixture();
	try {
		const text = 'model = "gpt-6.1-sol"\ndeveloper_instructions = " exact role instructions "\nmodel_reasoning_effort = "medium"\n';
		const file = await f.put(join(f.options.codexHome!, "role.toml"), text);
		await f.put(join(f.options.codexHome!, "config.toml"), '[agents.example]\nconfig_file = "role.toml"\ndescription = "Lower"\nnickname_candidates = ["Lower"]\nmodel = false\ndeveloper_instructions = []\nmodel_reasoning_effort = 1\nname = "not-example"\n');
		await f.put(join(f.options.agentDir, "config.toml"), '[agents.example]\ndescription = "Higher"\nnickname_candidates = ["Higher"]\nmodel = "ignored"\ndeveloper_instructions = "ignored"\nmodel_reasoning_effort = "ignored"\n');
		assert.deepEqual((await f.catalogue.refresh(f.options)).map(p => p.name), ["example"]);
		const profile = f.catalogue.get("example")!;
		assert.equal(profile.error, undefined);
		assert.equal(profile.path, file);
		assert.equal(profile.sha256, hash(text));
		assert.equal(profile.model, "gpt-6.1-sol");
		assert.equal(profile.developer_instructions, " exact role instructions ");
		assert.equal(profile.model_reasoning_effort, "medium");
		assert.equal(profile.description, "Higher");
		assert.deepEqual(profile.nickname_candidates, ["Higher"]);

	} finally { await f.cleanup(); }
});

test("malformed supported declaration metadata is isolated from healthy declarations", async () => {
	const f = await fixture();
	try {
		await f.put(join(f.options.agentDir, "config.toml"), '[agents.bad_description]\ndescription = false\n[agents.bad_nicknames]\ndescription = "Bad nicknames"\nnickname_candidates = 42\n[agents.healthy]\ndescription = "Healthy"\n');
		assert.deepEqual((await f.catalogue.refresh(f.options)).map(p => p.name), ["bad_description", "bad_nicknames", "healthy"]);
		assert.equal(f.catalogue.get("bad_description")?.error, "description must be a string");
		assert.equal(f.catalogue.get("bad_nicknames")?.error, "nickname_candidates must be an array of strings");
		assert.equal(f.catalogue.get("healthy")?.error, undefined);
		assert.equal(f.catalogue.get("healthy")?.description, "Healthy");
	} finally { await f.cleanup(); }
});

test("missing declaration metadata falls back across layers, without mixing separate runtime role files", async () => {
	const f = await fixture();
	try {
		for (const name of ["kept", "replaced", "discovered"]) await f.put(join(f.options.codexHome!, "agents", `${name}.toml`), role(name, `lower ${name}`, 'model = "lower-model"\nnickname_candidates = ["Lower"]\n'));
		const replacement = await f.put(join(f.options.agentDir, "agents", "new.toml"), 'name = "replaced"\nmodel_reasoning_effort = "high"\n');
		await f.put(join(f.options.agentDir, "agents", "discovered.toml"), 'name = "discovered"\ndeveloper_instructions = "new instructions"\n');
		await f.put(join(f.options.agentDir, "config.toml"), '[agents.kept]\ndescription = "higher kept"\n[agents.replaced]\nconfig_file = "agents/new.toml"\n');
		await f.catalogue.refresh(f.options);
		const kept = f.catalogue.get("kept")!;
		assert.equal(kept.description, "higher kept");
		assert.equal(kept.model, "lower-model");
		assert.equal(kept.path, join(f.options.codexHome!, "agents", "kept.toml"));
		assert.equal(kept.developer_instructions, " instructions ");
		const replaced = f.catalogue.get("replaced")!;
		assert.equal(replaced.description, "lower replaced");
		assert.deepEqual(replaced.nickname_candidates, ["Lower"]);
		assert.equal(replaced.path, replacement);
		assert.equal(replaced.model, undefined);
		assert.equal(replaced.developer_instructions, undefined);
		assert.equal(replaced.error, undefined);
		assert.equal(f.catalogue.get("discovered")?.description, "lower discovered");
		assert.equal(f.catalogue.get("discovered")?.developer_instructions, "new instructions");
		assert.equal(f.catalogue.get("discovered")?.model, undefined);
	} finally { await f.cleanup(); }
});

test("recursive discovery is sorted, first duplicate in a layer wins and declarations win discovery", async () => {
	const f = await fixture();
	try {
		const directory = join(f.options.agentDir, "agents");
		await f.put(join(directory, "z.toml"), role("same", "last"));
		const first = await f.put(join(directory, "a", "first.toml"), role("same", "first"));
		await f.put(join(directory, "b", "unique.toml"), role("unique"));
		await f.put(join(directory, "ignored.txt"), role("not-toml"));
		await f.put(join(directory, "ignored.TOML"), role("not-lowercase"));
		await f.put(join(directory, "declared.toml"), role("declaration", "file"));
		await f.put(join(f.options.agentDir, "config.toml"), '[agents.declaration]\ndescription = "declaration"\n');
		assert.deepEqual((await f.catalogue.refresh(f.options)).map(p => p.name), ["declaration", "same", "unique"]);
		assert.equal(f.catalogue.get("same")?.path, first);
		assert.equal(f.catalogue.get("same")?.description, "first");
		assert.equal(f.catalogue.get("declaration")?.description, "declaration");
	} finally { await f.cleanup(); }
});

test("invalid supported types and missing required fields stay visible and shadow valid lower profiles", async () => {
	const f = await fixture();
	try {
		const cases = [
			['name = 42\ndescription = "bad"\ndeveloper_instructions = "x"', /name must be a string/],
			['name = "r1"\ndescription = false\ndeveloper_instructions = "x"', /description must be a string/],
			['name = "r2"\ndescription = "bad"\ndeveloper_instructions = []', /developer_instructions must be a string/],
			[role("r3", "bad", "model = 3"), /model must be a string/],
			[role("r4", "bad", "model_reasoning_effort = false"), /model_reasoning_effort must be a string/],
			[role("r5", "bad", 'nickname_candidates = ["Ada", 7]'), /nickname_candidates must be an array of strings/],
			[role("r6", "bad", "nickname_candidates = []"), /distinct non-empty ASCII names/],
			['name = "r7"\ndescription = "bad"', /developer_instructions is required/],
			['description = "bad"\ndeveloper_instructions = "x"', /name is required/],
			[role("r9", " "), /description cannot be blank/],
			['name = "r10"\ndescription = "bad"\ndeveloper_instructions = " "', /developer_instructions cannot be blank/],
			[role("r11", "bad", 'nickname_candidates = ["Ada", " Ada "]'), /distinct non-empty ASCII names/],
		] as const;
		for (let i = 0; i < cases.length; i++) {
			await f.put(join(f.options.codexHome!, "agents", `r${i}.toml`), role(`r${i}`, "lower valid"));
			await f.put(join(f.options.agentDir, "agents", `r${i}.toml`), cases[i][0]);
		}
		const profiles = await f.catalogue.refresh(f.options);
		assert.equal(profiles.length, cases.length);
		for (let i = 0; i < cases.length; i++) {
			const profile = f.catalogue.get(`r${i}`)!;
			assert.match(profile.error!, cases[i][1]);
			assert.match(profile.description, /unavailable:/);
			assert.equal(profile.path, join(f.options.agentDir, "agents", `r${i}.toml`));
		}
	} finally { await f.cleanup(); }
});

test("corrupt files have isolated errors without retaining earlier profile names", async () => {
	const f = await fixture();
	try {
		await f.put(join(f.options.codexHome!, "agents", "lower.toml"), role("named"));
		const path = await f.put(join(f.options.agentDir, "agents", "different-file-name.toml"), role("named"));
		await f.catalogue.refresh(f.options);
		await f.put(path, 'name = "named"\nsecret = "DO_NOT_EXPOSE_SYNTAX_SECRET');
		await f.catalogue.refresh(f.options);
		assert.equal(f.catalogue.get("named")?.error, undefined);
		assert.equal(f.catalogue.get("named")?.path, join(f.options.codexHome!, "agents", "lower.toml"));
		assert.match(f.catalogue.get("different-file-name")?.error!, /Invalid TOML/);
		assert.equal(f.catalogue.get("different-file-name")?.path, path);
		assert.doesNotMatch(JSON.stringify(await f.catalogue.refresh(f.options)), /DO_NOT_EXPOSE/);
		await f.put(path, new Uint8Array([0xff, 0xfe]));
		await f.catalogue.refresh(f.options);
		assert.match(f.catalogue.get("different-file-name")?.error!, /UTF-8/);
		assert.equal(f.catalogue.get("named")?.error, undefined);
	} finally { await f.cleanup(); }
});

test("unknown file and declaration keys are silently ignored", async () => {
	const f = await fixture();
	try {
		const text = role("role", "Role", 'sandbox_mode = "UNAPPLIED_VALUE"\n[features]\nprivate = "UNAPPLIED_VALUE"\n');
		const file = await f.put(join(f.options.agentDir, "agents", "role.toml"), text);
		await f.put(join(f.options.agentDir, "config.toml"), '[agents.role]\nconfig_file = "agents/role.toml"\nnot_supported = "UNAPPLIED_VALUE"\n');
		const profiles = await f.catalogue.refresh(f.options);
		assert.deepEqual(profiles, [{ name: "role", description: "Role", developer_instructions: " instructions ", nickname_candidates: undefined, path: file, sha256: hash(text), error: undefined }]);
	} finally { await f.cleanup(); }
});

test("unchanged files use stat cache; changed and deleted files are refreshed", async t => {
	const f = await fixture();
	try {
		const path = await f.put(join(f.options.agentDir, "agents", "cached.toml"), role("cached"));
		await f.put(join(f.options.agentDir, "config.toml"), '[agents.cached]\nconfig_file = "agents/cached.toml"\n');
		const original = fs.readFile;
		const reads: string[] = [];
		t.mock.method(fs, "readFile", (...args: Parameters<typeof fs.readFile>) => { reads.push(String(args[0])); return original(...args); });
		await f.catalogue.refresh(f.options);
		assert.equal(reads.length, 2);
		await f.catalogue.refresh(f.options);
		assert.equal(reads.length, 2);
		await f.put(path, role("cached", "changed"));
		await f.catalogue.refresh(f.options);
		assert.equal(reads.length, 3);
		assert.equal(f.catalogue.get("cached")?.description, "changed");
		await fs.rm(path);
		await f.catalogue.refresh(f.options);
		assert.match(f.catalogue.get("cached")?.error!, /Cannot read/);
		await fs.rm(join(f.options.agentDir, "config.toml"));
		assert.deepEqual(await f.catalogue.refresh(f.options), []);
	} finally { await f.cleanup(); }
});

test("lifecycle outside roles is ignored and invalid declaration fields do not fall back", async () => {
	const f = await fixture();
	try {
		await f.put(join(f.options.codexHome!, "agents", "bad.toml"), role("bad", "lower"));
		await f.put(join(f.options.agentDir, "config.toml"), 'model = 25\nexperimental = "ignored"\n[features]\nwhatever = true\n[agents]\nmax_threads = 100\nmax_depth = 4\nenabled = true\ndefault_subagent_model = "ignored"\n[agents.bad]\ndescription = false\nconfig_file = 2\n[agents.missing]\ndescription = "missing reference"\nconfig_file = "absent.toml"\n');
		assert.deepEqual((await f.catalogue.refresh(f.options)).map(p => p.name), ["bad", "missing"]);
		assert.match(f.catalogue.get("bad")?.error!, /description must be a string/);
		assert.match(f.catalogue.get("missing")?.error!, /Cannot read/);
	} finally { await f.cleanup(); }
});

test("invalid declarations are isolated and malformed config does not retain past declarations", async () => {
	const f = await fixture();
	try {
		await f.put(join(f.options.codexHome!, "agents", "bad.toml"), role("bad", "valid lower bad"));
		await f.put(join(f.options.codexHome!, "agents", "healthy.toml"), role("healthy", "valid lower healthy"));
		const configPath = await f.put(join(f.options.agentDir, "config.toml"), '[agents]\nmax_threads = 100\nbad = 123\n[agents.healthy]\ndescription = "higher healthy"\n');
		assert.deepEqual((await f.catalogue.refresh(f.options)).map(p => p.name), ["bad", "healthy"]);
		assert.equal(f.catalogue.get("bad")?.error, "Agent role declaration must be a table");
		assert.match(f.catalogue.get("bad")?.description!, /unavailable:/);
		assert.equal(f.catalogue.get("healthy")?.error, undefined);
		assert.equal(f.catalogue.get("healthy")?.description, "higher healthy");
		await f.put(configPath, 'secret = "NEVER_SHOW_MALFORMED_CONFIG');
		await f.catalogue.refresh(f.options);
		assert.equal(f.catalogue.get("bad")?.error, undefined);
		assert.equal(f.catalogue.get("healthy")?.description, "valid lower healthy");
		assert.match(f.catalogue.get("config")?.error!, /Invalid TOML/);
		assert.doesNotMatch(JSON.stringify(f.catalogue.get("config")), /NEVER_SHOW/);
	} finally { await f.cleanup(); }
});

test("declaration files accept a blank name as their declaration hint and require resulting description", async () => {
	const f = await fixture();
	try {
		await f.put(join(f.options.agentDir, "agents", "legacy.toml"), 'name = " "\nmodel = "gpt-6.1-sol"\n');
		await f.put(join(f.options.agentDir, "config.toml"), '[agents.legacy]\nconfig_file = "agents/legacy.toml"\ndescription = "Legacy role"\n[agents.undescribed]\n');
		await f.catalogue.refresh(f.options);
		assert.equal(f.catalogue.get("legacy")?.error, undefined);
		assert.equal(f.catalogue.get("legacy")?.description, "Legacy role");
		assert.match(f.catalogue.get("undescribed")?.error!, /description is required/);
	} finally { await f.cleanup(); }
});

test("relative extension paths are rejected, missing absolute profiles are visible, multiple offerings layer in order", async () => {
	const f = await fixture();
	try {
		const first = await f.put(join(f.root, "first.toml"), role("offered", "first"));
		const second = await f.put(join(f.root, "second.toml"), role("offered", "second"));
		f.options.extensionPaths = ["relative.toml", first, second, join(f.root, "missing.toml")];
		await f.catalogue.refresh(f.options);
		assert.equal(f.catalogue.get("offered")?.description, "second");
		assert.match(f.catalogue.get("missing")?.error!, /Cannot read/);
	} finally { await f.cleanup(); }
});

test("invalid lower files remain invalid through metadata-only overrides", async () => {
	const f = await fixture();
	try {
		await f.put(join(f.options.codexHome!, "agents", "broken.toml"), role("broken", "Broken", "model = 123"));
		const config = await f.put(join(f.options.agentDir, "config.toml"), '[agents.broken]\ndescription = "Higher metadata"\n');
		await f.catalogue.refresh(f.options);
		assert.match(f.catalogue.get("broken")?.error!, /model must be a string/);
		await f.put(config, 'secret = "NEVER_SHOW_MALFORMED_CONFIG');
		await f.catalogue.refresh(f.options);
		assert.match(f.catalogue.get("broken")?.error!, /model must be a string/);
		assert.match(f.catalogue.get("config")?.error!, /Invalid TOML/);
	} finally { await f.cleanup(); }
});

test("omitted codexHome uses controlled CODEX_HOME, without consulting the real user home", async () => {
	const f = await fixture();
	const saved = process.env.CODEX_HOME;
	try {
		await f.put(join(f.options.codexHome!, "agents", "environment.toml"), role("environment"));
		process.env.CODEX_HOME = f.options.codexHome;
		const { codexHome: _home, ...options } = f.options;
		assert.deepEqual((await f.catalogue.refresh(options)).map(p => p.name), ["environment"]);
	} finally {
		if (saved === undefined) delete process.env.CODEX_HOME;
		else process.env.CODEX_HOME = saved;
		await f.cleanup();
	}
});

// Fixtures from codex-subagents-full-pack (1).zip: Bossy retains its original bytes;
// the renamed Spotty fixture retains the original blind-review instructions.
test("owner's TOML fixtures preserve original reviewer instructions without a dependency on Downloads", async () => {
	const f = await fixture();
	try {
		const directory = fileURLToPath(new URL("./profiles-fixtures/", import.meta.url));
		f.options.extensionPaths = [directory];
		const profiles = await f.catalogue.refresh(f.options);
		assert.deepEqual(profiles.map(p => p.name), ["bossy", "spotty"]);
		assert.equal(f.catalogue.get("bossy")?.sha256, "6a1cb141944e448fcf1f3f6cf02fda02ab82c6c6fa606762114021efc6e40961");
		assert.equal(hash(f.catalogue.get("spotty")!.developer_instructions!), "d00b2e37c9fc415fcb8d9971e835aa05d894c7ae4484a17d7260922c076ef269");
		for (const profile of profiles) {
			assert.equal(profile.error, undefined);
			assert.equal(profile.model, "gpt-6.1-sol");
			assert.ok(profile.developer_instructions?.includes("You are a read-only blind reviewer"));
		}
	} finally { await f.cleanup(); }
});
