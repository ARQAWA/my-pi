#!/usr/bin/env node
// CI-only differential diagnostic for one reproducible native telemetry timeout. Diagnostic only: this is not an
// oracle acceptance, writes no run.json and does not change the normal harness (capture-oracle.mjs).
//
// Usage (CI):
//   node oracle-diagnostic.mjs --source <clone>/codex-rs --commit <sha> --out <dir> [--case <fixed case name> | --probe connect]
//
// Two sequential arms on fresh OS-temp copies of the pinned source, same runner, same native case, one run each:
//   original: the pinned sources plus the normal responses.rs capture instrumentation only;
//   marked:   the same, plus std-only diagnostic markers in four native files (tagged `// rqw-diag` lines).
// Marker lines write only a unix-ms timestamp, a thread id and a static stage name to RQW_ORACLE_DIAG_MARKS.

import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { arch, release, tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  CASE_TIMEOUT_MS,
  DEFAULT_MANIFEST,
  PIN_COMMIT,
  RESPONSES_RS,
  assertTempWorkDir,
  checkPin,
  childTestEnv,
  countCaptureKinds,
  instrumentResponsesRs,
  parseLibtestSummary,
  redactCaptureDir,
  runCommand,
  sha256Hex,
  verifyDigests,
} from './capture-oracle.mjs';

export const DIAGNOSTIC_KIND = 'diagnostic-only-not-oracle-acceptance';
export const DIAGNOSTIC_SCHEMA = 'rqw-codex/oracle-diagnostic@1';
export const FIXED_CASE =
  'suite::retry_after::connection_failures_increment_retry_telemetry_without_consuming_retry_budget';
export const MARKS_FILE = 'marked-events.jsonl';
export const MARK_TAG = '// rqw-diag';

const CARGO_BUILD_ARGS = ['test', '-p', 'codex-core', '--test', 'all', '--no-run'];
const BUILD_TIMEOUT_MS = 6 * 60 * 60 * 1000;
const CARGO_ARGS = ['test', '-p', 'codex-core', '--test', 'all', '--', '--exact', FIXED_CASE, '--test-threads=1'];
const ARMS = [
  { name: 'original', marked: false },
  { name: 'marked', marked: true },
];
const PROXY_AND_LOG_NAMES = [
  'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY',
  'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy',
  'RUST_LOG',
];

// Static stage names. Each marker line may carry only one of these; nothing else from the runtime is written.
export const MARK_STAGES = [
  'case_begin',
  'case_build_begin',
  'case_build_done',
  'case_submit_begin',
  'case_submit_done',
  'case_first_retry_begin',
  'layer_recv_retry',
  'layer_recv_http_responses',
  'retry_entry',
  'connection_branch',
  'notify_begin',
  'notify_done',
  'retry_emit_pre',
  'retry_emit_post',
  'retry_exhausted',
  'http_stream_begin',
  'http_execute_begin',
  'map_error_policy',
  'map_error_connect',
  'map_error_timeout',
  'map_error_other',
  'client_setup_begin',
  'client_setup_done',
];

// Pre-edit digests of the four extra native files the marked arm instruments (worker-inspected pinned commit).
export const DIAGNOSTIC_SHA256 = {
  'core/tests/suite/retry_after.rs': '2437e45336c5d3e811158aeb43963992860499cc1e9e66b939ad223d9e4d12af',
  'core/src/responses_retry.rs': '8136a44f54b593cd9257658b1798418567e1e26928dc0ad1b3edf748e2a181fd',
  'http-client/src/transport.rs': '88aa391e6893205336b3412b065600bd717da8d80d59c1c7dd094d19bee666b6',
  'core/src/client.rs': '934ac0856c95f11d554e692e7ccf975822de1c916c037c9beddfe26832854e13',
};

// Marker helper, appended once per instrumented file. Std only; no error text, headers, URLs, bodies or env values.
const HELPER_SOURCE = String.raw`fn rqw_diag_mark(stage: &'static str) {
    let Some(path) = std::env::var_os("RQW_ORACLE_DIAG_MARKS") else {
        return;
    };
    let unix_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let line = format!("{{\"unixMs\":{unix_ms},\"thread\":\"{:?}\",\"stage\":\"{stage}\"}}\n", std::thread::current().id());
    if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = std::io::Write::write_all(&mut file, line.as_bytes());
    }
}`;

