// The offered `review` of a subagent, in real Pi sessions: this test loads only RQW-review. The subagent is a child session
// that receives the review offer on the parent's bus, as RQW-agent hands it over; the reviewer's policy request must go to
// the parent's bus, name the child as its caller, and carry the prompt the provider actually receives. A stand-in listener
// on the parent bus plays the RQW-codex binder; the child's own bus gets no request. Only the network is replaced.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import {
	createAgentSession, DefaultResourceLoader, type EventBus, type ExtensionAPI, ModelRuntime, SessionManager, SettingsManager,
} from "@earendil-works/pi-coding-agent";

import { REVIEWER } from "../index.ts";
import { codexAuth, installCodexWire } from "./codex-wire.ts";

const EXTENSION = join(import.meta.dirname, "..", "index.ts");
let root: string;
let counter = 0;
const codex = installCodexWire();
const { wire } = codex;

before(async () => { root = await mkdtemp(join(tmpdir(), "rqw-review-startup-")); });
after(async () => { codex.restore(); await rm(root, { recursive: true, force: true }); });

/** The system text of a Codex request as the provider received it. */
const systemOf = (body: Record<string, any>): string => body.instructions;

const until = async (check: () => boolean, what: string) => {
	const deadline = Date.now() + 60_000;
	while (!check()) {
		assert.ok(Date.now() < deadline, `timed out waiting for ${what}`);
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
};

type Request = { session: { sessionManager: { getSessionId(): string } } & object; parentThreadId: string; kind: string; startupSystemPrompt?: string; childName?: string; release?: () => void };

/** The main session with RQW-review loaded; its bus is the parent bus of the offered subagent review. */
async function openMain() {
	const dir = join(root, `w${counter++}`);
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, "auth.json"), JSON.stringify(codexAuth()));
	const runtime = await ModelRuntime.create({ authPath: join(dir, "auth.json"), modelsPath: null, refreshOnCreate: false });
	await runtime.refresh({ allowNetwork: false });
	const main = fauxProvider({ provider: `startup-review-${counter}`, api: `startup-review-${counter}`, models: [{ id: "claude-main", reasoning: true }] });
	main.setResponses(Array.from({ length: 20 }, () => () => fauxAssistantMessage("main ok")));
	runtime.registerNativeProvider(main.provider);
	let parent: EventBus | undefined;
	const seen: Request[] = [];
	const binder = (pi: ExtensionAPI) => {
		parent = pi.events;
		pi.events.on("rqw-codex:session-policy", (raw) => {
			const request = raw as Request;
			seen.push(request);
			request.release = () => {};
		});
	};
	const loader = new DefaultResourceLoader({ cwd: dir, agentDir: dir, additionalExtensionPaths: [EXTENSION],
		extensionFactories: [binder], noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
	await loader.reload();
	assert.deepEqual(loader.getExtensions().errors, []);
	const { session } = await createAgentSession({ cwd: dir, agentDir: dir, modelRuntime: runtime, model: main.getModel("claude-main"), thinkingLevel: "off",
		resourceLoader: loader, sessionManager: SessionManager.inMemory(dir),
		settingsManager: SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false }, transport: "sse" }) });
	await session.bindExtensions({ mode: "tui" });
	const close = async () => { await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" }); session.dispose(); };
	return { session, runtime, seen, close, parentBus: () => parent! };
}

describe("RQW-review: the offered review of a subagent binds to the parent's bus", () => {
	it("a reviewer of an offered child is announced on the parent bus, named review#1, under the child's session id, with its real prompt", async () => {
		wire.length = 0;
		const m = await openMain();
		const childSeen: Request[] = [];
		try {
			// The offer exactly as RQW-agent makes it: the child's registrar is called with the parent's bus.
			let register: ((child: ExtensionAPI, host: { events: EventBus; fast: () => boolean; signal?: AbortSignal }) => void) | undefined;
			m.parentBus().emit("rqw-review:subagent-review", { offer: (r: typeof register) => { register = r; } });
			assert.ok(register, "RQW-review answers the offer");
			const childLoader = new DefaultResourceLoader({ cwd: root, agentDir: root, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
				extensionFactories: [(sub: ExtensionAPI) => {
					sub.events.on("rqw-codex:session-policy", (raw) => { childSeen.push(raw as Request); });
					register!(sub, { events: m.parentBus(), fast: () => false });
				}] });
			await childLoader.reload();
			const child = await createAgentSession({ cwd: root, agentDir: root, modelRuntime: m.runtime, model: m.session.model!,
				thinkingLevel: "off", sessionManager: SessionManager.inMemory(root),
				resourceLoader: childLoader,
				settingsManager: SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false }, transport: "sse" }) });
			await child.session.bindExtensions({ mode: "tui" });
			const result = await child.session.getToolDefinition("review")!.execute("t", { level: "blind", object: "a.ts", criterion: "c" } as never,
				undefined, undefined, child.session.extensionRunner.createContext());
			assert.match(result.content.map((c) => (c.type === "text" ? c.text : "")).join(""), /review#1 started/);
			await until(() => wire.length === 1, "the reviewer's request");
			await until(() => m.seen.length === 1, "the policy request on the parent bus");
			assert.equal(childSeen.length, 0, "the child's own bus receives no request");
			const [request] = m.seen;
			assert.equal(request.kind, "review");
			assert.equal(request.childName, "review#1");
			assert.equal(request.parentThreadId, child.session.sessionManager.getSessionId(), "the caller is the child session");
			assert.notEqual(request.parentThreadId, m.session.sessionManager.getSessionId(), "not the main session");
			assert.equal(request.startupSystemPrompt, systemOf(wire[0].body), "the startup prompt is exactly what the provider received");
			assert.ok(request.startupSystemPrompt?.startsWith(REVIEWER), "the startup prompt starts with REVIEWER");
			assert.equal(request.startupSystemPrompt!.split(REVIEWER).length - 1, 1, "REVIEWER appears once");
			child.session.dispose();
		} finally { await m.close(); }
	});
});
