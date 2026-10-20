// The ordered barrier with one level of nesting, for a tool that runs a script which calls tools (Pi's `codemode`).
//
// - A call of the script is ordered by a barrier of its own, the one of its group, so the calls of one script
//   keep script order (write, then read; Promise.all of both) and never wait for the group's entry in the outer
//   barrier. Waiting for it would deadlock: the entry ends only when the script ends.
// - The group itself is one call with scope "all" in the outer barrier: it waits for every earlier call and every
//   later call waits for it, the same as `bash`.
//
// The group's barrier travels with the async context (AsyncLocalStorage), because the tool calls of a script reach
// our `execute` through the sandbox worker and the session, with no argument that names the script. Node keeps the
// context through promises, timers and the messages of a worker created inside it (see notes/settings-codemode.md).
import { AsyncLocalStorage } from "node:async_hooks";
import { createBarrier, type Schedule, type Scope } from "./barrier.ts";

const ALL: Scope = { kind: "all", keys: [] };

export type NestedBarrier = {
  /** Call synchronously at the top of a tool's `execute`: the barrier of the enclosing group, else the outer one. */
  schedule: Schedule;
  /** Registers one call as a group of the outer barrier and runs `run` with a barrier of its own for its tool calls. */
  group<T>(run: () => Promise<T>): Promise<T>;
  /** The barrier of the enclosing group, or undefined outside any group. */
  current(): Schedule | undefined;
};

export function createNestedBarrier(): NestedBarrier {
  const outer = createBarrier();
  const inner = new AsyncLocalStorage<Schedule>();
  return {
    schedule: (scope, run) => (inner.getStore() ?? outer)(scope, run),
    group: (run) =>
      outer(ALL, () => {
        const own = createBarrier();
        return inner.run(own, async () => {
          try {
            return await run();
          } finally {
            // A call of the script that is still running when the script ends (not awaited) belongs to the
            // group: later calls of the outer barrier wait for it too.
            await own(ALL, async () => undefined);
          }
        });
      }),
    current: () => inner.getStore(),
  };
}
