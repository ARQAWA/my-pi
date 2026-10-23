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
