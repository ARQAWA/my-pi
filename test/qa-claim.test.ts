// qa-claim helper and the claim view of qa-status (PROCESS.md, Quality control loop). The fake `gh` keeps its state
// in a directory; creating a ref uses the exclusive flag "wx", so concurrent claimers really race on the file system.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { claim, release } from "../scripts/qa-claim.mjs";
import { snapshot, render, run } from "../scripts/qa-status.mjs";
import { decodeClaim, encodeClaim, pool } from "../scripts/qa-state.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const temps: string[] = [];
after(() => { for (const p of temps) rmSync(p, { recursive: true, force: true }); });
const HOUR = 3600_000;
const iso = (ms: number) => new Date(ms).toISOString();

const FAKE_GH = `import { appendFileSync, existsSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
const dir = process.env.FAKE_CLAIM_DIR;
const args = process.argv.slice(2);
const method = args[0] === "api" && args[1] === "-X" ? args[2] : "GET";
const endpoint = args.filter((a, i) => i > 0 && a !== "-X" && args[i - 1] !== "-X" && args[i - 1] !== "--input" && a !== "--input")[0].replace(/^repos\\/[^/]+\\/[^/]+\\//, "");
const input = args.includes("--input") ? JSON.parse(readFileSync(args[args.indexOf("--input") + 1], "utf8")) : null;
const read = (f) => JSON.parse(readFileSync(dir + "/" + f, "utf8"));
const out = (v) => console.log(JSON.stringify(v));
const fail = (m) => { console.error(m); process.exit(1); };
const enc = (n) => encodeURIComponent(n);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const call = method + " " + endpoint;
appendFileSync(dir + "/calls.log", Date.now() + " S " + call + "\\n");
if (process.env.FAKE_FAIL && new RegExp(process.env.FAKE_FAIL).test(call)) fail("gh: " + (process.env.FAKE_FAIL_TEXT ?? "Bad credentials (HTTP 401)"));
let m;
if (method === "GET" && (m = endpoint.match(/^issues\\/(\\d+)$/))) {
	const issue = read("issue-" + m[1] + ".json");
	if (process.env.FAKE_DELAY) await sleep(Number(process.env.FAKE_DELAY));
	out(issue);
} else if (method === "GET" && (m = endpoint.match(/^issues\\/(\\d+)\\/comments/))) {
	if (process.env.FAKE_DELAY_COMMENTS) await sleep(Number(process.env.FAKE_DELAY_COMMENTS));
	const all = existsSync(dir + "/comments-" + m[1] + ".json") ? read("comments-" + m[1] + ".json") : [];
	const page = Number((endpoint.match(/[?&]page=(\\d+)/) ?? [])[1] ?? 1);
	out(all.slice((page - 1) * 100, page * 100));
	appendFileSync(dir + "/calls.log", Date.now() + " E " + call + "\\n");
} else if (method === "GET" && endpoint.startsWith("issues?")) {
	out(readdirSync(dir).filter((f) => f.startsWith("issue-")).map((f) => read(f)).filter((i) => i.state === "open"));
} else if (method === "GET" && (m = endpoint.match(/^git\\/ref\\/(.+)$/)) && m[1] !== "heads/main") {
	const f = dir + "/refs/" + enc(m[1]);
	if (!existsSync(f)) fail("gh: Not Found (HTTP 404)");
	const sha = readFileSync(f, "utf8");
	out({ ref: "refs/" + m[1], object: { sha, type: existsSync(dir + "/commits/" + sha + ".json") ? "commit" : "blob" } });
} else if (method === "GET" && endpoint === "git/ref/heads/main") out({ object: { sha: "main1", type: "commit" } });
else if (method === "GET" && (m = endpoint.match(/^git\\/commits\\/(\\w+)$/))) {
	if (!existsSync(dir + "/commits/" + m[1] + ".json")) fail("gh: Unprocessable Entity (HTTP 422)");
	out(read("commits/" + m[1] + ".json"));
} else if (method === "GET" && (m = endpoint.match(/^commits\\?sha=([^&]+)/))) {
	const date = read("branches.json")[decodeURIComponent(m[1])];
	if (!date) fail("gh: Not Found (HTTP 404)");
	out([{ commit: { committer: { date } } }]);
} else if (method === "GET" && endpoint.includes("/runs?")) out({ workflow_runs: [] });
else if (method === "POST" && endpoint === "git/commits") {
	const sha = createHash("sha1").update(input.message + Math.random()).digest("hex");
	writeFileSync(dir + "/commits/" + sha + ".json", JSON.stringify({ sha, message: input.message, tree: { sha: input.tree } }));
	out({ sha });
} else if (method === "POST" && endpoint === "git/refs") {
	try { writeFileSync(dir + "/refs/" + enc(input.ref.replace(/^refs\\//, "")), input.sha, { flag: "wx" }); }
	catch { fail("gh: Reference already exists (HTTP 422)"); }
	out({ ref: input.ref });
} else if (method === "DELETE" && (m = endpoint.match(/^git\\/refs\\/(.+)$/))) {
	const f = dir + "/refs/" + enc(m[1]);
	if (!existsSync(f)) fail("gh: Reference does not exist (HTTP 422)");
	unlinkSync(f);
} else if (method === "POST" && endpoint === "labels") out({});
else if (method === "POST" && (m = endpoint.match(/^issues\\/(\\d+)\\/labels$/))) {
	const issue = read("issue-" + m[1] + ".json");
	for (const l of input.labels) if (!issue.labels.some((x) => x.name === l)) issue.labels.push({ name: l });
	writeFileSync(dir + "/issue-" + m[1] + ".json", JSON.stringify(issue));
	out(issue.labels);
} else if (method === "DELETE" && (m = endpoint.match(/^issues\\/(\\d+)\\/labels\\/(.+)$/))) {
	const issue = read("issue-" + m[1] + ".json");
	const name = decodeURIComponent(m[2]);
	if (!issue.labels.some((x) => x.name === name)) fail("gh: Label does not exist (HTTP 404)");
	issue.labels = issue.labels.filter((x) => x.name !== name);
	writeFileSync(dir + "/issue-" + m[1] + ".json", JSON.stringify(issue));
	out(issue.labels);
} else if (method === "POST" && (m = endpoint.match(/^issues\\/(\\d+)\\/comments$/))) {
	const f = "comments-" + m[1] + ".json";
	const list = existsSync(dir + "/" + f) ? read(f) : [];
	list.push({ body: input.body });
	writeFileSync(dir + "/" + f, JSON.stringify(list));
	out({});
} else fail("fake gh: unsupported " + call);
`;

