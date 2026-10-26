import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import type { ExtensionAPI, ExtensionCommandContext, RegisteredCommand } from "@earendil-works/pi-coding-agent";
import { registerSessionCommands } from "../../../extensions/RQW-session/index.ts";
import { prepareRemoval, removeFiles } from "../../../extensions/RQW-session/artifacts.ts";

it("copy-session passes the exact public session id to the clipboard", async () => {
	const commands = new Map<string, RegisteredCommand>();
	const copied: string[] = [];
	const notes: string[] = [];
	registerSessionCommands({ registerCommand: (name, command) => commands.set(name, command) } as ExtensionAPI,
		async (id) => { copied.push(id); }, "unused");
	const ctx = { sessionManager: { getSessionId: () => "session-1" }, ui: { notify: (text: string) => notes.push(text) } } as ExtensionCommandContext;
	await commands.get("copy-session")!.handler("", ctx);
	assert.deepEqual(copied, ["session-1"]);
	assert.deepEqual(notes, ["Session ID copied: session-1"]);
});

async function fixture() {
	const root = await mkdtemp(join(tmpdir(), "rqw-session-"));
	const agent = join(root, "agent");
	const dir = join(agent, "sessions", "cwd");
	await mkdir(dir, { recursive: true });
	const file = join(dir, "current.jsonl");
	const other = join(dir, "other.jsonl");
	const save = (path: string, values: unknown[]) => writeFile(path, values.map((value) => JSON.stringify(value)).join("\n") + "\n");
	await save(file, [{ type: "session", id: "current" }]);
	await save(other, [{ type: "session", id: "other" }]);
	return { root, agent, dir, file, other, save, close: () => rm(root, { recursive: true, force: true }) };
}

it("remove deletes unshared artifacts and preserves shared files", async () => {
	const f = await fixture();
	try {
		const own = join(f.root, "pi-bash-00000000000000a1.log");
		const shared = join(f.root, "pi-output-00000000000000a2.log");
		await writeFile(own, "own");
		await writeFile(shared, "shared");
		await f.save(f.file, [{ fullOutputPath: own }, { fullOutputPath: shared }]);
		await f.save(f.other, [{ fullOutputPath: shared }]);
		const result = await removeFiles(await prepareRemoval(f.file, f.agent));
		assert.deepEqual(result, { artifacts: 1, children: 0 });
		assert.equal(existsSync(f.file), false);
		assert.equal(existsSync(own), false);
		assert.equal(await readFile(shared, "utf8"), "shared");
	} finally { await f.close(); }
});

it("regression 74a0d4a: late surviving references and sessions survive removal", async () => {
	const f = await fixture();
	try {
		const own = join(f.root, "pi-bash-00000000000000a1.log");
		const shared = join(f.root, "pi-output-00000000000000a2.log");
		const lateSession = join(f.dir, "pi-output-00000000000000a3.jsonl");
		await writeFile(own, "own");
		await writeFile(shared, "shared");
		await f.save(f.file, [{ fullOutputPath: own }, { fullOutputPath: shared }, { text: lateSession }]);
		const plan = await prepareRemoval(f.file, f.agent);
		await f.save(f.other, [{ fullOutputPath: shared }]);
		await f.save(lateSession, [{ type: "session", id: "late" }]);
		await removeFiles(plan);
		assert.equal(existsSync(own), false);
		assert.equal(await readFile(shared, "utf8"), "shared");
		assert.equal(existsSync(lateSession), true);
	} finally { await f.close(); }
});
