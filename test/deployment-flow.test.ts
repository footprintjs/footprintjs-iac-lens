import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { compileGraph, FileStateStore, InfraEngine, SimulatorAdapter } from 'footprint-iac';
import { createDeploymentRecorder } from 'footprint-iac/progress';
import { projectDeploymentFlow } from '../src/core/deployment-flow.ts';
import type { DashboardState, ProgressEvent, ResourceProgress } from '../src/core/types.ts';

function state(): DashboardState {
  return { revision: 0, busy: false, graph: {
    kind: 'infra-graph', version: 1, name: 'flow', digest: 'd'.repeat(64), boundaries: [], memberships: [], relations: [], resources: [
      { id: 'app', provider: 'fixture', dependsOn: ['policy', 'namespace', 'provider'], spec: { kind: 'Deployment', metadata: { name: 'neo' } } },
      { id: 'service', provider: 'fixture', dependsOn: ['app'], spec: { kind: 'Service' } },
      { id: 'policy', provider: 'fixture', dependsOn: ['namespace'], spec: { kind: 'ConfigMap' } },
      { id: 'directory', provider: 'fixture', spec: {} },
      { id: 'namespace', provider: 'fixture', spec: { kind: 'Namespace' } },
      { id: 'provider', provider: 'fixture', dependsOn: ['directory'], spec: {} },
    ],
  }, systemView: { blocks: [
    { id: 'compute', label: 'Compute', family: 'compute', units: [{ id: 'app', label: 'Neo app', resourceIds: ['app'], mode: 'embedded' }] },
    { id: 'storage', label: 'Storage', family: 'storage', units: [{ id: 'data', label: 'Embedded SQLite', resourceIds: ['app'], mode: 'embedded' }] },
    { id: 'network', label: 'Network', family: 'network', units: [{ id: 'service', label: 'Application service', resourceIds: ['service'] }] },
    { id: 'placement', label: 'Placement', family: 'other', units: [{ id: 'cluster', label: 'Prepared cluster', resourceIds: [], mode: 'existing' }] },
  ] }, run: { id: 'run', status: 'idle', resources: [], events: [] } };
}
function event(resourceId: string, status: ResourceProgress['status'], sequence: number): ProgressEvent {
  return { resourceId, status, sequence, timestamp: 1000, runtimeStageId: `execute-${resourceId}` };
}
function node(input: ReturnType<typeof projectDeploymentFlow>, id: string) { return input.nodes.find(node => node.id === id)!; }

test('before capture, arrows express prerequisites and categories never imply an execution order', () => {
  const input = state(), before = structuredClone(input), flow = projectDeploymentFlow(input);
  assert.equal(flow.basis, 'prerequisites');
  assert.ok(flow.nodes.every(node => !node.observed && node.progress.status === 'pending'));
  assert.ok(flow.edges.every(edge => edge.kind === 'dependency'));
  assert.equal(node(flow, 'namespace').column, node(flow, 'directory').column);
  assert.ok(node(flow, 'namespace').column < node(flow, 'policy').column);
  assert.ok(node(flow, 'policy').column < node(flow, 'app').column);
  assert.ok(node(flow, 'app').column < node(flow, 'service').column);
  assert.ok(flow.columns.every(column => !column.overlapping && column.kind === 'prerequisites'));
  assert.deepEqual(node(flow, 'app').waitingFor, ['policy', 'namespace', 'provider']);
  assert.deepEqual(input, before, 'a viewer must not change dependencies or deployment state');
});

test('the exact recorded serial start order overrides category order, declaration order and tied clocks', () => {
  const input = state(), actualOrder = ['directory', 'provider', 'namespace', 'policy', 'app', 'service'];
  input.run!.status = 'passed';
  input.run!.events = actualOrder.flatMap((id, index) => [event(id, 'deploying', index * 2 + 1), event(id, 'ready', index * 2 + 2)]).reverse();
  input.run!.resources = actualOrder.map(id => ({ id, status: 'ready', action: 'create' }));
  const flow = projectDeploymentFlow(input);
  assert.equal(flow.basis, 'recorded');
  assert.deepEqual(flow.columns.map(column => column.resourceIds), actualOrder.map(id => [id]));
  assert.deepEqual(actualOrder.map(id => node(flow, id).observed!.step), [1, 2, 3, 4, 5, 6]);
  assert.ok(flow.columns.every(column => !column.overlapping));
  assert.deepEqual(flow.edges.filter(edge => edge.kind === 'observed-order').map(edge => [edge.source, edge.target]),
    actualOrder.slice(1).map((id, index) => [actualOrder[index], id]));
  assert.deepEqual(node(flow, 'app').waitingFor, []);
});

