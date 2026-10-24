import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cacheDirectory, isFresh, readJson, run } from "./ci-watch.mjs";
import { levelOf, mainRuns, workflowRuns } from "./qa-runs.mjs";
export { run } from "./ci-watch.mjs";

const runItem = (r, name) => ({ id: `run:${r.id}:${r.run_attempt ?? 1}`, level: levelOf(r),
	text: `${name}: ${r.status === "completed" ? r.conclusion : r.status} #${r.id} attempt ${r.run_attempt ?? 1}`, url: r.html_url });
const reason = (e) => String(e?.message ?? e).replace(/\s+/g, " ").slice(0, 400);

// Readers never query GitHub. A bounded recent page is useful awareness, not merge proof.
export async function snapshot({ cwd = process.cwd(), repo, run: execute = run, now = Date.now, cachePath } = {}) {
	const at = new Date(now()).toISOString();
	const call = (cmd, args) => execute(cmd, args, { cwd, timeout: 11_000 });
	try {
		if (!repo) {
			const remote = await call("git", ["remote", "get-url", "origin"]);
			repo = /(?:github\.com[:/])([^/\s]+\/[^/\s]+?)(?:\.git)?$/.exec(remote)?.[1];
		}
		if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error("invalid repository name");
		const [branch, sha, dir] = await Promise.all([
			call("git", ["rev-parse", "--abbrev-ref", "HEAD"]), call("git", ["rev-parse", "HEAD"]),
			cachePath ? null : cacheDirectory(cwd, (cmd, args) => call(cmd, args)),
		]);
		if (!/^[0-9a-f]{40,64}$/.test(sha)) throw new Error("invalid local HEAD");
		const cached = JSON.parse(await readFile(cachePath ?? resolve(dir, "status.json"), "utf8"));
		if (cached.repo !== repo || !Array.isArray(cached.runs)) throw new Error("invalid watcher cache");
		if (!isFresh(cached, now())) throw new Error("watcher cache stale or missing successful fetch; restart with npm run ci-watch -- --restart");
		if (cached.error) throw new Error(`watcher fetch failed: ${cached.error}; restart with npm run ci-watch -- --restart`);
		const inbox = await readJson(resolve(cachePath ? dirname(cachePath) : dir, "inbox.json"));
		const validInbox = inbox?.version === 1 && inbox.repo === repo && Array.isArray(inbox.items);
		const items = validInbox ? [...inbox.items] : [];
		// Issues have their own explicit, on-demand fetch; run freshness never refreshes them.
		items.push({ id: "inbox:local-only", level: "info", text: validInbox
			? `QA inbox: local snapshot from ${inbox.fetchedAt}; not refreshed by ci-watch polling; refresh with npm run ci-watch -- --refresh-inbox`
			: "QA inbox: no local snapshot; not refreshed by ci-watch polling; run npm run ci-watch -- --refresh-inbox", url: "" });
		// A failed main run that closed inbox issues fully cover (computed by the explicit inbox refresh) is information.
		const acknowledged = new Map((validInbox && Array.isArray(inbox.acknowledged) ? inbox.acknowledged : [])
			.map((a) => [`${a.runId}:${a.attempt}`, a.numbers]));
		const acknowledge = (item, r) => {
			const numbers = acknowledged.get(`${r.id}:${r.run_attempt ?? 1}`);
			if (item.level !== "red" || !Array.isArray(numbers)) return item;
			return { ...item, level: "info", text: `${item.text}; acknowledged: every failure is in closed qa-inbox issue ${numbers.map((n) => `#${n}`).join(", ")}` };
		};
		for (const [name, workflow, mainOnly] of [["main tests", "tests.yml", true], ["main pcli", "pcli.yml", true],
			["qa-inbox", "qa-inbox.yml", false], ["qa-digest", "qa-digest.yml", false]]) {
			const list = mainOnly ? mainRuns(cached.runs, workflow) : workflowRuns(cached.runs, workflow).slice(0, 1);
			items.push(...list.map((r) => mainOnly ? acknowledge(runItem(r, name), r) : runItem(r, name)));
			if (!list.length) items.push({ id: `workflow:${name}:missing`, level: "info", text: `${name}: no runs in bounded cache`, url: "" });
		}
		if (branch !== "main" && branch !== "HEAD") {
			const latest = workflowRuns(cached.runs, "tests.yml").find((r) => r.head_sha === sha && r.head_branch === branch);
			const status = latest ? latest.status === "completed" ? latest.conclusion : latest.status : "missing";
			items.push({ id: `branch:${branch}:${sha}:${status}`, level: latest ? levelOf(latest) : "info",
				text: `branch ${branch} ${sha.slice(0, 7)} tests: ${status}${latest ? " (cached, not merge proof)" : " in bounded cache; not proof of success"}`,
				url: latest?.html_url ?? `https://github.com/${repo}/actions/workflows/tests.yml` });
		}
		return { ok: true, at: cached.fetchedAt, items };
	} catch (e) {
		return { ok: false, at, items: [], error: `QA status unavailable: ${reason(e)}${e.code === "ENOENT" ? "; start npm run ci-watch" : ""}` };
	}
}

export function render(state, { onlyIds } = {}) {
	if (!state.ok) return state.error ?? "QA status unavailable: unknown error";
	const selected = onlyIds ? new Set(onlyIds) : null;
	return state.items.filter((i) => !selected || selected.has(i.id))
		.map((i) => `${i.level.toUpperCase()} ${i.text}${i.url ? ` ${i.url}` : ""}`).join("\n") || "QA: no items";
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const state = await snapshot();
	console.log(process.argv.includes("--json") ? JSON.stringify(state, null, 2) : render(state));
}
