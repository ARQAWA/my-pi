import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import * as PiRoot from "@earendil-works/pi-coding-agent";
import { AgentSession, SessionManager } from "@earendil-works/pi-coding-agent";
import { installBackground, prepareSnapshot } from "../../../extensions/RQW-context/background.ts";
import { harness, WINDOW } from "./harness.ts";

// Test-only oracle: Pi's own pure preparation, which neither package build exports at its root.
const { prepareCompaction } = await import(new URL("core/compaction/compaction.js", import.meta.resolve("@earendil-works/pi-coding-agent")).href) as {
	prepareCompaction(entries: unknown[], settings: unknown): any;
};

/** Four turns: 20%, 20%, 20% of W, then 10%, which crosses 65% after the last answer. */
async function toBackground(h: Awaited<ReturnType<typeof harness>>) {
	for (const percent of [0.2, 0.2, 0.2]) await h.say(percent);
	assert.ok(h.percent() < 0.65);
	assert.equal(h.summaries.length, 0);
	await h.say(0.1);
	assert.ok(h.percent() >= 0.65 && h.percent() < 0.9);
	await h.summary(1);
	if (!h.control.hold) await h.quiet();
}
const userIds = (h: Awaited<ReturnType<typeof harness>>) =>
	h.manager.getBranch().filter((entry: any) => entry.type === "message" && entry.message.role === "user").map((entry) => entry.id);

describe("RQW-context background compaction: trigger and lifecycle", () => {
	it("starts one background summary from 65% of W per generation and reports it on the status channel", async () => {
		const h = await harness();
		h.control.hold = true;
		await toBackground(h);
		const sessionId = h.manager.getSessionId();
		assert.equal(h.summaries.length, 1);
		assert.deepEqual(h.status, [{ sessionId, active: true }]);
		await h.say(0.02);
		assert.equal(h.summaries.length, 1);
		h.release("S");
		await h.quiet();
		assert.deepEqual(h.status, [{ sessionId, active: true }, { sessionId, active: false }]);
	});

	it("does not start when compaction is off or an explicit reserve puts Pi's threshold below 65%", async () => {
		for (const settings of [{ enabled: false }, { reserveTokens: 2_000 }, { modelOverrides: { "faux/m": { reserveTokens: 2_000 } } }]) {
			const h = await harness(settings);
			for (const percent of [0.2, 0.2, 0.2, 0.1]) await h.say(percent);
			assert.deepEqual(h.status, [], JSON.stringify(settings));
			// Only Pi's own foreground compactions asked for summaries.
			assert.equal(h.summaries.length, h.compactions().length, JSON.stringify(settings));
		}
	});

	it("does not retry a failed attempt in the same generation", async () => {
		const h = await harness();
		h.control.fail = true;
		await toBackground(h);
		await h.say(0.02);
		assert.equal(h.summaries.length, 1);
		assert.deepEqual(h.status.map((item: any) => item.active), [true, false]);
	});

	it("aborts the running request and reports its end at once when the session shuts down", async () => {
		const h = await harness();
		h.control.hold = true;
		// The request ignores its abort, so only an immediate report can end the status.
		h.control.stubborn = true;
		await toBackground(h);
		await h.session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" } as never);
		assert.equal(h.summaries[0].aborted, true);
		assert.deepEqual(h.status.map((item: any) => item.active), [true, false]);
	});
});

