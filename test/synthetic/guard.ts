// Everything the synthetic world fences off and gives back: Pi prototypes, process environment, network, processes, exit.
import childProcess from "node:child_process";
import dgram from "node:dgram";
import { EventEmitter } from "node:events";
import http from "node:http";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
import net from "node:net";
import { basename } from "node:path";
import { PassThrough } from "node:stream";
import tls from "node:tls";
import type { TestContext } from "node:test";
import * as codingAgent from "@earendil-works/pi-coding-agent";
import * as tui from "@earendil-works/pi-tui";

type Target = object;
type Snapshot = Map<Target, PropertyDescriptorMap>;

/** Every class Pi exports: its prototype and its statics. Extensions patch these in memory. */
function patchableTargets(): Target[] {
	const targets: Target[] = [];
	for (const exports of [codingAgent, tui] as Record<string, unknown>[]) {
		for (const value of Object.values(exports)) {
			if (typeof value !== "function" || typeof value.prototype !== "object") continue;
			targets.push(value, value.prototype);
		}
	}
	return targets;
}

function takeSnapshot(): Snapshot {
	const snapshot: Snapshot = new Map();
	for (const target of patchableTargets()) snapshot.set(target, Object.getOwnPropertyDescriptors(target));
	return snapshot;
}

function restoreSnapshot(snapshot: Snapshot): void {
	for (const [target, descriptors] of snapshot) {
		for (const key of Reflect.ownKeys(target)) {
			if (key in descriptors) continue;
			const own = Object.getOwnPropertyDescriptor(target, key);
			if (own?.configurable) Reflect.deleteProperty(target, key);
		}
		for (const key of Reflect.ownKeys(descriptors)) {
			const original = descriptors[key as string];
			const current = Object.getOwnPropertyDescriptor(target, key);
			if (!current || !sameDescriptor(current, original)) {
				if (!current || current.configurable) Object.defineProperty(target, key, original);
			}
		}
	}
}

function sameDescriptor(a: PropertyDescriptor, b: PropertyDescriptor): boolean {
	return a.value === b.value && a.get === b.get && a.set === b.set && a.writable === b.writable && a.enumerable === b.enumerable;
}

/**
 * Names of the prototype and static members that differ from the snapshot. Non-configurable members are left out:
 * they are the permanent, reference-counted state slots some extensions define once (`Object.defineProperty` without
 * `configurable`), which nothing can remove and which hold no patch themselves.
 */
export function patchedMembers(snapshot: Snapshot): string[] {
	const names: string[] = [];
	for (const [target, descriptors] of snapshot) {
		for (const key of Reflect.ownKeys(target)) {
			const current = Object.getOwnPropertyDescriptor(target, key)!;
			if (!current.configurable) continue;
			const original = descriptors[key as string];
			if (!original || !sameDescriptor(current, original)) names.push(`${describeTarget(target)}.${String(key)}`);
		}
		// An original member that is gone counts as changed too.
		for (const key of Reflect.ownKeys(descriptors)) {
			if (!Object.getOwnPropertyDescriptor(target, key)) names.push(`${describeTarget(target)}.${String(key)}`);
		}
	}
	return names.sort();
}

function describeTarget(target: Target): string {
	if (typeof target === "function") return `${target.name}(static)`;
	return `${(target as { constructor: { name: string } }).constructor.name}.prototype`;
}

/** `Symbol.for("rqw:...")` slots that extensions leave on globalThis. */
function globalSymbols(): Map<symbol, PropertyDescriptor> {
	const slots = new Map<symbol, PropertyDescriptor>();
	for (const key of Object.getOwnPropertySymbols(globalThis)) slots.set(key, Object.getOwnPropertyDescriptor(globalThis, key)!);
	return slots;
}

function restoreGlobalSymbols(before: Map<symbol, PropertyDescriptor>): void {
	for (const key of Object.getOwnPropertySymbols(globalThis)) {
		if (!before.has(key)) Reflect.deleteProperty(globalThis, key);
	}
	for (const [key, descriptor] of before) Object.defineProperty(globalThis, key, descriptor);
}

function restoreEnvironment(before: NodeJS.ProcessEnv): void {
	for (const key of Object.keys(process.env)) if (!(key in before)) delete process.env[key];
	Object.assign(process.env, before);
}

/** What the world must give back: Pi prototypes and statics, rqw globals, environment. patchedMembers() reads the same snapshot. */
export function guardProcess() {
	const snapshot = takeSnapshot();
	const symbols = globalSymbols();
	const environment = { ...process.env };
	return {
		snapshot,
		restore() {
			restoreSnapshot(snapshot);
			restoreGlobalSymbols(symbols);
			restoreEnvironment(environment);
		},
	};
}

/** A process the scenario asked for was never faked, or a network call was never routed. */
export class BlockedCall extends Error {}

type NetworkHandler = (...args: any[]) => any;
type NetworkMatch = (...args: any[]) => boolean;
type NetworkRule = { match: NetworkMatch; answer: NetworkHandler };

