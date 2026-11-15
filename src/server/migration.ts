import { readChangeAssessmentState,type ChangeAssessmentState,type ChangeAssessmentReport,type ChangeAssessmentWorkflowPort } from 'footprintjs-iac/change-assessment/node';
import type { MigrationPlan,MigrationState,MigrationWorkflowPort } from 'footprintjs-iac/migration';
import { readMigrationAction,readMigrationView,type MigrationAction,type MigrationView,type MigrationPlanChoice } from '../core/migration.ts';
import { projectMigrationAssessment,projectMigrationReview,projectMigrationState } from '../core/migration-project.ts';
import { admitAssessmentReport,admitMigrationBinding,migrationFingerprint,type MigrationBinding } from './migration-binding.ts';
import type { Recording } from '../core/types.ts';
import type { DeliveryPublication } from './delivery.ts';
export interface PreparedMigration {workflow:MigrationWorkflowPort;plan:MigrationPlan}
export interface MigrationReviewOptions {
  id:string;label:string;scopeLabel:string;plans:MigrationPlanChoice[];assessment:ChangeAssessmentWorkflowPort;
  /** Resolve registered IDs to a pure admitted plan; do not perform migration effects here. */
  prepare(planId:string,report:ChangeAssessmentReport):Promise<PreparedMigration>;
  current?:{planId:string;prepared:PreparedMigration};
  subscribePublication?(listener:(patch:DeliveryPublication)=>void):()=>void;
  loadAssessmentRecording?(state:ChangeAssessmentState):Promise<Recording|undefined>;
  loadRecording?(state:MigrationState):Promise<Recording|undefined>;
}
export class MigrationRequestError extends Error {readonly status:number;constructor(status:number,message:string){super(message);this.status=status;}}
export class MigrationReview {
  private options:MigrationReviewOptions;private publish:(view:MigrationView)=>void;private publication:(patch:DeliveryPublication)=>void;
  private view:MigrationView;private assessment?:ChangeAssessmentState;private assessmentBinding?:string;private assessmentReportDigest?:string;
  private prepared?:PreparedMigration;private state?:MigrationState;private binding?:MigrationBinding;
  private pending=false;private quarantined=false;private completion:Promise<void>=Promise.resolve();
  private stopAssessment?:()=>void;private stopMigration?:()=>void;private stopPublication?:()=>void;
  constructor(options:MigrationReviewOptions,publish:(view:MigrationView)=>void,publication:(patch:DeliveryPublication)=>void){
    this.options=options;this.publish=publish;this.publication=publication;
    this.view=readMigrationView({id:options.id,label:options.label,scopeLabel:options.scopeLabel,plans:options.plans,assessment:{status:'idle',resources:[]},busy:false});
  }
  get isBusy():boolean{return this.pending;}
  snapshot():MigrationView{return structuredClone(this.view);}
  whenIdle():Promise<void>{return this.completion;}
  dispose():void{this.stopAssessment?.();this.stopMigration?.();this.stopPublication?.();}
  async initialize():Promise<void>{
    this.acceptAssessment(this.admitAssessment(await this.options.assessment.snapshot()));
    if(this.assessment?.status==='running'){this.view.assessment.status='incomplete';this.view.error='The stored assessment needs inspection. This viewer does not own a confirmed active execution.';}
    this.stopAssessment=this.options.assessment.subscribe(state=>{try{this.acceptAssessment(this.admitAssessment(state));}catch{this.quarantine();}});
    if(this.assessment)await this.attachAssessment(this.assessment);
    if(this.options.current)await this.install(this.options.current.planId,this.options.current.prepared,true);
    this.stopPublication=this.options.subscribePublication?.(patch=>this.publication(patch));this.emit();
  }
  async action(input:MigrationAction):Promise<void>{
    let action:MigrationAction;try{action=readMigrationAction(input);}catch{throw new MigrationRequestError(400,'Choose a registered migration action');}
    if(action.hostId!==this.view.id)throw new MigrationRequestError(400,'Choose the configured migration host');
    if(this.pending)throw new MigrationRequestError(409,'Wait for the current task');
    if(this.quarantined)throw new MigrationRequestError(409,'Inspect the retained host binding before another action');
    if(action.action==='assess'){
      if(this.assessment?.status!=='idle'||this.state)throw new MigrationRequestError(409,'This assessment already has a retained outcome');
      this.runAssessment();return;
    }
    if(action.action==='preview'){
      if(this.assessment?.status!=='complete'||!this.assessment.report||action.assessmentDigest!==this.assessment.report.digest)throw new MigrationRequestError(409,'Complete the current read-only assessment first');
      if(!this.view.plans.some(plan=>plan.id===action.planId))throw new MigrationRequestError(400,'Choose a registered migration plan');
      if(this.state&&this.state.status!=='idle')throw new MigrationRequestError(409,'This migration already has a retained execution');
      this.stopMigration?.();this.prepared=undefined;this.state=undefined;this.binding=undefined;delete this.view.review;delete this.view.execution;
      this.pending=true;this.view.busy=true;delete this.view.error;this.emit();
      try{await this.install(action.planId,await this.options.prepare(action.planId,this.assessment.report));}
      catch{this.view.error='The configured migration adapter could not admit this assessment and plan.';throw new MigrationRequestError(400,'The assessed migration plan was refused');}
      finally{this.pending=false;this.view.busy=false;this.emit();}return;
    }
    if(!this.prepared||!this.state||!this.view.review)throw new MigrationRequestError(409,'Review the assessed migration plan first');
    if(action.action==='start'){
      if(action.reviewId!==this.view.review.id||this.state.status!=='idle')throw new MigrationRequestError(409,'Choose the current unstarted migration review');
      this.runMigration(()=>this.prepared!.workflow.start());return;
    }
    const pending=this.state.pendingAction;
    if(action.executionId!==this.state.executionId||pending?.kind!==action.action)throw new MigrationRequestError(409,'The recorded approval is no longer available');
    this.runMigration(()=>this.prepared!.workflow[action.action]({executionId:pending.executionId,token:pending.token,checkpointDigest:pending.checkpointDigest}));
  }
  private admitAssessment(input:ChangeAssessmentState):ChangeAssessmentState {
    const state=readChangeAssessmentState(input),fingerprint=migrationFingerprint({definition:state.definition,definitionDigest:state.definitionDigest});
    if(this.assessmentBinding&&this.assessmentBinding!==fingerprint||this.assessment?.executionId&&state.executionId!==this.assessment.executionId)throw Error('Assessment host binding changed');
    const report=admitAssessmentReport(state);if(this.assessmentReportDigest&&report?.digest!==this.assessmentReportDigest)throw Error('The completed assessment changed');if(report)this.assessmentReportDigest??=report.digest;
    this.assessmentBinding??=fingerprint;return state;
  }
  private acceptAssessment(state:ChangeAssessmentState):void {
    this.assessment=state;const view=projectMigrationAssessment(state);if(this.view.assessment.recording)view.recording=this.view.assessment.recording;this.view.assessment=view;this.emit();
  }
  private async install(planId:string,prepared:PreparedMigration,current=false):Promise<void>{
    if(!this.assessment?.report||this.assessment.status!=='complete'||!this.view.plans.some(plan=>plan.id===planId))throw Error('Migration needs a complete matching assessment');
    const admitted=admitMigrationBinding(await prepared.workflow.snapshot(),prepared.plan,this.assessment.report);
    if(!current&&admitted.state.status!=='idle')throw Error('Prepare an unstarted migration');
    const review=projectMigrationReview(migrationFingerprint({planId,binding:admitted.binding}),planId,admitted.state,admitted.plan);
    this.stopMigration?.();this.prepared={workflow:prepared.workflow,plan:admitted.plan};this.binding=admitted.binding;this.view.review=review;this.state=admitted.state;
    this.acceptMigration(admitted.state);
    this.stopMigration=prepared.workflow.subscribe(state=>{try{this.acceptMigration(this.admitMigration(state));}catch{this.quarantine();}});
    if(current&&admitted.state.status==='running'){this.view.execution!.status='incomplete';this.view.execution!.needsInspection=true;this.view.execution!.canCutover=false;this.view.execution!.canRecover=false;this.view.error='The stored migration needs inspection; it is not automatically replayed.';}
    await this.attachMigration(admitted.state);this.emit();
  }
  private admitMigration(input:MigrationState):MigrationState {
    if(!this.prepared||!this.binding||!this.assessment?.report||this.quarantined)throw Error('The migration needs inspection');
    const state=admitMigrationBinding(input,this.prepared.plan,this.assessment.report,this.binding).state;
    if(this.state?.executionId&&state.executionId!==this.state.executionId)throw Error('Migration execution changed');return state;
  }
  private acceptMigration(state:MigrationState):void {this.state=state;const view=projectMigrationState(state,this.prepared!.plan);if(this.view.execution?.recording)view.recording=this.view.execution.recording;this.view.execution=view;this.emit();}
  private quarantine():void {this.quarantined=true;this.view.error='A host definition or recorded binding changed unexpectedly. Inspect retained evidence before continuing.';if(this.view.execution){this.view.execution.status='incomplete';this.view.execution.needsInspection=true;this.view.execution.canCutover=false;this.view.execution.canRecover=false;this.view.execution.facts={activeStore:'unknown',writesPaused:null,backupSaved:false,dataChecked:false,appChecked:false,previousStoreKept:false,writesResumed:false};}else this.view.assessment.status='incomplete';this.emit();}
  private async attachAssessment(state:ChangeAssessmentState):Promise<void>{
    if(!state.recording||!this.options.loadAssessmentRecording)return;try{const recording=await this.options.loadAssessmentRecording(state);if(recording){if((recording.snapshot as {runId?:unknown})?.runId!==state.recording.runId)throw Error('Foreign assessment recording');this.view.assessment.recording=recording;}}catch{this.view.error='The assessment outcome is retained, but its detailed recording could not be opened.';}this.emit();
  }
  private async attachMigration(state:MigrationState):Promise<void>{
    const receipt=state.recordings.at(-1);if(!receipt||!this.options.loadRecording)return;try{const recording=await this.options.loadRecording(state);if(recording){if((recording.snapshot as {runId?:unknown})?.runId!==receipt.runId)throw Error('Foreign migration recording');this.view.execution!.recording=recording;}}catch{this.view.error='The migration outcome is retained, but its detailed recording could not be opened.';}this.emit();
  }
  private runAssessment():void {this.begin();this.completion=(async()=>{try{let state:ChangeAssessmentState;const returned=await this.options.assessment.start();try{state=this.admitAssessment(returned);}catch{this.quarantine();throw Error('Unexpected assessment binding');}this.acceptAssessment(state);await this.attachAssessment(state);}catch{this.view.error='The read-only assessment did not complete with usable evidence.';}finally{this.finish();}})();}
  private runMigration(operation:()=>Promise<MigrationState>):void {this.begin();this.completion=(async()=>{try{let state:MigrationState;const returned=await operation();try{state=this.admitMigration(returned);}catch{this.quarantine();throw Error('Unexpected migration binding');}this.acceptMigration(state);await this.attachMigration(state);}catch{if(!this.quarantined)try{const state=this.admitMigration(await this.prepared!.workflow.snapshot());this.acceptMigration(state);await this.attachMigration(state);}catch{this.quarantine();}this.view.error='The migration needs inspection. Its completed operations and original-store evidence are retained.';}finally{this.finish();}})();}
  private begin():void {this.pending=true;this.view.busy=true;delete this.view.error;this.emit();}
  private finish():void {this.pending=false;this.view.busy=false;this.emit();}
  private emit():void {this.publish(readMigrationView(this.view));}
}