export function tagLine(line) {
  return `${line} ${MARK_TAG}\n`;
}

export function appendHelper(text) {
  if (!text.endsWith('\n')) throw new Error('native file must end with a newline before the marker helper');
  return text + HELPER_SOURCE.split('\n').map(tagLine).join('');
}

function markLine(stage, indent) {
  if (!MARK_STAGES.includes(stage)) throw new Error(`unknown diagnostic stage ${stage}`);
  return tagLine(`${indent}rqw_diag_mark("${stage}");`);
}

// Each edit is an exact full-line anchor and its replacement, both computed from the same anchor text.
// Every anchor must occur exactly once in the original text and anchors must not overlap.
export function applyDiagnosticEdits(text, edits, path) {
  const located = edits.map(({ anchor, replacement }) => {
    const hits = text.split(anchor).length - 1;
    if (hits !== 1) throw new Error(`diagnostic anchor found ${hits} times in ${path}: ${JSON.stringify(anchor.slice(0, 70))}`);
    const start = text.indexOf(anchor);
    return { start, end: start + anchor.length, replacement };
  });
  located.sort((a, b) => a.start - b.start);
  for (let i = 1; i < located.length; i += 1) {
    if (located[i].start < located[i - 1].end) throw new Error(`overlapping diagnostic anchors in ${path}`);
  }
  let out = '';
  let cursor = 0;
  for (const edit of located) {
    out += text.slice(cursor, edit.start) + edit.replacement;
    cursor = edit.end;
  }
  return out + text.slice(cursor);
}

// Removes every tagged marker line (and the appended helper). Used to prove the test code is unchanged.
export function stripDiagnosticMarkers(text) {
  return text
    .split('\n')
    .filter((line) => !line.endsWith(MARK_TAG))
    .join('\n');
}

const RETRY_AFTER_PATH = 'core/tests/suite/retry_after.rs';
const RESPONSES_RETRY_PATH = 'core/src/responses_retry.rs';
const TRANSPORT_PATH = 'http-client/src/transport.rs';
const CLIENT_PATH = 'core/src/client.rs';

const RETRY_AFTER_EDITS = [
  {
    anchor: 'async fn connection_failures_increment_retry_telemetry_without_consuming_retry_budget() -> Result<()>\n{\n',
    replacement:
      'async fn connection_failures_increment_retry_telemetry_without_consuming_retry_budget() -> Result<()>\n{\n' +
      markLine('case_begin', '    '),
  },
  {
    anchor: '    let unavailable_address = unavailable_socket.local_addr()?;\n',
    replacement: '    let unavailable_address = unavailable_socket.local_addr()?;\n' + markLine('case_build_begin', '    '),
  },
  {
    anchor:
      '        .build_with_auto_env(&bootstrap_server)\n' +
      '        .await?;\n' +
      '\n' +
      '    submit_user_input(&test, "recover after repeated network failures").await?;\n' +
      '\n' +
      '    let first_retry = telemetry.next_retry().await;\n',
    replacement:
      '        .build_with_auto_env(&bootstrap_server)\n' +
      '        .await?;\n' +
      markLine('case_build_done', '    ') +
      '\n' +
      markLine('case_submit_begin', '    ') +
      '    submit_user_input(&test, "recover after repeated network failures").await?;\n' +
      markLine('case_submit_done', '    ') +
      '\n' +
      markLine('case_first_retry_begin', '    ') +
      '    let first_retry = telemetry.next_retry().await;\n',
  },
  {
    anchor: '        if visitor.name.as_deref() != Some("codex.retry") {\n            return;\n        }\n',
    replacement:
      '        if visitor.name.as_deref() != Some("codex.retry") {\n            return;\n        }\n' +
      markLine('layer_recv_retry', '        '),
  },
  {
    anchor: '            if visitor.is_responses_request {\n',
    replacement:
      '            if visitor.is_responses_request {\n' + markLine('layer_recv_http_responses', '                '),
  },
];

