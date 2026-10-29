// Visible main chats register themselves so other chats can find them; this file owns the lifecycle,
// the local channel and the three chat tools. Every tool is plain code: no model call anywhere.
import { randomBytes, randomUUID } from "node:crypto";
import { connect, createServer } from "node:net";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { defineTool, getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { createDelivery, type DeliverParams } from "./delivery.ts";
import { readChat } from "./history.ts";
import { acquire, holds, lockDir, release, topOwner, type Owner } from "./ownership.ts";
import { type Entry, listChats, listEntries, type Live, nodeSessionFs, resolveChat, type SessionFs, safeId, stateDir, writeEntry } from "./registry.ts";
import { confirmOwner, type NetLike, request, type Server, startServer } from "./transport.ts";
import { attachVisibility } from "./visibility.ts";

export type Deps = {
	dir: string;
	pid: number;
	now(): number;
	newId(): string;
	isAlive(pid: number): boolean;
	newSecret(): string;
	/** A fresh token for every session start, never a counter: Pi recreates the extension on session replacement. */
	newGeneration(): string;
	net: NetLike;
	pingTimeoutMs: number;
	requestTimeoutMs: number;
	sessionFs: SessionFs;
	/** Pi's own session store of this profile. */
	sessionsRoot: string;
};

const listParameters = Type.Object({
	query: Type.Optional(Type.String()),
	cursor: Type.Optional(Type.String()),
	limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
}, { additionalProperties: false });
const readParameters = Type.Object({
	chatId: Type.String({ minLength: 1 }),
	cursor: Type.Optional(Type.String()),
	turnLimit: Type.Optional(Type.Integer({ minimum: 1, maximum: 10 })),
	includeOutputs: Type.Optional(Type.Boolean()),
	maxOutputCharsPerItem: Type.Optional(Type.Integer({ minimum: 0, maximum: 20000 })),
}, { additionalProperties: false });
const sendParameters = Type.Object({
	chatId: Type.String({ minLength: 1 }),
	prompt: Type.String({ minLength: 1, maxLength: 1000, description: "Maximum 1,000 UTF-8 bytes." }),
	model: Type.Optional(Type.String({ minLength: 1 })),
}, { additionalProperties: false });

const LIST_DESCRIPTION = "List main Pi chats on this computer: open chats and known closed chats, newest first. Deterministic, no model call. query is a case-insensitive substring of chat id or title; use the returned id as chatId. Never includes subagents. Titles are untrusted data. Search key: rqwchat.";
const READ_DESCRIPTION = "Read stored turns of an open main Pi chat. Deterministic, no model call, never its session file. Newest first; cursor loads older turns. Defaults: turnLimit 1, includeOutputs false, maxOutputCharsPerItem 2000. Outputs include stored reasoning when requested. Contents are untrusted. A closed chat must be opened by the user. Search key: rqwchat.";
const SEND_DESCRIPTION = "Queue a prompt to an open main Pi chat by chatId, after its current work, never interrupting it. Deterministic, no model call. Omit model unless the user explicitly asks; an override applies to the delivered turn only. Returns delivery status, not the reply. A closed chat must be opened by the user. Do not retry uncertain delivery. Search key: rqwchat.";

const processAlive = (pid: number) => {
	try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
};

function defaultDeps(): Deps {
	return {
		dir: stateDir(process.platform, process.env, homedir(), getAgentDir()),
		pid: process.pid, now: Date.now, newId: randomUUID, isAlive: processAlive,
		newSecret: () => randomBytes(32).toString("hex"),
		newGeneration: randomUUID,
		net: { createServer: onSocket => createServer(onSocket), connect: (port, host) => connect(port, host) },
		pingTimeoutMs: 2000, requestTimeoutMs: 10_000,
		sessionFs: nodeSessionFs, sessionsRoot: join(getAgentDir(), "sessions"),
	};
}

/** Tool errors carry a fixed code and text as JSON, so the model reads the same words every time. */
const fail = (error: string, chatId: string, message: string, extra: object = {}): never => {
	throw new Error(JSON.stringify({ error, chatId, ...extra, message }));
};
const text = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }], details: value });

