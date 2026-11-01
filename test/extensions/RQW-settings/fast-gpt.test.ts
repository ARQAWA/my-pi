import assert from "node:assert/strict";
import { it } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { FAST_GPT_QUERY, installFastGpt, isFastGpt, withPriority } from "../../../extensions/RQW-settings/fast-gpt.ts";

type Command = { handler: (args: string, ctx: any) => Promise<void> };

/** A fake Pi that keeps what the extension registers, so tests call the real handlers. */
function loadExtension() {
	const channels = new Map<string, (value: any) => void>();
	const hooks = new Map<string, (...args: any[]) => unknown>();
	const commands = new Map<string, Command>();
	const pi = {
		events: { on: (name: string, handler: any) => { channels.set(name, handler); return () => {}; }, emit() {} },
		on: (name: string, handler: any) => hooks.set(name, handler),
		registerCommand: (name: string, command: Command) => commands.set(name, command),
	};
	installFastGpt(pi as unknown as ExtensionAPI);
	const ctx = { ui: { notify() {} } };
	return {
		command: commands.get("fast-gpt")!,
		ctx,
		queryFast: () => {
			const query: { fastGpt?: boolean } = {};
			channels.get(FAST_GPT_QUERY)!(query);
			return query.fastGpt;
		},
		request: (payload: unknown, model: { provider: string; id: string }) => hooks.get("before_provider_request")!({ payload }, { model }),
	};
}

it("fast-gpt toggles publicly and adds priority only to matching Codex payloads", async () => {
	const { command, ctx, queryFast } = loadExtension();
	const before = isFastGpt();
	await command.handler("off", ctx);
	try {
		assert.equal(queryFast(), false);
		await command.handler("on", ctx);
		assert.equal(isFastGpt(), true);
		assert.deepEqual(withPriority({ model: "gpt" }, { provider: "openai-codex", id: "gpt" }), { model: "gpt", service_tier: "priority" });
		assert.equal(withPriority({ model: "claude" }, { provider: "anthropic", id: "claude" }), undefined);
	} finally {
		await command.handler(before ? "on" : "off", ctx);
	}
	assert.equal(isFastGpt(), before);
});

it("fast-gpt sends priority on provider requests only while on and only for openai-codex", async () => {
	const codex = { provider: "openai-codex", id: "gpt" };
	const anthropic = { provider: "anthropic", id: "claude" };
	const { command, ctx, request } = loadExtension();
	const before = isFastGpt();
	await command.handler("off", ctx);
	try {
		assert.equal(request({ model: "gpt" }, codex), undefined);
		await command.handler("on", ctx);
		assert.deepEqual(request({ model: "gpt", input: [] }, codex), { model: "gpt", input: [], service_tier: "priority" });
		assert.equal(request({ model: "claude" }, anthropic), undefined);
		await command.handler("off", ctx);
		assert.equal(request({ model: "gpt" }, codex), undefined);
	} finally {
		await command.handler(before ? "on" : "off", ctx);
	}
});

it("fast-gpt without an argument toggles and a bad argument changes nothing", async () => {
	const { command, ctx } = loadExtension();
	const before = isFastGpt();
	const notes: string[] = [];
	const quiet = { ui: { notify: (text: string) => notes.push(text) } };
	await command.handler("off", ctx);
	try {
		await command.handler("", ctx);
		assert.equal(isFastGpt(), true);
		await command.handler("maybe", quiet as any);
		assert.equal(isFastGpt(), true);
		assert.deepEqual(notes, ["Usage: /fast-gpt [on|off]"]);
		await command.handler("", ctx);
		assert.equal(isFastGpt(), false);
	} finally {
		await command.handler(before ? "on" : "off", ctx);
	}
});

it("fast-gpt stays on after a reload that installs the extension again", async () => {
	const first = loadExtension();
	const before = isFastGpt();
	await first.command.handler("off", first.ctx);
	try {
		await first.command.handler("on", first.ctx);
		const reloaded = loadExtension();
		assert.equal(reloaded.queryFast(), true);
		assert.deepEqual(reloaded.request({ model: "gpt" }, { provider: "openai-codex", id: "gpt" }), { model: "gpt", service_tier: "priority" });
	} finally {
		await first.command.handler(before ? "on" : "off", first.ctx);
	}
	assert.equal(isFastGpt(), before);
});
