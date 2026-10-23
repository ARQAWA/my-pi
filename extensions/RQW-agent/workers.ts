// Fixed-role profiles. The caller supplies the shared agent lifecycle runtime; no caller session is global.
import { readFileSync } from "node:fs";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { RunningCounts } from "./counts.ts";
import { blockedGit } from "./git-guard.ts";
import { statusDepth } from "./coordinator.ts";

export type RefusalObserver = (toolCallId: string, reason: string) => void;
import { pickWorkerModel, type WorkerModel, type WorkerRole } from "./worker-model.ts";

export type WorkerProfile = {
	name: WorkerRole;
	description: string;
	system: string;
	tools: readonly string[];
	resolve(caller: ExtensionContext): Promise<WorkerModel>;
	configure(session: ExtensionAPI, onRefusal?: RefusalObserver): void;
};

/** Caller-owned children and results, including a result not yet consumed by the caller model. */
export type RuntimeHandle = {
	pending(): boolean;
	wait(signal: AbortSignal): Promise<void>;
	ids(): string[];
	/** Compact read-only diagnostics; depth counts generations below these direct children. */
	status?(depth: number): Record<string, unknown>[];
	/** Running children of this caller and of its nested callers, by kind. Pending results count zero. */
	runningCounts(): RunningCounts;
	abortAll(): void;
	close(): void;
};

const TOOLS = {
	code_writer: ["read", "edit", "write", "grep", "find", "bash"],
	shell_runner: ["bash", "read", "grep", "find"],
} as const;

/** Bind workers to precisely this caller. A subagent can use the same entry point with its own ExtensionAPI. */
export function registerWorkers(caller: ExtensionAPI, register: (caller: ExtensionAPI, profile: WorkerProfile) => RuntimeHandle): RuntimeHandle {
	const runtimes: RuntimeHandle[] = [];
	for (const name of Object.keys(TOOLS) as WorkerRole[]) {
		runtimes.push(register(caller, {
			name,
			description: readFileSync(new URL(`./descriptions/${name}.md`, import.meta.url), "utf8").trim(),
			system: readFileSync(new URL(`./roles/${name}.md`, import.meta.url), "utf8"),
			tools: TOOLS[name],
			async resolve(ctx) {
				const selected = await pickWorkerModel(ctx.modelRegistry, name);
				if (typeof selected === "string") throw new Error(selected);
				return selected;
			},
			configure: installGitGuard,
		}));
	}
	return {
		pending: () => runtimes.some(runtime => runtime.pending()),
		async wait(signal) { await Promise.all(runtimes.map(runtime => runtime.wait(signal))); },
		ids: () => runtimes.flatMap(runtime => runtime.ids()),
		status: depth => { statusDepth(depth); return runtimes.flatMap(runtime => runtime.status?.(depth) ?? []); },
		runningCounts: () => sumCounts(runtimes.map(runtime => runtime.runningCounts())),
		abortAll() { for (const runtime of runtimes) runtime.abortAll(); },
		close() { for (const runtime of runtimes) runtime.close(); },
	};
}

/** Blocks every git-state change in this worker session's bash calls before the shell runs. */
export function installGitGuard(session: ExtensionAPI, onRefusal?: RefusalObserver): void {
	session.on("tool_call", event => {
		if (event.toolName !== "bash" || typeof event.input.command !== "string") return;
		const reason = blockedGit(event.input.command);
		if (reason) {
			onRefusal?.(event.toolCallId, reason);
			return { block: true, reason };
		}
	});
}

/** Sums running counts of several runtimes, kind by kind. */
export function sumCounts(parts: RunningCounts[]): RunningCounts {
	return parts.reduce((total, p) => ({ agents: total.agents + p.agents, workers: total.workers + p.workers, reviews: total.reviews + p.reviews }), { agents: 0, workers: 0, reviews: 0 });
}
