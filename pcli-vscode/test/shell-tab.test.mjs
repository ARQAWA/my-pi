import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const GIT_BASH = 'C:\\Program Files\\Git\\bin\\bash.exe';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pcli-shell-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function installed(root) {
  fs.mkdirSync(path.join(root, 'pi'), { recursive: true });
  fs.writeFileSync(path.join(root, 'pi', 'pi.exe'), 'fake Pi');
  fs.mkdirSync(path.join(root, 'my-pi'));
  fs.writeFileSync(path.join(root, 'my-pi', 'package.json'), '{"name":"my-pi"}');
}

function launch(root, agent, httpSettings = {}, inheritedEnv = {}) {
  const commands = new Map();
  const terminals = [];
  const errors = [];
  const contexts = [];
  let changeActive;
  const vscode = {
    commands: {
      registerCommand(name, callback) { commands.set(name, callback); return {}; },
      executeCommand(...args) { contexts.push(args); },
    },
    EventEmitter: class { event() {} },
    env: { appRoot: root },
    workspace: { getConfiguration() { return { get: (key) => httpSettings[key] }; } },
    ViewColumn: { Active: 1 },
    window: {
      showErrorMessage(message) { errors.push(message); },
      onDidChangeActiveTerminal(listener) { changeActive = listener; return {}; },
      createTerminal(options) {
        const handle = { options, shown: false, show() { handle.shown = true; changeActive(handle); } };
        terminals.push(handle);
        return handle;
      },
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(new URL('../extension.js', import.meta.url), 'utf8'), {
    module, process: { env: { ...inheritedEnv, PI_CODING_AGENT_DIR: agent } },
    require(id) {
      if (id === 'vscode') return vscode;
      if (id === 'fs') return { ...fs, existsSync(p) { return p === GIT_BASH || fs.existsSync(p); } };
      if (id === 'os') return os;
      if (id === 'path') return path;
      if (id === './update-my-pi') return require('../update-my-pi.js');
      if (id === 'net') return require(id);
      throw new Error('unexpected import ' + id);
    },
  });
  module.exports.activate({
    extensionPath: root, subscriptions: [],
    globalStorageUri: { fsPath: path.join(root, 'storage') },
    extension: { packageJSON: { version: '0.0.9' } },
  });
  return { open: commands.get('pcli.shellTab'), terminals, errors, contexts };
}

test('the palette offers New Shell Tab in the Pi CLI category', () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.ok(manifest.contributes.commands.some((entry) => entry.command === 'pcli.shellTab'
    && entry.title === 'New Shell Tab' && entry.category === 'Pi CLI'));
});

test('shell tab is a login Git Bash with the bundled Pi on PATH and the New Tab environment', (t) => {
  const base = fixture(t);
  const root = path.join(base, "Путь it's");
  installed(root);
  const agent = path.join(base, 'agent');
  // Settings override the inherited HTTP(S) proxy; the rest of the inherited proxy environment is kept, as in New Tab.
  const result = launch(root, agent, { proxy: ' http://user:secret@proxy:8080 ', proxyStrictSSL: false },
    { HTTPS_PROXY: 'http://inherited:1', NO_PROXY: 'localhost' });
  assert.equal(typeof result.open, 'function');
  result.open();
  assert.deepEqual([...result.errors], []);
  assert.equal(result.terminals.length, 1);
  const terminal = result.terminals[0];
  assert.equal(terminal.shown, true);
  const { options } = terminal;
  assert.equal(options.name, 'pi shell 1');
  assert.equal(options.shellPath, GIT_BASH);
  assert.equal(options.cwd, os.homedir());
  assert.equal(options.pty, undefined);
  // Proxy values stay out of the file: they reach the shell through the terminal environment.
  // The agent dir is pinned to the one the bundled my-pi was registered in, even if the terminal profile sets another.
  assert.deepEqual({ ...options.env }, {
    PI_CODING_AGENT_DIR: agent,
    PCLI_HTTP_PROXY: 'http://user:secret@proxy:8080', PCLI_HTTPS_PROXY: 'http://user:secret@proxy:8080',
    PCLI_NO_PROXY: 'localhost', PCLI_NODE_TLS_REJECT_UNAUTHORIZED: '0',
  });
  assert.deepEqual([...options.shellArgs.slice(0, 3)], ['--login', '-i', '-c']);
  // Handover to the final interactive shell, which reads the rcfile after ~/.bashrc
  const rcFile = path.join(root, 'storage', 'shell-rc.sh');
  assert.equal(options.shellArgs[3], `exec bash --rcfile '${rcFile.replace(/\\/g, '/').replace(/'/g, "'\\''")}' -i`);
  const piDir = path.join(root, 'pi').replace(/'/g, "'\\''");
  // The environment is applied after ~/.bashrc, so a startup script cannot undo it.
  const rc = fs.readFileSync(rcFile, 'utf8');
  assert.equal(rc.includes('secret'), false);
  const steps = ['. ~/.bashrc', 'unset http_proxy https_proxy all_proxy no_proxy', ...['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'NODE_USE_ENV_PROXY', 'NODE_TLS_REJECT_UNAUTHORIZED'].map((name) => `export ${name}="$PCLI_${name}"`),
    'export PI_SKIP_VERSION_CHECK=1', `export PATH="$(cygpath -u '${piDir}'):$PATH"`].map((step) => rc.indexOf(step));
  assert.ok(steps.every((position) => position >= 0), rc);
  assert.deepEqual(steps, [...steps].sort((a, b) => a - b));
  // The same settings New Tab writes: the bundled my-pi, nothing else.
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(agent, 'settings.json'))), { packages: [path.join(root, 'my-pi')] });
  // Ctrl+Enter keybinding applies in this tab too.
  assert.deepEqual(JSON.parse(JSON.stringify(result.contexts)), [['setContext', 'pcli.terminalActive', true]]);
  result.open();
  assert.equal(result.terminals[1].options.name, 'pi shell 2');
});

test('shell tab without the bundled Pi opens nothing and reports it', (t) => {
  const root = fixture(t);
  installed(root);
  fs.rmSync(path.join(root, 'pi'), { recursive: true });
  const agent = path.join(root, 'agent');
  const result = launch(root, agent);
  result.open();
  assert.deepEqual([...result.terminals], []);
  assert.deepEqual([...result.errors], ['Not found: ' + path.join(root, 'pi', 'pi.exe')]);
  assert.equal(fs.existsSync(path.join(agent, 'settings.json')), false);
});

test('invalid Pi settings stop the shell tab without overwriting them', (t) => {
  const root = fixture(t);
  installed(root);
  const agent = path.join(root, 'agent');
  fs.mkdirSync(agent);
  fs.writeFileSync(path.join(agent, 'settings.json'), '{broken');
  const result = launch(root, agent);
  result.open();
  assert.deepEqual([...result.terminals], []);
  assert.equal(result.errors.length, 1);
  assert.equal(fs.readFileSync(path.join(agent, 'settings.json'), 'utf8'), '{broken');
});
