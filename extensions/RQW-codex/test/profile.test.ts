// Deterministic checks of the RQW-codex stage 1 profile and its source-derived fixtures. No network, no credentials.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
	CODEX_API,
	CODEX_COMPACTION,
	CODEX_DEVICE_LOGIN,
	CODEX_ENDPOINT,
	CODEX_HEADERS,
	CODEX_IDENTITY,
	CODEX_MODEL_SLUGS,
	CODEX_PIN,
	CODEX_PREWARM,
	CODEX_PROVIDER,
	CODEX_RETRY,
	CODEX_SNAPSHOT_ID,
	CODEX_STABLE_FEATURES,
	CODEX_TIMEOUTS,
	CODEX_ZSTD_LEVEL,
	MODELS_JSON_SHA256,
	codexFeatures,
	codexModelCapabilities,
	codexProfileSnapshot,
	connectionRetryDelayMs,
	effortUpdatesActive,
} from "../profile.ts";

const fixture = (name: string) => JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8"));
const oracle = fixture("oracle-source.json");
const stable = fixture("stable-models.json");
const HEX64 = /^[0-9a-f]{64}$/;

describe("pinned constants", () => {
	it("pins upstream stable 0.163.0 at the peeled commit", () => {
		assert.deepEqual({ ...CODEX_PIN }, {
			release: "rust-v0.163.0",
			version: "0.163.0",
			commit: "83086188ae0614bd882818ff1aa23f3194962012",
			commitDate: "2026-10-15T18:57:07Z",
		});
	});

	it("keeps the Pi provider identity and the subscription endpoint", () => {
		assert.equal(CODEX_PROVIDER, "openai-codex");
		assert.equal(CODEX_API, "openai-codex-responses");
		assert.equal(CODEX_ENDPOINT, "https://chatgpt.com/backend-api/codex/responses");
	});

	it("uses codex_cli_rs 0.163.0 identity", () => {
		assert.equal(CODEX_IDENTITY.originator, "codex_cli_rs");
		assert.equal(CODEX_IDENTITY.clientVersion, "0.163.0");
		assert.equal(CODEX_IDENTITY.metadataPolicy, "truthful-git-workspace");
	});

	it("has source-verified timeout and retry constants", () => {
		assert.equal(CODEX_TIMEOUTS.websocketConnectMs, 15_000);
		assert.equal(CODEX_TIMEOUTS.streamIdleMs, 300_000);
		assert.equal(CODEX_RETRY.requestMaxRetries, 4);
		assert.equal(CODEX_RETRY.requestBaseDelayMs, 200);
		assert.equal(CODEX_RETRY.requestRetry429, false);
		assert.equal(CODEX_RETRY.requestRetry5xx, true);
		assert.equal(CODEX_RETRY.requestRetryTransport, true);
		assert.equal(CODEX_RETRY.streamMaxRetries, 5);
		assert.equal(CODEX_RETRY.connectionRetryInitialMs, 5_000);
		assert.equal(CODEX_RETRY.connectionRetryMaxMs, 60_000);
		assert.equal(CODEX_RETRY.unboundedConnectionRetries, true);
		assert.equal(CODEX_ZSTD_LEVEL, 3);
	});

	it("has the stable feature defaults and an explicit remote compaction V2 advertisement", () => {
		assert.deepEqual({ ...CODEX_STABLE_FEATURES }, { reasoningEffortOverride: false, incrementalTools: false, remoteCompactionV2: true });
	});

	it("keeps headers, prewarm, compaction and device-login paths", () => {
		assert.equal(CODEX_HEADERS.openAiBetaWebsocket, "responses_websockets=2026-02-06");
		assert.equal(CODEX_HEADERS.betaFeatures, "remote_compaction_v2");
		assert.equal(CODEX_HEADERS.turnState, "x-codex-turn-state");
		assert.equal(CODEX_HEADERS.windowId, "x-codex-window-id");
		assert.deepEqual({ ...CODEX_PREWARM }, { policy: "startup-and-idle-once", generateFalse: true });
		assert.deepEqual({ ...CODEX_COMPACTION }, { backendTrigger: "compaction_trigger", v2StreamRetries: 2, thresholdOwner: "RQW-context" });
		assert.deepEqual({ ...CODEX_DEVICE_LOGIN }, { userCodePath: "/deviceauth/usercode", pollPath: "/deviceauth/token", verificationPath: "/codex/device" });
	});
});

