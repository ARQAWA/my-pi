import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Worker } from "node:worker_threads";
import { EventEmitter } from "node:events";
import { npmCommand, runCheck, runNpm } from "../scripts/check.mjs";

function fakeLaunch(calls: unknown[][], code: number) {
  return (command: string, args: string[], options: unknown) => {
    calls.push([command, args, options]);
    const child = new EventEmitter();
    setImmediate(() => child.emit("close", code));
    return child;
  };
}

test("a direct node start launches npm from PATH and reports its exit code", async () => {
  const calls: unknown[][] = [];
  assert.equal(await runNpm("typecheck", ["run", "typecheck"], { env: {}, platform: "darwin", launch: fakeLaunch(calls, 3) as never }), 3);
  assert.deepEqual(calls, [["npm", ["run", "typecheck"], { stdio: "inherit", shell: false }]]);
});

test("a start through npm launches node with npm_execpath", async () => {
  const calls: unknown[][] = [];
  assert.equal(await runNpm("lint", ["run", "lint"], { env: { npm_execpath: "/npm-cli.js" }, platform: "darwin", launch: fakeLaunch(calls, 0) as never }), 0);
  assert.deepEqual(calls, [[process.execPath, ["/npm-cli.js", "run", "lint"], { stdio: "inherit", shell: false }]]);
});

test("on Windows a direct start keeps a test path with spaces as one argument", () => {
  assert.deepEqual(npmCommand(["exec", "--", "node", "--test", "my tests/a.test.ts"], {}, "win32"),
    { command: "npm", args: ["exec", "--", "node", "--test", '"my tests/a.test.ts"'], shell: true });
});

test("check runs npm through npm_execpath when npm started it", () => {
  assert.deepEqual(npmCommand(["run", "lint"], { npm_execpath: "/npm-cli.js" }, "darwin"),
    { command: process.execPath, args: ["/npm-cli.js", "run", "lint"], shell: false });
});

test("check falls back to npm on PATH when started directly with node", () => {
  assert.deepEqual(npmCommand(["run", "typecheck"], {}, "darwin"), { command: "npm", args: ["run", "typecheck"], shell: false });
  assert.deepEqual(npmCommand(["test"], {}, "win32"), { command: "npm", args: ["test"], shell: true });
});

test("check starts all jobs together and waits for all after a typecheck failure", async () => {
  const jobs = new Map();
  const result = runCheck([], (name, args) => new Promise(resolve => jobs.set(name, { args, resolve })));
  assert.deepEqual([...jobs].map(([name, job]) => [name, job.args]), [
    ["lint", ["run", "lint"]], ["test", ["test"]], ["typecheck", ["run", "typecheck"]],
  ]);
  let finished = false;
  result.then(() => { finished = true; });
  jobs.get("typecheck").resolve(1);
  jobs.get("lint").resolve(0);
  await new Promise(resolve => setImmediate(resolve));
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
    ["typecheck", ["run", "typecheck"]],
  ]);
});

test("check accepts the typecheck flag without running it twice", async () => {
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

test("check fails when the lint job fails", async () => {
  assert.equal(await runCheck([], async name => name === "lint" ? 1 : 0), 1);
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
