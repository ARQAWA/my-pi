'use strict';
// Runs inside the VS Code extension host (extensionTestsPath). Each step prints PASS or throws.
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const S = process.env.PCLI_SCENARIO;
const AGENT = process.env.PI_CODING_AGENT_DIR;
const LOG = process.env.PCLI_PROXY_LOG;
const PROXY = "http://pcli:it's@127.0.0.1:18999";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => String(s || '').replace(/\\/g, '/').toLowerCase();

function pass(msg) {
  console.log(`PASS [${S}] ${msg}`);
}

async function until(what, fn, ms) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timeout ${ms / 1000}s: ${what}`);
    await sleep(2000);
  }
}

function sessions() {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.jsonl')) out.push(fs.readFileSync(p, 'utf8'));
    }
  };
  walk(AGENT);
  return out.join('\n');
}

// Every process whose name is pi.exe or whose command line holds the bundled pi.exe path (powershell, bash, pi)
function ours(piExe) {
  const json = execFileSync('powershell.exe', ['-NoProfile', '-Command',
    'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress'],
  { encoding: 'utf8', maxBuffer: 64 << 20 });
  const key = norm(piExe);
  return JSON.parse(json).filter((p) => norm(p.Name) === 'pi.exe' || norm(p.CommandLine).includes(key));
}
const show = (list) => list.map((p) => `  pid=${p.ProcessId} ppid=${p.ParentProcessId} ${p.Name} ${p.CommandLine}`).join('\n');
const piCount = (piExe) => ours(piExe).filter((p) => norm(p.Name) === 'pi.exe').length;

async function tab(name) {
  await vscode.commands.executeCommand('pcli.newTab');
  const t = await until(`terminal "${name}"`, () => vscode.window.terminals.find((x) => x.name === name), 20000);
  pass(`terminal "${name}" opened`);
  return t;
}

async function type(t, text) {
  t.sendText(text, false);
  await sleep(700);
  t.sendText('\r', false);
}

function grab(text, needle, n = 300) {
  const i = text.indexOf(needle);
  return i < 0 ? '' : text.slice(i, i + n);
}

async function main() {
  console.log(`scenario ${S}: vscode ${vscode.version}, agent ${AGENT}, ws ${vscode.workspace.workspaceFolders?.[0]?.uri.fsPath}`);
  console.log('HTTP_PROXY in extension host =', process.env.HTTP_PROXY, '| http.proxy =', vscode.workspace.getConfiguration('http').get('proxy'),
    '| http.proxyStrictSSL =', vscode.workspace.getConfiguration('http').get('proxyStrictSSL'));
  const logStart = fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8').length : 0;

  const ext = vscode.extensions.getExtension('arqawa.pcli');
  if (!ext) throw new Error('extension arqawa.pcli not installed');
  if (!norm(ext.extensionPath).startsWith(norm(process.env.PCLI_EXT_DIR) + '/')) throw new Error('extensionPath not in spaced dir: ' + ext.extensionPath);
  const piExe = path.join(ext.extensionPath, 'pi', 'pi.exe');
  if (!fs.existsSync(piExe)) throw new Error('missing ' + piExe);
  pass(`arqawa.pcli ${ext.packageJSON.version} installed from VSIX at ${ext.extensionPath}`);
  if (ours(piExe).length) throw new Error('pi processes before start:\n' + show(ours(piExe)));

  const t1 = await tab('pi 1');
  await sleep(20000);
  console.log('processes after pi 1 start:\n' + show(ours(piExe)));
  await type(t1, 'say hi');
  const newLog = () => fs.readFileSync(LOG, 'utf8').slice(logStart).split(/\r?\n/);
  const hasLine = (want) => {
    if (!newLog().includes(want)) throw new Error('proxy log lacks line: ' + want + '\n--- new log ---\n' + newLog().join('\n'));
    pass('proxy log line: ' + want);
  };
  // The fake model is HTTPS with a self-signed cert: only http.proxyStrictSSL=false (scenario B) may reach it
  if (S === 'A') {
    await until('session with the failed model turn', () => sessions().includes('"stopReason":"error"'), 120000);
    if (sessions().includes('PCLI_MODEL_OK')) throw new Error('strict TLS but the model answered');
    pass('strict TLS: no PCLI_MODEL_OK, model turn failed: ' + JSON.stringify(grab(sessions(), '"errorMessage"', 200)));
    hasLine(`CONNECT llm.pcli.test:443 auth=pcli:it's`);
    if (newLog().some((l) => l.startsWith('TLS POST'))) throw new Error('strict TLS but a request went through the fake TLS');
    pass('strict TLS: no TLS POST in proxy log');
  } else {
    await until('session with PCLI_MODEL_OK', () => sessions().includes('PCLI_MODEL_OK'), 180000);
    pass('model answer in session: ' + JSON.stringify(grab(sessions(), 'PCLI_MODEL_OK', 40)));
    hasLine(`CONNECT llm.pcli.test:443 auth=pcli:it's`);
    hasLine('TLS POST /v1/chat/completions');
  }

  // Interactive Pi downloads fd and rg from GitHub through the proxy on first start
  await until('fd.exe and rg.exe in agent bin', () => ['fd.exe', 'rg.exe'].every((f) => fs.existsSync(path.join(AGENT, 'bin', f))), 120000);
  const gh = newLog().find((l) => l.startsWith(`CONNECT github.com:443 auth=pcli:it's`));
  if (!gh) throw new Error('no CONNECT github.com:443 with creds\n--- new log ---\n' + newLog().join('\n'));
  pass(`proxy log line: ${gh}; ${path.join(AGENT, 'bin')} has fd.exe and rg.exe`);

  await type(t1, '!echo PCLI_BASH_$((6*7)) "$HTTPS_PROXY" "[$https_proxy]" "$PCLI_HOSTILE" "$NODE_TLS_REJECT_UNAUTHORIZED" "$PI_SKIP_VERSION_CHECK" "$PWD"');
  await until('session with PCLI_BASH_42', () => sessions().includes('PCLI_BASH_42'), 60000);
  // [] = lowercase https_proxy of the hostile profile is unset; 1 = the profile was sourced
  const line = `PCLI_BASH_42 ${PROXY} [] 1 ${S === 'B' ? '0' : ''} 1 `;
  const got = grab(sessions(), 'PCLI_BASH_42', 200);
  console.log('bash output in session: ' + JSON.stringify(got));
  if (!got.startsWith(line)) throw new Error('bash output does not start with ' + JSON.stringify(line));
  if (!got.slice(line.length).match(/^[^"\\]*ws dir\/it's/)) throw new Error("PWD is not the workspace ws dir/it's");
  pass(`bash env: proxy=${PROXY} https_proxy=(unset) hostile profile sourced, tls=${S === 'B' ? '0' : '(unset)'} PI_SKIP_VERSION_CHECK=1, PWD ends with ws dir/it's`);

  const t2 = await tab('pi 2');
  await until('2 pi.exe alive', () => piCount(piExe) >= 2, 60000);
  const both = ours(piExe);
  console.log('processes with two tabs:\n' + show(both));
  pass(`two tabs, ${both.filter((p) => norm(p.Name) === 'pi.exe').length} pi.exe alive`);

  t1.dispose();
  t2.dispose();
  await sleep(10000);
  const left = ours(piExe);
  if (left.length) throw new Error('ORPHANED after closing tabs:\n' + show(left));
  pass('tabs closed, no pi.exe/bash.exe/powershell.exe of ours left');

  if (S === 'A') {
    const t3 = await tab('pi 3');
    await until('pi.exe alive in pi 3', () => piCount(piExe) === 1, 60000);
    await sleep(10000);
    await type(t3, '/quit');
    try {
      await until('pi.exe exits after /quit', () => piCount(piExe) === 0, 10000);
    } catch {
      console.log('still alive 10s after /quit, pressing Enter once more');
      t3.sendText('\r', false);
      await until('pi.exe exits after /quit', () => piCount(piExe) === 0, 10000);
    }
    const rest = ours(piExe);
    t3.dispose();
    if (rest.length) throw new Error('left after /quit:\n' + show(rest));
    pass('/quit: pi.exe and its shells exited');

    // Left running on purpose: run.mjs checks that no pi.exe survives VS Code exit
    await tab('pi 4');
    await until('pi.exe alive in pi 4', () => piCount(piExe) === 1, 60000);
    await sleep(5000);
    console.log('leaving pi 4 open:\n' + show(ours(piExe)));
  }
}

exports.run = () => main().then(
  () => console.log(`SCENARIO ${S} PASSED`),
  (err) => {
    console.log(`SCENARIO ${S} FAILED: ${err.stack || err}`);
    throw err;
  },
);
