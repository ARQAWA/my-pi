import { spawn, spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** The whole run is killed after this many ms; one test fails after TEST_LIMIT_MS. */
export const RUN_LIMIT_MS = 120_000;
export const TEST_LIMIT_MS = 5_000;
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PI_PACKAGE = /^node_modules\/(@earendil-works\/[^/]+)$/;
const TEST_GLOBS = ["test/extensions/*/*.test.ts", "test/*.test.ts", "pcli-vscode/test/*.test.mjs"];

/** @typedef {{ npm: string[] } | { node: string[] }} Job */
/** @typedef {(name: string, job: Job) => Promise<number> | number} CheckRunner */

/** @param {string[]} paths */
export function testArgs(paths) {
  return ["--test", "--experimental-test-isolation=none", `--test-timeout=${TEST_LIMIT_MS}`, "--import=./scripts/test-watch.mjs",
    "--test-reporter=./scripts/test-reporter.mjs", ...(paths.length ? paths : TEST_GLOBS)];
}

/**
 * Every installed @earendil-works package must match package-lock.json; a symlinked node_modules passes when its versions match.
 * @param {string} root
 * @returns {string[]}
 */
export function checkDependencies(root) {
  const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
  const problems = [];
  for (const [path, { version: wanted }] of Object.entries(lock.packages)) {
    const name = PI_PACKAGE.exec(path)?.[1];
    if (!name) continue;
    let installed = "missing";
    try {
      installed = JSON.parse(readFileSync(join(root, "node_modules", name, "package.json"), "utf8")).version;
    } catch {}
    if (installed !== wanted) problems.push(`${name}: installed ${installed}, package-lock.json has ${wanted}`);
  }
  return problems;
}

/**
 * @param {string[]} args
 * @param {CheckRunner} run
 */
export async function runCheck(args, run) {
  const paths = [];
  let testsOnly = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--typecheck") continue;
    if (args[i] === "--tests-only") {
      testsOnly = true;
      continue;
    }
    if (args[i] !== "--test" || !args[i + 1] || args[i + 1].startsWith("--")) {
      throw new Error("Usage: npm run check -- [--typecheck] [--tests-only] [--test <path> ...]");
    }
    paths.push(args[++i]);
    while (i + 1 < args.length && !args[i + 1].startsWith("--")) paths.push(args[++i]);
  }
  const runTests = () => run("test", { node: testArgs(paths) });
  const jobs = testsOnly ? [runTests()] : [run("lint", { npm: ["run", "lint"] }), runTests(), run("typecheck", { npm: ["run", "typecheck"] })];
  const results = await Promise.allSettled(jobs);
  return results.every(result => result.status === "fulfilled" && result.value === 0) ? 0 : 1;
}

/**
 * npm sets npm_execpath only for scripts it starts; a direct `node scripts/check.mjs` falls back to npm on PATH.
 * @param {string[]} args
 * @param {NodeJS.ProcessEnv} env
 * @param {NodeJS.Platform} platform
 */
export function npmCommand(args, env, platform) {
  if (env.npm_execpath) return { command: process.execPath, args: [env.npm_execpath, ...args], shell: false };
  if (platform !== "win32") return { command: "npm", args, shell: false };
  // npm.cmd needs a shell, which joins arguments unquoted: keep each one whole.
  return { command: "npm", args: args.map(arg => /\s/.test(arg) ? `"${arg}"` : arg), shell: true };
}

/** The pid and every process below it, also those that left its process group. */
function processTree(pid) {
  const table = spawnSync("ps", ["-A", "-o", "pid=,ppid="], { encoding: "utf8" }).stdout ?? "";
  const rows = table.trim().split("\n").map(line => line.trim().split(/\s+/).map(Number));
  const found = [pid];
  for (const parent of found) found.push(...rows.filter(([, ppid]) => ppid === parent).map(([child]) => child));
  return found;
}

/** Kills the process and everything it started. */
export function killTree(pid, platform = process.platform) {
  if (platform === "win32") {
    spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" });
    return;
  }
  const tree = processTree(pid);
  for (const target of [-pid, ...tree]) {
    try {
      process.kill(target, "SIGKILL");
    } catch {}
  }
}

