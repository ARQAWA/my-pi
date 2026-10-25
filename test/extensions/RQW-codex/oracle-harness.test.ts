// Deterministic checks of the Stage 1 oracle harness: pin and digest guards, temp-only work copies,
// redaction, instrumentation anchors, test filters, libtest parsing, raw capture semantics and capture integrity.
// Synthetic fake source copies only; the pinned responses.rs is read-only evidence when present; no cargo, no network.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import * as zlib from 'node:zlib';
import { after, describe, it } from 'node:test';

import {
  HARNESS_ENVIRONMENT,
  MACOS_RETRY_FIXTURE,
  RETRY_AFTER_RS,
  RETRY_AFTER_RS_SHA256,
  adaptRetryAfterFixture,
  checkAdaptedFixtures,
  PIN_COMMIT,
  RAW_SEMANTICS,
  RESPONSES_RS,
  RESPONSES_RS_SHA256,
  RUST_MIN_STACK_BYTES,
  SCENARIOS,
  assertFiltersMatch,
  assertTempWorkDir,
  checkCaptureRecord,
  checkOutput,
  casePrefix,
  checkPin,
  childTestEnv,
  countCaptureKinds,
  countMatches,
  createHarnessWork,
  instrumentResponsesRs,
  parseLibtestSummary,
  parseTestList,
  rawBoundaryOf,
  redactCaptureDir,
  redactHeaders,
  runCommand,
  sha256Hex,
  validateScenarios,
  verifyDigests,
} from '../../../extensions/RQW-codex/scripts/capture-oracle.mjs';

const roots: string[] = [];

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  roots.push(dir);
  return dir;
}

after(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});

// Literal copies of the pinned upstream text (core/tests/common/responses.rs), independent of the module exports.
const ANCHOR_HTTP = '        self.requests\n            .lock()\n            .unwrap()\n            .push(ResponsesRequest(request.clone()));\n';
const ANCHOR_WS = '                let Some(Ok(message)) = message else {\n                    break;\n                };\n';
const ANCHOR_HANDSHAKE = '                handshake_log.lock().unwrap().push(WebSocketHandshake {\n';
const WS_NEXT = '                let message = tokio::select! {\n                    message = ws_stream.next() => message,\n                };\n';

// Pinned evidence checkout; override with RQW_ORACLE_RESPONSES_RS. Read-only; the test skips when absent.
const PINNED_RESPONSES_RS =
  process.env.RQW_ORACLE_RESPONSES_RS ??
  '/Users/arkadijcukavin/ai-project/my-pi-evidence/codex-parity/codex-rs/core/tests/common/responses.rs';

function fakeResponsesRs(extra = ''): string {
  return (
    'impl Match for ModelsMock {\n' +
    '    fn matches(&self, request: &wiremock::Request) -> bool {\n' +
    '        self.requests.lock().unwrap().push(request.clone());\n' +
    '        true\n    }\n}\n' +
    'impl Match for ResponseMock {\n' +
    '    fn matches(&self, request: &wiremock::Request) -> bool {\n' +
    ANCHOR_HTTP +
    '\n        validate_request_body_invariants(request);\n        true\n    }\n}\n' +
    'fn server() {\n' +
    WS_NEXT +
    ANCHOR_WS +
    ANCHOR_HANDSHAKE +
    '}\n' +
    'pub fn sse(events: Vec<Value>) -> String {\n    use std::fmt::Write as _;\n    String::new()\n}\n' +
    extra
  );
}

describe('pin and digest guards', () => {
  it('accepts the pinned commit and rejects any other checkout HEAD', async () => {
    assert.equal(await checkPin({ sourceRoot: '/unused', readHead: async () => `${PIN_COMMIT}\n` }), PIN_COMMIT);
    await assert.rejects(
      checkPin({ sourceRoot: '/unused', readHead: async () => '35e21028080ccbda9de04d2239b0a0b2336d868f' }),
      /pin mismatch/,
    );
  });

  it('verifies every manifest digest and fails on a changed file', async () => {
    const root = await tempDir('rqw-oracle-src-');
    await mkdir(join(root, 'a'), { recursive: true });
    const aBody = 'pub fn a() {}\n';
    const instrumentedBody = 'instrumented base\n';
    await writeFile(join(root, 'a/lib.rs'), aBody);
    await mkdir(join(root, 'core/tests/common'), { recursive: true });
    await writeFile(join(root, RESPONSES_RS), instrumentedBody);
    const manifest = { sourceFiles: [{ path: 'a/lib.rs', sha256: sha256Hex(Buffer.from(aBody)) }] };
    const digest: [string, string] = [RESPONSES_RS, sha256Hex(Buffer.from(instrumentedBody))];

    assert.equal(await verifyDigests({ sourceRoot: root, manifest, instrumentedDigest: digest }), 2);

    await writeFile(join(root, 'a/lib.rs'), 'pub fn changed() {}\n');
    await assert.rejects(verifyDigests({ sourceRoot: root, manifest, instrumentedDigest: digest }), /digest mismatch/);
  });
});

