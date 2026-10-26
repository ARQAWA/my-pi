import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, it } from "node:test";
import { INTERVAL_MS, poll } from "../scripts/ci-watch.mjs";

const dir = mkdtempSync(join(tmpdir(), "ci-watch-"));
after(() => rmSync(dir, { recursive: true, force: true }));

it("poll returns and stores one bounded page of workflow runs", async () => {
	const now = Date.parse("2026-10-23T01:00:00Z");
	const statusPath = join(dir, "status.json");
	const calls: unknown[] = [];
	const run = { id: 1, head_sha: "a".repeat(40), run_attempt: 2, conclusion: "success" };
	const state = await poll({ repo: "o/r", statusPath, now: () => now, execute: async (...args: unknown[]) => {
		calls.push(args);
		return JSON.stringify({ total_count: 101, workflow_runs: [run] });
	} });

	assert.deepEqual(calls, [["gh", ["api", "repos/o/r/actions/runs?per_page=100"], { signal: undefined }]]);
	assert.equal(state.fetchedAt, new Date(now).toISOString());
	assert.equal(state.nextAttemptAt, new Date(now + INTERVAL_MS).toISOString());
	assert.equal(state.bounded, true);
	assert.deepEqual(state.runs, [run]);
	assert.deepEqual(JSON.parse(readFileSync(statusPath, "utf8")), state);
});
