import type { Resource } from 'footprintjs-iac';
import { projectSystemBlocks, type SystemBlockFamily, type SystemUnitMode } from './capabilities.ts';
import { describeResource, resourceProgress, type ResourceDescription } from './model.ts';
import type { DashboardState, ProgressEvent, ResourceProgress } from './types.ts';
import { projectNativeDeploymentChart, projectDeploymentSchedulePreview } from './native-deployment-chart.ts';
import { resourceFlowWorkspace, type ResourceFlowWorkspaceState } from './resource-flow-workspace.ts';

export interface DeploymentFlowCapability {
  blockId: string; unitId: string; label: string; family: SystemBlockFamily; mode: SystemUnitMode;
  resourceIds: readonly string[];
  description?: string;
}
export interface DeploymentFlowObservation {
  /** Native sequences are local to this child run; they are never merged into an invented run. */
  runId?: string;
  /** The recorded start ordinal, not a completion order or a planned step. */
  step: number; startSequence: number; endSequence?: number;
  startedAt?: string | number; finishedAt?: string | number; overlapsWith: string[];
}
export interface DeploymentFlowNode {
  id: string; resource: Resource; description: ResourceDescription; progress: ResourceProgress;
  capabilities: DeploymentFlowCapability[]; dependsOn: string[]; waitingFor: string[];
  column: number; row: number; observed?: DeploymentFlowObservation;
}
export interface DeploymentFlowEdge {
  id: string; source: string; target: string; kind: 'dependency' | 'observed-order' | 'native-schedule'; label: string;
}
export interface DeploymentFlowColumn {
  index: number; kind: 'recorded' | 'prerequisites' | 'unstarted' | 'native' | 'planned'; label: string;
  resourceIds: string[]; overlapping: boolean;
}
export interface DeploymentFlow {
  basis: 'recorded' | 'prerequisites'; nodes: DeploymentFlowNode[]; edges: DeploymentFlowEdge[];
  layoutSource: 'native-chart' | 'native-events' | 'native-children' | 'phase-plan' | 'prerequisites' | 'schedule-preview';
  columns: DeploymentFlowColumn[]; existingPrerequisites: { id: string; label: string; description?: string }[];
  warnings: string[];
}

type OrderedEvent = ProgressEvent & { resourceId: string; sequence: number };
const terminal = new Set(['ready', 'failed', 'skipped', 'deleted']);

