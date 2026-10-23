#!/usr/bin/env node
// Quality-control inbox bot (PROCESS.md, Quality control loop). One pass reads one completed run of a QA workflow
// (tests, pcli, codex-oracle) on main, turns its failures into signatures and keeps one GitHub issue per signature
// (label `qa-inbox`, body format in scripts/qa-state.mjs). Every pass also refreshes rate, fix and greens of all open
// inbox issues of that workflow and closes an issue whose fix is on main and has enough green scheduled runs.
//
//   node scripts/qa-inbox.mjs --run <id> [--repo ARQAWA/my-pi] [--git-ref origin/main] [--dry-run] [--force-any-branch]
//
// Needs `gh` (logged in, or GH_TOKEN) and a full-depth git checkout of the repository for `QA: #N` fix detection and
// the history hint. --dry-run reads everything and prints the planned actions with full issue bodies, changing
// nothing. Any gh failure exits non-zero: a pass never succeeds silently.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { INBOX_LABEL, LABELS, MAX_OCCURRENCES, QA_WORKFLOWS, decodeState, encodeState, needGreen } from "./qa-state.mjs";

export const EXCERPT_LINES = 40;
const EXCERPT_CHARS = 4000;
const HISTORY_LINES = 30;
const SHOWN_OCCURRENCES = 20;
const MAX_EARLIER_RUNS = 500;
// Job conclusions that are failures; a cancelled job (manual cancel, superseded run) is not one.
const FAILED_JOB = new Set(["failure", "timed_out", "startup_failure"]);
// Run conclusions that count for the rate: the run executed its jobs.
const COUNTED_RUN = new Set(["success", "failure", "timed_out"]);
// Run conclusions the catch-up reads and that get a run-level record when no job failed.
const FAILED_RUN = new Set(["failure", "timed_out", "startup_failure"]);
// Catch-up window for runs no pass has read (a lost pending pass), and the extra creation slack for long runs.
const CATCH_UP_MS = 48 * 3600_000;
const CATCH_UP_SLACK_MS = 6 * 3600_000;
// Setup and runner steps: a job failing there is infrastructure, not a test.
const INFRA_STEP = /^(Set up job|(Run |Post Run )?actions\/(checkout|setup-node)@|(Run |Post Run )?oven-sh\/setup-bun@|(Run )?npm ci\b|Install)/i;
// Labels the bot sets and removes from computed state; qa:new, qa:regressed and qa:triaged are only added (or left
// to people).
const COMPUTED_LABELS = ["qa:persistent", "qa:intermittent", "qa:infra", "qa:fix-merged"];

// ---------------------------------------------------------------------------------------------------------------
// TAP

// Node's TAP reporter escapes \, #, and control characters in names and single-quoted YAML strings.
export function unescapeTap(s) {
	const map = { b: "\b", f: "\f", t: "\t", n: "\n", r: "\r", v: "\v" };
	return String(s).replace(/\\(.)/g, (_, c) => map[c] ?? c);
}

function scalar(v) {
	if (v === "~" || v === "null") return null;
	const q = /^'(.*)'$/.exec(v);
	if (q) return unescapeTap(q[1].replace(/''/g, "'"));
	if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
	return v;
}

// The YAML diagnostic block after a test point: `---` at `ind` spaces up to `...` at the same indent.
function readYaml(lines, start, ind) {
	const pad = " ".repeat(ind);
	if (lines[start] !== `${pad}---`) return { yaml: {}, raw: [], end: start - 1 };
	const yaml = {};
	const raw = [];
	let key = null;
	let block = null;
	let j = start + 1;
	for (; j < lines.length && lines[j] !== `${pad}...`; j++) {
		const line = lines[j];
		const top = line.startsWith(pad) && line.length > ind && line[ind] !== " ";
		const m = top ? /^([A-Za-z_]\w*):(?: (.*))?$/.exec(line.slice(ind)) : null;
		if (m) {
			key = m[1];
			const v = (m[2] ?? "").trim();
			if (v === "" || /^[|>][-+]?$/.test(v)) {
				block = [];
				yaml[key] = "";
			} else {
				block = null;
				yaml[key] = scalar(v);
			}
		} else if (block && key) {
			block.push(line.slice(ind + 2));
			yaml[key] = block.join("\n").replace(/\s+$/, "");
		}
		if (key !== "duration_ms" && key !== "type") raw.push(line.slice(ind).replace(/\s+$/, ""));
	}
	return { yaml, raw, end: j };
}

