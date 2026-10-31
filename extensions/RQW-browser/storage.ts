import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { Cookie, CookieParam, Page } from "puppeteer-core";
import { aborted, untilAborted } from "./abort.ts";

// Adapted from oh-my-pi 18.8.9 (browser/storage-state.ts), MIT; see THIRD-PARTY-NOTICES.md.

/** Web Storage area exposed by the browser helpers. */
export type StorageKind = "local" | "session";

/** Cookie fields returned by tab.cookies() and persisted in storage state files. */
export interface BrowserCookie {
	name: string;
	value: string;
	domain: string;
	path: string;
	/** Expiration time in Unix seconds, or -1 for a session cookie. */
	expires: number;
	httpOnly: boolean;
	secure: boolean;
	sameSite: "Strict" | "Lax" | "None";
}

/** Cookie accepted by tab.setCookies(). */
export interface BrowserCookieInput {
	name: string;
	value: string;
	domain?: string;
	path?: string;
	/** URL used to infer domain, path, and scheme. */
	url?: string;
	expires?: number;
	httpOnly?: boolean;
	secure?: boolean;
	sameSite?: "Strict" | "Lax" | "None";
}

/** Default domain or URL applied to imported cookie header entries. */
export interface CookieScope {
	domain?: string;
	url?: string;
}

export interface CookieQueryOptions {
	/** URLs whose matching cookies should be returned. */
	urls?: string[];
}

export interface ClearCookiesOptions {
	/** Cookie names to delete; omission deletes every current-page cookie. */
	names?: string[];
}

/** One origin's Web Storage entries in a storage state file. */
export interface StorageStateOrigin {
	origin: string;
	localStorage: Array<{ name: string; value: string }>;
	sessionStorage?: Array<{ name: string; value: string }>;
}

/** Playwright-compatible browser state with sessionStorage as an omp extension. */
export interface BrowserStorageState {
	cookies: BrowserCookie[];
	origins: StorageStateOrigin[];
}

/** Summary of origins restored or skipped by tab.loadState(). */
export interface LoadStateResult {
	/** Origins whose Web Storage was restored. */
	loadedOrigins: string[];
	/** Origins skipped because safe hidden navigation was unavailable or failed. */
	skippedOrigins: string[];
}

interface LoadStateOptions {
	allowOtherOrigins: boolean;
	navigationTimeoutMs: number;
	signal: AbortSignal;
}

interface BrowserStorageArea {
	readonly length: number;
	key(index: number): string | null;
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	clear(): void;
}

const COOKIE_PARSE_ERROR = "tab.setCookies() received malformed cookie input";
const COOKIE_SET_ERROR = "tab.setCookies() could not set the supplied cookies";
const STORAGE_STATE_ERROR = "tab.loadState() received an invalid browser state file";
const COOKIE_NAME_RE = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cookieView(cookie: Cookie): BrowserCookie {
	return {
		name: cookie.name,
		value: cookie.value,
		domain: cookie.domain,
		path: cookie.path,
		expires: cookie.expires,
		httpOnly: cookie.httpOnly ?? false,
		secure: cookie.secure,
		sameSite: cookie.sameSite === "Strict" || cookie.sameSite === "Lax" || cookie.sameSite === "None" ? cookie.sameSite : "Lax",
	};
}

function isScope(value: unknown): value is CookieScope {
	if (!isRecord(value) || "name" in value || "value" in value) return false;
	return Object.keys(value).every(key => key === "domain" || key === "url");
}

function parseCookieObject(value: unknown): BrowserCookieInput {
	if (!isRecord(value) || typeof value.name !== "string" || typeof value.value !== "string") throw new Error(COOKIE_PARSE_ERROR);
	if (!COOKIE_NAME_RE.test(value.name)) throw new Error(COOKIE_PARSE_ERROR);
	const cookie: BrowserCookieInput = { name: value.name, value: value.value };
	for (const key of ["domain", "path", "url"] as const) {
		const field = value[key];
		if (field !== undefined && typeof field !== "string") throw new Error(COOKIE_PARSE_ERROR);
		if (field !== undefined) cookie[key] = field;
	}
	for (const key of ["httpOnly", "secure"] as const) {
		const field = value[key];
		if (field !== undefined && typeof field !== "boolean") throw new Error(COOKIE_PARSE_ERROR);
		if (field !== undefined) cookie[key] = field;
	}
	if (value.expires !== undefined) {
		if (typeof value.expires !== "number" || !Number.isFinite(value.expires)) throw new Error(COOKIE_PARSE_ERROR);
		cookie.expires = value.expires;
	}
	if (value.sameSite !== undefined) {
		if (value.sameSite !== "Strict" && value.sameSite !== "Lax" && value.sameSite !== "None") throw new Error(COOKIE_PARSE_ERROR);
		cookie.sameSite = value.sameSite;
	}
	return cookie;
}

