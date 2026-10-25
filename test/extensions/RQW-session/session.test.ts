import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
	createAgentSessionFromServices, createAgentSessionRuntime, createAgentSessionServices,
	ExtensionSelectorComponent, initTheme, ModelRuntime, SessionManager, SettingsManager,
	type ExtensionAPI, type ExtensionCommandContext, type RegisteredCommand,
} from "@earendil-works/pi-coding-agent";
import { fauxProvider } from "@earendil-works/pi-ai";
import { registerSessionCommands } from "../../../extensions/RQW-session/index.ts";
import { prepareRemoval, references, regular, removeFiles } from "../../../extensions/RQW-session/artifacts.ts";

async function fixture() {
	const root = await mkdtemp(join(tmpdir(), "rqw-session spaces-"));
	const agent = join(root, "agent");
	const dir = join(agent, "sessions", "cwd");
	await mkdir(dir, { recursive: true });
	const file = join(dir, "current.jsonl");
	const header = { type: "session", version: 3, id: "current-id", cwd: root, timestamp: new Date().toISOString() };
	const save = (path: string, values: unknown[]) => writeFile(path, values.map(v => JSON.stringify(v)).join("\n") + "\n");
	await save(file, [header]);
	return { root, agent, dir, file, header, save, close: () => rm(root, { recursive: true, force: true }) };
}

function harness(agentDir: string, file?: string) {
	const commands = new Map<string, RegisteredCommand>();
	const notices: string[] = [];
	const copied: string[] = [];
	registerSessionCommands({ registerCommand: (name: string, cmd: RegisteredCommand) => commands.set(name, cmd) } as ExtensionAPI,
		async id => { copied.push(id); }, agentDir);
	let choice: string | undefined = "2. Yes";
	let keys: string[] | undefined;
	let confirmations = 0;
	let switches = 0;
	let cancelSwitch = false;
	let stale = false;
	const ui = { notify: (s: string) => notices.push(s), select: async (title: string, options: string[]) => {
		assert.equal(title, "Delete this session permanently?");
		assert.deepEqual(options, ["1. No", "2. Yes"]);
		confirmations++;
		if (!keys) return choice;
		let selected: string | undefined;
		const dialog = new ExtensionSelectorComponent(title, options, value => { selected = value; }, () => { selected = undefined; });
		try { for (const key of keys) dialog.handleInput(key); }
		finally { dialog.dispose(); }
		return selected;
	} };
	const ctx = {
		hasUI: true,
		get ui() { assert.equal(stale, false, "never access outgoing context after replacement"); return ui; },
		sessionManager: { getSessionId: () => "current-id", getSessionFile: () => file },
		newSession: async (options: any) => {
			if (cancelSwitch) return { cancelled: true };
			switches++; stale = true;
			// File deletion is checked by the persisted-session test after this replacement boundary.
			await options.withSession({ ui });
			return { cancelled: false };
		},
	} as unknown as ExtensionCommandContext;
	return { commands, notices, copied, ctx, set choice(v: string | undefined) { choice = v; }, set keys(v: string[]) { keys = v; }, set cancelSwitch(v: boolean) { cancelSwitch = v; },
		get confirmations() { return confirmations; }, get switches() { return switches; },
		call: (name: string) => commands.get(name)!.handler("", ctx) };
}

test("copy uses the clipboard boundary with the exact ID, not stock /copy", async () => {
	const h = harness("unused");
	await h.call("copy-session");
	assert.deepEqual([...h.commands.keys()], ["copy-session", "remove"]);
	assert.deepEqual(h.copied, ["current-id"]);
	assert.deepEqual(h.notices, ["Session ID copied: current-id"]);
});

test("clipboard errors do not announce success", async () => {
	const h = harness("unused");
	registerSessionCommands({ registerCommand: (name: string, cmd: RegisteredCommand) => h.commands.set(name, cmd) } as ExtensionAPI,
		async () => { throw new Error("Clipboard unavailable"); }, "unused");
	await h.call("copy-session");
	assert.match(h.notices[0], /Could not copy.*Clipboard unavailable/);
});

test("remove refuses without UI or confirmation, and respects a cancelled /new", async () => {
	const f = await fixture();
	try {
		const h = harness(f.agent, f.file);
		h.ctx.hasUI = false;
		await h.call("remove");
		assert.equal(h.confirmations, 0);
		h.ctx.hasUI = true; h.choice = "1. No";
		await h.call("remove");
		assert.equal(h.confirmations, 1);
		h.choice = "2. Yes"; h.cancelSwitch = true;
		await h.call("remove");
		assert.equal(h.switches, 0);
		assert.ok(existsSync(f.file));
	} finally { await f.close(); }
});

