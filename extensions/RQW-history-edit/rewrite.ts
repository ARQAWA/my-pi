import { readFileSync, renameSync, writeFileSync } from "node:fs";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

/** Keep the active path and preserve session-wide metadata and child records. */
export function rewriteSession(pi: ExtensionAPI, ctx: ExtensionContext, path: string): Buffer {
	const manager = ctx.sessionManager;
	const before = manager.getEntries();
	const branch = manager.getBranch();
	const kept = new Set(branch.map(entry => entry.id));
	const targets = new Set(branch.flatMap(entry => entry.type === "label" && kept.has(entry.targetId) ? [entry.targetId] : []));
	for (const entry of branch) if (manager.getLabel(entry.id)) targets.add(entry.id);
	const labels = [...targets].map(id => [id, manager.getLabel(id)] as const);
	const name = manager.getSessionName();
	const children = before.filter(entry => entry.type === "custom" && entry.customType === "rqw-agent-child");
	for (const [id, label] of labels) pi.setLabel(id, label);
	if (name || branch.some(entry => entry.type === "session_info")) pi.setSessionName(name ?? "");
	// Replay every child record in file order, including retained records, so newer state wins.
	for (const entry of children) if (entry.type === "custom") pi.appendEntry(entry.customType, entry.data);
	// Ensure a file reopened at a root cut has a leaf.
	pi.appendEntry("rqw-history-edit", { version: 1 });
	const header = manager.getHeader();
	if (!header) throw new Error("session header is missing");
	const output = [header, ...manager.getBranch()].map(entry => JSON.stringify(entry)).join("\n") + "\n";
	const original = readFileSync(path);
	replaceSessionFile(path, output);
	return original;
}

export function replaceSessionFile(path: string, content: string | Buffer): void {
	const temporary = `${path}.rqw-edit-${process.pid}.tmp`;
	writeFileSync(temporary, content);
	renameSync(temporary, path);
}
