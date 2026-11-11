import { validateInfraGraph } from 'footprint-iac/graph';
import { readDeploymentSchedulePreview } from 'footprint-iac/progress';
import { readRevisionReview, type RevisionReviewState } from '../core/revision-review.ts';
import { projectDeploymentSchedulePreview } from '../core/native-deployment-chart.ts';
import type { DashboardRun, DashboardState, OutputArtifact } from '../core/types.ts';
import type { ManagedReviewOptions } from './execute-managed-review.ts';
import { readConnectionReview, type ConnectionReviewOptions } from './run-connections.ts';
import { readIdentityResourceBindings, type IdentityReviewOptions } from './run-identity.ts';

/** Fixed host callbacks. Requests can review the configured candidate and echo a review ID only. */
export interface RevisionWorkflowOptions {
  snapshot(): Promise<RevisionReviewState>;
  review(): Promise<RevisionPreparation>;
  completed(prepared: RevisionPreparation, run: DashboardRun): Promise<RevisionReviewState>;
  artifacts?(): Promise<OutputArtifact[]>;
}
export interface RevisionPreparation {
  summary: RevisionReviewState;
  managedReview: ManagedReviewOptions;
  connectionReview?: ConnectionReviewOptions;
  identityReview?: IdentityReviewOptions;
  /** Owned local app access can be restored after rollout, before recorded verification. */
  afterApply?(): Promise<void>;
}

/** Admit the entire candidate before replacing any current viewer state. */
export function readRevisionPreparation(input: RevisionPreparation, current: DashboardState): RevisionPreparation {
  const summary = readRevisionReview(input.summary);
  const graph = validateInfraGraph(input.managedReview.graph);
  if (summary.status !== 'ready' || summary.canApply !== true || !summary.reviewId || !summary.candidate
    || summary.candidate.graphDigest !== graph.digest
    || summary.current?.graphDigest !== (current.revisionReview?.current?.graphDigest ?? current.graph?.digest)) {
    throw Error('The revision review does not match the current and candidate system definitions');
  }
  if (summary.resources?.length !== graph.resources.length
    || new Set(summary.resources.map(resource => resource.resourceId)).size !== graph.resources.length
    || graph.resources.some(resource => !summary.resources!.some(change => change.resourceId === resource.id))) {
    throw Error('The reviewed plan must cover every candidate resource');
  }
  for (const key of ['id', 'context', 'namespace'] as const) {
    if (current.target?.[key] !== input.managedReview.target?.[key]) throw Error('An update cannot change the current deployment target');
  }
  const managedReview = { ...input.managedReview, graph };
  if (managedReview.schedulePreview) {
    managedReview.schedulePreview = readDeploymentSchedulePreview(managedReview.schedulePreview);
    if (!projectDeploymentSchedulePreview({ ...current, graph, schedulePreview: managedReview.schedulePreview }).chart) {
      throw Error('The candidate schedule does not match its graph');
    }
  }
  const connectionReview = input.connectionReview && readConnectionReview(input.connectionReview, graph);
  const identityReview = input.identityReview && { ...input.identityReview,
    checks: structuredClone(input.identityReview.checks),
    adapter: Object.freeze({ check: input.identityReview.adapter.check.bind(input.identityReview.adapter) }),
    resourceBindings: readIdentityResourceBindings(input.identityReview, graph.resources.map(resource => resource.id)),
  };
  return { ...input, summary, managedReview, connectionReview, identityReview };
}
