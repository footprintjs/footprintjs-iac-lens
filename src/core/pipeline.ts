export type * from './pipeline-types.ts';
export { readPipelineCatalog, admitPipelineSelection, defaultPipelineSelection, readPipelineSelection } from './pipeline-catalog.ts';
import type { PipelineAction, PipelineView, PipelineExecutionView, PipelinePreview } from './pipeline-types.ts';
import { readPipelineCatalog, readPipelineSelection, admitPipelineSelection } from './pipeline-catalog.ts';
import { row, id, label, list, bool, unique, hex, choice } from './pipeline-read.ts';
import { readHostActionReceipt } from './host-actions.ts';

export function readPipelineAction(input:unknown):PipelineAction {
  const kind=(input as {action?:unknown})?.action;
  if(kind==='preview'){const value=row(input,['action','pipelineId','selection']);return{action:kind,pipelineId:id(value.pipelineId),selection:readPipelineSelection(value.selection)};}
  if(kind==='start'){const value=row(input,['action','pipelineId','previewId']);return{action:kind,pipelineId:id(value.pipelineId),previewId:hex(value.previewId)};}
  if(kind==='promote'||kind==='recover'){const value=row(input,['action','pipelineId','executionId','stageId']);return{action:kind,pipelineId:id(value.pipelineId),executionId:id(value.executionId),stageId:id(value.stageId)};}
  throw Error('Unsupported pipeline action');
}
export function readPipelinePreview(input:unknown):PipelinePreview {
  const value=row(input,['id','selection','steps','edges','warnings']);
  const steps=unique(list(value.steps,8192).map(input=>{const v=row(input,['id','label','stageId','kind']);return{id:label(v.id,300),label:label(v.label),kind:id(v.kind),...(v.stageId!==undefined?{stageId:id(v.stageId)}:{})};}),v=>v.id);
  const edges=list(value.edges,16384).map(input=>{const v=row(input,['from','to']);const from=label(v.from,300),to=label(v.to,300);if(!steps.some(v=>v.id===from)||!steps.some(v=>v.id===to))throw Error('Invalid preview connection');return{from,to};});
  return {id:hex(value.id),selection:readPipelineSelection(value.selection),steps,edges,warnings:list(value.warnings,24).map(v=>label(v,500))};
}
export function readPipelineExecution(input:unknown):PipelineExecutionView {
  const value=row(input,['id','status','releaseId','releaseDigest','stages','recordings','recording','events']);
  const statuses=['pending','running','awaiting-promotion','passed','failed','recovered','incomplete'] as const;
  const stages=unique(list(value.stages,32).map(input=>{const v=row(input,['id','label','strategyId','status','steps','checks','recovery','canPromote','canRecover','recording','changes']);return {
    id:id(v.id),label:label(v.label),strategyId:id(v.strategyId),status:choice(v.status,statuses),
    steps:unique(list(v.steps,4096).map(input=>{const s=row(input,['id','label','status']);return{id:id(s.id),label:label(s.label),status:choice(s.status,['pending','running','passed','failed','skipped','incomplete'] as const)};}),s=>s.id),
    checks:list(v.checks,4096).map(input=>{const c=row(input,['id','passed','status']);const status=choice(c.status,['passed','failed','inconclusive','error','skipped'] as const),passed=bool(c.passed);if(passed!==(status==='passed'))throw Error('Check result differs');return{id:id(c.id),passed,status};}),
    ...(v.recording!==undefined?{recording:readHostActionReceipt({ok:true,recording:v.recording}).recording}:{}),
    changes:list(v.changes,4096).map(input=>{const c=row(input,['resourceId','action']);return{resourceId:id(c.resourceId),action:choice(c.action,['create','update','verify','delete','noop','replace'] as const)};}),
    recovery:choice(v.recovery,['disabled','unavailable','not-needed','available','running','passed','failed','incomplete'] as const),canPromote:bool(v.canPromote),canRecover:bool(v.canRecover)};}),v=>v.id);
  const recordings=list(value.recordings,128).map(input=>{const v=row(input,['runId','status','stageId','kind']);return{runId:label(v.runId,256),stageId:id(v.stageId),kind:choice(v.kind,['rollout','recovery'] as const),status:choice(v.status,['passed','failed','incomplete'] as const)};});
  const events=list(value.events,16384).map(input=>{const v=row(input,['sequence','stageId','label','phase','status','timestamp']);if(!Number.isSafeInteger(v.sequence)||!Number.isFinite(v.timestamp))throw Error('Invalid recorded event');return{sequence:Number(v.sequence),stageId:id(v.stageId),label:label(v.label),phase:label(v.phase),status:choice(v.status,['running','passed','failed','incomplete','rolled-back'] as const),timestamp:Number(v.timestamp)};});
  const recording=value.recording===undefined?undefined:readHostActionReceipt({ok:true,recording:value.recording}).recording;
  return {id:id(value.id),status:choice(value.status,['idle','running','awaiting-promotion','awaiting-recovery','passed','failed','recovered','incomplete'] as const),releaseId:id(value.releaseId),releaseDigest:hex(value.releaseDigest),stages,recordings,events,...(recording?{recording}:{})};
}
export function readPipelineView(input:unknown):PipelineView {
  const value=row(input,['catalog','preview','execution','busy','error']);const catalog=readPipelineCatalog(value.catalog);
  const preview=value.preview===undefined?undefined:readPipelinePreview(value.preview);if(preview)admitPipelineSelection(catalog,preview.selection);
  const execution=value.execution===undefined?undefined:readPipelineExecution(value.execution);
  if(execution&&(!catalog.releases.some(v=>v.id===execution.releaseId&&(!v.digest||v.digest===execution.releaseDigest))||execution.stages.some((stage,index)=>stage.id!==catalog.stages[index]?.id||!catalog.stages[index]?.strategyIds.includes(stage.strategyId))||execution.stages.length!==catalog.stages.length))throw Error('Pipeline execution does not match host catalog');
  return {catalog,...(preview?{preview}:{}),...(execution?{execution}:{}),busy:bool(value.busy),...(value.error!==undefined?{error:label(value.error,1000)}:{})};
}