describe('macOS temporary retry fixture adaptation', () => {
  const address = '    let unavailable_address = unavailable_socket.local_addr()?;\n';
  const recovery = '    let recovered_server = MockServer::builder()\n'
    + '        .listener(unavailable_socket.listen(/*backlog*/ 128)?.into_std()?)\n';
  const original = 'async fn connection_failures_increment_retry_telemetry_without_consuming_retry_budget() {\n'
    + '    let unavailable_socket = TcpSocket::new_v4()?;\n'
    + '    unavailable_socket.bind("127.0.0.1:0".parse()?)?;\n' + address
    + '    let first_retry = telemetry.next_retry().await;\n'
    + '    assert_eq!(first_retry.attempt, 1);\n' + recovery
    + '        .start()\n        .await;\n}\n';
  const syntheticDigest = sha256Hex(Buffer.from(original));

  it('only releases and recreates the socket on darwin, preserving the native listen and assertions', () => {
    const result = adaptRetryAfterFixture(original, { hostPlatform: 'darwin', expectedSha256: syntheticDigest });
    assert.equal(result.text, original.replace(address, address + '    drop(unavailable_socket);\n')
      .replace(recovery, '    let unavailable_socket = TcpSocket::new_v4()?;\n'
        + '    unavailable_socket.bind(unavailable_address)?;\n' + recovery));
    assert.equal(result.adaptedFixtures.length, 1);
    assert.deepEqual(result.adaptedFixtures[0], {
      ...MACOS_RETRY_FIXTURE, sourceSha256: syntheticDigest, adaptedSha256: sha256Hex(Buffer.from(result.text)),
    });
    assert.deepEqual(adaptRetryAfterFixture(original, { hostPlatform: 'win32' }), { text: original, adaptedFixtures: [] });
    assert.deepEqual(adaptRetryAfterFixture(original, { hostPlatform: 'linux' }), { text: original, adaptedFixtures: [] });
  });

  it('refuses source drift, repeated application, missing and duplicated anchors', () => {
    assert.throws(() => adaptRetryAfterFixture(original, { hostPlatform: 'darwin' }), /digest mismatch/);
    const adapted = adaptRetryAfterFixture(original, { hostPlatform: 'darwin', expectedSha256: syntheticDigest });
    assert.throws(() => adaptRetryAfterFixture(adapted.text, { hostPlatform: 'darwin', expectedSha256: syntheticDigest }), /digest mismatch/);
    for (const text of [original.replace(address, ''), original + address, original.replace(recovery, ''), original + recovery]) {
      assert.throws(() => adaptRetryAfterFixture(text, { hostPlatform: 'darwin', expectedSha256: sha256Hex(Buffer.from(text)) }), /anchor found [02] times/);
    }
  });

  it('checks declared identity, platform, reason, evidence and source hash', () => {
    const entry = { ...MACOS_RETRY_FIXTURE, adaptedSha256: '1'.repeat(64) };
    const run = { os: { platform: 'darwin' }, adaptedFixtures: [entry] };
    assert.deepEqual(checkAdaptedFixtures(run), []);
    assert.deepEqual(checkAdaptedFixtures({ os: { platform: 'win32' }, adaptedFixtures: [] }), []);
    assert.ok(checkAdaptedFixtures({ ...run, adaptedFixtures: [] }).length);
    assert.ok(checkAdaptedFixtures({ os: { platform: 'darwin' } }).length);
    for (const key of ['id', 'path', 'sourceSha256', 'platform', 'reason', 'evidence', 'adaptedSha256']) {
      assert.ok(checkAdaptedFixtures({ ...run, adaptedFixtures: [{ ...entry, [key]: 'wrong' }] }).length, key);
    }
    assert.ok(checkAdaptedFixtures({ ...run, os: { platform: 'win32' } }).length);
  });

  it('adapts the actual pinned file when available, without writing evidence', async (t) => {
    const nativePath = join(dirname(PINNED_RESPONSES_RS), '../suite/retry_after.rs');
    const text = await readFile(nativePath, 'utf8').catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (text === null) return t.skip('pinned retry_after.rs not present');
    assert.equal(sha256Hex(Buffer.from(text)), RETRY_AFTER_RS_SHA256);
    assert.equal(RETRY_AFTER_RS, 'core/tests/suite/retry_after.rs');
    const result = adaptRetryAfterFixture(text, { hostPlatform: 'darwin' });
    assert.equal(result.adaptedFixtures[0].sourceSha256, RETRY_AFTER_RS_SHA256);
    assert.equal(result.text.replace('    drop(unavailable_socket);\n', '')
      .replace('    let unavailable_socket = TcpSocket::new_v4()?;\n    unavailable_socket.bind(unavailable_address)?;\n', ''), text);
  });
});

