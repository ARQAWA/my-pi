// Ordered conflict barrier (notes/analysis-races.md section 5).
// Call the returned function synchronously at the top of execute(): registration order is then message order.
// A call waits for every earlier live call it conflicts with, runs, and leaves the live set when it settles.

export type Scope = { kind: "read" | "mutate" | "all"; keys: string[] };

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
  return function schedule<T>(scope: Scope, run: () => Promise<T>): Promise<T> {
    const deps = [...live].filter((e) => conflicts(e.scope, scope)).map((e) => e.done);
    const done = Promise.allSettled(deps).then(() => run());
    const entry = { scope, done };
    live.add(entry);
    const leave = () => void live.delete(entry);
    done.then(leave, leave);
    return done;
  };
}