test('actual overlapping intervals stay beside each other and join before later work', () => {
  const input = state();
  input.run!.events = [event('namespace', 'deploying', 1), event('directory', 'deploying', 2),
    event('namespace', 'ready', 3), event('directory', 'ready', 4), event('provider', 'deploying', 5)];
  input.run!.resources = [{ id: 'namespace', status: 'ready' }, { id: 'directory', status: 'ready' }, { id: 'provider', status: 'deploying' }];
  const flow = projectDeploymentFlow(input);
  assert.equal(node(flow, 'namespace').column, node(flow, 'directory').column);
  assert.deepEqual(node(flow, 'namespace').observed!.overlapsWith, ['directory']);
  assert.deepEqual(node(flow, 'directory').observed!.overlapsWith, ['namespace']);
  assert.equal(flow.columns[0]!.label, 'Overlapping work');
  assert.ok(node(flow, 'provider').column > node(flow, 'directory').column);
  const edges = flow.edges.filter(edge => edge.kind === 'observed-order');
  assert.deepEqual(edges.map(edge => [edge.source, edge.target]).sort(), [['directory', 'provider'], ['namespace', 'provider']]);
  assert.ok(!edges.some(edge => edge.source === 'namespace' && edge.target === 'directory'), 'start ordinal is not a serial dependency');
});

test('a missing finish cannot manufacture a strict successor or claim a parallel interval', () => {
  const input = state();
  input.run!.events = [event('directory', 'deploying', 1), event('namespace', 'deploying', 2), event('namespace', 'ready', 3)];
  input.run!.resources = [{ id: 'directory', status: 'ready' }, { id: 'namespace', status: 'ready' }];
  const flow = projectDeploymentFlow(input);
  assert.equal(node(flow, 'directory').column, node(flow, 'namespace').column);
  assert.deepEqual(node(flow, 'directory').observed!.overlapsWith, []);
  assert.ok(!flow.columns[0]!.overlapping);
  assert.equal(flow.columns[0]!.label, 'Order unresolved');
  assert.ok(flow.warnings.some(warning => warning.includes('completion order is unknown')));
  assert.ok(!flow.edges.some(edge => edge.kind === 'observed-order'));
});

test('native simultaneous running states can show overlap before either operation finishes', () => {
  const input = state();
  input.run!.events = [event('directory', 'deploying', 1), event('namespace', 'deploying', 2)];
  input.run!.resources = [{ id: 'directory', status: 'deploying' }, { id: 'namespace', status: 'deploying' }];
  const flow = projectDeploymentFlow(input);
  assert.equal(flow.columns[0]!.label, 'Overlapping work');
  assert.deepEqual(node(flow, 'directory').observed!.overlapsWith, ['namespace']);
  assert.equal(node(flow, 'directory').progress.status, 'deploying');
});

test('missing, tied or foreign native sequence information cannot establish execution order', () => {
  for (const events of [
    [{ resourceId: 'directory', status: 'deploying' as const, timestamp: 1 }, event('namespace', 'deploying', 2)],
    [event('directory', 'deploying', 1), event('namespace', 'deploying', 1)],
    [{ ...event('directory', 'deploying', 1), runId: 'different-run' }],
  ]) {
    const input = state(); input.run!.events = events;
    const flow = projectDeploymentFlow(input);
    assert.equal(flow.basis, 'prerequisites');
    assert.ok(flow.nodes.every(node => !node.observed));
    assert.ok(!flow.edges.some(edge => edge.kind === 'observed-order'));
    assert.ok(flow.warnings.length > 0);
  }
});

test('capability badges share one physical node and existing infrastructure is not a new step', () => {
  const flow = projectDeploymentFlow(state());
  assert.equal(flow.nodes.filter(node => node.id === 'app').length, 1);
  assert.deepEqual(node(flow, 'app').capabilities.map(capability => [capability.family, capability.label, capability.mode]), [
    ['compute', 'Neo app', 'embedded'], ['storage', 'Embedded SQLite', 'embedded'],
  ]);
  assert.deepEqual(node(flow, 'app').capabilities[0]!.resourceIds, ['app']);
  assert.equal(flow.nodes.length, 6);
  assert.deepEqual(flow.existingPrerequisites, [{ id: 'placement:cluster', label: 'Prepared cluster' }]);
});

