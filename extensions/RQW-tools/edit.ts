import { resolve } from "node:path";
import { Type } from "typebox";
import { nearestMatchHint } from "./hint.ts";
import { editPathKey, resolvePath } from "./keys.ts";
import { withRetry } from "./retry.ts";

// Multi-file edit over the stock edit definition (design decision 4).
// Schema = stock schema + optional top-level path + optional path on each edits[] entry (strict-mode safe).

export function createEditSchema(stockParameters: any) {
	const stockEdits = stockParameters.properties.edits;
	const stockItem = stockEdits.items.properties;
	return Type.Object({
		path: Type.Optional(Type.String({ description: "File for edits without their own path (relative or absolute)." })),
		edits: Type.Array(
			Type.Object({
				path: Type.Optional(Type.String({ description: "File for this edit; defaults to the top-level path." })),
				oldText: Type.String({ description: stockItem.oldText.description }),
				newText: Type.String({ description: stockItem.newText.description }),
			}),
			{ description: stockEdits.description },
		),
	});
}

/** Stock normalisation (JSON-string edits, single object, legacy oldText/newText) plus: null per-entry paths are dropped. */
export function prepareEditArguments(stockPrepare: ((input: any) => any) | undefined, input: any): any {
	const args = stockPrepare ? stockPrepare(input) : input;
	if (args && Array.isArray(args.edits)) {
		for (const entry of args.edits) {
			if (entry && typeof entry === "object" && entry.path == null) delete entry.path;
		}
	}
	return args;
}

// `indices` holds the position of each edit in the model's call, so errors can cite the model's own numbers.
type Group = { path: string; abs: string; edits: { oldText: string; newText: string }[]; indices: number[] };

function keyOf(path: string, cwd: string): string {
	try {
		const key = editPathKey(path, cwd);
		if (key !== undefined) return key;
	} catch {}
	return resolve(cwd, path);
}

function groupEdits(params: any, cwd: string): Group[] {
	const groups = new Map<string, Group>();
	params.edits.forEach((entry: any, i: number) => {
		const path = entry?.path || params.path;
		if (typeof path !== "string" || path === "") {
			throw new Error(`edits[${i}] has no path and the call has no top-level path`);
		}
		const key = keyOf(path, cwd);
		let group = groups.get(key);
		if (!group) {
			group = { path, abs: resolvePath(path, cwd), edits: [], indices: [] };
			groups.set(key, group);
		}
		group.edits.push({ oldText: entry.oldText, newText: entry.newText });
		group.indices.push(i);
	});
	return [...groups.values()];
}

/** Error message plus, for "Could not find", the nearest matching lines. Never throws. */
async function withHint(error: any, group: Group): Promise<string> {
	const raw = String(error?.message ?? error);
	// Stock numbers entries inside the group; the model knows them by their place in the call.
	const message = raw.replace(/edits\[(\d+)\]/g, (m, n) => (group.indices[Number(n)] === undefined ? m : `edits[${group.indices[Number(n)]}]`));
	if (!raw.startsWith("Could not find")) return message;
	const index = Number(/^Could not find edits\[(\d+)\]/.exec(raw)?.[1] ?? 0);
	const oldText = group.edits[index]?.oldText;
	if (typeof oldText !== "string") return message;
	const hint = await nearestMatchHint(group.abs, oldText);
	return hint ? `${message}\n${hint}` : message;
}

export async function executeEdit(stockExecute: any, id: string, params: any, signal: any, onUpdate: any, ctx: any, cwd: string) {
	const base = ctx?.cwd || cwd;
	// Empty or malformed edits: the stock execute throws its own error.
	if (!params || !Array.isArray(params.edits) || params.edits.length === 0) {
		return stockExecute(id, params, signal, onUpdate, ctx);
	}
	const groups = groupEdits(params, base);
	const runGroup = (group: Group) =>
		withRetry(() => stockExecute(id, { path: group.path, edits: group.edits }, signal, onUpdate, ctx), signal);

	if (groups.length === 1) {
		try {
			return await runGroup(groups[0]);
		} catch (error: any) {
			const message = await withHint(error, groups[0]);
			if (message === String(error?.message ?? error)) throw error;
			throw new Error(message);
		}
	}

	const alreadyAborted = signal?.aborted === true;
	const settled = await Promise.allSettled(groups.map(runGroup));
	const ok: string[] = [];
	const failed: string[] = [];
	const files: { path: string; ok: boolean; error?: string; outcome?: "possibly_changed"; details?: unknown }[] = [];
	for (let i = 0; i < groups.length; i++) {
		const group = groups[i];
		const result = settled[i];
		if (result.status === "fulfilled") {
			ok.push(`Edited: ${group.path} (${group.edits.length} block(s))`);
			files.push({ path: group.path, ok: true, ...(result.value.details !== undefined ? { details: result.value.details } : {}) });
		} else {
			const message = await withHint(result.reason, group);
			// A stock execute can reject for cancellation after writeFile has committed.
			// Inspect this rejection, not the shared signal: another file may have failed before any write.
			const cancelled = !alreadyAborted && (result.reason?.name === "AbortError" || String(result.reason?.message ?? result.reason) === "Operation aborted");
			failed.push(cancelled
				? `Possibly changed: ${group.path}: ${message}. Read this file before retrying.`
				: `Failed: ${group.path}: ${message}`);
			files.push({ path: group.path, ok: false, error: message, ...(cancelled ? { outcome: "possibly_changed" as const } : {}) });
		}
	}
	return {
		content: [{ type: "text", text: [...ok, ...failed].join("\n") }],
		details: { files },
		...(failed.length > 0 ? { isError: true } : {}),
	};
}
