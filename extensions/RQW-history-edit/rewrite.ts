import { closeSync, openSync, renameSync, rmSync, writeFileSync } from "node:fs";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

/** Keep the active path and preserve session-wide metadata and child records. */
export function rewriteSession(pi: ExtensionAPI, ctx: ExtensionContext, path: string): void {
	const manager = ctx.sessionManager;
	const before = manager.getEntries();
	const branch = manager.getBranch();
	const kept = new Set(branch.map(entry => entry.id));
	const targets = new Set(branch.flatMap(entry => entry.type === "label" && kept.has(entry.targetId) ? [entry.targetId] : []));
	for (const entry of branch) if (manager.getLabel(entry.id)) targets.add(entry.id);
	const labels = [...targets].map(id => [id, manager.getLabel(id)] as const);
	const name = manager.getSessionName();
	// A base already on the kept path stays there; any other is carried once, before its children in file order.
	const baseRef = (entry: (typeof before)[number]) => entry.type === "custom" && entry.customType === "rqw-agent-base" ? (entry.data as { ref?: unknown } | undefined)?.ref : undefined;
	const bases = new Set<unknown>(branch.map(baseRef).filter(ref => ref !== undefined));
	const children = before.filter(entry => entry.type === "custom" && (entry.customType === "rqw-agent-child"
		|| (entry.customType === "rqw-agent-base" && !bases.has(baseRef(entry)) && !!bases.add(baseRef(entry)))));
	for (const [id, label] of labels) pi.setLabel(id, label);
	if (name || branch.some(entry => entry.type === "session_info")) pi.setSessionName(name ?? "");
	// Replay every child record in file order, including retained records, so newer state wins.
	for (const entry of children) if (entry.type === "custom") pi.appendEntry(entry.customType, entry.data);
	// Ensure a file reopened at a root cut has a leaf.
	pi.appendEntry("rqw-history-edit", { version: 1 });
	const header = manager.getHeader();
	if (!header) throw new Error("session header is missing");
	function* lines() {
		yield `${JSON.stringify(header)}\n`;
		for (const entry of manager.getBranch()) yield `${JSON.stringify(entry)}\n`;
	}
	replaceSessionFile(path, lines());
}

export function replaceSessionFile(path: string, content: string | Buffer | Iterable<string>): void {
	const temporary = `${path}.rqw-edit-${process.pid}.tmp`;
	try {
		const fd = openSync(temporary, "w");
		try {
			if (typeof content === "string" || Buffer.isBuffer(content)) writeFileSync(fd, content);
			else for (const line of content) writeFileSync(fd, line);
		} finally {
			closeSync(fd);
		}
		renameSync(temporary, path);
	} catch (error) {
		rmSync(temporary, { force: true });
		throw error;
	}
}
