import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { compileGraph, FileStateStore, InfraEngine, SimulatorAdapter } from 'footprint-iac';
import { createDeploymentRecorder } from 'footprint-iac/progress';
import { projectBuildScene } from '../src/core/build-scene.ts';
import { projectDeploymentFlow } from '../src/core/deployment-flow.ts';
import type { DashboardState, ProgressEvent } from '../src/core/types.ts';

function initial(parallel = false): DashboardState {
  const graph = compileGraph({ name: 'build-scene', boundaries: [], memberships: [], resources: [
    { id: 'app', provider: 'simulator', dependsOn: ['data', 'network'], spec: { kind: 'Deployment' } },
    { id: 'network', provider: 'simulator', ...(parallel ? {} : { dependsOn: ['data'] }), spec: { kind: 'Service' } },
    { id: 'data', provider: 'simulator', spec: { kind: 'PersistentVolumeClaim' } },
  ], relations: [{ from: 'app', to: 'data', kind: 'communicatesWith' }] });
  return { revision: 0, busy: false, mode: 'simulator', graph: structuredClone(graph), systemView: { blocks: [
    { id: 'compute', label: 'Compute', family: 'compute', units: [
      { id: 'app', label: 'Application runtime', resourceIds: ['app'] },
    ] },
    { id: 'storage', label: 'Storage', family: 'storage', units: [
      { id: 'data', label: 'Persistent storage', resourceIds: ['data'] },
    ] },
    { id: 'network', label: 'Network', family: 'network', units: [
      { id: 'network', label: 'Application service', resourceIds: ['network'] },
    ] },
  ] } };
}

function finished(): DashboardState {
  const state = initial();
  const order = ['data', 'network', 'app'];
  state.run = { id: 'native-run', status: 'passed', resources: order.map(id => ({ id, status: 'ready', action: 'create' })),
    events: order.flatMap((resourceId, index): ProgressEvent[] => [
      { resourceId, status: 'deploying', action: 'create', sequence: index * 2 + 1 },
      { resourceId, status: 'ready', action: 'create', sequence: index * 2 + 2 },
    ]) };
  return state;
}