function parseCookieHeader(header: string): BrowserCookieInput[] {
	const cookies: BrowserCookieInput[] = [];
	for (const part of header.split(";")) {
		const separator = part.indexOf("=");
		if (separator <= 0) throw new Error(COOKIE_PARSE_ERROR);
		const name = part.slice(0, separator).trim();
		const value = part.slice(separator + 1).trim();
		if (!COOKIE_NAME_RE.test(name)) throw new Error(COOKIE_PARSE_ERROR);
		cookies.push({ name, value });
	}
	return cookies;
}

function extractCurlCookieHeaders(source: string): string[] {
	const headers: string[] = [];
	const pattern = /(?:^|\s)(?:-H|--header)\s+(?:'([^']*)'|"([^"]*)"|([^\s]+))/gi;
	for (const match of source.matchAll(pattern)) {
		const header = match[1] ?? match[2] ?? match[3] ?? "";
		const separator = header.indexOf(":");
		if (separator < 0 || header.slice(0, separator).trim().toLowerCase() !== "cookie") continue;
		headers.push(header.slice(separator + 1).trim());
	}
	return headers;
}

function parseCookieString(source: string): BrowserCookieInput[] {
	const trimmed = source.trim();
	if (!trimmed) throw new Error(COOKIE_PARSE_ERROR);
	if (trimmed.startsWith("[")) {
		let parsed: unknown;
		try {
			parsed = JSON.parse(trimmed);
		} catch {
			throw new Error(COOKIE_PARSE_ERROR);
		}
		if (!Array.isArray(parsed) || parsed.length === 0) throw new Error(COOKIE_PARSE_ERROR);
		return parsed.map(parseCookieObject);
	}
	const curlHeaders = extractCurlCookieHeaders(trimmed);
	if (curlHeaders.length > 0) return curlHeaders.flatMap(parseCookieHeader);
	return parseCookieHeader(trimmed.replace(/^cookie\s*:\s*/i, ""));
}

/** Parse `tab.setCookies()` arguments (objects, Cookie headers, cURL dumps, JSON arrays, trailing scope). */
export function normalizeCookieArguments(args: unknown[]): CookieParam[] {
	if (args.length === 0) throw new Error(COOKIE_PARSE_ERROR);
	const items = [...args];
	const scope = isScope(items.at(-1)) ? (items.pop() as CookieScope) : undefined;
	if (items.length === 0) throw new Error(COOKIE_PARSE_ERROR);
	const parsed = items.flatMap(item => (typeof item === "string" ? parseCookieString(item) : [parseCookieObject(item)]));
	return parsed.map(cookie => ({ ...scope, ...cookie }));
}

/** A Web Storage value as stored: strings verbatim, anything else JSON. */
function storageValue(value: unknown): string {
	if (typeof value === "string") return value;
	let serialized: string | undefined;
	try {
		serialized = JSON.stringify(value);
	} catch {
		throw new Error("tab.setStorage() could not serialize a supplied value");
	}
	if (serialized === undefined) throw new Error("tab.setStorage() could not serialize a supplied value");
	return serialized;
}

/** The key/value pairs of a `tab.setStorage()` entries object. */
function storageEntries(value: unknown): Array<[string, string]> {
	if (!isRecord(value)) throw new Error("tab.setStorage() expects a key/value object");
	return Object.keys(value).map(key => [key, storageValue(value[key])]);
}

function assertStorageKind(kind: string): asserts kind is StorageKind {
	if (kind !== "local" && kind !== "session") throw new Error('Storage kind must be "local" or "session"');
}

