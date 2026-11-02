import { keyHint, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, Text } from "@earendil-works/pi-tui";
import { FOLLOW_UP } from "./prompt.ts";

/** Pi's ordinary result view, hiding only completion reminders in delivered wait results. */
export const renderAgentResult: NonNullable<ToolDefinition["renderResult"]> = (result, options, theme, context) => {
	const content = result.content.filter((block) => block.type === "text").map((block) => {
		let text = block.text;
		if ((context.args as { action?: unknown })?.action === "wait") {
			try {
				const value = JSON.parse(text);
				if (value && Array.isArray(value.results)) {
					for (const item of value.results) {
						if (item && typeof item.text === "string" && item.text.endsWith(`\n\n${FOLLOW_UP}`))
							item.text = item.text.slice(0, -FOLLOW_UP.length - 2);
					}
					text = JSON.stringify(value);
				}
			} catch { /* Not a delivered result. */ }
		}
		return stripTerminalSequences(text || "").replace(/\r/g, "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
	}).join("\n");
	const lines = content ? content.split("\n") : [];
	const shown = options.expanded ? lines : lines.slice(0, 10);
	const remaining = lines.length - shown.length;
	let text = shown.map((line) => theme.fg("toolOutput", line)).join("\n");
	if (remaining > 0) text += `${theme.fg("muted", `\n... (${remaining} more lines,`)} ${keyHint("app.tools.expand", "to expand")}${theme.fg("muted", ")")}`;
	return new Text(text, 0, 0);
};
