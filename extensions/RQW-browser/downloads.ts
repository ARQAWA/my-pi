import { lstat, mkdir, rename, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import type { Browser, CDPSession, Page } from "puppeteer-core";
import { untilAborted } from "./abort.ts";
import { devtoolsFrameId } from "./frames.ts";

// Adapted from oh-my-pi 18.8.9 (browser/downloads.ts), MIT; see THIRD-PARTY-NOTICES.md.

/** Completed download metadata returned by tab download helpers. */
export interface BrowserDownload {
	path: string;
	suggestedFilename: string;
	url: string;
	bytes: number;
}

interface DownloadStarted {
	guid: string;
	url: string;
	suggestedFilename: string;
}

interface DownloadProgress {
	guid: string;
	state: "inProgress" | "completed" | "canceled";
	receivedBytes: number;
	/** Saved location on completion, in whichever folder Chromium was pointed at last. */
	filePath?: string;
}

interface PendingDownload extends DownloadStarted {
	receivedBytes: number;
}

interface DownloadWaiter {
	resolve(value: BrowserDownload): void;
	reject(error: unknown): void;
	signal: AbortSignal;
	onAbort: () => void;
}

/** Chromium names an `allowAndName` download after its GUID, a lowercase UUID. */
const DOWNLOAD_GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Owns tab-scoped Chromium download behavior and completion events. */
export class DownloadManager {
	readonly #browser: Browser;
	readonly #page: Page;
	readonly #defaultDirectory: string;
	readonly #perTab: boolean;
	#directory?: string;
	#session?: CDPSession;
	#attaching?: Promise<void>;
	#closed = false;
	readonly #pending = new Map<string, PendingDownload>();
	readonly #completed: BrowserDownload[] = [];
	readonly #unclaimed: BrowserDownload[] = [];
	readonly #waiters: DownloadWaiter[] = [];
	#willBegin?: (event: DownloadStarted & { frameId: string }) => void;
	#progress?: (event: DownloadProgress) => void;

	/**
	 * `perTab` saves under download GUIDs and moves each tab's own files to their suggested names. Leave it off for a
	 * browser the user drives: there the folder also receives the user's own downloads, which would otherwise be saved
	 * under bare GUIDs nobody renames.
	 */
	constructor(browser: Browser, page: Page, defaultDirectory: string, options: { perTab: boolean }) {
		this.#browser = browser;
		this.#page = page;
		this.#defaultDirectory = defaultDirectory;
		this.#perTab = options.perTab;
	}

	/** The folder downloads land in once tracking is on. */
	get directory(): string {
		return this.#directory ?? this.#defaultDirectory;
	}

	/** Point the browser's download folder at `directory` (this tab's default when omitted) and start tracking. */
	async enable(directory?: string): Promise<void> {
		const resolved = resolve(directory ?? this.#defaultDirectory);
		await mkdir(resolved, { recursive: true });
		// A tracking cancelled while attaching still finishes; the next enable joins it instead of attaching again.
		if (!this.#session) await (this.#attaching ??= this.#attach().finally(() => { this.#attaching = undefined; }));
		const context = this.#page.browserContext() as { id?: string };
		await this.#session!.send("Browser.setDownloadBehavior", {
			behavior: this.#perTab ? "allowAndName" : "allow",
			downloadPath: resolved,
			eventsEnabled: true,
			...(context.id ? { browserContextId: context.id } : {}),
		});
		this.#directory = resolved;
	}

	/** Wait for the next completed download that nobody has claimed yet. */
	async wait(signal: AbortSignal): Promise<BrowserDownload> {
		if (this.#unclaimed.length === 0) {
			// Whoever pointed Chromium last wins and resets it when closing, so point it here again.
			await untilAborted(this.enable(this.#directory), signal, late => { late.catch(() => {}); });
		}
		const ready = this.#unclaimed.shift();
		if (ready) return { ...ready };
		if (signal.aborted) throw signal.reason;
		return await new Promise<BrowserDownload>((resolvePromise, reject) => {
			const waiter: DownloadWaiter = {
				resolve: resolvePromise,
				reject,
				signal,
				onAbort: () => {
					this.#removeWaiter(waiter);
					reject(signal.reason);
				},
			};
			signal.addEventListener("abort", waiter.onAbort, { once: true });
			this.#waiters.push(waiter);
		});
	}

	/** Return every completed download for this tab. */
	list(): BrowserDownload[] {
		return this.#completed.map(download => ({ ...download }));
	}

	/** Detach event listeners and reject outstanding waits. */
	async close(): Promise<void> {
		this.#closed = true;
		const session = this.#session;
		if (!session) return;
		if (this.#willBegin) session.off("Browser.downloadWillBegin", this.#willBegin);
		if (this.#progress) session.off("Browser.downloadProgress", this.#progress);
		for (const waiter of this.#waiters.splice(0)) {
			waiter.signal.removeEventListener("abort", waiter.onAbort);
			waiter.reject(new Error("Tab closed while waiting for a download"));
		}
		this.#session = undefined;
		await session.detach().catch(() => undefined);
	}

	async #attach(): Promise<void> {
		const session = await this.#browser.target().createCDPSession();
		// Closed while attaching: nobody is left to detach this session.
		if (this.#closed) {
			await session.detach().catch(() => undefined);
			return;
		}
		this.#willBegin = event => {
			// Every session hears every download in the browser; keep the ones this tab's frames started.
			if (!this.#page.frames().some(frame => devtoolsFrameId(frame) === event.frameId)) return;
			this.#pending.set(event.guid, { guid: event.guid, url: event.url, suggestedFilename: event.suggestedFilename, receivedBytes: 0 });
		};
		this.#progress = event => {
			const pending = this.#pending.get(event.guid);
			if (!pending) return;
			pending.receivedBytes = event.receivedBytes;
			if (event.state === "inProgress") return;
			this.#pending.delete(event.guid);
			if (event.state === "canceled") {
				this.#rejectNext(new Error(`Download canceled: ${pending.url}`));
				return;
			}
			void this.#complete(pending, event.filePath).catch(error => {
				this.#rejectNext(new Error(`Download failed: ${pending.url}: ${error instanceof Error ? error.message : String(error)}`));
			});
		};
		session.on("Browser.downloadWillBegin", this.#willBegin as never);
		session.on("Browser.downloadProgress", this.#progress as never);
		this.#session = session;
	}

	async #complete(pending: PendingDownload, filePath: string | undefined): Promise<void> {
		const directory = this.directory;
		const source = filePath ?? join(directory, this.#perTab ? pending.guid : pending.suggestedFilename);
		await waitForFile(source);
		// Only the last segment of the suggested name is used; anything else, or a download that cannot be moved, is
		// reported where Chromium saved it.
		const name = typeof pending.suggestedFilename === "string" ? basename(pending.suggestedFilename) : "";
		const target = join(directory, name);
		const movable = this.#perTab && name !== "" && name !== "." && name !== ".." && (await canMoveDownload(source, pending.guid, target));
		const downloadPath = movable ? await rename(source, target).then(() => target, () => source) : source;
		const download: BrowserDownload = { path: downloadPath, suggestedFilename: pending.suggestedFilename, url: pending.url, bytes: pending.receivedBytes };
		this.#completed.push(download);
		const waiter = this.#waiters.shift();
		if (!waiter) {
			this.#unclaimed.push(download);
			return;
		}
		waiter.signal.removeEventListener("abort", waiter.onAbort);
		waiter.resolve({ ...download });
	}

	#rejectNext(error: Error): void {
		const waiter = this.#waiters.shift();
		if (!waiter) return;
		waiter.signal.removeEventListener("abort", waiter.onAbort);
		waiter.reject(error);
	}

	#removeWaiter(waiter: DownloadWaiter): void {
		const index = this.#waiters.indexOf(waiter);
		if (index >= 0) this.#waiters.splice(index, 1);
	}
}

/** Chromium reports a download complete a moment before the file shows up under its final name. */
async function waitForFile(file: string): Promise<void> {
	for (let attempt = 0; attempt < 100; attempt++) {
		try {
			await stat(file);
			return;
		} catch {
			await new Promise<void>(done => setTimeout(done, 10));
		}
	}
}

/**
 * Whether `source` is a regular file saved under a UUID-shaped download GUID, and `target` is free or a file it may
 * replace. The peer names the GUID, the saved path and the suggested name, so a symlink or directory stays where it is.
 */
async function canMoveDownload(source: string, guid: string, target: string): Promise<boolean> {
	if (!DOWNLOAD_GUID.test(guid) || basename(source) !== guid) return false;
	return (await entryKind(source)) === "file" && (await entryKind(target)) !== "other";
}

/** What a path names, without following a symlink there. */
async function entryKind(file: string): Promise<"file" | "missing" | "other"> {
	try {
		return (await lstat(file)).isFile() ? "file" : "other";
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "other";
	}
}
