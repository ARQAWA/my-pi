import assert from "node:assert/strict";
import { it } from "node:test";
import { AssistantMessageComponent, initTheme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { installThinking } from "../../../extensions/RQW-blocks/thinking.ts";

const plain = (component: AssistantMessageComponent) => component.render(80).map(stripTerminalSequences).map(line => line.trim());
const message = (content: unknown[], stopReason = "stop") => ({ role: "assistant", content, stopReason, usage: {}, timestamp: 0 } as any);

it("removes hidden thinking rows and spacing while keeping shown thinking and restoring stock", () => {
	initTheme();
	const component = new AssistantMessageComponent(message([
		{ type: "thinking", thinking: "first thought" }, { type: "text", text: "first answer" },
		{ type: "thinking", thinking: "second thought" }, { type: "toolCall", id: "x", name: "bash", arguments: {} },
		{ type: "text", text: "second answer" }, { type: "thinking", thinking: "third thought" },
	]), true);
	const stock = plain(component);
	assert.ok(stock.some(line => line.includes("Thinking")));
	const restore = installThinking();
	try {
		assert.deepEqual(plain(component), ["", "first answer", "second answer"]);
		component.setHideThinkingBlock(false);
		assert.ok(plain(component).some(line => line.includes("first thought")));
		component.setHideThinkingBlock(true);
		assert.deepEqual(plain(component), ["", "first answer", "second answer"]);
	} finally { restore(); }
	assert.deepEqual(plain(component), stock);
});

it("does not leave a blank row before an error or length status after hidden thinking", () => {
	initTheme();
	const restore = installThinking();
	try {
		for (const reason of ["error", "length", "aborted"]) {
			const component = new AssistantMessageComponent(message([{ type: "thinking", thinking: "private" }], reason), true);
			const lines = plain(component);
			assert.equal(lines.length, 1, reason);
			assert.match(lines[0], reason === "length" ? /truncated/ : reason === "error" ? /Error/ : /aborted/);
		}
	} finally { restore(); }
});
