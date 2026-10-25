// Adapter-vs-native differential over pinned Codex 0.163.0 oracle captures (test/fixtures/native-differential.json,
// produced by scripts/pin-native-differential.mjs from the normal codex-oracle CI artifact named in its provenance).
// Each case replays the native server responses at the wire level into the real RQW-codex extension inside a real Pi
// AgentSession: the captured scripted SSE bodies (in native sse() text), plus the non-SSE responses of the cited native
// test (HTTP status, headers, body). The real SSE client (sse.ts) parses them through an injected fetch. The requests the
// adapter sends are projected by the same function as the native captures (test/native-differential.mjs) and must be
// equal: transport, endpoint, turn-state replay, request kind and compaction block, turn grouping, exact-body retries
// and the conversation (server items literal, client items by type/role/call id).
// Active adapter loop: the transport and retry cases only. The three native compaction cases stay in the fixture, the
// pin script and the oracle workflow unchanged, but the adapter no longer reproduces native compaction (no backend
// compaction request, no opaque checkpoint, no compaction metadata block); stock Pi compaction is covered by
// test/standard-compaction.test.ts.
// Fake OAuth JWT, temporary agent directory, no network, no real waiting (sleep is recorded).
import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as zlib from "node:zlib";
import { describe, it } from "node:test";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";

import { installRuntimeAuth } from "../../../extensions/RQW-codex/auth-runtime.ts";
import { createCodexExtension } from "../../../extensions/RQW-codex/index.ts";
import { CODEX_PROVIDER } from "../../../extensions/RQW-codex/profile.ts";
import { SocketError } from "../../../extensions/RQW-codex/websocket.ts";
import { nativeSseText, projectSequence } from "./native-differential.mjs";
import { driftOf } from "../../../extensions/RQW-codex/scripts/pin-native-differential.mjs";

type Stimulus = { script?: number; status?: number; headers?: Record<string, string>; body?: string };
type Case = {
	id: string;
	area: "transport" | "retry" | "compaction";
	test: string;
	capturePrefix: string;
	source: string[];
	prompts: string[];
	steps: string[];
	upgrade: "none" | number;
	providerRetries?: { requestMaxRetries?: number; streamMaxRetries?: number };
	/** Native compaction limit: fixture provenance only, no active adapter case replays it. */
	autoCompactTokenLimit?: number;
	expectError?: boolean;
	/** Half-open [min, max) ms ranges, one per retry wait, in order (source-backed, see sleepSource). */
	expectedSleeps: Array<[number, number]>;
	sleepSource: string;
	/** Upgrade attempts and POSTs in native order, for the explicit WebSocket fallback cases (see timelineSource). */
	nativeTimeline?: Array<"upgrade" | "http">;
	timelineSource?: string;
	responses: Stimulus[];
	scripts: Array<Array<Record<string, unknown>>>;
	native: Array<Record<string, unknown>>;
	nativeContentEncoding?: Array<string | null>;
	captures: Array<{ file: string; sha256: string; rawSha256: string }>;
};

const FIXTURE = JSON.parse(readFileSync(new URL("./fixtures/native-differential.json", import.meta.url), "utf8")) as {
	schema: string;
	provenance: { oracleRun: string; codexCommit: string; artifact: string; sourceSha256: Record<string, string> };
	cases: Case[];
};

const ACCOUNT = "acct_native_differential_1";
const INSTALLATION = "11111111-2222-4333-8444-555555555555";
const SLUG = "gpt-6.1-sol";
const CASE_TIMEOUT_MS = 20_000;
const SYSTEM_PROMPT = "Native differential.";
/** Native compaction cases: pinned fixture and oracle data, not replayed against the stock-compaction adapter. */
const NATIVE_COMPACTION_CASES = ["compaction-manual-stream-retry-budget", "compaction-manual-http-retry-after", "compaction-mid-turn-turn-state"];

