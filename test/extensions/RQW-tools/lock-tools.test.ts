import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { executeEdit } from "../../../extensions/RQW-tools/edit.ts";
import { withFileLock } from "../../../extensions/RQW-tools/lock.ts";
import { executeWrite } from "../../../extensions/RQW-tools/write.ts";

for (const name of ["write", "edit"] as const) {
	test(`${name} tool respects the file lock`, async (t) => {
		const cwd = mkdtempSync(join(tmpdir(), "rqw-lock-"));
		t.after(() => rmSync(cwd, { recursive: true, force: true }));
		const path = join(cwd, "target.txt");
		writeFileSync(path, "before");
		let release!: () => void;
		let entered!: () => void;
		const ready = new Promise<void>((resolve) => { entered = resolve; });
		const gate = new Promise<void>((resolve) => { release = resolve; });
		const held = withFileLock(path, async () => { entered(); await gate; });
		await ready;
		// Fake only Pi's stock executor; keep its filesystem effect synchronous.
		const stock = async (_id: string, args: any) => {
			const content = name === "write" ? args.content
				: readFileSync(args.path, "utf8").replace(args.edits[0].oldText, args.edits[0].newText);
			writeFileSync(args.path, content);
			return { content: [] };
		};
		const params = name === "write" ? { path, content: "after" }
			: { path, edits: [{ oldText: "before", newText: "after" }] };
		const run = name === "write" ? executeWrite : executeEdit;
		const call = run(stock, name, params, undefined, undefined, { cwd }, cwd);
		try {
			await Promise.resolve();
			assert.equal(readFileSync(path, "utf8"), "before");
		} finally {
			release();
			await held;
			await call;
		}
		assert.equal(readFileSync(path, "utf8"), "after");
	});
}
