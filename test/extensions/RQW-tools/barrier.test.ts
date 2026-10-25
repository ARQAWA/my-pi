// Layer 1 of notes/analysis-races.md section 7: the barrier with fake operations made of timers. No model, no fs.
// RQW_SEED and RQW_ROUNDS change the randomized test (defaults 1 and 2000).
import test from "node:test";
import assert from "node:assert";
import path from "node:path";
import { createBarrier } from "../../../extensions/RQW-tools/barrier.ts";
import type { Schedule, Scope } from "../../../extensions/RQW-tools/barrier.ts";

type Rec = { i: number; scope: Scope; entry: number; start: number; end: number };

const T1_DUR_MS = 80;
// Real timers exercise ordering, abort and rejection interleavings. Elapsed slack is diagnostic only;
// gate-driven checks below verify eligibility without asserting how long the host takes to run JS.
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const now = () => performance.now();

const R = (...keys: string[]): Scope => ({ kind: "read", keys });
const M = (...keys: string[]): Scope => ({ kind: "mutate", keys });
const B: Scope = { kind: "all", keys: [] };

// Oracle of the conflict rule. A separate implementation from barrier.ts (path.posix.relative instead of prefixes).
const within = (dir: string, p: string) => {
  const rel = path.posix.relative(dir, p);
  return rel === "" || (rel !== ".." && !rel.startsWith("../") && !path.posix.isAbsolute(rel));
};
function oracle(a: Scope, b: Scope): boolean {
  if (a.kind === "all" || b.kind === "all") return true;
  if (a.kind === "read" && b.kind === "read") return false;
  return a.keys.some((x) => b.keys.some((y) => within(x, y) || within(y, x)));
}

// I1 for every conflicting pair, and the I2 slack: start - max(entry, end of conflicting earlier calls).
function checkOrder(recs: Rec[]): { violations: string[]; maxSlack: number } {
  const violations: string[] = [];
  let maxSlack = 0;
  for (const b of recs) {
    if (Number.isNaN(b.start)) continue;
    let bound = b.entry;
    for (const a of recs) {
      if (a.i >= b.i || !oracle(a.scope, b.scope)) continue;
      if (b.start < a.end) {
        violations.push(`I1: op${b.i} started at ${b.start.toFixed(2)} before op${a.i} ended at ${a.end.toFixed(2)}`);
      }
      bound = Math.max(bound, a.end);
    }
    maxSlack = Math.max(maxSlack, b.start - bound);
  }
  return { violations, maxSlack };
}

async function withGuard<T>(p: Promise<T>, ms = 5000): Promise<T | "deadlock"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const guard = new Promise<"deadlock">((r) => {
    timer = setTimeout(() => r("deadlock"), ms);
  });
  try {
    return await Promise.race([p, guard]);
  } finally {
    clearTimeout(timer);
  }
}

// One response of the model: every call registers in the same tick, in order, like Pi's Promise.all over execute().
async function runBatch(schedule: Schedule, scopes: Scope[], dur = 30): Promise<Rec[]> {
  const t0 = now();
  const recs: Rec[] = scopes.map((scope, i) => ({ i, scope, entry: 0, start: NaN, end: NaN }));
  const calls = recs.map((r) => {
    r.entry = now() - t0;
    return schedule(r.scope, async () => {
      r.start = now() - t0;
      await sleep(dur);
      r.end = now() - t0;
    });
  });
  await Promise.all(calls);
  return recs;
}

// ---------------------------------------------------------------- T1: fixed batches

