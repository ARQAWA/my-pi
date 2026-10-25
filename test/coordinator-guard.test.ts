// Unit tests of the repo-local dev guard `.pi/extensions/coordinator-guard` with a fake pi and ctx.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { after, afterEach, beforeEach, describe, it } from "node:test";
import { pathToFileURL } from "node:url";
import { childInstruction, createCoordinatorGuard, ROOT } from "../.pi/extensions/coordinator-guard/index.ts";
import { parseRules, THINKING } from "../.pi/extensions/coordinator-guard/rules.ts";

describe("coordinator-guard local development tooling", { skip: process.platform !== "darwin" && "Local development tooling is supported only on the owner's macOS laptop" }, () => {
// Generic parser/optional-format fixture, not the active repository policy.
const RULES = {
	agentModels: {
		simple: [["openai-codex/gpt-6.1-sol", "low"]],
		complex: [["openai-codex/gpt-6.1-sol", "medium"]],
		hardest: [["openai-codex/gpt-6.1-sol", "high"]],
		haiku: ["off", "low", "medium", "high", "xhigh", "max"].map((level) => ["anthropic/claude-haiku-5-5", level]),
	},
};
// Optional-format coverage only, not active repository policy.
const OPTIONAL_RULES = { ...RULES, temporaryGptOnly: { until: "2999-01-01T00:00:00Z" } };
const UNTIL = Date.parse(OPTIONAL_RULES.temporaryGptOnly.until);
const BEFORE = UNTIL - 1;
const processMd = (json: unknown) => `# Development process\n\n## Subagent models\n\n\`\`\`json coordinator-rules\n${typeof json === "string" ? json : JSON.stringify(json, null, 2)}\n\`\`\`\n\nMore prose.\n`;

// Layout: <tmp>/my-pi (main checkout, .git folder), <tmp>/my-pi-worktrees/wt (this worktree, root of the guard),
// <tmp>/elsewhere/wt2 (a second registered worktree outside my-pi-worktrees), <tmp>/my-pi-evidence.
const TMP = realpathSync(mkdtempSync(join(tmpdir(), "coordinator-guard-")));
after(() => rmSync(TMP, { recursive: true, force: true }));
const MAIN = join(TMP, "my-pi");
const WT = join(TMP, "my-pi-worktrees", "wt");
const WT2 = join(TMP, "elsewhere", "wt2");
const EVIDENCE = join(TMP, "my-pi-evidence");
for (const dir of [join(MAIN, ".git", "worktrees", "wt"), join(MAIN, ".git", "worktrees", "wt2"), WT, WT2, EVIDENCE, join(TMP, "my-pi-other")]) mkdirSync(dir, { recursive: true });
for (const [name, dir] of [["wt", WT], ["wt2", WT2]] as const) {
	writeFileSync(join(MAIN, ".git", "worktrees", name, "gitdir"), `${join(dir, ".git")}\n`);
	writeFileSync(join(MAIN, ".git", "worktrees", name, "commondir"), "../..\n");
	writeFileSync(join(dir, ".git"), `gitdir: ${join(MAIN, ".git", "worktrees", name)}\n`);
}
writeFileSync(join(MAIN, "README.md"), "main\n");
// A junction needs no privilege on Windows; a file symlink may, so the dangling case is skipped where it cannot be made.
symlinkSync(MAIN, join(EVIDENCE, "to-main"), "junction");
let dangling = true;
try { symlinkSync(join(MAIN, "not-yet.txt"), join(EVIDENCE, "dangling"), "file"); } catch { dangling = false; }
const PROCESS = join(WT, "PROCESS.md");
const setRules = (json: unknown) => writeFileSync(PROCESS, processMd(json));
setRules(RULES);

type Handler = (event: any, ctx: any) => any;
function load(entries: unknown[] = [], now: number = UNTIL) {
	const handlers = new Map<string, Handler[]>();
	const status: Record<string, string | undefined> = {};
	const pi = { on: (name: string, h: Handler) => void handlers.set(name, [...(handlers.get(name) ?? []), h]) };
	createCoordinatorGuard({ root: WT, now: () => now })(pi as never);
	const ctx = { cwd: WT, hasUI: true, ui: { setStatus: (k: string, v?: string) => void (status[k] = v), notify: () => {} }, sessionManager: { getEntries: () => entries, getSessionId: () => "unit" } };
	const call = (toolName: string, input: Record<string, unknown>) => {
		const event = { type: "tool_call", toolName, toolCallId: "t1", input };
		let result: any;
		for (const h of handlers.get("tool_call")!) result = h(event, ctx) ?? result;
		return { result, input: event.input };
	};
	const prompt = () => {
		const event = { type: "before_agent_start", systemPrompt: "", systemPromptOptions: { sections: {} as Record<string, string> } };
		for (const h of handlers.get("before_agent_start")!) h(event, ctx);
		return event.systemPromptOptions.sections.coordinator_rules;
	};
	const start = () => handlers.get("session_start")!.forEach((h) => h({ type: "session_start" }, ctx));
	return { call, prompt, start, status, ctx };
}
const user = (text: string) => ({ type: "message", message: { role: "user", content: [{ type: "text", text }], timestamp: 1 } });
const blocked = (r: { result: any }, pattern: RegExp) => {
	assert.equal(r.result?.block, true, "expected a block");
	assert.match(r.result.reason, pattern);
};
const passed = (r: { result: any }) => assert.equal(r.result, undefined, `unexpected block: ${r.result?.reason}`);

describe("coordinator-guard: agent model and thinking", () => {
	const g = load();
	for (const [model, thinking] of Object.values(RULES.agentModels).flat()) {
		it(`allows ${model} ${thinking} and appends the child instruction`, () => {
			const r = g.call("agent", { action: "start", model, thinking, task: "do it" });
			passed(r);
			assert.equal(r.input.task, `do it\n\n${childInstruction(parseRules(processMd(RULES)), UNTIL)}`);
		});
	}
	const denied: [string, string][] = [
		...["claude-sonnet-5-5", "claude-opus-5-5", "claude-sonnet-4-6", "claude-opus-4-7"].flatMap((id) =>
			["off", "minimal", "low", "medium", "high", "xhigh", "max"].map((level): [string, string] => [`anthropic/${id}`, level])),
		["openai-codex/gpt-6.1-sol", "xhigh"], ["openai-codex/gpt-6.1-sol", "max"],
		["claude-haiku-5-5", "medium"], ["anthropic/claude-haiku-5-5", "minimal"],
	];
	for (const [model, thinking] of denied) {
		it(`blocks ${model} ${thinking} on start and restart`, () => {
			blocked(g.call("agent", { action: "start", model, thinking, task: "x" }), /is not an allowed pair; allowed: simple: .*PROCESS\.md#subagent-models/);
			blocked(g.call("agent", { action: "restart", id: "agent#1", model, thinking }), /is not an allowed pair/);
		});
	}
	it("requires explicit model and thinking, also with missing action and on restart", () => {
		blocked(g.call("agent", { task: "x" }), /give model and thinking explicitly on agent start/);
		blocked(g.call("agent", { action: "start", model: "anthropic/claude-opus-5-5", task: "x" }), /explicitly/);
		blocked(g.call("agent", { action: "start", thinking: "medium", task: "x" }), /explicitly/);
		blocked(g.call("agent", { action: "restart", id: "agent#1" }), /explicitly on agent restart/);
		passed(g.call("agent", { model: "anthropic/claude-haiku-5-5", thinking: "max", task: "x" }));
	});
	it("restart without a task passes unchanged", () => {
		const r = g.call("agent", { action: "restart", id: "agent#1", model: "openai-codex/gpt-6.1-sol", thinking: "low" });
		passed(r);
		assert.equal(r.input.task, undefined);
	});
	it("allows a profile with its matching explicit model and thinking", () => {
		passed(g.call("agent", { action: "start", agent_type: "spotty", model: "openai-codex/gpt-6.1-sol", thinking: "low", task: "review" }));
		blocked(g.call("agent", { action: "start", agent_type: "spotty", task: "review" }), /give model and thinking explicitly/);
	});
	it("leaves management actions alone", () => {
		for (const action of ["wait", "status", "interrupt", "resume", "stop"]) passed(g.call("agent", { action, id: "agent#1", ids: ["agent#1"] }));
		passed(g.call("agent", { action: "send", id: "agent#1", task: "more" }));
	});
	it("the child instruction carries only the ordinary agent model rules", () => {
		const line = childInstruction(parseRules(processMd(RULES)), UNTIL);
		assert.match(line, /ordinary `agent` subagent, give model and thinking explicitly/);
		assert.match(line, /simple: openai-codex\/gpt-6\.1-sol low; complex: .*; hardest: openai-codex\/gpt-6\.1-sol high; haiku: anthropic\/claude-haiku-5-5 off, .*anthropic\/claude-haiku-5-5 max/);
		assert.doesNotMatch(line, /explore|review tool/);
		assert.doesNotMatch(line, /«|»/);
	});
});

describe("coordinator-guard: optional GPT-only override format", () => {
	beforeEach(() => setRules(OPTIONAL_RULES));
	afterEach(() => setRules(RULES));
	it("allows all three Sol levels on start and restart before expiry", () => {
		const g = load([], BEFORE);
		for (const thinking of ["low", "medium", "high"]) {
			for (const action of ["start", "restart"]) {
				const r = g.call("agent", { action, model: "openai-codex/gpt-6.1-sol", thinking, task: "x" });
				passed(r);
				assert.match(r.input.task as string, /Temporary rule until 2999-01-01T00:00:00Z/);
			}
		}
	});
	it("blocks every table Haiku pair even with an arbiter title on start and restart", () => {
		const g = load([], BEFORE);
		for (const [model, thinking] of Object.values(RULES.agentModels).flat().filter(([m]) => m.startsWith("anthropic/"))) {
			for (const action of ["start", "restart"]) {
				for (const title of [undefined, "Арбитр замера", "Арбитр замера 3: reviewer A"]) {
					const r = g.call("agent", { action, model, thinking, title, task: "x" });
					blocked(r, /Temporary rule until 2999-01-01T00:00:00Z/);
					assert.match(r.result.reason, /All Anthropic models are blocked, including benchmark arbiters/);
					assert.doesNotMatch(r.result.reason.split("allowed:")[1], /anthropic\//);
				}
			}
		}
	});
	it("adds no unauthorized GPT pair or model", () => {
		const g = load([], BEFORE);
		for (const [model, thinking] of [["openai-codex/gpt-6.1-sol", "xhigh"], ["openai-codex/gpt-6-luna", "low"]]) {
			blocked(g.call("agent", { action: "start", model, thinking, task: "x" }), /is not an allowed pair/);
		}
	});
	it("states GPT-only restriction and expiry in Main's prompt and child instruction", () => {
		for (const text of [load([], BEFORE).prompt(), childInstruction(parseRules(processMd(OPTIONAL_RULES)), BEFORE)]) {
			assert.match(text, /Temporary rule until 2999-01-01T00:00:00Z: only the allowed openai-codex\/gpt-6\.1-sol task pairs may be used/);
			assert.match(text, /All Anthropic models are blocked, including benchmark arbiters/);
			assert.match(text, /After that time the normal table applies again/);
			assert.match(text, /simple: openai-codex\/gpt-6\.1-sol low; complex: openai-codex\/gpt-6\.1-sol medium; hardest: openai-codex\/gpt-6\.1-sol high/);
			assert.doesNotMatch(text, /anthropic\/|Only a start whose title|«|»/);
		}
	});
	it("restores every table pair at exact expiry and afterwards", () => {
		for (const now of [UNTIL, UNTIL + 1, UNTIL + 86_400_000]) {
			const g = load([], now);
			for (const [model, thinking] of Object.values(RULES.agentModels).flat()) {
				for (const action of ["start", "restart"]) {
					const r = g.call("agent", { action, model, thinking, task: "x" });
					passed(r);
					assert.doesNotMatch(r.input.task as string, /Temporary rule/);
				}
			}
			assert.match(g.prompt(), /haiku: anthropic\/claude-haiku-5-5 off/);
			assert.doesNotMatch(g.prompt(), /Temporary rule/);
			blocked(g.call("agent", { model: "anthropic/claude-opus-5-5", thinking: "high" }), /is not an allowed pair/);
		}
	});
	it("reads the clock on every call without reload", () => {
		let now = BEFORE;
		const handlers = new Map<string, Handler>();
		createCoordinatorGuard({ root: WT, now: () => now })({ on: (n: string, h: Handler) => void handlers.set(n, h) } as never);
		const ctx = { cwd: WT, sessionManager: { getEntries: () => [] } };
		for (const [model, thinking] of Object.values(RULES.agentModels).flat().filter(([m]) => m.startsWith("anthropic/"))) {
			for (const action of ["start", "restart"]) {
				const call = () => handlers.get("tool_call")!({ toolName: "agent", input: { action, model, thinking } }, ctx);
				now = BEFORE;
				assert.equal(call()?.block, true);
				now = UNTIL;
				assert.equal(call(), undefined);
			}
		}
	});
	it("an absent override preserves the normal table at any time", () => {
		setRules({ agentModels: RULES.agentModels });
		try {
			assert.equal(parseRules(readFileSync(PROCESS, "utf8")).temporaryGptOnly, undefined);
			const g = load([], BEFORE);
			for (const [model, thinking] of Object.values(RULES.agentModels).flat()) passed(g.call("agent", { model, thinking }));
			assert.doesNotMatch(g.prompt(), /Temporary rule/);
		} finally { setRules(RULES); }
	});
	it("a malformed deadline blocks GPT too, even after intended expiry", () => {
		setRules({ ...RULES, temporaryGptOnly: { until: "soon" } });
		try {
			const g = load([], UNTIL + 1);
			for (const action of ["start", "restart"]) {
				blocked(g.call("agent", { action, model: "openai-codex/gpt-6.1-sol", thinking: "low", title: "Арбитр замера" }), /until must be a UTC time/);
			}
		} finally { setRules(RULES); }
	});
});

describe("coordinator-guard: rules are read fresh and fail closed", () => {
	it("a changed block takes effect on the next call without reload", () => {
		const g = load();
		const pair = { action: "start", model: "fixture/custom", thinking: "high", task: "x" };
		blocked(g.call("agent", { ...pair }), /not an allowed pair/);
		setRules({ ...RULES, agentModels: { ...RULES.agentModels, extra: [["fixture/custom", "high"]] } });
		try {
			passed(g.call("agent", { ...pair }));
			assert.match(g.prompt(), /extra: fixture\/custom high/);
		} finally {
			setRules(RULES);
		}
		blocked(g.call("agent", { ...pair }), /not an allowed pair/);
	});
	const broken: [string, string, RegExp][] = [
		["missing block", "# Development process\n\nno rules\n", /no ```json coordinator-rules block found/],
		["two blocks", processMd(RULES) + processMd(RULES), /2 coordinator-rules blocks found/],
		["bad JSON", processMd("{ agentModels: "), /not valid JSON/],
		["no classes", processMd({ agentModels: {} }), /no classes/],
		["empty class", processMd({ agentModels: { simple: [] } }), /non-empty array/],
		["bad pair", processMd({ agentModels: { simple: [["anthropic/claude-sonnet-5-5"]] } }), /must be \[model, thinking\]/],
		["model without provider", processMd({ agentModels: { simple: [["sonnet", "high"]] } }), /provider\/id/],
		["bad thinking", processMd({ agentModels: { simple: [["a/b", "ultra"]] } }), /thinking must be one of/],
		["missing agentModels", processMd({ temporaryGptOnly: OPTIONAL_RULES.temporaryGptOnly }), /agentModels must be/],
		["null restriction", processMd({ ...RULES, temporaryGptOnly: null }), /temporaryGptOnly must be an object/],
		["array restriction", processMd({ ...RULES, temporaryGptOnly: [] }), /temporaryGptOnly must be an object/],
		["missing until", processMd({ ...RULES, temporaryGptOnly: {} }), /until must be a UTC time/],
		["until without Z", processMd({ ...RULES, temporaryGptOnly: { until: "2026-10-28T16:00:00" } }), /until must be a UTC time/],
		["until with offset", processMd({ ...RULES, temporaryGptOnly: { until: "2026-10-28T16:00:00+03:00" } }), /until must be a UTC time/],
		["until a number", processMd({ ...RULES, temporaryGptOnly: { until: 1793203200000 } }), /until must be a UTC time/],
		["impossible until", processMd({ ...RULES, temporaryGptOnly: { until: "2026-02-30T16:00:00Z" } }), /until is not a real date/],
	];
	for (const [label, text, error] of broken) {
		it(`${label}: blocks agent starts, shows the error in the prompt and status`, () => {
			writeFileSync(PROCESS, text);
			try {
				const g = load();
				blocked(g.call("agent", { action: "start", model: "anthropic/claude-opus-5-5", thinking: "medium", task: "x" }), error);
				blocked(g.call("agent", { action: "start", model: "anthropic/claude-opus-5-5", thinking: "medium", task: "x" }), /coordinator-rules in .*PROCESS\.md is unreadable/);
				passed(g.call("agent", { action: "wait", ids: ["agent#1"] }));
				const section = g.prompt();
				assert.match(section, /ERROR: the coordinator-rules block in .* is unreadable/);
				assert.match(section, error);
				g.start();
				assert.equal(g.status["coordinator-guard"], "coordinator-guard: rules unreadable");
			} finally {
				setRules(RULES);
			}
		});
	}
	it("a missing PROCESS.md blocks too", () => {
		rmSync(PROCESS);
		try {
			const g = load();
			blocked(g.call("agent", { action: "start", model: "anthropic/claude-opus-5-5", thinking: "medium", task: "x" }), /unreadable: ENOENT/);
		} finally {
			setRules(RULES);
		}
	});
});

describe("coordinator-guard: owner quotes", () => {
	const owner = [user("Сложная работа опус медиум, простая работа сонет хай.\nИ ещё одно:   всё по-английски."), user("Он сказал «да» и ушёл... потом вернулся"), { type: "message", message: { role: "assistant", content: [{ type: "text", text: "агент говорит" }] } }];
	const g = load(owner);
	const ok = { action: "start", model: "openai-codex/gpt-6.1-sol", thinking: "low" };
	it("passes verbatim quotes, whitespace-normalised, across messages and lines", () => {
		passed(g.call("agent", { ...ok, task: "Owner: «Сложная работа опус медиум, простая работа сонет хай.» and «И ещё одно: всё\nпо-английски.»" }));
		passed(g.call("agent", { ...ok, task: "no quotes at all" }));
		passed(g.call("agent", { ...ok, task: "«медиум, простая»" }), "a part of a sentence is fine when contiguous");
	});
	it("passes an owner's own literal ellipsis and balanced nested guillemets", () => {
		passed(g.call("agent", { ...ok, task: "«ушёл... потом вернулся»" }));
		passed(g.call("agent", { ...ok, task: "«Он сказал «да» и ушёл»" }));
	});
	const bad: [string, string][] = [
		["paraphrase", "«сложная работу опус медиум»"],
		["cut with ellipsis", "«Сложная работа... сонет хай»"],
		["unicode ellipsis", "«Сложная работа…»"],
		["assistant words", "«агент говорит»"],
		["empty", "«»"],
		["unclosed", "«Сложная работа"],
		["nested", "«Сложная «работа» опус»"],
	];
	for (const [label, text] of bad) {
		for (const field of ["task", "role", "system"]) {
			it(`blocks ${label} in ${field} on start, restart and send`, () => {
				blocked(g.call("agent", { ...ok, task: "x", [field]: text }), new RegExp(`quote in ${field} is not the owner's exact words`));
				blocked(g.call("agent", { action: "restart", id: "agent#1", ...ok, [field]: text }), /not the owner's exact words/);
				if (field === "task") blocked(g.call("agent", { action: "send", id: "agent#1", task: text }), /not the owner's exact words/);
			});
		}
	}
	it("with no owner messages every quote fails", () => {
		blocked(load([]).call("agent", { ...ok, task: "«Сложная работа»" }), /not the owner's exact words/);
	});
});

describe("coordinator-guard: edit and write paths", () => {
	const g = load();
	const inside = [
		["this worktree, relative", "PROCESS.md"],
		["this worktree, new nested file", "notes/new/deep.md"],
		["main checkout, absolute", join(MAIN, "README.md")],
		["main checkout via ..", "../../my-pi/README.md"],
		["main checkout root itself", MAIN],
		["sibling worktrees folder", join(TMP, "my-pi-worktrees", "other", "x.ts")],
		["registered worktree elsewhere", join(WT2, "a.ts")],
		["evidence escaping with ..", join(EVIDENCE, "..", "my-pi", "x.md")],
		["symlink into main", join(EVIDENCE, "to-main", "README.md")],
		...(dangling ? [["dangling symlink into main", join(EVIDENCE, "dangling")]] : []),
		["@ prefix", `@${join(MAIN, "x.md")}`],
		["file URL", pathToFileURL(join(MAIN, "x.md")).href],
		...(process.platform === "darwin" || process.platform === "win32" ? [["case variant", join(TMP, "MY-PI", "x.md")]] : []),
	];
	const outside = [
		["evidence", join(EVIDENCE, "notes.md")],
		["evidence via .. from main", join(MAIN, "..", "my-pi-evidence", "n.md")],
		["os tmp", join(tmpdir(), "coordinator-guard-scratch.txt")],
		["prefix sibling, not inside", join(TMP, "my-pi-other", "x.md")],
		["relative escape to evidence", relative(WT, join(EVIDENCE, "r.md"))],
	];
	for (const [label, path] of inside) {
		it(`blocks ${label} in every edit and write form`, () => {
			const reason = /Main does not edit repo files/;
			blocked(g.call("write", { path, content: "x" }), reason);
			blocked(g.call("write", { files: [{ path: join(EVIDENCE, "ok.md"), content: "a" }, { path, content: "b" }] }), reason);
			blocked(g.call("edit", { path, edits: [{ oldText: "a", newText: "b" }] }), reason);
			blocked(g.call("edit", { path: join(EVIDENCE, "ok.md"), edits: [{ oldText: "a", newText: "b" }, { path, oldText: "c", newText: "d" }] }), reason);
			blocked(g.call("edit", { path, edits: [{ path: join(EVIDENCE, "ok.md"), oldText: "a", newText: "b" }] }), reason);
		});
	}
	for (const [label, path] of outside) {
		it(`allows ${label}`, () => {
			passed(g.call("write", { path, content: "x" }));
			passed(g.call("write", { files: [{ path, content: "x" }, { path: join(EVIDENCE, "two.md"), content: "y" }] }));
			passed(g.call("edit", { path, edits: [{ oldText: "a", newText: "b" }] }));
			passed(g.call("edit", { edits: [{ path, oldText: "a", newText: "b" }] }));
		});
	}
	it("blocks a call without a readable path", () => {
		blocked(g.call("write", { content: "x" }), /without a readable path/);
		blocked(g.call("edit", { edits: [{ path: "", oldText: "a", newText: "b" }] }), /without a readable path/);
	});
	it("main checkout as root protects worktrees too", () => {
		const handlers: Handler[] = [];
		createCoordinatorGuard({ root: MAIN, processFile: PROCESS })({ on: (n: string, h: Handler) => void (n === "tool_call" && handlers.push(h)) } as never);
		const ctx = { cwd: MAIN, sessionManager: { getEntries: () => [] } };
		for (const path of [join(WT, "a"), join(WT2, "b"), "c.md", join(TMP, "my-pi-worktrees", "new", "d")]) {
			assert.equal(handlers[0]({ toolName: "write", input: { path, content: "" } }, ctx)?.block, true, path);
		}
		assert.equal(handlers[0]({ toolName: "write", input: { path: join(EVIDENCE, "e"), content: "" } }, ctx), undefined);
	});
	it("other tools are not touched", () => {
		passed(g.call("read", { path: join(MAIN, "README.md") }));
		passed(g.call("bash", { command: "echo hi" }));
		passed(g.call("job", { action: "status" }));
	});
});

describe("coordinator-guard: prompt reinjection", () => {
	it("adds the generated section on every before_agent_start", () => {
		const g = load();
		const first = g.prompt();
		assert.match(first, /binds Main, the top-level coordinator session/);
		assert.match(first, /simple: openai-codex\/gpt-6\.1-sol low; complex: openai-codex\/gpt-6\.1-sol medium; hardest: openai-codex\/gpt-6\.1-sol high; haiku: anthropic\/claude-haiku-5-5 off, .*anthropic\/claude-haiku-5-5 max/);
		assert.doesNotMatch(first, /explore|review tool/);
		assert.match(first, /When the owner asks Main to do such work personally \(for example "ты сам" or "you do it"\), Main objects and proposes a subagent for it; only an explicit owner override lets Main do that work itself/);
		assert.match(first, /Main never edits or writes files in the checkout or its worktrees \(edit and write there are blocked\)/);
		assert.doesNotMatch(first, /Temporary rule|claude-sonnet|claude-opus/, "permanent policy has no temporary override or forbidden model");
		assert.match(first, /one exact contiguous span of one owner message: no inserted omissions, cuts or paraphrase; only Unicode NFC and whitespace runs are normalised/);
		assert.doesNotMatch(first, /copied whole/);
		assert.equal(g.prompt(), first, "a fresh run gets the same section again");
		g.start();
		assert.equal(g.status["coordinator-guard"], "coordinator-guard on");
	});
});

describe("coordinator-guard: placement", () => {
	it("loads the new executor pairs on the next tool call and turn without reloading the guard", () => {
		const g = load();
		passed(g.call("agent", { action: "start", model: "openai-codex/gpt-6.1-sol", thinking: "high" }));
		blocked(g.call("agent", { action: "start", model: "kimi-coding/k3.1-pro", thinking: "low" }), /not an allowed pair/);
		setRules(parseRules(readFileSync(join(ROOT, "PROCESS.md"), "utf8")));
		try {
			for (const action of ["start", "restart"]) {
				passed(g.call("agent", { action, model: "kimi-coding/k3.1-pro", thinking: "low" }));
				passed(g.call("agent", { action, model: "kimi-coding/k3.1-pro", thinking: "high" }));
				passed(g.call("agent", { action, model: "openai-codex/gpt-6.1-sol", thinking: "medium" }));
				blocked(g.call("agent", { action, model: "openai-codex/gpt-6.1-sol", thinking: "high" }), /not an allowed pair/);
			}
			assert.match(g.prompt(), /simple: kimi-coding\/k3\.1-pro low, openai-codex\/gpt-6\.1-sol low; complex: kimi-coding\/k3\.1-pro low, openai-codex\/gpt-6\.1-sol low; hardest: kimi-coding\/k3\.1-pro high, openai-codex\/gpt-6\.1-sol medium/);
			assert.doesNotMatch(g.prompt(), /gpt-6\.1-sol high/);
		} finally { setRules(RULES); }
	});
	it("derives its root from its own file and imports nothing from extensions/", () => {
		assert.equal(ROOT, join(import.meta.dirname, ".."));
		const dir = join(ROOT, ".pi", "extensions", "coordinator-guard");
		for (const file of ["index.ts", "paths.ts", "rules.ts"]) {
			const text = readFileSync(join(dir, file), "utf8");
			for (const m of text.matchAll(/from\s+["']([^"']+)["']/g)) {
				assert.ok(!/(^|\/)extensions\//.test(m[1]) || m[1].startsWith("@earendil-works/"), `${file} imports ${m[1]}`);
			}
		}
	});
	it("the real PROCESS.md block parses with the guard's parser", () => {
		const rules = parseRules(readFileSync(join(ROOT, "PROCESS.md"), "utf8"));
		assert.deepEqual(rules.agentModels, {
			simple: [["kimi-coding/k3.1-pro", "low"], ["openai-codex/gpt-6.1-sol", "low"]],
			complex: [["kimi-coding/k3.1-pro", "low"], ["openai-codex/gpt-6.1-sol", "low"]],
			hardest: [["kimi-coding/k3.1-pro", "high"], ["openai-codex/gpt-6.1-sol", "medium"]],
		});
		assert.equal(rules.temporaryGptOnly, undefined);
		for (const now of [Date.parse("2026-10-01T00:00:00Z"), Date.parse("2026-10-28T16:00:00Z"), UNTIL + 1]) {
			setRules({ agentModels: rules.agentModels });
			const g = load([], now);
			for (const action of ["start", "restart"]) {
				for (const [model, thinking] of Object.values(rules.agentModels).flat()) passed(g.call("agent", { action, model, thinking }));
				for (const model of ["anthropic/claude-haiku-5-5", "anthropic/claude-sonnet-5-5", "anthropic/claude-opus-5-5"]) {
					blocked(g.call("agent", { action, model, thinking: "medium", title: "Арбитр замера" }), /not an allowed pair/);
				}
				const allowed = new Set(Object.values(rules.agentModels).flat().map(([model, thinking]) => `${model} ${thinking}`));
				for (const model of ["kimi-coding/k3.1-pro", "openai-codex/gpt-6.1-sol", "kimi-coding/k3.1-pro-highspeed",
					"kimi-coding/kimi-for-coding", "anthropic/claude-haiku-5-5", "anthropic/claude-sonnet-5-5", "anthropic/claude-opus-5-5"]) {
					for (const thinking of THINKING) {
						const call = g.call("agent", { action, model, thinking });
						if (allowed.has(`${model} ${thinking}`)) passed(call);
						else blocked(call, /not an allowed pair/);
					}
				}
				for (const [agent_type, thinking] of [["spotty", "low"], ["bossy", "medium"], ["code-reviewer", "low"], ["test-reviewer", "low"], ["requirements-test-reviewer", "low"]]) {
					passed(g.call("agent", { action, agent_type, model: "openai-codex/gpt-6.1-sol", thinking, task: "review" }));
				}
			}
			assert.doesNotMatch(g.prompt(), /Temporary rule|claude-sonnet|claude-opus/);
		}
		setRules(RULES);
	});
});
});
