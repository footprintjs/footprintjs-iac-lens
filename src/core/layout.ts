import type { InfraGraph, Resource } from 'footprintjs-iac';
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
export type ResourceLayoutMode = 'deployment' | 'running-system';

/** Pure layout shared by renderers; no DOM, React, graph library or provider calls. */
export function layoutResources(state: DashboardState, mode: ResourceLayoutMode = 'deployment'): { nodes: ResourceNodeView[]; edges: ResourceEdgeView[] } {
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
  if (mode === 'running-system') {
    for (const [id, column] of communicationLevels(resources, state.graph?.relations ?? [])) levels.set(id, column);
  } else for (const resource of resources) level(resource.id);
  const primary = resources.filter(resource => levels.has(resource.id));
  const contextual = resources.filter(resource => !levels.has(resource.id)).sort((a, b) => a.id.localeCompare(b.id));
  const columns = new Map<number, Resource[]>();
  for (const resource of primary) {
    const column = levels.get(resource.id) ?? 0;
    columns.set(column, [...(columns.get(column) ?? []), resource]);
  }
  if (mode === 'running-system') for (const column of columns.values()) column.sort((a, b) => a.id.localeCompare(b.id));
  const descriptions = new Map(resources.map(resource => [resource.id, describeResource(state, resource)]));
  const sizes = new Map(resources.map(resource => [resource.id, resourceSize(descriptions.get(resource.id)!)]));
  const columnHeight = (siblings: Resource[]) => siblings.reduce((height, resource) => height + sizes.get(resource.id)!.height, 0) + Math.max(0, siblings.length - 1) * 64;
  const tallestColumn = Math.max(0, ...[...columns.values()].map(columnHeight));
  const columnCount = Math.max(0, ...levels.values()) + 1;
  const columnStep = RESOURCE_WIDTH + resourceColumnGap(columnCount);
  const positions = new Map(primary.map(resource => {
    const column = levels.get(resource.id) ?? 0;
    const siblings = columns.get(column)!;
    const row = siblings.findIndex(sibling => sibling.id === resource.id);
    const precedingHeight = siblings.slice(0, row).reduce((height, sibling) => height + sizes.get(sibling.id)!.height + 64, 0);
    return [resource.id, { x: column * columnStep + 32, y: precedingHeight + (tallestColumn - columnHeight(siblings)) / 2 + 25 }] as const;
  }));
  const primaryBottom = Math.max(0, ...primary.map(resource => positions.get(resource.id)!.y + sizes.get(resource.id)!.height));
  const communications = (state.graph?.relations ?? []).filter(relation => relation.kind === 'communicatesWith'
    && byId.has(relation.from) && byId.has(relation.to));
  let contextTop = primaryBottom + 64 + Math.max(0, communications.length - 1) * 34 + 48;
  for (let index = 0; index < contextual.length; index += columnCount) {
    const row = contextual.slice(index, index + columnCount);
    for (const [column, resource] of row.entries()) positions.set(resource.id, { x: column * columnStep + 32, y: contextTop });
    contextTop += Math.max(...row.map(resource => sizes.get(resource.id)!.height)) + 48;
  }
  const nodes: ResourceNodeView[] = resources.map(resource => ({
    id: resource.id, position: positions.get(resource.id)!, size: sizes.get(resource.id)!, resource,
    description: descriptions.get(resource.id)!, progress: resourceProgress(state, resource.id),
  }));
  const nodeById = new Map(nodes.map(node => [node.id, node]));
  const edges: ResourceEdgeView[] = [];
  for (const resource of mode === 'deployment' ? resources : []) for (const parent of resource.dependsOn ?? []) {
    if (!byId.has(parent)) continue;
    const status = resourceProgress(state, resource.id).status;
    const color = status === 'failed' ? '#d15454' : status === 'deploying' ? '#5188dd' : status === 'ready' ? '#4d9b7b' : '#bdc7d2';
    edges.push({ id: `order:${parent}:${resource.id}`, source: parent, target: resource.id, kind: 'order', active: status === 'deploying', color,
      route: orderRoute(nodeById.get(parent)!, nodeById.get(resource.id)!) });
  }
  let communicationLane = 0;
  for (const [index, relation] of (state.graph?.relations ?? []).entries()) {
    if (relation.kind !== 'communicatesWith' || !byId.has(relation.from) || !byId.has(relation.to)) continue;
    const progress = connectionProgress(state, `communication:${index}`, relation.from, relation.to);
    edges.push({ id: `communication:${index}`, source: relation.from, target: relation.to, kind: 'communication',
      connectionStatus: progress.status, label: `communicates · ${CONNECTION_LABELS[progress.status]}`,
      active: progress.status === 'checking', color: CONNECTION_COLORS[progress.status],
      route: communicationRoute(nodeById.get(relation.from)!, nodeById.get(relation.to)!, primaryBottom + 64 + communicationLane++ * 34) });
  }
  return { nodes, edges };
}

/** Communication neighbours establish spatial ranks independently of deployment prerequisites. */
function communicationLevels(resources: readonly Resource[], relations: InfraGraph['relations']): Map<string, number> {
  const neighbours = new Map(resources.map(resource => [resource.id, new Set<string>()]));
  const incoming = new Set<string>();
  for (const relation of relations) {
    if (relation.kind !== 'communicatesWith' || !neighbours.has(relation.from) || !neighbours.has(relation.to)) continue;
    neighbours.get(relation.from)!.add(relation.to);
    neighbours.get(relation.to)!.add(relation.from);
    incoming.add(relation.to);
  }
  const ids = [...neighbours.keys()].sort(), levels = new Map<string, number>();
  const connected = ids.filter(id => neighbours.get(id)!.size > 0);
  const roots = [...connected.filter(id => !incoming.has(id)), ...connected];
  for (const root of roots) {
    if (levels.has(root)) continue;
    levels.set(root, 0);
    const pending = [root];
    for (let index = 0; index < pending.length; index++) {
      const id = pending[index]!;
      for (const neighbour of [...neighbours.get(id)!].sort()) {
        if (levels.has(neighbour)) continue;
        levels.set(neighbour, levels.get(id)! + 1);
        pending.push(neighbour);
      }
    }
  }
  if (!connected.length) for (const [index, id] of ids.entries()) levels.set(id, index % 3);
  return levels;
}
