// Worked-for folds: each successful answer closes an independent span. Previous answers and hard history boundaries
// stay outside the `worked for <time>` fold (README.md, DECISIONS.md «Compact tool display»).
// Runtime patch under [D-SCOPE-RUNTIME-PATCH]: one wrapper on `InteractiveMode.prototype.addMessageToChat` finds the
// chat container, one O(1) guard on that container instance notices a rebuilt or reloaded transcript. The components
// stay where Pi put them, in the same order and identity. Any other shape keeps today's tool-ui view.
import {
	AssistantMessageComponent, BashExecutionComponent, BranchSummaryMessageComponent, CompactionSummaryMessageComponent,
	type SessionEntry, type Theme,
} from "@earendil-works/pi-coding-agent";
import { Spacer, truncateToWidth, TuiAltScreen, visibleWidth } from "@earendil-works/pi-tui";
import { messageKey, TurnIndex, type TurnSpan } from "./groups.ts";

/** What a hidden component draws: nothing, shared. */
const NONE: string[] = Object.freeze([]) as unknown as string[];

type Renders = { render(width: number): string[] };
type Mouse = { type?: unknown; button?: unknown; y: number; height: number };
type Handles = { handleMouse?: (event: Mouse) => unknown };
type Chat = Renders & { children: object[]; mouseLayout?: unknown };
const UPDATE_NAMES = ["invalidate", "setExpanded", "setOutputPad", "rebuild"] as const;
type UpdateName = typeof UPDATE_NAMES[number];
type Update = (this: object, ...args: unknown[]) => unknown;
type RowRange = { component: object; from: number; to: number; sourceY: number; height: number };
type Host = {
	chatContainer?: unknown;
	sessionManager?: { getBranch?: () => SessionEntry[]; getLeafEntry?: () => SessionEntry | null; getEntry?: (id: string) => SessionEntry | undefined };
	renderer?: unknown;
	outputPad?: unknown;
	ui?: { requestRender?: () => void };
};

/** One boundary-local span: work closed by an answer or a kept-entry cut. */
export interface Fold {
	label: string;
	start: number;
	open: boolean;
	/** Open-state key: the final answer outside, or the prefix's first component inside. */
	final: object;
	/** Work components in Pi's order; the first draws the closed header. */
	members: object[];
	/** Member that draws the open header: the one right after the first message, else the last one (`tail`). */
	at: number;
	/** No member follows the first message: the open header goes below the rows of the member `at`. */
	tail: boolean;
	/** Original user bundles, including their spacers, projected only while closed. */
	lifted: object[];
	revision: number;
	disabled?: boolean;
	/** Cached rows and mouse transforms share the same width and revision. */
	cache?: { width: number; theme: Theme; pad: number; open: boolean; revision: number; lines?: string[]; rows: string[]; header: string; headerY: number; ranges: RowRange[] };
}

/** The member that draws and clicks the header: the first one closed, the one after the first message open. */
const carrier = (fold: Fold): object => fold.members[fold.open ? fold.at : 0];

/** A component inside a fold, with the own `render` and `handleMouse` it had before. */
interface Bound {
	fold: Fold;
	render: PropertyDescriptor | undefined;
	mouse: PropertyDescriptor | undefined;
	updates: Partial<Record<UpdateName, PropertyDescriptor | undefined>>;
}

export class Folds {
	private host: Host | undefined;
	private frozen = false;
	private pad = 1;
	private chat: Chat | undefined;
	private guard: ((this: Chat, width: number) => string[]) | undefined;
	private guardPrev: PropertyDescriptor | undefined;
	private theme: (() => Theme | undefined) | undefined;
	/** Bumped when the turns can have changed; the guard binds again on the next frame. */
	private version = 0;
	private seen = -1;
	private first: unknown;
	private index: TurnIndex | undefined;
	private leaf: string | undefined;
	/** Message bundles keep their original components, including user/skill spacers. */
	private keys = new WeakMap<object, string>();
	private users = new WeakSet<object>();
	private currentStart = 0;
	private dirty = 0;
	/** Open state per final answer component: a new component (reload, rebuild, reloaded interval) starts closed. */
	private opened = new WeakMap<object, boolean>();
	/** The folds of the components on screen now. */
	list: Fold[] = [];
	private bound = new Map<object, Bound>();
	/** The one `render` every bound component gets: an O(1) check, then nothing, the header or the original. */
	private readonly draw: (this: object, width: number) => string[];
	/** The one `handleMouse` every bound component gets: a left click on the header row toggles that fold only. */
	private readonly click: (this: object, event: Mouse) => unknown;
	private readonly updates: Record<UpdateName, Update>;

