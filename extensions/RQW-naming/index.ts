import { convertToLlm, type ExtensionAPI, type ExtensionContext, type MessageEndEvent } from "@earendil-works/pi-coding-agent";
import { generateSessionName, type NamingRegistry } from "./core.ts";

/** Initial attempt plus three retries. */
const ATTEMPTS = 4;
const WARNING = "Automatic session naming failed; the previous session name is kept.";

type Run = { controller: AbortController; sessionId: string | undefined };

function sessionIdOf(ctx: ExtensionContext): string | undefined {
	try { return ctx.sessionManager.getSessionId(); }
	catch { return undefined; }
}

/** The first user message is already persisted when a session reloads or resumes. */
function hasUserMessage(ctx: ExtensionContext): boolean {
	try { return ctx.sessionManager.getEntries().some((entry) => entry.type === "message" && entry.message.role === "user"); }
	catch { return true; } // Unknown history must not start a generation.
}

export default function (pi: ExtensionAPI) {
	let current: Run | undefined;
	let firstUserSeen = false;
	// Name we are writing ourselves; its session_info_changed echo must not cancel our own run.
	let ownName: string | undefined;

	const cancel = () => {
		current?.controller.abort();
		current = undefined;
	};

	/** Stale runs (aborted, replaced or superseded) must never write or warn. */
	const isCurrent = (run: Run, ctx: ExtensionContext) => {
		if (current !== run || run.controller.signal.aborted) return false;
		return sessionIdOf(ctx) === run.sessionId;
	};

	const warn = (run: Run, ctx: ExtensionContext) => {
		if (!isCurrent(run, ctx)) return;
		try { ctx.ui.notify(WARNING, "warning"); }
		catch { /* the UI of a replaced context is gone */ }
	};

	async function generate(ctx: ExtensionContext, run: Run, context: string, registry: NamingRegistry, provider: string | undefined) {
		let name: string | undefined;
		for (let attempt = 0; attempt < ATTEMPTS && name === undefined; attempt++) {
			try { name = await generateSessionName({ context, registry, signal: run.controller.signal, provider }); }
			catch { name = undefined; }
			if (!isCurrent(run, ctx)) return;
		}
		if (name === undefined) return warn(run, ctx);
		if (current === run) current = undefined;
		ownName = name;
		pi.setSessionName(name);
	}

	/** Starts the background generation and returns at once; the context is captured before any await. */
	function trigger(ctx: ExtensionContext, pendingMessage?: MessageEndEvent["message"]): void {
		cancel();
		const run: Run = { controller: new AbortController(), sessionId: sessionIdOf(ctx) };
		current = run;
		const provider = ctx.model?.provider;
		void (async () => {
			let context: string;
			try {
				// message_end reaches extensions BEFORE Pi appends that message to the session.
				const messages = ctx.sessionManager.buildSessionProjection().messages;
				const available = pendingMessage ? [...messages, pendingMessage] : messages;
				// Pi's serializeConversation truncates tool results; preserve all available context here.
				context = JSON.stringify(convertToLlm(available));
			}
			catch { return warn(run, ctx); }
			try { await generate(ctx, run, context, ctx.modelRegistry, provider); }
			catch { warn(run, ctx); }
		})();
	}

	pi.on("session_start", (_event, ctx) => {
		cancel();
		ownName = undefined;
		firstUserSeen = hasUserMessage(ctx);
	});

	pi.on("message_end", (event, ctx) => {
		if (event.message.role !== "user" || firstUserSeen) return;
		firstUserSeen = true;
		trigger(ctx, event.message);
	});

	pi.on("session_compact", (_event, ctx) => trigger(ctx));

	pi.on("session_info_changed", (event) => {
		if (ownName !== undefined && event.name === ownName) {
			ownName = undefined;
			return;
		}
		cancel(); // A manual /name wins over an in-flight generation.
	});

	pi.on("session_shutdown", () => cancel());

	pi.registerCommand("rename-gen", {
		description: "Generate the session name from the conversation",
		handler: async (_args, ctx) => trigger(ctx),
	});
}
