import { readdirSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

const TEST = /\.test\.(?:ts|js|mjs)$/;
const SOURCE = /\.(?:ts|js|mjs|cjs)$/;
const STRING = /(["'`])(?:\\.|(?!\1)[^\\])*?\1/g;
const CALL = /(?:\b(?:\w+\.)?(?:join|resolve|dirname|fileURLToPath)|new\s+URL)\s*\(/g;

function files(dir) {
	return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
		if (entry.name === "node_modules" || entry.name === ".git") return [];
		const path = join(dir, entry.name);
		return entry.isDirectory() ? files(path) : entry.isFile() ? [path] : [];
	});
}

// Split only at the outer level, so nested dirname/fileURLToPath calls stay intact.
function argumentsOf(text) {
	const parts = [];
	let start = 0, depth = 0;
	const tokens = /(["'`])(?:\\.|(?!\1)[^\\])*?\1|[(),]/g;
	for (const match of text.matchAll(tokens)) {
		if (match[0] === "(") depth++;
		if (match[0] === ")") depth--;
		if (match[0] === "," && depth === 0) {
			parts.push(text.slice(start, match.index).trim());
			start = match.index + 1;
		}
	}
	parts.push(text.slice(start).trim());
	return parts;
}

function callEnd(text, open) {
	let depth = 0;
	const tokens = /(["'`])(?:\\.|(?!\1)[^\\])*?\1|[()]/g;
	tokens.lastIndex = open;
	for (let match; (match = tokens.exec(text));) {
		if (match[0] === "(") depth++;
		if (match[0] === ")" && --depth === 0) return tokens.lastIndex;
	}
	return text.length;
}

function references(text, file, root) {
	const values = new Map();
	const evaluate = expression => {
		const expr = expression.trim();
		if (/^(["'`])[\s\S]*\1$/.test(expr)) {
			const value = expr.slice(1, -1);
			return value.includes("${") || value.includes("\\") ? undefined : value;
		}
		if (expr === "import.meta.dirname") return dirname(file);
		if (expr === "import.meta.url") return file;
		if (values.has(expr)) return values.get(expr);
		const call = /^(?:(?:\w+\.)?(join|resolve|dirname|fileURLToPath)|new\s+(URL))\s*\(([\s\S]*)\)$/.exec(expr);
		if (!call) return undefined;
		const args = argumentsOf(call[3]).map(evaluate);
		if (args.some(arg => arg === undefined)) return undefined;
		switch (call[1] ?? call[2]) {
			case "join": return join(...args);
			case "resolve": return resolve(root, ...args);
			case "dirname": return dirname(args[0]);
			case "fileURLToPath": return args[0];
			case "URL": return args.length === 2 && isAbsolute(args[1]) ? resolve(dirname(args[1]), args[0]) : undefined;
		}
	};
	const declarations = [...text.matchAll(/\b(?:const|let|var)\s+(\w+)(?:\s*:\s*[^=\n]+)?\s*=\s*([^;\n]+)/g)];
	// Resolve aliases and path constants without executing the source under inspection.
	for (let pass = 0; pass < declarations.length; pass++) {
		let added = false;
		for (const [, name, expr] of declarations) {
			if (values.has(name)) continue;
			const value = evaluate(expr);
			if (value !== undefined) { values.set(name, value); added = true; }
		}
		if (!added) break;
	}
	const refs = new Set();
	const add = value => {
		if (!value || /^(?:node:|https?:|@)/.test(value)) return;
		const candidates = isAbsolute(value) ? [value] : value.startsWith(".")
			? [resolve(dirname(file), value)] : [resolve(root, value), resolve(dirname(file), value)];
		for (const candidate of candidates) {
			const rel = relative(root, candidate);
			if (rel && rel !== ".." && !rel.startsWith(`..${sep}`) && !rel.split(sep).includes("node_modules")) refs.add(candidate);
		}
	};
	const ranges = [];
	for (const match of text.matchAll(CALL)) {
		if (ranges.some(([start, end]) => match.index >= start && match.index < end)) continue;
		const end = callEnd(text, text.indexOf("(", match.index));
		ranges.push([match.index, end]);
		add(evaluate(text.slice(match.index, end)));
	}
	for (const match of text.matchAll(STRING)) {
		if (!ranges.some(([start, end]) => match.index >= start && match.index < end)) add(evaluate(match[0]));
	}
	return refs;
}

/** Select existing tests only; unknown or dynamic dependencies never trigger a full-suite fallback. */
export function selectTargetedTests({ root, changed }) {
	root = resolve(root);
	const all = files(root);
	const existing = new Set(all);
	const changes = new Set(changed.map(path => resolve(root, path)));
	const extensionNames = new Set();
	for (const path of changes) {
		const name = /^(?:extensions\/|test\/extensions\/)([^/]+)\//.exec(relative(root, path).split(sep).join("/"))?.[1];
		if (name) extensionNames.add(name);
	}
	const tests = all.filter(path => TEST.test(path));
	const selected = new Set(tests.filter(path => changes.has(path)));
	for (const path of tests) {
		const rel = relative(root, path).split(sep).join("/");
		const name = /^(?:extensions\/([^/]+)\/test\/|test\/extensions\/([^/]+)\/)/.exec(rel);
		if (name && extensionNames.has(name[1] ?? name[2])) selected.add(path);
	}
	const isolation = join(root, "test/isolation.test.ts");
	if (extensionNames.size && existing.has(isolation)) selected.add(isolation);
	const cache = new Map();
	const affected = (file, visiting) => {
		if (changes.has(file)) return true;
		if (visiting.has(file) || !existing.has(file) || !SOURCE.test(file)) return false;
		visiting.add(file);
		if (!cache.has(file)) cache.set(file, references(readFileSync(file, "utf8"), file, root));
		for (const ref of cache.get(file)) {
			// Prefixes also match removed files: no stat of the changed path is needed.
			if ([...changes].some(path => path === ref || path.startsWith(ref + sep))) return true;
			if (affected(ref, visiting)) return true;
		}
		return false;
	};
	for (const test of tests) {
		if (dirname(test) === join(root, "test") && affected(test, new Set())) selected.add(test);
	}
	return [...selected].map(path => relative(root, path).split(sep).join("/")).sort();
}
