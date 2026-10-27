import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
import { bundleMyPi, materializeMyPi } from '../bundle-my-pi.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pcli-bundle-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function launch(root, agent) {
  let command;
  const terminals = [];
  const errors = [];
  const vscode = {
    commands: { registerCommand(name, callback) { if (name === 'pcli.newTab') command = callback; return {}; } },
    EventEmitter: class {
      listeners = [];
      event = (listener) => { this.listeners.push(listener); };
      fire(data) { for (const listener of this.listeners) listener(data); }
    },
    env: { appRoot: root },
    workspace: { getConfiguration() { return { get() {} }; } },
    ViewColumn: { Active: 1 },
    window: {
      showErrorMessage(message) { errors.push(message); },
      createTerminal(options) {
        const terminal = { output: [], visible: false, input: (data) => options.pty.handleInput(data) };
        options.pty.onDidWrite((data) => terminal.output.push(data));
        terminals.push(terminal);
        return { show() { terminal.visible = true; options.pty.open(); } };
      },
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(new URL('../extension.js', import.meta.url), 'utf8'), {
    module, process: { env: { PI_CODING_AGENT_DIR: agent } },
    require(id) {
      if (id === 'vscode') return vscode;
      if (id === 'fs') return { ...fs, existsSync(p) { return p === 'C:\\Program Files\\Git\\bin\\bash.exe' || fs.existsSync(p); } };
      if (id === 'os') return os;
      if (id === 'path') return path;
      if (id === './update-my-pi') return require('../update-my-pi.js');
      if (id === 'net') return require(id);
      if (id.endsWith('node-pty')) return {
        spawn() {
          let output;
          return {
            onData(listener) { output = listener; output('Pi ready\r\n'); },
            onExit() {},
            write(data) { output(data); },
          };
        },
      };
      throw new Error('unexpected import ' + id);
    },
  });
  module.exports.activate({
    extensionPath: root, subscriptions: [],
    globalStorageUri: { fsPath: path.join(root, 'storage') },
    extension: { packageJSON: { version: '0.0.2' } },
  });
  command();
  return { terminals, errors, again: command };
}

function installed(root) {
  fs.mkdirSync(path.join(root, 'pi'), { recursive: true });
  fs.writeFileSync(path.join(root, 'pi', 'pi.exe'), 'fake Pi');
  fs.mkdirSync(path.join(root, 'my-pi'));
  fs.writeFileSync(path.join(root, 'my-pi', 'package.json'), '{"name":"my-pi"}');
}

test('materialization writes product resources, manifest and exact revision', (t) => {
  const root = fixture(t);
  const sha = 'a'.repeat(40);
  const source = path.join(root, 'source');
  fs.mkdirSync(path.join(source, 'extensions', 'RQW-demo'), { recursive: true });
  fs.writeFileSync(path.join(source, 'extensions', 'RQW-demo', 'index.ts'), 'export default () => {};');
  fs.mkdirSync(path.join(source, 'extensions', 'RQW-theme'));
  fs.writeFileSync(path.join(source, 'extensions', 'RQW-theme', 'theme.json'), '{"name":"demo"}');
  fs.mkdirSync(path.join(source, '.pi', 'agents'), { recursive: true });
  fs.writeFileSync(path.join(source, '.pi', 'agents', 'private.toml'), 'private');
  fs.writeFileSync(path.join(source, 'PROCESS.md'), 'development only');
  fs.writeFileSync(path.join(source, 'package.json'), JSON.stringify({
    name: 'my-pi', type: 'module', scripts: { test: 'development only' },
    pi: { extensions: ['./extensions/RQW-demo/index.ts'], themes: ['./extensions/RQW-theme/theme.json'] },
    dependencies: { ws: '8.22.0' }, devDependencies: { typebox: '1.3.27', typescript: '7.0.2' },
    peerDependencies: { '@earendil-works/pi-coding-agent': '1.4.0', typebox: '*' },
  }));
  const bundle = materializeMyPi(source, path.join(root, 'my-pi'), sha);
  assert.equal(fs.readFileSync(path.join(bundle, '.revision'), 'utf8'), sha + '\n');
  assert.equal(fs.readFileSync(path.join(bundle, 'extensions', 'RQW-demo', 'index.ts'), 'utf8'), 'export default () => {};');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(bundle, 'extensions', 'RQW-theme', 'theme.json'))), { name: 'demo' });
  assert.equal(fs.existsSync(path.join(bundle, '.pi')), false);
  assert.equal(fs.existsSync(path.join(bundle, 'PROCESS.md')), false);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(bundle, 'package.json'))), {
    name: 'my-pi', private: true, type: 'module',
    pi: { extensions: ['./extensions/RQW-demo/index.ts'], themes: ['./extensions/RQW-theme/theme.json'] },
    dependencies: { ws: '8.22.0', typebox: '1.3.27' },
    peerDependencies: { '@earendil-works/pi-coding-agent': '1.4.0', typebox: '*' },
  });
  const manifest = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url)));
  assert.match(manifest.scripts['vscode:prepublish'], /bundle-my-pi\.mjs/);
  const ignore = fs.readFileSync(new URL('../.vscodeignore', import.meta.url), 'utf8').split('\n');
  assert.equal(ignore.includes('my-pi/**'), false);
});

