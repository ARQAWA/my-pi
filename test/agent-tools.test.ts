// Package integration: the optional event-bus offer must follow the RQW-tools package filter, including on reload.
// Neither extension's own tests load the other; this package test is mandatory, even when a folder is missing.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { it } from "node:test";
import { setImmediate } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import {
	createAgentSession,
	createWriteToolDefinition,
	DefaultResourceLoader,
	ModelRuntime,
	SessionManager,
	SettingsManager,
	type ToolDefinition,
} from "@earendil-works/pi-coding-agent";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

it("package: agent gets fresh RQW-tools, then stock tools after RQW-tools is filtered out and reloaded", async () => {
	const dir = await mkdtemp(join(tmpdir(), "rqw-agent-tools-"));
	const agentDir = join(dir, "agent");
	await mkdir(agentDir);
	const settingsFile = join(agentDir, "settings.json");
	const select = async (tools: boolean) => writeFile(settingsFile, JSON.stringify({ packages: [{
		source: ROOT,
		extensions: ["extensions/RQW-agent/index.ts", ...(tools ? ["extensions/RQW-tools/index.ts"] : [])],
	}] }));
	await select(true);
	const main = fauxProvider({ api: "faux-package-main", provider: "package-main", models: [{ id: "m" }] });
	const sub = fauxProvider({ api: "faux-package-sub", provider: "package-sub", models: [{ id: "s" }] });
	let declared: { description: string; parameters: string[] } | undefined;
	sub.setResponses([
		(context) => {
			for (const m of context.messages) {
				if (m.role !== "system") continue;
				for (const t of m.toolsAdded ?? []) if (t.name === "write") declared = {
					description: t.description,
					parameters: Object.keys((t.parameters as { properties: object }).properties).sort(),
				};
			}
			return fauxAssistantMessage([fauxToolCall("write", { files: [
				{ path: "a.txt", content: "A" }, { path: "b.txt", content: "B" },
			] })], { stopReason: "toolUse" });
		},
		fauxAssistantMessage("written"),
	]);
	main.setResponses(Array.from({ length: 10 }, () => fauxAssistantMessage("main ok")));
	const modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: null, refreshOnCreate: false });
	modelRuntime.registerNativeProvider(main.provider);
	modelRuntime.registerNativeProvider(sub.provider);
	const resourceLoader = new DefaultResourceLoader({
		cwd: dir, agentDir, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
	});
	await resourceLoader.reload();
	assert.deepEqual(resourceLoader.getExtensions().errors, []);
	const { session } = await createAgentSession({
		cwd: dir, agentDir, model: main.getModel("m"), modelRuntime, resourceLoader,
		sessionManager: SessionManager.inMemory(dir),
		settingsManager: SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } }),
	});
	const errors: string[] = [];
	let held: Promise<unknown> | undefined;
	const delivered = () => session.messages.flatMap((m) =>
		m.role === "custom" && m.customType === "agent" && typeof m.content === "string" ? [m.content] : [],
	);
	const start = async () => {
		const tool = session.getToolDefinition("agent") as ToolDefinition;
		assert.ok(tool, "agent is loaded");
		await tool.execute("t", { action: "start", system: "Answer in one word.", task: "write", model: "package-sub/s" } as never,
			undefined, undefined, session.extensionRunner.createContext());
	};
	const until = async (check: () => boolean, ms = 3000) => {
		const end = Date.now() + ms;
		while (!check()) {
			assert.ok(Date.now() < end, "timed out waiting for delivery");
			await setImmediate();
		}
	};
	try {
		await session.bindExtensions({ mode: "tui", onError: (e) => errors.push(`${e.event}: ${e.error}`) });
		assert.equal(resourceLoader.getExtensions().extensions.length, 2);
		const bash = session.getToolDefinition("bash") as ToolDefinition;
		let bashDone = false;
		// Exercise the real shell and barrier together; fake JS time cannot hold a platform process.
		held = bash.execute("b", { command: "sleep 2" } as never, undefined, undefined,
			session.extensionRunner.createContext()).finally(() => { bashDone = true; });
		await start();
		await until(() => delivered().length === 1, 1500);
		assert.equal(bashDone, false, "the subagent does not wait for the main barrier");
		assert.equal(delivered()[0], "[agent#1] written");
		assert.equal(await readFile(join(dir, "a.txt"), "utf8"), "A");
		assert.equal(await readFile(join(dir, "b.txt"), "utf8"), "B");
		assert.deepEqual(declared?.parameters, ["content", "files", "path"]);
		await held;
		await until(() => session.isIdle);

		await select(false);
		await session.reload();
		assert.deepEqual(resourceLoader.getExtensions().errors, []);
		assert.equal(resourceLoader.getExtensions().extensions.length, 1);
		declared = undefined;
		sub.setResponses([
			(context) => {
				for (const m of context.messages) {
					if (m.role !== "system") continue;
					for (const t of m.toolsAdded ?? []) if (t.name === "write") declared = {
						description: t.description,
						parameters: Object.keys((t.parameters as { properties: object }).properties).sort(),
					};
				}
				return fauxAssistantMessage([fauxToolCall("write", { path: "stock.txt", content: "stock" })], { stopReason: "toolUse" });
			},
			fauxAssistantMessage("stock written"),
		]);
		await start();
		await until(() => delivered().length === 2);
		assert.equal(delivered()[1], "[agent#2] stock written");
		assert.equal(await readFile(join(dir, "stock.txt"), "utf8"), "stock");
		const stock = createWriteToolDefinition(dir);
		assert.deepEqual(declared, { description: stock.description, parameters: Object.keys(stock.parameters.properties).sort() });
		assert.deepEqual(errors, []);
	} finally {
		await held;
		await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
		session.dispose();
		await rm(dir, { recursive: true, force: true });
	}
});
