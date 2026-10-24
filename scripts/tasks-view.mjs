// Repo-local macOS dev tool: renders BACKLOG.md (working-tree file) as one standalone, view-only HTML page.
// Deterministic, no model calls, no network. The source is untrusted data: raw HTML, images and
// non-http links are neutralised, and a CSP allows only the one inline script below.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Marked, Parser } from "marked";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESCAPES[c]);
const excerpt = (s, n) => { const chars = [...s.replace(/\s+/g, " ").trim()]; return chars.length > n ? `${chars.slice(0, n).join("")}...` : chars.join(""); };

const marked = new Marked({
	renderer: {
		html: ({ text }) => esc(text),
		image: ({ text }) => esc(text),
		// Text inside raw-tag regions (script, pre, code, kbd) arrives flagged escaped but is not; always escape.
		text(token) { return token.tokens ? this.parser.parseInline(token.tokens) : esc(token.text); },
		link(token) {
			const inner = this.parser.parseInline(token.tokens);
			if (/^(https?:\/\/|mailto:)/i.test(token.href)) return `<a href="${esc(token.href)}" rel="noreferrer noopener">${inner}</a>`;
			return `${inner} <code>(${esc(token.href)})</code>`;
		},
	},
});

const SCRIPT = `const q = document.getElementById("q"), sel = document.getElementById("sec"), count = document.getElementById("count");
function apply() {
	const term = q.value.toLowerCase(); let shown = 0;
	for (const el of document.querySelectorAll("[data-section]")) {
		const inSection = sel.value === "" || el.dataset.section === sel.value;
		const isHeading = el.classList.contains("head");
		const matches = isHeading || term === "" || el.textContent.toLowerCase().includes(term);
		el.hidden = !(inSection && matches);
		if (el.tagName === "DETAILS") { el.open = term !== "" && !el.hidden; if (!el.hidden) shown++; }
	}
	count.textContent = shown + " tasks shown";
}
q.addEventListener("input", apply); sel.addEventListener("change", apply); apply();`;

// Mobile-first dark theme: 18px body, 44px minimum tap targets, long text wraps instead of scrolling sideways.
const CSS = `:root{color-scheme:dark}*{box-sizing:border-box}
body{background:#111418;color:#e8eaed;font:18px/1.5 system-ui,sans-serif;margin:0 auto;max-width:900px;padding:1rem;overflow-wrap:anywhere}
h1{font-size:1.5rem}h2{font-size:1.25rem;margin:1.6rem 0 .4rem;border-bottom:1px solid #333}a{color:#8ab4f8}
code,pre{font:15px/1.4 ui-monospace,monospace}pre{white-space:pre-wrap;background:#1c2128;padding:.7rem;overflow-x:auto}
input,select{font:inherit;min-height:44px;width:100%;margin:.3rem 0;background:#1c2128;color:inherit;border:1px solid #555;border-radius:6px;padding:.4rem}
details.task,#overview,#full-source{background:#1a1e24;border:1px solid #333;border-radius:8px;margin:.5rem 0}
summary{cursor:pointer;min-height:44px;padding:.6rem .8rem;display:block}details[open]>summary{border-bottom:1px solid #333}
dl{margin:0;padding:.2rem .8rem .8rem}dt{font-weight:600;margin-top:.8rem;color:#bbb}dd{margin:.1rem 0 0}.status{color:#f0b429}
.caption{color:#aaa;font-size:15px}.limit{border-left:4px solid #f0b429;padding-left:.7rem;color:#ddd}.block{margin:.5rem 0}[hidden]{display:none}`;

