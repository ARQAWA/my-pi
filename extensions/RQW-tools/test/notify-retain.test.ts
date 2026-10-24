import assert from "node:assert/strict";
import { test } from "node:test";
import { createJobs } from "../jobs.ts";

async function fixture() {
	const events: string[] = [];
	const done = Promise.withResolvers<void>();
	const delivered = Promise.withResolvers<void>();
	const jobs = createJobs({
		backgroundAfterMs: 1,
		retain() { events.push("retain"); return () => { events.push("release"); }; },
		notify() { events.push("notify"); delivered.resolve(); },
	});
	const result = await jobs.run({ tool: "read", command: "held", process: false }, async handle => {
		await handle.begin();
		await done.promise;
		return { content: [{ type: "text", text: "finished" }], details: {} };
	});
	const id = (result.details as { job: { id: string } }).job.id;
	return { jobs, id, events, done, delivered };
}

test("notification retains the caller until after its result is handed off", async () => {
	const f = await fixture();
	try {
		assert.equal(f.jobs.watch([f.id], 60000, 20).waiting, true);
		assert.deepEqual(f.events, ["retain"]);
		f.done.resolve();
		await f.delivered.promise;
		assert.deepEqual(f.events, ["retain", "notify", "release"]);
		f.jobs.dispose();
		assert.deepEqual(f.events, ["retain", "notify", "release"]);
	} finally { f.done.resolve(); f.jobs.dispose(); await f.jobs.settled(f.id); }
});

test("replacement and disposal each release exactly their own notification hold", async () => {
	const f = await fixture();
	try {
		f.jobs.watch([f.id], 60000, 20);
		f.jobs.watch([f.id], 60000, 20);
		assert.deepEqual(f.events, ["retain", "release", "retain"]);
		f.jobs.dispose();
		f.jobs.dispose();
		assert.deepEqual(f.events, ["retain", "release", "retain", "release"]);
	} finally { f.done.resolve(); f.jobs.dispose(); await f.jobs.settled(f.id); }
});

/** A held read job of `jobs`; `output` is what it has printed, `end` finishes it. */
async function held(jobs: ReturnType<typeof createJobs>, output = "") {
	const gate = Promise.withResolvers<void>();
	const result = await jobs.run({ tool: "read", command: "held", process: false }, async handle => {
		await handle.begin();
		if (output) handle.data(output);
		await gate.promise;
		return { content: [{ type: "text", text: "finished" }], details: {} };
	});
	return { id: (result.details as { job: { id: string } }).job.id, end: () => gate.resolve() };
}

const quiet = (ms: number) => new Promise(r => setTimeout(r, ms));

test("a newer wait that is ready at once (readiness match) replaces the older one: no stale deadline notification", async () => {
	const events: string[] = [];
	const jobs = createJobs({ backgroundAfterMs: 1, retain() { events.push("retain"); return () => { events.push("release"); }; }, notify() { events.push("notify"); } });
	const job = await held(jobs, "server ready\n");
	try {
		assert.equal(jobs.watch([job.id], 40, 20).waiting, true);
		const now = jobs.watch([job.id], 60000, 20, /ready/);
		assert.equal(now.waiting, false);
		assert.equal(now.result.reason, "match");
		assert.deepEqual(events, ["retain", "release"], "the older wait was released once; the immediate one never held");
		await quiet(200); // past the older wait's deadline
		assert.deepEqual(events, ["retain", "release"], "no stale deadline notification");
		job.end();
		await jobs.settled(job.id);
		await quiet(50);
		assert.deepEqual(events, ["retain", "release"], "no stale notification when the job ends");
	} finally { job.end(); jobs.dispose(); }
});

for (const [name, immediate] of [["readiness match", "ready"], ["an already ended job", "ended"]] as const) {
	test(`an older multi-job wait is replaced by a wait ready at once on one of its jobs (${name}): the other job ending wakes nobody`, async () => {
		const events: string[] = [];
		const jobs = createJobs({ backgroundAfterMs: 1, retain() { events.push("retain"); return () => { events.push("release"); }; }, notify() { events.push("notify"); } });
		const a = await held(jobs, immediate === "ready" ? "ready\n" : "");
		const b = await held(jobs);
		try {
			assert.equal(jobs.watch([a.id, b.id], 60000, 20).waiting, true);
			// The ended variant: A ends inside the older wait's settle window, then the newer wait hands A over itself.
			if (immediate === "ended") { a.end(); await jobs.settled(a.id); }
			const now = jobs.watch([a.id], 60000, 20, immediate === "ready" ? /ready/ : undefined);
			assert.equal(now.waiting, false);
			assert.deepEqual(events, ["retain", "release"]);
			b.end();
			await jobs.settled(b.id);
			await quiet(400); // past the settle window
			assert.deepEqual(events, ["retain", "release"], "the replaced wait never announces the other job");
		} finally { a.end(); b.end(); jobs.dispose(); }
	});
}
