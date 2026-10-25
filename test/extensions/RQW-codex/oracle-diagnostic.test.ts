// Deterministic checks of the CI-only oracle diagnostic: exact-once anchors, digest refusals, marker privacy,
// marker stripping back to the original text, marker file validation, and the two-arm run with a mocked runner.
// Synthetic fixtures only (no native sources, no cargo, no network). Diagnostic only, not oracle acceptance.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';

import { CASE_TIMEOUT_MS, PIN_COMMIT, RESPONSES_RS, sha256Hex } from '../../../extensions/RQW-codex/scripts/capture-oracle.mjs';
import {
  CONNECT_PROBE_CASE,
  CONNECT_PROBE_PATH,
  CONNECT_PROBE_TRACE,
  CONNECT_PROBE_SOURCE,
  appendConnectProbe,
  readConnectProbeRecords,
  runConnectProbe,
  DIAGNOSTIC_FILES,
  DIAGNOSTIC_KIND,
  FIXED_CASE,
  MARKS_FILE,
  MARK_STAGES,
  MARK_TAG,
  appendHelper,
  applyDiagnosticEdits,
  diagnosticAnchors,
  readMarkers,
  runDiagnostic,
  stripDiagnosticMarkers,
  verifyDiagnosticDigests,
} from '../../../extensions/RQW-codex/scripts/oracle-diagnostic.mjs';

const roots: string[] = [];

after(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'rqw-diag-test-'));
  roots.push(root);
  return root;
}

// Each production anchor exactly once, in order: the synthetic native file for one diagnostic path.
function fixtureText(path: string): string {
  return diagnosticAnchors(path).join('\n') + '\n';
}

function fixtureFiles() {
  return DIAGNOSTIC_FILES.map((file) => ({
    ...file,
    sha256: sha256Hex(Buffer.from(fixtureText(file.path))),
  }));
}

