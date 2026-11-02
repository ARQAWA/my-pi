import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { Item, State } from "./index.ts";

const KEY = "rqw-todo-panel";
const open = (item: Item) => item.status !== "done" && item.status !== "dropped";
const safe = (text: string) => text.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/gu, " ");

/** Pass a new State on each list change. Call on session_start, agent_start and list changes. */
export function createTodoPanel() {
	let state: State = { items: [] };
	let cache: { width: number; rows: string[] } | undefined;

	return {
		update(ctx: ExtensionContext, next: State) {
			if (state !== next) {
				state = next;
				cache = undefined;
			}
			const items = state.items;
			const focus = items.find(item => item.status === "active")
				?? items.find(item => item.status === "blocked")
				?? items.find(item => item.status === "pending");
			if (!focus) {
				ctx.ui.setWidget(KEY, undefined);
				return;
			}
			ctx.ui.setWidget(KEY, (_tui, theme) => ({
				render(width) {
					if (cache?.width === width) return cache.rows;
					const itemIndex = items.indexOf(focus);
					const steps = focus.steps ?? [];
					const step = steps.find(value => value.status === "active") ?? steps.find(value => value.status === "pending");
					const progress = `${step ? `step ${steps.indexOf(step) + 1} of ${steps.length} · ` : ""}item ${itemIndex + 1} of ${items.length}`;
					const label = focus.status === "blocked" ? `! ${safe(focus.text)} · ${safe(focus.note ?? "")}` : `▸ ${safe(focus.text)}`;
					const rightWidth = visibleWidth(progress);
					const room = Math.max(0, width - rightWidth - 1);
					const left = rightWidth < width ? truncateToWidth(label, room, "…") : truncateToWidth(label, Math.max(0, width), "…");
					const color = focus.status === "blocked" ? "warning" : "text";
					let first = focus.status === "blocked" ? theme.fg(color, left)
						: theme.fg("accent", left.slice(0, 1)) + theme.fg(color, left.slice(1));
					if (rightWidth < width) first += " ".repeat(Math.max(1, width - visibleWidth(left) - rightWidth)) + theme.fg("muted", progress);
					const rows = [first];
					if (step) {
						const line = truncateToWidth(`    ▸ ${safe(step.text)}`, Math.max(0, width), "…");
						rows.push(theme.fg("text", line.slice(0, 4)) + theme.fg("accent", line.slice(4, 5)) + theme.fg("text", line.slice(5)));
					}
					const nextItems = items.slice(itemIndex + 1).filter(open);
					for (const item of nextItems.slice(0, 3 - rows.length)) {
						const text = item.status === "blocked" ? `! ${safe(item.text)} · ${safe(item.note ?? "")}` : `○ ${safe(item.text)}`;
						rows.push(theme.fg(item.status === "blocked" ? "warning" : "muted", truncateToWidth(text, Math.max(0, width), "…")));
					}
					while (rows.length < 3) rows.push("");
					cache = { width, rows };
					return rows;
				},
				invalidate() { cache = undefined; },
			}), { placement: "aboveEditor" });
		},
	};
}
