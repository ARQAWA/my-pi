// Ordered conflict barrier (notes/analysis-races.md section 5).
// Call the returned function synchronously at the top of execute(): registration order is then message order.
// A call waits for every earlier live call it conflicts with, runs, and leaves the live set when it settles.

export type Scope = {
  kind: "read" | "mutate" | "all";
  keys: string[];
  /** Optional late scope: resolve after earlier all calls settled, before collecting conflicts. */
  resolve?: () => Scope;
  /** Refresh the resolved scope at execution, returning whether it changed; held entries are checked again. */
  beforeRun?: () => boolean | void;
  /** Acquire external resources; the scope is refreshed and held entries are checked again afterwards. */
  acquire?: () => Promise<void | (() => void)>;
  /**
   * What an "all" call certainly touches (bash, footprint.ts): checked only against held entries of background jobs.
   * `tags` are `pkg:`/`git:` resources, `writes` file keys.
   */
  explicit?: { tags: string[]; writes: string[] };
};

/** What a background job keeps holding for calls registered after its handoff (holds H1). */
export type Held = { files: string[]; tags: string[] };

/**
 * One registered call, as the caller sees it. `schedule` fills `detach`, `blockers` and `followers`; the caller may
 * set `label` (its job id) and `cancel` (K1).
 *
 * After `detach(held)`, calls registered later wait for this call only where they touch what it holds; calls
 * registered before keep waiting for its real end. A detach without `held` releases later calls completely.
 */
export type Detachable = {
  detach?: (held?: Held) => void;
  /** Unfinished earlier calls this call waits for (empty once it started); `held`: only for what that call holds. */
  blockers?: () => { call: Detachable; held: boolean }[];
  /** Calls registered before the detach that wait for this one, transitively; none once they started. */
  followers?: () => Detachable[];
  started?: boolean;
  finished?: boolean;
  /** Set by the barrier when the call registers, and by the caller when it goes to the background. */
  registeredAt?: number;
  handedOffAt?: number;
  label?: () => string | undefined;
  cancel?: () => void;
  /**
   * Set by `schedule`: a call that has not started leaves the barrier now and never runs; its promise rejects with
   * "Operation aborted". Calls waiting for it go on as if it had ended (a killed queued job, K1).
   */
  withdraw?: () => void;
};

/** Registers one call and runs it after every earlier conflicting call settled. */
export type Schedule = <T>(scope: Scope, run: () => Promise<T>, handle?: Detachable) => Promise<T>;

// Keys use "/" as the separator. A root key ("/", "c:/") already ends with it.
const under = (dir: string, p: string) => p.startsWith(dir.endsWith("/") ? dir : dir + "/");
const related = (x: string, y: string) => x === y || under(x, y) || under(y, x);

function conflicts(a: Scope, b: Scope): boolean {
  if (a.kind === "all" || b.kind === "all") return true;
  if (a.kind === "read" && b.kind === "read") return false;
  return a.keys.some((x) => b.keys.some((y) => related(x, y)));
}

/** A held entry conflicts with writes of its files and with explicit uses of its resources; never with reads. */
function heldConflicts(held: Held, b: Scope): boolean {
  if (b.kind === "read") return false;
  if (b.kind === "mutate") return held.files.some((x) => b.keys.some((y) => related(x, y)));
  const ex = b.explicit;
  if (!ex) return false;
  return held.tags.some((t) => ex.tags.includes(t)) || held.files.some((x) => ex.writes.some((y) => related(x, y)));
}

type Entry = { scope: Scope; held?: Held; done: Promise<unknown>; handle: Detachable; dependents: Set<Entry>; earlier?: Entry[]; resolved?: boolean };

