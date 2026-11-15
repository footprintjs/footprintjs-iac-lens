import { randomUUID, createHash } from 'node:crypto';
import { join } from 'node:path';
import { defineReleaseManifest } from 'footprintjs-iac/releases/node';
import { directStrategy, canaryStrategy, blueGreenStrategy, compileRolloutPlans, type PipelineDefinition, type PipelineRegistry } from 'footprintjs-iac/pipeline';
import { PipelineWorkflow, FilePipelineStore, FilePipelineTargetStore, loadPipelineRecording } from 'footprintjs-iac/pipeline/node';
import type { PipelineReviewOptions } from '../../src/server/pipeline.ts';
import type { PipelineSelection } from '../../src/core/pipeline.ts';
import { pipelineCatalog } from './catalog.ts';
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const pause=()=>new Promise<void>(accept=>setTimeout(accept,180));
/** A labelled simulator host. No Kubernetes, cloud, GitHub or application login is exercised here. */
export async function createStrategyExample(directory:string):Promise<PipelineReviewOptions> {
  const manifest=(id:string,letter:string,label:string)=>defineReleaseManifest({id,label,source:{repository:'https://github.com/example/simulation',ref:id,commit:letter.repeat(40),tree:letter.repeat(40)},recipe:{id:'example-build',digest:'a'.repeat(64)},artifacts:[{id:'application',digest:letter.repeat(64),reference:'simulation/application@sha256:'+letter.repeat(64)}]});
  const baseline=manifest('release-baseline','b','Current verified example'),candidate=manifest('release-next','c','Example update'),failing=manifest('release-failing','d','Example with a failed Gamma check');
  const releases=[candidate,failing],catalog=pipelineCatalog(releases),targets=new FilePipelineTargetStore(join(directory,'targets'));
  const actual=new Map<string,string>();
  const suites=[{id:'health',label:'Application health',kind:'simulation',digest:digest('health')},{id:'access',label:'Login and access contract',kind:'simulation',digest:digest('access')}];
  const registry:PipelineRegistry={strategies:[directStrategy(),canaryStrategy(),blueGreenStrategy(),{id:'custom',label:'Registered custom strategy',plan:()=>({steps:[{kind:'action',id:'custom-update',operation:'custom-update'}]})}],
    adapters:[{id:'simulation',label:'Simulation adapter',capabilities:['deploy','deploy-candidate','set-traffic','promote-candidate','prepare-environment','switch-traffic','promote-environment','custom-update','restore'],
      async execute(action,release,context){await pause();actual.set(context.target.id,release.digest);return{status:'succeeded',reference:'simulation-receipt',changes:[{resourceId:'application',action:'update' as const}]};},
      async observe(context){return{known:true,releaseDigest:actual.get(context.target.id)??null};}}],
    checks:[{id:'example-checks',suites:()=>suites,async run(request){await pause();const failed=request.releaseId===failing.id&&request.stageId==='gamma';return{request,status:failed?'failed':'passed',checks:[{id:request.suiteId,status:failed?'failed':'passed'}]};}}]};
  const definition=(selection:PipelineSelection,id:string):PipelineDefinition=>({version:1,id,label:catalog.label,configurationDigest:digest(selection),stages:selection.stages.map((stage,index)=>({id:stage.id,label:catalog.stages[index]!.label,target:{id:'example-'+stage.id,scope:'simulation-only'},strategyId:stage.strategyId,adapterId:'simulation',...(stage.strategyId==='canary'?{parameters:{weights:stage.options.pace==='quick'?[25,100]:[5,25,50,100]}}:{}),checks:stage.checkIds.map(id=>({runnerId:'example-checks',suiteId:id,suiteDigest:suites.find(v=>v.id===id)!.digest})),rollback:stage.rollback,promotion:catalog.stages[index]!.promotion}))});
  // Establish verified baselines through the same finite native workflow; never invent a verified receipt.
  const initial:PipelineSelection={releaseId:baseline.id,stages:catalog.stages.map(stage=>({id:stage.id,strategyId:'direct',options:{},checkIds:['health','access'],rollback:'disabled'}))};
  const seeded=definition(initial,'seed-'+randomUUID());seeded.stages.forEach(stage=>{stage.promotion='automatic';});
  const seededRun=await new PipelineWorkflow({definition:seeded,release:baseline,registry,store:new FilePipelineStore(join(directory,'baseline-'+randomUUID())),targetStore:targets}).start();
  if(seededRun.status!=='passed')throw Error('The example baseline did not verify');
  return {catalog,async prepare(selection){const release=releases.find(v=>v.id===selection.releaseId);if(!release)throw Error('Choose a prepared example release');const plan=definition(selection,'attempt-'+randomUUID());const compiled=compileRolloutPlans(plan,release,registry);
    return {workflow:new PipelineWorkflow({definition:plan,release,registry,store:new FilePipelineStore(join(directory,plan.id)),targetStore:targets}),plans:Object.fromEntries(compiled.map(v=>[v.stageId,v.plan]))};},
    async loadRecording(state,stageId){const last=state.recordings.findLast(v=>v.stageId===stageId);if(!last)return;const loaded=await loadPipelineRecording(last.evidencePath,{runId:last.runId,definitionDigest:state.definitionDigest,executionId:state.executionId!,stageId:last.stageId});return{snapshot:loaded.snapshot,structure:loaded.structure,controlDeps:loaded.controlDeps as Record<string,unknown>,narrativeEntries:Array.isArray(loaded.narrativeEntries)?loaded.narrativeEntries:[]};}};
}
