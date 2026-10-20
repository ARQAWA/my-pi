// Retry for file operations that fail while another program holds the file (Windows: antivirus, indexers, editors).
// Backoff 50, 100, 200, 400, 800 ms: about 1.5 s in total, then the last error is rethrown.

const BACKOFF_MS = [50, 100, 200, 400, 800];
const TRANSIENT = /EBUSY|EPERM|EACCES/;

function isTransient(error: any): boolean {
	return TRANSIENT.test(String(error?.code ?? "")) || TRANSIENT.test(String(error?.message ?? ""));
}

export async function withRetry<T>(run: () => Promise<T>, signal?: AbortSignal): Promise<T> {
	for (let attempt = 0; ; attempt++) {
		try {
			return await run();
		} catch (error) {
			// Only Windows holds files this way; elsewhere these codes are real permission errors and fail at once.
			if (process.platform !== "win32" || attempt >= BACKOFF_MS.length || signal?.aborted || !isTransient(error)) throw error;
			await new Promise((resolve) => setTimeout(resolve, BACKOFF_MS[attempt]));
		}
	}
}