// deps[j] = the earlier calls that call j must wait for, and only those.
const table: { name: string; ops: Scope[]; deps: number[][] }[] = [
  { name: "[M a, R a]: read waits for write", ops: [M("/r/a"), R("/r/a")], deps: [[], [0]] },
  { name: "[R a, M a]: write waits for read", ops: [R("/r/a"), M("/r/a")], deps: [[], [0]] },
  { name: "[M a, M b]: parallel", ops: [M("/r/a"), M("/r/b")], deps: [[], []] },
  { name: "[R a, R a]: parallel", ops: [R("/r/a"), R("/r/a")], deps: [[], []] },
  { name: "[M a, B]: bash waits for write", ops: [M("/r/a"), B], deps: [[], [0]] },
  { name: "[B, R x]: read waits for bash", ops: [B, R("/r/x")], deps: [[], [0]] },
  { name: "[B, B]: bash serialised", ops: [B, B], deps: [[], [0]] },
  { name: "[R dir, M dir/f]: write under a read tree waits", ops: [R("/r/d"), M("/r/d/f")], deps: [[], [0]] },
  { name: "[M dir/f, R dir]: tree read waits for a write below", ops: [M("/r/d/f"), R("/r/d")], deps: [[], [0]] },
  { name: "[M a, M a/b]: file vs directory clash serialised", ops: [M("/r/a"), M("/r/a/b")], deps: [[], [0]] },
  { name: "[M a, B, R b]: read b waits for bash only, bash waits for write", ops: [M("/r/a"), B, R("/r/b")], deps: [[], [0], [1]] },
  { name: "[R a, M a, R a]: last read waits for the write only", ops: [R("/r/a"), M("/r/a"), R("/r/a")], deps: [[], [0], [1]] },
  { name: "[R a, R a, M a]: write waits for both reads", ops: [R("/r/a"), R("/r/a"), M("/r/a")], deps: [[], [], [0, 1]] },
  { name: "[M a+b, R b, R c]: multi-key write", ops: [M("/r/a", "/r/b"), R("/r/b"), R("/r/c")], deps: [[], [0], []] },
  { name: "[R x, B, R y]: bash between reads", ops: [R("/r/x"), B, R("/r/y")], deps: [[], [0], [1]] },
  { name: "[B, M a, R a]: read waits for bash and write", ops: [B, M("/r/a"), R("/r/a")], deps: [[], [0], [0, 1]] },
  { name: "[B, B, B]: chain", ops: [B, B, B], deps: [[], [0], [0, 1]] },
  { name: "[M ab, M a]: a name prefix is not an ancestor", ops: [M("/r/ab"), M("/r/a")], deps: [[], []] },
  { name: "[R d, R d/c]: two reads of a tree and a file below", ops: [R("/r/d"), R("/r/d/c")], deps: [[], []] },
  { name: "[R /, M /a/b]: root key is an ancestor of everything", ops: [R("/"), M("/a/b")], deps: [[], [0]] },
  { name: "[M /a/b, R /]: and the other way round", ops: [M("/a/b"), R("/")], deps: [[], [0]] },
  { name: "[R c:/, M c:/x]: windows root key", ops: [R("c:/"), M("c:/x")], deps: [[], [0]] },
  { name: "[M c:/xy, R c:/x]: no false conflict next to a windows root", ops: [M("c:/xy"), R("c:/x")], deps: [[], []] },
];

for (const c of table) {
  test(`T1 ${c.name}`, async () => {
    // The table itself lists exactly the conflicting pairs.
    for (let j = 0; j < c.ops.length; j++) {
      for (let i = 0; i < j; i++) {
        if (c.ops[i].keys.some((k) => k.startsWith("c:"))) continue; // the oracle is posix only
        assert.strictEqual(c.deps[j].includes(i), oracle(c.ops[i], c.ops[j]), `table: pair ${i},${j}`);
      }
    }
    const recs = await runBatch(createBarrier(), c.ops, T1_DUR_MS);
    for (const [j, deps] of c.deps.entries()) {
      const r = recs[j];
      for (const i of deps) {
        assert.ok(r.start >= recs[i].end, `op${j} started at ${r.start} before op${i} ended at ${recs[i].end}`);
      }
    }
    await checkEligible(createBarrier(), c.ops);
  });
}

test("T1 run's own result and rejection come back", async () => {
  const schedule = createBarrier();
  assert.strictEqual(await schedule(M("/r/a"), async () => 42), 42);
  await assert.rejects(
    schedule(M("/r/a"), async () => {
      throw new Error("own error");
    }),
    /own error/,
  );
  await assert.rejects(
    schedule(B, () => {
      throw new Error("sync throw");
    }),
    /sync throw/,
  );
});

