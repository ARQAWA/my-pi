import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { installTodoMode } from "./mode.ts";
import { createTodoPanel } from "./panel.ts";
import { registerTodoView } from "./view.ts";

function StringEnum<const T extends readonly string[]>(values: T) {
	return Type.Unsafe<T[number]>({ type: "string", enum: [...values] });
}

const status = StringEnum(["pending", "active", "done", "dropped", "blocked"] as const);
const stepStatus = StringEnum(["pending", "active", "done"] as const);
const params = Type.Object({
	items: Type.Optional(Type.Array(Type.Object({
		id: Type.String(), text: Type.Optional(Type.String()), status: Type.Optional(status),
		note: Type.Optional(Type.String()),
		steps: Type.Optional(Type.Array(Type.Object({ text: Type.String(), status: stepStatus }))),
	}))),
	new: Type.Optional(Type.Boolean()),
	off: Type.Optional(Type.Boolean()),
});

export type Step = { text: string; status: "pending" | "active" | "done" };
export type Item = { id: string; text: string; status: "pending" | "active" | "done" | "dropped" | "blocked"; note?: string; steps?: Step[] };
export type State = { items: Item[]; new?: boolean; off?: boolean };
export const isClosed = (items: Item[]) => items.every(item => item.status === "done" || item.status === "dropped");

export function restore(ctx: ExtensionContext): State {
	const branch = ctx.sessionManager.getBranch();
	for (let i = branch.length - 1; i >= 0; i--) {
		const entry = branch[i];
		if (entry.type !== "message" || entry.message.role !== "toolResult" || entry.message.toolName !== "todo") continue;
		const details = entry.message.details as State | undefined;
		if (details && Array.isArray(details.items)) return details;
	}
	return { items: [] };
}

export default function (pi: ExtensionAPI) {
	pi.events.on("rqw-agent:subagent-extension-factories", data => {
		const request = data as { offer(factory: (child: ExtensionAPI) => void, tools: string[]): void };
		request.offer(childTodo, ["todo"]);
	});
	installTodo(pi, false);
}

function childTodo(pi: ExtensionAPI) {
	installTodo(pi, true);
}

function installTodo(pi: ExtensionAPI, child: boolean) {
	let state: State = { items: [] };
	const panel = child ? undefined : createTodoPanel();
	const reload = (_event: unknown, ctx: ExtensionContext) => {
		state = restore(ctx);
		if (ctx.hasUI) panel?.update(ctx, mode.isEnabled() ? state : { items: [] });
	};
	pi.on("session_start", reload);
	pi.on("session_tree", reload);
	if (!child) pi.on("agent_start", (_event, ctx) => { if (ctx.hasUI) panel?.update(ctx, mode.isEnabled() ? state : { items: [] }); });
	const mode = installTodoMode(pi, () => state, (enabled, ctx) => {
		if (ctx.hasUI) panel?.update(ctx, enabled ? state : { items: [] });
	}, child);
	if (!child) {
		pi.events.on("rqw-todo:disable:v1", data => mode.disable((data as { ctx: ExtensionContext }).ctx));
		registerTodoView(pi, () => state);
	}
	pi.registerTool({
		name: "todo", label: "Todo", description: "Update multiple todo items by id. Use a reason in note for blocked or dropped items.", parameters: params,
		async execute(_id, update, _signal, _onUpdate, ctx) {
			if (update.new && !isClosed(state.items)) throw new Error("Cannot start a new list while the previous list is open.");
			const items: Item[] = update.new ? [] : structuredClone(state.items);
			for (const patch of update.items ?? []) {
				let item = items.find(value => value.id === patch.id);
				if (!item) {
					if (!patch.id.trim() || !patch.text?.trim()) throw new Error("New items require an id and text.");
					item = { id: patch.id, text: patch.text, status: "pending" };
					items.push(item);
				}
				if (patch.text !== undefined) {
					if (!patch.text.trim()) throw new Error("Item text cannot be empty.");
					item.text = patch.text;
				}
				if (patch.status !== undefined) item.status = patch.status;
				if (patch.note !== undefined) item.note = patch.note;
				else if (patch.status !== undefined && patch.status !== "blocked" && patch.status !== "dropped") delete item.note;
				if (patch.steps !== undefined) item.steps = patch.steps;
				if ((item.status === "blocked" || item.status === "dropped") && !item.note?.trim()) throw new Error("A note with a reason is required for blocked or dropped items.");
			}
			state = { items, ...(update.new ? { new: true } : {}), ...(update.off ? { off: true } : {}) };
			if (update.off) mode.off(ctx);
			if (ctx.hasUI && mode.isEnabled()) panel?.update(ctx, state);
			const focus = items.find(item => item.status === "active") ?? items.find(item => item.status === "blocked") ?? items.find(item => item.status === "pending");
			return { content: [{ type: "text", text: focus ? `ok · ${focus.text}` : "ok" }], details: state };
		},
	});
}
