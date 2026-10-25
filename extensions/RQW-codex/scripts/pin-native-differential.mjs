#!/usr/bin/env node
// Pins a small set of native oracle captures as the differential fixture test/fixtures/native-differential.json.
// Input: an unpacked normal codex-oracle artifact (run.json + captures/) of the pinned Codex commit, and the pinned
// codex-rs source tree for the cited test files. Output: per case the scripted server events (verbatim, serve order),
// the server stimulus that is not an SSE script (HTTP status/headers/body, WebSocket upgrade answer) with its source
// citation, and the native request sequence projected by test/native-differential.mjs. Every capture file used is
// recorded with its SHA-256 so the fixture is traceable to the artifact of the named CI run.
//
// Usage: node pin-native-differential.mjs --artifact <dir> --source <codex-rs> --run <ci run url> --head <my-pi sha> [--out <file>]
//        [--check <committed fixture>]  (CI drift check: the fresh projection must equal the committed one)
// Reads files only. No network, no cargo, no backend.
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { PIN_COMMIT, PIN_RELEASE } from './capture-oracle.mjs';
import { projectSequence } from '../../../test/extensions/RQW-codex/native-differential.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_OUT = resolve(here, '../../../test/extensions/RQW-codex/fixtures/native-differential.json');

// expectedSleeps: half-open [min, max) ranges in ms, one per retry wait, in order (native `min..max` bounds).
const overloaded = (code) => ({ status: 503, headers: { 'retry-after': '1', 'content-type': 'application/json' }, body: JSON.stringify({ error: { code } }) });

