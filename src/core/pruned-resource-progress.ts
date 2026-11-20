import { projectNativeDeploymentChart } from './native-deployment-chart.ts';
import type { DashboardState } from './types.ts';

/** Pruned resources are outside the desired graph and require current native delete progress. */
export function prunedResourceProgress(state: Pick<DashboardState, 'graph' | 'run'>) {
  const admitted = new Map<string, NonNullable<DashboardState['run']>['resources'][number]>();
  if (!state.graph || !state.run?.id) return admitted;
  const candidateRows = state.run.resources.filter(row => row.action === 'delete');
  if (!candidateRows.length) return admitted;
  const desired = new Set(state.graph.resources.map(resource => resource.id));
  const nativeIds = state.run.chart && new Set(projectNativeDeploymentChart(state as DashboardState).chart?.nodes
    .filter(node => node.action === 'delete').map(node => node.resourceId));
  const events = new Map(state.run.events.filter(event => event.action === 'delete' && event.version === 1
    && event.runId === state.run!.id).map(event => [event.sequence, event]));
  for (const row of candidateRows) {
    if (desired.has(row.id) || row.version !== 1 || row.runId !== state.run.id || row.resourceId !== row.id
      || !row.runtimeStageId || !Number.isSafeInteger(row.sequence) || row.sequence! < 1
      || (nativeIds && !nativeIds.has(row.id))) continue;
    const event = events.get(row.sequence);
    if (event?.resourceId === row.id && event.status === row.status && event.runtimeStageId === row.runtimeStageId) admitted.set(row.id, row);
  }
  return admitted;
}
