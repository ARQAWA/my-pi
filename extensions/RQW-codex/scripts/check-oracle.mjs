// Checks the RQW-codex source-derived oracle fixtures against a local upstream Codex source tree.
// Usage: node extensions/RQW-codex/scripts/check-oracle.mjs <codex-rs source root>
// This reads source text and digests only. It does not compile, run or contact Codex or any backend.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "..", "..", "..", "test", "extensions", "RQW-codex", "fixtures");
const errors = [];
const fail = (message) => errors.push(message);
const sha256 = (text) => createHash("sha256").update(text).digest("hex");

const root = process.argv[2];
if (!root) {
	console.error("usage: node extensions/RQW-codex/scripts/check-oracle.mjs <codex-rs source root>");
	process.exit(2);
}
const sourceRoot = resolve(root);
if (!existsSync(join(sourceRoot, "Cargo.toml"))) {
	console.error(`not a codex-rs source root (no Cargo.toml): ${sourceRoot}`);
	process.exit(2);
}

const oracle = JSON.parse(readFileSync(join(fixtures, "oracle-source.json"), "utf8"));
const models = JSON.parse(readFileSync(join(fixtures, "stable-models.json"), "utf8"));
const profile = await import(pathToFileURL(join(here, "..", "profile.ts")).href);

// 1. Pin: fixture, profile and the audit record next to the source tree must agree.
const { CODEX_PIN } = profile;
for (const [name, value] of Object.entries({ release: CODEX_PIN.release, version: CODEX_PIN.version, commit: CODEX_PIN.commit, commitDate: CODEX_PIN.commitDate })) {
	if (oracle.pin[name] !== value) fail(`oracle-source pin.${name} ${oracle.pin[name]} != profile ${value}`);
	if (models.pin[name] !== value) fail(`stable-models pin.${name} ${models.pin[name]} != profile ${value}`);
}
const auditPath = join(sourceRoot, "..", "source-audit.json");
if (!existsSync(auditPath)) fail(`pin evidence missing: ${auditPath}`);
else {
	const audit = JSON.parse(readFileSync(auditPath, "utf8"));
	if (audit.codex_stable_commit !== CODEX_PIN.commit) fail(`source-audit commit ${audit.codex_stable_commit} != pin ${CODEX_PIN.commit}`);
	if (audit.codex_stable_commit_date !== CODEX_PIN.commitDate) fail(`source-audit commit date mismatch`);
}

// 2. Content digests of every named source file.
const lines = new Map();
for (const file of oracle.sourceFiles) {
	const path = join(sourceRoot, file.path);
	if (!existsSync(path)) {
		fail(`source file missing: ${file.path}`);
		continue;
	}
	const text = readFileSync(path, "utf8");
	if (sha256(text) !== file.sha256) fail(`sha256 mismatch: ${file.path}`);
	lines.set(file.path, text.split("\n"));
}

// 3. Source assertions: exact text at the recorded line (or absent from the whole file).
let assertionsOk = 0;
for (const a of oracle.assertions) {
	const src = lines.get(a.file);
	if (!src) {
		fail(`${a.id}: file not loaded: ${a.file}`);
		continue;
	}
	if (a.kind === "absent") {
		if (src.some((line) => line.includes(a.text))) fail(`${a.id}: forbidden text present in ${a.file}`);
		else assertionsOk++;
		continue;
	}
	if (!src[a.line - 1]?.includes(a.text)) {
		fail(`${a.id}: ${a.file}:${a.line} does not contain the recorded text`);
		continue;
	}
	if (a.within) {
		const offset = a.within.line - a.line;
		if (offset < 0 || offset > 2 || !src[a.within.line - 1]?.includes(a.within.text)) {
			fail(`${a.id}: ${a.file}:${a.within.line} does not contain "${a.within.text}"`);
			continue;
		}
	}
	assertionsOk++;
}

