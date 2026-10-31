import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { TestContext } from "node:test";
import { createFauxCore, fauxAssistantMessage } from "@earendil-works/pi-ai";
import { createEventBus, SessionManager } from "@earendil-works/pi-coding-agent";
import { registerSessionRuntime } from "../../../extensions/RQW-agent/index.ts";

/** A Codex world in temporary folders; the real ~/.codex and ~/.pi are never read. */
export async function world(t: TestContext) {
	const base = await realpath(await mkdtemp(join(tmpdir(), "rqw-agent-profile-start-")));
	const saved = { codex: process.env.CODEX_HOME, agent: process.env.PI_CODING_AGENT_DIR };
	process.env.CODEX_HOME = join(base, "codex");
	process.env.PI_CODING_AGENT_DIR = join(base, "agent");
	t.after(async () => {
		for (const [key, value] of [["CODEX_HOME", saved.codex], ["PI_CODING_AGENT_DIR", saved.agent]] as const) {
			if (value === undefined) delete process.env[key]; else process.env[key] = value;
		}
		await rm(base, { recursive: true, force: true });
	});
	const put = async (rel: string, text: string) => {
		await mkdir(dirname(join(base, rel)), { recursive: true });
		await writeFile(join(base, rel), text);
		return join(base, rel);
	};
	await put("project/.git/HEAD", "ref: refs/heads/main\n");
	await mkdir(join(base, "project", "pkg"), { recursive: true });
	return { base, put, project: join(base, "project"), cwd: join(base, "project", "pkg") };
}

export function runtime(cwd: string, root: string, thinking = "off", extraModels: string[] = []) {
	const hooks = new Map<string, ((event: any, ctx: any) => unknown)[]>();
	const parent = SessionManager.create(root, join(root, "parent"));
	// Two models: the parent's `model` and a distinct `other`, so a profile model that is ignored shows.
	const requests: any[] = [];
	const core = createFauxCore({ provider: "persist-test", models: [{ id: "model", reasoning: true }, { id: "other", reasoning: true }, ...extraModels.map(id => ({ id, reasoning: true }))] });
	const model = core.getModel("model")!;
	const models = new Map([["model", model], ["other", core.getModel("other")!], ...extraModels.map(id => [id, core.getModel(id)!] as const)]);
	// The faux core drops thinkingLevelMap; give the extra models the xhigh level the real Codex models have.
	for (const id of extraModels) (models.get(id) as any).thinkingLevelMap = { xhigh: "xhigh" };
	const efforts: any[] = [];
	core.setResponses(Array.from({ length: 8 }, () => async (context: any, options: any) => { requests.push(context); efforts.push(options?.reasoning); return fauxAssistantMessage("answer", { timestamp: 1 }); }));
	const modelRuntime = {
		getModel: () => model, getPhysicalModel: () => model, hasConfiguredAuth: () => true, getAuth: async () => ({ apiKey: "fake" }),
		checkAuth: async () => ({}), isUsingOAuth: () => false, getAvailableSnapshot: () => [...models.values()], getRegisteredProviderIds: () => [],
		streamSimple: core.streamSimple,
	};
	let definition: any;
	const ctx: any = {
		cwd, sessionManager: parent, model, modelRegistry: { runtime: modelRuntime, find: (_provider: string, id: string) => models.get(id), hasConfiguredAuth: () => true },
		isIdle: () => true, isProjectTrusted: () => true, getSystemPrompt: () => "original prompt", signal: new AbortController().signal, mode: "tui",
	};
	const pi: any = {
		events: createEventBus(), on: (name: string, hook: any) => hooks.set(name, [...hooks.get(name) ?? [], hook]),
		registerTool: (tool: any) => { definition = tool; },
		appendEntry: (name: string, data: any) => parent.appendCustomEntry(name, data),
		getSettings: () => ({ retry: { enabled: false }, compaction: { enabled: false } }),
		getThinkingLevel: () => thinking, getActiveTools: () => [],
		sendMessage: (message: any) => parent.appendCustomMessageEntry(message.customType, message.content, message.display, message.details),
	};
	const live = registerSessionRuntime(pi, pi.events, false, undefined, undefined, undefined, undefined, undefined, "", undefined);
	return {
		live, requests, efforts, events: pi.events, parent, description: () => definition.description as string,
		async emit(name: string) { for (const hook of hooks.get(name) ?? []) await hook({}, ctx); },
		execute: (params: any) => definition.execute("call", params, new AbortController().signal, undefined, ctx),
		/** Model, effort and prompt of the child that ran `task`, from the public status and the model request. */
		async resultOf(task: string, id: string) {
			const index = requests.findIndex(request => request.messages.find((m: any) => m.role === "user").content[0].text === task);
			const status = (await this.execute({ action: "status", ids: [id] })).details.statuses[0];
			return { model: status.model, effort: efforts[index], system: requests[index].messages.find((m: any) => m.role === "system").content as string };
		},
		systemOf: (task: string) => requests.find(request => request.messages.find((m: any) => m.role === "user").content[0].text === task).messages.find((m: any) => m.role === "system").content as string,
	};
}
