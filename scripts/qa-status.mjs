import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CLAIM_LABEL, CLAIM_REF_PREFIX, decodeState, INBOX_LABEL, readClaim, topClaimRefs } from "./qa-state.mjs";

// All children share one deadline; no retries or persistent polling.
export function run(command, args, options) {
	return new Promise((resolve, reject) => {
		const windowsGh = process.platform === "win32" && command === "gh";
		execFile(command, windowsGh ? args.map((a) => `"${a}"`) : args, { ...options, encoding: "utf8", maxBuffer: 4 * 1024 * 1024,
			shell: process.platform === "win32" && command === "gh" }, (error, stdout, stderr) => {
			if (error) reject(new Error(String(stderr || error.message).trim()));
			else resolve(stdout.trim());
		});
	});
}

const levelOf = (r) => r.status !== "completed" ? "pending"
	: r.conclusion === "success" ? "green"
	: ["failure", "timed_out", "startup_failure", "action_required"].includes(r.conclusion) ? "red" : "info";
const newest = (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id - a.id;
const runItem = (r, name) => ({ id: `run:${r.id}:${r.run_attempt ?? 1}`, level: levelOf(r),
	text: `${name}: ${r.status === "completed" ? r.conclusion : r.status} #${r.id} attempt ${r.run_attempt ?? 1}`, url: r.html_url });
const reason = (e) => String(e?.message ?? e).replace(/\s+/g, " ").slice(0, 400);

export async function snapshot({ cwd = process.cwd(), repo, run: execute = run } = {}) {
	const at = new Date().toISOString();
	const deadline = Date.now() + 15_000;
	const call = (cmd, args) => execute(cmd, args, { cwd, timeout: Math.max(1, Math.min(11_000, deadline - Date.now())) });
	try {
		if (!repo) {
			let remote = "";
			try { remote = await call("git", ["remote", "get-url", "origin"]); } catch { /* A checkout without origin uses the project default. */ }
			repo = /(?:github\.com[:/])([^/\s]+\/[^/\s]+?)(?:\.git)?$/.exec(remote)?.[1] ?? "ARQAWA/my-pi";
		}
		if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error("invalid repository name");
		const [branch, sha] = await Promise.all([
			call("git", ["rev-parse", "--abbrev-ref", "HEAD"]), call("git", ["rev-parse", "HEAD"]),
		]);
		if (!/^[0-9a-f]{40,64}$/.test(sha)) throw new Error("invalid local HEAD");
		const api = async (endpoint) => JSON.parse(await call("gh", ["api", `repos/${repo}/${endpoint}`]));
		const missingWorkflows = new Set();
		const runs = async (workflow, query) => {
			try {
				return (await api(`actions/workflows/${workflow}/runs?${query}`)).workflow_runs;
			} catch (e) {
				if (!/\bHTTP 404\b/.test(String(e?.message ?? e))) throw e;
				missingWorkflows.add(workflow);
				return [];
			}
		};
		// Fixed, shell-safe arguments also let Windows use the gh.cmd test shim.
		const mainRuns = (workflow) => Promise.all(["schedule", "workflow_dispatch"].map((event) =>
			runs(workflow, `branch=main&event=${event}&per_page=3`))).then((groups) => groups.flat()
			.filter((r) => r.head_branch === "main" && ["schedule", "workflow_dispatch"].includes(r.event)).sort(newest).slice(0, 3));
		const checkBranch = branch !== "main" && branch !== "HEAD";
		const [issues, claimRefs, tests, pcli, inbox, digest, branchRuns] = await Promise.all([
			api(`issues?state=open&labels=${INBOX_LABEL}&per_page=100`),
			api(`git/matching-refs/${CLAIM_REF_PREFIX}?per_page=100`),
			mainRuns("tests.yml"), mainRuns("pcli.yml"),
			runs("qa-inbox.yml", "per_page=1"), runs("qa-digest.yml", "per_page=1"),
			checkBranch ? runs("tests.yml", `head_sha=${sha}&per_page=100`) : [],
		]);
		if (claimRefs.length === 100) throw new Error("claim ref list reached its 100-item bound; status is incomplete");
		const tops = topClaimRefs(claimRefs);
		const items = await Promise.all(issues.filter((i) => !i.pull_request).map(async (i) => {
			const state = decodeState(i.body);
			const rate = state?.rate;
			const lastSeen = state?.lastSeen ?? i.updated_at;
			const labels = i.labels.map((l) => typeof l === "string" ? l : l.name);
			const text = `#${i.number} ${i.title} [${labels.join(", ")}] rate ${rate ? `${rate.k}/${rate.n}` : "unknown"}; lastSeen ${lastSeen ?? "unknown"}; occurrences ${state?.occurrences?.length ?? 0}`;
			const item = { id: `issue:${i.number}:${lastSeen}`, level: "red", url: i.html_url, text };
			// A claim (PROCESS.md, Quality control loop) decides from its ref, not from the label: the label is only a copy.
			const top = tops.get(i.number);
			if (!top) return labels.includes(CLAIM_LABEL) ? { ...item, text: `${text}; ${CLAIM_LABEL} without a claim record, treated as unclaimed` } : item;
			const claim = await readClaim({ api, number: i.number, top });
			if (claim.kind === "fresh") return { ...item, id: `claim:${i.number}:${claim.gen}`, level: "pending",
				text: `${text}; claimed, in progress: branch ${claim.branch} since ${claim.at}, last activity ${claim.lastActivity}` };
			if (claim.kind === "stale") return { ...item, id: `issue:${i.number}:${lastSeen}:stale-claim:${claim.gen}`,
				text: `${text}; stale claim: branch ${claim.branch} since ${claim.at} has no commit since ${claim.lastActivity} (over 24 h)` };
			return { ...item, text: `${text}; ${claim.why}, treated as unclaimed` };
		}));
		if (issues.length === 100) throw new Error("open issue list reached its 100-item bound; status is incomplete");
		for (const [name, workflow, list] of [["main tests", "tests.yml", tests], ["main pcli", "pcli.yml", pcli],
			["qa-inbox", "qa-inbox.yml", inbox], ["qa-digest", "qa-digest.yml", digest]]) {
			if (missingWorkflows.has(workflow)) {
				items.push({ id: `workflow:${workflow}:not-on-default`, level: "info",
					text: `${workflow}: not on the default branch yet`, url: "" });
				continue;
			}
			items.push(...list.map((r) => runItem(r, name)));
			if (!list.length) items.push({ id: `workflow:${name}:missing`, level: "info", text: `${name}: no runs`, url: "" });
		}
		if (checkBranch && !missingWorkflows.has("tests.yml")) {
			const latest = branchRuns.filter((r) => r.head_sha === sha && r.head_branch === branch).sort(newest)[0];
			const status = latest ? latest.status === "completed" ? latest.conclusion : latest.status : "missing";
			items.push({ id: `branch:${branch}:${sha}:${status}`, level: latest ? levelOf(latest) : "info",
				text: `branch ${branch} ${sha.slice(0, 7)} tests: ${status}`, url: latest?.html_url ?? `https://github.com/${repo}/actions/workflows/tests.yml` });
		}
		return { ok: true, at, items };
	} catch (e) {
		return { ok: false, at, items: [], error: `QA status unavailable: ${reason(e)}` };
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
