import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { after, it } from "node:test";
import { fileURLToPath } from "node:url";
import { buildMail, collect, rfc822 } from "../scripts/qa-digest.mjs";
import { encodeState } from "../scripts/qa-state.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const temps: string[] = [];
after(() => { for (const dir of temps) rmSync(dir, { recursive: true, force: true }); });
const now = new Date();
const at = new Date(now.getTime() - 3600000).toISOString();
const old = new Date(now.getTime() - 48 * 3600000).toISOString();
const since = new Date(now.getTime() - 12 * 3600000).toISOString();
const issue = (overrides = {}) => ({ number: 1, title: "[qa] Кириллица", state: "open", created_at: at, updated_at: at,
	html_url: "https://github.com/ARQAWA/my-pi/issues/1", labels: [{ name: "qa-inbox" }],
	body: encodeState({ signature: "a".repeat(40), lastSeen: at, firstRedSha: "abc123", rate: { k: 1, n: 6 },
		occurrences: [{ runId: 10, job: "Windows", at, url: "https://example.org/run/10" }] }), ...overrides });
const failed = (overrides = {}) => ({ id: 10, path: ".github/workflows/tests.yml", head_branch: "main", event: "schedule",
	conclusion: "failure", updated_at: at, html_url: "https://example.org/run/10", ...overrides });

function setup(data: Record<string, unknown> = {}) {
	const dir = mkdtempSync(join(tmpdir(), "qa-digest-"));
	temps.push(dir);
	const bin = join(dir, "bin");
	mkdirSync(bin);
	const calls = join(dir, "calls.jsonl");
	const fixtures = join(dir, "data.json");
	writeFileSync(fixtures, JSON.stringify(data));
	writeFileSync(calls, "");
	writeFileSync(join(bin, "gh.mjs"), `import {readFileSync,appendFileSync} from 'node:fs';
const args=process.argv.slice(2); appendFileSync(process.env.CALLS, JSON.stringify({program:'gh',args})+'\\n');
if(process.env.GH_FAIL==='1') process.exit(1);
const data=JSON.parse(readFileSync(process.env.FIXTURES,'utf8')); const endpoint=args.at(-1);
if(endpoint.includes('/actions/workflows/qa-digest.yml/runs?') && data.workflowMissing) { console.error('gh: Not Found (HTTP 404)'); process.exit(1); }
const value=endpoint.includes('/actions/workflows/qa-digest.yml/runs?') ? {workflow_runs:data.digests??[]} : endpoint.includes('/events?') ? (data.events??[]) : endpoint.includes('/issues?state=open') ? (data.open??[]) : endpoint.includes('/issues?state=closed') ? (data.closed??[]) : {workflow_runs:(data.runs??[]).filter(r=>endpoint.includes('status='+r.conclusion+'&'))};
process.stdout.write(JSON.stringify([value]));`);
	writeFileSync(join(bin, "curl.mjs"), `import assert from 'node:assert/strict'; import {readFileSync,appendFileSync} from 'node:fs';
const args=process.argv.slice(2); assert(!args.some(a=>a.includes('verysecret'))); assert(args.includes('--config'));
const input=readFileSync(0,'utf8'); assert(input.includes('verysecret')); assert(!input.includes('very secret'));
const file=args[args.indexOf('--upload-file')+1];
appendFileSync(process.env.CALLS,JSON.stringify({program:'curl',args,mail:readFileSync(file,'utf8')})+'\\n');
if(process.env.CURL_FAIL==='1') { console.error('verysecret'); process.exit(1); }`);
	for (const name of ["gh", "curl"]) {
		if (process.platform === "win32") writeFileSync(join(bin, `${name}.cmd`), `@"${process.execPath}" "%~dp0${name}.mjs" %*\r\n`);
		else {
			writeFileSync(join(bin, name), `#!/bin/sh\nexec "${process.execPath}" "${join(bin, `${name}.mjs`)}" "$@"\n`);
			chmodSync(join(bin, name), 0o755);
		}
	}
	const pathKey = Object.keys(process.env).find((key) => key.toUpperCase() === "PATH") ?? "PATH";
	const env = { ...process.env, [pathKey]: bin + delimiter + process.env[pathKey], CALLS: calls, FIXTURES: fixtures,
		QA_SMTP_USER: "sender@example.org", QA_SMTP_PASSWORD: "very secret", QA_MAIL_TO: "owner@example.org", GITHUB_RUN_ID: "999" };
	return {
		run(args: string[] = [], extra = {}) {
			const result = spawnSync(process.execPath, [join(ROOT, "scripts/qa-digest.mjs"), ...args], { env: { ...env, ...extra }, encoding: "utf8", timeout: 15000 });
			return { code: result.status, out: result.stdout + result.stderr };
		},
		calls: () => readFileSync(calls, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)),
	};
}

