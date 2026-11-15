import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { FileStateStore, InfraEngine, ReconcileStrategy, SimulatorAdapter, loadEvidence } from 'footprintjs-iac';
import { compileGraph } from 'footprintjs-iac/graph';
import { createDeploymentRecorder } from 'footprintjs-iac/progress';
import { projectBuildScene, type DashboardState } from '../src/core/index.ts';
import { DashboardController, RequestError } from '../src/server/index.ts';

const ids = ['identity-directory', 'identity-provider', 'neo-namespace', 'neo-access-policy', 'neo-app', 'neo-service'];

function gate() {
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  return { entered, release, async wait() { enter(); await held; } };
}

/** Provider effects are local test seams; traversal, progress, checks and evidence are native. */
async function fixture(t: { after(fn: () => Promise<void>): void }, failProvider = false) {
  const directory = await mkdtemp(join(tmpdir(), 'iac-single-neo-build-'));
  const providerGate = gate(), connectionGate = gate();
  const graph = compileGraph({ name: 'single-neo-build', boundaries: [], memberships: [], resources: [
    { id: 'identity-directory', provider: 'simulator', spec: { role: 'directory' } },
    { id: 'identity-provider', provider: 'simulator', dependsOn: ['identity-directory'], spec: { role: 'provider' } },
    { id: 'neo-namespace', provider: 'simulator', spec: { kind: 'Namespace' } },
    { id: 'neo-access-policy', provider: 'simulator', dependsOn: ['neo-namespace'], spec: { kind: 'ConfigMap' } },
    { id: 'neo-app', provider: 'simulator', dependsOn: ['neo-namespace', 'identity-provider', 'neo-access-policy'], spec: { kind: 'Deployment' } },
    { id: 'neo-service', provider: 'simulator', dependsOn: ['neo-app'], spec: { kind: 'Service' } },
  ], relations: [
    { from: 'identity-provider', to: 'identity-directory', kind: 'communicatesWith' },
    { from: 'neo-app', to: 'identity-provider', kind: 'communicatesWith' },
    { from: 'neo-service', to: 'neo-app', kind: 'communicatesWith' },
  ] });
  const recorder = createDeploymentRecorder();
  const adapter = new SimulatorAdapter({ file: join(directory, 'provider.json'), faults: {
    ...(failProvider ? { failBeforeApply: new Set(['identity-provider']) } : {}),
    async afterEffect(resource) { if (!failProvider && resource.id === 'identity-provider') await providerGate.wait(); },
  } });
  const engine = new InfraEngine({ adapters: [adapter], store: new FileStateStore(join(directory, 'state')),
    strategy: new ReconcileStrategy(1), traceDirectory: join(directory, 'traces'),
    maxConcurrency: 1, recorders: [recorder], chartObservers: [recorder] });
  let applyCalls = 0, connectionCalls = 0, accessCalls = 0;
  const controller: DashboardController = new DashboardController({ directory: join(directory, 'viewer'),
    managedReview: { graph, recorder, label: 'Build Neo', target: { id: 'single-neo-target', label: 'Neo' },
      neoUrl: 'http://127.0.0.1:5230/?test', apply: async () => { applyCalls++; return engine.apply(graph); } },
    systemView: { blocks: [
      { id: 'identity', label: 'Identity', family: 'identity', units: [
        { id: 'directory', label: 'Directory', resourceIds: ['identity-directory'] },
        { id: 'provider', label: 'Sign-in provider', resourceIds: ['identity-provider'] },
        { id: 'policy', label: 'Permission policy configuration', resourceIds: ['neo-access-policy', 'neo-app'] },
      ] },
      { id: 'compute', label: 'Compute', family: 'compute', units: [
        { id: 'app', label: 'Neo application', mode: 'embedded', resourceIds: ['neo-app'] },
      ] },
      { id: 'storage', label: 'Storage', family: 'storage', units: [
        { id: 'data', label: 'Embedded SQLite', mode: 'embedded', resourceIds: ['neo-app'] },
        { id: 'sessions', label: 'Session state', mode: 'embedded', resourceIds: ['neo-app'] },
      ] },
    ] },
    connectionReview: { adapter: { async check(request) {
      connectionCalls++;
      assert.equal(controller.getSnapshot().run?.status, 'passed', 'no probes before deployment succeeds');
      if (!failProvider && connectionCalls === 1) await connectionGate.wait();
      return { method: 'owned test transport', target: `${request.from.id}/${request.to.id}`,
        observedAt: Date.now(), latencyMs: 1, details: { status: 200 } };
    } } },
    identityReview: { stack: graph.name, label: 'Neo access', checks: [
      { id: 'reader', label: 'Reader allowed', kind: 'access', expected: 'allowed' },
      { id: 'guest', label: 'Guest denied', kind: 'access', expected: 'denied' },
    ], resourceBindings: { reader: ['neo-app', 'neo-access-policy'], guest: ['neo-app', 'neo-access-policy'] },
    adapter: { async check(request) {
      accessCalls++;
      return { verdict: request.id === 'reader' ? 'allowed' : 'denied', observedAt: Date.now(), latencyMs: 1 };
    } } },
  });
  await controller.initialize();
  const updates: DashboardState[] = [controller.getSnapshot()];
  const unsubscribe = controller.subscribe(() => updates.push(controller.getSnapshot()));
  t.after(async () => {
    providerGate.release(); connectionGate.release(); await controller.whenIdle(); unsubscribe();
    await rm(directory, { recursive: true, force: true });
  });
  return { controller, graph, recorder, adapter, providerGate, connectionGate, updates,
    counts: () => ({ applyCalls, connectionCalls, accessCalls }) };
}

