import type { DashboardState, ResourceStatus } from './types.ts';
import { describeResource, resourceProgress } from './model.ts';

export type SystemBlockFamily = 'compute' | 'storage' | 'network' | 'identity' | 'other';
export type SystemUnitMode = 'managed' | 'embedded' | 'existing';
export type SystemBlockStatus = ResourceStatus | 'existing' | 'unmapped';
export interface SystemUnitDefinition {
  readonly id: string; readonly label: string; readonly resourceIds: readonly string[];
  readonly mode?: SystemUnitMode; readonly description?: string;
}
export interface SystemBlockDefinition {
  readonly id: string; readonly label: string; readonly family: SystemBlockFamily;
  readonly description?: string; readonly units: readonly SystemUnitDefinition[];
}
export interface SystemViewDefinition { readonly blocks: readonly SystemBlockDefinition[] }
export interface SystemUnitView extends SystemUnitDefinition {
  readonly mode: SystemUnitMode; readonly status: SystemBlockStatus;
  readonly resources: readonly { id: string; name: string; kind: string; status: ResourceStatus; action?: string }[];
  readonly unmappedResourceIds: readonly string[];
}
export interface SystemBlockCounts {
  total: number; ready: number; deploying: number; pending: number; failed: number;
  skipped: number; deleted: number; unmapped: number; existing: number;
}
export interface SystemBlockView extends Omit<SystemBlockDefinition, 'units'> {
  readonly status: SystemBlockStatus; readonly units: readonly SystemUnitView[]; readonly counts: SystemBlockCounts;
}

export function readSystemViewDefinition(value: unknown): SystemViewDefinition {
  const top = dataObject(value, ['blocks'], 'system view');
  const ids = new Set<string>();
  const blocks = dataArray(top.blocks, 64, 'system blocks').map(value => {
    const block = dataObject(value, ['id', 'label', 'family', 'description', 'units'], 'system block');
    const id = text(block.id, 1024, 'system block ID');
    if (ids.has(id)) throw Error('Duplicate system block ID'); ids.add(id);
    if (typeof block.family !== 'string' || !['compute', 'storage', 'network', 'identity', 'other'].includes(block.family)) throw Error('Unknown system block family');
    const units = new Set<string>();
    return { id, label: text(block.label, 1024, 'system block label'), family: block.family as SystemBlockFamily,
      ...(block.description !== undefined && { description: text(block.description, 1500, 'system block description') }),
      units: dataArray(block.units, 512, 'system units').map(value => {
        const unit = dataObject(value, ['id', 'label', 'resourceIds', 'mode', 'description'], 'system unit');
        const unitId = text(unit.id, 1024, 'system unit ID');
        if (units.has(unitId)) throw Error('Duplicate system unit ID'); units.add(unitId);
        const mode = unit.mode ?? 'managed';
        if (typeof mode !== 'string' || !['managed', 'embedded', 'existing'].includes(mode)) throw Error('Unknown system unit mode');
        const resourceIds = dataArray(unit.resourceIds, 2048, 'system unit resource IDs').map(value => text(value, 1024, 'system resource ID'));
        if (new Set(resourceIds).size !== resourceIds.length) throw Error('Duplicate system unit resource ID');
        if (mode === 'existing' && resourceIds.length) throw Error('An existing prerequisite cannot stand in for a managed resource');
        return { id: unitId, label: text(unit.label, 1024, 'system unit label'), resourceIds,
          ...(unit.mode !== undefined && { mode: mode as SystemUnitMode }),
          ...(unit.description !== undefined && { description: text(unit.description, 1500, 'system unit description') }) };
      }) };
  });
  return { blocks };
}