// Render already-lexed inline tokens so reference links resolved by the document lexer survive.
const inline = (tokens) => Parser.parseInline(tokens, marked.defaults);
// Cell ID anchors like <a id="x"></a> are dropped; the raw source still has them.
const withoutAnchor = (tokens) => {
	const rest = [...tokens];
	while (rest[0]?.type === "html" && /^<\/?a( id="[^"]*")?>$/.test(rest[0].text)) rest.shift();
	return rest;
};
// Plain text for summaries: render safely, drop our own tags, decode our own escapes, then cut.
const plain = (tokens, n) => excerpt(inline(tokens).replace(/<[^>]*>/g, "")
	.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&"), n);

// Branches are only names the task text states explicitly: `branch `x`` or `` `x` branch``.
const BRANCH_MENTIONS = [/\bbranch(?:es)?\s+`([\w][\w./-]*)`/gi, /`([\w][\w./-]*)`\s+branch\b/gi];
export const branchNames = (text) => [...new Set(BRANCH_MENTIONS.flatMap((re) => [...text.matchAll(re)].map((m) => m[1])))];

const sha = (s) => `<code>${esc(s.slice(0, 9))}</code>`;
function branchLine(name, refs) {
	const ref = refs[name];
	if (!ref) return { found: false, html: `<code>${esc(name)}</code>: not found in local or origin refs` };
	const where = [ref.local && `local ${sha(ref.local)}`, ref.origin && `origin ${sha(ref.origin)}`].filter(Boolean).join(", ");
	const differ = ref.local && ref.origin && ref.local !== ref.origin ? " (local and origin point to different commits)" : "";
	return { found: true, html: `<code>${esc(name)}</code>: ${where}${differ}` };
}

// Tables are task lists: first column is the ID, other columns are shown under their header.
function renderTask(table, section, refs, stats) {
	const statusCol = table.header.findIndex((h) => /^status/i.test(h.text));
	return table.rows.map((row) => {
		const cells = row.map((c, i) => inline(i === 0 ? withoutAnchor(c.tokens) : c.tokens));
		const status = statusCol > 0 ? `<span class="status"> | ${esc(plain(row[statusCol].tokens, 100))}</span>` : "";
		const parts = cells.map((html, i) => (i === 0 ? "" : `<dt>${inline(table.header[i].tokens)}</dt><dd>${html}</dd>`));
		const names = branchNames(row.map((c) => c.text).join(" \n "));
		const lines = names.map((n) => branchLine(n, refs));
		for (const l of lines) stats[l.found ? "found" : "missing"]++;
		if (!names.length) stats.none++;
		const branches = lines.length ? `<ul>${lines.map((l) => `<li>${l.html}</li>`).join("")}</ul>` : "not recorded";
		parts.push(`<dt>Branches (git refs snapshot)</dt><dd>${branches}</dd>`);
		return `<details class="task" data-section="${section}"><summary><strong>${cells[0]}</strong> ${esc(plain(row[1]?.tokens ?? [], 160))}${status}</summary><dl>${parts.join("")}</dl></details>`;
	}).join("\n");
}

export function render(src, { sourcePath, head, gitState, generatedAt, refs = {} }) {
	const stats = { found: 0, missing: 0, none: 0 };
	const sections = [];
	const body = [];
	const current = () => sections.at(-1) ?? (sections.push({ title: "(before first heading)", tasks: 0, blocks: 0 }), sections.at(-1));
	for (const token of marked.lexer(src)) {
		if (token.type === "space") continue;
		if (token.type === "heading") {
			sections.push({ title: token.text, tasks: 0, blocks: 0 });
			body.push(`<h2 class="head" id="sec-${sections.length - 1}" data-section="${sections.length - 1}">${inline(token.tokens)}</h2>`);
			continue;
		}
		const section = current();
		const index = sections.length - 1;
		if (token.type === "table") {
			section.tasks += token.rows.length;
			body.push(renderTask(token, index, refs, stats));
		} else {
			section.blocks++;
			body.push(`<div class="block" data-section="${index}">${marked.parser([token])}</div>`);
		}
	}
	const overview = sections.map((s, i) => `<li><a href="#sec-${i}">${esc(s.title)}</a>: ${s.tasks} tasks, ${s.blocks} other blocks</li>`);
	const options = sections.map((s, i) => `<option value="${i}">${esc(s.title)}</option>`).join("");
	const hash = createHash("sha256").update(SCRIPT).digest("base64");
	return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'sha256-${hash}'">
<title>Backlog tasks (view only)</title><style>${CSS}</style></head><body>
<h1>Backlog tasks (view only)</h1>
<p class="caption">Source: <code>${esc(sourcePath)}</code>, a working-tree file read at ${esc(generatedAt)}. Repository HEAD: <code>${esc(head)}</code>. File state against HEAD: ${esc(gitState)}.</p>
<p class="limit">Static snapshot of this one file. It does not reflect live agent or session state. Execution state kept only in agent sessions, and any backlog revision not yet merged, is missing here; the file can lag behind the real queue. Missing fields are not inferred: each task shows the source text as written.</p>
<p class="limit">Branches: each task shows only branch names its own text states explicitly (as in "branch&nbsp;name" in code quotes), matched against local and origin branch refs read from the local git repository at ${esc(generatedAt)}. No fetch was done, so origin refs are as last fetched, not server-fresh. A ref only shows that the branch exists; it does not say the task is done. Explicit branch names: ${stats.found + stats.missing}, found: ${stats.found}, not found: ${stats.missing}. Tasks with no branch recorded: ${stats.none}.</p>
<details id="overview"><summary>Sections (${sections.length})</summary><ul>${overview.join("")}</ul></details>
<p><input id="q" type="search" placeholder="Search tasks and text"> <select id="sec"><option value="">All sections</option>${options}</select> <span id="count"></span></p>
${body.join("\n")}
<details id="full-source"><summary>Full source, escaped</summary><pre id="source">${esc(src)}</pre></details>
<script>${SCRIPT}</script></body></html>
`;
}

const git = (...args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();

// Read-only branch refs of the local repository: { name: { local?: sha, origin?: sha } }.
export function readRefs(cwd = ROOT) {
	const out = execFileSync("git", ["for-each-ref", "--format=%(refname)%09%(objectname)", "refs/heads", "refs/remotes/origin"], { cwd, encoding: "utf8" });
	const refs = {};
	for (const line of out.split("\n").filter(Boolean)) {
		const [ref, oid] = line.split("\t");
		const local = /^refs\/heads\/(.+)$/.exec(ref)?.[1];
		const origin = /^refs\/remotes\/origin\/(.+)$/.exec(ref)?.[1];
		if (origin === "HEAD") continue;
		const name = local ?? origin;
		(refs[name] ??= Object.create(null))[local ? "local" : "origin"] = oid;
	}
	return refs;
}

function gitFacts(sourcePath) {
	try {
		const dirty = git("status", "--porcelain", "--", sourcePath);
		return { head: git("rev-parse", "HEAD"), gitState: dirty ? "uncommitted changes or untracked" : "no changes" };
	} catch {
		let head = "unknown";
		try { head = git("rev-parse", "HEAD"); } catch { /* keep unknown */ }
		return { head, gitState: "unknown (file is outside the repository)" };
	}
}

export function main(argv, { open = (file) => execFileSync("open", [file]), out = (s) => console.log(s) } = {}) {
	let sourcePath = join(ROOT, "BACKLOG.md");
	let outDir = join(homedir(), "Downloads");
	let noOpen = false;
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === "--no-open") noOpen = true;
		else if (argv[i] === "--source" && argv[i + 1]) sourcePath = resolve(argv[++i]);
		else if (argv[i] === "--out-dir" && argv[i + 1]) outDir = resolve(argv[++i]);
		else throw new Error(`Usage: npm run tasks -- [--no-open] [--source <markdown file>] [--out-dir <dir>]; unknown argument: ${argv[i]}`);
	}
	const now = new Date();
	const html = render(readFileSync(sourcePath, "utf8"), { sourcePath, ...gitFacts(sourcePath), refs: readRefs(), generatedAt: now.toISOString() });
	mkdirSync(outDir, { recursive: true });
	// A timestamped name and the exclusive flag never overwrite an existing file.
	const file = join(outDir, `task-report-${now.toISOString().replace(/[-:.]/g, "")}.html`);
	writeFileSync(file, html, { flag: "wx" });
	out(file);
	if (!noOpen) open(file);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	try { main(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exit(2); }
}
