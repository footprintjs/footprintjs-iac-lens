import assert from 'node:assert/strict';
import test from 'node:test';
import { defineSystemTopology, projectSystemTopology } from 'footprintjs-iac/system-topology/node';
import { layoutSystemTopology, type TopologyBox } from '../web/features/system-topology/topology-layout.ts';
import { routeTopologyConnections } from '../web/features/system-topology/topology-routes.ts';
import type { TopologyPoint, TopologyRoute } from '../web/features/system-topology/topology-routing.ts';
import { roundedPath } from '../web/features/system-topology/topology-route-geometry.ts';

interface Rect { x: number; y: number; width: number; height: number }
const labelRect = (route: TopologyRoute): Rect => ({ x: route.x - 36, y: route.y - 10, width: 72, height: 20 });
const overlaps = (a: Rect, b: Rect, gap = 0): boolean => a.x < b.x + b.width + gap && a.x + a.width > b.x - gap && a.y < b.y + b.height + gap && a.y + a.height > b.y - gap;
const pointDistance = (point: TopologyPoint, rect: Rect): number => Math.hypot(Math.max(rect.x - point.x, 0, point.x - rect.x - rect.width), Math.max(rect.y - point.y, 0, point.y - rect.y - rect.height));
function segmentIntersects(a: TopologyPoint, b: TopologyPoint, rect: Rect, pad = 0): boolean {
  return a.x === b.x
    ? a.x > rect.x - pad && a.x < rect.x + rect.width + pad && Math.max(a.y, b.y) > rect.y - pad && Math.min(a.y, b.y) < rect.y + rect.height + pad
    : a.y > rect.y - pad && a.y < rect.y + rect.height + pad && Math.max(a.x, b.x) > rect.x - pad && Math.min(a.x, b.x) < rect.x + rect.width + pad;
}
function neoTopology() {
  const definition = defineSystemTopology({
    id: 'neo-placement', label: 'Neo running system',
    boundaries: [
      { id: 'host', label: 'Existing Linux server', kind: 'server' },
      { id: 'runtime', label: 'systemd services', kind: 'runtime', parentId: 'host' },
      { id: 'directory', label: 'Separate company directory', kind: 'server' },
    ],
    nodes: [
      { id: 'api', label: 'Neo backend', category: 'compute', origin: 'existing', boundaryId: 'runtime', bindings: { resourceIds: ['services'] } },
      { id: 'tools', label: 'Python tools', category: 'compute', origin: 'existing', boundaryId: 'runtime', bindings: { resourceIds: ['services'] } },
      { id: 'sessions', label: 'Sessions and access grants', category: 'storage', origin: 'embedded', boundaryId: 'runtime', bindings: { resourceIds: [] } },
      { id: 'collectors', label: 'Collector databases', category: 'storage', origin: 'existing', boundaryId: 'host', bindings: { resourceIds: [] } },
      { id: 'fleet', label: 'Fleet manifest', category: 'storage', origin: 'existing', boundaryId: 'host', bindings: { resourceIds: [] } },
      { id: 'endpoint', label: 'HTTP endpoints', category: 'network', origin: 'existing', boundaryId: 'host', bindings: { resourceIds: [] } },
      { id: 'identity', label: 'Directory sign-in', category: 'identity', origin: 'existing', boundaryId: 'directory', bindings: { resourceIds: [] } },
    ],
    connections: [
      { id: 'http-api', from: 'endpoint', to: 'api', kind: 'communicatesWith' },
      { id: 'http-tools', from: 'endpoint', to: 'tools', kind: 'communicatesWith' },
      { id: 'tools-collectors', from: 'tools', to: 'collectors', kind: 'communicatesWith' },
      { id: 'api-identity', from: 'api', to: 'identity', kind: 'communicatesWith' },
      { id: 'api-sessions', from: 'api', to: 'sessions', kind: 'dependsOn' },
      { id: 'api-fleet', from: 'api', to: 'fleet', kind: 'communicatesWith' },
    ],
  }, { targetId: 'neo-office', graphDigest: 'b'.repeat(64) });
  return projectSystemTopology(definition, { targetId: 'neo-office', graphDigest: definition.binding.graphDigest, definitionDigest: definition.digest, configurationDigest: 'c'.repeat(64), resources: [], components: [], checks: [] });
}

