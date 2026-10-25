// Notification waits inside the real Pi pipeline (real AgentSession, agent loop, tools, extension events) with the
// faux provider scripting the model. Proves: a pending `job wait` ends the native turn with no model request, the owner
// can write while the job runs, an owner abort leaves the background job alone, and one notification wakes the caller
// once, idle or busy. Slow commands wait for a gate file, so nothing depends on how fast the host is.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager, type AgentSession } from "@earendil-works/pi-coding-agent";
import { installRqwTools } from "../../../extensions/RQW-tools/index.ts";

const ORIGINAL_CWD = process.cwd();
const faux = fauxProvider();
let root: string;
let agentDir: string;
let modelRuntime: ModelRuntime;
let counter = 0;

before(async () => {
	root = await mkdtemp(join(tmpdir(), "rqw-notify-sdk-"));
	agentDir = join(root, "agent");
	await mkdir(agentDir, { recursive: true });
	modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: null, refreshOnCreate: false });
	modelRuntime.registerNativeProvider(faux.provider);
});
after(async () => {
	process.chdir(ORIGINAL_CWD);
	await rm(root, { recursive: true, force: true });
});

const GATED = "printf 'started\\n'; while [ ! -f gate ]; do sleep 0.02; done; printf done > done.txt";
const tool = (name: string, args: Record<string, unknown>, id: string) => fauxAssistantMessage([fauxToolCall(name, args, { id })], { stopReason: "toolUse" });
const bashGated = () => tool("bash", { command: GATED }, "b1");
const waitForJob = (extra: Record<string, unknown> = {}) => tool("job", { action: "wait", ids: ["job#1"], timeout_ms: 60000, ...extra }, "w1");
const say = (text: string) => fauxAssistantMessage(fauxText(text));

async function until(what: string, ok: () => boolean, ms = 10000) {
	const end = Date.now() + ms;
	while (!ok()) {
		if (Date.now() > end) assert.fail(`timed out waiting for ${what}`);
		await new Promise((r) => setTimeout(r, 20));
	}
}

/** A session with the extension (12 s threshold shrunk to 200 ms) and a record of its custom `job` messages. */
async function start(mode?: "print") {
	const dir = join(root, `w${counter++}`);
	await mkdir(dir, { recursive: true });
	process.chdir(dir);
	const resourceLoader = new DefaultResourceLoader({
		cwd: dir, agentDir, extensionFactories: [(pi) => installRqwTools(pi, { backgroundAfterMs: 200 })],
		noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
	});
	await resourceLoader.reload();
	assert.deepEqual(resourceLoader.getExtensions().errors, []);
	const { session } = await createAgentSession({
		cwd: dir, agentDir, model: faux.getModel(), thinkingLevel: "off", modelRuntime, resourceLoader,
		sessionManager: SessionManager.inMemory(dir),
		settingsManager: SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } }),
	});
	await session.bindExtensions({ mode: mode ?? "rpc" });
	const jobMessages: any[] = [];
	const toolResults: string[] = [];
	let settled = 0;
	session.subscribe((event: any) => {
		if (event.type === "message_end" && event.message.role === "custom" && event.message.customType === "job") jobMessages.push(event.message);
		if (event.type === "tool_execution_end") toolResults.push(event.result?.content?.map((c: any) => c.text).join("\n") ?? "");
		if (event.type === "agent_settled") settled++;
	});
	return { dir, session, jobMessages, toolResults, settled: () => settled, open: () => writeFile(join(dir, "gate"), "") };
}
type Ctx = Awaited<ReturnType<typeof start>>;
async function close({ session }: Ctx) {
	await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
	session.dispose();
	process.chdir(ORIGINAL_CWD);
}

/** Runs the first prompt: bash goes to the background, the model waits, the turn ends by itself. */
async function startWaiting(c: Ctx, extraResponses: any[] = []) {
	faux.state.callCount = 0;
	faux.setResponses([bashGated(), waitForJob(), ...extraResponses]);
	await c.session.prompt("go");
	assert.equal(faux.state.callCount, 2, "the waiting turn ended without a model request of its own");
	assert.match(c.toolResults.at(-1)!, /"reason":"waiting"/);
	assert.equal(c.jobMessages.length, 0);
}

