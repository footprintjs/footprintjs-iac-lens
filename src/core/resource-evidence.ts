import type { BindingResult, Resource } from 'footprint-iac';
import type { DeploymentResourceStages } from 'footprint-iac/progress';
import { projectDeploymentFlow, type DeploymentFlowCapability, type DeploymentFlowObservation } from './deployment-flow.ts';
import { describeResource, resourceProgress, type ResourceDescription } from './model.ts';
import { projectNativeDeploymentChart } from './native-deployment-chart.ts';
import { connectionProgress } from './connections.ts';
import type { ConnectionProgress, DashboardState, IdentityProgress, ProgressEvent, ResourceProgress } from './types.ts';
import { resourceFlowWorkspace, type ResourceFlowFoundResource } from './resource-flow-workspace.ts';

export interface ResourceEvidence {
  resource: Resource;
  description: ResourceDescription;
  declaredDependencies: string[];
  capabilities: DeploymentFlowCapability[];
  bindings: BindingResult['mappings'];
  progress: ResourceProgress;
  deployment: {
    runId?: string;
    nativeStages?: DeploymentResourceStages;
    observed?: DeploymentFlowObservation;
    events: ProgressEvent[];
    result?: unknown;
    recordingAvailable: boolean;
    warnings: string[];
    phase?: 'acquire' | 'connect';
    found?: ResourceFlowFoundResource;
  };
  verification: { connections: ConnectionProgress[]; identity: IdentityProgress[] };
}

/** Stable resource IDs join both views to the same declared, recorded and verified evidence. */
export function projectResourceEvidence(state: DashboardState, resourceId: string): ResourceEvidence | undefined {
  const resource = state.graph?.resources.find(resource => resource.id === resourceId);
  if (!resource) return undefined;
  const flow = projectDeploymentFlow(state), node = flow.nodes.find(node => node.id === resourceId)!;
  const workspace = resourceFlowWorkspace(state);
  const child = workspace?.children.findLast(child => child.graph.resources.some(resource => resource.id === resourceId));
  const found = workspace?.found?.find(resource => resource.resourceId === resourceId);
  const run = workspace ? child?.run : state.run;
  const native = projectNativeDeploymentChart(child ? { ...state, graph: child.graph, run } : workspace ? { ...state, run: undefined } : state).chart;
  const bindingMatches = state.design && state.binding?.designDigest === state.design.digest
    && state.binding.graph.digest === state.graph!.digest;
  const report = object(run?.report), results = object(report.results);
  const events = run?.events.filter(event => event.resourceId === resourceId
    && ((event as ProgressEvent & { runId?: unknown }).runId === undefined
      || (event as ProgressEvent & { runId?: unknown }).runId === run?.id)) ?? [];
  const resourceIds = new Set(state.graph!.resources.map(resource => resource.id));
  const connections = state.graph!.relations.flatMap((relation, index) => {
    if (relation.kind !== 'communicatesWith' || !resourceIds.has(relation.from) || !resourceIds.has(relation.to)
      || (relation.from !== resourceId && relation.to !== resourceId)) return [];
    return [connectionProgress(state, `communication:${index}`, relation.from, relation.to)];
  });
  return {
    resource, description: describeResource(state, resource), declaredDependencies: [...resource.dependsOn ?? []],
    capabilities: node.capabilities,
    bindings: bindingMatches ? state.binding!.mappings.filter(mapping => mapping.resourceIds.includes(resourceId)) : [],
    progress: resourceProgress(state, resourceId),
    deployment: {
      ...(run?.id ? { runId: run.id } : {}), ...(child ? { phase: child.phase } : {}), ...(found ? { found } : {}),
      ...(native && { nativeStages: native.nodes.find(binding => binding.resourceId === resourceId) }),
      ...(node.observed && { observed: node.observed }), events,
      ...(Object.hasOwn(results, resourceId) && { result: results[resourceId] }),
      recordingAvailable: !!(run?.recording ?? (!workspace ? state.recording : undefined)), warnings: flow.warnings,
    },
    verification: { connections, identity: state.identity?.checks.filter(check => check.resourceIds?.includes(resourceId)) ?? [] },
  };
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
