import type { Page } from "puppeteer-core";
import { untilAborted } from "./abort.ts";
import { sleep } from "./ops.ts";
import { selectorReads } from "./reads.ts";

// Adapted from oh-my-pi 18.8.9 (browser/queries.ts), MIT; see THIRD-PARTY-NOTICES.md.

const TEXT_POLL_MS = 100;

/** Wait until `text` appears in the document body or a scoped element; the caller's deadline ends the wait. */
export async function waitForText(page: Page, text: string, options: { selector?: string; exact?: boolean }, signal: AbortSignal): Promise<void> {
	const reads = selectorReads(page, signal);
	for (;;) {
		const content = options.selector
			? await reads.text(options.selector)
			: await untilAborted(page.evaluate(() => (globalThis as unknown as { document: { body?: { innerText?: string } } }).document.body?.innerText ?? ""), signal);
		if (content !== null) {
			const candidate = content.trim();
			if (options.exact ? candidate === text : candidate.includes(text)) return;
		}
		await sleep(TEXT_POLL_MS, signal);
	}
}
