import type { ElementHandle, KeyInput, KeyPressOptions, MouseButton, Page } from "puppeteer-core";
import { aborted, untilAborted } from "./abort.ts";
import { sleep } from "./ops.ts";

// Adapted from oh-my-pi 18.8.9 (browser/interactions.ts, browser/tab-worker.ts, browser/tern/keys.ts), MIT; see THIRD-PARTY-NOTICES.md.

export interface ClickAtOptions {
	button?: MouseButton;
	clickCount?: number;
}

interface ClickPoint {
	x: number;
	y: number;
}

type ActionabilityResult = { ok: true; x: number; y: number } | { ok: false; reason: string; coveredBy?: string };

// The page-side shapes below describe only the members the page functions touch.
interface PageRect {
	left: number;
	right: number;
	top: number;
	bottom: number;
	width: number;
	height: number;
}

interface PageRoot {
	host?: PageElement;
}

interface PageShadowRoot {
	elementFromPoint(x: number, y: number): PageElement | null;
}

interface PageElement {
	readonly tagName: string;
	id: string;
	readonly isConnected: boolean;
	type: string;
	checked: boolean;
	readonly labels?: ArrayLike<PageElement> | null;
	matches(selector: string): boolean;
	readonly classList: ArrayLike<string>;
	parentElement: PageElement | null;
	shadowRoot: PageShadowRoot | null;
	getBoundingClientRect(): PageRect;
	getClientRects(): ArrayLike<PageRect>;
	getRootNode(): PageRoot;
	getAttribute(name: string): string | null;
	setAttribute(name: string, value: string): void;
	dispatchEvent(event: unknown): boolean;
	scrollIntoView(options: { behavior: string; block: string; inline: string }): void;
}

interface PageGlobals {
	document: { elementFromPoint(x: number, y: number): PageElement | null };
	innerWidth: number;
	innerHeight: number;
	getComputedStyle(element: PageElement): { display: string; visibility: string; pointerEvents: string; opacity: string };
	Event: new (type: string, options: { bubbles: boolean }) => unknown;
}

/** A click aborted while its element was still refused; `refusal` names the last failed check. */
export class ClickRefusedError extends Error {
	refusal: string;
	constructor(refusal: string, options?: ErrorOptions) {
		super(`Click refused: ${refusal}`, options);
		this.refusal = refusal;
	}
}

/**
 * Page function (self-contained; serialisable via `.toString()`): whether `descendant` is `ancestor` or sits inside it,
 * crossing the shadow-root boundaries `Node.contains` stops at.
 */
function composedContains(ancestor: unknown, descendant: unknown): boolean {
	for (let current = descendant as PageElement | null; current;) {
		if (current === ancestor) return true;
		const root: PageRoot = current.getRootNode();
		current = current.parentElement ?? root.host ?? null;
	}
	return false;
}

interface ClickFlags {
	viaLabel: boolean;
}

