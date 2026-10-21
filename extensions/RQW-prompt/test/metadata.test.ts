import "./guard.mjs";
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import type { ExtensionAPI, NormalizedBuildSystemPromptOptions } from "@earendil-works/pi-coding-agent";
import { buildSystemPrompt, buildSystemPromptSections, normalizeBuildSystemPromptOptions } from "../../../node_modules/@earendil-works/pi-coding-agent/dist/core/system-prompt.js";
import prompt from "../index.ts";

type Handler = (event: any, context: any) => void;
function hooks() {
	const handlers = new Map<string, Handler>();
	prompt({ on(name: string, handler: Handler) { handlers.set(name, handler); } } as unknown as ExtensionAPI);
	return {
		prepare(options: NormalizedBuildSystemPromptOptions) { handlers.get("before_agent_start")!({ systemPromptOptions: options }, { model: { provider: "faux", id: "one" } }); },
		select() { handlers.get("model_select")!({ model: { provider: "faux", id: "two" } }, {}); },
		start() { handlers.get("agent_start")!({}, {}); },
	};
}
const options = () => normalizeBuildSystemPromptOptions({ cwd: "C:\\work\\project", selectedTools: ["read", "bash"] });

it("only the default prefix changes; native sections and explicit empty/custom/forced values are preserved", () => {
	const hook = hooks();
	const input = options();
	input.appendSystemPrompt = "ADDENDUM";
	input.contextFiles = [{ path: "/project/AGENTS.md", content: "CONTEXT" }];
	input.sections.extra = "EXTRA";
	const before = buildSystemPromptSections(input);
	hook.prepare(input);
	const after = buildSystemPromptSections(input);
	for (const name of ["addendum", "project_context", "cwd", "extra"]) assert.equal(after[name], before[name]);
	assert.deepEqual(Object.keys(after), ["preamble", "addendum", "project_context", "cwd", "extra"]);
	for (const value of ["", "USER_PREFIX"]) {
		const custom = options(); custom.customPrompt = value;
		hook.prepare(custom); hook.select();
		assert.equal(custom.customPrompt, value);
	}
	const forced = options(); forced.forceSystemPrompt = "FORCED";
	hook.prepare(forced); hook.select();
	assert.equal(forced.customPrompt, undefined);
	assert.equal(buildSystemPrompt(forced), "FORCED");
});

it("an owned prefix is updated only while prepared and still unchanged", () => {
	const hook = hooks();
	const input = options(); hook.prepare(input); hook.select();
	assert.match(input.customPrompt!, /- Model: faux\/two/);
	input.customPrompt = "EXTERNAL"; hook.select();
	assert.equal(input.customPrompt, "EXTERNAL");
	const forced = options(); hook.prepare(forced);
	const owned = forced.customPrompt;
	forced.forceSystemPrompt = "FORCED"; hook.select();
	assert.equal(forced.customPrompt, owned);
	const started = options(); hook.prepare(started); hook.start(); hook.select();
	assert.match(started.customPrompt!, /- Model: faux\/one/);
});

