import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { machine as osMachine, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
	asciiJson,
	clientMetadata,
	collectWorkspaceMetadata,
	identityHeaders,
	mcpAttributionJson,
	newContextWindowId,
	NAMESPACE_OID,
	sanitizeGitRemote,
	sortKeys,
	turnMetadataPayload,
	localPlatform,
	osInfoVersion,
	terminalToken,
	userAgent,
	uuidV5,
	validateExtraMetadata,
	type CodexIdentity,
} from "../../../extensions/RQW-codex/metadata.ts";

const METADATA_SOURCE = readFileSync(fileURLToPath(new URL("../../../extensions/RQW-codex/metadata.ts", import.meta.url)), "utf8");

const NAMESPACE_DNS = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
const PLATFORM = { osType: "Mac OS", osVersion: "14.5", arch: "arm64", terminal: "iTerm.app/3.5" };

// Native order of the turn metadata blob (responses_metadata.rs CodexTurnMetadataPayload), excluding `compaction`.
const NATIVE_TURN_ORDER = [
	"installation_id", "session_id", "thread_id", "agent_name", "turn_id", "window_id", "window_number",
	"context_window_id", "request_kind", "history_initialization", "forked_from_thread_id",
	"forked_from_ordinal_exclusive", "parent_thread_id", "parent_turn_id", "root_turn_id", "subagent_kind",
	"thread_source", "turn_trigger", "sandbox", "sandbox_mode", "auto_review_enabled",
	"node_repl_auto_review_required", "node_repl_disabled", "workspaces", "tool_namespaces_info",
	"turn_started_at_unix_ms", "history_ingest_requested", "analytics_enabled",
];

// Typed fields that native reserves (responses_metadata.rs RESERVED_METADATA_KEYS).
const RESERVED_TYPED_KEYS = [
	"history_initialization", "forked_from_thread_id", "sandbox", "sandbox_mode",
	"auto_review_enabled", "node_repl_auto_review_required", "node_repl_disabled", "mcp_attribution",
	"guardian_credits_requested", "root_turn_id", "parent_turn_id", "workspaces",
];

const GOLDEN = JSON.parse(readFileSync(fileURLToPath(new URL("./fixtures/native-metadata.json", import.meta.url)), "utf8")) as {
	input: { requestKind: "turn"; transport: "sse"; platform: typeof PLATFORM; identity: CodexIdentity };
	expected: { clientMetadata: Record<string, string>; turnMetadataJson: string; headers: Record<string, string> };
};

function identity(extra: Partial<CodexIdentity> = {}): CodexIdentity {
	return {
		installationId: "00000000-0000-4000-8000-000000000001",
		windowId: "root-session-fake:0",
		rootSessionId: "root-session-fake",
		threadId: "thread-fake-1",
		turnId: "turn-1",
		workspaces: {
			"/fake/repo": { associated_remote_urls: { origin: "https://example.test/repo.git" }, latest_git_commit_hash: "abc123", has_changes: false },
		},
		toolNamespacesInfo: { functions: { name: "functions", functions: { shell: { name: "shell", direct: true, deferred: false, source: { kind: "harness" } } } } },
		...extra,
	};
}

function lowerHeaders(headers: Record<string, string>): Record<string, string> {
	return Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
}

