import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Materialize only product resources from an already extracted repository snapshot.
export function materializeMyPi(source, output, sha) {
  const manifest = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'));
  if (manifest.name !== 'my-pi' || !manifest.pi?.extensions) throw new Error('Invalid my-pi package');
  fs.mkdirSync(output);
  fs.cpSync(path.join(source, 'extensions'), path.join(output, 'extensions'), { recursive: true });
  const packaged = {
    name: manifest.name, private: true, type: manifest.type, pi: manifest.pi,
    dependencies: { ...manifest.dependencies, typebox: manifest.devDependencies.typebox },
    peerDependencies: manifest.peerDependencies,
  };
  fs.writeFileSync(path.join(output, 'package.json'), JSON.stringify(packaged, null, 2) + '\n');
  fs.writeFileSync(path.join(output, '.revision'), sha + '\n');
  return output;
}

// Resolve main once: the archive and provenance always refer to the same commit.
export async function bundleMyPi(root, external = {}) {
  const request = external.fetch ?? fetch;
  const response = await request('https://api.github.com/repos/ARQAWA/my-pi/commits/main');
  if (!response.ok) throw new Error('my-pi main lookup failed: HTTP ' + response.status);
  const { sha } = await response.json();
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('Invalid my-pi main SHA');
  const archive = await request('https://codeload.github.com/ARQAWA/my-pi/tar.gz/' + sha);
  if (!archive.ok) throw new Error('my-pi download failed: HTTP ' + archive.status);
  const temp = path.join(root, 'my-pi.tmp');
  const destination = path.join(root, 'my-pi');
  fs.rmSync(temp, { recursive: true, force: true });
  fs.mkdirSync(temp, { recursive: true });
  try {
    const tarball = path.join(temp, 'source.tar.gz');
    const source = path.join(temp, 'source');
    fs.mkdirSync(source);
    fs.writeFileSync(tarball, Buffer.from(await archive.arrayBuffer()));
    const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot, 'System32', 'tar.exe') : 'tar';
    const extracted = spawnSync(tar, ['-xf', tarball, '--strip-components=1', '-C', source], { stdio: 'inherit' });
    if (extracted.status !== 0) throw new Error('my-pi extraction failed');
    const output = materializeMyPi(source, path.join(temp, 'package'), sha);
    const installed = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm',
      ['install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'],
      { cwd: output, stdio: 'inherit', shell: process.platform === 'win32' });
    if (installed.status !== 0) throw new Error('my-pi dependencies failed');
    fs.rmSync(destination, { recursive: true, force: true });
    fs.renameSync(output, destination);
    return sha;
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log('bundled my-pi ' + await bundleMyPi(path.dirname(fileURLToPath(import.meta.url))));
}
