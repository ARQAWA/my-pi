// Actual Pi loops, agent/job notifications and tool-ui folding, with scripted local providers and the real widget.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { stripVTControlCharacters } from "node:util";
import { fauxAssistantMessage as answer, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import { AgentSession, createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager, type ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import agent from "../extensions/RQW-agent/index.ts";
import statusbar from "../extensions/RQW-statusbar/index.ts";
import { createTools, installRqwTools } from "../extensions/RQW-tools/index.ts";
import toolUi from "../extensions/RQW-tool-ui/index.ts";

const call = (name: string, args: Record<string, unknown>) => answer([fauxToolCall(name, args)], { stopReason: "toolUse" });
const wait = (name: string) => call(name, { action: "wait", ids: [name === "agent" ? "agent#1" : "job#1"], timeout_ms: 60000 });
const bash = (gate: string) => call("bash", { command: `while [ ! -f ${gate} ]; do sleep 0.02; done` });

for (const kind of ["running", "background", "nested", "main-only"] as const) {
	test(`full main answer preserves real waits: ${kind}`, async t => {
		const root = await mkdtemp(join(tmpdir(), "rqw-statusbar-wait-"));
		const agentDir = join(root, "home");
		await mkdir(agentDir);
		const main = fauxProvider({ provider: "wait-main", api: "wait-main", models: [{ id: "main" }] });
		const sub = fauxProvider({ provider: "wait-child", api: "wait-child", models: [{ id: "child" }, { id: "grandchild" }] });
		const runtime = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: null, refreshOnCreate: false });
		runtime.registerNativeProvider(main.provider);
		runtime.registerNativeProvider(sub.provider);
		const childEntered = Promise.withResolvers<void>();
		const childSettled = Promise.withResolvers<void>();
		const childGate = Promise.withResolvers<void>();
		const notified = Promise.withResolvers<void>();
		const mainJobNotified = Promise.withResolvers<void>();
		const events: string[] = [];
		const errors: string[] = [];
		let session: AgentSession | undefined;
		const observed = new WeakSet<AgentSession>();
		const subscribe = AgentSession.prototype.subscribe;
		t.mock.method(AgentSession.prototype, "subscribe", function(this: AgentSession, listener: Parameters<AgentSession["subscribe"]>[0]) {
			if (!observed.has(this)) {
				observed.add(this);
				subscribe.call(this, event => {
					const who = this.model?.provider === "wait-child" ? this.model.id : "main";
					if (event.type === "agent_end" || event.type === "agent_settled") events.push(`${who}:${event.type}`);
					if (event.type === "agent_settled" && who === "child") childSettled.resolve();
					if (event.type === "message_end" && event.message.role === "assistant") {
						const text = event.message.content.filter(c => c.type === "text").map(c => c.text).join("");
						if (text) events.push(`${who}:answer:${text}`);
					}
					if (event.type === "message_end" && event.message.role === "custom") events.push(`${who}:notice:${event.message.customType}`);
					if (event.type === "agent_settled" && who === "main") {
						if (events.includes("main:answer:notification consumed")) notified.resolve();
						if (events.includes("main:answer:main job consumed")) mainJobNotified.resolve();
					}
				});
			}
			return subscribe.call(this, listener);
		});
		const widgets = new Map<string, { render(width: number): string[] }>();
		let editor: unknown;
		let footer: { dispose?(): void } | undefined;
		const theme = { fg: (_role: string, text: string) => text };
		const tui = { requestRender() {}, terminal: { rows: 40 } };
		const ui = {
			theme, notify() {}, setWorkingIndicator() {},
			getEditorComponent: () => editor,
			setEditorComponent: (factory: unknown) => { editor = factory; },
			setWidget: (key: string, factory: any) => {
				if (factory) widgets.set(key, factory(tui, theme));
				else widgets.delete(key);
			},
			setFooter: (factory: any) => {
				footer?.dispose?.();
				footer = factory?.(tui, theme, { onBranchChange: () => () => {}, getExtensionStatuses: () => new Map() });
			},
		} as unknown as ExtensionUIContext;
		const rows = () => widgets.get("rqw-statusbar-activity")!.render(100).map(stripVTControlCharacters);
		const hasChild = kind !== "main-only";
		const mainJob = kind === "nested" || kind === "main-only";
		try {
			const loader = new DefaultResourceLoader({ cwd: root, agentDir,
				extensionFactories: [agent, statusbar, pi => installRqwTools(pi, { backgroundAfterMs: 5 }), toolUi, pi => {
					// Keep the real offered tools/bridge; shrink only the test handoff threshold.
					pi.events.on("rqw-tools:subagent-tools", (request: any) => request.offer((cwd: string, settings: any, nested: any, options: any) =>
						createTools(cwd, settings, nested, { ...options, backgroundAfterMs: 5 })));
				}],
				noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
			await loader.reload();
			assert.deepEqual(loader.getExtensions().errors, []);
			({ session } = await createAgentSession({ cwd: root, agentDir, modelRuntime: runtime, model: main.getModel("main"),
				resourceLoader: loader, sessionManager: SessionManager.inMemory(root),
				settingsManager: SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } }) }));
			session.subscribe(() => {});
			await session.bindExtensions({ mode: "tui", uiContext: ui, onError: e => errors.push(e.error) });
			const gated = async () => { childEntered.resolve(); await childGate.promise; return answer("child finished"); };
			if (kind === "background") sub.setResponses([bash("gate-child"), wait("job"), answer("child finished")]);
			else if (kind === "nested") {
				// Grandchild is gated; its parent really calls the notification wait and settles.
				let childCalls = 0;
				sub.setResponses(Array.from({ length: 4 }, () => async (_context: unknown, _options: unknown, _state: unknown, model: { id: string }) => {
					if (model.id === "grandchild") return gated();
					childCalls++;
					if (childCalls === 1) return call("agent", { action: "start", task: "nested", model: "wait-child/grandchild", tools: [] });
					return childCalls === 2 ? wait("agent") : answer("child finished");
				}));
			} else sub.setResponses([gated]);
			main.setResponses([
				...(hasChild ? [call("agent", { action: "start", task: "work", system: "test", model: "wait-child/child", tools: ["bash"] }), wait("agent")] : []),
				...(mainJob ? [bash("gate-main"), wait("job")] : []),
				answer("full owner answer"),
				...(mainJob ? [answer("main job consumed")] : []),
				answer("notification consumed"),
			]);
			if (hasChild) {
				await session.prompt("start and wait");
				if (kind === "background" || kind === "nested") await childSettled.promise;
				else await childEntered.promise;
				assert.ok(session.messages.some(m => m.role === "toolResult" && m.toolName === "agent" && (m.details as any)?.reason === "waiting"));
			}
			if (mainJob) {
				await session.prompt("start main background work and wait");
				assert.ok(session.messages.some(m => m.role === "toolResult" && m.toolName === "job" && (m.details as any)?.reason === "waiting"));
			}
			await session.prompt("answer me while work waits");
			assert.deepEqual(events.slice(-3), ["main:answer:full owner answer", "main:agent_end", "main:agent_settled"]);
			const agents = kind === "nested" ? 2 : hasChild ? 1 : 0;
			const parts = [...(agents ? [`${agents} ${agents === 1 ? "agent" : "agents"}`] : []), ...(mainJob ? ["1 background process"] : [])];
			assert.deepEqual(rows(), [` Waiting for ${parts.join(", ")}`, ""], "full answer/settlement must preserve both real waiting categories");
			const calls = (hasChild ? 2 : 0) + (mainJob ? 2 : 0) + 1;
			assert.equal(main.state.callCount, calls, "no extra model request just to wait");
			if (mainJob) {
				await writeFile(join(root, "gate-main"), "");
				await mainJobNotified.promise;
				assert.ok(events.includes("main:notice:job"));
				assert.deepEqual(rows(), agents ? [` Waiting for ${agents} agents`, ""] : [], "only the finished category disappears");
			}
			if (hasChild) {
				if (kind === "background") await writeFile(join(root, "gate-child"), "");
				else childGate.resolve();
				await notified.promise;
				assert.ok(events.includes("main:notice:child_wait"), "one later notification delivers the real agent wait");
			}
			assert.deepEqual(rows(), [], "genuinely idle has no activity rows or gaps");
			assert.equal(main.state.callCount, calls + Number(mainJob) + Number(hasChild));
			assert.deepEqual(errors, []);
		} finally {
			childGate.resolve();
			await Promise.all(["gate-child", "gate-main"].map(file => writeFile(join(root, file), "")));
			await session?.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
			session?.dispose();
			footer?.dispose?.();
			await rm(root, { recursive: true, force: true });
		}
	});
}
