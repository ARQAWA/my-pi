import assert from "node:assert/strict";
import { test } from "node:test";
import { runtime, world } from "./fixture.ts";

test("the catalogue lists Codex's default and worker roles, never explorer", async (t) => {
	const w = await world(t);
	const run = runtime(w.cwd, w.base);
	await run.emit("session_start");
	const lines = run.description().split("\n");
	assert.ok(lines.some(line => line.startsWith("default: Default agent.; ") && line.includes("source=builtin:default")));
	assert.ok(lines.some(line => line.startsWith("worker: Use for execution and production work.")));
	assert.ok(!lines.some(line => line.startsWith("explorer")));
	run.live.close();
});

test("agent start with each built-in role keeps the parent's model, effort and prompt; explorer is unknown", async (t) => {
	const w = await world(t);
	const run = runtime(w.cwd, w.base, "low");
	await run.execute({ action: "start", task: "plain", tools: [] });
	await run.execute({ action: "start", task: "as default", agent_type: "default", tools: [] });
	await run.execute({ action: "start", task: "as worker", agent_type: "worker", tools: [] });
	await run.live.wait(new AbortController().signal);
	// The parent's model and effort carry over to both built-in roles, and the prompt gains no role text.
	const reference = await run.resultOf("plain", "agent#1");
	assert.deepEqual(reference.model, { provider: "persist-test", id: "model" });
	assert.equal(reference.effort, "low");
	assert.deepEqual(await run.resultOf("as default", "agent#2"), reference);
	assert.deepEqual(await run.resultOf("as worker", "agent#3"), reference);
	const status = await run.execute({ action: "status", ids: ["agent#2", "agent#3"] });
	assert.deepEqual(status.details.statuses.map((item: any) => [item.profile.name, item.profile.path]), [["default", "builtin:default"], ["worker", "builtin:worker"]]);
	await assert.rejects(run.execute({ action: "start", task: "x", agent_type: "explorer", tools: [] }), /Unknown agent_type: explorer/);
	run.live.close();
});

test("a user role of the same name replaces the built-in one", async (t) => {
	const w = await world(t);
	await w.put("codex/agents/worker.toml", 'name = "worker"\ndescription = "My worker"\ndeveloper_instructions = "MY WORKER RULES"\n');
	const run = runtime(w.cwd, w.base);
	await run.execute({ action: "start", task: "as worker", agent_type: "worker", tools: [] });
	await run.live.wait(new AbortController().signal);
	assert.match(run.systemOf("as worker"), /MY WORKER RULES/);
	await run.emit("session_start");
	const lines = run.description().split("\n").filter(line => line.startsWith("worker:"));
	assert.equal(lines.length, 1);
	assert.match(lines[0], /^worker: My worker;/);
	run.live.close();
});

test("start applies exactly the Codex role fields Pi supports; the rest is ignored or named as not applied", async (t) => {
	const w = await world(t);
	const supported = 'model = "persist-test/other"\nmodel_reasoning_effort = "medium"\ndeveloper_instructions = "ROLE RULES"\nnickname_candidates = ["Ada"]\n';
	await w.put("codex/agents/full.toml", `name = "full"\ndescription = "All kinds of fields"\n${supported}sandbox_mode = "read-only"\nfuture_codex_key = 1\nmodel_reasoning_summary = "auto"\nmodel_verbosity = "low"\npersonality = "friendly"\nservice_tier = "fast"\n[features]\nshell_tool = false\n[skills]\ninclude_instructions = false\n`);
	await w.put("codex/agents/plain.toml", `name = "plain"\ndescription = "Supported only"\n${supported}`);
	const run = runtime(w.cwd, w.base, "low");
	// The reference states the supported fields explicitly, without a profile.
	await run.execute({ action: "start", task: "reference", model: "persist-test/other", thinking: "medium", role: "ROLE RULES", tools: [] });
	await run.execute({ action: "start", task: "full", agent_type: "full", tools: [] });
	await run.execute({ action: "start", task: "plain", agent_type: "plain", tools: [] });
	await run.live.wait(new AbortController().signal);
	const reference = await run.resultOf("reference", "agent#1");
	assert.equal(reference.effort, "medium");
	assert.match(reference.system, /ROLE RULES/);
	// The profile model differs from the parent's, so a profile model that was ignored would fail here.
	assert.deepEqual(reference.model, { provider: "persist-test", id: "other" });
	assert.deepEqual(await run.resultOf("full", "agent#2"), reference);
	assert.deepEqual(await run.resultOf("plain", "agent#3"), reference);
	const lines = run.description().split("\n");
	assert.match(lines.find(line => line.startsWith("full:"))!, /; not applied: model_reasoning_summary, model_verbosity, personality, service_tier, features, skills(;|$)/);
	assert.doesNotMatch(lines.find(line => line.startsWith("plain:"))!, /not applied/);
	run.live.close();
});

test("role fields Pi cannot apply are still type checked by the Codex schema", async (t) => {
	const w = await world(t);
	const base = 'description = "d"\ndeveloper_instructions = "RULES"\n';
	await w.put("codex/agents/good.toml", `name = "good"\n${base}model_reasoning_summary = "concise"\nmodel_verbosity = "high"\npersonality = "pragmatic"\nservice_tier = "fast"\n[features]\nshell_tool = false\nunified_exec = false\n[skills]\ninclude_instructions = false\nmax_context_tokens = 100\nfuture_key = "accepted"\n[skills.bundled]\nenabled = false\n[[skills.config]]\nname = "x"\nenabled = false\n`);
	const bad: Record<string, string> = {
		summary: 'model_reasoning_summary = "loud"\n', verbosity: 'model_verbosity = 3\n', personality: 'personality = "grumpy"\n',
		tier: "service_tier = true\n", features: 'features = "on"\n', featurevalue: "[features]\nshell_tool = 1\n", featuretable: "[features]\nshell_tool = { enabled = true }\n",
		skills: "skills = 1\n", skilltokens: "[skills]\nmax_context_tokens = 0\n",
	};
	for (const [name, text] of Object.entries(bad)) await w.put(`codex/agents/${name}.toml`, `name = "${name}"\n${base}${text}`);
	const run = runtime(w.cwd, w.base);
	await run.emit("session_start");
	const lines = run.description().split("\n");
	assert.doesNotMatch(lines.find(line => line.startsWith("good:"))!, /unavailable|invalid profile/);
	for (const name of Object.keys(bad)) assert.match(lines.find(line => line.startsWith(`${name}:`))!, /unavailable: \w+ is invalid|invalid profile/, name);
	await assert.rejects(run.execute({ action: "start", task: "x", agent_type: "personality", tools: [] }), /Invalid agent_type personality: personality is invalid/);
	await run.execute({ action: "start", task: "ok", agent_type: "good", tools: [] });
	run.live.close();
});
