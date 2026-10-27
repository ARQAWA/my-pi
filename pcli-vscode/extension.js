'use strict';

const vscode = require('vscode');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createUpdater } = require('./update-my-pi');

// Константы и пути

const GIT_BASH = 'C:\\Program Files\\Git\\bin\\bash.exe';
const PROXY_VARS = ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'NODE_USE_ENV_PROXY', 'NODE_TLS_REJECT_UNAUTHORIZED'];

// Состояние модуля

let piExe = '';
let bundledPackage = '';
let updater;
let count = 0;
const ptys = new Set();

// Кавычки: сначала для bash (одинарные кавычки с '\''), затем для PowerShell (удвоенные ')

function bashQuote(s) {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

function psQuote(s) {
  return "'" + s.replace(/'/g, "''") + "'";
}

// Окружение дочерних процессов

function envGet(env, name) {
  return Object.keys(env)
    .filter((k) => k.toUpperCase() === name.toUpperCase())
    .map((k) => env[k])
    .find((v) => v);
}

function envSet(env, name, value) {
  for (const k of Object.keys(env)) {
    if (k.toUpperCase() === name.toUpperCase()) delete env[k];
  }
  env[name] = value;
}

function childEnv() {
  const env = { ...process.env };
  const http = vscode.workspace.getConfiguration('http');
  const proxy = http.get('proxy');
  if (typeof proxy === 'string' && proxy.trim()) {
    const value = proxy.trim();
    envSet(env, 'HTTP_PROXY', value);
    envSet(env, 'HTTPS_PROXY', value);
  }
  if (http.get('proxyStrictSSL') === false) envSet(env, 'NODE_TLS_REJECT_UNAUTHORIZED', '0');
  // Pi не должен спрашивать pi.dev о новой версии: версия закреплена
  envSet(env, 'PI_SKIP_VERSION_CHECK', '1');
  return env;
}

// Прокси и TLS-настройки из VS Code дополнительно экспортируются прямо в строке bash,
// чтобы login-оболочка Git Bash получила их после своих профильных скриптов.
function proxyExports(env) {
  return PROXY_VARS.filter((name) => envGet(env, name))
    .map((name) => 'export ' + name + '=' + bashQuote(envGet(env, name)) + '; ')
    .join('');
}

// Команды

function activate(context) {
  piExe = path.join(context.extensionPath, 'pi', 'pi.exe');
  bundledPackage = path.join(context.extensionPath, 'my-pi');
  updater = createUpdater(context, globalThis.fetch, require('net'));
  context.subscriptions.push(
    vscode.commands.registerCommand('pcli.newTab', () => openTab('pi ' + ++count)),
    vscode.commands.registerCommand('pcli.update', async () => {
      try {
        await vscode.window.withProgress({
          location: vscode.ProgressLocation.Notification, title: 'Updating my-pi...',
        }, () => updater.run());
        vscode.window.showInformationMessage('my-pi updated. Open a new Pi tab to use it.');
      } catch (err) {
        vscode.window.showErrorMessage('my-pi update failed: ' + err.message);
      }
    }),
  );
}

// Вкладки терминала

function makePty(nodePty) {
  const writeEmitter = new vscode.EventEmitter();
  let proc = null;

  function start(dims) {
    const env = childEnv();
    // Pi предпочитает строчные http_proxy/https_proxy: убрать те, что мог задать профиль Git Bash
    const inner = 'unset http_proxy https_proxy all_proxy no_proxy; ' + proxyExports(env) + bashQuote(piExe.replace(/\\/g, '/'));
    const command = "& '" + GIT_BASH + "' --login -i -c " + psQuote(inner);
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? os.homedir();
    let p;
    try {
      p = nodePty.spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-Command', command], {
        name: 'xterm-256color',
        cols: dims?.columns ?? 120,
        rows: dims?.rows ?? 30,
        cwd,
        env,
      });
    } catch (err) {
      writeEmitter.fire(err.message + '\r\n');
      return;
    }
    proc = p;
    ptys.add(p);
    p.onData((data) => writeEmitter.fire(data));
    p.onExit(({ exitCode }) => {
      ptys.delete(p);
      if (proc === p) proc = null;
      writeEmitter.fire('\r\n[pi exited, code ' + exitCode + ']\r\n');
    });
  }

  return {
    onDidWrite: writeEmitter.event,
    open(dims) {
      start(dims);
    },
    handleInput(data) {
      if (proc) proc.write(data);
    },
    setDimensions(d) {
      if (proc) proc.resize(d.columns, d.rows);
    },
    close() {
      if (proc) {
        try {
          proc.kill();
        } catch {}
        ptys.delete(proc);
        proc = null;
      }
    },
  };
}

