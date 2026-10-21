// Driver of the ConPTY capture: real VS Code (its own node-pty), the bundled pi.exe, without and with RQW-mouse.
// Usage (Windows, from pcli-vscode, after "node fetch-pi.mjs"): node test/mouse.mjs
import { downloadAndUnzipVSCode, runTests } from '@vscode/test-electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'pcli-mouse');
const ws = path.join(base, 'ws');
const piExe = path.join(root, 'pi', 'pi.exe');
if (!fs.existsSync(piExe)) throw new Error('missing ' + piExe + ': run "node fetch-pi.mjs" first');

fs.rmSync(base, { recursive: true, force: true });
fs.mkdirSync(ws, { recursive: true });
fs.mkdirSync(path.join(base, 'ext'), { recursive: true });
// The runner must not leak proxy vars of its own into VS Code or Pi
for (const k of Object.keys(process.env)) if (/^(https?|all|no)_proxy$/i.test(k)) delete process.env[k];

const exe = await downloadAndUnzipVSCode('stable');
console.log('vscode', exe, '\npi', piExe, fs.statSync(piExe).size, 'bytes');
try {
  await runTests({
    vscodeExecutablePath: exe,
    extensionDevelopmentPath: path.join(root, 'test', 'harness'),
    extensionTestsPath: path.join(root, 'test', 'mouse-suite.cjs'),
    extensionTestsEnv: {
      PCLI_PI_EXE: piExe,
      PCLI_MOUSE_EXT: path.join(root, '..', 'extensions', 'RQW-mouse', 'index.ts'),
      PCLI_AGENT_TEMPLATE: path.join(root, 'test', 'pi-agent'),
      PCLI_MOUSE_TMP: base,
    },
    launchArgs: [ws, '--extensions-dir=' + path.join(base, 'ext'), '--user-data-dir=' + path.join(base, 'user'), '--disable-workspace-trust'],
  });
} catch (err) {
  console.log('MOUSE CAPTURE FAILED: ' + err.message);
  process.exit(1);
}
