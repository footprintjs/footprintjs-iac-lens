import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { request } from 'node:http';
import { ConnectionProfileRegistry, MemoryConnectionProfileStore, MemorySecretStore } from 'footprintjs-iac/connection-profiles';
import { createDashboardClient } from '../src/core/client.ts';
import { startDashboard } from '../src/server/server.ts';
import type { ApplicationHost, ApplicationHostSnapshot } from '../src/server/application-host.ts';

const privateValue = 'private-test-connection-secret-must-not-leak';
async function fixture(t: { after(fn: () => Promise<void>): void }, options: { held?: Promise<void>; malformedPublication?: boolean } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'lens-application-http-'));
  const staticDirectory = join(directory, 'web'); await mkdir(staticDirectory); await writeFile(join(staticDirectory, 'index.html'), 'Application Lens');
  const counts = { inspect: 0, plan: 0, apply: 0, test: 0, snapshot: 0 };
  const catalog = new ConnectionProfileRegistry({ profiles: new MemoryConnectionProfileStore(), secrets: new MemorySecretStore(), adapters: [{
    schema: { id: 'owned-server', label: 'Registered server connection', fields: [
      { name: 'endpoint', label: 'Address', kind: 'url', required: true },
      { name: 'token', label: 'Credential', kind: 'password', secret: true, required: true },
    ] },
    async validate({ config, secrets }) { counts.test++; if (config.endpoint !== 'http://127.0.0.1:55330' || secrets.token !== privateValue) throw Error('Private provider detail ' + privateValue); },
  }] });
  let nativeState: ApplicationHostSnapshot = { incomplete: false };
  const host: ApplicationHost = { version: 1, id: 'fixture-app', label: 'Fixture application', connectionProfiles: catalog,
    strategies: [{ id: 'server', label: 'Existing server', targets: [{ id: 'owned', label: 'Registered target', requiresProfile: true,
      profileAdapterIds: ['owned-server'], requiredInspectionCheckIds: ['target'], requiredVerificationCheckIds: ['health', 'login', 'allowed', 'denied'] }] }],
    async inspect(selection) {
      counts.inspect++; if (options.held) await options.held;
      const resolved = await catalog.resolve(selection.profileId!); assert.equal(resolved.secrets.token, privateValue);
      const result = { ok: true, checks: [{ id: 'target', label: 'Registered target', status: 'passed' as const }] };
      nativeState = { selection, inspection: result, incomplete: false }; return { ...result,
        ...(options.malformedPublication ? { publication: { artifacts: 'bad' as never, design: {} as never } } : {}) };
    },
    async plan(selection) {
      counts.plan++; const result = { ok: true, reviewId: 'native-review-' + counts.plan, changes: [{ resourceId: 'app-service', label: 'Application service', action: 'update' as const }] };
      nativeState = { ...nativeState, selection, review: result }; return result;
    },
    async apply(selection, publish) {
      counts.apply++; assert.equal(selection.reviewId, nativeState.review?.reviewId);
      publish({ phase: 'verify', recording: { snapshot: { runId: 'fixture-native-run', commitLog: [] }, structure: { stages: [] } } });
      const result = { ok: true, promoted: true, status: 'promoted' as const, appUrl: 'http://127.0.0.1:55330',
        checks: ['health', 'login', 'allowed', 'denied'].map(id => ({ id, label: id, status: 'passed' as const })) };
      nativeState = { selection: { strategyId: selection.strategyId, targetId: selection.targetId, profileId: selection.profileId }, deployment: result, incomplete: false };
      return result;
    },
    async snapshot(selection) { counts.snapshot++; if (selection && nativeState.selection) assert.deepEqual(selection, nativeState.selection); return nativeState; },
  };
  const app = await startDashboard({ directory: join(directory, 'state'), staticDirectory, applicationHost: host });
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  const client = createDashboardClient({ baseUrl: app.url });
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) => fetch(app.url + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: app.url, ...headers }, body: JSON.stringify(body),
  });
  const register = () => client.connectionProfile({ action: 'register', registration: { label: 'My registered server', adapterId: 'owned-server',
    config: { endpoint: 'http://127.0.0.1:55330' }, secrets: { token: privateValue } } });
  return { app, client, post, counts, register };
}

