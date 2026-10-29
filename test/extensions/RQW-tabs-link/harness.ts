// Fakes for Pi and the clock; the extension's own code always runs for real.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { duplexPair, type Duplex } from "node:stream";
import type { TestContext } from "node:test";
import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { createTabsLink, type Deps } from "../../../extensions/RQW-tabs-link/index.ts";
import { nodeSessionFs } from "../../../extensions/RQW-tabs-link/registry.ts";
import type { NetLike } from "../../../extensions/RQW-tabs-link/transport.ts";

/** In-memory stand-in for node:net: ports are numbers, sockets are stream pairs. `written` records server frames. */
export function fakeNet(): NetLike & { written: Buffer[]; silent: Set<number>; onServerClose?: () => void; connections: number; muted: (connection: number) => boolean } {
	const servers = new Map<number, (socket: Duplex) => void>();
	const written: Buffer[] = [];
	const silent = new Set<number>();
	let next = 40000;
	const net: ReturnType<typeof fakeNet> = {
		written, silent, connections: 0, muted: () => false,
		createServer(onSocket) {
			let port = 0;
			return {
				listen: (_port, _host, callback) => { port = next++; servers.set(port, onSocket); queueMicrotask(callback); },
				address: () => ({ port }),
				close: () => { net.onServerClose?.(); servers.delete(port); },
				once: () => {},
			};
		},
		connect(port) {
			const connection = ++net.connections;
			const [client, server] = duplexPair();
			const accept = servers.get(port);
			if (!accept) {
				queueMicrotask(() => client.destroy(Object.assign(new Error("refused"), { code: "ECONNREFUSED" })));
			} else if (!silent.has(port)) {
				const write = server.write.bind(server);
				// `muted` loses every answer of the server, as a broken return path would.
				server.write = ((chunk: Buffer | string, ...rest: unknown[]) => { written.push(Buffer.from(chunk)); return net.muted(connection) ? true : (write as any)(chunk, ...rest); }) as typeof server.write;
				queueMicrotask(() => accept(server));
			}
			return client;
		},
	};
	return net;
}

type Handler = (event: any, ctx: any) => unknown;
type FakeModel = { provider: string; id: string; api?: string };
/** The api of the fake models; a test registers a provider for it at pi-ai's real provider registry. */
export const FAKE_API = "rqw-tabs-fake-api";

/** The state of one fake Pi session that the extension reads and changes through the public API. */
export type World = {
	idle: boolean;
	model: FakeModel | undefined;
	level: string;
	models: FakeModel[];
	entries: any[];
	sent: { message: any; options: any }[];
	/** When true, Pi records a sent message at once, as it does for an idle chat. */
	autoRecord: boolean;
	/** Ids of models whose provider has no credentials. */
	noAuth: Set<string>;
	/** A process that died: nothing the extension does afterwards reaches Pi or the history. */
	crashed: boolean;
	/** The process dies right after a model change took effect. */
	crashAfterSetModel?: boolean;
	/** The level Pi settles on after any model change, as capability clamping does. */
	clampLevel?: string;
	/** When true, selecting a model fails, as with a provider whose login has lapsed. */
	setModelFails?: boolean | "throw";
	/** Names of the tools the model currently sees. */
	active: string[];
};

export type Tab = {
	pi: ExtensionAPI;
	handlers: Map<string, Handler[]>;
	tools: ToolDefinition[];
	notices: string[];
	session: { id: string; name?: string; file?: string };
	world: World;
	ctx: (mode?: string) => ExtensionContext;
	fire(name: string, event?: object, mode?: string): Promise<unknown>;
	/** Runs a registered tool as the model would. */
	run(name: string, params: object, callId?: string): Promise<any>;
};

