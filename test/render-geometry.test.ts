import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ConnectionMode, getNodesBounds, type Edge, type Node } from '@xyflow/react';
import { adoptUserNodes, getEdgePosition, type InternalNodeBase, type ParentLookup } from '@xyflow/system';
import { compileGraph, FileStateStore, InfraEngine, SimulatorAdapter } from 'footprint-iac';
import { createDeploymentRecorder, type DeploymentChart } from 'footprint-iac/progress';
import { createDashboardClient, type StreamCallbacks } from '../src/core/client.ts';
import { layoutResources } from '../src/core/layout.ts';
import { COMMUNICATION_SOURCE_OFFSET, COMMUNICATION_TARGET_OFFSET } from '../src/core/resource-geometry.ts';
import type { DashboardState } from '../src/core/types.ts';
import { buildDeploymentFlowView, STEP_HEIGHT, STEP_WIDTH } from '../web/lib/deployment-flow-view.ts';
import { buildResourceView } from '../web/lib/resource-view.ts';

function pending(): DashboardState {
  const graph = compileGraph({ name: 'render-geometry', boundaries: [], memberships: [], resources: [
    { id: 'directory', provider: 'simulator', spec: { role: 'directory' } },
    { id: 'provider', provider: 'simulator', dependsOn: ['directory'], spec: { role: 'provider' } },
    { id: 'namespace', provider: 'simulator', spec: { kind: 'Namespace', metadata: { name: 'footprint-iac-identity-render-geometry' } } },
    { id: 'policy', provider: 'simulator', dependsOn: ['namespace'], spec: { kind: 'ConfigMap' } },
    { id: 'app', provider: 'simulator', dependsOn: ['policy', 'provider'], spec: { kind: 'Deployment', metadata: { name: 'neo' } } },
    { id: 'service', provider: 'simulator', dependsOn: ['app'], spec: { kind: 'Service' } },
  ], relations: [
    { from: 'service', to: 'app', kind: 'communicatesWith' },
    { from: 'app', to: 'provider', kind: 'communicatesWith' },
    { from: 'provider', to: 'directory', kind: 'communicatesWith' },
  ] });
  return { revision: 0, busy: false, mode: 'simulator', graph };
}

function assertGeometry(nodes: Node[], sizes: Map<string, { width: number; height: number }>) {
  assert.equal(nodes.length, sizes.size);
  const expected = nodes.map(node => {
    const size = sizes.get(node.id)!;
    const bounds = { x: node.position.x, y: node.position.y, width: size.width, height: size.height };
    assert.deepEqual(getNodesBounds([node]), bounds, `${node.id} must have its declared geometry before DOM measurement`);
    assert.ok(bounds.width > 0 && bounds.height > 0);
    return bounds;
  });
  const x = Math.min(...expected.map(bounds => bounds.x));
  const y = Math.min(...expected.map(bounds => bounds.y));
  assert.deepEqual(getNodesBounds(nodes), {
    x, y,
    width: Math.max(...expected.map(bounds => bounds.x + bounds.width)) - x,
    height: Math.max(...expected.map(bounds => bounds.y + bounds.height)) - y,
  });
  assert.ok(getNodesBounds(nodes).height >= Math.min(...expected.map(bounds => bounds.height)));
}

function assertEdgePositions(nodes: Node[], edges: Edge[], kind: 'deployment-step' | 'resource') {
  const lookup = new Map<string, InternalNodeBase>();
  const parents: ParentLookup = new Map();
  for (const snapshot of [nodes, structuredClone(nodes)]) {
    // The second adoption reproduces a controlled recording snapshot replacing its nodes.
    adoptUserNodes(snapshot, lookup, parents);
    for (const edge of edges) {
      const source = lookup.get(edge.source)!, target = lookup.get(edge.target)!;
      const position = getEdgePosition({ id: edge.id, sourceNode: source, targetNode: target,
        sourceHandle: edge.sourceHandle ?? null, targetHandle: edge.targetHandle ?? null, connectionMode: ConnectionMode.Strict });
      assert.ok(position, `${edge.id} must render before DOM measurement and after a recording update`);
      const expected = (node: Node, type: 'source' | 'target', handle?: string | null) => {
        const halfPort = kind === 'deployment-step' ? 4 : 3;
        if (handle?.startsWith('communication-')) return {
          x: node.position.x + node.width! * (type === 'source' ? COMMUNICATION_SOURCE_OFFSET : COMMUNICATION_TARGET_OFFSET),
          y: node.position.y + node.height! + halfPort,
        };
        return { x: node.position.x + (type === 'source' ? node.width! + halfPort : -halfPort), y: node.position.y + node.height! / 2 };
      };
      const from = expected(source, 'source', edge.sourceHandle), to = expected(target, 'target', edge.targetHandle);
      assert.deepEqual({ x: position.sourceX, y: position.sourceY }, from);
      assert.deepEqual({ x: position.targetX, y: position.targetY }, to);
    }
  }
}

