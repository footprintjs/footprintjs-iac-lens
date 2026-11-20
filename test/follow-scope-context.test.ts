import assert from 'node:assert/strict';
import test from 'node:test';
import type {AdapterDeploymentResource,AdapterDeploymentView} from '../src/core/adapter-deployment.ts';
import type {DashboardState} from '../src/core/types.ts';
import type {RunFrame,RunRecord} from '../src/core/run-history.ts';
import {selectExecutionFollow} from '../src/core/execution-follow.ts';
import {deriveFollowScopeContext,selectFollowScopeContext} from '../web/features/runs/follow-scope-context.ts';

const root='execute-services',child=root+'/provider',nested=child+'/host';
function publication(kind:'start'|'active'|'gap'|'parent'|'settled'='active',revision=1):RunFrame {
 const stage=(id:string,scope=root,childScope?:string)=>({id:scope+'/'+id,stageId:id,label:id,kind:childScope?'subflow' as const:'stage' as const,scope,resourceId:'services',status:'pending' as const,runtimeStageIds:[] as string[],executions:0,column:0,row:0,...childScope?{childScope}:{}});
 const resource:AdapterDeploymentResource={resourceId:'services',label:'Services',action:'update',rootScope:root,scopes:[{id:root,label:'Services'},{id:child,label:'Provider',parentScope:root,mountStageId:root+'/provider'},{id:nested,label:'Host',parentScope:child,mountStageId:child+'/host'}],stages:[stage('provider',root,child),stage('host',child,nested),stage('first',nested),stage('next',nested),stage('verify',root)],edges:[]};
 if(kind!=='start'){
  for(const row of resource.stages.filter(row=>row.stageId!=='next'&&row.stageId!=='verify')){row.status='unknown';row.executions=1;row.runtimeStageIds=[row.id+'#1'];}
  const first=resource.stages.find(row=>row.stageId==='first')!;first.status=kind==='active'?'running':'completed';
  if(kind==='parent'){const verify=resource.stages.find(row=>row.stageId==='verify')!;verify.status='running';verify.executions=1;verify.runtimeStageIds=[verify.id+'#1'];}
 }
 const deployment:AdapterDeploymentView={available:true,runId:'one',nativeRunId:'native-one',resources:[resource],warnings:[]};
 const state:DashboardState={revision,graph:null,busy:kind!=='settled',target:{id:'server'},run:{id:'one',status:kind==='settled'?'passed':'running',resources:[{id:'services',status:kind==='settled'?'ready':kind==='start'?'pending':'deploying'}],events:[]}};
 return{sequence:revision,nativePosition:'native-'+revision,caption:'Recorded moment',state,deployment};
}
function record(frames:RunFrame[]):RunRecord {
 return{version:1,summary:{id:'a'.repeat(64),runId:'one',targetId:'server',label:'Neo',kind:'deployment',status:'ready',sequence:1,frameCount:frames.length,replayAvailable:true,timing:'steps',appVerified:false,limitations:[]},frames,omittedFrames:0,limitations:[]};
}
const context=(frame:RunFrame,previous?:ReturnType<typeof deriveFollowScopeContext>)=>deriveFollowScopeContext(frame.state,frame.deployment,selectExecutionFollow(frame.deployment),previous);

test('an actor-free gap retains only the visited camera scope while the same resource is deploying',()=>{
 const active=publication('active',1),gap=publication('gap',2),before=structuredClone(gap),plan=selectExecutionFollow(gap.deployment),previous=context(active);
 assert.equal(previous?.scopeId,nested);
 assert.deepEqual(plan.activeStageIds,[]);assert.deepEqual(plan.componentIds,[]);assert.deepEqual(plan.stageIds,[]);
 const held=deriveFollowScopeContext(gap.state,gap.deployment,plan,previous);
 assert.deepEqual(held,{runId:'one',resourceId:'services',scopeId:nested,held:true});
 assert.deepEqual(gap,before);assert.deepEqual(plan.activeStageIds,[],'camera context never manufactures an active stage');
});

test('the next explicitly running parent exits its child immediately',()=>{
 const previous=context(publication('active')),parent=publication('parent',2);
 assert.deepEqual(context(parent,previous),{runId:'one',resourceId:'services',scopeId:null,held:false});
});

test('settled, failed, missing and no-longer-deploying resources clear a held camera scope',()=>{
 const previous=context(publication('active'));
 for(const status of ['ready','failed','skipped','pending'] as const){
  const gap=publication('gap',2);gap.state.run!.resources[0]!.status=status;
  assert.equal(context(gap,previous)?.scopeId,null);
 }
 const failed=publication('gap',2);failed.state.run!.status='failed';assert.equal(context(failed,previous)?.scopeId,null);
 const missing=publication('gap',2);missing.state.run!.resources=[];assert.equal(context(missing,previous)?.scopeId,null);
 assert.equal(context(publication('settled',2),previous)?.scopeId,null);
});

