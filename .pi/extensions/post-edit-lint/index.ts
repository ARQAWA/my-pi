import { spawn } from "node:child_process";
import { extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext, ToolResultEvent, ToolResultEventResult } from "@earendil-works/pi-coding-agent";

const CHANNEL = "rqw-agent:subagent-extension-factories";
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const OXLINT = resolve(ROOT, "node_modules", ".bin", process.platform === "win32" ? "oxlint.cmd" : "oxlint");
const CONFIG = resolve(ROOT, ".oxlintrc.json");
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"]);
const MAX_FINDINGS = 5;
const MAX_BYTES = 2000;

type Diagnostic = {
	filename?: unknown;
	message?: unknown;
	labels?: unknown;
};

type ProcessResult = { code: number | null; stdout: string; stderr: string };

function runProcess(paths: string[], signal: AbortSignal | undefined): Promise<ProcessResult> {
	return new Promise((resolvePromise, reject) => {
		const child = spawn(OXLINT, ["--config", CONFIG, "--format", "json", ...paths], {
			cwd: ROOT,
			windowsHide: true,
			...(signal ? { signal } : {}),
		});
		let stdout = "";
		let stderr = "";
		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", chunk => { stdout += chunk; });
		child.stderr.on("data", chunk => { stderr += chunk; });
		child.on("error", reject);
		child.on("close", code => resolvePromise({ code, stdout, stderr }));
	});
}

function processError(result: ProcessResult): Error {
	const detail = result.stderr.trim() || `oxlint exited with code ${result.code ?? "unknown"}`;
	return new Error(detail);
}

async function lint(paths: string[], signal: AbortSignal | undefined, runner: typeof runProcess): Promise<Diagnostic[]> {
	const result = await runner(paths, signal);
	if (!result.stdout.trim()) {
		if (result.code === 0) return [];
		throw processError(result);
	}
	let report: { diagnostics?: unknown };
	try {
		report = JSON.parse(result.stdout);
	} catch {
		throw processError(result);
	}
	if (!Array.isArray(report.diagnostics)) throw processError(result);
	if (result.code !== 0 && report.diagnostics.length === 0) throw processError(result);
	return report.diagnostics as Diagnostic[];
}

function inputPaths(event: ToolResultEvent): string[] {
	if (event.toolName !== "edit" && event.toolName !== "write") return [];
	const details = event.details as { files?: unknown; job?: unknown } | undefined;
	if (details?.job !== undefined) return [];
	if (Array.isArray(details?.files)) {
		return details.files.flatMap(file => {
			if (!file || typeof file !== "object") return [];
			const item = file as { path?: unknown; ok?: unknown };
			return item.ok === true && typeof item.path === "string" ? [item.path] : [];
		});
	}
	if (event.isError) return [];
	const input = event.input;
	if (Array.isArray(input.edits) && input.edits.length > 0) {
		return input.edits.flatMap(edit => {
			const path = edit && typeof edit === "object" ? (edit as { path?: unknown }).path : undefined;
			const selected = path ?? input.path;
			return typeof selected === "string" ? [selected] : [];
		});
	}
	if (Array.isArray(input.files)) {
		return input.files.flatMap(file => {
			const path = file && typeof file === "object" ? (file as { path?: unknown }).path : undefined;
			return typeof path === "string" ? [path] : [];
		});
	}
	return typeof input.path === "string" ? [input.path] : [];
}

function sourcePaths(event: ToolResultEvent, cwd: string): string[] {
	return [...new Set(inputPaths(event)
		.filter(path => SOURCE_EXTENSIONS.has(extname(path).toLowerCase()))
		.map(path => resolve(cwd, path)))];
}

function findingLines(diagnostics: Diagnostic[], cwd: string, current: Set<string>): string[] {
	const lines: string[] = [];
	const seen = new Set<string>();
	for (const diagnostic of diagnostics) {
		if (typeof diagnostic.filename !== "string" || typeof diagnostic.message !== "string") continue;
		const filename = resolve(ROOT, diagnostic.filename);
		if (!current.has(filename) || !Array.isArray(diagnostic.labels)) continue;
		for (const label of diagnostic.labels) {
			const span = label && typeof label === "object" ? (label as { span?: unknown }).span : undefined;
			if (!span || typeof span !== "object") continue;
			const location = span as { line?: unknown; column?: unknown };
			if (typeof location.line !== "number" || typeof location.column !== "number") continue;
			const message = diagnostic.message.replace(/\s*\n\s*/g, " ");
			const line = `${relative(cwd, filename)}:${location.line}:${location.column}: ${message}`;
			if (!seen.has(line)) { seen.add(line); lines.push(line); }
			break;
		}
	}
	return lines;
}

function boundedFindings(lines: string[]): string {
	let text = "oxlint:";
	for (const line of lines) {
		if (text.split("\n").length > MAX_FINDINGS) break;
		const prefix = `${text}\n`;
		const remaining = MAX_BYTES - Buffer.byteLength(prefix);
		if (remaining <= 0) break;
		const bytes = Buffer.from(line);
		if (bytes.length > remaining) {
			text = prefix + bytes.subarray(0, remaining).toString("utf8").replace(/\uFFFD$/, "");
			break;
		}
		text = prefix + line;
	}
	return text;
}

function failureText(error: unknown): string {
	const detail = (error instanceof Error ? error.message : String(error)).replace(/\s+/g, " ").trim();
	return `oxlint check failed: ${detail.slice(0, 200) || "unknown error"}`;
}

function append(event: ToolResultEvent, text: string): ToolResultEventResult {
	return {
		content: [...event.content, { type: "text", text }],
		details: event.details,
		...(event.structuredContent !== undefined ? { structuredContent: event.structuredContent } : {}),
	};
}

function installChecker(pi: ExtensionAPI, runner: typeof runProcess): void {
	const versions = new Map<string, object>();
	pi.on("tool_result", async (event, ctx: ExtensionContext) => {
		const paths = sourcePaths(event, ctx.cwd);
		if (paths.length === 0 || ctx.signal?.aborted) return;
		const version = {};
		for (const path of paths) versions.set(path, version);
		let diagnostics: Diagnostic[];
		try {
			diagnostics = await lint(paths, ctx.signal, runner);
		} catch (error) {
			if (ctx.signal?.aborted || (error instanceof Error && error.name === "AbortError")) return;
			if (!paths.some(path => versions.get(path) === version)) return;
			return append(event, failureText(error));
		}
		if (ctx.signal?.aborted) return;
		const current = new Set(paths.filter(path => versions.get(path) === version));
		const lines = findingLines(diagnostics, ctx.cwd, current);
		if (lines.length > 0) return append(event, boundedFindings(lines));
	});
}

export default function postEditLint(pi: ExtensionAPI, runner: typeof runProcess = runProcess): void {
	const events = pi.events;
	const factory = (child: ExtensionAPI) => {
		installChecker(child, runner);
		// Reoffer on the bus shared with RQW-agent so nested children receive this same inline factory.
		events.on(CHANNEL, request => {
			(request as { offer?: (value: typeof factory) => void })?.offer?.(factory);
		});
	};
	factory(pi);
}
