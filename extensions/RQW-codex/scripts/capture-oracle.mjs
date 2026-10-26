#!/usr/bin/env node
// Stage 1 Codex oracle harness: runs the pinned upstream codex-core tests on a TEMP copy of codex-rs and
// records the requests they build. Nothing here writes into the source checkout or the evidence originals.
//
// Usage:
//   node capture-oracle.mjs run   --source <clone>/codex-rs --commit <sha> --out <dir> [--work <dir>] [--keep-work]
//   node capture-oracle.mjs check --out <dir> --commit <sha>
// --work is a parent directory; only a fresh rqw-codex-oracle-* child is used and removed.
// --keep-work retains that child. The parent and its existing contents are never cleaned up.
//
// Source digests come from test/fixtures/oracle-source.json (sourceFiles[].sha256, relative to codex-rs) and
// the pre-edit digest of core/tests/common/responses.rs pinned below. Both are verified before any copy is edited.

import { createHash } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import * as zlib from 'node:zlib';
import { isDeepStrictEqual } from 'node:util';
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { arch, platform, release, tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const PIN_COMMIT = '83086188ae0614bd882818ff1aa23f3194962012';
export const PIN_RELEASE = 'rust-v0.163.0';
export const PIN_VERSION = '0.163.0';

const here = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_MANIFEST = resolve(here, '../../../test/extensions/RQW-codex/fixtures/oracle-source.json');

// Pre-edit digest of the one upstream file the harness instruments (not listed in oracle-source.json).
export const RESPONSES_RS = 'core/tests/common/responses.rs';
export const RESPONSES_RS_SHA256 = '505a826f569e614ab005cb0eee5b4c3351c7a3886d2184c4bd586a2bf27ba49c';

export const RETRY_AFTER_RS = 'core/tests/suite/retry_after.rs';
export const RETRY_AFTER_RS_SHA256 = '2437e45336c5d3e811158aeb43963992860499cc1e9e66b939ad223d9e4d12af';
export const MACOS_RETRY_FIXTURE = Object.freeze({
  id: 'darwin-closed-port-until-recovery',
  path: RETRY_AFTER_RS,
  sourceSha256: RETRY_AFTER_RS_SHA256,
  platform: 'darwin',
  reason: 'A bound non-listening socket stalls macOS connect; release it until recovery binds the same address.',
  evidence: 'https://github.com/ARQAWA/my-pi/actions/runs/39951670171',
});

// Only the pinned temporary fixture changes: all retry assertions, delays and listen backlog stay native.
export function adaptRetryAfterFixture(text, { hostPlatform = platform(), expectedSha256 = RETRY_AFTER_RS_SHA256 } = {}) {
  if (hostPlatform !== 'darwin') return { text, adaptedFixtures: [] };
  if (sha256Hex(Buffer.from(text)) !== expectedSha256) throw new Error('retry_after fixture source digest mismatch');
  const address = '    let unavailable_address = unavailable_socket.local_addr()?;\n';
  const recovery = '    let recovered_server = MockServer::builder()\n'
    + '        .listener(unavailable_socket.listen(/*backlog*/ 128)?.into_std()?)\n';
  for (const anchor of [address, recovery]) {
    const count = text.split(anchor).length - 1;
    if (count !== 1) throw new Error(`retry_after fixture anchor found ${count} times`);
  }
  const adapted = text.replace(address, address + '    drop(unavailable_socket);\n')
    .replace(recovery, '    let unavailable_socket = TcpSocket::new_v4()?;\n'
      + '    unavailable_socket.bind(unavailable_address)?;\n' + recovery);
  return {
    text: adapted,
    adaptedFixtures: [{ ...MACOS_RETRY_FIXTURE, sourceSha256: expectedSha256, adaptedSha256: sha256Hex(Buffer.from(adapted)) }],
  };
}

export function checkAdaptedFixtures(run) {
  if (!Array.isArray(run.adaptedFixtures)) return ['adaptedFixtures must be an array'];
  if (run.os?.platform === 'darwin') {
    const fixture = run.adaptedFixtures[0];
    if (run.adaptedFixtures.length !== 1 || !fixture
      || Object.entries(MACOS_RETRY_FIXTURE).some(([key, value]) => fixture[key] !== value)
      || !/^[0-9a-f]{64}$/.test(fixture.adaptedSha256 ?? '')
      || fixture.adaptedSha256 === RETRY_AFTER_RS_SHA256) {
      return ['adaptedFixtures must declare the pinned darwin retry fixture adaptation'];
    }
  } else if (!run.os?.platform || run.adaptedFixtures.length !== 0) {
    return ['adaptedFixtures platform mismatch'];
  }
  return [];
}

const CARGO_PACKAGE = 'codex-core';
const CARGO_TEST_BINARY = 'all';

// Harness environment for the child cargo test processes, not a protocol change. Native upstream value at the
// pinned commit: justfile `rust_min_stack := "8388608" # 8 MiB` (used as RUST_MIN_STACK for `just test`), and
// RUST_MIN_STACK: "8388608" in .github/workflows/rust-ci.yml, rust-ci-full.yml, rust-ci-full-nextest-platform.yml,
// and `common --test_env=RUST_MIN_STACK=8388608` in .bazelrc. Reason: libtest runs each test body on a std thread
// whose stack is RUST_MIN_STACK (Rust default 2 MiB); the stage 1 macOS run overflowed that stack in every scenario
// before any capture (fatal runtime error: stack overflow, logs/*.log). The value is the upstream CI value, not a
// product timeout or limit.
export const RUST_MIN_STACK_BYTES = 8388608;
export const HARNESS_ENVIRONMENT = {
  RUST_MIN_STACK: String(RUST_MIN_STACK_BYTES),
  source: 'upstream justfile rust_min_stack and .github/workflows/rust-ci.yml, rust-ci-full.yml, rust-ci-full-nextest-platform.yml, .bazelrc (8388608)',
};

// Scenario table: every filter is a libtest substring of the full test path; expectMin is the minimum
// number of tests that must match in `cargo test -- --list` AND pass when the scenario runs.
export const SCENARIOS = [
  {
    id: 'base_instructions_use_input_items',
    filter: 'suite::responses_lite::base_instructions_use_input_items',
    expectMin: 2,
    featureMode: 'test-parameterized: standard and responses_lite cases',
    requireCaptures: true,
  },
  {
    id: 'turn_state',
    filter: 'suite::turn_state::',
    expectMin: 3,
    featureMode: 'default',
    requireCaptures: true,
  },
  {
    id: 'reasoning_effort_override',
    filter: 'suite::reasoning_effort_override::',
    expectMin: 1,
    featureMode: 'per-test: stable default off; tests enable or disable Feature::ReasoningEffortOverride explicitly',
    requireCaptures: true,
  },
  {
    id: 'request_body_is_zstd_compressed_for_codex_backend_when_enabled',
    filter: 'suite::request_compression::request_body_is_zstd_compressed_for_codex_backend_when_enabled',
    expectMin: 1,
    featureMode: 'override: test enables Feature::EnableRequestCompression (stable default on)',
    requireCaptures: true,
  },
  {
    id: 'websocket_fallback',
    filter: 'suite::websocket_fallback::',
    expectMin: 4,
    featureMode: 'default',
    requireCaptures: true,
  },
  {
    id: 'retry_after',
    filter: 'suite::retry_after::',
    expectMin: 1,
    featureMode: 'default',
    requireCaptures: false,
  },
  {
    id: 'compact_remote',
    filter: 'suite::compact_remote::',
    expectMin: 1,
    featureMode: 'per-test: some tests enable extra Feature flags explicitly',
    requireCaptures: true,
  },
];

export const NONDETERMINISTIC_FIELDS = [
  'uuid values (session, thread, window, turn, installation)',
  'unix-ms timestamps in client_metadata and turn metadata',
  'websocket client masking key and ephemeral ports',
  'HashMap iteration order of client_metadata (Rust randomized)',
  'wiremock and test-server bind addresses in URIs',
];

const SECRET_HEADERS = new Set(['authorization', 'cookie', 'set-cookie', 'proxy-authorization', 'x-api-key']);

export function sha256Hex(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

export function redactHeaders(headers) {
  return headers.map(([name, value]) => [name, SECRET_HEADERS.has(String(name).toLowerCase()) ? '[REDACTED]' : value]);
}

// Verifies the pinned commit of the checkout. readHead is injectable for tests; default is read-only git.
export async function checkPin({ sourceRoot, commit = PIN_COMMIT, readHead = gitHead }) {
  const head = (await readHead(sourceRoot)).trim();
  if (head !== commit) {
    throw new Error(`pin mismatch: checkout HEAD ${head} is not pinned ${commit}`);
  }
  return head;
}

export async function gitHead(root) {
  return new Promise((resolvePromise, reject) => {
    execFile('git', ['-C', root, 'rev-parse', '--verify', 'HEAD^{commit}'], (error, stdout) => {
      if (error) reject(error);
      else resolvePromise(stdout);
    });
  });
}

// Verifies pre-edit digests of every manifest source file and of the instrumented responses.rs.
export async function verifyDigests({
  sourceRoot,
  manifest,
  instrumentedDigest = [RESPONSES_RS, RESPONSES_RS_SHA256],
  readFileFn = readFile,
}) {
  const mismatches = [];
  const entries = [...manifest.sourceFiles.map((file) => [file.path, file.sha256]), instrumentedDigest];
  for (const [path, expected] of entries) {
    const actual = sha256Hex(await readFileFn(join(sourceRoot, path)));
    if (actual !== expected) mismatches.push({ path, expected, actual });
  }
  if (mismatches.length > 0) {
    throw new Error(`source digest mismatch: ${JSON.stringify(mismatches)}`);
  }
  return entries.length;
}

// The work location must be under the OS temp directory, outside the source and outside the
// evidence and worktree folders.
export async function assertTempWorkDir({ work, sourceRoot, tmp = tmpdir() }) {
  const realWork = await realpathOfExisting(resolve(work));
  const realTmp = await realpath(tmp);
  const realSource = await realpath(sourceRoot);
  if (!isInside(realWork, realTmp) || realWork === realTmp) {
    throw new Error(`work dir ${realWork} must be inside OS temp ${realTmp}`);
  }
  if (realWork === realSource || isInside(realWork, realSource) || isInside(realSource, realWork)) {
    throw new Error(`work dir ${realWork} overlaps the source ${realSource}`);
  }
  if (/my-pi-evidence|my-pi-worktrees/.test(realWork)) {
    throw new Error(`work dir ${realWork} points into a protected checkout`);
  }
  return realWork;
}

// Keep cleanup bound to the fresh directory, never to the caller's parent directory.
export async function createHarnessWork({ work, sourceRoot, keepWork = false }) {
  const workParent = work ? await assertTempWorkDir({ work, sourceRoot }) : tmpdir();
  await mkdir(workParent, { recursive: true });
  const workRoot = await assertTempWorkDir({
    work: await mkdtemp(join(workParent, 'rqw-codex-oracle-')),
    sourceRoot,
  });
  return {
    workRoot,
    cleanup: async () => {
      if (!keepWork) await rm(workRoot, { recursive: true, force: true });
    },
  };
}

// realpath of the longest existing ancestor, so /var and /private/var compare equal on macOS.
async function realpathOfExisting(path) {
  let current = path;
  const rest = [];
  while (true) {
    try {
      return join(await realpath(current), ...rest);
    } catch {
      const parent = dirname(current);
      if (parent === current) return path;
      rest.unshift(basename(current));
      current = parent;
    }
  }
}

function isInside(child, parent) {
  const rel = relative(parent, child);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

// Anchors of upstream responses.rs (pinned commit), each must occur exactly once in the source text.
export const HTTP_RECEIVE_ANCHOR = '        self.requests\n            .lock()\n            .unwrap()\n            .push(ResponsesRequest(request.clone()));\n';
export const WS_RECEIVE_ANCHOR = '                let Some(Ok(message)) = message else {\n                    break;\n                };\n';
export const WS_HANDSHAKE_ANCHOR = '                handshake_log.lock().unwrap().push(WebSocketHandshake {\n';
// The only definition of sse(events) in core/tests/common/responses.rs (pinned commit).
export const SSE_PRODUCER_ANCHOR = 'pub fn sse(events: Vec<Value>) -> String {\n';

// Exact-once textual instrumentation of upstream responses.rs. Throws if any anchor is not unique.
// The HTTP request is recorded where the mock receives it (ResponseMock::matches), not in the body_json accessor;
// each WebSocket message is recorded right after ws_stream.next() yields it, before close/parse handling.
export function instrumentResponsesRs(text) {
  const replacements = [
    {
      anchor: HTTP_RECEIVE_ANCHOR,
      replacement: '        rqw_oracle_record_http(request);\n' + HTTP_RECEIVE_ANCHOR,
    },
    {
      anchor: WS_RECEIVE_ANCHOR,
      replacement:
        '                if let Some(Ok(message)) = &message {\n' +
        '                    rqw_oracle_record_ws(message);\n' +
        '                }\n' +
        WS_RECEIVE_ANCHOR,
    },
    {
      // Scripted SSE events at the one unique sse(events) producer (constructed, not network-received).
      anchor: SSE_PRODUCER_ANCHOR,
      replacement: SSE_PRODUCER_ANCHOR + '    rqw_oracle_record_script(&events);\n',
    },
    {
      // WebSocket upgrade request headers at the server handshake callback.
      anchor: WS_HANDSHAKE_ANCHOR,
      replacement:
        '                rqw_oracle_record("ws-handshake", &[], req.headers().iter().filter_map(|(n, v)| v.to_str().ok().map(|v| (n.as_str().to_string(), v.to_string()))).collect(), &req.uri().to_string(), None, "");\n' +
        WS_HANDSHAKE_ANCHOR,
    },
  ];
  let out = text;
  for (const { anchor, replacement } of replacements) {
    const count = out.split(anchor).length - 1;
    if (count !== 1) throw new Error(`instrumentation anchor found ${count} times: ${JSON.stringify(anchor.slice(0, 60))}`);
    out = out.replace(anchor, () => replacement);
  }
  return out + RECORDER_RS;
}

const RECORDER_RS = `
// RQW oracle capture: temporary instrumentation added by extensions/RQW-codex/scripts/capture-oracle.mjs.
static RQW_ORACLE_SEQ: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);

fn rqw_oracle_redact(name: &str, value: &str) -> String {
    let lower = name.to_ascii_lowercase();
    if matches!(lower.as_str(), "authorization" | "cookie" | "set-cookie" | "proxy-authorization" | "x-api-key") {
        "[REDACTED]".to_string()
    } else {
        value.to_string()
    }
}

fn rqw_oracle_record(kind: &str, raw: &[u8], headers: Vec<(String, String)>, uri: &str, json: Option<&serde_json::Value>, note: &str) {
    let Some(dir) = std::env::var_os("RQW_ORACLE_CAPTURE_DIR") else {
        return;
    };
    let dir = std::path::PathBuf::from(dir);
    let seq = RQW_ORACLE_SEQ.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    let scenario = std::env::var("RQW_ORACLE_SCENARIO").unwrap_or_default();
    let prefix = std::env::var("RQW_ORACLE_CASE_PREFIX").unwrap_or_default();
    let test = std::env::var("RQW_ORACLE_TEST").unwrap_or_default();
    let stage = if kind == "server-script" { Some("constructed-not-network-received") } else { None };
    let stem = format!("{prefix}-{kind}-{seq:04}");
    std::fs::write(dir.join(format!("{stem}.raw.bin")), raw).expect("write oracle raw capture");
    let headers: Vec<(String, String)> = headers.into_iter().map(|(n, v)| {
        let v = rqw_oracle_redact(&n, &v);
        (n, v)
    }).collect();
    let meta = serde_json::json!({
        "kind": kind,
        "seq": seq,
        "scenario": scenario,
        "test": test,
        "pin": "${PIN_COMMIT}",
        "uri": uri.split('?').next().unwrap_or(""),
        "stage": stage,
        "note": note,
        "headers": headers,
        "raw_file": format!("{stem}.raw.bin"),
        "decoded_json": json,
    });
    std::fs::write(
        dir.join(format!("{stem}.json")),
        serde_json::to_vec_pretty(&meta).expect("serialize oracle capture"),
    )
    .expect("write oracle capture");
}

fn rqw_oracle_record_http(request: &wiremock::Request) {
    let headers: Vec<(String, String)> = request.headers.iter().filter_map(|(n, v)| v.to_str().ok().map(|v| (n.as_str().to_string(), v.to_string()))).collect();
    let encoding = request.headers.get("content-encoding").and_then(|v| v.to_str().ok());
    let decoded: Option<serde_json::Value> = serde_json::from_slice(&decode_body_bytes(&request.body, encoding)).ok();
    rqw_oracle_record("http", &request.body, headers, &request.url.to_string(), decoded.as_ref(), "");
}

fn rqw_oracle_record_script(events: &[serde_json::Value]) {
    let value = serde_json::Value::Array(events.to_vec());
    let raw = serde_json::to_vec(&value).expect("serialize scripted events");
    rqw_oracle_record("server-script", &raw, Vec::new(), "", Some(&value), "");
}

fn rqw_oracle_record_ws(message: &tokio_tungstenite::tungstenite::Message) {
    use tokio_tungstenite::tungstenite::Message;
    match message {
        Message::Text(text) => rqw_oracle_record("ws-text", text.as_bytes(), Vec::new(), "", None, ""),
        Message::Binary(bytes) => rqw_oracle_record("ws-binary", bytes, Vec::new(), "", None, ""),
        Message::Ping(bytes) => rqw_oracle_record("ws-ping", bytes, Vec::new(), "", None, ""),
        Message::Pong(bytes) => rqw_oracle_record("ws-pong", bytes, Vec::new(), "", None, ""),
        Message::Close(frame) => match frame {
            Some(f) => rqw_oracle_record("ws-close", f.reason.as_bytes(), Vec::new(), "", None, &format!("code={}", u16::from(f.code))),
            None => rqw_oracle_record("ws-close", &[], Vec::new(), "", None, "code=none"),
        },
        _ => rqw_oracle_record("ws-other", &[], Vec::new(), "", None, "unclassified"),
    }
}
`;

// Parses `cargo test -- --list` output lines of the form "<path>: test".
export function parseTestList(stdout) {
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.endsWith(': test'))
    .map((line) => line.slice(0, -': test'.length));
}

export function countMatches(names, filter) {
  return names.filter((name) => name.includes(filter)).length;
}

// Parses libtest summary lines and returns total passed/failed counts.
export function parseLibtestSummary(stdout) {
  let passed = 0;
  let failed = 0;
  let found = false;
  for (const match of stdout.matchAll(/test result: \w+\. (\d+) passed; (\d+) failed;/g)) {
    found = true;
    passed += Number(match[1]);
    failed += Number(match[2]);
  }
  return { found, passed, failed };
}

export function validateScenarios(scenarios = SCENARIOS) {
  const ids = new Set();
  for (const scenario of scenarios) {
    if (!scenario.filter || scenario.filter.trim() === '') throw new Error(`empty filter for ${scenario.id}`);
    if (!(scenario.expectMin >= 1)) throw new Error(`expectMin must be >= 1 for ${scenario.id}`);
    if (ids.has(scenario.id)) throw new Error(`duplicate scenario ${scenario.id}`);
    ids.add(scenario.id);
  }
  return scenarios.length;
}

export function assertFiltersMatch(names, scenarios = SCENARIOS) {
  const report = scenarios.map((scenario) => {
    const matched = countMatches(names, scenario.filter);
    if (matched < scenario.expectMin) {
      throw new Error(`scenario ${scenario.id}: ${matched} test(s) match "${scenario.filter}", expected at least ${scenario.expectMin}`);
    }
    return { id: scenario.id, matched };
  });
  return report;
}

// Child environment for cargo: the caller's env plus the harness environment. RUST_MIN_STACK is raised to the
// native 8 MiB when the ambient value is smaller (a larger ambient value is kept). Scoped to the child only.
export function childTestEnv(base, { captureDir, scenarioId, testName, capturePrefix }) {
  const ambient = Number(base.RUST_MIN_STACK);
  const stack = Number.isInteger(ambient) && ambient >= RUST_MIN_STACK_BYTES ? ambient : RUST_MIN_STACK_BYTES;
  const env = { ...base, RUST_MIN_STACK: String(stack), RQW_ORACLE_CAPTURE_DIR: captureDir };
  if (scenarioId !== undefined) env.RQW_ORACLE_SCENARIO = scenarioId;
  if (testName !== undefined) env.RQW_ORACLE_TEST = testName;
  if (capturePrefix !== undefined) env.RQW_ORACLE_CASE_PREFIX = capturePrefix;
  return env;
}

// Capture filename prefix of one test case: one fresh process per native test name, so the prefix is unique.
export function casePrefix(scenarioId, fullName) {
  return `${scenarioId}-${sha256Hex(Buffer.from(fullName)).slice(0, 12)}`;
}

export const CASE_TIMEOUT_MS = 30 * 60 * 1000;

export function runCommand(command, args, { cwd, env, timeoutMs, logFile }) {
  return new Promise((resolvePromise) => {
    let settled = false;
    let timer;
    let out = '';
    const finish = async (code, text) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (logFile) await writeFile(logFile, text);
      resolvePromise({ code, stdout: text });
    };
    const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (chunk) => (out += chunk));
    child.stderr.on('data', (chunk) => (out += chunk));
    // A spawn failure (for example a missing binary) emits 'error' and may never emit 'close' for the child.
    child.on('error', (error) => finish(-1, `${out}spawn error for ${command}: ${error.message}\n`));
    child.on('close', (code) => finish(code, out));
  });
}

