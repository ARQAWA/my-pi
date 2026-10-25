import { execFileSync } from "node:child_process";
import { posix } from "node:path";
import { marked } from "marked";

const decode = (text) => text.replace(/&#(x[\da-f]+|\d+);|&(amp|lt|gt|quot|apos|nbsp);/gi, (raw, number, name) => {
	if (number) return String.fromCodePoint(parseInt(number.replace(/^x/i, ""), /^x/i.test(number) ? 16 : 10));
	return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " }[name.toLowerCase()];
});
const lineAt = (text, offset) => text.slice(0, offset).split("\n").length;
const touched = (ranges, start, end) => ranges.some((r) => start < r.start + r.count && end >= r.start);

// Nested list/quote tokens omit container prefixes. Locate their lines in the original block.
function locate(raw, source, from) {
	const exact = source.indexOf(raw, from);
	if (exact >= 0) return [exact, exact + raw.length];
	let start, end = from;
	for (const line of raw.trimEnd().split("\n")) {
		if (!line) continue;
		const at = source.indexOf(line, end);
		if (at < 0) return null;
		start ??= at;
		end = at + line.length;
	}
	return start === undefined ? null : [start, end];
}

function plain(tokens) {
	return (tokens ?? []).map((t) => t.type === "html" ? "" : t.tokens ? plain(t.tokens) : t.text ?? "").join("");
}

function document(text) {
	const tokens = marked.lexer(text, { gfm: true });
	const links = [], anchors = new Set(), fences = [];
	const slugs = new Set();
	let offset = 0;
	for (const block of tokens) {
		const source = block.raw;
		let cursor = 0;
		marked.walkTokens([block], (token) => {
			if (token.type === "heading") {
				const slug = decode(plain(token.tokens)).toLowerCase().replace(/[^\p{L}\p{M}\p{N}_\-\s]/gu, "").replace(/ /g, "-");
				let unique = slug, count = 0;
				while (slugs.has(unique)) unique = `${slug}-${++count}`;
				slugs.add(unique);
				anchors.add(unique);
			}
			if (token.type === "html") {
				for (const tag of token.raw.matchAll(/<[a-z][^>]*>/gi)) {
					for (const attr of tag[0].matchAll(/\s(?:id|name)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
						anchors.add(decode(attr[1] ?? attr[2] ?? attr[3]));
					}
				}
			}
			if (token.type === "code") {
				const lines = token.raw.trimEnd().split("\n");
				const open = /^ {0,3}(`{3,}|~{3,})/.exec(lines[0]);
				if (open && (lines.length < 2 || !new RegExp(`^ {0,3}${open[1][0]}{${open[1].length},}\\s*$`).test(lines.at(-1)))) {
					const found = locate(token.raw, source, 0);
					fences.push(lineAt(text, offset + (found?.[0] ?? 0)));
				}
			}
			if (!["link", "image", "def"].includes(token.type)) return;
			const found = locate(token.raw, source, cursor);
			if (!found) return;
			cursor = found[0] + 1;
			links.push({ href: token.href, start: lineAt(text, offset + found[0]), end: lineAt(text, offset + found[1] - 1) });
		});
		offset += source.length;
	}
	return { links, anchors, fences };
}

/** Check the committed diff, never the working tree or the network. */
export function checkDocuments({ git, base, head, files }) {
	const issues = [];
	if (!files.length) return issues;
	try {
		git("diff", "--check", "--no-renames", `${base}...${head}`, "--", ...files);
	} catch (error) {
		issues.push(`document format: ${String(error.stdout || error.stderr || error.message).trim()}`);
	}
	const cache = new Map();
	let root;
	const read = (rev, file) => {
		const key = `${rev}:${file}`;
		// The caller's git helper trims output; leading blanks/indentation affect Markdown and diff line numbers.
		if (!cache.has(key)) {
			root ??= git("rev-parse", "--show-toplevel");
			const text = execFileSync("git", ["-C", root, "show", key], {
				encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
			});
			cache.set(key, document(text));
		}
		return cache.get(key);
	};
	const linkProblem = (rev, file, href) => {
		if (/^[a-z][a-z\d+.-]*:/i.test(href) || href.startsWith("//")) {
			try {
				if (/\s|%(?![\da-f]{2})/i.test(href)) throw new Error("invalid URL characters");
				new URL(href.startsWith("//") ? `https:${href}` : href);
			} catch { return "malformed external URL"; }
			return;
		}
		let path, anchor;
		try {
			const hash = href.indexOf("#");
			path = decodeURIComponent((hash < 0 ? href : href.slice(0, hash)).split("?")[0]);
			anchor = hash < 0 ? "" : decodeURIComponent(href.slice(hash + 1));
		} catch { return "malformed local URL"; }
		const target = path ? posix.normalize(path.startsWith("/") ? path.slice(1) : posix.join(posix.dirname(file), path)) : file;
		try { git("cat-file", "-e", `${rev}:${target}`); } catch { return "missing local target"; }
		if (anchor && /\.md$/i.test(target) && !read(rev, target).anchors.has(anchor)) return "missing Markdown anchor";
	};
	for (const file of files.filter((f) => /\.md$/i.test(f))) {
		try { git("cat-file", "-e", `${head}:${file}`); } catch { continue; }
		try {
			const diff = git("diff", "--no-ext-diff", "--no-textconv", "--no-color", "--no-renames", "-U0", `${base}...${head}`, "--", file);
			if (!diff) continue;
			const ranges = [...diff.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)]
				.map((m) => ({ start: Number(m[1]), count: Number(m[2] ?? 1) })).filter((r) => r.count);
			const doc = read(head, file);
			let baseHrefs;
			for (const line of doc.fences) issues.push(`${file}:${line}: unclosed Markdown fence`);
			for (const link of doc.links) {
				const href = decode(link.href);
				const problem = linkProblem(head, file, href);
				if (!problem) continue;
				if (!touched(ranges, link.start, link.end)) {
					// Compare destinations, not line numbers: unrelated edits can move historical links.
					baseHrefs ??= new Set(read(base, file).links.map((old) => decode(old.href)));
					if (baseHrefs.has(href) && linkProblem(base, file, href)) continue;
				}
				issues.push(`${file}:${link.start}: ${problem}: ${href}`);
			}
		} catch (error) {
			issues.push(`${file}: document check failed: ${error.message}`);
		}
	}
	return issues;
}
