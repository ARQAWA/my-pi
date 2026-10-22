// Extension 5: the `review` tool. Each call starts a fresh reviewer session in this process on the model of
// its level, with REVIEWER.md as the prompt and a brief built from the user's own messages; the call returns at once
// and the verdict comes back later as a `[review#N]` message that the main model answers. Main may rebut a finding once
// with proof; the extension keeps each dispute in the session and the next fresh reviewer's answer on it is final.
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { StringEnum } from "@earendil-works/pi-ai";
import {
	createAgentSession,
	createFindToolDefinition,
	createGrepToolDefinition,
	DefaultResourceLoader,
	type ExtensionAPI,
	type ExtensionContext,
	getAgentDir,
	type ModelRuntime,
	type SessionEntry,
	SessionManager,
	SettingsManager,
	type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { blockedGit } from "./git-guard.ts";

/**
 * The one table of reviewers: for each model family of the main agent, the reviewer of each level. A reviewer of
 * the family's own table is used first; when its provider has no credentials, the other family's reviewer takes the
 * level. Changing a model or a thinking level is a one-line change here. The `gpt` row is the owner's choice
 * (DECISIONS.md, Review); the `claude` high slot is being re-measured and may change.
 */
export const LEVELS = {
	claude: {
		blind: { provider: "anthropic", model: "claude-haiku-5-5", thinking: "medium" },
		high: { provider: "anthropic", model: "claude-sonnet-5-5", thinking: "low" },
	},
	gpt: {
		blind: { provider: "openai-codex", model: "gpt-5.6-luna", thinking: "medium" },
		high: { provider: "openai-codex", model: "gpt-5.6-luna", thinking: "high" },
	},
} as const;
export type Family = keyof typeof LEVELS;
export type Level = keyof (typeof LEVELS)[Family];
export type Spec = (typeof LEVELS)[Family][Level];

/** The family of the main agent's model; undefined for a model of neither family (or no model). */
export function familyOf(model: { provider?: string; id?: string } | undefined): Family | undefined {
	const { provider = "", id = "" } = model ?? {};
	if (provider === "anthropic" || /^claude/i.test(id)) return "claude";
	if (provider === "openai" || provider === "openai-codex" || /^gpt-/i.test(id)) return "gpt";
	return undefined;
}

/** The reviewers to try for a level, in order: the main agent's family first, then the other family. */
export function candidates(level: Level, main: { provider?: string; id?: string } | undefined): Spec[] {
	const own = familyOf(main) ?? "claude";
	const other: Family = own === "claude" ? "gpt" : "claude";
	return [LEVELS[own][level], LEVELS[other][level]];
}

/** The tools of the reviewer, by name: read, bash, grep and find. grep and find go in through `reviewerTools` when no RQW-tools offer is made. */
export const REVIEWER_TOOLS = ["read", "bash", "grep", "find"];
export const TIMEOUT_MS = 30 * 60 * 1000;
export const MESSAGE_TYPE = "review";

export const REVIEWER = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "REVIEWER.md"), "utf8").replace(/\r\n/g, "\n").trimEnd();

export const DESCRIPTION =
	"Blind review by a separate model that works with you as one team for the user's agreement: " +
	"it checks the requested criterion, including checks beyond the agreement and exclusions, and gets the user's own messages verbatim. Use " +
	"it when the user asks for a review or a checked result. The call returns at once; the verdict arrives later as a " +
	"`[review#N]` message with what to do next. Keep working meanwhile. You may rebut a finding once, with proof; the " +
	"next reviewer's answer is final.";

/** What the main agent does next, appended to each verdict by its kind; the pair rules live here, not in the prompt. */
export const NEXT = {
	clean: "The check passed; run no further pass for confidence.",
	findings:
		"Your teammate's findings. Find each quote by searching for it. Fix each new finding exactly to its REQUIRED " +
		"OUTCOME and no further, unless you can prove the reviewer misunderstood: then rebut it once in `rebuttals` with " +
		"its id, an exact quote from a file or from the user's messages, that source, and why the finding is wrong. " +
		"A finding that demands what the agreement does not ask for, or changes a settled decision, is such a " +
		"misreading: rebut it with the quote of the agreement. Without such proof, fix it. " +
		"But a finding that rests on a value, rule or choice the user never gave is not yours to settle: put it to the " +
		"user and follow the user's decision; do not fix it with another choice of your own. " +
		"Fix all the others in one batch, then call `review` again with the same level, object and " +
		"criterion and your new rebuttals, until CLEAN. Earlier disputes go to the next reviewer by themselves; its " +
		"answer on each is final.",
	withdrawn: "Withdrawn after your rebuttal, nothing to do:",
	decided:
		"Upheld after your rebuttal on the user's decision, final: fix each to its REQUIRED OUTCOME and do not rebut it " +
		"again:",
	undecided:
		"Upheld after your rebuttal on a point the user has not decided, final: do not fix or rebut it; put each " +
		"dispute to the user with the finding and your rebuttal, and follow the user's decision:",
	incomplete:
		"The check is incomplete. Resolve UNCHECKED sources or retry malformed output; never claim the check passed.",
	failed:
		"The check has not passed, and no self-check replaces it. Call `review` again once on the unchanged object; if it " +
		"fails again, tell the user and wait.",
} as const;

