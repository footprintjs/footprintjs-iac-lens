import type { SystemTopologyDefinition } from 'footprintjs-iac/system-topology';
import type { TopologyBox } from './topology-layout.ts';
import { routeTopologyConnection, type TopologyRoute } from './topology-routing.ts';

/** Geometry depends on the immutable graph, never on changing check outcomes. */
export function routeTopologyConnections(connections: SystemTopologyDefinition['connections'], boxes: ReadonlyMap<string, TopologyBox>): ReadonlyMap<string, TopologyRoute> {
  const routes = new Map<string, TopologyRoute>();
  for (const edge of connections) {
    const from = boxes.get(edge.from), to = boxes.get(edge.to);
    if (!from || !to) continue;
    const route = routeTopologyConnection(from, to, boxes, [...routes.values()], { label: edge.kind === 'communicatesWith' });
    routes.set(edge.id, edge.kind === 'dependsOn' ? { ...route, labelHidden: true } : route);
  }
  return routes;
}