const RESPONSES_RETRY_EDITS = [
  {
    anchor: '    let turn_context = &step_context.turn;\n',
    replacement: '    let turn_context = &step_context.turn;\n' + markLine('retry_entry', '    '),
  },
  {
    anchor: '        let retry_delay = retry_state.connection_retry_delay;\n',
    replacement: markLine('connection_branch', '        ') + '        let retry_delay = retry_state.connection_retry_delay;\n',
  },
  {
    anchor:
      '        sess.notify_stream_error(turn_context, "Reconnecting... waiting for network", err)\n' + '            .await;\n',
    replacement:
      markLine('notify_begin', '        ') +
      '        sess.notify_stream_error(turn_context, "Reconnecting... waiting for network", err)\n' +
      '            .await;\n' +
      markLine('notify_done', '        '),
  },
  {
    anchor: '        codex_client::record_retry!(retry_state.connection_retries, retry_delay, operation);\n',
    replacement:
      markLine('retry_emit_pre', '        ') +
      '        codex_client::record_retry!(retry_state.connection_retries, retry_delay, operation);\n' +
      markLine('retry_emit_post', '        '),
  },
  {
    anchor: '    sess.services\n',
    replacement: markLine('retry_exhausted', '    ') + '    sess.services\n',
  },
];

const TRANSPORT_EDITS = [
  {
    anchor: '    async fn execute(&self, req: Request) -> Result<Response, TransportError> {\n',
    replacement:
      '    async fn execute(&self, req: Request) -> Result<Response, TransportError> {\n' +
      markLine('http_execute_begin', '        '),
  },
  {
    anchor: '    async fn stream(&self, req: Request) -> Result<StreamResponse, TransportError> {\n',
    replacement:
      '    async fn stream(&self, req: Request) -> Result<StreamResponse, TransportError> {\n' +
      markLine('http_stream_begin', '        '),
  },
  {
    anchor: '        let err = err.without_url();\n',
    replacement:
      '        let err = err.without_url();\n' +
      tagLine(
        '        rqw_diag_mark(if matches!(err, crate::HttpError::Policy(_)) { "map_error_policy" } else if err.is_connect() { "map_error_connect" } else if err.is_timeout() { "map_error_timeout" } else { "map_error_other" });',
      ),
  },
];

const CLIENT_EDITS = [
  {
    anchor:
      '            let client_setup = self\n' +
      '                .client\n' +
      '                .current_client_setup(ClientRouting::Workspace)\n' +
      '                .await?;\n' +
      '            if expected_auth_owner.is_some_and(|owner| {\n',
    replacement:
      markLine('client_setup_begin', '            ') +
      '            let client_setup = self\n' +
      '                .client\n' +
      '                .current_client_setup(ClientRouting::Workspace)\n' +
      '                .await?;\n' +
      markLine('client_setup_done', '            ') +
      '            if expected_auth_owner.is_some_and(|owner| {\n',
  },
];

// The four extra native files, their pre-edit digests and their exact-once instrumentation.
export const DIAGNOSTIC_FILES = [
  { path: RETRY_AFTER_PATH, sha256: DIAGNOSTIC_SHA256[RETRY_AFTER_PATH], edits: RETRY_AFTER_EDITS },
  { path: RESPONSES_RETRY_PATH, sha256: DIAGNOSTIC_SHA256[RESPONSES_RETRY_PATH], edits: RESPONSES_RETRY_EDITS },
  { path: TRANSPORT_PATH, sha256: DIAGNOSTIC_SHA256[TRANSPORT_PATH], edits: TRANSPORT_EDITS },
  { path: CLIENT_PATH, sha256: DIAGNOSTIC_SHA256[CLIENT_PATH], edits: CLIENT_EDITS },
].map((file) => ({
  ...file,
  instrument: (text) => appendHelper(applyDiagnosticEdits(text, file.edits, file.path)),
}));

export function diagnosticAnchors(path) {
  const file = DIAGNOSTIC_FILES.find((entry) => entry.path === path);
  if (!file) throw new Error(`${path} is not a diagnostic file`);
  return file.edits.map((edit) => edit.anchor);
}

// Verifies the pre-edit digest of each extra native file. Returns the verified digests by path.
export async function verifyDiagnosticDigests(root, files = DIAGNOSTIC_FILES) {
  const hashes = {};
  const mismatches = [];
  for (const file of files) {
    const actual = sha256Hex(await readFile(join(root, file.path)));
    hashes[file.path] = actual;
    if (actual !== file.sha256) mismatches.push({ path: file.path, expected: file.sha256, actual });
  }
  if (mismatches.length > 0) throw new Error(`diagnostic source digest mismatch: ${JSON.stringify(mismatches)}`);
  return hashes;
}

