import type { BoundingBox, ElementHandle, Frame, Page } from "puppeteer-core";
import { untilAborted } from "./abort.ts";
import { normalizeSelector } from "./selectors.ts";

// Page-side readers: serialized into the page, so they must stay self-contained.
function readText(element: Element): string {
	return ((element as unknown as { innerText?: string }).innerText ?? element.textContent ?? "").trim();
}

function readHtml(element: Element): string {
	return element.innerHTML;
}

function readValue(element: Element): string | null {
	const candidate = element as Element & { value?: unknown };
	return "value" in candidate && candidate.value != null ? String(candidate.value) : null;
}

function readAttribute(element: Element, name: string): string | null {
	return element.getAttribute(name);
}

function readEnabled(element: Element): boolean {
	return !element.matches(":disabled") && element.getAttribute("aria-disabled") !== "true";
}

const DEFAULT_STYLE_PROPERTIES = ["font-family", "font-size", "font-weight", "color", "background-color", "display", "visibility", "opacity", "position", "z-index", "width", "height", "margin", "padding"];

function readStyles(element: Element, properties: string[]): Record<string, string> {
	const computed = getComputedStyle(element);
	return Object.fromEntries(properties.map(property => [property, computed.getPropertyValue(property)]));
}

function readChecked(element: Element): boolean {
	const candidate = element as Element & { checked?: unknown };
	return typeof candidate.checked === "boolean" ? candidate.checked : element.getAttribute("aria-checked") === "true";
}

/** Read-only helpers of one element, shared by tab.id(n), tab.ref(id) and selector reads. */
export function elementReads(handle: ElementHandle, signal: AbortSignal) {
	return {
		text: () => untilAborted(handle.evaluate(readText), signal),
		html: () => untilAborted(handle.evaluate(readHtml), signal),
		value: () => untilAborted(handle.evaluate(readValue), signal),
		attr: (name: string) => untilAborted(handle.evaluate(readAttribute, name), signal),
		isVisible: () => untilAborted(handle.isVisible(), signal),
		isEnabled: () => untilAborted(handle.evaluate(readEnabled), signal),
		isChecked: () => untilAborted(handle.evaluate(readChecked), signal),
		box: () => untilAborted(handle.boundingBox(), signal),
		styles: (properties: string[] = DEFAULT_STYLE_PROPERTIES) => untilAborted(handle.evaluate(readStyles, properties), signal),
	};
}

/**
 * Read-only helpers that take a selector, scoped to the page or one frame. A selector matching
 * nothing gives `null`, `0` or `false`; the first match is read.
 */
export function selectorReads(scope: Page | Frame, signal: AbortSignal) {
	async function readFirst<T>(selector: string, none: T, read: (element: ReturnType<typeof elementReads>) => Promise<T>): Promise<T> {
		const handle = await untilAborted(scope.$(normalizeSelector(selector)), signal);
		if (!handle) return none;
		try {
			return await read(elementReads(handle, signal));
		} finally {
			await handle.dispose().catch(() => undefined);
		}
	}
	return {
		text: (selector: string) => readFirst<string | null>(selector, null, element => element.text()),
		html: (selector: string) => readFirst<string | null>(selector, null, element => element.html()),
		value: (selector: string) => readFirst<string | null>(selector, null, element => element.value()),
		attr: (selector: string, name: string) => readFirst<string | null>(selector, null, element => element.attr(name)),
		isVisible: (selector: string) => readFirst(selector, false, element => element.isVisible()),
		isEnabled: (selector: string) => readFirst(selector, false, element => element.isEnabled()),
		isChecked: (selector: string) => readFirst(selector, false, element => element.isChecked()),
		box: (selector: string) => readFirst<BoundingBox | null>(selector, null, element => element.box()),
		styles: (selector: string, properties?: string[]) => readFirst<Record<string, string> | null>(selector, null, element => element.styles(properties)),
		async count(selector: string): Promise<number> {
			const handles = await untilAborted(scope.$$(normalizeSelector(selector)), signal);
			await Promise.all(handles.map(handle => handle.dispose().catch(() => undefined)));
			return handles.length;
		},
	};
}
