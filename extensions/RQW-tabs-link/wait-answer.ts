import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { answerAfter } from "./history.ts";

type Result =
	| { reason: "answer"; entry: Record<string, unknown> }
	| { reason: "target_changed" | "timeout" | "disconnected" }
	| { error: "bad_request"; message: string };

/** Wait only on the active branch. The socket owns the lifetime of each subscription. */
export function createAnswerWaiter(branch: () => readonly SessionEntry[]) {
	const listeners = new Set<(changed: boolean) => void>();

	function wait(params: unknown, signal: AbortSignal): Promise<Result> {
		const value = params as { afterEntryId?: unknown; timeoutMs?: unknown } | null;
		if (!value || (value.afterEntryId !== null && typeof value.afterEntryId !== "string") ||
			!Number.isInteger(value.timeoutMs) || (value.timeoutMs as number) < 0 || (value.timeoutMs as number) > 2147483647) {
			return Promise.resolve({ error: "bad_request", message: "Expected afterEntryId and timeoutMs." });
		}
		const anchor = value.afterEntryId as string | null;
		const find = (): Result | undefined => {
			const entries = branch();
			const index = anchor === null ? -1 : entries.findIndex(entry => entry.id === anchor);
			if (anchor !== null && index < 0) return { reason: "target_changed" };
			const answer = answerAfter(entries, index);
			return answer ? { reason: "answer", entry: answer } : undefined;
		};
		const ready = find();
		if (ready) return Promise.resolve(ready);
		if (signal.aborted) return Promise.resolve({ reason: "disconnected" });
		return new Promise(resolve => {
			const finish = (result: Result) => {
				listeners.delete(check);
				signal.removeEventListener("abort", abort);
				clearTimeout(timer);
				resolve(result);
			};
			const check = (changed: boolean) => {
				const result = changed ? { reason: "target_changed" as const } : find();
				if (result) finish(result);
			};
			const abort = () => finish({ reason: "disconnected" });
			const timer = setTimeout(() => finish({ reason: "timeout" }), value.timeoutMs as number);
			listeners.add(check);
			signal.addEventListener("abort", abort, { once: true });
			check(false);
		});
	}

	return {
		wait,
		check: () => { for (const listener of listeners) listener(false); },
		targetChanged: () => { for (const listener of listeners) listener(true); },
	};
}
