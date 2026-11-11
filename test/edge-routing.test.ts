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

test('running-system layout follows communication topology independently of deployment prerequisites', () => {
  const input = neo(), before = structuredClone(input);
  const running = layoutResources(input, 'running-system');
  assert.deepEqual(running.nodes.map(node => node.id), input.graph!.resources.map(resource => resource.id));
  assert.ok(running.edges.length > 0);
  assert.ok(running.edges.every(edge => edge.kind === 'communication'));
  assert.deepEqual(running.edges.map(edge => [edge.source, edge.target, edge.connectionStatus]), [[ids.service, ids.deployment, 'untested']]);
  assert.ok(running.nodes.find(node => node.id === ids.service)!.position.x < running.nodes.find(node => node.id === ids.deployment)!.position.x,
    'the Service communicates with the Deployment even though their deployment prerequisite points the other way');
  input.graph!.resources = input.graph!.resources.map(resource => ({ ...resource, dependsOn: [] }));
  assert.deepEqual(layoutResources(input, 'running-system').nodes.map(node => [node.id, node.position]), running.nodes.map(node => [node.id, node.position]));
  assert.deepEqual(before.graph!.relations, input.graph!.relations);
  assert.ok(layoutResources(before).edges.some(edge => edge.kind === 'order'), 'existing layout callers retain dependency edges');
});

test('running-system layout retains isolated resources, handles communication cycles and keeps paths outside nodes', () => {
  const input = neo();
  input.graph!.relations.push({ from: ids.deployment, to: ids.service, kind: 'communicatesWith' });
  input.graph!.resources.push({ id: 'other', provider: 'kubernetes', spec: { kind: 'ConfigMap' } });
  const before = structuredClone(input), running = layoutResources(input, 'running-system');
  assert.equal(running.nodes.length, 4);
  assert.ok(running.nodes.every(node => Number.isFinite(node.position.x) && Number.isFinite(node.position.y)));
  assert.equal(running.edges.length, 2);
  for (const edge of running.edges) for (let index = 1; index < edge.route.points.length; index++) {
    for (const node of running.nodes) assert.equal(crossesInterior(edge.route.points[index - 1]!, edge.route.points[index]!, node), false);
  }
  const reversed = { ...input, graph: { ...input.graph!, resources: [...input.graph!.resources].reverse() } };
  assert.deepEqual(new Map(layoutResources(reversed, 'running-system').nodes.map(node => [node.id, node.position])),
    new Map(running.nodes.map(node => [node.id, node.position])));
  assert.deepEqual(input, before);
});

test('six-resource Neo keeps communication above a separate compact row of supporting resources', () => {
  const input = state([
    { id: 'identity-directory', provider: 'local-identity-fixture', spec: {} },
    { id: 'identity-provider', provider: 'local-identity-fixture', dependsOn: ['identity-directory'], spec: {} },
    { id: 'neo-namespace', provider: 'kubernetes', spec: { kind: 'Namespace', metadata: { name: 'footprint-iac-identity-a00c7859' } } },
    { id: 'neo-access-policy', provider: 'kubernetes', dependsOn: ['neo-namespace'], spec: { kind: 'ConfigMap', metadata: { name: 'neo-access-policy' } } },
    { id: 'neo-app', provider: 'kubernetes', dependsOn: ['neo-access-policy', 'identity-provider'], spec: { kind: 'Deployment', metadata: { name: 'neo' } } },
    { id: 'neo-service', provider: 'kubernetes', dependsOn: ['neo-app'], spec: { kind: 'Service', metadata: { name: 'neo' } } },
  ], [
    { from: 'identity-provider', to: 'identity-directory', kind: 'communicatesWith' },
    { from: 'neo-app', to: 'identity-provider', kind: 'communicatesWith' },
    { from: 'neo-service', to: 'neo-app', kind: 'communicatesWith' },
  ]);
  const view = layoutResources(input, 'running-system');
  const support = view.nodes.filter(node => ['neo-namespace', 'neo-access-policy'].includes(node.id));
  assert.equal(support[0]!.position.y, support[1]!.position.y);
  assert.notEqual(support[0]!.position.x, support[1]!.position.x);
  const routeBottom = Math.max(...view.edges.flatMap(edge => edge.route.points.map(point => point.y)));
  assert.ok(support.every(node => node.position.y >= routeBottom + 40));
  for (const edge of view.edges) for (let index = 1; index < edge.route.points.length; index++) {
    for (const node of view.nodes) assert.equal(crossesInterior(edge.route.points[index - 1]!, edge.route.points[index]!, node), false);
  }
  const width = Math.max(...view.nodes.map(node => node.position.x + node.size.width)) - Math.min(...view.nodes.map(node => node.position.x));
  const height = Math.max(...view.nodes.map(node => node.position.y + node.size.height)) - Math.min(...view.nodes.map(node => node.position.y));
  assert.ok(width <= 1100, `Neo width ${width} should fit without shrinking node labels`);
  assert.ok(height <= 540, `Neo height ${height} should fit a 510px canvas at readable zoom`);
  assert.ok(height * .8 + 50 <= 510, 'node bounds leave room for canvas padding at 0.8 zoom');
});
