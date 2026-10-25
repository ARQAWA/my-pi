// A second extension with a slow async agent_before_settle handler, such as a check that runs before the agent stops.
// The test loads it after RQW-agent and holds the handler through `globalThis.__slowSettle`.
const g = globalThis as { __slowSettle?: { enabled: boolean; entered: boolean; release: () => void } };
g.__slowSettle ??= { enabled: false, entered: false, release: () => {} };
export default function (pi: { on: (event: string, handler: () => Promise<void>) => void }) {
	pi.on("agent_before_settle", async () => {
		const slow = g.__slowSettle;
		if (!slow?.enabled) return;
		slow.entered = true;
		await new Promise<void>((r) => {
			slow.release = r;
		});
	});
}
