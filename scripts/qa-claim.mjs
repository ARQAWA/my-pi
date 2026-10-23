// `npm run qa-claim -- <issue number> <branch> [--repo owner/name]`: an agent claims an open qa-inbox issue before
// triage (PROCESS.md, Quality control loop). Exit 0: claimed (or already yours). Exit 3: another agent holds the
// claim or won the race; do not start, report to the coordinator. Exit 1: error, nothing claimed.
// Atomic part: the create-only ref `refs/qa-claims/<N>-<gen>` (scripts/qa-state.mjs). The label and the comment
// are written afterwards and are not atomic; a failure there is a warning, the claim stands.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "./qa-status.mjs";
import { BRANCH_RE, CLAIM_LABEL, CLAIM_REF_PREFIX, INBOX_LABEL, LABELS, claimRefName, encodeClaim, readClaim, topClaimRefs } from "./qa-state.mjs";

export async function claim({ number, branch, repo, cwd = process.cwd(), run: execute = run, now = () => Date.now() }) {
	if (!Number.isInteger(number) || number < 1) throw new Error("issue number must be a positive integer");
	if (!BRANCH_RE.test(branch ?? "")) throw new Error(`bad branch name: ${branch}`);
	if (!/^[\w.-]+\/[\w.-]+$/.test(repo ?? "")) throw new Error(`bad repository: ${repo}`);
	const opts = { cwd, timeout: 30_000 };
	const api = async (endpoint) => JSON.parse(await execute("gh", ["api", `repos/${repo}/${endpoint}`], opts));
	const tmp = mkdtempSync(join(tmpdir(), "qa-claim-"));
	const send = async (method, endpoint, payload) => {
		const file = join(tmp, "payload.json");
		writeFileSync(file, JSON.stringify(payload));
		const out = await execute("gh", ["api", "-X", method, `repos/${repo}/${endpoint}`, "--input", file], opts);
		return out ? JSON.parse(out) : null;
	};
	try {
		const issue = await api(`issues/${number}`);
		const labels = issue.labels.map((l) => typeof l === "string" ? l : l.name);
		if (issue.pull_request || issue.state !== "open" || !labels.includes(INBOX_LABEL)) {
			throw new Error(`#${number} is not an open ${INBOX_LABEL} issue`);
		}
		const top = topClaimRefs(await api(`git/matching-refs/${CLAIM_REF_PREFIX}${number}-`)).get(number);
		let gen = 1;
		if (top) {
			const state = await readClaim({ api, number, top, now: now() });
			if (state.kind === "fresh") {
				if (state.branch === branch) await finish(state, true);
				return { claimed: state.branch === branch, gen: state.gen, why: `already claimed by branch ${state.branch} since ${state.at}` };
			}
			gen = top.gen + 1;
			console.log(state.kind === "stale" ? `previous claim of ${state.branch} is stale (last activity ${state.lastActivity}); taking over as generation ${gen}`
				: `${state.why}; taking over as generation ${gen}`);
		} else if (labels.includes(CLAIM_LABEL)) {
			return { claimed: false, gen: 0, why: `${CLAIM_LABEL} is set without a claim record; remove the label if the claim is dead` };
		}
		const at = new Date(now()).toISOString();
		const main = (await api("git/ref/heads/main")).object.sha;
		const tree = (await api(`git/commits/${main}`)).tree.sha;
		const record = encodeClaim({ number, gen, branch, at });
		const commit = await send("POST", "git/commits", { message: `qa-claim #${number} ${branch}\n\n${record}\n`, tree, parents: [main] });
		try {
			await send("POST", "git/refs", { ref: `refs/${claimRefName(number, gen)}`, sha: commit.sha });
		} catch (e) {
			if (/Reference already exists/i.test(String(e?.message ?? e))) return { claimed: false, gen, why: `lost the race: another agent claimed generation ${gen} first` };
			throw e;
		}
		await finish({ gen, branch, at, record }, false);
		return { claimed: true, gen, why: `claimed #${number} for branch ${branch} at ${at} (generation ${gen})` };
	} finally {
		rmSync(tmp, { recursive: true, force: true });
	}

	// Visible copies: the label, and the comment only for a new claim. Failures are warnings, the ref decides.
	async function finish(state, repair) {
		try {
			const want = LABELS[CLAIM_LABEL];
			try { await send("POST", "labels", { name: CLAIM_LABEL, color: want.color, description: want.description }); }
			catch (e) { if (!/\bHTTP 422\b|already_exists/i.test(String(e?.message ?? e))) throw e; }
			await send("POST", `issues/${number}/labels`, { labels: [CLAIM_LABEL] });
			if (!repair) await send("POST", `issues/${number}/comments`, { body: `QA claim: branch \`${state.branch}\` since ${state.at} UTC.\n\n<!-- ${state.record} -->` });
		} catch (e) {
			console.log(`warning: the claim stands, but its label or comment failed: ${String(e?.message ?? e).slice(0, 300)}`);
		}
	}
}

export async function main(argv = process.argv.slice(2)) {
	const args = [];
	let repo;
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === "--repo") repo = argv[++i]; else args.push(argv[i]);
	}
	if (args.length !== 2) { console.error("usage: npm run qa-claim -- <issue number> <branch> [--repo owner/name]"); return 1; }
	try {
		if (!repo) {
			const remote = await run("git", ["remote", "get-url", "origin"], { timeout: 10_000 }).catch(() => "");
			repo = /(?:github\.com[:/])([^/\s]+\/[^/\s]+?)(?:\.git)?$/.exec(remote)?.[1] ?? "ARQAWA/my-pi";
		}
		const result = await claim({ number: Number(args[0]), branch: args[1], repo });
		console.log(result.claimed ? `CLAIMED ${result.why}` : `NOT CLAIMED ${result.why}. Do not start; report to the coordinator.`);
		return result.claimed ? 0 : 3;
	} catch (e) {
		console.error(`qa-claim failed, nothing claimed: ${String(e?.message ?? e)}`);
		return 1;
	}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(await main());