test('failed source lookup preserves the existing bundle', async (t) => {
  const root = fixture(t);
  fs.mkdirSync(path.join(root, 'my-pi'));
  fs.writeFileSync(path.join(root, 'my-pi', '.revision'), 'previous');
  await assert.rejects(bundleMyPi(root, {
    async fetch() { return { ok: false, status: 503 }; },
  }), /main lookup failed: HTTP 503/);
  assert.equal(fs.readFileSync(path.join(root, 'my-pi', '.revision'), 'utf8'), 'previous');
});

test('tab accepts BOM settings and retains filters, auth and unrelated settings', (t) => {
  const base = fixture(t);
  const root = path.join(base, "Путь it's", 'arqawa.pcli-0.0.3-win32-x64');
  installed(root);
  const agent = path.join(base, 'agent');
  fs.mkdirSync(agent);
  const settingsPath = path.join(agent, 'settings.json');
  const filters = { extensions: ['-extensions/RQW-codex/index.ts'], themes: [] };
  fs.writeFileSync(settingsPath, '\uFEFF' + JSON.stringify({ model: 'kept', packages: [
    'npm:other', { source: 'git:github.com/ARQAWA/my-pi@release', ...filters },
    'C:\\Users\\owner\\.vscode\\extensions\\arqawa.pcli-0.0.1-win32-x64\\my-pi',
  ] }));
  fs.writeFileSync(path.join(agent, 'auth.json'), 'auth bytes');
  const result = launch(root, agent);
  assert.deepEqual(result.errors, []);
  const terminal = result.terminals[0];
  assert.equal(terminal.visible, true);
  terminal.input('hello Pi\r');
  assert.deepEqual(terminal.output, ['Pi ready\r\n', 'hello Pi\r']);
  assert.deepEqual(JSON.parse(fs.readFileSync(settingsPath)), {
    model: 'kept', packages: ['npm:other', { source: path.join(root, 'my-pi'), ...filters }],
  });
  assert.equal(fs.readFileSync(path.join(agent, 'auth.json'), 'utf8'), 'auth bytes');
  const bytes = fs.readFileSync(settingsPath, 'utf8');
  result.again();
  assert.equal(fs.readFileSync(settingsPath, 'utf8'), bytes);
});

test('Pi settings lock prevents a tab from overwriting another writer', (t) => {
  const root = fixture(t);
  installed(root);
  const agent = path.join(root, 'agent');
  fs.mkdirSync(agent);
  const settingsPath = path.join(agent, 'settings.json');
  fs.writeFileSync(settingsPath, '{"model":"before"}');
  // Fake Pi holds the proper-lockfile realpath:false lock while changing settings.
  fs.mkdirSync(settingsPath + '.lock');
  const result = launch(root, agent);
  assert.deepEqual(result.terminals, []);
  assert.equal(fs.readFileSync(settingsPath, 'utf8'), '{"model":"before"}');
  fs.writeFileSync(settingsPath, '{"model":"concurrent","packages":["npm:other"]}');
  fs.rmdirSync(settingsPath + '.lock');
  result.again();
  assert.equal(result.terminals[0].visible, true);
  assert.deepEqual(JSON.parse(fs.readFileSync(settingsPath)), {
    model: 'concurrent', packages: ['npm:other', path.join(root, 'my-pi')],
  });
});

test('fresh tab registers bundled package without touching credentials', (t) => {
  const root = fixture(t);
  installed(root);
  const agent = path.join(root, 'agent');
  const result = launch(root, agent);
  assert.deepEqual(result.errors, []);
  assert.equal(result.terminals[0].visible, true);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(agent, 'settings.json'))), { packages: [path.join(root, 'my-pi')] });
  assert.equal(fs.existsSync(path.join(agent, 'auth.json')), false);
});

test('invalid settings stop tab without overwriting user data', (t) => {
  const root = fixture(t);
  installed(root);
  const agent = path.join(root, 'agent');
  fs.mkdirSync(agent);
  const settings = path.join(agent, 'settings.json');
  fs.writeFileSync(settings, '{broken');
  const result = launch(root, agent);
  assert.deepEqual(result.terminals, []);
  assert.equal(result.errors.length, 1);
  assert.equal(fs.readFileSync(settings, 'utf8'), '{broken');
  // Parse failure must release the shared lock for the next writer.
  fs.writeFileSync(settings, '{}');
  result.again();
  assert.equal(result.terminals[0].visible, true);
});
