'use strict';

const vscode = require('vscode');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Константы и пути

const GIT_BASH = 'C:\\Program Files\\Git\\bin\\bash.exe';
const PROXY_VARS = ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'NODE_USE_ENV_PROXY', 'NODE_TLS_REJECT_UNAUTHORIZED'];

// Состояние модуля

let piExe = '';
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
  context.subscriptions.push(vscode.commands.registerCommand('pcli.newTab', () => openTab('pi ' + ++count)));
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
