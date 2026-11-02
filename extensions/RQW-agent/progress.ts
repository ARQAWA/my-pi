import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Api, AssistantMessage, Context, Model, ThinkingLevel } from "@earendil-works/pi-ai";
import type { EventBus, ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const CONTEXT_FORK = "rqw:context-fork:v1";
export const PROGRESS_STEPS = 50;
export const PROGRESS_INTERVAL_MS = 30 * 60 * 1000;
export const PROGRESS_SKILL_PATH = fileURLToPath(new URL("./skills/agent-progress/SKILL.md", import.meta.url));
const SKILL = readFileSync(PROGRESS_SKILL_PATH, "utf8").trim();
const INSTRUCTION = "Summarize what you did recently, including tool calls and their results. Briefly state work completed, current progress and unresolved issues. This is a background progress report, not your final answer. Work continues independently. Return text only; do not call tools.";

type Notice = Parameters<ExtensionAPI["sendMessage"]>[0];
export type ContextForkRequest = {
	sessionId: string;
	model: Model<Api>;
	context: Context;
	reasoning?: ThinkingLevel;
	signal: AbortSignal;
	offer(infer: () => Promise<AssistantMessage>): void;
};
type Trigger = "steps" | "time";
type Deliver = (message: Notice, current: () => boolean, delivered: () => void) => void;

/** One child's side channel. It never writes to the child transcript or owns its final result. */
export class ProgressReports {
	steps = 0;
	onCount: () => void = () => {};
	private pending?: AbortController;
	private request?: { model: Model<Api>; context: Context };
	/** The latest tool-call response, until the next request carries it in its context, and its effort. */
	private latest?: AssistantMessage;
	private reasoning?: ThinkingLevel;
	/** One timer per active child: the 30 minute limit since the last communication, chained until the child stops. */
	private timer?: ReturnType<typeof setTimeout>;

	private events: EventBus;
	private id: string;
	private sessionId: string;
	private deliver: Deliver;

	constructor(events: EventBus, id: string, sessionId: string, deliver: Deliver) {
		this.events = events;
		this.id = id;
		this.sessionId = sessionId;
		this.deliver = deliver;
	}

	capture(model: Model<Api>, context: Context): void {
		const previous = this.request?.model;
		if (previous && (previous.provider !== model.provider || previous.id !== model.id || previous.api !== model.api)) this.discard();
		this.request = { model, context };
		this.latest = undefined;
	}

	response(message: AssistantMessage, reasoning?: ThinkingLevel): void {
		if (message.stopReason !== "toolUse" || !message.content.some(part => part.type === "toolCall")) return;
		this.steps++;
		this.onCount();
		this.latest = message;
		this.reasoning = reasoning;
		this.start();
		if (this.steps % PROGRESS_STEPS === 0) this.summarize("steps");
	}

	/** Accepted work starts the 30 minute limit at once, before any tool-call response; a running limit stays. */
	start(): void {
		if (!this.timer) this.arm();
	}

	private arm(): void {
		clearTimeout(this.timer);
		this.timer = setTimeout(() => { this.arm(); this.summarize("time"); }, PROGRESS_INTERVAL_MS);
		this.timer.unref?.();
	}

	private summarize(trigger: Trigger): void {
		if (this.pending || !this.request) return;
		const controller = this.pending = new AbortController();
		const current = () => this.pending === controller && !controller.signal.aborted;
		const context = structuredClone(this.request.context);
		// The just-finished response's tools have not run. Describe its intent as text, not unmatched wire tool calls.
		const latest = this.latest ? `\nLatest response, whose tools may still be running:\n${JSON.stringify(this.latest.content)}` : "";
		context.messages.push({ role: "user", content: `${INSTRUCTION}${latest}`, timestamp: Date.now() });
		let infer: (() => Promise<AssistantMessage>) | undefined;
		// The provider captures its independent cache state now, before the next child request can advance it.
		this.events.emit(CONTEXT_FORK, {
			sessionId: this.sessionId, model: this.request.model, context, reasoning: this.reasoning,
			signal: controller.signal, offer: (run) => { infer = run; },
		} satisfies ContextForkRequest);
		if (!infer) { controller.abort(); this.pending = undefined; return; }
		// Never await inference in a child event hook, and never execute a returned tool call.
		let queued = false;
		void Promise.resolve().then(() => current() ? infer!() : undefined).then(report => {
			if (!report || !current() || report.stopReason !== "stop") return;
			const summary = report.content.filter(part => part.type === "text").map(part => part.text).join("\n").trim();
			if (!summary) return;
			const worked = trigger === "steps" ? `${PROGRESS_STEPS} tool-call steps` : `${PROGRESS_INTERVAL_MS / 60000} minutes`;
			this.deliver({
				customType: "agent_progress", display: true,
				content: `[notification] ${this.id} has worked ${worked} without communication.\n${summary}\nThe agent continues working. Check whether this child has drifted outside its task and still follows the plan in its brief. Decide whether to send a correction.\n\n<skill name="agent-progress">\n${SKILL}\n</skill>`,
				details: { id: this.id, ...(trigger === "steps" ? { steps: PROGRESS_STEPS } : {}), continues: true },
			}, current, () => this.reset());
			queued = true;
		}).catch(() => {}).finally(() => {
			if (!queued && current()) this.pending = undefined;
		});
	}

	/** Compaction and model change drop an in-flight snapshot; the timer and the communication history stay. */
	discard(): void {
		this.pending?.abort();
		this.pending = undefined;
	}

	/** End of work drops the snapshot and the timer without resetting communication history. */
	invalidate(): void {
		this.discard();
		clearTimeout(this.timer);
		this.timer = undefined;
	}

	/** Only a successful parent send or delivered report resets communication history. */
	reset(): void {
		const watching = this.timer !== undefined;
		this.invalidate();
		this.steps = 0;
		this.onCount();
		// A running child gets a new 30 minute limit; an idle one starts it when its next work is accepted.
		if (watching) this.arm();
	}
}
