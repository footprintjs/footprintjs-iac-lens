import assert from 'node:assert/strict';
import test from 'node:test';
import { createDashboardClient, newerState, readDashboardState } from '../src/core/client.ts';
import { layoutResources } from '../src/core/layout.ts';
import { describeResource, familyCounts, localAppUrl, resourceProgress, statusCounts } from '../src/core/model.ts';
import type { DashboardState } from '../src/core/types.ts';
import type { StreamCallbacks } from '../src/core/client.ts';

function state(revision = 0): DashboardState {
  return {
    revision, busy: false, mode: 'simulator',
    graph: { kind: 'infra-graph', version: 1, name: 'test', digest: 'd'.repeat(64), boundaries: [], memberships: [], relations: [], resources: [
      { id: 'network', provider: 'simulator', spec: { kind: 'Network' } },
      { id: 'api', provider: 'simulator', dependsOn: ['network'], spec: { kind: 'Compute' } },
    ] },
    run: { id: 'run', status: 'idle', resources: [], events: [] },
  };
}

test('headless state model starts unobserved resources pending and counts only the declared graph', () => {
  const input = state();
  assert.equal(resourceProgress(input, 'api').status, 'pending');
  assert.deepEqual(statusCounts(input), { pending: 2, deploying: 0, ready: 0, failed: 0, skipped: 0, deleted: 0 });
  input.run!.resources = [{ id: 'network', status: 'ready' }, { id: 'api', status: 'deploying' }, { id: 'unrelated', status: 'ready' }];
  assert.equal(statusCounts(input).ready, 1);
  assert.equal(statusCounts(input).deploying, 1);
});

test('pure layout preserves complete identifiers, dependency direction and descriptive communication', () => {
  const input = state();
  const longId = 'capability-' + 'a'.repeat(100);
  input.graph!.resources[1]!.id = longId;
  input.graph!.relations = [{ from: longId, to: 'network', kind: 'communicatesWith' }];
  const before = structuredClone(input);
  const view = layoutResources(input);
  assert.ok(view.nodes[1]!.position.x > view.nodes[0]!.position.x);
  assert.equal(view.nodes[1]!.id, longId);
  assert.ok(view.edges.some(edge => edge.source === 'network' && edge.target === longId && edge.kind === 'order'));
  assert.ok(view.edges.some(edge => edge.source === longId && edge.target === 'network' && edge.kind === 'communication'));
  assert.deepEqual(input, before, 'presentation cannot mutate desired infrastructure or progress');
});

test('capability and boundary descriptions remain linked to the full resource identifier', () => {
  const input = state();
  input.graph!.boundaries = [{ id: 'group', kind: 'group', attributes: { origin: 'capability', capabilityFamily: 'compute', capabilityPath: 'application.api' } },
    { id: 'region', kind: 'region', label: 'local-region' }];
  input.graph!.memberships = [{ resourceId: 'api', boundaryId: 'group' }, { resourceId: 'api', boundaryId: 'region' }];
  const description = describeResource(input, input.graph!.resources[1]!);
  assert.equal(description.capability, 'application.api');
  assert.equal(description.family, 'compute');
  assert.deepEqual(description.boundaries, ['region: local-region']);
});

test('resource descriptions respect declared families when a graph has no capability model', () => {
  const input = state();
  input.graph!.resources[0]!.spec = { family: 'network', kind: 'endpoint' };
  input.graph!.resources[1]!.spec = { family: 'compute', kind: 'service' };
  assert.equal(describeResource(input, input.graph!.resources[0]!).family, 'network');
  assert.equal(describeResource(input, input.graph!.resources[1]!).family, 'compute');
  assert.deepEqual(familyCounts(input), { compute: 1, storage: 0, network: 1 });
  input.design = { kind: 'system-design', version: 1, name: 'logical', digest: 'd'.repeat(64), principals: [], boundaries: [], memberships: [], relations: [], capabilities: [
    { id: 'store', path: 'state.store', family: 'storage', kind: 'store', properties: {}, defaults: {} },
  ] };
  assert.deepEqual(familyCounts(input), { compute: 0, storage: 1, network: 0 }, 'logical counts must not be replaced by physical resource counts');
});

test('state admission rejects unsupported progress instead of rendering an invented outcome', () => {
  assert.equal(readDashboardState(state(2)).revision, 2);
  assert.throws(() => readDashboardState({ ...state(), revision: -1 }), /unsupported/);
  assert.throws(() => readDashboardState({ ...state(), graph: {} }), /unsupported/);
  const invalid = state(); invalid.run!.resources = [{ id: 'api', status: 'complete' as never }];
  assert.throws(() => readDashboardState(invalid), /unsupported/);
  assert.equal(newerState(state(9), state(3)).revision, 9);
});

test('framework-neutral client ignores a delayed HTTP snapshot after a newer stream event and closes cleanly', async () => {
  let resolveHttp!: (value: DashboardState) => void;
  let callbacks!: StreamCallbacks;
  let closed = false;
  const updates: number[] = [];
  const client = createDashboardClient({ baseUrl: 'http://127.0.0.1:1234', fetch: async url => {
    assert.equal(url, 'http://127.0.0.1:1234/api/state');
    return { ok: true, status: 200, json: () => new Promise<DashboardState>(resolve => { resolveHttp = resolve; }) };
  }, openStream(url, handlers) { assert.equal(url, 'http://127.0.0.1:1234/api/events'); callbacks = handlers; return () => { closed = true; }; } });
  const unsubscribe = client.subscribe({ state: value => updates.push(value.revision) });
  await Promise.resolve();
  callbacks.state(JSON.stringify(state(5)));
  resolveHttp(state(2));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(updates, [5]);
  unsubscribe(); callbacks.state(JSON.stringify(state(6)));
  assert.equal(closed, true);
  assert.deepEqual(updates, [5]);
});

test('client exposes a refused run and sends only the chosen scenario', async () => {
  const client = createDashboardClient({ fetch: async (url, options) => {
    assert.equal(url, '/api/run'); assert.equal(options?.method, 'POST');
    assert.deepEqual(JSON.parse(options?.body ?? '{}'), { scenario: 'neo' });
    return { ok: false, status: 409, json: async () => ({ error: 'Neo is not configured' }) };
  } });
  await assert.rejects(client.run('neo'), /Neo is not configured/);
  assert.equal(localAppUrl('javascript:alert(1)'), undefined);
  assert.equal(localAppUrl('https://public.example'), undefined);
  assert.equal(localAppUrl('http://127.0.0.1:15230/?test'), 'http://127.0.0.1:15230/?test');
});