// Case table. `responses` is the native serve order: {script: k} is the k-th scripted SSE body of the case (captured),
// optionally with response headers; other entries are non-SSE responses copied from the cited native test source.
// `upgrade` is the native answer to a WebSocket upgrade: 'none' means the native provider has no WebSocket support.
export const CASES = [
  {
    id: 'transport-turn-state-sse',
    expectedSleeps: [],
    sleepSource: 'the native case has no failed response, so no retry wait',
    area: 'transport',
    capturePrefix: 'turn_state-53eef0ad22b6',
    test: 'suite::turn_state::responses_turn_state_persists_within_turn_and_resets_after',
    source: ['core/tests/suite/turn_state.rs:23-81'],
    prompts: ['run a shell command', 'second turn'],
    steps: ['prompt:0', 'prompt:1'],
    upgrade: 'none',
    responses: [{ script: 0, headers: { 'x-codex-turn-state': 'ts-1' } }, { script: 1 }, { script: 2 }],
  },
  {
    id: 'transport-upgrade-426-sse',
    expectedSleeps: [],
    sleepSource: 'the native case has no failed response, so no retry wait',
    nativeTimeline: ['upgrade', 'http'],
    timelineSource: 'websocket_fallback.rs:66-79 (one startup upgrade answered 426, then HTTP with no further upgrade; comment :74-77)',
    area: 'transport',
    capturePrefix: 'websocket_fallback-c4feeca2c823',
    test: 'suite::websocket_fallback::websocket_fallback_switches_to_http_on_upgrade_required_connect',
    source: ['core/tests/suite/websocket_fallback.rs:34-81'],
    prompts: ['hello'],
    steps: ['prompt:0'],
    upgrade: 426,
    providerRetries: { requestMaxRetries: 0, streamMaxRetries: 2 },
    responses: [{ script: 0 }],
  },
  {
    id: 'transport-fallback-sticky',
    expectedSleeps: [[180, 220], [360, 440]],
    sleepSource: 'native backoff 200ms*2^(n-1) +-10% (bounds retry_after.rs:49-52) for the two WebSocket stream retries (websocket_fallback.rs:248-251); not asserted by this native test',
    nativeTimeline: ['upgrade', 'upgrade', 'upgrade', 'upgrade', 'http', 'http'],
    timelineSource: 'websocket_fallback.rs:238-253 (startup prewarm plus 3 stream attempts, then HTTP; sticky second turn adds none)',
    area: 'transport',
    capturePrefix: 'websocket_fallback-3a1f2025ae35',
    test: 'suite::websocket_fallback::websocket_fallback_is_sticky_across_turns',
    // The upgrade GET matches no mock, so wiremock answers 404 (no Mock for GET is mounted in this test).
    source: ['core/tests/suite/websocket_fallback.rs:210-257', 'core/tests/suite/retry_after.rs:49-52'],
    prompts: ['first', 'second'],
    steps: ['prompt:0', 'prompt:1'],
    upgrade: 404,
    providerRetries: { requestMaxRetries: 0, streamMaxRetries: 2 },
    responses: [{ script: 0 }, { script: 1 }],
  },
  {
    id: 'transport-zstd-codex-backend',
    expectedSleeps: [],
    sleepSource: 'the native case has no failed response, so no retry wait',
    area: 'transport',
    capturePrefix: 'request_body_is_zstd_compressed_for_codex_backend_when_enabled-0ac320448269',
    test: 'suite::request_compression::request_body_is_zstd_compressed_for_codex_backend_when_enabled',
    source: ['core/tests/suite/request_compression.rs:19-62'],
    prompts: ['compress me'],
    steps: ['prompt:0'],
    upgrade: 'none',
    compareContentEncoding: true,
    responses: [{ script: 0 }],
  },
  {
    id: 'retry-http-503-retry-after',
    expectedSleeps: [[1000, 1001], [1000, 1001]],
    sleepSource: 'Retry-After 1 (retry_after.rs:289, :292); each delay <= 1s and the wait >= 1s (retry_after.rs:311-333), so exactly 1000 ms on the injected clock',
    area: 'retry',
    capturePrefix: 'retry_after-e3e512df77d6',
    test: 'suite::retry_after::responses_http_uses_retry_after',
    source: ['core/tests/suite/retry_after.rs:279-343'],
    prompts: ['retry the upstream overload'],
    steps: ['prompt:0'],
    upgrade: 'none',
    providerRetries: { requestMaxRetries: 1, streamMaxRetries: 1 },
    responses: [overloaded('server_is_overloaded'), overloaded('server_is_overloaded'), { script: 0 }],
  },
  {
    id: 'retry-http-429-retry-after',
    expectedSleeps: [[1000, 1001]],
    sleepSource: 'Retry-After 1 (retry_after.rs:355); delay <= 1s and wait >= 1s (retry_after.rs:374-384), so exactly 1000 ms on the injected clock',
    area: 'retry',
    capturePrefix: 'retry_after-7116a5ab3831',
    test: 'suite::retry_after::responses_http_429_uses_retry_after',
    source: ['core/tests/suite/retry_after.rs:345-402'],
    prompts: ['retry the rate-limited request'],
    steps: ['prompt:0'],
    upgrade: 'none',
    providerRetries: { requestMaxRetries: 0, streamMaxRetries: 1 },
    responses: [{ ...overloaded('rate_limit_exceeded'), status: 429 }, { script: 0 }],
  },
  {
    id: 'retry-sse-failed-exhausts-stream-budget',
    expectedSleeps: [[180, 220]],
    sleepSource: 'first local backoff within FIRST_RETRY_MIN/MAX_DELAY (retry_after.rs:49-50, asserted at :1155-1157)',
    area: 'retry',
    capturePrefix: 'retry_after-bc509159a8fe',
    test: 'suite::retry_after::sse_failure_without_retry_after_exhausts_stream_retries::rate_limit',
    source: ['core/tests/suite/retry_after.rs:1121-1204'],
    prompts: ['exhaust the headerless rate-limited stream'],
    steps: ['prompt:0'],
    upgrade: 'none',
    providerRetries: { requestMaxRetries: 0, streamMaxRetries: 1 },
    expectError: true,
    responses: [{ script: 0 }, { script: 1 }],
  },
  {
    id: 'compaction-manual-stream-retry-budget',
    expectedSleeps: [[180, 220], [360, 440]],
    sleepSource: 'native backoff 200ms*2^(n-1) +-10% (bounds retry_after.rs:49-52) for the two compaction stream retries (budgets compact_remote.rs:1189-1192); not asserted by this native test',
    area: 'compaction',
    capturePrefix: 'compact_remote-fa6b7295c23b',
    test: 'suite::compact_remote::remote_compact_v2_retries_failures_with_stream_retry_budget',
    source: ['core/tests/suite/compact_remote.rs:1183-1286', 'core/tests/suite/retry_after.rs:49-52'],
    prompts: ['hello remote compact', 'after compact'],
    steps: ['prompt:0', 'compact', 'prompt:1'],
    upgrade: 'none',
    compareContentEncoding: true,
    providerRetries: { requestMaxRetries: 0, streamMaxRetries: 2 },
    responses: [
      { script: 0 },
      { status: 500, headers: { 'content-type': 'text/plain' }, body: 'first compact open failed' },
      { script: 1 },
      { script: 2 },
      { script: 3 },
    ],
  },
  {
    id: 'compaction-manual-http-retry-after',
    expectedSleeps: [[1000, 1001]],
    sleepSource: 'Retry-After 1 (retry_after.rs:633); delay <= 1s and wait >= 1s (retry_after.rs:660-670), so exactly 1000 ms on the injected clock',
    area: 'compaction',
    capturePrefix: 'retry_after-c66dc4150d8f',
    test: 'suite::retry_after::compact_v2_uses_retry_after',
    source: ['core/tests/suite/retry_after.rs:619-688'],
    prompts: ['seed history for compaction'],
    steps: ['prompt:0', 'compact'],
    upgrade: 'none',
    compareContentEncoding: true,
    providerRetries: { requestMaxRetries: 1, streamMaxRetries: 0 },
    responses: [{ script: 0 }, overloaded('server_is_overloaded'), { script: 1 }],
  },
  {
    id: 'compaction-mid-turn-turn-state',
    expectedSleeps: [],
    sleepSource: 'the native case has no failed response, so no retry wait',
    area: 'compaction',
    capturePrefix: 'compact_remote-91e24d45dbc1',
    test: 'suite::compact_remote::remote_mid_turn_compact_v2_sends_turn_state_over_http',
    source: ['core/tests/suite/compact_remote.rs:1522-1620'],
    prompts: ['RUN_WITH_MID_TURN_COMPACT_V2'],
    steps: ['prompt:0'],
    upgrade: 'none',
    compareContentEncoding: true,
    // Native config.model_auto_compact_token_limit = 200; the first sampling reports 500 total tokens.
    autoCompactTokenLimit: 200,
    responses: [
      { script: 0, headers: { 'x-codex-turn-state': 'sampling-state' } },
      { script: 1, headers: { 'x-codex-turn-state': 'compact-state' } },
      { script: 2, headers: { 'x-codex-turn-state': 'continuation-state' } },
      { script: 3 },
    ],
  },
];

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function loadCase(artifact, names, entry) {
  const own = names.filter((name) => name.startsWith(`${entry.capturePrefix}-`) && name.endsWith('.json'));
  const records = [];
  const files = [];
  for (const name of own) {
    const text = await readFile(join(artifact, 'captures', name));
    const meta = JSON.parse(text.toString('utf8'));
    if (meta.test !== entry.test) throw new Error(`${name}: capture test ${meta.test} is not ${entry.test}`);
    if (meta.pin !== PIN_COMMIT) throw new Error(`${name}: capture pin ${meta.pin}`);
    const raw = await readFile(join(artifact, 'captures', meta.raw_file));
    files.push({ file: `captures/${name}`, sha256: sha256(text), rawSha256: sha256(raw) });
    records.push({ meta, raw });
  }
  records.sort((a, b) => a.meta.seq - b.meta.seq);
  const scripts = records.filter((r) => r.meta.kind === 'server-script').map((r) => r.meta.decoded_json);
  const requests = records
    .filter((r) => r.meta.kind === 'http' || r.meta.kind === 'ws-text')
    .map((r) => ({
      transport: r.meta.kind === 'http' ? 'http' : 'ws',
      url: r.meta.uri || 'ws://localhost/v1/responses',
      headers: r.meta.headers ?? [],
      body: r.meta.kind === 'http' ? r.meta.decoded_json : JSON.parse(r.raw.toString('utf8')),
    }));
  if (requests.some((r) => r.body === null || r.body === undefined)) throw new Error(`${entry.id}: a native request has no decoded body`);
  const scriptRefs = entry.responses.filter((r) => r.script !== undefined).map((r) => r.script);
  if (JSON.stringify(scriptRefs) !== JSON.stringify(scripts.map((_, i) => i))) {
    throw new Error(`${entry.id}: stimulus uses scripts ${JSON.stringify(scriptRefs)} but the capture has ${scripts.length}`);
  }
  if (entry.responses.length !== requests.length) {
    throw new Error(`${entry.id}: ${entry.responses.length} native responses for ${requests.length} captured requests`);
  }
  const native = projectSequence(requests, { scripts, prompts: entry.prompts });
  for (const prompt of entry.prompts) {
    if (!native.some((r) => r.conversation.includes(`user:${prompt}`))) throw new Error(`${entry.id}: prompt ${JSON.stringify(prompt)} not in the native capture`);
  }
  const contentEncoding = requests.map((r) => r.headers.find(([n]) => n.toLowerCase() === 'content-encoding')?.[1] ?? null);
  return { files: files.sort((a, b) => a.file.localeCompare(b.file)), scripts, native, contentEncoding };
}