export async function runHarness({ source, commit, out, work, keepWork = false, manifestPath = DEFAULT_MANIFEST }) {
  const startedAt = new Date().toISOString();
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (manifest.pin.commit !== commit) throw new Error(`manifest pin ${manifest.pin.commit} differs from --commit ${commit}`);
  validateScenarios();

  const sourceRoot = resolve(source);
  const head = await checkPin({ sourceRoot, commit });
  await verifyDigests({ sourceRoot, manifest });
  if (platform() === 'darwin') adaptRetryAfterFixture(await readFile(join(sourceRoot, RETRY_AFTER_RS), 'utf8'));

  const outDir = resolve(out);
  const captures = join(outDir, 'captures');
  const logs = join(outDir, 'logs');
  await mkdir(captures, { recursive: true });
  await mkdir(logs, { recursive: true });

  const { workRoot, cleanup } = await createHarnessWork({ work, sourceRoot, keepWork });
  const copy = join(workRoot, 'codex-rs');
  await cp(sourceRoot, copy, {
    recursive: true,
    filter: (src) => !/(^|\/)(target|\.git)(\/|$)/.test(relative(sourceRoot, src)),
  });
  await verifyDigests({ sourceRoot: copy, manifest });
  let adaptedFixtures = [];
  if (platform() === 'darwin') {
    const retryPath = join(copy, RETRY_AFTER_RS);
    const adapted = adaptRetryAfterFixture(await readFile(retryPath, 'utf8'));
    await writeFile(retryPath, adapted.text);
    adaptedFixtures = adapted.adaptedFixtures;
  }

  const responsesPath = join(copy, RESPONSES_RS);
  const instrumented = instrumentResponsesRs(await readFile(responsesPath, 'utf8'));
  await writeFile(responsesPath, instrumented);

  const toolchain = (await readFile(join(copy, 'rust-toolchain.toml'), 'utf8')).match(/channel\s*=\s*"([^"]+)"/)?.[1] ?? null;
  const env = childTestEnv(process.env, { captureDir: captures });

  const list = await runCommand('cargo', ['test', '-p', CARGO_PACKAGE, '--test', CARGO_TEST_BINARY, '--', '--list'], {
    cwd: copy,
    env,
    timeoutMs: 6 * 60 * 60 * 1000,
    logFile: join(logs, 'list.log'),
  });
  if (list.code !== 0) throw new Error(`cargo --list failed with exit ${list.code}`);
  const names = parseTestList(list.stdout);
  const filterReport = assertFiltersMatch(names);

  // Every discovered native test name runs in its own fresh cargo test process (--exact, one thread), so no
  // process-global state (OpenTelemetry, singletons) is shared between cases. Failed cases are not retried.
  const caseLogs = join(logs, 'cases');
  await mkdir(caseLogs, { recursive: true });
  const results = [];
  for (const scenario of SCENARIOS) {
    const matchedNames = names.filter((name) => name.includes(scenario.filter));
    const cases = [];
    const aggregate = [];
    for (const fullName of new Set(matchedNames)) {
      const capturePrefix = casePrefix(scenario.id, fullName);
      const result = await runCommand(
        'cargo',
        ['test', '-p', CARGO_PACKAGE, '--test', CARGO_TEST_BINARY, '--', '--exact', fullName, '--test-threads=1'],
        {
          cwd: copy,
          env: childTestEnv(process.env, {
            captureDir: captures,
            scenarioId: scenario.id,
            testName: fullName,
            capturePrefix,
          }),
          timeoutMs: CASE_TIMEOUT_MS,
          logFile: join(caseLogs, `${capturePrefix}.log`),
        },
      );
      const summary = parseLibtestSummary(result.stdout);
      const expectedEntries = matchedNames.filter((name) => name === fullName).length;
      aggregate.push(`===== ${fullName} (exit ${result.code}) =====\n${result.stdout}`);
      cases.push({
        fullName,
        capturePrefix,
        expectedEntries,
        exitCode: result.code,
        found: summary.found,
        passed: summary.passed,
        failed: summary.failed,
        ok: result.code === 0 && summary.found && summary.failed === 0 && summary.passed === expectedEntries,
        log: `logs/cases/${capturePrefix}.log`,
      });
    }
    await writeFile(join(logs, `${scenario.id}.log`), aggregate.join('\n'));
    const passed = cases.reduce((sum, entry) => sum + entry.passed, 0);
    const failed = cases.reduce((sum, entry) => sum + entry.failed, 0);
    const ok =
      matchedNames.length >= scenario.expectMin &&
      cases.length === new Set(matchedNames).size &&
      cases.every((entry) => entry.ok) &&
      passed === matchedNames.length &&
      failed === 0;
    results.push({
      id: scenario.id,
      filter: scenario.filter,
      featureMode: scenario.featureMode,
      requireCaptures: scenario.requireCaptures,
      expectMin: scenario.expectMin,
      matched: filterReport.find((entry) => entry.id === scenario.id).matched,
      passed,
      failed,
      failedCases: cases.filter((entry) => !entry.ok).length,
      ok,
      log: `logs/${scenario.id}.log`,
      cases,
    });
  }

  await redactCaptureDir(captures);
  const observedKinds = await countCaptureKinds(captures);
  const run = {
    schema: 'rqw-codex/oracle-run@1',
    kind: 'executed upstream tests with instrumented request accessors; fake loopback servers only',
    sourceCommit: head,
    pinnedCommit: PIN_COMMIT,
    pinnedRelease: PIN_RELEASE,
    pinnedVersion: PIN_VERSION,
    cargo: { package: CARGO_PACKAGE, testBinary: CARGO_TEST_BINARY, toolchain },
    harnessEnvironment: HARNESS_ENVIRONMENT,
    adaptedFixtures,
    instrumentedFile: RESPONSES_RS,
    digestsVerified: { manifest: manifest.sourceFiles.length, instrumented: RESPONSES_RS_SHA256 },
    os: { platform: platform(), release: release(), arch: arch() },
    terminal: process.env.TERM_PROGRAM ?? process.env.TERM ?? null,
    startedAt,
    finishedAt: new Date().toISOString(),
    nondeterministicFields: NONDETERMINISTIC_FIELDS,
    observedKinds,
    scenarios: results,
  };
  await writeFile(join(outDir, 'run.json'), JSON.stringify(run, null, 2) + '\n');
  await cleanup();
  const failed = results.filter((entry) => !entry.ok).map((entry) => entry.id);
  if (failed.length > 0) throw new Error(`scenario(s) failed: ${failed.join(', ')}`);
  return run;
}

