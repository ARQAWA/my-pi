import type { ElementHandle, Frame, Page } from "puppeteer-core";
import { untilAborted } from "./abort.ts";
import { type AriaSnapshotOptions, frameAriaSnapshot } from "./aria.ts";
import { selectorReads } from "./reads.ts";
import { normalizeSelector } from "./selectors.ts";

// Adapted from oh-my-pi 18.8.9 (browser/frames.ts), MIT; see THIRD-PARTY-NOTICES.md.

/** JSON-safe metadata for one document frame. */
interface BrowserFrameInfo {
	/** DevTools frame identifier. */
	id: string;
	/** Frame name or element id. */
	name: string;
	/** Current frame URL. */
	url: string;
	/** Parent frame identifier, or null for the main frame. */
	parentId: string | null;
	/** Best-effort selector for the owning frame element. */
	selector?: string;
}

/** A frame's DevTools identifier, the id CDP events name it by. */
export function devtoolsFrameId(frame: Frame): string {
	// Puppeteer keeps the DevTools id on an internal field its public types omit.
	return (frame as unknown as { _id: string })._id;
}

/** List the page's current main and child frames with stable DevTools identifiers. */
export async function listFrames(page: Page, signal: AbortSignal): Promise<BrowserFrameInfo[]> {
	const result: BrowserFrameInfo[] = [];
	for (const frame of page.frames()) {
		const parent = frame.parentFrame();
		const info: BrowserFrameInfo = {
			id: devtoolsFrameId(frame),
			name: frame.name(),
			url: frame.url(),
			parentId: parent ? devtoolsFrameId(parent) : null,
		};
		if (parent) {
			let element: ElementHandle | null = null;
			try {
				element = await untilAborted(frame.frameElement(), signal);
				const attributes = await untilAborted(
					element!.evaluate(node => {
						const frameElement = node as unknown as {
							localName: string;
							getAttribute(name: string): string | null;
						};
						return {
							tag: frameElement.localName,
							id: frameElement.getAttribute("id"),
							name: frameElement.getAttribute("name"),
						};
					}),
					signal,
				);
				if (attributes.id) info.selector = `${attributes.tag}[id=${JSON.stringify(attributes.id)}]`;
				else if (attributes.name) info.selector = `${attributes.tag}[name=${JSON.stringify(attributes.name)}]`;
			} catch (error) {
				if (signal.aborted) throw error;
				// Detached or cross-process frame elements may disappear while enumerating.
			} finally {
				await element?.dispose().catch(() => undefined);
			}
		}
		result.push(info);
	}
	return result;
}

/** Resolve a frame by owning-element selector, frame name, or exact frame URL. */
export async function resolveFrame(page: Page, selectorOrNameOrUrl: string, signal: AbortSignal): Promise<Frame> {
	let element: ElementHandle | null = null;
	try {
		element = await untilAborted(page.$(normalizeSelector(selectorOrNameOrUrl)), signal);
		if (element) {
			const frame = await untilAborted(element.contentFrame(), signal);
			if (!frame) throw new Error(`tab.frame(${JSON.stringify(selectorOrNameOrUrl)}) matched an element without a frame`);
			return frame;
		}
	} catch (error) {
		if (signal.aborted || element) throw error;
		// URL-like and name strings are often not valid CSS selectors; match them below.
	} finally {
		await element?.dispose().catch(() => undefined);
	}
	const frame = page.frames().find(candidate => candidate.name() === selectorOrNameOrUrl || candidate.url() === selectorOrNameOrUrl);
	if (!frame) throw new Error(`tab.frame(${JSON.stringify(selectorOrNameOrUrl)}) found no matching frame`);
	return frame;
}

/**
 * The read-only operations of one frame; refs of a frame snapshot are not resolvable with tab.ref.
 * As in oh-my-pi, reading a selector that matches nothing throws here, while count and isVisible answer 0 and false.
 */
export function evaluatePage(scope: Page | Frame, args: unknown[], signal: AbortSignal): Promise<unknown> {
	const [expression, ...values] = args;
	if (typeof expression !== "string") throw new Error("evaluate() takes a JavaScript expression string.");
	if (values.length === 0) return untilAborted(scope.evaluate(expression), signal);
	// A function is represented as source text because tool arguments are JSON.
	return untilAborted(scope.evaluate(`(${expression})(...${JSON.stringify(values)})`), signal);
}

export function frameReads(frame: Frame, signal: AbortSignal) {
	const reads = selectorReads(frame, signal);
	const present = async <T>(selector: string, read: Promise<T | null>): Promise<T> => {
		const value = await read;
		if (value === null && (await reads.count(selector)) === 0) {
			throw new Error(`Failed to find element matching selector ${JSON.stringify(selector)}`);
		}
		return value as T;
	};
	return {
		text: (selector: string) => present(selector, reads.text(selector)),
		html: (selector: string) => present(selector, reads.html(selector)),
		value: (selector: string) => present(selector, reads.value(selector)),
		attr: (selector: string, name: string) => present(selector, reads.attr(selector, name)),
		isVisible: reads.isVisible,
		count: reads.count,
		ariaSnapshot: (selector?: string, options: AriaSnapshotOptions = {}) => frameAriaSnapshot(frame, selector, options, signal),
		evaluate: (...args: unknown[]) => evaluatePage(frame, args, signal),
	};
}
