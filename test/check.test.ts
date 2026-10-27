import assert from "node:assert/strict";
import { test } from "node:test";
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
  const jobs = [];
  assert.equal(await runCheck(["--test", "test/a*.test.ts", "test/b.test.ts", "--test", "test/c.test.ts"], async (name, args) => {
    jobs.push([name, args]);
    return 0;
  }), 0);
  assert.deepEqual(jobs, [
    ["lint", ["run", "lint"]],
    ["test", ["exec", "--", "node", "--test", "--experimental-test-isolation=none", "test/a*.test.ts", "test/b.test.ts", "test/c.test.ts"]],
  ]);
});

test("check rejects unsupported or incomplete options before starting jobs", async () => {
  for (const args of [["--typecheck"], ["--test"], ["--test", "--knip"]]) {
    await assert.rejects(runCheck(args, () => assert.fail("must not launch")), /Usage:/);
  }
});

test("check reports a rejected job after its sibling finishes", async () => {
  assert.equal(await runCheck([], async name => {
    if (name === "lint") throw new Error("launch failed");
    return 0;
  }), 1);
});
