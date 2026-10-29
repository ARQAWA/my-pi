import { appendFileSync, closeSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import * as codingAgent from "@earendil-works/pi-coding-agent";
import * as ai from "@earendil-works/pi-ai";
import * as providers from "@earendil-works/pi-ai/providers/all";
import * as tui from "@earendil-works/pi-tui";
import * as typebox from "typebox";
import * as typeboxCompile from "typebox/compile";
import { isKeyRelease, matchesKey } from "@earendil-works/pi-tui";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const widget = "submit-timing-frame";
const measured = ["input", "before_agent_start", "agent_start", "turn_start", "message_start", "message_end", "context", "session_before_compact", "session_compact", "session_compact_failed"];
const safely = (fn: () => void) => { try { fn(); } catch { /* Instrumentation must not affect Pi. */ } };

type Clock = { now(): number; utilization(previous?: any): any };
type Sample = {
  started: number; first: boolean; counts: any; elu: any; handlers: { extension: string; event: string; ms: number }[];
  marks: Record<string, number>; frame?: number; frameSource?: string; detachAbort?: () => void;
};

export function instrument(pi: any, clock: Clock, write: (line: object) => void, defer: (fn: () => void) => void = setImmediate) {
  let current: Sample | undefined;
  let first = true;
  let dispose: (() => void) | undefined;
  const pending: object[] = [];
  const flush = () => { for (const line of pending.splice(0)) safely(() => write(line)); };
  const sources = new Set<any>();
  const accept = (source: any) => safely(() => { if (source?.version === 1 && typeof source.snapshot === "function") sources.add(source); });
  safely(() => pi.events.on("rqw:running-counts:offer", (offer: any) => safely(() => { if (offer?.version === 1) accept(offer.source); })));
  const counts = () => [...sources].reduce((sum, source) => {
    const value = source.snapshot();
    return { agents: sum.agents + (value.agents ?? 0), reviews: sum.reviews + (value.reviews ?? 0) };
  }, { agents: 0, reviews: 0 });
  const begin = () => safely(() => {
    if (current) finish("superseded");
    current = { started: clock.now(), first, counts: counts(), elu: clock.utilization(), handlers: [], marks: {} };
  });
  const finish = (outcome: string) => safely(() => {
    const s = current;
    if (!s) return;
    current = undefined;
    safely(() => s.detachAbort?.());
    const m = s.marks;
    const duration = (a: number | undefined, b: number | undefined) => a === undefined || b === undefined ? null : b - a;
    const subtract = (a: number | undefined, b: number | undefined, events: string[]) => {
      const d = duration(a, b);
      return d === null ? null : d - s.handlers.filter(h => events.includes(h.event)).reduce((n, h) => n + h.ms, 0);
    };
    const line = { outcome, first: s.first, running: s.counts, eventLoop: clock.utilization(s.elu),
      enterToFrameMs: duration(s.started, s.frame), frameSource: s.frameSource ?? null,
      handlers: s.handlers, marks: Object.fromEntries(Object.entries(m).map(([key, value]) => [key, value - s.started])),
      pi: { authAndTemplatesMs: duration(m.inputEnd, m.compactStart ?? m.beforeStart),
        compactionMs: duration(m.compactStart, m.compactEnd),
        beforeToAgentMs: duration(m.beforeEnd, m.agentStart),
        agentToMessageMs: subtract(m.agentStart, m.messageEnd, ["agent_start", "turn_start", "message_start"]) } };
    if (outcome === "frame") {
      pending.push(line);
      defer(flush);
    } else {
      flush();
      safely(() => write(line));
    }
  });
  const on = (event: string, fn: (...args: any[]) => void) => safely(() => pi.on(event, (...args: any[]) => safely(() => fn(...args))));
  safely(() => pi.events.on("rqw-statusbar:pending-frame", () => safely(() => {
    if (current && current.frame === undefined) { current.frame = clock.now(); current.frameSource = "pending-frame"; }
  })));
  on("session_start", (_event: any, ctx: any) => {
    first = true; sources.clear();
    pi.events.emit("rqw:running-counts:request", { version: 1, reply: accept });
    dispose?.();
    if (!ctx.hasUI) return;
    dispose = ctx.ui.onTerminalInput((data: string) => safely(() => {
      if (!isKeyRelease(data) && matchesKey(data, "enter") && ctx.ui.getEditorText().trim()) begin();
    }));
  });
  on("session_tree", () => { first = true; });
  on("session_shutdown", () => { safely(() => dispose?.()); finish("shutdown"); flush(); });
  on("agent_end", () => { if (current && current.marks.messageStart === undefined) finish("agent_end"); });
  for (const event of measured) on(event, (value: any, ctx: any) => {
    if (event === "input" && !current && value.source === "interactive") begin();
    if (!current) return;
    const m = current.marks;
    if (event === "session_before_compact") m.compactStart = clock.now();
    if (event === "session_compact" || event === "session_compact_failed") m.compactEnd = clock.now();
    if (event === "before_agent_start") {
      m.beforeStart = clock.now(); first = false;
      const sample = current;
      const signal = ctx.signal;
      if (signal) {
        const abort = () => { if (current === sample && sample.marks.messageStart === undefined) finish("abort"); };
        signal.addEventListener("abort", abort, { once: true });
        sample.detachAbort = () => signal.removeEventListener("abort", abort);
        if (signal.aborted) abort();
      }
    }
    if (event === "agent_start") m.agentStart = clock.now();
    if (event === "message_start" && value.message?.role === "user") m.messageStart = clock.now();
  });
  return {
    wrap(name: string) {
      return new Proxy(pi, { get(target, key, receiver) {
        if (key !== "on") return Reflect.get(target, key, receiver);
        return (event: string, handler: (...args: any[]) => any) => target.on(event, (...args: any[]) => {
          const sample = current;
          if (!sample) return handler(...args);
          let start: number | undefined;
          safely(() => { start = clock.now(); });
          const record = () => safely(() => { if (start !== undefined) sample.handlers.push({ extension: name, event, ms: clock.now() - start }); });
          const completed = (value: any) => {
            record();
            safely(() => { if (event === "input" && value?.action === "handled" && current === sample) finish("handled"); });
            return value;
          };
          let result: any;
          try { result = handler(...args); } catch (error) { record(); throw error; }
          let thenable = false;
          safely(() => { thenable = result != null && typeof result.then === "function"; });
          if (thenable) return Promise.resolve(result).then(completed, (error: unknown) => { record(); throw error; });
          return completed(result);
        });
      } });
    },
    endMarkers() {
      on("input", () => { if (current) current.marks.inputEnd = clock.now(); });
      on("before_agent_start", () => { if (current) current.marks.beforeEnd = clock.now(); });
      on("message_start", (event: any, ctx: any) => {
        if (!current || event.message?.role !== "user") return;
        current.marks.messageEnd = clock.now();
        if (!ctx.hasUI) { finish("no-ui"); return; }
        const sample = current;
        ctx.ui.setWidget(widget, () => ({ invalidate() {}, render() {
          safely(() => {
            if (current === sample) {
              if (sample.frame === undefined) { sample.frame = clock.now(); sample.frameSource = "widget"; }
              finish("frame");
              queueMicrotask(() => safely(() => ctx.ui.setWidget(widget, undefined)));
            }
          });
          return [];
        } }));
      });
    },
  };
}

export default async function submitTiming(pi: any) {
  if (!process.argv.includes("-ne") && !process.argv.includes("--no-extensions")) {
    console.warn(`submit-timing disabled: run pi -ne -e "${fileURLToPath(import.meta.url)}"`);
    return;
  }
  let timing: ReturnType<typeof instrument> | undefined;
  safely(() => {
    const directory = join(homedir(), ".pi", "agent", "submit-timing");
    mkdirSync(directory, { recursive: true });
    const path = join(directory, `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}.jsonl`);
    closeSync(openSync(path, "wx", 0o600));
    const clock = { now: () => performance.now(), utilization: (previous?: any) => performance.eventLoopUtilization(previous) };
    timing = instrument(pi, clock, line => appendFileSync(path, `${JSON.stringify(line)}\n`, { flag: "a", mode: 0o600 }));
  });
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const project = join(root, ".pi", "extensions");
  const paths: string[] = manifest.pi.extensions.map((path: string) => resolve(root, path));
  paths.push(...readdirSync(project, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => join(project, entry.name, "index.ts")).sort());
  // Installed package copies have no dev dependencies; use the CLI's own jiti in that case.
  let createJiti: typeof import("jiti").createJiti;
  try { createJiti = createRequire(import.meta.url)("jiti").createJiti; }
  catch { createJiti = createRequire(realpathSync(process.argv[1]))("jiti").createJiti; }
  const jiti = createJiti(import.meta.url, { moduleCache: false, virtualModules: {
    "@earendil-works/pi-coding-agent": codingAgent, "@earendil-works/pi-ai": ai,
    "@earendil-works/pi-ai/providers/all": providers, "@earendil-works/pi-tui": tui,
    typebox, "typebox/compile": typeboxCompile,
  } });
  for (const path of paths) {
    const factory = await jiti.import(pathToFileURL(path).href, { default: true }) as (api: any) => unknown;
    await factory(timing ? timing.wrap(path.slice(root.length + 1)) : pi);
  }
  timing?.endMarkers();
}