// Validates the marked arm's marker file: one JSON object per line with exactly unixMs, thread and stage.
export async function readMarkers(path) {
  let text;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    return { present: false, valid: false, count: 0, stages: {}, failures: [`${MARKS_FILE} is missing`] };
  }
  const failures = [];
  const stages = {};
  const lines = text.split('\n').filter((line) => line !== '');
  for (const line of lines) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      failures.push('marker line is not JSON');
      continue;
    }
    if (entry === null || typeof entry !== 'object') {
      failures.push('marker line is not an object');
      continue;
    }
    const keys = Object.keys(entry).sort().join(',');
    if (keys !== 'stage,thread,unixMs') failures.push(`marker line has keys ${keys}`);
    if (!Number.isInteger(entry.unixMs)) failures.push('marker unixMs is not an integer');
    if (typeof entry.thread !== 'string' || !/^ThreadId\(\d+\)$/.test(entry.thread)) failures.push('marker thread is not a thread id');
    if (!MARK_STAGES.includes(entry.stage)) failures.push(`marker stage ${String(entry.stage).slice(0, 40)} is not allowed`);
    else stages[entry.stage] = (stages[entry.stage] ?? 0) + 1;
  }
  if (lines.length === 0) failures.push('no marker lines were written');
  else if (!stages.case_begin) failures.push('case_begin marker missing');
  return { present: true, valid: failures.length === 0, count: lines.length, stages, failures };
}

function copyFilter(sourceRoot) {
  return (src) => !/(^|\/)(target|\.git)(\/|$)/.test(relative(sourceRoot, src));
}

const defaultDeps = {
  checkPin,
  verifyDigests,
  runCommand,
  parseSummary: parseLibtestSummary,
  copySource: (sourceRoot, copy) => cp(sourceRoot, copy, { recursive: true, filter: copyFilter(sourceRoot) }),
  mkWork: () => mkdtemp(join(tmpdir(), 'rqw-codex-diag-')),
  instrumentCapture: instrumentResponsesRs,
  files: DIAGNOSTIC_FILES,
};

async function runArm({ arm, sourceRoot, manifest, outDir, deps }) {
  const captureDir = join(outDir, `captures-${arm.name}`);
  const marksPath = join(outDir, MARKS_FILE);
  const result = {
    name: arm.name,
    marked: arm.marked,
    command: `cargo ${CARGO_ARGS.join(' ')}`,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    exitCode: null,
    build: { exitCode: null, ok: false, log: `logs/${arm.name}-build.log` },
    found: false,
    passed: 0,
    failed: 0,
    ok: false,
    log: `logs/${arm.name}.log`,
    captureDir: `captures-${arm.name}`,
    error: null,
  };
  const workParent = await deps.mkWork();
  try {
    const workRoot = await assertTempWorkDir({ work: workParent, sourceRoot });
    const copy = join(workRoot, 'codex-rs');
    await deps.copySource(sourceRoot, copy);
    await deps.verifyDigests({ sourceRoot: copy, manifest });
    await verifyDiagnosticDigests(copy, deps.files);

    const responsesPath = join(copy, RESPONSES_RS);
    await writeFile(responsesPath, deps.instrumentCapture(await readFile(responsesPath, 'utf8')));

    if (arm.marked) {
      for (const file of deps.files) {
        const path = join(copy, file.path);
        const original = await readFile(path, 'utf8');
        const marked = file.instrument(original);
        if (stripDiagnosticMarkers(marked) !== original) throw new Error(`marker strip does not restore ${file.path}`);
        await writeFile(path, marked);
      }
    }

    await mkdir(captureDir, { recursive: true });
    const env = childTestEnv(process.env, {
      captureDir,
      scenarioId: 'diagnostic',
      testName: FIXED_CASE,
      capturePrefix: `diag-${arm.name}`,
    });
    delete env.RQW_ORACLE_DIAG_MARKS;
    if (arm.marked) env.RQW_ORACLE_DIAG_MARKS = marksPath;

    // Fresh-copy compilation has its own budget, as in the normal harness's --list step.
    const build = await deps.runCommand('cargo', CARGO_BUILD_ARGS, {
      cwd: copy,
      env,
      timeoutMs: BUILD_TIMEOUT_MS,
      logFile: join(outDir, result.build.log),
    });
    result.build.exitCode = build.code;
    result.build.ok = build.code === 0;
    if (!result.build.ok) throw new Error(`${arm.name} arm build failed (exit ${build.code})`);

    const run = await deps.runCommand('cargo', CARGO_ARGS, {
      cwd: copy,
      env,
      timeoutMs: CASE_TIMEOUT_MS,
      logFile: join(outDir, result.log),
    });
    const summary = deps.parseSummary(run.stdout);
    result.exitCode = run.code;
    result.found = summary.found;
    result.passed = summary.passed;
    result.failed = summary.failed;
    result.ok = run.code === 0 && summary.found && summary.failed === 0 && summary.passed === 1;
    await redactCaptureDir(captureDir);
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
  } finally {
    await rm(workParent, { recursive: true, force: true });
    result.finishedAt = new Date().toISOString();
  }
  return result;
}

