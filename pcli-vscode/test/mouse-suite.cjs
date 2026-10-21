'use strict';
// Runs inside the VS Code extension host (extensionTestsPath of mouse.mjs). ConPTY capture of the bundled pi.exe
// (Bun build of Pi 1.3.0): how often the mouse-enable command ?1000h comes out of the pseudo terminal at startup,
// stock and with my-pi's RQW-mouse loaded. Expected: 0 and 1 (DECISIONS.md, section PCLI).
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

const PI_EXE = process.env.PCLI_PI_EXE;
const MOUSE_EXT = process.env.PCLI_MOUSE_EXT;
const AGENT_TEMPLATE = process.env.PCLI_AGENT_TEMPLATE;
const TMP = process.env.PCLI_MOUSE_TMP;
const GIT_BASH = 'C:\\Program Files\\Git\\bin\\bash.exe';
const ALT_SCREEN_ON = '\x1b[?1049h';
const MOUSE_ON = '\x1b[?1000h';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Same quoting and launch chain as extension.js (makePty): PowerShell -> Git Bash -> pi.exe in a node-pty ConPTY
function bashQuote(s) {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

function psQuote(s) {
  return "'" + s.replace(/'/g, "''") + "'";
}

// node-pty of the running VS Code, the one PCLI itself uses
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

async function until(what, fn, ms) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timeout ${ms / 1000}s: ${what}`);
    await sleep(500);
  }
}

const count = (text, needle) => text.split(needle).length - 1;
const modes = (text) => [...text.matchAll(/\x1b\[\?(\d+)([hl])/g)].map((m) => `${m[1]}${m[2]}@${m.index}`).join(' ');

// Everything pi.exe's terminal emits until Pi has entered the alternate screen and drawn
async function capture(label, piArgs) {
  const nodePty = loadNodePty();
  const agent = path.join(TMP, 'agent-' + label);
  fs.cpSync(AGENT_TEMPLATE, agent, { recursive: true });
  const env = { ...process.env, PI_CODING_AGENT_DIR: agent, PI_SKIP_VERSION_CHECK: '1' };
  const args = [PI_EXE, ...piArgs].map((a) => bashQuote(a.replace(/\\/g, '/'))).join(' ');
  const command = "& '" + GIT_BASH + "' --login -i -c " + psQuote('unset http_proxy https_proxy all_proxy no_proxy; ' + args);
  const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? TMP;
  const p = nodePty.spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-Command', command], {
    name: 'xterm-256color', cols: 120, rows: 30, cwd, env,
  });
  let out = '';
  let exit = null;
  p.onData((data) => { out += data; });
  p.onExit((e) => { exit = e; });
  try {
    await until(`[${label}] pi.exe enters the alternate screen`, () => out.includes(ALT_SCREEN_ON) || exit, 90000);
    if (exit && !out.includes(ALT_SCREEN_ON)) throw new Error(`[${label}] pi exited ${exit.exitCode} before the alternate screen:\n${JSON.stringify(out.slice(0, 2000))}`);
    await sleep(8000);
  } finally {
    try { p.kill(); } catch {}
  }
  console.log(`[${label}] ${out.length} bytes, private modes in order: ${modes(out)}`);
  console.log(`[${label}] first 700 bytes: ${JSON.stringify(out.slice(0, 700))}`);
  return out;
}

async function main() {
  for (const [k, v] of Object.entries({ PCLI_PI_EXE: PI_EXE, PCLI_MOUSE_EXT: MOUSE_EXT, PCLI_AGENT_TEMPLATE: AGENT_TEMPLATE, PCLI_MOUSE_TMP: TMP })) {
    if (!v) throw new Error(k + ' not set');
  }
  if (!fs.existsSync(PI_EXE)) throw new Error('missing ' + PI_EXE);
  if (!fs.existsSync(MOUSE_EXT)) throw new Error('missing ' + MOUSE_EXT);
  console.log('vscode', vscode.version, '| pi', PI_EXE, '| extension', MOUSE_EXT);

  const before = await capture('stock', []);
  const after = await capture('rqw-mouse', ['-e', MOUSE_EXT]);
  const result = { stock: count(before, MOUSE_ON), withExtension: count(after, MOUSE_ON) };
  console.log('?1000h count: ' + JSON.stringify(result) + ' (alternate screen ?1049h: stock ' + count(before, ALT_SCREEN_ON) + ', with ' + count(after, ALT_SCREEN_ON) + ')');
  if (result.stock !== 0) throw new Error('stock pi.exe: expected ?1000h 0 times at the host, got ' + result.stock);
  if (result.withExtension !== 1) throw new Error('pi.exe with RQW-mouse: expected ?1000h 1 time at the host, got ' + result.withExtension);
  if (count(before, ALT_SCREEN_ON) !== count(after, ALT_SCREEN_ON)) throw new Error('?1049h count differs: the extension must not move the alternate screen');
  console.log('PASS ?1000h 0 times stock, 1 time with RQW-mouse; ?1049h unchanged');
}

exports.run = () => main().then(
  () => console.log('MOUSE CAPTURE PASSED'),
  (err) => {
    console.log(`MOUSE CAPTURE FAILED: ${err.stack || err}`);
    throw err;
  },
);
