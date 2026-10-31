import type { ElementHandle, Frame, MouseButton, Page } from "puppeteer-core";
import { untilAborted } from "./abort.ts";
import { resolveAriaRef } from "./aria.ts";
import type { DialogController, DialogPolicy } from "./dialogs.ts";
import type { DownloadManager } from "./downloads.ts";
import {
	type ClickAtOptions,
	ClickRefusedError,
	clickAt,
	clickElement,
	clickTextMatch,
	dispatchScroll,
	fillElement,
	mouseMove,
	pressKey,
	scrollElementIntoView,
	selectOptions,
	setElementChecked,
	typeIntoElement,
	uploadFilesToElement,
	wheel,
} from "./interactions.ts";
import { type NavigationWaitUntil, gotoPage, pushState, reloadPage, traverseHistory, waitForUrl } from "./navigation.ts";
import type { ObservedElements } from "./observe.ts";
import { actionMs, budgetBound, quickMs, waitMs, withDeadline } from "./ops.ts";
import { type ResizeScreenshot, type ScreenshotImage, type ScreenshotOptions, takeScreenshot } from "./screenshot.ts";
import { normalizeSelector, parseAriaRefSelector } from "./selectors.ts";
import {
	type ClearCookiesOptions,
	type CookieQueryOptions,
	clearPageCookies,
	clearPageStorage,
	loadStorageState,
	readCookies,
	readStorage,
	resolveUserPath,
	saveStorageState,
	setPageCookies,
	setPageStorage,
} from "./storage.ts";
import { waitForText } from "./waits.ts";

// Adapted from oh-my-pi 18.8.9 (browser/tab-worker.ts), MIT; see THIRD-PARTY-NOTICES.md.

/** What the actions of one tool call need from their tab. */
export interface ActionContext {
	page: Page;
	/** Whether the extension launched the browser; a browser the user drives is never brought to the front. */
	owned: boolean;
	observed: ObservedElements;
	dialogs: DialogController;
	downloads: DownloadManager;
	/** The folder relative file paths of this call start from. */
	cwd: string;
	/** The tab's name, which names its default state file. */
	tabName: string;
	/** The folder `saveState` writes to when no path is given. */
	stateDir: () => Promise<string>;
	/** Whether `loadState` may restore the storage of other origins through a hidden page. */
	otherOrigins: boolean;
	signal: AbortSignal;
	/** The call's own timeout in milliseconds. */
	budgetMs: number;
	/** Screenshots of this call, returned as image results. */
	images: ScreenshotImage[];
	resize: ResizeScreenshot;
}

type Scope = Page | Frame;
type Performer = (handle: ElementHandle, signal: AbortSignal, label: string, ...args: string[]) => Promise<unknown>;

function stringArgs(label: string, args: string[]): string[] {
	if (args.some(arg => typeof arg !== "string")) throw new Error(`${label} takes string arguments.`);
	return args;
}

function valueArg(label: string, args: string[]): string {
	if (args.length !== 1) throw new Error(`${label} takes exactly one string value.`);
	return stringArgs(label, args)[0]!;
}

/** The element-level actions, shared by selector calls (`tab.click(selector)`) and handles (`tab.id(n)`, `tab.ref(id)`). */
const performers = {
	click: (handle, signal, label) => clickElement(handle, label, signal),
	dblclick: (handle, signal, label) => clickElement(handle, label, signal, { clickCount: 2 }),
	hover: (handle, signal) => untilAborted(handle.hover(), signal),
	focus: (handle, signal) => untilAborted(handle.focus(), signal),
	check: (handle, signal, label) => setElementChecked(handle, true, label, signal),
	uncheck: (handle, signal, label) => setElementChecked(handle, false, label, signal),
	type: (handle, signal, label, ...args) => typeIntoElement(handle, valueArg(label, args), signal),
	fill: (handle, signal, label, ...args) => fillElement(handle, valueArg(label, args), signal),
	select: (handle, signal, label, ...args) => selectOptions(handle, stringArgs(label, args), label, signal),
	scrollIntoView: (handle, signal) => scrollElementIntoView(handle, signal),
} satisfies Record<string, Performer>;
const performerList = Object.entries(performers) as Array<[keyof typeof performers, Performer]>;

// Page function: serialized into the page, so it must stay self-contained.
function scrollElementBy(el: unknown, deltaX: number, deltaY: number): void {
	(el as { scrollBy(options: { left: number; top: number; behavior: string }): void }).scrollBy({ left: deltaX, top: deltaY, behavior: "instant" });
}

