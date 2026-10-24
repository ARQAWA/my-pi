// Repo-local macOS dev tool: renders BACKLOG.md (working-tree file) as one standalone, view-only HTML page.
// Deterministic, no model calls, no network. The source is untrusted data: raw HTML, images and
// non-http links are neutralised, and a CSP allows only the one inline script below.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Marked } from "marked";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESCAPES[c]);
const excerpt = (s, n) => { const chars = [...s.replace(/\s+/g, " ").trim()]; return chars.length > n ? `${chars.slice(0, n).join("")}...` : chars.join(""); };

const marked = new Marked({
	renderer: {
		html: ({ text }) => esc(text),
		image: ({ text }) => esc(text),
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

// Plain text of a cell for summaries: render safely, drop our own tags, decode our own escapes, then cut.
const plain = (cellText, n) => excerpt(marked.parseInline(cellText).replace(/<[^>]*>/g, "")
	.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&"), n);

// Tables are task lists: first column is the ID, other columns are shown under their header.
function renderTask(table, section) {
	const cells = (row) => row.map((c) => marked.parseInline(c.text.replace(/^<a id="[^"]*"><\/a>/, "")));
	const statusCol = table.header.findIndex((h) => /^status/i.test(h.text));
	return table.rows.map((row) => {
		const [id, work] = cells(row);
		const status = statusCol > 0 ? `<span class="status"> | ${esc(plain(row[statusCol].text, 100))}</span>` : "";
		const parts = cells(row).map((html, i) => (i === 0 ? "" : `<dt>${marked.parseInline(table.header[i].text)}</dt><dd>${html}</dd>`));
		return `<details class="task" data-section="${section}"><summary><strong>${id}</strong> ${esc(plain(row[1]?.text ?? "", 160))}${status}</summary><dl>${parts.join("")}</dl></details>`;
	}).join("\n");
}

export function render(src, { sourcePath, head, gitState, generatedAt }) {
	const sections = [];
	const body = [];
	const current = () => sections.at(-1) ?? (sections.push({ title: "(before first heading)", tasks: 0, blocks: 0 }), sections.at(-1));
	for (const token of marked.lexer(src)) {
		if (token.type === "space") continue;
		if (token.type === "heading") {
			sections.push({ title: token.text, tasks: 0, blocks: 0 });
			body.push(`<h2 class="head" id="sec-${sections.length - 1}" data-section="${sections.length - 1}">${marked.parseInline(token.text)}</h2>`);
			continue;
		}
		const section = current();
		const index = sections.length - 1;
		if (token.type === "table") {
			section.tasks += token.rows.length;
			body.push(renderTask(token, index));
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
<details id="overview"><summary>Sections (${sections.length})</summary><ul>${overview.join("")}</ul></details>
<p><input id="q" type="search" placeholder="Search tasks and text"> <select id="sec"><option value="">All sections</option>${options}</select> <span id="count"></span></p>
${body.join("\n")}
<details id="full-source"><summary>Full source, escaped</summary><pre id="source">${esc(src)}</pre></details>
<script>${SCRIPT}</script></body></html>
`;
}

const git = (...args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();

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
	let noOpen = false;
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === "--no-open") noOpen = true;
		else if (argv[i] === "--source" && argv[i + 1]) sourcePath = resolve(argv[++i]);
		else throw new Error(`Usage: npm run tasks -- [--no-open] [--source <markdown file>]; unknown argument: ${argv[i]}`);
	}
	const html = render(readFileSync(sourcePath, "utf8"), { sourcePath, ...gitFacts(sourcePath), generatedAt: new Date().toISOString() });
	const file = join(mkdtempSync(join(tmpdir(), "tasks-view-")), "tasks.html");
	writeFileSync(file, html);
	out(file);
	if (!noOpen) open(file);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	try { main(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exit(2); }
}