describe('temp work copy guard', () => {
  it('cleans only its fresh harness directory inside an existing nonempty work root', async () => {
    const source = await tempDir('rqw-oracle-source-');
    const root = await tempDir('rqw-oracle-caller-');
    await writeFile(join(root, 'unrelated.txt'), 'caller data');
    await mkdir(join(root, 'codex-rs'));
    await writeFile(join(root, 'codex-rs', 'unrelated.txt'), 'caller source');
    const { workRoot, cleanup } = await createHarnessWork({ work: root, sourceRoot: source });
    // Check the deletion boundary before invoking cleanup, including on the faulty implementation.
    assert.equal(dirname(workRoot), await realpath(root));
    assert.match(workRoot.slice(dirname(workRoot).length + 1), /^rqw-codex-oracle-/);
    assert.deepEqual(await readdir(workRoot), []);
    await mkdir(join(workRoot, 'codex-rs'));
    await writeFile(join(workRoot, 'codex-rs', 'artifact.txt'), 'harness data');
    const second = await createHarnessWork({ work: root, sourceRoot: source });
    assert.notEqual(second.workRoot, workRoot);
    await second.cleanup();
    await cleanup();
    await assert.rejects(readdir(workRoot), { code: 'ENOENT' });
    assert.equal(await readFile(join(root, 'unrelated.txt'), 'utf8'), 'caller data');
    assert.equal(await readFile(join(root, 'codex-rs', 'unrelated.txt'), 'utf8'), 'caller source');
    assert.deepEqual((await readdir(root)).sort(), ['codex-rs', 'unrelated.txt']);
  });

  it('keeps only harness work when keep-work is requested and creates a missing work parent', async () => {
    const source = await tempDir('rqw-oracle-source-');
    const root = await tempDir('rqw-oracle-caller-');
    const work = join(root, 'new-parent');
    const { workRoot, cleanup } = await createHarnessWork({ work, sourceRoot: source, keepWork: true });
    assert.equal(dirname(workRoot), await realpath(work));
    await writeFile(join(workRoot, 'artifact.txt'), 'retained harness data');
    await cleanup();
    assert.equal(await readFile(join(workRoot, 'artifact.txt'), 'utf8'), 'retained harness data');
    assert.deepEqual(await readdir(work), [workRoot.slice(dirname(workRoot).length + 1)]);
  });

  it('creates and cleans a default harness directory directly inside OS temp', async () => {
    const source = await tempDir('rqw-oracle-source-');
    const { workRoot, cleanup } = await createHarnessWork({ sourceRoot: source });
    roots.push(workRoot);
    assert.equal(dirname(workRoot), await realpath(tmpdir()));
    assert.match(workRoot.slice(dirname(workRoot).length + 1), /^rqw-codex-oracle-/);
    await cleanup();
    await assert.rejects(readdir(workRoot), { code: 'ENOENT' });
  });

  it('accepts a new directory inside the OS temp directory', async () => {
    const source = await tempDir('rqw-oracle-source-');
    const work = join(tmpdir(), 'rqw-oracle-work-check-not-created');
    const resolved = await assertTempWorkDir({ work, sourceRoot: source, tmp: tmpdir() });
    assert.ok(resolved.endsWith('rqw-oracle-work-check-not-created'));
  });

  it('refuses a work dir outside temp, inside the source, equal to the source, or in a protected checkout', async () => {
    const source = await tempDir('rqw-oracle-source-');
    await assert.rejects(assertTempWorkDir({ work: '/Users/example/work', sourceRoot: source }), /must be inside OS temp/);
    await assert.rejects(assertTempWorkDir({ work: join(source, 'copy'), sourceRoot: source }), /overlaps the source/);
    await assert.rejects(assertTempWorkDir({ work: source, sourceRoot: source }), /overlaps the source/);
    const evidence = join(tmpdir(), 'my-pi-evidence-fixture-guard');
    await assert.rejects(assertTempWorkDir({ work: evidence, sourceRoot: source }), /protected checkout/);
  });
});