// Raw semantics per record kind. WebSocket records are message-level payloads as tungstenite delivers them to the
// fake server; they are not raw TCP bytes, masked frame bytes or TLS records.
export const RAW_SEMANTICS = {
  http: 'wire-body-bytes',
  'ws-text': 'ws-message-text-original-utf8-bytes',
  'ws-binary': 'ws-message-binary-payload',
  'ws-ping': 'ws-message-control-ping-payload',
  'ws-pong': 'ws-message-control-pong-payload',
  'ws-close': 'ws-message-control-close-reason-bytes',
  'ws-other': 'ws-message-unclassified-no-payload',
  'ws-handshake': 'no-body',
  'server-script': 'constructed-scripted-events-json-not-network-bytes',
};

export function rawBoundaryOf(kind) {
  if (kind === 'http') return 'HTTP request body bytes as received by the wiremock mock';
  if (kind === 'ws-handshake') return 'HTTP upgrade request headers as received by the fake WebSocket server';
  if (kind === 'server-script') return 'scripted SSE events as constructed by the sse(events) fixture producer; not received from the network, no raw server bytes or status';
  return 'WebSocket message-level payload as received by the fake server; not raw TCP, masked frame bytes or TLS records';
}

// Redacts header values in every capture file; raw bodies are kept as wire bytes.
export async function redactCaptureDir(dir) {
  for (const name of await readdir(dir)) {
    if (!name.endsWith('.json')) continue;
    const path = join(dir, name);
    const meta = JSON.parse(await readFile(path, 'utf8'));
    meta.headers = redactHeaders(meta.headers ?? []);
    meta.rawSemantics = RAW_SEMANTICS[meta.kind] ?? 'unknown-kind';
    meta.rawBoundary = rawBoundaryOf(meta.kind);
    await writeFile(path, JSON.stringify(meta, null, 2) + '\n');
  }
}