describe("RQW-context background compaction: ending a request", () => {
	it("a disposed session, as when a subagent is stopped, aborts its request and reports the end", async () => {
		const h = await harness();
		h.control.hold = true;
		h.control.stubborn = true;
		await toBackground(h);
		h.session.dispose();
		assert.equal(h.summaries[0].aborted, true);
		assert.deepEqual(h.status.map((item: any) => item.active), [true, false]);
	});

	for (const [name, run] of [
		["manual compaction", (h: Awaited<ReturnType<typeof harness>>) => h.session.compact()],
		["threshold compaction", (h: Awaited<ReturnType<typeof harness>>) => h.say(0.22)],
	] as const) {
		it(`a session_before_compact handler that cancels ${name} still ends the running request`, async () => {
			let cancel = false;
			const h = await harness({}, (pi) => pi.on("session_before_compact", () => cancel ? { cancel: true } : undefined));
			h.control.hold = true;
			h.control.stubborn = true;
			await toBackground(h);
			cancel = true;
			if (name === "manual compaction") await assert.rejects(run(h), { message: "Compaction cancelled" });
			else await run(h);
			// Pi never asked the summary generator, so only the compaction entry itself can end the request.
			assert.equal(h.summaries.length, 1);
			assert.equal(h.summaries[0].aborted, true);
			assert.deepEqual(h.status.map((item: any) => item.active), [true, false]);
			assert.equal(h.compactions().length, 0);
		});
	}

	it("the late end of a cancelled request does not switch off the next request", async () => {
		const h = await harness();
		h.control.hold = true;
		h.control.stubborn = true;
		await toBackground(h);
		const manual = h.session.compact();
		await h.summary(2);
		h.summaries[1].resolve("MANUAL");
		await manual;
		assert.equal(h.compactions().length, 1);
		// Grow again until the next generation starts its own request.
		for (const percent of [0.1, 0.2, 0.2]) await h.say(percent);
		await h.summary(3);
		assert.deepEqual(h.status.map((item: any) => item.active), [true, false, true]);
		// Let the cancelled request finish its handling before settling the current one.
		h.summaries[0].resolve("LATE");
		await new Promise<void>((resolve) => setImmediate(resolve));
		assert.deepEqual(h.status.map((item: any) => item.active), [true, false, true]);
		h.summaries[2].resolve("CURRENT");
		await h.until(() => h.status.length >= 4);
		assert.deepEqual(h.status.map((item: any) => item.active), [true, false, true, false]);
	});
});

describe("RQW-context background compaction: exact trigger boundaries", () => {
	/**
	 * Sends the last turn so that the usage the provider reports for it is exactly `target` tokens. Faux usage is linear in
	 * the text size, so one probe session with the same history gives the offset.
	 */
	async function sayTo(h: Awaited<ReturnType<typeof harness>>, target: number) {
		const history = [0.2, 0.2, 0.2];
		const probe = await harness();
		for (const percent of history) await probe.say(percent);
		const chars = 800;
		await probe.session.prompt("x".repeat(chars));
		const measured = probe.session.getContextUsage()!.tokens!;
		for (const percent of history) await h.say(percent);
		await h.session.prompt("x".repeat(chars + 4 * (target - measured)));
		const answer = h.manager.getBranch().filter((entry: any) => entry.type === "message" && entry.message.role === "assistant").at(-1) as any;
		assert.equal(answer.message.usage.totalTokens, target);
	}
	// W is 4000 and R is 400, so Pi compacts strictly above 3600.
	const cases: [string, number, boolean][] = [
		["64% of W", 0.64 * WINDOW, false],
		["exactly 65% of W", 0.65 * WINDOW, true],
		["one token below Pi's threshold", 0.9 * WINDOW - 1, true],
		["exactly Pi's threshold", 0.9 * WINDOW, true],
		["one token above Pi's threshold: Pi compacts in the foreground", 0.9 * WINDOW + 1, false],
	];
	for (const [name, target, starts] of cases) {
		it(`${starts ? "starts" : "does not start"} at ${name}`, async () => {
			const h = await harness();
			h.control.hold = starts;
			await sayTo(h, target);
			assert.equal(h.status.length, starts ? 1 : 0);
			assert.equal(h.summaries.length, starts ? 1 : h.compactions().length);
		});
	}
});

describe("RQW-context background compaction: incompatible Pi shape", () => {
	const good = () => ({ _runDefaultCompaction() {}, getContextUsage() {}, dispose() {} });
	const shapes: Record<string, () => object> = {
		"no summary generator": () => ({ ...good(), _runDefaultCompaction: undefined }),
		"read-only summary generator": () => Object.defineProperty(good(), "_runDefaultCompaction", { value() {}, writable: false, configurable: true }),
		"no context usage": () => ({ ...good(), getContextUsage: undefined }),
		"no dispose": () => ({ ...good(), dispose: undefined }),
	};
	for (const [name, shape] of Object.entries(shapes)) {
		it(`${name}: background stays off, Pi compacts stock at the unchanged W - R`, async () => {
			const h = await harness();
			// Installing against the odd prototype is what the extension does at load.
			installBackground(shape() as never, () => true);
			try {
				for (const percent of [0.2, 0.2, 0.2, 0.1]) await h.say(percent);
				assert.ok(h.percent() > 0.65 && h.percent() < 0.9);
				assert.deepEqual(h.status, []);
				assert.equal(h.summaries.length, 0);
				assert.equal(h.compactions().length, 0);
				await h.say(0.22);
				assert.equal(h.compactions().length, 1);
				assert.equal(h.summaries.length, 1);
				assert.deepEqual(h.status, []);
			} finally {
				installBackground(AgentSession.prototype as never, () => true);
			}
		});
	}
});

