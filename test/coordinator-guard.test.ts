// Unit tests of the repo-local dev guard `.pi/extensions/coordinator-guard` with a fake pi and ctx.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { after, describe, it } from "node:test";
import { pathToFileURL } from "node:url";
import { childInstruction, createCoordinatorGuard, ROOT } from "../.pi/extensions/coordinator-guard/index.ts";
import { parseRules } from "../.pi/extensions/coordinator-guard/rules.ts";

describe("coordinator-guard local development tooling", { skip: process.platform !== "darwin" && "Local development tooling is supported only on the owner's macOS laptop" }, () => {
const RULES = {
	workerModels: {
		simple: [["anthropic/claude-sonnet-5-5", "medium"], ["openai-codex/gpt-6.1-sol", "low"]],
		complex: [["anthropic/claude-sonnet-5-5", "high"], ["openai-codex/gpt-6.1-sol", "medium"]],
		hardest: [["anthropic/claude-opus-5-5", "medium"], ["openai-codex/gpt-6.1-sol", "high"]],
	},
	fixedWorkers: "block",
	temporaryOpusRestriction: { until: "2026-10-28T16:00:00Z", arbiterTitlePrefix: "Арбитр замера" },
};
// Clocks around the restriction; every test outside the restriction block runs at the exact expiry, the normal table.
const UNTIL = Date.parse(RULES.temporaryOpusRestriction.until);
const BEFORE = UNTIL - 1;
const processMd = (json: unknown) => `# Development process\n\n## Worker models\n\n\`\`\`json coordinator-rules\n${typeof json === "string" ? json : JSON.stringify(json, null, 2)}\n\`\`\`\n\nMore prose.\n`;

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
	for (const [model, thinking] of Object.values(RULES.workerModels).flat()) {
		it(`allows ${model} ${thinking} and appends the child instruction`, () => {
			const r = g.call("agent", { action: "start", model, thinking, task: "do it" });
			passed(r);
			assert.equal(r.input.task, `do it\n\n${childInstruction(parseRules(processMd(RULES)), UNTIL)}`);
		});
	}
	const denied: [string, string][] = [
		["anthropic/claude-opus-5-5", "high"], ["anthropic/claude-opus-5-5", "low"], ["openai-codex/gpt-6.1-sol", "xhigh"],
		["anthropic/claude-sonnet-5-5", "low"], ["claude-opus-5-5", "medium"], ["anthropic/claude-haiku-5-5", "low"],
	];
	for (const [model, thinking] of denied) {
		it(`blocks ${model} ${thinking} on start and restart`, () => {
			blocked(g.call("agent", { action: "start", model, thinking, task: "x" }), /is not an allowed pair; allowed: simple: .*PROCESS\.md#worker-models/);
			blocked(g.call("agent", { action: "restart", id: "agent#1", model, thinking }), /is not an allowed pair/);
		});
	}
	it("requires explicit model and thinking, also with missing action and on restart", () => {
		blocked(g.call("agent", { task: "x" }), /give model and thinking explicitly on agent start/);
		blocked(g.call("agent", { action: "start", model: "anthropic/claude-opus-5-5", task: "x" }), /explicitly/);
		blocked(g.call("agent", { action: "start", thinking: "medium", task: "x" }), /explicitly/);
		blocked(g.call("agent", { action: "restart", id: "agent#1" }), /explicitly on agent restart/);
		passed(g.call("agent", { model: "anthropic/claude-opus-5-5", thinking: "medium", task: "x" }));
	});
	it("restart without a task passes unchanged", () => {
		const r = g.call("agent", { action: "restart", id: "agent#1", model: "openai-codex/gpt-6.1-sol", thinking: "low" });
		passed(r);
		assert.equal(r.input.task, undefined);
	});
	it("blocks every explore start, even on an allowed pair", () => {
		blocked(g.call("agent", { action: "start", explore: "quick", task: "find x" }), /never starts explore/);
		blocked(g.call("agent", { action: "start", explore: "medium", model: "anthropic/claude-opus-5-5", thinking: "medium", task: "x" }), /never starts explore/);
		blocked(g.call("agent", { action: "restart", id: "agent#2", explore: "quick" }), /never starts explore/);
	});
	it("leaves management actions alone", () => {
		for (const action of ["wait", "status", "interrupt", "stop"]) passed(g.call("agent", { action, id: "agent#1", ids: ["agent#1"] }));
		passed(g.call("agent", { action: "send", id: "agent#1", task: "more" }));
	});
	it("the child instruction keeps fixed workers, explore and review open for children", () => {
		const line = childInstruction(parseRules(processMd(RULES)), UNTIL);
		assert.match(line, /ordinary `agent` subagent, give model and thinking explicitly/);
		assert.match(line, /simple: anthropic\/claude-sonnet-5-5 medium, openai-codex\/gpt-6\.1-sol low; complex: .*; hardest: anthropic\/claude-opus-5-5 medium, openai-codex\/gpt-6\.1-sol high/);
		assert.match(line, /You may use code_writer, shell_runner, explore and review yourself/);
		assert.doesNotMatch(line, /«|»/);
	});
});

describe("coordinator-guard: temporary Opus restriction", () => {
	const OPUS = "anthropic/claude-opus-5-5";
	const opus = (extra: Record<string, unknown> = {}) => ({ action: "start", model: OPUS, thinking: "medium", task: "x", ...extra });
	const restricted = load([], BEFORE);

	it("refuses ordinary Opus on start and restart, one millisecond before expiry", () => {
		blocked(restricted.call("agent", opus()), /anthropic\/claude-opus-5-5 medium is not an allowed pair; allowed: .*Temporary rule until 2026-10-28T16:00:00Z/);
		blocked(restricted.call("agent", { action: "restart", id: "agent#1", model: OPUS, thinking: "medium" }), /Temporary rule until/);
		blocked(restricted.call("agent", opus({ title: "Обычная задача" })), /is not an allowed pair/);
		blocked(restricted.call("agent", opus({ title: "арбитр замера" })), /is not an allowed pair/, "the prefix is case-sensitive");
		blocked(restricted.call("agent", opus({ title: " Арбитр замера" })), /is not an allowed pair/, "the title must start with the prefix");
	});
	it("hides Opus from the allowed list in reasons", () => {
		const r = restricted.call("agent", opus({ model: "anthropic/claude-haiku-5-5" }));
		blocked(r, /allowed: simple: .*; complex: .*; hardest: openai-codex\/gpt-6\.1-sol high \(/);
		assert.doesNotMatch(r.result.reason.split("Temporary rule")[0], /claude-opus-5-5 medium/);
	});
	it("lets a title with the arbiter prefix use the normal Opus pair only", () => {
		for (const title of ["Арбитр замера", "Арбитр замера 3: reviewer A"]) {
			const r = restricted.call("agent", opus({ title }));
			passed(r);
			assert.match(r.input.task as string, /Temporary rule until 2026-10-28T16:00:00Z/);
			passed(restricted.call("agent", { action: "restart", id: "agent#1", model: OPUS, thinking: "medium", title }));
		}
		for (const thinking of ["high", "low", "xhigh", "max", "off"]) {
			blocked(restricted.call("agent", opus({ title: "Арбитр замера", thinking })), /is not an allowed pair/, `${thinking} is no new level`);
		}
		blocked(restricted.call("agent", opus({ title: "Арбитр замера", model: "anthropic/claude-haiku-5-5" })), /is not an allowed pair/);
	});
	it("allows Sonnet and Sol as before, with or without a title", () => {
		for (const [model, thinking] of Object.values(RULES.workerModels).flat().filter(([m]) => m !== OPUS)) {
			passed(restricted.call("agent", { action: "start", model, thinking, task: "x" }));
			passed(restricted.call("agent", { action: "start", model, thinking, task: "x", title: "Арбитр замера" }));
		}
	});
	it("the prompt and the child line state the rule, the expiry and the narrow exception", () => {
		const prompt = restricted.prompt();
		const line = childInstruction(parseRules(processMd(RULES)), BEFORE);
		for (const text of [prompt, line]) {
			assert.match(text, /Temporary rule until 2026-10-28T16:00:00Z: anthropic\/claude-opus-5-5 is not allowed\./);
			assert.match(text, /Only a start whose title begins with "Арбитр замера" \(the reviewer benchmark arbiter\) may use the normal allowed Opus pair \(anthropic\/claude-opus-5-5 medium\), with no other thinking level\./);
			assert.match(text, /After that time the normal table applies again\./);
			assert.match(text, /hardest: openai-codex\/gpt-6\.1-sol high/);
			assert.doesNotMatch(text, /hardest: anthropic\/claude-opus-5-5/);
			assert.doesNotMatch(text, /«|»/);
		}
		const sent = restricted.call("agent", { action: "start", model: "anthropic/claude-sonnet-5-5", thinking: "high", task: "x" });
		assert.match(sent.input.task as string, /Temporary rule until 2026-10-28T16:00:00Z/, "the line reaches nested starts");
	});
	it("at the exact expiry and after it the normal table is back", () => {
		for (const now of [UNTIL, UNTIL + 1, UNTIL + 86_400_000]) {
			const g = load([], now);
			const r = g.call("agent", opus());
			passed(r);
			assert.doesNotMatch(r.input.task as string, /Temporary rule/);
			passed(g.call("agent", opus({ title: "Арбитр замера" })));
			assert.match(g.prompt(), /hardest: anthropic\/claude-opus-5-5 medium, openai-codex\/gpt-6\.1-sol high/);
			assert.doesNotMatch(g.prompt(), /Temporary rule/);
			blocked(g.call("agent", opus({ thinking: "high" })), /is not an allowed pair/, "expiry adds no thinking level");
		}
	});
	it("the clock is read on every call, so expiry needs no reload", () => {
		let now = BEFORE;
		const handlers = new Map<string, Handler>();
		createCoordinatorGuard({ root: WT, now: () => now })({ on: (n: string, h: Handler) => void handlers.set(n, h) } as never);
		const ctx = { cwd: WT, sessionManager: { getEntries: () => [] } };
		const call = () => handlers.get("tool_call")!({ toolName: "agent", input: opus() }, ctx);
		assert.equal(call()?.block, true);
		now = UNTIL;
		assert.equal(call(), undefined);
	});
	it("an absent restriction key means no temporary restriction: the base table at any time", () => {
		writeFileSync(PROCESS, processMd({ workerModels: RULES.workerModels, fixedWorkers: "block" }));
		try {
			assert.equal(parseRules(readFileSync(PROCESS, "utf8")).temporaryOpusRestriction, undefined);
			const g = load([], BEFORE);
			passed(g.call("agent", opus()));
			assert.match(g.prompt(), /hardest: anthropic\/claude-opus-5-5 medium/);
			assert.doesNotMatch(g.prompt(), /Temporary rule/);
		} finally {
			setRules(RULES);
		}
	});
	it("a present but malformed restriction keeps everything blocked, also for the arbiter title", () => {
		writeFileSync(PROCESS, processMd({ ...RULES, temporaryOpusRestriction: { until: "soon", arbiterTitlePrefix: "Арбитр замера" } }));
		try {
			const g = load([], UNTIL + 1);
			blocked(g.call("agent", opus({ title: "Арбитр замера" })), /until must be a UTC time/);
			blocked(g.call("agent", { action: "start", model: "anthropic/claude-sonnet-5-5", thinking: "medium", task: "x" }), /unreadable/);
		} finally {
			setRules(RULES);
		}
	});
});

describe("coordinator-guard: fixed workers", () => {
	it("blocks every code_writer and shell_runner action under block", () => {
		const g = load();
		for (const tool of ["code_writer", "shell_runner"]) {
			for (const input of [{ task: "x" }, { action: "start", task: "x" }, { action: "restart", id: `${tool}#1` }, { action: "send", id: `${tool}#1`, task: "y" }, { action: "wait", ids: [`${tool}#1`] }, { action: "status", ids: [`${tool}#1`] }, { action: "stop", id: `${tool}#1` }]) {
				blocked(g.call(tool, input), new RegExp(`Main never uses ${tool} \\(fixedWorkers: block`));
			}
		}
	});
	it("allow lets them through, still quote-checked", () => {
		setRules({ ...RULES, fixedWorkers: "allow" });
		try {
			const g = load([user("сделай так")]);
			passed(g.call("code_writer", { task: "go" }));
			passed(g.call("shell_runner", { action: "wait", ids: ["shell_runner#1"] }));
			passed(g.call("code_writer", { task: "owner: «сделай так»" }));
			blocked(g.call("shell_runner", { action: "send", id: "shell_runner#1", task: "«сделай иначе»" }), /not the owner's exact words: «сделай иначе»/);
		} finally {
			setRules(RULES);
		}
	});
});

describe("coordinator-guard: rules are read fresh and fail closed", () => {
	it("a changed block takes effect on the next call without reload", () => {
		const g = load();
		const pair = { action: "start", model: "anthropic/claude-opus-5-5", thinking: "high", task: "x" };
		blocked(g.call("agent", { ...pair }), /not an allowed pair/);
		setRules({ ...RULES, workerModels: { ...RULES.workerModels, extra: [["anthropic/claude-opus-5-5", "high"]] } });
		try {
			passed(g.call("agent", { ...pair }));
			assert.match(g.prompt(), /extra: anthropic\/claude-opus-5-5 high/);
		} finally {
			setRules(RULES);
		}
		blocked(g.call("agent", { ...pair }), /not an allowed pair/);
	});
	const broken: [string, string, RegExp][] = [
		["missing block", "# Development process\n\nno rules\n", /no ```json coordinator-rules block found/],
		["two blocks", processMd(RULES) + processMd(RULES), /2 coordinator-rules blocks found/],
		["bad JSON", processMd("{ workerModels: "), /not valid JSON/],
		["no classes", processMd({ workerModels: {}, fixedWorkers: "block" }), /no classes/],
		["empty class", processMd({ workerModels: { simple: [] }, fixedWorkers: "block" }), /non-empty array/],
		["bad pair", processMd({ workerModels: { simple: [["anthropic/claude-sonnet-5-5"]] }, fixedWorkers: "block" }), /must be \[model, thinking\]/],
		["model without provider", processMd({ workerModels: { simple: [["sonnet", "high"]] }, fixedWorkers: "block" }), /provider\/id/],
		["bad thinking", processMd({ workerModels: { simple: [["a/b", "ultra"]] }, fixedWorkers: "block" }), /thinking must be one of/],
		["missing fixedWorkers", processMd({ workerModels: RULES.workerModels, temporaryOpusRestriction: RULES.temporaryOpusRestriction }), /fixedWorkers must be/],
		["null restriction", processMd({ ...RULES, temporaryOpusRestriction: null }), /temporaryOpusRestriction must be an object/],
		["array restriction", processMd({ ...RULES, temporaryOpusRestriction: [] }), /temporaryOpusRestriction must be an object/],
		["missing until", processMd({ ...RULES, temporaryOpusRestriction: { arbiterTitlePrefix: "Арбитр замера" } }), /until must be a UTC time/],
		["until without Z", processMd({ ...RULES, temporaryOpusRestriction: { until: "2026-10-28T16:00:00", arbiterTitlePrefix: "Арбитр замера" } }), /until must be a UTC time/],
		["until with offset", processMd({ ...RULES, temporaryOpusRestriction: { until: "2026-10-28T16:00:00+03:00", arbiterTitlePrefix: "Арбитр замера" } }), /until must be a UTC time/],
		["until a number", processMd({ ...RULES, temporaryOpusRestriction: { until: 1793203200000, arbiterTitlePrefix: "Арбитр замера" } }), /until must be a UTC time/],
		["impossible until", processMd({ ...RULES, temporaryOpusRestriction: { until: "2026-02-30T16:00:00Z", arbiterTitlePrefix: "Арбитр замера" } }), /until is not a real date/],
		["missing prefix", processMd({ ...RULES, temporaryOpusRestriction: { until: RULES.temporaryOpusRestriction.until } }), /arbiterTitlePrefix must be a non-empty string/],
		["blank prefix", processMd({ ...RULES, temporaryOpusRestriction: { until: RULES.temporaryOpusRestriction.until, arbiterTitlePrefix: "  " } }), /arbiterTitlePrefix must be a non-empty string/],
	];
	for (const [label, text, error] of broken) {
		it(`${label}: blocks agent starts and fixed workers, shows the error in the prompt and status`, () => {
			writeFileSync(PROCESS, text);
			try {
				const g = load();
				blocked(g.call("agent", { action: "start", model: "anthropic/claude-opus-5-5", thinking: "medium", task: "x" }), error);
				blocked(g.call("agent", { action: "start", model: "anthropic/claude-opus-5-5", thinking: "medium", task: "x" }), /coordinator-rules in .*PROCESS\.md is unreadable/);
				blocked(g.call("code_writer", { task: "x" }), error);
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
		passed(g.call("review", { level: "blind", task: "«not checked»" }));
	});
});

describe("coordinator-guard: prompt reinjection", () => {
	it("adds the generated section on every before_agent_start", () => {
		const g = load();
		const first = g.prompt();
		assert.match(first, /binds Main, the top-level coordinator session/);
		assert.match(first, /simple: anthropic\/claude-sonnet-5-5 medium, openai-codex\/gpt-6\.1-sol low; complex: anthropic\/claude-sonnet-5-5 high, openai-codex\/gpt-6\.1-sol medium; hardest: anthropic\/claude-opus-5-5 medium, openai-codex\/gpt-6\.1-sol high/);
		assert.match(first, /never uses code_writer or shell_runner and never starts an explore subagent/);
		assert.match(first, /Subagents Main starts may use them/);
		assert.match(first, /When the owner asks Main to do such work personally \(for example "ты сам" or "you do it"\), Main objects and proposes a subagent for it; only an explicit owner override lets Main do that work itself/);
		assert.match(first, /Main never edits or writes files in the checkout or its worktrees \(edit and write there are blocked\)/);
		assert.doesNotMatch(first, /Temporary rule/, "no temporary rule at the exact expiry");
		assert.match(first, /one exact contiguous span of one owner message: no inserted omissions, cuts or paraphrase; only Unicode NFC and whitespace runs are normalised/);
		assert.doesNotMatch(first, /copied whole/);
		assert.equal(g.prompt(), first, "a fresh run gets the same section again");
		g.start();
		assert.equal(g.status["coordinator-guard"], "coordinator-guard on");
	});
});

describe("coordinator-guard: placement", () => {
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
		assert.deepEqual(rules.workerModels, RULES.workerModels);
		assert.equal(rules.fixedWorkers, RULES.fixedWorkers);
		assert.deepEqual({ until: rules.temporaryOpusRestriction.until, arbiterTitlePrefix: rules.temporaryOpusRestriction.arbiterTitlePrefix }, RULES.temporaryOpusRestriction);
	});
});
});