/** One physical resource per node. Categories annotate that node; they never establish order. */
export function projectDeploymentFlow(state: DashboardState): DeploymentFlow {
  const warnings: string[] = [], blocks = projectSystemBlocks(state);
  const nodes: DeploymentFlowNode[] = (state.graph?.resources ?? []).map(resource => ({
    id: resource.id, resource, description: describeResource(state, resource), progress: resourceProgress(state, resource.id),
    dependsOn: [...resource.dependsOn ?? []], waitingFor: (resource.dependsOn ?? []).filter(id => resourceProgress(state, id).status !== 'ready'),
    capabilities: blocks.flatMap(block => block.units.filter(unit => unit.mode !== 'existing' && unit.resourceIds.includes(resource.id)).map(unit => ({
      blockId: block.id, unitId: unit.id, label: unit.label, family: block.family, mode: unit.mode, resourceIds: [...unit.resourceIds],
      ...(unit.description ? { description: unit.description } : {}),
    }))), column: 0, row: 0,
  }));
  const byId = new Map(nodes.map(node => [node.id, node]));
  if (state.resourceFlowWorkspace) {
    const workspace = resourceFlowWorkspace(state);
    if (workspace) return workspaceFlow(state, workspace, nodes);
    const unknown = projectDeploymentFlow({ ...state, resourceFlowWorkspace: undefined, run: undefined });
    return { ...unknown, warnings: [...unknown.warnings, 'The resource workflow evidence could not be admitted; physical resource progress remains unknown.'] };
  }
  const events = orderedEvents(state, byId, warnings);
  let step = 0;
  for (const event of events) {
    const node = byId.get(event.resourceId)!;
    if (event.status === 'deploying') {
      if (!node.observed) node.observed = { step: ++step, startSequence: event.sequence,
        ...(event.timestamp !== undefined && { startedAt: event.timestamp }), overlapsWith: [] };
      else warnings.push(`More than one start was recorded for ${node.id}; only its first start is numbered.`);
    } else if (terminal.has(event.status ?? '') && node.observed && node.observed.endSequence === undefined) {
      node.observed.endSequence = event.sequence;
      if (event.timestamp !== undefined) node.observed.finishedAt = event.timestamp;
    }
  }
  const started = nodes.filter(node => node.observed).sort((a, b) => a.observed!.startSequence - b.observed!.startSequence);
  let columns = started.length ? recordedColumns(started, warnings) : [];
  const remaining = nodes.filter(node => !node.observed);
  appendPrerequisites(remaining, byId, columns, started.length > 0, warnings);
  const edges: DeploymentFlowEdge[] = nodes.flatMap(node => node.dependsOn.filter(id => byId.has(id)).map(id => ({
    id: `dependency:${id}:${node.id}`, source: id, target: node.id, kind: 'dependency' as const, label: 'Must be ready first',
  })));
  appendObservedEdges(started, edges);
  const native = projectNativeDeploymentChart(state);
  warnings.push(...native.warnings);
  const preview = !native.chart && state.run?.chart === undefined && started.length === 0 ? projectDeploymentSchedulePreview(state) : undefined;
  if (preview) warnings.push(...preview.warnings);
  const topology = native.chart ?? preview?.chart;
  if (topology) {
    for (const binding of topology.nodes) {
      const node = byId.get(binding.resourceId)!;
      node.column = binding.column; node.row = binding.row;
    }
    columns = topology.batches.map(batch => {
      const overlapping = batch.resourceIds.some(id => byId.get(id)!.observed?.overlapsWith.some(other => batch.resourceIds.includes(other)));
      return { index: batch.index, kind: native.chart ? 'native' as const : 'planned' as const, resourceIds: batch.resourceIds, overlapping,
        label: overlapping ? 'Overlapping work' : batch.scheduledParallel ? 'Scheduled together' : native.chart ? 'Native chart step' : 'Planned build step' };
    });
    edges.push(...topology.edges);
  }
  for (const node of nodes) {
    if (node.dependsOn.some(id => !byId.has(id))) warnings.push(`Some prerequisites of ${node.id} are missing from this graph.`);
    if (!node.observed && terminal.has(node.progress.status) && node.progress.status !== 'skipped') warnings.push(`No start event was captured for ${node.id}; its execution position is unknown.`);
    if (node.observed && node.observed.endSequence === undefined && terminal.has(node.progress.status)) {
      warnings.push(`No finish event was captured for ${node.id}; its completion order is unknown.`);
    }
  }
  return { basis: started.length ? 'recorded' : 'prerequisites',
    layoutSource: native.chart ? 'native-chart' : preview?.chart ? 'schedule-preview' : started.length ? 'native-events' : 'prerequisites', nodes, edges, columns,
    existingPrerequisites: blocks.flatMap(block => block.units.filter(unit => unit.mode === 'existing').map(unit => ({
      id: `${block.id}:${unit.id}`, label: unit.label, ...(unit.description && { description: unit.description }),
    }))), warnings: [...new Set(warnings)] };
}

