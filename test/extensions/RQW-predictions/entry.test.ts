import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { harness, last, settle, SILENCE_RULE } from "./harness.ts";

// The extension is loaded as Pi loads it, with its real prompt loader. Only the network, Pi's saved login and the clock are fake.
const START = 1_700_000_000_000;
const CONFIG_URL = "https://chatgpt.com/backend-api/wham/predictions/config";
const ACCESS = `h.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "acc-1", chatgpt_user_id: "user-1" } })).toString("base64url")}.s`;

type Call = { url: string; init: RequestInit };
const realFetch = globalThis.fetch;
const realDir = process.env.PI_CODING_AGENT_DIR;
let dir: string;
let calls: Call[];

const until = async (done: () => boolean) => { for (let i = 0; i < 50 && !done(); i++) await settle(); };

describe("RQW-predictions through the extension entry", () => {
	beforeEach(t => {
		t.mock.timers.enable({ apis: ["Date"], now: START });
		dir = mkdtempSync(join(tmpdir(), "rqw-predictions-"));
		writeFileSync(join(dir, "auth.json"), JSON.stringify({ "openai-codex": { type: "oauth", access: ACCESS, refresh: "r", expires: START + 3_600_000, accountId: "acc-1" } }));
		process.env.PI_CODING_AGENT_DIR = dir;
		calls = [];
		let version = 0;
		globalThis.fetch = (async (url: string, init: RequestInit) => {
			calls.push({ url, init });
			return new Response(JSON.stringify({ prompt: `SERVED PROMPT ${++version}`, prompt_version: String(version) }), { status: 200 });
		}) as typeof fetch;
	});
	afterEach(() => {
		globalThis.fetch = realFetch;
		if (realDir === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = realDir;
		rmSync(dir, { recursive: true, force: true });
	});

	it("the prompt Codex serves reaches the model as the last message with the reply rules, and is cached for 300000 ms", async t => {
		const h = harness({ entry: true });
		h.answer();
		await until(() => h.forks.length === 1);

		assert.equal(calls.length, 1);
		assert.equal(calls[0].url, CONFIG_URL);
		assert.equal(calls[0].init.method, "GET");
		const headers = calls[0].init.headers as Record<string, string>;
		assert.equal(headers.Authorization, `Bearer ${ACCESS}`);
		assert.equal(headers["ChatGPT-Account-ID"], "acc-1");
		const instruction = String(last(h.forks[0].context).content);
		assert.ok(instruction.startsWith("SERVED PROMPT 1\n"));
		assert.match(instruction, /Return only JSON matching this schema: \{.*"suggestion".*\}\./);
		assert.ok(instruction.endsWith(SILENCE_RULE));

		t.mock.timers.tick(299_999);
		h.answer();
		await until(() => h.forks.length === 2);
		assert.equal(calls.length, 1);
		assert.ok(String(last(h.forks[1].context).content).startsWith("SERVED PROMPT 1\n"));

		t.mock.timers.tick(1);
		h.answer();
		await until(() => h.forks.length === 3);
		assert.equal(calls.length, 2);
		assert.ok(String(last(h.forks[2].context).content).startsWith("SERVED PROMPT 2\n"));
	});

	it("without a saved login no request is made and a manual run says why", async () => {
		writeFileSync(join(dir, "auth.json"), "{}");
		const h = harness({ entry: true });
		h.ran();
		h.key("\x05");
		await until(() => h.notes.length === 1);
		assert.equal(calls.length, 0);
		assert.equal(h.forks.length, 0);
		assert.match(h.notes[0], /login/);
	});
});
