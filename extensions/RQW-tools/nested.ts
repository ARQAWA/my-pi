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
import { createBarrier, type Schedule, type Scope } from "./barrier.ts";

const ALL: Scope = { kind: "all", keys: [] };

export type NestedBarrier = {
  /** Call synchronously at the top of a tool's `execute`, with the tool call id Pi passes to it. */
  schedule<T>(id: string, scope: Scope, run: () => Promise<T>): Promise<T>;
  /** Runs the call `id` as a group: one "all" call where `schedule` puts it, with a barrier of its own for its calls. */
  group<T>(id: string, run: () => Promise<T>): Promise<T>;
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

  const groupOf = (id: string): Schedule | undefined => {
    for (let p = parentOf(id); p !== undefined; p = parentOf(p)) {
      const own = groups.get(p);
      if (own) return own;
    }
    return undefined;
  };

  function schedule<T>(id: string, scope: Scope, run: () => Promise<T>): Promise<T> {
    const own = groupOf(id);
    if (own) return own(scope, run);
    for (let p = parentOf(id); p !== undefined; p = parentOf(p)) if (inOuter.has(p)) return run();
    inOuter.add(id);
    const done = outer(scope, run);
    const leave = () => void inOuter.delete(id);
    done.then(leave, leave);
    return done;
  }

  return {
    schedule,
    group<T>(id: string, run: () => Promise<T>): Promise<T> {
      const own = createBarrier();
      // Registered before the group waits, so no call of its script can miss it.
      groups.set(id, own);
      const done = schedule(id, ALL, async () => {
        try {
          return await run();
        } finally {
          // A call of the script that is still running when the script ends (not awaited) belongs to the
          // group: later calls wait for it too.
          await own(ALL, async () => undefined);
        }
      });
      const forget = () => void (groups.get(id) === own && groups.delete(id));
      done.then(forget, forget);
      return done;
    },
    groupOf,
  };
}
