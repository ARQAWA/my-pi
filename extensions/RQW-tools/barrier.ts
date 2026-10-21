// Ordered conflict barrier (notes/analysis-races.md section 5).
// Call the returned function synchronously at the top of execute(): registration order is then message order.
// A call waits for every earlier live call it conflicts with, runs, and leaves the live set when it settles.

export type Scope = {
  kind: "read" | "mutate" | "all";
  keys: string[];
  /** Optional late scope: resolve after earlier all calls settled, before collecting conflicts. */
  resolve?: () => Scope;
};

/** Registers one call and runs it after every earlier conflicting call settled. */
export type Schedule = <T>(scope: Scope, run: () => Promise<T>) => Promise<T>;

// Keys use "/" as the separator. A root key ("/", "c:/") already ends with it.
const under = (dir: string, p: string) => p.startsWith(dir.endsWith("/") ? dir : dir + "/");

function conflicts(a: Scope, b: Scope): boolean {
  if (a.kind === "all" || b.kind === "all") return true;
  if (a.kind === "read" && b.kind === "read") return false;
  return a.keys.some((x) => b.keys.some((y) => x === y || under(x, y) || under(y, x)));
}

export function createBarrier(): Schedule {
  const live = new Set<{ scope: Scope; done: Promise<unknown> }>();
  // Scope resolution is ordered, not execution. Only an all call holds this chain until its work settles: it can
  // retarget symlinks. Entries are never rescheduled, and depend only on earlier entries in this same barrier.
  let prepared: Promise<void> = Promise.resolve();
  return function schedule<T>(scope: Scope, run: () => Promise<T>): Promise<T> {
    const earlier = [...live];
    let entry: { scope: Scope; done: Promise<T> };
    let failure: { error: unknown } | undefined;
    const ready = prepared.then(() => {
      try {
        entry.scope = scope.resolve ? scope.resolve() : scope;
      } catch (error) {
        entry.scope = { kind: "all", keys: [] };
        failure = { error };
      }
    });
    const done = ready.then(async () => {
      const deps = earlier.filter((e) => conflicts(e.scope, entry.scope)).map((e) => e.done);
      await Promise.allSettled(deps);
      if (failure) throw failure.error;
      return run();
    });
    entry = { scope, done };
    prepared = ready.then(() => entry.scope.kind === "all" ? done.then(() => {}, () => {}) : undefined);
    live.add(entry);
    const leave = () => void live.delete(entry);
    done.then(leave, leave);
    return done;
  };
}