/** Compose layouts and observations while preserving each child's local sequence and actual chart. */
function workspaceFlow(state: DashboardState, workspace: ResourceFlowWorkspaceState, nodes: DeploymentFlowNode[]): DeploymentFlow {
  const warnings: string[] = workspace.error ? [workspace.error] : [], byId = new Map(nodes.map(node => [node.id, node]));
  const columns: DeploymentFlowColumn[] = [], edges: DeploymentFlowEdge[] = nodes.flatMap(node => node.dependsOn.filter(id => byId.has(id)).map(id => ({
    id: `dependency:${id}:${node.id}`, source: id, target: node.id, kind: 'dependency' as const, label: 'Must be ready first',
  })));
  const positioned = new Set<string>();
  const found = workspace.found ?? [];
  for (const phase of ['acquire', 'connect'] as const) {
    const child = workspace.children.find(child => child.phase === phase);
    const phaseGraph = workspace.phaseGraphs?.[phase] ?? child?.graph;
    if (phase === 'acquire' && state.resourceFlow?.mode === 'existing') {
      const sourceIds = phaseGraph?.resources.map(resource => resource.id) ?? found.map(resource => resource.resourceId);
      if (sourceIds.length) {
        for (const [row, id] of sourceIds.entries()) { const node = byId.get(id)!; node.column = columns.length; node.row = row; positioned.add(id); }
        columns.push({ index: columns.length, kind: 'prerequisites',
          label: sourceIds.every(id => found.some(resource => resource.resourceId === id)) ? 'Found existing resources' : 'Existing sources · waiting for lookup',
          resourceIds: sourceIds, overlapping: false });
      }
      continue;
    }
    if (!phaseGraph) continue;
    const childFlow = projectDeploymentFlow({ ...state, graph: phaseGraph, run: child?.run,
      resourceFlowWorkspace: undefined, schedulePreview: undefined, systemView: undefined, design: undefined, binding: undefined });
    const offset = columns.length;
    for (const childNode of childFlow.nodes) {
      const node = byId.get(childNode.id)!;
      node.column = offset + childNode.column; node.row = childNode.row;
      if (childNode.observed && child) node.observed = { ...childNode.observed, runId: child.run.id };
      positioned.add(node.id);
    }
    columns.push(...childFlow.columns.map(column => ({ ...column, index: offset + column.index,
      kind: !child ? 'planned' as const : column.kind,
      label: `${phase === 'acquire' ? 'Create' : 'Connect'} · ${!child ? 'Planned prerequisites' : column.label}` })));
    if (child) edges.push(...childFlow.edges.filter(edge => edge.kind !== 'dependency').map(edge => ({ ...edge, id: `${child.run.id}:${edge.id}` })));
    warnings.push(...childFlow.warnings);
  }
  appendPrerequisites(nodes.filter(node => !positioned.has(node.id)), byId, columns, positioned.size > 0, warnings);
  if (!workspace.phaseGraphs && !workspace.children.length && !found.length && state.schedulePreview) {
    const preview = projectDeploymentSchedulePreview(state); warnings.push(...preview.warnings);
    if (preview.chart) {
      for (const binding of preview.chart.nodes) { const node = byId.get(binding.resourceId)!; node.column = binding.column; node.row = binding.row; }
      columns.splice(0, columns.length, ...preview.chart.batches.map(batch => ({ index: batch.index, kind: 'planned' as const,
        label: batch.scheduledParallel ? 'Scheduled together' : 'Planned build step', resourceIds: batch.resourceIds, overlapping: false })));
      edges.push(...preview.chart.edges);
    }
  }
  return { basis: workspace.children.some(child => child.run.events.length) ? 'recorded' : 'prerequisites',
    layoutSource: workspace.children.length ? 'native-children' : workspace.phaseGraphs ? 'phase-plan' : state.schedulePreview ? 'schedule-preview' : 'prerequisites',
    nodes, edges, columns, existingPrerequisites: [], warnings: [...new Set(warnings)] };
}

/** A native sequence establishes order; clocks or array positions cannot resolve missing/tied sequences. */
function orderedEvents(state: DashboardState, byId: Map<string, DeploymentFlowNode>, warnings: string[]): OrderedEvent[] {
  const relevant = (state.run?.events ?? []).filter(event => event.resourceId && byId.has(event.resourceId));
  const seen = new Set<number>();
  const output: OrderedEvent[] = [];
  for (const event of relevant) {
    const sequence = event.sequence ?? event.seq;
    if (!Number.isSafeInteger(sequence) || sequence! < 1 || seen.has(sequence!)) {
      warnings.push('Native event sequence is missing or ambiguous; showing prerequisites without claiming execution order.');
      return [];
    }
    const runId = (event as ProgressEvent & { runId?: unknown }).runId;
    if (runId !== undefined && runId !== state.run?.id) {
      warnings.push('Native events belong to another run; showing prerequisites without claiming execution order.');
      return [];
    }
    seen.add(sequence!); output.push({ ...event, resourceId: event.resourceId!, sequence: sequence! });
  }
  return output.sort((a, b) => a.sequence - b.sequence);
}

