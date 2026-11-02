import assert from "node:assert/strict";
import { after, it } from "node:test";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import { keys, reportTimings, world } from "./synthetic/world.ts";

after(() => reportTimings(import.meta.filename));

it("the model chooser offers only the allowed providers", async (t) => {
	const credential = { type: "api_key", key: "fake-key" } as const;
	const w = await world(t, { credentials: { openai: credential } });
	assert.deepEqual(w.errors, []);
	assert.ok(builtinProviders().some((provider) => provider.id === "openai"));
	assert.deepEqual(w.session.modelRuntime.getProviders().map((provider) => provider.id).sort(), ["anthropic", "openai-codex"]);
	assert.deepEqual(await w.credentials.read("openai"), credential);

	w.type("/rqw-models");
	w.press(keys.enter);
	await w.until(() => w.screen().join("\n").includes("RQW models"), "model chooser");
	w.see("anthropic/claude-opus-5-5");
	w.see("openai-codex/gpt-6.1");
	w.notSee("openai/");
	w.press(keys.escape);
	await w.settle();
	assert.deepEqual(w.networkAttempts, []);
	assert.deepEqual(w.processAttempts, []);
});
