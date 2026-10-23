// Shared format of the quality-control inbox (PROCESS.md, Quality control loop): one GitHub issue per failure
// signature, label `qa-inbox`. The bot (scripts/qa-inbox.mjs) owns the issue body; the digest (scripts/qa-digest.mjs)
// and the status snapshot (scripts/qa-status.mjs) only read it. The machine state sits in two HTML comments:
//
//   <!-- qa-signature: <sha1 hex> -->
//   <!-- qa-state:v1 <base64url of the JSON state> -->
//
// base64url keeps "--" and ">" of error texts out of the HTML comment. State v1:
//   v: 1
//   signature: sha1 hex of the signature key (scripts/qa-inbox.mjs)
//   kind: "test" (a TAP `not ok` leaf) | "process-exit" (a test file whose process died) | "job" (a failed job step
//         without a TAP failure: setup, npm ci, runner loss, timeout, a non-TAP workflow such as pcli)
//   workflow: workflow name ("tests", "pcli", "codex-oracle")
//   file, test, failureType, errorClass, code: string | null (kind test / process-exit)
//   jobFamily, step: string | null (kind job: job name without the matrix part, failed step name)
//   errorExcerpt: the first lines of the TAP error block
//   firstSeen, lastSeen: ISO time of the first and the latest occurrence
//   firstRunId: the run of the first occurrence
//   occurrences: [{ runId, attempt, job, sha, event, at, url, detail }], oldest first, capped at MAX_OCCURRENCES;
//                detail is the exit code or signal for process-exit
//   earlierRunIds: run ids of occurrences dropped by the cap, of every episode (kept on reopen); the rate counts
//                  only ids from firstRunId on, and the catch-up never reads a listed run again
//   lastGreenSha: head SHA of the latest successful main run of the workflow before firstSeen, or null
//   firstRedSha: head SHA of the first run with this signature
//   history: { lines, note }: `git log --format='%h %s' lastGreen..firstRed`, or a note when the SHAs are equal
//   rate: { k, n }: completed scheduled main runs of the workflow since firstSeen that do not contain the fix yet (n)
//         and those with the signature (k)
//   fix: null | { sha, subject, at }: the main commit whose message has the trailer `QA: #<issue number>`
//   greenAfterFix: scheduled first-attempt successes containing the fix, in a row; an occurrence resets it to 0
//   needGreen: greens required before the bot closes the issue: max(6, ceil(3 / (k / n)))
//   closeNote: why and when the bot closed the issue

export const STATE_VERSION = 1;
export const MAX_OCCURRENCES = 50;
export const INBOX_LABEL = "qa-inbox";
// Workflows whose main runs feed the inbox. codex-oracle joins when its file lands on main with a schedule.
export const QA_WORKFLOWS = ["tests", "pcli", "codex-oracle"];

export const LABELS = {
	"qa-inbox": { color: "b60205", description: "Quality-control inbox: one failure signature of a main run" },
	"qa:new": { color: "d93f0b", description: "QA: not triaged yet" },
	"qa:triaged": { color: "fbca04", description: "QA: triaged, class recorded in the issue" },
	"qa:fix-merged": { color: "0e8a16", description: "QA: a QA: #N fix is on main, waiting for green scheduled runs" },
	"qa:persistent": { color: "5319e7", description: "QA: failed on every scheduled run since first seen" },
	"qa:intermittent": { color: "c5def5", description: "QA: failed on some scheduled runs only" },
	"qa:infra": { color: "bfdadc", description: "QA: failed in setup or runner infrastructure, not in a test" },
	"qa:claimed": { color: "1d76db", description: "QA: an agent works on this issue on its claimed branch" },
	"qa:regressed": { color: "e99695", description: "QA: a closed signature occurred again" },
};

const SIGNATURE_RE = /<!--\s*qa-signature:\s*([0-9a-f]{7,64})\s*-->/;
const STATE_RE = /<!--\s*qa-state:v(\d+)\s+([A-Za-z0-9_-]+)\s*-->/;

export function encodeState(state) {
	const payload = Buffer.from(JSON.stringify({ ...state, v: STATE_VERSION }), "utf8").toString("base64url");
	return `<!-- qa-signature: ${state.signature} -->\n<!-- qa-state:v${STATE_VERSION} ${payload} -->`;
}

// The state of an issue body, or null when the body carries none or an unknown version.
export function decodeState(body) {
	const m = STATE_RE.exec(body ?? "");
	if (!m || Number(m[1]) !== STATE_VERSION) return null;
	try {
		const state = JSON.parse(Buffer.from(m[2], "base64url").toString("utf8"));
		return state && typeof state === "object" && state.v === STATE_VERSION ? state : null;
	} catch {
		return null;
	}
}

export function signatureOf(body) {
	return SIGNATURE_RE.exec(body ?? "")?.[1] ?? null;
}

export function needGreen({ k, n }) {
	if (!n || !k) return 6;
	return Math.max(6, Math.ceil(3 / (k / n)));
}