/** Routes can be prepared before world(), and are retained across restart. */
export function networkRoutes() {
	const rules: Record<"fetch" | "https" | "ws", NetworkRule[]> = { fetch: [], https: [], ws: [] };
	return {
		fetch(match: NetworkMatch, answer: NetworkHandler) { rules.fetch.push({ match, answer }); },
		https(match: NetworkMatch, answer: NetworkHandler) { rules.https.push({ match, answer }); },
		/** ws uses http.request or https.request for its WebSocket upgrade. */
		ws(match: NetworkMatch, answer: NetworkHandler) { rules.ws.push({ match, answer }); },
		find(kind: keyof typeof rules, args: any[]) { return rules[kind].find((rule) => rule.match(...args)); },
	};
}

/** Unrouted calls are recorded and blocked. No route can reach the real network. */
export function blockNetwork(t: TestContext, attempts: string[], routes: ReturnType<typeof networkRoutes>): void {
	const block = (name: string) => () => {
		attempts.push(name);
		throw new BlockedCall(`synthetic world: network blocked: ${name}`);
	};
	const fetchBlocked = block("fetch");
	const request = (name: "http.request" | "https.request") => (...args: any[]) => {
		const options = args.find((arg) => arg && typeof arg === "object" && arg.headers);
		const headers = options?.headers ?? {};
		const isUpgrade = Object.entries(headers).some(([key, value]) => key.toLowerCase() === "upgrade" && String(value).toLowerCase() === "websocket");
		const rule = isUpgrade ? routes.find("ws", args) : name === "https.request" ? routes.find("https", args) : undefined;
		return rule ? rule.answer(...args) : block(name)();
	};
	t.mock.method(globalThis, "fetch", ((...args: any[]) => {
		const rule = routes.find("fetch", args);
		return rule ? rule.answer(...args) : fetchBlocked();
	}) as typeof fetch);
	t.mock.method(globalThis, "WebSocket" as "fetch", block("WebSocket") as never);
	t.mock.method(http, "request", request("http.request") as never);
	t.mock.method(http, "get", block("http.get"));
	t.mock.method(https, "request", request("https.request") as never);
	t.mock.method(https, "get", block("https.get"));
	t.mock.method(net.Socket.prototype, "connect", block("net.Socket.connect"));
	t.mock.method(tls, "connect", block("tls.connect"));
	t.mock.method(dgram, "createSocket", block("dgram.createSocket") as never);
	for (const method of ["bind", "connect", "send"] as const) t.mock.method(dgram.Socket.prototype, method, block(`dgram.Socket.${method}`) as never);
	syncBuiltinESMExports();
}

/** A `--version` probe of an external tool, as Pi runs for `fd` and `rg` at startup. */
function isVersionProbe(args: readonly string[] | undefined): boolean {
	return args?.length === 1 && args[0] === "--version";
}

/** One `child_process.spawn` the code under test made. For a shell, `args.at(-1)` is the command line. */
export interface ProcessCall {
	command: string;
	args: string[];
	cwd?: string;
}

/** What a fake process prints and how it ends. */
export interface ProcessAnswer {
	stdout?: string;
	stderr?: string;
	code?: number;
}

export type ProcessMatch = (call: ProcessCall) => boolean;

/** A spawned process kept running until the test finishes it. */
export interface RunningProcess {
	/** True once a matching process was started and runs. */
	readonly arrived: boolean;
	readonly call: ProcessCall | undefined;
	/** Ends the process, now or before it starts. */
	finish(answer?: ProcessAnswer): void;
}

type ProcessRule = { match: ProcessMatch; answer?: ProcessAnswer | ((call: ProcessCall) => ProcessAnswer); hold?: HeldProcess };
type HeldProcess = RunningProcess & { arrived: boolean; call: ProcessCall | undefined; done: Promise<ProcessAnswer>; settle(answer: ProcessAnswer): void };

const FIRST_FAKE_PID = 2_000_000_000;

/**
 * Pi's own `--version` probe of fd and rg gets an answer. `spawn` goes through the rules the test adds with
 * `reply` and `hold`; `spawnSync` uses `reply`. A call no rule takes, and every other child_process entry, is recorded in `attempts` and throws.
 * Fake processes finish in real turns, never in timers. Their pids are far above any real one.
 */
