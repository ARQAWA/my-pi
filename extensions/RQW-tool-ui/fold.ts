// Worked-for folds: once a turn has its final answer, everything Pi drew between the user message and that answer
// belongs to one fold under a `worked for <time>` header (README.md, DECISIONS.md «Compact tool display»).
// Runtime patch under [D-SCOPE-RUNTIME-PATCH]: one wrapper on `InteractiveMode.prototype.addMessageToChat` finds the
// chat container, one O(1) guard on that container instance notices a rebuilt or reloaded transcript. The components
// stay where Pi put them, in the same order and identity. Any other shape keeps today's tool-ui view.
import {
	AssistantMessageComponent, BashExecutionComponent, BranchSummaryMessageComponent, CompactionSummaryMessageComponent, InteractiveMode,
	type SessionEntry, SkillInvocationMessageComponent, type Theme, UserMessageComponent,
} from "@earendil-works/pi-coding-agent";
import { Spacer, truncateToWidth, TuiAltScreen, visibleWidth } from "@earendil-works/pi-tui";
import { messageKey, TurnIndex } from "./groups.ts";

const ACTIVE = Symbol.for("rqw-tool-ui.folds");
/** What a hidden component draws: nothing, shared. */
const NONE: string[] = Object.freeze([]) as unknown as string[];

type Renders = { render(width: number): string[] };
type Mouse = { type?: unknown; button?: unknown; y: number; height: number };
type Handles = { handleMouse?: (event: Mouse) => unknown };
type Chat = Renders & { children: object[] };
type Host = {
	chatContainer?: unknown;
	sessionManager?: { getBranch?: () => SessionEntry[]; getLeafEntry?: () => SessionEntry | null; getEntry?: (id: string) => SessionEntry | undefined };
	renderer?: unknown;
	outputPad?: unknown;
	ui?: { requestRender?: () => void };
};

/** One finished turn on screen: its work components and the final answer that stays outside. */
export interface Fold {
	label: string;
	start: number;
	open: boolean;
	/** The final answer's component: outside the fold, it keys the open state. */
	final: object;
	/** Every component between the user message and the final answer, in Pi's order; the first owns the header. */
	members: object[];
	/** The header owner's last rows, rebuilt only when their inputs change. */
	cache?: { width: number; theme: Theme; pad: number; open: boolean; lines: string[] | undefined; rows: string[] };
	/** The owner's own first row is the blank row above the header (open): later rows sit one lower, else two. */
	shift?: number;
}

/** A component inside a fold, with the own `render` and `handleMouse` it had before. */
interface Bound {
	fold: Fold;
	render: PropertyDescriptor | undefined;
	mouse: PropertyDescriptor | undefined;
}

export class Folds {
	private host: Host | undefined;
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
	private starts = new WeakMap<object, number>();
	private currentStart = -1;
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

	constructor() {
		const folds = this;
		this.draw = function (this: object, width: number): string[] {
			const b = folds.bound.get(this);
			const own = b?.render?.value as Renders["render"] | undefined;
			const base = own ?? (Object.getPrototypeOf(this) as Renders).render;
			if (!b) return base.call(this, width);
			const fold = b.fold;
			if (fold.members[0] !== this) return fold.open ? base.call(this, width) : NONE;
			return folds.owner(fold, fold.open ? base.call(this, width) : undefined, width) ?? base.call(this, width);
		};
		this.click = function (this: object, event: Mouse): unknown {
			const b = folds.bound.get(this);
			const own = b?.mouse?.value as Handles["handleMouse"] | undefined;
			const base = own ?? (Object.getPrototypeOf(this) as Handles).handleMouse;
			const fold = b?.fold;
			if (!fold || fold.members[0] !== this || !fold.cache) return base?.call(this, event);
			// Row 1 is the header: a click toggles; press, drag and release stay Pi's text selection.
			if (event.y === 1) {
				if (event.type !== "click" || event.button !== "left") return undefined;
				folds.setOpen(fold, !fold.open);
				return { handled: true };
			}
			const shift = fold.shift ?? 2;
			if (!fold.open || (event.y === 0 && shift === 2)) return undefined;
			return base?.call(this, event.y === 0 ? { ...event, height: event.height - shift } : { ...event, y: event.y - shift, height: event.height - shift });
		};
	}

