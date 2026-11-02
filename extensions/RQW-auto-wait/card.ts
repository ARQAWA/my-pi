import { randomUUID } from "node:crypto";
import type { EntryRenderer, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";

const TYPE = "rqw-auto-wait-v1";
type Entry = { version: 1; waitId: string; phase: "open" | "close"; targets?: string[]; reason?: string };

export function waitCard(pi: ExtensionAPI) {
	const phases = new Map<string, string>();
	let current: { waitId: string; targets: string[] } | undefined;
	const render: EntryRenderer<Entry> = (entry, _options, theme) => {
		const data = entry.data;
		if (data?.version !== 1 || data.phase !== "open" || !Array.isArray(data.targets) || typeof data.waitId !== "string") return undefined;
		return { invalidate() {}, render(width) {
			const phase = phases.get(data.waitId) ?? "не активно";
			return [truncateToWidth(theme.fg("toolTitle", `  wait ${data.targets!.join(" ")}`), width),
				truncateToWidth(theme.fg("dim", `  ожидание${phase === "open" ? "" : ` ${phase}`}`), width)];
		} };
	};
	pi.registerEntryRenderer(TYPE, render);
	function close(reason: string) {
		if (!current) return;
		const { waitId } = current; current = undefined;
		phases.set(waitId, reason === "input" ? "прервано вводом" : reason === "result" ? "завершено" : "изменено");
		pi.appendEntry(TYPE, { version: 1, waitId, phase: "close", reason });
	}
	return {
		restore(ctx: ExtensionContext) {
			current = undefined; phases.clear();
			for (const entry of ctx.sessionManager.getBranch()) {
				if (entry.type !== "custom" || entry.customType !== TYPE) continue;
				const data = entry.data as Entry | undefined;
				if (data?.version !== 1 || typeof data.waitId !== "string") continue;
				if (data.phase === "open") phases.set(data.waitId, "прервано");
				else if (data.phase === "close") phases.set(data.waitId, data.reason === "input" ? "прервано вводом" : data.reason === "result" ? "завершено" : "изменено");
			}
		},
		close,
		show(targets: string[]) {
			const ordered = [...new Set(targets)].sort();
			if (current && current.targets.join("\0") === ordered.join("\0")) return;
			close("targets_changed");
			if (!ordered.length) return;
			const waitId = randomUUID();
			current = { waitId, targets: ordered }; phases.set(waitId, "open");
			pi.appendEntry(TYPE, { version: 1, waitId, phase: "open", targets: ordered });
		},
	};
}
