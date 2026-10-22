import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex";
import { pickWorkerModel, WORKER_REASONING, type WorkerRole } from "../worker-model.ts";

// Built-in catalog only: no runtime creation, user auth files, environment credentials or network.
const haiku = anthropicProvider().getModels().find(model => model.id === "claude-haiku-5-5")!;
const luna = openaiCodexProvider().getModels().find(model => model.id === "gpt-6-luna")!;

function fakeRegistry(configured: string[] = [], checked: string[] = []) {
	const calls: string[] = [];
	return {
		calls,
		find(provider: string, id: string) {
			calls.push(`find:${provider}/${id}`);
			return [haiku, luna].find(model => model.provider === provider && model.id === id);
		},
		hasConfiguredAuth(model: { provider: string }) {
			calls.push(`configured:${model.provider}`);
			return configured.includes(model.provider);
		},
		runtime: {
			async checkAuth(provider: string) {
				calls.push(`check:${provider}`);
				return checked.includes(provider);
			},
		},
	};
}

const roles: WorkerRole[] = ["code_writer", "shell_runner"];
const lunaThinking = (role: WorkerRole) => role === "code_writer" ? "low" : "medium";

describe("worker model selection", () => {
	it("both exact provider/model ids exist in Pi's built-in registry", () => {
		assert.ok(haiku);
		assert.ok(luna);
		assert.equal(`${haiku.provider}/${haiku.id}`, "anthropic/claude-haiku-5-5");
		assert.equal(`${luna.provider}/${luna.id}`, "openai-codex/gpt-6-luna");
	});

	it("keeps the B4 measured levels in the single table and only the D1 model chain", () => {
		assert.deepEqual(WORKER_REASONING, {
			"anthropic/claude-haiku-5-5": { code_writer: "low", shell_runner: "low" },
			"openai-codex/gpt-6-luna": { code_writer: "low", shell_runner: "medium" },
		});
	});

	for (const role of roles) {
		it(`${role}: prefers Haiku when both providers have configured credentials`, async () => {
			const registry = fakeRegistry(["anthropic", "openai-codex"]);
			assert.deepEqual(await pickWorkerModel(registry, role), { model: haiku, thinking: "low" });
			assert.deepEqual(registry.calls, ["find:anthropic/claude-haiku-5-5", "configured:anthropic"]);
		});

		it(`${role}: checks live auth before falling back from a stale Anthropic snapshot`, async () => {
			const registry = fakeRegistry(["openai-codex"], ["anthropic"]);
			assert.deepEqual(await pickWorkerModel(registry, role), { model: haiku, thinking: "low" });
			assert.deepEqual(registry.calls, ["find:anthropic/claude-haiku-5-5", "configured:anthropic", "check:anthropic"]);
		});

		it(`${role}: falls back to Luna only without Anthropic credentials`, async () => {
			const registry = fakeRegistry(["openai-codex"]);
			assert.deepEqual(await pickWorkerModel(registry, role), { model: luna, thinking: lunaThinking(role) });
			assert.deepEqual(registry.calls, [
				"find:anthropic/claude-haiku-5-5", "configured:anthropic", "check:anthropic",
				"find:openai-codex/gpt-6-luna", "configured:openai-codex",
			]);
		});

		it(`${role}: accepts Luna credentials absent from the snapshot`, async () => {
			const registry = fakeRegistry([], ["openai-codex"]);
			assert.deepEqual(await pickWorkerModel(registry, role), { model: luna, thinking: lunaThinking(role) });
			assert.equal(registry.calls.at(-1), "check:openai-codex");
		});

		it(`${role}: returns a clear error when neither provider has credentials`, async () => {
			const registry = fakeRegistry();
			assert.equal(await pickWorkerModel(registry, role),
				"No credentials for worker providers: anthropic (claude-haiku-5-5) or openai-codex (gpt-6-luna).");
			assert.equal(registry.calls.at(-1), "check:openai-codex");
		});
	}

	for (const role of roles) {
		it(`${role}: missing Haiku continues to configured Luna`, async () => {
			const registry = fakeRegistry(["openai-codex"]);
			const find = registry.find;
			registry.find = (provider, id) => provider === "anthropic" ? undefined : find(provider, id);
			assert.deepEqual(await pickWorkerModel(registry, role), { model: luna, thinking: lunaThinking(role) });
		});
		it(`${role}: rejected Anthropic auth continues to Luna`, async () => {
			const registry = fakeRegistry();
			registry.runtime.checkAuth = async provider => {
				registry.calls.push(`check:${provider}`);
				if (provider === "anthropic") throw new Error("auth check failed");
				return true;
			};
			assert.deepEqual(await pickWorkerModel(registry, role), { model: luna, thinking: lunaThinking(role) });
			assert.equal(registry.calls.at(-1), "check:openai-codex");
		});
		it(`${role}: missing models and rejected auth report No credentials only after all candidates fail`, async () => {
			for (const failure of ["missing", "both-reject", "luna-reject"]) {
				const registry = fakeRegistry();
				if (failure === "missing") registry.find = () => undefined;
				else registry.runtime.checkAuth = async provider => {
					registry.calls.push(`check:${provider}`);
					if (failure === "both-reject" || provider === "openai-codex") throw new Error("auth check failed");
					return false;
				};
				assert.match(String(await pickWorkerModel(registry, role)), /^No credentials for worker providers:/, failure);
				if (failure !== "missing") assert.equal(registry.calls.at(-1), "check:openai-codex");
			}
		});
	}
});
