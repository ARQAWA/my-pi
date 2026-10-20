import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { editRenderers } from "../render.ts";

describe("render", () => {
	it("an edit call touching one file passes that file as path, whatever the top-level path says", () => {
		const seen: any[] = [];
		const stock = {
			renderCall: (args: any) => (seen.push(args), "call"),
			renderResult: (_r: any, _o: any, _t: any, context: any) => (seen.push(context.args), "result"),
		};
		const { renderCall, renderResult } = editRenderers(stock) as any;
		const args = { path: "a.txt", edits: [{ path: "b.txt", oldText: "x", newText: "y" }] };
		renderCall(args, {}, {});
		renderResult({}, {}, {}, { args });
		assert.deepEqual(seen.map((a) => a.path), ["b.txt", "b.txt"]);
	});
});
