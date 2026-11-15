import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { startDashboard } from '../src/server/server.ts';
import { createDashboardClient } from '../src/core/client.ts';
import type { AgentPlatformView } from '../src/core/agent-platform.ts';

test('the optional agent endpoint is lazy, same-origin, bounded and accepts only registered actions', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'lens-agent-http-'));
  const web = join(directory, 'web'); await mkdir(web); await writeFile(join(web, 'index.html'), 'Lens');
  let loads = 0, snapshots = 0, checks = 0;
  const view: AgentPlatformView = { version: 1, id: 'agents', label: 'Agents', busy: false, agents: [], limitations: [] };
  const app = await startDashboard({ directory: join(directory, 'state'), staticDirectory: web, agentPlatform: async () => {
    loads++; return { version: 1, id: 'agents', label: 'Agents', async snapshot() { snapshots++; return view; }, async check() { checks++; return view; } };
  } });
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  const client = createDashboardClient({ baseUrl: app.url });
  assert.equal((await client.getState()).agentPlatformAvailable, true); assert.equal(loads, 0);
  const post = (body: unknown, headers: Record<string, string> = {}) => fetch(app.url + '/api/agent-platform', {
    method: 'POST', headers: { origin: app.url, 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
  assert.equal((await post({ action: 'open' }, { origin: 'https://foreign.example' })).status, 403);
  const badHost = await new Promise<number>(resolve => {
    const req = request(app.url + '/api/agent-platform', { method: 'POST', headers: { host: 'foreign.example', 'content-type': 'application/json' } }, response => { response.resume(); resolve(response.statusCode!); });
    req.end('{"action":"open"}');
  });
  assert.equal(badHost, 403);
  assert.equal((await post({ action: 'open' }, { 'content-type': 'text/plain' })).status, 415);
  assert.equal((await post({ action: 'open', padding: 'x'.repeat(1025) })).status, 413);
  for (const body of [{ action: 'open', module: 'private.mjs' }, { action: 'check', agentId: '../other' }, { action: 'check', agentId: 'neo', prompt: 'arbitrary request' }]) {
    assert.equal((await post(body)).status, 400);
  }
  assert.equal(loads, 0); assert.equal(checks, 0);
  await client.agentPlatform({ action: 'open' }); assert.equal(loads, 1); assert.equal(snapshots, 1);
  assert.deepEqual((await client.getState()).agentPlatform, view);
  await client.agentPlatform({ action: 'refresh' }); assert.equal(snapshots, 2);
  assert.equal((await post({ action: 'check', agentId: 'foreign' })).status, 409); assert.equal(checks, 0);
});
