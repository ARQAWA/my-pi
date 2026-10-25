// Adapted from extensions/RQW-codex/metadata.ts at git commit a85b810e924010f35387045fc0cbbd9a1e7173cc.
// Narrowed extraction: ephemeral web request identity, native item IDs and truthful platform headers only.
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { machine as osMachine, release as osRelease, type as osType } from "node:os";

export const CODEX_VERSION = "0.163.0";
export const CODEX_ORIGINATOR = "codex_cli_rs";
// codex-rs/core/src/client.rs:160-176 header names; responses_metadata.rs:31-118 key names.
const HEADER_INSTALLATION_ID = "x-codex-installation-id";
const HEADER_WINDOW_ID = "x-codex-window-id";
export const HEADER_TURN_METADATA = "x-codex-turn-metadata";
const WS_OPENAI_BETA = "responses_websockets=2026-02-06"; // client.rs:1401-1405

export type RequestKind = "turn";
export interface CodexIdentity {
	installationId: string;
	windowId: string;
	contextWindowId?: string;
	rootSessionId: string;
	threadId: string;
	turnId?: string;
	turnStartedAtUnixMs?: number;
	authProfile?: "subscription";
}

interface PlatformFacts {
	osType: string;
	osVersion: string;
	arch: string;
	terminal: string;
}

/** Native BTreeMap<String> key order: UTF-8 bytes (Unicode scalar order), not UTF-16 code units. */
function utf8Keys(keys: string[]): string[] {
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
function osInfoVersion(raw: string | undefined): string {
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
function terminalToken(env: NodeJS.ProcessEnv): string {
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

/** Native turn field order, with only the ephemeral web research identity. */
export function turnMetadataPayload(identity: CodexIdentity, requestKind: RequestKind | undefined): Record<string, unknown> {
	const payload: Record<string, unknown> = {
		installation_id: requestKind ? identity.installationId : undefined,
		session_id: identity.rootSessionId,
		thread_id: identity.threadId,
		turn_id: identity.turnId,
		window_id: requestKind ? identity.windowId : undefined,
		context_window_id: requestKind ? identity.contextWindowId : undefined,
		request_kind: requestKind,
		turn_started_at_unix_ms: identity.turnStartedAtUnixMs,
	};
	for (const key of Object.keys(payload)) if (payload[key] === undefined) delete payload[key];
	return payload;
}

export function clientMetadata(identity: CodexIdentity, requestKind?: RequestKind): Record<string, string> {
	const out: Record<string, string> = {
		[HEADER_INSTALLATION_ID]: identity.installationId,
		session_id: identity.rootSessionId,
		thread_id: identity.threadId,
		[HEADER_WINDOW_ID]: identity.windowId,
	};
	if (identity.turnId !== undefined) out.turn_id = identity.turnId;
	if (requestKind !== undefined) out[HEADER_TURN_METADATA] = asciiJson(turnMetadataPayload(identity, requestKind));
	if (identity.authProfile === "subscription") out.guardian_credits_requested = "true";
	return out;
}

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
	if (options.requestKind !== undefined) headers[HEADER_TURN_METADATA] = asciiJson(turnMetadataPayload(identity, options.requestKind));
	if (options.transport === "websocket") headers["OpenAI-Beta"] = WS_OPENAI_BETA;
	return headers;
}