describe('redaction', () => {
  it('redacts authorization and cookies case-insensitively and keeps other headers', () => {
    const redacted = redactHeaders([
      ['Authorization', 'Bearer abcdefghijklmnop'],
      ['cookie', '__cf_bm=secret'],
      ['Set-Cookie', 'x=y'],
      ['x-api-key', 'k'],
      ['content-type', 'application/json'],
    ]);
    assert.deepEqual(redacted, [
      ['Authorization', '[REDACTED]'],
      ['cookie', '[REDACTED]'],
      ['Set-Cookie', '[REDACTED]'],
      ['x-api-key', '[REDACTED]'],
      ['content-type', 'application/json'],
    ]);
  });

  it('rewrites header values of capture files on disk', async () => {
    const dir = await tempDir('rqw-oracle-cap-');
    await writeFile(
      join(dir, 'one.json'),
      JSON.stringify({ kind: 'http', headers: [['authorization', 'Bearer xxxxxxxxxxxx']], raw_file: 'one.raw.bin' }),
    );
    await redactCaptureDir(dir);
    const meta = JSON.parse(await readFile(join(dir, 'one.json'), 'utf8'));
    assert.deepEqual(meta.headers, [['authorization', '[REDACTED]']]);
    assert.equal(meta.rawSemantics, 'wire-body-bytes');
  });

  it('labels websocket control and close records with message-level raw semantics and keeps the close code note', async () => {
    const dir = await tempDir('rqw-oracle-labels-');
    const records = [
      { kind: 'ws-ping', note: '' },
      { kind: 'ws-pong', note: '' },
      { kind: 'ws-close', note: 'code=1000' },
      { kind: 'ws-text', note: '' },
    ];
    for (const [index, record] of records.entries()) {
      await writeFile(
        join(dir, `r${index}.json`),
        JSON.stringify({ ...record, headers: [], raw_file: `r${index}.raw.bin` }),
      );
    }
    await redactCaptureDir(dir);
    const metas = await Promise.all(records.map((_, index) => readFile(join(dir, `r${index}.json`), 'utf8')));
    const [ping, pong, close, text] = metas.map((line) => JSON.parse(line));
    assert.equal(ping.rawSemantics, 'ws-message-control-ping-payload');
    assert.equal(pong.rawSemantics, 'ws-message-control-pong-payload');
    assert.equal(close.rawSemantics, 'ws-message-control-close-reason-bytes');
    assert.equal(close.note, 'code=1000');
    assert.equal(text.rawSemantics, 'ws-message-text-original-utf8-bytes');
    for (const meta of [ping, close, text]) {
      assert.match(meta.rawBoundary, /not raw TCP, masked frame bytes or TLS records/);
    }
    assert.deepEqual(await countCaptureKinds(dir), { 'ws-ping': 1, 'ws-pong': 1, 'ws-close': 1, 'ws-text': 1 });
    assert.equal(rawBoundaryOf('http'), 'HTTP request body bytes as received by the wiremock mock');
    assert.equal(RAW_SEMANTICS['ws-handshake'], 'no-body');
  });
});