describe("native JSON and UUID helpers", () => {
	it("escapes non-ASCII as lowercase UTF-16 code units, like codex-utils-string", () => {
		assert.equal(asciiJson({ a: "東京 é 😀" }), '{"a":"\\u6771\\u4eac \\u00e9 \\ud83d\\ude00"}');
		assert.equal(asciiJson({ a: "plain/~\u007f" }), '{"a":"plain/~\u007f"}');
	});

	it("sorts object keys recursively for BTreeMap-like output", () => {
		assert.equal(JSON.stringify(sortKeys({ b: 1, a: { d: 1, c: [{ z: 1, y: 2 }] } })), '{"a":{"c":[{"y":2,"z":1}],"d":1},"b":1}');
	});

	it("orders keys by UTF-8 bytes (Rust BTreeMap), not by UTF-16 units", () => {
		// U+FFFD is EF BF BD and U+1F600 is F0 9F 98 80, so UTF-8 order puts U+FFFD first; UTF-16 order would not.
		assert.deepEqual(Object.keys(sortKeys({ "\u{1F600}": 1, "\uFFFD": 2 }) as object), ["\uFFFD", "\u{1F600}"]);
	});

	it("keeps a __proto__ key as ordinary data and never changes the prototype", () => {
		const input = JSON.parse('{"__proto__":{"x":1},"a":1}') as Record<string, unknown>;
		const out = sortKeys(input) as Record<string, unknown>;
		assert.equal(Object.getPrototypeOf(out), Object.prototype);
		assert.equal(Object.hasOwn(out, "__proto__"), true);
		assert.equal(JSON.stringify(out), '{"__proto__":{"x":1},"a":1}');
	});

	it("computes RFC 4122 name-based UUIDv5 vectors", () => {
		assert.equal(uuidV5(NAMESPACE_DNS, "python.org"), "886313e1-3b8a-5372-9b90-0c9aee199e5d");
		assert.equal(uuidV5(NAMESPACE_OID, "thread-fake-1"), uuidV5(NAMESPACE_OID, "thread-fake-1"));
		assert.notEqual(uuidV5(NAMESPACE_OID, "thread-fake-1"), uuidV5(NAMESPACE_OID, "thread-fake-2"));
	});

	it("builds UUIDv7 context window IDs from injected time and randomness", () => {
		// 1700000000000 ms = 0x018bcfe56800; version nibble 7, variant bits 10.
		const id = newContextWindowId(1_700_000_000_000, () => new Uint8Array(10).fill(0xab));
		assert.equal(id, "018bcfe5-6800-7bab-abab-abababababab");
	});
});

describe("native capture golden (fake-free, from the pinned Codex 0.163.0 CI capture)", () => {
	it("pins the provenance of the captured case without any auth material", () => {
		assert.equal(GOLDEN.expected.headers.authorization, undefined);
		assert.equal(GOLDEN.expected.headers.cookie, undefined);
		assert.match(JSON.stringify(GOLDEN), /83086188ae0614bd882818ff1aa23f3194962012/);
	});

	it("reproduces the native flat client_metadata map exactly (semantic, unordered as native HashMap)", () => {
		const body = clientMetadata(GOLDEN.input.identity, GOLDEN.input.requestKind);
		assert.deepEqual(body, GOLDEN.expected.clientMetadata);
	});

	it("reproduces the native x-codex-turn-metadata body blob byte for byte, in native field order", () => {
		const body = clientMetadata(GOLDEN.input.identity, GOLDEN.input.requestKind);
		assert.equal(body["x-codex-turn-metadata"], GOLDEN.expected.turnMetadataJson);
	});

	it("reproduces the native compatibility headers that this codec owns exactly", () => {
		const headers = identityHeaders(GOLDEN.input.identity, {
			requestKind: GOLDEN.input.requestKind,
			transport: GOLDEN.input.transport,
			platform: GOLDEN.input.platform,
		});
		assert.deepEqual(lowerHeaders(headers), GOLDEN.expected.headers);
		assert.equal(headers["User-Agent"], "codex_cli_rs/0.163.0 (Mac OS 26.6.2; arm64) unknown");
	});
});

