// Real in-process Pi session: the guard is discovered from `.pi/extensions` of a trusted cwd, and a codemode script's
// `tools.agent` call with a disallowed pair is blocked before the tool runs. A faux provider answers; no network.
import "./no-network.mjs";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, it } from "node:test";
import { networkAttempts } from "./no-network.mjs";

const { fauxAssistantMessage, fauxProvider, fauxToolCall } = await import("@earendil-works/pi-ai");
const { createAgentSession, createCodemodeExtension, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } =
	await import("@earendil-works/pi-coding-agent");
const { Type } = await import("typebox");

const ROOT = join(import.meta.dirname, "..");
// A copy of the checkout parts the guard needs, so its root (three levels above its file) is this fixture.
const TMP = realpathSync(mkdtempSync(join(tmpdir(), "coordinator-guard-pi-")));
after(() => rmSync(TMP, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
const cwd = join(TMP, "repo");
const agentDir = join(TMP, "agent");
mkdirSync(agentDir, { recursive: true });
// Use simple file reads and writes for this small fixture. With fs.cpSync here, the Windows Node 22
// Cyrillic-path run died natively in this file before any output; the cause is unproven.
const copy = (from: string, to: string) => {
	mkdirSync(join(to, ".."), { recursive: true });
	writeFileSync(to, readFileSync(from));
};
const GUARD = join(ROOT, ".pi", "extensions", "coordinator-guard");
for (const name of readdirSync(GUARD)) copy(join(GUARD, name), join(cwd, ".pi", "extensions", "coordinator-guard", name));
copy(join(ROOT, "scripts", "owner-quotes.mjs"), join(cwd, "scripts", "owner-quotes.mjs"));
copy(join(ROOT, "PROCESS.md"), join(cwd, "PROCESS.md"));

const SCRIPT = `
const out = [];
for (const [model, thinking] of [["anthropic/claude-opus-5-5", "high"], ["anthropic/claude-opus-5-5", "medium"]]) {
  try { out.push("ran: " + await tools.agent({ action: "start", model, thinking, task: "T-" + thinking })); }
  catch (e) { out.push("blocked: " + e.message); }
}
try { await tools.write({ path: "x.md", content: "x" }); out.push("wrote"); } catch (e) { out.push("blocked: " + e.message); }
return out.join("\\n");`;

it("a codemode tools.agent call with a disallowed pair is blocked; an allowed one runs with the child line", async () => {
	const faux = fauxProvider({ api: "faux-guard", provider: "openai-codex", models: [{ id: "gpt-6.1-sol", contextWindow: 200_000, maxTokens: 1000 }] });
	// The first request records what the model was actually sent, system sections included.
	let sent = "";
	faux.setResponses([
		(context) => {
			sent = JSON.stringify(context);
			return fauxAssistantMessage([fauxToolCall("codemode", { code: SCRIPT }, { id: "k1" })], { stopReason: "toolUse" });
		},
		fauxAssistantMessage("done"),
	]);
	const modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: null, refreshOnCreate: false });
	faux.provider.auth.apiKey = { name: "Fake guard key", resolve: async () => ({ auth: { apiKey: "fake-guard-key" } }) };
	modelRuntime.registerNativeProvider(faux.provider);
	await modelRuntime.setRuntimeApiKey("openai-codex", "fake-guard-key");

	const received: string[] = [];
	const fakeAgent = (pi: any) => pi.registerTool({
		name: "agent", label: "agent", description: "fake agent",
		parameters: Type.Object({ action: Type.Optional(Type.String()), model: Type.Optional(Type.String()), thinking: Type.Optional(Type.String()), task: Type.Optional(Type.String()) }),
		execute: async (_id: string, params: { task?: string }) => {
			received.push(params.task ?? "");
			return { content: [{ type: "text", text: params.task ?? "" }], details: undefined };
		},
	});
	const resourceLoader = new DefaultResourceLoader({
		cwd, agentDir,
		// RQW-prompt too: the guard's section must survive its customPrompt.
		additionalExtensionPaths: [join(ROOT, "extensions", "RQW-prompt", "index.ts")],
		extensionFactories: [{ name: "codemode", factory: createCodemodeExtension(), replaceable: true, builtin: true as const }, fakeAgent],
		noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
	});
	await resourceLoader.reload({ resolveProjectTrust: async () => true });
	const loaded = resourceLoader.getExtensions();
	assert.deepEqual(loaded.errors, []);
	assert.ok(loaded.extensions.some((e) => e.path === join(cwd, ".pi", "extensions", "coordinator-guard", "index.ts")), "discovered from the trusted cwd");

	const { session } = await createAgentSession({
		cwd, agentDir, model: faux.getModel("gpt-6.1-sol"), thinkingLevel: "off", tools: ["+codemode"], modelRuntime, resourceLoader,
		sessionManager: SessionManager.inMemory(cwd), settingsManager: SettingsManager.inMemory({ retry: { enabled: false } }),
	});
	const errors: string[] = [];
	try {
		await session.bindExtensions({ mode: "rpc", onError: (e) => errors.push(`${e.event}: ${e.error}`) });
		await session.prompt("go");
		assert.deepEqual(errors, []);
		const result = session.messages.find((m: any) => m.role === "toolResult" && m.toolName === "codemode") as any;
		const text = result.content.map((c: any) => c.text ?? "").join("");
		const log = join(tmpdir(), "coordinator-guard-pi.log");
		const flat = sent;
		writeFileSync(log, `${text}\n\n--- first request ---\n${flat}\n`);
		assert.match(text, /blocked: .*anthropic\/claude-opus-5-5 high is not an allowed pair/);
		assert.match(text, /ran: T-medium\n\n\[coordinator-guard\] When you start or restart an ordinary `agent` subagent/);
		assert.match(text, /blocked: .*Main does not edit repo files/);
		assert.equal(received.length, 1, "the blocked call never reached the tool");
		assert.match(received[0], /^T-medium\n\n\[coordinator-guard\]/);
		assert.match(flat, /<coordinator_rules>\\nGenerated by the coordinator-guard extension/);
		assert.match(flat, /hardest: anthropic\/claude-opus-5-5 medium, openai-codex\/gpt-6\.1-sol high/);
		assert.match(flat, /You operate in pi\./, "RQW-prompt's prefix is in place alongside the section");
		assert.doesNotMatch(flat, /You are an expert coding assistant operating inside pi/);
		assert.deepEqual(networkAttempts, []);
	} finally {
		await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
		session.dispose();
	}
});