function setup() {
	const tmp = mkdtempSync(join(tmpdir(), "qa-claim-"));
	temps.push(tmp);
	const bin = join(tmp, "bin"), dir = join(tmp, "state");
	mkdirSync(bin); mkdirSync(join(dir, "refs"), { recursive: true }); mkdirSync(join(dir, "commits"));
	writeFileSync(join(bin, "gh.mjs"), FAKE_GH);
	if (process.platform === "win32") writeFileSync(join(bin, "gh.cmd"), `@"${process.execPath}" "%~dp0gh.mjs" %*\r\n`);
	else { writeFileSync(join(bin, "gh"), `#!/bin/sh\nexec "${process.execPath}" "${join(bin, "gh.mjs")}" "$@"\n`); chmodSync(join(bin, "gh"), 0o755); }
	const config = join(tmp, "gitconfig");
	writeFileSync(config, "[user]\n name = t\n email = t@example.com\n[commit]\n gpgsign = false\n");
	const pathKey = Object.keys(process.env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
	const env: Record<string, string | undefined> = { ...process.env, [pathKey]: bin + delimiter + process.env[pathKey], GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: config,
		FAKE_CLAIM_DIR: dir };
	const git = (...a: string[]) => execFileSync("git", a, { cwd: tmp, env, encoding: "utf8" }).trim();
	git("init", "--quiet", "-b", "main"); git("commit", "--quiet", "--allow-empty", "-m", "base");
	git("remote", "add", "origin", "git@github.com:example/project.git");
	writeFileSync(join(dir, "commits", "main1.json"), JSON.stringify({ sha: "main1", message: "main", tree: { sha: "tree1" } }));
	writeFileSync(join(dir, "branches.json"), "{}");
	const runEnv = (cmd: string, a: string[], o: object) => run(cmd, a, { ...o, env });
	const issue = (number: number, extra: any = {}) => writeFileSync(join(dir, `issue-${number}.json`), JSON.stringify({
		number, title: `[qa] failure ${number}`, state: "open", html_url: `https://github.com/example/project/issues/${number}`,
		labels: [{ name: "qa-inbox" }], body: "", updated_at: "2026-10-23T00:00:00Z", ...extra }));
	const branches = (b: Record<string, string>) => writeFileSync(join(dir, "branches.json"), JSON.stringify(b));
	const labelsOf = (n: number) => JSON.parse(readFileSync(join(dir, `issue-${n}.json`), "utf8")).labels.map((l: any) => l.name);
	const setLabels = (n: number, names: string[]) => issue(n, { labels: names.map((name) => ({ name })) });
	const comments = (n: number): string[] => existsSync(join(dir, `comments-${n}.json`)) ? JSON.parse(readFileSync(join(dir, `comments-${n}.json`), "utf8")).map((c: any) => c.body) : [];
	const refPath = (n: number) => join(dir, "refs", encodeURIComponent(`qa-claims/${n}`));
	// Seeds an existing claim the way the helper writes it; each part can be left out.
	const seedClaim = (number: number, branch: string, at: string, parts: { label?: boolean; comment?: boolean; ref?: boolean } = {}) => {
		const { label = true, comment = true, ref = true } = parts;
		issue(number, { labels: [{ name: "qa-inbox" }, ...(label ? [{ name: "qa:claimed" }] : [])] });
		if (comment) writeFileSync(join(dir, `comments-${number}.json`), JSON.stringify([{ body: "unrelated triage note" },
			{ body: `QA claim.\n\n<!-- ${encodeClaim({ number, branch, at })} -->` }]));
		if (ref) {
			const sha = `claim${number}`;
			writeFileSync(join(dir, "commits", `${sha}.json`), JSON.stringify({ sha, tree: { sha: "tree1" }, message: `qa-claim #${number} ${branch}\n\n${encodeClaim({ number, branch, at })}\n` }));
			writeFileSync(refPath(number), sha);
		}
	};
	const doClaim = (number: number, branch: string, now = Date.now()) => claim({ number, branch, repo: "example/project", cwd: tmp, run: runEnv, now: () => now });
	const status = () => snapshot({ cwd: tmp, run: runEnv });
	return { tmp, dir, env, issue, branches, seedClaim, labelsOf, setLabels, comments, refPath, doClaim, status };
}

describe("qa-claim helper", () => {
	it("claims an unclaimed issue: lock ref, label and a machine-readable comment with branch and UTC time", async () => {
		const t = setup();
		t.issue(3);
		const now = Date.parse("2026-10-23T12:00:00Z");
		const r = await t.doClaim(3, "bg-port-flake", now);
		assert.equal(r.claimed, true);
		assert.ok(existsSync(t.refPath(3)));
		assert.deepEqual(t.labelsOf(3), ["qa-inbox", "qa:claimed"]);
		const [comment] = t.comments(3);
		assert.deepEqual(decodeClaim(comment), { number: 3, branch: "bg-port-flake", at: "2026-10-23T12:00:00.000Z" });
		// The claim commit carries the same record.
		const sha = readFileSync(t.refPath(3), "utf8");
		assert.deepEqual(decodeClaim(JSON.parse(readFileSync(join(t.dir, "commits", `${sha}.json`), "utf8")).message), decodeClaim(comment));
	});

	it("an existing qa:claimed label always blocks: other branch, same branch and a stale claim; nothing is written", async () => {
		const t = setup();
		const now = Date.parse("2026-10-24T12:00:00Z");
		t.seedClaim(3, "bg-port-flake", iso(now - HOUR));
		t.branches({ "bg-port-flake": iso(now - HOUR) });
		const before = readdirSync(join(t.dir, "commits")).length;
		for (const branch of ["other-branch", "bg-port-flake"]) {
			const r = await t.doClaim(3, branch, now);
			assert.equal(r.claimed, false);
			assert.match(r.why, /already claimed by branch bg-port-flake since 2026-10-24T11:00:00/);
		}
		const later = await t.doClaim(3, "bg-port-flake", now + 30 * HOUR);
		assert.equal(later.claimed, false);
		assert.match(later.why, /already claimed by branch bg-port-flake .*; stale, no commit since 2026-10-24T11:00:00/);
		assert.equal(readdirSync(join(t.dir, "commits")).length, before, "no claim commit was created");
		assert.equal(t.comments(3).length, 2);
	});

	it("a label without any record still blocks and invents no branch or time", async () => {
		const t = setup();
		t.seedClaim(6, "x", iso(Date.now()), { comment: false, ref: false });
		const r = await t.doClaim(6, "y");
		assert.equal(r.claimed, false);
		assert.equal(r.why, "already claimed, branch and time unknown (no readable claim record)");
	});

	it("concurrent helpers: exactly one wins the create-only ref, the others lose the race", async () => {
		const t = setup();
		t.issue(3);
		t.env.FAKE_DELAY = "400"; // every helper reads the unclaimed issue before any ref is created
		const now = Date.now();
		const results = await Promise.all(["a", "b", "c"].map((b) => t.doClaim(3, b, now)));
		assert.equal(results.filter((r: any) => r.claimed).length, 1);
		assert.equal(results.filter((r: any) => !r.claimed && /lost the race/.test(r.why)).length, 2);
		assert.equal(t.comments(3).length, 1);
		assert.deepEqual(t.labelsOf(3), ["qa-inbox", "qa:claimed"]);
		delete t.env.FAKE_DELAY;
	});

	it("a lock ref without the label (half written claim) blocks and says so", async () => {
		const t = setup();
		t.seedClaim(3, "bg-port-flake", iso(Date.now()), { label: false, comment: false });
		const r = await t.doClaim(3, "other");
		assert.equal(r.claimed, false);
		assert.match(r.why, /lost the race or the claim is half written: claimed by branch bg-port-flake/);
	});

	it("refuses a closed issue and a non-inbox issue, rejects bad input, and reports real gh failures", async () => {
		const t = setup();
		t.issue(4, { state: "closed" });
		t.issue(5, { labels: [] });
		await assert.rejects(t.doClaim(4, "x"), /not an open qa-inbox issue/);
		await assert.rejects(t.doClaim(5, "x"), /not an open qa-inbox issue/);
		await assert.rejects(t.doClaim(5, "bad branch;rm"), /bad branch name/);
		await assert.rejects(t.doClaim(0, "x"), /positive integer/);
		t.issue(7);
		t.env.FAKE_FAIL = "^GET git/ref/heads/main";
		await assert.rejects(t.doClaim(7, "x"), /HTTP 401/);
		delete t.env.FAKE_FAIL;
	});

	it("a failing comment is a warning: the lock and the label stand", async () => {
		const t = setup();
		t.issue(3);
		t.env.FAKE_FAIL = "^POST issues/3/comments"; t.env.FAKE_FAIL_TEXT = "Server Error (HTTP 500)";
		const r = await t.doClaim(3, "b");
		assert.equal(r.claimed, true);
		assert.deepEqual(t.labelsOf(3), ["qa-inbox", "qa:claimed"]);
		assert.ok(existsSync(t.refPath(3)));
		delete t.env.FAKE_FAIL; delete t.env.FAKE_FAIL_TEXT;
		// The status falls back to the record in the claim commit.
		const item = (await t.status()).items.find((i: any) => i.text.startsWith("#3"));
		assert.match(item.text, /claimed, in progress: branch b since/);
	});

	it("a failing label write rolls the lock ref back and says so; a retry then works", async () => {
		const t = setup();
		t.issue(3);
		t.env.FAKE_FAIL = "^POST issues/3/labels"; t.env.FAKE_FAIL_TEXT = "Server Error (HTTP 500)";
		await assert.rejects(t.doClaim(3, "b"), /setting the qa:claimed label failed.*HTTP 500.*lock ref was removed again, nothing is claimed/);
		assert.ok(!existsSync(t.refPath(3)));
		assert.deepEqual(t.labelsOf(3), ["qa-inbox"]);
		delete t.env.FAKE_FAIL; delete t.env.FAKE_FAIL_TEXT;
		assert.equal((await t.doClaim(3, "b")).claimed, true);
	});

	it("a failing label write whose rollback fails reports the remaining lock and the release command", async () => {
		const t = setup();
		t.issue(3);
		t.env.FAKE_FAIL = "^(POST issues/3/labels|DELETE git/refs)"; t.env.FAKE_FAIL_TEXT = "Server Error (HTTP 500)";
		await assert.rejects(t.doClaim(3, "b"), /label failed.*could NOT be removed.*still blocks claims: run npm run qa-claim -- --release 3/);
		assert.ok(existsSync(t.refPath(3)));
		delete t.env.FAKE_FAIL; delete t.env.FAKE_FAIL_TEXT;
		const retry = await t.doClaim(3, "b");
		assert.equal(retry.claimed, false);
		assert.match(retry.why, /half written/);
		await release({ number: 3, repo: "example/project", cwd: t.tmp, run: (c: string, a: string[], o: object) => run(c, a, { ...o, env: t.env }) });
		assert.equal((await t.doClaim(3, "b")).claimed, true);
	});

	it("release frees the ref and the label; the issue can be claimed again; a missing part is fine", async () => {
		const t = setup();
		t.seedClaim(3, "old", iso(Date.now() - 40 * HOUR));
		const r = await release({ number: 3, repo: "example/project", cwd: t.tmp, run: (c: string, a: string[], o: object) => run(c, a, { ...o, env: t.env }) });
		assert.equal(r.released, true);
		assert.ok(!existsSync(t.refPath(3)));
		assert.deepEqual(t.labelsOf(3), ["qa-inbox"]);
		await release({ number: 3, repo: "example/project", cwd: t.tmp, run: (c: string, a: string[], o: object) => run(c, a, { ...o, env: t.env }) });
		assert.equal((await t.doClaim(3, "new")).claimed, true);
	});

	it("the CLI exits 0 when claimed, 3 when already claimed, 1 on error; --release works", () => {
		const t = setup();
		t.issue(3);
		const cli = (...a: string[]) => spawnSync(process.execPath, [join(ROOT, "scripts/qa-claim.mjs"), ...a], { cwd: t.tmp, env: t.env as any, encoding: "utf8", timeout: 30_000 });
		const first = cli("3", "bg-port-flake");
		assert.equal(first.status, 0, first.stderr);
		assert.match(first.stdout, /^CLAIMED claimed #3 for branch bg-port-flake/m);
		const second = cli("3", "bg-port-flake");
		assert.equal(second.status, 3, second.stderr);
		assert.match(second.stdout, /NOT CLAIMED already claimed by branch bg-port-flake.*report to the coordinator/);
		assert.equal(cli("99", "x").status, 1);
		assert.equal(cli("3").status, 1);
		assert.equal(cli("--release", "3").status, 0);
		assert.equal(cli("3", "other").status, 0);
	});
});

describe("qa-status claim view", () => {
	it("unclaimed is red; a fresh claim is in progress with its branch and not red", async () => {
		const t = setup();
		t.issue(2);
		t.seedClaim(3, "bg-port-flake", iso(Date.now() - 2 * HOUR));
		const state = await t.status();
		assert.equal(state.ok, true, render(state));
		const two = state.items.find((i: any) => i.id.startsWith("issue:2:"));
		const three = state.items.find((i: any) => i.id === "claim:3:bg-port-flake");
		assert.equal(two.level, "red");
		assert.equal(three.level, "pending");
		assert.match(three.text, /claimed, in progress: branch bg-port-flake since/);
		assert.ok(!state.items.some((i: any) => i.id.startsWith("issue:3:")));
	});

	it("a claim without a commit on its branch for 24 hours is red (stale), a commit keeps it in progress", async () => {
		const t = setup();
		t.seedClaim(3, "bg-port-flake", iso(Date.now() - 30 * HOUR));
		t.branches({ "bg-port-flake": iso(Date.now() - 25 * HOUR) });
		let state = await t.status();
		let item = state.items.find((i: any) => i.text.startsWith("#3"));
		assert.equal(item.level, "red");
		assert.match(item.id, /:stale-claim$/);
		assert.match(item.text, /stale claim: branch bg-port-flake .*no commit since .*report to the coordinator/);
		t.branches({ "bg-port-flake": iso(Date.now() - 3 * HOUR) });
		state = await t.status();
		item = state.items.find((i: any) => i.text.startsWith("#3"));
		assert.equal(item.level, "pending");
	});

	it("a label with no ref and no comment is a claim in progress with unknown branch, no invented time", async () => {
		const t = setup();
		t.seedClaim(6, "x", iso(Date.now()), { comment: false, ref: false });
		const item = (await t.status()).items.find((i: any) => i.text.startsWith("#6"));
		assert.equal(item.level, "pending");
		assert.equal(item.id, "claim:6:unknown");
		assert.match(item.text, /claimed, in progress: branch and time unknown/);
		assert.doesNotMatch(item.text, /since/);
	});

	it("after release and reclaim the status shows the new branch and time, not the old comment or a stale claim", async () => {
		const t = setup();
		t.seedClaim(3, "old-branch", iso(Date.now() - 40 * HOUR));
		t.branches({ "old-branch": iso(Date.now() - 39 * HOUR) });
		assert.match((await t.status()).items.find((i: any) => i.text.startsWith("#3")).id, /stale-claim$/);
		await release({ number: 3, repo: "example/project", cwd: t.tmp, run: (c: string, a: string[], o: object) => run(c, a, { ...o, env: t.env }) });
		const now = Date.now();
		assert.equal((await t.doClaim(3, "new-branch", now)).claimed, true);
		assert.equal(t.comments(3).length, 3, "the old claim comment stays in the issue");
		const item = (await t.status()).items.find((i: any) => i.text.startsWith("#3"));
		assert.equal(item.level, "pending");
		assert.equal(item.id, "claim:3:new-branch");
		assert.match(item.text, new RegExp(`branch new-branch since ${iso(now)}`));
		assert.doesNotMatch(item.text, /old-branch/);
	});

	it("without a readable ref the newest valid claim comment wins, also from a later comment page", async () => {
		const t = setup();
		const rec = (branch: string, at: string) => ({ body: `QA claim\n\n<!-- ${encodeClaim({ number: 3, branch, at })} -->` });
		t.seedClaim(3, "x", iso(Date.now()), { comment: false, ref: false });
		const filler = Array.from({ length: 120 }, (_, i) => ({ body: `note ${i}` }));
		const at = iso(Date.now() - HOUR);
		writeFileSync(join(t.dir, "comments-3.json"), JSON.stringify([rec("older", iso(Date.now() - 50 * HOUR)), ...filler, rec("newest", at), { body: "later note" }]));
		const item = (await t.status()).items.find((i: any) => i.text.startsWith("#3"));
		assert.match(item.text, new RegExp(`branch newest since ${at}`));
	});

	it("a label with only the comment, or only the claim commit, still shows branch and time", async () => {
		const t = setup();
		const at = iso(Date.now() - HOUR);
		t.seedClaim(3, "from-comment", at, { ref: false });
		t.seedClaim(4, "from-commit", at, { comment: false });
		const items = (await t.status()).items;
		assert.match(items.find((i: any) => i.text.startsWith("#3")).text, new RegExp(`branch from-comment since ${at}`));
		assert.match(items.find((i: any) => i.text.startsWith("#4")).text, new RegExp(`branch from-commit since ${at}`));
	});

	it("a recurrence on a claimed issue keeps the claim and its id, so it is not a new red item", async () => {
		const t = setup();
		t.seedClaim(3, "bg-port-flake", iso(Date.now() - HOUR));
		const before = (await t.status()).items.find((i: any) => i.id.startsWith("claim:3"));
		const labels = JSON.parse(readFileSync(join(t.dir, "issue-3.json"), "utf8")).labels;
		t.issue(3, { labels: [...labels, { name: "qa:persistent" }], updated_at: "2026-10-23T05:00:00Z" });
		const after = (await t.status()).items.find((i: any) => i.id.startsWith("claim:3"));
		assert.equal(after.id, before.id);
		assert.equal(after.level, "pending");
	});

	it("a lost label with the lock ref still shows the claim; no label and no ref is unclaimed red", async () => {
		const t = setup();
		t.seedClaim(3, "bg-port-flake", iso(Date.now() - HOUR), { label: false });
		t.issue(5);
		const state = await t.status();
		assert.equal(state.items.find((i: any) => i.id === "claim:3:bg-port-flake").level, "pending");
		assert.equal(state.items.find((i: any) => i.id.startsWith("issue:5:")).level, "red");
	});

	it("a malformed claim ref (not a commit, missing commit) does not break the status", async () => {
		const t = setup();
		t.seedClaim(3, "x", iso(Date.now()), { comment: false, ref: false });
		writeFileSync(t.refPath(3), "deadbeef"); // points at no object: the commit read answers 422
		t.seedClaim(4, "x", iso(Date.now()), { label: false, comment: false, ref: false });
		writeFileSync(t.refPath(4), "cafe"); // lock ref only, no label, malformed target
		const state = await t.status();
		assert.equal(state.ok, true, render(state));
		for (const n of [3, 4]) assert.equal(state.items.find((i: any) => i.text.startsWith(`#${n}`)).level, "pending");
	});

	it("a real gh failure (auth, network) makes the status unavailable instead of hiding it", async () => {
		const t = setup();
		t.seedClaim(3, "x", iso(Date.now()));
		for (const failing of ["^GET git/ref/qa-claims/3", "^GET git/commits/claim3"]) {
			t.env.FAKE_FAIL = failing;
			const state = await t.status();
			assert.equal(state.ok, false, failing);
			assert.match(render(state), /QA status unavailable:.*HTTP 401/);
		}
		// The comment read is a fallback and fails the same way.
		t.seedClaim(4, "x", iso(Date.now()), { ref: false });
		t.env.FAKE_FAIL = "^GET issues/4/comments";
		assert.equal((await t.status()).ok, false);
		delete t.env.FAKE_FAIL;
	});

	it("reads claimed issues through a small pool and has no growing global ref list", async () => {
		const t = setup();
		for (let n = 10; n < 22; n++) t.seedClaim(n, `branch-${n}`, iso(Date.now() - HOUR), { ref: false }); // read through the comment fallback
		for (let n = 100; n < 260; n++) writeFileSync(t.refPath(n), "old"); // historic refs of closed issues
		t.env.FAKE_DELAY_COMMENTS = "250";
		const state = await t.status();
		delete t.env.FAKE_DELAY_COMMENTS;
		assert.equal(state.ok, true, render(state));
		assert.equal(state.items.filter((i: any) => i.id.startsWith("claim:")).length, 12);
		// Reads of comments overlap at most four at a time (S and E lines of calls.log).
		let open = 0, peak = 0;
		for (const line of readFileSync(join(t.dir, "calls.log"), "utf8").trim().split("\n")) {
			if (!/ issues\/\d+\/comments/.test(line)) continue;
			open += / S /.test(line) ? 1 : -1;
			peak = Math.max(peak, open);
		}
		assert.ok(peak >= 2 && peak <= 4, `peak ${peak}`);
	});

	it("pool keeps result order and never exceeds its limit", async () => {
		let open = 0, peak = 0;
		const out = await pool([1, 2, 3, 4, 5, 6, 7], 3, async (n: number) => {
			peak = Math.max(peak, ++open);
			await new Promise((r) => setTimeout(r, 5));
			open--;
			return n * 2;
		});
		assert.deepEqual(out, [2, 4, 6, 8, 10, 12, 14]);
		assert.equal(peak, 3);
	});
});