// Page functions: serialized into the page, so they must stay self-contained.

/** The current origin's Web Storage, or null for an opaque origin. */
function readOriginStorageInPage(): StorageStateOrigin | null {
	const scope = globalThis as unknown as { location: { origin: string }; localStorage: BrowserStorageArea; sessionStorage: BrowserStorageArea };
	if (scope.location.origin === "null") return null;
	const entries = (store: BrowserStorageArea): Array<{ name: string; value: string }> => {
		const result: Array<{ name: string; value: string }> = [];
		for (let index = 0; index < store.length; index++) {
			const name = store.key(index);
			if (name !== null) result.push({ name, value: store.getItem(name) ?? "" });
		}
		return result;
	};
	return { origin: scope.location.origin, localStorage: entries(scope.localStorage), sessionStorage: entries(scope.sessionStorage) };
}

/** Replace the current origin's Web Storage with `state`. */
function restoreOriginStorageInPage(state: StorageStateOrigin): void {
	const scope = globalThis as unknown as { localStorage: BrowserStorageArea; sessionStorage: BrowserStorageArea };
	scope.localStorage.clear();
	for (const entry of state.localStorage) scope.localStorage.setItem(entry.name, entry.value);
	scope.sessionStorage.clear();
	for (const entry of state.sessionStorage ?? []) scope.sessionStorage.setItem(entry.name, entry.value);
}

/** Every pair of one storage area, or one key's value. */
function readStorageInPage(area: StorageKind, key: string | undefined): Record<string, string> | string | null {
	const scope = globalThis as unknown as { localStorage: BrowserStorageArea; sessionStorage: BrowserStorageArea };
	const store = area === "local" ? scope.localStorage : scope.sessionStorage;
	if (key !== undefined) return store.getItem(key);
	const result: Record<string, string> = {};
	for (let index = 0; index < store.length; index++) {
		const name = store.key(index);
		if (name !== null) result[name] = store.getItem(name) ?? "";
	}
	return result;
}

/** Store `pairs` in one storage area. */
function writeStorageInPage(area: StorageKind, pairs: Array<[string, string]>): void {
	const scope = globalThis as unknown as { localStorage: BrowserStorageArea; sessionStorage: BrowserStorageArea };
	const store = area === "local" ? scope.localStorage : scope.sessionStorage;
	for (const [key, entry] of pairs) store.setItem(key, entry);
}

/** Clear one storage area. */
function clearStorageInPage(area: StorageKind): void {
	const scope = globalThis as unknown as { localStorage: BrowserStorageArea; sessionStorage: BrowserStorageArea };
	(area === "local" ? scope.localStorage : scope.sessionStorage).clear();
}

function readOriginStorage(page: Page, signal: AbortSignal): Promise<StorageStateOrigin | null> {
	return untilAborted(page.evaluate(readOriginStorageInPage), signal);
}

function parseStorageEntries(value: unknown): Array<{ name: string; value: string }> {
	if (!Array.isArray(value)) throw new Error(STORAGE_STATE_ERROR);
	return value.map(entry => {
		if (!isRecord(entry) || typeof entry.name !== "string" || typeof entry.value !== "string") throw new Error(STORAGE_STATE_ERROR);
		return { name: entry.name, value: entry.value };
	});
}

function parseStorageState(value: unknown): BrowserStorageState {
	if (!isRecord(value) || !Array.isArray(value.cookies) || !Array.isArray(value.origins)) throw new Error(STORAGE_STATE_ERROR);
	const cookies = value.cookies.map(cookie => {
		const parsed = parseCookieObject(cookie);
		if (!parsed.domain || !parsed.path || parsed.expires === undefined) throw new Error(STORAGE_STATE_ERROR);
		return {
			...parsed,
			domain: parsed.domain,
			path: parsed.path,
			expires: parsed.expires,
			httpOnly: parsed.httpOnly ?? false,
			secure: parsed.secure ?? false,
			sameSite: parsed.sameSite ?? "Lax",
		};
	});
	const origins = value.origins.map(entry => {
		if (!isRecord(entry) || typeof entry.origin !== "string") throw new Error(STORAGE_STATE_ERROR);
		try {
			if (new URL(entry.origin).origin !== entry.origin) throw new Error(STORAGE_STATE_ERROR);
		} catch {
			throw new Error(STORAGE_STATE_ERROR);
		}
		return {
			origin: entry.origin,
			localStorage: parseStorageEntries(entry.localStorage),
			...(entry.sessionStorage === undefined ? {} : { sessionStorage: parseStorageEntries(entry.sessionStorage) }),
		};
	});
	return { cookies, origins };
}