type Kind = "clean" | "incomplete" | "findings" | "failed";
/**
 * The verdict of a reviewer reply: the reply from the first line that is exactly `FINDINGS:` when prose stands before
 * it, otherwise the reply unchanged (an exact `CLEAN`, a reply that starts with `FINDINGS:`, or malformed text).
 */
export function verdictOf(text: string): string {
	const trimmed = text.trim();
	if (trimmed.startsWith("FINDINGS:") || trimmed.startsWith("CLEAN")) return trimmed;
	const start = /^FINDINGS:[ \t]*\r?$/m.exec(trimmed);
	return start ? trimmed.slice(start.index) : trimmed;
}

/**
 * One structural check: a failed run is `failed`; exactly `CLEAN` is `clean`; a verdict whose header is an exact
 * `FINDINGS:` line followed by finding blocks that all have their four required fields filled is `findings`;
 * anything else (a bare or empty block, text after `FINDINGS:` on its header line, prose before `CLEAN`, any other
 * text) is `incomplete`, and resolves nothing.
 */
const kindOf = (verdict: string, failed: boolean): Kind =>
	failed ? "failed" : verdict.trim() === "CLEAN" ? "clean" : findingBlocks(verdict) ? "findings" : "incomplete";

/**
 * The delivered message: `[review#N]` first, the verdict verbatim, then the finding ids and dispute outcomes when
 * there are any, then the next step for its kind.
 */
export function verdictMessage(n: number, verdict: string, failed: boolean, notes = ""): string {
	return `[review#${n}] ${verdict}\n\n${notes ? `${notes}\n\n` : ""}${NEXT[kindOf(verdict, failed)]}`;
}

// Disputes. Each finding of a parsed `FINDINGS:` verdict gets a stable id `<review number>.<position>`, such as 3.2.
// Main may rebut a finding once; the rebuttal goes with the next review call, and every later brief carries the
// whole dispute. The first reviewer that saw it open answers it: a finding it leaves out is withdrawn, a finding it
// repeats with `DISPUTE: <id>` is upheld, finally, with RULING DECIDED (Main fixes) or UNDECIDED (the user decides).
// Everything is persisted as `review` custom entries, so the state is rebuilt from the session branch after a reload.

export type Ruling = "withdrawn" | "decided" | "undecided";
export type Rebuttal = { finding: string; quote: string; source: string; explanation: string };
export type Dispute = {
	id: string;
	/** The finding as the reviewer wrote it, without its `FINDING n` header. */
	text: string;
	rebuttal?: Rebuttal & { review: number };
	ruling?: { ruling: Ruling; review: number; answer?: string };
};

/** One finding block of a verdict, with the dispute fields the reviewer adds when it repeats a disputed finding. */
export type Block = { header: string; text: string; dispute?: string; ruling?: "decided" | "undecided"; answer?: string };

const FIELD = /^\s*(DISPUTE|REQUIREMENT|MISMATCH|EVIDENCE|REQUIRED OUTCOME|RULING|ANSWER):\s*(.*)$/;

/** The fields every finding must carry, each filled; DISPUTE, RULING and ANSWER only come with a repeated dispute. */
const REQUIRED = ["REQUIREMENT", "MISMATCH", "EVIDENCE", "REQUIRED OUTCOME"] as const;

/**
 * The finding blocks of a verdict that is `FINDINGS:` on a line of its own, then at least one `FINDING n` block with
 * all required fields filled, up to an `UNCHECKED:` section. Undefined for any other text: that is not a verdict of
 * findings and settles nothing.
 */
export function findingBlocks(verdict: string): Block[] | undefined {
	const lines = verdict.replace(/\r\n/g, "\n").trim().split("\n");
	if (!/^FINDINGS:[ \t]*$/.test(lines[0])) return undefined;
	const blocks: { header: string; lines: string[] }[] = [];
	for (const line of lines.slice(1)) {
		if (/^\s*UNCHECKED:/.test(line)) break;
		const header = /^\s*(FINDING\s+\d+)\s*:?\s*$/.exec(line);
		if (header) blocks.push({ header: header[1].replace(/\s+/, " "), lines: [] });
		else if (blocks.length > 0) blocks.at(-1)!.lines.push(line);
		else if (line.trim() !== "") return undefined;
	}
	if (blocks.length === 0) return undefined;
	const parsed = blocks.map(({ header, lines }) => {
		const fields = new Map<string, string[]>();
		let current: string[] | undefined;
		for (const line of lines) {
			const field = FIELD.exec(line);
			if (field && !fields.has(field[1])) fields.set(field[1], (current = [field[2]]));
			else if (field) current = undefined;
			else current?.push(line);
		}
		const value = (name: string) => fields.get(name)?.join("\n").trim() || undefined;
		const ruling = /^(UN)?DECIDED\b/i.exec(value("RULING") ?? "");
		return {
			complete: REQUIRED.every((name) => value(name)),
			header,
			text: lines.join("\n").trim(),
			dispute: value("DISPUTE")?.split(/\s/)[0].replace(/[.,;]$/, ""),
			ruling: ruling ? (ruling[1] ? "undecided" : "decided") : undefined,
			answer: value("ANSWER"),
		};
	});
	return parsed.every((b) => b.complete) ? parsed.map(({ complete: _complete, ...block }) => block) : undefined;
}