/** Page half of the click check; `contains` is {@link composedContains}, bound in by `clickActionableInPage`. */
function checkClickActionable(el: unknown, { viaLabel }: ClickFlags, contains: typeof composedContains): ActionabilityResult {
	const element = el as unknown as PageElement;
	const page = globalThis as unknown as PageGlobals;
	// A node the page replaced (a re-render) has no computed style; say so rather than misread it.
	if (!element.isConnected) {
		return { ok: false as const, reason: "detached (the page replaced this element; look it up again)" };
	}
	const style = page.getComputedStyle(element);
	if (style.display === "none") return { ok: false as const, reason: "display:none" };
	if (style.visibility === "hidden" || style.visibility === "collapse") {
		return { ok: false as const, reason: `visibility:${style.visibility}` };
	}
	if (style.pointerEvents === "none") return { ok: false as const, reason: "pointer-events:none" };
	// A custom checkbox or radio keeps its real control at opacity:0 under the box it draws; the hit test below decides.
	if (
		Number(style.opacity) === 0 &&
		!element.matches('input[type="checkbox"], input[type="radio"], [role="checkbox" i], [role="radio" i], [role="switch" i]')
	) {
		return { ok: false as const, reason: "opacity:0" };
	}
	const rect = element.getBoundingClientRect();
	if (rect.width < 1 || rect.height < 1) return { ok: false as const, reason: "zero-size" };
	// A wrapped link's box centre can fall between its lines, on the parent; aim at its first visible line.
	const fragments = Array.from(element.getClientRects());
	const box =
		fragments.length === 0
			? rect
			: fragments.find(
					r =>
						Math.min(page.innerWidth, r.right) - Math.max(0, r.left) >= 1 &&
						Math.min(page.innerHeight, r.bottom) - Math.max(0, r.top) >= 1,
				);
	if (!box) return { ok: false as const, reason: "off-viewport" };
	const left = Math.max(0, Math.min(page.innerWidth, box.left));
	const right = Math.max(0, Math.min(page.innerWidth, box.right));
	const top = Math.max(0, Math.min(page.innerHeight, box.top));
	const bottom = Math.max(0, Math.min(page.innerHeight, box.bottom));
	if (right - left < 1 || bottom - top < 1) return { ok: false as const, reason: "off-viewport" };
	const x = Math.floor((left + right) / 2);
	const y = Math.floor((top + bottom) / 2);
	let topElement = page.document.elementFromPoint(x, y);
	for (let depth = 0; topElement?.shadowRoot && depth < 16; depth++) {
		const nested = topElement.shadowRoot.elementFromPoint(x, y);
		if (!nested || nested === topElement) break;
		topElement = nested;
	}
	if (!topElement) return { ok: false as const, reason: "elementFromPoint-null" };
	// A label forwards a click to its control unless the hit is other interactive content inside it.
	const interactiveContent =
		'a[href], area[href], button, details, embed, iframe, input:not([type="hidden"]), label, select, textarea, summary, audio[controls], video[controls], [contenteditable=""], [contenteditable="true"]';
	const hit: PageElement = topElement;
	const forwardedBy = (owner: PageElement): boolean => {
		let current: PageElement | null = hit;
		while (current && current !== owner) {
			if (current.matches(interactiveContent)) return false;
			current = current.parentElement ?? current.getRootNode().host ?? null;
		}
		return current === owner;
	};
	const onTarget =
		contains(element, topElement) ||
		contains(topElement, element) ||
		(viaLabel && Array.from(element.labels ?? []).some(forwardedBy));
	if (!onTarget) {
		const tag = topElement.tagName.toLowerCase();
		const id = topElement.id ? `#${topElement.id}` : "";
		const classes = Array.from(topElement.classList)
			.slice(0, 2)
			.map(name => `.${name}`)
			.join("");
		return { ok: false as const, reason: "covered", coveredBy: `<${tag}${id}${classes}>` };
	}
	return { ok: true as const, x: x - rect.left, y: y - rect.top };
}

const clickActionableInPage = new Function(
	"el",
	"flags",
	`return (${checkClickActionable.toString()})(el, flags, ${composedContains.toString()});`,
) as (el: unknown, flags: ClickFlags) => ActionabilityResult;

function scrollToCenter(el: unknown): void {
	(el as PageElement).scrollIntoView({ behavior: "instant", block: "center", inline: "center" });
}

/** Return a visible point relative to the element's box, or explain why it cannot receive a click. */
async function isClickActionable(handle: ElementHandle, signal: AbortSignal, options: Pick<ClickAtOptions, "button">): Promise<ActionabilityResult> {
	const flags: ClickFlags = { viaLabel: (options.button ?? "left") === "left" };
	return await untilAborted(handle.evaluate(clickActionableInPage, flags), signal);
}

