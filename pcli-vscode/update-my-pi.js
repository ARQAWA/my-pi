'use strict';

const fs = require('fs');
const path = require('path');
const { gunzipSync } = require('zlib');
const { isDeepStrictEqual } = require('util');
const { createHash } = require('crypto');

// Read GitHub's gzip/ustar archive without a target-side tar or npm process.
function unpackProduct(archive, output) {
  const data = gunzipSync(archive, { maxOutputLength: 64 * 1024 * 1024 });
  let extendedPath;
  const field = (header, start, length) => header.subarray(start, start + length).toString('utf8').split('\0')[0];
  for (let offset = 0; offset + 512 <= data.length;) {
    const header = data.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) return;
    const octal = (start, length) => {
      const value = field(header, start, length).trim();
      if (!/^[0-7]+$/.test(value)) throw new Error('Invalid archive header');
      return parseInt(value, 8);
    };
    const checksum = header.reduce((sum, byte, i) => sum + (i >= 148 && i < 156 ? 32 : byte), 0);
    if (checksum !== octal(148, 8)) throw new Error('Invalid archive checksum');
    const size = octal(124, 12);
    const body = data.subarray(offset + 512, offset + 512 + size);
    if (body.length !== size) throw new Error('Truncated archive');
    offset += 512 + Math.ceil(size / 512) * 512;
    const type = field(header, 156, 1);
    if (type === 'g') continue;
    if (type === 'x') {
      for (let pos = 0; pos < body.length;) {
        const space = body.indexOf(32, pos);
        const length = Number(body.subarray(pos, space).toString());
        if (space < pos || !Number.isSafeInteger(length) || length <= space - pos + 1 || pos + length > body.length) {
          throw new Error('Invalid archive metadata');
        }
        const record = body.subarray(space + 1, pos + length - 1).toString('utf8');
        if (record.startsWith('path=')) extendedPath = record.slice(5);
        pos += length;
      }
      continue;
    }
    const prefix = field(header, 345, 155);
    const name = extendedPath ?? (prefix ? prefix + '/' : '') + field(header, 0, 100);
    extendedPath = undefined;
    const parts = name.split('/');
    if (name.includes('\\') || name.includes(':') || parts.some((part) => part === '..') || !parts[0]) {
      throw new Error('Unsafe archive path');
    }
    const relative = parts.slice(1).join('/');
    if (relative !== 'package.json' && !relative.startsWith('extensions/')) continue;
    if (type === '5') continue;
    if (type !== '' && type !== '0') throw new Error('Unsupported archive resource');
    const target = path.join(output, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, body);
  }
  throw new Error('Truncated archive');
}

function createUpdater(context, request = globalThis.fetch, sockets = require('net')) {
  const bundled = path.join(context.extensionPath, 'my-pi');
  const managedRoot = path.join(context.globalStorageUri.fsPath, 'my-pi');
  // A new PCLI version starts from its new bundled package, not an older override.
  const store = path.join(managedRoot, context.extension.packageJSON.version);
  const pointer = path.join(store, 'current.json');
  let pending;
  async function acquireLease() {
    // Windows releases a named-pipe binding when its host dies: no stale file or PID recovery.
    const key = createHash('sha256').update(path.resolve(managedRoot).replace(/\\/g, '/').toLowerCase()).digest('hex');
    const pipe = '\\\\.\\pipe\\arqawa-pcli-update-' + key;
    const server = sockets.createServer((socket) => socket.destroy());
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(pipe, resolve);
    });
    return () => new Promise((resolve) => server.close(resolve));
  }
  function current() {
    if (!fs.existsSync(pointer)) return bundled;
    const sha = JSON.parse(fs.readFileSync(pointer, 'utf8'));
    if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('Invalid managed my-pi revision');
    return path.join(store, sha);
  }
  async function perform() {
    fs.mkdirSync(store, { recursive: true });
    const release = await acquireLease();
    const stage = path.join(store, 'staging');
    try {
      const response = await request('https://api.github.com/repos/ARQAWA/my-pi/commits/main');
      if (!response.ok) throw new Error('my-pi lookup failed: HTTP ' + response.status);
      const { sha } = await response.json();
      if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('Invalid my-pi main revision');
      const previous = current();
      if (fs.readFileSync(path.join(previous, '.revision'), 'utf8').trim() === sha) return previous;
      const archive = await request('https://codeload.github.com/ARQAWA/my-pi/tar.gz/' + sha);
      if (!archive.ok) throw new Error('my-pi download failed: HTTP ' + archive.status);
      fs.rmSync(stage, { recursive: true, force: true });
      fs.mkdirSync(stage);
      unpackProduct(Buffer.from(await archive.arrayBuffer()), stage);
      const manifestPath = path.join(stage, 'package.json');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      if (manifest.name !== 'my-pi' || !manifest.pi?.extensions) throw new Error('Invalid my-pi package');
      const dependencies = { ...manifest.dependencies };
      const previousManifest = JSON.parse(fs.readFileSync(path.join(previous, 'package.json'), 'utf8'));
      const previousDependencies = { ...previousManifest.dependencies };
      delete previousDependencies.typebox;
      if (!isDeepStrictEqual(dependencies, previousDependencies)
        || !isDeepStrictEqual(manifest.peerDependencies?.['@earendil-works/pi-coding-agent'],
          previousManifest.peerDependencies?.['@earendil-works/pi-coding-agent'])) {
        throw new Error('my-pi dependencies changed; update the extension. Current my-pi kept.');
      }
      for (const resource of [...manifest.pi.extensions, ...(manifest.pi.themes ?? [])]) {
        const resolved = path.resolve(stage, resource);
        if (!resolved.startsWith(stage + path.sep) || !fs.statSync(resolved).isFile()) throw new Error('Invalid my-pi resource');
      }
      fs.writeFileSync(manifestPath, JSON.stringify({
        name: manifest.name, private: true, type: manifest.type, pi: manifest.pi, dependencies,
        peerDependencies: manifest.peerDependencies,
      }, null, 2) + '\n');
      fs.cpSync(path.join(previous, 'node_modules'), path.join(stage, 'node_modules'), { recursive: true });
      fs.writeFileSync(path.join(stage, '.revision'), sha + '\n');
      const destination = path.join(store, sha);
      if (!fs.existsSync(destination)) fs.renameSync(stage, destination);
      const next = pointer + '.tmp';
      fs.writeFileSync(next, JSON.stringify(sha) + '\n');
      // The only activation step: failed preparation never changes the current pointer.
      fs.renameSync(next, pointer);
      return destination;
    } finally {
      // Cleanup must not report a failure after the pointer has committed.
      try { fs.rmSync(stage, { recursive: true, force: true }); } catch {}
      await release();
    }
  }
  return {
    current, managedRoot, bundled,
    run() {
      if (!pending) pending = perform().finally(() => { pending = undefined; });
      return pending;
    },
  };
}

module.exports = { createUpdater };