// node-pty лежит в приложении VS Code: в архиве, а в новых сборках может лежать распакованным
function loadNodePty() {
  try {
    return require(path.join(vscode.env.appRoot, 'node_modules.asar', 'node-pty'));
  } catch (err) {
    try {
      return require(path.join(vscode.env.appRoot, 'node_modules', 'node-pty'));
    } catch {
      throw new Error('node-pty not found in VS Code: ' + err.message);
    }
  }
}

// Replace only our package source. Object-form resource filters remain untouched.
function configurePackage() {
  if (!fs.existsSync(path.join(bundledPackage, 'package.json'))) {
    throw new Error('Not found: ' + bundledPackage);
  }
  const agentDir = process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), '.pi', 'agent');
  const settingsPath = path.join(agentDir, 'settings.json');
  fs.mkdirSync(agentDir, { recursive: true });
  // Pi uses proper-lockfile with realpath:false: the same atomic .lock directory.
  // A busy or stale lock stops this tab; never steal another settings writer's lock.
  const lockPath = settingsPath + '.lock';
  fs.mkdirSync(lockPath);
  try {
    const original = fs.existsSync(settingsPath) ? fs.readFileSync(settingsPath, 'utf8') : null;
    const settings = original === null ? {} : JSON.parse(original.replace(/^\uFEFF/, ''));
    if (settings.packages !== undefined && !Array.isArray(settings.packages)) throw new Error('Invalid Pi packages setting');
    const packages = settings.packages ?? [];
    const isOurs = (entry) => {
      const source = typeof entry === 'string' ? entry : entry?.source;
      if (typeof source !== 'string') return false;
      return /^git:(?:https:\/\/)?github\.com\/ARQAWA\/my-pi(?:\.git)?(?:@.*)?$/i.test(source)
        || source === bundledPackage || source === updater.bundled
        || source.startsWith(updater.managedRoot + path.sep)
        || /[\\/]arqawa\.pcli-[^\\/]+[\\/]my-pi$/i.test(source);
    };
    const owned = packages.filter(isOurs);
    const filtered = owned.find((entry) => typeof entry === 'object');
    const replacement = filtered ? { ...filtered, source: bundledPackage } : bundledPackage;
    let replaced = false;
    settings.packages = packages.flatMap((entry) => {
      if (!isOurs(entry)) return [entry];
      if (replaced) return [];
      replaced = true;
      return [replacement];
    });
    if (!replaced) settings.packages.push(replacement);
    if (JSON.stringify(settings.packages) === JSON.stringify(packages)) return;
    const temp = settingsPath + '.pcli.tmp';
    fs.writeFileSync(temp, JSON.stringify(settings, null, 2) + '\n');
    fs.renameSync(temp, settingsPath);
  } finally {
    fs.rmdirSync(lockPath);
  }
}

function openTab(name) {
  if (!fs.existsSync(GIT_BASH)) {
    vscode.window.showErrorMessage('Not found: ' + GIT_BASH + '. Install Git for Windows.');
    return;
  }
  let nodePty;
  try {
    nodePty = loadNodePty();
  } catch (err) {
    vscode.window.showErrorMessage(err.message);
    return;
  }
  if (!fs.existsSync(piExe)) {
    vscode.window.showErrorMessage('Not found: ' + piExe);
    return;
  }
  try {
    bundledPackage = updater.current();
    configurePackage();
  } catch (err) {
    vscode.window.showErrorMessage(err.message);
    return;
  }
  const terminal = vscode.window.createTerminal({
    name,
    pty: makePty(nodePty),
    location: { viewColumn: vscode.ViewColumn.Active },
  });
  terminal.show();
}

function deactivate() {
  for (const p of [...ptys]) {
    try {
      p.kill();
    } catch {}
  }
}

module.exports = { activate, deactivate };
