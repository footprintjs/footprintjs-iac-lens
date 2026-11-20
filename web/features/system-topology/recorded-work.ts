import type {TopologyNodeAction} from 'footprintjs-iac/system-topology';

export type RecordedWorkState='running'|'observed'|'confirmed'|'failed'|'unknown';
export interface RecordedWorkStep {
 id:string;
 state:RecordedWorkState;
 action:TopologyNodeAction;
}
export const recordedWorkLabels:Record<RecordedWorkState,string>={running:'In progress',observed:'Observed',confirmed:'Confirmed',failed:'Failed',unknown:'Unconfirmed'};

/** Count observed native step instances, never a guessed total or verification percentage. */
export function recordedWork(actions:readonly TopologyNodeAction[]=[]) {
 const groups=new Map<string,Map<string,TopologyNodeAction>>();
 for(const action of actions){
  if(!action.resourceId||typeof action.evidence?.runtimeStageId!=='string'||!action.evidence.runtimeStageId)continue;
  const id=JSON.stringify([action.resourceId,action.evidence.runtimeStageId]);
  const channels=groups.get(id)??new Map<string,TopologyNodeAction>();
  // A stage can publish shared and component rows. Keep each channel's latest
  // state, then count the actual native instance once.
  channels.set(JSON.stringify([action.componentId??null,action.phase]),action);
  groups.set(id,channels);
 }
 const steps:RecordedWorkStep[]=[...groups].map(([id,channels])=>{
  const rows=[...channels.values()];
  const status=rows.some(row=>row.status==='failed')?'failed':rows.some(row=>row.status==='unknown')?'unknown':rows.some(row=>row.status==='running')?'running':'passed';
  const state:RecordedWorkState=status==='passed'?(rows.every(row=>row.evidence.complete)?'confirmed':'observed'):status;
  const matching=rows.filter(row=>row.status===status);
  const action=matching.find(row=>row.scope==='component')??matching.at(-1)!;
  return{id,state,action};
 });
 const running=steps.filter(step=>step.state==='running');
 const current=running.find(step=>step.action.scope==='component')??running.at(-1)??steps.at(-1);
 return{steps,visibleSteps:steps.slice(-8),count:steps.length,omitted:Math.max(0,steps.length-8),current,runningCount:running.length,
  observedCount:steps.filter(step=>step.state==='observed').length,confirmedCount:steps.filter(step=>step.state==='confirmed').length,
  failedCount:steps.filter(step=>step.state==='failed').length,unknownCount:steps.filter(step=>step.state==='unknown').length};
}