function b64url(value: unknown): string {
	return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function fakeAccess(): string {
	const exp = Math.floor(Date.now() / 1000) + 3600;
	return `${b64url({ alg: "none" })}.${b64url({ exp, "https://api.openai.com/auth": { chatgpt_account_id: ACCOUNT } })}.sig`;
}

type Sent = { transport: "http"; url: string; headers: Array<[string, string]>; body: Record<string, unknown> };

/** Wire-level native server: the n-th POST gets the n-th native response of the case. Extra requests fail the case. */
function nativeServer(entry: Case) {
	const sent: Sent[] = [];
	const encodings: Array<string | null> = [];
	// Upgrade attempts and POSTs in the order the adapter made them.
	const timeline: Array<"upgrade" | "http"> = [];
	const fetch = async (url: string, init: RequestInit): Promise<Response> => {
		timeline.push("http");
		const headers = [...new Headers(init.headers as HeadersInit).entries()] as Array<[string, string]>;
		const encoding = headers.find(([name]) => name === "content-encoding")?.[1] ?? null;
		const bytes = Buffer.from(init.body as Uint8Array);
		const text = encoding === "zstd" ? zlib.zstdDecompressSync(bytes).toString("utf8") : bytes.toString("utf8");
		sent.push({ transport: "http", url, headers, body: JSON.parse(text) as Record<string, unknown> });
		encodings.push(encoding);
		const step = entry.responses[sent.length - 1];
		if (step === undefined) return new Response("unscripted request", { status: 418 });
		if (step.script !== undefined) {
			return new Response(nativeSseText(entry.scripts[step.script]!), { status: 200, headers: { "content-type": "text/event-stream", ...(step.headers ?? {}) } });
		}
		return new Response(step.body ?? "", { status: step.status ?? 200, headers: step.headers ?? {} });
	};
	// The native HTTP-only provider never upgrades; the adapter's upgrade is answered 426 so it takes the HTTP path at once.
	const status = entry.upgrade === "none" ? 426 : entry.upgrade;
	let upgrades = 0;
	const connect = async (): Promise<never> => {
		upgrades++;
		timeline.push("upgrade");
		throw new SocketError(status, {}, `upgrade answered ${status}`, "upgrade-rejected");
	};
	return { sent, encodings, timeline, fetch, connect, upgrades: () => upgrades };
}

async function runCase(entry: Case) {
	assert.notEqual(entry.area, "compaction", `${entry.id}: native compaction is not replayed by the adapter`);
	const root = await mkdtemp(join(tmpdir(), "rqw-codex-native-differential-"));
	const server = nativeServer(entry);
	const sleeps: number[] = [];
	// Injected advancing clock: a recorded wait moves it, so server deadlines (Retry-After) give exact delays.
	let now = Date.now();
	const outcome: { errors: string[] } = { errors: [] };
	try {
		const agentDir = join(root, "agent");
		await mkdir(agentDir, { recursive: true });
		const exp = Math.floor(Date.now() / 1000) + 3600;
		const authPath = join(agentDir, "auth.json");
		await writeFile(authPath, JSON.stringify({ [CODEX_PROVIDER]: { type: "oauth", access: fakeAccess(), refresh: "refresh-native-differential", expires: exp * 1000, accountId: ACCOUNT } }));
		const runtime = await ModelRuntime.create({ authPath, modelsPath: null, refreshOnCreate: false });
		const loader = new DefaultResourceLoader({
			cwd: agentDir, agentDir, additionalExtensionPaths: [], noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
			// A short prompt and no tools: the native prompt and tools are not part of the comparison.
			systemPrompt: SYSTEM_PROMPT,
			extensionFactories: [createCodexExtension({
				installationId: INSTALLATION,
				dependencies: {
					connect: server.connect as never,
					fetch: server.fetch,
					sleep: async (ms: number) => {
						sleeps.push(ms);
						now += ms;
					},
					random: () => 0.5,
					clock: { now: () => now },
					providerRetries: entry.providerRetries,
				},
			})],
		});
		await loader.reload();
		assert.deepEqual(loader.getExtensions().errors, []);
		const release = installRuntimeAuth(runtime);
		try {
			const listed = runtime.getModels(CODEX_PROVIDER).find((m) => m.id === SLUG);
			assert.ok(listed, `model ${SLUG} is listed`);
			// Pi compaction is off: the transport and retry cases must not meet a stock summary request.
			const { session } = await createAgentSession({
				cwd: agentDir, agentDir, modelRuntime: runtime, model: listed as never, thinkingLevel: "off", resourceLoader: loader, noTools: "all",
				sessionManager: SessionManager.inMemory(agentDir),
				settingsManager: SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } }),
			});
			await session.bindExtensions({ mode: "tui" });
			await session.setModel(listed as never);
			try {
				for (const step of entry.steps) {
					assert.match(step, /^prompt:\d+$/, `${entry.id}: the active loop replays prompts only`);
					const prompt = entry.prompts[Number(step.split(":")[1])]!;
					await session.prompt(prompt);
					await session.waitForIdle();
				}
				for (const message of session.messages as Array<{ role?: string; stopReason?: string; errorMessage?: string }>) {
					if (message.role === "assistant" && message.stopReason === "error") outcome.errors.push(String(message.errorMessage));
				}
			} finally {
				session.dispose();
			}
		} finally {
			release();
		}
	} finally {
		await rm(root, { recursive: true, force: true });
	}
	return { server, sleeps, outcome };
}

