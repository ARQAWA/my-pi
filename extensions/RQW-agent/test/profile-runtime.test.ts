// Real Pi sessions and faux providers. Profiles are temporary TOML files offered on the public bus.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { fauxProvider, fauxToolCall, getCurrentTools, getSystemMessageText, type SimpleStreamOptions, type TranscriptContext } from "@earendil-works/pi-ai";
import { createAgentSession, DefaultResourceLoader, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { SUBAGENT_REMINDER } from "../prompt.ts";
import { answer, fixture, gate, texts, tick, until } from "./audit-fixture.ts";

type Fixture = Awaited<ReturnType<typeof fixture>>;
type Fields = Record<string, string | string[]>;
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const system = (context: TranscriptContext) => context.messages.filter(m => m.role === "system").map(getSystemMessageText).join("\n");
const tools = (context: TranscriptContext) => getCurrentTools(context.messages.filter(m => m.role === "system")).map(t => t.name).sort();
const start = (name = "runtime-profile", extra: Record<string, unknown> = {}) => ({ action: "start", task: "PROFILE_TASK", agent_type: name, fast_gpt: false, ...extra });
const execute = (f: Fixture, params: Record<string, unknown>) => f.session.getToolDefinition("agent")!.execute("profile", params, undefined, undefined, f.session.extensionRunner.createContext());
const saved = (f: Fixture, id = 1) => {
	const entry = f.session.sessionManager.getBranch().findLast(e => e.type === "custom" && e.customType === "rqw-agent-child" && (e.data as { id?: number }).id === id);
	assert.ok(entry && entry.type === "custom", "child configuration is persisted");
	return entry.data as { state: string; title?: string; config: { system: string; role?: string; model: { provider: string; id: string }; thinking: string; profile?: { name: string; path: string; sha256: string } } };
};
async function profile(f: Fixture, fields: Fields = {}, name = "runtime-profile") {
	const path = join(f.root, `${name}.toml`);
	const defaults = { name, description: "Runtime test profile", developer_instructions: "  EXACT_ROLE\r\n ", model: `${f.sub.provider.id}/s`, model_reasoning_effort: "high" };
	const write = async (overrides: Fields = {}) => {
		const text = Object.entries({ ...defaults, ...fields, ...overrides }).map(([key, value]) => `${key} = ${JSON.stringify(value)}`).join("\n") + "\n";
		await writeFile(path, text);
		return { name, path, sha256: hash(text) };
	};
	const ref = await write();
	// audit-fixture types this generic bus adapter for the optional-tools channel.
	const off = f.bus.on("rqw-agent:profiles", raw => (raw as unknown as { offer(paths: string[]): void }).offer([path]));
	return { path, ref, write, off };
}
/** A disk-backed parent and an offer factory that survives reload; reuse the audit fixture's faux runtime. */
async function durableFixture(): Promise<Fixture> {
	const base = await fixture();
	const agentDir = join(base.root, "home");
	const loader = new DefaultResourceLoader({ cwd: base.root, agentDir,
		additionalExtensionPaths: [join(import.meta.dirname, "../index.ts")],
		extensionFactories: [pi => {
			pi.events.on("rqw-agent:profiles", raw => (raw as { offer(paths: string[]): void }).offer([join(base.root, "runtime-profile.toml")]));
		}], noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
	await loader.reload();
	assert.deepEqual(loader.getExtensions().errors, []);
	const { session } = await createAgentSession({ cwd: base.root, agentDir, resourceLoader: loader,
		modelRuntime: base.runtime, model: base.main.getModel("m"), thinkingLevel: "low",
		sessionManager: SessionManager.create(base.root, join(base.root, "sessions")), settingsManager: SettingsManager.inMemory({}) });
	await session.bindExtensions({ mode: "tui", onError: e => base.errors.push(`${e.event}: ${e.error}`) });
	await session.prompt("PERSIST_PARENT");
	return { ...base, session,
		call: async params => (await session.getToolDefinition("agent")!.execute("profile", params, undefined, undefined, session.extensionRunner.createContext()))
			.content.map(c => c.type === "text" ? c.text : "").join(""),
		delivered: () => session.messages.flatMap(m => m.role === "custom" && m.customType === "agent" && typeof m.content === "string" ? [m.content] : []),
		cleanup: async () => { await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" }); session.dispose(); await tick(); await base.cleanup(); },
	};
}
async function canonicalProvider(f: Fixture) {
	const faux = fauxProvider({ provider: "openai-codex", api: "profile-runtime-codex-faux", models: [{ id: "gpt-6.1-sol", reasoning: true }] });
	const requests: { context: TranscriptContext; reasoning?: string }[] = [];
	faux.setResponses(Array.from({ length: 20 }, () => async (context: TranscriptContext, options?: SimpleStreamOptions) => {
		requests.push({ context: structuredClone(context), reasoning: options?.reasoning });
		return answer("CANONICAL_DONE");
	}));
	f.runtime.registerNativeProvider(faux.provider);
	await f.runtime.setRuntimeApiKey("openai-codex", "fake-profile-key");
	await f.runtime.getAvailable();
	return requests;
}

test("profile defaults model and effort, preserves exact role text, and keeps generic tools and recursive delegation", async () => {
	const f = await fixture();
	const p = await profile(f, { nickname_candidates: ["Profile One", "Profile Two"] });
	try {
		const root = f.session.systemPrompt.trimEnd();
		await f.call(start(undefined, { tools: ["read", "grep"] }));
		await until(() => f.delivered().length === 1, "profile result");
		assert.equal(system(f.requests.sub[0]), `${root}\n\n${SUBAGENT_REMINDER}\n\n<role>\n  EXACT_ROLE\r\n \n</role>`);
		assert.deepEqual(tools(f.requests.sub[0]), ["agent", "grep", "read"]);
		assert.equal(saved(f).config.thinking, "high");
		assert.deepEqual(saved(f).config.model, { provider: f.sub.provider.id, id: "s" });
		assert.deepEqual(saved(f).config.profile, p.ref);
		assert.equal(saved(f).title, undefined);
		const message = f.session.messages.find(m => m.role === "custom" && m.customType === "agent")!;
		assert.deepEqual(message.details.profile, p.ref);
		assert.equal(message.details.title, undefined);
		assert.equal(message.details.thinking, "high");
		assert.equal(message.content, "[agent#1] OK", "provenance does not alter result text");
		await f.call({ ...f.params("GENERIC"), tools: ["read", "grep"] });
		await until(() => f.delivered().length === 2, "generic result");
		assert.equal(system(f.requests.sub[1]), "EXACT");
		assert.deepEqual(tools(f.requests.sub[1]), tools(f.requests.sub[0]));
		assert.equal(saved(f, 2).config.profile, undefined);
		assert.equal(saved(f, 2).config.thinking, "low");
		assert.equal("explore" in f.session.getToolDefinition("agent")!.parameters.properties, false);
		assert.deepEqual(f.errors, []);
	} finally { p.off(); await f.cleanup(); }
});

test("explicit model and thinking override profile defaults and bypass unused invalid defaults", async () => {
	const f = await fixture();
	const p = await profile(f);
	try {
		await f.call(start(undefined, { model: `${f.main.provider.id}/m`, thinking: "low", title: "Explicit Title" }));
		await until(() => f.delivered().length === 1, "differing explicit overrides result");
		assert.deepEqual(saved(f).config.model, { provider: f.main.provider.id, id: "m" });
		assert.equal(saved(f).config.thinking, "low");
		assert.equal(saved(f).title, "Explicit Title");
		await p.write({ model: "missing-profile-model", model_reasoning_effort: "invalid-effort", nickname_candidates: ["Ignored Nickname"] });
		await f.call({ action: "restart", id: "agent#1", task: "RETAIN_EXPLICIT_OVERRIDES" });
		await until(() => f.delivered().length === 2, "explicit settings retained on restart");
		assert.deepEqual(saved(f).config.model, { provider: f.main.provider.id, id: "m" });
		assert.equal(saved(f).config.thinking, "low");
		assert.equal(saved(f).title, "Explicit Title");
		await f.call(start(undefined, { model: `${f.sub.provider.id}/s`, thinking: "medium" }));
		await until(() => f.delivered().length === 3, "invalid unused defaults bypassed on start");
		assert.deepEqual(saved(f, 2).config.model, { provider: f.sub.provider.id, id: "s" });
		assert.equal(saved(f, 2).config.thinking, "medium");
		await assert.rejects(f.call(start(undefined, { model: "s", thinking: "low" })), /Unknown model/, "explicit models use the ordinary provider/id API");
	} finally { p.off(); await f.cleanup(); }
});

test("all explicit prompt forms keep ordinary API semantics with a profile", async () => {
	const f = await fixture();
	const p = await profile(f);
	try {
		await writeFile(join(f.root, "role.txt"), " exact file role ");
		await writeFile(join(f.root, "system.txt"), "exact file system");
		let id = 0, completed = 0;
		for (const override of [{ role: "  EXPLICIT_ROLE  " }, { system: "EXPLICIT_SYSTEM" }, { role_file: "role.txt" }, { system_file: "system.txt" }, { role: "" }, { system: "" }]) {
			const params = { action: "start", task: "PROMPT_OVERRIDE", model: `${f.sub.provider.id}/s`, thinking: "low", tools: [], ...override };
			await f.call(params);
			completed++;
			await until(() => f.delivered().length === completed, "ordinary prompt override");
			const ordinary = saved(f, ++id).config.system;
			await f.call({ ...params, agent_type: "runtime-profile" });
			completed++;
			await until(() => f.delivered().length === completed, "profile prompt override");
			assert.equal(saved(f, ++id).config.system, ordinary);
			if (Object.values(override)[0] !== "") {
				await f.call({ action: "restart", id: `agent#${id}`, task: "RETAIN_PROMPT_OVERRIDE" });
				completed++;
				await until(() => f.delivered().length === completed, "retained explicit prompt");
				assert.equal(saved(f, id).config.system, ordinary);
			}
		}
		await assert.rejects(f.call(start(undefined, { role: "one", system: "two" })), /not both/);
		await assert.rejects(f.call(start(undefined, { role: "one", role_file: "role.txt" })), /not both/);
		await assert.rejects(f.call(start(undefined, { system: "one", system_file: "system.txt" })), /not both/);
	} finally { p.off(); await f.cleanup(); }
});

test("bare canonical Sol resolves only to openai-codex; missing canonical never falls back to another provider", async t => {
	const f = await fixture();
	const requests = await canonicalProvider(f);
	const p = await profile(f, { model: "gpt-6.1-sol" });
	try {
		await f.call(start(undefined, { model: "openai-codex/gpt-6.1-sol", thinking: "high" }));
		await until(() => f.delivered().length === 1, "canonical result");
		assert.equal(requests.length, 1);
		assert.equal(requests[0].reasoning, "high");
		assert.deepEqual(saved(f).config.model, { provider: "openai-codex", id: "gpt-6.1-sol" });
		const registry = f.session.extensionRunner.createContext().modelRegistry;
		const find = registry.find.bind(registry);
		t.mock.method(registry, "find", (provider, id) => provider === "openai-codex" && id === "gpt-6.1-sol" ? undefined : find(provider, id));
		const other = fauxProvider({ provider: "profile-other-sol", api: "profile-other-sol", models: [{ id: "gpt-6.1-sol", reasoning: true }] });
		f.runtime.registerNativeProvider(other.provider);
		await assert.rejects(f.call(start()), /Unknown model/);
		assert.equal(other.state.callCount, 0);
		assert.equal(requests.length, 1, "no hidden retry or fallback");
	} finally { p.off(); await f.cleanup(); }
});

test("every bare GPT id selects Codex despite duplicate providers and never falls back when Codex is missing", async t => {
	const f = await fixture();
	const id = "gpt-profile-next";
	const codex = fauxProvider({ provider: "openai-codex", api: "profile-next-codex", models: [{ id, reasoning: true }] });
	const other = fauxProvider({ provider: "profile-next-other", api: "profile-next-other", models: [{ id, reasoning: true }] });
	codex.setResponses([answer("CODEX_NEXT_DONE")]);
	other.setResponses([answer("EXPLICIT_OTHER_DONE")]);
	f.runtime.registerNativeProvider(codex.provider);
	f.runtime.registerNativeProvider(other.provider);
	const p = await profile(f, { model: id });
	try {
		await f.call(start());
		await until(() => f.delivered().length === 1, "bare GPT selects Codex");
		assert.deepEqual(saved(f).config.model, { provider: "openai-codex", id });
		assert.equal(codex.state.callCount, 1);
		assert.equal(other.state.callCount, 0);
		const registry = f.session.extensionRunner.createContext().modelRegistry;
		const find = registry.find.bind(registry);
		t.mock.method(registry, "find", (provider, modelId) => provider === "openai-codex" && modelId === id ? undefined : find(provider, modelId));
		await assert.rejects(f.call(start()), /Unknown model/);
		assert.equal(other.state.callCount, 0, "missing Codex cannot use another provider's GPT model");
		await p.write({ model: `profile-next-other/${id}` });
		await f.call(start());
		await until(() => f.delivered().length === 2, "explicit provider remains honored");
		assert.deepEqual(saved(f, 2).config.model, { provider: "profile-next-other", id });
		assert.equal(other.state.callCount, 1);
	} finally { p.off(); await f.cleanup(); }
});

test("other bare model ids require one exact registry match, never substring matching or an ambiguous provider", async () => {
	const f = await fixture();
	const p = await profile(f, { model: "s" });
	try {
		await f.call(start(undefined, { model: `${f.sub.provider.id}/s` }));
		await until(() => f.delivered().length === 1, "unique bare model result");
		assert.deepEqual(saved(f).config.model, { provider: f.sub.provider.id, id: "s" });
		const other = fauxProvider({ provider: "profile-duplicate", api: "profile-duplicate", models: [{ id: "s", reasoning: true }] });
		f.runtime.registerNativeProvider(other.provider);
		await assert.rejects(f.call(start()), /Ambiguous model/);
		await p.write({ model: "audit-sub" });
		await assert.rejects(f.call(start()), /Unknown model/);
		assert.equal(f.requests.sub.length, 1);
		assert.equal(other.state.callCount, 0);
	} finally { p.off(); await f.cleanup(); }
});

test("unknown or unsupported profile effort is rejected before construction instead of being lowered by Pi", async () => {
	const f = await fixture();
	const p = await profile(f);
	try {
		for (const effort of ["ultra", "persistent", "custom", "xhigh"]) {
			await p.write({ model_reasoning_effort: effort });
			await assert.rejects(f.call(start()), /Unsupported model_reasoning_effort/);
		}
		const plain = fauxProvider({ provider: "profile-no-reasoning", api: "profile-no-reasoning", models: [{ id: "plain", reasoning: false }] });
		f.runtime.registerNativeProvider(plain.provider);
		await p.write({ model: "profile-no-reasoning/plain", model_reasoning_effort: "high" });
		await assert.rejects(f.call(start()), /Unsupported model_reasoning_effort/);
		assert.equal(f.requests.sub.length, 0);
		assert.equal(plain.state.callCount, 0);
		assert.equal(f.session.sessionManager.getEntries().some(e => e.type === "custom" && e.customType === "agent"), false);
		await p.write({ model_reasoning_effort: "none" });
		await f.call(start(undefined, { thinking: "off" }));
		await until(() => f.delivered().length === 1, "none maps to off");
		assert.equal(saved(f).config.thinking, "off");
	} finally { p.off(); await f.cleanup(); }
});

test("empty and whitespace profile model or effort fail instead of falling back to caller defaults", async () => {
	const f = await fixture();
	const p = await profile(f);
	try {
		for (const value of ["", " \t"]) {
			await p.write({ model: value });
			await assert.rejects(f.call(start()), /Unknown model/);
			await p.write({ model_reasoning_effort: value });
			await assert.rejects(f.call(start()), /Unsupported model_reasoning_effort/);
		}
		assert.equal(f.requests.sub.length, 0);
		assert.equal(f.requests.main.length, 0);
		assert.equal(f.session.sessionManager.getEntries().some(e => e.type === "custom" && e.customType === "agent"), false);
	} finally { p.off(); await f.cleanup(); }
});

test("config_file profile without defaults retains explicit caller model, thinking, and role on restart", async () => {
	const f = await fixture();
	try {
		const directory = join(f.root, ".pi"), path = join(f.root, "caller-defaults.toml");
		await mkdir(directory);
		await writeFile(path, "# Profile intentionally has no instruction, model, or effort defaults.\n");
		await writeFile(join(directory, "config.toml"), '[agents.runtime-caller]\ndescription = "Caller defaults profile"\nconfig_file = "../caller-defaults.toml"\n');
		const expectedModel = { provider: f.sub.provider.id, id: "s" };
		assert.notEqual(f.session.model?.provider, expectedModel.provider, "root model differs from the explicit child model");
		await f.call(start("runtime-caller", { model: `${f.sub.provider.id}/s`, thinking: "high", role: "CALLER_ROLE", tools: [] }));
		await until(() => f.delivered().length === 1, "unpinned profile result");
		const originalPrompt = system(f.requests.sub[0]);
		assert.ok(originalPrompt.endsWith("<role>\nCALLER_ROLE\n</role>"));
		assert.deepEqual(saved(f).config.model, expectedModel);
		assert.equal(saved(f).config.thinking, "high");
		assert.equal(saved(f).config.role, "CALLER_ROLE");
		await f.call({ action: "restart", id: "agent#1", task: "INHERIT_CALLER_DEFAULTS" });
		await until(() => f.delivered().length === 2, "unpinned profile restarted");
		assert.equal(f.requests.sub.length, 2, "restart still uses the explicit child provider");
		assert.equal(system(f.requests.sub[1]), originalPrompt);
		assert.deepEqual(saved(f).config.model, expectedModel);
		assert.equal(saved(f).config.thinking, "high");
		assert.equal(saved(f).config.role, "CALLER_ROLE");
		assert.deepEqual(texts(f.requests.sub[1]), ["INHERIT_CALLER_DEFAULTS"]);
		assert.deepEqual(f.errors, []);
	} finally { await f.cleanup(); }
});

test("profile with no configured or runtime auth fails before allocating a child", async t => {
	const f = await fixture();
	const p = await profile(f);
	try {
		const registry = f.session.extensionRunner.createContext().modelRegistry;
		t.mock.method(registry, "hasConfiguredAuth", () => false);
		t.mock.method(f.runtime, "checkAuth", async () => false);
		await assert.rejects(f.call(start()), /No credentials/);
		assert.equal(f.requests.sub.length, 0);
		assert.equal(f.session.sessionManager.getEntries().some(e => e.type === "custom" && e.customType === "agent"), false);
	} finally { p.off(); await f.cleanup(); }
});

test("catalogue refreshes at session startup and before prompts, shows source and defaults but never role text", async () => {
	const f = await fixture();
	const p = await profile(f, { model: "s", developer_instructions: "PRIVATE_PROFILE_ROLE_MARKER" });
	const check = (description: string, label: string) => {
		assert.ok(description.includes(`runtime-profile: ${label}`));
		assert.ok(description.includes("model=s"));
		assert.ok(description.includes("high"));
		assert.ok(description.includes(p.path));
		assert.equal(description.includes("PRIVATE_PROFILE_ROLE_MARKER"), false);
	};
	try {
		await f.session.extensionRunner.emit({ type: "session_start" });
		check(f.session.getToolDefinition("agent")!.description, "Runtime test profile");
		await p.write({ description: "Changed catalogue label" });
		await f.session.prompt("SEE_CATALOGUE");
		const definition = getCurrentTools(f.requests.main[0].messages.filter(m => m.role === "system")).find(t => t.name === "agent")!;
		check(definition.description, "Changed catalogue label");
		assert.equal(f.requests.sub.length, 0, "discovery itself creates no child");
		assert.deepEqual(f.errors, []);
	} finally { p.off(); await f.cleanup(); }
});

test("project profiles load for ordinary and nested agents without a trust gate or bus offers", async () => {
	const f = await fixture();
	const name = `runtime-project-${hash(f.root).slice(0, 12)}`;
	const path = join(f.root, ".pi", "agents", `${name}.toml`);
	try {
		await mkdir(join(f.root, ".git"));
		await mkdir(join(f.root, ".pi", "agents"), { recursive: true });
		await writeFile(path, Object.entries({ name, description: "Trusted project runtime profile", developer_instructions: "TRUSTED_PROJECT_ROLE", model: `${f.sub.provider.id}/s`, model_reasoning_effort: "high" })
			.map(([key, value]) => `${key} = ${JSON.stringify(value)}`).join("\n") + "\n");
		f.session.settingsManager.setProjectTrusted(false);
		f.subReplies.push(answer([fauxToolCall("agent", start(name, { task: "PROJECT_GRANDCHILD", tools: [] }))], { stopReason: "toolUse" }));
		assert.equal(await f.call(start(name, { tools: [] })), "agent#1 started");
		await until(() => f.delivered().length === 1, "project and nested profile complete");
		const nested = f.requests.sub.find(r => texts(r)[0] === "PROJECT_GRANDCHILD");
		assert.ok(nested, "nested caller discovers project profile without a trust gate");
		assert.ok(system(nested).endsWith("<role>\nTRUSTED_PROJECT_ROLE\n</role>"));
		assert.deepEqual(tools(nested), ["agent"]);
		assert.deepEqual(saved(f).config.profile?.name, name);
		assert.equal(saved(f).config.profile?.path, path);
		assert.deepEqual(f.errors, []);
	} finally { await f.cleanup(); }
});

test("disabling an extension profile provider rejects restart without aborting its old run or breaking generic agents", async () => {
	const f = await fixture(), held = gate("DISABLED_PROFILE_SURVIVES");
	const name = `runtime-extension-${hash(f.root).slice(0, 12)}`;
	const p = await profile(f, {}, name);
	f.subReplies.push(held.reply);
	try {
		assert.equal(await f.call(start(name, { tools: [] })), "agent#1 started");
		await until(held.entered, "offered profile running");
		p.off();
		await assert.rejects(f.call({ action: "restart", id: "agent#1", task: "UNAVAILABLE_REPLACEMENT" }), /Unknown agent_type/);
		assert.equal(held.aborted(), false, "missing optional provider cannot close an accepted child");
		assert.deepEqual(JSON.parse(await f.call({ action: "status", ids: ["agent#1"] })).statuses[0].profile, p.ref);
		assert.equal(await f.start("GENERIC_WITHOUT_PROFILE_PROVIDER"), "agent#2 started");
		await until(() => f.delivered().includes("[agent#2] OK"), "generic child still completes");
		assert.equal(held.aborted(), false);
		assert.equal(f.requests.sub.length, 2, "failed profile restart creates no inference");
		held.release();
		await until(() => f.delivered().includes("[agent#1] DISABLED_PROFILE_SURVIVES"), "old profile still delivers");
		assert.equal(f.delivered().length, 2);
		assert.deepEqual(f.errors, []);
	} finally { held.release(); p.off(); await f.cleanup(); }
});

test("nested profile discovery shares the root bus and uses root prompt, not its parent's role or review injection", async () => {
	const f = await fixture();
	const parent = await profile(f, { developer_instructions: "PARENT_ROLE_ONLY" }, "runtime-parent");
	const child = await profile(f, { developer_instructions: "CHILD_ROLE_ONLY" }, "runtime-child");
	let reviewOffers = 0;
	const off = f.bus.on("rqw-review:subagent-review", () => { reviewOffers++; });
	try {
		const root = f.session.systemPrompt.trimEnd();
		f.subReplies.push(answer([fauxToolCall("agent", start("runtime-child", { task: "GRANDCHILD", tools: [] }))], { stopReason: "toolUse" }), answer("INTERMEDIATE"), answer("NESTED_DONE"), answer("PARENT_DONE"));
		await f.call(start("runtime-parent", { tools: [] }));
		await until(() => f.delivered().length === 1, "nested profile final");
		const grandchild = f.requests.sub.find(r => texts(r)[0] === "GRANDCHILD")!;
		assert.ok(grandchild, "nested agent resolved profile offered only on root bus");
		assert.equal(system(grandchild), `${root}\n\n${SUBAGENT_REMINDER}\n\n<role>\nCHILD_ROLE_ONLY\n</role>`);
		assert.equal(system(grandchild).includes("PARENT_ROLE_ONLY"), false);
		assert.deepEqual(tools(grandchild), ["agent"]);
		assert.deepEqual(tools(f.requests.sub[0]), ["agent"]);
		assert.equal(reviewOffers, 0, "profiles do not request a dedicated review tool");
		const nestedTool = getCurrentTools(f.requests.sub[0].messages.filter(m => m.role === "system")).find(t => t.name === "agent")!;
		assert.ok(nestedTool.description.includes("runtime-child"));
		assert.equal(nestedTool.description.includes("CHILD_ROLE_ONLY"), false);
		assert.deepEqual(f.errors, []);
	} finally { off(); parent.off(); child.off(); await f.cleanup(); }
});

test("unknown profile keys are silent and add no diagnostic fields to results or status", async () => {
	const f = await fixture();
	const p = await profile(f, { sandbox_mode: "UNAPPLIED_VALUE", unknown_key: "UNAPPLIED_VALUE" });
	try {
		const result = await execute(f, start(undefined, { tools: [] }));
		assert.deepEqual(result.content, [{ type: "text", text: "agent#1 started" }]);
		assert.deepEqual(result.details, {});
		await until(() => f.delivered().length === 1, "profile result");
		const status = JSON.parse(await f.call({ action: "status", ids: ["agent#1"] }));
		assert.equal("profile_diagnostics" in status, false);
		assert.equal(status.statuses[0].id, "agent#1");
		assert.equal(JSON.stringify(status).includes("UNAPPLIED_VALUE"), false);
		assert.deepEqual(f.errors, []);
	} finally { p.off(); await f.cleanup(); }
});

test("status and blocking wait retain profile provenance but do not use nickname metadata as title", async () => {
	const f = await fixture(), held = gate("PROFILE_WAIT_RESULT");
	const p = await profile(f, { nickname_candidates: ["Wait Profile"] });
	f.subReplies.push(held.reply);
	try {
		await f.call(start());
		await until(held.entered, "profile waiting");
		const status = JSON.parse(await f.call({ action: "status", ids: ["agent#1"] })).statuses[0];
		assert.deepEqual(status.profile, p.ref);
		assert.equal(status.title, undefined);
		const waiting = execute(f, { action: "wait", blocking: true, ids: ["agent#1"], timeout_ms: 10000 });
		await tick();
		held.release();
		const result = await waiting;
		assert.deepEqual(result.details.results[0].display.profile, p.ref);
		assert.equal(result.details.results[0].display.title, undefined);
		assert.equal(result.details.results[0].text, "PROFILE_WAIT_RESULT");
		assert.deepEqual(f.delivered(), []);
	} finally { held.release(); p.off(); await f.cleanup(); }
});

test("resume uses saved profile config after invalid edits and reload, while restart revalidates without aborting the old run", async () => {
	const f = await durableFixture(), first = gate(), resumed = gate("RESUMED_OLD_PROFILE");
	const p = await profile(f, { nickname_candidates: ["Old Auto Name"] });
	f.subReplies.push(first.reply, resumed.reply);
	try {
		await f.call(start(undefined, { tools: [] }));
		await until(first.entered, "first profile request");
		const original = saved(f).config;
		await f.call({ action: "interrupt", id: "agent#1" });
		await until(first.aborted, "profile interrupted");
		await tick();
		await writeFile(p.path, "name = [invalid TOML");
		await f.session.reload();
		await f.call({ action: "resume", id: "agent#1" });
		await until(resumed.entered, "saved profile resumed");
		assert.equal(system(f.requests.sub[1]), original.system);
		assert.deepEqual(texts(f.requests.sub[1]), ["PROFILE_TASK"], "resume adds no synthetic task");
		assert.deepEqual(saved(f).config.profile, p.ref);
		assert.deepEqual(saved(f).config.model, original.model);
		assert.equal(saved(f).config.thinking, "high");
		await assert.rejects(f.call({ action: "restart", id: "agent#1", task: "REPLACEMENT" }), /Invalid agent_type/);
		assert.equal(resumed.aborted(), false, "invalid profile cannot close the existing run");
		assert.deepEqual(JSON.parse(await f.call({ action: "status", ids: ["agent#1"] })).statuses[0].profile, p.ref);
		resumed.release();
		await until(() => f.delivered().length === 1, "old profile result survives");
		const newRef = await p.write({ developer_instructions: "RELOADED_ROLE", model_reasoning_effort: "low", nickname_candidates: ["Fresh Auto Name"] });
		await f.call({ action: "restart", id: "agent#1", task: "RESTARTED" });
		await until(() => f.delivered().length === 2, "revalidated replacement result");
		assert.ok(system(f.requests.sub[2]).endsWith("<role>\nRELOADED_ROLE\n</role>"));
		assert.deepEqual(saved(f).config.profile, newRef);
		assert.equal(saved(f).config.thinking, "low");
		assert.equal(saved(f).title, undefined);
	} finally { first.release(); resumed.release(); p.off(); await f.cleanup(); }
});

test("changing profile on restart reloads model, effort and role defaults", async () => {
	const f = await fixture();
	const requests = await canonicalProvider(f);
	const first = await profile(f);
	const second = await profile(f, { model: "gpt-6.1-sol", model_reasoning_effort: "low", developer_instructions: "NEW_PROFILE", nickname_candidates: ["New Profile"] }, "runtime-replacement");
	try {
		await f.call(start());
		await until(() => f.delivered().length === 1, "first profile result");
		await f.call({ action: "restart", id: "agent#1", agent_type: "runtime-replacement", task: "NEW_TASK" });
		await until(() => f.delivered().length === 2, "changed profile result");
		assert.equal(requests.length, 1);
		assert.equal(requests[0].reasoning, "low");
		assert.ok(system(requests[0].context).endsWith("<role>\nNEW_PROFILE\n</role>"));
		assert.deepEqual(saved(f).config.model, { provider: "openai-codex", id: "gpt-6.1-sol" });
		assert.deepEqual(saved(f).config.profile, second.ref);
		assert.equal(saved(f).title, undefined);
	} finally { first.off(); second.off(); await f.cleanup(); }
});