// Counts observed record kinds (what was seen, not what was intended to be exercised).
export async function countCaptureKinds(dir) {
  const counts = {};
  for (const name of await readdir(dir)) {
    if (!name.endsWith('.json')) continue;
    const meta = JSON.parse(await readFile(join(dir, name), 'utf8'));
    counts[meta.kind] = (counts[meta.kind] ?? 0) + 1;
  }
  return counts;
}

const ZSTD_MAGIC = [0x28, 0xb5, 0x2f, 0xfd];

// Semantic check of one capture record against its raw bytes. HTTP bodies: the raw wire bytes parse to the
// recorded decoded_json (key order and escapes in the raw text are not part of the comparison). zstd bodies:
// the frame magic must match, decoded_json must exist and, when this Node has zstd, must equal the decoded bytes.
export function checkCaptureRecord(meta, raw) {
  const failures = [];
  if (meta.pin !== PIN_COMMIT) failures.push(`pin ${meta.pin} is not ${PIN_COMMIT}`);
  if (!meta.test) failures.push('missing per-test thread name');
  if (!SCENARIOS.some((scenario) => scenario.id === meta.scenario)) failures.push(`unknown scenario ${meta.scenario}`);
  if (!(meta.kind in RAW_SEMANTICS)) failures.push(`unknown kind ${meta.kind}`);
  if (typeof meta.uri === 'string' && meta.uri.includes('?')) failures.push('uri carries a query string');
  if (meta.kind === 'server-script') {
    if (meta.stage !== 'constructed-not-network-received') failures.push('server-script stage is not constructed-not-network-received');
    if (!Array.isArray(meta.decoded_json)) failures.push('server-script without scripted events array');
    else if (!isDeepStrictEqual(JSON.parse(raw.toString('utf8')), meta.decoded_json)) failures.push('server-script decoded_json differs from recorded events');
    return failures;
  }
  if (meta.kind !== 'http') return failures;
  const encoding = (meta.headers ?? []).find(([h]) => h.toLowerCase() === 'content-encoding')?.[1] ?? '';
  if (/zstd/i.test(encoding)) {
    if (raw.subarray(0, 4).compare(Buffer.from(ZSTD_MAGIC)) !== 0) return [...failures, 'zstd body without zstd frame magic'];
    if (meta.decoded_json === null || meta.decoded_json === undefined) {
      failures.push('zstd body without decoded_json');
    } else if (typeof zlib.zstdDecompressSync === 'function') {
      const decodedBytes = JSON.parse(zlib.zstdDecompressSync(raw).toString('utf8'));
      if (!isDeepStrictEqual(decodedBytes, meta.decoded_json)) failures.push('zstd decoded_json differs from decoded body');
    }
    return failures;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw.toString('utf8'));
  } catch {
    return [...failures, 'http raw body is not JSON'];
  }
  if (!isDeepStrictEqual(parsed, meta.decoded_json)) failures.push('decoded_json differs from raw body');
  return failures;
}

