import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Item, State } from "./index.ts";

const ENTRY = "rqw-todo-mode";
const SKILL = resolve(dirname(fileURLToPath(import.meta.url)), "skills/todo/SKILL.md");
const SKILL_BLOCK = /^<skill name="([^"]+)" location="[^"]+">\n[\s\S]*?\n<\/skill>(?:\n\n|$)/;

function hasTodoSkill(prompt: string): boolean {
	let remaining = prompt;
	for (;;) {
		const match = SKILL_BLOCK.exec(remaining);
		if (!match) return false;
		if (match[1] === "todo") return true;
		remaining = remaining.slice(match[0].length);
	}
}

function summary(items: Item[]): string | undefined {
	const open = items.filter(item => item.status !== "done" && item.status !== "dropped");
	if (!open.length) return undefined;
	const focus = open.find(item => item.status === "active") ?? open.find(item => item.status === "blocked") ?? open[0];
	const lines = ["Текущий список дел:"];
	for (const item of open) {
		lines.push(`- [${item.status}] ${item.text}${item.note ? `: ${item.note}` : ""}`);
		if (item === focus) for (const step of item.steps ?? []) lines.push(`  - [${step.status}] ${step.text}`);
	}
	const closed = items.filter(item => item.status === "done" || item.status === "dropped");
	if (closed.length) lines.push(`Завершено или отменено: ${closed.map(item => item.text).join(", ")}`);
	return lines.join("\n");
}

export function installTodoMode(pi: ExtensionAPI, getState: () => State, onChange: (enabled: boolean, ctx: ExtensionContext) => void = () => {}): { off(ctx?: ExtensionContext): void; isEnabled(): boolean } {
	let enabled = false;
	let reminded = false;

	function selectTool() {
		const active = pi.getActiveTools();
		if (active.includes("todo") === enabled) return;
		pi.setActiveTools(enabled ? [...active, "todo"] : active.filter(name => name !== "todo"));
	}
	function restore(_event: unknown, ctx: ExtensionContext) {
		enabled = false;
		reminded = false;
		const branch = ctx.sessionManager.getBranch();
		for (let i = branch.length - 1; i >= 0; i--) {
			const entry = branch[i];
			if (entry.type !== "custom" || entry.customType !== ENTRY) continue;
			const data = entry.data as { enabled?: unknown } | undefined;
			if (typeof data?.enabled === "boolean") {
				enabled = data.enabled;
				break;
			}
		}
		selectTool();
		onChange(enabled, ctx);
	}
	function setEnabled(value: boolean, ctx?: ExtensionContext) {
		if (enabled !== value) {
			enabled = value;
			pi.appendEntry(ENTRY, { enabled });
			if (ctx) onChange(enabled, ctx);
		}
		selectTool();
	}

	pi.on("resources_discover", () => ({ skillPaths: [SKILL] }));
	pi.on("input", (event, ctx) => {
		if (event.source !== "interactive") return;
		const text = event.text.replace(/^\/skill:[^\s]+\s+/, "");
		if (hasTodoSkill(text) || /^\/skill:todo(?:\s|$)/.test(event.text)) setEnabled(true, ctx);
	});
	pi.on("session_start", restore);
	pi.on("session_tree", restore);
	pi.on("before_agent_start", (event, ctx) => {
		if (event.messageType !== "user") return;
		reminded = false;
		if (hasTodoSkill(event.prompt)) setEnabled(true, ctx);
	});
	pi.on("message_start", (event, ctx) => {
		if (event.message.role !== "user") return;
		reminded = false;
		const content = event.message.content;
		const text = typeof content === "string" ? content : content.filter(part => part.type === "text").map(part => part.text).join("\n");
		if (hasTodoSkill(text)) setEnabled(true, ctx);
	});
	pi.on("context", event => {
		if (!enabled) return;
		const content = summary(getState().items);
		if (!content) return;
		return { messages: [...event.messages, { role: "custom" as const, customType: "rqw-todo-context", content, display: false, timestamp: 0 }] };
	});
	pi.on("agent_before_settle", event => {
		if (!enabled || reminded || event.outcome !== "completed") return;
		const open = getState().items.filter(item => item.status === "pending" || item.status === "active");
		if (!open.length) return;
		reminded = true;
		const content = `Остались открытые пункты: ${open.map(item => item.text).join(", ")}. Продолжи работу или отметь препятствие с причиной.`;
		return { entries: [...event.entries, { type: "custom_message" as const, customType: "rqw-todo-reminder", content, display: false }], continue: true };
	});
	return { off: ctx => setEnabled(false, ctx), isEnabled: () => enabled };
}
