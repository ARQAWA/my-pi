import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { CTRL_E, harness, last, settle, SILENCE_RULE, text, USER } from "./harness.ts";

// The extension is loaded as Pi loads it, with its real prompt loader. Only the network, Pi's saved login and the clock are fake.
const START = 1_700_000_000_000;
const CONFIG_URL = "https://chatgpt.com/backend-api/wham/predictions/config";
const ACCESS = `h.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "acc-1", chatgpt_user_id: "user-1" } })).toString("base64url")}.s`;

type Call = { url: string; init: RequestInit };
const realFetch = globalThis.fetch;
const realDir = process.env.PI_CODING_AGENT_DIR;
let dir: string;
let calls: Call[];

const until = async (done: () => boolean) => { for (let i = 0; i < 20000 && !done(); i++) await settle(); };

describe("RQW-predictions through the extension entry", () => {
	beforeEach(() => {
		mock.timers.enable({ apis: ["Date"], now: START });
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
		mock.timers.reset();
		globalThis.fetch = realFetch;
		if (realDir === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = realDir;
		rmSync(dir, { recursive: true, force: true });
	});

	it("the prompt Codex serves reaches the model as the last message with the reply rules, and is cached for 300000 ms", async () => {
		const h = harness({ entry: true });
		h.asked();
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

		mock.timers.tick(299_999);
		h.asked();
		await until(() => h.forks.length === 2);
		assert.equal(calls.length, 1);
		assert.ok(String(last(h.forks[1].context).content).startsWith("SERVED PROMPT 1\n"));

		mock.timers.tick(1);
		h.asked();
		await until(() => h.forks.length === 3);
		assert.equal(calls.length, 2);
		assert.ok(String(last(h.forks[2].context).content).startsWith("SERVED PROMPT 2\n"));
	});

	it("right after a resume, before any main request, Ctrl+E sends the prompt the next main request will carry", async () => {
		const h = harness({ entry: true, fork: false });
		// Pi before its first run: the prompt getter still builds the stock prompt from the base options.
		Object.defineProperties(h.session, {
			_baseSystemPromptOptions: { value: { selectedTools: [], hiddenTools: [] } },
			_runSystemPromptOptions: { value: undefined, writable: true },
			_hiddenDeclarations: { value: new Set() },
			getActiveToolNames: { value: () => ["read"] },
			systemPrompt: { get() { return (this._runSystemPromptOptions as { customPrompt?: string } | undefined)?.customPrompt ?? "STOCK PI PROMPT"; } },
		});
		h.ctx.getSystemPrompt = () => (h.session as unknown as { systemPrompt: string }).systemPrompt;
		// RQW-prompt's side of the startup projection.
		h.events.on("rqw-prompt:startup-projection", data => { (data as { options: { customPrompt?: string } }).options.customPrompt = "RQW PROMPT"; });
		h.key("\x05");
		await until(() => h.provider.length === 1);
		assert.equal(calls.length, 1);
		assert.equal(h.provider.length, 1);
		const [system] = h.provider[0].context.messages;
		assert.equal(system.role, "system");
		assert.equal(system.content, "RQW PROMPT");
		assert.equal(h.ctx.getSystemPrompt(), "STOCK PI PROMPT", "Pi's own prompt state is left as it was");
	});

	it("history on resume enables the hint and Ctrl+E, while a clean branch stays silent", async () => {
		const h = harness({ entry: true, fork: false, branch: [] });
		assert.equal(h.screen().join("").includes("ctrl+e to suggest"), false);
		h.key(CTRL_E);
		await settle();
		assert.equal(calls.length, 0);
		assert.equal(h.provider.length, 0);
		assert.deepEqual(h.notes, []);

		h.state.branch = [{ type: "message", message: USER }, { type: "message", message: text("Done") }];
		h.switchTo("resumed");
		assert.equal(h.screen().join("").includes("ctrl+e to suggest"), true);
		h.key(CTRL_E);
		await until(() => h.provider.length === 1);
		assert.equal(h.provider.length, 1);
		h.state.branch = [{ type: "message", message: USER }];
		h.fire("session_tree");
		assert.equal(h.screen().join("").includes("ctrl+e to suggest"), false);
		h.state.branch.push({ type: "message", message: text("Done") });
		h.answer();
		assert.equal(h.screen().join("").includes("ctrl+e to suggest"), true);
		h.fire("session_shutdown", { reason: "quit" });
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

	// The same extension entry, with the saved login and the endpoint answering as an owner with a bad token would see.
	const login = (expires: number) => writeFileSync(join(dir, "auth.json"), JSON.stringify({ "openai-codex": { type: "oauth", access: ACCESS, refresh: "r", expires, accountId: "acc-1" } }));
	const errorStatus = (h: ReturnType<typeof harness>) => h.keyed.filter(([key]) => key === "rqw-predictions-error");

	it("an expired saved login shows the bright red footer error for 5000 ms without any request", async () => {
		mock.timers.reset();
		mock.timers.enable({ apis: ["Date", "setTimeout"], now: START });
		login(START);
		const h = harness({ entry: true });
		h.asked();
		await until(() => errorStatus(h).length > 0);
		assert.match(errorStatus(h).at(-1)![1]!, /^\x1b\[1;91mCtrl\+E failed: Codex token expired or rejected/);
		assert.equal(calls.length, 0);
		assert.deepEqual(h.notes, []);
		mock.timers.tick(4999);
		assert.notEqual(errorStatus(h).at(-1)![1], undefined);
		mock.timers.tick(1);
		assert.equal(errorStatus(h).at(-1)![1], undefined);
	});

	it("a new Ctrl+E does not cut the error short: it stays its full 5000 ms", async () => {
		mock.timers.reset();
		mock.timers.enable({ apis: ["Date", "setTimeout"], now: START });
		login(START);
		const h = harness({ entry: true });
		h.asked();
		await until(() => errorStatus(h).length > 0);
		const shown = errorStatus(h).at(-1)![1];
		mock.timers.tick(3000);
		h.key(CTRL_E);
		assert.equal(errorStatus(h).at(-1)![1], shown);
		mock.timers.tick(2000);
		assert.equal(errorStatus(h).at(-1)![1], undefined);
	});

	it("a token the endpoint rejects with 401 shows the same error; another HTTP failure stays a plain warning", async () => {
		mock.timers.reset();
		mock.timers.enable({ apis: ["Date", "setTimeout"], now: START });
		globalThis.fetch = (async () => new Response("no", { status: 401 })) as typeof fetch;
		const rejected = harness({ entry: true });
		rejected.asked();
		await until(() => errorStatus(rejected).length > 0);
		assert.match(errorStatus(rejected).at(-1)![1]!, /Codex token expired or rejected/);
		assert.deepEqual(rejected.notes, []);

		globalThis.fetch = (async () => new Response("no", { status: 500 })) as typeof fetch;
		const server = harness({ entry: true });
		server.asked();
		await until(() => server.notes.length > 0);
		assert.deepEqual(errorStatus(server), []);
		assert.deepEqual(server.notes, ["Prediction prompt is unavailable."]);
	});
});
