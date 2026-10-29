import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

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
		const index = event.messages.findLastIndex(message => message.role === "user");
		const position = index < 0 ? event.messages.length : index + 1;
		return { messages: [
			...event.messages.slice(0, position),
			{ role: "user", content: `<process-reminder>\n${reminder}\n</process-reminder>`, timestamp: 0 },
			...event.messages.slice(position),
		] };
	});
}