	constructor() {
		const folds = this;
		this.draw = function (this: object, width: number): string[] {
			const b = folds.bound.get(this);
			const own = b?.render?.value as Renders["render"] | undefined;
			const base = own ?? (Object.getPrototypeOf(this) as Renders).render;
			if (!b || b.fold.disabled) return base.call(this, width);
			const fold = b.fold;
			if (carrier(fold) !== this) return fold.open ? base.call(this, width) : NONE;
			return folds.owner(fold, fold.open ? base.call(this, width) : undefined, width) ?? base.call(this, width);
		};
		this.click = function (this: object, event: Mouse): unknown {
			const b = folds.bound.get(this);
			const own = b?.mouse?.value as Handles["handleMouse"] | undefined;
			const base = own ?? (Object.getPrototypeOf(this) as Handles).handleMouse;
			const fold = b?.fold;
			if (!fold || fold.disabled) return base?.call(this, event);
			if (carrier(fold) !== this) return fold.open ? base?.call(this, event) : undefined;
			const cache = fold.cache;
			if (!cache) return undefined;
			if (event.y === cache.headerY) {
				if (event.type !== "click" || event.button !== "left") return undefined;
				folds.setOpen(fold, !fold.open);
				return { handled: true };
			}
			const range = cache.ranges.find((r) => event.y >= r.from && event.y < r.to);
			if (!range) return undefined;
			const target = range.component;
			const descriptor = folds.bound.get(target)?.mouse;
			const mouse = descriptor?.value ?? (Object.getPrototypeOf(target) as Handles).handleMouse;
			return mouse?.call(target, { ...event, y: event.y - range.from + range.sourceY, height: range.height });
		};
		this.updates = Object.fromEntries(UPDATE_NAMES.map((name) => [name, function (this: object, ...args: unknown[]) {
			const b = folds.bound.get(this);
			const original = b?.updates[name]?.value ?? (Object.getPrototypeOf(this) as Record<UpdateName, Update>)[name];
			try { return original.apply(this, args); }
			finally { if (b) { b.fold.revision++; b.fold.cache = undefined; } }
		}])) as Record<UpdateName, Update>;
	}

	/** Closed: cached original user rows, then the header with `›`. Open: one arrowless header inserted into the rows
	 * of the member after the first message; all original rows stay in place. */
	private owner(fold: Fold, lines: string[] | undefined, width: number): string[] | undefined {
		try {
			const theme = this.theme?.();
			if (!theme) { fold.disabled = true; return undefined; }
			const pad = this.host && typeof this.host.outputPad === "number" ? Math.max(0, this.host.outputPad) : this.pad;
			const c = fold.cache;
			const same = c && c.width === width && c.theme === theme && c.pad === pad && c.open === fold.open && c.revision === fold.revision;
			if (same && c.lines === lines) return c.rows;
			const header = same ? c.header : truncateToWidth(" ".repeat(pad) + theme.fg("dim", fold.open ? fold.label : `${fold.label} ›`), Math.max(0, width));
			const rows: string[] = [];
			const ranges: RowRange[] = [];
			let headerY: number;
			if (!fold.open) {
				for (const component of fold.lifted) {
					const b = this.bound.get(component)!;
					const original = b.render?.value ?? (Object.getPrototypeOf(component) as Renders).render;
					const source: string[] = original.call(component, width);
					ranges.push({ component, from: rows.length, to: rows.length + source.length, sourceY: 0, height: source.length });
					for (const row of source) rows.push(row);
				}
				rows.push("");
				headerY = rows.length;
				rows.push(header);
			} else {
				const source = lines ?? NONE;
				headerY = fold.tail ? source.length : source.length > 0 && visibleWidth(source[0]) === 0 ? 1 : 0;
				rows.push(...source.slice(0, headerY), header, ...source.slice(headerY));
				const at = fold.members[fold.at];
				ranges.push({ component: at, from: 0, to: headerY, sourceY: 0, height: source.length },
					{ component: at, from: headerY + 1, to: rows.length, sourceY: headerY, height: source.length });
			}
			fold.cache = { width, theme, pad, open: fold.open, revision: fold.revision, lines, rows, header, headerY, ranges };
			return rows;
		} catch { fold.disabled = true; fold.cache = undefined; return undefined; }
	}

