import type { InfraGraph } from 'footprintjs-iac';
import type { createNeoResourceFlow } from 'footprintjs-iac/integration/identity';
import type { NeoResourceFlowObservation } from 'footprintjs-iac/integration/identity/resource-flow-view';
import type { ResourceFlowWorkspaceFrame } from '../../src/core/resource-flow-workspace.ts';
import type { ResourceFlowWorkspaceOptions } from '../../src/server/resource-flow.ts';
import { neoIdentitySystemView } from '../neo-identity/system-view.ts';
import { neoWorkspaceConnections, neoWorkspaceIdentity } from './workspace-checks.ts';
import { createNeoWorkspaceRecordingReader } from './workspace-recordings.ts';
import { neoWorkspaceHistory } from './workspace-history.ts';

type NeoFlow = Awaited<ReturnType<typeof createNeoResourceFlow>>;

/** A projection only. It cannot create resources, probe providers or change a checkpoint. */
export function projectNeoWorkspace(feed: NeoResourceFlowObservation, graph: InfraGraph,
  phaseGraphs: Pick<NeoFlow, 'acquisitionGraph' | 'consumerGraph'>): ResourceFlowWorkspaceFrame {
  if (feed.targetId !== feed.parent.target.id || graph.name !== feed.parent.resourceId) throw Error('The observation belongs to another system');
  const correlated = (value: { executionId: string; definitionDigest: string }) => {
    if (value.executionId !== feed.parent.executionId || value.definitionDigest !== feed.parent.definitionDigest) throw Error('A native child belongs to another workflow execution');
  };
  for (const child of feed.deployments) correlated(child);
  for (const run of [...feed.connections, ...feed.identities]) correlated(run);
  if (feed.source) correlated(feed.source);
  const incomplete = feed.retainedEvidence === 'incomplete' || feed.subscriberFailures > 0
    || feed.deployments.some(child => child.snapshot.ignoredEvents > 0 || child.snapshot.ignoredCharts > 0
      || child.snapshot.subscriberFailures > 0 || (child.result && (!child.result.chartPublished || !child.result.traceFlushed)))
    || [...feed.connections, ...feed.identities].some(run => run.snapshot.ignoredEvents > 0 || run.snapshot.subscriberFailures > 0
      || (run.result && !run.result.traceFlushed));
  return { flowId: feed.parent.id, executionId: feed.parent.executionId,
    definitionDigest: feed.parent.definitionDigest, targetId: feed.targetId, graphDigest: graph.digest, sequence: feed.sequence,
    children: feed.deployments.map(child => ({ phase: child.phase, origin: child.origin,
      graphDigest: (child.phase === 'acquire' ? phaseGraphs.acquisitionGraph : phaseGraphs.consumerGraph).digest,
      run: { id: child.snapshot.runId ?? '', mode: 'managed' as const,
        status: child.result ? child.result.ok ? 'passed' as const : 'failed' as const : child.snapshot.runId ? 'running' as const : 'idle' as const,
        resources: Object.values(child.snapshot.resources).map(event => ({ ...event, id: event.resourceId })),
        events: [...child.snapshot.events], ...(child.snapshot.chart ? { chart: child.snapshot.chart } : {}),
        ...(child.result ? { report: child.result } : {}),
      } })),
    ...(feed.source?.mode === 'existing' ? { found: feed.source.resources.filter(resource => resource.running).map(resource => ({
      resourceId: resource.resourceId, physicalId: resource.physicalId, timestamp: feed.source!.observedAt,
      ...(feed.source!.parentAcquire?.runId ? { parentRunId: feed.source!.parentAcquire.runId } : {}),
      ...(feed.source!.parentAcquire?.runtimeStageId ? { runtimeStageId: feed.source!.parentAcquire.runtimeStageId } : {}),
    })) } : {}),
    connections: neoWorkspaceConnections(graph, feed), identity: neoWorkspaceIdentity(feed),
    ...(incomplete ? { error: 'Some native observations could not be recovered; missing progress remains unconfirmed.' } : {}),
  };
}

export async function createNeoWorkspace(flow: NeoFlow): Promise<{
  workspace: ResourceFlowWorkspaceOptions; history: Awaited<ReturnType<typeof neoWorkspaceHistory>>;
}> {
  const history = await neoWorkspaceHistory(flow.target, flow.graph);
  const recordings = createNeoWorkspaceRecordingReader(flow.target.stateDirectory, flow.directory, flow.graph);
  const project = (feed: NeoResourceFlowObservation) => projectNeoWorkspace(feed, flow.graph, flow);
  return { history, workspace: {
    graph: flow.graph, phaseGraphs: { acquire: flow.acquisitionGraph, connect: flow.consumerGraph },
    systemView: neoIdentitySystemView(flow.target), ...(history.revisionReview ? { revisionReview: history.revisionReview } : {}),
    snapshot: async () => recordings(project(await flow.observation.snapshot())),
    subscribe: listener => flow.observation.subscribe(feed => listener(project(feed))),
    recheckConnections: () => flow.recheckConnections(), recheckIdentity: () => flow.recheckIdentity(),
  } };
}
