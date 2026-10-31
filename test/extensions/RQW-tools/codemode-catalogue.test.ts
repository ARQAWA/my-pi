import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createCodemodeExtension } from "@earendil-works/pi-coding-agent";
import { createTools } from "../../../extensions/RQW-tools/index.ts";
import { createJobs } from "../../../extensions/RQW-tools/jobs.ts";
import { FakeRipgrep, fileEvents, jsonLines } from "./rg-fake.ts";

test("codemode calls all new tools in parallel and rejects the old name", async (t) => {
	const cwd = await mkdtemp(join(tmpdir(), "rqw-code-"));
	t.after(() => rm(cwd, { recursive: true, force: true }));
	await writeFile(join(cwd, "a.txt"), "hello");
	await writeFile(join(cwd, "image.png"), Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"));
	const fake = new FakeRipgrep().install(t);
	fake.handler = (args) => args.includes("--files")
		? { stdout: "./a.txt\0" }
		: { stdout: jsonLines(fileEvents("./a.txt", [{ n: 1, text: "hello" }])) };
	let definition: any;
	createCodemodeExtension({ models: false })({ registerTool: (tool: any) => { definition = tool; }, getAllTools: () => [] } as any);
	const all: any[] = createTools(cwd, () => ({}), { codemode: definition, enabled: () => false });
	const tools = all.filter((tool) => ["rqw_readfile", "rqw_rg", "rqw_glob"].includes(tool.name));
	const code = all.find((tool) => tool.name === "codemode");
	const ctx: any = {
		cwd, tools, sessionManager: { getBranch: () => [] },
		async executeTool(name: string, args: any, options: any) {
			const tool = tools.find((item) => item.name === name);
			const result = await tool.execute(`script/${name}`, args, options.signal, undefined, { cwd });
			return { toolCall: { id: `script/${name}` }, result, isError: false };
		},
	};
	const result: any = await code.execute("script", { code: `
const [file, rg, glob] = await Promise.all([
  tools.rqw_readfile({ path: "a.txt" }),
  tools.rqw_rg({ pattern: "HELLO", "-i": true }),
  tools.rqw_glob({ glob_pattern: "*.txt" })
]);
text("RESULTS:" + JSON.stringify({ file, rg, glob }));
image(await tools.rqw_readfile({ path: "image.png" }));
try { await tools.read({ path: "a.txt" }); } catch { text("old name unavailable"); }
` }, undefined, undefined, ctx);
	assert.equal(result.isError, undefined);
	const output = result.content.map((block: any) => block.text ?? "").join("\n");
	const encodedResults = output.match(/RESULTS:(\{[^\n]+\})/);
	assert.ok(encodedResults);
	const results = JSON.parse(encodedResults[1]);
	assert.equal(results.file, "hello");
	assert.equal(results.rg, "a.txt:1: hello");
	assert.equal(results.glob, "a.txt");
	assert.match(output, /old name unavailable/);
	const image = result.content.find((block: any) => block.type === "image");
	assert.equal(image?.mimeType, "image/png");
	const saved = output.match(/\[Image saved to (.+?) \(image\/png,/);
	if (saved) await rm(saved[1], { force: true });
	assert.ok(fake.calls.some((args) => args.includes("--ignore-case")));
});

test("codemode tools.bash rejects a refused command", async () => {
	let definition: any;
	createCodemodeExtension({ models: false })({ registerTool: (tool: any) => { definition = tool; }, getAllTools: () => [] } as any);
	const all: any[] = createTools(process.cwd(), () => ({ shellPath: "/nonexistent/rqw-guard-shell" }), { codemode: definition, enabled: () => false });
	const bash = all.find(tool => tool.name === "bash");
	const code = all.find(tool => tool.name === "codemode");
	const ctx: any = {
		cwd: process.cwd(), tools: [bash], sessionManager: { getBranch: () => [] },
		async executeTool(_name: string, args: any, options: any) {
			try {
				const result = await bash.execute("script/bash", args, options.signal, undefined, undefined);
				return { toolCall: { id: "script/bash" }, result, isError: false };
			} catch (error) {
				return { toolCall: { id: "script/bash" }, result: { content: [{ type: "text", text: String(error) }] }, isError: true };
			}
		},
	};
	const result: any = await code.execute("script", { code: `
try { await tools.bash({ command: "git grep foo" }); text("unexpected success"); }
catch (error) { text(String(error)); }
` }, undefined, undefined, ctx);
	const output = result.content.map((block: any) => block.text ?? "").join("\n");
	assert.match(output, /Blocked: bash does not search, list or read files.*Use rqw_rg to search file contents/);
	assert.doesNotMatch(output, /unexpected success|Custom shell path not found/);
});

test("a slow new search becomes a cancellable background job", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"], now: 0 });
	const cwd = await mkdtemp(join(tmpdir(), "rqw-job-"));
	t.after(() => rm(cwd, { recursive: true, force: true }));
	const fake = new FakeRipgrep().install(t);
	let started!: () => void;
	const running = new Promise<void>((resolve) => { started = resolve; });
	fake.handler = () => { started(); return { hang: true }; };
	const jobs = createJobs({ backgroundAfterMs: 12 });
	const rg: any = createTools(cwd, () => ({}), { jobs }).find((tool) => tool.name === "rqw_rg");
	const pending = rg.execute("call", { pattern: "hello" }, undefined, undefined, { cwd });
	await running;
	t.mock.timers.tick(12);
	const handoff = await pending;
	assert.match(handoff.content[0].text, /job#1/);
	await jobs.kill("job#1");
	assert.equal(fake.killed, 1);
	jobs.dispose();
});
