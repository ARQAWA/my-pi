import type { MessageRenderer } from "@earendil-works/pi-coding-agent";
import { snapshot, render } from "../../../scripts/qa-status.mjs";
import { createQaCard } from "./card.ts";

type Snapshot = { ok: boolean; at: string; items: { id: string; level: string; text: string; url: string }[]; error?: string };
type Context = { cwd: string; ui: { notify(text: string, level?: "info" | "warning" | "error"): void } };
type Pi = {
	on(event: "session_start" | "agent_start", handler: (event: unknown, ctx: Context) => void): unknown;
	registerCommand(name: string, command: { description: string; handler: (args: string, ctx: Context) => Promise<void> }): void;
	sendMessage(message: { customType: string; content: string; display: boolean }, options: { deliverAs: "nextTurn"; triggerTurn: false }): void;
};

export function createQaStatus({ pi, getSnapshot = snapshot, now = Date.now }: {
	pi: Pi; getSnapshot?: (options: { cwd: string }) => Promise<Snapshot>; now?: () => number;
}) {
	let last: Snapshot | undefined;
	let inFlight: Promise<Snapshot> | undefined;
	let generation = 0;
	const shown = new Set<string>();
	let unavailableShown = false;
	const deliver = (state: Snapshot) => {
		let content: string;
		if (!state.ok) {
			if (unavailableShown) return;
			unavailableShown = true;
			content = render(state).replace(/\s+/g, " ");
		} else {
			const ids = state.items.filter((i) => i.level === "red" && !shown.has(i.id)).map((i) => i.id);
			if (!ids.length) return;
			for (const id of ids) shown.add(id);
			content = render(state, { onlyIds: ids });
		}
		// Pi 1.4.0 queues nextTurn without steering or creating a follow-up run,
		// even during streaming. It is consumed with the next starting prompt.
		pi.sendMessage({ customType: "qa-status", content, display: true }, { deliverAs: "nextTurn", triggerTurn: false });
	};
	const refresh = (cwd: string): Promise<Snapshot> => {
		if (inFlight) return inFlight;
		const current = generation;
		const pending = Promise.resolve().then(() => getSnapshot({ cwd })).catch((e) => ({
			ok: false, at: new Date(now()).toISOString(), items: [], error: `QA status unavailable: ${String(e?.message ?? e)}`,
		})).then((state) => {
			if (current === generation) { last = state; deliver(state); }
			return state;
		}).finally(() => { if (inFlight === pending) inFlight = undefined; });
		inFlight = pending;
		return pending;
	};
	pi.on("session_start", (_event, ctx) => {
		generation++;
		last = undefined;
		shown.clear();
		unavailableShown = false;
		// A replaced session ignores the previous session's result.
		const previous = inFlight;
		if (previous) void previous.then(() => refresh(ctx.cwd));
		else void refresh(ctx.cwd);
	});
	pi.on("agent_start", (_event, ctx) => {
		if (!last || now() - Date.parse(last.at) > 60_000) void refresh(ctx.cwd);
	});
	pi.registerCommand("qa", {
		description: "Show current workflow status",
		handler: async (_args, ctx) => {
			if (inFlight) await inFlight;
			const state = await refresh(ctx.cwd);
			ctx.ui.notify(render(state), state.ok ? "info" : "warning");
		},
	});
	return { refresh };
}

export default function (pi: Pi & { registerMessageRenderer(type: string, renderer: MessageRenderer): void }) {
	pi.registerMessageRenderer("qa-status", createQaCard);
	createQaStatus({ pi });
}