// 4. Model records: exact digest of each source record and agreement with the offline profile.
const modelsRaw = readFileSync(join(sourceRoot, "models-manager", "models.json"), "utf8");
if (sha256(modelsRaw) !== models.source.sha256) fail("models.json sha256 mismatch with stable-models.json");
if (models.source.sha256 !== profile.MODELS_JSON_SHA256) fail("profile MODELS_JSON_SHA256 differs from stable-models.json");
const catalog = JSON.parse(modelsRaw).models;
const level = (x) => x.map((l) => l.effort);
const sameList = (a, b) => JSON.stringify(a) === JSON.stringify(b);
let modelsOk = 0;
for (const entry of models.models) {
	const hits = catalog.filter((m) => m.slug === entry.slug);
	if (hits.length !== 1) {
		fail(`${entry.slug}: ${hits.length} source records (expected 1)`);
		continue;
	}
	const rec = hits[0];
	if (sha256(JSON.stringify(rec)) !== entry.sourceRecordSha256) fail(`${entry.slug}: source record digest mismatch`);
	const projected = { ...rec };
	for (const k of ["model_messages", "base_instructions"]) {
		if (k in projected) projected[k] = { omitted: true, sha256: sha256(JSON.stringify(rec[k])), jsonBytes: JSON.stringify(rec[k]).length };
	}
	if (JSON.stringify(projected) !== JSON.stringify(entry.sourceRecord)) fail(`${entry.slug}: fixture record differs from source`);
	let cap;
	try {
		cap = profile.codexModelCapabilities(entry.slug);
	} catch (error) {
		fail(`${entry.slug}: ${error.message}`);
		continue;
	}
	const expect = {
		displayName: rec.display_name,
		useResponsesLite: rec.use_responses_lite,
		defaultReasoningLevel: rec.default_reasoning_level,
		supportedReasoningLevels: level(rec.supported_reasoning_levels),
		supportsReasoningSummaryParameter: rec.supports_reasoning_summary_parameter,
		supportsReasoningSummaries: rec.supports_reasoning_summaries,
		defaultReasoningSummary: rec.default_reasoning_summary,
		supportVerbosity: rec.support_verbosity,
		defaultVerbosity: rec.default_verbosity,
		supportsReasoningEffortUpdates: rec.supports_reasoning_effort_updates ?? false,
		defaultServiceTier: rec.default_service_tier ?? null,
		serviceTiers: rec.service_tiers.map((t) => t.id),
		additionalSpeedTiers: rec.additional_speed_tiers,
		sourceRecordSha256: entry.sourceRecordSha256,
	};
	for (const [key, value] of Object.entries(expect)) {
		if (!sameList(cap[key], value)) fail(`${entry.slug}: profile ${key} ${JSON.stringify(cap[key])} != source ${JSON.stringify(value)}`);
	}
	modelsOk++;
}

// 5. RQW models list (RQW-models FAMILIES, GPT entries) must equal the pinned GPT set; a missing id is a blocker.
const rqwSource = readFileSync(join(here, "..", "..", "RQW-models", "index.ts"), "utf8");
const familiesBlock = rqwSource.match(/export const FAMILIES = \[([\s\S]*?)\] as const;/);
const rqwFamilies = familiesBlock ? [...familiesBlock[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]) : [];
const rqwGpt = rqwFamilies.filter((id) => id.startsWith("gpt-"));
if (!rqwFamilies.length) fail("RQW-models FAMILIES not found");
if (!sameList([...rqwGpt].sort(), [...models.rqwGptModels].sort())) fail(`RQW GPT models ${JSON.stringify(rqwGpt)} != fixture ${JSON.stringify(models.rqwGptModels)}`);
for (const id of rqwGpt) {
	if (!catalog.some((m) => m.slug === id)) fail(`BLOCKER: RQW model ${id} has no exact record in stable models.json`);
}

if (errors.length) {
	console.error(`check-oracle FAILED (${errors.length})`);
	for (const e of errors) console.error(`- ${e}`);
	process.exit(1);
}
console.log(
	`check-oracle PASS: pin ${CODEX_PIN.release} ${CODEX_PIN.commit}; ${sourceFiles(oracle)} source files digest-checked; ` +
		`${assertionsOk}/${oracle.assertions.length} source assertions; ${modelsOk}/${models.models.length} model records; ` +
		`RQW GPT models: ${rqwGpt.join(", ")}. Source extraction only: no Rust executed, no runtime capture.`,
);

function sourceFiles(o) {
	return o.sourceFiles.length;
}
