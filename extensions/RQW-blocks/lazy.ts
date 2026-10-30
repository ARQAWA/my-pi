// Lazy history for Pi's fullscreen view. At start (resume, /reload, rebuilds, a compaction) only the part from the latest
// compaction's kept range on is drawn; the older part waits as entries, cut into one interval per compaction. When the owner
// scrolls up to the top, the next older interval is drawn above in one splice and the rows he reads stay in place. On the way
// back down (wheel, Page Down, scrollbar, Escape, Ctrl+End, Jump to latest) the loaded intervals that are entirely above the
// screen are removed again. Runtime patch, [D-SCOPE-RUNTIME-PATCH]: every private seam is shape checked, any other shape (or
// any failure) means today's whole branch.
//
// Loading and unloading only ever run from user scroll inputs (`ScrollView.scrollBy`, `scrollToStart`, `scrollToEnd`, a
// scrollbar drag), never inside a frame: `ScrollView.scrollTo` is not wrapped, because the search calls it from `doRender`.
// An input up only loads and an input down only unloads: a load can put the view at the end of a short transcript, where
// follow mode turns on, and that must not unload what was just loaded.
import { Container } from "@earendil-works/pi-tui";

type Entry = { id: string; type: string };
type Render = (this: any, entries: Entry[], options?: unknown) => unknown;
/** One loaded interval: where it starts in the branch and the chat children it drew, in order. */
interface Loaded { start: number; children: unknown[] }
/** `older`: the branch entries before the floor (indexes are branch indexes). `floor`: where the first draw started, never
 * unloaded. `from`: where the drawn part starts now. `starts`: the interval starts below the floor, strictly ascending, from 0;
 * the next interval to load is [previous start, `from`). `loaded`: the intervals drawn above the floor, oldest first. */
interface State { older: Entry[]; floor: number; from: number; starts: number[]; loaded: Loaded[]; anchor: unknown; armed: boolean }

export interface Lazy {
	/** True when the host has the fullscreen shape this patch needs and lazy history is not switched off. */
	available(host: any): boolean;
	/** Where the previous draw started in the branch; 0 when everything was drawn. */
	drawnFrom(host: any): number;
	/** The host is about to be redrawn from scratch: forget what was waiting. */
	reset(host: any): void;
	/** The host drew the branch from `from` on; `older` (branch entries before it, cut at `starts`) loads on scrolling up. */
	begin(host: any, older: Entry[], from: number, starts: number[]): void;
	/** After a rebuild from the floor: draw the intervals down to `keep` again, so what he had loaded stays. */
	restore(host: any, keep: number): void;
	/** Draw everything that waits (before the view stops scrolling, e.g. inline mode or the exit transcript). */
	loadAll(host: any): void;
	dispose(): void;
}

