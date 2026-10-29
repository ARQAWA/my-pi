import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ContextEvent, ExtensionAPI } from "@earendil-works/pi-coding-agent";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

async function readOptional(path: string): Promise<string> {
	try { return await readFile(path, "utf8"); } catch { return ""; }
}

export default function processReminder(pi: ExtensionAPI, root = ROOT): void {
	pi.on("context", async event => {
		const process = await readOptional(resolve(root, "PROCESS.md"));
		const lines = process.split(/\r?\n/);
		const rules = [1, 2, 3, 4, 5].flatMap(number => {
			const line = lines.find(item => item.startsWith(`${number}. `));
			return line ? [line] : [];
		});
		const reminder = rules.join("\n");
		if (!reminder) return;
		return { messages: event.messages.flatMap<ContextEvent["messages"][number]>(message => message.role === "user"
			? [message, { role: "custom" as const, customType: "process-reminder", content: `<process-reminder>\n${reminder}\n</process-reminder>`, display: false, timestamp: 0 }]
			: [message]) };
	});
}