it("nothing failing needs no secrets and never calls curl", () => {
	const t = setup(); const result = t.run([], { QA_SMTP_USER: "", QA_SMTP_PASSWORD: "", QA_MAIL_TO: "" });
	assert.equal(result.code, 0, result.out); assert.match(result.out, /nothing to send/);
	assert(!t.calls().some((call) => call.program === "curl"));
});
it("new issue sends counted mail, jobs, rate and first bad commit without argv password", () => {
	const t = setup({ open: [issue()], runs: [failed()] }); const result = t.run();
	assert.equal(result.code, 0, result.out);
	const mail = t.calls().find((call) => call.program === "curl").mail;
	const body = Buffer.from(mail.split(/\r?\n\r?\n/)[1], "base64").toString();
	assert.match(body, /1\/6/); assert.match(body, /Windows/); assert.match(body, /abc123/);
	assert.match(Buffer.from(/Subject: =\?UTF-8\?B\?(.+)\?=/.exec(mail)![1], "base64").toString(), /1 падений \(1 новых\)/);
});
it("unmatched failed main runs and broken inbox are listed, branches and push ignored", () => {
	const items = collect({ now, since, runs: [failed(), failed({ id: 11, path: ".github/workflows/qa-inbox.yml", event: "workflow_run" }),
		failed({ id: 12, head_branch: "task" }), failed({ id: 13, event: "push" })] });
	assert.equal(items.length, 2); assert.match(items[1].title, /qa-inbox/); assert.equal(items[0].url, failed().html_url);
});
it("recovered closed issue alone sends no mail", () => {
	const t = setup({ closed: [issue({ state: "closed", closed_at: at })] });
	const result = t.run(); assert.equal(result.code, 0, result.out); assert.match(result.out, /nothing to send/);
	assert(!t.calls().some((call) => call.program === "curl"));
});
it("recurring and reopened issues retain their classification; old open items are separate", () => {
	const recurring = issue({ created_at: old });
	assert.equal(collect({ issues: [recurring], since, now })[0].kind, "recurring");
	assert.equal(collect({ issues: [{ ...recurring, events: [{ event: "reopened", created_at: at }] }], since, now })[0].kind, "regressed");
	assert.equal(collect({ issues: [issue({ created_at: old, body: "" })], since, now }).length, 0);
});
it("RFC822 round trips Cyrillic Subject and body", () => {
	const mail = buildMail({ items: collect({ issues: [issue()], since, now }), otherOpen: [issue({ number: 2 })], now });
	const wire = rfc822(mail, "sender@example.org", "owner@example.org");
	assert.equal(Buffer.from(/Subject: =\?UTF-8\?B\?(.+)\?=/.exec(wire)![1], "base64").toString(), mail.subject);
	assert.equal(Buffer.from(wire.split("\r\n\r\n")[1], "base64").toString(), mail.text);
	assert.match(wire, /Content-Type: text\/plain; charset=utf-8/); assert.match(wire, /Message-ID: </); assert.match(wire, /Date: /);
});
it("dry run and forced test digest never call curl or need secrets", () => {
	for (const data of [{ runs: [failed()] }, {}]) {
		const t = setup(data); const result = t.run(["--dry-run", "--force"], { QA_SMTP_USER: "", QA_SMTP_PASSWORD: "", QA_MAIL_TO: "" });
		assert.equal(result.code, 0, result.out); assert.match(result.out, /Subject: /);
		assert.match(Buffer.from(result.out.split(/\r?\n\r?\n/)[1], "base64").toString(), /Это тестовое письмо/);
		assert(!t.calls().some((call) => call.program === "curl"));
	}
});
it("missing secrets fail with names only", () => {
	const t = setup({ runs: [failed()] }); const result = t.run([], { QA_SMTP_USER: "", QA_SMTP_PASSWORD: " ", QA_MAIL_TO: "" });
	assert.equal(result.code, 1); assert.match(result.out, /QA_SMTP_USER, QA_SMTP_PASSWORD, QA_MAIL_TO/);
	assert(!t.calls().some((call) => call.program === "curl"));
});
it("gh and curl failures are nonzero and never leak their stderr", () => {
	const t = setup({ runs: [failed()] });
	const gh = t.run([], { GH_FAIL: "1" }); assert.equal(gh.code, 1); assert.match(gh.out, /gh failed/);
	const curl = t.run([], { CURL_FAIL: "1" }); assert.equal(curl.code, 1); assert.match(curl.out, /curl failed/); assert.doesNotMatch(curl.out, /verysecret/);
});

