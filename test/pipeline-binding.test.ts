import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { PipelineWorkflow,FilePipelineStore,FilePipelineTargetStore } from 'footprintjs-iac/pipeline/node';
import { defineReleaseManifest } from 'footprintjs-iac/releases/node';
import { compileRolloutPlans,directStrategy,type PipelineDefinition,type PipelineState,type PipelineRegistry,type PipelineWorkflowPort } from 'footprintjs-iac/pipeline';
import { PipelineReview } from '../src/server/pipeline.ts';
import { projectPipelineState,projectPipelinePreview } from '../src/core/pipeline-project.ts';
import { defaultPipelineSelection,type PipelineCatalog } from '../src/core/pipeline.ts';

async function fixture(t:{after(fn:()=>unknown):void}){
  const directory=await mkdtemp(join(tmpdir(),'lens-binding-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const release=defineReleaseManifest({id:'release',source:{repository:'https://github.com/example/app',ref:'v1',commit:'c'.repeat(40),tree:'d'.repeat(40)},recipe:{id:'recipe',digest:'a'.repeat(64)},artifacts:[{id:'app',digest:'b'.repeat(64),reference:'app:example'}]});
  const catalog:PipelineCatalog={id:'host',label:'Host',simulation:true,releases:[{id:'release',label:'Release',kind:'prepared',digest:release.digest,commit:release.source.commit}],strategies:[{id:'direct',label:'Direct',description:'A host strategy',rollback:true,options:[]}],checks:[],schedules:[],stages:[{id:'local',label:'Local',promotion:'automatic',strategyIds:['direct'],checkIds:[],scheduleIds:[],defaults:{strategyId:'direct',options:{},checkIds:[],rollback:'disabled'}}]};
  const definition:PipelineDefinition={version:1,id:'attempt',label:'Attempt',configurationDigest:'e'.repeat(64),stages:[{id:'local',label:'Local',target:{id:'owned',scope:'private-target'},strategyId:'direct',adapterId:'fixture',checks:[{runnerId:'fixture',suiteId:'health',suiteDigest:'f'.repeat(64)}],rollback:'disabled',promotion:'automatic'}]};
  const registry:PipelineRegistry={strategies:[directStrategy()],adapters:[{id:'fixture',label:'Fixture',capabilities:['deploy'],async execute(){throw Error('No provider effects are expected');},async observe(){return{known:true,releaseDigest:null};}}],checks:[{id:'fixture',suites:()=>[{id:'health',label:'Health',kind:'fixture',digest:'f'.repeat(64)}],async run(){throw Error('No check effects are expected');}}]};
  const native=new PipelineWorkflow({definition,release,registry,store:new FilePipelineStore(join(directory,'attempt')),targetStore:new FilePipelineTargetStore(join(directory,'target'))});
  const state=await native.snapshot(),plans=Object.fromEntries(compileRolloutPlans(definition,release,registry).map(v=>[v.stageId,v.plan]));
  return{catalog,state,plans,selection:defaultPipelineSelection(catalog)};
}

test('installed definition and manifest bindings validate final returns even when a host emits no subscriptions',async t=>{
  const {catalog,state,plans,selection}=await fixture(t);const changed=structuredClone(state);changed.definition.stages[0]!.target.id='another-target';let starts=0;
  const workflow:PipelineWorkflowPort={async snapshot(){return state;},async start(){starts++;return changed;},async promote(){throw Error('unsupported');},async recover(){throw Error('unsupported');},subscribe(){return()=>{};}};
  const review=new PipelineReview({catalog,async prepare(){return{workflow,plans};}},()=>{},()=>{});await review.initialize();await review.action({action:'preview',pipelineId:catalog.id,selection});
  await review.action({action:'start',pipelineId:catalog.id,previewId:review.snapshot().preview!.id});await review.whenIdle();
  assert.equal(starts,1);assert.equal(review.snapshot().execution?.status,'incomplete');assert.equal(review.snapshot().busy,false);assert.match(review.snapshot().error!,/inspection/);
  await assert.rejects(()=>review.action({action:'start',pipelineId:catalog.id,previewId:review.snapshot().preview!.id}),/binding needs inspection/);review.dispose();
});

test('changed subscription definitions are quarantined instead of being swallowed as stale UI, and catalog commits bind source choices',async t=>{
  const {catalog,state,plans,selection}=await fixture(t);let emit:((state:PipelineState)=>void)|undefined;
  const workflow:PipelineWorkflowPort={async snapshot(){return state;},async start(){return state;},async promote(){return state;},async recover(){return state;},subscribe(listener){emit=listener;return()=>{};}};
  const review=new PipelineReview({catalog,async prepare(){return{workflow,plans};}},()=>{},()=>{});await review.initialize();await review.action({action:'preview',pipelineId:catalog.id,selection});
  const changed=structuredClone(state);changed.definitionDigest='1'.repeat(64);emit!(changed);assert.equal(review.snapshot().execution?.status,'incomplete');assert.match(review.snapshot().error!,/changed unexpectedly/);review.dispose();
  const wrong=structuredClone(catalog);wrong.releases[0]={id:'release',label:'Source version',kind:'source',commit:'0'.repeat(40)};
  const other=new PipelineReview({catalog:wrong,async prepare(){return{workflow,plans};}},()=>{},()=>{});await other.initialize();await assert.rejects(()=>other.action({action:'preview',pipelineId:wrong.id,selection}),/refused these settings/);assert.equal(other.snapshot().preview,undefined);other.dispose();
});

test('valid wide native plans and 128-character identifiers remain viewable beyond sixty-four operations',async t=>{
  const {state,selection,plans}=await fixture(t),wide=structuredClone(state);wide.executionId='execution';wide.status='running';wide.stages[0]!.status='running';
  wide.stages[0]!.operations=Array.from({length:88},(_,index)=>({id:'a'.repeat(124)+String(index).padStart(4,'0'),kind:'action',operation:'deploy',status:'succeeded',releaseDigest:wide.release.digest,receipt:{status:'succeeded'}}));
  const projected=projectPipelineState(wide,'release');assert.equal(projected.stages[0]?.steps.length,88);assert.equal(projected.stages[0]?.steps[0]?.id.length,128);
  const long=structuredClone(state);long.definition.stages[0]!.id='s'.repeat(128);const longSelection=structuredClone(selection);longSelection.stages[0]!.id=long.definition.stages[0]!.id;
  assert.ok(projectPipelinePreview('a'.repeat(64),longSelection,long,{[longSelection.stages[0]!.id]:plans.local!}).steps.every(step=>step.id.length>128));
});

test('failed or unknown recovery cannot appear as available after its action was consumed',async t=>{
  const {state}=await fixture(t),failed=structuredClone(state);failed.definition.stages[0]!.rollback='manual';failed.executionId='execution';failed.status='failed';failed.stages[0]!.status='failed';failed.stages[0]!.phase='outcome';
  failed.stages[0]!.operations=[{id:'recovery-restore',kind:'action',operation:'restore',status:'succeeded',releaseDigest:failed.release.digest,receipt:{status:'succeeded'}},{id:'recovery-acceptance-0',kind:'check',status:'failed',releaseDigest:failed.release.digest}];
  assert.equal(projectPipelineState(failed,'release').stages[0]?.recovery,'failed');failed.status='incomplete';failed.stages[0]!.status='incomplete';failed.stages[0]!.operations[0]!.status='unknown';failed.stages[0]!.operations[0]!.receipt={status:'unknown'};
  assert.equal(projectPipelineState(failed,'release').stages[0]?.recovery,'incomplete');assert.equal(projectPipelineState(failed,'release').stages[0]?.canRecover,false);
});
