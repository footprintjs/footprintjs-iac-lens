import type { Json } from 'footprintjs-iac';
import type { MasterReview, MasterState, SystemRevision } from 'footprintjs-iac/master';
import type { RevisionIdentity, RevisionReviewState, RevisionResourceChange } from '../../src/core/revision-review.ts';

export function revisionIdentity(state: MasterState, revision: SystemRevision): RevisionIdentity {
  return { id: revision.revisionId, digest: revision.digest, graphDigest: revision.graph.digest,
    label: `Neo version ${state.revisions.findIndex(item => item.digest === revision.digest) + 1}` };
}
function valueAt(resource: unknown, path: string): Json | undefined {
  if (path === '$') return resource as Json | undefined;
  let value = resource;
  for (const key of path.split('.')) {
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, key)) return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value as Json;
}
export function masterReviewSummary(state: MasterState, review?: MasterReview): RevisionReviewState {
  const current = state.revisions.find(item => item.digest === state.appliedDigest);
  const candidate = state.revisions.find(item => item.digest === (review?.candidateDigest ?? state.candidateDigest));
  const attempt = state.attempts.at(-1);
  const resources: RevisionResourceChange[] | undefined = review?.plan.operations.map(operation => {
    const change = review.changes.resources.find(item => item.resourceId === operation.resource.id);
    const before = current?.graph.resources.find(item => item.id === operation.resource.id);
    const after = candidate?.graph.resources.find(item => item.id === operation.resource.id);
    return { resourceId: operation.resource.id, action: operation.action,
      change: change?.kind === 'unchanged' && operation.action !== 'noop' ? 'drift' : change?.kind ?? 'unchanged',
      ...(change?.paths.length ? { changes: change.paths.map(path => {
        const previous = valueAt(before, path), next = valueAt(after, path);
        return { path, ...(previous !== undefined ? { before: previous } : {}), ...(next !== undefined ? { after: next } : {}) };
      }) } : {}) };
  });
  return { status: review ? 'ready' : attempt?.status === 'running' ? 'blocked'
      : attempt?.status === 'failed' || attempt?.status === 'incomplete' ? 'failed'
        : candidate ? 'available' : current ? 'applied' : 'blocked',
    ...(current ? { current: revisionIdentity(state, current) } : {}),
    ...(candidate ? { candidate: revisionIdentity(state, candidate) } : {}),
    ...(resources ? { resources } : {}), ...(review ? { reviewId: review.reviewId } : {}),
    canApply: !!review, ...(attempt?.runId ? { runId: attempt.runId } : {}),
    ...(attempt?.status === 'running' ? { error: 'An earlier update needs its recorded outcome inspected before continuing.' } : {}) };
}