	/** The header owner's rows: the header alone when closed; open, the header right under the owner's leading blank row,
	 * else under a blank row of its own, and every original row unchanged. Undefined without a theme. */
	private owner(fold: Fold, lines: string[] | undefined, width: number): string[] | undefined {
		let theme: Theme | undefined;
		try { theme = this.theme?.(); } catch { theme = undefined; }
		if (!theme) return undefined;
		const pad = typeof this.host?.outputPad === "number" ? Math.max(0, this.host.outputPad) : 1;
		const c = fold.cache;
		if (c && c.width === width && c.theme === theme && c.pad === pad && c.open === fold.open && c.lines === lines) return c.rows;
		const header = truncateToWidth(" ".repeat(pad) + theme.fg("dim", `${fold.label} ${fold.open ? "˅" : "›"}`), Math.max(0, width));
		const kept = lines !== undefined && lines.length > 0 && visibleWidth(lines[0]) === 0;
		const rows = !lines ? ["", header] : kept ? [lines[0], header, ...lines.slice(1)] : ["", header, ...lines];
		fold.shift = kept ? 1 : 2;
		fold.cache = { width, theme, pad, open: fold.open, lines, rows };
		return rows;
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
		this.chat = chat as Chat;
		this.guardPrev = Object.getOwnPropertyDescriptor(chat, "render");
		const folds = this;
		const prev = this.guardPrev?.value as Renders["render"] | undefined;
		// A cleared or reloaded transcript has a new first child; new turns bump the version.
		const guard = function (this: Chat, width: number): string[] {
			if (folds.chat === this && (this.children[0] !== folds.first || folds.version !== folds.seen)) folds.bind();
			return (prev ?? (Object.getPrototypeOf(this) as Renders).render).call(this, width);
		};
		this.guard = guard;
		chat.render = guard;
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
		this.first = undefined;
		this.index = undefined;
		this.leaf = undefined;
		this.starts = new WeakMap();
		this.currentStart = -1;
		this.dirty = 0;
		this.seen = -1;
	}

	/** Record the boundary even when Pi draws no component for a user message. */
	message(host: Host, message: unknown, before: number): void {
		if (host !== this.host || !this.chat || !message || typeof message !== "object") return;
		const role = (message as { role?: unknown }).role;
		if (before === 0) { this.starts = new WeakMap(); this.currentStart = -1; this.dirty = 0; }
		if (role === "user") this.currentStart = this.chat.children.length - 1;
		else if (role === "compactionSummary" || role === "branchSummary" || role === "bashExecution") this.currentStart = -1;
		else if (role === "assistant") {
			const child = this.chat.children[before];
			if (child) this.starts.set(child, this.currentStart);
		}
		if (role === "user" || role === "assistant" || role === "custom") this.dirty = Math.min(this.dirty, this.currentStart + 1);
	}

