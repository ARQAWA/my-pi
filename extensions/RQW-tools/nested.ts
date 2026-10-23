// The ordered barrier with nesting, for a tool that runs a script which calls tools (Pi's `codemode`).
//
// - A call of the script is ordered by a barrier of its own, the one of its group, so the calls of one script
//   keep script order (write, then read; Promise.all of both) and never wait for the group's entry in the outer
//   barrier. Waiting for it would deadlock: the entry ends only when the script ends.
// - The group itself is one call with scope "all" in the outer barrier: it waits for every earlier call and every
//   later call waits for it, the same as `bash`.
//
// Routing is by tool call id. Pi gives a nested call the id `<parent id>/<n>` (`c0/1`, and `c0/1/1` for a call
// made by that call; `core/nested-tool-calls.js:95,106`), and passes it to `execute`. A group registers its own
// barrier under its call id. A call whose id has a `/` uses the barrier of its nearest registered ancestor id.
// With no registered ancestor it uses the outer barrier, unless an ancestor has a live entry there: then it runs at
// once, because waiting there could mean waiting for its own ancestor.
//
// The id is the only signal used. AsyncLocalStorage was used before and is not: Bun, which runs the Pi release
// binaries, drops its context in the `message` callback of a worker, where a script's tool call arrives. Proven on
// Node and on Bun (see notes/settings-codemode.md).
import { createBarrier, type Detachable, type Schedule, type Scope } from "./barrier.ts";
import { nestedDisplay, type NestedDisplayRecord } from "./nested-display.ts";

const ALL: Scope = { kind: "all", keys: [] };

export type NestedBarrier = {
  /** Call synchronously at the top of a tool's `execute`, with the tool call id Pi passes to it. */
  schedule<T>(id: string, scope: Scope, run: () => Promise<T>, handle?: Detachable): Promise<T>;
  /** Runs the call `id` as a group: one "all" call where `schedule` puts it, with a barrier of its own for its calls. */
  group<T>(id: string, run: () => Promise<T>, handle?: Detachable, finish?: (result: T, calls: NestedDisplayRecord[]) => T): Promise<T>;
  /** Capture only final results in the nearest live group, returning other results by identity. */
  observe<T>(id: string, tool: string, params: unknown, result: T): T;
  /** Snapshot only completed display facts of this exact active group; never exposes its mutable records. */
  displayOf(id: string): NestedDisplayRecord[];
  /** The barrier of the group that orders the call `id`, or undefined when no group does. */
  groupOf(id: string): Schedule | undefined;
};

const parentOf = (id: string): string | undefined => {
  const slash = id.lastIndexOf("/");
  return slash < 0 ? undefined : id.slice(0, slash);
};

export function createNestedBarrier(): NestedBarrier {
  const outer = createBarrier();
  // Ids of the calls that have an entry in the outer barrier now.
  const inOuter = new Set<string>();
  // Call id of a running group -> the barrier of its calls.
  const groups = new Map<string, Schedule>();
  const displays = new Map<Schedule, Map<string, NestedDisplayRecord | undefined>>();

  const groupOf = (id: string): Schedule | undefined => {
    for (let p = parentOf(id); p !== undefined; p = parentOf(p)) {
      const own = groups.get(p);
      if (own) return own;
    }
    return undefined;
  };

  function schedule<T>(id: string, scope: Scope, run: () => Promise<T>, handle?: Detachable): Promise<T> {
    const own = groupOf(id);
    if (own) {
      // Reserve at registration, not completion: Pi retains the first starts even if they finish last.
      const calls = displays.get(own);
      if (calls && calls.size < 256 && !calls.has(id)) calls.set(id, undefined);
      return own(scope, run, handle);
    }
    for (let p = parentOf(id); p !== undefined; p = parentOf(p)) if (inOuter.has(p)) return run();
    inOuter.add(id);
    const done = outer(scope, run, handle);
    const leave = () => void inOuter.delete(id);
    done.then(leave, leave);
    return done;
  }

  const snapshot = (calls: Map<string, NestedDisplayRecord | undefined> | undefined): NestedDisplayRecord[] =>
    [...(calls?.values() ?? [])].filter((call): call is NestedDisplayRecord => call !== undefined).map((call) =>
      call.tool === "edit" ? { ...call, files: call.files.map((file) => ({ ...file })) } : { ...call });

  return {
    schedule,
    displayOf(id: string): NestedDisplayRecord[] {
      const own = groups.get(id);
      return snapshot(own ? displays.get(own) : undefined);
    },
    observe<T>(id: string, tool: string, params: unknown, result: T): T {
      const own = groupOf(id);
      const calls = own && displays.get(own);
      if (!calls) return result;
      const display = nestedDisplay(tool, params, result);
      if (!display) return result;
      if (calls.has(id)) calls.set(id, { id, ...display });
      const r = result as any;
      return { ...r, details: { ...r.details, rqwToolsNestedCall: display } };
    },
    group<T>(id: string, run: () => Promise<T>, handle?: Detachable, finish?: (result: T, calls: NestedDisplayRecord[]) => T): Promise<T> {
      const own = createBarrier();
      const calls = new Map<string, NestedDisplayRecord | undefined>();
      if (finish) displays.set(own, calls);
      // Registered before the group waits, so no call of its script can miss it.
      groups.set(id, own);
      // A detached group (a script in the background) stops holding later outer calls; its own barrier still
      // orders its script's calls until the script ends.
      const done = schedule(id, ALL, async () => {
        let result: T;
        try {
          result = await run();
        } finally {
          // A call of the script that is still running when the script ends (not awaited) belongs to the
          // group: later calls wait for it too.
          await own(ALL, async () => undefined);
        }
        return finish ? finish(result, snapshot(calls)) : result;
      }, handle);
      const forget = () => {
        displays.delete(own);
        if (groups.get(id) === own) groups.delete(id);
      };
      done.then(forget, forget);
      return done;
    },
    groupOf,
  };
}
