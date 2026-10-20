import { Type } from "typebox";
import { pathKey } from "./keys.ts";
import { withRetry } from "./retry.ts";
import { resolve } from "node:path";

// Multi-file write over the stock write definition (design decision 5).

export function createWriteSchema(stockParameters: any) {
	const stock = stockParameters.properties;
	return Type.Object({
		path: Type.Optional(Type.String({ description: stock.path.description })),
		content: Type.Optional(Type.String({ description: stock.content.description })),
		files: Type.Optional(
			Type.Array(
				Type.Object({
					path: Type.String({ description: stock.path.description }),
					content: Type.String({ description: stock.content.description }),
				}),
				{ description: "Several files to write in one call, each {path, content}; use instead of path and content." },
			),
		),
	});
}

function keyOf(path: string, cwd: string): string {
	try {
		const key = pathKey(path, cwd);
		if (key !== undefined) return key;
	} catch {}
	return resolve(cwd, path);
}

const FORM_ERROR = "Give path and content, or files, not both";

export async function executeWrite(stockExecute: any, id: string, params: any, signal: any, onUpdate: any, ctx: any, cwd: string) {
	const base = ctx?.cwd || cwd;
	const hasFiles = params?.files != null;
	const hasSingle = params?.path != null || params?.content != null;
	if (hasFiles === hasSingle) throw new Error(FORM_ERROR);

	let files: { path: string; content: string }[];
	if (hasFiles) {
		if (!Array.isArray(params.files) || params.files.length === 0) throw new Error("files is empty: " + FORM_ERROR);
		files = params.files;
		files.forEach((f, i) => {
			if (!f || typeof f.path !== "string" || f.path === "" || typeof f.content !== "string") {
				throw new Error(`files[${i}] needs path and content`);
			}
		});
	} else {
		if (typeof params.path !== "string" || typeof params.content !== "string") throw new Error(FORM_ERROR);
		files = [{ path: params.path, content: params.content }];
	}

	const seen = new Set<string>();
	for (const file of files) {
		const key = keyOf(file.path, base);
		if (seen.has(key)) throw new Error(`files lists ${file.path} twice`);
		seen.add(key);
	}

	const runFile = (file: { path: string; content: string }) =>
		withRetry(() => stockExecute(id, { path: file.path, content: file.content }, signal, onUpdate, ctx), signal);

	if (files.length === 1) return runFile(files[0]);

	const settled = await Promise.allSettled(files.map(runFile));
	const lines: string[] = [];
	const details: { path: string; ok: boolean; error?: string }[] = [];
	settled.forEach((result, i) => {
		const path = files[i].path;
		if (result.status === "fulfilled") {
			lines.push(`Written: ${path}`);
			details.push({ path, ok: true });
		} else {
			const message = String((result.reason as any)?.message ?? result.reason);
			lines.push(`Failed: ${path}: ${message}`);
			details.push({ path, ok: false, error: message });
		}
	});
	return {
		content: [{ type: "text", text: lines.join("\n") }],
		details: { files: details },
		...(details.some((d) => !d.ok) ? { isError: true } : {}),
	};
}
