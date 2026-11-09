import assert from 'node:assert/strict';
import test from 'node:test';
import type { InfraGraph, Resource } from 'footprint-iac';
import { layoutResources, resourceEdgePath, type LayoutPoint, type ResourceNodeView } from '../src/core/layout.ts';
import type { DashboardState } from '../src/core/types.ts';
import { demoGraph } from '../src/server/graphs.ts';

function state(resources: Resource[], relations: InfraGraph['relations'] = []): DashboardState {
  return { revision: 0, busy: false, graph: { kind: 'infra-graph', version: 1, name: 'routing', digest: 'd'.repeat(64), boundaries: [], memberships: [], resources, relations } };
}

const ids = {
  namespace: 'kubernetes:namespace:neo-agentfootprint-recording',
  deployment: 'kubernetes:deployment:neo-agentfootprint-recording:neo-agentfootprint',
  service: 'kubernetes:service:neo-agentfootprint-recording:neo-agentfootprint',
};

function neo(): DashboardState {
  return state([
    { id: ids.namespace, provider: 'kubernetes', spec: { kind: 'Namespace', metadata: { name: 'neo-recording' } } },
    { id: ids.deployment, provider: 'kubernetes', dependsOn: [ids.namespace], spec: { kind: 'Deployment', metadata: { name: 'neo-agentfootprint' } } },
    { id: ids.service, provider: 'kubernetes', dependsOn: [ids.deployment], spec: { kind: 'Service', metadata: { name: 'neo-agentfootprint' } } },
  ], [{ from: ids.service, to: ids.deployment, kind: 'communicatesWith' }]);
}

function crossesInterior(start: LayoutPoint, end: LayoutPoint, node: ResourceNodeView): boolean {
  const left = node.position.x, top = node.position.y;
  const right = left + node.size.width, bottom = top + node.size.height;
  if (start.x === end.x) return start.x > left && start.x < right && Math.max(start.y, end.y) > top && Math.min(start.y, end.y) < bottom;
  assert.equal(start.y, end.y, 'routes contain only orthogonal segments');
  return start.y > top && start.y < bottom && Math.max(start.x, end.x) > left && Math.min(start.x, end.x) < right;
}

test('Neo dependencies have breathing room and communication returns below the graph on separate handles', () => {
  const input = neo();
  const view = layoutResources(input);
  const [namespace, deployment, service] = view.nodes;
  assert.ok(namespace && deployment && service);
  assert.ok(deployment.position.x - namespace.position.x - namespace.size.width >= 90);
  assert.ok(service.position.x - deployment.position.x - deployment.size.width >= 90);
  assert.deepEqual(view.nodes.map(node => node.id), Object.values(ids));
  assert.deepEqual(view.edges.filter(edge => edge.kind === 'order').map(edge => [edge.source, edge.target]), [
    [ids.namespace, ids.deployment], [ids.deployment, ids.service],
  ], 'descriptive communication must never introduce a deployment dependency');
  const communication = view.edges.find(edge => edge.kind === 'communication')!;
  const deploymentOrder = view.edges.find(edge => edge.source === ids.deployment && edge.kind === 'order')!;
  assert.equal(communication.source, ids.service);
  assert.equal(communication.target, ids.deployment);
  assert.notEqual(communication.route.sourceHandle, deploymentOrder.route.sourceHandle);
  assert.notEqual(communication.route.targetHandle, deploymentOrder.route.targetHandle);
  assert.ok(communication.route.labelPosition!.y >= Math.max(...view.nodes.map(node => node.position.y + node.size.height)) + 60);
  for (let index = 1; index < communication.route.points.length; index++) {
    for (const node of view.nodes) assert.equal(crossesInterior(communication.route.points[index - 1]!, communication.route.points[index]!, node), false, `communication crosses ${node.id}`);
  }
});

test('wrapped names reserve height, rows remain clear, and external corridors avoid intervening nodes', () => {
  const input = neo();
  const top = input.graph!.resources[0]!;
  top.spec.metadata = { name: 'namespace-with-a-long-name-that-needs-several-lines' };
  input.graph!.resources.push({ id: 'second-namespace', provider: 'kubernetes', spec: { kind: 'Namespace', metadata: { name: 'second' } } });
  input.graph!.relations.push({ from: top.id, to: ids.service, kind: 'communicatesWith' });
  const view = layoutResources(input);
  const first = view.nodes.find(node => node.id === top.id)!;
  const second = view.nodes.find(node => node.id === 'second-namespace')!;
  assert.ok(first.size.height > second.size.height, 'full wrapped names need more room');
  assert.ok(second.position.y - first.position.y - first.size.height >= 60);
  const labels = view.edges.filter(edge => edge.kind === 'communication').map(edge => edge.route.labelPosition!);
  assert.ok(Math.abs(labels[0]!.y - labels[1]!.y) >= 30, 'separate communication lanes also separate their labels');
  for (const edge of view.edges.filter(edge => edge.kind === 'communication')) {
    for (let index = 1; index < edge.route.points.length; index++) {
      for (const node of view.nodes) assert.equal(crossesInterior(edge.route.points[index - 1]!, edge.route.points[index]!, node), false);
    }
  }
});

test('the seven-resource demo stays compact across five ranks without shrinking labels in the model', () => {
  const view = layoutResources({ revision: 0, busy: false, graph: demoGraph() });
  assert.equal(view.nodes.length, 7);
  assert.equal(new Set(view.nodes.map(node => node.position.x)).size, 5);
  const width = Math.max(...view.nodes.map(node => node.position.x + node.size.width)) - Math.min(...view.nodes.map(node => node.position.x));
  assert.ok(width <= 1220, 'the multi-rank graph uses a narrower gap than the three-resource graph');
  const ranks = [...new Set(view.nodes.map(node => node.position.x))].sort((left, right) => left - right);
  assert.ok(ranks[1]! - ranks[0]! - view.nodes[0]!.size.width >= 48, 'compact graphs still leave room around arrows');
});

test('SVG paths remain finite for aligned, coincident and empty geometry', () => {
  assert.equal(resourceEdgePath([]), '');
  for (const points of [[{ x: 2, y: 3 }, { x: 2, y: 3 }], [{ x: 2, y: 3 }, { x: 6, y: 3 }, { x: 10, y: 3 }]]) {
    const path = resourceEdgePath(points);
    assert.ok(path.startsWith('M '));
    assert.doesNotMatch(path, /NaN|Infinity|undefined/);
  }
});