// Run-dependent case fields: capture file digests (UUIDs, timestamps) and log locations differ per run. Every other case
// field, including the executable replay configuration, must be equal.
export const RUN_DEPENDENT_FIELDS = new Set(['captures', 'nativeLog']);

export function driftOf(committed, fresh) {
  const failures = [];
  const ids = (fixture) => fixture.cases.map((c) => c.id);
  if (JSON.stringify(ids(committed)) !== JSON.stringify(ids(fresh))) failures.push('case list differs');
  if (JSON.stringify(committed.provenance.sourceSha256) !== JSON.stringify(fresh.provenance.sourceSha256)) failures.push('cited native source digests differ');
  for (const entry of fresh.cases) {
    const pinned = committed.cases.find((c) => c.id === entry.id);
    if (!pinned) continue;
    const fields = new Set([...Object.keys(pinned), ...Object.keys(entry)]);
    for (const field of [...fields].sort()) {
      if (RUN_DEPENDENT_FIELDS.has(field)) continue;
      if (JSON.stringify(pinned[field]) !== JSON.stringify(entry[field])) failures.push(`${entry.id}: ${field} drifted from the committed fixture`);
    }
  }
  return failures;
}

export async function pin({ artifact, source, run, head, out = DEFAULT_OUT }) {
  const runJson = JSON.parse(await readFile(join(artifact, 'run.json'), 'utf8'));
  if (runJson.sourceCommit !== PIN_COMMIT) throw new Error(`artifact sourceCommit ${runJson.sourceCommit} is not ${PIN_COMMIT}`);
  const runCases = new Map(runJson.scenarios.flatMap((s) => s.cases.map((c) => [c.fullName, c])));
  const names = await readdir(join(artifact, 'captures'));
  const sourceSha = {};
  const cases = [];
  for (const entry of CASES) {
    const ran = runCases.get(entry.test);
    if (!ran?.ok || ran.capturePrefix !== entry.capturePrefix) throw new Error(`${entry.id}: native case did not pass in run.json or has another prefix`);
    for (const cite of entry.source) {
      const file = cite.split(':')[0];
      sourceSha[file] ??= sha256(await readFile(join(source, file)));
    }
    const loaded = await loadCase(artifact, names, entry);
    if (!Array.isArray(entry.expectedSleeps) || entry.expectedSleeps.some(([min, max]) => !(min >= 0 && max > min))) {
      throw new Error(`${entry.id}: expectedSleeps must be a list of half-open [min, max) ranges`);
    }
    if (entry.nativeTimeline && entry.nativeTimeline.filter((t) => t === 'http').length !== loaded.native.length) {
      throw new Error(`${entry.id}: nativeTimeline POST count differs from the captured requests`);
    }
    if ((entry.upgrade === 'none') === Boolean(entry.nativeTimeline)) throw new Error(`${entry.id}: nativeTimeline is required exactly for upgrade cases`);
    const { compareContentEncoding, ...rest } = entry;
    cases.push({
      ...rest,
      nativeLog: ran.log,
      captures: loaded.files,
      scripts: loaded.scripts,
      native: loaded.native,
      ...(compareContentEncoding ? { nativeContentEncoding: loaded.contentEncoding } : {}),
    });
  }
  const fixture = {
    schema: 'rqw-codex/native-differential@1',
    kind: 'pinned native oracle captures (requests and scripted SSE bodies) projected by test/native-differential.mjs; non-SSE stimulus copied from the cited pinned test source',
    provenance: {
      oracleRun: run,
      myPiHead: head,
      artifact: `codex-oracle-${PIN_COMMIT}`,
      codexRelease: PIN_RELEASE,
      codexCommit: PIN_COMMIT,
      runStartedAt: runJson.startedAt,
      os: runJson.os,
      sourceSha256: sourceSha,
    },
    cases,
  };
  await writeFile(out, JSON.stringify(fixture, null, 2) + '\n');
  return fixture;
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) args[argv[i].replace(/^--/, '')] = argv[i + 1];
  return args;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.artifact || !args.source || !args.run || !args.head) {
    console.error('usage: pin-native-differential.mjs --artifact <dir> --source <codex-rs> --run <url> --head <sha> [--out <file>]');
    process.exit(2);
  }
  pin(args).then(
    async (fixture) => {
      console.log(`pinned ${fixture.cases.length} native differential case(s) to ${args.out ?? DEFAULT_OUT}`);
      if (!args.check) return;
      const failures = driftOf(JSON.parse(await readFile(args.check, 'utf8')), fixture);
      if (failures.length > 0) {
        console.error(failures.join('\n'));
        process.exit(1);
      }
      console.log('native differential fixture matches this run\'s captures');
    },
    (error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    },
  );
}
