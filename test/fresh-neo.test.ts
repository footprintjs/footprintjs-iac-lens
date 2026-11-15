import assert from 'node:assert/strict';
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { loadFreshNeoTarget, preparedNeo } from '../src/server/fresh-neo.ts';
import { startDashboard } from '../src/server/server.ts';
import { claimFreshNeo } from '../src/server/claim-fresh-neo.ts';
import type { Plan } from 'footprintjs-iac';

const descriptor = {
  version: 1, stage: 'prepared', clusterName: 'footprint-iac-recording-0123abcd',
  context: 'kind-footprint-iac-recording-0123abcd', namespace: 'footprint-iac-neo-test',
  kubeconfig: '/fixture/config', stateDirectory: '/fixture/state', sourceCommit: '1'.repeat(40),
  images: { nodeImage: 'footprint-iac/neo-node:review-' + 'a'.repeat(64),
    pythonImage: 'footprint-iac/neo-python:review-' + 'b'.repeat(64) },
};

test('fresh admission refuses reused review metadata, arbitrary clusters, mutable images and unknown source', () => {
  assert.deepEqual(preparedNeo(descriptor), descriptor);
  for (const mutation of [
    { version: 2 }, { stage: 'passed' }, { clusterName: 'footprint-iac-test', context: 'kind-footprint-iac-test' },
    { context: 'production' }, { namespace: 'default' }, { sourceCommit: 'unknown' },
    { images: { ...descriptor.images, nodeImage: 'footprint-iac/neo-node:local' } },
  ]) assert.throws(() => preparedNeo({ ...descriptor, ...mutation }), /neo:prepare-fresh/);
});

test('fresh startup shows the real graph grey and idle, checks absence and refuses reused state', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'iac-lens-fresh-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const artifacts = join(root, '.artifacts');
  const fresh = join(artifacts, 'neo/fresh');
  const stateDirectory = join(fresh, '0123abcd/state');
  const kubeconfig = join(fresh, '0123abcd/kubeconfig');
  await mkdir(stateDirectory, { recursive: true });
  await writeFile(kubeconfig, 'test config: never sent to a real command');
  await writeFile(join(fresh, 'latest.json'), JSON.stringify({ ...descriptor, kubeconfig, stateDirectory }));
  const config = { 'current-context': descriptor.context,
    contexts: [{ name: descriptor.context, context: { cluster: 'cluster', user: 'user' } }],
    clusters: [{ name: 'cluster', cluster: { server: 'https://127.0.0.1:23456' } }], users: [{ name: 'user', user: {} }] };
  let exists = false;
  const calls: { command: string; args: string[] }[] = [];
  const inspect = (command: string, args: string[]) => {
    calls.push({ command, args });
    if (command === 'docker') return JSON.stringify([{ Config: { Labels: {
      'io.x-k8s.kind.cluster': descriptor.clusterName, 'io.x-k8s.kind.role': 'control-plane' } },
      NetworkSettings: { Ports: { '6443/tcp': [{ HostIp: '127.0.0.1', HostPort: '23456' }] } } }]);
    assert.equal(command, 'kubectl'); assert.deepEqual(args.slice(0, 2), ['--kubeconfig', kubeconfig]);
    return args.includes('view') ? JSON.stringify(config) : exists ? '{"kind":"Namespace"}' : '';
  };
  const neo = await loadFreshNeoTarget(root, inspect);
  assert.equal(calls.length, 3);
  assert.ok(calls.every(call => call.command === 'docker' || call.args.includes('view') || call.args.includes('get')));
  const running = await startDashboard({ directory: join(root, 'viewer'), staticDirectory: root, neo, initialScenario: 'neo' });
  t.after(() => running.close());
  const response = await fetch(running.url + '/api/state');
  const state = await response.json();
  assert.equal(state.mode, 'kubernetes'); assert.equal(state.target.context, descriptor.context);
  assert.equal(state.run.status, 'idle'); assert.equal(state.busy, false);
  assert.equal(state.graph.resources.length, 3);
  assert.equal(state.run.resources.length, 3);
  assert.ok(state.run.resources.every((resource: { status: string }) => resource.status === 'pending'));
  assert.deepEqual(state.run.events, []);
  exists = true;
  await assert.rejects(() => loadFreshNeoTarget(root, inspect), /namespace already exists/);
  exists = false;
  config.clusters[0]!.cluster.server = 'https://127.0.0.1:12345';
  await assert.rejects(() => loadFreshNeoTarget(root, inspect), /API port/);
  config.clusters[0]!.cluster.server = 'https://outside.example:6443';
  await assert.rejects(() => loadFreshNeoTarget(root, inspect), /loopback/);
  config.clusters[0]!.cluster.server = 'https://127.0.0.1:23456';
  await writeFile(join(stateDirectory, 'inventory.json'), '{}');
  await assert.rejects(() => loadFreshNeoTarget(root, inspect), /inventory must be empty/);
});

test('two dashboards cannot claim the same fresh take and a changed target is refused before apply', async t => {
  const root = await mkdtemp(join(tmpdir(), 'iac-lens-claim-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const plan = { stack: 'neo', operations: [{ action: 'create', observed: { exists: false } }] } as Plan;
  let plans = 0;
  const attempts = await Promise.allSettled([1, 2].map(() => claimFreshNeo(join(root, 'claim.json'), async () => { plans++; return plan; })));
  assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(plans, 1);
  const refused = attempts.find(result => result.status === 'rejected') as PromiseRejectedResult;
  assert.match(refused.reason.message, /already started/);
  await assert.rejects(() => claimFreshNeo(join(root, 'changed.json'), async () => ({ ...plan,
    operations: [{ ...plan.operations[0]!, action: 'noop', observed: { exists: true } }] })), /planned for creation/);
});
