import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { parseStreamingJson } from "@earendil-works/pi-ai";
import type { Item, State } from "./index.ts";

const ENTRY = "rqw-todo-mode";
const SKILL = resolve(dirname(fileURLToPath(import.meta.url)), "skills/todo/SKILL.md");
const SKILL_BLOCK = /^<skill name="([^"]+)" location="[^"]+">\n[\s\S]*?\n<\/skill>(?:\n\n|$)/;
const errorReason = (text: string) => text.split("\n\nReceived arguments:\n", 1)[0];

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
	const lines = ["Текущий список дел:"];
	for (const item of open) {
		lines.push(`- [${item.status}] ${item.id}: ${item.text}${item.note ? `: ${item.note}` : ""}`);
		for (const step of item.steps ?? []) lines.push(`  - [${step.status}] ${step.text}`);
	}
	const closed = items.filter(item => item.status === "done" || item.status === "dropped");
	if (closed.length) lines.push(`Завершено или отменено: ${closed.length}`);
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
		const results = event.messages.flatMap(message => message.role === "toolResult" && message.toolName === "todo"
			? [{ toolCallId: message.toolCallId, isError: message.isError }] : []);
		const completed = new Set(results.map(message => message.toolCallId));
		const lastBatch = event.messages.findLast(message => message.role === "assistant" && message.content.some(part =>
			part.type === "toolCall" && part.name === "todo" && completed.has(part.id)));
		const batchCalls = new Set(lastBatch?.role === "assistant" ? lastBatch.content.flatMap(part =>
			part.type === "toolCall" && part.name === "todo" ? [part.id] : []) : []);
		const currentErrors = new Set(results.filter(result => result.isError && batchCalls.has(result.toolCallId)).map(result => result.toolCallId));
		const lastSuccess = results.findLast(message => !message.isError)?.toolCallId;
		const items = getState().items;
		const closedIds = new Set(items.filter(item => item.status === "done" || item.status === "dropped").map(item => item.id));
		const newListIndex = event.messages.findLastIndex(message => message.role === "toolResult" && message.toolName === "todo"
			&& batchCalls.has(message.toolCallId) && !message.isError && (message.details as State | undefined)?.new);
		const closedHistory = event.messages.flatMap(message => message.role === "toolResult" && message.toolName === "todo"
			? ((message.details as State | undefined)?.items ?? []).filter(item => item.status === "done" || item.status === "dropped") : []);
		const retainRawErrors = closedIds.size === 0 && closedHistory.length === 0 && newListIndex < 0;
		const content = summary(items);
		const messages = event.messages.map(message => {
			if (message.role === "assistant") {
				return { ...message, content: message.content.map(part => {
					if (part.type !== "toolCall" || part.name !== "todo" || !completed.has(part.id)) return part;
					if (currentErrors.has(part.id)) {
						const raw = part.argumentsError?.split("\n\nReceived arguments:\n", 2)[1];
						const parsed = raw && !retainRawErrors ? parseStreamingJson<typeof part.arguments>(raw) : part.arguments;
						const recovered = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
						const patches = recovered.items;
						const errorIndex = event.messages.findIndex(result => result.role === "toolResult" && result.toolCallId === part.id);
						const oldList = newListIndex >= 0 && errorIndex < newListIndex;
						const argumentsError = part.argumentsError === undefined || retainRawErrors ? {} : { argumentsError: errorReason(part.argumentsError) };
						if (!Array.isArray(patches)) return { ...part, ...argumentsError, arguments: recovered };
						return { ...part, ...argumentsError, arguments: { ...recovered, items: patches.flatMap(patch => {
							if (oldList) return [];
							if (!patch || typeof patch !== "object" || Array.isArray(patch) || typeof patch.id !== "string") return [patch];
							if (recovered.new === true) return [patch];
							if (patch.status === "pending" || patch.status === "active" || patch.status === "blocked") return [patch];
							if (closedIds.has(patch.id)) return [];
							if (!items.some(item => item.id === patch.id) && closedHistory.some(item => item.id === patch.id)) return [];
							return [patch];
						}) } };
					}
					const { argumentsError: _error, ...call } = part;
					return { ...call, arguments: {} };
				}) };
			}
			if (message.role === "toolResult" && message.toolName === "todo") {
				if (currentErrors.has(message.toolCallId)) {
					if (retainRawErrors) return message;
					return { ...message, content: message.content.map(part =>
						part.type === "text" ? { ...part, text: errorReason(part.text) } : part) };
				}
				const { details: _details, ...result } = message;
				const text = !enabled && message.toolCallId === lastSuccess && content ? content : message.isError ? "Todo update failed." : "Todo updated.";
				return { ...result, content: [{ type: "text" as const, text }] };
			}
			return message;
		});
		if (enabled && content) messages.push({ role: "custom" as const, customType: "rqw-todo-context", content, display: false, timestamp: 0 });
		if (completed.size || (enabled && content)) return { messages };
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
