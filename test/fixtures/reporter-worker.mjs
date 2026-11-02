import { parentPort, workerData } from "node:worker_threads";
import { run } from "node:test";
import { fileURLToPath } from "node:url";
import report from "../../scripts/test-reporter.mjs";

const files = [fileURLToPath(new URL(workerData, import.meta.url))];
let output = "";
for await (const chunk of report(run({ files, isolation: "none" }))) output += chunk;
parentPort.postMessage({ output, exitCode: process.exitCode ?? 0 });