describe("RQW-context background compaction: projected snapshot", () => {
	const text = (size: number, mark = "") => mark + "y".repeat(size * 4);
	const user = (size: number, mark = "") => ({ role: "user", content: [{ type: "text", text: text(size, mark) }], timestamp: 1 });
	const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
	const assistant = (content: any[]) => ({ role: "assistant", content, api: "faux", provider: "faux", model: "m", usage, stopReason: "stop", timestamp: 1 });
	const call = (name: string, path: string, id = `${name}-${path}`) => ({ type: "toolCall", id, name, arguments: { path } });
	const result = (id: string, size: number, nested?: { name: string; arguments: unknown }[]) => ({
		role: "toolResult", toolCallId: id, toolName: "t", content: [{ type: "text", text: text(size) }], isError: false, timestamp: 1,
		...(nested ? { nestedCalls: { calls: nested } } : {}),
	});
	/** History with direct and nested file calls; returns the session and entry ids by name. */
	function history() {
		const sm = SessionManager.inMemory("/");
		const ids: Record<string, string> = {};
		const add = (name: string, message: any) => { ids[name] = sm.appendMessage(message); };
		add("u1", user(100, "first"));
		add("a1", assistant([call("read", "a.ts")]));
		add("r1", result("read-a.ts", 50));
		add("a2", assistant([call("edit", "b.ts")]));
		add("r2", result("edit-b.ts", 50, [{ name: "write", arguments: { path: "c.ts" } }, { name: "read", arguments: { path: "n.ts" } }]));
		add("u2", user(100));
		add("a3", assistant([{ type: "text", text: text(20) }]));
		return { sm, ids, add };
	}
	const fixtures: Record<string, () => SessionManager> = {
		"plain history with nested file calls": () => {
			const { sm, add } = history();
			add("u3", user(100));
			return sm;
		},
		"previous Pi compaction with a retained range and details": () => {
			const { sm, ids, add } = history();
			sm.appendCompaction("old summary", ids.a2, 500, { readFiles: ["old.ts"], modifiedFiles: ["mod.ts"] }, false);
			add("u3", user(100));
			add("a4", assistant([call("read", "d.ts")]));
			add("r4", result("read-d.ts", 50));
			add("u4", user(100));
			return sm;
		},
		"previous extension compaction: its details are not carried": () => {
			const { sm, ids, add } = history();
			sm.appendCompaction("hook summary", ids.a2, 500, { readFiles: ["old.ts"], modifiedFiles: ["mod.ts"] }, true);
			add("u3", user(100));
			add("u4", user(100));
			return sm;
		},
		"split turn": () => {
			const { sm, add } = history();
			add("u3", user(10));
			for (const n of [5, 6, 7]) {
				add(`a${n}`, assistant([call("read", `${n}.ts`)]));
				add(`r${n}`, result(`read-${n}.ts`, 100));
			}
			return sm;
		},
		"omitted and replaced messages": () => {
			const { sm, ids, add } = history();
			sm.appendContextEdit(ids.a1, null);
			sm.appendContextEdit(ids.u1, { content: [{ type: "text", text: "replaced" }] } as never);
			add("u3", user(100));
			return sm;
		},
		"recovery omission suffix": () => {
			const { sm, add, ids } = history();
			add("u3", user(100));
			add("a4", assistant([{ type: "text", text: text(10) }]));
			sm.appendContextEdit(ids.a4, null);
			return sm;
		},
		"nothing to summarize": () => {
			const sm = SessionManager.inMemory("/");
			sm.appendMessage(user(10) as never);
			return sm;
		},
	};
	const comparable = (preparation: any) => preparation && {
		...preparation, tokensBefore: 0,
		fileOps: Object.fromEntries(Object.entries(preparation.fileOps).map(([key, set]) => [key, [...(set as Set<string>)].sort()])),
	};

	for (const [name, build] of Object.entries(fixtures)) {
		it(`matches Pi's own preparation: ${name}`, () => {
			const branch = build().getBranch();
			const settings = { enabled: true, reserveTokens: 100, keepRecentTokens: 150 };
			const pi = prepareCompaction(branch, settings);
			assert.deepEqual(comparable(prepareSnapshot(branch as never, settings, 0)?.preparation), comparable(pi));
			if (name !== "nothing to summarize") assert.ok(pi);
		});
	}

	it("uses only helpers that both the npm root and the compiled bundle export", () => {
		const names = ["buildSessionProjection", "getLatestCompactionEntry", "estimateTokens", "sessionEntryToContextMessages", "shouldCompact"];
		for (const name of names) assert.equal(typeof (PiRoot as Record<string, unknown>)[name], "function", name);
		const root = dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")));
		const bundle = readFileSync(join(root, "bundle", "index.js"), "utf8");
		const exported = new Set([...bundle.matchAll(/export\s*\{([^}]*)\}/g)].flatMap((match) => match[1].split(",").map((part) => part.trim().split(/\s+as\s+/).at(-1))));
		for (const name of names) assert.ok(exported.has(name), name);
	});
});