/** Read cookies visible to the current page or the supplied URLs. */
export async function readCookies(page: Page, options: CookieQueryOptions = {}, signal: AbortSignal): Promise<BrowserCookie[]> {
	if (!Array.isArray(options.urls) && options.urls !== undefined) throw new Error("tab.cookies() expects urls to be an array");
	const cookies = await untilAborted(page.cookies(...(options.urls ?? [])), signal);
	return cookies.map(cookieView);
}

/** Parse and install cookie objects, raw Cookie headers, cURL dumps, or JSON arrays. */
export async function setPageCookies(page: Page, args: unknown[], signal: AbortSignal): Promise<void> {
	const cookies = normalizeCookieArguments(args);
	try {
		await untilAborted(page.setCookie(...cookies), signal);
	} catch {
		aborted(signal);
		throw new Error(COOKIE_SET_ERROR);
	}
}

/** Delete all current-page cookies or only cookies with selected names. */
export async function clearPageCookies(page: Page, options: ClearCookiesOptions = {}, signal: AbortSignal): Promise<void> {
	if (!Array.isArray(options.names) && options.names !== undefined) throw new Error("tab.clearCookies() expects names to be an array");
	const wanted = options.names ? new Set(options.names) : undefined;
	const cookies = await untilAborted(page.cookies(), signal);
	const matching = cookies.filter(cookie => !wanted || wanted.has(cookie.name));
	if (matching.length === 0) return;
	await untilAborted(page.deleteCookie(...matching.map(cookie => ({ name: cookie.name, domain: cookie.domain, path: cookie.path }))), signal);
}

/** Read all Web Storage pairs or one selected value from the current origin. */
export async function readStorage(page: Page, kind: string, options: { key?: string } = {}, signal: AbortSignal): Promise<Record<string, string> | string | null> {
	assertStorageKind(kind);
	if (options.key !== undefined && typeof options.key !== "string") throw new Error("tab.storage() expects key to be a string");
	return await untilAborted(page.evaluate(readStorageInPage, kind, options.key), signal);
}

/** Set one Web Storage pair or a map of pairs on the current origin. */
export async function setPageStorage(page: Page, kind: string, keyOrEntries: unknown, value: unknown, signal: AbortSignal): Promise<void> {
	assertStorageKind(kind);
	const entries = typeof keyOrEntries === "string" ? [[keyOrEntries, storageValue(value)] as [string, string]] : storageEntries(keyOrEntries);
	await untilAborted(page.evaluate(writeStorageInPage, kind, entries), signal);
}

/** Clear one Web Storage area on the current origin. */
export async function clearPageStorage(page: Page, kind: string, signal: AbortSignal): Promise<void> {
	assertStorageKind(kind);
	await untilAborted(page.evaluate(clearStorageInPage, kind), signal);
}

/** A path as the model writes it: `~/` is the home folder, anything relative is relative to the session's folder. */
export function resolveUserPath(path: string, cwd: string): string {
	return resolve(cwd, path.startsWith("~/") ? join(homedir(), path.slice(2)) : path);
}

/** Where `tab.saveState()` writes: the requested path, else `<stateDir>/<tab>.json`. */
function storageStatePath(tabName: string, requestedPath: string | undefined, cwd: string, stateDir: string): string {
	if (requestedPath !== undefined) return resolveUserPath(requestedPath, cwd);
	const safeName = tabName.replace(/[^A-Za-z0-9._-]/g, "_");
	const fileName = safeName === "." || safeName === ".." ? "_" : safeName || "main";
	return join(stateDir, `${fileName}.json`);
}