export function createBarrier(): Schedule {
  const live = new Set<Entry>();
  // Scope resolution is ordered, not execution. Only an all call holds this chain until its work settles: it can
  // retarget symlinks. Entries are never rescheduled, and depend only on earlier entries in this same barrier.
  let prepared: Promise<void> = Promise.resolve();
  return function schedule<T>(scope: Scope, run: () => Promise<T>, handle: Detachable = {}): Promise<T> {
    const earlier = [...live];
    let entry: Entry;
    let failure: { error: unknown } | undefined;
    let deps: Entry[] = [];
    const ready = prepared.then(() => {
      try {
        entry.scope = scope.resolve ? scope.resolve() : scope;
      } catch (error) {
        entry.scope = { kind: "all", keys: [] };
        failure = { error };
      }
    });
    let withdrawn = false;
    const outcome = Promise.withResolvers<T>();
    ready.then(async () => {
      if (withdrawn) return;
      deps = earlier.filter((e) => (e.held ? heldConflicts(e.held, entry.scope) : conflicts(e.scope, entry.scope)));
      entry.resolved = true;
      // Same-response followers of a full entry (K1); a held entry's waiters are later calls, never cancelled.
      for (const e of deps) if (!e.held) e.dependents.add(entry);
      await Promise.allSettled(deps.map((e) => e.done));
      if (withdrawn) return;
      if (failure) throw failure.error;
      let admission: void | (() => void);
      try {
        for (;;) {
          scope.beforeRun?.();
          let lateHeld = earlier.filter((e) => e.held && !deps.includes(e) && !e.handle.finished && heldConflicts(e.held, entry.scope));
          if (!lateHeld.length) {
            admission = await scope.acquire?.();
            if (withdrawn) { admission?.(); return; }
            const changed = scope.beforeRun?.();
            lateHeld = earlier.filter((e) => e.held && !deps.includes(e) && !e.handle.finished && heldConflicts(e.held, entry.scope));
            if (!lateHeld.length && !changed) break;
            admission?.();
            admission = undefined;
            if (!lateHeld.length) continue;
          }
          deps.push(...lateHeld);
          await Promise.allSettled(lateHeld.map((e) => e.done));
          if (withdrawn) { admission?.(); return; }
        }
      } catch (error) {
        admission?.();
        throw error;
      }
      handle.started = true;
      try { return await run(); }
      finally { admission?.(); }
    }).then((value) => { if (!withdrawn) outcome.resolve(value as T); }, (error) => { if (!withdrawn) outcome.reject(error); });
    const done = outcome.promise;
    handle.withdraw = () => {
      if (handle.started || handle.finished || withdrawn) return;
      withdrawn = true;
      outcome.reject(new Error("Operation aborted"));
    };
    entry = { scope, done, handle, dependents: new Set(), earlier };
    handle.registeredAt = performance.now();
    const detached = Promise.withResolvers<void>();
    prepared = ready.then(() => entry.scope.kind === "all" ? Promise.race([done.then(() => {}, () => {}), detached.promise]) : undefined);
    live.add(entry);
    let heldEntry: Entry | undefined;
    const leave = () => {
      handle.finished = true;
      live.delete(entry);
      if (heldEntry) live.delete(heldEntry);
    };
    done.then(leave, leave);
    handle.blockers = () => (handle.started ? [] : deps.filter((e) => !e.handle.finished).map((e) => ({ call: e.handle, held: !!e.held })));
    handle.followers = () => {
      const out = new Set<Detachable>();
      if (handle.finished) return [];
      // Followers of the same response: registered before the call they wait for went to the background.
      // A call still waiting to resolve its scope behind an earlier all call depends on that call too.
      const pending = (e: Entry) => [...live].filter((d) => !d.held && !d.resolved && e.scope.kind === "all" && d.earlier?.includes(e));
      const visit = (e: Entry) => {
        for (const d of [...e.dependents, ...pending(e)]) {
          if (d.handle.started || d.handle.finished || out.has(d.handle)) continue;
          if (handle.handedOffAt !== undefined && (d.handle.registeredAt ?? 0) > handle.handedOffAt) continue;
          out.add(d.handle);
          visit(d);
        }
      };
      visit(entry);
      return [...out];
    };
    handle.detach = (held) => {
      if (!live.has(entry)) return;
      live.delete(entry);
      if (held && (held.files.length || held.tags.length)) {
        heldEntry = { scope: { kind: "mutate", keys: held.files }, held, done, handle, dependents: new Set() };
        live.add(heldEntry);
      }
      detached.resolve();
    };
    return done;
  };
}