describe("RQW-context background compaction: freshness", () => {
	type H = Awaited<ReturnType<typeof harness>>;
	const replace = (text: string) => ({ content: [{ type: "text", text }] }) as never;
	const cases: [string, boolean, (h: H) => void][] = [
		["an edited summarized input is stale", false, (h) => { h.manager.appendContextEdit(userIds(h)[0], replace("changed")); }],
		["an omitted summarized input is stale", false, (h) => {
			const answer = h.manager.getBranch().find((entry: any) => entry.type === "message" && entry.message.role === "assistant")!;
			h.manager.appendContextEdit(answer.id, null);
		}],
		["a branch switch is stale", false, (h) => { h.manager.branch(userIds(h)[1]); }],
		["an edit in the kept tail keeps it", true, (h) => { h.manager.appendContextEdit(userIds(h)[3], replace("tail")); }],
	];
	for (const [name, adopted, change] of cases) {
		it(name, async () => {
			const h = await harness();
			await toBackground(h);
			change(h);
			await h.say(0.02);
			assert.equal(h.summaries.length, 1);
			assert.equal(h.compactions().length, adopted ? 1 : 0);
		});
	}

	it("a change made by a session_before_compact handler is stale: Pi summarizes normally", async () => {
		let changed = false;
		const h = await harness({}, (pi) => pi.on("session_before_compact", () => {
			if (changed) return;
			changed = true;
			h.manager.appendContextEdit(userIds(h)[0], replace("changed"));
		}));
		await toBackground(h);
		await h.say(0.02);
		assert.equal(h.summaries.length, 2);
		assert.match(h.compactions()[0].summary, /^SUMMARY 2/);
	});

	it("a previous summary rewritten under the same id is stale", async () => {
		const h = await harness();
		await toBackground(h);
		await h.say(0.02);
		const [base] = h.compactions();
		await h.say(0.2);
		await h.say(0.2);
		await h.summary(2);
		await h.quiet();
		assert.equal(h.summaries.length, 2);
		(h.manager.getEntry(base.id) as { summary: string }).summary = "rewritten";
		await h.say(0.02);
		assert.equal(h.compactions().length, 1);
	});
});