describe('one-shot native connect probe', () => {
  const rows = () => [
    { backend: 'raw_tcp', case: 'listening', outcome: 'connected', elapsedMs: 1, rawOsError: null },
    { backend: 'raw_tcp', case: 'held', outcome: 'observation_timeout', elapsedMs: 12001, rawOsError: null },
    { backend: 'raw_tcp', case: 'dropped', outcome: 'connection_refused', elapsedMs: 1, rawOsError: 61 },
    { backend: 'http_transport', case: 'held', outcome: 'observation_timeout', elapsedMs: 12001, rawOsError: null },
    { backend: 'http_transport', case: 'dropped', outcome: 'connection_refused', elapsedMs: 1, rawOsError: 61 },
  ];

  async function runProbe(buildFails = false, invalidTrace = false, scenario: { digestMismatch?: boolean; invalidControls?: boolean; nativeFails?: boolean } = {}) {
    const root = await tempRoot();
    const source = join(root, 'codex-rs');
    const out = join(root, 'out');
    const original = 'fn native_unchanged() {}\n';
    await mkdir(dirname(join(source, CONNECT_PROBE_PATH)), { recursive: true });
    await writeFile(join(source, CONNECT_PROBE_PATH), original);
    await writeFile(join(source, 'rust-toolchain.toml'), '[toolchain]\nchannel = "1.92.0"\n');
    const manifestPath = join(root, 'manifest.json');
    await writeFile(manifestPath, JSON.stringify({ pin: { commit: PIN_COMMIT }, sourceFiles: [] }));
    await mkdir(out, { recursive: true });
    await writeFile(join(out, CONNECT_PROBE_TRACE), 'stale result\n');
    const calls: { args: string[]; cwd: string; env: Record<string, string>; timeoutMs: number }[] = [];
    const result = await runConnectProbe({ source, out, manifestPath, deps: {
      checkPin: async () => PIN_COMMIT,
      verifyDigests: async () => 0,
      probeFile: { path: CONNECT_PROBE_PATH, sha256: scenario.digestMismatch ? '0'.repeat(64) : sha256Hex(Buffer.from(original)) },
      runCommand: async (_command: string, args: string[], options: { cwd: string; env: Record<string, string>; timeoutMs: number }) => {
        calls.push({ args, ...options });
        assert.equal(existsSync(join(out, CONNECT_PROBE_TRACE)), false);
        assert.equal(options.env.RQW_ORACLE_DIAG_MARKS, undefined);
        assert.equal(options.env.RQW_ORACLE_CONNECT_TRACE, join(out, CONNECT_PROBE_TRACE));
        assert.equal(stripDiagnosticMarkers(await readFile(join(options.cwd, CONNECT_PROBE_PATH), 'utf8')), original);
        if (args.includes('--no-run')) return { code: buildFails ? 101 : 0, stdout: 'build fixture' };
        const observations = rows();
        if (invalidTrace) observations[4].outcome = 'secret arbitrary error';
        if (scenario.invalidControls) observations[2].outcome = 'connected';
        await writeFile(join(out, CONNECT_PROBE_TRACE), observations.map((row) => JSON.stringify(row)).join('\n') + '\n');
        return scenario.nativeFails
          ? { code: 101, stdout: 'test result: FAILED. 0 passed; 1 failed;' }
          : { code: 0, stdout: 'test result: ok. 1 passed; 0 failed;' };
      },
    } });
    return { result, calls, out };
  }

  it('appends the probe without changing native bytes and uses typed private records', () => {
    const original = 'fn native() {}\n';
    assert.equal(stripDiagnosticMarkers(appendConnectProbe(original)), original);
    assert.match(CONNECT_PROBE_SOURCE, /from_millis\(12000\)/);
    assert.match(CONNECT_PROBE_SOURCE, /ErrorKind::ConnectionRefused/);
    assert.match(CONNECT_PROBE_SOURCE, /downcast_ref::<std::io::Error>/);
    assert.match(CONNECT_PROBE_SOURCE, /\.no_proxy\(\)\.redirect\(reqwest::redirect::Policy::none\(\)\)/);
    assert.doesNotMatch(CONNECT_PROBE_SOURCE, /error\.to_string|format!\([^\n]*error|RUST_LOG|set_var|api\.openai|chatgpt\.com/);
  });

  it('builds separately then runs one exact probe with no oracle acceptance', async () => {
    const { result, calls, out } = await runProbe();
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0].args, ['test', '-p', 'codex-http-client', '--lib', '--no-run']);
    assert.deepEqual(calls[1].args, ['test', '-p', 'codex-http-client', '--lib', '--', '--exact', CONNECT_PROBE_CASE, '--test-threads=1']);
    assert.equal(calls[0].timeoutMs, 6 * 60 * 60 * 1000);
    assert.equal(calls[1].timeoutMs, 120000);
    assert.equal(calls[0].cwd, calls[1].cwd);
    assert.equal(calls[0].env, calls[1].env);
    assert.equal(result.ok, true);
    assert.equal(result.controlsValid, true);
    assert.equal(result.hypothesis, 'supported');
    assert.equal(result.notOracleAcceptance, true);
    assert.equal(result.observationMs, 12000);
    assert.equal(result.host.toolchain, '1.92.0');
    assert.equal(existsSync(join(out, 'connect-probe.json')), true);
    assert.equal(existsSync(join(out, 'run.json')), false);
  });

  it('does not run the probe after a failed build or reuse stale observations', async () => {
    const { result, calls, out } = await runProbe(true);
    assert.equal(calls.length, 1);
    assert.equal(result.ok, false);
    assert.equal(result.build.exitCode, 101);
    assert.equal(result.exitCode, null);
    assert.equal(existsSync(join(out, CONNECT_PROBE_TRACE)), false);
    assert.equal(result.hypothesis, 'inconclusive');
  });

  it('rejects a fifth-file digest mismatch before any cargo command', async () => {
    const { result, calls } = await runProbe(false, false, { digestMismatch: true });
    assert.equal(calls.length, 0);
    assert.equal(result.ok, false);
    assert.ok(result.failures.some((failure: string) => /digest mismatch/.test(failure)));
  });

  it('does not claim support with invalid controls or a failing native execution', async () => {
    const invalid = await runProbe(false, false, { invalidControls: true });
    assert.equal(invalid.result.ok, false);
    assert.equal(invalid.result.controlsValid, false);
    assert.equal(invalid.result.hypothesis, 'inconclusive');
    const failed = await runProbe(false, false, { nativeFails: true });
    assert.equal(failed.result.ok, false);
    assert.equal(failed.result.exitCode, 101);
    assert.equal(failed.result.hypothesis, 'inconclusive');
    assert.ok(failed.result.failures.includes('connect probe native execution failed'));
  });

  it('rejects arbitrary categories and extra fields without copying them into the report', async () => {
    const { result, out } = await runProbe(false, true);
    assert.equal(result.ok, false);
    assert.doesNotMatch(JSON.stringify(result), /secret arbitrary error/);
    await writeFile(join(out, CONNECT_PROBE_TRACE), JSON.stringify({ ...rows()[0], secret: 'x' }) + '\n');
    assert.equal((await readConnectProbeRecords(join(out, CONNECT_PROBE_TRACE))).valid, false);
  });
});

