import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { it } from "node:test";
import { createAssistantMessageEventStream, type AssistantMessage, type AssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { Component } from "@earendil-works/pi-tui";
import * as pi from "@earendil-works/pi-coding-agent";

for (const resumeDuringStream of [false, true]) {
	it(`real SDK stream cancels a toggled-off rate, on ${resumeDuringStream ? "during" : "after"} the stream`, async (t) => {
		const cwd = mkdtempSync(join(tmpdir(), "rqw-status-rate-"));
		const agentDir = join(cwd, "agent"); mkdirSync(agentDir);
		let now = 10000;
		t.mock.method(Date, "now", () => now);
		let component: (Component & { dispose?(): void }) | undefined;
		let session: pi.AgentSession | undefined;
		let ready = Promise.withResolvers<AssistantMessageEventStream>();
		const cost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
		const model = { id: "faux", name: "Faux", provider: "statusbar-faux", api: "statusbar-faux-api",
			baseUrl: "http://127.0.0.1:1", reasoning: false, input: ["text"], cost, contextWindow: 500000, maxTokens: 1000 } as const;
		const loader = new pi.DefaultResourceLoader({ cwd, agentDir,
			additionalExtensionPaths: [fileURLToPath(new URL("../index.ts", import.meta.url))],
			noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
			extensionFactories: [(api) => {
				api.registerProvider(model.provider, { baseUrl: model.baseUrl, apiKey: "fake-local-only", api: model.api,
					models: [model as never], streamSimple() {
						const stream = createAssistantMessageEventStream();
						ready.resolve(stream);
						return stream;
					} });
			}] });
		const row = () => component!.render(100)[1];
		try {
			await loader.reload();
			assert.deepEqual(loader.getExtensions().errors, []);
			const runtime = await pi.ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: null, refreshOnCreate: false });
			({ session } = await pi.createAgentSession({ cwd, agentDir, model: model as never, modelRuntime: runtime,
				resourceLoader: loader, sessionManager: pi.SessionManager.inMemory(cwd),
				settingsManager: pi.SettingsManager.inMemory({ compaction: { enabled: false } }) }));
			await session.bindExtensions({ mode: "tui", uiContext: {
				setFooter(factory) {
					component?.dispose?.();
					component = factory?.({ requestRender() {} } as never, { fg: (_role: string, text: string) => text } as never,
						{ getExtensionStatuses: () => new Map(), onBranchChange: () => () => {} } as never);
				}, notify() {},
			} as pi.ExtensionUIContext });
			const toggle = (value: string) => session!.extensionRunner.getCommand("statusbar")!.handler(value,
				session!.extensionRunner.createCommandContext());
			async function begin() {
				const pending = session!.prompt("local faux stream only");
				const stream = await ready.promise;
				ready = Promise.withResolvers<AssistantMessageEventStream>();
				const content = { type: "text" as const, text: "" };
				const message: AssistantMessage = { role: "assistant", api: model.api, provider: model.provider, model: model.id,
					content: [content], usage: { input: 10, output: 100, cacheRead: 0, cacheWrite: 0,
						totalTokens: 110, cost: { ...cost, total: 0 } }, stopReason: "stop", timestamp: now };
				const started = Promise.withResolvers<void>();
				const unsubscribe = session!.subscribe(event => {
					if (event.type === "message_start" && event.message.role === "assistant") started.resolve();
				});
				stream.push({ type: "start", partial: message });
				stream.push({ type: "text_start", contentIndex: 0, partial: message });
				try { await started.promise; } finally { unsubscribe(); }
				return {
					async delta() {
						const delivered = Promise.withResolvers<void>();
						const unsubscribe = session!.subscribe(event => {
							if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") delivered.resolve();
						});
						now += 1000;
						const delta = "x".repeat(40);
						content.text += delta;
						stream.push({ type: "text_delta", contentIndex: 0, delta, partial: message });
						try { await delivered.promise; } finally { unsubscribe(); }
					},
					async end() {
						stream.push({ type: "text_end", contentIndex: 0, content: content.text, partial: message });
						stream.push({ type: "done", reason: "stop", message: message });
						stream.end();
						await pending;
						assert.equal(session!.isIdle, true);
					},
				};
			}
			const first = await begin();
			await first.delta();
			assert.match(row(), /10\.0 tok\/s/);
			await first.end();
			assert.match(row(), /100\.0 tok\/s/);
			now += 20000;
			assert.match(row(), /100\.0 tok\/s/, "completed rate is held between ordinary messages");
			const interrupted = await begin();
			await interrupted.delta();
			assert.match(row(), /10\.0 tok\/s/);
			await toggle("off");
			assert.equal(component, undefined);
			if (resumeDuringStream) await toggle("on");
			await interrupted.delta();
			if (resumeDuringStream) assert.doesNotMatch(row(), /tok\/s/, "tail deltas must not restart a cancelled measurement");
			await interrupted.end();
			if (!resumeDuringStream) await toggle("on");
			assert.doesNotMatch(row(), /tok\/s/);
			now += 20000;
			assert.doesNotMatch(row(), /tok\/s/, "no decaying unfinished rate after re-enabling");
			const next = await begin();
			await next.delta();
			await next.end();
			assert.match(row(), /100\.0 tok\/s/, "a new full measurement restores provider output rate");
			now += 20000;
			assert.match(row(), /100\.0 tok\/s/);
		} finally {
			component?.dispose?.(); session?.dispose(); rmSync(cwd, { recursive: true, force: true });
		}
	});
}
