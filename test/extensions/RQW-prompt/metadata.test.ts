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