describe('instrumentation of upstream responses.rs', () => {
  it('adds one capture call per receive point and appends the recorder', () => {
    const out = instrumentResponsesRs(fakeResponsesRs());
    assert.equal(out.split('rqw_oracle_record_http(request);').length - 1, 1);
    assert.equal(out.split('rqw_oracle_record_ws(message);').length - 1, 1);
    assert.equal(out.split('rqw_oracle_record("ws-handshake"').length - 1, 1);
    assert.match(out, /fn rqw_oracle_record_http\(request: &wiremock::Request\)/);
    assert.match(out, /fn rqw_oracle_record_ws\(message: &tokio_tungstenite::tungstenite::Message\)/);
    assert.match(out, /RQW_ORACLE_CAPTURE_DIR/);
    // Per-case identity: the actual native test name and a per-case filename prefix from the environment.
    assert.match(out, /"test": test,/);
    assert.match(out, /RQW_ORACLE_CASE_PREFIX/);
    assert.equal(out.split('rqw_oracle_record_script(&events);').length - 1, 1);
    assert.match(out, /fn rqw_oracle_record_script\(events: &\[serde_json::Value\]\)/);
    assert.ok(out.includes(`"pin": "${PIN_COMMIT}",`));
  });

  it('does not instrument the body_json accessors (no duplicate capture)', () => {
    const out = instrumentResponsesRs(fakeResponsesRs());
    // The only "http" record call is the one inside the rqw_oracle_record_http helper, not in a body_json accessor.
    assert.equal(out.split('rqw_oracle_record("http"').length - 1, 1);
    assert.ok(out.indexOf('rqw_oracle_record("http"') > out.indexOf('fn rqw_oracle_record_http('));
    assert.equal(out.split('rqw_oracle_record("ws-frame"').length - 1, 0);
    assert.equal(out.split('rqw_oracle_record_http(').length - 1, 2);
  });

  it('records a websocket message right after ws_stream.next yields it, before close/parse handling', () => {
    const out = instrumentResponsesRs(fakeResponsesRs());
    const next = out.indexOf('message = ws_stream.next() => message,');
    const call = out.indexOf('rqw_oracle_record_ws(message);');
    const breakArm = out.indexOf('let Some(Ok(message)) = message else');
    assert.ok(next > 0 && next < call && call < breakArm);
  });

  it('keeps the child RUST_MIN_STACK at the native 8 MiB or larger, scoped to the child env', () => {
    const base = { PATH: '/bin', RUST_MIN_STACK: '2097152' };
    const env = childTestEnv(base, { captureDir: '/tmp/cap', scenarioId: 'turn_state' });
    assert.equal(env.RUST_MIN_STACK, String(RUST_MIN_STACK_BYTES));
    assert.equal(RUST_MIN_STACK_BYTES, 8388608);
    assert.equal(env.RQW_ORACLE_CAPTURE_DIR, '/tmp/cap');
    assert.equal(env.RQW_ORACLE_SCENARIO, 'turn_state');
    assert.equal(env.PATH, '/bin');
    assert.equal(base.RUST_MIN_STACK, '2097152');
    assert.equal(childTestEnv({}, { captureDir: '/tmp/cap' }).RQW_ORACLE_SCENARIO, undefined);
    assert.equal(childTestEnv({ RUST_MIN_STACK: '16777216' }, { captureDir: '/c' }).RUST_MIN_STACK, '16777216');
    assert.equal(HARNESS_ENVIRONMENT.RUST_MIN_STACK, '8388608');
  });

  it('passes the actual native test name and the per-case capture prefix to the child, unique per test', () => {
    const name = 'suite::turn_state::websocket_turn_state_is_stable_within_turn';
    const prefix = casePrefix('turn_state', name);
    assert.match(prefix, /^turn_state-[0-9a-f]{12}$/);
    assert.notEqual(prefix, casePrefix('turn_state', `${name}x`));
    const env = childTestEnv({}, { captureDir: '/tmp/cap', scenarioId: 'turn_state', testName: name, capturePrefix: prefix });
    assert.equal(env.RQW_ORACLE_TEST, name);
    assert.equal(env.RQW_ORACLE_CASE_PREFIX, prefix);
    assert.equal(childTestEnv({}, { captureDir: '/tmp/cap' }).RQW_ORACLE_TEST, undefined);
  });

  it('reports a spawn failure as a failed command instead of hanging', async () => {
    const dir = await tempDir('rqw-oracle-spawn-');
    const result = await runCommand('rqw-no-such-binary-for-spawn-test', [], {
      cwd: dir,
      env: process.env,
      timeoutMs: 10_000,
    });
    assert.equal(result.code, -1);
    assert.match(result.stdout, /spawn error for rqw-no-such-binary-for-spawn-test/);
  });

  it('fails when an anchor is missing or appears twice', () => {
    assert.throws(() => instrumentResponsesRs('fn nothing() {}\n'), /instrumentation anchor found 0 times/);
    assert.throws(() => instrumentResponsesRs(fakeResponsesRs(ANCHOR_HTTP)), /instrumentation anchor found 2 times/);
  });

  it('keeps the upstream mock matching body (no semantic change beyond recording)', () => {
    const out = instrumentResponsesRs(fakeResponsesRs());
    assert.ok(out.includes(ANCHOR_HTTP + '\n        validate_request_body_invariants(request);\n'));
    assert.ok(out.includes('pub fn sse(events: Vec<Value>) -> String {\n    rqw_oracle_record_script(&events);\n'));
    assert.ok(out.indexOf('rqw_oracle_record_http(request);') < out.indexOf(ANCHOR_HTTP));
  });

  it('verifies the anchors are unique in the actual pinned source text (read-only)', async (t) => {
    const text = await readFile(PINNED_RESPONSES_RS, 'utf8').catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (text === null) return t.skip(`pinned responses.rs not present at ${PINNED_RESPONSES_RS}`);
    assert.equal(sha256Hex(Buffer.from(text)), RESPONSES_RS_SHA256);
    // Throws when any of the three anchors is not exactly once in the real text.
    const out = instrumentResponsesRs(text);
    assert.equal(out.split('rqw_oracle_record_http(request);').length - 1, 1);
    assert.equal(out.split('rqw_oracle_record_ws(message);').length - 1, 1);
    assert.equal(out.split('rqw_oracle_record("ws-handshake"').length - 1, 1);
    assert.equal(out.split('rqw_oracle_record_script(&events);').length - 1, 1);
    const mock = out.indexOf('impl Match for ResponseMock {');
    assert.ok(mock > 0 && out.indexOf('rqw_oracle_record_http(request);', mock) > mock);
    const next = out.indexOf('message = ws_stream.next() => message,');
    const call = out.indexOf('rqw_oracle_record_ws(message);');
    assert.ok(next > 0 && next < call);
    assert.ok(call < out.indexOf('let Some(Ok(message)) = message else', call));
  });
});