	/** Find the finished turns among the components on screen. */
	bind(): void {
		const host = this.host;
		const chat = this.chat;
		if (!host || !chat) return;
		this.seen = this.version;
		const rebuilt = this.first !== chat.children[0] || !this.index;
		this.first = chat.children[0];
		let finals: Map<string, string> | undefined;
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
		// Live assistant and tool components bypass addMessageToChat. Revisit the current turn,
		// including an earlier answer if another answer arrived after it settled.
		const from = fullRebuild || !finals ? 0 : Math.max(0, Math.min(this.dirty, this.currentStart + 1));
		let cut = this.list.length;
		while (cut > 0 && this.list[cut - 1].start >= from) cut--;
		const removed = this.list.splice(cut);
		const next: Fold[] = [];
		if (finals) {
			const children = chat.children;
			let start = from - 1;
			for (let i = from; i < children.length; i++) {
				const child = children[i];
				if (child instanceof UserMessageComponent || child instanceof SkillInvocationMessageComponent) start = i;
				else if (child instanceof CompactionSummaryMessageComponent || child instanceof BranchSummaryMessageComponent || child instanceof BashExecutionComponent) start = -1;
				else if (child instanceof AssistantMessageComponent) {
					start = this.starts.get(child) ?? start;
					if (start < -1) continue;
					const label = finals.get(messageKey((child as unknown as { lastMessage?: unknown }).lastMessage) ?? "");
					if (label === undefined) continue;
					const members = children.slice(start + 1, i);
					// A turn without work gets no header; a component that cannot take the wrapper keeps the turn unfolded.
					const wrappable = members.every((m) => typeof (m as Partial<Renders>).render === "function" && Object.isExtensible(m));
					if (wrappable && members.some((m) => !(m instanceof Spacer))) next.push({ label, start: start + 1, open: this.opened.get(child) ?? false, final: child, members });
					start = -1;
				}
			}
		}
		// Only changed tail components need rebinding.
		const tail = new Set(next.flatMap((fold) => fold.members));
		for (const fold of removed) for (const m of fold.members) {
			const b = this.bound.get(m);
			if (b && !tail.has(m)) { this.unwrap(m, b); this.bound.delete(m); }
		}
		for (const fold of next) for (const m of fold.members) this.bound.set(m, { fold, ...(this.bound.get(m) ?? this.wrap(m)) });
		this.list.push(...next);
		this.dirty = chat.children.length;
	}

	private wrap(m: object): Omit<Bound, "fold"> {
		const own = { render: Object.getOwnPropertyDescriptor(m, "render"), mouse: Object.getOwnPropertyDescriptor(m, "handleMouse") };
		(m as Renders).render = this.draw;
		(m as Handles).handleMouse = this.click;
		return own;
	}

	private unwrap(m: object, b: Bound): void {
		const restore = (key: "render" | "handleMouse", mine: unknown, own: PropertyDescriptor | undefined) => {
			if ((m as Record<string, unknown>)[key] !== mine) return;
			if (own) Object.defineProperty(m, key, own);
			else delete (m as Record<string, unknown>)[key];
		};
		restore("render", this.draw, b.render);
		restore("handleMouse", this.click, b.mouse);
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
	}
}

/** Install the folds on Pi's interactive mode; returns the cleanup. Another shape installs nothing. */
export function installFolds(folds: Folds, prototype: any = InteractiveMode.prototype): () => void {
	if (typeof prototype?.addMessageToChat !== "function") return () => {};
	const own = Object.getOwnPropertyDescriptor(prototype, "addMessageToChat");
	const original = prototype.addMessageToChat;
	(globalThis as Record<symbol, unknown>)[ACTIVE] = folds;
	const wrapper = function (this: Host, ...args: unknown[]) {
		const active = (globalThis as Record<symbol, unknown>)[ACTIVE] === folds;
		if (active) folds.attach(this);
		const before = (this.chatContainer as Chat | undefined)?.children?.length ?? 0;
		const result = original.apply(this, args);
		if (active) folds.message(this, args[0], before);
		return result;
	};
	prototype.addMessageToChat = wrapper;
	return () => {
		folds.detach();
		if (prototype.addMessageToChat === wrapper) {
			if (own) Object.defineProperty(prototype, "addMessageToChat", own);
			else delete prototype.addMessageToChat;
		}
		if ((globalThis as Record<symbol, unknown>)[ACTIVE] === folds) delete (globalThis as Record<symbol, unknown>)[ACTIVE];
	};
}
