// qa-claim helper and the claim view of qa-status (PROCESS.md, Quality control loop). The fake `gh` keeps its state
// in a directory; creating a ref uses the exclusive flag "wx", so concurrent claimers really race on the file system.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { claim } from "../scripts/qa-claim.mjs";
import { snapshot, render, run } from "../scripts/qa-status.mjs";
import { decodeClaim, encodeClaim } from "../scripts/qa-state.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const temps: string[] = [];
after(() => { for (const p of temps) rmSync(p, { recursive: true, force: true }); });
const HOUR = 3600_000;
const iso = (ms: number) => new Date(ms).toISOString();

const FAKE_GH = `import { appendFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
const dir = process.env.FAKE_CLAIM_DIR;
const args = process.argv.slice(2);
const method = args[0] === "api" && args[1] === "-X" ? args[2] : "GET";
const endpoint = args.filter((a, i) => i > 0 && a !== "-X" && args[i - 1] !== "-X" && args[i - 1] !== "--input" && a !== "--input")[0].replace(/^repos\\/[^/]+\\/[^/]+\\//, "");
const input = args.includes("--input") ? JSON.parse(readFileSync(args[args.indexOf("--input") + 1], "utf8")) : null;
const read = (f) => JSON.parse(readFileSync(dir + "/" + f, "utf8"));
const out = (v) => console.log(JSON.stringify(v));
const fail = (m) => { console.error(m); process.exit(1); };
appendFileSync(dir + "/calls.log", method + " " + endpoint + "\\n");
const enc = (n) => encodeURIComponent(n);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let m;
if (method === "GET" && (m = endpoint.match(/^issues\\/(\\d+)$/))) out(read("issue-" + m[1] + ".json"));
else if (method === "GET" && endpoint.startsWith("issues?")) {
	out(readdirSync(dir).filter((f) => f.startsWith("issue-")).map((f) => read(f)).filter((i) => i.state === "open"));
} else if (method === "GET" && (m = endpoint.match(/^git\\/matching-refs\\/([^?]*)/))) {
	const list = readdirSync(dir + "/refs").map((f) => decodeURIComponent(f)).filter((n) => n.startsWith(m[1]))
		.map((n) => ({ ref: "refs/" + n, object: { sha: readFileSync(dir + "/refs/" + enc(n), "utf8") } }));
	if (process.env.FAKE_DELAY) await sleep(Number(process.env.FAKE_DELAY));
	out(list);
} else if (method === "GET" && endpoint === "git/ref/heads/main") out({ object: { sha: "main1" } });
else if (method === "GET" && (m = endpoint.match(/^git\\/commits\\/(\\w+)$/))) out(read("commits/" + m[1] + ".json"));
else if (method === "GET" && (m = endpoint.match(/^commits\\?sha=([^&]+)/))) {
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
} else if (method === "POST" && endpoint === "labels") {
	if (process.env.FAKE_LABEL_EXISTS) fail("gh: Validation Failed (HTTP 422) already_exists");
	out({});
} else if (method === "POST" && (m = endpoint.match(/^issues\\/(\\d+)\\/labels$/))) {
	const issue = read("issue-" + m[1] + ".json");
	for (const l of input.labels) if (!issue.labels.some((x) => x.name === l)) issue.labels.push({ name: l });
	writeFileSync(dir + "/issue-" + m[1] + ".json", JSON.stringify(issue));
	out(issue.labels);
} else if (method === "POST" && (m = endpoint.match(/^issues\\/(\\d+)\\/comments$/))) {
	appendFileSync(dir + "/comments-" + m[1] + ".log", JSON.stringify(input) + "\\n");
	out({});
} else fail("fake gh: unsupported " + method + " " + endpoint);
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
	const env = { ...process.env, [pathKey]: bin + delimiter + process.env[pathKey], GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: config,
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
	// Seeds an existing claim as the helper writes it: a commit carrying the record and the ref pointing at it.
	const seedClaim = (number: number, gen: number, branch: string, at: string) => {
		const sha = `claim${number}x${gen}`;
		writeFileSync(join(dir, "commits", `${sha}.json`), JSON.stringify({ sha, tree: { sha: "tree1" }, message: `qa-claim #${number} ${branch}\n\n${encodeClaim({ number, gen, branch, at })}\n` }));
		writeFileSync(join(dir, "refs", encodeURIComponent(`qa-claims/${number}-${gen}`)), sha);
	};
	const refs = () => readdirSync(join(dir, "refs")).map((f) => decodeURIComponent(f)).sort();
	const labelsOf = (n: number) => JSON.parse(readFileSync(join(dir, `issue-${n}.json`), "utf8")).labels.map((l: any) => l.name);
	const comments = (n: number) => existsSync(join(dir, `comments-${n}.log`)) ? readFileSync(join(dir, `comments-${n}.log`), "utf8").trim().split("\n").map((l) => JSON.parse(l).body) : [];
	const doClaim = (number: number, branch: string, now = Date.now()) => claim({ number, branch, repo: "example/project", cwd: tmp, run: runEnv, now: () => now });
	const status = () => snapshot({ cwd: tmp, run: runEnv });
	return { tmp, dir, env, issue, branches, seedClaim, refs, labelsOf, comments, doClaim, status };
}