/** scripts/test-watch.mjs keeps this file current: `{ current: { file, name, at }, timedOut: [{ file, name }] }`. */
function readTestState(stateFile) {
  try {
    return JSON.parse(readFileSync(stateFile, "utf8"));
  } catch {
    return { timedOut: [] }; // not written yet, or caught mid-write
  }
}

function expiryReport(reason, stages, state, root) {
  const label = test => `  ${test.file ? relative(root, test.file) : "?"} > ${test.name}`;
  const lines = [`check: ${reason} The run was killed.`, `Stages still running: ${stages.join(", ")}`];
  if (state.current) lines.push("Test still running:", label(state.current));
  if (state.timedOut.length) lines.push(`Tests that timed out after ${TEST_LIMIT_MS / 1000} s (they may hold the process):`, ...state.timedOut.map(label));
  if (!state.current && !state.timedOut.length) lines.push("No test is running: lint, typecheck or a leftover handle keeps the run alive.");
  return lines.join("\n");
}

/**
 * Preflights the dependencies, runs the jobs and kills their whole process tree when the run passes limitMs.
 * @param {string[]} args
 * @param {{ root?: string, env?: NodeJS.ProcessEnv, platform?: NodeJS.Platform, launch?: typeof spawn, kill?: typeof killTree, limitMs?: number }} [world]
 */
export async function guardedCheck(args, { root = ROOT, env = process.env, platform = process.platform, launch = spawn, kill = killTree, limitMs = RUN_LIMIT_MS } = {}) {
  const problems = checkDependencies(root);
  if (problems.length) {
    console.error(`check: installed dependencies do not match package-lock.json. Run \`npm ci\`.\n${problems.map(p => `  ${p}`).join("\n")}`);
    return 1;
  }
  const logFile = join(tmpdir(), `rqw-check-${process.pid}.log`);
  /** @type {Map<string, import("node:child_process").ChildProcess>} */
  const running = new Map();
  const run = (name, job) => new Promise(resolve => {
    const { command, args: commandArgs, shell } = "npm" in job ? npmCommand(job.npm, env, platform) : { command: process.execPath, args: job.node, shell: false };
    const child = launch(command, commandArgs, { stdio: "inherit", shell, detached: platform !== "win32", env: { ...env, RQW_CHECK_LOG: logFile, RQW_TEST_LIMIT_MS: String(TEST_LIMIT_MS) } });
    running.set(name, child);
    child.on("error", error => {
      console.error(`${name}: ${error.message}`);
      running.delete(name);
      resolve(1);
    });
    child.on("close", code => {
      running.delete(name);
      resolve(code ?? 1);
    });
  });
  const killAll = () => running.forEach(child => kill(child.pid, platform));
  const onSignal = () => {
    killAll();
    process.exit(1);
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  let timer;
  let watcher;
  // Resolves with the reason. The node test timeout cannot stop a test that blocks its own event loop, so watch from outside:
  // every test ends within the test limit, so one that has run longer blocks the process.
  // (A timed-out test whose leftovers keep the process alive is left to the run limit.)
  const expired = new Promise(resolve => {
    timer = setTimeout(resolve, limitMs, `the run took longer than ${limitMs / 1000} s.`);
    watcher = setInterval(() => {
      const { current } = readTestState(logFile);
      if (current && Date.now() - current.at > TEST_LIMIT_MS + 1000) {
        resolve(`a test ran longer than ${TEST_LIMIT_MS / 1000} s without ending, so it blocks the process.`);
      }
    }, 1000);
  });
  try {
    const result = await Promise.race([runCheck(args, run), expired]);
    if (typeof result === "number") return result;
    console.error(expiryReport(result, [...running.keys()], readTestState(logFile), root));
    killAll();
    return 1;
  } finally {
    clearTimeout(timer);
    clearInterval(watcher);
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    try {
      rmSync(logFile, { force: true });
    } catch {} // Windows may still hold the log of a just-killed test process
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = await guardedCheck(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
