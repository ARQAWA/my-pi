import type { world } from "./world.ts";

type World = Awaited<ReturnType<typeof world>>;
type Request = World["requests"][number];

/** The text of the hidden message that delivers results, when the request ends with it. */
function wakeText(request: Request): string | undefined {
	const last = request.context.messages.at(-1) as { role: string; content: { text?: string }[] };
	const first = last.role === "user" ? last.content[0]?.text : undefined;
	return first?.startsWith('{"results"') ? first : undefined;
}

export const wakeRequests = (w: World) => w.requests.filter((request) => wakeText(request) !== undefined);

/** Waits for the request that carries the delivered results and for the turn after it; returns that message text. */
export async function untilWake(w: World, count = 1): Promise<string> {
	await w.until(() => wakeRequests(w).length >= count, "the request that delivers the results");
	await w.settle();
	return wakeText(wakeRequests(w)[count - 1])!;
}
