import type { MessageRenderer } from "@earendil-works/pi-coding-agent";
import { messageText } from "./card.ts";
import { clean, fit, padded, wrap } from "./fit.ts";

function detailsOf(content: string, details: unknown): Record<string, unknown> {
	if (details && typeof details === "object") return details as Record<string, unknown>;
	try { return JSON.parse(content.replace(/^\[job\]\s*/, "")) ?? {}; }
	catch { return {}; }
}

function ids(details: Record<string, unknown>): string {
	const items = [details.results, details.statuses, details.matched].find((value) => Array.isArray(value) && value.length);
	return Array.isArray(items) ? items.flatMap((item) => typeof item?.id === "string" ? [item.id] : []).join(", ") : "";
}

/** Display only: expanded notifications retain all original text, including embedded skills. */
export const createNotificationCard: MessageRenderer = (message, options, theme) => {
	if (!["agent_progress", "child_wait", "job"].includes(message.customType)) return undefined;
	const text = messageText(message.content);
	const details = detailsOf(text, message.details);
	const paint = (role: Parameters<typeof theme.fg>[0], value: string) => theme.fg(role, clean(value));
	const muted = (value: string) => paint("muted", value);
	let summary: string;
	if (message.customType === "agent_progress") {
		const id = typeof details.id === "string" ? details.id : text.match(/agent#\d+/)?.[0];
		const steps = typeof details.steps === "number" ? details.steps : text.match(/worked (\d+)/)?.[1];
		summary = muted(`${id ?? "agent"} `) + paint("thinkingHigh", "progress") + muted(steps === undefined ? "" : `: ${steps} steps`);
	} else {
		const targets = ids(details);
		const reason = typeof details.reason === "string" ? details.reason.replace(/_/g, " ") : "notification";
		if (message.customType === "job" && reason === "exit") {
			const failed = Array.isArray(details.results) && details.results.some((item) =>
				["failed", "killed", "timed_out"].includes(item?.state) || (typeof item?.exit_code === "number" && item.exit_code !== 0));
			summary = muted(`${targets || "job"} `) + paint(failed ? "error" : "success", failed ? "failed" : "done");
		} else {
			const status = reason === "timeout" ? "timed out" : reason;
			const failed = ["timeout", "timed out", "failed", "error"].includes(reason);
			summary = muted(`${message.customType === "job" ? "job" : "wait"} `)
				+ paint(failed ? "error" : "muted", status) + muted(targets ? `: ${targets}` : "");
		}
	}
	return {
		render: padded((width) => options.expanded
			? wrap(clean(text), width).map((line) => theme.fg("muted", line))
			: width > 0 ? [fit(summary, width)] : [], options.outputPad),
		invalidate() {},
	};
};