describe("identity headers and client metadata", () => {
	it("pins the truthful native User-Agent and version", () => {
		assert.equal(userAgent(PLATFORM), "codex_cli_rs/0.163.0 (Mac OS 14.5; arm64) iTerm.app/3.5");
		const headers = identityHeaders(identity(), { transport: "sse", platform: PLATFORM });
		assert.equal(headers.originator, "codex_cli_rs");
		assert.equal(headers.version, "0.163.0");
		assert.equal(headers["User-Agent"], userAgent(PLATFORM));
		assert.equal(headers["session-id"], "root-session-fake");
		assert.equal(headers["thread-id"], "thread-fake-1");
		assert.equal(headers["x-client-request-id"], "thread-fake-1");
		assert.equal(headers["OpenAI-Beta"], undefined);
		assert.equal(headers.Authorization, undefined);
	});

	it("sets the WebSocket beta header only for websocket transport", () => {
		const headers = identityHeaders(identity(), { transport: "websocket", platform: PLATFORM });
		assert.equal(headers["OpenAI-Beta"], "responses_websockets=2026-02-06");
	});

	it("keeps tool namespaces in the body blob and out of the header projection, which otherwise equals the body blob", () => {
		const body = clientMetadata(identity(), "turn");
		const headers = identityHeaders(identity(), { requestKind: "turn", transport: "sse", platform: PLATFORM });
		const bodyBlob = JSON.parse(body["x-codex-turn-metadata"]);
		assert.ok(bodyBlob.tool_namespaces_info.functions);
		const headerBlob = JSON.parse(headers["x-codex-turn-metadata"]);
		assert.equal(headerBlob.tool_namespaces_info, undefined);
		assert.equal(headerBlob.request_kind, "turn");
		assert.equal(headerBlob.installation_id, "00000000-0000-4000-8000-000000000001");
		const { tool_namespaces_info: _omitted, ...bodyWithoutNamespaces } = bodyBlob;
		assert.deepEqual(headerBlob, bodyWithoutNamespaces);
	});

	it("projects one snapshot into flat body keys with strings only", () => {
		const body = clientMetadata(identity({ subagentHeader: "review", parentThreadId: "parent-fake", parentTurnId: "ptn", rootTurnId: "rtn" }), "turn");
		assert.deepEqual(Object.keys(body), [
			"x-codex-installation-id", "session_id", "thread_id", "x-codex-window-id", "turn_id",
			"x-openai-subagent", "x-codex-parent-thread-id", "parent_turn_id", "root_turn_id", "x-codex-turn-metadata",
		]);
		assert.ok(Object.values(body).every((v) => typeof v === "string"));
	});

	it("omits the turn blob without a request kind and keeps native memory requests thread-free", () => {
		assert.equal(clientMetadata(identity())["x-codex-turn-metadata"], undefined);
		const memory = turnMetadataPayload(identity(), "memory");
		assert.equal(memory.thread_id, undefined);
		assert.equal(memory.session_id, undefined);
		assert.equal(memory.installation_id, undefined);
		assert.equal(memory.request_kind, "memory");
	});

	it("emits compaction metadata only for compaction requests", () => {
		const id = identity({ compaction: { trigger: "auto", reason: "context_limit", implementation: "responses", phase: "mid_turn" } });
		assert.deepEqual(turnMetadataPayload(id, "compaction").compaction, { trigger: "auto", reason: "context_limit", implementation: "responses", phase: "mid_turn", strategy: "memento" });
		assert.equal(turnMetadataPayload(id, "turn").compaction, undefined);
	});

	it("serializes compaction fields in native order with strategy last, defaulting to memento", () => {
		const id = identity({ compaction: { trigger: "manual", reason: "user_requested", implementation: "responses", phase: "standalone_turn", strategy: "memento" } });
		const compaction = turnMetadataPayload(id, "compaction").compaction as Record<string, unknown>;
		assert.deepEqual(Object.keys(compaction), ["trigger", "reason", "implementation", "phase", "strategy"]);
		assert.equal(compaction.strategy, "memento");
	});

	it("uses lineage fields truthfully and never invents sandbox or guardian claims", () => {
		const payload = turnMetadataPayload(identity({ parentThreadId: "parent-fake", subagentKind: "review" }), "turn");
		assert.equal(payload.parent_thread_id, "parent-fake");
		assert.equal(payload.subagent_kind, "review");
		for (const key of ["sandbox", "sandbox_mode", "auto_review_enabled", "node_repl_disabled", "guardian_credits_requested"]) {
			assert.equal(payload[key], undefined, key);
		}
		assert.equal(clientMetadata(identity({ parentThreadId: "parent-fake", subagentKind: "review" }), "turn").guardian_credits_requested, undefined);
	});

	it("accepts the three backward-compatible keys and filters them out of the returned extras", () => {
		assert.deepEqual(
			validateExtraMetadata({ window_number: "3", forked_from_ordinal_exclusive: "7", analytics_enabled: "true", model: "m" }),
			{ model: "m" },
		);
		const payload = turnMetadataPayload(identity({ extra: { window_number: "9", analytics_enabled: "x", model: "m" }, analyticsEnabled: true }), "turn");
		assert.equal(payload.analytics_enabled, true);
		assert.equal(payload.window_number, undefined);
		assert.equal(payload.model, "m");
	});

	it("validates caller extras against the native limits", () => {
		assert.deepEqual(validateExtraMetadata({ b_key: "2", a: "1" }), { a: "1", b_key: "2" });
		assert.throws(() => validateExtraMetadata({ session_id: "x" }), /reserved/);
		assert.throws(() => validateExtraMetadata({ "1bad": "x" }), /ASCII identifiers/);
		assert.throws(() => validateExtraMetadata({ v: "x".repeat(129) }), /128 bytes/);
		const many = Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`k${i}`, "v"]));
		assert.throws(() => validateExtraMetadata(many), /at most 16/);
	});

	it("reserves every typed native field so a caller extra can never shadow it", () => {
		for (const key of RESERVED_TYPED_KEYS) assert.throws(() => validateExtraMetadata({ [key]: "x" }), /reserved/, key);
	});

	it("forwards unknown extra model and reasoning strings within limits, appended after the typed fields", () => {
		const payload = turnMetadataPayload(identity({ turnStartedAtUnixMs: 1, extra: { model: "gpt-fake", reasoning_effort: "high" } }), "turn");
		assert.deepEqual(Object.keys(payload).slice(-2), ["model", "reasoning_effort"]);
		assert.equal(payload.model, "gpt-fake");
		assert.throws(() => validateExtraMetadata({ long_value: "é".repeat(65) }), /128 bytes/);
		assert.deepEqual(validateExtraMetadata({ long_value: "é".repeat(64) }), { long_value: "é".repeat(64) });
		assert.deepEqual(validateExtraMetadata({ [`k${"a".repeat(63)}`]: "x" }), { [`k${"a".repeat(63)}`]: "x" });
		assert.throws(() => validateExtraMetadata({ ["a".repeat(65)]: "x" }), /ASCII identifiers/);
	});
});