describe("notification wait in a real session", () => {
	it("the turn ends at `waiting`; the owner writes meanwhile; one notification wakes the idle caller once", async () => {
		const c = await start();
		try {
			await startWaiting(c, [say("hi owner"), say("job noticed")]);
			await c.session.prompt("hello while the job runs");
			assert.equal(faux.state.callCount, 3);
			assert.equal(existsSync(join(c.dir, "done.txt")), false);
			await c.open();
			await until("the notification turn", () => c.jobMessages.length === 1 && faux.state.callCount === 4 && c.settled() === 3);
			assert.match(c.jobMessages[0].content, /^\[job\] .*"reason":"exit".*"exit_code":0/);
			assert.equal(existsSync(join(c.dir, "done.txt")), true);
			await new Promise((r) => setTimeout(r, 300));
			assert.equal(c.jobMessages.length, 1, "one wake only");
			assert.equal(faux.state.callCount, 4);
		} finally { await close(c); }
	});

	it("an owner abort of a later run leaves the background job alone and its notification still arrives", async () => {
		const c = await start();
		try {
			const stall = Promise.withResolvers<void>();
			let streaming = false;
			await startWaiting(c, [async () => { streaming = true; await stall.promise; return say("never shown"); }, say("job noticed")]);
			const owner = c.session.prompt("owner writes");
			await until("the owner run to stream", () => streaming);
			const aborting = c.session.abort();
			stall.resolve();
			await aborting;
			await owner.catch(() => {});
			await c.open();
			await until("the notification turn", () => c.jobMessages.length === 1 && faux.state.callCount === 4);
			assert.equal(existsSync(join(c.dir, "done.txt")), true, "the job was not killed by the abort");
		} finally { await close(c); }
	});

	it("a job that ends while the caller is busy is delivered once at the settlement boundary", async () => {
		const c = await start();
		try {
			const stall = Promise.withResolvers<void>();
			let streaming = false;
			await startWaiting(c, [async () => { streaming = true; await stall.promise; return say("owner answer"); }, say("job noticed")]);
			const owner = c.session.prompt("owner writes");
			await until("the owner run to stream", () => streaming);
			await c.open();
			await until("the job to end", () => existsSync(join(c.dir, "done.txt")));
			await new Promise((r) => setTimeout(r, 400));
			assert.equal(c.jobMessages.length, 0, "held while the caller is busy");
			stall.resolve();
			await owner;
			await until("the continuation turn", () => c.jobMessages.length === 1 && faux.state.callCount === 4 && c.settled() === 2);
			assert.equal(c.jobMessages.length, 1);
		} finally { await close(c); }
	});

	for (const mode of ["print", undefined] as const) {
		it(`${mode ?? "rpc"} mode: wait uses the host's existing delivery path`, async () => {
			const c = await start(mode);
			try {
				faux.state.callCount = 0;
				faux.setResponses([bashGated(), waitForJob(), say("done")]);
				const run = c.session.prompt("go");
				if (mode === "print") {
					setTimeout(() => void c.open(), 500);
					await run;
					assert.equal(faux.state.callCount, 3);
					assert.match(c.toolResults.at(-1)!, /"reason":"exit".*"exit_code":0/);
					assert.equal(c.jobMessages.length, 0);
				} else {
					await run;
					assert.equal(faux.state.callCount, 2);
					assert.match(c.toolResults.at(-1)!, /"reason":"waiting"/);
					assert.equal(c.jobMessages.length, 0);
					await c.open();
					await until("the notification turn", () => c.jobMessages.length === 1 && c.settled() === 2);
					assert.equal(faux.state.callCount, 3);
					assert.match(c.jobMessages[0].content, /"reason":"exit".*"exit_code":0/);
				}
			} finally { await close(c); }
		});
	}
});
