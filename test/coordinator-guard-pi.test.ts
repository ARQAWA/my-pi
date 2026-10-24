// Real in-process Pi session: the guard is discovered from `.pi/extensions` of a trusted cwd, and a codemode script's
// `tools.agent` call with a disallowed pair is blocked before the tool runs. A faux provider answers; no network.
import "./no-network.mjs";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { networkAttempts } from "./no-network.mjs";

const { fauxAssistantMessage, fauxProvider, fauxToolCall } = await import("@earendil-works/pi-ai");
const { createAgentSession, createCodemodeExtension, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } =
	await import("@earendil-works/pi-coding-agent");
const { Type } = await import("typebox");

describe("coordinator-guard Pi local development tooling", { skip: process.platform !== "darwin" && "Local development tooling is supported only on the owner's macOS laptop" }, () => {
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
// A fixture rules block with a far-future restriction, so the run does not depend on today's date.
const RULES = {
	workerModels: {
		simple: [["anthropic/claude-sonnet-5-5", "medium"], ["openai-codex/gpt-6.1-sol", "low"]],
		hardest: [["anthropic/claude-opus-5-5", "medium"], ["openai-codex/gpt-6.1-sol", "high"]],
	},
	fixedWorkers: "block",
	temporaryOpusRestriction: { until: "2999-01-01T00:00:00Z", arbiterTitlePrefix: "Арбитр замера" },
};
writeFileSync(join(cwd, "PROCESS.md"), `# Process\n\n\`\`\`json coordinator-rules\n${JSON.stringify(RULES, null, 2)}\n\`\`\`\n`);

const SCRIPT = `
const out = [];
for (const [model, thinking, title] of [["anthropic/claude-opus-5-5", "high"], ["anthropic/claude-opus-5-5", "medium"], ["anthropic/claude-opus-5-5", "medium", "Арбитр замера 1"], ["anthropic/claude-sonnet-5-5", "medium"]]) {
  try { out.push("ran: " + await tools.agent({ action: "start", model, thinking, title, task: "T-" + model.split("-")[1] + "-" + thinking + "-" + (title ? "arbiter" : "plain") })); }
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
		parameters: Type.Object({ action: Type.Optional(Type.String()), model: Type.Optional(Type.String()), thinking: Type.Optional(Type.String()), title: Type.Optional(Type.String()), task: Type.Optional(Type.String()) }),
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
		assert.match(text, /blocked: .*anthropic\/claude-opus-5-5 medium is not an allowed pair.*Temporary rule until 2999-01-01T00:00:00Z/);
		assert.match(text, /ran: T-opus-medium-arbiter\n\n\[coordinator-guard\] When you start or restart an ordinary `agent` subagent/);
		assert.match(text, /ran: T-sonnet-medium-plain\n\n\[coordinator-guard\]/);
		assert.match(text, /blocked: .*Main does not edit repo files/);
		assert.equal(received.length, 2, "the blocked calls never reached the tool");
		assert.match(received[0], /^T-opus-medium-arbiter\n\n\[coordinator-guard\]/);
		assert.match(received[1], /^T-sonnet-medium-plain\n\n\[coordinator-guard\]/);
		assert.match(flat, /<coordinator_rules>\\nGenerated by the coordinator-guard extension/);
		assert.match(flat, /hardest: openai-codex\/gpt-6\.1-sol high/);
		assert.match(flat, /Temporary rule until 2999-01-01T00:00:00Z: anthropic\/claude-opus-5-5 is not allowed/);
		assert.match(flat, /Only a start whose title begins with \\"Арбитр замера\\"/);
		assert.match(flat, /You operate in pi\./, "RQW-prompt's prefix is in place alongside the section");
		assert.doesNotMatch(flat, /You are an expert coding assistant operating inside pi/);
		assert.deepEqual(networkAttempts, []);
	} finally {
		await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
		session.dispose();
	}
});
});
