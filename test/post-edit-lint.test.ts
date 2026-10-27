import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ExtensionAPI, ToolResultEvent } from "@earendil-works/pi-coding-agent";
import postEditLint from "../.pi/extensions/post-edit-lint/index.ts";

test("post-edit check reports lint diagnostics and stays silent when clean", async t => {
	const cwd = await mkdtemp(join(tmpdir(), "post-edit-lint-"));
	t.after(() => rm(cwd, { recursive: true, force: true }));
	await writeFile(join(cwd, "bad.ts"), "const unused = 1;\n");
	await writeFile(join(cwd, "clean.ts"), "export const answer = 42;\n");
	let hook: ((event: ToolResultEvent, ctx: unknown) => any) | undefined;
	const pi = {
		on: (name: string, handler: typeof hook) => { if (name === "tool_result") hook = handler; },
		events: { on: () => () => {} },
	};
	postEditLint(pi as unknown as ExtensionAPI, async paths => {
		const bad = paths[0].endsWith("bad.ts");
		return {
			code: bad ? 1 : 0,
			stdout: bad ? JSON.stringify({ diagnostics: [{
				filename: paths[0],
				message: "Variable 'unused' is declared but never used. Unused variables should start with a '_'.",
				labels: [{ span: { line: 1, column: 7 } }],
			}] }) : "",
			stderr: "",
		};
	});
	assert.ok(hook);
	const event = (path: string): ToolResultEvent => ({
		type: "tool_result", toolName: "edit", toolCallId: "call", input: { path },
		content: [{ type: "text", text: "Edited" }], details: { files: [{ path, ok: true }] },
		structuredContent: { preserved: true }, isError: false,
	});
	const context = { cwd, signal: new AbortController().signal };
	const bad = await hook(event("bad.ts"), context);
	assert.deepEqual(bad.details, event("bad.ts").details);
	assert.deepEqual(bad.structuredContent, { preserved: true });
	assert.equal(bad.isError, undefined);
	assert.equal(bad.content[0].text, "Edited");
	assert.match(bad.content[1].text, /^oxlint:\nbad\.ts:1:7: Variable 'unused' is declared but never used\./);
	assert.equal(await hook(event("clean.ts"), context), undefined);
});
