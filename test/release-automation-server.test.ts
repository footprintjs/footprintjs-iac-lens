import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {ReleaseAutomationHost,FileReleaseAutomationStore,loadReleaseAutomationRecording,type ReleaseAutomationAdapter,type ReleaseAutomationPort,type ReleaseAutomationState} from 'footprintjs-iac/release-automation/node';
import {ReleasePreparationWorkflow,FileReleasePreparationStore,loadReleaseBuildRecording,type ResolvedReleaseChoice,type ReleaseCatalog} from 'footprintjs-iac/releases/node';
import {PipelineWorkflow,FilePipelineStore,FilePipelineTargetStore,loadPipelineRecording,directStrategy,type PipelineDefinition,type RolloutAdapter} from 'footprintjs-iac/pipeline/node';
import {ReleaseAutomationReview} from '../src/server/release-automation.ts';
import type {ReleaseAutomationView} from '../src/core/release-automation.ts';
import type {Recording} from '../src/core/types.ts';

function nativeView(input:unknown):Recording {
  const value=input as {snapshot:unknown;structure:unknown;controlDeps?:Record<string,unknown>;narrativeEntries?:unknown[]};
  return{snapshot:value.snapshot,structure:value.structure,...(value.controlDeps?{controlDeps:value.controlDeps}:{}),...(value.narrativeEntries?{narrativeEntries:value.narrativeEntries}:{})};
}

