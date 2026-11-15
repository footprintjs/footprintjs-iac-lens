import type { InfraGraph } from 'footprintjs-iac';
import type { IdentityTarget } from 'footprintjs-iac/integration/identity';
import { FileMasterStore } from 'footprintjs-iac/master/workflow';
import { join } from 'node:path';
import type { OutputArtifact } from '../../src/core/types.ts';
import type { RevisionReviewState } from '../../src/core/revision-review.ts';
import { neoMasterBinding } from '../neo-identity/master-candidate.ts';
import { masterReviewSummary } from '../neo-identity/master-summary.ts';

/** Reading an existing history never adopts, stages or promotes a revision. */
export async function neoWorkspaceHistory(target: IdentityTarget, graph: InfraGraph): Promise<{
  revisionReview?: RevisionReviewState; artifacts: OutputArtifact[];
}> {
  const state = await new FileMasterStore(join(target.directory, 'master')).load();
  if (!state.revisions.length) return { artifacts: [] };
  const expected = neoMasterBinding(target);
  if (state.target?.id !== expected.id || state.target.scope !== expected.scope) throw Error('The saved version history belongs to another target');
  const current = state.revisions.find(revision => revision.digest === state.appliedDigest);
  if (current && current.graph.digest !== graph.digest) throw Error('The saved applied version does not match this workflow system');
  return { revisionReview: { ...masterReviewSummary(state, state.review), canApply: false },
    artifacts: [{ id: 'master-state', path: 'master/master.json', mediaType: 'application/json', content: JSON.stringify(state, null, 2) + '\n' },
      ...state.revisions.map(revision => ({ id: 'master-revision-' + revision.digest,
        path: 'master/revisions/' + revision.revisionId + '.json', mediaType: 'application/json', content: JSON.stringify(revision, null, 2) + '\n' }))],
  };
}
