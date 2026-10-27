import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import { gzipSync } from 'node:zlib';

const require = createRequire(import.meta.url);
const { createUpdater } = require('../update-my-pi.js');

// Tiny ustar bytes: no archive tools, subprocesses or external files.
function archive(dependencies = { ws: '1', other: '2' }, code = 'new code', piVersion = '1.4.0') {
  const files = {
    'package.json': JSON.stringify({
      name: 'my-pi', type: 'module', dependencies, devDependencies: { typebox: '3' },
      peerDependencies: { '@earendil-works/pi-coding-agent': piVersion, typebox: '*' },
      pi: { extensions: ['./extensions/demo/index.ts'] },
    }),
    'extensions/demo/index.ts': code,
    '.pi/agents/private.toml': 'never ship this',
  };
  const blocks = [];
  for (const [relative, text] of Object.entries(files)) {
    const body = Buffer.from(text);
    const header = Buffer.alloc(512);
    header.write('my-pi-main/' + relative);
    header.write(body.length.toString(8).padStart(11, '0') + '\0', 124);
    header.fill(32, 148, 156);
    header.write('0', 156);
    header.write('ustar\0', 257);
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148);
    blocks.push(header, body, Buffer.alloc((512 - body.length % 512) % 512));
  }
  return gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)]), { mtime: 0 });
}

function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pcli-update-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bundled = path.join(root, 'my-pi');
  fs.mkdirSync(path.join(bundled, 'node_modules', 'ws'), { recursive: true });
  fs.mkdirSync(path.join(bundled, 'extensions', 'demo'), { recursive: true });
  fs.mkdirSync(path.join(root, 'pi'));
  fs.writeFileSync(path.join(root, 'pi', 'pi.exe'), 'fake Pi');
  fs.writeFileSync(path.join(bundled, 'package.json'), JSON.stringify({
    name: 'my-pi', dependencies: { typebox: '3', other: '2', ws: '1' },
    peerDependencies: { '@earendil-works/pi-coding-agent': '1.4.0', typebox: '*' },
  }));
  fs.writeFileSync(path.join(bundled, '.revision'), 'a'.repeat(40));
  fs.writeFileSync(path.join(bundled, 'extensions', 'demo', 'index.ts'), 'original code');
  fs.writeFileSync(path.join(bundled, 'node_modules', 'ws', 'index.js'), 'installed library');
  const agent = path.join(root, 'agent');
  fs.mkdirSync(agent);
  const settingsPath = path.join(agent, 'settings.json');
  const filters = { extensions: ['-extensions/RQW-codex/index.ts'], themes: [] };
  fs.writeFileSync(settingsPath, JSON.stringify({ model: 'keep', packages: ['npm:other', { source: bundled, ...filters }] }));
  fs.writeFileSync(path.join(agent, 'auth.json'), 'auth unchanged');
  const context = {
    extensionPath: root, subscriptions: [],
    globalStorageUri: { fsPath: path.join(root, 'storage') },
    extension: { packageJSON: { version: '0.0.2' } },
  };
  let sha = 'b'.repeat(40);
  let bytes = archive();
  const fetch = async (url) => {
    if (url === 'https://api.github.com/repos/ARQAWA/my-pi/commits/main') return { ok: true, json: async () => ({ sha }) };
    if (url === 'https://codeload.github.com/ARQAWA/my-pi/tar.gz/' + sha) return { ok: true, arrayBuffer: async () => bytes };
    throw new Error('unexpected URL ' + url);
  };
  let externalOwner = options.busy === true;
  let bound;
  const sockets = {
    createServer() {
      const server = new EventEmitter();
      server.listen = (_pipe, ready) => {
        if (!_pipe.startsWith(['', '', '.', 'pipe', 'arqawa-pcli-update-'].join('\\'))) {
          server.emit('error', new Error('Invalid Windows named pipe'));
          return server;
        }
        if (externalOwner || bound) server.emit('error', Object.assign(new Error('Another host owns the update lease'), { code: 'EADDRINUSE' }));
        else { bound = server; ready(); }
        return server;
      };
      server.close = (done) => { if (bound === server) bound = undefined; done(); };
      return server;
    },
  };
  const commands = new Map();
  const notifications = [];
  const progress = [];
  const terminals = [];
  const vscode = {
    commands: { registerCommand(name, callback) { commands.set(name, callback); return {}; } },
    ProgressLocation: { Notification: 15 },
    ViewColumn: { Active: 1 },
    EventEmitter: class { event() {} },
    env: { appRoot: root },
    workspace: { getConfiguration() { return { get() {} }; } },
    window: {
      withProgress(options, task) { progress.push(options.title); return task(); },
      showInformationMessage(message) { notifications.push(message); },
      showErrorMessage(message) { notifications.push(message); },
      createTerminal(options) { return { show() { terminals.push(options.name); } }; },
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(new URL('../extension.js', import.meta.url), 'utf8'), {
    module, fetch, process: { env: { PI_CODING_AGENT_DIR: agent } },
    require(id) {
      if (id === 'vscode') return vscode;
      if (id === './update-my-pi') return require('../update-my-pi.js');
      if (id === 'net') return sockets;
      if (id === 'fs') return { ...fs, existsSync(p) { return p === 'C:\\Program Files\\Git\\bin\\bash.exe' || fs.existsSync(p); } };
      if (id === 'os') return os;
      if (id === 'path') return path;
      if (id.endsWith('node-pty')) return {};
      throw new Error('unexpected import ' + id);
    },
  });
  module.exports.activate(context);
  const updater = createUpdater(context, fetch);
  return {
    root, bundled, agent, filters, settingsPath, notifications, progress, terminals, context,
    selected: () => updater.current(),
    update: () => commands.get('pcli.update')(),
    tab: () => commands.get('pcli.newTab')(),
    next(nextSha, nextArchive) { sha = nextSha; bytes = nextArchive; },
    otherHostExited() { externalOwner = false; },
  };
}