/** Consecutive overlapping intervals share a column; unknown finishes never imply a strict successor. */
function recordedColumns(nodes: DeploymentFlowNode[], warnings: string[]): DeploymentFlowColumn[] {
  const groups: DeploymentFlowNode[][] = [];
  for (const node of nodes) {
    const previous = groups.at(-1);
    const finished = previous?.every(other => other.observed!.endSequence !== undefined
      && other.observed!.endSequence! < node.observed!.startSequence);
    if (!previous || finished) groups.push([node]);
    else previous.push(node);
  }
  return groups.map((group, column) => {
    for (const [row, node] of group.entries()) {
      node.column = column; node.row = row;
      node.observed!.overlapsWith = group.filter(other => other !== node && observedOverlap(node, other)).map(other => other.id);
    }
    const overlapping = group.some(node => node.observed!.overlapsWith.length > 0);
    const unresolved = group.length > 1 && !overlapping;
    if (unresolved) warnings.push('Some recorded starts have no captured finish; their completion order remains unknown.');
    return { index: column, kind: 'recorded', label: overlapping ? 'Overlapping work' : unresolved ? 'Order unresolved'
      : `Recorded start ${group[0]!.observed!.step}`, resourceIds: group.map(node => node.id), overlapping };
  });
}

function observedOverlap(a: DeploymentFlowNode, b: DeploymentFlowNode): boolean {
  const [earlier, later] = a.observed!.startSequence < b.observed!.startSequence ? [a, b] : [b, a];
  const end = earlier.observed!.endSequence;
  return end !== undefined ? end > later.observed!.startSequence : earlier.progress.status === 'deploying';
}

/** Pending positions describe prerequisites only, even when a recorded run precedes them. */
function appendPrerequisites(nodes: DeploymentFlowNode[], byId: Map<string, DeploymentFlowNode>, columns: DeploymentFlowColumn[], recorded: boolean, warnings: string[]) {
  const remaining = new Set(nodes.map(node => node.id)), levels = new Map<string, number>(), visiting = new Set<string>();
  function level(id: string): number {
    if (levels.has(id)) return levels.get(id)!;
    if (visiting.has(id)) { warnings.push('A dependency cycle prevents a complete prerequisite order.'); return 0; }
    visiting.add(id);
    const parents = byId.get(id)?.dependsOn.filter(parent => remaining.has(parent)) ?? [];
    const depth = parents.length ? 1 + Math.max(...parents.map(level)) : 0;
    visiting.delete(id); levels.set(id, depth); return depth;
  }
  for (const node of nodes) level(node.id);
  const offset = columns.length, grouped = new Map<number, DeploymentFlowNode[]>();
  for (const node of nodes) {
    const depth = levels.get(node.id) ?? 0;
    grouped.set(depth, [...grouped.get(depth) ?? [], node]);
  }
  for (const [depth, group] of [...grouped].sort(([a], [b]) => a - b)) {
    const index = offset + depth;
    for (const [row, node] of group.entries()) { node.column = index; node.row = row; }
    columns.push({ index, kind: recorded ? 'unstarted' : 'prerequisites',
      label: recorded ? 'No recorded start yet' : depth ? 'After prerequisites' : 'No prerequisites',
      resourceIds: group.map(node => node.id), overlapping: false });
  }
}

/** Temporal order is evidence, not an architectural dependency. Keep these edge kinds separate. */
function appendObservedEdges(nodes: DeploymentFlowNode[], edges: DeploymentFlowEdge[]) {
  for (const target of nodes) {
    const before = nodes.filter(source => source.observed!.endSequence !== undefined
      && source.observed!.endSequence! < target.observed!.startSequence);
    const nearest = before.filter(source => !before.some(middle => source !== middle
      && source.observed!.endSequence! < middle.observed!.startSequence));
    for (const source of nearest) edges.push({ id: `observed:${source.id}:${target.id}`, source: source.id, target: target.id,
      kind: 'observed-order', label: 'Finished before this start' });
  }
}