test('Neo running-system connections have dedicated corridors while preserving readable laptop-sized cards', () => {
  const view = neoTopology(), geometry = layoutSystemTopology(view);
  assert(geometry.width <= 1020, `graph width ${geometry.width} fits the laptop canvas`);
  assert(geometry.height <= 400, `graph height ${geometry.height} fits the laptop canvas`);
  assert.equal(geometry.boxes.filter(box => box.kind === 'node').length, 7);
  for (const box of geometry.boxes.filter(box => box.kind === 'node')) assert.deepEqual([box.width, box.height], [184, 104], `${box.id} keeps full-size text`);
  const boxes = new Map(geometry.boxes.map(box => [box.id, box])), routes = routeTopologyConnections(view.definition.connections, boxes);
  assert.equal(routes.size, 6);
  const obstacles = geometry.boxes.map(box => ({ ...box, height: box.kind === 'boundary' ? 28 : box.height }));
  const attachments = new Map<string, TopologyPoint[]>();
  for (const edge of view.definition.connections) {
    const route = routes.get(edge.id)!;
    assert(route?.path, `${edge.id} is drawn`);
    assert(route.points.length >= 2, `${edge.id} retains its actual route geometry`);
    if (route.points.length > 2) assert.match(route.path, /Q/, `${edge.id} softens its corners`);
    for (let index = 1; index < route.points.length; index++) {
      const a = route.points[index - 1]!, b = route.points[index]!;
      assert(a.x === b.x || a.y === b.y, `${edge.id} follows orthogonal corridors`);
      for (const obstacle of obstacles) assert(!segmentIntersects(a, b, obstacle), `${edge.id} stays outside ${obstacle.id}`);
    }
    for (const point of route.points) assert(point.x >= 0 && point.y >= 0 && point.x <= geometry.width && point.y <= geometry.height, `${edge.id} is not clipped`);
    for (const [id, point] of [[edge.from, route.points[0]!], [edge.to, route.points.at(-1)!]] as const) {
      for (const other of attachments.get(id) ?? []) assert(Math.hypot(point.x - other.x, point.y - other.y) >= 12, `${id} has distinct connection ports`);
      attachments.set(id, [...attachments.get(id) ?? [], point]);
    }
    const tip = route.points.at(-1)!, approach = route.points.at(-2)!;
    assert(Math.hypot(tip.x - approach.x, tip.y - approach.y) >= 12, `${edge.id} leaves room for its arrowhead`);
  }
  const labelled = view.definition.connections.filter(edge => edge.kind === 'communicatesWith');
  for (const edge of labelled) {
    const route = routes.get(edge.id)!;
    assert(!route.labelHidden, `${edge.id} has a visible live-check badge`);
    const label = labelRect(route);
    for (const obstacle of obstacles) assert(!overlaps(label, obstacle, 2), `${edge.id} badge clears ${obstacle.id}`);
    for (const point of route.points) assert(pointDistance(point, label) >= 8, `${edge.id} badge leaves space around bends and arrowheads`);
    for (const other of labelled) if (other.id !== edge.id) {
      const otherRoute = routes.get(other.id)!;
      assert(!overlaps(label, labelRect(otherRoute), 2), `${edge.id} and ${other.id} badges stay separate`);
    }
    for (const [otherId, otherRoute] of routes) if (otherId !== edge.id) {
      for (let index = 1; index < otherRoute.points.length; index++) assert(!segmentIntersects(otherRoute.points[index - 1]!, otherRoute.points[index]!, label, 2), `${edge.id} badge never covers ${otherId}`);
    }
  }
});

test('recorded connection status changes preserve the layout and never reshuffle a users mental map', () => {
  const view = neoTopology(), geometry = layoutSystemTopology(view), boxes = new Map(geometry.boxes.map(box => [box.id, box]));
  const expected = [...routeTopologyConnections(view.definition.connections, boxes)];
  for (const status of ['untested', 'checking', 'connected', 'failed', 'unknown', 'incomplete'] as const) {
    const observed = view.connections.map(edge => ({ ...edge, status }));
    assert.deepEqual([...routeTopologyConnections(observed, boxes)], expected, `${status} updates only the observed state`);
  }
});

test('a two-way connection and fan-out retain distinct attachment points instead of merging arrowheads', () => {
  const box = (id: string, x: number, y: number): TopologyBox => ({ id, x, y, kind: 'node', width: 184, height: 104, depth: 0 });
  const boxes = new Map([box('application', 20, 20), box('database', 320, 20), box('directory', 320, 224)].map(row => [row.id, row]));
  const connections = [
    { id: 'write', from: 'application', to: 'database', kind: 'communicatesWith' as const },
    { id: 'response', from: 'database', to: 'application', kind: 'communicatesWith' as const },
    { id: 'sign-in', from: 'application', to: 'directory', kind: 'communicatesWith' as const },
  ];
  const routes = routeTopologyConnections(connections, boxes), ports = [routes.get('write')!.points[0]!, routes.get('response')!.points.at(-1)!, routes.get('sign-in')!.points[0]!];
  for (const [index, point] of ports.entries()) for (const other of ports.slice(index + 1)) assert(Math.hypot(point.x - other.x, point.y - other.y) >= 12, 'each arrow has an independent attachment');
  for (const connection of connections) assert(routes.get(connection.id)?.path, `${connection.id} remains visible`);
  assert.notEqual(routes.get('write')!.path, routes.get('response')!.path);
  assert.deepEqual([...routeTopologyConnections(connections, boxes)], [...routes], 'unchanged definitions route deterministically');
});

test('rounded corners retain enough rendered straight approach for an arrow on a short terminal stub', () => {
  const points = [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 40 }, { x: 80, y: 40 }, { x: 80, y: 52 }];
  const path = roundedPath(points);
  const commands = [...path.matchAll(/([MLQ]) ([\d.-]+) ([\d.-]+)(?: ([\d.-]+) ([\d.-]+))?/g)];
  const approach = commands.at(-2)!, tip = commands.at(-1)!;
  assert.equal(approach[1], 'Q'); assert.equal(tip[1], 'L');
  const straightLength = Math.hypot(Number(tip[2]) - Number(approach[4]), Number(tip[3]) - Number(approach[5]));
  assert(straightLength >= 10, `rendered ${straightLength}px approach clears the 8px arrowhead`);
  assert(straightLength <= 12, 'the terminal remains attached to its original 12px port stub');
  const firstCurveIndex = commands.findIndex(command => command[1] === 'Q'), firstCurve = commands[firstCurveIndex]!, entry = commands[firstCurveIndex - 1]!;
  assert.equal(Math.hypot(Number(firstCurve[2]) - Number(entry[2]), Number(firstCurve[3]) - Number(entry[3])), 6, 'ordinary corners retain their 6px radius');
  assert.equal(Math.hypot(Number(firstCurve[4]) - Number(firstCurve[2]), Number(firstCurve[5]) - Number(firstCurve[3])), 6);
});