describe("connection retry schedule", () => {
	it("doubles from 5 s and caps at 60 s, with no retry limit", () => {
		const delays = [0, 1, 2, 3, 4, 5, 50, 10_000].map(connectionRetryDelayMs);
		assert.deepEqual(delays, [5_000, 10_000, 20_000, 40_000, 60_000, 60_000, 60_000, 60_000]);
	});

	it("rejects invalid retry indexes", () => {
		assert.throws(() => connectionRetryDelayMs(-1), RangeError);
		assert.throws(() => connectionRetryDelayMs(1.5), RangeError);
	});
});

describe("capability lookup by exact slug", () => {
	it("lists exactly the four GPT models of the RQW models list", () => {
		assert.deepEqual([...CODEX_MODEL_SLUGS].sort(), ["gpt-5.6-luna", "gpt-6-luna", "gpt-6-sol", "gpt-6.1-sol"]);
	});

	it("returns the pinned record for an exact slug", () => {
		const cap = codexModelCapabilities("gpt-6.1-sol");
		assert.equal(cap.displayName, "GPT-6.1-Sol");
		assert.equal(cap.useResponsesLite, true);
		assert.equal(cap.supportsReasoningEffortUpdates, true);
		assert.equal(cap.defaultReasoningSummary, "none");
		assert.equal(codexModelCapabilities("gpt-6-sol").supportsReasoningEffortUpdates, false);
	});

	it("fails clearly for unknown, prefixed, cased or padded slugs and for other families", () => {
		for (const slug of ["gpt-6.1", "gpt-6.1-sol-2", "GPT-6.1-Sol", " gpt-6.1-sol", "gpt-7-sol", "", "claude-opus-5-5", "__proto__", "constructor"]) {
			assert.throws(
				() => codexModelCapabilities(slug),
				(error: Error) => error instanceof Error && error.message.includes(`"${slug}"`) && error.message.includes("exact slug"),
				`slug ${JSON.stringify(slug)}`,
			);
		}
	});
});

describe("feature off versus explicitly enabled profile", () => {
	it("stable default keeps effort updates off even for a capable model", () => {
		assert.deepEqual(codexFeatures(), CODEX_STABLE_FEATURES);
		assert.equal(effortUpdatesActive("gpt-6.1-sol"), false);
		assert.equal(effortUpdatesActive("gpt-6.1-sol", codexFeatures()), false);
	});

	it("explicit enable turns effort updates on only where the source record allows them", () => {
		const enabled = codexFeatures({ reasoningEffortOverride: true });
		assert.deepEqual(enabled, { reasoningEffortOverride: true, incrementalTools: false, remoteCompactionV2: true });
		assert.equal(effortUpdatesActive("gpt-6.1-sol", enabled), true);
		assert.equal(effortUpdatesActive("gpt-6-sol", enabled), false);
		assert.equal(effortUpdatesActive("gpt-5.6-luna", enabled), false);
	});

	it("does not mutate the stable defaults", () => {
		codexFeatures({ incrementalTools: true });
		assert.equal(CODEX_STABLE_FEATURES.incrementalTools, false);
	});
});

describe("snapshot identity", () => {
	it("binds the pin to the models.json digest", () => {
		assert.equal(MODELS_JSON_SHA256, stable.source.sha256);
		assert.equal(CODEX_SNAPSHOT_ID, `${CODEX_PIN.commit}:${stable.source.sha256}`);
		const snapshot = codexProfileSnapshot();
		assert.equal(snapshot.id, CODEX_SNAPSHOT_ID);
		assert.deepEqual([...snapshot.models], [...CODEX_MODEL_SLUGS]);
		assert.equal(Object.isFrozen(snapshot), true);
	});

	it("gives each profile record the same source digest as the fixture", () => {
		for (const entry of stable.models) {
			assert.equal(codexModelCapabilities(entry.slug).sourceRecordSha256, entry.sourceRecordSha256);
		}
	});
});

