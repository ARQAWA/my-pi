import { stripVTControlCharacters } from "node:util";
import { readStoredCredential } from "@earendil-works/pi-coding-agent";

// Missing sources never imply a full or empty subscription.
export const QUOTA_REFRESH_MS = 5 * 60 * 1000;
export const QUOTA_COLORS = { CX: "201;162;39", KM: "229;228;226", CC: "205;127;50" } as const;
export type Quotas = Record<keyof typeof QUOTA_COLORS, string>;
type Snapshot = { windows: Record<string, { remainingPercent: number | null } | null> };
type Access = { refresh(signal?: AbortSignal): Promise<Snapshot> };
type Events = { emit(name: string, data: unknown): void };
const PROVIDERS = ["CX", "KM", "CC"] as const;
type Dependencies = { readCredential: typeof readStoredCredential; fetch: typeof globalThis.fetch };
const URLS = { CX: "https://chatgpt.com/backend-api/wham/usage", KM: "https://api.kimi.com/coding/v1/usages" };

function object(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid quota response");
	return value as Record<string, unknown>;
}
function remaining(value: unknown, scale: number): number {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > scale) {
		throw new Error("Invalid quota percentage");
	}
	return 100 * (1 - value / scale);
}
function parseUsage(id: "CX" | "KM", data: unknown): Snapshot {
	const payload = object(data);
	const windows: Snapshot["windows"] = {};
	if (id === "KM") {
		const usages = object(payload.usages);
		for (const name of ["limit_5h", "limit_7d", "limit_month_total", "limit_month_code"]) {
			if (usages[name] == null) continue;
			windows[name] = { remainingPercent: remaining(object(usages[name]).used_ratio, 1) };
		}
	} else {
		const add = (value: unknown, prefix = "") => {
			if (value == null) return;
			const limits = object(value);
			for (const name of ["primary_window", "secondary_window"]) {
				if (limits[name] == null) continue;
				const window = object(limits[name]);
				const seconds = window.limit_window_seconds;
				if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) {
					throw new Error("Invalid quota window");
				}
				windows[`${prefix}${name} ${seconds}s`] = { remainingPercent: remaining(window.used_percent, 100) };
			}
		};
		add(payload.rate_limit);
		if (payload.additional_rate_limits != null) {
			if (!Array.isArray(payload.additional_rate_limits)) throw new Error("Invalid quota groups");
			for (const value of payload.additional_rate_limits) {
				const group = object(value);
				if (typeof group.limit_name !== "string" || !group.limit_name) throw new Error("Invalid quota group");
				add(group.rate_limit, `${group.limit_name} `);
			}
		}
	}
	if (!Object.keys(windows).length) throw new Error("No quota windows");
	return { windows };
}

/** One-off stored-token reads only: never resolve auth or rotate expired tokens. */
async function fetchUsage(id: "CX" | "KM", signal: AbortSignal, deps: Dependencies): Promise<Snapshot> {
	const credential = deps.readCredential(id === "CX" ? "openai-codex" : "kimi-coding");
	if (credential?.type !== "oauth" || typeof credential.access !== "string" || !credential.access ||
		!Number.isFinite(credential.expires) || credential.expires <= Date.now()) throw new Error("Quota auth unavailable");
	const headers: Record<string, string> = { Authorization: `Bearer ${credential.access}` };
	if (id === "CX") {
		if (typeof credential.accountId !== "string" || !credential.accountId) throw new Error("Missing quota account");
		headers["ChatGPT-Account-Id"] = credential.accountId;
	}
	const deadline = new AbortController();
	const timer = setTimeout(() => deadline.abort(), 5000);
	const bounded = AbortSignal.any([signal, deadline.signal]);
	try {
		bounded.throwIfAborted();
		const response = await deps.fetch(URLS[id], { method: "GET", headers, redirect: "error", signal: bounded });
		if (!response.ok) {
			await response.body?.cancel();
			throw new Error("Quota request failed");
		}
		const data: unknown = await response.json();
		bounded.throwIfAborted();
		return parseUsage(id, data);
	} finally { clearTimeout(timer); }
}

export function quotaText(values: Quotas): string {
	return (Object.keys(QUOTA_COLORS) as (keyof Quotas)[]).map((id) =>
		`\x1b[38;2;${QUOTA_COLORS[id]}m${id} ${stripVTControlCharacters(values[id]).replace(/[\r\n\t]/g, " ")}\x1b[39m`).join("  ");
}

/** The footer owns the timer and request lifetime. Offers are requested afresh each cycle. */
export class QuotaConsumer {
	readonly values: Quotas = { CX: "unavailable", KM: "unavailable", CC: "unavailable" };
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
		this.timer = setInterval(() => { void this.refresh(); }, QUOTA_REFRESH_MS);
		this.timer.unref?.();
	}
	async refresh(): Promise<void> {
		const signal = this.controller?.signal;
		if (!signal || signal.aborted) return;
		const revision = ++this.revision;
		const current = () => !signal.aborted && revision === this.revision;
		await Promise.all(PROVIDERS.map(async (id) => {
			let access: Access | undefined;
			try {
				if (id === "CC") this.events.emit("rqw-anthropic:quota:v1", {
					sessionId: this.sessionId, offer(value: Access) { access = value; },
				});
				const snapshot = id === "CC" ? await access?.refresh(signal) : await fetchUsage(id, signal, this.deps);
				const windows = Object.entries(snapshot?.windows ?? {}).map(([name, value]) => {
					const percent = value?.remainingPercent;
					const text = typeof percent === "number" && Number.isFinite(percent) && percent >= 0 && percent <= 100
						? `${Math.round(percent)}%` : "unavailable";
					return `${name} ${text}`;
				});
				if (current()) this.values[id] = windows.join(" ") || "unavailable";
			} catch { if (current()) this.values[id] = "unavailable"; }
			if (current()) this.changed();
		}));
	}
	stop(): void {
		this.controller?.abort();
		if (this.timer) clearInterval(this.timer);
		this.timer = undefined;
	}
}
