import type { ElementHandle, Frame, JSHandle, Page, SerializedAXNode } from "puppeteer-core";
import { untilAborted } from "./abort.ts";
import { resolveAriaRef } from "./aria.ts";
import { normalizeSelector, parseAriaRefSelector } from "./selectors.ts";

// Adapted from oh-my-pi 18.8.9 (browser/tab-worker.ts), MIT; see THIRD-PARTY-NOTICES.md.

// Pinned puppeteer-core 25.3.0 members that its published types strip as @internal; they exist at run time.
declare module "puppeteer-core" {
	interface Frame {
		mainRealm(): Realm;
		isolatedRealm(): Realm;
		readonly accessibility: Accessibility;
		/** Changes on every navigation that loads a document; a back/forward cache restore keeps the previous value. */
		readonly _loaderId: string;
		readonly client: CDPSession;
	}
	interface Realm {
		adoptHandle<T extends JSHandle>(handle: T): Promise<T>;
		adoptBackendNode(backendNodeId: number): Promise<JSHandle>;
	}
	interface SerializedAXNode {
		readonly backendNodeId?: number;
		/** Loader of the frame's document when the snapshot was taken. */
		readonly loaderId: string;
	}
}

/** Bound on reading every iframe in one observation; a frame whose renderer is stuck in script never answers. */
const FRAME_SNAPSHOT_TIMEOUT_MS = 5_000;

const INTERACTIVE_AX_ROLES = new Set([
	"button",
	"link",
	"textbox",
	"combobox",
	"listbox",
	"option",
	"checkbox",
	"radio",
	"switch",
	"tab",
	"menuitem",
	"menuitemcheckbox",
	"menuitemradio",
	"slider",
	"spinbutton",
	"searchbox",
	"treeitem",
]);

export interface ObservationEntry {
	id: number;
	role: string;
	name?: string;
	value?: string | number;
	description?: string;
	keyshortcuts?: string;
	states: string[];
}

export interface Observation {
	url: string;
	title: string;
	viewport: { width: number; height: number; deviceScaleFactor: number };
	scroll: { x: number; y: number; width: number; height: number; scrollWidth: number; scrollHeight: number };
	elements: ObservationEntry[];
}

export interface ObserveOptions {
	includeAll?: boolean;
	viewportOnly?: boolean;
	selector?: string;
	compact?: boolean;
}

/** Where an observed element lives; `tab.id(n)` resolves it to a handle on use. */
interface ObservedElement {
	frame: Frame;
	backendNodeId: number;
	/**
	 * Loader of the document `frame` showed when observed. Backend node ids are unique only within
	 * one renderer process, so once the frame shows another document the id may name an unrelated node.
	 */
	loaderId: string;
}

/** Whether the frame has loaded another document since `element` was observed. */
function isObservedDocumentGone(element: ObservedElement): boolean {
	return element.frame._loaderId !== element.loaderId;
}

function staleError(id: number): Error {
	return new Error(`Element id ${id} is stale. Run tab.observe() again.`);
}

/**
 * Resolve an observed element to a handle in its frame's main world, or null when the node is
 * gone, has left the document, or the frame no longer shows the document it was observed in (any
 * resolution failure counts as gone). Text nodes resolve to their parent.
 */
async function resolveObservedElement(observed: ObservedElement): Promise<ElementHandle | null> {
	if (isObservedDocumentGone(observed)) return null;
	let node: JSHandle;
	try {
		node = await observed.frame.mainRealm().adoptBackendNode(observed.backendNodeId);
	} catch {
		return null;
	}
	try {
		const resolved = await node.evaluateHandle(value => {
			const candidate = value as unknown as { nodeType: number; parentElement: Element | null };
			const element = (candidate.nodeType === 3 ? candidate.parentElement : value) as unknown as Element | null;
			if (!element?.isConnected) return null;
			// The document itself (the root `includeAll` lists) has no owner document.
			const owner: unknown = candidate.nodeType === 9 ? value : element.ownerDocument;
			return owner === document ? element : null;
		});
		const element = resolved.asElement();
		// The frame may have committed another document while the node resolved.
		if (element && !isObservedDocumentGone(observed)) return element as ElementHandle;
		await resolved.dispose().catch(() => undefined);
		return null;
	} catch {
		return null;
	} finally {
		await node.dispose().catch(() => undefined);
	}
}

/** The numbered elements of the latest observation of one tab. */
export class ObservedElements {
	#elements = new Map<number, ObservedElement>();
	#counter = 0;
	#nextViewId = Number.MAX_SAFE_INTEGER;
	#viewMode = false;

