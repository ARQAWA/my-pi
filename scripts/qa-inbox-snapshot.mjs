// The gh reads behind `npm run ci-watch -- --refresh-inbox` that only GitHub can give: which failed main runs a closed
// qa-inbox issue fully covers. The runs come from the watcher file status.json, never from a gh run listing.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectRunFailures, FAILED_RUN, occKey, signature, signatureKey, tapFiles } from "./qa-inbox.mjs";
import { decodeState, INBOX_LABEL } from "./qa-state.mjs";
import { levelOf, MAIN_WORKFLOWS, mainRuns } from "./qa-runs.mjs";

// A failed main run counts as acknowledged only when every failure signature of it, read the way qa-inbox reads
// it (collectRunFailures), is an occurrence (run, attempt, job) of that signature in a closed inbox issue, and no
// open issue records that occurrence. An empty failure list acknowledges nothing.
export function acknowledgedBy(run, failures, closed, open) {
	if (!run.name || !failures.length) return null;
	const numbers = new Set();
	for (const { failure, occurrence } of failures) {
		const sig = signature(signatureKey(failure, run.name));
		const key = occKey(occurrence);
		const records = (list) => list.filter((c) => c.state.signature === sig && (c.state.occurrences ?? []).some((o) => occKey(o) === key));
		const hit = records(closed)[0];
		if (!hit || records(open).length) return null;
		numbers.add(hit.number);
	}
	return [...numbers].sort((a, b) => a - b);
}

// Pages of a closed-issue list: one read per page of 100, at most five pages.
async function closedIssues(api) {
	const closed = [];
	for (let n = 1; ; n++) {
		if (n > 5) throw new Error("closed issue list reached its page bound");
		const issues = await api(`issues?state=closed&labels=${INBOX_LABEL}&per_page=100&page=${n}`);
		for (const i of issues) {
			const state = i.pull_request ? null : decodeState(i.body);
			if (state) closed.push({ number: i.number, state });
		}
		if (issues.length < 100) return closed;
	}
}

async function pages(api, path, field) {
	const all = [];
	for (let n = 1; n <= 10; n++) {
		const items = (await api(`${path}?per_page=100&page=${n}`))[field] ?? [];
		all.push(...items);
		if (items.length < 100) return all;
	}
	throw new Error(`${path} reached its page bound`);
}

// Returns [{ runId, attempt, numbers }]. Best effort per run: unreadable evidence leaves the run unacknowledged.
// The closed-issue list is read only when a failed main run exists, and evidence only of runs some closed issue records.
// api(endpoint): parsed JSON of repos/<repo>/<endpoint>; download(runId, artifactName, dir): gh run download.
export async function acknowledgements({ repo, runs, openIssues, api, download }) {
	const failed = MAIN_WORKFLOWS.flatMap(([, workflow]) => mainRuns(runs, workflow))
		.filter((r) => levelOf(r) === "red" && FAILED_RUN.has(r.conclusion));
	if (!failed.length) return [];
	const closed = await closedIssues(api);
	const open = openIssues.filter((i) => !i.pull_request).map((i) => ({ number: i.number, state: decodeState(i.body) })).filter((i) => i.state);
	const tmp = mkdtempSync(join(tmpdir(), "qa-inbox-snapshot-"));
	const result = [];
	try {
		for (const run of failed) {
			if (!closed.some((c) => (c.state.occurrences ?? []).some((o) => o.runId === run.id))) continue;
			try {
				const failures = await collectRunFailures({ repo, run, io: {
					jobs: (n) => pages(api, `actions/runs/${run.id}/attempts/${n}/jobs`, "jobs"),
					artifacts: () => pages(api, `actions/runs/${run.id}/artifacts`, "artifacts"),
					async tapTexts(art) {
						const dir = join(tmp, `${run.id}-${art.name}`);
						await download(run.id, art.name, dir);
						return tapFiles(dir).map((file) => readFileSync(file, "utf8"));
					},
				} });
				const numbers = acknowledgedBy(run, failures, closed, open);
				if (numbers) result.push({ runId: run.id, attempt: run.run_attempt ?? 1, numbers });
			} catch { /* this run stays red */ }
		}
	} finally {
		rmSync(tmp, { recursive: true, force: true });
	}
	return result;
}
