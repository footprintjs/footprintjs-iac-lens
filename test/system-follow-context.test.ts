import assert from 'node:assert/strict';
import test from 'node:test';
import type {SystemTopologyView,TopologyNodeAction} from 'footprintjs-iac/system-topology';
import type {AdapterDeploymentResource,AdapterDeploymentView} from '../src/core/adapter-deployment.ts';
import type {DashboardState} from '../src/core/types.ts';
import type {RunFrame,RunRecord} from '../src/core/run-history.ts';
import {selectExecutionFollow} from '../src/core/execution-follow.ts';
import {selectSystemFollowContext} from '../web/features/runs/system-follow-context.ts';

const scope='execute-services',binding={targetId:'server',graphDigest:'a'.repeat(64)};
type Moment='start'|'backend'|'directory'|'gap'|'unmapped'|'settled';
function topology(active?:'backend'|'directory'):SystemTopologyView {
 const action=(componentId:string,stage:string):TopologyNodeAction=>({resourceId:'services',componentId,phase:'start',status:'running',scope:'component',label:'Recorded work',evidence:{kind:'adapter',runId:'native-one',runtimeStageId:scope+'/'+stage+'#1',complete:false}});
 const boundaries:SystemTopologyView['boundaries']=[
  {id:'host',label:'Server',kind:'server',status:'checking',observed:true,progress:{completed:0,total:2,indeterminate:false},evidence:[]},
  {id:'runtime',label:'systemd',kind:'runtime',parentId:'host',status:'checking',observed:true,progress:{completed:0,total:2,indeterminate:false},evidence:[]},
  {id:'directory-host',label:'Directory container',kind:'container',status:'checking',observed:true,progress:{completed:0,total:1,indeterminate:false},evidence:[]},
 ];
 const nodes:SystemTopologyView['nodes']=[['backend','neo-be','runtime'],['directory','ldap','directory-host']].map(([id,componentId,boundaryId])=>({id:id!,label:id!,category:'compute',origin:'existing',originLabel:'Existing',boundaryId,bindings:{resourceIds:['services'],componentIds:[componentId!]},status:'checking',statusLabel:'Checking',facts:{installed:'confirmed',running:'unknown',connected:'unknown'},evidenceScope:'component',progress:{completed:0,total:2,indeterminate:false},evidence:[],limitations:[],...active===id?{actions:[action(componentId!,active==='backend'?'restart':'verify-directory')]}:{}}));
 return{version:1,kind:'system-topology-view',definition:{version:1,kind:'system-topology',id:'system',label:'System',binding,digest:'b'.repeat(64),nodes,boundaries,connections:[]},observations:{...binding,definitionDigest:'b'.repeat(64),configurationDigest:'c'.repeat(64),resources:[],components:[],checks:[],actions:[]},nodes,boundaries,connections:[],limitations:[]};
}
function frame(kind:Moment='backend',revision=1):RunFrame {
 const stages=['restart','verify-directory','publish'].map(id=>({id:scope+'/'+id,stageId:id,label:id,kind:'stage' as const,scope,resourceId:'services',status:'pending' as const,runtimeStageIds:[] as string[],executions:0,column:0,row:0}));
 if(kind!=='start')for(const stage of stages){Object.assign(stage,{status:'completed',runtimeStageIds:[stage.id+'#1'],executions:1});}
 const active=kind==='backend'?'restart':kind==='directory'?'verify-directory':kind==='unmapped'?'publish':undefined;
 if(active)Object.assign(stages.find(stage=>stage.stageId===active)!,{status:'running'});
 const resource:AdapterDeploymentResource={resourceId:'services',label:'Services',action:'update',rootScope:scope,scopes:[{id:scope,label:'Services'}],stages,edges:[]};
 const deployment:AdapterDeploymentView={available:true,runId:'one',nativeRunId:'native-one',resources:[resource],warnings:[]};
 const state:DashboardState={revision,graph:null,busy:kind!=='settled',target:{id:'server'},run:{id:'one',status:kind==='settled'?'passed':'running',resources:[{id:'services',status:kind==='start'?'pending':kind==='settled'?'ready':'deploying'}],events:[]},systemTopology:topology(kind==='backend'||kind==='directory'?kind:undefined)};
 return{sequence:revision,nativePosition:'native-'+revision,caption:'Recorded moment',state,deployment};
}
function record(frames:RunFrame[]):RunRecord {
 return{version:1,summary:{id:'d'.repeat(64),runId:'one',targetId:'server',label:'Neo',kind:'deployment',status:'ready',sequence:1,frameCount:frames.length,replayAvailable:true,timing:'steps',appVerified:false,limitations:[]},frames,omittedFrames:0,limitations:[]};
}
const select=(held:RunRecord,index:number)=>selectSystemFollowContext({record:held,index,state:held.frames[index]!.state,deployment:held.frames[index]!.deployment});

