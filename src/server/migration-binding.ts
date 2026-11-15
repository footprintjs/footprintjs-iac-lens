import { createHash } from 'node:crypto';
import { readMigrationState,readMigrationPlan,type MigrationState,type MigrationPlan } from 'footprintjs-iac/migration';
import { readChangeAssessmentReport,type ChangeAssessmentState,type ChangeAssessmentReport } from 'footprintjs-iac/change-assessment/node';
export interface MigrationBinding {definitionDigest:string;definition:string;plan:string;assessmentDigest:string}
export function migrationFingerprint(input:unknown):string {
  const canonical=(value:unknown):string=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical((value as Record<string,unknown>)[key])).join(',')+'}':JSON.stringify(value);
  return createHash('sha256').update(canonical(input)).digest('hex');
}
export function admitMigrationBinding(input:MigrationState,planInput:MigrationPlan,reportInput:ChangeAssessmentReport,binding?:MigrationBinding){
  const state=readMigrationState(input),plan=readMigrationPlan(planInput),report=readChangeAssessmentReport(reportInput);
  const change=report.changes.find(change=>change.id===state.definition.changeId);
  if(state.definition.assessmentDigest!==report.digest||!change||change.disposition!=='replace'||change.data==='unknown'||report.target.scopeDigest!==migrationFingerprint(state.definition.source.scope))throw Error('The migration is not bound to an established assessed replacement');
  const next={definitionDigest:state.definitionDigest,definition:migrationFingerprint(state.definition),plan:migrationFingerprint(plan),assessmentDigest:report.digest};
  if(binding&&migrationFingerprint(binding)!==migrationFingerprint(next))throw Error('The admitted migration binding changed');
  return{state,plan,report,binding:next};
}
export function admitAssessmentReport(state:ChangeAssessmentState):ChangeAssessmentReport|undefined {
  if(!state.report)return;
  const report=readChangeAssessmentReport(state.report);
  if(report.definitionDigest!==state.definitionDigest||report.executionId!==state.executionId)throw Error('The assessment report belongs to another execution');
  return report;
}
