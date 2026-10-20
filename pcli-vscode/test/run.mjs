// E2E driver: real VS Code, the BUILT pcli.vsix installed through the VS Code CLI, two proxy scenarios.
// Usage (from pcli-vscode, proxy.cjs already running): node test/run.mjs [path/to/pcli.vsix]
import { downloadAndUnzipVSCode, resolveCliArgsFromVSCodeExecutablePath, runTests } from '@vscode/test-electron';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vsix = path.resolve(process.argv[2] || path.join(root, 'pcli.vsix'));
const base = path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'pcli-e2e');
const extDir = path.join(base, 'vs ext');
const ws = path.join(base, 'ws dir', "it's");
const proxyLog = path.join(root, 'proxy.log');
const PROXY = "http://pcli:it's@127.0.0.1:18999";

fs.rmSync(base, { recursive: true, force: true });
fs.mkdirSync(extDir, { recursive: true });
fs.mkdirSync(ws, { recursive: true });
// The runner must not leak proxy vars of its own into VS Code
for (const k of Object.keys(process.env)) if (/^(https?|all|no)_proxy$/i.test(k)) delete process.env[k];

const exe = await downloadAndUnzipVSCode('stable');
const [cli, ...cliArgs] = resolveCliArgsFromVSCodeExecutablePath(exe, { reuseMachineInstall: true });
console.log('vscode', exe, '\nvsix', vsix, fs.statSync(vsix).size, 'bytes\nextensions dir', extDir, '\nworkspace', ws);

// code.cmd needs a shell on Windows: quote every argument for cmd.exe
function code(...args) {
  const all = [...cliArgs, ...args];
  const r = process.platform === 'win32'
    ? spawnSync(`"${cli}"`, all.map((a) => `"${a}"`), { stdio: 'inherit', shell: true })
    : spawnSync(cli, all, { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('code ' + args.join(' ') + ' failed: ' + r.status);
}
code('--version');
code('--extensions-dir=' + extDir, '--install-extension', vsix, '--force');
code('--extensions-dir=' + extDir, '--list-extensions', '--show-versions');

// Simulates the VDI Git Bash profile with a dead proxy: our export in the bash line must win
const profile = path.join(os.homedir(), '.bash_profile');
const backup = fs.existsSync(profile) ? fs.readFileSync(profile) : null;
fs.writeFileSync(profile, 'export HTTPS_PROXY=http://127.0.0.1:9\nexport HTTP_PROXY=http://127.0.0.1:9\n');
console.log('wrote dead-proxy', profile);

async function scenario(name) {
  const dir = path.join(base, 'run-' + name);
  const agent = path.join(base, 'agent-' + name);
  fs.cpSync(path.join(root, 'test', 'pi-agent'), agent, { recursive: true });
  fs.mkdirSync(path.join(dir, 'user', 'User'), { recursive: true });
  const env = { PI_CODING_AGENT_DIR: agent, PCLI_SCENARIO: name, PCLI_PROXY_LOG: proxyLog, PCLI_EXT_DIR: extDir, PCLI_WS: ws };
  if (name === 'A') Object.assign(env, { HTTP_PROXY: PROXY, HTTPS_PROXY: PROXY });
  else fs.writeFileSync(path.join(dir, 'user', 'User', 'settings.json'), JSON.stringify({ 'http.proxy': PROXY, 'http.proxyStrictSSL': false }));
  console.log(`\n===== scenario ${name} =====`);
  try {
    await runTests({
      vscodeExecutablePath: exe,
      extensionDevelopmentPath: path.join(root, 'test', 'harness'),
      extensionTestsPath: path.join(root, 'test', 'suite.cjs'),
      extensionTestsEnv: env,
      launchArgs: [ws, '--extensions-dir=' + extDir, '--user-data-dir=' + path.join(dir, 'user'), '--disable-workspace-trust'],
    });
    console.log(`===== scenario ${name}: OK =====`);
    return true;
  } catch (err) {
    console.log(`===== scenario ${name}: FAILED: ${err.message} =====`);
    return false;
  }
}

let ok = false;
try {
  const a = await scenario('A');
  const b = await scenario('B');
  ok = a && b;
} finally {
  if (backup) fs.writeFileSync(profile, backup);
  else fs.rmSync(profile, { force: true });
}
console.log(ok ? 'ALL SCENARIOS PASSED' : 'SOME SCENARIO FAILED');
process.exit(ok ? 0 : 1);
