import type { ElementHandle, Page } from "puppeteer-core";
import { untilAborted } from "./abort.ts";
import type { DialogController } from "./dialogs.ts";
import { ClickRefusedError, clickElement, fillElement, pressKey, selectOptions, setElementChecked, typeIntoElement } from "./interactions.ts";
import { type NavigationWaitUntil, gotoPage, reloadPage, traverseHistory, waitForUrl } from "./navigation.ts";
import type { ObservedElements } from "./observe.ts";
import { actionMs, budgetBound, quickMs, waitMs, withDeadline } from "./ops.ts";
import { type ResizeScreenshot, type ScreenshotImage, takeScreenshot } from "./screenshot.ts";
import { waitForText } from "./waits.ts";

// Adapted from oh-my-pi 18.8.9 (browser/tab-worker.ts), MIT; see THIRD-PARTY-NOTICES.md.

export interface ActionContext {
	page: Page;
	owned: boolean;
	observed: ObservedElements;
	dialogs: DialogController;
	signal: AbortSignal;
	budgetMs: number;
	images: ScreenshotImage[];
	resize: ResizeScreenshot;
}

function stringArgs(label: string, args: string[]): string[] {
	if (args.some(arg => typeof arg !== "string")) throw new Error(`${label} takes string arguments.`);
	return args;
}

function valueArg(label: string, args: string[]): string {
	if (args.length !== 1) throw new Error(`${label} takes exactly one string value.`);
	return stringArgs(label, args)[0]!;
}

async function timeoutHint(ctx: ActionContext, error: unknown): Promise<string> {
	let hint = error instanceof ClickRefusedError ? `; the element never became clickable (last check: ${error.refusal})` : "";
	const dialog = ctx.dialogs.state();
	if (dialog.open) hint += `; a ${dialog.type}(${JSON.stringify((dialog.message ?? "").slice(0, 80))}) dialog is open and may block the page; set a dialog policy when opening the tab`;
	return hint;
}

export function elementActions(handle: ElementHandle, ctx: ActionContext) {
	const run = <T>(method: string, work: (signal: AbortSignal, name: string) => Promise<T>) => {
		const name = `handle.${method}()`;
		return withDeadline(name, actionMs(ctx.budgetMs), ctx.signal, signal => work(signal, name), error => timeoutHint(ctx, error));
	};
	return {
		click: () => run("click", (signal, name) => clickElement(handle, name, signal)),
		check: () => run("check", (signal, name) => setElementChecked(handle, true, name, signal)),
		uncheck: () => run("uncheck", (signal, name) => setElementChecked(handle, false, name, signal)),
		type: (...args: string[]) => run("type", (signal, name) => typeIntoElement(handle, valueArg(name, args), signal)),
		fill: (...args: string[]) => run("fill", (signal, name) => fillElement(handle, valueArg(name, args), signal)),
		select: (...args: string[]) => run("select", (signal, name) => selectOptions(handle, stringArgs(name, args), name, signal)),
		press: (key: string) => run("press", async signal => {
			await untilAborted(handle.focus(), signal);
			await pressKey(ctx.page, key, signal);
		}),
	};
}

export function tabActions(ctx: ActionContext) {
	const { page } = ctx;
	const ms = actionMs(ctx.budgetMs);
	const bound = budgetBound(ctx.budgetMs);
	const quick = <T>(name: string, work: (signal: AbortSignal) => Promise<T>, limit = ms) =>
		withDeadline(name, limit, ctx.signal, work, error => timeoutHint(ctx, error));
	return {
		async goto(url: string, options?: { waitUntil?: NavigationWaitUntil }): Promise<string> {
			if (typeof url !== "string") throw new Error("tab.goto(url) takes the URL as a string.");
			ctx.observed.clear();
			return await gotoPage(page, url, options?.waitUntil ?? "load", bound, ctx.signal);
		},
		back: (options?: { waitUntil?: NavigationWaitUntil }) => traverseHistory(page, "back", options?.waitUntil ?? "load", bound, ctx.signal),
		forward: (options?: { waitUntil?: NavigationWaitUntil }) => traverseHistory(page, "forward", options?.waitUntil ?? "load", bound, ctx.signal),
		reload: (options?: { waitUntil?: NavigationWaitUntil }) => reloadPage(page, options?.waitUntil ?? "load", bound, ctx.signal),
		waitForUrl: (pattern: string | RegExp, options?: { timeout?: number }) => {
			const limit = waitMs(ctx.budgetMs, options?.timeout);
			return quick("tab.waitForUrl()", signal => waitForUrl(page, pattern, limit, signal), limit);
		},
		waitForText: async (text: string, options?: { timeout?: number; exact?: boolean }) => {
			const limit = waitMs(ctx.budgetMs, options?.timeout);
			await quick(`tab.waitForText(${JSON.stringify(text)})`, signal => waitForText(page, text, options ?? {}, signal), limit);
		},
		press: (key: string) => quick(`tab.press(${JSON.stringify(key)})`, signal => pressKey(page, key, signal)),
		screenshot: () => quick("tab.screenshot()", signal => takeScreenshot(page, { activate: ctx.owned, images: ctx.images, resize: ctx.resize }, signal), quickMs(ctx.budgetMs)),
	};
}