/** Declared logical units borrow only the native readiness of their mapped resources. */
export function projectSystemBlocks(state: DashboardState): SystemBlockView[] {
  const definition = readSystemViewDefinition(state.systemView ?? fromBinding(state));
  const graph = new Map(state.graph?.resources.map(resource => [resource.id, resource]) ?? []);
  return definition.blocks.map(block => {
    const units = block.units.map((unit): SystemUnitView => {
      const mode = unit.mode ?? 'managed';
      const resources = unit.resourceIds.flatMap(id => {
        const resource = graph.get(id); if (!resource) return [];
        const progress = resourceProgress(state, id), description = describeResource(state, resource);
        return [{ id, name: description.name, kind: description.kind, status: progress.status,
          ...(progress.action ? { action: progress.action } : {}) }];
      });
      const unmappedResourceIds = unit.resourceIds.filter(id => !graph.has(id));
      const status = mode === 'existing' ? 'existing'
        : resources.some(resource => resource.status === 'failed') ? 'failed'
          : unmappedResourceIds.length || resources.length === 0 ? 'unmapped'
          : aggregate(resources.map(resource => resource.status));
      return { ...unit, mode, status, resources, unmappedResourceIds };
    });
    const counts: SystemBlockCounts = { total: 0, ready: 0, deploying: 0, pending: 0, failed: 0, skipped: 0, deleted: 0, unmapped: 0, existing: 0 };
    for (const unit of units) {
      if (unit.status === 'existing') counts.existing++;
      else { counts.total++; counts[unit.status]++; }
    }
    return { ...block, units, counts, status: aggregate(units.map(unit => unit.status)) };
  });
}

export function unmappedSystemResources(state: DashboardState, blocks: readonly SystemBlockView[]): string[] {
  const mapped = new Set(blocks.flatMap(block => block.units.flatMap(unit => unit.resources.map(resource => resource.id))));
  return state.graph?.resources.filter(resource => !mapped.has(resource.id)).map(resource => resource.id) ?? [];
}

function aggregate(statuses: readonly SystemBlockStatus[]): SystemBlockStatus {
  const managed = statuses.filter(status => status !== 'existing');
  if (statuses.length && !managed.length) return 'existing';
  if (!managed.length) return 'unmapped';
  if (managed.includes('failed')) return 'failed';
  if (managed.includes('deploying')) return 'deploying';
  if (managed.includes('unmapped')) return 'unmapped';
  if (managed.includes('skipped')) return 'skipped';
  if (managed.includes('deleted')) return 'deleted';
  if (managed.every(status => status === 'ready')) return 'ready';
  return managed.includes('ready') ? 'deploying' : 'pending';
}

function fromBinding(state: DashboardState): SystemViewDefinition {
  const blocks = new Map<SystemBlockFamily, SystemBlockDefinition>();
  const labels = { compute: 'Compute', storage: 'Storage', network: 'Network' };
  const currentBinding = state.binding?.designDigest === state.design?.digest && state.binding?.graph.digest === state.graph?.digest;
  for (const capability of state.design?.capabilities ?? []) {
    const family = capability.family;
    const mapped = currentBinding ? state.binding?.mappings.find(mapping => mapping.capabilityId === capability.id) : undefined;
    const unit = { id: capability.id, label: capability.path, resourceIds: mapped?.resourceIds ?? [] };
    const previous = blocks.get(family);
    blocks.set(family, { id: 'capability-family:' + family, label: labels[family], family, units: [...previous?.units ?? [], unit] });
  }
  return { blocks: [...blocks.values()] };
}

function text(value: unknown, maximum: number, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value)) throw Error('Invalid ' + label);
  return value;
}
/** Read declared JSON without invoking an accessor on a trusted extension's object. */
function dataObject(value: unknown, allowed: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw Error('Invalid ' + label);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const output: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== 'string' || !allowed.includes(key)) throw Error('Unknown system property');
    const descriptor = descriptors[key]!;
    if (!('value' in descriptor)) throw Error('A system declaration must contain data properties');
    output[key] = descriptor.value;
  }
  return output;
}
function dataArray(value: unknown, maximum: number, label: string): unknown[] {
  if (!Array.isArray(value)) throw Error('Invalid ' + label);
  const descriptors = Object.getOwnPropertyDescriptors(value as object), length = descriptors.length?.value as number;
  if (!Number.isSafeInteger(length) || length > maximum) throw Error('Invalid ' + label + ' bound');
  if (Reflect.ownKeys(descriptors).length !== length + 1) throw Error('Invalid system array properties');
  return Array.from({ length }, (_, index) => {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !('value' in descriptor)) throw Error('A system declaration array must contain data properties');
    return descriptor.value;
  });
}
