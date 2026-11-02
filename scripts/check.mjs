import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

/** @typedef {(name: string, args: string[]) => Promise<number> | number} CheckRunner */

/**
 * @param {string[]} args
 * @param {CheckRunner} run
 */
export async function runCheck(args, run) {
  const paths = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--typecheck") continue;
    if (args[i] !== "--test" || !args[i + 1] || args[i + 1].startsWith("--")) {
      throw new Error("Usage: npm run check -- [--typecheck] [--test <path> ...]");
    }
    paths.push(args[++i]);
    while (i + 1 < args.length && !args[i + 1].startsWith("--")) paths.push(args[++i]);
  }
  const jobs = [run("lint", ["run", "lint"]), paths.length
    ? run("test", ["exec", "--", "node", "--test", "--experimental-test-isolation=none", "--test-reporter=./scripts/test-reporter.mjs", ...paths])
    : run("test", ["test"]),
  run("typecheck", ["run", "typecheck"])];
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

/**
 * @param {string} name
 * @param {string[]} args
 * @param {{ env?: NodeJS.ProcessEnv, platform?: NodeJS.Platform, launch?: typeof spawn }} [world]
 */
export function runNpm(name, args, { env = process.env, platform = process.platform, launch = spawn } = {}) {
  return new Promise(resolve => {
    const npm = npmCommand(args, env, platform);
    const child = launch(npm.command, npm.args, { stdio: "inherit", shell: npm.shell });
    child.on("error", error => {
      console.error(`${name}: ${error.message}`);
      resolve(1);
    });
    child.on("close", code => resolve(code ?? 1));
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = await runCheck(process.argv.slice(2), runNpm);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
