import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
const { makeStrictJsonSchema } = await import(new URL("./api/constrained-sampling.js", import.meta.resolve("@earendil-works/pi-ai")).href);
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createWebTool, type WebInput } from "../tool.ts";
import type { TargetResult, TargetRun, TargetRunner } from "../core/types.ts";

const roots: string[] = [];
after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });
const root = () => { const path = mkdtempSync(join(tmpdir(), "rqw-web-tool-")); roots.push(path); return path; };
const ok = (run: TargetRun): TargetResult => ({
	target: run.target, model: run.model, effort: run.effort, mode: run.mode, responseLength: run.responseLength,
	status: "ok", summary: `Answer for ${run.target.value}: [Docs](https://example.com/docs)`,
	sources: [{ url: "https://example.com/docs", title: "Docs" }], citations: [], actions: [], results: [],
});

function harness(caller = "anthropic/claude-sonnet-5-5", thinking = "high", runner?: TargetRunner) {
	const calls: TargetRun[] = [];
	const [provider, id] = caller.split("/");
	let model = caller ? { provider, id } : undefined;
	const tool = createWebTool({ getThinkingLevel: () => thinking as never }, {
		tmpRoot: root(), runner: async run => { calls.push(run); return runner ? runner(run) : ok(run); },
	});
	return {
		tool, calls,
		change(next: string, effort: string) { const [provider, id] = next.split("/"); model = { provider, id }; thinking = effort; },
		call: (input: WebInput, signal?: AbortSignal) => tool.execute("call", input, signal, undefined, { model } as ExtensionContext),
	};
}

const textOf = (result: Awaited<ReturnType<ReturnType<typeof harness>["call"]>>) => result.content.map(c => c.type === "text" ? c.text : "").join("\n");

describe("web tool", () => {
	it("has a strict-compatible schema without model or thinking arguments and actionable guidance", () => {
		const h = harness();
		assert.doesNotThrow(() => makeStrictJsonSchema(h.tool.parameters));
		assert.deepEqual(Object.keys(h.tool.parameters.properties), ["queries", "urls", "focus", "mode", "response_length"]);
		for (const words of ["ONE call", "untrusted", "primary sources", "subscription", "live", "read offset", "never both"]) {
			assert.ok(h.tool.description.includes(words), words);
		}
	});

	it("maps the caller automatically and uses the latest caller on the next invocation", async () => {
		const h = harness();
		const first = await h.call({ queries: ["query"] });
		assert.deepEqual(Object.keys(first), ["content"]);
		assert.match(textOf(first), /search model gpt-6-sol, effort high, mode cached/);
		assert.equal(h.calls[0].responseLength, "short");
		h.change("openai-codex/gpt-6.1-sol", "medium");
		await h.call({ queries: ["second"], mode: "live", response_length: "long" });
		assert.equal(h.calls[1].model, "gpt-6.1-sol");
		assert.equal(h.calls[1].effort, "medium");
		assert.equal(h.calls[1].mode, "live");
		assert.equal(h.calls[1].responseLength, "long");
	});

	it("falls back for unknown GPT, other providers, unknown Claude and absent models", async () => {
		for (const caller of ["openai-codex/gpt-future", "other/custom", "anthropic/claude-future", ""]) {
			const h = harness(caller, "high");
			await h.call({ queries: ["x"] });
			assert.equal(h.calls[0].model, "gpt-6.1-sol", caller);
			assert.equal(h.calls[0].effort, "low", caller);
		}
	});

	it("rejects unmapped thinking on recognized callers instead of falling back", async () => {
		const h = harness("anthropic/claude-haiku-5-5", "off");
		await assert.rejects(h.call({ queries: ["x"] }), /Unsupported/);
		assert.equal(h.calls.length, 0);
	});

	it("validates all targets before calling the runner", async () => {
		const h = harness();
		for (const input of [
			{}, { queries: [] }, { queries: [" "] }, { queries: ["ok", ""] },
			{ queries: ["x"], urls: ["https://example.com"] }, { queries: ["x"], focus: "a" },
			{ urls: ["file:///tmp/secret"] }, { urls: ["https://user:secret@example.com"] },
			{ urls: ["https://example.com"], focus: " " }, { queries: ["x"], mode: "wrong" },
		] as WebInput[]) await assert.rejects(h.call(input));
		assert.equal(h.calls.length, 0);
	});

	it("accepts omitted optional fields represented as null by strict providers", async () => {
		const h = harness();
		await h.call(h.tool.prepareArguments!({ queries: ["x"], urls: null, focus: null, mode: null, response_length: null }));
		await h.call(h.tool.prepareArguments!({ queries: null, urls: ["https://example.com"], focus: "fact", mode: null, response_length: null }));
		assert.equal(h.calls[0].mode, "cached");
		assert.equal(h.calls[0].responseLength, "short");
		assert.deepEqual(h.calls[1].target, { kind: "url", value: "https://example.com/", focus: "fact" });
	});

	it("reads normalized URLs and forwards a trimmed focus", async () => {
		const h = harness();
		await h.call({ urls: [" https://example.com "], focus: " exact fact ", mode: "indexed" });
		assert.deepEqual(h.calls[0].target, { kind: "url", value: "https://example.com/", focus: "exact fact" });
		assert.equal(h.calls[0].mode, "indexed");
	});

	it("runs independent targets together with a three-target bound and retains input order", async () => {
		const entered = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();
		let active = 0;
		let peak = 0;
		const h = harness(undefined, undefined, async run => {
			active++;
			peak = Math.max(peak, active);
			if (active === 3) entered.resolve();
			await release.promise;
			active--;
			return ok(run);
		});
		const pending = h.call({ queries: ["first", "second", "third", "fourth"] });
		await entered.promise;
		assert.equal(h.calls.length, 3);
		release.resolve();
		const text = textOf(await pending);
		assert.equal(peak, 3);
		assert.equal(h.calls.length, 4);
		assert.ok(text.indexOf("Answer for first") < text.indexOf("Answer for fourth"));
	});

	it("keeps successful siblings", async () => {
		const h = harness(undefined, undefined, async run => {
			if (run.target.value === "bad") throw new Error("network failure");
			return ok(run);
		});
		const result = await h.call({ queries: ["bad", "good"] });
		assert.match(textOf(result), /1 ok, 1 failed/);
		assert.match(textOf(result), /Answer for good/);
	});

	it("cancels an outstanding call without waiting for an uncooperative runner", async () => {
		const entered = Promise.withResolvers<void>();
		const controller = new AbortController();
		const h = harness(undefined, undefined, async () => { entered.resolve(); return new Promise(() => {}); });
		const pending = h.call({ queries: ["x"] }, controller.signal);
		await entered.promise;
		controller.abort();
		assert.match(textOf(await pending), /cancelled/);
	});

	it("gives an exact file continuation without repeating a large search", async () => {
		const h = harness(undefined, undefined, async run => ({ ...ok(run), summary: Array.from({ length: 2300 }, (_, i) => `line ${i}`).join("\n") }));
		const text = textOf(await h.call({ queries: ["large"] }));
		assert.ok(Buffer.byteLength(text) <= 48 * 1024);
		assert.ok(text.trimEnd().split("\n").length <= 2000);
		const match = /Full result: (.+)\]\n\[Continue with: read .+ offset=(\d+)\]/.exec(text);
		assert.ok(match);
		const full = readFileSync(match[1], "utf8").split("\n");
		assert.ok(full.length > 2300);
		assert.ok(Number(match[2]) < full.length);
		assert.equal(h.calls.length, 1);
	});
});
