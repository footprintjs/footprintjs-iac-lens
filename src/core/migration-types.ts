import type { ChangeAssessmentReport } from 'footprintjs-iac/change-assessment';
import type { MigrationPhase,MigrationStatus } from 'footprintjs-iac/migration';
import type { Recording } from './types.ts';
export interface MigrationPlanChoice {id:string;label:string;description:string}
export interface MigrationStepView {id:string;phase:MigrationPhase;label:string}
export interface MigrationReviewView {id:string;planId:string;changeId:string;assessmentDigest:string;steps:MigrationStepView[]}
export interface MigrationAssessmentView {
  status:'idle'|'running'|'complete'|'incomplete';
  resources:{id:string;label:string;status:'pending'|'checking'|'checked'}[];
  report?:ChangeAssessmentReport;recording?:Recording;
}
export interface MigrationFacts {
  activeStore:'original'|'new'|'unknown';writesPaused:boolean|null;
  backupSaved:boolean;dataChecked:boolean;appChecked:boolean;previousStoreKept:boolean;writesResumed:boolean;
}
export interface MigrationExecutionView {
  id:string;changeId:string;status:MigrationStatus;
  steps:(MigrationStepView&{status:'pending'|'running'|'waiting'|'passed'|'failed'|'incomplete'})[];
  operations:{id:string;phase:string;label:string;status:'intent'|'succeeded'|'failed'|'unknown'}[];
  events:{sequence:number;stepId:string;phase:string;status:'running'|'passed'|'failed'|'incomplete';label:string;timestamp:number}[];
  facts:MigrationFacts;canCutover:boolean;canRecover:boolean;needsInspection:boolean;
  recordings:{runId:string;kind:'prepare'|'cutover'|'recovery';status:'passed'|'failed'|'incomplete'}[];
  recording?:Recording;
}
export interface MigrationView {
  id:string;label:string;scopeLabel:string;plans:MigrationPlanChoice[];
  assessment:MigrationAssessmentView;review?:MigrationReviewView;execution?:MigrationExecutionView;busy:boolean;error?:string;
}
export type MigrationAction={action:'assess';hostId:string}|{action:'preview';hostId:string;planId:string;assessmentDigest:string}|
  {action:'start';hostId:string;reviewId:string}|{action:'cutover'|'recover';hostId:string;executionId:string};
