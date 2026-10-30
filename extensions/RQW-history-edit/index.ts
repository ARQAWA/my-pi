import { UserMessageSelectorComponent, type ExtensionAPI, type ExtensionCommandContext, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ImageContent } from "@earendil-works/pi-ai";
import { isKeyRelease, matchesKey, type TUI } from "@earendil-works/pi-tui";
import { commitEdit, type CommitResult } from "./commit.ts";

type CountsSource = { version: number; snapshot(): { agents: number; reviews: number } };
type Focused = { actionHandlers?: unknown; isShowingAutocomplete?(): boolean };
type Renderer = TUI & { getFocusedComponent(): unknown };
type Editing = { id: string; draft: string; images: ImageContent[] };
type Pending = { id?: string; text: string; images?: ImageContent[] };
type EditState = {
 editing?: Editing;
 pending?: Pending;
 retryRestore?: CommitResult["retryRestore"];
 draft?: string;
 inFlight?: boolean;
 owner?: object;
 ui?: ExtensionContext["ui"];
 schedule?: () => void;
};
// Session replacement constructs a new extension instance. Only an active edit is handed over.
const activeEdits = new Map<string, EditState>();

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
	let state: EditState = {};
	let sessionPath: string | undefined;
	const owner = {};
	let lastEscape = 0;
	let suppressedUntil = 0;
	const accept = (source: CountsSource) => {
		if (source.version === 1 && typeof source.snapshot().reviews === "number") counts = source;
	};
	const select = async (ctx: ExtensionContext, initial?: string) => {
		const draft = ctx.ui.getEditorText();
		const selected = await selectMessage(ctx, initial);
		if (!selected) return;
		state.editing = { id: selected.id, draft, images: selected.images };
		ctx.ui.setEditorText(selected.text);
		ctx.ui.notify("Enter truncates history. Esc cancels the edit.", "info");
	};
	const submit = (value: Pending) => {
		state.pending = value;
		queueMicrotask(() => pi.sendUserMessage("/edit-history", { expandPromptTemplates: true }));
	};
	pi.events.on("rqw:running-counts:offer", data => {
		if (isCountsOffer(data) && data.version === 1) accept(data.source);
	});
	pi.on("session_start", (_event, ctx) => {
		dispose?.();
		sessionPath = ctx.sessionManager?.getSessionFile?.();
		state = sessionPath ? activeEdits.get(sessionPath) ?? {} : {};
		state.owner = owner;
		state.ui = ctx.ui;
		state.schedule = () => pi.sendUserMessage("/edit-history", { expandPromptTemplates: true });
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
			if ((state.editing || state.retryRestore) && matchesKey(data, "enter")) {
				const text = ctx.ui.getEditorText();
				if (text.startsWith("/") || text.startsWith("!")) {
					submit({ id: state.editing?.id, text, images: state.editing?.images });
					return { consume: true };
				}
				return;
			}
			if (!matchesKey(data, "escape")) return;
			if (state.editing) {
				const old = state.editing;
				state.editing = undefined;
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
	pi.on("session_tree", () => { state.editing = undefined; state.retryRestore = undefined; });
	pi.on("session_shutdown", () => {
		dispose?.();
		dispose = undefined;
		if (!state.inFlight) {
			if (sessionPath) activeEdits.delete(sessionPath);
			state = {};
		}
	});
	pi.on("input", event => {
		if (event.source !== "interactive" || (!state.editing && !state.retryRestore)) return;
		submit({ id: state.editing?.id, text: event.text, images: [...(state.editing?.images ?? []), ...(event.images ?? [])] });
		return { action: "handled" };
	});
	pi.registerCommand("edit-history", {
		description: "Edit a previous message",
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
			const edit = state;
			const current = edit.pending;
			edit.pending = undefined;
			const previous = edit.editing;
			const retry = edit.retryRestore;
			edit.inFlight = true;
			const path = sessionPath;
			if (path) activeEdits.set(path, edit);
			try {
				if (retry) {
					if (!await retry(ctx)) {
						edit.retryRestore = retry;
						edit.editing = previous;
						if (current) edit.draft = current.text;
						edit.ui?.setEditorText(edit.draft ?? "");
						if (edit.owner !== owner) queueMicrotask(() => edit.schedule?.());
						return;
					}
					edit.retryRestore = undefined;
					edit.editing = undefined;
					edit.ui?.setEditorText(current?.text ?? edit.draft ?? "");
					edit.ui?.notify("Previous branch restored.", "info");
					return;
				}
				const running = counts?.snapshot();
				if (running && (running.agents > 0 || running.reviews > 0)) {
					if (current) ctx.ui.setEditorText(current.text);
					ctx.ui.notify("Wait for subagents to finish.", "warning");
					return;
				}
				if (current?.id !== undefined) {
					edit.draft = current.text;
					const result = await commitEdit(pi, ctx, current.id, current.text, current.images);
					if (!result.committed) {
						edit.retryRestore = result.retryRestore;
						edit.editing = previous;
						edit.ui?.setEditorText(current.text);
						if (result.retryRestore && edit.owner !== owner) queueMicrotask(() => edit.schedule?.());
					} else edit.editing = undefined;
				} else if (ctx.mode === "tui") await select(ctx);
			} finally {
				edit.inFlight = false;
				if (path && !edit.retryRestore && !edit.pending) activeEdits.delete(path);
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