/**
 * Every difference between one adapter run and the pinned native case: the projected request sequence, content-encoding,
 * the terminal outcome, every recorded retry wait against its source-backed range, and the upgrade/POST order. For a
 * native HTTP-only case the 426 stand-in must cost exactly one refused upgrade before the first POST and none later.
 */
function caseFailures(entry: Case, run: Awaited<ReturnType<typeof runCase>>): string[] {
	const failures: string[] = [];
	const adapter = projectSequence(run.server.sent, { scripts: entry.scripts, prompts: entry.prompts });
	if (!isDeepStrictEqual(adapter, entry.native)) failures.push("request sequence differs from native");
	if (entry.nativeContentEncoding && !isDeepStrictEqual(run.server.encodings, entry.nativeContentEncoding)) failures.push("content-encoding differs from native");
	const expectedErrors = entry.expectError ? 1 : 0;
	if (run.outcome.errors.length !== expectedErrors) failures.push(`terminal errors ${run.outcome.errors.length}, expected ${expectedErrors}`);
	if (run.sleeps.length !== entry.expectedSleeps.length) failures.push(`retry waits ${JSON.stringify(run.sleeps)}, expected ${entry.expectedSleeps.length}`);
	run.sleeps.forEach((ms, i) => {
		const range = entry.expectedSleeps[i];
		if (range && !(ms >= range[0] && ms < range[1])) failures.push(`retry wait ${i} is ${ms} ms, outside [${range[0]}, ${range[1]})`);
	});
	const timeline = entry.nativeTimeline ?? ["upgrade", ...entry.native.map(() => "http" as const)];
	if (!isDeepStrictEqual(run.server.timeline, timeline)) failures.push(`upgrade/POST order ${JSON.stringify(run.server.timeline)}, expected ${JSON.stringify(timeline)}`);
	return failures;
}

const ACTIVE_CASES = FIXTURE.cases.filter((c) => c.area !== "compaction");

const byId = (id: string): Case => {
	const entry = FIXTURE.cases.find((c) => c.id === id);
	assert.ok(entry, `fixture case ${id}`);
	return entry!;
};