describe("RQW-context background compaction: adoption and fallback", () => {
	it("adopts a summary that became ready while idle before the next prompt, with no new request", async () => {
		const h = await harness();
		await toBackground(h);
		const kept = userIds(h)[2];
		await h.say(0.02, "next ");
		assert.equal(h.summaries.length, 1);
		assert.equal(h.compacts.length, 1);
		const [entry] = h.compactions();
		assert.equal(entry.summary, "SUMMARY 1");
		assert.equal(entry.firstKeptEntryId, kept);
		// The kept tail, the new prompt and its answer follow the summary verbatim.
		const roles = h.manager.buildSessionProjection().messages.map((message: any) => message.role).filter((role) => role !== "system");
		assert.deepEqual(roles, ["compactionSummary", "user", "assistant", "user", "assistant", "user", "assistant"]);
		assert.match(JSON.stringify(h.manager.buildSessionProjection().messages.at(-2)), /next x/);
	});

	it("adopts at the next model call of a running turn; file lists are the snapshot's, once", async () => {
		const h = await harness();
		h.next.push(fauxAssistantMessage(fauxToolCall("read", { path: "A" })));
		await h.say(0.2);
		h.control.hold = true;
		await h.say(0.2);
		await h.say(0.2);
		await h.say(0.1);
		await h.summary(1);
		h.next.push(async () => {
			// Pi's pre-prompt check has passed: the summary becomes ready during the turn.
			h.release("BG");
			await h.quiet();
			return fauxAssistantMessage([fauxToolCall("edit", { path: "A" }), fauxToolCall("write", { path: "B" })]);
		}, fauxAssistantMessage("done"));
		await h.say(0.02);
		assert.equal(h.summaries.length, 1);
		const [entry] = h.compactions();
		assert.deepEqual(entry.details, { readFiles: ["A"], modifiedFiles: [] });
		assert.equal(entry.summary, "BG\n\n<read-files>\nA\n</read-files>");
		const branch = h.manager.getBranch() as any[];
		assert.equal(branch.at(-1).message.content[0].text, "done");
		assert.ok(branch.indexOf(entry) < branch.length - 1);
		// A later Pi compaction carries the snapshot's lists and adds the retained tail's operations.
		const later = prepareCompaction(branch, { enabled: true, reserveTokens: 100, keepRecentTokens: 1 })!;
		assert.deepEqual([...later.fileOps.read], ["A"]);
		assert.deepEqual([...later.fileOps.edited].sort(), ["A"]);
		assert.deepEqual([...later.fileOps.written], ["B"]);
	});

	for (const [name, run] of [
		["at Pi's threshold", (h: Awaited<ReturnType<typeof harness>>) => h.say(0.22)],
		["on manual compaction", (h: Awaited<ReturnType<typeof harness>>) => h.session.compact()],
	] as const) {
		it(`a summary not ready ${name} is aborted and Pi compacts normally, without waiting`, async () => {
			const h = await harness();
			h.control.hold = true;
			await toBackground(h);
			const done = run(h);
			await h.summary(2);
			assert.equal(h.summaries[0].aborted, true);
			h.release("FOREGROUND");
			await done;
			assert.equal(h.compactions().length, 1);
			assert.match(h.compactions()[0].summary, /^FOREGROUND/);
		});
	}
	it("overflow: a ready background summary is not used, Pi's normal overflow recovery summarizes", async () => {
		const h = await harness();
		h.control.hold = true;
		await h.say(0.2);
		await h.say(0.2);
		await h.say(0.2);
		await h.say(0.1);
		await h.summary(1);
		h.next.push(async () => {
			// Ready during the turn, then the provider answers with a context overflow error.
			h.release("BG");
			await h.quiet();
			h.control.hold = false;
			return fauxAssistantMessage("", { stopReason: "error", errorMessage: "prompt is too long: 300000 tokens > 200000 maximum" });
		});
		await h.say(0.02);
		assert.equal(h.summaries.length, 2);
		assert.equal(h.compactions().length, 1);
		assert.match(h.compactions()[0].summary, /^SUMMARY 2/);
		assert.ok(!JSON.stringify(h.manager.getBranch()).includes("BG"));
	});

	it("a model switch keeps the candidate: the running request goes on and the summary is adopted", async () => {
		const h = await harness();
		h.control.hold = true;
		await toBackground(h);
		await h.session.setModel(h.other as never);
		assert.equal(h.summaries[0].aborted, false);
		assert.deepEqual(h.status.map((item: any) => item.active), [true]);
		h.release("KEPT");
		await h.quiet();
		await h.say(0.02);
		assert.equal(h.summaries.length, 1);
		assert.equal(h.compactions().length, 1);
		assert.match(h.compactions()[0].summary, /^KEPT/);
	});
});