test('pending, failed and skipped resources retain their observed truth without fabricated start steps', () => {
  const input = state();
  input.run!.events = [event('directory', 'deploying', 1), event('directory', 'failed', 2), event('provider', 'skipped', 3)];
  input.run!.resources = [{ id: 'directory', status: 'failed' }, { id: 'provider', status: 'skipped' }];
  const flow = projectDeploymentFlow(input);
  assert.equal(node(flow, 'directory').observed!.step, 1);
  assert.equal(node(flow, 'directory').progress.status, 'failed');
  assert.equal(node(flow, 'provider').progress.status, 'skipped');
  assert.equal(node(flow, 'provider').observed, undefined);
  assert.equal(node(flow, 'app').progress.status, 'pending');
  assert.deepEqual(node(flow, 'provider').waitingFor, ['directory']);
  assert.equal(flow.columns[node(flow, 'provider').column]!.kind, 'unstarted');
  assert.ok(!flow.edges.some(edge => edge.kind === 'observed-order'));
});

test('unknown resources and communication relationships never add deployment steps', () => {
  const input = state();
  input.graph!.relations.push({ from: 'service', to: 'app', kind: 'communicatesWith' });
  input.run!.events = [event('unknown', 'deploying', 1), event('directory', 'deploying', 2), event('directory', 'ready', 3)];
  const flow = projectDeploymentFlow(input);
  assert.equal(flow.nodes.length, 6);
  assert.equal(node(flow, 'directory').observed!.step, 1);
  assert.ok(flow.edges.every(edge => edge.kind === 'dependency' || edge.kind === 'observed-order'));
  assert.ok(!flow.edges.some(edge => edge.source === 'service' && edge.target === 'app'));
});

test('real native engine events distinguish default serial execution from an actual fork and join', { timeout: 10_000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'iac-flow-projection-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const graph = compileGraph({ name: 'native-flow', boundaries: [], memberships: [], relations: [], resources: [
    { id: 'a', provider: 'simulator', spec: {} }, { id: 'b', provider: 'simulator', spec: {} },
    { id: 'joined', provider: 'simulator', dependsOn: ['a', 'b'], spec: {} },
  ] });
  for (const maxConcurrency of [1, 2]) {
    const recorder = createDeploymentRecorder();
    let entered = 0, release!: () => void;
    const bothEntered = new Promise<void>(resolve => { release = resolve; });
    const adapter = new SimulatorAdapter({ faults: { afterEffect: async resource => {
      if (maxConcurrency === 2 && resource.id !== 'joined') {
        if (++entered === 2) release();
        await bothEntered;
      }
    } } });
    const engine = new InfraEngine({ adapters: [adapter], recorders: [recorder], maxConcurrency,
      store: new FileStateStore(join(directory, String(maxConcurrency))),
      traceDirectory: join(directory, 'traces-' + maxConcurrency) });
    const result = await engine.apply(graph); assert.equal(result.ok, true);
    const snapshot = recorder.getSnapshot();
    assert.equal(snapshot.ignoredEvents, 0);
    const input: DashboardState = { revision: 0, busy: false, graph, run: { id: result.runId, status: 'passed',
      resources: Object.values(snapshot.resources).map(event => ({ ...event, id: event.resourceId })), events: [...snapshot.events] } };
    const flow = projectDeploymentFlow(input);
    assert.equal(flow.basis, 'recorded'); assert.deepEqual(flow.warnings, []);
    if (maxConcurrency === 1) {
      assert.equal(flow.columns.length, 3);
      assert.ok(flow.columns.every(column => !column.overlapping));
      assert.deepEqual(flow.nodes.map(node => node.observed!.step), [1, 2, 3]);
    } else {
      assert.equal(flow.columns.length, 2);
      assert.equal(node(flow, 'a').column, node(flow, 'b').column);
      assert.deepEqual(node(flow, 'a').observed!.overlapsWith, ['b']);
      assert.ok(node(flow, 'joined').column > node(flow, 'a').column);
      assert.deepEqual(flow.edges.filter(edge => edge.kind === 'observed-order').map(edge => [edge.source, edge.target]), [['a', 'joined'], ['b', 'joined']]);
    }
  }
});