export async function runDiagnostic({
  source,
  commit = PIN_COMMIT,
  out,
  caseName = FIXED_CASE,
  manifestPath = DEFAULT_MANIFEST,
  deps: overrides = {},
}) {
  const deps = { ...defaultDeps, ...overrides };
  if (caseName !== FIXED_CASE) throw new Error(`diagnostic case must be the fixed case ${FIXED_CASE}`);
  if (commit !== PIN_COMMIT) throw new Error(`diagnostic commit ${commit} is not the pinned ${PIN_COMMIT}`);
  const startedAt = new Date().toISOString();
  const outDir = resolve(out);
  await mkdir(join(outDir, 'logs'), { recursive: true });
  // A failed marked preflight must not reuse a previous run's marker evidence.
  await rm(join(outDir, MARKS_FILE), { force: true });

  const failures = [];
  const sourceRoot = resolve(source);
  let manifest = null;
  let head = null;
  let sourceHashes = {};
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    if (manifest.pin.commit !== commit) throw new Error(`manifest pin ${manifest.pin.commit} differs from --commit ${commit}`);
    head = await deps.checkPin({ sourceRoot, commit });
    await deps.verifyDigests({ sourceRoot, manifest });
    sourceHashes = await verifyDiagnosticDigests(sourceRoot, deps.files);
  } catch (error) {
    failures.push(`preflight: ${error instanceof Error ? error.message : String(error)}`);
  }

  const arms = [];
  let markers = { present: false, valid: false, count: 0, stages: {}, failures: ['marked arm not run'] };
  if (failures.length === 0) {
    for (const arm of ARMS) {
      arms.push(await runArm({ arm, sourceRoot, manifest, outDir, deps }));
    }
    markers = await readMarkers(join(outDir, MARKS_FILE));
    for (const arm of arms) {
      if (arm.error) failures.push(`${arm.name} arm error: ${arm.error}`);
      else if (!arm.ok) failures.push(`${arm.name} arm native case failed (exit ${arm.exitCode}, passed ${arm.passed}, failed ${arm.failed})`);
    }
    if (!markers.valid) failures.push(`marker collection missing or invalid: ${markers.failures.slice(0, 3).join('; ')}`);
  }

  const captureKinds = {};
  for (const arm of arms) {
    const dir = join(outDir, arm.captureDir);
    captureKinds[arm.name] = existsSync(dir) ? await countCaptureKinds(dir) : {};
  }

  const diagnostic = {
    schema: DIAGNOSTIC_SCHEMA,
    kind: DIAGNOSTIC_KIND,
    notOracleAcceptance: true,
    sourceCommit: head,
    pinnedCommit: PIN_COMMIT,
    fixedCase: FIXED_CASE,
    sourceHashes: { manifestFiles: manifest ? manifest.sourceFiles.length : null, responsesRs: RESPONSES_RS, extra: sourceHashes },
    environmentPresence: Object.fromEntries(PROXY_AND_LOG_NAMES.map((name) => [name, Boolean(process.env[name])])),
    startedAt,
    finishedAt: new Date().toISOString(),
    arms,
    markers: { file: MARKS_FILE, count: markers.count, valid: markers.valid, stages: markers.stages, failures: markers.failures },
    captureKinds,
    failures,
    ok: failures.length === 0,
  };
  await writeFile(join(outDir, 'diagnostic.json'), JSON.stringify(diagnostic, null, 2) + '\n');
  return diagnostic;
}

