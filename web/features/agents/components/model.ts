import type { AgentComponentGraphView } from '../../../../src/core/agent-components.ts';

export type ComponentNode = AgentComponentGraphView['nodes'][number];
export type ComponentBoundary = AgentComponentGraphView['boundaries'][number];
export type ComponentRelation = AgentComponentGraphView['relations'][number];
export type ComponentProgress = ComponentNode['progress'];
export type ComponentStatus = ComponentNode['status'];

export const componentStatusLabels: Readonly<Record<ComponentStatus, string>> = {
  pending: 'Waiting', running: 'Working', ready: 'Ready', failed: 'Needs attention', paused: 'Waiting for you',
  incomplete: 'Not confirmed', unknown: 'Not confirmed', unsupported: 'Not supported', skipped: 'Skipped',
};

/** Stage counts come from the native projection. Time never advances this fraction. */
export function progressPresentation(progress: ComponentProgress): { determinate: boolean; fraction?: number; label: string; completed: number; total?: number } {
  const completed = progress.completed;
  const validTotal = !progress.indeterminate && Number.isSafeInteger(progress.total) && progress.total! > 0 && completed >= 0 && completed <= progress.total!;
  return validTotal ? { determinate: true, fraction: completed / progress.total!, label: `${completed} of ${progress.total} ${progress.unit}`, completed, total: progress.total }
    : { determinate: false, label: `${completed} ${progress.unit} complete`, completed };
}

export function runtimeBoundaryLabel(boundary: Pick<ComponentBoundary, 'label' | 'kind' | 'strategy' | 'observed'>): string {
  return boundary.strategy ? `${boundary.observed ? 'Runtime' : 'Selected'} · ${boundary.strategy.label}` : boundary.label;
}

/** Small labels wrap without changing the complete identity retained in accessible text and details. */
export function labelLines(value: string, limit = 22): string[] {
  const words = value.split(/\s+/), lines: string[] = []; let line = '';
  for (const word of words) {
    if (line && line.length + word.length + 1 > limit) { lines.push(line); line = word; } else line += (line ? ' ' : '') + word;
  }
  if (line) lines.push(line);
  if (lines.length <= 2) return lines;
  return [lines[0]!, lines.slice(1).join(' ').slice(0, limit - 1).trimEnd() + '…'];
}

export function componentShape(node: Pick<ComponentNode, 'kind' | 'storage'>): 'process' | 'database' | 'memory' | 'store' | 'context' | 'connection' {
  if (node.kind === 'store') return node.storage === 'persistent' ? 'database' : node.storage === 'memory' ? 'memory' : 'store';
  return node.kind === 'execution' ? 'process' : node.kind === 'context' ? 'context' : 'connection';
}

/** Simple mode keeps check-only components on their measured edges. Details retains every native prerequisite. */
export function visibleComponentView(view: AgentComponentGraphView, technical: boolean): AgentComponentGraphView {
  if (technical) return view;
  const endpoints = new Set(view.relations.filter(edge => edge.kind === 'communicatesWith').flatMap(edge => [edge.from, edge.to]));
  const checks = new Set(view.relations.filter(edge => edge.kind === 'communicatesWith').map(edge => edge.checkComponentId).filter((id): id is string => !!id));
  const hidden = new Set(view.nodes.filter(node => node.kind === 'connection' && checks.has(node.id) && !endpoints.has(node.id)).map(node => node.id));
  // Placement wrappers remain in the native graph and Details. Simple contracts only
  // their containment paths; execution prerequisites are never inferred or rewired.
  const placement = new Set(view.boundaries.filter(boundary => boundary.parentId && !boundary.strategy && ['host', 'namespace', 'pod'].includes(boundary.kind)).map(boundary => boundary.id));
  const nearest = (id: string | undefined): string | undefined => {
    for (let count = 0; id && placement.has(id) && count <= view.boundaries.length; count++) id = view.boundaries.find(boundary => boundary.id === id)?.parentId;
    return id;
  };
  const nodes = view.nodes.filter(node => !hidden.has(node.id)).map(node => {
    if (!node.boundaryId || !placement.has(node.boundaryId)) return node;
    const { boundaryId, ...rest } = node, parent = nearest(boundaryId);
    return { ...rest, ...(parent ? { boundaryId: parent } : {}) };
  });
  const boundaries = view.boundaries.filter(boundary => !placement.has(boundary.id)).map(boundary => {
    if (!boundary.parentId || !placement.has(boundary.parentId)) return boundary;
    const { parentId, ...rest } = boundary, parent = nearest(parentId);
    return { ...rest, ...(parent ? { parentId: parent } : {}) };
  });
  const relations = view.relations.flatMap(edge => {
    if (hidden.has(edge.from) || hidden.has(edge.to)) return [];
    if (edge.kind !== 'contains') return [edge];
    if (placement.has(edge.to)) return [];
    const parent = nearest(edge.from);
    return parent && parent !== edge.to ? [{ ...edge, from: parent }] : [];
  });
  return { ...view, nodes, boundaries, relations };
}
