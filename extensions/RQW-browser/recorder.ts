import type { Browser, Page } from "puppeteer-core";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { untilAborted } from "./abort.ts";

async function button(page: Page, label: string, signal: AbortSignal): Promise<void> {
	const handle = await untilAborted(page.waitForFunction((wanted: string) => {
		const walk = (root: Document | ShadowRoot): Element | null => {
			for (const element of root.querySelectorAll("*")) {
				const text = element.getAttribute("title") || element.getAttribute("aria-label") || (element.children.length === 0 ? element.textContent?.trim() : "");
				if (text === wanted) return element;
				if (element.shadowRoot) { const found = walk(element.shadowRoot); if (found) return found; }
			}
			return null;
		};
		return walk(document);
	}, { timeout: 5000 }, label), signal);
	try {
		const element = handle.asElement();
		if (!element) throw new Error(`Recorder button ${label} not found.`);
		await untilAborted(element.click(), signal);
	} finally { await handle.dispose(); }
}

export async function startRecording(browser: Browser, signal: AbortSignal): Promise<Page | null> {
	const matches = (target: ReturnType<Browser["targets"]>[number]) => target.url().startsWith("devtools://") && target.url().includes("hasOtherClients=true");
	let target = browser.targets().find(matches);
	if (!target && typeof browser.waitForTarget === "function") {
		try { target = await untilAborted(browser.waitForTarget(matches, { timeout: 5000 }), signal); }
		catch (error) { if (signal.aborted) throw error; }
	}
	if (!target) return null;
	const page = await untilAborted(target.asPage(), signal);
	if (!page) return null;
	const modifier = process.platform === "darwin" ? "Meta" : "Control";
	await untilAborted(page.keyboard.down(modifier), signal);
	await untilAborted(page.keyboard.down("Shift"), signal);
	try { await untilAborted(page.keyboard.press("KeyP"), signal); }
	finally { await page.keyboard.up("Shift"); await page.keyboard.up(modifier); }
	await untilAborted(page.keyboard.type("Recorder"), signal);
	await untilAborted(page.keyboard.press("Enter"), signal);
	await button(page, "Create recording", signal);
	await untilAborted(page.keyboard.press("Enter"), signal);
	return page;
}

export async function finishRecording(page: Page, folder: string, signal: AbortSignal): Promise<string> {
	await button(page, "End recording", signal);
	const flows = await untilAborted(page.evaluate(() => new Promise<string>(resolve => {
		(globalThis as typeof globalThis & { InspectorFrontendHost: { getPreferences(callback: (preferences: Record<string, string>) => void): void } }).InspectorFrontendHost.getPreferences(preferences => resolve(preferences["recorder-recordings-ng"]!));
	})), signal);
	const recording = JSON.parse(flows).at(-1)?.flow;
	if (!recording || !Array.isArray(recording.steps)) throw new Error("Recorder returned no recording.");
	const path = join(folder, "recording.json");
	await writeFile(path, JSON.stringify(recording, null, 2));
	return path;
}
