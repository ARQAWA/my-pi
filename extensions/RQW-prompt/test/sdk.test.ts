import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { it } from "node:test";
import { Type } from "typebox";
import { faux, once, start } from "./fixture.ts";

it("native AGENTS, skills, addenda, cwd, sections and tool declarations survive repeat and reload", async () => {
	const seen: unknown[] = [];
	const run = await start({ extraFactory: pi => {
		pi.on("before_agent_start", event => {
			seen.push(event.systemPromptOptions);
			event.systemPromptOptions.sections.regression = "CUSTOM_SECTION_SENTINEL";
		});
	} });
	try {
		for (let turn = 0; turn < 3; turn++) {
			if (turn === 2) await run.session.reload();
			const got = await run.capture();
			for (const text of ["You are a coding agent in pi", "PROJECT_CONTEXT_SENTINEL", "GLOBAL_CONTEXT_SENTINEL", "SKILL_DESCRIPTION_SENTINEL", "APPEND_A_SENTINEL", "APPEND_B_SENTINEL", "CUSTOM_SECTION_SENTINEL", "<cwd>"]) once(got.prompt, text);
			assert.doesNotMatch(got.prompt, /SKILL_BODY_NOT_AUTOLOADED|<search_method>|<rqw_tools_execution>/);
			assert.deepEqual(got.tools.sort(), ["bash", "edit", "read", "write"]);
			assert.equal(got.sections?.cwd, `<cwd>\n${run.cwd}\n</cwd>`);
			assert.match(got.prompt, /- Model: prompt-regression-faux\/one/);
		}
		assert.equal(new Set(seen).size, 3, "SDK must prepare distinct run options, not carry our customPrompt forward");
		await run.session.setModel(faux.getModel("two"));
		assert.match((await run.capture()).prompt, /- Model: prompt-regression-faux\/two/);
	} finally { await run.close(); }
});

it("loader custom prefix wins without a second full prefix, across repeat, model change and reload", async () => {
	const run = await start({ systemPrompt: "USER_CUSTOM_PREFIX_SENTINEL" });
	try {
		for (let turn = 0; turn < 3; turn++) {
			if (turn === 1) await run.session.setModel(faux.getModel("two"));
			if (turn === 2) await run.session.reload();
			const got = await run.capture();
			once(got.prompt, "USER_CUSTOM_PREFIX_SENTINEL");
			for (const text of ["PROJECT_CONTEXT_SENTINEL", "GLOBAL_CONTEXT_SENTINEL", "SKILL_DESCRIPTION_SENTINEL", "APPEND_A_SENTINEL", "<cwd>"]) once(got.prompt, text);
			assert.doesNotMatch(got.prompt, /You are a coding agent in pi|<workstation>/);
		}
	} finally { await run.close(); }
});

it("a discovered native SYSTEM.md remains the sole prefix", async () => {
	const run = await start();
	try {
		await mkdir(join(run.cwd, ".pi"));
		await writeFile(join(run.cwd, ".pi", "SYSTEM.md"), "DISCOVERED_PREFIX_SENTINEL");
		await run.session.reload();
		const got = await run.capture();
		once(got.prompt, "DISCOVERED_PREFIX_SENTINEL");
		assert.doesNotMatch(got.prompt, /You are a coding agent in pi|<workstation>/);
	} finally { await run.close(); }
});

it("a later native before_agent_start model selection updates the owned prepared prefix", async () => {
	const run = await start({ extraFactory: pi => {
		pi.on("before_agent_start", async () => { await pi.setModel(faux.getModel("two")); });
	} });
	try {
		const got = await run.capture();
		assert.equal(got.model, "prompt-regression-faux/two");
		assert.match(got.prompt, /- Model: prompt-regression-faux\/two/);
		assert.doesNotMatch(got.prompt, /- Model: prompt-regression-faux\/one/);
	} finally { await run.close(); }
});

for (const takeover of ["custom", "forced", "returned"] as const) {
	it(`a later ${takeover} prefix is not overwritten by model_select`, async () => {
		const run = await start({ extraFactory: pi => {
			pi.on("before_agent_start", async event => {
				if (takeover === "custom") event.systemPromptOptions.customPrompt = "LATER_CUSTOM_PREFIX";
				if (takeover === "forced") event.systemPromptOptions.forceSystemPrompt = "LATER_FORCED_PREFIX";
				await pi.setModel(faux.getModel("two"));
				if (takeover === "returned") return { systemPrompt: "RETURNED_FORCED_PREFIX" };
			});
		} });
		try {
			const got = await run.capture();
			assert.equal(got.model, "prompt-regression-faux/two");
			if (takeover === "forced") assert.equal(got.prompt, "LATER_FORCED_PREFIX");
			else if (takeover === "returned") assert.equal(got.prompt, "RETURNED_FORCED_PREFIX");
			else {
				once(got.prompt, "LATER_CUSTOM_PREFIX");
				assert.doesNotMatch(got.prompt, /You are a coding agent in pi|<workstation>/);
			}
		} finally { await run.close(); }
	});
}

it("zero selected tools and a read-only selection do not advertise a bash tool", async () => {
	for (const tools of [[], ["read"]]) {
		const run = await start({ tools });
		try {
			const got = await run.capture();
			assert.deepEqual(got.tools, tools);
			assert.doesNotMatch(got.prompt, /the bash tool|shell:|<search_method>|<rqw_tools_execution>/);
			assert.match(got.prompt, /Environment: paths: absolute like .*programs on PATH:/);
		} finally { await run.close(); }
	}
});

it("native hidden bash declarations do not advertise a directly available bash tool", async () => {
	const run = await start({ tools: ["read", "bash", "mask"], extraFactory: pi => {
		pi.registerTool({
			name: "mask", label: "mask", description: "Faux hidden-declaration fixture", parameters: Type.Object({}),
			prepareLoadout: () => ({ hiddenDeclarations: ["bash"] }),
			async execute() { return { content: [{ type: "text", text: "unused" }] }; },
		});
	} });
	try {
		const got = await run.capture();
		assert.ok(!got.tools.includes("bash"));
		assert.doesNotMatch(got.prompt, /the bash tool|shell:/);
		assert.match(got.prompt, /Environment: paths: absolute like .*programs on PATH:/);
	} finally { await run.close(); }
});
