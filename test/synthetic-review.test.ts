import assert from "node:assert/strict";
import { after, it } from "node:test";
import { call, isTask, reportTimings, text, world } from "./synthetic/world.ts";

after(() => reportTimings(import.meta.filename));

const ROLE = "read-only blind reviewer";

async function review(t: Parameters<typeof world>[0], profile: "spotty" | "bossy") {
	const w = await world(t);
	w.model.when(isTask("check it"), text("CLEAN"));
	w.model.script(
		call("agent", { action: "start", agent_type: profile, task: "check it", title: "Check" }, "r1"),
		call("agent", { action: "wait", ids: ["agent#1"] }, "r2"),
		text("reviewed"),
	);
	await w.submit("go");
	return w;
}

it("a spotty start gives the child the profile's model, effort and reviewer role; the main chat keeps its own", async (t) => {
	const w = await review(t, "spotty");

	const child = w.requests.find(isTask("check it"))!;
	assert.equal(`${child.model.provider}/${child.model.id}`, "openai-codex/gpt-6.1-terra");
	assert.equal((child.options as { reasoning?: string }).reasoning, "medium");
	assert.ok(JSON.stringify(child.context.messages[0]).includes(ROLE), "the profile's role is in the child's system prompt");
	const childFile = w.jsonl(w.childFiles(1)[0]);
	assert.deepEqual(childFile.filter((entry) => entry.type === "model_change").map((entry) => `${entry.provider}/${entry.modelId}`), ["openai-codex/gpt-6.1-terra"]);

	const main = w.requests.find((request) => request.background === undefined && !isTask("check it")(request))!;
	assert.equal(main.model.id, "claude-opus-5-5");
	assert.ok(!JSON.stringify(main.context.messages[0]).includes(ROLE), "the role does not leak into the main prompt");
	assert.ok(JSON.stringify(main.context.messages[0]).includes("spotty: Blind reviewer"), "the catalogue offers the profile");
	w.see("Waited for 1 agent");
	assert.deepEqual(w.errors, []);
});

it("a bossy start runs the same model at the strongest effort", async (t) => {
	const w = await review(t, "bossy");

	const child = w.requests.find(isTask("check it"))!;
	assert.equal(`${child.model.provider}/${child.model.id}`, "openai-codex/gpt-6.1-terra");
	assert.equal((child.options as { reasoning?: string }).reasoning, "xhigh");
	assert.ok(JSON.stringify(child.context.messages[0]).includes(ROLE));
});
