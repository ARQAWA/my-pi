import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const suitePath = fileURLToPath(new URL('suite.cjs', import.meta.url));

test('scenario A rejects a /quit that needs a second Enter', async (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'pcli-quit-test-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const agent = path.join(base, 'agent');
  const extDir = path.join(base, 'ext');
  const extensionPath = path.join(extDir, 'extension');
  const piExe = path.join(extensionPath, 'pi', 'pi.exe');
  const proxyLog = path.join(base, 'proxy.log');
  fs.mkdirSync(path.join(agent, 'bin'), { recursive: true });
  fs.mkdirSync(path.dirname(piExe), { recursive: true });
  fs.writeFileSync(piExe, '');
  for (const name of ['fd.exe', 'rg.exe']) fs.writeFileSync(path.join(agent, 'bin', name), '');
  fs.writeFileSync(proxyLog, '');
  fs.writeFileSync(path.join(agent, 'session.jsonl'),
    '{"stopReason":"error"}\nPCLI_BASH_42 http://pcli:it\'s@127.0.0.1:18999 [] 1  1 C:/PCLI/ws dir/it\'s\n');

  let alive = 0;
  let now = 0;
  const terminals = [];
  const vscode = {
    version: 'test',
    commands: {
      executeCommand(command) {
        assert.equal(command, 'pcli.newTab');
        alive += 1;
        const terminal = {
          name: `pi ${terminals.length + 1}`,
          pending: '',
          quitAttempts: 0,
          sendText(text) {
            if (text === 'say hi') fs.writeFileSync(proxyLog,
              "CONNECT llm.pcli.test:443 auth=pcli:it's\nCONNECT github.com:443 auth=pcli:it's\n");
            if (text !== '\r') this.pending = text;
            if (text === '\r' && this.pending === '!echo PCLI_QUIT_$((6*7))') {
              fs.appendFileSync(path.join(agent, 'session.jsonl'), 'PCLI_QUIT_42\n');
            }
            if (text === '\r' && this.pending === '/quit') {
              this.quitAttempts += 1;
              if (this.quitAttempts > 1) alive = 0;
            }
          },
          dispose() { alive = 0; },
        };
        terminals.push(terminal);
      },
    },
    window: { terminals },
    extensions: {
      getExtension(id) {
        assert.equal(id, 'arqawa.pcli');
        return { extensionPath, packageJSON: { version: 'test' } };
      },
    },
    workspace: {
      workspaceFolders: [{ uri: { fsPath: "C:/PCLI/ws dir/it's" } }],
      getConfiguration() { return { get() { return undefined; } }; },
    },
  };
  const module = { exports: {} };
  class FakeDate extends Date {
    static now() { return now; }
  }
  const context = {
    module,
    exports: module.exports,
    console,
    process: { env: {
      PCLI_SCENARIO: 'A',
      PI_CODING_AGENT_DIR: agent,
      PCLI_PROXY_LOG: proxyLog,
      PCLI_EXT_DIR: extDir,
    } },
    require(id) {
      if (id === 'vscode') return vscode;
      if (id === 'fs') return fs;
      if (id === 'path') return path;
      if (id === 'child_process') return {
        execFileSync(command, args, options) {
          assert.equal(command, 'powershell.exe');
          return JSON.stringify(Array.from({ length: alive }, (_, index) => ({
            ProcessId: index + 1,
            ParentProcessId: 0,
            Name: 'pi.exe',
            CommandLine: piExe,
          })));
        },
      };
      throw new Error(`unexpected require: ${id}`);
    },
    Date: FakeDate,
    setTimeout(callback, ms) {
      now += ms;
      callback();
    },
  };
  vm.runInNewContext(fs.readFileSync(suitePath, 'utf8'), context, { filename: suitePath });

  await assert.rejects(module.exports.run(), /timeout 10s: pi\.exe exits after \/quit/);
  assert.equal(terminals.length, 3, 'the failed /quit must stop the scenario before pi 4');
  assert.equal(terminals[2].quitAttempts, 1, 'the first /quit outcome must not be retried');
});