function resourceStatuses(state: DashboardState) {
  return Object.fromEntries(state.run!.resources.map(resource => [resource.id, resource.status]));
}

function assertSameSix(state: DashboardState, digest: string) {
  assert.equal(state.graph?.digest, digest);
  assert.deepEqual(new Set(state.run!.resources.map(resource => resource.id)), new Set(ids));
  assert.deepEqual(new Set(projectBuildScene(state).nodes.map(node => node.id)), new Set(ids));
  assert.equal(state.target?.label, 'Neo');
}

test('one Neo build exposes all six grey objects, streams one native run, then checks live connections and access', { timeout: 10_000 }, async t => {
  const host = await fixture(t);
  const initial = host.controller.getSnapshot();
  assertSameSix(initial, host.graph.digest);
  assert.equal(initial.managedReviewAvailable, true);
  assert.equal(initial.neoUrl, undefined, 'the app link is not offered before readiness');
  assert.equal(projectBuildScene(initial).headline, 'Ready to build');
  assert.ok(projectBuildScene(initial).nodes.every(node => node.status === 'pending'));
  assert.equal(projectBuildScene(initial).nodes.length, 6, 'embedded data and sessions never add deployment steps');
  assert.throws(() => host.controller.start('identity'), error => error instanceof RequestError && error.status === 409);
  host.controller.start('review');
  await Promise.race([host.providerGate.entered, host.controller.whenIdle().then(() => assert.fail('provider stage was not reached'))]);
  const building = host.controller.getSnapshot();
  assertSameSix(building, host.graph.digest);
  assert.deepEqual(resourceStatuses(building), {
    'identity-directory': 'ready', 'identity-provider': 'deploying', 'neo-namespace': 'pending',
    'neo-access-policy': 'pending', 'neo-app': 'pending', 'neo-service': 'pending',
  });
  assert.equal(projectBuildScene(building).headline, 'Building Sign-in');
  assert.deepEqual(host.counts(), { applyCalls: 1, connectionCalls: 0, accessCalls: 0 });
  assert.throws(() => host.controller.start('review'), error => error instanceof RequestError && error.status === 409);
  const chartOnly = host.updates.find(state => state.run?.chart && state.run.events.length === 0)!;
  assert.ok(chartOnly, 'native topology arrives before any recorded resource transition');
  assert.equal(chartOnly.run!.chart!.resources.length, 6);
  assert.ok(chartOnly.run!.resources.every(resource => resource.status === 'pending'));
  host.providerGate.release();
  await Promise.race([host.connectionGate.entered, host.controller.whenIdle().then(() => assert.fail('automatic connection checks did not run'))]);
  const checking = host.controller.getSnapshot();
  assertSameSix(checking, host.graph.digest);
  assert.equal(checking.run?.status, 'passed');
  assert.ok(checking.run?.resources.every(resource => resource.status === 'ready' && resource.action === 'create'));
  assert.equal(checking.connections?.status, 'checking');
  assert.ok(checking.connections?.events.some(event => event.status === 'checking' && !!event.runtimeStageId));
  assert.ok(projectBuildScene(checking).edges.some(edge => edge.status === 'checking'));
  const deployment = structuredClone(checking.run);
  host.connectionGate.release(); await host.controller.whenIdle();
  const connected = host.controller.getSnapshot();
  assertSameSix(connected, host.graph.digest);
  assert.deepEqual(connected.run, deployment, 'connection checks do not replace the one deployment recording');
  assert.equal(connected.neoUrl, 'http://127.0.0.1:5230/?test');
  assert.equal(connected.connections?.status, 'passed');
  assert.equal(connected.connections?.checks.length, 3);
  assert.ok(connected.connections?.checks.every(check => check.status === 'connected'));
  assert.equal(connected.connections?.events.length, 6);
  assert.ok(connected.connections?.recording?.snapshot);
  assert.ok(projectBuildScene(connected).edges.every(edge => edge.status === 'connected'));
  assert.deepEqual(host.counts(), { applyCalls: 1, connectionCalls: 3, accessCalls: 0 });
  assert.deepEqual(connected.run!.chart!.resources.map(binding => binding.resourceId), ids);
  assert.deepEqual(connected.run!.events.filter(event => event.status === 'deploying').map(event => event.resourceId), ids);
  assert.deepEqual(new Set(host.updates.map(state => state.run?.id).filter(Boolean)), new Set([connected.run!.id]));
  for (const state of host.updates) assertSameSix(state, host.graph.digest);
  const evidence = await loadEvidence((connected.run!.report as { evidencePath: string }).evidencePath);
  assert.equal(evidence.runId, connected.run!.id);
  assert.equal(evidence.graph?.digest, host.graph.digest);
  assert.deepEqual(evidence.structure, connected.run!.chart!.structure);
  host.controller.start('identity'); await host.controller.whenIdle();
  const access = host.controller.getSnapshot();
  assertSameSix(access, host.graph.digest);
  assert.deepEqual(access.run, deployment);
  assert.equal(access.identity?.status, 'passed');
  assert.deepEqual(access.identity?.checks.map(check => [check.expected, check.status, check.observation?.verdict]), [
    ['allowed', 'passed', 'allowed'], ['denied', 'passed', 'denied'],
  ]);
  assert.equal(projectBuildScene(access).headline, 'Ready');
  assert.deepEqual(host.counts(), { applyCalls: 1, connectionCalls: 3, accessCalls: 2 });
});