	/** Folds work only in Pi's fullscreen view with mouse reporting: the header opens by click. */
	private eligible(host: Host): boolean {
		const renderer = host.renderer;
		return renderer instanceof TuiAltScreen && (renderer as unknown as { mouseEnabled?: unknown }).mouseEnabled === true && typeof host.sessionManager?.getBranch === "function";
	}

	/** The session started (or its theme is known): bind on the next frame. */
	start(theme: () => Theme | undefined): void {
		this.theme = theme;
		this.changed();
	}

	/** The turns may have changed (settled run, compaction, tree navigation): bind now and redraw. */
	changed(rebuild = false): void {
		if (rebuild) this.index = undefined;
		this.version++;
		if (!this.chat) return;
		this.bind();
		this.host?.ui?.requestRender?.();
	}

	/** Pi's interactive mode drew a message: remember its chat container. O(1) once known. */
	attach(host: Host): void {
		if (host === this.host) return;
		this.detach();
		const chat = host.chatContainer as Partial<Chat> | undefined;
		if (!chat || !Array.isArray(chat.children) || typeof chat.render !== "function" || !Object.isExtensible(chat)) return;
		this.host = host;
		this.frozen = false;
		this.pad = typeof host.outputPad === "number" ? Math.max(0, host.outputPad) : 1;
		this.chat = chat as Chat;
		this.guardPrev = Object.getOwnPropertyDescriptor(chat, "render");
		const folds = this;
		const prev = this.guardPrev?.value as Renders["render"] | undefined;
		// A cleared or reloaded transcript has a new first child; new turns bump the version.
		const guard = function (this: Chat, width: number): string[] {
			if (!folds.frozen && folds.chat === this && (this.children[0] !== folds.first || folds.version !== folds.seen)) folds.bind();
			return (prev ?? (Object.getPrototypeOf(this) as Renders).render).call(this, width);
		};
		this.guard = guard;
		chat.render = guard;
	}

	/** Keep the displayed bindings, but release the old session until Pi replaces the transcript. */
	freeze(): void {
		this.frozen = true;
		this.host = undefined;
		this.index = undefined;
		this.leaf = undefined;
		this.keys = new WeakMap();
		this.users = new WeakSet();
	}

	/** Forget the container and every binding. */
	detach(): void {
		this.unbind();
		const chat = this.chat;
		if (chat && chat.render === this.guard) {
			if (this.guardPrev) Object.defineProperty(chat, "render", this.guardPrev);
			else delete (chat as Partial<Chat>).render;
		}
		this.host = this.chat = this.guard = this.guardPrev = undefined;
		this.frozen = false;
		this.first = undefined;
		this.index = undefined;
		this.leaf = undefined;
		this.keys = new WeakMap();
		this.users = new WeakSet();
		this.currentStart = 0;
		this.dirty = 0;
		this.seen = -1;
	}

	/** Remember whole message bundles. Lazy history can draw into an empty container, then prepend to the same tail. */
	message(host: Host, message: unknown, before: number): void {
		if (host !== this.host || !this.chat) return;
		if (before === 0) { this.currentStart = 0; this.dirty = 0; }
		const key = messageKey(message);
		if (key) for (let i = before; i < this.chat.children.length; i++) {
			const child = this.chat.children[i];
			this.keys.set(child, key);
			if ((message as { role?: unknown }).role === "user") this.users.add(child);
		}
		this.dirty = Math.min(this.dirty, this.currentStart, before);
	}

