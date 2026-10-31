import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { createInterface } from "node:readline";
import type { Browser } from "puppeteer-core";
import { aborted, untilAborted } from "./abort.ts";

type Puppeteer = typeof import("puppeteer-core");
type Launch = { executablePath: string; headless: boolean; args: string[]; userDataDir?: string };

/** Launch an application without Puppeteer's process-exit handler owning its lifetime. */
export async function launchApplication(puppeteer: Puppeteer, options: Launch, signal: AbortSignal, onSpawn: (child: ChildProcess) => void, spawnProcess: typeof spawn = spawn): Promise<{ browser: Browser; child: ChildProcess }> {
	const args = await untilAborted(puppeteer.defaultArgs({ ...options, args: [...options.args] }), signal);
	if (!args.some(arg => arg.startsWith("--remote-debugging-"))) args.push("--remote-debugging-port=0");
	const child = spawnProcess(options.executablePath, args, { detached: process.platform !== "win32", stdio: ["ignore", "ignore", "pipe"] } as SpawnOptions);
	onSpawn(child);
	try {
		const endpoint = await new Promise<string>((resolve, reject) => {
			if (!child.stderr) return reject(new Error("Browser stderr is unavailable"));
			const lines = createInterface({ input: child.stderr });
			const cleanup = () => { lines.close(); child.removeListener("error", error); child.removeListener("exit", exit); signal.removeEventListener("abort", cancel); };
			const error = (cause: Error) => { cleanup(); reject(cause); };
			const exit = () => error(new Error("Browser exited before exposing its debugging endpoint"));
			const cancel = () => error(signal.reason ?? new Error("Browser operation aborted"));
			child.once("error", error);
			child.once("exit", exit);
			signal.addEventListener("abort", cancel, { once: true });
			if (signal.aborted) return cancel();
			lines.on("line", line => {
				const match = /^DevTools listening on (ws:\/\/.*)$/.exec(line);
				if (match) { cleanup(); resolve(match[1]!); }
			});
		});
		const browser = await untilAborted(puppeteer.connect({ browserWSEndpoint: endpoint }), signal, pending => { void pending.then(b => b.disconnect(), () => {}); });
		aborted(signal);
		return { browser, child };
	} catch (error) {
		child.kill();
		throw error;
	}
}
