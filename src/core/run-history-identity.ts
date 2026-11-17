import type { DashboardState } from './types.ts';
/** Stable ownership and desired-state identity, independent of changing native child segments. */
export function runObservationIdentity(state:DashboardState,runId:string):string {
 const owner=state.onboardingRegistry?.owner,selection=state.application?.selection;
 return JSON.stringify({runId,targetId:state.onboarding?.targetId??selection?.targetId??state.target?.id??state.resourceFlow?.target.id??null,
  graph:state.graph?.digest??null,configuration:state.onboarding?.configurationDigest??state.source?.configurationDigest??null,
  selection:selection?[selection.strategyId,selection.targetId,selection.profileId??null]:null,sourceReceipt:state.source?.receiptDigest??null,
  owner:owner?[owner.id,owner.strategyId,owner.targetId,owner.physicalTargetDigest,owner.controllerId,owner.controllerDigest]:null});
}
