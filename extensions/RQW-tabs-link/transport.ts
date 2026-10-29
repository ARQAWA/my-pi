import { randomUUID, timingSafeEqual } from "node:crypto";
import type { Duplex } from "node:stream";
import type { Liveness, Owner } from "./ownership.ts";
import { Assembler, chunkResult, encode, type ErrorCode, type Frame, FrameReader, type Request } from "./protocol.ts";

/** The slice of node:net used here; tests put an in-memory one in its place. */
type ServerLike = {
	listen(port: number, host: string, callback: () => void): unknown;
	address(): { port: number } | string | null;
	close(): unknown;
	once(event: "error", listener: (error: Error) => void): unknown;
};
export type NetLike = {
	createServer(onSocket: (socket: Duplex) => void): ServerLike;
	connect(port: number, host: string): Duplex;
};

export const HOST = "127.0.0.1";
export type Handler = (params: unknown) => unknown;
export type Auth = { secret: string; generation: () => string; instanceId: string };
export type Server = { port: number; close(): void };

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Serves the handlers on a random local port; a request needs the secret and the current generation. */
export function startServer(net: NetLike, auth: Auth, handlers: Record<string, Handler>): Promise<Server> {
	const sockets = new Set<Duplex>();
	const server = net.createServer(socket => {
		sockets.add(socket);
		socket.on("close", () => sockets.delete(socket));
		socket.on("error", () => socket.destroy());
		const reader = new FrameReader();
		const reply = (frames: Frame[]) => { for (const frame of frames) socket.write(encode(frame)); };
		const fail = (id: string, code: ErrorCode) => reply([{ v: 1, id, error: { code } }]);
		socket.on("data", async data => {
			let requests: unknown[];
			try { requests = reader.push(data); } catch { return socket.destroy(); }
			for (const raw of requests) {
				const request = raw as Partial<Request>;
				if (typeof request?.id !== "string" || typeof request.op !== "string") { socket.destroy(); return; }
				// Identity needs no secret: it only tells who listens here, which is what a liveness check asks.
				if (request.op === "who") { reply(chunkResult(request.id, { instanceId: auth.instanceId, generation: auth.generation() })); continue; }
				if (typeof request.secret !== "string" || !same(request.secret, auth.secret)) { fail(request.id, "unauthorized"); continue; }
				if (request.generation !== auth.generation()) { fail(request.id, "stale_generation"); continue; }
				const handler = Object.hasOwn(handlers, request.op) ? handlers[request.op] : undefined;
				if (!handler) { fail(request.id, "unknown_op"); continue; }
				try { reply(chunkResult(request.id, await handler(request.params))); } catch { fail(request.id, "internal"); }
			}
		});
	});
	return new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, HOST, () => {
			const address = server.address();
			if (typeof address !== "object" || !address) return reject(new Error("no port"));
			resolve({ port: address.port, close: () => { server.close(); for (const socket of sockets) socket.destroy(); } });
		});
	});
}

export type Target = { port: number; secret: string; generation: string };
export type Outcome = { ok: true; result: unknown } | { ok: false; code: ErrorCode | "refused" | "unreachable" | "timeout" | "protocol" };

/** One request and its answer; a silent peer ends as `timeout`, which proves nothing about the chat. */
export function request(net: NetLike, target: Target, op: string, params: unknown, timeoutMs: number): Promise<Outcome> {
	return new Promise(resolve => {
		const id = randomUUID();
		const assembler = new Assembler();
		const reader = new FrameReader();
		const socket = net.connect(target.port, HOST);
		const finish = (outcome: Outcome) => { clearTimeout(timer); socket.destroy(); resolve(outcome); };
		const timer = setTimeout(() => finish({ ok: false, code: "timeout" }), timeoutMs);
		socket.on("error", (error: NodeJS.ErrnoException) => finish({ ok: false, code: error.code === "ECONNREFUSED" ? "refused" : "unreachable" }));
		socket.on("close", () => finish({ ok: false, code: "unreachable" }));
		socket.on("data", data => {
			try {
				for (const raw of reader.push(data)) {
					const frame = raw as Partial<Frame> & { error?: { code: ErrorCode }; chunk?: string };
					if (frame.id !== id) throw new Error("foreign frame");
					if (frame.error) return finish({ ok: false, code: frame.error.code });
					const done = assembler.add(frame as Extract<Frame, { chunk: string }>);
					if (done) return finish({ ok: true, result: done.result });
				}
			} catch { finish({ ok: false, code: "protocol" }); }
		});
		socket.write(encode({ v: 1, id, op, generation: target.generation, secret: target.secret, params }));
	});
}

/**
 * Whether the holder of a lock is still there. A dead process, a refused connection or another identity answering is
 * confirmed death; a process id alone proves nothing, as ids are reused. A silent holder stays unknown.
 */
export async function confirmOwner(net: NetLike, isAlive: (pid: number) => boolean, owner: Owner, timeoutMs: number): Promise<Liveness> {
	if (!isAlive(owner.pid)) return "dead";
	const outcome = await request(net, { port: owner.port, secret: "", generation: "" }, "who", undefined, timeoutMs);
	if (outcome.ok) {
		const who = outcome.result as { instanceId?: unknown; generation?: unknown } | null;
		return who?.instanceId === owner.instanceId && who.generation === owner.generation ? "alive" : "dead";
	}
	return outcome.code === "refused" ? "dead" : "unknown";
}
