import type { TopologyEvidenceReference } from 'footprintjs-iac/system-topology';
import type { AdapterDeploymentView } from './adapter-deployment.ts';

/** One recorded native instance, bound to the owning deployment and resource. */
export interface RecordedDeploymentStep {
  deploymentRunId: string;
  nativeRunId: string;
  resourceId: string;
  stageId: string;
  runtimeStageId: string;
  scope: string;
}

/** Resolve through the admitted native chart; labels and local stage suffixes are not identities. */
export function resolveTopologyDeploymentStep(view: AdapterDeploymentView, action: {resourceId:string;evidence:TopologyEvidenceReference}): RecordedDeploymentStep | undefined {
  const evidence=action.evidence;
  if(!view.available||!view.runId||!view.nativeRunId||evidence.kind!=='adapter'||evidence.runId!==view.nativeRunId||!evidence.runtimeStageId)return;
  const resources=view.resources.filter(resource=>resource.resourceId===action.resourceId);
  if(resources.length!==1)return;
  const matches=resources[0]!.stages.filter(stage=>stage.resourceId===action.resourceId&&stage.runtimeStageIds.includes(evidence.runtimeStageId!)&&['running','completed','failed'].includes(stage.status));
  if(matches.length!==1)return;
  const stage=matches[0]!;
  return {deploymentRunId:view.runId,nativeRunId:view.nativeRunId,resourceId:action.resourceId,stageId:stage.id,runtimeStageId:evidence.runtimeStageId,scope:stage.scope};
}

/** Revalidate a stored UI selection after every publication, including a subsequent run. */
export function currentRecordedDeploymentStep(view:AdapterDeploymentView, selection:RecordedDeploymentStep|undefined):RecordedDeploymentStep|undefined {
  if(!selection||selection.deploymentRunId!==view.runId)return;
  const current=resolveTopologyDeploymentStep(view,{resourceId:selection.resourceId,evidence:{kind:'adapter',runId:selection.nativeRunId,runtimeStageId:selection.runtimeStageId,complete:false}});
  return current?.stageId===selection.stageId&&current.scope===selection.scope?current:undefined;
}