test('physical camera context follows exact recorded actions without changing origins or current highlights',()=>{
 const frames=[frame('start',1),frame('backend',2),frame('gap',3)],held=record(frames),before=structuredClone(held);
 assert.deepEqual(select(held,1),{focus:{componentIds:['backend'],boundaryIds:['host','runtime']},held:false});
 assert.deepEqual(select(held,2),{focus:{componentIds:['backend'],boundaryIds:['host','runtime']},held:true});
 assert.deepEqual(selectExecutionFollow(frames[2]!.deployment,frames[2]!.state.systemTopology).componentIds,[]);
 assert.deepEqual(held,before);assert.equal(frames[2]!.state.systemTopology!.nodes[0]!.origin,'existing');
});

test('rewinding to Start and seeking terminal observations never retain a later physical area',()=>{
 const held=record([frame('start',1),frame('backend',2),frame('gap',3),frame('settled',4)]);
 assert.equal(select(held,2)?.held,true);assert.equal(select(held,0),undefined);assert.equal(select(held,3),undefined);
});

test('a newly recorded area wins immediately while same-resource unmapped work holds camera context only',()=>{
 const held=record([frame('backend',1),frame('unmapped',2),frame('directory',3),frame('gap',4)]);
 assert.deepEqual(select(held,1),{focus:{componentIds:['backend'],boundaryIds:['host','runtime']},held:true});
 assert.deepEqual(select(held,2),{focus:{componentIds:['directory'],boundaryIds:['directory-host']},held:false});
 assert.deepEqual(select(held,3),{focus:{componentIds:['directory'],boundaryIds:['directory-host']},held:true});
});

test('held context requires the same still-deploying resource and visited native stages',()=>{
 for(const change of [
  (value:RunFrame)=>{value.state.run!.resources=[];},
  (value:RunFrame)=>{value.state.run!.resources[0]!.status='ready';},
  (value:RunFrame)=>{value.state.run!.status='failed';},
  (value:RunFrame)=>{for(const stage of value.deployment!.resources[0]!.stages)stage.executions=0;},
  (value:RunFrame)=>{value.state.systemTopology=undefined;},
 ]){
  const gap=frame('gap',2);change(gap);assert.equal(select(record([frame('backend',1),gap]),1),undefined);
 }
 const other=frame('unmapped',2);other.deployment!.resources[0]!.resourceId='other';for(const stage of other.deployment!.resources[0]!.stages)stage.resourceId='other';
 other.state.run!.resources.push({id:'other',status:'deploying'});
 assert.equal(select(record([frame('backend',1),other]),1),undefined);
});

test('foreign native run, target, graph, topology and configuration frames cannot lend physical context',()=>{
 for(const change of [
  (value:RunFrame)=>{value.deployment!.nativeRunId='different-native';},
  (value:RunFrame)=>{value.deployment!.runId='different-run';},
  (value:RunFrame)=>{value.state.run!.id='different-run';},
  (value:RunFrame)=>{value.state.target={id:'other-server'};},
  (value:RunFrame)=>{value.state.systemTopology!.observations.targetId='other-server';},
  (value:RunFrame)=>{value.state.systemTopology!.observations.graphDigest='e'.repeat(64);},
  (value:RunFrame)=>{value.state.systemTopology!.definition.digest='e'.repeat(64);},
  (value:RunFrame)=>{value.state.systemTopology!.observations.definitionDigest='e'.repeat(64);},
  (value:RunFrame)=>{value.state.systemTopology!.observations.configurationDigest='e'.repeat(64);},
 ]){
  const prior=frame('backend',1),gap=frame('gap',2);change(prior);
  assert.equal(select(record([prior,gap]),1),undefined);
 }
});

test('live context excludes saved future revisions and accepts earlier exact native observations',()=>{
 const start=frame('start',1),future=frame('directory',10),current=frame('gap',5);
 assert.equal(selectSystemFollowContext({record:record([start,future]),index:1,state:current.state,deployment:current.deployment,followingLive:true}),undefined);
 const selected=selectSystemFollowContext({record:record([start,frame('backend',3),future]),index:0,state:current.state,deployment:current.deployment,followingLive:true});
 assert.deepEqual(selected,{focus:{componentIds:['backend'],boundaryIds:['host','runtime']},held:true});
});
