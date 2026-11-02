import assert from "node:assert/strict";
import { it } from "node:test";
import { createCoordinatorGuard } from "../.pi/extensions/coordinator-guard/index.ts";
import { call, text, world } from "./synthetic/world.ts";

it("keeps todo available in a direct chat", async (t) => {
	const key = Symbol.for("my-pi.coordinator-guard.shared");
	const globals = globalThis as Record<symbol, unknown>;
	const saved = globals[key];
	globals[key] = { role: "direct" };
	t.after(() => { if (saved === undefined) delete globals[key]; else globals[key] = saved; });
	const guard = { name: "coordinator-guard", factory: createCoordinatorGuard({ root: "/not-a-git-repository" }) };
	const w = await world(t, { beforeExtensions: [guard] });
	w.model.script(call("todo", { items: [{ id: "a", text: "Direct work", status: "blocked", note: "waiting" }] }), text("waiting"));
	await w.submit("$todo start");
	assert.ok(w.session.extensionRunner!.getActiveTools().includes("todo"));
	w.see("Direct work");
	await w.dispose();
	assert.deepEqual(w.patched(), []);
});

for (const order of ["before", "after"] as const) {
	it(`coordinator disables restored todo when guard loads ${order} the package`, async (t) => {
		const key = Symbol.for("my-pi.coordinator-guard.shared");
		const globals = globalThis as Record<symbol, unknown>;
		const saved = globals[key];
		globals[key] = { role: "coordinator" };
		t.after(() => { if (saved === undefined) delete globals[key]; else globals[key] = saved; });
		let installGuard = false;
		const guard = { name: "coordinator-guard", factory: (pi: Parameters<ReturnType<typeof createCoordinatorGuard>>[0]) => { if (installGuard) createCoordinatorGuard({ root: "/not-a-git-repository" })(pi); } };
		const w = await world(t, order === "before" ? { beforeExtensions: [guard] } : { afterExtensions: [guard] });
		w.model.script(call("todo", { items: [{ id: "a", text: "Work", status: "blocked", note: "waiting" }] }), text("waiting"));
		await w.submit("$todo start");
		w.see("Work");
		installGuard = true;
		const fresh = await w.restart();
		assert.ok(!fresh.session.extensionRunner!.getActiveTools().includes("todo"));
		fresh.notSee("Work · waiting");
		const context = await fresh.session.extensionRunner!.emitContext(fresh.session.agent.state.messages);
		assert.ok(!JSON.stringify(context).includes("Текущий список дел:"));
		assert.deepEqual(fresh.errors, []);
		await fresh.dispose();
		assert.deepEqual(fresh.patched(), []);
	});
}
