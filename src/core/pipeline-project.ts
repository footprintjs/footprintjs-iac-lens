import type { PipelineState } from 'footprintjs-iac/pipeline';
import type { PipelineExecutionView, PipelinePreview } from './pipeline-types.ts';
import type { PipelineSelection } from './pipeline-types.ts';
import { readPipelineExecution, readPipelinePreview } from './pipeline.ts';

/** Pure configuration view, explicitly separate from the recorded operations below. */
export function projectPipelinePreview(id:string,selection:PipelineSelection,state:PipelineState,plans:Record<string,{steps:{kind:string;id:string;operation?:string}[]}>):PipelinePreview {
  const steps:PipelinePreview['steps']=[],edges:PipelinePreview['edges']=[];
  for(const stage of state.definition.stages){
    const local:PipelinePreview['steps']=[];
    if(stage.promotion==='manual')local.push({id:`${stage.id}.promotion`,stageId:stage.id,label:'Approve',kind:'promotion'});
    local.push({id:`${stage.id}.before`,stageId:stage.id,label:'Check current version',kind:'observe'});
    for(const step of plans[stage.id]?.steps??[])local.push({id:`${stage.id}.plan.${step.id}`,stageId:stage.id,label:step.kind==='check'?'Check':actionLabel(step.operation??step.id),kind:step.kind});
    if(stage.checks.length)local.push({id:`${stage.id}.acceptance`,stageId:stage.id,label:'Test application',kind:'check'});
    local.push({id:`${stage.id}.observe`,stageId:stage.id,label:'Confirm release',kind:'observe'});
    for(const step of local){const previous=steps.at(-1);if(previous)edges.push({from:previous.id,to:step.id});steps.push(step);}
  }
  return readPipelinePreview({id,selection,steps,edges,warnings:selection.stages.some(v=>v.scheduleId)?['Schedules are configuration. Monitoring results appear only after recorded checks run.']:[]});
}
/** Keep private receipt metadata, evidence paths, tokens and targets on the host. */
export function projectPipelineState(state:PipelineState,releaseId:string):PipelineExecutionView {
  const stages=state.stages.map(stage=>{
    const definition=state.definition.stages.find(v=>v.id===stage.id)!;
    const pending=state.pendingAction?.stageId===stage.id?state.pendingAction:undefined;
    const recoveryOperations=stage.operations.filter(operation=>operation.id.startsWith('recovery-'));
    const attempted=recoveryOperations.length>0||stage.phase.startsWith('recovery-')||state.recordings.some(receipt=>receipt.stageId===stage.id&&receipt.kind==='recovery');
    const recovery=definition.rollback==='disabled'?'disabled':pending?.kind==='recover'?'available':stage.status==='rolled-back'?'passed':attempted?(stage.status==='incomplete'?'incomplete':stage.status==='running'?'running':'failed'):stage.status==='passed'?'not-needed':'unavailable';
    const changes=new Map<string,NonNullable<NonNullable<typeof stage.operations[number]['receipt']>['changes']>[number]>();
    for(const operation of stage.operations)if(operation.kind==='action'&&operation.status==='succeeded'&&operation.receipt?.status==='succeeded')for(const change of operation.receipt.changes??[])changes.set(change.resourceId,change);
    return {id:stage.id,label:stage.label,strategyId:definition.strategyId,
      status:stage.status==='waiting'?'awaiting-promotion':stage.status==='rolled-back'?'recovered':stage.status,
      steps:stage.operations.map(operation=>({id:operation.id,label:operation.kind==='check'?'Check':operation.kind==='observe'?'Confirm release':actionLabel(operation.operation??'deploy'),
        status:operation.status==='intent'?'running':operation.status==='succeeded'?'passed':operation.status==='failed'?'failed':'incomplete'})),
      checks:stage.operations.filter(v=>v.kind==='check'&&v.status!=='intent').map(v=>({id:v.id,passed:v.check?.status==='passed',status:v.check?.status??'error'})),
      changes:[...changes.values()],recovery,canPromote:pending?.kind==='promote',canRecover:pending?.kind==='recover'};
  });
  return readPipelineExecution({id:state.executionId??state.definition.id,status:state.status==='waiting'?(state.pendingAction?.kind==='recover'?'awaiting-recovery':'awaiting-promotion'):state.status,
    releaseId,releaseDigest:state.release.digest,stages,events:state.events.map(event=>({sequence:event.sequence,stageId:event.stageId,label:pipelineEventLabel(event.phase,event.status),phase:event.phase,status:event.status,timestamp:event.timestamp})),recordings:state.recordings.map(({runId,status,stageId,kind})=>({runId,status,stageId,kind}))});
}

function actionLabel(operation:string):string{return ({deploy:'Update application','deploy-candidate':'Prepare new version','set-traffic':'Move traffic','promote-candidate':'Finish switch','prepare-environment':'Prepare new environment','switch-traffic':'Switch traffic','promote-environment':'Finish switch',restore:'Restore previous version'} as Record<string,string>)[operation]??'Run deployment step';}
export function pipelineEventLabel(phase:string,status:string):string {
  if(status==='failed')return 'Needs attention';if(status==='incomplete')return 'Needs inspection';if(status==='rolled-back')return 'Previous version restored';
  if(phase==='promotion-gate')return 'Waiting for approval';
  if(phase==='outcome')return status==='passed'?'Update verified':'Needs attention';
  if(phase.includes('recover')||phase.includes('restore'))return status==='passed'?'Recovery step finished':'Restoring previous version';
  if(phase==='before')return status==='passed'?'Current version checked':'Checking current version';
  if(phase==='after')return status==='passed'?'Release identity checked':'Confirming deployed version';
  if(phase.includes('check')||phase.includes('analy')||phase.includes('verif')||phase.includes('acceptance'))return status==='passed'?'Check passed':'Checking the update';
  return status==='passed'?'Deployment step finished':'Updating this environment';
}