describe("native differential fixture", () => {
	it("is the pinned normal oracle artifact with traceable captures", () => {
		assert.equal(FIXTURE.schema, "rqw-codex/native-differential@1");
		assert.equal(FIXTURE.provenance.codexCommit, "83086188ae0614bd882818ff1aa23f3194962012");
		assert.match(FIXTURE.provenance.oracleRun, /^https:\/\/github\.com\/ARQAWA\/my-pi\/actions\/runs\/\d+$/);
		assert.deepEqual([...new Set(FIXTURE.cases.map((c) => c.area))].sort(), ["compaction", "retry", "transport"]);
		for (const entry of FIXTURE.cases) {
			assert.ok(entry.captures.length > 0, `${entry.id}: capture files recorded`);
			for (const capture of entry.captures) {
				assert.ok(capture.file.startsWith(`captures/${entry.capturePrefix}-`), `${entry.id}: ${capture.file} belongs to the case`);
				assert.match(capture.sha256, /^[0-9a-f]{64}$/);
				assert.match(capture.rawSha256, /^[0-9a-f]{64}$/);
			}
			assert.equal(entry.responses.length, entry.native.length, `${entry.id}: one native response per captured request`);
			assert.ok(entry.sleepSource.length > 0, `${entry.id}: the retry waits cite their source`);
			assert.equal(entry.upgrade === "none", entry.nativeTimeline === undefined, `${entry.id}: a native timeline exactly for upgrade cases`);
		}
	});

	it("serves every captured script exactly once, in order", () => {
		for (const entry of FIXTURE.cases) {
			const served = entry.responses.filter((r) => r.script !== undefined).map((r) => r.script);
			assert.deepEqual(served, entry.scripts.map((_, i) => i), `${entry.id}: captured scripts in serve order`);
		}
	});

	it("the CI drift check accepts the committed fixture and refuses changed projections, replay configuration or source digests", () => {
		assert.deepEqual(driftOf(FIXTURE as never, FIXTURE as never), []);
		const first = FIXTURE.cases[0]!.id;
		const mutate = (edit: (fixture: typeof FIXTURE) => void) => {
			const changed = structuredClone(FIXTURE);
			edit(changed);
			return driftOf(FIXTURE as never, changed as never);
		};
		assert.deepEqual(mutate((f) => { f.cases[0]!.native[0]!.turnState = "other"; }), [`${first}: native drifted from the committed fixture`]);
		assert.deepEqual(mutate((f) => { (f.cases.find((c) => c.id === "transport-fallback-sticky")!).upgrade = 426; }), ["transport-fallback-sticky: upgrade drifted from the committed fixture"]);
		assert.deepEqual(mutate((f) => { (f.cases.find((c) => c.id === "retry-http-503-retry-after")!).providerRetries = { requestMaxRetries: 4, streamMaxRetries: 5 }; }), ["retry-http-503-retry-after: providerRetries drifted from the committed fixture"]);
		assert.deepEqual(mutate((f) => { (f.cases.find((c) => c.id === "compaction-mid-turn-turn-state")!).autoCompactTokenLimit = 300; }), ["compaction-mid-turn-turn-state: autoCompactTokenLimit drifted from the committed fixture"]);
		assert.deepEqual(mutate((f) => { f.cases[0]!.steps = ["prompt:0"]; }), [`${first}: steps drifted from the committed fixture`]);
		assert.deepEqual(mutate((f) => { f.cases[0]!.prompts = ["x", "y"]; }), [`${first}: prompts drifted from the committed fixture`]);
		assert.deepEqual(mutate((f) => { f.cases[0]!.expectError = true; }), [`${first}: expectError drifted from the committed fixture`]);
		assert.deepEqual(mutate((f) => { (f.cases.find((c) => c.id === "retry-http-429-retry-after")!).expectedSleeps = [[0, 1]]; }), ["retry-http-429-retry-after: expectedSleeps drifted from the committed fixture"]);
		assert.deepEqual(mutate((f) => { (f.cases.find((c) => c.id === "transport-upgrade-426-sse")!).nativeTimeline = ["http"]; }), ["transport-upgrade-426-sse: nativeTimeline drifted from the committed fixture"]);
		// Run-dependent provenance only: capture digests and log locations may differ between oracle runs.
		assert.deepEqual(mutate((f) => { f.cases[0]!.captures = []; (f.cases[0] as unknown as { nativeLog: string }).nativeLog = "elsewhere"; }), []);
		assert.deepEqual(mutate((f) => { f.provenance.sourceSha256 = { ...f.provenance.sourceSha256, "core/tests/suite/turn_state.rs": "0".repeat(64) }; }), ["cited native source digests differ"]);
	});

	it("the native compaction cases stay pinned in the fixture but are outside the active adapter loop", () => {
		assert.deepEqual(FIXTURE.cases.filter((c) => c.area === "compaction").map((c) => c.id), NATIVE_COMPACTION_CASES);
		assert.deepEqual(FIXTURE.cases.filter((c) => c.area !== "compaction").map((c) => c.id), ACTIVE_CASES.map((c) => c.id));
		for (const entry of FIXTURE.cases.filter((c) => c.area !== "compaction")) {
			assert.ok(entry.steps.every((s) => /^prompt:\d+$/.test(s)), `${entry.id}: the active loop has prompt steps only`);
			assert.equal(entry.autoCompactTokenLimit, undefined, `${entry.id}: no native compaction limit in an active case`);
		}
	});

	it("the shared projection reads native wire SSE exactly like the native sse() producer", () => {
		assert.equal(nativeSseText([{ type: "response.created", response: { id: "r" } }, { type: "done" }]), 'event: response.created\ndata: {"type":"response.created","response":{"id":"r"}}\n\nevent: done\n\n');
	});
});