export function fakeProcesses(t: TestContext, attempts: string[]) {
	const rules: ProcessRule[] = [];
	const calls: ProcessCall[] = [];
	const running = new Map<number, { kill(): void }>();
	let nextPid = FIRST_FAKE_PID;

	const block = (name: string) => (command: string, ...rest: unknown[]) => {
		const args = Array.isArray(rest[0]) ? (rest[0] as string[]) : undefined;
		if (name === "spawnSync" && /^(fd|rg)(\.exe)?$/i.test(basename(command)) && isVersionProbe(args)) return { status: 0, stdout: Buffer.from("tool 1.0"), stderr: Buffer.alloc(0), error: undefined };
		attempts.push(`${name} ${command}`);
		throw new BlockedCall(`synthetic world: process blocked: ${name} ${command}`);
	};
	for (const name of ["exec", "execSync", "execFile", "execFileSync", "fork"] as const) t.mock.method(childProcess, name, block(name) as never);
	t.mock.method(childProcess, "spawnSync", ((command: string, argsOrOptions?: unknown, maybeOptions?: unknown) => {
		const args = Array.isArray(argsOrOptions) ? (argsOrOptions as string[]) : [];
		const options = (Array.isArray(argsOrOptions) ? maybeOptions : argsOrOptions) as { cwd?: string; encoding?: string } | undefined;
		const call: ProcessCall = { command, args, cwd: options?.cwd };
		if (/^(fd|rg)(\.exe)?$/i.test(basename(command)) && isVersionProbe(args)) return block("spawnSync")(command, args);
		const rule = rules.find((item) => !item.hold && item.match(call));
		if (!rule) return block("spawnSync")(command, args);
		calls.push(call);
		const answer = typeof rule.answer === "function" ? rule.answer(call) : (rule.answer ?? {});
		const output = (value: string | undefined) => options?.encoding && options.encoding !== "buffer" ? (value ?? "") : Buffer.from(value ?? "");
		const stdout = output(answer.stdout);
		const stderr = output(answer.stderr);
		return { pid: 0, output: [null, stdout, stderr], stdout, stderr, status: answer.code ?? 0, signal: null };
	}) as never);

	const fakeChild = (settled: Promise<ProcessAnswer>) => {
		const child: any = new EventEmitter();
		child.pid = nextPid++;
		child.stdout = new PassThrough();
		child.stderr = new PassThrough();
		child.stdin = null;
		child.killed = false;
		child.exitCode = null;
		child.signalCode = null;
		child.ref = () => child;
		child.unref = () => child;
		let ended = false;
		const end = (answer: ProcessAnswer, killed: boolean) => {
			if (ended) return;
			ended = true;
			running.delete(child.pid);
			if (answer.stderr) child.stderr.write(answer.stderr);
			if (answer.stdout) child.stdout.write(answer.stdout);
			child.stdout.end();
			child.stderr.end();
			child.exitCode = killed ? null : (answer.code ?? 0);
			child.signalCode = killed ? "SIGKILL" : null;
			// A real process closes after its output has been read.
			child.stdout.once("end", () => setImmediate(() => {
				child.emit("exit", child.exitCode, child.signalCode);
				child.emit("close", child.exitCode, child.signalCode);
			}));
		};
		child.kill = () => { child.killed = true; end({}, true); return true; };
		running.set(child.pid, child);
		void settled.then((answer) => end(answer, false));
		return child;
	};

	t.mock.method(childProcess, "spawn", ((command: string, argsOrOptions?: unknown, maybeOptions?: unknown) => {
		const args = Array.isArray(argsOrOptions) ? (argsOrOptions as string[]) : [];
		const options = (Array.isArray(argsOrOptions) ? maybeOptions : argsOrOptions) as { cwd?: string } | undefined;
		const call: ProcessCall = { command, args, cwd: options?.cwd };
		const rule = rules.find((item) => item.match(call) && (!item.hold || !item.hold.arrived));
		if (!rule) {
			attempts.push(`spawn ${command}`);
			throw new BlockedCall(`synthetic world: process blocked: spawn ${command} ${args.join(" ")}`);
		}
		calls.push(call);
		if (rule.hold) {
			rule.hold.arrived = true;
			rule.hold.call = call;
			return fakeChild(rule.hold.done);
		}
		const answer = typeof rule.answer === "function" ? rule.answer(call) : (rule.answer ?? {});
		return fakeChild(Promise.resolve(answer));
	}) as never);

	// Pi kills a shell's process group by pid; a fake pid must never reach a real process.
	const kill = process.kill;
	t.mock.method(process, "kill", ((pid: number, signal?: string | number) => {
		const child = running.get(Math.abs(pid));
		if (!child) return kill.call(process, pid, signal);
		child.kill();
		return true;
	}) as never);

	return {
		/** Every spawn a rule took, in order. */
		calls: calls as readonly ProcessCall[],
		/** Every spawn matching `match` ends with `answer`, which may be computed from the call. */
		reply(match: ProcessMatch, answer: ProcessAnswer | ((call: ProcessCall) => ProcessAnswer)) { rules.push({ match, answer }); },
		/** The first spawn matching `match` keeps running until `finish` is called. */
		hold(match: ProcessMatch): RunningProcess {
			let settle!: (answer: ProcessAnswer) => void;
			const done = new Promise<ProcessAnswer>((resolve) => { settle = resolve; });
			const held: HeldProcess = { arrived: false, call: undefined, done, settle, finish: (answer = {}) => settle(answer) };
			rules.push({ match, hold: held });
			return held;
		},
		/** Ends every process still running, so nothing hangs after the test. */
		release() { for (const child of [...running.values()]) child.kill(); },
	};
}

/** Pi calls process.exit on quit; the world records the code and carries on. */
export function trapExit(t: TestContext, codes: number[]): void {
	t.mock.method(process, "exit", ((code?: number) => { codes.push(code ?? 0); }) as never);
}