test("T1 a failed call releases the calls behind it (I7)", async () => {
  const schedule = createBarrier();
  const order: string[] = [];
  const first = schedule(M("/r/a"), async () => {
    await sleep(20);
    order.push("first");
    throw new Error("boom");
  });
  const second = schedule(R("/r/a"), async () => {
    order.push("second");
    return "ok";
  });
  await assert.rejects(first, /boom/);
  assert.strictEqual(await second, "ok");
  assert.deepStrictEqual(order, ["first", "second"]);
});

test("T1 a settled call leaves the live set: a later call does not wait", async () => {
  const schedule = createBarrier();
  await runBatch(schedule, [B, M("/r/a")], 20);
  await checkEligible(schedule, [M("/r/a")]);
});

// ---------------------------------------------------------------- T2: randomized

type OpSpec = { scope: Scope; dur: number; throws: boolean };
type RoundSpec = { ops: OpSpec[]; abortAt: number; sequential: boolean };
type RoundResult = {
  violations: string[];
  maxSlack: number;
  deadlock: boolean;
  skipped: number;
  thrown: number;
  sequential: boolean;
};

// 32-bit linear congruential generator (Numerical Recipes constants).
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  const next = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  for (let i = 0; i < 4; i++) next();
  return next;
}

const FILES = ["/r/a", "/r/b", "/r/ab", "/r/d/c", "/r/d/e"];
const TREES = ["/r", "/r/d", "/"];

function genRounds(seed: number, rounds: number): RoundSpec[] {
  const rnd = lcg(seed);
  const pick = <T>(a: T[]): T => a[Math.floor(rnd() * a.length)];
  const specs: RoundSpec[] = [];
  for (let round = 0; round < rounds; round++) {
    const n = 2 + Math.floor(rnd() * 9);
    const ops: OpSpec[] = [];
    for (let i = 0; i < n; i++) {
      const kind = pick(["read", "read", "mutate", "mutate", "bash", "tree"]);
      const scope: Scope =
        kind === "bash"
          ? B
          : kind === "tree"
            ? R(pick(TREES))
            : kind === "read"
              ? R(pick(FILES))
              : rnd() < 0.3
                ? M(pick(FILES), pick(FILES))
                : M(pick(FILES));
      ops.push({ scope, dur: Math.floor(rnd() * 15), throws: rnd() < 0.1 });
    }
    specs.push({ ops, abortAt: rnd() < 0.2 ? Math.floor(rnd() * 30) : -1, sequential: rnd() < 0.15 });
  }
  return specs;
}

async function runRound(makeBarrier: () => Schedule, spec: RoundSpec): Promise<RoundResult> {
  const schedule = makeBarrier();
  const t0 = now();
  const ac = new AbortController();
  const timer = spec.abortAt >= 0 ? setTimeout(() => ac.abort(), spec.abortAt) : undefined;
  const violations: string[] = [];
  const ops = spec.ops.map((o, i) => ({ ...o, i, entry: NaN, start: NaN, end: NaN, skipped: false }));
  const runOne = (op: (typeof ops)[number]) => {
    op.entry = now() - t0;
    return schedule(op.scope, async () => {
      op.start = now() - t0;
      if (ac.signal.aborted) {
        op.skipped = true;
        op.end = op.start;
        throw new Error("aborted");
      }
      await sleep(op.dur);
      op.end = now() - t0;
      if (op.throws) throw new Error("boom");
      return op.i;
    }).then(
      (v) => {
        if (v !== op.i || op.throws || op.skipped) violations.push(`op${op.i}: wrong fulfilment ${v}`);
      },
      (e) => {
        const want = op.skipped ? "aborted" : op.throws ? "boom" : undefined;
        if (e?.message !== want) violations.push(`op${op.i}: unexpected rejection ${e?.message}`);
      },
    );
  };
  const drive = spec.sequential
    ? (async () => {
        for (const op of ops) await runOne(op);
      })()
    : Promise.all(ops.map(runOne));
  const res = await withGuard(drive, 5000);
  clearTimeout(timer);
  const base = { skipped: ops.filter((o) => o.skipped).length, thrown: ops.filter((o) => o.throws && !o.skipped).length };
  if (res === "deadlock") return { ...base, violations, maxSlack: 0, deadlock: true, sequential: spec.sequential };
  const checked = checkOrder(ops);
  return { ...base, violations: [...violations, ...checked.violations], maxSlack: checked.maxSlack, deadlock: false, sequential: spec.sequential };
}

