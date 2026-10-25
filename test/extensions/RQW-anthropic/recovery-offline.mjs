import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { syncBuiltinESMExports } from 'node:module';

// Children inherit only the already-sanitized fixture environment. Keep a CLI test's own fake home.
if (process.env.RQW_AUDIT_SANDBOX !== '1') {
  const root = mkdtempSync(join(tmpdir(), 'auth-transport-offline-'));
  for (const key of Object.keys(process.env)) {
    if (/(API_KEY|AUTH_TOKEN|OAUTH_TOKEN)$/.test(key) || /^(ANTHROPIC_|CLAUDE_|RQW_ANTHROPIC_|PI_AI_CLAUDE_CODE_VERSION)/.test(key)) delete process.env[key];
  }
  Object.assign(process.env, { HOME: root, USERPROFILE: root, PI_CODING_AGENT_DIR: root, RQW_AUDIT_SANDBOX: '1' });
  process.on('exit', () => rmSync(root, { recursive: true, force: true }));
}
Object.assign(process.env, { PI_OFFLINE: '1', PI_SKIP_VERSION_CHECK: '1', NO_COLOR: '1' });
const blocked = () => { throw new Error('AUDIT: external network forbidden'); };
globalThis.fetch = async () => blocked();
http.request = http.get = https.request = https.get = blocked;
net.connect = net.createConnection = net.Socket.prototype.connect = blocked;
syncBuiltinESMExports();
