import type { TopologyEvidenceReference, TopologyNodeView, TopologyResourceObservation } from 'footprintjs-iac/system-topology';

interface ObjectActivity {
  appearance: {
    activity?: 'creating' | 'updating' | 'removing';
    presence?: 'removed';
    progress?: { completed: number; total: number; unit: string };
  };
  shared: boolean;
}

const activityForAction = { create: 'creating', update: 'updating', delete: 'removing' } as const;

function hasNativeStage(evidence: TopologyEvidenceReference, kind: TopologyEvidenceReference['kind']): boolean {
  return evidence.kind === kind && !!evidence.runId.trim() && !!evidence.runtimeStageId?.trim();
}

function checksVerified(node: TopologyNodeView): ObjectActivity['appearance']['progress'] {
  const { completed, total, indeterminate } = node.progress;
  const registeredChecks = (node.bindings.componentIds?.length ?? 0) + (node.bindings.checkIds?.length ?? 0);
  if (node.status !== 'checking' && node.status !== 'starting') return;
  if (indeterminate || !total || total !== registeredChecks || !Number.isSafeInteger(completed) || completed < 0 || completed > total) return;
  return { completed, total, unit: 'checks verified' };
}

/** Object appearance describes this publication's recorded work. Origin and health belong to the node. */
export function objectActivity(node: TopologyNodeView, resources: readonly TopologyResourceObservation[]): ObjectActivity | undefined {
  const resourceIds = node.bindings.resourceIds;
  if (node.origin === 'embedded' || !resourceIds.length) return;

  const bound = resources.filter(row => resourceIds.includes(row.id));
  if (new Set(bound.map(row => row.id)).size !== bound.length) return;

  const runId = bound[0]?.evidence.runId;
  if (node.status === 'removed' && bound.length === resourceIds.length && bound.every(row =>
    row.action === 'delete' && row.status === 'deleted' && row.evidence.complete
      && row.evidence.runId === runId && hasNativeStage(row.evidence, 'deployment'),
  )) {
    return { appearance: { presence: 'removed' }, shared: true };
  }

  const active = bound.filter(row => row.status === 'deploying');
  const operation = active[0];
  if (!operation) return;
  const { action } = operation;
  if (action !== 'create' && action !== 'update' && action !== 'delete') return;
  if (action === 'create' && node.origin !== 'deployment') return;
  if (!active.every(row => row.action === action && row.evidence.runId === operation.evidence.runId && hasNativeStage(row.evidence, 'deployment'))) return;

  const componentIds = node.bindings.componentIds ?? [];
  const shared = !active.every(row => node.actions?.some(detail =>
    detail.resourceId === row.id && detail.scope === 'component' && detail.componentId !== undefined
      && componentIds.includes(detail.componentId) && detail.status === 'running' && hasNativeStage(detail.evidence, 'adapter'),
  ));
  const progress = action === 'delete' ? undefined : checksVerified(node);
  return { appearance: { activity: activityForAction[action], ...(progress ? { progress } : {}) }, shared };
}