test('a different native deployment or selected resource cannot inherit another camera context',()=>{
 const previous=context(publication('active'))!,gap=publication('gap',2);
 assert.equal(context(gap,{...previous,runId:'foreign'})?.scopeId,null);
 assert.equal(context(gap,{...previous,resourceId:'foreign'})?.scopeId,null);
 gap.state.run!.id='foreign';assert.equal(context(gap,previous),undefined);
});

test('unknown scopes, broken explicit ancestry and unvisited current publications cannot hold a scope',()=>{
 const previous=context(publication('active'))!;
 const missing=publication('gap',2);missing.deployment!.resources[0]!.scopes=missing.deployment!.resources[0]!.scopes.filter(scope=>scope.id!==nested);
 assert.equal(context(missing,previous)?.scopeId,null);
 const broken=publication('gap',2);broken.deployment!.resources[0]!.scopes.find(scope=>scope.id===nested)!.parentScope=nested;
 assert.equal(context(broken,previous)?.scopeId,null);
 const unvisited=publication('gap',2);for(const row of unvisited.deployment!.resources[0]!.stages)row.executions=0;
 assert.equal(context(unvisited,previous)?.scopeId,null);
});

test('a replay seek folds only its selected prefix, so rewinding to Start cannot borrow a future scope',()=>{
 const frames=[publication('start',1),publication('active',2),publication('gap',3),publication('settled',4)],held=record(frames),before=structuredClone(held);
 const selected=(index:number)=>selectFollowScopeContext({record:held,index,state:frames[index]!.state,deployment:frames[index]!.deployment});
 assert.equal(selected(2)?.scopeId,nested);assert.equal(selected(2)?.held,true);
 assert.equal(selected(0)?.scopeId,null);assert.equal(selected(0)?.held,false);
 assert.equal(selected(3)?.scopeId,null);assert.deepEqual(held,before);
});

test('gaps between consecutive callbacks keep one scope while each current actor remains genuinely absent',()=>{
 const frames=[publication('start',1),publication('active',2),publication('gap',3),publication('gap',4),publication('active',5)],held=record(frames);
 const contexts=frames.map((frame,index)=>selectFollowScopeContext({record:held,index,state:frame.state,deployment:frame.deployment}));
 assert.deepEqual(contexts.map(value=>value?.scopeId),[null,nested,nested,nested,nested]);
 assert.deepEqual(selectExecutionFollow(frames[2]!.deployment).activeStageIds,[]);
 assert.deepEqual(selectExecutionFollow(frames[3]!.deployment).componentIds,[]);
});

test('live selection ignores saved revisions newer than the selected live publication',()=>{
 const start=publication('start',1),future=publication('active',10),current=publication('gap',5),held=record([start,future]);
 assert.equal(selectFollowScopeContext({record:held,index:1,state:current.state,deployment:current.deployment,followingLive:true})?.scopeId,null);
 const admitted=publication('active',3),recorded=record([start,admitted,future]);
 const selected=selectFollowScopeContext({record:recorded,index:0,state:current.state,deployment:current.deployment,followingLive:true});
 assert.equal(selected?.scopeId,nested);assert.equal(selected?.held,true);
});

test('foreign target and configuration frames cannot lend even a structurally matching scope',()=>{
 const foreign=publication('active',1),current=publication('gap',2);foreign.state.target={id:'different-server'};
 assert.equal(selectFollowScopeContext({record:record([foreign,current]),index:1,state:current.state,deployment:current.deployment})?.scopeId,null);
 const wrongRun=publication('active',1);wrongRun.deployment!.runId='other';
 assert.equal(selectFollowScopeContext({record:record([wrongRun,current]),index:1,state:current.state,deployment:current.deployment})?.scopeId,null);
});

test('explicit parent links admit visited descendants even when scope IDs share no textual prefix',()=>{
 const previous={runId:'one',resourceId:'services',scopeId:'opaque-provider',held:false},frame=publication('gap',2),resource=frame.deployment!.resources[0]!;
 resource.scopes=[{id:root,label:'Services'},{id:'opaque-provider',label:'Provider',parentScope:root,mountStageId:root+'/provider'},{id:'opaque-host',label:'Host',parentScope:'opaque-provider',mountStageId:'host-mount'}];
 resource.stages[0]!.childScope='opaque-provider';resource.stages[1]!.id='host-mount';resource.stages[1]!.scope='opaque-provider';resource.stages[1]!.childScope='opaque-host';
 resource.stages[2]!.scope='opaque-host';
 assert.equal(context(frame,previous)?.scopeId,'opaque-provider');
});
