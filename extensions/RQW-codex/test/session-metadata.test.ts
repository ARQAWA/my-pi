// Deterministic checks of the session metadata producers over real Pi SessionManagers and the pinned Codex record.
// No network, no credentials, no git reads.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { SessionManager, type AgentSession } from "@earendil-works/pi-coding-agent";
import type { Api, Context, Model } from "@earendil-works/pi-ai";

import { clientMetadata, type CodexIdentity } from "../metadata.ts";
import { inferHistoryInitialization, requestMetadata, SESSION_POLICY_METADATA } from "../session-metadata.ts";

const root = mkdtempSync(join(tmpdir(), "rqw-session-metadata-"));
after(() => rmSync(root, { recursive: true, force: true }));

let dirCounter = 0;
const newDir = () => join(root, `d${++dirCounter}`);

const MODEL = {
	id: "gpt-6.1-sol",
	name: "GPT-6.1-Sol",
	provider: "openai-codex",
	api: "openai-codex-responses",
	input: ["text", "image"],
	contextWindow: 272000,
} as unknown as Model<Api>;

const userMsg = (text: string) => ({ role: "user", content: [{ type: "text", text }], timestamp: 1700000000000 });
const agent = (manager: SessionManager) => ({ sessionId: manager.getSessionId(), sessionManager: manager }) as unknown as AgentSession;
const tool = (name: string) => ({ name, description: name, parameters: { type: "object", properties: {} } });

function identity(extra: Partial<CodexIdentity> = {}): CodexIdentity {
	return {
		installationId: "11111111-1111-4111-8111-111111111111",
		windowId: "01a16626-0000-7000-8000-000000000000:0",
		rootSessionId: "01a16626-0000-7000-8000-000000000000",
		threadId: "01a16626-0000-7000-8000-000000000000",
		...extra,
	};
}

describe("inferHistoryInitialization", () => {
	it("a fresh session with no history is new", () => {
		const manager = SessionManager.create(root, newDir());
		assert.equal(inferHistoryInitialization(agent(manager), { ownBase: false, adoptedBase: false }), "new");
	});

	it("an own base restored from the file is cold_resume", () => {
		const dir = newDir();
		const manager = SessionManager.create(root, dir);
		manager.appendMessage(userMsg("hello") as never);
		const reopened = SessionManager.open(manager.getSessionFile()!, dir);
		assert.equal(inferHistoryInitialization(agent(reopened), { ownBase: true, adoptedBase: false }), "cold_resume");
	});

	it("an adopted base of a real parent session is cold_fork", () => {
		const parentDir = newDir();
		const parent = SessionManager.create(root, parentDir);
		parent.appendMessage(userMsg("parent") as never);
		const child = SessionManager.forkFrom(parent.getSessionFile()!, root, newDir(), { id: "019a0000-0000-7000-8000-00000000000a" });
		assert.equal(inferHistoryInitialization(agent(child), { ownBase: false, adoptedBase: true }), "cold_fork");
	});

	it("a parent session without an adopted base is supplied_history", () => {
		const parent = SessionManager.create(root, newDir());
		parent.appendMessage(userMsg("parent") as never);
		const child = SessionManager.forkFrom(parent.getSessionFile()!, root, newDir(), { id: "019a0000-0000-7000-8000-00000000000b" });
		assert.equal(inferHistoryInitialization(agent(child), { ownBase: false, adoptedBase: false }), "supplied_history");
	});

	it("existing history without a base is supplied_history", () => {
		const manager = SessionManager.create(root, newDir());
		manager.appendMessage(userMsg("supplied") as never);
		assert.equal(inferHistoryInitialization(agent(manager), { ownBase: false, adoptedBase: false }), "supplied_history");
	});

	it("history that was model-visible but is all deleted now is cleared", () => {
		const manager = SessionManager.create(root, newDir());
		const id = manager.appendMessage(userMsg("DELETE-ME") as never);
		manager.appendContextEdit(id, null);
		assert.equal(inferHistoryInitialization(agent(manager), { ownBase: false, adoptedBase: false }), "cleared");
	});
});

describe("SESSION_POLICY_METADATA", () => {
	it("carries exactly the local runtime policy, with no unsupported flags", () => {
		assert.deepEqual(SESSION_POLICY_METADATA, {
			authProfile: "subscription",
			sandbox: "none",
			sandboxMode: "danger-full-access",
			autoReviewEnabled: false,
		});
		assert.equal(Object.isFrozen(SESSION_POLICY_METADATA), true);
	});

	it("does not claim Guardian or Node REPL policy", () => {
		for (const key of ["analyticsEnabled", "guardianCreditsRequested", "nodeReplAutoReviewRequired", "nodeReplDisabled"]) {
			assert.equal(Object.hasOwn(SESSION_POLICY_METADATA, key), false, key);
		}
	});
});

describe("requestMetadata", () => {
	it("exposes the public context's declared tools as harness functions, with code_mode_name absent", () => {
		const context = { systemPrompt: "sys", messages: [userMsg("hi") as never], tools: [tool("read"), tool("bash")] } as unknown as Context;
		const meta = requestMetadata(MODEL, context);
		assert.deepEqual(meta.toolNamespacesInfo, {
			functions: {
				name: "functions",
				functions: {
					bash: { name: "bash", direct: true, deferred: false, source: { kind: "harness" } },
					read: { name: "read", direct: true, deferred: false, source: { kind: "harness" } },
				},
			},
		});
		const fn = (meta.toolNamespacesInfo as Record<string, { functions: Record<string, object> }>).functions.functions.read;
		assert.equal(Object.hasOwn(fn, "code_mode_name"), false);
	});

	it("the body turn metadata serializes code_mode_name as null", () => {
		const context = { systemPrompt: "sys", messages: [userMsg("hi") as never], tools: [tool("read")] } as unknown as Context;
		const meta = requestMetadata(MODEL, context);
		const client = clientMetadata(identity({ ...meta }), "turn");
		const turn = JSON.parse(client["x-codex-turn-metadata"]);
		assert.equal(turn.tool_namespaces_info.functions.functions.read.code_mode_name, null);
		assert.deepEqual(turn.tool_namespaces_info.functions.functions.read.source, { kind: "harness" });
	});

	it("the default effort is the pinned default level when no effort is selected", () => {
		const context = { systemPrompt: "sys", messages: [], tools: [] } as unknown as Context;
		const meta = requestMetadata(MODEL, context);
		assert.deepEqual(meta.extra, { model: "gpt-6.1-sol", reasoning_effort: "low" });
	});

	it("an explicit native effort is reported as resolved", () => {
		const context = { systemPrompt: "sys", messages: [], tools: [] } as unknown as Context;
		const meta = requestMetadata(MODEL, context, { reasoningEffort: "high" });
		assert.equal(meta.extra?.reasoning_effort, "high");
	});
});
