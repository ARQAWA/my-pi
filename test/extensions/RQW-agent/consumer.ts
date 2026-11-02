import { randomUUID } from "node:crypto";

/**
 * What RQW-auto-wait does with the source of results: claim the ready ones, save them as one hidden message and commit.
 * Returns at once with no results when nothing is ready and nothing runs; otherwise it sleeps until the source changes.
 */
export async function takeFrom(source: { claim(): any; commit(token: string): void; snapshot(): { targets: string[] }; subscribe(listener: (value: true | null) => void): () => void },
	save: (message: { content: string; details: unknown }) => void) {
	for (;;) {
		let changed = () => {};
		const woke = new Promise<void>(resolve => { changed = resolve; });
		const stop = source.subscribe(changed);
		const claim = source.claim();
		const live = source.snapshot().targets.length > 0;
		if (claim || !live) stop();
		if (claim) {
			const results = claim.results as { id: string; run: string; delivery: string; title?: string; outcome: string; text: string }[];
			const content = JSON.stringify({ results: results.map(({ id, title, outcome, text }) => ({ id, ...(title ? { title } : {}), outcome, text })) });
			save({ content, details: { batch: randomUUID(), results: results.map(({ id, run, delivery }) => ({ id, run, delivery })) } });
			source.commit(claim.token);
			return { content: [{ type: "text", text: content }], details: { results } };
		}
		if (!live) return { content: [{ type: "text", text: "{\"results\":[]}" }], details: { results: [] } };
		await woke;
		stop();
	}
}

/** As Pi starts a session: runs its session_start hooks, then returns the source of results that the main chat's consumer adopts. */
export async function adoptSource(pi: any, hooks: Map<string, ((event: any, ctx: any) => unknown)[]>, ctx: any) {
	for (const hook of hooks.get("session_start") ?? []) await hook({ reason: "startup" }, ctx);
	let source: any;
	pi.events.emit("rqw:auto-wait:request:v1", { sessionId: ctx.sessionManager.getSessionId(), offer: (value: any) => { source = value; } });
	return source;
}
