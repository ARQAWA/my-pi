import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import type { ExtensionAPI, NormalizedBuildSystemPromptOptions } from "@earendil-works/pi-coding-agent";
import prompt, { STARTUP_PROJECTION, type StartupProjectionRequest } from "../../../extensions/RQW-prompt/index.ts";

type Handler = (event: any, context: any) => void;
function hooks() {
	const handlers = new Map<string, Handler>();
	const channels = new Map<string, (payload: unknown) => void>();
	const events = {
		on(name: string, handler: (payload: unknown) => void) { channels.set(name, handler); return () => { channels.delete(name); }; },
		emit(name: string, payload: unknown) { channels.get(name)?.(payload); },
	};
	prompt({ on: (name: string, handler: Handler) => handlers.set(name, handler), events } as unknown as ExtensionAPI);
	const options = () => ({ selectedTools: ["read", "bash"], hiddenTools: [] }) as unknown as NormalizedBuildSystemPromptOptions;
	return { events, options,
		prepare: (value: NormalizedBuildSystemPromptOptions) => handlers.get("before_agent_start")!({ systemPromptOptions: value }, { model: { provider: "fake", id: "one" } }),
		select: () => handlers.get("model_select")!({ model: { provider: "fake", id: "two" } }, {}),
	};
}

it("builds the default prefix and preserves explicit prompts and hidden bash", () => {
	const hook = hooks();
	const input = hook.options();
	hook.prepare(input);
	assert.match(input.customPrompt!, /You are an autonomous coding executor in pi/);
	assert.doesNotMatch(input.customPrompt!, /code-review stance/);
	assert.match(input.customPrompt!, /- Model: fake\/one/);
	assert.match(input.customPrompt!, /the bash tool runs bash/);
	const custom = hook.options();
	custom.customPrompt = "CUSTOM";
	hook.prepare(custom);
	assert.equal(custom.customPrompt, "CUSTOM");
	const hidden = hook.options();
	hidden.hiddenTools = ["bash"];
	hook.prepare(hidden);
	assert.doesNotMatch(hidden.customPrompt!, /the bash tool runs bash/);
});

it("the critical stop rule is the owner's: do all possible work, stop only when nothing more can be done", () => {
	const hook = hooks();
	const input = hook.options();
	hook.prepare(input);
	const critical = input.customPrompt!.match(/<critical>\n([\s\S]*?)\n<\/critical>/)![1].split("\n");
	assert.equal(
		critical[0],
		"- Each response MUST advance the task. Do everything you can; while a blocker or a wait holds, keep doing all other work that is possible. Stop only when nothing more can be done: the task is complete, a blocker is stated, or you wait for results you cannot speed up.",
	);
	assert.doesNotMatch(input.customPrompt!, /wait tool ends your turn/);
});

it("preserves a forced prompt before the agent starts", () => {
	const hook = hooks();
	const input = hook.options();
	input.forceSystemPrompt = "FORCED";
	hook.prepare(input);
	assert.equal(input.forceSystemPrompt, "FORCED");
	assert.equal(input.customPrompt, undefined);
});

it("preserves explicit prompts in startup projections", () => {
	const hook = hooks();
	for (const key of ["customPrompt", "forceSystemPrompt"] as const) {
		const options = hook.options();
		options[key] = "EXTERNAL";
		const request: StartupProjectionRequest = { options };
		hook.events.emit(STARTUP_PROJECTION, request);
		assert.equal(options[key], "EXTERNAL");
		if (key === "forceSystemPrompt") assert.equal(options.customPrompt, undefined);
		assert.equal(request.error, undefined);
	}
});

it("reports a startup projection error without writing a prefix", () => {
	const hook = hooks();
	const options = hook.options();
	Object.defineProperty(options, "selectedTools", { get() { throw new Error("unavailable tools"); } });
	const request: StartupProjectionRequest = { options };
	hook.events.emit(STARTUP_PROJECTION, request);
	assert.match(request.error!, /startup projection failed: unavailable tools/);
	assert.equal(options.customPrompt, undefined);
});

it("regression d1007fd: only an unchanged owned prefix receives live model metadata", () => {
	const hook = hooks();
	const input = hook.options();
	hook.prepare(input);
	hook.select();
	assert.match(input.customPrompt!, /- Model: fake\/two/);
	input.customPrompt = "EXTERNAL";
	hook.select();
	assert.equal(input.customPrompt, "EXTERNAL");
});

it("projects the same public prefix for startup without changing other options", () => {
	const hook = hooks();
	const request: StartupProjectionRequest = { options: hook.options(), model: { provider: "fake", id: "two" } };
	hook.events.emit(STARTUP_PROJECTION, request);
	assert.equal(request.error, undefined);
	assert.match(request.options.customPrompt!, /- Model: fake\/two/);
	assert.deepEqual(request.options.selectedTools, ["read", "bash"]);
});

it("the programs-on-PATH line lists probed programs but never rg or fd", () => {
	const dir = mkdtempSync(join(tmpdir(), "rqw-prompt-path-"));
	const savedPath = process.env.PATH;
	const savedExt = process.env.PATHEXT;
	try {
		// Bare names for Unix, .exe and .cmd for Windows PATHEXT; git proves the probe sees this directory.
		for (const name of ["git", "rg", "fd"]) {
			for (const ext of ["", ".exe", ".cmd"]) {
				const path = join(dir, name + ext);
				writeFileSync(path, "");
				chmodSync(path, 0o755);
			}
		}
		process.env.PATH = dir;
		process.env.PATHEXT = ".EXE;.CMD";
		const hook = hooks();
		const input = hook.options();
		hook.prepare(input);
		assert.match(input.customPrompt!, /programs on PATH: git\./);
	} finally {
		process.env.PATH = savedPath;
		if (savedExt === undefined) delete process.env.PATHEXT; else process.env.PATHEXT = savedExt;
		rmSync(dir, { recursive: true, force: true });
	}
});
