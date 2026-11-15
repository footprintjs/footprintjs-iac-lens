import type {ReleaseAutomationPort,ReleaseAutomationState} from 'footprintjs-iac/release-automation';
import {readReleaseAutomationAction,readReleaseAutomationView,type ReleaseAutomationAction,type ReleaseAutomationView} from '../core/release-automation.ts';
import type {Recording} from '../core/types.ts';
import {readHostActionReceipt} from '../core/host-actions.ts';
import type {DeliveryPublication} from './delivery.ts';
import {ReleaseAutomationBinding} from './release-automation-binding.ts';
import {projectReleaseHost,releaseHostBusy} from './release-automation-project.ts';

export interface ReleaseAutomationReviewOptions {
  host:ReleaseAutomationPort;
  stages:ReleaseAutomationView['stages'];
  loadRecording?(state:ReleaseAutomationState,attemptId:string,stageId?:string):Promise<Recording|undefined>;
  subscribePublication?(listener:(publication:DeliveryPublication)=>void):()=>void;
}
export class ReleaseAutomationRequestError extends Error {readonly status:number;constructor(status:number,message:string){super(message);this.status=status;}}
/** The browser chooses IDs; only the host supplies source factories, targets, private receipts and gate tokens. */
export class ReleaseAutomationReview {
  private readonly binding:ReleaseAutomationBinding;
  private latest?:ReleaseAutomationState;
  private view?:ReleaseAutomationView;
  private pending=false;
  private invalid=false;
  private disposed=false;
  private stop?:()=>void;
  private stopPublication?:()=>void;
  private completion:Promise<void>=Promise.resolve();
  private attachments:Promise<void>=Promise.resolve();
  private recordingState?:ReleaseAutomationState;
  private attaching=false;
  private readonly options:ReleaseAutomationReviewOptions;
  private readonly publish:(view:ReleaseAutomationView)=>void;
  private readonly publication:(patch:DeliveryPublication)=>void;
  constructor(options:ReleaseAutomationReviewOptions,publish:(view:ReleaseAutomationView)=>void,publication:(patch:DeliveryPublication)=>void){
    this.options={...options,stages:structuredClone(options.stages)};this.publish=publish;this.publication=publication;this.binding=new ReleaseAutomationBinding(this.options.stages);
  }
  get isBusy():boolean{return this.pending||!!this.latest&&releaseHostBusy(this.latest);}
  snapshot():ReleaseAutomationView{if(!this.view)throw Error('Initialize release controls first');return readReleaseAutomationView(this.view);}
  async initialize():Promise<void>{
    this.accept(this.binding.admit(await this.options.host.snapshot()));
    this.stop=this.options.host.subscribe(input=>{if(this.invalid||this.disposed)return;try{this.accept(this.binding.admit(input));this.queueRecordings(input);}catch{this.quarantine();}});
    this.stopPublication=this.options.subscribePublication?.(patch=>{if(!this.invalid&&!this.disposed)this.publication(patch);});
    this.queueRecordings(this.latest!);await this.attachments;
  }
  async action(input:ReleaseAutomationAction):Promise<void>{
    let action:ReleaseAutomationAction;
    try{action=readReleaseAutomationAction(input);}catch{throw new ReleaseAutomationRequestError(400,'Choose a registered release action');}
    if(!this.latest||action.hostId!==this.latest.definition.id)throw new ReleaseAutomationRequestError(400,'Choose the configured release host');
    if(this.invalid||this.disposed)throw new ReleaseAutomationRequestError(409,'The release host needs inspection');
    if(this.isBusy)throw new ReleaseAutomationRequestError(409,'Wait for the current release task');
    if(action.action==='refresh'){this.run(()=>this.options.host.refresh());return;}
    if(action.action==='deploy'){
      if(this.latest.discoveryStatus!=='available'||!this.latest.choices.some(choice=>choice.id===action.releaseId))throw new ReleaseAutomationRequestError(400,'Refresh and choose a discovered release');
      if(this.latest.attempts.some(attempt=>attempt.releaseId===action.releaseId))throw new ReleaseAutomationRequestError(409,'This release has a retained attempt; inspect its outcome');
      if(this.latest.attempts.some(attempt=>['waiting','incomplete'].includes(attempt.status)))throw new ReleaseAutomationRequestError(409,'Inspect the outstanding release before starting another');
      this.run(()=>this.options.host.start(action.releaseId));return;
    }
    const attempt=this.latest.attempts.find(attempt=>attempt.id===action.attemptId),gate=attempt?.pipeline?.pendingAction;
    if(attempt?.status!=='waiting'||gate?.kind!==action.action||gate.stageId!==action.stageId)throw new ReleaseAutomationRequestError(409,'This release action is no longer available');
    const request={stageId:gate.stageId,token:gate.token,releaseDigest:gate.releaseDigest};
    this.run(()=>this.options.host[action.action](attempt.id,request));
  }
  async whenIdle():Promise<void>{await this.completion;await this.attachments;}
  dispose():void{this.disposed=true;this.stop?.();this.stopPublication?.();}
  private accept(state:ReleaseAutomationState):void {
    if(this.invalid||this.disposed)return;
    this.latest=state;
    const next=projectReleaseHost(state,this.options.stages,this.pending||releaseHostBusy(state));
    if(this.view?.error)next.error=this.view.error;
    for(const attempt of next.attempts){const previous=this.view?.attempts.find(item=>item.id===attempt.id);
      if(previous?.recording)attempt.recording=previous.recording;
      if(attempt.pipeline&&previous?.pipeline){if(previous.pipeline.recording)attempt.pipeline.recording=previous.pipeline.recording;
        for(const stage of attempt.pipeline.stages){const old=previous.pipeline.stages.find(item=>item.id===stage.id);if(old?.recording)stage.recording=old.recording;}}
    }
    this.view=next;this.emit();
  }
  private run(operation:()=>Promise<ReleaseAutomationState>):void {
    this.pending=true;if(this.view){this.view.busy=true;delete this.view.error;}this.emit();
    this.completion=(async()=>{
      try{
        const returned=await operation();
        try{this.accept(this.binding.admit(returned));}catch{this.quarantine();throw Error('The release host binding changed');}
        this.queueRecordings(returned);
      }
      catch{
        if(!this.invalid)try{const state=this.binding.admit(await this.options.host.snapshot());this.accept(state);this.queueRecordings(state);}catch{this.quarantine();}
        if(this.view)this.view.error='The release needs inspection. Completed work and its native evidence are retained.';
      }finally{this.pending=false;if(this.view)this.view.busy=!!this.latest&&releaseHostBusy(this.latest);this.emit();}
    })();
  }
  private quarantine():void {
    this.invalid=true;if(this.view){this.view.error='The release source, environment or recorded host binding changed. Inspect the retained evidence.';
      for(const attempt of this.view.attempts){const affected=attempt===this.view.attempts.at(-1)&&attempt.status!=='skipped';
        if(affected||['reserved','resolving','preparing','deploying','waiting'].includes(attempt.status))attempt.status='incomplete';
        if(attempt.pipeline){for(const stage of attempt.pipeline.stages){stage.canPromote=false;stage.canRecover=false;}if(affected||['running','awaiting-promotion','awaiting-recovery'].includes(attempt.pipeline.status))attempt.pipeline.status='incomplete';}}}
    this.emit();
  }
  private queueRecordings(state:ReleaseAutomationState):void {
    if(!this.options.loadRecording||this.invalid||this.disposed)return;
    this.recordingState=state;if(this.attaching)return;this.attaching=true;
    this.attachments=(async()=>{try{while(this.recordingState&&!this.invalid&&!this.disposed){const next=this.recordingState;this.recordingState=undefined;await this.attach(next);}}
      catch{if(this.view){this.view.error='The outcome is retained, but a detailed recording could not be opened.';this.emit();}}
      finally{this.attaching=false;}})();
  }
  private async attach(state:ReleaseAutomationState):Promise<void>{
    const load=this.options.loadRecording!;
    for(const attempt of state.attempts){
      for(const stage of attempt.pipeline?.stages??[]){
        const receipt=attempt.pipeline!.recordings.findLast(item=>item.stageId===stage.id);if(!receipt)continue;
        const existing=this.view?.attempts.find(item=>item.id===attempt.id)?.pipeline?.stages.find(item=>item.id===stage.id)?.recording;
        if((existing?.snapshot as {runId?:string}|undefined)?.runId===receipt.runId)continue;
        const loaded=await load(state,attempt.id,stage.id);if(!loaded)continue;const recording=this.checkRecording(loaded,receipt.runId);
        const current=this.latest?.attempts.find(item=>item.id===attempt.id)?.pipeline,view=this.view?.attempts.find(item=>item.id===attempt.id)?.pipeline;
        if(!this.invalid&&!this.disposed&&current?.recordings.findLast(item=>item.stageId===stage.id)?.runId===receipt.runId&&view){
          view.stages.find(item=>item.id===stage.id)!.recording=recording;if(current.recordings.at(-1)?.runId===receipt.runId)view.recording=recording;
        }
      }
      const receipt=attempt.recordings.at(-1)??attempt.preparation?.recordings.at(-1);if(!receipt)continue;
      const view=this.view?.attempts.find(item=>item.id===attempt.id);
      if((view?.recording?.snapshot as {runId?:string}|undefined)?.runId===receipt.runId)continue;
      const loaded=await load(state,attempt.id);if(!loaded)continue;const recording=this.checkRecording(loaded,receipt.runId);
      const current=this.latest?.attempts.find(item=>item.id===attempt.id),currentReceipt=current?.recordings.at(-1)??current?.preparation?.recordings.at(-1);
      if(view&&!this.invalid&&!this.disposed&&currentReceipt?.runId===receipt.runId)view.recording=recording;
    }
    this.emit();
  }
  private checkRecording(input:Recording,runId:string):Recording{
    const recording=readHostActionReceipt({ok:true,recording:input}).recording!;
    if((recording.snapshot as {runId?:unknown})?.runId!==runId)throw Error('Native recording belongs to another release');return recording;
  }
  private emit():void{if(this.view&&!this.disposed)this.publish(this.snapshot());}
}