test('a failed sign-in build keeps the same six objects and skips downstream work without opening Neo or checking connections', { timeout: 10_000 }, async t => {
  const host = await fixture(t, true);
  host.controller.start('review'); await host.controller.whenIdle();
  const failed = host.controller.getSnapshot();
  assertSameSix(failed, host.graph.digest);
  assert.equal(failed.run?.status, 'failed');
  assert.deepEqual(resourceStatuses(failed), {
    'identity-directory': 'ready', 'identity-provider': 'failed', 'neo-namespace': 'skipped',
    'neo-access-policy': 'skipped', 'neo-app': 'skipped', 'neo-service': 'skipped',
  });
  assert.equal(projectBuildScene(failed).headline, 'Build stopped');
  assert.equal(failed.neoUrl, undefined);
  assert.equal(failed.connections?.status, 'idle');
  assert.ok(failed.connections?.checks.every(check => check.status === 'untested'));
  assert.deepEqual(host.adapter.calls.map(call => call.id), ['identity-directory', 'identity-provider']);
  assert.deepEqual(host.counts(), { applyCalls: 1, connectionCalls: 0, accessCalls: 0 });
  assert.ok(failed.run?.recording?.snapshot, 'the failed native run remains inspectable');
  assert.equal((failed.run?.report as { captureError?: string }).captureError, undefined);
  assert.equal(failed.run?.chart?.resources.length, 6);
  for (const state of host.updates) assertSameSix(state, host.graph.digest);
  assert.throws(() => host.controller.start('connections'), error => error instanceof RequestError && error.status === 409);
  assert.throws(() => host.controller.start('identity'), error => error instanceof RequestError && error.status === 409);
  host.adapter.faults.failBeforeApply!.clear();
  host.controller.start('review'); await host.controller.whenIdle();
  const recovered = host.controller.getSnapshot();
  assertSameSix(recovered, host.graph.digest);
  assert.equal(recovered.run?.status, 'passed');
  assert.notEqual(recovered.run?.id, failed.run?.id);
  assert.ok(recovered.run?.resources.every(resource => resource.status === 'ready'));
  assert.equal(recovered.run?.resources.find(resource => resource.id === 'identity-directory')?.action, 'noop');
  assert.ok(recovered.run?.resources.filter(resource => resource.id !== 'identity-directory').every(resource => resource.action === 'create'));
  assert.equal(recovered.connections?.status, 'passed');
  assert.deepEqual(host.counts(), { applyCalls: 2, connectionCalls: 3, accessCalls: 0 });
});