async function actionableClickPoint(handle: ElementHandle, label: string, signal: AbortSignal, options: ClickAtOptions): Promise<ClickPoint> {
	await untilAborted(handle.evaluate(scrollToCenter), signal);
	let previous = await untilAborted(handle.boundingBox(), signal);
	let refusal: string | undefined;
	try {
		for (;;) {
			aborted(signal);
			await sleep(16, signal);
			const current = await untilAborted(handle.boundingBox(), signal);
			const stable =
				previous !== null &&
				current !== null &&
				Math.abs(previous.x - current.x) < 0.5 &&
				Math.abs(previous.y - current.y) < 0.5 &&
				Math.abs(previous.width - current.width) < 0.5 &&
				Math.abs(previous.height - current.height) < 0.5;
			const result = await isClickActionable(handle, signal, options);
			// ElementHandle.boundingBox() is relative to the main frame; elementFromPoint() above is frame-local.
			if (stable && result.ok && current) return { x: current.x + result.x, y: current.y + result.y };
			if (stable && !result.ok && result.coveredBy) throw new Error(`${label} blocked: covered by ${result.coveredBy}`);
			refusal = result.ok ? "still moving" : result.coveredBy ? `covered by ${result.coveredBy}` : result.reason;
			previous = current;
			await sleep(34, signal);
		}
	} catch (error) {
		if (signal.aborted && refusal !== undefined) throw new ClickRefusedError(refusal, { cause: signal.reason });
		throw error;
	}
}

/** Click an element only after verifying the dispatched point is not occluded. */
export async function clickElement(handle: ElementHandle, label: string, signal: AbortSignal, options: ClickAtOptions = {}): Promise<void> {
	const point = await actionableClickPoint(handle, label, signal, options);
	aborted(signal);
	await untilAborted(handle.frame.page().mouse.click(point.x, point.y, { button: options.button, count: options.clickCount }), signal);
}

/**
 * Focus a text-entry target, refusing one that cannot take keystrokes. A disabled control ignores `focus()`, so they would
 * land in whichever element had focus; a read-only one drops them. The check runs after `focus()` so a focus handler that
 * locks the field is seen.
 */
async function focusTextEntryTarget(handle: ElementHandle, action: "fill" | "type into", signal: AbortSignal): Promise<void> {
	const refusal = await untilAborted(
		handle.evaluate(el => {
			const node = el as unknown as { readOnly?: boolean; focus?: () => void; matches(selector: string): boolean };
			node.focus?.();
			if (node.matches(":disabled")) return "disabled";
			if (node.readOnly) return "read-only";
			return null;
		}),
		signal,
	);
	if (refusal) throw new Error(`Cannot ${action} a ${refusal} element`);
}

export async function typeIntoElement(handle: ElementHandle, text: string, signal: AbortSignal): Promise<void> {
	await focusTextEntryTarget(handle, "type into", signal);
	aborted(signal);
	await untilAborted(handle.type(text, { delay: 0 }), signal);
}

/**
 * Focus a field that can take text, clear any existing value, then retype. Every step is a DOM evaluation or an input
 * dispatch, so this works on tabs that produce no animation frames, unlike Puppeteer's `Locator.fill`.
 */
export async function fillElement(handle: ElementHandle, value: string, signal: AbortSignal): Promise<void> {
	await focusTextEntryTarget(handle, "fill", signal);
	aborted(signal);
	await untilAborted(
		handle.evaluate((el, clearing) => {
			const node = el as unknown as {
				value?: string;
				focus?: () => void;
				isContentEditable?: boolean;
				innerText?: string;
				dispatchEvent(event: unknown): boolean;
			};
			node.focus?.();
			const before = node.isContentEditable ? node.innerText : node.value;
			if (node.isContentEditable) node.innerText = "";
			else if ("value" in node) {
				// The prototype setter bypasses value trackers that frameworks (React) install on the element, so they
				// see the cleared value as a change instead of their own write.
				const setValue = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(node), "value")?.set;
				if (setValue) setValue.call(node, "");
				else node.value = "";
			}
			// Typing a value fires its own input events; an empty value types nothing, so report the clear itself.
			if (!clearing || !before) return;
			const { Event } = globalThis as unknown as PageGlobals;
			node.dispatchEvent(new Event("input", { bubbles: true }));
			node.dispatchEvent(new Event("change", { bubbles: true }));
		}, value === ""),
		signal,
	);
	aborted(signal);
	await untilAborted(handle.type(value, { delay: 0 }), signal);
}