const isText = (value: unknown): value is string => typeof value === "string";
const RULINGS = new Set<unknown>(["withdrawn", "decided", "undecided"]);

/** Every finding of the branch by id, with its rebuttal and the reviewer's final answer, from the custom entries. */
export function disputes(entries: readonly SessionEntry[]): Map<string, Dispute> {
	const all = new Map<string, Dispute>();
	for (const entry of entries) {
		if (entry.type !== "custom" || entry.customType !== MESSAGE_TYPE) continue;
		const data = entry.data as { n?: unknown; findings?: unknown; rebuttals?: unknown; rulings?: unknown } | undefined;
		const review = data?.n;
		if (typeof review !== "number") continue;
		for (const f of Array.isArray(data?.findings) ? data.findings : []) {
			if (isText(f?.id) && isText(f?.text) && !all.has(f.id)) all.set(f.id, { id: f.id, text: f.text });
		}
		for (const r of Array.isArray(data?.rebuttals) ? data.rebuttals : []) {
			const d = all.get(r?.finding);
			if (d && !d.rebuttal && isText(r.quote) && isText(r.source) && isText(r.explanation))
				d.rebuttal = { finding: d.id, quote: r.quote, source: r.source, explanation: r.explanation, review };
		}
		for (const r of Array.isArray(data?.rulings) ? data.rulings : []) {
			const d = all.get(r?.finding);
			if (d?.rebuttal && !d.ruling && RULINGS.has(r.ruling))
				d.ruling = { ruling: r.ruling, review, ...(isText(r.answer) ? { answer: r.answer } : {}) };
		}
	}
	return all;
}

/** A rebutted finding without the reviewer's answer yet; it goes into every brief until a verdict answers it. */
const isOpen = (d: Dispute) => !!d.rebuttal && !d.ruling;

/** What a verdict of review `n` settles: new finding ids, rulings on the disputes its brief carried, and the notes. */
export function settle(n: number, verdict: string, failed: boolean, all: Map<string, Dispute>, carried: readonly string[]) {
	const findings: { id: string; text: string }[] = [];
	const rulings: { finding: string; ruling: Ruling; answer?: string }[] = [];
	const ids: string[] = [];
	const kind = kindOf(verdict, failed);
	const open = carried.filter((id) => { const d = all.get(id); return !!d && isOpen(d); });
	const blocks = kind === "findings" ? findingBlocks(verdict) : undefined;
	// Only an exact CLEAN or a parsed FINDINGS verdict answers disputes; failed, incomplete or malformed leave them open.
	if (kind === "clean" || (blocks && blocks.length > 0)) {
		const upheld = new Set<string>();
		(blocks ?? []).forEach((block, i) => {
			const known = block.dispute ? all.get(block.dispute) : undefined;
			if (known && !(known.ruling?.ruling === "withdrawn")) {
				ids.push(`${block.header} = ${known.id}`);
				if (open.includes(known.id) && !upheld.has(known.id)) {
					upheld.add(known.id);
					// No valid RULING: nothing shows an unambiguous user decision, so the user decides.
					rulings.push({ finding: known.id, ruling: block.ruling ?? "undecided", ...(block.answer ? { answer: block.answer } : {}) });
				}
				return;
			}
			const id = `${n}.${i + 1}`;
			findings.push({ id, text: block.text });
			ids.push(`${block.header} = ${id}`);
		});
		for (const id of open) if (!upheld.has(id)) rulings.push({ finding: id, ruling: "withdrawn" });
	}
	// Final rulings shown with this verdict: the new ones and earlier ones the reviewer repeated.
	const shown = new Map<string, Ruling>(rulings.map((r) => [r.finding, r.ruling]));
	for (const block of blocks ?? []) {
		const ruling = block.dispute ? all.get(block.dispute)?.ruling?.ruling : undefined;
		if (ruling && ruling !== "withdrawn" && !shown.has(block.dispute!)) shown.set(block.dispute!, ruling);
	}
	const notes: string[] = [];
	if (ids.length > 0) notes.push(`Finding ids: ${ids.join(", ")}.`);
	for (const ruling of ["withdrawn", "decided", "undecided"] as const) {
		const list = [...shown].filter(([, r]) => r === ruling).map(([id]) => id);
		if (list.length > 0) notes.push(`${NEXT[ruling]} ${list.join(", ")}.`);
	}
	return { findings, rulings, notes: notes.join("\n") };
}

const squash = (text: string) => text.replace(/\s+/g, " ").trim();

