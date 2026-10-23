import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { decodeState, INBOX_LABEL, QA_WORKFLOWS } from "./qa-state.mjs";

const FAILED = new Set(["failure", "timed_out", "startup_failure"]);
const timestamp = (value) => new Date(value ?? 0).getTime();
const labels = (issue) => (issue.labels ?? []).map((label) => typeof label === "string" ? label : label.name);

// Inputs use GitHub REST fields; issue.events contains the issue's lifecycle events.
export function collect({ issues = [], runs = [], since, now }) {
	const end = timestamp(now);
	const start = timestamp(since);
	const inside = (at) => timestamp(at) >= start && timestamp(at) <= end;
	const items = [];
	const covered = new Set();
	for (const issue of issues) {
		if (issue.state !== "open") continue;
		const state = decodeState(issue.body);
		const reopened = (issue.events ?? []).some((event) => event.event === "reopened" && inside(event.created_at));
		if (!inside(issue.created_at) && !inside(state?.lastSeen) && !reopened &&
			!(state?.occurrences ?? []).some((occurrence) => inside(occurrence.at))) continue;
		const occurrences = state?.occurrences ?? [];
		for (const occurrence of occurrences) covered.add(String(occurrence.runId));
		const last = occurrences.at(-1);
		items.push({
			id: `issue:${issue.number}`, title: issue.title, url: issue.html_url,
			kind: reopened || labels(issue).includes("qa:regressed") ? "regressed" : inside(issue.created_at) ? "new" : "recurring",
			rate: state?.rate, jobs: [...new Set(occurrences.map((occurrence) => occurrence.job))],
			firstBad: state?.firstRedSha, lastRun: last?.url,
		});
	}
	for (const run of runs) {
		if (!FAILED.has(run.conclusion) || !inside(run.updated_at)) continue;
		const workflow = (run.path ?? "").split("/").at(-1)?.replace(/\.ya?ml$/, "");
		const inbox = workflow === "qa-inbox";
		if (!inbox && (run.head_branch !== "main" || !["schedule", "workflow_dispatch"].includes(run.event) ||
			!QA_WORKFLOWS.includes(workflow))) continue;
		if (!inbox && covered.has(String(run.id))) continue;
		if (items.some((item) => item.id === `run:${run.id}`)) continue;
		items.push({ id: `run:${run.id}`, title: inbox ? "Не работает сборщик qa-inbox" : `${workflow}: ${run.conclusion}`,
			url: run.html_url, kind: "new", jobs: [], lastRun: run.html_url });
	}
	return items;
}

export function buildMail({ items, otherOpen = [], now }) {
	const names = { new: "новое", recurring: "повторное", regressed: "вернулось" };
	const lines = [`Падения QA за последние часы. На ${new Date(now).toISOString()}.`, ""];
	for (const item of items) {
		lines.push(`${item.title}: ${names[item.kind]}`, item.url);
		if (item.rate) lines.push(`Частота: ${item.rate.k}/${item.rate.n}.`);
		if (item.jobs?.length) lines.push(`Задания: ${item.jobs.join(", ")}.`);
		if (item.firstBad) lines.push(`Первый плохой коммит: ${item.firstBad}.`);
		if (item.lastRun) lines.push(`Последний запуск: ${item.lastRun}`);
		lines.push("");
	}
	if (otherOpen.length) {
		lines.push("Другие открытые падения:");
		for (const issue of otherOpen) lines.push(`${issue.title}: ${issue.html_url}`);
	}
	return { subject: `my-pi QA: ${items.length} падений (${items.filter((item) => item.kind === "new").length} новых)`, text: lines.join("\n") };
}

export function rfc822(mail, from, to) {
	for (const value of [from, to]) if (/[\r\n]/.test(value)) throw new Error("Invalid mail address header");
	const id = createHash("sha256").update(JSON.stringify([mail, from, to])).digest("hex").slice(0, 32);
	const body = Buffer.from(mail.text, "utf8").toString("base64").match(/.{1,76}/g)?.join("\r\n") ?? "";
	return [`From: ${from}`, `To: ${to}`, `Subject: =?UTF-8?B?${Buffer.from(mail.subject).toString("base64")}?=`,
		`Date: ${new Date().toUTCString()}`, `Message-ID: <${id}@my-pi.qa>`, "MIME-Version: 1.0",
		"Content-Type: text/plain; charset=utf-8", "Content-Transfer-Encoding: base64", "", body, ""].join("\r\n");
}

function command(program, args, options = {}) {
	const { allowNotFound = false, ...spawnOptions } = options;
	// Windows resolves the fake test shims and installed gh.cmd through cmd.exe.
	const argv = process.platform === "win32" ? args.map((arg) => `"${arg.replace(/"/g, '""')}"`) : args;
	const result = spawnSync(program, argv, { encoding: "utf8", timeout: 30000, maxBuffer: 32 * 1024 * 1024,
		...spawnOptions, ...(process.platform === "win32" ? { shell: true } : {}) });
	// Before the new workflow reaches main GitHub has no workflow ID or previous run.
	if (allowNotFound && !result.error && result.status !== 0 && /HTTP 404/.test(result.stderr)) return "[]";
	if (result.error || result.status !== 0) throw new Error(`${program} failed${result.error?.code ? ` (${result.error.code})` : ` (exit ${result.status})`}`);
	return result.stdout;
}