export const CONNECT_PROBE_PATH = 'http-client/src/transport_tests.rs';
export const CONNECT_PROBE_SHA256 = '5ffe4f903c7fe20d91623adcdff5e1a39da9e209619747dacda07e1707eb834c';
export const CONNECT_PROBE_CASE = 'transport::tests::rqw_connect_probe::bound_and_dropped_once';
export const CONNECT_PROBE_TRACE = 'connect-events.jsonl';
export const CONNECT_PROBE_OBSERVATION_MS = 12000;
export const CONNECT_PROBE_OUTCOMES = [
  'connected', 'response', 'connection_refused', 'connection', 'observation_timeout', 'io_error',
  'transport_timeout', 'transport_policy', 'transport_http', 'transport_retry_limit',
  'transport_network', 'transport_build', 'transport_too_large',
];
const CONNECT_BUILD_ARGS = ['test', '-p', 'codex-http-client', '--lib', '--no-run'];
const CONNECT_RUN_ARGS = ['test', '-p', 'codex-http-client', '--lib', '--', '--exact', CONNECT_PROBE_CASE, '--test-threads=1'];

// Appended only to a verified temporary native file. Records never format arbitrary errors or request data.
export const CONNECT_PROBE_SOURCE = String.raw`
mod rqw_connect_probe {
    use super::*;
    use std::error::Error;
    use std::net::SocketAddr;
    use std::time::Instant;
    use tokio::net::{TcpListener, TcpSocket, TcpStream};

    fn record(backend: &'static str, case: &'static str, outcome: &'static str, started: Instant, os_error: Option<i32>) {
        let line = serde_json::json!({
            "backend": backend, "case": case, "outcome": outcome,
            "elapsedMs": started.elapsed().as_millis(), "rawOsError": os_error,
        }).to_string() + "\n";
        let path = std::env::var_os("RQW_ORACLE_CONNECT_TRACE").expect("probe trace path required");
        let mut file = std::fs::OpenOptions::new().create(true).append(true).open(path).expect("probe trace open");
        file.write_all(line.as_bytes()).expect("probe trace write");
    }

    async fn raw(case: &'static str, address: SocketAddr) {
        let started = Instant::now();
        let (outcome, os_error) = match tokio::time::timeout(Duration::from_millis(12000), TcpStream::connect(address)).await {
            Err(_) => ("observation_timeout", None),
            Ok(Ok(_)) => ("connected", None),
            Ok(Err(error)) => (
                if error.kind() == std::io::ErrorKind::ConnectionRefused { "connection_refused" } else { "io_error" },
                error.raw_os_error(),
            ),
        };
        record("raw_tcp", case, outcome, started, os_error);
    }

    fn connection_category(error: &(dyn Error + 'static)) -> (&'static str, Option<i32>) {
        let mut current = Some(error);
        while let Some(error) = current {
            if let Some(io) = error.downcast_ref::<std::io::Error>() {
                return (
                    if io.kind() == std::io::ErrorKind::ConnectionRefused { "connection_refused" } else { "connection" },
                    io.raw_os_error(),
                );
            }
            current = error.source();
        }
        ("connection", None)
    }

    async fn http(case: &'static str, address: SocketAddr) {
        // Mirrors this file's existing direct-transport classifier test, not the core route-aware factory.
        let client = reqwest::Client::builder().no_proxy().redirect(reqwest::redirect::Policy::none())
            .build().expect("probe client build");
        let transport = ReqwestTransport::from_http_client(HttpClient::new_without_request_logging(client));
        let request = Request::new(Method::POST, format!("http://{address}/responses"));
        let started = Instant::now();
        let (outcome, os_error) = match tokio::time::timeout(Duration::from_millis(12000), transport.stream(request)).await {
            Err(_) => ("observation_timeout", None),
            Ok(Ok(_)) => ("response", None),
            Ok(Err(error)) => match error {
                TransportError::Connection(error) => connection_category(&error),
                TransportError::Timeout => ("transport_timeout", None),
                TransportError::Policy(_) => ("transport_policy", None),
                TransportError::Http { .. } => ("transport_http", None),
                TransportError::RetryLimit => ("transport_retry_limit", None),
                TransportError::Network(_) => ("transport_network", None),
                TransportError::Build(_) => ("transport_build", None),
                TransportError::ResponseTooLarge { .. } => ("transport_too_large", None),
            },
        };
        record("http_transport", case, outcome, started, os_error);
    }

    fn bound() -> (TcpSocket, SocketAddr) {
        let socket = TcpSocket::new_v4().expect("probe socket create");
        socket.bind("127.0.0.1:0".parse().expect("probe loopback address")).expect("probe socket bind");
        let address = socket.local_addr().expect("probe socket address");
        assert!(address.ip().is_loopback());
        (socket, address)
    }

    #[tokio::test(flavor = "current_thread")]
    async fn bound_and_dropped_once() {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("probe listener bind");
        raw("listening", listener.local_addr().expect("probe listener address")).await;
        drop(listener);

        let (socket, address) = bound();
        raw("held", address).await;
        drop(socket);
        raw("dropped", address).await;

        let (socket, address) = bound();
        http("held", address).await;
        drop(socket);
        http("dropped", address).await;
    }
}
`;