test('application HTTP setup reuses private profiles, admits registered selection and requires explicit native review before apply', async t => {
  const f = await fixture(t);
  const initial = await f.client.getState();
  assert.equal(initial.mode, 'managed'); assert.equal(initial.graph, null); assert.equal(initial.run, undefined); assert.deepEqual(initial.artifacts, []);
  assert.equal(initial.application?.phase, 'choose'); assert.deepEqual(f.counts, { inspect: 0, plan: 0, apply: 0, test: 0, snapshot: 1 });
  assert.equal((await f.post('/api/run', { scenario: 'demo' })).status, 409);
  await f.client.application({ action: 'select', strategyId: 'server', targetId: 'owned' });
  assert.equal((await f.client.getState()).application?.canInspect, false);
  await assert.rejects(f.client.application({ action: 'inspect' }), /connection/i);
  const saved = await f.register(); assert.equal(saved.action, 'register'); if (saved.action !== 'register') throw Error('Missing saved profile');
  const profileId = saved.profile.id;
  await f.client.application({ action: 'select', strategyId: 'server', targetId: 'owned', profileId });
  await f.client.application({ action: 'inspect' }); await f.app.controller.whenIdle();
  await f.client.application({ action: 'review' }); await f.app.controller.whenIdle();
  const reviewed = await f.client.getState(); assert.equal(reviewed.application?.canDeploy, true);
  await assert.rejects(f.client.application({ action: 'deploy', reviewId: 'different-review' }), /review/i); assert.equal(f.counts.apply, 0);
  await f.client.application({ action: 'deploy', reviewId: reviewed.application!.review!.reviewId! }); await f.app.controller.whenIdle();
  const final = await f.client.getState(); assert.equal(final.application?.phase, 'ready'); assert.equal(final.application.deployment?.appUrl, 'http://127.0.0.1:55330');
  assert.equal((final.recording?.snapshot as { runId: string })?.runId, 'fixture-native-run');
  assert.equal(final.application.canDeploy, false); assert.equal(f.counts.apply, 1); assert.equal(JSON.stringify(final).includes(privateValue), false);
  await f.client.application({ action: 'refresh' }); await f.app.controller.whenIdle();
  assert.equal((await f.client.getState()).application?.phase, 'ready'); assert.equal(f.counts.apply, 1);
});
test('application boundary refuses foreign origins, oversized bodies and browser executable/provider parameters before host calls', async t => {
  const f = await fixture(t);
  const select = { action: 'select', strategyId: 'server', targetId: 'owned' };
  assert.equal((await f.post('/api/application', select, { Origin: 'https://elsewhere.example' })).status, 403);
  const foreignHost = await new Promise<number>(resolve => {
    const req = request(f.app.url + '/api/application', { method: 'POST', headers: { host: 'elsewhere.example', 'content-type': 'application/json' } }, response => { response.resume(); resolve(response.statusCode!); });
    req.end(JSON.stringify(select));
  });
  assert.equal(foreignHost, 403);
  assert.equal((await f.post('/api/application', select, { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await f.post('/api/application', { ...select, padding: 'x'.repeat(2050) })).status, 413);
  for (const body of [{ ...select, module: '/private/anything.mjs' }, { action: 'inspect', endpoint: 'https://other.example' }, { action: 'deploy', reviewId: 'one', command: 'delete' },
    { ...select, strategyId: 'foreign' }, { ...select, profileId: 'unknown' }]) {
    const response = await f.post('/api/application', body); assert.equal(response.status, 400); assert.equal((await response.text()).includes(privateValue), false);
  }
  assert.deepEqual(f.counts, { inspect: 0, plan: 0, apply: 0, test: 0, snapshot: 1 });
});
test('application inspection serializes connection changes and strategy actions while a host callback is running', async t => {
  let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
  const f = await fixture(t, { held }); t.after(() => { release(); return Promise.resolve(); });
  const saved = await f.register(); if (saved.action !== 'register') throw Error('Missing saved profile');
  await f.client.application({ action: 'select', strategyId: 'server', targetId: 'owned', profileId: saved.profile.id });
  await f.client.application({ action: 'inspect' });
  assert.equal((await f.post('/api/application', { action: 'refresh' })).status, 409);
  assert.equal((await f.post('/api/connection-profiles', { action: 'test', profileId: saved.profile.id })).status, 409);
  assert.equal(f.counts.inspect, 1); release(); await f.app.controller.whenIdle();
  assert.equal((await f.client.getState()).application?.canReview, true);
});
test('malformed publication cannot replace admitted viewer fields or stop the confirmed host step', async t => {
  const f = await fixture(t, { malformedPublication: true }); const saved = await f.register(); if (saved.action !== 'register') throw Error('Missing profile');
  await f.client.application({ action: 'select', strategyId: 'server', targetId: 'owned', profileId: saved.profile.id });
  await f.client.application({ action: 'inspect' }); await f.app.controller.whenIdle();
  const state = await f.client.getState();
  assert.deepEqual(state.artifacts, []); assert.equal(state.design, undefined); assert.equal(state.graph, null);
  assert.equal(state.application?.inspection?.ok, true); assert.equal(state.application.canReview, true);
  assert.match(state.application.error!, /native progress/i); assert.equal(f.counts.inspect, 1);
});
