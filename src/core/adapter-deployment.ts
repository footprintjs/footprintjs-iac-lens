import { readDeploymentChart } from 'footprintjs-iac/progress';
import type { DashboardState } from './types.ts';
import { projectNativeDeploymentChart } from './native-deployment-chart.ts';
import { buildAdapterTopology } from './adapter-deployment-topology.ts';
import { adapterObservations, type AdapterObservationIndex } from './adapter-deployment-evidence.ts';

export type AdapterDeploymentStatus = 'pending' | 'running' | 'completed' | 'skipped' | 'failed' | 'unknown';
export interface AdapterDeploymentStage {
  id: string; stageId: string; label: string; kind: 'stage' | 'decision' | 'subflow' | 'loop';
  scope: string; resourceId: string; status: AdapterDeploymentStatus;
  runtimeStageIds: string[]; executions: number; column: number; row: number;
  childScope?: string; reason?: string;
}
export interface AdapterDeploymentEdge {
  id: string; source: string; target: string; kind: 'next' | 'branch' | 'loop'; label?: string; selected?: boolean;
}
export interface AdapterDeploymentScope { id: string; label: string; parentScope?: string; mountStageId?: string }
export interface AdapterDeploymentResource {
  resourceId: string; label: string; action: string; rootScope: string; adapterScope?: string;
  stages: AdapterDeploymentStage[]; edges: AdapterDeploymentEdge[]; scopes: AdapterDeploymentScope[];
}
export interface AdapterDeploymentView { available: boolean; runId?: string; resources: AdapterDeploymentResource[]; warnings: string[] }

/** View native adapter scopes; this never invokes a provider or schedules a deployment. */
export function projectAdapterDeployment(state: DashboardState, resourceId?: string): AdapterDeploymentView {
  const admission = projectNativeDeploymentChart(state), warnings = [...admission.warnings];
  if (!admission.chart || !state.run?.chart || !state.graph) return { available: false, resources: [], warnings };
  try {
    const chart = readDeploymentChart(state.run.chart);
    const topology = buildAdapterTopology(chart, resourceId);
    let observations: AdapterObservationIndex | undefined;
    if (state.run.recording) {
      try { observations = adapterObservations(state, chart); }
      catch { warnings.push('The adapter recording could not be matched to this run; unconfirmed steps remain unknown.'); }
    }
    const resources = topology.resources.map(resource => {
      const stages = resource.stages.map(stage => {
        const observed = observations?.stages.get(stage.id), ancestry = topology.ancestry.get(stage.id) ?? [];
        const excluded = ancestry.find(branch => {
          const choice = observations?.decisions.get(branch.gateId);
          return choice && !choice.has(branch.branchId);
        });
        const runtimeStageIds = observed ? [...observed.keys()] : [];
        const instances = observed ? [...observed.values()] : [];
        let status: AdapterDeploymentStatus = state.run!.status === 'running' || state.run!.status === 'idle' ? 'pending' : 'unknown';
        let reason: string | undefined;
        if (instances.some(instance => instance.started && !instance.completed && !instance.failed)) status = state.run!.status === 'running' ? 'running' : 'unknown';
        else if (instances.some(instance => instance.failed)) status = 'failed';
        else if (instances.some(instance => instance.unknown)) status = 'unknown';
        else if (instances.length && instances.every(instance => instance.completed)) status = observations?.incomplete ? 'unknown' : 'completed';
        else if (instances.length) status = 'unknown';
        else if (excluded && !observations?.incomplete) { status = 'skipped'; reason = 'The recorded decision selected another branch.'; }
        const executions = instances.filter(instance => instance.started || instance.completed || instance.failed).length;
        return { ...stage, status, runtimeStageIds, executions, ...(reason ? { reason } : {}) };
      });
      const edges = resource.edges.map(edge => {
        const chosen = edge.kind === 'branch' ? observations?.decisions.get(edge.source) : undefined;
        return { ...edge, ...(chosen ? { selected: chosen.has(edge.target) } : {}) };
      });
      const observedAdapterScope = resource.scopes.filter(scope => stages.some(stage => stage.scope === scope.id && observations?.providerStages.has(stage.id)))
        .sort((a, b) => b.id.length - a.id.length)[0]?.id;
      return { ...resource, stages, edges, ...(resource.adapterScope || observedAdapterScope ? { adapterScope: resource.adapterScope ?? observedAdapterScope } : {}) };
    });
    return { available: resources.length > 0, runId: chart.runId, resources, warnings: [...new Set([...warnings, ...observations?.warnings ?? []])] };
  } catch { return { available: false, runId: state.run.id, resources: [], warnings: [...warnings, 'The adapter chart uses an unsupported structure.'] }; }
}