// Repo-relative file of a TAP location: drops file://, :line:col and everything up to the GitHub workspace
// (`.../<repo>/<repo>/`) or the CI copy in the runner temp dir (`.../_temp/<dir>/<repo>/`); forward slashes.
export function normalizeFile(location) {
	if (location === null || location === undefined || location === "") return null;
	let p = String(location);
	if (/^file:/i.test(p)) {
		p = p.replace(/^file:\/*/i, "/");
		try { p = decodeURIComponent(p); } catch { /* keep as is */ }
	}
	p = p.replace(/\\/g, "/").replace(/\/{2,}/g, "/").replace(/:\d+(?::\d+)?$/, "");
	const temp = /\/_temp\/[^/]+\/[^/]+\/(.+)$/.exec(p);
	if (temp) return temp[1];
	const work = /(?:^|\/)([^/]+)\/\1\/(.+)$/.exec(p);
	if (work) return work[2];
	return p.replace(/^\.\//, "");
}

// Failure leaves of a Node test runner TAP file. A parent `not ok` with failureType subtestsFailed is not a leaf;
// a `not ok` whose YAML has exitCode or signal is the process of a test file that died (kind process-exit).
// cancelledByParent leaves are consequences of another failure and stay only when their file has nothing else.
export function parseTap(text) {
	const lines = String(text).split(/\r?\n/);
	const names = [];
	const found = [];
	for (let i = 0; i < lines.length; i++) {
		const sub = /^( *)# Subtest: (.*)$/.exec(lines[i]);
		if (sub) {
			const level = Math.floor(sub[1].length / 4);
			names.length = level;
			names[level] = unescapeTap(sub[2]);
			continue;
		}
		const m = /^( *)not ok \d+(?: - (.*))?$/.exec(lines[i]);
		if (!m) continue;
		const indent = m[1].length;
		const level = Math.floor(indent / 4);
		const rawName = m[2] ?? "";
		const { yaml, raw, end } = readYaml(lines, i + 1, indent + 2);
		i = end;
		if (/(?:^|[^\\]) # (TODO|SKIP)\b/i.test(rawName)) continue;
		if (yaml.failureType === "subtestsFailed") continue;
		const name = unescapeTap(rawName);
		const errorExcerpt = raw.slice(0, EXCERPT_LINES).join("\n").slice(0, EXCERPT_CHARS);
		const exited = "exitCode" in yaml || "signal" in yaml;
		if (exited) {
			const code = yaml.exitCode ?? yaml.signal ?? "unknown";
			found.push({
				kind: "process-exit", file: normalizeFile(yaml.location) ?? normalizeFile(name), test: null,
				failureType: yaml.failureType ?? null, errorClass: yaml.name ?? null, code: String(code), errorExcerpt,
			});
		} else {
			found.push({
				kind: "test", file: normalizeFile(yaml.location), test: [...names.slice(0, level), name].join(" › "),
				failureType: yaml.failureType ?? null, errorClass: yaml.name ?? null,
				code: yaml.code === undefined || yaml.code === null ? null : String(yaml.code), errorExcerpt,
			});
		}
	}
	const realFiles = new Set(found.filter((f) => f.failureType !== "cancelledByParent").map((f) => f.file));
	return found.filter((f) => f.failureType !== "cancelledByParent" || !realFiles.has(f.file));
}

// ---------------------------------------------------------------------------------------------------------------
// Signatures

export const jobFamilyOf = (jobName) => String(jobName).replace(/\s*\(.*\)\s*$/, "").trim();

// The first failed step of a job from the jobs API; a job without one (runner lost, job timeout) names the
// cancelled step or its conclusion.
export function jobFailure(job) {
	const steps = [...(job.steps ?? [])].sort((a, b) => a.number - b.number);
	const failed = steps.find((s) => s.conclusion === "failure");
	const cancelled = steps.find((s) => s.conclusion === "cancelled");
	const step = failed ? failed.name : cancelled ? `${cancelled.name} (cancelled)` : `(job ${job.conclusion})`;
	return {
		kind: "job", jobFamily: jobFamilyOf(job.name), step, file: null, test: null, failureType: null,
		errorClass: null, code: null, errorExcerpt: "",
	};
}

export function signatureKey(f, workflow) {
	const s = (v) => (v === null || v === undefined ? "" : String(v));
	if (f.kind === "process-exit") return ["exit", workflow, s(f.file)].join("|");
	if (f.kind === "job") return ["job", workflow, s(f.jobFamily), s(f.step)].join("|");
	return ["test", workflow, s(f.file), s(f.test), s(f.failureType), s(f.errorClass)].join("|");
}

export const signature = (key) => createHash("sha1").update(key, "utf8").digest("hex");

export const isInfraStep = (step) => INFRA_STEP.test(String(step ?? ""));

// ---------------------------------------------------------------------------------------------------------------
// Issue text

export function issueTitle(state) {
	let t;
	if (state.kind === "process-exit") t = `[qa] ${state.workflow}: ${state.file} process exit`;
	else if (state.kind === "job") t = `[qa] ${state.workflow}: ${state.jobFamily} › ${state.step}`;
	else t = `[qa] ${state.workflow}: ${state.file} › ${state.test} (${state.failureType})`;
	return t.length > 250 ? `${t.slice(0, 249)}…` : t;
}

const code = (s) => {
	const v = String(s ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
	return v.includes("`") ? `\`\` ${v} \`\`` : `\`${v}\``;
};
const cell = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
const fence = (text) => {
	const longest = Math.max(2, ...[...String(text).matchAll(/`+/g)].map((m) => m[0].length));
	const f = "`".repeat(longest + 1);
	return `${f}text\n${text}\n${f}`;
};
const short = (sha) => (sha ? String(sha).slice(0, 7) : "none");
const runUrl = (repo, id) => `https://github.com/${repo}/actions/runs/${id}`;

// Title and Markdown body of an issue from its state; the two machine markers close the body.
export function buildIssue(state, { repo }) {
	const jobs = [...new Set(state.occurrences.map((o) => o.job))];
	const first = state.occurrences.find((o) => o.at >= state.firstSeen) ?? state.occurrences[0];
	const last = state.occurrences[state.occurrences.length - 1];
	const rows = [];
	rows.push(["Workflow", code(state.workflow)]);
	if (state.kind === "job") {
		rows.push(["Job", code(state.jobFamily)], ["Failed step", code(state.step)]);
	} else {
		rows.push(["File", code(state.file)]);
		if (state.kind === "test") rows.push(["Test", code(state.test)]);
		else {
			// One dying file is one signature across OSes; the exit code or signal differs per occurrence.
			const details = [...new Set(state.occurrences.map((o) => o.detail).filter((d) => d !== undefined && d !== null))];
			rows.push(["Process exit", (details.length ? details : [state.code]).map(code).join(", ")]);
		}
		rows.push(["Failure", [state.failureType, state.errorClass].filter(Boolean).map(code).join(", ") || "unknown"]);
	}
	rows.push(
		["First seen", `${state.firstSeen}${first ? ` ([run ${first.runId}](${runUrl(repo, first.runId)}))` : ""}`],
		["Last seen", `${state.lastSeen}${last ? ` ([run ${last.runId}](${runUrl(repo, last.runId)}))` : ""}`],
		["Rate", `${state.rate.k}/${state.rate.n} completed scheduled main runs since first seen${state.fix ? ", before the fix" : ""}`],
		["Jobs", jobs.map(cell).join("<br>")],
		["Fix", state.fix ? `${code(short(state.fix.sha))} ${cell(state.fix.subject)}` : "none (a main commit with the line `QA: #<this issue>`)"],
		["Green after fix", `${state.greenAfterFix} of ${state.needGreen} scheduled runs in a row`],
	);
	const out = [];
	out.push(`One failure signature of main runs, kept by \`scripts/qa-inbox.mjs\` (PROCESS.md, Quality control loop). `
		+ "The bot rewrites this text on every pass; write triage notes as comments.");
	if (state.closeNote) out.push("", `**${state.closeNote}**`);
	out.push("", "| | |", "| --- | --- |", ...rows.map(([k, v]) => `| ${k} | ${v} |`));
	if (state.errorExcerpt) out.push("", `### Error (first ${EXCERPT_LINES} lines)`, "", fence(state.errorExcerpt));
	out.push("", "### History", "");
	out.push(`Last green main run before first seen: ${code(short(state.lastGreenSha))}; first red: ${code(short(state.firstRedSha))}.`);
	if (state.history?.note) out.push("", state.history.note);
	if (state.history?.lines?.length) {
		out.push("", `Main commits in \`${short(state.lastGreenSha)}..${short(state.firstRedSha)}\` (each is one squashed task):`, "",
			fence(state.history.lines.join("\n")));
	}
	const shown = state.occurrences.slice(-SHOWN_OCCURRENCES).reverse();
	out.push("", `### Occurrences (${state.occurrences.length} recorded, newest first)`, "",
		"| Run | Attempt | Job | SHA | Event | Time |", "| --- | --- | --- | --- | --- | --- |");
	for (const o of shown) {
		out.push(`| [${o.runId}](${o.url || runUrl(repo, o.runId)}) | ${o.attempt} | ${cell(o.job)} | ${code(short(o.sha))} | ${cell(o.event)} | ${cell(o.at)} |`);
	}
	if (state.occurrences.length > shown.length) out.push("", `${state.occurrences.length - shown.length} older occurrences are in the state only.`);
	const evidence = [...new Set(shown.map((o) => o.runId))].slice(0, 5).map((id) => `[run ${id}](${runUrl(repo, id)}#artifacts)`);
	if (state.kind !== "job" && evidence.length) out.push("", `Evidence (TAP, crash reports): ${evidence.join(", ")}.`);
	out.push("", encodeState(state));
	return { title: issueTitle(state), body: out.join("\n") };
}

// ---------------------------------------------------------------------------------------------------------------
// State

const occKey = (o) => `${o.runId}:${o.attempt}:${o.job}`;
const byRunId = (a, b) => a.runId - b.runId || a.attempt - b.attempt || String(a.job).localeCompare(String(b.job));

function mergeOccurrences(state, added) {
	const seen = new Map(state.occurrences.map((o) => [occKey(o), o]));
	const earlier = new Set(state.earlierRunIds ?? []);
	let fresh = 0;
	// A run in earlierRunIds was recorded before and its occurrences were dropped by the cap: not fresh.
	for (const o of added) if (!seen.has(occKey(o)) && !earlier.has(o.runId)) { seen.set(occKey(o), o); fresh++; }
	let all = [...seen.values()].sort(byRunId);
	if (all.length > MAX_OCCURRENCES) {
		// Run ids of dropped occurrences stay recorded: the rate counts those of the episode (id >= firstRunId),
		// and the catch-up does not read them again.
		const dropped = all.slice(0, all.length - MAX_OCCURRENCES);
		for (const o of dropped) earlier.add(o.runId);
		state.earlierRunIds = [...earlier].sort((a, b) => a - b).slice(-MAX_EARLIER_RUNS);
		all = all.slice(-MAX_OCCURRENCES);
	}
	state.occurrences = all;
	state.lastSeen = all.reduce((m, o) => (o.at > m ? o.at : m), state.lastSeen ?? "");
	return fresh;
}

// A new episode: no fix and no greens yet, plus its start.
function startEpisode(state, occ, runs, git) {
	state.fix = null;
	state.greenAfterFix = 0;
	state.closeNote = null;
	setEpisodeStart(state, occ, runs, git);
}

// The start of an episode from its earliest occurrences (sorted by run id): first seen, first run, first red, the
// last green scheduled main run before it and the commit list between them. Also used when a pass reads a run
// that is earlier than the recorded start (passes out of order, catch-up).
function setEpisodeStart(state, occ, runs, git) {
	const firstOcc = occ[0];
	const firstRun = occ.filter((o) => o.runId === firstOcc.runId);
	state.firstSeen = firstRun.reduce((m, o) => (o.at < m ? o.at : m), firstOcc.at);
	state.firstRunId = firstOcc.runId;
	state.firstRedSha = firstOcc.sha;
	// Only a scheduled success is a baseline: a dispatch may have run on another ref's inputs or by hand.
	const green = runs.filter((r) => r.event === "schedule" && r.conclusion === "success" && r.id < firstOcc.runId)
		.sort((a, b) => b.id - a.id)[0];
	state.lastGreenSha = green?.head_sha ?? null;
	const history = { lines: [], note: null };
	if (!green) {
		history.note = "No earlier successful main run of this workflow was found.";
	} else if (green.head_sha === firstOcc.sha) {
		history.note = "The last green main run had the same SHA: this is intermittent or environment drift "
			+ "(compare the Facts steps of the two runs), not caused by a commit.";
	} else {
		const r = git.log(green.head_sha, firstOcc.sha);
		if (r.error) history.note = `git log ${short(green.head_sha)}..${short(firstOcc.sha)} failed: ${r.error}`;
		else {
			history.lines = r.lines.slice(0, HISTORY_LINES);
			if (r.lines.length > HISTORY_LINES) history.lines.push(`… ${r.lines.length - HISTORY_LINES} more`);
			if (!r.lines.length) history.note = "No commits between the last green and the first red SHA.";
		}
	}
	state.history = history;
}

function newState(sig, f, workflow) {
	return {
		v: 1, signature: sig, kind: f.kind, workflow,
		file: f.file ?? null, test: f.test ?? null, failureType: f.failureType ?? null, errorClass: f.errorClass ?? null,
		code: f.code ?? null, jobFamily: f.jobFamily ?? null, step: f.step ?? null,
		firstSeen: null, lastSeen: "", occurrences: [], lastGreenSha: null, firstRedSha: null, firstRunId: null,
		earlierRunIds: [], rate: { k: 0, n: 0 }, fix: null, greenAfterFix: 0, needGreen: 6,
		errorExcerpt: f.errorExcerpt ?? "", history: { lines: [], note: null }, closeNote: null,
	};
}

// Rate, fix, greens and needGreen of an episode, recomputed from the runs list and the occurrences.
function refresh(state, number, runs, git) {
	const firstRunId = state.firstRunId ?? Math.min(...state.occurrences.map((o) => o.runId));
	const failedRuns = new Set([
		...(state.earlierRunIds ?? []),
		...state.occurrences.filter((o) => o.runId >= firstRunId).map((o) => o.runId),
	]);
	const scheduled = runs.filter((r) => r.event === "schedule" && COUNTED_RUN.has(r.conclusion)).sort((a, b) => a.id - b.id);
	// The latest `QA: #N` commit that landed after the failure (not an ancestor of the first red SHA).
	const fix = (git.fixes(number) ?? []).find((c) => !(state.firstRedSha && git.isAncestor(c.sha, state.firstRedSha) === true));
	state.fix = fix ? { sha: fix.sha, subject: fix.subject, at: fix.at } : null;
	// The rate is the failure's own rate: runs that already contain the fix count as greens below, not here,
	// otherwise every green would lower p and raise needGreen without end.
	const since = scheduled.filter((r) => r.id >= firstRunId && !(state.fix && git.isAncestor(state.fix.sha, r.head_sha) === true));
	state.rate = { k: since.filter((r) => failedRuns.has(r.id)).length, n: since.length };
	state.needGreen = needGreen(state.rate);
	let green = 0;
	if (state.fix) {
		// Scheduled runs whose head contains the fix: a run with the signature resets, a first-attempt success
		// counts, any other run (a red run for another reason, a success only after a re-run) proves nothing.
		for (const r of scheduled) {
			if (git.isAncestor(state.fix.sha, r.head_sha) !== true) continue;
			if (failedRuns.has(r.id)) green = 0;
			else if (r.conclusion === "success" && (r.run_attempt ?? 1) === 1) green++;
		}
	}
	state.greenAfterFix = green;
}

export function computeLabels(state, existing, { created = false, reopened = false } = {}) {
	const set = new Set(existing.filter((l) => !COMPUTED_LABELS.includes(l)));
	set.add(INBOX_LABEL);
	if (created) set.add("qa:new");
	if (reopened) set.add("qa:regressed");
	const { k, n } = state.rate;
	const sameSha = Boolean(state.lastGreenSha) && state.lastGreenSha === state.firstRedSha;
	if (n >= 2 && k === n) set.add("qa:persistent");
	else if ((n > 0 && k < n) || sameSha) set.add("qa:intermittent");
	if (state.kind === "job" && isInfraStep(state.step)) set.add("qa:infra");
	if (state.fix) set.add("qa:fix-merged");
	return [...set].sort();
}

const isOpen = (issue) => String(issue.state).toLowerCase() === "open";

// The planned actions of one pass. Pure: gh and git results come in as data and functions.
//   run: the run object of the API; failures: [{ failure, occurrence }]; issues: [{ number, title, body, state,
//   labels: [name] }]; runs: completed main runs of the workflow (any event); git: { fixes(number) -> [{ sha,
//   subject, at }] newest first, isAncestor(a, b) -> true | false | null, log(a, b) -> { lines } | { error } }.
// Returns [{ op: "create" | "update", number?, title, body, labels, state: "open" | "closed", reason, state }].
export function applyRun({ repo, workflow, failures, issues, runs, git }) {
	const groups = new Map();
	for (const { failure, occurrence } of failures) {
		const key = signatureKey(failure, workflow);
		const sig = signature(key);
		if (!groups.has(sig)) groups.set(sig, { failure, occurrences: [] });
		const g = groups.get(sig);
		if (!g.failure.errorExcerpt && failure.errorExcerpt) g.failure = failure;
		g.occurrences.push(failure.kind === "process-exit" ? { ...occurrence, detail: failure.code } : occurrence);
	}
	// Known issues by signature: an open one wins, else the newest closed one.
	const known = new Map();
	for (const issue of [...issues].sort((a, b) => a.number - b.number)) {
		const state = decodeState(issue.body);
		if (!state) continue;
		const prev = known.get(state.signature);
		if (!prev || (!isOpen(prev.issue) && (isOpen(issue) || issue.number > prev.issue.number))) known.set(state.signature, { issue, state });
	}
	const work = [];
	for (const [sig, g] of groups) {
		const k = known.get(sig);
		const occ = [...g.occurrences].sort(byRunId);
		if (!k) {
			const state = newState(sig, g.failure, workflow);
			startEpisode(state, occ, runs, git);
			mergeOccurrences(state, occ);
			work.push({ issue: null, state, created: true, reopened: false, reason: `new signature ${sig.slice(0, 12)}` });
		} else if (isOpen(k.issue)) {
			const state = structuredClone(k.state);
			if (!state.errorExcerpt && g.failure.errorExcerpt) state.errorExcerpt = g.failure.errorExcerpt;
			const had = new Set(state.occurrences.map(occKey));
			const earlier = new Set(state.earlierRunIds ?? []);
			const freshOcc = occ.filter((o) => !had.has(occKey(o)) && !earlier.has(o.runId));
			const fresh = mergeOccurrences(state, occ);
			// An earlier run read later moves the episode start back; the rate window starts there.
			if (freshOcc.length && freshOcc[0].runId < state.firstRunId) setEpisodeStart(state, freshOcc, runs, git);
			work.push({ issue: k.issue, state, created: false, reopened: false, reason: `${fresh} new occurrence(s)` });
		} else {
			const had = new Set(k.state.occurrences.map(occKey));
			const earlier = new Set(k.state.earlierRunIds ?? []);
			const fresh = occ.filter((o) => !had.has(occKey(o)) && !earlier.has(o.runId));
			const state = structuredClone(k.state);
			if (!fresh.length) continue; // occurrences of the episode this issue already closed
			startEpisode(state, fresh, runs, git);
			if (g.failure.errorExcerpt) state.errorExcerpt = g.failure.errorExcerpt;
			mergeOccurrences(state, fresh);
			work.push({ issue: k.issue, state, created: false, reopened: true, reason: "closed signature occurred again" });
		}
	}
	// Self-healing: every other open issue of this workflow gets its rate, fix and greens recomputed.
	const touched = new Set(work.filter((w) => w.issue).map((w) => w.issue.number));
	for (const { issue, state } of known.values()) {
		if (!isOpen(issue) || touched.has(issue.number) || state.workflow !== workflow) continue;
		work.push({ issue, state: structuredClone(state), created: false, reopened: false, reason: "refresh" });
	}
	const actions = [];
	for (const w of work) {
		refresh(w.state, w.issue?.number, runs, git);
		let state = "open";
		if (w.issue && !w.reopened && w.state.fix && w.state.greenAfterFix >= w.state.needGreen) {
			state = "closed";
			w.state.closeNote = `Closed by the bot: fix ${short(w.state.fix.sha)} is on main and ${w.state.greenAfterFix} `
				+ `scheduled runs in a row passed without this failure (needed ${w.state.needGreen}).`;
			w.reason = "fix merged and enough green scheduled runs";
		}
		const labels = computeLabels(w.state, w.issue?.labels ?? [], { created: w.created, reopened: w.reopened });
		const { title, body } = buildIssue(w.state, { repo });
		if (!w.issue) {
			actions.push({ op: "create", title, body, labels, state, reason: w.reason, signature: w.state.signature });
			continue;
		}
		const sameLabels = JSON.stringify([...w.issue.labels].sort()) === JSON.stringify(labels);
		const wasOpen = isOpen(w.issue);
		if (body === w.issue.body && sameLabels && (state === "open") === wasOpen) continue;
		actions.push({
			op: "update", number: w.issue.number, title: w.issue.title, body, labels, state,
			reopen: !wasOpen && state === "open", close: wasOpen && state === "closed", reason: w.reason,
			signature: w.state.signature,
		});
	}
	return actions;
}

// ---------------------------------------------------------------------------------------------------------------
// gh and git

const GH_TIMEOUT = 60_000;
const DOWNLOAD_TIMEOUT = 300_000;
const GIT_TIMEOUT = 60_000;

// On Windows `gh` may be a .cmd shim, which needs a shell; quote what cmd would split.
const winQuote = (a) => (/^[\w\-.:/=@,+\\]+$/.test(a) ? a : `"${String(a).replace(/"/g, '""')}"`);

export function gh(args, { timeout = GH_TIMEOUT } = {}) {
	const win = process.platform === "win32";
	const r = spawnSync("gh", win ? args.map(winQuote) : args, {
		encoding: "utf8", shell: win, timeout, maxBuffer: 512 * 1024 * 1024,
		env: { ...process.env, GH_PROMPT_DISABLED: "1", NO_COLOR: "1" },
	});
	if (r.error || r.status !== 0) {
		const reason = String(r.stderr || r.error?.message || `exit ${r.status}`).trim().split(/\r?\n/).slice(0, 3).join(" ");
		throw new Error(`gh ${args.slice(0, 2).join(" ")} failed: ${reason}`);
	}
	return r.stdout;
}

const ghJson = (args, opts) => JSON.parse(gh(args, opts) || "null");

// All items of a paged REST list (per_page 100), at most `maxPages` pages.
function ghList(path, field, { maxPages = 10, fields = [], stop } = {}) {
	const all = [];
	for (let page = 1; page <= maxPages; page++) {
		const res = ghJson(["api", "-X", "GET", path, ...fields, "-F", "per_page=100", "-F", `page=${page}`]);
		const items = res?.[field] ?? [];
		all.push(...items);
		if (items.length < 100 || (stop && stop(all))) break;
	}
	return all;
}

function makeGit(ref) {
	const run = (args) => spawnSync("git", args, { encoding: "utf8", timeout: GIT_TIMEOUT, maxBuffer: 256 * 1024 * 1024 });
	const r = run(["log", "-E", "--grep=^QA:[[:space:]]*#[0-9]", "--format=%H%x1f%s%x1f%cI%x1f%B%x1e", ref]);
	if (r.error || r.status !== 0) throw new Error(`git log ${ref} failed: ${String(r.stderr || r.error?.message).trim()}`);
	const fixes = new Map();
	for (const rec of r.stdout.split("\x1e")) {
		const [sha, subject, at, body] = rec.replace(/^\s+/, "").split("\x1f");
		if (!sha || body === undefined) continue;
		for (const line of body.split(/\r?\n/)) {
			const m = /^QA:\s*(#\d+(?:\s*,\s*#\d+)*)\s*$/.exec(line.trim());
			if (!m) continue;
			for (const n of m[1].match(/\d+/g)) {
				if (!fixes.has(Number(n))) fixes.set(Number(n), []);
				fixes.get(Number(n)).push({ sha, subject, at });
			}
		}
	}
	const cache = new Map();
	return {
		fixes: (number) => fixes.get(number) ?? [],
		isAncestor(a, b) {
			const key = `${a}..${b}`;
			if (!cache.has(key)) {
				const s = run(["merge-base", "--is-ancestor", a, b]).status;
				cache.set(key, s === 0 ? true : s === 1 ? false : null);
			}
			return cache.get(key);
		},
		log(a, b) {
			const l = run(["log", "--format=%h %s", "-n", String(HISTORY_LINES + 200), `${a}..${b}`]);
			if (l.error || l.status !== 0) return { error: String(l.stderr || l.error?.message).trim().split(/\r?\n/)[0] };
			return { lines: l.stdout.split(/\r?\n/).filter(Boolean) };
		},
	};
}

// The evidence artifact of a job: `test-evidence-<core>-attempt<n>`, where <core> is the job name's matrix slug
// ("test (macos-latest, node 24)" -> test-macos-latest-node24 contains macos-latest-node24).
export function matchArtifact(jobName, attempt, artifacts) {
	const slug = String(jobName).toLowerCase().replace(/\bnode /g, "node").replace(/[(),]/g, " ").trim().split(/\s+/).join("-");
	const hits = [];
	for (const a of artifacts) {
		const m = /^test-evidence-(.+)-attempt(\d+)$/.exec(a.name);
		if (!m || Number(m[2]) !== attempt) continue;
		const core = m[1].toLowerCase();
		if (slug === core || slug.endsWith(`-${core}`) || slug.startsWith(`${core}-`) || slug.includes(`-${core}-`)) hits.push({ a, len: core.length });
	}
	return hits.sort((x, y) => y.len - x.len)[0]?.a ?? null;
}

function tapFiles(dir) {
	const out = [];
	for (const e of readdirSync(dir, { withFileTypes: true })) {
		const p = join(dir, e.name);
		if (e.isDirectory()) out.push(...tapFiles(p));
		else if (e.name.endsWith(".tap")) out.push(p);
	}
	return out.sort();
}

function parseArgs(argv) {
	const o = { run: null, repo: process.env.GITHUB_REPOSITORY || "ARQAWA/my-pi", gitRef: "origin/main", dryRun: false, forceAnyBranch: false };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--run") o.run = argv[++i];
		else if (a === "--repo") o.repo = argv[++i];
		else if (a === "--git-ref") o.gitRef = argv[++i];
		else if (a === "--dry-run") o.dryRun = true;
		else if (a === "--force-any-branch") o.forceAnyBranch = true;
		else throw new Error(`unknown argument: ${a}`);
	}
	if (!o.run || !/^\d+$/.test(o.run)) throw new Error("--run <numeric run id> is required");
	if (!/^[\w.-]+\/[\w.-]+$/.test(o.repo ?? "")) throw new Error(`bad --repo: ${o.repo}`);
	if (o.forceAnyBranch && !o.dryRun) throw new Error("--force-any-branch only with --dry-run: branch failures belong to their task");
	return o;
}

function ensureLabels(repo, needed) {
	const have = new Map(ghJson(["label", "list", "-R", repo, "--limit", "200", "--json", "name,color,description"]).map((l) => [l.name, l]));
	for (const name of needed) {
		const want = LABELS[name];
		if (!want) continue;
		const h = have.get(name);
		if (h && h.color?.toLowerCase() === want.color && (h.description ?? "") === want.description) continue;
		gh(["label", "create", name, "-R", repo, "--color", want.color, "--description", want.description, "--force"]);
		console.log(`label ${name}: ${h ? "updated" : "created"}`);
	}
}

// Failures of one run: every attempt's failed jobs, their TAP evidence or else the failed step. A failed run with no
// failed job (startup failure) is one run-level job signature, so every failed run leaves a record.
function runFailures(repo, run, tmp) {
	const jobs = [];
	for (let n = 1; n <= (run.run_attempt ?? 1); n++) {
		for (const job of ghList(`repos/${repo}/actions/runs/${run.id}/attempts/${n}/jobs`, "jobs")) {
			jobs.push({ ...job, attempt: job.run_attempt ?? n });
		}
	}
	const seenJobs = new Set();
	const failedJobs = jobs.filter((j) => FAILED_JOB.has(j.conclusion) && !seenJobs.has(j.id) && seenJobs.add(j.id));
	const artifacts = failedJobs.length ? ghList(`repos/${repo}/actions/runs/${run.id}/artifacts`, "artifacts") : [];
	const failures = [];
	for (const job of failedJobs) {
		const occurrence = {
			runId: run.id, attempt: job.attempt, job: job.name, sha: run.head_sha, event: run.event,
			at: job.completed_at || run.updated_at, url: job.html_url || runUrl(repo, run.id),
		};
		const art = matchArtifact(job.name, job.attempt, artifacts);
		const found = new Map();
		if (art && !art.expired) {
			const dir = join(tmp, `${run.id}-${art.name}`);
			gh(["run", "download", String(run.id), "-R", repo, "-n", art.name, "-D", dir], { timeout: DOWNLOAD_TIMEOUT });
			for (const file of tapFiles(dir)) {
				for (const f of parseTap(readFileSync(file, "utf8"))) {
					const key = signatureKey(f, run.name);
					if (!found.has(key)) found.set(key, f);
				}
			}
		}
		const note = art ? (art.expired ? "evidence expired" : `${found.size} TAP failure(s) in ${art.name}`) : "no evidence artifact";
		if (!found.size) found.set("job", jobFailure(job));
		console.log(`run ${run.id}: failed job: ${job.name} (attempt ${job.attempt}): ${note}`);
		for (const f of found.values()) failures.push({ failure: f, occurrence });
	}
	if (!failures.length && FAILED_RUN.has(run.conclusion)) {
		console.log(`run ${run.id}: ${run.conclusion} without a failed job`);
		failures.push({
			failure: { ...jobFailure({ name: "(run)", conclusion: run.conclusion, steps: [] }), jobFamily: "(run)", step: `(run ${run.conclusion})` },
			occurrence: { runId: run.id, attempt: run.run_attempt ?? 1, job: "(run)", sha: run.head_sha, event: run.event,
				at: run.updated_at, url: runUrl(repo, run.id) },
		});
	}
	return failures;
}

export async function main(argv = process.argv.slice(2)) {
	const opt = parseArgs(argv);
	const { repo } = opt;
	const run = ghJson(["api", `repos/${repo}/actions/runs/${opt.run}`]);
	const workflow = run.name;
	const head = `run ${run.id} (${workflow}, ${run.event} on ${run.head_branch}, ${short(run.head_sha)}, attempts ${run.run_attempt}, ${run.conclusion})`;
	if (!QA_WORKFLOWS.includes(workflow)) {
		console.log(`${head}: not a QA workflow (${QA_WORKFLOWS.join(", ")}), ignored`);
		return 0;
	}
	const fromMain = run.head_branch === "main" && (run.event === "schedule" || run.event === "workflow_dispatch");
	if (!fromMain && !opt.forceAnyBranch) {
		console.log(`${head}: not a scheduled or dispatched main run, ignored`);
		return 0;
	}
	if (run.status !== "completed") throw new Error(`${head}: status ${run.status}, not completed`);
	console.log(head);

	const issues = ghJson(["issue", "list", "-R", repo, "--label", INBOX_LABEL, "--state", "all", "--limit", "1000",
		"--json", "number,title,body,state,labels"]).map((i) => ({ ...i, labels: i.labels.map((l) => l.name) }));
	const states = issues.map((i) => ({ issue: i, state: decodeState(i.body) })).filter((x) => x.state);

	// Catch-up: GitHub keeps one pending run per concurrency group, so a completion can cancel a pending pass and
	// its run is never read. Every pass reads the failed eligible main runs of all QA workflows of the last 48 h
	// that no inbox issue records (occurrences or earlierRunIds, open or closed). Every read failed run leaves at
	// least one signature, so a caught-up run is not read again.
	const recorded = new Set(states.flatMap(({ state }) => [...state.occurrences.map((o) => o.runId), ...(state.earlierRunIds ?? [])]));
	const now = Date.now();
	const iso = (ms) => new Date(ms).toISOString().replace(/\.\d+Z$/, "Z");
	const recent = ghList(`repos/${repo}/actions/runs`, "workflow_runs", {
		maxPages: 5, fields: ["-f", "branch=main", "-f", "status=completed", "-f", `created=>=${iso(now - CATCH_UP_MS - CATCH_UP_SLACK_MS)}`],
	});
	const missed = recent.filter((r) => r.id !== run.id && QA_WORKFLOWS.includes(r.name) && r.head_branch === "main"
		&& (r.event === "schedule" || r.event === "workflow_dispatch") && FAILED_RUN.has(r.conclusion)
		&& Date.parse(r.updated_at) >= now - CATCH_UP_MS && !recorded.has(r.id)).sort((a, b) => a.id - b.id);
	for (const r of missed) console.log(`catch-up: run ${r.id} (${r.name}, ${r.event}, ${r.conclusion}) is in no inbox issue`);

	// Failures by workflow; the workflow of --run always gets a pass, so its open issues are refreshed.
	const byWorkflow = new Map([[workflow, { workflowId: run.workflow_id, runIds: [], failures: [] }]]);
	const tmp = mkdtempSync(join(tmpdir(), "qa-inbox-"));
	try {
		for (const r of [run, ...missed]) {
			if (!byWorkflow.has(r.name)) byWorkflow.set(r.name, { workflowId: r.workflow_id, runIds: [], failures: [] });
			const w = byWorkflow.get(r.name);
			w.runIds.push(r.id);
			w.failures.push(...runFailures(repo, r, tmp));
		}
	} finally {
		rmSync(tmp, { recursive: true, force: true });
	}

	const git = makeGit(opt.gitRef);
	const actions = [];
	for (const [wf, w] of byWorkflow) {
		// Main runs back to the oldest open episode of this workflow, plus a green one before it for the history hint.
		const openFirst = states.filter(({ issue, state }) => isOpen(issue) && state.workflow === wf).map(({ state }) => state.firstRunId ?? Infinity);
		const cutoff = Math.min(...w.runIds, ...openFirst);
		const runs = ghList(`repos/${repo}/actions/workflows/${w.workflowId}/runs`, "workflow_runs", {
			maxPages: 20, fields: ["-f", "branch=main", "-f", "status=completed"],
			stop: (all) => all.some((r) => r.id < cutoff && r.event === "schedule" && r.conclusion === "success"),
		});
		const planned = applyRun({ repo, workflow: wf, failures: w.failures, issues, runs, git });
		console.log(`${wf}: run(s) ${w.runIds.join(", ")}: ${w.failures.length} failure record(s), `
			+ `${new Set(w.failures.map((f) => signatureKey(f.failure, wf))).size} signature(s); ${runs.length} completed main run(s); `
			+ `${planned.length} action(s)`);
		actions.push(...planned);
	}
	console.log(`${issues.length} inbox issue(s); ${actions.length} action(s)`);
	for (const a of actions) {
		const what = a.op === "create" ? "create" : a.reopen ? `reopen #${a.number}` : a.close ? `close #${a.number}` : `update #${a.number}`;
		console.log(`${opt.dryRun ? "PLAN" : "DO"} ${what}: ${a.title} [${a.labels.join(", ")}] (${a.reason})`);
		if (opt.dryRun) console.log(`----- body -----\n${a.body}\n----- end -----`);
	}
	if (opt.dryRun) {
		console.log("dry run: nothing changed");
		return 0;
	}
	if (actions.length) ensureLabels(repo, [...new Set(actions.flatMap((a) => a.labels))]);
	const tmpIn = mkdtempSync(join(tmpdir(), "qa-inbox-in-"));
	try {
		for (const a of actions) {
			const input = join(tmpIn, "payload.json");
			if (a.op === "create") {
				writeFileSync(input, JSON.stringify({ title: a.title, body: a.body, labels: a.labels }));
				const created = ghJson(["api", "-X", "POST", `repos/${repo}/issues`, "--input", input]);
				console.log(`created #${created.number}`);
			} else {
				const payload = { body: a.body, labels: a.labels, state: a.state };
				if (a.close) payload.state_reason = "completed";
				writeFileSync(input, JSON.stringify(payload));
				ghJson(["api", "-X", "PATCH", `repos/${repo}/issues/${a.number}`, "--input", input]);
				console.log(`${a.reopen ? "reopened" : a.close ? "closed" : "updated"} #${a.number}`);
			}
		}
	} finally {
		rmSync(tmpIn, { recursive: true, force: true });
	}
	return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	main().then((code) => process.exit(code), (e) => {
		console.error(`::error::qa-inbox: ${e.message}`);
		process.exit(1);
	});
}
