import type { Page, WaitForOptions } from "puppeteer-core";
import { untilAborted } from "./abort.ts";
import { sleep } from "./ops.ts";

// Adapted from oh-my-pi 18.8.9 (browser/navigation.ts, browser/tab-worker.ts), MIT; see THIRD-PARTY-NOTICES.md.

declare module "puppeteer-core" {
	interface Frame {
		/** CDP lifecycle events the frame's current document has reached (`@internal` upstream, stripped from published types). */
		readonly _lifecycleEvents: ReadonlySet<string>;
	}
}

export type NavigationWaitUntil = "load" | "domcontentloaded" | "networkidle0" | "networkidle2";

/** CDP lifecycle event behind each `waitUntil` that is read from the main frame alone. */
const MAIN_FRAME_LIFECYCLE_EVENTS = { load: "load", domcontentloaded: "DOMContentLoaded" } as const;
const MAIN_FRAME_POLL_MS = 50;

/** Puppeteer-compatible timeout error, so callers treat both timeouts alike. */
function navigationTimeoutError(timeout: number): Error {
	const error = new Error(`Navigation timeout of ${timeout} ms exceeded`);
	error.name = "TimeoutError";
	return error;
}

/**
 * Run `navigate` and wait for the main document to reach `waitUntil`.
 *
 * Puppeteer's `load` and `domcontentloaded` also wait for that event in every child frame that started loading, so one
 * iframe that never finishes (ad, chat widget, challenge) times out a page whose own document is ready. Puppeteer therefore
 * only waits for the commit, and the main frame's lifecycle events decide the rest. Any other `waitUntil` keeps Puppeteer's
 * own wait, which also validates the value.
 */
export async function navigateMainFrame(
	page: Page,
	waitUntil: NonNullable<WaitForOptions["waitUntil"]>,
	timeout: number,
	signal: AbortSignal,
	navigate: (options: WaitForOptions) => Promise<unknown>,
): Promise<void> {
	if (waitUntil !== "load" && waitUntil !== "domcontentloaded") {
		await untilAborted(navigate({ waitUntil, timeout }), signal);
		return;
	}
	const deadline = Date.now() + timeout;
	await untilAborted(navigate({ waitUntil: [], timeout }), signal);
	const event = MAIN_FRAME_LIFECYCLE_EVENTS[waitUntil];
	for (;;) {
		if (page.isClosed() || !page.browser().connected) throw new Error("Navigating frame was detached");
		const frame = page.mainFrame();
		if (frame.detached) throw new Error("Navigating frame was detached");
		if (frame._lifecycleEvents.has(event)) return;
		const remaining = deadline - Date.now();
		if (remaining <= 0) throw navigationTimeoutError(timeout);
		// The last read lands on the deadline, so an event that arrives after it is a timeout.
		await sleep(Math.min(MAIN_FRAME_POLL_MS, remaining), signal);
	}
}

/** Best-effort `Page.stopLoading`, so an abandoned navigation cannot stall later operations. */
export async function stopLoading(page: Page): Promise<void> {
	try {
		const session = await page.createCDPSession();
		try {
			await session.send("Page.stopLoading");
		} finally {
			await session.detach().catch(() => undefined);
		}
	} catch {
		// The page may be gone already.
	}
}

/** Navigate to `url`; a navigation that outlasts `timeout` is stopped so the page stays on what loaded. */
export async function gotoPage(page: Page, url: string, waitUntil: NavigationWaitUntil, timeout: number, signal: AbortSignal): Promise<string> {
	try {
		await navigateMainFrame(page, waitUntil, timeout, signal, options => page.goto(url, options));
	} catch (error) {
		if (!(error instanceof Error && error.name === "TimeoutError")) throw error;
		await stopLoading(page);
		throw new Error(`tab.goto(${JSON.stringify(url)}) timed out after ${timeout}ms; pending navigation stopped; retry with a longer tool timeout or waitUntil:"domcontentloaded"`);
	}
	return page.url();
}

export async function traverseHistory(page: Page, direction: "back" | "forward", waitUntil: NavigationWaitUntil, timeout: number, signal: AbortSignal): Promise<string> {
	const navigate = direction === "back" ? page.goBack.bind(page) : page.goForward.bind(page);
	await navigateMainFrame(page, waitUntil, timeout, signal, navigate);
	return page.url();
}

export async function reloadPage(page: Page, waitUntil: NavigationWaitUntil, timeout: number, signal: AbortSignal): Promise<string> {
	await navigateMainFrame(page, waitUntil, timeout, signal, options => page.reload(options));
	return page.url();
}

/** Wait until the page URL contains `pattern` (a string) or matches it (a RegExp). */
export async function waitForUrl(page: Page, pattern: string | RegExp, timeout: number, signal: AbortSignal): Promise<string> {
	const isRegex = pattern instanceof RegExp;
	await untilAborted(
		page.waitForFunction(
			(matcher: string, regex: boolean, flags: string) => {
				const url = (globalThis as unknown as { location: { href: string } }).location.href;
				return regex ? new RegExp(matcher, flags).test(url) : url.includes(matcher);
			},
			{ timeout, polling: 200, signal },
			isRegex ? pattern.source : pattern,
			isRegex,
			isRegex ? pattern.flags : "",
		),
		signal,
	);
	return page.url();
}