/** Whether `quote` stands in `text`, ignoring whitespace runs and one pair of surrounding quotation marks. */
function quoted(text: string, quote: string): boolean {
	const haystack = squash(text);
	const q = squash(quote);
	const bare = /^(["'`\u00ab\u201c])([\s\S]*)(["'`\u00bb\u201d])$/.exec(q);
	return q !== "" && (haystack.includes(q) || (!!bare && bare[2].trim() !== "" && haystack.includes(bare[2].trim())));
}

const USER_SOURCE = /^(the )?user('s)?( own)?( messages?)?$/i;

/** Why a finding cannot take a rebuttal now: unknown, or already withdrawn, upheld or rebutted; undefined when it can. */
function stateRefusal(id: string, d: Dispute | undefined): string | undefined {
	if (!d) return `no finding ${JSON.stringify(id)} in this session; use an id listed after a [review#N] verdict, such as 3.1.`;
	if (d.ruling?.ruling === "withdrawn") return `finding ${id} was already withdrawn in review#${d.ruling.review}; there is nothing to rebut.`;
	if (d.ruling?.ruling === "decided")
		return `finding ${id} was upheld in review#${d.ruling.review} on the user's decision, and that answer is final: fix it to its REQUIRED OUTCOME.`;
	if (d.ruling)
		return `finding ${id} was upheld in review#${d.ruling.review} on a point the user has not decided, and that answer is final: put the dispute to the user and follow the user's decision.`;
	if (d.rebuttal)
		return `finding ${id} was already rebutted with review#${d.rebuttal.review}; that dispute goes to the next review by itself and gets one final answer.`;
	return undefined;
}

/**
 * The state-only check of the rebuttals, synchronous so that the caller can run it and persist the accepted rebuttals
 * with no await between (a parallel call cannot slip in): every finding is known, not rebutted twice in the call, and
 * has no rebuttal or final answer yet.
 */
export function stateRefusals(rebuttals: readonly Rebuttal[], all: Map<string, Dispute>): string[] {
	const reasons: string[] = [];
	const seen = new Set<string>();
	for (const r of rebuttals) {
		const id = typeof r?.finding === "string" ? r.finding.trim() : "";
		const d = all.get(id);
		if (!d) reasons.push(stateRefusal(id, d)!);
		else if (seen.has(id)) reasons.push(`finding ${id} is rebutted twice in this call; a finding gets one rebuttal.`);
		else {
			seen.add(id);
			const reason = stateRefusal(id, d);
			if (reason) reasons.push(reason);
		}
	}
	return reasons;
}

/**
 * The reasons the rebuttals cannot go to the reviewer, empty when all can. A rebuttal needs a known finding that has
 * no rebuttal yet, a quote that stands in its source (the user's own messages or a file), and an explanation.
 */
export async function refusals(
	rebuttals: readonly Rebuttal[],
	all: Map<string, Dispute>,
	entries: readonly SessionEntry[],
	cwd: string,
): Promise<string[]> {
	const reasons: string[] = [];
	const seen = new Set<string>();
	for (const r of rebuttals) {
		const id = typeof r?.finding === "string" ? r.finding.trim() : "";
		const d = all.get(id);
		if (!d) {
			reasons.push(stateRefusal(id, d)!);
			continue;
		}
		if (seen.has(id)) {
			reasons.push(`finding ${id} is rebutted twice in this call; a finding gets one rebuttal.`);
			continue;
		}
		seen.add(id);
		const reason = stateRefusal(id, d);
		if (reason) reasons.push(reason);
		else if (![r.quote, r.source, r.explanation].every((v) => typeof v === "string" && v.trim() !== ""))
			reasons.push(`the rebuttal of ${id} has no proof: it needs a quote, its source and an explanation. Without proof, fix the finding.`);
		else {
			let text: string | undefined;
			// Only the user's own messages: a compaction or branch summary is Main's text, not the user's words.
			if (USER_SOURCE.test(r.source.trim())) text = userMessages(entries, false);
			else text = await readFile(resolve(cwd, r.source.trim()), "utf8").catch(() => undefined);
			if (text === undefined) reasons.push(`the source of the rebuttal of ${id}, ${JSON.stringify(r.source)}, is not a readable file; give a file path or "user".`);
			else if (!quoted(text, r.quote)) reasons.push(`the quote of the rebuttal of ${id} is not in ${JSON.stringify(r.source)}; quote it exactly, or fix the finding.`);
		}
	}
	return reasons;
}

/** The tool result of a call. */
export const startedText = (n: number) =>
	`review#${n} started. Keep working, but leave the reviewed files unchanged until its verdict.`;

const parameters = Type.Object({
	level: StringEnum(["blind", "high"] as const, { description: "blind by default; high when the user asks for it." }),
	object: Type.String({
		description:
			"Paths of the object and its sources, the diff as a file path, and the stage: pre-action or pre-completion.",
	}),
	criterion: Type.String({ description: "What this check confirms." }),
	agreement: Type.Optional(
		Type.String({ description: "Accepted proposals and decisions that are not in the user's own messages, verbatim." }),
	),
	rebuttals: Type.Optional(
		Type.Array(
			Type.Object({
				finding: Type.String({ description: "The finding id given after the verdict, such as 3.1." }),
				quote: Type.String({ description: "Exact text from the source that proves the reviewer misunderstood." }),
				source: Type.String({ description: "`user` for the user's messages, or the file path." }),
				explanation: Type.String({ description: "Why the finding is wrong, given this quote." }),
			}),
			{ description: "Findings you disprove, one rebuttal per finding ever; without proof, fix the finding instead." },
		),
	),
});

type Params = {
	level: Level;
	object: string;
	criterion: string;
	agreement?: string | null;
	rebuttals?: Rebuttal[] | null;
};

/**
 * Channel on `pi.events` where RQW-tools, when it is loaded, offers its tools for reviewers: a request `{ offer(factory) }`
 * gets a factory of fresh definitions. Nothing here imports RQW-tools; the same handshake as RQW-agent.
 */
const SUBAGENT_TOOLS = "rqw-tools:subagent-tools";
type ToolsFactory = (cwd: string, settings: () => unknown) => ToolDefinition[];

/** The offered RQW-tools definitions of the reviewer, filtered to its four names; undefined when none is offered. */
function offeredTools(pi: ExtensionAPI, cwd: string): ToolDefinition[] | undefined {
	let factory: ToolsFactory | undefined;
	// Pi's event bus calls every handler synchronously inside emit, so an offer is in place when emit returns.
	pi.events.emit(SUBAGENT_TOOLS, {
		offer: (f: ToolsFactory) => {
			factory = f;
		},
	});
	return factory?.(cwd, () => pi.getSettings()).filter((d) => REVIEWER_TOOLS.includes(d.name)).map(normalizeSearchTool);
}

function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	const parts: string[] = [];
	for (const c of content) {
		if (!c || typeof c !== "object" || !("type" in c)) continue;
		if (c.type === "text" && "text" in c && typeof c.text === "string") parts.push(c.text);
		else if (c.type === "image") parts.push("[image]");
	}
	return parts.join("\n");
}

/**
 * The user's own messages of the branch, verbatim and in order. With `summaries` (the brief) compaction and branch
 * summaries follow in place, labeled as not the user's words; without it (proof of a rebuttal) they are left out.
 */
export function userMessages(entries: readonly SessionEntry[], summaries = true): string {
	const parts: string[] = [];
	let n = 0;
	for (const entry of entries) {
		if (entry.type === "message" && entry.message.role === "user") {
			parts.push(`<message n="${++n}">\n${textOf(entry.message.content)}\n</message>`);
		} else if (summaries && entry.type === "compaction") {
			parts.push(`<compaction_summary note="written by the main model when it compacted the context, not the user's words">\n${entry.summary}\n</compaction_summary>`);
		} else if (summaries && entry.type === "branch_summary") {
			parts.push(`<branch_summary note="written by the main model for an abandoned branch, not the user's words">\n${entry.summary}\n</branch_summary>`);
		}
	}
	return parts.join("\n\n");
}

// Strict tool mode fills every optional field, so an empty or null value means "not given".
const given = (value: string | null | undefined): value is string => typeof value === "string" && value.trim() !== "";

/** One dispute for the brief: the finding as written, Main's rebuttal and, once answered, the reviewer's answer. */
function disputeText(d: Dispute & { rebuttal: Rebuttal }): string {
	const status = !d.ruling
		? 'status="open"'
		: d.ruling.ruling === "withdrawn"
			? 'status="withdrawn"'
			: `status="upheld" ruling="${d.ruling.ruling.toUpperCase()}"`;
	const parts = [
		`<dispute finding="${d.id}" ${status}>`,
		`<finding>\n${d.text}\n</finding>`,
		`<rebuttal>\nQUOTE: ${d.rebuttal.quote}\nSOURCE: ${d.rebuttal.source}\nEXPLANATION: ${d.rebuttal.explanation}\n</rebuttal>`,
	];
	if (d.ruling?.answer) parts.push(`<answer>\n${d.ruling.answer}\n</answer>`);
	parts.push("</dispute>");
	return parts.join("\n");
}

/** The brief; `all` holds the disputes of the branch, each passed whole, open ones for this reviewer to answer. */
export function buildBrief(entries: readonly SessionEntry[], params: Params, all: Map<string, Dispute> = disputes(entries)): string {
	const sections = [`<user_messages>\n${userMessages(entries)}\n</user_messages>`];
	if (given(params.agreement)) sections.push(`<agreement>\n${params.agreement}\n</agreement>`);
	sections.push(`<object>\n${params.object}\n</object>`, `<criterion>\n${params.criterion}\n</criterion>`);
	const disputed = [...all.values()].filter((d): d is Dispute & { rebuttal: Rebuttal & { review: number } } => !!d.rebuttal);
	if (disputed.length > 0) sections.push(`<disputes>\n${disputed.map(disputeText).join("\n\n")}\n</disputes>`);
	return sections.join("\n\n");
}

const EMPTY = new Set(["", "null", "undefined"]);

/**
 * Optional arguments sent as the string "null", "undefined" or blank count as not given. Stock grep would pass
 * `--glob null` to rg and answer "No matches found", a silent false negative for the reviewer.
 */
export function dropEmptyOptional(input: unknown, required: readonly string[]): unknown {
	if (!input || typeof input !== "object" || Array.isArray(input)) return input;
	const entries = Object.entries(input);
	const kept = entries.filter(([key, value]) => required.includes(key) || typeof value !== "string" || !EMPTY.has(value.trim()));
	return kept.length === entries.length ? input : Object.fromEntries(kept);
}

/** grep and find get `dropEmptyOptional` before Pi validates the arguments; any other definition is returned unchanged. */
function normalizeSearchTool(definition: ToolDefinition): ToolDefinition {
	if (definition.name !== "grep" && definition.name !== "find") return definition;
	const required: string[] = (definition.parameters as { required?: string[] }).required ?? [];
	const prepare = definition.prepareArguments;
	return {
		...definition,
		prepareArguments: (input: unknown) => {
			const args = dropEmptyOptional(input, required);
			return prepare ? prepare(args) : args;
		},
	} as ToolDefinition;
}

/** Stock grep and find with `normalizeSearchTool`; execute stays stock. */
export function reviewerTools(cwd: string): ToolDefinition[] {
	return [createGrepToolDefinition(cwd), createFindToolDefinition(cwd)].map((stock) => normalizeSearchTool(stock as unknown as ToolDefinition));
}

const SHUTDOWN = "shutdown";
const TIMEOUT = "timeout";

/** Stop waiting even when an SDK preflight ignores cancellation; observe its eventual rejection too. */
async function untilAborted<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
	const aborted = Promise.withResolvers<never>();
	const stop = () => aborted.reject(new Error("aborted"));
	signal.addEventListener("abort", stop, { once: true });
	if (signal.aborted) stop();
	try {
		return await Promise.race([pending, aborted.promise]);
	} finally {
		signal.removeEventListener("abort", stop);
	}
}

/**
 * The first reviewer of the level that can start: the main agent's family first, then the other family when the
 * first one has no model or no credentials. Throws only when none can, naming each reason.
 */
async function pickReviewer(level: Level, ctx: ExtensionContext, signal: AbortSignal) {
	const reasons: string[] = [];
	for (const spec of candidates(level, ctx.model)) {
		signal.throwIfAborted();
		const name = `${spec.provider}/${spec.model}`;
		const model = ctx.modelRegistry.find(spec.provider, spec.model);
		if (!model) {
			reasons.push(`model ${name} is not available`);
			continue;
		}
		// The session's own runtime, so providers and credentials registered by the user's extensions reach the
		// reviewer too. ModelRegistry keeps it in a field that is private only to TypeScript.
		const modelRuntime = (ctx.modelRegistry as unknown as { runtime?: ModelRuntime }).runtime;
		if (!modelRuntime) throw new Error("the model runtime of the session is not reachable");
		// As Pi's prompt: the auth snapshot is filled asynchronously, so a stale one falls back to a direct check.
		if (!ctx.modelRegistry.hasConfiguredAuth(model) && !(await untilAborted(modelRuntime.checkAuth(spec.provider, { signal }), signal))) {
			reasons.push(`no credentials for ${spec.provider} (model ${name})`);
			continue;
		}
		return { spec, model, modelRuntime };
	}
	throw new Error(reasons.join("; "));
}

/** One reviewer session from start to its last assistant text. Throws with the reason when there is no verdict. */
async function runReviewer(pi: ExtensionAPI, level: Level, brief: string, ctx: ExtensionContext, signal: AbortSignal, used: { spec?: Spec }): Promise<string> {
	signal.throwIfAborted();
	const { spec, model, modelRuntime } = await pickReviewer(level, ctx, signal);
	used.spec = spec;

	signal.throwIfAborted();
	// The main session's shell, including Git Bash on Windows, and its image settings; no warmer, no compaction.
	const own = pi.getSettings();
	const settingsManager = SettingsManager.inMemory({
		cacheWarming: "off",
		compaction: { enabled: false },
		shellPath: own.shellPath,
		shellCommandPrefix: own.shellCommandPrefix,
		images: { autoResize: own.images?.autoResize },
	});
	// No extensions, skills, prompt templates, themes or context files; the prompt is REVIEWER.md, with Pi's <cwd> block.
	const resourceLoader = new DefaultResourceLoader({
		cwd: ctx.cwd,
		agentDir: getAgentDir(),
		settingsManager,
		noExtensions: true,
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
		systemPromptOverride: () => REVIEWER,
		appendSystemPromptOverride: () => [],
		// The only extension of the reviewer: the git guard of every bash call, stock or offered.
		extensionFactories: [(sub: ExtensionAPI) => {
			sub.on("tool_call", (event) => {
				if (event.toolName !== "bash" || typeof event.input.command !== "string") return;
				const reason = blockedGit(event.input.command);
				if (reason) return { block: true, reason };
			});
		}],
	});
	await untilAborted(resourceLoader.reload(), signal);
	signal.throwIfAborted();
	const offered = offeredTools(pi, ctx.cwd);
	signal.throwIfAborted();
	const creating = createAgentSession({
		cwd: ctx.cwd,
		model,
		thinkingLevel: spec.thinking,
		modelRuntime,
		resourceLoader,
		tools: [...REVIEWER_TOOLS],
		customTools: offered ?? reviewerTools(ctx.cwd),
		sessionManager: SessionManager.inMemory(ctx.cwd),
		settingsManager,
	}).then((created) => {
		// createAgentSession has no signal: dispose a session that materializes after cancellation.
		if (signal.aborted) {
			created.session.dispose();
			signal.throwIfAborted();
		}
		return created;
	});
	let created: Awaited<typeof creating>;
	try {
		created = await untilAborted(creating, signal);
	} catch (error) {
		void creating.then(({ session }) => session.dispose()).catch(() => {});
		throw error;
	}
	const { session } = created;
	// Pi 1.4 prompt() awaits auth before an active run exists, so abort() alone cannot stop that preflight.
	// This public request hook stays guarded even if the abandoned prompt resumes after dispose().
	const stream = session.agent.streamFunction;
	session.agent.streamFunction = (model, context, options) => {
		signal.throwIfAborted();
		// Reviewer Anthropic requests use the built-in 5m tier, before any adapter's OAuth fallback.
		return stream(model, context, model.api === "anthropic-messages" ? { ...options, cacheRetention: "short" } : options);
	};
	const stop = () => { void session.abort().catch(() => {}); };
	try {
		signal.addEventListener("abort", stop, { once: true });
		if (signal.aborted) throw new Error("aborted");
		await untilAborted(session.prompt(brief), signal);
		if (signal.aborted) throw new Error("aborted");
		const last = [...session.messages].reverse().find((m) => m.role === "assistant");
		if (last?.role === "assistant" && last.stopReason === "error") {
			throw new Error(last.errorMessage || "the model request failed");
		}
		if (last?.role !== "assistant" || last.stopReason !== "stop") {
			throw new Error(`the reviewer did not complete normally (${last?.stopReason ?? "no assistant response"})`);
		}
		const text = session.getLastAssistantText()?.trim();
		if (!text) throw new Error("the reviewer gave no verdict");
		return verdictOf(text);
	} finally {
		signal.removeEventListener("abort", stop);
		session.dispose();
	}
}

/** Highest owned review id, including legacy outer prefixes, never a verdict or error body. */
function lastNumber(entries: readonly SessionEntry[]): number {
	let max = 0;
	const take = (n: unknown) => {
		if (typeof n === "number" && Number.isSafeInteger(n) && n > 0) max = Math.max(max, n);
	};
	for (const entry of entries) {
		if (entry.type === "custom" && entry.customType === MESSAGE_TYPE)
			take((entry.data as { n?: unknown } | undefined)?.n);
		let match: RegExpExecArray | null = null;
		if (entry.type === "custom_message" && entry.customType === MESSAGE_TYPE)
			match = /^\[review#(\d+)\](?:\s|$)/.exec(textOf(entry.content));
		else if (entry.type === "message" && entry.message.role === "toolResult" && entry.message.toolName === "review")
			match = /^review#(\d+) started\.(?:\s|$)/.exec(textOf(entry.message.content));
		if (match) take(Number(match[1]));
	}
	return max;
}

export default function review(pi: ExtensionAPI) {
	let counter = 0;
	let main: ExtensionContext | undefined;
	let mainAborted = false;
	const running = new Set<AbortController>();
	/** Every job until its verdict is sent; print and JSON modes wait for them. */
	const jobs = new Set<Promise<void>>();
	/** Verdicts sent while the main session was busy, by review number, until the main model answers after them. */
	const unanswered = new Set<number>();

	pi.on("session_start", (_event, ctx) => {
		main = ctx;
		counter = lastNumber(ctx.sessionManager.getEntries());
	});
	pi.on("session_shutdown", () => {
		for (const job of running) job.abort(SHUTDOWN);
		running.clear();
	});

	// Each review sends one verdict, so its number `n` in `details` is the delivery number.
	type Verdict = { customType: string; content: string; display: boolean; details: { n: number } };
	/** Held from agent_end until turn_start or our authoritative agent_settled handler. */
	let settling = false;
	const late: Verdict[] = [];
	function deliver(message: Verdict) {
		if (settling) {
			late.push(message);
			return;
		}
		// A previous abort pauses idle delivery only; a new busy run may still be in an earlier start hook.
		if (mainAborted && main?.isIdle() !== false) {
			pi.sendMessage(message, { triggerTurn: false });
			return;
		}
		if (main?.isIdle() !== false) {
			pi.sendMessage(message, { triggerTurn: true, deliverAs: "followUp" });
			return;
		}
		// Busy: Pi appends a message without triggerTurn to the session at the end of the current turn or run, aborted
		// or not, so Esc and abort cannot drop it (a follow-up waits in the agent's queue, which Esc clears).
		// agent_before_settle adds the turn.
		unanswered.add(message.details.n);
		pi.sendMessage(message, { triggerTurn: false });
	}

	/** Whether a verdict sent while busy still waits for a main turn; drops the ones the model already saw. */
	function needsTurn(ctx: ExtensionContext): boolean {
		const entries = ctx.sessionManager.getEntries();
		const branch = ctx.sessionManager.getBranch();
		const lastAnswer = branch.findLastIndex((e) => e.type === "message" && e.message.role === "assistant");
		const isVerdict = (n: number) => (e: SessionEntry) =>
			e.type === "custom_message" && e.customType === MESSAGE_TYPE && (e.details as { n?: number } | undefined)?.n === n;
		for (const n of unanswered) {
			if (!entries.some(isVerdict(n))) continue; // still held by Pi until the turn ends
			const at = branch.findIndex(isVerdict(n));
			if (at < 0 || at < lastAnswer) unanswered.delete(n); // on another branch, or answered
		}
		return unanswered.size > 0;
	}

	// Print and JSON modes exit when the main run settles, so there the main run waits for running reviews. A verdict
	// sent during the run continues it here; an idle main session gets a verdict as a new turn. After an abort the
	// verdict stays in the session without a turn, and the model sees it on the next one.
	pi.on("agent_end", async (_event, ctx) => {
		// Unlike before_settle, agent_end still has the native run's active abort signal.
		// isIdle becomes true before earlier agent_settled hooks finish, including after an abort.
		settling = true;
		if (ctx.mode !== "print" && ctx.mode !== "json") return;
		const signal = ctx.signal;
		if (!signal) return;
		try {
			while (jobs.size > 0) await untilAborted(Promise.all(jobs), signal);
		} catch (error) {
			if (!signal.aborted) throw error;
		} finally {
			if (signal.aborted) mainAborted = true;
		}
	});
	pi.on("agent_before_settle", (_event, ctx) => {
		// Flush the early phase before deciding to continue, or held verdicts could miss this run.
		for (const message of late.splice(0)) {
			unanswered.add(message.details.n);
			pi.sendMessage(message, { triggerTurn: false });
		}
		if (!mainAborted && needsTurn(ctx)) return { continue: true };
		settling = true;
	});
	// Another extension's agent_before_settle handler may run after ours, so a verdict can come in after our check and
	// before the run settles. It is sent here; Pi defers it until the settle ends and then starts its turn.
	pi.on("agent_start", () => {
		mainAborted = false;
	});
	pi.on("turn_start", () => {
		settling = false;
	});
	pi.on("agent_settled", (event) => {
		mainAborted = event.aborted;
		settling = false;
		// One turn for all of them: Pi defers each triggerTurn separately, so the earlier ones are appended at once and
		// only the last one starts the turn.
		const held = late.splice(0);
		held.forEach((message, i) => pi.sendMessage(message, { triggerTurn: !event.aborted && i === held.length - 1 }));
	});

	/** `carried` lists the open disputes in this review's brief; its verdict answers those still open when it comes. */
	async function job(n: number, level: Level, brief: string, ctx: ExtensionContext, carried: readonly string[]) {
		const controller = new AbortController();
		running.add(controller);
		const startedAt = Date.now();
		const timer = setTimeout(() => controller.abort(TIMEOUT), TIMEOUT_MS);
		// A running review never keeps the process alive.
		timer.unref?.();
		let verdict: string;
		let failed = false;
		const used: { spec?: Spec } = {};
		try {
			verdict = await runReviewer(pi, level, brief, ctx, controller.signal, used);
		} catch (error) {
			const reason =
				controller.signal.reason === TIMEOUT
					? `no verdict within ${TIMEOUT_MS / 60000} minutes`
					: error instanceof Error
						? error.message
						: String(error);
			verdict = `Review failed: ${reason}`;
			failed = true;
		} finally {
			clearTimeout(timer);
			running.delete(controller);
		}
		// The session that asked is gone; nobody is left to read the verdict.
		if (controller.signal.reason === SHUTDOWN) return;
		try {
			const settled = settle(n, verdict, failed, disputes(ctx.sessionManager.getBranch()), carried);
			if (settled.findings.length > 0 || settled.rulings.length > 0) {
				pi.appendEntry(MESSAGE_TYPE, {
					n,
					...(settled.findings.length > 0 ? { findings: settled.findings } : {}),
					...(settled.rulings.length > 0 ? { rulings: settled.rulings } : {}),
				});
			}
			deliver({
				customType: MESSAGE_TYPE,
				content: verdictMessage(n, verdict, failed, settled.notes),
				display: true,
				// For the user and the logs only; details do not reach the model.
				details: {
					n,
					level,
					...(used.spec ? { model: `${used.spec.provider}/${used.spec.model}`, thinking: used.spec.thinking } : {}),
					seconds: Math.round((Date.now() - startedAt) / 100) / 10,
				},
			});
		} catch {
			// The session ended between the verdict and its delivery.
		}
	}

	pi.registerTool({
		name: "review",
		label: "review",
		description: DESCRIPTION,
		parameters,
		async execute(_id, params, _signal, _onUpdate, ctx) {
			// SDK reload can rebuild an unbound runner without emitting session_start.
			if (!main) {
				main = ctx;
				counter = lastNumber(ctx.sessionManager.getEntries());
			}
			const p = params as Params;
			if (counter >= Number.MAX_SAFE_INTEGER) throw new Error("Review id space exhausted");
			const rebuttals = Array.isArray(p.rebuttals) ? p.rebuttals : [];
			// A refused rebuttal starts nothing and takes no number; the error tells Main what to do instead.
			if (rebuttals.length > 0) {
				const before = ctx.sessionManager.getBranch();
				const refused = await refusals(rebuttals, disputes(before), before, ctx.cwd);
				if (refused.length > 0) throw new Error(`Review not started. ${refused.map((r) => `Refused: ${r}`).join(" ")}`);
			}
			// Everything from here to appendEntry is synchronous. A parallel call may have sent a rebuttal for the same
			// finding while the sources were read, so the state is checked again on the branch as it is now, and the
			// accepted rebuttals are persisted before any other call can run.
			if (counter >= Number.MAX_SAFE_INTEGER) throw new Error("Review id space exhausted");
			const branch = ctx.sessionManager.getBranch();
			const all = disputes(branch);
			const stale = stateRefusals(rebuttals, all);
			if (stale.length > 0) throw new Error(`Review not started. ${stale.map((r) => `Refused: ${r}`).join(" ")}`);
			const n = ++counter;
			const accepted = rebuttals.map((r) => ({ finding: r.finding.trim(), quote: r.quote, source: r.source.trim(), explanation: r.explanation }));
			pi.appendEntry(MESSAGE_TYPE, accepted.length > 0 ? { n, rebuttals: accepted } : { n });
			for (const r of accepted) all.get(r.finding)!.rebuttal = { ...r, review: n };
			const carried = [...all.values()].filter(isOpen).map((d) => d.id);
			const brief = buildBrief(branch, p, all);
			const pending = job(n, p.level, brief, ctx, carried);
			jobs.add(pending);
			void pending.finally(() => jobs.delete(pending));
			return {
				content: [{ type: "text", text: startedText(n) }],
				details: { n, level: p.level },
			};
		},
	});
}
