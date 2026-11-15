import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ConnectionProfileRegistry, MemoryConnectionProfileStore, MemorySecretStore, type ConnectionAdapterSchema } from 'footprintjs-iac/connection-profiles';
import { FileResourceFlowStore, ResourceFlowWorkflow } from 'footprintjs-iac/resource-flow/workflow';
import { startDashboard } from '../src/server/index.ts';
import { createDashboardClient, readDashboardState } from '../src/core/client.ts';
import { readConnectionProfileAction, readConnectionProfilesView } from '../src/core/connection-profiles.ts';

const password = 'private-registration-password-638';
const schema: ConnectionAdapterSchema = { id: 'company-service', label: 'Company service', fields: [
  { name: 'endpoint', label: 'Service address', kind: 'url', required: true },
  { name: 'account', label: 'Account', kind: 'text', required: true },
  { name: 'password', label: 'Password', kind: 'password', secret: true, required: true },
] };
const registration = () => ({ label: 'Office service', adapterId: schema.id,
  config: { endpoint: 'https://service.internal.test', account: 'reader' }, secrets: { password } });

async function fixture(t: { after(fn: () => Promise<void>): void }, options: { noTest?: boolean; held?: Promise<void> } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'lens-connection-profiles-'));
  const staticDirectory = join(directory, 'static'); await mkdir(staticDirectory); await writeFile(join(staticDirectory, 'index.html'), 'Lens');
  let probes = 0, finds = 0, connects = 0;
  const registry = new ConnectionProfileRegistry({ profiles: new MemoryConnectionProfileStore(), secrets: new MemorySecretStore(),
    adapters: [{ schema, ...(!options.noTest ? { async validate({ config, secrets }: { config: Readonly<Record<string, string>>; secrets: Readonly<Record<string, string>> }) {
      if (config.endpoint !== 'https://service.internal.test') throw Error('Refused endpoint ' + password);
      probes++; if (options.held) await options.held;
      if (secrets.password !== password) throw Error('Provider exposed ' + secrets.password);
    } } : {}) }] });
  const createWorkflow = () => new ResourceFlowWorkflow({
    definition: { id: 'company-binding', resourceId: 'company-storage', mode: 'existing', label: 'Connect storage',
      target: { id: 'company-target', scope: 'scope-one' }, configurationDigest: 'a'.repeat(64) },
    store: new FileResourceFlowStore(join(directory, 'native')), profileCatalogId: 'company-connections', requireProfileAtStart: true,
    profiles: async () => (await registry.list()).map(profile => ({ id: profile.id, label: profile.label })), adapters: {
      async find(context) {
        finds++; assert.ok(context.profileId); const resolved = await registry.resolve(context.profileId);
        assert.equal(resolved.secrets.password, password);
        return { id: 'company-storage', kind: 'storage', physicalId: 'db-owned-42', scope: 'scope-one' };
      },
      async validate() {},
      async resolveDetails(resource, profileId) {
        if (!profileId) return;
        const resolved = await registry.resolve(profileId);
        return { resourceId: resource.id, profileId, protocol: 'https', endpoint: resolved.profile.config.endpoint!, credentialRef: 'profile-' + profileId };
      },
      async connect() { connects++; return { id: 'application-binding' }; },
      async verify() { return { ok: true, checks: [{ id: 'application-access', passed: true }] }; },
    },
  });
  const apps = new Set<Awaited<ReturnType<typeof startDashboard>>>();
  const open = async () => {
    const app = await startDashboard({ directory: join(directory, 'viewer'), staticDirectory,
      resourceFlow: { workflow: createWorkflow(), connectionProfiles: registry } });
    const close = app.close.bind(app); app.close = async () => { if (apps.delete(app)) await close(); };
    apps.add(app); return app;
  };
  t.after(async () => { for (const app of apps) await app.close(); await rm(directory, { recursive: true, force: true }); });
  return { directory, registry, open, counts: () => ({ probes, finds, connects }) };
}
function post(url: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(url + '/api/connection-profiles', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
}
async function assertNoRecordedSecret(directory: string) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, item.name);
    if (item.isDirectory()) await assertNoRecordedSecret(path);
    else if (/\.(json|jsonl)$/.test(item.name)) assert.equal((await readFile(path, 'utf8')).includes(password), false, path);
  }
}

