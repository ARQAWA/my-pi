import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Worker } from "node:worker_threads";
import { runCheck } from "../scripts/check.mjs";

test("check starts lint and full tests together and waits for both after failure", async () => {
  const jobs = new Map();
  const result = runCheck([], (name, args) => new Promise(resolve => jobs.set(name, { args, resolve })));
  assert.deepEqual([...jobs].map(([name, job]) => [name, job.args]), [
    ["lint", ["run", "lint"]], ["test", ["test"]],
  ]);
  let finished = false;
  result.then(() => { finished = true; });
  jobs.get("lint").resolve(1);
  await Promise.resolve();
  assert.equal(finished, false);
  jobs.get("test").resolve(0);
  assert.equal(await result, 1);
});

test("check passes only requested test paths and accepts successful jobs", async () => {
  const jobs: [string, string[]][] = [];
  assert.equal(await runCheck(["--test", "test/a*.test.ts", "test/b.test.ts", "--test", "test/c.test.ts"], async (name, args) => {
    jobs.push([name, args]);
    return 0;
  }), 0);
  assert.deepEqual(jobs, [
    ["lint", ["run", "lint"]],
    ["test", ["exec", "--", "node", "--test", "--experimental-test-isolation=none", "--test-reporter=./scripts/test-reporter.mjs", "test/a*.test.ts", "test/b.test.ts", "test/c.test.ts"]],
  ]);
});

test("check adds typecheck only when requested", async () => {
  const jobs: [string, string[]][] = [];
  assert.equal(await runCheck(["--typecheck"], async (name, args) => {
    jobs.push([name, args]);
    return 0;
  }), 0);
  assert.deepEqual(jobs, [
    ["lint", ["run", "lint"]],
    ["test", ["test"]],
    ["typecheck", ["run", "typecheck"]],
  ]);
});

test("check rejects unsupported or incomplete options before starting jobs", async () => {
  for (const args of [["--unknown"], ["--test"], ["--test", "--knip"]]) {
    await assert.rejects(runCheck(args, () => assert.fail("must not launch")), /Usage:/);
  }
});

test("check fails when the test job fails", async () => {
  assert.equal(await runCheck([], async name => name === "test" ? 1 : 0), 1);
});

test("check reports a rejected job after its sibling finishes", async () => {
  assert.equal(await runCheck([], async name => {
    if (name === "lint") throw new Error("launch failed");
    return 0;
  }), 1);
});

function runReporter(fixture: string): Promise<{ output: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./fixtures/reporter-worker.mjs", import.meta.url), { workerData: fixture });
    let result: { output: string; exitCode: number } | undefined;
    worker.once("message", message => { result = message; });
    worker.once("error", reject);
    worker.once("exit", code => {
      if (!result || code !== result.exitCode) reject(new Error(`worker exited with ${code}`));
      else resolve(result);
    });
  });
}

test("a failing root after hook makes the test process fail", async () => {
  const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.match(manifest.scripts.test, /(?:^|\s)--test-reporter=\.\/scripts\/test-reporter\.mjs(?:\s|$)/);
  const result = await runReporter("./failing-after.mjs");
  assert.match(result.output, /cleanup failed/);
  assert.equal(result.exitCode, 1);
});

test("a passing test leaves the test process successful", async () => {
  const result = await runReporter("./passing.mjs");
  assert.match(result.output, /passing test/);
  assert.equal(result.exitCode, 0);
});