async function runRounds(makeBarrier: () => Schedule, seed: number, rounds: number, concurrency = 20) {
  const specs = genRounds(seed, rounds);
  const results: RoundResult[] = new Array(specs.length);
  let next = 0;
  // Rounds are independent (one barrier each), so several run at once to keep the test short.
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < specs.length) {
        const k = next++;
        results[k] = await runRound(makeBarrier, specs[k]);
      }
    }),
  );
  return {
    rounds: results.length,
    deadlocks: results.filter((r) => r.deadlock).length,
    violations: results.flatMap((r, k) => r.violations.map((v) => `round ${k}: ${v}`)),
    maxSlack: Math.max(0, ...results.map((r) => r.maxSlack)),
    // Wall-clock slack includes host descheduling and GC; it is diagnostic, not an I2 oracle.
    p99Slack: [...results.map((r) => r.maxSlack)].sort((x, y) => x - y)[Math.floor(results.length * 0.99)] ?? 0,
    skipped: results.reduce((s, r) => s + r.skipped, 0),
    thrown: results.reduce((s, r) => s + r.thrown, 0),
    sequential: results.filter((r) => r.sequential).length,
  };
}

test("T2 randomized interleavings keep I1, I2, I5, I6, I7", async (t) => {
  const seed = Number(process.env.RQW_SEED ?? 1);
  const rounds = Number(process.env.RQW_ROUNDS ?? 2000);
  const s = await runRounds(createBarrier, seed, rounds);
  t.diagnostic(
    `seed=${seed} rounds=${s.rounds} deadlocks=${s.deadlocks} violations=${s.violations.length} ` +
      `maxSlack=${s.maxSlack.toFixed(2)}ms p99Slack=${s.p99Slack.toFixed(2)}ms skippedByAbort=${s.skipped} thrown=${s.thrown} sequentialRounds=${s.sequential}`,
  );
  assert.strictEqual(s.deadlocks, 0, "a round did not finish within 5 s");
  assert.deepStrictEqual(s.violations.slice(0, 5), []);
  // I2 is checked with held operations below, independently of elapsed host time.
  for (const spec of genRounds(seed, rounds)) {
    await checkEligible(createBarrier(), spec.ops.map((o) => o.scope), spec.ops.map((o) => o.throws));
  }
  if (rounds >= 500) {
    assert.ok(s.skipped > 0 && s.thrown > 0 && s.sequential > 0, "abort, throw and sequential paths were not exercised");
  }
});

// I2 oracle: after promise reactions drain, exactly the operations with no unfinished earlier conflict must
// have started. Each operation is held by a gate, so a false dependency cannot hide behind timer jitter.
const drain = () => new Promise<void>((resolve) => setImmediate(resolve));
async function checkEligible(schedule: Schedule, scopes: Scope[], rejects: boolean[] = []): Promise<void> {
  const gates = scopes.map(() => Promise.withResolvers<void>());
  const started = new Set<number>();
  const finished = new Set<number>();
  const calls = scopes.map((scope, i) => schedule(scope, async () => {
    started.add(i);
    await gates[i].promise;
  }));
  // Attach rejection handlers before releasing any gate, including when another operation is still held.
  const settled = calls.map((call) => Promise.allSettled([call]));
  try {
    while (finished.size < scopes.length) {
      await drain();
      const expected = scopes.flatMap((scope, i) =>
        scopes.some((earlier, j) => j < i && !finished.has(j) && oracle(earlier, scope)) ? [] : [i]);
      assert.deepStrictEqual([...started].sort((a, b) => a - b), expected, "I2: exactly the eligible calls start while unrelated work stays held");
      // Complete the latest eligible operation first to expose dependencies on unrelated earlier operations.
      const next = expected.filter((i) => !finished.has(i)).at(-1);
      assert.notStrictEqual(next, undefined, "I2: no eligible operation (deadlock)");
      if (rejects[next!]) gates[next!].reject(new Error("gate rejection"));
      else gates[next!].resolve();
      const [result] = await settled[next!];
      assert.strictEqual(result.status, rejects[next!] ? "rejected" : "fulfilled");
      if (result.status === "rejected") assert.match(result.reason?.message ?? "", /gate rejection/);
      finished.add(next!);
    }
  } finally {
    for (const gate of gates) gate.resolve();
    await Promise.allSettled(calls);
  }
}

