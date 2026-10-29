import { UserMessageSelectorComponent, type ExtensionAPI, type ExtensionCommandContext, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ImageContent } from "@earendil-works/pi-ai";
import { isKeyRelease, matchesKey, type TUI } from "@earendil-works/pi-tui";
import { commitEdit } from "./commit.ts";

type CountsSource = { version: number; snapshot(): { agents: number; reviews: number } };
type Focused = { actionHandlers?: unknown; isShowingAutocomplete?(): boolean };
type Renderer = TUI & { getFocusedComponent(): unknown };
type Editing = { id: string; draft: string; images: ImageContent[] };
type Pending = { id: string; text: string; images?: ImageContent[] };

function isCountsOffer(data: unknown): data is { version: number; source: CountsSource } {
	if (typeof data !== "object" || data === null || !("version" in data) || !("source" in data)) return false;
	const source = data.source;
	return typeof data.version === "number" && typeof source === "object" && source !== null &&
		"version" in source && typeof source.version === "number" &&
		"snapshot" in source && typeof source.snapshot === "function";
}

export default function historyEdit(pi: ExtensionAPI): void {
	let counts: CountsSource | undefined;
	let dispose: (() => void) | undefined;
	let editing: Editing | undefined;
	let pending: Pending | undefined;
	let lastEscape = 0;
	let suppressedUntil = 0;
	const accept = (source: CountsSource) => {
		if (source.version === 1 && typeof source.snapshot().reviews === "number") counts = source;
	};
	const select = async (ctx: ExtensionContext, initial?: string) => {
		const draft = ctx.ui.getEditorText();
		const selected = await selectMessage(ctx, initial);
		if (!selected) return;
		editing = { id: selected.id, draft, images: selected.images };
		ctx.ui.setEditorText(selected.text);
		ctx.ui.notify("enter обрежет историю. esc отменит правку", "info");
	};
	const submit = (value: Pending) => {
		pending = value;
		queueMicrotask(() => pi.sendUserMessage("/edit-history", { expandPromptTemplates: true }));
	};
	pi.events.on("rqw:running-counts:offer", data => {
		if (isCountsOffer(data) && data.version === 1) accept(data.source);
	});
	pi.on("session_start", (_event, ctx) => {
		dispose?.();
		editing = undefined;
		counts = undefined;
		lastEscape = 0;
		suppressedUntil = 0;
		pi.events.emit("rqw:running-counts:request", { version: 1, reply: accept });
		if (ctx.mode !== "tui") return;
		let tui: Renderer | undefined;
		ctx.ui.setWidget("rqw-history-edit-access", current => {
			tui = current as Renderer;
			return { render: () => [], invalidate() {} };
		});
		ctx.ui.setWidget("rqw-history-edit-access", undefined);
		dispose = ctx.ui.onTerminalInput(data => {
			if (isKeyRelease(data)) return;
			const focused = tui?.getFocusedComponent() as Focused | undefined;
			if (!(focused?.actionHandlers instanceof Map) || focused.isShowingAutocomplete?.()) return;
			if (editing && matchesKey(data, "enter")) {
				const text = ctx.ui.getEditorText();
				if (text.startsWith("/") || text.startsWith("!")) {
					submit({ id: editing.id, text, images: editing.images });
					return { consume: true };
				}
				return;
			}
			if (!matchesKey(data, "escape")) return;
			if (editing) {
				const old = editing;
				editing = undefined;
				ctx.ui.setEditorText(old.draft);
				void select(ctx, old.id);
				return { consume: true };
			}
			const now = Date.now();
			if (now < suppressedUntil) return { consume: true };
			if (!ctx.isIdle() || ctx.ui.getEditorText().trim()) { lastEscape = 0; return; }
			if (lastEscape && now - lastEscape < 500) {
				lastEscape = 0;
				suppressedUntil = now + 500;
				pi.sendUserMessage("/edit-history", { expandPromptTemplates: true });
				return { consume: true };
			}
			lastEscape = now;
		});
	});
	pi.on("session_tree", () => { editing = undefined; });
	pi.on("session_shutdown", () => { dispose?.(); dispose = undefined; editing = undefined; });
	pi.on("input", event => {
		if (!editing || event.source !== "interactive") return;
		submit({ id: editing.id, text: event.text, images: [...editing.images, ...(event.images ?? [])] });
		return { action: "handled" };
	});
	pi.registerCommand("edit-history", {
		description: "Edit a previous message",
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
			const current = pending;
			pending = undefined;
			const running = counts?.snapshot();
			if (running && (running.agents > 0 || running.reviews > 0)) {
				if (current) ctx.ui.setEditorText(current.text);
				ctx.ui.notify("дождись сабагентов", "warning");
				return;
			}
			if (current) {
				const previous = editing;
				if (!await commitEdit(pi, ctx, current.id, current.text, current.images)) {
					editing = previous;
					ctx.ui.setEditorText(current.text);
				}
			} else if (ctx.mode === "tui") {
				await select(ctx);
			}
		},
	});
}

async function selectMessage(ctx: ExtensionContext, initial?: string): Promise<{ id: string; text: string; images: ImageContent[] } | undefined> {
	const messages = ctx.sessionManager.getBranch().flatMap(entry => {
		if (entry.type !== "message" || entry.message.role !== "user") return [];
		const content = entry.message.content;
		const text = typeof content === "string" ? content : content.filter(part => part.type === "text").map(part => part.text).join("\n");
		const images = typeof content === "string" ? [] : content.filter((part): part is ImageContent => part.type === "image");
		return [{ id: entry.id, text, images, timestamp: entry.timestamp }];
	});
	if (!messages.length) return;
	const id = await ctx.ui.custom<string | undefined>((_tui, _theme, keys, done) => {
		const list = new UserMessageSelectorComponent(messages, done, () => done(undefined), initial).getMessageList();
		let index = messages.findIndex(message => message.id === initial);
		if (index < 0) index = messages.length - 1;
		const handleInput = list.handleInput.bind(list);
		list.handleInput = data => {
			if (keys.matches(data, "tui.select.up")) {
				if (index === 0) return;
				index--;
			} else if (keys.matches(data, "tui.select.down")) {
				if (index === messages.length - 1) return;
				index++;
			}
			handleInput(data);
		};
		return list;
	});
	return messages.find(message => message.id === id);
}