describe("typed native fields (fake values)", () => {
	const full = (): CodexIdentity => identity({
		agentName: "/root/child",
		windowNumber: 2,
		contextWindowId: "018bcfe5-6800-7bab-abab-abababababab",
		historyInitialization: "warm_fork",
		forkedFromThreadId: "fork-source-fake",
		forkedFromOrdinalExclusive: 7,
		parentThreadId: "parent-fake",
		parentTurnId: "parent-turn-fake",
		rootTurnId: "root-turn-fake",
		subagentKind: "collab_spawn",
		threadSource: "subagent",
		turnTrigger: "user",
		sandbox: "workspace",
		sandboxMode: "workspace-write",
		autoReviewEnabled: false,
		nodeReplAutoReviewRequired: false,
		nodeReplDisabled: true,
		historyIngestRequested: false,
		turnStartedAtUnixMs: 1_700_000_000_123,
		analyticsEnabled: false,
		extra: { model: "fake-model" },
	});

	it("writes typed fields in exact native order and keeps explicit false booleans", () => {
		const payload = turnMetadataPayload(full(), "turn");
		assert.deepEqual(Object.keys(payload), [...NATIVE_TURN_ORDER, "model"]);
		assert.equal(payload.auto_review_enabled, false);
		assert.equal(payload.node_repl_auto_review_required, false);
		assert.equal(payload.node_repl_disabled, true);
		assert.equal(payload.history_ingest_requested, false);
		assert.equal(payload.analytics_enabled, false);
	});

	it("omits every absent optional field instead of writing null or empty values", () => {
		const payload = turnMetadataPayload(identity(), "turn");
		for (const key of ["history_initialization", "forked_from_thread_id", "sandbox", "auto_review_enabled", "window_number", "context_window_id"]) {
			assert.equal(key in payload, false, key);
		}
	});

	it("maps root and parent lineage to flat body keys as native does", () => {
		const body = clientMetadata(full(), "turn");
		assert.equal(body.parent_turn_id, "parent-turn-fake");
		assert.equal(body.root_turn_id, "root-turn-fake");
		assert.equal(body["x-codex-parent-thread-id"], "parent-fake");
		assert.equal(body.guardian_credits_requested, undefined);
	});

	it("ASCII-escapes Unicode inside the turn blob only, leaving flat values as given", () => {
		const body = clientMetadata(identity({ agentName: "東京", turnId: "é-turn" }), "turn");
		assert.ok(body["x-codex-turn-metadata"].includes("\\u6771\\u4eac"));
		assert.ok(!body["x-codex-turn-metadata"].includes("東京"));
		assert.equal(body.turn_id, "é-turn");
	});

	it("sorts tool namespace BTreeMap keys but keeps struct field order and null code_mode_name", () => {
		const id = identity({
			toolNamespacesInfo: {
				zeta: { name: "zeta", functions: { b: { name: "b", direct: false, code_mode_name: "b_mode", deferred: true, source: { kind: "mcp", server_name: "srv" } } } },
				alpha: { name: "alpha", functions: { a: { name: "a", direct: true, deferred: false, source: { kind: "harness" } } } },
			},
		});
		const blob = JSON.stringify(turnMetadataPayload(id, "turn").tool_namespaces_info);
		assert.equal(blob, '{"alpha":{"name":"alpha","functions":{"a":{"name":"a","direct":true,"code_mode_name":null,"deferred":false,"source":{"kind":"harness"}}}},"zeta":{"name":"zeta","functions":{"b":{"name":"b","direct":false,"code_mode_name":"b_mode","deferred":true,"source":{"kind":"mcp","server_name":"srv"}}}}}');
	});

	it("never adds MCP attribution unless the identity supplies it, and writes it body-only in native order", () => {
		assert.equal(clientMetadata(identity(), "turn").mcp_attribution, undefined);
		const explicit = identity({
			mcpAttribution: {
				status: "complete",
				sources: [{ connector_id: "c", server_name: "s", tool_name: "t", first_turn_id: "turn-1" }],
			},
		});
		const body = clientMetadata(explicit, "turn");
		assert.equal(body.mcp_attribution, '{"status":"complete","sources":[{"connector_id":"c","server_name":"s","tool_name":"t","first_turn_id":"turn-1"}]}');
		assert.equal(identityHeaders(explicit, { requestKind: "turn", transport: "sse", platform: PLATFORM }).mcp_attribution, undefined);
		assert.equal(turnMetadataPayload(explicit, "turn").mcp_attribution, undefined);
	});

	it("rejects a non-native MCP status and returns the native payload_too_large error value above 16 KiB", () => {
		assert.equal(mcpAttributionJson({ status: "none" }), '{"status":"none"}');
		assert.throws(() => mcpAttributionJson({ status: "bogus" as "none" }), /not a native value/);
		const huge = { status: "complete" as const, sources: [{ server_name: "s", tool_name: "x".repeat(17_000), first_turn_id: "t" }] };
		assert.equal(mcpAttributionJson(huge), '{"status":"attribution_error","error_reason":"payload_too_large"}');
	});

	it("sends the native guardian credit request for ordinary subscription requests only", () => {
		assert.equal(clientMetadata(identity({ authProfile: "subscription" }), "turn").guardian_credits_requested, "true");
		assert.equal(clientMetadata(identity({ authProfile: "subscription" }), "memory").guardian_credits_requested, "true");
		assert.equal(clientMetadata(identity({ authProfile: "subscription", guardianCreditsRequested: false }), "turn").guardian_credits_requested, undefined);
		assert.equal(clientMetadata(identity({ authProfile: "api_key" }), "turn").guardian_credits_requested, undefined);
		assert.equal(clientMetadata(identity({ authProfile: "basic" }), "turn").guardian_credits_requested, undefined);
		assert.equal(clientMetadata(identity(), "turn").guardian_credits_requested, undefined);
		assert.equal(JSON.parse(clientMetadata(identity({ authProfile: "subscription" }), "turn")["x-codex-turn-metadata"]).guardian_credits_requested, undefined);
	});
});

