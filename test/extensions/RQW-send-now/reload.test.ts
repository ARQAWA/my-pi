import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { it } from "node:test";
import { AgentSession } from "@earendil-works/pi-coding-agent";
import { installQueue } from "../../../extensions/RQW-send-now/queue.ts";
import { fakeSession } from "./harness.ts";

const here = dirname(fileURLToPath(import.meta.url));
const source = join(here, "../../../extensions/RQW-send-now/queue.ts");

it("a reloaded module's queue wrappers replace the running ones and keep a running force-send", async (t) => {
	// Pi's own binding is not under test; the lease wraps this stand-in.
	t.mock.method(AgentSession.prototype as any, "_bindExtensionCore", function () {});
	const dir = mkdtempSync(join(here, ".reload-copy-"));
	const manager = { getEntries: () => [] };
	const session = fakeSession(manager, () => {});
	const leases: Array<{ release(): void }> = [];
	t.after(() => { for (const lease of leases) lease.release(); rmSync(dir, { recursive: true, force: true }); });

	const first = installQueue();
	leases.push(first);
	session._bindExtensionCore();
	const sunk: string[] = [];
	const force = first.force(manager, (steer) => { sunk.push(steer.text); return true; });
	assert.ok(force);
	await session._queueSteer("before the reload");
	assert.deepEqual(sunk, ["before the reload"]);

	// The updated module prefixes what it routes, which shows whose wrapper ran.
	const code = readFileSync(source, "utf8");
	const routed = "tracker.capture?.({ text, images: images ?? [] })";
	assert.ok(code.includes(routed));
	const file = join(dir, "queue.ts");
	writeFileSync(file, code.replace(routed, "tracker.capture?.({ text: `updated ${text}`, images: images ?? [] })"));
	const updated = await import(pathToFileURL(file).href);
	const second = updated.installQueue();
	leases.push(second);
	// The force-send of the first module is still running: its sink stays, the wrapper is the new one.
	await session._queueSteer("after the reload");
	assert.deepEqual(sunk, ["before the reload", "updated after the reload"]);

	// A session bound after the reload gets the updated wrapper too.
	const later = fakeSession(manager, () => {});
	later._bindExtensionCore();
	const laterSunk: string[] = [];
	assert.ok(second.force(manager, (steer: { text: string }) => { laterSunk.push(steer.text); return true; }));
	await later._queueSteer("new session");
	assert.deepEqual(laterSunk, ["updated new session"]);
});