/** Set a native checkable control or ARIA switch to the requested state idempotently. */
export async function setElementChecked(handle: ElementHandle, checked: boolean, label: string, signal: AbortSignal): Promise<void> {
	const state = await untilAborted(
		handle.evaluate(el => {
			const element = el as unknown as PageElement;
			const tag = element.tagName.toLowerCase();
			const type = tag === "input" ? element.type.toLowerCase() : "";
			const role = element.getAttribute("role")?.toLowerCase() ?? "";
			if (tag === "input" && (type === "checkbox" || type === "radio")) return { kind: type, checked: element.checked };
			if (role === "switch" || role === "checkbox" || role === "radio") {
				return { kind: `aria-${role}`, checked: element.getAttribute("aria-checked") === "true" };
			}
			return { kind: "", checked: false };
		}),
		signal,
	);
	if (!state.kind) throw new Error(`${label} requires a checkbox, radio, or ARIA switch`);
	if (state.checked === checked) return;
	if (state.kind === "radio" && !checked) {
		await untilAborted(
			handle.evaluate(el => {
				const input = el as unknown as PageElement;
				const page = globalThis as unknown as PageGlobals;
				input.checked = false;
				input.dispatchEvent(new page.Event("input", { bubbles: true }));
				input.dispatchEvent(new page.Event("change", { bubbles: true }));
			}),
			signal,
		);
		return;
	}
	await clickElement(handle, label, signal);
	aborted(signal);
	await untilAborted(
		handle.evaluate((el, desired) => {
			const element = el as unknown as PageElement;
			const page = globalThis as unknown as PageGlobals;
			const role = element.getAttribute("role")?.toLowerCase();
			const current = role ? element.getAttribute("aria-checked") === "true" : element.checked;
			if (current === desired) return;
			if (role) element.setAttribute("aria-checked", String(desired));
			else element.checked = desired;
			element.dispatchEvent(new page.Event("input", { bubbles: true }));
			element.dispatchEvent(new page.Event("change", { bubbles: true }));
		}, checked),
		signal,
	);
}

/**
 * Select `<select>` options by value, then by visible label, and return the values this call selected. An exact value match
 * always wins over a label. A single `<select>` takes the first matching value. A value that matches no option throws before
 * the select is touched, so a typo never commits the browser's default option.
 */
export async function selectOptions(handle: ElementHandle, values: string[], label: string, signal: AbortSignal): Promise<string[]> {
	const outcome = await untilAborted(
		handle.evaluate((el, vals) => {
			interface SelectOption {
				value: string;
				label: string;
				text: string;
				index: number;
				selected: boolean;
			}
			interface SelectLike {
				tagName: string;
				multiple: boolean;
				selectedIndex: number;
				options: ArrayLike<SelectOption>;
				dispatchEvent: (event: unknown) => boolean;
			}
			const select = el as unknown as SelectLike;
			if (select?.tagName !== "SELECT") return null;
			const page = globalThis as unknown as PageGlobals;
			const options = Array.from(select.options);
			const wanted: SelectOption[] = [];
			const missing: string[] = [];
			for (const value of vals) {
				const option =
					options.find(candidate => candidate.value === value) ??
					options.find(candidate => candidate.label === value || candidate.text.replace(/\s+/g, " ").trim() === value);
				if (option) wanted.push(option);
				else missing.push(value);
			}
			if (missing.length > 0) return { missing };
			let selected: string[];
			if (wanted.length === 0) {
				for (const option of options) option.selected = false;
				selected = [];
			} else if (select.multiple) {
				for (const option of options) option.selected = wanted.includes(option);
				selected = options.filter(option => option.selected).map(option => option.value);
			} else {
				select.selectedIndex = wanted[0]!.index;
				selected = [wanted[0]!.value];
			}
			select.dispatchEvent(new page.Event("input", { bubbles: true }));
			select.dispatchEvent(new page.Event("change", { bubbles: true }));
			return { selected };
		}, values),
		signal,
	);
	if (!outcome) throw new Error(`${label} requires a <select> element`);
	if ("missing" in outcome) throw new Error(`No <select> option matches ${(outcome.missing as string[]).map(value => JSON.stringify(value)).join(", ")}`);
	return outcome.selected as string[];
}