export function createLazy(render: Render, enabled: boolean): Lazy {
	const states = new WeakMap<object, State>();
	const views = new WeakMap<object, any>();
	const patched: [any, string, PropertyDescriptor | undefined, unknown][] = [];
	let disabled = false;

	const fullscreen = (host: any): boolean => {
		const view = host?.transcriptScrollView;
		const renderer = host?.renderer;
		return renderer?.mode === "fullscreen" && !!view
			&& typeof view.scrollBy === "function" && typeof view.scrollToStart === "function" && typeof view.scrollTo === "function"
			&& typeof view.scrollToEnd === "function" && typeof view.getContentWidth === "function"
			&& typeof view.contentHeight === "number" && typeof view.viewportHeight === "number"
			&& typeof renderer.terminal?.columns === "number" && typeof renderer.scrollScrollbarToPointer === "function"
			&& Array.isArray(host.chatContainer?.children) && Array.isArray(host.documentContainer?.children) && host.pendingTools instanceof Map
			&& typeof host.rebuildChatFromMessages === "function";
	};

	/** Whole branch from now on, drawn again at once (today's behaviour). */
	const fail = (host: any) => {
		disabled = true;
		states.delete(host);
		try {
			host.rebuildChatFromMessages();
			host.renderer?.resetTextSelection?.();
		} catch { /* nothing more to try */ }
	};

	/** Draw the next older interval (all of them when `all`) and put its children first.
	 * Live tool tracking is kept. */
	const load = (host: any, state: State, keepRows: boolean, all: boolean) => {
		const to = state.from;
		let start = 0;
		if (!all) for (const candidate of state.starts) if (candidate < to) start = candidate;
		const older = state.older.slice(start, to);
		const real = host.chatContainer as Container;
		if (real.children[0] !== state.anchor) { states.delete(host); return; }
		const live = new Map(host.pendingTools);
		// Pi draws into its own chat container, which other patches track by position: set the drawn part aside, draw the
		// older interval into the emptied container as a transcript that starts here, and put the drawn part back.
		const tail = real.children.splice(0);
		let added: Container[] = [];
		try { render.call(host, older, {}); } finally {
			added = real.children.splice(0) as Container[];
			real.children.push(...tail);
			host.pendingTools.clear();
			for (const [id, component] of live) host.pendingTools.set(id, component);
		}
		real.children.unshift(...added);
		state.loaded.unshift({ start, children: added });
		let rows = 0;
		if (keepRows) {
			// Measure what the frame will draw: the chat's own render first lets patches that track it by position (the
			// worked-for folds) bind the new components, so folds that start closed count closed.
			const width = host.transcriptScrollView.getContentWidth(Math.max(1, host.renderer.terminal.columns));
			real.render(width);
			const heights = (real as any).mouseLayout?.children;
			if (!Array.isArray(heights)) throw new Error("no layout");
			for (let i = 0; i < added.length; i++) rows += heights[i].height;
		}
		(real as any).mouseLayout = undefined;
		if (host.documentContainer) host.documentContainer.mouseLayout = undefined;
		state.from = start;
		state.anchor = real.children[0];
		host.renderer?.resetTextSelection?.();
		if (keepRows) {
			const view = host.transcriptScrollView;
			// scrollTo clamps by the last frame's height: raise it by the new rows first.
			view.contentHeight += rows;
			view.scrollTo(view.scrollTop + rows);
		}
	};

	/** After an upward input that reached the top: load what waits. */
	const loadAtTop = (view: any) => {
		const host = views.get(view);
		const state = host && states.get(host);
		if (!state || state.from <= 0 || view.scrollTop !== 0) return;
		try { load(host, state, true, false); } catch { fail(host); }
	};

	/** After a downward input: remove the loaded intervals that are entirely above the screen, oldest first. Wheel and
	 * Page Down keep one screen of margin; at the end (Escape, Ctrl+End, Jump to latest) the margin is 0. */
	const unloadAbove = (view: any) => {
		const host = views.get(view);
		const state = host && states.get(host);
		if (!state || state.loaded.length === 0) return;
		try { unload(host, state, view); } catch { fail(host); }
	};

	const unload = (host: any, state: State, view: any) => {
		const real = host.chatContainer as Container;
		const document = host.documentContainer as Container;
		if (real.children[0] !== state.anchor) { states.delete(host); return; }
		const width = view.getContentWidth(Math.max(1, host.renderer.terminal.columns));
		// A layout of another width waits for the next frame: the scroll position is still in the old width's rows.
		if ((real as any).mouseLayout?.width !== width || (document as any).mouseLayout?.width !== width) return;
		// The heights are taken now, so a Ctrl+O or thinking toggle before the next frame never uses old numbers. At the end
		// the screen shows the last rows of the document as it is now; elsewhere the scroll position stays where it is.
		let limit = view.scrollTop - view.viewportHeight;
		if (view.isFollowingEnd) {
			let height = 0;
			for (const child of document.children) height += child.render(width).length;
			limit = Math.max(0, height - view.viewportHeight);
		}
		let top = 0;
		for (const child of document.children) {
			if (child === real) break;
			top += child.render(width).length;
		}
		let removed = 0;
		let intervals = 0;
		let count = 0;
		for (const interval of state.loaded) {
			let height = 0;
			for (const child of interval.children as Container[]) height += child.render(width).length;
			if (top + removed + height > limit) break;
			removed += height;
			count += interval.children.length;
			intervals++;
		}
		if (intervals === 0) return;
		real.children.splice(0, count);
		state.loaded.splice(0, intervals);
		state.from = state.loaded[0]?.start ?? state.floor;
		state.anchor = real.children[0];
		(real as any).mouseLayout = undefined;
		(document as any).mouseLayout = undefined;
		host.renderer?.resetTextSelection?.();
		// Raise nothing, lower the height by what left; at the end the view keeps following it.
		view.contentHeight -= removed;
		view.scrollTo(view.scrollTop - removed);
	};

	const patch = (target: any, name: string, make: (original: (...args: any[]) => any) => (...args: any[]) => any) => {
		if (patched.some(([object, key]) => object === target && key === name)) return;
		const original = target[name];
		if (typeof original !== "function") return;
		const own = Object.getOwnPropertyDescriptor(target, name);
		const wrapper = make(original);
		target[name] = wrapper;
		patched.push([target, name, own, wrapper]);
	};

	const install = (host: any) => {
		const view = host.transcriptScrollView;
		const renderer = host.renderer;
		views.set(view, host);
		patch(view, "scrollBy", (original) => function (this: any, lines: number) {
			const remaining = original.call(this, lines);
			if (Number.isFinite(lines)) {
				if (Math.trunc(lines) < 0) loadAtTop(this);
				else if (Math.trunc(lines) > 0) unloadAbove(this);
			}
			return remaining;
		});
		patch(view, "scrollToEnd", (original) => function (this: any, ...args: unknown[]) {
			const result = original.apply(this, args);
			unloadAbove(this);
			return result;
		});
		patch(view, "scrollToStart", (original) => function (this: any, ...args: unknown[]) {
			const result = original.apply(this, args);
			loadAtTop(this);
			return result;
		});
		patch(renderer, "scrollScrollbarToPointer", (original) => function (this: any, scrollView: any, ...args: unknown[]) {
			const before = scrollView.scrollTop;
			const result = original.call(this, scrollView, ...args);
			const owner = views.get(scrollView);
			const state = owner && states.get(owner);
			if (state) {
				// One load per arrival at the top of the track: the pointer must leave the top before the next one.
				if (scrollView.scrollTop > 0) {
					state.armed = true;
					// Up only loads: a drag up never unloads.
					if (scrollView.scrollTop > before) unloadAbove(scrollView);
				}
				else if (state.armed) { state.armed = false; loadAtTop(scrollView); }
			}
			return result;
		});
	};

	return {
		available: (host) => enabled && !disabled && fullscreen(host),
		drawnFrom: (host) => states.get(host)?.from ?? 0,
		reset: (host) => { states.delete(host); },
		begin(host, older, from, starts) {
			try {
				states.set(host, { older, floor: from, from, starts, loaded: [], anchor: host.chatContainer.children[0], armed: true });
				install(host);
			} catch { fail(host); }
		},
		restore(host, keep) {
			const state = states.get(host);
			try {
				while (state && state.from > keep) load(host, state, false, false);
			} catch { fail(host); }
		},
		loadAll(host) {
			const state = states.get(host);
			if (!state || state.from <= 0) return;
			try { load(host, state, false, true); } catch { fail(host); }
		},
		dispose() {
			for (const [target, name, own, wrapper] of patched) {
				if (target[name] !== wrapper) continue;
				if (own) Object.defineProperty(target, name, own); else delete target[name];
			}
			patched.length = 0;
		},
	};
}