test('palette update selects new code and reuses current libraries without changing settings', async (t) => {
  const f = fixture(t);
  const manifest = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url)));
  assert.ok(manifest.contributes.commands.some((entry) => entry.command === 'pcli.update'
    && entry.title === 'Update' && entry.category === 'Pi CLI'));
  const settings = fs.readFileSync(f.settingsPath, 'utf8');
  await f.update();
  const first = f.selected();
  assert.equal(fs.readFileSync(path.join(first, 'extensions/demo/index.ts'), 'utf8'), 'new code');
  assert.equal(fs.readFileSync(path.join(first, 'node_modules/ws/index.js'), 'utf8'), 'installed library');
  assert.equal(fs.readFileSync(path.join(first, '.revision'), 'utf8').trim(), 'b'.repeat(40));
  assert.equal(fs.existsSync(path.join(first, '.pi')), false);
  assert.equal(fs.readFileSync(f.settingsPath, 'utf8'), settings);
  assert.ok(f.progress.includes('Updating my-pi...'));
  assert.ok(f.notifications.includes('my-pi updated. Open a new Pi tab to use it.'));
  f.tab();
  assert.deepEqual(f.terminals, ['pi 1']);
  assert.deepEqual(JSON.parse(fs.readFileSync(f.settingsPath)), {
    model: 'keep', packages: ['npm:other', { source: first, ...f.filters }],
  });
  fs.writeFileSync(path.join(f.bundled, 'node_modules/ws/index.js'), 'different bundled library');
  f.next('c'.repeat(40), archive({ other: '2', ws: '1' }, 'next code'));
  await f.update();
  assert.equal(fs.readFileSync(path.join(f.selected(), 'extensions/demo/index.ts'), 'utf8'), 'next code');
  assert.equal(fs.readFileSync(path.join(f.selected(), 'node_modules/ws/index.js'), 'utf8'), 'installed library');
  assert.equal(fs.readFileSync(path.join(first, 'extensions/demo/index.ts'), 'utf8'), 'new code');
  assert.equal(fs.readFileSync(path.join(f.agent, 'auth.json'), 'utf8'), 'auth unchanged');
});

