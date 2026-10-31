import { readFileSync } from "node:fs";
import type { ElementHandle, Frame, JSHandle, Page } from "puppeteer-core";
import {
	type AriaHrefMap,
	type AriaSnapshotBaseline,
	type AriaSnapshotDiffResult,
	ariaSnapshotBaselineKey,
	collectAriaSnapshotRefs,
	diffAriaSnapshot,
	postProcessAriaSnapshot,
	type SnapshotPostProcessOptions,
} from "./snapshot-plus.ts";
import { untilAborted } from "./abort.ts";
import { normalizeSelector, parseAriaRefSelector } from "./selectors.ts";

// `aria-snapshot.bundle.txt` is Playwright v1.61.0's injected ARIA-snapshot code (Apache-2.0,
// (c) Microsoft), bundled by oh-my-pi 18.8.9 and copied unchanged; see THIRD-PARTY-NOTICES.md.

export interface AriaSnapshotOptions extends SnapshotPostProcessOptions {
	/** Return a revisioned full, unchanged, or delta result. */
	diff?: boolean;
}

type PageFunction = (...args: unknown[]) => unknown;
interface Evaluators {
	snapshot: PageFunction;
	resolveRef: PageFunction;
	hrefs: PageFunction;
}

let evaluators: Evaluators | undefined;

// Built once from the bundle text, never inside the page, so page CSP never applies. Each call
// re-runs the bundle, so refs renumber from e1 on every snapshot.
function loadEvaluators(): Evaluators {
	if (evaluators) return evaluators;
	const bundle = readFileSync(new URL("./aria-snapshot.bundle.txt", import.meta.url), "utf8");
	const build = (params: string[], body: string) =>
		new Function(...params, `var module = { exports: {} };\n${bundle}\n${body}`) as PageFunction;
	evaluators = {
		snapshot: build(["root", "request"], "return module.exports.ariaSnapshot(root, request);"),
		resolveRef: build(["ref"], "return module.exports.resolveAriaRef(ref);"),
		hrefs: build(
			["refs"],
			'var hrefs = {}; for (var ref of refs) { var el = module.exports.resolveAriaRef(ref); if (el && el.tagName === "A" && el.href) hrefs[ref] = el.href; } return hrefs;',
		),
	};
	return evaluators;
}

/**
 * Capture a Playwright-format ARIA snapshot of `root` (or the whole document when null) in the
 * frame's isolated world, where the `_ariaRef` markers stay out of reach of page scripts. Every
 * node carries a `[ref=eN]` id; resolve those with {@link resolveAriaRef} until the next snapshot.
 */
async function captureAriaSnapshot(frame: Frame, root: ElementHandle | null, options: AriaSnapshotOptions): Promise<string> {
	const { snapshot: evaluateSnapshot, hrefs: evaluateHrefs } = loadEvaluators();
	const realm = frame.isolatedRealm();
	// A handle can only be an argument in the world that created it.
	const scoped = root ? await realm.adoptHandle(root) : null;
	try {
		const snapshot = (await realm.evaluate(evaluateSnapshot as never, scoped as never, {} as never)) as string;
		let hrefs: AriaHrefMap = {};
		if (options.urls) hrefs = (await realm.evaluate(evaluateHrefs as never, collectAriaSnapshotRefs(snapshot) as never)) as AriaHrefMap;
		return postProcessAriaSnapshot(snapshot, options, hrefs);
	} finally {
		await scoped?.dispose().catch(() => undefined);
	}
}

/** Snapshot the document, or the element `selector` names, in `frame`. */
export async function frameAriaSnapshot(frame: Frame, selector: string | undefined, options: AriaSnapshotOptions, signal: AbortSignal): Promise<string> {
	const root = selector ? await untilAborted(frame.$(normalizeSelector(selector)), signal) : null;
	if (selector && !root) throw new Error(`tab.ariaSnapshot: selector ${JSON.stringify(selector)} matched no element`);
	try {
		return await untilAborted(captureAriaSnapshot(frame, root, options), signal);
	} finally {
		await root?.dispose().catch(() => undefined);
	}
}

/** Snapshot the main frame, optionally as a revisioned diff against the previous call with the same options. */
export async function ariaSnapshot(
	page: Page,
	selector: string | undefined,
	options: AriaSnapshotOptions,
	baselines: Map<string, AriaSnapshotBaseline>,
	signal: AbortSignal,
): Promise<string | AriaSnapshotDiffResult> {
	const snapshot = await frameAriaSnapshot(page.mainFrame(), selector, options, signal);
	if (!options.diff) return snapshot;
	return diffAriaSnapshot(baselines, ariaSnapshotBaselineKey(selector, options), page.url(), snapshot);
}

/**
 * Resolve a `[ref=eN]` id from the latest snapshot to a live main-world handle. A ref that no
 * longer matches an element (a later snapshot renumbered it, the page navigated or re-rendered) throws.
 */
export async function resolveAriaRef(page: Page, id: string): Promise<ElementHandle> {
	const ref = parseAriaRefSelector(id) ?? id.trim();
	const frame = page.mainFrame();
	const found = (await frame.isolatedRealm().evaluateHandle(loadEvaluators().resolveRef as never, ref as never)) as JSHandle;
	const element = found.asElement();
	if (!element) {
		await found.dispose().catch(() => undefined);
		throw new Error(`Unknown ARIA ref ${JSON.stringify(ref)}. Run tab.ariaSnapshot() to refresh refs (they renumber each snapshot).`);
	}
	try {
		return (await frame.mainRealm().adoptHandle(element)) as ElementHandle;
	} finally {
		await element.dispose().catch(() => undefined);
	}
}
