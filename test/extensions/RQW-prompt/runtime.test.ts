import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { once, start } from "./fixture.ts";

it("SDK systemPromptOverride takes priority on repeat and reload", async () => {
	const run = await start({ systemPromptOverride: () => "SDK_OVERRIDE_SENTINEL" });
	try {
		for (let turn = 0; turn < 3; turn++) {
			if (turn === 2) await run.session.reload();
			const got = await run.capture();
			once(got.prompt, "SDK_OVERRIDE_SENTINEL");
			assert.doesNotMatch(got.prompt, /You are a coding agent in pi|<workstation>/);
		}
	} finally { await run.close(); }
});

it("actual SDK turns refresh programs after install and deletion in the same PATH directory", async () => {
	const run = await start();
	const bin = await mkdtemp(join(tmpdir(), "rqw-prompt-runtime-path-"));
	const oldPath = process.env.PATH;
	process.env.PATH = bin;
	try {
		assert.match((await run.capture()).prompt, /programs on PATH: none found\./);
		const executable = join(bin, process.platform === "win32" ? "node.exe" : "node");
		await writeFile(executable, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
		await chmod(executable, 0o755);
		assert.match((await run.capture()).prompt, /programs on PATH: node\./);
		await rm(executable);
		assert.match((await run.capture()).prompt, /programs on PATH: none found\./);
	} finally {
		if (oldPath === undefined) delete process.env.PATH; else process.env.PATH = oldPath;
		await run.close(); await rm(bin, { recursive: true, force: true });
	}
});

it("actual SDK turns refresh the explicitly UTC date without changing calendar policy", async () => {
	const run = await start();
	const RealDate = Date; const oldTZ = process.env.TZ;
	let instant = "2026-10-21T22:30:00.000Z";
	globalThis.Date = class extends RealDate { constructor(value?: string | number) { super(value ?? instant); } } as DateConstructor;
	process.env.TZ = "Europe/Moscow";
	try {
		assert.equal(new Date().getDate(), 22);
		assert.match((await run.capture()).prompt, /Today \(UTC\): 2026-10-21\./);
		instant = "2026-10-22T22:30:00.000Z";
		assert.equal(new Date().getDate(), 23);
		assert.match((await run.capture()).prompt, /Today \(UTC\): 2026-10-22\./);
	} finally {
		globalThis.Date = RealDate;
		if (oldTZ === undefined) delete process.env.TZ; else process.env.TZ = oldTZ;
		await run.close();
	}
});
