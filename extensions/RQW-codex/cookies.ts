// Infrastructure-only ChatGPT cookies for the owned Codex WebSocket and SSE transports.
// Native source (read-only evidence): codex-rs/http-client/src/chatgpt_cloudflare_cookies.rs:17-22 (allowlist),
// :48-66 (cookie header assembly), :107-126 (Set-Cookie ingestion), :151-215 (lookup), and
// codex-rs/http-client/src/chatgpt_hosts.rs (allowed hosts). Native keeps one process-wide jar; this module keeps a
// scoped in-memory jar instead, passed explicitly, so no other module or extension shares it unless it asks.
// Account, session and auth cookies are never stored: only the allowlisted names below.

export const ALLOWED_COOKIE_NAMES: ReadonlySet<string> = new Set([
	"__cf_bm",
	"__cflb",
	"__cfruid",
	"__cfseq",
	"__cfwaitingroom",
	"__oailb",
	"_cfuvid",
	"cf_clearance",
	"cf_ob_info",
	"cf_use_ob",
]);

export function isAllowedCookieName(name: string): boolean {
	// cf_chl_* is the Cloudflare challenge family (chatgpt_cloudflare_cookies.rs:213).
	return ALLOWED_COOKIE_NAMES.has(name) || name.startsWith("cf_chl_");
}

// chatgpt_hosts.rs: exact hosts plus the two dot-suffixes.
export function isChatGptHost(host: string): boolean {
	const h = host.toLowerCase();
	return (
		h === "chatgpt.com" ||
		h === "chat.openai.com" ||
		h === "chatgpt-staging.com" ||
		h.endsWith(".chatgpt.com") ||
		h.endsWith(".chatgpt-staging.com")
	);
}

export function isLoopbackHost(host: string): boolean {
	return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
}

export class OriginError extends Error {
	name = "OriginError";
}

// Bearer-carrying requests may only go to ChatGPT hosts over https/wss. Loopback is accepted so that the
// test-only local endpoints work; production orchestration never passes a loopback URL. Any other origin is refused
// before a socket or fetch is created, which is the only network guard this module provides.
export function assertTransportOrigin(url: URL): void {
	if (isLoopbackHost(url.hostname)) return;
	if ((url.protocol === "https:" || url.protocol === "wss:") && isChatGptHost(url.hostname)) return;
	throw new OriginError(`refused non-ChatGPT origin ${url.protocol}//${url.host}`);
}

// A secure cookie scope: https and wss share cookies (chatgpt_cloudflare_cookies.rs:151-215 maps wss to https).
function isSecureScheme(url: URL): boolean {
	return url.protocol === "https:" || url.protocol === "wss:";
}

export type StoredCookie = {
	readonly name: string;
	readonly value: string;
	readonly domain: string;
	readonly hostOnly: boolean;
	readonly path: string;
	readonly expiresAt?: number;
};

function defaultPath(pathname: string): string {
	// RFC 6265 section 5.1.4 default-path.
	if (!pathname.startsWith("/")) return "/";
	const last = pathname.lastIndexOf("/");
	return last <= 0 ? "/" : pathname.slice(0, last);
}

function pathMatches(requestPath: string, cookiePath: string): boolean {
	if (requestPath === cookiePath) return true;
	if (!requestPath.startsWith(cookiePath)) return false;
	return cookiePath.endsWith("/") || requestPath.charAt(cookiePath.length) === "/";
}

export class CookieJar {
	private readonly cookies = new Map<string, StoredCookie>();
	private readonly now: () => number;

	constructor(now: () => number = Date.now) {
		this.now = now;
	}

	// Stores allowlisted cookies from a response to a ChatGPT https/wss URL. Responses from other origins
	// (including loopback test endpoints) are ignored.
	ingest(url: URL, setCookieHeaders: readonly string[] | undefined): void {
		if (!setCookieHeaders || setCookieHeaders.length === 0) return;
		if (!isChatGptHost(url.hostname) || !isSecureScheme(url)) return;
		const host = url.hostname.toLowerCase();
		for (const raw of setCookieHeaders) {
			const parts = raw.split(";").map((part) => part.trim());
			const pair = parts[0] ?? "";
			const eq = pair.indexOf("=");
			if (eq <= 0) continue;
			const name = pair.slice(0, eq).trim();
			const value = pair.slice(eq + 1).trim();
			if (!isAllowedCookieName(name)) continue;
			let domain = host;
			let hostOnly = true;
			let path = defaultPath(url.pathname);
			let maxAgeAt: number | undefined;
			let expiresAt: number | undefined;
			let rejected = false;
			for (const attribute of parts.slice(1)) {
				const at = attribute.indexOf("=");
				const key = (at < 0 ? attribute : attribute.slice(0, at)).trim().toLowerCase();
				const attrValue = at < 0 ? "" : attribute.slice(at + 1).trim();
				if (key === "domain") {
					const candidate = attrValue.replace(/^\./, "").toLowerCase();
					if (!isChatGptHost(candidate) || !(host === candidate || host.endsWith(`.${candidate}`))) {
						rejected = true;
						break;
					}
					domain = candidate;
					hostOnly = false;
				} else if (key === "path" && attrValue.startsWith("/")) {
					path = attrValue;
				} else if (key === "max-age") {
					const seconds = Number(attrValue);
					if (Number.isFinite(seconds)) maxAgeAt = this.now() + seconds * 1000;
				} else if (key === "expires") {
					const time = Date.parse(attrValue);
					if (!Number.isNaN(time)) expiresAt = time;
				}
			}
			if (rejected) continue;
			// Max-Age wins over Expires (RFC 6265 section 5.3 step 3).
			const deadline = maxAgeAt ?? expiresAt;
			const key = `${domain}\u0000${path}\u0000${name}`;
			if (deadline !== undefined && deadline <= this.now()) {
				this.cookies.delete(key);
				continue;
			}
			this.cookies.set(key, { name, value, domain, hostOnly, path, expiresAt: deadline });
		}
	}

	// Cookie header for a request to a ChatGPT https/wss URL, or undefined. Non-ChatGPT URLs never get cookies.
	header(url: URL): string | undefined {
		if (!isChatGptHost(url.hostname) || !isSecureScheme(url)) return undefined;
		const host = url.hostname.toLowerCase();
		const now = this.now();
		const matched: StoredCookie[] = [];
		for (const [key, cookie] of this.cookies) {
			if (cookie.expiresAt !== undefined && cookie.expiresAt <= now) {
				this.cookies.delete(key);
				continue;
			}
			const hostMatches = cookie.hostOnly
				? host === cookie.domain
				: host === cookie.domain || host.endsWith(`.${cookie.domain}`);
			if (!hostMatches || !pathMatches(url.pathname, cookie.path)) continue;
			matched.push(cookie);
		}
		if (matched.length === 0) return undefined;
		matched.sort((a, b) => b.path.length - a.path.length);
		return matched.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
	}

	clear(): void {
		this.cookies.clear();
	}
}

// Default jar for callers that do not pass their own. Scoped to this module instance only.
export const sharedCookieJar = new CookieJar();
