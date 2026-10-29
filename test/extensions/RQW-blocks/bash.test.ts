import assert from "node:assert/strict";
import { it } from "node:test";
import { BashExecutionComponent, initTheme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { installBash } from "../../../extensions/RQW-blocks/bash.ts";

const theme = { fg: (key: string, text: string) => `<${key}>${text}</${key}>`, bg: (key: string, text: string) => `<${key}>${text}</${key}>` } as any;
const ui = { requestRender() {} } as any;

it("renders the live command, output tail and status without duration", t => {
	t.mock.timers.enable({ apis: ["setInterval"] });
	initTheme();
	const bash = new BashExecutionComponent("npm test", ui);
	const restore = installBash(() => theme);
	try {
		assert.match(bash.render(80).join("\n"), /toolPendingBg.*\$ npm test/);
		bash.appendOutput("one\ntwo\nthree\nfour\nfive");
		let result = bash.render(80).map(stripTerminalSequences).join("\n");
		assert.doesNotMatch(result, /one/);
		assert.match(result, /two/);
		assert.match(result, /running/);
		bash.setExpanded(true);
		assert.match(bash.render(80).join("\n"), /one/);
		bash.setComplete(0, false);
		result = bash.render(80).join("\n");
		assert.match(result, /toolSuccessBg/);
		assert.match(result, /✓/);
		bash.setComplete(7, false);
		assert.match(bash.render(80).join("\n"), /✗ exit 7/);
		bash.setComplete(0, true);
		assert.match(bash.render(80).join("\n"), /aborted/);
		const excluded = new BashExecutionComponent("private", ui, true);
		try { assert.match(excluded.render(80).join("\n"), /<dim>\$ private/); }
		finally { excluded.setComplete(0, false); }
	} finally { restore(); }
	const stock = bash.render(80).map(stripTerminalSequences).join("\n");
	assert.match(stock, /\$ npm test/);
	assert.doesNotMatch(stock, /toolErrorBg/);
});

it("limits expanded output by lines and bytes and reports truncation", t => {
	t.mock.timers.enable({ apis: ["setInterval"] });
	initTheme();
	const restore = installBash(() => theme);
	try {
		const lines = new BashExecutionComponent("lines", ui);
		lines.appendOutput(Array.from({ length: 2100 }, (_, i) => `line-${i}`).join("\n"));
		lines.setComplete(0, false, undefined, "/tmp/output");
		lines.setExpanded(true);
		const result = lines.render(80).map(stripTerminalSequences).join("\n");
		assert.doesNotMatch(result, /line-0(?:\D|$)/);
		assert.match(result, /line-100(?:\D|$)/);
		assert.match(result, /line-2099/);
		assert.match(result, /Output truncated\. Full output: \/tmp\/output/);
		const bytes = new BashExecutionComponent("bytes", ui);
		bytes.appendOutput(["old-byte-marker", ...Array.from({ length: 500 }, () => "x".repeat(120)), "last-byte-marker"].join("\n"));
		bytes.setComplete(0, false);
		bytes.setExpanded(true);
		const byteResult = bytes.render(80).map(stripTerminalSequences).join("\n");
		assert.doesNotMatch(byteResult, /old-byte-marker/);
		assert.match(byteResult, /last-byte-marker/);
		assert.match(byteResult, /Output truncated\./);
	} finally { restore(); }
});

it("renders only the tail and falls back when cached component shape changes", t => {
	t.mock.timers.enable({ apis: ["setInterval"] });
	initTheme();
	const bash = new BashExecutionComponent("npm test", ui);
	const restore = installBash(() => theme);
	let fallback: string[];
	try {
		bash.appendOutput("old\ntwo\nthree\nfour\nfive\n");
		bash.setComplete(0, false);
		const tail = bash.render(80).map(stripTerminalSequences).join("\n");
		assert.doesNotMatch(tail, /old/);
		for (const line of ["two", "three", "four", "five"]) assert.match(tail, new RegExp(line));
		(bash as any).status = "new Pi status";
		fallback = bash.render(80).map(stripTerminalSequences);
	} finally { restore(); }
	assert.deepEqual(fallback, bash.render(80).map(stripTerminalSequences));
});