// Capture-integrity checks run in CI after `run`. Returns a list of failures (empty when clean).
export async function checkOutput({ out, commit = PIN_COMMIT }) {
  const failures = [];
  const outDir = resolve(out);
  const run = JSON.parse(await readFile(join(outDir, 'run.json'), 'utf8'));
  if (run.sourceCommit !== commit) failures.push(`sourceCommit ${run.sourceCommit} is not ${commit}`);
  failures.push(...checkAdaptedFixtures(run));
  for (const scenario of run.scenarios) {
    if (!scenario.ok) failures.push(`scenario ${scenario.id} not ok`);
    if (scenario.passed < scenario.expectMin) failures.push(`scenario ${scenario.id} passed ${scenario.passed} < ${scenario.expectMin}`);
    const cases = Array.isArray(scenario.cases) ? scenario.cases : [];
    if (cases.length === 0) failures.push(`scenario ${scenario.id} has no case records`);
    if (cases.length !== new Set(cases.map((entry) => entry.fullName)).size) failures.push(`scenario ${scenario.id} has duplicate case records`);
    for (const entry of cases) {
      if (!entry.ok || entry.exitCode !== 0) failures.push(`case ${entry.fullName} not ok (exit ${entry.exitCode})`);
      if (entry.capturePrefix !== casePrefix(scenario.id, entry.fullName)) failures.push(`case ${entry.fullName} has a wrong capture prefix`);
    }
  }
  // Zero/missing detection: the discovered list (cargo test -- --list) must still match every scenario filter.
  const listed = await readFile(join(outDir, 'logs', 'list.log'), 'utf8').then(parseTestList, () => null);
  if (listed === null) {
    failures.push('logs/list.log is missing');
  } else {
    for (const scenario of run.scenarios) {
      const listedCount = countMatches(listed, scenario.filter);
      const cases = Array.isArray(scenario.cases) ? scenario.cases : [];
      if (listedCount === 0) failures.push(`scenario ${scenario.id} matches zero listed tests`);
      if (scenario.matched !== listedCount) failures.push(`scenario ${scenario.id} matched ${scenario.matched} != listed ${listedCount}`);
      if (scenario.failed !== 0) failures.push(`scenario ${scenario.id} has ${scenario.failed} failed test(s)`);
      if (cases.reduce((sum, entry) => sum + entry.expectedEntries, 0) !== listedCount) failures.push(`scenario ${scenario.id} case entries != listed ${listedCount}`);
    }
  }
  const ids = run.scenarios.map((scenario) => scenario.id);
  for (const scenario of SCENARIOS) if (!ids.includes(scenario.id)) failures.push(`missing scenario ${scenario.id}`);

  const captureDir = join(outDir, 'captures');
  const names = (await readdir(captureDir)).filter((name) => name.endsWith('.json'));
  const perScenario = new Map();
  const perCase = new Map();
  for (const name of names) {
    const text = await readFile(join(captureDir, name), 'utf8');
    if (/Bearer\s+[A-Za-z0-9._-]{8,}/i.test(text)) failures.push(`${name} contains a bearer token`);
    const meta = JSON.parse(text);
    perScenario.set(meta.scenario, (perScenario.get(meta.scenario) ?? 0) + 1);
    const owner = run.scenarios
      .find((scenario) => scenario.id === meta.scenario)
      ?.cases?.find((entry) => entry.fullName === meta.test);
    if (!owner) failures.push(`${name} is not associated with a case of scenario ${meta.scenario}`);
    else {
      perCase.set(owner, (perCase.get(owner) ?? 0) + 1);
      if (!name.startsWith(`${owner.capturePrefix}-`)) failures.push(`${name} does not carry the capture prefix of ${meta.test}`);
    }
    for (const [header, value] of meta.headers ?? []) {
      if (SECRET_HEADERS.has(String(header).toLowerCase()) && value !== '[REDACTED]') failures.push(`${name} leaks header ${header}`);
    }
    const raw = await readFile(join(captureDir, String(meta.raw_file))).catch(() => null);
    if (raw === null) {
      failures.push(`${name} raw file ${meta.raw_file} is missing`);
    } else {
      for (const failure of checkCaptureRecord(meta, raw)) failures.push(`${name} ${failure}`);
    }
  }
  for (const scenario of SCENARIOS) {
    if (!scenario.requireCaptures) continue;
    if (!perScenario.get(scenario.id)) failures.push(`no captures for scenario ${scenario.id}`);
    const cases = run.scenarios.find((entry) => entry.id === scenario.id)?.cases;
    for (const entry of Array.isArray(cases) ? cases : []) {
      if (!perCase.get(entry)) failures.push(`no captures for case ${entry.fullName}`);
    }
  }
  return failures;
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith('--')) {
      const key = token.slice(2);
      if (key === 'keep-work') args.keepWork = true;
      else args[key] = argv[++i];
    } else {
      args._.push(token);
    }
  }
  return args;
}

async function main(argv) {
  const [command] = argv;
  const args = parseArgs(argv.slice(1));
  if (command === 'run') {
    if (!args.source || !args.out) throw new Error('run needs --source and --out');
    const result = await runHarness({
      source: args.source,
      commit: args.commit ?? PIN_COMMIT,
      out: args.out,
      work: args.work,
      keepWork: args.keepWork,
    });
    console.log(`oracle run ok: ${result.scenarios.length} scenario(s) from ${result.sourceCommit}`);
    return 0;
  }
  if (command === 'check') {
    if (!args.out) throw new Error('check needs --out');
    const failures = await checkOutput({ out: args.out, commit: args.commit ?? PIN_COMMIT });
    if (failures.length > 0) {
      console.error(failures.join('\n'));
      return 1;
    }
    console.log('oracle capture integrity ok');
    return 0;
  }
  console.error('usage: capture-oracle.mjs run|check (see file header)');
  return 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    },
  );
}
