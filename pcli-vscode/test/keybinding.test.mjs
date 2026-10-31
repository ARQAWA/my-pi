import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const manifest = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('Ctrl+Enter in a PCLI terminal sends the CSI-u sequence Pi understands', () => {
  const bindings = manifest.contributes.keybindings.filter((item) => item.key === 'ctrl+enter');
  assert.deepEqual(bindings, [
    {
      key: 'ctrl+enter',
      command: 'workbench.action.terminal.sendSequence',
      when: 'terminalFocus && pcli.terminalActive',
      args: { text: '\u001b[13;5u' },
    },
  ]);
});