export function appendConnectProbe(text) {
  if (!text.endsWith('\n')) throw new Error('native probe file must end with a newline');
  return text + CONNECT_PROBE_SOURCE.split('\n').map(tagLine).join('');
}

export async function readConnectProbeRecords(path) {
  const expected = [['raw_tcp', 'listening'], ['raw_tcp', 'held'], ['raw_tcp', 'dropped'], ['http_transport', 'held'], ['http_transport', 'dropped']];
  let lines;
  try { lines = (await readFile(path, 'utf8')).split('\n').filter(Boolean); }
  catch { return { valid: false, records: [], failures: ['connect trace missing'] }; }
  const records = [];
  const failures = [];
  if (lines.length !== expected.length) failures.push('connect trace must have exactly five observations');
  for (let i = 0; i < lines.length; i += 1) {
    let row;
    try { row = JSON.parse(lines[i]); } catch { failures.push('connect trace invalid JSON'); continue; }
    if (!row || typeof row !== 'object' || Object.keys(row).sort().join(',') !== 'backend,case,elapsedMs,outcome,rawOsError'
      || row.backend !== expected[i]?.[0] || row.case !== expected[i]?.[1]
      || !CONNECT_PROBE_OUTCOMES.includes(row.outcome)
      || !Number.isSafeInteger(row.elapsedMs) || row.elapsedMs < 0
      || !(row.rawOsError === null || Number.isSafeInteger(row.rawOsError))) {
      failures.push('connect trace invalid typed record');
      continue;
    }
    records.push(row);
  }
  return { valid: failures.length === 0, records, failures };
}

