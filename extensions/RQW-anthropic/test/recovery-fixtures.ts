import { fileURLToPath } from 'node:url';
import * as pi from '@earendil-works/pi-coding-agent';
import type { CredentialStore } from '@earendil-works/pi-ai';
import { builtinProviders } from '@earendil-works/pi-ai/providers/all';
import { IDENTITY, versionState } from '../wire.ts';
import { subscriptionFetch } from '../transport.ts';
export { versionState, subscriptionFetch };
// Exercise Pi's installed internal storage boundary through its resolved package entrypoint.
export const { AuthStorage } = await import(new URL('./core/auth-storage.js', import.meta.resolve('@earendil-works/pi-coding-agent')).href);
export const ACCESS = 'sk-ant-oat01-audit-old';
export const NEXT = 'sk-ant-oat01-audit-new';
export const credential = { type: 'oauth' as const, access: ACCESS, refresh: 'audit-refresh', expires: Date.now() + 3_600_000 };
export const base = builtinProviders().find(p => p.id === 'anthropic')!;
export const model = base.getModels().find(m => m.id === 'claude-opus-5-5')!;
export const context = { systemPrompt: 'Keep system instructions.', tools: [{ name: 'read', description: 'Read fixture', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } }], messages: [{ role: 'user' as const, content: 'Audit fake prompt only', timestamp: 1 }] };
export const raw = JSON.stringify({ model: model.id, max_tokens: 20, stream: true, system: [{ type: 'text', text: IDENTITY }], messages: [{ role: 'user', content: 'Audit fake prompt only' }] });
export const url = 'https://api.anthropic.com/v1/messages';
export const request = () => ({ method: 'POST', body: raw, headers: { authorization: `Bearer ${ACCESS}` } });
export const refreshed = (access = NEXT, ttl = 3600) => Response.json({ access_token: access, refresh_token: 'audit-rotated', expires_in: ttl });
export async function within<T>(operation: Promise<T>, ms = 1000): Promise<T> {
  // Failure watchdog only: synchronization awaits the operation's own result or explicit gates.
  let timer: NodeJS.Timeout;
  try { return await Promise.race([operation, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('audit deadline')), ms); })]); }
  finally { clearTimeout(timer!); }
}
export interface SseEvent { type: string; [key: string]: unknown }
export function sse(events: SseEvent[]) {
  return events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('');
}
export const start = { type: 'message_start', message: { id: 'audit-msg', model: model.id, usage: { input_tokens: 5, output_tokens: 0 } } };
export const textEvents = [start, { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }, { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'PARTIAL' } }, { type: 'content_block_stop', index: 0 }];
export const finish = [{ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 2 } }, { type: 'message_stop' }];
export const response = (events: SseEvent[]) => new Response(sse(events), { headers: { 'content-type': 'text/event-stream' } });
export interface RecoveryFixture { runtime: pi.ModelRuntime; store: CredentialStore; session: pi.AgentSession }
export async function setup(settings: Parameters<typeof pi.SettingsManager.inMemory>[0] = { retry: { enabled: false } }, entry: typeof pi = pi, previous?: RecoveryFixture): Promise<RecoveryFixture> {
  const store = previous?.store ?? AuthStorage.inMemory({ anthropic: credential });
  const runtime = previous?.runtime ?? await entry.ModelRuntime.create({ credentials: store, modelsPath: null, refreshOnCreate: false });
  await runtime.refresh({ allowNetwork: false });
  const dir = process.env.PI_CODING_AGENT_DIR!;
  const loader = new entry.DefaultResourceLoader({ cwd: dir, agentDir: dir, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
    extensionPathsOverride: [], additionalExtensionPaths: [fileURLToPath(new URL('../index.ts', import.meta.url))] });
  await loader.reload();
  if (loader.getExtensions().errors.length) throw new Error(JSON.stringify(loader.getExtensions().errors));
  const { session } = await entry.createAgentSession({ cwd: dir, agentDir: dir, modelRuntime: runtime, model: runtime.getModels('anthropic').find(m => m.id === model.id),
    resourceLoader: loader, sessionManager: previous?.session.sessionManager ?? entry.SessionManager.inMemory(dir), settingsManager: entry.SettingsManager.inMemory(settings) });
  await session.bindExtensions({});
  return { runtime, store, session };
}