async function native(t: { after(fn: () => Promise<void>): void }, parallel = false) {
  const directory = await mkdtemp(join(tmpdir(), 'iac-build-scene-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const state = initial(parallel), recorder = createDeploymentRecorder(), states: DashboardState[] = [];
  let entered = 0, release!: () => void;
  const together = new Promise<void>(resolve => { release = resolve; });
  const adapter = new SimulatorAdapter({ faults: { afterEffect: async resource => {
    if (parallel && resource.id !== 'app') {
      if (++entered === 2) release();
      await together;
    }
  } } });
  function snapshot(status: 'running' | 'passed' = 'running'): DashboardState {
    const recorded = recorder.getSnapshot();
    return { ...state, busy: status === 'running', run: { id: recorded.runId ?? recorded.chart?.runId ?? '', status,
      ...(recorded.chart && { chart: recorded.chart }), events: [...recorded.events],
      resources: state.graph!.resources.map(resource => ({ id: resource.id,
        ...(recorded.resources[resource.id] ?? { status: 'pending' }),
      })),
    } };
  }
  const closeChart = recorder.subscribeChart(() => states.push(snapshot()));
  const closeProgress = recorder.subscribe(() => states.push(snapshot()));
  t.after(async () => { closeChart(); closeProgress(); });
  const engine = new InfraEngine({ adapters: [adapter], store: new FileStateStore(join(directory, 'state')),
    traceDirectory: join(directory, 'traces'), recorders: [recorder], chartObservers: [recorder], maxConcurrency: parallel ? 2 : 1 });
  const result = await engine.apply(state.graph!);
  assert.equal(result.ok, true);
  const ready = snapshot('passed'); states.push(ready);
  return { state, states, ready, engine, snapshot, adapter };
}

test('the grey scene stays pure, academic and ordered by prerequisites, without a category sequence', () => {
  const state = initial(), before = structuredClone(state), scene = projectBuildScene(state);
  assert.equal(scene.phase, 'idle');
  assert.equal(scene.headline, 'Ready to build');
  assert.equal(scene.simulation, true);
  assert.deepEqual(scene.counts, { ready: 0, total: 3 });
  assert.ok(scene.nodes.every(node => node.status === 'pending' && node.step === undefined && !node.uncertain));
  assert.deepEqual(scene.activeIds, []);
  assert.deepEqual(Object.fromEntries(scene.nodes.map(node => [node.id, node.title])), { app: 'Program', data: 'Storage', network: 'Network' });
  assert.ok(scene.nodes.find(node => node.id === 'data')!.column < scene.nodes.find(node => node.id === 'app')!.column);
  assert.ok(scene.flowEdges.some(edge => edge.from === 'data' && edge.to === 'network' && edge.kind === 'dependency'));
  assert.deepEqual(scene.edges, [{ id: `communication:${state.graph!.relations.findIndex(relation => relation.kind === 'communicatesWith')}`,
    from: 'app', to: 'data', status: 'untested' }]);
  assert.deepEqual(state, before);
});

test('a real native chart and recorder drive grey → building → ready with stable positions', async t => {
  const { states, ready } = await native(t), scenes = states.map(projectBuildScene);
  const first = scenes[0]!;
  assert.equal(first.phase, 'starting');
  assert.equal(first.headline, 'Running your code');
  assert.ok(first.nodes.every(node => node.status === 'pending'));
  const actual = scenes.find(scene => scene.activeIds.includes('data'))!;
  assert.equal(actual.headline, 'Building Storage');
  assert.equal(actual.nodes.find(node => node.id === 'data')!.step, 1);
  assert.equal(actual.nodes.find(node => node.id === 'app')!.status, 'pending');
  assert.ok(scenes.some(scene => scene.activeIds.includes('network') && scene.counts.ready === 1));
  assert.ok(scenes.some(scene => scene.activeIds.includes('app') && scene.counts.ready === 2));
  for (const scene of scenes) {
    assert.deepEqual(scene.nodes.map(node => [node.id, node.column, node.row]), first.nodes.map(node => [node.id, node.column, node.row]));
    assert.deepEqual(scene.warnings, []);
    assert.ok(scene.activeIds.every(id => scene.nodes.find(node => node.id === id)?.step !== undefined));
  }
  assert.equal(projectDeploymentFlow(ready).layoutSource, 'native-chart');
  const last = scenes.at(-1)!;
  assert.deepEqual(last.counts, { ready: 3, total: 3 });
  assert.equal(last.phase, 'ready');
  assert.equal(last.headline, 'System built');
  assert.equal(last.subline, 'Check connections');
  assert.ok(last.edges.every(edge => edge.status === 'untested'), 'built resources do not imply working connections');
});

test('real overlapping native branches stay together, with a join before the program', { timeout: 10_000 }, async t => {
  const { states, ready } = await native(t, true);
  const scene = projectBuildScene(states.find(state => state.run?.resources.filter(resource => resource.status === 'deploying').length === 2)!);
  assert.equal(scene.headline, 'Building together');
  assert.deepEqual(new Set(scene.activeIds), new Set(['data', 'network']));
  const data = scene.nodes.find(node => node.id === 'data')!, network = scene.nodes.find(node => node.id === 'network')!, app = scene.nodes.find(node => node.id === 'app')!;
  assert.equal(data.column, network.column);
  assert.notEqual(data.row, network.row);
  assert.ok(app.column > data.column);
  assert.ok(!scene.flowEdges.some(edge => edge.from === 'data' && edge.to === 'network'));
  assert.ok(scene.flowEdges.some(edge => edge.kind === 'native-schedule' && edge.from === 'data' && edge.to === 'app'));
  assert.ok(scene.flowEdges.some(edge => edge.kind === 'native-schedule' && edge.from === 'network' && edge.to === 'app'));
  assert.deepEqual(projectBuildScene(ready).warnings, []);
});

test('a real second apply checks unchanged resources rather than claiming to build them', async t => {
  const { states, state, engine, adapter } = await native(t);
  const firstCalls = adapter.calls.length, from = states.length;
  const result = await engine.apply(state.graph!);
  assert.equal(result.ok, true);
  assert.equal(adapter.calls.length, firstCalls);
  const active = states.slice(from).map(projectBuildScene).filter(scene => scene.activeIds.length);
  assert.ok(active.length > 0);
  assert.ok(active.every(scene => scene.headline.startsWith('Checking ')));
  assert.ok(active.every(scene => scene.nodes.filter(node => scene.activeIds.includes(node.id)).every(node => node.action === 'noop')));
});

test('embedded Neo data and sessions follow their runtime without inventing database or volume steps', () => {
  const state = initial();
  state.graph!.resources = state.graph!.resources.filter(resource => resource.id !== 'data');
  state.graph!.resources.find(resource => resource.id === 'app')!.dependsOn = ['network'];
  state.graph!.resources.find(resource => resource.id === 'network')!.dependsOn = [];
  state.graph!.relations = [];
  state.systemView = { blocks: state.systemView!.blocks.map(block => block.family !== 'storage' ? block : { ...block, units: [
    { id: 'data', label: 'Embedded SQLite', resourceIds: ['app'], mode: 'embedded' },
    { id: 'sessions', label: 'Session state', resourceIds: ['app'], mode: 'embedded' },
  ] }) };
  const scene = projectBuildScene(state), app = scene.nodes.find(node => node.id === 'app')!;
  assert.equal(scene.nodes.length, 2);
  assert.deepEqual(app.embedded.map(unit => [unit.title, unit.kind, unit.status]), [
    ['Data', 'storage', 'pending'], ['Sessions', 'storage', 'pending'],
  ]);
  assert.ok(!scene.nodes.some(node => node.kind === 'storage'));
  assert.equal(scene.counts.total, 2);
});

test('a shared permission capability names its policy configuration without renaming the program', () => {
  const state = initial();
  state.graph!.resources.push({ id: 'policy', provider: 'simulator', spec: { kind: 'ConfigMap' } });
  state.systemView = { blocks: [...state.systemView!.blocks, { id: 'identity', label: 'Identity', family: 'identity', units: [
    { id: 'policy', label: 'Permission policy configuration', resourceIds: ['policy', 'app'] },
  ] }] };
  const scene = projectBuildScene(state);
  assert.equal(scene.nodes.find(node => node.id === 'policy')!.kind, 'policy');
  assert.equal(scene.nodes.find(node => node.id === 'policy')!.title, 'Access');
  assert.equal(scene.nodes.find(node => node.id === 'app')!.title, 'Program');
});

test('only real communication relations and their recorded probes can connect, fail and recover', () => {
  const state = finished();
  state.graph!.relations = [{ from: 'network', to: 'app', kind: 'order' }, { from: 'app', to: 'data', kind: 'communicatesWith' }];
  state.connections = { id: 'connections', status: 'checking', events: [], checks: [
    { connectionId: 'communication:1', from: 'app', to: 'data', status: 'checking' },
    { connectionId: 'invented', from: 'network', to: 'data', status: 'connected' },
  ] };
  let scene = projectBuildScene(state);
  assert.equal(scene.phase, 'checking');
  assert.equal(scene.headline, 'Connecting');
  assert.deepEqual(scene.edges, [{ id: 'communication:1', from: 'app', to: 'data', status: 'checking' }]);
  state.connections.status = 'failed'; state.connections.checks[0]!.status = 'failed';
  scene = projectBuildScene(state);
  assert.equal(scene.phase, 'failed'); assert.equal(scene.headline, 'Connection failed');
  assert.equal(scene.edges[0]!.status, 'failed');
  assert.equal(scene.counts.ready, 3, 'probe failure does not rewrite resource readiness');
  state.connections.status = 'passed'; state.connections.checks[0]!.status = 'connected';
  scene = projectBuildScene(state);
  assert.equal(scene.phase, 'ready'); assert.equal(scene.headline, 'Ready');
  assert.equal(scene.edges[0]!.status, 'connected');
});

test('expected denied access passes; an actual failed access check fails until a new passing result', () => {
  const state = finished(); state.graph!.relations = [];
  state.identity = { id: 'identity', label: 'Access', status: 'passed', events: [], checks: [
    { checkId: 'denied', label: 'Restricted action', kind: 'access', expected: 'denied', status: 'passed',
      observation: { verdict: 'denied', observedAt: 1, latencyMs: 1 } },
  ] };
  assert.equal(projectBuildScene(state).headline, 'Ready');
  state.identity.status = 'failed'; state.identity.checks[0]!.status = 'failed';
  assert.equal(projectBuildScene(state).headline, 'Access check failed');
  state.identity.status = 'checking'; state.identity.checks[0]!.status = 'checking';
  assert.equal(projectBuildScene(state).headline, 'Checking access');
  state.identity.status = 'passed'; state.identity.checks[0]!.status = 'passed';
  assert.equal(projectBuildScene(state).headline, 'Ready');
});

test('missing or foreign capture and unmapped capabilities stay visible instead of a completed animation', () => {
  const state = finished(); state.run!.events = [];
  let scene = projectBuildScene(state);
  assert.equal(scene.phase, 'incomplete');
  assert.ok(scene.nodes.every(node => node.uncertain && node.step === undefined));
  assert.deepEqual(scene.activeIds, []);
  assert.ok(scene.warnings.some(warning => warning.includes('No start event')));
  state.run!.events = finished().run!.events.map(event => ({ ...event, runId: 'foreign' }));
  scene = projectBuildScene(state);
  assert.equal(scene.phase, 'incomplete');
  assert.ok(scene.nodes.every(node => node.step === undefined));
  state.run = finished().run;
  state.systemView = { blocks: state.systemView!.blocks.map((block, index) => index ? block : {
    ...block, units: [...block.units, { id: 'unknown', label: 'Unknown storage', resourceIds: [] }],
  }) };
  scene = projectBuildScene(state);
  assert.equal(scene.phase, 'incomplete');
  assert.ok(scene.warnings.some(warning => warning.includes('Unknown storage')));
  assert.equal(scene.nodes.length, 3, 'an unbound capability is disclosed without inventing infrastructure');
});

test('unrecorded deploying snapshots do not animate, and unknown physical kinds stay generic', () => {
  const state = initial();
  state.run = { id: 'missing', status: 'running', resources: [{ id: 'app', status: 'deploying' }], events: [] };
  const scene = projectBuildScene(state);
  assert.equal(scene.phase, 'incomplete');
  assert.equal(scene.nodes.find(node => node.id === 'app')!.uncertain, true);
  assert.deepEqual(scene.activeIds, []);
  const unknown: DashboardState = { revision: 0, busy: false, graph: compileGraph({ name: 'unknown', boundaries: [], memberships: [], relations: [],
    resources: [{ id: 'unknown', provider: 'simulator', spec: { kind: 'UnfamiliarProviderType' } }],
  }) };
  assert.equal(projectBuildScene(unknown).nodes[0]!.kind, 'resource');
  assert.equal(projectBuildScene(unknown).nodes[0]!.title, 'Resource');
});

test('incomplete check recordings disclose uncertainty while retaining actual measured outcomes', () => {
  const state = finished();
  const index = state.graph!.relations.findIndex(relation => relation.kind === 'communicatesWith');
  state.connections = { id: 'checks', status: 'passed', events: [],
    checks: [{ connectionId: `communication:${index}`, from: 'app', to: 'data', status: 'connected' }],
    report: { captureError: 'Native trace incomplete' },
  };
  let scene = projectBuildScene(state);
  assert.equal(scene.phase, 'incomplete');
  assert.equal(scene.edges[0]!.status, 'connected');
  assert.ok(scene.warnings.some(warning => warning.includes('connection recording')));
  delete state.connections.report;
  state.identity = { id: 'access', label: 'Access', status: 'passed', checks: [], events: [], report: { captureError: 'Trace missing' } };
  scene = projectBuildScene(state);
  assert.equal(scene.phase, 'incomplete');
  assert.ok(scene.warnings.some(warning => warning.includes('access recording')));
});
