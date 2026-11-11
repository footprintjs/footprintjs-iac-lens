import { loadEvidence, type ApplyResult, type InfraGraph } from 'footprint-iac';
import { validateInfraGraph } from 'footprint-iac/graph';
import type { DashboardRun, ProgressEvent } from '../../src/core/types.ts';
import { readMasterJson } from './master-files.ts';

export interface NeoRecordedDeployment { graph: InfraGraph; result: ApplyResult; events: ProgressEvent[] }
export async function readNeoMasterDeployment(path: string): Promise<{ deployment: NeoRecordedDeployment; run: DashboardRun }> {
  const deployment = await readMasterJson(path) as NeoRecordedDeployment;
  deployment.graph = validateInfraGraph(deployment.graph);
  const { result, graph } = deployment;
  if (!result.ok || !Array.isArray(deployment.events)) throw Error('An existing successful native Neo recording is required');
  const evidence = await loadEvidence(result.evidencePath);
  if (evidence.runId !== result.runId || evidence.graph?.digest !== graph.digest || !evidence.deploymentChart
    || !evidence.structure || evidence.deploymentChart.graphDigest !== graph.digest) throw Error('The existing Neo recording does not match its graph');
  const native = evidence.snapshot.sharedState as Record<string, unknown>;
  const resources = graph.resources.map(resource => {
    const progress = native['progress:' + resource.id] as DashboardRun['resources'][number] & { runId?: string };
    if (progress?.resourceId !== resource.id || progress.runId !== result.runId || progress.status !== 'ready') {
      throw Error('The existing recording does not confirm every Neo resource ready');
    }
    return { ...progress, id: resource.id };
  });
  return { deployment, run: { id: result.runId, status: 'passed', mode: 'kubernetes', resources,
    events: deployment.events, report: result, chart: evidence.deploymentChart,
    recording: { snapshot: evidence.snapshot, structure: evidence.structure,
      narrativeEntries: Array.isArray(evidence.narrative) ? evidence.narrative : [] } } };
}