export function tempDir(t: TestContext): string {
	const dir = mkdtempSync(join(tmpdir(), "tabs-link-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	return dir;
}

/** One fake Pi tab running the real extension; `alive` says which fake pids are running processes. */
export function openTab(deps: Partial<Deps> & { dir: string }, id: string, extra: Partial<Deps> = {}): Tab {
	let clock = 1000;
	let tokens = 0;
	const all: Deps = {
		pid: 100, now: () => ++clock, newId: () => `instance-${id}`, isAlive: () => true,
		newSecret: () => `secret-${id}`, newGeneration: () => `gen-${id}-${++tokens}`, net: fakeNet(), pingTimeoutMs: 50, requestTimeoutMs: 2000,
		sessionFs: nodeSessionFs, sessionsRoot: join(deps.dir, "no-sessions"), ...deps, ...extra,
	};
	const handlers = new Map<string, Handler[]>();
	const tools: ToolDefinition[] = [];
	const model: FakeModel = { provider: "p", id: "owner", api: FAKE_API };
	const world: World = { idle: true, model, level: "medium", models: [model, { provider: "p", id: "other", api: FAKE_API }], entries: [], sent: [], autoRecord: true, active: ["tool_search"], noAuth: new Set(), crashed: false };
	let seq = 0;
	const fire = async (name: string, event: object = {}, mode?: string) => {
		let result: unknown;
		for (const handler of handlers.get(name) ?? []) result = await handler({ type: name, ...event }, ctx(mode));
		return result;
	};
	const pi = {
		on: (name: string, handler: Handler) => { handlers.set(name, [...(handlers.get(name) ?? []), handler]); },
		registerTool: (tool: ToolDefinition) => {
			tools.push(tool);
			const exposure = tool.exposure ?? "direct";
			if ((exposure === "direct" || exposure === "model-only") && tool.defaultActive !== false) world.active.push(tool.name);
		},
		getActiveTools: () => [...world.active],
		setActiveTools: (names: string[]) => { world.active = [...names]; },
		getAllTools: () => tools.map(tool => ({ name: tool.name, description: tool.description, parameters: tool.parameters, exposure: tool.exposure ?? "direct" })),
		appendEntry: (customType: string, data: unknown) => { if (world.crashed) return; world.entries.push({ id: `e${++seq}`, type: "custom", customType, data }); },
		sendMessage: (message: any, options: any) => {
			if (world.crashed) return;
			world.sent.push({ message, options });
			if (!world.autoRecord) return;
			queueMicrotask(async () => {
				await fire("message_start", { message: { role: "custom", ...message } });
				world.entries.push({ id: `e${++seq}`, type: "custom_message", ...message });
				await fire("message_end", { message: { role: "custom", ...message } });
			});
		},
		setModel: async (next: FakeModel) => { if (world.setModelFails === "throw") throw new Error("No API key for provider p"); if (world.crashed) return true; if (world.setModelFails) return false; world.model = next; if (world.clampLevel) world.level = world.clampLevel; if (world.crashAfterSetModel) world.crashed = true; await fire("model_select", { model: next, source: "set" }); return true; },
		getThinkingLevel: () => world.level,
		setThinkingLevel: (level: string) => { if (world.crashed) return; world.level = level; void fire("thinking_level_select", { level }); },
	} as unknown as ExtensionAPI;
	createTabsLink(all)(pi);
	const notices: string[] = [];
	const session: Tab["session"] = { id, file: `/sessions/${id}.jsonl` };
	const ctx = (mode = "tui") => ({
		mode,
		get model() { return world.model; },
		isIdle: () => world.idle,
		modelRegistry: { hasConfiguredAuth: (m: FakeModel) => !world.noAuth.has(m.id), getAvailable: () => world.models, find: (provider: string, name: string) => world.models.find(m => m.provider === provider && m.id === name) },
		sessionManager: {
			getSessionId: () => session.id, getSessionName: () => session.name, getCwd: () => "/work",
			getSessionFile: () => session.file, getSessionDir: () => "/sessions",
			getEntries: () => world.entries, getBranch: () => world.entries,
		},
		ui: { notify: (message: string) => notices.push(message) },
	}) as unknown as ExtensionContext;
	const run = (name: string, params: object, callId = "call-1") =>
		tools.find(tool => tool.name === name)!.execute(callId, params as never, undefined, undefined, ctx() as never);
	return { pi, handlers, tools, notices, session, world, ctx, fire, run };
}

/** A receiving and a sending tab on one registry and one network, both started. */
export async function pairOfTabs(t: TestContext) {
	const dir = tempDir(t);
	const net = fakeNet();
	const recv = openTab({ dir, net }, "recv");
	const send = openTab({ dir, net }, "send");
	await recv.fire("session_start", { reason: "startup" });
	await send.fire("session_start", { reason: "startup" });
	return { recv, send, dir, net };
}
