import assert from "node:assert/strict";
import { test } from "node:test";
import { renderAgentResult } from "../../../extensions/RQW-agent/render.ts";
import { FOLLOW_UP } from "../../../extensions/RQW-agent/prompt.ts";

test("standalone agent wait hides the reminder without changing model content", () => {
	const raw = JSON.stringify({ results: [{ id: "agent#1", text: `Answer\n\n${FOLLOW_UP}` }] });
	const result = { content: [{ type: "text", text: raw }], details: {} };
	const theme = { fg: (_role: string, text: string) => text };
	for (const expanded of [false, true]) {
		const rows = renderAgentResult(result as never, { expanded, isPartial: false }, theme as never,
			{ args: { action: "wait" } } as never).render(300).join("\n");
		assert.match(rows, /Answer/);
		assert.doesNotMatch(rows, /follow-up actions/);
	}
	assert.equal(result.content[0].text, raw);
});
