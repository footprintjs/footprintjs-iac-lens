import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { FileResourceFlowStore, ResourceFlowWorkflow } from 'footprintjs-iac/resource-flow/workflow';
import { startDashboard } from '../src/server/index.ts';
import { createDashboardClient } from '../src/core/client.ts';

test('host action HTTP boundary admits only configured IDs after completion and preserves fixed action receipts', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'lens-host-action-http-')), staticDirectory = join(directory, 'static');
  await mkdir(staticDirectory); await writeFile(join(staticDirectory, 'index.html'), '<!doctype html>Configured host actions');
  let release!: () => void, actionCalls = 0;
  const held = new Promise<void>(accept => { release = accept; });
  const privateValue = 'private-provider-message-never-echo';
  const resource = { id: 'existing-service', kind: 'service', physicalId: 'owned-existing-service', scope: 'owned-existing-scope' };
  const workflow = new ResourceFlowWorkflow({
    definition: { id: 'configured-actions', resourceId: resource.id, label: 'Connect existing service', mode: 'existing',
      target: { id: 'owned-test-target', scope: resource.scope }, configurationDigest: 'a'.repeat(64) },
    store: new FileResourceFlowStore(join(directory, 'workflow')), profiles: [{ id: 'existing-profile', label: 'Existing connection' }],
    adapters: {
      async find() { return resource; }, async validate() {},
      async resolveDetails(_resource, profileId) { return profileId ? { profileId, resourceId: resource.id, endpoint: 'https://existing.example', protocol: 'https' } : undefined; },
      async connect() { return { id: 'configured-consumer' }; },
      async verify() { return { ok: true, checks: [{ id: 'consumer-access', passed: true }] }; },
    },
  });
  const app = await startDashboard({ directory: join(directory, 'viewer'), staticDirectory, port: 0, resourceFlow: { workflow,
    controls: [
      { id: 'owned-action', label: 'Configured owned action', async execute() {
        actionCalls++; await held;
        await writeFile(join(directory, 'owned-action.json'), JSON.stringify({ completed: true }));
        return { ok: true, runId: 'owned-test-operation', resourceId: resource.id };
      } },
      { id: 'failed-action', label: 'Configured failed action', async execute() { throw Error(privateValue); } },
    ],
  } });
  t.after(async () => { release(); await app.close(); await rm(directory, { recursive: true, force: true }); });
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) => fetch(app.url + path, {
    method: 'POST', headers: { 'content-type': 'application/json', origin: app.url, ...headers }, body: JSON.stringify(body),
  });
  assert.equal((await post('/api/host-action', { actionId: 'owned-action' })).status, 409);
  assert.equal((await post('/api/host-action', { actionId: 'owned-action' }, { origin: 'https://unrelated.example' })).status, 403);
  assert.equal((await post('/api/host-action', { actionId: 'owned-action' }, { 'content-type': 'text/plain' })).status, 415);
  const extra = await post('/api/host-action', { actionId: 'owned-action', password: privateValue });
  assert.equal(extra.status, 400); assert.equal((await extra.text()).includes(privateValue), false);
  assert.equal((await post('/api/host-action', { actionId: '../arbitrary-command' })).status, 400);
  assert.equal((await post('/api/host-action', { actionId: 'owned-action', padding: 'x'.repeat(2048) })).status, 413);
  assert.equal(actionCalls, 0);

  assert.equal((await post('/api/resource-flow', { action: 'start' })).status, 202); await app.controller.whenIdle();
  const paused = app.controller.getSnapshot().resourceFlow!;
  assert.equal(paused.status, 'paused');
  assert.equal((await post('/api/host-action', { actionId: 'owned-action' })).status, 409);
  assert.equal((await post('/api/resource-flow', { action: 'resume', pauseToken: paused.pause!.token, profileId: 'existing-profile' })).status, 202);
  await app.controller.whenIdle(); assert.equal(app.controller.getSnapshot().resourceFlow?.status, 'passed');
  assert.equal((await post('/api/host-action', { actionId: 'unconfigured-action' })).status, 400);
  assert.equal((await post('/api/host-action', { actionId: 'owned-action' })).status, 202);
  assert.equal((await post('/api/host-action', { actionId: 'failed-action' })).status, 409);
  assert.equal(actionCalls, 1); release(); await app.controller.whenIdle();
  const client = createDashboardClient({ baseUrl: app.url }), state = await client.getState();
  assert.equal(state.hostActions?.busy, false); assert.equal(state.hostActions?.history.length, 1);
  assert.equal(state.hostActions?.history[0]?.status, 'passed');
  assert.deepEqual(state.hostActions?.history[0]?.receipt, { ok: true, runId: 'owned-test-operation', resourceId: resource.id });
  assert.equal(state.resourceFlow?.status, 'passed');
  assert.equal((await post('/api/host-action', { actionId: 'failed-action' })).status, 202); await app.controller.whenIdle();
  const failed = await client.getState();
  assert.equal(failed.hostActions?.history[1]?.status, 'failed'); assert.equal(JSON.stringify(failed).includes(privateValue), false);
});
