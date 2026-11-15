export type * from './migration-types.ts';
export * from './migration-labels.ts';
import { MIGRATION_PHASES } from 'footprintjs-iac/migration';
import { readChangeAssessmentReportShape } from 'footprintjs-iac/change-assessment';
import { readHostActionReceipt } from './host-actions.ts';
import type { MigrationAction,MigrationView,MigrationExecutionView,MigrationReviewView } from './migration-types.ts';
import { migrationRow as row,migrationText as text,migrationId as id,migrationDigest as digest,migrationList as list,migrationBool as bool,migrationChoice as choice,migrationUnique as unique } from './migration-data.ts';
const recording=(input:unknown)=>readHostActionReceipt({ok:true,recording:input}).recording;
export function readMigrationAction(input:unknown):MigrationAction {
  const admitted=row(input,['action','hostId','planId','assessmentDigest','reviewId','executionId']);const action=admitted.action;
  if(action==='assess'){const value=row(input,['action','hostId']);return{action,hostId:id(value.hostId)};}
  if(action==='preview'){const value=row(input,['action','hostId','planId','assessmentDigest']);return{action,hostId:id(value.hostId),planId:id(value.planId),assessmentDigest:digest(value.assessmentDigest)};}
  if(action==='start'){const value=row(input,['action','hostId','reviewId']);return{action,hostId:id(value.hostId),reviewId:digest(value.reviewId)};}
  if(action==='cutover'||action==='recover'){const value=row(input,['action','hostId','executionId']);return{action,hostId:id(value.hostId),executionId:id(value.executionId)};}
  throw Error('Choose a registered migration action');
}
function step(input:unknown){const value=row(input,['id','phase','label']);return{id:id(value.id),phase:choice(value.phase,MIGRATION_PHASES),label:text(value.label)};}
export function readMigrationReview(input:unknown):MigrationReviewView {
  const value=row(input,['id','planId','changeId','assessmentDigest','steps']);const steps=unique(list(value.steps,128).map(step),value=>value.id);
  if(steps.length!==MIGRATION_PHASES.length||steps.some((step,index)=>step.phase!==MIGRATION_PHASES[index]))throw Error('A migration preview must preserve the protected phase order');return{id:digest(value.id),planId:id(value.planId),changeId:id(value.changeId),assessmentDigest:digest(value.assessmentDigest),steps};
}
export function readMigrationExecution(input:unknown):MigrationExecutionView {
  const value=row(input,['id','changeId','status','steps','operations','events','facts','canCutover','canRecover','needsInspection','recordings','recording']);
  const steps=unique(list(value.steps,128).map(input=>{const value=row(input,['id','phase','label','status']);return{...step({id:value.id,phase:value.phase,label:value.label}),status:choice(value.status,['pending','running','waiting','passed','failed','incomplete'] as const)};}),value=>value.id);
  const operations=unique(list(value.operations,4096).map(input=>{const value=row(input,['id','phase','label','status']);return{id:id(value.id),phase:text(value.phase),label:text(value.label),status:choice(value.status,['intent','succeeded','failed','unknown'] as const)};}),value=>value.id);
  const events=list(value.events,16384).map(input=>{const value=row(input,['sequence','stepId','phase','status','label','timestamp']);if(!Number.isSafeInteger(value.sequence)||Number(value.sequence)<1||!Number.isFinite(value.timestamp))throw Error('Invalid migration event');return{sequence:Number(value.sequence),stepId:id(value.stepId),phase:text(value.phase),status:choice(value.status,['running','passed','failed','incomplete'] as const),label:text(value.label),timestamp:Number(value.timestamp)};});
  const facts=row(value.facts,['activeStore','writesPaused','backupSaved','dataChecked','appChecked','previousStoreKept','writesResumed']);
  const result:MigrationExecutionView={id:id(value.id),changeId:id(value.changeId),status:choice(value.status,['idle','running','waiting','passed','recovered','failed','incomplete'] as const),steps,operations,events,
    facts:{activeStore:choice(facts.activeStore,['original','new','unknown'] as const),writesPaused:facts.writesPaused===null?null:bool(facts.writesPaused),backupSaved:bool(facts.backupSaved),dataChecked:bool(facts.dataChecked),appChecked:bool(facts.appChecked),previousStoreKept:bool(facts.previousStoreKept),writesResumed:bool(facts.writesResumed)},
    canCutover:bool(value.canCutover),canRecover:bool(value.canRecover),needsInspection:bool(value.needsInspection),recordings:list(value.recordings,64).map(input=>{const value=row(input,['runId','kind','status']);return{runId:text(value.runId,256),kind:choice(value.kind,['prepare','cutover','recovery'] as const),status:choice(value.status,['passed','failed','incomplete'] as const)};}),...(value.recording!==undefined?{recording:recording(value.recording)}:{})};
  if(result.canCutover&&(result.status!=='waiting'||!result.facts.backupSaved||!result.facts.dataChecked||result.facts.writesPaused!==true||result.facts.activeStore!=='original')||result.canRecover&&result.status!=='waiting'||result.needsInspection&&(result.canCutover||result.canRecover))throw Error('Unsupported migration action state');
  if(steps.length!==MIGRATION_PHASES.length||steps.some((step,index)=>step.phase!==MIGRATION_PHASES[index]))throw Error('Recorded migration phases differ from the protected plan');
  if(result.status==='passed'&&(steps.some(step=>step.status!=='passed')||!result.facts.appChecked||!result.facts.previousStoreKept||!result.facts.writesResumed||result.facts.writesPaused!==false||result.facts.activeStore!=='new'||result.recordings.at(-1)?.status!=='passed'))throw Error('Migration completion lacks confirmed facts');
  if(result.status==='recovered'&&(!result.facts.appChecked||!result.facts.writesResumed||result.facts.writesPaused!==false||result.facts.activeStore!=='original'||result.recordings.at(-1)?.status!=='passed'))throw Error('Recovery completion lacks confirmed facts');
  return result;
}
export function readMigrationView(input:unknown):MigrationView {
  const value=row(input,['id','label','scopeLabel','plans','assessment','review','execution','busy','error']);const assessment=row(value.assessment,['status','resources','report','recording']);
  const result:MigrationView={id:id(value.id),label:text(value.label),scopeLabel:text(value.scopeLabel,500),plans:unique(list(value.plans,64).map(input=>{const value=row(input,['id','label','description']);return{id:id(value.id),label:text(value.label),description:text(value.description,500)};}),value=>value.id),
    assessment:{status:choice(assessment.status,['idle','running','complete','incomplete'] as const),resources:unique(list(assessment.resources,4096).map(input=>{const value=row(input,['id','label','status']);return{id:id(value.id),label:text(value.label),status:choice(value.status,['pending','checking','checked'] as const)};}),value=>value.id),...(assessment.report!==undefined?{report:readChangeAssessmentReportShape(assessment.report)}:{}),...(assessment.recording!==undefined?{recording:recording(assessment.recording)}:{})},
    ...(value.review!==undefined?{review:readMigrationReview(value.review)}:{}),...(value.execution!==undefined?{execution:readMigrationExecution(value.execution)}:{}),busy:bool(value.busy),...(value.error!==undefined?{error:text(value.error,1000)}:{})};
  if(result.execution&&(!result.review||result.execution.changeId!==result.review.changeId||result.execution.steps.some((step,index)=>step.id!==result.review!.steps[index]?.id||step.phase!==result.review!.steps[index]?.phase)))throw Error('Recorded operations do not match the reviewed migration');
  if(result.review&&(!result.plans.some(plan=>plan.id===result.review!.planId)||result.review.assessmentDigest!==result.assessment.report?.digest||!result.assessment.report?.changes.some(change=>change.id===result.review!.changeId)))throw Error('Migration preview differs from the assessed changes');
  return result;
}