function gh(endpoint, options = {}) {
	try {
		const pages = JSON.parse(command("gh", ["api", "--paginate", "--slurp", endpoint], options));
		return pages.flatMap((page) => Array.isArray(page) ? page : page.workflow_runs ?? []);
	} catch (error) { throw new Error(`Cannot read QA data: ${error.message}`); }
}

export function main(args = process.argv.slice(2)) {
	let repo = "ARQAWA/my-pi", hours, dry = false, force = false;
	for (let i = 0; i < args.length; i++) {
		if (args[i] === "--repo") repo = args[++i];
		else if (args[i] === "--window-hours") hours = Number(args[++i]);
		else if (args[i] === "--dry-run") dry = true;
		else if (args[i] === "--force") force = true;
		else throw new Error(`Unknown argument: ${args[i]}`);
	}
	if (!/^[\w.-]+\/[\w.-]+$/.test(repo ?? "") || (hours !== undefined && (!Number.isFinite(hours) || hours <= 0))) throw new Error("Invalid repo or window-hours");
	const now = new Date();
	const base = `repos/${repo}`;
	const open = gh(`${base}/issues?state=open&labels=${INBOX_LABEL}&per_page=100`);
	let start = now.getTime() - (hours ?? 12) * 3600000;
	if (hours === undefined) {
		const previous = gh(`${base}/actions/workflows/qa-digest.yml/runs?event=schedule&status=success&per_page=100`, { allowNotFound: true })
			.filter((run) => run.event === "schedule" && run.conclusion === "success" && String(run.id) !== process.env.GITHUB_RUN_ID)
			.map((run) => timestamp(run.run_started_at ?? run.created_at))
			.filter((at) => Number.isFinite(at) && at <= now.getTime())
			.sort((a, b) => b - a)[0];
		// Anchor to the last delivered scheduled digest, not a fixed cadence: schedules can start late.
		if (previous !== undefined) start = Math.max(previous, now.getTime() - 48 * 3600000);
	}
	const since = new Date(start).toISOString();
	const closed = gh(`${base}/issues?state=closed&labels=${INBOX_LABEL}&since=${since}&per_page=100`);
	for (const issue of open) {
		if (timestamp(issue.updated_at) >= timestamp(since)) issue.events = gh(`${base}/issues/${issue.number}/events?per_page=100`);
	}
	// Query all failed runs, not just runs created in the window: a long run may finish inside it.
	const runs = [...FAILED].flatMap((status) => gh(`${base}/actions/runs?status=${status}&per_page=100`));
	const items = collect({ issues: [...open, ...closed], runs, since, now });
	if (!items.length && !force) { console.log("nothing to send"); return; }
	const otherOpen = open.filter((issue) => !items.some((item) => item.id === `issue:${issue.number}`));
	const mail = buildMail({ items, otherOpen, now });
	if (force) mail.text = `Это тестовое письмо QA.\n\n${mail.text}`;
	if (dry) { console.log(rfc822(mail, "qa-dry-run@example.invalid", "owner@example.invalid")); return; }
	const missing = ["QA_SMTP_USER", "QA_SMTP_PASSWORD", "QA_MAIL_TO"].filter((name) => !process.env[name]?.trim() ||
		(name === "QA_SMTP_PASSWORD" && !process.env[name].replace(/\s/g, "")));
	if (missing.length) throw new Error(`Missing secrets: ${missing.join(", ")}`);
	const dir = mkdtempSync(join(tmpdir(), "qa-mail-"));
	try {
		const file = join(dir, "mail.eml");
		writeFileSync(file, rfc822(mail, process.env.QA_SMTP_USER, process.env.QA_MAIL_TO), { mode: 0o600 });
		const escape = (value) => value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r/g, "\\r").replace(/\n/g, "\\n");
		const auth = `${process.env.QA_SMTP_USER}:${process.env.QA_SMTP_PASSWORD.replace(/\s/g, "")}`;
		command("curl", ["--config", "-", "--silent", "--show-error", "--connect-timeout", "15", "--max-time", "25",
			"--ssl-reqd", "--url", "smtps://smtp.gmail.com:465", "--mail-from", process.env.QA_SMTP_USER,
			"--mail-rcpt", process.env.QA_MAIL_TO, "--upload-file", file], { input: `user = "${escape(auth)}"\n` });
		console.log("QA digest sent");
	} finally { rmSync(dir, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	try { main(); } catch (error) { console.error(`qa-digest: ${error.message}`); process.exitCode = 1; }
}
