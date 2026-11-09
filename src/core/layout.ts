import type { Resource } from 'footprint-iac';
import { describeResource, resourceProgress, type ResourceDescription } from './model.ts';
import type { DashboardState, ResourceProgress } from './types.ts';
import { communicationRoute, orderRoute, RESOURCE_WIDTH, resourceColumnGap, resourceSize, type ResourceBox, type ResourceEdgeRoute } from './resource-geometry.ts';
import { connectionProgress, CONNECTION_COLORS, CONNECTION_LABELS } from './connections.ts';
import type { ConnectionStatus } from './types.ts';

export { resourceEdgePath } from './resource-geometry.ts';
export type { LayoutPoint, ResourceEdgeRoute } from './resource-geometry.ts';

export interface ResourceNodeView extends ResourceBox {
  id: string;
  resource: Resource;
  description: ResourceDescription;
  progress: ResourceProgress;
}
export interface ResourceEdgeView { id: string; source: string; target: string; kind: 'order' | 'communication'; color: string; active: boolean; route: ResourceEdgeRoute; connectionStatus?: ConnectionStatus; label?: string }

/** Pure layout shared by renderers; no DOM, React, graph library or provider calls. */
export function layoutResources(state: DashboardState): { nodes: ResourceNodeView[]; edges: ResourceEdgeView[] } {
  const resources = state.graph?.resources ?? [];
  const byId = new Map(resources.map(resource => [resource.id, resource]));
  const levels = new Map<string, number>();
  const visiting = new Set<string>();
  function level(id: string): number {
    if (levels.has(id)) return levels.get(id)!;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const dependencies = byId.get(id)?.dependsOn?.filter(parent => byId.has(parent)) ?? [];
    const result = dependencies.length ? 1 + Math.max(...dependencies.map(level)) : 0;
    visiting.delete(id); levels.set(id, result); return result;
  }
  for (const resource of resources) level(resource.id);
  const columns = new Map<number, Resource[]>();
  for (const resource of resources) {
    const column = levels.get(resource.id) ?? 0;
    columns.set(column, [...(columns.get(column) ?? []), resource]);
  }
  const descriptions = new Map(resources.map(resource => [resource.id, describeResource(state, resource)]));
  const sizes = new Map(resources.map(resource => [resource.id, resourceSize(descriptions.get(resource.id)!)]));
  const columnHeight = (siblings: Resource[]) => siblings.reduce((height, resource) => height + sizes.get(resource.id)!.height, 0) + Math.max(0, siblings.length - 1) * 64;
  const tallestColumn = Math.max(0, ...[...columns.values()].map(columnHeight));
  const columnCount = Math.max(0, ...levels.values()) + 1;
  const columnStep = RESOURCE_WIDTH + resourceColumnGap(columnCount);
  const nodes: ResourceNodeView[] = resources.map(resource => {
    const column = levels.get(resource.id) ?? 0;
    const siblings = columns.get(column)!;
    const row = siblings.findIndex(sibling => sibling.id === resource.id);
    const precedingHeight = siblings.slice(0, row).reduce((height, sibling) => height + sizes.get(sibling.id)!.height + 64, 0);
    return { id: resource.id, position: { x: column * columnStep + 32, y: precedingHeight + (tallestColumn - columnHeight(siblings)) / 2 + 25 },
      size: sizes.get(resource.id)!, resource, description: descriptions.get(resource.id)!, progress: resourceProgress(state, resource.id) };
  });
  const nodeById = new Map(nodes.map(node => [node.id, node]));
  const edges: ResourceEdgeView[] = [];
  for (const resource of resources) for (const parent of resource.dependsOn ?? []) {
    if (!byId.has(parent)) continue;
    const status = resourceProgress(state, resource.id).status;
    const color = status === 'failed' ? '#d15454' : status === 'deploying' ? '#5188dd' : status === 'ready' ? '#4d9b7b' : '#bdc7d2';
    edges.push({ id: `order:${parent}:${resource.id}`, source: parent, target: resource.id, kind: 'order', active: status === 'deploying', color,
      route: orderRoute(nodeById.get(parent)!, nodeById.get(resource.id)!) });
  }
  const bottom = Math.max(0, ...nodes.map(node => node.position.y + node.size.height));
  let communicationLane = 0;
  for (const [index, relation] of (state.graph?.relations ?? []).entries()) {
    if (relation.kind !== 'communicatesWith' || !byId.has(relation.from) || !byId.has(relation.to)) continue;
    const progress = connectionProgress(state, `communication:${index}`, relation.from, relation.to);
    edges.push({ id: `communication:${index}`, source: relation.from, target: relation.to, kind: 'communication',
      connectionStatus: progress.status, label: `communicates · ${CONNECTION_LABELS[progress.status]}`,
      active: progress.status === 'checking', color: CONNECTION_COLORS[progress.status],
      route: communicationRoute(nodeById.get(relation.from)!, nodeById.get(relation.to)!, bottom + 64 + communicationLane++ * 34) });
  }
  return { nodes, edges };
}
