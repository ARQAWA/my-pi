import type { ElementHandle, ElementScreenshotOptions, Page } from "puppeteer-core";
import { untilAborted } from "./abort.ts";
import { scrollElementIntoView } from "./interactions.ts";

// Adapted from oh-my-pi 18.8.9 (browser/screenshot.ts, browser/tab-worker.ts), MIT; see THIRD-PARTY-NOTICES.md.

export interface ScreenshotOptions {
	selector?: string;
	fullPage?: boolean;
	format?: "png" | "jpeg";
	quality?: number;
}

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

/** Shrinks a capture to what a model can read, or null when it cannot be made small enough. */
export type ResizeScreenshot = (bytes: Uint8Array, mimeType: string) => Promise<ResizedScreenshot | null>;

export interface ScreenshotEnvironment {
	/** Whether the tab may be brought to the front; false for a browser the user drives. */
	activate: boolean;
	resolveSelector: (selector: string) => Promise<ElementHandle | null>;
	resize: ResizeScreenshot;
	images: ScreenshotImage[];
}

export interface ScreenshotResult {
	mimeType: string;
	width: number;
	height: number;
	originalWidth: number;
	originalHeight: number;
}

function validateQuality(options: ScreenshotOptions): number | undefined {
	if (options.quality === undefined) return undefined;
	if (options.format !== "jpeg") throw new Error('Screenshot quality is only valid with format: "jpeg"');
	if (!Number.isInteger(options.quality) || options.quality < 0 || options.quality > 100) {
		throw new Error("Screenshot JPEG quality must be an integer from 0 to 100");
	}
	return options.quality;
}

async function prepare(page: Page, activate: boolean, signal: AbortSignal): Promise<void> {
	if (activate) {
		await untilAborted(page.bringToFront(), signal).catch(error => {
			if (signal.aborted) throw error;
		});
		return;
	}
	const visible = await untilAborted(page.evaluate(() => document.visibilityState === "visible"), signal).catch(error => {
		if (signal.aborted) throw error;
		return false;
	});
	if (!visible) throw new Error("The attached browser tab is not visible; switch to it before taking a screenshot");
}

async function waitForRenderFrame(page: Page, signal: AbortSignal): Promise<void> {
	await untilAborted(
		page.evaluate(
			() =>
				new Promise<void>(resolve => {
					(globalThis as unknown as { requestAnimationFrame(callback: () => void): number }).requestAnimationFrame(() => resolve());
				}),
		),
		signal,
	);
}

async function capture(page: Page, options: ScreenshotOptions, quality: number | undefined, environment: ScreenshotEnvironment, signal: AbortSignal): Promise<Uint8Array> {
	const type = options.format ?? "png";
	if (options.selector) {
		// A resolution that finishes after cancellation still owns a handle.
		const handle = await untilAborted(environment.resolveSelector(options.selector), signal, late => { void late.then(found => found?.dispose()).catch(() => {}); });
		if (!handle) throw new Error("Screenshot selector did not resolve to an element");
		try {
			await scrollElementIntoView(handle, signal).catch(error => {
				if (signal.aborted) throw error;
			});
			await waitForRenderFrame(page, signal);
			const shot: ElementScreenshotOptions = { type, quality, scrollIntoView: false };
			return await untilAborted(handle.screenshot(shot), signal);
		} finally {
			void handle.dispose().catch(() => undefined);
		}
	}
	await waitForRenderFrame(page, signal);
	return await untilAborted(page.screenshot({ type, quality, fullPage: options.fullPage ?? false }), signal);
}

/**
 * Capture the page or one element. The shrunk image goes to `environment.images`, which the tool returns as Pi image
 * results; the returned summary says what was captured.
 */
export async function takeScreenshot(page: Page, options: ScreenshotOptions, environment: ScreenshotEnvironment, signal: AbortSignal): Promise<ScreenshotResult> {
	await prepare(page, environment.activate, signal);
	const bytes = await capture(page, options, validateQuality(options), environment, signal);
	const mimeType = options.format === "jpeg" ? "image/jpeg" : "image/png";
	const resized = await untilAborted(environment.resize(bytes, mimeType), signal);
	if (!resized) throw new Error("Screenshot is too large to return as an image; capture a smaller area with a selector");
	environment.images.push({ type: "image", data: resized.data, mimeType: resized.mimeType });
	const { width, height, originalWidth, originalHeight } = resized;
	return { mimeType: resized.mimeType, width, height, originalWidth, originalHeight };
}
