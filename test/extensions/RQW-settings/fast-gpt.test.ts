import assert from "node:assert/strict";
import { it } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { FAST_GPT_QUERY, installFastGpt, isFastGpt, withPriority } from "../../../extensions/RQW-settings/fast-gpt.ts";

it("fast-gpt toggles publicly and adds priority only to matching Codex payloads", async () => {
	const channels = new Map<string, (value: any) => void>();
	const commands = new Map<string, { handler: (args: string, ctx: any) => Promise<void> }>();
	const pi = {
		events: { on: (name: string, handler: any) => { channels.set(name, handler); return () => {}; }, emit() {} },
		on() {}, registerCommand: (name: string, command: any) => commands.set(name, command),
	};
	installFastGpt(pi as unknown as ExtensionAPI);
	const command = commands.get("fast-gpt")!;
	const ctx = { ui: { notify() {} } };
	try {
		const query: { fastGpt?: boolean } = {};
		channels.get(FAST_GPT_QUERY)!(query);
		assert.equal(query.fastGpt, false);
		await command.handler("on", ctx);
		assert.equal(isFastGpt(), true);
		assert.deepEqual(withPriority({ model: "gpt" }, { provider: "openai-codex", id: "gpt" }), { model: "gpt", service_tier: "priority" });
		assert.equal(withPriority({ model: "claude" }, { provider: "anthropic", id: "claude" }), undefined);
	} finally {
		await command.handler("off", ctx);
	}
	assert.equal(isFastGpt(), false);
});
