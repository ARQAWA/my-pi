// Loaded only by cli.test.ts into the real Pi bundle. All inference is in-process faux inference.
import assert from "node:assert/strict";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { fauxAssistantMessage as answer, fauxProvider, fauxToolCall, getSystemMessageText } from "@earendil-works/pi-ai";

export default function (pi: ExtensionAPI) {
	const scenario = process.env.RQW_AGENT_SCENARIO ?? "normal";
	if (WAIT_SCENARIOS.has(scenario)) return waitScenarios(pi, scenario);
	const release = Promise.withResolvers<void>();
	const busy = Promise.withResolvers<void>();
	const faux = fauxProvider({ provider: "agent-audit-cli", api: "agent-audit-cli", models: [{ id: "main", reasoning: true }, { id: "child", reasoning: true }] });
	let mainCount = 0, childCount = 0;
	const child = (task: string) => ({ action: "start", system: "AUDIT_EXACT_SYSTEM", task, model: "agent-audit-cli/child", thinking: "high", tools: [] });
	faux.setResponses(Array.from({ length: 50 }, () => async (context, options, _state, model) => {
		if (model.id === "child") {
			const n = ++childCount;
			const systems = context.messages.filter(m => m.role === "system");
			assert.equal(systems.length, 1);
			assert.equal(getSystemMessageText(systems[0]), "AUDIT_EXACT_SYSTEM");
			assert.equal(options?.reasoning, "high");
			// tools:[] removes base tools, not agent and the fixed worker tools available to every agent child; codemode
			// comes as the main session has it (active in the nested scenario).
			assert.deepEqual((systems[0].toolsAdded ?? []).map(tool => tool.name).sort(),
				["agent", "code_writer", ...(scenario === "nested" ? ["codemode"] : []), "shell_runner"]);
			options?.signal?.addEventListener("abort", () => release.resolve(), { once: true });
			if (scenario !== "nested") await release.promise;
			return answer(`CLI_CHILD_${n}`);
		}
		mainCount++;
		if (scenario === "abort-window") process.stderr.write(`AUDIT_MAIN_REQUEST:${mainCount}\n`);
		if (mainCount === 1) {
			if (scenario === "abort-window") return answer([fauxToolCall("agent", child("ONE")), fauxToolCall("agent", child("TWO"))], { stopReason: "toolUse" });
			const tool = scenario === "nested"
				? fauxToolCall("codemode", { code: `return [await tools.agent(${JSON.stringify(child("NESTED_ONE"))}), await tools.agent(${JSON.stringify(child("NESTED_TWO"))})];` }, { id: "nested" })
				: fauxToolCall("agent", child("LONG"));
			return answer([tool], { stopReason: "toolUse" });
		}
		if (scenario === "nested") {
			const body = JSON.stringify(context.messages);
			assert.ok(body.includes("agent#1 started") && body.includes("agent#2 started"));
			return answer("CLI_NESTED_IDS_OK");
		}
		if (mainCount === 2 && (scenario === "abort-rpc" || scenario === "abort-window")) {
			process.stderr.write("AUDIT_MAIN_BUSY\n");
			options?.signal?.addEventListener("abort", () => busy.resolve(), { once: true });
			await busy.promise;
			return answer("ABORTED_BUSY");
		}
		if (mainCount === 2) return answer("CLI_STARTED");
		assert.ok(JSON.stringify(context.messages).includes("[agent#1] CLI_CHILD_1"));
		return answer("CLI_FINAL_GOT_CHILD");
	}));
	pi.registerProvider(faux.provider);
	// Loaded first: release normally, or abort on the next event-loop turn after the child wait begins.
	pi.on("agent_end", (_event, ctx) => {
		if (scenario === "normal") release.resolve();
		if (scenario === "abort-print") setImmediate(() => ctx.abort());
	});
	pi.on("agent_settled", async event => {
		if (scenario === "abort-window" && event.aborted) {
			release.resolve();
			// Let both faux children finish while this earlier public hook holds SDK settlement.
			for (let n = 0; n < 100; n++) await new Promise<void>(resolve => setImmediate(resolve));
		}
		if (scenario === "abort-rpc" && event.aborted) release.resolve();
	});
	pi.on("session_shutdown", (_event, ctx) => {
		const ids = ctx.sessionManager.getEntries().flatMap(e => e.type === "custom" && e.customType === "agent" ? [(e.data as { id: number }).id] : []);
		assert.deepEqual(ids, scenario === "nested" || scenario === "abort-window" ? [1, 2] : [1]);
		if (scenario === "nested") {
			const outer = ctx.sessionManager.getEntries().filter(e => e.type === "message" && e.message.role === "toolResult" && e.message.toolName === "agent");
			assert.equal(outer.length, 0, "nested calls have no outer agent result");
		}
	});
}

