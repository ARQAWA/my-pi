import './recovery-offline.mjs';
import assert from 'node:assert/strict';
import { refreshCredential, TOKEN_URL } from '../../../extensions/RQW-anthropic/auth.ts';

const { AuthStorage } = await import(new URL('./core/auth-storage.js', import.meta.resolve('@earendil-works/pi-coding-agent')).href);
const [path, mode] = process.argv.slice(2);
const store = AuthStorage.create(path);
let refreshes = 0;
let locked = false;
await store.modify('anthropic', async current => {
  locked = true;
  assert.equal(current.access, 'sk-ant-oat01-audit-old');
  assert.equal(current.refresh, 'audit-refresh');
  if (mode === 'login') return { type: 'oauth', access: 'sk-ant-oat01-sibling-login', refresh: 'sibling-login-refresh', expires: 4102444800000 };
  assert.equal(mode, 'refresh');
  return refreshCredential(current, AbortSignal.timeout(5000), async (input, init) => {
    refreshes++;
    assert.equal(String(input), TOKEN_URL);
    assert.equal(JSON.parse(init.body).refresh_token, 'audit-refresh');
    return Response.json({ access_token: 'sk-ant-oat01-audit-new', refresh_token: 'audit-rotated', expires_in: 3600 });
  });
});
process.stdout.write(JSON.stringify({ pid: process.pid, locked, refreshes }));