const ago = (hours: number) => new Date(now.getTime() - hours * 3600000).toISOString();
const digest = (overrides = {}) => ({ id: 100, event: "schedule", conclusion: "success", run_started_at: ago(16), created_at: ago(17), ...overrides });
const requestedSince = (t: ReturnType<typeof setup>) => {
	const endpoint = t.calls().find((call) => call.program === "gh" && call.args.at(-1).includes("/issues?state=closed")).args.at(-1);
	return new URL(`https://api.github.com/${endpoint}`).searchParams.get("since");
};

it("late scheduled digest closes the gap, ignoring current, manual and failed runs", () => {
	const t = setup({ runs: [failed({ updated_at: ago(13) })], digests: [
		digest({ id: 999, run_started_at: ago(1) }), digest({ id: 101, event: "workflow_dispatch", run_started_at: ago(2) }),
		digest({ id: 102, conclusion: "failure", run_started_at: ago(3) }), digest(), digest({ id: 90, run_started_at: ago(28) }),
	] });
	const result = t.run(["--dry-run"]);
	assert.equal(result.code, 0, result.out); assert.match(result.out, /Subject: /);
	assert.equal(requestedSince(t), ago(16));
	assert(!t.calls().some((call) => call.program === "curl"));
});
it("previous digest falls back to created_at when run_started_at is absent", () => {
	const t = setup({ digests: [digest({ run_started_at: null, created_at: ago(15) })] });
	const result = t.run(["--dry-run"]); assert.equal(result.code, 0, result.out);
	assert.equal(requestedSince(t), ago(15));
});
it("no previous scheduled digest, including a not-yet-created workflow, falls back to 12 hours", () => {
	for (const data of [{}, { workflowMissing: true }]) {
		const t = setup({ ...data, runs: [failed({ updated_at: ago(13) })] });
		const before = Date.now(); const result = t.run(["--dry-run"]); const after = Date.now();
		assert.equal(result.code, 0, result.out); assert.match(result.out, /nothing to send/);
		const start = new Date(requestedSince(t)!).getTime();
		assert(start >= before - 12 * 3600000 && start <= after - 12 * 3600000);
	}
});
it("previous successful digest lookback is capped at 48 hours", () => {
	const t = setup({ digests: [digest({ run_started_at: ago(60) })], runs: [failed({ updated_at: ago(49) }), failed({ id: 11, updated_at: ago(47), html_url: "https://example.org/run/11" })] });
	const before = Date.now(); const result = t.run(["--dry-run"]); const after = Date.now();
	assert.equal(result.code, 0, result.out);
	const start = new Date(requestedSince(t)!).getTime();
	assert(start >= before - 48 * 3600000 && start <= after - 48 * 3600000);
	const body = Buffer.from(result.out.split(/\r?\n\r?\n/)[1], "base64").toString();
	assert.match(body, /run\/11/); assert.doesNotMatch(body, /run\/10/);
	assert.equal((body.match(/tests: failure/g) ?? []).length, 1);
});
it("explicit window-hours overrides the scheduled anchor and the cap", () => {
	const t = setup({ digests: [digest()], runs: [failed({ updated_at: ago(55) })] });
	const before = Date.now(); const result = t.run(["--dry-run", "--window-hours", "60"]); const after = Date.now();
	assert.equal(result.code, 0, result.out); assert.match(result.out, /Subject: /);
	const start = new Date(requestedSince(t)!).getTime();
	assert(start >= before - 60 * 3600000 && start <= after - 60 * 3600000);
	assert(!t.calls().some((call) => call.args.at(-1).includes("/actions/workflows/qa-digest.yml/runs?")));
});
