import { Text } from "@earendil-works/pi-tui";

// Rendering choice: the stock edit and write definitions already carry their renderers (spread from
// `editRenderers` / `writeRenderers`), so the wrapped definitions reuse them. Our renderCall/renderResult only
// take over when the call touches more than one file; every other call is passed to the stock renderer, with the
// args normalised to the stock shape (path at top level) so the single-file diff preview still works.
// Nothing here throws: any error falls back to a plain Text.

type Stock = { renderCall?: (...a: any[]) => any; renderResult?: (...a: any[]) => any };

function str(value: unknown): string | undefined {
	return typeof value === "string" && value !== "" ? value : undefined;
}

/** Distinct paths of an edit call with the number of edits for each, in first-seen order. */
function editFiles(args: any): { path: string; count: number }[] {
	const files = new Map<string, number>();
	const entries = Array.isArray(args?.edits) ? args.edits : [];
	for (const entry of entries) {
		const path = str(entry?.path) ?? str(args?.path);
		if (path) files.set(path, (files.get(path) ?? 0) + 1);
	}
	return [...files].map(([path, count]) => ({ path, count }));
}

function writeFiles(args: any): { path: string; count: number }[] {
	const files = Array.isArray(args?.files) ? args.files : [];
	return files.flatMap((f: any) => {
		const path = str(f?.path);
		return path ? [{ path, count: typeof f?.content === "string" ? f.content.split("\n").length : 0 }] : [];
	});
}

/** Stock-shaped args for a call with one file only. */
function normalizeEdit(args: any): any {
	const files = editFiles(args);
	return files.length === 1 ? { ...args, path: files[0].path } : args;
}

function normalizeWrite(args: any): any {
	const first = Array.isArray(args?.files) && args.files.length === 1 ? args.files[0] : undefined;
	return first && !str(args?.path) ? { ...args, path: first.path, content: first.content } : args;
}

function reuseText(last: any, text: string, padX: number): any {
	if (last instanceof Text) {
		last.setText(text);
		return last;
	}
	return new Text(text, padX, 0);
}

function callText(tool: string, files: { path: string; count: number }[], unit: string, theme: any): string {
	const rows = files.map((f) => `  ${f.path} (${f.count} ${unit})`).join("\n");
	return `${theme.fg("toolTitle", theme.bold(tool))} ${files.length} files\n${rows}`;
}

function resultText(result: any, theme: any): string {
	const text = (Array.isArray(result?.content) ? result.content : [])
		.filter((c: any) => c?.type === "text")
		.map((c: any) => String(c.text ?? ""))
		.join("\n");
	return (
		"\n" +
		text
			.split("\n")
			.map((line: string) => theme.fg(line.startsWith("Failed:") ? "error" : "toolOutput", line))
			.join("\n")
	);
}

function make(
	tool: "edit" | "write",
	stock: Stock,
	filesOf: (args: any) => { path: string; count: number }[],
	normalize: (args: any) => any,
	unit: string,
	pad: (context: any) => number,
) {
	const plain = (last: any, text: string) => reuseText(last, text, 0);
	return {
		renderCall(args: any, theme: any, context: any) {
			try {
				if (filesOf(args).length > 1) {
					return reuseText(context?.lastComponent, callText(tool, filesOf(args), unit, theme), pad(context));
				}
				return stock.renderCall!(normalize(args), theme, context);
			} catch {
				return plain(context?.lastComponent, tool);
			}
		},
		renderResult(result: any, options: any, theme: any, context: any) {
			try {
				if (filesOf(context?.args).length > 1) {
					return reuseText(context?.lastComponent, resultText(result, theme), pad(context));
				}
				return stock.renderResult!(result, options, theme, { ...context, args: normalize(context?.args) });
			} catch {
				return plain(context?.lastComponent, "");
			}
		},
	};
}

export function editRenderers(stock: Stock) {
	return make("edit", stock, editFiles, normalizeEdit, "edits", (c) => (typeof c?.outputPad === "number" ? c.outputPad : 0));
}

export function writeRenderers(stock: Stock) {
	return make("write", stock, writeFiles, normalizeWrite, "lines", () => 0);
}
