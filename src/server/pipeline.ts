import type { PipelineState, PipelineWorkflowPort, RolloutPlan } from 'footprintjs-iac/pipeline';
import type { PipelineCatalog, PipelineSelection, PipelineAction, PipelineView } from '../core/pipeline.ts';
import { readPipelineAction, readPipelineCatalog, admitPipelineSelection, readPipelineView } from '../core/pipeline.ts';
import { projectPipelinePreview, projectPipelineState } from '../core/pipeline-project.ts';
import type { DeliveryPublication } from './delivery.ts';
import { admitPipelineHostState,pipelineFingerprint,type PipelineBinding } from './pipeline-binding.ts';
import type { Recording } from '../core/types.ts';

export interface PreparedPipeline {
  workflow: PipelineWorkflowPort;
  /** Compiled by the base library, never supplied by the browser. */
  plans: Record<string, RolloutPlan>;
}
export interface PipelineReviewOptions {
  catalog: PipelineCatalog;
  /** Host resolves registered release/adapter/target IDs. Preparation must not execute deployments. */
  prepare(selection: PipelineSelection): Promise<PreparedPipeline>;
  /** Optional host-owned existing run restored for read-only inspection or a durable gate. */
  current?: { selection: PipelineSelection; prepared: PreparedPipeline };
  subscribePublication?(listener:(publication:DeliveryPublication)=>void):()=>void;
  loadRecording?(state:PipelineState,stageId:string):Promise<Recording|undefined>;
}
export class PipelineRequestError extends Error { readonly status:number;constructor(status:number,message:string){super(message);this.status=status;} }
export class PipelineReview {
  private view:PipelineView;
  private prepared?:PreparedPipeline;
  private latest?:PipelineState;
  private stop?:()=>void;
  private stopPublication?:()=>void;
  private pending=false;
  private binding?:PipelineBinding;
  private invalidBinding=false;
  private completion:Promise<void>=Promise.resolve();
  private options:PipelineReviewOptions;
  private publish:(view:PipelineView)=>void;
  private publication:(patch:DeliveryPublication)=>void;
  constructor(options:PipelineReviewOptions,publish:(view:PipelineView)=>void,publication:(patch:DeliveryPublication)=>void){
    this.options=options;this.publish=publish;this.publication=publication;
    this.view={catalog:readPipelineCatalog(options.catalog),busy:false};
  }
  get isBusy():boolean{return this.pending;}
  snapshot():PipelineView{return structuredClone(this.view);}
  async initialize():Promise<void>{
    if(this.options.current){
      const selection=admitPipelineSelection(this.view.catalog,this.options.current.selection);
      await this.install(selection,this.options.current.prepared);
      if(this.latest?.status==='running'){this.view.execution!.status='incomplete';this.view.error='A stored run needs inspection; this viewer cannot confirm it is still running.';}
    }
    this.stopPublication=this.options.subscribePublication?.(patch=>this.publication(patch));this.emit();
  }
  async action(input:PipelineAction):Promise<void>{
    let action:PipelineAction;
    try{action=readPipelineAction(input);}catch{throw new PipelineRequestError(400,'Choose registered pipeline settings');}
    if(action.pipelineId!==this.view.catalog.id)throw new PipelineRequestError(400,'Choose the configured pipeline');
    if(this.invalidBinding)throw new PipelineRequestError(409,'The recorded host binding needs inspection');
    if(this.pending)throw new PipelineRequestError(409,'Wait for the current pipeline task');
    if(action.action==='preview'){
      if(this.latest&&this.latest.status!=='idle')throw new PipelineRequestError(409,'This pipeline already has a retained execution');
      let selection:PipelineSelection;try{selection=admitPipelineSelection(this.view.catalog,action.selection);}catch{throw new PipelineRequestError(400,'Unsupported strategy, option, check or schedule');}
      this.pending=true;this.view.busy=true;delete this.view.error;this.emit();
      try{await this.install(selection,await this.options.prepare(selection));}
      catch{this.view.error='These settings could not be compiled by the configured adapters. Review the supported choices.';delete this.view.preview;this.prepared=undefined;this.latest=undefined;delete this.view.execution;throw new PipelineRequestError(400,'The configured adapters refused these settings');}
      finally{this.pending=false;this.view.busy=false;this.emit();}return;
    }
    if(!this.prepared||!this.latest||!this.view.preview)throw new PipelineRequestError(409,'Preview this pipeline first');
    if(action.action==='start'){
      if(action.previewId!==this.view.preview.id||this.latest.status!=='idle')throw new PipelineRequestError(409,'Choose the current unstarted preview');
      this.run(()=>this.prepared!.workflow.start());return;
    }
    const pending=this.latest.pendingAction;
    if(action.executionId!==this.view.execution?.id||pending?.kind!==action.action||pending.stageId!==action.stageId)throw new PipelineRequestError(409,'This recorded action is no longer available');
    this.run(()=>this.prepared!.workflow[action.action]({stageId:pending.stageId,token:pending.token,releaseDigest:pending.releaseDigest}));
  }
  whenIdle():Promise<void>{return this.completion;}
  dispose():void{this.stop?.();this.stopPublication?.();}
  private async install(selection:PipelineSelection,prepared:PreparedPipeline):Promise<void>{
    const admitted=admitPipelineHostState(await prepared.workflow.snapshot(),this.view.catalog,selection);const state=admitted.state;
    if(state.status!=='idle'&&!this.options.current)throw Error('Prepare must produce an unstarted workflow');
    const identity=pipelineFingerprint({selection,binding:admitted.binding});
    const preview=projectPipelinePreview(identity,selection,state,prepared.plans);
    this.stop?.();this.prepared=prepared;this.binding=admitted.binding;this.invalidBinding=false;this.latest=state;this.view.preview=preview;
    this.accept(state);this.stop=prepared.workflow.subscribe(state=>{try{this.accept(this.admit(state));}catch{this.quarantine();}});
    await this.attach(state);
  }
  private admit(input:PipelineState):PipelineState {
    if(!this.binding||!this.view.preview||this.invalidBinding)throw Error('The installed binding needs inspection');
    const state=admitPipelineHostState(input,this.view.catalog,this.view.preview.selection,this.binding).state;
    if(this.latest?.executionId&&state.executionId!==this.latest.executionId)throw Error('Execution identity changed');
    return state;
  }
  private quarantine():void {
    this.invalidBinding=true;this.view.error='The pipeline target or release changed unexpectedly. Inspect the retained native evidence before another action.';
    if(this.view.execution){this.view.execution.status='incomplete';for(const stage of this.view.execution.stages){stage.canPromote=false;stage.canRecover=false;if(stage.status==='running')stage.status='incomplete';}}
    this.emit();
  }
  private accept(state:PipelineState):void{
    this.latest=state;const view=projectPipelineState(state,this.view.preview!.selection.releaseId);
    if(this.view.execution?.id===view.id){
      if(this.view.execution.recording)view.recording=this.view.execution.recording;
      for(const stage of view.stages){const previous=this.view.execution.stages.find(v=>v.id===stage.id);if(previous?.recording)stage.recording=previous.recording;}
    }
    this.view.execution=view;this.emit();
  }
  private async attach(state:PipelineState):Promise<void>{
    if(!state.recordings.length||!this.options.loadRecording)return;
    try{
      for(const stage of state.stages){const receipt=state.recordings.findLast(v=>v.stageId===stage.id);if(!receipt)continue;
        const recording=await this.options.loadRecording(state,stage.id);if(!recording)continue;
        if((recording.snapshot as {runId?:unknown})?.runId!==receipt.runId)throw Error('Recording is not bound to this stage');
        this.view.execution!.stages.find(v=>v.id===stage.id)!.recording=recording;
        if(receipt.runId===state.recordings.at(-1)?.runId)this.view.execution!.recording=recording;
      }
    }
    catch{this.view.error='The recorded outcome is retained, but its detailed recording could not be opened.';}
    this.emit();
  }
  private run(operation:()=>Promise<PipelineState>):void{
    this.pending=true;this.view.busy=true;delete this.view.error;this.emit();
    this.completion=(async()=>{
      try{
        const returned=await operation();let state:PipelineState;
        try{state=this.admit(returned);}catch{this.quarantine();throw Error('Unexpected pipeline binding');}
        this.accept(state);await this.attach(state);
      }catch{
        if(!this.invalidBinding){try{const state=this.admit(await this.prepared!.workflow.snapshot());this.accept(state);await this.attach(state);}catch{this.quarantine();}}
        this.view.error='The pipeline needs inspection. Completed operations and their evidence are retained.';
      }finally{this.pending=false;this.view.busy=false;this.emit();}
    })();
  }
  private emit():void{this.publish(readPipelineView(this.view));}
}
