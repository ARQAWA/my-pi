import type { ElementHandle, Page } from "puppeteer-core";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { untilAborted } from "./abort.ts";

async function button(page: Page, label: string, signal: AbortSignal): Promise<void> {
	const handle = await untilAborted(page.waitForFunction((wanted: string) => {
		const walk = (root: Document | ShadowRoot): Element | null => {
			for (const element of root.querySelectorAll("*")) {
				const text = element.getAttribute("title") || element.getAttribute("aria-label") || (element.children.length === 0 ? element.textContent?.trim() : "");
				if (text === wanted || text?.startsWith(`${wanted} - `)) return element;
				if (element.shadowRoot) { const found = walk(element.shadowRoot); if (found) return found; }
			}
			return null;
		};
		return walk(document);
	}, { timeout: 5000 }, label), signal);
	try {
		const element = handle.asElement() as ElementHandle<Element> | null;
		if (!element) throw new Error(`Recorder button ${label} not found.`);
		await untilAborted(element.click(), signal);
	} finally { await handle.dispose(); }
}

async function waitForRecording(page: Page, active: boolean, signal: AbortSignal): Promise<void> {
	const handle = await untilAborted(page.waitForFunction(/* browser-context */ async (wanted: boolean) => {
		const path = new URL("./panels/recorder/recorder.js", location.href).href;
		const module = await import(path);
		const panel = module.RecorderPanel.RecorderPanel.instance();
		return panel.isRecording === wanted && !panel.isToggling && !!panel.currentRecording;
	}, { timeout: 5000 }, active), signal);
	await handle.dispose();
}

export async function startRecording(target: Page, signal: AbortSignal): Promise<Page> {
	const page = await untilAborted(target.openDevTools(), signal);
	const modifier = process.platform === "darwin" ? "Meta" : "Control";
	await untilAborted(page.keyboard.down(modifier), signal);
	await untilAborted(page.keyboard.down("Shift"), signal);
	try { await untilAborted(page.keyboard.press("KeyP"), signal); }
	finally { await page.keyboard.up("Shift"); await page.keyboard.up(modifier); }
	await untilAborted(page.keyboard.type("Recorder"), signal);
	await untilAborted(page.keyboard.press("Enter"), signal);
	await button(page, "Create recording", signal);
	try {
		await untilAborted(page.keyboard.press("Enter"), signal);
		await waitForRecording(page, true, signal);
	} catch (error) {
		const cleanup = AbortSignal.timeout(5000);
		await waitForRecording(page, true, cleanup).then(() => stopRecording(page, cleanup)).catch(() => {});
		throw error;
	}
	return page;
}

export async function stopRecording(page: Page, signal: AbortSignal): Promise<void> {
	const state = await untilAborted(page.evaluate(/* browser-context */ async () => {
		const path = new URL("./panels/recorder/recorder.js", location.href).href;
		const module = await import(path);
		const panel = module.RecorderPanel.RecorderPanel.instance();
		return { active: panel.isRecording, toggling: panel.isToggling };
	}), signal);
	if (!state.active && !state.toggling) return;
	if (state.toggling) await waitForRecording(page, true, signal);
	await button(page, "End recording", signal);
	await waitForRecording(page, false, signal);
}

export async function finishRecording(page: Page, folder: string, signal: AbortSignal): Promise<{ recording: string; script: string }> {
	await stopRecording(page, signal);
	const exports = await untilAborted(page.evaluate(/* browser-context */ async () => {
		const panelPath = new URL("./panels/recorder/recorder.js", location.href).href;
		const convertersPath = new URL("./panels/recorder/converters/converters.js", location.href).href;
		const panelModule = await import(panelPath);
		const converters = await import(convertersPath);
		const flow = panelModule.RecorderPanel.RecorderPanel.instance().currentRecording?.flow;
		if (!flow || !Array.isArray(flow.steps)) throw new Error("Recorder returned no recording.");
		const [recording] = await new converters.JSONConverter.JSONConverter("  ").stringify(flow);
		const [script] = await new converters.PuppeteerConverter.PuppeteerConverter("  ").stringify(flow);
		return { recording, script };
	}), signal);
	const recording = join(folder, "recording.json");
	const script = join(folder, "replay.js");
	await writeFile(recording, exports.recording);
	await writeFile(script, exports.script);
	return { recording, script };
}
