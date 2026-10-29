import assert from "node:assert/strict";
import { it } from "node:test";
import { fakePi, promptOf, run, world } from "./fixture.ts";

it("project_doc_max_bytes is one budget for project files; global files are outside it", async (t) => {
	const w = world(t);
	w.put("codex/config.toml", "project_doc_max_bytes = 10\n");
	const global = w.put("codex/AGENTS.md", "g".repeat(50));
	w.put("project/AGENTS.md", "123456");
	w.put("project/pkg/AGENTS.md", "abcdefgh");
	const notes: string[] = [];
	const files = await run(w, [], notes);
	assert.deepEqual(files.map(file => file.content), ["g".repeat(50), "123456", "abcd"]);
	assert.equal(files[0].path, global);
	assert.equal(notes.length, 1, "one warning per session");
	assert.match(notes[0], /project_doc_max_bytes/);
});

it("without the setting project files share the default 262144-byte (256 KB) budget", async (t) => {
	const w = world(t);
	w.put("project/AGENTS.md", "r".repeat(40000));
	const small: string[] = [];
	assert.deepEqual((await run(w, [], small)).map(file => file.content.length), [40000], "40 KB is not cut");
	assert.equal(small.length, 0);
	w.put("project/AGENTS.md", "r".repeat(260000));
	w.put("project/pkg/AGENTS.md", "l".repeat(5000));
	const notes: string[] = [];
	const files = await run(w, [], notes);
	assert.deepEqual(files.map(file => file.content.length), [260000, 2144]);
	assert.equal(notes.length, 1);
	// Exactly the budget: nothing is cut and nothing is warned about.
	w.put("project/pkg/AGENTS.md", "l".repeat(2144));
	const exact: string[] = [];
	assert.deepEqual((await run(w, [], exact)).map(file => file.content.length), [260000, 2144]);
	assert.equal(exact.length, 0);
	// A smaller configured value still cuts.
	w.put("codex/config.toml", "project_doc_max_bytes = 32768\n");
	w.put("project/AGENTS.md", "r".repeat(40000));
	const cut: string[] = [];
	assert.deepEqual((await run(w, [], cut)).map(file => file.content.length), [32768]);
	assert.equal(cut.length, 1);
});

it("cuts bytes first and decodes lossy, an empty file spends no budget, a spent budget stops the walk", async (t) => {
	const w = world(t);
	w.put("codex/config.toml", "project_doc_max_bytes = 4\n");
	w.put("project/AGENTS.md", "   ");
	w.put("project/pkg/AGENTS.md", "ab\u00e9\u00e9");
	assert.deepEqual((await run(w)).map(file => file.content), ["ab\u00e9"]);
	// "ab" + first byte of the second e-acute: the broken tail becomes U+FFFD, as Rust from_utf8_lossy does.
	w.put("codex/config.toml", "project_doc_max_bytes = 3\n");
	assert.deepEqual((await run(w)).map(file => file.content), ["ab\ufffd"]);
	w.put("codex/config.toml", "project_doc_max_bytes = 0\n");
	assert.deepEqual(await run(w), []);
});

it("keeps a leading BOM like Codex: in project and global text, and a BOM-only project file still counts", async (t) => {
	const w = world(t);
	w.put("codex/AGENTS.md", "\uFEFF global ");
	w.put("project/AGENTS.md", "\uFEFFroot");
	w.put("project/pkg/AGENTS.md", "\uFEFF");
	assert.deepEqual((await run(w)).map(file => file.content), ["\uFEFF global", "\uFEFFroot", "\uFEFF"]);
});

const blocks = (prompt: string) => [...prompt.matchAll(/<project_instructions path="([^"]*)">\n([\s\S]*?)\n<\/project_instructions>/g)].map(match => ({ path: match[1], content: match[2] }));

it("the final prompt text and the prewarm projection carry the same cut instruction files", async (t) => {
	const w = world(t);
	w.put("codex/config.toml", "project_doc_max_bytes = 10\n");
	const global = w.put("codex/AGENTS.md", "g".repeat(50));
	const root = w.put("project/AGENTS.md", "123456");
	const leaf = w.put("project/pkg/AGENTS.md", "abcdefgh");
	const { system, prewarm, notes } = await promptOf(w, { env: w.env });
	assert.deepEqual(blocks(system), [{ path: global, content: "g".repeat(50) }, { path: root, content: "123456" }, { path: leaf, content: "abcd" }]);
	assert.equal(prewarm, system);
	assert.equal(notes.length, 1);
});

it("warns once per session, also after the extension is loaded again, and again in a new session", async (t) => {
	const w = world(t);
	w.put("codex/config.toml", "project_doc_max_bytes = 2\n");
	w.put("project/AGENTS.md", "abcdef");
	const notes: string[] = [];
	const turn = async (session: string) => {
		// A reload runs the extension factory again; the session id stays.
		const pi = fakePi({ env: w.env });
		const ctx = { cwd: w.cwd, sessionManager: { getSessionId: () => session }, ui: { notify: (message: string) => notes.push(message) } };
		await pi.fire("session_start", { reason: "reload" }, ctx);
		await pi.fire("before_agent_start", { systemPromptOptions: { cwd: w.cwd, skills: [], contextFiles: [] } }, ctx);
	};
	await turn("reload-session");
	await turn("reload-session");
	assert.equal(notes.length, 1);
	await turn("another-session");
	assert.equal(notes.length, 2);
});

it("--no-context-files (and -nc) leaves Pi's empty list alone: no Codex instruction file is added", async (t) => {
	const w = world(t);
	w.put("codex/AGENTS.md", "global");
	w.put("project/AGENTS.md", "project");
	assert.equal((await run(w)).length, 2);
	for (const flag of ["--no-context-files", "-nc"]) assert.deepEqual(await run(w, [], [], undefined, [flag]), []);
});

it("--no-skills (and -ns) offers no Codex skill root, but the rules still apply to skills Pi loads explicitly", async (t) => {
	const w = world(t);
	w.skill("codex/skills/a", "a");
	const kept = w.skill("agent/extra/kept", "kept");
	const dropped = w.skill("agent/extra/dropped", "dropped");
	w.put("codex/config.toml", `[[skills.config]]\npath = "${dropped}"\nenabled = false\n`);
	const loaded = [kept, dropped].map(filePath => ({ name: filePath.split("/").at(-2), description: "d", filePath, baseDir: "", sourceInfo: { scope: "user" }, disableModelInvocation: false }));
	const offered = async (argv: string[]) => (await fakePi({ env: w.env, argv }).fire("resources_discover", { cwd: w.cwd, reason: "startup" }) as { skillPaths?: string[] } | undefined)?.skillPaths;
	assert.deepEqual(await offered([]), [w.path("codex/skills")]);
	for (const flag of ["--no-skills", "-ns"]) {
		assert.equal(await offered([flag]), undefined);
		const pi = fakePi({ env: w.env, argv: [flag] });
		const event = { systemPromptOptions: { cwd: w.cwd, skills: [...loaded], contextFiles: [] } };
		await pi.fire("before_agent_start", event, { cwd: w.cwd, sessionManager: { getSessionId: () => "s" }, ui: { notify() {} } });
		assert.deepEqual(event.systemPromptOptions.skills.map((skill: any) => skill.name), ["kept"]);
	}
});