/** Save cookies and current-origin Web Storage to a Playwright-compatible state file, readable by its owner only. */
export async function saveStorageState(page: Page, name: string, requestedPath: string | undefined, cwd: string, stateDir: string, signal: AbortSignal): Promise<string> {
	if (requestedPath !== undefined && typeof requestedPath !== "string") throw new Error("tab.saveState() takes the file path as a string.");
	const destination = storageStatePath(name, requestedPath, cwd, stateDir);
	const [browserCookies, origin] = await Promise.all([untilAborted(page.browserContext().cookies(), signal), readOriginStorage(page, signal)]);
	const state: BrowserStorageState = { cookies: browserCookies.map(cookieView), origins: origin ? [origin] : [] };
	await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
	// A cookie file is a login: write a private copy under a name nobody can guess, never into an existing file or link
	// ("wx"), then move it over the old state in one step.
	const partial = `${destination}.${randomUUID()}.tmp`;
	try {
		await writeFile(partial, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600, flag: "wx" });
		await rename(partial, destination);
	} catch (error) {
		// A failed save must not leave a copy of the login behind.
		await rm(partial, { force: true });
		throw error;
	}
	return destination;
}

async function readStorageStateFile(requestedPath: string, cwd: string, signal: AbortSignal): Promise<BrowserStorageState> {
	if (typeof requestedPath !== "string" || requestedPath.length === 0) throw new Error(STORAGE_STATE_ERROR);
	try {
		const text = await untilAborted(readFile(resolveUserPath(requestedPath, cwd), "utf8"), signal);
		return parseStorageState(JSON.parse(text) as unknown);
	} catch (error) {
		aborted(signal);
		if (error instanceof Error && error.message === STORAGE_STATE_ERROR) throw error;
		throw new Error(STORAGE_STATE_ERROR);
	}
}

async function originOf(page: Page, signal: AbortSignal): Promise<string> {
	return await untilAborted(page.evaluate(() => (globalThis as unknown as { location: { origin: string } }).location.origin), signal);
}

/** Restore the Web Storage of an origin the tab is not on, through a hidden page; false when that is not possible. */
async function restoreOtherOrigin(page: Page, origin: StorageStateOrigin, options: LoadStateOptions): Promise<boolean> {
	const { signal } = options;
	let temporary: Page | undefined;
	try {
		temporary = await untilAborted(page.browserContext().newPage(), signal, late => { void late.then(found => found.close()).catch(() => {}); });
		await untilAborted(temporary.goto(`${origin.origin}/`, { waitUntil: "domcontentloaded", timeout: options.navigationTimeoutMs }), signal);
		if ((await originOf(temporary, signal)) !== origin.origin) return false;
		await untilAborted(temporary.evaluate(restoreOriginStorageInPage, origin), signal);
		return true;
	} catch {
		aborted(signal);
		return false;
	} finally {
		// Not awaited: a page blocked by a dialog never answers.
		if (temporary) void temporary.close().catch(() => undefined);
	}
}

/** Restore cookies and Web Storage from a saved browser state file. */
export async function loadStorageState(page: Page, requestedPath: string, cwd: string, options: LoadStateOptions): Promise<LoadStateResult> {
	const { signal } = options;
	const state = await readStorageStateFile(requestedPath, cwd, signal);
	if (state.cookies.length > 0) {
		try {
			await untilAborted(page.browserContext().setCookie(...state.cookies), signal);
		} catch {
			aborted(signal);
			throw new Error("tab.loadState() could not restore cookies from the browser state file");
		}
	}
	const currentOrigin = await originOf(page, signal);
	const loadedOrigins: string[] = [];
	const skippedOrigins: string[] = [];
	for (const origin of state.origins) {
		if (origin.origin === currentOrigin) {
			await untilAborted(page.evaluate(restoreOriginStorageInPage, origin), signal);
			loadedOrigins.push(origin.origin);
			continue;
		}
		// Closing a hidden page discards its sessionStorage, so only localStorage-only origins can be restored
		// without disturbing the caller's current page.
		const reachable = options.allowOtherOrigins && (origin.sessionStorage?.length ?? 0) === 0;
		if (reachable && (await restoreOtherOrigin(page, origin, options))) loadedOrigins.push(origin.origin);
		else skippedOrigins.push(origin.origin);
	}
	return { loadedOrigins, skippedOrigins };
}
