import type { Resource } from 'footprint-iac';
import { describeResource, resourceProgress, type ResourceDescription } from './model.ts';
import type { DashboardState, ResourceProgress } from './types.ts';

export interface ResourceNodeView {
  id: string;
  position: { x: number; y: number };
  resource: Resource;
  description: ResourceDescription;
  progress: ResourceProgress;
}
export interface ResourceEdgeView { id: string; source: string; target: string; kind: 'order' | 'communication'; color: string; active: boolean }

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
  const maxRows = Math.max(1, ...[...columns.values()].map(column => column.length));
  const nodes = resources.map(resource => {
    const column = levels.get(resource.id) ?? 0;
    const siblings = columns.get(column)!;
    const row = siblings.findIndex(sibling => sibling.id === resource.id);
    return { id: resource.id, position: { x: column * 220 + 20, y: row * 160 + (maxRows - siblings.length) * 80 + 25 },
      resource, description: describeResource(state, resource), progress: resourceProgress(state, resource.id) };
  });
  const edges: ResourceEdgeView[] = [];
  for (const resource of resources) for (const parent of resource.dependsOn ?? []) {
    if (!byId.has(parent)) continue;
    const status = resourceProgress(state, resource.id).status;
    const color = status === 'failed' ? '#d15454' : status === 'deploying' ? '#5188dd' : status === 'ready' ? '#4d9b7b' : '#bdc7d2';
    edges.push({ id: `order:${parent}:${resource.id}`, source: parent, target: resource.id, kind: 'order', active: status === 'deploying', color });
  }
  for (const [index, relation] of (state.graph?.relations ?? []).entries()) {
    if (relation.kind !== 'communicatesWith' || !byId.has(relation.from) || !byId.has(relation.to)) continue;
    edges.push({ id: `communication:${index}`, source: relation.from, target: relation.to, kind: 'communication', active: false, color: '#a3b0c2' });
  }
  return { nodes, edges };
}