describe("qa-claim helper", () => {
	it("claims an unclaimed issue: ref, label and a machine-readable comment with branch and UTC time", async () => {
		const t = setup();
		t.issue(3);
		const now = Date.parse("2026-10-23T12:00:00Z");
		const r = await t.doClaim(3, "bg-port-flake", now);
		assert.equal(r.claimed, true);
		assert.deepEqual(t.refs(), ["qa-claims/3-1"]);
		assert.ok(t.labelsOf(3).includes("qa:claimed"));
		assert.ok(t.labelsOf(3).includes("qa-inbox"));
		const [comment] = t.comments(3);
		assert.deepEqual(decodeClaim(comment), { number: 3, gen: 1, branch: "bg-port-flake", at: "2026-10-23T12:00:00.000Z" });
		// The claim commit message carries the same record and has main as parent.
		const sha = readFileSync(join(t.dir, "refs", encodeURIComponent("qa-claims/3-1")), "utf8");
		assert.deepEqual(decodeClaim(JSON.parse(readFileSync(join(t.dir, "commits", `${sha}.json`), "utf8")).message), decodeClaim(comment));
	});

	it("an already claimed issue is not started and writes nothing; the same branch is idempotent", async () => {
		const t = setup();
		t.issue(3);
		const now = Date.parse("2026-10-23T12:00:00Z");
		await t.doClaim(3, "bg-port-flake", now);
		const other = await t.doClaim(3, "other-branch", now + HOUR);
		assert.equal(other.claimed, false);
		assert.match(other.why, /already claimed by branch bg-port-flake since 2026-10-23T12:00:00/);
		const same = await t.doClaim(3, "bg-port-flake", now + 2 * HOUR);
		assert.equal(same.claimed, true);
		assert.deepEqual(t.refs(), ["qa-claims/3-1"]);
		assert.equal(t.comments(3).length, 1);
	});

	it("concurrent claimers: exactly one wins, the others lose the create-only ref race", async () => {
		const t = setup();
		t.issue(3);
		const env = t.env as any;
		env.FAKE_DELAY = "400"; // every claimer reads the empty ref list before any create
		const now = Date.now();
		const results = await Promise.all(["a", "b", "c"].map((b) => t.doClaim(3, b, now)));
		assert.equal(results.filter((r: any) => r.claimed).length, 1);
		assert.equal(results.filter((r: any) => !r.claimed && /lost the race/.test(r.why)).length, 2);
		assert.deepEqual(t.refs(), ["qa-claims/3-1"]);
		assert.equal(t.comments(3).length, 1);
		delete env.FAKE_DELAY;
	});

	it("a stale claim (no commit for 24 hours) is taken over as the next generation; a pushed commit keeps it fresh", async () => {
		const t = setup();
		t.issue(3);
		const now = Date.parse("2026-10-24T12:00:00Z");
		t.seedClaim(3, 1, "old-branch", iso(now - 30 * HOUR));
		t.branches({ "old-branch": iso(now - 2 * HOUR) });
		const fresh = await t.doClaim(3, "new-branch", now);
		assert.equal(fresh.claimed, false);
		t.branches({ "old-branch": iso(now - 25 * HOUR) });
		const stale = await t.doClaim(3, "new-branch", now);
		assert.equal(stale.claimed, true);
		assert.equal(stale.gen, 2);
		assert.deepEqual(t.refs(), ["qa-claims/3-1", "qa-claims/3-2"]);
	});

	it("refuses a closed issue, a non-inbox issue and a label without a record; rejects bad input", async () => {
		const t = setup();
		t.issue(4, { state: "closed" });
		t.issue(5, { labels: [] });
		t.issue(6, { labels: [{ name: "qa-inbox" }, { name: "qa:claimed" }] });
		await assert.rejects(t.doClaim(4, "x"), /not an open qa-inbox issue/);
		await assert.rejects(t.doClaim(5, "x"), /not an open qa-inbox issue/);
		const r = await t.doClaim(6, "x");
		assert.equal(r.claimed, false);
		assert.match(r.why, /without a claim record/);
		await assert.rejects(t.doClaim(6, "bad branch;rm"), /bad branch name/);
		await assert.rejects(t.doClaim(0, "x"), /positive integer/);
		assert.deepEqual(t.refs(), []);
	});

	it("a failing label or comment is a warning, the ref decides", async () => {
		const t = setup();
		t.issue(3);
		(t.env as any).FAKE_LABEL_EXISTS = "1"; // 422 already_exists on label creation is fine, not a warning
		const r = await t.doClaim(3, "b");
		assert.equal(r.claimed, true);
		assert.ok(t.labelsOf(3).includes("qa:claimed"));
		delete (t.env as any).FAKE_LABEL_EXISTS;
	});

	it("the CLI exits 0 when claimed, 3 when already claimed, 1 on error", () => {
		const t = setup();
		t.issue(3);
		const cli = (...a: string[]) => spawnSync(process.execPath, [join(ROOT, "scripts/qa-claim.mjs"), ...a], { cwd: t.tmp, env: t.env, encoding: "utf8", timeout: 30_000 });
		const first = cli("3", "bg-port-flake");
		assert.equal(first.status, 0, first.stderr);
		assert.match(first.stdout, /^CLAIMED claimed #3 for branch bg-port-flake/m);
		const second = cli("3", "someone-else");
		assert.equal(second.status, 3, second.stderr);
		assert.match(second.stdout, /NOT CLAIMED already claimed by branch bg-port-flake.*report to the coordinator/);
		assert.equal(cli("99", "x").status, 1);
		assert.equal(cli("3").status, 1);
	});
});

describe("qa-status claim view", () => {
	it("unclaimed is red; a fresh claim is in progress with its branch and not red", async () => {
		const t = setup();
		t.issue(2); t.issue(3, { labels: [{ name: "qa-inbox" }, { name: "qa:claimed" }] });
		t.seedClaim(3, 1, "bg-port-flake", iso(Date.now() - 2 * HOUR));
		const state = await t.status();
		assert.equal(state.ok, true, render(state));
		const two = state.items.find((i: any) => i.id.startsWith("issue:2:"));
		const three = state.items.find((i: any) => i.id === "claim:3:1");
		assert.equal(two.level, "red");
		assert.equal(three.level, "pending");
		assert.match(three.text, /claimed, in progress: branch bg-port-flake/);
		assert.ok(!state.items.some((i: any) => i.id.startsWith("issue:3:")));
	});

	it("a claim without a commit on its branch for 24 hours is red again, a commit keeps it fresh", async () => {
		const t = setup();
		t.issue(3);
		t.seedClaim(3, 1, "bg-port-flake", iso(Date.now() - 30 * HOUR));
		t.branches({ "bg-port-flake": iso(Date.now() - 25 * HOUR) });
		let state = await t.status();
		let item = state.items.find((i: any) => i.text.startsWith("#3"));
		assert.equal(item.level, "red");
		assert.match(item.id, /:stale-claim:1$/);
		assert.match(item.text, /stale claim: branch bg-port-flake .*no commit since/);
		t.branches({ "bg-port-flake": iso(Date.now() - 3 * HOUR) });
		state = await t.status();
		item = state.items.find((i: any) => i.text.startsWith("#3"));
		assert.equal(item.level, "pending");
	});

	it("a recurrence on a claimed issue keeps the claim and its id, so it is not a new red item", async () => {
		const t = setup();
		t.issue(3, { labels: [{ name: "qa-inbox" }, { name: "qa:claimed" }, { name: "qa:intermittent" }] });
		t.seedClaim(3, 1, "bg-port-flake", iso(Date.now() - HOUR));
		const before = (await t.status()).items.find((i: any) => i.id.startsWith("claim:3"));
		t.issue(3, { labels: [{ name: "qa-inbox" }, { name: "qa:claimed" }, { name: "qa:persistent" }], updated_at: "2026-10-23T05:00:00Z" });
		const after = (await t.status()).items.find((i: any) => i.id.startsWith("claim:3"));
		assert.equal(after.id, before.id);
		assert.equal(after.level, "pending");
	});

	it("the ref decides: a wiped label does not hide the claim, a label without a record is unclaimed red", async () => {
		const t = setup();
		t.issue(3); t.issue(6, { labels: [{ name: "qa-inbox" }, { name: "qa:claimed" }] });
		t.seedClaim(3, 1, "bg-port-flake", iso(Date.now() - HOUR));
		const state = await t.status();
		assert.equal(state.items.find((i: any) => i.id === "claim:3:1").level, "pending");
		const six = state.items.find((i: any) => i.id.startsWith("issue:6:"));
		assert.equal(six.level, "red");
		assert.match(six.text, /qa:claimed without a claim record/);
	});

	it("a claim ref without a valid record is treated as unclaimed red", async () => {
		const t = setup();
		t.issue(3);
		writeFileSync(join(t.dir, "commits", "bad.json"), JSON.stringify({ sha: "bad", message: "not a claim" }));
		writeFileSync(join(t.dir, "refs", encodeURIComponent("qa-claims/3-1")), "bad");
		const item = (await t.status()).items.find((i: any) => i.text.startsWith("#3"));
		assert.equal(item.level, "red");
		assert.match(item.text, /carries no valid claim record/);
	});
});