function assertViews(state: DashboardState) {
  const deployment = buildDeploymentFlowView(state, 'app');
  assertGeometry(deployment.nodes, new Map(state.graph!.resources.map(resource => [resource.id, { width: STEP_WIDTH, height: STEP_HEIGHT }])));
  assert.ok(deployment.edges.length > 0);
  assertEdgePositions(deployment.nodes, deployment.edges, 'deployment-step');
  for (const mode of ['deployment', 'running-system'] as const) {
    const rendered = buildResourceView(state, 'app', mode);
    const declared = layoutResources(state, mode);
    assertGeometry(rendered.nodes, new Map(declared.nodes.map(node => [node.id, node.size])));
    assert.ok(rendered.edges.length > 0);
    assertEdgePositions(rendered.nodes, rendered.edges, 'resource');
  }
}

async function recorded(t: { after(fn: () => Promise<void>): void }) {
  const directory = await mkdtemp(join(tmpdir(), 'iac-render-geometry-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const initial = pending(), recorder = createDeploymentRecorder(), states: DashboardState[] = [];
  let chart: DeploymentChart | undefined;
  let revision = 0;
  function capture(status: 'running' | 'passed' = 'running'): DashboardState {
    const snapshot = recorder.getSnapshot();
    return {
      ...initial, revision: ++revision, busy: status === 'running',
      run: { id: snapshot.runId ?? chart?.runId ?? '', status,
        ...(chart && { chart }), events: [...snapshot.events],
        resources: initial.graph!.resources.map(resource => ({
          ...(snapshot.resources[resource.id] ?? { resourceId: resource.id, status: 'pending' }), id: resource.id,
        })),
      },
    };
  }
  const stopChart = recorder.subscribeChart(value => { chart = value; states.push(capture()); });
  const stopProgress = recorder.subscribe(() => states.push(capture()));
  const engine = new InfraEngine({ adapters: [new SimulatorAdapter()], store: new FileStateStore(join(directory, 'state')),
    recorders: [recorder], chartObservers: [recorder], maxConcurrency: 2 });
  try {
    const result = await engine.apply(initial.graph!);
    assert.equal(result.ok, true);
  } finally { stopChart(); stopProgress(); }
  const ready = capture('passed');
  states.push(ready);
  return { initial, ready, states };
}

test('initial deployment and running-system nodes and edges resolve before measurement', () => {
  assertViews(pending());
});

test('completed native recordings keep declared nonzero bounds and connected edge ports', async t => {
  const { ready } = await recorded(t);
  assert.equal(buildDeploymentFlowView(ready).flow.layoutSource, 'native-chart');
  assert.ok(ready.run!.resources.every(resource => resource.status === 'ready'));
  assertViews(ready);
});

test('successive streamed native chart and progress snapshots preserve node and edge geometry', async t => {
  const { initial, states } = await recorded(t);
  let stream!: StreamCallbacks;
  const received: DashboardState[] = [], errors: Error[] = [];
  const client = createDashboardClient({
    fetch: async () => ({ ok: true, status: 200, json: async () => initial }),
    openStream(_url, callbacks) { stream = callbacks; return () => {}; },
  });
  const close = client.subscribe({
    state(state) { assertViews(state); received.push(state); },
    error(error) { errors.push(error); },
  });
  try {
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(received.length, 1);
    for (const state of states) stream.state(JSON.stringify(state));
    if (errors.length) throw errors[0];
    assert.equal(received.length, states.length + 1);
    assert.ok(received.some(state => state.run?.chart && state.run.events.length === 0), 'the native chart arrives before its first progress event');
    assert.ok(received.some(state => state.run?.resources.some(resource => resource.status === 'deploying')));
    assert.equal(received.at(-1)!.run!.status, 'passed');
  } finally { close(); }
});