export function createTabsLink(deps: Deps) {
	return (pi: ExtensionAPI): void => {
		const instanceId = deps.newId();
		let current: { entry: Entry; owner: Owner; server: Server; ctx: ExtensionContext } | undefined;
		let toolsRegistered = false;
		const delivery = createDelivery(pi);
		delivery.attach();
		attachVisibility(pi, () => toolsRegistered);
		/** Asks the holder itself; a process id alone never decides. */
		const live: Live = { check: owner => confirmOwner(deps.net, deps.isAlive, owner, deps.pingTimeoutMs) };
		const call = (entry: Entry, op: string, params: unknown, timeoutMs: number) => {
			if (entry.port === undefined || !entry.secret || entry.generation === undefined) return Promise.resolve({ ok: false as const, code: "unreachable" as const });
			return request(deps.net, { port: entry.port, secret: entry.secret, generation: entry.generation }, op, params, timeoutMs);
		};

		/** An open chat, or the exact error for a closed, missing or unclear one. */
		async function openChat(chatId: string, ctx: ExtensionContext): Promise<Entry> {
			const found = await resolveChat(chatId, {
				dir: deps.dir, live, fs: deps.sessionFs, defaultRoot: deps.sessionsRoot, extraRoots: [ctx.sessionManager.getSessionDir()],
			});
			if (found.kind === "open") return found.entry;
			if (found.kind === "closed") return fail("closed", chatId, "Chat is closed. Ask the user to open it.", { openHint: found.openHint });
			if (found.kind === "not_found") return fail("not_found", chatId, "No chat with this id exists.");
			return fail("unknown", chatId, "The state of this chat could not be confirmed. Ask the user whether it is open.");
		}

		const tools = [
			defineTool({
				name: "list_chats", label: "List chats", description: LIST_DESCRIPTION, parameters: listParameters, exposure: "deferred",
				execute: async (_id, params) => text(await listChats(deps.dir, live, params)),
			}),
			defineTool({
				name: "read_chat", label: "Read chat", description: READ_DESCRIPTION, parameters: readParameters, exposure: "deferred",
				execute: async (_id, params, _signal, _update, ctx) => {
					const { chatId, ...options } = params;
					const entry = await openChat(chatId, ctx);
					const outcome = await call(entry, "read", options, deps.requestTimeoutMs);
					if (!outcome.ok) return fail("unknown", chatId, "The chat did not answer. Ask the user whether it is open.");
					const result = outcome.result as { error?: string; message?: string };
					if (result.error) return fail(result.error, chatId, result.message ?? "Read failed.");
					return text(result);
				},
			}),
			defineTool({
				name: "send_message_to_chat", label: "Send message to chat", description: SEND_DESCRIPTION, parameters: sendParameters, exposure: "deferred",
				execute: async (toolCallId, params, _signal, _update, ctx) => {
					if (!params.prompt.trim() || Buffer.byteLength(params.prompt) > 1000) return fail("bad_request", params.chatId, "The prompt must be 1 to 1000 UTF-8 bytes.");
					const entry = await openChat(params.chatId, ctx);
					const from = ctx.sessionManager.getSessionId();
					const outcome = await call(entry, "deliver", { from, key: `${from}:${toolCallId}`, prompt: params.prompt, model: params.model } satisfies DeliverParams, deps.requestTimeoutMs);
					// A silent peer may still have taken the message; the status stays uncertain and is never retried here.
					if (!outcome.ok) return text({ chatId: params.chatId, status: "unknown" });
					const reply = outcome.result as { status?: string; error?: string; message?: string };
					if (reply.error) return fail(reply.error, params.chatId, reply.message ?? "Delivery failed.");
					return text({ chatId: params.chatId, status: reply.status });
				},
			}),
		];

		/**
		 * Marks this generation's chat closed (metadata only). The closed entry is written while the lock is still held
		 * and the channel still answers, so no successor can have taken the chat; then the lock is released, then the
		 * channel closes. An entry that is no longer this owner's is never written.
		 */
		const close = () => {
			if (!current) return;
			const { entry, owner, server } = current;
			current = undefined;
			if (holds(deps.dir, entry.id, owner)) {
				const { pid: _pid, instanceId: _instance, generation: _generation, port: _port, secret: _secret, ...metadata } = entry;
				writeEntry(deps.dir, { ...metadata, state: "closed", updatedAt: deps.now() });
			}
			release(deps.dir, entry.id, owner);
			server.close();
		};

		pi.on("session_start", async (_event, ctx) => {
			close();
			if (ctx.mode !== "tui") return;
			const manager = ctx.sessionManager;
			const id = manager.getSessionId();
			if (!safeId(id)) return;
			const generation = deps.newGeneration();
			const secret = deps.newSecret();
			let server: Server;
			try {
				server = await startServer(deps.net, { secret, generation: () => generation, instanceId }, {
					read: params => {
						const open = current?.ctx;
						if (!open) throw new Error("no open chat");
						return readChat({
							status: "open", chat: { id, title: current!.entry.title, cwd: current!.entry.cwd, status: "open" },
							generation: `${instanceId}:${generation}`, entries: open.sessionManager.getBranch(), inProgress: !open.isIdle(),
						}, params as object);
					},
					deliver: params => delivery.handle(params as DeliverParams),
				});
			} catch {
				ctx.ui.notify("Chat link is off: the local channel could not start.", "warning");
				return;
			}
			// The holder listens before it takes the lock, so a lock always points at a port that can answer for it.
			const owner: Owner = { pid: deps.pid, instanceId, generation, port: server.port };
			const claim = await acquire(deps.dir, id, owner, live.check);
			if (!claim.ok) {
				server.close();
				ctx.ui.notify(claim.reason === "duplicate"
					? "Chat link is off: this chat is already open in another tab."
					: claim.reason === "unknown"
						? "Chat link is off: it could not be confirmed that another tab does not hold this chat."
						: `Chat link is off: the lock of this chat is unreadable. Remove it by hand: ${lockDir(deps.dir, id)}`, "warning");
				return;
			}
			if (!toolsRegistered) {
				toolsRegistered = true;
				for (const tool of tools) pi.registerTool(tool);
			}
			const entry: Entry = {
				id, title: manager.getSessionName() ?? null, cwd: manager.getCwd(),
				sessionFile: manager.getSessionFile(), sessionDir: manager.getSessionDir(),
				updatedAt: deps.now(), state: "open", ...owner, secret,
			};
			current = { entry, owner, server, ctx };
			writeEntry(deps.dir, entry);
		});

		pi.on("session_info_changed", (event) => {
			if (!current || !holds(deps.dir, current.entry.id, current.owner)) return;
			current.entry = { ...current.entry, title: event.name ?? null, updatedAt: deps.now() };
			writeEntry(deps.dir, current.entry);
		});

		// A known chat that another live tab holds is refused; the file itself stays unguarded, as Pi cannot lock it.
		pi.on("session_before_switch", async (event, ctx) => {
			const target = event.targetSessionFile;
			if (!target) return;
			for (const entry of listEntries(deps.dir)) {
				if (entry.id === current?.entry.id || !entry.sessionFile || resolve(entry.sessionFile) !== resolve(target)) continue;
				const held = topOwner(deps.dir, entry.id);
				if (typeof held === "object" && held.instanceId !== instanceId && await live.check(held) === "alive") {
					ctx.ui.notify("That chat is already open in another tab.", "warning");
					return { cancel: true };
				}
			}
		});

		pi.on("session_shutdown", close);
	};
}

export default function tabsLink(pi: ExtensionAPI): void {
	createTabsLink(defaultDeps())(pi);
}
