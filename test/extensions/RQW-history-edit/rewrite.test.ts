import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { rewriteSession } from "../../../extensions/RQW-history-edit/rewrite.ts";

it("rewrites the path while retaining labels, name, and children", () => {
	const dir = mkdtempSync(join(tmpdir(), "history-edit-"));
	try {
		const path = join(dir, "session.jsonl");
		writeFileSync(path, "old history\n");
		const first = { type: "message", id: "a", parentId: null };
		const old = { type: "custom", id: "b", parentId: "a", customType: "rqw-agent-child", data: { id: 1, state: "old" } };
		const latest = { type: "custom", id: "c", parentId: "a", customType: "rqw-agent-child", data: { id: 1, state: "latest" } };
		const outside = { type: "custom", id: "outside", parentId: "b", customType: "rqw-agent-child", data: { id: 2, state: "completed" } };
		const branch: any[] = [first, latest];
		const all = [first, old, latest, outside];
		const append = (entry: any) => branch.push({ ...entry, id: String(branch.length), parentId: branch.at(-1)?.id ?? null });
		const pi = { setLabel: (id: string, label: string) => append({ type: "label", targetId: id, label }),
			setSessionName: (name: string) => append({ type: "session_info", name }),
			appendEntry: (customType: string, data: unknown) => append({ type: "custom", customType, data }) } as unknown as ExtensionAPI;
		const ctx = { sessionManager: { getEntries: () => all, getBranch: () => branch.slice(), getLabel: () => "mark",
			getSessionName: () => "name", getHeader: () => ({ type: "session", id: "session" }) } } as unknown as ExtensionContext;
		rewriteSession(pi, ctx, path);
		const lines = readFileSync(path, "utf8").trim().split("\n").map(line => JSON.parse(line));
		assert.equal(lines[1].id, "a");
		assert.ok(!lines.some(entry => entry.id === "b"));
		assert.ok(lines.some(entry => entry.type === "label" && entry.label === "mark"));
		assert.ok(lines.some(entry => entry.type === "session_info" && entry.name === "name"));
		assert.equal(lines.filter(entry => entry.customType === "rqw-agent-child" && entry.data.id === 1).at(-1).data.state, "latest");
		assert.ok(lines.some(entry => entry.customType === "rqw-agent-child" && entry.data.id === 2 && entry.data.state === "completed"));
	} finally { rmSync(dir, { recursive: true, force: true }); }
});

it("preserves cleared labels and a cleared session name", () => {
	const dir = mkdtempSync(join(tmpdir(), "history-clear-"));
	try {
		const path = join(dir, "session.jsonl");
		writeFileSync(path, "old\n");
		const branch: any[] = [{ type: "message", id: "a", parentId: null }, { type: "label", id: "b", targetId: "a", label: "old" }, { type: "session_info", id: "c", name: "old" }];
		const append = (entry: any) => branch.push({ ...entry, id: String(branch.length), parentId: branch.at(-1)?.id });
		const pi = { setLabel: (id: string, label: string | undefined) => append({ type: "label", targetId: id, label }),
			setSessionName: (name: string) => append({ type: "session_info", name }),
			appendEntry: (customType: string, data: unknown) => append({ type: "custom", customType, data }) } as unknown as ExtensionAPI;
		const ctx = { sessionManager: { getEntries: () => branch.slice(), getBranch: () => branch.slice(), getLabel: () => undefined,
			getSessionName: () => undefined, getHeader: () => ({ type: "session", id: "s" }) } } as unknown as ExtensionContext;
		rewriteSession(pi, ctx, path);
		const entries = readFileSync(path, "utf8").trim().split("\n").map(line => JSON.parse(line));
		assert.equal(entries.filter(entry => entry.type === "label").at(-1).label, undefined);
		assert.equal(entries.filter(entry => entry.type === "session_info").at(-1).name, "");
	} finally { rmSync(dir, { recursive: true, force: true }); }
});