test('changed dependencies retain selected code and ask to update the extension', async (t) => {
  const f = fixture(t);
  await f.update();
  const previous = f.selected();
  const settings = fs.readFileSync(f.settingsPath, 'utf8');
  f.next('c'.repeat(40), archive({ ws: 'changed', other: '2' }));
  await f.update();
  assert.equal(f.selected(), previous);
  assert.equal(fs.readFileSync(path.join(previous, 'extensions/demo/index.ts'), 'utf8'), 'new code');
  assert.equal(fs.readFileSync(f.settingsPath, 'utf8'), settings);
  assert.match(f.notifications.at(-1), /dependencies changed; update the extension/);
});

test('changed Pi requirement retains selected code and asks to update the extension', async (t) => {
  const f = fixture(t);
  await f.update();
  const previous = f.selected();
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(previous, 'package.json'))).peerDependencies, {
    '@earendil-works/pi-coding-agent': '1.4.0', typebox: '*',
  });
  f.next('c'.repeat(40), archive(undefined, 'incompatible code', '1.5.0'));
  await f.update();
  assert.equal(f.selected(), previous);
  assert.equal(fs.readFileSync(path.join(previous, 'extensions/demo/index.ts'), 'utf8'), 'new code');
  assert.match(f.notifications.at(-1), /dependencies changed; update the extension/);
  f.tab();
  assert.equal(JSON.parse(fs.readFileSync(f.settingsPath)).packages[1].source, previous);
});

test('corrupt download retains the previous selected package and reports failure', async (t) => {
  const f = fixture(t);
  await f.update();
  const previous = f.selected();
  const settings = fs.readFileSync(f.settingsPath, 'utf8');
  f.next('c'.repeat(40), Buffer.from('not a gzip archive'));
  await f.update();
  assert.equal(f.selected(), previous);
  assert.equal(fs.readFileSync(path.join(previous, 'extensions/demo/index.ts'), 'utf8'), 'new code');
  assert.equal(fs.readFileSync(f.settingsPath, 'utf8'), settings);
  assert.match(f.notifications.at(-1), /^my-pi update failed:/);
  f.tab();
  assert.equal(JSON.parse(fs.readFileSync(f.settingsPath)).packages[1].source, previous);
});

test('failure at activation retains previous package and reports failure', async (t) => {
  const f = fixture(t);
  await f.update();
  const previous = f.selected();
  // An unwritable pointer staging path fails after the new snapshot is prepared.
  fs.mkdirSync(path.join(f.root, 'storage/my-pi/0.0.2/current.json.tmp'));
  f.next('c'.repeat(40), archive({ ws: '1', other: '2' }, 'must not activate'));
  await f.update();
  assert.equal(f.selected(), previous);
  assert.equal(fs.readFileSync(path.join(previous, 'extensions/demo/index.ts'), 'utf8'), 'new code');
  assert.match(f.notifications.at(-1), /^my-pi update failed:/);
  f.tab();
  assert.equal(JSON.parse(fs.readFileSync(f.settingsPath)).packages[1].source, previous);
});

test('a live host excludes updates but its exit and legacy lock do not block recovery', async (t) => {
  const f = fixture(t, { busy: true });
  // A directory left by the old lock implementation must not require manual removal.
  fs.mkdirSync(path.join(f.root, 'storage/my-pi/update.lock'), { recursive: true });
  await f.update();
  assert.equal(f.selected(), f.bundled);
  assert.match(f.notifications.at(-1), /update failed/);
  f.otherHostExited();
  await f.update();
  assert.equal(fs.readFileSync(path.join(f.selected(), 'extensions/demo/index.ts'), 'utf8'), 'new code');
  assert.equal(fs.readFileSync(path.join(f.bundled, 'extensions/demo/index.ts'), 'utf8'), 'original code');
});