describe("native fields per record, from the pinned source record", () => {
	it("copies comp_hash, supports_parallel_tool_calls, input_modalities and context_window exactly", () => {
		for (const entry of stable.models) {
			const cap = codexModelCapabilities(entry.slug);
			assert.equal(cap.compactionHash, entry.sourceRecord.comp_hash, `${entry.slug} compactionHash`);
			assert.equal(cap.supportsParallelToolCalls, entry.sourceRecord.supports_parallel_tool_calls, `${entry.slug} supportsParallelToolCalls`);
			assert.deepEqual([...cap.inputModalities], entry.sourceRecord.input_modalities, `${entry.slug} inputModalities`);
			assert.equal(cap.contextWindow, entry.sourceRecord.context_window, `${entry.slug} contextWindow`);
		}
	});

	it("keeps native default priority as metadata only, never a default fast mode", () => {
		for (const slug of CODEX_MODEL_SLUGS) {
			assert.equal(Object.hasOwn(codexModelCapabilities(slug), "priority"), false, `${slug} has no priority field`);
		}
		assert.equal(effortUpdatesActive("gpt-6.1-sol"), false);
	});

	it("freezes every returned record and array so callers cannot mutate the pinned profile", () => {
		for (const slug of CODEX_MODEL_SLUGS) {
			const cap = codexModelCapabilities(slug);
			assert.equal(Object.isFrozen(cap), true, `${slug} record`);
			assert.equal(Object.isFrozen(cap.inputModalities), true, `${slug} inputModalities`);
			assert.equal(Object.isFrozen(cap.supportedReasoningLevels), true, `${slug} levels`);
			assert.equal(Object.isFrozen(cap.serviceTiers), true, `${slug} serviceTiers`);
			assert.equal(Object.isFrozen(cap.additionalSpeedTiers), true, `${slug} additionalSpeedTiers`);
		}
		assert.equal(Object.isFrozen(codexFeatures()), true);
		assert.equal(Object.isFrozen(codexProfileSnapshot().pin), true);
	});

	it("throws on mutation of a pinned record or its arrays, and leaves the profile unchanged", () => {
		const cap = codexModelCapabilities("gpt-6.1-sol") as unknown as Record<string, unknown>;
		assert.throws(() => {
			cap.contextWindow = 1;
		}, TypeError);
		assert.throws(() => {
			cap.compactionHash = "x";
		}, TypeError);
		assert.throws(() => {
			(cap.inputModalities as string[]).push("audio");
		}, TypeError);
		assert.throws(() => {
			(cap.supportedReasoningLevels as string[]).length = 0;
		}, TypeError);
		assert.equal(codexModelCapabilities("gpt-6.1-sol").contextWindow, 272000);
		assert.deepEqual([...codexModelCapabilities("gpt-6.1-sol").inputModalities], ["text", "image"]);
	});

	it("throws on mutation of returned features without changing the stable defaults", () => {
		const features = codexFeatures({ reasoningEffortOverride: true }) as unknown as Record<string, boolean>;
		assert.throws(() => {
			features.incrementalTools = true;
		}, TypeError);
		assert.deepEqual({ ...CODEX_STABLE_FEATURES }, { reasoningEffortOverride: false, incrementalTools: false, remoteCompactionV2: true });
	});
});

describe("source-derived fixture provenance", () => {
	it("records the same upstream pin as the profile and labels the data as source extraction", () => {
		assert.deepEqual({ ...oracle.pin }, { ...CODEX_PIN, sourceRoot: oracle.pin.sourceRoot, sourceRootRelative: "codex-rs" });
		assert.match(oracle.kind, /source-extracted/);
		assert.match(oracle.kind, /NOT runtime wire captures/);
		assert.deepEqual(oracle.runtimeCaptures, []);
		assert.ok(oracle.notClaimed.includes("live backend acceptance"));
		assert.equal(stable.pin.commit, CODEX_PIN.commit);
	});

	it("names every source file with a relative path and a SHA-256", () => {
		assert.ok(oracle.sourceFiles.length >= 20);
		for (const file of oracle.sourceFiles) {
			assert.equal(file.path.startsWith("/"), false);
			assert.match(file.sha256, HEX64);
		}
		assert.match(stable.source.sha256, HEX64);
	});

	it("uses only recorded assertions with a file, a line and the asserted text", () => {
		const files = new Set(oracle.sourceFiles.map((file: { path: string }) => file.path));
		for (const a of oracle.assertions) {
			assert.ok(files.has(a.file), `${a.id} file`);
			assert.ok(a.text.length > 0, `${a.id} text`);
			assert.ok(a.claim.length > 0, `${a.id} claim`);
			if (a.kind === "contains") assert.ok(Number.isInteger(a.line) && a.line > 0, `${a.id} line`);
			else assert.equal(a.kind, "absent", `${a.id} kind`);
		}
	});

	it("covers the stable default flags and the absence of responses=experimental", () => {
		const ids = oracle.assertions.map((a: { id: string }) => a.id);
		assert.ok(ids.includes("feature.reasoning_effort_override_off"));
		assert.ok(ids.includes("feature.incremental_tools_off"));
		assert.ok(ids.includes("beta.sse_no_responses_experimental"));
	});

	it("keeps the RQW GPT list and the pinned GPT records in step", () => {
		assert.deepEqual([...stable.rqwGptModels].sort(), [...CODEX_MODEL_SLUGS].sort());
		assert.deepEqual(stable.models.map((m: { slug: string }) => m.slug).sort(), [...CODEX_MODEL_SLUGS].sort());
	});
});
