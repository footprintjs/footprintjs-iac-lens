import type { MigrationPhase } from 'footprintjs-iac/migration';
import type { AssessedResourceChange } from 'footprintjs-iac/change-assessment';
import type { MigrationExecutionView,MigrationReviewView } from './migration-types.ts';
export const migrationLabels:Record<MigrationPhase,string>={inspect:'Inspect current store',quiesce:'Pause writes',backup:'Save backup',create:'Prepare new store',transfer:'Move data','verify-data':'Check data',cutover:'Switch app','verify-consumer':'Check app',retain:'Keep previous store',resume:'Resume writes'};
export function migrationPhaseLabel(phase:string):string{return migrationLabels[phase as MigrationPhase]??({'recover-source':'Restore original connection','verify-recovery':'Check original app','resume-source':'Resume original writes',revalidate:'Recheck saved checkpoint'} as Record<string,string>)[phase]??'Inspect recorded step';}
export function migrationHeadline(execution?:MigrationExecutionView):string{
  if(!execution||execution.status==='idle')return 'Ready to review changes';
  if(execution.status==='passed')return 'New store active';if(execution.status==='recovered')return 'Original app resumed';
  if(execution.needsInspection||execution.status==='incomplete')return 'Needs inspection';
  if(execution.canCutover)return 'Data checked · Awaiting approval';if(execution.canRecover)return 'Paused · Recovery needs approval';
  if(execution.status==='failed')return 'Needs attention';
  return execution.steps.find(step=>step.status==='running')?.label??'Working on the migration';
}
/** A replacement assessment alone never promises a safe data switch. */
export function migrationChangeLabel(change:AssessedResourceChange,execution?:MigrationExecutionView,review?:MigrationReviewView):string{
  if(change.disposition==='noop'||change.disposition==='verify')return 'Keep';
  if(change.disposition==='update')return 'Update here';if(change.disposition==='create')return 'Create';
  if(change.disposition==='replace'&&review?.changeId===change.id&&execution?.changeId===change.id&&execution.facts.backupSaved&&execution.facts.dataChecked&&(execution.canCutover||execution.status==='passed'))return 'Replace safely';
  return 'Needs attention';
}
