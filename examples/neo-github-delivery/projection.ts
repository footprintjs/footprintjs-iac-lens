import { neoAssessmentProjection } from './assessment-projection.ts';
import { loadEvidence } from 'footprintjs-iac';
import { neoIdentityChecks } from 'footprintjs-iac/integration/identity';
import type { NeoDeliveryBaseline, NeoDeliveryObservation } from 'footprintjs-iac/integration/identity/github-delivery';
import type { ConnectionRunResult, ConnectionSnapshot } from 'footprintjs-iac/connections';
import type { IdentityRunResult, IdentitySnapshot } from 'footprintjs-iac/identity';
import type { ConnectionRun, DashboardRun, IdentityRun, Recording } from '../../src/core/types.ts';
import type { DeliveryPublication } from '../../src/server/delivery.ts';
import { untestedConnections } from '../../src/core/connections.ts';
import { untestedIdentity } from '../../src/core/identity.ts';
import { masterReviewSummary } from '../neo-identity/master-summary.ts';

const recording = (result: ConnectionRunResult | IdentityRunResult): Recording => ({ snapshot: result.snapshot,
  structure: result.structure, controlDeps: result.controlDeps,
  narrativeEntries: Array.isArray(result.narrative) ? result.narrative : [] });

export async function neoDeliveryBaselineRun(baseline: NeoDeliveryBaseline): Promise<DashboardRun> {
  const evidence = await loadEvidence(baseline.result.evidencePath);
  if (evidence.runId !== baseline.result.runId || evidence.graph?.digest !== baseline.graph.digest || !evidence.deploymentChart) {
    throw Error('Neo baseline recording differs from its graph');
  }
  const native = evidence.snapshot.sharedState as Record<string, unknown>;
  return { id: baseline.result.runId, status: 'passed', mode: 'kubernetes',
    resources: baseline.graph.resources.map(resource => ({ ...(native['progress:' + resource.id] as DashboardRun['resources'][number]), id: resource.id })),
    events: [...baseline.events], report: baseline.result, chart: evidence.deploymentChart,
    recording: { snapshot: evidence.snapshot, structure: evidence.structure, controlDeps: evidence.controlDeps,
      narrativeEntries: Array.isArray(evidence.narrative) ? evidence.narrative : [] } };
}

export function neoDeliveryConnections(graph: NeoDeliveryBaseline['graph'], snapshot: ConnectionSnapshot, result?: ConnectionRunResult): ConnectionRun {
  const initial = untestedConnections(graph);
  return { ...initial, id: snapshot.runId ?? '', status: result ? result.ok ? 'passed' : 'failed' : 'checking',
    label: 'Real Neo connections', checks: initial.checks.map(check => ({ ...check, ...snapshot.connections[check.connectionId] })),
    events: [...snapshot.events], ...(result ? { checkedAt: Date.now(), recording: recording(result),
      report: { tracePath: result.tracePath, traceStatus: result.traceStatus } } : {}) };
}
export function neoDeliveryIdentity(snapshot: IdentitySnapshot, result?: IdentityRunResult): IdentityRun {
  const initial = untestedIdentity(neoIdentityChecks.map(({ id, label, kind, expected }) => ({ checkId: id, label, kind, expected })), 'Real Neo sign-in and access');
  return { ...initial, id: snapshot.runId ?? '', status: result ? result.ok ? 'passed' : 'failed' : 'checking',
    checks: initial.checks.map(check => ({ ...check, ...snapshot.checks[check.checkId] })), events: [...snapshot.events],
    ...(result ? { checkedAt: Date.now(), recording: recording(result), report: { tracePath: result.tracePath, traceStatus: result.traceStatus } } : {}) };
}

/** Projects actual consumer observations. Delivery-stage timestamps never synthesize resource readiness. */
export function createNeoDeliveryProjection() {
  let reviewed: ReturnType<typeof masterReviewSummary> | undefined;
  return async (event: NeoDeliveryObservation): Promise<DeliveryPublication> => {
    if(event.kind==='assessment')return {changeAssessment:await neoAssessmentProjection(event)};
    if (event.kind === 'plan') {
      reviewed = { ...masterReviewSummary(event.master, event.review), canApply: false };
      return { revisionReview: reviewed };
    }
    if (event.kind === 'deployment') {
      const run: DashboardRun = { id: event.snapshot.runId ?? '', status: event.result ? event.result.ok ? 'passed' : 'failed' : 'running',
        mode: 'kubernetes', chart: event.snapshot.chart,
        resources: event.graph.resources.map(resource => ({ ...(event.snapshot.resources[resource.id] ?? { status: 'pending' as const }), id: resource.id })),
        events: [...event.snapshot.events], ...(event.result ? { report: event.result } : {}) };
      if (event.result) {
        const evidence = await loadEvidence(event.result.evidencePath);
        if (evidence.graph?.digest !== event.graph.digest || evidence.runId !== event.result.runId) throw Error('Neo native deployment identity differs');
        run.recording = { snapshot: evidence.snapshot, structure: evidence.structure, controlDeps: evidence.controlDeps,
          narrativeEntries: Array.isArray(evidence.narrative) ? evidence.narrative : [] };
      }
      return { graph: event.graph, run, ...(run.recording ? { recording: run.recording } : {}) };
    }
    if (event.kind === 'connections') return { connections: neoDeliveryConnections(event.graph, event.snapshot, event.result) };
    if (event.kind === 'identity') return { identity: neoDeliveryIdentity(event.snapshot, event.result) };
    return { graph: event.graph, neoUrl: `http://127.0.0.1:${event.target.neoPort}/?test`, appAccess: { status: 'ready', checkedAt: new Date().toISOString() },
      revisionReview: { ...masterReviewSummary(event.master), ...(reviewed?.resources ? { resources: reviewed.resources } : {}), canApply: false } };
  };
}
