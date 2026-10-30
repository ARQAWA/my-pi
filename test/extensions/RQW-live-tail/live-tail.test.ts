import assert from "node:assert/strict";
import { it } from "node:test";
import { AssistantMessageComponent, initTheme, type ExtensionAPI, type MarkdownTransformer } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import liveTail from "../../../extensions/RQW-live-tail/index.ts";

it("renders the streaming status in the current dim colour and preserves finished text", () => {
	// Force truecolor so dark and light dim colours differ on every runner (256-colour mode maps both to one value).
	const savedColorterm = process.env.COLORTERM;
	process.env.COLORTERM = "truecolor";
	initTheme();
	let transform!: MarkdownTransformer;
	let start!: (_event: unknown, context: unknown) => void;
	liveTail({
		registerMarkdownTransformer: (value: MarkdownTransformer) => { transform = value; },
		on: (_event: string, handler: typeof start) => { start = handler; },
	} as unknown as ExtensionAPI);
	const themeKey = Symbol.for("@earendil-works/pi-coding-agent:theme");
	const currentTheme = () => (globalThis as any)[themeKey] as { fg: (role: string, text: string) => string };
	const ui = { get theme() { return currentTheme(); } };
	start({}, { ui });
	const message = { role: "assistant", content: [{ type: "text", text: "Finished answer" }], stopReason: "stop", usage: {}, timestamp: 0 } as any;
	const component = new AssistantMessageComponent(undefined, false, undefined, undefined, undefined, [transform]);
	component.updateContent(message, true);
	try {
		let previous = "";
		for (const name of ["dark", "light"]) {
			initTheme(name);
			const expected = currentTheme().fg("dim", "writing answer");
			assert.notEqual(expected, previous);
			previous = expected;
			component.invalidate();
			const line = component.render(80).find(value => stripTerminalSequences(value).includes("writing answer"));
			assert.ok(line);
			assert.equal(stripTerminalSequences(line).trim(), "writing answer");
			assert.ok(line.includes(expected));
			assert.doesNotMatch(line, /\x1b\[3m/);
		}
		component.updateContent(message, false);
		assert.ok(component.render(80).some(line => stripTerminalSequences(line).trim() === "Finished answer"));
		const context = (messageType: "user" | "assistant-thinking") => ({ messageType, isStreaming: true, availableWidth: 80 });
		assert.equal(transform("original", context("user")), "original");
		assert.equal(transform("original", context("assistant-thinking")), "original");
	} finally {
		if (savedColorterm === undefined) delete process.env.COLORTERM;
		else process.env.COLORTERM = savedColorterm;
		initTheme();
	}
});
