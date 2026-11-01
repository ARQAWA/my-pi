import type { ElementHandle } from "puppeteer-core";
import { untilAborted } from "./abort.ts";

function readText(element: Element): string {
	return ((element as unknown as { innerText?: string }).innerText ?? element.textContent ?? "").trim();
}

function readValue(element: Element): string | null {
	const candidate = element as Element & { value?: unknown };
	return "value" in candidate && candidate.value != null ? String(candidate.value) : null;
}

function readEnabled(element: Element): boolean {
	return !element.matches(":disabled") && element.getAttribute("aria-disabled") !== "true";
}

function readChecked(element: Element): boolean {
	const candidate = element as Element & { checked?: unknown };
	return typeof candidate.checked === "boolean" ? candidate.checked : element.getAttribute("aria-checked") === "true";
}

export function elementReads(handle: ElementHandle, signal: AbortSignal) {
	return {
		text: () => untilAborted(handle.evaluate(readText), signal),
		value: () => untilAborted(handle.evaluate(readValue), signal),
		isVisible: () => untilAborted(handle.isVisible(), signal),
		isEnabled: () => untilAborted(handle.evaluate(readEnabled), signal),
		isChecked: () => untilAborted(handle.evaluate(readChecked), signal),
	};
}