// ---------------------------------------------------------------- T3: the checker catches a broken barrier

function createBrokenBarrier(): Schedule {
  const live = new Set<{ scope: Scope; done: Promise<unknown> }>();
  return function schedule<T>(scope: Scope, run: () => Promise<T>): Promise<T> {
    const deps: Promise<unknown>[] = []; // the bug: dependency collection is off
    const done = Promise.allSettled(deps).then(() => run());
    const entry = { scope, done };
    live.add(entry);
    const leave = () => void live.delete(entry);
    done.then(leave, leave);
    return done;
  };
}

test("T2 eligibility oracle rejects missing and unnecessary dependencies", async () => {
  await assert.rejects(checkEligible(createBrokenBarrier(), [M("/r/a"), R("/r/a")]), /I2:/);
  const serial = createBarrier();
  const overSerialized: Schedule = (_scope, run) => serial(B, run);
  await assert.rejects(checkEligible(overSerialized, [M("/r/a"), M("/r/b")]), /I2:/);
  await checkEligible(createBarrier(), [M("/r/a"), M("/r/b"), R("/r/b")], [false, true, false]);
});

test("T3 a barrier that ignores dependencies makes the checker report violations", async (t) => {
  const broken = await runRounds(createBrokenBarrier, 3, 40);
  const good = await runRounds(createBarrier, 3, 40);
  t.diagnostic(`broken: violations=${broken.violations.length} in ${broken.rounds} rounds; real: violations=${good.violations.length}`);
  assert.ok(broken.violations.length > 10, `only ${broken.violations.length} violations from the broken barrier`);
  assert.strictEqual(broken.deadlocks, 0);
  assert.deepStrictEqual(good.violations, []);
});

// ---------------------------------------------------------------- T4: nested orchestration

test("T4 orchestrators outside the barrier, with Promise.all and sequential awaits, complete", async (t) => {
  const schedule = createBarrier();
  const t0 = now();
  const recs: Rec[] = [];
  const tool = (name: string, scope: Scope, dur = 10) => {
    const r: Rec = { i: recs.length, scope, entry: now() - t0, start: NaN, end: NaN };
    recs.push(r);
    return schedule(scope, async () => {
      r.start = now() - t0;
      await sleep(dur);
      r.end = now() - t0;
      return name;
    });
  };
  // Like a script that calls several tools: it is not registered itself, only the tools it calls are.
  const script = async (tag: string) => {
    const first = await Promise.all([tool(`${tag} w a`, M("/r/a")), tool(`${tag} r a`, R("/r/a")), tool(`${tag} bash`, B), tool(`${tag} r b`, R("/r/b"))]);
    const second = await tool(`${tag} w b`, M("/r/b"));
    const [x, y] = await Promise.all([tool(`${tag} r tree`, R("/r")), tool(`${tag} w d`, M("/r/d/c"))]);
    const third = await tool(`${tag} bash 2`, B);
    return [...first, second, x, y, third];
  };
  const res = await withGuard(Promise.all([script("s1"), script("s2"), script("s3")]));
  assert.notStrictEqual(res, "deadlock", "nested scripts did not complete within 5 s");
  const [one] = res as string[][];
  assert.deepStrictEqual(one, ["s1 w a", "s1 r a", "s1 bash", "s1 r b", "s1 w b", "s1 r tree", "s1 w d", "s1 bash 2"]);
  assert.strictEqual(recs.length, 24);
  const checked = checkOrder(recs);
  assert.deepStrictEqual(checked.violations, []);
  t.diagnostic(`maxSlack=${checked.maxSlack.toFixed(2)}ms`);
});