/** The absolute paths of an upload, checked before any element is looked up. */
function uploadPaths(ctx: ActionContext, label: string, paths: string[]): string[] {
	if (!paths.length) throw new Error(`${label} requires at least one file path`);
	return stringArgs(label, paths).map(path => resolveUserPath(path, ctx.cwd));
}

function dispose(handle: ElementHandle): void {
	// Not awaited: a page blocked by a dialog never answers, and a finished call must not wait for it.
	void handle.dispose().catch(() => undefined);
}

async function selectorMatchCount(scope: Scope, selector: string): Promise<number | undefined> {
	if (parseAriaRefSelector(selector) !== null) return undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		const stalled = new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), 1_000); });
		const handles = await Promise.race([scope.$$(normalizeSelector(selector)), stalled]);
		if (!handles) return undefined;
		handles.forEach(dispose);
		return handles.length;
	} catch {
		return undefined;
	} finally {
		clearTimeout(timer);
	}
}

function selectorMatchHint(count: number): string {
	return count === 0
		? "; selector currently matches no elements; run tab.observe() or tab.ariaSnapshot() to inspect the page"
		: `; selector currently matches ${count} element(s) but the action never became possible; the element may be hidden or covered (try tab.scrollIntoView() or a more specific selector)`;
}

/** What to add to a timeout: why a click was refused, how many elements the selector matches, a dialog that blocks the page. */
async function timeoutHint(ctx: ActionContext, error: unknown, target?: { scope: Scope; selector: string }): Promise<string> {
	const count = target ? await selectorMatchCount(target.scope, target.selector) : undefined;
	const matches = count === undefined ? "" : selectorMatchHint(count);
	let hint = matches;
	if (error instanceof ClickRefusedError) {
		hint = `; the element never became clickable (last check: ${error.refusal}${count === undefined ? "" : `; selector matches ${count} element(s)`})`;
	}
	const dialog = ctx.dialogs.state();
	if (!dialog.open) return hint;
	return `${hint}; a ${dialog.type}(${JSON.stringify((dialog.message ?? "").slice(0, 80))}) dialog is open and may block the page; use tab.handleDialog() or tab.setDialogs("accept"|"dismiss")`;
}

async function resolveActionHandle(scope: Scope, ctx: ActionContext, selector: string, ms: number, signal: AbortSignal): Promise<ElementHandle> {
	const disposeLate = (late: Promise<ElementHandle>) => { void late.then(dispose).catch(() => {}); };
	if (parseAriaRefSelector(selector) !== null) {
		if (scope !== ctx.page) throw new Error("ARIA refs of a frame snapshot cannot be used as selectors; use a CSS selector.");
		return await untilAborted(resolveAriaRef(ctx.page, selector), signal, disposeLate);
	}
	const found = scope.locator(normalizeSelector(selector)).setTimeout(ms).waitHandle({ signal });
	return await untilAborted(found, signal, disposeLate);
}

