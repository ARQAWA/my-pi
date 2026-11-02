const pending = new Map<string, Promise<void>>();

/** Stop waiting for a filesystem lookup on cancellation; its own cleanup still runs. */
export function abortable<T>(run: () => Promise<T>, signal?: AbortSignal): Promise<T> {
	if (!signal) return run();
	if (signal.aborted) return Promise.reject(new Error("Operation aborted"));
	return new Promise<T>((resolve, reject) => {
		const abort = () => { signal.removeEventListener("abort", abort); reject(new Error("Operation aborted")); };
		signal.addEventListener("abort", abort, { once: true });
		if (signal.aborted) { abort(); return; }
		Promise.resolve().then(() => {
			if (signal.aborted) throw new Error("Operation aborted");
			return run();
		}).then(
			value => { signal.removeEventListener("abort", abort); resolve(value); },
			error => { signal.removeEventListener("abort", abort); reject(error); },
		);
	});
}

/** Serialize writes to one resolved path across tool instances. */
export async function withFileLock<T>(path: string, run: () => Promise<T>, signal?: AbortSignal): Promise<T> {
	const previous = pending.get(path) ?? Promise.resolve();
	let release!: () => void;
	const gate = new Promise<void>((resolve) => { release = resolve; });
	// A cancelled slot still preserves the predecessor for later callers.
	const current = previous.then(() => gate);
	pending.set(path, current);
	void current.then(() => {
		if (pending.get(path) === current) pending.delete(path);
	});
	let abort: (() => void) | undefined;
	try {
		await Promise.race([
			previous,
			new Promise<never>((_resolve, reject) => {
				abort = () => reject(new Error("Operation aborted"));
				signal?.addEventListener("abort", abort, { once: true });
				if (signal?.aborted) abort();
			}),
		]);
		if (signal?.aborted) throw new Error("Operation aborted");
		return await run();
	} finally {
		if (abort) signal?.removeEventListener("abort", abort);
		release();
	}
}
