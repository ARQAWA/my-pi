import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { it } from "node:test";
import { fileURLToPath } from "node:url";
import type { Component } from "@earendil-works/pi-tui";
import * as library from "@earendil-works/pi-coding-agent";
import type { ExtensionMode, ExtensionUIContext } from "@earendil-works/pi-coding-agent";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
// The exports map hides the bundle; exercise this runtime loading boundary by resolved file URL.
const bundle: typeof library = await import(new URL("./bundle/index.js", import.meta.resolve("@earendil-works/pi-coding-agent")).href);

const { FooterDataProvider } = await import(new URL("./core/footer-data-provider.js", import.meta.resolve("@earendil-works/pi-coding-agent")).href);

function uiHarness(footer?: InstanceType<typeof FooterDataProvider>) {
	let component: (Component & { dispose?(): void }) | undefined;
	let calls = 0, renders = 0, subscriptions = 0;
	const statuses = new Map<string, string>();
	const ui = {
		setFooter(factory: Parameters<ExtensionUIContext["setFooter"]>[0]) {
			calls++;
			component?.dispose?.();
			component = factory?.({ requestRender: () => renders++ } as never,
				{ fg: (_role: string, text: string) => text } as never,
				footer ?? { getGitBranch: () => null, getExtensionStatuses: () => statuses,
					onBranchChange: () => { subscriptions++; return () => { subscriptions--; }; },
					getAvailableProviderCount: () => 0 });
		},
		notify() {},
	} as ExtensionUIContext;
	return { ui, statuses, render: (width = 80) => component?.render(width),
		get calls() { return calls; }, get renders() { return renders; }, get subscriptions() { return subscriptions; },
		dispose: () => component?.dispose?.() };
}

for (const [label, pi] of [["library", library], ["bundle", bundle]] as const) {
	it(`${label} capped: actual Pi loader with both extensions caps a 1M model to 500k, with live model/thinking getters, context, compactions and modes without a request`, async () => {
		const cwd = mkdtempSync(join(tmpdir(), "rqw-status-capped-"));
		const agentDir = join(cwd, "agent"); mkdirSync(agentDir);
		const model = { id: "fixture", name: "Claude Fixture", provider: "fixture", api: "openai-completions",
			baseUrl: "http://127.0.0.1:1", reasoning: true, input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1000000, maxTokens: 1000 } as const;
		const loader = new pi.DefaultResourceLoader({ cwd, agentDir, additionalExtensionPaths: [join(root, "extensions/RQW-statusbar/index.ts"), join(root, "extensions/RQW-context/index.ts")],
			noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
		let session: library.AgentSession | undefined;
		const h = uiHarness();
		try {
			await loader.reload();
			assert.deepEqual(loader.getExtensions().errors, []);
			const runtime = await pi.ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: null, refreshOnCreate: false });
			({ session } = await pi.createAgentSession({ cwd, agentDir, model: model as never, modelRuntime: runtime,
				thinkingLevel: "off", resourceLoader: loader, sessionManager: pi.SessionManager.inMemory(cwd),
				settingsManager: pi.SettingsManager.inMemory({ compaction: {} }) }));
			await session.bindExtensions({ uiContext: h.ui, mode: "tui" });
			assert.equal(session.model?.contextWindow, 500000);
			assert.match(h.render()![1], /Fixture no/);
			assert.match(h.render()![0], /\/450k$/);
			// Direct state replacement is deliberately not a model_select event: external sources must also work.
			session.agent.state.model = { ...model, id: "other", name: "Other", contextWindow: 272000 } as never;
			session.setThinkingLevel("high");
			assert.match(h.render()![1], /Other hi/);
			session.agent.state.thinkingLevel = "low";
			assert.match(h.render()![1], /Other lo/);
			assert.ok(h.render()![0].endsWith("/244.8k"));
			session.sessionManager.appendCompaction("fixture summary", "unused", 10000);
			assert.match(h.render()![1], /cmp 1/);
			assert.ok(h.render()![0].endsWith("?/244.8k"));
			h.statuses.set("z", "last"); h.statuses.set("a", "first\nsecond");
			assert.match(h.render()![1], /first second · last/);
			const command = session.extensionRunner.getCommand("statusbar")!;
			await command.handler("off", session.extensionRunner.createCommandContext());
			assert.equal(h.render(), undefined); assert.equal(h.subscriptions, 0);
			await session.extensionRunner.emit({ type: "session_start" });
			assert.equal(h.render(), undefined, "off survives a new session in this runtime");
			await command.handler("on", session.extensionRunner.createCommandContext());
			assert.equal(h.subscriptions, 1);
			await command.handler("nonsense", session.extensionRunner.createCommandContext());
			assert.equal(h.subscriptions, 1);
			await command.handler("", session.extensionRunner.createCommandContext());
			assert.equal(h.subscriptions, 0);
			for (const mode of ["rpc", "json", "print"] as ExtensionMode[]) {
				session.extensionRunner.setUIContext(h.ui, mode);
				const calls = h.calls;
				await session.extensionRunner.emit({ type: "session_start" });
				await command.handler("on", session.extensionRunner.createCommandContext());
				assert.equal(h.calls, calls, `${mode}: no footer calls`);
			}
		} finally {
			try {
				await session?.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
			} finally {
				h.dispose(); session?.dispose(); rmSync(cwd, { recursive: true, force: true });
			}
		}
		// After shutdown a stock settings read must not see the context owner's 500k cap or override.
		assert.equal(pi.SettingsManager.inMemory({ compaction: { reserveTokens: 600000 } })
			.getCompactionSettings({ ...model, contextWindow: 500000 } as never).reserveTokens, 600000);
	});
}
