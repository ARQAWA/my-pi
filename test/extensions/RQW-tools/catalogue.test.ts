import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createEventBus } from "@earendil-works/pi-coding-agent";
import { createTools, installRqwTools } from "../../../extensions/RQW-tools/index.ts";

test("file catalogue exposes the new tools and keeps legacy renderers hidden", async (t) => {
	const cwd = await mkdtemp(join(tmpdir(), "rqw-catalogue-"));
	t.after(() => rm(cwd, { recursive: true, force: true }));
	await writeFile(join(cwd, "hello.txt"), "first\nsecond");
	const tools = Object.fromEntries(createTools(cwd, () => ({})).map((tool) => [tool.name, tool as any]));
	for (const name of ["read", "grep", "find"]) assert.equal(tools[name].exposure, "hidden");
	for (const name of ["rqw_readfile", "rqw_rg", "rqw_glob"]) assert.ok(tools[name]);
	const result = await tools.rqw_readfile.execute("test", { path: "hello.txt", offset: -1 }, undefined, undefined, { cwd });
	assert.equal(result.content[0].text, "second");
});

test("registered rqw_rg description ends with the search funnel", async () => {
	const events = createEventBus();
	const handlers = new Map<string, Function[]>();
	const tools: any[] = [];
	const pi: any = {
		events, registerTool: (tool: any) => tools.push(tool), getActiveTools: () => [], getSettings: () => ({}),
		on(name: string, handler: Function) { handlers.set(name, [...(handlers.get(name) ?? []), handler]); },
	};
	installRqwTools(pi);
	try {
		const funnel = readFileSync(new URL("./search-funnel.txt", import.meta.url), "utf8").replace(/\r\n/g, "\n").trimEnd();
		const description = tools.find((tool) => tool.name === "rqw_rg").description.replace(/\r\n/g, "\n");
		assert.ok(description.endsWith(`\n\n${funnel}`));
	} finally {
		for (const handler of handlers.get("session_shutdown") ?? []) await handler({ reason: "shutdown" }, { sessionManager: {} });
	}
});

test("subagent offer carries the new catalogue and legacy selector aliases", async () => {
	const events = createEventBus();
	const handlers = new Map<string, Function[]>();
	const pi: any = {
		events, registerTool() {}, getActiveTools: () => [], getSettings: () => ({}),
		on(name: string, handler: Function) { handlers.set(name, [...(handlers.get(name) ?? []), handler]); },
	};
	installRqwTools(pi);
	try {
		let received: any;
		events.emit("rqw-tools:subagent-tools", { offer: (factory: any, catalogue: any) => { received = { factory, catalogue }; } });
		assert.deepEqual(received.catalogue, {
			names: ["rqw_readfile", "bash", "edit", "write", "rqw_rg", "rqw_glob"],
			aliases: { read: "rqw_readfile", grep: "rqw_rg", find: "rqw_glob" },
		});
		assert.ok(received.factory(process.cwd(), () => ({})).some((tool: any) => tool.name === "rqw_rg"));
	} finally {
		for (const handler of handlers.get("session_shutdown") ?? []) await handler({ reason: "shutdown" }, { sessionManager: {} });
	}
});
