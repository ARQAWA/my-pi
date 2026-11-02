import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, it } from "node:test";
import { AgentSessionRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import { moveToTemp } from "../../../extensions/RQW-cwd/move.ts";

let root: string, home: string, target: string, agentDir: string;
let events: string[];
let dirs: string[];
const platform = process.platform === "win32" ? "win32" : "darwin";

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "rqw-cwd-"));
	home = join(root, "home");
	target = join(root, "temp");
	agentDir = join(root, "agent");
	events = [];
	dirs = [];
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

const chdir = (dir: string) => { dirs.push(dir); };

/** Pi's session and services, reduced to what AgentSessionRuntime touches. */
function created(cwd: string, sessionManager: SessionManager) {
	const session = {
		sessionManager,
		sessionFile: sessionManager.getSessionFile(),
		abort: async () => undefined,
		dispose: () => { events.push(`dispose ${sessionManager.getCwd()}`); },
		extensionRunner: { hasHandlers: () => true, emit: async (event: { type: string; reason: string }) => { events.push(`${event.type} ${event.reason}`); } },
	};
	return { session, services: { cwd, agentDir }, diagnostics: [] };
}

function runtime(sessionManager: SessionManager, failIn?: string) {
	const factory = async ({ cwd, sessionManager: manager }: { cwd: string; sessionManager: SessionManager }) => {
		events.push(`create ${cwd}`);
		if (cwd === failIn) throw new Error("broken resources");
		return created(cwd, manager);
	};
	const first = created(sessionManager.getCwd(), sessionManager);
	return new AgentSessionRuntime(first.session as never, first.services as never, factory as never);
}

const defaultDir = (cwd: string) => join(agentDir, "sessions", `--${resolve(cwd).replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`);

it("a chat started in the home folder becomes a new temp chat in the temp history group", async () => {
	const host = runtime(SessionManager.create(home, defaultDir(home)));
	assert.equal(await moveToTemp(host, { platform, home, target, chdir }), undefined);
	assert.deepEqual(dirs, [target]);
	assert.deepEqual(events, ["session_shutdown new", `dispose ${resolve(home)}`, `create ${target}`]);
	assert.equal(host.cwd, target);
	assert.equal(host.session.sessionManager.getCwd(), resolve(target));
	assert.equal(host.session.sessionManager.getSessionDir(), defaultDir(target));
	assert.equal(host.session.sessionManager.isPersisted(), true);
});

it("an explicit history folder and an in-memory chat keep their kind", async () => {
	const explicit = join(root, "history");
	const persisted = runtime(SessionManager.create(home, explicit));
	await moveToTemp(persisted, { platform, home, target, chdir });
	assert.equal(persisted.session.sessionManager.getSessionDir(), explicit);
	const memory = runtime(SessionManager.inMemory(join(home, "Downloads")));
	await moveToTemp(memory, { platform, home, target, chdir });
	assert.equal(memory.cwd, target);
	assert.equal(memory.session.sessionManager.isPersisted(), false);
});

it("a project folder and a subfolder of home stay untouched", async () => {
	const host = runtime(SessionManager.inMemory(join(home, "project")));
	assert.equal(await moveToTemp(host, { platform, home, target, chdir }), undefined);
	assert.deepEqual([dirs, events], [[], []]);
	assert.equal(host.cwd, join(home, "project"));
});

it("a failed rebuild returns to the original chat in its own folder with a warning", async () => {
	const manager = SessionManager.inMemory(home);
	const host = runtime(manager, target);
	const result = await moveToTemp(host, { platform, home, target, chdir });
	assert.match(result ?? "", /broken resources.*stays in/);
	assert.deepEqual(dirs, [target, home]);
	assert.deepEqual(events.slice(-2), [`create ${target}`, `create ${home}`]);
	assert.equal(host.cwd, home);
	assert.equal(host.session.sessionManager, manager);
});

it("a failed chdir and an unknown runtime shape keep the stock chat with a warning", async () => {
	const host = runtime(SessionManager.inMemory(home));
	const failing = (dir: string) => { if (dir === target) throw new Error("EACCES"); dirs.push(dir); };
	assert.match(await moveToTemp(host, { platform, home, target, chdir: failing }) ?? "", /EACCES/);
	assert.deepEqual(events, []);
	assert.equal(host.cwd, home);
	assert.match(await moveToTemp({ cwd: home }, { platform, home, target, chdir }) ?? "", /unsupported Pi version/);
	assert.match(await moveToTemp(undefined, { platform, home: process.cwd(), target, chdir }) ?? "", /unsupported Pi version/);
	assert.equal(await moveToTemp(undefined, { platform, home, target, chdir }), undefined);
	const resumed = { session: { sessionManager: SessionManager.inMemory(home) } };
	assert.match(await moveToTemp(resumed, { platform, home, target, chdir }) ?? "", /unsupported Pi version/);
	assert.match(await moveToTemp(host, { platform, home, target, chdir }, false) ?? "", /unsupported Pi version/);
	const odd = { session: { sessionManager: { getCwd: 5 } } };
	assert.match(await moveToTemp(odd, { platform, home: process.cwd(), target, chdir }) ?? "", /unsupported Pi version/);
	assert.equal(host.cwd, home);
	assert.deepEqual(dirs, [home]);
});
