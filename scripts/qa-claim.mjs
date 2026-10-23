// `npm run qa-claim -- <issue number> <branch> [--repo owner/name]`: an agent claims an open qa-inbox issue before
// triage (PROCESS.md, Quality control loop). Exit 0: claimed. Exit 3: the issue is already claimed (label
// `qa:claimed`, whatever the branch, fresh or stale) or another helper won the race; do not start, report to the
// coordinator. Exit 1: error, nothing claimed. A stale claim is never taken over here.
// `npm run qa-claim -- --release <issue number>`: the coordinator frees a dead claim (ref first, then the label).
// Atomic part: the create-only ref `refs/qa-claims/<N>` (scripts/qa-state.mjs). The label and the comment are
// written afterwards and are not atomic; a failure of the comment is a warning, the label is the contract.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "./qa-status.mjs";
import { BRANCH_RE, CLAIM_LABEL, INBOX_LABEL, LABELS, claimRefName, claimState, encodeClaim, isMalformed, readClaim } from "./qa-state.mjs";

function context({ repo, cwd, execute }) {
	if (!/^[\w.-]+\/[\w.-]+$/.test(repo ?? "")) throw new Error(`bad repository: ${repo}`);
	const opts = { cwd, timeout: 30_000 };
	const tmp = mkdtempSync(join(tmpdir(), "qa-claim-"));
	const api = async (endpoint) => JSON.parse(await execute("gh", ["api", `repos/${repo}/${endpoint}`], opts));
	const send = async (method, endpoint, payload) => {
		const args = ["api", "-X", method, `repos/${repo}/${endpoint}`];
		if (payload) {
			const file = join(tmp, "payload.json");
			writeFileSync(file, JSON.stringify(payload));
			args.push("--input", file);
		}
		const out = await execute("gh", args, opts);
		return out ? JSON.parse(out) : null;
	};
	return { api, send, done: () => rmSync(tmp, { recursive: true, force: true }) };
}

async function openInboxIssue(api, number) {
	const issue = await api(`issues/${number}`);
	const labels = issue.labels.map((l) => typeof l === "string" ? l : l.name);
	if (issue.pull_request || issue.state !== "open" || !labels.includes(INBOX_LABEL)) throw new Error(`#${number} is not an open ${INBOX_LABEL} issue`);
	return labels;
}

// One line about the existing claim, for the agent that must not start.
async function describe({ api, number, labeled, now }) {
	const claim = await readClaim({ api, number, labeled });
	if (!claim) return "claimed";
	const c = await claimState({ api, claim, now });
	if (c.kind === "unknown") return "claimed, branch and time unknown (no readable claim record)";
	return `claimed by branch ${c.branch} since ${c.at}${c.kind === "stale" ? `; stale, no commit since ${c.lastActivity}` : ""}`;
}

export async function claim({ number, branch, repo, cwd = process.cwd(), run: execute = run, now = () => Date.now() }) {
	if (!Number.isInteger(number) || number < 1) throw new Error("issue number must be a positive integer");
	if (!BRANCH_RE.test(branch ?? "")) throw new Error(`bad branch name: ${branch}`);
	const { api, send, done } = context({ repo, cwd, execute });
	try {
		const labels = await openInboxIssue(api, number);
		if (labels.includes(CLAIM_LABEL)) return { claimed: false, why: `already ${await describe({ api, number, labeled: true, now: now() })}` };
		const at = new Date(now()).toISOString();
		const main = (await api("git/ref/heads/main")).object.sha;
		const tree = (await api(`git/commits/${main}`)).tree.sha;
		const record = encodeClaim({ number, branch, at });
		const commit = await send("POST", "git/commits", { message: `qa-claim #${number} ${branch}\n\n${record}\n`, tree, parents: [main] });
		try {
			await send("POST", "git/refs", { ref: `refs/${claimRefName(number)}`, sha: commit.sha });
		} catch (e) {
			if (!/Reference already exists/i.test(String(e?.message ?? e))) throw e;
			return { claimed: false, why: `lost the race or the claim is half written: ${await describe({ api, number, labeled: false, now: now() })}` };
		}
		const want = LABELS[CLAIM_LABEL];
		try { await send("POST", "labels", { name: CLAIM_LABEL, color: want.color, description: want.description }); }
		catch (e) { if (!/\bHTTP 422\b|already_exists/i.test(String(e?.message ?? e))) throw e; }
		await send("POST", `issues/${number}/labels`, { labels: [CLAIM_LABEL] });
		try {
			await send("POST", `issues/${number}/comments`, { body: `QA claim: branch \`${branch}\` since ${at} UTC.\n\n<!-- ${record} -->` });
		} catch (e) {
			console.log(`warning: the claim stands, but its comment failed: ${String(e?.message ?? e).slice(0, 300)}`);
		}
		return { claimed: true, why: `claimed #${number} for branch ${branch} at ${at}` };
	} finally {
		done();
	}
}

// Frees a claim: the lock ref first, so a half-released claim keeps blocking through its label, then the label.
export async function release({ number, repo, cwd = process.cwd(), run: execute = run }) {
	if (!Number.isInteger(number) || number < 1) throw new Error("issue number must be a positive integer");
	const { api, send, done } = context({ repo, cwd, execute });
	try {
		await openInboxIssue(api, number);
		const missingOk = async (endpoint) => { try { await send("DELETE", endpoint); } catch (e) { if (!isMalformed(e)) throw e; } };
		await missingOk(`git/refs/${claimRefName(number)}`);
		await missingOk(`issues/${number}/labels/${encodeURIComponent(CLAIM_LABEL)}`);
		return { released: true, why: `released #${number}` };
	} finally {
		done();
	}
}

export async function main(argv = process.argv.slice(2)) {
	const args = [];
	let repo, releasing = false;
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === "--repo") repo = argv[++i]; else if (argv[i] === "--release") releasing = true; else args.push(argv[i]);
	}
	if (args.length !== (releasing ? 1 : 2)) {
		console.error("usage: npm run qa-claim -- <issue number> <branch> [--repo owner/name]\n       npm run qa-claim -- --release <issue number> [--repo owner/name]");
		return 1;
	}
	try {
		if (!repo) {
			const remote = await run("git", ["remote", "get-url", "origin"], { timeout: 10_000 }).catch(() => "");
			repo = /(?:github\.com[:/])([^/\s]+\/[^/\s]+?)(?:\.git)?$/.exec(remote)?.[1] ?? "ARQAWA/my-pi";
		}
		if (releasing) {
			console.log((await release({ number: Number(args[0]), repo })).why);
			return 0;
		}
		const result = await claim({ number: Number(args[0]), branch: args[1], repo });
		console.log(result.claimed ? `CLAIMED ${result.why}` : `NOT CLAIMED ${result.why}. Do not start; report to the coordinator.`);
		return result.claimed ? 0 : 3;
	} catch (e) {
		console.error(`qa-claim failed, nothing changed or claimed: ${String(e?.message ?? e)}`);
		return 1;
	}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(await main());
