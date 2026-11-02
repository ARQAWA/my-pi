import { createHash } from "node:crypto";
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { readStoredCredential } from "@earendil-works/pi-coding-agent";

// Missing sources never imply a full or empty subscription.
export const QUOTA_REFRESH_MS = 60 * 1000;
const QUOTA_CHECK_MS = 3 * 60 * 1000;
// Releases before CXC wrote CX-<account>.json without credits. They may still run in other tabs and
// would erase the credits from a shared file, so the credits-aware CX record has its own file.
const CACHE_NAME = { CX: "CX-credits", CC: "CC" } as const;
// Object order is the display order: credits, Codex weekly quota, Claude weekly quota.
export const QUOTA_COLORS = { CXC: "139;197;255", CX: "139;197;255", CC: "255;152;170" } as const;
export type Quotas = Partial<Record<keyof typeof QUOTA_COLORS, string>>;
type Reading = { percent?: number; credits?: string; okAt?: number; checkedAt?: number };
type Usage = { percent: number; credits?: string };

async function readCache(file: string): Promise<Reading> {
	try {
		const data = JSON.parse(await readFile(file, "utf8"));
		return {
			percent: typeof data.percent === "number" && Number.isFinite(data.percent) && data.percent >= 0 && data.percent <= 100 ? data.percent : undefined,
			credits: typeof data.credits === "string" && /^(?:[1-9]\d*|Unlimited)$/.test(data.credits) ? data.credits : undefined,
			okAt: typeof data.okAt === "number" && Number.isFinite(data.okAt) ? data.okAt : undefined,
			checkedAt: typeof data.checkedAt === "number" && Number.isFinite(data.checkedAt) ? data.checkedAt : undefined,
		};
	} catch { return {}; }
}

/** The last attempt failed when it is newer than the last good value; a success stamps okAt after checkedAt. */
function isStale(record: Reading): boolean {
	return record.okAt !== undefined && record.checkedAt !== undefined && record.okAt < record.checkedAt;
}

async function lockCache(file: string): Promise<boolean> {
	try {
		await mkdir(dirname(file), { recursive: true, mode: 0o700 });
		try { const lock = await open(`${file}.lock`, "wx", 0o600); await lock.close(); return true; }
		catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") return false; }
		if (Date.now() - (await stat(`${file}.lock`)).mtimeMs <= 30_000) return false;
		await unlink(`${file}.lock`);
		const lock = await open(`${file}.lock`, "wx", 0o600);
		await lock.close();
		return true;
	} catch { return false; }
}

async function writeCache(file: string, record: Reading): Promise<void> {
	const temporary = `${file}.${process.pid}.tmp`;
	try {
		await writeFile(temporary, JSON.stringify(record), { mode: 0o600 });
		await rename(temporary, file);
	} catch {} // A reader can briefly prevent rename on Windows; the next tick tries again.
	finally { await unlink(temporary).catch(() => {}); }
}
type Snapshot = { windows: Record<string, { remainingPercent: number | null } | null> };
type Access = { refresh(signal?: AbortSignal): Promise<Snapshot> };
type Events = { emit(name: string, data: unknown): void };
const PROVIDERS = ["CX", "CC"] as const;
type Dependencies = { readCredential: typeof readStoredCredential; fetch: typeof globalThis.fetch };
const WEEK_SECONDS = 7 * 24 * 60 * 60;
const URL = "https://chatgpt.com/backend-api/wham/usage";

function accountKey(credential: ReturnType<typeof readStoredCredential>): string | undefined {
	if (credential?.type !== "oauth") return;
	const account = typeof credential.accountId === "string" && credential.accountId ? credential.accountId : credential.refresh;
	return account ? createHash("sha256").update(account).digest("hex").slice(0, 16) : undefined;
}

function object(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid quota response");
	return value as Record<string, unknown>;
}
function remaining(value: unknown): number {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) {
		throw new Error("Invalid quota percentage");
	}
	return 100 - value;
}
/** The credits balance as Codex shows it: whole credits, "Unlimited", or nothing when there are none. */
function parseCredits(value: unknown): string | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return;
	const credits = value as Record<string, unknown>;
	if (credits.has_credits !== true) return;
	if (credits.unlimited === true) return "Unlimited";
	const balance = typeof credits.balance === "string" ? Number(credits.balance.trim() || NaN) : credits.balance;
	if (typeof balance !== "number" || !Number.isFinite(balance)) return;
	const whole = Math.round(balance);
	return whole > 0 ? String(whole) : undefined;
}

/** Whole credits with a dot between thousands: 10000 shows as 10.000. */
function creditsText(credits: string): string {
	return credits.replace(/\B(?=(\d{3})+$)/g, ".");
}

/** Codex's weekly window and credits from one response. */
function parseUsage(data: unknown): Usage {
	const payload = object(data);
	const limits = object(payload.rate_limit);
	for (const name of ["primary_window", "secondary_window"]) {
		if (limits[name] == null) continue;
		const window = object(limits[name]);
		if (window.limit_window_seconds === WEEK_SECONDS) return { percent: remaining(window.used_percent), credits: parseCredits(payload.credits) };
	}
	throw new Error("No weekly quota window");
}

