// Native Codex 0.163.0 identity, metadata and git workspace projections (source: codex-rs pinned at
// rust-v0.163.0 / 83086188ae0614bd882818ff1aa23f3194962012). One snapshot feeds the body
// client_metadata and the compatibility headers; they never diverge.
import { execFile, execFileSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { machine as osMachine, release as osRelease, type as osType } from "node:os";

// codex-rs/login/src/auth/default_client.rs:42 (DEFAULT_ORIGINATOR), :152-210 (user agent format).
export const CODEX_VERSION = "0.163.0";
export const CODEX_ORIGINATOR = "codex_cli_rs";
export const CODEX_COMMIT = "83086188ae0614bd882818ff1aa23f3194962012";
// codex-rs/core/src/client.rs:160-176 header names; responses_metadata.rs:31-118 key names.
export const HEADER_INSTALLATION_ID = "x-codex-installation-id";
export const HEADER_WINDOW_ID = "x-codex-window-id";
export const HEADER_TURN_METADATA = "x-codex-turn-metadata";
export const HEADER_PARENT_THREAD_ID = "x-codex-parent-thread-id";
export const HEADER_SUBAGENT = "x-openai-subagent";
export const WS_OPENAI_BETA = "responses_websockets=2026-02-06"; // client.rs:1401-1405
// responses_metadata.rs:116-119 and 502-540: at most 16 entries, keys 64 bytes, values 128 bytes.
const MAX_EXTRA_ENTRIES = 16;
const MAX_EXTRA_KEY_BYTES = 64;
const MAX_EXTRA_VALUE_BYTES = 128;
// responses_metadata.rs RESERVED_METADATA_KEYS, minus the three backward-compatible keys below.
export const RESERVED_EXTRA_KEYS: readonly string[] = [
	"guardian_credits_requested", "mcp_attribution", "installation_id", "x-codex-installation-id", "session_id",
	"thread_id", "agent_name", "turn_id", "window_id", "context_window_id", "x-codex-window-id",
	"x-codex-turn-metadata", "x-codex-parent-thread-id", "x-openai-subagent", "request_kind", "compaction",
	"code_mode_tool_names", "tool_namespaces_info", "turn_started_at_unix_ms", "history_ingest_requested",
	"history_initialization", "forked_from_thread_id", "parent_thread_id", "parent_turn_id", "root_turn_id",
	"subagent_kind", "thread_source", "turn_trigger", "sandbox", "sandbox_mode", "auto_review_enabled",
	"node_repl_auto_review_required", "node_repl_disabled", "workspaces",
];
// responses_metadata.rs BACKWARD_COMPATIBLE_RESERVED_METADATA_KEYS: accepted from old configs, then filtered out
// (validateExtraMetadata returns without them), so they never reach the body or header.
export const BACKWARD_COMPATIBLE_EXTRA_KEYS: readonly string[] = ["window_number", "forked_from_ordinal_exclusive", "analytics_enabled"];

export type RequestKind = "turn" | "prewarm" | "compaction" | "memory";
export type WorkspaceMetadata = {
	associated_remote_urls?: Record<string, string>;
	latest_git_commit_hash?: string;
	has_changes?: boolean;
};
export type CompactionMetadata = {
	trigger: string;
	reason: string;
	implementation: string;
	phase: string;
	/** Native CompactionStrategy (analytics/src/facts.rs); native compaction requests always send memento. Default memento. */
	strategy?: "memento";
};

// Caller-owned identity lineage. The caller persists installation/window IDs; this module never stores them.
/** Native HistoryInitialization (history/src/initialization.rs, snake_case). */
export type HistoryInitialization = "new" | "cleared" | "cold_resume" | "warm_fork" | "cold_fork" | "supplied_history";
/** Native McpAttributionStatus (protocol/src/mcp.rs, snake_case). */
export type McpAttributionStatus = "none" | "complete" | "attribution_error";
/** Native McpAttributionErrorReason (protocol/src/mcp.rs, snake_case; `unknown` is serde's catch-all). */
export type McpAttributionErrorReason =
	| "history_missing_checkpoint" | "checkpoint_invalid" | "checkpoint_source_conflict" | "source_invalid"
	| "recorder_poisoned" | "restored_error_unknown" | "payload_too_large" | "serialization_failed" | "unknown";
export interface McpAttributionSource {
	connector_id?: string;
	plugin_id?: string;
	server_name: string;
	tool_name: string;
	first_turn_id: string;
}
/** Native McpAttribution (protocol/src/mcp.rs). Body-only; explicit identity values only. */
export interface McpAttribution {
	status: McpAttributionStatus;
	error_reason?: McpAttributionErrorReason;
	sources?: McpAttributionSource[];
}
/** Native TurnToolSource (tag `kind`). */
export type ToolFunctionSource = { kind: "harness" } | { kind: "mcp"; server_name: string };
/** Native TurnToolFunctionInfo. `code_mode_name` is serialized as null when absent (no skip attribute). */
export interface ToolFunctionInfo {
	name: string;
	direct: boolean;
	code_mode_name?: string;
	deferred: boolean;
	source: ToolFunctionSource;
}
/** Native TurnToolNamespaceInfo. */
export interface ToolNamespaceInfo {
	name: string;
	functions: Record<string, ToolFunctionInfo>;
}
/** Native TurnToolNamespacesInfo (BTreeMap keyed by effective namespace). */
export type ToolNamespacesInfo = Record<string, ToolNamespaceInfo>;
/** Caller auth profile. Only `subscription` receives the ordinary guardian_credits_requested flag; `api_key` and `basic` never do. */
export type AuthProfile = "subscription" | "api_key" | "basic";

export interface CodexIdentity {
	installationId: string;
	/** Native window_id, `<thread>:<number>` (captured as `01a16626-...-...:0`). Built by the caller. */
	windowId: string;
	windowNumber?: number;
	/** Native context_window_id: a UUIDv7 (responses_metadata.rs `Option<Uuid>`). */
	contextWindowId?: string;
	/** Shared root session affinity (native `session_id`). Children share it; threads never do. */
	rootSessionId: string;
	/** Logical thread (native `thread_id`, `thread-id`, `x-client-request-id`). */
	threadId: string;
	agentName?: string;
	turnId?: string;
	parentThreadId?: string;
	parentTurnId?: string;
	rootTurnId?: string;
	subagentHeader?: string;
	subagentKind?: string;
	turnStartedAtUnixMs?: number;
	historyIngestRequested?: boolean;
	analyticsEnabled?: boolean;
	threadSource?: string;
	turnTrigger?: string;
	workspaces?: Record<string, WorkspaceMetadata>;
	historyInitialization?: HistoryInitialization;
	/** Native forked_from_thread_id (ThreadId string). */
	forkedFromThreadId?: string;
	/** Native forked_from_ordinal_exclusive (u64). */
	forkedFromOrdinalExclusive?: number;
	sandbox?: string;
	sandboxMode?: string;
	autoReviewEnabled?: boolean;
	nodeReplAutoReviewRequired?: boolean;
	nodeReplDisabled?: boolean;
	/** Caller auth profile; absent means no guardian credit flag. */
	authProfile?: AuthProfile;
	/** Explicit `false` suppresses the subscription default; anything else keeps the default for `subscription`. */
	guardianCreditsRequested?: boolean;
	/** Explicit native MCP attribution only; never fabricated. Body client_metadata `mcp_attribution` only. */
	mcpAttribution?: McpAttribution;
	/** Native tool_namespaces_info, shaped exactly as codex-rs turn metadata (body only, never a header). */
	toolNamespacesInfo?: ToolNamespacesInfo;
	compaction?: CompactionMetadata;
	extra?: Record<string, string>;
}

export interface PlatformFacts {
	osType: string;
	osVersion: string;
	arch: string;
	terminal: string;
}

/** Native BTreeMap<String> key order: UTF-8 bytes (Unicode scalar order), not UTF-16 code units. */
export function utf8Keys(keys: string[]): string[] {
	return keys.sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
}

/** Own data property; a key such as `__proto__` stays data and never mutates the prototype. */
function setOwn(target: Record<string, unknown>, key: string, value: unknown): void {
	Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
}

/** Native-style JSON: UTF-8 JSON with every non-ASCII UTF-16 code unit escaped as lowercase \\uXXXX. */
export function asciiJson(value: unknown): string {
	return JSON.stringify(value).replace(/[\u0080-\uffff]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

/** Recursively sorted-key copy, mirroring serde_json's BTreeMap object order. */
export function sortKeys(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(sortKeys);
	if (value && typeof value === "object") {
		const out: Record<string, unknown> = {};
		for (const key of utf8Keys(Object.keys(value))) {
			const item = (value as Record<string, unknown>)[key];
			if (item !== undefined) setOwn(out, key, sortKeys(item));
		}
		return out;
	}
	return value;
}

/** Native installation IDs are UUIDv4 (installation_id.rs:54); the caller persists the result. */
export function newInstallationId(): string {
	return randomUUID();
}

/** Native context_window_id is a UUIDv7 (`now` and `random` are injectable for tests). window_id is not built here. */
export function newContextWindowId(now: number = Date.now(), random: (n: number) => Uint8Array = randomBytes): string {
	const b = Buffer.alloc(16);
	b.writeUIntBE(now, 0, 6);
	Buffer.from(random(10)).copy(b, 6);
	b[6] = (b[6] & 0x0f) | 0x70;
	b[8] = (b[8] & 0x3f) | 0x80;
	return formatUuid(b);
}

function formatUuid(b: Buffer): string {
	const h = b.toString("hex");
	return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

/** RFC 4122 name-based UUIDv5 (SHA-1), as used by codex-rs for deterministic prefixed item IDs. */
export function uuidV5(namespace: string, name: string | Uint8Array): string {
	const digest = createHash("sha1")
		.update(Buffer.from(namespace.replace(/-/g, ""), "hex"))
		.update(typeof name === "string" ? Buffer.from(name, "utf8") : Buffer.from(name))
		.digest();
	const b = Buffer.from(digest.subarray(0, 16));
	b[6] = (b[6] & 0x0f) | 0x50;
	b[8] = (b[8] & 0x3f) | 0x80;
	return formatUuid(b);
}

/** codex-rs Uuid::NAMESPACE_OID. */
export const NAMESPACE_OID = "6ba7b812-9dad-11d1-80b4-00c04fd430c8";

// os_info 3.14.0 (codex-rs Cargo.lock): macOS product version comes from SystemVersion.plist, then `sw_vers`
// (src/macos/mod.rs:40-100); the Darwin kernel release is NOT the product version.
let macosProductVersion: string | undefined | null = null;

function readMacosProductVersion(): string | undefined {
	if (macosProductVersion !== null) return macosProductVersion;
	let found: string | undefined;
	try {
		const plist = readFileSync("/System/Library/CoreServices/SystemVersion.plist", "utf8");
		found = /<key>ProductVersion<\/key>\s*<string>([^<]*)<\/string>/.exec(plist)?.[1]?.trim() || undefined;
	} catch {
		found = undefined;
	}
	if (found === undefined) {
		try {
			found = execFileSync("sw_vers", ["-productVersion"], { encoding: "utf8", timeout: 5000 }).trim() || undefined;
		} catch {
			found = undefined;
		}
	}
	macosProductVersion = found;
	return found;
}

/**
 * os_info `Version` Display (src/version.rs:38-67): `x[.y[.z]]` parsed as semantic (missing minor/patch become 0,
 * so "14.5" shows "14.5.0"); anything else is shown verbatim; empty is "Unknown".
 */
export function osInfoVersion(raw: string | undefined): string {
	if (raw === undefined || raw === "") return "Unknown";
	const parts = raw.trim().split(".");
	if (parts.length > 1 && parts[parts.length - 1] === "") parts.pop();
	if (parts.length > 3 || !parts.every((p) => /^\d+$/.test(p))) return raw;
	const [major, minor = "0", patch = "0"] = parts;
	return `${Number(major)}.${Number(minor)}.${Number(patch)}`;
}

/**
 * Platform facts for the User-Agent, mapped from os_info 3.14.0: os_type "Mac OS" / "Windows" (Node Windows_NT) /
 * "Linux"; architecture is the actual Node machine token (os.machine()) on every OS.
 * Linux and Windows versions use the kernel release (os_info uses distro/winapi; a known difference).
 */
export function localPlatform(env: NodeJS.ProcessEnv = process.env): PlatformFacts {
	const os = osType();
	const isMac = os === "Darwin";
	const name = isMac ? "Mac OS" : os === "Windows_NT" ? "Windows" : os;
	const arch = osMachine() || "unknown";
	const version = isMac ? osInfoVersion(readMacosProductVersion()) : osInfoVersion(osRelease());
	return { osType: name, osVersion: version, arch, terminal: terminalToken(env) };
}

/**
 * codex-rs terminal-detection user_agent_token (terminal-detection/src/lib.rs:152-175, 254-349): TERM_PROGRAM
 * (not tmux) with its version; else the terminal probes in source order; else TERM; else "unknown".
 * Characters outside [A-Za-z0-9-_./] become `_` (sanitize_header_value).
 */
export function terminalToken(env: NodeJS.ProcessEnv): string {
	// native var_non_empty (terminal-detection lib.rs:196-211, none_if_whitespace): only an all-whitespace value is
	// rejected; the ORIGINAL untrimmed value is returned and sanitized. Native has() is presence only, so an empty value
	// still counts for the per-key probes below (lib.rs:254-349).
	const nonBlank = (key: string) => {
		const value = env[key];
		return value !== undefined && value.trim() !== "" ? value : undefined;
	};
	const isSet = (key: string) => env[key] !== undefined;
	const withVersion = (name: string, version: string | undefined) => (version ? `${name}/${version}` : name);
	const program = nonBlank("TERM_PROGRAM");
	let raw: string;
	if (program !== undefined && program.toLowerCase() !== "tmux") {
		raw = withVersion(program, nonBlank("TERM_PROGRAM_VERSION"));
	} else if (nonBlank("GHOSTTY_RESOURCES_DIR") !== undefined) {
		raw = "Ghostty";
	} else if (isSet("WEZTERM_VERSION")) {
		raw = withVersion("WezTerm", nonBlank("WEZTERM_VERSION"));
	} else if (isSet("ITERM_SESSION_ID") || isSet("ITERM_PROFILE") || isSet("ITERM_PROFILE_NAME")) {
		raw = "iTerm.app";
	} else if (isSet("KITTY_WINDOW_ID") || (env.TERM ?? "").includes("kitty")) {
		raw = "kitty";
	} else if (isSet("ALACRITTY_SOCKET") || env.TERM === "alacritty") {
		raw = "Alacritty";
	} else if (isSet("KONSOLE_VERSION")) {
		raw = withVersion("Konsole", nonBlank("KONSOLE_VERSION"));
	} else if (isSet("GNOME_TERMINAL_SCREEN")) {
		raw = "gnome-terminal";
	} else if (isSet("VTE_VERSION")) {
		raw = withVersion("VTE", nonBlank("VTE_VERSION"));
	} else if (isSet("WT_SESSION")) {
		raw = "WindowsTerminal";
	} else {
		raw = nonBlank("TERM") ?? "unknown";
	}
	// Rust char semantics (sanitize_header_value): one `_` per code point, not per UTF-16 unit.
	return raw.replace(/[^A-Za-z0-9\-_./]/gu, "_");
}

/** `codex_cli_rs/0.163.0 (<os_type> <os_version>; <arch>) <terminal>` (default_client.rs:152-170). */
export function userAgent(facts: PlatformFacts): string {
	return `${CODEX_ORIGINATOR}/${CODEX_VERSION} (${facts.osType} ${facts.osVersion}; ${facts.arch}) ${facts.terminal}`;
}

export function validateExtraMetadata(extra: Record<string, string> | undefined): Record<string, string> {
	const entries = Object.entries(extra ?? {});
	if (entries.length > MAX_EXTRA_ENTRIES) throw new Error("extra metadata may contain at most 16 entries");
	for (const [key, value] of entries) {
		if (Buffer.byteLength(key) > MAX_EXTRA_KEY_BYTES || !/^[A-Za-z][A-Za-z0-9_.-]*$/.test(key)) {
			throw new Error("extra metadata keys must be short ASCII identifiers");
		}
		if (RESERVED_EXTRA_KEYS.includes(key)) throw new Error(`extra metadata key is reserved: ${key}`);
		if (Buffer.byteLength(value) > MAX_EXTRA_VALUE_BYTES) throw new Error("extra metadata values may contain at most 128 bytes");
	}
	const kept = entries.filter(([key]) => !BACKWARD_COMPATIBLE_EXTRA_KEYS.includes(key));
	const out: Record<string, string> = {};
	for (const key of utf8Keys(kept.map(([key]) => key))) setOwn(out, key, extra?.[key]);
	return out;
}

// BTreeMap of workspaces; struct fields keep native declaration order (associated_remote_urls, latest_git_commit_hash, has_changes).
function orderWorkspaces(workspaces: Record<string, WorkspaceMetadata>): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const key of utf8Keys(Object.keys(workspaces))) {
		const w = workspaces[key];
		const item: Record<string, unknown> = {
			associated_remote_urls: w.associated_remote_urls ? sortKeys(w.associated_remote_urls) : undefined,
			latest_git_commit_hash: w.latest_git_commit_hash,
			has_changes: w.has_changes,
		};
		for (const k of Object.keys(item)) if (item[k] === undefined) delete item[k];
		setOwn(out, key, item);
	}
	return out;
}

const MCP_ATTRIBUTION_STATUSES: readonly string[] = ["none", "complete", "attribution_error"];
// responses_metadata.rs MAX_MCP_ATTRIBUTION_BYTES = 16 * 1024 (checked on UTF-8 bytes of the plain serialization).
const MAX_MCP_ATTRIBUTION_BYTES = 16 * 1024;
const MCP_ATTRIBUTION_TOO_LARGE = '{"status":"attribution_error","error_reason":"payload_too_large"}';

/** Native McpAttribution body value: serde field order, absent error_reason and empty sources omitted, not ASCII-escaped. */
export function mcpAttributionJson(value: McpAttribution): string {
	if (!MCP_ATTRIBUTION_STATUSES.includes(value.status)) throw new Error("mcp attribution status is not a native value");
	const item: Record<string, unknown> = {
		status: value.status,
		error_reason: value.error_reason,
		sources: value.sources && value.sources.length > 0
			? value.sources.map((s) => ({ connector_id: s.connector_id, plugin_id: s.plugin_id, server_name: s.server_name, tool_name: s.tool_name, first_turn_id: s.first_turn_id }))
			: undefined,
	};
	for (const key of Object.keys(item)) if (item[key] === undefined) delete item[key];
	const json = JSON.stringify(item);
	// Native to_json_string_bounded WriteZero path: the exact attribution_error value, not a thrown error.
	if (Buffer.byteLength(json) > MAX_MCP_ATTRIBUTION_BYTES) return MCP_ATTRIBUTION_TOO_LARGE;
	return json;
}

/** Native TurnToolNamespacesInfo: BTreeMap keys sorted, struct fields in declaration order (never sorted), null code_mode_name. */
function orderToolNamespaces(info: ToolNamespacesInfo | undefined): Record<string, unknown> | undefined {
	if (info === undefined) return undefined;
	const out: Record<string, unknown> = {};
	for (const key of utf8Keys(Object.keys(info))) {
		const namespace = info[key];
		const functions: Record<string, unknown> = {};
		for (const name of utf8Keys(Object.keys(namespace.functions))) {
			const fn = namespace.functions[name];
			setOwn(functions, name, {
				name: fn.name,
				direct: fn.direct,
				code_mode_name: fn.code_mode_name ?? null,
				deferred: fn.deferred,
				source: fn.source.kind === "harness" ? { kind: "harness" } : { kind: "mcp", server_name: fn.source.server_name },
			});
		}
		setOwn(out, key, { name: namespace.name, functions });
	}
	return out;
}

function hasRequestIdentity(kind: RequestKind | undefined): boolean {
	return kind !== undefined && kind !== "memory";
}
function hasThreadIdentity(kind: RequestKind | undefined): boolean {
	return kind !== "memory";
}

/**
 * Canonical turn metadata blob (responses_metadata.rs:548-609 field order). Omitted optionals stay absent.
 * `includeNamespaces` is true for the body and false for the compatibility header.
 */
export function turnMetadataPayload(identity: CodexIdentity, requestKind: RequestKind | undefined, includeNamespaces = true): Record<string, unknown> {
	const thread = hasThreadIdentity(requestKind);
	const request = hasRequestIdentity(requestKind);
	const workspaces = identity.workspaces && Object.keys(identity.workspaces).length > 0 ? orderWorkspaces(identity.workspaces) : undefined;
	const payload: Record<string, unknown> = {
		installation_id: request ? identity.installationId : undefined,
		session_id: thread ? identity.rootSessionId : undefined,
		thread_id: thread ? identity.threadId : undefined,
		agent_name: thread ? identity.agentName : undefined,
		turn_id: identity.turnId,
		window_id: request ? identity.windowId : undefined,
		window_number: request ? identity.windowNumber : undefined,
		context_window_id: request ? identity.contextWindowId : undefined,
		request_kind: requestKind,
		history_initialization: identity.historyInitialization,
		forked_from_thread_id: identity.forkedFromThreadId,
		forked_from_ordinal_exclusive: identity.forkedFromOrdinalExclusive,
		parent_thread_id: identity.parentThreadId,
		parent_turn_id: identity.parentTurnId,
		root_turn_id: identity.rootTurnId,
		subagent_kind: identity.subagentKind,
		thread_source: identity.threadSource,
		turn_trigger: identity.turnTrigger,
		sandbox: identity.sandbox,
		sandbox_mode: identity.sandboxMode,
		auto_review_enabled: identity.autoReviewEnabled,
		node_repl_auto_review_required: identity.nodeReplAutoReviewRequired,
		node_repl_disabled: identity.nodeReplDisabled,
		workspaces,
		tool_namespaces_info: includeNamespaces ? orderToolNamespaces(identity.toolNamespacesInfo) : undefined,
		turn_started_at_unix_ms: identity.turnStartedAtUnixMs,
		history_ingest_requested: identity.historyIngestRequested,
		analytics_enabled: identity.analyticsEnabled,
		compaction: requestKind === "compaction" && identity.compaction
			? { trigger: identity.compaction.trigger, reason: identity.compaction.reason, implementation: identity.compaction.implementation, phase: identity.compaction.phase, strategy: identity.compaction.strategy ?? "memento" }
			: undefined,
	};
	for (const [k, v] of Object.entries(validateExtraMetadata(identity.extra))) payload[k] = v;
	for (const key of Object.keys(payload)) if (payload[key] === undefined) delete payload[key];
	return payload;
}

/**
 * Body `client_metadata` projection (core/src/client.rs:887-904; responses_metadata.rs:336-381). Strings only.
 * The turn blob is included only when a request kind exists and contains the tool namespace inventory.
 */
export function clientMetadata(identity: CodexIdentity, requestKind?: RequestKind): Record<string, string> {
	const out: Record<string, string> = {
		[HEADER_INSTALLATION_ID]: identity.installationId,
		session_id: identity.rootSessionId,
		thread_id: identity.threadId,
		[HEADER_WINDOW_ID]: identity.windowId,
	};
	if (identity.turnId !== undefined) out.turn_id = identity.turnId;
	if (identity.subagentHeader !== undefined) out[HEADER_SUBAGENT] = identity.subagentHeader;
	if (identity.parentThreadId !== undefined) out[HEADER_PARENT_THREAD_ID] = identity.parentThreadId;
	if (identity.parentTurnId !== undefined) out.parent_turn_id = identity.parentTurnId;
	if (identity.rootTurnId !== undefined) out.root_turn_id = identity.rootTurnId;
	if (requestKind !== undefined) out[HEADER_TURN_METADATA] = asciiJson(turnMetadataPayload(identity, requestKind, true));
	if (identity.mcpAttribution !== undefined) out.mcp_attribution = mcpAttributionJson(identity.mcpAttribution);
	// Native set_guardian_metadata: a credit REQUEST flag for ordinary subscription requests, not a Guardian privilege.
	if (identity.authProfile === "subscription" && identity.guardianCreditsRequested !== false) out.guardian_credits_requested = "true";
	return out;
}

/**
 * Compatibility headers (client.rs:160-176; codex-api/src/requests/headers.rs; design §5). Auth is not here:
 * the caller adds Authorization and ChatGPT-Account-ID last. `transport` decides the OpenAI-Beta value.
 */
export function identityHeaders(identity: CodexIdentity, options: { requestKind?: RequestKind; transport: "sse" | "websocket"; platform: PlatformFacts }): Record<string, string> {
	const headers: Record<string, string> = {
		originator: CODEX_ORIGINATOR,
		"User-Agent": userAgent(options.platform),
		version: CODEX_VERSION,
		"session-id": identity.rootSessionId,
		"thread-id": identity.threadId,
		"x-client-request-id": identity.threadId,
		[HEADER_WINDOW_ID]: identity.windowId,
	};
	if (options.requestKind !== undefined) headers[HEADER_TURN_METADATA] = asciiJson(turnMetadataPayload(identity, options.requestKind, false));
	if (identity.parentThreadId !== undefined) headers[HEADER_PARENT_THREAD_ID] = identity.parentThreadId;
	if (identity.subagentHeader !== undefined) headers[HEADER_SUBAGENT] = identity.subagentHeader;
	if (options.transport === "websocket") headers["OpenAI-Beta"] = WS_OPENAI_BETA;
	return headers;
}

function runGit(cwd: string, args: string[]): Promise<string | undefined> {
	return new Promise((resolve) => {
		// Child-only environment copy: the process environment is never mutated.
		execFile("git", ["-C", cwd, "--no-optional-locks", ...args], { env: { ...process.env, GIT_TERMINAL_PROMPT: "0" }, maxBuffer: 1 << 20, timeout: 5000 }, (error, stdout) => {
			resolve(error ? undefined : String(stdout));
		});
	});
}

/**
 * Remote URL with credentials removed: userinfo dropped (SSH `git` user kept, as native does), query and fragment dropped
 * (stricter than native). SCP-style `user@host:path` loses only `user@`. Unparseable input returns undefined.
 */
export function sanitizeGitRemote(raw: string): string | undefined {
	const value = raw.trim();
	const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):\/\//.exec(value);
	if (scheme) {
		try {
			const url = new URL(value);
			const keepGitUser = url.protocol === "ssh:" && url.username === "git" && !url.password;
			return `${url.protocol}//${keepGitUser ? "git@" : ""}${url.host}${url.pathname}`;
		} catch {
			return undefined;
		}
	}
	const at = value.indexOf("@");
	const colon = value.indexOf(":");
	if (colon < 0) return undefined;
	return at >= 0 && at < colon ? value.slice(at + 1) : value;
}

/**
 * Sanitized actual git facts for `workspaces`, keyed by the repository top-level path (as native).
 * Returns {} outside a git repository. Runs only `git -C <cwd>` read-only subcommands.
 */
export async function collectWorkspaceMetadata(cwd: string): Promise<Record<string, WorkspaceMetadata>> {
	const top = await runGit(cwd, ["rev-parse", "--show-toplevel"]);
	if (top === undefined) return {};
	const root = top.trim();
	const meta: WorkspaceMetadata = {};
	const head = await runGit(cwd, ["rev-parse", "HEAD"]);
	if (head !== undefined) meta.latest_git_commit_hash = head.trim();
	const status = await runGit(cwd, ["status", "--porcelain", "--untracked-files=normal"]);
	if (status !== undefined) meta.has_changes = status.trim().length > 0;
	const remotes = await runGit(cwd, ["config", "--get-regexp", "^remote\\..*\\.url$"]);
	if (remotes !== undefined) {
		const urls: Record<string, string> = {};
		for (const line of remotes.split("\n")) {
			const m = /^remote\.(.+)\.url (.*)$/.exec(line);
			if (!m) continue;
			const clean = sanitizeGitRemote(m[2]);
			if (clean !== undefined) setOwn(urls, m[1], clean);
		}
		if (Object.keys(urls).length > 0) meta.associated_remote_urls = sortKeys(urls) as Record<string, string>;
	}
	return { [root]: meta };
}
