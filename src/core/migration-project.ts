import type { ChangeAssessmentState } from 'footprintjs-iac/change-assessment';
import type { MigrationPlan,MigrationState } from 'footprintjs-iac/migration';
import type { MigrationAssessmentView,MigrationExecutionView,MigrationReviewView } from './migration-types.ts';
import { readMigrationExecution,readMigrationReview } from './migration.ts';
import { migrationPhaseLabel } from './migration-labels.ts';
export function projectMigrationAssessment(state:ChangeAssessmentState):MigrationAssessmentView {
  return{status:state.status,resources:state.definition.changes.map(change=>({id:change.id,label:change.label,status:state.events.findLast(event=>event.changeId===change.id)?.status==='checked'?'checked':state.events.some(event=>event.changeId===change.id)?'checking':'pending'})),...(state.report?{report:state.report}:{})};
}
export function projectMigrationReview(id:string,planId:string,state:MigrationState,plan:MigrationPlan):MigrationReviewView {
  return readMigrationReview({id,planId,changeId:state.definition.changeId,assessmentDigest:state.definition.assessmentDigest,steps:plan.steps.map(step=>({id:step.id,phase:step.phase,label:migrationPhaseLabel(step.phase)}))});
}
/** Native checkpoints and observations provide facts; a desired destination never becomes measured state. */
export function projectMigrationState(state:MigrationState,plan:MigrationPlan):MigrationExecutionView {
  const steps=plan.steps.map(step=>{const operation=state.operations.find(value=>value.id===step.id);const status=operation?.status==='intent'?'running':operation?.status==='succeeded'?'passed':operation?.status==='failed'?'failed':operation?.status==='unknown'?'incomplete':step.phase==='cutover'&&state.pendingAction?.kind==='cutover'?'waiting':'pending';return{id:step.id,phase:step.phase,label:migrationPhaseLabel(step.phase),status};});
  const latest=state.operations.at(-1),uncertainLatest=latest?.status==='unknown'&&!latest.receipt?.observation&&!latest.observation;
  const switching=latest?.status==='intent'&&['quiesce','cutover','resume','recover-source','resume-source'].includes(latest.phase);
  const last=uncertainLatest||switching?undefined:state.operations.findLast(operation=>operation.status!=='intent'&&(operation.receipt||operation.observation));const observed=last?.receipt?.observation??last?.observation;
  const facts={activeStore:observed?.active==='source'?'original':observed?.active==='destination'?'new':'unknown',writesPaused:observed?observed.fence!==null:null,
    backupSaved:!!state.checkpoint.backup,dataChecked:state.checkpoint.verification?.passed===true,appChecked:state.checkpoint.consumerVerified===true,
    previousStoreKept:state.checkpoint.retained===true&&observed?.sourceRetained===true,writesResumed:state.checkpoint.writesResumed===true};
  return readMigrationExecution({id:state.executionId??state.definition.id,changeId:state.definition.changeId,status:state.status,steps,
    operations:state.operations.map(operation=>({id:operation.id,phase:operation.phase,label:migrationPhaseLabel(operation.phase),status:operation.status})),
    events:state.events.map(event=>({sequence:event.sequence,stepId:event.stepId,phase:event.phase,status:event.status,timestamp:event.timestamp,label:event.status==='failed'?'Needs attention':event.status==='incomplete'?'Needs inspection':`${migrationPhaseLabel(event.phase)}${event.status==='passed'?' · done':''}`})),facts,
    canCutover:state.pendingAction?.kind==='cutover',canRecover:state.pendingAction?.kind==='recover',needsInspection:state.pendingAction?.kind==='inspect'||state.status==='incomplete',
    recordings:state.recordings.map(({runId,kind,status})=>({runId,kind,status}))});
}