/** One-off stored-token reads only: never resolve auth or rotate expired tokens. */
async function fetchUsage(signal: AbortSignal, deps: Dependencies): Promise<Usage> {
	const credential = deps.readCredential("openai-codex");
	if (credential?.type !== "oauth" || typeof credential.access !== "string" || !credential.access ||
		!Number.isFinite(credential.expires) || credential.expires <= Date.now()) throw new Error("Quota auth unavailable");
	if (typeof credential.accountId !== "string" || !credential.accountId) throw new Error("Missing quota account");
	const headers: Record<string, string> = { Authorization: `Bearer ${credential.access}`, "ChatGPT-Account-Id": credential.accountId };
	const deadline = new AbortController();
	const timer = setTimeout(() => deadline.abort(), 5000);
	const bounded = AbortSignal.any([signal, deadline.signal]);
	try {
		bounded.throwIfAborted();
		const response = await deps.fetch(URL, { method: "GET", headers, redirect: "error", signal: bounded });
		if (!response.ok) {
			await response.body?.cancel();
			throw new Error("Quota request failed");
		}
		const data: unknown = await response.json();
		bounded.throwIfAborted();
		return parseUsage(data);
	} finally { clearTimeout(timer); }
}

export function quotaText(values: Quotas): string {
	return (Object.keys(QUOTA_COLORS) as (keyof Quotas)[]).filter((id) => values[id] !== undefined).map((id) =>
		`\x1b[38;2;${QUOTA_COLORS[id]}m${id} ${stripVTControlCharacters(values[id]!).replace(/[\r\n\t]/g, " ")}\x1b[39m`).join("  ");
}

/** The footer owns the timer and request lifetime. Offers are requested afresh each cycle. */
export class QuotaConsumer {
	readonly values: Quotas = {};
	private accounts: Partial<Record<keyof Quotas, string>> = {};
	private controller?: AbortController;
	private revision = 0;
	private timer?: ReturnType<typeof setInterval>;
	private events: Events;
	private sessionId: string;
	private changed: () => void;
	private deps: Dependencies;
	constructor(events: Events, sessionId: string, changed: () => void,
		deps: Dependencies = { readCredential: readStoredCredential, fetch: globalThis.fetch }) {
		this.events = events;
		this.sessionId = sessionId;
		this.changed = changed;
		this.deps = deps;
	}
	start(): void {
		this.stop();
		this.controller = new AbortController();
		void this.refresh();
		this.timer = setInterval(() => this.refresh(), QUOTA_REFRESH_MS);
		this.timer.unref?.();
	}
	async refresh(): Promise<void> {
		const signal = this.controller?.signal;
		if (!signal || signal.aborted) return;
		const revision = ++this.revision;
		const current = () => !signal.aborted && revision === this.revision;
		await Promise.all(PROVIDERS.map(async (id) => {
			try {
				const provider = id === "CX" ? "openai-codex" : "anthropic";
				const credential = this.deps.readCredential(provider);
				if (!credential) {
					if (current()) { this.forget(id); delete this.accounts[id]; this.changed(); }
					return;
				}
				const key = accountKey(credential);
				if (!key) throw new Error("Quota account unavailable");
				if (this.accounts[id] !== key) { this.forget(id); this.accounts[id] = key; }
				const file = join(tmpdir(), "rqw-quota", `${CACHE_NAME[id]}-${key}.json`);
				const show = (record: Reading) => {
					if (!current()) return;
					if (record.percent !== undefined) {
						const star = isStale(record) ? "*" : "";
						this.values[id] = `${star}${record.percent}%`;
						if (id === "CX" && record.credits) this.values.CXC = `${star}${creditsText(record.credits)}`;
						else if (id === "CX") delete this.values.CXC;
					} else this.values[id] ??= "???";
					this.changed();
				};
				const fresh = (record: Reading) => record.checkedAt !== undefined && Date.now() - record.checkedAt < QUOTA_CHECK_MS;
				let record = await readCache(file);
				show(record);
				if (!current() || fresh(record) || !await lockCache(file)) return;
				try {
					// Another tab may have finished between our first read and acquiring the lock.
					record = await readCache(file);
					show(record);
					if (!current() || fresh(record)) return;
					record.checkedAt = Date.now();
					try {
						let access: Access | undefined;
						if (id === "CC") this.events.emit("rqw-anthropic:quota:v1", {
							sessionId: this.sessionId, offer(value: Access) { access = value; },
						});
						let percent: number | null | undefined;
						let credits: string | undefined;
						if (id === "CC") percent = (await access?.refresh(signal))?.windows.seven_day?.remainingPercent;
						else ({ percent, credits } = await fetchUsage(signal, this.deps));
						if (typeof percent === "number" && Number.isFinite(percent) && percent >= 0 && percent <= 100) {
							record.percent = Math.round(percent);
							record.credits = credits;
							record.okAt = Date.now();
						}
					} catch {}
					if (!current() || accountKey(this.deps.readCredential(provider)) !== key) return;
					await writeCache(file, record);
					show(record);
				} finally { await unlink(`${file}.lock`).catch(() => {}); }
			} catch { if (current()) { this.values[id] ??= "???"; this.changed(); } }
		}));
	}
	/** CXC comes from the same response as CX, so they go together. */
	private forget(id: keyof Quotas): void {
		delete this.values[id];
		if (id === "CX") delete this.values.CXC;
	}
	stop(): void {
		this.controller?.abort();
		if (this.timer) clearInterval(this.timer);
		this.timer = undefined;
	}
}
