// Сборка: скачивает pi.exe из официального релиза, проверяет sha256 и распаковывает в pi/ рядом со скриптом.
// Запускается только при сборке VSIX (vscode:prepublish), не во время работы расширения.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = '1.3.0';
const URL = 'https://github.com/earendil-works/pi/releases/download/v1.3.0/pi-windows-x64.zip';
// Хэш из SHA256SUMS этого релиза, зашит как якорь доверия
const SHA256 = 'daf0ef45fd08f13dbb64c62d559e332c2d3d3087f8ae022ec5a1b9b655b59894';

const root = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(root, 'pi');
const tmpDir = path.join(root, 'pi.tmp');

function present() {
  try {
    return fs.existsSync(path.join(dir, 'pi.exe')) && fs.readFileSync(path.join(dir, '.sha256'), 'utf8') === SHA256;
  } catch {
    return false;
  }
}

if (present()) {
  console.log('pi ' + VERSION + ' already present');
  process.exit(0);
}

console.log('downloading ' + URL);
const res = await fetch(URL);
if (!res.ok) throw new Error('download failed: HTTP ' + res.status + ' ' + res.statusText);
const data = Buffer.from(await res.arrayBuffer());
const actual = createHash('sha256').update(data).digest('hex');
if (actual !== SHA256) throw new Error('sha256 mismatch: expected ' + SHA256 + ', got ' + actual);
console.log('sha256 ok, ' + data.length + ' bytes');

const zipPath = path.join(os.tmpdir(), 'pi-' + VERSION + '-' + process.pid + '.zip');
fs.writeFileSync(zipPath, data);
try {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir);
  // Windows: bsdtar из System32 читает zip, GNU tar из Git Bash не умеет
  const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot, 'System32', 'tar.exe') : 'tar';
  const r = spawnSync(tar, ['-xf', zipPath, '-C', tmpDir], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('tar failed, status ' + r.status + (r.error ? ': ' + r.error.message : ''));
  if (!fs.existsSync(path.join(tmpDir, 'pi.exe'))) throw new Error('pi.exe not found after extraction');
  fs.writeFileSync(path.join(tmpDir, '.sha256'), SHA256);
  fs.renameSync(tmpDir, dir);
} finally {
  fs.rmSync(zipPath, { force: true });
}
console.log('pi ' + VERSION + ' extracted to ' + dir);