// ---------------------------------------------------------------------------------------------------------------
// Claims (PROCESS.md, Quality control loop): an agent claims an inbox issue before triage, so two agents never work
// on one issue. The label `qa:claimed` is the contract: while it is on the issue, nobody claims it again, not even
// the same branch, and a stale claim is never taken over automatically (status shows it red; the coordinator decides).
// The visible record is a machine-readable comment (`qa-claim:v1 {...}`). The only atomic step is the create-only
// ref `refs/qa-claims/<issue>`: creating an existing ref fails, so concurrent helpers cannot both claim. The ref
// points at a commit whose message repeats the record, the fallback when the comment is missing. A claim whose
// record is missing or unreadable is still a claim: its branch and time are unknown and nothing is invented.

export const CLAIM_LABEL = "qa:claimed";
export const CLAIM_STALE_MS = 24 * 3600_000;
export const CLAIM_REF_PREFIX = "qa-claims/";
export const BRANCH_RE = /^(?!.*\.\.)[\w][\w./-]*$/;
const CLAIM_MARK_RE = /qa-claim:v1 (\{[^\n<>]*\})/;

export const claimRefName = (number) => `${CLAIM_REF_PREFIX}${number}`;
// A missing or malformed object is HTTP 404 or 422; anything else (auth, network, rate limit) is a real failure.
export const isMalformed = (e) => /\bHTTP (?:404|422)\b/.test(String(e?.message ?? e));

// The machine-readable record, used in the claim commit message and the issue comment.
export const encodeClaim = ({ number, branch, at }) => `qa-claim:v1 ${JSON.stringify({ number, branch, at })}`;

export function decodeClaim(text) {
	const m = CLAIM_MARK_RE.exec(text ?? "");
	if (!m) return null;
	try {
		const c = JSON.parse(m[1]);
		const ok = Number.isInteger(c.number) && BRANCH_RE.test(c.branch ?? "") && Number.isFinite(Date.parse(c.at));
		return ok ? { number: c.number, branch: c.branch, at: c.at } : null;
	} catch {
		return null;
	}
}

// Date of the newest commit on a branch of the repository, or null when the branch is not pushed or unreadable.
export async function branchCommitAt(api, branch) {
	try {
		const list = await api(`commits?sha=${encodeURIComponent(branch)}&per_page=1`);
		return list[0]?.commit?.committer?.date ?? null;
	} catch (e) {
		if (isMalformed(e)) return null;
		throw e;
	}
}

// Reads one object, or null when GitHub says it is missing or malformed. Other failures are thrown.
async function tryApi(api, endpoint) {
	try {
		return await api(endpoint);
	} catch (e) {
		if (isMalformed(e)) return null;
		throw e;
	}
}

// What is known about the claim of an open issue, or null when it is not claimed. api(endpoint): parsed JSON of
// repos/<repo>/<endpoint>. Claimed means: the label is on the issue, or the claim ref exists (a lost label).
// Returns { labeled, record: { number, branch, at } | null }. The current lock ref decides first: its commit holds
// the record of the current claim. Only without a readable ref record the newest valid claim comment is used,
// because comments of released claims stay in the issue. Comments are read oldest first, 100 per page, at most
// COMMENT_PAGES pages; a claim comment beyond them is not seen and the record stays unknown.
export const COMMENT_PAGES = 5;
export async function readClaim({ api, number, labeled }) {
	const fromComments = async () => {
		let newest = null;
		for (let page = 1; page <= COMMENT_PAGES; page++) {
			const comments = await tryApi(api, `issues/${number}/comments?per_page=100&page=${page}`);
			const list = Array.isArray(comments) ? comments : [];
			for (const c of list) {
				const rec = decodeClaim(c.body);
				if (rec && rec.number === number) newest = rec;
			}
			if (list.length < 100) break;
		}
		return newest;
	};
	const ref = await tryApi(api, `git/ref/${claimRefName(number)}`);
	const exists = Boolean(ref) && !Array.isArray(ref);
	if (!labeled && !exists) return null;
	let record = null;
	if (exists) {
		const sha = ref.object?.type === "commit" ? ref.object.sha : null;
		const commit = sha ? await tryApi(api, `git/commits/${sha}`) : null;
		const rec = decodeClaim(commit?.message);
		record = rec && rec.number === number ? rec : null;
	}
	return { labeled, record: record ?? (await fromComments()) };
}

// { kind: "unknown" } for a claim without a record, else { kind: "fresh" | "stale", branch, at, lastActivity }.
// Freshness: the later of the claim time and the newest commit on the claimed branch, so a branch that is not
// pushed yet is fresh for 24 hours after the claim.
export async function claimState({ api, claim, now = Date.now() }) {
	if (!claim.record) return { kind: "unknown" };
	const { branch, at } = claim.record;
	const pushed = await branchCommitAt(api, branch);
	const lastActivity = new Date(Math.max(Date.parse(at), pushed ? Date.parse(pushed) : 0)).toISOString();
	return { kind: now - Date.parse(lastActivity) > CLAIM_STALE_MS ? "stale" : "fresh", branch, at, lastActivity };
}

// Runs fn over items with at most `limit` calls in flight, keeping the order of the results.
export async function pool(items, limit, fn) {
	const out = new Array(items.length);
	let next = 0;
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
		while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
	}));
	return out;
}