function selectorActions(scope: Scope, ctx: ActionContext, prefix: string) {
	const ms = actionMs(ctx.budgetMs);

	/** Run one selector operation under its deadline; `work` gets the deadline's signal and the operation's name. */
	function run<T>(method: string, selector: string, work: (signal: AbortSignal, name: string) => Promise<T>, limit = ms): Promise<T> {
		const name = `${prefix}.${method}(${JSON.stringify(selector)})`;
		return withDeadline(name, limit, ctx.signal, signal => work(signal, name), error => timeoutHint(ctx, error, { scope, selector }));
	}

	function onElement<T>(method: string, selector: string, act: (handle: ElementHandle, signal: AbortSignal, name: string) => Promise<T>, limit = ms): Promise<T> {
		return run(method, selector, async (signal, name) => {
			const handle = await resolveActionHandle(scope, ctx, selector, limit, signal);
			try {
				return await act(handle, signal, name);
			} finally {
				dispose(handle);
			}
		}, limit);
	}

	const elementMethods = Object.fromEntries(
		performerList.map(([method, perform]) => [
			method,
			(selector: string, ...args: string[]) => onElement(method, selector, (handle, signal, name) => perform(handle, signal, name, ...args)),
		]),
	) as Record<keyof typeof performers, (selector: string, ...args: string[]) => Promise<unknown>>;

	const methods = {
		...elementMethods,
		click(selector: string): Promise<void> {
			// A text selector may match hidden copies of the text; pick the first visible clickable one.
			return run("click", selector, async (signal, name) => {
				const resolved = normalizeSelector(selector);
				if (resolved.startsWith("text/") && parseAriaRefSelector(selector) === null) return await clickTextMatch(scope, resolved, name, signal);
				const handle = await resolveActionHandle(scope, ctx, selector, ms, signal);
				try {
					await clickElement(handle, name, signal);
				} finally {
					dispose(handle);
				}
			});
		},
		async uploadFile(selector: string, ...paths: string[]): Promise<void> {
			const absolute = uploadPaths(ctx, `${prefix}.uploadFile(${JSON.stringify(selector)})`, paths);
			await onElement("uploadFile", selector, (handle, signal, name) => uploadFilesToElement(ctx.page, handle, absolute, name, signal));
		},
		async press(key: string, options?: { selector?: string }): Promise<void> {
			if (typeof options === "string") {
				throw new Error(`tab.press() takes (key, options) but was called as (selector, key). Did you mean tab.press(${JSON.stringify(options)}, { selector: ${JSON.stringify(key)} })?`);
			}
			await withDeadline(`${prefix}.press(${JSON.stringify(key)})`, ms, ctx.signal, async signal => {
				const selector = options?.selector;
				if (selector && parseAriaRefSelector(selector) !== null) {
					const handle = await resolveActionHandle(scope, ctx, selector, ms, signal);
					try {
						await untilAborted(handle.focus(), signal);
					} finally {
						dispose(handle);
					}
				} else if (selector) {
					await untilAborted(scope.focus(normalizeSelector(selector)), signal);
				}
				await pressKey(ctx.page, key, signal);
			}, error => timeoutHint(ctx, error));
		},
		async waitFor(selector: string, options?: { timeout?: number }): Promise<void> {
			const limit = waitMs(ctx.budgetMs, options?.timeout);
			await onElement("waitFor", selector, async () => undefined, limit);
		},
		async waitForSelector(selector: string, options?: { timeout?: number; visible?: boolean; hidden?: boolean }): Promise<void> {
			const limit = waitMs(ctx.budgetMs, options?.timeout);
			await run("waitForSelector", selector, async signal => {
				if (parseAriaRefSelector(selector) !== null) {
					dispose(await resolveActionHandle(scope, ctx, selector, limit, signal));
					return;
				}
				const found = await untilAborted(
					scope.waitForSelector(normalizeSelector(selector), { timeout: limit, visible: options?.visible, hidden: options?.hidden, signal }),
					signal,
				);
				if (found) dispose(found as ElementHandle);
			}, limit);
		},
	};
	return { methods, onElement };
}

/** Selector-based actions of one frame, where the frame handle of `tab.frame(...)` can call them. */
export function frameActions(frame: Frame, ctx: ActionContext) {
	const { click, fill, type, press, waitFor, waitForSelector } = selectorActions(frame, ctx, "frame").methods;
	return {
		click, fill, type, press, waitFor, waitForSelector,
		screenshot: (selector: string) => {
			if (typeof selector !== "string" || !selector.trim()) throw new Error("frame.screenshot() requires an element selector.");
			return withDeadline("frame.screenshot()", quickMs(ctx.budgetMs), ctx.signal, signal => takeScreenshot(ctx.page, { selector }, {
				activate: ctx.owned, images: ctx.images, resize: ctx.resize,
				resolveSelector: async value => await frame.$(normalizeSelector(value)),
			}, signal));
		},
	};
}

/** Actions of an element handle returned by `tab.id(n)` or `tab.ref(id)`. */
export function elementActions(handle: ElementHandle, ctx: ActionContext) {
	const performing = Object.fromEntries(
		performerList.map(([method, perform]) => [
			method,
			(...args: string[]) => {
				const name = `handle.${method}()`;
				return withDeadline(name, actionMs(ctx.budgetMs), ctx.signal, signal => perform(handle, signal, name, ...args), error => timeoutHint(ctx, error));
			},
		]),
	) as Record<keyof typeof performers, (...args: string[]) => Promise<unknown>>;
	return {
		...performing,
		press: async (key: string): Promise<void> => {
			await withDeadline("handle.press()", actionMs(ctx.budgetMs), ctx.signal, async signal => {
				await untilAborted(handle.focus(), signal);
				await pressKey(ctx.page, key, signal);
			}, error => timeoutHint(ctx, error));
		},
		uploadFile: async (...paths: string[]): Promise<void> => {
			const name = "handle.uploadFile()";
			const absolute = uploadPaths(ctx, name, paths);
			await withDeadline(name, actionMs(ctx.budgetMs), ctx.signal, signal => uploadFilesToElement(ctx.page, handle, absolute, name, signal), error => timeoutHint(ctx, error));
		},
	};
}

