import { randomUUID } from "node:crypto";
import type { EntryRenderer, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const TYPE = "rqw-auto-wait-v1";
type Counts = { agents: number; backgroundProcesses?: number };
type Snapshot = { targets: string[]; titles: Record<string, string>; counts?: Counts };
type Entry = { version: 1; waitId: string; phase: "open" | "update" | "close"; targets?: string[]; titles?: Record<string, string>; counts?: Counts; reason?: string };

function status(reason: string) {
	switch (reason) {
		case "open": return { text: "waiting", color: "dim" as const, note: "Waiting for a result." };
		case "result": return { text: "completed", color: "success" as const, note: "Result received. The chat continues." };
		case "input": return { text: "interrupted by input", color: "warning" as const, note: "Agents continue working." };
		case "targets_changed": return { text: "wait changed", color: "dim" as const, note: "" };
		default: return { text: "wait interrupted", color: "dim" as const, note: "" };
	}
}

export function waitCard(pi: ExtensionAPI) {
	const phases = new Map<string, string>();
	const snapshots = new Map<string, Snapshot>();
	let current: (Snapshot & { waitId: string }) | undefined;
	let outputPad = 1;
	/** After /reload a card drawn before it still holds the old `pi`, which throws: the last known padding stays. */
	function padding() {
		try { outputPad = pi.getSettings().outputPad ?? 1; } catch { /* stale pi */ }
		return outputPad;
	}
	const render: EntryRenderer<Entry> = (entry, _options, theme) => {
		const data = entry.data;
		if (data?.version !== 1 || data.phase !== "open" || !Array.isArray(data.targets) || typeof data.waitId !== "string") return undefined;
		let key = "", rows: string[] = [];
		return { invalidate() { key = ""; }, render(width) {
			const phase = phases.get(data.waitId) ?? "interrupted";
			const snapshot = snapshots.get(data.waitId) ?? { targets: data.targets!, titles: data.titles ?? {}, counts: data.counts };
			const pad = padding();
			const next = JSON.stringify([width, phase, snapshot.targets, snapshot.titles, snapshot.counts, pad]);
			if (key === next) return rows;
			key = next;
			const outer = width > 2 * pad ? pad : 0;
			const boxWidth = Math.max(0, width - outer * 2);
			if (!boxWidth) return rows = [];
			const inner = Math.max(0, boxWidth - 2);
			const state = status(phase);
			const directAgents = snapshot.targets.filter(id => id.startsWith("agent#")).length;
			const agents = snapshot.counts?.agents ?? directAgents;
			const jobs = snapshot.counts?.backgroundProcesses ?? (snapshot.targets.length - directAgents);
			const label = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;
			const count = [agents && label(agents, "agent"), jobs && label(jobs, "job")].filter(Boolean).join(", ");
			const header = theme.fg("toolTitle", "wait") + (phase === "open" ? theme.fg("muted", ` ${count}`) + theme.fg("dim", " · ") : " ") + theme.fg(state.color, state.text);
			const targetLines: string[] = [];
			for (const id of snapshot.targets) {
				const raw = id.startsWith("agent#") ? snapshot.titles[id] : undefined;
				const title = typeof raw === "string" ? stripTerminalSequences(raw).replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim() : "";
				const target = title ? `${id} ${title}` : id;
				const previous = targetLines.at(-1);
				if (previous && visibleWidth(`${previous} ${target}`) <= inner) targetLines[targetLines.length - 1] = `${previous} ${target}`;
				else targetLines.push(target);
			}
			const note = phase === "input" && jobs ? "Work continues." : state.note;
			const lines = [header, ...targetLines.map(line => theme.fg("muted", line)), ...(note ? [theme.fg("dim", note)] : [])];
			const bg = phase === "result" ? "toolSuccessBg" : "toolPendingBg";
			const draw = (line: string) => {
				const clipped = truncateToWidth(line, inner, "…");
				const content = boxWidth >= 2 ? ` ${clipped}${" ".repeat(Math.max(0, inner - visibleWidth(clipped)))} ` : " ".repeat(boxWidth);
				return " ".repeat(outer) + theme.bg(bg, content);
			};
			rows = [draw(""), ...lines.map(draw), draw("")];
			return rows;
		} };
	};
	pi.registerEntryRenderer(TYPE, render);
	function close(reason: string) {
		if (!current) return;
		const { waitId } = current; current = undefined;
		phases.set(waitId, reason);
		pi.appendEntry(TYPE, { version: 1, waitId, phase: "close", reason });
	}
	return {
		restore(ctx: ExtensionContext) {
			current = undefined; phases.clear(); snapshots.clear();
			for (const entry of ctx.sessionManager.getBranch()) {
				if (entry.type !== "custom" || entry.customType !== TYPE) continue;
				const data = entry.data as Entry | undefined;
				if (data?.version !== 1 || typeof data.waitId !== "string") continue;
				if (data.phase === "open") phases.set(data.waitId, "interrupted");
				else if (data.phase === "close") phases.set(data.waitId, data.reason ?? "interrupted");
				if ((data.phase === "open" || data.phase === "update") && Array.isArray(data.targets))
					snapshots.set(data.waitId, { targets: data.targets, titles: data.titles ?? {}, counts: data.counts });
			}
		},
		close,
		show(targets: string[], titles: Record<string, string> = {}, counts?: Counts) {
			const ordered = [...new Set(targets)].sort();
			const selected = Object.fromEntries(ordered.filter(id => id.startsWith("agent#") && typeof titles[id] === "string").map(id => [id, titles[id]]));
			if (current && current.targets.join("\0") === ordered.join("\0") && JSON.stringify(current.titles) === JSON.stringify(selected) && JSON.stringify(current.counts) === JSON.stringify(counts)) return;
			if (!ordered.length) { close("targets_changed"); return; }
			const snapshot = { targets: ordered, titles: selected, counts };
			if (current) {
				Object.assign(current, snapshot);
				snapshots.set(current.waitId, snapshot);
				pi.appendEntry(TYPE, { version: 1, waitId: current.waitId, phase: "update", ...snapshot });
				return;
			}
			const waitId = randomUUID();
			current = { waitId, ...snapshot }; phases.set(waitId, "open");
			snapshots.set(waitId, snapshot);
			pi.appendEntry(TYPE, { version: 1, waitId, phase: "open", ...snapshot });
		},
	};
}