describe('filters and libtest parsing', () => {
  const names = [
    'suite::responses_lite::base_instructions_use_input_items::standard: test',
    'suite::responses_lite::base_instructions_use_input_items::responses_lite: test',
    'suite::turn_state::responses_turn_state_persists_within_turn_and_resets_after: test',
    'suite::turn_state::websocket_turn_state_is_stable_within_turn: test',
    'suite::turn_state::websocket_turn_state_persists_within_turn_and_resets_after: test',
    'suite::websocket_fallback::websocket_fallback_is_sticky_across_turns: test',
    'suite::websocket_fallback::websocket_fallback_switches_to_http_on_upgrade_required_connect: test',
    'suite::websocket_fallback::websocket_fallback_switches_to_http_after_retries_exhausted: test',
    'suite::websocket_fallback::websocket_fallback_hides_first_websocket_retry_stream_error: test',
    'suite::request_compression::request_body_is_zstd_compressed_for_codex_backend_when_enabled: test',
    'suite::retry_after::responses_http_uses_retry_after: test',
    'suite::compact_remote::some_remote_case: test',
    'suite::reasoning_effort_override::reasoning_effort_override_persistent_transitions::high_to_persistent_and_back: test',
    'suite::websocket_fallback::extra_case: test',
    'suite::other::unrelated: test',
    'running 3 tests',
    '',
  ].join('\n');

  it('parses only lines ending with ": test"', () => {
    const parsed = parseTestList(names);
    assert.equal(parsed.length, 15);
    assert.equal(countMatches(parsed, 'suite::websocket_fallback::'), 5);
    assert.equal(parsed.includes('running 3 tests'), false);
  });

  it('counts substring matches and asserts every scenario filter matches at least its minimum', () => {
    const parsed = parseTestList(names);
    assert.equal(countMatches(parsed, 'suite::turn_state::'), 3);
    const report = assertFiltersMatch(parsed);
    assert.equal(report.length, SCENARIOS.length);
    assert.equal(report.find((entry) => entry.id === 'base_instructions_use_input_items')?.matched, 2);
  });

  it('fails instead of silently skipping a scenario with zero matching tests', () => {
    assert.throws(() => assertFiltersMatch(['suite::other::unrelated']), /0 test\(s\) match/);
  });

  it('sums libtest summaries and reports a run without a summary as not found', () => {
    const stdout = [
      'test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 9 filtered out',
      'test result: ok. 1 passed; 1 failed; 0 ignored',
    ].join('\n');
    assert.deepEqual(parseLibtestSummary(stdout), { found: true, passed: 3, failed: 1 });
    assert.deepEqual(parseLibtestSummary('running 0 tests\n'), { found: false, passed: 0, failed: 0 });
  });

  it('validates the scenario table itself', () => {
    assert.equal(validateScenarios(), SCENARIOS.length);
    assert.throws(
      () => validateScenarios([{ id: 'a', filter: 'x', expectMin: 0 }]),
      /expectMin must be >= 1/,
    );
    assert.throws(
      () =>
        validateScenarios([
          { id: 'a', filter: 'x', expectMin: 1 },
          { id: 'a', filter: 'y', expectMin: 1 },
        ]),
      /duplicate scenario/,
    );
  });
});

describe('raw record semantics', () => {
  const body = { model: 'synthetic', input: [{ role: 'user', content: 'é/"x"' }] };

  function httpMeta(raw: Buffer, decoded: unknown, headers: Array<[string, string]> = []) {
    return {
      kind: 'http',
      seq: 0,
      scenario: 'turn_state',
      test: 'suite::turn_state::case',
      pin: PIN_COMMIT,
      uri: '/v1/responses',
      note: '',
      headers,
      raw_file: 'x.raw.bin',
      decoded_json: decoded,
      rawBytes: raw.length,
    };
  }

  it('compares parsed JSON semantics and keeps the raw text bytes (key order and escapes untouched)', () => {
    const raw = Buffer.from('{"model":"synthetic","input":[{"role":"user","content":"\\u00e9\\/\\"x\\""}]}');
    assert.equal(raw.toString('utf8'), '{"model":"synthetic","input":[{"role":"user","content":"\\u00e9\\/\\"x\\""}]}');
    assert.deepEqual(checkCaptureRecord(httpMeta(raw, body), raw), []);
    // Reordered keys in the decoded copy are still the same JSON value.
    const reordered = { input: body.input, model: 'synthetic' };
    assert.deepEqual(checkCaptureRecord(httpMeta(raw, reordered), raw), []);
    assert.ok(checkCaptureRecord(httpMeta(raw, { ...body, model: 'other' }), raw).some((line) => /decoded_json differs/.test(line)));
  });

  it('flags a raw HTTP body that is not JSON, a missing pin and a missing per-test name', () => {
    const raw = Buffer.from('not json');
    const failures = checkCaptureRecord({ ...httpMeta(raw, null), pin: 'other', test: '' }, raw);
    assert.ok(failures.some((line) => /http raw body is not JSON/.test(line)));
    assert.ok(failures.some((line) => /pin other/.test(line)));
    assert.ok(failures.some((line) => /per-test thread name/.test(line)));
  });

  it('flags a uri that carries a query string', () => {
    const raw = Buffer.from('{}');
    const failures = checkCaptureRecord({ ...httpMeta(raw, {}), uri: '/v1/responses?api-key=secret' }, raw);
    assert.ok(failures.some((line) => /query string/.test(line)));
  });

  it('accepts websocket records without a JSON requirement and checks only their identity fields', () => {
    const raw = Buffer.from([0x89, 0x00]);
    const ping = { kind: 'ws-ping', scenario: 'websocket_fallback', test: 'suite::websocket_fallback::case', pin: PIN_COMMIT, uri: '', note: '' };
    assert.deepEqual(checkCaptureRecord(ping, raw), []);
    assert.ok(checkCaptureRecord({ ...ping, kind: 'ws-unknown' }, raw).some((line) => /unknown kind/.test(line)));
  });

  it('checks zstd bodies by frame magic, decoded_json and (when available) the decoded bytes', { skip: typeof zlib.zstdCompressSync !== 'function' }, () => {
    const headers: Array<[string, string]> = [['content-encoding', 'zstd']];
    const raw = zlib.zstdCompressSync(Buffer.from(JSON.stringify(body)));
    assert.deepEqual(checkCaptureRecord(httpMeta(raw, body, headers), raw), []);
    assert.ok(checkCaptureRecord(httpMeta(raw, null, headers), raw).some((line) => /zstd body without decoded_json/.test(line)));
    assert.ok(checkCaptureRecord(httpMeta(raw, { model: 'other' }, headers), raw).some((line) => /zstd decoded_json differs/.test(line)));
    const plain = Buffer.from('plain');
    assert.ok(checkCaptureRecord(httpMeta(plain, body, headers), plain).some((line) => /zstd frame magic/.test(line)));
  });
});