it("PATH contents are checked anew for installs and deletions without changing PATH", async () => {
	const dir = await mkdtemp(join(tmpdir(), "rqw-prompt-path-"));
	const oldPath = process.env.PATH;
	process.env.PATH = dir;
	try {
		const hook = hooks();
		const first = options(); hook.prepare(first);
		assert.match(first.customPrompt!, /programs on PATH: none found\./);
		const file = join(dir, process.platform === "win32" ? "node.exe" : "node");
		await writeFile(file, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
		await chmod(file, 0o755);
		const installed = options(); hook.prepare(installed);
		assert.match(installed.customPrompt!, /programs on PATH: node\./);
		await rm(file);
		const deleted = options(); hook.prepare(deleted);
		assert.match(deleted.customPrompt!, /programs on PATH: none found\./);
	} finally {
		if (oldPath === undefined) delete process.env.PATH; else process.env.PATH = oldPath;
		await rm(dir, { recursive: true, force: true });
	}
});

it("Unix rejects directories and non-executable files but accepts executable files", { skip: process.platform === "win32" }, async () => {
	const dir = await mkdtemp(join(tmpdir(), "rqw-prompt-unix-"));
	const oldPath = process.env.PATH; process.env.PATH = dir;
	try {
		await mkdir(join(dir, "git"));
		await writeFile(join(dir, "rg"), "not executable"); await chmod(join(dir, "rg"), 0o644);
		const hook = hooks();
		const input = options(); hook.prepare(input);
		assert.match(input.customPrompt!, /programs on PATH: none found\./);
		await chmod(join(dir, "rg"), 0o755);
		const executable = options(); hook.prepare(executable);
		assert.match(executable.customPrompt!, /programs on PATH: rg\./);
	} finally {
		if (oldPath === undefined) delete process.env.PATH; else process.env.PATH = oldPath;
		await rm(dir, { recursive: true, force: true });
	}
});

it("Windows branch retains PATHEXT file search without Unix execute permissions or directory false positives", async () => {
	const dir = await mkdtemp(join(tmpdir(), "rqw-prompt-pathext-"));
	const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
	const oldPath = process.env.PATH; const oldExt = process.env.PATHEXT;
	process.env.PATH = dir; process.env.PATHEXT = ".EXE;.CMD;.BAT;.TEST";
	try {
		await mkdir(join(dir, "git.exe"));
		await writeFile(join(dir, "npm.cmd"), "fixture"); await chmod(join(dir, "npm.cmd"), 0o644);
		await writeFile(join(dir, "node.test"), "fixture");
		Object.defineProperty(process, "platform", { ...platform, value: "win32" });
		const input = options(); hooks().prepare(input);
		assert.match(input.customPrompt!, /programs on PATH: node, npm\./);
		process.env.PATHEXT = ".EXE";
		const changed = options(); hooks().prepare(changed);
		assert.match(changed.customPrompt!, /programs on PATH: none found\./);
	} finally {
		Object.defineProperty(process, "platform", platform);
		if (oldPath === undefined) delete process.env.PATH; else process.env.PATH = oldPath;
		if (oldExt === undefined) delete process.env.PATHEXT; else process.env.PATHEXT = oldExt;
		await rm(dir, { recursive: true, force: true });
	}
});

it("Today explicitly means UTC, even across local day boundaries, and is fresh on every run", () => {
	const RealDate = Date; const oldTZ = process.env.TZ;
	let instant = "2026-10-21T22:30:00.000Z";
	globalThis.Date = class extends RealDate { constructor(value?: string | number) { super(value ?? instant); } } as DateConstructor;
	try {
		const hook = hooks();
		for (const [zone, time, localDay, utcDay] of [
			["Europe/Moscow", "2026-10-21T22:30:00.000Z", 22, "2026-10-21"],
			["America/Los_Angeles", "2026-10-22T01:30:00.000Z", 21, "2026-10-22"],
		]) {
			process.env.TZ = zone; instant = time;
			assert.equal(new Date().getDate(), localDay);
			const input = options(); hook.prepare(input);
			assert.ok(input.customPrompt!.includes(`Today (UTC): ${utcDay}.`));
			assert.doesNotMatch(input.customPrompt!, /Today:/);
		}
	} finally {
		globalThis.Date = RealDate;
		if (oldTZ === undefined) delete process.env.TZ; else process.env.TZ = oldTZ;
	}
});

it("bash metadata follows selectedTools minus hiddenTools while path facts stay", () => {
	for (const [selected, hidden, visible] of [
		[["bash"], [], true], [[], [], false], [["read"], [], false], [["read", "bash"], ["bash"], false],
	] as [string[], string[], boolean][]) {
		const input = options(); input.selectedTools = selected; input.hiddenTools = hidden;
		hooks().prepare(input);
		assert.equal(input.customPrompt!.includes("the bash tool runs bash"), visible);
		assert.match(input.customPrompt!, /paths: absolute like .*programs on PATH:/);
	}
});
