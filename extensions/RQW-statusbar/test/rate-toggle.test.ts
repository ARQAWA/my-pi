import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { it } from "node:test";
import { createAssistantMessageEventStream, type AssistantMessage, type AssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { Component } from "@earendil-works/pi-tui";
import * as pi from "@earendil-works/pi-coding-agent";

{
	it("real SDK stream: tok/s is output tokens over Pi's response duration, held and reset", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "rqw-status-rate-"));
		const agentDir = join(cwd, "agent"); mkdirSync(agentDir);
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
		let editor: Parameters<pi.ExtensionUIContext["setEditorComponent"]>[0];
		// With this extension's editor installed the footer is the model row, then the place row.
		const row = () => component!.render(100)[0];
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
				setEditorComponent(factory) { editor = factory; }, getEditorComponent: () => editor,
			} as pi.ExtensionUIContext });
			const toggle = (value: string) => session!.extensionRunner.getCommand("statusbar")!.handler(value,
				session!.extensionRunner.createCommandContext());
			// One faux response ending with these provider numbers; `durationMs` is Pi's own field of the final message
			// (the stream fills it from its monotonic clock only when absent and the message timestamp is not older).
			async function turn(usage: { output: number }, durationMs: number | undefined, stopReason: "stop" | "aborted" | "error" = "stop") {
				const pending = session!.prompt("local faux stream only");
				const stream = await ready.promise;
				ready = Promise.withResolvers<AssistantMessageEventStream>();
				const message: AssistantMessage = { role: "assistant", api: model.api, provider: model.provider, model: model.id,
					content: [{ type: "text", text: "ok" }], usage: { input: 10, output: usage.output, cacheRead: 0, cacheWrite: 0,
						totalTokens: 10 + usage.output, cost: { ...cost, total: 0 } }, stopReason,
					timestamp: durationMs === undefined ? 0 : Date.now(), ...(durationMs === undefined ? {} : { durationMs }) };
				stream.push({ type: "start", partial: message });
				stream.push(stopReason === "stop" ? { type: "done", reason: "stop", message }
					: { type: "error", reason: stopReason, error: message });
				stream.end();
				await pending;
				assert.equal(session!.isIdle, true);
			}
			assert.doesNotMatch(row(), /tok\/s/, "nothing before the first qualified response");
			await turn({ output: 44 }, 1);
			assert.doesNotMatch(row(), /tok\/s/, "44 tokens in 1 ms is not 44000 tok/s: too short to measure");
			await turn({ output: 100 }, 499);
			assert.doesNotMatch(row(), /tok\/s/, "just under the minimum is skipped");
			await turn({ output: 0 }, 5000);
			assert.doesNotMatch(row(), /tok\/s/, "no output tokens is skipped");
			await turn({ output: 100 }, undefined);
			assert.doesNotMatch(row(), /tok\/s/, "a message without durationMs is skipped, with no chars/4 fallback");
			await turn({ output: 100 }, 2000);
			assert.match(row(), /50\.0 tok\/s/, "output tokens over the duration");
			await turn({ output: 77 }, 400);
			await turn({ output: 100 }, undefined);
			assert.match(row(), /50\.0 tok\/s/, "unqualified responses hold the last value");
			await turn({ output: 5 }, 3000, "aborted");
			await turn({ output: 5 }, 3000, "error");
			assert.match(row(), /50\.0 tok\/s/, "an interrupted or failed response with output and a qualifying duration keeps the value");
			await turn({ output: 300 }, 500);
			assert.match(row(), /600\.0 tok\/s/, "exactly the minimum qualifies and replaces the value");
			await session.extensionRunner.emit({ type: "session_tree" } as never);
			assert.doesNotMatch(row(), /tok\/s/, "a tree change resets the value");
			await turn({ output: 100 }, 2000);
			assert.match(row(), /50\.0 tok\/s/);
			await session.extensionRunner.emit({ type: "session_start" } as never);
			assert.doesNotMatch(row(), /tok\/s/, "a session start resets the value");
			await turn({ output: 100 }, 4000);
			assert.match(row(), /25\.0 tok\/s/);
			await toggle("off");
			assert.equal(component, undefined);
			await turn({ output: 100 }, 1000);
			await toggle("on");
			assert.doesNotMatch(row(), /tok\/s/, "a toggle resets the value and a response ended while off is not recorded");
			await turn({ output: 100 }, 1000);
			assert.match(row(), /100\.0 tok\/s/);
		} finally {
			component?.dispose?.(); session?.dispose(); rmSync(cwd, { recursive: true, force: true });
		}
	});
}
