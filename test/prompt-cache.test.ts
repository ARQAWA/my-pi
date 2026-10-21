// Package integration: each child extension owns its TTL; the adapter only supplies the main OAuth fallback.
import "./no-network.mjs";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setImmediate } from "node:timers/promises";
import { it } from "node:test";
import { fileURLToPath } from "node:url";
import * as library from "@earendil-works/pi-coding-agent";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const { AuthStorage } = await import(new URL("./core/auth-storage.js", import.meta.resolve("@earendil-works/pi-coding-agent")).href);
const bundle: typeof library = await import(new URL("./bundle/index.js", import.meta.resolve("@earendil-works/pi-coding-agent")).href);

function markers(value: unknown): Record<string, unknown>[] {
	if (!value || typeof value !== "object") return [];
	if (Array.isArray(value)) return value.flatMap(markers);
	return Object.entries(value).flatMap(([key, item]) => key === "cache_control" ? [item as Record<string, unknown>] : markers(item));
}

async function until(check: () => boolean) {
	const deadline = Date.now() + 5000;
	while (!check()) { assert.ok(Date.now() < deadline, "timed out waiting for a child result"); await setImmediate(); }
}

for (const [label, sdk] of [["library", library], ["bundle", bundle]] as const) {
	for (const adapter of [true, false]) {
		for (const retention of [undefined, "long"]) {
			it(`${label}: child/reviewer 5m, adapter ${adapter ? "on" : "off"}, env ${retention ?? "unset"}`, async () => {
				const dir = await mkdtemp(join(tmpdir(), "rqw-prompt-cache-"));
				const env = { ...process.env };
				const originalFetch = globalThis.fetch;
				for (const key of Object.keys(process.env)) {
					if (/(API_KEY|AUTH_TOKEN|OAUTH_TOKEN)$/.test(key) || /^(ANTHROPIC_|CLAUDE_|RQW_ANTHROPIC_)/.test(key)) delete process.env[key];
				}
				process.env.PI_CODING_AGENT_DIR = dir;
				delete process.env.PI_CACHE_RETENTION;
				if (retention) process.env.PI_CACHE_RETENTION = retention;
				let session: library.AgentSession | undefined;
				const captures: { model: string; markers: Record<string, unknown>[] }[] = [];
				globalThis.fetch = async (_url, init) => {
					const body = JSON.parse(String(init?.body));
					captures.push({ model: body.model, markers: markers(body) });
					const events = [
						{ type: "message_start", message: { id: "fake-cache-message", model: body.model, usage: { input_tokens: 4, output_tokens: 0 } } },
						{ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
						{ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "CLEAN" } },
						{ type: "content_block_stop", index: 0 },
						{ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } },
						{ type: "message_stop" },
					];
					return new Response(events.map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(""),
						{ headers: { "content-type": "text/event-stream" } });
				};
				try {
					const credentials = AuthStorage.inMemory({ anthropic: { type: "oauth", access: "sk-ant-oat01-fake-cache-probe",
						refresh: "fake-refresh", expires: Date.now() + 3_600_000 } });
					const runtime = await sdk.ModelRuntime.create({ credentials, modelsPath: null, refreshOnCreate: false });
					await runtime.refresh({ allowNetwork: false });
					const manager = sdk.SettingsManager.inMemory({ cacheWarming: "off", compaction: { enabled: false }, retry: { enabled: false } });
					const loader = new sdk.DefaultResourceLoader({ cwd: dir, agentDir: dir, settingsManager: manager,
						extensionPathsOverride: [], additionalExtensionPaths: ["RQW-agent", "RQW-review", ...(adapter ? ["RQW-anthropic"] : [])]
							.map(name => join(ROOT, "extensions", name, "index.ts")),
						noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
						systemPromptOverride: () => "Main cache fixture" });
					await loader.reload();
					assert.deepEqual(loader.getExtensions().errors, []);
					({ session } = await sdk.createAgentSession({ cwd: dir, agentDir: dir, modelRuntime: runtime,
						model: runtime.getModel("anthropic", "claude-opus-5-5")!, thinkingLevel: "off", resourceLoader: loader,
						settingsManager: manager, sessionManager: sdk.SessionManager.inMemory(dir) }));
					const errors: string[] = [];
					await session.bindExtensions({ mode: "tui", onError: e => errors.push(e.error) });
					await session.prompt("main real request");
					const call = async (name: string, args: Record<string, unknown>) => {
						const tool = session!.getToolDefinition(name) as library.ToolDefinition;
						const result = await tool.execute("cache-test", args as never, undefined, undefined, session!.extensionRunner.createContext());
						assert.ok(!result.isError);
					};
					const delivered = (kind: string) => session!.messages.filter(m => m.role === "custom" && m.customType === kind);
					await call("agent", { action: "start", system: "Child cache fixture", task: "first", model: "anthropic/claude-sonnet-5-5", thinking: "off" });
					await until(() => delivered("agent").length === 1);
					await session.waitForIdle();
					await call("agent", { action: "send", id: "agent#1", task: "second" });
					await until(() => delivered("agent").length === 2);
					await session.waitForIdle();
					await call("review", { level: "blind", object: "fixture", criterion: "return CLEAN" });
					await until(() => delivered("review").length === 1);
					await session.waitForIdle();
					assert.deepEqual(errors, []);
					assert.ok(delivered("agent").every(m => typeof m.content === "string" && m.content.includes("CLEAN")));
					assert.ok(delivered("review").every(m => typeof m.content === "string" && m.content.startsWith("[review#1] CLEAN")));
					for (const model of ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"]) {
						const requests = captures.filter(c => c.model === model);
						assert.ok(requests.length >= (model === "claude-sonnet-5-5" ? 2 : 1), model);
						for (const request of requests) {
							assert.ok(request.markers.length > 0, `${model}: caching stays enabled`);
							const long = model === "claude-opus-5-5" && (adapter || retention === "long");
							assert.ok(request.markers.every(marker => marker.type === "ephemeral" &&
								(long ? marker.ttl === "1h" : marker.ttl === undefined || marker.ttl === "5m")), `${model}: role TTL`);
						}
					}
				} finally {
					if (session) { await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" }); session.dispose(); }
					globalThis.fetch = originalFetch;
					for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key];
					Object.assign(process.env, env);
					await rm(dir, { recursive: true, force: true });
				}
			});
		}
	}
}