describe("platform facts from os_info and terminal detection", () => {
	it("formats the macOS product version as os_info does (semantic, missing parts as 0)", () => {
		assert.equal(osInfoVersion("14.5"), "14.5.0");
		assert.equal(osInfoVersion("15"), "15.0.0");
		assert.equal(osInfoVersion("14.5.1"), "14.5.1");
		assert.equal(osInfoVersion("23A344"), "23A344");
		assert.equal(osInfoVersion(""), "Unknown");
		assert.equal(osInfoVersion(undefined), "Unknown");
	});

	it("maps Node Windows_NT to the native Windows type and keeps the actual machine token (source pin, no runtime command)", () => {
		assert.match(METADATA_SOURCE, /os === "Windows_NT" \? "Windows" : os/);
		assert.match(METADATA_SOURCE, /const arch = osMachine\(\) \|\| "unknown";/);
	});

	it("reports the Windows identity on Windows only (CI)", () => {
		if (process.platform !== "win32") return;
		const facts = localPlatform({});
		assert.equal(facts.osType, "Windows");
		assert.equal(facts.arch, osMachine());
		assert.match(facts.osVersion, /^\d+\.\d+\.\d+$/);
		assert.match(userAgent(facts), /^codex_cli_rs\/0\.163\.0 \(Windows \d+\.\d+\.\d+; .+\) /);
	});

	it("reports the macOS product version, never the Darwin kernel release, on macOS", () => {
		if (process.platform !== "darwin") return;
		const facts = localPlatform({});
		assert.equal(facts.osType, "Mac OS");
		assert.match(facts.osVersion, /^\d+\.\d+\.\d+$/);
		assert.notEqual(facts.osVersion, "Darwin");
	});

	it("maps the terminal in codex-rs source order, with TERM_PROGRAM first and tmux skipped", () => {
		assert.equal(terminalToken({ TERM_PROGRAM: "iTerm.app", TERM_PROGRAM_VERSION: "3.5" }), "iTerm.app/3.5");
		assert.equal(terminalToken({ TERM_PROGRAM: "tmux", TERM_PROGRAM_VERSION: "3.4", TERM: "screen" }), "screen");
		assert.equal(terminalToken({ TERM_PROGRAM: "Apple_Terminal", ITERM_SESSION_ID: "x" }), "Apple_Terminal");
		assert.equal(terminalToken({ WEZTERM_VERSION: "2024" }), "WezTerm/2024");
		assert.equal(terminalToken({ ITERM_SESSION_ID: "w0" }), "iTerm.app");
		assert.equal(terminalToken({ KITTY_WINDOW_ID: "1" }), "kitty");
		assert.equal(terminalToken({ GNOME_TERMINAL_SCREEN: "x", VTE_VERSION: "7600" }), "gnome-terminal");
		assert.equal(terminalToken({ WT_SESSION: "x" }), "WindowsTerminal");
		assert.equal(terminalToken({ TERM: "xterm-256color" }), "xterm-256color");
		assert.equal(terminalToken({}), "unknown");
		assert.equal(terminalToken({ TERM_PROGRAM: "my term" }), "my_term");
	});

	it("keeps configured terminal values untrimmed (spaces become _), treats whitespace-only TERM_PROGRAM/TERM as unset, and checks presence for native probes", () => {
		assert.equal(terminalToken({ TERM_PROGRAM: " iTerm.app ", TERM_PROGRAM_VERSION: " 3.5 " }), "_iTerm.app_/_3.5_");
		assert.equal(terminalToken({ TERM_PROGRAM: "   ", TERM: "xterm" }), "xterm");
		assert.equal(terminalToken({ TERM_PROGRAM: "   ", TERM: "  " }), "unknown");
		assert.equal(terminalToken({ WEZTERM_VERSION: "  ", TERM: "xterm" }), "WezTerm");
		assert.equal(terminalToken({ WEZTERM_VERSION: "", TERM: "xterm" }), "WezTerm");
		assert.equal(terminalToken({ WT_SESSION: "\t" }), "WindowsTerminal");
		assert.equal(terminalToken({ WT_SESSION: " x " }), "WindowsTerminal");
		assert.equal(terminalToken({ GHOSTTY_RESOURCES_DIR: "  ", TERM: "xterm" }), "xterm");
	});
});

