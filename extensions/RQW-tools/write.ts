import { Type } from "typebox";
import { writePathKeys } from "./keys.ts";
import { withRetry } from "./retry.ts";

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

const FORM_ERROR = "Give path and content, or files, not both";

/** Models send `files` as a JSON string or as one object; turn both into an array (like stock edit does for `edits`). */
export function prepareWriteArguments(input: any): any {
	if (!input || typeof input !== "object") return input;
	let files = input.files;
	if (typeof files === "string") {
		try {
			files = JSON.parse(files);
		} catch {
			return input;
		}
	}
	if (files && typeof files === "object" && !Array.isArray(files)) files = [files];
	return files === input.files ? input : { ...input, files };
}

const isInside = (outer: string, inner: string) => inner.startsWith(outer.endsWith("/") ? outer : outer + "/");

export async function executeWrite(stockExecute: any, id: string, params: any, signal: any, onUpdate: any, ctx: any, cwd: string) {
	const base = ctx?.cwd || cwd;
	// Strict mode fills every key, so empty values mean "form not used".
	const hasFiles = Array.isArray(params?.files) && params.files.length > 0;
	const hasSingle = typeof params?.path === "string" && params.path !== "";
	if (hasFiles === hasSingle) throw new Error(FORM_ERROR);

	let files: { path: string; content: string }[];
	if (hasFiles) {
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

	const keys = writePathKeys(files.map((file) => file.path), base, signal);
	for (let i = 0; i < files.length; i++) {
		for (let j = i + 1; j < files.length; j++) {
			if (keys[i] === keys[j]) throw new Error(`files lists ${files[j].path} twice`);
			if (isInside(keys[i], keys[j])) throw new Error(`files lists ${files[i].path} and ${files[j].path}, one inside the other`);
			if (isInside(keys[j], keys[i])) throw new Error(`files lists ${files[j].path} and ${files[i].path}, one inside the other`);
		}
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
