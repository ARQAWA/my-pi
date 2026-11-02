import type { Page } from "puppeteer-core";
import { untilAborted } from "./abort.ts";

// Adapted from oh-my-pi 18.8.9 (browser/screenshot.ts), MIT; see THIRD-PARTY-NOTICES.md.

export interface ScreenshotImage {
	type: "image";
	data: string;
	mimeType: string;
}

interface ResizedScreenshot {
	data: string;
	mimeType: string;
	width: number;
	height: number;
	originalWidth: number;
	originalHeight: number;
}

export type ResizeScreenshot = (bytes: Uint8Array, mimeType: string) => Promise<ResizedScreenshot | null>;

export async function takeScreenshot(page: Page, environment: { activate: boolean; resize: ResizeScreenshot; images: ScreenshotImage[] }, signal: AbortSignal) {
	if (environment.activate) {
		await untilAborted(page.bringToFront(), signal).catch(error => { if (signal.aborted) throw error; });
	} else {
		const visible = await untilAborted(page.evaluate(() => document.visibilityState === "visible"), signal).catch(error => {
			if (signal.aborted) throw error;
			return false;
		});
		if (!visible) throw new Error("The attached browser tab is not visible; switch to it before taking a screenshot");
	}
	await untilAborted(page.evaluate(() => new Promise<void>(resolve => {
		(globalThis as unknown as { requestAnimationFrame(callback: () => void): number }).requestAnimationFrame(() => resolve());
	})), signal);
	const bytes = await untilAborted(page.screenshot({ type: "png", quality: undefined, fullPage: false }), signal);
	const resized = await untilAborted(environment.resize(bytes, "image/png"), signal);
	if (!resized) throw new Error("Screenshot is too large to return as an image");
	environment.images.push({ type: "image", data: resized.data, mimeType: resized.mimeType });
	const { width, height, originalWidth, originalHeight } = resized;
	return { mimeType: resized.mimeType, width, height, originalWidth, originalHeight };
}
