import './recovery-offline.mjs';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { it } from 'node:test';
import { TOKEN_URL } from '../../../extensions/RQW-anthropic/auth.ts';
import { ACCESS, NEXT, credential, AuthStorage, subscriptionFetch, versionState, url, request } from './recovery-fixtures.ts';

const run = promisify(execFile);
for (const mode of ['refresh', 'login'] as const) {
  it(`401 after independent process ${mode}: ${mode === 'refresh' ? 'replays proven bearer without another refresh' : 'rejects account substitution without replay'}`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'anthropic-cross-process-'));
    const path = join(root, 'auth.json');
    const other = { type: 'api_key', key: 'fake-other' };
    await writeFile(path, JSON.stringify({ anthropic: credential, other }));
    const store = AuthStorage.create(path);
    const sent: string[] = [];
    let refreshes = 0;
    let siblingSaved: unknown;
    try {
      const fetch: typeof globalThis.fetch = async (input, init) => {
        if (String(input) === TOKEN_URL) { refreshes++; throw new Error('parent must not refresh'); }
        sent.push(new Headers(init?.headers).get('authorization')!);
        if (sent.length === 1) {
          assert.deepEqual(sent, [`Bearer ${ACCESS}`]);
          // The old request is already in flight; only release its 401 after the sibling commits.
          const { stdout, stderr } = await run(process.execPath, [fileURLToPath(new URL('./cross-process-refresh-sibling.mjs', import.meta.url)), path, mode], { timeout: 5000 });
          assert.equal(stderr, '');
          const sibling = JSON.parse(stdout);
          assert.notEqual(sibling.pid, process.pid);
          assert.equal(sibling.locked, true);
          assert.equal(sibling.refreshes, mode === 'refresh' ? 1 : 0);
          siblingSaved = JSON.parse(await readFile(path, 'utf8')).anthropic;
          assert.equal((siblingSaved as typeof credential).access, mode === 'refresh' ? NEXT : 'sk-ant-oat01-sibling-login');
          return new Response('expired fixture', { status: 401 });
        }
        assert.equal(mode, 'refresh');
        assert.equal(sent.length, 2);
        assert.equal(sent[1], `Bearer ${NEXT}`);
        return new Response('replayed fixture');
      };
      const operation = subscriptionFetch(fetch, store, versionState(), 'session', 'device')(url, request());
      if (mode === 'refresh') assert.equal(await (await operation).text(), 'replayed fixture');
      else await assert.rejects(operation, /Saved login changed.*Start a new turn/);
      assert.deepEqual(sent, (mode === 'refresh' ? [ACCESS, NEXT] : [ACCESS]).map(value => `Bearer ${value}`));
      assert.equal(refreshes, 0);
      const saved = JSON.parse(await readFile(path, 'utf8'));
      assert.deepEqual(saved.anthropic, siblingSaved);
      assert.deepEqual(saved.other, other);
      if (mode === 'login') assert.deepEqual(saved.anthropic, { type: 'oauth', access: 'sk-ant-oat01-sibling-login', refresh: 'sibling-login-refresh', expires: 4102444800000 });
    } finally { await rm(root, { recursive: true, force: true }); }
  });
}