test('registration, real registry test and native Find use an explicitly selected immutable profile without publishing its secret', async t => {
  const host = await fixture(t), app = await host.open(), client = createDashboardClient({ baseUrl: app.url });
  const initial = await client.getState(); assert.equal(initial.connectionProfiles?.requiredAtStart, true); assert.deepEqual(initial.connectionProfiles.profiles, []);
  await assert.rejects(client.resourceFlow({ action: 'start' }), /connection/); assert.equal(host.counts().finds, 0);
  const saved = await client.connectionProfile({ action: 'register', registration: registration() }); assert.equal(saved.action, 'register');
  if (saved.action !== 'register') throw Error('Missing profile');
  const profileId = saved.profile.id, catalog = await client.getState();
  assert.equal(catalog.connectionProfiles?.profiles.length, 1); assert.equal(JSON.stringify(catalog).includes(password), false);
  assert.equal(JSON.stringify(catalog.connectionProfiles).includes('secretRefs'), false);
  assert.equal(JSON.stringify(saved).includes(password), false);
  assert.deepEqual(await client.connectionProfile({ action: 'test', profileId }), { action: 'test', result: { profileId, ok: true } });
  await assert.rejects(client.resourceFlow({ action: 'start', profileId: 'foreign-profile' })); assert.equal(host.counts().finds, 0);
  await client.resourceFlow({ action: 'start', profileId }); await app.controller.whenIdle();
  const paused = await client.getState(); assert.equal(paused.resourceFlow?.status, 'paused'); assert.equal(paused.resourceFlow.selectedProfileId, profileId);
  assert.deepEqual(host.counts(), { probes: 4, finds: 2, connects: 0 }); // Acquisition and the details-stage identity revalidation are separate reads.
  const other = await client.connectionProfile({ action: 'register', registration: { ...registration(), label: 'Another saved connection' } });
  assert.equal(other.action, 'register');
  if (other.action !== 'register') throw Error('Missing second profile');
  await assert.rejects(client.resourceFlow({ action: 'resume', profileId: other.profile.id, pauseToken: paused.resourceFlow.pause!.token }));
  await app.close();
  const reopened = await host.open(), next = createDashboardClient({ baseUrl: reopened.url });
  assert.equal((await next.getState()).resourceFlow?.pause?.token, paused.resourceFlow.pause!.token);
  await next.resourceFlow({ action: 'resume', profileId, pauseToken: paused.resourceFlow.pause!.token }); await reopened.controller.whenIdle();
  const final = await next.getState(); assert.equal(final.resourceFlow?.status, 'passed'); assert.equal(host.counts().finds, 4); assert.equal(host.counts().connects, 1);
  assert.equal(final.resourceFlow.events.filter(event => event.stageId === 'acquire' && event.status === 'running').length, 1);
  assert.equal(final.resourceFlow.selectedProfileId, profileId); assert.equal(final.resourceFlow.segments.length, 2);
  await assertNoRecordedSecret(host.directory);
});

test('profile HTTP admission refuses foreign origins, unsupported content, oversized bodies and unknown fields without adapter I/O', async t => {
  const host = await fixture(t), app = await host.open(); const good = { action: 'register', registration: registration() };
  assert.equal((await post(app.url, good, { Origin: 'https://unrelated.test' })).status, 403);
  assert.equal((await post(app.url, good, { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await post(app.url, { ...good, padding: 'x'.repeat(33 * 1024) })).status, 413);
  for (const body of [{ ...good, endpoint: 'https://other.test' }, { action: 'test', profileId: 'no-profile', command: 'run' },
    { action: 'register', registration: { ...registration(), config: { ...registration().config, undeclared: 'value' } } },
    { action: 'register', registration: { ...registration(), config: { ...registration().config, endpoint: 'https://outside.test' } } }]) {
    const response = await post(app.url, body); assert.ok([400, 422].includes(response.status)); assert.equal((await response.text()).includes(password), false);
  }
  assert.equal(host.counts().probes, 0); assert.equal((await app.controller.getSnapshot()).connectionProfiles?.profiles.length, 0);
  let accessed = false;
  assert.throws(() => readConnectionProfileAction(Object.defineProperty({}, 'action', { enumerable: true, get() { accessed = true; return 'test'; } })));
  assert.equal(accessed, false);
});

test('profile mutation is serialized and workflow acquisition cannot start while validation is held', async t => {
  let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
  const host = await fixture(t, { held }), app = await host.open();
  const pending = post(app.url, { action: 'register', registration: registration() });
  while (!app.controller.getSnapshot().connectionProfiles?.busy) await new Promise(resolve => setImmediate(resolve));
  assert.equal((await post(app.url, { action: 'test', profileId: 'unselected' })).status, 409);
  const start = await fetch(app.url + '/api/resource-flow', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"action":"start"}' });
  assert.equal(start.status, 409); assert.equal(host.counts().finds, 0);
  release(); assert.equal((await pending).status, 200); assert.equal(app.controller.getSnapshot().connectionProfiles?.busy, false);
});

test('an adapter without a connection probe reports unavailable and safe profile projection excludes credential material', async t => {
  const host = await fixture(t, { noTest: true }), app = await host.open(), client = createDashboardClient({ baseUrl: app.url });
  const saved = await client.connectionProfile({ action: 'register', registration: registration() }); if (saved.action !== 'register') throw Error('Missing profile');
  assert.deepEqual(await client.connectionProfile({ action: 'test', profileId: saved.profile.id }), {
    action: 'test', result: { profileId: saved.profile.id, ok: false, code: 'connection-check-unavailable' },
  });
  const state = await client.getState(); assert.equal(state.connectionProfiles?.lastTest?.ok, false);
  assert.equal(host.counts().probes, 0);
  assert.throws(() => readConnectionProfilesView({ schemas: [schema], busy: false, requiredAtStart: true,
    profiles: [{ ...saved.profile, config: { ...saved.profile.config, password } }] }));
  assert.throws(() => readDashboardState({ ...state, connectionProfiles: { ...state.connectionProfiles, profiles: [{ ...saved.profile, config: { password } }] } }));
});
