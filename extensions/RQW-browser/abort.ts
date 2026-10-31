export function aborted(signal: AbortSignal): void {
	if (signal.aborted) throw signal.reason ?? new Error("Browser operation aborted");
}

export async function untilAborted<T>(promise: Promise<T>, signal: AbortSignal, late?: (promise: Promise<T>) => void): Promise<T> {
	aborted(signal);
	let onAbort: () => void = () => {};
	const cancelled = new Promise<never>((_, reject) => {
		onAbort = () => reject(signal.reason ?? new Error("Browser operation aborted"));
		signal.addEventListener("abort", onAbort, { once: true });
	});
	try {
		return await Promise.race([promise, cancelled]);
	} catch (error) {
		if (signal.aborted && late) late(promise);
		throw error;
	} finally {
		signal.removeEventListener("abort", onAbort);
	}
}