describe('oracle diagnostic anchors and digests', () => {
  it('refuses a missing or duplicated anchor and overlapping edits', () => {
    assert.throws(
      () => applyDiagnosticEdits('a\nb\n', [{ anchor: 'zzz\n', replacement: 'x' }], 'p.rs'),
      /found 0 times/,
    );
    assert.throws(
      () => applyDiagnosticEdits('q\nq\n', [{ anchor: 'q\n', replacement: 'x' }], 'p.rs'),
      /found 2 times/,
    );
    assert.throws(
      () =>
        applyDiagnosticEdits(
          'abc\n',
          [
            { anchor: 'ab', replacement: 'x' },
            { anchor: 'bc', replacement: 'y' },
          ],
          'p.rs',
        ),
      /overlapping/,
    );
  });

  it('refuses a native file whose pre-edit digest differs', async () => {
    const root = await tempRoot();
    const file = DIAGNOSTIC_FILES[0];
    await mkdir(dirname(join(root, file.path)), { recursive: true });
    await writeFile(join(root, file.path), 'changed upstream text\n');
    await assert.rejects(verifyDiagnosticDigests(root, [file]), /digest mismatch/);
  });

  it('accepts the pinned digest of a matching native file', async () => {
    const root = await tempRoot();
    const file = DIAGNOSTIC_FILES[1];
    await mkdir(dirname(join(root, file.path)), { recursive: true });
    await writeFile(join(root, file.path), fixtureText(file.path));
    const hashes = await verifyDiagnosticDigests(root, [{ ...file, sha256: sha256Hex(Buffer.from(fixtureText(file.path))) }]);
    assert.equal(hashes[file.path], sha256Hex(Buffer.from(fixtureText(file.path))));
  });
});

