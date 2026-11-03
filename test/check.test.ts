import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { mock, test } from "node:test";
import { Worker } from "node:worker_threads";
import { EventEmitter } from "node:events";
import { checkDependencies, guardedCheck, killTree, npmCommand, runCheck, testArgs } from "../scripts/check.mjs";

const PI = "@earendil-works/pi-coding-agent";
const PI_AI = "@earendil-works/pi-ai";

/** A project folder whose lock wants `wanted` and whose node_modules holds `installed` (undefined: not installed). */
function fakeRoot(wanted: string, installed?: string) {
  const root = mkdtempSync(join(tmpdir(), "check-root-"));
  const packages: Record<string, { version: string }> = {};
  for (const name of [PI, PI_AI]) {
    packages[`node_modules/${name}`] = { version: wanted };
    if (installed === undefined) continue;
    mkdirSync(join(root, "node_modules", name), { recursive: true });
    writeFileSync(join(root, "node_modules", name, "package.json"), JSON.stringify({ version: installed }));
  }
  writeFileSync(join(root, "package-lock.json"), JSON.stringify({ packages }));
  return root;
}

type Launch = { command: string; args: string[]; options: { env: Record<string, string>; detached: boolean; shell: boolean } };

/** Fake spawn: records launches and closes each child with `code` (undefined: never closes). */
function fakeLaunch(launches: Launch[], code?: number) {
  let pid = 100;
  return ((command: string, args: string[], options: Launch["options"]) => {
    launches.push({ command, args, options });
    const child = Object.assign(new EventEmitter(), { pid: pid++ });
    if (code !== undefined) setImmediate(() => child.emit("close", code));
    return child;
  }) as never;
}

test("npm starts through npm_execpath when npm started check, else from PATH", () => {
  assert.deepEqual(npmCommand(["run", "lint"], { npm_execpath: "/npm-cli.js" }, "darwin"),
    { command: process.execPath, args: ["/npm-cli.js", "run", "lint"], shell: false });
  assert.deepEqual(npmCommand(["run", "typecheck"], {}, "darwin"), { command: "npm", args: ["run", "typecheck"], shell: false });
  assert.deepEqual(npmCommand(["test"], {}, "win32"), { command: "npm", args: ["test"], shell: true });
});

test("on Windows a direct start keeps an npm argument with spaces as one argument", () => {
  assert.deepEqual(npmCommand(["run", "my tests/a.test.ts"], {}, "win32"),
    { command: "npm", args: ["run", '"my tests/a.test.ts"'], shell: true });
});