export async function runConnectProbe({ source, commit = PIN_COMMIT, out, manifestPath = DEFAULT_MANIFEST, deps: overrides = {} }) {
  if (commit !== PIN_COMMIT) throw new Error('connect probe requires pinned commit');
  const deps = { ...defaultDeps, probeFile: { path: CONNECT_PROBE_PATH, sha256: CONNECT_PROBE_SHA256 }, ...overrides };
  const sourceRoot = resolve(source);
  const outDir = resolve(out);
  await mkdir(join(outDir, 'logs'), { recursive: true });
  const tracePath = join(outDir, CONNECT_PROBE_TRACE);
  await rm(tracePath, { force: true });
  const result = {
    schema: 'rqw-codex/connect-probe@1', kind: DIAGNOSTIC_KIND, notOracleAcceptance: true,
    pinnedCommit: PIN_COMMIT, sourceCommit: null, sourceHashes: {}, observationMs: CONNECT_PROBE_OBSERVATION_MS,
    host: { platform: process.platform, release: release(), arch: arch(), toolchain: null },
    command: `cargo ${CONNECT_RUN_ARGS.join(' ')}`, build: { exitCode: null, log: 'logs/connect-build.log' },
    exitCode: null, log: 'logs/connect.log', trace: CONNECT_PROBE_TRACE, records: [],
    controlsValid: false, hypothesis: 'inconclusive', failures: [], ok: false,
  };
  let workParent;
  try {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    if (manifest.pin.commit !== commit) throw new Error('connect probe manifest pin mismatch');
    result.sourceCommit = await deps.checkPin({ sourceRoot, commit });
    await deps.verifyDigests({ sourceRoot, manifest });
    result.sourceHashes = await verifyDiagnosticDigests(sourceRoot, [deps.probeFile]);
    workParent = await deps.mkWork();
    const workRoot = await assertTempWorkDir({ work: workParent, sourceRoot });
    const copy = join(workRoot, 'codex-rs');
    await deps.copySource(sourceRoot, copy);
    await deps.verifyDigests({ sourceRoot: copy, manifest });
    await verifyDiagnosticDigests(copy, [deps.probeFile]);
    result.host.toolchain = (await readFile(join(copy, 'rust-toolchain.toml'), 'utf8')).match(/channel\s*=\s*"([^"]+)"/)?.[1] ?? null;
    const probePath = join(copy, deps.probeFile.path);
    const original = await readFile(probePath, 'utf8');
    const appended = appendConnectProbe(original);
    if (stripDiagnosticMarkers(appended) !== original) throw new Error('connect probe strip mismatch');
    await writeFile(probePath, appended);
    const env = { ...process.env, RQW_ORACLE_CONNECT_TRACE: tracePath };
    delete env.RQW_ORACLE_DIAG_MARKS;
    const build = await deps.runCommand('cargo', CONNECT_BUILD_ARGS, {
      cwd: copy, env, timeoutMs: BUILD_TIMEOUT_MS, logFile: join(outDir, result.build.log),
    });
    result.build.exitCode = build.code;
    if (build.code !== 0) throw new Error('connect probe build failed');
    const run = await deps.runCommand('cargo', CONNECT_RUN_ARGS, {
      cwd: copy, env, timeoutMs: 2 * 60 * 1000, logFile: join(outDir, result.log),
    });
    result.exitCode = run.code;
    const summary = deps.parseSummary(run.stdout);
    if (run.code !== 0 || !summary.found || summary.passed !== 1 || summary.failed !== 0) result.failures.push('connect probe native execution failed');
    const trace = await readConnectProbeRecords(tracePath);
    result.records = trace.records;
    result.failures.push(...trace.failures);
    if (trace.valid) {
      result.controlsValid = trace.records[0].outcome === 'connected'
        && trace.records[2].outcome === 'connection_refused' && trace.records[4].outcome === 'connection_refused';
      if (!result.controlsValid) result.failures.push('connect probe controls inconclusive');
      else if (result.failures.length === 0) result.hypothesis = trace.records[1].outcome === 'observation_timeout' && trace.records[3].outcome === 'observation_timeout'
        ? 'supported' : 'not-supported';
    }
  } catch (error) {
    result.failures.push(error instanceof Error ? error.message : String(error));
  } finally {
    if (workParent) await rm(workParent, { recursive: true, force: true });
  }
  result.ok = result.failures.length === 0;
  await writeFile(join(outDir, 'connect-probe.json'), JSON.stringify(result, null, 2) + '\n');
  return result;
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    if (!['--source', '--commit', '--out', '--case', '--probe'].includes(key)) throw new Error(`unknown argument ${key}`);
    if (i + 1 >= argv.length) throw new Error(`${key} needs a value`);
    args[key.slice(2)] = argv[i + 1];
  }
  return args;
}

async function main(argv) {
  const args = parseArgs(argv);
  if (!args.source || !args.out) throw new Error('usage: oracle-diagnostic.mjs --source <codex-rs> --commit <sha> --out <dir> [--case <fixed case> | --probe connect]');
  if (args.probe !== undefined && (args.probe !== 'connect' || args.case !== undefined)) throw new Error('use --probe connect without --case');
  const diagnostic = await (args.probe === 'connect' ? runConnectProbe : runDiagnostic)({
    source: args.source,
    commit: args.commit ?? PIN_COMMIT,
    out: args.out,
    caseName: args.case ?? FIXED_CASE,
  });
  if (!diagnostic.ok) {
    console.error(`oracle diagnostic FAILED (${DIAGNOSTIC_KIND}):\n${diagnostic.failures.join('\n')}`);
    return 1;
  }
  console.log(`oracle diagnostic ok (${DIAGNOSTIC_KIND}): ${args.probe === 'connect' ? 'connect probe ran once, typed observations collected' : 'both arms ran once, markers collected'}`);
  return 0;
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