	add(element: ObservedElement): number {
		const id = this.#viewMode ? this.#nextViewId-- : ++this.#counter;
		if (id <= 0 || this.#counter >= this.#nextViewId) throw new Error("Observation id space exhausted.");
		this.#elements.set(id, element);
		return id;
	}

	/** Forget every id; called on navigation and at the start of each observation. */
	clear(): void {
		this.#elements.clear();
		this.#counter = 0;
		this.#viewMode = false;
	}

	/** View ids never overlap ordinary observation ids or earlier view ids. */
	beginView(): void {
		this.clear();
		this.#viewMode = true;
	}

	async resolve(id: number): Promise<ElementHandle> {
		const element = this.#elements.get(id);
		if (!element) throw new Error(`Unknown element id ${id}. Run tab.observe() to refresh the element list.`);
		if (isObservedDocumentGone(element)) {
			this.clear();
			throw staleError(id);
		}
		const handle = await resolveObservedElement(element);
		// An observe() during the await renumbers ids, so the id may now name another element.
		if (!handle || this.#elements.get(id) !== element) {
			await handle?.dispose().catch(() => undefined);
			if (this.#elements.get(id) === element) this.clear();
			throw staleError(id);
		}
		return handle;
	}
}

function isInteractiveNode(node: SerializedAXNode): boolean {
	if (INTERACTIVE_AX_ROLES.has(node.role)) return true;
	return (
		node.checked !== undefined ||
		node.pressed !== undefined ||
		node.selected !== undefined ||
		node.expanded !== undefined ||
		node.focused === true
	);
}

// Page function: serialized into the page, so it must stay self-contained.
function composedContains(ancestor: unknown, descendant: unknown): boolean {
	for (let current = descendant as Node | null; current; ) {
		if (current === ancestor) return true;
		const root = current.getRootNode() as ShadowRoot;
		current = (current as Element).parentElement ?? root.host ?? null;
	}
	return false;
}

function withTimeout<T>(work: Promise<T>, ms: number, timeout: Error, signal: AbortSignal): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const expired = new Promise<never>((_, reject) => {
		timer = setTimeout(() => reject(timeout), ms);
	});
	return untilAborted(Promise.race([work, expired]), signal).finally(() => clearTimeout(timer));
}

async function snapshotFrame(frame: Frame, interestingOnly: boolean, root: ElementHandle | null): Promise<SerializedAXNode | null> {
	if (root) {
		const owner = await frame.frameElement();
		if (!owner) return null;
		const scoped = await root.frame.mainRealm().adoptHandle(owner).finally(() => owner.dispose().catch(() => undefined));
		try {
			// The owner may sit in a web component's shadow root under `root`, where `Node.contains` stops.
			if (!(await root.evaluate(composedContains, scoped))) return null;
		} finally {
			await scoped.dispose().catch(() => undefined);
		}
	}
	return await frame.accessibility.snapshot({ interestingOnly });
}

/** One frame's accessibility tree; ids observed in it resolve in that frame. */
export interface FrameSnapshot {
	frame: Frame;
	snapshot: SerializedAXNode;
}

/**
 * Accessibility snapshots of `frames` and their descendants, each with its frame, in frame-tree
 * order. A frame that does not answer by `deadline` is left out with its descendants, so one dead
 * iframe never costs the page its observation. With `root`, only frames inside it are read.
 */
async function snapshotFrames(
	frames: Frame[],
	options: { interestingOnly: boolean; root: ElementHandle | null; deadline: number; signal: AbortSignal; missed?: string[] },
): Promise<FrameSnapshot[]> {
	const snapshots = await Promise.all(
		frames.map(async (frame): Promise<FrameSnapshot[]> => {
			const timeout = new Error(`Frame ${frame.url()} did not answer`);
			let snapshot: SerializedAXNode | null;
			try {
				snapshot = await withTimeout(
					snapshotFrame(frame, options.interestingOnly, options.root),
					Math.max(0, options.deadline - Date.now()),
					timeout,
					options.signal,
				);
			} catch (error) {
				if (options.signal.aborted) throw error;
				options.missed?.push(frame.url());
				return [];
			}
			if (!snapshot) {
				if (!options.root) options.missed?.push(frame.url());
				return [];
			}
			return [{ frame, snapshot }, ...(await snapshotFrames(frame.childFrames(), { ...options, root: null }))];
		}),
	);
	return snapshots.flat();
}

function collectInteractiveObservationAncestors(node: SerializedAXNode, ancestors: Set<SerializedAXNode>): boolean {
	let found = false;
	for (const child of node.children ?? []) {
		const descendantInteractive = collectInteractiveObservationAncestors(child, ancestors);
		if (isInteractiveNode(child) || descendantInteractive) found = true;
	}
	if (found) ancestors.add(node);
	return found;
}

async function collectObservationEntries(
	registry: ObservedElements,
	frame: Frame,
	node: SerializedAXNode,
	entries: ObservationEntry[],
	options: {
		viewportOnly: boolean;
		includeAll: boolean;
		compact: boolean;
		interactiveAncestors: Set<SerializedAXNode>;
		viewNodes?: Map<SerializedAXNode, ObservationEntry>;
		signal: AbortSignal;
	},
): Promise<void> {
	const emptyStructural =
		(node.role === "generic" || node.role === "none" || node.role === "group") &&
		!node.name &&
		!options.interactiveAncestors.has(node);
	if (
		node.backendNodeId !== undefined &&
		(options.includeAll || isInteractiveNode(node)) &&
		!(options.compact && emptyStructural)
	) {
		const observed: ObservedElement = { frame, backendNodeId: node.backendNodeId, loaderId: node.loaderId };
		let inViewport = true;
		if (options.viewportOnly) {
			const handle = await untilAborted(resolveObservedElement(observed), options.signal, late => { void late.then(found => found?.dispose()).catch(() => {}); });
			inViewport = (await handle?.isIntersectingViewport().catch(() => false)) ?? false;
			await handle?.dispose().catch(() => undefined);
		}
		if (inViewport) {
			const id = registry.add(observed);
			const states: string[] = [];
			if (node.disabled) states.push("disabled");
			if (node.checked !== undefined) states.push(`checked=${String(node.checked)}`);
			if (node.pressed !== undefined) states.push(`pressed=${String(node.pressed)}`);
			if (node.selected !== undefined) states.push(`selected=${String(node.selected)}`);
			if (node.expanded !== undefined) states.push(`expanded=${String(node.expanded)}`);
			if (node.required) states.push("required");
			if (node.readonly) states.push("readonly");
			if (node.multiselectable) states.push("multiselectable");
			if (node.multiline) states.push("multiline");
			if (node.modal) states.push("modal");
			if (node.focused) states.push("focused");
			const entry: ObservationEntry = {
				id,
				role: node.role,
				name: node.name,
				value: node.value,
				description: node.description,
				keyshortcuts: node.keyshortcuts,
				states,
			};
			entries.push(entry);
			options.viewNodes?.set(node, entry);
		}
	}
	for (const child of node.children ?? []) {
		await collectObservationEntries(registry, frame, child, entries, options);
	}
}

/** Number the interactive elements of the page and its frames; ids feed `tab.id(n)` until the next observation. */
export async function observe(page: Page, registry: ObservedElements, options: ObserveOptions, signal: AbortSignal, view?: { missed: string[]; nodes: Map<SerializedAXNode, ObservationEntry>; trees: FrameSnapshot[] }): Promise<Observation> {
	if (view) registry.beginView();
	else registry.clear();
	const includeAll = options.includeAll ?? false;
	const viewportOnly = options.viewportOnly ?? false;
	let root: ElementHandle | null = null;
	if (options.selector) {
		root =
			parseAriaRefSelector(options.selector) !== null
				? await untilAborted(resolveAriaRef(page, options.selector), signal)
				: await untilAborted(page.$(normalizeSelector(options.selector)), signal);
		if (!root) throw new Error(`tab.observe: selector ${JSON.stringify(options.selector)} matched no element`);
	}
	let snapshot: SerializedAXNode | null;
	let frameSnapshots: FrameSnapshot[];
	try {
		snapshot = await untilAborted(page.accessibility.snapshot({ interestingOnly: !includeAll, root: root ?? undefined }), signal);
		frameSnapshots = await snapshotFrames(page.mainFrame().childFrames(), {
			interestingOnly: !includeAll,
			root,
			deadline: Date.now() + FRAME_SNAPSHOT_TIMEOUT_MS,
			signal,
			missed: view?.missed,
		});
	} finally {
		await root?.dispose().catch(() => undefined);
	}
	if (!snapshot) throw new Error("Accessibility snapshot unavailable");
	const entries: ObservationEntry[] = [];
	const interactiveAncestors = new Set<SerializedAXNode>();
	const trees: FrameSnapshot[] = [{ frame: page.mainFrame(), snapshot }, ...frameSnapshots];
	for (const tree of trees) {
		view?.trees.push(tree);
		if (options.compact) collectInteractiveObservationAncestors(tree.snapshot, interactiveAncestors);
		await collectObservationEntries(registry, tree.frame, tree.snapshot, entries, {
			includeAll,
			viewportOnly,
			compact: options.compact ?? false,
			interactiveAncestors,
			viewNodes: view?.nodes,
			signal,
		});
	}
	const geometry = await untilAborted(
		page.evaluate(() => {
			const win = globalThis as unknown as {
				scrollX: number;
				scrollY: number;
				innerWidth: number;
				innerHeight: number;
				devicePixelRatio: number;
				document: { documentElement: { scrollWidth: number; scrollHeight: number } };
			};
			const doc = win.document.documentElement;
			return {
				viewport: { width: win.innerWidth, height: win.innerHeight, deviceScaleFactor: win.devicePixelRatio },
				scroll: {
					x: win.scrollX,
					y: win.scrollY,
					width: win.innerWidth,
					height: win.innerHeight,
					scrollWidth: doc.scrollWidth,
					scrollHeight: doc.scrollHeight,
				},
			};
		}),
		signal,
	);
	return { url: page.url(), title: await untilAborted(page.title(), signal), ...geometry, elements: entries };
}