// Keys

/** Split `Control+Shift+a` into its keys; a lone `+` (or a name without `+`) is one key. */
function splitKeyCombo(combo: string): string[] {
	if (combo.length <= 1 || !combo.includes("+")) return [combo];
	const parts = combo.split("+");
	if (parts.at(-1) === "") {
		parts.pop();
		parts[parts.length - 1] = "+";
	}
	return parts.filter(part => part.length > 0);
}

const EDITING_COMMANDS: Readonly<Record<string, string>> = {
	"meta+a": "selectAll",
	"meta+c": "copy",
	"meta+v": "paste",
	"meta+x": "cut",
	"meta+z": "undo",
	"meta+shift+z": "redo",
};

/**
 * macOS runs editing shortcuts as app-menu commands a CDP key event never reaches, so the key-down names Chrome's editor
 * command instead; elsewhere the plain key event already edits. Whatever the spelling (`Meta+c`, `MetaLeft+KeyC`).
 */
function editingCommand(keys: readonly string[]): string | undefined {
	if (process.platform !== "darwin") return undefined;
	const letter = /^(?:Key([A-Z])|([A-Za-z]))$/.exec(keys[keys.length - 1]!);
	if (keys.length < 2 || !letter) return undefined;
	const modifiers = new Set<string>();
	for (const name of keys.slice(0, -1)) {
		const modifier = /^(Shift|Control|Alt|Meta)(?:Left|Right)?$/.exec(name)?.[1];
		if (!modifier) return undefined;
		modifiers.add(modifier === "Control" ? "ctrl" : modifier.toLowerCase());
	}
	return EDITING_COMMANDS[`${[...modifiers].sort().join("+")}+${(letter[1] ?? letter[2]!).toLowerCase()}`];
}

/**
 * Press a key or a `+`-joined combo (`Enter`, `Shift+Tab`, `Meta+a`): the leading keys go down in order, the last key is
 * pressed with `options`, then the leading keys are released in reverse.
 */
export async function pressKey(page: Page, combo: string, signal: AbortSignal, options?: KeyPressOptions): Promise<void> {
	// Unchecked on purpose: Puppeteer validates each name and throws `Unknown key: "..."`.
	const keys = splitKeyCombo(combo) as KeyInput[];
	const key = keys[keys.length - 1]!;
	const command = editingCommand(keys);
	const pressed: KeyInput[] = [];
	try {
		for (const modifier of keys.slice(0, -1)) {
			aborted(signal);
			await untilAborted(page.keyboard.down(modifier), signal);
			pressed.push(modifier);
		}
		// `commands` is deprecated in Puppeteer but still forwarded to Input.dispatchKeyEvent.
		aborted(signal);
		await untilAborted(page.keyboard.press(key, command ? { ...options, commands: [command] } : options), signal);
	} finally {
		// Not awaited: a page blocked by a dialog never answers, and CDP keeps the commands in order anyway.
		for (const modifier of pressed.reverse()) void page.keyboard.up(modifier).catch(() => undefined);
	}
}