test("Pi selector defaults to No: Enter/Escape/cancel preserve the session; Down then Enter deletes", async () => {
	initTheme("dark", false);
	for (const keys of [["\r"], ["\u001b"], []]) {
		const f = await fixture();
		try {
			const h = harness(f.agent, f.file); h.keys = keys;
			await h.call("remove");
			assert.equal(h.confirmations, 1); assert.equal(h.switches, 0); assert.ok(existsSync(f.file));
		} finally { await f.close(); }
	}
	const f = await fixture();
	try {
		const h = harness(f.agent, f.file); h.keys = ["\u001b[B", "\r"];
		await h.call("remove");
		assert.equal(h.confirmations, 1); assert.equal(h.switches, 1); assert.equal(existsSync(f.file), false);
	} finally { await f.close(); }
});

test("remove deletes session and unshared spill/image/blob files; preserves other sessions, forks and unrelated files", async () => {
	const f = await fixture();
	try {
		const spill = join(f.root, "pi-bash-0123456789abcdef.log");
		const image = join(f.root, "pi-codemode-0123456789abcdef.png");
		const blob = join(f.root, "pi-mcp-0123456789abcdef.bin");
		const shared = join(f.root, "pi-output-0123456789abcdef.log");
		const unrelated = join(f.root, "pi-bash-fedcba9876543210.log");
		const sharedCustom = join(f.root, "pi-bash-aabbccddeeff0011.log");
		const fork = join(f.dir, "fork.jsonl");
		const other = join(f.agent, "sessions", "elsewhere", "other.jsonl");
		await mkdir(dirname(other));
		for (const path of [spill, image, blob, shared, unrelated, sharedCustom]) await writeFile(path, "private");
		await f.save(f.file, [f.header, { details: { fullOutputPath: spill }, text: `[Image saved to ${image} (image/png, 1KB)]\n[Binary resource uri (blob) saved to ${blob}]`, shared }]);
		await f.save(fork, [{ ...f.header, id: "fork", parentSession: f.file }, { details: { fullOutputPath: shared } }]);
		await f.save(other, [{ ...f.header, id: "other" }, { text: `Read this: ${sharedCustom}` }]);
		await f.save(f.file, [...(await readFile(f.file, "utf8")).trim().split("\n").map(line => JSON.parse(line)), { details: { fullOutputPath: sharedCustom } }]);
		const forkBefore = await readFile(fork, "utf8");
		const h = harness(f.agent, f.file);
		await h.call("remove");
		for (const path of [f.file, spill, image, blob]) assert.equal(existsSync(path), false, path);
		for (const path of [shared, sharedCustom, unrelated, fork, other]) assert.ok(existsSync(path), path);
		assert.equal(await readFile(fork, "utf8"), forkBefore);
		assert.equal(h.confirmations, 1);
		assert.equal(h.switches, 1);
		assert.match(h.notices[0], /Session removed: current-id \(3 artifact/);
	} finally { await f.close(); }
});

test("path safety: no traversal, outside roots, directories, leaf or escaping parent symlinks", async t => {
	const f = await fixture();
	const outside = await mkdtemp(join(tmpdir(), "rqw-outside-"));
	try {
		const target = join(outside, "private.bin"); await writeFile(target, "keep");
		const directory = join(f.agent, "directory"); await mkdir(directory);
		const traversal = join(f.agent, "..", "..", "sentinel");
		assert.equal(references({ fullOutputPath: f.agent + "/../sentinel" }, [f.agent]).size, 0);
		const parentLink = join(f.agent, "parent-link");
		await symlink(outside, parentLink, process.platform === "win32" ? "junction" : "dir");
		assert.equal(await regular(join(parentLink, "private.bin"), [f.agent]), undefined, "physical parent escape is rejected");
		const link = join(f.agent, "pi-mcp-0123456789abcdef.bin");
		try { await symlink(target, link); }
		catch (e) { if ((e as NodeJS.ErrnoException).code !== "EPERM") throw e; t.diagnostic("Windows does not permit file symlinks on this runner"); }
		await f.save(f.file, [f.header, { a: { fullOutputPath: link }, b: { fullOutputPath: directory }, c: { fullOutputPath: "/not-an-approved-root/private.bin" }, d: { fullOutputPath: traversal } }]);
		await removeFiles(await prepareRemoval(f.file, f.agent));
		assert.ok(existsSync(target)); assert.ok(existsSync(directory));
		if (existsSync(link)) assert.ok((await (await import("node:fs/promises")).lstat(link)).isSymbolicLink());
	} finally { await f.close(); await rm(outside, { recursive: true, force: true }); }
});

test("truncated JSONL lines protect shared artifacts without blocking session removal", async () => {
	const f = await fixture();
	try {
		const shared = join(f.root, "pi-bash-0123456789abcdef.log");
		const own = join(f.root, "pi-codemode-1122334455667788.txt");
		await writeFile(shared, "keep"); await writeFile(own, "remove");
		await f.save(f.file, [f.header, { fullOutputPath: shared }]);
		// Both malformed current lines and another session's truncated tail are tolerated.
		await writeFile(f.file, await readFile(f.file, "utf8") + JSON.stringify({ fullOutputPath: own }).slice(0, -1));
		const other = join(f.dir, "truncated.jsonl");
		const malformed = JSON.stringify({ text: `Read this: ${shared}` }).slice(0, -1);
		await writeFile(other, JSON.stringify({ ...f.header, id: "other" }) + "\n" + malformed);
		const h = harness(f.agent, f.file); await h.call("remove");
		assert.equal(existsSync(f.file), false); assert.equal(existsSync(own), false);
		assert.ok(existsSync(shared)); assert.ok(existsSync(other));
		assert.match(h.notices[0], /Session removed/);
	} finally { await f.close(); }
});

test("reference allowlist matches Pi's 16-hex output IDs and clipboard UUIDs exactly", () => {
	const names = ["pi-bash-0123456789abcdef.log", "pi-powershell-0123456789abcdef.log", "pi-output-0123456789abcdef.log",
		"pi-codemode-0123456789abcdef.png", "pi-mcp-0123456789abcdef.bin", "pi-clipboard-123e4567-e89b-42d3-a456-426614174000.png"];
	const paths = names.map(name => join(tmpdir(), name));
	const expected = paths.map(path => process.platform === "win32" ? path.toLowerCase() : path);
	assert.deepEqual([...references({ text: paths.join("\n") }, [tmpdir()])], expected);
	assert.equal(references({ fullOutputPath: join(tmpdir(), "pi-bash-a.log") }, [tmpdir()]).size, 0);
	assert.equal(references({ fullOutputPath: paths[0] + ".backup" }, [tmpdir()]).size, 0);
	assert.equal(references({ fullOutputPath: "/foreign-prefix" + paths[0] }, [tmpdir()]).size, 0);
	assert.deepEqual([...references({ text: `Read ${join(tmpdir(), "unrelated.txt")} and then ${paths[0]}` }, [tmpdir()])], [expected[0]]);
});

test("spoofed fullOutputPath metadata cannot delete auth, settings, custom outputs or non-Pi temp files", async () => {
	const f = await fixture();
	try {
		const keep = [join(f.agent, "auth.json"), join(f.agent, "settings.json"), join(f.agent, "custom-output.bin"), join(f.root, "private.bin"),
			join(f.root, "pi-bash-a.log"), join(f.root, "pi-bash-0123456789abcdef.log.backup")];
		for (const path of keep) await writeFile(path, "keep");
		await f.save(f.file, [f.header, ...keep.map(fullOutputPath => ({ arguments: { fullOutputPath }, details: { fullOutputPath } }))]);
		const h = harness(f.agent, f.file); await h.call("remove");
		assert.equal(existsSync(f.file), false);
		for (const path of keep) assert.equal(await readFile(path, "utf8"), "keep", path);
		assert.match(h.notices[0], /0 artifact files deleted/);
	} finally { await f.close(); }
});

test("discovery refusal happens before switching and names the offending file", async () => {
	const f = await fixture();
	try {
		const link = join(f.dir, "linked-session");
		const target = join(f.root, "target"); await mkdir(target);
		await symlink(target, link, process.platform === "win32" ? "junction" : "dir");
		const h = harness(f.agent, f.file); await h.call("remove");
		assert.equal(h.switches, 0); assert.ok(existsSync(f.file));
		assert.ok(h.notices[0].includes(link)); assert.match(h.notices[0], /Session removal refused/);
	} finally { await f.close(); }
});

test("large shared-reference scans yield to the event loop and preserve all referenced artifacts", async () => {
	const f = await fixture();
	try {
		const paths = Array.from({ length: 64 }, (_, n) => join(f.root, `pi-bash-${n.toString(16).padStart(16, "0")}.log`));
		for (const path of paths) await writeFile(path, "keep");
		await f.save(f.file, [f.header, { text: paths.join("\n") }]);
		await f.save(join(f.dir, "large.jsonl"), Array.from({ length: 2048 }, (_, n) => ({ text: paths[n % paths.length] })));
		let yielded = false;
		const immediate = setImmediate(() => { yielded = true; });
		try {
			const h = harness(f.agent, f.file); await h.call("remove");
			assert.equal(yielded, true); assert.equal(existsSync(f.file), false);
			for (const path of paths) assert.ok(existsSync(path));
		} finally { clearImmediate(immediate); }
	} finally { await f.close(); }
});

test("fresh unpersisted and in-memory sessions can be removed", async () => {
	const f = await fixture();
	try {
		for (const file of [undefined, join(f.dir, "not-created.jsonl")]) {
			const h = harness(f.agent, file); await h.call("remove");
			assert.equal(h.switches, 1); assert.match(h.notices[0], /Session removed/);
		}
	} finally { await f.close(); }
});

test("outside-agent session file is refused before switching", async () => {
	const f = await fixture();
	try {
		const file = join(f.root, "outside.jsonl"); await f.save(file, [f.header]);
		const h = harness(f.agent, file); await h.call("remove");
		assert.equal(h.switches, 0); assert.ok(existsSync(file));
		assert.match(h.notices[0], /outside Pi's agent directory/);
	} finally { await f.close(); }
});

test("real Pi runtime replacement closes the outgoing session, deletes its JSONL and starts empty", async () => {
	const f = await fixture();
	const modelRuntime = await ModelRuntime.create({ authPath: join(f.agent, "auth.json"), modelsPath: null, refreshOnCreate: false });
	const faux = fauxProvider({ api: "faux-session", provider: "test", models: [{ id: "test", contextWindow: 10000, maxTokens: 1000 }] });
	modelRuntime.registerNativeProvider(faux.provider);
	const extension = fileURLToPath(new URL("../../../extensions/RQW-session/index.ts", import.meta.url));
	const settingsManager = SettingsManager.inMemory({});
	const runtime = await createAgentSessionRuntime(async options => {
		const services = await createAgentSessionServices({ cwd: options.cwd, agentDir: options.agentDir, modelRuntime, settingsManager,
			resourceLoaderOptions: { noExtensions: true, additionalExtensionPaths: [extension], noSkills: true, noThemes: true, noContextFiles: true, noPromptTemplates: true } });
		const created = await createAgentSessionFromServices({ services, sessionManager: options.sessionManager, sessionStartEvent: options.sessionStartEvent, model: faux.getModel("test") });
		return { ...created, services, diagnostics: services.diagnostics };
	}, { cwd: f.root, agentDir: f.agent, sessionManager: SessionManager.open(f.file) });
	try {
		const oldId = runtime.session.sessionId;
		const h = harness(f.agent, f.file);
		h.ctx.newSession = options => {
			assert.ok(existsSync(f.file), "outgoing file still exists before native replacement");
			return runtime.newSession(options);
		};
		await h.call("remove");
		assert.equal(existsSync(f.file), false);
		assert.notEqual(runtime.session.sessionId, oldId);
		assert.equal(runtime.session.sessionManager.getEntries().some(e => e.type === "message"), false);
	} finally { await runtime.dispose(); await f.close(); }
});

test("remove preserves surviving references written after preflight", async t => {
	for (const fresh of [false, true]) await t.test(fresh ? "fresh generated-name session discovery" : "existing survivor late reference", async () => {
		const f = await fixture();
		const modelRuntime = await ModelRuntime.create({ authPath: join(f.agent, "auth.json"), modelsPath: null, refreshOnCreate: false });
		const faux = fauxProvider({ api: "faux-stale-session", provider: "test", models: [{ id: "test", contextWindow: 10000, maxTokens: 1000 }] });
		modelRuntime.registerNativeProvider(faux.provider);
		const shared = join(f.root, "pi-output-00000000000000a1.log");
		const own = join(f.root, "pi-bash-00000000000000a2.log");
		const childArtifact = join(f.root, "pi-mcp-00000000000000a3.bin");
		const other = join(f.dir, "other.jsonl");
		const discovered = join(f.dir, "pi-output-00000000000000a4.jsonl");
		const tree = `${f.file}.children`;
		const child = join(tree, "agent-1", "session.jsonl");
		const sidecar = join(tree, "agent-1", "meta.json");
		const lookalike = `${tree}-x`;
		const sibling = join(lookalike, "keep.jsonl");
		const bytes = Buffer.from("shared artifact\u0000unchanged\n");
		const order: string[] = [];
		let otherAfter: Buffer;
		let discoveredAfter: Buffer;
		let runtime: Awaited<ReturnType<typeof createAgentSessionRuntime>> | undefined;
		try {
			await writeFile(shared, bytes); await writeFile(own, "parent"); await writeFile(childArtifact, "child");
			await f.save(f.file, [f.header, { text: [shared, own, ...(fresh ? [discovered] : [])].join("\n") }]);
			await f.save(other, [{ ...f.header, id: "other" }]);
			const otherBefore = await readFile(other);
			await mkdir(dirname(child), { recursive: true });
			await f.save(child, [{ ...f.header, id: "child" }, { text: childArtifact }]);
			await writeFile(sidecar, "child metadata");
			await mkdir(lookalike); await f.save(sibling, [{ ...f.header, id: "lookalike" }]);
			const siblingBefore = await readFile(sibling);
			const settingsManager = SettingsManager.inMemory({});
			runtime = await createAgentSessionRuntime(async options => {
				const services = await createAgentSessionServices({ cwd: options.cwd, agentDir: options.agentDir, modelRuntime, settingsManager,
					resourceLoaderOptions: { noExtensions: true, noSkills: true, noThemes: true, noContextFiles: true, noPromptTemplates: true,
						extensionFactories: [(pi: ExtensionAPI) => {
							registerSessionCommands(pi, async () => {}, f.agent);
							pi.on("session_before_switch", async () => {
								order.push("before-switch");
								assert.deepEqual(await readFile(other), otherBefore, "survivor has no reference during preflight");
								assert.equal(existsSync(discovered), false);
							});
							pi.on("session_shutdown", async event => {
								if (event.reason !== "new") return;
								order.push("shutdown");
								SessionManager.open(other).appendCustomEntry("late-shared-reference", { fullOutputPath: shared });
								otherAfter = await readFile(other);
								if (fresh) {
									await f.save(discovered, [{ ...f.header, id: "discovered" }]);
									SessionManager.open(discovered).appendCustomEntry("late-session", { text: "surviving session" });
									discoveredAfter = await readFile(discovered);
								}
							});
						}] } });
				const created = await createAgentSessionFromServices({ services, sessionManager: options.sessionManager, sessionStartEvent: options.sessionStartEvent, model: faux.getModel("test") });
				await created.session.bindExtensions({ mode: "tui", uiContext: {
					select: async () => "2. Yes", notify: () => {},
				} as ExtensionCommandContext["ui"], commandContextActions: {
					newSession: async options => {
						order.push("after-preflight");
						return runtime!.newSession(options);
					},
				} as Parameters<typeof created.session.bindExtensions>[0]["commandContextActions"] });
				return { ...created, services, diagnostics: services.diagnostics };
			}, { cwd: f.root, agentDir: f.agent, sessionManager: SessionManager.open(f.file) });
			await runtime.session.prompt("/remove");
			assert.deepEqual(order, ["after-preflight", "before-switch", "shutdown"]);
			assert.deepEqual(await readFile(other), otherAfter!);
			assert.equal(SessionManager.open(other).getEntries().some(e => e.type === "custom" && e.customType === "late-shared-reference" && e.data.fullOutputPath === shared), true);
			for (const path of [f.file, tree, child, sidecar, own, childArtifact]) assert.equal(existsSync(path), false, path);
			assert.deepEqual(await readFile(sibling), siblingBefore);
			assert.ok(existsSync(lookalike));
			if (fresh) {
				assert.ok(existsSync(discovered), "session JSONL created after preflight must survive outgoing artifact references");
				assert.deepEqual(await readFile(discovered), discoveredAfter!);
			}
			assert.ok(existsSync(shared), "artifact referenced by surviving other.jsonl after preflight must survive");
			assert.deepEqual(await readFile(shared), bytes);
		} finally { await runtime?.dispose(); await f.close(); }
	});
});

test("remove deletes the exact `<file>.children` tree, nested descendants, sidecars and their unshared artifacts", async () => {
	const f = await fixture();
	try {
		const art = (n: string) => join(f.root, `pi-bash-${n.padStart(16, "0")}.log`);
		const [own, byChild, byGrand, both, kept, survivor] = ["1", "2", "3", "4", "5", "6"].map(art);
		for (const p of [own, byChild, byGrand, both, kept, survivor]) await writeFile(p, "x");
		const tree = `${f.file}.children`;
		const child = join(tree, "agent-1", "session.jsonl");
		const grandDir = `${child}.children`;
		const grand = join(grandDir, "agent-2", "session.jsonl");
		const sidecar = join(tree, "agent-1", "meta.json");
		await mkdir(dirname(grand), { recursive: true });
		await f.save(f.file, [f.header, { details: { fullOutputPath: own } }, { details: { fullOutputPath: both } }]);
		await f.save(child, [{ ...f.header, id: "child" }, { details: { fullOutputPath: byChild } }, { details: { fullOutputPath: both } }]);
		await f.save(grand, [{ ...f.header, id: "grand" }, { details: { fullOutputPath: byGrand } }, { details: { fullOutputPath: kept } }]);
		await writeFile(sidecar, JSON.stringify({ id: "child" }));
		// Surviving sessions: an unrelated session, and a sibling tree that only looks similar.
		const other = join(f.dir, "other.jsonl");
		const lookalike = join(f.dir, "current.jsonl.children-x", "c.jsonl");
		const otherTree = join(f.dir, "other.jsonl.children", "c.jsonl");
		await mkdir(dirname(lookalike), { recursive: true }); await mkdir(dirname(otherTree), { recursive: true });
		await f.save(other, [{ ...f.header, id: "other" }, { text: kept }]);
		await f.save(lookalike, [{ ...f.header, id: "look" }, { text: survivor }]);
		await f.save(otherTree, [{ ...f.header, id: "oc" }, { text: survivor }]);
		const h = harness(f.agent, f.file); await h.call("remove");
		for (const p of [f.file, tree, own, byChild, byGrand, both]) assert.equal(existsSync(p), false, p);
		for (const p of [kept, survivor, other, lookalike, otherTree]) assert.ok(existsSync(p), p);
		assert.match(h.notices[0], /Session removed: current-id \(4 artifact files deleted, 2 child sessions deleted\)/);
	} finally { await f.close(); }
});

test("a symlink inside or as the child tree refuses removal before switching and deletes nothing", async () => {
	for (const where of ["root", "inside"]) {
		const f = await fixture();
		const outside = await mkdtemp(join(tmpdir(), "rqw-outside-"));
		try {
			const secret = join(outside, "secret.jsonl"); await writeFile(secret, "keep");
			const tree = `${f.file}.children`;
			const art = join(f.root, "pi-bash-00000000000000aa.log"); await writeFile(art, "x");
			await f.save(f.file, [f.header, { text: art }]);
			const type = process.platform === "win32" ? "junction" : "dir";
			let link: string;
			if (where === "root") { link = tree; await symlink(outside, tree, type); }
			else { await mkdir(tree); link = join(tree, "evil"); await symlink(outside, link, type); await f.save(join(tree, "c.jsonl"), [f.header]); }
			const h = harness(f.agent, f.file); await h.call("remove");
			assert.equal(h.switches, 0); assert.match(h.notices[0], /Session removal refused/); assert.ok(h.notices[0].includes(link));
			assert.ok(existsSync(f.file)); assert.ok(existsSync(secret)); assert.ok(existsSync(art));
			if (where === "inside") assert.ok(existsSync(join(tree, "c.jsonl")));
		} finally { await f.close(); await rm(outside, { recursive: true, force: true }); }
	}
});

test("a regular file named like the child tree is refused, a missing JSONL still removes its tree", async () => {
	const f = await fixture();
	try {
		const tree = `${f.file}.children`;
		await writeFile(tree, "not a directory");
		const h = harness(f.agent, f.file); await h.call("remove");
		assert.equal(h.switches, 0); assert.ok(existsSync(f.file)); assert.ok(existsSync(tree));
		await rm(tree); await mkdir(tree); await f.save(join(tree, "c.jsonl"), [f.header]);
		await rm(f.file);
		const h2 = harness(f.agent, f.file); await h2.call("remove");
		assert.equal(h2.switches, 1); assert.equal(existsSync(tree), false);
	} finally { await f.close(); }
});