describe("git workspace metadata", () => {
	it("removes credentials and query strings but keeps the SSH git user", () => {
		assert.equal(sanitizeGitRemote("https://user:secret@example.test/a/b.git?token=abc#frag"), "https://example.test/a/b.git");
		assert.equal(sanitizeGitRemote("ssh://git@example.test/a/b.git"), "ssh://git@example.test/a/b.git");
		assert.equal(sanitizeGitRemote("ssh://deploy:pw@example.test/a.git"), "ssh://example.test/a.git");
		assert.equal(sanitizeGitRemote("deploy@example.test:team/repo.git"), "example.test:team/repo.git");
		assert.equal(sanitizeGitRemote("example.test:team/repo.git"), "example.test:team/repo.git");
		assert.equal(sanitizeGitRemote("not a url at all"), undefined);
	});

	it("reads actual git facts from a temporary fixture without leaking remote secrets", async () => {
		const dir = mkdtempSync(join(tmpdir(), "rqw-codex-git-"));
		try {
			const git = (args: string[]) =>
				execFileGit(dir, args);
			git(["init", "-q"]);
			git(["remote", "add", "origin", "https://fake-user:fake-secret@example.test/repo.git?token=fake-token"]);
			writeFileSync(join(dir, "a.txt"), "one\n");
			git(["add", "a.txt"]);
			git(["commit", "-q", "-m", "fixture"]);
			const head = git(["rev-parse", "HEAD"]).trim();

			const clean = await collectWorkspaceMetadata(dir);
			const [root] = Object.keys(clean);
			assert.equal(Object.keys(clean).length, 1);
			assert.equal(clean[root].latest_git_commit_hash, head);
			assert.equal(clean[root].has_changes, false);
			assert.deepEqual(clean[root].associated_remote_urls, { origin: "https://example.test/repo.git" });
			assert.ok(!JSON.stringify(clean).includes("fake-secret"));
			assert.ok(!JSON.stringify(clean).includes("fake-token"));

			writeFileSync(join(dir, "a.txt"), "two\n");
			const dirty = await collectWorkspaceMetadata(dir);
			assert.equal(dirty[root].has_changes, true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("returns no workspace outside a git repository", async () => {
		const dir = mkdtempSync(join(tmpdir(), "rqw-codex-nogit-"));
		try {
			assert.deepEqual(await collectWorkspaceMetadata(dir), {});
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

function execFileGit(cwd: string, args: string[]): string {
	return execFileSync("git", args, {
		cwd,
		encoding: "utf8",
		env: { ...process.env, GIT_AUTHOR_NAME: "fake", GIT_AUTHOR_EMAIL: "fake@example.test", GIT_COMMITTER_NAME: "fake", GIT_COMMITTER_EMAIL: "fake@example.test" },
	});
}