	/** Find the finished turns among the components on screen. */
	bind(): void {
		const host = this.host;
		const chat = this.chat;
		if (!host || !chat) return;
		this.seen = this.version;
		const rebuilt = this.first !== chat.children[0] || !this.index;
		this.first = chat.children[0];
		let finals: Map<string, TurnSpan> | undefined;
		let fullRebuild = rebuilt;
		// Any surprise in Pi's state keeps today's view.
		try {
			if (this.theme?.() && this.eligible(host)) {
				const manager = host.sessionManager!;
				let entries: SessionEntry[] = [];
				let full = rebuilt || !manager.getLeafEntry || !manager.getEntry;
				if (!full) {
					let entry = manager.getLeafEntry!();
					while (entry && entry.id !== this.leaf) { entries.push(entry); entry = entry.parentId ? manager.getEntry!(entry.parentId) ?? null : null; }
					if (this.leaf && !entry) full = true;
					entries.reverse();
					if (entries.some((e) => e.type === "compaction" || e.type === "branch_summary")) full = true;
				}
				if (full) {
					fullRebuild = true;
					entries = manager.getBranch!();
					this.index = new TurnIndex();
					this.index.append(entries, new Set(entries.flatMap((e) => e.type === "compaction" ? [e.firstKeptEntryId] : [])));
				} else this.index!.append(entries);
				this.leaf = manager.getLeafEntry?.()?.id ?? entries.at(-1)?.id;
				finals = this.index!.finals;
			}
		} catch { finals = undefined; this.index = undefined; }
		// Live assistant/tools bypass addMessageToChat. Revisit only the unfinished span, never a settled answer.
		const from = fullRebuild || !finals ? 0 : Math.max(0, Math.min(this.dirty, this.currentStart));
		let cut = this.list.length;
		while (cut > 0 && this.list[cut - 1].start >= from) cut--;
		const removed = this.list.splice(cut);
		const next: Fold[] = [];
		if (finals) {
			const children = chat.children;
			const savedKeys = this.savedCardKeys(children, from);
			let start = -1;
			let spanKey: string | undefined;
			const add = (end: number, anchor: object, span: TurnSpan) => {
				const members = children.slice(start, end);
				const lifted = members.filter((m) => this.users.has(m));
				if (members.every((m) => this.wrappable(m)) && members.some((m) => !this.users.has(m) && !(m instanceof Spacer))) {
					next.push({ label: span.label, start, open: this.opened.get(anchor) ?? false, final: anchor, members, ...this.afterFirstMessage(members), lifted, revision: 0 });
				}
			};
			const prefix = (end: number) => {
				const span = spanKey ? this.index!.prefixes.get(spanKey) : undefined;
				if (span && start >= 0) {
					add(end, children[start], span);
					this.currentStart = end;
					start = -1;
					spanKey = undefined;
				}
			};
			this.currentStart = from;
			for (let i = from; i < children.length; i++) {
				const child = children[i];
				if (child instanceof CompactionSummaryMessageComponent || child instanceof BranchSummaryMessageComponent || child instanceof BashExecutionComponent
					|| (child as { entry?: { customType?: string } }).entry?.customType === "rqw-auto-wait-v1") {
					prefix(i);
					start = -1;
					spanKey = undefined;
					this.currentStart = i + 1;
					continue;
				}
				const key = savedKeys.get(child) ?? this.sourceKey(child);
				const memberOf = key ? this.index!.members.get(key) : undefined;
				// Unkeyed tool components belong to the preceding message; close only at the next message bundle.
				if (key && memberOf !== spanKey) prefix(i);
				if (memberOf) {
					if (spanKey !== memberOf) { start = i; spanKey = memberOf; }
				}
				const span = child instanceof AssistantMessageComponent && key ? finals.get(key) : undefined;
				if (!span) continue;
				if (spanKey === key && start >= 0) add(i, child, span);
				start = -1;
				spanKey = undefined;
				this.currentStart = i + 1;
			}
			prefix(children.length);
		}
		// Only changed tail components need rebinding.
		const tail = new Set(next.flatMap((fold) => fold.members));
		for (const fold of removed) for (const m of fold.members) {
			const b = this.bound.get(m);
			if (b && !tail.has(m)) { this.unwrap(m, b); this.bound.delete(m); }
		}
		for (const fold of next) for (const m of fold.members) this.bound.set(m, { ...(this.bound.get(m) ?? this.wrap(m)), fold });
		this.list.push(...next);
		this.dirty = chat.children.length;
	}

