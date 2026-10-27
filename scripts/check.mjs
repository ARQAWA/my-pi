import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

/** @typedef {(name: string, args: string[]) => Promise<number> | number} CheckRunner */

/**
 * @param {string[]} args
 * @param {CheckRunner} run
 */
export async function runCheck(args, run) {
  const paths = [];
  let typecheck = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--typecheck") {
      typecheck = true;
      continue;
    }
    if (args[i] !== "--test" || !args[i + 1] || args[i + 1].startsWith("--")) {
      throw new Error("Usage: npm run check -- [--typecheck] [--test <path> ...]");
    }
    paths.push(args[++i]);
    while (i + 1 < args.length && !args[i + 1].startsWith("--")) paths.push(args[++i]);
  }
  const jobs = [run("lint", ["run", "lint"]), paths.length
    ? run("test", ["exec", "--", "node", "--test", "--experimental-test-isolation=none", ...paths])
    : run("test", ["test"])];
  if (typecheck) jobs.push(run("typecheck", ["run", "typecheck"]));
  const results = await Promise.allSettled(jobs);
  return results.every(result => result.status === "fulfilled" && result.value === 0) ? 0 : 1;
}

function runNpm(name, args) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [process.env.npm_execpath, ...args], { stdio: "inherit" });
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