describe('oracle diagnostic marker privacy and stripping', () => {
  it('the marker helper is std-only and writes only unix-ms, thread id and a static stage', () => {
    const helper = appendHelper('\n')
      .split('\n')
      .filter((line) => line.endsWith(MARK_TAG))
      .map((line) => line.slice(0, -MARK_TAG.length))
      .join('\n');
    assert.deepEqual(helper.match(/env::var_os\("[^"]*"\)/g), ['env::var_os("RQW_ORACLE_DIAG_MARKS")']);
    assert.doesNotMatch(helper, /header|url|uri|body|err|display|env::var\(|authorization|token/i);
    assert.match(helper, /unixMs/);
    assert.match(helper, /stage: &'static str/);
  });

  it('every production instrumentation strips back to the original text and uses only allowed stages', () => {
    for (const file of DIAGNOSTIC_FILES) {
      const original = fixtureText(file.path);
      const marked = file.instrument(original);
      assert.equal(stripDiagnosticMarkers(marked), original, `${file.path} strip mismatch`);
      const stages = [...marked.matchAll(/rqw_diag_mark\("([a-z_]+)"\)/g)].map((match) => match[1]);
      assert.ok(stages.length > 0, `${file.path} has no markers`);
      for (const stage of stages) assert.ok(MARK_STAGES.includes(stage), `${file.path} stage ${stage}`);
    }
  });

  it('marker insertion is tagged and never touches non-tagged lines', () => {
    const original = 'fn a() {\n    let b = 1;\n}\n';
    const edited = applyDiagnosticEdits(original, [
      { anchor: '    let b = 1;\n', replacement: '    rqw_diag_mark("retry_entry"); // rqw-diag\n    let b = 1;\n' },
    ], 'x.rs');
    assert.equal(stripDiagnosticMarkers(edited), original);
  });

  it('readMarkers accepts only the three-field static records', async () => {
    const root = await tempRoot();
    const good = join(root, 'good.jsonl');
    await writeFile(good, '{"unixMs":1700000000000,"thread":"ThreadId(3)","stage":"case_begin"}\n');
    assert.equal((await readMarkers(good)).valid, true);

    const extra = join(root, 'extra.jsonl');
    await writeFile(extra, '{"unixMs":1,"thread":"ThreadId(3)","stage":"case_begin","error":"x"}\n');
    assert.equal((await readMarkers(extra)).valid, false);

    const unknown = join(root, 'unknown.jsonl');
    await writeFile(unknown, '{"unixMs":1,"thread":"ThreadId(3)","stage":"header_authorization"}\n');
    assert.equal((await readMarkers(unknown)).valid, false);

    const missing = await readMarkers(join(root, 'absent.jsonl'));
    assert.equal(missing.present, false);
    assert.equal(missing.valid, false);
  });
});

describe('oracle diagnostic two-arm run', () => {
  type Call = {
    args: string[];
    cwd: string;
    env: Record<string, string | undefined>;
    tagged: boolean;
    timeoutMs: number;
    logFile: string;
  };

  async function runWith(originalFails: boolean, markedPreflightFails = false, markedBuildFails = false) {
    const root = await tempRoot();
    const source = join(root, 'codex-rs');
    const out = join(root, 'out');
    const files = fixtureFiles();
    await mkdir(out, { recursive: true });
    await writeFile(join(out, MARKS_FILE), '{"unixMs":1,"thread":"ThreadId(1)","stage":"case_begin"}\n');
    for (const file of files) {
      await mkdir(dirname(join(source, file.path)), { recursive: true });
      await writeFile(join(source, file.path), fixtureText(file.path));
    }
    await mkdir(dirname(join(source, RESPONSES_RS)), { recursive: true });
    await writeFile(join(source, RESPONSES_RS), 'pub fn sse(events: Vec<Value>) -> String {\n');
    const manifestPath = join(root, 'manifest.json');
    await writeFile(manifestPath, JSON.stringify({ pin: { commit: PIN_COMMIT }, sourceFiles: [] }));

    const calls: Call[] = [];
    const builds: Call[] = [];
    let digestChecks = 0;
    const runCommand = async (
      _command: string,
      args: string[],
      options: { cwd: string; env: Record<string, string | undefined>; timeoutMs: number; logFile: string },
    ) => {
      const marked = options.env.RQW_ORACLE_DIAG_MARKS !== undefined;
      const tagged = (await readFile(join(options.cwd, 'core/src/responses_retry.rs'), 'utf8')).includes(MARK_TAG);
      const call = { args, ...options, tagged };
      if (args.includes('--no-run')) {
        builds.push(call);
        return { code: marked && markedBuildFails ? 101 : 0, stdout: 'build-only fixture\n' };
      }
      calls.push(call);
      if (!marked) assert.equal(existsSync(join(out, MARKS_FILE)), false, 'stale markers survived until original arm');
      if (marked) {
        await appendFile(
          options.env.RQW_ORACLE_DIAG_MARKS as string,
          '{"unixMs":1700000000000,"thread":"ThreadId(3)","stage":"case_begin"}\n',
        );
      }
      const fails = !marked && originalFails;
      return {
        code: fails ? 101 : 0,
        stdout: fails ? 'test result: FAILED. 0 passed; 1 failed;' : 'test result: ok. 1 passed; 0 failed;',
      };
    };

    const diagnostic = await runDiagnostic({
      source,
      commit: PIN_COMMIT,
      out,
      manifestPath,
      deps: {
        files,
        checkPin: async () => PIN_COMMIT,
        verifyDigests: async () => {
          digestChecks += 1;
          if (markedPreflightFails && digestChecks === 3) throw new Error('marked copy digest mismatch');
          return 0;
        },
        instrumentCapture: (text: string) => text,
        runCommand,
      },
    });
    return { diagnostic, calls, builds, out };
  }

  it('runs each arm exactly once and reports a failed original as failed without oracle acceptance', async () => {
    const { diagnostic, calls, builds, out } = await runWith(true);
    assert.equal(builds.length, 2);
    assert.deepEqual(builds[0].args, ['test', '-p', 'codex-core', '--test', 'all', '--no-run']);
    assert.deepEqual(builds[1].args, builds[0].args);
    for (let i = 0; i < builds.length; i += 1) {
      assert.equal(builds[i].timeoutMs, 6 * 60 * 60 * 1000);
      assert.equal(builds[i].cwd, calls[i].cwd);
      assert.equal(builds[i].env, calls[i].env);
      assert.equal(builds[i].logFile, join(out, `logs/${i === 0 ? 'original' : 'marked'}-build.log`));
      assert.equal(calls[i].timeoutMs, CASE_TIMEOUT_MS);
      assert.equal(diagnostic.arms[i].build.ok, true);
    }
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0].args, ['test', '-p', 'codex-core', '--test', 'all', '--', '--exact', FIXED_CASE, '--test-threads=1']);
    assert.deepEqual(calls[1].args, calls[0].args);
    assert.equal(calls[0].env.RQW_ORACLE_DIAG_MARKS, undefined);
    assert.equal(String(calls[1].env.RQW_ORACLE_DIAG_MARKS).endsWith(MARKS_FILE), true);
    assert.equal(calls[0].tagged, false);
    assert.equal(calls[1].tagged, true);
    assert.equal(diagnostic.kind, DIAGNOSTIC_KIND);
    assert.equal(diagnostic.notOracleAcceptance, true);
    assert.equal(diagnostic.ok, false);
    assert.equal(diagnostic.arms[0].ok, false);
    assert.equal(diagnostic.arms[1].ok, true);
    assert.ok(diagnostic.failures.some((failure: string) => /original arm native case failed/.test(failure)));
    assert.equal(diagnostic.markers.valid, true);
    assert.equal(existsSync(join(out, 'diagnostic.json')), true);
    assert.equal(existsSync(join(out, 'run.json')), false);
  });

  it('passes when both arms pass and markers are collected', async () => {
    const { diagnostic } = await runWith(false);
    assert.equal(diagnostic.ok, true);
    assert.deepEqual(diagnostic.failures, []);
  });

  it('isolates both arms from ambient marker configuration and restores the environment', async () => {
    const previous = process.env.RQW_ORACLE_DIAG_MARKS;
    const ambient = join(await tempRoot(), 'ambient-marks.jsonl');
    process.env.RQW_ORACLE_DIAG_MARKS = ambient;
    try {
      const { diagnostic, calls, out } = await runWith(false);
      assert.equal(diagnostic.ok, true);
      assert.equal(calls[0].env.RQW_ORACLE_DIAG_MARKS, undefined);
      assert.equal(calls[1].env.RQW_ORACLE_DIAG_MARKS, join(out, MARKS_FILE));
      assert.equal(process.env.RQW_ORACLE_DIAG_MARKS, ambient);
      assert.equal(existsSync(ambient), false);
    } finally {
      if (previous === undefined) delete process.env.RQW_ORACLE_DIAG_MARKS;
      else process.env.RQW_ORACLE_DIAG_MARKS = previous;
    }
  });

  it('does not accept stale markers when the marked arm fails preflight', async () => {
    const { diagnostic, calls, out } = await runWith(false, true);
    assert.equal(calls.length, 1);
    assert.equal(diagnostic.ok, false);
    assert.equal(diagnostic.markers.valid, false);
    assert.equal(diagnostic.markers.count, 0);
    assert.equal(existsSync(join(out, MARKS_FILE)), false);
    assert.match(diagnostic.arms[1].error, /marked copy digest mismatch/);
  });

  it('reports a build failure separately and does not run the unbuilt native case', async () => {
    const { diagnostic, calls, builds } = await runWith(false, false, true);
    assert.equal(builds.length, 2);
    assert.equal(calls.length, 1);
    assert.equal(diagnostic.ok, false);
    assert.equal(diagnostic.arms[1].build.exitCode, 101);
    assert.equal(diagnostic.arms[1].build.ok, false);
    assert.equal(diagnostic.arms[1].exitCode, null);
    assert.match(diagnostic.arms[1].error, /marked arm build failed/);
    assert.equal(diagnostic.markers.valid, false);
    assert.equal(diagnostic.markers.count, 0);
  });

  it('refuses another case or another commit before any copy', async () => {
    const root = await tempRoot();
    await assert.rejects(
      runDiagnostic({ source: root, commit: PIN_COMMIT, out: join(root, 'o'), caseName: 'suite::other' }),
      /fixed case/,
    );
    await assert.rejects(
      runDiagnostic({ source: root, commit: '0'.repeat(40), out: join(root, 'o') }),
      /not the pinned/,
    );
  });
});