describe("adapter vs pinned native oracle request sequences", () => {
	for (const entry of ACTIVE_CASES) {
		it(`[${entry.area}] ${entry.id} (${entry.test})`, { timeout: CASE_TIMEOUT_MS }, async () => {
			assert.deepEqual(caseFailures(entry, await runCase(entry)), [], `${entry.id}: adapter differs from native ${entry.capturePrefix}`);
		});
	}
});

// Mutation regressions: a changed stimulus makes the adapter behave differently, and the checker must report exactly that.
describe("native differential checker rejects real behavioral differences", () => {
	it("upgrade omission: answering the sticky-fallback upgrades with 426 skips the WebSocket stream attempts", { timeout: CASE_TIMEOUT_MS }, async () => {
		const entry = byId("transport-fallback-sticky");
		const failures = caseFailures(entry, await runCase({ ...entry, upgrade: 426 }));
		assert.ok(failures.some((f) => f.startsWith('upgrade/POST order ["upgrade","http","http"]')), JSON.stringify(failures));
	});

	it("extra upgrade attempts: answering the 426 case's upgrade with 404 adds stream attempts before HTTP", { timeout: CASE_TIMEOUT_MS }, async () => {
		const entry = byId("transport-upgrade-426-sse");
		const failures = caseFailures(entry, await runCase({ ...entry, upgrade: 404 }));
		assert.ok(failures.some((f) => f.startsWith('upgrade/POST order ["upgrade","upgrade","upgrade","upgrade","http"]')), JSON.stringify(failures));
	});

	it("extra upgrade on a later turn and a missing one are both refused by the order check", () => {
		const entry = byId("transport-fallback-sticky");
		const run = (timeline: Array<"upgrade" | "http">) => ({ server: { sent: [], encodings: [], timeline }, sleeps: [200, 400], outcome: { errors: [] } }) as unknown as Awaited<ReturnType<typeof runCase>>;
		const order = (timeline: Array<"upgrade" | "http">) => caseFailures(entry, run(timeline)).filter((f) => f.startsWith("upgrade/POST order"));
		assert.equal(order(["upgrade", "upgrade", "upgrade", "upgrade", "http", "upgrade", "http"]).length, 1, "an upgrade before the second turn");
		assert.equal(order(["upgrade", "upgrade", "upgrade", "http", "http"]).length, 1, "a missing stream attempt");
		assert.equal(order(entry.nativeTimeline!).length, 0, "the native order itself");
	});

	it("incorrect delay: Retry-After 2 instead of the native 1 is reported as a wait outside the source range", { timeout: CASE_TIMEOUT_MS }, async () => {
		const entry = byId("retry-http-503-retry-after");
		const responses = entry.responses.map((r) => (r.headers?.["retry-after"] ? { ...r, headers: { ...r.headers, "retry-after": "2" } } : r));
		const failures = caseFailures(entry, await runCase({ ...entry, responses }));
		assert.deepEqual(failures, ["retry wait 0 is 2000 ms, outside [1000, 1001)", "retry wait 1 is 2000 ms, outside [1000, 1001)"]);
	});

	it("incorrect delay: a 503 retry without the server advice waits the local backoff, not the native Retry-After", { timeout: CASE_TIMEOUT_MS }, async () => {
		const entry = byId("retry-http-503-retry-after");
		// Only the first 503 loses its advice: the second keeps it, so the stream budget stays as native and only the first wait differs.
		const responses = entry.responses.map((r, i) => (i === 0 ? { ...r, headers: { "content-type": "application/json" } } : r));
		const failures = caseFailures(entry, await runCase({ ...entry, responses }));
		assert.deepEqual(failures, ["retry wait 0 is 200 ms, outside [1000, 1001)"]);
	});
});