async function fixture(t:{after(fn:()=>Promise<void>):void},manualGamma=false){
  const directory=await mkdtemp(join(tmpdir(),'lens-release-host-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const choices:ResolvedReleaseChoice[]=[],calls:string[]=[],deployed=new Map<string,string>();
  const controls:{gate?:Promise<void>;entered?:()=>void;unknown?:boolean;badRecording?:boolean}={};
  const stages:ReleaseAutomationView['stages']=['dev','gamma','prod'].map(id=>({id,label:id,promotion:id==='gamma'&&manualGamma?'manual':'automatic',rollback:'disabled'}));
  const targetStore=new FilePipelineTargetStore(join(directory,'targets'));
  const catalog:ReleaseCatalog={id:'releases',async list(){calls.push('list');return structuredClone(choices);},async resolve(id){calls.push('resolve');return structuredClone(choices.find(choice=>choice.id===id)!);}};
  const provider:RolloutAdapter={id:'fixture',label:'Explicit local test provider',capabilities:['deploy'],async execute(_action,release,context){
    calls.push('deploy:'+context.stageId);if(controls.unknown)throw Error('PRIVATE-PROVIDER');deployed.set(context.target.scope,release.digest);
    return{status:'succeeded',changes:[{resourceId:'app',action:'update'}],metadata:{secret:'PRIVATE-PROVIDER'}};
  },async observe(context){return{known:true,releaseDigest:deployed.get(context.target.scope)??null};}};
  const adapter:ReleaseAutomationAdapter={id:'builder',async prepare(choice,context){
    return new ReleasePreparationWorkflow({definition:{id:context.attemptId,label:choice.label,source:{repository:choice.source.repository,ref:choice.source.ref},target:{id:'artifact-host',scope:'PRIVATE-ARTIFACT-TARGET'},recipe:{id:'fixture',digest:'a'.repeat(64)},configurationDigest:'b'.repeat(64)},expectedRevision:choice.source,store:new FileReleasePreparationStore(join(context.directory,'build')),
      adapters:{source:{async resolve(){return choice.source;},async fetch(revision){return{revision,location:'/private/checkout'};}},build:{async build(_source,recipe){calls.push('build');controls.entered?.();if(controls.gate)await controls.gate;return{recipeDigest:recipe.digest,artifacts:[{id:'app',digest:choice.source.commit.slice(0,1).repeat(64),reference:'registry/app:'+choice.id}],metadata:{secret:'PRIVATE-BUILD'}};}},artifacts:{async publish(build){return{artifacts:build.artifacts};}}}});
  },async pipeline(prepared,context){
    const definition:PipelineDefinition={version:1,id:'pipeline',label:'Release pipeline',configurationDigest:'c'.repeat(64),stages:stages.map(stage=>({...stage,target:{id:'app-'+stage.id,scope:'PRIVATE-TARGET-'+stage.id},strategyId:'direct',adapterId:provider.id,checks:[{runnerId:'check',suiteId:'access',suiteDigest:'d'.repeat(64)}]}))};
    return new PipelineWorkflow({definition,release:prepared.release!,store:new FilePipelineStore(join(context.directory,'pipeline')),targetStore,registry:{strategies:[directStrategy()],adapters:[provider],checks:[{id:'check',suites:()=>[{id:'access',label:'Access',kind:'explicit-local-test',digest:'d'.repeat(64)}],async run(request){return{request,status:'passed',checks:[{id:'access',status:'passed'}]};}}]}});
  }};
  const host=()=>new ReleaseAutomationHost({definition:{version:1,id:'neo-releases',label:'Application releases',catalogId:catalog.id,adapterId:adapter.id,configurationDigest:'e'.repeat(64),automatic:{enabled:true,initial:'observe'}},catalog,adapter,store:new FileReleaseAutomationStore(join(directory,'automation'))});
  const add=(version:number)=>choices.push({id:'release-'+version,label:'Application '+version,version:'v'+version,publishedAt:new Date(Date.UTC(2026,0,version)).toISOString(),source:{repository:'https://github.com/acme/app.git',ref:'refs/tags/v'+version,commit:String(version).repeat(40),tree:'f'.repeat(40)}});
  async function loadRecording(state:ReleaseAutomationState,attemptId:string,stageId?:string):Promise<Recording|undefined>{
    const attempt=state.attempts.find(value=>value.id===attemptId)!;
    if(stageId){const receipt=attempt.pipeline?.recordings.findLast(item=>item.stageId===stageId);if(!receipt)return;
      if(controls.badRecording)return{snapshot:{runId:'wrong-native-run'},structure:{}};
      return nativeView(await loadPipelineRecording(receipt.evidencePath,{runId:receipt.runId}));}
    const receipt=attempt.recordings.at(-1);
    if(receipt)return nativeView(await loadReleaseAutomationRecording(receipt.evidencePath,{runId:receipt.runId}));
    const preparation=attempt.preparation?.recordings.at(-1);
    if(preparation)return nativeView(await loadReleaseBuildRecording(preparation.evidencePath,preparation.tracePath,{runId:preparation.runId,
      executionId:attempt.preparation!.executionId!,definitionDigest:attempt.preparation!.definitionDigest}));
  }
  const views:ReleaseAutomationView[]=[];
  function review(port:ReleaseAutomationPort=host()){
    const instance=new ReleaseAutomationReview({host:port,stages,loadRecording},view=>views.push(view),()=>{});t.after(async()=>instance.dispose());return instance;
  }
  return{directory,calls,controls,stages,add,host,review,views};
}

test('manual UI discovery does not deploy; build progress, three real native stage receipts and private projection survive asynchronous deployment',async t=>{
  const f=await fixture(t);f.add(1);const review=f.review();await review.initialize();
  await review.action({action:'refresh',hostId:'neo-releases'});await review.whenIdle();assert.equal(f.calls.includes('build'),false);
  assert.equal(review.snapshot().choices[0]?.version,'v1');
  let release!:()=>void,entered!:()=>void;f.controls.gate=new Promise<void>(resolve=>{release=resolve;});const started=new Promise<void>(resolve=>{entered=resolve;});f.controls.entered=entered;
  await review.action({action:'deploy',hostId:'neo-releases',releaseId:'release-1'});await started;
  assert.equal(review.snapshot().busy,true);assert.equal(review.snapshot().attempts[0]?.build.find(stage=>stage.id==='build')?.status,'running');
  await assert.rejects(()=>review.action({action:'deploy',hostId:'neo-releases',releaseId:'release-1'}),/current release task/);
  release();await review.whenIdle();const view=review.snapshot();
  assert.equal(view.busy,false);assert.equal(view.attempts[0]?.status,'passed');assert.equal(view.attempts[0]?.trigger,'manual');
  assert.deepEqual(f.calls.filter(call=>call.startsWith('deploy:')),['deploy:dev','deploy:gamma','deploy:prod']);assert.equal(f.calls.filter(call=>call==='build').length,1);
  assert.ok(view.attempts[0]?.recording);assert.ok(view.attempts[0]?.pipeline?.stages.every(stage=>stage.recording));
  const bytes=JSON.stringify(view);for(const secret of ['PRIVATE-','/private/checkout',f.directory,'evidencePath','tracePath','"token":','"target":'])assert.equal(bytes.includes(secret),false,secret);
  await assert.rejects(()=>review.action({action:'deploy',hostId:'neo-releases',releaseId:'release-1'}),/retained attempt/);
});

test('a restored manual gamma gate sends only the exact host-held token and never rebuilds or repeats dev',async t=>{
  const f=await fixture(t,true);f.add(1);const host=f.host();await host.refresh();await host.start('release-1');
  const native=await host.snapshot(),attempt=native.attempts[0]!,gate=attempt.pipeline!.pendingAction!;assert.equal(gate.stageId,'gamma');
  let request:unknown;
  const reopened=f.host();const port:ReleaseAutomationPort={snapshot:()=>reopened.snapshot(),refresh:()=>reopened.refresh(),tick:()=>reopened.tick(),start:id=>reopened.start(id),
    promote:async(id,value)=>{request=value;return reopened.promote(id,value);},recover:(id,value)=>reopened.recover(id,value),subscribe:listener=>reopened.subscribe(listener)};
  const review=f.review(port);await review.initialize();
  assert.equal(review.snapshot().attempts[0]?.pipeline?.stages[1]?.canPromote,true);assert.equal(JSON.stringify(review.snapshot()).includes(gate.token),false);
  await assert.rejects(()=>review.action({action:'promote',hostId:'neo-releases',attemptId:attempt.id,stageId:'prod'}),/no longer available/);
  await review.action({action:'promote',hostId:'neo-releases',attemptId:attempt.id,stageId:'gamma'});await review.whenIdle();
  assert.deepEqual(request,{stageId:gate.stageId,token:gate.token,releaseDigest:gate.releaseDigest});assert.equal(review.snapshot().attempts[0]?.status,'passed');
  assert.deepEqual(f.calls.filter(call=>call.startsWith('deploy:')),['deploy:dev','deploy:gamma','deploy:prod']);assert.equal(f.calls.filter(call=>call==='build').length,1);
  await assert.rejects(()=>review.action({action:'promote',hostId:'neo-releases',attemptId:attempt.id,stageId:'gamma'}),/no longer available/);
});

test('automatic host publication appears live; unknown effects stay incomplete and cannot be retried from the browser',async t=>{
  const f=await fixture(t);f.add(1);const host=f.host();await host.tick();const review=f.review(host);await review.initialize();
  f.add(2);f.controls.unknown=true;await host.tick();await review.whenIdle();const view=review.snapshot();
  assert.equal(view.attempts[0]?.trigger,'automatic');assert.equal(view.attempts[0]?.status,'incomplete');assert.equal(view.attempts[0]?.pipeline?.stages[0]?.status,'incomplete');
  assert.equal(view.attempts[0]?.pipeline?.stages[1]?.status,'pending');assert.equal(view.attempts[0]?.pipeline?.stages[0]?.canRecover,false);
  f.add(3);await review.action({action:'refresh',hostId:'neo-releases'});await review.whenIdle();
  await assert.rejects(()=>review.action({action:'deploy',hostId:'neo-releases',releaseId:'release-3'}),/outstanding release/);
  assert.equal(f.calls.filter(call=>call==='build').length,1);
});

test('changed host bindings quarantine actions and mismatched recording IDs never attach',async t=>{
  const f=await fixture(t);f.add(1);const host=f.host();await host.refresh();let emit:((state:ReleaseAutomationState)=>void)|undefined;
  const port:ReleaseAutomationPort={snapshot:()=>host.snapshot(),refresh:()=>host.refresh(),tick:()=>host.tick(),start:id=>host.start(id),promote:(id,request)=>host.promote(id,request),recover:(id,request)=>host.recover(id,request),subscribe:listener=>{emit=listener;return()=>{};}};
  const review=f.review(port);await review.initialize();const bad=structuredClone(await host.snapshot());bad.definition.configurationDigest='0'.repeat(64);emit!(bad);
  assert.match(review.snapshot().error!,/binding changed/);await assert.rejects(()=>review.action({action:'deploy',hostId:'neo-releases',releaseId:'release-1'}),/needs inspection/);assert.equal(f.calls.includes('build'),false);
  const other=await fixture(t);other.add(1);other.controls.badRecording=true;const safe=other.review();await safe.initialize();await safe.action({action:'refresh',hostId:'neo-releases'});await safe.whenIdle();await safe.action({action:'deploy',hostId:'neo-releases',releaseId:'release-1'});await safe.whenIdle();
  assert.equal(safe.snapshot().attempts[0]?.status,'passed');assert.equal(safe.snapshot().attempts[0]?.pipeline?.stages.some(stage=>stage.recording),false);assert.match(safe.snapshot().error!,/recording could not be opened/);
});

test('an unexpected final child target is quarantined even after valid progress subscriptions',async t=>{
  const f=await fixture(t);f.add(1);const host=f.host();await host.refresh();
  const port:ReleaseAutomationPort={snapshot:()=>host.snapshot(),refresh:()=>host.refresh(),tick:()=>host.tick(),
    start:async id=>{const state=structuredClone(await host.start(id));state.attempts[0]!.pipeline!.definition.stages[0]!.target.scope='another-private-target';return state;},
    promote:(id,request)=>host.promote(id,request),recover:(id,request)=>host.recover(id,request),subscribe:listener=>host.subscribe(listener)};
  const review=f.review(port);await review.initialize();await review.action({action:'deploy',hostId:'neo-releases',releaseId:'release-1'});await review.whenIdle();
  assert.equal(review.snapshot().attempts[0]?.status,'incomplete');assert.equal(review.snapshot().attempts[0]?.pipeline?.status,'incomplete');assert.match(review.snapshot().error!,/inspection|binding/);
  await assert.rejects(()=>review.action({action:'refresh',hostId:'neo-releases'}),/needs inspection/);assert.equal(JSON.stringify(review.snapshot()).includes('another-private-target'),false);
});