const WAIT_SCENARIOS = new Set(["wait", "codemode-wait", "codemode-error", "codemode-timeout", "codemode-mixed", "nested-wait", "codemode-abort"]);

/**
 * Real-CLI wait scenarios. Children, workers and the subagent wait on gates that open only on actual nested events
 * (a wait tool_execution_start, a codemode tool_execution_end) or after bounded setImmediate ticks; no timers of minutes.
 */
function waitScenarios(pi: ExtensionAPI, scenario: string) {
	const waitStarted = Promise.withResolvers<void>();
	const codemodeEnded = Promise.withResolvers<void>();
	const abortGate = Promise.withResolvers<void>();
	const workerGate = Promise.withResolvers<void>();
	const main = fauxProvider({ provider: "agent-audit-cli", api: "agent-audit-cli", models: [{ id: "main", reasoning: true }, { id: "child", reasoning: true }] });
	// Fixed worker profiles resolve anthropic/claude-haiku-5-5 first; the CLI env supplies its credential.
	const workers = fauxProvider({ provider: "anthropic", api: "wait-worker-faux", models: [{ id: "claude-haiku-5-5", reasoning: true }] });
	const body = (message: any): string => typeof message.content === "string" ? message.content : message.content.flatMap((c: any) => c.type === "text" ? [c.text] : []).join("");
	const first = (context: any) => body(context.messages.find((m: any) => m.role === "user"));
	const results = (context: any, name: string): string[] => context.messages.filter((m: any) => m.role === "toolResult" && m.toolName === name).map(body);
	const everything = (context: any) => JSON.stringify(context.messages);
	const count = (value: string, needle: string) => value.split(needle).length - 1;
	const ticks = async (n: number) => { for (let i = 0; i < n; i++) await new Promise<void>(resolve => setImmediate(resolve)); };
	const start = (task: string) => ({ action: "start", system: "AUDIT_EXACT_SYSTEM", task, model: "agent-audit-cli/child", thinking: "high", tools: [] });
	const wait = { action: "wait", ids: ["agent#1"], timeout_ms: 60000 };
	const CHILD: Record<string, string> = { WAIT_CHILD: "CLI_WAIT_CHILD", CODEMODE_WAIT_CHILD: "CLI_CODEMODE_CHILD", ERROR_CHILD: "CLI_ERROR_CHILD", TIMEOUT_CHILD: "CLI_TIMEOUT_CHILD", MIXED_AGENT: "CHILD_MIXED_DONE", ABORT_CHILD: "CLI_ABORT_CHILD" };
	const SCRIPT: Record<string, string> = {
		"codemode-abort": `await tools.agent(${JSON.stringify(start("ABORT_CHILD"))});\nreturn await tools.agent(${JSON.stringify({ ...wait, timeout_ms: 900000 })});`,
		"codemode-wait": `await tools.agent(${JSON.stringify(start("CODEMODE_WAIT_CHILD"))});\nreturn await tools.agent(${JSON.stringify(wait)});`,
		"codemode-error": `await tools.agent(${JSON.stringify(start("ERROR_CHILD"))});\nconst got = await tools.agent(${JSON.stringify(wait)});\nthrow new Error("CODEMODE_AFTER_WAIT");`,
		"codemode-timeout": `// @options: {"timeout_ms": 5000}\nawait tools.agent(${JSON.stringify(start("TIMEOUT_CHILD"))});\nreturn await tools.agent(${JSON.stringify(wait)});`,
		"codemode-mixed": [
			`const ids = ["agent#1", "code_writer#1", "shell_runner#1"];`,
			`await tools.agent(${JSON.stringify(start("MIXED_AGENT"))});`,
			`await tools.code_writer({ task: "CODE_MIXED" });`,
			`await tools.shell_runner({ task: "SHELL_MIXED" });`,
			`const got = [], seen = new Set();`,
			`while (seen.size < 3) {`,
			`  const r = JSON.parse(await tools.agent({ action: "wait", ids: ids.filter(id => !seen.has(id)), timeout_ms: 60000 }));`,
			`  if (r.reason !== "result" && r.reason !== "receipt") break;`,
			`  for (const x of r.results) { got.push(x.text); seen.add(x.id); }`,
			`  for (const x of r.receipts) seen.add(x.id);`,
			`}`,
			`return got.join("|");`,
		].join("\n"),
	};

	async function subagent(context: any) {
		const code = results(context, "code_writer");
		if (code.length === 0) {
			await waitStarted.promise;
			return answer([fauxToolCall("code_writer", { task: "WORKER_TASK" })], { stopReason: "toolUse" });
		}
		if (code.length === 1) {
			// The worker's reply waits a few ticks after this gate, so its result arrives after the nested wait registers.
			workerGate.resolve();
			return answer([fauxToolCall("code_writer", { action: "wait", ids: ["code_writer#1"], timeout_ms: 60000 })], { stopReason: "toolUse" });
		}
		assert.match(code[1], /"reason":"result"/);
		assert.equal(count(code[1], "WORKER_RAW"), 1, "the subagent receives the raw worker result once");
		return answer("SUB_FINAL_ANSWER");
	}

	async function child(context: any, options: any) {
		const task = first(context);
		if (task === "NESTED_SUB") return subagent(context);
		await (task === "ABORT_CHILD" ? abortGate : task === "TIMEOUT_CHILD" ? codemodeEnded : waitStarted).promise;
		assert.ok(!options?.signal?.aborted, "a timed-out wait must not stop its child");
		return answer(CHILD[task]);
	}

	main.setResponses(Array.from({ length: 40 }, () => async (context: any, options: any, _state: any, model: any) => {
		if (model.id === "child") return child(context, options);
		if (scenario === "wait" || scenario === "nested-wait") {
			const agent = results(context, "agent");
			if (agent.length === 0) return answer([fauxToolCall("agent", start(scenario === "wait" ? "WAIT_CHILD" : "NESTED_SUB"))], { stopReason: "toolUse" });
			if (agent.length === 1) return answer([fauxToolCall("agent", wait)], { stopReason: "toolUse" });
			assert.match(agent[1], /"reason":"result"/);
			if (scenario === "wait") {
				assert.equal(count(agent[1], "CLI_WAIT_CHILD"), 1);
				return answer("CLI_WAIT_FINAL");
			}
			assert.equal(count(agent[1], "SUB_FINAL_ANSWER"), 1);
			assert.ok(!everything(context).includes("WORKER_RAW"), "main never sees the raw worker result");
			return answer("CLI_NESTED_WAIT_FINAL");
		}
		if (scenario === "codemode-abort") {
			// Before the late child result exists, the first request starts the script; afterwards only the late custom is seen.
			if (!everything(context).includes("[agent#1] CLI_ABORT_CHILD")) return answer([fauxToolCall("codemode", { code: SCRIPT[scenario] }, { id: "codemode-abort" })], { stopReason: "toolUse" });
			assert.equal(results(context, "agent").length, 0, "no raw nested toolResult in the main transcript");
			assert.equal(count(everything(context), "[agent#1] CLI_ABORT_CHILD"), 1);
			return answer("CLI_ABORT_WAIT_FINAL");
		}
		const code = results(context, "codemode");
		if (code.length === 0) return answer([fauxToolCall("codemode", { code: SCRIPT[scenario] })], { stopReason: "toolUse" });
		if (scenario === "codemode-wait") {
			assert.equal(count(code[0], "CLI_CODEMODE_CHILD"), 1);
			assert.match(code[0], /reason\\?"?:\\?"result/);
			return answer("CLI_CODEMODE_WAIT_FINAL");
		}
		if (scenario === "codemode-error") {
			// The release path must put the result into ordinary custom-message delivery exactly once.
			assert.equal(count(everything(context), "[agent#1] CLI_ERROR_CHILD"), 1);
			return answer("CLI_ERROR_FINAL");
		}
		if (scenario === "codemode-timeout")
			return answer(everything(context).includes("[agent#1] CLI_TIMEOUT_CHILD") ? "CLI_TIMEOUT_LATE" : "CLI_TIMEOUT_HANDLED");
		// A child that finishes between two waits is delivered by message, so its text is counted in the whole context.
		for (const needle of ["CHILD_MIXED_DONE", "CODE_MIXED_DONE", "SHELL_MIXED_DONE"]) assert.equal(count(everything(context), needle), 1, needle);
		return answer("CLI_MIXED_FINAL");
	}));
	workers.setResponses(Array.from({ length: 10 }, () => async (context: any) => {
		const task = first(context);
		if (task === "WORKER_TASK") {
			await workerGate.promise;
			await ticks(200);
			return answer("WORKER_RAW");
		}
		await waitStarted.promise;
		return answer(task === "CODE_MIXED" ? "CODE_MIXED_DONE" : "SHELL_MIXED_DONE");
	}));
	pi.registerProvider(main.provider);
	pi.registerProvider(workers.provider);
	// The start event precedes the wait's registration by a few ticks; open the gate after them, so the result is waited for.
	pi.on("tool_execution_start", event => {
		if (event.toolName !== "agent" || event.args?.action !== "wait") return;
		void ticks(50).then(() => {
			waitStarted.resolve();
			if (scenario === "codemode-abort") process.stderr.write("AUDIT_CODEMODE_WAIT_READY\n");
		});
	});
	// The child stays gated until the RPC abort has settled the main agent; its signal must still be live then.
	pi.on("agent_settled", event => { if (scenario === "codemode-abort" && event.aborted) abortGate.resolve(); });
	pi.on("tool_execution_end", event => { if (event.toolName === "codemode") codemodeEnded.resolve(); });
}
