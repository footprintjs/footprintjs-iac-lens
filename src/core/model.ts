import type { Resource } from 'footprintjs-iac';
import type { DashboardState, ResourceProgress, ResourceStatus } from './types.ts';
import { workspaceResourceProgress } from './resource-flow-workspace.ts';

export const STATUS_LABELS: Record<ResourceStatus, string> = {
  pending: 'Pending', deploying: 'Deploying', ready: 'Ready', failed: 'Failed', skipped: 'Skipped', deleted: 'Deleted',
};
export type ResourceFamily = 'compute' | 'storage' | 'network';
export interface ResourceDescription { name: string; kind: string; family: ResourceFamily; capability?: string; boundaries: string[] }
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const familyValue = (value: unknown): ResourceFamily | undefined => value === 'compute' || value === 'storage' || value === 'network' ? value : undefined;

export function resourceProgress(state: DashboardState, resourceId: string): ResourceProgress {
  if (state.resourceFlowWorkspace) return workspaceResourceProgress(state, resourceId) ?? { id: resourceId, status: 'pending' };
  return state.run?.resources.find(resource => (resource.resourceId ?? resource.id) === resourceId)
    ?? { id: resourceId, status: 'pending' };
}
export function statusCounts(state: DashboardState): Record<ResourceStatus, number> {
  const counts: Record<ResourceStatus, number> = { pending: 0, deploying: 0, ready: 0, failed: 0, skipped: 0, deleted: 0 };
  for (const resource of state.graph?.resources ?? []) counts[resourceProgress(state, resource.id).status]++;
  return counts;
}
/** Capability counts stay logical; a raw resource graph falls back to resource families. */
export function familyCounts(state: DashboardState): Record<ResourceFamily, number> {
  const counts: Record<ResourceFamily, number> = { compute: 0, storage: 0, network: 0 };
  if (state.design) for (const capability of state.design.capabilities) counts[capability.family]++;
  else for (const resource of state.graph?.resources ?? []) counts[describeResource(state, resource).family]++;
  return counts;
}
export function eventTime(timestamp?: string | number): string {
  if (timestamp === undefined) return '—';
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
export function localAppUrl(value?: string): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
      ? url.href : undefined;
  } catch { return undefined; }
}
export function describeResource(state: DashboardState, resource: Resource): ResourceDescription {
  const group = state.graph?.memberships.filter(m => m.resourceId === resource.id)
    .map(m => state.graph?.boundaries.find(b => b.id === m.boundaryId)).find(b => b?.attributes?.origin === 'capability');
  const bindingMatches = state.design && state.binding?.designDigest === state.design.digest
    && state.binding.graph.digest === state.graph?.digest;
  const mapping = bindingMatches ? state.binding?.mappings.find(m => m.resourceIds.includes(resource.id)) : undefined;
  const metadata = object(resource.spec.metadata);
  const kind = String(resource.spec.kind ?? resource.spec.Type ?? 'Resource');
  const family = familyValue(group?.attributes?.capabilityFamily) ?? familyValue(resource.spec.family)
    ?? (/store|database|bucket|volume/i.test(kind) ? 'storage' : /network|namespace|service|configmap/i.test(kind) ? 'network' : 'compute');
  return {
    name: typeof metadata.name === 'string' ? metadata.name : resource.id, kind, family,
    capability: mapping?.capabilityPath ?? (typeof group?.attributes?.capabilityPath === 'string' ? group.attributes.capabilityPath : undefined),
    boundaries: state.graph?.memberships.filter(m => m.resourceId === resource.id).map(m => state.graph?.boundaries.find(b => b.id === m.boundaryId))
      .filter(b => b && b.kind !== 'group').map(b => `${b!.kind}: ${b!.label ?? b!.id}`) ?? [],
  };
}
