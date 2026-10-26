// Real in-process Pi session: the guard is discovered from `.pi/extensions` of a trusted cwd, and a codemode script's
// `tools.agent` call with a disallowed pair is blocked before the tool runs. A faux provider answers; no network.
import "./no-network.mjs";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { networkAttempts } from "./no-network.mjs";
import { parseRules } from "../.pi/extensions/coordinator-guard/rules.ts";

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
// Use the active data policy, with no date-dependent override.
const RULES = parseRules(readFileSync(join(ROOT, "PROCESS.md"), "utf8"));
writeFileSync(join(cwd, "PROCESS.md"), `# Process\n\n\`\`\`json coordinator-rules\n${JSON.stringify(RULES, null, 2)}\n\`\`\`\n`);

const SCRIPT = `
const out = [];
for (const [model, thinking, title] of [["anthropic/claude-opus-5-5", "high"], ["anthropic/claude-opus-5-5", "medium"], ["anthropic/claude-opus-5-5", "medium", "Арбитр замера 1"], ["anthropic/claude-sonnet-5-5", "medium"], ...["off", "minimal", "low", "medium", "high", "xhigh", "max"].map(level => ["anthropic/claude-haiku-5-5", level]), ["openai-codex/gpt-6.1-sol", "low"], ["openai-codex/gpt-6.1-sol", "medium"], ["openai-codex/gpt-6.1-sol", "high"], ["kimi-coding/k3.1-pro", "medium"], ["kimi-coding/k3.1-pro", "max"], ...${JSON.stringify(Object.values(RULES.agentModels).flat())}]) {
  try { out.push("ran: " + await tools.agent({ action: "start", model, thinking, title, task: "T-" + model.split("-")[1] + "-" + thinking + "-" + (title ? "arbiter" : "plain") })); }
  catch (e) { out.push("blocked: " + e.message); }
}
for (const [agent_type, [model, thinking]] of Object.entries(${JSON.stringify(RULES.reviewerProfiles)})) {
  out.push("reviewer: " + await tools.agent({ action: "start", agent_type, model, thinking, task: "review-" + agent_type }));
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
		parameters: Type.Object({ action: Type.Optional(Type.String()), agent_type: Type.Optional(Type.String()), model: Type.Optional(Type.String()), thinking: Type.Optional(Type.String()), title: Type.Optional(Type.String()), task: Type.Optional(Type.String()) }),
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
		assert.match(text, /blocked: .*anthropic\/claude-opus-5-5 medium is not an allowed pair/);
		assert.doesNotMatch(text, /Temporary rule/);
		assert.match(text, /blocked: .*anthropic\/claude-opus-5-5 medium is not an allowed pair/);
		assert.match(text, /blocked: .*anthropic\/claude-sonnet-5-5 medium is not an allowed pair/);
		assert.match(text, /blocked: .*Main does not edit repo files/);
		assert.equal(received.length, Object.values(RULES.agentModels).flat().length + Object.keys(RULES.reviewerProfiles).length, "only allowed executor and reviewer calls reached the tool");
		assert.match(received[0], /^T-coding\/k3\.1-low-plain\n\n\[coordinator-guard\]/);
		for (const agentType of Object.keys(RULES.reviewerProfiles)) {
			assert.ok(received.some((task) => task.startsWith(`review-${agentType}\n\n[coordinator-guard]`)), `reviewer ${agentType} reached the tool`);
		}
		assert.match(text, /blocked: .*openai-codex\/gpt-6\.1-sol low is not an allowed pair/);
		assert.match(text, /blocked: .*openai-codex\/gpt-6\.1-sol medium is not an allowed pair/);
		assert.match(text, /blocked: .*openai-codex\/gpt-6\.1-sol high is not an allowed pair/);
		assert.match(text, /blocked: .*kimi-coding\/k3\.1-pro medium is not an allowed pair/);
		assert.match(text, /blocked: .*kimi-coding\/k3\.1-pro max is not an allowed pair/);
		for (const level of ["off", "low", "medium", "high", "xhigh", "max"]) {
			assert.match(text, new RegExp(`blocked: .*anthropic/claude-haiku-5-5 ${level} is not an allowed pair`));
		}
		assert.match(text, /blocked: .*anthropic\/claude-haiku-5-5 minimal is not an allowed pair/);
		assert.match(flat, /<coordinator_rules>\\nGenerated by the coordinator-guard extension/);
		assert.match(flat, /hardest: kimi-coding\/k3\.1-pro high/);
		assert.doesNotMatch(flat, /hardest: kimi-coding\/k3\.1-pro high, openai-codex\/gpt-6\.1-sol/);
		assert.match(flat, /spotty: openai-codex\/gpt-6\.1-sol low; bossy: openai-codex\/gpt-6\.1-sol medium/);
		assert.doesNotMatch(flat, /haiku:|claude-haiku/);
		assert.doesNotMatch(flat, /Temporary rule|claude-sonnet|claude-opus/);
		assert.match(flat, /You operate in pi\./, "RQW-prompt's prefix is in place alongside the section");
		assert.doesNotMatch(flat, /You are an expert coding assistant operating inside pi/);
		assert.deepEqual(networkAttempts, []);
	} finally {
		await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
		session.dispose();
	}
});
});
