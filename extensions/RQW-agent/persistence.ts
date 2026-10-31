import { appendFileSync, lstatSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import {
	SessionManager,
	type AgentSession,
	type ExtensionContext,
	type SessionEntry,
} from "@earendil-works/pi-coding-agent";

type ReadonlySessionManager = ExtensionContext["sessionManager"];

export const CHILD_ENTRY = "rqw-agent-child";
export const WAIT_ENTRY = "rqw-agent-wait";
export const ACCEPT_ENTRY = "rqw-agent-accept";
/** One base prompt text, written once per branch; child records name it by `base_ref`. */
export const BASE_ENTRY = "rqw-agent-base";

const retainedChildren = new WeakMap<ReadonlySessionManager, Map<string, SessionManager>>();

export function retainedChildManager(parent: ReadonlySessionManager, kind: string, id: number): SessionManager | undefined {
	return retainedChildren.get(parent)?.get(`${kind}#${id}`);
}

/** Forgets the retained manager of a child that went to sleep: its history is reopened from its file when needed. */
export function releaseChildManager(parent: ReadonlySessionManager, kind: string, id: number): void {
	retainedChildren.get(parent)?.delete(`${kind}#${id}`);
}

function retainChild(parent: ReadonlySessionManager, kind: string, id: number, manager: SessionManager): SessionManager {
	let children = retainedChildren.get(parent);
	if (!children) {
		children = new Map();
		retainedChildren.set(parent, children);
	}
	children.set(`${kind}#${id}`, manager);
	return manager;
}

const INTERRUPTED = "Interrupted before a durable result was recorded. The tool may already have had side effects; inspect state before deciding what to do. This call was not replayed.";

function childDirectory(parent: ReadonlySessionManager, kind: string, id: number): string | undefined {
	if (kind !== "agent" || !Number.isSafeInteger(id) || id < 1) {
		throw new Error("Invalid child kind or id");
	}
	const parentFile = parent.getSessionFile();
	return parentFile ? resolve(`${parentFile}.children`, `${kind}-${id}`) : undefined;
}

// The parent's directory is trusted, including OS aliases such as /var.
// Only the parent filename and the adjacent owned tree must not contain links.
function checkPath(path: string, allowMissing: boolean, parentFile: string): void {
	const trusted = dirname(resolve(parentFile));
	let current = realpathSync(trusted);
	for (const component of relative(trusted, resolve(path)).split(sep)) {
		current = resolve(current, component);
		try {
			const stat = lstatSync(current);
			if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) {
				throw new Error(`Unsafe child session path: ${current}`);
			}
		} catch (error) {
			if (allowMissing && (error as NodeJS.ErrnoException).code === "ENOENT") return;
			throw error;
		}
	}
}

export function deliveredRuns(parent: ReadonlySessionManager): Set<string> {
	const file = parent.getSessionFile();
	if (!file) return new Set();
	const path = resolve(`${file}.children`, "delivered");
	checkPath(path, true, file);
	try { return new Set(readFileSync(path, "utf8").split("\n").filter(Boolean)); }
	catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Set(); throw error; }
}

export function recordDelivery(parent: ReadonlySessionManager, run: string): void {
	const file = parent.getSessionFile();
	if (!file) return;
	const path = resolve(`${file}.children`, "delivered");
	checkPath(path, true, file);
	mkdirSync(dirname(path), { recursive: true });
	appendFileSync(path, `${run}\n`, "utf8");
}

export function createChildManager(parent: ReadonlySessionManager, cwd: string, kind: string, id: number, seed?: SessionEntry[]): SessionManager {
	if (seed) return retainChild(parent, kind, id, SessionManager.inMemory(cwd, undefined, seed));
	const directory = childDirectory(parent, kind, id);
	if (!directory) return retainChild(parent, kind, id, SessionManager.inMemory(cwd));
	checkPath(parent.getSessionFile()!, true, parent.getSessionFile()!);
	checkPath(directory, true, parent.getSessionFile()!);
	return retainChild(parent, kind, id, SessionManager.create(cwd, directory, { parentSession: parent.getSessionFile() }));
}

export function openChildManager(parent: ReadonlySessionManager, childFile: string, cwd: string, kind: string, id: number): SessionManager {
	const directory = childDirectory(parent, kind, id);
	if (!directory) throw new Error("Cannot open a durable child of an in-memory parent");
	const file = resolve(childFile);
	const owned = relative(directory, file);
	if (!owned || owned === ".." || owned.startsWith(`..${sep}`) || isAbsolute(owned)) {
		throw new Error("Child session file is outside its owned directory");
	}
	checkPath(parent.getSessionFile()!, false, parent.getSessionFile()!);
	checkPath(file, false, parent.getSessionFile()!);
	const actual = relative(realpathSync(directory), realpathSync(file));
	if (!actual || actual === ".." || actual.startsWith(`..${sep}`) || isAbsolute(actual)) {
		throw new Error("Child session file resolves outside its owned directory");
	}
	if (!lstatSync(directory).isDirectory() || !lstatSync(file).isFile()) {
		throw new Error("Child session must be a regular file in its owned directory");
	}
	return retainChild(parent, kind, id, SessionManager.open(file, directory, cwd));
}

export function repairInterrupted(session: AgentSession): boolean {
	const manager = session.sessionManager;
	const projection = manager.buildSessionProjection();
	const visible = projection.entries.flatMap(entry => entry.messages.map(message => ({ message, id: entry.sourceEntry.id })));
	const hidden: string[] = [];
	while (visible.length) {
		const last = visible.at(-1)!;
		if (last.message.role !== "assistant" || !["aborted", "error"].includes(last.message.stopReason)
			|| last.message.content.some(part => part.type === "toolCall")) break;
		hidden.push(last.id);
		visible.pop();
	}
	const pending = new Map<string, { id: string; name: string }>();
	for (const { message } of visible) {
		if (message.role === "toolResult") {
			pending.delete(message.toolCallId);
			continue;
		}
		if (message.role === "system") continue;
		if (pending.size) {
			throw new Error("Unsafe recovery: an interrupted tool call precedes later conversation; inspect the session before resuming");
		}
		if (message.role === "assistant") {
			for (const part of message.content) {
				if (part.type === "toolCall") pending.set(part.id, { id: part.id, name: part.name });
			}
		}
	}
	for (const id of hidden) manager.appendContextEdit(id, null);
	for (const call of pending.values()) {
		manager.appendMessage({
			role: "toolResult", toolCallId: call.id, toolName: call.name,
			content: [{ type: "text", text: INTERRUPTED }], isError: true, timestamp: Date.now(),
		});
	}
	const messages = manager.buildSessionProjection().messages;
	session.agent.state.messages = messages;
	return messages.some(message => message.role === "user") && messages.at(-1)?.role !== "assistant";
}