test("check starts all jobs together and waits for all after a typecheck failure", async () => {
  const jobs = new Map();
  const result = runCheck([], (name, job) => new Promise(resolve => jobs.set(name, { job, resolve })));
  assert.deepEqual([...jobs].map(([name, { job }]) => [name, job]), [
    ["lint", { npm: ["run", "lint"] }], ["test", { node: testArgs([]) }], ["typecheck", { npm: ["run", "typecheck"] }],
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
  const jobs: [string, unknown][] = [];
  assert.equal(await runCheck(["--test", "test/a*.test.ts", "test/b.test.ts", "--test", "test/c.test.ts"], async (name, job) => {
    jobs.push([name, job]);
    return 0;
  }), 0);
  assert.deepEqual(jobs, [
    ["lint", { npm: ["run", "lint"] }],
    ["test", { node: testArgs(["test/a*.test.ts", "test/b.test.ts", "test/c.test.ts"]) }],
    ["typecheck", { npm: ["run", "typecheck"] }],
  ]);
  assert.deepEqual(testArgs(["test/a*.test.ts", "test/b.test.ts", "test/c.test.ts"]).slice(-3), ["test/a*.test.ts", "test/b.test.ts", "test/c.test.ts"]);
});

test("the default test run covers every test folder of the repository", () => {
  assert.deepEqual(testArgs([]).slice(-3), ["test/extensions/*/*.test.ts", "test/*.test.ts", "pcli-vscode/test/*.test.mjs"]);
});

test("check accepts the typecheck flag without running it twice", async () => {
  const names: string[] = [];
  assert.equal(await runCheck(["--typecheck"], async name => {
    names.push(name);
    return 0;
  }), 0);
  assert.deepEqual(names, ["lint", "test", "typecheck"]);
});

test("tests-only runs just the tests, which is what npm test does", async () => {
  const names: string[] = [];
  assert.equal(await runCheck(["--tests-only"], async name => {
    names.push(name);
    return 0;
  }), 0);
  assert.deepEqual(names, ["test"]);
  const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(manifest.scripts.test, "node scripts/check.mjs --tests-only");
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

test("the test job gives each test 5 s, runs node directly and a failing exit fails the run", async () => {
  const launches: Launch[] = [];
  const code = await guardedCheck(["--tests-only"], { root: fakeRoot("1.5.0", "1.5.0"), env: {}, platform: "darwin", launch: fakeLaunch(launches, 3) });
  assert.equal(code, 1);
  assert.equal(launches.length, 1);
  assert.equal(launches[0].command, process.execPath);
  assert.ok(launches[0].args.includes("--test-timeout=5000"));
  assert.ok(launches[0].args.includes("--test-reporter=./scripts/test-reporter.mjs"));
  assert.equal(launches[0].options.detached, true);
  assert.match(launches[0].options.env.RQW_CHECK_LOG, /rqw-check-/);
  assert.equal(launches[0].options.env.RQW_TEST_LIMIT_MS, "5000");
});

test("lint and typecheck start through npm and a clean run exits 0", async () => {
  const launches: Launch[] = [];
  assert.equal(await guardedCheck([], { root: fakeRoot("1.5.0", "1.5.0"), env: {}, platform: "darwin", launch: fakeLaunch(launches, 0) }), 0);
  assert.deepEqual(launches.map(l => [l.command, l.args[0]]), [["npm", "run"], [process.execPath, "--test"], ["npm", "run"]]);
});

test("dependencies that match package-lock.json pass, also through a symlinked node_modules", () => {
  assert.deepEqual(checkDependencies(fakeRoot("1.5.0", "1.5.0")), []);
  const real = fakeRoot("1.5.0", "1.5.0");
  const linked = fakeRoot("1.5.0");
  symlinkSync(join(real, "node_modules"), join(linked, "node_modules"), "junction");
  assert.deepEqual(checkDependencies(linked), []);
});

test("stale or missing dependencies are named with both versions, also behind a symlink", () => {
  assert.deepEqual(checkDependencies(fakeRoot("1.5.0", "1.4.0")), [
    `${PI}: installed 1.4.0, package-lock.json has 1.5.0`, `${PI_AI}: installed 1.4.0, package-lock.json has 1.5.0`,
  ]);
  assert.match(checkDependencies(fakeRoot("1.5.0"))[0], /installed missing, package-lock.json has 1.5.0/);
  const stale = fakeRoot("1.5.0", "1.4.0");
  const linked = fakeRoot("1.5.0");
  symlinkSync(join(stale, "node_modules"), join(linked, "node_modules"), "junction");
  assert.equal(checkDependencies(linked).length, 2);
});

test("every @earendil-works package of the lock is checked, not only the main two", () => {
  const root = fakeRoot("1.5.0", "1.5.0");
  const lockPath = join(root, "package-lock.json");
  const lock = JSON.parse(readFileSync(lockPath, "utf8"));
  lock.packages["node_modules/@earendil-works/pi-tui"] = { version: "1.5.0" };
  writeFileSync(lockPath, JSON.stringify(lock));
  assert.deepEqual(checkDependencies(root), ["@earendil-works/pi-tui: installed missing, package-lock.json has 1.5.0"]);
});

test("a stale install fails before any job starts and says to run npm ci", async () => {
  const errors = mock.method(console, "error", () => {});
  const launches: Launch[] = [];
  try {
    assert.equal(await guardedCheck([], { root: fakeRoot("1.5.0", "1.4.0"), launch: fakeLaunch(launches, 0) }), 1);
    assert.equal(launches.length, 0);
    assert.match(String(errors.mock.calls[0].arguments[0]), /npm ci[\s\S]*installed 1\.4\.0, package-lock\.json has 1\.5\.0/);
  } finally {
    errors.mock.restore();
  }
});

/** Runs guardedCheck with fake timers; the fake test job writes `state` where the reporter would. Returns the kills and the error text. */
async function runUntilKilled(state: (file: string) => unknown, ticks: number[]) {
  // Only the last tick may end the run: the earlier ones must leave it alive.
  const errors = mock.method(console, "error", () => {});
  mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const killed: number[] = [];
  const root = fakeRoot("1.5.0", "1.5.0");
  const launch = fakeLaunch([]);
  try {
    const result = guardedCheck([], {
      root, platform: "darwin", kill: pid => killed.push(pid),
      launch: ((command: string, args: string[], options: Launch["options"]) => {
        if (args[0] === "--test") writeFileSync(options.env.RQW_CHECK_LOG, JSON.stringify(state(join(root, "test", "a.test.ts"))));
        return (launch as Function)(command, args, options);
      }) as never,
    });
    for (const [i, ms] of ticks.entries()) {
      mock.timers.tick(ms);
      await new Promise(resolve => setImmediate(resolve));
      if (i < ticks.length - 1) assert.deepEqual(killed, []);
    }
    assert.equal(await result, 1);
    return { killed, message: String(errors.mock.calls[0].arguments[0]) };
  } finally {
    mock.timers.reset();
    errors.mock.restore();
  }
}

test("the run is killed at the deadline and the error names the running and timed-out tests", async () => {
  const { killed, message } = await runUntilKilled(file => ({
    current: { file, name: "stuck test", at: Date.now() },
    timedOut: [{ file, name: "old" }],
  }), [119_999, 1]);
  assert.deepEqual(killed, [100, 101, 102]);
  assert.match(message, /the run took longer than 120 s\. The run was killed/);
  assert.match(message, /Stages still running: lint, test, typecheck/);
  assert.match(message, /Test still running:\n {2}test[\\/]a\.test\.ts > stuck test\n/);
  assert.match(message, /timed out after 5 s[^\n]*\n {2}test[\\/]a\.test\.ts > old$/);
});

test("a test that blocks its own event loop past 5 s is killed early and named", async () => {
  const { killed, message } = await runUntilKilled(file => ({
    current: { file, name: "spins forever", at: Date.now() - 7000 },
    timedOut: [],
  }), [1000]);
  assert.deepEqual(killed, [100, 101, 102]);
  assert.match(message, /a test ran longer than 5 s without ending/);
  assert.match(message, /Test still running:\n[^\n]*> spins forever/);
});

test("a test that has just started is not mistaken for a blocked test", async () => {
  const { message } = await runUntilKilled(file => ({ current: { file, name: "quick", at: Date.now() }, timedOut: [] }), [60_000, 60_000]);
  assert.match(message, /the run took longer than 120 s/);
});

test("killTree ends a child and the process it started", async () => {
  const code = "const { spawn } = require('node:child_process');"
    + "const g = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', detached: process.platform !== 'win32' });"
    + "console.log(g.pid); setInterval(() => {}, 1000);";
  const child = spawn(process.execPath, ["-e", code], { detached: process.platform !== "win32", stdio: ["ignore", "pipe", "ignore"] });
  const grandchild = Number(await new Promise<string>(resolve => child.stdout.once("data", chunk => resolve(String(chunk)))));
  const closed = new Promise(resolve => child.once("close", resolve));
  const alive = () => {
    try {
      process.kill(grandchild, 0);
      return true;
    } catch {
      return false;
    }
  };
  try {
    killTree(child.pid!);
    await closed;
    for (let i = 0; i < 100 && alive(); i++) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(alive(), false);
  } finally {
    // a broken killTree must not leave these running
    for (const pid of [child.pid!, grandchild]) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {}
    }
  }
});

function runReporter(fixture: string): Promise<{ output: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    // No inherited node flags or RQW_CHECK_LOG: the reporter under test must not touch this run's state file.
    const worker = new Worker(new URL("./fixtures/reporter-worker.mjs", import.meta.url), { workerData: fixture, execArgv: [], env: {} });
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
  assert.ok(testArgs([]).includes("--test-reporter=./scripts/test-reporter.mjs"));
  const result = await runReporter("./failing-after.mjs");
  assert.match(result.output, /cleanup failed/);
  assert.equal(result.exitCode, 1);
});

test("a passing test leaves the test process successful", async () => {
  const result = await runReporter("./passing.mjs");
  assert.match(result.output, /passing test/);
  assert.equal(result.exitCode, 0);
});

/** Runs a fixture in a real node test process with the watch preload; calls `until` with the state file text until it returns true. */
async function watchFixture(fixture: string, until: (state: any) => boolean) {
  const stateFile = join(mkdtempSync(join(tmpdir(), "check-watch-")), "state.json");
  const args = testArgs([fileURLToPath(new URL(fixture, import.meta.url))]).map(arg => arg.replace("--test-timeout=5000", "--test-timeout=100"));
  const env = { ...process.env, RQW_CHECK_LOG: stateFile, RQW_TEST_LIMIT_MS: "5000", NODE_TEST_CONTEXT: undefined }; // this run's context must not leak in
  const child = spawn(process.execPath, args, { cwd: fileURLToPath(new URL("..", import.meta.url)), env, stdio: "ignore" });
  const closed = new Promise(resolve => child.once("close", resolve));
  try {
    for (let i = 0; i < 500; i++) {
      try {
        const state = JSON.parse(readFileSync(stateFile, "utf8"));
        if (until(state)) return state;
      } catch {} // not written yet, or caught mid-write
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    return assert.fail("the watch file never reached the expected state");
  } finally {
    child.kill("SIGKILL"); // the test runner handles SIGTERM in JavaScript, which a spinning test never runs
    await closed;
  }
}

test("the watch file names a test that times out", async () => {
  const state = await watchFixture("./fixtures/timing-out.mjs", s => s.timedOut.length === 1);
  assert.match(state.timedOut[0].file, /timing-out\.mjs$/);
  assert.equal(state.timedOut[0].name, "held forever");
});

test("the watch file names a test that blocks its event loop", async () => {
  const state = await watchFixture("./fixtures/spinning.mjs", s => s.current?.name === "spins forever");
  assert.match(state.current.file, /spinning\.mjs$/);
  assert.deepEqual(state.timedOut, []);
});

test("the watch file keeps the parent test named after a nested test ends", async () => {
  const state = await watchFixture("./fixtures/nested.mjs", s => s.current?.name === "parent" && s.current.at < Date.now() - 100);
  assert.match(state.current.file, /nested\.mjs$/);
});

/** Runs a fixture to the end in a real node test process with the watch preload and a 100 ms test limit. */
function runWatched(fixture: string) {
  const env = { ...process.env, RQW_CHECK_LOG: join(mkdtempSync(join(tmpdir(), "check-run-")), "state.json"), RQW_TEST_LIMIT_MS: "100", NODE_TEST_CONTEXT: undefined };
  const file = fileURLToPath(new URL(fixture, import.meta.url));
  return spawnSync(process.execPath, testArgs([file]), { cwd: fileURLToPath(new URL("..", import.meta.url)), env, encoding: "utf8", timeout: 20_000 });
}

test("a test that mocks the clock is not failed for its length", () => {
  assert.equal(runWatched("./fixtures/mocked-clock.mjs").status, 0);
});

test("a test that blocks past the limit and then returns fails by name", () => {
  const run = runWatched("./fixtures/slow.mjs");
  assert.equal(run.status, 1);
  assert.match(run.stdout, /\u2716 slow one/);
  assert.match(run.stdout, /\u2714 fast one/);
});