type DragTarget = string | { x: number; y: number };

/** Actions of the tab: navigation, mouse and keyboard, waits, screenshots and dialogs, plus the selector actions. */
export function tabActions(ctx: ActionContext) {
	const { page } = ctx;
	const ms = actionMs(ctx.budgetMs);
	const bound = budgetBound(ctx.budgetMs);
	const quick = <T>(name: string, work: (signal: AbortSignal) => Promise<T>, limit = ms) =>
		withDeadline(name, limit, ctx.signal, work, error => timeoutHint(ctx, error));

	async function dragPoint(target: DragTarget, role: "from" | "to", signal: AbortSignal): Promise<{ x: number; y: number; handle?: ElementHandle }> {
		if (typeof target === "string") {
			const handle = parseAriaRefSelector(target) !== null
				? await untilAborted(resolveAriaRef(page, target), signal)
				: await untilAborted(page.$(normalizeSelector(target)), signal);
			if (!handle) throw new Error(`Drag ${role} selector did not resolve: ${target}`);
			const box = await untilAborted(handle.boundingBox(), signal).catch(error => { dispose(handle); throw error; });
			if (!box) {
				dispose(handle);
				throw new Error(`Drag ${role} element has no bounding box (likely not visible): ${target}`);
			}
			return { x: box.x + box.width / 2, y: box.y + box.height / 2, handle };
		}
		if (target !== null && typeof target === "object" && typeof target.x === "number" && typeof target.y === "number") return { x: target.x, y: target.y };
		throw new Error(`Drag ${role} must be a selector string or { x: number, y: number } point. Got: ${typeof target}`);
	}

	async function drag(from: DragTarget, to: DragTarget, signal: AbortSignal): Promise<void> {
		const start = await dragPoint(from, "from", signal);
		let end: { x: number; y: number; handle?: ElementHandle } | undefined;
		let pressed = false;
		try {
			end = await dragPoint(to, "to", signal);
			await untilAborted(page.mouse.move(start.x, start.y), signal);
			pressed = true;
			await untilAborted(page.mouse.down(), signal);
			await untilAborted(page.mouse.move(end.x, end.y, { steps: 12 }), signal);
			await untilAborted(page.mouse.up(), signal);
			pressed = false;
		} finally {
			// An interrupted drag must not leave the button down; not awaited, as the page may be blocked.
			if (pressed) void page.mouse.up().catch(() => undefined);
			if (start.handle) dispose(start.handle);
			if (end?.handle) dispose(end.handle);
		}
	}

	const { methods, onElement } = selectorActions(page, ctx, "tab");

	return {
		...methods,

		async goto(url: string, options?: { waitUntil?: NavigationWaitUntil }): Promise<string> {
			if (typeof url !== "string") throw new Error("tab.goto(url) takes the URL as a string.");
			// Ids of the old page never name anything on the new one.
			ctx.observed.clear();
			return await gotoPage(page, url, options?.waitUntil ?? "load", bound, ctx.signal);
		},
		back: (options?: { waitUntil?: NavigationWaitUntil }) => traverseHistory(page, "back", options?.waitUntil ?? "load", bound, ctx.signal),
		forward: (options?: { waitUntil?: NavigationWaitUntil }) => traverseHistory(page, "forward", options?.waitUntil ?? "load", bound, ctx.signal),
		reload: (options?: { waitUntil?: NavigationWaitUntil }) => reloadPage(page, options?.waitUntil ?? "load", bound, ctx.signal),
		pushState: (url: string) => quick(`tab.pushState(${JSON.stringify(url)})`, signal => pushState(page, url, signal)),

		waitForUrl: (pattern: string | RegExp, options?: { timeout?: number }) => {
			const limit = waitMs(ctx.budgetMs, options?.timeout);
			return quick("tab.waitForUrl()", signal => waitForUrl(page, pattern, limit, signal), limit);
		},
		waitForText: async (text: string, options?: { timeout?: number; selector?: string; exact?: boolean }) => {
			const limit = waitMs(ctx.budgetMs, options?.timeout);
			await quick(`tab.waitForText(${JSON.stringify(text)})`, signal => waitForText(page, text, options ?? {}, signal), limit);
		},

		keyDown: (key: string) => quick("tab.keyDown()", signal => untilAborted(page.keyboard.down(key as never), signal)),
		keyUp: (key: string) => quick("tab.keyUp()", signal => untilAborted(page.keyboard.up(key as never), signal)),
		mouseMove: (x: number, y: number, options: { steps?: number } = {}) => quick("tab.mouseMove()", signal => mouseMove(page, x, y, options, signal)),
		mouseDown: (options: { button?: MouseButton } = {}) => quick("tab.mouseDown()", signal => untilAborted(page.mouse.down(options), signal)),
		mouseUp: (options: { button?: MouseButton } = {}) => quick("tab.mouseUp()", signal => untilAborted(page.mouse.up(options), signal)),
		clickAt: (x: number, y: number, options: ClickAtOptions = {}) => quick("tab.clickAt()", signal => clickAt(page, x, y, options, signal)),
		wheel: (deltaX: number, deltaY: number) => quick("tab.wheel()", signal => wheel(page, deltaX, deltaY, signal)),
		scroll(deltaX: number, deltaY: number, options?: { selector?: string }): Promise<void> {
			if (!options?.selector) return quick("tab.scroll()", signal => dispatchScroll(() => page.mouse.wheel({ deltaX, deltaY }), signal));
			return onElement("scroll", options.selector, (handle, signal) => untilAborted(handle.evaluate(scrollElementBy, deltaX, deltaY), signal));
		},
		drag: (from: DragTarget, to: DragTarget) => quick("tab.drag()", signal => drag(from, to, signal)),

		screenshot: (options: ScreenshotOptions = {}) =>
			quick("tab.screenshot()", signal => takeScreenshot(page, options, {
				activate: ctx.owned,
				images: ctx.images,
				resize: ctx.resize,
				resolveSelector: async selector => (
					parseAriaRefSelector(selector) !== null ? await resolveAriaRef(page, selector) : await page.$(normalizeSelector(selector))
				) as ElementHandle | null,
			}, signal), quickMs(ctx.budgetMs)),

		cookies: (options?: CookieQueryOptions) => quick("tab.cookies()", signal => readCookies(page, options, signal), quickMs(ctx.budgetMs)),
		setCookies: (...cookies: unknown[]) => quick("tab.setCookies()", signal => setPageCookies(page, cookies, signal)),
		clearCookies: (options?: ClearCookiesOptions) => quick("tab.clearCookies()", signal => clearPageCookies(page, options, signal)),
		storage: (kind: string, options?: { key?: string }) => quick("tab.storage()", signal => readStorage(page, kind, options, signal), quickMs(ctx.budgetMs)),
		setStorage: (kind: string, keyOrEntries: unknown, value?: unknown) => quick("tab.setStorage()", signal => setPageStorage(page, kind, keyOrEntries, value, signal)),
		clearStorage: (kind: string) => quick("tab.clearStorage()", signal => clearPageStorage(page, kind, signal)),
		saveState: (filePath?: string) => quick("tab.saveState()", async signal => saveStorageState(page, ctx.tabName, filePath, ctx.cwd, await ctx.stateDir(), signal)),
		loadState: (filePath: string) => quick("tab.loadState()", signal => loadStorageState(page, filePath, ctx.cwd, { allowOtherOrigins: ctx.otherOrigins, navigationTimeoutMs: ms, signal })),

		waitForDownload: (options?: { timeout?: number }) => {
			const limit = waitMs(ctx.budgetMs, options?.timeout);
			return quick("tab.waitForDownload()", signal => ctx.downloads.wait(signal), limit);
		},
		downloads: async () => ctx.downloads.list(),

		dialog: async () => ctx.dialogs.state(),
		handleDialog: (options: { accept: boolean; text?: string }) => {
			if (typeof options?.accept !== "boolean") throw new Error("tab.handleDialog() takes { accept: boolean, text?: string }.");
			return quick("tab.handleDialog()", signal => untilAborted(ctx.dialogs.handle(options), signal));
		},
		setDialogs: (policy: DialogPolicy | null) => {
			if (policy !== null && policy !== "accept" && policy !== "dismiss") throw new Error('tab.setDialogs() takes "accept", "dismiss" or null.');
			return quick("tab.setDialogs()", signal => untilAborted(ctx.dialogs.setPolicy(policy), signal));
		},
	};
}
