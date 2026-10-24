// Root integration test: the cards of RQW-agent-ui on what the real RQW-agent delivers (a custom `[<name>#<id>]` message
// and a `wait` result, with the T15 display details), for generic agents. Real Pi sessions, faux
// providers, isolated agent directory; Pi's exported host components draw the transcript. RQW-agent-ui's own tests load
// only that extension; this one composes the two.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { stripVTControlCharacters } from "node:util";
import { CustomMessageComponent, initTheme, ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import { fauxToolCall } from "@earendil-works/pi-ai";
import { answer, fixture, gate, tick, until } from "../extensions/RQW-agent/test/audit-fixture.ts";
import { NEXT, verdictMessage } from "../extensions/RQW-review/index.ts";

const AGENT_UI = join(import.meta.dirname, "../extensions/RQW-agent-ui/index.ts");
const TOOL_UI = join(import.meta.dirname, "../extensions/RQW-tool-ui/index.ts");
const KINDS = ["agent"] as const;
type Fixture = Awaited<ReturnType<typeof fixture>>;
const ui = { requestRender() {} } as never;
const plain = (lines: string[]) => lines.map((line) => stripVTControlCharacters(line).trimEnd()).join("\n");

const call = (f: Fixture, name: string, params: Record<string, unknown>) =>
	f.session.getToolDefinition(name)!.execute("card", params, undefined, undefined, f.session.extensionRunner.createContext());

/** The stored custom messages of one kind, as Pi's CustomMessageComponent draws them with the renderer the runner resolves. */
function messageRows(f: Fixture, kind: string, message: unknown, expanded: boolean): string {
	const component = new CustomMessageComponent(message as never, f.session.extensionRunner.getMessageRenderer(kind));
	component.setExpanded(expanded);
	return plain(component.render(100));
}

/** The wait result as Pi's ToolExecutionComponent draws it with the renderers the runner resolves for the tool. */
function waitRows(f: Fixture, kind: string, result: { content: unknown; details: unknown }, expanded: boolean): string {
	const definition = f.session.extensionRunner.resolveToolRenderers(kind, () => f.session.getToolDefinition(kind) as never);
	const component = new ToolExecutionComponent(kind, "call", { action: "wait", ids: [`${kind}#2`] }, {}, definition as never, ui, process.cwd());
	component.setExpanded(expanded);
	component.updateResult({ ...result, isError: false } as never, false);
	return plain(component.render(100));
}

test("agent-ui on real deliveries: agent custom message and wait result, collapsed and Ctrl+O", async () => {
	// Pi reads keybindings and settings from here, never from the owner's ~/.pi.
	process.env.PI_CODING_AGENT_DIR = mkdtempSync(join(tmpdir(), "rqw-agent-ui-delivery-"));
	initTheme("dark", false);
	for (const kind of KINDS) {
		const f = await fixture("tui", undefined, [], [AGENT_UI]);
		try {
			const model = `${f.sub.provider.id}/s`;
			f.subReplies.push(answer("Первый ответ.\nВторая строка."));
			assert.equal(await f.start("ONE"), "agent#1 started");
			await until(() => f.delivered().length === 1, "the agent message");
			const short = model.slice(model.lastIndexOf("/") + 1).replace(/^claude-([a-z]+).*/, "$1");

			// Delivery path 1: the custom message.
			const stored = f.session.messages.find((m) => m.role === "custom" && m.customType === kind)!;
			const collapsed = messageRows(f, kind, stored, false);
			assert.match(collapsed, new RegExp(`${kind}#1 finished · ${short} low · \\d+(\\.\\d)?s`), collapsed);
			assert.match(collapsed, /Первый ответ\./);
			assert.doesNotMatch(collapsed, /Вторая строка/);
			assert.doesNotMatch(collapsed, new RegExp(`\\[${kind}\\]`), "not Pi's default label box");
			const expanded = messageRows(f, kind, stored, true);
			assert.match(expanded, /Вторая строка\./, "Ctrl+O: the full original text");
			assert.equal((stored as { content: string }).content, `[${kind}#1] Первый ответ.\nВторая строка.`, "stored content untouched");

			// Delivery path 2: the wait result of a second run.
			const g = gate("Ответ через wait.\nХвост.");
			f.subReplies.push(g.reply);
			await f.start("TWO");
			await until(() => g.entered(), `the second ${kind} running`);
			const waiting = call(f, kind, { action: "wait", blocking: true, ids: [`${kind}#2`], timeout_ms: 60000 });
			await tick(20);
			g.release();
			const result = await waiting;
			const waitCollapsed = waitRows(f, kind, result, false);
			assert.match(waitCollapsed, new RegExp(`${kind}#2 finished · ${short} low · \\d+(\\.\\d)?s`), waitCollapsed);
			assert.match(waitCollapsed, /Ответ через wait\./);
			assert.doesNotMatch(waitCollapsed, /"reason"|Хвост/, "the card, not the JSON");
			const waitExpanded = waitRows(f, kind, result, true);
			assert.match(waitExpanded, /"reason":"result"/, "Ctrl+O: the original result");
			assert.match(waitExpanded, /Хвост/);
			assert.doesNotMatch(waitExpanded, new RegExp(`${kind}#2 finished`));
			assert.equal(f.session.messages.filter((m) => m.role === "custom" && m.customType === kind).length, 1, "a waited result is not also delivered as a message");
			assert.deepEqual(f.errors, []);
		} finally {
			await f.cleanup();
		}
	}
});

function resultHost(f: Fixture, kind: string, args: Record<string, unknown>, result: { content: unknown; details: unknown }, toolCallId = "wait-host", stock = false) {
	const base = f.session.getToolDefinition(kind)!;
	const definition = stock ? base : f.session.extensionRunner.resolveToolRenderers(kind, () => base);
	const component = new ToolExecutionComponent(kind, toolCallId, args, {}, definition as never, ui, f.root);
	component.updateResult({ ...result, isError: false } as never, false);
	return component;
}

test("agent-ui renders every real multi-agent until all result with title and prompt-file metadata", async () => {
	process.env.PI_CODING_AGENT_DIR = mkdtempSync(join(tmpdir(), "rqw-agent-ui-all-"));
	initTheme("dark", false);
	const f = await fixture("tui", undefined, [], [AGENT_UI]);
	const agent = gate("AGENT_FIRST\nAGENT_TAIL"), second = gate("SECOND_FIRST\nSECOND_TAIL");
	const prompt = "A temporary exact system prompt.\n";
	const promptPath = join(f.root, "system.md");
	writeFileSync(promptPath, prompt);
	try {
		f.subReplies.push(agent.reply, second.reply);
		const { system: _system, ...params } = f.params("MIXED_AGENT");
		await call(f, "agent", { ...params, system_file: promptPath, title: "Named research child" });
		await until(agent.entered, "first agent reply assigned");
		await call(f, "agent", { ...f.params("SECOND_AGENT"), title: "Named second child" });
		await until(() => agent.entered() && second.entered(), "both agents running");
		const args = { action: "wait", blocking: true, ids: ["agent#1", "agent#2"], until: "all", wake_on_alert: false, timeout_ms: 60000 };
		let settled = false;
		const waiting = call(f, "agent", args).then(result => { settled = true; return result; });
		await tick();
		agent.release();
		await tick();
		const firstStatus = JSON.parse(await f.call({ action: "status", ids: ["agent#1"] })).statuses[0];
		assert.equal(firstStatus.state, "idle", "the first child has completed");
		assert.equal(settled, false, "until all stays parked after the first child");
		assert.deepEqual(f.delivered(), [], "the held agent result is not pushed");
		second.release();
		const result = await waiting;
		const details = result.details as { reason: string; results: { id: string; text: string; display: Record<string, unknown> }[] };
		assert.equal(details.reason, "result");
		assert.deepEqual(details.results.map(item => [item.id, item.text]), [["agent#1", "AGENT_FIRST\nAGENT_TAIL"], ["agent#2", "SECOND_FIRST\nSECOND_TAIL"]]);
		assert.equal(details.results[0].display.title, "Named research child");
		assert.equal(details.results[1].display.title, "Named second child");
		assert.deepEqual(details.results[0].display.prompt_file, { kind: "system", path: promptPath, sha256: createHash("sha256").update(prompt).digest("hex") });
		const original = JSON.stringify(result);
		const host = resultHost(f, "agent", args, result);
		const collapsed = plain(host.render(160));
		for (const [id, title, first] of [["agent#1", "Named research child", "AGENT_FIRST"], ["agent#2", "Named second child", "SECOND_FIRST"]]) {
			assert.match(collapsed, new RegExp(`${id} ${title} finished`));
			assert.match(collapsed, new RegExp(first));
		}
		assert.doesNotMatch(collapsed, /AGENT_TAIL|SECOND_TAIL|"reason"|sha256/);
		host.setExpanded(true);
		const expanded = plain(host.render(160));
		assert.match(expanded, /"reason":"result"/);
		assert.match(expanded, /AGENT_TAIL/);
		assert.match(expanded, /SECOND_TAIL/);
		const stock = resultHost(f, "agent", args, result, "stock-all", true);
		stock.setExpanded(true);
		assert.equal(expanded, plain(stock.render(160)), "expanded content is the original, not display-only metadata");
		assert.doesNotMatch(expanded, /"prompt_file"|sha256/, "provenance stays in details, never injected into original content");
		host.setExpanded(false);
		assert.equal(plain(host.render(160)), collapsed);
		assert.equal(JSON.stringify(result), original, "rendering never mutates delivery metadata");
		assert.equal(f.session.messages.some(message => message.role === "custom" && KINDS.includes(message.customType as typeof KINDS[number])), false);
		assert.deepEqual(f.errors, []);
	} finally { agent.release(); second.release(); await f.cleanup(); }
});

test("agent-ui leaves real alert and status results identical to stock across host expansion", async () => {
	process.env.PI_CODING_AGENT_DIR = mkdtempSync(join(tmpdir(), "rqw-agent-ui-alert-"));
	initTheme("dark", false);
	const f = await fixture("tui", undefined, [], [AGENT_UI]);
	const held = gate();
	const failure = "REAL_ALERT_RENDER_MARK";
	f.subReplies.push(async (context, options) => {
		await held.reply(context, options);
		return answer("", { stopReason: "error", errorMessage: failure });
	});
	try {
		await f.start();
		await until(held.entered, "alert child running");
		const args = { action: "wait", blocking: true, ids: ["agent#1"], timeout_ms: 60000 };
		const waiting = call(f, "agent", args);
		await tick(); held.release();
		const alert = await waiting;
		assert.equal((alert.details as { reason: string }).reason, "alert");
		assert.deepEqual((alert.details as { results: unknown[] }).results, []);
		await until(() => f.delivered().length === 1, "terminal result after the alert");
		const statusArgs = { action: "status", ids: ["agent#1"] };
		const status = await call(f, "agent", statusArgs);
		for (const [input, result] of [[args, alert], [statusArgs, status]] as const) {
			const untouched = JSON.stringify(result);
			const host = resultHost(f, "agent", input, result);
			const stock = resultHost(f, "agent", input, result, "stock-host", true);
			for (const expanded of [false, true, false]) {
				host.setExpanded(expanded); stock.setExpanded(expanded);
				const rendered = plain(host.render(120));
				assert.equal(rendered, plain(stock.render(120)), "diagnostics retain stock rendering");
				assert.match(rendered, /"statuses"/);
				assert.match(rendered, new RegExp(failure));
				assert.doesNotMatch(rendered, /agent#1 (finished|failed)/);
			}
			assert.equal(JSON.stringify(result), untouched);
		}
		assert.deepEqual(f.errors, []);
	} finally { held.release(); await f.cleanup(); }
});

// Reviews arrive only as custom messages, never through the agent wait-result path.
// Use the production delivery envelope and REVIEWER.md's complete verdict fields.
test("review custom messages use runner-registered cards independently of tool-ui and preserve the original delivery", async () => {
	process.env.PI_CODING_AGENT_DIR = mkdtempSync(join(tmpdir(), "rqw-review-ui-delivery-"));
	initTheme("dark", false);
	const finding = (n: number) => [
		`FINDING ${n}`,
		`REQUIREMENT: Preserve [required-${n}] in the response.`,
		`MISMATCH: The response omits [actual-${n}].`,
		`EVIDENCE: Missing [actual-${n}] in response.ts.`,
		`REQUIRED OUTCOME: Restore [required-${n}].`,
	].join("\n");
	const checked = "CHECKED:\n- response.ts: inspected [checked-source] against the criterion.";
	const findings = `FINDINGS:\n${finding(1)}\n${finding(2)}\n${checked}`;
	const cases = [
		{ n: 41, verdict: `CLEAN\n${checked}`, next: NEXT.clean, findings: 0, unchecked: 0 },
		{ n: 42, verdict: findings, next: NEXT.findings, findings: 2, unchecked: 0 },
		{ n: 43, verdict: `${findings}\nUNCHECKED:\n- missing.ts: [unread-source] was unavailable.`, next: NEXT.incomplete, findings: 2, unchecked: 1 },
	];
	const normalized = (text: string) => text.replace(/\s+/g, " ").trim();
	for (const agentUi of [false, true]) for (const toolUi of [false, true]) {
		const f = await fixture("tui", undefined, [], [...(agentUi ? [AGENT_UI] : []), ...(toolUi ? [TOOL_UI] : [])]);
		try {
			const renderer = f.session.extensionRunner.getMessageRenderer("review");
			assert.equal(typeof renderer, agentUi ? "function" : "undefined", "only agent-ui registers the review message renderer");
			for (const item of cases) {
				const content = verdictMessage(item.n, item.verdict, false);
				assert.ok(content.endsWith(`\n\n${item.next}`), "production NEXT matches this REVIEWER-format verdict");
				f.session.sendCustomMessage({ customType: "review", content, display: true, details: { n: item.n } }, { triggerTurn: false });
				const stored = f.session.messages.find(message => message.role === "custom" && message.customType === "review" && (message.details as { n?: number } | undefined)?.n === item.n);
				assert.ok(stored && stored.role === "custom");
				const original = JSON.stringify(stored);
				const host = new CustomMessageComponent(stored, renderer);
				const stock = new CustomMessageComponent(stored);
				let folded: string | undefined;
				for (const expanded of [false, true, false]) {
					host.setExpanded(expanded); stock.setExpanded(expanded);
					const rendered = plain(host.render(160));
					if (!agentUi) {
						assert.equal(rendered, plain(stock.render(160)), "without agent-ui the actual custom message stays stock-identical");
						continue;
					}
					const header = rendered.split("\n").map(row => row.trim()).find(Boolean)!;
					assert.ok(header.startsWith(`review#${item.n} `), header);
					assert.doesNotMatch(rendered, /\[review\]|\[review#(?:41|42|43)\]/, "only the outer delivery brackets are removed");
					if (expanded) {
						assert.ok(normalized(rendered).includes(normalized(item.verdict)), "expanded verdict retains every finding field, verification section and inner bracket");
						assert.ok(normalized(rendered).includes(normalized(item.next)), "expanded message retains the complete production NEXT paragraph");
					} else {
						if (item.findings === 0) assert.match(header, /CLEAN/);
						else assert.match(header, new RegExp(`${item.findings} findings?`));
						if (item.unchecked) assert.match(header, new RegExp(`${item.unchecked} unchecked`, "i"));
						assert.doesNotMatch(rendered, /REQUIRED OUTCOME:|checked-source|unread-source|The check passed only|Find each quote/);
						folded ??= rendered;
						assert.equal(rendered, folded, "folding back restores the same review summary");
					}
				}
				assert.equal(JSON.stringify(stored), original, "host rendering leaves the full message unchanged");
				assert.equal(stored.content, content);
				assert.deepEqual(stored.details, { n: item.n });
			}
			assert.equal(f.session.messages.some(message => message.role === "toolResult" && message.toolName === "review"), false, "review verdicts are not tool results");
			assert.deepEqual(f.errors, []);
		} finally { await f.cleanup(); }
	}
});

type DeliveredCard = {
	id: string;
	text: string;
	display: { title: string; outcome: string; model: string; thinking: string; seconds: number };
};

/** Check each complete header and every body line once, independently of the extension's card helpers. */
function assertExpandedCards(rendered: string, cards: DeliveredCard[]) {
	const rows = rendered.split("\n").map(row => row.trim());
	for (const card of cards) {
		const { title, outcome, model, thinking, seconds } = card.display;
		assert.equal(typeof title, "string");
		assert.equal(outcome, "finished");
		assert.equal(thinking, "low");
		assert.equal(typeof seconds, "number");
		const short = model.slice(model.lastIndexOf("/") + 1).replace(/^claude-([a-z]+).*/, "$1");
		const tenths = Math.round(seconds * 10) / 10;
		const duration = tenths < 60 ? `${tenths}s` : `${Math.floor(Math.round(tenths) / 60)}m ${String(Math.round(tenths) % 60).padStart(2, "0")}s`;
		const header = `${card.id} ${title} ${outcome} · ${short} ${thinking} · ${duration}`;
		assert.equal(rows.filter(row => row === header).length, 1, `one full title/status/model/effort/seconds header: ${header}`);
		assert.equal(rows.filter(row => row.startsWith(`${card.id} `)).length, 1, "no duplicate or partial header");
		for (const line of card.text.split("\n")) assert.equal(rows.filter(row => row === line).length, 1, `full body line once: ${line}`);
	}
	assert.doesNotMatch(rendered, /Waited for|"reason"|"results"|"display"|"prompt_file"|sha256/, "expanded cards replace JSON without exposing metadata");
}

test("agent-ui before tool-ui keeps the exact folded summary and expands an agent to full cards repeatedly", async () => {
	process.env.PI_CODING_AGENT_DIR = mkdtempSync(join(tmpdir(), "rqw-agent-ui-compose-"));
	initTheme("dark", false);
	for (const kind of KINDS) {
		const f = await fixture("tui", undefined, [], [AGENT_UI, TOOL_UI]);
		const held = gate("COMPOSE_FIRST\nCOMPOSE_MIDDLE\nCOMPOSE_TAIL");
		const args = { action: "wait", blocking: true, ids: [`${kind}#1`], timeout_ms: 60000, wake_on_alert: false };
		try {
			f.subReplies.push(held.reply);
			await call(f, kind, { ...f.params(), title: "Named composition child" });
			await until(held.entered, "composition child running");
			f.mainReplies.push(answer([fauxToolCall(kind, args, { id: "composed-wait" })], { stopReason: "toolUse" }), answer("COMPOSITION_DONE"));
			const run = f.session.prompt("Wait for the child");
			await until(() => f.session.messages.some(message => message.role === "assistant" && message.content.some(block => block.type === "toolCall" && block.id === "composed-wait")), "native wait call");
			await tick(); held.release(); await run;
			const result = f.session.messages.find(message => message.role === "toolResult" && message.toolCallId === "composed-wait");
			assert.ok(result && result.role === "toolResult");
			const details = result.details as { reason: string; results: DeliveredCard[] };
			assert.equal(details.reason, "result");
			assert.deepEqual(details.results.map(item => [item.id, item.text, item.display.title]), [[`${kind}#1`, "COMPOSE_FIRST\nCOMPOSE_MIDDLE\nCOMPOSE_TAIL", "Named composition child"]]);
			const untouched = JSON.stringify(result);
			const host = resultHost(f, kind, args, result, "composed-wait");
			const collapsed = plain(host.render(160));
			assert.equal(collapsed, "\n Waited for 1 agent", "exact tool-ui summary, including Pi's blank row and padding");
			assert.equal(collapsed.split("Waited for 1 agent").length - 1, 1, "only one group summary");
			assert.doesNotMatch(collapsed, /COMPOSE_FIRST|COMPOSE_TAIL|finished|"reason"/, "no result card appended outside the tool-ui group");
			let firstExpanded: string | undefined;
			for (let cycle = 0; cycle < 3; cycle++) {
				host.setExpanded(true);
				const expanded = plain(host.render(160));
				assertExpandedCards(expanded, details.results);
				firstExpanded ??= expanded;
				assert.equal(expanded, firstExpanded, "re-expanding keeps the same full cards and shell");
				host.setExpanded(false);
				assert.equal(plain(host.render(160)), collapsed, "Ctrl+O back delegates the unchanged tool-ui shell");
			}
			assert.equal(JSON.stringify(result), untouched);
			assert.deepEqual(f.session.messages.filter(message => message.role === "custom" && KINDS.includes(message.customType as typeof KINDS[number])), []);
			assert.deepEqual(f.errors, []);
		} finally { held.release(); await f.cleanup(); }
	}
});

test("agent-ui before tool-ui expands mixed results in leader and nonleader calls without duplicate cards", async () => {
	process.env.PI_CODING_AGENT_DIR = mkdtempSync(join(tmpdir(), "rqw-agent-ui-compose-mixed-"));
	initTheme("dark", false);
	const f = await fixture("tui", undefined, [], [AGENT_UI, TOOL_UI]);
	const gates = [gate("AGENT_FIRST\nAGENT_TAIL"), gate("WRITER_FIRST\nWRITER_TAIL"), gate("SHELL_FIRST\nSHELL_TAIL")];
	let mixedFinished = false;
	const unsubscribe = f.session.subscribe(event => {
		if (event.type === "tool_execution_end" && event.toolCallId === "mixed-wait") mixedFinished = true;
	});
	try {
		f.subReplies.push(...gates.map(held => held.reply));
		await call(f, "agent", { ...f.params(), title: "Named mixed agent" });
		await until(gates[0].entered, "first agent reply assigned");
		await call(f, "agent", { ...f.params("MIXED_WRITER"), title: "Named mixed writer" });
		await until(gates[1].entered, "second agent reply assigned");
		await call(f, "agent", { ...f.params("MIXED_SHELL"), title: "Named mixed shell" });
		await until(() => gates.every(held => held.entered()), "all mixed children running");
		const calls = [
			{ kind: "agent", id: "mixed-wait", args: { action: "wait", blocking: true, ids: ["agent#1", "agent#2"], until: "all", timeout_ms: 60000, wake_on_alert: false } },
			{ kind: "agent", id: "shell-wait", args: { action: "wait", blocking: true, ids: ["agent#3"], until: "all", timeout_ms: 60000, wake_on_alert: false } },
		];
		f.mainReplies.push(answer(calls.map(item => fauxToolCall(item.kind, item.args, { id: item.id })), { stopReason: "toolUse" }), answer("MIXED_COMPOSITION_DONE"));
		const run = f.session.prompt("Collect all three children");
		await until(() => f.session.messages.some(message => message.role === "assistant" && message.content.some(block => block.type === "toolCall" && block.id === "mixed-wait")), "native mixed waits");
		await tick(); gates[0].release(); gates[1].release();
		// Pi persists the batch after its tools finish; the public end event exposes this handoff before then.
		await until(() => mixedFinished, "mixed wait execution finished");
		await tick(); gates[2].release(); await run;
		const hosts = calls.map(item => {
			const result = f.session.messages.find(message => message.role === "toolResult" && message.toolCallId === item.id);
			assert.ok(result && result.role === "toolResult");
			const details = result.details as { reason: string; results: DeliveredCard[] };
			assert.equal(details.reason, "result");
			assert.deepEqual(details.results.map(card => card.id), item.args.ids);
			return { host: resultHost(f, item.kind, item.args, result, item.id), result, cards: details.results, untouched: JSON.stringify(result) };
		});
		assert.deepEqual(hosts.flatMap(item => item.cards.map(card => [card.id, card.text, card.display.title])), [
			["agent#1", "AGENT_FIRST\nAGENT_TAIL", "Named mixed agent"],
			["agent#2", "WRITER_FIRST\nWRITER_TAIL", "Named mixed writer"],
			["agent#3", "SHELL_FIRST\nSHELL_TAIL", "Named mixed shell"],
		]);
		const folded = hosts.map(item => plain(item.host.render(160)));
		assert.deepEqual(folded, ["", "\n Waited for 3 agents"], "only the last call leads the tool-ui group");
		for (let cycle = 0; cycle < 3; cycle++) {
			for (const item of hosts) {
				item.host.setExpanded(true);
				assertExpandedCards(plain(item.host.render(160)), item.cards);
			}
			assertExpandedCards(hosts.map(item => plain(item.host.render(160))).join("\n"), hosts.flatMap(item => item.cards));
			for (const item of hosts) item.host.setExpanded(false);
			assert.deepEqual(hosts.map(item => plain(item.host.render(160))), folded);
		}
		for (const item of hosts) assert.equal(JSON.stringify(item.result), item.untouched);
		assert.deepEqual(f.session.messages.filter(message => message.role === "custom" && KINDS.includes(message.customType as typeof KINDS[number])), []);
		assert.deepEqual(f.errors, []);
	} finally { unsubscribe(); gates.forEach(held => held.release()); await f.cleanup(); }
});

test("agent-ui before tool-ui leaves a no-results receipt diagnostic stock-identical when expanded", async () => {
	process.env.PI_CODING_AGENT_DIR = mkdtempSync(join(tmpdir(), "rqw-agent-ui-compose-diagnostic-"));
	initTheme("dark", false);
	const f = await fixture("tui", undefined, [], [AGENT_UI, TOOL_UI]);
	try {
		f.subReplies.push(answer("ALREADY_DELIVERED"));
		await f.start();
		await until(() => f.delivered().length === 1, "the result already delivered as a custom message");
		await f.session.waitForIdle();
		const args = { action: "wait", blocking: true, ids: ["agent#1"], timeout_ms: 1 };
		f.mainReplies.push(answer([fauxToolCall("agent", args, { id: "receipt-wait" })], { stopReason: "toolUse" }), answer("DIAGNOSTIC_DONE"));
		await f.session.prompt("Check the delivery receipt");
		const result = f.session.messages.find(message => message.role === "toolResult" && message.toolCallId === "receipt-wait");
		assert.ok(result && result.role === "toolResult");
		const details = result.details as { reason: string; results: unknown[] };
		assert.equal(details.reason, "receipt");
		assert.deepEqual(details.results, []);
		const untouched = JSON.stringify(result);
		const host = resultHost(f, "agent", args, result, "receipt-wait");
		const stock = resultHost(f, "agent", args, result, "receipt-stock", true);
		const collapsed = plain(host.render(160));
		assert.equal(collapsed, "\n Waited for 1 agent");
		for (let cycle = 0; cycle < 3; cycle++) {
			host.setExpanded(true); stock.setExpanded(true);
			const expanded = plain(host.render(160));
			assert.equal(expanded, plain(stock.render(160)), "no delivered cards: exact original diagnostic and stock shell");
			assert.match(expanded, /"reason":"receipt"/);
			assert.doesNotMatch(expanded, /agent#1 finished|ALREADY_DELIVERED|Waited for/);
			host.setExpanded(false);
			assert.equal(plain(host.render(160)), collapsed);
		}
		assert.equal(JSON.stringify(result), untouched);
		assert.equal(f.delivered().length, 1, "a receipt never redelivers the answer");
		assert.deepEqual(f.errors, []);
	} finally { await f.cleanup(); }
});
