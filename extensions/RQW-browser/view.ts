import type { Frame, Page, SerializedAXNode } from "puppeteer-core";
import { untilAborted } from "./abort.ts";
import { type FrameSnapshot, type ObservationEntry, ObservedElements, observe } from "./observe.ts";

const CONTROLS = new Set([
	"button", "link", "textbox", "combobox", "listbox", "option", "checkbox", "radio", "switch",
	"tab", "menuitem", "menuitemcheckbox", "menuitemradio", "slider", "spinbutton", "searchbox", "treeitem",
]);

function text(value: string | number): string {
	return String(value).replace(/\s+/g, " ").trim().replace(/([\\`*_\[\]<>])/g, "\\$1");
}

/** Render the same observation and ids used by tab.id(), without repeating accessible names. */
export async function view(page: Page, registry: ObservedElements, signal: AbortSignal, visibleText?: string[]): Promise<string> {
	const capture = { missed: [] as string[], nodes: new Map<SerializedAXNode, ObservationEntry>(), trees: [] as FrameSnapshot[] };
	const observation = await observe(page, registry, { includeAll: true, compact: true }, signal, capture);
	const suppressed = new Set<SerializedAXNode>();
	function meaningful(node: SerializedAXNode): boolean {
		const entry = capture.nodes.get(node);
		return CONTROLS.has(node.role) || !!entry?.states.length || entry?.value !== undefined;
	}
	function findDuplicates(node: SerializedAXNode, ancestors: SerializedAXNode[]): void {
		const name = node.name?.trim();
		if (name && capture.nodes.has(node)) {
			for (const ancestor of ancestors) {
				if (ancestor.name?.trim() !== name || !capture.nodes.has(ancestor)) continue;
				if (meaningful(node)) continue;
				if (meaningful(ancestor) || ancestor.role === "heading") suppressed.add(node);
				else suppressed.add(ancestor);
			}
		}
		for (const child of node.children ?? []) findDuplicates(child, [...ancestors, node]);
	}
	for (const tree of capture.trees) findDuplicates(tree.snapshot, []);

	// Frame owner backend ids connect separate snapshots to their parent's accessibility tree.
	const children = new Map<Frame, Map<number, FrameSnapshot[]>>();
	const unplaced = new Set(capture.trees.slice(1));
	const deadline = AbortSignal.any([signal, AbortSignal.timeout(5000)]);
	await Promise.all(capture.trees.slice(1).map(async tree => {
		try {
			const owner = await untilAborted(tree.frame.frameElement(), deadline, late => { void late.then(handle => handle?.dispose()).catch(() => {}); });
			if (!owner) return;
			let id: number;
			try { id = await untilAborted(owner.backendNodeId(), deadline); }
			finally { void owner.dispose().catch(() => {}); }
			const parent = tree.frame.parentFrame();
			if (!parent) return;
			let anchors = children.get(parent);
			if (!anchors) { anchors = new Map(); children.set(parent, anchors); }
			const at = anchors.get(id) ?? [];
			at.push(tree);
			anchors.set(id, at);
		} catch (error) {
			if (signal.aborted) throw error;
		}
	}));

	const body: string[] = [];
	function render(tree: FrameSnapshot, node: SerializedAXNode): void {
		const entry = capture.nodes.get(node);
		if (entry && !suppressed.has(node) && node.role !== "RootWebArea") {
			const name = entry.name?.trim();
			if (meaningful(node)) {
				const details = [name && text(name), entry.value !== undefined && `value=${text(entry.value)}`, entry.description && `description=${text(entry.description)}`, entry.keyshortcuts && `keyshortcuts=${text(entry.keyshortcuts)}`, ...entry.states].filter(Boolean);
				body.push(`- ${entry.role}${details.length ? `: ${details.join("; ")}` : ""} [id:${entry.id}]`);
			} else if (name) body.push(entry.role === "heading" ? `## ${text(name)}` : text(name));
		}
		for (const child of node.children ?? []) render(tree, child);
		if (node.backendNodeId !== undefined) {
			for (const child of children.get(tree.frame)?.get(node.backendNodeId) ?? []) {
				unplaced.delete(child);
				render(child, child.snapshot);
			}
		}
	}
	const main = capture.trees[0]!;
	render(main, main.snapshot);
	for (const tree of unplaced) {
		if (!unplaced.has(tree)) continue;
		unplaced.delete(tree);
		capture.missed.push(tree.frame.url());
		render(tree, tree.snapshot);
	}
	if (visibleText) {
		await Promise.all(capture.trees.map(async tree => {
			try {
				const found = await untilAborted(tree.frame.evaluate(() => {
					const values: string[] = [];
					const parts: string[] = [];
					let partial = false;
					type Clip = { rect: DOMRect; x: boolean; y: boolean };
					function visible(rect: DOMRect, clips: Clip[]): boolean {
						if (rect.width <= 0 || rect.height <= 0) return false;
						let { left, right, top, bottom } = rect;
						for (const clip of clips) {
							if (clip.x) { left = Math.max(left, clip.rect.left); right = Math.min(right, clip.rect.right); }
							if (clip.y) { top = Math.max(top, clip.rect.top); bottom = Math.min(bottom, clip.rect.bottom); }
						}
						const overlaps = left < right && top < bottom;
						if (overlaps && (left > rect.left || right < rect.right || top > rect.top || bottom < rect.bottom)) partial = true;
						return overlaps;
					}
					function walk(node: Node, clips: Clip[]): void {
						if (node.nodeType === 3) {
							const value = node.textContent;
							if (!value) return;
							const range = document.createRange();
							range.selectNodeContents(node);
							if (visible(range.getBoundingClientRect(), clips)) parts.push(value);
							return;
						}
						if (node.nodeType !== 1 && node.nodeType !== 11) return;
						let block = false;
						if (node.nodeType === 1) {
							const element = node as HTMLElement;
							const style = getComputedStyle(element);
							if (style.display === "none" || style.visibility !== "visible" || Number(style.opacity) === 0) return;
							block = /^(block|flow-root|flex|grid|list-item|table|table-row|table-cell)$/.test(style.display);
							if (block) parts.push(" ");
							const x = /^(hidden|clip|scroll|auto)$/.test(style.overflowX);
							const y = /^(hidden|clip|scroll|auto)$/.test(style.overflowY);
							if (x || y) clips = [...clips, { rect: element.getBoundingClientRect(), x, y }];
							if (element.matches("input:not([type=hidden]):not([type=password]), textarea, select")) {
								const rect = element.getBoundingClientRect();
								if (visible(rect, clips)) {
									const control = element as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
									values.push(control instanceof HTMLSelectElement ? control.selectedOptions[0]?.text ?? "" : control.value);
								}
							}
							if (element.shadowRoot) {
								walk(element.shadowRoot, clips);
								if (block) parts.push(" ");
								return;
							}
							if (element instanceof HTMLSlotElement) {
								const assigned = element.assignedNodes({ flatten: true });
								if (assigned.length) { assigned.forEach(child => walk(child, clips)); return; }
							}
						}
						for (const child of node.childNodes) walk(child, clips);
						if (block) parts.push(" ");
					}
					if (document.body) walk(document.body, []);
					values.push(parts.join("").replace(/\s+/g, " "));
					return { values, partial };
				}), deadline);
				visibleText.push(...found.values);
				if (found.partial) capture.missed.push(tree.frame.url());
			} catch (error) {
				if (signal.aborted) throw error;
				capture.missed.push(tree.frame.url());
			}
		}));
	}
	const lines = [`# ${text(observation.title || "Untitled")}`, `URL: ${text(observation.url)}`];
	if (capture.missed.length) lines.push(`INCOMPLETE: unavailable or unplaced frames: ${capture.missed.map(text).join(", ")}`);
	return [...lines, ...body].join("\n");
}