describe('capture integrity', () => {
  // One fixture case per expected test, each with its own native name and capture prefix (one process each).
  function fixtureScenarios() {
    return SCENARIOS.map((scenario) => {
      const cases = Array.from({ length: scenario.expectMin }, (_, index) => {
        const fullName = `${scenario.filter}case${index}`;
        return {
          fullName,
          capturePrefix: casePrefix(scenario.id, fullName),
          expectedEntries: 1,
          exitCode: 0,
          found: true,
          passed: 1,
          failed: 0,
          ok: true,
          log: `logs/cases/${casePrefix(scenario.id, fullName)}.log`,
        };
      });
      return {
        id: scenario.id,
        filter: scenario.filter,
        expectMin: scenario.expectMin,
        matched: cases.length,
        passed: cases.length,
        failed: 0,
        failedCases: 0,
        ok: true,
        cases,
      };
    });
  }

  async function fixtureOut(
    captures: Array<Record<string, unknown>>,
    rawBodies: Record<string, string>,
    runOverrides: Record<string, unknown> = {},
    listText?: string,
  ) {
    const out = await tempDir('rqw-oracle-out-');
    await mkdir(join(out, 'captures'), { recursive: true });
    await mkdir(join(out, 'logs'), { recursive: true });
    const listed = fixtureScenarios().flatMap((scenario) => scenario.cases.map((entry) => `${entry.fullName}: test`));
    await writeFile(join(out, 'logs', 'list.log'), listText ?? listed.join('\n') + '\n');
    await writeFile(
      join(out, 'run.json'),
      JSON.stringify({ sourceCommit: PIN_COMMIT, os: { platform: 'win32' }, adaptedFixtures: [], scenarios: fixtureScenarios(), ...runOverrides }),
    );
    for (const [name, body] of Object.entries(rawBodies)) {
      await writeFile(join(out, 'captures', name), body);
    }
    for (const meta of captures) {
      const prefix = casePrefix(String(meta.scenario), String(meta.test));
      await writeFile(join(out, 'captures', `${prefix}-${meta.kind}-${meta.seq}.json`), JSON.stringify(meta));
    }
    return out;
  }

  function fullCaptures(overrides: Record<string, unknown> = {}) {
    return SCENARIOS.filter((scenario) => scenario.requireCaptures).map((scenario) => ({
      kind: 'http',
      seq: 0,
      scenario: scenario.id,
      test: `${scenario.filter}case0`,
      pin: PIN_COMMIT,
      uri: '/v1/responses',
      note: '',
      headers: [['content-type', 'application/json']],
      raw_file: `${scenario.id}.raw`,
      decoded_json: { model: 'synthetic' },
      ...overrides,
    }));
  }

  it('passes a consistent synthetic output (requires captures for every required scenario)', async () => {
    const captures = fullCaptures();
    const raws = Object.fromEntries(captures.map((meta) => [`${meta.scenario}.raw`, '{"model":"synthetic"}']));
    const out = await fixtureOut(captures, raws);
    assert.deepEqual(await checkOutput({ out, commit: PIN_COMMIT }), []);
  });

  it('rejects missing, wrong-platform or wrong-source adaptation metadata in run.json', async () => {
    const captures = fullCaptures();
    const raws = Object.fromEntries(captures.map((meta) => [`${meta.scenario}.raw`, '{"model":"synthetic"}']));
    const adaptedFixtures = [{ ...MACOS_RETRY_FIXTURE, adaptedSha256: '1'.repeat(64) }];
    const good = await fixtureOut(captures, raws, { os: { platform: 'darwin' }, adaptedFixtures });
    assert.deepEqual(await checkOutput({ out: good }), []);
    for (const overrides of [
      { os: { platform: 'darwin' }, adaptedFixtures: [] },
      { os: { platform: 'win32' }, adaptedFixtures },
      { os: { platform: 'darwin' }, adaptedFixtures: [{ ...adaptedFixtures[0], sourceSha256: '0'.repeat(64) }] },
    ]) {
      const failures = await checkOutput({ out: await fixtureOut(captures, raws, overrides) });
      assert.ok(failures.some((failure: string) => /adaptedFixtures/.test(failure)));
    }
  });

  it('flags a leaked bearer token, a leaked authorization header and a body/JSON mismatch', async () => {
    const captures = fullCaptures();
    captures[0] = { ...captures[0], headers: [['authorization', 'Bearer abcdefghijkl']] };
    captures[1] = { ...captures[1], decoded_json: { model: 'other' } };
    const raws = Object.fromEntries(captures.map((meta) => [`${meta.scenario}.raw`, '{"model":"synthetic"}']));
    const failures = await checkOutput({ out: await fixtureOut(captures, raws), commit: PIN_COMMIT });
    assert.ok(failures.some((line) => /bearer token/.test(line)));
    assert.ok(failures.some((line) => /leaks header authorization/.test(line)));
    assert.ok(failures.some((line) => /decoded_json differs/.test(line)));
  });

  it('flags a run from another commit and a required scenario with no captures', async () => {
    const captures = fullCaptures().slice(1);
    const raws = Object.fromEntries(captures.map((meta) => [`${meta.scenario}.raw`, '{"model":"synthetic"}']));
    const failures = await checkOutput({
      out: await fixtureOut(captures, raws, {}),
      commit: '35e21028080ccbda9de04d2239b0a0b2336d868f',
    });
    assert.ok(failures.some((line) => /sourceCommit/.test(line)));
    assert.ok(failures.some((line) => /no captures for scenario/.test(line)));
  });

  it('flags a capture whose raw file is missing', async () => {
    const captures = fullCaptures();
    const raws = Object.fromEntries(captures.slice(1).map((meta) => [`${meta.scenario}.raw`, '{"model":"synthetic"}']));
    const failures = await checkOutput({ out: await fixtureOut(captures, raws), commit: PIN_COMMIT });
    assert.ok(failures.some((line) => /raw file .* is missing/.test(line)));
  });

  it('flags a scenario that matches zero listed tests and a list that disagrees with the matched count', async () => {
    const failures = await checkOutput({ out: await fixtureOut([], {}, {}, ''), commit: PIN_COMMIT });
    assert.ok(failures.some((line) => /matches zero listed tests/.test(line)));
    assert.ok(failures.some((line) => /matched \d+ != listed/.test(line)));
  });

  it('flags a failed case (non-zero exit or failed count) and a missing case list', async () => {
    const scenarios = fixtureScenarios();
    scenarios[0].cases[0] = { ...scenarios[0].cases[0], ok: false, exitCode: 101, failed: 1, passed: 0 };
    scenarios[1].cases = [];
    const failures = await checkOutput({ out: await fixtureOut([], {}, { scenarios }), commit: PIN_COMMIT });
    assert.ok(failures.some((line) => /not ok \(exit 101\)/.test(line)));
    assert.ok(failures.some((line) => /has no case records/.test(line)));
  });

  it('flags a capture whose test is not a recorded case of its scenario', async () => {
    const captures = fullCaptures();
    captures[0] = { ...captures[0], test: 'suite::unknown::case' };
    const raws = Object.fromEntries(captures.map((meta) => [`${meta.scenario}.raw`, '{"model":"synthetic"}']));
    const failures = await checkOutput({ out: await fixtureOut(captures, raws), commit: PIN_COMMIT });
    assert.ok(failures.some((line) => /not associated with a case/.test(line)));
  });

  it('flags a case whose capture prefix does not match its native test name', async () => {
    const scenarios = fixtureScenarios();
    scenarios[0].cases[0] = { ...scenarios[0].cases[0], capturePrefix: 'wrong-000000000000' };
    const failures = await checkOutput({ out: await fixtureOut([], {}, { scenarios }), commit: PIN_COMMIT });
    assert.ok(failures.some((line) => /wrong capture prefix/.test(line)));
  });

  it('checks scripted-server-event records: constructed stage and the recorded events', () => {
    const events = [{ type: 'response.created' }];
    const meta = {
      kind: 'server-script',
      stage: 'constructed-not-network-received',
      scenario: 'turn_state',
      test: 'suite::turn_state::case0',
      pin: PIN_COMMIT,
      uri: '',
      note: '',
      decoded_json: events,
    };
    const raw = Buffer.from(JSON.stringify(events));
    assert.deepEqual(checkCaptureRecord(meta, raw), []);
    assert.ok(checkCaptureRecord({ ...meta, stage: 'network' }, raw).some((line) => /stage/.test(line)));
    assert.ok(checkCaptureRecord({ ...meta, decoded_json: [] }, raw).some((line) => /decoded_json differs/.test(line)));
    assert.equal(RAW_SEMANTICS['server-script'], 'constructed-scripted-events-json-not-network-bytes');
  });
});
