import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { it } from "node:test";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";
import type { Component } from "@earendil-works/pi-tui";
import * as library from "@earendil-works/pi-coding-agent";
import type { ExtensionMode, ExtensionUIContext } from "@earendil-works/pi-coding-agent";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
// The exports map hides the bundle; exercise this runtime loading boundary by resolved file URL.
const bundle: typeof library = await import(new URL("./bundle/index.js", import.meta.resolve("@earendil-works/pi-coding-agent")).href);

const { FooterDataProvider } = await import(new URL("./core/footer-data-provider.js", import.meta.resolve("@earendil-works/pi-coding-agent")).href);

type EditorFactory = Parameters<ExtensionUIContext["setEditorComponent"]>[0];
const plainTheme = { fg: (_role: string, text: string) => text };
const ACTIVITY_KEY = "rqw-statusbar-activity";
/** Pi's ANSI and APC cursor marks removed, so visible text is compared without terminal control bytes. */
const plain = (line: string) => stripVTControlCharacters(line.replace(/\x1b_[^\x07]*\x07/g, ""));

/** Pi's extension UI slots in miniature: widget, footer and editor factories, as interactive mode calls them. */
function uiHarness(footer?: InstanceType<typeof FooterDataProvider>) {
	let component: (Component & { dispose?(): void }) | undefined;
	let editorFactory: EditorFactory;
	let editor: ReturnType<NonNullable<EditorFactory>> | undefined;
	let calls = 0, renders = 0, subscriptions = 0;
	const order: string[] = [];
	const widgets = new Map<string, Component & { dispose?(): void }>();
	const statuses = new Map<string, string>();
	const tui = { requestRender: () => renders++, terminal: { rows: 40 } } as never;
	const ui = {
		setWidget(key: string, content: unknown) {
			calls++;
			order.push("setWidget");
			widgets.get(key)?.dispose?.();
			if (content === undefined) {
				widgets.delete(key);
				return;
			}
			widgets.set(key, (content as (tui: unknown, theme: unknown) => Component)(tui, plainTheme));
		},
		setFooter(factory: Parameters<ExtensionUIContext["setFooter"]>[0]) {
			calls++;
			order.push("setFooter");
			component?.dispose?.();
			component = factory?.(tui, plainTheme as never,
				footer ?? { getGitBranch: () => null, getExtensionStatuses: () => statuses,
					onBranchChange: () => { subscriptions++; return () => { subscriptions--; }; },
					getAvailableProviderCount: () => 0 });
		},
		setEditorComponent(factory: EditorFactory) {
			calls++;
			order.push("setEditorComponent");
			const text = editor?.getText() ?? "";
			editorFactory = factory;
			editor = factory?.(tui, { borderColor: (text: string) => text, selectList: {} } as never,
				{ matches: () => false } as never);
			editor?.setText(text);
		},
		getEditorComponent: () => editorFactory,
		notify() {},
		theme: plainTheme,
	} as unknown as ExtensionUIContext;
	return { ui, statuses, order, render: (width = 80) => component?.render(width),
		/** Activity has no rows while idle; the native session title belongs to the editor border. */
		activity: (width = 80) => widgets.get(ACTIVITY_KEY)?.render(width),
		top: (width = 80) => editor?.render(width)[0],
		/** The editor's bottom border, undefined for Pi's stock editor. */
		border: (width = 80) => editor?.render(width).at(-1),
		get editor() { return editor; },
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
			// Normal Pi order: the activity widget is registered before the footer, and the footer really draws.
			assert.ok(h.order.indexOf("setWidget") >= 0, "the activity widget is registered");
			assert.ok(h.order.indexOf("setWidget") < h.order.indexOf("setFooter"), "activity widget before footer");
			assert.ok(h.render()!.length > 0, "the footer is installed and non-empty");
			assert.match(plain(h.render()![0]), /Fixture no/);
			assert.match(h.border()!, /\/450k$/);
			// Direct state replacement is deliberately not a model_select event: external sources must also work.
			session.agent.state.model = { ...model, id: "other", name: "Other", contextWindow: 272000 } as never;
			session.setThinkingLevel("high");
			assert.match(plain(h.render()![0]), /Other hi/);
			session.agent.state.thinkingLevel = "low";
			assert.match(plain(h.render()![0]), /Other lo/);
			assert.ok(h.border()!.endsWith("/244.8k"));
			session.sessionManager.appendCompaction("fixture summary", "unused", 10000);
			assert.match(plain(h.render()![0]), /cmp 1/);
			assert.ok(h.border()!.endsWith("?/244.8k"));
			h.statuses.set("z", "last"); h.statuses.set("a", "first\nsecond");
			assert.match(plain(h.render()![0]), /first second · last/);
			// The public session name reaches the top border through session_info_changed, not a title widget.
			session.setSessionName("Capped title");
			assert.match(plain(h.top()!), /^── Capped title /);
			assert.deepEqual(h.activity(), [], "idle reserves no activity rows");
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
