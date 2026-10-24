import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { describe, it } from "node:test";
import { acknowledgements } from "../scripts/qa-inbox-snapshot.mjs";
import { encodeState } from "../scripts/qa-state.mjs";
import { parseTap, signature, signatureKey } from "../scripts/qa-inbox.mjs";

const JOB = "test (macos-latest, node 24)";
const ART = "test-evidence-macos-latest-node24-attempt1";
const failingTap = (...names: string[]) => `TAP version 13\n${names.map((name, i) => `# Subtest: ${name}
not ok ${i + 1} - ${name}
  ---
  duration_ms: 1
  type: 'test'
  location: '/Users/runner/work/my-pi/my-pi/test/zz-${name}.test.ts:3:1'
  failureType: 'testCodeFailure'
  error: |-
    boom
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  ...
`).join("")}1..${names.length}\n`;
const tapSig = (text: string, i: number) => signature(signatureKey(parseTap(text)[i], "tests"));
const run = (id: number, extra = {}) => ({ id, name: "tests", path: ".github/workflows/tests.yml", run_attempt: 1, head_branch: "main",
	head_sha: "a".repeat(40), event: "workflow_dispatch", status: "completed", conclusion: "failure",
	created_at: "2026-10-23T00:00:00Z", html_url: `https://github.com/o/r/actions/runs/${id}`, ...extra });
const issueOf = (number: number, state: string, sig: string, runIds: number[], job = JOB) => ({ number, state, title: `[qa] tests: ${sig}`,
	labels: [{ name: "qa-inbox" }], html_url: `https://github.com/o/r/issues/${number}`,
	body: encodeState({ signature: sig, workflow: "tests", lastSeen: "2026-10-23T01:00:00Z", rate: { k: 1, n: 1 },
		occurrences: runIds.map((id) => ({ runId: id, attempt: 1, job })) }) });
const jobRecord = (extra = {}) => ({ id: 1, name: JOB, conclusion: "failure", run_attempt: 1, steps: [], ...extra });

// A fake gh: issues by state, jobs, artifacts and TAP evidence per run.
function fake(data: { issues?: any[]; jobs?: any; taps?: Record<string, string>; downloadFails?: boolean }) {
	const calls: string[] = [];
	const api = async (endpoint: string) => {
		calls.push(endpoint);
		if (endpoint.startsWith("issues?")) {
			const params = new URLSearchParams(endpoint.split("?")[1]);
			return (data.issues ?? []).filter((i) => (i.state ?? "open") === params.get("state"));
		}
		const jobs = endpoint.match(/runs\/(\d+)\/attempts\/(\d+)\/jobs/);
		if (jobs) return { jobs: data.jobs?.[`${jobs[1]}:${jobs[2]}`] ?? [] };
		return { artifacts: Object.keys(data.taps ?? {}).map((name) => ({ name, expired: false })) };
	};
	const download = async (runId: number, name: string, dir: string) => {
		calls.push(`download ${runId}`);
		if (data.downloadFails) throw new Error("download failed");
		mkdirSync(dir, { recursive: true });
		writeFileSync(`${dir}/${name}.tap`, data.taps![name]);
	};
	const open = () => (data.issues ?? []).filter((i) => (i.state ?? "open") === "open");
	const go = (runs: any[]) => acknowledgements({ repo: "o/r", runs, openIssues: open(), api, download });
	return { go, calls };
}
const canary = failingTap("canary");
const evidence = (id: number, taps = canary) => ({ jobs: { [`${id}:1`]: [jobRecord()] }, taps: { [ART]: taps } });

describe("closed inbox issues acknowledge failed main runs", () => {
	it("acknowledges a run whose every failure signature is an occurrence of a closed issue", async () => {
		const f = fake({ issues: [issueOf(1, "closed", tapSig(canary, 0), [50])], ...evidence(50) });
		assert.deepEqual(await f.go([run(50)]), [{ runId: 50, attempt: 1, numbers: [1] }]);
	});
	it("covers a job-step signature without evidence the same way", async () => {
		const sig = signature(signatureKey({ kind: "job", jobFamily: "test", step: "Run npm test" }, "tests"));
		const f = fake({ issues: [issueOf(2, "closed", sig, [51])],
			jobs: { "51:1": [jobRecord({ steps: [{ number: 1, name: "Run npm test", conclusion: "failure" }] })] } });
		assert.deepEqual(await f.go([run(51)]), [{ runId: 51, attempt: 1, numbers: [2] }]);
	});
	it("does not acknowledge a partly covered run, another run or job, or a run an open issue records", async () => {
		const two = failingTap("canary", "other");
		assert.deepEqual(await fake({ issues: [issueOf(1, "closed", tapSig(two, 0), [52])], ...evidence(52, two) }).go([run(52)]), []);
		const sig = tapSig(canary, 0);
		for (const issue of [issueOf(1, "closed", sig, [49]), issueOf(1, "closed", sig, [53], "other job")]) {
			assert.deepEqual(await fake({ issues: [issue], ...evidence(53) }).go([run(53)]), []);
		}
		assert.deepEqual(await fake({ issues: [issueOf(3, "open", sig, [54]), issueOf(1, "closed", sig, [54])], ...evidence(54) }).go([run(54)]), []);
	});
	it("ignores qa-inbox runs, runs that are not failed main runs, and reads nothing without a failed main run", async () => {
		const sig = tapSig(canary, 0);
		const f = fake({ issues: [issueOf(1, "closed", sig, [70, 71, 72])], ...evidence(70) });
		const other = { path: ".github/workflows/qa-inbox.yml" };
		assert.deepEqual(await f.go([run(70, other), run(71, { head_branch: "task" }), run(72, { event: "push" }), run(73, { conclusion: "success" })]), []);
		assert.deepEqual(f.calls, []);
	});
	it("leaves a run red when evidence is unreadable, the run has no readable failure or the signature changed", async () => {
		const sig = tapSig(canary, 0);
		assert.deepEqual(await fake({ issues: [issueOf(1, "closed", sig, [55])], ...evidence(55), downloadFails: true }).go([run(55)]), []);
		assert.deepEqual(await fake({ issues: [issueOf(1, "closed", sig, [56])], ...evidence(56) }).go([run(56, { conclusion: "action_required" })]), []);
		assert.deepEqual(await fake({ issues: [issueOf(1, "closed", sig, [57])], ...evidence(57, failingTap("changed")) }).go([run(57)]), []);
	});
	it("reads evidence only of runs a closed issue records", async () => {
		const f = fake({ issues: [issueOf(1, "closed", tapSig(canary, 0), [58])], ...evidence(58) });
		const result = await f.go([run(58), run(59, { created_at: "2026-10-22T00:00:00Z" })]);
		assert.deepEqual(result.map((r: any) => r.runId), [58]);
		assert.ok(!f.calls.some((c) => /runs\/59\//.test(c)));
	});
});