	/** The member after the first message: its components share one key; unkeyed tool rows join only an assistant
	 * message. Without a later member the last one carries the header below its rows. */
	private afterFirstMessage(members: object[]): { at: number; tail: boolean } {
		const key = this.sourceKey(members[0]);
		const joinsTools = members[0] instanceof AssistantMessageComponent;
		let at = 1;
		while (at < members.length) {
			const next = this.sourceKey(members[at]);
			if (next === undefined ? !joinsTools : next !== key) break;
			at++;
		}
		return at < members.length ? { at, tail: false } : { at: members.length - 1, tail: true };
	}

	private sourceKey(component: object): string | undefined {
		return this.keys.get(component) ?? (component instanceof AssistantMessageComponent ? messageKey((component as unknown as { lastMessage?: unknown }).lastMessage) : undefined);
	}

	/** Match loaded cards backwards between saved message anchors. This also disambiguates identical cards after
	 * partial history loads, without scanning the branch or depending on the live timestamp equalling persistence. */
	private savedCardKeys(children: object[], from: number): Map<object, string> {
		const matched = new Map<object, string>();
		let before = Infinity;
		const index = this.index!;
		for (let i = children.length - 1; i >= from; i--) {
			const key = this.sourceKey(children[i]);
			if (!key) continue;
			const cards = index.cards.get(key);
			if (!cards) {
				const position = index.positions.get(key);
				if (position !== undefined) before = Math.min(before, position - 1);
				continue;
			}
			let lo = 0, hi = cards.length;
			while (lo < hi) {
				const mid = (lo + hi) >>> 1;
				if (cards[mid].position <= before) lo = mid + 1;
				else hi = mid;
			}
			const card = cards[lo - 1];
			if (card) { matched.set(children[i], card.key); before = card.position - 1; }
		}
		return matched;
	}

	private wrappable(m: object): boolean {
		if (!Object.isExtensible(m) || typeof (m as Partial<Renders>).render !== "function") return false;
		return ["render", "handleMouse", ...(this.users.has(m) ? UPDATE_NAMES : [])].every((name) => {
			// Assignment also obeys inherited descriptors. Reject the whole span before installing any wrapper.
			for (let at: object | null = m; at; at = Object.getPrototypeOf(at)) {
				const descriptor = Object.getOwnPropertyDescriptor(at, name);
				if (descriptor) return "value" in descriptor && descriptor.writable === true;
			}
			return true;
		});
	}

	private wrap(m: object): Omit<Bound, "fold"> {
		const own: Omit<Bound, "fold"> = { render: Object.getOwnPropertyDescriptor(m, "render"), mouse: Object.getOwnPropertyDescriptor(m, "handleMouse"), updates: {} };
		(m as Renders).render = this.draw;
		(m as Handles).handleMouse = this.click;
		if (this.users.has(m)) for (const name of UPDATE_NAMES) {
			if (typeof (m as Record<string, unknown>)[name] !== "function") continue;
			own.updates[name] = Object.getOwnPropertyDescriptor(m, name);
			(m as Record<UpdateName, Update>)[name] = this.updates[name];
		}
		return own;
	}

	private unwrap(m: object, b: Bound): void {
		const restore = (key: string, mine: unknown, own: PropertyDescriptor | undefined) => {
			if ((m as Record<string, unknown>)[key] !== mine) return;
			if (own) Object.defineProperty(m, key, own);
			else delete (m as Record<string, unknown>)[key];
		};
		restore("render", this.draw, b.render);
		restore("handleMouse", this.click, b.mouse);
		for (const name of UPDATE_NAMES) if (Object.hasOwn(b.updates, name)) restore(name, this.updates[name], b.updates[name]);
	}

	private unbind(): void {
		for (const [m, b] of this.bound) this.unwrap(m, b);
		this.bound.clear();
		this.list = [];
	}

	/** Remember a fold's open state for its final answer. */
	setOpen(fold: Fold, open: boolean): void {
		fold.open = open;
		this.opened.set(fold.final, open);
		fold.cache = undefined;
		if (this.chat) this.chat.mouseLayout = undefined;
		this.host?.ui?.requestRender?.();
	}
}
