// Loaded only by cli.test.ts into the real Pi bundle. All inference is in-process faux inference.
import assert from "node:assert/strict";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { fauxAssistantMessage as answer, fauxProvider, fauxToolCall, getSystemMessageText } from "@earendil-works/pi-ai";

export default function (pi: ExtensionAPI) {
	const scenario = process.env.RQW_AGENT_SCENARIO ?? "normal";
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
			assert.equal(systems[0].toolsAdded?.length ?? 0, 0);
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
